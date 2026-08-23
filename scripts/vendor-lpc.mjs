// Vendoring COMPLETO do Universal LPC Spritesheet Character Generator.
// Uso: node scripts/vendor-lpc.mjs <path-do-clone-do-gerador>
// Varre todas as sheet_definitions, fatia só as linhas de walk (y=512,
// 4 direções × 9 frames de 64px) de cada camada×corpo×variante e emite:
//   apps/web/public/lpc/<pasta-upstream>/<variante>.png   (fatias)
//   apps/web/public/lpc/CREDITS.txt                       (atribuição, obrigatória)
//   apps/web/public/lpc/EXCLUDED.txt                      (defs/variantes fora, com motivo)
//   packages/shared/src/lpc-catalog.json                  (catálogo consumido pelo shared)
// Exclusões: defs sem licença do allowlist (GPL-only fica fora), defs cujas
// camadas são todas custom_animation (não existem no walk) e variantes com
// arquivo ausente. Ver docs/superpowers/specs/2026-07-16-lpc-guarda-roupa-completo-design.md.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import sharp from 'sharp'

const WALK_Y = 512
const SHEET_W = 576
const SHEET_H = 256
const BODY_TYPES = ['male', 'female', 'muscular', 'pregnant', 'teen', 'child']
const ALLOWED_LICENSES = [
  'CC-BY-SA 3.0', 'CC-BY-SA 4.0', 'OGA-BY 3.0', 'OGA-BY 4.0',
  'CC-BY 3.0', 'CC-BY 4.0', 'CC0',
]

const generatorRoot = process.argv[2]
if (!generatorRoot || !existsSync(join(generatorRoot, 'sheet_definitions'))) {
  console.error('Uso: node scripts/vendor-lpc.mjs <path-do-clone-do-Universal-LPC-Spritesheet-Character-Generator>')
  process.exit(1)
}
const outRoot = join(process.cwd(), 'apps', 'web', 'public', 'lpc')
const catalogPath = join(process.cwd(), 'packages', 'shared', 'src', 'lpc-catalog.json')

const normFolder = (p) => p.replace(/\/+$/, '')
const variantFile = (v) => `${v.replace(/ /g, '_')}.png`

function licenseOk(credit) {
  return (credit.licenses ?? []).some((l) => ALLOWED_LICENSES.some((a) => l.trim().startsWith(a)))
}

async function sliceWalk(srcPath, destPath) {
  const meta = await sharp(srcPath).metadata()
  if ((meta.width ?? 0) < SHEET_W || (meta.height ?? 0) < WALK_Y + SHEET_H) {
    throw new Error(`${srcPath}: ${meta.width}x${meta.height} não contém a região de walk (esperado >= 576x768)`)
  }
  mkdirSync(dirname(destPath), { recursive: true })
  await sharp(srcPath)
    .extract({ left: 0, top: WALK_Y, width: SHEET_W, height: SHEET_H })
    .png({ palette: true, compressionLevel: 9 })
    .toFile(destPath)
}

const defs = readdirSync(join(generatorRoot, 'sheet_definitions'))
  .filter((f) => f.endsWith('.json'))
  .sort()

const catalog = []
const excluded = [] // linhas "def<TAB>motivo"
const creditsBlocks = new Map()
const sliced = new Set() // dedup: pasta/variante já fatiada
let files = 0

for (const defFile of defs) {
  const id = defFile.replace(/\.json$/, '')
  const def = JSON.parse(readFileSync(join(generatorRoot, 'sheet_definitions', defFile), 'utf8'))

  if (!def.credits?.length) {
    excluded.push(`${id}\tsem-creditos (placeholder upstream sem atribuição — nada é publicado sem crédito)`)
    continue
  }
  const badCredit = def.credits.find((c) => !licenseOk(c))
  if (badCredit) {
    excluded.push(`${id}\tlicenca-invalida (${(badCredit.licenses ?? []).join(', ') || 'nenhuma'})`)
    continue
  }

  // camadas de walk = layer_N sem custom_animation, em ordem numérica
  const layerKeys = Object.keys(def)
    .filter((k) => /^layer_\d+$/.test(k))
    .sort((a, b) => Number(a.slice(6)) - Number(b.slice(6)))
    .filter((k) => !def[k].custom_animation)
  if (layerKeys.length === 0) {
    excluded.push(`${id}\tsem-walk (todas as camadas são custom_animation)`)
    continue
  }

  // corpos disponíveis = interseção entre as camadas mantidas
  const bodyTypes = BODY_TYPES.filter((bt) => layerKeys.every((k) => typeof def[k][bt] === 'string'))
  if (bodyTypes.length === 0) {
    excluded.push(`${id}\tsem-corpo-suportado`)
    continue
  }

  // pastas únicas exigidas por variante (camada × corpo, dedup por pasta)
  const folders = [...new Set(layerKeys.flatMap((k) => bodyTypes.map((bt) => normFolder(def[k][bt]))))]

  const variants = []
  for (const rawVariant of def.variants ?? []) {
    const file = variantFile(rawVariant)
    const missing = folders.find((folder) => !existsSync(join(generatorRoot, 'spritesheets', folder, file)))
    if (missing) {
      excluded.push(`${id}\tvariante ${rawVariant} sem arquivo em ${missing}`)
      continue
    }
    variants.push(rawVariant.replace(/ /g, '_'))
  }
  if (variants.length === 0) {
    excluded.push(`${id}\tsem-arquivos (nenhuma variante completa)`)
    continue
  }

  for (const folder of folders) {
    for (const variant of variants) {
      const key = `${folder}/${variant}`
      if (sliced.has(key)) continue
      sliced.add(key)
      await sliceWalk(
        join(generatorRoot, 'spritesheets', folder, `${variant}.png`),
        join(outRoot, folder, `${variant}.png`),
      )
      files += 1
    }
  }

  catalog.push({
    id,
    category: def.type_name,
    label: def.name,
    layers: layerKeys.map((k) => ({
      zPos: def[k].zPos,
      paths: Object.fromEntries(bodyTypes.map((bt) => [bt, normFolder(def[k][bt])])),
    })),
    variants,
    bodyTypes,
  })

  for (const credit of def.credits) {
    const key = `${id}:${credit.file}`
    if (creditsBlocks.has(key)) continue
    const urls = Object.entries(credit).filter(([k, v]) => k.startsWith('url') && v).map(([, v]) => `  ${v}`)
    creditsBlocks.set(key, [
      `## ${def.name} (${id})`,
      `- Arquivo-fonte: ${credit.file}`,
      `- Autores: ${(credit.authors ?? []).join(', ')}`,
      `- Licenças: ${(credit.licenses ?? []).join(', ')}`,
      ...(credit.notes ? [`- Notas: ${credit.notes}`] : []),
      ...(urls.length ? ['- Links:', ...urls] : []),
      '',
    ].join('\n'))
  }
}

mkdirSync(outRoot, { recursive: true })
const header = [
  '# Créditos — arte do personagem (Liberated Pixel Cup)',
  '',
  'Os sprites do personagem são derivados do Universal LPC Spritesheet',
  'Character Generator (https://github.com/sanderfrenken/Universal-LPC-Spritesheet-Character-Generator),',
  'fatiados para conter apenas a animação de caminhada.',
  '',
  'Licenças (por item abaixo): CC-BY-SA 3.0/4.0 (https://creativecommons.org/licenses/by-sa/4.0/),',
  'OGA-BY 3.0/4.0 (https://static.opengameart.org/OGA-BY-3.0.txt),',
  'CC-BY 3.0/4.0 (https://creativecommons.org/licenses/by/4.0/)',
  'e/ou CC0 (https://creativecommons.org/publicdomain/zero/1.0/).',
  '',
].join('\n')
writeFileSync(join(outRoot, 'CREDITS.txt'), header + [...creditsBlocks.values()].join('\n'))
writeFileSync(join(outRoot, 'EXCLUDED.txt'), [
  '# Definições/variantes upstream fora do vendoring (def<TAB>motivo)',
  ...excluded,
  '',
].join('\n'))
writeFileSync(catalogPath, JSON.stringify(catalog, null, 1) + '\n')

function du(dir) {
  let total = 0
  for (const f of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, f.name)
    total += f.isDirectory() ? du(p) : statSync(p).size
  }
  return total
}
console.log(`ok: ${catalog.length} defs no catálogo, ${files} PNGs (${(du(outRoot) / 1024 / 1024).toFixed(1)} MB), ${excluded.length} linhas de exclusão`)

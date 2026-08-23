// scripts/vendor-tilesets.mjs
// Uso: node scripts/vendor-tilesets.mjs <dir-com-os-zips>
// Ex.: node scripts/vendor-tilesets.mjs ~/Downloads
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { join, basename } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'

// Os mapas do escritório podem ter tiles de 32 ou 48px, e a validação exige
// `tileset.tileWidth === map.tileWidth`. Geramos os dois tamanhos; o palette
// filtra pelo tamanho do mapa ativo. O tamanho entra no slug/id (unicidade).
const SIZES = [16, 32, 48]

// Temas de interiores do asset-4 que fazem sentido para um escritório.
const ASSET4_THEMES = [
  '1_Generic', '2_LivingRoom', '3_Bathroom', '5_Classroom_and_library',
  '6_Music_and_sport', '7_Art', '8_Gym', '13_Conference_Hall',
  '20_Japanese_interiors', '26_Condominium',
]

// Rótulos em pt-BR (o LimeZu nomeia as pastas em inglês).
const THEME_NAMES_PT = {
  '1_Generic': 'Geral',
  '2_LivingRoom': 'Sala de estar',
  '3_Bathroom': 'Banheiro',
  '5_Classroom_and_library': 'Sala de aula e biblioteca',
  '6_Music_and_sport': 'Música e esporte',
  '7_Art': 'Arte',
  '8_Gym': 'Academia',
  '13_Conference_Hall': 'Sala de conferência',
  '20_Japanese_interiors': 'Interiores japoneses',
  '26_Condominium': 'Condomínio',
}

// Curadoria (versão full apenas). Cada entrada é um spritesheet -> um tileset.
// category vira o grupo no palette; name é o rótulo (sem o tamanho, pois o
// palette só mostra um tamanho por vez).
function sourcesForSize(size) {
  const list = [
    { zip: 'asset-1.zip', entry: `Modern_Office_${size}x${size}.png`, slug: `modern-office-${size}`, name: 'Escritório moderno', category: 'Escritório' },
    { zip: 'asset-1.zip', entry: `1_Room_Builder_Office/Room_Builder_Office_${size}x${size}.png`, slug: `room-builder-office-${size}`, name: 'Piso e parede', category: 'Estrutura' },
  ]
  // O LimeZu nomeia a pasta de 16px como `Theme_Sorter` (sem sufixo);
  // 32/48 usam `Theme_Sorter_<size>x<size>`.
  const themeFolder = size === 16 ? 'Theme_Sorter' : `Theme_Sorter_${size}x${size}`
  for (const theme of ASSET4_THEMES) {
    const fallback = theme.replace(/^\d+_/, '').replaceAll('_', ' ')
    list.push({
      zip: 'asset-4.zip',
      entry: `1_Interiors/${size}x${size}/${themeFolder}/${theme}_${size}x${size}.png`,
      slug: `${theme.replace(/^\d+_/, '').replaceAll('_', '-').toLowerCase()}-${size}`,
      name: THEME_NAMES_PT[theme] ?? fallback.charAt(0).toUpperCase() + fallback.slice(1),
      category: 'Interiores',
    })
  }
  return list
}

const SOURCES = SIZES.flatMap((size) => sourcesForSize(size).map((s) => ({ ...s, tile: size })))

const zipsDir = process.argv[2]
if (!zipsDir) { console.error('Informe o diretório com os zips'); process.exit(1) }

const cwd = process.cwd()
const outDir = join(cwd, 'apps/web/public/office/tilesets')
const catalogPath = join(cwd, 'packages/shared/src/office-tileset-catalog.json')
mkdirSync(outDir, { recursive: true })
const tmp = mkdtempSync(join(tmpdir(), 'legends-tilesets-'))

const catalog = []
for (const src of SOURCES) {
  const zipPath = join(zipsDir, src.zip)
  if (!existsSync(zipPath)) { console.warn(`Zip ausente, pulando: ${src.zip}`); continue }
  // extrai só a entrada desejada para o tmp
  try {
    execFileSync('unzip', ['-o', '-j', zipPath, src.entry, '-d', tmp], { stdio: 'ignore' })
  } catch {
    console.warn(`Falha ao extrair ${src.entry} de ${src.zip}, pulando`)
    continue
  }
  const extracted = join(tmp, basename(src.entry))
  if (!existsSync(extracted)) { console.warn(`Entrada ausente: ${src.entry}`); continue }
  const tile = src.tile
  const destPng = join(outDir, `${src.slug}.png`)
  const meta = await sharp(extracted).metadata()
  const columns = Math.floor(meta.width / tile)
  const rows = Math.floor(meta.height / tile)
  // recorta para múltiplo exato do tile (a API valida columns = floor(w/tile))
  await sharp(extracted).extract({ left: 0, top: 0, width: columns * tile, height: rows * tile }).png({ compressionLevel: 9 }).toFile(destPng)
  catalog.push({
    id: `builtin:office/${src.slug}`,
    assetId: `builtin:office/${src.slug}`,
    name: src.name,
    category: src.category,
    url: `/office/tilesets/${src.slug}.png`,
    tileWidth: tile,
    tileHeight: tile,
    columns,
    tileCount: columns * rows,
    width: columns * tile,
    height: rows * tile,
  })
  console.log(`ok ${src.slug} ${columns}x${rows} (tile ${tile})`)
}

writeFileSync(catalogPath, JSON.stringify(catalog, null, 1) + '\n')
writeFileSync(join(outDir, 'CREDITS.txt'),
  'Tilesets: LimeZu — Modern Interiors (versão full).\n' +
  'https://limezu.itch.io/moderninteriors\n' +
  'Uso permitido em projeto comercial; redistribuição do asset proibida. Créditos obrigatórios.\n')
rmSync(tmp, { recursive: true, force: true })
console.log(`Catálogo com ${catalog.length} tilesets em ${catalogPath}`)

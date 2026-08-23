// Baixa as ilustrações 3D dos selos do CDN do 3dicons.co (CC0) para
// apps/web/public/badge-art/<key>.png. As chaves são extraídas do catálogo em
// src/lib/badge-art.ts, então o script e o catálogo nunca saem de sincronia.
//
// Uso: node apps/web/scripts/fetch-badge-art.mjs
//
// Estilo: front/color (de frente e centralizado, 800px). Padrão de URL:
//   https://3dicons.sgp1.cdn.digitaloceanspaces.com/v1/<angle>/<color>/<src>-<angle>-<color>.png
// Ângulos disponíveis no 3dicons: front | dynamic | iso.

import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ANGLE = 'front'
const COLOR = 'color'

// Chave do catálogo -> nome do arquivo no 3dicons, quando diferem.
const SOURCE_OVERRIDE = { shield: 'sheild' }

const catalog = await readFile(join(root, 'src/lib/badge-art.ts'), 'utf8')
// Chaves `fe-*` vêm do Fluent Emoji (scripts/fetch-fluent-emoji.mjs), não do 3dicons.
const keys = [...catalog.matchAll(/art\('([a-z0-9-]+)'/g)].map((m) => m[1]).filter((k) => !k.startsWith('fe-'))

const outDir = join(root, 'public/badge-art')
await mkdir(outDir, { recursive: true })

let ok = 0
const failed = []
for (const key of keys) {
  const src = SOURCE_OVERRIDE[key] ?? key
  const url = `https://3dicons.sgp1.cdn.digitaloceanspaces.com/v1/${ANGLE}/${COLOR}/${src}-${ANGLE}-${COLOR}.png`
  try {
    const res = await fetch(url)
    if (!res.ok) {
      failed.push(`${key} (HTTP ${res.status})`)
      continue
    }
    const buf = Buffer.from(await res.arrayBuffer())
    await writeFile(join(outDir, `${key}.png`), buf)
    ok++
    console.log(`✓ ${key}.png (${buf.length} bytes)`)
  } catch (err) {
    failed.push(`${key} (${err.message})`)
  }
}

console.log(`\n${ok}/${keys.length} baixados em public/badge-art/`)
if (failed.length) {
  console.log(`Falharam: ${failed.join(', ')}`)
  console.log('Ajuste a chave no catálogo ou adicione um SOURCE_OVERRIDE.')
  process.exit(1)
}

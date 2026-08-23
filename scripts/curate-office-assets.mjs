// scripts/curate-office-assets.mjs
//
// Ferramenta de curadoria do catálogo de assets do escritório (dev, pontual).
// Transforma um tileset builtin (spritesheet crua) em assets NOMEADOS e
// colocáveis na paleta de mobília — detecta os objetos por pixel, você revisa
// num contact sheet e nomeia, e funde no catálogo.
//
// Uso:
//   node scripts/curate-office-assets.mjs detect <sheet>   → detecta + gera contact sheet e rascunho
//   node scripts/curate-office-assets.mjs merge  <sheet>   → funde o rascunho revisado no catálogo
//
// <sheet> = nome-base do tileset builtin (ex.: modern-office, livingroom).
// A detecção roda na variante 48px; as coordenadas (col/row/cols/rows) são de
// TILE e valem para os 3 tamanhos (16/32/48).
//
// Fluxo:
//   1. Coloque o PNG em apps/web/public/office/tilesets/<sheet>-{16,32,48}.png
//      e registre o sheet em packages/shared/src/office-tileset-catalog.json.
//   2. `detect <sheet>` — abra scripts/.office-assets/<sheet>.contact.png e
//      revise. Edite scripts/.office-assets/<sheet>.draft.json: preencha
//      category/name de cada objeto bom; APAGUE lixo/fragmentos; para uma
//      fileira de N iguais, duplique a linha deslocando `col`.
//   3. `merge <sheet>` — valida e substitui as entradas daquele sheet no
//      catálogo, e gera uma verificação em scripts/.office-assets/<sheet>.verify.png.
//   4. `pnpm --filter @legends/shared test office-asset-catalog` — gate final.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TILESET_CATALOG = join(ROOT, 'packages/shared/src/office-tileset-catalog.json')
const ASSET_CATALOG = join(ROOT, 'packages/shared/src/office-asset-catalog.json')
const WORK = join(ROOT, 'scripts/.office-assets')
const T = 48

function fail(message) {
  console.error(`erro: ${message}`)
  process.exit(1)
}

function sheetMeta(base) {
  const catalog = JSON.parse(readFileSync(TILESET_CATALOG, 'utf8'))
  const entry = catalog.find((e) => e.tileWidth === 48 && e.assetId.split('/').pop() === `${base}-48`)
  if (!entry) fail(`sheet "${base}" não encontrado no tileset-catalog (variante 48px)`)
  return {
    png: join(ROOT, 'apps/web/public', entry.url),
    cols: entry.columns,
    rows: entry.tileCount / entry.columns,
  }
}

/** Detecta objetos por componentes conexos de pixel (alpha), encaixados na grade. */
async function detectBoxes(png, gridCols, gridRows) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H, channels } = info
  const mask = new Uint8Array(W * H)
  for (let i = 0; i < W * H; i++) mask[i] = data[i * channels + 3] > 12 ? 1 : 0

  const label = new Int32Array(W * H).fill(-1)
  const stack = new Int32Array(W * H)
  const comps = []
  for (let start = 0; start < W * H; start++) {
    if (!mask[start] || label[start] >= 0) continue
    let sp = 0
    stack[sp++] = start
    label[start] = comps.length
    let minX = W, minY = H, maxX = 0, maxY = 0, count = 0
    while (sp > 0) {
      const p = stack[--sp]
      const x = p % W
      const y = (p / W) | 0
      count++
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
          const np = ny * W + nx
          if (mask[np] && label[np] < 0) {
            label[np] = label[start]
            stack[sp++] = np
          }
        }
      }
    }
    if (count < 60) continue
    comps.push({
      col: Math.floor(minX / T),
      row: Math.floor(minY / T),
      cols: Math.ceil((maxX + 1) / T) - Math.floor(minX / T),
      rows: Math.ceil((maxY + 1) / T) - Math.floor(minY / T),
    })
  }

  // Funde caixas cuja bbox de tiles se sobrepõe (partes do mesmo objeto
  // separadas por gap transparente, ex.: tampo + pernas).
  const overlap = (a, b) =>
    a.col < b.col + b.cols && b.col < a.col + a.cols && a.row < b.row + b.rows && b.row < a.row + a.rows
  let merged = true
  let boxes = comps
  while (merged) {
    merged = false
    const out = []
    const used = new Array(boxes.length).fill(false)
    for (let i = 0; i < boxes.length; i++) {
      if (used[i]) continue
      let a = { ...boxes[i] }
      for (let j = i + 1; j < boxes.length; j++) {
        if (used[j] || !overlap(a, boxes[j])) continue
        const b = boxes[j]
        const c0 = Math.min(a.col, b.col)
        const r0 = Math.min(a.row, b.row)
        a = {
          col: c0,
          row: r0,
          cols: Math.max(a.col + a.cols, b.col + b.cols) - c0,
          rows: Math.max(a.row + a.rows, b.row + b.rows) - r0,
        }
        used[j] = true
        merged = true
      }
      out.push(a)
    }
    boxes = out
  }

  return boxes
    .filter((b) => b.cols * b.rows <= 30 && b.col + b.cols <= gridCols && b.row + b.rows <= gridRows)
    .sort((a, b) => a.row - b.row || a.col - b.col)
}

/** Monta um contact sheet: cada célula é um objeto recortado + rótulo. */
async function renderContactSheet(png, boxes, outPath, labelFor) {
  const CELL = 190
  const PAD = 26
  const COLS = 5
  const rowsN = Math.max(1, Math.ceil(boxes.length / COLS))
  const width = COLS * CELL
  const height = rowsN * CELL

  const composites = []
  const svgParts = [`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`]
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]
    const cx = (i % COLS) * CELL
    const cy = ((i / COLS) | 0) * CELL
    const sw = b.cols * T
    const sh = b.rows * T
    const scale = Math.min((CELL - 12) / sw, (CELL - PAD - 6) / sh, 6)
    const dw = Math.max(1, Math.round(sw * scale))
    const dh = Math.max(1, Math.round(sh * scale))
    const thumb = await sharp(png)
      .extract({ left: b.col * T, top: b.row * T, width: sw, height: sh })
      .resize(dw, dh, { kernel: 'nearest' })
      .png()
      .toBuffer()
    composites.push({ input: thumb, left: cx + ((CELL - dw) / 2) | 0, top: cy + PAD + ((CELL - PAD - dh) / 2) | 0 })
    const label = labelFor(b, i)
    svgParts.push(
      `<rect x="${cx}" y="${cy}" width="${CELL - 1}" height="${CELL - 1}" fill="none" stroke="#5a5f78"/>`,
      `<text x="${cx + 4}" y="${cy + 13}" font-family="monospace" font-size="11" fill="#ffff78">${escapeXml(label.top)}</text>`,
      `<text x="${cx + 4}" y="${cy + CELL - 6}" font-family="monospace" font-size="11" fill="#96c8ff">${b.col},${b.row} ${b.cols}x${b.rows}</text>`,
    )
  }
  svgParts.push('</svg>')

  await sharp({ create: { width, height, channels: 4, background: { r: 28, g: 31, b: 43, alpha: 1 } } })
    .composite([...composites, { input: Buffer.from(svgParts.join('')), left: 0, top: 0 }])
    .png()
    .toFile(outPath)
}

function escapeXml(s) {
  return String(s).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c])
}

function slug(name) {
  return (
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'item'
  )
}

async function detect(base) {
  const meta = sheetMeta(base)
  mkdirSync(WORK, { recursive: true })
  const boxes = await detectBoxes(meta.png, meta.cols, meta.rows)
  writeFileSync(join(WORK, `${base}.boxes.json`), JSON.stringify(boxes, null, 2))
  const draft = boxes.map((b) => ({ category: 'TODO', name: 'TODO', ...b }))
  writeFileSync(join(WORK, `${base}.draft.json`), JSON.stringify(draft, null, 2))
  await renderContactSheet(meta.png, boxes, join(WORK, `${base}.contact.png`), (_b, i) => ({ top: `#${i}` }))
  console.log(`detect ${base}: ${boxes.length} objetos`)
  console.log(`  revise:  ${join(WORK, `${base}.contact.png`)}`)
  console.log(`  edite:   ${join(WORK, `${base}.draft.json`)}  (preencha category/name; apague lixo; splite fileiras)`)
  console.log(`  depois:  node scripts/curate-office-assets.mjs merge ${base}`)
}

async function merge(base) {
  const meta = sheetMeta(base)
  const draftPath = join(WORK, `${base}.draft.json`)
  let draft
  try {
    draft = JSON.parse(readFileSync(draftPath, 'utf8'))
  } catch {
    fail(`rascunho não encontrado — rode "detect ${base}" primeiro (${draftPath})`)
  }

  const kept = []
  const seen = new Set()
  let skipped = 0
  for (const a of draft) {
    const category = String(a.category ?? '').trim()
    const name = String(a.name ?? '').trim()
    const col = Number(a.col)
    const row = Number(a.row)
    const cols = Number(a.cols)
    const rows = Number(a.rows)
    if (!category || !name || category === 'TODO' || name === 'TODO') {
      skipped++
      continue
    }
    if (
      !Number.isInteger(col) || !Number.isInteger(row) || cols < 1 || rows < 1 ||
      col < 0 || row < 0 || col + cols > meta.cols || row + rows > meta.rows
    ) {
      console.warn(`  ignorado (região inválida): ${name} @ ${col},${row} ${cols}x${rows}`)
      skipped++
      continue
    }
    let id = `${base}/${slug(name)}`
    let n = 2
    while (seen.has(id)) id = `${base}/${slug(name)}-${n++}`
    seen.add(id)
    kept.push({ id, sheet: base, category, name, col, row, cols, rows })
  }

  if (kept.length === 0) {
    fail(
      `nenhum asset válido no rascunho (${skipped} ignorados) — preencha category/name em ${draftPath} antes do merge. ` +
        `Abortado para não apagar as entradas existentes de "${base}" no catálogo.`,
    )
  }

  const catalog = JSON.parse(readFileSync(ASSET_CATALOG, 'utf8'))
  const others = catalog.filter((a) => a.sheet !== base)
  const next = [...others, ...kept]
  const body = next.map((a) => '  ' + JSON.stringify(a)).join(',\n')
  writeFileSync(ASSET_CATALOG, `[\n${body}\n]\n`)
  await renderContactSheet(meta.png, kept, join(WORK, `${base}.verify.png`), (_b, i) => ({ top: kept[i].name.slice(0, 22) }))
  console.log(`merge ${base}: ${kept.length} assets adicionados, ${skipped} ignorados. Total no catálogo: ${next.length}`)
  console.log(`  verifique: ${join(WORK, `${base}.verify.png`)}`)
  console.log(`  gate:      pnpm --filter @legends/shared test office-asset-catalog`)
}

/** Renderiza um contact sheet do catálogo ATUAL (nome + categoria), por sheet, para revisão. */
async function verify(base) {
  const catalog = JSON.parse(readFileSync(ASSET_CATALOG, 'utf8'))
  const bases = base === 'all' ? [...new Set(catalog.map((a) => a.sheet))] : [base]
  mkdirSync(WORK, { recursive: true })
  for (const sheet of bases) {
    const meta = sheetMeta(sheet)
    const assets = catalog.filter((a) => a.sheet === sheet)
    if (assets.length === 0) {
      console.log(`verify ${sheet}: (sem assets)`)
      continue
    }
    const out = join(WORK, `${sheet}.verify.png`)
    await renderContactSheet(meta.png, assets, out, (_b, i) => ({ top: `#${i} ${assets[i].name}`.slice(0, 26) }))
    console.log(`verify ${sheet}: ${assets.length} assets → ${out}`)
  }
}

const [cmd, base] = process.argv.slice(2)
if (!base || (cmd !== 'detect' && cmd !== 'merge' && cmd !== 'verify')) {
  console.log('uso: node scripts/curate-office-assets.mjs <detect|merge|verify> <sheet|all>')
  process.exit(1)
}
if (cmd === 'detect') await detect(base)
else if (cmd === 'merge') await merge(base)
else await verify(base)

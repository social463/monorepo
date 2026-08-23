// Vendoriza o fileset WASM do @mediapipe/tasks-vision (dependência transitiva
// do @livekit/track-processors, usada pelos processors de fundo virtual da
// câmera) para apps/web/public/mediapipe-vision/. Objetivo: servir o WASM pelo
// próprio host (nginx) em vez do CDN jsdelivr default do pacote — ver
// docs/superpowers/specs/2026-07-16-camera-fundo-virtual-design.md ("Casos de
// borda"). O MODELO de segmentação (.tflite) não é vendorizado aqui: ele não
// faz parte de nenhum pacote instalado localmente, é baixado em runtime do
// Google Cloud Storage (self-host do modelo ficaria fora de escopo — exigiria
// baixar e commitar um binário externo ao grafo de dependências do pnpm).
//
// Uso: node apps/web/scripts/vendor-mediapipe-assets.mjs
//
// @mediapipe/tasks-vision não é dependência direta do apps/web (entra via
// @livekit/track-processors), então não fica hoisted em node_modules/ — o
// caminho é resolvido a partir do próprio pacote do track-processors.
import { readdirSync, copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

const trackProcessorsPkg = require.resolve('@livekit/track-processors/package.json', { paths: [root] })
const wasmDir = join(dirname(trackProcessorsPkg), '..', '..', '@mediapipe', 'tasks-vision', 'wasm')

const outDir = join(root, 'public', 'mediapipe-vision')
mkdirSync(outDir, { recursive: true })

const files = readdirSync(wasmDir)
for (const file of files) {
  copyFileSync(join(wasmDir, file), join(outDir, file))
  console.log(`✓ ${file}`)
}
console.log(`\n${files.length} arquivos vendorizados em public/mediapipe-vision/ (origem: ${wasmDir})`)

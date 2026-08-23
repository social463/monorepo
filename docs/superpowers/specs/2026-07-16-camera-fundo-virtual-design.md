# Blur e fundos virtuais na câmera — Design

**Data:** 2026-07-16
**Status:** Aprovado
**Branch:** `feat/camera-fundo-virtual` (a partir da main; ver "Convergência com o PiP")

## Objetivo

Permitir que o usuário aplique desfoque ou uma imagem de fundo na própria câmera
do escritório virtual. O efeito vale para o vídeo **publicado** — todos os
participantes veem o fundo virtual, não só o próprio usuário.

## Decisões de produto

- **Opções:** Nenhum · Blur leve · Blur forte · **Fundo EMR** — a galeria tem
  UMA imagem fixa: o fundo institucional do Eu Médico Residente (verde-escuro
  com o logo e os valores da empresa, 1600×900, fornecido pelo usuário).
  **Sem upload** de imagem própria.
- **UI:** o botão de câmera da MediaBar vira split button — o clique principal
  continua ligando/desligando a câmera; uma setinha ao lado abre o painel
  `CameraBackgroundMenu` (mesmo estilo do menu de reações), com check na opção
  ativa. O preview é a própria câmera nos elementos já existentes (balão/tile).
- **Persistência:** `localStorage` (`legends:camera-background`), por
  navegador/dispositivo. Restaurada no load e aplicada ao ligar a câmera.
- **Escolha com câmera desligada:** só guarda; aplica quando ligar.

## Abordagem

**`@livekit/track-processors` oficial** (LiveKit v2): `BackgroundProcessor({ mode:
'background-blur' | 'virtual-background', ... })` aplicado no `LocalVideoTrack`
via `track.setProcessor()` / `stopProcessor()` (ver "Casos de borda" — a Task 5
trocou os helpers legados `BackgroundBlur`/`VirtualBackground` por essa função
porque só ela aceita `assetPaths` para o self-host do WASM). Raios do blur:
leve = 5, forte = 15. Alternativas descartadas: pipeline próprio de
segmentação (muito código para o mesmo resultado) e blur via CSS (afeta só a
visualização local — não atende o requisito).

O pacote (WASM do MediaPipe, pesado) entra por **`import()` dinâmico** — só
baixa quando alguém usa um efeito pela primeira vez. Nada dele pode entrar no
bundle principal nem no chunk base do escritório.

## Arquitetura

### Hook `useCameraBackground`

`apps/web/src/office/media/useCameraBackground.ts`, chamado ao lado do
`useOfficeMedia` (recebe `media.localCameraTrack`). Expõe:

```ts
type CameraBackgroundId = 'none' | 'blur-leve' | 'blur-forte' | `img:${string}`

interface CameraBackgroundState {
  background: CameraBackgroundId
  setBackground(id: CameraBackgroundId): void
  supported: boolean
  error: boolean
}
```

- Aplica/troca/remove o processor no track atual; **reaplica automaticamente**
  quando `localCameraTrack` muda de identidade (religar a câmera publica um
  track novo) — a escolha sobrevive ao liga/desliga.
- Feature-detect com `supportsBackgroundProcessors()` do pacote →
  `supported: false` em browsers sem WebGL/GPU adequados; nesse estado o hook
  nunca tenta aplicar nada.
- Falha ao aplicar (WASM não carregou, GPU falhou): `error: true`, escolha
  volta a `'none'`.

### Galeria

Catálogo fixo em `apps/web/src/office/media/camera-backgrounds.ts`
(`{ id, label, src }[]`) com uma entrada: `emr` → "Fundo EMR", imagem em
`apps/web/public/office/camera-backgrounds/emr.jpg` (fornecida pelo usuário;
a miniatura no menu usa a própria imagem reduzida via CSS). O catálogo fica
como lista para acrescentar imagens no futuro sem mudar o resto.

### UI

`CameraBackgroundMenu` em `apps/web/src/office/media/CameraBackgroundMenu.tsx`;
integração na `MediaBar` (split button na câmera). Erros seguem o padrão das
pills da MediaBar ("Não foi possível aplicar o fundo").

## Casos de borda

- **Sem suporte:** setinha desabilitada com `title` "Seu navegador não suporta
  efeitos de fundo".
- **Assets do MediaPipe (self-host parcial):** `BackgroundProcessorOptions`
  (`.d.ts` do `@livekit/track-processors@0.7.2`) expõe
  `assetPaths?: { tasksVisionFileSet?: string; modelAssetPath?: string }` —
  mas só na função nova `BackgroundProcessor(options, name?)`; os helpers
  legados `BackgroundBlur`/`VirtualBackground` (usados até a Task 4) **não**
  aceitam `assetPaths` em nenhum dos seus parâmetros (`blurRadius`/`imagePath`,
  `segmenterOptions`, `onFrameProcessed`, `processorOptions: ProcessorWrapperOptions`
  — este último só tem `maxFps`; confirmado também no `index.mjs` compilado,
  onde os dois helpers chamam o `BackgroundProcessor` interno sem repassar
  `assetPaths`). Por isso a Task 5 trocou as chamadas do hook de
  `processors.BackgroundBlur(raio)` / `processors.VirtualBackground(src)` para
  `processors.BackgroundProcessor({ mode: 'background-blur', blurRadius, assetPaths })`
  / `processors.BackgroundProcessor({ mode: 'virtual-background', imagePath, assetPaths })`.
  - **`tasksVisionFileSet` (self-host aplicado):** o fileset WASM do
    `@mediapipe/tasks-vision` (`vision_wasm_internal.{js,wasm}` e a variante
    `nosimd`, ~19 MB) é dependência transitiva já presente em
    `node_modules/@mediapipe/tasks-vision/wasm` — vendorizado via
    `apps/web/scripts/vendor-mediapipe-assets.mjs` para
    `apps/web/public/mediapipe-vision/` (commitado) e servido pelo nginx como
    estático (mesma regra `location /` que já serve `/office/*`). Constante
    `MEDIAPIPE_ASSETS_PATH = '/mediapipe-vision'` no hook. Sem essa troca, o
    fileset viria do CDN default (`cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@.../wasm`).
  - **`modelAssetPath` (continua no CDN, self-host fora de escopo):** o
    modelo de segmentação (`selfie_segmenter.tflite`, formato float16) **não**
    é vendorizável do jeito acima — não é parte de nenhum pacote instalado
    localmente (não existe `.tflite` em `node_modules`); o pacote sempre o
    busca em runtime de `https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite`
    (default hard-coded, visto no `index.mjs` compilado). Vendorizar exigiria
    baixar e commitar um binário externo ao grafo de dependências do pnpm
    (sem hash/versão pinada por lockfile) — fora do escopo desta task. O hook
    deixa `assetPaths.modelAssetPath` **não definido**, então o pacote usa
    esse default do Google. Resultado: primeira aplicação de um efeito baixa
    o fileset WASM do próprio host, mas o modelo `.tflite` continua vindo do
    CDN do Google.
- **Screen share:** não é afetado — processor só no track de câmera.
- **Convergência com o PiP (feita):** com o PiP mergeado na main, o
  `useCameraBackground` mora no `OfficeSessionProvider` (não na página) e o
  `cameraBackground` é exposto pelo contexto — necessário porque no PiP a
  câmera pode ser religada com a `OfficePage` desmontada, e o track novo
  precisa receber o processor de volta.

## Testes

- `useCameraBackground.test.ts` — track fake (`setProcessor`/`stopProcessor`
  mockados) e pacote de processors mockado: aplica/remove/troca; reaplica em
  track novo; persiste/restaura localStorage; erro → volta a `'none'`;
  `supported: false` nunca aplica.
- `CameraBackgroundMenu.test.tsx` — render das opções, seleção chama
  `setBackground`, check na ativa, estado desabilitado sem suporte.
- `MediaBar.test.tsx` — split button preserva o toggle de câmera existente.

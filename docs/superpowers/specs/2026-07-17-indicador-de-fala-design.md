# Design — Indicador visual de "está falando"

**Data:** 2026-07-17
**Branch:** a definir (feature isolada, mas toca `OfficeScene.ts`, ver nota de bloqueio abaixo)

## Problema

Hoje, quando alguém fala no chat de voz do escritório (câmera/áudio, LiveKit),
não existe nenhum feedback visual de que a voz está saindo — nem para quem
fala (saber que o mic está captando) nem para quem ouve (identificar quem
está falando). Isso vale tanto dentro do grid de vídeo (estilo Google Meet)
quanto no escritório em si, com os personagens andando pelo mapa (Phaser).

Aproveitando a mudança, o avatar dentro do grid fullscreen hoje estica a
imagem para preencher todo o quadrado do tile (`object-cover` numa área
retangular cheia), o que deixa a foto pixelizada/esticada — vira também uma
oportunidade de alinhar visualmente com o círculo usado na página de perfil.

## Decisões de escopo (validadas com o usuário)

- **Onde o indicador de fala aparece no escritório (fora do grid):** para
  **qualquer personagem com o microfone ativo**, no escritório inteiro — não
  só para quem está na mesma sala de áudio por proximidade que o usuário
  atual.
- **Círculo no grid:** só no **grid fullscreen** (Meet-style, `MediaTiles.tsx`
  com `expanded`/`showAllPresent`). Sidebar e modo com destaque (spotlight)
  não mudam nesta feature.
- **Estilo das ondas no grid:** anéis concêntricos escalonados — nascem
  colados no avatar, expandem para fora e somem, com 2–3 anéis em sequência
  (efeito "pedra na água"), não um anel único pulsante nem um halo difuso.
- **Botão de mic da `MediaBar`:** também pulsa quando o usuário local está
  falando, independente do grid estar aberto ou fechado — cobre o caso de
  "saber que minha voz está saindo" em qualquer tela do escritório.
- **Granularidade:** puramente booleano (fala / não fala), sem modular a
  animação pelo nível de volume — mantém a implementação simples (CSS/Tween
  em loop, sem re-render a cada frame de áudio).
- **Indicador de "mic aberto" (mesmo sem falar):** ícone fixo no canto do
  tile do grid, sempre visível, mostrando o estado atual do microfone
  daquela pessoa (aberto ou mudo) — independente de estar falando no
  momento. É um indicador de **estado**, distinto das ondas (que são de
  **atividade**).
- **Sinal sonoro de proximidade:** toca uma vez, no momento exato em que o
  usuário entra na zona de áudio de outra pessoa (transição, não enquanto
  permanece nela) — um aviso pontual de que a conversa passou a ser
  possível, não um som contínuo/ambiente.

## Bloqueio conhecido — não relacionado a esta feature

O repositório está com um **merge em andamento e não resolvido** na branch
atual (`feat/confete-escritorio` ← `origin/feat/confete-escritorio`), com
conflitos pendentes em `apps/web/src/office/scenes/OfficeScene.ts` (linhas
146-152, 418-442, 598-611), `apps/api/src/lib/office-hub.ts` e
`packages/shared/src/office.ts` — os três exatamente entre os arquivos que
esta feature precisa editar. O usuário está ciente e vai resolver o merge por
conta própria antes da implementação. **Este spec descreve o design; a
implementação só deve tocar `OfficeScene.ts`/`office.ts` depois que o merge
estiver limpo**, revalidando os números de linha citados aqui (eles podem
mudar depois da resolução dos conflitos).

## Fatos verificados do código (antes do merge acima)

- Áudio/vídeo é 100% LiveKit (`livekit-client`), carregado sob demanda em
  `apps/web/src/office/media/livekit-loader.ts`. `useOfficeMedia.ts`
  (`apps/web/src/office/media/useOfficeMedia.ts`) possui o `Room` (`roomRef`),
  entra em "salas" por posição/proximidade (`officeRoomForMapPosition`,
  `officeOpenRoom`), controla `LocalAudioTrack`/`LocalVideoTrack` e os estados
  `micEnabled`/`cameraEnabled`. Não existe hoje nenhuma detecção de fala
  (nem `AnalyserNode`, nem uso da API `ActiveSpeakersChanged`/`isSpeaking`
  já nativa do LiveKit).
- `participant.identity` (LiveKit) já é **igual** ao `userId` usado em todo o
  resto do escritório (bridge, `OfficeScene`) — confirmado em
  `useOfficeMedia.ts` (`occupantsRef.current.find((o) => o.userId ===
  participant.identity)`). É a chave natural para cruzar "quem fala" com
  "qual personagem/tile".
- **Grid** (`apps/web/src/office/media/MediaTiles.tsx`): `buildTiles()`
  (linha ~88) monta um `Tile[]` com `kind: 'camera' | 'screen' | 'avatar'` e
  `key` no formato `avatar:${userId}` / `cam:${userId}` / `'local'`. O grid
  fullscreen usa `gridTemplateColumns/Rows` calculado por
  `Math.ceil(Math.sqrt(tiles.length))`.
  `AvatarTile` (linha ~49-74) hoje renderiza:
  ```tsx
  <div className={`flex items-center justify-center overflow-hidden rounded-md bg-surface-container-highest ${
    fill ? 'h-full w-full' : 'aspect-square w-full'
  }`}>
    <Avatar user={user} .../>
  </div>
  ```
  No modo `fill` (usado no grid fullscreen), o container vira `h-full w-full`
  do tile — retangular, não necessariamente quadrado — e a imagem dentro
  (`Avatar.tsx`, `<img className="h-full w-full object-cover ...">`) estica
  para preencher esse retângulo inteiro, causando o esticamento/pixelização.
- **Perfil** (`apps/web/src/pages/ProfilePage.tsx`, linha ~182): padrão de
  referência a replicar —
  ```tsx
  <div className="flex h-32 w-32 items-center justify-center overflow-hidden rounded-full border-4 border-primary bg-surface-container-highest md:h-36 md:w-36">
  ```
  Dimensão fixa quadrada + `rounded-full`, garantindo círculo perfeito.
- **MediaBar** (`apps/web/src/office/media/MediaBar.tsx`): botão de mic/câmera
  sempre visível, com label de status ("Áudio por proximidade").
- **Bridge React ↔ Phaser** (`apps/web/src/office/OfficeBridge.ts`): pub/sub
  simples, não usa registry/eventos nativos do Phaser.
  - `onServerMessage`/`emitServerMessage` — mensagens vindas do servidor
    (`OfficeServerMessage`: `welcome`, `joined`, `left`, `moved`, `sync`,
    `avatar-updated`, `nearby-message`, `confetti`, `celebration`,
    `desk-claimed/released`).
  - `onClientMessage`/`emitClientMessage` — canal **React → cena**, hoje
    usado por chamadas e "Seguir". É o canal certo para o estado de fala:
    é 100% local ao navegador (cada cliente calcula sua própria visão de
    "quem fala" a partir do LiveKit), não precisa ir pro servidor.
- **`OfficeScene.ts`**: `characters = new Map<string, CharacterView>()`
  (chave = `userId`). `spawn()` cria `body` + `label` (nome, só primeiro
  nome, `add.text` branco sem fundo, offset `y: 18` abaixo da origem do
  personagem) — chamado só em `welcome`/`joined` (join/reconexão), não por
  frame. O padrão a reaproveitar para atualizar um personagem já spawnado
  **sem respawn** é o de `confettiEmitters`/`setConfetti()`: faz
  `characters.get(userId)`, e anexa/desanexa um `GameObject` extra no
  `container` daquele personagem.
- **Labels de mesa** (`deskLabels`, cor `#fbbf24` ocupada / `#9ca3af` livre)
  são um sistema separado do label de nome do personagem — não mudam nesta
  feature.
- **Ícones** (`apps/web/src/components/Icon.tsx`): não é SVG/lucide — é um
  wrapper fino sobre a fonte de ícones **Material Symbols Outlined**
  (`<span className="material-symbols-outlined">{name}</span>`, prop
  `filled` alterna `fontVariationSettings: "'FILL' 1"`). `MediaBar.tsx`
  (linha ~244) já usa `<Icon name={media.micEnabled ? 'mic' : 'mic_off'} .../>`
  — os mesmos glifos (`mic`/`mic_off`) servem para o badge novo no tile do
  grid, sem precisar de asset novo.
- **Zona de proximidade — ponto de transição** (`useOfficeMedia.ts`): o mapa
  de posição é traduzido em sala desejada por `officeRoomForMapPosition`
  (linha ~115) e `officeOpenRoom` (linha ~117); um efeito de debounce
  (linhas ~120-124) só "comita" a sala em `stableRoom` depois de
  `ROOM_STABILITY_MS` na mesma sala desejada (evita flicker ao passar
  raspando por uma borda). O ponto real de **transição** (dispara uma vez
  por mudança de `stableRoom`, não a cada render) é o efeito nas linhas
  ~320-354, que chama `void connectTo(stableRoom)` (linha 353). Dentro de
  `connectTo` (linhas 185-318), a conexão bem-sucedida acontece nas linhas
  ~269-272, logo após `await room.connect(...)` (linha 263) resolver e a
  checagem de geração (linhas 264-267) passar. `applyProximity` (linhas
  ~171-183) é diferente: só ajusta inscrição de participantes numa sala já
  aberta por distância contínua — não representa uma transição de entrada,
  então não é o ponto certo para o som (mas é o ponto certo para qualquer
  coisa "enquanto perto", caso um dia precise).
- **Som de efeito já existente** (`apps/web/src/office/media/applause-sound.ts`):
  padrão estabelecido a seguir — asset em `apps/web/public/sounds/*.mp3`,
  `HTMLAudioElement` singleton em nível de módulo, criado sob demanda,
  função exportada (`playApplauseSound()`) que reseta `volume`/`currentTime`
  e chama `audio.play().catch(() => {})` (falha engolida, som é
  best-effort/opcional).

## Arquitetura

### 1. Detecção de fala (`useOfficeMedia.ts`)

Assina `room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => ...)` (LiveKit
nativo — inclui participante local e remotos). Mantém um
`speakingIdentities: Set<string>` em estado do hook, atualizado a cada
evento, e expõe:
- `localSpeaking: boolean` (deriva de `speakingIdentities.has(localParticipant.identity)`).
- Em `RemoteMedia`, um campo novo `speaking: boolean` por ocupante remoto.

A cada mudança do set, chama `bridge.emitSpeakingChanged({ userId, speaking })`
para cada identidade que mudou de estado (entrou ou saiu de
`speakingIdentities`) — mantém o Phaser sincronizado sem depender do
servidor.

### 2. Protocolo local (`OfficeBridge.ts`)

**Correção em relação à primeira versão deste spec:** `OfficeBridge.onClientMessage`/
`emitClientMessage` **não é local** — `useOfficeSocket.ts` reenvia toda
mensagem desse canal direto pro WebSocket do servidor
(`bridge.onClientMessage((message) => ws.send(JSON.stringify(message)))`).
Estender `OfficeClientMessage` com `speaking-changed` mandaria o evento pra
rede à toa (o servidor não tem handler pra isso, e não precisa ter — cada
navegador já calcula sua própria visão de quem fala via LiveKit). Em vez
disso, `OfficeBridge` ganha um par local dedicado, no mesmo estilo de
`onCharacterClick`/`emitCharacterClick` (Set de handlers, sem rede):

```ts
onSpeakingChanged(handler: Handler<{ userId: string; speaking: boolean }>): () => void
emitSpeakingChanged(payload: { userId: string; speaking: boolean }): void
```

### 3. Grid — avatar em círculo (`MediaTiles.tsx`)

Só quando o tile está no grid fullscreen (`fill === true`), o container do
`AvatarTile` deixa de esticar `h-full w-full` e passa a centralizar um
círculo de tamanho fixo relativo ao tile (ex.: `min(60%, 60%)` do lado do
quadrado, com um teto em px para tiles muito grandes), com `rounded-full`,
`overflow-hidden`, borda — mesmo padrão do `ProfilePage.tsx`. O modo não-fill
(sidebar/spotlight) mantém o comportamento atual (`rounded-md`,
`aspect-square`).

### 4. Grid — ondas ao falar (`AvatarTile`)

Quando `speaking` (via `RemoteMedia.speaking` ou `localSpeaking`) é
verdadeiro para aquele tile, renderiza 2–3 `div`s absolutamente posicionados
ao redor do círculo, cada um com uma animação CSS (`@keyframes`) de
scale (1 → ~1.4) + opacity (1 → 0), `animation-delay` escalonado entre eles
(ex.: 0ms/400ms/800ms), em loop infinito enquanto `speaking` for `true`. Cor
usa a cor primária do tema (mesma família usada em outros indicadores de
estado ativo do app). Sem `speaking`, os anéis não são renderizados (não só
escondidos via opacity 0, para não gastar ciclo de animação à toa).

### 5. Botão de mic (`MediaBar.tsx`)

Recebe `localSpeaking` do hook e aplica uma pulsação simples (um anel só,
sem múltiplas ondas) ao redor do ícone de mic quando `true` — independente
do grid estar `expanded` ou não.

### 6. Phaser — badge de nome (`OfficeScene.ts`, pós-merge)

O label de nome deixa de ser `add.text` sem fundo e passa a usar o suporte
nativo do `Text` style do Phaser (`backgroundColor` + `padding`), sem
precisar de um `Graphics` extra por personagem: fundo claro, texto escuro,
formato de "pill". Labels de mesa (`deskLabels`) não mudam.

### 7. Phaser — ondas discretas ao falar (`OfficeScene.ts`, pós-merge)

Assina `bridge.onSpeakingChanged(({ userId, speaking }) => ...)` em `create()`
(mesmo lugar das demais assinaturas do bridge — `onServerMessage`,
`onNearbyMessage`, `onClientMessage`), não um caso no `handle()` de mensagens
do servidor:
- **Liga** (`speaking: true`): `characters.get(userId)` → se existir, cria
  1–2 `Graphics` (círculo fino) ancorados atrás do badge de nome, com um
  `Tween` em loop (scale + alpha) — mesma ideia do grid, porém com menos
  anéis e amplitude menor (mais discreto), coerente com o pedido do usuário.
- **Desliga** (`speaking: false`): para o tween e destrói os objetos criados.
- Segue o padrão já usado por `setConfetti()` (lookup em `characters`,
  anexa/remove sem respawn) — **não mexe** em `spawn()`.
- Aplica-se a **qualquer personagem com mic ativo em todo o escritório**
  (não só quem está na mesma sala de áudio do usuário atual) — decisão de
  escopo já validada acima.

### 8. Grid — indicador persistente de mic aberto/mudo (`AvatarTile`)

Distinto das ondas de fala (que são de atividade momentânea), este é um
badge de **estado**: um ícone pequeno fixo no canto do círculo do avatar
(ex.: inferior-direito, sobre a borda), usando `<Icon name={micEnabled ?
'mic' : 'mic_off'} .../>` — mesmo padrão do `MediaBar.tsx`. Fica visível o
tempo todo que o tile existir no grid, independente de `speaking`. Precisa
que `RemoteMedia`/`local` exponham o booleano de mic (`micEnabled` já existe
no hook para o usuário local — para remotos, verificar se já existe
equivalente por participante ou se precisa expor via `RemoteMedia`).

### 9. Som de proximidade — "conversa possível" (`useOfficeMedia.ts`)

**Implementado com uma variação do padrão** (registrada aqui após a
implementação): em vez de um asset `.mp3` novo — não havia como sourcing um
som CC0 licenciado durante a implementação —, `proximity-sound.ts` sintetiza
dois tons curtos via Web Audio (`AudioContext`/`OscillatorNode`), sem
depender de um arquivo binário novo no repo. Mantém a mesma tolerância a
falha do padrão (`try/catch`, nunca quebra a conexão) e a mesma API externa
(`playProximitySound()`, singleton reaproveitado — aqui um `AudioContext`
em vez de um `HTMLAudioElement`). Disparado uma única vez no ponto de transição de
`connectTo` (linhas ~269-272 de `useOfficeMedia.ts`), logo após a conexão
LiveKit ser confirmada — ou seja, toca quando o usuário efetivamente entra
numa nova sala de proximidade, não a cada render enquanto permanece nela.
Não tem relação com quem está falando ou com mic aberto — é só sobre a
**zona** ter mudado (alguém entrou no alcance de áudio).

## Tratamento de erros / casos de borda

- Personagem sai do escritório (`left`) enquanto fala: `destroyCharacter`
  já remove o `container` inteiro (incluindo qualquer anel anexado) — sem
  necessidade de tratamento especial.
- `speaking-changed` chega para um `userId` que ainda não foi spawnado
  (corrida entre `joined` e o primeiro evento de fala): no-op — o
  `characters.get(userId)` retorna `undefined`, mensagem ignorada. Se o
  usuário já estiver falando quando spawnar depois, o próximo evento do
  LiveKit (`ActiveSpeakersChanged` já reporta o estado atual, não só
  transições) cobre o caso.
- Grid fecha (`expanded` vira `false`) enquanto alguém fala: como o grid
  some do DOM, as animações CSS somem junto — sem cleanup manual necessário.
- Tile sem `RemoteMedia.speaking` definido (occupante sem áudio habilitado):
  tratado como `false`.
- Som de proximidade falha ao tocar (autoplay bloqueado pelo navegador antes
  de qualquer interação do usuário, ex.: `NotAllowedError`): engolido via
  `.catch(() => {})`, igual ao aplauso — a experiência visual (grid, ondas)
  continua funcionando normalmente mesmo sem o som.
- Duas transições de sala em sequência rápida (ex.: passa por uma zona e
  sai antes do próximo debounce): cada `connectTo` bem-sucedido dispara o
  som uma vez — se isso soar repetitivo/spam na prática, é um ajuste de
  UX a validar depois de testar ao vivo (não bloqueia a implementação
  inicial).

## Testes

- `useOfficeMedia.test.ts`: unit test do mapeamento
  `ActiveSpeakersChanged` → `speakingIdentities`/`localSpeaking`/`RemoteMedia.speaking`.
- `MediaTiles.test.tsx`: estrutura do avatar circular no modo `fill`, classe/
  elemento de "ondas" presente só quando `speaking` é `true`, e badge de
  mic (`mic`/`mic_off`) refletindo o estado independente de `speaking`.
- `proximity-sound.ts`: se testado, seguir o padrão (se houver) de teste de
  `applause-sound.ts`; caso contrário, cobertura via teste de integração de
  `useOfficeMedia` verificando que `playProximitySound` é chamado uma vez
  por transição de `stableRoom` bem-sucedida (mock do módulo de som).
- `OfficeScene.ts` não tem suíte de teste unitário hoje (Phaser puro) —
  validação da badge/ondas do escritório é manual via `/verify` (subir
  web+api, duas abas/usuários, um fala e o outro observa grid + escritório).

## Fora de escopo

- Modular a animação pelo nível de volume (granularidade além de
  fala/não-fala).
- Mudar o círculo do avatar em outros contextos do grid (sidebar, spotlight).
- Qualquer alteração em `deskLabels` (labels de mesa).
- Resolver o merge pendente em `feat/confete-escritorio` — pré-requisito
  externo a esta feature, de responsabilidade do usuário.

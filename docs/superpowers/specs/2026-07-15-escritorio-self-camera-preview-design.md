# Escritório — self-preview da câmera

**Data:** 2026-07-15
**Status:** design aprovado (aguardando review do spec)
**Depende de:** `2026-07-14-escritorio-midia-design.md` (base de mídia/LiveKit)

## Problema

Hoje `MediaTiles` só renderiza tracks **remotos** (`useOfficeMedia().remotes`).
Quando você liga sua própria câmera não existe feedback visual nenhum de que
ela está ligada, nem enquadramento — nem no espaço aberto, nem numa sala de
reunião. Referência de UX: o WorkAdventure mostra um tile flutuante "Você"
com o próprio vídeo quando a câmera está ligada fora de uma sala.

## Escopo do v1

**Dentro:**
- Rastrear o `LocalVideoTrack` da câmera em `useOfficeMedia`.
- Tile flutuante e **arrastável** com o self-preview, visível **fora** de sala
  de reunião (espaço aberto), enquanto a câmera estiver ligada.
- Dentro de uma sala de reunião, seu próprio tile passa a aparecer também no
  grid do `MediaTiles`, junto com os `remotes`.
- Vídeo do self-preview **espelhado** (`scale-x-[-1]`), como todo app de
  vídeo — só o seu, tiles remotos continuam sem espelhar.

**Fora (deliberadamente):**
- Persistir posição do tile arrastável entre sessões/reloads.
- Botão de minimizar o preview independente de desligar a câmera — a única
  forma de tirar o tile de cena é desligando a câmera na `MediaBar`.
- Redimensionar o tile.
- Mudar qualquer coisa no comportamento de tiles remotos.

## Decisões de design

- **Local track vive em `useOfficeMedia`**, não em componente de UI — mesmo
  padrão já usado pra `screenShareEnabled`: escuta
  `RoomEvent.LocalTrackPublished`/`LocalTrackUnpublished` filtrando
  `Track.Source.Camera`, guarda o `LocalVideoTrack` em state e expõe em
  `OfficeMediaState`. Fonte única de verdade sobre "câmera ligada" continua
  sendo `cameraEnabled`; o track é só o que a UI precisa pra desenhar o
  `<video>`.
- **`OfficePage` decide onde o self-view aparece**, usando o mesmo `zoneName`
  que já existe (`zoneAt(you.x, you.y)?.name`): `zoneName === null` → espaço
  aberto → `SelfCameraPreview` flutuante; `zoneName !== null` → sala de
  reunião → tile no grid do `MediaTiles`. Evita duplicar o self-view nos dois
  lugares ao mesmo tempo.
- **Tile arrastável sem persistência.** Drag via pointer events no próprio
  componente, posição em state local, começa sempre no canto superior
  direito. Persistir entre sessões foi cortado do v1 — simplicidade primeiro,
  dá pra adicionar depois se fizer falta.
- **`LocalVideoTrack` e `RemoteVideoTrack` compartilham `.attach/.detach`** —
  o componente de vídeo interno do `MediaTiles` passa a aceitar a união dos
  dois tipos, em vez de criar um componente de vídeo paralelo.

## Arquitetura

### 1. `useOfficeMedia.ts` — rastrear track local de câmera

```ts
export interface OfficeMediaState {
  // ...existentes
  localCameraTrack: LocalVideoTrack | null
}
```

No `connectTo`, ao registrar os listeners da `Room`:

```ts
.on(RoomEvent.LocalTrackPublished, (pub) => {
  if (pub.source === Track.Source.ScreenShare) { /* existente */ }
  if (pub.source === Track.Source.Camera) {
    setLocalCameraTrack(pub.track as LocalVideoTrack)
  }
})
.on(RoomEvent.LocalTrackUnpublished, (pub) => {
  if (pub.source === Track.Source.ScreenShare) { /* existente */ }
  if (pub.source === Track.Source.Camera) {
    setLocalCameraTrack(null)
  }
})
```

`setCameraEnabled`/`setCameraError` em `toggleCamera` continuam do jeito que
estão — o evento é só quem alimenta o track pra UI. Reset de
`localCameraTrack` para `null` entra junto dos resets já existentes ao trocar
de sala (mesmo bloco que zera `cameraEnabled`, `screenShareEnabled` etc.).

### 2. `SelfCameraPreview.tsx` (novo)

```ts
function SelfCameraPreview({ track, name }: { track: LocalVideoTrack; name: string }): JSX.Element
```

- Card ~176×176px, `rounded-xl bg-black`, vídeo `object-cover w-full h-full`
  com `scale-x-[-1]` (espelhado).
- Badge no canto inferior esquerdo sobrepondo a borda: chip de iniciais
  (mesmo estilo do chip da `MediaBar`) + label "Você".
- Drag: `onPointerDown` no card captura o pointer (`setPointerCapture`),
  `onPointerMove` atualiza `{x, y}` em state, `onPointerUp` libera. Posição
  clampada aos limites da viewport (recalculado em `resize`). Estado
  **não** persiste — sempre nasce no canto superior direito
  (`top-4 right-4`, position fixed) a cada montagem.
- `useEffect` de `track.attach(videoEl)` / `track.detach(videoEl)` — mesmo
  padrão do `RemoteVideo` existente.
- `z-index` acima do canvas (`z-20`, mesma faixa da sidebar de pessoas),
  abaixo do `CharacterCard`/`IncomingCallPopup` (`z-30`/`z-40`).

### 3. `MediaTiles.tsx` — tile local no grid da sala

```ts
export function MediaTiles({
  remotes,
  local,
}: {
  remotes: RemoteMedia[]
  local?: { track: LocalVideoTrack; name: string } | null
})
```

- Componente de vídeo interno passa a aceitar `LocalVideoTrack | RemoteVideoTrack`
  (`attach`/`detach` são da interface `Track` comum aos dois).
- Quando `local` está presente, renderiza como **primeiro tile** da fileira,
  reaproveitando a mesma estrutura visual do tile de câmera remoto (mesma
  largura, `figcaption` com o nome), mas com `scale-x-[-1]` aplicado só nele.
- `hasVisible` passa a considerar `local` também, senão a faixa não aparece
  quando só você está com câmera ligada na sala.

### 4. `OfficePage.tsx` — wiring

```ts
const inMeetingRoom = zoneName !== null
const selfCamera =
  media.cameraEnabled && media.localCameraTrack
    ? { track: media.localCameraTrack, name: you?.name ?? 'Você' }
    : null

// grid da sala (dentro de reunião)
<MediaTiles remotes={media.remotes} local={inMeetingRoom ? selfCamera : null} />

// preview flutuante (espaço aberto)
{!inMeetingRoom && selfCamera && (
  <SelfCameraPreview track={selfCamera.track} name={selfCamera.name} />
)}
```

## Fluxos

1. **Liga câmera no espaço aberto** → `toggleCamera` publica o track →
   `LocalTrackPublished` popula `localCameraTrack` → `SelfCameraPreview`
   monta no canto superior direito.
2. **Anda até uma sala de reunião com a câmera ligada** → `zoneName` deixa de
   ser `null` → `SelfCameraPreview` desmonta, `MediaTiles` passa a incluir seu
   tile no grid junto dos `remotes` da sala.
3. **Desliga a câmera** (em qualquer lugar) → `cameraEnabled` vira `false` →
   `selfCamera` vira `null` → tile some (flutuante ou do grid, conforme onde
   estava).
4. **Arrasta o preview flutuante** → posição atualiza em tempo real, clampada
   à viewport; solta o pointer e ele fica ali até a próxima montagem
   (recarregar página, desligar/religar câmera, ou entrar numa sala).

## Erros e bordas

- **Câmera falha ao ligar** (`cameraError`) → `cameraEnabled` fica `false`,
  `localCameraTrack` nunca é setado — nenhum dos dois tiles aparece, mesmo
  comportamento de erro que já existe hoje na `MediaBar`.
- **Troca de sala com câmera ligada** → o reset de `localCameraTrack` para
  `null` no início do `connectTo` evita mostrar um frame congelado do track
  antigo (já desconectado) até o novo `LocalTrackPublished` chegar.
- **Resize da janela com preview arrastado pra um canto** → clamp recalcula
  no `resize`, preview nunca fica fora da viewport.

## Testes

- **`useOfficeMedia.test.ts`**: `localCameraTrack` populado por
  `LocalTrackPublished(Camera)`, zerado por `LocalTrackUnpublished(Camera)` e
  ao trocar de sala.
- **`MediaTiles.test.tsx`**: com `local` presente, tile próprio aparece
  primeiro na fileira com `scale-x-[-1]`; sem `local`, comportamento igual ao
  atual; `hasVisible` considera `local` sozinho (sem remotes) também.
- **`SelfCameraPreview.test.tsx`** (novo): renderiza vídeo com o track
  anexado; aplica espelhamento; posição inicial no canto superior direito;
  drag atualiza posição (simulando `pointerdown`/`pointermove`/`pointerup`).
- **Manual**: ligar câmera no espaço aberto → preview flutuante arrastável
  aparece; andar até sala de reunião com câmera ligada → preview some, tile
  aparece no grid; desligar câmera → some dos dois lugares.

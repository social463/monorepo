# Escritório — tiles de câmera no topo, com modo expandido

**Data:** 2026-07-15
**Status:** design aprovado (aguardando review do spec)
**Depende de:** `2026-07-15-escritorio-self-camera-preview-design.md` (self-preview, `MediaTiles.local`)

## Problema

O `MediaTiles` (faixa de câmeras/telas compartilhadas de quem você assina) hoje
fica embaixo, ao lado da `MediaBar`, competindo por espaço visual com os
controles de mídia e disputando atenção com o chão do escritório logo acima.
Numa reunião com várias pessoas de câmera ligada, a faixa fina não dá
visibilidade suficiente de quem está falando/reagindo.

## Escopo do v1

**Dentro:**
- Mover o `MediaTiles` (tiles remotos **e** o tile local — `local` já existe
  desde a feature de self-preview) do rodapé pro topo da tela.
- Estado "recolhido" (faixa fina, como hoje) vs "expandido" (grade full-screen
  tipo videochamada), alternável por um botão na própria faixa.
- Auto-recolher quando não sobrar ninguém com câmera/tela visível
  (`hasVisible` vira `false`) enquanto expandido.
- Reposicionar o `BroadcastBanner` pra não competir com a faixa de câmeras.

**Fora (deliberadamente):**
- Qualquer mudança no comportamento de clique-pra-expandir da **tela
  compartilhada** — continua com seu overlay próprio, independente do modo
  expandido da grade de câmeras.
- Persistir o estado expandido/recolhido entre sessões (sempre nasce
  recolhido).
- Mudar qualquer coisa na `MediaBar` (controles) ou no `SelfCameraPreview`
  (self-view flutuante fora de sala de reunião — não é afetado, ele já não
  passa pelo `MediaTiles`).
- Redimensionar tiles individualmente ou reordenar por quem está falando.

## Decisões de design

- **Estado `expanded` vive em `OfficePage`**, não em `MediaTiles` nem em
  `useOfficeMedia` — é puramente estado de apresentação de tela (como
  `zoom`/`peopleSidebarOpen`, que já vivem lá), não estado de mídia.
- **Grade expandida reaproveita o padrão de overlay já usado pela tela
  compartilhada** (`fixed inset-0 z-50`, fundo escuro, `Escape` fecha — mesmo
  princípio do `CharacterCard`) em vez de inventar um padrão novo.
- **Auto-recolhimento espelha o auto-fechamento do overlay de tela
  compartilhada** que já existe: se `hasVisible` cai a `false` (todo mundo
  desligou câmera) enquanto expandido, o modo expandido fecha sozinho —
  evita ficar com uma grade vazia ocupando a tela.
- **`BroadcastBanner` empilha abaixo da faixa fina** em vez de ganhar lógica
  de coordenação complexa com `MediaTiles` — os dois só colidiriam no caso
  raro de alguém estar no alto-falante E a faixa de câmeras estar visível ao
  mesmo tempo; empilhar resolve sem acoplar os componentes.

## Arquitetura

### 1. `MediaTiles.tsx` — estado collapsed/expanded

```ts
export function MediaTiles({
  remotes,
  local,
  expanded,
  onToggleExpanded,
}: {
  remotes: RemoteMedia[]
  local?: { track: LocalVideoTrack; name: string } | null
  expanded: boolean
  onToggleExpanded: () => void
})
```

- `hasVisible` continua igual (`!!local || remotes.some(...)`); se `false`,
  nem a faixa fina nem a grade expandida renderizam nada (comportamento atual
  preservado).
- **Faixa fina** (`!expanded`): mesmo `<div className="flex gap-md overflow-x-auto ...">`
  de hoje, com um botão novo no canto (`Icon name="fullscreen"`,
  `aria-label="Expandir câmeras"`, `onClick={onToggleExpanded}`), visível só
  quando `hasVisible`.
- **Grade expandida** (`expanded`): novo bloco
  `fixed inset-0 z-50 bg-black/90 p-lg`, tiles em
  `grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-md`, reaproveitando
  o `VideoTile` existente (tiles maiores — sem a classe `w-40` fixa nesse
  contexto, ocupam a célula do grid). Botão de recolher
  (`Icon name="fullscreen_exit"`, `aria-label="Recolher câmeras"`) fixo no
  canto superior do overlay.
- `useEffect` novo: se `expanded && !hasVisible`, chama `onToggleExpanded()`
  (auto-recolhe). Mesmo princípio do `useEffect` que já fecha o overlay de
  tela compartilhada quando `screenTrack` some.
- `useEffect` de teclado: `Escape` fecha o modo expandido (só ativo quando
  `expanded === true`), mesmo padrão do `CharacterCard.closeCard`.
- O overlay de tela compartilhada (clique num tile → `expandedId`) continua
  **exatamente como está**, inclusive dentro da grade expandida — clicar numa
  tela compartilhada dentro da grade abre o dialog de tela em cima de tudo
  (`z-50` dos dois; o dialog de tela nasce depois no DOM, fica por cima).

### 2. `OfficePage.tsx` — posição e estado

```tsx
const [camerasExpanded, setCamerasExpanded] = useState(false)
```

O bloco que hoje fica em `bottom-3` só com `MediaTiles` + `MediaBar` se
divide em dois containers independentes:

```tsx
{/* Câmeras: topo, fora do fluxo do mapa */}
<div
  className="absolute top-3 left-1/2 z-10 flex w-full max-w-2xl -translate-x-1/2 flex-col gap-sm px-4"
  onWheel={(event) => event.stopPropagation()}
>
  <MediaTiles
    remotes={media.remotes}
    local={inMeetingRoom ? selfCamera : null}
    expanded={camerasExpanded}
    onToggleExpanded={() => setCamerasExpanded((v) => !v)}
  />
</div>

{/* Controles: rodapé, como hoje */}
<div
  className="absolute bottom-3 left-1/2 z-10 flex w-full max-w-2xl -translate-x-1/2 flex-col gap-sm px-4"
  onWheel={(event) => event.stopPropagation()}
>
  <MediaBar ... />
</div>
```

`BroadcastBanner` ganha uma prop `pushDown: boolean`, calculada em
`OfficePage` como `media.remotes.some((r) => r.cameraTrack || r.screenTrack) || !!selfCamera`
(mesma condição de `hasVisible`, calculada no chamador porque `OfficePage` já
tem os dados — evita expor `hasVisible` para fora do `MediaTiles`):

```tsx
<BroadcastBanner
  speakers={broadcast.speakers}
  tracks={broadcast.broadcastTracks}
  pushDown={inMeetingRoom ? !!selfCamera || media.remotes.some((r) => r.cameraTrack || r.screenTrack) : media.remotes.some((r) => r.cameraTrack || r.screenTrack)}
/>
```

### 3. `BroadcastBanner.tsx` — empilhar abaixo da faixa

```ts
export function BroadcastBanner({
  speakers,
  tracks,
  pushDown,
}: {
  speakers: string[]
  tracks: RemoteAudioTrack[]
  pushDown: boolean
})
```

Troca a classe fixa `top-4` por `pushDown ? 'top-28' : 'top-4'` — desce o
suficiente pra ficar abaixo da faixa fina de câmeras (altura de um tile
`w-40` + padding) sem precisar medir DOM em tempo real.

## Fluxos

1. **Alguém liga a câmera** → tile aparece na faixa fina do topo (como hoje
   aparecia embaixo).
2. **Clica em "Expandir câmeras"** → grade full-screen com todos os tiles
   maiores; mapa e controles ficam cobertos até recolher.
3. **Última pessoa desliga a câmera enquanto expandido** → `hasVisible` cai a
   `false` → grade fecha sozinha, volta pro mapa.
4. **Aperta Escape com a grade aberta** → recolhe, mesmo efeito do botão.
5. **Alguém liga o alto-falante enquanto a faixa de câmeras está visível** →
   `BroadcastBanner` nasce mais abaixo (`top-28`), sem sobrepor a faixa.

## Erros e bordas

- **Grade expandida com uma tela compartilhada dentro** → clicar nela abre o
  overlay de tela por cima da grade (mesmo `z-50`, ordem de montagem no DOM
  garante que o dialog de tela — montado depois — fica visualmente por cima);
  fechar o dialog de tela volta pra grade, não pro mapa.
- **`camerasExpanded` true e a pessoa muda de sala/sai do escritório** → não
  há reset automático específico; se `hasVisible` cair a `false` no processo
  (típico ao trocar de sala, já que `remotes`/`local` mudam), o
  auto-recolhimento já cobre o caso.

## Testes

- **`MediaTiles.test.tsx`**: com `expanded=false`, botão "Expandir câmeras"
  aparece só quando `hasVisible`; clicar chama `onToggleExpanded`. Com
  `expanded=true`, renderiza a grade (`role`/estrutura verificável via
  `container.querySelector`), botão "Recolher câmeras" chama
  `onToggleExpanded`; `Escape` também chama `onToggleExpanded`. Quando
  `expanded=true` e a próxima renderização não tem mais `remotes`/`local`
  visíveis, dispara `onToggleExpanded` sozinho (auto-recolher). Tela
  compartilhada dentro da grade expandida continua abrindo seu overlay
  próprio ao clicar.
- **`BroadcastBanner.test.tsx`** (se não existir, criar): `pushDown=false` usa
  `top-4`; `pushDown=true` usa `top-28`.
- **`OfficePage.test.tsx`**: `camerasExpanded` nasce `false`; `MediaTiles`
  recebe `expanded`/`onToggleExpanded` corretos; `BroadcastBanner` recebe
  `pushDown` calculado a partir de `media.remotes`/`selfCamera`.
- **Manual**: várias pessoas com câmera ligada → expandir mostra grade cheia
  → desligar todas as câmeras remotas fecha sozinho → alto-falante + câmeras
  visíveis ao mesmo tempo não se sobrepõem visualmente.

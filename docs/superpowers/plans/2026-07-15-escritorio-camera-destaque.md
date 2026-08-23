# Modo de destaque na grade expandida de câmeras — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na grade expandida de câmeras do escritório (`MediaTiles`), permitir que
qualquer participante clique num tile (câmera, tela compartilhada ou avatar de
quem não tem câmera) e o destaque, num layout de duas colunas (tile grande +
miniaturas), no estilo Google Meet — sem mexer na faixa fina do topo.

**Architecture:** `RemoteMedia` ganha campos de avatar (casados com `occupants`
em `useOfficeMedia`); `OfficePage` passa `local` sempre que o usuário está em
sala (não só com câmera ligada). Dentro de `MediaTiles`, um novo módulo de
tiles (`buildTiles`/`resolveFeatured`) unifica câmera/tela/avatar numa única
lista, usada tanto pelo grid uniforme quanto pelo layout com destaque; o
estado de pin (`featuredPin`) vive só dentro do `MediaTiles`, resetado a cada
abertura da grade.

**Tech Stack:** React 18, TypeScript, Vitest + Testing Library, Tailwind.

## Global Constraints

- Mudança restrita à grade expandida (`expanded === true`); a faixa fina
  (`!expanded`) não muda em nada.
- Todo participante da sala vira um tile (câmera, tela, ou avatar/iniciais se
  sem nenhuma das duas) — inclusive o próprio usuário (`local`).
- `featuredPin` é estado 100% local ao `MediaTiles`, nasce `null` toda vez
  que `expanded` vira `true`.
- Clique em tela compartilhada dentro da grade expandida destaca a tela (não
  abre mais o dialog separado); fora da grade expandida (faixa fina) o
  dialog separado continua exatamente como hoje.
- Troca automática de destaque (quando o alvo perde mídia) nunca escolhe um
  avatar sozinha — só tiles com câmera/tela ativa; pin manual em avatar é
  permitido.
- Mensagens/labels voltados ao usuário em português.

---

### Task 1: `RemoteMedia` ganha campos de avatar

**Files:**
- Modify: `apps/web/src/office/media/useOfficeMedia.ts:12-33,106-130`
- Test: `apps/web/src/office/media/useOfficeMedia.test.ts`

**Interfaces:**
- Consumes: `OfficeOccupant` (já importado de `@legends/shared`, campos
  `photoUrl?`, `avatarStyle?`, `avatarSeed?`, `avatarOptions?`).
- Produces: `RemoteMedia` com `photoUrl: string | null | undefined`,
  `avatarStyle: AvatarStyleKey | null | undefined`,
  `avatarSeed: string | null | undefined`,
  `avatarOptions: AvatarOptions | null | undefined` — usados pela Task 3
  (`buildTiles`) para popular o `AvatarSource` de cada tile sem mídia.

- [ ] **Step 1: Escrever o teste que falha**

Adicionar ao final do arquivo `apps/web/src/office/media/useOfficeMedia.test.ts`
(dentro do `describe('useOfficeMedia', ...)`, reaproveitando o padrão do teste
"no office-open assina quem está perto e desassina quem se afasta"):

```ts
  it('RemoteMedia carrega os campos de avatar do occupant correspondente', async () => {
    const bob: OfficeOccupant = {
      userId: 'bob',
      name: 'Bob',
      x: 12,
      y: 5,
      dir: 'down',
      skinColor: 'edb98a',
      clothingColor: '8fa7df',
      photoUrl: 'https://example.com/bob.png',
      avatarStyle: 'open-peeps',
      avatarSeed: 'seed-bob',
    }
    const { result, rerender } = renderHook(({ occ }) => useOfficeMedia(occ, 'you', true), {
      initialProps: { occ: [occupant('you', 10, 5), bob] },
    })
    await settle(600)
    const room = FakeRoom.instances.at(-1)!
    const bobParticipant = new FakeParticipant('bob', 'Bob')
    room.remoteParticipants.set('bob', bobParticipant)
    act(() => room.emit('participantConnected'))

    expect(result.current.remotes[0]).toMatchObject({
      userId: 'bob',
      photoUrl: 'https://example.com/bob.png',
      avatarStyle: 'open-peeps',
      avatarSeed: 'seed-bob',
    })

    rerender({ occ: [occupant('you', 10, 5), occupant('bob', 12, 5)] }) // occupant sem avatar customizado
    act(() => room.emit('participantConnected'))
    expect(result.current.remotes[0]).toMatchObject({
      photoUrl: null,
      avatarStyle: null,
      avatarSeed: null,
      avatarOptions: null,
    })
  })
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web test -- useOfficeMedia.test.ts -t "campos de avatar"`
Expected: FAIL — `result.current.remotes[0].photoUrl` é `undefined`, não bate
com `toMatchObject`.

- [ ] **Step 3: Implementar**

Em `apps/web/src/office/media/useOfficeMedia.ts`, importar os tipos de avatar
junto dos demais imports de `@legends/shared` (linha 12-18):

```ts
import {
  OFFICE_OPEN_ROOM,
  officeRoomAt,
  isWithinProximity,
  type OfficeOccupant,
  type OfficeMediaTokenResponse,
  type AvatarStyleKey,
  type AvatarOptions,
} from '@legends/shared'
```

Estender `RemoteMedia` (linhas 27-33):

```ts
export interface RemoteMedia {
  userId: string
  name: string
  audioTrack: RemoteAudioTrack | null
  cameraTrack: RemoteVideoTrack | null
  screenTrack: RemoteVideoTrack | null
  photoUrl?: string | null
  avatarStyle?: AvatarStyleKey | null
  avatarSeed?: string | null
  avatarOptions?: AvatarOptions | null
}
```

Em `syncRemotes` (linhas 106-130), casar o occupant e copiar os campos:

```ts
  const syncRemotes = useCallback(() => {
    const room = roomRef.current
    if (!room) {
      setRemotes([])
      return
    }
    const next: RemoteMedia[] = []
    for (const participant of room.remoteParticipants.values()) {
      const occupant = occupantsRef.current.find((o) => o.userId === participant.identity)
      const media: RemoteMedia = {
        userId: participant.identity,
        name: participant.name ?? participant.identity,
        audioTrack: null,
        cameraTrack: null,
        screenTrack: null,
        photoUrl: occupant?.photoUrl ?? null,
        avatarStyle: occupant?.avatarStyle ?? null,
        avatarSeed: occupant?.avatarSeed ?? null,
        avatarOptions: occupant?.avatarOptions ?? null,
      }
      for (const pub of participant.trackPublications.values()) {
        if (!pub.isSubscribed || !pub.track) continue
        if (pub.source === Track.Source.Microphone) media.audioTrack = pub.track as RemoteAudioTrack
        else if (pub.source === Track.Source.Camera) media.cameraTrack = pub.track as RemoteVideoTrack
        else if (pub.source === Track.Source.ScreenShare) media.screenTrack = pub.track as RemoteVideoTrack
      }
      next.push(media)
    }
    setRemotes(next)
  }, [])
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web test -- useOfficeMedia.test.ts`
Expected: PASS (todos os testes do arquivo, incluindo o novo).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/media/useOfficeMedia.ts apps/web/src/office/media/useOfficeMedia.test.ts
git commit -m "feat(office): RemoteMedia carrega campos de avatar do occupant"
```

---

### Task 2: `OfficePage` monta `local` sempre que em sala

**Files:**
- Modify: `apps/web/src/pages/OfficePage.tsx:51-59`
- Test: `apps/web/src/pages/OfficePage.test.tsx` (verificar que os testes
  existentes continuam passando; nenhum teste novo é necessário aqui — a
  wiring é coberta indiretamente pelos testes do `MediaTiles` na Task 4, que
  passam `local` diretamente).

**Interfaces:**
- Consumes: `you: OfficeOccupant | null` (linha 48, já existe),
  `media.cameraEnabled`, `media.localCameraTrack` (já existem).
- Produces: `local: { name: string; track: LocalVideoTrack | null; photoUrl?, avatarStyle?, avatarSeed?, avatarOptions? } | null`
  passado a `<MediaTiles local={...} />` — Task 3/4 dependem desse formato
  (`track` opcional em vez de sempre presente).

- [ ] **Step 1: Rodar os testes existentes pra ter uma baseline**

Run: `pnpm --filter @legends/web test -- OfficePage.test.tsx`
Expected: PASS (estado atual, antes da mudança).

- [ ] **Step 2: Implementar a mudança**

Em `apps/web/src/pages/OfficePage.tsx`, substituir as linhas 51-54:

```ts
  const selfCamera =
    media.cameraEnabled && media.localCameraTrack
      ? { track: media.localCameraTrack, name: you?.name ?? 'Você' }
      : null
```

por:

```ts
  const selfCamera =
    media.cameraEnabled && media.localCameraTrack
      ? { track: media.localCameraTrack, name: you?.name ?? 'Você' }
      : null
  const local =
    inMeetingRoom && you
      ? {
          name: you.name,
          track: selfCamera?.track ?? null,
          photoUrl: you.photoUrl,
          avatarStyle: you.avatarStyle,
          avatarSeed: you.avatarSeed,
          avatarOptions: you.avatarOptions,
        }
      : null
```

(`selfCamera` continua existindo — ainda alimenta o `SelfCameraPreview` fora
de sala, ver linhas 112-113; `inMeetingRoom` já é calculado na linha 50.)

Depois, no `<MediaTiles local={...} />` (por volta da linha 221), trocar:

```tsx
        <MediaTiles
          remotes={media.remotes}
          local={inMeetingRoom ? selfCamera : null}
```

por:

```tsx
        <MediaTiles
          remotes={media.remotes}
          local={local}
```

- [ ] **Step 3: Rodar os testes de novo e confirmar que continuam passando**

Run: `pnpm --filter @legends/web test -- OfficePage.test.tsx`
Expected: PASS — sem mudança de comportamento observável ainda (Task 3/4 é
que fazem o `MediaTiles` reagir ao novo formato de `local`).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/OfficePage.tsx
git commit -m "feat(office): OfficePage monta local sempre que em sala, não só com câmera"
```

---

### Task 3: `MediaTiles` — modelo unificado de tiles com avatar no grid uniforme

**Files:**
- Modify: `apps/web/src/office/media/MediaTiles.tsx`
- Test: `apps/web/src/office/media/MediaTiles.test.tsx`

**Interfaces:**
- Consumes: `RemoteMedia` (com campos de avatar da Task 1), `local` (formato
  da Task 2, `track: LocalVideoTrack | null`), `Avatar`/`AvatarSource` de
  `../../components/Avatar`.
- Produces: `buildTiles(remotes, local): Tile[]` e o componente `AvatarTile`
  — a Task 4 usa ambos para o layout com destaque.

```ts
type TileKind = 'camera' | 'screen' | 'avatar'
interface Tile {
  key: string // 'local' | `cam:${userId}` | `screen:${userId}` | `avatar:${userId}`
  kind: TileKind
  label: string
  track: RemoteVideoTrack | LocalVideoTrack | null
  mirrored: boolean
  avatar: AvatarSource
}
```

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao `apps/web/src/office/media/MediaTiles.test.tsx` (a função
`remote()` já existe no arquivo; usar `expanded` para forçar a grade):

```ts
  it('na grade expandida, quem não tem câmera/tela vira quadrado de avatar (iniciais)', () => {
    const remotes = [
      remote({ userId: 'a', name: 'Ana Silva', cameraTrack: fakeVideoTrack() }),
      remote({ userId: 'b', name: 'Bob' }), // sem câmera, sem tela
    ]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)

    const figures = screen.getAllByRole('figure')
    expect(figures).toHaveLength(2)
    const bobFigure = figures.find((f) => f.textContent?.includes('Bob'))!
    expect(bobFigure.querySelector('video')).toBeNull()
    expect(bobFigure.textContent).toContain('B') // iniciais do Avatar
  })

  it('na grade expandida, o próprio usuário sem câmera também vira quadrado de avatar', () => {
    const remotes = [remote({ cameraTrack: fakeVideoTrack() })]
    render(
      <MediaTiles
        remotes={remotes}
        local={{ track: null, name: 'Você' }}
        expanded
        onToggleExpanded={vi.fn()}
      />,
    )

    const figures = screen.getAllByRole('figure')
    expect(figures).toHaveLength(2)
    const selfFigure = figures.find((f) => f.textContent?.includes('Você'))!
    expect(selfFigure.querySelector('video')).toBeNull()
  })

  it('`local.track` null não conta como mídia visível pro botão de expandir/faixa fina', () => {
    render(<MediaTiles remotes={[remote()]} local={{ track: null, name: 'Você' }} expanded={false} onToggleExpanded={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Expandir câmeras' })).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web test -- MediaTiles.test.tsx -t "quadrado de avatar"`
Expected: FAIL — hoje `remote({ userId: 'b' })` sem câmera/tela não gera
nenhum `figure`, e `local.track` não existe no tipo atual (erro de tipo /
`local.track` sempre presente).

- [ ] **Step 3: Implementar**

Em `apps/web/src/office/media/MediaTiles.tsx`:

1. Importar `Avatar`/`AvatarSource` e os tipos de avatar:

```ts
import { Avatar, type AvatarSource } from '../../components/Avatar'
import type { AvatarStyleKey, AvatarOptions } from '@legends/shared'
```

2. Ajustar o tipo de `local` (assinatura da função `MediaTiles`):

```ts
export function MediaTiles({
  remotes,
  local,
  expanded = false,
  onToggleExpanded = () => {},
}: {
  remotes: RemoteMedia[]
  local?: {
    track: LocalVideoTrack | null
    name: string
    photoUrl?: string | null
    avatarStyle?: AvatarStyleKey | null
    avatarSeed?: string | null
    avatarOptions?: AvatarOptions | null
  } | null
  expanded?: boolean
  onToggleExpanded?: () => void
})
```

3. Adicionar, logo após a definição de `VideoTile`, o componente `AvatarTile`
   e o tipo/função de construção de tiles:

```ts
function AvatarTile({
  user,
  label,
  onClick,
  className = 'w-40 shrink-0',
  fill = false,
}: {
  user: AvatarSource
  label: string
  onClick?: () => void
  className?: string
  fill?: boolean
}) {
  return (
    <figure className={`${className} cursor-pointer`} onClick={onClick}>
      <div
        className={`flex items-center justify-center overflow-hidden rounded-md bg-surface-container-highest ${
          fill ? 'h-full w-full' : 'aspect-square w-full'
        }`}
      >
        <Avatar user={user} initialsClassName="font-label text-label-lg font-bold text-primary" />
      </div>
      <figcaption className="truncate font-label text-label-sm text-on-surface-variant">{label}</figcaption>
    </figure>
  )
}

type TileKind = 'camera' | 'screen' | 'avatar'

interface Tile {
  key: string
  kind: TileKind
  label: string
  track: RemoteVideoTrack | LocalVideoTrack | null
  mirrored: boolean
  avatar: AvatarSource
}

function buildTiles(
  remotes: RemoteMedia[],
  local?: {
    track: LocalVideoTrack | null
    name: string
    photoUrl?: string | null
    avatarStyle?: AvatarStyleKey | null
    avatarSeed?: string | null
    avatarOptions?: AvatarOptions | null
  } | null,
): Tile[] {
  const tiles: Tile[] = []
  if (local) {
    tiles.push({
      key: 'local',
      kind: local.track ? 'camera' : 'avatar',
      label: local.name,
      track: local.track,
      mirrored: true,
      avatar: local,
    })
  }
  for (const r of remotes) {
    if (r.cameraTrack) {
      tiles.push({ key: `cam:${r.userId}`, kind: 'camera', label: r.name, track: r.cameraTrack, mirrored: false, avatar: r })
    }
    if (r.screenTrack) {
      tiles.push({
        key: `screen:${r.userId}`,
        kind: 'screen',
        label: `Tela de ${r.name}`,
        track: r.screenTrack,
        mirrored: false,
        avatar: r,
      })
    }
    if (!r.cameraTrack && !r.screenTrack) {
      tiles.push({ key: `avatar:${r.userId}`, kind: 'avatar', label: r.name, track: null, mirrored: false, avatar: r })
    }
  }
  return tiles
}
```

4. Trocar `hasVisible` (linha ~71) para não contar `local` sem `track`:

```ts
  const hasVisible = !!local?.track || remotes.some((r) => r.cameraTrack || r.screenTrack)
```

5. Na faixa fina (bloco `hasVisible && !expanded`), trocar o render do tile
   local pra checar `local?.track` (hoje era só `local &&`):

```tsx
            {local?.track && <VideoTile track={local.track} label={local.name} mirrored />}
```

6. No bloco `expanded && hasVisible`, substituir o `grid` interno (que hoje
   itera `local`/`remotes` na mão) por uma iteração sobre `buildTiles`:

```tsx
          <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-md">
            {buildTiles(remotes, local).map((tile) =>
              tile.kind === 'avatar' ? (
                <AvatarTile key={tile.key} user={tile.avatar} label={tile.label} className="w-full" />
              ) : (
                <VideoTile
                  key={tile.key}
                  track={tile.track!}
                  label={tile.label}
                  mirrored={tile.mirrored}
                  className="w-full"
                  onClick={tile.kind === 'screen' ? () => setExpandedId(remotes.find((r) => tile.key === `screen:${r.userId}`)!.userId) : undefined}
                />
              ),
            )}
          </div>
```

(O `onClick` de tela aqui ainda chama `setExpandedId` — a Task 4 troca isso
pra `setFeaturedPin`. Este passo só introduz o modelo de tiles + avatar no
grid uniforme, mantendo o resto do comportamento intacto.)

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web test -- MediaTiles.test.tsx`
Expected: PASS — incluindo os testes antigos (nenhum deles deve quebrar,
já que o comportamento de câmera/tela é preservado, só ganhou avatar como
terceiro caso).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/office/media/MediaTiles.tsx apps/web/src/office/media/MediaTiles.test.tsx
git commit -m "feat(office): grade expandida mostra avatar pra quem não tem câmera/tela"
```

---

### Task 4: Layout com destaque (pin) na grade expandida

**Files:**
- Modify: `apps/web/src/office/media/MediaTiles.tsx`
- Test: `apps/web/src/office/media/MediaTiles.test.tsx`

**Interfaces:**
- Consumes: `buildTiles`, `Tile`, `AvatarTile` (Task 3).
- Produces: nenhuma interface nova exposta fora do componente — `featuredPin`
  é estado interno do `MediaTiles`.

- [ ] **Step 1: Escrever os testes que falham**

Substituir o teste antigo `'tela compartilhada dentro da grade expandida
continua abrindo o overlay próprio'` (que descrevia o comportamento ANTIGO
de dentro da grade expandida) por:

```ts
  it('clicar num tile de câmera na grade expandida o destaca (layout de duas colunas)', () => {
    const remotes = [
      remote({ userId: 'a', name: 'Ana', cameraTrack: fakeVideoTrack() }),
      remote({ userId: 'b', name: 'Bob', cameraTrack: fakeVideoTrack() }),
    ]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)

    // Sem tela compartilhada: nasce em grid uniforme (nenhum destaque).
    expect(screen.queryByTestId('featured-tile')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Bob'))
    const featured = screen.getByTestId('featured-tile')
    expect(featured).toHaveTextContent('Bob')
  })

  it('clicar numa tela compartilhada na grade expandida a destaca, sem abrir o dialog separado', () => {
    const remotes = [remote({ screenTrack: fakeVideoTrack() })]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)

    fireEvent.click(screen.getByText('Tela de Ana'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('featured-tile')).toHaveTextContent('Tela de Ana')
  })

  it('tela compartilhada na faixa fina (não expandida) continua abrindo o dialog separado', () => {
    const remotes = [remote({ screenTrack: fakeVideoTrack() })]
    render(<MediaTiles remotes={remotes} expanded={false} onToggleExpanded={vi.fn()} />)

    fireEvent.click(screen.getByText('Tela de Ana'))
    expect(screen.getByRole('dialog', { name: 'Tela compartilhada em destaque' })).toBeInTheDocument()
  })

  it('grade expandida nasce com a tela compartilhada em destaque, se houver uma', () => {
    const remotes = [
      remote({ userId: 'a', name: 'Ana', cameraTrack: fakeVideoTrack() }),
      remote({ userId: 'b', name: 'Bob', screenTrack: fakeVideoTrack() }),
    ]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)

    expect(screen.getByTestId('featured-tile')).toHaveTextContent('Tela de Bob')
  })

  it('quando o destaque perde toda mídia, troca pra outro tile com mídia; sem nenhum, volta pro grid uniforme', () => {
    const remotes = [
      remote({ userId: 'a', name: 'Ana', cameraTrack: fakeVideoTrack() }),
      remote({ userId: 'b', name: 'Bob', cameraTrack: fakeVideoTrack() }),
    ]
    const { rerender } = render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)

    fireEvent.click(screen.getByText('Bob'))
    expect(screen.getByTestId('featured-tile')).toHaveTextContent('Bob')

    // Bob desliga a câmera: destaque troca pra Ana (única com mídia ativa restante).
    rerender(
      <MediaTiles
        remotes={[remote({ userId: 'a', name: 'Ana', cameraTrack: fakeVideoTrack() }), remote({ userId: 'b', name: 'Bob' })]}
        expanded
        onToggleExpanded={vi.fn()}
      />,
    )
    expect(screen.getByTestId('featured-tile')).toHaveTextContent('Ana')

    // Ana também desliga: ninguém mais com mídia — volta pro grid uniforme.
    rerender(
      <MediaTiles
        remotes={[remote({ userId: 'a', name: 'Ana' }), remote({ userId: 'b', name: 'Bob' })]}
        expanded
        onToggleExpanded={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('featured-tile')).not.toBeInTheDocument()
  })

  it('pin manual num avatar é permitido, e clicar num avatar sem mídia também destaca', () => {
    const remotes = [remote({ userId: 'a', name: 'Ana', cameraTrack: fakeVideoTrack() }), remote({ userId: 'b', name: 'Bob' })]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)

    fireEvent.click(screen.getByText('Bob'))
    expect(screen.getByTestId('featured-tile')).toHaveTextContent('Bob')
  })

  it('o pin de destaque reseta toda vez que a grade expande de novo', () => {
    const remotes = [remote({ userId: 'a', name: 'Ana', cameraTrack: fakeVideoTrack() }), remote({ userId: 'b', name: 'Bob', screenTrack: fakeVideoTrack() })]
    const onToggleExpanded = vi.fn()
    const { rerender } = render(<MediaTiles remotes={remotes} expanded onToggleExpanded={onToggleExpanded} />)

    fireEvent.click(screen.getByText('Ana'))
    expect(screen.getByTestId('featured-tile')).toHaveTextContent('Ana')

    rerender(<MediaTiles remotes={remotes} expanded={false} onToggleExpanded={onToggleExpanded} />)
    rerender(<MediaTiles remotes={remotes} expanded onToggleExpanded={onToggleExpanded} />)

    // Reabriu: volta a nascer com a tela compartilhada em destaque (default), não com o pin antigo (Ana).
    expect(screen.getByTestId('featured-tile')).toHaveTextContent('Tela de Bob')
  })
```

Remover o teste antigo `'tela compartilhada dentro da grade expandida
continua abrindo o overlay próprio'` do arquivo (linhas 155-161 no arquivo
original) — ele descrevia exatamente o comportamento que este task substitui.

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web test -- MediaTiles.test.tsx -t "destaqu"`
Expected: FAIL — `getByTestId('featured-tile')` não existe ainda; clique em
tela dentro da grade expandida ainda abre o dialog.

- [ ] **Step 3: Implementar**

Em `apps/web/src/office/media/MediaTiles.tsx`:

1. Adicionar o estado de pin e a função de resolução, logo abaixo da
   declaração de `expandedId`/`expandedScreen` (linhas ~60-61):

```ts
  const [featuredPin, setFeaturedPin] = useState<string | null>(null)

  // Reseta o destaque toda vez que a grade expande de novo — nunca herda o
  // pin de uma sessão anterior de tela cheia.
  useEffect(() => {
    if (expanded) setFeaturedPin(null)
  }, [expanded])
```

2. Adicionar a função de resolução (fora do componente, junto de
   `buildTiles`):

```ts
function resolveFeatured(tiles: Tile[], pin: string | null): Tile | null {
  const pinned = pin ? tiles.find((t) => t.key === pin) : undefined
  if (pinned) return pinned
  return tiles.find((t) => t.kind === 'screen') ?? tiles.find((t) => t.kind === 'camera') ?? null
}
```

3. Dentro do bloco `expanded && hasVisible`, calcular tiles e destaque antes
   do JSX:

```tsx
      {expanded && hasVisible && createPortal(
        (() => {
          const tiles = buildTiles(remotes, local)
          const featured = resolveFeatured(tiles, featuredPin)
          return (
            <div
              className="fixed inset-0 z-50 overflow-y-auto bg-black/90 p-lg"
              role="region"
              aria-label="Câmeras em tela cheia"
            >
              <button
                type="button"
                aria-label="Recolher câmeras"
                onClick={onToggleExpanded}
                className="fixed right-4 top-4 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
              >
                <Icon name="fullscreen_exit" className="text-[22px]" />
              </button>
              {featured ? (
                <div className="flex h-full gap-md">
                  <div className="flex min-w-0 flex-1 flex-col" data-testid="featured-tile">
                    {featured.kind === 'avatar' ? (
                      <AvatarTile user={featured.avatar} label={featured.label} className="flex h-full flex-1 flex-col" fill />
                    ) : (
                      <VideoTile
                        track={featured.track!}
                        label={featured.label}
                        mirrored={featured.mirrored}
                        className="flex h-full flex-1 flex-col"
                        videoClassName="min-h-0 flex-1 object-contain"
                      />
                    )}
                  </div>
                  <div className="flex w-56 shrink-0 flex-col gap-sm overflow-y-auto">
                    {tiles
                      .filter((t) => t.key !== featured.key)
                      .map((t) =>
                        t.kind === 'avatar' ? (
                          <AvatarTile key={t.key} user={t.avatar} label={t.label} className="w-full" onClick={() => setFeaturedPin(t.key)} />
                        ) : (
                          <VideoTile
                            key={t.key}
                            track={t.track!}
                            label={t.label}
                            mirrored={t.mirrored}
                            className="w-full"
                            onClick={() => setFeaturedPin(t.key)}
                          />
                        ),
                      )}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-md">
                  {tiles.map((tile) =>
                    tile.kind === 'avatar' ? (
                      <AvatarTile key={tile.key} user={tile.avatar} label={tile.label} className="w-full" onClick={() => setFeaturedPin(tile.key)} />
                    ) : (
                      <VideoTile
                        key={tile.key}
                        track={tile.track!}
                        label={tile.label}
                        mirrored={tile.mirrored}
                        className="w-full"
                        onClick={() => setFeaturedPin(tile.key)}
                      />
                    ),
                  )}
                </div>
              )}
            </div>
          )
        })(),
        document.body,
      )}
```

Isso substitui o bloco `expanded && hasVisible && createPortal(...)` inteiro
introduzido na Task 3 (que já usava `buildTiles`, mas com `onClick` de tela
chamando `setExpandedId`).

4. Adicionar `videoClassName` ao `VideoTile` (usado pelo tile grande em
   destaque, pra ocupar a altura toda em vez da largura fixa):

```ts
function VideoTile({
  track,
  label,
  mirrored = false,
  onClick,
  className = 'w-40 shrink-0',
  videoClassName = 'w-full',
}: {
  track: RemoteVideoTrack | LocalVideoTrack
  label: string
  mirrored?: boolean
  onClick?: () => void
  className?: string
  videoClassName?: string
}) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    track.attach(el)
    return () => {
      track.detach(el)
    }
  }, [track])
  return (
    <figure className={`${className} cursor-pointer`} onClick={onClick}>
      <video
        ref={ref}
        autoPlay
        playsInline
        className={`${videoClassName} rounded-md bg-black ${mirrored ? 'scale-x-[-1]' : ''}`}
      />
      <figcaption className="truncate font-label text-label-sm text-on-surface-variant">{label}</figcaption>
    </figure>
  )
}
```

5. A faixa fina (`!expanded`) e o dialog de tela separado (`expandedId`,
   `expandedScreen`, o `useEffect` que fecha sozinho, o bloco JSX do dialog)
   **não mudam** — continuam existindo e sendo alcançados só a partir de
   cliques na faixa fina.

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web test -- MediaTiles.test.tsx`
Expected: PASS — arquivo inteiro, incluindo os testes antigos da faixa fina
(inalterados) e os novos de destaque.

- [ ] **Step 5: Rodar a suíte inteira do web workspace**

Run: `pnpm --filter @legends/web test`
Expected: PASS — nenhuma regressão em `OfficePage.test.tsx`,
`BroadcastBanner.test.tsx` ou qualquer outro teste que dependa de
`MediaTiles`/`useOfficeMedia`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/office/media/MediaTiles.tsx apps/web/src/office/media/MediaTiles.test.tsx
git commit -m "feat(office): destaque estilo Meet na grade expandida de câmeras"
```

---

## Verificação manual final

Depois da Task 4, com `pnpm dev` rodando:

1. Entrar numa sala de reunião com 2+ pessoas, uma delas sem câmera —
   expandir a grade e confirmar que a pessoa sem câmera aparece como
   quadrado de avatar/iniciais.
2. Ligar uma tela compartilhada com a grade já expandida e sem ninguém
   destacado — confirmar que a tela nasce em destaque sozinha.
3. Clicar numa câmera na coluna de miniaturas — confirmar que ela vira o
   tile grande e a antiga passa pra miniatura.
4. Desligar a câmera de quem está destacado — confirmar que o destaque troca
   pra outro tile com mídia ativa (ou volta pro grid uniforme se não sobrar
   nenhum).
5. Fora da grade expandida (faixa fina), clicar numa tela compartilhada —
   confirmar que o dialog separado de sempre ainda abre normalmente.

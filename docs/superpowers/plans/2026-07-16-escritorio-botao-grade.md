# Botão de grade (Meet-style) dentro da sala de reunião Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dentro de uma sala de reunião, um botão com ícone de grade + contador de participantes aparece no canto superior direito; clicar abre/fecha a grade expandida de câmeras (Meet-style) já existente — que passa a abrir mesmo sem ninguém ter câmera/tela ativa (mostrando avatares de quem está na sala).

**Architecture:** `MediaTiles` recupera um prop `showAllPresent?: boolean` (default `false`) que afeta só a variável `hasVisible` da grade expandida (a faixa compacta que existia antes não volta — já foi removida numa feature anterior). `OfficePage.tsx` calcula `roomOccupantCount` a partir dos mesmos dados que já alimentam `MediaTiles` (`local` + `media.remotes`), renderiza um novo botão condicionado a `inMeetingRoom` (variável já existente) que alterna `camerasExpanded`, e passa `showAllPresent={inMeetingRoom}` pro `<MediaTiles>`.

**Tech Stack:** React 18 + TypeScript, Vitest + Testing Library (`apps/web`), Tailwind CSS.

## Global Constraints

- O botão só aparece quando `inMeetingRoom` é `true` — fora de sala, nada muda.
- Contador mostra a quantidade de gente NA SALA atual (`(local ? 1 : 0) + media.remotes.length`), não a contagem geral do escritório (que já existe em outro lugar, sidebar de pessoas).
- `showAllPresent` só afeta `hasVisible` da grade expandida — nenhuma outra lógica de `MediaTiles` (`buildTiles`, `resolveFeatured`, destaque, Escape, portal) muda.
- Nenhuma mudança na grade expandida em si (layout, `AvatarTile`/`VideoTile`) — só o gatilho pra abri-la.
- Mensagens/labels voltados ao usuário em português.

---

### Task 1: `MediaTiles` recupera `showAllPresent` (só afeta a grade expandida)

**Files:**
- Modify: `apps/web/src/office/media/MediaTiles.tsx`
- Modify: `apps/web/src/office/media/MediaTiles.test.tsx`

**Interfaces:**
- Consumes: nada novo.
- Produces: `MediaTiles({ ..., showAllPresent?: boolean })` (default `false`) — consumido pela Task 2 (`OfficePage.tsx`).

- [ ] **Step 1: Escrever os testes que falham**

Adicione ao final de `apps/web/src/office/media/MediaTiles.test.tsx` (dentro do `describe`, após o último `it`):

```tsx
  it('showAllPresent=true: grade expandida abre mesmo sem ninguém ter câmera/tela ativa (mostra avatares)', () => {
    const remotes = [remote({ userId: 'b', name: 'Bob' })]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} showAllPresent />)

    expect(screen.getByRole('region', { name: 'Câmeras em tela cheia' })).toBeInTheDocument()
    const figures = screen.getAllByRole('figure')
    expect(figures).toHaveLength(1)
    expect(figures[0]).toHaveTextContent('Bob')
    expect(figures[0].querySelector('video')).toBeNull()
  })

  it('showAllPresent=false (default): grade expandida auto-recolhe se ninguém tem câmera/tela ativa, mesmo com gente presente', () => {
    const onToggleExpanded = vi.fn()
    const remotes = [remote({ userId: 'b', name: 'Bob' })]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={onToggleExpanded} />)

    expect(onToggleExpanded).toHaveBeenCalledOnce()
  })

  it('showAllPresent=true: sem ninguém presente (nem local, nem remotos), a grade não abre', () => {
    const onToggleExpanded = vi.fn()
    render(<MediaTiles remotes={[]} expanded onToggleExpanded={onToggleExpanded} showAllPresent />)

    expect(onToggleExpanded).toHaveBeenCalledOnce()
    expect(screen.queryByRole('region', { name: 'Câmeras em tela cheia' })).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/MediaTiles.test.tsx`
Expected: FAIL nos 3 testes novos — `showAllPresent` ainda não existe como prop (TypeScript aceita a prop extra em tempo de execução do teste, mas o comportamento não muda: a primeira asserção falha porque a grade se auto-recolhe mesmo com `showAllPresent`).

- [ ] **Step 3: Adicionar o prop e ajustar `hasVisible`**

Em `apps/web/src/office/media/MediaTiles.tsx`, localize a assinatura do componente:

```tsx
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
}) {
```

Substitua por:

```tsx
export function MediaTiles({
  remotes,
  local,
  expanded = false,
  onToggleExpanded = () => {},
  showAllPresent = false,
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
  showAllPresent?: boolean
}) {
```

Logo abaixo, localize:

```tsx
  const tiles = buildTiles(remotes, local)
  const hasVisible = tiles.some((t) => t.kind !== 'avatar')
```

Substitua por:

```tsx
  const tiles = buildTiles(remotes, local)

  // Dentro de sala/zona (showAllPresent), presença já basta pra grade abrir
  // — quem não tem câmera/tela vira tile de avatar. Fora de sala, só mídia
  // ativa conta (evita abrir/manter aberta uma grade vazia sem contexto de
  // sala).
  const hasVisible = showAllPresent ? tiles.length > 0 : tiles.some((t) => t.kind !== 'avatar')
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/MediaTiles.test.tsx`
Expected: todos os testes (pré-existentes + os 3 novos) passam.

- [ ] **Step 5: Rodar o typecheck**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros (nenhum consumidor passa `showAllPresent` ainda, prop é opcional).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/office/media/MediaTiles.tsx apps/web/src/office/media/MediaTiles.test.tsx
git commit -m "feat(office): MediaTiles recupera showAllPresent (só afeta a grade expandida)"
```

---

### Task 2: `OfficePage` — botão de grade + contador de participantes da sala

**Files:**
- Modify: `apps/web/src/pages/OfficePage.tsx`
- Modify: `apps/web/src/pages/OfficePage.test.tsx`

**Interfaces:**
- Consumes: `MediaTiles({ showAllPresent })` (Task 1).
- Produces: nada consumido por tarefas futuras — última tarefa do plano.

- [ ] **Step 1: Calcular `roomOccupantCount` em `OfficePage.tsx`**

Localize o bloco que já calcula `local` (por volta das linhas 70-80):

```tsx
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

Logo abaixo, adicione:

```tsx
  const roomOccupantCount = (local ? 1 : 0) + media.remotes.length
```

- [ ] **Step 2: Adicionar o botão de grade + contador, e ligar `showAllPresent`**

Localize o bloco (por volta das linhas 268-277):

```tsx
      {/* Grade de câmeras em tela cheia (Meet-style) — sem UI própria de
          gatilho ainda (vem numa feature separada); `camerasExpanded` só é
          alternado programaticamente por enquanto. Fora do modo expandido,
          este componente não renderiza nada visível. */}
      <MediaTiles
        remotes={media.remotes}
        local={local}
        expanded={camerasExpanded}
        onToggleExpanded={() => setCamerasExpanded((value) => !value)}
      />
```

Substitua por:

```tsx
      {/* Botão de grade (Meet-style): só dentro de sala de reunião. Abre a
          grade expandida de MediaTiles mesmo sem ninguém ter câmera/tela
          ativa (showAllPresent), mostrando avatar de quem está na sala. */}
      {inMeetingRoom && (
        <button
          type="button"
          aria-label={camerasExpanded ? 'Recolher grade de câmeras' : 'Abrir grade de câmeras'}
          onClick={() => setCamerasExpanded((value) => !value)}
          onWheel={(event) => event.stopPropagation()}
          className="absolute top-3 right-3 z-10 flex items-center gap-sm rounded-full border border-outline-variant/40 bg-surface-container/95 px-md py-sm shadow-lg backdrop-blur"
        >
          <Icon name="grid_view" className="text-[20px]" />
          <span className="font-label text-label-sm text-on-surface">
            {roomOccupantCount} na sala
          </span>
        </button>
      )}

      {/* Grade de câmeras em tela cheia (Meet-style) — fora do modo
          expandido, este componente não renderiza nada visível. */}
      <MediaTiles
        remotes={media.remotes}
        local={local}
        expanded={camerasExpanded}
        onToggleExpanded={() => setCamerasExpanded((value) => !value)}
        showAllPresent={inMeetingRoom}
      />
```

- [ ] **Step 3: Preparar `OfficePage.test.tsx` pra permitir simular estar dentro de uma sala**

Hoje o mock de `useOfficeSocket` retorna sempre o mesmo valor fixo, e `renderPage` sempre usa o mesmo `activeMap` (sem nenhuma zona de reunião) — não dá pra testar `inMeetingRoom=true` sem isso. Localize o mock atual (por volta das linhas 65-67):

```tsx
vi.mock('../office/useOfficeSocket', () => ({
  useOfficeSocket: () => ({ occupants, youId: 'ana', connected: true }),
}))
```

Substitua por:

```tsx
let socketMockValue: { occupants: OfficeOccupant[]; youId: string | null; connected: boolean } = {
  occupants,
  youId: 'ana',
  connected: true,
}
vi.mock('../office/useOfficeSocket', () => ({
  useOfficeSocket: () => socketMockValue,
}))
```

No `beforeEach` (por volta da linha 148-150, logo após `vi.useRealTimers()`), adicione o reset:

```tsx
    vi.useRealTimers()
    socketMockValue = { occupants, youId: 'ana', connected: true }
    apiFetchMock.mockReset()
```

Localize a função `renderPage` (por volta das linhas 136-145):

```tsx
function renderPage(queryClient = createTestQueryClient()) {
  queryClient.setQueryData(['office', 'active-map'], activeMap)
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OfficePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
```

Substitua por (aceita um mapa alternativo, default o `activeMap` de sempre — chamadas existentes de `renderPage()`/`renderPage(queryClient)` continuam idênticas):

```tsx
function renderPage(queryClient = createTestQueryClient(), map: ActiveOfficeMapDTO = activeMap) {
  queryClient.setQueryData(['office', 'active-map'], map)
  apiFetchMock.mockImplementation((path: string) =>
    path === '/users'
      ? Promise.resolve({ users: [] })
      : path === '/office/map'
        ? Promise.resolve(map)
        : Promise.resolve({ broadcastEnabled: false, activeMapPublicationId: 'publication-1' }),
  )
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OfficePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
```

Note que o `apiFetchMock.mockImplementation` que já existe dentro do `beforeEach` (linhas 151-157) continua lá, definindo o comportamento PADRÃO antes de cada teste; `renderPage` só o sobrescreve quando chamado (com o mesmo `activeMap` por padrão, ou um mapa customizado quando passado explicitamente) — nenhum teste existente muda de comportamento.

- [ ] **Step 4: Adicionar o fixture de mapa com sala de reunião**

Logo após a declaração de `activeMap` (por volta da linha 63, após o `}` que a fecha), adicione:

```tsx
const meetingRoomMap: ActiveOfficeMapDTO = {
  ...activeMap,
  document: {
    ...activeMap.document,
    objects: [
      ...activeMap.document.objects,
      {
        id: 'room-1',
        layerKey: 'meeting-rooms',
        type: 'meeting-room',
        geometry: { kind: 'rectangle', x: 320, y: 416, width: 96, height: 96 },
        properties: {
          externalKey: 'sala-1',
          name: 'Sala de Reunião',
          status: 'OPEN',
          voiceEnabled: true,
          accessPolicy: 'OPEN',
        },
      },
    ],
  },
}
```

(A sala cobre a posição de Ana — tile `x: 11, y: 14`, cujo centro em pixels é `11*32+16=368, 14*32+16=464` — dentro do retângulo `x:320,y:416,width:96,height:96`.)

- [ ] **Step 5: Escrever os testes que falham**

Adicione ao final do `describe('OfficePage', ...)`, antes do fechamento (após o último `it` existente):

```tsx
  it('sem estar em sala de reunião, o botão de grade não aparece', () => {
    renderPage()
    expect(screen.queryByRole('button', { name: 'Abrir grade de câmeras' })).not.toBeInTheDocument()
  })

  it('dentro de uma sala de reunião, o botão de grade aparece com o contador de participantes da sala', () => {
    renderPage(createTestQueryClient(), meetingRoomMap)
    expect(screen.getByRole('button', { name: 'Abrir grade de câmeras' })).toHaveTextContent('1 na sala')
  })

  it('clicar no botão de grade abre a grade expandida de câmeras', () => {
    renderPage(createTestQueryClient(), meetingRoomMap)

    fireEvent.click(screen.getByRole('button', { name: 'Abrir grade de câmeras' }))

    expect(screen.getByRole('region', { name: 'Câmeras em tela cheia' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Recolher grade de câmeras' })).toBeInTheDocument()
  })
```

- [ ] **Step 6: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web exec vitest run src/pages/OfficePage.test.tsx`
Expected: os 3 testes novos falham (botão de grade ainda não existe).

- [ ] **Step 7: Rodar os testes e confirmar que passam**

Depois de aplicar os Steps 1-2 deste task, rode:

Run: `pnpm --filter @legends/web exec vitest run src/pages/OfficePage.test.tsx`
Expected: todos os testes (pré-existentes + os 3 novos) passam.

- [ ] **Step 8: Rodar a suíte completa do web**

Run: `pnpm --filter @legends/web test -- --run`
Expected: todos os testes passam.

- [ ] **Step 9: Rodar o typecheck**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 10: Verificação manual**

Suba a stack local (`pnpm db:up` se necessário, depois `pnpm dev`), entre no escritório, vá pra uma sala de reunião. Confirme: o botão de grade aparece no canto superior direito com o contador correto de gente na sala; clicar abre a grade em tela cheia mostrando avatar de quem não tem câmera; ligar a câmera troca o avatar pelo vídeo; saia da sala e confirme que o botão some (e, se a grade estava aberta sem ninguém com câmera ativa, ela se recolhe sozinha).

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/pages/OfficePage.tsx apps/web/src/pages/OfficePage.test.tsx
git commit -m "feat(office): botão de grade + contador de participantes dentro da sala"
```

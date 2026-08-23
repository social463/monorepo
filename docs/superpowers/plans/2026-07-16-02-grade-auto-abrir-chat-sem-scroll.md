# Grade da sala: auto-abrir com tela compartilhada, chat default, grid sem scroll — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A grade de câmeras da sala passa a abrir sozinha quando há alguém
compartilhando tela (ao entrar na sala, ou quando o compartilhamento começa
depois), o painel lateral nasce sempre no chat, e a área de câmeras nunca
tem scroll — divide o espaço disponível em N partes iguais conforme a
quantidade de tiles.

**Architecture:** `OfficePage.tsx` ganha um efeito que detecta as bordas de
transição (entrou na sala com tela ativa / tela começou agora) via refs, e
troca o efeito de reset do painel por um que sempre define `'chat'` quando a
grade abre. `MediaTiles.tsx` troca o grid uniforme (`auto-fit,
minmax(240px,1fr)` + scroll) por um grid com `gridTemplateColumns`/
`gridTemplateRows` calculados a partir de `Math.ceil(Math.sqrt(N))`, e a
coluna de miniaturas do modo destaque troca `overflow-y-auto` por
`flex-1 min-h-0` em cada miniatura (divide a altura igualmente). Nenhuma
mudança na lógica de `resolveFeatured`/`buildTiles` (já prioriza tela
compartilhada).

**Tech Stack:** React 18 + Tailwind (frontend), Vitest + Testing Library.

## Global Constraints

- Chat é o painel padrão em QUALQUER abertura da grade (manual ou
  automática) — nunca `null`/`'people'` ao abrir.
- Auto-abertura por tela compartilhada é por BORDA de transição (entrou na
  sala já com tela ativa, OU uma tela começou agora) — nunca reforça
  `camerasExpanded=true` enquanto o MESMO compartilhamento já ativo
  continua sem mudança (não briga com um fechamento manual do usuário).
- Sem tela compartilhada nenhuma, entrar na sala não abre a grade sozinha
  (comportamento inalterado nesse caso).
- A área de câmeras (destaque + miniaturas, e grid uniforme) nunca tem
  scroll — divide o espaço disponível, não cresce além dele. O painel
  lateral (chat/pessoas) continua rolando normalmente — a regra é só da
  área de câmeras.
- Nenhuma mudança na lógica de `resolveFeatured`/`buildTiles`/pin de
  destaque.
- Mensagens/strings voltadas ao usuário em português.

---

### Task 1: `OfficePage` — auto-abrir grade com tela compartilhada + chat por padrão

**Files:**
- Modify: `apps/web/src/pages/OfficePage.tsx`
- Test: `apps/web/src/pages/OfficePage.test.tsx`

**Interfaces:**
- Consumes: `media.remotes` (já existente, `RemoteMedia[]` com campo
  `screenTrack`); `camerasExpanded`/`inMeetingRoom` (já existentes).
- Produces: nenhuma API nova — só comportamento.

- [ ] **Step 1: Atualizar o mock de `useOfficeMedia` em `OfficePage.test.tsx` pra ser mutável**

Em `apps/web/src/pages/OfficePage.test.tsx`, localizar:

```tsx
vi.mock('../office/media/useOfficeMedia', () => ({
  useOfficeMedia: () => ({
    status: 'connected',
    roomName: 'office-open',
    micEnabled: false,
    micError: false,
    cameraEnabled: false,
    cameraError: false,
    screenShareEnabled: false,
    screenShareError: false,
    remotes: [],
    localCameraTrack: null,
    toggleMic: async () => {},
    toggleCamera: async () => {},
    toggleScreenShare: async () => {},
    applyMicEnabled: async () => {},
  }),
}))
```

Substituir por (mesmo padrão mutável já usado por `socketMockValue`):

```tsx
function defaultMediaMock() {
  return {
    status: 'connected',
    roomName: 'office-open',
    micEnabled: false,
    micError: false,
    cameraEnabled: false,
    cameraError: false,
    screenShareEnabled: false,
    screenShareError: false,
    remotes: [] as Array<{
      userId: string
      name: string
      audioTrack: unknown
      cameraTrack: unknown
      screenTrack: unknown
    }>,
    localCameraTrack: null,
    toggleMic: async () => {},
    toggleCamera: async () => {},
    toggleScreenShare: async () => {},
    applyMicEnabled: async () => {},
  }
}
let mediaMockValue = defaultMediaMock()
vi.mock('../office/media/useOfficeMedia', () => ({
  useOfficeMedia: () => mediaMockValue,
}))

/** Track falso: só precisa responder a attach/detach, chamado no efeito do VideoTile. */
function fakeVideoTrack() {
  return { attach: () => {}, detach: () => {} }
}
```

No `beforeEach`, adicionar o reset (junto do reset de `socketMockValue`):

```tsx
  beforeEach(() => {
    vi.useRealTimers()
    socketMockValue = { occupants, youId: 'ana', connected: true }
    mediaMockValue = defaultMediaMock()
    apiFetchMock.mockReset()
```

- [ ] **Step 2: `renderPage` passa a expor `rerenderPage`**

Localizar:

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

Substituir por (guarda o elemento renderizado pra permitir forçar um
re-render depois de mutar `mediaMockValue`, já que o hook mockado não é
reativo por si só):

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
  const ui = (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <OfficePage />
      </MemoryRouter>
    </QueryClientProvider>
  )
  const result = render(ui)
  return { ...result, rerenderPage: () => result.rerender(ui) }
}
```

- [ ] **Step 3: Atualizar os dois testes existentes afetados pelo novo default "chat"**

O chat agora nasce aberto por padrão sempre que a grade abre — dois testes
existentes assumiam que ela nascia sem painel (`roomPanel: null`).
Localizar:

```tsx
  it('abrir o chat da sala fecha a lista de pessoas, e vice-versa', () => {
    renderPage(createTestQueryClient(), meetingRoomMap)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir grade de câmeras' }))

    fireEvent.click(screen.getByRole('button', { name: 'Abrir chat da sala' }))
    expect(screen.getByText('Chat da sala')).toBeInTheDocument()
    expect(screen.queryByText(/Pessoas na sala/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Abrir pessoas da sala' }))
    expect(screen.queryByText('Chat da sala')).not.toBeInTheDocument()
    expect(screen.getByText(/Pessoas na sala/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Fechar pessoas da sala' }))
    expect(screen.queryByText(/Pessoas na sala/)).not.toBeInTheDocument()
  })

  it('fechar a grade de câmeras fecha também o painel lateral', () => {
    renderPage(createTestQueryClient(), meetingRoomMap)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir grade de câmeras' }))
    fireEvent.click(screen.getByRole('button', { name: 'Abrir chat da sala' }))
    expect(screen.getByText('Chat da sala')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Recolher grade de câmeras' }))
    fireEvent.click(screen.getByRole('button', { name: 'Abrir grade de câmeras' }))

    expect(screen.queryByText('Chat da sala')).not.toBeInTheDocument()
  })
```

Substituir por:

```tsx
  it('a grade nasce com o chat aberto por padrão; abrir pessoas fecha o chat, e vice-versa', () => {
    renderPage(createTestQueryClient(), meetingRoomMap)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir grade de câmeras' }))

    expect(screen.getByText('Chat da sala')).toBeInTheDocument()
    expect(screen.queryByText(/Pessoas na sala/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Abrir pessoas da sala' }))
    expect(screen.queryByText('Chat da sala')).not.toBeInTheDocument()
    expect(screen.getByText(/Pessoas na sala/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Fechar pessoas da sala' }))
    expect(screen.queryByText(/Pessoas na sala/)).not.toBeInTheDocument()
  })

  it('fechar a grade reseta o painel — reabrir sempre volta pro chat, não herda "people"', () => {
    renderPage(createTestQueryClient(), meetingRoomMap)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir grade de câmeras' }))
    fireEvent.click(screen.getByRole('button', { name: 'Abrir pessoas da sala' }))
    expect(screen.getByText(/Pessoas na sala/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Recolher grade de câmeras' }))
    fireEvent.click(screen.getByRole('button', { name: 'Abrir grade de câmeras' }))

    expect(screen.getByText('Chat da sala')).toBeInTheDocument()
    expect(screen.queryByText(/Pessoas na sala/)).not.toBeInTheDocument()
  })
```

- [ ] **Step 4: Adicionar os testes novos de auto-abertura por tela compartilhada**

Adicionar, ao final do `describe('OfficePage', ...)`:

```tsx
  it('entrar numa sala com tela já compartilhada abre a grade sozinha, com a tela em destaque', () => {
    mediaMockValue = {
      ...mediaMockValue,
      remotes: [{ userId: 'bruno', name: 'Bruno Costa', audioTrack: null, cameraTrack: null, screenTrack: fakeVideoTrack() }],
    }
    renderPage(createTestQueryClient(), meetingRoomMap)

    expect(screen.getByRole('region', { name: 'Câmeras em tela cheia' })).toBeInTheDocument()
    expect(screen.getByTestId('featured-tile')).toHaveTextContent('Tela de Bruno Costa')
  })

  it('entrar numa sala sem tela compartilhada não abre a grade sozinha', () => {
    renderPage(createTestQueryClient(), meetingRoomMap)
    expect(screen.queryByRole('region', { name: 'Câmeras em tela cheia' })).not.toBeInTheDocument()
  })

  it('começar a compartilhar tela já dentro da sala abre a grade sozinha, mesmo se tinha sido fechada manualmente', () => {
    const { rerenderPage } = renderPage(createTestQueryClient(), meetingRoomMap)
    fireEvent.click(screen.getByRole('button', { name: 'Abrir grade de câmeras' }))
    fireEvent.click(screen.getByRole('button', { name: 'Recolher grade de câmeras' }))
    expect(screen.queryByRole('region', { name: 'Câmeras em tela cheia' })).not.toBeInTheDocument()

    mediaMockValue = {
      ...mediaMockValue,
      remotes: [{ userId: 'bruno', name: 'Bruno Costa', audioTrack: null, cameraTrack: null, screenTrack: fakeVideoTrack() }],
    }
    rerenderPage()

    expect(screen.getByRole('region', { name: 'Câmeras em tela cheia' })).toBeInTheDocument()
    expect(screen.getByTestId('featured-tile')).toHaveTextContent('Tela de Bruno Costa')
  })

  it('fechar a grade manualmente enquanto o MESMO compartilhamento continua ativo não a reabre sozinha', () => {
    mediaMockValue = {
      ...mediaMockValue,
      remotes: [{ userId: 'bruno', name: 'Bruno Costa', audioTrack: null, cameraTrack: null, screenTrack: fakeVideoTrack() }],
    }
    const { rerenderPage } = renderPage(createTestQueryClient(), meetingRoomMap)
    expect(screen.getByRole('region', { name: 'Câmeras em tela cheia' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Recolher grade de câmeras' }))
    rerenderPage()

    expect(screen.queryByRole('region', { name: 'Câmeras em tela cheia' })).not.toBeInTheDocument()
  })
```

- [ ] **Step 5: Rodar os testes e confirmar que os 4 novos falham e os 2 atualizados também (ainda sem a implementação)**

Run: `pnpm --filter @legends/web test -- OfficePage.test.tsx`
Expected: FAIL nos 6 testes acima (comportamento de auto-abertura e
default-chat ainda não existe).

- [ ] **Step 6: Implementar o efeito de auto-abertura por tela compartilhada**

Em `apps/web/src/pages/OfficePage.tsx`, adicionar o cálculo logo após
`roomOccupantCount`:

```tsx
  const roomOccupantCount = (local ? 1 : 0) + media.remotes.length
  const anyScreenShared = media.remotes.some((r) => r.screenTrack)
```

Adicionar os refs e o efeito de auto-abertura logo antes do efeito
existente que fecha o painel ao recolher a grade (ou seja, antes do
comentário `// Fechar a grade fecha também...`):

```tsx
  // Refs-espelho pra detectar BORDA de transição (entrou na sala agora /
  // compartilhamento começou agora) sem reforçar camerasExpanded=true a
  // cada render enquanto o mesmo estado continua — isso respeitaria um
  // fechamento manual do usuário caso não fosse por borda.
  const prevInMeetingRoomRef = useRef(inMeetingRoom)
  const prevAnyScreenSharedRef = useRef(anyScreenShared)

  useEffect(() => {
    const enteredRoom = inMeetingRoom && !prevInMeetingRoomRef.current
    const screenShareStarted = anyScreenShared && !prevAnyScreenSharedRef.current
    if (inMeetingRoom && anyScreenShared && (enteredRoom || screenShareStarted)) {
      setCamerasExpanded(true)
    }
    prevInMeetingRoomRef.current = inMeetingRoom
    prevAnyScreenSharedRef.current = anyScreenShared
  }, [inMeetingRoom, anyScreenShared])
```

- [ ] **Step 7: Painel lateral nasce sempre em "chat" quando a grade abre**

Localizar:

```tsx
  // Fechar a grade fecha também qualquer painel lateral aberto.
  useEffect(() => {
    if (!camerasExpanded) setRoomPanel(null)
  }, [camerasExpanded])
```

Substituir por:

```tsx
  // A grade sempre nasce no chat (manual ou automática); fechar zera o painel.
  useEffect(() => {
    setRoomPanel(camerasExpanded ? 'chat' : null)
  }, [camerasExpanded])
```

- [ ] **Step 8: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web test -- OfficePage.test.tsx`
Expected: PASS (todos os testes existentes + os 6 atualizados/novos).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/pages/OfficePage.tsx apps/web/src/pages/OfficePage.test.tsx
git commit -m "feat(web): grade auto-abre com tela compartilhada; painel nasce no chat"
```

---

### Task 2: `MediaTiles` — área de câmeras sem scroll, dividida em N partes iguais

**Files:**
- Modify: `apps/web/src/office/media/MediaTiles.tsx`
- Test: `apps/web/src/office/media/MediaTiles.test.tsx`

**Interfaces:**
- Consumes: nada novo — só reorganiza classes/estilo dos containers já
  existentes (`tiles`, `featured`, `AvatarTile`/`VideoTile`).
- Produces: nenhuma prop nova.

- [ ] **Step 1: Escrever os testes falhos**

Em `apps/web/src/office/media/MediaTiles.test.tsx`, adicionar ao final do
`describe('MediaTiles', ...)`:

```tsx
  it('grid uniforme com 1 tile usa 1 coluna e 1 linha (ocupa o espaço todo)', () => {
    render(<MediaTiles remotes={[remote({ cameraTrack: fakeVideoTrack() })]} expanded onToggleExpanded={vi.fn()} />)
    const grid = screen.getByTestId('uniform-grid')
    expect(grid).toHaveStyle({
      gridTemplateColumns: 'repeat(1, minmax(0, 1fr))',
      gridTemplateRows: 'repeat(1, minmax(0, 1fr))',
    })
  })

  it('grid uniforme com 2 tiles divide em 2 colunas, 1 linha', () => {
    const remotes = [
      remote({ userId: 'a', cameraTrack: fakeVideoTrack() }),
      remote({ userId: 'b', cameraTrack: fakeVideoTrack() }),
    ]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)
    const grid = screen.getByTestId('uniform-grid')
    expect(grid).toHaveStyle({
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gridTemplateRows: 'repeat(1, minmax(0, 1fr))',
    })
  })

  it('grid uniforme com 3 tiles usa 2 colunas, 2 linhas', () => {
    const remotes = [
      remote({ userId: 'a', cameraTrack: fakeVideoTrack() }),
      remote({ userId: 'b', cameraTrack: fakeVideoTrack() }),
      remote({ userId: 'c', cameraTrack: fakeVideoTrack() }),
    ]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)
    const grid = screen.getByTestId('uniform-grid')
    expect(grid).toHaveStyle({
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gridTemplateRows: 'repeat(2, minmax(0, 1fr))',
    })
  })

  it('grid uniforme com 4 tiles usa 2 colunas, 2 linhas', () => {
    const remotes = ['a', 'b', 'c', 'd'].map((id) => remote({ userId: id, cameraTrack: fakeVideoTrack() }))
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)
    const grid = screen.getByTestId('uniform-grid')
    expect(grid).toHaveStyle({
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gridTemplateRows: 'repeat(2, minmax(0, 1fr))',
    })
  })

  it('grid uniforme não usa mais auto-fit/minmax fixo nem overflow-y-auto (nunca deve rolar)', () => {
    render(<MediaTiles remotes={[remote({ cameraTrack: fakeVideoTrack() })]} expanded onToggleExpanded={vi.fn()} />)
    const grid = screen.getByTestId('uniform-grid')
    expect(grid.className).not.toContain('overflow-y-auto')
    expect(grid.className).not.toContain('auto-fit')
  })

  it('modo de destaque: coluna de miniaturas não tem mais overflow-y-auto (divide a altura igualmente entre as miniaturas)', () => {
    const remotes = [
      remote({ userId: 'a', name: 'Ana', screenTrack: fakeVideoTrack() }),
      remote({ userId: 'b', name: 'Bob', cameraTrack: fakeVideoTrack() }),
    ]
    render(<MediaTiles remotes={remotes} expanded onToggleExpanded={vi.fn()} />)
    const featured = screen.getByTestId('featured-tile')
    const thumbnailsColumn = featured.parentElement!.children[1] as HTMLElement
    expect(thumbnailsColumn.className).not.toContain('overflow-y-auto')
  })
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web test -- MediaTiles.test.tsx`
Expected: FAIL — `getByTestId('uniform-grid')` não existe ainda; a coluna
de miniaturas ainda tem `overflow-y-auto`.

- [ ] **Step 3: Implementar o grid uniforme sem scroll**

Em `apps/web/src/office/media/MediaTiles.tsx`, adicionar o cálculo de
colunas/linhas logo após `const tiles = buildTiles(remotes, local)`:

```tsx
  const tiles = buildTiles(remotes, local)
  const gridCols = Math.max(1, Math.ceil(Math.sqrt(tiles.length)))
  const gridRows = Math.max(1, Math.ceil(tiles.length / gridCols))
```

Localizar o bloco do grid uniforme (branch `else` do `featured ? (...) :
(...)`):

```tsx
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
```

Substituir por:

```tsx
                <div
                  className="grid h-full w-full gap-md"
                  data-testid="uniform-grid"
                  style={{
                    gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
                    gridTemplateRows: `repeat(${gridRows}, minmax(0, 1fr))`,
                  }}
                >
                  {tiles.map((tile) =>
                    tile.kind === 'avatar' ? (
                      <AvatarTile
                        key={tile.key}
                        user={tile.avatar}
                        label={tile.label}
                        className="flex h-full min-h-0 min-w-0 flex-col"
                        fill
                        onClick={() => setFeaturedPin(tile.key)}
                      />
                    ) : (
                      <VideoTile
                        key={tile.key}
                        track={tile.track!}
                        label={tile.label}
                        mirrored={tile.mirrored}
                        className="flex h-full min-h-0 min-w-0 flex-col"
                        videoClassName="min-h-0 flex-1 object-contain"
                        onClick={() => setFeaturedPin(tile.key)}
                      />
                    ),
                  )}
                </div>
```

- [ ] **Step 4: Implementar a coluna de miniaturas sem scroll (modo destaque)**

Localizar:

```tsx
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
```

Substituir por:

```tsx
                  <div className="flex h-full w-56 shrink-0 flex-col gap-sm">
                    {tiles
                      .filter((t) => t.key !== featured.key)
                      .map((t) =>
                        t.kind === 'avatar' ? (
                          <AvatarTile
                            key={t.key}
                            user={t.avatar}
                            label={t.label}
                            className="flex min-h-0 flex-1 flex-col"
                            fill
                            onClick={() => setFeaturedPin(t.key)}
                          />
                        ) : (
                          <VideoTile
                            key={t.key}
                            track={t.track!}
                            label={t.label}
                            mirrored={t.mirrored}
                            className="flex min-h-0 flex-1 flex-col"
                            videoClassName="min-h-0 flex-1 object-contain"
                            onClick={() => setFeaturedPin(t.key)}
                          />
                        ),
                      )}
                  </div>
```

- [ ] **Step 5: Área central nunca rola (o conteúdo já cabe exatamente)**

Localizar:

```tsx
            <div className="min-w-0 flex-1 overflow-y-auto p-lg">
```

Substituir por:

```tsx
            <div className="min-w-0 flex-1 overflow-hidden p-lg">
```

- [ ] **Step 6: Rodar TODOS os testes de `MediaTiles.test.tsx` e confirmar que passam**

Run: `pnpm --filter @legends/web test -- MediaTiles.test.tsx`
Expected: PASS — os 23 testes já existentes (destaque/grid/auto-recolhimento/
Escape/portal/painel lateral) continuam passando, mais os 6 novos deste
task.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/office/media/MediaTiles.tsx apps/web/src/office/media/MediaTiles.test.tsx
git commit -m "feat(web): grade de câmeras nunca rola — divide o espaço em N partes iguais"
```

---

## Verificação manual (opcional, recomendada antes de considerar pronto)

Suba `pnpm dev`, entre numa sala de reunião com duas abas/contas; com uma
delas compartilhando tela ANTES da outra entrar, confirme que a segunda
pessoa já entra com a grade aberta e a tela em destaque, e o chat já
visível. Feche a grade manualmente e confirme que ela não reabre sozinha
enquanto a mesma tela continua compartilhada; pare e reinicie o
compartilhamento e confirme que ela reabre. Com 1, 2, 3 e 4 pessoas com
câmera ligada (sem tela compartilhada), confirme visualmente que a grade
uniforme nunca precisa de scroll, dividindo o espaço em partes cada vez
menores.

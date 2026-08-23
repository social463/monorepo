# Faixa de câmeras mostra presença em sala Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dentro de uma sala/zona de reunião, a faixa compacta de câmeras (`MediaTiles`) passa a aparecer sempre que há alguém presente na sala (você e/ou remotos), mesmo sem câmera/tela ativas — quem não tem câmera ligada vira um tile de avatar. Fora de sala (espaço aberto), nada muda.

**Architecture:** `MediaTiles` ganha um prop `showAllPresent: boolean`. A faixa compacta para de montar `VideoTile`s manualmente a partir de `remotes`/`local` e passa a iterar sobre `tiles` (já produzido por `buildTiles`, hoje só usado na grade expandida), renderizando `AvatarTile` para quem não tem mídia. O gate `hasVisible` que decide se a faixa aparece muda de "existe câmera/tela ativa" para "existe qualquer tile" quando `showAllPresent` é true. `OfficePage.tsx` passa `showAllPresent={inMeetingRoom}` (já calculado hoje via `mapZoneAt`) e espelha a mesma regra em `topMediaVisible`.

**Tech Stack:** React 18 + TypeScript, Vitest + Testing Library (`apps/web`).

## Global Constraints

- Espaço aberto (fora de zona) mantém comportamento idêntico ao atual — só a faixa dentro de sala/zona muda.
- Reusar `AvatarTile`/`buildTiles` já existentes em `MediaTiles.tsx` — não criar componente novo de avatar.
- Nenhuma mudança na camada de conexão LiveKit (`useOfficeMedia.ts`) — `remotes` já reflete quem está na sala.
- Mensagens/labels voltados ao usuário em português (não há novas strings neste plano).

---

### Task 1: `MediaTiles` — faixa compacta mostra presença sem mídia quando `showAllPresent`

**Files:**
- Modify: `apps/web/src/office/media/MediaTiles.tsx:145-249` (props, `hasVisible`, render da faixa compacta)
- Test: `apps/web/src/office/media/MediaTiles.test.tsx`

**Interfaces:**
- Consumes: `buildTiles(remotes, local)` (já existe, `MediaTiles.tsx:85-126`), `AvatarTile`/`VideoTile` (já existem).
- Produces: novo prop público `MediaTiles({ ..., showAllPresent?: boolean })`, default `false` — usado por `OfficePage.tsx` na Task 2.

- [ ] **Step 1: Escrever os testes que falham para o novo comportamento**

Adicione ao final de `apps/web/src/office/media/MediaTiles.test.tsx` (antes do fechamento do `describe`, após o último `it`):

```tsx
  it('showAllPresent=true: local sozinho sem câmera já é suficiente pra mostrar a faixa como avatar', () => {
    const { container } = render(
      <MediaTiles remotes={[]} local={{ track: null, name: 'Você' }} showAllPresent />,
    )
    const strip = container.querySelector('.bg-surface-container')
    expect(strip).not.toBeNull()
    expect(strip).toHaveTextContent('Você')
    expect(strip?.querySelector('video')).toBeNull()
  })

  it('showAllPresent=true: remoto sem câmera/tela aparece na faixa compacta como avatar', () => {
    const remotes = [remote({ userId: 'b', name: 'Bob' })]
    const { container } = render(<MediaTiles remotes={remotes} showAllPresent />)

    const strip = container.querySelector('.bg-surface-container')
    expect(strip).not.toBeNull()
    expect(strip).toHaveTextContent('Bob')
    expect(strip?.querySelector('video')).toBeNull()
  })

  it('showAllPresent=true: sem local e sem remotos, a faixa não aparece', () => {
    const { container } = render(<MediaTiles remotes={[]} showAllPresent />)
    expect(container.querySelector('.bg-surface-container')).toBeNull()
  })

  it('showAllPresent=false (default): presença sem mídia continua não sendo suficiente pra mostrar a faixa', () => {
    const remotes = [remote({ userId: 'b', name: 'Bob' })]
    const { container } = render(<MediaTiles remotes={remotes} />)
    expect(container.querySelector('.bg-surface-container')).toBeNull()
  })

  it('showAllPresent=true: quem tem câmera continua mostrando vídeo normalmente na faixa compacta', () => {
    const remotes = [remote({ userId: 'a', name: 'Ana', cameraTrack: fakeVideoTrack() })]
    const { container } = render(<MediaTiles remotes={remotes} showAllPresent />)

    const strip = container.querySelector('.bg-surface-container')
    expect(strip).not.toBeNull()
    expect(strip?.querySelector('video')).not.toBeNull()
  })
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/MediaTiles.test.tsx`
Expected: os 5 testes novos falham (faixa não aparece para presença sem mídia quando `showAllPresent` está true; prop `showAllPresent` ainda não existe).

- [ ] **Step 3: Adicionar o prop `showAllPresent` e ajustar `hasVisible`**

Em `apps/web/src/office/media/MediaTiles.tsx`, ajuste a assinatura de `MediaTiles` (linhas 145-162) para aceitar o novo prop:

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

Mova `const tiles = buildTiles(remotes, local)` (hoje na linha 190) para **antes** de `hasVisible`, e substitua a definição de `hasVisible` (linha 182) por:

```tsx
  const tiles = buildTiles(remotes, local)

  // Dentro de sala/zona (showAllPresent), presença já basta — quem não tem
  // câmera/tela vira tile de avatar. Fora de sala, só mídia ativa conta.
  const hasVisible = showAllPresent ? tiles.length > 0 : tiles.some((t) => t.kind !== 'avatar')
```

Remova a linha antiga `const tiles = buildTiles(remotes, local)` que ficava depois do efeito de auto-recolhimento (não deve sobrar duplicada).

- [ ] **Step 4: Trocar a renderização manual da faixa compacta por iteração sobre `tiles`**

Substitua o bloco da faixa compacta (dentro de `{hasVisible && !expanded && (...)}`, hoje montando `VideoTile`s na mão a partir de `local`/`remotes`) por:

```tsx
      {hasVisible && !expanded && (
        <div className="flex items-center gap-sm rounded-lg bg-surface-container p-md">
          <div className="flex flex-1 gap-md overflow-x-auto">
            {tiles.map((t) =>
              t.kind === 'avatar' ? (
                <AvatarTile key={t.key} user={t.avatar} label={t.label} />
              ) : (
                <VideoTile
                  key={t.key}
                  track={t.track!}
                  label={t.label}
                  mirrored={t.mirrored}
                  onClick={t.kind === 'screen' ? () => setExpandedId(t.avatar.userId) : undefined}
                />
              ),
            )}
          </div>
          <button
            type="button"
            aria-label="Expandir câmeras"
            onClick={onToggleExpanded}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-highest"
          >
            <Icon name="fullscreen" className="text-[20px]" />
          </button>
        </div>
      )}
```

Note que `t.avatar` é sempre um `RemoteMedia` ou o objeto `local` — ambos têm `userId`... na verdade `local` (o objeto passado pra `MediaTiles`) **não** tem `userId`. Para o clique de tela expandir por `userId`, use `r.userId` apenas quando `t.avatar` for um remoto: como só tiles `screen` vêm de `remotes` (veja `buildTiles`, local nunca gera tile `screen`), é seguro castar. Ajuste a chamada de clique para:

```tsx
                  onClick={t.kind === 'screen' ? () => setExpandedId((t.avatar as RemoteMedia).userId) : undefined}
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web exec vitest run src/office/media/MediaTiles.test.tsx`
Expected: todos os testes (os pré-existentes e os 5 novos) passam.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/office/media/MediaTiles.tsx apps/web/src/office/media/MediaTiles.test.tsx
git commit -m "feat(office): faixa de câmeras mostra presença em sala mesmo sem mídia ativa"
```

---

### Task 2: `OfficePage` — ligar `showAllPresent` a `inMeetingRoom` e ajustar `topMediaVisible`

**Files:**
- Modify: `apps/web/src/pages/OfficePage.tsx:78-82` (cálculo de `topMediaVisible`), `apps/web/src/pages/OfficePage.tsx` (chamada de `<MediaTiles>`)

**Interfaces:**
- Consumes: `MediaTiles({ showAllPresent })` da Task 1; `inMeetingRoom` (já existe, `OfficePage.tsx:62`); `media.remotes` (`RemoteMedia[]`, já existe).
- Produces: nada consumido por tarefas futuras — última tarefa do plano.

- [ ] **Step 1: Localizar a chamada atual de `<MediaTiles>` em `OfficePage.tsx`**

Run: `grep -n "MediaTiles" apps/web/src/pages/OfficePage.tsx`
Expected: uma ocorrência do import (linha 14) e uma do uso do componente (JSX), a ser localizada para o próximo passo.

- [ ] **Step 2: Atualizar `topMediaVisible` e passar `showAllPresent` pro componente**

Substitua o bloco de `topMediaVisible` (linhas 78-82):

```tsx
  // Mesma condição que o MediaTiles usa internamente pra decidir se a faixa
  // do topo aparece — calculada aqui só pra avisar o BroadcastBanner, sem
  // expor o hasVisible do MediaTiles pra fora dele. Em sala/zona, presença já
  // basta (ver MediaTiles/showAllPresent); no espaço aberto, só mídia ativa.
  const topMediaVisible = inMeetingRoom
    ? local !== null || media.remotes.length > 0
    : !!selfCamera || media.remotes.some((r) => r.cameraTrack || r.screenTrack)
```

Na chamada JSX de `<MediaTiles>`, adicione o prop `showAllPresent={inMeetingRoom}` junto aos props já existentes (`remotes`, `local`, `expanded`, `onToggleExpanded`).

- [ ] **Step 3: Rodar a suíte de testes do web**

Run: `pnpm --filter @legends/web test`
Expected: todos os testes passam, incluindo `MediaTiles.test.tsx` e qualquer teste de `OfficePage` existente.

- [ ] **Step 4: Verificação manual**

Suba a stack local (`pnpm db:up` se ainda não estiver, depois `pnpm dev`), entre no escritório com dois usuários (duas abas/sessões), mova ambos pra dentro de uma sala de reunião no mapa sem ligar câmera, e confirme visualmente que a faixa aparece no topo mostrando os dois avatares (sem vídeo). Ligue a câmera de um dos dois e confirme que o tile dele vira vídeo mantendo o outro como avatar. Saia da sala pro espaço aberto e confirme que a faixa some (comportamento antigo preservado).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/OfficePage.tsx
git commit -m "feat(office): mostrar faixa de câmeras por presença ao entrar em sala de reunião"
```

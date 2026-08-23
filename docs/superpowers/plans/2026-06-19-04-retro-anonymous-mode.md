# Modo anônimo (ocultar conteúdo) controlável no board — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O facilitador liga/desliga o modo anônimo de dentro do board em tempo real; quando ON, os outros participantes veem os cards alheios com o texto mascarado (barras), mantendo o autor visível, e cada um sempre vê/edita o próprio card.

**Architecture:** Reusa o flag `anonymous` da sala, redefinindo-o para **mascarar o conteúdo** (não o autor). Mascaração feita na serialização por-viewer (servidor não envia o texto alheio). Toggle via endpoint do facilitador (espelha `advancePhase`) + evento de socket `anonymous.changed`; clientes refazem o GET da sala para obter os cards corretamente mascarados/revelados.

**Tech Stack:** TS ESM monorepo; Fastify + Prisma + Postgres (api); React 18 + React Query + Tailwind (web); tipos em `@legends/shared`. Vitest (api contra Postgres real; web jsdom).

## Global Constraints

- TypeScript **strict**, ESM. Mensagens ao usuário em **português**.
- **Sem migration** — a coluna `RetroRoom.anonymous: Boolean` já existe.
- Camadas finas: route → service → Prisma; DTO em `serialize.ts`; contrato em `@legends/shared` (mudar o tipo primeiro).
- Privacidade no servidor: com `anonymous` ON, o texto de card de outro autor **não** é enviado (`text: ''`, `masked: true`).
- Redefinição consciente do `anonymous`: passa a **ocultar conteúdo** (texto) e o **autor fica sempre visível** (antes anulava o autor).
- Toggle só pelo **facilitador** (`room.createdById`), sala `OPEN`.
- Testes da API exigem **Postgres de pé** (`pnpm db:up`); `pnpm --filter @legends/api test`.
- Spec: `docs/superpowers/specs/2026-06-19-retro-anonymous-mode-design.md`.

## Mapa de arquivos

- Modify: `packages/shared/src/retro.ts` — `RetroCardDTO.masked?: boolean`; `RetroEvent` `anonymous.changed`.
- Modify: `apps/api/src/lib/serialize.ts` — `toRetroCardDTO` mascara texto, autor sempre real, seta `masked`.
- Modify: `apps/api/src/services/retro-service.ts` — `setAnonymous`.
- Modify: `apps/api/src/routes/retro.ts` — `POST /retro/rooms/:id/anonymous` + broadcast.
- Test: `apps/api/src/routes/retro.test.ts`.
- Modify: `apps/web/src/pages/retro/PostIt.tsx` — render mascarado (barras). Test: `PostIt.test.tsx`.
- Modify: `apps/web/src/lib/retro-api.ts` — `toggleRetroAnonymous`.
- Modify: `apps/web/src/lib/useRetroSocket.ts` — tratar `anonymous.changed` (cache + invalidate).
- Modify: `apps/web/src/pages/RetroRoomPage.tsx` — mutation + botão (facilitador) + chip. Test: `RetroRoomPage.test.tsx`.

**Ordem:** Task 1 (contrato) → Task 2 (api) / Task 3 (PostIt) / Task 4 (web wiring). Tasks 2–4 dependem do contrato; entre si são independentes.

---

### Task 1: Contrato compartilhado (`masked` + evento `anonymous.changed`)

**Files:**
- Modify: `packages/shared/src/retro.ts`

**Interfaces:**
- Produces: `RetroCardDTO.masked?: boolean` (ausente/false = visível; true = conteúdo oculto, `text` vem `''`). `RetroEvent` ganha `{ type: 'anonymous.changed'; anonymous: boolean }`.

- [ ] **Step 1: Add `masked` to RetroCardDTO**

Em `packages/shared/src/retro.ts`, no `interface RetroCardDTO`, troque o comentário do `author` e adicione `masked` (logo após `mine`):

```ts
  /** Autor do card (sempre presente quando conhecido). */
  author: { id: string; name: string } | null
  mine: boolean
  /** true quando o modo anônimo está ON e o card é de outro autor: `text` vem ''. */
  masked?: boolean
```

- [ ] **Step 2: Add the `anonymous.changed` event**

No `export type RetroEvent`, adicione (junto dos autoritativos, ex. após `phase.changed`):

```ts
  | { type: 'anonymous.changed'; anonymous: boolean }
```

- [ ] **Step 3: Build the shared package (type-check)**

Run: `pnpm --filter @legends/web build`
Expected: type-clean (web compila com o contrato novo; `masked` é opcional, então nada quebra).

> Não há teste unitário aqui (mudança só de tipos). `RetroRoomDTO.anonymous` permanece.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/retro.ts
git commit -m "feat(shared): RetroCardDTO.masked + evento anonymous.changed"
```

---

### Task 2: API — mascarar conteúdo + endpoint de toggle do facilitador

**Files:**
- Modify: `apps/api/src/lib/serialize.ts`
- Modify: `apps/api/src/services/retro-service.ts`
- Modify: `apps/api/src/routes/retro.ts`
- Test: `apps/api/src/routes/retro.test.ts`

**Interfaces:**
- Consumes: `RetroCardDTO.masked`, evento `anonymous.changed` (Task 1).
- Produces: `setAnonymous({ roomId, userId, anonymous })` no service; rota `POST /retro/rooms/:id/anonymous` (facilitador) que persiste, faz `retroHub.broadcast(... { type: 'anonymous.changed', anonymous })` e retorna `{ room: RetroRoomDTO }`. `toRetroCardDTO` agora seta `masked` e mascara `text`.

- [ ] **Step 1: Update `toRetroCardDTO` (mascara texto, autor sempre real)**

Em `apps/api/src/lib/serialize.ts`, substitua o corpo de `toRetroCardDTO` por:

```ts
export function toRetroCardDTO(
  card: RetroCardWithRelations,
  ctx: { viewerId: string; anonymous: boolean },
): RetroCardDTO {
  const masked = ctx.anonymous && card.authorId !== ctx.viewerId
  return {
    id: card.id,
    text: masked ? '' : card.text,
    x: card.x,
    y: card.y,
    color: card.color as RetroCardDTO['color'],
    author: { id: card.author.id, name: card.author.name },
    mine: card.authorId === ctx.viewerId,
    masked,
    voteCount: card.votes.length,
    myVotes: card.votes.filter((v) => v.userId === ctx.viewerId).length,
    reactions: summarizeRetroReactions(card.reactions, ctx.viewerId),
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
  }
}
```

- [ ] **Step 2: Add `setAnonymous` to the service**

Em `apps/api/src/services/retro-service.ts`, logo após `advancePhase`, adicione:

```ts
export async function setAnonymous(input: {
  roomId: string
  userId: string
  anonymous: boolean
}): Promise<RetroRoomWithRelations> {
  const room = await loadRoom(input.roomId)
  if (room.createdById !== input.userId) throw new RetroError('Apenas o facilitador muda o modo anônimo.', 403)
  if (room.status !== 'OPEN') throw new RetroError('Sala não está aberta.', 409)
  await prisma.retroRoom.update({ where: { id: room.id }, data: { anonymous: input.anonymous } })
  return loadRoom(room.id)
}
```

- [ ] **Step 3: Add the route + Zod schema + import**

Em `apps/api/src/routes/retro.ts`:

(a) No import do service, adicione `setAnonymous` (junto de `advancePhase`).

(b) Perto dos outros schemas (ex. após `const reactionSchema = ...`), adicione:

```ts
const anonymousSchema = z.object({ anonymous: z.boolean() })
```

(c) Logo após o handler `app.post('/retro/rooms/:id/phase', ...)`, adicione:

```ts
  app.post('/retro/rooms/:id/anonymous', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = anonymousSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...badBody, issues: parsed.error.flatten() })
    const { id } = request.params as { id: string }
    try {
      const room = await setAnonymous({ roomId: id, userId: request.user.sub, anonymous: parsed.data.anonymous })
      retroHub.broadcast(room.id, () => ({ type: 'anonymous.changed', anonymous: room.anonymous }))
      return reply.send({ room: toRetroRoomDTO(room, { id: request.user.sub }, 'FACILITATOR') })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
```

- [ ] **Step 4: Write the API test**

Em `apps/api/src/routes/retro.test.ts`, adicione um `it` (reaproveitando os fixtures `lead`/`dev` já usados no arquivo — mesmos `lead.token`/`dev.token`/`dev.id`):

```ts
  it('facilitador alterna o modo anônimo e mascara o conteúdo dos outros', async () => {
    const created = await app.inject({
      method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${lead.token}` },
      payload: { title: 'A', anonymous: false, votesPerParticipant: 3, participantIds: [dev.id] },
    })
    const roomId = created.json().room.id
    const card = await app.inject({
      method: 'POST', url: `/retro/rooms/${roomId}/cards`, headers: { authorization: `Bearer ${dev.token}` },
      payload: { text: 'segredo', color: 'green', x: 0, y: 0 },
    })
    const cardId = card.json().card.id

    // participante não pode alternar
    const forbidden = await app.inject({
      method: 'POST', url: `/retro/rooms/${roomId}/anonymous`, headers: { authorization: `Bearer ${dev.token}` },
      payload: { anonymous: true },
    })
    expect(forbidden.statusCode).toBe(403)

    // facilitador liga
    const on = await app.inject({
      method: 'POST', url: `/retro/rooms/${roomId}/anonymous`, headers: { authorization: `Bearer ${lead.token}` },
      payload: { anonymous: true },
    })
    expect(on.statusCode).toBe(200)
    expect(on.json().room.anonymous).toBe(true)

    // lead (não-autor) vê mascarado; autor (dev) vê o texto; autor sempre presente
    const asLead = await app.inject({ method: 'GET', url: `/retro/rooms/${roomId}`, headers: { authorization: `Bearer ${lead.token}` } })
    const leadCard = asLead.json().room.cards.find((c: { id: string }) => c.id === cardId)
    expect(leadCard.masked).toBe(true)
    expect(leadCard.text).toBe('')
    expect(leadCard.author).toMatchObject({ id: dev.id })

    const asDev = await app.inject({ method: 'GET', url: `/retro/rooms/${roomId}`, headers: { authorization: `Bearer ${dev.token}` } })
    const devCard = asDev.json().room.cards.find((c: { id: string }) => c.id === cardId)
    expect(devCard.masked).toBe(false)
    expect(devCard.text).toBe('segredo')

    // desligar revela
    await app.inject({
      method: 'POST', url: `/retro/rooms/${roomId}/anonymous`, headers: { authorization: `Bearer ${lead.token}` },
      payload: { anonymous: false },
    })
    const revealed = await app.inject({ method: 'GET', url: `/retro/rooms/${roomId}`, headers: { authorization: `Bearer ${lead.token}` } })
    expect(revealed.json().room.cards.find((c: { id: string }) => c.id === cardId).text).toBe('segredo')
  })
```

> Se o arquivo criar `lead`/`dev` num `beforeEach`/helper, use os mesmos nomes; não recrie o harness.

- [ ] **Step 5: Run the API suite (Postgres up)**

Run: `pnpm db:up` (se necessário) e `pnpm --filter @legends/api test`
Expected: novo teste PASS; **toda a suite verde** (confirma que a mudança de autor-sempre-visível não quebrou asserções existentes).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/serialize.ts apps/api/src/services/retro-service.ts apps/api/src/routes/retro.ts apps/api/src/routes/retro.test.ts
git commit -m "feat(api): toggle de modo anônimo (facilitador) + mascarar conteúdo dos outros"
```

---

### Task 3: PostIt — render de card mascarado

**Files:**
- Modify: `apps/web/src/pages/retro/PostIt.tsx`
- Test: `apps/web/src/pages/retro/PostIt.test.tsx`

**Interfaces:**
- Consumes: `RetroCardDTO.masked` (Task 1).
- Produces: quando `card.masked`, o PostIt mostra barras (placeholder com `aria-label="conteúdo oculto"`) em vez do texto; autor e selos seguem.

- [ ] **Step 1: Write the failing test**

Em `apps/web/src/pages/retro/PostIt.test.tsx`, adicione (o `base`/`props` já existem no arquivo):

```tsx
  it('card mascarado esconde o texto e mostra o placeholder', () => {
    render(<PostIt card={{ ...base, mine: false, masked: true, text: '' }} {...props} />)
    expect(screen.queryByText('Deploy tranquilo')).toBeNull()
    expect(screen.getByLabelText('conteúdo oculto')).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/web exec vitest run src/pages/retro/PostIt.test.tsx`
Expected: FAIL — sem placeholder; ainda renderiza `<p>` (vazio, mas sem `aria-label`).

- [ ] **Step 3: Render the masked placeholder**

Em `apps/web/src/pages/retro/PostIt.tsx`, troque o bloco de exibição (o ternário `editing ? <textarea/> : <p/>`) por um que trate o caso mascarado:

```tsx
      {editing ? (
        <textarea
          autoFocus
          value={editingText}
          onChange={(e) => onEditChange(e.target.value)}
          onBlur={onEndEdit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onEndEdit()
            }
          }}
          className="flex-1 resize-none rounded bg-white/60 p-1 text-body-sm text-zinc-900 outline-none"
          rows={5}
        />
      ) : card.masked ? (
        <div className="flex-1 space-y-1.5 py-1" aria-label="conteúdo oculto">
          <span className="block h-2.5 w-5/6 rounded bg-zinc-400/50" />
          <span className="block h-2.5 w-2/3 rounded bg-zinc-400/50" />
          <span className="block h-2.5 w-3/4 rounded bg-zinc-400/50" />
        </div>
      ) : (
        <p className="flex-1 whitespace-pre-wrap break-words text-body-sm text-zinc-900">{card.text}</p>
      )}
```

> Cards `mine` nunca chegam com `masked: true` (servidor garante), então o ramo de edição e o mascarado não conflitam.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @legends/web exec vitest run src/pages/retro/PostIt.test.tsx`
Expected: PASS (inclui os testes existentes — `masked` é opcional, cards sem ele seguem mostrando texto).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/retro/PostIt.tsx apps/web/src/pages/retro/PostIt.test.tsx
git commit -m "feat(web): PostIt mostra placeholder quando o card está mascarado"
```

---

### Task 4: Web — toggle do facilitador, chip e sincronização via socket

**Files:**
- Modify: `apps/web/src/lib/retro-api.ts`
- Modify: `apps/web/src/lib/useRetroSocket.ts`
- Modify: `apps/web/src/pages/RetroRoomPage.tsx`
- Test: `apps/web/src/pages/RetroRoomPage.test.tsx`

**Interfaces:**
- Consumes: evento `anonymous.changed` (Task 1); endpoint `POST /retro/rooms/:id/anonymous` (Task 2).
- Produces: `toggleRetroAnonymous(id, anonymous)`; o board mostra botão de toggle (facilitador, sala OPEN) e um chip "Anônimo" para todos quando ativo; ao receber `anonymous.changed`, o cliente atualiza `room.anonymous` e refaz o GET.

- [ ] **Step 1: Add the API client function**

Em `apps/web/src/lib/retro-api.ts`, após `advanceRetroPhase`, adicione:

```ts
export function toggleRetroAnonymous(id: string, anonymous: boolean) {
  return apiFetch<{ room: RetroRoomDTO }>(`/retro/rooms/${id}/anonymous`, { method: 'POST', body: JSON.stringify({ anonymous }) })
}
```

- [ ] **Step 2: Handle `anonymous.changed` in the socket hook**

Em `apps/web/src/lib/useRetroSocket.ts`:

(a) Em `applyEvent`, adicione um case (antes do `default`) para refletir o estado no cache:

```ts
    case 'anonymous.changed':
      return { room: { ...room, anonymous: e.anonymous } }
```

(b) No handler `ws.onmessage`, logo após a linha que aplica o evento
(`qc.setQueryData<Cached>(['retro-room', roomId], (prev) => applyEvent(prev, e))`), adicione:

```ts
        if (e.type === 'anonymous.changed') qc.invalidateQueries({ queryKey: ['retro-room', roomId] })
```

> O `invalidate` refaz o GET para obter os cards já mascarados/revelados pelo servidor (vale ligar e desligar); o `applyEvent` atualiza `anonymous` na hora para o botão/chip reagirem antes do refetch.

- [ ] **Step 3: Update the page test**

Em `apps/web/src/pages/RetroRoomPage.test.tsx`:

(a) No `vi.mock('../lib/retro-api', ...)`, adicione à fábrica:

```ts
  toggleRetroAnonymous: vi.fn().mockResolvedValue({ room: { id: 'r1', title: 'Retro 1', status: 'OPEN', anonymous: true, votesPerParticipant: 3, createdAt: '', concludedAt: null, creator: { id: 'l1', name: 'Lia' }, participantCount: 2, myRole: 'FACILITATOR', participants: [], myRemainingVotes: 3, cards: [] } }),
```

(b) Permita renderizar com uma sala custom — troque a assinatura do helper:

```tsx
function renderPage(r: RetroRoomDTO = room) {
  vi.mocked(api.getRetroRoom).mockResolvedValue({ room: r })
```

(mantém o resto do corpo igual; chamadas existentes `renderPage()` seguem funcionando).

(c) Adicione os casos:

```tsx
  it('facilitador vê o toggle de modo anônimo e clicar chama a API', async () => {
    renderPage()
    await screen.findByRole('heading', { level: 2, name: 'Retro 1' })
    fireEvent.click(screen.getByRole('button', { name: /modo an[ôo]nimo/i }))
    await waitFor(() => expect(api.toggleRetroAnonymous).toHaveBeenCalledWith('r1', true))
  })

  it('mostra o chip "Anônimo" quando a sala está anônima', async () => {
    renderPage({ ...room, anonymous: true })
    await screen.findByRole('heading', { level: 2, name: 'Retro 1' })
    expect(screen.getByText('Anônimo')).toBeInTheDocument()
  })
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @legends/web exec vitest run src/pages/RetroRoomPage.test.tsx`
Expected: FAIL — não há botão de modo anônimo nem chip.

- [ ] **Step 5: Wire the mutation, button and chip in the page**

Em `apps/web/src/pages/RetroRoomPage.tsx`:

(a) No import de `../lib/retro-api`, adicione `toggleRetroAnonymous`.

(b) Junto das outras mutations (ex. após `concludeM`), adicione:

```tsx
  const toggleAnonM = useMutation({
    mutationFn: (anonymous: boolean) => toggleRetroAnonymous(id, anonymous),
    onSuccess: ({ room: r }) => patch((c) => ({ room: { ...c.room, anonymous: r.anonymous } })),
  })
```

(c) Na top bar, dentro do `<div className="flex items-center gap-md">`, logo antes do botão **Concluir**, adicione o chip (todos) e o botão (facilitador):

```tsx
          {room.anonymous && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 font-label text-label-sm text-primary">Anônimo</span>
          )}
          {isFacilitator && room.status === 'OPEN' && (
            <button
              type="button"
              onClick={() => toggleAnonM.mutate(!room.anonymous)}
              className="rounded-md border border-outline-variant/40 px-lg py-sm font-label text-on-surface-variant hover:bg-surface-container-highest"
            >
              {room.anonymous ? 'Modo anônimo: desativar' : 'Modo anônimo: ativar'}
            </button>
          )}
```

> `room` está em escopo aqui (JSX, após `const room = ...`); por isso a mutation recebe o valor `!room.anonymous` no `onClick` em vez de ler `room` dentro do `mutationFn`.

- [ ] **Step 6: Run test + full web build**

Run: `pnpm --filter @legends/web exec vitest run src/pages/RetroRoomPage.test.tsx` → PASS.
Run: `pnpm --filter @legends/web build` → type-clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/retro-api.ts apps/web/src/lib/useRetroSocket.ts apps/web/src/pages/RetroRoomPage.tsx apps/web/src/pages/RetroRoomPage.test.tsx
git commit -m "feat(web): toggle de modo anônimo no board + chip + sync via socket"
```

---

## Self-Review (autor)

**Cobertura do spec:**
- `masked` no DTO + evento `anonymous.changed` → Task 1.
- Mascarar conteúdo (autor sempre visível) na serialização → Task 2 (Step 1).
- Toggle do facilitador (403/409) + broadcast → Task 2 (service + route + test).
- Placeholder de barras → Task 3.
- Toggle/chip na UI + sync (cache + refetch) → Task 4.
- Sem migration; reusa `anonymous` → confirmado (nenhuma mudança em schema.prisma).

**Placeholder scan:** sem TODO/itens vagos; todo passo tem código real.

**Type consistency:** `masked?: boolean` (Task 1) consumido por `toRetroCardDTO` (Task 2) e `PostIt` (Task 3); evento `anonymous.changed` (Task 1) emitido na rota (Task 2) e tratado em `applyEvent`/`onmessage` (Task 4); `setAnonymous({roomId,userId,anonymous})` (service) ↔ chamada na rota; `toggleRetroAnonymous(id, anonymous)` (Task 4 Step 1) ↔ uso na page (Step 5) e mock no teste (Step 3).

**Riscos a validar na execução:**
- Redefinição do autor: rodar a suite **completa** da API (Task 2 Step 5) para garantir que nenhuma asserção dependia de `author: null` em sala anônima (busca prévia não encontrou nenhuma).
- `toggleAnonM` lê `!room.anonymous` no `onClick` (não no `mutationFn`), pois `room` só existe após os early returns.
- O refetch no `anonymous.changed` é o que revela/oculta os cards já existentes no cache; sem ele, textos antigos permaneceriam.
- Fixtures de teste: `RetroCardDTO.masked` é opcional, então mocks/fixtures existentes sem o campo seguem válidos.

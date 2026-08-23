# Ações de Retrospectivas: contexto, observação e squad — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na seção "Ações de Retrospectivas" do perfil, exibir o problema de origem como título, permitir uma observação do responsável (persistida e refletida na auditoria da retro seguinte) e mostrar a squad de origem ao lado da sprint.

**Architecture:** O problema já está no banco (`RetroCard.text`). Adicionamos a coluna `actionNote`, ampliamos os DTOs `RetroActionItemDTO`/`RetroCarryoverItemDTO`, estendemos a PATCH da ação para gravar a nota sem resetar auditoria, trazemos a squad no serialize, e ajustamos `ProfilePage` e `CarryoverCard`.

**Tech Stack:** TypeScript ESM, Fastify + Prisma + PostgreSQL (api), Vite + React + Tailwind (web), Vitest. Contrato em `@legends/shared`.

## Global Constraints

- Contrato é a fonte da verdade: altere o tipo em `@legends/shared` primeiro, depois os dois lados.
- Mensagens/copy voltadas ao usuário em **português**.
- Testes Vitest colocados ao lado do código; API testa contra Postgres real (`pnpm db:up` antes de `pnpm test`).
- `fileParallelism: false` na API; `test/setup.ts` trunca tabelas em `beforeEach`.
- Rotas finas, lógica no service, DTO no serialize. Nunca editar migration já aplicada.
- `pnpm build`/Vitest não fazem typecheck — rode `tsc --noEmit` por workspace ao mexer em DTOs/includes Prisma.
- Nota do responsável: máx **500** chars; só o `actionResponsible` escreve; editável a qualquer momento e **não** reseta auditoria.

---

### Task 1: Migration — coluna `actionNote` em `RetroCard`

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (model `RetroCard`, junto de `actionDone`/`actionDoneAt`)
- Create: `apps/api/prisma/migrations/<timestamp>_action_note/migration.sql` (gerada)

- [ ] **Step 1: Adicionar o campo ao schema**

Em `apps/api/prisma/schema.prisma`, no model `RetroCard`, logo após `actionDoneAt DateTime?`, adicione:

```prisma
  actionNote        String?
```

- [ ] **Step 2: Subir o Postgres e gerar a migration**

Run: `pnpm db:up && pnpm db:migrate -- --name action_note`
Expected: cria `apps/api/prisma/migrations/<timestamp>_action_note/migration.sql` com `ALTER TABLE "RetroCard" ADD COLUMN "actionNote" TEXT;` e regenera o client sem erro.

- [ ] **Step 3: Confirmar o client tipado**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros (o campo `actionNote` existe no tipo `RetroCard`).

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(retro): coluna actionNote em RetroCard"
```

---

### Task 2: Contrato + serialize (problema, nota, squad)

**Files:**
- Modify: `packages/shared/src/retro.ts:144-163` (`RetroActionItemDTO`, `RetroCarryoverItemDTO`)
- Modify: `apps/api/src/lib/serialize.ts:401-441` (`toRetroActionItemDTO`, `toRetroCarryoverItemDTO`) + novo helper `squadLabel`
- Test: `apps/api/src/lib/serialize-retro.test.ts:64-108`

**Interfaces:**
- Produces:
  - `RetroActionItemDTO` ganha `problem: string`, `note: string | null`, `squad: string`.
  - `RetroCarryoverItemDTO` ganha `note: string | null`.
  - `squadLabel(squads: { squad: { name: string } }[]): string` — nomes ordenados pt-BR, juntos com `', '`.
  - `toRetroActionItemDTO(card: Pick<RetroCard, 'id'|'roomId'|'text'|'actionPlan'|'actionNote'|'actionDueDate'|'actionDone'|'actionDoneAt'|'auditStatus'>, sprint: number, squad: string): RetroActionItemDTO`
  - `toRetroCarryoverItemDTO(card: Pick<RetroCard, 'id'|'actionPlan'|'actionNote'|'actionDueDate'|'auditStatus'>, responsible, type, sprint): RetroCarryoverItemDTO`

- [ ] **Step 1: Atualizar os testes do serialize**

Em `apps/api/src/lib/serialize-retro.test.ts`, substitua o bloco `describe('serialize ações')` (linhas ~64-79) e o bloco `describe('serialize carryover')` (linhas ~99-109) por:

```ts
describe('serialize ações', () => {
  const actionCard = {
    id: 'c1', roomId: 'r1', text: 'Daily foi cancelada sem aviso',
    actionPlan: 'Documentar deploy', actionNote: 'Falei com o time', actionDueDate: '2026-07-01',
    actionDone: true, actionDoneAt: new Date('2026-06-25T12:00:00Z'),
    auditStatus: null,
  } as any

  it('toRetroActionItemDTO monta plano/problema/nota/squad/prazo/done/sprint', () => {
    const dto = toRetroActionItemDTO(actionCard, 23, 'Alpha, Beta')
    expect(dto).toEqual({
      id: 'c1', plan: 'Documentar deploy', problem: 'Daily foi cancelada sem aviso',
      note: 'Falei com o time', dueDate: '2026-07-01', done: true,
      doneAt: '2026-06-25T12:00:00.000Z', sprint: 23, squad: 'Alpha, Beta',
      roomId: 'r1', auditStatus: null,
    })
  })

  it('squadLabel ordena pt-BR e junta com vírgula', () => {
    expect(squadLabel([{ squad: { name: 'Beta' } }, { squad: { name: 'Alpha' } }])).toBe('Alpha, Beta')
    expect(squadLabel([])).toBe('')
  })
})
```

E o carryover:

```ts
describe('serialize carryover', () => {
  const c = { id: 'c1', actionPlan: 'Doc deploy', actionNote: 'Feito parcialmente', actionDueDate: '2026-07-01', auditStatus: null } as any
  const resp = { id: 'u9', name: 'Bia', photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null } as any
  it('monta item de validação com responsável, sprint e nota', () => {
    expect(toRetroCarryoverItemDTO(c, resp, 'validate', 5)).toEqual({
      id: 'c1', plan: 'Doc deploy', note: 'Feito parcialmente', dueDate: '2026-07-01',
      responsible: { id: 'u9', name: 'Bia', photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null },
      sprint: 5, type: 'validate', auditStatus: null,
    })
  })
})
```

Adicione `squadLabel` ao import no topo do arquivo de teste (linha 3):

```ts
import { toRetroCardDTO, toRetroRoomDTO, toRetroActionItemDTO, toRetroEditDTO, toRetroCarryoverItemDTO, squadLabel } from './serialize'
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/api test -- serialize-retro`
Expected: FAIL — `squadLabel` não exportado / campos `problem`/`note`/`squad` ausentes.

- [ ] **Step 3: Atualizar o contrato**

Em `packages/shared/src/retro.ts`, substitua `RetroActionItemDTO` (144-153) e ajuste `RetroCarryoverItemDTO` (155-163):

```ts
export interface RetroActionItemDTO {
  id: string
  plan: string
  problem: string            // texto do card de origem (RetroCard.text)
  note: string | null        // observação do responsável (RetroCard.actionNote)
  dueDate: string            // AAAA-MM-DD
  done: boolean
  doneAt: string | null      // ISO
  sprint: number
  squad: string              // squads de origem, ordenadas pt-BR, juntas com ", "
  roomId: string
  auditStatus: 'VALIDATED' | 'REJECTED' | null
}

export interface RetroCarryoverItemDTO {
  id: string                 // id do card de origem
  plan: string
  note: string | null        // observação do responsável (RetroCard.actionNote)
  dueDate: string            // AAAA-MM-DD
  responsible: RetroCardAuthor | null
  sprint: number             // sprint da retro de origem
  type: 'validate' | 'overdue'
  auditStatus: 'VALIDATED' | 'REJECTED' | null
}
```

- [ ] **Step 4: Implementar o serialize**

Em `apps/api/src/lib/serialize.ts`, substitua `toRetroActionItemDTO` (401-415) e ajuste `toRetroCarryoverItemDTO` (417-441); adicione o helper exportado `squadLabel`:

```ts
export function squadLabel(squads: { squad: { name: string } }[]): string {
  return squads
    .map((s) => s.squad.name)
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
    .join(', ')
}

export function toRetroActionItemDTO(
  card: Pick<RetroCard, 'id' | 'roomId' | 'text' | 'actionPlan' | 'actionNote' | 'actionDueDate' | 'actionDone' | 'actionDoneAt' | 'auditStatus'>,
  sprint: number,
  squad: string,
): RetroActionItemDTO {
  return {
    id: card.id,
    plan: card.actionPlan ?? '',
    problem: card.text ?? '',
    note: card.actionNote ?? null,
    dueDate: card.actionDueDate ?? '',
    done: card.actionDone,
    doneAt: card.actionDoneAt ? card.actionDoneAt.toISOString() : null,
    sprint,
    squad,
    roomId: card.roomId,
    auditStatus: (card.auditStatus as 'VALIDATED' | 'REJECTED' | null) ?? null,
  }
}
```

No `toRetroCarryoverItemDTO`, amplie o `Pick` para incluir `'actionNote'` e adicione `note: card.actionNote ?? null,` ao objeto retornado (logo após `plan`).

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `pnpm --filter @legends/api test -- serialize-retro`
Expected: PASS.

- [ ] **Step 6: Typecheck shared + api**

Run: `pnpm --filter @legends/shared exec tsc --noEmit && pnpm --filter @legends/api exec tsc --noEmit`
Expected: erros esperados nos **callers** de `toRetroActionItemDTO` (falta o arg `squad`) — serão corrigidos nas Tasks 3 e 4. Anote quais arquivos acusaram (profile.ts, retro.ts) e prossiga; o typecheck volta a limpar ao fim da Task 4.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/retro.ts apps/api/src/lib/serialize.ts apps/api/src/lib/serialize-retro.test.ts
git commit -m "feat(retro): DTOs de ação/carryover com problema, nota e squad"
```

---

### Task 3: API — escrita da nota (`PATCH /retro/actions/:cardId`)

**Files:**
- Modify: `apps/api/src/services/retro-service.ts:567-587` (`setActionDone` → `updateAction`)
- Modify: `apps/api/src/routes/retro.ts:92` (schema) e `:329-340` (rota)
- Test: `apps/api/src/routes/retro-actions.test.ts`

**Interfaces:**
- Consumes: `squadLabel`, `toRetroActionItemDTO(card, sprint, squad)` (Task 2).
- Produces: `updateAction(input: { cardId: string; userId: string; done?: boolean; note?: string }): Promise<RetroCard & { room: { sprint: number; squads: { squad: { name: string } }[] } }>`.

- [ ] **Step 1: Escrever os testes da rota**

Em `apps/api/src/routes/retro-actions.test.ts`, adicione (siga o estilo dos testes existentes no arquivo para criar room concluída, card de ação e token; reaproveite os helpers já presentes no topo do arquivo):

```ts
  it('PATCH /retro/actions/:cardId grava a nota sem resetar auditoria', async () => {
    const app = buildApp(); await app.ready()
    try {
      const lead = await user('LiaN', 'LEAD'); const dev = await user('DanN')
      const squad = await prisma.squad.create({ data: { name: 'SN', slug: 's-n' } })
      const room = await prisma.retroRoom.create({ data: { sprint: 7, createdById: lead.id, anonymous: true, votesPerParticipant: 3, status: 'CONCLUDED', concludedAt: new Date(), squads: { create: { squadId: squad.id } } } })
      const card = await prisma.retroCard.create({ data: { roomId: room.id, authorId: lead.id, text: 'p', color: 'blue', x: 0, y: 0, actionPlan: 'Fazer X', actionResponsible: dev.id, actionDueDate: '2026-07-01', actionDone: true, auditStatus: 'VALIDATED', auditedById: lead.id, auditedAt: new Date() } })

      const token = app.jwt.sign({ sub: dev.id, role: 'LEGEND' })
      const res = await app.inject({ method: 'PATCH', url: `/retro/actions/${card.id}`, headers: { authorization: `Bearer ${token}` }, payload: { note: 'Tratei com o time' } })
      expect(res.statusCode).toBe(200)
      expect(res.json().action.note).toBe('Tratei com o time')
      const after = await prisma.retroCard.findUnique({ where: { id: card.id } })
      expect(after?.actionNote).toBe('Tratei com o time')
      expect(after?.auditStatus).toBe('VALIDATED') // nota não resetou auditoria
    } finally { await app.close() }
  })

  it('PATCH /retro/actions/:cardId nota só pelo responsável', async () => {
    const app = buildApp(); await app.ready()
    try {
      const lead = await user('LiaX', 'LEAD'); const dev = await user('DanX'); const outro = await user('OutroX')
      const squad = await prisma.squad.create({ data: { name: 'SX', slug: 's-x' } })
      const room = await prisma.retroRoom.create({ data: { sprint: 8, createdById: lead.id, anonymous: true, votesPerParticipant: 3, status: 'CONCLUDED', concludedAt: new Date(), squads: { create: { squadId: squad.id } } } })
      const card = await prisma.retroCard.create({ data: { roomId: room.id, authorId: lead.id, text: 'p', color: 'blue', x: 0, y: 0, actionPlan: 'Fazer Y', actionResponsible: dev.id, actionDueDate: '2026-07-02' } })

      const token = app.jwt.sign({ sub: outro.id, role: 'LEGEND' })
      const res = await app.inject({ method: 'PATCH', url: `/retro/actions/${card.id}`, headers: { authorization: `Bearer ${token}` }, payload: { note: 'x' } })
      expect(res.statusCode).toBe(403)
    } finally { await app.close() }
  })
```

Nota: `retro-actions.test.ts` já tem no topo os imports `buildApp`/`prisma` e os helpers `user(name, role)` e `actionCard(roomId, authorId, responsibleId)` — reaproveite-os (os testes acima criam o card inline só porque precisam de `actionDone`/`auditStatus` pré-setados, que o helper `actionCard` não cobre).

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm db:up && pnpm --filter @legends/api test -- retro-actions`
Expected: FAIL — schema rejeita `{ note }` (400) e/ou `updateAction` não existe.

- [ ] **Step 3: Atualizar schema e rota**

Em `apps/api/src/routes/retro.ts`, troque `actionDoneSchema` (linha 92) por:

```ts
const actionUpdateSchema = z
  .object({ done: z.boolean().optional(), note: z.string().max(500).optional() })
  .refine((d) => d.done !== undefined || d.note !== undefined, { message: 'Nada para atualizar.' })
```

E a rota (329-340):

```ts
  app.patch('/retro/actions/:cardId', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = actionUpdateSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...badBody, issues: parsed.error.flatten() })
    const { cardId } = request.params as { cardId: string }
    try {
      const card = await updateAction({ cardId, userId: request.user.sub, done: parsed.data.done, note: parsed.data.note })
      return reply.send({ action: toRetroActionItemDTO(card, card.room.sprint, squadLabel(card.room.squads)) })
    } catch (err) {
      if (err instanceof RetroError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
```

Atualize os imports em `retro.ts`: troque `setActionDone` por `updateAction` (linha ~27 do bloco de imports de `../services/retro-service`) e adicione `squadLabel` ao import de `../lib/serialize` (linha 43).

- [ ] **Step 4: Implementar `updateAction`**

Em `apps/api/src/services/retro-service.ts`, substitua `setActionDone` (567-587) por:

```ts
export async function updateAction(input: { cardId: string; userId: string; done?: boolean; note?: string }) {
  const card = await prisma.retroCard.findUnique({
    where: { id: input.cardId },
    include: { room: { select: { sprint: true, archivedAt: true } } },
  })
  if (!card || card.room.archivedAt || !card.actionPlan || !card.actionResponsible || !card.actionDueDate) {
    throw new RetroError('Ação não encontrada.', 404)
  }
  if (card.actionResponsible !== input.userId) throw new RetroError('Apenas o responsável trata a ação.', 403)
  const data: Prisma.RetroCardUpdateInput = {}
  if (input.done !== undefined) {
    // Espelha o comportamento anterior de setActionDone: concluir/reabrir reseta a auditoria.
    data.actionDone = input.done
    data.actionDoneAt = input.done ? new Date() : null
    data.auditStatus = null
    data.auditedById = null
    data.auditedAt = null
  }
  if (input.note !== undefined) {
    const trimmed = input.note.trim()
    data.actionNote = trimmed.length === 0 ? null : trimmed
  }
  return prisma.retroCard.update({
    where: { id: card.id },
    data,
    include: { room: { select: { sprint: true, squads: { select: { squad: { select: { name: true } } } } } } },
  })
}
```

`Prisma` já está importado no topo de `retro-service.ts` (`import { Prisma, type RetroCard, type User } from '@prisma/client'`). Setar `data.auditedById = null` casa com o padrão já usado no arquivo (ex.: `setCarryover`), então mantenha essa forma.

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `pnpm --filter @legends/api test -- retro-actions`
Expected: PASS.

- [ ] **Step 6: Atualizar o client web da PATCH**

Em `apps/web/src/lib/retro-api.ts`, ao lado de `toggleRetroAction` (67-69), adicione:

```ts
export function updateRetroActionNote(cardId: string, note: string) {
  return apiFetch<{ action: RetroActionItemDTO }>(`/retro/actions/${cardId}`, { method: 'PATCH', body: JSON.stringify({ note }) })
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/retro-service.ts apps/api/src/routes/retro.ts apps/api/src/routes/retro-actions.test.ts apps/web/src/lib/retro-api.ts
git commit -m "feat(retro): PATCH da ação aceita observação do responsável"
```

---

### Task 4: API — leitura (squad no perfil, nota no carryover)

**Files:**
- Modify: `apps/api/src/services/profile-service.ts:134-145` (`listUserActions` include squads)
- Modify: `apps/api/src/routes/profile.ts:57` (montar `squad` e passar ao serialize)
- Test: `apps/api/src/routes/profile-actions.test.ts`

**Interfaces:**
- Consumes: `squadLabel`, `toRetroActionItemDTO(card, sprint, squad)` (Task 2); `toRetroCarryoverItemDTO` com `note` (Task 2). `listCarryover` já traz o card completo (com `actionNote`), então o carryover reflete a nota sem mudança extra.

- [ ] **Step 1: Atualizar o teste da rota de perfil**

Em `apps/api/src/routes/profile-actions.test.ts`, no primeiro teste (que cria a squad `'S'` e o card `Fazer X`), amplie a asserção `toMatchObject` (~linha 20) para cobrir `problem`, `note` e `squad`:

```ts
    expect(actions[0]).toMatchObject({ plan: 'Fazer X', problem: 'o', note: null, dueDate: '2026-07-01', sprint: 5, squad: 'S', done: false })
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/api test -- profile-actions`
Expected: FAIL — `squad` vem `''` (ou o teste quebra por `squad`/`note` ausente na chamada do serialize).

- [ ] **Step 3: Trazer as squads em `listUserActions`**

Em `apps/api/src/services/profile-service.ts`, no `include` de `listUserActions` (linha 142), troque:

```ts
    include: { room: { select: { id: true, sprint: true, squads: { select: { squad: { select: { name: true } } } } } } },
```

- [ ] **Step 4: Montar `squad` na rota do perfil**

Em `apps/api/src/routes/profile.ts`, linha 57, troque o map por:

```ts
      actions: actions.map((c) => toRetroActionItemDTO(c, c.room.sprint, squadLabel(c.room.squads))),
```

Adicione `squadLabel` ao import de `../lib/serialize` no topo de `profile.ts`.

- [ ] **Step 5: Rodar os testes de leitura afetados**

Run: `pnpm --filter @legends/api test -- profile-actions retro-carryover`
Expected: PASS (o `retro-carryover` deve continuar verde; se algum teste de carryover fizer `toEqual` estrito e quebrar por `note`, adicione `note: null` — ou o valor esperado — na asserção).

- [ ] **Step 6: Typecheck api completo (deve voltar a limpar)**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros — todos os callers de `toRetroActionItemDTO` agora passam `squad`.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/profile-service.ts apps/api/src/routes/profile.ts apps/api/src/routes/profile-actions.test.ts
git commit -m "feat(retro): expor squad de origem nas ações do perfil"
```

---

### Task 5: Web — perfil (problema, ação, squad, observação)

**Files:**
- Modify: `apps/web/src/pages/ProfilePage.tsx:271-338` (seção de ações)
- Test: `apps/web/src/pages/ProfilePage.test.tsx:64-75` (fixture) e `:318-326` (teste)

**Interfaces:**
- Consumes: `RetroActionItemDTO` com `problem`/`note`/`squad` (Task 2); `updateRetroActionNote` (Task 3).

- [ ] **Step 1: Atualizar fixture e asserções do teste web**

Em `apps/web/src/pages/ProfilePage.test.tsx`, no fixture `actions` (linha ~64) adicione os campos novos:

```ts
        actions: [
          {
            id: "a1",
            plan: "Documentar deploy",
            problem: "Daily foi cancelada sem aviso",
            note: null,
            dueDate: "2026-07-01",
            done: false,
            doneAt: null,
            sprint: 5,
            squad: "Core",
            roomId: "r1",
            auditStatus: null,
          },
        ],
```

E substitua o teste da seção (linhas ~318-326) por:

```ts
  it("mostra problema, ação, squad e salva observação no próprio perfil", async () => {
    renderPage();
    expect(await screen.findByText("Ações de Retrospectivas")).toBeInTheDocument();
    expect(screen.getByText("Daily foi cancelada sem aviso")).toBeInTheDocument();
    expect(screen.getByText(/Ação:/)).toBeInTheDocument();
    expect(screen.getByText(/Documentar deploy/)).toBeInTheDocument();
    expect(screen.getByText("Core")).toBeInTheDocument();

    const textarea = screen.getByPlaceholderText("Adicionar observação…");
    await userEvent.type(textarea, "Tratei com o time");
    fireEvent.blur(textarea);
    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith(
        "/retro/actions/a1",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );

    const checkbox = screen.getByRole("checkbox", { name: /concluída/i });
    expect(checkbox).not.toBeDisabled();
  });
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/web test -- ProfilePage`
Expected: FAIL — problema/Ação/squad/textarea ainda não renderizados.

- [ ] **Step 3: Adicionar a mutation da nota**

Em `apps/web/src/pages/ProfilePage.tsx`, importe `updateRetroActionNote` do `../lib/retro-api` (junto de `toggleRetroAction`) e, ao lado da mutation `toggleActionM`, adicione:

```tsx
  const updateNoteM = useMutation({
    mutationFn: ({ cardId, note }: { cardId: string; note: string }) =>
      updateRetroActionNote(cardId, note),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["profile", profileId] }),
  });
```

Ajuste o `queryKey` para casar com o usado na query do perfil neste arquivo (verifique o `useQuery` da página e reutilize exatamente a mesma chave; se for `["profile", id]`, use `id`).

- [ ] **Step 4: Renderizar problema/ação/squad/observação**

Em `apps/web/src/pages/ProfilePage.tsx`, substitua o bloco `<div className="min-w-0 flex-1">…</div>` (linhas ~300-332) por:

```tsx
                      <div className="min-w-0 flex-1">
                        <p
                          className={`text-body-md ${a.done ? "text-on-surface-variant line-through" : "text-on-surface"}`}
                        >
                          {a.problem || a.plan}
                        </p>
                        {a.problem && (
                          <p
                            className={`mt-0.5 text-body-sm ${a.done ? "text-on-surface-variant line-through" : "text-on-surface-variant"}`}
                          >
                            Ação: {a.plan}
                          </p>
                        )}
                        <div className="mt-1 flex flex-wrap items-center gap-sm font-label text-label-sm">
                          <span className={overdue ? "text-error" : "text-on-surface-variant"}>
                            Prazo: {formatDue(a.dueDate)}
                            {overdue ? " · Atrasada" : ""}
                          </span>
                          <Link to={`/retrospectivas/${a.roomId}`} className="text-primary hover:underline">
                            Sprint {a.sprint}
                          </Link>
                          {a.squad && (
                            <span className="text-on-surface-variant">· {a.squad}</span>
                          )}
                          {a.auditStatus === "VALIDATED" && (
                            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-primary">Validada</span>
                          )}
                          {a.auditStatus === "REJECTED" && (
                            <span className="rounded-full bg-error/15 px-2 py-0.5 text-error">Reprovada</span>
                          )}
                        </div>
                        {isOwnProfile ? (
                          <textarea
                            defaultValue={a.note ?? ""}
                            placeholder="Adicionar observação…"
                            rows={2}
                            onBlur={(e) => {
                              const value = e.target.value.trim();
                              if (value !== (a.note ?? "")) {
                                updateNoteM.mutate({ cardId: a.id, note: value });
                              }
                            }}
                            className="mt-2 w-full resize-y rounded-lg border border-outline-variant/40 bg-surface p-2 text-body-sm text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-none"
                          />
                        ) : (
                          a.note && (
                            <p className="mt-2 text-body-sm text-on-surface-variant">
                              Observação: {a.note}
                            </p>
                          )
                        )}
                      </div>
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `pnpm --filter @legends/web test -- ProfilePage`
Expected: PASS.

- [ ] **Step 6: Typecheck web**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/ProfilePage.tsx apps/web/src/pages/ProfilePage.test.tsx
git commit -m "feat(web): ações do perfil com problema, squad e observação editável"
```

---

### Task 6: Web — observação no card de auditoria (`CarryoverCard`)

**Nota importante (corrigido em execução):** `CarryoverCard.test.tsx` **já existe** (o plano dizia "criar" — errado). Além disso, a Mudança 2 tornou `note` **obrigatório** em `RetroCarryoverItemDTO`, o que quebrou o typecheck em fixtures existentes que não têm `note`: `CarryoverCard.test.tsx` (fixture `base`) e `RetroRoomPage.test.tsx` (fixture de carryover na linha ~300). Esta task **conserta esses fixtures** (adiciona `note`) e é a que deixa o `tsc` do web limpo.

**Files:**
- Modify: `apps/web/src/pages/retro/CarryoverCard.tsx` (após a linha do plano)
- Modify: `apps/web/src/pages/retro/CarryoverCard.test.tsx` (já existe — adicionar `note` ao fixture + 2 testes novos)
- Modify: `apps/web/src/pages/RetroRoomPage.test.tsx` (adicionar `note: null` ao fixture de carryover ~linha 300)

**Interfaces:**
- Consumes: `RetroCarryoverItemDTO` com `note` (Task 2).

- [ ] **Step 1: Corrigir fixtures e adicionar os testes da nota**

Em `apps/web/src/pages/retro/CarryoverCard.test.tsx`, adicione `note: null` ao objeto `base` existente (linha 5, dentro do `{ ... } as const`), e acrescente dois testes novos ao final do `describe('CarryoverCard', ...)` reutilizando o `base`:

```tsx
  it('mostra a observação do responsável quando há nota', () => {
    render(<CarryoverCard item={{ ...base, type: 'validate', note: 'Falei com o time' }} canAct onAction={vi.fn()} />)
    expect(screen.getByText(/Observação do responsável:/)).toBeInTheDocument()
    expect(screen.getByText(/Falei com o time/)).toBeInTheDocument()
  })
  it('não mostra observação quando não há nota', () => {
    render(<CarryoverCard item={{ ...base, type: 'validate' }} canAct onAction={vi.fn()} />)
    expect(screen.queryByText(/Observação do responsável:/)).not.toBeInTheDocument()
  })
```

Em `apps/web/src/pages/RetroRoomPage.test.tsx`, no fixture de carryover `overdue` (~linha 300), adicione `note: null` ao objeto: `{ id: 'a1', plan: 'Ação vencida', note: null, dueDate: '2026-06-01', responsible: pub('d1', 'Dan'), sprint: 5, type: 'overdue', auditStatus: null }`.

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/web test -- CarryoverCard`
Expected: FAIL — os dois testes novos falham (texto "Observação do responsável:" não existe no componente). Os testes antigos continuam passando.

- [ ] **Step 3: Renderizar a nota no componente**

Em `apps/web/src/pages/retro/CarryoverCard.tsx`, logo após a linha do plano (`<p className="text-body-sm text-zinc-900">{item.plan}</p>`, linha 32), adicione:

```tsx
      {item.note && (
        <p className="text-[11px] text-zinc-700">
          <span className="font-bold">Observação do responsável:</span> {item.note}
        </p>
      )}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm --filter @legends/web test -- CarryoverCard`
Expected: PASS (4 testes: 2 antigos + 2 novos).

- [ ] **Step 5: Typecheck web + suíte web completos**

Run: `pnpm --filter @legends/web exec tsc --noEmit && pnpm --filter @legends/web test`
Expected: `tsc` do web **0 erros** (os 4 erros de `note` faltando em fixtures somem); suíte web verde.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/retro/CarryoverCard.tsx apps/web/src/pages/retro/CarryoverCard.test.tsx apps/web/src/pages/RetroRoomPage.test.tsx
git commit -m "feat(retro): auditoria exibe observação do responsável no carryover"
```

---

## Self-Review

- **Spec coverage:**
  - Mudança 1 (problema como título + Ação abaixo + fallback): Task 2 (DTO/serialize) + Task 5 (render) ✓
  - Mudança 2 (observação: coluna, contrato, PATCH sem resetar auditoria, edição no perfil, reflexo no carryover): Task 1 (coluna) + Task 2 (DTOs) + Task 3 (PATCH/updateAction) + Task 5 (textarea) + Task 6 (CarryoverCard) ✓
  - Mudança 3 (squad ao lado da sprint): Task 2 (`squad` no DTO + `squadLabel`) + Task 4 (include + rota) + Task 5 (render) ✓
- **Placeholder scan:** sem TBD/TODO; todos os passos têm código/comando concreto.
- **Type consistency:** `toRetroActionItemDTO(card, sprint, squad)` usado igual em profile.ts (Task 4) e retro.ts (Task 3); `updateAction` (não `setActionDone`) referenciado na rota (Task 3) e definido no service (Task 3); `updateRetroActionNote` definido na Task 3 e consumido na Task 5; `squadLabel` definido na Task 2 e consumido nas Tasks 3/4; `note`/`problem`/`squad` idênticos entre contrato (Task 2) e consumidores (Tasks 4/5/6).
- **Ordem/typecheck:** o typecheck da api fica temporariamente vermelho após a Task 2 (callers sem `squad`) e volta ao verde ao fim da Task 4 — documentado nos passos.

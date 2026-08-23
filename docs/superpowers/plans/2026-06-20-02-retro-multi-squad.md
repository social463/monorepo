# Retro com uma ou mais squads — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir criar uma sala de retrospectiva vinculada a **uma ou mais** squads (M:N), com título derivado listando as squads e participantes puxados da união dos membros.

**Architecture:** Troca o FK único `RetroRoom.squadId` por uma tabela de junção `RetroRoomSquad` (M:N). O contrato `@legends/shared` passa a expor `squads[]` nos DTOs, `squadIds[]` no request e `retroRoomTitle(sprint, names[])`. Backend (service/serialize/rotas) e frontend (form multi-seleção + card) consomem o novo formato.

**Tech Stack:** TypeScript ESM, Fastify 4, Prisma 5 + PostgreSQL, Zod, Vitest, Vite + React 18 + Tailwind, @tanstack/react-query, react-router-dom 6.

## Global Constraints

- Camadas finas: route valida com Zod (`safeParse` → 400), service tem a regra (`RetroError` com status), serialize devolve DTO de `@legends/shared`.
- Contrato é fonte única: mudar `@legends/shared` primeiro, depois os dois lados.
- Nunca editar migration aplicada — gerar nova (`prisma migrate dev`); aceitar reset se pedir (sem dados de produção).
- Testes da API batem em Postgres real: `pnpm db:up` antes de `pnpm test`.
- Mensagens ao usuário em português.
- **≥1 squad obrigatória** por sala; squads devem existir e estar **ativas**.
- Título: 1 squad → `Retrospectiva Sprint X - Squad A`; 2+ → `Retrospectiva Sprint X - Squads A, B` (nomes **ordenados alfabeticamente**, `localeCompare(..., 'pt-BR')`).

---

## Task 1: Prisma M:N `RetroRoomSquad` + migration + seed + truncação

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (model `RetroRoom` ~linha 284; model `Squad`)
- Modify: `apps/api/test/setup.ts`
- Create: migration

**Interfaces:**
- Produces: model `RetroRoomSquad { id, roomId, squadId, @@unique([roomId,squadId]), @@index([squadId]) }`; `RetroRoom.squads RetroRoomSquad[]` (sem `squadId`/`squad`); `Squad.rooms RetroRoomSquad[]`.

- [ ] **Step 1: Editar `RetroRoom` no schema**

Substituir o bloco do `model RetroRoom` para remover `squadId`, a relação `squad` e `@@index([squadId])`, e adicionar `squads`:

```prisma
model RetroRoom {
  id                  String          @id @default(cuid())
  sprint              Int
  createdById         String
  anonymous           Boolean         @default(false)
  votesPerParticipant Int
  status              RetroRoomStatus @default(OPEN)
  createdAt           DateTime        @default(now())
  concludedAt         DateTime?

  creator      User               @relation("RetroRoomsCreated", fields: [createdById], references: [id])
  squads       RetroRoomSquad[]
  participants RetroParticipant[]
  cards        RetroCard[]

  @@index([createdById])
}
```

- [ ] **Step 2: Trocar a relação em `Squad` e adicionar `RetroRoomSquad`**

No `model Squad`, trocar `rooms RetroRoom[]` por `rooms RetroRoomSquad[]`. Adicionar o novo model logo após `RetroRoom`:

```prisma
model RetroRoomSquad {
  id      String @id @default(cuid())
  roomId  String
  squadId String

  room  RetroRoom @relation(fields: [roomId], references: [id], onDelete: Cascade)
  squad Squad     @relation(fields: [squadId], references: [id])

  @@unique([roomId, squadId])
  @@index([squadId])
}
```

- [ ] **Step 3: Gerar a migration**

Run: `pnpm db:up && pnpm --filter @legends/api exec prisma migrate dev --name retro_room_multi_squad`
Expected: cria a migration e regenera o client. Se pedir reset (coluna `squadId` removida com dados), aceitar (`--force` se necessário). Sem dados de produção.

- [ ] **Step 4: Re-seed e validar**

Run: `pnpm --filter @legends/api run db:seed && pnpm --filter @legends/api exec prisma validate`
Expected: seed OK; schema válido.

- [ ] **Step 5: Truncar `retroRoomSquad` entre testes**

Em `apps/api/test/setup.ts`, adicionar `prisma.retroRoomSquad.deleteMany()` **antes** de `prisma.retroRoom.deleteMany()` (FK `roomId`) e antes de `prisma.squad.deleteMany()`:

```ts
    prisma.retroRoomSquad.deleteMany(),
    prisma.retroRoom.deleteMany(),
    prisma.squadMember.deleteMany(),
    prisma.squad.deleteMany(),
    prisma.user.deleteMany(),
```

(Manter a ordem relativa existente; só inserir a linha de `retroRoomSquad` imediatamente antes da de `retroRoom`.)

- [ ] **Step 6: Commit**

NOTA: este passo deixa o TS do app (service/serialize/rotas) **quebrado de propósito** (ainda referenciam `squadId`/`room.squad`) — será corrigido nas Tasks 3. Não rodar `tsc`/suíte aqui; o gate é schema válido + seed OK.

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/test/setup.ts
git commit -m "feat(retro): RetroRoom passa a M:N com squads (RetroRoomSquad)"
```

---

## Task 2: Contrato `@legends/shared/retro.ts` — `squads[]` + título por lista

**Files:**
- Modify: `packages/shared/src/retro.ts` (`retroRoomTitle` ~linha 58; `RetroRoomSummaryDTO` ~linha 136; `CreateRetroRoomRequest` ~linha 183)
- Modify/Create test: `packages/shared/src/retro.test.ts`

**Interfaces:**
- Produces: `retroRoomTitle(sprint: number, squadNames: string[]): string`; `RetroRoomSummaryDTO.squads: { id: string; name: string }[]`; `CreateRetroRoomRequest.squadIds: string[]`.

- [ ] **Step 1: Escrever o teste do helper (falhando)**

Em `packages/shared/src/retro.test.ts`, adicionar (importando `retroRoomTitle` do `./retro`):

```ts
import { retroRoomTitle } from './retro'

describe('retroRoomTitle', () => {
  it('1 squad usa rótulo singular', () => {
    expect(retroRoomTitle(23, ['Inovação'])).toBe('Retrospectiva Sprint 23 - Squad Inovação')
  })
  it('2+ squads usam rótulo plural com nomes separados por vírgula', () => {
    expect(retroRoomTitle(23, ['B2B', 'Inovação'])).toBe('Retrospectiva Sprint 23 - Squads B2B, Inovação')
  })
  it('lista vazia degrada para singular sem nome', () => {
    expect(retroRoomTitle(5, [])).toBe('Retrospectiva Sprint 5 - Squad ')
  })
})
```

(Se o arquivo não tiver `import { describe, it, expect } from 'vitest'`, adicionar.)

- [ ] **Step 2: Rodar para ver falhar**

Run: `pnpm --filter @legends/shared exec vitest run src/retro.test.ts`
Expected: FAIL (assinatura antiga recebe `string`, não `string[]`).

- [ ] **Step 3: Reescrever `retroRoomTitle` (linha 58)**

```ts
/** Título exibível da sala, derivado de sprint + nomes das squads (já ordenados). Fonte única (api e web). */
export function retroRoomTitle(sprint: number, squadNames: string[]): string {
  if (squadNames.length <= 1) return `Retrospectiva Sprint ${sprint} - Squad ${squadNames[0] ?? ''}`
  return `Retrospectiva Sprint ${sprint} - Squads ${squadNames.join(', ')}`
}
```

- [ ] **Step 4: Atualizar `RetroRoomSummaryDTO` (linha ~136)**

Trocar a linha `squad: { id: string; name: string }` por:

```ts
  squads: { id: string; name: string }[]
```

(`RetroRoomDTO extends RetroRoomSummaryDTO` — não mexer nele.)

- [ ] **Step 5: Atualizar `CreateRetroRoomRequest` (linha ~183)**

Trocar `squadId: string` por:

```ts
  squadIds: string[]
```

- [ ] **Step 6: Rodar o teste do helper**

Run: `pnpm --filter @legends/shared exec vitest run src/retro.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

(api/web seguem quebrados de propósito até Tasks 3–4.)

```bash
git add packages/shared/src/retro.ts packages/shared/src/retro.test.ts
git commit -m "feat(shared): retro com squads[] e título por lista de nomes"
```

---

## Task 3: Backend — service, serialize, rotas + testes

**Files:**
- Modify: `apps/api/src/services/retro-service.ts` (`retroRoomInclude` ~linha 37; `createRoom` ~linha 90-120)
- Modify: `apps/api/src/lib/serialize.ts` (`toRetroRoomSummaryDTO` ~linha 269; novo helper)
- Modify: `apps/api/src/routes/retro.ts` (`createRoomSchema` ~linha 42; títulos de notificação ~linhas 109, 155)
- Modify (tests): `apps/api/src/routes/retro.test.ts`, `apps/api/src/services/retro-service.test.ts`, `apps/api/src/services/retro-vote-service.test.ts`, `apps/api/src/services/retro-card-service.test.ts`, `apps/api/src/services/retro-schema.test.ts`, `apps/api/src/services/retro-canvas-schema.test.ts`, `apps/api/src/routes/retro-ws.test.ts`, `apps/api/src/lib/serialize-retro.test.ts`

**Interfaces:**
- Consumes: `retroRoomTitle(sprint, names[])`, `RetroRoomSummaryDTO.squads[]`, `CreateRetroRoomRequest.squadIds`.
- Produces: `createRoom(input: { creatorId, sprint, squadIds: string[], anonymous, votesPerParticipant, participantIds })`; `retroRoomDerivedTitle(room): string` (exportado de serialize); `retroRoomInclude` com `squads: { include: { squad: true } }`.

- [ ] **Step 1: Atualizar `retroRoomInclude` e `createRoom` (retro-service.ts)**

`retroRoomInclude` (linha ~37): trocar `squad: true` por:

```ts
  squads: { include: { squad: true } },
```

`createRoom`: trocar a assinatura `squadId: string` por `squadIds: string[]` e o corpo da validação/criação de squad:

```ts
export async function createRoom(input: {
  creatorId: string
  sprint: number
  squadIds: string[]
  anonymous: boolean
  votesPerParticipant: number
  participantIds: string[]
}): Promise<RetroRoomWithRelations> {
  const creator = await prisma.user.findUnique({ where: { id: input.creatorId } })
  if (!creator || !creator.active) throw new RetroError('Criador inválido.', 400)
  if (creator.role !== 'LEAD') throw new RetroError('Apenas líderes abrem salas de retrospectiva.', 403)
  assertSprint(input.sprint)
  assertVotes(input.votesPerParticipant)
  const squadIds = [...new Set(input.squadIds)]
  if (squadIds.length === 0) throw new RetroError('Selecione ao menos uma squad.', 400)
  const squads = await prisma.squad.findMany({ where: { id: { in: squadIds } } })
  if (squads.length !== squadIds.length || squads.some((s) => !s.active)) {
    throw new RetroError('Squad inválida.', 400)
  }
  const invited = [...new Set(input.participantIds)].filter((id) => id !== input.creatorId)
  await assertInvitable(invited)
  const allParticipantIds = [input.creatorId, ...invited]
  return prisma.retroRoom.create({
    data: {
      sprint: input.sprint,
      createdById: input.creatorId,
      anonymous: input.anonymous,
      votesPerParticipant: input.votesPerParticipant,
      squads: { create: squadIds.map((squadId) => ({ squadId })) },
      participants: { create: allParticipantIds.map((userId) => ({ userId })) },
    },
    include: retroRoomInclude,
  })
}
```

- [ ] **Step 2: Atualizar serialize (`toRetroRoomSummaryDTO`) + helper de título**

Em `apps/api/src/lib/serialize.ts`, adicionar um helper exportado e usá-lo no DTO. Substituir o corpo de `toRetroRoomSummaryDTO`:

```ts
/** Nomes das squads da sala, ordenados (pt-BR). */
function retroRoomSquadDTOs(room: RetroRoomWithRelations): { id: string; name: string }[] {
  return room.squads
    .map((rs) => ({ id: rs.squad.id, name: rs.squad.name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}

export function retroRoomDerivedTitle(room: RetroRoomWithRelations): string {
  return retroRoomTitle(room.sprint, retroRoomSquadDTOs(room).map((s) => s.name))
}

export function toRetroRoomSummaryDTO(room: RetroRoomWithRelations, role: RetroRoomRole): RetroRoomSummaryDTO {
  const squads = retroRoomSquadDTOs(room)
  return {
    id: room.id,
    title: retroRoomTitle(room.sprint, squads.map((s) => s.name)),
    sprint: room.sprint,
    squads,
    status: room.status,
    anonymous: room.anonymous,
    votesPerParticipant: room.votesPerParticipant,
    createdAt: room.createdAt.toISOString(),
    concludedAt: room.concludedAt ? room.concludedAt.toISOString() : null,
    creator: { id: room.creator.id, name: room.creator.name },
    participantCount: room.participants.length,
    myRole: role,
  }
}
```

(`retroRoomTitle` já está importado de `@legends/shared` no topo do arquivo.)

- [ ] **Step 3: Atualizar as rotas (retro.ts)**

(a) `createRoomSchema` (linha ~42): trocar `squadId: z.string().min(1)` por:

```ts
  squadIds: z.array(z.string()).min(1).max(50),
```

(b) Importar o helper de título: no import de `../lib/serialize` (que já traz `toRetroRoomDTO` etc.), adicionar `retroRoomDerivedTitle`. Remover `retroRoomTitle` do import de `@legends/shared` se ele não for mais usado diretamente na rota.

(c) Nas duas chamadas de `notifyRetroInvited` (linhas ~109 e ~155), trocar `title: retroRoomTitle(room.sprint, room.squad.name)` por:

```ts
          title: retroRoomDerivedTitle(room),
```

- [ ] **Step 4: Atualizar os testes da API (sweep `squadId` → `squadIds`)**

Aplicar estas substituições mecânicas (ler cada arquivo antes para casar exatamente):

1. `services/retro-service.test.ts` e `routes/retro.test.ts` e `services/retro-vote-service.test.ts`: em **toda** chamada de `createRoom({...})` e em **todo** payload `POST /retro/rooms`, trocar `squadId: <x>` / `squadId,` por `squadIds: [<x>]`. Onde houver `const squadId = await mkSquad(app)`, manter o nome da variável (`squadIds: [squadId]`).
2. `routes/retro.test.ts` linha ~34: trocar a asserção `expect(ok.json().room.squad.id).toBe(squadId)` por:
   ```ts
   expect(ok.json().room.squads.map((s: { id: string }) => s.id)).toContain(squadId)
   ```
   Adicionar, no mesmo teste, a verificação do título singular:
   ```ts
   expect(ok.json().room.title).toBe('Retrospectiva Sprint 23 - Squad Inovação')
   ```
   (a squad criada por `mkSquad` chama-se "Inovação".)
3. `routes/retro.test.ts` linha ~49 (teste "valida corpo inválido"): trocar `squadId: ''` por `squadIds: []` (continua 400).
4. `services/retro-card-service.test.ts` (~linha 19), `services/retro-schema.test.ts` (~linha 13), `services/retro-canvas-schema.test.ts` (~linha 9): essas usam `prisma.retroRoom.create({ data: { ..., squadId: squad.id, ... } })`. Trocar `squadId: squad.id,` por:
   ```ts
   squads: { create: { squadId: squad.id } },
   ```
5. `routes/retro-ws.test.ts` (linhas ~41, ~70, ~92): trocar `squadId: squad.id`/`squadId: squad2.id`/`squadId: squad3.id` nos payloads por `squadIds: [squad.id]` etc.
6. `lib/serialize-retro.test.ts` (~linha 49): o mock de sala (payload Prisma) usa `squad: { id: 'sq1', name: 'Squad' }`. Trocar por:
   ```ts
   squads: [{ squad: { id: 'sq1', name: 'Squad' } }],
   ```
   Se o teste asserta `dto.squad`/`dto.title`, ajustar para `dto.squads` e o título derivado. Ler o teste e ajustar as asserções de squad/title coerentemente (sem enfraquecer outras).

- [ ] **Step 5: Adicionar testes de múltiplas squads**

Em `routes/retro.test.ts`, adicionar um helper para criar squad com nome e dois testes. Reaproveitar/!ajustar o helper `mkSquad` existente — se ele não aceitar nome, adicionar um:

```ts
async function mkSquadNamed(name: string) {
  const s = await prisma.squad.create({ data: { name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') } })
  return s.id
}

it('cria sala com 2 squads → título plural e squads[] com 2', async () => {
  const app = buildApp(); await app.ready()
  const lead = await leadToken(app)
  const sqA = await mkSquadNamed('Inovação')
  const sqB = await mkSquadNamed('B2B')
  const res = await app.inject({
    method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${lead.token}` },
    payload: { sprint: 7, squadIds: [sqA, sqB], anonymous: false, votesPerParticipant: 3, participantIds: [] },
  })
  expect(res.statusCode).toBe(201)
  expect(res.json().room.squads).toHaveLength(2)
  // nomes ordenados: B2B antes de Inovação
  expect(res.json().room.title).toBe('Retrospectiva Sprint 7 - Squads B2B, Inovação')
  await app.close()
})

it('rejeita criação sem squad (squadIds vazio) → 400', async () => {
  const app = buildApp(); await app.ready()
  const lead = await leadToken(app)
  const res = await app.inject({
    method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${lead.token}` },
    payload: { sprint: 1, squadIds: [], anonymous: false, votesPerParticipant: 3, participantIds: [] },
  })
  expect(res.statusCode).toBe(400)
  await app.close()
})
```

(O teste existente "rejeita criação com squad inativa (400)" deve passar `squadIds: [inactive.id]`.)

- [ ] **Step 6: Rodar a suíte de retro + tsc**

Run: `pnpm db:up && pnpm --filter @legends/api test -- retro && pnpm --filter @legends/api exec tsc --noEmit`
Expected: todos os testes de retro PASS; tsc limpo. Se algum outro teste da api referenciar `room.squad`/`squadId` e quebrar, corrigir pela mesma regra mecânica e citar no commit.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src
git commit -m "feat(retro): sala com uma ou mais squads (M:N) no backend + testes"
```

---

## Task 4: Frontend — form multi-seleção + card + fixtures

**Files:**
- Modify: `apps/web/src/pages/RetrosPage.tsx` (`RoomCard` ~linha 21; `CreateRoomModal` ~linha 139)
- Modify (tests): `apps/web/src/pages/RetrosPage.test.tsx`, `apps/web/src/pages/RetroRoomPage.test.tsx`, `apps/web/src/lib/useRetroSocket.test.tsx`

**Interfaces:**
- Consumes: `listRetroSquads()` (`SquadWithMembersDTO[]`), `createRetroRoom({ sprint, squadIds, ... })`, `retroRoomTitle(sprint, names[])`, `RetroRoomSummaryDTO.squads[]`.

- [ ] **Step 1: `RoomCard` lista as squads (RetrosPage.tsx ~linha 32)**

Trocar `<h3 ...>{room.squad.name}</h3>` por:

```tsx
        <h3 className="mt-1 font-headline text-title-md text-on-surface">
          {room.squads.map((s) => s.name).join(', ')}
        </h3>
```

- [ ] **Step 2: `CreateRoomModal` multi-seleção (RetrosPage.tsx)**

Substituir o estado e helpers de squad e o `<select>` por multi-seleção. Trocar:
- `const [squadId, setSquadId] = useState('')` → `const [squadIds, setSquadIds] = useState<string[]>([])`
- `selectSquad(id)` por `toggleSquad(id)` que recomputa o conjunto e re-seta participantes para a **união** dos membros:

```tsx
  function toggleSquad(id: string) {
    setSquadIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      const chosen = squads.data?.squads.filter((s) => next.includes(s.id)) ?? []
      const union = [...new Set(chosen.flatMap((s) => s.members.map((m) => m.id)))]
      setSelected(union)
      return next
    })
  }
```

- `squadName`/`canSubmit`/`create` e o preview/`<select>`:

```tsx
  const create = useMutation({
    mutationFn: () =>
      createRetroRoom({ sprint, squadIds, anonymous, votesPerParticipant: votes, participantIds: selected }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['retro-rooms'] })
      onClose()
    },
  })

  const squadNames = (squads.data?.squads ?? [])
    .filter((s) => squadIds.includes(s.id))
    .map((s) => s.name)
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const canSubmit = sprint >= MIN_SPRINT && squadIds.length >= 1 && !create.isPending
```

Trocar o bloco do `<label>Squad <select>…</select></label>` por uma lista de checkboxes:

```tsx
          <fieldset className="block flex-1 text-label-md text-on-surface-variant">
            <legend>Squads</legend>
            <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-outline-variant/40 bg-surface p-sm">
              {squads.data?.squads.map((s) => (
                <label key={s.id} className="flex items-center gap-sm py-1 text-body-md text-on-surface">
                  <input type="checkbox" checked={squadIds.includes(s.id)} onChange={() => toggleSquad(s.id)} />
                  {s.name}
                </label>
              ))}
            </div>
          </fieldset>
```

E o preview do título:

```tsx
        {squadNames.length > 0 && (
          <p className="mt-sm text-body-sm text-on-surface-variant">{retroRoomTitle(sprint, squadNames)}</p>
        )}
```

(Remover a função `selectSquad` antiga e a const `squadName`.)

- [ ] **Step 3: Atualizar fixtures dos testes web**

`RetrosPage.test.tsx` (~linhas 18-21): no helper `room(...)`, trocar `squad: { id: 's' + id, name: squadName }` por:

```tsx
    squads: [{ id: 's' + id, name: squadName }],
```

(o `title` do mock pode permanecer; o teste de agrupamento por sprint não depende dele.)

`RetroRoomPage.test.tsx` (~linha 11) e `useRetroSocket.test.tsx` (~linha 28): trocar `squad: { id: 'sq1', name: 'Squad A' }` por:

```tsx
  squads: [{ id: 'sq1', name: 'Squad A' }],
```

- [ ] **Step 4: Rodar testes web + tsc**

Run: `pnpm --filter @legends/web test -- RetrosPage && pnpm --filter @legends/web exec tsc --noEmit`
Expected: RetrosPage test PASS; tsc limpo (as fixtures atualizadas satisfazem `RetroRoomSummaryDTO`/`RetroRoomDTO`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src
git commit -m "feat(retro/web): seleção de uma ou mais squads na criação e card multi-squad"
```

---

## Task 5: Verificação final (suíte completa + build)

**Files:** nenhum (gate).

- [ ] **Step 1: Suíte completa**

Run: `pnpm db:up && pnpm test`
Expected: api e web verdes.

- [ ] **Step 2: Build**

Run: `pnpm build`
Expected: sem erros (warnings pré-existentes de React Router/chunk-size são aceitáveis).

- [ ] **Step 3: Verificação manual (opcional)**

`pnpm dev`; como LEAD: criar sala marcando 2 squads → título "Sprint N - Squads A, B", participantes = união; a Tela 2 mostra a sala com as duas squads no card.

---

## Notas de cobertura (spec → tasks)

- M:N `RetroRoomSquad`, remove `RetroRoom.squadId`: Task 1.
- `retroRoomTitle(names[])`, `squads[]` no DTO, `squadIds` no request: Task 2.
- `createRoom` valida ≥1 squad + ativas, persiste junção; serialize ordena nomes + título; rotas `squadIds` + notificação: Task 3.
- Form multi-seleção + união de participantes + card multi-squad + fixtures: Task 4.
- Verificação: Task 5.
- Fora de escopo (editar squads de sala existente; agrupar por squad): sem tasks — intencional.

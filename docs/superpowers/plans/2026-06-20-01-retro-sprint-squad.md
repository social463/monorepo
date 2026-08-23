# Retro por Sprint + Squad — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar o título livre da sala de retro por Sprint (número) + Squad (entidade), agrupar a listagem por sprint em duas telas, e tornar Squad uma entidade gerenciável por admin com integrantes que são puxados ao criar a sala.

**Architecture:** Backend Fastify (route → service → Prisma), contrato em `@legends/shared`, frontend React + React Query. Squad vira entidade nova (`Squad` + `SquadMember` N:N) gerenciada no painel admin; o retro consome squads ativas (com membros) por um endpoint próprio. O título da sala passa a ser **derivado** (`Retrospectiva Sprint X - Squad Y`) — `RetroRoom.title` deixa de existir como coluna.

**Tech Stack:** TypeScript ESM, Fastify 4, Prisma 5 + PostgreSQL, Zod, Vitest, Vite + React 18 + Tailwind, `@tanstack/react-query`, `react-router-dom` 6.

## Global Constraints

- Mensagens voltadas ao usuário em **português**.
- Camadas finas: route valida com Zod (`safeParse` → `400 { message }` ou `{ ...badBody, issues }`), service tem a regra (erros tipados com `status`), serialize devolve DTO de `@legends/shared`.
- Contrato é fonte única: **mudar o tipo em `@legends/shared` primeiro**, depois os dois lados.
- **Nunca editar migration aplicada** — gerar nova com `pnpm db:migrate`.
- Testes da API batem em Postgres real: subir com `pnpm db:up` antes de `pnpm test`.
- ESM puro; `User.squad` (texto livre, rótulo org-level) **não é tocado** — `SquadMember` é conceito novo e paralelo.
- Regra de membership: **DEV no máximo 1 squad; LEAD ilimitado; ADMIN não entra em squad.**
- Squad gerenciada só por **ADMIN** (`adminOnly`); retro consome via `GET /retro/squads` (autenticada).

---

# Parte A — Squad como entidade (admin)

## Task 1: Modelos Prisma `Squad` + `SquadMember` + seed

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (model `User` ~linha 70-75; adicionar models novos perto de `Category` ~linha 103)
- Modify: `apps/api/prisma/seed.ts:31-204`
- Create: migration (gerada por comando)

**Interfaces:**
- Produces: tabelas `Squad { id, name @unique, slug @unique, active, createdAt }` e `SquadMember { id, squadId, userId, joinedAt, @@unique([squadId,userId]) }`; relação `User.squadMemberships`.

- [ ] **Step 1: Adicionar a relação inversa no model `User`**

Em `apps/api/prisma/schema.prisma`, dentro do bloco `model User`, logo após a linha `retroReactions ... @relation("RetroReactions")` (linha ~74), adicionar:

```prisma
  squadMemberships    SquadMember[]      @relation("SquadMemberships")
```

(NÃO remover `squad String?` na linha 47 — fica como está.)

- [ ] **Step 2: Adicionar os models `Squad` e `SquadMember`**

Em `apps/api/prisma/schema.prisma`, logo após o `model Category { ... }` (linha ~103), adicionar. **Nota:** a relação inversa `rooms RetroRoom[]` NÃO entra agora — ela depende de `RetroRoom.squad`, que só existe a partir da Task 7; um schema com `rooms` aqui não valida. A Task 7 adiciona essa linha. Por isso, neste passo `Squad` fica **sem** `rooms`:

```prisma
model Squad {
  id        String   @id @default(cuid())
  name      String   @unique
  slug      String   @unique
  active    Boolean  @default(true)
  createdAt DateTime @default(now())

  members SquadMember[]
}

model SquadMember {
  id       String   @id @default(cuid())
  squadId  String
  userId   String
  joinedAt DateTime @default(now())

  squad Squad @relation(fields: [squadId], references: [id], onDelete: Cascade)
  user  User  @relation("SquadMemberships", fields: [userId], references: [id], onDelete: Cascade)

  @@unique([squadId, userId])
  @@index([userId])
}
```

- [ ] **Step 3: Gerar a migration**

Run: `pnpm db:up && pnpm --filter @legends/api exec prisma migrate dev --name add_squad_entity`
Expected: cria `apps/api/prisma/migrations/<timestamp>_add_squad_entity/` e regenera o client sem erro.

- [ ] **Step 4: Semear as 5 squads no `seed.ts`**

Em `apps/api/prisma/seed.ts`, dentro de `main()`, antes do `console.log` final (linha ~202), adicionar:

```ts
  // Squads do retro (entidade gerenciável pelo admin). Idempotente por slug.
  const retroSquads = ['Estudar Mais', 'Estudar Melhor', 'Inovação', 'B2B', 'Sucesso do Cliente'];
  for (const name of retroSquads) {
    const slug = name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    await prisma.squad.upsert({ where: { slug }, update: {}, create: { name, slug } });
  }
```

(O `squad: "..."` texto dos usuários no seed permanece intocado.)

- [ ] **Step 5: Rodar o seed e verificar**

Run: `pnpm --filter @legends/api run db:seed`
Expected: termina sem erro; as 5 squads são criadas.

- [ ] **Step 6: Truncar as novas tabelas entre testes**

`apps/api/test/setup.ts` trunca uma lista hardcoded no `beforeEach`. Adicionar `squadMember` e `squad` **entre** `retroRoom.deleteMany()` (já presente) e `user.deleteMany()` (a ordem importa por causa das FKs `SquadMember.userId`/`.squadId` e, a partir da B1, `RetroRoom.squadId`):

```ts
    prisma.retroRoom.deleteMany(),
    prisma.squadMember.deleteMany(),
    prisma.squad.deleteMany(),
    prisma.user.deleteMany(),
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/prisma/seed.ts apps/api/test/setup.ts
git commit -m "feat(squad): modelos Squad e SquadMember + seed das squads do retro"
```

---

## Task 2: Contrato compartilhado `@legends/shared` para Squad

**Files:**
- Create: `packages/shared/src/squad.ts`
- Modify: `packages/shared/src/index.ts:13` (adicionar export)

**Interfaces:**
- Produces: `SquadDTO`, `SquadMemberDTO`, `SquadWithMembersDTO`, `CreateSquadRequest`, `UpdateSquadRequest`, `AddSquadMemberRequest`.

- [ ] **Step 1: Criar `packages/shared/src/squad.ts`**

```ts
export interface SquadDTO {
  id: string
  name: string
  slug: string
  active: boolean
}

export interface SquadMemberDTO {
  id: string
  name: string
}

export interface SquadWithMembersDTO extends SquadDTO {
  members: SquadMemberDTO[]
}

export interface CreateSquadRequest {
  name: string
}

export interface UpdateSquadRequest {
  name?: string
  active?: boolean
}

export interface AddSquadMemberRequest {
  userId: string
}
```

- [ ] **Step 2: Exportar o barril**

Em `packages/shared/src/index.ts`, adicionar após a linha `export * from './retro'`:

```ts
export * from './squad'
```

- [ ] **Step 3: Build do shared para checar tipos**

Run: `pnpm --filter @legends/shared build`
Expected: compila sem erro.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/squad.ts packages/shared/src/index.ts
git commit -m "feat(shared): contrato de Squad (DTOs e requests)"
```

---

## Task 3: Serialização `toSquadDTO` / `toSquadWithMembersDTO`

**Files:**
- Modify: `apps/api/src/lib/serialize.ts` (adicionar funções; imports no topo)

**Interfaces:**
- Consumes: tipos do client Prisma `Squad`, e payload com `members.include.user`.
- Produces: `toSquadDTO(squad)`, `toSquadWithMembersDTO(squad)` retornando `SquadDTO`/`SquadWithMembersDTO`.

- [ ] **Step 1: Importar os tipos no topo de `serialize.ts`**

Adicionar `SquadDTO` e `SquadWithMembersDTO` ao import de `@legends/shared` já existente (ou novo import), e o tipo de payload. No topo do arquivo, adicionar:

```ts
import type { Prisma, Squad } from '@prisma/client'
import type { SquadDTO, SquadWithMembersDTO } from '@legends/shared'

type SquadWithMembers = Prisma.SquadGetPayload<{ include: { members: { include: { user: true } } } }>
```

(Se já houver `import type { Prisma } from '@prisma/client'`, apenas acrescentar `Squad`. Não duplicar.)

- [ ] **Step 2: Adicionar as funções no fim de `serialize.ts`**

```ts
export function toSquadDTO(squad: Squad): SquadDTO {
  return { id: squad.id, name: squad.name, slug: squad.slug, active: squad.active }
}

export function toSquadWithMembersDTO(squad: SquadWithMembers): SquadWithMembersDTO {
  return {
    ...toSquadDTO(squad),
    members: squad.members.map((m) => ({ id: m.user.id, name: m.user.name })),
  }
}
```

- [ ] **Step 3: Type-check**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros (as funções ainda não são usadas; isso é OK).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/lib/serialize.ts
git commit -m "feat(squad): serializadores toSquadDTO/toSquadWithMembersDTO"
```

---

## Task 4: `squad-service.ts` (regra de negócio) + testes

**Files:**
- Create: `apps/api/src/services/squad-service.ts`
- Create: `apps/api/src/services/squad-service.test.ts`

**Interfaces:**
- Consumes: `prisma`, `slugify` de `../lib/slug`.
- Produces:
  - `class SquadError extends Error { status: number }`
  - `squadInclude` (const) e `type SquadWithMembers`
  - `listSquads(opts?: { activeOnly?: boolean }): Promise<SquadWithMembers[]>`
  - `createSquad(input: { name: string }): Promise<SquadWithMembers>`
  - `updateSquad(id: string, input: { name?: string; active?: boolean }): Promise<SquadWithMembers>`
  - `addMember(squadId: string, userId: string): Promise<SquadWithMembers>`
  - `removeMember(squadId: string, userId: string): Promise<void>`

- [ ] **Step 1: Escrever os testes (falhando) em `squad-service.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { prisma } from '../lib/prisma'
import { createSquad, updateSquad, addMember, removeMember, listSquads, SquadError } from './squad-service'

async function mkUser(role: 'DEV' | 'LEAD' | 'ADMIN', name: string) {
  return prisma.user.create({ data: { name, email: `${name}@x.com`, passwordHash: 'x', role } })
}

describe('squad-service', () => {
  it('cria squad com slug e rejeita nome duplicado', async () => {
    const s = await createSquad({ name: 'Inovação' })
    expect(s.slug).toBe('inovacao')
    expect(s.members).toEqual([])
    await expect(createSquad({ name: 'Inovação' })).rejects.toMatchObject({ status: 409 })
  })

  it('renomeia e desativa', async () => {
    const s = await createSquad({ name: 'B2B' })
    const renamed = await updateSquad(s.id, { name: 'B2B Plus' })
    expect(renamed.name).toBe('B2B Plus')
    expect(renamed.slug).toBe('b2b-plus')
    const off = await updateSquad(s.id, { active: false })
    expect(off.active).toBe(false)
  })

  it('DEV só pode pertencer a uma squad; LEAD a várias', async () => {
    const s1 = await createSquad({ name: 'Estudar Mais' })
    const s2 = await createSquad({ name: 'Estudar Melhor' })
    const dev = await mkUser('DEV', 'Dan')
    const lead = await mkUser('LEAD', 'Lia')

    await addMember(s1.id, dev.id)
    await expect(addMember(s2.id, dev.id)).rejects.toMatchObject({ status: 409 })

    await addMember(s1.id, lead.id)
    const after = await addMember(s2.id, lead.id)
    expect(after.members.map((m) => m.id)).toContain(lead.id)
  })

  it('rejeita ADMIN como integrante e membro duplicado na mesma squad', async () => {
    const s = await createSquad({ name: 'Sucesso do Cliente' })
    const admin = await mkUser('ADMIN', 'Ada')
    await expect(addMember(s.id, admin.id)).rejects.toMatchObject({ status: 400 })
    const dev = await mkUser('DEV', 'Deo')
    await addMember(s.id, dev.id)
    await expect(addMember(s.id, dev.id)).rejects.toMatchObject({ status: 409 })
  })

  it('remove integrante e lista só ativas quando pedido', async () => {
    const s = await createSquad({ name: 'X' })
    const dev = await mkUser('DEV', 'Rui')
    await addMember(s.id, dev.id)
    await removeMember(s.id, dev.id)
    const reloaded = (await listSquads()).find((x) => x.id === s.id)
    expect(reloaded?.members).toEqual([])
    await updateSquad(s.id, { active: false })
    expect((await listSquads({ activeOnly: true })).some((x) => x.id === s.id)).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar os testes para ver falhar**

Run: `pnpm db:up && pnpm --filter @legends/api test -- squad-service`
Expected: FAIL (módulo `./squad-service` não existe).

- [ ] **Step 3: Implementar `apps/api/src/services/squad-service.ts`**

```ts
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { slugify } from '../lib/slug'

export class SquadError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'SquadError'
  }
}

export const squadInclude = {
  members: { include: { user: true }, orderBy: { joinedAt: 'asc' } },
} as const
export type SquadWithMembers = Prisma.SquadGetPayload<{ include: typeof squadInclude }>

async function loadSquad(id: string): Promise<SquadWithMembers> {
  const squad = await prisma.squad.findUnique({ where: { id }, include: squadInclude })
  if (!squad) throw new SquadError('Squad não encontrada.', 404)
  return squad
}

export async function listSquads(opts?: { activeOnly?: boolean }): Promise<SquadWithMembers[]> {
  return prisma.squad.findMany({
    where: opts?.activeOnly ? { active: true } : {},
    include: squadInclude,
    orderBy: { name: 'asc' },
  })
}

export async function createSquad(input: { name: string }): Promise<SquadWithMembers> {
  const name = input.name.trim()
  if (!name) throw new SquadError('O nome da squad é obrigatório.', 400)
  try {
    const squad = await prisma.squad.create({ data: { name, slug: slugify(name) } })
    return loadSquad(squad.id)
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new SquadError('Já existe uma squad com esse nome.', 409)
    }
    throw err
  }
}

export async function updateSquad(
  id: string,
  input: { name?: string; active?: boolean },
): Promise<SquadWithMembers> {
  const data: Prisma.SquadUpdateInput = {}
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (!name) throw new SquadError('O nome da squad é obrigatório.', 400)
    data.name = name
    data.slug = slugify(name)
  }
  if (input.active !== undefined) data.active = input.active
  try {
    await prisma.squad.update({ where: { id }, data })
    return loadSquad(id)
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') throw new SquadError('Squad não encontrada.', 404)
      if (err.code === 'P2002') throw new SquadError('Já existe uma squad com esse nome.', 409)
    }
    throw err
  }
}

export async function addMember(squadId: string, userId: string): Promise<SquadWithMembers> {
  await loadSquad(squadId)
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user || !user.active) throw new SquadError('Integrante inválido.', 400)
  if (user.role === 'ADMIN') throw new SquadError('Administradores não entram em squads.', 400)
  if (user.role !== 'LEAD') {
    const existing = await prisma.squadMember.findFirst({ where: { userId } })
    if (existing) throw new SquadError('Este integrante já pertence a uma squad.', 409)
  }
  try {
    await prisma.squadMember.create({ data: { squadId, userId } })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new SquadError('Já é integrante desta squad.', 409)
    }
    throw err
  }
  return loadSquad(squadId)
}

export async function removeMember(squadId: string, userId: string): Promise<void> {
  await prisma.squadMember.deleteMany({ where: { squadId, userId } })
}
```

- [ ] **Step 4: Rodar os testes para ver passar**

Run: `pnpm --filter @legends/api test -- squad-service`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/squad-service.ts apps/api/src/services/squad-service.test.ts
git commit -m "feat(squad): squad-service com regra de membership (DEV<=1, LEAD ilimitado)"
```

---

## Task 5: Rotas admin de Squad + testes

**Files:**
- Modify: `apps/api/src/routes/admin.ts` (imports topo; schemas ~linha 23; rotas após o bloco de categorias ~linha 120)
- Modify: `apps/api/src/routes/admin.test.ts` (adicionar describe de squads no fim, antes do `})` que fecha o describe externo)

**Interfaces:**
- Consumes: `squad-service` (`listSquads`, `createSquad`, `updateSquad`, `addMember`, `removeMember`, `SquadError`), `toSquadWithMembersDTO`.
- Produces: `GET/POST /admin/squads`, `PATCH /admin/squads/:id`, `POST /admin/squads/:id/members`, `DELETE /admin/squads/:id/members/:userId`.

- [ ] **Step 1: Escrever os testes (falhando) em `admin.test.ts`**

Adicionar, dentro do `describe('admin routes', () => { ... })`, antes do fechamento:

```ts
  it('admin cria squad, adiciona membros com a regra DEV<=1, e desativa', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)

    const created = await app.inject({
      method: 'POST', url: '/admin/squads',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Inovação' },
    })
    expect(created.statusCode).toBe(201)
    const squadId = created.json().squad.id
    expect(created.json().squad.slug).toBe('inovacao')
    expect(created.json().squad.members).toEqual([])

    const dup = await app.inject({
      method: 'POST', url: '/admin/squads',
      headers: { authorization: `Bearer ${token}` }, payload: { name: 'Inovação' },
    })
    expect(dup.statusCode).toBe(409)

    const dev = await prisma.user.create({ data: { name: 'Dev1', email: 'dev1@x.com', passwordHash: 'x', role: 'DEV' } })
    const other = await app.inject({
      method: 'POST', url: '/admin/squads',
      headers: { authorization: `Bearer ${token}` }, payload: { name: 'B2B' },
    })
    const otherId = other.json().squad.id

    const add1 = await app.inject({
      method: 'POST', url: `/admin/squads/${squadId}/members`,
      headers: { authorization: `Bearer ${token}` }, payload: { userId: dev.id },
    })
    expect(add1.statusCode).toBe(201)
    expect(add1.json().squad.members.map((m: { id: string }) => m.id)).toContain(dev.id)

    const add2 = await app.inject({
      method: 'POST', url: `/admin/squads/${otherId}/members`,
      headers: { authorization: `Bearer ${token}` }, payload: { userId: dev.id },
    })
    expect(add2.statusCode).toBe(409)

    const rm = await app.inject({
      method: 'DELETE', url: `/admin/squads/${squadId}/members/${dev.id}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(rm.statusCode).toBe(204)

    const off = await app.inject({
      method: 'PATCH', url: `/admin/squads/${squadId}`,
      headers: { authorization: `Bearer ${token}` }, payload: { active: false },
    })
    expect(off.statusCode).toBe(200)
    expect(off.json().squad.active).toBe(false)
    await app.close()
  })

  it('proíbe não-admin de criar squad (403)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await devToken(app)
    const res = await app.inject({
      method: 'POST', url: '/admin/squads',
      headers: { authorization: `Bearer ${token}` }, payload: { name: 'X' },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `pnpm db:up && pnpm --filter @legends/api test -- admin`
Expected: FAIL (rotas `/admin/squads` retornam 404).

- [ ] **Step 3: Adicionar imports e schemas em `admin.ts`**

No import de serialize (linha 10), acrescentar `toSquadWithMembersDTO`. Adicionar novo import após a linha 12:

```ts
import { listSquads, createSquad, updateSquad, addMember, removeMember, SquadError } from '../services/squad-service'
```

Após `const grantBadgeSchema = ...` (linha 77), adicionar:

```ts
const createSquadSchema = z.object({ name: z.string().min(1) })
const updateSquadSchema = z.object({ name: z.string().min(1).optional(), active: z.boolean().optional() })
const addSquadMemberSchema = z.object({ userId: z.string().min(1) })
```

- [ ] **Step 4: Adicionar as rotas em `admin.ts`**

Após o bloco das rotas de categorias (depois do `})` do `PATCH /admin/categories/:id`, linha ~120), adicionar:

```ts
  app.get('/admin/squads', adminOnly, async (_request, reply) => {
    const squads = await listSquads()
    return reply.send({ squads: squads.map(toSquadWithMembersDTO) })
  })

  app.post('/admin/squads', adminOnly, async (request, reply) => {
    const parsed = createSquadSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos' })
    try {
      const squad = await createSquad(parsed.data)
      return reply.code(201).send({ squad: toSquadWithMembersDTO(squad) })
    } catch (err) {
      if (err instanceof SquadError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.patch('/admin/squads/:id', adminOnly, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = updateSquadSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos' })
    try {
      const squad = await updateSquad(id, parsed.data)
      return reply.send({ squad: toSquadWithMembersDTO(squad) })
    } catch (err) {
      if (err instanceof SquadError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/admin/squads/:id/members', adminOnly, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = addSquadMemberSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos' })
    try {
      const squad = await addMember(id, parsed.data.userId)
      return reply.code(201).send({ squad: toSquadWithMembersDTO(squad) })
    } catch (err) {
      if (err instanceof SquadError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/admin/squads/:id/members/:userId', adminOnly, async (request, reply) => {
    const { id, userId } = request.params as { id: string; userId: string }
    await removeMember(id, userId)
    return reply.code(204).send()
  })
```

- [ ] **Step 5: Rodar para ver passar**

Run: `pnpm --filter @legends/api test -- admin`
Expected: PASS (incluindo os 2 testes novos).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/src/routes/admin.test.ts
git commit -m "feat(squad): rotas admin de CRUD de squads e integrantes"
```

---

## Task 6: Aba "Squads" no painel admin (frontend)

**Files:**
- Create: `apps/web/src/pages/admin/SquadsSection.tsx`
- Modify: `apps/web/src/pages/admin/TabBar.tsx:1-14`
- Modify: `apps/web/src/pages/AdminPage.tsx:8` (import) e `:40` (render)

**Interfaces:**
- Consumes: `apiFetch`, `SquadWithMembersDTO`, `PublicUser`. Endpoints `/admin/squads` e `/admin/users`.
- Produces: componente `SquadsSection` e tab `"squads"`.

- [ ] **Step 1: Adicionar a tab em `TabBar.tsx`**

Trocar o `AdminTabId` e `ADMIN_TABS`:

```ts
export type AdminTabId =
  | "periodos"
  | "lendas"
  | "selos"
  | "categorias"
  | "squads"
  | "moderacao";

export const ADMIN_TABS: { id: AdminTabId; label: string }[] = [
  { id: "periodos", label: "Períodos" },
  { id: "lendas", label: "Lendas" },
  { id: "selos", label: "Selos" },
  { id: "categorias", label: "Categorias" },
  { id: "squads", label: "Squads" },
  { id: "moderacao", label: "Moderação" },
];
```

- [ ] **Step 2: Criar `SquadsSection.tsx`**

```tsx
import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PublicUser, SquadWithMembersDTO } from '@legends/shared'
import { ApiError, apiFetch } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { Panel, inputCls } from './shared'

export function SquadsSection() {
  const queryClient = useQueryClient()
  const [squadName, setSquadName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const squadsQuery = useQuery({
    queryKey: ['admin', 'squads'],
    queryFn: () => apiFetch<{ squads: SquadWithMembersDTO[] }>('/admin/squads'),
  })
  const usersQuery = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => apiFetch<{ users: PublicUser[] }>('/admin/users'),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'squads'] })

  const createSquad = useMutation({
    mutationFn: (body: { name: string }) =>
      apiFetch<{ squad: SquadWithMembersDTO }>('/admin/squads', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => { setSquadName(''); setError(null); setShowForm(false); invalidate() },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao criar squad.'),
  })
  const toggleSquad = useMutation({
    mutationFn: (vars: { id: string; active: boolean }) =>
      apiFetch<{ squad: SquadWithMembersDTO }>(`/admin/squads/${vars.id}`, { method: 'PATCH', body: JSON.stringify({ active: vars.active }) }),
    onSuccess: invalidate,
  })
  const addMember = useMutation({
    mutationFn: (vars: { squadId: string; userId: string }) =>
      apiFetch<{ squad: SquadWithMembersDTO }>(`/admin/squads/${vars.squadId}/members`, { method: 'POST', body: JSON.stringify({ userId: vars.userId }) }),
    onSuccess: () => { setError(null); invalidate() },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao adicionar integrante.'),
  })
  const removeMember = useMutation({
    mutationFn: (vars: { squadId: string; userId: string }) =>
      apiFetch<void>(`/admin/squads/${vars.squadId}/members/${vars.userId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })

  const squads = squadsQuery.data?.squads ?? []
  const users = usersQuery.data?.users ?? []

  function handleCreate(event: FormEvent) {
    event.preventDefault()
    if (!squadName.trim()) return
    createSquad.mutate({ name: squadName.trim() })
  }

  return (
    <Panel
      title="Squads"
      action={
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
        >
          {showForm ? 'Cancelar' : '+ Adicionar squad'}
        </button>
      }
    >
      {showForm && (
        <form onSubmit={handleCreate} className="mb-lg flex gap-sm">
          <input value={squadName} onChange={(e) => setSquadName(e.target.value)} aria-label="Nova squad" placeholder="Nova squad" className={`${inputCls} flex-1`} />
          <button type="submit" className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container">
            Adicionar
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="mb-md flex items-center gap-sm text-body-sm text-error">
          <Icon name="error" className="text-[16px]" />
          {error}
        </p>
      )}
      <ul className="flex flex-col gap-md">
        {squads.map((squad) => {
          const memberIds = new Set(squad.members.map((m) => m.id))
          const addable = users.filter((u) => !memberIds.has(u.id))
          return (
            <li key={squad.id} className="rounded-lg border border-outline-variant/20 bg-surface-container-low p-md">
              <div className="flex items-center justify-between">
                <span className={squad.active ? 'text-on-surface' : 'text-on-surface-variant line-through'}>{squad.name}</span>
                <button
                  onClick={() => toggleSquad.mutate({ id: squad.id, active: !squad.active })}
                  className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
                >
                  {squad.active ? 'Desativar' : 'Ativar'}
                </button>
              </div>
              <ul className="mt-sm flex flex-wrap gap-2">
                {squad.members.map((m) => (
                  <li key={m.id} className="flex items-center gap-1 rounded-full bg-surface-container-highest px-3 py-1 text-body-sm text-on-surface">
                    {m.name}
                    <button aria-label={`Remover ${m.name}`} onClick={() => removeMember.mutate({ squadId: squad.id, userId: m.id })} className="text-on-surface-variant hover:text-error">
                      ×
                    </button>
                  </li>
                ))}
                {squad.members.length === 0 && <li className="text-body-sm text-on-surface-variant">Sem integrantes.</li>}
              </ul>
              <select
                aria-label={`Adicionar integrante à ${squad.name}`}
                className={`${inputCls} mt-sm`}
                value=""
                onChange={(e) => { if (e.target.value) addMember.mutate({ squadId: squad.id, userId: e.target.value }) }}
              >
                <option value="">+ Adicionar integrante…</option>
                {addable.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </li>
          )
        })}
      </ul>
    </Panel>
  )
}
```

- [ ] **Step 3: Ligar no `AdminPage.tsx`**

Adicionar o import após a linha 8:

```tsx
import { SquadsSection } from "./admin/SquadsSection";
```

Adicionar o render após a linha do `categorias` (linha 39):

```tsx
      {activeTab === "squads" && <SquadsSection />}
```

- [ ] **Step 4: Type-check + build do web**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/admin/SquadsSection.tsx apps/web/src/pages/admin/TabBar.tsx apps/web/src/pages/AdminPage.tsx
git commit -m "feat(squad): aba Squads no painel admin (CRUD + integrantes)"
```

---

# Parte B — Retro consome Squad

## Task 7: `RetroRoom` ganha `sprint` + `squadId`, perde `title` (Prisma)

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (model `RetroRoom` ~linha 259-274; model `Squad` da Task 1)
- Create: migration

**Interfaces:**
- Produces: `RetroRoom.sprint Int`, `RetroRoom.squadId String`, relação `RetroRoom.squad`; `Squad.rooms`.

- [ ] **Step 1: Editar o model `RetroRoom`**

Trocar a linha `title String` (linha 261) e o bloco de relações. Resultado:

```prisma
model RetroRoom {
  id                  String          @id @default(cuid())
  sprint              Int
  squadId             String
  createdById         String
  anonymous           Boolean         @default(false)
  votesPerParticipant Int
  status              RetroRoomStatus @default(OPEN)
  createdAt           DateTime        @default(now())
  concludedAt         DateTime?

  creator      User               @relation("RetroRoomsCreated", fields: [createdById], references: [id])
  squad        Squad              @relation(fields: [squadId], references: [id])
  participants RetroParticipant[]
  cards        RetroCard[]

  @@index([createdById])
  @@index([squadId])
}
```

- [ ] **Step 2: Adicionar a relação inversa em `Squad`**

No `model Squad` (criado na Task 1), adicionar a linha `rooms`:

```prisma
model Squad {
  id        String   @id @default(cuid())
  name      String   @unique
  slug      String   @unique
  active    Boolean  @default(true)
  createdAt DateTime @default(now())

  members SquadMember[]
  rooms   RetroRoom[]
}
```

- [ ] **Step 3: Gerar a migration**

Run: `pnpm --filter @legends/api exec prisma migrate dev --name retro_room_sprint_squad`
Expected: cria a migration e regenera o client. (Banco pode ser limpo; se o `migrate dev` pedir reset por causa da coluna `title` removida em dados existentes, aceitar o reset — não há dados de produção.)

- [ ] **Step 4: Re-seed**

Run: `pnpm --filter @legends/api run db:seed`
Expected: sem erro.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(retro): RetroRoom passa a ter sprint e squadId (remove title)"
```

---

## Task 8: Contrato `@legends/shared/retro.ts` — sprint/squad + título derivado

**Files:**
- Modify: `packages/shared/src/retro.ts:53` (constantes), `:130-141` (`RetroRoomSummaryDTO`), `:175-180` (`CreateRetroRoomRequest`); adicionar helper.

**Interfaces:**
- Produces: `MIN_SPRINT`, `MAX_SPRINT`, `retroRoomTitle(sprint, squadName)`; `RetroRoomSummaryDTO` com `sprint`/`squad`; `CreateRetroRoomRequest` com `sprint`/`squadId`. Remove `MAX_ROOM_TITLE_LENGTH`.

- [ ] **Step 1: Trocar as constantes (linha 53)**

Remover `export const MAX_ROOM_TITLE_LENGTH = 120` e adicionar no lugar:

```ts
export const MIN_SPRINT = 1
export const MAX_SPRINT = 999
```

- [ ] **Step 2: Adicionar o helper de título derivado**

Logo após as constantes acima, adicionar:

```ts
/** Título exibível da sala, derivado de sprint + nome da squad. Fonte única (api e web). */
export function retroRoomTitle(sprint: number, squadName: string): string {
  return `Retrospectiva Sprint ${sprint} - Squad ${squadName}`
}
```

- [ ] **Step 3: Atualizar `RetroRoomSummaryDTO` (linha ~130)**

```ts
export interface RetroRoomSummaryDTO {
  id: string
  title: string
  sprint: number
  squad: { id: string; name: string }
  status: RetroRoomStatus
  anonymous: boolean
  votesPerParticipant: number
  createdAt: string
  concludedAt: string | null
  creator: { id: string; name: string }
  participantCount: number
  myRole: RetroRoomRole
}
```

- [ ] **Step 4: Atualizar `CreateRetroRoomRequest` (linha ~175)**

```ts
export interface CreateRetroRoomRequest {
  sprint: number
  squadId: string
  anonymous: boolean
  votesPerParticipant: number
  participantIds: string[]
}
```

- [ ] **Step 5: Build do shared**

Run: `pnpm --filter @legends/shared build`
Expected: compila. (A api/web ainda não compilam — serão ajustadas nas próximas tasks.)

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/retro.ts
git commit -m "feat(shared): retro com sprint/squad e título derivado (remove MAX_ROOM_TITLE_LENGTH)"
```

---

## Task 9: Backend retro — service, serialize, rotas + testes

**Files:**
- Modify: `apps/api/src/services/retro-service.ts` (imports `:1-24`; `retroRoomInclude` `:37-41`; remover `assertTitle` `:76-81`; `createRoom` `:95-120`)
- Modify: `apps/api/src/lib/serialize.ts:269-282` (`toRetroRoomSummaryDTO`)
- Modify: `apps/api/src/routes/retro.ts` (imports `:1-37`; `createRoomSchema` `:39-44`; rota POST `:97-117`; PATCH participants `:146`; nova rota `GET /retro/squads`)
- Modify: `apps/api/src/routes/retro.test.ts` (helper de squad + payloads)
- Modify: `apps/api/src/services/retro-service.test.ts:77` (título derivado)

**Interfaces:**
- Consumes: `retroRoomTitle` de `@legends/shared`; `listSquads` de `squad-service`; `toSquadWithMembersDTO`.
- Produces: `createRoom(input: { creatorId, sprint, squadId, anonymous, votesPerParticipant, participantIds })`; `GET /retro/squads`.

- [ ] **Step 1: Atualizar os testes de `retro.test.ts` (falhando)**

No topo do arquivo, adicionar um helper que cria uma squad e devolve o id (após `devToken`, linha ~13):

```ts
async function mkSquad(app: any, name = 'Inovação') {
  const s = await prisma.squad.create({ data: { name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') } })
  return s.id
}
```

Trocar TODOS os payloads de criação de sala que usam `title: '...'` por `sprint` + `squadId`. Para cada teste que cria sala, criar a squad antes e usar `squadId`. Exemplos das substituições:

No teste "LEAD cria sala (201) e DEV não (403)":
```ts
    const lead = await leadToken(app)
    const dev = await devToken(app)
    const squadId = await mkSquad(app)

    const ok = await app.inject({
      method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${lead.token}` },
      payload: { sprint: 23, squadId, anonymous: true, votesPerParticipant: 3, participantIds: [dev.id] },
    })
    expect(ok.statusCode).toBe(201)
    expect(ok.json().room.myRole).toBe('FACILITATOR')
    expect(ok.json().room.title).toBe('Retrospectiva Sprint 23 - Squad Inovação')
    expect(ok.json().room.sprint).toBe(23)
    expect(ok.json().room.squad.id).toBe(squadId)

    const forbidden = await app.inject({
      method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${dev.token}` },
      payload: { sprint: 1, squadId, anonymous: false, votesPerParticipant: 3, participantIds: [] },
    })
    expect(forbidden.statusCode).toBe(403)
```

No teste "valida corpo inválido (400)": trocar o payload por um inválido nos novos campos:
```ts
      payload: { sprint: 0, squadId: '', anonymous: 'sim', votesPerParticipant: 3, participantIds: [] },
```

Para os demais testes (`DEV não convidado`, `fluxo: cria card`, `PATCH participants`, `card sem color`, `move card`, `modo anônimo`, `vota em sala OPEN`): adicionar `const squadId = await mkSquad(app)` após criar o lead e trocar `title: 'A'`/`title: 'Retro 1'` por `sprint: 1, squadId`. (Use sprints distintos quando quiser, mas qualquer inteiro ≥1 serve.)

Adicionar um teste novo para `GET /retro/squads`:
```ts
  it('GET /retro/squads lista só ativas com membros', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const active = await prisma.squad.create({ data: { name: 'Ativa', slug: 'ativa' } })
    const dev = await devToken(app)
    await prisma.squadMember.create({ data: { squadId: active.id, userId: dev.id } })
    await prisma.squad.create({ data: { name: 'Inativa', slug: 'inativa', active: false } })
    const res = await app.inject({ method: 'GET', url: '/retro/squads', headers: { authorization: `Bearer ${lead.token}` } })
    expect(res.statusCode).toBe(200)
    const names = res.json().squads.map((s: { name: string }) => s.name)
    expect(names).toContain('Ativa')
    expect(names).not.toContain('Inativa')
    const ativa = res.json().squads.find((s: { name: string }) => s.name === 'Ativa')
    expect(ativa.members.map((m: { id: string }) => m.id)).toContain(dev.id)
    await app.close()
  })
```

Adicionar teste de squad inativa/inexistente na criação:
```ts
  it('rejeita criação com squad inativa (400)', async () => {
    const app = buildApp(); await app.ready()
    const lead = await leadToken(app)
    const inactive = await prisma.squad.create({ data: { name: 'Off', slug: 'off', active: false } })
    const res = await app.inject({
      method: 'POST', url: '/retro/rooms', headers: { authorization: `Bearer ${lead.token}` },
      payload: { sprint: 1, squadId: inactive.id, anonymous: false, votesPerParticipant: 3, participantIds: [] },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
```

- [ ] **Step 2: Reescrever `retro-service.test.ts` inteiro**

Esse arquivo tem ~10 chamadas `createRoom({ ..., title: '...' })`. `createRoom` agora exige `sprint`/`squadId` (e valida que a squad existe e está ativa). Substituir o conteúdo inteiro de `apps/api/src/services/retro-service.test.ts` por:

```ts
// apps/api/src/services/retro-service.test.ts
import { describe, it, expect } from 'vitest'
import { prisma } from '../lib/prisma'
import {
  advancePhase,
  createCard,
  createRoom,
  getRoomForViewer,
  listRoomsForUser,
  resolveRole,
  setParticipants,
} from './retro-service'

async function mkUser(name: string, role: 'DEV' | 'LEAD' | 'ADMIN' = 'DEV') {
  return prisma.user.create({ data: { name, email: `${name}@x.com`, passwordHash: 'x', role } })
}
async function mkSquad(name = 'Inovação') {
  return prisma.squad.create({ data: { name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') } })
}

describe('retro-service: salas', () => {
  it('LEAD cria sala e entra como participante automaticamente', async () => {
    const lead = await mkUser('Lia', 'LEAD')
    const dev = await mkUser('Dan', 'DEV')
    const squad = await mkSquad()
    const room = await createRoom({
      creatorId: lead.id, sprint: 23, squadId: squad.id,
      anonymous: true, votesPerParticipant: 3, participantIds: [dev.id],
    })
    const ids = room.participants.map((p) => p.userId).sort()
    expect(ids).toEqual([lead.id, dev.id].sort())
    expect(room.status).toBe('OPEN')
    expect(room.sprint).toBe(23)
    expect(room.squad.name).toBe('Inovação')
  })

  it('não-LEAD não cria sala (403)', async () => {
    const dev = await mkUser('Dan', 'DEV')
    const squad = await mkSquad()
    await expect(
      createRoom({ creatorId: dev.id, sprint: 1, squadId: squad.id, anonymous: false, votesPerParticipant: 3, participantIds: [] }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('rejeita votesPerParticipant fora do intervalo (400)', async () => {
    const lead = await mkUser('Lia', 'LEAD')
    const squad = await mkSquad()
    await expect(
      createRoom({ creatorId: lead.id, sprint: 1, squadId: squad.id, anonymous: false, votesPerParticipant: 0, participantIds: [] }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejeita squad inativa (400)', async () => {
    const lead = await mkUser('Lia', 'LEAD')
    const squad = await prisma.squad.create({ data: { name: 'Off', slug: 'off', active: false } })
    await expect(
      createRoom({ creatorId: lead.id, sprint: 1, squadId: squad.id, anonymous: false, votesPerParticipant: 3, participantIds: [] }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejeita convidar ADMIN (400)', async () => {
    const lead = await mkUser('Lia', 'LEAD')
    const admin = await mkUser('Ada', 'ADMIN')
    const squad = await mkSquad()
    await expect(
      createRoom({ creatorId: lead.id, sprint: 1, squadId: squad.id, anonymous: false, votesPerParticipant: 3, participantIds: [admin.id] }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('resolveRole: criador=FACILITATOR, convidado=PARTICIPANT, LEAD externo=OBSERVER, DEV externo=null', async () => {
    const room = { createdById: 'lead1', participants: [{ userId: 'lead1' }, { userId: 'dev1' }] }
    expect(resolveRole(room, { id: 'lead1', role: 'LEAD' })).toBe('FACILITATOR')
    expect(resolveRole(room, { id: 'dev1', role: 'DEV' })).toBe('PARTICIPANT')
    expect(resolveRole(room, { id: 'lead2', role: 'LEAD' })).toBe('OBSERVER')
    expect(resolveRole(room, { id: 'dev2', role: 'DEV' })).toBeNull()
    expect(resolveRole(room, { id: 'adm', role: 'ADMIN' })).toBeNull()
  })

  it('listRoomsForUser: LEAD vê todas; DEV só as suas', async () => {
    const lead1 = await mkUser('L1', 'LEAD')
    const lead2 = await mkUser('L2', 'LEAD')
    const dev = await mkUser('D', 'DEV')
    const squad = await mkSquad()
    await createRoom({ creatorId: lead1.id, sprint: 10, squadId: squad.id, anonymous: false, votesPerParticipant: 3, participantIds: [dev.id] })
    await createRoom({ creatorId: lead2.id, sprint: 20, squadId: squad.id, anonymous: false, votesPerParticipant: 3, participantIds: [] })

    expect((await listRoomsForUser({ id: lead1.id, role: 'LEAD' })).length).toBe(2)
    const devRooms = await listRoomsForUser({ id: dev.id, role: 'DEV' })
    expect(devRooms.map((r) => r.sprint)).toEqual([10])
  })

  it('getRoomForViewer: DEV não convidado recebe 404', async () => {
    const lead = await mkUser('L', 'LEAD')
    const stranger = await mkUser('S', 'DEV')
    const squad = await mkSquad()
    const room = await createRoom({ creatorId: lead.id, sprint: 1, squadId: squad.id, anonymous: false, votesPerParticipant: 3, participantIds: [] })
    await expect(getRoomForViewer(room.id, { id: stranger.id, role: 'DEV' })).rejects.toMatchObject({ status: 404 })
  })

  it('conclui a sala (OPEN→CONCLUDED) só pelo facilitador; transição inválida = 409', async () => {
    const lead = await mkUser('L', 'LEAD')
    const dev = await mkUser('D', 'DEV')
    const squad = await mkSquad()
    const room = await createRoom({ creatorId: lead.id, sprint: 1, squadId: squad.id, anonymous: false, votesPerParticipant: 3, participantIds: [dev.id] })
    await expect(advancePhase({ roomId: room.id, userId: dev.id, action: 'conclude' })).rejects.toMatchObject({ status: 403 })
    const done = await advancePhase({ roomId: room.id, userId: lead.id, action: 'conclude' })
    expect(done.status).toBe('CONCLUDED')
    await expect(advancePhase({ roomId: room.id, userId: lead.id, action: 'conclude' })).rejects.toMatchObject({ status: 409 })
  })

  it('setParticipants substitui a lista (add/remove) e mantém o criador', async () => {
    const lead = await mkUser('L', 'LEAD')
    const d1 = await mkUser('D1', 'DEV')
    const d2 = await mkUser('D2', 'DEV')
    const squad = await mkSquad()
    const room = await createRoom({ creatorId: lead.id, sprint: 1, squadId: squad.id, anonymous: false, votesPerParticipant: 3, participantIds: [d1.id] })

    const res = await setParticipants({ roomId: room.id, userId: lead.id, participantIds: [d2.id] })
    expect(res.addedUserIds).toEqual([d2.id])
    const ids = res.room.participants.map((p) => p.userId).sort()
    expect(ids).toEqual([lead.id, d2.id].sort())
  })

  it('remover participante mantém os cards dele', async () => {
    const lead = await mkUser('L', 'LEAD')
    const d1 = await mkUser('D1', 'DEV')
    const squad = await mkSquad()
    const room = await createRoom({ creatorId: lead.id, sprint: 1, squadId: squad.id, anonymous: false, votesPerParticipant: 3, participantIds: [d1.id] })
    const card = await createCard({ roomId: room.id, userId: d1.id, text: 'oi', color: 'yellow', x: 0, y: 0 })

    const res = await setParticipants({ roomId: room.id, userId: lead.id, participantIds: [] })
    expect(res.room.participants.map((p) => p.userId)).toEqual([lead.id])
    expect(res.room.cards.some((c) => c.id === card.id)).toBe(true)
  })
})
```

(Removido o import não usado `RetroError`.)

- [ ] **Step 3: Rodar para ver falhar**

Run: `pnpm db:up && pnpm --filter @legends/api test -- retro`
Expected: FAIL (compilação/asserts — `createRoom` ainda espera `title`).

- [ ] **Step 4: Atualizar `retro-service.ts`**

(a) No import de `@legends/shared` (linha 3-24): remover `MAX_ROOM_TITLE_LENGTH`. (Não é mais usado.)

(b) `retroRoomInclude` (linha 37): adicionar `squad: true`:

```ts
export const retroRoomInclude = {
  creator: true,
  squad: true,
  participants: { include: { user: true }, orderBy: { invitedAt: 'asc' } },
  cards: { include: { author: true, votes: true, reactions: true }, orderBy: { createdAt: 'asc' } },
} as const
```

(c) Remover a função `assertTitle` (linhas 76-81) e adicionar `assertSprint`:

```ts
function assertSprint(n: number): void {
  if (!Number.isInteger(n) || n < 1) throw new RetroError('Número da sprint inválido.', 400)
}
```

(d) Reescrever `createRoom` (linhas 95-120):

```ts
export async function createRoom(input: {
  creatorId: string
  sprint: number
  squadId: string
  anonymous: boolean
  votesPerParticipant: number
  participantIds: string[]
}): Promise<RetroRoomWithRelations> {
  const creator = await prisma.user.findUnique({ where: { id: input.creatorId } })
  if (!creator || !creator.active) throw new RetroError('Criador inválido.', 400)
  if (creator.role !== 'LEAD') throw new RetroError('Apenas líderes abrem salas de retrospectiva.', 403)
  assertSprint(input.sprint)
  assertVotes(input.votesPerParticipant)
  const squad = await prisma.squad.findUnique({ where: { id: input.squadId } })
  if (!squad || !squad.active) throw new RetroError('Squad inválida.', 400)
  const invited = [...new Set(input.participantIds)].filter((id) => id !== input.creatorId)
  await assertInvitable(invited)
  const allParticipantIds = [input.creatorId, ...invited]
  return prisma.retroRoom.create({
    data: {
      sprint: input.sprint,
      squadId: input.squadId,
      createdById: input.creatorId,
      anonymous: input.anonymous,
      votesPerParticipant: input.votesPerParticipant,
      participants: { create: allParticipantIds.map((userId) => ({ userId })) },
    },
    include: retroRoomInclude,
  })
}
```

- [ ] **Step 5: Atualizar `serialize.ts` `toRetroRoomSummaryDTO`**

Adicionar `retroRoomTitle` ao import de `@legends/shared` no topo do arquivo. Reescrever o corpo (linhas 269-282):

```ts
export function toRetroRoomSummaryDTO(room: RetroRoomWithRelations, role: RetroRoomRole): RetroRoomSummaryDTO {
  return {
    id: room.id,
    title: retroRoomTitle(room.sprint, room.squad.name),
    sprint: room.sprint,
    squad: { id: room.squad.id, name: room.squad.name },
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

- [ ] **Step 6: Atualizar `retro.ts` (rotas)**

(a) Imports (linhas 3-13): remover `MAX_ROOM_TITLE_LENGTH`; adicionar `retroRoomTitle`. Adicionar imports de service/serialize:

```ts
import { listSquads } from '../services/squad-service'
import { toRetroCardDTO, toRetroRoomDTO, toRetroRoomSummaryDTO, toSquadWithMembersDTO } from '../lib/serialize'
```

(b) `createRoomSchema` (linha 39):

```ts
const createRoomSchema = z.object({
  sprint: z.number().int().min(MIN_SPRINT).max(MAX_SPRINT),
  squadId: z.string().min(1),
  anonymous: z.boolean(),
  votesPerParticipant: z.number().int().min(MIN_VOTES_PER_PARTICIPANT).max(MAX_VOTES_PER_PARTICIPANT),
  participantIds: z.array(z.string()).max(200),
})
```

E adicionar `MIN_SPRINT, MAX_SPRINT` ao import de `@legends/shared`.

(c) Na rota POST `/retro/rooms`, trocar `title: room.title` (linha 105) na chamada de `notifyRetroInvited` por:

```ts
          title: retroRoomTitle(room.sprint, room.squad.name),
```

(d) Na rota PATCH participants (linha 146), trocar `title: room.title` por:

```ts
          await notifyRetroInvited({ roomId: room.id, title: retroRoomTitle(room.sprint, room.squad.name), actorId: request.user.sub, invitedUserIds: addedUserIds })
```

(e) Adicionar a rota `GET /retro/squads` logo após `app.get('/retro/rooms', ...)` (após linha 125):

```ts
  app.get('/retro/squads', { onRequest: [app.authenticate] }, async (_request, reply) => {
    const squads = await listSquads({ activeOnly: true })
    return reply.send({ squads: squads.map(toSquadWithMembersDTO) })
  })
```

- [ ] **Step 7: Rodar testes da api**

Run: `pnpm --filter @legends/api test -- retro`
Expected: PASS (incluindo os testes novos de `/retro/squads` e squad inativa).

- [ ] **Step 8: Type-check geral da api**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/services/retro-service.ts apps/api/src/lib/serialize.ts apps/api/src/routes/retro.ts apps/api/src/routes/retro.test.ts apps/api/src/services/retro-service.test.ts
git commit -m "feat(retro): criação por sprint/squad, título derivado e GET /retro/squads"
```

---

## Task 10: Frontend — API client + `CreateRoomModal` por sprint/squad

**Files:**
- Modify: `apps/web/src/lib/retro-api.ts:1-22, 53-55`
- Modify: `apps/web/src/pages/RetrosPage.tsx:78-162` (`CreateRoomModal`)

**Interfaces:**
- Consumes: `listRetroSquads()`, `createRetroRoom(CreateRetroRoomRequest)`, `retroRoomTitle`, `SquadWithMembersDTO`.
- Produces: `CreateRoomModal({ onClose, defaultSprint? })` reutilizável.

- [ ] **Step 1: Adicionar `listRetroSquads` no client**

Em `apps/web/src/lib/retro-api.ts`, adicionar ao import de `@legends/shared` o tipo `SquadWithMembersDTO`. Adicionar a função (após `listRetroRooms`, linha 16):

```ts
export function listRetroSquads() {
  return apiFetch<{ squads: SquadWithMembersDTO[] }>('/retro/squads')
}
```

(O `createRetroRoom` não muda de assinatura — já recebe `CreateRetroRoomRequest`, cujo formato mudou no shared.)

- [ ] **Step 2: Reescrever `CreateRoomModal` em `RetrosPage.tsx`**

Substituir a função `CreateRoomModal` (linhas 78-162) inteira por:

```tsx
function CreateRoomModal({ onClose, defaultSprint }: { onClose: () => void; defaultSprint?: number }) {
  const qc = useQueryClient()
  const candidates = useQuery({ queryKey: ['retro-invitable'], queryFn: listInvitableUsers })
  const squads = useQuery({ queryKey: ['retro-squads'], queryFn: listRetroSquads })
  const [sprint, setSprint] = useState<number>(defaultSprint ?? 1)
  const [squadId, setSquadId] = useState('')
  const [anonymous, setAnonymous] = useState(true)
  const [votes, setVotes] = useState(3)
  const [selected, setSelected] = useState<string[]>([])

  const create = useMutation({
    mutationFn: () =>
      createRetroRoom({ sprint, squadId, anonymous, votesPerParticipant: votes, participantIds: selected }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['retro-rooms'] })
      onClose()
    },
  })

  function selectSquad(id: string) {
    setSquadId(id)
    const sq = squads.data?.squads.find((s) => s.id === id)
    setSelected(sq ? sq.members.map((m) => m.id) : [])
  }

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const squadName = squads.data?.squads.find((s) => s.id === squadId)?.name
  const canSubmit = sprint >= MIN_SPRINT && squadId !== '' && !create.isPending

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-lg" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-xl border border-outline-variant/40 bg-surface-container p-xl">
        <h3 className="font-headline text-title-lg text-on-surface">Nova retrospectiva</h3>

        <div className="mt-lg flex gap-md">
          <label className="block flex-1 text-label-md text-on-surface-variant">
            Número da Sprint
            <input
              type="number"
              min={MIN_SPRINT}
              max={MAX_SPRINT}
              value={sprint}
              onChange={(e) => setSprint(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-outline-variant/40 bg-surface px-md py-sm text-on-surface"
            />
          </label>
          <label className="block flex-1 text-label-md text-on-surface-variant">
            Squad
            <select
              value={squadId}
              onChange={(e) => selectSquad(e.target.value)}
              className="mt-1 w-full rounded-md border border-outline-variant/40 bg-surface px-md py-sm text-on-surface"
            >
              <option value="">Selecione a squad</option>
              {squads.data?.squads.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
        </div>

        {squadName && (
          <p className="mt-sm text-body-sm text-on-surface-variant">{retroRoomTitle(sprint, squadName)}</p>
        )}

        <div className="mt-md flex items-center gap-lg">
          <label className="flex items-center gap-sm text-body-md text-on-surface">
            <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} />
            Sala anônima
          </label>
          <label className="flex items-center gap-sm text-body-md text-on-surface">
            Votos por pessoa
            <input
              type="number"
              min={MIN_VOTES_PER_PARTICIPANT}
              max={MAX_VOTES_PER_PARTICIPANT}
              value={votes}
              onChange={(e) => setVotes(Number(e.target.value))}
              className="w-16 rounded-md border border-outline-variant/40 bg-surface px-sm py-1 text-on-surface"
            />
          </label>
        </div>

        <fieldset className="mt-md">
          <legend className="text-label-md text-on-surface-variant">Participantes</legend>
          <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-outline-variant/30 p-sm">
            {candidates.data?.users.map((u) => (
              <label key={u.id} className="flex items-center gap-sm py-1 text-body-md text-on-surface">
                <input type="checkbox" checked={selected.includes(u.id)} onChange={() => toggle(u.id)} />
                {u.name}
              </label>
            ))}
          </div>
        </fieldset>

        {create.isError && <p className="mt-md text-body-sm text-error">Não foi possível criar a sala.</p>}

        <div className="mt-xl flex justify-end gap-sm">
          <button type="button" onClick={onClose} className="rounded-md px-lg py-sm text-on-surface-variant hover:bg-surface-container-highest">
            Cancelar
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => create.mutate()}
            className="rounded-md bg-primary px-lg py-sm font-label font-bold text-on-primary disabled:opacity-50"
          >
            {create.isPending ? 'Criando…' : 'Criar sala'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Atualizar imports no topo de `RetrosPage.tsx`**

Trocar o import de `@legends/shared` (linhas 4-8) para incluir as novas constantes e o helper, e o import do client (linha 10) para incluir `listRetroSquads`:

```tsx
import {
  MAX_VOTES_PER_PARTICIPANT,
  MIN_VOTES_PER_PARTICIPANT,
  MIN_SPRINT,
  MAX_SPRINT,
  retroRoomTitle,
  type RetroRoomStatus,
} from '@legends/shared'
import { useAuth } from '../auth/AuthContext'
import { createRetroRoom, listInvitableUsers, listRetroRooms, listRetroSquads } from '../lib/retro-api'
```

- [ ] **Step 4: Type-check do web**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: `RetrosPage` (Tela 1) ainda usa `room.title` no card — segue válido (DTO mantém `title`). Sem erros nos arquivos editados. (A Tela 1 será reescrita na B5.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/retro-api.ts apps/web/src/pages/RetrosPage.tsx
git commit -m "feat(retro/web): modal de criação por sprint + squad com pré-preenchimento de integrantes"
```

---

## Task 11: Frontend — listagem em 2 telas (sprint → salas) + rota

**Files:**
- Modify: `apps/web/src/pages/RetrosPage.tsx` (extrair `RoomCard`; reescrever `RetrosPage`; adicionar `RetroSprintPage`)
- Modify: `apps/web/src/App.tsx:17` (import) e `:95-102` (rotas)
- Create: `apps/web/src/pages/RetrosPage.test.tsx`

**Interfaces:**
- Consumes: `listRetroRooms`, `RetroRoomSummaryDTO`, `useParams`.
- Produces: `RetrosPage` (Tela 1, cards por sprint) e `RetroSprintPage` (Tela 2, salas de uma sprint).

- [ ] **Step 1: Escrever o teste (falhando) `RetrosPage.test.tsx`**

```tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, type Mock } from 'vitest'
import { RetrosPage } from './RetrosPage'
import { listRetroRooms } from '../lib/retro-api'

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'l1', name: 'Lia', role: 'LEAD' }, loading: false }),
}))
vi.mock('../lib/retro-api', () => ({
  listRetroRooms: vi.fn(),
  listRetroSquads: vi.fn(() => Promise.resolve({ squads: [] })),
  listInvitableUsers: vi.fn(() => Promise.resolve({ users: [] })),
  createRetroRoom: vi.fn(),
}))

function room(id: string, sprint: number, squadName: string) {
  return {
    id, title: `Retrospectiva Sprint ${sprint} - Squad ${squadName}`, sprint,
    squad: { id: 's' + id, name: squadName }, status: 'OPEN', anonymous: false,
    votesPerParticipant: 3, createdAt: '2026-06-01T00:00:00.000Z', concludedAt: null,
    creator: { id: 'l1', name: 'Lia' }, participantCount: 2, myRole: 'FACILITATOR',
  }
}

it('agrupa salas por sprint e mostra a contagem', async () => {
  ;(listRetroRooms as unknown as Mock).mockResolvedValue({
    rooms: [room('a', 23, 'Inovação'), room('b', 23, 'B2B'), room('c', 22, 'Inovação')],
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <RetrosPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  expect(await screen.findByText('Sprint 23')).toBeInTheDocument()
  expect(screen.getByText('Sprint 22')).toBeInTheDocument()
  expect(screen.getByText('2 salas')).toBeInTheDocument()
  expect(screen.getByText('1 sala')).toBeInTheDocument()
})
```

- [ ] **Step 2: Rodar para ver falhar**

Run: `pnpm --filter @legends/web test -- RetrosPage`
Expected: FAIL (`RetrosPage` ainda renderiza grid de salas, não "Sprint 23").

- [ ] **Step 3: Extrair `RoomCard` e reescrever `RetrosPage` + adicionar `RetroSprintPage`**

Em `RetrosPage.tsx`, adicionar `useMemo` ao import do React (linha 1) e `useParams` ao import do router (linha 2):

```tsx
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
```

Adicionar o componente `RoomCard` (reutilizado pelas duas telas) — colocar logo após `STATUS_LABEL` (linha 15):

```tsx
function RoomCard({ room }: { room: RetroRoomSummaryDTO }) {
  return (
    <li>
      <Link
        to={`/retrospectivas/${room.id}`}
        className="block rounded-xl border border-outline-variant/30 bg-surface-container px-lg py-md transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-lg"
      >
        <div className="flex items-center justify-between gap-sm">
          <span className="font-label text-[11px] uppercase tracking-wide text-primary">{STATUS_LABEL[room.status]}</span>
          {room.anonymous && <span className="font-label text-[11px] text-on-surface-variant">anônima</span>}
        </div>
        <h3 className="mt-1 font-headline text-title-md text-on-surface">{room.squad.name}</h3>
        <p className="mt-2 text-body-sm text-on-surface-variant">{room.creator.name} · {room.participantCount} participantes</p>
      </Link>
    </li>
  )
}
```

(Adicionar `type RetroRoomSummaryDTO` ao import de `@legends/shared`.)

Reescrever a função `RetrosPage` (Tela 1):

```tsx
export function RetrosPage() {
  const { user } = useAuth()
  const isLead = user?.role === 'LEAD'
  const rooms = useQuery({ queryKey: ['retro-rooms'], queryFn: listRetroRooms })
  const [modalOpen, setModalOpen] = useState(false)

  const bySprint = useMemo(() => {
    const map = new Map<number, number>()
    for (const r of rooms.data?.rooms ?? []) map.set(r.sprint, (map.get(r.sprint) ?? 0) + 1)
    return [...map.entries()].sort((a, b) => b[0] - a[0])
  }, [rooms.data])

  return (
    <section className="mx-auto max-w-7xl p-lg md:p-xl">
      <header className="mb-xl flex items-start justify-between gap-md">
        <div>
          <h2 className="font-headline text-headline-xl text-on-surface">Retrospectivas</h2>
          <p className="mt-2 max-w-xl text-body-md text-on-surface-variant">
            Quadros de retrospectiva de sprint do time, em tempo real.
          </p>
        </div>
        {isLead && (
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="shrink-0 rounded-md bg-primary px-lg py-sm font-label text-label-lg font-bold text-on-primary transition-colors hover:bg-primary-container"
          >
            Nova sala
          </button>
        )}
      </header>

      {rooms.isLoading ? (
        <p className="py-2xl text-center text-on-surface-variant">Carregando…</p>
      ) : bySprint.length === 0 ? (
        <p className="py-2xl text-center text-on-surface-variant">Nenhuma sala por aqui ainda.</p>
      ) : (
        <ul className="grid gap-md sm:grid-cols-2 lg:grid-cols-3">
          {bySprint.map(([sprint, count]) => (
            <li key={sprint}>
              <Link
                to={`/retrospectivas/sprint/${sprint}`}
                className="block rounded-xl border border-outline-variant/30 bg-surface-container px-lg py-lg transition-all hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-lg"
              >
                <h3 className="font-headline text-title-lg text-on-surface">Sprint {sprint}</h3>
                <p className="mt-2 text-body-sm text-on-surface-variant">{count === 1 ? '1 sala' : `${count} salas`}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {modalOpen && <CreateRoomModal onClose={() => setModalOpen(false)} />}
    </section>
  )
}
```

Adicionar a função `RetroSprintPage` (Tela 2) logo após `RetrosPage`:

```tsx
export function RetroSprintPage() {
  const { user } = useAuth()
  const isLead = user?.role === 'LEAD'
  const { sprint } = useParams<{ sprint: string }>()
  const sprintNum = Number(sprint)
  const rooms = useQuery({ queryKey: ['retro-rooms'], queryFn: listRetroRooms })
  const [modalOpen, setModalOpen] = useState(false)

  const filtered = (rooms.data?.rooms ?? []).filter((r) => r.sprint === sprintNum)

  return (
    <section className="mx-auto max-w-7xl p-lg md:p-xl">
      <Link to="/retrospectivas" className="text-body-sm text-primary hover:underline">← Voltar para sprints</Link>
      <header className="mb-xl mt-sm flex items-start justify-between gap-md">
        <h2 className="font-headline text-headline-xl text-on-surface">Sprint {sprintNum}</h2>
        {isLead && (
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="shrink-0 rounded-md bg-primary px-lg py-sm font-label text-label-lg font-bold text-on-primary transition-colors hover:bg-primary-container"
          >
            Nova sala
          </button>
        )}
      </header>

      {rooms.isLoading ? (
        <p className="py-2xl text-center text-on-surface-variant">Carregando…</p>
      ) : filtered.length === 0 ? (
        <p className="py-2xl text-center text-on-surface-variant">Nenhuma sala nesta sprint.</p>
      ) : (
        <ul className="grid gap-md sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((room) => <RoomCard key={room.id} room={room} />)}
        </ul>
      )}

      {modalOpen && <CreateRoomModal onClose={() => setModalOpen(false)} defaultSprint={sprintNum} />}
    </section>
  )
}
```

- [ ] **Step 4: Adicionar a rota no `App.tsx`**

Trocar o import (linha 17):

```tsx
import { RetrosPage, RetroSprintPage } from './pages/RetrosPage'
```

Adicionar a rota da Tela 2 logo após o bloco `/retrospectivas` (após linha 102, dentro do mesmo grupo `AppLayout`):

```tsx
              <Route
                path="/retrospectivas/sprint/:sprint"
                element={
                  <DevOnly>
                    <RetroSprintPage />
                  </DevOnly>
                }
              />
```

- [ ] **Step 5: Rodar o teste do web**

Run: `pnpm --filter @legends/web test -- RetrosPage`
Expected: PASS.

- [ ] **Step 6: Type-check do web**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/RetrosPage.tsx apps/web/src/pages/RetrosPage.test.tsx apps/web/src/App.tsx
git commit -m "feat(retro/web): listagem em duas telas agrupada por sprint"
```

---

## Task 12: Verificação final (build + suíte completa)

**Files:** nenhum (gate de verificação).

- [ ] **Step 1: Suíte completa com Postgres de pé**

Run: `pnpm db:up && pnpm test`
Expected: todos os testes PASS.

- [ ] **Step 2: Build de todos os workspaces**

Run: `pnpm build`
Expected: build sem erros (shared, api, web).

- [ ] **Step 3: Verificação manual rápida (opcional, recomendada)**

Run: `pnpm db:up && pnpm --filter @legends/api run db:seed && pnpm dev`
Verificar no navegador: (1) admin → aba **Squads** cria squad, adiciona DEV (2º squad para DEV dá erro), remove e desativa; (2) retro → **Nova sala** mostra Sprint + Squad, ao escolher squad pré-preenche participantes, cria; (3) listagem mostra **cards por sprint**; clicar abre a Tela 2 com as salas da sprint; **Nova sala** na Tela 2 já vem com a sprint preenchida.

- [ ] **Step 4: Commit final (se algo foi ajustado)**

```bash
git add -A
git commit -m "chore(retro): ajustes finais pós-verificação"
```

---

## Notas de cobertura (spec → tasks)

- Squad entidade + CRUD admin: Tasks 1, 2, 3, 4, 5, 6.
- Regra membership DEV≤1/LEAD ilimitado: Task 4 (service) + Task 5 (rota/teste).
- `User.squad` texto intocado: garantido (Task 1 só adiciona relação inversa).
- RetroRoom sprint/squad, título derivado: Tasks 7, 8, 9.
- `GET /retro/squads` (ativas + membros): Task 9.
- Pré-preenchimento de integrantes ao escolher squad (re-seta na troca): Task 10.
- Listagem por sprint em 2 telas + botão criar nas duas (Tela 2 pré-preenche sprint): Task 11.
- Fora de escopo (fundir squad, editar sprint/squad de sala existente, mudar exibição de `User.squad`): não há tasks — intencional.

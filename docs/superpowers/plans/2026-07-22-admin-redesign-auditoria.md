# Redesign do admin + auditoria — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o painel admin de abas (`AdminPage`/`TabBar`, tudo numa página só) por rotas próprias com sidebar dedicada e um dashboard de acompanhamento, e introduzir um log de auditoria (`AdminAuditLog`) que registra quem criou/editou/excluiu o quê, com o antes/depois, em toda mutação hoje protegida por `requireAdmin`.

**Architecture:** `recordAuditLog` é um helper único (`apps/api/src/services/audit-log-service.ts`) chamado explicitamente ao final de cada função de serviço que já muta dado — dentro do mesmo `$transaction` quando já existir um. `AdminLayout` (novo) vira um layout route do React Router envolvendo `/admin/*`, com uma sidebar dedicada agrupada por categoria; cada seção existente (`XSection.tsx`) passa a ser roteada na própria URL sem mudar de lógica interna. `AdminDashboardPage` e `AdminAuditLogPage` são as duas telas novas.

**Tech Stack:** Fastify 4 + Prisma 5 + PostgreSQL (API), Vite 5 + React 18 + React Router 6 + React Query (web), Zod, Vitest.

## Global Constraints

- TypeScript strict, ESM puro; migrations geradas com `pnpm db:migrate`, nunca editando uma já aplicada.
- Mensagens ao usuário em português.
- Rotas finas → lógica no service → DTO em `lib/serialize.ts`; contrato de tipos em `@legends/shared`.
- Testes Vitest colocados ao lado do código; a API precisa do Postgres local rodando (`pnpm db:up`) e testa contra banco real.
- Durante a implementação, rode só o(s) arquivo(s) de teste do que foi alterado; a suíte completa (`pnpm test`) é a verificação final antes de encerrar o plano.
- **Fora do escopo, decisão já tomada:** `PUT /admin/office-maps/:id/draft` (autosave) e `POST /admin/office-maps/:id/lock/heartbeat` NÃO são auditados (alta frequência, não são decisões administrativas). `POST /admin/office-maps/:id/validate` também não — é leitura/validação, não muta nada.
- **`recordAuditLog`** normaliza `before`/`after` internamente via `JSON.parse(JSON.stringify(...))`, então qualquer chamador pode passar o registro Prisma bruto (com `Date`s) sem se preocupar em serializar antes.
- `entityType` é sempre o nome exato do model Prisma envolvido (`Category`, `Squad`, `SquadMember`, `Sector`, `User`, `VotingPeriod`, `Badge`, `UserBadge`, `Vote`, `RetroRoom`, `OfficeMap`, `OfficeMapAsset`, `OfficeMapPublication`, `OfficeRoom`, `OfficeDeskClaim`, `OfficeGuestInvite`, `ThirdPartyInvite`, `AppSetting`, `OfficeSetting`).

---

## Task 1: Shared package — tipos de auditoria e do dashboard

**Files:**
- Create: `packages/shared/src/audit-log.ts`
- Create: `packages/shared/src/admin-dashboard.ts`
- Modify: `packages/shared/src/index.ts` (exporta os dois novos módulos)
- Test: `packages/shared/src/audit-log.test.ts`

**Interfaces:**
- Produces: `ADMIN_AUDIT_ACTIONS`, `type AdminAuditAction`, `AuditLogActorRef`, `AuditLogEntryDTO`, `AuditLogListResponse`, `SectorDashboardCardDTO`, `AdminDashboardResponse`.

- [ ] **Step 1: Criar `packages/shared/src/audit-log.ts`**

```ts
export const ADMIN_AUDIT_ACTIONS = ['CREATE', 'UPDATE', 'DELETE'] as const
export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[number]

export const ADMIN_AUDIT_ACTION_LABELS: Record<AdminAuditAction, string> = {
  CREATE: 'Criou',
  UPDATE: 'Editou',
  DELETE: 'Excluiu',
}

export interface AuditLogActorRef {
  id: string
  name: string
}

export interface AuditLogEntryDTO {
  id: string
  actor: AuditLogActorRef
  entityType: string
  entityId: string
  action: AdminAuditAction
  before: unknown
  after: unknown
  createdAt: string
}

export interface AuditLogListResponse {
  entries: AuditLogEntryDTO[]
  total: number
  page: number
  pageSize: number
}
```

- [ ] **Step 2: Criar `packages/shared/src/admin-dashboard.ts`**

```ts
import type { VotingPeriodState } from './enums'

export interface SectorDashboardPeriodDTO {
  id: string
  monthRef: string
  state: VotingPeriodState
  startsAt: string
  endsAt: string
  votesCast: number
}

export interface SectorDashboardCardDTO {
  sectorId: string
  sectorName: string
  activeUserCount: number
  period: SectorDashboardPeriodDTO | null
  /** true quando o último período ENCERRADO deste setor ainda não tem destaque publicado. */
  pendingHighlight: boolean
}

export interface AdminDashboardResponse {
  sectors: SectorDashboardCardDTO[]
}
```

- [ ] **Step 3: Exportar os dois módulos em `packages/shared/src/index.ts`**

Adicionar ao final do arquivo:

```ts
export * from './audit-log'
export * from './admin-dashboard'
```

- [ ] **Step 4: Escrever o smoke test**

```ts
// packages/shared/src/audit-log.test.ts
import { describe, it, expect } from 'vitest'
import { ADMIN_AUDIT_ACTIONS, ADMIN_AUDIT_ACTION_LABELS } from './audit-log'

describe('audit-log shared types', () => {
  it('toda ADMIN_AUDIT_ACTIONS tem rótulo', () => {
    for (const action of ADMIN_AUDIT_ACTIONS) {
      expect(ADMIN_AUDIT_ACTION_LABELS[action]).toBeTruthy()
    }
  })
})
```

- [ ] **Step 5: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/shared exec vitest run src/audit-log.test.ts`
Expected: PASS (1 teste)

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/audit-log.ts packages/shared/src/admin-dashboard.ts packages/shared/src/index.ts packages/shared/src/audit-log.test.ts
git commit -m "feat(shared): tipos de log de auditoria e do dashboard do admin"
```

---

## Task 2: Prisma — model `AdminAuditLog`

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_add_admin_audit_log/migration.sql`

**Interfaces:**
- Produces: enum `AdminAuditAction` (CREATE/UPDATE/DELETE), model `AdminAuditLog` (`id`, `actorId`, `entityType`, `entityId`, `action`, `before: Json?`, `after: Json?`, `createdAt`), relação `actor: User`.

- [ ] **Step 1: Editar `apps/api/prisma/schema.prisma`**

Adicionar (em qualquer ponto do arquivo, por exemplo depois de `model Sector`):

```prisma
enum AdminAuditAction {
  CREATE
  UPDATE
  DELETE
}

model AdminAuditLog {
  id         String            @id @default(cuid())
  actorId    String
  entityType String
  entityId   String
  action     AdminAuditAction
  before     Json?
  after      Json?
  createdAt  DateTime          @default(now())

  actor User @relation("AdminAuditActor", fields: [actorId], references: [id])

  @@index([entityType, entityId])
  @@index([actorId])
  @@index([createdAt])
}
```

No `model User`, adicionar a relação inversa (perto de `votesGiven`):

```prisma
  adminAuditLogs    AdminAuditLog[] @relation("AdminAuditActor")
```

- [ ] **Step 2: Gerar e aplicar a migration**

Run: `cd apps/api && pnpm exec prisma migrate dev --name add_admin_audit_log`
Expected: migration criada e aplicada, `Generated Prisma Client`. (Se o ambiente bloquear `migrate dev` de forma não-interativa, use `prisma migrate diff` + criação manual da pasta + `prisma migrate deploy`, como já feito na Task 2 do plano de setorização — documente a mesma ressalva se precisar.)

- [ ] **Step 3: Rodar a suíte da API inteira para confirmar que nada quebrou**

Run: `pnpm db:up && pnpm --filter @legends/api test`
Expected: todos os testes passam (só uma tabela nova, nenhuma coluna obrigatória em tabela existente — não deve afetar nada).

- [ ] **Step 4: Commit**

```bash
git add apps/api/prisma
git commit -m "feat(api): adiciona model AdminAuditLog"
```

---

## Task 3: `audit-log-service.ts` (helper de gravação) + rota de listagem

**Files:**
- Create: `apps/api/src/services/audit-log-service.ts`
- Create: `apps/api/src/services/audit-log-service.test.ts`
- Modify: `apps/api/src/lib/serialize.ts` (adiciona `toAuditLogEntryDTO`)
- Modify: `apps/api/src/routes/admin.ts` (adiciona `GET /admin/audit-log`)
- Test: extensão de `apps/api/src/routes/admin.test.ts`

**Interfaces:**
- Produces: `recordAuditLog(input: RecordAuditLogInput): Promise<void>`, `listAuditLog(filters: { actorId?; entityType?; from?; to?; page: number; pageSize: number }): Promise<{ entries: AuditLogWithActor[]; total: number }>`, `toAuditLogEntryDTO`.
- Consumes: nada além do Prisma client — esta é a fundação que as Tasks 4-12 vão chamar.

- [ ] **Step 1: Escrever os testes de `audit-log-service.test.ts` (falhando)**

```ts
// apps/api/src/services/audit-log-service.test.ts
import { describe, it, expect } from 'vitest'
import { prisma } from '../lib/prisma'
import { recordAuditLog, listAuditLog } from './audit-log-service'

async function mkUser(name: string) {
  return prisma.user.create({ data: { name, email: `${name}@x.com`, passwordHash: 'x', role: 'ADMIN' } })
}

describe('recordAuditLog', () => {
  it('grava CREATE com before nulo', async () => {
    const admin = await mkUser('Ana')
    await recordAuditLog({ actorId: admin.id, entityType: 'Category', entityId: 'cat-1', action: 'CREATE', after: { name: 'Colaboração' } })
    const rows = await prisma.adminAuditLog.findMany({ where: { entityId: 'cat-1' } })
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('CREATE')
    expect(rows[0].before).toBeNull()
    expect(rows[0].after).toEqual({ name: 'Colaboração' })
  })

  it('grava UPDATE com before e after, normalizando Date para string', async () => {
    const admin = await mkUser('Bia')
    const createdAt = new Date('2026-01-01T00:00:00.000Z')
    await recordAuditLog({
      actorId: admin.id,
      entityType: 'Category',
      entityId: 'cat-2',
      action: 'UPDATE',
      before: { name: 'Antigo', createdAt },
      after: { name: 'Novo', createdAt },
    })
    const row = await prisma.adminAuditLog.findFirstOrThrow({ where: { entityId: 'cat-2' } })
    expect(row.before).toEqual({ name: 'Antigo', createdAt: createdAt.toISOString() })
    expect(row.after).toEqual({ name: 'Novo', createdAt: createdAt.toISOString() })
  })

  it('grava DELETE com after nulo', async () => {
    const admin = await mkUser('Caio')
    await recordAuditLog({ actorId: admin.id, entityType: 'Category', entityId: 'cat-3', action: 'DELETE', before: { name: 'Sumiu' } })
    const row = await prisma.adminAuditLog.findFirstOrThrow({ where: { entityId: 'cat-3' } })
    expect(row.after).toBeNull()
  })

  it('funciona dentro de uma transação existente (tx)', async () => {
    const admin = await mkUser('Duda')
    await prisma.$transaction(async (tx) => {
      await recordAuditLog({ actorId: admin.id, entityType: 'Category', entityId: 'cat-4', action: 'CREATE', after: { name: 'X' }, tx })
    })
    expect(await prisma.adminAuditLog.count({ where: { entityId: 'cat-4' } })).toBe(1)
  })
})

describe('listAuditLog', () => {
  it('pagina e filtra por entityType e actorId', async () => {
    const ana = await mkUser('Ana2')
    const bia = await mkUser('Bia2')
    await recordAuditLog({ actorId: ana.id, entityType: 'Category', entityId: 'c1', action: 'CREATE', after: {} })
    await recordAuditLog({ actorId: bia.id, entityType: 'Badge', entityId: 'b1', action: 'CREATE', after: {} })
    await recordAuditLog({ actorId: ana.id, entityType: 'Category', entityId: 'c2', action: 'CREATE', after: {} })

    const byType = await listAuditLog({ entityType: 'Category', page: 1, pageSize: 10 })
    expect(byType.total).toBe(2)
    expect(byType.entries.every((e) => e.entityType === 'Category')).toBe(true)

    const byActor = await listAuditLog({ actorId: bia.id, page: 1, pageSize: 10 })
    expect(byActor.total).toBe(1)
    expect(byActor.entries[0].actorId).toBe(bia.id)
  })

  it('ordena do mais recente pro mais antigo e pagina', async () => {
    const ana = await mkUser('Ana3')
    for (let i = 0; i < 3; i += 1) {
      await recordAuditLog({ actorId: ana.id, entityType: 'Category', entityId: `p${i}`, action: 'CREATE', after: { i } })
    }
    const page1 = await listAuditLog({ page: 1, pageSize: 2 })
    expect(page1.entries).toHaveLength(2)
    expect(page1.total).toBeGreaterThanOrEqual(3)
    const page2 = await listAuditLog({ page: 2, pageSize: 2 })
    expect(page2.entries.length).toBeGreaterThanOrEqual(1)
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm db:up && pnpm --filter @legends/api exec vitest run src/services/audit-log-service.test.ts`
Expected: FAIL (`Cannot find module './audit-log-service'`)

- [ ] **Step 3: Implementar `audit-log-service.ts`**

```ts
// apps/api/src/services/audit-log-service.ts
import { Prisma, type AdminAuditAction } from '@prisma/client'
import { prisma } from '../lib/prisma'

export interface RecordAuditLogInput {
  actorId: string
  entityType: string
  entityId: string
  action: AdminAuditAction
  before?: unknown
  after?: unknown
  tx?: Prisma.TransactionClient
}

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (value === undefined) return Prisma.DbNull
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}

/**
 * Grava um evento de auditoria. Chamado explicitamente ao final de cada função
 * de serviço que muta dado sob `requireAdmin` — dentro do mesmo `$transaction`
 * quando já existir um (`tx`), para atomicidade com a mutação em si.
 */
export async function recordAuditLog(input: RecordAuditLogInput): Promise<void> {
  const client = input.tx ?? prisma
  await client.adminAuditLog.create({
    data: {
      actorId: input.actorId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      before: toJson(input.before),
      after: toJson(input.after),
    },
  })
}

export interface AuditLogFilters {
  actorId?: string
  entityType?: string
  from?: Date
  to?: Date
  page: number
  pageSize: number
}

export const auditLogInclude = { actor: { select: { id: true, name: true } } } as const
export type AuditLogWithActor = Prisma.AdminAuditLogGetPayload<{ include: typeof auditLogInclude }>

export async function listAuditLog(filters: AuditLogFilters): Promise<{ entries: AuditLogWithActor[]; total: number }> {
  const where: Prisma.AdminAuditLogWhereInput = {
    ...(filters.actorId ? { actorId: filters.actorId } : {}),
    ...(filters.entityType ? { entityType: filters.entityType } : {}),
    ...(filters.from || filters.to
      ? { createdAt: { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) } }
      : {}),
  }
  const [entries, total] = await Promise.all([
    prisma.adminAuditLog.findMany({
      where,
      include: auditLogInclude,
      orderBy: { createdAt: 'desc' },
      skip: (filters.page - 1) * filters.pageSize,
      take: filters.pageSize,
    }),
    prisma.adminAuditLog.count({ where }),
  ])
  return { entries, total }
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/api exec vitest run src/services/audit-log-service.test.ts`
Expected: PASS (6 testes)

- [ ] **Step 5: Adicionar `toAuditLogEntryDTO` em `apps/api/src/lib/serialize.ts`**

Adicionar `type AuditLogEntryDTO` à lista de imports de `'@legends/shared'` já existente, e a função no final do arquivo:

```ts
export function toAuditLogEntryDTO(entry: AuditLogWithActor): AuditLogEntryDTO {
  return {
    id: entry.id,
    actor: { id: entry.actor.id, name: entry.actor.name },
    entityType: entry.entityType,
    entityId: entry.entityId,
    action: entry.action,
    before: entry.before,
    after: entry.after,
    createdAt: entry.createdAt.toISOString(),
  }
}
```

Adicionar o import de `type AuditLogWithActor` de `'../services/audit-log-service'`.

- [ ] **Step 6: Escrever o teste de rota (falhando)**

Adicionar ao final de `apps/api/src/routes/admin.test.ts`:

```ts
describe('GET /admin/audit-log', () => {
  it('lista, filtra por entityType/actorId e pagina', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    await app.inject({ method: 'POST', url: '/admin/categories', headers: { authorization: `Bearer ${token}` }, payload: { name: 'Auditoria A' } })
    await app.inject({ method: 'POST', url: '/admin/categories', headers: { authorization: `Bearer ${token}` }, payload: { name: 'Auditoria B' } })

    const res = await app.inject({ method: 'GET', url: '/admin/audit-log?entityType=Category&page=1&pageSize=1', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { entries: Array<{ entityType: string; action: string }>; total: number; page: number; pageSize: number }
    expect(body.entries).toHaveLength(1)
    expect(body.total).toBeGreaterThanOrEqual(2)
    expect(body.entries[0].entityType).toBe('Category')
    expect(body.entries[0].action).toBe('CREATE')
    await app.close()
  })

  it('forbids non-admin (403)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await devToken(app)
    const res = await app.inject({ method: 'GET', url: '/admin/audit-log', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})
```

(Este teste só vai passar de verdade depois que a Task 4 instrumentar `POST /admin/categories` — por ora, rode-o e espere falha por `body.total` ser `0`; ele fecha o ciclo TDD junto com a Task 4, não precisa passar isoladamente nesta task.)

- [ ] **Step 7: Adicionar a rota em `apps/api/src/routes/admin.ts`**

Adicionar aos imports:

```ts
import { listAuditLog } from '../services/audit-log-service'
```

E `toAuditLogEntryDTO` à lista de imports de `'../lib/serialize'` já existente.

Adicionar o schema de query perto dos demais:

```ts
const auditLogQuerySchema = z.object({
  actorId: z.string().min(1).optional(),
  entityType: z.string().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
})
```

E, dentro de `adminRoutes`, antes do `app.get('/admin/retro/rooms', ...)` (ou em qualquer ponto — não depende de ordem):

```ts
  app.get('/admin/audit-log', adminOnly, async (request, reply) => {
    const parsed = auditLogQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    const { entries, total } = await listAuditLog(parsed.data)
    return reply.send({
      entries: entries.map(toAuditLogEntryDTO),
      total,
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
    })
  })
```

- [ ] **Step 8: Rodar e confirmar sucesso do teste de forbid; anotar o outro como pendente**

Run: `pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts -t "audit-log"`
Expected: o teste "forbids non-admin" PASSA; o teste de listagem ainda FALHA (esperado — só fecha na Task 4).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/services/audit-log-service.ts apps/api/src/services/audit-log-service.test.ts apps/api/src/lib/serialize.ts apps/api/src/routes/admin.ts apps/api/src/routes/admin.test.ts
git commit -m "feat(api): audit-log-service (recordAuditLog/listAuditLog) e GET /admin/audit-log"
```

---

## Task 4: Instrumentar Categorias, config. de Quinta-dev e config. do Escritório

**Files:**
- Modify: `apps/api/src/routes/admin.ts` (categorias)
- Modify: `apps/api/src/services/development-thursday-service.ts` (`updateDevelopmentThursdaySettings`)
- Modify: `apps/api/src/services/office-setting-service.ts` (`setBroadcastEnabled`)
- Test: extensão de `apps/api/src/routes/admin.test.ts`

**Interfaces:**
- Consumes: `recordAuditLog` (Task 3).

- [ ] **Step 1: Escrever os testes (falhando)**

Adicionar a `apps/api/src/routes/admin.test.ts`:

```ts
describe('auditoria — categorias, quinta-dev, escritório', () => {
  it('audita criação e edição de categoria', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const created = await app.inject({ method: 'POST', url: '/admin/categories', headers: { authorization: `Bearer ${token}` }, payload: { name: 'Foco no cliente' } })
    const id = created.json().category.id

    await app.inject({ method: 'PATCH', url: `/admin/categories/${id}`, headers: { authorization: `Bearer ${token}` }, payload: { active: false } })

    const rows = await prisma.adminAuditLog.findMany({ where: { entityType: 'Category', entityId: id }, orderBy: { createdAt: 'asc' } })
    expect(rows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE'])
    expect(rows[1].before).toMatchObject({ active: true })
    expect((rows[1].after as { active: boolean }).active).toBe(false)
    await app.close()
  })

  it('audita config de quinta-dev e do escritório', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    await app.inject({ method: 'PATCH', url: '/admin/development-thursday/settings', headers: { authorization: `Bearer ${token}` }, payload: { teamsWebhookUrl: 'https://example.com/hook' } })
    await app.inject({ method: 'PATCH', url: '/admin/office-settings', headers: { authorization: `Bearer ${token}` }, payload: { broadcastEnabled: true } })

    expect(await prisma.adminAuditLog.count({ where: { entityType: 'AppSetting' } })).toBe(1)
    expect(await prisma.adminAuditLog.count({ where: { entityType: 'OfficeSetting' } })).toBe(1)
    await app.close()
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts -t "auditoria — categorias"`
Expected: FAIL

- [ ] **Step 3: Instrumentar categorias em `apps/api/src/routes/admin.ts`**

Trocar o handler `POST /admin/categories`:

```ts
  app.post('/admin/categories', adminOnly, async (request, reply) => {
    const parsed = createCategorySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos' })
    }
    try {
      const category = await prisma.category.create({
        data: { name: parsed.data.name, slug: slugify(parsed.data.name), description: parsed.data.description },
      })
      await recordAuditLog({ actorId: request.user.sub, entityType: 'Category', entityId: category.id, action: 'CREATE', after: category })
      return reply.code(201).send({ category: toCategoryDTO(category) })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.code(409).send({ message: 'Já existe uma categoria com esse nome.' })
      }
      throw err
    }
  })
```

E `PATCH /admin/categories/:id`:

```ts
  app.patch('/admin/categories/:id', adminOnly, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = updateCategorySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos' })
    }
    const before = await prisma.category.findUnique({ where: { id } })
    if (!before) return reply.code(404).send({ message: 'Categoria não encontrada' })
    try {
      const category = await prisma.category.update({ where: { id }, data: parsed.data })
      await recordAuditLog({ actorId: request.user.sub, entityType: 'Category', entityId: id, action: 'UPDATE', before, after: category })
      return reply.send({ category: toCategoryDTO(category) })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return reply.code(404).send({ message: 'Categoria não encontrada' })
      }
      throw err
    }
  })
```

Adicionar `recordAuditLog` ao import de `'../services/audit-log-service'` já existente (junto com `listAuditLog`).

- [ ] **Step 4: Instrumentar `updateDevelopmentThursdaySettings` em `apps/api/src/services/development-thursday-service.ts`**

Trocar a função:

```ts
export async function updateDevelopmentThursdaySettings(input: {
  teamsWebhookUrl: string | null
  actorId: string
}): Promise<{ teamsWebhookUrl: string | null }> {
  const value = input.teamsWebhookUrl?.trim() || null
  const before = await prisma.appSetting.findUnique({ where: { key: DEVELOPMENT_THURSDAY_TEAMS_WEBHOOK_KEY } })
  const setting = await prisma.appSetting.upsert({
    where: { key: DEVELOPMENT_THURSDAY_TEAMS_WEBHOOK_KEY },
    create: { key: DEVELOPMENT_THURSDAY_TEAMS_WEBHOOK_KEY, value },
    update: { value },
  })
  await recordAuditLog({
    actorId: input.actorId,
    entityType: 'AppSetting',
    entityId: DEVELOPMENT_THURSDAY_TEAMS_WEBHOOK_KEY,
    action: before ? 'UPDATE' : 'CREATE',
    before,
    after: setting,
  })
  return { teamsWebhookUrl: setting.value ?? null }
}
```

Adicionar o import: `import { recordAuditLog } from './audit-log-service'`.

- [ ] **Step 5: Atualizar o call site em `admin.ts`**

Trocar:

```ts
    const settings = await updateDevelopmentThursdaySettings({
      teamsWebhookUrl: parsed.data.teamsWebhookUrl ?? null,
    })
```

por:

```ts
    const settings = await updateDevelopmentThursdaySettings({
      teamsWebhookUrl: parsed.data.teamsWebhookUrl ?? null,
      actorId: request.user.sub,
    })
```

- [ ] **Step 6: Instrumentar `setBroadcastEnabled` em `apps/api/src/services/office-setting-service.ts`**

```ts
import type { OfficeConfigDTO } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { recordAuditLog } from './audit-log-service'

/**
 * Config global do escritório — linha única (id = 1), criada on-demand.
 * `broadcastEnabled` é o interruptor de custo do alto-falante.
 */
export async function getOfficeSettings(): Promise<OfficeConfigDTO> {
  const row = await prisma.officeSetting.findUnique({ where: { id: 1 } })
  return {
    broadcastEnabled: row?.broadcastEnabled ?? false,
    activeMapPublicationId: row?.activeMapPublicationId ?? null,
  }
}

export async function setBroadcastEnabled(broadcastEnabled: boolean, actorId: string): Promise<OfficeConfigDTO> {
  const before = await prisma.officeSetting.findUnique({ where: { id: 1 } })
  const row = await prisma.officeSetting.upsert({
    where: { id: 1 },
    create: { id: 1, broadcastEnabled },
    update: { broadcastEnabled },
  })
  await recordAuditLog({
    actorId,
    entityType: 'OfficeSetting',
    entityId: '1',
    action: before ? 'UPDATE' : 'CREATE',
    before,
    after: row,
  })
  return {
    broadcastEnabled: row.broadcastEnabled,
    activeMapPublicationId: row.activeMapPublicationId,
  }
}
```

- [ ] **Step 7: Atualizar o call site em `admin.ts`**

Trocar `return setBroadcastEnabled(parsed.data.broadcastEnabled)` por `return setBroadcastEnabled(parsed.data.broadcastEnabled, request.user.sub)`.

- [ ] **Step 8: Rodar e confirmar sucesso (incluindo o teste pendente da Task 3)**

Run: `pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts`
Expected: PASS em TODOS os testes do arquivo, incluindo `GET /admin/audit-log > lista, filtra...` (da Task 3) e os 2 novos desta task.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/src/services/development-thursday-service.ts apps/api/src/services/office-setting-service.ts apps/api/src/routes/admin.test.ts
git commit -m "feat(api): audita categorias, config de quinta-dev e do escritório"
```

---

## Task 5: Instrumentar Squads

**Files:**
- Modify: `apps/api/src/services/squad-service.ts`
- Modify: `apps/api/src/routes/admin.ts` (passa `actorId` para as 4 funções)
- Test: `apps/api/src/services/squad-service.test.ts`

**Interfaces:**
- `createSquad(input, actorId)`, `updateSquad(id, input, actorId)`, `addMember(squadId, userId, actorId)`, `removeMember(squadId, userId, actorId)`.

- [ ] **Step 1: Escrever os testes (falhando)**

Adicionar a `apps/api/src/services/squad-service.test.ts`, dentro do `describe('squad-service', ...)`:

```ts
  it('audita create/update/addMember/removeMember', async () => {
    const admin = await mkUser('ADMIN', 'AuditAdmin')
    const dev = await mkUser('LEGEND', 'AuditDev')

    const s = await createSquad({ name: 'Squad Auditada' }, admin.id)
    await updateSquad(s.id, { name: 'Squad Auditada 2' }, admin.id)
    await addMember(s.id, dev.id, admin.id)
    await removeMember(s.id, dev.id, admin.id)

    const rows = await prisma.adminAuditLog.findMany({ where: { entityType: { in: ['Squad', 'SquadMember'] } }, orderBy: { createdAt: 'asc' } })
    expect(rows.map((r) => [r.entityType, r.action])).toEqual([
      ['Squad', 'CREATE'],
      ['Squad', 'UPDATE'],
      ['SquadMember', 'CREATE'],
      ['SquadMember', 'DELETE'],
    ])
  })
```

Confira se `prisma` já está importado no topo do arquivo (deve estar, pelo `mkUser` já existente).

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm db:up && pnpm --filter @legends/api exec vitest run src/services/squad-service.test.ts -t "audita create"`
Expected: FAIL (assinaturas atuais não têm `actorId`)

- [ ] **Step 3: Instrumentar `apps/api/src/services/squad-service.ts`**

Adicionar o import: `import { recordAuditLog } from './audit-log-service'`.

Trocar `createSquad`:

```ts
export async function createSquad(input: { name: string }, actorId: string): Promise<SquadWithMembers> {
  const name = input.name.trim()
  if (!name) throw new SquadError('O nome da squad é obrigatório.', 400)
  try {
    const squad = await prisma.squad.create({ data: { name, slug: slugify(name) } })
    await recordAuditLog({ actorId, entityType: 'Squad', entityId: squad.id, action: 'CREATE', after: squad })
    return loadSquad(squad.id)
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new SquadError('Já existe uma squad com esse nome.', 409)
    }
    throw err
  }
}
```

Trocar `updateSquad` — adicionar `actorId: string` como 3º parâmetro e capturar `before`:

```ts
export async function updateSquad(
  id: string,
  input: { name?: string; active?: boolean; leaderId?: string | null },
  actorId: string,
): Promise<SquadWithMembers> {
  const before = await prisma.squad.findUnique({ where: { id } })
  if (!before) throw new SquadError('Squad não encontrada.', 404)
  const data: Prisma.SquadUpdateInput = {}
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (!name) throw new SquadError('O nome da squad é obrigatório.', 400)
    data.name = name
    data.slug = slugify(name)
  }
  if (input.active !== undefined) data.active = input.active
  if (input.leaderId !== undefined) {
    if (input.leaderId === null) {
      data.leader = { disconnect: true }
    } else {
      const leader = await prisma.user.findUnique({ where: { id: input.leaderId } })
      if (!leader || !leader.active || leader.leftAt) throw new SquadError('Líder inválido.', 400)
      data.leader = { connect: { id: input.leaderId } }
    }
  }
  try {
    const updated = await prisma.squad.update({ where: { id }, data })
    await recordAuditLog({ actorId, entityType: 'Squad', entityId: id, action: 'UPDATE', before, after: updated })
    return loadSquad(id)
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') throw new SquadError('Squad não encontrada.', 404)
      if (err.code === 'P2002') throw new SquadError('Já existe uma squad com esse nome.', 409)
    }
    throw err
  }
}
```

Trocar `addMember`:

```ts
export async function addMember(squadId: string, userId: string, actorId: string): Promise<SquadWithMembers> {
  await loadSquad(squadId)
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user || !user.active || user.leftAt) throw new SquadError('Integrante inválido.', 400)
  if (user.role === 'ADMIN') throw new SquadError('Administradores não entram em squads.', 400)
  try {
    const member = await prisma.squadMember.create({ data: { squadId, userId } })
    await recordAuditLog({ actorId, entityType: 'SquadMember', entityId: member.id, action: 'CREATE', after: member })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new SquadError('Já é integrante desta squad.', 409)
    }
    throw err
  }
  return loadSquad(squadId)
}
```

Trocar `removeMember`:

```ts
export async function removeMember(squadId: string, userId: string, actorId: string): Promise<void> {
  const before = await prisma.squadMember.findFirst({ where: { squadId, userId } })
  await prisma.squadMember.deleteMany({ where: { squadId, userId } })
  if (before) {
    await recordAuditLog({ actorId, entityType: 'SquadMember', entityId: before.id, action: 'DELETE', before })
  }
}
```

- [ ] **Step 4: Atualizar os 4 call sites em `apps/api/src/routes/admin.ts`**

```ts
      const squad = await createSquad(parsed.data, request.user.sub)
```
```ts
      const squad = await updateSquad(id, parsed.data, request.user.sub)
```
```ts
      const squad = await addMember(id, parsed.data.userId, request.user.sub)
```
```ts
    await removeMember(id, userId, request.user.sub)
```

- [ ] **Step 5: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/api exec vitest run src/services/squad-service.test.ts src/routes/admin.test.ts`
Expected: PASS (todos, incluindo os pré-existentes)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/squad-service.ts apps/api/src/services/squad-service.test.ts apps/api/src/routes/admin.ts
git commit -m "feat(api): audita squads (create/update/addMember/removeMember)"
```

---

## Task 6: Instrumentar Setores

**Files:**
- Modify: `apps/api/src/services/sector-service.ts`
- Modify: `apps/api/src/routes/admin.ts`
- Test: `apps/api/src/services/sector-service.test.ts`

**Interfaces:**
- `createSector(input, actorId)`, `updateSector(id, input, actorId)`.

- [ ] **Step 1: Escrever o teste (falhando)**

Adicionar a `apps/api/src/services/sector-service.test.ts`:

```ts
  it('audita create e update', async () => {
    const admin = await prisma.user.create({ data: { name: 'AuditAdmin', email: 'auditadmin-sector@x.com', passwordHash: 'x', role: 'ADMIN' } })
    const s = await createSector({ name: 'Setor Auditado', enabledFeatures: [], roles: [] }, admin.id)
    await updateSector(s.id, { name: 'Setor Auditado 2' }, admin.id)

    const rows = await prisma.adminAuditLog.findMany({ where: { entityType: 'Sector', entityId: s.id }, orderBy: { createdAt: 'asc' } })
    expect(rows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE'])
  })
```

(Confira o import de `prisma` no topo do arquivo — já deve existir.)

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/api exec vitest run src/services/sector-service.test.ts -t "audita"`
Expected: FAIL

- [ ] **Step 3: Instrumentar `apps/api/src/services/sector-service.ts`**

Adicionar o import: `import { recordAuditLog } from './audit-log-service'`.

Trocar `createSector`:

```ts
export async function createSector(
  input: { name: string; enabledFeatures: string[]; roles: UserRole[] },
  actorId: string,
): Promise<SectorWithRoles> {
  const name = input.name.trim()
  if (!name) throw new SectorError('O nome do setor é obrigatório.', 400)
  try {
    const sector = await prisma.sector.create({
      data: {
        name,
        slug: slugify(name),
        enabledFeatures: withEscritorioForced(input.enabledFeatures),
        roles: { create: input.roles.map((role) => ({ role })) },
      },
    })
    const loaded = await loadSector(sector.id)
    await recordAuditLog({ actorId, entityType: 'Sector', entityId: sector.id, action: 'CREATE', after: loaded })
    return loaded
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new SectorError('Já existe um setor com esse nome.', 409)
    }
    throw err
  }
}
```

Trocar `updateSector` — adicionar `actorId: string` como 3º parâmetro e gravar dentro da mesma `$transaction`:

```ts
export async function updateSector(
  id: string,
  input: { name?: string; active?: boolean; enabledFeatures?: string[]; roles?: UserRole[] },
  actorId: string,
): Promise<SectorWithRoles> {
  const before = await loadSector(id)
  const data: Prisma.SectorUpdateInput = {}
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (!name) throw new SectorError('O nome do setor é obrigatório.', 400)
    data.name = name
    data.slug = slugify(name)
  }
  if (input.active !== undefined) data.active = input.active
  if (input.enabledFeatures !== undefined) data.enabledFeatures = input.enabledFeatures
  try {
    await prisma.$transaction(async (tx) => {
      await tx.sector.update({ where: { id }, data })
      if (input.roles !== undefined) {
        await tx.sectorRole.deleteMany({ where: { sectorId: id } })
        if (input.roles.length > 0) {
          await tx.sectorRole.createMany({ data: input.roles.map((role) => ({ sectorId: id, role })) })
        }
      }
      const after = await tx.sector.findUniqueOrThrow({ where: { id }, include: sectorInclude })
      await recordAuditLog({ actorId, entityType: 'Sector', entityId: id, action: 'UPDATE', before, after, tx })
    })
    return loadSector(id)
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') throw new SectorError('Setor não encontrado.', 404)
      if (err.code === 'P2002') throw new SectorError('Já existe um setor com esse nome.', 409)
    }
    throw err
  }
}
```

**Nota:** `before = await loadSector(id)` lançaria `SectorError` 404 se `id` não existir — isso já cobre o `P2025` de forma antecipada; o `try/catch` continua existindo para o caso de conflito de nome (`P2002`) durante o update em si.

- [ ] **Step 4: Atualizar os 2 call sites em `apps/api/src/routes/admin.ts`**

```ts
      const sector = await createSector(parsed.data, request.user.sub)
```
```ts
      const sector = await updateSector(id, parsed.data, request.user.sub)
```

- [ ] **Step 5: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/api exec vitest run src/services/sector-service.test.ts src/routes/admin.test.ts`
Expected: PASS (todos)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/sector-service.ts apps/api/src/services/sector-service.test.ts apps/api/src/routes/admin.ts
git commit -m "feat(api): audita setores (create/update)"
```

---

## Task 7: Instrumentar Usuários

**Files:**
- Modify: `apps/api/src/routes/admin.ts`
- Test: extensão de `apps/api/src/routes/admin.test.ts`

**Interfaces:**
- Nenhuma função de serviço dedicada existe para `User` — a mutação acontece direto na rota (padrão já existente no arquivo). `recordAuditLog` é chamado direto no handler.

- [ ] **Step 1: Escrever o teste (falhando)**

Adicionar a `apps/api/src/routes/admin.test.ts`:

```ts
it('audita criação e edição de usuário', async () => {
  const app = buildApp()
  await app.ready()
  const token = await adminToken(app)
  const created = await app.inject({
    method: 'POST',
    url: '/admin/users',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'Auditada', email: 'auditada@empresa.com', password: 'changeme123' },
  })
  const id = created.json().user.id
  await app.inject({ method: 'PATCH', url: `/admin/users/${id}`, headers: { authorization: `Bearer ${token}` }, payload: { position: 'PM' } })

  const rows = await prisma.adminAuditLog.findMany({ where: { entityType: 'User', entityId: id }, orderBy: { createdAt: 'asc' } })
  expect(rows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE'])
  expect((rows[0].after as { passwordHash?: string }).passwordHash).toBeUndefined()
  await app.close()
})
```

**Atenção:** o `after`/`before` gravado para `User` NÃO pode incluir `passwordHash` (dado sensível) — o teste já cobra isso.

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts -t "audita criação e edição de usuário"`
Expected: FAIL

- [ ] **Step 3: Instrumentar `POST /admin/users` em `apps/api/src/routes/admin.ts`**

Trocar o bloco `try` do handler:

```ts
    try {
      const passwordHash = await hashPassword(parsed.data.password)
      const user = await prisma.user.create({
        data: {
          name: parsed.data.name,
          email: parsed.data.email,
          passwordHash,
          position: parsed.data.position,
          squad: parsed.data.squad,
          joinedAt: parsed.data.joinedAt,
          role: parsed.data.role,
          area: parsed.data.area,
          teamsWebhookUrl: parsed.data.teamsWebhookUrl || null,
          sectorId,
        },
      })
      const { passwordHash: _omit, ...safeUser } = user
      await recordAuditLog({ actorId: request.user.sub, entityType: 'User', entityId: user.id, action: 'CREATE', after: safeUser })
      return reply.code(201).send({ user: toAdminUser(user) })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.code(409).send({ message: 'E-mail já cadastrado.' })
      }
      throw err
    }
```

- [ ] **Step 4: Instrumentar `PATCH /admin/users/:id`**

`existing` (before) já é lido na rota — precisa só remover `passwordHash` de `before`/`after` antes de gravar. Trocar o bloco `try`:

```ts
    try {
      const user = await prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({ where: { id }, data })
        if (!updated.active || updated.leftAt) {
          await tx.squadMember.deleteMany({ where: { userId: id } })
          await tx.squad.updateMany({ where: { leaderId: id }, data: { leaderId: null } })
        }
        const { passwordHash: _b, ...safeBefore } = existing
        const { passwordHash: _a, ...safeAfter } = updated
        await recordAuditLog({ actorId: request.user.sub, entityType: 'User', entityId: id, action: 'UPDATE', before: safeBefore, after: safeAfter, tx })
        return updated
      })
      return reply.send({ user: toAdminUser(user) })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2025') return reply.code(404).send({ message: 'Usuário não encontrado' })
        if (err.code === 'P2002') return reply.code(409).send({ message: 'E-mail já cadastrado.' })
      }
      throw err
    }
```

- [ ] **Step 5: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts`
Expected: PASS (todos)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/src/routes/admin.test.ts
git commit -m "feat(api): audita criação e edição de usuário (sem senha)"
```

---

## Task 8: Instrumentar Períodos e Destaque do mês

**Files:**
- Modify: `apps/api/src/services/admin-service.ts`
- Modify: `apps/api/src/services/highlight-service.ts`
- Modify: `apps/api/src/routes/admin.ts`
- Test: `apps/api/src/services/admin-service.test.ts`, extensão de `apps/api/src/services/highlight-service.orchestration.test.ts`

**Interfaces:**
- `scheduleVotingPeriod(input, actorId)`, `updateVotingPeriod(id, data, actorId)`, `closeVotingPeriod(id, actorId)`, `generateHighlightDraft(periodId, actorId)`, `updateHighlightText(periodId, text, actorId)`, `publishHighlight(periodId, actorId)`.

- [ ] **Step 1: Escrever os testes de `admin-service.test.ts` (falhando)**

Adicionar ao `describe` existente em `apps/api/src/services/admin-service.test.ts` (confira o padrão de setup do arquivo — `sectorId`/datas — antes de escrever, ele já foi tocado na Task 5 do plano de setorização):

```ts
  it('audita schedule/update/close', async () => {
    const admin = await prisma.user.create({ data: { name: 'AuditAdmin', email: 'auditadmin-period@x.com', passwordHash: 'x', role: 'ADMIN' } })
    const period = await scheduleVotingPeriod({ sectorId: DEFAULT_SECTOR_ID, monthRef: '2027-03', startsAt: new Date(Date.now() + 1000), endsAt: new Date(Date.now() + 100000) }, admin.id)
    await updateVotingPeriod(period.id, { startsAt: new Date(Date.now() + 2000), endsAt: new Date(Date.now() + 200000) }, admin.id)
    await closeVotingPeriod(period.id, admin.id)

    const rows = await prisma.adminAuditLog.findMany({ where: { entityType: 'VotingPeriod', entityId: period.id }, orderBy: { createdAt: 'asc' } })
    expect(rows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE', 'UPDATE'])
  })
```

Adicione o import de `DEFAULT_SECTOR_ID` de `'@legends/shared'` se ainda não existir no arquivo.

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/api exec vitest run src/services/admin-service.test.ts -t "audita schedule"`
Expected: FAIL

- [ ] **Step 3: Reescrever `apps/api/src/services/admin-service.ts`**

```ts
import type { VotingPeriod } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { recordAuditLog } from './audit-log-service'

export { monthRefFor } from '../lib/period-state'

interface ScheduleVotingPeriodInput {
  sectorId: string
  monthRef: string
  startsAt: Date
  endsAt: Date
}

export async function scheduleVotingPeriod(input: ScheduleVotingPeriodInput, actorId: string): Promise<VotingPeriod> {
  const period = await prisma.votingPeriod.create({
    data: { sectorId: input.sectorId, monthRef: input.monthRef, startsAt: input.startsAt, endsAt: input.endsAt, status: 'OPEN' },
  })
  await recordAuditLog({ actorId, entityType: 'VotingPeriod', entityId: period.id, action: 'CREATE', after: period })
  return period
}

export async function updateVotingPeriod(
  id: string,
  data: { startsAt: Date; endsAt: Date },
  actorId: string,
): Promise<VotingPeriod> {
  const before = await prisma.votingPeriod.findUniqueOrThrow({ where: { id } })
  const updated = await prisma.votingPeriod.update({ where: { id }, data: { ...data, status: 'OPEN' } })
  await recordAuditLog({ actorId, entityType: 'VotingPeriod', entityId: id, action: 'UPDATE', before, after: updated })
  return updated
}

export async function closeVotingPeriod(id: string, actorId: string): Promise<VotingPeriod> {
  const before = await prisma.votingPeriod.findUniqueOrThrow({ where: { id } })
  const updated = await prisma.votingPeriod.update({ where: { id }, data: { status: 'CLOSED' } })
  await recordAuditLog({ actorId, entityType: 'VotingPeriod', entityId: id, action: 'UPDATE', before, after: updated })
  return updated
}
```

**Nota:** `updateVotingPeriod`/`closeVotingPeriod` agora usam `findUniqueOrThrow` — a rota `PATCH /admin/periods/:id` já valida `existing` antes de chamar (então nunca deveria lançar aqui), mas `POST /admin/periods/:id/close` NÃO tinha essa checagem prévia — o catch de `P2025` na rota (linha 431-433 do arquivo atual) continua cobrindo isso, já que `findUniqueOrThrow` lança `PrismaClientKnownRequestError` com `code: 'P2025'` igual a um `update` que falha.

- [ ] **Step 4: Atualizar os 3 call sites em `apps/api/src/routes/admin.ts`**

```ts
      const period = await scheduleVotingPeriod({ sectorId, monthRef, startsAt, endsAt }, request.user.sub)
```
```ts
    const period = await updateVotingPeriod(id, { startsAt, endsAt }, request.user.sub)
```
```ts
      const period = await closeVotingPeriod(id, request.user.sub)
```

- [ ] **Step 5: Rodar e confirmar sucesso de `admin-service.test.ts`**

Run: `pnpm --filter @legends/api exec vitest run src/services/admin-service.test.ts`
Expected: PASS (todos, incluindo os pré-existentes)

- [ ] **Step 6: Escrever o teste de `highlight-service.orchestration.test.ts` (falhando)**

Adicionar ao arquivo, dentro do `describe('publishHighlight', ...)` (ou um novo `describe`):

```ts
  it('audita generateHighlightDraft/updateHighlightText/publishHighlight', async () => {
    const { period } = await seed()
    const admin = await prisma.user.create({ data: { name: 'AuditAdmin', email: 'auditadmin-hl@empresa.com', passwordHash: 'x', role: 'ADMIN' } })
    await generateHighlightDraft(period.id, admin.id)
    await updateHighlightText(period.id, 'Texto editado', admin.id)
    await publishHighlight(period.id, admin.id)

    const rows = await prisma.adminAuditLog.findMany({ where: { entityType: 'VotingPeriod', entityId: period.id }, orderBy: { createdAt: 'asc' } })
    expect(rows.map((r) => r.action)).toEqual(['UPDATE', 'UPDATE', 'UPDATE'])
  })
```

- [ ] **Step 7: Rodar e confirmar falha**

Run: `pnpm --filter @legends/api exec vitest run src/services/highlight-service.orchestration.test.ts -t "audita generateHighlightDraft"`
Expected: FAIL

- [ ] **Step 8: Instrumentar `apps/api/src/services/highlight-service.ts`**

Adicionar o import: `import { recordAuditLog } from './audit-log-service'`.

Trocar a assinatura e o fim de `generateHighlightDraft`:

```ts
export async function generateHighlightDraft(periodId: string, actorId: string): Promise<VotingPeriod> {
  const before = await prisma.votingPeriod.findUnique({ where: { id: periodId } })
  if (!before) throw new HighlightError('Período não encontrado.', 404)
  if (before.highlightStatus !== 'NONE') {
    throw new HighlightError('O destaque deste período já foi gerado.', 409)
  }

  const election = await electWinner(periodId)
  if (!election) throw new HighlightError('Não há votos neste período para apurar o destaque.', 422)

  const winner = await prisma.user.findUniqueOrThrow({ where: { id: election.winnerId } })

  const votes = await prisma.vote.findMany({
    where: { periodId, votedId: winner.id },
    select: { justification: true },
    orderBy: { createdAt: 'asc' },
  })
  const justifications = votes.map((v) => v.justification)

  const text = await buildCongratsText({
    winnerName: winner.name,
    monthLabel: monthLabel(before.monthRef),
    justifications,
  })

  const png = await renderCard({
    name: winner.name,
    monthName: monthName(before.monthRef),
    position: winner.position,
    text,
    photoDataUri: photoDataUriFor(winner.email),
    initials: initialsOf(winner.name),
  })
  const imagePath = await saveCardPng(before.monthRef, png)

  const after = await prisma.votingPeriod.update({
    where: { id: periodId },
    data: {
      winnerId: winner.id,
      winnerVotes: election.winnerVotes,
      highlightText: text,
      highlightImagePath: imagePath,
      highlightStatus: 'DRAFT',
    },
  })
  await recordAuditLog({ actorId, entityType: 'VotingPeriod', entityId: periodId, action: 'UPDATE', before, after })
  return after
}
```

Trocar `updateHighlightText`:

```ts
export async function updateHighlightText(periodId: string, text: string, actorId: string): Promise<VotingPeriod> {
  const before = await prisma.votingPeriod.findUnique({ where: { id: periodId } })
  if (!before) throw new HighlightError('Período não encontrado.', 404)
  if (before.highlightStatus !== 'DRAFT') {
    throw new HighlightError('Só é possível editar um destaque em rascunho.', 409)
  }
  const winner = await prisma.user.findUniqueOrThrow({ where: { id: before.winnerId! } })

  const png = await renderCard({
    name: winner.name,
    monthName: monthName(before.monthRef),
    position: winner.position,
    text,
    photoDataUri: photoDataUriFor(winner.email),
    initials: initialsOf(winner.name),
  })
  const imagePath = await saveCardPng(before.monthRef, png)

  const after = await prisma.votingPeriod.update({
    where: { id: periodId },
    data: { highlightText: text, highlightImagePath: imagePath },
  })
  await recordAuditLog({ actorId, entityType: 'VotingPeriod', entityId: periodId, action: 'UPDATE', before, after })
  return after
}
```

Trocar `publishHighlight` — converter o `$transaction` de array-form para callback-form para gravar o audit log atomicamente junto:

```ts
export async function publishHighlight(periodId: string, actorId: string): Promise<VotingPeriod> {
  const before = await prisma.votingPeriod.findUnique({ where: { id: periodId } })
  if (!before) throw new HighlightError('Período não encontrado.', 404)
  if (before.highlightStatus !== 'DRAFT') {
    throw new HighlightError('Só é possível publicar um destaque em rascunho.', 409)
  }
  const badge = await prisma.badge.findUnique({ where: { slug: 'destaque-do-mes' } })
  if (!badge) throw new HighlightError('Selo "destaque-do-mes" não encontrado (rode o seed).', 500)

  const updated = await prisma.$transaction(async (tx) => {
    const period = await tx.votingPeriod.update({ where: { id: periodId }, data: { highlightStatus: 'PUBLISHED' } })
    await tx.userBadge.upsert({
      where: { userId_badgeId_periodId: { userId: before.winnerId!, badgeId: badge.id, periodId } },
      create: { userId: before.winnerId!, badgeId: badge.id, periodId },
      update: {},
    })
    await recordAuditLog({ actorId, entityType: 'VotingPeriod', entityId: periodId, action: 'UPDATE', before, after: period, tx })
    return period
  })
  return updated
}
```

- [ ] **Step 9: Atualizar os 3 call sites em `apps/api/src/routes/admin.ts`**

```ts
      const period = await generateHighlightDraft(id, request.user.sub)
```
```ts
      const period = await updateHighlightText(id, parsed.data.text, request.user.sub)
```
```ts
      const period = await publishHighlight(id, request.user.sub)
```

- [ ] **Step 10: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/api exec vitest run src/services/highlight-service.orchestration.test.ts src/services/highlight-service.test.ts src/routes/admin.test.ts`
Expected: PASS (todos)

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/services/admin-service.ts apps/api/src/services/admin-service.test.ts apps/api/src/services/highlight-service.ts apps/api/src/services/highlight-service.orchestration.test.ts apps/api/src/routes/admin.ts
git commit -m "feat(api): audita períodos (schedule/update/close) e destaque do mês"
```

---

## Task 9: Instrumentar Voto, Selos e Concessão manual de selo

**Files:**
- Modify: `apps/api/src/routes/admin.ts` (voto, selos)
- Modify: `apps/api/src/services/badge-service.ts` (`grantBadgeManually`, `revokeManualBadge`)
- Test: extensão de `apps/api/src/routes/admin.test.ts`

- [ ] **Step 1: Escrever os testes (falhando)**

Adicionar a `apps/api/src/routes/admin.test.ts`:

```ts
describe('auditoria — votos e selos', () => {
  it('audita exclusão de voto', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const voter = await prisma.user.create({ data: { name: 'Votante Audit', email: 'votanteaudit@empresa.com', passwordHash: 'x' } })
    const voted = await prisma.user.create({ data: { name: 'Votada Audit', email: 'votadaaudit@empresa.com', passwordHash: 'x' } })
    const cat = await prisma.category.create({ data: { name: 'Colaboração Audit', slug: 'colaboracao-audit' } })
    const period = await prisma.votingPeriod.create({ data: { monthRef: '2027-04', startsAt: new Date('2027-04-01'), endsAt: new Date('2027-04-30'), status: 'OPEN' } })
    const vote = await prisma.vote.create({ data: { voterId: voter.id, votedId: voted.id, periodId: period.id, justification: 'justificativa válida', categories: { create: [{ categoryId: cat.id }] } } })

    await app.inject({ method: 'DELETE', url: `/admin/votes/${vote.id}`, headers: { authorization: `Bearer ${token}` } })

    const row = await prisma.adminAuditLog.findFirstOrThrow({ where: { entityType: 'Vote', entityId: vote.id } })
    expect(row.action).toBe('DELETE')
    await app.close()
  })

  it('audita create/update/delete de selo e concessão/revogação manual', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const created = await app.inject({ method: 'POST', url: '/admin/badges', headers: { authorization: `Bearer ${token}` }, payload: { name: 'Selo Audit', description: 'd', kind: 'IMPACT', iconKey: 'star' } })
    const badgeId = created.json().badge.id
    await app.inject({ method: 'PATCH', url: `/admin/badges/${badgeId}`, headers: { authorization: `Bearer ${token}` }, payload: { description: 'd2' } })

    const target = await prisma.user.create({ data: { name: 'Alvo Selo', email: 'alvoselo@empresa.com', passwordHash: 'x' } })
    const granted = await app.inject({ method: 'POST', url: `/admin/users/${target.id}/badges`, headers: { authorization: `Bearer ${token}` }, payload: { badgeId } })
    const userBadgeId = granted.json().badge.id
    await app.inject({ method: 'DELETE', url: `/admin/users/${target.id}/badges/${userBadgeId}`, headers: { authorization: `Bearer ${token}` } })
    await app.inject({ method: 'DELETE', url: `/admin/badges/${badgeId}`, headers: { authorization: `Bearer ${token}` } })

    const badgeRows = await prisma.adminAuditLog.findMany({ where: { entityType: 'Badge', entityId: badgeId }, orderBy: { createdAt: 'asc' } })
    expect(badgeRows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE', 'DELETE'])
    const userBadgeRows = await prisma.adminAuditLog.findMany({ where: { entityType: 'UserBadge', entityId: userBadgeId }, orderBy: { createdAt: 'asc' } })
    expect(userBadgeRows.map((r) => r.action)).toEqual(['CREATE', 'DELETE'])
    await app.close()
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts -t "auditoria — votos e selos"`
Expected: FAIL

- [ ] **Step 3: Instrumentar voto e selos direto em `apps/api/src/routes/admin.ts`**

Trocar `DELETE /admin/votes/:id`:

```ts
  app.delete('/admin/votes/:id', adminOnly, async (request, reply) => {
    const { id } = request.params as { id: string }
    const before = await prisma.vote.findUnique({ where: { id } })
    if (!before) return reply.code(404).send({ message: 'Voto não encontrado' })
    try {
      await prisma.vote.delete({ where: { id } })
      await recordAuditLog({ actorId: request.user.sub, entityType: 'Vote', entityId: id, action: 'DELETE', before })
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return reply.code(404).send({ message: 'Voto não encontrado' })
      }
      throw err
    }
  })
```

Trocar `POST /admin/badges`:

```ts
  app.post('/admin/badges', adminOnly, async (request, reply) => {
    const parsed = createBadgeSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.flatten() })
    }
    try {
      const badge = await prisma.badge.create({
        data: {
          name: parsed.data.name,
          slug: slugify(parsed.data.name),
          description: parsed.data.description,
          kind: parsed.data.kind,
          iconKey: parsed.data.iconKey,
          threshold: parsed.data.threshold ?? 0,
          categorySlug: parsed.data.categorySlug ?? null,
        },
      })
      await recordAuditLog({ actorId: request.user.sub, entityType: 'Badge', entityId: badge.id, action: 'CREATE', after: badge })
      return reply.code(201).send({ badge: toBadgeDTO(badge) })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.code(409).send({ message: 'Já existe um selo com esse nome.' })
      }
      throw err
    }
  })
```

Trocar `PATCH /admin/badges/:id`:

```ts
  app.patch('/admin/badges/:id', adminOnly, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = updateBadgeSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos' })
    }
    const before = await prisma.badge.findUnique({ where: { id } })
    if (!before) return reply.code(404).send({ message: 'Selo não encontrado' })
    const data = parsed.data.name ? { ...parsed.data, slug: slugify(parsed.data.name) } : parsed.data
    try {
      const badge = await prisma.badge.update({ where: { id }, data })
      await recordAuditLog({ actorId: request.user.sub, entityType: 'Badge', entityId: id, action: 'UPDATE', before, after: badge })
      return reply.send({ badge: toBadgeDTO(badge) })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2025') return reply.code(404).send({ message: 'Selo não encontrado' })
        if (err.code === 'P2002') return reply.code(409).send({ message: 'Já existe um selo com esse nome.' })
      }
      throw err
    }
  })
```

Trocar `DELETE /admin/badges/:id` — converter o `$transaction` de array-form para callback-form:

```ts
  app.delete('/admin/badges/:id', adminOnly, async (request, reply) => {
    const { id } = request.params as { id: string }
    const before = await prisma.badge.findUnique({ where: { id } })
    if (!before) return reply.code(404).send({ message: 'Selo não encontrado' })
    try {
      await prisma.$transaction(async (tx) => {
        await tx.userBadge.deleteMany({ where: { badgeId: id } })
        await tx.badge.delete({ where: { id } })
        await recordAuditLog({ actorId: request.user.sub, entityType: 'Badge', entityId: id, action: 'DELETE', before, tx })
      })
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return reply.code(404).send({ message: 'Selo não encontrado' })
      }
      throw err
    }
  })
```

- [ ] **Step 4: Instrumentar `apps/api/src/services/badge-service.ts`**

Adicionar o import: `import { recordAuditLog } from './audit-log-service'`.

Trocar `grantBadgeManually`:

```ts
export async function grantBadgeManually(userId: string, badgeId: string, awardedById: string) {
  const awarded = await prisma.userBadge.create({
    data: { userId, badgeId, source: 'MANUAL', awardedById, periodId: null },
    include: { badge: true, awardedBy: true },
  })
  await recordAuditLog({ actorId: awardedById, entityType: 'UserBadge', entityId: awarded.id, action: 'CREATE', after: awarded })
  return awarded
}
```

Trocar `revokeManualBadge` — adicionar `actorId: string` como 3º parâmetro:

```ts
export async function revokeManualBadge(userId: string, userBadgeId: string, actorId: string): Promise<void> {
  const award = await prisma.userBadge.findUnique({ where: { id: userBadgeId } })
  if (!award || award.userId !== userId) {
    throw new BadgeError('Concessão não encontrada.', 404)
  }
  if (award.source !== 'MANUAL') {
    throw new BadgeError('Selos automáticos não podem ser revogados manualmente.', 409)
  }
  await prisma.userBadge.delete({ where: { id: userBadgeId } })
  await recordAuditLog({ actorId, entityType: 'UserBadge', entityId: userBadgeId, action: 'DELETE', before: award })
}
```

- [ ] **Step 5: Atualizar o call site de `revokeManualBadge` em `admin.ts`**

Trocar `await revokeManualBadge(userId, userBadgeId)` por `await revokeManualBadge(userId, userBadgeId, request.user.sub)`. (`grantBadgeManually` já recebe `request.user.sub` como `awardedById` — nenhuma mudança de call site necessária ali.)

- [ ] **Step 6: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts src/services/badge-service.test.ts`
Expected: PASS (todos)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/src/services/badge-service.ts
git commit -m "feat(api): audita voto, selos e concessão manual de selo"
```

---

## Task 10: Instrumentar Retro (admin)

**Files:**
- Modify: `apps/api/src/services/retro-service.ts` (`updateRoomAsAdmin`, `hardDeleteRoom`, `archiveRoom`)
- Modify: `apps/api/src/routes/admin.ts`, `apps/api/src/routes/retro.ts`
- Test: extensão de `apps/api/src/routes/admin.test.ts` e `apps/api/src/routes/retro.test.ts`

- [ ] **Step 1: Escrever os testes (falhando)**

Adicionar a `apps/api/src/routes/retro.test.ts`, dentro de um `describe('DELETE /retro/rooms/:id (admin)', ...)` novo (crie o describe se o arquivo não tiver um específico para essa rota — não dependa de nenhum helper que não esteja mostrado aqui):

```ts
it('audita arquivamento de sala pelo admin (soft delete)', async () => {
  const app = buildApp()
  await app.ready()
  const adminRes = await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Admin Retro', email: 'admin-retro-audit@empresa.com', password: 'changeme123' } })
  await prisma.user.update({ where: { email: 'admin-retro-audit@empresa.com' }, data: { role: 'ADMIN' } })
  const adminLogin = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'admin-retro-audit@empresa.com', password: 'changeme123' } })
  const adminToken = adminLogin.json().accessToken as string

  const creator = await prisma.user.create({ data: { name: 'Criador Retro', email: 'criador-retro-audit@empresa.com', passwordHash: 'x', role: 'LEAD' } })
  const squad = await prisma.squad.create({ data: { name: 'Squad Retro Audit Soft', slug: 'squad-retro-audit-soft' } })
  const room = await prisma.retroRoom.create({
    data: { sprint: 1, votesPerParticipant: 3, createdById: creator.id, squads: { create: [{ squadId: squad.id }] } },
  })

  await app.inject({ method: 'DELETE', url: `/retro/rooms/${room.id}`, headers: { authorization: `Bearer ${adminToken}` } })

  const row = await prisma.adminAuditLog.findFirstOrThrow({ where: { entityType: 'RetroRoom', entityId: room.id } })
  expect(row.action).toBe('DELETE')
  await app.close()
})
```

Confira se `buildApp`/`prisma` já estão importados no topo de `retro.test.ts` (devem estar, é um arquivo de teste de rota já existente) — não duplique imports.

Adicionar a `apps/api/src/routes/admin.test.ts`:

```ts
it('audita edição e exclusão definitiva de sala de retro pelo admin', async () => {
  const app = buildApp()
  await app.ready()
  const token = await adminToken(app)
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@empresa.com' } })
  const squad = await createSquad({ name: 'Squad Retro Audit' }, admin.id)
  const room = await prisma.retroRoom.create({
    data: { sprint: 1, votesPerParticipant: 3, createdById: admin.id, squads: { create: [{ squadId: squad.id }] } },
  })

  await app.inject({ method: 'PATCH', url: `/admin/retro/rooms/${room.id}`, headers: { authorization: `Bearer ${token}` }, payload: { votesPerParticipant: 5 } })
  await app.inject({ method: 'DELETE', url: `/admin/retro/rooms/${room.id}`, headers: { authorization: `Bearer ${token}` } })

  const rows = await prisma.adminAuditLog.findMany({ where: { entityType: 'RetroRoom', entityId: room.id }, orderBy: { createdAt: 'asc' } })
  expect(rows.map((r) => r.action)).toEqual(['UPDATE', 'DELETE'])
  await app.close()
})
```

`adminToken(app)` (helper já existente em `admin.test.ts`) sempre registra a conta com e-mail `admin@empresa.com` — reaproveite-a via `findUniqueOrThrow` em vez de criar outro admin. Adicione `import { createSquad } from '../services/squad-service'` ao topo de `admin.test.ts` se ainda não existir.

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts -t "audita edição e exclusão definitiva de sala"`
Expected: FAIL

- [ ] **Step 3: Instrumentar `apps/api/src/services/retro-service.ts`**

Adicionar o import: `import { recordAuditLog } from './audit-log-service'`.

Trocar `updateRoomAsAdmin` — adicionar `actorId: string` ao input:

```ts
export async function updateRoomAsAdmin(input: {
  roomId: string
  actorId: string
  sprint?: number
  squadIds?: string[]
  votesPerParticipant?: number
}): Promise<RetroRoomWithRelations> {
  const before = await loadRoom(input.roomId) // 404 se não existir / arquivada

  const data: Prisma.RetroRoomUpdateInput = {}
  if (input.sprint !== undefined) {
    assertSprint(input.sprint)
    data.sprint = input.sprint
  }
  if (input.votesPerParticipant !== undefined) {
    assertVotes(input.votesPerParticipant)
    data.votesPerParticipant = input.votesPerParticipant
  }

  let squadIds: string[] | null = null
  if (input.squadIds !== undefined) {
    squadIds = [...new Set(input.squadIds)]
    if (squadIds.length === 0) throw new RetroError('Selecione ao menos uma squad.', 400)
    const squads = await prisma.squad.findMany({ where: { id: { in: squadIds } } })
    if (squads.length !== squadIds.length || squads.some((s) => !s.active)) {
      throw new RetroError('Squad inválida.', 400)
    }
  }

  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx.retroRoom.update({ where: { id: input.roomId }, data })
    }
    if (squadIds) {
      await tx.retroRoomSquad.deleteMany({ where: { roomId: input.roomId } })
      await tx.retroRoomSquad.createMany({ data: squadIds.map((squadId) => ({ roomId: input.roomId, squadId })) })
    }
  })

  const after = await loadRoom(input.roomId)
  await recordAuditLog({ actorId: input.actorId, entityType: 'RetroRoom', entityId: input.roomId, action: 'UPDATE', before, after })
  return after
}
```

Trocar `hardDeleteRoom`:

```ts
export async function hardDeleteRoom(input: { roomId: string; actorId: string }): Promise<void> {
  const before = await loadRoom(input.roomId) // 404 se não existir / arquivada
  await prisma.retroRoom.delete({ where: { id: input.roomId } })
  await recordAuditLog({ actorId: input.actorId, entityType: 'RetroRoom', entityId: input.roomId, action: 'DELETE', before })
}
```

Trocar `archiveRoom`:

```ts
export async function archiveRoom(input: { roomId: string; userId: string }): Promise<void> {
  const before = await loadRoom(input.roomId)
  await prisma.retroRoom.update({
    where: { id: input.roomId },
    data: { archivedAt: new Date(), archivedById: input.userId },
  })
  await recordAuditLog({ actorId: input.userId, entityType: 'RetroRoom', entityId: input.roomId, action: 'DELETE', before })
}
```

- [ ] **Step 4: Atualizar os call sites**

Em `apps/api/src/routes/admin.ts`:

```ts
      const room = await updateRoomAsAdmin({ roomId: id, actorId: request.user.sub, ...parsed.data })
```
```ts
      await hardDeleteRoom({ roomId: id, actorId: request.user.sub })
```

Em `apps/api/src/routes/retro.ts`, o call site de `archiveRoom` já passa `userId: request.user.sub` — nenhuma mudança de call site necessária lá.

- [ ] **Step 5: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts src/routes/retro.test.ts src/services/retro-service.test.ts`
Expected: PASS (todos).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/retro-service.ts apps/api/src/routes/admin.ts apps/api/src/routes/retro.ts apps/api/src/routes/admin.test.ts
git commit -m "feat(api): audita salas de retrospectiva geridas pelo admin"
```

---

## Task 11: Instrumentar Office Maps

**Files:**
- Modify: `apps/api/src/services/office-map-service.ts`
- Modify: `apps/api/src/routes/office-maps.ts`
- Test: `apps/api/src/services/office-map-service.test.ts`, extensão de `apps/api/src/services/office-map-service.merge.test.ts` se necessário

**Interfaces:**
- `createOfficeMap(input, userId)` — já recebe `userId`, sem mudança de assinatura.
- `renameOfficeMap(mapId, name, actorId)`, `deleteOfficeMap(mapId, actorId)`, `uploadOfficeMapAsset(mapId, userId, file)` — já recebe `userId`, sem mudança.
- `deleteOfficeMapAsset(mapId, assetId, actorId)`, `publishOfficeMap(mapId, revision, userId, activate, options)` — já recebe `userId`, sem mudança de assinatura (o audit log é gravado dentro de `materializePublication`, que já recebe `userId`).
- `activateOfficeMapPublication(publicationId, actorId)`, `updateOfficeRoom(roomId, input, actorId)`, `adminReleaseOfficeDesk(deskId, actorId)`.

- [ ] **Step 1: Escrever os testes (falhando)**

Adicionar a `apps/api/src/services/office-map-service.test.ts` (confira o padrão de setup do arquivo — provavelmente já tem um helper de criar mapa/usuário — antes de escrever):

```ts
  it('audita create/rename/delete de mapa', async () => {
    const admin = await mkUser('ADMIN', 'AuditMapAdmin') // reaproveite o helper local existente
    const map = await createOfficeMap({ name: 'Mapa Audit', width: 10, height: 10, tileSize: 32 }, admin.id)
    await renameOfficeMap(map.id, 'Mapa Audit 2', admin.id)
    await deleteOfficeMap(map.id, admin.id)

    const rows = await prisma.adminAuditLog.findMany({ where: { entityType: 'OfficeMap', entityId: map.id }, orderBy: { createdAt: 'asc' } })
    expect(rows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE', 'DELETE'])
  })
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/api exec vitest run src/services/office-map-service.test.ts -t "audita create/rename/delete"`
Expected: FAIL

- [ ] **Step 3: Instrumentar `apps/api/src/services/office-map-service.ts`**

Adicionar o import: `import { recordAuditLog } from './audit-log-service'`.

Trocar `createOfficeMap` (só adicionar a chamada, assinatura não muda):

```ts
export async function createOfficeMap(
  input: { name: string; width: number; height: number; tileSize: MapTileSize },
  userId: string,
): Promise<OfficeMapSummaryDTO> {
  const document = createEmptyMapDocumentV1({
    width: input.width,
    height: input.height,
    tileSize: input.tileSize,
  })
  const map = await prisma.officeMap.create({
    data: {
      name: input.name.trim(),
      draft: {
        create: {
          document: document as unknown as Prisma.InputJsonValue,
          lastEditedById: userId,
        },
      },
    },
  })
  await recordAuditLog({ actorId: userId, entityType: 'OfficeMap', entityId: map.id, action: 'CREATE', after: map })
  return {
    id: map.id,
    name: map.name,
    createdAt: map.createdAt.toISOString(),
    updatedAt: map.updatedAt.toISOString(),
    publications: [],
  }
}
```

Trocar `renameOfficeMap` — adicionar `actorId: string`:

```ts
export async function renameOfficeMap(mapId: string, name: string, actorId: string) {
  const before = await requireMap(mapId)
  const map = await prisma.officeMap.update({ where: { id: mapId }, data: { name: name.trim() } })
  await recordAuditLog({ actorId, entityType: 'OfficeMap', entityId: mapId, action: 'UPDATE', before, after: map })
  return { ...map, createdAt: map.createdAt.toISOString(), updatedAt: map.updatedAt.toISOString() }
}
```

Trocar `deleteOfficeMap` — adicionar `actorId: string`:

```ts
export async function deleteOfficeMap(mapId: string, actorId: string): Promise<void> {
  const before = await requireMap(mapId)
  const active = await prisma.officeSetting.findFirst({
    where: { activeMapPublication: { mapId } },
    select: { id: true },
  })
  if (active) fail('Ative outro mapa antes de excluir este', 409, 'MAP_IS_ACTIVE')
  const assets = await prisma.officeMapAsset.findMany({ where: { mapId }, select: { storageKey: true } })
  await prisma.$transaction(async (tx) => {
    await tx.officeMapPublicationAsset.deleteMany({ where: { publication: { mapId } } })
    await tx.officeMap.delete({ where: { id: mapId } })
    await recordAuditLog({ actorId, entityType: 'OfficeMap', entityId: mapId, action: 'DELETE', before, tx })
  })
  await Promise.allSettled(
    assets.filter(({ storageKey }) => !storageKey.startsWith('builtin:')).map(({ storageKey }) => deleteS3Object(storageKey)),
  )
}
```

Trocar `uploadOfficeMapAsset` (só adicionar a chamada, assinatura já recebe `userId`):

Na função existente, logo após `const asset = await prisma.officeMapAsset.create({...})` (dentro do `try`), adicionar antes do `return asAsset(asset)`:

```ts
    await recordAuditLog({ actorId: userId, entityType: 'OfficeMapAsset', entityId: asset.id, action: 'CREATE', after: asset })
```

Trocar `deleteOfficeMapAsset` — adicionar `actorId: string`:

```ts
export async function deleteOfficeMapAsset(mapId: string, assetId: string, actorId: string) {
  const asset = await prisma.officeMapAsset.findFirst({
    where: { id: assetId, mapId },
    include: { _count: { select: { publicationLinks: true } } },
  })
  if (!asset) fail('Asset não encontrado', 404, 'ASSET_NOT_FOUND')
  if (asset._count.publicationLinks > 0) fail('Assets publicados não podem ser excluídos', 409, 'ASSET_IS_PUBLISHED')
  await prisma.officeMapAsset.delete({ where: { id: assetId } })
  await recordAuditLog({ actorId, entityType: 'OfficeMapAsset', entityId: assetId, action: 'DELETE', before: asset })
  if (!asset.storageKey.startsWith('builtin:')) await deleteS3Object(asset.storageKey).catch(() => undefined)
}
```

Dentro de `materializePublication` (já recebe `userId`), logo após `const publication = await tx.officeMapPublication.create({...})`, adicionar:

```ts
  await recordAuditLog({ actorId: userId, entityType: 'OfficeMapPublication', entityId: publication.id, action: 'CREATE', after: publication, tx })
```

Trocar `activateOfficeMapPublication` — adicionar `actorId: string`:

```ts
export async function activateOfficeMapPublication(publicationId: string, actorId: string) {
  const publication = await prisma.officeMapPublication.findUnique({ where: { id: publicationId }, select: { id: true, mapId: true } })
  if (!publication) fail('Publicação não encontrada', 404, 'PUBLICATION_NOT_FOUND')
  await prisma.officeSetting.upsert({
    where: { id: 1 },
    create: { id: 1, activeMapPublicationId: publication.id },
    update: { activeMapPublicationId: publication.id },
  })
  await recordAuditLog({ actorId, entityType: 'OfficeMapPublication', entityId: publication.id, action: 'UPDATE', after: { activated: true } })
  officeHub.configure(await getActiveOfficeMap(), true)
  return { activeMapPublicationId: publication.id, mapId: publication.mapId }
}
```

Trocar `updateOfficeRoom` — adicionar `actorId: string`:

```ts
export async function updateOfficeRoom(
  roomId: string,
  input: {
    status?: 'OPEN' | 'LOCKED'
    capacity?: number | null
    voiceEnabled?: boolean
    accessPolicy?: 'OPEN' | 'ALLOWLIST'
    allowedUserIds?: string[]
  },
  actorId: string,
) {
  const activeId = await activePublicationId()
  const room = await prisma.officeRoom.findFirst({ where: { id: roomId, mapPublicationId: activeId ?? '__none__' } })
  if (!room) fail('Sala ativa não encontrada', 404, 'ROOM_NOT_FOUND')
  const { allowedUserIds, ...data } = input
  if (allowedUserIds) {
    const count = await prisma.user.count({ where: { id: { in: allowedUserIds }, active: true } })
    if (count !== new Set(allowedUserIds).size) fail('A lista contém usuários inválidos', 400, 'ROOM_USERS_INVALID')
  }
  await prisma.$transaction(async (tx) => {
    await tx.officeRoom.update({ where: { id: roomId }, data })
    if (allowedUserIds) {
      await tx.officeRoomAccessGrant.deleteMany({ where: { roomId } })
      if (allowedUserIds.length) {
        await tx.officeRoomAccessGrant.createMany({
          data: [...new Set(allowedUserIds)].map((userId) => ({ roomId, userId })),
        })
      }
    }
    await recordAuditLog({ actorId, entityType: 'OfficeRoom', entityId: roomId, action: 'UPDATE', before: room, after: data, tx })
  })
  const updated = await prisma.officeRoom.findUniqueOrThrow({
    where: { id: roomId },
    include: { accessGrants: { include: { user: { select: { id: true, name: true } } } } },
  })
  officeHub.configure(await getActiveOfficeMap(), false)
  return asRoom(updated)
}
```

Trocar `adminReleaseOfficeDesk` — adicionar `actorId: string`:

```ts
export async function adminReleaseOfficeDesk(deskId: string, actorId: string): Promise<OfficeDeskDTO> {
  const activeId = await activePublicationId()
  const desk = await prisma.officeDesk.findFirst({
    where: { id: deskId, mapPublicationId: activeId ?? '__none__' },
    include: { claim: true },
  })
  if (!desk) fail('Mesa ativa não encontrada', 404, 'DESK_NOT_FOUND')
  if (!desk.claim) fail('Esta mesa não está ocupada', 409, 'DESK_NOT_CLAIMED')
  await prisma.officeDeskClaim.delete({ where: { deskId } })
  await recordAuditLog({ actorId, entityType: 'OfficeDeskClaim', entityId: desk.id, action: 'DELETE', before: desk.claim })
  return asDesk({ ...desk, claim: null })
}
```

- [ ] **Step 4: Atualizar os call sites em `apps/api/src/routes/office-maps.ts`**

```ts
    return { map: await renameOfficeMap(params.data.id, body.data.name, request.user.sub) }
```
```ts
    await deleteOfficeMap(parsed.data.id, request.user.sub)
```
```ts
    await deleteOfficeMapAsset(parsed.data.id, parsed.data.assetId, request.user.sub)
```
```ts
    return activateOfficeMapPublication(parsed.data.publicationId, request.user.sub)
```
```ts
    return { room: await updateOfficeRoom(params.data.id, body.data, request.user.sub) }
```
```ts
    const desk = await adminReleaseOfficeDesk(params.data.id, request.user.sub)
```

- [ ] **Step 5: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/api exec vitest run src/services/office-map-service.test.ts src/services/office-map-service.merge.test.ts`
Expected: PASS (todos, incluindo os pré-existentes — a suíte de office-map-service é sensível, rode com atenção a qualquer regressão em publicação/merge)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/office-map-service.ts apps/api/src/routes/office-maps.ts apps/api/src/services/office-map-service.test.ts
git commit -m "feat(api): audita mapas do escritório (create/rename/delete/asset/publicação/sala/mesa)"
```

---

## Task 12: Instrumentar Convite de convidado e Convite de terceirizado

**Files:**
- Modify: `apps/api/src/services/office-guest-service.ts`
- Modify: `apps/api/src/services/third-party-invite-service.ts`
- Test: `apps/api/src/services/office-guest-service.test.ts` (se existir; senão criar), extensão de `apps/api/src/services/third-party-invite-service.test.ts`

**Interfaces:**
- `createOfficeGuestInvite(createdById, expiresInMinutes)` — já recebe `createdById`, sem mudança de assinatura.
- `revokeThirdPartyInvite(id, actorId)`, `deleteThirdPartyInvite(id, actorId)`.

- [ ] **Step 1: Escrever os testes (falhando)**

Adicionar a `apps/api/src/services/third-party-invite-service.test.ts`:

```ts
  it('audita revoke e delete de convite', async () => {
    const admin = await prisma.user.create({ data: { name: 'AuditInviteAdmin', email: 'auditinvite@x.com', passwordHash: 'x', role: 'ADMIN' } })
    const { invite } = await createThirdPartyInvite(admin.id, 60, [])
    await revokeThirdPartyInvite(invite.id, admin.id)

    const { invite: invite2 } = await createThirdPartyInvite(admin.id, 60, [])
    await deleteThirdPartyInvite(invite2.id, admin.id)

    const revokeRow = await prisma.adminAuditLog.findFirstOrThrow({ where: { entityType: 'ThirdPartyInvite', entityId: invite.id } })
    expect(revokeRow.action).toBe('UPDATE')
    const deleteRow = await prisma.adminAuditLog.findFirstOrThrow({ where: { entityType: 'ThirdPartyInvite', entityId: invite2.id } })
    expect(deleteRow.action).toBe('DELETE')
  })
```

Localize (ou crie, se não existir) `apps/api/src/services/office-guest-service.test.ts` e adicione, seguindo o padrão de setup já usado nos testes vizinhos desse arquivo (ou de `office-guests.test.ts`, rota):

```ts
  it('audita criação de convite de convidado', async () => {
    const admin = await prisma.user.create({ data: { name: 'AuditGuestAdmin', email: 'auditguest@x.com', passwordHash: 'x', role: 'ADMIN' } })
    const { invite } = await createOfficeGuestInvite(admin.id, 60)
    const row = await prisma.adminAuditLog.findFirstOrThrow({ where: { entityType: 'OfficeGuestInvite', entityId: invite.id } })
    expect(row.action).toBe('CREATE')
  })
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/api exec vitest run src/services/third-party-invite-service.test.ts -t "audita revoke"`
Expected: FAIL

- [ ] **Step 3: Instrumentar `apps/api/src/services/third-party-invite-service.ts`**

Adicionar o import: `import { recordAuditLog } from './audit-log-service'`.

Trocar `createThirdPartyInvite` (já recebe `createdById`, só adicionar a chamada):

```ts
export async function createThirdPartyInvite(
  createdById: string,
  expiresInMinutes: number,
  enabledFeatures: FeatureKey[],
) {
  const duration = clampDuration(Math.floor(expiresInMinutes))
  const rawToken = newRawToken()
  const expiresAt = new Date(Date.now() + duration * 60_000)
  const invite = await prisma.thirdPartyInvite.create({
    data: {
      tokenHash: hashThirdPartyInviteToken(rawToken),
      createdById,
      enabledFeatures,
      expiresAt,
    },
  })
  await recordAuditLog({ actorId: createdById, entityType: 'ThirdPartyInvite', entityId: invite.id, action: 'CREATE', after: invite })
  return { invite, rawToken }
}
```

Trocar `revokeThirdPartyInvite` — reescrever para ler antes/depois (hoje usa `updateMany` sem leitura) e adicionar `actorId: string`:

```ts
export async function revokeThirdPartyInvite(id: string, actorId: string): Promise<void> {
  const before = await prisma.thirdPartyInvite.findUnique({ where: { id } })
  if (!before || before.usedAt || before.revokedAt) return
  const after = await prisma.thirdPartyInvite.update({ where: { id }, data: { revokedAt: new Date() } })
  await recordAuditLog({ actorId, entityType: 'ThirdPartyInvite', entityId: id, action: 'UPDATE', before, after })
}
```

Trocar `deleteThirdPartyInvite` — adicionar `actorId: string`:

```ts
export async function deleteThirdPartyInvite(id: string, actorId: string): Promise<void> {
  const invite = await prisma.thirdPartyInvite.findUnique({ where: { id } })
  if (!invite) throw new ThirdPartyInviteError('Convite não encontrado', 404)
  await prisma.thirdPartyInvite.delete({ where: { id } })
  await recordAuditLog({ actorId, entityType: 'ThirdPartyInvite', entityId: id, action: 'DELETE', before: invite })
}
```

- [ ] **Step 4: Instrumentar `apps/api/src/services/office-guest-service.ts`**

Adicionar o import: `import { recordAuditLog } from './audit-log-service'`.

Trocar `createOfficeGuestInvite` (já recebe `createdById`):

```ts
export async function createOfficeGuestInvite(createdById: string, expiresInMinutes: number) {
  const duration = clampDuration(Math.floor(expiresInMinutes))
  const rawToken = newRawToken()
  const expiresAt = new Date(Date.now() + duration * 60_000)
  const invite = await prisma.officeGuestInvite.create({
    data: {
      tokenHash: hashOfficeGuestToken(rawToken),
      createdById,
      expiresAt,
    },
  })
  await recordAuditLog({ actorId: createdById, entityType: 'OfficeGuestInvite', entityId: invite.id, action: 'CREATE', after: invite })
  return { invite, rawToken }
}
```

- [ ] **Step 5: Atualizar os 2 call sites em `apps/api/src/routes/third-party-invites.ts`**

```ts
    await revokeThirdPartyInvite(parsed.data.id, request.user.sub)
```
```ts
      await deleteThirdPartyInvite(parsed.data.id, request.user.sub)
```

- [ ] **Step 6: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/api exec vitest run src/services/third-party-invite-service.test.ts src/services/office-guest-service.test.ts src/routes/third-party-invites.test.ts src/routes/office-guests.test.ts`
Expected: PASS (todos os arquivos que existirem entre esses)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/third-party-invite-service.ts apps/api/src/services/office-guest-service.ts apps/api/src/routes/third-party-invites.ts apps/api/src/services/office-guest-service.test.ts
git commit -m "feat(api): audita convites de convidado e de terceirizado"
```

---

## Task 13: `GET /admin/dashboard`

**Files:**
- Create: `apps/api/src/services/admin-dashboard-service.ts`
- Create: `apps/api/src/services/admin-dashboard-service.test.ts`
- Modify: `apps/api/src/routes/admin.ts`
- Test: extensão de `apps/api/src/routes/admin.test.ts`

**Interfaces:**
- Produces: `getAdminDashboard(now?: Date): Promise<AdminDashboardResponse>`.

- [ ] **Step 1: Escrever os testes (falhando)**

```ts
// apps/api/src/services/admin-dashboard-service.test.ts
import { describe, it, expect } from 'vitest'
import { prisma } from '../lib/prisma'
import { createSector } from './sector-service'
import { getAdminDashboard } from './admin-dashboard-service'

describe('getAdminDashboard', () => {
  it('agrega período ativo, votos e destaque pendente por setor', async () => {
    const admin = await prisma.user.create({ data: { name: 'AuditAdmin', email: 'dash-admin@x.com', passwordHash: 'x', role: 'ADMIN' } })
    const sector = await createSector({ name: 'Setor Dashboard', enabledFeatures: [], roles: ['LEGEND'] }, admin.id)
    const legend = await prisma.user.create({ data: { name: 'Legend Dash', email: 'dash-legend@x.com', passwordHash: 'x', role: 'LEGEND', sectorId: sector.id } })
    const voter = await prisma.user.create({ data: { name: 'Voter Dash', email: 'dash-voter@x.com', passwordHash: 'x', role: 'LEGEND', sectorId: sector.id } })
    const cat = await prisma.category.create({ data: { name: 'Cat Dash', slug: 'cat-dash' } })
    const now = new Date('2027-05-15T12:00:00.000Z')
    const period = await prisma.votingPeriod.create({
      data: { sectorId: sector.id, monthRef: '2027-05', startsAt: new Date('2027-05-01'), endsAt: new Date('2027-05-31'), status: 'OPEN' },
    })
    await prisma.vote.create({ data: { voterId: voter.id, votedId: legend.id, periodId: period.id, justification: 'justificativa válida', categories: { create: [{ categoryId: cat.id }] } } })

    const dashboard = await getAdminDashboard(now)
    const card = dashboard.sectors.find((s) => s.sectorId === sector.id)!
    expect(card.activeUserCount).toBe(2)
    expect(card.period?.state).toBe('ACTIVE')
    expect(card.period?.votesCast).toBe(1)
    expect(card.pendingHighlight).toBe(false) // não há período ENCERRADO ainda
  })

  it('marca pendingHighlight quando o último período encerrado não tem destaque publicado', async () => {
    const admin = await prisma.user.create({ data: { name: 'AuditAdmin2', email: 'dash-admin2@x.com', passwordHash: 'x', role: 'ADMIN' } })
    const sector = await createSector({ name: 'Setor Dashboard 2', enabledFeatures: [], roles: [] }, admin.id)
    await prisma.votingPeriod.create({
      data: { sectorId: sector.id, monthRef: '2027-04', startsAt: new Date('2027-04-01'), endsAt: new Date('2027-04-30'), status: 'CLOSED', highlightStatus: 'NONE' },
    })
    const dashboard = await getAdminDashboard(new Date('2027-05-01T00:00:00.000Z'))
    const card = dashboard.sectors.find((s) => s.sectorId === sector.id)!
    expect(card.pendingHighlight).toBe(true)
    expect(card.period).toBeNull() // não há período ATIVO nem AGENDADO
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm db:up && pnpm --filter @legends/api exec vitest run src/services/admin-dashboard-service.test.ts`
Expected: FAIL (`Cannot find module './admin-dashboard-service'`)

- [ ] **Step 3: Implementar `admin-dashboard-service.ts`**

```ts
// apps/api/src/services/admin-dashboard-service.ts
import type { AdminDashboardResponse, SectorDashboardCardDTO } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { derivePeriodState } from '../lib/period-state'

export async function getAdminDashboard(now: Date = new Date()): Promise<AdminDashboardResponse> {
  const sectors = await prisma.sector.findMany({ orderBy: { name: 'asc' } })
  const cards: SectorDashboardCardDTO[] = []

  for (const sector of sectors) {
    const [activeUserCount, periods] = await Promise.all([
      prisma.user.count({ where: { sectorId: sector.id, active: true } }),
      prisma.votingPeriod.findMany({ where: { sectorId: sector.id }, orderBy: { startsAt: 'desc' } }),
    ])

    const openOrScheduled = periods.find((p) => {
      const state = derivePeriodState(p, now)
      return state === 'ACTIVE' || state === 'SCHEDULED'
    })
    const lastEnded = periods.find((p) => derivePeriodState(p, now) === 'ENDED')

    let votesCast = 0
    let periodCard: SectorDashboardCardDTO['period'] = null
    if (openOrScheduled) {
      votesCast = await prisma.vote.count({ where: { periodId: openOrScheduled.id } })
      periodCard = {
        id: openOrScheduled.id,
        monthRef: openOrScheduled.monthRef,
        state: derivePeriodState(openOrScheduled, now),
        startsAt: openOrScheduled.startsAt.toISOString(),
        endsAt: openOrScheduled.endsAt.toISOString(),
        votesCast,
      }
    }

    cards.push({
      sectorId: sector.id,
      sectorName: sector.name,
      activeUserCount,
      period: periodCard,
      pendingHighlight: lastEnded ? lastEnded.highlightStatus !== 'PUBLISHED' : false,
    })
  }

  return { sectors: cards }
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/api exec vitest run src/services/admin-dashboard-service.test.ts`
Expected: PASS (2 testes)

- [ ] **Step 5: Escrever o teste de rota (falhando)**

Adicionar a `apps/api/src/routes/admin.test.ts`:

```ts
it('GET /admin/dashboard retorna um card por setor', async () => {
  const app = buildApp()
  await app.ready()
  const token = await adminToken(app)
  const res = await app.inject({ method: 'GET', url: '/admin/dashboard', headers: { authorization: `Bearer ${token}` } })
  expect(res.statusCode).toBe(200)
  const body = res.json() as { sectors: Array<{ sectorId: string; sectorName: string }> }
  expect(body.sectors.some((s) => s.sectorId === 'sector-dev-produto')).toBe(true)
  await app.close()
})
```

- [ ] **Step 6: Adicionar a rota em `apps/api/src/routes/admin.ts`**

```ts
import { getAdminDashboard } from '../services/admin-dashboard-service'
```

```ts
  app.get('/admin/dashboard', adminOnly, async (_request, reply) => {
    return reply.send(await getAdminDashboard())
  })
```

- [ ] **Step 7: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts`
Expected: PASS (todos)

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/admin-dashboard-service.ts apps/api/src/services/admin-dashboard-service.test.ts apps/api/src/routes/admin.ts apps/api/src/routes/admin.test.ts
git commit -m "feat(api): GET /admin/dashboard (resumo por setor)"
```

---

## Task 14: `AdminSidebar.tsx`

**Files:**
- Create: `apps/web/src/pages/admin/AdminSidebar.tsx`
- Create: `apps/web/src/pages/admin/AdminSidebar.test.tsx`

**Interfaces:**
- Produces: `ADMIN_NAV_GROUPS: { label: string; items: { to: string; label: string }[] }[]`, componente `AdminSidebar`.

- [ ] **Step 1: Escrever o teste (falhando)**

```tsx
// apps/web/src/pages/admin/AdminSidebar.test.tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AdminSidebar } from './AdminSidebar'

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AdminSidebar />
    </MemoryRouter>,
  )
}

describe('AdminSidebar', () => {
  it('agrupa os itens por categoria e mostra todos os rótulos', () => {
    renderAt('/admin')
    expect(screen.getByText('Organização')).toBeInTheDocument()
    expect(screen.getByText('Reconhecimento')).toBeInTheDocument()
    expect(screen.getByText('Comunidade')).toBeInTheDocument()
    expect(screen.getByText('Escritório')).toBeInTheDocument()
    expect(screen.getByText('Sistema')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Setores' })).toHaveAttribute('href', '/admin/setores')
    expect(screen.getByRole('link', { name: 'Auditoria' })).toHaveAttribute('href', '/admin/auditoria')
  })

  it('marca o item da rota ativa com aria-current', () => {
    renderAt('/admin/setores')
    expect(screen.getByRole('link', { name: 'Setores' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Lendas' })).not.toHaveAttribute('aria-current')
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/admin/AdminSidebar.test.tsx`
Expected: FAIL (`Cannot find module './AdminSidebar'`)

- [ ] **Step 3: Implementar `AdminSidebar.tsx`**

```tsx
import { NavLink } from 'react-router-dom'

interface AdminNavItem {
  to: string
  label: string
}

interface AdminNavGroup {
  label: string
  items: AdminNavItem[]
}

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    label: 'Organização',
    items: [
      { to: '/admin/setores', label: 'Setores' },
      { to: '/admin/lendas', label: 'Lendas' },
      { to: '/admin/terceirizados', label: 'Terceirizados' },
      { to: '/admin/squads', label: 'Squads' },
    ],
  },
  {
    label: 'Reconhecimento',
    items: [
      { to: '/admin/periodos', label: 'Períodos' },
      { to: '/admin/categorias', label: 'Categorias' },
      { to: '/admin/selos', label: 'Selos' },
    ],
  },
  {
    label: 'Comunidade',
    items: [
      { to: '/admin/quinta-dev', label: 'Quinta de Dev' },
      { to: '/admin/retrospectivas', label: 'Retrospectivas' },
      { to: '/admin/moderacao', label: 'Moderação' },
      { to: '/admin/resenha', label: 'Resenha' },
    ],
  },
  {
    label: 'Escritório',
    items: [
      { to: '/admin/escritorio', label: 'Escritório' },
      { to: '/admin/mapas', label: 'Mapas' },
    ],
  },
  {
    label: 'Sistema',
    items: [{ to: '/admin/auditoria', label: 'Auditoria' }],
  },
]

const linkCls = ({ isActive }: { isActive: boolean }) =>
  [
    'block rounded-md px-md py-sm font-label text-label-md transition-colors',
    isActive ? 'bg-primary/10 font-bold text-primary' : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
  ].join(' ')

export function AdminSidebar() {
  return (
    <nav className="flex w-60 shrink-0 flex-col gap-lg border-r border-outline-variant/40 p-lg" aria-label="Administração">
      <NavLink to="/admin" end className={linkCls}>
        Dashboard
      </NavLink>
      {ADMIN_NAV_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-1">
          <p className="px-md font-label text-label-sm uppercase tracking-wide text-on-surface-variant">{group.label}</p>
          {group.items.map((item) => (
            <NavLink key={item.to} to={item.to} className={linkCls}>
              {item.label}
            </NavLink>
          ))}
        </div>
      ))}
    </nav>
  )
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/web exec vitest run src/pages/admin/AdminSidebar.test.tsx`
Expected: PASS (2 testes)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/admin/AdminSidebar.tsx apps/web/src/pages/admin/AdminSidebar.test.tsx
git commit -m "feat(web): AdminSidebar agrupada por categoria"
```

---

## Task 15: `AdminDashboardPage.tsx`

**Files:**
- Create: `apps/web/src/pages/admin/AdminDashboardPage.tsx`
- Create: `apps/web/src/pages/admin/AdminDashboardPage.test.tsx`

**Interfaces:**
- Consumes: `GET /admin/dashboard` (Task 13), `SectorDashboardCardDTO`/`AdminDashboardResponse` (`@legends/shared`).

- [ ] **Step 1: Escrever o teste (falhando)**

```tsx
// apps/web/src/pages/admin/AdminDashboardPage.test.tsx
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi } from 'vitest'
import { AdminDashboardPage } from './AdminDashboardPage'
import * as api from '../../lib/api'

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AdminDashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AdminDashboardPage', () => {
  it('mostra um card por setor com estado do período e alerta de destaque pendente', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({
      sectors: [
        {
          sectorId: 's1',
          sectorName: 'Desenvolvimento de Produto',
          activeUserCount: 10,
          period: { id: 'p1', monthRef: '2027-05', state: 'ACTIVE', startsAt: '2027-05-01T00:00:00.000Z', endsAt: '2027-05-31T23:59:59.000Z', votesCast: 3 },
          pendingHighlight: false,
        },
        {
          sectorId: 's2',
          sectorName: 'Comercial',
          activeUserCount: 4,
          period: null,
          pendingHighlight: true,
        },
      ],
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('Desenvolvimento de Produto')).toBeInTheDocument())
    expect(screen.getByText('Comercial')).toBeInTheDocument()
    expect(screen.getByText(/3 votos/i)).toBeInTheDocument()
    expect(screen.getByText(/destaque pendente/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/admin/AdminDashboardPage.test.tsx`
Expected: FAIL (`Cannot find module './AdminDashboardPage'`)

- [ ] **Step 3: Implementar `AdminDashboardPage.tsx`**

```tsx
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import type { AdminDashboardResponse, SectorDashboardCardDTO } from '@legends/shared'
import { apiFetch } from '../../lib/api'
import { Icon } from '../../components/Icon'

const STATE_LABELS: Record<string, string> = {
  SCHEDULED: 'Agendado',
  ACTIVE: 'Ativo',
  ENDED: 'Encerrado',
}

function SectorCard({ card }: { card: SectorDashboardCardDTO }) {
  return (
    <div className="rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
      <div className="flex items-center justify-between">
        <h3 className="font-headline text-headline-sm text-on-surface">{card.sectorName}</h3>
        <span className="font-label text-label-sm text-on-surface-variant">{card.activeUserCount} usuários</span>
      </div>
      {card.period ? (
        <p className="mt-sm text-body-sm text-on-surface-variant">
          Período {STATE_LABELS[card.period.state] ?? card.period.state} ({card.period.monthRef}) — {card.period.votesCast} votos
        </p>
      ) : (
        <p className="mt-sm text-body-sm text-on-surface-variant">Sem período agendado ou ativo.</p>
      )}
      {card.pendingHighlight && (
        <p className="mt-sm flex items-center gap-xs text-body-sm text-error">
          <Icon name="warning" className="text-[16px]" />
          Destaque pendente de gerar/publicar
        </p>
      )}
      <Link to="/admin/periodos" className="mt-md inline-block font-label text-label-sm text-primary hover:underline">
        Ver períodos
      </Link>
    </div>
  )
}

export function AdminDashboardPage() {
  const { data } = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: () => apiFetch<AdminDashboardResponse>('/admin/dashboard'),
  })

  return (
    <section className="flex flex-col gap-lg">
      <header>
        <h2 className="font-headline text-headline-xl text-on-surface">Dashboard</h2>
        <p className="mt-2 text-body-md text-on-surface-variant">Resumo operacional por setor.</p>
      </header>
      <div className="grid gap-lg sm:grid-cols-2 lg:grid-cols-3">
        {(data?.sectors ?? []).map((card) => (
          <SectorCard key={card.sectorId} card={card} />
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/web exec vitest run src/pages/admin/AdminDashboardPage.test.tsx`
Expected: PASS (1 teste)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/admin/AdminDashboardPage.tsx apps/web/src/pages/admin/AdminDashboardPage.test.tsx
git commit -m "feat(web): AdminDashboardPage (resumo por setor)"
```

---

## Task 16: `AdminAuditLogPage.tsx`

**Files:**
- Create: `apps/web/src/pages/admin/AdminAuditLogPage.tsx`
- Create: `apps/web/src/pages/admin/AdminAuditLogPage.test.tsx`

**Interfaces:**
- Consumes: `GET /admin/audit-log?actorId=&entityType=&page=&pageSize=` (Task 3), `AuditLogEntryDTO`/`AuditLogListResponse`/`ADMIN_AUDIT_ACTION_LABELS` (`@legends/shared`).

- [ ] **Step 1: Escrever o teste (falhando)**

```tsx
// apps/web/src/pages/admin/AdminAuditLogPage.test.tsx
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi } from 'vitest'
import { AdminAuditLogPage } from './AdminAuditLogPage'
import * as api from '../../lib/api'

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminAuditLogPage />
    </QueryClientProvider>,
  )
}

describe('AdminAuditLogPage', () => {
  it('lista os eventos e expande o antes/depois ao clicar', async () => {
    const apiFetchMock = vi.spyOn(api, 'apiFetch').mockResolvedValue({
      entries: [
        {
          id: 'e1',
          actor: { id: 'u1', name: 'Ana' },
          entityType: 'Category',
          entityId: 'c1',
          action: 'UPDATE',
          before: { active: true },
          after: { active: false },
          createdAt: '2027-05-01T12:00:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 30,
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument())
    expect(screen.getByText('Editou')).toBeInTheDocument()
    expect(screen.getByText('Category')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /ver detalhes/i }))
    expect(await screen.findByText(/"active": true/)).toBeInTheDocument()
    expect(screen.getByText(/"active": false/)).toBeInTheDocument()
    expect(apiFetchMock).toHaveBeenCalledWith(expect.stringContaining('/admin/audit-log'))
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/admin/AdminAuditLogPage.test.tsx`
Expected: FAIL (`Cannot find module './AdminAuditLogPage'`)

- [ ] **Step 3: Implementar `AdminAuditLogPage.tsx`**

```tsx
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AuditLogEntryDTO, AuditLogListResponse } from '@legends/shared'
import { ADMIN_AUDIT_ACTION_LABELS } from '@legends/shared'
import { apiFetch } from '../../lib/api'
import { Panel } from './shared'

function EntryRow({ entry }: { entry: AuditLogEntryDTO }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <li className="rounded-lg border border-outline-variant/20 bg-surface-container-low p-md">
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <span className="text-on-surface">
          <strong>{entry.actor.name}</strong>{' '}
          <span className="font-label text-label-sm text-on-surface-variant">
            {ADMIN_AUDIT_ACTION_LABELS[entry.action]} {entry.entityType} · {new Date(entry.createdAt).toLocaleString('pt-BR')}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
        >
          {expanded ? 'Esconder detalhes' : 'Ver detalhes'}
        </button>
      </div>
      {expanded && (
        <div className="mt-sm grid gap-sm sm:grid-cols-2">
          <pre className="overflow-x-auto rounded-md bg-surface-container-highest p-sm text-body-sm">{JSON.stringify(entry.before, null, 2)}</pre>
          <pre className="overflow-x-auto rounded-md bg-surface-container-highest p-sm text-body-sm">{JSON.stringify(entry.after, null, 2)}</pre>
        </div>
      )}
    </li>
  )
}

export function AdminAuditLogPage() {
  const [page, setPage] = useState(1)
  const [entityType, setEntityType] = useState('')
  const pageSize = 30

  const query = useQuery({
    queryKey: ['admin', 'audit-log', page, entityType],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (entityType) params.set('entityType', entityType)
      return apiFetch<AuditLogListResponse>(`/admin/audit-log?${params.toString()}`)
    },
  })

  const entries = query.data?.entries ?? []
  const total = query.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <Panel title="Auditoria">
      <div className="mb-md flex gap-sm">
        <input
          value={entityType}
          onChange={(e) => {
            setPage(1)
            setEntityType(e.target.value)
          }}
          placeholder="Filtrar por tipo (ex.: Sector)"
          aria-label="Filtrar por tipo de entidade"
          className="w-full max-w-xs rounded-md border border-outline-variant/60 bg-surface-container-highest px-3 py-2 text-body-sm text-on-surface outline-none"
        />
      </div>
      <ul className="flex flex-col gap-sm">
        {entries.map((entry) => (
          <EntryRow key={entry.id} entry={entry} />
        ))}
      </ul>
      {entries.length === 0 && !query.isLoading && <p className="text-body-sm text-on-surface-variant">Nenhum evento encontrado.</p>}
      <div className="mt-md flex items-center gap-sm">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant disabled:opacity-40"
        >
          Anterior
        </button>
        <span className="font-label text-label-sm text-on-surface-variant">
          Página {page} de {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant disabled:opacity-40"
        >
          Próxima
        </button>
      </div>
    </Panel>
  )
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/web exec vitest run src/pages/admin/AdminAuditLogPage.test.tsx`
Expected: PASS (1 teste)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/admin/AdminAuditLogPage.tsx apps/web/src/pages/admin/AdminAuditLogPage.test.tsx
git commit -m "feat(web): AdminAuditLogPage (lista paginada com diff antes/depois)"
```

---

## Task 17: Rewire `App.tsx` — `AdminLayout` + rotas por seção; remove `AdminPage`/`TabBar`

**Files:**
- Create: `apps/web/src/pages/admin/AdminLayout.tsx`
- Create: `apps/web/src/pages/admin/AdminLayout.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Delete: `apps/web/src/pages/AdminPage.tsx`, `apps/web/src/pages/AdminPage.test.tsx`, `apps/web/src/pages/admin/TabBar.tsx`, `apps/web/src/pages/admin/TabBar.test.tsx`

**Interfaces:**
- Consumes: `AdminSidebar` (Task 14), `AdminDashboardPage` (Task 15), `AdminAuditLogPage` (Task 16), todas as `XSection.tsx` já existentes.

- [ ] **Step 1: Escrever o teste de `AdminLayout.test.tsx` (falhando)**

```tsx
// apps/web/src/pages/admin/AdminLayout.test.tsx
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AdminLayout } from './AdminLayout'

describe('AdminLayout', () => {
  it('renderiza a sidebar e a rota filha via Outlet', () => {
    render(
      <MemoryRouter initialEntries={['/admin/setores']}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route path="setores" element={<p>Conteúdo de setores</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'Setores' })).toBeInTheDocument()
    expect(screen.getByText('Conteúdo de setores')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/admin/AdminLayout.test.tsx`
Expected: FAIL (`Cannot find module './AdminLayout'`)

- [ ] **Step 3: Implementar `AdminLayout.tsx`**

```tsx
import { Outlet } from 'react-router-dom'
import { AdminSidebar } from './AdminSidebar'

export function AdminLayout() {
  return (
    <div className="mx-auto flex max-w-7xl gap-xl p-lg md:p-xl">
      <AdminSidebar />
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Rodar e confirmar sucesso**

Run: `pnpm --filter @legends/web exec vitest run src/pages/admin/AdminLayout.test.tsx`
Expected: PASS (1 teste)

- [ ] **Step 5: Reescrever o bloco de rotas de admin em `apps/web/src/App.tsx`**

Trocar os imports (remover `AdminPage`, adicionar os novos):

```tsx
import { AdminLayout } from "./pages/admin/AdminLayout";
import { AdminDashboardPage } from "./pages/admin/AdminDashboardPage";
import { AdminAuditLogPage } from "./pages/admin/AdminAuditLogPage";
import { PeriodsSection } from "./pages/admin/PeriodsSection";
import { SectorsSection } from "./pages/admin/SectorsSection";
import { CollaboratorsSection } from "./pages/admin/CollaboratorsSection";
import { ThirdPartySection } from "./pages/admin/ThirdPartySection";
import { SquadsSection } from "./pages/admin/SquadsSection";
import { CategoriesSection } from "./pages/admin/CategoriesSection";
import { BadgesSection } from "./pages/admin/BadgesSection";
import { DevelopmentThursdaySection } from "./pages/admin/DevelopmentThursdaySection";
import { RetrospectivesSection } from "./pages/admin/RetrospectivesSection";
import { ModerationSection } from "./pages/admin/ModerationSection";
import { OfficeSection } from "./pages/admin/OfficeSection";
import { MapsSection } from "./pages/admin/MapsSection";
```

Trocar o bloco das rotas `/admin` e `/admin/resenha` (hoje linhas 294-309 do arquivo, dentro do `<Route element={<ProtectedRoute><AppLayout/></ProtectedRoute>}>`):

```tsx
                  <Route
                    path="/admin"
                    element={
                      <AdminOnly>
                        <AdminLayout />
                      </AdminOnly>
                    }
                  >
                    <Route index element={<AdminDashboardPage />} />
                    <Route path="setores" element={<SectorsSection />} />
                    <Route path="lendas" element={<CollaboratorsSection />} />
                    <Route path="terceirizados" element={<ThirdPartySection />} />
                    <Route path="squads" element={<SquadsSection />} />
                    <Route path="periodos" element={<PeriodsSection />} />
                    <Route path="categorias" element={<CategoriesSection />} />
                    <Route path="selos" element={<BadgesSection />} />
                    <Route path="quinta-dev" element={<DevelopmentThursdaySection />} />
                    <Route path="retrospectivas" element={<RetrospectivesSection />} />
                    <Route path="moderacao" element={<ModerationSection />} />
                    <Route path="resenha" element={<AdminResenhaPage />} />
                    <Route path="escritorio" element={<OfficeSection />} />
                    <Route path="mapas" element={<MapsSection />} />
                    <Route path="auditoria" element={<AdminAuditLogPage />} />
                  </Route>
```

`AdminResenhaPage` já está importado no topo do arquivo (mantenha o import existente, só remova a antiga rota irmã `/admin/resenha` que ficava fora deste bloco).

- [ ] **Step 6: Remover os arquivos obsoletos**

```bash
git rm apps/web/src/pages/AdminPage.tsx apps/web/src/pages/AdminPage.test.tsx apps/web/src/pages/admin/TabBar.tsx apps/web/src/pages/admin/TabBar.test.tsx
```

- [ ] **Step 7: Migrar as asserções de `AdminPage.test.tsx` que não têm cobertura equivalente em outro arquivo**

Releia os 13 testes que existiam em `AdminPage.test.tsx` (títulos listados na investigação desta feature — "creates a new category", "schedules a future period...", "edits a collaborator email and password (PATCH)", "removes a vote in moderation", "concede um selo ao membro selecionado (POST)", etc.). Para cada um, confira se `CategoriesSection.test.tsx`, `PeriodsSection` (sem teste dedicado hoje), `CollaboratorsSection.test.tsx` (se existir), `ModerationSection.test.tsx` (se existir) e `BadgesSection.test.tsx` já cobrem o mesmo comportamento isoladamente. Para qualquer asserção SEM equivalente, adicione um teste novo, focado, no arquivo de teste da seção correspondente (criando o arquivo se a seção ainda não tiver um) — seguindo o padrão de `render` + `QueryClientProvider` já usado em `SectorsSection.test.tsx`/`ThirdPartySection.test.tsx`. Rode cada arquivo tocado individualmente após a migração.

- [ ] **Step 8: Rodar toda a suíte de `apps/web/src/pages/admin` e o build**

Run: `pnpm --filter @legends/web exec vitest run src/pages/admin src/App.home-route.test.tsx`
Expected: PASS (todos)

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/pages/admin/AdminLayout.tsx apps/web/src/pages/admin/AdminLayout.test.tsx apps/web/src/App.tsx
git commit -m "feat(web): rotas próprias para o admin (AdminLayout + sidebar), remove AdminPage/TabBar"
```

---

## Verificação final

- [ ] Run: `pnpm db:up && pnpm test` (suíte completa: api + web + shared)
Expected: tudo verde (aceitando o flake conhecido de worker-crash do tinypool em `apps/web`, sem linhas FAIL — documentado nas plans anteriores deste repo).
- [ ] Run: `pnpm --filter @legends/api exec tsc --noEmit && pnpm --filter @legends/web exec tsc --noEmit && pnpm --filter @legends/shared exec tsc --noEmit`
Expected: sem erros.
- [ ] Conferir manualmente (`pnpm dev` + login como admin): `/admin` mostra o Dashboard com cards por setor; a sidebar navega para cada seção preservando a URL; `/admin/auditoria` lista eventos reais gerados pelas ações acima; criar/editar uma categoria e um setor pela UI e confirmar que aparecem na Auditoria com antes/depois corretos.

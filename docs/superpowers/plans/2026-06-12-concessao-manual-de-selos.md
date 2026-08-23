# Concessão manual de selos pelo admin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que um admin conceda qualquer selo a qualquer membro sem votação, com revogação das concessões manuais e rastreio de origem (auto/manual + quem concedeu).

**Architecture:** `UserBadge` ganha `source` (`AUTO`/`MANUAL`) e `awardedById`. O serviço `badge-service` ganha `grantBadgeManually`/`revokeManualBadge`. Três rotas admin novas (`GET/POST/DELETE /admin/users/:userId/badges`). O DTO `AwardedBadgeDTO` passa a expor `source`/`awardedBy`. Um novo painel "Selos por membro" no `AdminPage` consome essas rotas.

**Tech Stack:** Fastify + Prisma (PostgreSQL) no backend, React + React Query + Tailwind no frontend, zod para validação, vitest para testes. Monorepo pnpm com pacote `@legends/shared` para DTOs.

---

## Mapa de arquivos

- **Modify** `apps/api/prisma/schema.prisma` — enum `BadgeAwardSource`, campos em `UserBadge`, relação inversa em `User`.
- **Create** `apps/api/prisma/migrations/<timestamp>_add_manual_badge_award/migration.sql` — gerada pelo Prisma.
- **Modify** `apps/api/src/services/badge-service.ts` — `BadgeError`, `grantBadgeManually`, `revokeManualBadge`, include de `awardedBy` em `listBadgesForUser`.
- **Modify** `apps/api/src/services/badge-service.test.ts` — testes das funções novas.
- **Modify** `packages/shared/src/badge.ts` — `AwardedBadgeDTO` com `source`/`awardedBy`.
- **Modify** `apps/api/src/lib/serialize.ts` — `toAwardedBadgeDTO` mapeia os novos campos.
- **Modify** `apps/api/src/routes/admin.ts` — rotas `GET/POST/DELETE /admin/users/:userId/badges`.
- **Modify** `apps/api/src/routes/admin.test.ts` — testes das rotas novas.
- **Modify** `apps/web/src/pages/AdminPage.tsx` — componente `MemberBadgesPanel` + uso no render.
- **Modify** `apps/web/src/pages/AdminPage.test.tsx` — teste do painel.

---

## Task 1: Schema + migração para concessão manual

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_add_manual_badge_award/migration.sql` (gerada)

- [ ] **Step 1: Adicionar o enum `BadgeAwardSource` ao schema**

No `apps/api/prisma/schema.prisma`, logo após o enum `BadgeKind` (linha ~32), adicione:

```prisma
enum BadgeAwardSource {
  AUTO
  MANUAL
}
```

- [ ] **Step 2: Adicionar os campos novos a `UserBadge`**

Substitua o model `UserBadge` por:

```prisma
model UserBadge {
  id          String           @id @default(cuid())
  userId      String
  badgeId     String
  periodId    String?
  source      BadgeAwardSource @default(AUTO)
  awardedById String?
  awardedAt   DateTime         @default(now())

  user      User  @relation(fields: [userId], references: [id])
  badge     Badge @relation(fields: [badgeId], references: [id])
  awardedBy User? @relation("BadgesAwarded", fields: [awardedById], references: [id])

  @@unique([userId, badgeId, periodId])
  @@index([userId])
}
```

- [ ] **Step 3: Adicionar a relação inversa em `User`**

No model `User`, na lista de relações (após `badges UserBadge[]`, linha ~53), adicione:

```prisma
  badgesAwarded UserBadge[] @relation("BadgesAwarded")
```

- [ ] **Step 4: Gerar a migração e o client**

Run:
```bash
cd apps/api && DATABASE_URL="postgresql://legends:legends@localhost:5432/legends?schema=public" pnpm exec prisma migrate dev --name add_manual_badge_award
```
Expected: cria a pasta `prisma/migrations/<timestamp>_add_manual_badge_award/` com `migration.sql`, aplica no banco de dev e regenera o Prisma Client. O SQL deve criar o tipo `BadgeAwardSource`, adicionar as colunas `source` (default `AUTO`), `awardedById` e a FK para `User`.

- [ ] **Step 5: Garantir que a suíte existente ainda passa (migração aplicada no banco de teste)**

Run:
```bash
cd apps/api && pnpm test
```
Expected: PASS. O `global-setup.ts` roda `prisma migrate deploy` no `legends_test`, aplicando a nova migração. Os testes existentes do `badge-service` (que criam `UserBadge` sem `source`) continuam válidos porque `source` tem default `AUTO`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(api): adiciona source e awardedBy ao UserBadge"
```

---

## Task 2: Serviço de concessão/revogação manual

**Files:**
- Modify: `apps/api/src/services/badge-service.ts`
- Test: `apps/api/src/services/badge-service.test.ts`

- [ ] **Step 1: Escrever os testes que falham**

Em `apps/api/src/services/badge-service.test.ts`, atualize o import da linha 3 para incluir as funções novas e o erro:

```ts
import {
  evaluateBadgesForUser,
  listBadgesForUser,
  grantBadgeManually,
  revokeManualBadge,
  BadgeError,
} from './badge-service'
```

E adicione, antes do `})` final do `describe`:

```ts
  it('grants a badge manually with MANUAL source and the awarding admin', async () => {
    const member = await makeUser('Membro')
    const admin = await makeUser('Admin')
    const badge = await prisma.badge.create({
      data: { slug: 'honra', name: 'Honra', description: 'manual', kind: 'IMPACT', iconKey: 'star', threshold: 0 },
    })
    const awarded = await grantBadgeManually(member.id, badge.id, admin.id)
    expect(awarded.source).toBe('MANUAL')
    expect(awarded.awardedById).toBe(admin.id)
    expect(awarded.periodId).toBeNull()
    expect(awarded.badge.name).toBe('Honra')
  })

  it('rejects granting the same badge twice (unique violation)', async () => {
    const member = await makeUser('Membro')
    const admin = await makeUser('Admin')
    const badge = await prisma.badge.create({
      data: { slug: 'honra', name: 'Honra', description: 'manual', kind: 'IMPACT', iconKey: 'star', threshold: 0 },
    })
    await grantBadgeManually(member.id, badge.id, admin.id)
    await expect(grantBadgeManually(member.id, badge.id, admin.id)).rejects.toMatchObject({ code: 'P2002' })
  })

  it('revokes a manual award', async () => {
    const member = await makeUser('Membro')
    const admin = await makeUser('Admin')
    const badge = await prisma.badge.create({
      data: { slug: 'honra', name: 'Honra', description: 'manual', kind: 'IMPACT', iconKey: 'star', threshold: 0 },
    })
    const awarded = await grantBadgeManually(member.id, badge.id, admin.id)
    await revokeManualBadge(member.id, awarded.id)
    expect(await prisma.userBadge.findUnique({ where: { id: awarded.id } })).toBeNull()
  })

  it('refuses to revoke an automatic award (409)', async () => {
    const member = await makeUser('Membro')
    const badge = await prisma.badge.create({
      data: { slug: 'auto', name: 'Auto', description: 'a', kind: 'IMPACT', iconKey: 'star', threshold: 0 },
    })
    const auto = await prisma.userBadge.create({ data: { userId: member.id, badgeId: badge.id } })
    await expect(revokeManualBadge(member.id, auto.id)).rejects.toMatchObject({ status: 409 })
  })

  it('errors when revoking an award that does not belong to the member (404)', async () => {
    const member = await makeUser('Membro')
    const other = await makeUser('Outro')
    const admin = await makeUser('Admin')
    const badge = await prisma.badge.create({
      data: { slug: 'honra', name: 'Honra', description: 'manual', kind: 'IMPACT', iconKey: 'star', threshold: 0 },
    })
    const awarded = await grantBadgeManually(member.id, badge.id, admin.id)
    await expect(revokeManualBadge(other.id, awarded.id)).rejects.toMatchObject({ status: 404 })
  })
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run:
```bash
cd apps/api && pnpm test src/services/badge-service.test.ts
```
Expected: FAIL — `grantBadgeManually`, `revokeManualBadge`, `BadgeError` não existem (erro de import/compilação).

- [ ] **Step 3: Implementar as funções no serviço**

Em `apps/api/src/services/badge-service.ts`, adicione ao final do arquivo (e ajuste o `listBadgesForUser` existente):

```ts
export class BadgeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'BadgeError'
  }
}

/** Concede um selo manualmente. Sem período (periodId null) e marcado como MANUAL. */
export function grantBadgeManually(userId: string, badgeId: string, awardedById: string) {
  return prisma.userBadge.create({
    data: { userId, badgeId, source: 'MANUAL', awardedById, periodId: null },
    include: { badge: true, awardedBy: true },
  })
}

/** Revoga uma concessão MANUAL do membro. Recusa selos automáticos. */
export async function revokeManualBadge(userId: string, userBadgeId: string): Promise<void> {
  const award = await prisma.userBadge.findUnique({ where: { id: userBadgeId } })
  if (!award || award.userId !== userId) {
    throw new BadgeError('Concessão não encontrada.', 404)
  }
  if (award.source !== 'MANUAL') {
    throw new BadgeError('Selos automáticos não podem ser revogados manualmente.', 409)
  }
  await prisma.userBadge.delete({ where: { id: userBadgeId } })
}
```

E altere o `include` de `listBadgesForUser` (linha ~64) de `{ badge: true }` para:

```ts
    include: { badge: true, awardedBy: true },
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run:
```bash
cd apps/api && pnpm test src/services/badge-service.test.ts
```
Expected: PASS (todos, incluindo os 5 novos).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/badge-service.ts apps/api/src/services/badge-service.test.ts
git commit -m "feat(api): grant/revoke manual de selos no badge-service"
```

---

## Task 3: DTO compartilhado + serialização

**Files:**
- Modify: `packages/shared/src/badge.ts`
- Modify: `apps/api/src/lib/serialize.ts`

- [ ] **Step 1: Estender `AwardedBadgeDTO`**

Em `packages/shared/src/badge.ts`, substitua a interface `AwardedBadgeDTO` (linhas 14-18) por:

```ts
export type BadgeAwardSource = 'AUTO' | 'MANUAL'

export interface AwardedBadgeDTO {
  id: string
  badge: BadgeDTO
  awardedAt: string
  source: BadgeAwardSource
  awardedBy: { id: string; name: string } | null
}
```

- [ ] **Step 2: Atualizar `toAwardedBadgeDTO`**

Em `apps/api/src/lib/serialize.ts`, substitua o tipo do payload (linha 83) e a função (linhas 85-91) por:

```ts
type AwardedBadgePayload = Prisma.UserBadgeGetPayload<{ include: { badge: true; awardedBy: true } }>

export function toAwardedBadgeDTO(awarded: AwardedBadgePayload): AwardedBadgeDTO {
  return {
    id: awarded.id,
    badge: toBadgeDTO(awarded.badge),
    awardedAt: awarded.awardedAt.toISOString(),
    source: awarded.source,
    awardedBy: awarded.awardedBy ? { id: awarded.awardedBy.id, name: awarded.awardedBy.name } : null,
  }
}
```

- [ ] **Step 3: Verificar o build do pacote compartilhado e a tipagem da API**

Run:
```bash
cd /Users/luccasecco/Documents/projetos/engineering_legends && pnpm --filter @legends/shared build && pnpm --filter @legends/api exec tsc --noEmit
```
Expected: ambos sem erros. (`toAwardedBadgeDTO` agora exige payload com `awardedBy`; `listBadgesForUser` já o inclui após a Task 2.)

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/badge.ts apps/api/src/lib/serialize.ts
git commit -m "feat(shared): AwardedBadgeDTO expoe source e awardedBy"
```

---

## Task 4: Rotas admin de concessão/revogação

**Files:**
- Modify: `apps/api/src/routes/admin.ts`
- Test: `apps/api/src/routes/admin.test.ts`

- [ ] **Step 1: Escrever os testes que falham**

Em `apps/api/src/routes/admin.test.ts`, adicione um helper para criar um membro e os testes, antes do `})` final do `describe('admin routes')`. (O `adminToken`/`devToken` já existem no topo do arquivo.)

```ts
  async function makeMember(name: string, email: string) {
    return prisma.user.create({ data: { name, email, passwordHash: 'x', role: 'DEV' } })
  }
  async function makeBadge() {
    return prisma.badge.create({
      data: { slug: 'honra', name: 'Honra', description: 'manual', kind: 'IMPACT', iconKey: 'star', threshold: 0 },
    })
  }

  it('grants a badge to a member manually (201 with source MANUAL)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const member = await makeMember('Membro', 'membro@empresa.com')
    const badge = await makeBadge()
    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${member.id}/badges`,
      headers: { authorization: `Bearer ${token}` },
      payload: { badgeId: badge.id },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().badge.source).toBe('MANUAL')
    expect(res.json().badge.awardedBy.name).toBe('Admin')
    await app.close()
  })

  it('rejects granting the same badge twice (409)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const member = await makeMember('Membro', 'membro@empresa.com')
    const badge = await makeBadge()
    const grant = () =>
      app.inject({ method: 'POST', url: `/admin/users/${member.id}/badges`, headers: { authorization: `Bearer ${token}` }, payload: { badgeId: badge.id } })
    await grant()
    const res = await grant()
    expect(res.statusCode).toBe(409)
    await app.close()
  })

  it('returns 404 when granting an unknown badge', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const member = await makeMember('Membro', 'membro@empresa.com')
    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${member.id}/badges`,
      headers: { authorization: `Bearer ${token}` },
      payload: { badgeId: 'inexistente' },
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('lists the badges of a member', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const member = await makeMember('Membro', 'membro@empresa.com')
    const badge = await makeBadge()
    await app.inject({ method: 'POST', url: `/admin/users/${member.id}/badges`, headers: { authorization: `Bearer ${token}` }, payload: { badgeId: badge.id } })
    const res = await app.inject({ method: 'GET', url: `/admin/users/${member.id}/badges`, headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json().badges).toHaveLength(1)
    expect(res.json().badges[0].source).toBe('MANUAL')
    await app.close()
  })

  it('revokes a manual award (204)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const member = await makeMember('Membro', 'membro@empresa.com')
    const badge = await makeBadge()
    const granted = await app.inject({ method: 'POST', url: `/admin/users/${member.id}/badges`, headers: { authorization: `Bearer ${token}` }, payload: { badgeId: badge.id } })
    const userBadgeId = granted.json().badge.id
    const res = await app.inject({ method: 'DELETE', url: `/admin/users/${member.id}/badges/${userBadgeId}`, headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(204)
    await app.close()
  })

  it('refuses to revoke an automatic award (409)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const member = await makeMember('Membro', 'membro@empresa.com')
    const badge = await makeBadge()
    const auto = await prisma.userBadge.create({ data: { userId: member.id, badgeId: badge.id } })
    const res = await app.inject({ method: 'DELETE', url: `/admin/users/${member.id}/badges/${auto.id}`, headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(409)
    await app.close()
  })

  it('forbids a non-admin from granting a badge (403)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await devToken(app)
    const member = await makeMember('Membro', 'membro@empresa.com')
    const badge = await makeBadge()
    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${member.id}/badges`,
      headers: { authorization: `Bearer ${token}` },
      payload: { badgeId: badge.id },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
```

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run:
```bash
cd apps/api && pnpm test src/routes/admin.test.ts
```
Expected: FAIL — as rotas `/admin/users/:userId/badges` ainda não existem (404 onde se espera 201/200/204).

- [ ] **Step 3: Implementar as rotas**

Em `apps/api/src/routes/admin.ts`:

1. Atualize os imports do badge-service e do serialize. Substitua a linha 10 (`import { toBadgeDTO, ... }`) para incluir `toAwardedBadgeDTO`:

```ts
import { toAwardedBadgeDTO, toBadgeDTO, toCategoryDTO, toPeriodDTO, toPublicUser, toVoteDTO, toHighlightDTO } from '../lib/serialize'
```

2. Adicione um import novo do badge-service (após a linha 11):

```ts
import { grantBadgeManually, revokeManualBadge, listBadgesForUser, BadgeError } from '../services/badge-service'
```

3. Adicione o schema de validação junto aos outros (após `updateBadgeSchema`, linha ~72):

```ts
const grantBadgeSchema = z.object({ badgeId: z.string().min(1) })
```

4. Adicione as três rotas dentro de `adminRoutes`, antes do `}` final da função (após o bloco `app.delete('/admin/badges/:id', ...)`):

```ts
  app.get('/admin/users/:userId/badges', adminOnly, async (request, reply) => {
    const { userId } = request.params as { userId: string }
    const awarded = await listBadgesForUser(userId)
    return reply.send({ badges: awarded.map(toAwardedBadgeDTO) })
  })

  app.post('/admin/users/:userId/badges', adminOnly, async (request, reply) => {
    const { userId } = request.params as { userId: string }
    const parsed = grantBadgeSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos' })
    const [user, badge] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId } }),
      prisma.badge.findUnique({ where: { id: parsed.data.badgeId } }),
    ])
    if (!user) return reply.code(404).send({ message: 'Usuário não encontrado' })
    if (!badge) return reply.code(404).send({ message: 'Selo não encontrado' })
    try {
      const awarded = await grantBadgeManually(userId, parsed.data.badgeId, request.user.sub)
      return reply.code(201).send({ badge: toAwardedBadgeDTO(awarded) })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.code(409).send({ message: 'Este membro já possui esse selo.' })
      }
      throw err
    }
  })

  app.delete('/admin/users/:userId/badges/:userBadgeId', adminOnly, async (request, reply) => {
    const { userId, userBadgeId } = request.params as { userId: string; userBadgeId: string }
    try {
      await revokeManualBadge(userId, userBadgeId)
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof BadgeError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run:
```bash
cd apps/api && pnpm test src/routes/admin.test.ts
```
Expected: PASS (incluindo os 7 novos).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/src/routes/admin.test.ts
git commit -m "feat(api): rotas admin para conceder e revogar selos manualmente"
```

---

## Task 5: Painel "Selos por membro" no AdminPage

**Files:**
- Modify: `apps/web/src/pages/AdminPage.tsx`
- Test: `apps/web/src/pages/AdminPage.test.tsx`

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/web/src/pages/AdminPage.test.tsx`, dentro de `setupFetch`, adicione handlers antes da linha `return Promise.reject(...)`:

```ts
    if (path === '/admin/users/u9/badges' && !method) {
      return Promise.resolve({
        badges: [
          { id: 'ub1', badge: { id: 'b1', slug: 'conector', name: 'Conector do Time', description: 'd', kind: 'CATEGORY', iconKey: 'link', threshold: 5, categorySlug: 'colaboracao' }, awardedAt: '2026-06-01T00:00:00.000Z', source: 'MANUAL', awardedBy: { id: 'a1', name: 'Admin' } },
        ],
      })
    }
    if (path === '/admin/users/u9/badges' && method === 'POST') {
      return Promise.resolve({
        badge: { id: 'ub2', badge: { id: 'b1', slug: 'conector', name: 'Conector do Time', description: 'd', kind: 'CATEGORY', iconKey: 'link', threshold: 5, categorySlug: 'colaboracao' }, awardedAt: '2026-06-02T00:00:00.000Z', source: 'MANUAL', awardedBy: { id: 'a1', name: 'Admin' } },
      })
    }
    if (path.startsWith('/admin/users/u9/badges/') && method === 'DELETE') {
      return Promise.resolve({})
    }
```

E adicione o teste novo (ao final do arquivo, antes do fechamento — siga o padrão dos testes existentes, que usam `setupFetch()` + `renderPage()`):

```ts
test('lista os selos de um membro selecionado e mostra revogar só nos manuais', async () => {
  setupFetch()
  renderPage()

  const memberSelect = await screen.findByLabelText('Selecionar membro')
  fireEvent.change(memberSelect, { target: { value: 'u9' } })

  // GET /admin/users/u9/badges resolve e exibe o selo manual com botão de revogar.
  // Ancoramos no aria-label de revogar (único do painel) — o nome do selo também
  // aparece no painel "Selos", então findByText casaria múltiplos elementos.
  expect(await screen.findByLabelText('Revogar selo Conector do Time')).toBeInTheDocument()
})
```

> Nota: confira no topo do arquivo se os testes usam `it(` ou `test(`. Use a mesma função das outras specs do arquivo (`it` ou `test`). Os imports `screen`, `fireEvent` e `waitFor` já existem (linha 1).

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run:
```bash
cd apps/web && pnpm test src/pages/AdminPage.test.tsx
```
Expected: FAIL — não existe o label "Selecionar membro" (o painel ainda não foi adicionado).

- [ ] **Step 3: Importar o DTO no AdminPage**

Em `apps/web/src/pages/AdminPage.tsx`, na linha 3, adicione `AwardedBadgeDTO` ao import de `@legends/shared`:

```ts
import type { AwardedBadgeDTO, BadgeDTO, CategoryDTO, HighlightDTO, PublicUser, VoteDTO, VotingPeriodDTO } from '@legends/shared'
```

- [ ] **Step 4: Criar o componente `MemberBadgesPanel`**

Em `apps/web/src/pages/AdminPage.tsx`, adicione este componente logo após a função `Panel` (após a linha 32):

```tsx
function MemberBadgesPanel({ members, badges }: { members: PublicUser[]; badges: BadgeDTO[] }) {
  const queryClient = useQueryClient()
  const [memberId, setMemberId] = useState('')
  const [badgeId, setBadgeId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const userBadgesQuery = useQuery({
    queryKey: ['admin', 'userBadges', memberId],
    queryFn: () => apiFetch<{ badges: AwardedBadgeDTO[] }>(`/admin/users/${memberId}/badges`),
    enabled: Boolean(memberId),
  })

  const grant = useMutation({
    mutationFn: () =>
      apiFetch<{ badge: AwardedBadgeDTO }>(`/admin/users/${memberId}/badges`, { method: 'POST', body: JSON.stringify({ badgeId }) }),
    onSuccess: () => {
      setError(null)
      setBadgeId('')
      queryClient.invalidateQueries({ queryKey: ['admin', 'userBadges', memberId] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao conceder selo.'),
  })
  const revoke = useMutation({
    mutationFn: (userBadgeId: string) => apiFetch<unknown>(`/admin/users/${memberId}/badges/${userBadgeId}`, { method: 'DELETE' }),
    onSuccess: () => {
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['admin', 'userBadges', memberId] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao revogar selo.'),
  })

  const awarded = userBadgesQuery.data?.badges ?? []

  return (
    <Panel title="Selos por membro">
      <select
        aria-label="Selecionar membro"
        value={memberId}
        onChange={(event) => {
          setMemberId(event.target.value)
          setBadgeId('')
          setError(null)
        }}
        className={`${inputCls} mb-lg`}
      >
        <option value="">Selecione um membro…</option>
        {members.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
          </option>
        ))}
      </select>

      {memberId && (
        <>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (badgeId) grant.mutate()
            }}
            className="mb-lg flex flex-col gap-sm sm:flex-row"
          >
            <select
              aria-label="Selecionar selo"
              value={badgeId}
              onChange={(event) => setBadgeId(event.target.value)}
              className={`${inputCls} sm:flex-1`}
            >
              <option value="">Selecione um selo…</option>
              {badges.map((badge) => (
                <option key={badge.id} value={badge.id}>
                  {badge.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={!badgeId}
              className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container disabled:opacity-50"
            >
              Conceder
            </button>
          </form>

          {error && (
            <p role="alert" className="mb-md flex items-center gap-sm text-body-sm text-error">
              <Icon name="error" className="text-[16px]" />
              {error}
            </p>
          )}

          {awarded.length === 0 ? (
            <p className="text-body-sm text-on-surface-variant">Este membro ainda não tem selos.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {awarded.map((entry) => (
                <li key={entry.id} className="flex items-start gap-md rounded-lg border border-outline-variant/20 bg-surface-container-low p-md">
                  <BadgeEmblem badge={entry.badge} size={40} />
                  <div className="min-w-0 flex-grow">
                    <p className="font-label text-label-md text-on-surface">{entry.badge.name}</p>
                    <p className="mt-1 font-label text-label-sm text-on-surface-variant">
                      {entry.source === 'MANUAL' ? 'Manual' : 'Automático'}
                      {entry.awardedBy ? ` · por ${entry.awardedBy.name}` : ''}
                    </p>
                  </div>
                  {entry.source === 'MANUAL' && (
                    <button
                      onClick={() => revoke.mutate(entry.id)}
                      aria-label={`Revogar selo ${entry.badge.name}`}
                      className="shrink-0 rounded-md border border-error/40 p-1 text-error transition-colors hover:border-error"
                    >
                      <Icon name="delete" className="text-[18px]" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Panel>
  )
}
```

- [ ] **Step 5: Renderizar o painel**

Em `apps/web/src/pages/AdminPage.tsx`, no JSX retornado pela página, adicione o painel logo após o `</Panel>` do painel de Selos (após a linha 832, antes do comentário `{/* Categorias */}`):

```tsx
      <MemberBadgesPanel members={usersQuery.data?.users ?? []} badges={badges} />
```

(`usersQuery` e `badges` já existem no escopo — ver linhas 404 e 526.)

- [ ] **Step 6: Rodar o teste e confirmar que passa**

Run:
```bash
cd apps/web && pnpm test src/pages/AdminPage.test.tsx
```
Expected: PASS (o teste novo e os existentes).

- [ ] **Step 7: Checagem de tipos do frontend**

Run:
```bash
cd apps/web && pnpm exec tsc --noEmit
```
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/AdminPage.tsx apps/web/src/pages/AdminPage.test.tsx
git commit -m "feat(web): painel de selos por membro com conceder e revogar"
```

---

## Verificação final

- [ ] **Rodar a suíte completa de API e web**

Run:
```bash
cd /Users/luccasecco/Documents/projetos/engineering_legends && pnpm --filter @legends/api test && pnpm --filter @legends/web test
```
Expected: PASS em ambos.

- [ ] **Verificação manual (opcional)** — Subir API + web, logar como admin, abrir Admin → "Selos por membro", escolher um membro, conceder um selo, ver a etiqueta "Manual · por <admin>", revogar e confirmar que some.

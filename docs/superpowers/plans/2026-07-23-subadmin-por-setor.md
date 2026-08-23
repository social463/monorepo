# Subadmin por Setor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduzir o papel `SUBADMIN` — uma conta de gestão restrita a um único setor, capaz de ver/criar/editar apenas o que pertence ao próprio setor no painel admin, sem acesso a Setores, Auditoria, Escritório/Mapas, e sem poder de escalonar privilégio.

**Architecture:** `SUBADMIN` entra em `USER_ROLES` como um papel de gestão pura (mesmo tratamento de exclusão que `ADMIN` já recebe em squads/votação/retro/feedback). Um novo gate `requireAdminOrSubadmin` substitui `requireAdmin` nas ~9 áreas do admin que o Subadmin acessa; cada handler dessas áreas aplica um filtro `sectorId === request.user.sectorId` quando o papel é `SUBADMIN` (sem filtro para `ADMIN`). No frontend, `isAdmin` passa a reconhecer os dois papéis, uma guarda de rota separada mantém Setores/Auditoria/Escritório/Mapas exclusivos do `ADMIN`, e a sidebar/formulários escondem o que não se aplica ao Subadmin.

**Tech Stack:** Fastify + Prisma + PostgreSQL (apps/api), Vite + React + React Router (apps/web), Zod, Vitest.

## Global Constraints

- TypeScript strict, ESM puro; migrations geradas com `pnpm db:migrate`/`prisma migrate dev`, nunca editando uma já aplicada.
- Mensagens ao usuário em português.
- Testes Vitest colocados ao lado do código; a API testa contra Postgres real (`pnpm db:up` precisa estar de pé).
- Durante a implementação, rode só o(s) arquivo(s) de teste do que foi alterado; a suíte completa é a verificação final (último task).
- Subadmin é conta de gestão pura: nunca vota, não é elegível a voto, não entra em squad como membro/líder, não dá/recebe feedback como autor — mesmo tratamento que `ADMIN` já recebe nesses pontos.
- Subadmin **nunca** pode criar, promover ou editar uma conta `ADMIN`/`SUBADMIN` de qualquer setor — isso continua exclusivo do `ADMIN` global.
- Setores, Auditoria, Escritório e Mapas de escritório continuam 100% exclusivos do `ADMIN` global — sem rota nem UI para Subadmin.
- Quinta de Dev, Retrospectivas e Resenha (moderação de resenha) ficam acessíveis ao Subadmin **sem** particionamento por setor (mesmo dado que o ADMIN vê) — só a visibilidade da tela segue o `sectorFeatures` do próprio setor do Subadmin, igual já acontece hoje para qualquer usuário.
- Toda entidade nova criada por um Subadmin é forçada para o próprio setor, ignorando qualquer `sectorId`/escopo vindo do payload do cliente.

---

## Task 1: Papel `SUBADMIN` — enum, migration, gates de autenticação, exclusões

**Files:**
- Modify: `packages/shared/src/enums.ts` (`USER_ROLES`, `USER_ROLE_LABELS`)
- Modify: `apps/api/prisma/schema.prisma:10-17` (`enum UserRole`)
- Create: migration em `apps/api/prisma/migrations/`
- Modify: `apps/api/src/app.ts` (`requireAdmin`, novo `requireAdminOrSubadmin`, `requireFeature`)
- Modify: `apps/api/src/types/fastify.d.ts` (declaração do novo decorator)
- Modify: `apps/api/src/services/squad-service.ts:105`
- Modify: `apps/api/src/services/voting-service.ts:62`
- Modify: `apps/api/src/services/retro-service.ts:107`
- Modify: `apps/api/src/services/feedback-service.ts:105`
- Modify: `apps/api/src/services/development-thursday-service.ts:307`
- Modify: `apps/api/src/services/review-service.ts:87,189,262`
- Modify: `apps/api/src/routes/users.ts:14`
- Test: `apps/api/src/app.test.ts`, `apps/api/src/services/squad-service.test.ts`, `apps/api/src/services/voting-service.test.ts`, `apps/api/src/services/retro-service.test.ts` (ou o arquivo de teste de retro-service já existente), `apps/api/src/services/feedback-service.test.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores (task fundacional).
- Produces: `UserRole` inclui `'SUBADMIN'` em `@legends/shared` e no Prisma; `app.requireAdminOrSubadmin` (decorator Fastify, mesma assinatura de `requireAdmin`) — todas as tasks seguintes o utilizam nas rotas que o Subadmin acessa.

- [ ] **Step 1: Editar `packages/shared/src/enums.ts`**

Troque:

```ts
export const USER_ROLES = ['LEGEND', 'LEAD', 'MANAGER', 'HEAD', 'ADMIN', 'THIRD_PARTY'] as const
export type UserRole = (typeof USER_ROLES)[number]

// Rótulos em pt-BR para exibição dos papéis na UI. Fonte única (api + web).
export const USER_ROLE_LABELS: Record<UserRole, string> = {
  LEGEND: 'Lenda',
  LEAD: 'Líder',
  MANAGER: 'Gerente',
  HEAD: 'Head',
  ADMIN: 'Admin',
  THIRD_PARTY: 'Terceirizado',
}
```

por:

```ts
export const USER_ROLES = ['LEGEND', 'LEAD', 'MANAGER', 'HEAD', 'ADMIN', 'SUBADMIN', 'THIRD_PARTY'] as const
export type UserRole = (typeof USER_ROLES)[number]

// Rótulos em pt-BR para exibição dos papéis na UI. Fonte única (api + web).
export const USER_ROLE_LABELS: Record<UserRole, string> = {
  LEGEND: 'Lenda',
  LEAD: 'Líder',
  MANAGER: 'Gerente',
  HEAD: 'Head',
  ADMIN: 'Admin',
  SUBADMIN: 'Subadmin',
  THIRD_PARTY: 'Terceirizado',
}
```

- [ ] **Step 2: Editar o enum `UserRole` em `apps/api/prisma/schema.prisma:10-17`**

Troque:

```prisma
enum UserRole {
  LEGEND
  LEAD
  MANAGER
  HEAD
  ADMIN
  THIRD_PARTY
}
```

por:

```prisma
enum UserRole {
  LEGEND
  LEAD
  MANAGER
  HEAD
  ADMIN
  SUBADMIN
  THIRD_PARTY
}
```

- [ ] **Step 3: Gerar e aplicar a migration**

Com o Postgres local no ar (`pnpm db:up` se necessário):

```bash
pnpm --filter @legends/api exec prisma migrate dev --name add_subadmin_role
```

Expected: conclui com sucesso; novo diretório em `apps/api/prisma/migrations/<timestamp>_add_subadmin_role/` com `migration.sql` contendo `ALTER TYPE "UserRole" ADD VALUE 'SUBADMIN'`.

- [ ] **Step 4: Regenerar o Prisma Client**

```bash
pnpm db:generate
```

- [ ] **Step 5: Adicionar `requireAdminOrSubadmin` em `apps/api/src/app.ts`**

Logo após a definição de `requireAdmin`, adicione:

```ts
  app.decorate('requireAdminOrSubadmin', async function (request, reply) {
    if (request.user.role !== 'ADMIN' && request.user.role !== 'SUBADMIN') {
      return reply.code(403).send({ message: 'Acesso restrito a administradores' })
    }
  })
```

E troque o bypass de `requireFeature`:

```ts
  app.decorate('requireFeature', function (key: string) {
    return async function (request, reply) {
      if (request.user.role === 'ADMIN') return
      const features = request.user.features ?? []
      if (!features.includes(key)) {
        return reply.code(403).send({ message: 'Acesso não liberado para este usuário' })
      }
    }
  })
```

por:

```ts
  app.decorate('requireFeature', function (key: string) {
    return async function (request, reply) {
      if (request.user.role === 'ADMIN' || request.user.role === 'SUBADMIN') return
      const features = request.user.features ?? []
      if (!features.includes(key)) {
        return reply.code(403).send({ message: 'Acesso não liberado para este usuário' })
      }
    }
  })
```

- [ ] **Step 6: Declarar o novo decorator em `apps/api/src/types/fastify.d.ts`**

Troque:

```ts
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireFeature: (key: string) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
```

por:

```ts
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireAdminOrSubadmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireFeature: (key: string) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
```

- [ ] **Step 7: Escrever o teste que falha — `requireAdminOrSubadmin` e `requireFeature`**

Em `apps/api/src/app.test.ts`, leia o arquivo primeiro para confirmar o padrão de teste já usado (provavelmente monta o app e injeta requests). Adicione:

```ts
  it('requireFeature libera SUBADMIN mesmo sem a feature na lista', async () => {
    const app = buildApp()
    await app.ready()
    const sub = await prisma.user.create({ data: { name: 'Sub', email: 'sub-feature@x.com', passwordHash: 'x', role: 'SUBADMIN' } })
    const token = app.jwt.sign({ sub: sub.id, role: 'SUBADMIN', sectorId: 'sector-dev-produto', features: [] })
    const res = await app.inject({ method: 'GET', url: '/badges', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).not.toBe(403)
    await app.close()
  })
```

(ajuste os imports/setup necessários — `prisma`, `buildApp` — para bater com o resto do arquivo.)

- [ ] **Step 8: Rodar e confirmar que falha, depois passa**

```bash
pnpm --filter @legends/api exec vitest run src/app.test.ts
```

Expected: FAIL antes do Step 5, PASS depois.

- [ ] **Step 9: Extender as exclusões de `ADMIN` para `SUBADMIN` nos 6 pontos que EXCLUEM administradores da vida normal de colaborador**

Estes são pontos onde `ADMIN` é impedido de participar (votar, entrar em squad, dar feedback, etc.) — Subadmin recebe o mesmo tratamento, por ser também conta de gestão pura. **Não confunda com os pontos do Step 10**, que são checagens de PODER DE SOBRESCRITA (ADMIN vê/apaga qualquer conteúdo de qualquer um) — esses ficam como estão, exclusivos do ADMIN global (dar esse poder ao Subadmin vazaria visibilidade cross-setor).

`apps/api/src/services/squad-service.ts:105` — troque:

```ts
  if (user.role === 'ADMIN') throw new SquadError('Administradores não entram em squads.', 400)
```

por:

```ts
  if (user.role === 'ADMIN' || user.role === 'SUBADMIN') throw new SquadError('Administradores não entram em squads.', 400)
```

`apps/api/src/services/voting-service.ts:62` — troque:

```ts
  if (voter.role === 'ADMIN') {
```

por:

```ts
  if (voter.role === 'ADMIN' || voter.role === 'SUBADMIN') {
```

`apps/api/src/services/retro-service.ts:107` — troque:

```ts
  if (users.some((u) => u.role === 'ADMIN')) throw new RetroError('Administradores não participam de retrospectivas.', 400)
```

por:

```ts
  if (users.some((u) => u.role === 'ADMIN' || u.role === 'SUBADMIN')) throw new RetroError('Administradores não participam de retrospectivas.', 400)
```

`apps/api/src/services/feedback-service.ts:105` (dar feedback) — troque:

```ts
  if (author.role === 'ADMIN') {
    throw new FeedbackError('Administradores não deixam feedback.', 403)
  }
```

por:

```ts
  if (author.role === 'ADMIN' || author.role === 'SUBADMIN') {
    throw new FeedbackError('Administradores não deixam feedback.', 403)
  }
```

`apps/api/src/services/development-thursday-service.ts:307` (lista de destinatários de notificação) — troque:

```ts
    where: { active: true, role: { not: 'ADMIN' } },
```

por:

```ts
    where: { active: true, role: { notIn: ['ADMIN', 'SUBADMIN'] } },
```

`apps/api/src/services/review-service.ts:87` (elegibilidade de menção) — troque:

```ts
    where: { id: { in: unique }, active: true, role: { not: 'ADMIN' } },
```

por:

```ts
    where: { id: { in: unique }, active: true, role: { notIn: ['ADMIN', 'SUBADMIN'] } },
```

`apps/api/src/routes/users.ts:14` (listagem geral, ex.: busca de colega) — troque:

```ts
      where: { active: true, role: { not: 'ADMIN' }, id: { not: request.user.sub } },
```

por:

```ts
      where: { active: true, role: { notIn: ['ADMIN', 'SUBADMIN'] }, id: { not: request.user.sub } },
```

- [ ] **Step 10: Extender o PODER DE SOBRESCRITA do ADMIN para SUBADMIN em `review-service.ts` — só nas duas rotas de moderação de Resenha (sem particionamento por setor, conforme decisão do spec)**

`apps/api/src/services/review-service.ts:189` (excluir resenha de outro autor) — troque:

```ts
  if (existing.authorId !== input.userId && input.role !== 'ADMIN') {
    throw new ReviewError('Sem permissão para excluir esta resenha.', 403)
  }
```

por:

```ts
  if (existing.authorId !== input.userId && input.role !== 'ADMIN' && input.role !== 'SUBADMIN') {
    throw new ReviewError('Sem permissão para excluir esta resenha.', 403)
  }
```

`apps/api/src/services/review-service.ts:262` (mesma checagem, provavelmente em `deleteComment` — leia a função ao redor da linha antes de editar para confirmar o contexto) — mesma troca: `input.role !== 'ADMIN'` → `input.role !== 'ADMIN' && input.role !== 'SUBADMIN'`.

**Não mexa** em `apps/api/src/services/feedback-service.ts:41,68,170,190` — esses controlam visibilidade de feedback privado (fora do escopo desta spec; Subadmin não ganha esse poder de sobrescrita).

- [ ] **Step 11: Rodar os testes dos serviços tocados**

```bash
pnpm --filter @legends/api exec vitest run src/services/squad-service.test.ts src/services/voting-service.test.ts src/services/feedback-service.test.ts
```

Leia os arquivos de teste de `retro-service` e `review-service` (`ls apps/api/src/services/retro-service.test.ts apps/api/src/services/review-service.test.ts` — confirme os nomes exatos) e rode-os também. Adicione um teste por exclusão alterada, seguindo o padrão já usado no arquivo (ex.: criar um usuário `SUBADMIN` e confirmar que `createVote`/`addMember`/`giveFeedback` rejeita com o mesmo erro que já existe para `ADMIN`).

Expected: PASS em todos, incluindo os novos casos.

- [ ] **Step 12: Commit**

```bash
git add packages/shared/src/enums.ts apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/src/app.ts apps/api/src/app.test.ts apps/api/src/types/fastify.d.ts apps/api/src/services/squad-service.ts apps/api/src/services/squad-service.test.ts apps/api/src/services/voting-service.ts apps/api/src/services/voting-service.test.ts apps/api/src/services/retro-service.ts apps/api/src/services/retro-service.test.ts apps/api/src/services/feedback-service.ts apps/api/src/services/feedback-service.test.ts apps/api/src/services/development-thursday-service.ts apps/api/src/services/review-service.ts apps/api/src/services/review-service.test.ts apps/api/src/routes/users.ts
git commit -m "feat(api): papel SUBADMIN — gates de autenticação e exclusões"
```

---

## Task 2: `ThirdPartyInvite` ganha `sectorId`

**Files:**
- Modify: `apps/api/prisma/schema.prisma` (model `ThirdPartyInvite`)
- Modify: `apps/api/src/services/third-party-invite-service.ts` (`createThirdPartyInvite`, `acceptThirdPartyInvite`)
- Test: `apps/api/src/services/third-party-invite-service.test.ts`

**Interfaces:**
- Consumes: nenhuma de tasks anteriores.
- Produces: `createThirdPartyInvite(createdById: string, expiresInMinutes: number, enabledFeatures: FeatureKey[], sectorId: string)` — o novo parâmetro `sectorId` é obrigatório e vem por último; `acceptThirdPartyInvite` passa a gravar `sectorId: invite.sectorId` no `User` criado. Task 7 depende dessa mudança.

- [ ] **Step 1: Editar o model `ThirdPartyInvite`**

Troque:

```prisma
model ThirdPartyInvite {
  id              String    @id @default(cuid())
  tokenHash       String    @unique
  createdById     String
  createdBy       User      @relation("ThirdPartyInvitesCreated", fields: [createdById], references: [id])
  enabledFeatures Json      @default("[]")
  expiresAt       DateTime
  usedAt          DateTime?
  revokedAt       DateTime?
  createdAt       DateTime  @default(now())
}
```

por:

```prisma
model ThirdPartyInvite {
  id              String    @id @default(cuid())
  tokenHash       String    @unique
  createdById     String
  createdBy       User      @relation("ThirdPartyInvitesCreated", fields: [createdById], references: [id])
  enabledFeatures Json      @default("[]")
  sectorId        String    @default("sector-dev-produto")
  expiresAt       DateTime
  usedAt          DateTime?
  revokedAt       DateTime?
  createdAt       DateTime  @default(now())

  sector Sector @relation(fields: [sectorId], references: [id])

  @@index([sectorId])
}
```

E adicione a relação inversa no model `Sector` — troque:

```prisma
  users           User[]
  roles           SectorRole[]
  votingPeriods   VotingPeriod[]
  squads          Squad[]
  categorySectors CategorySector[]
  badgeSectors    BadgeSector[]
}
```

por:

```prisma
  users             User[]
  roles             SectorRole[]
  votingPeriods     VotingPeriod[]
  squads            Squad[]
  categorySectors   CategorySector[]
  badgeSectors      BadgeSector[]
  thirdPartyInvites ThirdPartyInvite[]
}
```

- [ ] **Step 2: Gerar e aplicar a migration**

```bash
pnpm --filter @legends/api exec prisma migrate dev --name add_third_party_invite_sector
pnpm db:generate
```

- [ ] **Step 3: Escrever o teste que falha**

Leia `apps/api/src/services/third-party-invite-service.test.ts` primeiro para confirmar o padrão de setup já usado. Adicione:

```ts
  it('cria convite com sectorId informado, e a conta aceita herda esse setor', async () => {
    const admin = await mkUser('ADMIN', 'Admin1')
    const otherSector = await prisma.sector.create({ data: { name: 'Comercial', slug: 'comercial-invite-test', enabledFeatures: [] } })
    const { invite, rawToken } = await createThirdPartyInvite(admin.id, 60, ['escritorio'], otherSector.id)
    expect(invite.sectorId).toBe(otherSector.id)

    const { user } = await acceptThirdPartyInvite(app, { token: rawToken, name: 'Terceiro', email: 'terceiro@x.com', password: 'changeme123' })
    expect(user.sectorId).toBe(otherSector.id)
  })
```

(ajuste `mkUser`/`app` para os helpers já existentes no arquivo — leia o topo do arquivo antes de escrever.)

- [ ] **Step 4: Rodar e confirmar que falha**

```bash
pnpm --filter @legends/api exec vitest run src/services/third-party-invite-service.test.ts
```

Expected: FAIL — `createThirdPartyInvite` ainda não aceita `sectorId`.

- [ ] **Step 5: Editar `createThirdPartyInvite`**

Troque:

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

por:

```ts
export async function createThirdPartyInvite(
  createdById: string,
  expiresInMinutes: number,
  enabledFeatures: FeatureKey[],
  sectorId: string,
) {
  const duration = clampDuration(Math.floor(expiresInMinutes))
  const rawToken = newRawToken()
  const expiresAt = new Date(Date.now() + duration * 60_000)
  const invite = await prisma.thirdPartyInvite.create({
    data: {
      tokenHash: hashThirdPartyInviteToken(rawToken),
      createdById,
      enabledFeatures,
      sectorId,
      expiresAt,
    },
  })
  await recordAuditLog({ actorId: createdById, entityType: 'ThirdPartyInvite', entityId: invite.id, action: 'CREATE', after: invite })
  return { invite, rawToken }
}
```

- [ ] **Step 6: Editar `acceptThirdPartyInvite` para gravar o `sectorId` herdado do convite**

Troque:

```ts
      created = await tx.user.create({
        data: {
          name: input.name,
          email: input.email,
          passwordHash,
          role: 'THIRD_PARTY',
          enabledFeatures: invite.enabledFeatures as FeatureKey[],
```

por:

```ts
      created = await tx.user.create({
        data: {
          name: input.name,
          email: input.email,
          passwordHash,
          role: 'THIRD_PARTY',
          enabledFeatures: invite.enabledFeatures as FeatureKey[],
          sectorId: invite.sectorId,
```

- [ ] **Step 7: Rodar de novo e confirmar que passa**

```bash
pnpm --filter @legends/api exec vitest run src/services/third-party-invite-service.test.ts
```

Expected: PASS (todos os testes do arquivo, incluindo o novo).

- [ ] **Step 8: Rodar o typecheck da API (o chamador em `third-party-invites.ts` ainda não passa `sectorId` — isso é esperado, corrigido na Task 7)**

```bash
pnpm --filter @legends/api exec tsc --noEmit
```

Expected: erro em `third-party-invites.ts` na chamada de `createThirdPartyInvite` (faltando o 4º argumento) — normal neste ponto, será corrigido na Task 7.

- [ ] **Step 9: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/src/services/third-party-invite-service.ts apps/api/src/services/third-party-invite-service.test.ts
git commit -m "feat(api): ThirdPartyInvite ganha sectorId"
```

---

## Task 3: Lendas — `/admin/users` restrito ao setor do Subadmin

**Files:**
- Modify: `apps/api/src/routes/admin.ts` (`adminOnly` → novo `adminOrSubadmin` nas rotas de usuários; `GET/POST/PATCH /admin/users`)
- Test: `apps/api/src/routes/admin.test.ts`

**Interfaces:**
- Consumes: `requireAdminOrSubadmin` (Task 1).
- Produces: `const adminOrSubadmin = { onRequest: [app.authenticate, app.requireAdminOrSubadmin] }`, declarado uma vez no topo de `adminRoutes` — as próximas tasks (4-8) reusam essa MESMA constante (não redeclarar).

- [ ] **Step 1: Declarar `adminOrSubadmin` logo abaixo de `adminOnly`, no topo de `adminRoutes`**

Troque:

```ts
export async function adminRoutes(app: FastifyInstance) {
  const adminOnly = { onRequest: [app.authenticate, app.requireAdmin] }
```

por:

```ts
export async function adminRoutes(app: FastifyInstance) {
  const adminOnly = { onRequest: [app.authenticate, app.requireAdmin] }
  const adminOrSubadmin = { onRequest: [app.authenticate, app.requireAdminOrSubadmin] }
```

- [ ] **Step 2: Escrever o teste que falha — isolamento de setor em Lendas**

Em `apps/api/src/routes/admin.test.ts`, leia o helper `adminToken`/`devToken` já existente no topo e adicione um helper análogo para Subadmin:

```ts
async function subadminToken(app: ReturnType<typeof buildApp>, sectorId: string) {
  const email = `subadmin-${sectorId}@empresa.com`
  await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Subadmin', email, password: 'changeme123' } })
  await prisma.user.update({ where: { email }, data: { role: 'SUBADMIN', sectorId } })
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'changeme123' } })
  return res.json().accessToken as string
}
```

Adicione o teste:

```ts
  it('Subadmin só vê/cria/edita lendas do próprio setor', async () => {
    const app = buildApp()
    await app.ready()
    const sectorA = await prisma.sector.create({ data: { name: 'Setor A Lendas', slug: 'setor-a-lendas', enabledFeatures: [], roles: { create: [{ role: 'LEGEND' }] } } })
    const sectorB = await prisma.sector.create({ data: { name: 'Setor B Lendas', slug: 'setor-b-lendas', enabledFeatures: [], roles: { create: [{ role: 'LEGEND' }] } } })
    const token = await subadminToken(app, sectorA.id)
    const userA = await prisma.user.create({ data: { name: 'Dev A', email: 'dev-a-lendas@x.com', passwordHash: 'x', sectorId: sectorA.id } })
    const userB = await prisma.user.create({ data: { name: 'Dev B', email: 'dev-b-lendas@x.com', passwordHash: 'x', sectorId: sectorB.id } })

    const list = await app.inject({ method: 'GET', url: '/admin/users', headers: { authorization: `Bearer ${token}` } })
    const names = list.json().users.map((u: { name: string }) => u.name)
    expect(names).toContain('Dev A')
    expect(names).not.toContain('Dev B')

    const created = await app.inject({
      method: 'POST', url: '/admin/users',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Novo Dev', email: 'novo-dev-lendas@x.com', password: 'changeme123', sectorId: sectorB.id },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().user.sectorId).toBe(sectorA.id) // ignora o sectorId do payload, força o próprio

    const editOther = await app.inject({
      method: 'PATCH', url: `/admin/users/${userB.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Tentativa' },
    })
    expect(editOther.statusCode).toBe(404)
    await app.close()
  })

  it('Subadmin não consegue criar ou promover para ADMIN/SUBADMIN', async () => {
    const app = buildApp()
    await app.ready()
    const sector = await prisma.sector.create({ data: { name: 'Setor Escalada', slug: 'setor-escalada', enabledFeatures: [], roles: { create: [{ role: 'LEGEND' }] } } })
    const token = await subadminToken(app, sector.id)

    const created = await app.inject({
      method: 'POST', url: '/admin/users',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'X', email: 'escalada@x.com', password: 'changeme123', role: 'ADMIN' },
    })
    expect(created.statusCode).toBe(400)

    const otherDev = await prisma.user.create({ data: { name: 'Dev C', email: 'dev-c-escalada@x.com', passwordHash: 'x', sectorId: sector.id } })
    const promoted = await app.inject({
      method: 'PATCH', url: `/admin/users/${otherDev.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { role: 'SUBADMIN' },
    })
    expect(promoted.statusCode).toBe(400)
    await app.close()
  })
```

- [ ] **Step 3: Rodar e confirmar que falha**

```bash
pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts -t "Subadmin"
```

Expected: FAIL — as rotas ainda usam `adminOnly` puro (403 pra SUBADMIN) e não filtram por setor.

- [ ] **Step 4: Editar `GET/POST/PATCH /admin/users`**

Troque:

```ts
  app.get('/admin/users', adminOnly, async (_request, reply) => {
    // Só desenvolvedores: admins e terceirizados não são gerenciados como colaboradores.
    const users = await prisma.user.findMany({ where: { role: { notIn: ['ADMIN', 'THIRD_PARTY'] } }, orderBy: { name: 'asc' } })
    return reply.send({ users: users.map(toAdminUser) })
  })
```

por:

```ts
  app.get('/admin/users', adminOrSubadmin, async (request, reply) => {
    // Só desenvolvedores: admins e terceirizados não são gerenciados como colaboradores.
    const isSubadmin = request.user.role === 'SUBADMIN'
    const users = await prisma.user.findMany({
      where: {
        role: { notIn: ['ADMIN', 'SUBADMIN', 'THIRD_PARTY'] },
        ...(isSubadmin ? { sectorId: request.user.sectorId } : {}),
      },
      orderBy: { name: 'asc' },
    })
    return reply.send({ users: users.map(toAdminUser) })
  })
```

Troque:

```ts
  app.post('/admin/users', adminOnly, async (request, reply) => {
    const parsed = createUserSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.flatten() })
    }
    const sectorId = parsed.data.sectorId ?? DEFAULT_SECTOR_ID
    const effectiveRole = parsed.data.role ?? 'LEGEND'
    const sector = await prisma.sector.findUnique({ where: { id: sectorId }, include: { roles: true } })
    if (!sector) return reply.code(400).send({ message: 'Setor inválido.' })
    if (!sector.roles.some((r) => r.role === effectiveRole)) {
      return reply.code(400).send({ message: 'Esse papel não está habilitado para o setor selecionado.' })
    }
```

por:

```ts
  app.post('/admin/users', adminOrSubadmin, async (request, reply) => {
    const parsed = createUserSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.flatten() })
    }
    const isSubadmin = request.user.role === 'SUBADMIN'
    if (isSubadmin && (parsed.data.role === 'ADMIN' || parsed.data.role === 'SUBADMIN')) {
      return reply.code(400).send({ message: 'Subadmin não pode criar contas Admin ou Subadmin.' })
    }
    const sectorId = isSubadmin ? request.user.sectorId : (parsed.data.sectorId ?? DEFAULT_SECTOR_ID)
    const effectiveRole = parsed.data.role ?? 'LEGEND'
    const sector = await prisma.sector.findUnique({ where: { id: sectorId }, include: { roles: true } })
    if (!sector) return reply.code(400).send({ message: 'Setor inválido.' })
    if (!sector.roles.some((r) => r.role === effectiveRole)) {
      return reply.code(400).send({ message: 'Esse papel não está habilitado para o setor selecionado.' })
    }
```

Troque:

```ts
  app.patch('/admin/users/:id', adminOnly, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = updateUserSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos' })
    }
    // Um admin não pode remover o próprio papel de administrador (evita se trancar pra fora).
    if (parsed.data.role && parsed.data.role !== 'ADMIN' && id === request.user.sub) {
      return reply.code(400).send({ message: 'Você não pode remover seu próprio papel de administrador.' })
    }
    const existing = await prisma.user.findUnique({ where: { id } })
    if (!existing) {
      return reply.code(404).send({ message: 'Usuário não encontrado' })
    }
```

por:

```ts
  app.patch('/admin/users/:id', adminOrSubadmin, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = updateUserSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos' })
    }
    const isSubadmin = request.user.role === 'SUBADMIN'
    // Um admin não pode remover o próprio papel de administrador (evita se trancar pra fora).
    if (parsed.data.role && parsed.data.role !== 'ADMIN' && id === request.user.sub) {
      return reply.code(400).send({ message: 'Você não pode remover seu próprio papel de administrador.' })
    }
    if (isSubadmin && (parsed.data.role === 'ADMIN' || parsed.data.role === 'SUBADMIN')) {
      return reply.code(400).send({ message: 'Subadmin não pode promover para Admin ou Subadmin.' })
    }
    if (isSubadmin && parsed.data.sectorId !== undefined && parsed.data.sectorId !== request.user.sectorId) {
      return reply.code(400).send({ message: 'Subadmin não pode mover um colaborador para outro setor.' })
    }
    const existing = await prisma.user.findUnique({ where: { id } })
    if (!existing) {
      return reply.code(404).send({ message: 'Usuário não encontrado' })
    }
    if (isSubadmin && (existing.sectorId !== request.user.sectorId || existing.role === 'ADMIN' || existing.role === 'SUBADMIN')) {
      return reply.code(404).send({ message: 'Usuário não encontrado' })
    }
```

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts -t "Subadmin"
```

Expected: PASS (os dois testes novos).

- [ ] **Step 6: Rodar a suíte inteira de `admin.test.ts` (garante que as rotas de usuário continuam corretas para ADMIN)**

```bash
pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts
```

Expected: PASS (todos os testes do arquivo).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/src/routes/admin.test.ts
git commit -m "feat(api): Lendas restrito ao setor do Subadmin"
```

---

## Task 4: Squads restrito ao setor do Subadmin

**Files:**
- Modify: `apps/api/src/routes/admin.ts` (`GET/POST/PATCH /admin/squads*`)
- Test: `apps/api/src/routes/admin.test.ts`

**Interfaces:**
- Consumes: `adminOrSubadmin` (Task 3), `subadminToken(app, sectorId)` helper (Task 3, já no arquivo de teste).
- Produces: nenhuma nova, só comportamento de rota.

- [ ] **Step 1: Escrever o teste que falha**

```ts
  it('Subadmin só vê/cria/edita squads do próprio setor', async () => {
    const app = buildApp()
    await app.ready()
    const sectorA = await prisma.sector.create({ data: { name: 'Setor A Squad', slug: 'setor-a-squad', enabledFeatures: [] } })
    const sectorB = await prisma.sector.create({ data: { name: 'Setor B Squad', slug: 'setor-b-squad', enabledFeatures: [] } })
    const token = await subadminToken(app, sectorA.id)
    const squadB = await prisma.squad.create({ data: { name: 'Squad B', slug: 'squad-b-scope', sectorId: sectorB.id } })

    const list = await app.inject({ method: 'GET', url: '/admin/squads', headers: { authorization: `Bearer ${token}` } })
    const names = list.json().squads.map((s: { name: string }) => s.name)
    expect(names).not.toContain('Squad B')

    const created = await app.inject({
      method: 'POST', url: '/admin/squads',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Squad Nova Subadmin', sectorId: sectorB.id },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().squad.sectorId).toBe(sectorA.id) // ignora sectorId do payload

    const editOther = await app.inject({
      method: 'PATCH', url: `/admin/squads/${squadB.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Tentativa' },
    })
    expect(editOther.statusCode).toBe(404)
    await app.close()
  })
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts -t "Squads do próprio setor"
```

- [ ] **Step 3: Editar `GET/POST/PATCH /admin/squads*`**

Troque:

```ts
  app.get('/admin/squads', adminOnly, async (_request, reply) => {
    const squads = await listSquads()
    return reply.send({ squads: squads.map(toSquadWithMembersDTO) })
  })
```

por:

```ts
  app.get('/admin/squads', adminOrSubadmin, async (request, reply) => {
    const squads = await listSquads()
    const scoped = request.user.role === 'SUBADMIN' ? squads.filter((s) => s.sectorId === request.user.sectorId) : squads
    return reply.send({ squads: scoped.map(toSquadWithMembersDTO) })
  })
```

Troque:

```ts
  app.post('/admin/squads', adminOnly, async (request, reply) => {
    const parsed = createSquadSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos' })
    try {
      const squad = await createSquad(parsed.data, request.user.sub)
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
      const squad = await updateSquad(id, parsed.data, request.user.sub)
      return reply.send({ squad: toSquadWithMembersDTO(squad) })
    } catch (err) {
      if (err instanceof SquadError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
```

por:

```ts
  app.post('/admin/squads', adminOrSubadmin, async (request, reply) => {
    const parsed = createSquadSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos' })
    const input = request.user.role === 'SUBADMIN' ? { ...parsed.data, sectorId: request.user.sectorId } : parsed.data
    try {
      const squad = await createSquad(input, request.user.sub)
      return reply.code(201).send({ squad: toSquadWithMembersDTO(squad) })
    } catch (err) {
      if (err instanceof SquadError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.patch('/admin/squads/:id', adminOrSubadmin, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = updateSquadSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos' })
    if (request.user.role === 'SUBADMIN') {
      const existing = await prisma.squad.findUnique({ where: { id } })
      if (!existing || existing.sectorId !== request.user.sectorId) {
        return reply.code(404).send({ message: 'Squad não encontrada.' })
      }
      if (parsed.data.sectorId !== undefined && parsed.data.sectorId !== request.user.sectorId) {
        return reply.code(400).send({ message: 'Subadmin não pode mover uma squad para outro setor.' })
      }
    }
    try {
      const squad = await updateSquad(id, parsed.data, request.user.sub)
      return reply.send({ squad: toSquadWithMembersDTO(squad) })
    } catch (err) {
      if (err instanceof SquadError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
```

Troque (adicionar/remover membro — precisa checar que a squad é do setor do Subadmin antes de delegar):

```ts
  app.post('/admin/squads/:id/members', adminOnly, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = addSquadMemberSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos' })
    try {
      const squad = await addMember(id, parsed.data.userId, request.user.sub)
      return reply.code(201).send({ squad: toSquadWithMembersDTO(squad) })
    } catch (err) {
      if (err instanceof SquadError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/admin/squads/:id/members/:userId', adminOnly, async (request, reply) => {
    const { id, userId } = request.params as { id: string; userId: string }
    await removeMember(id, userId, request.user.sub)
    return reply.code(204).send()
  })
```

por:

```ts
  app.post('/admin/squads/:id/members', adminOrSubadmin, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = addSquadMemberSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Dados inválidos' })
    if (request.user.role === 'SUBADMIN') {
      const existing = await prisma.squad.findUnique({ where: { id } })
      if (!existing || existing.sectorId !== request.user.sectorId) {
        return reply.code(404).send({ message: 'Squad não encontrada.' })
      }
    }
    try {
      const squad = await addMember(id, parsed.data.userId, request.user.sub)
      return reply.code(201).send({ squad: toSquadWithMembersDTO(squad) })
    } catch (err) {
      if (err instanceof SquadError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/admin/squads/:id/members/:userId', adminOrSubadmin, async (request, reply) => {
    const { id, userId } = request.params as { id: string; userId: string }
    if (request.user.role === 'SUBADMIN') {
      const existing = await prisma.squad.findUnique({ where: { id } })
      if (!existing || existing.sectorId !== request.user.sectorId) {
        return reply.code(404).send({ message: 'Squad não encontrada.' })
      }
    }
    await removeMember(id, userId, request.user.sub)
    return reply.code(204).send()
  })
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts -t "Squads do próprio setor"
```

- [ ] **Step 5: Rodar a suíte inteira de `admin.test.ts`**

```bash
pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts
```

Expected: PASS (todos).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/src/routes/admin.test.ts
git commit -m "feat(api): Squads restrito ao setor do Subadmin"
```

---

## Task 5: Períodos e Destaque restrito ao setor do Subadmin

**Files:**
- Modify: `apps/api/src/routes/admin.ts` (`GET/POST/PATCH /admin/periods*`, `POST /admin/periods/:id/close`, os 3 handlers de `highlight`)
- Test: `apps/api/src/routes/admin.test.ts`

**Interfaces:**
- Consumes: `adminOrSubadmin`, `subadminToken` (Tasks 3-4).
- Produces: nenhuma nova.

- [ ] **Step 1: Escrever o teste que falha**

```ts
  it('Subadmin só vê/agenda/edita períodos do próprio setor', async () => {
    const app = buildApp()
    await app.ready()
    const sectorA = await prisma.sector.create({ data: { name: 'Setor A Período', slug: 'setor-a-periodo', enabledFeatures: [] } })
    const sectorB = await prisma.sector.create({ data: { name: 'Setor B Período', slug: 'setor-b-periodo', enabledFeatures: [] } })
    const token = await subadminToken(app, sectorA.id)
    const periodB = await prisma.votingPeriod.create({
      data: { sectorId: sectorB.id, monthRef: '2026-08', startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 2 * 86400000), status: 'OPEN' },
    })

    // ?sectorId= de outro setor é ignorado, sempre volta só o próprio.
    const list = await app.inject({ method: 'GET', url: `/admin/periods?sectorId=${sectorB.id}`, headers: { authorization: `Bearer ${token}` } })
    const monthRefs = list.json().periods.map((p: { monthRef: string }) => p.monthRef)
    expect(monthRefs).not.toContain('2026-08')

    const created = await app.inject({
      method: 'POST', url: '/admin/periods',
      headers: { authorization: `Bearer ${token}` },
      payload: { monthRef: '2026-09', startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: new Date(Date.now() + 2 * 86400000).toISOString(), sectorId: sectorB.id },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().period.sectorId).toBe(sectorA.id)

    const editOther = await app.inject({
      method: 'PATCH', url: `/admin/periods/${periodB.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: new Date(Date.now() + 3 * 86400000).toISOString() },
    })
    expect(editOther.statusCode).toBe(404)
    await app.close()
  })
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts -t "Períodos do próprio setor"
```

- [ ] **Step 3: Editar `GET/POST /admin/periods`**

Troque:

```ts
  app.get('/admin/periods', adminOnly, async (request, reply) => {
    const { sectorId } = request.query as { sectorId?: string }
    const periods = await prisma.votingPeriod.findMany({
      where: sectorId ? { sectorId } : undefined,
      orderBy: { startsAt: 'desc' },
    })
    return reply.send({ periods: periods.map((p) => toPeriodDTO(p)) })
  })

  app.post('/admin/periods', adminOnly, async (request, reply) => {
    const parsed = schedulePeriodSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos (use monthRef YYYY-MM, startsAt e endsAt)' })
    }
    const { monthRef, startsAt, endsAt } = parsed.data
    const sectorId = parsed.data.sectorId ?? DEFAULT_SECTOR_ID
    const invalid = windowError(startsAt, endsAt)
```

por:

```ts
  app.get('/admin/periods', adminOrSubadmin, async (request, reply) => {
    const { sectorId: queryScope } = request.query as { sectorId?: string }
    const sectorId = request.user.role === 'SUBADMIN' ? request.user.sectorId : queryScope
    const periods = await prisma.votingPeriod.findMany({
      where: sectorId ? { sectorId } : undefined,
      orderBy: { startsAt: 'desc' },
    })
    return reply.send({ periods: periods.map((p) => toPeriodDTO(p)) })
  })

  app.post('/admin/periods', adminOrSubadmin, async (request, reply) => {
    const parsed = schedulePeriodSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos (use monthRef YYYY-MM, startsAt e endsAt)' })
    }
    const { monthRef, startsAt, endsAt } = parsed.data
    const sectorId = request.user.role === 'SUBADMIN' ? request.user.sectorId : (parsed.data.sectorId ?? DEFAULT_SECTOR_ID)
    const invalid = windowError(startsAt, endsAt)
```

- [ ] **Step 4: Editar `PATCH /admin/periods/:id`, `POST /admin/periods/:id/close`, e os 3 handlers de highlight — adicionar a mesma checagem de propriedade antes de delegar**

Troque:

```ts
  app.patch('/admin/periods/:id', adminOnly, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = periodWindowSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos (use startsAt e endsAt)' })
    }
    const existing = await prisma.votingPeriod.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ message: 'Período não encontrado' })
```

por:

```ts
  app.patch('/admin/periods/:id', adminOrSubadmin, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = periodWindowSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos (use startsAt e endsAt)' })
    }
    const existing = await prisma.votingPeriod.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ message: 'Período não encontrado' })
    if (request.user.role === 'SUBADMIN' && existing.sectorId !== request.user.sectorId) {
      return reply.code(404).send({ message: 'Período não encontrado' })
    }
```

Troque:

```ts
  app.post('/admin/periods/:id/close', adminOnly, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const period = await closeVotingPeriod(id, request.user.sub)
```

por:

```ts
  app.post('/admin/periods/:id/close', adminOrSubadmin, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (request.user.role === 'SUBADMIN') {
      const existing = await prisma.votingPeriod.findUnique({ where: { id } })
      if (!existing || existing.sectorId !== request.user.sectorId) {
        return reply.code(404).send({ message: 'Período não encontrado' })
      }
    }
    try {
      const period = await closeVotingPeriod(id, request.user.sub)
```

Troque cada um dos três handlers de highlight (`GET/POST/PATCH .../highlight` e `POST .../highlight/publish`), no mesmo padrão — para `GET /admin/periods/:id/highlight`:

```ts
  app.get('/admin/periods/:id/highlight', adminOnly, async (request, reply) => {
    const { id } = request.params as { id: string }
    const period = await prisma.votingPeriod.findUnique({ where: { id } })
    if (!period) return reply.code(404).send({ message: 'Período não encontrado' })
```

por:

```ts
  app.get('/admin/periods/:id/highlight', adminOrSubadmin, async (request, reply) => {
    const { id } = request.params as { id: string }
    const period = await prisma.votingPeriod.findUnique({ where: { id } })
    if (!period) return reply.code(404).send({ message: 'Período não encontrado' })
    if (request.user.role === 'SUBADMIN' && period.sectorId !== request.user.sectorId) {
      return reply.code(404).send({ message: 'Período não encontrado' })
    }
```

Para `POST /admin/periods/:id/highlight`, `PATCH /admin/periods/:id/highlight`, e `POST /admin/periods/:id/highlight/publish` (todos delegam pra `generateHighlightDraft`/`updateHighlightText`/`publishHighlight`, que já recebem só o `id`) — adicione a MESMA checagem logo no início de cada handler, antes do `try`:

```ts
    if (request.user.role === 'SUBADMIN') {
      const period = await prisma.votingPeriod.findUnique({ where: { id } })
      if (!period || period.sectorId !== request.user.sectorId) {
        return reply.code(404).send({ message: 'Período não encontrado' })
      }
    }
```

(troque só `adminOnly` → `adminOrSubadmin` na assinatura de registro desses 3 handlers, e insira o bloco acima logo após a linha `const { id } = request.params as { id: string }` em cada um.)

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts -t "Períodos do próprio setor"
```

- [ ] **Step 6: Rodar a suíte inteira de `admin.test.ts`**

```bash
pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/src/routes/admin.test.ts
git commit -m "feat(api): Períodos e Destaque restritos ao setor do Subadmin"
```

---

## Task 6: Categorias e Selos restritos ao setor do Subadmin

**Files:**
- Modify: `apps/api/src/routes/admin.ts` (`GET/POST/PATCH /admin/categories`, `GET/POST/PATCH /admin/badges`)
- Test: `apps/api/src/routes/admin.test.ts`

**Interfaces:**
- Consumes: `adminOrSubadmin`, `subadminToken` (Tasks 3-5), `global`/`sectorIds` já existentes em `CategoryDTO`/`BadgeDTO` (plano anterior "categorias-selos-por-setor").
- Produces: nenhuma nova.

- [ ] **Step 1: Escrever o teste que falha**

```ts
  it('Subadmin vê globais + específicos do próprio setor de Categorias/Selos, cria sempre específico, e não edita item compartilhado', async () => {
    const app = buildApp()
    await app.ready()
    const sectorA = await prisma.sector.create({ data: { name: 'Setor A Cat', slug: 'setor-a-cat', enabledFeatures: [] } })
    const sectorB = await prisma.sector.create({ data: { name: 'Setor B Cat', slug: 'setor-b-cat', enabledFeatures: [] } })
    const token = await subadminToken(app, sectorA.id)
    await prisma.category.create({ data: { name: 'Global Cat', slug: 'global-cat-sub-test' } })
    const soB = await prisma.category.create({ data: { name: 'Só B', slug: 'so-b-cat-sub-test', global: false, sectors: { create: [{ sectorId: sectorB.id }] } } })
    const shared = await prisma.category.create({ data: { name: 'Compartilhada', slug: 'compartilhada-cat-sub-test', global: false, sectors: { create: [{ sectorId: sectorA.id }, { sectorId: sectorB.id }] } } })

    const list = await app.inject({ method: 'GET', url: '/admin/categories', headers: { authorization: `Bearer ${token}` } })
    const names = list.json().categories.map((c: { name: string }) => c.name)
    expect(names).toContain('Global Cat')
    expect(names).toContain('Compartilhada')
    expect(names).not.toContain('Só B')

    const created = await app.inject({
      method: 'POST', url: '/admin/categories',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Nova Categoria Subadmin', global: true },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().category.global).toBe(false)
    expect(created.json().category.sectorIds).toEqual([sectorA.id])

    const editShared = await app.inject({
      method: 'PATCH', url: `/admin/categories/${shared.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Tentativa' },
    })
    expect(editShared.statusCode).toBe(403)

    const editOther = await app.inject({
      method: 'PATCH', url: `/admin/categories/${soB.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Tentativa' },
    })
    expect(editOther.statusCode).toBe(403)
    await app.close()
  })
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts -t "Subadmin vê globais"
```

- [ ] **Step 3: Editar `GET /admin/categories`**

Troque:

```ts
  app.get('/admin/categories', adminOnly, async (_request, reply) => {
    const categories = await prisma.category.findMany({ include: { sectors: true }, orderBy: { name: 'asc' } })
    return reply.send({ categories: categories.map(toCategoryDTO) })
  })
```

por:

```ts
  app.get('/admin/categories', adminOrSubadmin, async (request, reply) => {
    const categories = await prisma.category.findMany({
      where: request.user.role === 'SUBADMIN'
        ? { OR: [{ global: true }, { sectors: { some: { sectorId: request.user.sectorId } } }] }
        : undefined,
      include: { sectors: true },
      orderBy: { name: 'asc' },
    })
    return reply.send({ categories: categories.map(toCategoryDTO) })
  })
```

- [ ] **Step 4: Editar `POST /admin/categories`**

Troque:

```ts
  app.post('/admin/categories', adminOnly, async (request, reply) => {
    const parsed = createCategorySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos' })
    }
    const global = parsed.data.global ?? true
    const sectorIds = global ? [] : (parsed.data.sectorIds ?? [])
```

por:

```ts
  app.post('/admin/categories', adminOrSubadmin, async (request, reply) => {
    const parsed = createCategorySchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos' })
    }
    const isSubadmin = request.user.role === 'SUBADMIN'
    const global = isSubadmin ? false : (parsed.data.global ?? true)
    const sectorIds = isSubadmin ? [request.user.sectorId] : global ? [] : (parsed.data.sectorIds ?? [])
```

- [ ] **Step 5: Editar `PATCH /admin/categories/:id` — bloquear edição de item não-exclusivo do próprio setor**

Logo após a linha `const before = await prisma.category.findUnique({ where: { id }, include: { sectors: true } })` (e seu `if (!before) return reply.code(404)...`), adicione:

```ts
    if (request.user.role === 'SUBADMIN') {
      const ownSectorOnly = !before.global && before.sectors.length === 1 && before.sectors[0].sectorId === request.user.sectorId
      if (!ownSectorOnly) {
        return reply.code(403).send({ message: 'Você só pode editar categorias exclusivas do seu setor.' })
      }
    }
```

- [ ] **Step 6: Repetir os Steps 3-5 para `/admin/badges` (GET/POST/PATCH), com o mesmo padrão**

`GET /admin/badges` — troque:

```ts
  app.get('/admin/badges', adminOnly, async (_request, reply) => {
    const badges = await prisma.badge.findMany({ include: { sectors: true }, orderBy: { name: 'asc' } })
    return reply.send({ badges: badges.map(toBadgeDTO) })
  })
```

por:

```ts
  app.get('/admin/badges', adminOrSubadmin, async (request, reply) => {
    const badges = await prisma.badge.findMany({
      where: request.user.role === 'SUBADMIN'
        ? { OR: [{ global: true }, { sectors: { some: { sectorId: request.user.sectorId } } }] }
        : undefined,
      include: { sectors: true },
      orderBy: { name: 'asc' },
    })
    return reply.send({ badges: badges.map(toBadgeDTO) })
  })
```

`POST /admin/badges` — troque:

```ts
  app.post('/admin/badges', adminOnly, async (request, reply) => {
    const parsed = createBadgeSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.flatten() })
    }
    const global = parsed.data.global ?? true
    const sectorIds = global ? [] : (parsed.data.sectorIds ?? [])
```

por:

```ts
  app.post('/admin/badges', adminOrSubadmin, async (request, reply) => {
    const parsed = createBadgeSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.flatten() })
    }
    const isSubadmin = request.user.role === 'SUBADMIN'
    const global = isSubadmin ? false : (parsed.data.global ?? true)
    const sectorIds = isSubadmin ? [request.user.sectorId] : global ? [] : (parsed.data.sectorIds ?? [])
```

`PATCH /admin/badges/:id` — logo após `const before = await prisma.badge.findUnique({ where: { id }, include: { sectors: true } })` e seu 404, adicione:

```ts
    if (request.user.role === 'SUBADMIN') {
      const ownSectorOnly = !before.global && before.sectors.length === 1 && before.sectors[0].sectorId === request.user.sectorId
      if (!ownSectorOnly) {
        return reply.code(403).send({ message: 'Você só pode editar selos exclusivos do seu setor.' })
      }
    }
```

- [ ] **Step 7: Rodar e confirmar que passa**

```bash
pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts -t "Subadmin vê globais"
```

Escreva um teste análogo para Selos (mesma estrutura do Step 1, trocando categoria por selo) e confirme que passa também.

- [ ] **Step 8: Rodar a suíte inteira de `admin.test.ts`**

```bash
pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/src/routes/admin.test.ts
git commit -m "feat(api): Categorias e Selos restritos ao setor do Subadmin"
```

---

## Task 7: Terceirizados restrito ao setor do Subadmin

**Files:**
- Modify: `apps/api/src/routes/third-party-invites.ts` (`adminOnly` local → reusar `requireAdminOrSubadmin`; `POST/GET /admin/third-party-invites*`)
- Modify: `apps/api/src/routes/admin.ts` (`GET /admin/third-party-users`)
- Test: `apps/api/src/routes/third-party-invites.test.ts`, `apps/api/src/routes/admin.test.ts`

**Interfaces:**
- Consumes: `createThirdPartyInvite(..., sectorId)` (Task 2), `requireAdminOrSubadmin` (Task 1).
- Produces: nenhuma nova.

- [ ] **Step 1: Escrever o teste que falha em `third-party-invites.test.ts`**

Leia o arquivo primeiro para confirmar os helpers de token já usados (provavelmente `adminToken`). Adicione um helper `subadminToken` idêntico ao de `admin.test.ts` (Task 3) se este arquivo não o importar de um módulo compartilhado — copie o mesmo corpo.

```ts
  it('Subadmin só vê/cria convites do próprio setor', async () => {
    const app = buildApp()
    await app.ready()
    const sectorA = await prisma.sector.create({ data: { name: 'Setor A Convite', slug: 'setor-a-convite', enabledFeatures: [] } })
    const sectorB = await prisma.sector.create({ data: { name: 'Setor B Convite', slug: 'setor-b-convite', enabledFeatures: [] } })
    const token = await subadminToken(app, sectorA.id)
    const adminB = await prisma.user.create({ data: { name: 'AdminB', email: 'adminb-convite@x.com', passwordHash: 'x', role: 'ADMIN', sectorId: sectorB.id } })
    await prisma.thirdPartyInvite.create({ data: { tokenHash: 'hash-b', createdById: adminB.id, sectorId: sectorB.id, expiresAt: new Date(Date.now() + 3600_000) } })

    const list = await app.inject({ method: 'GET', url: '/admin/third-party-invites', headers: { authorization: `Bearer ${token}` } })
    expect(list.json().invites).toHaveLength(0)

    const created = await app.inject({
      method: 'POST', url: '/admin/third-party-invites',
      headers: { authorization: `Bearer ${token}` },
      payload: { expiresInMinutes: 60, enabledFeatures: ['escritorio'] },
    })
    expect(created.statusCode).toBe(201)
    await app.close()
  })
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter @legends/api exec vitest run src/routes/third-party-invites.test.ts -t "Subadmin"
```

- [ ] **Step 3: Editar `third-party-invites.ts` — trocar o `adminOnly` local pelo gate compartilhado, e escopar por setor**

Troque:

```ts
export async function thirdPartyInviteRoutes(app: FastifyInstance) {
  const adminOnly = { onRequest: [app.authenticate, app.requireAdmin] }

  app.post('/admin/third-party-invites', adminOnly, async (request, reply): Promise<CreateThirdPartyInviteResponse | FastifyReply> => {
    const parsed = createInviteSchema.safeParse(request.body)
    if (!parsed.success) return badInput(reply, parsed.error)
    const { invite, rawToken } = await createThirdPartyInvite(
      request.user.sub,
      parsed.data.expiresInMinutes,
      parsed.data.enabledFeatures,
    )
```

por:

```ts
export async function thirdPartyInviteRoutes(app: FastifyInstance) {
  const adminOrSubadmin = { onRequest: [app.authenticate, app.requireAdminOrSubadmin] }

  app.post('/admin/third-party-invites', adminOrSubadmin, async (request, reply): Promise<CreateThirdPartyInviteResponse | FastifyReply> => {
    const parsed = createInviteSchema.safeParse(request.body)
    if (!parsed.success) return badInput(reply, parsed.error)
    const sectorId = request.user.role === 'SUBADMIN' ? request.user.sectorId : DEFAULT_SECTOR_ID
    const { invite, rawToken } = await createThirdPartyInvite(
      request.user.sub,
      parsed.data.expiresInMinutes,
      parsed.data.enabledFeatures,
      sectorId,
    )
```

(adicione `DEFAULT_SECTOR_ID` aos imports de `@legends/shared` no topo do arquivo — confirme que ainda não está importado antes de adicionar.)

Troque:

```ts
  app.get('/admin/third-party-invites', adminOnly, async (_request, reply): Promise<ThirdPartyInviteListResponse> => {
    const invites = await listThirdPartyInvites()
    return reply.send({
      invites: invites.map((invite) => ({
```

por:

```ts
  app.get('/admin/third-party-invites', adminOrSubadmin, async (request, reply): Promise<ThirdPartyInviteListResponse> => {
    const invites = await listThirdPartyInvites()
    const scoped = request.user.role === 'SUBADMIN' ? invites.filter((i) => i.sectorId === request.user.sectorId) : invites
    return reply.send({
      invites: scoped.map((invite) => ({
```

Troque as duas rotas restantes (`revoke`, `delete`) de `adminOnly` para `adminOrSubadmin`, e adicione a checagem de propriedade antes de delegar — para `revoke`:

```ts
  app.post('/admin/third-party-invites/:id/revoke', adminOnly, async (request, reply) => {
    const parsed = idParamsSchema.safeParse(request.params)
    if (!parsed.success) return badInput(reply, parsed.error)
    await revokeThirdPartyInvite(parsed.data.id, request.user.sub)
    return reply.code(204).send()
  })
```

por:

```ts
  app.post('/admin/third-party-invites/:id/revoke', adminOrSubadmin, async (request, reply) => {
    const parsed = idParamsSchema.safeParse(request.params)
    if (!parsed.success) return badInput(reply, parsed.error)
    if (request.user.role === 'SUBADMIN') {
      const existing = await prisma.thirdPartyInvite.findUnique({ where: { id: parsed.data.id } })
      if (!existing || existing.sectorId !== request.user.sectorId) {
        return reply.code(404).send({ message: 'Convite não encontrado' })
      }
    }
    await revokeThirdPartyInvite(parsed.data.id, request.user.sub)
    return reply.code(204).send()
  })
```

(adicione `import { prisma } from '../lib/prisma'` no topo do arquivo, se ainda não estiver importado — confirme antes de adicionar.)

Mesmo padrão para `DELETE /admin/third-party-invites/:id`: troque `adminOnly` → `adminOrSubadmin`, e insira a mesma checagem de propriedade logo após o parse dos params, antes do `try`.

- [ ] **Step 4: Editar `GET /admin/third-party-users` em `admin.ts`**

Troque:

```ts
  app.get('/admin/third-party-users', adminOnly, async (_request, reply) => {
    const users = await prisma.user.findMany({ where: { role: 'THIRD_PARTY' }, orderBy: { name: 'asc' } })
    return reply.send({ users: users.map(toAdminUser) })
  })
```

por:

```ts
  app.get('/admin/third-party-users', adminOrSubadmin, async (request, reply) => {
    const users = await prisma.user.findMany({
      where: { role: 'THIRD_PARTY', ...(request.user.role === 'SUBADMIN' ? { sectorId: request.user.sectorId } : {}) },
      orderBy: { name: 'asc' },
    })
    return reply.send({ users: users.map(toAdminUser) })
  })
```

- [ ] **Step 5: Rodar e confirmar que passa**

```bash
pnpm --filter @legends/api exec vitest run src/routes/third-party-invites.test.ts
```

- [ ] **Step 6: Rodar a suíte inteira de `admin.test.ts` e `third-party-invites.test.ts`**

```bash
pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts src/routes/third-party-invites.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/third-party-invites.ts apps/api/src/routes/third-party-invites.test.ts apps/api/src/routes/admin.ts apps/api/src/routes/admin.test.ts
git commit -m "feat(api): Terceirizados restrito ao setor do Subadmin"
```

---

## Task 8: Moderação (votos), Dashboard, e acesso sem particionamento (Quinta de Dev/Retrospectivas)

**Files:**
- Modify: `apps/api/src/routes/admin.ts` (`GET/DELETE /admin/votes*`, `GET /admin/dashboard`, `GET/PATCH /admin/development-thursday/settings`, `GET/PATCH/DELETE /admin/retro/rooms*`)
- Modify: `apps/api/src/services/admin-dashboard-service.ts` (`getAdminDashboard`)
- Test: `apps/api/src/routes/admin.test.ts`, `apps/api/src/services/admin-dashboard-service.test.ts`

**Interfaces:**
- Consumes: `adminOrSubadmin`, `subadminToken` (Tasks 3-7).
- Produces: `getAdminDashboard(now?: Date, sectorId?: string): Promise<AdminDashboardResponse>` — assinatura muda (novo 2º parâmetro opcional).

- [ ] **Step 1: Escrever o teste que falha — Moderação de votos**

```ts
  it('Subadmin só vê/remove votos do período do próprio setor', async () => {
    const app = buildApp()
    await app.ready()
    const sectorA = await prisma.sector.create({ data: { name: 'Setor A Voto', slug: 'setor-a-voto', enabledFeatures: [] } })
    const sectorB = await prisma.sector.create({ data: { name: 'Setor B Voto', slug: 'setor-b-voto', enabledFeatures: [] } })
    const token = await subadminToken(app, sectorA.id)
    const periodB = await prisma.votingPeriod.create({
      data: { sectorId: sectorB.id, monthRef: '2026-10', startsAt: new Date(Date.now() - 86400000), endsAt: new Date(Date.now() + 86400000), status: 'OPEN' },
    })
    const category = await prisma.category.create({ data: { name: 'Cat Voto Sub', slug: 'cat-voto-sub-test' } })
    const voterB = await prisma.user.create({ data: { name: 'Voter B', email: 'voterb-voto@x.com', passwordHash: 'x', sectorId: sectorB.id } })
    const votedB = await prisma.user.create({ data: { name: 'Voted B', email: 'votedb-voto@x.com', passwordHash: 'x', sectorId: sectorB.id } })
    const voteB = await prisma.vote.create({
      data: { voterId: voterB.id, votedId: votedB.id, periodId: periodB.id, justification: 'Justificativa válida aqui.', categories: { create: [{ categoryId: category.id }] } },
    })

    const list = await app.inject({ method: 'GET', url: '/admin/votes', headers: { authorization: `Bearer ${token}` } })
    expect(list.json().votes.map((v: { id: string }) => v.id)).not.toContain(voteB.id)

    const del = await app.inject({ method: 'DELETE', url: `/admin/votes/${voteB.id}`, headers: { authorization: `Bearer ${token}` } })
    expect(del.statusCode).toBe(404)
    await app.close()
  })

  it('Subadmin vê só o card do próprio setor no Dashboard', async () => {
    const app = buildApp()
    await app.ready()
    const sectorA = await prisma.sector.create({ data: { name: 'Setor A Dash', slug: 'setor-a-dash', enabledFeatures: [] } })
    await prisma.sector.create({ data: { name: 'Setor B Dash', slug: 'setor-b-dash', enabledFeatures: [] } })
    const token = await subadminToken(app, sectorA.id)
    const res = await app.inject({ method: 'GET', url: '/admin/dashboard', headers: { authorization: `Bearer ${token}` } })
    expect(res.json().sectors).toHaveLength(1)
    expect(res.json().sectors[0].sectorId).toBe(sectorA.id)
    await app.close()
  })
```

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts -t "Subadmin só vê/remove votos"
pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts -t "Dashboard"
```

- [ ] **Step 3: Editar `GET/DELETE /admin/votes*`**

Troque:

```ts
  app.get('/admin/votes', adminOnly, async (_request, reply) => {
    const votes = await prisma.vote.findMany({ include: voteInclude, orderBy: { createdAt: 'desc' }, take: 50 })
    return reply.send({ votes: votes.map(toVoteDTO) })
  })

  app.delete('/admin/votes/:id', adminOnly, async (request, reply) => {
    const { id } = request.params as { id: string }
    const before = await prisma.vote.findUnique({ where: { id } })
    if (!before) return reply.code(404).send({ message: 'Voto não encontrado' })
```

por:

```ts
  app.get('/admin/votes', adminOrSubadmin, async (request, reply) => {
    const votes = await prisma.vote.findMany({
      include: voteInclude,
      where: request.user.role === 'SUBADMIN' ? { period: { sectorId: request.user.sectorId } } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    return reply.send({ votes: votes.map(toVoteDTO) })
  })

  app.delete('/admin/votes/:id', adminOrSubadmin, async (request, reply) => {
    const { id } = request.params as { id: string }
    const before = await prisma.vote.findUnique({ where: { id }, include: { period: true } })
    if (!before) return reply.code(404).send({ message: 'Voto não encontrado' })
    if (request.user.role === 'SUBADMIN' && before.period.sectorId !== request.user.sectorId) {
      return reply.code(404).send({ message: 'Voto não encontrado' })
    }
```

- [ ] **Step 4: Editar `getAdminDashboard` em `admin-dashboard-service.ts`**

Troque:

```ts
export async function getAdminDashboard(now: Date = new Date()): Promise<AdminDashboardResponse> {
  const sectors = await prisma.sector.findMany({ orderBy: { name: 'asc' } })
```

por:

```ts
export async function getAdminDashboard(now: Date = new Date(), sectorId?: string): Promise<AdminDashboardResponse> {
  const sectors = await prisma.sector.findMany({
    where: sectorId ? { id: sectorId } : undefined,
    orderBy: { name: 'asc' },
  })
```

- [ ] **Step 5: Editar `GET /admin/dashboard`**

Troque:

```ts
  app.get('/admin/dashboard', adminOnly, async (_request, reply) => {
    return reply.send(await getAdminDashboard())
  })
```

por:

```ts
  app.get('/admin/dashboard', adminOrSubadmin, async (request, reply) => {
    const sectorId = request.user.role === 'SUBADMIN' ? request.user.sectorId : undefined
    return reply.send(await getAdminDashboard(new Date(), sectorId))
  })
```

- [ ] **Step 6: Trocar `adminOnly` → `adminOrSubadmin` em Quinta de Dev e Retrospectivas (sem nenhum filtro adicional — acesso igual ao ADMIN, conforme decisão do spec)**

Troque (nas 2 rotas de `/admin/development-thursday/settings`):

```ts
  app.get('/admin/development-thursday/settings', adminOnly, ...
  app.patch('/admin/development-thursday/settings', adminOnly, ...
```

por (mesma assinatura de handler, só troca o guard):

```ts
  app.get('/admin/development-thursday/settings', adminOrSubadmin, ...
  app.patch('/admin/development-thursday/settings', adminOrSubadmin, ...
```

Troque (nas 3 rotas de `/admin/retro/rooms*`):

```ts
  app.get('/admin/retro/rooms', adminOnly, ...
  app.patch('/admin/retro/rooms/:id', adminOnly, ...
  app.delete('/admin/retro/rooms/:id', adminOnly, ...
```

por:

```ts
  app.get('/admin/retro/rooms', adminOrSubadmin, ...
  app.patch('/admin/retro/rooms/:id', adminOrSubadmin, ...
  app.delete('/admin/retro/rooms/:id', adminOrSubadmin, ...
```

(troque só o segundo argumento de cada `app.get`/`app.patch`/`app.delete` — o resto do corpo do handler não muda.)

- [ ] **Step 7: Rodar e confirmar que passa**

```bash
pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts -t "Subadmin só vê/remove votos"
pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts -t "Dashboard"
```

- [ ] **Step 8: Atualizar `admin-dashboard-service.test.ts` para cobrir o novo parâmetro `sectorId`**

Adicione um teste chamando `getAdminDashboard(new Date(), sectorId)` diretamente e confirmando que só o card daquele setor volta (mesma asserção do teste de rota do Step 1, mas no nível do service).

- [ ] **Step 9: Rodar a suíte inteira de `admin.test.ts` e `admin-dashboard-service.test.ts`**

```bash
pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts src/services/admin-dashboard-service.test.ts
```

Expected: PASS.

- [ ] **Step 10: Rodar o typecheck e a suíte completa da API (fim da parte de backend do plano)**

```bash
pnpm --filter @legends/api exec tsc --noEmit
pnpm --filter @legends/api test
```

Expected: ambos limpos.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/src/routes/admin.test.ts apps/api/src/services/admin-dashboard-service.ts apps/api/src/services/admin-dashboard-service.test.ts
git commit -m "feat(api): Moderação de votos, Dashboard e acesso sem particionamento do Subadmin"
```

---

## Task 9: Frontend — `isAdmin`, guarda de rota, e `AdminSidebar`

**Files:**
- Modify: `apps/web/src/components/AppLayout.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/pages/admin/AdminSidebar.tsx`
- Test: `apps/web/src/components/AppLayout.test.tsx`, `apps/web/src/App.routing.test.tsx`, `apps/web/src/pages/admin/AdminSidebar.test.tsx`

**Interfaces:**
- Consumes: `UserRole` incluindo `'SUBADMIN'` (Task 1, já propagado via `@legends/shared`).
- Produces: `AdminSidebar` passa a aceitar (ou ler via `useAuth`) o papel do usuário logado, para decidir quais grupos/itens mostrar — Task 10 não depende disso, mas deve ler o mesmo `useAuth()` já usado aqui.

- [ ] **Step 1: Escrever o teste que falha — `isAdmin` reconhece SUBADMIN**

Em `apps/web/src/components/AppLayout.test.tsx`, leia o arquivo primeiro (já tem um `describe('AppLayout — seção /admin', ...)` de trabalho anterior, com um `currentUser` mutável). Adicione:

```ts
  it('trata SUBADMIN como conta de gestão (sem sidebar principal em /admin, sem ofensiva)', async () => {
    currentUser.role = 'SUBADMIN'
    renderLayout('/admin/lendas')
    await screen.findByText(/olá, subadmin!/i) // ajuste o nome conforme o fixture já usado no arquivo
    expect(screen.queryByRole('navigation', { name: /navegação principal/i })).not.toBeInTheDocument()
  })
```

(ajuste o texto da saudação/fixture pro nome real já usado em `currentUser` no arquivo — leia antes de escrever.)

- [ ] **Step 2: Rodar e confirmar que falha**

```bash
pnpm --filter @legends/web exec vitest run src/components/AppLayout.test.tsx
```

- [ ] **Step 3: Editar `isAdmin` em `AppLayout.tsx`**

Troque:

```tsx
const isAdmin = user?.role === "ADMIN";
```

por:

```tsx
const isAdmin = user?.role === "ADMIN" || user?.role === "SUBADMIN";
```

- [ ] **Step 4: Rodar e confirmar que passa**

```bash
pnpm --filter @legends/web exec vitest run src/components/AppLayout.test.tsx
```

- [ ] **Step 5: Escrever o teste que falha — guarda de rota estrita**

Em `apps/web/src/App.routing.test.tsx`, leia o arquivo primeiro (já mocka `useAuth` com um `adminUser`). Adicione um teste com um usuário `SUBADMIN` tentando acessar `/admin/setores` diretamente:

```tsx
describe("App — navegação do subadmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockResolvedValue({ users: [], votes: [], periods: [], badges: [], period: null, sectors: [] });
  });

  it("redireciona subadmin para o Dashboard ao tentar abrir /admin/setores diretamente", async () => {
    // Reaproveite o mock de useAuth já existente no arquivo, mas troque role para 'SUBADMIN'
    // (leia como o mock de useAuth é declarado no topo do arquivo antes de escrever este teste —
    // provavelmente precisa de uma variável mutável análoga ao adminUser já usado).
    window.history.pushState({}, "", "/admin/setores");
    render(<App />);
    expect(await screen.findByRole("heading", { name: /dashboard/i })).toBeInTheDocument();
  });
});
```

Adapte o mock de `useAuth` no topo do arquivo para permitir trocar `role` por teste (mesmo padrão de variável mutável já usado em `AppLayout.test.tsx`, se `App.routing.test.tsx` ainda não tiver isso — leia o arquivo primeiro).

- [ ] **Step 6: Rodar e confirmar que falha**

```bash
pnpm --filter @legends/web exec vitest run src/App.routing.test.tsx
```

Expected: FAIL — hoje `AdminOnly` redireciona SUBADMIN pra `/` (não pra `/admin`), e mesmo se corrigirmos isso não há guarda separada pra `/admin/setores`.

- [ ] **Step 7: Editar `AdminOnly` e criar `StrictAdminOnly` em `App.tsx`**

Troque:

```tsx
/** Restringe a rota a administradores. */
function AdminOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (user && user.role !== 'ADMIN') return <Navigate to="/" replace />
  return <>{children}</>
}
```

por:

```tsx
/** Restringe a rota a administradores (ADMIN ou SUBADMIN). */
function AdminOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (user && user.role !== 'ADMIN' && user.role !== 'SUBADMIN') return <Navigate to="/" replace />
  return <>{children}</>
}

/** Restringe a rota exclusivamente ao ADMIN global — Subadmin cai no Dashboard do admin. */
function StrictAdminOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (user && user.role === 'SUBADMIN') return <Navigate to="/admin" replace />
  if (user && user.role !== 'ADMIN') return <Navigate to="/" replace />
  return <>{children}</>
}
```

- [ ] **Step 8: Envolver as rotas exclusivas do ADMIN global com `StrictAdminOnly`**

Troque o editor de mapa (linhas ~200-211):

```tsx
<Route
  path="/admin/mapas/:mapId/editar"
  element={
    <ProtectedRoute>
      <AdminOnly>
        <Suspense fallback={<p className="p-lg text-on-surface-variant">Abrindo o editor…</p>}>
          <OfficeMapEditorPage />
        </Suspense>
      </AdminOnly>
    </ProtectedRoute>
  }
/>
```

por:

```tsx
<Route
  path="/admin/mapas/:mapId/editar"
  element={
    <ProtectedRoute>
      <StrictAdminOnly>
        <Suspense fallback={<p className="p-lg text-on-surface-variant">Abrindo o editor…</p>}>
          <OfficeMapEditorPage />
        </Suspense>
      </StrictAdminOnly>
    </ProtectedRoute>
  }
/>
```

E, dentro da árvore de rotas do `/admin`, envolva individualmente as 4 rotas exclusivas do ADMIN global — troque:

```tsx
  <Route path="setores" element={<SectorsSection />} />
```

por:

```tsx
  <Route path="setores" element={<StrictAdminOnly><SectorsSection /></StrictAdminOnly>} />
```

e o mesmo padrão (`<StrictAdminOnly>...</StrictAdminOnly>` envolvendo o elemento) para:

```tsx
  <Route path="escritorio" element={<StrictAdminOnly><OfficeSection /></StrictAdminOnly>} />
  <Route path="mapas" element={<StrictAdminOnly><MapsSection /></StrictAdminOnly>} />
  <Route path="auditoria" element={<StrictAdminOnly><AdminAuditLogPage /></StrictAdminOnly>} />
```

(as demais rotas filhas de `/admin` continuam sem `StrictAdminOnly` — acessíveis a Subadmin, já que o pai `/admin` usa `AdminOnly`, agora permissivo pros dois papéis.)

- [ ] **Step 9: Rodar e confirmar que passa**

```bash
pnpm --filter @legends/web exec vitest run src/App.routing.test.tsx
```

- [ ] **Step 10: Escrever o teste que falha — `AdminSidebar` esconde itens exclusivos do ADMIN pro Subadmin**

Em `apps/web/src/pages/admin/AdminSidebar.test.tsx`, leia o arquivo primeiro (hoje `AdminSidebar` não recebe prop nenhuma — vai precisar mockar `useAuth`, igual outros arquivos de teste deste diretório já fazem). Adicione:

```tsx
const mockAuth = vi.hoisted(() => ({ role: 'ADMIN' as string, sectorFeatures: [] as string[] }))
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { role: mockAuth.role, sectorFeatures: mockAuth.sectorFeatures } }),
}))
```

(ajuste conforme o padrão já usado em outros arquivos deste diretório para mocks mutáveis via `vi.hoisted` — leia um exemplo existente, ex. `CollaboratorsSection.test.tsx`'s `currentUser`, antes de escrever, e resete `mockAuth.role`/`mockAuth.sectorFeatures` num `beforeEach`.)

```tsx
  it('esconde Setores/Auditoria/Escritório/Mapas para SUBADMIN', () => {
    mockAuth.role = 'SUBADMIN'
    mockAuth.sectorFeatures = []
    renderAt('/admin')
    expect(screen.queryByRole('link', { name: 'Setores' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Auditoria' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Escritório' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Mapas' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Lendas' })).toBeInTheDocument()
  })

  it('só mostra Quinta de Dev/Retrospectivas/Resenha pro SUBADMIN se o setor tiver a feature habilitada', () => {
    mockAuth.role = 'SUBADMIN'
    mockAuth.sectorFeatures = ['quinta-desenvolvimento']
    renderAt('/admin')
    expect(screen.getByRole('link', { name: 'Quinta de Dev' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Retrospectivas' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Resenha' })).not.toBeInTheDocument()
    // Moderação não depende de feature — sempre visível pro Subadmin.
    expect(screen.getByRole('link', { name: 'Moderação' })).toBeInTheDocument()
  })
```

- [ ] **Step 11: Rodar e confirmar que falha**

```bash
pnpm --filter @legends/web exec vitest run src/pages/admin/AdminSidebar.test.tsx
```

- [ ] **Step 12: Editar `AdminSidebar.tsx` — filtrar itens exclusivos do ADMIN, e os 3 itens de Comunidade sem particionamento pelo `sectorFeatures` do Subadmin**

Marque os itens exclusivos do ADMIN global com uma flag, e os 3 itens de Comunidade sem particionamento (Quinta de Dev/Retrospectivas/Resenha) com a `FeatureKey` que já os condiciona pro usuário comum (`nav-items.ts`: `'quinta-desenvolvimento'`, `'retrospectivas'`, `'resenha'` — Moderação não tem feature própria, fica sempre visível pro Subadmin). Troque:

```tsx
interface AdminNavItem {
  to: string
  label: string
  end?: boolean
}
```

por:

```tsx
import type { FeatureKey } from '@legends/shared'

interface AdminNavItem {
  to: string
  label: string
  end?: boolean
  adminOnly?: boolean
  featureKey?: FeatureKey
}
```

Troque os itens de "Setores" e "Auditoria"/"Escritório"/"Mapas" para incluir `adminOnly: true`:

```tsx
      { to: '/admin/setores', label: 'Setores' },
```

por:

```tsx
      { to: '/admin/setores', label: 'Setores', adminOnly: true },
```

```tsx
      { to: '/admin/escritorio', label: 'Escritório' },
      { to: '/admin/mapas', label: 'Mapas' },
```

por:

```tsx
      { to: '/admin/escritorio', label: 'Escritório', adminOnly: true },
      { to: '/admin/mapas', label: 'Mapas', adminOnly: true },
```

```tsx
    items: [{ to: '/admin/auditoria', label: 'Auditoria' }],
```

por:

```tsx
    items: [{ to: '/admin/auditoria', label: 'Auditoria', adminOnly: true }],
```

Troque os 3 itens de Comunidade sem particionamento pra incluir `featureKey`:

```tsx
      { to: '/admin/quinta-dev', label: 'Quinta de Dev' },
      { to: '/admin/retrospectivas', label: 'Retrospectivas' },
      { to: '/admin/moderacao', label: 'Moderação' },
      { to: '/admin/resenha', label: 'Resenha' },
```

por:

```tsx
      { to: '/admin/quinta-dev', label: 'Quinta de Dev', featureKey: 'quinta-desenvolvimento' },
      { to: '/admin/retrospectivas', label: 'Retrospectivas', featureKey: 'retrospectivas' },
      { to: '/admin/moderacao', label: 'Moderação' },
      { to: '/admin/resenha', label: 'Resenha', featureKey: 'resenha' },
```

Troque a função do componente para ler o papel + `sectorFeatures` e filtrar:

```tsx
import { NavLink } from 'react-router-dom'
```

por:

```tsx
import { NavLink } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
```

Troque:

```tsx
export function AdminSidebar() {
  return (
    <nav
      className="fixed left-0 top-0 z-40 hidden h-screen w-64 flex-col gap-xl overflow-y-auto border-r border-outline-variant/40 bg-surface-container-lowest p-lg py-xl md:flex"
      aria-label="Administração"
    >
      <div className="mb-xl flex items-center justify-center px-md">
        <Link to="/" aria-label="Ir para a Home">
          <img src="/illustration/horizontal_logo.png" alt="Legends" className="h-14 w-auto object-contain" />
        </Link>
      </div>
      {ADMIN_NAV_GROUPS.map((group) => (
```

por:

```tsx
export function AdminSidebar() {
  const { user } = useAuth()
  const isSubadmin = user?.role === 'SUBADMIN'
  const sectorFeatures = new Set(user?.sectorFeatures ?? [])
  const visibleGroups = ADMIN_NAV_GROUPS
    .map((group) => ({
      ...group,
      items: isSubadmin
        ? group.items.filter((item) => !item.adminOnly && (!item.featureKey || sectorFeatures.has(item.featureKey)))
        : group.items,
    }))
    .filter((group) => group.items.length > 0)

  return (
    <nav
      className="fixed left-0 top-0 z-40 hidden h-screen w-64 flex-col gap-xl overflow-y-auto border-r border-outline-variant/40 bg-surface-container-lowest p-lg py-xl md:flex"
      aria-label="Administração"
    >
      <div className="mb-xl flex items-center justify-center px-md">
        <Link to="/" aria-label="Ir para a Home">
          <img src="/illustration/horizontal_logo.png" alt="Legends" className="h-14 w-auto object-contain" />
        </Link>
      </div>
      {visibleGroups.map((group) => (
```

(o `Link` já importado de `react-router-dom` no arquivo continua igual — só `NavLink`/`Link` coexistem como já estava.)

- [ ] **Step 13: Rodar e confirmar que passa**

```bash
pnpm --filter @legends/web exec vitest run src/pages/admin/AdminSidebar.test.tsx
```

Expected: PASS, incluindo o teste pré-existente (que usa o papel padrão `ADMIN` do mock e deve continuar vendo todos os itens).

- [ ] **Step 14: Rodar o typecheck e os três arquivos de teste tocados**

```bash
pnpm --filter @legends/web exec tsc --noEmit
pnpm --filter @legends/web exec vitest run src/components/AppLayout.test.tsx src/App.routing.test.tsx src/pages/admin/AdminSidebar.test.tsx
```

Expected: ambos limpos.

- [ ] **Step 15: Commit**

```bash
git add apps/web/src/components/AppLayout.tsx apps/web/src/components/AppLayout.test.tsx apps/web/src/App.tsx apps/web/src/App.routing.test.tsx apps/web/src/pages/admin/AdminSidebar.tsx apps/web/src/pages/admin/AdminSidebar.test.tsx
git commit -m "feat(web): isAdmin reconhece Subadmin, guarda de rota estrita, sidebar filtrada"
```

---

## Task 10: Frontend — esconder seletor de setor e opções de papel restritas para o Subadmin

**Files:**
- Modify: `apps/web/src/pages/admin/CollaboratorsSection.tsx`
- Modify: `apps/web/src/pages/admin/SquadsSection.tsx`
- Modify: `apps/web/src/pages/admin/PeriodsSection.tsx`
- Modify: `apps/web/src/pages/admin/ThirdPartySection.tsx`
- Modify: `apps/web/src/pages/admin/CategoriesSection.tsx`
- Modify: `apps/web/src/pages/admin/BadgesSection.tsx`
- Test: os 6 arquivos `.test.tsx` correspondentes

**Interfaces:**
- Consumes: `useAuth()` (padrão já usado em `AdminSidebar.tsx`, Task 9).
- Produces: nenhuma nova — só comportamento condicional de UI.

- [ ] **Step 1: `CollaboratorsSection.tsx` — esconder seletor de setor e opções ADMIN/SUBADMIN no papel**

Leia o arquivo (linhas 1-330, já conhecido de trabalho anterior desta sessão). Adicione o import e a leitura do papel logo no topo do componente exportado:

```tsx
import { useAuth } from '../../auth/AuthContext'
```

Dentro de `export function CollaboratorsSection() {`, logo após a primeira linha do corpo, adicione:

```tsx
  const { user } = useAuth()
  const isSubadmin = user?.role === 'SUBADMIN'
```

No formulário de criação (linhas ~278-283, `<select ... aria-label="Setor">`), envolva o bloco do seletor com `{!isSubadmin && (...)}`. No `CollaboratorRow` (o seletor inline de setor, linhas ~96-101), passe `isSubadmin` como prop e envolva da mesma forma — adicione `isSubadmin: boolean` à interface de props de `CollaboratorRow` e passe `isSubadmin={isSubadmin}` no call site.

Para as opções de papel (`USER_ROLES.map(...)`, nas duas ocorrências — linha ~77 dentro de `CollaboratorRow` e linha ~270 no formulário de criação), filtre a lista quando `isSubadmin`:

```tsx
{(isSubadmin ? USER_ROLES.filter((r) => r !== 'ADMIN' && r !== 'SUBADMIN') : USER_ROLES).map((r) => (
```

- [ ] **Step 2: `SquadsSection.tsx` — esconder seletor de setor**

Mesmo padrão: importar `useAuth`, ler `isSubadmin`, envolver o `<select aria-label="Setor da nova squad">` (linhas ~97-101) e o `<select aria-label={`Setor da ${squad.name}`}>` (linhas ~144-154) com `{!isSubadmin && (...)}`.

- [ ] **Step 3: `PeriodsSection.tsx` — esconder seletor de setor na criação e no filtro**

Mesmo padrão: envolver o `<select aria-label="Setor do período">` (linhas ~363-368) e o `<select aria-label="Filtrar períodos por setor">` (linhas ~387-392) com `{!isSubadmin && (...)}`.

- [ ] **Step 4: `ThirdPartySection.tsx` — esconder seletor de setor por linha**

Mesmo padrão: envolver o `<select aria-label="Setor do terceirizado">` em `ThirdPartyRow` (linhas ~188-193) com `{!isSubadmin && (...)}` — passe `isSubadmin` como prop, igual em `CollaboratorRow`.

- [ ] **Step 5: `CategoriesSection.tsx` e `BadgesSection.tsx` — esconder `SectorChecklist` e o checkbox "Global"**

Mesmo padrão: onde o checkbox "Global" e o `<SectorChecklist>` correspondente aparecem (form de criação e, em Categorias, também por linha), envolva ambos juntos com `{!isSubadmin && (...)}` — um Subadmin nunca decide global/setor, o backend já força sozinho.

- [ ] **Step 6: Escrever um teste por arquivo (padrão idêntico nos 6)**

Para cada um dos 6 arquivos de teste, mocke `useAuth` retornando `role: 'SUBADMIN'` num novo `describe`, e confirme que o(s) seletor(es) de setor (e, em Lendas, as opções `Admin`/`Subadmin` no papel) não aparecem — reaproveite o padrão de mock já usado em `AdminSidebar.test.tsx` (Task 9, Step 10) ou o de `currentUser` mutável já usado em `AppLayout.test.tsx`/`CollaboratorsSection.test.tsx`, conforme o que já existir em cada arquivo.

Exemplo para `CollaboratorsSection.test.tsx`:

```tsx
describe('CollaboratorsSection — Subadmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupFetch()
  })

  it('esconde o seletor de setor e as opções Admin/Subadmin quando logado como Subadmin', async () => {
    // mocke useAuth com role: 'SUBADMIN' aqui, seguindo o padrão já escolhido no arquivo
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: /\+ adicionar lenda/i }))
    expect(screen.queryByLabelText('Setor')).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Admin' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Subadmin' })).not.toBeInTheDocument()
  })
})
```

Escreva o equivalente (mesma estrutura, ajustando os `aria-label`/textos por arquivo) para os outros 5.

- [ ] **Step 7: Rodar e confirmar que passa, para cada arquivo**

```bash
pnpm --filter @legends/web exec vitest run src/pages/admin/CollaboratorsSection.test.tsx src/pages/admin/SquadsSection.test.tsx src/pages/admin/PeriodsSection.test.tsx src/pages/admin/ThirdPartySection.test.tsx src/pages/admin/CategoriesSection.test.tsx src/pages/admin/BadgesSection.test.tsx
```

Expected: PASS em todos, incluindo os testes pré-existentes (que usam o papel `ADMIN` por padrão e devem continuar vendo os seletores).

- [ ] **Step 8: Rodar o typecheck do workspace web**

```bash
pnpm --filter @legends/web exec tsc --noEmit
```

Expected: limpo.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/pages/admin/CollaboratorsSection.tsx apps/web/src/pages/admin/CollaboratorsSection.test.tsx apps/web/src/pages/admin/SquadsSection.tsx apps/web/src/pages/admin/SquadsSection.test.tsx apps/web/src/pages/admin/PeriodsSection.tsx apps/web/src/pages/admin/PeriodsSection.test.tsx apps/web/src/pages/admin/ThirdPartySection.tsx apps/web/src/pages/admin/ThirdPartySection.test.tsx apps/web/src/pages/admin/CategoriesSection.tsx apps/web/src/pages/admin/CategoriesSection.test.tsx apps/web/src/pages/admin/BadgesSection.tsx apps/web/src/pages/admin/BadgesSection.test.tsx
git commit -m "feat(web): esconde seletor de setor e escalonamento de papel para o Subadmin"
```

---

## Task 11: Verificação final

**Files:** nenhum (só verificação)

**Interfaces:** nenhuma — task de fechamento do plano.

- [ ] **Step 1: Typecheck dos três workspaces**

```bash
pnpm --filter @legends/shared exec tsc --noEmit
pnpm --filter @legends/api exec tsc --noEmit
pnpm --filter @legends/web exec tsc --noEmit
```

Expected: os três limpos.

- [ ] **Step 2: Suíte completa da API**

```bash
pnpm --filter @legends/api test
```

Expected: todos os testes passam.

- [ ] **Step 3: Suíte completa do shared**

```bash
pnpm --filter @legends/shared test
```

Expected: todos os testes passam.

- [ ] **Step 4: Suíte completa do web**

```bash
pnpm --filter @legends/web test
```

Expected: todos os testes passam. Se aparecerem exatamente 2 erros "Worker exited unexpectedly" (tinypool) sem nenhuma linha `FAIL`, é um flake de infraestrutura pré-existente já documentado neste repo (confirme rodando `grep FAIL` na saída antes de investigar mais).

- [ ] **Step 5: Teste manual de ponta a ponta**

Crie uma conta `SUBADMIN` local (script direto no Prisma, como já foi feito nesta sessão para contas de teste), associada a um setor que não seja o padrão. Faça login, confirme: cai em `/admin`, sidebar sem Setores/Auditoria/Escritório/Mapas, todas as listagens (Lendas/Squads/Períodos/Categorias/Selos/Terceirizados) mostram só o próprio setor (mais os itens globais, em Categorias/Selos), tentar abrir `/admin/setores` por URL redireciona pro Dashboard.

- [ ] **Step 6: Commit final (se sobrar algo solto)**

```bash
git status
```

Se não houver nada para commitar, este plano está completo.

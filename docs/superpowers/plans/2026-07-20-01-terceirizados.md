# Role de terceirizados com acesso controlado por feature — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduzir uma role `THIRD_PARTY` cujo acesso a features é controlado individualmente pelo admin, com cadastro via link de convite (o próprio terceirizado define e-mail/senha).

**Architecture:** Convite (`ThirdPartyInvite`, mesmo padrão de `OfficeGuestInvite`) carrega as features pré-selecionadas pelo admin; ao ser aceito, cria um `User` real com `role: THIRD_PARTY` e `enabledFeatures` copiadas do convite. `enabledFeatures` é assinado no JWT (junto com `role`, como já é feito hoje) e verificado por um decorator `app.requireFeature(key)` nas rotas REST; conexões WebSocket (escritório, retrô) fazem a mesma checagem manualmente no `preValidation`, já que não passam pelo pipeline de `onRequest`. No frontend, `buildNavItems` esconde itens não liberados e um `FeatureGate` redireciona rotas não liberadas — mas a fonte de verdade é sempre o backend.

**Tech Stack:** Fastify 4, Prisma 5, PostgreSQL, Zod, React 18, React Router 6, React Query, Vitest.

## Global Constraints

- Mensagens ao usuário em português.
- Rotas finas: validação Zod na rota, regra de negócio no service, DTO em `serialize.ts`/`@legends/shared`.
- Migrations geradas com `pnpm db:migrate` (nunca editar uma migration já aplicada).
- Testes de API exigem Postgres real (`pnpm db:up`); rodar só o arquivo alterado durante a implementação, suíte completa (`pnpm test`) só como verificação final.
- Mudar o contrato em `@legends/shared` primeiro, depois ajustar api/web.
- Sem verificação de e-mail/domínio no cadastro do convite; convite de uso único, com `expiresAt`/`revokedAt`.
- Roles existentes (`LEGEND`, `LEAD`, `MANAGER`, `HEAD`, `ADMIN`) não sofrem nenhuma mudança de comportamento — `enabledFeatures` só é lido/aplicado quando `role === 'THIRD_PARTY'`.

---

## Mapeamento rota → feature (referência para as Tasks 7 e 8)

| Chave | Rotas gated | Rotas explicitamente NÃO gated (baseline / compartilhadas) |
|---|---|---|
| `votar` | `POST /votes`, `GET /votes/me` | — |
| `selos` | `GET /badges` | `GET /users/:id/badges` (aparece no perfil, que é baseline) |
| `destaques` | `GET /highlights` | — |
| `notificacoes` | `GET /notifications/unread-count`, `GET /notifications`, `POST /notifications/read`, `DELETE /notifications/read`, `POST /notifications/:id/read` | — |
| `resenha` | todas as rotas em `review.ts` (`/reviews*`) | — |
| `quinta-desenvolvimento` | `GET /development-thursday/events`, `GET /development-thursday/events/:id/feedbacks`, `POST /development-thursday/events/:id/feedbacks` | `POST/PATCH/DELETE /development-thursday/events` (gestão do evento; qualquer usuário autenticado pode hoje — fora de escopo mudar isso) |
| `retrospectivas` | todas as rotas em `retro.ts` (`/retro/*` exceto ws) e a conexão `retro-ws.ts` | — |
| `escritorio` | `GET /office/map`, `/office/map/edit/*`, `POST /office/media-token`, `GET /office/config`, conexão `office-ws.ts` | `/admin/office-maps*`, `/admin/office-desks*` (admin-only, terceirizado nunca é admin) |
| `time` | — (só frontend: nav + `FeatureGate` na rota `/time`) | `GET /users` (reusado por `/votar`, ungate-lo quebraria a votação) |
| `lendas` | `GET /users/showcase` | — |

`GET /mural`, `GET /categories`, `GET /periods/*`, `GET /character-favorites`, `/me/mood/*`, `/me/streak*`, `/uploads/*`, `/gifs/*` continuam sem gate: são infraestrutura da Home/perfil (baseline) ou não expõem nada sensível por si só.

---

### Task 1: Contrato compartilhado — role, features e DTOs de convite

**Files:**
- Modify: `packages/shared/src/enums.ts`
- Modify: `packages/shared/src/auth.ts`
- Create: `packages/shared/src/third-party.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `UserRole` incluindo `'THIRD_PARTY'`; `THIRD_PARTY_FEATURE_KEYS`, `ThirdPartyFeatureKey`, `THIRD_PARTY_FEATURE_LABELS`, `THIRD_PARTY_INVITE_MIN_MINUTES`, `THIRD_PARTY_INVITE_MAX_MINUTES`, `ThirdPartyInviteDTO`, `ThirdPartyInvitePublicDTO`, `CreateThirdPartyInviteRequest`, `CreateThirdPartyInviteResponse`, `ThirdPartyInviteListResponse`, `AcceptThirdPartyInviteRequest`; `PublicUser.enabledFeatures: ThirdPartyFeatureKey[]`.

- [ ] **Step 1: Adicionar a role e o rótulo em `enums.ts`**

Em `packages/shared/src/enums.ts`, altere:

```ts
export const USER_ROLES = ['LEGEND', 'LEAD', 'MANAGER', 'HEAD', 'ADMIN', 'THIRD_PARTY'] as const
export type UserRole = (typeof USER_ROLES)[number]

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  LEGEND: 'Lenda',
  LEAD: 'Líder',
  MANAGER: 'Gerente',
  HEAD: 'Head',
  ADMIN: 'Admin',
  THIRD_PARTY: 'Terceirizado',
}
```

- [ ] **Step 2: Criar `packages/shared/src/third-party.ts`**

```ts
export const THIRD_PARTY_FEATURE_KEYS = [
  'time',
  'lendas',
  'votar',
  'selos',
  'destaques',
  'notificacoes',
  'resenha',
  'quinta-desenvolvimento',
  'retrospectivas',
  'escritorio',
] as const
export type ThirdPartyFeatureKey = (typeof THIRD_PARTY_FEATURE_KEYS)[number]

export const THIRD_PARTY_FEATURE_LABELS: Record<ThirdPartyFeatureKey, string> = {
  time: 'Time',
  lendas: 'Lendas',
  votar: 'Votar',
  selos: 'Galeria de selos',
  destaques: 'Destaques',
  notificacoes: 'Notificações',
  resenha: 'Resenha',
  'quinta-desenvolvimento': 'Quinta de Dev',
  retrospectivas: 'Retrospectivas',
  escritorio: 'Escritório',
}

export const THIRD_PARTY_INVITE_MIN_MINUTES = 60
export const THIRD_PARTY_INVITE_MAX_MINUTES = 14 * 24 * 60

export interface ThirdPartyInviteDTO {
  id: string
  url: string | null
  enabledFeatures: ThirdPartyFeatureKey[]
  expiresAt: string
  createdAt: string
  usedAt: string | null
  revokedAt: string | null
}

export interface ThirdPartyInvitePublicDTO {
  createdByName: string
  expiresAt: string
}

export interface CreateThirdPartyInviteRequest {
  expiresInMinutes: number
  enabledFeatures: ThirdPartyFeatureKey[]
}

export interface CreateThirdPartyInviteResponse {
  invite: ThirdPartyInviteDTO
}

export interface ThirdPartyInviteListResponse {
  invites: ThirdPartyInviteDTO[]
}

export interface AcceptThirdPartyInviteRequest {
  name: string
  email: string
  password: string
}
```

- [ ] **Step 3: Estender `PublicUser` em `auth.ts`**

Em `packages/shared/src/auth.ts`, adicione o import e o campo:

```ts
import type { UserRole, Area } from './enums'
import type { AvatarStyleKey } from './avatar'
import type { CharacterOptions } from './character'
import type { ThirdPartyFeatureKey } from './third-party'

export interface PublicUser {
  id: string
  name: string
  email: string | null
  role: UserRole
  area: Area | null
  position: string | null
  squad: string | null
  photoUrl: string | null
  avatarStyle: AvatarStyleKey | null
  avatarSeed: string | null
  avatarOptions: CharacterOptions | null
  active: boolean
  joinedAt: string
  leftAt: string | null
  enabledFeatures: ThirdPartyFeatureKey[]
}
```

- [ ] **Step 4: Exportar o novo módulo no barrel**

Em `packages/shared/src/index.ts`, adicione (ordem alfabética não é exigida pelo arquivo existente; adicione ao final):

```ts
export * from './third-party'
```

- [ ] **Step 5: Typecheck do pacote compartilhado**

Run: `pnpm --filter @legends/shared exec tsc --noEmit`
Expected: falha apontando `apps/api`/`apps/web` como consumidores desatualizados de `PublicUser` (ainda não implementados) — nesse momento é esperado; o pacote em si (`packages/shared`) deve compilar sem erro. Se `tsc --noEmit` do pacote isolado não existir como script, rode `pnpm --filter @legends/shared build` e confirme que não há erro de tipo dentro do próprio pacote.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/enums.ts packages/shared/src/auth.ts packages/shared/src/third-party.ts packages/shared/src/index.ts
git commit -m "feat(shared): contrato da role de terceirizados e features controláveis"
```

---

### Task 2: Prisma — role, `enabledFeatures` e tabela `ThirdPartyInvite`

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: migration via `pnpm db:migrate` (nome sugerido: `add_third_party_role`)

**Interfaces:**
- Produces: enum `UserRole` com `THIRD_PARTY`; `User.enabledFeatures Json`; model `ThirdPartyInvite` com campos `id, tokenHash, createdById, enabledFeatures, expiresAt, usedAt, revokedAt, createdAt`.

- [ ] **Step 1: Editar o enum `UserRole` em `schema.prisma`**

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

- [ ] **Step 2: Adicionar `enabledFeatures` ao model `User`**

Logo após a linha `role         UserRole @default(LEGEND)` (schema.prisma:82), adicione:

```prisma
  enabledFeatures Json     @default("[]")
```

E, junto às relações do `User` (próximo às demais `@relation`), adicione:

```prisma
  thirdPartyInvitesCreated ThirdPartyInvite[] @relation("ThirdPartyInvitesCreated")
```

- [ ] **Step 3: Adicionar o model `ThirdPartyInvite`**

Ao final do arquivo (ou próximo a `OfficeGuestInvite`, se existir no schema — confirme com `grep -n "model OfficeGuestInvite" apps/api/prisma/schema.prisma` e posicione ao lado):

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

- [ ] **Step 4: Gerar e aplicar a migration**

Run: `pnpm db:up` (garante o Postgres de pé), depois `pnpm db:migrate` e, quando solicitado o nome, use `add_third_party_role`.
Expected: uma nova pasta em `apps/api/prisma/migrations/<timestamp>_add_third_party_role/` com o SQL de `ALTER TYPE "UserRole" ADD VALUE 'THIRD_PARTY'`, `ALTER TABLE "User" ADD COLUMN "enabledFeatures" ...` e `CREATE TABLE "ThirdPartyInvite" ...`; Prisma Client regenerado sem erro.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(api): migration da role de terceirizados e da tabela de convites"
```

---

### Task 3: Backend — helper de refresh cookie, assinatura de JWT com features e decorator `requireFeature`

**Files:**
- Create: `apps/api/src/lib/refresh-cookie.ts`
- Create: `apps/api/src/lib/jwt.ts`
- Modify: `apps/api/src/routes/auth.ts`
- Modify: `apps/api/src/types/fastify.d.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/lib/jwt.test.ts`

**Interfaces:**
- Produces: `signAccessToken(app: FastifyInstance, user: User): string` (assinado com `sub`, `role` e, se `role === 'THIRD_PARTY'`, `features: string[]`); `app.requireFeature(key: string)` (retorna um hook `onRequest`); `refreshCookieOptions(persistent, expiresAt)`, `clearRefreshCookieOptions()`, `REFRESH_COOKIE`.
- Consumes: nada de tasks anteriores (usa `User` do `@prisma/client`, já existente).

- [ ] **Step 1: Extrair os helpers de cookie de `auth.ts` para `lib/refresh-cookie.ts`**

Crie `apps/api/src/lib/refresh-cookie.ts`:

```ts
// O path '/api/auth' precisa casar com o prefixo /api visto pelo navegador
// (o front sempre chama /api/auth/...); senão o cookie não é enviado no refresh.
export const REFRESH_COOKIE = 'legends.refresh'

export function refreshCookieOptions(persistent: boolean, expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/api/auth',
    ...(persistent ? { expires: expiresAt } : {}),
  }
}

export function clearRefreshCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/api/auth',
  }
}
```

Em `apps/api/src/routes/auth.ts`, remova as três declarações equivalentes (linhas 40-59 do arquivo atual: `REFRESH_COOKIE`, `refreshCookieOptions`, `clearRefreshCookieOptions`) e importe do novo módulo:

```ts
import { REFRESH_COOKIE, refreshCookieOptions, clearRefreshCookieOptions } from '../lib/refresh-cookie'
```

- [ ] **Step 2: Criar `lib/jwt.ts` com `signAccessToken`**

```ts
import type { FastifyInstance } from 'fastify'
import type { User } from '@prisma/client'

export interface AccessTokenPayload {
  sub: string
  role: string
  features?: string[]
}

export function signAccessToken(app: FastifyInstance, user: User): string {
  const payload: AccessTokenPayload = { sub: user.id, role: user.role }
  if (user.role === 'THIRD_PARTY') {
    payload.features = Array.isArray(user.enabledFeatures) ? (user.enabledFeatures as string[]) : []
  }
  return app.jwt.sign(payload)
}
```

- [ ] **Step 3: Teste de `signAccessToken`**

Crie `apps/api/src/lib/jwt.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildApp } from '../app'
import { signAccessToken } from './jwt'

describe('signAccessToken', () => {
  it('inclui features apenas para THIRD_PARTY', async () => {
    const app = buildApp()
    await app.ready()

    const legend = { id: 'u1', role: 'LEGEND', enabledFeatures: ['votar'] } as any
    const legendToken = signAccessToken(app, legend)
    const legendPayload = app.jwt.verify(legendToken) as { role: string; features?: string[] }
    expect(legendPayload.role).toBe('LEGEND')
    expect(legendPayload.features).toBeUndefined()

    const thirdParty = { id: 'u2', role: 'THIRD_PARTY', enabledFeatures: ['escritorio', 'time'] } as any
    const thirdPartyToken = signAccessToken(app, thirdParty)
    const thirdPartyPayload = app.jwt.verify(thirdPartyToken) as { role: string; features?: string[] }
    expect(thirdPartyPayload.role).toBe('THIRD_PARTY')
    expect(thirdPartyPayload.features).toEqual(['escritorio', 'time'])

    await app.close()
  })
})
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/api exec vitest run src/lib/jwt.test.ts`
Expected: PASS (não depende de banco).

- [ ] **Step 5: Atualizar `types/fastify.d.ts`**

```ts
import '@fastify/jwt'
import type { FastifyReply, FastifyRequest } from 'fastify'

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    requireFeature: (key: string) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; role: string; features?: string[] }
    user: { sub: string; role: string; features?: string[] }
  }
}
```

- [ ] **Step 6: Adicionar o decorator `requireFeature` em `app.ts`**

Após o `app.decorate('requireAdmin', ...)` existente (app.ts:56-60), adicione:

```ts
  app.decorate('requireFeature', function (key: string) {
    return async function (request, reply) {
      if (request.user.role !== 'THIRD_PARTY') return
      const features = request.user.features ?? []
      if (!features.includes(key)) {
        return reply.code(403).send({ message: 'Acesso não liberado para este usuário' })
      }
    }
  })
```

- [ ] **Step 7: Trocar as três chamadas de `app.jwt.sign` em `auth.ts` por `signAccessToken`**

Em `apps/api/src/routes/auth.ts`, importe `signAccessToken` de `../lib/jwt` e troque as três ocorrências de:

```ts
const accessToken = app.jwt.sign({ sub: user.id, role: user.role })
```

por:

```ts
const accessToken = signAccessToken(app, user)
```

(linhas 84, 107 e 136 do arquivo atual — register, login e refresh).

- [ ] **Step 8: Rodar os testes existentes de auth para garantir que nada quebrou**

Run: `pnpm db:up && pnpm --filter @legends/api exec vitest run src/routes/auth.test.ts src/routes/auth.refresh.test.ts src/routes/auth.routes.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/lib/refresh-cookie.ts apps/api/src/lib/jwt.ts apps/api/src/lib/jwt.test.ts apps/api/src/routes/auth.ts apps/api/src/types/fastify.d.ts apps/api/src/app.ts
git commit -m "feat(api): assina enabledFeatures no JWT e adiciona decorator requireFeature"
```

---

### Task 4: Backend — `third-party-invite-service.ts`

**Files:**
- Create: `apps/api/src/services/third-party-invite-service.ts`
- Test: `apps/api/src/services/third-party-invite-service.test.ts`

**Interfaces:**
- Consumes: `signAccessToken` (Task 3, `../lib/jwt`), `issueRefreshTokenForLogin` (`./refresh-token-service`), `hashPassword` (`../lib/password`), `THIRD_PARTY_FEATURE_KEYS`, `ThirdPartyFeatureKey`, `THIRD_PARTY_INVITE_MIN_MINUTES`, `THIRD_PARTY_INVITE_MAX_MINUTES` (`@legends/shared`, Task 1).
- Produces: `ThirdPartyInviteError` (classe com `status`), `createThirdPartyInvite(createdById, expiresInMinutes, enabledFeatures)`, `getValidThirdPartyInvite(rawToken)`, `acceptThirdPartyInvite(app, { token, name, email, password })` retornando `{ accessToken: string; user: User; refresh: IssuedRefresh }`.

- [ ] **Step 1: Escrever o teste de criação e validação do convite**

Crie `apps/api/src/services/third-party-invite-service.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { prisma } from '../lib/prisma'
import {
  ThirdPartyInviteError,
  createThirdPartyInvite,
  getValidOfficeGuestInviteLikeError,
} from './third-party-invite-service'

describe('third-party-invite-service', () => {
  it('cria convite com features clampeadas e valida token inválido', async () => {
    const admin = await prisma.user.create({
      data: { name: 'Admin', email: 'admin@x.com', passwordHash: 'x', role: 'ADMIN' },
    })
    const { invite, rawToken } = await createThirdPartyInvite(admin.id, 5, ['escritorio', 'time'])
    expect(invite.expiresAt.getTime()).toBeGreaterThan(Date.now())
    expect(rawToken).toHaveLength(43)

    await expect(getValidOfficeGuestInviteLikeError('token-invalido')).rejects.toThrow(ThirdPartyInviteError)
  })
})
```

Ajuste o nome do segundo helper testado no passo abaixo — ele deve se chamar `getValidThirdPartyInvite` (o nome de teste acima é só um placeholder de rascunho; substitua por esse nome real antes de rodar):

```ts
    await expect(getValidThirdPartyInvite('token-invalido')).rejects.toThrow(ThirdPartyInviteError)
```

E ajuste o import:

```ts
import {
  ThirdPartyInviteError,
  createThirdPartyInvite,
  getValidThirdPartyInvite,
} from './third-party-invite-service'
```

- [ ] **Step 2: Rodar o teste e confirmar que falha (módulo não existe)**

Run: `pnpm db:up && pnpm --filter @legends/api exec vitest run src/services/third-party-invite-service.test.ts`
Expected: FAIL com erro de módulo não encontrado (`third-party-invite-service`).

- [ ] **Step 3: Implementar o service**

Crie `apps/api/src/services/third-party-invite-service.ts`:

```ts
import { randomBytes, createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { User } from '@prisma/client'
import {
  THIRD_PARTY_INVITE_MAX_MINUTES,
  THIRD_PARTY_INVITE_MIN_MINUTES,
  type ThirdPartyFeatureKey,
} from '@legends/shared'
import { prisma } from '../lib/prisma'
import { hashPassword } from '../lib/password'
import { signAccessToken } from '../lib/jwt'
import { issueRefreshTokenForLogin, type IssuedRefresh } from './refresh-token-service'

export class ThirdPartyInviteError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message)
    this.name = 'ThirdPartyInviteError'
  }
}

export function hashThirdPartyInviteToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function newRawToken(): string {
  return randomBytes(32).toString('base64url')
}

function clampDuration(minutes: number): number {
  return Math.min(THIRD_PARTY_INVITE_MAX_MINUTES, Math.max(THIRD_PARTY_INVITE_MIN_MINUTES, minutes))
}

export async function createThirdPartyInvite(
  createdById: string,
  expiresInMinutes: number,
  enabledFeatures: ThirdPartyFeatureKey[],
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
  return { invite, rawToken }
}

export async function listThirdPartyInvites() {
  return prisma.thirdPartyInvite.findMany({ orderBy: { createdAt: 'desc' } })
}

export async function revokeThirdPartyInvite(id: string): Promise<void> {
  await prisma.thirdPartyInvite.updateMany({
    where: { id, usedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

export async function getValidThirdPartyInvite(rawToken: string) {
  const invite = await prisma.thirdPartyInvite.findUnique({
    where: { tokenHash: hashThirdPartyInviteToken(rawToken) },
    include: { createdBy: { select: { name: true } } },
  })
  if (!invite || invite.usedAt || invite.revokedAt || invite.expiresAt.getTime() <= Date.now()) {
    throw new ThirdPartyInviteError('Convite expirado ou inválido', 404)
  }
  return invite
}

export interface AcceptedThirdParty {
  accessToken: string
  user: User
  refresh: IssuedRefresh
}

export async function acceptThirdPartyInvite(
  app: FastifyInstance,
  input: { token: string; name: string; email: string; password: string },
): Promise<AcceptedThirdParty> {
  const invite = await getValidThirdPartyInvite(input.token)
  const existing = await prisma.user.findUnique({ where: { email: input.email } })
  if (existing) {
    throw new ThirdPartyInviteError('E-mail já cadastrado', 409)
  }

  const passwordHash = await hashPassword(input.password)
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash,
        role: 'THIRD_PARTY',
        enabledFeatures: invite.enabledFeatures as ThirdPartyFeatureKey[],
      },
    })
    const claimed = await tx.thirdPartyInvite.updateMany({
      where: { id: invite.id, usedAt: null, revokedAt: null },
      data: { usedAt: new Date() },
    })
    if (claimed.count !== 1) {
      throw new ThirdPartyInviteError('Convite expirado ou inválido', 404)
    }
    return created
  })

  const accessToken = signAccessToken(app, user)
  const refresh = await issueRefreshTokenForLogin(user.id, false)
  return { accessToken, user, refresh }
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/api exec vitest run src/services/third-party-invite-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Adicionar teste de aceite completo (convite → conta → uso único)**

Adicione ao mesmo arquivo de teste:

```ts
import { acceptThirdPartyInvite, getValidThirdPartyInvite as _unused } from './third-party-invite-service'
import { buildApp } from '../app'

it('aceita o convite criando a conta e bloqueia reuso', async () => {
  const app = buildApp()
  await app.ready()
  const admin = await prisma.user.create({
    data: { name: 'Admin', email: `admin-${Date.now()}@x.com`, passwordHash: 'x', role: 'ADMIN' },
  })
  const { rawToken } = await createThirdPartyInvite(admin.id, 120, ['escritorio'])

  const accepted = await acceptThirdPartyInvite(app, {
    token: rawToken,
    name: 'Fulano',
    email: `terceirizado-${Date.now()}@x.com`,
    password: 'senha1234',
  })
  expect(accepted.user.role).toBe('THIRD_PARTY')
  expect(accepted.user.enabledFeatures).toEqual(['escritorio'])
  expect(accepted.accessToken).toBeTruthy()

  await expect(
    acceptThirdPartyInvite(app, {
      token: rawToken,
      name: 'Outro',
      email: `outro-${Date.now()}@x.com`,
      password: 'senha1234',
    }),
  ).rejects.toThrow(ThirdPartyInviteError)

  await app.close()
})
```

Remova o import não usado `_unused` (foi só ilustrativo) — mantenha apenas os imports realmente usados no arquivo final:

```ts
import { describe, expect, it } from 'vitest'
import { prisma } from '../lib/prisma'
import { buildApp } from '../app'
import {
  ThirdPartyInviteError,
  createThirdPartyInvite,
  getValidThirdPartyInvite,
  acceptThirdPartyInvite,
} from './third-party-invite-service'
```

- [ ] **Step 6: Rodar todos os testes do arquivo**

Run: `pnpm --filter @legends/api exec vitest run src/services/third-party-invite-service.test.ts`
Expected: PASS (todos os `it`).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/third-party-invite-service.ts apps/api/src/services/third-party-invite-service.test.ts
git commit -m "feat(api): service de convite de terceirizado (criação, validação, aceite)"
```

---

### Task 5: Backend — rotas de convite de terceirizado

**Files:**
- Create: `apps/api/src/routes/third-party-invites.ts`
- Modify: `apps/api/src/app.ts`
- Test: `apps/api/src/routes/third-party-invites.test.ts`

**Interfaces:**
- Consumes: `createThirdPartyInvite`, `getValidThirdPartyInvite`, `acceptThirdPartyInvite`, `listThirdPartyInvites`, `revokeThirdPartyInvite`, `ThirdPartyInviteError` (Task 4); `REFRESH_COOKIE`, `refreshCookieOptions` (Task 3, `../lib/refresh-cookie`); `toPublicUser` (`../lib/serialize`, já existente); `THIRD_PARTY_FEATURE_KEYS`, `THIRD_PARTY_INVITE_MIN_MINUTES`, `THIRD_PARTY_INVITE_MAX_MINUTES`, `AuthResponse` (`@legends/shared`).
- Produces: rotas `POST /admin/third-party-invites`, `GET /admin/third-party-invites`, `POST /admin/third-party-invites/:id/revoke`, `GET /third-party-invites/:token`, `POST /third-party-invites/:token/accept`.

- [ ] **Step 1: Escrever o teste de ponta a ponta (admin cria, público consulta e aceita)**

Crie `apps/api/src/routes/third-party-invites.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

async function makeToken(app: ReturnType<typeof buildApp>, role: 'ADMIN' | 'LEGEND') {
  const user = await prisma.user.create({
    data: { name: role, email: `${role.toLowerCase()}-${Date.now()}@x.com`, passwordHash: 'x', role },
  })
  return app.jwt.sign({ sub: user.id, role })
}

describe('third-party invites', () => {
  it('admin cria convite, terceirizado consulta e aceita; só admin pode criar', async () => {
    const app = buildApp()
    await app.ready()
    const adminToken = await makeToken(app, 'ADMIN')
    const legendToken = await makeToken(app, 'LEGEND')

    const forbidden = await app.inject({
      method: 'POST',
      url: '/admin/third-party-invites',
      headers: { authorization: `Bearer ${legendToken}` },
      payload: { expiresInMinutes: 120, enabledFeatures: ['escritorio'] },
    })
    expect(forbidden.statusCode).toBe(403)

    const created = await app.inject({
      method: 'POST',
      url: '/admin/third-party-invites',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { expiresInMinutes: 120, enabledFeatures: ['escritorio', 'time'] },
    })
    expect(created.statusCode).toBe(201)
    const url = new URL(created.json().invite.url)
    const rawToken = url.pathname.split('/').at(-1)!

    const publicInvite = await app.inject({ method: 'GET', url: `/third-party-invites/${rawToken}` })
    expect(publicInvite.statusCode).toBe(200)
    expect(publicInvite.json()).not.toHaveProperty('enabledFeatures')

    const accepted = await app.inject({
      method: 'POST',
      url: `/third-party-invites/${rawToken}/accept`,
      payload: { name: 'Fulano', email: `fulano-${Date.now()}@x.com`, password: 'senha1234' },
    })
    expect(accepted.statusCode).toBe(201)
    expect(accepted.json().user.role).toBe('THIRD_PARTY')
    expect(accepted.json().user.enabledFeatures).toEqual(['escritorio', 'time'])

    const reused = await app.inject({
      method: 'POST',
      url: `/third-party-invites/${rawToken}/accept`,
      payload: { name: 'Outro', email: `outro-${Date.now()}@x.com`, password: 'senha1234' },
    })
    expect(reused.statusCode).toBe(404)

    const list = await app.inject({
      method: 'GET',
      url: '/admin/third-party-invites',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(list.statusCode).toBe(200)
    expect(list.json().invites.length).toBeGreaterThan(0)

    await app.close()
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha (rota inexistente)**

Run: `pnpm db:up && pnpm --filter @legends/api exec vitest run src/routes/third-party-invites.test.ts`
Expected: FAIL (404 nas rotas ainda não registradas).

- [ ] **Step 3: Implementar as rotas**

Crie `apps/api/src/routes/third-party-invites.ts`:

```ts
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  THIRD_PARTY_FEATURE_KEYS,
  THIRD_PARTY_INVITE_MAX_MINUTES,
  THIRD_PARTY_INVITE_MIN_MINUTES,
  type CreateThirdPartyInviteResponse,
  type ThirdPartyInviteListResponse,
  type ThirdPartyInvitePublicDTO,
  type AuthResponse,
} from '@legends/shared'
import {
  ThirdPartyInviteError,
  acceptThirdPartyInvite,
  createThirdPartyInvite,
  getValidThirdPartyInvite,
  listThirdPartyInvites,
  revokeThirdPartyInvite,
} from '../services/third-party-invite-service'
import { toPublicUser } from '../lib/serialize'
import { REFRESH_COOKIE, refreshCookieOptions } from '../lib/refresh-cookie'

const createInviteSchema = z.object({
  expiresInMinutes: z.number().int().min(THIRD_PARTY_INVITE_MIN_MINUTES).max(THIRD_PARTY_INVITE_MAX_MINUTES),
  enabledFeatures: z.array(z.enum(THIRD_PARTY_FEATURE_KEYS)),
})

const acceptSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8),
})

const tokenParamsSchema = z.object({ token: z.string().min(16) })
const idParamsSchema = z.object({ id: z.string().min(1) })

function badInput(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ message: 'Dados inválidos', issues: error.issues })
}

function inviteUrl(request: { protocol: string; hostname: string; headers: Record<string, unknown> }, token: string): string {
  const host = typeof request.headers.host === 'string' ? request.headers.host : request.hostname
  return `${request.protocol}://${host}/terceirizado/convite/${encodeURIComponent(token)}`
}

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
    return reply.code(201).send({
      invite: {
        id: invite.id,
        url: inviteUrl(request, rawToken),
        enabledFeatures: invite.enabledFeatures as string[],
        expiresAt: invite.expiresAt.toISOString(),
        createdAt: invite.createdAt.toISOString(),
        usedAt: null,
        revokedAt: null,
      },
    })
  })

  app.get('/admin/third-party-invites', adminOnly, async (_request, reply): Promise<ThirdPartyInviteListResponse> => {
    const invites = await listThirdPartyInvites()
    return reply.send({
      invites: invites.map((invite) => ({
        id: invite.id,
        url: null,
        enabledFeatures: invite.enabledFeatures as string[],
        expiresAt: invite.expiresAt.toISOString(),
        createdAt: invite.createdAt.toISOString(),
        usedAt: invite.usedAt ? invite.usedAt.toISOString() : null,
        revokedAt: invite.revokedAt ? invite.revokedAt.toISOString() : null,
      })),
    })
  })

  app.post('/admin/third-party-invites/:id/revoke', adminOnly, async (request, reply) => {
    const parsed = idParamsSchema.safeParse(request.params)
    if (!parsed.success) return badInput(reply, parsed.error)
    await revokeThirdPartyInvite(parsed.data.id)
    return reply.code(204).send()
  })

  app.get('/third-party-invites/:token', async (request, reply): Promise<ThirdPartyInvitePublicDTO | FastifyReply> => {
    const parsed = tokenParamsSchema.safeParse(request.params)
    if (!parsed.success) return badInput(reply, parsed.error)
    try {
      const invite = await getValidThirdPartyInvite(parsed.data.token)
      return { createdByName: invite.createdBy.name, expiresAt: invite.expiresAt.toISOString() }
    } catch (err) {
      if (err instanceof ThirdPartyInviteError) {
        return reply.code(err.status).send({ message: err.message })
      }
      throw err
    }
  })

  app.post('/third-party-invites/:token/accept', async (request, reply): Promise<AuthResponse | FastifyReply> => {
    const params = tokenParamsSchema.safeParse(request.params)
    const body = acceptSchema.safeParse(request.body)
    if (!params.success) return badInput(reply, params.error)
    if (!body.success) return badInput(reply, body.error)
    try {
      const { accessToken, user, refresh } = await acceptThirdPartyInvite(app, {
        token: params.data.token,
        ...body.data,
      })
      reply.setCookie(REFRESH_COOKIE, refresh.rawToken, refreshCookieOptions(refresh.persistent, refresh.expiresAt))
      return reply.code(201).send({ accessToken, user: toPublicUser(user) })
    } catch (err) {
      if (err instanceof ThirdPartyInviteError) {
        return reply.code(err.status).send({ message: err.message })
      }
      throw err
    }
  })
}
```

- [ ] **Step 4: Registrar as rotas em `app.ts`**

Adicione o import junto aos demais em `apps/api/src/app.ts`:

```ts
import { thirdPartyInviteRoutes } from './routes/third-party-invites'
```

E o registro junto aos demais `app.register(...)`:

```ts
  app.register(thirdPartyInviteRoutes)
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/api exec vitest run src/routes/third-party-invites.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/third-party-invites.ts apps/api/src/app.ts apps/api/src/routes/third-party-invites.test.ts
git commit -m "feat(api): rotas de convite de terceirizado (criar, consultar, aceitar, revogar)"
```

---

### Task 6: Backend — gestão de terceirizados em `/admin/users`

**Files:**
- Modify: `apps/api/src/routes/admin.ts`
- Test: `apps/api/src/routes/admin.test.ts`

**Interfaces:**
- Consumes: `THIRD_PARTY_FEATURE_KEYS` (`@legends/shared`, Task 1).
- Produces: `GET /admin/users` passa a excluir `THIRD_PARTY` (além de `ADMIN`) da listagem de colaboradores; nova rota `GET /admin/third-party-users` lista só `role: 'THIRD_PARTY'`; `PATCH /admin/users/:id` aceita `enabledFeatures` (só persiste se o usuário-alvo, após a atualização, tiver `role === 'THIRD_PARTY'`).

- [ ] **Step 1: Escrever o teste do novo comportamento**

Adicione a `apps/api/src/routes/admin.test.ts` (ao final do `describe` existente mais próximo de usuários, ou em um novo `describe`):

```ts
describe('terceirizados em /admin/users', () => {
  it('exclui THIRD_PARTY de /admin/users, lista em /admin/third-party-users e valida enabledFeatures', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await prisma.user.create({
      data: { name: 'Admin', email: `admin-${Date.now()}@x.com`, passwordHash: 'x', role: 'ADMIN' },
    })
    const adminToken = app.jwt.sign({ sub: admin.id, role: 'ADMIN' })
    const thirdParty = await prisma.user.create({
      data: {
        name: 'Terceirizado',
        email: `terceirizado-${Date.now()}@x.com`,
        passwordHash: 'x',
        role: 'THIRD_PARTY',
        enabledFeatures: ['escritorio'],
      },
    })

    const collaborators = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(collaborators.json().users.some((u: { id: string }) => u.id === thirdParty.id)).toBe(false)

    const thirdPartyUsers = await app.inject({
      method: 'GET',
      url: '/admin/third-party-users',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(thirdPartyUsers.statusCode).toBe(200)
    expect(thirdPartyUsers.json().users.map((u: { id: string }) => u.id)).toEqual([thirdParty.id])

    const updated = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${thirdParty.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { enabledFeatures: ['escritorio', 'lendas'] },
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json().user.enabledFeatures).toEqual(['escritorio', 'lendas'])

    await app.close()
  })
})
```

*(Ajuste os imports do topo do arquivo se `buildApp`/`prisma` ainda não estiverem importados sob esses nomes — confirme com `head -10 apps/api/src/routes/admin.test.ts` antes de colar.)*

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm db:up && pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts`
Expected: FAIL (`/admin/third-party-users` inexistente e/ou `THIRD_PARTY` ainda aparecendo em `/admin/users`).

- [ ] **Step 3: Ajustar `GET /admin/users` para excluir `THIRD_PARTY`**

Em `apps/api/src/routes/admin.ts:226`, troque:

```ts
    const users = await prisma.user.findMany({ where: { role: { not: 'ADMIN' } }, orderBy: { name: 'asc' } })
```

por:

```ts
    const users = await prisma.user.findMany({ where: { role: { notIn: ['ADMIN', 'THIRD_PARTY'] } }, orderBy: { name: 'asc' } })
```

- [ ] **Step 4: Adicionar `GET /admin/third-party-users`**

Logo após o handler de `GET /admin/users` (antes de `POST /admin/users`), adicione:

```ts
  app.get('/admin/third-party-users', adminOnly, async (_request, reply) => {
    const users = await prisma.user.findMany({ where: { role: 'THIRD_PARTY' }, orderBy: { name: 'asc' } })
    return reply.send({ users: users.map(toAdminUser) })
  })
```

- [ ] **Step 5: Estender `updateUserSchema` e o handler de `PATCH /admin/users/:id`**

Em `apps/api/src/routes/admin.ts`, importe `THIRD_PARTY_FEATURE_KEYS` junto aos demais imports de `@legends/shared` (linha 15) e estenda o schema (linha 58-72):

```ts
const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
  position: z.string().optional(),
  squad: z.string().optional(),
  active: z.boolean().optional(),
  joinedAt: z.coerce.date().optional(),
  leftAt: z.coerce.date().nullable().optional(),
  role: z.enum(USER_ROLES).optional(),
  area: z.enum(AREAS).nullable().optional(),
  teamsWebhookUrl: teamsWebhookUrlSchema,
  enabledFeatures: z.array(z.enum(THIRD_PARTY_FEATURE_KEYS)).optional(),
})
```

No handler `app.patch('/admin/users/:id', ...)` (linha 259), busque o usuário atual antes de decidir se `enabledFeatures` pode ser persistido:

```ts
  app.patch('/admin/users/:id', adminOnly, async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = updateUserSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos' })
    }
    if (parsed.data.role && parsed.data.role !== 'ADMIN' && id === request.user.sub) {
      return reply.code(400).send({ message: 'Você não pode remover seu próprio papel de administrador.' })
    }
    const existing = await prisma.user.findUnique({ where: { id } })
    if (!existing) {
      return reply.code(404).send({ message: 'Usuário não encontrado' })
    }
    const effectiveRole = parsed.data.role ?? existing.role
    if (parsed.data.enabledFeatures !== undefined && effectiveRole !== 'THIRD_PARTY') {
      return reply.code(400).send({ message: 'enabledFeatures só é válido para o papel Terceirizado.' })
    }
    const { password, ...rest } = parsed.data
    if (rest.teamsWebhookUrl === '') rest.teamsWebhookUrl = null
    const data = password ? { ...rest, passwordHash: await hashPassword(password) } : rest
    try {
      const user = await prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({ where: { id }, data })
        if (!updated.active || updated.leftAt) {
          await tx.squadMember.deleteMany({ where: { userId: id } })
          await tx.squad.updateMany({ where: { leaderId: id }, data: { leaderId: null } })
        }
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
  })
```

- [ ] **Step 6: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/src/routes/admin.test.ts
git commit -m "feat(api): gestão de terceirizados e enabledFeatures em /admin/users"
```

---

### Task 7: Backend — gates de feature em votes/badges/highlights/notifications/resenha/quinta-dev/retro

**Files:**
- Modify: `apps/api/src/routes/votes.ts`
- Modify: `apps/api/src/routes/badges.ts`
- Modify: `apps/api/src/routes/highlights.ts`
- Modify: `apps/api/src/routes/notifications.ts`
- Modify: `apps/api/src/routes/review.ts`
- Modify: `apps/api/src/routes/development-thursday.ts`
- Modify: `apps/api/src/routes/retro.ts`
- Modify: `apps/api/src/routes/retro-ws.ts`
- Test: `apps/api/src/routes/feature-gate.test.ts`

**Interfaces:**
- Consumes: `app.requireFeature(key)` (Task 3).

- [ ] **Step 1: Escrever um teste único cobrindo o gate em cada rota REST afetada**

Crie `apps/api/src/routes/feature-gate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

async function makeThirdParty(app: ReturnType<typeof buildApp>, enabledFeatures: string[]) {
  const user = await prisma.user.create({
    data: {
      name: 'Terceirizado',
      email: `terceirizado-${Date.now()}-${Math.random()}@x.com`,
      passwordHash: 'x',
      role: 'THIRD_PARTY',
      enabledFeatures,
    },
  })
  return app.jwt.sign({ sub: user.id, role: 'THIRD_PARTY', features: enabledFeatures })
}

describe('gate de features para terceirizados', () => {
  it('bloqueia rotas de features não liberadas e libera as habilitadas', async () => {
    const app = buildApp()
    await app.ready()

    const noneToken = await makeThirdParty(app, [])
    const votarToken = await makeThirdParty(app, ['votar'])
    const selosToken = await makeThirdParty(app, ['selos'])
    const destaquesToken = await makeThirdParty(app, ['destaques'])
    const notifToken = await makeThirdParty(app, ['notificacoes'])
    const resenhaToken = await makeThirdParty(app, ['resenha'])
    const devToken = await makeThirdParty(app, ['quinta-desenvolvimento'])
    const retroToken = await makeThirdParty(app, ['retrospectivas'])

    const votesBlocked = await app.inject({
      method: 'GET',
      url: '/votes/me',
      headers: { authorization: `Bearer ${noneToken}` },
    })
    expect(votesBlocked.statusCode).toBe(403)
    const votesAllowed = await app.inject({
      method: 'GET',
      url: '/votes/me',
      headers: { authorization: `Bearer ${votarToken}` },
    })
    expect(votesAllowed.statusCode).toBe(200)

    const badgesBlocked = await app.inject({
      method: 'GET',
      url: '/badges',
      headers: { authorization: `Bearer ${noneToken}` },
    })
    expect(badgesBlocked.statusCode).toBe(403)
    const badgesAllowed = await app.inject({
      method: 'GET',
      url: '/badges',
      headers: { authorization: `Bearer ${selosToken}` },
    })
    expect(badgesAllowed.statusCode).toBe(200)

    const highlightsBlocked = await app.inject({
      method: 'GET',
      url: '/highlights',
      headers: { authorization: `Bearer ${noneToken}` },
    })
    expect(highlightsBlocked.statusCode).toBe(403)
    const highlightsAllowed = await app.inject({
      method: 'GET',
      url: '/highlights',
      headers: { authorization: `Bearer ${destaquesToken}` },
    })
    expect(highlightsAllowed.statusCode).toBe(200)

    const notifBlocked = await app.inject({
      method: 'GET',
      url: '/notifications',
      headers: { authorization: `Bearer ${noneToken}` },
    })
    expect(notifBlocked.statusCode).toBe(403)
    const notifAllowed = await app.inject({
      method: 'GET',
      url: '/notifications',
      headers: { authorization: `Bearer ${notifToken}` },
    })
    expect(notifAllowed.statusCode).toBe(200)

    const reviewsBlocked = await app.inject({
      method: 'GET',
      url: '/reviews',
      headers: { authorization: `Bearer ${noneToken}` },
    })
    expect(reviewsBlocked.statusCode).toBe(403)
    const reviewsAllowed = await app.inject({
      method: 'GET',
      url: '/reviews',
      headers: { authorization: `Bearer ${resenhaToken}` },
    })
    expect(reviewsAllowed.statusCode).toBe(200)

    const devBlocked = await app.inject({
      method: 'GET',
      url: '/development-thursday/events',
      headers: { authorization: `Bearer ${noneToken}` },
    })
    expect(devBlocked.statusCode).toBe(403)
    const devAllowed = await app.inject({
      method: 'GET',
      url: '/development-thursday/events',
      headers: { authorization: `Bearer ${devToken}` },
    })
    expect(devAllowed.statusCode).toBe(200)

    const retroBlocked = await app.inject({
      method: 'GET',
      url: '/retro/rooms',
      headers: { authorization: `Bearer ${noneToken}` },
    })
    expect(retroBlocked.statusCode).toBe(403)
    const retroAllowed = await app.inject({
      method: 'GET',
      url: '/retro/rooms',
      headers: { authorization: `Bearer ${retroToken}` },
    })
    expect(retroAllowed.statusCode).toBe(200)

    await app.close()
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm db:up && pnpm --filter @legends/api exec vitest run src/routes/feature-gate.test.ts`
Expected: FAIL (todas as rotas ainda devolvem 200 para `noneToken`).

- [ ] **Step 3: Aplicar o gate em `votes.ts`**

Em `apps/api/src/routes/votes.ts`, troque os dois `onRequest: [app.authenticate]` (rotas `POST /votes` e `GET /votes/me`) por:

```ts
  app.post('/votes', { onRequest: [app.authenticate, app.requireFeature('votar')] }, async (request, reply) => {
```

```ts
  app.get('/votes/me', { onRequest: [app.authenticate, app.requireFeature('votar')] }, async (request, reply) => {
```

- [ ] **Step 4: Aplicar o gate em `badges.ts` (só `/badges`, não `/users/:id/badges`)**

```ts
  app.get('/badges', { onRequest: [app.authenticate, app.requireFeature('selos')] }, async (request, reply) => {
```

(`app.get('/users/:id/badges', ...)` permanece inalterada — é usada dentro do perfil, que é baseline.)

- [ ] **Step 5: Aplicar o gate em `highlights.ts`**

```ts
  app.get('/highlights', { onRequest: [app.authenticate, app.requireFeature('destaques')] }, async (_request, reply) => {
```

- [ ] **Step 6: Aplicar o gate nas 5 rotas de `notifications.ts`**

Troque os cinco `{ onRequest: [app.authenticate] }` por `{ onRequest: [app.authenticate, app.requireFeature('notificacoes')] }` nas rotas `GET /notifications/unread-count`, `GET /notifications`, `POST /notifications/read`, `DELETE /notifications/read` e `POST /notifications/:id/read`.

- [ ] **Step 7: Aplicar o gate em todas as rotas de `review.ts`**

`review.ts` tem 9 rotas, todas com `{ onRequest: [app.authenticate] }` (algumas podem ter checagens adicionais depois — mantenha-as, só acrescente o segundo item do array). Troque cada uma por `{ onRequest: [app.authenticate, app.requireFeature('resenha')] }`: `GET /reviews`, `POST /reviews`, `DELETE /reviews/:id`, `POST /reviews/:id/reactions/toggle`, `POST /reviews/:id/share`, `DELETE /reviews/:id/share`, `GET /reviews/:id/comments`, `POST /reviews/:id/comments`, `DELETE /reviews/comments/:commentId`, e a rota adicional que começa em `app.post(` na linha ~242 (confirme o path com `sed -n '242,260p' apps/api/src/routes/review.ts` antes de editar).

- [ ] **Step 8: Aplicar o gate nas 3 rotas de uso comum de `development-thursday.ts`**

Troque `{ onRequest: [app.authenticate] }` por `{ onRequest: [app.authenticate, app.requireFeature('quinta-desenvolvimento')] }` apenas em `GET /development-thursday/events`, `GET /development-thursday/events/:id/feedbacks` e `POST /development-thursday/events/:id/feedbacks`. **Não** altere `POST/PATCH/DELETE /development-thursday/events` (gestão do evento, fora do escopo desta mudança).

- [ ] **Step 9: Aplicar o gate em todas as rotas REST de `retro.ts`**

`retro.ts` tem 16 rotas, todas com `{ onRequest: [app.authenticate] }`. Troque cada uma por `{ onRequest: [app.authenticate, app.requireFeature('retrospectivas')] }`: `POST /retro/rooms`, `GET /retro/rooms`, `GET /retro/squads`, `GET /retro/rooms/:id`, `PATCH /retro/rooms/:id/participants`, `POST /retro/rooms/:id/phase`, `POST /retro/rooms/:id/anonymous`, `POST /retro/rooms/:id/cards`, `PATCH /retro/rooms/:id/cards/:cardId`, `PATCH /retro/rooms/:id/cards/:cardId/position`, `DELETE /retro/rooms/:id`, `DELETE /retro/rooms/:id/cards/:cardId`, `POST /retro/rooms/:id/cards/:cardId/votes`, `DELETE /retro/rooms/:id/cards/:cardId/votes`, `POST /retro/rooms/:id/cards/:cardId/reactions`, `PATCH /retro/actions/:cardId`, `GET /retro/rooms/:id/carryover`, `POST /retro/rooms/:id/carryover/:cardId`, `GET /retro/rooms/:id/edits`.

- [ ] **Step 10: Gate manual na conexão WebSocket de `retro-ws.ts`**

Em `apps/api/src/routes/retro-ws.ts`, dentro do `preValidation` (linha ~15-21), troque:

```ts
        try {
          const payload = app.jwt.verify(token) as { sub: string; role: string }
          userId = payload.sub
          role = payload.role
        } catch {
          return reply.code(401).send({ message: 'Não autorizado' })
        }
```

por:

```ts
        let features: string[] = []
        try {
          const payload = app.jwt.verify(token) as { sub: string; role: string; features?: string[] }
          userId = payload.sub
          role = payload.role
          features = payload.features ?? []
        } catch {
          return reply.code(401).send({ message: 'Não autorizado' })
        }
        if (role === 'THIRD_PARTY' && !features.includes('retrospectivas')) {
          return reply.code(403).send({ message: 'Acesso não liberado para este usuário' })
        }
```

- [ ] **Step 11: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/api exec vitest run src/routes/feature-gate.test.ts`
Expected: PASS.

- [ ] **Step 12: Rodar a suíte completa de rotas tocadas para garantir que nada quebrou**

Run: `pnpm --filter @legends/api exec vitest run src/routes/votes.test.ts src/routes/badges.test.ts src/routes/highlights.test.ts src/routes/notifications.test.ts src/routes/review.test.ts src/routes/development-thursday.test.ts src/routes/retro.test.ts src/routes/retro-ws.test.ts`
Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add apps/api/src/routes/votes.ts apps/api/src/routes/badges.ts apps/api/src/routes/highlights.ts apps/api/src/routes/notifications.ts apps/api/src/routes/review.ts apps/api/src/routes/development-thursday.ts apps/api/src/routes/retro.ts apps/api/src/routes/retro-ws.ts apps/api/src/routes/feature-gate.test.ts
git commit -m "feat(api): aplica requireFeature nas rotas de votar/selos/destaques/notificações/resenha/quinta-dev/retrô"
```

---

### Task 8: Backend — gate da feature `escritorio` (REST, WebSocket e mídia)

**Files:**
- Modify: `apps/api/src/routes/office-maps.ts`
- Modify: `apps/api/src/routes/office-ws.ts`
- Modify: `apps/api/src/routes/office-media.ts`
- Test: `apps/api/src/routes/office-feature-gate.test.ts`

**Interfaces:**
- Consumes: `app.requireFeature(key)` (Task 3).

- [ ] **Step 1: Escrever o teste cobrindo REST, WS e mídia**

Crie `apps/api/src/routes/office-feature-gate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import { createEmptyMapDocumentV1 } from '@legends/shared'
import { Prisma } from '@prisma/client'

async function seedActiveMap() {
  const document = createEmptyMapDocumentV1({ width: 25, height: 18, tileSize: 32 })
  const map = await prisma.officeMap.create({ data: { name: 'Mapa de teste' } })
  const publication = await prisma.officeMapPublication.create({
    data: { mapId: map.id, version: 1, schemaVersion: document.schemaVersion, mapData: document as unknown as Prisma.InputJsonValue },
  })
  await prisma.officeSetting.create({ data: { id: 1, activeMapPublicationId: publication.id } })
}

async function makeThirdParty(app: ReturnType<typeof buildApp>, enabledFeatures: string[]) {
  const user = await prisma.user.create({
    data: {
      name: 'Terceirizado',
      email: `terceirizado-${Date.now()}-${Math.random()}@x.com`,
      passwordHash: 'x',
      role: 'THIRD_PARTY',
      enabledFeatures,
    },
  })
  return app.jwt.sign({ sub: user.id, role: 'THIRD_PARTY', features: enabledFeatures })
}

describe('gate da feature escritorio', () => {
  it('bloqueia /office/map e /office/config sem a feature, libera com ela', async () => {
    await seedActiveMap()
    const app = buildApp()
    await app.ready()
    const noneToken = await makeThirdParty(app, [])
    const officeToken = await makeThirdParty(app, ['escritorio'])

    const blocked = await app.inject({
      method: 'GET',
      url: '/office/map',
      headers: { authorization: `Bearer ${noneToken}` },
    })
    expect(blocked.statusCode).toBe(403)

    const allowed = await app.inject({
      method: 'GET',
      url: '/office/map',
      headers: { authorization: `Bearer ${officeToken}` },
    })
    expect(allowed.statusCode).toBe(200)

    const configBlocked = await app.inject({
      method: 'GET',
      url: '/office/config',
      headers: { authorization: `Bearer ${noneToken}` },
    })
    expect(configBlocked.statusCode).toBe(403)

    await app.close()
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm db:up && pnpm --filter @legends/api exec vitest run src/routes/office-feature-gate.test.ts`
Expected: FAIL (`/office/map` e `/office/config` devolvem 200 para `noneToken`).

- [ ] **Step 3: Aplicar o gate nas rotas REST de `office-maps.ts`**

Em `apps/api/src/routes/office-maps.ts`, troque:

```ts
  app.get('/office/map', { onRequest: [app.authenticate] }, async (request) => getActiveOfficeMap(request.user.sub))

  const member = { onRequest: [app.authenticate] }
```

por:

```ts
  app.get('/office/map', { onRequest: [app.authenticate, app.requireFeature('escritorio')] }, async (request) => getActiveOfficeMap(request.user.sub))

  const member = { onRequest: [app.authenticate, app.requireFeature('escritorio')] }
```

(`member` já é reusado por `/office/map/edit/draft`, `/office/map/edit/lock`, `/office/map/edit/lock/heartbeat`, `/office/map/edit/lock` DELETE, `/office/map/edit/draft` PUT e `/office/map/edit/publish` — todas ganham o gate automaticamente. As rotas `/admin/office-*` usam a constante `admin`, que não é alterada.)

- [ ] **Step 4: Aplicar o gate em `office-media.ts`**

Em `apps/api/src/routes/office-media.ts`, dentro de `resolveParticipant` (linha ~24-37), após o bloco que já faz `await request.jwtVerify()`:

```ts
    try {
      await request.jwtVerify()
      return { sub: request.user.sub, role: request.user.role, guest: false }
    } catch {
      reply.code(401).send({ message: 'Não autorizado' })
      return null
    }
```

troque por:

```ts
    try {
      await request.jwtVerify()
      if (request.user.role === 'THIRD_PARTY' && !(request.user.features ?? []).includes('escritorio')) {
        reply.code(403).send({ message: 'Acesso não liberado para este usuário' })
        return null
      }
      return { sub: request.user.sub, role: request.user.role, guest: false }
    } catch {
      reply.code(401).send({ message: 'Não autorizado' })
      return null
    }
```

E aplique o mesmo gate na rota `GET /office/config` (linha ~109):

```ts
  app.get('/office/config', { onRequest: [app.authenticate, app.requireFeature('escritorio')] }, async (): Promise<OfficeConfigDTO> => {
```

- [ ] **Step 5: Gate manual na conexão WebSocket de `office-ws.ts`**

Em `apps/api/src/routes/office-ws.ts`, dentro do `preValidation`, após decodificar o payload e verificar que não é convidado (o bloco `if (isOfficeGuestPayload(payload)) { ... }` já existente), adicione a checagem para o caminho de usuário comum. Localize o trecho (após o `if` de convidado, no `else`/fluxo seguinte que popula `_officeUser` a partir de `prisma.user.findUnique`) e, assim que o payload não for de convidado, valide:

```ts
          const payload = app.jwt.verify(token) as { sub: string; role?: string; guest?: boolean; features?: string[] }
          userId = payload.sub
          if (isOfficeGuestPayload(payload)) {
            // ...trecho existente do convidado, sem alteração...
          } else {
            if (payload.role === 'THIRD_PARTY' && !(payload.features ?? []).includes('escritorio')) {
              return reply.code(403).send({ message: 'Acesso não liberado para este usuário' })
            }
          }
```

(Ajuste a indentação/estrutura exata ao redor do `if (isOfficeGuestPayload(payload))` existente — o objetivo é: quando o payload NÃO é de convidado, checar `role`/`features` antes de seguir; abra o arquivo com `sed -n '32,70p' apps/api/src/routes/office-ws.ts` para confirmar a forma exata do bloco antes de editar, já que o `else` pode não existir literalmente e a lógica pode continuar depois do `if` sem bloco `else`.)

- [ ] **Step 6: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/api exec vitest run src/routes/office-feature-gate.test.ts`
Expected: PASS.

- [ ] **Step 7: Rodar as suítes de escritório para garantir que nada quebrou**

Run: `pnpm --filter @legends/api exec vitest run src/routes/office-maps.test.ts src/routes/office-media.test.ts src/routes/office-ws.test.ts src/routes/office-guests.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/office-maps.ts apps/api/src/routes/office-media.ts apps/api/src/routes/office-ws.ts apps/api/src/routes/office-feature-gate.test.ts
git commit -m "feat(api): aplica gate da feature escritorio em REST, mídia e WebSocket"
```

---

### Task 9: Backend — `toPublicUser`/`toAdminUser` expõem `enabledFeatures`

**Files:**
- Modify: `apps/api/src/lib/serialize.ts`
- Test: `apps/api/src/lib/serialize.test.ts` (crie se não existir; se existir, adicione ao arquivo)

**Interfaces:**
- Produces: `toPublicUser(user)` e `toAdminUser(user)` incluem `enabledFeatures: ThirdPartyFeatureKey[]` (vazio para não-terceirizados).

- [ ] **Step 1: Escrever o teste**

Verifique se `apps/api/src/lib/serialize.test.ts` já existe (`ls apps/api/src/lib/serialize.test.ts`). Se não existir, crie-o com:

```ts
import { describe, expect, it } from 'vitest'
import { toPublicUser } from './serialize'

describe('toPublicUser', () => {
  it('inclui enabledFeatures do usuário (vazio quando não setado)', () => {
    const base = {
      id: 'u1', name: 'Fulano', email: 'f@x.com', role: 'LEGEND', area: null,
      position: null, squad: null, photoUrl: null, avatarStyle: null, avatarSeed: null,
      avatarOptions: null, active: true, joinedAt: new Date(), leftAt: null,
      enabledFeatures: [],
    } as any
    expect(toPublicUser(base).enabledFeatures).toEqual([])

    const thirdParty = { ...base, role: 'THIRD_PARTY', enabledFeatures: ['escritorio', 'time'] }
    expect(toPublicUser(thirdParty).enabledFeatures).toEqual(['escritorio', 'time'])
  })
})
```

Se o arquivo já existir, adicione este `describe` a ele.

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/api exec vitest run src/lib/serialize.test.ts`
Expected: FAIL (`enabledFeatures` ainda `undefined` no retorno).

- [ ] **Step 3: Ajustar `toPublicUser`**

Em `apps/api/src/lib/serialize.ts:94-112`, adicione a linha ao objeto retornado:

```ts
export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.leftAt ? null : user.email,
    role: user.role,
    area: user.area,
    position: user.position,
    squad: user.squad,
    photoUrl: user.photoUrl,
    avatarStyle: sanitizeAvatarStyle(user.avatarStyle),
    avatarSeed: user.avatarSeed,
    avatarOptions: sanitizeAvatarOptions(user.avatarOptions),
    active: user.active,
    joinedAt: user.joinedAt.toISOString(),
    leftAt: user.leftAt ? user.leftAt.toISOString() : null,
    enabledFeatures: Array.isArray(user.enabledFeatures) ? (user.enabledFeatures as ThirdPartyFeatureKey[]) : [],
  }
}
```

E adicione o import de `ThirdPartyFeatureKey` ao topo do arquivo, junto aos demais tipos de `@legends/shared` (`toAdminUser` já reaproveita `toPublicUser`, não precisa de mudança adicional).

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/api exec vitest run src/lib/serialize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/serialize.ts apps/api/src/lib/serialize.test.ts
git commit -m "feat(api): toPublicUser expõe enabledFeatures"
```

---

### Task 10: Frontend — `buildNavItems` filtra por `enabledFeatures` e `FeatureGate` protege rotas

**Files:**
- Modify: `apps/web/src/components/nav-items.ts`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/components/nav-items.test.ts` (crie se não existir)
- Test: `apps/web/src/App.guest-route.test.tsx` (referência de padrão; novo teste em arquivo próprio)
- Test: `apps/web/src/App.third-party-route.test.tsx`

**Interfaces:**
- Consumes: `PublicUser.role`, `PublicUser.enabledFeatures` (Task 1/9); `ThirdPartyFeatureKey` (`@legends/shared`).
- Produces: `buildNavItems(args: { isAdmin: boolean; userId?: string; role?: UserRole; enabledFeatures?: ThirdPartyFeatureKey[] }): NavItem[]`; componente `FeatureGate({ feature, children })` em `App.tsx`.

- [ ] **Step 1: Escrever o teste de `buildNavItems` filtrando por feature**

Confirme se já existe teste para `nav-items` (`ls apps/web/src/components/nav-items.test.ts`). Se não existir, crie:

```ts
import { describe, expect, it } from 'vitest'
import { buildNavItems } from './nav-items'

describe('buildNavItems', () => {
  it('esconde itens não liberados para THIRD_PARTY e mantém tudo para as demais roles', () => {
    const full = buildNavItems({ isAdmin: false, userId: 'u1', role: 'LEGEND', enabledFeatures: [] })
    expect(full.some((item) => item.to === '/votar')).toBe(true)

    const restricted = buildNavItems({
      isAdmin: false,
      userId: 'u2',
      role: 'THIRD_PARTY',
      enabledFeatures: ['escritorio'],
    })
    expect(restricted.some((item) => item.to === '/escritorio')).toBe(true)
    expect(restricted.some((item) => item.to === '/votar')).toBe(false)
    expect(restricted.some((item) => item.to === '/lendas')).toBe(false)
    // Home e Meu perfil continuam de fora do filtro de features (nem entram no map de chaves).
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run src/components/nav-items.test.ts`
Expected: FAIL (`buildNavItems` ainda não aceita `role`/`enabledFeatures`, ou não filtra).

- [ ] **Step 3: Implementar o filtro em `nav-items.ts`**

Reescreva `apps/web/src/components/nav-items.ts`:

```ts
import type { ThirdPartyFeatureKey, UserRole } from '@legends/shared'

export interface NavItem {
  to: string
  label: string
  icon: string
  end?: boolean
  showOpenBadge?: boolean
  /** Chave de feature associada (para filtro de terceirizados); ausente = sempre visível. */
  feature?: ThirdPartyFeatureKey
}

export function buildNavItems(args: {
  isAdmin: boolean
  userId?: string
  role?: UserRole
  enabledFeatures?: ThirdPartyFeatureKey[]
}): NavItem[] {
  const { isAdmin, userId, role, enabledFeatures } = args
  if (isAdmin) {
    return [
      { to: '/admin', label: 'Admin', icon: 'shield_person' },
      { to: '/time', label: 'Time', icon: 'groups', end: true },
      { to: '/lendas', label: 'Lendas', icon: 'workspace_premium' },
      { to: '/resenha', label: 'Resenha', icon: 'forum' },
      { to: '/quinta-desenvolvimento', label: 'Quinta de Dev', icon: 'school' },
      { to: '/admin/resenha', label: 'Moderar resenha', icon: 'gavel' },
      { to: '/selos', label: 'Galeria de selos', icon: 'military_tech' },
      { to: '/destaques', label: 'Destaques', icon: 'trophy' },
      { to: '/notificacoes', label: 'Notificações', icon: 'notifications' },
    ]
  }

  const items: NavItem[] = [
    { to: '/', label: 'Home', icon: 'home', end: true },
    ...(userId ? [{ to: `/perfil/${userId}`, label: 'Meu perfil', icon: 'person' }] : []),
    { to: '/time', label: 'Time', icon: 'groups', end: true, feature: 'time' },
    { to: '/lendas', label: 'Lendas', icon: 'workspace_premium', feature: 'lendas' },
    { to: '/resenha', label: 'Resenha', icon: 'forum', feature: 'resenha' },
    { to: '/quinta-desenvolvimento', label: 'Quinta de Dev', icon: 'school', feature: 'quinta-desenvolvimento' },
    { to: '/escritorio', label: 'Escritório', icon: 'chair', feature: 'escritorio' },
    { to: '/selos', label: 'Galeria de selos', icon: 'military_tech', feature: 'selos' },
    { to: '/votar', label: 'Votar', icon: 'how_to_vote', showOpenBadge: true, feature: 'votar' },
    { to: '/retrospectivas', label: 'Retrospectivas', icon: 'dashboard', feature: 'retrospectivas' },
    { to: '/destaques', label: 'Destaques', icon: 'trophy', feature: 'destaques' },
    { to: '/notificacoes', label: 'Notificações', icon: 'notifications', feature: 'notificacoes' },
  ]

  if (role !== 'THIRD_PARTY') return items
  const enabled = new Set(enabledFeatures ?? [])
  return items.filter((item) => !item.feature || enabled.has(item.feature))
}
```

- [ ] **Step 4: Atualizar o único call site em `AppLayout.tsx`**

Em `apps/web/src/components/AppLayout.tsx`, troque:

```ts
  const navItems = buildNavItems({ isAdmin, userId: user?.id });
```

por:

```ts
  const navItems = buildNavItems({ isAdmin, userId: user?.id, role: user?.role, enabledFeatures: user?.enabledFeatures });
```

- [ ] **Step 5: Rodar o teste de `nav-items` e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/components/nav-items.test.ts`
Expected: PASS.

- [ ] **Step 6: Escrever o teste de roteamento (`FeatureGate` redireciona)**

Crie `apps/web/src/App.third-party-route.test.tsx` seguindo o padrão de `apps/web/src/App.guest-route.test.tsx` (leia-o antes de escrever para reaproveitar os mocks de `AuthContext`/`react-router-dom` já usados nesse arquivo). Estrutura mínima:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('./auth/AuthContext', async () => {
  const actual = await vi.importActual<typeof import('./auth/AuthContext')>('./auth/AuthContext')
  return {
    ...actual,
    useAuth: () => ({
      user: {
        id: 'u1', name: 'Terceirizado', email: 't@x.com', role: 'THIRD_PARTY',
        area: null, position: null, squad: null, photoUrl: null, avatarStyle: null,
        avatarSeed: null, avatarOptions: null, active: true, joinedAt: new Date().toISOString(),
        leftAt: null, enabledFeatures: ['escritorio'],
      },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
      setUser: vi.fn(),
    }),
  }
})

import { App } from './App'

describe('FeatureGate', () => {
  it('redireciona terceirizado sem a feature "votar" para a Home', async () => {
    window.history.pushState({}, '', '/votar')
    render(<App />)
    await waitFor(() => expect(screen.queryByText(/votar/i)).not.toBeInTheDocument())
  })
})
```

*(Se `App.guest-route.test.tsx` usar `MemoryRouter` diretamente em vez de `window.history.pushState` com `BrowserRouter`, siga o padrão real desse arquivo — `App.tsx` usa `BrowserRouter` internamente, então a navegação inicial é controlada via `window.history`/`initialEntries` conforme o que já funciona no teste de convidado existente.)*

- [ ] **Step 7: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run src/App.third-party-route.test.tsx`
Expected: FAIL (rota `/votar` ainda não está protegida por feature — hoje só existe `DevOnly`).

- [ ] **Step 8: Implementar `FeatureGate` e aplicá-lo às rotas com feature em `App.tsx`**

Em `apps/web/src/App.tsx`, adicione o componente (próximo a `DevOnly`/`AdminOnly`):

```tsx
import type { ThirdPartyFeatureKey } from '@legends/shared'

/** Bloqueia terceirizados que não têm a feature habilitada. */
function FeatureGate({ feature, children }: { feature: ThirdPartyFeatureKey; children: ReactNode }) {
  const { user } = useAuth()
  if (user?.role === 'THIRD_PARTY' && !user.enabledFeatures.includes(feature)) {
    return <Navigate to="/" replace />
  }
  return <>{children}</>
}
```

E envolva as rotas correspondentes dentro do `<Routes>`. Por exemplo, `/votar`:

```tsx
                  <Route
                    path="/votar"
                    element={
                      <DevOnly>
                        <FeatureGate feature="votar">
                          <VotePage />
                        </FeatureGate>
                      </DevOnly>
                    }
                  />
```

Aplique o mesmo padrão (envolvendo o elemento existente com `<FeatureGate feature="...">`) em: `/time` (`time`), `/lendas` (`lendas`), `/selos` (`selos`), `/destaques` (`destaques`), `/notificacoes` (`notificacoes`), `/resenha` (`resenha`), `/quinta-desenvolvimento` (`quinta-desenvolvimento`), `/retrospectivas` e `/retrospectivas/sprint/:sprint` (`retrospectivas`), `/retrospectivas/:id` (`retrospectivas`, fora do bloco de `AppLayout`), e a função `OfficeRoute` (`escritorio` — envolva o retorno de `<OfficePage />` do ramo `if (user)` com `<FeatureGate feature="escritorio">`).

- [ ] **Step 9: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/App.third-party-route.test.tsx`
Expected: PASS.

- [ ] **Step 10: Rodar os testes de rotas existentes para garantir que nada quebrou**

Run: `pnpm --filter @legends/web exec vitest run src/App.guest-route.test.tsx src/pages/VotePage.test.tsx src/pages/OfficePage.test.tsx`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/components/nav-items.ts apps/web/src/components/AppLayout.tsx apps/web/src/App.tsx apps/web/src/components/nav-items.test.ts apps/web/src/App.third-party-route.test.tsx
git commit -m "feat(web): buildNavItems e FeatureGate respeitam enabledFeatures de terceirizados"
```

---

### Task 11: Frontend — `ThirdPartyInvitePage` (cadastro pelo link do convite)

**Files:**
- Create: `apps/web/src/pages/ThirdPartyInvitePage.tsx`
- Modify: `apps/web/src/App.tsx`
- Test: `apps/web/src/pages/ThirdPartyInvitePage.test.tsx`

**Interfaces:**
- Consumes: `ThirdPartyInvitePublicDTO`, `AuthResponse` (`@legends/shared`, Task 1); `setAccessToken` (`../lib/api`); `useAuth().setUser` (`../auth/AuthContext`).
- Produces: página em `/terceirizado/convite/:token` que consulta o convite, coleta nome/e-mail/senha e chama `POST /third-party-invites/:token/accept`.

- [ ] **Step 1: Escrever o teste da página**

Crie `apps/web/src/pages/ThirdPartyInvitePage.test.tsx`, seguindo o padrão de mocks de `fetch` já usado em `GuestInvitePage` (verifique se há um `GuestInvitePage.test.tsx`; se não houver, mocke `global.fetch` diretamente):

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ThirdPartyInvitePage } from './ThirdPartyInvitePage'

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options?: RequestInit) => {
      if (url.includes('/third-party-invites/') && url.endsWith('/accept')) {
        return new Response(
          JSON.stringify({ accessToken: 'tok', user: { id: 'u1', name: 'Fulano', role: 'THIRD_PARTY', enabledFeatures: ['escritorio'] } }),
          { status: 201 },
        )
      }
      if (url.includes('/third-party-invites/')) {
        return new Response(JSON.stringify({ createdByName: 'Admin', expiresAt: new Date(Date.now() + 3600_000).toISOString() }), { status: 200 })
      }
      return new Response('{}', { status: 404 })
    }),
  )
})

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/terceirizado/convite/abc123']}>
      <Routes>
        <Route path="/terceirizado/convite/:token" element={<ThirdPartyInvitePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ThirdPartyInvitePage', () => {
  it('carrega o convite e envia nome/e-mail/senha para criar a conta', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/Admin/i)).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText(/nome/i), { target: { value: 'Fulano' } })
    fireEvent.change(screen.getByLabelText(/e-mail/i), { target: { value: 'fulano@x.com' } })
    fireEvent.change(screen.getByLabelText(/senha/i), { target: { value: 'senha1234' } })
    fireEvent.click(screen.getByRole('button', { name: /criar conta/i }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/accept'), expect.anything()))
  })
})
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/ThirdPartyInvitePage.test.tsx`
Expected: FAIL (módulo `./ThirdPartyInvitePage` não existe).

- [ ] **Step 3: Implementar a página**

Crie `apps/web/src/pages/ThirdPartyInvitePage.tsx`:

```tsx
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { AuthResponse, ThirdPartyInvitePublicDTO } from '@legends/shared'
import { ApiError } from '../lib/api'
import { setAccessToken } from '../lib/api'
import { useAuth } from '../auth/AuthContext'

async function publicApiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: {
      ...(options.body != null ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })
  if (!res.ok) {
    let message = 'Não foi possível abrir o convite.'
    try {
      const body = (await res.json()) as { message?: string }
      if (body.message) message = body.message
    } catch {
      // sem corpo JSON
    }
    throw new ApiError(res.status, message)
  }
  return (await res.json()) as T
}

export function ThirdPartyInvitePage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const { setUser } = useAuth()
  const [invite, setInvite] = useState<ThirdPartyInvitePublicDTO | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    publicApiFetch<ThirdPartyInvitePublicDTO>(`/third-party-invites/${encodeURIComponent(token)}`)
      .then((data) => {
        if (!alive) return
        setInvite(data)
        setError(null)
      })
      .catch((err) => alive && setError(err instanceof Error ? err.message : 'Convite inválido.'))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [token])

  const expiresLabel = useMemo(() => {
    if (!invite) return ''
    return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(invite.expiresAt))
  }, [invite])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || !email.trim() || password.length < 8) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await publicApiFetch<AuthResponse>(`/third-party-invites/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
      })
      setAccessToken(res.accessToken)
      setUser(res.user)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível criar sua conta.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="min-h-screen bg-surface px-lg py-xl text-on-surface">
      <form onSubmit={submit} className="mx-auto flex w-full max-w-md flex-col gap-lg">
        <header>
          <p className="font-label text-label-md uppercase tracking-wide text-primary">Acesso de terceirizado</p>
          <h1 className="mt-xs font-headline text-headline-lg">Crie sua conta</h1>
          {invite && (
            <p className="mt-sm font-body text-body-md text-on-surface-variant">
              Convite de {invite.createdByName}. Expira em {expiresLabel || 'instantes'}.
            </p>
          )}
        </header>

        {error && (
          <div role="alert" className="rounded-lg border border-error/40 bg-error-container/20 px-md py-sm font-label text-label-md text-error">
            {error}
          </div>
        )}

        {loading ? (
          <p className="font-body text-body-md text-on-surface-variant">Carregando convite...</p>
        ) : (
          <>
            <label className="flex flex-col gap-xs">
              <span className="font-label text-label-md text-on-surface">Nome</span>
              <input
                aria-label="Nome"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="rounded-lg border border-outline-variant/50 bg-surface-container px-md py-sm font-body text-body-md text-on-surface outline-none focus:border-primary"
              />
            </label>
            <label className="flex flex-col gap-xs">
              <span className="font-label text-label-md text-on-surface">E-mail</span>
              <input
                aria-label="E-mail"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="rounded-lg border border-outline-variant/50 bg-surface-container px-md py-sm font-body text-body-md text-on-surface outline-none focus:border-primary"
              />
            </label>
            <label className="flex flex-col gap-xs">
              <span className="font-label text-label-md text-on-surface">Senha</span>
              <input
                aria-label="Senha"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                className="rounded-lg border border-outline-variant/50 bg-surface-container px-md py-sm font-body text-body-md text-on-surface outline-none focus:border-primary"
              />
            </label>
            <button
              type="submit"
              disabled={submitting || !name.trim() || !email.trim() || password.length < 8}
              className="rounded-md bg-primary px-lg py-sm font-label text-label-lg font-bold text-on-primary transition-colors hover:bg-primary-container disabled:opacity-50"
            >
              {submitting ? 'Criando conta...' : 'Criar conta'}
            </button>
          </>
        )}
      </form>
    </main>
  )
}
```

- [ ] **Step 4: Registrar a rota pública em `App.tsx`**

Adicione o import e a rota (fora do `ProtectedRoute`, junto a `/convidado/:token`):

```tsx
import { ThirdPartyInvitePage } from './pages/ThirdPartyInvitePage'
```

```tsx
                <Route path="/terceirizado/convite/:token" element={<ThirdPartyInvitePage />} />
```

- [ ] **Step 5: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/pages/ThirdPartyInvitePage.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/ThirdPartyInvitePage.tsx apps/web/src/App.tsx apps/web/src/pages/ThirdPartyInvitePage.test.tsx
git commit -m "feat(web): página de cadastro via convite de terceirizado"
```

---

### Task 12: Frontend — seção "Terceirizados" no painel admin

**Files:**
- Create: `apps/web/src/pages/admin/ThirdPartySection.tsx`
- Modify: `apps/web/src/pages/admin/TabBar.tsx`
- Modify: `apps/web/src/pages/AdminPage.tsx`
- Test: `apps/web/src/pages/admin/ThirdPartySection.test.tsx`

**Interfaces:**
- Consumes: `AdminUserDTO`, `ThirdPartyInviteDTO`, `ThirdPartyInviteListResponse`, `CreateThirdPartyInviteResponse`, `THIRD_PARTY_FEATURE_KEYS`, `THIRD_PARTY_FEATURE_LABELS` (`@legends/shared`); `apiFetch`, `ApiError` (`../../lib/api`); `Panel`, `inputCls` (`./shared`).
- Produces: aba "Terceirizados" no admin com: formulário de convite (validade + checklist de features), lista de convites com status/revogar, lista de terceirizados existentes com checklist de features editável.

- [ ] **Step 1: Escrever o teste da seção**

Crie `apps/web/src/pages/admin/ThirdPartySection.test.tsx`, seguindo o padrão de `apps/web/src/pages/admin/OfficeSection.test.tsx` (mock de `apiFetch`, `QueryClientProvider`):

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThirdPartySection } from './ThirdPartySection'
import * as api from '../../lib/api'

function renderSection() {
  const client = new QueryClient()
  return render(
    <QueryClientProvider client={client}>
      <ThirdPartySection />
    </QueryClientProvider>,
  )
}

describe('ThirdPartySection', () => {
  it('cria um convite com as features marcadas', async () => {
    const apiFetchMock = vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
      if (path === '/admin/third-party-users') return { users: [] }
      if (path === '/admin/third-party-invites' ) return { invites: [] }
      throw new Error(`unexpected ${path}`)
    })
    renderSection()

    await waitFor(() => expect(screen.getByText(/convidar terceirizado/i)).toBeInTheDocument())
    fireEvent.click(screen.getByText(/convidar terceirizado/i))
    fireEvent.click(screen.getByLabelText('Escritório'))

    apiFetchMock.mockImplementationOnce(async () => ({
      invite: { id: '1', url: 'https://x/terceirizado/convite/abc', enabledFeatures: ['escritorio'], expiresAt: new Date().toISOString(), createdAt: new Date().toISOString(), usedAt: null, revokedAt: null },
    }))
    fireEvent.click(screen.getByRole('button', { name: /gerar convite/i }))

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/admin/third-party-invites', expect.objectContaining({ method: 'POST' })))
  })
})
```

*(Confira o mock exato de `apiFetch` usado em `OfficeSection.test.tsx` antes de finalizar — o padrão de `vi.spyOn` acima pressupõe que `apiFetch` é exportado como função nomeada de `../../lib/api`, o que já é o caso.)*

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/admin/ThirdPartySection.test.tsx`
Expected: FAIL (módulo `./ThirdPartySection` não existe).

- [ ] **Step 3: Implementar `ThirdPartySection.tsx`**

```tsx
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  AdminUserDTO,
  ThirdPartyInviteDTO,
  ThirdPartyFeatureKey,
} from '@legends/shared'
import { THIRD_PARTY_FEATURE_KEYS, THIRD_PARTY_FEATURE_LABELS } from '@legends/shared'
import { ApiError, apiFetch } from '../../lib/api'
import { Panel, inputCls } from './shared'

function FeatureChecklist({
  selected,
  onToggle,
}: {
  selected: Set<ThirdPartyFeatureKey>
  onToggle: (key: ThirdPartyFeatureKey) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-sm sm:grid-cols-3">
      {THIRD_PARTY_FEATURE_KEYS.map((key) => (
        <label key={key} className="flex items-center gap-xs font-label text-label-sm text-on-surface">
          <input
            type="checkbox"
            aria-label={THIRD_PARTY_FEATURE_LABELS[key]}
            checked={selected.has(key)}
            onChange={() => onToggle(key)}
          />
          {THIRD_PARTY_FEATURE_LABELS[key]}
        </label>
      ))}
    </div>
  )
}

function InviteForm({ onCreated }: { onCreated: (url: string) => void }) {
  const [expiresInMinutes, setExpiresInMinutes] = useState(24 * 60)
  const [features, setFeatures] = useState<Set<ThirdPartyFeatureKey>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const createInvite = useMutation({
    mutationFn: () =>
      apiFetch<{ invite: ThirdPartyInviteDTO }>('/admin/third-party-invites', {
        method: 'POST',
        body: JSON.stringify({ expiresInMinutes, enabledFeatures: Array.from(features) }),
      }),
    onSuccess: (data) => {
      if (data.invite.url) onCreated(data.invite.url)
      setError(null)
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao criar convite.'),
  })

  function toggle(key: ThirdPartyFeatureKey) {
    setFeatures((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-sm rounded-lg border border-outline-variant/30 bg-surface-container-low p-md">
      <label className="flex max-w-xs flex-col gap-1 font-label text-label-sm text-on-surface-variant">
        Validade do link (minutos)
        <input
          className={inputCls}
          type="number"
          min={60}
          value={expiresInMinutes}
          onChange={(e) => setExpiresInMinutes(Number(e.target.value))}
          aria-label="Validade do link em minutos"
        />
      </label>
      <FeatureChecklist selected={features} onToggle={toggle} />
      {error && <p role="alert" className="text-body-sm text-error">{error}</p>}
      <div>
        <button
          type="button"
          onClick={() => createInvite.mutate()}
          className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container"
        >
          Gerar convite
        </button>
      </div>
    </div>
  )
}

function ThirdPartyRow({ member, onSave }: { member: AdminUserDTO; onSave: (id: string, enabledFeatures: ThirdPartyFeatureKey[]) => void }) {
  const [editing, setEditing] = useState(false)
  const [features, setFeatures] = useState<Set<ThirdPartyFeatureKey>>(new Set(member.enabledFeatures))

  function toggle(key: ThirdPartyFeatureKey) {
    setFeatures((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (editing) {
    return (
      <li className="flex flex-col gap-sm rounded-lg border border-primary/40 bg-surface-container-low p-md">
        <span className="font-label text-label-md text-on-surface">{member.name} · {member.email}</span>
        <FeatureChecklist selected={features} onToggle={toggle} />
        <div className="flex gap-sm">
          <button
            onClick={() => {
              onSave(member.id, Array.from(features))
              setEditing(false)
            }}
            className="rounded-md bg-primary px-md py-1 font-label text-label-sm font-bold text-on-primary hover:bg-primary-container"
          >
            Salvar
          </button>
          <button onClick={() => setEditing(false)} className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant hover:text-on-surface">
            Cancelar
          </button>
        </div>
      </li>
    )
  }

  return (
    <li className="flex items-center justify-between gap-md rounded-lg border border-outline-variant/20 bg-surface-container-low p-md">
      <span className="text-on-surface">
        {member.name}
        <span className="ml-2 font-label text-label-sm text-on-surface-variant">{member.email}</span>
      </span>
      <button
        onClick={() => setEditing(true)}
        className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
      >
        Editar features
      </button>
    </li>
  )
}

export function ThirdPartySection() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null)

  const usersQuery = useQuery({
    queryKey: ['admin', 'third-party-users'],
    queryFn: () => apiFetch<{ users: AdminUserDTO[] }>('/admin/third-party-users'),
  })
  const invitesQuery = useQuery({
    queryKey: ['admin', 'third-party-invites'],
    queryFn: () => apiFetch<{ invites: ThirdPartyInviteDTO[] }>('/admin/third-party-invites'),
  })
  const updateUser = useMutation({
    mutationFn: (vars: { id: string; enabledFeatures: ThirdPartyFeatureKey[] }) =>
      apiFetch<{ user: AdminUserDTO }>(`/admin/users/${vars.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabledFeatures: vars.enabledFeatures }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'third-party-users'] }),
  })
  const revokeInvite = useMutation({
    mutationFn: (id: string) => apiFetch(`/admin/third-party-invites/${id}/revoke`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'third-party-invites'] }),
  })

  return (
    <Panel
      title="Terceirizados"
      action={
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
        >
          {showForm ? 'Cancelar' : '+ Convidar terceirizado'}
        </button>
      }
    >
      {showForm && (
        <div className="mb-lg">
          <InviteForm
            onCreated={(url) => {
              setLastInviteUrl(url)
              queryClient.invalidateQueries({ queryKey: ['admin', 'third-party-invites'] })
            }}
          />
        </div>
      )}
      {lastInviteUrl && (
        <p className="mb-lg break-all rounded-lg border border-primary/30 bg-primary/10 px-md py-sm font-body text-body-sm text-on-surface">
          Link do convite: <a href={lastInviteUrl}>{lastInviteUrl}</a>
        </p>
      )}

      <h3 className="mb-sm font-label text-label-md uppercase tracking-wide text-on-surface-variant">Convites</h3>
      <ul className="mb-lg flex flex-col gap-2">
        {invitesQuery.data?.invites.map((invite) => (
          <li key={invite.id} className="flex items-center justify-between gap-md rounded-lg border border-outline-variant/20 bg-surface-container-low p-md">
            <span className="font-label text-label-sm text-on-surface-variant">
              {invite.usedAt ? 'Usado' : invite.revokedAt ? 'Revogado' : 'Pendente'} · expira em {new Date(invite.expiresAt).toLocaleString('pt-BR')}
            </span>
            {!invite.usedAt && !invite.revokedAt && (
              <button
                onClick={() => revokeInvite.mutate(invite.id)}
                className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
              >
                Revogar
              </button>
            )}
          </li>
        ))}
      </ul>

      <h3 className="mb-sm font-label text-label-md uppercase tracking-wide text-on-surface-variant">Contas</h3>
      <ul className="flex flex-col gap-2">
        {usersQuery.data?.users.map((member) => (
          <ThirdPartyRow
            key={member.id}
            member={member}
            onSave={(id, enabledFeatures) => updateUser.mutate({ id, enabledFeatures })}
          />
        ))}
      </ul>
    </Panel>
  )
}
```

- [ ] **Step 4: Registrar a aba em `TabBar.tsx`**

Em `apps/web/src/pages/admin/TabBar.tsx`, adicione `'terceirizados'` a `AdminTabId` e `ADMIN_TABS`:

```ts
export type AdminTabId =
  | "periodos"
  | "lendas"
  | "terceirizados"
  | "selos"
  | "categorias"
  | "squads"
  | "quinta-dev"
  | "moderacao"
  | "retrospectivas"
  | "mapas"
  | "escritorio";

export const ADMIN_TABS: { id: AdminTabId; label: string }[] = [
  { id: "periodos", label: "Períodos" },
  { id: "lendas", label: "Lendas" },
  { id: "terceirizados", label: "Terceirizados" },
  { id: "selos", label: "Selos" },
  { id: "categorias", label: "Categorias" },
  { id: "squads", label: "Squads" },
  { id: "quinta-dev", label: "Quinta Dev" },
  { id: "moderacao", label: "Moderação" },
  { id: "retrospectivas", label: "Retrospectivas" },
  { id: "mapas", label: "Mapas" },
  { id: "escritorio", label: "Escritório" },
];
```

- [ ] **Step 5: Registrar a aba em `AdminPage.tsx`**

```tsx
import { ThirdPartySection } from "./admin/ThirdPartySection";
```

```tsx
      {activeTab === "terceirizados" && <ThirdPartySection />}
```

(logo após a linha `{activeTab === "lendas" && <CollaboratorsSection />}`)

- [ ] **Step 6: Rodar o teste e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/pages/admin/ThirdPartySection.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/admin/ThirdPartySection.tsx apps/web/src/pages/admin/TabBar.tsx apps/web/src/pages/AdminPage.tsx apps/web/src/pages/admin/ThirdPartySection.test.tsx
git commit -m "feat(web): seção Terceirizados no painel admin (convites e features)"
```

---

### Task 13: Verificação final

**Files:** nenhum (só execução).

- [ ] **Step 1: Typecheck de ambos os workspaces**

Run: `pnpm --filter @legends/api exec tsc --noEmit && pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros de tipo.

- [ ] **Step 2: Suíte completa**

Run: `pnpm db:up && pnpm test`
Expected: todos os testes passam (api + web).

- [ ] **Step 3: Verificação manual do fluxo (opcional, recomendado)**

Run: `pnpm dev`, logue como admin, crie um convite de terceirizado com 1-2 features, abra o link em uma aba anônima, cadastre a conta e confirme que só as features escolhidas aparecem na navegação e que as demais rotas redirecionam para `/`.

- [ ] **Step 4: Commit final (se houver ajustes de typecheck)**

```bash
git add -A
git commit -m "chore: ajustes finais de typecheck da role de terceirizados"
```

---

## Self-Review

**Cobertura do spec:** modelo de dados (Task 2), convite admin→link (Task 5/12), cadastro pelo terceirizado (Task 11), edição posterior de features (Task 6/12), gating backend (Tasks 3/7/8), gating frontend (Task 10), rótulos/admin UI (Task 1/12), testes em cada camada (todas as tasks têm teste). Riscos do spec (mapeamento rota→feature, WS do escritório) resolvidos explicitamente na tabela de referência e nas Tasks 7/8.

**Placeholders:** nenhum "TBD"/"implementar depois" restante — cada step tem código completo; os poucos pontos que pedem `sed -n`/`grep` antes de editar (Tasks 5, 7, 8) são para confirmar a forma exata de um bloco existente antes de uma edição cirúrgica, não lacunas de design.

**Consistência de tipos:** `ThirdPartyFeatureKey` definido uma vez (Task 1) e reusado em todas as tasks seguintes; `signAccessToken` (Task 3) é o único ponto que assina `features` no JWT e é consumido por Task 4 e pelas 3 chamadas em `auth.ts`; `app.requireFeature` (Task 3) é o único decorator usado nas Tasks 7/8.

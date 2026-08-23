# Refresh Token Rotativo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir o JWT único de 7 dias por access token curto (15 min, em memória no front) + refresh token opaco rotativo em cookie httpOnly, com detecção de reúso e revogação por família (padrão-ouro OWASP).

**Architecture:** A API emite um access JWT de 15 min e um refresh token opaco (hash SHA-256 no Postgres). O refresh viaja em cookie httpOnly/Secure/SameSite=Strict e é rotacionado a cada `/auth/refresh`; reutilizar um refresh revogado derruba a família inteira. O front guarda o access só em memória e faz refresh silencioso no load e em respostas 401 (single-flight).

**Tech Stack:** Fastify 4, @fastify/jwt, @fastify/cookie, Prisma + Postgres, React/Vite, Vitest. Testes de API rodam contra um Postgres de teste real (`legends_test`).

**Spec:** `docs/superpowers/specs/2026-06-11-refresh-token-design.md`

---

## File Structure

**API**
- Modify `apps/api/package.json` — add `@fastify/cookie`.
- Modify `apps/api/prisma/schema.prisma` — novo model `RefreshToken` + relação inversa em `User`.
- Create `apps/api/prisma/migrations/<timestamp>_refresh_token/migration.sql` (gerado).
- Create `apps/api/src/services/refresh-token-service.ts` — emissão, rotação, detecção de reúso, revogação.
- Create `apps/api/src/services/refresh-token-service.test.ts`.
- Modify `apps/api/src/app.ts` — registrar cookie, access TTL `15m`.
- Modify `apps/api/src/routes/auth.ts` — `remember` no login + cookie; `/refresh`; `/logout`.
- Create `apps/api/src/routes/auth.refresh.test.ts` — testes de integração das rotas.
- Modify `apps/api/test/setup.ts` — limpar `refreshToken` no `beforeEach`.

**Shared**
- Modify `packages/shared/src/auth.ts` — `AuthResponse.token` → `accessToken`; novos tipos.

**Web**
- Modify `apps/web/src/lib/api.ts` — access em memória + refresh single-flight; remover helpers de storage.
- Modify `apps/web/src/lib/api.test.ts` — novos testes (anexa Bearer, single-flight no 401).
- Modify `apps/web/src/auth/AuthContext.tsx` — bootstrap por refresh silencioso, `login(remember)`, `logout` que revoga.

> `apps/web/src/pages/LoginPage.tsx` já envia `remember` e não muda neste plano.

---

## Task 1: Schema, cookie plugin e access TTL

**Files:**
- Modify: `apps/api/package.json`
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `apps/api/src/app.ts`

- [ ] **Step 1: Instalar @fastify/cookie**

Run (na raiz do repo):

```bash
pnpm --filter @legends/api add @fastify/cookie@^9
```

Expected: `package.json` da API passa a listar `@fastify/cookie` em `dependencies`.

- [ ] **Step 2: Adicionar o model RefreshToken ao schema**

Em `apps/api/prisma/schema.prisma`, adicione a relação inversa no model `User` (logo após a linha `periodsWon ...`):

```prisma
  refreshTokens RefreshToken[]
```

E adicione o novo model (pode ser logo após o model `User`):

```prisma
model RefreshToken {
  id         String    @id @default(cuid())
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash  String    @unique
  familyId   String
  persistent Boolean   @default(false)
  expiresAt  DateTime
  revokedAt  DateTime?
  replacedBy String?
  createdAt  DateTime  @default(now())

  @@index([userId])
  @@index([familyId])
}
```

- [ ] **Step 3: Gerar a migration e o client**

Run:

```bash
cd apps/api && pnpm exec prisma migrate dev --name refresh_token
```

Expected: cria `prisma/migrations/<timestamp>_refresh_token/` e regenera o Prisma Client. A tabela `RefreshToken` existe no banco de dev.

- [ ] **Step 4: Registrar o cookie plugin e encurtar o access token**

Em `apps/api/src/app.ts`:

Adicione o import (junto aos outros plugins, após a linha do `jwt`):

```ts
import cookie from '@fastify/cookie'
```

Troque a linha de registro do jwt para 15 min e registre o cookie logo abaixo:

```ts
  app.register(jwt, { secret: resolveJwtSecret(process.env), sign: { expiresIn: '15m' } })
  app.register(cookie)
```

- [ ] **Step 5: Compilar para validar tipos**

Run:

```bash
cd apps/api && pnpm exec tsc --noEmit
```

Expected: sem erros (o registro do cookie decora `request.cookies` e `reply.setCookie`).

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json apps/api/pnpm-lock.yaml pnpm-lock.yaml apps/api/prisma apps/api/src/app.ts
git commit -m "feat(api): schema de refresh token + cookie plugin + access token de 15min"
```

> Se o lockfile estiver só na raiz, ajuste os caminhos do `git add` conforme o `git status`.

---

## Task 2: Serviço de refresh token (emissão, rotação, reúso)

**Files:**
- Create: `apps/api/src/services/refresh-token-service.ts`
- Test: `apps/api/src/services/refresh-token-service.test.ts`

- [ ] **Step 1: Escrever os testes que falham**

Crie `apps/api/src/services/refresh-token-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { prisma } from '../lib/prisma'
import {
  issueRefreshTokenForLogin,
  rotateRefreshToken,
  revokeByRawToken,
  RefreshError,
} from './refresh-token-service'

async function makeUser() {
  return prisma.user.create({
    data: { name: 'Dev', email: 'dev@example.com', passwordHash: 'x' },
  })
}

describe('refresh-token-service', () => {
  it('emite um refresh persistido como hash, nunca em claro', async () => {
    const user = await makeUser()
    const { rawToken } = await issueRefreshTokenForLogin(user.id, true)
    const stored = await prisma.refreshToken.findFirst({ where: { userId: user.id } })
    expect(stored).not.toBeNull()
    expect(stored!.tokenHash).not.toBe(rawToken)
    expect(stored!.persistent).toBe(true)
  })

  it('rotaciona: emite novo token e revoga o anterior na mesma família', async () => {
    const user = await makeUser()
    const { rawToken } = await issueRefreshTokenForLogin(user.id, false)
    const result = await rotateRefreshToken(rawToken)
    expect(result.rawToken).not.toBe(rawToken)

    const tokens = await prisma.refreshToken.findMany({ where: { userId: user.id } })
    expect(tokens).toHaveLength(2)
    const old = tokens.find((t) => t.replacedBy !== null)!
    const next = tokens.find((t) => t.replacedBy === null)!
    expect(old.revokedAt).not.toBeNull()
    expect(old.replacedBy).toBe(next.id)
    expect(next.familyId).toBe(old.familyId)
    expect(next.persistent).toBe(false)
  })

  it('detecta reúso de um token já revogado e derruba a família inteira', async () => {
    const user = await makeUser()
    const { rawToken } = await issueRefreshTokenForLogin(user.id, true)
    await rotateRefreshToken(rawToken) // rawToken agora está revogado

    await expect(rotateRefreshToken(rawToken)).rejects.toBeInstanceOf(RefreshError)

    const active = await prisma.refreshToken.count({
      where: { userId: user.id, revokedAt: null },
    })
    expect(active).toBe(0)
  })

  it('rejeita token inexistente', async () => {
    await expect(rotateRefreshToken('nao-existe')).rejects.toBeInstanceOf(RefreshError)
  })

  it('logout revoga a família a partir do token apresentado', async () => {
    const user = await makeUser()
    const { rawToken } = await issueRefreshTokenForLogin(user.id, false)
    await revokeByRawToken(rawToken)
    const active = await prisma.refreshToken.count({
      where: { userId: user.id, revokedAt: null },
    })
    expect(active).toBe(0)
  })
})
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run:

```bash
cd apps/api && pnpm exec vitest run src/services/refresh-token-service.test.ts
```

Expected: FAIL — módulo `./refresh-token-service` não existe.

- [ ] **Step 3: Implementar o serviço**

Crie `apps/api/src/services/refresh-token-service.ts`:

```ts
import { randomBytes, createHash } from 'node:crypto'
import { prisma } from '../lib/prisma'

const REFRESH_TTL_DAYS = 30

export class RefreshError extends Error {}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function newRawToken(): string {
  return randomBytes(32).toString('hex')
}

function expiryFromNow(): Date {
  return new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000)
}

export interface IssuedRefresh {
  rawToken: string
  expiresAt: Date
  persistent: boolean
}

interface CreatedToken {
  id: string
  rawToken: string
  expiresAt: Date
}

async function createTokenInFamily(
  userId: string,
  familyId: string,
  persistent: boolean,
): Promise<CreatedToken> {
  const rawToken = newRawToken()
  const expiresAt = expiryFromNow()
  const record = await prisma.refreshToken.create({
    data: { userId, familyId, persistent, tokenHash: hashToken(rawToken), expiresAt },
  })
  return { id: record.id, rawToken, expiresAt }
}

export async function issueRefreshTokenForLogin(
  userId: string,
  persistent: boolean,
): Promise<IssuedRefresh> {
  const familyId = randomBytes(16).toString('hex')
  const created = await createTokenInFamily(userId, familyId, persistent)
  return { rawToken: created.rawToken, expiresAt: created.expiresAt, persistent }
}

export async function revokeFamily(familyId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
}

export async function revokeByRawToken(rawToken: string): Promise<void> {
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
  })
  if (existing) await revokeFamily(existing.familyId)
}

export interface RotationResult {
  userId: string
  rawToken: string
  expiresAt: Date
  persistent: boolean
}

export async function rotateRefreshToken(rawToken: string): Promise<RotationResult> {
  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
  })
  if (!existing) throw new RefreshError('Token inválido')

  // Detecção de reúso: token conhecido mas já revogado => replay/roubo.
  if (existing.revokedAt) {
    await revokeFamily(existing.familyId)
    throw new RefreshError('Token reutilizado')
  }
  if (existing.expiresAt.getTime() <= Date.now()) {
    throw new RefreshError('Token expirado')
  }

  const next = await createTokenInFamily(existing.userId, existing.familyId, existing.persistent)
  await prisma.refreshToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date(), replacedBy: next.id },
  })

  return {
    userId: existing.userId,
    rawToken: next.rawToken,
    expiresAt: next.expiresAt,
    persistent: existing.persistent,
  }
}
```

- [ ] **Step 4: Rodar os testes e ver passar**

Run:

```bash
cd apps/api && pnpm exec vitest run src/services/refresh-token-service.test.ts
```

Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/refresh-token-service.ts apps/api/src/services/refresh-token-service.test.ts
git commit -m "feat(api): servico de refresh token com rotacao e deteccao de reuso"
```

---

## Task 3: Rotas de auth (login com cookie, /refresh, /logout) + tipo compartilhado

**Files:**
- Modify: `packages/shared/src/auth.ts`
- Modify: `apps/api/src/routes/auth.ts`
- Modify: `apps/api/test/setup.ts`
- Test: `apps/api/src/routes/auth.refresh.test.ts`

- [ ] **Step 1: Atualizar o tipo compartilhado**

Em `packages/shared/src/auth.ts`, troque a interface `AuthResponse` e adicione `RefreshResponse`:

```ts
export interface AuthResponse {
  accessToken: string
  user: PublicUser
}

export interface RefreshResponse {
  accessToken: string
}
```

- [ ] **Step 2: Limpar refreshToken no setup de testes**

Em `apps/api/test/setup.ts`, adicione `prisma.refreshToken.deleteMany()` como **primeiro** item do `$transaction` (antes de `user.deleteMany()`):

```ts
  await prisma.$transaction([
    prisma.refreshToken.deleteMany(),
    prisma.userBadge.deleteMany(),
    prisma.vote.deleteMany(),
    prisma.badge.deleteMany(),
    prisma.votingPeriod.deleteMany(),
    prisma.category.deleteMany(),
    prisma.user.deleteMany(),
  ])
```

- [ ] **Step 3: Escrever os testes de integração das rotas**

Crie `apps/api/src/routes/auth.refresh.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import { hashPassword } from '../lib/password'

const EMAIL = 'lenda@example.com'
const PASSWORD = 'supersecret1'

beforeEach(async () => {
  await prisma.user.create({
    data: { name: 'Lenda', email: EMAIL, passwordHash: await hashPassword(PASSWORD) },
  })
})

function refreshCookie(setCookieHeader: string | string[] | undefined): string {
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader ?? '']
  const cookie = raw.find((c) => c.startsWith('legends.refresh='))!
  return cookie.split(';')[0].split('=')[1]
}

describe('fluxo de refresh token', () => {
  it('login devolve accessToken e seta cookie de refresh httpOnly', async () => {
    const app = buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: EMAIL, password: PASSWORD, remember: true },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().accessToken).toBeTypeOf('string')
    const setCookie = res.headers['set-cookie'] as string | string[]
    const cookieStr = Array.isArray(setCookie) ? setCookie.join(';') : setCookie
    expect(cookieStr).toMatch(/legends\.refresh=/)
    expect(cookieStr.toLowerCase()).toContain('httponly')
    await app.close()
  })

  it('refresh rotaciona o cookie e devolve novo accessToken', async () => {
    const app = buildApp()
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: EMAIL, password: PASSWORD, remember: false },
    })
    const token = refreshCookie(login.headers['set-cookie'])

    const res = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { 'legends.refresh': token },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().accessToken).toBeTypeOf('string')
    const newToken = refreshCookie(res.headers['set-cookie'])
    expect(newToken).not.toBe(token)
    await app.close()
  })

  it('reusar um refresh já rotacionado retorna 401', async () => {
    const app = buildApp()
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: EMAIL, password: PASSWORD, remember: false },
    })
    const token = refreshCookie(login.headers['set-cookie'])
    await app.inject({ method: 'POST', url: '/auth/refresh', cookies: { 'legends.refresh': token } })

    const reused = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { 'legends.refresh': token },
    })
    expect(reused.statusCode).toBe(401)
    await app.close()
  })

  it('refresh sem cookie retorna 401', async () => {
    const app = buildApp()
    const res = await app.inject({ method: 'POST', url: '/auth/refresh' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('logout revoga e limpa o cookie', async () => {
    const app = buildApp()
    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: EMAIL, password: PASSWORD, remember: false },
    })
    const token = refreshCookie(login.headers['set-cookie'])

    const out = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      cookies: { 'legends.refresh': token },
    })
    expect(out.statusCode).toBe(204)

    const after = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { 'legends.refresh': token },
    })
    expect(after.statusCode).toBe(401)
    await app.close()
  })
})
```

- [ ] **Step 4: Rodar os testes e ver falhar**

Run:

```bash
cd apps/api && pnpm exec vitest run src/routes/auth.refresh.test.ts
```

Expected: FAIL — `/auth/refresh` e `/auth/logout` ainda não existem; login ainda devolve `token`, não `accessToken`.

- [ ] **Step 5: Implementar as rotas**

Em `apps/api/src/routes/auth.ts`:

Adicione os imports do serviço (junto aos imports existentes):

```ts
import {
  issueRefreshTokenForLogin,
  rotateRefreshToken,
  revokeByRawToken,
  RefreshError,
} from '../services/refresh-token-service'
```

Adicione, abaixo dos schemas existentes, o nome do cookie e o helper de opções:

```ts
const REFRESH_COOKIE = 'legends.refresh'

function refreshCookieOptions(persistent: boolean, expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/api/auth',
    ...(persistent ? { expires: expiresAt } : {}),
  }
}
```

Troque o `loginSchema` para aceitar `remember`:

```ts
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  remember: z.boolean().optional().default(false),
})
```

Substitua o corpo da rota `/login` para emitir o cookie e devolver `accessToken`:

```ts
  app.post('/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos' })
    }
    try {
      const user = await authenticateUser(parsed.data.email, parsed.data.password)
      const accessToken = app.jwt.sign({ sub: user.id, role: user.role })
      const refresh = await issueRefreshTokenForLogin(user.id, parsed.data.remember)
      reply.setCookie(
        REFRESH_COOKIE,
        refresh.rawToken,
        refreshCookieOptions(refresh.persistent, refresh.expiresAt),
      )
      return reply.send({ accessToken, user: toPublicUser(user) })
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.code(401).send({ message: err.message })
      }
      throw err
    }
  })
```

Substitua o corpo da rota `/register` para também emitir o cookie e devolver `accessToken` (mantém consistência com login; novo registro entra com cookie de sessão):

```ts
  app.post('/register', async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.flatten() })
    }
    try {
      const user = await registerUser(parsed.data)
      const accessToken = app.jwt.sign({ sub: user.id, role: user.role })
      const refresh = await issueRefreshTokenForLogin(user.id, false)
      reply.setCookie(
        REFRESH_COOKIE,
        refresh.rawToken,
        refreshCookieOptions(refresh.persistent, refresh.expiresAt),
      )
      return reply.code(201).send({ accessToken, user: toPublicUser(user) })
    } catch (err) {
      if (err instanceof AuthError) {
        return reply.code(409).send({ message: err.message })
      }
      throw err
    }
  })
```

Adicione as rotas `/refresh` e `/logout` logo após a rota `/login` (antes do `GET /me`):

```ts
  app.post('/refresh', async (request, reply) => {
    const raw = request.cookies[REFRESH_COOKIE]
    if (!raw) {
      return reply.code(401).send({ message: 'Não autorizado' })
    }
    try {
      const rotated = await rotateRefreshToken(raw)
      const user = await prisma.user.findUnique({ where: { id: rotated.userId } })
      if (!user || !user.active) {
        await revokeByRawToken(rotated.rawToken)
        reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' })
        return reply.code(401).send({ message: 'Não autorizado' })
      }
      const accessToken = app.jwt.sign({ sub: user.id, role: user.role })
      reply.setCookie(
        REFRESH_COOKIE,
        rotated.rawToken,
        refreshCookieOptions(rotated.persistent, rotated.expiresAt),
      )
      return reply.send({ accessToken })
    } catch (err) {
      if (err instanceof RefreshError) {
        reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' })
        return reply.code(401).send({ message: 'Não autorizado' })
      }
      throw err
    }
  })

  app.post('/logout', async (request, reply) => {
    const raw = request.cookies[REFRESH_COOKIE]
    if (raw) {
      await revokeByRawToken(raw)
    }
    reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' })
    return reply.code(204).send()
  })
```

- [ ] **Step 6: Rodar os testes e ver passar**

Run:

```bash
cd apps/api && pnpm exec vitest run src/routes/auth.refresh.test.ts
```

Expected: PASS (5 testes).

> Nota sobre o `path` do cookie: o front sempre chama `/api/auth/...` (em dev o proxy do Vite repassa o atributo `path` sem reescrever; em produção a API é servida na mesma origem). Por isso o cookie é escopado em `/api/auth`. Em `app.inject` o `path` não impede o envio via `cookies: {}`, então os testes não dependem disso.

- [ ] **Step 7: Type-check da API e do shared**

Run:

```bash
cd apps/api && pnpm exec tsc --noEmit
```

Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/auth.ts apps/api/src/routes/auth.ts apps/api/test/setup.ts apps/api/src/routes/auth.refresh.test.ts
git commit -m "feat(api): rotas /auth/refresh e /auth/logout + login com cookie de refresh"
```

---

## Task 4: Cliente web — access em memória + refresh single-flight

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Test: `apps/web/src/lib/api.test.ts`

- [ ] **Step 1: Reescrever os testes de api.ts**

Substitua todo o conteúdo de `apps/web/src/lib/api.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiFetch, setAccessToken, getAccessToken } from './api'

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: () => Promise.resolve(body),
  } as Response
}

describe('apiFetch', () => {
  beforeEach(() => {
    setAccessToken(null)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ ok: true })))
  })
  afterEach(() => vi.unstubAllGlobals())

  function callAt(i: number): [string, RequestInit] {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    return fetchMock.mock.calls[i] as [string, RequestInit]
  }
  function headersAt(i: number): Record<string, string> {
    return callAt(i)[1].headers as Record<string, string>
  }

  it('omits Content-Type on bodyless requests', async () => {
    await apiFetch('/admin/periods/p1/close', { method: 'POST' })
    expect(headersAt(0)['Content-Type']).toBeUndefined()
  })

  it('sets Content-Type: application/json when a body is sent', async () => {
    await apiFetch('/admin/periods', { method: 'POST', body: JSON.stringify({}) })
    expect(headersAt(0)['Content-Type']).toBe('application/json')
  })

  it('anexa o access token em memória como Bearer', async () => {
    setAccessToken('abc123')
    await apiFetch('/auth/me')
    expect(headersAt(0)['Authorization']).toBe('Bearer abc123')
  })

  it('em 401 faz refresh único e re-tenta a requisição original', async () => {
    const fetchMock = vi.fn()
    // 1ª chamada original -> 401; refresh -> ok com novo token; re-tentativa -> ok
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: 'expirado' }, { ok: false, status: 401 }))
      .mockResolvedValueOnce(jsonResponse({ accessToken: 'novo' }))
      .mockResolvedValueOnce(jsonResponse({ data: 1 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await apiFetch<{ data: number }>('/profile')
    expect(result).toEqual({ data: 1 })
    expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/refresh')
    expect(getAccessToken()).toBe('novo')
    // a re-tentativa usa o novo token
    expect((fetchMock.mock.calls[2][1] as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer novo',
    })
  })

  it('chamadas concorrentes em 401 disparam um único refresh', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url === '/api/auth/refresh') return Promise.resolve(jsonResponse({ accessToken: 'x' }))
      // todas as chamadas de negócio: 401 na 1ª passada, ok depois que houver token
      return Promise.resolve(
        getAccessToken()
          ? jsonResponse({ ok: true })
          : jsonResponse({}, { ok: false, status: 401 }),
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    await Promise.all([apiFetch('/a'), apiFetch('/b'), apiFetch('/c')])
    const refreshCalls = fetchMock.mock.calls.filter((c) => c[0] === '/api/auth/refresh')
    expect(refreshCalls).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run:

```bash
cd apps/web && pnpm exec vitest run src/lib/api.test.ts
```

Expected: FAIL — `setAccessToken`/`getAccessToken` ainda não existem e não há lógica de refresh.

- [ ] **Step 3: Reescrever api.ts**

Substitua todo o conteúdo de `apps/web/src/lib/api.ts`:

```ts
// Access token vive apenas em memória (não em storage) — some no reload e é
// restaurado por refresh silencioso. Refresh token viaja em cookie httpOnly.
let accessToken: string | null = null

export function setAccessToken(token: string | null): void {
  accessToken = token
}

export function getAccessToken(): string | null {
  return accessToken
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// Single-flight: refreshes concorrentes compartilham a mesma Promise.
let refreshPromise: Promise<boolean> | null = null

async function runRefresh(): Promise<boolean> {
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
    })
    if (!res.ok) {
      accessToken = null
      return false
    }
    const body = (await res.json()) as { accessToken: string }
    accessToken = body.accessToken
    return true
  } catch {
    accessToken = null
    return false
  }
}

export function refreshAccessToken(): Promise<boolean> {
  if (!refreshPromise) {
    refreshPromise = runRefresh().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  retryOn401 = true,
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...options,
    credentials: 'same-origin',
    headers: {
      // Só declara JSON quando há corpo. Um POST/DELETE sem corpo com
      // Content-Type: application/json é rejeitado pelo Fastify
      // (FST_ERR_CTP_EMPTY_JSON_BODY, 400).
      ...(options.body != null ? { 'Content-Type': 'application/json' } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...options.headers,
    },
  })

  if (
    res.status === 401 &&
    retryOn401 &&
    path !== '/auth/refresh' &&
    path !== '/auth/login'
  ) {
    const ok = await refreshAccessToken()
    if (ok) {
      return apiFetch<T>(path, options, false)
    }
  }

  if (!res.ok) {
    let message = 'Erro inesperado'
    try {
      const body = (await res.json()) as { message?: string }
      if (body.message) message = body.message
    } catch {
      // resposta sem corpo JSON
    }
    throw new ApiError(res.status, message)
  }

  return (await res.json()) as T
}
```

- [ ] **Step 4: Rodar os testes e ver passar**

Run:

```bash
cd apps/web && pnpm exec vitest run src/lib/api.test.ts
```

Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/api.ts apps/web/src/lib/api.test.ts
git commit -m "feat(web): access token em memoria com refresh silencioso single-flight"
```

---

## Task 5: AuthContext — bootstrap por refresh, login(remember), logout que revoga

**Files:**
- Modify: `apps/web/src/auth/AuthContext.tsx`

- [ ] **Step 1: Reescrever o AuthContext**

Substitua o conteúdo de `apps/web/src/auth/AuthContext.tsx`:

```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { AuthResponse, PublicUser } from '@legends/shared'
import {
  apiFetch,
  setAccessToken,
  clearAccessToken,
  refreshAccessToken,
} from '../lib/api'

interface AuthContextValue {
  user: PublicUser | null
  loading: boolean
  login: (email: string, password: string, remember?: boolean) => Promise<void>
  logout: () => void
  setUser: (user: PublicUser) => void
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Bootstrap: tenta restaurar a sessão via cookie de refresh.
    refreshAccessToken().then(async (ok) => {
      if (!ok) {
        setLoading(false)
        return
      }
      try {
        const res = await apiFetch<{ user: PublicUser }>('/auth/me')
        setUser(res.user)
      } catch {
        clearAccessToken()
      } finally {
        setLoading(false)
      }
    })
  }, [])

  async function login(email: string, password: string, remember = false) {
    const res = await apiFetch<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password, remember }),
    })
    setAccessToken(res.accessToken)
    setUser(res.user)
  }

  function logout() {
    // Revoga a família no servidor em segundo plano; limpa o estado já.
    apiFetch('/auth/logout', { method: 'POST' }).catch(() => {})
    clearAccessToken()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, setUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth deve ser usado dentro de AuthProvider')
  }
  return ctx
}
```

- [ ] **Step 2: Adicionar o helper clearAccessToken usado pelo contexto**

Em `apps/web/src/lib/api.ts`, adicione logo após `getAccessToken`:

```ts
export function clearAccessToken(): void {
  accessToken = null
}
```

- [ ] **Step 3: Type-check do web**

Run:

```bash
cd apps/web && pnpm exec tsc --noEmit
```

Expected: sem erros. (Confirma que nenhum consumidor ainda usa `getToken`/`setToken`/`clearToken` removidos nem `AuthResponse.token`.)

> Se o type-check apontar algum uso remanescente de `getToken`/`setToken`/`clearToken` ou `.token` de `AuthResponse`, ajuste o chamador para usar o novo fluxo (esses símbolos foram removidos de propósito).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/auth/AuthContext.tsx apps/web/src/lib/api.ts
git commit -m "feat(web): bootstrap por refresh silencioso, login remember e logout com revogacao"
```

---

## Task 6: Verificação completa

**Files:** nenhum (validação).

- [ ] **Step 1: Suíte de testes da API**

Run:

```bash
cd apps/api && pnpm test
```

Expected: todos os testes passam, incluindo `refresh-token-service` e `auth.refresh`.

- [ ] **Step 2: Suíte de testes do web**

Run:

```bash
cd apps/web && pnpm test
```

Expected: todos passam, incluindo `api.test.ts`.

- [ ] **Step 3: Type-check de todo o monorepo**

Run (na raiz):

```bash
pnpm -r exec tsc --noEmit
```

Expected: sem erros em nenhum pacote.

- [ ] **Step 4: Smoke manual (opcional, recomendado)**

Suba API + web (`pnpm dev` conforme o projeto), e no navegador:
1. Login **sem** "Manter conectado" → recarregar a página mantém logado (refresh silencioso); fechar o navegador e reabrir → cai no login (cookie de sessão).
2. Login **com** "Manter conectado" → fechar e reabrir o navegador → continua logado.
3. Deixar passar 15 min (ou reduzir o TTL temporariamente) e fazer uma ação → a chamada recebe 401, o refresh roda transparente e a ação conclui.
4. Logout → ação seguinte cai no login.

- [ ] **Step 5: Commit final (se houver ajustes do smoke)**

```bash
git add -A
git commit -m "chore: ajustes pos-verificacao do fluxo de refresh token"
```

---

## Notas de implementação

- **CSRF:** o único endpoint autenticado por cookie é `/auth/refresh`; com `SameSite=Strict` em mesma origem o vetor está coberto sem token anti-CSRF dedicado. As demais rotas usam `Authorization: Bearer` (header), imune a CSRF.
- **Migração de usuários:** tokens JWT de 7d antigos em `localStorage` deixam de ser lidos; cada usuário fará login novamente uma vez. Aceitável para o MVP.
- **`secure` do cookie:** ligado só em produção (`NODE_ENV === 'production'`) para não quebrar dev em HTTP.

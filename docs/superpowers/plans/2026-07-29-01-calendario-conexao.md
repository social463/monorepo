# Conexão de calendário (fase 1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada pessoa conecta a própria conta de Google Calendar ou Microsoft 365 ao Legends, com credenciais OAuth configuradas por empresa no admin, e os tokens ficam cifrados no banco.

**Architecture:** Rota fina → service → Prisma, como o resto da API. Dois adapters (`lib/calendar/google.ts`, `microsoft.ts`) são o único lugar que conhece o formato de cada provedor, atrás da interface `CalendarProviderAdapter` — mesma disciplina do `lib/teams-client.ts`. Credenciais da empresa moram em `AppSetting` (chave composta `key_companyId`), com o secret cifrado por `lib/crypto.ts` (AES-256-GCM). O `state` do OAuth é um token HMAC próprio, deliberadamente **não** um JWT da app, para não existir caminho de confundir state com access token.

**Tech Stack:** Fastify 4, Prisma 5, PostgreSQL, Zod, Vitest, React 18 + React Query + Tailwind, TypeScript ESM strict.

**Spec:** `docs/superpowers/specs/2026-07-29-calendario-conexao-design.md`

## Global Constraints

- TypeScript **strict**, ESM puro (`"type": "module"`), Node ≥ 20.
- Mensagens voltadas ao usuário em **português**.
- Route fina (Zod `safeParse` → `400 { message, issues }`), regra no service, DTO em `lib/serialize.ts`, contrato em `@legends/shared`. Não misturar camadas.
- Erros de domínio: classe com `status` HTTP; a route faz `instanceof` e responde `err.status` (padrão `VoteError`).
- **Nunca** editar migration já aplicada — sempre `pnpm db:migrate` gerando nova.
- Testes da API exigem Postgres de pé: `pnpm db:up` antes de rodar.
- Durante a implementação rode **só** o arquivo de teste da tarefa; a suíte completa (`pnpm test`) fica para o fim.
- Nenhum token, secret ou valor decifrado pode aparecer em log, resposta HTTP ou audit log.
- Todo acesso a dado é filtrado por `companyId` (multi-empresa).

---

### Task 1: `lib/crypto.ts` — cifra de segredos

**Files:**
- Create: `apps/api/src/lib/crypto.ts`
- Create: `apps/api/src/lib/crypto.test.ts`
- Modify: `apps/api/src/lib/config.ts` (acrescenta `resolveCalendarEncryptionKey`)
- Modify: `apps/api/.env.example`

**Interfaces:**
- Consumes: nada.
- Produces: `encryptSecret(plain: string): string`, `decryptSecret(stored: string): string`, `resolveCalendarEncryptionKey(env): Buffer`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/lib/crypto.test.ts
import { describe, it, expect } from 'vitest'
import { encryptSecret, decryptSecret } from './crypto'

describe('crypto', () => {
  it('faz round-trip do segredo', () => {
    const secret = 'GOCSPX-super-secret-value'
    expect(decryptSecret(encryptSecret(secret))).toBe(secret)
  })

  it('cifra o mesmo texto em valores diferentes (IV aleatório)', () => {
    const a = encryptSecret('mesmo-valor')
    const b = encryptSecret('mesmo-valor')
    expect(a).not.toBe(b)
    expect(decryptSecret(a)).toBe('mesmo-valor')
    expect(decryptSecret(b)).toBe('mesmo-valor')
  })

  it('o texto cifrado não contém o valor em claro', () => {
    expect(encryptSecret('valor-sensivel')).not.toContain('valor-sensivel')
  })

  it('rejeita ciphertext adulterado (tag de autenticação)', () => {
    const stored = encryptSecret('valor')
    const [version, iv, tag, ct] = stored.split(':')
    const flipped = ct.slice(0, -1) + (ct.at(-1) === 'A' ? 'B' : 'A')
    expect(() => decryptSecret([version, iv, tag, flipped].join(':'))).toThrow()
  })

  it('rejeita formato desconhecido', () => {
    expect(() => decryptSecret('v9:abc:def:ghi')).toThrow(/formato/i)
    expect(() => decryptSecret('sem-separador')).toThrow(/formato/i)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/api exec vitest run src/lib/crypto.test.ts`
Expected: FAIL — `Failed to resolve import "./crypto"`.

- [ ] **Step 3: Add the key resolver to `config.ts`**

Acrescente ao final de `apps/api/src/lib/config.ts`, seguindo o padrão de `resolveJwtSecret` (fallback em dev, erro em produção):

```ts
import { createHash } from 'node:crypto'

/**
 * Chave de 32 bytes usada para cifrar segredos em repouso (credenciais OAuth de
 * calendário e tokens de conexão). Mesmo padrão do JWT_SECRET: obrigatória em
 * produção, derivada de um valor fixo em desenvolvimento.
 */
export function resolveCalendarEncryptionKey(env: {
  NODE_ENV?: string
  CALENDAR_ENCRYPTION_KEY?: string
}): Buffer {
  if (env.CALENDAR_ENCRYPTION_KEY) {
    const key = Buffer.from(env.CALENDAR_ENCRYPTION_KEY, 'base64')
    if (key.length !== 32) {
      throw new Error('CALENDAR_ENCRYPTION_KEY deve ser 32 bytes em base64')
    }
    return key
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('CALENDAR_ENCRYPTION_KEY é obrigatório em produção')
  }
  return createHash('sha256').update('dev-calendar-key-change-me').digest()
}
```

- [ ] **Step 4: Write `lib/crypto.ts`**

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { resolveCalendarEncryptionKey } from './config'

/**
 * Cifra de segredos em repouso: AES-256-GCM, formato `v1:iv:tag:ciphertext`
 * (todas as partes em base64). O prefixo de versão existe para permitir rotação
 * de chave/algoritmo depois sem adivinhar formato.
 */
const VERSION = 'v1'
const IV_BYTES = 12

function key(): Buffer {
  return resolveCalendarEncryptionKey(process.env)
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':')
}

export function decryptSecret(stored: string): string {
  const parts = stored.split(':')
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error('Segredo cifrado em formato desconhecido')
  }
  const [, iv, tag, ct] = parts
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8')
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @legends/api exec vitest run src/lib/crypto.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 6: Document the env var**

Em `apps/api/.env.example`, abaixo de `GEMINI_API_KEY`:

```
# Chave de 32 bytes em base64 para cifrar credenciais/tokens de calendário.
# Gere com: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# Obrigatória em produção.
CALENDAR_ENCRYPTION_KEY=""
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/crypto.ts apps/api/src/lib/crypto.test.ts apps/api/src/lib/config.ts apps/api/.env.example
git commit -m "feat(api): cifra de segredos em repouso (AES-256-GCM)"
```

---

### Task 2: Modelo `CalendarConnection` e migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/src/services/calendar-connection-service.test.ts` (só o primeiro teste, de modelo)

**Interfaces:**
- Consumes: nada.
- Produces: models `CalendarConnection`, enums `CalendarProvider` (`GOOGLE`|`MICROSOFT`) e `CalendarConnectionStatus` (`ACTIVE`|`NEEDS_REAUTH`|`REVOKED`); campo `calendarConnections` em `User` e `Company`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/services/calendar-connection-service.test.ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'

async function createUser(email: string) {
  return prisma.user.create({
    data: { name: 'Ana', email, passwordHash: 'x', companyId: DEFAULT_COMPANY_ID },
  })
}

describe('CalendarConnection (modelo)', () => {
  it('grava uma conexão e impede duas do mesmo provedor para o mesmo usuário', async () => {
    const user = await createUser('ana@empresa.com')
    const data = {
      userId: user.id,
      companyId: DEFAULT_COMPANY_ID,
      provider: 'GOOGLE' as const,
      providerAccountEmail: 'ana@empresa.com',
      accessTokenEnc: 'enc-a',
      accessTokenExpiresAt: new Date(),
      refreshTokenEnc: 'enc-r',
      scopes: 'calendar.events',
    }
    const created = await prisma.calendarConnection.create({ data })
    expect(created.status).toBe('ACTIVE')
    expect(created.publishEnabled).toBe(true)
    expect(created.syncCursor).toBeNull()
    await expect(prisma.calendarConnection.create({ data })).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm db:up && pnpm --filter @legends/api exec vitest run src/services/calendar-connection-service.test.ts`
Expected: FAIL — `prisma.calendarConnection` é `undefined`.

- [ ] **Step 3: Add the schema**

Em `apps/api/prisma/schema.prisma`, junto dos outros enums:

```prisma
enum CalendarProvider {
  GOOGLE
  MICROSOFT
}

enum CalendarConnectionStatus {
  ACTIVE
  NEEDS_REAUTH
  REVOKED
}
```

E o model:

```prisma
model CalendarConnection {
  id                   String                   @id @default(cuid())
  userId               String
  companyId            String
  provider             CalendarProvider
  providerAccountEmail String
  /** Cifrado por lib/crypto.ts — nunca sai da API. */
  accessTokenEnc       String
  accessTokenExpiresAt DateTime
  /** Cifrado por lib/crypto.ts — nunca sai da API. */
  refreshTokenEnc      String
  scopes               String
  status               CalendarConnectionStatus @default(ACTIVE)
  /** Fase 3: opt-out de publicar eventos do Legends nesta agenda. */
  publishEnabled       Boolean                  @default(true)
  /** Fase 2: syncToken (Google) / deltaLink (Graph). */
  syncCursor           String?
  lastSyncAt           DateTime?
  lastSyncError        String?
  createdAt            DateTime                 @default(now())
  updatedAt            DateTime                 @updatedAt

  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  company Company @relation(fields: [companyId], references: [id])

  @@unique([userId, provider])
  @@index([companyId])
  @@index([status])
}
```

Acrescente a relação inversa em `User` (junto de `refreshTokens`, `moodEntries` etc.):

```prisma
  calendarConnections CalendarConnection[]
```

E em `Company` (junto de `notifications`, `moodEntries` etc.):

```prisma
  calendarConnections CalendarConnection[]
```

- [ ] **Step 4: Generate the migration**

```bash
pnpm db:migrate
```

Quando pedir nome, use `calendar_connection`. Confirme que apareceu **uma** pasta nova em `apps/api/prisma/migrations/` e que nenhuma existente foi tocada:

```bash
git status --short apps/api/prisma/migrations
```

Expected: só linhas `??` (arquivo novo), nenhuma `M`.

- [ ] **Step 5: Add the table to the test truncation list**

`apps/api/test/setup.ts` trunca as tabelas numa **ordem fixa** dentro de um
`$transaction`. `CalendarConnection` tem FK para `User`, então sem essa linha o
`prisma.user.deleteMany()` passa a falhar por violação de chave estrangeira — e
quebra a suíte inteira, não só estes testes. Acrescente **antes** de
`prisma.user.deleteMany()`:

```ts
    prisma.calendarConnection.deleteMany(),
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @legends/api exec vitest run src/services/calendar-connection-service.test.ts`
Expected: PASS.

- [ ] **Step 7: Confirm the rest of the suite still truncates cleanly**

Run: `pnpm --filter @legends/api exec vitest run src/routes/streak.test.ts`
Expected: PASS — prova que a ordem de truncamento continua válida.

- [ ] **Step 8: Commit**

```bash
git add apps/api/prisma apps/api/test/setup.ts apps/api/src/services/calendar-connection-service.test.ts
git commit -m "feat(api): modelo CalendarConnection com tokens cifrados"
```

---

### Task 3: Contrato em `@legends/shared`

**Files:**
- Create: `packages/shared/src/calendar.ts`
- Create: `packages/shared/src/calendar.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `CalendarProviderKey`, `CALENDAR_PROVIDERS`, `isCalendarProviderKey`, `CalendarConnectionDTO`, `CalendarIntegrationStateDTO`, `CalendarProviderSettingsDTO`, `CalendarSettingsDTO`, `UpdateCalendarSettingsRequest`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/calendar.test.ts
import { describe, it, expect } from 'vitest'
import { CALENDAR_PROVIDERS, isCalendarProviderKey } from './calendar'

describe('calendar', () => {
  it('lista os dois provedores suportados, nessa ordem', () => {
    expect(CALENDAR_PROVIDERS).toEqual(['google', 'microsoft'])
  })

  it('isCalendarProviderKey aceita só as chaves conhecidas', () => {
    expect(isCalendarProviderKey('google')).toBe(true)
    expect(isCalendarProviderKey('microsoft')).toBe(true)
    expect(isCalendarProviderKey('GOOGLE')).toBe(false)
    expect(isCalendarProviderKey('apple')).toBe(false)
    expect(isCalendarProviderKey(undefined)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/shared exec vitest run src/calendar.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Write the contract**

```ts
// packages/shared/src/calendar.ts

/** Provedores de calendário suportados; ordem = ordem de exibição na UI. */
export type CalendarProviderKey = 'google' | 'microsoft'

export const CALENDAR_PROVIDERS: readonly CalendarProviderKey[] = ['google', 'microsoft']

export function isCalendarProviderKey(value: unknown): value is CalendarProviderKey {
  return typeof value === 'string' && (CALENDAR_PROVIDERS as readonly string[]).includes(value)
}

export const CALENDAR_PROVIDER_LABELS: Record<CalendarProviderKey, string> = {
  google: 'Google Calendar',
  microsoft: 'Microsoft 365',
}

export type CalendarConnectionStatusKey = 'active' | 'needs_reauth' | 'revoked'

/** Conexão de calendário de uma pessoa. Por construção, sem nenhum campo de token. */
export interface CalendarConnectionDTO {
  provider: CalendarProviderKey
  accountEmail: string
  status: CalendarConnectionStatusKey
  publishEnabled: boolean
  lastSyncAt: string | null
}

export interface CalendarIntegrationStateDTO {
  connections: CalendarConnectionDTO[]
  /** Provedores que o admin da empresa já configurou (têm credenciais). */
  available: CalendarProviderKey[]
}

/** Estado das credenciais de um provedor, do ponto de vista do admin. O secret nunca volta. */
export interface CalendarProviderSettingsDTO {
  configured: boolean
  clientId: string | null
  /** Só Microsoft. */
  tenantId?: string | null
  /** URI que o admin precisa registrar no app do provedor. */
  redirectUri: string
}

export interface CalendarSettingsDTO {
  google: CalendarProviderSettingsDTO
  microsoft: CalendarProviderSettingsDTO
}

/**
 * Campo ausente = mantém o valor atual. String vazia = limpa.
 * Isso permite salvar o formulário sem reenviar o secret.
 */
export interface UpdateCalendarSettingsRequest {
  google?: { clientId?: string; clientSecret?: string }
  microsoft?: { clientId?: string; clientSecret?: string; tenantId?: string }
}
```

- [ ] **Step 4: Export from the barrel**

Em `packages/shared/src/index.ts`, depois de `export * from './audit-log'`:

```ts
export * from './calendar'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @legends/shared exec vitest run src/calendar.test.ts`
Expected: PASS (2 testes).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/calendar.ts packages/shared/src/calendar.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): contrato de integração de calendário"
```

---

### Task 4: Interface do adapter + adapter do Google

**Files:**
- Create: `apps/api/src/lib/calendar/provider.ts`
- Create: `apps/api/src/lib/calendar/google.ts`
- Create: `apps/api/src/lib/calendar/google.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `CalendarCredentials`, `CalendarTokens`, `CalendarProviderAdapter`, `CalendarReauthRequiredError`, `googleAdapter`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/lib/calendar/google.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { googleAdapter } from './google'
import { CalendarReauthRequiredError } from './provider'

const creds = { clientId: 'cid', clientSecret: 'csecret' }

/** id_token só precisa do payload — o token vem do endpoint do Google sobre TLS. */
function idToken(email: string): string {
  const payload = Buffer.from(JSON.stringify({ email })).toString('base64url')
  return `header.${payload}.sig`
}

function stubFetch(status: number, body: unknown) {
  const spy = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => vi.restoreAllMocks())

describe('googleAdapter.authorizeUrl', () => {
  it('monta a URL com scopes, state e refresh token garantido', () => {
    const url = new URL(
      googleAdapter.authorizeUrl({ creds, redirectUri: 'https://app/api/calendar/callback/google', state: 'st8' }),
    )
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('redirect_uri')).toBe('https://app/api/calendar/callback/google')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('state')).toBe('st8')
    // sem estes dois o Google não devolve refresh token numa reautorização
    expect(url.searchParams.get('access_type')).toBe('offline')
    expect(url.searchParams.get('prompt')).toBe('consent')
    expect(url.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/calendar.events')
  })
})

describe('googleAdapter.exchangeCode', () => {
  it('mapeia a resposta para CalendarTokens e extrai o e-mail do id_token', async () => {
    stubFetch(200, {
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 3599,
      scope: 'https://www.googleapis.com/auth/calendar.events',
      id_token: idToken('ana@empresa.com'),
    })
    const tokens = await googleAdapter.exchangeCode({ creds, redirectUri: 'https://app/cb', code: 'code-1' })
    expect(tokens.accessToken).toBe('at')
    expect(tokens.refreshToken).toBe('rt')
    expect(tokens.email).toBe('ana@empresa.com')
    expect(tokens.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('lança em erro do provedor', async () => {
    stubFetch(400, { error: 'invalid_grant' })
    await expect(googleAdapter.exchangeCode({ creds, redirectUri: 'https://app/cb', code: 'ruim' })).rejects.toThrow()
  })
})

describe('googleAdapter.refresh', () => {
  it('preserva o refresh token quando a resposta não traz um novo', async () => {
    stubFetch(200, { access_token: 'at2', expires_in: 3599, scope: 'calendar.events' })
    const tokens = await googleAdapter.refresh({ creds, refreshToken: 'rt-antigo' })
    expect(tokens.accessToken).toBe('at2')
    expect(tokens.refreshToken).toBe('rt-antigo')
  })

  it('invalid_grant vira CalendarReauthRequiredError, não erro genérico', async () => {
    stubFetch(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })
    await expect(googleAdapter.refresh({ creds, refreshToken: 'rt' })).rejects.toBeInstanceOf(
      CalendarReauthRequiredError,
    )
  })
})

describe('googleAdapter.revoke', () => {
  it('posta o refresh token no endpoint de revoke', async () => {
    const spy = stubFetch(200, {})
    await googleAdapter.revoke({ creds, refreshToken: 'rt' })
    expect(String(spy.mock.calls[0][0])).toContain('https://oauth2.googleapis.com/revoke')
  })

  it('engole falha de rede (best-effort)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('rede') }))
    await expect(googleAdapter.revoke({ creds, refreshToken: 'rt' })).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/api exec vitest run src/lib/calendar/google.test.ts`
Expected: FAIL — módulos não existem.

- [ ] **Step 3: Write the provider contract**

```ts
// apps/api/src/lib/calendar/provider.ts

/** Credenciais do app OAuth da empresa (BYO app — uma por tenant). */
export interface CalendarCredentials {
  clientId: string
  clientSecret: string
  /** Só Microsoft. */
  tenantId?: string
}

export interface CalendarTokens {
  accessToken: string
  refreshToken: string
  expiresAt: Date
  scopes: string
}

/**
 * O consentimento foi revogado ou expirou. É condição **esperada**: o chamador
 * marca a conexão como NEEDS_REAUTH em vez de tratar como falha inesperada.
 */
export class CalendarReauthRequiredError extends Error {
  constructor(message = 'A autorização do calendário expirou. Reconecte sua conta.') {
    super(message)
    this.name = 'CalendarReauthRequiredError'
  }
}

/**
 * Contrato de um provedor de calendário. Só as implementações (google.ts,
 * microsoft.ts) conhecem o formato de cada API — mesma disciplina do
 * lib/teams-client.ts com o Adaptive Card. Fases 2 e 3 acrescentam aqui
 * listEvents e createEvent/updateEvent/deleteEvent.
 */
export interface CalendarProviderAdapter {
  authorizeUrl(input: { creds: CalendarCredentials; redirectUri: string; state: string }): string
  exchangeCode(input: {
    creds: CalendarCredentials
    redirectUri: string
    code: string
  }): Promise<CalendarTokens & { email: string }>
  refresh(input: { creds: CalendarCredentials; refreshToken: string }): Promise<CalendarTokens>
  revoke(input: { creds: CalendarCredentials; refreshToken: string }): Promise<void>
}

const HTTP_TIMEOUT_MS = 10_000

/** POST de formulário nos endpoints de token, com timeout. Compartilhado pelos adapters. */
export async function postForm(url: string, form: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  })
  const body: unknown = await res.json().catch(() => ({}))
  if (!res.ok) {
    const error = typeof body === 'object' && body !== null ? String((body as { error?: unknown }).error ?? '') : ''
    if (error === 'invalid_grant' || error === 'interaction_required' || error === 'consent_required') {
      throw new CalendarReauthRequiredError()
    }
    throw new Error(`Provedor de calendário respondeu ${res.status}${error ? ` (${error})` : ''}`)
  }
  return body
}

/**
 * Lê uma claim do payload do id_token. Não verifica assinatura de propósito: o
 * token veio direto do endpoint de token do provedor sobre TLS, então a origem
 * já está estabelecida.
 */
export function claimFromIdToken(idToken: string | undefined, claims: string[]): string | null {
  const payload = idToken?.split('.')[1]
  if (!payload) return null
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
    for (const claim of claims) {
      const value = decoded[claim]
      if (typeof value === 'string' && value.length > 0) return value
    }
    return null
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Write the Google adapter**

```ts
// apps/api/src/lib/calendar/google.ts
import {
  claimFromIdToken,
  postForm,
  type CalendarProviderAdapter,
  type CalendarTokens,
} from './provider'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

/** Escrita já entra aqui para a fase 3 não pedir consentimento de novo. */
export const GOOGLE_SCOPES = 'openid email https://www.googleapis.com/auth/calendar.events'

interface GoogleTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  id_token?: string
}

function toTokens(body: unknown, fallbackRefresh: string): CalendarTokens {
  const res = body as GoogleTokenResponse
  if (!res.access_token) throw new Error('Google não devolveu access_token')
  return {
    accessToken: res.access_token,
    refreshToken: res.refresh_token ?? fallbackRefresh,
    expiresAt: new Date(Date.now() + (res.expires_in ?? 3600) * 1000),
    scopes: res.scope ?? GOOGLE_SCOPES,
  }
}

export const googleAdapter: CalendarProviderAdapter = {
  authorizeUrl({ creds, redirectUri, state }) {
    const params = new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GOOGLE_SCOPES,
      state,
      // sem estes dois o Google só devolve refresh token na primeira autorização
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
    })
    return `${AUTH_URL}?${params.toString()}`
  },

  async exchangeCode({ creds, redirectUri, code }) {
    const body = await postForm(TOKEN_URL, {
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    })
    const tokens = toTokens(body, '')
    if (!tokens.refreshToken) throw new Error('Google não devolveu refresh_token')
    const email = claimFromIdToken((body as GoogleTokenResponse).id_token, ['email'])
    if (!email) throw new Error('Google não devolveu o e-mail da conta')
    return { ...tokens, email }
  },

  async refresh({ creds, refreshToken }) {
    const body = await postForm(TOKEN_URL, {
      refresh_token: refreshToken,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: 'refresh_token',
    })
    return toTokens(body, refreshToken)
  },

  async revoke({ refreshToken }) {
    // Best-effort: a conexão local é apagada de todo jeito.
    try {
      await postForm(REVOKE_URL, { token: refreshToken })
    } catch (err) {
      console.error('[calendar/google] revoke falhou', err)
    }
  },
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @legends/api exec vitest run src/lib/calendar/google.test.ts`
Expected: PASS (7 testes).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/calendar
git commit -m "feat(api): adapter OAuth do Google Calendar"
```

---

### Task 5: Adapter da Microsoft + registry

**Files:**
- Create: `apps/api/src/lib/calendar/microsoft.ts`
- Create: `apps/api/src/lib/calendar/microsoft.test.ts`
- Create: `apps/api/src/lib/calendar/index.ts`

**Interfaces:**
- Consumes: `CalendarProviderAdapter`, `postForm`, `claimFromIdToken`, `CalendarReauthRequiredError` (Task 4).
- Produces: `microsoftAdapter`, `MICROSOFT_SCOPES`, `adapterFor(provider: CalendarProviderKey): CalendarProviderAdapter`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/lib/calendar/microsoft.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { microsoftAdapter } from './microsoft'
import { adapterFor } from './index'
import { googleAdapter } from './google'
import { CalendarReauthRequiredError } from './provider'

const creds = { clientId: 'cid', clientSecret: 'csecret', tenantId: 'tenant-123' }

function idToken(claims: Record<string, string>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.s`
}

function stubFetch(status: number, body: unknown) {
  const spy = vi.fn(async () => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => vi.restoreAllMocks())

describe('microsoftAdapter.authorizeUrl', () => {
  it('usa o tenant configurado e pede offline_access', () => {
    const url = new URL(
      microsoftAdapter.authorizeUrl({ creds, redirectUri: 'https://app/api/calendar/callback/microsoft', state: 'st8' }),
    )
    expect(url.pathname).toBe('/tenant-123/oauth2/v2.0/authorize')
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('state')).toBe('st8')
    expect(url.searchParams.get('scope')).toContain('offline_access')
    expect(url.searchParams.get('scope')).toContain('Calendars.ReadWrite')
  })

  it('cai em `common` quando o tenant não foi informado', () => {
    const url = new URL(
      microsoftAdapter.authorizeUrl({
        creds: { clientId: 'cid', clientSecret: 'cs' },
        redirectUri: 'https://app/cb',
        state: 's',
      }),
    )
    expect(url.pathname).toBe('/common/oauth2/v2.0/authorize')
  })
})

describe('microsoftAdapter.exchangeCode', () => {
  it('extrai o e-mail de preferred_username quando não há claim email', async () => {
    stubFetch(200, {
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 3599,
      scope: 'Calendars.ReadWrite',
      id_token: idToken({ preferred_username: 'ana@empresa.com' }),
    })
    const tokens = await microsoftAdapter.exchangeCode({ creds, redirectUri: 'https://app/cb', code: 'c' })
    expect(tokens.email).toBe('ana@empresa.com')
    expect(tokens.refreshToken).toBe('rt')
  })
})

describe('microsoftAdapter.refresh', () => {
  it('invalid_grant vira CalendarReauthRequiredError', async () => {
    stubFetch(400, { error: 'invalid_grant' })
    await expect(microsoftAdapter.refresh({ creds, refreshToken: 'rt' })).rejects.toBeInstanceOf(
      CalendarReauthRequiredError,
    )
  })
})

describe('microsoftAdapter.revoke', () => {
  it('não chama a rede — a Microsoft não expõe revoke de refresh token delegado', async () => {
    const spy = stubFetch(200, {})
    await microsoftAdapter.revoke({ creds, refreshToken: 'rt' })
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('adapterFor', () => {
  it('resolve provedor → adapter', () => {
    expect(adapterFor('google')).toBe(googleAdapter)
    expect(adapterFor('microsoft')).toBe(microsoftAdapter)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/api exec vitest run src/lib/calendar/microsoft.test.ts`
Expected: FAIL — módulos não existem.

- [ ] **Step 3: Write the Microsoft adapter**

```ts
// apps/api/src/lib/calendar/microsoft.ts
import {
  claimFromIdToken,
  postForm,
  type CalendarCredentials,
  type CalendarProviderAdapter,
  type CalendarTokens,
} from './provider'

const BASE = 'https://login.microsoftonline.com'

/** Escrita já entra aqui para a fase 3 não pedir consentimento de novo. */
export const MICROSOFT_SCOPES = 'openid email offline_access https://graph.microsoft.com/Calendars.ReadWrite'

function tenant(creds: CalendarCredentials): string {
  return creds.tenantId?.trim() || 'common'
}

interface MicrosoftTokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  id_token?: string
}

function toTokens(body: unknown, fallbackRefresh: string): CalendarTokens {
  const res = body as MicrosoftTokenResponse
  if (!res.access_token) throw new Error('Microsoft não devolveu access_token')
  return {
    accessToken: res.access_token,
    refreshToken: res.refresh_token ?? fallbackRefresh,
    expiresAt: new Date(Date.now() + (res.expires_in ?? 3600) * 1000),
    scopes: res.scope ?? MICROSOFT_SCOPES,
  }
}

export const microsoftAdapter: CalendarProviderAdapter = {
  authorizeUrl({ creds, redirectUri, state }) {
    const params = new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      response_mode: 'query',
      scope: MICROSOFT_SCOPES,
      state,
    })
    return `${BASE}/${tenant(creds)}/oauth2/v2.0/authorize?${params.toString()}`
  },

  async exchangeCode({ creds, redirectUri, code }) {
    const body = await postForm(`${BASE}/${tenant(creds)}/oauth2/v2.0/token`, {
      code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      scope: MICROSOFT_SCOPES,
    })
    const tokens = toTokens(body, '')
    if (!tokens.refreshToken) throw new Error('Microsoft não devolveu refresh_token')
    const email = claimFromIdToken((body as MicrosoftTokenResponse).id_token, [
      'email',
      'preferred_username',
      'upn',
    ])
    if (!email) throw new Error('Microsoft não devolveu o e-mail da conta')
    return { ...tokens, email }
  },

  async refresh({ creds, refreshToken }) {
    const body = await postForm(`${BASE}/${tenant(creds)}/oauth2/v2.0/token`, {
      refresh_token: refreshToken,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: 'refresh_token',
      scope: MICROSOFT_SCOPES,
    })
    return toTokens(body, refreshToken)
  },

  async revoke() {
    // A Microsoft não expõe revoke de refresh token delegado (só
    // /me/revokeSignInSessions, que mata todas as sessões da pessoa — desproporcional).
    // Apagar a conexão local já impede qualquer uso do token pelo Legends.
  },
}
```

- [ ] **Step 4: Write the registry**

```ts
// apps/api/src/lib/calendar/index.ts
import type { CalendarProviderKey } from '@legends/shared'
import { googleAdapter } from './google'
import { microsoftAdapter } from './microsoft'
import type { CalendarProviderAdapter } from './provider'

const ADAPTERS: Record<CalendarProviderKey, CalendarProviderAdapter> = {
  google: googleAdapter,
  microsoft: microsoftAdapter,
}

export function adapterFor(provider: CalendarProviderKey): CalendarProviderAdapter {
  return ADAPTERS[provider]
}

export * from './provider'
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @legends/api exec vitest run src/lib/calendar/microsoft.test.ts`
Expected: PASS (6 testes).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/calendar
git commit -m "feat(api): adapter OAuth da Microsoft e registry de provedores"
```

---

### Task 6: `state` assinado do OAuth

**Files:**
- Create: `apps/api/src/lib/calendar/state.ts`
- Create: `apps/api/src/lib/calendar/state.test.ts`

**Interfaces:**
- Consumes: `resolveCalendarEncryptionKey` (Task 1).
- Produces: `signCalendarState(payload: CalendarStatePayload): string`, `verifyCalendarState(token: string): CalendarStatePayload` (lança `CalendarStateError`), tipo `CalendarStatePayload = { userId, companyId, provider }`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/lib/calendar/state.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { signCalendarState, verifyCalendarState, CalendarStateError } from './state'

const payload = { userId: 'u1', companyId: 'c1', provider: 'google' as const }

afterEach(() => vi.useRealTimers())

describe('calendar state', () => {
  it('faz round-trip do payload', () => {
    expect(verifyCalendarState(signCalendarState(payload))).toMatchObject(payload)
  })

  it('gera state diferente a cada chamada (nonce)', () => {
    expect(signCalendarState(payload)).not.toBe(signCalendarState(payload))
  })

  it('rejeita payload adulterado', () => {
    const [body, sig] = signCalendarState(payload).split('.')
    const forged = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), userId: 'outro' }),
    ).toString('base64url')
    expect(() => verifyCalendarState(`${forged}.${sig}`)).toThrow(CalendarStateError)
  })

  it('rejeita state expirado (10 min)', () => {
    const token = signCalendarState(payload)
    vi.useFakeTimers()
    vi.setSystemTime(new Date(Date.now() + 11 * 60 * 1000))
    expect(() => verifyCalendarState(token)).toThrow(CalendarStateError)
  })

  it('rejeita lixo', () => {
    expect(() => verifyCalendarState('nada')).toThrow(CalendarStateError)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/api exec vitest run src/lib/calendar/state.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Write the module**

```ts
// apps/api/src/lib/calendar/state.ts
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { CalendarProviderKey } from '@legends/shared'
import { resolveCalendarEncryptionKey } from '../config'

/**
 * `state` do fluxo OAuth: token curto assinado por HMAC, com quem iniciou o
 * fluxo. É deliberadamente **não** um JWT da app: reusar o segredo/formato do
 * access token criaria um caminho para confundir state com credencial de sessão.
 * Também dispensa tabela de estado — o callback só aceita o que nós assinamos.
 */
export interface CalendarStatePayload {
  userId: string
  companyId: string
  provider: CalendarProviderKey
}

interface SignedState extends CalendarStatePayload {
  nonce: string
  /** epoch ms. */
  iat: number
}

const TTL_MS = 10 * 60 * 1000

export class CalendarStateError extends Error {
  status = 400
  constructor(message = 'Autorização inválida ou expirada. Tente conectar novamente.') {
    super(message)
    this.name = 'CalendarStateError'
  }
}

function hmacKey(): Buffer {
  // Domínio separado da chave de cifra: mesma origem, uso diferente.
  return createHmac('sha256', resolveCalendarEncryptionKey(process.env)).update('calendar-oauth-state').digest()
}

function sign(body: string): string {
  return createHmac('sha256', hmacKey()).update(body).digest('base64url')
}

export function signCalendarState(payload: CalendarStatePayload): string {
  const state: SignedState = { ...payload, nonce: randomBytes(12).toString('base64url'), iat: Date.now() }
  const body = Buffer.from(JSON.stringify(state)).toString('base64url')
  return `${body}.${sign(body)}`
}

export function verifyCalendarState(token: string): CalendarStatePayload {
  const [body, signature] = token.split('.')
  if (!body || !signature) throw new CalendarStateError()

  const expected = Buffer.from(sign(body))
  const received = Buffer.from(signature)
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new CalendarStateError()
  }

  let parsed: SignedState
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SignedState
  } catch {
    throw new CalendarStateError()
  }
  if (typeof parsed.iat !== 'number' || Date.now() - parsed.iat > TTL_MS) {
    throw new CalendarStateError()
  }
  return { userId: parsed.userId, companyId: parsed.companyId, provider: parsed.provider }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @legends/api exec vitest run src/lib/calendar/state.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/calendar/state.ts apps/api/src/lib/calendar/state.test.ts
git commit -m "feat(api): state assinado para o fluxo OAuth de calendário"
```

---

### Task 7: Serviço de credenciais por empresa

**Files:**
- Create: `apps/api/src/services/calendar-settings-service.ts`
- Create: `apps/api/src/services/calendar-settings-service.test.ts`

**Interfaces:**
- Consumes: `encryptSecret`/`decryptSecret` (Task 1), `recordAuditLog` (existente), `CalendarProviderKey`/`CalendarSettingsDTO`/`UpdateCalendarSettingsRequest` (Task 3), `absoluteUrl` (existente).
- Produces:
  - `calendarRedirectUri(provider: CalendarProviderKey): string`
  - `getCalendarCredentials(companyId: string, provider: CalendarProviderKey): Promise<CalendarCredentials | null>`
  - `availableCalendarProviders(companyId: string): Promise<CalendarProviderKey[]>`
  - `getCalendarSettings(companyId: string): Promise<CalendarSettingsDTO>`
  - `updateCalendarSettings(input: { companyId: string; actorId: string; body: UpdateCalendarSettingsRequest }): Promise<CalendarSettingsDTO>`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/services/calendar-settings-service.test.ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import {
  availableCalendarProviders,
  calendarRedirectUri,
  getCalendarCredentials,
  getCalendarSettings,
  updateCalendarSettings,
} from './calendar-settings-service'

async function actor() {
  const user = await prisma.user.create({
    data: { name: 'Admin', email: 'admin@empresa.com', passwordHash: 'x', role: 'ADMIN', companyId: DEFAULT_COMPANY_ID },
  })
  return user.id
}

describe('calendar settings service', () => {
  it('sem credenciais, nada está configurado nem disponível', async () => {
    const settings = await getCalendarSettings(DEFAULT_COMPANY_ID)
    expect(settings.google.configured).toBe(false)
    expect(settings.google.clientId).toBeNull()
    expect(await availableCalendarProviders(DEFAULT_COMPANY_ID)).toEqual([])
  })

  it('grava credenciais do Google e passa a considerar o provedor disponível', async () => {
    const actorId = await actor()
    const settings = await updateCalendarSettings({
      companyId: DEFAULT_COMPANY_ID,
      actorId,
      body: { google: { clientId: 'cid', clientSecret: 'csecret' } },
    })
    expect(settings.google).toMatchObject({ configured: true, clientId: 'cid' })
    expect(await availableCalendarProviders(DEFAULT_COMPANY_ID)).toEqual(['google'])
    const creds = await getCalendarCredentials(DEFAULT_COMPANY_ID, 'google')
    expect(creds).toMatchObject({ clientId: 'cid', clientSecret: 'csecret' })
  })

  it('o secret vai cifrado para o banco', async () => {
    const actorId = await actor()
    await updateCalendarSettings({
      companyId: DEFAULT_COMPANY_ID,
      actorId,
      body: { google: { clientId: 'cid', clientSecret: 'csecret' } },
    })
    const row = await prisma.appSetting.findFirst({ where: { key: 'calendar_google_client_secret_enc' } })
    expect(row?.value).not.toContain('csecret')
    expect(row?.value?.startsWith('v1:')).toBe(true)
  })

  it('o audit log não guarda o secret', async () => {
    const actorId = await actor()
    await updateCalendarSettings({
      companyId: DEFAULT_COMPANY_ID,
      actorId,
      body: { google: { clientId: 'cid', clientSecret: 'csecret' } },
    })
    const logs = await prisma.adminAuditLog.findMany({ where: { entityType: 'CalendarSettings' } })
    expect(logs).toHaveLength(1)
    expect(JSON.stringify(logs[0])).not.toContain('csecret')
  })

  it('secret ausente mantém o atual; string vazia limpa', async () => {
    const actorId = await actor()
    const base = { companyId: DEFAULT_COMPANY_ID, actorId }
    await updateCalendarSettings({ ...base, body: { google: { clientId: 'cid', clientSecret: 'csecret' } } })

    await updateCalendarSettings({ ...base, body: { google: { clientId: 'cid-2' } } })
    expect(await getCalendarCredentials(DEFAULT_COMPANY_ID, 'google')).toMatchObject({
      clientId: 'cid-2',
      clientSecret: 'csecret',
    })

    await updateCalendarSettings({ ...base, body: { google: { clientSecret: '' } } })
    expect(await getCalendarCredentials(DEFAULT_COMPANY_ID, 'google')).toBeNull()
  })

  it('Microsoft só está configurada com tenantId', async () => {
    const actorId = await actor()
    await updateCalendarSettings({
      companyId: DEFAULT_COMPANY_ID,
      actorId,
      body: { microsoft: { clientId: 'cid', clientSecret: 'cs' } },
    })
    expect((await getCalendarSettings(DEFAULT_COMPANY_ID)).microsoft.configured).toBe(false)

    await updateCalendarSettings({
      companyId: DEFAULT_COMPANY_ID,
      actorId,
      body: { microsoft: { tenantId: 'tenant-1' } },
    })
    expect((await getCalendarSettings(DEFAULT_COMPANY_ID)).microsoft.configured).toBe(true)
  })

  it('credenciais são isoladas por empresa', async () => {
    const actorId = await actor()
    const other = await prisma.company.create({ data: { name: 'Outra', slug: 'outra' } })
    await updateCalendarSettings({
      companyId: DEFAULT_COMPANY_ID,
      actorId,
      body: { google: { clientId: 'cid', clientSecret: 'cs' } },
    })
    expect(await getCalendarCredentials(other.id, 'google')).toBeNull()
  })

  it('o redirect URI é derivado do app base URL e inclui /api', () => {
    expect(calendarRedirectUri('google')).toMatch(/\/api\/calendar\/callback\/google$/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/api exec vitest run src/services/calendar-settings-service.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Write the service**

```ts
// apps/api/src/services/calendar-settings-service.ts
import {
  CALENDAR_PROVIDERS,
  type CalendarProviderKey,
  type CalendarProviderSettingsDTO,
  type CalendarSettingsDTO,
  type UpdateCalendarSettingsRequest,
} from '@legends/shared'
import { prisma } from '../lib/prisma'
import { absoluteUrl } from '../lib/app-url'
import { decryptSecret, encryptSecret } from '../lib/crypto'
import type { CalendarCredentials } from '../lib/calendar/provider'
import { recordAuditLog } from './audit-log-service'

/**
 * Credenciais OAuth são por empresa (BYO app — o Legends é whitelabel, cada
 * tenant registra o próprio app no Google Cloud / Entra ID). Ficam em
 * `AppSetting`, mesma mecânica do webhook da Quinta de Desenvolvimento.
 */
export const CALENDAR_SETTING_KEYS = {
  google: {
    clientId: 'calendar_google_client_id',
    clientSecret: 'calendar_google_client_secret_enc',
  },
  microsoft: {
    clientId: 'calendar_microsoft_client_id',
    clientSecret: 'calendar_microsoft_client_secret_enc',
    tenantId: 'calendar_microsoft_tenant_id',
  },
} as const

const AUDIT_ENTITY = 'CalendarSettings'

/**
 * URI que o admin registra no app do provedor. Derivado do app base URL e nunca
 * aceito por parâmetro — redirect URI controlável pelo cliente é o buraco
 * clássico deste fluxo. O `/api` existe porque o nginx faz proxy de `/api/`
 * para o Fastify.
 */
export function calendarRedirectUri(provider: CalendarProviderKey): string {
  return absoluteUrl(`/api/calendar/callback/${provider}`)
}

/**
 * `AppSetting` tem unique composta (key, companyId): o seletor precisa vir
 * inteiro em `key_companyId`, então `scopedPrisma` não se aplica e o companyId
 * vai explícito nos dois lados — igual ao development-thursday-service.
 */
async function readSetting(companyId: string, key: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key_companyId: { key, companyId } } })
  return row?.value ?? null
}

async function writeSetting(companyId: string, key: string, value: string | null): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key_companyId: { key, companyId } },
    create: { key, companyId, value },
    update: { value },
  })
}

export async function getCalendarCredentials(
  companyId: string,
  provider: CalendarProviderKey,
): Promise<CalendarCredentials | null> {
  const keys = CALENDAR_SETTING_KEYS[provider]
  const [clientId, secretEnc] = await Promise.all([
    readSetting(companyId, keys.clientId),
    readSetting(companyId, keys.clientSecret),
  ])
  if (!clientId || !secretEnc) return null

  if (provider === 'microsoft') {
    const tenantId = await readSetting(companyId, CALENDAR_SETTING_KEYS.microsoft.tenantId)
    if (!tenantId) return null
    return { clientId, clientSecret: decryptSecret(secretEnc), tenantId }
  }
  return { clientId, clientSecret: decryptSecret(secretEnc) }
}

export async function availableCalendarProviders(companyId: string): Promise<CalendarProviderKey[]> {
  const available: CalendarProviderKey[] = []
  for (const provider of CALENDAR_PROVIDERS) {
    if (await getCalendarCredentials(companyId, provider)) available.push(provider)
  }
  return available
}

async function providerSettings(
  companyId: string,
  provider: CalendarProviderKey,
): Promise<CalendarProviderSettingsDTO> {
  const keys = CALENDAR_SETTING_KEYS[provider]
  const [clientId, secretEnc] = await Promise.all([
    readSetting(companyId, keys.clientId),
    readSetting(companyId, keys.clientSecret),
  ])
  const base = { clientId, redirectUri: calendarRedirectUri(provider) }
  if (provider === 'microsoft') {
    const tenantId = await readSetting(companyId, CALENDAR_SETTING_KEYS.microsoft.tenantId)
    return { ...base, tenantId, configured: Boolean(clientId && secretEnc && tenantId) }
  }
  return { ...base, configured: Boolean(clientId && secretEnc) }
}

export async function getCalendarSettings(companyId: string): Promise<CalendarSettingsDTO> {
  return {
    google: await providerSettings(companyId, 'google'),
    microsoft: await providerSettings(companyId, 'microsoft'),
  }
}

/**
 * Campo ausente mantém o valor atual (permite salvar o formulário sem reenviar
 * o secret); string vazia limpa.
 */
export async function updateCalendarSettings(input: {
  companyId: string
  actorId: string
  body: UpdateCalendarSettingsRequest
}): Promise<CalendarSettingsDTO> {
  const { companyId, actorId, body } = input
  const before = await getCalendarSettings(companyId)

  for (const provider of CALENDAR_PROVIDERS) {
    const patch = body[provider]
    if (!patch) continue
    const keys = CALENDAR_SETTING_KEYS[provider]

    if (patch.clientId !== undefined) {
      await writeSetting(companyId, keys.clientId, patch.clientId.trim() || null)
    }
    if (patch.clientSecret !== undefined) {
      const trimmed = patch.clientSecret.trim()
      await writeSetting(companyId, keys.clientSecret, trimmed ? encryptSecret(trimmed) : null)
    }
    if (provider === 'microsoft' && 'tenantId' in patch && patch.tenantId !== undefined) {
      await writeSetting(companyId, CALENDAR_SETTING_KEYS.microsoft.tenantId, patch.tenantId.trim() || null)
    }
  }

  const after = await getCalendarSettings(companyId)
  // `before`/`after` são os DTOs — que por construção não carregam secret.
  await recordAuditLog({
    actorId,
    entityType: AUDIT_ENTITY,
    entityId: companyId,
    action: 'UPDATE',
    companyId,
    before,
    after,
  })
  return after
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @legends/api exec vitest run src/services/calendar-settings-service.test.ts`
Expected: PASS (8 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/calendar-settings-service.ts apps/api/src/services/calendar-settings-service.test.ts
git commit -m "feat(api): credenciais OAuth de calendário por empresa"
```

---

### Task 8: Serviço de conexão

**Files:**
- Create: `apps/api/src/services/calendar-connection-service.ts`
- Modify: `apps/api/src/services/calendar-connection-service.test.ts` (acrescenta aos testes da Task 2)
- Modify: `apps/api/src/lib/serialize.ts` (acrescenta `toCalendarConnectionDTO`)

**Interfaces:**
- Consumes: `adapterFor` (Task 5), `signCalendarState`/`verifyCalendarState` (Task 6), `getCalendarCredentials`/`availableCalendarProviders`/`calendarRedirectUri` (Task 7), `encryptSecret`/`decryptSecret` (Task 1).
- Produces:
  - `CalendarError` (com `status`)
  - `startCalendarConnection(input: { userId; companyId; provider }): Promise<{ authorizeUrl: string }>`
  - `completeCalendarConnection(input: { provider; code; state }): Promise<{ userId: string }>` — devolve o userId lido do `state` para a route montar o redirect sem reinterpretar o state
  - `getCalendarIntegrationState(input: { userId; companyId }): Promise<CalendarIntegrationStateDTO>`
  - `disconnectCalendar(input: { userId; provider }): Promise<void>`
  - `getValidAccessToken(connectionId: string): Promise<string>`
  - `toCalendarConnectionDTO(connection: CalendarConnection): CalendarConnectionDTO`

- [ ] **Step 1: Write the failing test**

Acrescente ao final de `apps/api/src/services/calendar-connection-service.test.ts` (o `import` de `vi` entra na primeira linha do arquivo):

```ts
import { vi, afterEach } from 'vitest'
import {
  CalendarError,
  completeCalendarConnection,
  disconnectCalendar,
  getCalendarIntegrationState,
  getValidAccessToken,
  startCalendarConnection,
} from './calendar-connection-service'
import { updateCalendarSettings } from './calendar-settings-service'
import { signCalendarState } from '../lib/calendar/state'
import { decryptSecret } from '../lib/crypto'

async function withGoogleCredentials(companyId: string, actorId: string) {
  await updateCalendarSettings({
    companyId,
    actorId,
    body: { google: { clientId: 'cid', clientSecret: 'csecret' } },
  })
}

function stubTokenResponse(body: Record<string, unknown>) {
  const spy = vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
  vi.stubGlobal('fetch', spy)
  return spy
}

function idToken(email: string): string {
  return `h.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.s`
}

afterEach(() => vi.restoreAllMocks())

describe('calendar connection service', () => {
  it('startCalendarConnection devolve authorizeUrl com state verificável', async () => {
    const user = await createUser('ana@empresa.com')
    await withGoogleCredentials(DEFAULT_COMPANY_ID, user.id)
    const { authorizeUrl } = await startCalendarConnection({
      userId: user.id,
      companyId: DEFAULT_COMPANY_ID,
      provider: 'google',
    })
    const state = new URL(authorizeUrl).searchParams.get('state')
    expect(state).toBeTruthy()
    expect(authorizeUrl).toContain('accounts.google.com')
  })

  it('startCalendarConnection falha com 409 quando a empresa não configurou o provedor', async () => {
    const user = await createUser('ana@empresa.com')
    await expect(
      startCalendarConnection({ userId: user.id, companyId: DEFAULT_COMPANY_ID, provider: 'google' }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('completeCalendarConnection grava a conexão com tokens cifrados', async () => {
    const user = await createUser('ana@empresa.com')
    await withGoogleCredentials(DEFAULT_COMPANY_ID, user.id)
    stubTokenResponse({
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: 3600,
      scope: 'calendar.events',
      id_token: idToken('ana@gmail.com'),
    })

    await completeCalendarConnection({
      provider: 'google',
      code: 'code-1',
      state: signCalendarState({ userId: user.id, companyId: DEFAULT_COMPANY_ID, provider: 'google' }),
    })

    const row = await prisma.calendarConnection.findFirstOrThrow({ where: { userId: user.id } })
    expect(row.providerAccountEmail).toBe('ana@gmail.com')
    expect(row.status).toBe('ACTIVE')
    expect(row.accessTokenEnc).not.toContain('at')
    expect(decryptSecret(row.accessTokenEnc)).toBe('at')
    expect(decryptSecret(row.refreshTokenEnc)).toBe('rt')
  })

  it('reconectar o mesmo provedor atualiza a linha, não duplica', async () => {
    const user = await createUser('ana@empresa.com')
    await withGoogleCredentials(DEFAULT_COMPANY_ID, user.id)
    const state = () => signCalendarState({ userId: user.id, companyId: DEFAULT_COMPANY_ID, provider: 'google' })

    stubTokenResponse({ access_token: 'at1', refresh_token: 'rt1', expires_in: 3600, id_token: idToken('a@b.com') })
    await completeCalendarConnection({ provider: 'google', code: 'c1', state: state() })
    stubTokenResponse({ access_token: 'at2', refresh_token: 'rt2', expires_in: 3600, id_token: idToken('a@b.com') })
    await completeCalendarConnection({ provider: 'google', code: 'c2', state: state() })

    const rows = await prisma.calendarConnection.findMany({ where: { userId: user.id } })
    expect(rows).toHaveLength(1)
    expect(decryptSecret(rows[0].accessTokenEnc)).toBe('at2')
    expect(rows[0].status).toBe('ACTIVE')
  })

  it('completeCalendarConnection rejeita state adulterado', async () => {
    const user = await createUser('ana@empresa.com')
    await withGoogleCredentials(DEFAULT_COMPANY_ID, user.id)
    await expect(
      completeCalendarConnection({ provider: 'google', code: 'c', state: 'invalido' }),
    ).rejects.toBeInstanceOf(CalendarError)
  })

  it('completeCalendarConnection rejeita provedor diferente do assinado no state', async () => {
    const user = await createUser('ana@empresa.com')
    await withGoogleCredentials(DEFAULT_COMPANY_ID, user.id)
    const state = signCalendarState({ userId: user.id, companyId: DEFAULT_COMPANY_ID, provider: 'google' })
    await expect(
      completeCalendarConnection({ provider: 'microsoft', code: 'c', state }),
    ).rejects.toBeInstanceOf(CalendarError)
  })

  it('getCalendarIntegrationState lista conexão e provedores disponíveis, sem token', async () => {
    const user = await createUser('ana@empresa.com')
    await withGoogleCredentials(DEFAULT_COMPANY_ID, user.id)
    stubTokenResponse({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, id_token: idToken('a@b.com') })
    await completeCalendarConnection({
      provider: 'google',
      code: 'c',
      state: signCalendarState({ userId: user.id, companyId: DEFAULT_COMPANY_ID, provider: 'google' }),
    })

    const state = await getCalendarIntegrationState({ userId: user.id, companyId: DEFAULT_COMPANY_ID })
    expect(state.available).toEqual(['google'])
    expect(state.connections).toEqual([
      { provider: 'google', accountEmail: 'a@b.com', status: 'active', publishEnabled: true, lastSyncAt: null },
    ])
    expect(JSON.stringify(state)).not.toContain('rt')
  })

  it('getValidAccessToken renova quando o access token está expirado', async () => {
    const user = await createUser('ana@empresa.com')
    await withGoogleCredentials(DEFAULT_COMPANY_ID, user.id)
    const connection = await prisma.calendarConnection.create({
      data: {
        userId: user.id,
        companyId: DEFAULT_COMPANY_ID,
        provider: 'GOOGLE',
        providerAccountEmail: 'a@b.com',
        accessTokenEnc: encryptSecret('velho'),
        accessTokenExpiresAt: new Date(Date.now() - 1000),
        refreshTokenEnc: encryptSecret('rt'),
        scopes: 'calendar.events',
      },
    })
    stubTokenResponse({ access_token: 'novo', expires_in: 3600, scope: 'calendar.events' })

    expect(await getValidAccessToken(connection.id)).toBe('novo')
    const reloaded = await prisma.calendarConnection.findUniqueOrThrow({ where: { id: connection.id } })
    expect(decryptSecret(reloaded.accessTokenEnc)).toBe('novo')
    expect(reloaded.accessTokenExpiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('getValidAccessToken marca NEEDS_REAUTH quando o consentimento foi revogado', async () => {
    const user = await createUser('ana@empresa.com')
    await withGoogleCredentials(DEFAULT_COMPANY_ID, user.id)
    const connection = await prisma.calendarConnection.create({
      data: {
        userId: user.id,
        companyId: DEFAULT_COMPANY_ID,
        provider: 'GOOGLE',
        providerAccountEmail: 'a@b.com',
        accessTokenEnc: encryptSecret('velho'),
        accessTokenExpiresAt: new Date(Date.now() - 1000),
        refreshTokenEnc: encryptSecret('rt'),
        scopes: 'calendar.events',
      },
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })))

    await expect(getValidAccessToken(connection.id)).rejects.toBeTruthy()
    const reloaded = await prisma.calendarConnection.findUniqueOrThrow({ where: { id: connection.id } })
    expect(reloaded.status).toBe('NEEDS_REAUTH')
  })

  it('disconnectCalendar apaga a conexão', async () => {
    const user = await createUser('ana@empresa.com')
    await withGoogleCredentials(DEFAULT_COMPANY_ID, user.id)
    stubTokenResponse({ access_token: 'at', refresh_token: 'rt', expires_in: 3600, id_token: idToken('a@b.com') })
    await completeCalendarConnection({
      provider: 'google',
      code: 'c',
      state: signCalendarState({ userId: user.id, companyId: DEFAULT_COMPANY_ID, provider: 'google' }),
    })

    await disconnectCalendar({ userId: user.id, provider: 'google' })
    expect(await prisma.calendarConnection.count({ where: { userId: user.id } })).toBe(0)
  })
})
```

Acrescente `import { encryptSecret } from '../lib/crypto'` ao topo do arquivo.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/api exec vitest run src/services/calendar-connection-service.test.ts`
Expected: FAIL — `./calendar-connection-service` não existe.

- [ ] **Step 3: Add the DTO converter to `serialize.ts`**

Ao final de `apps/api/src/lib/serialize.ts`:

```ts
import type { CalendarConnection } from '@prisma/client'
import type { CalendarConnectionDTO, CalendarProviderKey } from '@legends/shared'

/** Nunca inclui token: o DTO de @legends/shared não tem esse campo, por construção. */
export function toCalendarConnectionDTO(connection: CalendarConnection): CalendarConnectionDTO {
  return {
    provider: connection.provider.toLowerCase() as CalendarProviderKey,
    accountEmail: connection.providerAccountEmail,
    status: connection.status.toLowerCase() as CalendarConnectionDTO['status'],
    publishEnabled: connection.publishEnabled,
    lastSyncAt: connection.lastSyncAt?.toISOString() ?? null,
  }
}
```

- [ ] **Step 4: Write the service**

```ts
// apps/api/src/services/calendar-connection-service.ts
import type { CalendarProvider } from '@prisma/client'
import {
  CALENDAR_PROVIDER_LABELS,
  type CalendarIntegrationStateDTO,
  type CalendarProviderKey,
} from '@legends/shared'
import { prisma } from '../lib/prisma'
import { adapterFor, CalendarReauthRequiredError } from '../lib/calendar'
import { signCalendarState, verifyCalendarState, CalendarStateError } from '../lib/calendar/state'
import { decryptSecret, encryptSecret } from '../lib/crypto'
import { toCalendarConnectionDTO } from '../lib/serialize'
import {
  availableCalendarProviders,
  calendarRedirectUri,
  getCalendarCredentials,
} from './calendar-settings-service'

/** Erro de domínio com status HTTP — padrão VoteError. */
export class CalendarError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'CalendarError'
    this.status = status
  }
}

function toPrismaProvider(provider: CalendarProviderKey): CalendarProvider {
  return provider.toUpperCase() as CalendarProvider
}

/** Renova um pouco antes do vencimento para não corrermos atrás do relógio. */
const REFRESH_MARGIN_MS = 60_000

async function requireCredentials(companyId: string, provider: CalendarProviderKey) {
  const creds = await getCalendarCredentials(companyId, provider)
  if (!creds) {
    throw new CalendarError(
      `${CALENDAR_PROVIDER_LABELS[provider]} ainda não foi configurado pelo administrador da sua empresa.`,
      409,
    )
  }
  return creds
}

export async function startCalendarConnection(input: {
  userId: string
  companyId: string
  provider: CalendarProviderKey
}): Promise<{ authorizeUrl: string }> {
  const creds = await requireCredentials(input.companyId, input.provider)
  const state = signCalendarState({
    userId: input.userId,
    companyId: input.companyId,
    provider: input.provider,
  })
  const authorizeUrl = adapterFor(input.provider).authorizeUrl({
    creds,
    redirectUri: calendarRedirectUri(input.provider),
    state,
  })
  return { authorizeUrl }
}

export async function completeCalendarConnection(input: {
  provider: CalendarProviderKey
  code: string
  state: string
}): Promise<{ userId: string }> {
  let payload
  try {
    payload = verifyCalendarState(input.state)
  } catch (err) {
    if (err instanceof CalendarStateError) throw new CalendarError(err.message, 400)
    throw err
  }
  // O provedor da URL tem que casar com o que assinamos — o userId vem do state,
  // nunca do request.
  if (payload.provider !== input.provider) {
    throw new CalendarError('Autorização inválida. Tente conectar novamente.', 400)
  }

  const creds = await requireCredentials(payload.companyId, input.provider)
  const tokens = await adapterFor(input.provider).exchangeCode({
    creds,
    redirectUri: calendarRedirectUri(input.provider),
    code: input.code,
  })

  const data = {
    companyId: payload.companyId,
    providerAccountEmail: tokens.email,
    accessTokenEnc: encryptSecret(tokens.accessToken),
    accessTokenExpiresAt: tokens.expiresAt,
    refreshTokenEnc: encryptSecret(tokens.refreshToken),
    scopes: tokens.scopes,
    status: 'ACTIVE' as const,
    lastSyncError: null,
  }
  await prisma.calendarConnection.upsert({
    where: { userId_provider: { userId: payload.userId, provider: toPrismaProvider(input.provider) } },
    create: { ...data, userId: payload.userId, provider: toPrismaProvider(input.provider) },
    update: data,
  })
  return { userId: payload.userId }
}

export async function getCalendarIntegrationState(input: {
  userId: string
  companyId: string
}): Promise<CalendarIntegrationStateDTO> {
  const [connections, available] = await Promise.all([
    prisma.calendarConnection.findMany({
      where: { userId: input.userId, companyId: input.companyId },
      orderBy: { provider: 'asc' },
    }),
    availableCalendarProviders(input.companyId),
  ])
  return { connections: connections.map(toCalendarConnectionDTO), available }
}

export async function disconnectCalendar(input: {
  userId: string
  provider: CalendarProviderKey
}): Promise<void> {
  const connection = await prisma.calendarConnection.findUnique({
    where: { userId_provider: { userId: input.userId, provider: toPrismaProvider(input.provider) } },
  })
  if (!connection) throw new CalendarError('Conexão não encontrada.', 404)

  const creds = await getCalendarCredentials(connection.companyId, input.provider)
  if (creds) {
    // Best-effort: revogar é cortesia com o provedor; o que garante que o Legends
    // perde o acesso é apagar a linha.
    await adapterFor(input.provider).revoke({ creds, refreshToken: decryptSecret(connection.refreshTokenEnc) })
  }
  await prisma.calendarConnection.delete({ where: { id: connection.id } })
}

/**
 * Access token válido da conexão, renovando quando necessário. Consumido pelas
 * fases 2 e 3. Consentimento revogado vira NEEDS_REAUTH — a pessoa vê
 * "reconectar" no perfil em vez de um erro opaco.
 */
export async function getValidAccessToken(connectionId: string): Promise<string> {
  const connection = await prisma.calendarConnection.findUniqueOrThrow({ where: { id: connectionId } })
  if (connection.accessTokenExpiresAt.getTime() - Date.now() > REFRESH_MARGIN_MS) {
    return decryptSecret(connection.accessTokenEnc)
  }

  const provider = connection.provider.toLowerCase() as CalendarProviderKey
  const creds = await requireCredentials(connection.companyId, provider)
  try {
    const tokens = await adapterFor(provider).refresh({
      creds,
      refreshToken: decryptSecret(connection.refreshTokenEnc),
    })
    await prisma.calendarConnection.update({
      where: { id: connection.id },
      data: {
        accessTokenEnc: encryptSecret(tokens.accessToken),
        accessTokenExpiresAt: tokens.expiresAt,
        refreshTokenEnc: encryptSecret(tokens.refreshToken),
        scopes: tokens.scopes,
        status: 'ACTIVE',
        lastSyncError: null,
      },
    })
    return tokens.accessToken
  } catch (err) {
    if (err instanceof CalendarReauthRequiredError) {
      await prisma.calendarConnection.update({
        where: { id: connection.id },
        data: { status: 'NEEDS_REAUTH', lastSyncError: err.message },
      })
    }
    throw err
  }
}
```

- [ ] **Step 5: Extend the audit-log warning to the new secrets**

`apps/api/src/services/audit-log-service.ts:24` já documenta o risco de um `User`
completo vazar `passwordHash`/`email`/`teamsWebhookUrl` para `before`/`after`. Os
tokens de calendário são da mesma categoria. Acrescente-os à lista no comentário
de `toSafeUserRef`, para quem for escrever o próximo audit log já saber:

```ts
 * antes de entrar num payload de auditoria — nunca deixe `passwordHash`/`email`/
 * `teamsWebhookUrl`/`accessTokenEnc`/`refreshTokenEnc` de um `User` completo (ou de
 * uma `CalendarConnection` incluída) vazar via include aninhado para `before`/`after`.
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @legends/api exec vitest run src/services/calendar-connection-service.test.ts`
Expected: PASS (11 testes — o de modelo da Task 2 mais os 10 novos).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/calendar-connection-service.ts apps/api/src/services/calendar-connection-service.test.ts apps/api/src/lib/serialize.ts apps/api/src/services/audit-log-service.ts
git commit -m "feat(api): serviço de conexão de calendário (OAuth, refresh, revoke)"
```

---

### Task 9: Rotas `/calendar/*`

**Files:**
- Create: `apps/api/src/routes/calendar.ts`
- Create: `apps/api/src/routes/calendar.test.ts`
- Modify: `apps/api/src/app.ts` (import + `app.register(calendarRoutes)`)

**Interfaces:**
- Consumes: tudo da Task 8, `isCalendarProviderKey` (Task 3), `appBaseUrl` (existente).
- Produces: `calendarRoutes(app: FastifyInstance)`; endpoints `GET /calendar/connections`, `POST /calendar/connect/:provider`, `GET /calendar/callback/:provider`, `DELETE /calendar/connections/:provider`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/routes/calendar.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import { signCalendarState } from '../lib/calendar/state'
import { updateCalendarSettings } from '../services/calendar-settings-service'

async function setup() {
  const app = buildApp()
  await app.ready()
  const reg = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' },
  })
  const token = reg.json().accessToken as string
  const user = await prisma.user.findUniqueOrThrow({ where: { email: 'ana@empresa.com' } })
  return { app, token, user }
}

async function configureGoogle(actorId: string) {
  await updateCalendarSettings({
    companyId: DEFAULT_COMPANY_ID,
    actorId,
    body: { google: { clientId: 'cid', clientSecret: 'csecret' } },
  })
}

function stubTokenResponse() {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: 'at',
            refresh_token: 'rt',
            expires_in: 3600,
            scope: 'calendar.events',
            id_token: `h.${Buffer.from(JSON.stringify({ email: 'ana@gmail.com' })).toString('base64url')}.s`,
          }),
          { status: 200 },
        ),
    ),
  )
}

afterEach(() => vi.restoreAllMocks())

describe('calendar routes', () => {
  it('GET /calendar/connections exige autenticação', async () => {
    const { app } = await setup()
    expect((await app.inject({ method: 'GET', url: '/calendar/connections' })).statusCode).toBe(401)
    await app.close()
  })

  it('GET /calendar/connections devolve estado vazio sem credenciais', async () => {
    const { app, token } = await setup()
    const res = await app.inject({
      method: 'GET',
      url: '/calendar/connections',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ connections: [], available: [] })
    await app.close()
  })

  it('POST /calendar/connect/google devolve 409 sem credenciais na empresa', async () => {
    const { app, token } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/calendar/connect/google',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(409)
    expect(res.json().message).toContain('administrador')
    await app.close()
  })

  it('POST /calendar/connect/google devolve authorizeUrl', async () => {
    const { app, token, user } = await setup()
    await configureGoogle(user.id)
    const res = await app.inject({
      method: 'POST',
      url: '/calendar/connect/google',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().authorizeUrl).toContain('accounts.google.com')
    await app.close()
  })

  it('POST /calendar/connect/:provider rejeita provedor desconhecido com 400', async () => {
    const { app, token } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/calendar/connect/apple',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('GET /calendar/callback/google salva a conexão e redireciona com sucesso', async () => {
    const { app, user } = await setup()
    await configureGoogle(user.id)
    stubTokenResponse()
    const state = signCalendarState({ userId: user.id, companyId: DEFAULT_COMPANY_ID, provider: 'google' })

    const res = await app.inject({ method: 'GET', url: `/calendar/callback/google?code=c1&state=${state}` })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toContain('calendario=ok')
    expect(await prisma.calendarConnection.count({ where: { userId: user.id } })).toBe(1)
    await app.close()
  })

  it('GET /calendar/callback/google com state inválido redireciona com erro e não cria conexão', async () => {
    const { app, user } = await setup()
    await configureGoogle(user.id)
    const res = await app.inject({ method: 'GET', url: '/calendar/callback/google?code=c1&state=forjado' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toContain('calendario=erro')
    expect(await prisma.calendarConnection.count({ where: { userId: user.id } })).toBe(0)
    await app.close()
  })

  it('GET /calendar/callback/google com erro do provedor redireciona com erro', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'GET', url: '/calendar/callback/google?error=access_denied' })
    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toContain('calendario=erro')
    await app.close()
  })

  it('DELETE /calendar/connections/google remove a conexão', async () => {
    const { app, token, user } = await setup()
    await configureGoogle(user.id)
    stubTokenResponse()
    const state = signCalendarState({ userId: user.id, companyId: DEFAULT_COMPANY_ID, provider: 'google' })
    await app.inject({ method: 'GET', url: `/calendar/callback/google?code=c1&state=${state}` })

    const res = await app.inject({
      method: 'DELETE',
      url: '/calendar/connections/google',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(204)
    expect(await prisma.calendarConnection.count({ where: { userId: user.id } })).toBe(0)
    await app.close()
  })

  it('DELETE /calendar/connections/google devolve 404 sem conexão', async () => {
    const { app, token } = await setup()
    const res = await app.inject({
      method: 'DELETE',
      url: '/calendar/connections/google',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('uma pessoa não vê a conexão de outra', async () => {
    const { app, user } = await setup()
    await configureGoogle(user.id)
    stubTokenResponse()
    const state = signCalendarState({ userId: user.id, companyId: DEFAULT_COMPANY_ID, provider: 'google' })
    await app.inject({ method: 'GET', url: `/calendar/callback/google?code=c1&state=${state}` })

    const reg = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Bia', email: 'bia@empresa.com', password: 'changeme123' },
    })
    const other = reg.json().accessToken as string
    const res = await app.inject({
      method: 'GET',
      url: '/calendar/connections',
      headers: { authorization: `Bearer ${other}` },
    })
    expect(res.json().connections).toEqual([])
    await app.close()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/api exec vitest run src/routes/calendar.test.ts`
Expected: FAIL — todas as rotas devolvem 404.

- [ ] **Step 3: Write the routes**

```ts
// apps/api/src/routes/calendar.ts
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { isCalendarProviderKey, type CalendarProviderKey } from '@legends/shared'
import { appBaseUrl } from '../lib/app-url'
import {
  CalendarError,
  completeCalendarConnection,
  disconnectCalendar,
  getCalendarIntegrationState,
  startCalendarConnection,
} from '../services/calendar-connection-service'

const providerParamsSchema = z.object({
  provider: z.string().refine(isCalendarProviderKey, 'Provedor de calendário não suportado'),
})

const callbackQuerySchema = z.object({
  code: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  error: z.string().optional(),
})

/** Volta para o perfil da pessoa com o resultado do fluxo. */
function profileRedirect(userId: string | null, result: 'ok' | 'erro'): string {
  const base = appBaseUrl()
  return userId ? `${base}/perfil/${userId}?calendario=${result}` : `${base}/login?calendario=${result}`
}

export async function calendarRoutes(app: FastifyInstance) {
  app.get('/calendar/connections', { onRequest: [app.authenticate] }, async (request, reply) => {
    const state = await getCalendarIntegrationState({
      userId: request.user.sub,
      companyId: request.user.companyId,
    })
    return reply.send(state)
  })

  app.post('/calendar/connect/:provider', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = providerParamsSchema.safeParse(request.params)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    try {
      const result = await startCalendarConnection({
        userId: request.user.sub,
        companyId: request.user.companyId,
        provider: parsed.data.provider as CalendarProviderKey,
      })
      return reply.send(result)
    } catch (err) {
      if (err instanceof CalendarError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  /**
   * Callback do provedor. Não passa por `authenticate`: quem chega aqui é o
   * navegador redirecionado pelo Google/Microsoft, sem o access token em memória.
   * A identidade vem do `state` assinado, não da sessão.
   */
  app.get('/calendar/callback/:provider', async (request, reply) => {
    const params = providerParamsSchema.safeParse(request.params)
    const query = callbackQuerySchema.safeParse(request.query)
    if (!params.success || !query.success || query.data.error || !query.data.code || !query.data.state) {
      return reply.redirect(302, profileRedirect(null, 'erro'))
    }
    try {
      // O service valida o state e devolve de quem é o fluxo — a route não
      // reinterpreta o state, para não existirem duas leituras da mesma coisa.
      const { userId } = await completeCalendarConnection({
        provider: params.data.provider as CalendarProviderKey,
        code: query.data.code,
        state: query.data.state,
      })
      return reply.redirect(302, profileRedirect(userId, 'ok'))
    } catch (err) {
      if (!(err instanceof CalendarError)) {
        console.error('[calendar] callback falhou', err)
      }
      return reply.redirect(302, profileRedirect(null, 'erro'))
    }
  })

  app.delete('/calendar/connections/:provider', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = providerParamsSchema.safeParse(request.params)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    try {
      await disconnectCalendar({
        userId: request.user.sub,
        provider: parsed.data.provider as CalendarProviderKey,
      })
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof CalendarError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
}
```

- [ ] **Step 4: Register in `app.ts`**

Import junto dos outros (depois de `import { streakRoutes } from './routes/streak'`):

```ts
import { calendarRoutes } from './routes/calendar'
```

E o register, depois de `app.register(streakRoutes)`:

```ts
  app.register(calendarRoutes)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @legends/api exec vitest run src/routes/calendar.test.ts`
Expected: PASS (11 testes).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/calendar.ts apps/api/src/routes/calendar.test.ts apps/api/src/app.ts
git commit -m "feat(api): rotas de conexão de calendário"
```

---

### Task 10: Rotas admin de credenciais

**Files:**
- Modify: `apps/api/src/routes/admin.ts` (duas rotas novas ao final do plugin)
- Modify: `apps/api/src/routes/admin.test.ts` (testes novos)

**Interfaces:**
- Consumes: `getCalendarSettings`/`updateCalendarSettings` (Task 7).
- Produces: `GET /admin/calendar-settings`, `PUT /admin/calendar-settings`.

- [ ] **Step 1: Write the failing test**

Acrescente ao final do `describe('admin routes', ...)` em `apps/api/src/routes/admin.test.ts`:

```ts
  it('GET /admin/calendar-settings devolve estado não configurado e o redirect URI', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const res = await app.inject({
      method: 'GET',
      url: '/admin/calendar-settings',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.google).toMatchObject({ configured: false, clientId: null })
    expect(body.google.redirectUri).toContain('/api/calendar/callback/google')
    expect(body.microsoft.redirectUri).toContain('/api/calendar/callback/microsoft')
    await app.close()
  })

  it('PUT /admin/calendar-settings grava credenciais e nunca devolve o secret', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/calendar-settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { google: { clientId: 'cid', clientSecret: 'csecret' } },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().google).toMatchObject({ configured: true, clientId: 'cid' })
    expect(JSON.stringify(res.json())).not.toContain('csecret')
    await app.close()
  })

  it('PUT /admin/calendar-settings sem o secret mantém o que já estava', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const headers = { authorization: `Bearer ${token}` }
    await app.inject({
      method: 'PUT',
      url: '/admin/calendar-settings',
      headers,
      payload: { google: { clientId: 'cid', clientSecret: 'csecret' } },
    })
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/calendar-settings',
      headers,
      payload: { google: { clientId: 'cid-2' } },
    })
    expect(res.json().google).toMatchObject({ configured: true, clientId: 'cid-2' })
    await app.close()
  })

  it('PUT /admin/calendar-settings rejeita payload inválido com 400', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/calendar-settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { google: { clientId: 123 } },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('/admin/calendar-settings é restrito a admin', async () => {
    const app = buildApp()
    await app.ready()
    const token = await devToken(app)
    const res = await app.inject({
      method: 'GET',
      url: '/admin/calendar-settings',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts -t "calendar-settings"`
Expected: FAIL — 404 em vez de 200.

- [ ] **Step 3: Add the routes**

No topo de `apps/api/src/routes/admin.ts`, junto dos outros imports de service:

```ts
import { getCalendarSettings, updateCalendarSettings } from '../services/calendar-settings-service'
```

Junto dos outros schemas Zod do arquivo:

```ts
const calendarSettingsSchema = z.object({
  google: z.object({ clientId: z.string().optional(), clientSecret: z.string().optional() }).optional(),
  microsoft: z
    .object({
      clientId: z.string().optional(),
      clientSecret: z.string().optional(),
      tenantId: z.string().optional(),
    })
    .optional(),
})
```

E as rotas, ao final do plugin `adminRoutes`:

```ts
  app.get('/admin/calendar-settings', { onRequest: [app.authenticate, app.requireAdmin] }, async (request, reply) => {
    return reply.send(await getCalendarSettings(request.user.companyId))
  })

  app.put('/admin/calendar-settings', { onRequest: [app.authenticate, app.requireAdmin] }, async (request, reply) => {
    const parsed = calendarSettingsSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    const settings = await updateCalendarSettings({
      companyId: request.user.companyId,
      actorId: request.user.sub,
      body: parsed.data,
    })
    return reply.send(settings)
  })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts -t "calendar-settings"`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/admin.ts apps/api/src/routes/admin.test.ts
git commit -m "feat(api): rotas admin de credenciais de calendário"
```

---

### Task 11: Cliente HTTP no web

**Files:**
- Create: `apps/web/src/lib/calendar-api.ts`

**Interfaces:**
- Consumes: `apiFetch` (existente), tipos da Task 3.
- Produces: `getCalendarIntegration()`, `startCalendarConnect(provider)`, `disconnectCalendar(provider)`, `getCalendarSettings()`, `updateCalendarSettings(body)`.

- [ ] **Step 1: Write the module**

Não tem teste próprio: é uma casca fina de `apiFetch`, exercitada pelos testes de componente das Tasks 12 e 13 (mesmo tratamento de `lib/development-thursday-api.ts`).

```ts
// apps/web/src/lib/calendar-api.ts
import type {
  CalendarIntegrationStateDTO,
  CalendarProviderKey,
  CalendarSettingsDTO,
  UpdateCalendarSettingsRequest,
} from '@legends/shared'
import { apiFetch } from './api'

export function getCalendarIntegration() {
  return apiFetch<CalendarIntegrationStateDTO>('/calendar/connections')
}

export function startCalendarConnect(provider: CalendarProviderKey) {
  return apiFetch<{ authorizeUrl: string }>(`/calendar/connect/${provider}`, { method: 'POST' })
}

export function disconnectCalendar(provider: CalendarProviderKey) {
  return apiFetch<void>(`/calendar/connections/${provider}`, { method: 'DELETE' })
}

export function getCalendarSettings() {
  return apiFetch<CalendarSettingsDTO>('/admin/calendar-settings')
}

export function updateCalendarSettings(body: UpdateCalendarSettingsRequest) {
  return apiFetch<CalendarSettingsDTO>('/admin/calendar-settings', {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `apps/web/node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit`
(Chame o binário direto — `npx tsc` é interceptado e não é confiável neste ambiente.)
Expected: sem erros.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/calendar-api.ts
git commit -m "feat(web): cliente HTTP de integração de calendário"
```

---

### Task 12: Seção "Integrações" no perfil

**Files:**
- Create: `apps/web/src/pages/profile/CalendarIntegrationCard.tsx`
- Create: `apps/web/src/pages/profile/CalendarIntegrationCard.test.tsx`
- Modify: `apps/web/src/pages/ProfilePage.tsx` (renderiza no próprio perfil)

**Interfaces:**
- Consumes: Task 11.
- Produces: `<CalendarIntegrationCard />`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/pages/profile/CalendarIntegrationCard.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CalendarIntegrationStateDTO } from '@legends/shared'
import { CalendarIntegrationCard } from './CalendarIntegrationCard'

const getCalendarIntegration = vi.fn()
const startCalendarConnect = vi.fn()
const disconnectCalendar = vi.fn()

vi.mock('../../lib/calendar-api', () => ({
  getCalendarIntegration: () => getCalendarIntegration(),
  startCalendarConnect: (p: string) => startCalendarConnect(p),
  disconnectCalendar: (p: string) => disconnectCalendar(p),
}))

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CalendarIntegrationCard />
    </QueryClientProvider>,
  )
}

const state = (over: Partial<CalendarIntegrationStateDTO> = {}): CalendarIntegrationStateDTO => ({
  connections: [],
  available: [],
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  startCalendarConnect.mockResolvedValue({ authorizeUrl: 'https://accounts.google.com/authorize' })
  disconnectCalendar.mockResolvedValue(undefined)
})

describe('CalendarIntegrationCard', () => {
  it('avisa quando a empresa não configurou nenhum provedor', async () => {
    getCalendarIntegration.mockResolvedValue(state())
    renderCard()
    expect(await screen.findByText(/administrador ainda não configurou/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /conectar/i })).not.toBeInTheDocument()
  })

  it('oferece conectar no provedor disponível e navega para a authorizeUrl', async () => {
    getCalendarIntegration.mockResolvedValue(state({ available: ['google'] }))
    const assign = vi.fn()
    Object.defineProperty(window, 'location', { value: { assign, href: '' }, writable: true })

    renderCard()
    await userEvent.click(await screen.findByRole('button', { name: /conectar google calendar/i }))

    await waitFor(() => expect(startCalendarConnect).toHaveBeenCalledWith('google'))
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://accounts.google.com/authorize'))
  })

  it('mostra a conta conectada e permite desconectar', async () => {
    getCalendarIntegration.mockResolvedValue(
      state({
        available: ['google'],
        connections: [
          { provider: 'google', accountEmail: 'ana@empresa.com', status: 'active', publishEnabled: true, lastSyncAt: null },
        ],
      }),
    )
    renderCard()
    expect(await screen.findByText('ana@empresa.com')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /desconectar google calendar/i }))
    await waitFor(() => expect(disconnectCalendar).toHaveBeenCalledWith('google'))
  })

  it('pede reconexão quando o acesso expirou', async () => {
    getCalendarIntegration.mockResolvedValue(
      state({
        available: ['google'],
        connections: [
          {
            provider: 'google',
            accountEmail: 'ana@empresa.com',
            status: 'needs_reauth',
            publishEnabled: true,
            lastSyncAt: null,
          },
        ],
      }),
    )
    renderCard()
    expect(await screen.findByText(/acesso expirou/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reconectar google calendar/i })).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/web exec vitest run src/pages/profile/CalendarIntegrationCard.test.tsx`
Expected: FAIL — componente não existe.

- [ ] **Step 3: Write the component**

```tsx
// apps/web/src/pages/profile/CalendarIntegrationCard.tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CALENDAR_PROVIDERS,
  CALENDAR_PROVIDER_LABELS,
  type CalendarProviderKey,
} from '@legends/shared'
import { Icon } from '../../components/Icon'
import {
  disconnectCalendar,
  getCalendarIntegration,
  startCalendarConnect,
} from '../../lib/calendar-api'

const QUERY_KEY = ['me', 'calendar-integration']

/**
 * Conectar/desconectar a própria agenda. Renderizado só no próprio perfil —
 * é configuração pessoal, não informação de perfil público.
 */
export function CalendarIntegrationCard() {
  const qc = useQueryClient()
  const integration = useQuery({ queryKey: QUERY_KEY, queryFn: getCalendarIntegration })

  const connect = useMutation({
    mutationFn: (provider: CalendarProviderKey) => startCalendarConnect(provider),
    onSuccess: ({ authorizeUrl }) => window.location.assign(authorizeUrl),
  })

  const disconnect = useMutation({
    mutationFn: (provider: CalendarProviderKey) => disconnectCalendar(provider),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  })

  const available = integration.data?.available ?? []
  const connections = integration.data?.connections ?? []

  return (
    <section className="rounded-lg border border-primary-container/20 bg-surface p-lg">
      <h2 className="mb-md font-label text-title-sm text-on-surface">Integrações de calendário</h2>

      {integration.isLoading && <p className="text-body-sm text-on-surface-variant">Carregando…</p>}

      {!integration.isLoading && available.length === 0 && (
        <p className="text-body-sm text-on-surface-variant">
          Seu administrador ainda não configurou nenhum calendário para a empresa.
        </p>
      )}

      <ul className="flex flex-col gap-md">
        {CALENDAR_PROVIDERS.filter((provider) => available.includes(provider)).map((provider) => {
          const label = CALENDAR_PROVIDER_LABELS[provider]
          const connection = connections.find((item) => item.provider === provider)
          const needsReauth = connection?.status === 'needs_reauth'
          const busy = connect.isPending || disconnect.isPending

          return (
            <li key={provider} className="flex items-center justify-between gap-md">
              <div className="flex flex-col">
                <span className="font-label text-label-md text-on-surface">{label}</span>
                {connection && !needsReauth && (
                  <span className="text-body-sm text-on-surface-variant">{connection.accountEmail}</span>
                )}
                {needsReauth && (
                  <span className="flex items-center gap-1 text-body-sm text-error">
                    <Icon name="error" className="text-[16px]" />O acesso expirou. Reconecte sua conta.
                  </span>
                )}
              </div>

              {connection && !needsReauth ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => disconnect.mutate(provider)}
                  aria-label={`Desconectar ${label}`}
                  className="rounded-md border border-primary-container/40 px-md py-sm font-label text-label-sm text-on-surface hover:bg-primary-container/10 disabled:opacity-50"
                >
                  Desconectar
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => connect.mutate(provider)}
                  aria-label={`${needsReauth ? 'Reconectar' : 'Conectar'} ${label}`}
                  className="rounded-md bg-primary px-md py-sm font-label text-label-sm font-bold text-on-primary hover:bg-primary-container disabled:opacity-50"
                >
                  {needsReauth ? 'Reconectar' : 'Conectar'}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
```

- [ ] **Step 4: Render it in `ProfilePage.tsx`**

`ProfilePage.tsx` já tem `isOwnProfile` (linha ~87) e o padrão `{isOwnProfile && <MoodOfDay />}` (linha ~291). Acrescente o import junto dos outros de `./profile/`:

```tsx
import { CalendarIntegrationCard } from "./profile/CalendarIntegrationCard";
```

E logo depois da linha `{isOwnProfile && <MoodOfDay />}`:

```tsx
          {isOwnProfile && <CalendarIntegrationCard />}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @legends/web exec vitest run src/pages/profile/CalendarIntegrationCard.test.tsx`
Expected: PASS (4 testes).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/profile/CalendarIntegrationCard.tsx apps/web/src/pages/profile/CalendarIntegrationCard.test.tsx apps/web/src/pages/ProfilePage.tsx
git commit -m "feat(web): seção de integrações de calendário no perfil"
```

---

### Task 13: Seção de credenciais no admin

**Files:**
- Create: `apps/web/src/pages/admin/CalendarSection.tsx`
- Create: `apps/web/src/pages/admin/CalendarSection.test.tsx`
- Modify: `apps/web/src/App.tsx` (rota `/admin/calendario`)
- Modify: `apps/web/src/pages/admin/AdminSidebar.tsx` (item no grupo "Sistema")

**Interfaces:**
- Consumes: Task 11.
- Produces: `<CalendarSection />` na rota `/admin/calendario`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/pages/admin/CalendarSection.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CalendarSettingsDTO } from '@legends/shared'
import { CalendarSection } from './CalendarSection'

const getCalendarSettings = vi.fn()
const updateCalendarSettings = vi.fn()

vi.mock('../../lib/calendar-api', () => ({
  getCalendarSettings: () => getCalendarSettings(),
  updateCalendarSettings: (body: unknown) => updateCalendarSettings(body),
}))

const settings = (over: Partial<CalendarSettingsDTO> = {}): CalendarSettingsDTO => ({
  google: { configured: false, clientId: null, redirectUri: 'https://app/api/calendar/callback/google' },
  microsoft: {
    configured: false,
    clientId: null,
    tenantId: null,
    redirectUri: 'https://app/api/calendar/callback/microsoft',
  },
  ...over,
})

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CalendarSection />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  updateCalendarSettings.mockImplementation(async () => settings({ google: { configured: true, clientId: 'cid', redirectUri: 'https://app/api/calendar/callback/google' } }))
})

describe('CalendarSection', () => {
  it('mostra os redirect URIs que o admin precisa registrar', async () => {
    getCalendarSettings.mockResolvedValue(settings())
    renderSection()
    expect(await screen.findByText('https://app/api/calendar/callback/google')).toBeInTheDocument()
    expect(screen.getByText('https://app/api/calendar/callback/microsoft')).toBeInTheDocument()
  })

  it('envia client id e secret do Google', async () => {
    getCalendarSettings.mockResolvedValue(settings())
    renderSection()
    await userEvent.type(await screen.findByLabelText(/client id do google/i), 'cid')
    await userEvent.type(screen.getByLabelText(/client secret do google/i), 'csecret')
    await userEvent.click(screen.getByRole('button', { name: /salvar google calendar/i }))

    await waitFor(() =>
      expect(updateCalendarSettings).toHaveBeenCalledWith({ google: { clientId: 'cid', clientSecret: 'csecret' } }),
    )
  })

  it('com secret já configurado, salvar sem digitar não envia clientSecret', async () => {
    getCalendarSettings.mockResolvedValue(
      settings({ google: { configured: true, clientId: 'cid', redirectUri: 'https://app/api/calendar/callback/google' } }),
    )
    renderSection()
    await screen.findByDisplayValue('cid')
    expect(screen.getByLabelText(/client secret do google/i)).toHaveAttribute('placeholder', 'configurado')

    await userEvent.click(screen.getByRole('button', { name: /salvar google calendar/i }))
    await waitFor(() => expect(updateCalendarSettings).toHaveBeenCalledWith({ google: { clientId: 'cid' } }))
  })

  it('envia tenant id junto das credenciais da Microsoft', async () => {
    getCalendarSettings.mockResolvedValue(settings())
    renderSection()
    await userEvent.type(await screen.findByLabelText(/client id da microsoft/i), 'mid')
    await userEvent.type(screen.getByLabelText(/client secret da microsoft/i), 'msecret')
    await userEvent.type(screen.getByLabelText(/tenant id/i), 'tenant-1')
    await userEvent.click(screen.getByRole('button', { name: /salvar microsoft 365/i }))

    await waitFor(() =>
      expect(updateCalendarSettings).toHaveBeenCalledWith({
        microsoft: { clientId: 'mid', clientSecret: 'msecret', tenantId: 'tenant-1' },
      }),
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @legends/web exec vitest run src/pages/admin/CalendarSection.test.tsx`
Expected: FAIL — componente não existe.

- [ ] **Step 3: Write the component**

```tsx
// apps/web/src/pages/admin/CalendarSection.tsx
import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UpdateCalendarSettingsRequest } from '@legends/shared'
import { ApiError } from '../../lib/api'
import { getCalendarSettings, updateCalendarSettings } from '../../lib/calendar-api'
import { Icon } from '../../components/Icon'
import { Panel, inputCls } from './shared'

const QUERY_KEY = ['admin', 'calendar-settings']

/**
 * Credenciais OAuth por empresa (BYO app). O secret nunca volta da API: campo
 * vazio com placeholder "configurado" significa "mantém o atual" — só enviamos
 * `clientSecret` quando o admin digita um valor novo.
 */
export function CalendarSection() {
  const qc = useQueryClient()
  const settings = useQuery({ queryKey: QUERY_KEY, queryFn: getCalendarSettings })
  const [message, setMessage] = useState<string | null>(null)

  const [googleClientId, setGoogleClientId] = useState('')
  const [googleSecret, setGoogleSecret] = useState('')
  const [msClientId, setMsClientId] = useState('')
  const [msSecret, setMsSecret] = useState('')
  const [msTenantId, setMsTenantId] = useState('')

  useEffect(() => {
    if (!settings.data) return
    setGoogleClientId(settings.data.google.clientId ?? '')
    setMsClientId(settings.data.microsoft.clientId ?? '')
    setMsTenantId(settings.data.microsoft.tenantId ?? '')
  }, [settings.data])

  const save = useMutation({
    mutationFn: (body: UpdateCalendarSettingsRequest) => updateCalendarSettings(body),
    onSuccess: () => {
      setMessage('Configuração salva.')
      setGoogleSecret('')
      setMsSecret('')
      qc.invalidateQueries({ queryKey: QUERY_KEY })
    },
    onError: (err) => setMessage(err instanceof ApiError ? err.message : 'Erro ao salvar configuração.'),
  })

  function submitGoogle(event: FormEvent) {
    event.preventDefault()
    const patch: NonNullable<UpdateCalendarSettingsRequest['google']> = { clientId: googleClientId.trim() }
    if (googleSecret) patch.clientSecret = googleSecret
    save.mutate({ google: patch })
  }

  function submitMicrosoft(event: FormEvent) {
    event.preventDefault()
    const patch: NonNullable<UpdateCalendarSettingsRequest['microsoft']> = {
      clientId: msClientId.trim(),
      tenantId: msTenantId.trim(),
    }
    if (msSecret) patch.clientSecret = msSecret
    save.mutate({ microsoft: patch })
  }

  const secretPlaceholder = (configured: boolean) => (configured ? 'configurado' : 'cole o client secret')

  return (
    <div className="flex flex-col gap-lg">
      <Panel title="Google Calendar">
        <form onSubmit={submitGoogle} className="flex flex-col gap-md">
          <p className="text-body-sm text-on-surface-variant">
            Registre este redirect URI no seu app do Google Cloud:{' '}
            <code className="font-mono text-body-sm">{settings.data?.google.redirectUri}</code>
          </p>
          <label className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Client ID</span>
            <input
              value={googleClientId}
              onChange={(event) => setGoogleClientId(event.target.value)}
              aria-label="Client ID do Google Calendar"
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Client Secret</span>
            <input
              type="password"
              value={googleSecret}
              onChange={(event) => setGoogleSecret(event.target.value)}
              aria-label="Client Secret do Google Calendar"
              placeholder={secretPlaceholder(settings.data?.google.configured ?? false)}
              className={inputCls}
            />
          </label>
          <button
            type="submit"
            disabled={save.isPending}
            aria-label="Salvar Google Calendar"
            className="inline-flex w-fit items-center gap-sm rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container disabled:opacity-50"
          >
            <Icon name="save" className="text-[18px]" />
            Salvar
          </button>
        </form>
      </Panel>

      <Panel title="Microsoft 365">
        <form onSubmit={submitMicrosoft} className="flex flex-col gap-md">
          <p className="text-body-sm text-on-surface-variant">
            Registre este redirect URI no seu app do Entra ID:{' '}
            <code className="font-mono text-body-sm">{settings.data?.microsoft.redirectUri}</code>
          </p>
          <label className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Client ID</span>
            <input
              value={msClientId}
              onChange={(event) => setMsClientId(event.target.value)}
              aria-label="Client ID da Microsoft"
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Client Secret</span>
            <input
              type="password"
              value={msSecret}
              onChange={(event) => setMsSecret(event.target.value)}
              aria-label="Client Secret da Microsoft"
              placeholder={secretPlaceholder(settings.data?.microsoft.configured ?? false)}
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Tenant ID</span>
            <input
              value={msTenantId}
              onChange={(event) => setMsTenantId(event.target.value)}
              aria-label="Tenant ID"
              className={inputCls}
            />
          </label>
          <button
            type="submit"
            disabled={save.isPending}
            aria-label="Salvar Microsoft 365"
            className="inline-flex w-fit items-center gap-sm rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container disabled:opacity-50"
          >
            <Icon name="save" className="text-[18px]" />
            Salvar
          </button>
        </form>
      </Panel>

      {message && (
        <p role="status" className="flex items-center gap-sm text-body-sm text-on-surface-variant">
          <Icon name={message.includes('Erro') ? 'error' : 'check_circle'} className="text-[18px] text-primary" />
          {message}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Wire the route and the sidebar item**

Em `apps/web/src/App.tsx`, import junto dos outros de `./pages/admin/`:

```tsx
import { CalendarSection } from './pages/admin/CalendarSection'
```

E a rota, junto das outras rotas de admin (perto de `<Route path="quinta-dev" …>`):

```tsx
                    <Route path="calendario" element={<CalendarSection />} />
```

Em `apps/web/src/pages/admin/AdminSidebar.tsx`, no grupo `'Sistema'`, junto de `{ to: '/admin/auditoria', … }`:

```tsx
        { to: '/admin/calendario', label: 'Calendário', adminOnly: true },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @legends/web exec vitest run src/pages/admin/CalendarSection.test.tsx`
Expected: PASS (4 testes).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/admin/CalendarSection.tsx apps/web/src/pages/admin/CalendarSection.test.tsx apps/web/src/App.tsx apps/web/src/pages/admin/AdminSidebar.tsx
git commit -m "feat(web): seção admin de credenciais de calendário"
```

---

### Task 14: Verificação final

**Files:** nenhum novo.

- [ ] **Step 1: Typecheck dos três workspaces**

```bash
apps/api/node_modules/.bin/tsc -p apps/api/tsconfig.json --noEmit
apps/web/node_modules/.bin/tsc -p apps/web/tsconfig.json --noEmit
packages/shared/node_modules/.bin/tsc -p packages/shared/tsconfig.json --noEmit
```

Expected: sem erros. (Binário direto, não `npx tsc`.)

- [ ] **Step 2: Suíte completa**

```bash
pnpm db:up && pnpm test
```

Expected: PASS. Se algo alheio à integração falhar, confira se já falhava antes na `origin/main` antes de tentar consertar.

- [ ] **Step 3: Confirmar que nenhum segredo escapa**

```bash
grep -rn "accessTokenEnc\|refreshTokenEnc" apps/api/src --include="*.ts" | grep -v "\.test\.ts" | grep -v "crypto\|calendar-connection-service\|serialize"
```

Expected: nenhuma linha. (Token cifrado só é tocado pelo service de conexão e pelo módulo de cifra.)

```bash
grep -rn "clientSecret" apps/api/src/lib/serialize.ts apps/api/src/routes/ --include="*.ts" | grep -v "\.test\.ts"
```

Expected: nenhuma linha — o secret nunca aparece em rota nem em DTO.

- [ ] **Step 4: Smoke manual (opcional, precisa de credenciais reais)**

Use o skill `verify` para subir web+api. Com um app de teste do Google configurado em `/admin/calendario`, o fluxo esperado é: perfil → "Conectar Google Calendar" → consentimento → volta em `/perfil/<id>?calendario=ok` → o card mostra o e-mail da conta.

- [ ] **Step 5: Commit final (só se algo mudou)**

```bash
git status --short
```

---

## Notas de fechamento

- **Fases seguintes:** `2026-07-29-calendario-leitura-design.md` (presença "em reunião", painel, aviso) e `2026-07-29-calendario-publicacao-design.md` (publicar eventos do Legends). Ambas consomem `getValidAccessToken` e `adapterFor` desta fase, e acrescentam métodos à `CalendarProviderAdapter`.
- **Nada de produto muda para quem não conecta.** Ao fim desta fase o Legends só sabe conectar e desconectar; nenhum evento é lido ou escrito.

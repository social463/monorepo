# Nudge "Ofensiva em risco" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lembrar automaticamente quem está prestes a perder a ofensiva de humor, via sino in-app e DM no Teams (Power Automate), disparado por um scheduler in-process.

**Architecture:** Um scheduler in-process (`setInterval` 1h, sobe em `server.ts`) chama `runNudgeTick(now)`. Em dia útil às 16h (hora São Paulo), o tick varre usuários ativos, identifica quem tem ofensiva ativa sem humor hoje, cria uma notificação in-app `STREAK_AT_RISK` (chave de idempotência: 1/dia) e, se o usuário tiver `teamsWebhookUrl`, dispara um POST best-effort para o fluxo Power Automate dele. `runNudgeTick` recebe o `now` injetado para ser testável sem timers.

**Tech Stack:** Fastify 4, Prisma 5, PostgreSQL, TypeScript ESM, Vitest (Postgres real), React 18 + React Query (admin UI).

## Global Constraints

- TypeScript **strict**, ESM puro; siga o padrão da camada vizinha (rota fina, lógica em service/lib, DTO em `serialize.ts`, contrato em `@legends/shared`).
- Mensagens voltadas ao usuário em **português** (pt-BR).
- **Nunca editar migration já aplicada** — gerar nova com `pnpm db:migrate`.
- Contrato muda **primeiro** em `@legends/shared`, depois os dois lados.
- Segredos (`teamsWebhookUrl`) **nunca** em DTO público nem commitados; `toPublicUser` é allowlist — não adicionar lá.
- Testes da API rodam contra **Postgres real**: subir com `pnpm db:up` antes de `pnpm test`. `beforeEach` trunca as tabelas.
- **Build ≠ typecheck:** rodar `pnpm --filter @legends/api exec tsc --noEmit` (e o do shared) ao mudar DTOs.
- Janela do nudge: **hora São Paulo == 16** e **dia útil**. Público-alvo: `currentStreak >= 1 && !registeredToday`.
- Link da notificação: `/perfil/${userId}` (onde mora o `MoodOfDay`).

---

### Task 1: Schema — enum `STREAK_AT_RISK` + coluna `User.teamsWebhookUrl`

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: nova migration (gerada por `pnpm db:migrate`)

**Interfaces:**
- Produces: enum value `NotificationType.STREAK_AT_RISK`; campo `User.teamsWebhookUrl: string | null` no Prisma Client.

- [ ] **Step 1: Adicionar o valor ao enum**

Em `apps/api/prisma/schema.prisma`, no `enum NotificationType`, adicionar a última linha:

```prisma
enum NotificationType {
  FEEDBACK_RECEIVED
  FEEDBACK_REACTION
  BADGE_EARNED
  HIGHLIGHT_PUBLISHED
  PERIOD_OPENED
  PERIOD_CLOSED
  RETRO_INVITED
  STREAK_AT_RISK
}
```

- [ ] **Step 2: Adicionar a coluna ao model User**

No `model User`, logo após a linha `avatarOptions Json?` (antes de `role`), adicionar:

```prisma
  teamsWebhookUrl String?
```

- [ ] **Step 3: Gerar a migration**

Run: `pnpm db:up` (garante Postgres) e depois `pnpm db:migrate`
Quando pedir o nome da migration, usar: `nudge_ofensiva_streak_at_risk`
Expected: cria `apps/api/prisma/migrations/<timestamp>_nudge_ofensiva_streak_at_risk/migration.sql` e regenera o client.

- [ ] **Step 4: Verificar o typecheck do client**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: PASS (sem erros; o tipo `User` agora tem `teamsWebhookUrl`).

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations
git commit -m "feat(db): NotificationType.STREAK_AT_RISK e User.teamsWebhookUrl"
```

---

### Task 2: Contrato compartilhado — `NOTIFICATION_TYPES` + `AdminUserDTO`

**Files:**
- Modify: `packages/shared/src/notification.ts`
- Modify: `packages/shared/src/auth.ts`

**Interfaces:**
- Consumes: `PublicUser` (já existe em `auth.ts`).
- Produces: `'STREAK_AT_RISK'` no union `NotificationType`; `AdminUserDTO = PublicUser & { teamsWebhookUrl: string | null }`.

- [ ] **Step 1: Adicionar o tipo de notificação**

Em `packages/shared/src/notification.ts`, no array `NOTIFICATION_TYPES`, adicionar a entrada final:

```ts
export const NOTIFICATION_TYPES = [
  'FEEDBACK_RECEIVED',
  'FEEDBACK_REACTION',
  'BADGE_EARNED',
  'HIGHLIGHT_PUBLISHED',
  'PERIOD_OPENED',
  'PERIOD_CLOSED',
  'RETRO_INVITED',
  'STREAK_AT_RISK',
] as const
```

- [ ] **Step 2: Adicionar o DTO admin de usuário**

Ao final de `packages/shared/src/auth.ts`, adicionar (logo após a definição de `PublicUser`):

```ts
/** Usuário visto pelo admin: inclui campos sensíveis que NÃO vão em PublicUser. */
export interface AdminUserDTO extends PublicUser {
  teamsWebhookUrl: string | null
}
```

- [ ] **Step 3: Typecheck do shared**

Run: `pnpm --filter @legends/shared exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/notification.ts packages/shared/src/auth.ts
git commit -m "feat(shared): STREAK_AT_RISK e AdminUserDTO"
```

---

### Task 3: Helpers de data SP que aceitam `now` injetado

**Files:**
- Modify: `apps/api/src/lib/sao-paulo-date.ts`
- Create: `apps/api/src/lib/sao-paulo-date.test.ts`

**Interfaces:**
- Produces: `ymdInSaoPaulo(now: Date): string`, `hourInSaoPaulo(now: Date): number`.

- [ ] **Step 1: Escrever os testes (falhando)**

Criar `apps/api/src/lib/sao-paulo-date.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ymdInSaoPaulo, hourInSaoPaulo } from './sao-paulo-date'

describe('helpers SP com now injetado', () => {
  it('ymdInSaoPaulo retorna o dia civil em São Paulo (UTC-3)', () => {
    // 2026-06-25T19:00Z == 16:00 em São Paulo (mesmo dia civil)
    expect(ymdInSaoPaulo(new Date('2026-06-25T19:00:00.000Z'))).toBe('2026-06-25')
    // 2026-06-26T02:00Z == 23:00 do dia 25 em São Paulo
    expect(ymdInSaoPaulo(new Date('2026-06-26T02:00:00.000Z'))).toBe('2026-06-25')
  })

  it('hourInSaoPaulo retorna a hora civil 0–23 em São Paulo', () => {
    expect(hourInSaoPaulo(new Date('2026-06-25T19:00:00.000Z'))).toBe(16)
    expect(hourInSaoPaulo(new Date('2026-06-25T12:00:00.000Z'))).toBe(9)
    expect(hourInSaoPaulo(new Date('2026-06-26T02:00:00.000Z'))).toBe(23)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/lib/sao-paulo-date.test.ts`
Expected: FAIL — `ymdInSaoPaulo`/`hourInSaoPaulo` não existem.

- [ ] **Step 3: Implementar os helpers**

Em `apps/api/src/lib/sao-paulo-date.ts`, adicionar abaixo de `todayInSaoPaulo`:

```ts
/** O dia civil (YYYY-MM-DD) em America/Sao_Paulo para um instante qualquer. */
export function ymdInSaoPaulo(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** A hora civil (0–23) em America/Sao_Paulo para um instante qualquer. */
export function hourInSaoPaulo(now: Date): number {
  const hh = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(now)
  return Number(hh)
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/lib/sao-paulo-date.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/sao-paulo-date.ts apps/api/src/lib/sao-paulo-date.test.ts
git commit -m "feat(api): helpers ymdInSaoPaulo/hourInSaoPaulo com now injetado"
```

---

### Task 4: `teams-client` — POST best-effort para o fluxo Power Automate

**Files:**
- Create: `apps/api/src/lib/teams-client.ts`
- Create: `apps/api/src/lib/teams-client.test.ts`

**Interfaces:**
- Produces:
  - `interface TeamsNudgePayload { kind: 'streak_at_risk'; name: string; streakDays: number; message: string; link: string }`
  - `postTeamsNudge(url: string, payload: TeamsNudgePayload): Promise<void>` — nunca lança; loga e engole erros.

- [ ] **Step 1: Escrever os testes (falhando)**

Criar `apps/api/src/lib/teams-client.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { postTeamsNudge, type TeamsNudgePayload } from './teams-client'

const payload: TeamsNudgePayload = {
  kind: 'streak_at_risk',
  name: 'Fulano',
  streakDays: 7,
  message: 'Não perca sua ofensiva de 7 dias — registre seu humor de hoje 🔥',
  link: '/perfil/abc',
}

afterEach(() => vi.restoreAllMocks())

describe('postTeamsNudge', () => {
  it('faz POST com JSON no corpo', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }))
    await postTeamsNudge('https://flow.example/x', payload)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://flow.example/x')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual(payload)
  })

  it('engole erro de rede sem lançar', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('boom'))
    await expect(postTeamsNudge('https://flow.example/x', payload)).resolves.toBeUndefined()
  })

  it('engole status não-2xx sem lançar', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 500 }))
    await expect(postTeamsNudge('https://flow.example/x', payload)).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/lib/teams-client.test.ts`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar o client**

Criar `apps/api/src/lib/teams-client.ts`:

```ts
export interface TeamsNudgePayload {
  kind: 'streak_at_risk'
  name: string
  streakDays: number
  message: string
  link: string
}

const TIMEOUT_MS = 5000

/**
 * Posta o nudge no fluxo Power Automate da pessoa (a URL já é a DM dela).
 * Best-effort: qualquer falha (rede, timeout, status != 2xx) é logada e
 * engolida — não derruba o tick nem a notificação in-app.
 */
export async function postTeamsNudge(url: string, payload: TeamsNudgePayload): Promise<void> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) {
      console.error(`[teams-client] POST falhou com status ${res.status}`)
    }
  } catch (err) {
    console.error('[teams-client] POST lançou exceção', err)
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/lib/teams-client.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/teams-client.ts apps/api/src/lib/teams-client.test.ts
git commit -m "feat(api): teams-client best-effort para Power Automate"
```

---

### Task 5: `runNudgeTick` — orquestração do nudge de ofensiva

**Files:**
- Create: `apps/api/src/scheduler/nudges.ts`
- Create: `apps/api/src/scheduler/nudges.test.ts`

**Interfaces:**
- Consumes: `getStreakSummary(userId, todayYmd)` de `services/streak-service`; `createNotification(...)` de `services/notification-service`; `postTeamsNudge(url, payload)` de `lib/teams-client`; `ymdInSaoPaulo`, `hourInSaoPaulo`, `isBusinessDay`, `dayFromYmd` de `lib/sao-paulo-date`; `prisma`.
- Produces: `runNudgeTick(now: Date): Promise<void>`.

- [ ] **Step 1: Escrever os testes (falhando)**

Criar `apps/api/src/scheduler/nudges.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { prisma } from '../lib/prisma'
import { runNudgeTick } from './nudges'

// 2026-06-25 (quinta) às 19:00Z == 16:00 SP, dia útil → janela do nudge.
const FIRE = new Date('2026-06-25T19:00:00.000Z')

let counter = 0
async function makeUser(opts: { active?: boolean; teamsWebhookUrl?: string | null } = {}) {
  counter += 1
  return prisma.user.create({
    data: {
      name: `Dev ${counter}`,
      email: `dev-${counter}@empresa.com`,
      passwordHash: 'x',
      active: opts.active ?? true,
      teamsWebhookUrl: opts.teamsWebhookUrl ?? null,
    },
  })
}

/** Cria boosts de humor nos dias úteis informados (YYYY-MM-DD em SP). */
async function giveMood(userId: string, ymds: string[]) {
  for (const ymd of ymds) {
    await prisma.moodEntry.create({
      data: { userId, day: new Date(`${ymd}T00:00:00.000Z`), mood: 'GOOD' },
    })
  }
}

function fetchSpyOk() {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
}

afterEach(() => vi.restoreAllMocks())

describe('runNudgeTick — ofensiva em risco', () => {
  it('notifica in-app e dispara Teams para quem tem streak e não registrou hoje', async () => {
    const fetchSpy = fetchSpyOk()
    const u = await makeUser({ teamsWebhookUrl: 'https://flow.example/u' })
    // boost ontem e anteontem (dias úteis), sem boost hoje (25)
    await giveMood(u.id, ['2026-06-24', '2026-06-23'])

    await runNudgeTick(FIRE)

    const notifs = await prisma.notification.findMany({ where: { userId: u.id } })
    expect(notifs).toHaveLength(1)
    expect(notifs[0].type).toBe('STREAK_AT_RISK')
    expect(notifs[0].link).toBe(`/perfil/${u.id}`)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)
    expect(body.kind).toBe('streak_at_risk')
    expect(body.streakDays).toBe(2)
  })

  it('cria in-app mas NÃO chama Teams quando não há teamsWebhookUrl', async () => {
    const fetchSpy = fetchSpyOk()
    const u = await makeUser({ teamsWebhookUrl: null })
    await giveMood(u.id, ['2026-06-24'])

    await runNudgeTick(FIRE)

    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('é idempotente: segundo tick no mesmo dia não duplica', async () => {
    const fetchSpy = fetchSpyOk()
    const u = await makeUser({ teamsWebhookUrl: 'https://flow.example/u' })
    await giveMood(u.id, ['2026-06-24'])

    await runNudgeTick(FIRE)
    await runNudgeTick(FIRE)

    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('não notifica quem não tem streak (sem boosts)', async () => {
    fetchSpyOk()
    const u = await makeUser()
    await runNudgeTick(FIRE)
    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(0)
  })

  it('não notifica quem já registrou humor hoje', async () => {
    fetchSpyOk()
    const u = await makeUser()
    await giveMood(u.id, ['2026-06-24', '2026-06-25'])
    await runNudgeTick(FIRE)
    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(0)
  })

  it('não notifica usuário inativo', async () => {
    fetchSpyOk()
    const u = await makeUser({ active: false })
    await giveMood(u.id, ['2026-06-24'])
    await runNudgeTick(FIRE)
    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(0)
  })

  it('no-op fora da janela: fim de semana', async () => {
    fetchSpyOk()
    const u = await makeUser({ teamsWebhookUrl: 'https://flow.example/u' })
    await giveMood(u.id, ['2026-06-25', '2026-06-24'])
    // 2026-06-27 é sábado, 19:00Z == 16:00 SP
    await runNudgeTick(new Date('2026-06-27T19:00:00.000Z'))
    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(0)
  })

  it('no-op fora da janela: hora errada (9h SP)', async () => {
    fetchSpyOk()
    const u = await makeUser()
    await giveMood(u.id, ['2026-06-24'])
    // 2026-06-25T12:00Z == 09:00 SP
    await runNudgeTick(new Date('2026-06-25T12:00:00.000Z'))
    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(0)
  })

  it('falha no Teams não impede a notificação in-app', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('boom'))
    const u = await makeUser({ teamsWebhookUrl: 'https://flow.example/u' })
    await giveMood(u.id, ['2026-06-24'])
    await runNudgeTick(FIRE)
    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(1)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm db:up && pnpm --filter @legends/api exec vitest run src/scheduler/nudges.test.ts`
Expected: FAIL — módulo `./nudges` não existe.

- [ ] **Step 3: Implementar `runNudgeTick`**

Criar `apps/api/src/scheduler/nudges.ts`:

```ts
import { prisma } from '../lib/prisma'
import { ymdInSaoPaulo, hourInSaoPaulo, isBusinessDay, dayFromYmd } from '../lib/sao-paulo-date'
import { getStreakSummary } from '../services/streak-service'
import { createNotification } from '../services/notification-service'
import { postTeamsNudge } from '../lib/teams-client'

const FIRE_HOUR_SP = 16

/**
 * Um tick do nudge de "ofensiva em risco". Recebe `now` injetado (testável sem
 * timers). Só age em dia útil às 16h (hora São Paulo). Para cada usuário ativo
 * com ofensiva ativa que ainda não registrou humor hoje, cria uma notificação
 * in-app (idempotente por dia) e, se houver teamsWebhookUrl, dispara o Teams.
 */
export async function runNudgeTick(now: Date): Promise<void> {
  const ymd = ymdInSaoPaulo(now)
  if (!isBusinessDay(ymd) || hourInSaoPaulo(now) !== FIRE_HOUR_SP) return

  // 00:00 UTC do dia civil SP. Como o nudge dispara só às 16h SP (19h UTC), o
  // nudge de ontem cai antes deste corte e o de hoje depois — separação limpa.
  const dayStart = dayFromYmd(ymd)
  const users = await prisma.user.findMany({ where: { active: true } })

  for (const user of users) {
    try {
      const streak = await getStreakSummary(user.id, ymd)
      if (streak.currentStreak < 1 || streak.registeredToday) continue

      const already = await prisma.notification.findFirst({
        where: { userId: user.id, type: 'STREAK_AT_RISK', createdAt: { gte: dayStart } },
      })
      if (already) continue

      const message = `Não perca sua ofensiva de ${streak.currentStreak} dias — registre seu humor de hoje 🔥`
      const link = `/perfil/${user.id}`

      await createNotification({ userId: user.id, type: 'STREAK_AT_RISK', title: message, link })

      if (user.teamsWebhookUrl) {
        await postTeamsNudge(user.teamsWebhookUrl, {
          kind: 'streak_at_risk',
          name: user.name,
          streakDays: streak.currentStreak,
          message,
          link,
        })
      }
    } catch (err) {
      console.error(`[nudges] falha ao processar usuário ${user.id}`, err)
    }
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/scheduler/nudges.test.ts`
Expected: PASS (9 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/scheduler/nudges.ts apps/api/src/scheduler/nudges.test.ts
git commit -m "feat(api): runNudgeTick para ofensiva em risco (in-app + Teams)"
```

---

### Task 6: `startNudgeScheduler` + boot em `server.ts`

**Files:**
- Modify: `apps/api/src/scheduler/nudges.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**
- Consumes: `runNudgeTick(now)`.
- Produces: `startNudgeScheduler(): void` — `setInterval` 1h; no-op em `NODE_ENV === 'test'`.

- [ ] **Step 1: Implementar `startNudgeScheduler`**

Ao final de `apps/api/src/scheduler/nudges.ts`, adicionar:

```ts
const ONE_HOUR_MS = 60 * 60 * 1000

/**
 * Sobe o scheduler in-process (1 tick/hora). Não inicia em testes (que usam só
 * buildApp). O tick é idempotente, então timing exato e restart não duplicam.
 */
export function startNudgeScheduler(): void {
  if (process.env.NODE_ENV === 'test') return
  setInterval(() => {
    runNudgeTick(new Date()).catch((err) => console.error('[nudges] tick falhou', err))
  }, ONE_HOUR_MS)
}
```

- [ ] **Step 2: Plugar no boot do server**

Em `apps/api/src/server.ts`, importar e chamar após o `listen` resolver:

```ts
import { buildApp } from './app'
import { startNudgeScheduler } from './scheduler/nudges'

const app = buildApp()
const port = Number(process.env.PORT ?? 3333)

app
  .listen({ port, host: '0.0.0.0' })
  .then(() => {
    console.log(`API ouvindo em http://localhost:${port}`)
    startNudgeScheduler()
  })
  .catch((err) => {
    app.log.error(err)
    process.exit(1)
  })
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Garantir que a suíte segue verde (scheduler não sobe em teste)**

Run: `pnpm --filter @legends/api exec vitest run src/scheduler/nudges.test.ts`
Expected: PASS (sem timers pendurados; `startNudgeScheduler` não é chamado nos testes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/scheduler/nudges.ts apps/api/src/server.ts
git commit -m "feat(api): scheduler in-process dispara nudges no boot"
```

---

### Task 7: Admin backend — Zod, persistência e DTO admin

**Files:**
- Modify: `apps/api/src/lib/serialize.ts`
- Modify: `apps/api/src/routes/admin.ts`
- Modify: `apps/api/src/routes/admin.test.ts`

**Interfaces:**
- Consumes: `AdminUserDTO` de `@legends/shared`; `toPublicUser`.
- Produces: `toAdminUser(user): AdminUserDTO`; `/admin/users` (GET/POST/PATCH) passam a expor e aceitar `teamsWebhookUrl`.

- [ ] **Step 1: Escrever o teste de rota (falhando)**

Em `apps/api/src/routes/admin.test.ts`, adicionar um teste dentro do `describe('admin routes', ...)`, usando o helper `adminToken(app)` já definido no topo do arquivo e o padrão `buildApp()` + `app.ready()` + `app.close()`:

```ts
it('admin cria e edita teamsWebhookUrl e ele aparece no DTO admin', async () => {
  const app = buildApp()
  await app.ready()
  const token = await adminToken(app)

  const created = await app.inject({
    method: 'POST',
    url: '/admin/users',
    headers: { authorization: `Bearer ${token}` },
    payload: {
      name: 'Karina',
      email: 'karina@empresa.com',
      password: 'senha1234',
      teamsWebhookUrl: 'https://flow.example/karina',
    },
  })
  expect(created.statusCode).toBe(201)
  expect(created.json().user.teamsWebhookUrl).toBe('https://flow.example/karina')

  const id = created.json().user.id
  const patched = await app.inject({
    method: 'PATCH',
    url: `/admin/users/${id}`,
    headers: { authorization: `Bearer ${token}` },
    payload: { teamsWebhookUrl: '' },
  })
  expect(patched.statusCode).toBe(200)
  expect(patched.json().user.teamsWebhookUrl).toBeNull()

  await app.close()
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts -t teamsWebhookUrl`
Expected: FAIL — `teamsWebhookUrl` não retornado (e/ou não persistido).

- [ ] **Step 3: Adicionar `toAdminUser` ao serialize**

Em `apps/api/src/lib/serialize.ts`, logo após `toPublicUser`, adicionar (e importar `AdminUserDTO` do `@legends/shared` no topo do arquivo, junto dos demais imports de tipos):

```ts
export function toAdminUser(user: User): AdminUserDTO {
  return { ...toPublicUser(user), teamsWebhookUrl: user.teamsWebhookUrl }
}
```

- [ ] **Step 4: Estender o Zod e os handlers no admin**

Em `apps/api/src/routes/admin.ts`:

1. No import de serialize (linha ~10), trocar para incluir `toAdminUser`:

```ts
import { toAdminUser, toAwardedBadgeDTO, toBadgeDTO, toCategoryDTO, toPeriodDTO, toPublicUser, toVoteDTO, toHighlightDTO, toSquadWithMembersDTO } from '../lib/serialize'
```

2. Definir um schema reutilizável (perto de `createUserSchema`):

```ts
// URL do fluxo Power Automate (DM no Teams). String vazia é normalizada para null no handler.
const teamsWebhookUrlSchema = z.union([z.string().url(), z.literal('')]).nullable().optional()
```

3. Adicionar `teamsWebhookUrl: teamsWebhookUrlSchema` em `createUserSchema` **e** em `updateUserSchema`.

4. No `GET /admin/users`, trocar `users.map(toPublicUser)` por `users.map(toAdminUser)`.

5. No `POST /admin/users`, adicionar ao objeto `data` e retornar com `toAdminUser`:

```ts
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
        },
      })
      return reply.code(201).send({ user: toAdminUser(user) })
```

6. No `PATCH /admin/users/:id`, normalizar `''` → `null` e retornar com `toAdminUser`:

```ts
    const { password, ...rest } = parsed.data
    if (rest.teamsWebhookUrl === '') rest.teamsWebhookUrl = null
    const data = password ? { ...rest, passwordHash: await hashPassword(password) } : rest
    try {
      const user = await prisma.user.update({ where: { id }, data })
      return reply.send({ user: toAdminUser(user) })
```

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts -t teamsWebhookUrl`
Expected: PASS.

- [ ] **Step 6: Typecheck + suíte da API**

Run: `pnpm --filter @legends/api exec tsc --noEmit && pnpm --filter @legends/api exec vitest run src/routes/admin.test.ts`
Expected: PASS (sem regressões no bloco admin).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/serialize.ts apps/api/src/routes/admin.ts apps/api/src/routes/admin.test.ts
git commit -m "feat(api): admin gerencia teamsWebhookUrl via AdminUserDTO"
```

---

### Task 8: Admin frontend — campo "URL do fluxo Teams"

**Files:**
- Modify: `apps/web/src/pages/admin/CollaboratorsSection.tsx`

**Interfaces:**
- Consumes: `AdminUserDTO` de `@legends/shared`; endpoints `/admin/users` (já retornam/aceitam `teamsWebhookUrl`).

- [ ] **Step 1: Trocar o tipo de `PublicUser` para `AdminUserDTO`**

Em `apps/web/src/pages/admin/CollaboratorsSection.tsx`:

1. No import de tipos (linha 3), trocar `PublicUser` por `AdminUserDTO`:

```ts
import type { AdminUserDTO, UserRole, Area } from '@legends/shared'
```

2. Substituir as 3 ocorrências de `PublicUser` por `AdminUserDTO`:
   - `member: PublicUser` (props de `CollaboratorRow`)
   - `useQuery<{ users: PublicUser[] }>` → `AdminUserDTO[]`
   - `apiFetch<{ user: PublicUser }>` (create e update) → `AdminUserDTO`

- [ ] **Step 2: Adicionar estado e campo na linha de edição (`CollaboratorRow`)**

Na assinatura de `onSave`, adicionar `teamsWebhookUrl: string | null` ao objeto `data`. Adicionar o estado:

```ts
  const [teamsWebhookUrl, setTeamsWebhookUrl] = useState(member.teamsWebhookUrl ?? '')
```

Incluir no `onSave` dentro de `handleSave`:

```ts
      teamsWebhookUrl: teamsWebhookUrl.trim() || null,
```

E adicionar o input no grid de edição (após o input de senha, antes do bloco "Na equipe desde"):

```tsx
          <input
            className={inputCls}
            value={teamsWebhookUrl}
            onChange={(e) => setTeamsWebhookUrl(e.target.value)}
            aria-label="URL do fluxo Teams"
            placeholder="URL do fluxo Teams (Power Automate)"
            type="url"
          />
```

- [ ] **Step 3: Adicionar o campo no formulário de criação (`CollaboratorsSection`)**

No `emptyDev`, adicionar `teamsWebhookUrl: ''`. No `handleCreateDev`, incluir no `payload`:

```ts
      teamsWebhookUrl: devForm.teamsWebhookUrl.trim() || null,
```

E adicionar o input no grid do form de criação (após o input de senha provisória):

```tsx
          <input
            className={inputCls}
            value={devForm.teamsWebhookUrl}
            onChange={(e) => setDevForm({ ...devForm, teamsWebhookUrl: e.target.value })}
            aria-label="URL do fluxo Teams"
            placeholder="URL do fluxo Teams (opcional)"
            type="url"
          />
```

- [ ] **Step 4: Atualizar a assinatura de `onSave`**

No tipo das props de `CollaboratorRow`, estender o objeto `data` de `onSave`:

```ts
  onSave: (
    id: string,
    data: { name: string; email: string; position: string; squad: string; joinedAt: string; role: UserRole; area: Area | null; password?: string; teamsWebhookUrl: string | null },
  ) => void
```

- [ ] **Step 5: Typecheck do web**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Rodar testes do web (regressão do AdminPage)**

Run: `pnpm --filter @legends/web exec vitest run src/pages/AdminPage.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/pages/admin/CollaboratorsSection.tsx
git commit -m "feat(web): admin edita URL do fluxo Teams da lenda"
```

---

### Task 9: Verificação final

**Files:** nenhum (gate de verificação).

- [ ] **Step 1: Subir Postgres e rodar toda a suíte**

Run: `pnpm db:up && pnpm test`
Expected: PASS em todos os workspaces.

- [ ] **Step 2: Typecheck dos três workspaces**

Run: `pnpm --filter @legends/shared exec tsc --noEmit && pnpm --filter @legends/api exec tsc --noEmit && pnpm --filter @legends/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Build geral**

Run: `pnpm build`
Expected: PASS.

---

## Self-Review (cobertura do spec)

- **Scheduler in-process + boot em server.ts + no-op em teste** → Tasks 5 e 6. ✅
- **Janela 16h / dia útil, público `currentStreak >= 1 && !registeredToday`** → Task 5 (`runNudgeTick` + testes de janela/streak). ✅
- **In-app via createNotification (tipo STREAK_AT_RISK), link `/perfil/:id`** → Tasks 1, 2, 5. ✅
- **Teams via Power Automate, best-effort, payload sem destinatário** → Task 4 (`teams-client`) + Task 5 (disparo). ✅
- **Coluna `User.teamsWebhookUrl`, admin edita, fora de DTO público** → Tasks 1, 2, 7, 8 (`toAdminUser`/`AdminUserDTO`, `toPublicUser` intacto). ✅
- **Idempotência 1/dia (chave = notificação in-app do dia)** → Task 5 (dedup + teste). ✅
- **Helpers de data com `now` injetado** → Task 3. ✅
- **Testes: dispara / sem URL / idempotência / sem streak / já registrou / fim de semana / hora errada / Teams falha** → Task 5 (9 testes) + Task 4 (3 testes). ✅

**Segurança:** mascarar a URL na UI admin ficou **fora da v1** (o spec marcou como opcional). O campo exibe a URL em texto; revisar em iteração futura se necessário.

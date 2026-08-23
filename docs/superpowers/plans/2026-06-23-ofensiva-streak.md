# Ofensiva (streak de boosts) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar uma "Ofensiva" (streak) derivada do registro diário de Humor do Dia: 🔥 no header com o streak atual + painel com calendário do mês e cards (streak atual, melhor streak, boosts no mês).

**Architecture:** Tudo é **derivado da tabela `MoodEntry`** existente (sem tabela nova). Um service no backend calcula streak atual (com regra de graça), melhor streak e a lista de dias com boost por mês. Duas rotas `GET` autenticadas expõem resumo e calendário. No frontend, um indicador no header e um painel overlay consomem essas rotas via React Query; registrar humor invalida os dados da ofensiva.

**Tech Stack:** Fastify 4 + Prisma 5 + Zod (api), Vite 5 + React 18 + React Query + Tailwind (web), Vitest (testes), `@legends/shared` (contrato).

## Global Constraints

- TypeScript **strict**, ESM puro (`"type": "module"`, `moduleResolution: bundler`).
- Fluxo backend: **route → service → Prisma**; camadas finas; rotas validam com Zod (`safeParse` → `400 { message, issues }`).
- Rotas protegidas usam `onRequest: [app.authenticate]`; `request.user.sub` = id do usuário.
- DTOs compartilhados vivem em `@legends/shared`; alterar o contrato lá **primeiro**.
- "Dia" = data civil em **America/Sao_Paulo**; `MoodEntry.day` é gravado como `Date` à meia-noite **UTC** do dia civil.
- Testes da API batem em **Postgres real** (`pnpm db:up` antes); `test/setup.ts` trunca tabelas em `beforeEach`; `fileParallelism: false`.
- Testes Vitest, arquivos `*.test.ts(x)` **ao lado** do código. Web usa jsdom + Testing Library.
- Mensagens ao usuário em **português**. Feature chamada **"Ofensiva"** (não "Boosts").
- No frontend, chamadas de API usam `apiFetch<T>(path, opts?)` de `src/lib/api.ts` com paths iniciando em `/me/...` (o cliente prefixa `/api`).

---

### Task 1: Lib de data civil (`sao-paulo-date.ts`)

Extrai `todayInSaoPaulo()` do `mood-service` para uma lib reutilizável e adiciona helpers de data civil (funções puras, testáveis sem banco). `mood-service` passa a importar/re-exportar de lá (sem mudança de comportamento; `routes/mood.ts` continua importando `todayInSaoPaulo` de `../services/mood-service`).

**Files:**
- Create: `apps/api/src/lib/sao-paulo-date.ts`
- Create: `apps/api/src/lib/sao-paulo-date.test.ts`
- Modify: `apps/api/src/services/mood-service.ts:1-17`

**Interfaces:**
- Produces:
  - `todayInSaoPaulo(): { ymd: string; day: Date }`
  - `ymdOf(day: Date): string` — `Date` (UTC midnight) → `"YYYY-MM-DD"`
  - `dayFromYmd(ymd: string): Date` — `"YYYY-MM-DD"` → `Date` em UTC midnight
  - `addDays(ymd: string, n: number): string`
  - `monthRefOf(ymd: string): string` — `"YYYY-MM-DD"` → `"YYYY-MM"`
  - `monthBounds(ref: string): { start: Date; endExclusive: Date }`

- [ ] **Step 1: Escrever os testes que falham**

Create `apps/api/src/lib/sao-paulo-date.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  ymdOf,
  dayFromYmd,
  addDays,
  monthRefOf,
  monthBounds,
} from './sao-paulo-date'

describe('sao-paulo-date helpers', () => {
  it('ymdOf converte Date UTC-midnight em YYYY-MM-DD', () => {
    expect(ymdOf(new Date('2026-06-23T00:00:00.000Z'))).toBe('2026-06-23')
  })

  it('dayFromYmd retorna Date à meia-noite UTC', () => {
    expect(dayFromYmd('2026-06-23').toISOString()).toBe('2026-06-23T00:00:00.000Z')
  })

  it('addDays soma e subtrai dias atravessando meses', () => {
    expect(addDays('2026-06-23', 1)).toBe('2026-06-24')
    expect(addDays('2026-07-01', -1)).toBe('2026-06-30')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('monthRefOf extrai o YYYY-MM', () => {
    expect(monthRefOf('2026-06-23')).toBe('2026-06')
  })

  it('monthBounds devolve início do mês e início do mês seguinte (exclusivo)', () => {
    const { start, endExclusive } = monthBounds('2026-06')
    expect(start.toISOString()).toBe('2026-06-01T00:00:00.000Z')
    expect(endExclusive.toISOString()).toBe('2026-07-01T00:00:00.000Z')
    const dez = monthBounds('2026-12')
    expect(dez.endExclusive.toISOString()).toBe('2027-01-01T00:00:00.000Z')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/lib/sao-paulo-date.test.ts`
Expected: FAIL — `Cannot find module './sao-paulo-date'` / exports indefinidos.

- [ ] **Step 3: Implementar a lib**

Create `apps/api/src/lib/sao-paulo-date.ts`:

```ts
/**
 * Helpers de data civil em America/Sao_Paulo. "Dia" é representado como uma
 * string YYYY-MM-DD e/ou um Date à meia-noite UTC cujo componente de data é
 * exatamente esse dia civil — independente do fuso do servidor. É o mesmo
 * formato usado por MoodEntry.day.
 */
export function todayInSaoPaulo(): { ymd: string; day: Date } {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  return { ymd, day: new Date(`${ymd}T00:00:00.000Z`) }
}

export function ymdOf(day: Date): string {
  return day.toISOString().slice(0, 10)
}

export function dayFromYmd(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`)
}

export function addDays(ymd: string, n: number): string {
  const d = dayFromYmd(ymd)
  d.setUTCDate(d.getUTCDate() + n)
  return ymdOf(d)
}

export function monthRefOf(ymd: string): string {
  return ymd.slice(0, 7)
}

export function monthBounds(ref: string): { start: Date; endExclusive: Date } {
  const [year, month] = ref.split('-').map(Number)
  // Date.UTC trata overflow de mês: (year, 12, 1) → janeiro do ano seguinte.
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    endExclusive: new Date(Date.UTC(year, month, 1)),
  }
}
```

- [ ] **Step 4: Apontar o mood-service para a lib**

Edit `apps/api/src/services/mood-service.ts` — substituir a definição local de `todayInSaoPaulo` (linhas 1-17) por import + re-export:

```ts
import type { MoodLevel } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { todayInSaoPaulo } from '../lib/sao-paulo-date'

// Re-exporta para consumidores existentes (ex.: routes/mood.ts).
export { todayInSaoPaulo }
```

O restante do arquivo (interface `TodayMood`, `getTodayMood`, `setTodayMood`) permanece inalterado e continua usando `todayInSaoPaulo()`.

- [ ] **Step 5: Rodar testes da lib + do mood (garantir que nada quebrou)**

Run: `pnpm db:up && pnpm --filter @legends/api exec vitest run src/lib/sao-paulo-date.test.ts src/routes/mood.test.ts`
Expected: PASS em todos.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/sao-paulo-date.ts apps/api/src/lib/sao-paulo-date.test.ts apps/api/src/services/mood-service.ts
git commit -m "refactor(api): extrai helpers de data civil SP para lib/sao-paulo-date"
```

---

### Task 2: Tipos compartilhados + `streak-service`

Cria o contrato em `@legends/shared` e o service que calcula a ofensiva a partir de `MoodEntry`. Testes contra Postgres real.

**Files:**
- Create: `packages/shared/src/streak.ts`
- Modify: `packages/shared/src/index.ts:14` (adicionar `export * from './streak'`)
- Create: `apps/api/src/services/streak-service.ts`
- Create: `apps/api/src/services/streak-service.test.ts`

**Interfaces:**
- Consumes: `todayInSaoPaulo`, `ymdOf`, `addDays`, `monthBounds` de `../lib/sao-paulo-date`; `prisma` de `../lib/prisma`.
- Produces:
  - DTOs: `StreakSummaryDTO { currentStreak: number; bestStreak: number; today: string; registeredToday: boolean }`, `StreakCalendarDTO { ref: string; days: string[]; count: number }`
  - `getStreakSummary(userId: string): Promise<StreakSummaryDTO>`
  - `getStreakCalendar(userId: string, monthRef: string): Promise<StreakCalendarDTO>`

- [ ] **Step 1: Criar os tipos compartilhados**

Create `packages/shared/src/streak.ts`:

```ts
export interface StreakSummaryDTO {
  currentStreak: number
  bestStreak: number
  today: string // YYYY-MM-DD em America/Sao_Paulo
  registeredToday: boolean
}

export interface StreakCalendarDTO {
  ref: string // "YYYY-MM"
  days: string[] // YYYY-MM-DD com boost no mês
  count: number // boosts no mês
}
```

Edit `packages/shared/src/index.ts` — adicionar após a linha `export * from './squad'`:

```ts
export * from './streak'
```

- [ ] **Step 2: Escrever os testes do service que falham**

Create `apps/api/src/services/streak-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import { todayInSaoPaulo, addDays, dayFromYmd } from '../lib/sao-paulo-date'
import { getStreakSummary, getStreakCalendar } from './streak-service'

async function makeUser(email: string): Promise<string> {
  const app = buildApp()
  await app.ready()
  await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Ana', email, password: 'changeme123' },
  })
  await app.close()
  const user = await prisma.user.findUniqueOrThrow({ where: { email } })
  return user.id
}

async function seedDays(userId: string, ymds: string[]) {
  await prisma.moodEntry.createMany({
    data: ymds.map((ymd) => ({ userId, mood: 'GOOD' as const, day: dayFromYmd(ymd) })),
  })
}

describe('streak-service', () => {
  it('streak atual conta dias consecutivos incluindo hoje', async () => {
    const { ymd: today } = todayInSaoPaulo()
    const userId = await makeUser('a@empresa.com')
    await seedDays(userId, [today, addDays(today, -1), addDays(today, -2)])
    const s = await getStreakSummary(userId)
    expect(s.currentStreak).toBe(3)
    expect(s.registeredToday).toBe(true)
    expect(s.today).toBe(today)
  })

  it('regra de graça: sem registro de hoje mas com ontem mantém o streak', async () => {
    const { ymd: today } = todayInSaoPaulo()
    const userId = await makeUser('b@empresa.com')
    await seedDays(userId, [addDays(today, -1), addDays(today, -2)])
    const s = await getStreakSummary(userId)
    expect(s.currentStreak).toBe(2)
    expect(s.registeredToday).toBe(false)
  })

  it('streak zera quando hoje e ontem não têm registro', async () => {
    const { ymd: today } = todayInSaoPaulo()
    const userId = await makeUser('c@empresa.com')
    await seedDays(userId, [addDays(today, -3), addDays(today, -4)])
    const s = await getStreakSummary(userId)
    expect(s.currentStreak).toBe(0)
  })

  it('melhor streak é a maior sequência histórica', async () => {
    const { ymd: today } = todayInSaoPaulo()
    const userId = await makeUser('d@empresa.com')
    // run de 3 (t-10..t-8), buraco, run de 1 (t-1)
    await seedDays(userId, [
      addDays(today, -10),
      addDays(today, -9),
      addDays(today, -8),
      addDays(today, -1),
    ])
    const s = await getStreakSummary(userId)
    expect(s.bestStreak).toBe(3)
  })

  it('usuário sem registros: tudo zero', async () => {
    const userId = await makeUser('e@empresa.com')
    const s = await getStreakSummary(userId)
    expect(s).toMatchObject({ currentStreak: 0, bestStreak: 0, registeredToday: false })
  })

  it('calendário do mês retorna os dias com boost e a contagem', async () => {
    const userId = await makeUser('f@empresa.com')
    await seedDays(userId, ['2026-06-02', '2026-06-05', '2026-07-01'])
    const cal = await getStreakCalendar(userId, '2026-06')
    expect(cal.ref).toBe('2026-06')
    expect(cal.days).toEqual(['2026-06-02', '2026-06-05'])
    expect(cal.count).toBe(2)
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm db:up && pnpm --filter @legends/api exec vitest run src/services/streak-service.test.ts`
Expected: FAIL — `getStreakSummary`/`getStreakCalendar` não existem.

- [ ] **Step 4: Implementar o service**

Create `apps/api/src/services/streak-service.ts`:

```ts
import type { StreakSummaryDTO, StreakCalendarDTO } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { todayInSaoPaulo, ymdOf, addDays, monthBounds } from '../lib/sao-paulo-date'

export async function getStreakSummary(userId: string): Promise<StreakSummaryDTO> {
  const entries = await prisma.moodEntry.findMany({
    where: { userId },
    select: { day: true },
    orderBy: { day: 'asc' },
  })
  const ymds = entries.map((e) => ymdOf(e.day))
  const set = new Set(ymds)

  const { ymd: today } = todayInSaoPaulo()
  const registeredToday = set.has(today)

  // Streak atual com regra de graça: começa em hoje se registrado, senão em
  // ontem; caminha para trás enquanto houver registro contíguo.
  let currentStreak = 0
  let cursor = registeredToday ? today : addDays(today, -1)
  while (set.has(cursor)) {
    currentStreak++
    cursor = addDays(cursor, -1)
  }

  // Melhor streak: maior run de dias consecutivos no histórico ordenado.
  let bestStreak = 0
  let run = 0
  let prev: string | null = null
  for (const ymd of ymds) {
    run = prev !== null && addDays(prev, 1) === ymd ? run + 1 : 1
    if (run > bestStreak) bestStreak = run
    prev = ymd
  }

  return { currentStreak, bestStreak, today, registeredToday }
}

export async function getStreakCalendar(
  userId: string,
  monthRef: string,
): Promise<StreakCalendarDTO> {
  const { start, endExclusive } = monthBounds(monthRef)
  const entries = await prisma.moodEntry.findMany({
    where: { userId, day: { gte: start, lt: endExclusive } },
    select: { day: true },
    orderBy: { day: 'asc' },
  })
  const days = entries.map((e) => ymdOf(e.day))
  return { ref: monthRef, days, count: days.length }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/services/streak-service.test.ts`
Expected: PASS em todos os casos.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/streak.ts packages/shared/src/index.ts apps/api/src/services/streak-service.ts apps/api/src/services/streak-service.test.ts
git commit -m "feat(api): streak-service deriva ofensiva da MoodEntry + tipos compartilhados"
```

---

### Task 3: Rotas `GET /me/streak` e `/me/streak/calendar`

Expõe o service via rotas autenticadas, com Zod no query param `month`. Registra em `app.ts`. Testes de rota contra Postgres real.

**Files:**
- Create: `apps/api/src/routes/streak.ts`
- Create: `apps/api/src/routes/streak.test.ts`
- Modify: `apps/api/src/app.ts:24` (import) e `:72` (registro)

**Interfaces:**
- Consumes: `getStreakSummary`, `getStreakCalendar` de `../services/streak-service`; `todayInSaoPaulo`, `monthRefOf` de `../lib/sao-paulo-date`.
- Produces: rotas `GET /me/streak` → `StreakSummaryDTO`; `GET /me/streak/calendar?month=YYYY-MM` → `StreakCalendarDTO`. Export `streakRoutes(app: FastifyInstance)`.

- [ ] **Step 1: Escrever os testes de rota que falham**

Create `apps/api/src/routes/streak.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'

async function setup() {
  const app = buildApp()
  await app.ready()
  const reg = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' },
  })
  const token = reg.json().accessToken as string
  return { app, token }
}

describe('streak routes', () => {
  it('GET /me/streak retorna resumo zerado quando não há registros', async () => {
    const { app, token } = await setup()
    const res = await app.inject({ method: 'GET', url: '/me/streak', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toMatchObject({ currentStreak: 0, bestStreak: 0, registeredToday: false })
    expect(body.today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    await app.close()
  })

  it('registrar humor de hoje reflete no streak (currentStreak 1, registeredToday true)', async () => {
    const { app, token } = await setup()
    await app.inject({ method: 'PUT', url: '/me/mood/today', headers: { authorization: `Bearer ${token}` }, payload: { mood: 'GOOD' } })
    const res = await app.inject({ method: 'GET', url: '/me/streak', headers: { authorization: `Bearer ${token}` } })
    const body = res.json()
    expect(body.currentStreak).toBe(1)
    expect(body.registeredToday).toBe(true)
    await app.close()
  })

  it('GET /me/streak/calendar sem month usa o mês atual e conta o boost de hoje', async () => {
    const { app, token } = await setup()
    await app.inject({ method: 'PUT', url: '/me/mood/today', headers: { authorization: `Bearer ${token}` }, payload: { mood: 'GOOD' } })
    const res = await app.inject({ method: 'GET', url: '/me/streak/calendar', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.ref).toMatch(/^\d{4}-\d{2}$/)
    expect(body.count).toBe(1)
    expect(body.days).toHaveLength(1)
    await app.close()
  })

  it('GET /me/streak/calendar com month inválido retorna 400', async () => {
    const { app, token } = await setup()
    const res = await app.inject({ method: 'GET', url: '/me/streak/calendar?month=2026-13', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('exige autenticação (401 sem token)', async () => {
    const { app } = await setup()
    const res = await app.inject({ method: 'GET', url: '/me/streak' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm db:up && pnpm --filter @legends/api exec vitest run src/routes/streak.test.ts`
Expected: FAIL — rotas retornam 404 / `streakRoutes` não registrado.

- [ ] **Step 3: Implementar as rotas**

Create `apps/api/src/routes/streak.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getStreakSummary, getStreakCalendar } from '../services/streak-service'
import { todayInSaoPaulo, monthRefOf } from '../lib/sao-paulo-date'

const calendarQuerySchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
})

export async function streakRoutes(app: FastifyInstance) {
  app.get('/me/streak', { onRequest: [app.authenticate] }, async (request, reply) => {
    const summary = await getStreakSummary(request.user.sub)
    return reply.send(summary)
  })

  app.get('/me/streak/calendar', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = calendarQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    const monthRef = parsed.data.month ?? monthRefOf(todayInSaoPaulo().ymd)
    const calendar = await getStreakCalendar(request.user.sub, monthRef)
    return reply.send(calendar)
  })
}
```

- [ ] **Step 4: Registrar no app**

Edit `apps/api/src/app.ts`:
- Após a linha `import { moodRoutes } from './routes/mood'` (linha 24), adicionar:

```ts
import { streakRoutes } from './routes/streak'
```

- Após a linha `app.register(moodRoutes)` (linha 72), adicionar:

```ts
  app.register(streakRoutes)
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/routes/streak.test.ts`
Expected: PASS em todos.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/streak.ts apps/api/src/routes/streak.test.ts apps/api/src/app.ts
git commit -m "feat(api): rotas GET /me/streak e /me/streak/calendar"
```

---

### Task 4: Helper de calendário + hooks no frontend

Helpers puros de grid de calendário (testáveis) e os hooks React Query. Sem UI ainda.

**Files:**
- Create: `apps/web/src/lib/streak-calendar.ts`
- Create: `apps/web/src/lib/streak-calendar.test.ts`
- Create: `apps/web/src/lib/use-streak.ts`

**Interfaces:**
- Produces:
  - `interface GridDay { ymd: string; day: number; inMonth: boolean }`
  - `buildMonthGrid(monthRef: string): GridDay[]` — 42 células (6×7), semana começando no domingo
  - `shiftMonth(monthRef: string, delta: number): string`
  - `todaySaoPaulo(): string` — `"YYYY-MM-DD"` no fuso SP
  - `MONTH_NAMES_PT: string[]` (12 nomes), `WEEKDAY_INITIALS: string[]` (`['D','S','T','Q','Q','S','S']`)
  - `useStreakSummary()` → query `['streak']` de `StreakSummaryDTO`
  - `useStreakCalendar(monthRef: string, enabled?: boolean)` → query `['streak-calendar', monthRef]` de `StreakCalendarDTO`

- [ ] **Step 1: Escrever os testes do helper que falham**

Create `apps/web/src/lib/streak-calendar.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildMonthGrid, shiftMonth } from './streak-calendar'

describe('streak-calendar', () => {
  it('buildMonthGrid gera 42 células começando no domingo', () => {
    const grid = buildMonthGrid('2026-06') // 1/jun/2026 é segunda → domingo anterior é 31/mai
    expect(grid).toHaveLength(42)
    expect(grid[0]).toMatchObject({ ymd: '2026-05-31', day: 31, inMonth: false })
    expect(grid[1]).toMatchObject({ ymd: '2026-06-01', day: 1, inMonth: true })
    expect(grid[30]).toMatchObject({ ymd: '2026-06-30', day: 30, inMonth: true })
  })

  it('shiftMonth navega entre meses e anos', () => {
    expect(shiftMonth('2026-06', 1)).toBe('2026-07')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web exec vitest run src/lib/streak-calendar.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar o helper de calendário**

Create `apps/web/src/lib/streak-calendar.ts`:

```ts
export interface GridDay {
  ymd: string
  day: number
  inMonth: boolean
}

/** Dia civil de hoje em America/Sao_Paulo, como "YYYY-MM-DD". */
export function todaySaoPaulo(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/**
 * Grid 6×7 (42 dias) do mês, com a semana começando no domingo. Inclui os dias
 * adjacentes (inMonth=false). Aritmética em UTC para não depender do fuso do
 * navegador — só comparamos strings YYYY-MM-DD depois.
 */
export function buildMonthGrid(monthRef: string): GridDay[] {
  const first = new Date(`${monthRef}-01T00:00:00.000Z`)
  const startWeekday = first.getUTCDay() // 0=domingo
  const cells: GridDay[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(first)
    d.setUTCDate(1 - startWeekday + i)
    const ymd = d.toISOString().slice(0, 10)
    cells.push({ ymd, day: d.getUTCDate(), inMonth: ymd.slice(0, 7) === monthRef })
  }
  return cells
}

/** Soma `delta` meses ao ref "YYYY-MM". */
export function shiftMonth(monthRef: string, delta: number): string {
  const [year, month] = monthRef.split('-').map(Number)
  const d = new Date(Date.UTC(year, month - 1 + delta, 1))
  return d.toISOString().slice(0, 7)
}

export const MONTH_NAMES_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

export const WEEKDAY_INITIALS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/web exec vitest run src/lib/streak-calendar.test.ts`
Expected: PASS.

- [ ] **Step 5: Implementar os hooks React Query**

Create `apps/web/src/lib/use-streak.ts`:

```ts
import { useQuery } from '@tanstack/react-query'
import type { StreakSummaryDTO, StreakCalendarDTO } from '@legends/shared'
import { apiFetch } from './api'

/** Resumo da ofensiva (streak atual/melhor + se hoje já tem boost). */
export function useStreakSummary() {
  return useQuery({
    queryKey: ['streak'],
    queryFn: () => apiFetch<StreakSummaryDTO>('/me/streak'),
  })
}

/** Dias com boost de um mês "YYYY-MM"; só busca quando enabled. */
export function useStreakCalendar(monthRef: string, enabled = true) {
  return useQuery({
    queryKey: ['streak-calendar', monthRef],
    enabled,
    queryFn: () => apiFetch<StreakCalendarDTO>(`/me/streak/calendar?month=${monthRef}`),
  })
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/streak-calendar.ts apps/web/src/lib/streak-calendar.test.ts apps/web/src/lib/use-streak.ts
git commit -m "feat(web): helper de calendário e hooks da ofensiva"
```

---

### Task 5: `StreakIndicator` (🔥 no header)

Botão de chama com o número do streak atual, no header. Abre/fecha o painel (criado na Task 6 — nesta task usamos um placeholder local que será substituído). Para manter a task independente e testável, o indicador renderiza só o botão + um container de painel condicional vazio; a Task 6 preenche o `StreakPanel`.

**Files:**
- Create: `apps/web/src/components/StreakIndicator.tsx`
- Create: `apps/web/src/components/StreakIndicator.test.tsx`
- Modify: `apps/web/src/components/AppLayout.tsx:157` (inserir antes de `<NotificationBell />`)

**Interfaces:**
- Consumes: `useStreakSummary` de `../lib/use-streak`.
- Produces: componente `StreakIndicator` (sem props). Mantém estado `open` e fecha em clique-fora/Escape (padrão de `NotificationBell`). Renderiza `<StreakPanel onClose=... />` quando aberto (importado de `./StreakPanel`).

- [ ] **Step 1: Escrever o teste que falha**

Create `apps/web/src/components/StreakIndicator.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StreakIndicator } from './StreakIndicator'
import * as api from '../lib/api'

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('StreakIndicator', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('mostra o número do streak atual', async () => {
    vi.spyOn(api, 'apiFetch').mockResolvedValue({
      currentStreak: 7, bestStreak: 24, today: '2026-06-23', registeredToday: true,
    } as never)
    wrap(<StreakIndicator />)
    expect(await screen.findByText('7')).toBeInTheDocument()
  })

  it('não renderiza nada quando a query falha', async () => {
    const spy = vi.spyOn(api, 'apiFetch').mockRejectedValue(new Error('boom'))
    const { container } = wrap(<StreakIndicator />)
    await waitFor(() => expect(spy).toHaveBeenCalled())
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web exec vitest run src/components/StreakIndicator.test.tsx`
Expected: FAIL — `StreakIndicator` não existe.

- [ ] **Step 3: Criar um `StreakPanel` mínimo (placeholder a ser expandido na Task 6)**

Create `apps/web/src/components/StreakPanel.tsx`:

```tsx
/** Placeholder — expandido na Task 6 com calendário + cards. */
export function StreakPanel({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-label="Ofensiva"
      className="absolute right-0 top-full z-50 mt-sm w-80 rounded-xl border border-outline-variant/40 bg-surface-container p-lg shadow-lg"
    >
      <button type="button" onClick={onClose} className="font-label text-label-md text-primary">
        Fechar
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Implementar o indicador**

Create `apps/web/src/components/StreakIndicator.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { useStreakSummary } from '../lib/use-streak'
import { StreakPanel } from './StreakPanel'

export function StreakIndicator() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const summary = useStreakSummary()

  useEffect(() => {
    if (!open) return
    function onPointer(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Se a ofensiva não carrega, não polui o header.
  if (summary.isError) return null

  const streak = summary.data?.currentStreak ?? 0

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Ofensiva"
        className="flex items-center gap-sm rounded-full border-2 border-primary/40 px-md py-1.5 transition-colors hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
      >
        <span className="text-[20px] leading-none" aria-hidden>🔥</span>
        <span className="font-label text-label-lg font-bold text-on-surface">{streak}</span>
      </button>

      {open && <StreakPanel onClose={() => setOpen(false)} />}
    </div>
  )
}
```

- [ ] **Step 5: Inserir no header**

Edit `apps/web/src/components/AppLayout.tsx`:
- Adicionar o import junto aos demais de componentes (após a linha `import { NotificationBell } from "./NotificationBell";`):

```tsx
import { StreakIndicator } from "./StreakIndicator";
```

- No header, dentro de `<div className="flex items-center gap-lg">`, inserir o indicador **antes** de `<NotificationBell />`:

```tsx
          <div className="flex items-center gap-lg">
            <StreakIndicator />
            <NotificationBell />
```

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @legends/web exec vitest run src/components/StreakIndicator.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/StreakIndicator.tsx apps/web/src/components/StreakIndicator.test.tsx apps/web/src/components/StreakPanel.tsx apps/web/src/components/AppLayout.tsx
git commit -m "feat(web): indicador 🔥 da ofensiva no header"
```

---

### Task 6: `StreakPanel` (calendário + cards) + invalidação no Humor do Dia

Expande o painel placeholder com o calendário do mês e os 3 cards, e faz o `MoodOfDay` invalidar os dados da ofensiva ao registrar humor.

**Files:**
- Modify: `apps/web/src/components/StreakPanel.tsx` (substituir o placeholder)
- Create: `apps/web/src/components/StreakPanel.test.tsx`
- Modify: `apps/web/src/pages/profile/MoodOfDay.tsx:36-39` (onSuccess da mutation)

**Interfaces:**
- Consumes: `useStreakSummary`, `useStreakCalendar` de `../lib/use-streak`; `buildMonthGrid`, `shiftMonth`, `todaySaoPaulo`, `MONTH_NAMES_PT`, `WEEKDAY_INITIALS` de `../lib/streak-calendar`.
- Produces: `StreakPanel({ onClose }: { onClose: () => void })` completo.

- [ ] **Step 1: Escrever o teste que falha**

Create `apps/web/src/components/StreakPanel.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StreakPanel } from './StreakPanel'
import * as api from '../lib/api'

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('StreakPanel', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('mostra os cards de streak e marca os dias com boost do mês', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
      if (path === '/me/streak') {
        return { currentStreak: 3, bestStreak: 24, today: '2026-06-23', registeredToday: true } as never
      }
      // calendar
      return { ref: '2026-06', days: ['2026-06-02', '2026-06-05'], count: 2 } as never
    })

    wrap(<StreakPanel onClose={() => {}} />)

    expect(await screen.findByText('Streak atual')).toBeInTheDocument()
    expect(screen.getByText('Melhor streak')).toBeInTheDocument()
    expect(screen.getByText('Boosts no mês')).toBeInTheDocument()
    // valor do melhor streak
    expect(screen.getByText('24')).toBeInTheDocument()
    // dias com boost ficam marcados com aria-label específico
    expect(await screen.findByLabelText('2 de Junho — com boost')).toBeInTheDocument()
    expect(screen.getByLabelText('5 de Junho — com boost')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web exec vitest run src/components/StreakPanel.test.tsx`
Expected: FAIL — placeholder não tem os textos/labels.

- [ ] **Step 3: Implementar o painel completo**

Replace `apps/web/src/components/StreakPanel.tsx` inteiro:

```tsx
import { useState } from 'react'
import { useStreakSummary, useStreakCalendar } from '../lib/use-streak'
import {
  buildMonthGrid,
  shiftMonth,
  todaySaoPaulo,
  MONTH_NAMES_PT,
  WEEKDAY_INITIALS,
} from '../lib/streak-calendar'

function StatCard({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-outline-variant/40 bg-surface-container-low px-md py-lg">
      <span className="font-headline text-headline-md font-bold text-on-surface">{value}</span>
      <span className="mt-1 font-label text-label-sm text-on-surface-variant">{label}</span>
    </div>
  )
}

export function StreakPanel({ onClose }: { onClose: () => void }) {
  const summary = useStreakSummary()
  const today = summary.data?.today ?? todaySaoPaulo()
  const [monthRef, setMonthRef] = useState(() => today.slice(0, 7))
  const calendar = useStreakCalendar(monthRef)

  const boostDays = new Set(calendar.data?.days ?? [])
  const grid = buildMonthGrid(monthRef)
  const [year, month] = monthRef.split('-').map(Number)
  const monthLabel = `${MONTH_NAMES_PT[month - 1]} ${year}`

  return (
    <div
      role="dialog"
      aria-label="Ofensiva"
      className="absolute right-0 top-full z-50 mt-sm w-[min(90vw,720px)] rounded-2xl border border-outline-variant/40 bg-surface-container p-lg shadow-lg"
    >
      <div className="mb-lg flex items-center justify-between">
        <h2 className="flex items-center gap-sm font-headline text-title-lg font-bold text-on-surface">
          <span aria-hidden>🔥</span> Ofensiva
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="rounded-full px-sm py-1 font-label text-label-md text-on-surface-variant hover:bg-surface-container-highest"
        >
          ✕
        </button>
      </div>

      <div className="grid gap-lg md:grid-cols-2">
        {/* Calendário */}
        <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low p-md">
          <div className="mb-md flex items-center justify-between">
            <button
              type="button"
              onClick={() => setMonthRef((r) => shiftMonth(r, -1))}
              aria-label="Mês anterior"
              className="rounded-full px-sm py-1 text-on-surface-variant hover:bg-surface-container-highest"
            >
              ‹
            </button>
            <span className="font-label text-label-lg font-bold uppercase tracking-wide text-on-surface">
              {monthLabel}
            </span>
            <button
              type="button"
              onClick={() => setMonthRef((r) => shiftMonth(r, 1))}
              aria-label="Próximo mês"
              className="rounded-full px-sm py-1 text-on-surface-variant hover:bg-surface-container-highest"
            >
              ›
            </button>
          </div>

          <div className="mb-sm grid grid-cols-7 gap-1 text-center font-label text-label-sm text-on-surface-variant">
            {WEEKDAY_INITIALS.map((d, i) => (
              <span key={i}>{d}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {grid.map((cell) => {
              const hasBoost = cell.inMonth && boostDays.has(cell.ymd)
              const isToday = cell.ymd === today
              const monthName = MONTH_NAMES_PT[Number(cell.ymd.slice(5, 7)) - 1]
              return (
                <div
                  key={cell.ymd}
                  aria-label={hasBoost ? `${cell.day} de ${monthName} — com boost` : undefined}
                  className={[
                    'flex aspect-square items-center justify-center rounded-full font-label text-label-md',
                    !cell.inMonth ? 'text-on-surface-variant/30' : '',
                    hasBoost ? 'bg-primary/20 font-bold text-primary' : '',
                    isToday && !hasBoost ? 'ring-1 ring-primary text-on-surface' : '',
                    isToday && hasBoost ? 'ring-2 ring-primary' : '',
                    !hasBoost && cell.inMonth && !isToday ? 'text-on-surface' : '',
                  ].join(' ')}
                >
                  {hasBoost ? '🔥' : cell.day}
                </div>
              )
            })}
          </div>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-2 gap-md content-start">
          <StatCard value={summary.data?.currentStreak ?? 0} label="Streak atual" />
          <StatCard value={summary.data?.bestStreak ?? 0} label="Melhor streak" />
          <div className="col-span-2">
            <StatCard value={calendar.data?.count ?? 0} label="Boosts no mês" />
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/web exec vitest run src/components/StreakPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Invalidar a ofensiva ao registrar humor**

Edit `apps/web/src/pages/profile/MoodOfDay.tsx` — no `onSuccess` da mutation `setMood` (atualmente só `queryClient.setQueryData(['mood-today'], data)`), adicionar a invalidação:

```ts
    onSuccess: (data) => {
      queryClient.setQueryData(['mood-today'], data)
      queryClient.invalidateQueries({ queryKey: ['streak'] })
      queryClient.invalidateQueries({ queryKey: ['streak-calendar'] })
    },
```

- [ ] **Step 6: Rodar a suíte web inteira (garantir que MoodOfDay e App seguem verdes)**

Run: `pnpm --filter @legends/web test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/StreakPanel.tsx apps/web/src/components/StreakPanel.test.tsx apps/web/src/pages/profile/MoodOfDay.tsx
git commit -m "feat(web): painel da ofensiva (calendário + cards) e invalidação ao registrar humor"
```

---

### Task 7: Verificação final (typecheck + suíte completa)

Garante que o contrato compartilhado e os dois lados batem (o build/Vitest não fazem typecheck do projeto — rodar `tsc --noEmit` por workspace).

**Files:** nenhum (apenas verificação; corrigir o que aparecer).

- [ ] **Step 1: Typecheck dos workspaces tocados**

Run:
```bash
pnpm --filter @legends/shared exec tsc --noEmit
pnpm --filter @legends/api exec tsc --noEmit
pnpm --filter @legends/web exec tsc --noEmit
```
Expected: sem erros. (Se o `tsconfig` não expor `tsc` direto, usar `pnpm --filter <ws> run build` equivalente ao typecheck do workspace.)

- [ ] **Step 2: Suíte completa**

Run: `pnpm db:up && pnpm test`
Expected: todos os testes (api + web + shared) PASS.

- [ ] **Step 3: Commit (se houve ajustes)**

```bash
git add -A
git commit -m "chore(ofensiva): ajustes de typecheck e verificação final"
```

---

## Self-Review

**Spec coverage:**
- Boost = MoodEntry; derivação sem tabela nova → Task 2 (service lê `MoodEntry`). ✅
- Streak atual com regra de graça → Task 2 (testes de hoje/ontem/zera). ✅
- Melhor streak → Task 2. ✅
- Boosts no mês + calendário → Task 2 (`getStreakCalendar`) + Task 6 (UI). ✅
- Lib de data SP reutilizada → Task 1. ✅
- Rotas `GET /me/streak` e `/me/streak/calendar` com Zod/default/400 → Task 3. ✅
- Tipos em `@legends/shared` → Task 2. ✅
- 🔥 no header → Task 5. ✅
- Painel com calendário (nav, D S T Q Q S S, hoje destacado, dias fora esmaecidos) + 3 cards → Task 6. ✅
- Grid por aritmética UTC, comparação por string → Task 4 (`buildMonthGrid`) + Task 6. ✅
- Invalidação ao registrar humor → Task 6. ✅
- Erros: 🔥 some em erro → Task 5; Zod 400 → Task 3. ✅
- Testes API (real DB) e web (jsdom) → Tasks 2,3 / 4,5,6. ✅
- Nomenclatura "Ofensiva" → Tasks 5,6. ✅

**Placeholder scan:** Sem TBD/TODO; todo passo tem código/comando concreto. O "placeholder" do `StreakPanel` na Task 5 é intencional e substituído na Task 6 (declarado explicitamente). ✅

**Type consistency:** `StreakSummaryDTO`/`StreakCalendarDTO` definidos na Task 2 e usados igual em rotas (Task 3) e hooks (Task 4). Helpers da lib de data (Task 1) usados com as mesmas assinaturas no service (Task 2). `buildMonthGrid`/`shiftMonth`/`todaySaoPaulo` (Task 4) consumidos no painel (Task 6) com os mesmos nomes. Query keys `['streak']` e `['streak-calendar', monthRef]` consistentes entre hooks (Task 4) e invalidação (Task 6). ✅

# Ofensiva em dias úteis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reescrever o motor da Ofensiva para contar somente dias úteis (seg–sex), tratando o fim de semana como ponte, e esmaecer o fim de semana no calendário do painel.

**Architecture:** A Ofensiva é derivada da `MoodEntry`. Adicionamos helpers puros de dia útil em `sao-paulo-date.ts` e reescrevemos o cálculo em `streak-service.ts` (streak atual com graça por dia útil, melhor streak por dias úteis consecutivos, boosts do mês só de dias úteis). `getStreakSummary` ganha um parâmetro opcional `todayYmd` para testes determinísticos. O contrato (`@legends/shared`) e as rotas não mudam — só a semântica dos números. No front, o calendário esmaece células de fim de semana.

**Tech Stack:** Fastify 4 + Prisma 5 (api), Vite 5 + React 18 + React Query + Tailwind (web), Vitest, `@legends/shared`.

## Global Constraints

- TypeScript **strict**, ESM puro (`"type": "module"`, `moduleResolution: bundler`).
- "Dia" = data civil em **America/Sao_Paulo**, string `YYYY-MM-DD`, aritmética em **UTC**. `MoodEntry.day` = `Date` à meia-noite UTC do dia civil.
- **Dia útil = seg–sex** por `getUTCDay()` ∈ {1,2,3,4,5}. Fim de semana = {0,6}. **Feriados fora de escopo** (contam como dia útil).
- Fluxo backend route → service → Prisma; camadas finas.
- **Sem mudança de schema, migration ou contrato** (`StreakSummaryDTO`/`StreakCalendarDTO` inalterados).
- Testes Vitest `*.test.ts(x)` **ao lado** do código; API bate em **Postgres real** (`pnpm db:up` antes); web usa jsdom + Testing Library.
- Mensagens ao usuário em **português**. Feature "Ofensiva".
- Rodar comandos da raiz: `/Users/luccasecco/Documents/projetos/engineering_legends`.

---

### Task 1: Helpers de dia útil em `sao-paulo-date.ts`

Funções puras (sem banco) para classificar e navegar dias úteis. Base de toda a lógica das tasks seguintes.

**Files:**
- Modify: `apps/api/src/lib/sao-paulo-date.ts` (adicionar 3 funções ao final)
- Modify: `apps/api/src/lib/sao-paulo-date.test.ts` (adicionar um `describe` novo)

**Interfaces:**
- Consumes: `dayFromYmd`, `addDays` (já existentes no mesmo arquivo).
- Produces:
  - `isBusinessDay(ymd: string): boolean`
  - `prevBusinessDay(ymd: string): string`
  - `nextBusinessDay(ymd: string): string`

- [ ] **Step 1: Escrever os testes que falham**

Adicionar ao final de `apps/api/src/lib/sao-paulo-date.test.ts`, **dentro do arquivo** (novo `describe`, e incluir os novos nomes no import existente do topo — o import atual é `import { ymdOf, dayFromYmd, addDays, monthRefOf, monthBounds } from './sao-paulo-date'`; trocar por incluir os três novos):

```ts
import {
  ymdOf,
  dayFromYmd,
  addDays,
  monthRefOf,
  monthBounds,
  isBusinessDay,
  prevBusinessDay,
  nextBusinessDay,
} from './sao-paulo-date'
```

E adicionar este bloco após o `describe('sao-paulo-date helpers', ...)` existente:

```ts
// Referência de dias da semana (2026): 06-01 seg, 06-05 sex, 06-06 sáb,
// 06-07 dom, 06-08 seg. 05-29 é sexta.
describe('sao-paulo-date business days', () => {
  it('isBusinessDay distingue seg–sex de fim de semana', () => {
    expect(isBusinessDay('2026-06-05')).toBe(true) // sexta
    expect(isBusinessDay('2026-06-06')).toBe(false) // sábado
    expect(isBusinessDay('2026-06-07')).toBe(false) // domingo
    expect(isBusinessDay('2026-06-08')).toBe(true) // segunda
  })

  it('prevBusinessDay pula o fim de semana e a virada de mês', () => {
    expect(prevBusinessDay('2026-06-08')).toBe('2026-06-05') // seg → sexta
    expect(prevBusinessDay('2026-06-05')).toBe('2026-06-04') // sex → quinta
    expect(prevBusinessDay('2026-06-01')).toBe('2026-05-29') // seg → sexta do mês anterior
  })

  it('nextBusinessDay pula o fim de semana e a virada de mês', () => {
    expect(nextBusinessDay('2026-06-05')).toBe('2026-06-08') // sex → segunda
    expect(nextBusinessDay('2026-06-08')).toBe('2026-06-09') // seg → terça
    expect(nextBusinessDay('2026-05-29')).toBe('2026-06-01') // sexta → segunda do mês seguinte
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/lib/sao-paulo-date.test.ts`
Expected: FAIL — `isBusinessDay`/`prevBusinessDay`/`nextBusinessDay` não exportados.

- [ ] **Step 3: Implementar os helpers**

Adicionar ao final de `apps/api/src/lib/sao-paulo-date.ts`:

```ts
/** Segunda a sexta (getUTCDay 1..5). Sábado/domingo são fim de semana. */
export function isBusinessDay(ymd: string): boolean {
  const weekday = dayFromYmd(ymd).getUTCDay()
  return weekday >= 1 && weekday <= 5
}

/** Dia útil imediatamente anterior a `ymd` (pula sábado/domingo). */
export function prevBusinessDay(ymd: string): string {
  let cur = addDays(ymd, -1)
  while (!isBusinessDay(cur)) cur = addDays(cur, -1)
  return cur
}

/** Dia útil imediatamente seguinte a `ymd` (pula sábado/domingo). */
export function nextBusinessDay(ymd: string): string {
  let cur = addDays(ymd, 1)
  while (!isBusinessDay(cur)) cur = addDays(cur, 1)
  return cur
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/lib/sao-paulo-date.test.ts`
Expected: PASS (incluindo os testes antigos).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/sao-paulo-date.ts apps/api/src/lib/sao-paulo-date.test.ts
git commit -m "feat(api): helpers de dia útil (isBusinessDay/prev/next) em sao-paulo-date"
```

---

### Task 2: Reescrever `streak-service` para dias úteis

Cálculo de streak atual (graça por dia útil), melhor streak (dias úteis consecutivos) e boosts do mês (só dias úteis). `getStreakSummary` ganha `todayYmd` opcional. Reescreve os testes do service e ajusta os testes de rota para serem robustos a qual dia da semana é "hoje".

**Files:**
- Modify: `apps/api/src/services/streak-service.ts` (reescrita das duas funções)
- Modify: `apps/api/src/services/streak-service.test.ts` (reescrita completa dos casos)
- Modify: `apps/api/src/routes/streak.test.ts` (tornar 2 asserts robustos ao dia da semana)

**Interfaces:**
- Consumes: `todayInSaoPaulo`, `ymdOf`, `monthBounds`, `isBusinessDay`, `prevBusinessDay`, `nextBusinessDay` de `../lib/sao-paulo-date`; `prisma`.
- Produces:
  - `getStreakSummary(userId: string, todayYmd?: string): Promise<StreakSummaryDTO>` (novo parâmetro opcional `todayYmd`, default `todayInSaoPaulo().ymd`).
  - `getStreakCalendar(userId: string, monthRef: string): Promise<StreakCalendarDTO>` (mesma assinatura; `days`/`count` agora só de dias úteis).

- [ ] **Step 1: Reescrever os testes do service (falham)**

Substituir **todo** o conteúdo de `apps/api/src/services/streak-service.test.ts` por:

```ts
import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import { dayFromYmd } from '../lib/sao-paulo-date'
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

// Semana de referência (2026): 06-01 seg ... 06-05 sex, 06-06 sáb, 06-07 dom,
// 06-08 seg. "today" é injetado para deixar o cálculo determinístico.
describe('streak-service (dias úteis)', () => {
  it('streak atual conta dias úteis consecutivos incluindo hoje', async () => {
    const userId = await makeUser('a@empresa.com')
    await seedDays(userId, ['2026-06-01', '2026-06-02', '2026-06-03'])
    const s = await getStreakSummary(userId, '2026-06-03') // quarta
    expect(s.currentStreak).toBe(3)
    expect(s.registeredToday).toBe(true)
    expect(s.today).toBe('2026-06-03')
  })

  it('ponte de fim de semana: sexta + segunda são consecutivos', async () => {
    const userId = await makeUser('b@empresa.com')
    await seedDays(userId, ['2026-06-05', '2026-06-08']) // sexta + segunda
    const s = await getStreakSummary(userId, '2026-06-08') // segunda
    expect(s.currentStreak).toBe(2)
  })

  it('graça no fim de semana: hoje sábado, sexta com boost segura o streak', async () => {
    const userId = await makeUser('c@empresa.com')
    await seedDays(userId, ['2026-06-04', '2026-06-05']) // quinta + sexta
    const s = await getStreakSummary(userId, '2026-06-06') // sábado
    expect(s.currentStreak).toBe(2)
    expect(s.registeredToday).toBe(false)
  })

  it('graça na manhã de segunda: sem boost hoje, sexta com boost segura', async () => {
    const userId = await makeUser('d@empresa.com')
    await seedDays(userId, ['2026-06-04', '2026-06-05']) // quinta + sexta
    const s = await getStreakSummary(userId, '2026-06-08') // segunda, ainda sem boost
    expect(s.currentStreak).toBe(2)
    expect(s.registeredToday).toBe(false)
  })

  it('falta de um dia útil quebra a sequência', async () => {
    const userId = await makeUser('e@empresa.com')
    // quarta com boost, depois pula quinta e sexta, segunda com boost
    await seedDays(userId, ['2026-06-03', '2026-06-08'])
    const s = await getStreakSummary(userId, '2026-06-08') // segunda
    expect(s.currentStreak).toBe(1)
  })

  it('entrada de fim de semana é ignorada no melhor streak', async () => {
    const userId = await makeUser('f@empresa.com')
    await seedDays(userId, ['2026-06-05', '2026-06-06', '2026-06-08']) // sex, sáb, seg
    const s = await getStreakSummary(userId, '2026-06-08')
    expect(s.bestStreak).toBe(2) // sexta→segunda; sábado não conta nem quebra
  })

  it('melhor streak escolhe o maior run histórico de dias úteis', async () => {
    const userId = await makeUser('g@empresa.com')
    // run de 3 (seg/ter/qua), buraco (sem quinta), sexta isolada
    await seedDays(userId, ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-05'])
    const s = await getStreakSummary(userId, '2026-06-05')
    expect(s.bestStreak).toBe(3)
  })

  it('usuário sem registros: tudo zero', async () => {
    const userId = await makeUser('h@empresa.com')
    const s = await getStreakSummary(userId, '2026-06-03')
    expect(s).toMatchObject({ currentStreak: 0, bestStreak: 0, registeredToday: false })
  })

  it('calendário do mês conta só dias úteis (exclui fim de semana)', async () => {
    const userId = await makeUser('i@empresa.com')
    await seedDays(userId, ['2026-06-05', '2026-06-06', '2026-06-08']) // sex, sáb, seg
    const cal = await getStreakCalendar(userId, '2026-06')
    expect(cal.ref).toBe('2026-06')
    expect(cal.days).toEqual(['2026-06-05', '2026-06-08'])
    expect(cal.count).toBe(2)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm db:up && pnpm --filter @legends/api exec vitest run src/services/streak-service.test.ts`
Expected: FAIL — lógica atual conta dias corridos (ex.: ponte sexta→segunda dá 1, não 2; sábado some no calendário ainda não filtrado).

- [ ] **Step 3: Reescrever o service**

Substituir **todo** o conteúdo de `apps/api/src/services/streak-service.ts` por:

```ts
import type { StreakSummaryDTO, StreakCalendarDTO } from '@legends/shared'
import { prisma } from '../lib/prisma'
import {
  todayInSaoPaulo,
  ymdOf,
  monthBounds,
  isBusinessDay,
  prevBusinessDay,
  nextBusinessDay,
} from '../lib/sao-paulo-date'

export async function getStreakSummary(
  userId: string,
  todayYmd: string = todayInSaoPaulo().ymd,
): Promise<StreakSummaryDTO> {
  const entries = await prisma.moodEntry.findMany({
    where: { userId },
    select: { day: true },
    orderBy: { day: 'asc' },
  })
  const set = new Set(entries.map((e) => ymdOf(e.day)))

  const registeredToday = set.has(todayYmd)

  // Dia útil de referência: hoje se for dia útil; senão o último dia útil
  // anterior (sexta, no fim de semana). Fins de semana são ponte.
  const lastBiz = isBusinessDay(todayYmd) ? todayYmd : prevBusinessDay(todayYmd)

  // Streak atual com regra de graça: se o dia útil de referência ainda não tem
  // boost, não quebra — começa a contar do dia útil anterior. Caminha para trás
  // por dias úteis (fins de semana são pontados).
  let currentStreak = 0
  let cursor = set.has(lastBiz) ? lastBiz : prevBusinessDay(lastBiz)
  while (set.has(cursor)) {
    currentStreak++
    cursor = prevBusinessDay(cursor)
  }

  // Melhor streak: maior run de dias úteis consecutivos com boost. Entradas de
  // fim de semana são ignoradas; dois dias úteis são consecutivos se um é o dia
  // útil imediatamente seguinte do outro (sexta→segunda conta).
  const bizYmds = [...set].filter(isBusinessDay).sort()
  let bestStreak = 0
  let run = 0
  let prev: string | null = null
  for (const ymd of bizYmds) {
    run = prev !== null && nextBusinessDay(prev) === ymd ? run + 1 : 1
    if (run > bestStreak) bestStreak = run
    prev = ymd
  }

  return { currentStreak, bestStreak, today: todayYmd, registeredToday }
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
  // Só dias úteis contam como boost (fim de semana é neutro).
  const days = entries.map((e) => ymdOf(e.day)).filter(isBusinessDay)
  return { ref: monthRef, days, count: days.length }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/services/streak-service.test.ts`
Expected: PASS em todos os casos.

- [ ] **Step 5: Tornar os testes de rota robustos ao dia da semana**

Os testes de rota em `apps/api/src/routes/streak.test.ts` registram o humor de **hoje** (data real) e hoje pode cair no fim de semana — quando cai, o boost não conta para streak/calendário. Ajustar os dois asserts que dependem disso.

Trocar o import do topo do arquivo (atualmente apenas `import { buildApp } from '../app'`) para também importar os helpers:

```ts
import { buildApp } from '../app'
import { todayInSaoPaulo, isBusinessDay } from '../lib/sao-paulo-date'
```

No teste `'registrar humor de hoje reflete no streak (currentStreak 1, registeredToday true)'`, substituir o corpo das asserções por:

```ts
    const body = res.json()
    const expectedStreak = isBusinessDay(todayInSaoPaulo().ymd) ? 1 : 0
    expect(body.currentStreak).toBe(expectedStreak)
    expect(body.registeredToday).toBe(true)
```

No teste `'GET /me/streak/calendar sem month usa o mês atual e conta o boost de hoje'`, substituir as asserções de contagem por:

```ts
    const body = res.json()
    expect(body.ref).toMatch(/^\d{4}-\d{2}$/)
    const expectedCount = isBusinessDay(todayInSaoPaulo().ymd) ? 1 : 0
    expect(body.count).toBe(expectedCount)
    expect(body.days).toHaveLength(expectedCount)
```

- [ ] **Step 6: Rodar a suíte de streak completa**

Run: `pnpm --filter @legends/api exec vitest run src/services/streak-service.test.ts src/routes/streak.test.ts`
Expected: PASS em ambos.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/streak-service.ts apps/api/src/services/streak-service.test.ts apps/api/src/routes/streak.test.ts
git commit -m "feat(api): ofensiva conta dias úteis (graça/recorde/mês por seg-sex)"
```

---

### Task 3: Esmaecer fim de semana no calendário do painel

Helper `isWeekendYmd` no front e estilização neutra das células de fim de semana no `StreakPanel`.

**Files:**
- Modify: `apps/web/src/lib/streak-calendar.ts` (adicionar `isWeekendYmd`)
- Modify: `apps/web/src/lib/streak-calendar.test.ts` (adicionar casos)
- Modify: `apps/web/src/components/StreakPanel.tsx` (estilo das células)
- Modify: `apps/web/src/components/StreakPanel.test.tsx` (teste de fim de semana neutro)

**Interfaces:**
- Consumes: `buildMonthGrid`, `shiftMonth`, `todaySaoPaulo`, `MONTH_NAMES_PT`, `WEEKDAY_INITIALS` (já existentes).
- Produces: `isWeekendYmd(ymd: string): boolean`.

- [ ] **Step 1: Escrever os testes do helper (falham)**

Adicionar ao final de `apps/web/src/lib/streak-calendar.test.ts` (e incluir `isWeekendYmd` no import existente de `./streak-calendar`):

```ts
import { buildMonthGrid, shiftMonth, isWeekendYmd } from './streak-calendar'
```

E adicionar dentro do `describe('streak-calendar', ...)` existente:

```ts
  it('isWeekendYmd identifica sábado e domingo', () => {
    expect(isWeekendYmd('2026-06-06')).toBe(true) // sábado
    expect(isWeekendYmd('2026-06-07')).toBe(true) // domingo
    expect(isWeekendYmd('2026-06-05')).toBe(false) // sexta
    expect(isWeekendYmd('2026-06-08')).toBe(false) // segunda
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web exec vitest run src/lib/streak-calendar.test.ts`
Expected: FAIL — `isWeekendYmd` não exportado.

- [ ] **Step 3: Implementar o helper**

Adicionar em `apps/web/src/lib/streak-calendar.ts` (após `todaySaoPaulo`):

```ts
/** Sábado (6) ou domingo (0), por aritmética UTC. */
export function isWeekendYmd(ymd: string): boolean {
  const weekday = new Date(`${ymd}T00:00:00.000Z`).getUTCDay()
  return weekday === 0 || weekday === 6
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/web exec vitest run src/lib/streak-calendar.test.ts`
Expected: PASS.

- [ ] **Step 5: Escrever o teste do painel (falha)**

Substituir **todo** o conteúdo de `apps/web/src/components/StreakPanel.test.tsx` por (acrescenta um caso de fim de semana neutro ao teste existente):

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

  it('mostra os cards de streak e marca os dias úteis com boost do mês', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
      if (path === '/me/streak') {
        return { currentStreak: 3, bestStreak: 24, today: '2026-06-23', registeredToday: true } as never
      }
      return { ref: '2026-06', days: ['2026-06-02', '2026-06-05'], count: 2 } as never
    })

    wrap(<StreakPanel onClose={() => {}} />)

    expect(await screen.findByText('Streak atual')).toBeInTheDocument()
    expect(screen.getByText('Melhor streak')).toBeInTheDocument()
    expect(screen.getByText('Boosts no mês')).toBeInTheDocument()
    expect(screen.getByText('24')).toBeInTheDocument()
    expect(await screen.findByLabelText('2 de Junho — com boost')).toBeInTheDocument()
    expect(screen.getByLabelText('5 de Junho — com boost')).toBeInTheDocument()
  })

  it('não marca chama em dia de fim de semana, mesmo se vier nos days', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
      if (path === '/me/streak') {
        return { currentStreak: 1, bestStreak: 5, today: '2026-06-23', registeredToday: true } as never
      }
      // 06-06 é sábado — não deve ser marcado como boost
      return { ref: '2026-06', days: ['2026-06-05', '2026-06-06'], count: 1 } as never
    })

    wrap(<StreakPanel onClose={() => {}} />)

    expect(await screen.findByLabelText('5 de Junho — com boost')).toBeInTheDocument()
    expect(screen.queryByLabelText('6 de Junho — com boost')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `pnpm --filter @legends/web exec vitest run src/components/StreakPanel.test.tsx`
Expected: FAIL — hoje o painel marcaria 06-06 (sábado) como boost se vier em `days`.

- [ ] **Step 7: Implementar o esmaecimento no painel**

Em `apps/web/src/components/StreakPanel.tsx`:

Adicionar `isWeekendYmd` ao import de `../lib/streak-calendar`:

```tsx
import {
  buildMonthGrid,
  shiftMonth,
  todaySaoPaulo,
  isWeekendYmd,
  MONTH_NAMES_PT,
  WEEKDAY_INITIALS,
} from '../lib/streak-calendar'
```

Substituir o bloco `{grid.map((cell) => { ... })}` (atual) por:

```tsx
            {grid.map((cell) => {
              const weekend = isWeekendYmd(cell.ymd)
              const hasBoost = cell.inMonth && !weekend && boostDays.has(cell.ymd)
              const isToday = cell.ymd === today
              const monthName = MONTH_NAMES_PT[Number(cell.ymd.slice(5, 7)) - 1]
              return (
                <div
                  key={cell.ymd}
                  aria-label={hasBoost ? `${cell.day} de ${monthName} — com boost` : undefined}
                  className={[
                    'flex aspect-square items-center justify-center rounded-full font-label text-label-md',
                    !cell.inMonth || weekend ? 'text-on-surface-variant/30' : 'text-on-surface',
                    hasBoost ? 'bg-primary/20 font-bold text-primary' : '',
                    isToday && !weekend && !hasBoost ? 'ring-1 ring-primary' : '',
                    isToday && !weekend && hasBoost ? 'ring-2 ring-primary' : '',
                  ].join(' ')}
                >
                  {hasBoost ? '🔥' : cell.day}
                </div>
              )
            })}
```

- [ ] **Step 8: Rodar e ver passar (suíte web inteira)**

Run: `pnpm --filter @legends/web test`
Expected: PASS (StreakPanel 2/2, demais verdes).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/streak-calendar.ts apps/web/src/lib/streak-calendar.test.ts apps/web/src/components/StreakPanel.tsx apps/web/src/components/StreakPanel.test.tsx
git commit -m "feat(web): esmaece fim de semana no calendário da ofensiva"
```

---

### Task 4: Verificação final (typecheck + suíte)

Garante contrato/lados consistentes (build/Vitest não fazem typecheck — rodar `tsc --noEmit` por workspace).

**Files:** nenhum (verificação; corrigir o que aparecer).

- [ ] **Step 1: Typecheck dos workspaces tocados**

Run:
```bash
pnpm --filter @legends/shared exec tsc --noEmit
pnpm --filter @legends/api exec tsc --noEmit
pnpm --filter @legends/web exec tsc --noEmit
```
Expected: sem erros.

- [ ] **Step 2: Suíte completa**

Run: `pnpm db:up && pnpm test`
Expected: api + web + shared PASS.

- [ ] **Step 3: Commit (se houve ajustes)**

```bash
git add -A
git commit -m "chore(ofensiva): ajustes de typecheck e verificação final dias úteis"
```

---

## Self-Review

**Spec coverage:**
- Dia útil = seg–sex; helpers `isBusinessDay`/`prev`/`next` → Task 1. ✅
- Fim de semana é ponte (sex→seg consecutivo); streak atual com graça por dia útil → Task 2 (`getStreakSummary`, testes de ponte/graça). ✅
- Melhor streak por dias úteis consecutivos, entrada de fim de semana ignorada → Task 2. ✅
- Boosts no mês só de dias úteis → Task 2 (`getStreakCalendar` + teste). ✅
- `getStreakSummary(userId, todayYmd?)` para testes determinísticos → Task 2. ✅
- Contrato/rotas inalterados; rotas robustas a hoje cair no fim de semana → Task 2 Step 5. ✅
- Fim de semana esmaecido no painel; sem chama no fim de semana → Task 3 (`isWeekendYmd` + StreakPanel + teste). ✅
- Sem schema/migration; tsc + suíte → Task 4. ✅
- Feriados fora de escopo → respeitado (só dia da semana). ✅

**Placeholder scan:** Sem TBD/TODO; todo passo tem código/comando concreto. ✅

**Type consistency:** `isBusinessDay`/`prevBusinessDay`/`nextBusinessDay` (Task 1) usados com as mesmas assinaturas no service (Task 2). `getStreakSummary(userId, todayYmd?)` consumido pelas rotas existentes sem o 2º arg (default) — compatível. `isWeekendYmd` (Task 3) consumido no painel com o mesmo nome. DTOs inalterados. ✅

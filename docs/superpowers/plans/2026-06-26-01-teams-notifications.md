# Espelhamento de notificações no Teams + lembretes de votação — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Espelhar toda notificação in-app no Teams (para quem tem `teamsWebhookUrl`) e enviar lembretes de votação (in-app + Teams) ao usuário que não votou — no ponto médio da janela e na última hora antes de encerrar.

**Architecture:** Generaliza o `teams-client.ts` (card genérico + sender reutilizável); o espelhamento é centralizado em `createNotification` (individuais) e `broadcastToActive` (broadcasts), best-effort. Um novo tick de scheduler (`vote-reminders.ts`), pendurado no `setInterval` horário existente, cria as notificações de lembrete — que herdam o espelhamento no Teams de graça.

**Tech Stack:** Fastify 4, Prisma 5, PostgreSQL, TypeScript ESM, Vitest. Backend `apps/api`; contrato em `packages/shared`.

## Global Constraints

- TypeScript **strict**, ESM puro (`"type": "module"`); seguir o padrão da camada vizinha (route fina, lógica no service).
- Mensagens voltadas ao usuário em **português** (pt-BR).
- Testes **Vitest** colocados ao lado do código (`*.test.ts`); a API testa contra **Postgres real** — `pnpm db:up` antes de rodar; `fileParallelism: false`; tabelas truncadas em `beforeEach`.
- **Nunca editar uma migration já aplicada** — gerar nova com `pnpm db:migrate`.
- Integração com Teams é **best-effort**: falha de rede/Teams nunca derruba a request nem o tick do scheduler.
- Ao mudar o formato de payload compartilhado, **alterar `@legends/shared` primeiro**.
- `APP_BASE_URL` default: `https://legends.eumedicoresidente.com.br` (sem barra final).
- Rodar `pnpm test` antes de concluir.

---

## Task 1: Helper de URL absoluta + generalização do `teams-client`

**Files:**
- Create: `apps/api/src/lib/app-url.ts`
- Create: `apps/api/src/lib/app-url.test.ts`
- Modify: `apps/api/src/lib/teams-client.ts`
- Modify: `apps/api/src/lib/teams-client.test.ts`
- Modify: `apps/api/src/scheduler/nudges.ts` (usar o novo helper em `loginUrl`)

**Interfaces:**
- Consumes: `process.env.APP_BASE_URL`.
- Produces:
  - `appBaseUrl(): string` — base sem barra final.
  - `absoluteUrl(path: string | null): string` — base + path relativo (base pura se `path` nulo).
  - `interface TeamsNotification { title: string; ctaUrl: string; ctaLabel: string }`
  - `buildNotificationCard(n: TeamsNotification): unknown`
  - `postTeamsCard(url: string, card: unknown): Promise<void>` (best-effort)
  - `postTeamsNotification(url: string, n: TeamsNotification): Promise<void>`
  - `postTeamsNudge` mantém a assinatura atual.

- [ ] **Step 1: Escrever o teste falho de `app-url`**

Create `apps/api/src/lib/app-url.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest'
import { appBaseUrl, absoluteUrl } from './app-url'

afterEach(() => vi.unstubAllEnvs())

describe('app-url', () => {
  it('appBaseUrl usa o default e remove barra final', () => {
    vi.stubEnv('APP_BASE_URL', 'https://exemplo.test/')
    expect(appBaseUrl()).toBe('https://exemplo.test')
  })

  it('absoluteUrl concatena path relativo à base', () => {
    vi.stubEnv('APP_BASE_URL', 'https://exemplo.test')
    expect(absoluteUrl('/perfil/123')).toBe('https://exemplo.test/perfil/123')
  })

  it('absoluteUrl com path nulo retorna a base', () => {
    vi.stubEnv('APP_BASE_URL', 'https://exemplo.test')
    expect(absoluteUrl(null)).toBe('https://exemplo.test')
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/lib/app-url.test.ts`
Expected: FAIL — `Cannot find module './app-url'`.

- [ ] **Step 3: Implementar `app-url.ts`**

Create `apps/api/src/lib/app-url.ts`:

```ts
const DEFAULT_APP_BASE_URL = 'https://legends.eumedicoresidente.com.br'

/** Base pública do app (sem barra final). Default em dev/prod sem env. */
export function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? DEFAULT_APP_BASE_URL).replace(/\/+$/, '')
}

/** Converte um path relativo (link de notificação) em URL absoluta. */
export function absoluteUrl(path: string | null): string {
  const base = appBaseUrl()
  if (!path) return base
  return path.startsWith('/') ? `${base}${path}` : `${base}/${path}`
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/lib/app-url.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Escrever os testes falhos do card genérico**

Append em `apps/api/src/lib/teams-client.test.ts` (e ajustar o import do topo para incluir os novos símbolos):

```ts
import {
  postTeamsNudge,
  buildStreakAtRiskCard,
  buildNotificationCard,
  postTeamsNotification,
  type TeamsNudgePayload,
} from './teams-client'
```

```ts
describe('buildNotificationCard', () => {
  it('monta o Adaptive Card com o título e o botão de CTA', () => {
    const card = buildNotificationCard({
      title: 'Fulano deixou um feedback pra você',
      ctaUrl: 'https://exemplo.test/perfil/1',
      ctaLabel: 'Abrir no Legends',
    }) as any
    expect(card.type).toBe('message')
    const content = card.attachments[0].content
    expect(content.type).toBe('AdaptiveCard')
    expect(JSON.stringify(content.body)).toContain('Fulano deixou um feedback')
    expect(content.actions[0]).toMatchObject({
      type: 'Action.OpenUrl',
      title: 'Abrir no Legends',
      url: 'https://exemplo.test/perfil/1',
    })
  })

  it('escapa caracteres que quebram markdown de link no título', () => {
    const card = buildNotificationCard({
      title: 'tens]te)',
      ctaUrl: 'https://exemplo.test/',
      ctaLabel: 'Abrir',
    }) as any
    const text = JSON.stringify(card.attachments[0].content.body)
    expect(text).not.toContain('tens]te)')
    expect(text).toContain('tens］te）')
  })
})

describe('postTeamsNotification', () => {
  it('faz POST do card genérico no corpo', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }))
    await postTeamsNotification('https://flow.example/x', {
      title: 'Oi',
      ctaUrl: 'https://exemplo.test/',
      ctaLabel: 'Abrir',
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)
    expect(body.attachments[0].content.actions[0].url).toBe('https://exemplo.test/')
  })

  it('engole erro de rede sem lançar', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('boom'))
    await expect(
      postTeamsNotification('https://flow.example/x', {
        title: 'Oi',
        ctaUrl: 'https://exemplo.test/',
        ctaLabel: 'Abrir',
      }),
    ).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/lib/teams-client.test.ts`
Expected: FAIL — `buildNotificationCard`/`postTeamsNotification` não exportados.

- [ ] **Step 7: Generalizar `teams-client.ts`**

Em `apps/api/src/lib/teams-client.ts`, adicionar a interface e as funções novas, e refatorar o sender para reutilizar `postTeamsCard`. Substituir a função `postTeamsNudge` (linhas 76-90) por:

```ts
export interface TeamsNotification {
  title: string
  /** URL absoluta que o botão de CTA abre. */
  ctaUrl: string
  ctaLabel: string
}

/** Adaptive Card genérico de notificação: título + botão de CTA. */
export function buildNotificationCard(n: TeamsNotification): unknown {
  const text = escapeAdaptiveText(n.title)
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            {
              type: 'Container',
              style: 'emphasis',
              bleed: true,
              items: [
                { type: 'TextBlock', size: 'Medium', weight: 'Bolder', text: '🔔 Legends', wrap: true },
              ],
            },
            { type: 'TextBlock', text, wrap: true },
          ],
          actions: [{ type: 'Action.OpenUrl', title: n.ctaLabel, url: n.ctaUrl }],
        },
      },
    ],
  }
}

/**
 * Sender HTTP genérico best-effort: posta um card já montado no fluxo Power
 * Automate da pessoa. Qualquer falha (rede, timeout, status != 2xx) é logada e
 * engolida — não derruba o chamador.
 */
export async function postTeamsCard(url: string, card: unknown): Promise<void> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(card),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) {
      console.error(`[teams-client] POST falhou com status ${res.status}`)
    }
  } catch (err) {
    console.error('[teams-client] POST lançou exceção', err)
  }
}

/** Posta o card de nudge de ofensiva (mantém a assinatura original). */
export async function postTeamsNudge(url: string, payload: TeamsNudgePayload): Promise<void> {
  await postTeamsCard(url, buildStreakAtRiskCard(payload))
}

/** Posta um card genérico de notificação. */
export async function postTeamsNotification(url: string, n: TeamsNotification): Promise<void> {
  await postTeamsCard(url, buildNotificationCard(n))
}
```

- [ ] **Step 8: Rodar os testes do `teams-client` e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/lib/teams-client.test.ts src/lib/app-url.test.ts`
Expected: PASS (todos, incluindo os antigos de `postTeamsNudge`/`buildStreakAtRiskCard`).

- [ ] **Step 9: Refatorar `nudges.ts` para usar `absoluteUrl` (DRY)**

Em `apps/api/src/scheduler/nudges.ts`, remover `DEFAULT_APP_BASE_URL` (linha 8) e a função `loginUrl` (linhas 10-14), e no topo importar o helper:

```ts
import { absoluteUrl } from '../lib/app-url'
```

Trocar a chamada `ctaUrl: loginUrl()` (linha 51) por:

```ts
ctaUrl: absoluteUrl('/login'),
```

- [ ] **Step 10: Rodar os testes do scheduler de nudges (regressão)**

Run: `pnpm db:up && pnpm --filter @legends/api exec vitest run src/scheduler/nudges.test.ts`
Expected: PASS (o teste `content.actions[0].url` continua casando `/login$`).

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/lib/app-url.ts apps/api/src/lib/app-url.test.ts apps/api/src/lib/teams-client.ts apps/api/src/lib/teams-client.test.ts apps/api/src/scheduler/nudges.ts
git commit -m "feat(teams): card genérico de notificação + helper de URL absoluta

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Novos tipos de notificação (contrato + migration)

**Files:**
- Modify: `apps/api/prisma/schema.prisma:247-256` (enum `NotificationType`)
- Create: `apps/api/prisma/migrations/<timestamp>_add_vote_reminder_notification_types/migration.sql` (gerado)
- Modify: `packages/shared/src/notification.ts:1-10`

**Interfaces:**
- Produces: enum/union com `VOTE_REMINDER_MIDWAY` e `VOTE_REMINDER_CLOSING` disponíveis para Prisma Client e `@legends/shared`.

- [ ] **Step 1: Adicionar os valores ao enum no schema Prisma**

Em `apps/api/prisma/schema.prisma`, no enum `NotificationType` (após `STREAK_AT_RISK`):

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
  VOTE_REMINDER_MIDWAY
  VOTE_REMINDER_CLOSING
}
```

- [ ] **Step 2: Gerar e aplicar a migration**

Run: `pnpm db:up && pnpm db:migrate --name add_vote_reminder_notification_types`
Expected: cria nova pasta de migration com `ALTER TYPE "NotificationType" ADD VALUE ...` e regenera o Prisma Client sem erro.

- [ ] **Step 3: Atualizar o contrato compartilhado**

Em `packages/shared/src/notification.ts`, acrescentar os dois tipos ao array `NOTIFICATION_TYPES`:

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
  'VOTE_REMINDER_MIDWAY',
  'VOTE_REMINDER_CLOSING',
] as const
```

- [ ] **Step 4: Typecheck dos dois workspaces**

Run: `pnpm --filter @legends/shared exec tsc --noEmit && pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros (o Prisma Client já reconhece os novos valores do enum).

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations packages/shared/src/notification.ts
git commit -m "feat(notifications): tipos VOTE_REMINDER_MIDWAY/CLOSING (enum + shared)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Espelhar notificações no Teams (notification-service)

**Files:**
- Modify: `apps/api/src/services/notification-service.ts` (`createNotification`, `broadcastToActive`)
- Create: `apps/api/src/services/notification-service.test.ts`

**Interfaces:**
- Consumes: `postTeamsNotification` e `absoluteUrl` (Task 1).
- Produces: comportamento — toda notificação criada (individual ou broadcast) gera um POST ao Teams para usuários com `teamsWebhookUrl`. `createNotification` mantém a assinatura atual.

- [ ] **Step 1: Escrever os testes falhos do mirroring**

Create `apps/api/src/services/notification-service.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { prisma } from '../lib/prisma'
import { createNotification, notifyPeriodOpened } from './notification-service'

let counter = 0
async function makeUser(opts: { teamsWebhookUrl?: string | null; active?: boolean } = {}) {
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

function fetchSpyOk() {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
}

afterEach(() => vi.restoreAllMocks())

describe('createNotification — espelhamento no Teams', () => {
  it('posta no Teams quando o usuário tem teamsWebhookUrl', async () => {
    const fetchSpy = fetchSpyOk()
    const u = await makeUser({ teamsWebhookUrl: 'https://flow.example/u' })

    await createNotification({ userId: u.id, type: 'FEEDBACK_RECEIVED', title: 'Oi', link: `/perfil/${u.id}` })

    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://flow.example/u')
    const body = JSON.parse(init?.body as string)
    expect(body.attachments[0].content.actions[0].url).toMatch(new RegExp(`/perfil/${u.id}$`))
  })

  it('NÃO posta no Teams quando não há teamsWebhookUrl', async () => {
    const fetchSpy = fetchSpyOk()
    const u = await makeUser({ teamsWebhookUrl: null })
    await createNotification({ userId: u.id, type: 'FEEDBACK_RECEIVED', title: 'Oi' })
    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('falha no Teams não impede a gravação da notificação', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('boom'))
    const u = await makeUser({ teamsWebhookUrl: 'https://flow.example/u' })
    await expect(
      createNotification({ userId: u.id, type: 'FEEDBACK_RECEIVED', title: 'Oi' }),
    ).resolves.toBeUndefined()
    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(1)
  })
})

describe('broadcastToActive — espelhamento no Teams', () => {
  it('posta no Teams só para os ativos com webhook', async () => {
    const fetchSpy = fetchSpyOk()
    const comUrl = await makeUser({ teamsWebhookUrl: 'https://flow.example/a' })
    const semUrl = await makeUser({ teamsWebhookUrl: null })

    await notifyPeriodOpened({ monthRef: '2026-06' })

    // notificação in-app para ambos
    expect(await prisma.notification.count({ where: { userId: comUrl.id } })).toBe(1)
    expect(await prisma.notification.count({ where: { userId: semUrl.id } })).toBe(1)
    // Teams só para quem tem URL
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0][0]).toBe('https://flow.example/a')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm db:up && pnpm --filter @legends/api exec vitest run src/services/notification-service.test.ts`
Expected: FAIL — `fetch` não é chamado (mirroring ainda não existe).

- [ ] **Step 3: Implementar o mirroring em `createNotification`**

Em `apps/api/src/services/notification-service.ts`, adicionar os imports no topo:

```ts
import { postTeamsNotification } from '../lib/teams-client'
import { absoluteUrl } from '../lib/app-url'
```

Substituir a função `createNotification` (linhas 19-34) por:

```ts
/** Insere uma notificação e expurga, do mesmo usuário, as além da retenção. */
export async function createNotification(input: CreateNotificationInput): Promise<void> {
  const cutoff = new Date(Date.now() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  await prisma.$transaction([
    prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        actorId: input.actorId ?? null,
        link: input.link ?? null,
        metadata: input.metadata,
      },
    }),
    prisma.notification.deleteMany({ where: { userId: input.userId, createdAt: { lt: cutoff } } }),
  ])
  await mirrorToTeams(input.userId, input.title, input.link ?? null)
}

/**
 * Espelha uma notificação no Teams (DM via webhook do usuário), best-effort.
 * Qualquer falha é logada e engolida — nunca derruba a criação da notificação.
 */
async function mirrorToTeams(userId: string, title: string, link: string | null): Promise<void> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { teamsWebhookUrl: true },
    })
    if (!user?.teamsWebhookUrl) return
    await postTeamsNotification(user.teamsWebhookUrl, {
      title,
      ctaUrl: absoluteUrl(link),
      ctaLabel: 'Abrir no Legends',
    })
  } catch (err) {
    console.error(`[notification-service] falha ao espelhar no Teams (user ${userId})`, err)
  }
}
```

- [ ] **Step 4: Implementar o mirroring em `broadcastToActive`**

Substituir a função `broadcastToActive` (linhas 100-110) por:

```ts
async function broadcastToActive(
  type: Prisma.NotificationCreateInput['type'],
  title: string,
  link: string | null = null,
): Promise<void> {
  const users = await prisma.user.findMany({
    where: { active: true },
    select: { id: true, teamsWebhookUrl: true },
  })
  const cutoff = new Date(Date.now() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000)
  await prisma.$transaction([
    prisma.notification.createMany({ data: users.map((u) => ({ userId: u.id, type, title, link })) }),
    prisma.notification.deleteMany({ where: { userId: { in: users.map((u) => u.id) }, createdAt: { lt: cutoff } } }),
  ])
  const ctaUrl = absoluteUrl(link)
  for (const user of users) {
    if (!user.teamsWebhookUrl) continue
    await postTeamsNotification(user.teamsWebhookUrl, { title, ctaUrl, ctaLabel: 'Abrir no Legends' })
  }
}
```

> Nota: `createMany` agora grava `link` (antes era sempre nulo nos broadcasts). `notifyPeriodOpened`/`notifyPeriodClosed` seguem chamando `broadcastToActive` sem `link`, então o comportamento in-app não muda.

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/services/notification-service.test.ts`
Expected: PASS (todos).

- [ ] **Step 6: Rodar a suíte da API (regressão de notificações/feedback/retro/admin)**

Run: `pnpm --filter @legends/api test`
Expected: PASS. Atenção a testes de feedback/retro/admin que contam chamadas a `fetch` — não devem existir webhooks nos fixtures, então `fetch` não é chamado.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/notification-service.ts apps/api/src/services/notification-service.test.ts
git commit -m "feat(notifications): espelhar notificações no Teams (individuais e broadcast)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Lembretes de votação (scheduler)

**Files:**
- Create: `apps/api/src/scheduler/vote-reminders.ts`
- Create: `apps/api/src/scheduler/vote-reminders.test.ts`
- Modify: `apps/api/src/scheduler/nudges.ts` (`startNudgeScheduler` chama os dois ticks)

**Interfaces:**
- Consumes: `getCurrentOpenPeriod(now)` de `../services/voting-service`; `createNotification` (Task 3, que espelha no Teams); `monthLabel` de `../lib/month-label`.
- Produces: `runVoteReminderTick(now: Date): Promise<void>`.

- [ ] **Step 1: Escrever os testes falhos do tick de lembretes**

Create `apps/api/src/scheduler/vote-reminders.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { prisma } from '../lib/prisma'
import { runVoteReminderTick } from './vote-reminders'

// Janela de 48h: 01/06 00:00Z → 03/06 00:00Z.
// midpoint = 02/06 00:00Z; closingStart (endsAt-1h) = 02/06 23:00Z.
const START = new Date('2026-06-01T00:00:00.000Z')
const END = new Date('2026-06-03T00:00:00.000Z')
const BEFORE_MID = new Date('2026-06-01T06:00:00.000Z')
const MIDWAY = new Date('2026-06-02T06:00:00.000Z')
const CLOSING = new Date('2026-06-02T23:30:00.000Z')

let counter = 0
async function makeUser(opts: { active?: boolean; role?: 'USER' | 'ADMIN' } = {}) {
  counter += 1
  return prisma.user.create({
    data: {
      name: `Dev ${counter}`,
      email: `dev-${counter}@empresa.com`,
      passwordHash: 'x',
      active: opts.active ?? true,
      role: opts.role ?? 'USER',
    },
  })
}

async function makeOpenPeriod() {
  return prisma.votingPeriod.create({
    data: { monthRef: '2026-06', startsAt: START, endsAt: END, status: 'OPEN' },
  })
}

async function castVote(voterId: string, periodId: string, votedId: string) {
  return prisma.vote.create({
    data: { voterId, votedId, periodId, justification: 'parabéns pelo trabalho excelente' },
  })
}

afterEach(() => vi.restoreAllMocks())

describe('runVoteReminderTick', () => {
  it('no ponto médio, notifica quem não votou (MIDWAY)', async () => {
    await makeOpenPeriod()
    const u = await makeUser()
    await runVoteReminderTick(MIDWAY)
    const notifs = await prisma.notification.findMany({ where: { userId: u.id } })
    expect(notifs).toHaveLength(1)
    expect(notifs[0].type).toBe('VOTE_REMINDER_MIDWAY')
    expect(notifs[0].link).toBe('/')
  })

  it('na última hora, notifica quem não votou (CLOSING)', async () => {
    await makeOpenPeriod()
    const u = await makeUser()
    await runVoteReminderTick(CLOSING)
    const notifs = await prisma.notification.findMany({ where: { userId: u.id } })
    expect(notifs).toHaveLength(1)
    expect(notifs[0].type).toBe('VOTE_REMINDER_CLOSING')
  })

  it('não notifica quem já votou no período', async () => {
    const period = await makeOpenPeriod()
    const u = await makeUser()
    const colega = await makeUser()
    await castVote(u.id, period.id, colega.id)
    await runVoteReminderTick(MIDWAY)
    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(0)
  })

  it('é idempotente: segundo tick no mesmo marco não duplica', async () => {
    await makeOpenPeriod()
    const u = await makeUser()
    await runVoteReminderTick(MIDWAY)
    await runVoteReminderTick(MIDWAY)
    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(1)
  })

  it('não notifica ADMIN', async () => {
    await makeOpenPeriod()
    const admin = await makeUser({ role: 'ADMIN' })
    await runVoteReminderTick(MIDWAY)
    expect(await prisma.notification.count({ where: { userId: admin.id } })).toBe(0)
  })

  it('não notifica usuário inativo', async () => {
    await makeOpenPeriod()
    const u = await makeUser({ active: false })
    await runVoteReminderTick(MIDWAY)
    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(0)
  })

  it('no-op antes do ponto médio', async () => {
    await makeOpenPeriod()
    const u = await makeUser()
    await runVoteReminderTick(BEFORE_MID)
    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(0)
  })

  it('no-op quando não há período ativo', async () => {
    const u = await makeUser()
    await runVoteReminderTick(MIDWAY)
    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(0)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm db:up && pnpm --filter @legends/api exec vitest run src/scheduler/vote-reminders.test.ts`
Expected: FAIL — `Cannot find module './vote-reminders'`.

- [ ] **Step 3: Implementar `vote-reminders.ts`**

Create `apps/api/src/scheduler/vote-reminders.ts`:

```ts
import type { VotingPeriod } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { getCurrentOpenPeriod } from '../services/voting-service'
import { createNotification } from '../services/notification-service'
import { monthLabel } from '../lib/month-label'

const ONE_HOUR_MS = 60 * 60 * 1000

type Marco = 'MIDWAY' | 'CLOSING'

/**
 * Marco do lembrete neste tick, ou null. CLOSING tem prioridade (cobre o caso
 * de janelas muito curtas em que o ponto médio cai na última hora).
 */
function marcoFor(now: Date, period: VotingPeriod): Marco | null {
  const start = period.startsAt.getTime()
  const end = period.endsAt.getTime()
  const t = now.getTime()
  const midpoint = start + (end - start) / 2
  const closingStart = end - ONE_HOUR_MS
  if (t >= closingStart && t < end) return 'CLOSING'
  if (t >= midpoint && t < closingStart) return 'MIDWAY'
  return null
}

/**
 * Um tick de lembrete de votação. `now` é injetável (testável sem timers).
 * No ponto médio da janela e na última hora antes do fim, notifica cada usuário
 * ativo não-ADMIN que ainda não votou. Idempotente por marco/período (corte por
 * `period.startsAt` — só há um período ativo por vez). O Teams é espelhado pelo
 * próprio `createNotification`.
 */
export async function runVoteReminderTick(now: Date): Promise<void> {
  const period = await getCurrentOpenPeriod(now)
  if (!period) return

  const marco = marcoFor(now, period)
  if (!marco) return

  const type = marco === 'MIDWAY' ? 'VOTE_REMINDER_MIDWAY' : 'VOTE_REMINDER_CLOSING'
  const mes = monthLabel(period.monthRef)
  const title =
    marco === 'MIDWAY'
      ? `A votação de ${mes} está na metade e você ainda não votou. Reconheça um colega!`
      : `Última hora pra votar em ${mes} — não deixe pra depois!`

  const users = await prisma.user.findMany({
    where: { active: true, role: { not: 'ADMIN' } },
    select: { id: true },
  })

  for (const user of users) {
    try {
      const voted = await prisma.vote.findFirst({
        where: { voterId: user.id, periodId: period.id },
        select: { id: true },
      })
      if (voted) continue

      const already = await prisma.notification.findFirst({
        where: { userId: user.id, type, createdAt: { gte: period.startsAt } },
      })
      if (already) continue

      await createNotification({ userId: user.id, type, title, link: '/', metadata: { periodId: period.id } })
    } catch (err) {
      console.error(`[vote-reminders] falha ao processar usuário ${user.id}`, err)
    }
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/scheduler/vote-reminders.test.ts`
Expected: PASS (8 testes).

- [ ] **Step 5: Pendurar o tick no scheduler horário**

Em `apps/api/src/scheduler/nudges.ts`, importar o novo tick no topo:

```ts
import { runVoteReminderTick } from './vote-reminders'
```

Substituir o corpo de `startNudgeScheduler` (linhas 66-71) por:

```ts
export function startNudgeScheduler(): void {
  if (process.env.NODE_ENV === 'test') return
  setInterval(() => {
    runNudgeTick(new Date()).catch((err) => console.error('[nudges] tick falhou', err))
    runVoteReminderTick(new Date()).catch((err) => console.error('[vote-reminders] tick falhou', err))
  }, ONE_HOUR_MS)
}
```

- [ ] **Step 6: Typecheck + suíte completa da API**

Run: `pnpm --filter @legends/api exec tsc --noEmit && pnpm --filter @legends/api test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/scheduler/vote-reminders.ts apps/api/src/scheduler/vote-reminders.test.ts apps/api/src/scheduler/nudges.ts
git commit -m "feat(notifications): lembretes de votação (ponto médio e última hora)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Verificação final

- [ ] **Suíte completa do monorepo**

Run: `pnpm db:up && pnpm test`
Expected: PASS em todos os workspaces.

- [ ] **Typecheck dos workspaces tocados**

Run: `pnpm --filter @legends/shared exec tsc --noEmit && pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros.

## Notas de cobertura (self-review)

- **Espelhamento de todas as notificações** → Task 3 (individuais via `createNotification`; broadcasts via `broadcastToActive`). Todos os `notify*` existentes passam por um desses dois caminhos.
- **Lembrete no ponto médio + última hora, só para quem não votou, idempotente, sem ADMIN** → Task 4.
- **Card genérico + URL absoluta** → Task 1.
- **Contrato/enum/migration** → Task 2.
- **Best-effort em todos os pontos de Teams** → `postTeamsCard` engole erros (Task 1); `mirrorToTeams` e o loop de broadcast têm try/catch (Task 3); o loop do tick tem try/catch por usuário (Task 4).

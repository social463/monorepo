# Campanhas de comunicação com IA — plano de implementação

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: use
> `superpowers:subagent-driven-development` (recomendado) ou
> `superpowers:executing-plans` para executar tarefa a tarefa. Os passos usam
> checkbox (`- [ ]`) para acompanhamento.

**Spec:** `docs/superpowers/specs/2026-08-01-campanhas-comunicacao-design.md`

**Goal:** Dar ao time de Gente e Gestão um calendário editorial: gerar N
rascunhos de comunicado com IA a partir de tema/janela/público, revisar em
preview editável, agendar com responsável e publicar no Mural da empresa.

**Architecture:** Contrato primeiro em `@legends/shared`; dois models novos
tenant-scoped (`Campaign`, `CampaignPost`); duas libs puras (grade de datas e
prompt/parser) testáveis sem rede; um service com a regra de negócio; rotas finas
sob `requireSectorFeature('gente-gestao')`; uma tela de admin com abas Calendário
e Gerar.

**Tech Stack:** Fastify 4, Prisma 5, PostgreSQL, Zod, Vitest, React 18, React
Query, Tailwind 3, `@google/genai` (via `requestAgentCompletion`).

## Global Constraints

- Fluxo **route → service → Prisma**. Rota fina: `safeParse` → `400 { message, issues }`,
  chama o service, serializa com `lib/serialize.ts`. Regra de negócio só no service.
- Todo model novo tem `companyId` + índice; **toda** leitura/escrita passa por
  `scopedPrisma(companyId)` (`apps/api/src/lib/tenant-scope.ts`).
- Toda mutação de admin grava `recordAuditLog` (`services/audit-log-service.ts`),
  **dentro da mesma transação** quando houver.
- Migration nova via `pnpm db:migrate`. **Nunca** editar migration já aplicada.
- Erro de domínio é classe tipada com `status`; a rota faz `instanceof` e
  responde `err.status`. Erro inesperado sobe.
- Textos ao usuário em **português**. TypeScript strict, ESM.
- Testes Vitest ao lado do arquivo. API contra Postgres real:
  Postgres **isolado deste worktree**, container `legends-db-fulmar` na porta
  **5482**. `apps/api/.env` já aponta para lá, e os testes precisam de
  **`LEGENDS_DB_PORT=5482`**. Não use 5432 (`legends-db`) nem 5442
  (`sandlance`): o 5432 tem migration de outra branch aplicada, e rodar vitest
  em banco de outro worktree colide no mesmo `legends_test`, produzindo
  centenas de falhas fantasma nos dois lados.

  Subir de novo, se o container sumir:
  `docker run -d --name legends-db-fulmar -p 5482:5432 -e POSTGRES_USER=legends -e POSTGRES_PASSWORD=legends -e POSTGRES_DB=legends postgres:16-alpine`
  seguido de `pnpm --filter @legends/api exec prisma migrate deploy`.
- Guarda de todas as rotas: `onRequest: [app.authenticate, app.requireSectorFeature('gente-gestao')]`.
  Nunca `requireAdminOrSubadmin`, nunca `requireFeature`.
- Chave Gemini **por empresa** via `resolveGeminiCredentials(companyId)`.
  Nunca `process.env.GEMINI_API_KEY`.
- `CAMPAIGN_BODY_MAX_LENGTH === CORPORATE_POST_MAX_LENGTH` (280).

## Estrutura de arquivos

**Criar**

| Arquivo | Responsabilidade |
|---|---|
| `packages/shared/src/campaign.ts` | contrato: constantes, enums, DTOs |
| `packages/shared/src/campaign.test.ts` | trava o acoplamento dos 280 |
| `apps/api/src/lib/campaign-error.ts` | `CampaignError` |
| `apps/api/src/lib/campaign-schedule.ts` | grade de datas (puro) |
| `apps/api/src/lib/campaign-schedule.test.ts` | |
| `apps/api/src/lib/campaign-prompt.ts` | prompt + parser Zod (puro) |
| `apps/api/src/lib/campaign-prompt.test.ts` | |
| `apps/api/src/services/campaign-service.ts` | regra de negócio |
| `apps/api/src/services/campaign-service.test.ts` | |
| `apps/api/src/routes/campaigns.ts` | endpoints |
| `apps/api/src/routes/campaigns.test.ts` | |
| `apps/web/src/lib/campaign-api.ts` | cliente HTTP |
| `apps/web/src/pages/admin/CampaignsSection.tsx` | casca + abas |
| `apps/web/src/pages/admin/CampaignCalendar.tsx` | grade de mês + painel |
| `apps/web/src/pages/admin/CampaignGenerator.tsx` | formulário + preview |
| `apps/web/src/pages/admin/CampaignsSection.test.tsx` | |

**Modificar**

| Arquivo | Mudança |
|---|---|
| `packages/shared/src/index.ts` | exportar `./campaign.js` |
| `apps/api/prisma/schema.prisma` | 3 enums + 2 models + back-relations |
| `apps/api/src/lib/tenant-scope.ts` | `'Campaign'`, `'CampaignPost'` |
| `apps/api/src/lib/serialize.ts` | `toCampaignPostDTO` |
| `apps/api/src/services/corporate-mural-service.ts` | `createPost` ganha `tx?` |
| `apps/api/src/app.ts` | `app.register(campaignRoutes)` |
| `apps/web/src/App.tsx` | rota `/admin/campanhas` |
| `apps/web/src/pages/admin/AdminSidebar.tsx` | item do menu |

---

### Task 1: Contrato em `@legends/shared`

**Files:**
- Create: `packages/shared/src/campaign.ts`
- Create: `packages/shared/src/campaign.test.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: `CORPORATE_POST_MAX_LENGTH` de `./corporate-mural.js`
- Produces: `CAMPAIGN_QUANTITY_MIN/MAX`, `CAMPAIGN_TITLE_MAX_LENGTH`,
  `CAMPAIGN_BODY_MAX_LENGTH`, `CAMPAIGN_THEME_MAX_LENGTH`,
  `CAMPAIGN_NOTES_MAX_LENGTH`, `CAMPAIGN_VISUAL_HINT_MAX_LENGTH`,
  `CAMPAIGN_AUDIENCES`/`CampaignAudience`, `CAMPAIGN_CHANNELS`/`CampaignChannel`,
  `CAMPAIGN_POST_STATUSES`/`CampaignPostStatus`, os três `*_LABELS`,
  `GenerateCampaignRequest`, `CampaignDraftDTO`, `CampaignPostDTO`,
  `ConfirmCampaignRequest`, `CreateCampaignPostRequest`,
  `UpdateCampaignPostRequest`

- [ ] **Step 1: Escrever o teste que falha**

`packages/shared/src/campaign.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CORPORATE_POST_MAX_LENGTH } from './corporate-mural.js'
import {
  CAMPAIGN_AUDIENCES,
  CAMPAIGN_AUDIENCE_LABELS,
  CAMPAIGN_BODY_MAX_LENGTH,
  CAMPAIGN_CHANNELS,
  CAMPAIGN_CHANNEL_LABELS,
  CAMPAIGN_POST_STATUSES,
  CAMPAIGN_POST_STATUS_LABELS,
  CAMPAIGN_QUANTITY_MAX,
  CAMPAIGN_QUANTITY_MIN,
} from './campaign.js'

describe('contrato de campanhas', () => {
  // O item agendado precisa caber no post do mural — se estes dois números
  // divergirem, existe rascunho que nunca consegue ser publicado.
  it('amarra o corpo ao limite do mural', () => {
    expect(CAMPAIGN_BODY_MAX_LENGTH).toBe(CORPORATE_POST_MAX_LENGTH)
  })

  it('mantém a quantidade entre 1 e 20', () => {
    expect(CAMPAIGN_QUANTITY_MIN).toBe(1)
    expect(CAMPAIGN_QUANTITY_MAX).toBe(20)
  })

  it('tem rótulo em português para todo valor de enum', () => {
    for (const a of CAMPAIGN_AUDIENCES) expect(CAMPAIGN_AUDIENCE_LABELS[a]).toBeTruthy()
    for (const c of CAMPAIGN_CHANNELS) expect(CAMPAIGN_CHANNEL_LABELS[c]).toBeTruthy()
    for (const s of CAMPAIGN_POST_STATUSES) expect(CAMPAIGN_POST_STATUS_LABELS[s]).toBeTruthy()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/shared exec vitest run src/campaign.test.ts`
Expected: FAIL — `Failed to resolve import "./campaign.js"`

- [ ] **Step 3: Escrever o contrato**

`packages/shared/src/campaign.ts`:

```ts
import { CORPORATE_POST_MAX_LENGTH } from './corporate-mural.js'

export const CAMPAIGN_QUANTITY_MIN = 1
export const CAMPAIGN_QUANTITY_MAX = 20
export const CAMPAIGN_THEME_MAX_LENGTH = 200
export const CAMPAIGN_NOTES_MAX_LENGTH = 1000
export const CAMPAIGN_TITLE_MAX_LENGTH = 120
export const CAMPAIGN_VISUAL_HINT_MAX_LENGTH = 200

/**
 * Derivado, não copiado: o corpo do comunicado vira o `content` de um
 * `CorporatePost`, então um limite maior geraria rascunho impossível de publicar.
 */
export const CAMPAIGN_BODY_MAX_LENGTH = CORPORATE_POST_MAX_LENGTH

export const CAMPAIGN_AUDIENCES = ['ALL', 'LEADERSHIP'] as const
export type CampaignAudience = (typeof CAMPAIGN_AUDIENCES)[number]

export const CAMPAIGN_CHANNELS = ['MURAL', 'TEAMS', 'EMAIL'] as const
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number]

export const CAMPAIGN_POST_STATUSES = ['SCHEDULED', 'PUBLISHED', 'CANCELLED'] as const
export type CampaignPostStatus = (typeof CAMPAIGN_POST_STATUSES)[number]

export const CAMPAIGN_AUDIENCE_LABELS: Record<CampaignAudience, string> = {
  ALL: 'Todos',
  LEADERSHIP: 'Liderança',
}

export const CAMPAIGN_CHANNEL_LABELS: Record<CampaignChannel, string> = {
  MURAL: 'Mural da empresa',
  TEAMS: 'Teams',
  EMAIL: 'E-mail',
}

export const CAMPAIGN_POST_STATUS_LABELS: Record<CampaignPostStatus, string> = {
  SCHEDULED: 'Agendado',
  PUBLISHED: 'Publicado',
  CANCELLED: 'Cancelado',
}

/** Canais cuja entrega hoje é manual — o Legends registra, não dispara. */
export const CAMPAIGN_MANUAL_DELIVERY_CHANNELS: readonly CampaignChannel[] = ['TEAMS', 'EMAIL']

export interface GenerateCampaignRequest {
  theme: string
  /** ISO 8601. */
  startsAt: string
  endsAt: string
  audience: CampaignAudience
  channel: CampaignChannel
  quantity: number
  notes?: string
}

/** Rascunho proposto pela IA. Ainda não existe no banco. */
export interface CampaignDraftDTO {
  title: string
  body: string
  visualHint: string | null
  /** Vem da grade calculada no servidor, nunca do modelo. */
  scheduledFor: string
}

export interface CampaignPostDTO {
  id: string
  campaignId: string | null
  campaignTheme: string | null
  title: string
  body: string
  visualHint: string | null
  scheduledFor: string
  channel: CampaignChannel
  audience: CampaignAudience
  status: CampaignPostStatus
  responsibleId: string | null
  responsibleName: string | null
  publishedPostId: string | null
  publishedAt: string | null
  createdAt: string
}

export interface ConfirmCampaignPostInput {
  title: string
  body: string
  visualHint?: string | null
  scheduledFor: string
  channel: CampaignChannel
  responsibleId?: string | null
}

export interface ConfirmCampaignRequest {
  theme: string
  startsAt: string
  endsAt: string
  audience: CampaignAudience
  notes?: string
  posts: ConfirmCampaignPostInput[]
}

export interface CreateCampaignPostRequest {
  title: string
  body: string
  visualHint?: string | null
  scheduledFor: string
  channel: CampaignChannel
  audience: CampaignAudience
  responsibleId?: string | null
}

export interface UpdateCampaignPostRequest {
  title?: string
  body?: string
  visualHint?: string | null
  scheduledFor?: string
  channel?: CampaignChannel
  audience?: CampaignAudience
  responsibleId?: string | null
}
```

- [ ] **Step 4: Exportar no barril**

Em `packages/shared/src/index.ts`, junto das outras linhas `export *`:

```ts
export * from './campaign.js'
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @legends/shared exec vitest run src/campaign.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/campaign.ts packages/shared/src/campaign.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): contrato de campanhas de comunicação"
```

---

### Task 2: Models Prisma e migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `apps/api/src/lib/tenant-scope.ts`

**Interfaces:**
- Produces: models `Campaign`, `CampaignPost`; enums `CampaignAudience`,
  `CampaignChannel`, `CampaignPostStatus`; `prisma.campaign`,
  `prisma.campaignPost` no client gerado.

- [ ] **Step 1: Adicionar enums e models**

No fim de `apps/api/prisma/schema.prisma`:

```prisma
enum CampaignAudience {
  ALL
  LEADERSHIP
}

enum CampaignChannel {
  MURAL
  TEAMS
  EMAIL
}

enum CampaignPostStatus {
  SCHEDULED
  PUBLISHED
  CANCELLED
}

/// Campanha de comunicação: o guarda-chuva editorial (tema + janela) sob o qual
/// nascem N comunicados agendados.
model Campaign {
  id          String           @id @default(cuid())
  theme       String
  startsAt    DateTime
  endsAt      DateTime
  audience    CampaignAudience
  notes       String?
  createdById String
  companyId   String
  createdAt   DateTime         @default(now())

  createdBy User           @relation("CampaignsCreated", fields: [createdById], references: [id], onDelete: Cascade)
  company   Company        @relation(fields: [companyId], references: [id])
  posts     CampaignPost[]

  @@index([companyId, createdAt])
}

/// Item do calendário editorial. `campaignId` é opcional de propósito: é o que
/// permite criar item na mão quando a IA está indisponível.
model CampaignPost {
  id              String             @id @default(cuid())
  campaignId      String?
  title           String
  body            String
  visualHint      String?
  scheduledFor    DateTime
  channel         CampaignChannel
  audience        CampaignAudience
  status          CampaignPostStatus @default(SCHEDULED)
  responsibleId   String?
  publishedPostId String?            @unique
  publishedAt     DateTime?
  companyId       String
  createdAt       DateTime           @default(now())
  updatedAt       DateTime           @updatedAt

  campaign      Campaign?      @relation(fields: [campaignId], references: [id], onDelete: SetNull)
  responsible   User?          @relation("CampaignPostsResponsible", fields: [responsibleId], references: [id], onDelete: SetNull)
  // SetNull: apagar o post do mural não pode derrubar o histórico editorial.
  publishedPost CorporatePost? @relation(fields: [publishedPostId], references: [id], onDelete: SetNull)
  company       Company        @relation(fields: [companyId], references: [id])

  @@index([companyId, scheduledFor])
  @@index([companyId, status])
}
```

- [ ] **Step 2: Adicionar as back-relations**

No model `User`, junto das outras relações:

```prisma
  campaignsCreated      Campaign[]     @relation("CampaignsCreated")
  campaignPostsAssigned CampaignPost[] @relation("CampaignPostsResponsible")
```

No model `Company`:

```prisma
  campaigns     Campaign[]
  campaignPosts CampaignPost[]
```

No model `CorporatePost` (linha ~1243, junto de `reads`):

```prisma
  campaignPost CampaignPost?
```

- [ ] **Step 3: Registrar no escopo de tenant**

Em `apps/api/src/lib/tenant-scope.ts`, dentro de `TENANT_SCOPED_MODELS`:

```ts
  'Campaign',
  'CampaignPost',
```

- [ ] **Step 4: Gerar a migration**

```bash
pnpm db:up
pnpm db:migrate --name campanhas_comunicacao
```

Expected: cria `apps/api/prisma/migrations/<timestamp>_campanhas_comunicacao/migration.sql`
e regenera o Prisma Client. Conferir que o SQL cria os 3 tipos enum, as 2 tabelas
e os 4 índices — e que **não** altera nenhuma tabela existente além de adicionar
a FK de `CampaignPost.publishedPostId`.

- [ ] **Step 5: Verificar que o client compila**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma apps/api/src/lib/tenant-scope.ts
git commit -m "feat(api): models Campaign e CampaignPost"
```

---

### Task 3: `CampaignError` e a grade de datas

**Files:**
- Create: `apps/api/src/lib/campaign-error.ts`
- Create: `apps/api/src/lib/campaign-schedule.ts`
- Create: `apps/api/src/lib/campaign-schedule.test.ts`

**Interfaces:**
- Consumes: `saoPauloMidnightUtc`, `ymdInSaoPaulo`, `addDays` de `./sao-paulo-date.js`
- Produces:
  - `class CampaignError extends Error { constructor(message: string, status: number) }`
  - `CAMPAIGN_SLOT_HOURS: readonly [9, 11, 14, 16]`
  - `buildScheduleSlots(input: { startsAt: Date; endsAt: Date; quantity: number }): Date[]`

- [ ] **Step 1: Escrever o teste que falha**

`apps/api/src/lib/campaign-schedule.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CampaignError } from './campaign-error'
import { buildScheduleSlots } from './campaign-schedule'

// 2026-09-01T12:00Z é 09:00 em São Paulo (UTC-3, sem horário de verão).
const inicio = new Date('2026-09-01T03:00:00.000Z')
const fim = new Date('2026-09-10T03:00:00.000Z')

describe('grade de datas da campanha', () => {
  it('devolve exatamente a quantidade pedida, em ordem crescente', () => {
    const slots = buildScheduleSlots({ startsAt: inicio, endsAt: fim, quantity: 4 })
    expect(slots).toHaveLength(4)
    const ordenados = [...slots].sort((a, b) => a.getTime() - b.getTime())
    expect(slots).toEqual(ordenados)
  })

  it('mantém toda a grade dentro da janela', () => {
    const slots = buildScheduleSlots({ startsAt: inicio, endsAt: fim, quantity: 7 })
    for (const slot of slots) {
      expect(slot.getTime()).toBeGreaterThanOrEqual(new Date('2026-09-01T00:00:00.000Z').getTime())
      expect(slot.getTime()).toBeLessThanOrEqual(new Date('2026-09-11T00:00:00.000Z').getTime())
    }
  })

  it('usa o primeiro dia às 09:00 de São Paulo quando pede um só', () => {
    const slots = buildScheduleSlots({ startsAt: inicio, endsAt: fim, quantity: 1 })
    expect(slots[0].toISOString()).toBe('2026-09-01T12:00:00.000Z')
  })

  it('empilha horários distintos quando há mais itens que dias', () => {
    const curto = new Date('2026-09-02T03:00:00.000Z')
    const slots = buildScheduleSlots({ startsAt: inicio, endsAt: curto, quantity: 4 })
    const iso = slots.map((s) => s.toISOString())
    expect(new Set(iso).size).toBe(4)
    expect(iso[0]).toBe('2026-09-01T12:00:00.000Z')
    expect(iso[1]).toBe('2026-09-01T14:00:00.000Z')
  })

  it('recusa quantidade que não cabe na janela', () => {
    expect(() => buildScheduleSlots({ startsAt: inicio, endsAt: inicio, quantity: 5 })).toThrow(CampaignError)
  })

  it('recusa janela invertida', () => {
    expect(() => buildScheduleSlots({ startsAt: fim, endsAt: inicio, quantity: 2 })).toThrow(CampaignError)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `LEGENDS_DB_PORT=5482 pnpm --filter @legends/api exec vitest run src/lib/campaign-schedule.test.ts`
Expected: FAIL — `Cannot find module './campaign-error'`

- [ ] **Step 3: Escrever `campaign-error.ts`**

```ts
/**
 * Erro de domínio das campanhas, no padrão `VoteError`/`AgentError`. Mora em
 * `lib/` porque tanto o parser da IA quanto o service o lançam — pô-lo num
 * service criaria ciclo de import.
 *
 * A `message` já nasce em português e voltada ao usuário: a rota devolve
 * `err.message` direto.
 */
export class CampaignError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'CampaignError'
  }
}
```

- [ ] **Step 4: Escrever `campaign-schedule.ts`**

```ts
import { addDays, saoPauloMidnightUtc, ymdInSaoPaulo } from './sao-paulo-date'
import { CampaignError } from './campaign-error'

/**
 * Horários de publicação dentro de um dia. Quatro é o teto deliberado: acima
 * disso a campanha vira spam, e empilhar comunicados no mesmo horário seria pior
 * do que pedir ao usuário para ampliar a janela.
 */
export const CAMPAIGN_SLOT_HOURS = [9, 11, 14, 16] as const

const HOUR_MS = 60 * 60 * 1000

function daysInWindow(startsAt: Date, endsAt: Date): string[] {
  const first = ymdInSaoPaulo(startsAt)
  const last = ymdInSaoPaulo(endsAt)
  const days: string[] = []
  let cursor = first
  while (cursor <= last) {
    days.push(cursor)
    cursor = addDays(cursor, 1)
  }
  return days
}

/** Escolhe `n` dias igualmente espaçados da lista, sempre incluindo o primeiro. */
function pickEvenly(days: string[], n: number): string[] {
  if (n === 1) return [days[0]]
  return Array.from({ length: n }, (_, i) => days[Math.round((i * (days.length - 1)) / (n - 1))])
}

function instantAt(ymd: string, hour: number): Date {
  return new Date(saoPauloMidnightUtc(ymd).getTime() + hour * HOUR_MS)
}

/**
 * Grade de datas da campanha. É o servidor que decide as datas — pedir ao modelo
 * que as distribua produz colisão e item fora da janela. Com a grade calculada
 * aqui, "todo rascunho dentro da janela" passa a ser garantia de construção.
 */
export function buildScheduleSlots(input: { startsAt: Date; endsAt: Date; quantity: number }): Date[] {
  const { startsAt, endsAt, quantity } = input
  if (endsAt.getTime() < startsAt.getTime()) {
    throw new CampaignError('A data final não pode ser anterior à data inicial.', 400)
  }
  const days = daysInWindow(startsAt, endsAt)
  const capacity = days.length * CAMPAIGN_SLOT_HOURS.length
  if (quantity > capacity) {
    throw new CampaignError(
      `A janela informada comporta no máximo ${capacity} comunicado(s). Reduza a quantidade ou amplie o período.`,
      400,
    )
  }

  if (quantity <= days.length) {
    return pickEvenly(days, quantity).map((ymd) => instantAt(ymd, CAMPAIGN_SLOT_HOURS[0]))
  }

  // Mais itens que dias: distribui o excedente nos primeiros dias, para a
  // campanha começar densa e afinar — e não o contrário.
  const base = Math.floor(quantity / days.length)
  const extra = quantity % days.length
  const slots: Date[] = []
  days.forEach((ymd, index) => {
    const count = base + (index < extra ? 1 : 0)
    for (let k = 0; k < count; k += 1) slots.push(instantAt(ymd, CAMPAIGN_SLOT_HOURS[k]))
  })
  return slots
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `LEGENDS_DB_PORT=5482 pnpm --filter @legends/api exec vitest run src/lib/campaign-schedule.test.ts`
Expected: PASS (6 testes)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/campaign-error.ts apps/api/src/lib/campaign-schedule.ts apps/api/src/lib/campaign-schedule.test.ts
git commit -m "feat(api): grade de datas e erro de domínio de campanhas"
```

---

### Task 4: Prompt puro e parser Zod

**Files:**
- Create: `apps/api/src/lib/campaign-prompt.ts`
- Create: `apps/api/src/lib/campaign-prompt.test.ts`

**Interfaces:**
- Consumes: `CampaignError` (Task 3), `CAMPAIGN_BODY_MAX_LENGTH`,
  `CAMPAIGN_TITLE_MAX_LENGTH`, `CAMPAIGN_VISUAL_HINT_MAX_LENGTH`,
  `CAMPAIGN_AUDIENCE_LABELS`, `CampaignAudience`, `CampaignDraftDTO`
- Produces:
  - `buildCampaignPrompt(input: CampaignPromptInput): string`
  - `parseCampaignDrafts(raw: string, slots: Date[]): CampaignDraftDTO[]`
  - `interface CampaignPromptInput { companyName: string; theme: string; audience: CampaignAudience; notes?: string | null; slots: Date[] }`

- [ ] **Step 1: Escrever o teste que falha**

`apps/api/src/lib/campaign-prompt.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CampaignError } from './campaign-error'
import { buildCampaignPrompt, parseCampaignDrafts } from './campaign-prompt'

const slots = [new Date('2026-09-01T12:00:00.000Z'), new Date('2026-09-03T12:00:00.000Z')]

const draftsValidos = JSON.stringify([
  { title: 'Semana da segurança', body: 'Começa hoje a semana da segurança.', visualHint: 'Capacete' },
  { title: 'Encerramento', body: 'Obrigado a todos que participaram.', visualHint: null },
])

describe('prompt da campanha', () => {
  it('monta o prompt com tema, público e datas', () => {
    const prompt = buildCampaignPrompt({
      companyName: 'EMR',
      theme: 'Semana da segurança',
      audience: 'ALL',
      notes: 'Citar a CIPA',
      slots,
    })
    expect(prompt).toMatchSnapshot()
  })

  it('informa o limite de caracteres do corpo', () => {
    const prompt = buildCampaignPrompt({ companyName: 'EMR', theme: 'X', audience: 'ALL', slots })
    expect(prompt).toContain('280')
  })
})

describe('parser dos rascunhos', () => {
  it('aceita JSON válido e carimba a data da grade', () => {
    const drafts = parseCampaignDrafts(draftsValidos, slots)
    expect(drafts).toHaveLength(2)
    expect(drafts[0]).toEqual({
      title: 'Semana da segurança',
      body: 'Começa hoje a semana da segurança.',
      visualHint: 'Capacete',
      scheduledFor: '2026-09-01T12:00:00.000Z',
    })
    expect(drafts[1].scheduledFor).toBe('2026-09-03T12:00:00.000Z')
  })

  it('aceita resposta embrulhada em cerca de markdown', () => {
    expect(parseCampaignDrafts('```json\n' + draftsValidos + '\n```', slots)).toHaveLength(2)
  })

  it('recusa quantidade diferente da pedida', () => {
    const um = JSON.stringify([{ title: 'A', body: 'B', visualHint: null }])
    expect(() => parseCampaignDrafts(um, slots)).toThrow(CampaignError)
  })

  it('recusa corpo acima do limite do mural', () => {
    const longo = JSON.stringify([
      { title: 'A', body: 'x'.repeat(281), visualHint: null },
      { title: 'B', body: 'ok', visualHint: null },
    ])
    expect(() => parseCampaignDrafts(longo, slots)).toThrow(CampaignError)
  })

  it('recusa JSON malformado', () => {
    expect(() => parseCampaignDrafts('desculpe, não consigo', slots)).toThrow(CampaignError)
  })

  it('nunca deixa passar um item pela metade', () => {
    const semCorpo = JSON.stringify([{ title: 'A', visualHint: null }, { title: 'B', body: 'ok' }])
    expect(() => parseCampaignDrafts(semCorpo, slots)).toThrow(CampaignError)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `LEGENDS_DB_PORT=5482 pnpm --filter @legends/api exec vitest run src/lib/campaign-prompt.test.ts`
Expected: FAIL — `Cannot find module './campaign-prompt'`

- [ ] **Step 3: Escrever `campaign-prompt.ts`**

```ts
import { z } from 'zod'
import {
  CAMPAIGN_AUDIENCE_LABELS,
  CAMPAIGN_BODY_MAX_LENGTH,
  CAMPAIGN_TITLE_MAX_LENGTH,
  CAMPAIGN_VISUAL_HINT_MAX_LENGTH,
  type CampaignAudience,
  type CampaignDraftDTO,
} from '@legends/shared'
import { CampaignError } from './campaign-error'

export interface CampaignPromptInput {
  companyName: string
  theme: string
  audience: CampaignAudience
  notes?: string | null
  /** Grade de `buildScheduleSlots` — o modelo recebe as datas prontas. */
  slots: Date[]
}

const dataFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  weekday: 'long',
  day: '2-digit',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
})

/**
 * Monta o prompt da campanha. Função pura (testável sem rede), no padrão de
 * `buildCongratsPrompt`. As datas entram como contexto para o modelo adequar o
 * texto ao dia — mas ele não devolve data nenhuma: quem carimba é o parser.
 */
export function buildCampaignPrompt(input: CampaignPromptInput): string {
  const agenda = input.slots
    .map((slot, index) => `${index + 1}. ${dataFormatter.format(slot)}`)
    .join('\n')

  return [
    `Você é o time de comunicação interna da empresa ${input.companyName}, escrevendo em português do Brasil.`,
    `Escreva ${input.slots.length} comunicado(s) para uma campanha sobre: ${input.theme}.`,
    `Público-alvo: ${CAMPAIGN_AUDIENCE_LABELS[input.audience]}.`,
    input.notes?.trim() ? `Observações do solicitante: ${input.notes.trim()}` : null,
    ``,
    `Cada comunicado será publicado em uma destas datas, nesta ordem:`,
    agenda,
    ``,
    `REGRAS`,
    `- Um comunicado por data, na mesma ordem da lista.`,
    `- O corpo tem no máximo ${CAMPAIGN_BODY_MAX_LENGTH} caracteres. Este limite é rígido.`,
    `- O título tem no máximo ${CAMPAIGN_TITLE_MAX_LENGTH} caracteres e é interno (não aparece no post).`,
    `- A campanha deve progredir: abertura, desenvolvimento e encerramento. Não repita o mesmo texto.`,
    `- Não invente número, data, nome de pessoa, benefício ou política que não esteja no tema.`,
    `- Tom caloroso e profissional. Sem markdown, sem emojis, sem aspas.`,
    ``,
    `FORMATO DA RESPOSTA`,
    `Responda APENAS com um array JSON, sem texto antes ou depois, com exatamente ${input.slots.length} objeto(s):`,
    `[{"title": "...", "body": "...", "visualHint": "sugestão de imagem em uma frase"}]`,
  ]
    .filter((line) => line !== null)
    .join('\n')
}

const draftSchema = z.object({
  title: z.string().trim().min(1).max(CAMPAIGN_TITLE_MAX_LENGTH),
  body: z.string().trim().min(1).max(CAMPAIGN_BODY_MAX_LENGTH),
  visualHint: z.string().trim().max(CAMPAIGN_VISUAL_HINT_MAX_LENGTH).nullish(),
})

/** Modelos costumam embrulhar JSON em cerca de markdown mesmo quando proibidos. */
function stripFence(raw: string): string {
  const trimmed = raw.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed)
  return fenced ? fenced[1] : trimmed
}

/**
 * Valida a resposta do modelo e carimba a data da grade por posição.
 *
 * Tudo que sai daqui é `CampaignError` com mensagem em português. Como o preview
 * não grava nada, uma resposta fora do schema não deixa item pela metade no
 * banco — a propriedade vem do desenho, não deste `try/catch`.
 */
export function parseCampaignDrafts(raw: string, slots: Date[]): CampaignDraftDTO[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripFence(raw))
  } catch {
    throw new CampaignError('A IA devolveu uma resposta que não consegui interpretar. Tente gerar de novo.', 502)
  }

  const result = z.array(draftSchema).safeParse(parsed)
  if (!result.success) {
    throw new CampaignError('A IA devolveu comunicados fora do formato esperado. Tente gerar de novo.', 502)
  }
  if (result.data.length !== slots.length) {
    throw new CampaignError(
      `Pedi ${slots.length} comunicado(s) e a IA devolveu ${result.data.length}. Tente gerar de novo.`,
      502,
    )
  }

  return result.data.map((draft, index) => ({
    title: draft.title,
    body: draft.body,
    visualHint: draft.visualHint ?? null,
    scheduledFor: slots[index].toISOString(),
  }))
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `LEGENDS_DB_PORT=5482 pnpm --filter @legends/api exec vitest run src/lib/campaign-prompt.test.ts`
Expected: PASS (8 testes). O snapshot é criado neste run — abra
`src/lib/__snapshots__/campaign-prompt.test.ts.snap` e confira que o prompt está
em português, cita as duas datas e o limite de 280.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/campaign-prompt.ts apps/api/src/lib/campaign-prompt.test.ts apps/api/src/lib/__snapshots__/campaign-prompt.test.ts.snap
git commit -m "feat(api): prompt e parser dos rascunhos de campanha"
```

---

### Task 5: `createPost` aceita transação

**Files:**
- Modify: `apps/api/src/services/corporate-mural-service.ts:122-164`

**Interfaces:**
- Produces: `createPost` ganha campo opcional `tx` no objeto de entrada.

Mudança isolada e pequena, mas com teste próprio: sem ela, a Task 8 publicaria o
post fora da transação que marca o item como publicado.

- [ ] **Step 1: Escrever o teste que falha**

Em `apps/api/src/services/corporate-mural-service.test.ts`, adicione ao fim:

```ts
describe('createPost dentro de transação', () => {
  it('desfaz o post quando a transação falha', async () => {
    const autor = await prisma.user.create({
      data: { name: 'Líder', email: 'lider-tx@empresa.com', passwordHash: 'x', role: 'ADMIN' },
    })

    await expect(
      scopedPrisma(autor.companyId).$transaction(async (tx) => {
        await createPost({
          authorId: autor.id,
          content: 'Comunicado transacional',
          companyId: autor.companyId,
          tx: tx as never,
        })
        throw new Error('falha proposital')
      }),
    ).rejects.toThrow('falha proposital')

    expect(await prisma.corporatePost.count()).toBe(0)
  })
})
```

Confirme que o arquivo já importa `prisma`, `scopedPrisma` e `createPost`; se
faltar `scopedPrisma`, adicione `import { scopedPrisma } from '../lib/tenant-scope'`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `LEGENDS_DB_PORT=5482 pnpm --filter @legends/api exec vitest run src/services/corporate-mural-service.test.ts -t "transação"`
Expected: FAIL — erro de tipo em `tx` (propriedade não existe) ou `count` igual a 1

- [ ] **Step 3: Aceitar o `tx`**

Na assinatura de `createPost`, adicione o campo:

```ts
export async function createPost(input: {
  authorId: string
  content: string
  mentionedUserIds?: string[]
  gif?: AttachedGif
  image?: AttachedImage
  companyId: string
  /**
   * Cliente de uma transação já aberta pelo chamador. Existe para publicar um
   * item do calendário editorial e marcá-lo como publicado atomicamente: sem
   * isso, uma falha no meio deixaria post no mural com item ainda agendado, e a
   * próxima tentativa duplicaria o comunicado.
   */
  tx?: Prisma.TransactionClient
}): Promise<CorporatePostWithRelations> {
```

E troque a chamada final de criação:

```ts
  const db = input.tx ?? scopedPrisma(input.companyId)
  return db.corporatePost.create({
    data: {
      companyId: input.companyId,
      authorId: input.authorId,
      content,
```

Note o `companyId` explícito no `data`: dentro de um `tx` cru a extensão de
isolamento não preenche o campo sozinha. Garanta que `Prisma` está importado de
`@prisma/client` no topo do arquivo.

- [ ] **Step 4: Rodar a suíte inteira do mural**

Run: `LEGENDS_DB_PORT=5482 pnpm --filter @legends/api exec vitest run src/services/corporate-mural-service.test.ts`
Expected: PASS, incluindo os testes que já existiam

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/corporate-mural-service.ts apps/api/src/services/corporate-mural-service.test.ts
git commit -m "feat(api): createPost aceita transação do chamador"
```

---

### Task 6: Service — preview (não grava nada)

**Files:**
- Create: `apps/api/src/services/campaign-service.ts`
- Create: `apps/api/src/services/campaign-service.test.ts`

**Interfaces:**
- Consumes: `buildScheduleSlots` (Task 3), `buildCampaignPrompt`/
  `parseCampaignDrafts` (Task 4), `resolveGeminiCredentials`
  (`./ai-settings-service`), `requestAgentCompletion`/`AgentCompletionFn`
  (`../lib/gemini-agent-client`)
- Produces:
  - `interface CampaignActor { id: string; companyId: string }`
  - `generateCampaignPreview(actor: CampaignActor, input: GenerateCampaignRequest, complete?: AgentCompletionFn): Promise<CampaignDraftDTO[]>`

- [ ] **Step 1: Escrever o teste que falha**

`apps/api/src/services/campaign-service.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerateCampaignRequest } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { CampaignError } from '../lib/campaign-error'
import { AgentError } from '../lib/agent-error'
import { encryptSecret } from '../lib/crypto'
import { AI_SETTING_KEYS } from './ai-settings-service'
import { generateCampaignPreview, type CampaignActor } from './campaign-service'

async function criarAtor(email = 'gg@empresa.com'): Promise<CampaignActor> {
  const user = await prisma.user.create({
    data: { name: 'G&G', email, passwordHash: 'x', role: 'ADMIN' },
  })
  return { id: user.id, companyId: user.companyId }
}

async function cadastrarChave(companyId: string) {
  await prisma.appSetting.create({
    data: { key: AI_SETTING_KEYS.geminiApiKey, companyId, value: encryptSecret('chave-fake') },
  })
}

const pedido: GenerateCampaignRequest = {
  theme: 'Semana da segurança',
  startsAt: '2026-09-01T03:00:00.000Z',
  endsAt: '2026-09-10T03:00:00.000Z',
  audience: 'ALL',
  channel: 'MURAL',
  quantity: 2,
}

const respostaIA = JSON.stringify([
  { title: 'Abertura', body: 'Começa a semana da segurança.', visualHint: 'Capacete' },
  { title: 'Encerramento', body: 'Obrigado a todos.', visualHint: null },
])

describe('preview de campanha', () => {
  it('devolve a quantidade pedida, toda dentro da janela', async () => {
    const ator = await criarAtor()
    await cadastrarChave(ator.companyId)
    const complete = vi.fn().mockResolvedValue(respostaIA)

    const drafts = await generateCampaignPreview(ator, pedido, complete)

    expect(drafts).toHaveLength(2)
    for (const d of drafts) {
      expect(new Date(d.scheduledFor).getTime()).toBeGreaterThanOrEqual(new Date(pedido.startsAt).getTime())
      expect(new Date(d.scheduledFor).getTime()).toBeLessThanOrEqual(
        new Date('2026-09-11T00:00:00.000Z').getTime(),
      )
    }
  })

  it('não grava nada no banco', async () => {
    const ator = await criarAtor()
    await cadastrarChave(ator.companyId)

    await generateCampaignPreview(ator, pedido, vi.fn().mockResolvedValue(respostaIA))

    expect(await prisma.campaign.count()).toBe(0)
    expect(await prisma.campaignPost.count()).toBe(0)
  })

  it('recusa janela invertida antes de chamar a IA', async () => {
    const ator = await criarAtor()
    await cadastrarChave(ator.companyId)
    const complete = vi.fn()

    await expect(
      generateCampaignPreview(ator, { ...pedido, startsAt: pedido.endsAt, endsAt: pedido.startsAt }, complete),
    ).rejects.toThrow(CampaignError)
    expect(complete).not.toHaveBeenCalled()
  })

  it('responde 503 quando a empresa não cadastrou chave', async () => {
    const ator = await criarAtor()
    await expect(generateCampaignPreview(ator, pedido, vi.fn())).rejects.toMatchObject({ status: 503 })
  })

  it('não grava nada quando a IA devolve JSON inválido', async () => {
    const ator = await criarAtor()
    await cadastrarChave(ator.companyId)

    await expect(
      generateCampaignPreview(ator, pedido, vi.fn().mockResolvedValue('não consigo ajudar')),
    ).rejects.toThrow(CampaignError)
    expect(await prisma.campaignPost.count()).toBe(0)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `LEGENDS_DB_PORT=5482 pnpm --filter @legends/api exec vitest run src/services/campaign-service.test.ts`
Expected: FAIL — `Cannot find module './campaign-service'`

- [ ] **Step 3: Escrever a primeira metade do service**

`apps/api/src/services/campaign-service.ts`:

```ts
import type { CampaignDraftDTO, GenerateCampaignRequest } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { CampaignError } from '../lib/campaign-error'
import { buildScheduleSlots } from '../lib/campaign-schedule'
import { buildCampaignPrompt, parseCampaignDrafts } from '../lib/campaign-prompt'
import { requestAgentCompletion, type AgentCompletionFn } from '../lib/gemini-agent-client'
import { resolveGeminiCredentials } from './ai-settings-service'

export interface CampaignActor {
  id: string
  companyId: string
}

/**
 * Gera N rascunhos e **não toca no banco**. É a etapa de revisão: nada é
 * gravado sem confirmação humana, e é por isso que uma resposta ruim da IA não
 * consegue deixar item pela metade.
 *
 * `complete` entra por parâmetro para o teste injetar um duplo sem rede nem
 * chave — mesmo padrão do `agent-service`.
 */
export async function generateCampaignPreview(
  actor: CampaignActor,
  input: GenerateCampaignRequest,
  complete: AgentCompletionFn = requestAgentCompletion,
): Promise<CampaignDraftDTO[]> {
  // A grade vem antes da IA: janela inválida é erro do usuário e não deve custar
  // uma chamada paga ao provedor.
  const slots = buildScheduleSlots({
    startsAt: new Date(input.startsAt),
    endsAt: new Date(input.endsAt),
    quantity: input.quantity,
  })

  const credentials = await resolveGeminiCredentials(actor.companyId)
  const company = await prisma.company.findUnique({ where: { id: actor.companyId } })

  const prompt = buildCampaignPrompt({
    companyName: company?.name ?? 'a empresa',
    theme: input.theme,
    audience: input.audience,
    notes: input.notes,
    slots,
  })

  const raw = await complete({
    apiKey: credentials.apiKey,
    model: credentials.model,
    systemPrompt: prompt,
    turns: [{ role: 'user', content: 'Gere os comunicados da campanha.' }],
  })

  return parseCampaignDrafts(raw, slots)
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `LEGENDS_DB_PORT=5482 pnpm --filter @legends/api exec vitest run src/services/campaign-service.test.ts`
Expected: PASS (5 testes)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/campaign-service.ts apps/api/src/services/campaign-service.test.ts
git commit -m "feat(api): preview de campanha sem gravar no banco"
```

---

### Task 7: Service — confirmar, listar e criar item na mão

**Files:**
- Modify: `apps/api/src/services/campaign-service.ts`
- Modify: `apps/api/src/services/campaign-service.test.ts`

**Interfaces:**
- Produces:
  - `type CampaignPostWithRelations = CampaignPost & { campaign: { id: string; theme: string } | null; responsible: { id: string; name: string } | null }`
  - `confirmCampaign(actor: CampaignActor, input: ConfirmCampaignRequest): Promise<CampaignPostWithRelations[]>`
  - `listCampaignPosts(actor: CampaignActor, range: { from: Date; to: Date }): Promise<CampaignPostWithRelations[]>`
  - `createCampaignPost(actor: CampaignActor, input: CreateCampaignPostRequest): Promise<CampaignPostWithRelations>`

- [ ] **Step 1: Escrever os testes que falham**

Adicione ao fim de `campaign-service.test.ts` (reaproveitando `criarAtor`):

```ts
import type { ConfirmCampaignRequest } from '@legends/shared'
import { confirmCampaign, createCampaignPost, listCampaignPosts } from './campaign-service'

const confirmacao: ConfirmCampaignRequest = {
  theme: 'Semana da segurança',
  startsAt: '2026-09-01T03:00:00.000Z',
  endsAt: '2026-09-10T03:00:00.000Z',
  audience: 'ALL',
  posts: [
    {
      title: 'Abertura',
      body: 'Texto EDITADO pelo usuário antes de confirmar.',
      visualHint: 'Capacete',
      scheduledFor: '2026-09-01T12:00:00.000Z',
      channel: 'MURAL',
    },
    {
      title: 'Encerramento',
      body: 'Obrigado a todos.',
      visualHint: null,
      scheduledFor: '2026-09-03T12:00:00.000Z',
      channel: 'MURAL',
    },
  ],
}

describe('confirmar campanha', () => {
  it('cria exatamente N itens preservando o texto editado', async () => {
    const ator = await criarAtor('confirma@empresa.com')

    const criados = await confirmCampaign(ator, confirmacao)

    expect(criados).toHaveLength(2)
    expect(criados[0].body).toBe('Texto EDITADO pelo usuário antes de confirmar.')
    expect(criados[0].status).toBe('SCHEDULED')
    expect(await prisma.campaign.count()).toBe(1)
    expect(await prisma.campaignPost.count()).toBe(2)
  })

  it('grava auditoria da confirmação', async () => {
    const ator = await criarAtor('auditoria@empresa.com')
    await confirmCampaign(ator, confirmacao)
    const logs = await prisma.adminAuditLog.findMany({ where: { entityType: 'Campaign' } })
    expect(logs).toHaveLength(1)
    expect(logs[0].action).toBe('CREATE')
  })

  it('recusa janela invertida', async () => {
    const ator = await criarAtor('invertida@empresa.com')
    await expect(
      confirmCampaign(ator, { ...confirmacao, startsAt: confirmacao.endsAt, endsAt: confirmacao.startsAt }),
    ).rejects.toThrow(CampaignError)
  })

  it('recusa lista vazia', async () => {
    const ator = await criarAtor('vazia@empresa.com')
    await expect(confirmCampaign(ator, { ...confirmacao, posts: [] })).rejects.toThrow(CampaignError)
  })
})

describe('calendário', () => {
  it('lista só os itens da janela pedida, em ordem de data', async () => {
    const ator = await criarAtor('lista@empresa.com')
    await confirmCampaign(ator, confirmacao)

    const setembro = await listCampaignPosts(ator, {
      from: new Date('2026-09-01T00:00:00.000Z'),
      to: new Date('2026-09-30T23:59:59.000Z'),
    })
    expect(setembro).toHaveLength(2)
    expect(setembro[0].scheduledFor.getTime()).toBeLessThan(setembro[1].scheduledFor.getTime())

    const outubro = await listCampaignPosts(ator, {
      from: new Date('2026-10-01T00:00:00.000Z'),
      to: new Date('2026-10-31T23:59:59.000Z'),
    })
    expect(outubro).toHaveLength(0)
  })

  it('cria item na mão, sem campanha', async () => {
    const ator = await criarAtor('mao@empresa.com')

    const item = await createCampaignPost(ator, {
      title: 'Aviso de manutenção',
      body: 'O sistema ficará indisponível no sábado.',
      scheduledFor: '2026-09-05T12:00:00.000Z',
      channel: 'MURAL',
      audience: 'ALL',
    })

    expect(item.campaignId).toBeNull()
    expect(item.status).toBe('SCHEDULED')
    expect(await prisma.campaign.count()).toBe(0)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `LEGENDS_DB_PORT=5482 pnpm --filter @legends/api exec vitest run src/services/campaign-service.test.ts`
Expected: FAIL — `confirmCampaign is not a function`

- [ ] **Step 3: Implementar**

Acrescente a `campaign-service.ts` (e complete os imports do topo):

```ts
import { Prisma, type CampaignPost } from '@prisma/client'
import type {
  ConfirmCampaignRequest,
  CreateCampaignPostRequest,
} from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'
import { recordAuditLog } from './audit-log-service'

const postInclude = {
  campaign: { select: { id: true, theme: true } },
  responsible: { select: { id: true, name: true } },
} as const

export type CampaignPostWithRelations = CampaignPost & {
  campaign: { id: string; theme: string } | null
  responsible: { id: string; name: string } | null
}

/**
 * Grava a campanha e os N itens **como o usuário os deixou na tela**. O service
 * não regenera nem reaproveita o texto original: é isso que faz a edição feita
 * no preview sobreviver até o item agendado.
 */
export async function confirmCampaign(
  actor: CampaignActor,
  input: ConfirmCampaignRequest,
): Promise<CampaignPostWithRelations[]> {
  const startsAt = new Date(input.startsAt)
  const endsAt = new Date(input.endsAt)
  if (endsAt.getTime() < startsAt.getTime()) {
    throw new CampaignError('A data final não pode ser anterior à data inicial.', 400)
  }
  if (input.posts.length === 0) {
    throw new CampaignError('Nenhum comunicado para agendar.', 400)
  }

  const db = scopedPrisma(actor.companyId)
  return db.$transaction(async (tx) => {
    const campaign = await tx.campaign.create({
      data: {
        companyId: actor.companyId,
        theme: input.theme,
        startsAt,
        endsAt,
        audience: input.audience,
        notes: input.notes ?? null,
        createdById: actor.id,
      },
    })

    const created: CampaignPostWithRelations[] = []
    for (const post of input.posts) {
      created.push(
        await tx.campaignPost.create({
          data: {
            companyId: actor.companyId,
            campaignId: campaign.id,
            title: post.title,
            body: post.body,
            visualHint: post.visualHint ?? null,
            scheduledFor: new Date(post.scheduledFor),
            channel: post.channel,
            audience: input.audience,
            responsibleId: post.responsibleId ?? null,
          },
          include: postInclude,
        }),
      )
    }

    await recordAuditLog({
      actorId: actor.id,
      entityType: 'Campaign',
      entityId: campaign.id,
      action: 'CREATE',
      after: { ...campaign, posts: created.length },
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })

    return created
  })
}

/** Itens da janela pedida — é o que alimenta a grade de mês do calendário. */
export function listCampaignPosts(
  actor: CampaignActor,
  range: { from: Date; to: Date },
): Promise<CampaignPostWithRelations[]> {
  return scopedPrisma(actor.companyId).campaignPost.findMany({
    where: { scheduledFor: { gte: range.from, lte: range.to } },
    include: postInclude,
    orderBy: { scheduledFor: 'asc' },
  })
}

/**
 * Item avulso, sem campanha. É o caminho que mantém o calendário utilizável
 * quando a empresa não cadastrou chave de IA.
 */
export async function createCampaignPost(
  actor: CampaignActor,
  input: CreateCampaignPostRequest,
): Promise<CampaignPostWithRelations> {
  const db = scopedPrisma(actor.companyId)
  return db.$transaction(async (tx) => {
    const created = await tx.campaignPost.create({
      data: {
        companyId: actor.companyId,
        title: input.title,
        body: input.body,
        visualHint: input.visualHint ?? null,
        scheduledFor: new Date(input.scheduledFor),
        channel: input.channel,
        audience: input.audience,
        responsibleId: input.responsibleId ?? null,
      },
      include: postInclude,
    })
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'CampaignPost',
      entityId: created.id,
      action: 'CREATE',
      after: created,
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
    return created
  })
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `LEGENDS_DB_PORT=5482 pnpm --filter @legends/api exec vitest run src/services/campaign-service.test.ts`
Expected: PASS (11 testes)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/campaign-service.ts apps/api/src/services/campaign-service.test.ts
git commit -m "feat(api): confirmar campanha, listar e criar item do calendário"
```

---

### Task 8: Service — editar, publicar e cancelar

**Files:**
- Modify: `apps/api/src/services/campaign-service.ts`
- Modify: `apps/api/src/services/campaign-service.test.ts`

**Interfaces:**
- Consumes: `createPost` com `tx` (Task 5)
- Produces:
  - `updateCampaignPost(actor: CampaignActor, id: string, input: UpdateCampaignPostRequest): Promise<CampaignPostWithRelations>`
  - `publishCampaignPost(actor: CampaignActor, id: string): Promise<CampaignPostWithRelations>`
  - `cancelCampaignPost(actor: CampaignActor, id: string): Promise<CampaignPostWithRelations>`

- [ ] **Step 1: Escrever os testes que falham**

Adicione ao fim de `campaign-service.test.ts`:

```ts
import { cancelCampaignPost, publishCampaignPost, updateCampaignPost } from './campaign-service'

async function itemAgendado(ator: CampaignActor) {
  return createCampaignPost(ator, {
    title: 'Aviso',
    body: 'Corpo do comunicado.',
    scheduledFor: '2026-09-05T12:00:00.000Z',
    channel: 'MURAL',
    audience: 'ALL',
  })
}

describe('editar item', () => {
  it('reagenda e troca o texto', async () => {
    const ator = await criarAtor('edita@empresa.com')
    const item = await itemAgendado(ator)

    const editado = await updateCampaignPost(ator, item.id, {
      body: 'Corpo novo.',
      scheduledFor: '2026-09-08T12:00:00.000Z',
    })

    expect(editado.body).toBe('Corpo novo.')
    expect(editado.scheduledFor.toISOString()).toBe('2026-09-08T12:00:00.000Z')
  })

  it('404 para item de outra empresa', async () => {
    const ator = await criarAtor('dono@empresa.com')
    const item = await itemAgendado(ator)
    // Escopo de outra empresa: `scopedPrisma` não acha a linha, e o service
    // devolve 404 em vez de 403 — não se confirma nem a existência.
    const intruso: CampaignActor = { id: ator.id, companyId: 'company-inexistente' }

    await expect(updateCampaignPost(intruso, item.id, { body: 'x' })).rejects.toMatchObject({ status: 404 })
  })
})

describe('publicar item', () => {
  it('cria o post no mural e liga publishedPostId', async () => {
    const ator = await criarAtor('publica@empresa.com')
    const item = await itemAgendado(ator)

    const publicado = await publishCampaignPost(ator, item.id)

    expect(publicado.status).toBe('PUBLISHED')
    expect(publicado.publishedPostId).toBeTruthy()
    expect(publicado.publishedAt).not.toBeNull()

    const posts = await prisma.corporatePost.findMany()
    expect(posts).toHaveLength(1)
    expect(posts[0].content).toBe('Corpo do comunicado.')
    expect(posts[0].id).toBe(publicado.publishedPostId)
  })

  it('recusa publicar duas vezes', async () => {
    const ator = await criarAtor('duasvezes@empresa.com')
    const item = await itemAgendado(ator)
    await publishCampaignPost(ator, item.id)

    await expect(publishCampaignPost(ator, item.id)).rejects.toMatchObject({ status: 409 })
    expect(await prisma.corporatePost.count()).toBe(1)
  })
})

describe('cancelar item', () => {
  it('marca como cancelado sem criar post', async () => {
    const ator = await criarAtor('cancela@empresa.com')
    const item = await itemAgendado(ator)

    const cancelado = await cancelCampaignPost(ator, item.id)

    expect(cancelado.status).toBe('CANCELLED')
    expect(await prisma.corporatePost.count()).toBe(0)
    // Cancelar não apaga: o histórico editorial continua no calendário.
    expect(await prisma.campaignPost.count()).toBe(1)
  })

  it('recusa cancelar item já publicado', async () => {
    const ator = await criarAtor('jápublicado@empresa.com')
    const item = await itemAgendado(ator)
    await publishCampaignPost(ator, item.id)

    await expect(cancelCampaignPost(ator, item.id)).rejects.toMatchObject({ status: 409 })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `LEGENDS_DB_PORT=5482 pnpm --filter @legends/api exec vitest run src/services/campaign-service.test.ts`
Expected: FAIL — `updateCampaignPost is not a function`

- [ ] **Step 3: Implementar**

Acrescente a `campaign-service.ts` (importe `createPost` de
`./corporate-mural-service` e o tipo `UpdateCampaignPostRequest`):

```ts
async function findPostOrThrow(actor: CampaignActor, id: string): Promise<CampaignPostWithRelations> {
  const post = await scopedPrisma(actor.companyId).campaignPost.findFirst({
    where: { id },
    include: postInclude,
  })
  if (!post) throw new CampaignError('Comunicado não encontrado.', 404)
  return post
}

export async function updateCampaignPost(
  actor: CampaignActor,
  id: string,
  input: UpdateCampaignPostRequest,
): Promise<CampaignPostWithRelations> {
  const before = await findPostOrThrow(actor, id)
  if (before.status === 'PUBLISHED') {
    throw new CampaignError('Comunicado já publicado não pode ser editado.', 409)
  }

  const data: Prisma.CampaignPostUncheckedUpdateInput = {}
  if (input.title !== undefined) data.title = input.title
  if (input.body !== undefined) data.body = input.body
  if (input.visualHint !== undefined) data.visualHint = input.visualHint ?? null
  if (input.scheduledFor !== undefined) data.scheduledFor = new Date(input.scheduledFor)
  if (input.channel !== undefined) data.channel = input.channel
  if (input.audience !== undefined) data.audience = input.audience
  if (input.responsibleId !== undefined) data.responsibleId = input.responsibleId ?? null

  const db = scopedPrisma(actor.companyId)
  return db.$transaction(async (tx) => {
    await tx.campaignPost.update({ where: { id }, data })
    const after = await tx.campaignPost.findUniqueOrThrow({ where: { id }, include: postInclude })
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'CampaignPost',
      entityId: id,
      action: 'UPDATE',
      before,
      after,
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
    return after
  })
}

/**
 * Publica o item no Mural da empresa. O post nasce **dentro** da transação que
 * marca o item como publicado: se o update falhasse depois de um create solto,
 * ficaria post no mural com item ainda agendado, e a próxima tentativa
 * duplicaria o comunicado.
 *
 * Só o canal `MURAL` publica — Teams e e-mail ficam registrados no dado, com
 * entrega manual (ver spec, Decisão 6).
 */
export async function publishCampaignPost(
  actor: CampaignActor,
  id: string,
): Promise<CampaignPostWithRelations> {
  const before = await findPostOrThrow(actor, id)
  if (before.status === 'PUBLISHED') throw new CampaignError('Este comunicado já foi publicado.', 409)
  if (before.status === 'CANCELLED') throw new CampaignError('Comunicado cancelado não pode ser publicado.', 409)
  if (before.channel !== 'MURAL') {
    throw new CampaignError(
      'Só o canal Mural da empresa publica automaticamente. Registre a entrega manualmente e cancele ou reagende este item.',
      400,
    )
  }

  const db = scopedPrisma(actor.companyId)
  return db.$transaction(async (tx) => {
    const post = await createPost({
      authorId: actor.id,
      content: before.body,
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
    await tx.campaignPost.update({
      where: { id },
      data: { status: 'PUBLISHED', publishedPostId: post.id, publishedAt: new Date() },
    })
    const after = await tx.campaignPost.findUniqueOrThrow({ where: { id }, include: postInclude })
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'CampaignPost',
      entityId: id,
      action: 'UPDATE',
      before,
      after,
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
    return after
  })
}

/** Cancelar não apaga: o histórico editorial continua visível no calendário. */
export async function cancelCampaignPost(
  actor: CampaignActor,
  id: string,
): Promise<CampaignPostWithRelations> {
  const before = await findPostOrThrow(actor, id)
  if (before.status === 'PUBLISHED') {
    throw new CampaignError('Comunicado já publicado não pode ser cancelado.', 409)
  }

  const db = scopedPrisma(actor.companyId)
  return db.$transaction(async (tx) => {
    await tx.campaignPost.update({ where: { id }, data: { status: 'CANCELLED' } })
    const after = await tx.campaignPost.findUniqueOrThrow({ where: { id }, include: postInclude })
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'CampaignPost',
      entityId: id,
      action: 'DELETE',
      before,
      after,
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
    return after
  })
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `LEGENDS_DB_PORT=5482 pnpm --filter @legends/api exec vitest run src/services/campaign-service.test.ts`
Expected: PASS (17 testes)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/campaign-service.ts apps/api/src/services/campaign-service.test.ts
git commit -m "feat(api): editar, publicar e cancelar item do calendário editorial"
```

---

### Task 9: Serializer e rotas

**Files:**
- Create: `apps/api/src/routes/campaigns.ts`
- Create: `apps/api/src/routes/campaigns.test.ts`
- Modify: `apps/api/src/lib/serialize.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: todo o `campaign-service`
- Produces: `toCampaignPostDTO(post: CampaignPostWithRelations): CampaignPostDTO`;
  `campaignRoutes(app: FastifyInstance)`; os 7 endpoints da spec.

- [ ] **Step 1: Escrever o teste que falha**

`apps/api/src/routes/campaigns.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../app'
import { signAccessToken } from '../lib/jwt'
import { prisma } from '../lib/prisma'

vi.mock('../services/campaign-service', async (importOriginal) => {
  const real = await importOriginal<typeof import('../services/campaign-service')>()
  return {
    ...real,
    // Só o preview é dublado: é o único caminho que sairia para a rede.
    generateCampaignPreview: vi.fn(),
  }
})
const { generateCampaignPreview } = await import('../services/campaign-service')

let app: Awaited<ReturnType<typeof buildApp>>

beforeEach(async () => {
  app = buildApp()
  await app.ready()
  vi.mocked(generateCampaignPreview).mockReset()
})

async function criarUsuario(role: string, email: string) {
  return prisma.user.create({
    data: { name: `Usuário ${role}`, email, passwordHash: 'x', role: role as never },
  })
}

const pedido = {
  theme: 'Semana da segurança',
  startsAt: '2026-09-01T03:00:00.000Z',
  endsAt: '2026-09-10T03:00:00.000Z',
  audience: 'ALL',
  channel: 'MURAL',
  quantity: 2,
}

describe('rotas de campanhas', () => {
  it('barra colaborador comum', async () => {
    const legend = await criarUsuario('LEGEND', 'legend-camp@empresa.com')
    const res = await app.inject({
      method: 'GET',
      url: '/admin/campaigns/posts?from=2026-09-01&to=2026-09-30',
      headers: { authorization: `Bearer ${signAccessToken(app, legend)}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('recusa data final anterior à inicial com mensagem em português', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-janela@empresa.com')
    const res = await app.inject({
      method: 'POST',
      url: '/admin/campaigns/preview',
      headers: { authorization: `Bearer ${signAccessToken(app, admin)}` },
      payload: { ...pedido, startsAt: pedido.endsAt, endsAt: pedido.startsAt },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toMatch(/data final/i)
    expect(generateCampaignPreview).not.toHaveBeenCalled()
  })

  it('recusa quantidade fora de 1..20', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-qtd@empresa.com')
    const res = await app.inject({
      method: 'POST',
      url: '/admin/campaigns/preview',
      headers: { authorization: `Bearer ${signAccessToken(app, admin)}` },
      payload: { ...pedido, quantity: 21 },
    })
    expect(res.statusCode).toBe(400)
  })

  it('preview devolve rascunhos e não grava nada', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-preview@empresa.com')
    vi.mocked(generateCampaignPreview).mockResolvedValue([
      { title: 'A', body: 'Corpo A', visualHint: null, scheduledFor: '2026-09-01T12:00:00.000Z' },
      { title: 'B', body: 'Corpo B', visualHint: null, scheduledFor: '2026-09-03T12:00:00.000Z' },
    ])

    const res = await app.inject({
      method: 'POST',
      url: '/admin/campaigns/preview',
      headers: { authorization: `Bearer ${signAccessToken(app, admin)}` },
      payload: pedido,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().drafts).toHaveLength(2)
    expect(await prisma.campaign.count()).toBe(0)
    expect(await prisma.campaignPost.count()).toBe(0)
  })

  it('propaga o 503 de empresa sem chave de IA', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-503@empresa.com')
    const { AgentError } = await import('../lib/agent-error')
    vi.mocked(generateCampaignPreview).mockRejectedValue(new AgentError('Agente de IA não configurado.', 503))

    const res = await app.inject({
      method: 'POST',
      url: '/admin/campaigns/preview',
      headers: { authorization: `Bearer ${signAccessToken(app, admin)}` },
      payload: pedido,
    })

    expect(res.statusCode).toBe(503)
    expect(res.json().message).toContain('não configurado')
  })

  it('confirma, lista, edita, publica e cancela', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-fluxo@empresa.com')
    const auth = { authorization: `Bearer ${signAccessToken(app, admin)}` }

    const confirmada = await app.inject({
      method: 'POST',
      url: '/admin/campaigns',
      headers: auth,
      payload: {
        theme: 'Semana da segurança',
        startsAt: pedido.startsAt,
        endsAt: pedido.endsAt,
        audience: 'ALL',
        posts: [
          { title: 'A', body: 'Corpo A', scheduledFor: '2026-09-01T12:00:00.000Z', channel: 'MURAL' },
          { title: 'B', body: 'Corpo B', scheduledFor: '2026-09-03T12:00:00.000Z', channel: 'MURAL' },
        ],
      },
    })
    expect(confirmada.statusCode).toBe(201)
    expect(confirmada.json().posts).toHaveLength(2)

    const lista = await app.inject({
      method: 'GET',
      url: '/admin/campaigns/posts?from=2026-09-01T00:00:00.000Z&to=2026-09-30T23:59:59.000Z',
      headers: auth,
    })
    expect(lista.json().posts).toHaveLength(2)

    const alvo = lista.json().posts[0]
    const editado = await app.inject({
      method: 'PATCH',
      url: `/admin/campaigns/posts/${alvo.id}`,
      headers: auth,
      payload: { body: 'Corpo A editado' },
    })
    expect(editado.json().post.body).toBe('Corpo A editado')

    const publicado = await app.inject({
      method: 'POST',
      url: `/admin/campaigns/posts/${alvo.id}/publish`,
      headers: auth,
    })
    expect(publicado.statusCode).toBe(200)
    expect(publicado.json().post.status).toBe('PUBLISHED')
    expect(await prisma.corporatePost.count()).toBe(1)

    const outro = lista.json().posts[1]
    const cancelado = await app.inject({
      method: 'DELETE',
      url: `/admin/campaigns/posts/${outro.id}`,
      headers: auth,
    })
    expect(cancelado.json().post.status).toBe('CANCELLED')
    expect(await prisma.corporatePost.count()).toBe(1)
  })

  it('recusa corpo acima do limite do mural', async () => {
    const admin = await criarUsuario('ADMIN', 'admin-limite@empresa.com')
    const res = await app.inject({
      method: 'POST',
      url: '/admin/campaigns/posts',
      headers: { authorization: `Bearer ${signAccessToken(app, admin)}` },
      payload: {
        title: 'A',
        body: 'x'.repeat(281),
        scheduledFor: '2026-09-01T12:00:00.000Z',
        channel: 'MURAL',
        audience: 'ALL',
      },
    })
    expect(res.statusCode).toBe(400)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `LEGENDS_DB_PORT=5482 pnpm --filter @legends/api exec vitest run src/routes/campaigns.test.ts`
Expected: FAIL — 404 em todas as rotas

- [ ] **Step 3: Escrever o serializer**

Em `apps/api/src/lib/serialize.ts`, importe `CampaignPostDTO` de `@legends/shared`
e `CampaignPostWithRelations` de `../services/campaign-service`, e adicione:

```ts
export function toCampaignPostDTO(post: CampaignPostWithRelations): CampaignPostDTO {
  return {
    id: post.id,
    campaignId: post.campaignId,
    campaignTheme: post.campaign?.theme ?? null,
    title: post.title,
    body: post.body,
    visualHint: post.visualHint,
    scheduledFor: post.scheduledFor.toISOString(),
    channel: post.channel,
    audience: post.audience,
    status: post.status,
    responsibleId: post.responsibleId,
    responsibleName: post.responsible?.name ?? null,
    publishedPostId: post.publishedPostId,
    publishedAt: post.publishedAt?.toISOString() ?? null,
    createdAt: post.createdAt.toISOString(),
  }
}
```

- [ ] **Step 4: Escrever as rotas**

`apps/api/src/routes/campaigns.ts`:

```ts
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  CAMPAIGN_AUDIENCES,
  CAMPAIGN_BODY_MAX_LENGTH,
  CAMPAIGN_CHANNELS,
  CAMPAIGN_NOTES_MAX_LENGTH,
  CAMPAIGN_QUANTITY_MAX,
  CAMPAIGN_QUANTITY_MIN,
  CAMPAIGN_THEME_MAX_LENGTH,
  CAMPAIGN_TITLE_MAX_LENGTH,
  CAMPAIGN_VISUAL_HINT_MAX_LENGTH,
  type CampaignAudience,
  type CampaignChannel,
} from '@legends/shared'
import { AgentError } from '../lib/agent-error'
import { CampaignError } from '../lib/campaign-error'
import { toCampaignPostDTO } from '../lib/serialize'
import {
  cancelCampaignPost,
  confirmCampaign,
  createCampaignPost,
  generateCampaignPreview,
  listCampaignPosts,
  publishCampaignPost,
  updateCampaignPost,
  type CampaignActor,
} from '../services/campaign-service'

const idParamsSchema = z.object({ id: z.string().min(1) })
const isoDate = z.string().datetime({ offset: true })
// As constantes do contrato são `readonly`; `z.enum` quer tupla mutável.
const audience = z.enum([...CAMPAIGN_AUDIENCES] as [CampaignAudience, ...CampaignAudience[]])
const channel = z.enum([...CAMPAIGN_CHANNELS] as [CampaignChannel, ...CampaignChannel[]])

/** A janela é validada aqui para o erro chegar como 400 de campo, não como exceção. */
const windowRefinement = <T extends { startsAt: string; endsAt: string }>(schema: z.ZodType<T>) =>
  schema.refine((v) => new Date(v.endsAt).getTime() >= new Date(v.startsAt).getTime(), {
    message: 'A data final não pode ser anterior à data inicial.',
    path: ['endsAt'],
  })

const generateSchema = windowRefinement(
  z.object({
    theme: z.string().trim().min(1).max(CAMPAIGN_THEME_MAX_LENGTH),
    startsAt: isoDate,
    endsAt: isoDate,
    audience,
    channel,
    quantity: z.number().int().min(CAMPAIGN_QUANTITY_MIN).max(CAMPAIGN_QUANTITY_MAX),
    notes: z.string().trim().max(CAMPAIGN_NOTES_MAX_LENGTH).optional(),
  }),
)

const postBodySchema = {
  title: z.string().trim().min(1).max(CAMPAIGN_TITLE_MAX_LENGTH),
  body: z.string().trim().min(1).max(CAMPAIGN_BODY_MAX_LENGTH),
  visualHint: z.string().trim().max(CAMPAIGN_VISUAL_HINT_MAX_LENGTH).nullable().optional(),
  scheduledFor: isoDate,
  channel,
  responsibleId: z.string().min(1).nullable().optional(),
}

const confirmSchema = windowRefinement(
  z.object({
    theme: z.string().trim().min(1).max(CAMPAIGN_THEME_MAX_LENGTH),
    startsAt: isoDate,
    endsAt: isoDate,
    audience,
    notes: z.string().trim().max(CAMPAIGN_NOTES_MAX_LENGTH).optional(),
    posts: z.array(z.object(postBodySchema)).min(1).max(CAMPAIGN_QUANTITY_MAX),
  }),
)

const createPostSchema = z.object({ ...postBodySchema, audience })
const updatePostSchema = z.object({ ...postBodySchema, audience }).partial()

const rangeSchema = z.object({ from: isoDate, to: isoDate })

function actorFrom(request: { user: { sub: string; companyId: string } }): CampaignActor {
  return { id: request.user.sub, companyId: request.user.companyId }
}

/** Falha de IA e erro de domínio nunca viram 500 — os dois carregam status próprio. */
function handleCampaignError(err: unknown, reply: FastifyReply) {
  if (err instanceof CampaignError || err instanceof AgentError) {
    return reply.code(err.status).send({ message: err.message })
  }
  throw err
}

/**
 * Calendário editorial. Mesma guarda das outras telas de Gente e Gestão: ADMIN
 * global, ou SUBADMIN do setor com a feature `gente-gestao` ligada.
 */
export async function campaignRoutes(app: FastifyInstance) {
  const guard = { onRequest: [app.authenticate, app.requireSectorFeature('gente-gestao')] }

  app.post('/admin/campaigns/preview', guard, async (request, reply) => {
    const parsed = generateSchema.safeParse(request.body)
    if (!parsed.success) {
      const janela = parsed.error.issues.find((i) => i.path.includes('endsAt'))
      return reply.code(400).send({
        message: janela?.message ?? 'Dados inválidos.',
        issues: parsed.error.issues,
      })
    }
    try {
      const drafts = await generateCampaignPreview(actorFrom(request), parsed.data)
      return reply.send({ drafts })
    } catch (err) {
      return handleCampaignError(err, reply)
    }
  })

  app.post('/admin/campaigns', guard, async (request, reply) => {
    const parsed = confirmSchema.safeParse(request.body)
    if (!parsed.success) {
      const janela = parsed.error.issues.find((i) => i.path.includes('endsAt'))
      return reply.code(400).send({
        message: janela?.message ?? 'Dados inválidos.',
        issues: parsed.error.issues,
      })
    }
    try {
      const posts = await confirmCampaign(actorFrom(request), parsed.data)
      return reply.code(201).send({ posts: posts.map(toCampaignPostDTO) })
    } catch (err) {
      return handleCampaignError(err, reply)
    }
  })

  app.get('/admin/campaigns/posts', guard, async (request, reply) => {
    const parsed = rangeSchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Período inválido.', issues: parsed.error.issues })
    }
    const posts = await listCampaignPosts(actorFrom(request), {
      from: new Date(parsed.data.from),
      to: new Date(parsed.data.to),
    })
    return reply.send({ posts: posts.map(toCampaignPostDTO) })
  })

  app.post('/admin/campaigns/posts', guard, async (request, reply) => {
    const parsed = createPostSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      const post = await createCampaignPost(actorFrom(request), parsed.data)
      return reply.code(201).send({ post: toCampaignPostDTO(post) })
    } catch (err) {
      return handleCampaignError(err, reply)
    }
  })

  app.patch('/admin/campaigns/posts/:id', guard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ message: 'Parâmetros inválidos.', issues: params.error.issues })
    }
    const parsed = updatePostSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      const post = await updateCampaignPost(actorFrom(request), params.data.id, parsed.data)
      return reply.send({ post: toCampaignPostDTO(post) })
    } catch (err) {
      return handleCampaignError(err, reply)
    }
  })

  app.post('/admin/campaigns/posts/:id/publish', guard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ message: 'Parâmetros inválidos.', issues: params.error.issues })
    }
    try {
      const post = await publishCampaignPost(actorFrom(request), params.data.id)
      return reply.send({ post: toCampaignPostDTO(post) })
    } catch (err) {
      return handleCampaignError(err, reply)
    }
  })

  app.delete('/admin/campaigns/posts/:id', guard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ message: 'Parâmetros inválidos.', issues: params.error.issues })
    }
    try {
      const post = await cancelCampaignPost(actorFrom(request), params.data.id)
      return reply.send({ post: toCampaignPostDTO(post) })
    } catch (err) {
      return handleCampaignError(err, reply)
    }
  })
}
```

- [ ] **Step 5: Registrar em `app.ts`**

Importe no topo e registre junto dos outros, depois de `benchmarkPracticeRoutes`:

```ts
import { campaignRoutes } from './routes/campaigns'
// ...
  app.register(campaignRoutes)
```

- [ ] **Step 6: Rodar e ver passar**

Run: `LEGENDS_DB_PORT=5482 pnpm --filter @legends/api exec vitest run src/routes/campaigns.test.ts`
Expected: PASS (7 testes)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/campaigns.ts apps/api/src/routes/campaigns.test.ts apps/api/src/lib/serialize.ts apps/api/src/app.ts
git commit -m "feat(api): rotas do calendário editorial de campanhas"
```

---

### Task 10: Cliente HTTP do front

**Files:**
- Create: `apps/web/src/lib/campaign-api.ts`

**Interfaces:**
- Consumes: `apiFetch` de `./api`
- Produces: `previewCampaign`, `confirmCampaign`, `listCampaignPosts`,
  `createCampaignPost`, `updateCampaignPost`, `publishCampaignPost`,
  `cancelCampaignPost`

Sem teste próprio: é uma casca fina sobre `apiFetch`, coberta pelos testes da
tela (Task 13), que dublam este módulo.

- [ ] **Step 1: Escrever o cliente**

```ts
import type {
  CampaignDraftDTO,
  CampaignPostDTO,
  ConfirmCampaignRequest,
  CreateCampaignPostRequest,
  GenerateCampaignRequest,
  UpdateCampaignPostRequest,
} from '@legends/shared'
import { apiFetch } from './api'

export function previewCampaign(body: GenerateCampaignRequest): Promise<{ drafts: CampaignDraftDTO[] }> {
  return apiFetch('/admin/campaigns/preview', { method: 'POST', body: JSON.stringify(body) })
}

export function confirmCampaign(body: ConfirmCampaignRequest): Promise<{ posts: CampaignPostDTO[] }> {
  return apiFetch('/admin/campaigns', { method: 'POST', body: JSON.stringify(body) })
}

export function listCampaignPosts(from: string, to: string): Promise<{ posts: CampaignPostDTO[] }> {
  const params = new URLSearchParams({ from, to })
  return apiFetch(`/admin/campaigns/posts?${params.toString()}`)
}

export function createCampaignPost(body: CreateCampaignPostRequest): Promise<{ post: CampaignPostDTO }> {
  return apiFetch('/admin/campaigns/posts', { method: 'POST', body: JSON.stringify(body) })
}

export function updateCampaignPost(
  id: string,
  body: UpdateCampaignPostRequest,
): Promise<{ post: CampaignPostDTO }> {
  return apiFetch(`/admin/campaigns/posts/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function publishCampaignPost(id: string): Promise<{ post: CampaignPostDTO }> {
  return apiFetch(`/admin/campaigns/posts/${id}/publish`, { method: 'POST' })
}

export function cancelCampaignPost(id: string): Promise<{ post: CampaignPostDTO }> {
  return apiFetch(`/admin/campaigns/posts/${id}`, { method: 'DELETE' })
}
```

- [ ] **Step 2: Verificar tipos**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/campaign-api.ts
git commit -m "feat(web): cliente HTTP das campanhas"
```

---

### Task 11: Aba Calendário

**Files:**
- Create: `apps/web/src/pages/admin/CampaignCalendar.tsx`

**Interfaces:**
- Consumes: `listCampaignPosts`, `updateCampaignPost`, `publishCampaignPost`,
  `cancelCampaignPost`, `createCampaignPost` (Task 10)
- Produces: `export function CampaignCalendar()` — componente autocontido, sem props

- [ ] **Step 1: Escrever o componente**

```tsx
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CAMPAIGN_BODY_MAX_LENGTH,
  CAMPAIGN_CHANNELS,
  CAMPAIGN_CHANNEL_LABELS,
  CAMPAIGN_POST_STATUS_LABELS,
  type CampaignChannel,
  type CampaignPostDTO,
  type PublicUser,
} from '@legends/shared'
import { apiFetch } from '../../lib/api'
import {
  cancelCampaignPost,
  createCampaignPost,
  listCampaignPosts,
  publishCampaignPost,
  updateCampaignPost,
} from '../../lib/campaign-api'

const STATUS_CLASS: Record<CampaignPostDTO['status'], string> = {
  SCHEDULED: 'bg-amber-500/20 text-amber-200',
  PUBLISHED: 'bg-emerald-500/20 text-emerald-200',
  CANCELLED: 'bg-slate-600/30 text-slate-400 line-through',
}

const timeFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  hour: '2-digit',
  minute: '2-digit',
})

/** `datetime-local` fala horário local; o contrato fala ISO com fuso. */
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface Draft {
  id: string | null
  title: string
  body: string
  scheduledFor: string
  channel: CampaignChannel
  responsibleId: string
  status: CampaignPostDTO['status']
}

function emptyDraft(): Draft {
  const amanha = new Date(Date.now() + 24 * 60 * 60 * 1000)
  return {
    id: null,
    title: '',
    body: '',
    scheduledFor: toLocalInput(amanha.toISOString()),
    channel: 'MURAL',
    responsibleId: '',
    status: 'SCHEDULED',
  }
}

export function CampaignCalendar() {
  const queryClient = useQueryClient()
  const hoje = new Date()
  const [cursor, setCursor] = useState({ year: hoje.getFullYear(), month: hoje.getMonth() })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const range = useMemo(() => {
    const from = new Date(cursor.year, cursor.month, 1)
    const to = new Date(cursor.year, cursor.month + 1, 0, 23, 59, 59)
    return { from: from.toISOString(), to: to.toISOString() }
  }, [cursor])

  const postsQuery = useQuery({
    queryKey: ['campaign-posts', cursor.year, cursor.month],
    queryFn: () => listCampaignPosts(range.from, range.to),
  })

  const colleaguesQuery = useQuery({
    queryKey: ['colleagues-for-campaigns'],
    queryFn: () => apiFetch<{ users: PublicUser[] }>('/users'),
  })

  const invalidate = () => {
    setErro(null)
    setDraft(null)
    return queryClient.invalidateQueries({ queryKey: ['campaign-posts'] })
  }
  const onError = (err: unknown) => setErro(err instanceof Error ? err.message : 'Não consegui salvar.')

  const salvar = useMutation({
    mutationFn: (d: Draft) => {
      const payload = {
        title: d.title,
        body: d.body,
        scheduledFor: new Date(d.scheduledFor).toISOString(),
        channel: d.channel,
        responsibleId: d.responsibleId || null,
      }
      return d.id
        ? updateCampaignPost(d.id, payload)
        : createCampaignPost({ ...payload, audience: 'ALL' })
    },
    onSuccess: invalidate,
    onError,
  })
  const publicar = useMutation({ mutationFn: publishCampaignPost, onSuccess: invalidate, onError })
  const cancelar = useMutation({ mutationFn: cancelCampaignPost, onSuccess: invalidate, onError })

  const porDia = useMemo(() => {
    const mapa = new Map<number, CampaignPostDTO[]>()
    for (const post of postsQuery.data?.posts ?? []) {
      const dia = new Date(post.scheduledFor).getDate()
      mapa.set(dia, [...(mapa.get(dia) ?? []), post])
    }
    return mapa
  }, [postsQuery.data])

  const diasNoMes = new Date(cursor.year, cursor.month + 1, 0).getDate()
  const nomeDoMes = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(
    new Date(cursor.year, cursor.month, 1),
  )

  function abrir(post: CampaignPostDTO) {
    setErro(null)
    setDraft({
      id: post.id,
      title: post.title,
      body: post.body,
      scheduledFor: toLocalInput(post.scheduledFor),
      channel: post.channel,
      responsibleId: post.responsibleId ?? '',
      status: post.status,
    })
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
        <div className="mb-4 flex items-center justify-between">
          <button type="button" onClick={() => setCursor((c) => ({ year: c.month === 0 ? c.year - 1 : c.year, month: c.month === 0 ? 11 : c.month - 1 }))} className="px-3 py-1 text-slate-300">
            ← Mês anterior
          </button>
          <h2 className="text-lg font-medium capitalize text-slate-100">{nomeDoMes}</h2>
          <button type="button" onClick={() => setCursor((c) => ({ year: c.month === 11 ? c.year + 1 : c.year, month: c.month === 11 ? 0 : c.month + 1 }))} className="px-3 py-1 text-slate-300">
            Próximo mês →
          </button>
        </div>

        {postsQuery.isLoading ? <p className="text-slate-400">Carregando…</p> : null}

        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: diasNoMes }, (_, i) => i + 1).map((dia) => (
            <div key={dia} className="min-h-20 rounded border border-slate-800 p-1">
              <span className="text-xs text-slate-500">{dia}</span>
              <ul className="mt-1 space-y-1">
                {(porDia.get(dia) ?? []).map((post) => (
                  <li key={post.id}>
                    <button
                      type="button"
                      onClick={() => abrir(post)}
                      aria-label={`${timeFormatter.format(new Date(post.scheduledFor))} ${post.title} — ${CAMPAIGN_POST_STATUS_LABELS[post.status]}`}
                      className={`w-full truncate rounded px-1 py-0.5 text-left text-xs ${STATUS_CLASS[post.status]}`}
                    >
                      {post.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <aside className="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
        {draft === null ? (
          <button type="button" onClick={() => setDraft(emptyDraft())} className="w-full rounded bg-emerald-600 px-3 py-2 text-white">
            Novo item
          </button>
        ) : (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              salvar.mutate(draft)
            }}
          >
            {erro ? <p role="alert" className="rounded bg-red-500/20 p-2 text-sm text-red-200">{erro}</p> : null}

            <label className="block text-sm text-slate-300" htmlFor="campaign-title">Título</label>
            <input id="campaign-title" value={draft.title} disabled={draft.status === 'PUBLISHED'}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-slate-100" />

            <label className="block text-sm text-slate-300" htmlFor="campaign-body">Comunicado</label>
            <textarea id="campaign-body" rows={5} value={draft.body} maxLength={CAMPAIGN_BODY_MAX_LENGTH}
              disabled={draft.status === 'PUBLISHED'}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-slate-100" />
            <p className="text-xs text-slate-500">{draft.body.length}/{CAMPAIGN_BODY_MAX_LENGTH}</p>

            <label className="block text-sm text-slate-300" htmlFor="campaign-when">Data e hora</label>
            <input id="campaign-when" type="datetime-local" value={draft.scheduledFor}
              disabled={draft.status === 'PUBLISHED'}
              onChange={(e) => setDraft({ ...draft, scheduledFor: e.target.value })}
              className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-slate-100" />

            <label className="block text-sm text-slate-300" htmlFor="campaign-channel">Canal</label>
            <select id="campaign-channel" value={draft.channel} disabled={draft.status === 'PUBLISHED'}
              onChange={(e) => setDraft({ ...draft, channel: e.target.value as CampaignChannel })}
              className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-slate-100">
              {CAMPAIGN_CHANNELS.map((c) => <option key={c} value={c}>{CAMPAIGN_CHANNEL_LABELS[c]}</option>)}
            </select>

            <label className="block text-sm text-slate-300" htmlFor="campaign-owner">Responsável</label>
            <select id="campaign-owner" value={draft.responsibleId} disabled={draft.status === 'PUBLISHED'}
              onChange={(e) => setDraft({ ...draft, responsibleId: e.target.value })}
              className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-slate-100">
              <option value="">Sem responsável</option>
              {(colleaguesQuery.data?.users ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>

            {draft.status === 'PUBLISHED' ? (
              <p className="text-sm text-emerald-300">Este comunicado já foi publicado no Mural.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                <button type="submit" className="rounded bg-emerald-600 px-3 py-1 text-white">Salvar</button>
                {draft.id ? (
                  <>
                    <button type="button" onClick={() => publicar.mutate(draft.id!)} className="rounded bg-sky-600 px-3 py-1 text-white">
                      Publicar agora
                    </button>
                    <button type="button" onClick={() => cancelar.mutate(draft.id!)} className="rounded bg-slate-700 px-3 py-1 text-slate-200">
                      Cancelar comunicado
                    </button>
                  </>
                ) : null}
              </div>
            )}
            <button type="button" onClick={() => setDraft(null)} className="text-sm text-slate-400">Fechar</button>
          </form>
        )}
      </aside>
    </div>
  )
}
```

- [ ] **Step 2: Verificar tipos**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/admin/CampaignCalendar.tsx
git commit -m "feat(web): calendário editorial de campanhas"
```

---

### Task 12: Aba Gerar

**Files:**
- Create: `apps/web/src/pages/admin/CampaignGenerator.tsx`

**Interfaces:**
- Consumes: `previewCampaign`, `confirmCampaign` (Task 10); `ApiError` de `../../lib/api`
- Produces: `export function CampaignGenerator({ onConfirmed }: { onConfirmed: () => void })`
  — `onConfirmed` leva o usuário de volta à aba Calendário.

- [ ] **Step 1: Escrever o componente**

```tsx
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  CAMPAIGN_AUDIENCES,
  CAMPAIGN_AUDIENCE_LABELS,
  CAMPAIGN_BODY_MAX_LENGTH,
  CAMPAIGN_CHANNELS,
  CAMPAIGN_CHANNEL_LABELS,
  CAMPAIGN_QUANTITY_MAX,
  CAMPAIGN_QUANTITY_MIN,
  type CampaignAudience,
  type CampaignChannel,
  type CampaignDraftDTO,
} from '@legends/shared'
import { ApiError } from '../../lib/api'
import { confirmCampaign, previewCampaign } from '../../lib/campaign-api'

interface FormState {
  theme: string
  startsAt: string
  endsAt: string
  audience: CampaignAudience
  channel: CampaignChannel
  quantity: number
  notes: string
}

const inicial: FormState = {
  theme: '',
  startsAt: '',
  endsAt: '',
  audience: 'ALL',
  channel: 'MURAL',
  quantity: 3,
  notes: '',
}

/** `type="date"` devolve `YYYY-MM-DD`; a API quer ISO com fuso. */
function toIso(dia: string): string {
  return new Date(`${dia}T00:00:00`).toISOString()
}

export function CampaignGenerator({ onConfirmed }: { onConfirmed: () => void }) {
  const [form, setForm] = useState<FormState>(inicial)
  const [drafts, setDrafts] = useState<CampaignDraftDTO[]>([])

  const gerar = useMutation({
    mutationFn: () =>
      previewCampaign({
        theme: form.theme,
        startsAt: toIso(form.startsAt),
        endsAt: toIso(form.endsAt),
        audience: form.audience,
        channel: form.channel,
        quantity: form.quantity,
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      }),
    onSuccess: (data) => setDrafts(data.drafts),
  })

  const confirmar = useMutation({
    // Manda os cartões COMO ESTÃO no state: é isso que faz a edição do preview
    // sobreviver até o item agendado. Nunca reenviar `gerar.data.drafts`.
    mutationFn: () =>
      confirmCampaign({
        theme: form.theme,
        startsAt: toIso(form.startsAt),
        endsAt: toIso(form.endsAt),
        audience: form.audience,
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
        posts: drafts.map((d) => ({
          title: d.title,
          body: d.body,
          visualHint: d.visualHint,
          scheduledFor: d.scheduledFor,
          channel: form.channel,
        })),
      }),
    onSuccess: () => {
      setDrafts([])
      setForm(inicial)
      onConfirmed()
    },
  })

  // Sem chave da empresa a geração é 503 — mas só a geração. O calendário
  // continua inteiro na outra aba, por isso o bloco substitui o formulário e
  // não a tela.
  const semChave = gerar.error instanceof ApiError && gerar.error.status === 503
  if (semChave) {
    return (
      <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
        <p className="text-amber-200">{(gerar.error as ApiError).message}</p>
        <a href="/admin/ia" className="mt-2 inline-block text-sm text-emerald-300 underline">
          Configurar a chave de IA
        </a>
        <button type="button" onClick={() => gerar.reset()} className="ml-4 text-sm text-slate-400">
          Tentar de novo
        </button>
      </div>
    )
  }

  const atualizar = (index: number, campo: keyof CampaignDraftDTO, valor: string) =>
    setDrafts((atual) => atual.map((d, i) => (i === index ? { ...d, [campo]: valor } : d)))

  return (
    <div className="space-y-6">
      <form
        className="grid gap-3 rounded-lg border border-slate-700 bg-slate-900/50 p-4 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault()
          gerar.mutate()
        }}
      >
        <div className="md:col-span-2">
          <label htmlFor="gen-theme" className="block text-sm text-slate-300">Tema da campanha</label>
          <input id="gen-theme" required value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value })}
            className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-slate-100" />
        </div>

        <div>
          <label htmlFor="gen-start" className="block text-sm text-slate-300">Data inicial</label>
          <input id="gen-start" type="date" required value={form.startsAt}
            onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
            className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-slate-100" />
        </div>

        <div>
          <label htmlFor="gen-end" className="block text-sm text-slate-300">Data final</label>
          <input id="gen-end" type="date" required value={form.endsAt}
            onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
            className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-slate-100" />
        </div>

        <div>
          <label htmlFor="gen-audience" className="block text-sm text-slate-300">Público</label>
          <select id="gen-audience" value={form.audience}
            onChange={(e) => setForm({ ...form, audience: e.target.value as CampaignAudience })}
            className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-slate-100">
            {CAMPAIGN_AUDIENCES.map((a) => <option key={a} value={a}>{CAMPAIGN_AUDIENCE_LABELS[a]}</option>)}
          </select>
        </div>

        <div>
          <label htmlFor="gen-channel" className="block text-sm text-slate-300">Canal</label>
          <select id="gen-channel" value={form.channel}
            onChange={(e) => setForm({ ...form, channel: e.target.value as CampaignChannel })}
            className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-slate-100">
            {CAMPAIGN_CHANNELS.map((c) => <option key={c} value={c}>{CAMPAIGN_CHANNEL_LABELS[c]}</option>)}
          </select>
        </div>

        <div>
          <label htmlFor="gen-quantity" className="block text-sm text-slate-300">Quantidade</label>
          <input id="gen-quantity" type="number" min={CAMPAIGN_QUANTITY_MIN} max={CAMPAIGN_QUANTITY_MAX}
            value={form.quantity} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
            className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-slate-100" />
        </div>

        <div className="md:col-span-2">
          <label htmlFor="gen-notes" className="block text-sm text-slate-300">Observações (opcional)</label>
          <textarea id="gen-notes" rows={2} value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-slate-100" />
        </div>

        {gerar.error && !semChave ? (
          <p role="alert" className="md:col-span-2 rounded bg-red-500/20 p-2 text-sm text-red-200">
            {(gerar.error as Error).message}
          </p>
        ) : null}

        <div className="md:col-span-2">
          <button type="submit" disabled={gerar.isPending} className="rounded bg-emerald-600 px-4 py-2 text-white disabled:opacity-50">
            {gerar.isPending ? 'Gerando…' : 'Gerar comunicados'}
          </button>
        </div>
      </form>

      {drafts.length > 0 ? (
        <div className="space-y-4">
          <p className="rounded border border-sky-500/40 bg-sky-500/10 p-3 text-sm text-sky-200">
            Nada foi gravado ainda. Os comunicados só entram no calendário quando você confirmar.
          </p>

          {drafts.map((draft, index) => (
            <article key={index} className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/50 p-4">
              <div className="flex items-center justify-between">
                <input value={draft.title} aria-label={`Título do comunicado ${index + 1}`}
                  onChange={(e) => atualizar(index, 'title', e.target.value)}
                  className="flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-slate-100" />
                <button type="button" onClick={() => setDrafts(drafts.filter((_, i) => i !== index))}
                  className="ml-2 text-sm text-slate-400">
                  Descartar
                </button>
              </div>

              <textarea rows={4} value={draft.body} maxLength={CAMPAIGN_BODY_MAX_LENGTH}
                aria-label={`Comunicado ${index + 1}`}
                onChange={(e) => atualizar(index, 'body', e.target.value)}
                className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-slate-100" />
              <p className="text-xs text-slate-500">{draft.body.length}/{CAMPAIGN_BODY_MAX_LENGTH}</p>

              <input value={draft.visualHint ?? ''} aria-label={`Sugestão visual do comunicado ${index + 1}`}
                onChange={(e) => atualizar(index, 'visualHint', e.target.value)}
                className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-300" />

              <input type="datetime-local" aria-label={`Data do comunicado ${index + 1}`}
                value={draft.scheduledFor.slice(0, 16)}
                onChange={(e) => atualizar(index, 'scheduledFor', new Date(e.target.value).toISOString())}
                className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-slate-100" />
            </article>
          ))}

          {form.audience === 'LEADERSHIP' ? (
            <p className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
              O Mural da empresa não separa público: ao publicar, o comunicado aparece para todos os colaboradores.
            </p>
          ) : null}

          {form.channel !== 'MURAL' ? (
            <p className="rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
              A entrega por {CAMPAIGN_CHANNEL_LABELS[form.channel]} ainda é manual — o Legends registra o
              agendamento, mas não envia.
            </p>
          ) : null}

          {confirmar.error ? (
            <p role="alert" className="rounded bg-red-500/20 p-2 text-sm text-red-200">
              {(confirmar.error as Error).message}
            </p>
          ) : null}

          <button type="button" disabled={confirmar.isPending} onClick={() => confirmar.mutate()}
            className="rounded bg-emerald-600 px-4 py-2 text-white disabled:opacity-50">
            Confirmar e agendar
          </button>
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 2: Verificar tipos**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/admin/CampaignGenerator.tsx
git commit -m "feat(web): geração de campanha com preview editável"
```

---

### Task 13: Casca com abas, rota, menu e testes da tela

**Files:**
- Create: `apps/web/src/pages/admin/CampaignsSection.tsx`
- Create: `apps/web/src/pages/admin/CampaignsSection.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/pages/admin/AdminSidebar.tsx`

**Interfaces:**
- Consumes: `CampaignCalendar` (Task 11), `CampaignGenerator` (Task 12)
- Produces: `export function CampaignsSection()`

- [ ] **Step 1: Escrever o teste que falha**

`apps/web/src/pages/admin/CampaignsSection.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CampaignPostDTO } from '@legends/shared'
import { ApiError } from '../../lib/api'
import { CampaignsSection } from './CampaignsSection'

const previewCampaign = vi.fn()
const confirmCampaign = vi.fn()
const listCampaignPosts = vi.fn()
const publishCampaignPost = vi.fn()

vi.mock('../../lib/campaign-api', () => ({
  previewCampaign: (body: unknown) => previewCampaign(body),
  confirmCampaign: (body: unknown) => confirmCampaign(body),
  listCampaignPosts: (from: string, to: string) => listCampaignPosts(from, to),
  createCampaignPost: vi.fn(),
  updateCampaignPost: vi.fn(),
  publishCampaignPost: (id: string) => publishCampaignPost(id),
  cancelCampaignPost: vi.fn(),
}))

const post = (over: Partial<CampaignPostDTO> = {}): CampaignPostDTO => ({
  id: 'cp1',
  campaignId: 'c1',
  campaignTheme: 'Semana da segurança',
  title: 'Abertura',
  body: 'Começa a semana da segurança.',
  visualHint: null,
  scheduledFor: '2026-09-01T12:00:00.000Z',
  channel: 'MURAL',
  audience: 'ALL',
  status: 'SCHEDULED',
  responsibleId: null,
  responsibleName: null,
  publishedPostId: null,
  publishedAt: null,
  createdAt: '2026-08-01T12:00:00.000Z',
  ...over,
})

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CampaignsSection />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  listCampaignPosts.mockResolvedValue({ posts: [post()] })
})

describe('CampaignsSection', () => {
  it('abre no calendário e mostra os itens do mês', async () => {
    renderSection()
    expect(await screen.findByText('Abertura')).toBeInTheDocument()
  })

  it('gera N cartões no preview sem gravar nada', async () => {
    previewCampaign.mockResolvedValue({
      drafts: [
        { title: 'A', body: 'Corpo A', visualHint: null, scheduledFor: '2026-09-01T12:00:00.000Z' },
        { title: 'B', body: 'Corpo B', visualHint: null, scheduledFor: '2026-09-03T12:00:00.000Z' },
      ],
    })
    const user = userEvent.setup()
    renderSection()

    await user.click(screen.getByRole('tab', { name: /gerar/i }))
    await user.type(screen.getByLabelText(/tema/i), 'Semana da segurança')
    await user.type(screen.getByLabelText(/data inicial/i), '2026-09-01')
    await user.type(screen.getByLabelText(/data final/i), '2026-09-10')
    await user.clear(screen.getByLabelText(/quantidade/i))
    await user.type(screen.getByLabelText(/quantidade/i), '2')
    await user.click(screen.getByRole('button', { name: /gerar comunicados/i }))

    expect(await screen.findByDisplayValue('Corpo A')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Corpo B')).toBeInTheDocument()
    expect(confirmCampaign).not.toHaveBeenCalled()
    expect(screen.getByText(/nada foi gravado ainda/i)).toBeInTheDocument()
  })

  it('preserva a edição do rascunho ao confirmar', async () => {
    previewCampaign.mockResolvedValue({
      drafts: [{ title: 'A', body: 'Corpo A', visualHint: null, scheduledFor: '2026-09-01T12:00:00.000Z' }],
    })
    confirmCampaign.mockResolvedValue({ posts: [post()] })
    const user = userEvent.setup()
    renderSection()

    await user.click(screen.getByRole('tab', { name: /gerar/i }))
    await user.type(screen.getByLabelText(/tema/i), 'Tema')
    await user.type(screen.getByLabelText(/data inicial/i), '2026-09-01')
    await user.type(screen.getByLabelText(/data final/i), '2026-09-10')
    await user.click(screen.getByRole('button', { name: /gerar comunicados/i }))

    const corpo = await screen.findByDisplayValue('Corpo A')
    await user.clear(corpo)
    await user.type(corpo, 'Corpo EDITADO')
    await user.click(screen.getByRole('button', { name: /confirmar e agendar/i }))

    await waitFor(() => expect(confirmCampaign).toHaveBeenCalled())
    expect(confirmCampaign.mock.calls[0][0].posts[0].body).toBe('Corpo EDITADO')
  })

  it('avisa que o mural não separa público quando o alvo é liderança', async () => {
    previewCampaign.mockResolvedValue({
      drafts: [{ title: 'A', body: 'Corpo A', visualHint: null, scheduledFor: '2026-09-01T12:00:00.000Z' }],
    })
    const user = userEvent.setup()
    renderSection()

    await user.click(screen.getByRole('tab', { name: /gerar/i }))
    await user.selectOptions(screen.getByLabelText(/público/i), 'LEADERSHIP')
    await user.type(screen.getByLabelText(/tema/i), 'Tema')
    await user.type(screen.getByLabelText(/data inicial/i), '2026-09-01')
    await user.type(screen.getByLabelText(/data final/i), '2026-09-10')
    await user.click(screen.getByRole('button', { name: /gerar comunicados/i }))

    expect(await screen.findByText(/não separa público/i)).toBeInTheDocument()
  })

  it('mostra o 503 na aba Gerar sem derrubar o calendário', async () => {
    previewCampaign.mockRejectedValue(new ApiError(503, 'Agente de IA não configurado.'))
    const user = userEvent.setup()
    renderSection()

    await user.click(screen.getByRole('tab', { name: /gerar/i }))
    await user.type(screen.getByLabelText(/tema/i), 'Tema')
    await user.type(screen.getByLabelText(/data inicial/i), '2026-09-01')
    await user.type(screen.getByLabelText(/data final/i), '2026-09-10')
    await user.click(screen.getByRole('button', { name: /gerar comunicados/i }))

    expect(await screen.findByText(/não configurado/i)).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /calendário/i }))
    expect(await screen.findByText('Abertura')).toBeInTheDocument()
  })
})
```

`ApiError` é `constructor(status: number, message: string, payload?)` — a ordem
usada acima está correta.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web exec vitest run src/pages/admin/CampaignsSection.test.tsx`
Expected: FAIL — `Failed to resolve import './CampaignsSection'`

- [ ] **Step 3: Escrever a casca**

`apps/web/src/pages/admin/CampaignsSection.tsx`:

```tsx
import { useState } from 'react'
import { CampaignCalendar } from './CampaignCalendar'
import { CampaignGenerator } from './CampaignGenerator'

type Tab = 'calendar' | 'generate'

/**
 * Calendário editorial de comunicação interna. A aba Calendário é a padrão de
 * propósito: sem chave de IA a aba Gerar não funciona, e a tela precisa
 * continuar útil mesmo assim.
 */
export function CampaignsSection() {
  const [tab, setTab] = useState<Tab>('calendar')

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-slate-100">Campanhas de comunicação</h1>
        <p className="text-sm text-slate-400">
          Planeje a comunicação interna: gere comunicados com IA, revise, agende e publique no Mural da empresa.
        </p>
      </header>

      <div role="tablist" aria-label="Campanhas" className="flex gap-2 border-b border-slate-700">
        <button
          role="tab"
          type="button"
          aria-selected={tab === 'calendar'}
          onClick={() => setTab('calendar')}
          className={tab === 'calendar' ? 'border-b-2 border-emerald-400 px-4 py-2 text-slate-100' : 'px-4 py-2 text-slate-400'}
        >
          Calendário
        </button>
        <button
          role="tab"
          type="button"
          aria-selected={tab === 'generate'}
          onClick={() => setTab('generate')}
          className={tab === 'generate' ? 'border-b-2 border-emerald-400 px-4 py-2 text-slate-100' : 'px-4 py-2 text-slate-400'}
        >
          Gerar
        </button>
      </div>

      {tab === 'calendar' ? <CampaignCalendar /> : <CampaignGenerator onConfirmed={() => setTab('calendar')} />}
    </section>
  )
}
```

- [ ] **Step 4: Registrar a rota**

Em `apps/web/src/App.tsx`, importe e adicione junto das outras rotas de admin:

```tsx
import { CampaignsSection } from './pages/admin/CampaignsSection'
// ...
<Route path="campanhas" element={<AdminSectorFeatureOnly feature="gente-gestao"><CampaignsSection /></AdminSectorFeatureOnly>} />
```

- [ ] **Step 5: Registrar no menu**

Em `apps/web/src/pages/admin/AdminSidebar.tsx`, no mesmo grupo de Benchmarking:

```ts
      { to: '/admin/campanhas', label: 'Campanhas', featureKey: 'gente-gestao' },
```

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @legends/web exec vitest run src/pages/admin/CampaignsSection.test.tsx`
Expected: PASS (5 testes)

Se algum teste falhar por rótulo (`getByLabelText`), ajuste o `<label htmlFor>`
do componente da Task 11/12 — não relaxe o seletor do teste.

- [ ] **Step 7: Rodar os testes do menu**

Run: `pnpm --filter @legends/web exec vitest run src/pages/admin/AdminSidebar.test.tsx`
Expected: PASS — o teste conta itens por feature; se ele travar o total, atualize
o número esperado.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/pages/admin/CampaignsSection.tsx apps/web/src/pages/admin/CampaignsSection.test.tsx apps/web/src/App.tsx apps/web/src/pages/admin/AdminSidebar.tsx
git commit -m "feat(web): tela de campanhas com abas Calendário e Gerar"
```

---

### Task 14: Verificação final

- [ ] **Step 1: Typecheck dos três workspaces**

```bash
pnpm --filter @legends/shared exec tsc --noEmit
pnpm --filter @legends/api exec tsc --noEmit
pnpm --filter @legends/web exec tsc --noEmit
```

Expected: sem erros. Use o binário direto — `npx tsc` é interceptado e mente.

- [ ] **Step 2: Suíte completa**

Garanta que nenhum outro worktree está rodando vitest contra o mesmo
`legends_test` — a colisão produz centenas de falhas fantasma.

```bash
pnpm db:up
LEGENDS_DB_PORT=5482 pnpm test
```

Expected: PASS

- [ ] **Step 3: Conferir os critérios de aceite do spec**

Um a um, apontando o teste que cobre cada:

| Critério | Coberto por |
|---|---|
| Gerar N devolve N, todos na janela | Task 3 Step 1, Task 6 Step 1 |
| Preview não grava nada | Task 6 Step 1, Task 9 Step 1 |
| Edição do rascunho sobrevive ao confirmar | Task 7 Step 1, Task 13 Step 1 |
| Data final anterior à inicial → 400 em português | Task 9 Step 1 |
| Sem chave de IA → 503 e calendário utilizável | Task 6 Step 1, Task 13 Step 1 |
| JSON inválido → erro tratado, nada pela metade | Task 4 Step 1, Task 6 Step 1 |
| Publicar cria post e liga `publishedPostId`; cancelar não cria | Task 8 Step 1 |

- [ ] **Step 4: Commit final se algo mudou**

```bash
git add -A
git commit -m "chore: ajustes finais das campanhas de comunicação"
```

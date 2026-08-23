# Desafios e fila de resultados — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trazer para o Legends o fluxo de desafios do portal EMR — participar, moderar numa fila paginada, aprovar (creditando coins exatamente uma vez) ou rejeitar com motivo, notificar a pessoa e exportar o recorte filtrado em CSV.

**Architecture:** Rota fina → service → Prisma, como no resto do repo. Dois models novos (`Challenge`, `ChallengeSubmission`) sob `scopedPrisma(companyId)`. O crédito reusa o livro-razão `CoinTransaction` (append-only, unique `(userId, dedupeKey)`) através de uma função nova no `coin-service`. A idempotência da aprovação vem de um `updateMany` condicional em `status: 'PENDING'` dentro de `$transaction` — é ele que tira o lock da linha — com o `dedupeKey` como segunda rede.

**Tech Stack:** Fastify 4, Prisma 5, PostgreSQL, Zod, Vitest (Postgres real), React 18 + React Query + Tailwind, TypeScript ESM strict.

**Spec:** `docs/superpowers/specs/2026-08-01-desafios-fila-resultados-design.md`

## Global Constraints

- Textos voltados ao usuário em **português**.
- TypeScript **strict**, ESM puro.
- Todo model novo leva `companyId` e entra em `TENANT_SCOPED_MODELS` (`apps/api/src/lib/tenant-scope.ts`); toda leitura/escrita passa por `scopedPrisma(companyId)`.
- Contrato primeiro: tipos e constantes em `packages/shared/src/*.ts` + barril `index.ts`, e só então os dois lados.
- Rota fina: Zod `safeParse` → `400 { message, issues }`; regra de negócio só no service; erro de domínio é classe tipada com `status`.
- Mutação de admin grava auditoria com `recordAuditLog`, **dentro da mesma transação** quando houver.
- Migration nova via `prisma migrate dev`; **nunca** editar migration já aplicada.
- Testes Vitest colocados ao lado do arquivo. Postgres precisa estar de pé: `pnpm db:up`. **Nesta máquina o Postgres responde na porta padrão 5432 — não exportar `LEGENDS_DB_PORT`.**
- **Estilo do web:** os blocos de código React deste plano usam Tailwind cru (`slate-*`) por descuido de autoria. **O repo não é assim** — toda página em `apps/web/src/pages/` usa os tokens de design (`text-on-surface`, `bg-surface`, `text-error`) e as seções de admin usam os helpers de `pages/admin/shared.tsx` (`Panel`, `inputCls`). Siga a vizinhança (`CoinsSection.tsx` é o modelo mais próximo das seções de admin), não o CSS literal dos blocos abaixo. Estrutura, labels, ids e corpos de requisição valem verbatim; classes CSS, não.
- Durante a implementação rode só o arquivo de teste alterado. A suíte completa (`pnpm test`) é a verificação final, antes de concluir.
- A unicidade de submissão ativa é um índice **parcial que vive só no SQL da migration** — `schema.prisma` **não** declara `@@unique([challengeId, userId])` (declarar faz todo `migrate dev` futuro propor recriá-lo sem o `WHERE`, gerando uma migration que falha ao aplicar). Consequência prática: não existe `findUnique` composto para esta tabela; use `findFirst`. Violação chega como `P2002`.

---

## File Structure

**Criar:**

| Arquivo | Responsabilidade |
| --- | --- |
| `packages/shared/src/challenge.ts` | Contrato: status, DTOs, limites, resultado do lote |
| `packages/shared/src/challenge.test.ts` | Testa as constantes do contrato |
| `apps/api/src/services/challenge-service.ts` | CRUD do desafio, lista do colaborador, `createSubmission` |
| `apps/api/src/services/challenge-service.test.ts` | Testes do acima |
| `apps/api/src/services/challenge-submission-service.ts` | Fila, decisão, lote, CSV |
| `apps/api/src/services/challenge-submission-service.test.ts` | Testes do acima |
| `apps/api/src/routes/challenges.ts` | Rotas do colaborador |
| `apps/api/src/routes/challenges.test.ts` | Testes das rotas do colaborador |
| `apps/api/src/routes/admin.challenges.ts` | Rotas de admin (CRUD + fila + decisão + CSV) |
| `apps/api/src/routes/admin.challenges.test.ts` | Testes das rotas de admin |
| `apps/web/src/pages/ChallengesPage.tsx` | Tela do colaborador em `/desafios` |
| `apps/web/src/pages/ChallengesPage.test.tsx` | Testes da tela do colaborador |
| `apps/web/src/pages/admin/ChallengesSection.tsx` | CRUD do desafio |
| `apps/web/src/pages/admin/ChallengesSection.test.tsx` | Testes do CRUD |
| `apps/web/src/pages/admin/ChallengeSubmissionsSection.tsx` | A fila de resultados |
| `apps/web/src/pages/admin/ChallengeSubmissionsSection.test.tsx` | Testes da fila |

**Modificar:**

| Arquivo | O quê |
| --- | --- |
| `packages/shared/src/index.ts` | `export * from './challenge'` |
| `packages/shared/src/notification.ts` | dois `NotificationType` novos |
| `apps/api/prisma/schema.prisma` | models, enum, `CoinEvent`, `NotificationType`, back-relations |
| `apps/api/src/lib/tenant-scope.ts` | `Challenge` e `ChallengeSubmission` em `TENANT_SCOPED_MODELS` |
| `apps/api/src/services/coin-service.ts` | `awardFixedCoins` |
| `apps/api/src/services/notification-service.ts` | `notifyChallengeReviewed` + emoji |
| `apps/api/src/lib/serialize.ts` | `toChallengeDTO`, `toChallengeSubmissionDTO` |
| `apps/api/src/app.ts` | registrar as duas rotas novas |
| `apps/web/src/App.tsx` | rota `/desafios` e duas rotas sob `/admin` |
| `apps/web/src/pages/admin/AdminSidebar.tsx` | dois itens no grupo Comunidade |

---

## Task 1: Contrato em `@legends/shared`

**Files:**
- Create: `packages/shared/src/challenge.ts`
- Create: `packages/shared/src/challenge.test.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/notification.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `CHALLENGE_SUBMISSION_STATUSES`, `ChallengeSubmissionStatus`, `CHALLENGE_NOTE_MAX_LENGTH`, `REJECTION_REASON_MIN_LENGTH`, `REJECTION_REASON_MAX_LENGTH`, `CHALLENGE_SUBMISSION_PAGE_SIZE`, `CHALLENGE_EXPORT_MAX_ROWS`, `ChallengeDTO`, `ChallengeSubmissionDTO`, `ChallengeSubmissionPage`, `MyChallengeDTO`, `ChallengeBatchResult`, `ChallengeBatchDecision`.

- [ ] **Step 1: Escrever o teste que falha**

`packages/shared/src/challenge.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  CHALLENGE_SUBMISSION_STATUSES,
  CHALLENGE_EXPORT_MAX_ROWS,
  REJECTION_REASON_MIN_LENGTH,
} from './challenge'
import { NOTIFICATION_TYPES } from './notification'

describe('contrato de desafios', () => {
  it('tem exatamente os três status na ordem do fluxo', () => {
    expect(CHALLENGE_SUBMISSION_STATUSES).toEqual(['PENDING', 'APPROVED', 'REJECTED'])
  })

  it('exige motivo com tamanho mínimo na rejeição', () => {
    expect(REJECTION_REASON_MIN_LENGTH).toBeGreaterThan(0)
  })

  it('limita o export para não derrubar a API', () => {
    expect(CHALLENGE_EXPORT_MAX_ROWS).toBe(5000)
  })

  it('registra os tipos de notificação da decisão', () => {
    expect(NOTIFICATION_TYPES).toContain('CHALLENGE_SUBMISSION_APPROVED')
    expect(NOTIFICATION_TYPES).toContain('CHALLENGE_SUBMISSION_REJECTED')
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm --filter @legends/shared exec vitest run src/challenge.test.ts`
Expected: FAIL — `Cannot find module './challenge'`.

- [ ] **Step 3: Criar o contrato**

`packages/shared/src/challenge.ts`:

```ts
export const CHALLENGE_SUBMISSION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const
export type ChallengeSubmissionStatus = (typeof CHALLENGE_SUBMISSION_STATUSES)[number]

export const CHALLENGE_TITLE_MAX_LENGTH = 120
export const CHALLENGE_DESCRIPTION_MAX_LENGTH = 2000
export const CHALLENGE_NOTE_MAX_LENGTH = 500
export const REJECTION_REASON_MIN_LENGTH = 10
export const REJECTION_REASON_MAX_LENGTH = 500
export const CHALLENGE_SUBMISSION_PAGE_SIZE = 20
export const CHALLENGE_EXPORT_MAX_ROWS = 5000
export const CHALLENGE_BATCH_MAX_ITEMS = 100

export interface ChallengeDTO {
  id: string
  title: string
  description: string
  rewardCoins: number
  active: boolean
  startsAt: string | null
  endsAt: string | null
  /** null = desafio da empresa inteira. */
  sectorId: string | null
  sectorName: string | null
  submissionCount: number
}

export interface ChallengeSubmissionDTO {
  id: string
  status: ChallengeSubmissionStatus
  note: string | null
  /** URL assinada da evidência, ou null. Nunca a chave crua do S3. */
  evidenceUrl: string | null
  submittedAt: string
  reviewedAt: string | null
  rejectionReason: string | null
  /** Pessoa e desafio já resolvidos: a tabela da fila não faz N+1. */
  user: { id: string; name: string; email: string; photoUrl: string | null }
  challenge: { id: string; title: string; rewardCoins: number }
  reviewedBy: { id: string; name: string } | null
}

export interface ChallengeSubmissionPage {
  items: ChallengeSubmissionDTO[]
  nextCursor: string | null
}

/** Desafio na visão do colaborador, com o estado da própria submissão. */
export interface MyChallengeDTO extends ChallengeDTO {
  mySubmission: ChallengeSubmissionDTO | null
}

export type ChallengeBatchDecision = 'APPROVE' | 'REJECT'

export interface ChallengeBatchResult {
  succeeded: string[]
  failed: { id: string; message: string }[]
}

export interface CreateChallengeSubmissionRequest {
  note?: string
  evidenceKey?: string
}
```

- [ ] **Step 4: Exportar no barril e somar os tipos de notificação**

Em `packages/shared/src/index.ts`, adicionar após a linha `export * from './coin'`:

```ts
export * from './challenge'
```

Em `packages/shared/src/notification.ts`, dentro de `NOTIFICATION_TYPES`, adicionar antes do fechamento `] as const`:

```ts
  'CHALLENGE_SUBMISSION_APPROVED',
  'CHALLENGE_SUBMISSION_REJECTED',
```

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `pnpm --filter @legends/shared exec vitest run src/challenge.test.ts`
Expected: PASS, 4 testes.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/challenge.ts packages/shared/src/challenge.test.ts \
        packages/shared/src/index.ts packages/shared/src/notification.ts
git commit -m "feat(shared): contrato de desafios e submissões"
```

---

## Task 2: Schema, migration com índice parcial e tenant-scope

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_add_challenges/migration.sql` (gerada, com edição à mão)
- Modify: `apps/api/src/lib/tenant-scope.ts`
- Create: `apps/api/src/services/challenge-service.test.ts` (só o primeiro teste, o do índice)

**Interfaces:**
- Consumes: Task 1 (nada em runtime).
- Produces: models `Challenge` e `ChallengeSubmission`, enum `ChallengeSubmissionStatus`, `CoinEvent.CHALLENGE_APPROVED`, `NotificationType.CHALLENGE_SUBMISSION_APPROVED|REJECTED`.

- [ ] **Step 1: Escrever o teste que falha**

`apps/api/src/services/challenge-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'

async function makeUser(email: string) {
  return prisma.user.create({
    data: { name: 'Pessoa', email, passwordHash: 'x', role: 'LEGEND', sectorId: DEFAULT_SECTOR_ID },
  })
}

async function makeChallenge(rewardCoins = 100) {
  const admin = await makeUser(`admin-${Math.random()}@x.com`)
  return prisma.challenge.create({
    data: {
      title: 'Ler um livro técnico',
      description: 'Leia e conte o que aprendeu.',
      rewardCoins,
      companyId: DEFAULT_COMPANY_ID,
      createdById: admin.id,
    },
  })
}

describe('índice único parcial de submissão ativa', () => {
  it('barra a segunda submissão não-rejeitada e libera após rejeição', async () => {
    const challenge = await makeChallenge()
    const user = await makeUser('dup@x.com')
    const base = { challengeId: challenge.id, userId: user.id, companyId: DEFAULT_COMPANY_ID }

    const first = await prisma.challengeSubmission.create({ data: base })

    await expect(prisma.challengeSubmission.create({ data: base })).rejects.toMatchObject({
      code: 'P2002',
    })

    await prisma.challengeSubmission.update({
      where: { id: first.id },
      data: { status: 'REJECTED', rejectionReason: 'Sem evidência.' },
    })

    // Rejeitada sai do índice: a nova tentativa passa.
    const second = await prisma.challengeSubmission.create({ data: base })
    expect(second.status).toBe('PENDING')

    // E a aprovada também ocupa a vaga: não dá pra submeter de novo.
    await prisma.challengeSubmission.update({ where: { id: second.id }, data: { status: 'APPROVED' } })
    await expect(prisma.challengeSubmission.create({ data: base })).rejects.toMatchObject({
      code: 'P2002',
    })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm db:up && pnpm --filter @legends/api exec vitest run src/services/challenge-service.test.ts`
Expected: FAIL — `prisma.challenge` não existe.

- [ ] **Step 3: Somar os models ao schema**

Em `apps/api/prisma/schema.prisma`:

No `enum CoinEvent`, somar `CHALLENGE_APPROVED` como último valor.
No `enum NotificationType`, somar `CHALLENGE_SUBMISSION_APPROVED` e `CHALLENGE_SUBMISSION_REJECTED`.

Adicionar o enum e os models (junto dos models de coins, no fim do arquivo):

```prisma
enum ChallengeSubmissionStatus {
  PENDING
  APPROVED
  REJECTED
}

/// Desafio proposto pela empresa ou por um setor. A recompensa é por desafio —
/// não passa por CoinRule, que só sabe valor fixo por evento.
model Challenge {
  id          String    @id @default(cuid())
  title       String
  description String
  /// Coins creditados na aprovação. <= 0 não gera lançamento no extrato.
  rewardCoins Int
  active      Boolean   @default(true)
  /// Janela opcional; null dos dois lados = aberto enquanto `active`.
  startsAt    DateTime?
  endsAt      DateTime?
  /// null = desafio da empresa inteira (só ADMIN cria e modera).
  sectorId    String?
  companyId   String    @default("company-emr")
  createdById String
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  sector      Sector?               @relation(fields: [sectorId], references: [id])
  company     Company               @relation(fields: [companyId], references: [id])
  createdBy   User                  @relation("ChallengesCreated", fields: [createdById], references: [id])
  submissions ChallengeSubmission[]

  @@index([companyId, active])
  @@index([companyId, sectorId])
}

model ChallengeSubmission {
  id              String                    @id @default(cuid())
  challengeId     String
  userId          String
  status          ChallengeSubmissionStatus @default(PENDING)
  note            String?
  /// Chave S3 da evidência opcional; o DTO expõe URL assinada, nunca a chave.
  evidenceKey     String?
  submittedAt     DateTime                  @default(now())
  reviewedAt      DateTime?
  reviewedById    String?
  rejectionReason String?
  companyId       String                    @default("company-emr")

  challenge  Challenge @relation(fields: [challengeId], references: [id], onDelete: Cascade)
  user       User      @relation("ChallengeSubmissions", fields: [userId], references: [id], onDelete: Cascade)
  reviewedBy User?     @relation("ChallengeSubmissionsReviewed", fields: [reviewedById], references: [id], onDelete: SetNull)
  company    Company   @relation(fields: [companyId], references: [id])

  /// Uma submissão ativa por (desafio, pessoa) é garantida por um índice único
  /// PARCIAL que vive só no SQL da migration (WHERE status <> 'REJECTED') — o
  /// Prisma não sabe representar índice parcial, e declará-lo aqui faria todo
  /// `migrate dev` futuro propor recriá-lo sem o WHERE. Violação chega como P2002.
  @@index([companyId, status, submittedAt])
  @@index([challengeId])
  @@index([userId])
}
```

E as back-relations obrigatórias:
- em `model Sector`: `challenges Challenge[]`
- em `model Company`: `challenges Challenge[]` e `challengeSubmissions ChallengeSubmission[]`
- em `model User`: `challengesCreated Challenge[] @relation("ChallengesCreated")`, `challengeSubmissions ChallengeSubmission[] @relation("ChallengeSubmissions")`, `challengeSubmissionsReviewed ChallengeSubmission[] @relation("ChallengeSubmissionsReviewed")`

- [ ] **Step 4: Gerar a migration SEM aplicar**

Run: `pnpm --filter @legends/api exec prisma migrate dev --name add_challenges --create-only`
Expected: cria `apps/api/prisma/migrations/<timestamp>_add_challenges/migration.sql` sem tocar o banco.

- [ ] **Step 5: Acrescentar o índice parcial à mão**

Como o schema **não** declara `@@unique([challengeId, userId])`, o Prisma não gera
índice nenhum para esse par. Acrescente-o ao fim do `migration.sql` recém-criado:

```sql
-- Índice PARCIAL: uma submissão ativa (pendente ou aprovada) por pessoa/desafio.
-- Rejeitadas ficam de fora, então a pessoa pode tentar de novo e o histórico do
-- motivo permanece.
--
-- Vive só aqui, de propósito: o Prisma 5 não representa índice único parcial no
-- data model (prisma/prisma#3388). Declarar um @@unique equivalente no schema faz
-- todo `migrate dev` futuro propor recriá-lo SEM o WHERE e SEM dropar este antes —
-- uma migration que falha ao aplicar, por nome duplicado. Sem a declaração, o
-- `migrate diff` volta vazio e o Postgres segue aplicando a regra: violação chega
-- ao service como P2002.
CREATE UNIQUE INDEX "ChallengeSubmission_challengeId_userId_key" ON "ChallengeSubmission"("challengeId", "userId") WHERE status <> 'REJECTED';
```

- [ ] **Step 6: Aplicar a migration e regenerar o client**

Run: `pnpm db:migrate && pnpm db:generate`
Expected: migration aplicada, nenhuma migration adicional proposta (sem drift).

- [ ] **Step 7: Registrar os models no tenant-scope**

Em `apps/api/src/lib/tenant-scope.ts`, no `TENANT_SCOPED_MODELS`, após `'CoinTransaction',`:

```ts
  'Challenge',
  'ChallengeSubmission',
```

- [ ] **Step 8: Rodar o teste e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/services/challenge-service.test.ts`
Expected: PASS.

- [ ] **Step 9: Confirmar que não há drift**

`migrate dev` é interativo e aborta sem TTY; e o banco de dev é compartilhado entre
worktrees, então ele pode pedir reset — **nunca aceite**. Use o `migrate diff`, que é
o mesmo motor, não é interativo e não toca em banco real:

```bash
docker exec legends-db psql -U legends -d postgres -c 'CREATE DATABASE legends_drift_check;'
cd apps/api && ./node_modules/.bin/prisma migrate diff \
  --from-migrations ./prisma/migrations \
  --to-schema-datamodel ./prisma/schema.prisma \
  --shadow-database-url "postgresql://legends:legends@localhost:5432/legends_drift_check?schema=public" \
  --script
docker exec legends-db psql -U legends -d postgres -c 'DROP DATABASE legends_drift_check;'
```

Expected: `-- This is an empty migration.` — e **nada** mencionando
`ChallengeSubmission_challengeId_userId_key`. Se aparecer um `CREATE UNIQUE INDEX`
para esse par, o `@@unique` voltou ao `schema.prisma`: remova-o.

- [ ] **Step 10: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations \
        apps/api/src/lib/tenant-scope.ts apps/api/src/services/challenge-service.test.ts
git commit -m "feat(api): models Challenge e ChallengeSubmission com unique parcial"
```

---

## Task 3: `awardFixedCoins` no coin-service

**Files:**
- Modify: `packages/shared/src/coin.ts`
- Modify: `apps/web/src/pages/admin/CoinsSection.tsx`
- Modify: `apps/api/src/services/coin-service.ts`
- Modify: `apps/api/src/services/coin-service.test.ts`

**Interfaces:**
- Consumes: Task 2 (`CoinEvent.CHALLENGE_APPROVED`).
- Produces também: `COIN_RULE_EVENTS` em `@legends/shared`.
- Produces:

```ts
export interface AwardFixedCoinsInput {
  userId: string
  companyId: string
  amount: number
  event: CoinEvent
  /** Referência única da ação (id da submissão). Compõe o dedupeKey. */
  reference: string
  /** Transação em curso; quando presente, o crédito entra nela. */
  tx?: Prisma.TransactionClient
  now?: Date
}
export type AwardFixedCoinsOutcome =
  | { status: 'CREDITED'; amount: number; transactionId: string }
  | { status: 'SKIPPED' }
  | { status: 'DUPLICATE' }
export async function awardFixedCoins(input: AwardFixedCoinsInput): Promise<AwardFixedCoinsOutcome>
```

- [ ] **Step 0: Somar `CHALLENGE_APPROVED` ao contrato de coins**

O enum `CoinEvent` do Prisma cresceu na Task 2, mas o contrato de `@legends/shared`
não. Sem isto, um lançamento de desafio no extrato do colaborador renderiza rótulo
`undefined` (`CoinsTab.tsx:25` e `CoinPanel.tsx:67` fazem
`COIN_EVENT_LABELS[entry.event]` direto).

Em `packages/shared/src/coin.ts`, somar `'CHALLENGE_APPROVED'` ao fim de
`COIN_EVENTS` e as entradas correspondentes:

```ts
  CHALLENGE_APPROVED: 'Desafio aprovado',
```

```ts
  CHALLENGE_APPROVED: 'Creditado quando a participação num desafio é aprovada; o valor vem do próprio desafio.',
```

E, logo abaixo de `COIN_EVENTS`, a lista dos eventos que o admin pode configurar:

```ts
/**
 * Eventos com valor configurável por `CoinRule` — o que o admin escolhe no CRUD
 * de regras. `CHALLENGE_APPROVED` fica de fora de propósito: a recompensa é do
 * desafio, não de uma regra, e `awardFixedCoins` nunca consulta `CoinRule`.
 * Uma regra criada para ele não teria efeito nenhum.
 */
export const COIN_RULE_EVENTS = COIN_EVENTS.filter((event) => event !== 'CHALLENGE_APPROVED')
```

Em `apps/web/src/pages/admin/CoinsSection.tsx`, trocar a origem do dropdown de
regras de `COIN_EVENTS` para `COIN_RULE_EVENTS` (import e o `.filter` da linha ~60).

Teste, em `packages/shared/src/coin.test.ts` (crie se não existir):

```ts
import { describe, it, expect } from 'vitest'
import { COIN_EVENTS, COIN_EVENT_LABELS, COIN_RULE_EVENTS } from './coin'

describe('catálogo de eventos de coins', () => {
  it('rotula todo evento — extrato do colaborador lê direto do mapa', () => {
    for (const event of COIN_EVENTS) {
      expect(COIN_EVENT_LABELS[event]).toBeTruthy()
    }
  })

  it('não oferece CHALLENGE_APPROVED para regra do admin: a recompensa é do desafio', () => {
    expect(COIN_EVENTS).toContain('CHALLENGE_APPROVED')
    expect(COIN_RULE_EVENTS).not.toContain('CHALLENGE_APPROVED')
  })
})
```

Run: `pnpm --filter @legends/shared exec vitest run src/coin.test.ts`
Expected: PASS, 2 testes.

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar ao fim de `apps/api/src/services/coin-service.test.ts`:

```ts
describe('awardFixedCoins', () => {
  it('credita o valor explícito sem depender de CoinRule', async () => {
    const user = await prisma.user.create({
      data: { name: 'Fixa', email: `fixa-${Math.random()}@x.com`, passwordHash: 'x', role: 'LEGEND' },
    })

    const result = await awardFixedCoins({
      userId: user.id,
      companyId: DEFAULT_COMPANY_ID,
      amount: 250,
      event: 'CHALLENGE_APPROVED',
      reference: 'sub-1',
    })

    expect(result).toMatchObject({ status: 'CREDITED', amount: 250 })
    const tx = await prisma.coinTransaction.findFirstOrThrow({ where: { userId: user.id } })
    expect(tx.dedupeKey).toBe('CHALLENGE_APPROVED:sub-1')
    expect(tx.ruleId).toBeNull()
    expect(tx.kind).toBe('EARN')
  })

  it('é idempotente pela mesma referência', async () => {
    const user = await prisma.user.create({
      data: { name: 'Dup', email: `dup-${Math.random()}@x.com`, passwordHash: 'x', role: 'LEGEND' },
    })
    const input = {
      userId: user.id,
      companyId: DEFAULT_COMPANY_ID,
      amount: 100,
      event: 'CHALLENGE_APPROVED' as const,
      reference: 'sub-2',
    }

    await awardFixedCoins(input)
    expect(await awardFixedCoins(input)).toEqual({ status: 'DUPLICATE' })
    expect(await prisma.coinTransaction.count({ where: { userId: user.id } })).toBe(1)
  })

  it('não lança nada quando o valor não é positivo', async () => {
    const user = await prisma.user.create({
      data: { name: 'Zero', email: `zero-${Math.random()}@x.com`, passwordHash: 'x', role: 'LEGEND' },
    })
    expect(
      await awardFixedCoins({
        userId: user.id,
        companyId: DEFAULT_COMPANY_ID,
        amount: 0,
        event: 'CHALLENGE_APPROVED',
        reference: 'sub-3',
      }),
    ).toEqual({ status: 'SKIPPED' })
    expect(await prisma.coinTransaction.count({ where: { userId: user.id } })).toBe(0)
  })
})
```

Ajustar o import do topo do arquivo para incluir `awardFixedCoins` (e `DEFAULT_COMPANY_ID` de `@legends/shared`, se ainda não estiver lá).

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/services/coin-service.test.ts`
Expected: FAIL — `awardFixedCoins is not a function`.

- [ ] **Step 3: Implementar**

Acrescentar a `apps/api/src/services/coin-service.ts`, logo depois de `awardCoins`:

```ts
export interface AwardFixedCoinsInput {
  userId: string
  companyId: string
  /** Valor a creditar. <= 0 não gera lançamento. */
  amount: number
  event: CoinEvent
  /** Referência ÚNICA da ação (ex.: id da submissão). Compõe o dedupeKey. */
  reference: string
  /** Transação em curso; quando presente, o crédito entra nela. */
  tx?: Prisma.TransactionClient
  now?: Date
}

export type AwardFixedCoinsOutcome =
  | { status: 'CREDITED'; amount: number; transactionId: string }
  | { status: 'SKIPPED' }
  | { status: 'DUPLICATE' }

/**
 * Credita um valor VINDO DO CHAMADOR (não de CoinRule) no livro-razão.
 *
 * Existe porque a recompensa de desafio é configurada por desafio, e `CoinRule`
 * só sabe valor fixo por evento. Sem regra, não há teto de janela para consultar.
 *
 * Aceita um `tx` para o crédito entrar na MESMA transação que muda o estado da
 * ação creditada — é o que garante "aprovou e creditou, ou nada". O `tx` cru não
 * passa por `scopedPrisma`, então `companyId` vai explícito no `data`, mesmo
 * padrão de `recordAuditLog`.
 */
export async function awardFixedCoins(input: AwardFixedCoinsInput): Promise<AwardFixedCoinsOutcome> {
  if (input.amount <= 0) return { status: 'SKIPPED' }

  const ymd = ymdInSaoPaulo(input.now ?? new Date())
  const client = input.tx ?? scopedPrisma(input.companyId)

  try {
    const created = await client.coinTransaction.create({
      data: {
        userId: input.userId,
        kind: 'EARN',
        event: input.event,
        ruleId: null,
        amount: input.amount,
        dedupeKey: `${input.event}:${input.reference}`,
        day: dayFromYmd(ymd),
        companyId: input.companyId,
      },
    })
    return { status: 'CREDITED', amount: created.amount, transactionId: created.id }
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { status: 'DUPLICATE' }
    }
    throw err
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/services/coin-service.test.ts`
Expected: PASS, incluindo os testes que já existiam.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/coin.ts packages/shared/src/coin.test.ts \
        apps/web/src/pages/admin/CoinsSection.tsx \
        apps/api/src/services/coin-service.ts apps/api/src/services/coin-service.test.ts
git commit -m "feat(api): awardFixedCoins credita valor explícito no livro-razão"
```

---

## Task 4: Erros de domínio e CRUD do desafio

**Files:**
- Create: `apps/api/src/services/challenge-service.ts`
- Modify: `apps/api/src/services/challenge-service.test.ts`

**Interfaces:**
- Consumes: Task 2.
- Produces:

```ts
export class ChallengeError extends Error { readonly status: number }
export class ChallengeNotFoundError extends ChallengeError      // 404
export class ChallengeClosedError extends ChallengeError        // 409
export class ChallengeHasSubmissionsError extends ChallengeError // 409
export class SubmissionNotFoundError extends ChallengeError     // 404
export class SubmissionAlreadyOpenError extends ChallengeError  // 409
export class SubmissionNotPendingError extends ChallengeError   // 409
export class ChallengeSectorForbiddenError extends ChallengeError // 403

export interface ChallengeActor { id: string; role: string; sectorId: string; companyId: string }
export const challengeInclude: { sector: { select: { id: true; name: true } } }
export type ChallengeWithSector = Prisma.ChallengeGetPayload<{ include: typeof challengeInclude }>

export function assertCanManageChallenge(actor: ChallengeActor, sectorId: string | null): void
export async function listChallengesForAdmin(actor: ChallengeActor, filters: { sectorId?: string }): Promise<(ChallengeWithSector & { _count: { submissions: number } })[]>
export async function createChallenge(actor: ChallengeActor, input: CreateChallengeInput): Promise<ChallengeWithSector>
export async function updateChallenge(actor: ChallengeActor, id: string, input: UpdateChallengeInput): Promise<ChallengeWithSector>
export async function deleteChallenge(actor: ChallengeActor, id: string): Promise<void>
```

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar a `apps/api/src/services/challenge-service.test.ts`:

```ts
import {
  ChallengeHasSubmissionsError,
  ChallengeSectorForbiddenError,
  createChallenge,
  deleteChallenge,
  listChallengesForAdmin,
  updateChallenge,
} from './challenge-service'

const OTHER_SECTOR_ID = 'sector-gente-gestao'

async function ensureOtherSector() {
  await prisma.sector.upsert({
    where: { id: OTHER_SECTOR_ID },
    update: {},
    create: { id: OTHER_SECTOR_ID, name: 'Gente e Gestão', slug: 'gente-gestao', companyId: DEFAULT_COMPANY_ID },
  })
}

function adminActor(id: string) {
  return { id, role: 'ADMIN', sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID }
}
function subadminActor(id: string, sectorId: string) {
  return { id, role: 'SUBADMIN', sectorId, companyId: DEFAULT_COMPANY_ID }
}

describe('CRUD de desafio', () => {
  it('ADMIN cria desafio da empresa inteira', async () => {
    const admin = await makeUser('admin-crud@x.com')
    const challenge = await createChallenge(adminActor(admin.id), {
      title: 'Indicar um talento',
      description: 'Indique alguém para uma vaga aberta.',
      rewardCoins: 300,
      sectorId: null,
    })
    expect(challenge.sectorId).toBeNull()
    expect(challenge.createdById).toBe(admin.id)
  })

  it('SUBADMIN não cria desafio da empresa nem de outro setor', async () => {
    await ensureOtherSector()
    const sub = await makeUser('sub-crud@x.com')
    const actor = subadminActor(sub.id, OTHER_SECTOR_ID)

    await expect(
      createChallenge(actor, { title: 'T', description: 'D', rewardCoins: 10, sectorId: null }),
    ).rejects.toBeInstanceOf(ChallengeSectorForbiddenError)

    await expect(
      createChallenge(actor, { title: 'T', description: 'D', rewardCoins: 10, sectorId: DEFAULT_SECTOR_ID }),
    ).rejects.toBeInstanceOf(ChallengeSectorForbiddenError)

    const ok = await createChallenge(actor, {
      title: 'Café com a liderança',
      description: 'Marque um café.',
      rewardCoins: 50,
      sectorId: OTHER_SECTOR_ID,
    })
    expect(ok.sectorId).toBe(OTHER_SECTOR_ID)
  })

  it('SUBADMIN só enxerga os desafios do próprio setor', async () => {
    await ensureOtherSector()
    const admin = await makeUser('admin-list@x.com')
    await createChallenge(adminActor(admin.id), { title: 'Empresa', description: 'D', rewardCoins: 10, sectorId: null })
    await createChallenge(adminActor(admin.id), { title: 'Outro', description: 'D', rewardCoins: 10, sectorId: OTHER_SECTOR_ID })

    const sub = await makeUser('sub-list@x.com')
    const visible = await listChallengesForAdmin(subadminActor(sub.id, OTHER_SECTOR_ID), {})
    expect(visible.map((c) => c.title)).toEqual(['Outro'])
  })

  it('não apaga desafio que já tem submissão', async () => {
    const admin = await makeUser('admin-del@x.com')
    const actor = adminActor(admin.id)
    const challenge = await createChallenge(actor, { title: 'X', description: 'D', rewardCoins: 10, sectorId: null })
    const user = await makeUser('participante-del@x.com')
    await prisma.challengeSubmission.create({
      data: { challengeId: challenge.id, userId: user.id, companyId: DEFAULT_COMPANY_ID },
    })

    await expect(deleteChallenge(actor, challenge.id)).rejects.toBeInstanceOf(ChallengeHasSubmissionsError)

    // Desativar é o caminho suportado.
    const off = await updateChallenge(actor, challenge.id, { active: false })
    expect(off.active).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/services/challenge-service.test.ts`
Expected: FAIL — `Cannot find module './challenge-service'`.

- [ ] **Step 3: Implementar**

`apps/api/src/services/challenge-service.ts`:

```ts
import { Prisma } from '@prisma/client'
import { scopedPrisma } from '../lib/tenant-scope'

export class ChallengeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = new.target.name
  }
}

export class ChallengeNotFoundError extends ChallengeError {
  constructor() {
    super('Desafio não encontrado.', 404)
  }
}
export class ChallengeClosedError extends ChallengeError {
  constructor() {
    super('Este desafio não está aberto para participação.', 409)
  }
}
export class ChallengeHasSubmissionsError extends ChallengeError {
  constructor() {
    super('Desafio com participações não pode ser apagado. Desative-o.', 409)
  }
}
export class SubmissionNotFoundError extends ChallengeError {
  constructor() {
    super('Participação não encontrada.', 404)
  }
}
export class SubmissionAlreadyOpenError extends ChallengeError {
  constructor() {
    super('Você já participou deste desafio.', 409)
  }
}
export class SubmissionNotPendingError extends ChallengeError {
  constructor() {
    super('Esta participação já foi avaliada.', 409)
  }
}
export class ChallengeSectorForbiddenError extends ChallengeError {
  constructor() {
    super('Você só pode gerenciar desafios do seu setor.', 403)
  }
}

export interface ChallengeActor {
  id: string
  role: string
  sectorId: string
  companyId: string
}

export const challengeInclude = { sector: { select: { id: true, name: true } } } as const
export type ChallengeWithSector = Prisma.ChallengeGetPayload<{ include: typeof challengeInclude }>

/**
 * SUBADMIN só toca desafio do próprio setor. Desafio da empresa inteira
 * (`sectorId === null`) é território exclusivo do ADMIN — sem isso um subadmin
 * moderaria participação de gente de todos os setores.
 */
export function assertCanManageChallenge(actor: ChallengeActor, sectorId: string | null): void {
  if (actor.role === 'ADMIN') return
  if (sectorId === null || sectorId !== actor.sectorId) throw new ChallengeSectorForbiddenError()
}

/** Recorte de desafios que o ator enxerga: tudo para ADMIN, só o setor para SUBADMIN. */
function adminScopeWhere(actor: ChallengeActor, filters: { sectorId?: string }): Prisma.ChallengeWhereInput {
  if (actor.role !== 'ADMIN') return { sectorId: actor.sectorId }
  return filters.sectorId ? { sectorId: filters.sectorId } : {}
}

export interface CreateChallengeInput {
  title: string
  description: string
  rewardCoins: number
  sectorId: string | null
  startsAt?: Date | null
  endsAt?: Date | null
}

export interface UpdateChallengeInput {
  title?: string
  description?: string
  rewardCoins?: number
  active?: boolean
  startsAt?: Date | null
  endsAt?: Date | null
}

export async function listChallengesForAdmin(actor: ChallengeActor, filters: { sectorId?: string }) {
  return scopedPrisma(actor.companyId).challenge.findMany({
    where: adminScopeWhere(actor, filters),
    include: { ...challengeInclude, _count: { select: { submissions: true } } },
    orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
  })
}

/** findFirst e não findUnique: a extensão de tenant injeta companyId no where. */
async function findChallengeOrThrow(companyId: string, id: string): Promise<ChallengeWithSector> {
  const challenge = await scopedPrisma(companyId).challenge.findFirst({ where: { id }, include: challengeInclude })
  if (!challenge) throw new ChallengeNotFoundError()
  return challenge
}

export async function createChallenge(actor: ChallengeActor, input: CreateChallengeInput): Promise<ChallengeWithSector> {
  assertCanManageChallenge(actor, input.sectorId)
  return scopedPrisma(actor.companyId).challenge.create({
    data: {
      title: input.title,
      description: input.description,
      rewardCoins: input.rewardCoins,
      sectorId: input.sectorId,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      createdById: actor.id,
    },
    include: challengeInclude,
  })
}

export async function updateChallenge(
  actor: ChallengeActor,
  id: string,
  input: UpdateChallengeInput,
): Promise<ChallengeWithSector> {
  const current = await findChallengeOrThrow(actor.companyId, id)
  assertCanManageChallenge(actor, current.sectorId)
  return scopedPrisma(actor.companyId).challenge.update({
    where: { id },
    data: input,
    include: challengeInclude,
  })
}

export async function deleteChallenge(actor: ChallengeActor, id: string): Promise<void> {
  const current = await findChallengeOrThrow(actor.companyId, id)
  assertCanManageChallenge(actor, current.sectorId)

  // O onDelete: Cascade existe como salvaguarda de integridade, não como caminho
  // normal: apagar um desafio já moderado sumiria com o histórico da fila enquanto
  // os coins creditados continuariam no extrato (o livro-razão é append-only).
  const count = await scopedPrisma(actor.companyId).challengeSubmission.count({ where: { challengeId: id } })
  if (count > 0) throw new ChallengeHasSubmissionsError()

  await scopedPrisma(actor.companyId).challenge.delete({ where: { id } })
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/services/challenge-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/challenge-service.ts apps/api/src/services/challenge-service.test.ts
git commit -m "feat(api): CRUD de desafio com escopo de setor"
```

---

## Task 5: Participação do colaborador

**Files:**
- Modify: `apps/api/src/services/challenge-service.ts`
- Modify: `apps/api/src/services/challenge-service.test.ts`

**Interfaces:**
- Consumes: Task 4 (`ChallengeError` e subclasses, `ChallengeActor`).
- Produces:

```ts
export const submissionInclude: {
  user: { select: { id: true; name: true; email: true; photoUrl: true } }
  challenge: { select: { id: true; title: true; rewardCoins: true; sectorId: true } }
  reviewedBy: { select: { id: true; name: true } }
}
export type SubmissionWithRefs = Prisma.ChallengeSubmissionGetPayload<{ include: typeof submissionInclude }>
export function isChallengeOpen(challenge: { active: boolean; startsAt: Date | null; endsAt: Date | null }, now?: Date): boolean
export async function listMyChallenges(user: { id: string; sectorId: string; companyId: string }): Promise<{ challenge: ChallengeWithSector; mySubmission: SubmissionWithRefs | null }[]>
export async function createSubmission(user: { id: string; sectorId: string; companyId: string }, challengeId: string, input: { note?: string; evidenceKey?: string }): Promise<SubmissionWithRefs>
```

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar a `apps/api/src/services/challenge-service.test.ts`:

```ts
import { ChallengeClosedError, SubmissionAlreadyOpenError, createSubmission, listMyChallenges } from './challenge-service'

describe('participação do colaborador', () => {
  it('lista desafios da empresa e do próprio setor, nunca de outro', async () => {
    await ensureOtherSector()
    const admin = await makeUser('admin-vis@x.com')
    const actor = adminActor(admin.id)
    await createChallenge(actor, { title: 'Empresa', description: 'D', rewardCoins: 10, sectorId: null })
    await createChallenge(actor, { title: 'Meu setor', description: 'D', rewardCoins: 10, sectorId: DEFAULT_SECTOR_ID })
    await createChallenge(actor, { title: 'Setor alheio', description: 'D', rewardCoins: 10, sectorId: OTHER_SECTOR_ID })

    const user = await makeUser('vis@x.com')
    const list = await listMyChallenges({ id: user.id, sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID })
    expect(list.map((i) => i.challenge.title).sort()).toEqual(['Empresa', 'Meu setor'])
    expect(list.every((i) => i.mySubmission === null)).toBe(true)
  })

  it('cria a participação e devolve o estado dela na listagem', async () => {
    const admin = await makeUser('admin-part@x.com')
    const challenge = await createChallenge(adminActor(admin.id), {
      title: 'X', description: 'D', rewardCoins: 10, sectorId: null,
    })
    const user = await makeUser('part@x.com')
    const me = { id: user.id, sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID }

    const submission = await createSubmission(me, challenge.id, { note: 'Feito!' })
    expect(submission.status).toBe('PENDING')
    expect(submission.user.name).toBe('Pessoa')

    const list = await listMyChallenges(me)
    expect(list[0].mySubmission?.id).toBe(submission.id)
  })

  it('barra a segunda participação pendente com erro de domínio', async () => {
    const admin = await makeUser('admin-dup2@x.com')
    const challenge = await createChallenge(adminActor(admin.id), {
      title: 'X', description: 'D', rewardCoins: 10, sectorId: null,
    })
    const user = await makeUser('dup2@x.com')
    const me = { id: user.id, sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID }

    await createSubmission(me, challenge.id, {})
    await expect(createSubmission(me, challenge.id, {})).rejects.toBeInstanceOf(SubmissionAlreadyOpenError)
  })

  it('recusa participação em desafio inativo ou fora da janela', async () => {
    const admin = await makeUser('admin-fech@x.com')
    const actor = adminActor(admin.id)
    const user = await makeUser('fech@x.com')
    const me = { id: user.id, sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID }

    const inactive = await createChallenge(actor, { title: 'Off', description: 'D', rewardCoins: 10, sectorId: null })
    await updateChallenge(actor, inactive.id, { active: false })
    await expect(createSubmission(me, inactive.id, {})).rejects.toBeInstanceOf(ChallengeClosedError)

    const expired = await createChallenge(actor, {
      title: 'Venceu', description: 'D', rewardCoins: 10, sectorId: null,
      startsAt: new Date('2026-01-01T00:00:00Z'), endsAt: new Date('2026-01-31T00:00:00Z'),
    })
    await expect(createSubmission(me, expired.id, {})).rejects.toBeInstanceOf(ChallengeClosedError)
  })

  it('recusa participação em desafio de outro setor', async () => {
    await ensureOtherSector()
    const admin = await makeUser('admin-alheio@x.com')
    const challenge = await createChallenge(adminActor(admin.id), {
      title: 'Alheio', description: 'D', rewardCoins: 10, sectorId: OTHER_SECTOR_ID,
    })
    const user = await makeUser('alheio@x.com')
    await expect(
      createSubmission({ id: user.id, sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID }, challenge.id, {}),
    ).rejects.toBeInstanceOf(ChallengeNotFoundError)
  })
})
```

Somar `ChallengeNotFoundError` aos imports do arquivo de teste.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/services/challenge-service.test.ts`
Expected: FAIL — `listMyChallenges is not a function`.

- [ ] **Step 3: Implementar**

Acrescentar a `apps/api/src/services/challenge-service.ts`:

```ts
export const submissionInclude = {
  user: { select: { id: true, name: true, email: true, photoUrl: true } },
  challenge: { select: { id: true, title: true, rewardCoins: true, sectorId: true } },
  reviewedBy: { select: { id: true, name: true } },
} as const
export type SubmissionWithRefs = Prisma.ChallengeSubmissionGetPayload<{ include: typeof submissionInclude }>

/** Desafios que a pessoa vê: os da empresa inteira mais os do próprio setor. */
function visibleToUserWhere(sectorId: string): Prisma.ChallengeWhereInput {
  return { OR: [{ sectorId: null }, { sectorId }] }
}

export function isChallengeOpen(
  challenge: { active: boolean; startsAt: Date | null; endsAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (!challenge.active) return false
  if (challenge.startsAt && now < challenge.startsAt) return false
  if (challenge.endsAt && now > challenge.endsAt) return false
  return true
}

export async function listMyChallenges(user: { id: string; sectorId: string; companyId: string }) {
  const db = scopedPrisma(user.companyId)
  const challenges = await db.challenge.findMany({
    where: { ...visibleToUserWhere(user.sectorId), active: true },
    include: challengeInclude,
    orderBy: { createdAt: 'desc' },
  })
  if (challenges.length === 0) return []

  // Uma query só para todas as submissões da pessoa: nada de N+1 na tela.
  const mine = await db.challengeSubmission.findMany({
    where: { userId: user.id, challengeId: { in: challenges.map((c) => c.id) } },
    include: submissionInclude,
    orderBy: { submittedAt: 'desc' },
  })
  const byChallenge = new Map<string, SubmissionWithRefs>()
  for (const submission of mine) {
    // A mais recente vence: uma rejeitada antiga não esconde a pendente nova.
    if (!byChallenge.has(submission.challengeId)) byChallenge.set(submission.challengeId, submission)
  }

  return challenges.map((challenge) => ({
    challenge,
    mySubmission: byChallenge.get(challenge.id) ?? null,
  }))
}

export async function createSubmission(
  user: { id: string; sectorId: string; companyId: string },
  challengeId: string,
  input: { note?: string; evidenceKey?: string },
): Promise<SubmissionWithRefs> {
  const db = scopedPrisma(user.companyId)
  // Desafio de outro setor é tratado como inexistente — não vaza a existência dele.
  const challenge = await db.challenge.findFirst({
    where: { id: challengeId, ...visibleToUserWhere(user.sectorId) },
  })
  if (!challenge) throw new ChallengeNotFoundError()
  if (!isChallengeOpen(challenge)) throw new ChallengeClosedError()

  try {
    return await db.challengeSubmission.create({
      data: {
        challengeId,
        userId: user.id,
        note: input.note ?? null,
        evidenceKey: input.evidenceKey ?? null,
      },
      include: submissionInclude,
    })
  } catch (err) {
    // P2002 na unique PARCIAL: já existe uma pendente ou aprovada. Rejeitada não conta.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new SubmissionAlreadyOpenError()
    }
    throw err
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/services/challenge-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/challenge-service.ts apps/api/src/services/challenge-service.test.ts
git commit -m "feat(api): participação em desafio com visibilidade por setor"
```

---

## Task 6: Aprovar e rejeitar — o coração da idempotência

**Files:**
- Create: `apps/api/src/services/challenge-submission-service.ts`
- Create: `apps/api/src/services/challenge-submission-service.test.ts`
- Modify: `apps/api/src/services/notification-service.ts`

**Interfaces:**
- Consumes: Tasks 3, 4, 5 (`awardFixedCoins`, `ChallengeActor`, erros, `submissionInclude`, `SubmissionWithRefs`).
- Produces:

```ts
export async function approveSubmission(actor: ChallengeActor, id: string): Promise<SubmissionWithRefs>
export async function rejectSubmission(actor: ChallengeActor, id: string, rejectionReason: string): Promise<SubmissionWithRefs>
// em notification-service:
export async function notifyChallengeReviewed(submission: { id: string; userId: string; status: 'APPROVED' | 'REJECTED'; challenge: { title: string; rewardCoins: number } }, actorId: string, companyId: string): Promise<void>
```

- [ ] **Step 1: Escrever os testes que falham**

`apps/api/src/services/challenge-submission-service.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { createChallenge, createSubmission, SubmissionNotPendingError, ChallengeSectorForbiddenError } from './challenge-service'
import { approveSubmission, rejectSubmission } from './challenge-submission-service'
import * as notificationService from './notification-service'

const OTHER_SECTOR_ID = 'sector-gente-gestao'

async function makeUser(email: string, sectorId = DEFAULT_SECTOR_ID) {
  return prisma.user.create({
    data: { name: 'Pessoa', email, passwordHash: 'x', role: 'LEGEND', sectorId },
  })
}
function adminActor(id: string) {
  return { id, role: 'ADMIN', sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID }
}

/** Desafio da empresa + uma submissão pendente de `participante`. */
async function scenario(rewardCoins = 200) {
  const admin = await makeUser(`admin-${Math.random()}@x.com`)
  const actor = adminActor(admin.id)
  const challenge = await createChallenge(actor, {
    title: 'Ler um livro', description: 'D', rewardCoins, sectorId: null,
  })
  const participant = await makeUser(`p-${Math.random()}@x.com`)
  const submission = await createSubmission(
    { id: participant.id, sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID },
    challenge.id,
    { note: 'Li o livro.' },
  )
  return { actor, challenge, participant, submission }
}

function balanceOf(userId: string) {
  return prisma.coinTransaction
    .aggregate({ where: { userId }, _sum: { amount: true } })
    .then((r) => r._sum.amount ?? 0)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('aprovar submissão', () => {
  it('credita exatamente a recompensa do desafio e marca como aprovada', async () => {
    const { actor, participant, submission } = await scenario(200)

    const result = await approveSubmission(actor, submission.id)

    expect(result.status).toBe('APPROVED')
    expect(result.reviewedById).toBe(actor.id)
    expect(result.reviewedAt).not.toBeNull()
    expect(await balanceOf(participant.id)).toBe(200)
  })

  it('aprovar duas vezes credita uma única vez', async () => {
    const { actor, participant, submission } = await scenario(200)

    await approveSubmission(actor, submission.id)
    await expect(approveSubmission(actor, submission.id)).rejects.toBeInstanceOf(SubmissionNotPendingError)

    expect(await balanceOf(participant.id)).toBe(200)
    expect(await prisma.coinTransaction.count({ where: { userId: participant.id } })).toBe(1)
  })

  it('duas aprovações CONCORRENTES creditam uma única vez', async () => {
    const { actor, participant, submission } = await scenario(200)

    const results = await Promise.allSettled([
      approveSubmission(actor, submission.id),
      approveSubmission(actor, submission.id),
    ])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await balanceOf(participant.id)).toBe(200)
    expect(await prisma.coinTransaction.count({ where: { userId: participant.id } })).toBe(1)
  })

  it('aprovar uma já rejeitada falha e não credita', async () => {
    const { actor, participant, submission } = await scenario(200)

    await rejectSubmission(actor, submission.id, 'Faltou evidência do livro.')
    await expect(approveSubmission(actor, submission.id)).rejects.toBeInstanceOf(SubmissionNotPendingError)

    expect(await balanceOf(participant.id)).toBe(0)
  })

  it('recompensa zero aprova sem criar lançamento no extrato', async () => {
    const { actor, participant, submission } = await scenario(0)

    const result = await approveSubmission(actor, submission.id)

    expect(result.status).toBe('APPROVED')
    expect(await prisma.coinTransaction.count({ where: { userId: participant.id } })).toBe(0)
  })

  it('grava auditoria da decisão', async () => {
    const { actor, submission } = await scenario()
    await approveSubmission(actor, submission.id)

    const log = await prisma.adminAuditLog.findFirstOrThrow({
      where: { entityType: 'ChallengeSubmission', entityId: submission.id },
    })
    expect(log.actorId).toBe(actor.id)
    expect(log.action).toBe('UPDATE')
  })

  it('falha na notificação NÃO desfaz a aprovação', async () => {
    const { actor, participant, submission } = await scenario(200)
    vi.spyOn(notificationService, 'notifyChallengeReviewed').mockRejectedValue(new Error('teams caiu'))

    const result = await approveSubmission(actor, submission.id)

    expect(result.status).toBe('APPROVED')
    expect(await balanceOf(participant.id)).toBe(200)
  })

  it('SUBADMIN de outro setor não decide', async () => {
    const { submission } = await scenario()
    const sub = await makeUser('sub-outro@x.com', OTHER_SECTOR_ID)
    const actor = { id: sub.id, role: 'SUBADMIN', sectorId: OTHER_SECTOR_ID, companyId: DEFAULT_COMPANY_ID }

    await expect(approveSubmission(actor, submission.id)).rejects.toBeInstanceOf(ChallengeSectorForbiddenError)
  })
})

describe('rejeitar submissão', () => {
  it('não credita, guarda o motivo e libera nova participação', async () => {
    const { actor, participant, challenge, submission } = await scenario(200)

    const result = await rejectSubmission(actor, submission.id, 'A evidência não confere.')

    expect(result.status).toBe('REJECTED')
    expect(result.rejectionReason).toBe('A evidência não confere.')
    expect(await balanceOf(participant.id)).toBe(0)

    const again = await createSubmission(
      { id: participant.id, sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID },
      challenge.id,
      { note: 'Agora com print.' },
    )
    expect(again.status).toBe('PENDING')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/services/challenge-submission-service.test.ts`
Expected: FAIL — `Cannot find module './challenge-submission-service'`.

- [ ] **Step 3: Somar a notificação ao notification-service**

Em `apps/api/src/services/notification-service.ts`, dentro do mapa de `emojiForNotificationType`, adicionar:

```ts
    CHALLENGE_SUBMISSION_APPROVED: '🎯',
    CHALLENGE_SUBMISSION_REJECTED: '↩️',
```

E, ao fim do bloco de funções `notify*`:

```ts
/** Avisa a pessoa do resultado da participação num desafio. */
export async function notifyChallengeReviewed(
  submission: {
    id: string
    userId: string
    status: 'APPROVED' | 'REJECTED'
    challenge: { title: string; rewardCoins: number }
  },
  actorId: string,
  companyId: string,
): Promise<void> {
  const approved = submission.status === 'APPROVED'
  const title = approved
    ? `Sua participação em "${submission.challenge.title}" foi aprovada` +
      (submission.challenge.rewardCoins > 0 ? ` — +${submission.challenge.rewardCoins} coins` : '')
    : `Sua participação em "${submission.challenge.title}" não foi aprovada`

  await createNotification({
    userId: submission.userId,
    type: approved ? 'CHALLENGE_SUBMISSION_APPROVED' : 'CHALLENGE_SUBMISSION_REJECTED',
    title,
    actorId,
    link: '/desafios',
    companyId,
  })
}
```

- [ ] **Step 4: Implementar o service da decisão**

`apps/api/src/services/challenge-submission-service.ts`:

```ts
import type { ChallengeSubmissionStatus } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'
import { recordAuditLog } from './audit-log-service'
import { awardFixedCoins } from './coin-service'
import * as notificationService from './notification-service'
import {
  assertCanManageChallenge,
  submissionInclude,
  SubmissionNotFoundError,
  SubmissionNotPendingError,
  type ChallengeActor,
  type SubmissionWithRefs,
} from './challenge-service'

/**
 * Carrega a submissão e confere o setor do ator. findFirst e nunca o findUnique
 * composto `challengeId_userId`: o índice é PARCIAL, aquele findUnique casaria
 * uma rejeitada qualquer.
 */
async function loadForReview(actor: ChallengeActor, id: string): Promise<SubmissionWithRefs> {
  const submission = await scopedPrisma(actor.companyId).challengeSubmission.findFirst({
    where: { id },
    include: submissionInclude,
  })
  if (!submission) throw new SubmissionNotFoundError()
  assertCanManageChallenge(actor, submission.challenge.sectorId)
  return submission
}

/** Avisa a pessoa da decisão. Best-effort: falha é logada e nunca desfaz a decisão. */
async function notifyBestEffort(submission: SubmissionWithRefs, status: 'APPROVED' | 'REJECTED', actorId: string) {
  try {
    await notificationService.notifyChallengeReviewed(
      { id: submission.id, userId: submission.userId, status, challenge: submission.challenge },
      actorId,
      submission.companyId,
    )
  } catch (err) {
    console.error(`[challenge-submission-service] falha ao notificar decisão (submission ${submission.id})`, err)
  }
}

/**
 * Fecha a decisão numa transação. O UPDATE CONDICIONAL vem PRIMEIRO de propósito:
 * é ele que tira o lock da linha. Sob Read Committed, a transação concorrente
 * bloqueia nele, reavalia o predicado contra a linha já commitada, vê que não é
 * mais PENDING e devolve count 0 — que é o que impede o crédito duplicado.
 * Reler a submissão com um SELECT simples NÃO teria esse efeito.
 */
async function decide(
  actor: ChallengeActor,
  current: SubmissionWithRefs,
  next: Extract<ChallengeSubmissionStatus, 'APPROVED' | 'REJECTED'>,
  rejectionReason: string | null,
): Promise<void> {
  const now = new Date()
  await prisma.$transaction(async (tx) => {
    const { count } = await tx.challengeSubmission.updateMany({
      where: { id: current.id, companyId: actor.companyId, status: 'PENDING' },
      data: { status: next, reviewedAt: now, reviewedById: actor.id, rejectionReason },
    })
    if (count === 0) throw new SubmissionNotPendingError()

    if (next === 'APPROVED') {
      // O dedupeKey `CHALLENGE_APPROVED:<submissionId>` é a SEGUNDA rede: se algo
      // escapar do lock acima, a unique (userId, dedupeKey) ainda barra o 2º crédito.
      const outcome = await awardFixedCoins({
        userId: current.userId,
        companyId: actor.companyId,
        amount: current.challenge.rewardCoins,
        event: 'CHALLENGE_APPROVED',
        reference: current.id,
        tx,
        now,
      })
      if (outcome.status === 'DUPLICATE') throw new SubmissionNotPendingError()
    }

    await recordAuditLog({
      actorId: actor.id,
      entityType: 'ChallengeSubmission',
      entityId: current.id,
      action: 'UPDATE',
      companyId: actor.companyId,
      before: { status: current.status },
      after: { status: next, rejectionReason },
      tx,
    })
  })
}

export async function approveSubmission(actor: ChallengeActor, id: string): Promise<SubmissionWithRefs> {
  const current = await loadForReview(actor, id)
  await decide(actor, current, 'APPROVED', null)
  await notifyBestEffort(current, 'APPROVED', actor.id)
  return loadForReview(actor, id)
}

export async function rejectSubmission(
  actor: ChallengeActor,
  id: string,
  rejectionReason: string,
): Promise<SubmissionWithRefs> {
  const current = await loadForReview(actor, id)
  await decide(actor, current, 'REJECTED', rejectionReason)
  await notifyBestEffort(current, 'REJECTED', actor.id)
  return loadForReview(actor, id)
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/services/challenge-submission-service.test.ts`
Expected: PASS, 9 testes. Se o teste de concorrência falhar com deadlock ou com dois `fulfilled`, **pare e investigue** — é o critério de aceite central, não relaxe o teste.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/challenge-submission-service.ts \
        apps/api/src/services/challenge-submission-service.test.ts \
        apps/api/src/services/notification-service.ts
git commit -m "feat(api): aprovar/rejeitar submissão com crédito idempotente"
```

---

## Task 7: Fila paginada por cursor e lote

**Files:**
- Modify: `apps/api/src/services/challenge-submission-service.ts`
- Modify: `apps/api/src/services/challenge-submission-service.test.ts`

**Interfaces:**
- Consumes: Task 6.
- Produces:

```ts
export interface SubmissionFilters {
  status?: ChallengeSubmissionStatus
  userId?: string
  challengeId?: string
  /** Só ADMIN escolhe; no SUBADMIN é forçado para o próprio setor. */
  sectorId?: string
}
export async function listSubmissions(actor: ChallengeActor, filters: SubmissionFilters, page: { cursor?: string; limit: number }): Promise<{ items: SubmissionWithRefs[]; nextCursor: string | null }>
export async function reviewBatch(actor: ChallengeActor, ids: string[], decision: ChallengeBatchDecision, rejectionReason: string | null): Promise<ChallengeBatchResult>
```

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar a `apps/api/src/services/challenge-submission-service.test.ts`:

```ts
import { listSubmissions, reviewBatch } from './challenge-submission-service'

/** N submissões pendentes de pessoas distintas no mesmo desafio. */
async function manySubmissions(count: number) {
  const admin = await makeUser(`admin-many-${Math.random()}@x.com`)
  const actor = adminActor(admin.id)
  const challenge = await createChallenge(actor, { title: 'Lote', description: 'D', rewardCoins: 10, sectorId: null })
  const submissions = []
  for (let i = 0; i < count; i += 1) {
    const user = await makeUser(`many-${i}-${Math.random()}@x.com`)
    submissions.push(
      await createSubmission({ id: user.id, sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID }, challenge.id, {}),
    )
  }
  return { actor, challenge, submissions }
}

describe('fila de submissões', () => {
  it('pagina por cursor sem repetir nem pular item', async () => {
    const { actor } = await manySubmissions(5)

    const first = await listSubmissions(actor, {}, { limit: 2 })
    expect(first.items).toHaveLength(2)
    expect(first.nextCursor).not.toBeNull()

    const second = await listSubmissions(actor, {}, { limit: 2, cursor: first.nextCursor! })
    const third = await listSubmissions(actor, {}, { limit: 2, cursor: second.nextCursor! })

    const ids = [...first.items, ...second.items, ...third.items].map((s) => s.id)
    expect(new Set(ids).size).toBe(5)
    expect(third.nextCursor).toBeNull()
  })

  it('filtra por pessoa e por desafio, combinados', async () => {
    const admin = await makeUser('admin-filtro@x.com')
    const actor = adminActor(admin.id)
    const a = await createChallenge(actor, { title: 'A', description: 'D', rewardCoins: 10, sectorId: null })
    const b = await createChallenge(actor, { title: 'B', description: 'D', rewardCoins: 10, sectorId: null })
    const ana = await makeUser('ana@x.com')
    const bruno = await makeUser('bruno@x.com')
    const me = (u: { id: string }) => ({ id: u.id, sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID })

    await createSubmission(me(ana), a.id, {})
    await createSubmission(me(ana), b.id, {})
    await createSubmission(me(bruno), a.id, {})

    const onlyAna = await listSubmissions(actor, { userId: ana.id }, { limit: 10 })
    expect(onlyAna.items).toHaveLength(2)

    const anaOnA = await listSubmissions(actor, { userId: ana.id, challengeId: a.id }, { limit: 10 })
    expect(anaOnA.items).toHaveLength(1)
    expect(anaOnA.items[0].challenge.id).toBe(a.id)
  })

  it('filtra por status para a aba Pendentes', async () => {
    const { actor, submissions } = await manySubmissions(3)
    await rejectSubmission(actor, submissions[0].id, 'Não rolou desta vez.')

    const pending = await listSubmissions(actor, { status: 'PENDING' }, { limit: 10 })
    expect(pending.items).toHaveLength(2)
    expect(pending.items.every((s) => s.status === 'PENDING')).toBe(true)
  })

  it('SUBADMIN só vê a fila do próprio setor, ignorando filtro de setor alheio', async () => {
    await prisma.sector.upsert({
      where: { id: OTHER_SECTOR_ID },
      update: {},
      create: { id: OTHER_SECTOR_ID, name: 'Gente e Gestão', slug: 'gente-gestao', companyId: DEFAULT_COMPANY_ID },
    })
    const admin = await makeUser('admin-setor@x.com')
    const adminAct = adminActor(admin.id)
    const mine = await createChallenge(adminAct, { title: 'Meu', description: 'D', rewardCoins: 10, sectorId: OTHER_SECTOR_ID })
    const company = await createChallenge(adminAct, { title: 'Empresa', description: 'D', rewardCoins: 10, sectorId: null })

    const p1 = await makeUser('p1-setor@x.com', OTHER_SECTOR_ID)
    const p2 = await makeUser('p2-setor@x.com')
    await createSubmission({ id: p1.id, sectorId: OTHER_SECTOR_ID, companyId: DEFAULT_COMPANY_ID }, mine.id, {})
    await createSubmission({ id: p2.id, sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID }, company.id, {})

    const sub = await makeUser('sub-fila@x.com', OTHER_SECTOR_ID)
    const subActor = { id: sub.id, role: 'SUBADMIN', sectorId: OTHER_SECTOR_ID, companyId: DEFAULT_COMPANY_ID }

    const page = await listSubmissions(subActor, { sectorId: DEFAULT_SECTOR_ID }, { limit: 10 })
    expect(page.items).toHaveLength(1)
    expect(page.items[0].challenge.id).toBe(mine.id)
  })

})

describe('decisão em lote', () => {
  it('aprova o lote inteiro creditando cada pessoa uma vez', async () => {
    const { actor, submissions } = await manySubmissions(3)

    const result = await reviewBatch(actor, submissions.map((s) => s.id), 'APPROVE', null)

    expect(result.succeeded).toHaveLength(3)
    expect(result.failed).toHaveLength(0)
    for (const s of submissions) {
      expect(await balanceOf(s.userId)).toBe(10)
    }
  })

  it('lote parcial relata sucessos e falhas sem engolir erro', async () => {
    const { actor, submissions } = await manySubmissions(3)
    await rejectSubmission(actor, submissions[1].id, 'Já decidida antes do lote.')

    const result = await reviewBatch(actor, submissions.map((s) => s.id), 'APPROVE', null)

    expect(result.succeeded).toEqual([submissions[0].id, submissions[2].id])
    expect(result.failed).toEqual([
      { id: submissions[1].id, message: 'Esta participação já foi avaliada.' },
    ])
    // A falha do meio não impediu a terceira de ser creditada.
    expect(await balanceOf(submissions[2].userId)).toBe(10)
  })

  it('lote de rejeição grava o mesmo motivo em todas', async () => {
    const { actor, submissions } = await manySubmissions(2)

    const result = await reviewBatch(actor, submissions.map((s) => s.id), 'REJECT', 'Evidência insuficiente.')

    expect(result.succeeded).toHaveLength(2)
    const rows = await prisma.challengeSubmission.findMany({ where: { id: { in: submissions.map((s) => s.id) } } })
    expect(rows.every((r) => r.status === 'REJECTED' && r.rejectionReason === 'Evidência insuficiente.')).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/services/challenge-submission-service.test.ts`
Expected: FAIL — `listSubmissions is not a function`.

- [ ] **Step 3: Implementar**

Acrescentar a `apps/api/src/services/challenge-submission-service.ts`. **Os três `import` abaixo entram no bloco de imports já existente no topo do arquivo** (fundindo com o `import { … } from './challenge-service'` que já está lá); o resto vai ao fim.

```ts
import type { Prisma } from '@prisma/client'
import type { ChallengeBatchDecision, ChallengeBatchResult } from '@legends/shared'
import { ChallengeError } from './challenge-service'

/** Cursor opaco `"<iso>|<id>"` em base64url — mesmo formato de review-service. */
function encodeCursor(row: { submittedAt: Date; id: string }): string {
  return Buffer.from(`${row.submittedAt.toISOString()}|${row.id}`, 'utf8').toString('base64url')
}

function decodeCursor(cursor: string): { submittedAt: Date; id: string } | null {
  try {
    const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|', 2)
    const submittedAt = new Date(iso)
    if (!id || Number.isNaN(submittedAt.getTime())) return null
    return { submittedAt, id }
  } catch {
    return null
  }
}

export interface SubmissionFilters {
  status?: 'PENDING' | 'APPROVED' | 'REJECTED'
  userId?: string
  challengeId?: string
  /** Só ADMIN escolhe; no SUBADMIN é forçado para o próprio setor. */
  sectorId?: string
}

function filtersToWhere(actor: ChallengeActor, filters: SubmissionFilters): Prisma.ChallengeSubmissionWhereInput {
  // SUBADMIN é preso ao próprio setor mesmo que mande sectorId na query.
  const sectorWhere: Prisma.ChallengeWhereInput =
    actor.role === 'ADMIN'
      ? filters.sectorId
        ? { sectorId: filters.sectorId }
        : {}
      : { sectorId: actor.sectorId }

  return {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.userId ? { userId: filters.userId } : {}),
    ...(filters.challengeId ? { challengeId: filters.challengeId } : {}),
    challenge: sectorWhere,
  }
}

export async function listSubmissions(
  actor: ChallengeActor,
  filters: SubmissionFilters,
  page: { cursor?: string; limit: number },
): Promise<{ items: SubmissionWithRefs[]; nextCursor: string | null }> {
  const decoded = page.cursor ? decodeCursor(page.cursor) : null
  const where = filtersToWhere(actor, filters)

  const rows = await scopedPrisma(actor.companyId).challengeSubmission.findMany({
    where: decoded
      ? {
          ...where,
          OR: [
            { submittedAt: { lt: decoded.submittedAt } },
            { submittedAt: decoded.submittedAt, id: { lt: decoded.id } },
          ],
        }
      : where,
    include: submissionInclude,
    orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
    // limit + 1 para saber se há próxima página sem um count separado.
    take: page.limit + 1,
  })

  const hasMore = rows.length > page.limit
  const items = hasMore ? rows.slice(0, page.limit) : rows
  return { items, nextCursor: hasMore ? encodeCursor(items[items.length - 1]) : null }
}

/**
 * Lote: item a item, pelo MESMO caminho de código do individual. Nada de
 * Promise.all — erro de um não pode abortar nem sumir. O resultado sempre diz o
 * que passou e o que falhou.
 */
export async function reviewBatch(
  actor: ChallengeActor,
  ids: string[],
  decision: ChallengeBatchDecision,
  rejectionReason: string | null,
): Promise<ChallengeBatchResult> {
  const result: ChallengeBatchResult = { succeeded: [], failed: [] }

  for (const id of ids) {
    try {
      if (decision === 'APPROVE') {
        await approveSubmission(actor, id)
      } else {
        await rejectSubmission(actor, id, rejectionReason ?? '')
      }
      result.succeeded.push(id)
    } catch (err) {
      const message =
        err instanceof ChallengeError ? err.message : 'Falha inesperada ao processar esta participação.'
      if (!(err instanceof ChallengeError)) {
        console.error(`[challenge-submission-service] falha no lote (submission ${id})`, err)
      }
      result.failed.push({ id, message })
    }
  }

  return result
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/services/challenge-submission-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/challenge-submission-service.ts \
        apps/api/src/services/challenge-submission-service.test.ts
git commit -m "feat(api): fila paginada por cursor e decisão em lote"
```

---

## Task 8: Export CSV

**Files:**
- Modify: `apps/api/src/services/challenge-submission-service.ts`
- Modify: `apps/api/src/services/challenge-submission-service.test.ts`

**Interfaces:**
- Consumes: Task 7 (`filtersToWhere`, `SubmissionFilters`).
- Produces: `export async function exportSubmissionsCsv(actor: ChallengeActor, filters: SubmissionFilters): Promise<string>`

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar a `apps/api/src/services/challenge-submission-service.test.ts`:

```ts
import { exportSubmissionsCsv } from './challenge-submission-service'

describe('export CSV', () => {
  it('reflete o recorte filtrado, com cabeçalho e BOM', async () => {
    const admin = await makeUser('admin-csv@x.com')
    const actor = adminActor(admin.id)
    const a = await createChallenge(actor, { title: 'Desafio A', description: 'D', rewardCoins: 40, sectorId: null })
    const b = await createChallenge(actor, { title: 'Desafio B', description: 'D', rewardCoins: 10, sectorId: null })
    const ana = await makeUser('ana-csv@x.com')
    const bruno = await makeUser('bruno-csv@x.com')
    const me = (u: { id: string }) => ({ id: u.id, sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID })
    await createSubmission(me(ana), a.id, {})
    await createSubmission(me(bruno), b.id, {})

    const csv = await exportSubmissionsCsv(actor, { challengeId: a.id })

    expect(csv.startsWith('﻿')).toBe(true)
    const lines = csv.replace('﻿', '').trim().split('\n')
    expect(lines[0]).toBe('Pessoa;E-mail;Desafio;Recompensa;Status;Enviado em;Decidido em;Decidido por;Motivo')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('Desafio A')
    expect(lines[1]).not.toContain('Desafio B')
  })

  it('escapa aspas e ponto e vírgula do motivo', async () => {
    const { actor, submissions } = await manySubmissions(1)
    await rejectSubmission(actor, submissions[0].id, 'Faltou o "print"; reenvie.')

    const csv = await exportSubmissionsCsv(actor, {})

    expect(csv).toContain('"Faltou o ""print""; reenvie."')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/services/challenge-submission-service.test.ts`
Expected: FAIL — `exportSubmissionsCsv is not a function`.

- [ ] **Step 3: Implementar**

Acrescentar a `apps/api/src/services/challenge-submission-service.ts`. **`CHALLENGE_EXPORT_MAX_ROWS` entra no `import … from '@legends/shared'` que a Task 7 já criou no topo**, não numa linha de import nova no meio do arquivo.

```ts
import { CHALLENGE_EXPORT_MAX_ROWS } from '@legends/shared'

const CSV_HEADER = ['Pessoa', 'E-mail', 'Desafio', 'Recompensa', 'Status', 'Enviado em', 'Decidido em', 'Decidido por', 'Motivo']

const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pendente',
  APPROVED: 'Aprovada',
  REJECTED: 'Rejeitada',
}

/** Aspas duplicadas e campo entre aspas quando contém `;`, aspas ou quebra de linha. */
function csvCell(value: string | null): string {
  const text = value ?? ''
  if (!/[;"\n\r]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}

function csvDate(date: Date | null): string {
  if (!date) return ''
  return date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}

/**
 * CSV do recorte filtrado inteiro — não da página. Separador `;` e BOM UTF-8
 * porque o Excel em pt-BR abre assim sem pedir importação.
 */
export async function exportSubmissionsCsv(actor: ChallengeActor, filters: SubmissionFilters): Promise<string> {
  const rows = await scopedPrisma(actor.companyId).challengeSubmission.findMany({
    where: filtersToWhere(actor, filters),
    include: submissionInclude,
    orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
    take: CHALLENGE_EXPORT_MAX_ROWS,
  })

  const lines = [CSV_HEADER.join(';')]
  for (const row of rows) {
    lines.push(
      [
        csvCell(row.user.name),
        csvCell(row.user.email),
        csvCell(row.challenge.title),
        String(row.challenge.rewardCoins),
        STATUS_LABELS[row.status] ?? row.status,
        csvDate(row.submittedAt),
        csvDate(row.reviewedAt),
        csvCell(row.reviewedBy?.name ?? null),
        csvCell(row.rejectionReason),
      ].join(';'),
    )
  }

  return `﻿${lines.join('\n')}\n`
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/services/challenge-submission-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/challenge-submission-service.ts \
        apps/api/src/services/challenge-submission-service.test.ts
git commit -m "feat(api): export CSV do recorte filtrado da fila"
```

---

## Task 9: Serialização e rotas do colaborador

**Files:**
- Modify: `apps/api/src/lib/serialize.ts`
- Create: `apps/api/src/routes/challenges.ts`
- Create: `apps/api/src/routes/challenges.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: Tasks 1, 4, 5.
- Produces:

```ts
// serialize.ts
export function toChallengeDTO(challenge: ChallengeWithSector, submissionCount?: number): ChallengeDTO
export async function toChallengeSubmissionDTO(submission: SubmissionWithRefs): Promise<ChallengeSubmissionDTO>
// routes
export async function challengeRoutes(app: FastifyInstance): Promise<void>
```

- [ ] **Step 1: Escrever os testes que falham**

`apps/api/src/routes/challenges.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

async function legendToken(app: ReturnType<typeof buildApp>) {
  const user = await prisma.user.create({
    data: {
      name: 'Lenda',
      email: `lenda-des-${Math.random()}@x.com`,
      passwordHash: 'x',
      role: 'LEGEND',
      sectorId: DEFAULT_SECTOR_ID,
    },
  })
  const token = app.jwt.sign({
    sub: user.id,
    role: 'LEGEND',
    sectorId: DEFAULT_SECTOR_ID,
    companyId: DEFAULT_COMPANY_ID,
    features: [],
  })
  return { user, token }
}

async function seedChallenge(rewardCoins = 100) {
  const admin = await prisma.user.create({
    data: { name: 'Admin', email: `adm-${Math.random()}@x.com`, passwordHash: 'x', role: 'ADMIN' },
  })
  return prisma.challenge.create({
    data: {
      title: 'Ler um livro',
      description: 'Conte o que aprendeu.',
      rewardCoins,
      companyId: DEFAULT_COMPANY_ID,
      createdById: admin.id,
    },
  })
}

describe('rotas de desafios do colaborador', () => {
  it('exige autenticação', async () => {
    const app = buildApp()
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/challenges' })
    expect(res.statusCode).toBe(401)
  })

  it('lista desafios com o estado da própria participação', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await legendToken(app)
    await seedChallenge()

    const res = await app.inject({ method: 'GET', url: '/challenges', headers: { authorization: `Bearer ${token}` } })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body).toHaveLength(1)
    expect(body[0]).toMatchObject({ title: 'Ler um livro', rewardCoins: 100, mySubmission: null })
  })

  it('cria a participação e recusa a segunda com 409', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await legendToken(app)
    const challenge = await seedChallenge()
    const headers = { authorization: `Bearer ${token}` }

    const first = await app.inject({
      method: 'POST',
      url: `/challenges/${challenge.id}/submissions`,
      headers,
      payload: { note: 'Terminei ontem.' },
    })
    expect(first.statusCode).toBe(201)
    expect(first.json()).toMatchObject({ status: 'PENDING', note: 'Terminei ontem.' })

    const second = await app.inject({
      method: 'POST',
      url: `/challenges/${challenge.id}/submissions`,
      headers,
      payload: {},
    })
    expect(second.statusCode).toBe(409)
  })

  it('valida a nota longa demais com 400', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await legendToken(app)
    const challenge = await seedChallenge()

    const res = await app.inject({
      method: 'POST',
      url: `/challenges/${challenge.id}/submissions`,
      headers: { authorization: `Bearer ${token}` },
      payload: { note: 'x'.repeat(501) },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toHaveProperty('issues')
  })

  it('devolve 404 para desafio inexistente', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await legendToken(app)

    const res = await app.inject({
      method: 'POST',
      url: '/challenges/nao-existe/submissions',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    })

    expect(res.statusCode).toBe(404)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/routes/challenges.test.ts`
Expected: FAIL — 404 em `/challenges` (rota não registrada).

- [ ] **Step 3: Implementar a serialização**

Acrescentar a `apps/api/src/lib/serialize.ts`. **Os `import` abaixo vão no bloco de imports do topo do arquivo** (fundindo com o `import … from '@legends/shared'` que já existe lá); as duas funções vão ao fim.

```ts
import type { ChallengeDTO, ChallengeSubmissionDTO } from '@legends/shared'
import type { ChallengeWithSector, SubmissionWithRefs } from '../services/challenge-service'
import { presignDocumentDownload, s3Config } from './s3-client'

export function toChallengeDTO(challenge: ChallengeWithSector, submissionCount = 0): ChallengeDTO {
  return {
    id: challenge.id,
    title: challenge.title,
    description: challenge.description,
    rewardCoins: challenge.rewardCoins,
    active: challenge.active,
    startsAt: challenge.startsAt ? challenge.startsAt.toISOString() : null,
    endsAt: challenge.endsAt ? challenge.endsAt.toISOString() : null,
    sectorId: challenge.sectorId,
    sectorName: challenge.sector?.name ?? null,
    submissionCount,
  }
}

/**
 * A evidência sai como URL assinada de curta duração — a chave crua do S3 nunca
 * atravessa a API. Sem S3 configurado o campo é null e a UI simplesmente não mostra.
 */
export async function toChallengeSubmissionDTO(submission: SubmissionWithRefs): Promise<ChallengeSubmissionDTO> {
  let evidenceUrl: string | null = null
  if (submission.evidenceKey && s3Config()) {
    try {
      evidenceUrl = await presignDocumentDownload({ key: submission.evidenceKey })
    } catch {
      evidenceUrl = null
    }
  }

  return {
    id: submission.id,
    status: submission.status,
    note: submission.note,
    evidenceUrl,
    submittedAt: submission.submittedAt.toISOString(),
    reviewedAt: submission.reviewedAt ? submission.reviewedAt.toISOString() : null,
    rejectionReason: submission.rejectionReason,
    user: {
      id: submission.user.id,
      name: submission.user.name,
      email: submission.user.email,
      photoUrl: submission.user.photoUrl,
    },
    challenge: {
      id: submission.challenge.id,
      title: submission.challenge.title,
      rewardCoins: submission.challenge.rewardCoins,
    },
    reviewedBy: submission.reviewedBy ? { id: submission.reviewedBy.id, name: submission.reviewedBy.name } : null,
  }
}
```

- [ ] **Step 4: Implementar as rotas**

`apps/api/src/routes/challenges.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { CHALLENGE_NOTE_MAX_LENGTH, type MyChallengeDTO } from '@legends/shared'
import { toChallengeDTO, toChallengeSubmissionDTO } from '../lib/serialize'
import { ChallengeError, createSubmission, listMyChallenges } from '../services/challenge-service'

const createSubmissionSchema = z.object({
  note: z.string().trim().min(1).max(CHALLENGE_NOTE_MAX_LENGTH).optional(),
  evidenceKey: z.string().trim().min(1).max(512).optional(),
})

export async function challengeRoutes(app: FastifyInstance) {
  app.get('/challenges', { onRequest: [app.authenticate] }, async (request, reply) => {
    const me = {
      id: request.user.sub,
      sectorId: request.user.sectorId,
      companyId: request.user.companyId,
    }
    const rows = await listMyChallenges(me)
    const items: MyChallengeDTO[] = await Promise.all(
      rows.map(async ({ challenge, mySubmission }) => ({
        ...toChallengeDTO(challenge),
        mySubmission: mySubmission ? await toChallengeSubmissionDTO(mySubmission) : null,
      })),
    )
    return reply.send(items)
  })

  app.post('/challenges/:id/submissions', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = createSubmissionSchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    const { id } = request.params as { id: string }
    const me = {
      id: request.user.sub,
      sectorId: request.user.sectorId,
      companyId: request.user.companyId,
    }

    try {
      const submission = await createSubmission(me, id, parsed.data)
      return reply.code(201).send(await toChallengeSubmissionDTO(submission))
    } catch (err) {
      if (err instanceof ChallengeError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
}
```

- [ ] **Step 5: Registrar no app**

Em `apps/api/src/app.ts`, junto dos demais `app.register(...)`:

```ts
import { challengeRoutes } from './routes/challenges'
// …
await app.register(challengeRoutes)
```

(siga exatamente o estilo de registro já usado pelas rotas vizinhas no arquivo — com ou sem `await`.)

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/routes/challenges.test.ts`
Expected: PASS, 5 testes.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/lib/serialize.ts apps/api/src/routes/challenges.ts \
        apps/api/src/routes/challenges.test.ts apps/api/src/app.ts
git commit -m "feat(api): rotas de participação em desafio"
```

---

## Task 10: Rotas de admin

**Files:**
- Create: `apps/api/src/routes/admin.challenges.ts`
- Create: `apps/api/src/routes/admin.challenges.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: Tasks 4, 6, 7, 8, 9.
- Produces: `export async function adminChallengeRoutes(app: FastifyInstance): Promise<void>`

- [ ] **Step 1: Escrever os testes que falham**

`apps/api/src/routes/admin.challenges.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

type App = ReturnType<typeof buildApp>

async function tokenFor(app: App, role: 'ADMIN' | 'SUBADMIN' | 'LEGEND', sectorId = DEFAULT_SECTOR_ID) {
  const user = await prisma.user.create({
    data: { name: role, email: `${role}-${Math.random()}@x.com`, passwordHash: 'x', role, sectorId },
  })
  const token = app.jwt.sign({ sub: user.id, role, sectorId, companyId: DEFAULT_COMPANY_ID, features: [] })
  return { user, token, headers: { authorization: `Bearer ${token}` } }
}

async function seedPendingSubmission(app: App, rewardCoins = 150) {
  const admin = await tokenFor(app, 'ADMIN')
  const created = await app.inject({
    method: 'POST',
    url: '/admin/challenges',
    headers: admin.headers,
    payload: { title: 'Ler um livro', description: 'Conte o que aprendeu.', rewardCoins, sectorId: null },
  })
  const challenge = created.json()

  const legend = await tokenFor(app, 'LEGEND')
  const submitted = await app.inject({
    method: 'POST',
    url: `/challenges/${challenge.id}/submissions`,
    headers: legend.headers,
    payload: { note: 'Pronto.' },
  })
  return { admin, legend, challenge, submission: submitted.json() }
}

describe('rotas de admin de desafios', () => {
  it('nega acesso a quem não é admin', async () => {
    const app = buildApp()
    await app.ready()
    const legend = await tokenFor(app, 'LEGEND')

    const list = await app.inject({ method: 'GET', url: '/admin/challenge-submissions', headers: legend.headers })
    expect(list.statusCode).toBe(403)

    const create = await app.inject({
      method: 'POST',
      url: '/admin/challenges',
      headers: legend.headers,
      payload: { title: 'X', description: 'D', rewardCoins: 10, sectorId: null },
    })
    expect(create.statusCode).toBe(403)
  })

  it('aprova creditando a recompensa e recusa a segunda aprovação com 409', async () => {
    const app = buildApp()
    await app.ready()
    const { admin, legend, submission } = await seedPendingSubmission(app, 150)

    const first = await app.inject({
      method: 'POST',
      url: `/admin/challenge-submissions/${submission.id}/approve`,
      headers: admin.headers,
    })
    expect(first.statusCode).toBe(200)
    expect(first.json().status).toBe('APPROVED')

    const second = await app.inject({
      method: 'POST',
      url: `/admin/challenge-submissions/${submission.id}/approve`,
      headers: admin.headers,
    })
    expect(second.statusCode).toBe(409)

    const balance = await prisma.coinTransaction.aggregate({
      where: { userId: legend.user.id },
      _sum: { amount: true },
    })
    expect(balance._sum.amount).toBe(150)
  })

  it('exige motivo com tamanho mínimo na rejeição', async () => {
    const app = buildApp()
    await app.ready()
    const { admin, submission } = await seedPendingSubmission(app)

    const short = await app.inject({
      method: 'POST',
      url: `/admin/challenge-submissions/${submission.id}/reject`,
      headers: admin.headers,
      payload: { rejectionReason: 'não' },
    })
    expect(short.statusCode).toBe(400)

    const ok = await app.inject({
      method: 'POST',
      url: `/admin/challenge-submissions/${submission.id}/reject`,
      headers: admin.headers,
      payload: { rejectionReason: 'A evidência enviada não confere.' },
    })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().rejectionReason).toBe('A evidência enviada não confere.')
  })

  it('lista a fila paginada e filtrada', async () => {
    const app = buildApp()
    await app.ready()
    const { admin, legend, challenge } = await seedPendingSubmission(app)

    const page = await app.inject({
      method: 'GET',
      url: `/admin/challenge-submissions?status=PENDING&userId=${legend.user.id}&challengeId=${challenge.id}&limit=10`,
      headers: admin.headers,
    })

    expect(page.statusCode).toBe(200)
    const body = page.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0].user.id).toBe(legend.user.id)
    expect(body).toHaveProperty('nextCursor')
  })

  it('processa lote reportando sucessos e falhas', async () => {
    const app = buildApp()
    await app.ready()
    const { admin, submission } = await seedPendingSubmission(app)

    const res = await app.inject({
      method: 'POST',
      url: '/admin/challenge-submissions/batch',
      headers: admin.headers,
      payload: { ids: [submission.id, 'id-que-nao-existe'], decision: 'APPROVE' },
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.succeeded).toEqual([submission.id])
    expect(body.failed).toHaveLength(1)
    expect(body.failed[0].id).toBe('id-que-nao-existe')
  })

  it('exige motivo quando o lote é de rejeição', async () => {
    const app = buildApp()
    await app.ready()
    const { admin, submission } = await seedPendingSubmission(app)

    const res = await app.inject({
      method: 'POST',
      url: '/admin/challenge-submissions/batch',
      headers: admin.headers,
      payload: { ids: [submission.id], decision: 'REJECT' },
    })

    expect(res.statusCode).toBe(400)
  })

  it('exporta CSV com o content-type certo', async () => {
    const app = buildApp()
    await app.ready()
    const { admin } = await seedPendingSubmission(app)

    const res = await app.inject({
      method: 'GET',
      url: '/admin/challenge-submissions/export.csv',
      headers: admin.headers,
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.headers['content-disposition']).toContain('attachment')
    expect(res.body).toContain('Pessoa;E-mail;Desafio')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/api exec vitest run src/routes/admin.challenges.test.ts`
Expected: FAIL — 404 nas rotas.

- [ ] **Step 3: Implementar**

`apps/api/src/routes/admin.challenges.ts`:

```ts
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  CHALLENGE_BATCH_MAX_ITEMS,
  CHALLENGE_DESCRIPTION_MAX_LENGTH,
  CHALLENGE_SUBMISSION_PAGE_SIZE,
  CHALLENGE_SUBMISSION_STATUSES,
  CHALLENGE_TITLE_MAX_LENGTH,
  REJECTION_REASON_MAX_LENGTH,
  REJECTION_REASON_MIN_LENGTH,
  type ChallengeSubmissionPage,
} from '@legends/shared'
import { toChallengeDTO, toChallengeSubmissionDTO } from '../lib/serialize'
import {
  ChallengeError,
  createChallenge,
  deleteChallenge,
  listChallengesForAdmin,
  updateChallenge,
  type ChallengeActor,
} from '../services/challenge-service'
import {
  approveSubmission,
  exportSubmissionsCsv,
  listSubmissions,
  rejectSubmission,
  reviewBatch,
  type SubmissionFilters,
} from '../services/challenge-submission-service'

function actorOf(request: FastifyRequest): ChallengeActor {
  return {
    id: request.user.sub,
    role: request.user.role,
    sectorId: request.user.sectorId,
    companyId: request.user.companyId,
  }
}

const dateish = z.coerce.date().nullish()

const createSchema = z.object({
  title: z.string().trim().min(1).max(CHALLENGE_TITLE_MAX_LENGTH),
  description: z.string().trim().min(1).max(CHALLENGE_DESCRIPTION_MAX_LENGTH),
  rewardCoins: z.number().int().min(0).max(100_000),
  sectorId: z.string().trim().min(1).nullable(),
  startsAt: dateish,
  endsAt: dateish,
})

const updateSchema = createSchema.partial().omit({ sectorId: true }).extend({ active: z.boolean().optional() })

const filtersSchema = z.object({
  status: z.enum(CHALLENGE_SUBMISSION_STATUSES).optional(),
  userId: z.string().trim().min(1).optional(),
  challengeId: z.string().trim().min(1).optional(),
  sectorId: z.string().trim().min(1).optional(),
})

const pageSchema = filtersSchema.extend({
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(CHALLENGE_SUBMISSION_PAGE_SIZE),
})

const rejectSchema = z.object({
  rejectionReason: z.string().trim().min(REJECTION_REASON_MIN_LENGTH).max(REJECTION_REASON_MAX_LENGTH),
})

const batchSchema = z
  .object({
    ids: z.array(z.string().trim().min(1)).min(1).max(CHALLENGE_BATCH_MAX_ITEMS),
    decision: z.enum(['APPROVE', 'REJECT']),
    rejectionReason: z.string().trim().min(REJECTION_REASON_MIN_LENGTH).max(REJECTION_REASON_MAX_LENGTH).optional(),
  })
  // Rejeitar em lote sem motivo gravaria motivo vazio em todo mundo.
  .refine((v) => v.decision === 'APPROVE' || Boolean(v.rejectionReason), {
    message: 'Informe o motivo da rejeição.',
    path: ['rejectionReason'],
  })

export async function adminChallengeRoutes(app: FastifyInstance) {
  const guard = { onRequest: [app.authenticate, app.requireAdminOrSubadmin] }

  app.get('/admin/challenges', guard, async (request, reply) => {
    const parsed = filtersSchema.pick({ sectorId: true }).safeParse(request.query ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    const rows = await listChallengesForAdmin(actorOf(request), parsed.data)
    return reply.send(rows.map((row) => toChallengeDTO(row, row._count.submissions)))
  })

  app.post('/admin/challenges', guard, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    try {
      const challenge = await createChallenge(actorOf(request), parsed.data)
      return reply.code(201).send(toChallengeDTO(challenge))
    } catch (err) {
      if (err instanceof ChallengeError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.patch('/admin/challenges/:id', guard, async (request, reply) => {
    const parsed = updateSchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    const { id } = request.params as { id: string }
    try {
      const challenge = await updateChallenge(actorOf(request), id, parsed.data)
      return reply.send(toChallengeDTO(challenge))
    } catch (err) {
      if (err instanceof ChallengeError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/admin/challenges/:id', guard, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      await deleteChallenge(actorOf(request), id)
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof ChallengeError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.get('/admin/challenge-submissions', guard, async (request, reply) => {
    const parsed = pageSchema.safeParse(request.query ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    const { cursor, limit, ...filters } = parsed.data
    const result = await listSubmissions(actorOf(request), filters as SubmissionFilters, { cursor, limit })
    const page: ChallengeSubmissionPage = {
      items: await Promise.all(result.items.map(toChallengeSubmissionDTO)),
      nextCursor: result.nextCursor,
    }
    return reply.send(page)
  })

  app.get('/admin/challenge-submissions/export.csv', guard, async (request, reply) => {
    const parsed = filtersSchema.safeParse(request.query ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    const csv = await exportSubmissionsCsv(actorOf(request), parsed.data)
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="resultados-desafios.csv"')
      .send(csv)
  })

  app.post('/admin/challenge-submissions/:id/approve', guard, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const submission = await approveSubmission(actorOf(request), id)
      return reply.send(await toChallengeSubmissionDTO(submission))
    } catch (err) {
      if (err instanceof ChallengeError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/admin/challenge-submissions/:id/reject', guard, async (request, reply) => {
    const parsed = rejectSchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    const { id } = request.params as { id: string }
    try {
      const submission = await rejectSubmission(actorOf(request), id, parsed.data.rejectionReason)
      return reply.send(await toChallengeSubmissionDTO(submission))
    } catch (err) {
      if (err instanceof ChallengeError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/admin/challenge-submissions/batch', guard, async (request, reply) => {
    const parsed = batchSchema.safeParse(request.body ?? {})
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Requisição inválida.', issues: parsed.error.flatten() })
    }
    const { ids, decision, rejectionReason } = parsed.data
    const result = await reviewBatch(actorOf(request), ids, decision, rejectionReason ?? null)
    return reply.send(result)
  })
}
```

- [ ] **Step 4: Registrar no app**

Em `apps/api/src/app.ts`, ao lado do registro da Task 9:

```ts
import { adminChallengeRoutes } from './routes/admin.challenges'
// …
await app.register(adminChallengeRoutes)
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @legends/api exec vitest run src/routes/admin.challenges.test.ts`
Expected: PASS, 7 testes.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/admin.challenges.ts apps/api/src/routes/admin.challenges.test.ts apps/api/src/app.ts
git commit -m "feat(api): rotas de admin da fila de resultados de desafios"
```

---

## Task 11: Tela do colaborador `/desafios`

**Files:**
- Create: `apps/web/src/pages/ChallengesPage.tsx`
- Create: `apps/web/src/pages/ChallengesPage.test.tsx`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Consumes: Tasks 1, 9 (`GET /challenges`, `POST /challenges/:id/submissions`).
- Produces: `export function ChallengesPage(): JSX.Element`

- [ ] **Step 1: Escrever os testes que falham**

`apps/web/src/pages/ChallengesPage.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { MyChallengeDTO } from '@legends/shared'
import { ChallengesPage } from './ChallengesPage'
import { apiFetch } from '../lib/api'

vi.mock('../lib/api', () => ({ apiFetch: vi.fn() }))

const challenge: MyChallengeDTO = {
  id: 'c1',
  title: 'Ler um livro técnico',
  description: 'Leia e conte o que aprendeu.',
  rewardCoins: 150,
  active: true,
  startsAt: null,
  endsAt: null,
  sectorId: null,
  sectorName: null,
  submissionCount: 0,
  mySubmission: null,
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ChallengesPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(apiFetch).mockReset()
})

describe('ChallengesPage', () => {
  it('lista os desafios abertos com a recompensa', async () => {
    vi.mocked(apiFetch).mockResolvedValue([challenge])
    renderPage()

    expect(await screen.findByText('Ler um livro técnico')).toBeInTheDocument()
    expect(screen.getByText(/150/)).toBeInTheDocument()
  })

  it('envia a participação com a nota', async () => {
    vi.mocked(apiFetch).mockResolvedValue([challenge])
    renderPage()
    await screen.findByText('Ler um livro técnico')

    await userEvent.click(screen.getByRole('button', { name: 'Participar' }))
    await userEvent.type(screen.getByLabelText(/conte como foi/i), 'Li o livro inteiro.')
    await userEvent.click(screen.getByRole('button', { name: 'Enviar participação' }))

    await waitFor(() => {
      // apiFetch recebe RequestInit: o corpo já vai serializado.
      expect(apiFetch).toHaveBeenCalledWith('/challenges/c1/submissions', {
        method: 'POST',
        body: JSON.stringify({ note: 'Li o livro inteiro.' }),
      })
    })
  })

  it('mostra o motivo quando a participação foi rejeitada', async () => {
    vi.mocked(apiFetch).mockResolvedValue([
      {
        ...challenge,
        mySubmission: {
          id: 's1',
          status: 'REJECTED',
          note: null,
          evidenceUrl: null,
          submittedAt: '2026-08-01T12:00:00.000Z',
          reviewedAt: '2026-08-01T13:00:00.000Z',
          rejectionReason: 'A evidência não confere.',
          user: { id: 'u1', name: 'Ana', email: 'ana@x.com', photoUrl: null },
          challenge: { id: 'c1', title: 'Ler um livro técnico', rewardCoins: 150 },
          reviewedBy: { id: 'a1', name: 'Admin' },
        },
      },
    ])
    renderPage()

    expect(await screen.findByText('A evidência não confere.')).toBeInTheDocument()
    // Rejeitada libera nova tentativa.
    expect(screen.getByRole('button', { name: 'Participar' })).toBeInTheDocument()
  })

  it('não oferece participar quando já existe pendente', async () => {
    vi.mocked(apiFetch).mockResolvedValue([
      {
        ...challenge,
        mySubmission: {
          id: 's1',
          status: 'PENDING',
          note: 'Feito.',
          evidenceUrl: null,
          submittedAt: '2026-08-01T12:00:00.000Z',
          reviewedAt: null,
          rejectionReason: null,
          user: { id: 'u1', name: 'Ana', email: 'ana@x.com', photoUrl: null },
          challenge: { id: 'c1', title: 'Ler um livro técnico', rewardCoins: 150 },
          reviewedBy: null,
        },
      },
    ])
    renderPage()

    expect(await screen.findByText(/em análise/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Participar' })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web exec vitest run src/pages/ChallengesPage.test.tsx`
Expected: FAIL — `Cannot find module './ChallengesPage'`.

- [ ] **Step 3: Implementar**

`apps/web/src/pages/ChallengesPage.tsx`:

```tsx
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CHALLENGE_NOTE_MAX_LENGTH, type MyChallengeDTO } from '@legends/shared'
import { apiFetch } from '../lib/api'

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Em análise',
  APPROVED: 'Aprovada',
  REJECTED: 'Não aprovada',
}

const STATUS_CLASS: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-rose-100 text-rose-800',
}

function ChallengeCard({ item }: { item: MyChallengeDTO }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = useMutation({
    mutationFn: () =>
      apiFetch(`/challenges/${item.id}/submissions`, {
        method: 'POST',
        body: JSON.stringify(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: () => {
      setOpen(false)
      setNote('')
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['my-challenges'] })
    },
    onError: (err: Error) => setError(err.message),
  })

  // Pendente e aprovada ocupam a vaga; rejeitada libera nova tentativa.
  const canParticipate = !item.mySubmission || item.mySubmission.status === 'REJECTED'

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">{item.title}</h2>
          <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{item.description}</p>
        </div>
        <span className="shrink-0 rounded-full bg-yellow-100 px-3 py-1 text-sm font-medium text-yellow-800">
          {item.rewardCoins} coins
        </span>
      </header>

      {item.mySubmission && (
        <div className="mt-4 rounded-md bg-slate-50 p-3 text-sm">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[item.mySubmission.status]}`}>
            {STATUS_LABEL[item.mySubmission.status]}
          </span>
          {item.mySubmission.rejectionReason && (
            <p className="mt-2 text-slate-700">{item.mySubmission.rejectionReason}</p>
          )}
        </div>
      )}

      {canParticipate && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Participar
        </button>
      )}

      {open && (
        <form
          className="mt-4 space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            submit.mutate()
          }}
        >
          <label className="block text-sm font-medium text-slate-700" htmlFor={`note-${item.id}`}>
            Conte como foi (opcional)
          </label>
          <textarea
            id={`note-${item.id}`}
            value={note}
            maxLength={CHALLENGE_NOTE_MAX_LENGTH}
            onChange={(event) => setNote(event.target.value)}
            rows={3}
            className="w-full rounded-md border border-slate-300 p-2 text-sm"
          />
          {error && <p className="text-sm text-rose-700">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submit.isPending}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Enviar participação
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
    </article>
  )
}

export function ChallengesPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['my-challenges'],
    queryFn: () => apiFetch<MyChallengeDTO[]>('/challenges'),
  })

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <h1 className="text-2xl font-bold text-slate-900">Desafios</h1>
      {isLoading && <p className="text-sm text-slate-500">Carregando desafios…</p>}
      {!isLoading && (data?.length ?? 0) === 0 && (
        <p className="text-sm text-slate-500">Nenhum desafio aberto no momento.</p>
      )}
      {data?.map((item) => <ChallengeCard key={item.id} item={item} />)}
    </div>
  )
}
```

- [ ] **Step 4: Registrar a rota**

Em `apps/web/src/App.tsx`, importar `ChallengesPage` e adicionar a rota dentro do mesmo bloco protegido das demais páginas de colaborador (siga o padrão da rota vizinha, ex. `/perfil`):

```tsx
<Route path="/desafios" element={<ChallengesPage />} />
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @legends/web exec vitest run src/pages/ChallengesPage.test.tsx`
Expected: PASS, 4 testes.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/ChallengesPage.tsx apps/web/src/pages/ChallengesPage.test.tsx apps/web/src/App.tsx
git commit -m "feat(web): tela de desafios do colaborador"
```

---

## Task 12: CRUD de desafios no admin

**Files:**
- Create: `apps/web/src/pages/admin/ChallengesSection.tsx`
- Create: `apps/web/src/pages/admin/ChallengesSection.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/pages/admin/AdminSidebar.tsx`

**Interfaces:**
- Consumes: Tasks 1, 10 (`/admin/challenges`).
- Produces: `export function ChallengesSection(): JSX.Element`

- [ ] **Step 1: Escrever os testes que falham**

`apps/web/src/pages/admin/ChallengesSection.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ChallengeDTO } from '@legends/shared'
import { ChallengesSection } from './ChallengesSection'
import { apiFetch } from '../../lib/api'

vi.mock('../../lib/api', () => ({ apiFetch: vi.fn() }))

const challenge: ChallengeDTO = {
  id: 'c1',
  title: 'Ler um livro técnico',
  description: 'Leia e conte.',
  rewardCoins: 150,
  active: true,
  startsAt: null,
  endsAt: null,
  sectorId: null,
  sectorName: null,
  submissionCount: 2,
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ChallengesSection />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(apiFetch).mockReset()
})

describe('ChallengesSection', () => {
  it('lista os desafios com recompensa e contagem de participações', async () => {
    vi.mocked(apiFetch).mockResolvedValue([challenge])
    renderSection()

    expect(await screen.findByText('Ler um livro técnico')).toBeInTheDocument()
    expect(screen.getByText('150')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('cria um desafio novo', async () => {
    vi.mocked(apiFetch).mockResolvedValue([])
    renderSection()
    await waitFor(() => expect(apiFetch).toHaveBeenCalled())

    await userEvent.type(screen.getByLabelText('Título'), 'Indicar um talento')
    await userEvent.type(screen.getByLabelText('Descrição'), 'Indique alguém.')
    await userEvent.clear(screen.getByLabelText('Recompensa (coins)'))
    await userEvent.type(screen.getByLabelText('Recompensa (coins)'), '300')
    await userEvent.click(screen.getByRole('button', { name: 'Criar desafio' }))

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/admin/challenges', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Indicar um talento',
          description: 'Indique alguém.',
          rewardCoins: 300,
          sectorId: null,
        }),
      })
    })
  })

  it('mostra o erro da API ao tentar apagar desafio com participações', async () => {
    vi.mocked(apiFetch).mockImplementation((path: string, init?: { method?: string }) => {
      if (init?.method === 'DELETE') {
        return Promise.reject(new Error('Desafio com participações não pode ser apagado. Desative-o.'))
      }
      return Promise.resolve([challenge])
    })
    renderSection()
    await screen.findByText('Ler um livro técnico')

    await userEvent.click(screen.getByRole('button', { name: 'Apagar' }))

    expect(
      await screen.findByText('Desafio com participações não pode ser apagado. Desative-o.'),
    ).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web exec vitest run src/pages/admin/ChallengesSection.test.tsx`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar**

`apps/web/src/pages/admin/ChallengesSection.tsx`:

```tsx
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ChallengeDTO } from '@legends/shared'
import { apiFetch } from '../../lib/api'

interface FormState {
  title: string
  description: string
  rewardCoins: string
}

const EMPTY_FORM: FormState = { title: '', description: '', rewardCoins: '0' }

export function ChallengesSection() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-challenges'],
    queryFn: () => apiFetch<ChallengeDTO[]>('/admin/challenges'),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin-challenges'] })

  const create = useMutation({
    mutationFn: () =>
      apiFetch('/admin/challenges', {
        method: 'POST',
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim(),
          rewardCoins: Number(form.rewardCoins),
          sectorId: null,
        }),
      }),
    onSuccess: () => {
      setForm(EMPTY_FORM)
      setError(null)
      void invalidate()
    },
    onError: (err: Error) => setError(err.message),
  })

  const toggleActive = useMutation({
    mutationFn: (challenge: ChallengeDTO) =>
      apiFetch(`/admin/challenges/${challenge.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: !challenge.active }),
      }),
    onSuccess: () => void invalidate(),
    onError: (err: Error) => setError(err.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/admin/challenges/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setError(null)
      void invalidate()
    },
    onError: (err: Error) => setError(err.message),
  })

  return (
    <section className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900">Desafios</h1>

      {error && <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}

      <form
        className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate()
        }}
      >
        <label className="text-sm font-medium text-slate-700" htmlFor="challenge-title">
          Título
          <input
            id="challenge-title"
            value={form.title}
            onChange={(event) => setForm((f) => ({ ...f, title: event.target.value }))}
            className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm font-normal"
          />
        </label>
        <label className="text-sm font-medium text-slate-700" htmlFor="challenge-reward">
          Recompensa (coins)
          <input
            id="challenge-reward"
            type="number"
            min={0}
            value={form.rewardCoins}
            onChange={(event) => setForm((f) => ({ ...f, rewardCoins: event.target.value }))}
            className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm font-normal"
          />
        </label>
        <label className="text-sm font-medium text-slate-700 sm:col-span-2" htmlFor="challenge-description">
          Descrição
          <textarea
            id="challenge-description"
            rows={3}
            value={form.description}
            onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
            className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm font-normal"
          />
        </label>
        <div className="sm:col-span-2">
          <button
            type="submit"
            disabled={create.isPending}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Criar desafio
          </button>
        </div>
      </form>

      {isLoading && <p className="text-sm text-slate-500">Carregando…</p>}

      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 text-slate-500">
          <tr>
            <th className="py-2">Desafio</th>
            <th className="py-2">Recompensa</th>
            <th className="py-2">Participações</th>
            <th className="py-2">Situação</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {data?.map((challenge) => (
            <tr key={challenge.id} className="border-b border-slate-100">
              <td className="py-2">{challenge.title}</td>
              <td className="py-2">{challenge.rewardCoins}</td>
              <td className="py-2">{challenge.submissionCount}</td>
              <td className="py-2">{challenge.active ? 'Ativo' : 'Inativo'}</td>
              <td className="py-2 text-right">
                <button
                  type="button"
                  onClick={() => toggleActive.mutate(challenge)}
                  className="mr-3 text-slate-600 underline"
                >
                  {challenge.active ? 'Desativar' : 'Ativar'}
                </button>
                <button type="button" onClick={() => remove.mutate(challenge.id)} className="text-rose-700 underline">
                  Apagar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
```

- [ ] **Step 4: Registrar rota e item de menu**

Em `apps/web/src/App.tsx`, importar `ChallengesSection` e adicionar dentro do bloco de rotas `/admin`:

```tsx
<Route path="desafios" element={<ChallengesSection />} />
```

Em `apps/web/src/pages/admin/AdminSidebar.tsx`, no grupo `Comunidade`, após o item de Moderação:

```ts
      { to: '/admin/desafios', label: 'Desafios' },
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @legends/web exec vitest run src/pages/admin/ChallengesSection.test.tsx`
Expected: PASS, 3 testes.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/admin/ChallengesSection.tsx apps/web/src/pages/admin/ChallengesSection.test.tsx \
        apps/web/src/App.tsx apps/web/src/pages/admin/AdminSidebar.tsx
git commit -m "feat(web): CRUD de desafios no admin"
```

---

## Task 13: A fila de resultados

**Files:**
- Create: `apps/web/src/pages/admin/ChallengeSubmissionsSection.tsx`
- Create: `apps/web/src/pages/admin/ChallengeSubmissionsSection.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/pages/admin/AdminSidebar.tsx`

**Interfaces:**
- Consumes: Tasks 1, 10, 12.
- Produces: `export function ChallengeSubmissionsSection(): JSX.Element`

- [ ] **Step 1: Escrever os testes que falham**

`apps/web/src/pages/admin/ChallengeSubmissionsSection.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ChallengeSubmissionDTO } from '@legends/shared'
import { ChallengeSubmissionsSection } from './ChallengeSubmissionsSection'
import { apiFetch, apiFetchBlob } from '../../lib/api'

vi.mock('../../lib/api', () => ({ apiFetch: vi.fn(), apiFetchBlob: vi.fn() }))

function submission(id: string, name: string): ChallengeSubmissionDTO {
  return {
    id,
    status: 'PENDING',
    note: 'Fiz!',
    evidenceUrl: null,
    submittedAt: '2026-08-01T12:00:00.000Z',
    reviewedAt: null,
    rejectionReason: null,
    user: { id: `u-${id}`, name, email: `${name}@x.com`, photoUrl: null },
    challenge: { id: 'c1', title: 'Ler um livro', rewardCoins: 150 },
    reviewedBy: null,
  }
}

/** Roteia a resposta por path: fila, desafios do filtro e mutações. */
function mockApi(page: { items: ChallengeSubmissionDTO[]; nextCursor: string | null }, overrides: Record<string, unknown> = {}) {
  vi.mocked(apiFetch).mockImplementation((path: string) => {
    for (const [prefix, value] of Object.entries(overrides)) {
      if (path.startsWith(prefix)) {
        return value instanceof Error ? Promise.reject(value) : Promise.resolve(value)
      }
    }
    if (path.startsWith('/admin/challenge-submissions')) return Promise.resolve(page)
    if (path.startsWith('/admin/challenges')) return Promise.resolve([])
    return Promise.resolve(null)
  })
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ChallengeSubmissionsSection />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(apiFetch).mockReset()
})

describe('ChallengeSubmissionsSection', () => {
  it('lista a fila de pendentes', async () => {
    mockApi({ items: [submission('s1', 'Ana')], nextCursor: null })
    renderSection()

    expect(await screen.findByText('Ana')).toBeInTheDocument()
    expect(screen.getByText('Ler um livro')).toBeInTheDocument()
  })

  it('busca a fila com o filtro de status da aba', async () => {
    mockApi({ items: [], nextCursor: null })
    renderSection()
    await waitFor(() => expect(apiFetch).toHaveBeenCalled())

    await userEvent.click(screen.getByRole('button', { name: 'Todas' }))

    await waitFor(() => {
      const paths = vi.mocked(apiFetch).mock.calls.map((c) => c[0] as string)
      expect(paths.some((p) => p.startsWith('/admin/challenge-submissions?') && !p.includes('status='))).toBe(true)
    })
  })

  it('aprova uma submissão individual', async () => {
    mockApi({ items: [submission('s1', 'Ana')], nextCursor: null })
    renderSection()
    await screen.findByText('Ana')

    await userEvent.click(screen.getByRole('button', { name: 'Aprovar' }))

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/admin/challenge-submissions/s1/approve', { method: 'POST' })
    })
  })

  it('exige motivo para rejeitar', async () => {
    mockApi({ items: [submission('s1', 'Ana')], nextCursor: null })
    renderSection()
    await screen.findByText('Ana')

    await userEvent.click(screen.getByRole('button', { name: 'Rejeitar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar rejeição' }))

    expect(await screen.findByText(/informe o motivo/i)).toBeInTheDocument()
    expect(apiFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/reject'),
      expect.anything(),
    )
  })

  it('reporta sucessos e falhas do lote', async () => {
    mockApi(
      { items: [submission('s1', 'Ana'), submission('s2', 'Bruno')], nextCursor: null },
      { '/admin/challenge-submissions/batch': { succeeded: ['s1'], failed: [{ id: 's2', message: 'Esta participação já foi avaliada.' }] } },
    )
    renderSection()
    await screen.findByText('Ana')

    await userEvent.click(screen.getByLabelText('Selecionar Ana'))
    await userEvent.click(screen.getByLabelText('Selecionar Bruno'))
    await userEvent.click(screen.getByRole('button', { name: /aprovar selecionadas/i }))

    expect(await screen.findByText(/1 aprovada/i)).toBeInTheDocument()
    expect(await screen.findByText(/Esta participação já foi avaliada\./)).toBeInTheDocument()
  })

  it('exporta o CSV pelo caminho autenticado, com os filtros da tela', async () => {
    mockApi({ items: [submission('s1', 'Ana')], nextCursor: null })
    vi.mocked(apiFetchBlob).mockResolvedValue({ blob: new Blob(['a;b']), filename: 'resultados-desafios.csv' })
    const createObjectURL = vi.fn(() => 'blob:x')
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() })
    renderSection()
    await screen.findByText('Ana')

    await userEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }))

    await waitFor(() => {
      // Nunca um <a href> cru: o token só vive em memória e daria 401.
      expect(apiFetchBlob).toHaveBeenCalledWith(
        expect.stringContaining('/admin/challenge-submissions/export.csv?status=PENDING'),
      )
    })
  })

  it('carrega a próxima página pelo cursor devolvido pelo servidor', async () => {
    mockApi({ items: [submission('s1', 'Ana')], nextCursor: 'CURSOR-2' })
    renderSection()
    await screen.findByText('Ana')

    await userEvent.click(screen.getByRole('button', { name: 'Carregar mais' }))

    await waitFor(() => {
      const paths = vi.mocked(apiFetch).mock.calls.map((c) => c[0] as string)
      expect(paths.some((p) => p.includes('cursor=CURSOR-2'))).toBe(true)
    })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @legends/web exec vitest run src/pages/admin/ChallengeSubmissionsSection.test.tsx`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar**

`apps/web/src/pages/admin/ChallengeSubmissionsSection.tsx`:

```tsx
import { useMemo, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CHALLENGE_SUBMISSION_PAGE_SIZE,
  REJECTION_REASON_MIN_LENGTH,
  type ChallengeBatchResult,
  type ChallengeDTO,
  type ChallengeSubmissionDTO,
  type ChallengeSubmissionPage,
  type ChallengeSubmissionStatus,
} from '@legends/shared'
import { apiFetch, apiFetchBlob } from '../../lib/api'

type Tab = 'PENDING' | 'ALL'

const STATUS_LABEL: Record<ChallengeSubmissionStatus, string> = {
  PENDING: 'Pendente',
  APPROVED: 'Aprovada',
  REJECTED: 'Rejeitada',
}

interface Filters {
  userId: string
  challengeId: string
}

/** Querystring da fila. A paginação é do SERVIDOR — nunca fatiar no cliente. */
function buildQuery(tab: Tab, filters: Filters, cursor?: string): string {
  const params = new URLSearchParams()
  if (tab === 'PENDING') params.set('status', 'PENDING')
  if (filters.userId) params.set('userId', filters.userId)
  if (filters.challengeId) params.set('challengeId', filters.challengeId)
  params.set('limit', String(CHALLENGE_SUBMISSION_PAGE_SIZE))
  if (cursor) params.set('cursor', cursor)
  return params.toString()
}

export function ChallengeSubmissionsSection() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('PENDING')
  const [filters, setFilters] = useState<Filters>({ userId: '', challengeId: '' })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [rejecting, setRejecting] = useState<{ ids: string[] } | null>(null)
  const [reason, setReason] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [batchResult, setBatchResult] = useState<ChallengeBatchResult | null>(null)

  const challenges = useQuery({
    queryKey: ['admin-challenges'],
    queryFn: () => apiFetch<ChallengeDTO[]>('/admin/challenges'),
  })

  const queue = useInfiniteQuery({
    queryKey: ['admin-challenge-submissions', tab, filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiFetch<ChallengeSubmissionPage>(`/admin/challenge-submissions?${buildQuery(tab, filters, pageParam)}`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })

  const items = useMemo(() => queue.data?.pages.flatMap((p) => p.items) ?? [], [queue.data])

  const refresh = () => {
    setSelected(new Set())
    void queryClient.invalidateQueries({ queryKey: ['admin-challenge-submissions'] })
  }

  const approveOne = useMutation({
    mutationFn: (id: string) => apiFetch(`/admin/challenge-submissions/${id}/approve`, { method: 'POST' }),
    onSuccess: refresh,
    onError: (err: Error) => setFormError(err.message),
  })

  const rejectOne = useMutation({
    mutationFn: ({ id, rejectionReason }: { id: string; rejectionReason: string }) =>
      apiFetch(`/admin/challenge-submissions/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ rejectionReason }),
      }),
    onSuccess: () => {
      setRejecting(null)
      setReason('')
      refresh()
    },
    onError: (err: Error) => setFormError(err.message),
  })

  const batch = useMutation({
    mutationFn: (payload: { ids: string[]; decision: 'APPROVE' | 'REJECT'; rejectionReason?: string }) =>
      apiFetch<ChallengeBatchResult>('/admin/challenge-submissions/batch', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: (result) => {
      setBatchResult(result)
      setRejecting(null)
      setReason('')
      refresh()
    },
    onError: (err: Error) => setFormError(err.message),
  })

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function confirmRejection() {
    if (reason.trim().length < REJECTION_REASON_MIN_LENGTH) {
      setFormError(`Informe o motivo da rejeição (mínimo ${REJECTION_REASON_MIN_LENGTH} caracteres).`)
      return
    }
    setFormError(null)
    const ids = rejecting?.ids ?? []
    if (ids.length === 1) rejectOne.mutate({ id: ids[0], rejectionReason: reason.trim() })
    else batch.mutate({ ids, decision: 'REJECT', rejectionReason: reason.trim() })
  }

  /**
   * O CSV NÃO pode ser um <a href> comum: o access token só vive em memória, e
   * navegar direto para a URL não mandaria o Authorization — cairia em 401.
   * `apiFetchBlob` já resolve isso (mesmo caminho do download de .ics).
   */
  async function downloadCsv() {
    try {
      const { blob, filename } = await apiFetchBlob(
        `/admin/challenge-submissions/export.csv?${buildQuery(tab, filters)}`,
      )
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename ?? 'resultados-desafios.csv'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Não foi possível exportar o CSV.')
    }
  }

  return (
    <section className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900">Resultados dos desafios</h1>
        <button
          type="button"
          onClick={() => void downloadCsv()}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm"
        >
          Exportar CSV
        </button>
      </header>

      <div className="flex gap-2">
        {(['PENDING', 'ALL'] as Tab[]).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setTab(value)
              setSelected(new Set())
            }}
            className={`rounded-md px-3 py-1.5 text-sm ${tab === value ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}
          >
            {value === 'PENDING' ? 'Pendentes' : 'Todas'}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-3">
        <label className="text-sm text-slate-700">
          Desafio
          <select
            value={filters.challengeId}
            onChange={(event) => setFilters((f) => ({ ...f, challengeId: event.target.value }))}
            className="mt-1 block rounded-md border border-slate-300 p-2 text-sm"
          >
            <option value="">Todos</option>
            {challenges.data?.map((challenge) => (
              <option key={challenge.id} value={challenge.id}>
                {challenge.title}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-slate-700">
          Pessoa
          <select
            value={filters.userId}
            onChange={(event) => setFilters((f) => ({ ...f, userId: event.target.value }))}
            className="mt-1 block rounded-md border border-slate-300 p-2 text-sm"
          >
            <option value="">Todas</option>
            {/* Opções vêm das pessoas já presentes na fila carregada. */}
            {[...new Map(items.map((i) => [i.user.id, i.user])).values()].map((user) => (
              <option key={user.id} value={user.id}>
                {user.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {formError && <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-800">{formError}</p>}

      {batchResult && (
        <div className="rounded-md bg-slate-50 p-3 text-sm">
          <p className="font-medium text-slate-800">
            {batchResult.succeeded.length} aprovada(s) ou rejeitada(s), {batchResult.failed.length} com falha.
          </p>
          <ul className="mt-1 list-inside list-disc text-slate-600">
            {batchResult.failed.map((failure) => (
              <li key={failure.id}>{failure.message}</li>
            ))}
          </ul>
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-md bg-slate-100 p-3 text-sm">
          <span>{selected.size} selecionada(s)</span>
          <button
            type="button"
            onClick={() => batch.mutate({ ids: [...selected], decision: 'APPROVE' })}
            className="rounded-md bg-emerald-700 px-3 py-1.5 text-white"
          >
            Aprovar selecionadas
          </button>
          <button
            type="button"
            onClick={() => setRejecting({ ids: [...selected] })}
            className="rounded-md bg-rose-700 px-3 py-1.5 text-white"
          >
            Rejeitar selecionadas
          </button>
        </div>
      )}

      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 text-slate-500">
          <tr>
            <th className="py-2" />
            <th className="py-2">Pessoa</th>
            <th className="py-2">Desafio</th>
            <th className="py-2">Recompensa</th>
            <th className="py-2">Status</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {items.map((item: ChallengeSubmissionDTO) => (
            <tr key={item.id} className="border-b border-slate-100 align-top">
              <td className="py-2">
                {item.status === 'PENDING' && (
                  <input
                    type="checkbox"
                    aria-label={`Selecionar ${item.user.name}`}
                    checked={selected.has(item.id)}
                    onChange={() => toggle(item.id)}
                  />
                )}
              </td>
              <td className="py-2">
                <div className="font-medium text-slate-900">{item.user.name}</div>
                {item.note && <p className="text-slate-600">{item.note}</p>}
                {item.evidenceUrl && (
                  <a href={item.evidenceUrl} className="text-slate-600 underline" target="_blank" rel="noreferrer">
                    Ver evidência
                  </a>
                )}
              </td>
              <td className="py-2">{item.challenge.title}</td>
              <td className="py-2">{item.challenge.rewardCoins}</td>
              <td className="py-2">
                {STATUS_LABEL[item.status]}
                {item.rejectionReason && <p className="text-slate-500">{item.rejectionReason}</p>}
              </td>
              <td className="py-2 text-right">
                {item.status === 'PENDING' && (
                  <>
                    <button
                      type="button"
                      onClick={() => approveOne.mutate(item.id)}
                      className="mr-3 text-emerald-700 underline"
                    >
                      Aprovar
                    </button>
                    <button
                      type="button"
                      onClick={() => setRejecting({ ids: [item.id] })}
                      className="text-rose-700 underline"
                    >
                      Rejeitar
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {queue.hasNextPage && (
        <button
          type="button"
          onClick={() => void queue.fetchNextPage()}
          disabled={queue.isFetchingNextPage}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm disabled:opacity-50"
        >
          Carregar mais
        </button>
      )}

      {rejecting && (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-slate-900">
            Rejeitar {rejecting.ids.length} participação(ões)
          </h2>
          <label className="mt-2 block text-sm text-slate-700" htmlFor="rejection-reason">
            Motivo
            <textarea
              id="rejection-reason"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 p-2 text-sm"
            />
          </label>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={confirmRejection} className="rounded-md bg-rose-700 px-4 py-2 text-sm text-white">
              Confirmar rejeição
            </button>
            <button
              type="button"
              onClick={() => {
                setRejecting(null)
                setReason('')
                setFormError(null)
              }}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Registrar rota e item de menu**

Em `apps/web/src/App.tsx`, importar `ChallengeSubmissionsSection` e adicionar sob `/admin`:

```tsx
<Route path="resultados-desafios" element={<ChallengeSubmissionsSection />} />
```

Em `apps/web/src/pages/admin/AdminSidebar.tsx`, no grupo `Comunidade`, logo após o item `Desafios`:

```ts
      { to: '/admin/resultados-desafios', label: 'Resultados dos desafios' },
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @legends/web exec vitest run src/pages/admin/ChallengeSubmissionsSection.test.tsx`
Expected: PASS, 7 testes.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/admin/ChallengeSubmissionsSection.tsx \
        apps/web/src/pages/admin/ChallengeSubmissionsSection.test.tsx \
        apps/web/src/App.tsx apps/web/src/pages/admin/AdminSidebar.tsx
git commit -m "feat(web): fila de resultados dos desafios"
```

---

## Task 14: Verificação final

**Files:** nenhum arquivo novo; correções onde a suíte apontar.

- [ ] **Step 1: Garantir Postgres de pé**

Run: `pnpm db:up`
Expected: container `legends-db` rodando na 5432.

- [ ] **Step 2: Rodar a suíte inteira**

Run: `pnpm test`
Expected: todos os workspaces verdes. Corrija o que quebrar antes de seguir — em especial os testes de `AdminSidebar.test.tsx`, que costumam contar itens de menu e podem precisar dos dois itens novos.

- [ ] **Step 3: Typecheck e build**

Run: `pnpm build`
Expected: build de `shared`, `api` e `web` sem erro de tipo.

- [ ] **Step 4: Conferir que a migration não deixou drift**

Rode o mesmo `migrate diff` do Step 9 da Task 2 (banco descartável + `--script`).
Expected: `-- This is an empty migration.`

- [ ] **Step 5: Commit final, se houver ajuste**

```bash
git add -A
git commit -m "chore: ajustes da suíte completa para desafios"
```

---

## Rastreabilidade — critérios de aceite → tasks

| Critério de aceite | Onde é garantido |
| --- | --- |
| Aprovar credita exatamente a recompensa configurada | Task 6, teste "credita exatamente a recompensa do desafio" |
| Aprovar duas vezes (inclusive em paralelo) credita uma vez | Task 6, testes "aprovar duas vezes" e "duas aprovações CONCORRENTES" |
| Rejeitar não credita e registra o motivo | Task 6, "não credita, guarda o motivo e libera nova participação" |
| Pessoa notificada; falha no envio não desfaz | Task 6, `notifyBestEffort` + teste "falha na notificação NÃO desfaz" |
| Não há duas submissões pendentes no mesmo desafio | Tasks 2 e 5, índice parcial + `SubmissionAlreadyOpenError` |
| Fila paginada no servidor, filtros combinados | Tasks 7 e 13 |
| CSV reflete o recorte filtrado | Task 8, teste "reflete o recorte filtrado" |
| SUBADMIN restrito ao próprio setor; 403 para não-admin | Tasks 4, 6, 7, 10 |
| Auditoria da mutação de admin | Task 6, `recordAuditLog` dentro da transação |

# Loja de recompensas em EMR Coins — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar um sink à moeda interna — catálogo de produtos em EMR Coins, resgate que debita o livro-razão e baixa o estoque na mesma transação, e fila de aprovação/entrega/cancelamento para a G&G.

**Architecture:** Route → service → Prisma, em duas camadas por público: `store-service` (vitrine e resgate do colaborador) e `store-admin-service` (CRUD de produto e fila). O resgate e o cancelamento são `$transaction` com **advisory lock por pessoa** (protege o saldo, que é um `aggregate` e não trava nada) mais **UPDATE condicional no produto** (protege o estoque entre pessoas diferentes). O débito e o estorno entram no livro-razão existente com kinds novos `SPEND`/`REFUND` e `dedupeKey` derivado do id do pedido — a unique `(userId, dedupeKey)` é a garantia final de que ninguém credita duas vezes.

**Tech Stack:** TypeScript ESM strict, Fastify 4, Prisma 5 + PostgreSQL, Zod, Vitest (API contra Postgres real), React 18 + React Query + Tailwind, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-02-loja-recompensas-coins-design.md` — leia antes da Task 1.

## Global Constraints

- **Contrato primeiro.** Tipo/DTO/constante nasce em `packages/shared/src/*.ts` com barril em `index.ts`; só depois API e web consomem. Nunca declare o mesmo shape dos dois lados.
- **Camadas finas.** Rota valida com Zod (`safeParse` → `400 { message, issues }`), chama o service, serializa com `lib/serialize.ts`. Zero regra de negócio na rota; zero `reply` no service.
- **Multi-empresa.** Todo model novo leva `companyId` + índice, entra em `TENANT_SCOPED_MODELS` (`apps/api/src/lib/tenant-scope.ts`) e é lido/escrito por `scopedPrisma(companyId)`. Dentro de um `tx` cru (que **não** passa por `scopedPrisma`), `companyId` vai **explícito** em todo `where` e `data`.
- **Auditoria.** Toda mutação de admin chama `recordAuditLog(...)` — dentro da mesma transação (`tx`) quando houver uma.
- **Migrations.** Só via `pnpm db:migrate`. **Nunca** editar migration já aplicada. Esta feature tem **uma única** migration (Task 2).
- **Textos ao usuário em português** (pt-BR), inclusive mensagens de erro de domínio.
- **Testes ao lado do arquivo** (`*.test.ts` / `*.test.tsx`). Durante a implementação rode **só o arquivo de teste do que mudou**; a suíte completa (`pnpm test`) é lenta e fica para a verificação final.
- **Antes de qualquer comando de banco** (`pnpm db:up`, `pnpm db:migrate`, testes da API): rode `docker ps` e confira em que porta o Postgres deste worktree está. A porta **5442 pertence a outro worktree** — migrar ou truncar lá quebra o trabalho de outra pessoa. Use `LEGENDS_DB_PORT=<porta certa>` em **todos** os comandos de banco e de teste da API.
- **Estilo:** siga o arquivo vizinho da mesma camada. Comentário só onde explica *por quê*, no tom do repo.

## File Structure

**`packages/shared`**
- `src/store.ts` *(criar)* — statuses, transições, categorias, limites, DTOs.
- `src/store.test.ts` *(criar)* — trava a tabela de transições.
- `src/coin.ts` *(modificar)* — `SPEND`/`REFUND` em `COIN_TRANSACTION_KINDS` + rótulos.
- `src/index.ts` *(modificar)* — exporta `./store`.

**`apps/api`**
- `prisma/schema.prisma` *(modificar)* — 2 models, 1 enum novo, 2 enums estendidos.
- `src/lib/tenant-scope.ts` *(modificar)* — registra os models novos.
- `src/lib/csv.ts` *(criar)* — `csvCell`/`csvDate` extraídos de `challenge-submission-service.ts`.
- `src/lib/serialize.ts` *(modificar)* — `toStoreProductDTO`, `toStoreOrderDTO`, `toStoreOrderAdminDTO`.
- `src/services/coin-service.ts` *(modificar)* — `spendCoins`, `refundCoins`.
- `src/services/store-service.ts` *(criar)* — erros de domínio, vitrine, resgate, meus pedidos.
- `src/services/store-admin-service.ts` *(criar)* — CRUD de produto, fila, transições, estorno, lote, CSV.
- `src/services/notification-service.ts` *(modificar)* — `notifyStoreOrderStatus`.
- `src/routes/store.ts` *(criar)* / `src/routes/admin-store.ts` *(criar)*.
- `src/app.ts` *(modificar)* — registra as duas rotas.

**`apps/web`**
- `src/lib/use-store.ts` *(criar)* — hooks de React Query da vitrine.
- `src/pages/StorePage.tsx` *(criar)* — vitrine + meus pedidos.
- `src/pages/admin/StoreSection.tsx` *(criar)* — abas + guarda.
- `src/pages/admin/StoreOrdersTab.tsx` *(criar)* — fila, filtros, lote, CSV.
- `src/pages/admin/StoreProductsTab.tsx` *(criar)* — tabela de produtos.
- `src/pages/admin/StoreProductForm.tsx` *(criar)* — formulário + upload de capa.
- `src/App.tsx`, `src/components/nav-items.ts`, `src/pages/admin/AdminSidebar.tsx` *(modificar)*.

---

### Task 1: Contrato compartilhado

**Files:**
- Create: `packages/shared/src/store.ts`
- Create: `packages/shared/src/store.test.ts`
- Modify: `packages/shared/src/coin.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `STORE_PRODUCT_CATEGORIES`, `StoreProductCategory`, `STORE_ORDER_STATUSES`, `StoreOrderStatus`, `STORE_ORDER_STATUS_LABELS`, `STORE_ORDER_TRANSITIONS`, `canTransitionStoreOrder(from, to): boolean`, `StoreProductDTO`, `StoreOrderDTO`, `StoreOrderAdminDTO`, `CreateStoreProductRequest`, `UpdateStoreProductRequest`, `CreateStoreOrderRequest`, `UpdateStoreOrderRequest`, `StoreOrderBatchRequest`, `StoreOrderBatchResult`, `StoreProductListResponse`, `StoreOrderListResponse`, `StoreOrderAdminListResponse`, `CreateStoreOrderResponse`, e os limites `STORE_PRODUCT_TITLE_MAX_LENGTH` (120), `STORE_PRODUCT_DESCRIPTION_MAX_LENGTH` (600), `STORE_ADMIN_NOTES_MAX_LENGTH` (500), `STORE_PRICE_MIN` (1), `STORE_PRICE_MAX` (1_000_000), `STORE_STOCK_MAX` (100_000), `STORE_ORDER_PAGE_SIZE` (20), `STORE_EXPORT_MAX_ROWS` (5000), `STORE_BATCH_MAX_IDS` (100). Em `coin.ts`: `'SPEND'` e `'REFUND'` dentro de `COIN_TRANSACTION_KINDS`.

- [ ] **Step 1: Escreva o teste que falha**

`packages/shared/src/store.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  STORE_ORDER_STATUSES,
  STORE_ORDER_STATUS_LABELS,
  STORE_ORDER_TRANSITIONS,
  canTransitionStoreOrder,
} from './store'
import { COIN_TRANSACTION_KINDS, COIN_TRANSACTION_KIND_LABELS } from './coin'

describe('transições de pedido', () => {
  it('pendente vai para aprovado ou cancelado', () => {
    expect(canTransitionStoreOrder('PENDING', 'APPROVED')).toBe(true)
    expect(canTransitionStoreOrder('PENDING', 'CANCELLED')).toBe(true)
    expect(canTransitionStoreOrder('PENDING', 'DELIVERED')).toBe(false)
  })

  it('aprovado vai para entregue ou cancelado', () => {
    expect(canTransitionStoreOrder('APPROVED', 'DELIVERED')).toBe(true)
    expect(canTransitionStoreOrder('APPROVED', 'CANCELLED')).toBe(true)
    expect(canTransitionStoreOrder('APPROVED', 'PENDING')).toBe(false)
  })

  it('entregue e cancelado são terminais', () => {
    for (const to of STORE_ORDER_STATUSES) {
      expect(canTransitionStoreOrder('DELIVERED', to)).toBe(false)
      expect(canTransitionStoreOrder('CANCELLED', to)).toBe(false)
    }
  })

  it('nenhum status volta para si mesmo', () => {
    for (const status of STORE_ORDER_STATUSES) {
      expect(STORE_ORDER_TRANSITIONS[status]).not.toContain(status)
    }
  })

  it('todo status tem rótulo em português', () => {
    for (const status of STORE_ORDER_STATUSES) {
      expect(STORE_ORDER_STATUS_LABELS[status]).toBeTruthy()
    }
  })
})

describe('kinds do livro-razão', () => {
  it('inclui gasto e estorno da loja, com rótulo', () => {
    expect(COIN_TRANSACTION_KINDS).toContain('SPEND')
    expect(COIN_TRANSACTION_KINDS).toContain('REFUND')
    expect(COIN_TRANSACTION_KIND_LABELS.SPEND).toBe('Resgate na loja')
    expect(COIN_TRANSACTION_KIND_LABELS.REFUND).toBe('Estorno de resgate')
  })
})
```

- [ ] **Step 2: Rode o teste e confirme que falha**

Run: `pnpm --filter @legends/shared exec vitest run src/store.test.ts`
Expected: FAIL — `Failed to resolve import "./store"`.

- [ ] **Step 3: Escreva o contrato**

`packages/shared/src/store.ts`:

```ts
/**
 * Loja de recompensas — o sink dos EMR Coins.
 *
 * A pessoa gasta coins e gera um PEDIDO; a G&G aprova, entrega ou cancela.
 * `productTitle` e `pricePaid` são congelados no pedido de propósito: o produto
 * muda de nome e de preço depois, e o pedido é histórico.
 */

/** Categorias do catálogo. String e não enum do Prisma: incluir uma não deve custar migration. */
export const STORE_PRODUCT_CATEGORIES = ['Conteúdo', 'Equipamento', 'Experiência'] as const
export type StoreProductCategory = (typeof STORE_PRODUCT_CATEGORIES)[number]

export const STORE_ORDER_STATUSES = ['PENDING', 'APPROVED', 'DELIVERED', 'CANCELLED'] as const
export type StoreOrderStatus = (typeof STORE_ORDER_STATUSES)[number]

export const STORE_ORDER_STATUS_LABELS: Record<StoreOrderStatus, string> = {
  PENDING: 'Pendente',
  APPROVED: 'Aprovado',
  DELIVERED: 'Entregue',
  CANCELLED: 'Cancelado',
}

/**
 * ÚNICA fonte de verdade das transições — service e web leem daqui. Cancelar só
 * vale antes da entrega: depois de entregue não há o que estornar.
 */
export const STORE_ORDER_TRANSITIONS: Record<StoreOrderStatus, readonly StoreOrderStatus[]> = {
  PENDING: ['APPROVED', 'CANCELLED'],
  APPROVED: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
}

export function canTransitionStoreOrder(from: StoreOrderStatus, to: StoreOrderStatus): boolean {
  return STORE_ORDER_TRANSITIONS[from].includes(to)
}

export const STORE_PRODUCT_TITLE_MAX_LENGTH = 120
export const STORE_PRODUCT_DESCRIPTION_MAX_LENGTH = 600
export const STORE_ADMIN_NOTES_MAX_LENGTH = 500
export const STORE_PRICE_MIN = 1
export const STORE_PRICE_MAX = 1_000_000
export const STORE_STOCK_MAX = 100_000
export const STORE_ORDER_PAGE_SIZE = 20
export const STORE_EXPORT_MAX_ROWS = 5000
export const STORE_BATCH_MAX_IDS = 100

export interface StoreProductDTO {
  id: string
  title: string
  description: string | null
  category: StoreProductCategory
  priceInCoins: number
  stock: number
  /** URL derivada da chave do S3; a chave nunca sai da API. */
  imageUrl: string | null
  isDigital: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
}

/** O que a PESSOA vê. Sem `adminNotes`: a nota da G&G é interna. */
export interface StoreOrderDTO {
  id: string
  status: StoreOrderStatus
  /** null quando o produto foi apagado depois — o pedido sobrevive. */
  productId: string | null
  /** Congelado no resgate; não é o nome atual do produto. */
  productTitle: string
  /** Congelado no resgate; não é o preço atual do produto. */
  pricePaid: number
  imageUrl: string | null
  handledAt: string | null
  createdAt: string
}

/** O que a FILA vê: tudo do colaborador mais a nota interna e quem tratou. */
export interface StoreOrderAdminDTO extends StoreOrderDTO {
  adminNotes: string | null
  user: { id: string; name: string; email: string }
  handledBy: { id: string; name: string } | null
}

export interface CreateStoreProductRequest {
  title: string
  description?: string | null
  category: StoreProductCategory
  priceInCoins: number
  stock: number
  /** Só entra quando o form subiu um arquivo novo; omitido, o PATCH preserva a capa. */
  imageKey?: string | null
  isDigital?: boolean
  isActive?: boolean
}

export type UpdateStoreProductRequest = Partial<CreateStoreProductRequest>

export interface CreateStoreOrderRequest {
  productId: string
}

export interface UpdateStoreOrderRequest {
  status: StoreOrderStatus
  adminNotes?: string | null
}

export interface StoreOrderBatchRequest {
  ids: string[]
  status: StoreOrderStatus
  adminNotes?: string | null
}

/** Lote NUNCA é tudo-ou-nada: sempre diz o que passou e o que falhou, com o motivo. */
export interface StoreOrderBatchResult {
  succeeded: string[]
  failed: { id: string; message: string }[]
}

export interface StoreProductListResponse {
  products: StoreProductDTO[]
}

export interface StoreOrderListResponse {
  orders: StoreOrderDTO[]
  total: number
  page: number
  pageSize: number
}

export interface StoreOrderAdminListResponse {
  orders: StoreOrderAdminDTO[]
  total: number
  page: number
  pageSize: number
}

export interface CreateStoreOrderResponse {
  order: StoreOrderDTO
  /** Saldo já atualizado — evita um refetch imediato do chip de coins. */
  balance: number
}
```

- [ ] **Step 4: Estenda os kinds do livro-razão**

Em `packages/shared/src/coin.ts`, troque a linha de `COIN_TRANSACTION_KINDS` e o mapa de rótulos:

```ts
export const COIN_TRANSACTION_KINDS = [
  'EARN',
  'MANUAL_CREDIT',
  'MANUAL_DEBIT',
  /** Resgate na loja: amount negativo, dedupeKey `STORE_ORDER:<orderId>`. */
  'SPEND',
  /** Estorno de resgate cancelado: amount positivo, dedupeKey `STORE_REFUND:<orderId>`. */
  'REFUND',
] as const

export const COIN_TRANSACTION_KIND_LABELS: Record<CoinTransactionKind, string> = {
  EARN: 'Ganho',
  MANUAL_CREDIT: 'Crédito manual',
  MANUAL_DEBIT: 'Débito manual',
  SPEND: 'Resgate na loja',
  REFUND: 'Estorno de resgate',
}
```

Em `packages/shared/src/index.ts`, junto dos outros re-exports:

```ts
export * from './store'
```

- [ ] **Step 5: Rode os testes e confirme que passam**

Run: `pnpm --filter @legends/shared exec vitest run src/store.test.ts src/coin.test.ts`
Expected: PASS. `coin.test.ts` entra junto porque os kinds mudaram — se ele fizer asserção sobre o tamanho da lista, ajuste o teste existente para a lista nova.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/store.ts packages/shared/src/store.test.ts \
        packages/shared/src/coin.ts packages/shared/src/coin.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): contrato da loja de recompensas e kinds SPEND/REFUND"
```

---

### Task 2: Schema, migration e isolamento por empresa

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `apps/api/src/lib/tenant-scope.ts`
- Create: `apps/api/src/lib/tenant-scope.store.test.ts`

**Interfaces:**
- Consumes: nada da Task 1 em runtime (o Prisma tem seus próprios enums).
- Produces: models `StoreProduct` e `StoreOrder`, enum `StoreOrderStatus`, valores `SPEND`/`REFUND` em `CoinTransactionKind`, valores `STORE_ORDER_APPROVED`/`STORE_ORDER_DELIVERED`/`STORE_ORDER_CANCELLED` em `NotificationType`. Delegates `prisma.storeProduct` e `prisma.storeOrder`.

**Esta é a única migration da feature** — os valores de `NotificationType` entram aqui mesmo, embora só sejam usados na Task 9, para não precisar de uma segunda migration depois.

- [ ] **Step 1: Escreva o teste que falha**

`apps/api/src/lib/tenant-scope.store.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from './prisma'
import { scopedPrisma } from './tenant-scope'

const OTHER_COMPANY_ID = 'company-outra'

async function ensureOtherCompany() {
  await prisma.company.upsert({
    where: { id: OTHER_COMPANY_ID },
    update: {},
    create: { id: OTHER_COMPANY_ID, name: 'Outra', slug: 'outra' },
  })
}

describe('isolamento por empresa da loja', () => {
  it('produto de uma empresa não vaza para a outra', async () => {
    await ensureOtherCompany()
    const admin = await prisma.user.create({
      data: { name: 'Admin', email: `a-${Math.random()}@x.com`, passwordHash: 'x', role: 'ADMIN' },
    })
    await scopedPrisma(DEFAULT_COMPANY_ID).storeProduct.create({
      data: {
        title: 'Fone', category: 'Equipamento', priceInCoins: 100, stock: 3,
        createdById: admin.id,
      },
    })

    const daEmpresa = await scopedPrisma(DEFAULT_COMPANY_ID).storeProduct.findMany()
    const daOutra = await scopedPrisma(OTHER_COMPANY_ID).storeProduct.findMany()

    expect(daEmpresa).toHaveLength(1)
    expect(daOutra).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Rode o teste e confirme que falha**

Confira a porta primeiro:

```bash
docker ps --format '{{.Names}}\t{{.Ports}}' | grep -i postgres
```

Run: `LEGENDS_DB_PORT=<porta> pnpm --filter @legends/api exec vitest run src/lib/tenant-scope.store.test.ts`
Expected: FAIL — `Property 'storeProduct' does not exist` (o model ainda não existe).

- [ ] **Step 3: Adicione os models e estenda os enums**

Em `apps/api/prisma/schema.prisma`, ao lado dos outros enums:

```prisma
/// Ciclo de vida do pedido de resgate. As transições válidas vivem em
/// STORE_ORDER_TRANSITIONS (@legends/shared) — o banco só guarda o estado.
enum StoreOrderStatus {
  PENDING
  APPROVED
  DELIVERED
  CANCELLED
}
```

No enum já existente `CoinTransactionKind`, acrescente ao final (**sem reordenar** os valores atuais):

```prisma
enum CoinTransactionKind {
  EARN
  MANUAL_CREDIT
  MANUAL_DEBIT
  /// Resgate na loja: amount negativo.
  SPEND
  /// Estorno de resgate cancelado: amount positivo.
  REFUND
}
```

No enum já existente `NotificationType`, acrescente ao final:

```prisma
  STORE_ORDER_APPROVED
  STORE_ORDER_DELIVERED
  STORE_ORDER_CANCELLED
```

E os dois models, junto dos demais:

```prisma
/// Item do catálogo da loja. Do escopo da EMPRESA, não do setor: quem administra
/// é o bloco de Gente e Gestão (requireSectorFeature('gente-gestao')), e por isso
/// não há sectorId aqui.
model StoreProduct {
  id           String   @id @default(cuid())
  title        String
  description  String?
  /// Uma de STORE_PRODUCT_CATEGORIES (@legends/shared). String e não enum do Prisma,
  /// mesmo racional de Challenge.category: categoria é catálogo de produto, não
  /// invariante do banco — incluir uma não deve custar migration.
  category     String
  priceInCoins Int
  stock        Int      @default(0)
  /// Chave do S3 da capa. Guarda-se a CHAVE, nunca a URL.
  imageKey     String?
  isDigital    Boolean  @default(false)
  isActive     Boolean  @default(true)
  companyId    String   @default("company-emr")
  createdById  String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  company   Company      @relation(fields: [companyId], references: [id])
  createdBy User         @relation("StoreProductsCreated", fields: [createdById], references: [id])
  orders    StoreOrder[]

  @@index([companyId, isActive, category])
  @@index([companyId])
}

/// Pedido de resgate. `productTitle` e `pricePaid` são CONGELADOS no resgate: o
/// produto muda de nome e de preço depois, e o pedido é histórico.
model StoreOrder {
  id           String           @id @default(cuid())
  userId       String
  /// SetNull, e por isso opcional: apagar um produto não pode apagar o histórico de
  /// quem já resgatou. Cancelar pedido de produto apagado estorna os coins e pula a
  /// devolução de estoque — não há para onde devolver.
  productId    String?
  productTitle String
  pricePaid    Int
  status       StoreOrderStatus @default(PENDING)
  /// Nota INTERNA da G&G. Nunca sai no DTO do colaborador.
  adminNotes   String?
  handledById  String?
  handledAt    DateTime?
  companyId    String           @default("company-emr")
  createdAt    DateTime         @default(now())
  updatedAt    DateTime         @updatedAt

  user      User          @relation("StoreOrders", fields: [userId], references: [id], onDelete: Cascade)
  product   StoreProduct? @relation(fields: [productId], references: [id], onDelete: SetNull)
  handledBy User?         @relation("StoreOrdersHandled", fields: [handledById], references: [id], onDelete: SetNull)
  company   Company       @relation(fields: [companyId], references: [id])

  @@index([companyId, status, createdAt])
  @@index([companyId, userId, createdAt])
  @@index([productId])
}
```

No model `User`, acrescente os lados inversos das três relações nomeadas:

```prisma
  storeProductsCreated StoreProduct[] @relation("StoreProductsCreated")
  storeOrders          StoreOrder[]   @relation("StoreOrders")
  storeOrdersHandled   StoreOrder[]   @relation("StoreOrdersHandled")
```

No model `Company`, acrescente:

```prisma
  storeProducts StoreProduct[]
  storeOrders   StoreOrder[]
```

- [ ] **Step 4: Registre os models no isolamento por empresa**

Sem isto, `scopedPrisma` não injeta `companyId` e a loja vaza entre empresas. Em `apps/api/src/lib/tenant-scope.ts`, dentro de `TENANT_SCOPED_MODELS`:

```ts
  'StoreProduct',
  'StoreOrder',
```

- [ ] **Step 5: Gere a migration**

```bash
docker ps --format '{{.Names}}\t{{.Ports}}' | grep -i postgres   # confirme a porta deste worktree
LEGENDS_DB_PORT=<porta> pnpm db:migrate --name loja_recompensas
LEGENDS_DB_PORT=<porta> pnpm db:generate
```

- [ ] **Step 6: Rode o teste e confirme que passa**

Run: `LEGENDS_DB_PORT=<porta> pnpm --filter @legends/api exec vitest run src/lib/tenant-scope.store.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations \
        apps/api/src/lib/tenant-scope.ts apps/api/src/lib/tenant-scope.store.test.ts
git commit -m "feat(api): models StoreProduct/StoreOrder e kinds SPEND/REFUND"
```

---

### Task 3: Débito e estorno no livro-razão

**Files:**
- Modify: `apps/api/src/services/coin-service.ts`
- Modify: `apps/api/src/services/coin-service.test.ts`

**Interfaces:**
- Consumes: `scopedPrisma`, `ymdInSaoPaulo`, `dayFromYmd` (já importados no arquivo).
- Produces:
  - `spendCoins(input: StoreLedgerInput): Promise<StoreLedgerOutcome>`
  - `refundCoins(input: StoreLedgerInput): Promise<StoreLedgerOutcome>`
  - `interface StoreLedgerInput { userId: string; companyId: string; amount: number; orderId: string; tx?: Prisma.TransactionClient; now?: Date }`
  - `type StoreLedgerOutcome = { status: 'RECORDED'; transactionId: string } | { status: 'DUPLICATE' }`

A escrita no livro-razão fica com o dono do livro-razão: `store-service` **não** monta `CoinTransaction` na mão.

- [ ] **Step 1: Escreva o teste que falha**

Acrescente ao final de `apps/api/src/services/coin-service.test.ts` (siga os helpers já existentes no arquivo para criar usuário; se ele não tiver um, use o padrão abaixo):

```ts
describe('spendCoins / refundCoins', () => {
  async function makeUser() {
    return prisma.user.create({
      data: { name: 'Pessoa', email: `s-${Math.random()}@x.com`, passwordHash: 'x', role: 'LEGEND' },
    })
  }

  it('gasto grava lançamento negativo com kind SPEND', async () => {
    const user = await makeUser()
    const out = await spendCoins({
      userId: user.id, companyId: DEFAULT_COMPANY_ID, amount: 120, orderId: 'order-1',
    })

    expect(out.status).toBe('RECORDED')
    const row = await prisma.coinTransaction.findFirst({ where: { userId: user.id } })
    expect(row?.kind).toBe('SPEND')
    expect(row?.amount).toBe(-120)
    expect(row?.event).toBeNull()
    expect(row?.dedupeKey).toBe('STORE_ORDER:order-1')
  })

  it('estorno grava lançamento positivo com kind REFUND', async () => {
    const user = await makeUser()
    await refundCoins({ userId: user.id, companyId: DEFAULT_COMPANY_ID, amount: 120, orderId: 'order-2' })

    const row = await prisma.coinTransaction.findFirst({ where: { userId: user.id } })
    expect(row?.kind).toBe('REFUND')
    expect(row?.amount).toBe(120)
    expect(row?.dedupeKey).toBe('STORE_REFUND:order-2')
  })

  // Esta é a rede que garante "cancelar duas vezes não credita duas": vem do
  // banco (unique userId+dedupeKey), não da lógica de quem chama.
  it('estorno repetido do mesmo pedido devolve DUPLICATE e não credita de novo', async () => {
    const user = await makeUser()
    await refundCoins({ userId: user.id, companyId: DEFAULT_COMPANY_ID, amount: 50, orderId: 'order-3' })
    const segunda = await refundCoins({
      userId: user.id, companyId: DEFAULT_COMPANY_ID, amount: 50, orderId: 'order-3',
    })

    expect(segunda.status).toBe('DUPLICATE')
    expect(await getCoinBalance(user.id, DEFAULT_COMPANY_ID)).toBe(50)
  })
})
```

Ajuste os imports do topo do arquivo para incluir `spendCoins`, `refundCoins`, `getCoinBalance` e `DEFAULT_COMPANY_ID`.

- [ ] **Step 2: Rode o teste e confirme que falha**

Run: `LEGENDS_DB_PORT=<porta> pnpm --filter @legends/api exec vitest run src/services/coin-service.test.ts`
Expected: FAIL — `spendCoins is not a function` / erro de import.

- [ ] **Step 3: Implemente**

Ao final de `apps/api/src/services/coin-service.ts`:

```ts
export interface StoreLedgerInput {
  userId: string
  companyId: string
  /** Valor absoluto em coins; o sinal é decidido aqui, não pelo chamador. */
  amount: number
  /** Id do pedido — compõe o dedupeKey e é a chave da idempotência. */
  orderId: string
  /** Transação em curso; quando presente, o lançamento entra nela. */
  tx?: Prisma.TransactionClient
  now?: Date
}

export type StoreLedgerOutcome =
  | { status: 'RECORDED'; transactionId: string }
  | { status: 'DUPLICATE' }

/**
 * Lançamento da loja no livro-razão. `event` fica null de propósito: gasto não é
 * um evento instrumentado do catálogo `CoinEvent`, e o relatório de eventos não
 * deve contá-lo.
 *
 * A idempotência é do BANCO, não daqui: a unique (userId, dedupeKey) é o que
 * impede o segundo estorno do mesmo pedido de creditar de novo, mesmo que a
 * checagem de status a montante falhe.
 */
async function recordStoreEntry(
  input: StoreLedgerInput,
  kind: Extract<CoinTransactionKind, 'SPEND' | 'REFUND'>,
): Promise<StoreLedgerOutcome> {
  const prefix = kind === 'SPEND' ? 'STORE_ORDER' : 'STORE_REFUND'
  const ymd = ymdInSaoPaulo(input.now ?? new Date())
  // O tx cru não passa por scopedPrisma — companyId vai explícito no data,
  // mesmo padrão de awardFixedCoins e recordAuditLog.
  const client = input.tx ?? scopedPrisma(input.companyId)

  try {
    const created = await client.coinTransaction.create({
      data: {
        userId: input.userId,
        kind,
        event: null,
        ruleId: null,
        amount: kind === 'SPEND' ? -input.amount : input.amount,
        dedupeKey: `${prefix}:${input.orderId}`,
        day: dayFromYmd(ymd),
        companyId: input.companyId,
      },
    })
    return { status: 'RECORDED', transactionId: created.id }
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { status: 'DUPLICATE' }
    }
    throw err
  }
}

/** Débito do resgate. dedupeKey `STORE_ORDER:<orderId>`. */
export function spendCoins(input: StoreLedgerInput): Promise<StoreLedgerOutcome> {
  return recordStoreEntry(input, 'SPEND')
}

/** Crédito do cancelamento. dedupeKey `STORE_REFUND:<orderId>`. */
export function refundCoins(input: StoreLedgerInput): Promise<StoreLedgerOutcome> {
  return recordStoreEntry(input, 'REFUND')
}
```

- [ ] **Step 4: Rode o teste e confirme que passa**

Run: `LEGENDS_DB_PORT=<porta> pnpm --filter @legends/api exec vitest run src/services/coin-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/coin-service.ts apps/api/src/services/coin-service.test.ts
git commit -m "feat(api): spendCoins e refundCoins no livro-razão"
```

---

### Task 4: Vitrine e resgate

**Files:**
- Create: `apps/api/src/services/store-service.ts`
- Create: `apps/api/src/services/store-service.test.ts`

**Interfaces:**
- Consumes: `spendCoins` (Task 3), `prisma`, `scopedPrisma`.
- Produces:
  - `class StoreError extends Error { status: number }` e as subclasses `ProductNotFoundError` (404), `ProductUnavailableError` (409), `OutOfStockError` (409), `InsufficientBalanceError` (400), `OrderNotFoundError` (404), `InvalidStatusTransitionError` (409)
  - `listAvailableProducts(companyId: string): Promise<StoreProduct[]>`
  - `redeemProduct(actor: StoreCustomer, productId: string): Promise<{ order: StoreOrderWithProduct; balance: number }>`
  - `listMyOrders(actor: StoreCustomer, page: number): Promise<{ orders: StoreOrderWithProduct[]; total: number }>`
  - `interface StoreCustomer { id: string; companyId: string }`
  - `const storeOrderInclude` e `type StoreOrderWithProduct` (payload com `product: { select: { imageKey: true } }`)

- [ ] **Step 1: Escreva o teste que falha**

`apps/api/src/services/store-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import {
  listAvailableProducts,
  redeemProduct,
  listMyOrders,
  InsufficientBalanceError,
  OutOfStockError,
  ProductUnavailableError,
} from './store-service'

async function makeUser() {
  return prisma.user.create({
    data: { name: 'Pessoa', email: `p-${Math.random()}@x.com`, passwordHash: 'x', role: 'LEGEND' },
  })
}

/** Credita saldo pelo caminho normal do livro-razão (ajuste manual do admin). */
async function credit(userId: string, amount: number) {
  await prisma.coinTransaction.create({
    data: {
      userId, kind: 'MANUAL_CREDIT', amount, reason: 'saldo de teste',
      dedupeKey: `MANUAL:${Math.random()}`, day: new Date('2026-08-02'),
      companyId: DEFAULT_COMPANY_ID,
    },
  })
}

function balanceOf(userId: string) {
  return prisma.coinTransaction
    .aggregate({ where: { userId }, _sum: { amount: true } })
    .then((r) => r._sum.amount ?? 0)
}

async function makeProduct(overrides: Partial<{ priceInCoins: number; stock: number; isActive: boolean; title: string }> = {}) {
  const admin = await makeUser()
  return prisma.storeProduct.create({
    data: {
      title: overrides.title ?? 'Fone',
      category: 'Equipamento',
      priceInCoins: overrides.priceInCoins ?? 100,
      stock: overrides.stock ?? 5,
      isActive: overrides.isActive ?? true,
      createdById: admin.id,
      companyId: DEFAULT_COMPANY_ID,
    },
  })
}

function customer(id: string) {
  return { id, companyId: DEFAULT_COMPANY_ID }
}

describe('vitrine', () => {
  it('esconde produto inativo e produto sem estoque', async () => {
    await makeProduct({ title: 'Ativo com estoque' })
    await makeProduct({ title: 'Inativo', isActive: false })
    await makeProduct({ title: 'Zerado', stock: 0 })

    const products = await listAvailableProducts(DEFAULT_COMPANY_ID)

    expect(products.map((p) => p.title)).toEqual(['Ativo com estoque'])
  })
})

describe('resgate', () => {
  it('debita o preço exato, tira 1 do estoque e congela título e preço', async () => {
    const user = await makeUser()
    await credit(user.id, 300)
    const product = await makeProduct({ priceInCoins: 120, stock: 5 })

    const { order, balance } = await redeemProduct(customer(user.id), product.id)

    expect(balance).toBe(180)
    expect(order.status).toBe('PENDING')
    expect(order.productTitle).toBe('Fone')
    expect(order.pricePaid).toBe(120)
    const after = await prisma.storeProduct.findUniqueOrThrow({ where: { id: product.id } })
    expect(after.stock).toBe(4)
  })

  it('recusa por saldo insuficiente e não grava NADA', async () => {
    const user = await makeUser()
    await credit(user.id, 50)
    const product = await makeProduct({ priceInCoins: 120, stock: 5 })

    await expect(redeemProduct(customer(user.id), product.id)).rejects.toBeInstanceOf(
      InsufficientBalanceError,
    )

    expect(await prisma.storeOrder.count()).toBe(0)
    expect(await balanceOf(user.id)).toBe(50)
    const after = await prisma.storeProduct.findUniqueOrThrow({ where: { id: product.id } })
    expect(after.stock).toBe(5)
  })

  // Não basta esconder da vitrine: a chamada direta ao service tem de recusar.
  it('recusa produto inativo mesmo com saldo sobrando', async () => {
    const user = await makeUser()
    await credit(user.id, 500)
    const product = await makeProduct({ isActive: false })

    await expect(redeemProduct(customer(user.id), product.id)).rejects.toBeInstanceOf(
      ProductUnavailableError,
    )
  })

  it('recusa produto com estoque zero mesmo com saldo sobrando', async () => {
    const user = await makeUser()
    await credit(user.id, 500)
    const product = await makeProduct({ stock: 0 })

    await expect(redeemProduct(customer(user.id), product.id)).rejects.toBeInstanceOf(
      OutOfStockError,
    )
  })

  // Duas PESSOAS diferentes disputando o último item: quem protege é o UPDATE
  // condicional (stock > 0), que trava a linha e reavalia o predicado.
  it('dois resgates simultâneos do último item: um conclui, o outro é recusado', async () => {
    const a = await makeUser()
    const b = await makeUser()
    await credit(a.id, 500)
    await credit(b.id, 500)
    const product = await makeProduct({ priceInCoins: 100, stock: 1 })

    const results = await Promise.allSettled([
      redeemProduct(customer(a.id), product.id),
      redeemProduct(customer(b.id), product.id),
    ])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
    const after = await prisma.storeProduct.findUniqueOrThrow({ where: { id: product.id } })
    expect(after.stock).toBe(0)
    expect(await prisma.storeOrder.count()).toBe(1)
  })

  // A MESMA pessoa clicando duas vezes: quem protege é o advisory lock. Sem ele,
  // os dois aggregates leem 100 e o saldo termina negativo.
  it('dois resgates simultâneos da mesma pessoa não deixam o saldo negativo', async () => {
    const user = await makeUser()
    await credit(user.id, 100)
    const product = await makeProduct({ priceInCoins: 100, stock: 5 })

    const results = await Promise.allSettled([
      redeemProduct(customer(user.id), product.id),
      redeemProduct(customer(user.id), product.id),
    ])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await balanceOf(user.id)).toBe(0)
    expect(await prisma.storeOrder.count()).toBe(1)
  })

  it('preço alterado depois não muda o valor registrado no pedido antigo', async () => {
    const user = await makeUser()
    await credit(user.id, 500)
    const product = await makeProduct({ priceInCoins: 100, stock: 5 })
    await redeemProduct(customer(user.id), product.id)

    await prisma.storeProduct.update({
      where: { id: product.id },
      data: { priceInCoins: 999, title: 'Fone Premium' },
    })

    const { orders } = await listMyOrders(customer(user.id), 1)
    expect(orders[0].pricePaid).toBe(100)
    expect(orders[0].productTitle).toBe('Fone')
  })
})
```

- [ ] **Step 2: Rode o teste e confirme que falha**

Run: `LEGENDS_DB_PORT=<porta> pnpm --filter @legends/api exec vitest run src/services/store-service.test.ts`
Expected: FAIL — `Failed to resolve import "./store-service"`.

- [ ] **Step 3: Implemente**

`apps/api/src/services/store-service.ts`:

```ts
import { Prisma } from '@prisma/client'
import { STORE_ORDER_PAGE_SIZE } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'
import { spendCoins } from './coin-service'

/** Erro de domínio da loja: carrega o status HTTP, e a rota só faz instanceof. */
export class StoreError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = new.target.name
  }
}

export class ProductNotFoundError extends StoreError {
  constructor() {
    super('Produto não encontrado.', 404)
  }
}
export class ProductUnavailableError extends StoreError {
  constructor() {
    super('Este produto não está disponível para resgate.', 409)
  }
}
export class OutOfStockError extends StoreError {
  constructor() {
    super('Este produto está sem estoque.', 409)
  }
}
export class InsufficientBalanceError extends StoreError {
  constructor() {
    super('Saldo insuficiente para resgatar este produto.', 400)
  }
}
export class OrderNotFoundError extends StoreError {
  constructor() {
    super('Pedido não encontrado.', 404)
  }
}
export class InvalidStatusTransitionError extends StoreError {
  constructor() {
    super('Não é possível mudar o pedido para este status.', 409)
  }
}

/** Só a capa: o DTO expõe URL derivada, nunca a chave crua. */
export const storeOrderInclude = { product: { select: { imageKey: true } } } as const
export type StoreOrderWithProduct = Prisma.StoreOrderGetPayload<{ include: typeof storeOrderInclude }>

export interface StoreCustomer {
  id: string
  companyId: string
}

/** Vitrine: só o que dá para resgatar agora. */
export function listAvailableProducts(companyId: string) {
  return scopedPrisma(companyId).storeProduct.findMany({
    where: { isActive: true, stock: { gt: 0 } },
    orderBy: [{ category: 'asc' }, { title: 'asc' }],
  })
}

/**
 * Resgate: valida saldo e estoque, debita o livro-razão, baixa o estoque e cria o
 * pedido — tudo numa transação.
 *
 * A ORDEM das operações É a regra:
 *
 * 1. O advisory lock serializa os resgates DESTA pessoa. Sem ele, dois cliques
 *    rápidos leem o mesmo saldo no passo 3 e o saldo termina negativo — `aggregate`
 *    não trava nada, e Read Committed não resolve isso sozinho.
 * 2. Preço e disponibilidade são lidos DENTRO da transação; o produto pode ter
 *    mudado entre a vitrine e o clique.
 * 4. O UPDATE CONDICIONAL é o que trava a linha do produto e reavalia `stock > 0`
 *    contra a versão já commitada — é ele, e não um SELECT anterior, que impede
 *    duas pessoas de levarem o mesmo último item. Mesmo padrão de
 *    challenge-submission-service.
 *
 * O `tx` cru não passa por `scopedPrisma`: `companyId` vai explícito em todo
 * `where` e `data`.
 */
export async function redeemProduct(
  actor: StoreCustomer,
  productId: string,
): Promise<{ order: StoreOrderWithProduct; balance: number }> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`store:${actor.id}`}))`

    const product = await tx.storeProduct.findFirst({
      where: { id: productId, companyId: actor.companyId },
    })
    if (!product) throw new ProductNotFoundError()
    if (!product.isActive) throw new ProductUnavailableError()

    const { _sum } = await tx.coinTransaction.aggregate({
      where: { userId: actor.id, companyId: actor.companyId },
      _sum: { amount: true },
    })
    const balance = _sum.amount ?? 0
    if (balance < product.priceInCoins) throw new InsufficientBalanceError()

    const { count } = await tx.storeProduct.updateMany({
      where: { id: productId, companyId: actor.companyId, isActive: true, stock: { gt: 0 } },
      data: { stock: { decrement: 1 } },
    })
    if (count === 0) throw new OutOfStockError()

    const order = await tx.storeOrder.create({
      data: {
        userId: actor.id,
        productId: product.id,
        // Congelados: o produto muda depois, o pedido é histórico.
        productTitle: product.title,
        pricePaid: product.priceInCoins,
        companyId: actor.companyId,
      },
      include: storeOrderInclude,
    })

    await spendCoins({
      userId: actor.id,
      companyId: actor.companyId,
      amount: product.priceInCoins,
      orderId: order.id,
      tx,
    })

    return { order, balance: balance - product.priceInCoins }
  })
}

export async function listMyOrders(
  actor: StoreCustomer,
  page: number,
): Promise<{ orders: StoreOrderWithProduct[]; total: number }> {
  const db = scopedPrisma(actor.companyId)
  const where = { userId: actor.id }
  const [orders, total] = await Promise.all([
    db.storeOrder.findMany({
      where,
      include: storeOrderInclude,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * STORE_ORDER_PAGE_SIZE,
      take: STORE_ORDER_PAGE_SIZE,
    }),
    db.storeOrder.count({ where }),
  ])
  return { orders, total }
}
```

- [ ] **Step 4: Rode o teste e confirme que passa**

Run: `LEGENDS_DB_PORT=<porta> pnpm --filter @legends/api exec vitest run src/services/store-service.test.ts`
Expected: PASS, inclusive os dois testes de concorrência.

Se o teste de concorrência travar em vez de falhar, o pool do Prisma está com uma conexão só — confirme que `DATABASE_URL` do teste não tem `connection_limit=1`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/store-service.ts apps/api/src/services/store-service.test.ts
git commit -m "feat(api): vitrine e resgate com débito e baixa de estoque na mesma transação"
```

---

### Task 5: Serialização e rotas do colaborador

**Files:**
- Modify: `apps/api/src/lib/serialize.ts`
- Create: `apps/api/src/routes/store.ts`
- Create: `apps/api/src/routes/store.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: `listAvailableProducts`, `redeemProduct`, `listMyOrders`, `StoreError`, `storeOrderInclude`, `StoreOrderWithProduct` (Task 4); `getCoinBalance` (coin-service).
- Produces:
  - `toStoreProductDTO(product: StoreProduct): StoreProductDTO`
  - `toStoreOrderDTO(order: StoreOrderWithProduct): StoreOrderDTO`
  - Rotas `GET /store/products`, `POST /store/orders`, `GET /store/orders`.

- [ ] **Step 1: Escreva o teste que falha**

`apps/api/src/routes/store.test.ts` (siga o helper de login/token usado em `apps/api/src/routes/challenges.test.ts` — copie dali o `buildApp` + criação de usuário + `app.jwt.sign`, que é o padrão do repo):

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

let app: Awaited<ReturnType<typeof buildApp>>

beforeEach(async () => {
  app = await buildApp()
  await app.ready()
})

async function makeUser(role: 'LEGEND' | 'ADMIN' = 'LEGEND') {
  return prisma.user.create({
    data: { name: 'Pessoa', email: `r-${Math.random()}@x.com`, passwordHash: 'x', role },
  })
}

function tokenFor(user: { id: string; role: string }) {
  return app.jwt.sign({ sub: user.id, role: user.role, companyId: DEFAULT_COMPANY_ID, features: ['coins'] })
}

async function makeProduct(priceInCoins = 100, stock = 5) {
  const admin = await makeUser('ADMIN')
  return prisma.storeProduct.create({
    data: { title: 'Fone', category: 'Equipamento', priceInCoins, stock, createdById: admin.id, companyId: DEFAULT_COMPANY_ID },
  })
}

describe('GET /store/products', () => {
  it('exige autenticação', async () => {
    const res = await app.inject({ method: 'GET', url: '/store/products' })
    expect(res.statusCode).toBe(401)
  })

  it('devolve o catálogo disponível', async () => {
    const user = await makeUser()
    await makeProduct()
    const res = await app.inject({
      method: 'GET', url: '/store/products',
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().products).toHaveLength(1)
    // A chave do S3 NUNCA sai: só a URL derivada.
    expect(res.json().products[0]).not.toHaveProperty('imageKey')
  })
})

describe('POST /store/orders', () => {
  it('recusa corpo inválido com 400 e issues', async () => {
    const user = await makeUser()
    const res = await app.inject({
      method: 'POST', url: '/store/orders',
      headers: { authorization: `Bearer ${tokenFor(user)}` },
      payload: {},
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toHaveProperty('issues')
  })

  it('devolve 400 e mensagem em português quando falta saldo', async () => {
    const user = await makeUser()
    const product = await makeProduct(100)
    const res = await app.inject({
      method: 'POST', url: '/store/orders',
      headers: { authorization: `Bearer ${tokenFor(user)}` },
      payload: { productId: product.id },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().message).toBe('Saldo insuficiente para resgatar este produto.')
  })

  it('resgata e devolve o saldo já atualizado', async () => {
    const user = await makeUser()
    await prisma.coinTransaction.create({
      data: { userId: user.id, kind: 'MANUAL_CREDIT', amount: 300, dedupeKey: `MANUAL:${Math.random()}`,
              day: new Date('2026-08-02'), companyId: DEFAULT_COMPANY_ID },
    })
    const product = await makeProduct(100)

    const res = await app.inject({
      method: 'POST', url: '/store/orders',
      headers: { authorization: `Bearer ${tokenFor(user)}` },
      payload: { productId: product.id },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().balance).toBe(200)
    expect(res.json().order.pricePaid).toBe(100)
    expect(res.json().order).not.toHaveProperty('adminNotes')
  })
})
```

- [ ] **Step 2: Rode o teste e confirme que falha**

Run: `LEGENDS_DB_PORT=<porta> pnpm --filter @legends/api exec vitest run src/routes/store.test.ts`
Expected: FAIL — 404 nas rotas.

- [ ] **Step 3: Escreva os serializers**

Em `apps/api/src/lib/serialize.ts`, junto de `toChallengeDTO` (reaproveite os imports de `s3Config`/`publicUrlFor` já existentes no arquivo):

```ts
export function toStoreProductDTO(product: StoreProduct): StoreProductDTO {
  const cfg = s3Config()
  return {
    id: product.id,
    title: product.title,
    description: product.description,
    category: product.category as StoreProductCategory,
    priceInCoins: product.priceInCoins,
    stock: product.stock,
    // A chave nunca sai daqui: o DTO expõe só a URL derivada.
    imageUrl: product.imageKey && cfg ? publicUrlFor(product.imageKey, cfg) : null,
    isDigital: product.isDigital,
    isActive: product.isActive,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  }
}

/** DTO do COLABORADOR. Sem `adminNotes` de propósito: a nota da G&G é interna. */
export function toStoreOrderDTO(order: StoreOrderWithProduct): StoreOrderDTO {
  const cfg = s3Config()
  const imageKey = order.product?.imageKey ?? null
  return {
    id: order.id,
    status: order.status,
    productId: order.productId,
    productTitle: order.productTitle,
    pricePaid: order.pricePaid,
    imageUrl: imageKey && cfg ? publicUrlFor(imageKey, cfg) : null,
    handledAt: order.handledAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
  }
}
```

- [ ] **Step 4: Escreva as rotas**

`apps/api/src/routes/store.ts`:

```ts
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import { STORE_ORDER_PAGE_SIZE } from '@legends/shared'
import { toStoreOrderDTO, toStoreProductDTO } from '../lib/serialize'
import { getCoinBalance } from '../services/coin-service'
import {
  listAvailableProducts,
  listMyOrders,
  redeemProduct,
  StoreError,
} from '../services/store-service'

const createOrderSchema = z.object({ productId: z.string().min(1) })
const listOrdersQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1) })

function handleStoreError(err: unknown, reply: FastifyReply) {
  if (err instanceof StoreError) return reply.code(err.status).send({ message: err.message })
  throw err
}

export async function storeRoutes(app: FastifyInstance) {
  const withCoins = { onRequest: [app.authenticate, app.requireFeature('coins')] }

  app.get('/store/products', withCoins, async (request) => {
    const products = await listAvailableProducts(request.user.companyId)
    return { products: products.map(toStoreProductDTO) }
  })

  app.post('/store/orders', withCoins, async (request, reply) => {
    const parsed = createOrderSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    const actor = { id: request.user.sub, companyId: request.user.companyId }
    try {
      const { order, balance } = await redeemProduct(actor, parsed.data.productId)
      return reply.code(201).send({ order: toStoreOrderDTO(order), balance })
    } catch (err) {
      return handleStoreError(err, reply)
    }
  })

  app.get('/store/orders', withCoins, async (request, reply) => {
    const parsed = listOrdersQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    const actor = { id: request.user.sub, companyId: request.user.companyId }
    const { orders, total } = await listMyOrders(actor, parsed.data.page)
    return {
      orders: orders.map(toStoreOrderDTO),
      total,
      page: parsed.data.page,
      pageSize: STORE_ORDER_PAGE_SIZE,
    }
  })
}
```

Em `apps/api/src/app.ts`, junto dos outros registros:

```ts
import { storeRoutes } from './routes/store'
// …
  app.register(storeRoutes)
```

- [ ] **Step 5: Rode o teste e confirme que passa**

Run: `LEGENDS_DB_PORT=<porta> pnpm --filter @legends/api exec vitest run src/routes/store.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/serialize.ts apps/api/src/routes/store.ts \
        apps/api/src/routes/store.test.ts apps/api/src/app.ts
git commit -m "feat(api): rotas da vitrine e do resgate"
```

---

### Task 6: `lib/csv.ts` compartilhado

**Files:**
- Create: `apps/api/src/lib/csv.ts`
- Create: `apps/api/src/lib/csv.test.ts`
- Modify: `apps/api/src/services/challenge-submission-service.ts:246-256` (remove as cópias privadas de `csvCell` e `csvDate` e importa de `lib/csv`)

**Interfaces:**
- Consumes: nada.
- Produces: `csvCell(value: string | null): string`, `csvDate(date: Date | null): string`.

Extrair em vez de copiar: a guarda contra injeção de fórmula é fácil de esquecer numa cópia, e a coluna 1 do CSV é o nome que a própria pessoa escolheu no cadastro.

- [ ] **Step 1: Escreva o teste que falha**

`apps/api/src/lib/csv.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { csvCell, csvDate } from './csv'

describe('csvCell', () => {
  it('deixa texto simples intacto', () => {
    expect(csvCell('Fone de ouvido')).toBe('Fone de ouvido')
  })

  it('trata null como vazio', () => {
    expect(csvCell(null)).toBe('')
  })

  it('escapa separador, aspas e quebra de linha', () => {
    expect(csvCell('a;b')).toBe('"a;b"')
    expect(csvCell('diz "oi"')).toBe('"diz ""oi"""')
    expect(csvCell('linha1\nlinha2')).toBe('"linha1\nlinha2"')
  })

  // Excel/Sheets interpretam isto como fórmula ao abrir o CSV.
  it('neutraliza início de fórmula', () => {
    expect(csvCell('=1+1')).toBe("'=1+1")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvCell('-2+3')).toBe("'-2+3")
  })
})

describe('csvDate', () => {
  it('devolve vazio para null', () => {
    expect(csvDate(null)).toBe('')
  })

  it('formata em pt-BR no fuso de São Paulo', () => {
    expect(csvDate(new Date('2026-08-02T15:00:00Z'))).toContain('02/08/2026')
  })
})
```

- [ ] **Step 2: Rode o teste e confirme que falha**

Run: `LEGENDS_DB_PORT=<porta> pnpm --filter @legends/api exec vitest run src/lib/csv.test.ts`
Expected: FAIL — `Failed to resolve import "./csv"`.

- [ ] **Step 3: Crie o módulo**

`apps/api/src/lib/csv.ts`:

```ts
/**
 * Células de CSV para exportação de fila (desafios, loja, …).
 *
 * Separador `;` e BOM UTF-8 no arquivo final porque o Excel em pt-BR abre assim
 * sem pedir importação — quem monta o arquivo cuida disso; aqui só a célula.
 */

/**
 * Aspas duplicadas e campo entre aspas quando contém `;`, aspas ou quebra de
 * linha. ANTES disso, neutraliza injeção de fórmula: um valor começando com
 * `=`, `+`, `-`, `@` (ou tab/CR) é interpretado como fórmula pelo Excel/Sheets
 * ao abrir o CSV — e a primeira coluna costuma ser `user.name`, que a própria
 * pessoa escolhe no cadastro, sem restrição de charset. Prefixar `'` faz esses
 * programas tratarem a célula como texto puro.
 */
export function csvCell(value: string | null): string {
  let text = value ?? ''
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  if (!/[;"\n\r]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}

export function csvDate(date: Date | null): string {
  if (!date) return ''
  return date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })
}
```

- [ ] **Step 4: Aponte o serviço de desafios para o módulo**

Em `apps/api/src/services/challenge-submission-service.ts`, **apague** as funções privadas `csvCell` e `csvDate` (junto do bloco de comentário delas, que foi movido para `lib/csv.ts`) e acrescente ao topo:

```ts
import { csvCell, csvDate } from '../lib/csv'
```

- [ ] **Step 5: Rode os dois testes e confirme que passam**

Run: `LEGENDS_DB_PORT=<porta> pnpm --filter @legends/api exec vitest run src/lib/csv.test.ts src/services/challenge-submission-service.test.ts`
Expected: PASS nos dois — o CSV de desafios não pode mudar de comportamento.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/csv.ts apps/api/src/lib/csv.test.ts \
        apps/api/src/services/challenge-submission-service.ts
git commit -m "refactor(api): extrai csvCell/csvDate para lib/csv"
```

---

### Task 7: CRUD de produto

**Files:**
- Create: `apps/api/src/services/store-admin-service.ts`
- Create: `apps/api/src/services/store-admin-service.test.ts`

**Interfaces:**
- Consumes: `StoreError` e subclasses (Task 4), `recordAuditLog`, `scopedPrisma`, `prisma`.
- Produces:
  - `interface StoreAdminActor { id: string; companyId: string }`
  - `listProductsForAdmin(actor): Promise<StoreProduct[]>`
  - `createProduct(actor, input: CreateStoreProductRequest): Promise<StoreProduct>`
  - `updateProduct(actor, id: string, input: UpdateStoreProductRequest): Promise<StoreProduct>`
  - `deleteProduct(actor, id: string): Promise<void>`

- [ ] **Step 1: Escreva o teste que falha**

`apps/api/src/services/store-admin-service.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import {
  createProduct,
  updateProduct,
  deleteProduct,
  listProductsForAdmin,
} from './store-admin-service'
import { ProductNotFoundError } from './store-service'

async function makeAdmin() {
  return prisma.user.create({
    data: { name: 'Gestora', email: `g-${Math.random()}@x.com`, passwordHash: 'x', role: 'ADMIN' },
  })
}

function actorOf(id: string) {
  return { id, companyId: DEFAULT_COMPANY_ID }
}

const BASE = {
  title: 'Fone', description: 'Bom fone', category: 'Equipamento' as const,
  priceInCoins: 100, stock: 5,
}

describe('CRUD de produto', () => {
  it('cria produto ativo e grava auditoria', async () => {
    const admin = await makeAdmin()
    const product = await createProduct(actorOf(admin.id), BASE)

    expect(product.isActive).toBe(true)
    expect(product.createdById).toBe(admin.id)
    const audit = await prisma.adminAuditLog.findFirst({
      where: { entityType: 'StoreProduct', entityId: product.id },
    })
    expect(audit?.action).toBe('CREATE')
  })

  it('atualiza só os campos enviados', async () => {
    const admin = await makeAdmin()
    const product = await createProduct(actorOf(admin.id), BASE)

    const updated = await updateProduct(actorOf(admin.id), product.id, { priceInCoins: 150 })

    expect(updated.priceInCoins).toBe(150)
    expect(updated.title).toBe('Fone')
    expect(updated.stock).toBe(5)
  })

  it('apaga o produto e mantém o pedido antigo com productId nulo', async () => {
    const admin = await makeAdmin()
    const product = await createProduct(actorOf(admin.id), BASE)
    const order = await prisma.storeOrder.create({
      data: { userId: admin.id, productId: product.id, productTitle: 'Fone', pricePaid: 100,
              companyId: DEFAULT_COMPANY_ID },
    })

    await deleteProduct(actorOf(admin.id), product.id)

    const kept = await prisma.storeOrder.findUniqueOrThrow({ where: { id: order.id } })
    expect(kept.productId).toBeNull()
    expect(kept.productTitle).toBe('Fone')
    expect(kept.pricePaid).toBe(100)
  })

  it('recusa produto de outra empresa', async () => {
    const admin = await makeAdmin()
    await prisma.company.upsert({
      where: { id: 'company-outra' }, update: {},
      create: { id: 'company-outra', name: 'Outra', slug: 'outra' },
    })
    const alheio = await prisma.storeProduct.create({
      data: { ...BASE, createdById: admin.id, companyId: 'company-outra' },
    })

    await expect(
      updateProduct(actorOf(admin.id), alheio.id, { priceInCoins: 1 }),
    ).rejects.toBeInstanceOf(ProductNotFoundError)
  })

  it('lista inclusive produto inativo e sem estoque (a fila precisa ver tudo)', async () => {
    const admin = await makeAdmin()
    await createProduct(actorOf(admin.id), { ...BASE, isActive: false })
    await createProduct(actorOf(admin.id), { ...BASE, title: 'Zerado', stock: 0 })

    expect(await listProductsForAdmin(actorOf(admin.id))).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Rode o teste e confirme que falha**

Run: `LEGENDS_DB_PORT=<porta> pnpm --filter @legends/api exec vitest run src/services/store-admin-service.test.ts`
Expected: FAIL — `Failed to resolve import "./store-admin-service"`.

- [ ] **Step 3: Implemente**

`apps/api/src/services/store-admin-service.ts`:

```ts
import type { CreateStoreProductRequest, UpdateStoreProductRequest } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'
import { recordAuditLog } from './audit-log-service'
import { ProductNotFoundError } from './store-service'

export interface StoreAdminActor {
  id: string
  companyId: string
}

/**
 * A loja é da EMPRESA, não do setor: quem chega aqui já passou por
 * `requireSectorFeature('gente-gestao')` na rota, que libera o ADMIN global e o
 * SUBADMIN do setor com a feature ligada. Por isso não há recorte por sectorId.
 */
export function listProductsForAdmin(actor: StoreAdminActor) {
  return scopedPrisma(actor.companyId).storeProduct.findMany({
    orderBy: [{ isActive: 'desc' }, { category: 'asc' }, { title: 'asc' }],
  })
}

export async function createProduct(actor: StoreAdminActor, input: CreateStoreProductRequest) {
  return prisma.$transaction(async (tx) => {
    const product = await tx.storeProduct.create({
      data: {
        title: input.title,
        description: input.description ?? null,
        category: input.category,
        priceInCoins: input.priceInCoins,
        stock: input.stock,
        imageKey: input.imageKey ?? null,
        isDigital: input.isDigital ?? false,
        isActive: input.isActive ?? true,
        createdById: actor.id,
        companyId: actor.companyId,
      },
    })
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'StoreProduct',
      entityId: product.id,
      action: 'CREATE',
      companyId: actor.companyId,
      after: { title: product.title, priceInCoins: product.priceInCoins, stock: product.stock },
      tx,
    })
    return product
  })
}

/** Campo ausente no input é campo preservado — `undefined` nunca vira `null` aqui. */
export async function updateProduct(
  actor: StoreAdminActor,
  id: string,
  input: UpdateStoreProductRequest,
) {
  const current = await scopedPrisma(actor.companyId).storeProduct.findFirst({ where: { id } })
  if (!current) throw new ProductNotFoundError()

  return prisma.$transaction(async (tx) => {
    const product = await tx.storeProduct.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.priceInCoins !== undefined ? { priceInCoins: input.priceInCoins } : {}),
        ...(input.stock !== undefined ? { stock: input.stock } : {}),
        ...(input.imageKey !== undefined ? { imageKey: input.imageKey } : {}),
        ...(input.isDigital !== undefined ? { isDigital: input.isDigital } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    })
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'StoreProduct',
      entityId: id,
      action: 'UPDATE',
      companyId: actor.companyId,
      before: { title: current.title, priceInCoins: current.priceInCoins, stock: current.stock, isActive: current.isActive },
      after: { title: product.title, priceInCoins: product.priceInCoins, stock: product.stock, isActive: product.isActive },
      tx,
    })
    return product
  })
}

/**
 * Apaga o produto. Os pedidos sobrevivem com `productId` nulo (SetNull) e os
 * campos congelados intactos — histórico de resgate não se apaga junto com o item.
 */
export async function deleteProduct(actor: StoreAdminActor, id: string): Promise<void> {
  const current = await scopedPrisma(actor.companyId).storeProduct.findFirst({ where: { id } })
  if (!current) throw new ProductNotFoundError()

  await prisma.$transaction(async (tx) => {
    await tx.storeProduct.delete({ where: { id } })
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'StoreProduct',
      entityId: id,
      action: 'DELETE',
      companyId: actor.companyId,
      before: { title: current.title, priceInCoins: current.priceInCoins },
      tx,
    })
  })
}
```

- [ ] **Step 4: Rode o teste e confirme que passa**

Run: `LEGENDS_DB_PORT=<porta> pnpm --filter @legends/api exec vitest run src/services/store-admin-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/store-admin-service.ts apps/api/src/services/store-admin-service.test.ts
git commit -m "feat(api): CRUD de produto da loja com auditoria"
```

---

### Task 8: Fila — transições, estorno, lote e CSV

**Files:**
- Modify: `apps/api/src/services/store-admin-service.ts`
- Create: `apps/api/src/services/store-admin-queue.test.ts`

**Interfaces:**
- Consumes: `refundCoins` (Task 3), `csvCell`/`csvDate` (Task 6), `canTransitionStoreOrder`/`STORE_ORDER_STATUS_LABELS`/`STORE_EXPORT_MAX_ROWS`/`STORE_ORDER_PAGE_SIZE` (Task 1), `InvalidStatusTransitionError`/`OrderNotFoundError` (Task 4).
- Produces:
  - `const storeOrderAdminInclude` e `type StoreOrderWithRefs` (payload com `product: { select: { imageKey: true } }`, `user: { select: { id, name, email } }`, `handledBy: { select: { id, name } }`)
  - `interface StoreOrderFilters { status?: StoreOrderStatus; userId?: string; productId?: string }`
  - `listOrdersForAdmin(actor, filters, page): Promise<{ orders: StoreOrderWithRefs[]; total: number }>`
  - `updateOrderStatus(actor, id, next, adminNotes): Promise<StoreOrderWithRefs>`
  - `updateOrdersBatch(actor, ids, next, adminNotes): Promise<StoreOrderBatchResult>`
  - `exportOrdersCsv(actor, filters): Promise<string>`

- [ ] **Step 1: Escreva o teste que falha**

`apps/api/src/services/store-admin-queue.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { createProduct, updateOrderStatus, updateOrdersBatch, exportOrdersCsv, listOrdersForAdmin } from './store-admin-service'
import { redeemProduct, InvalidStatusTransitionError } from './store-service'

async function makeUser(role: 'LEGEND' | 'ADMIN' = 'LEGEND') {
  return prisma.user.create({
    data: { name: 'Pessoa', email: `q-${Math.random()}@x.com`, passwordHash: 'x', role },
  })
}

async function credit(userId: string, amount: number) {
  await prisma.coinTransaction.create({
    data: { userId, kind: 'MANUAL_CREDIT', amount, dedupeKey: `MANUAL:${Math.random()}`,
            day: new Date('2026-08-02'), companyId: DEFAULT_COMPANY_ID },
  })
}

function balanceOf(userId: string) {
  return prisma.coinTransaction
    .aggregate({ where: { userId }, _sum: { amount: true } })
    .then((r) => r._sum.amount ?? 0)
}

/** Pessoa com 500 coins, produto de 100 e um pedido pendente já resgatado. */
async function scenario() {
  const admin = await makeUser('ADMIN')
  const actor = { id: admin.id, companyId: DEFAULT_COMPANY_ID }
  const product = await createProduct(actor, {
    title: 'Fone', category: 'Equipamento', priceInCoins: 100, stock: 5,
  })
  const user = await makeUser()
  await credit(user.id, 500)
  const { order } = await redeemProduct({ id: user.id, companyId: DEFAULT_COMPANY_ID }, product.id)
  return { actor, user, product, order }
}

describe('transições', () => {
  it('aprova um pedido pendente', async () => {
    const { actor, order } = await scenario()
    const updated = await updateOrderStatus(actor, order.id, 'APPROVED', 'Separado no estoque')

    expect(updated.status).toBe('APPROVED')
    expect(updated.handledById).toBe(actor.id)
    expect(updated.handledAt).not.toBeNull()
    expect(updated.adminNotes).toBe('Separado no estoque')
  })

  it('recusa pular de pendente direto para entregue', async () => {
    const { actor, order } = await scenario()
    await expect(
      updateOrderStatus(actor, order.id, 'DELIVERED', null),
    ).rejects.toBeInstanceOf(InvalidStatusTransitionError)
  })

  it('recusa mexer em pedido já entregue', async () => {
    const { actor, order } = await scenario()
    await updateOrderStatus(actor, order.id, 'APPROVED', null)
    await updateOrderStatus(actor, order.id, 'DELIVERED', null)

    await expect(
      updateOrderStatus(actor, order.id, 'APPROVED', null),
    ).rejects.toBeInstanceOf(InvalidStatusTransitionError)
  })
})

describe('cancelamento', () => {
  it('devolve os coins e o estoque', async () => {
    const { actor, user, product, order } = await scenario()
    expect(await balanceOf(user.id)).toBe(400)

    await updateOrderStatus(actor, order.id, 'CANCELLED', 'Sem estoque no fornecedor')

    expect(await balanceOf(user.id)).toBe(500)
    const after = await prisma.storeProduct.findUniqueOrThrow({ where: { id: product.id } })
    expect(after.stock).toBe(5)
  })

  it('cancelar duas vezes não credita duas', async () => {
    const { actor, user, order } = await scenario()
    await updateOrderStatus(actor, order.id, 'CANCELLED', null)

    await expect(
      updateOrderStatus(actor, order.id, 'CANCELLED', null),
    ).rejects.toBeInstanceOf(InvalidStatusTransitionError)

    expect(await balanceOf(user.id)).toBe(500)
    expect(await prisma.coinTransaction.count({ where: { userId: user.id, kind: 'REFUND' } })).toBe(1)
  })

  it('cancela pedido de produto apagado: estorna os coins e não quebra', async () => {
    const { actor, user, product, order } = await scenario()
    await prisma.storeProduct.delete({ where: { id: product.id } })

    await updateOrderStatus(actor, order.id, 'CANCELLED', null)

    expect(await balanceOf(user.id)).toBe(500)
  })
})

describe('lote', () => {
  it('aprova os válidos e relata os que falharam', async () => {
    const { actor, order } = await scenario()
    const outro = await scenario()
    await updateOrderStatus(actor, outro.order.id, 'CANCELLED', null)   // já terminal

    const result = await updateOrdersBatch(actor, [order.id, outro.order.id], 'APPROVED', null)

    expect(result.succeeded).toEqual([order.id])
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0].id).toBe(outro.order.id)
    expect(result.failed[0].message).toBe('Não é possível mudar o pedido para este status.')
  })
})

describe('filtros e CSV', () => {
  it('filtra por status', async () => {
    const { actor, order } = await scenario()
    await scenario()
    await updateOrderStatus(actor, order.id, 'APPROVED', null)

    const { orders, total } = await listOrdersForAdmin(actor, { status: 'APPROVED' }, 1)

    expect(total).toBe(1)
    expect(orders[0].id).toBe(order.id)
  })

  it('exporta CSV com BOM, cabeçalho e o preço congelado', async () => {
    const { actor } = await scenario()
    const csv = await exportOrdersCsv(actor, {})

    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv).toContain('Pessoa;E-mail;Produto;Preço pago;Status')
    expect(csv).toContain(';100;Pendente')
  })
})
```

- [ ] **Step 2: Rode o teste e confirme que falha**

Run: `LEGENDS_DB_PORT=<porta> pnpm --filter @legends/api exec vitest run src/services/store-admin-queue.test.ts`
Expected: FAIL — `updateOrderStatus is not exported`.

- [ ] **Step 3: Implemente**

Acrescente a `apps/api/src/services/store-admin-service.ts` (e complete os imports do topo):

```ts
import {
  canTransitionStoreOrder,
  STORE_EXPORT_MAX_ROWS,
  STORE_ORDER_PAGE_SIZE,
  STORE_ORDER_STATUS_LABELS,
  type StoreOrderBatchResult,
  type StoreOrderStatus,
} from '@legends/shared'
import type { Prisma } from '@prisma/client'
import { csvCell, csvDate } from '../lib/csv'
import { refundCoins } from './coin-service'
import { InvalidStatusTransitionError, OrderNotFoundError, StoreError } from './store-service'

export const storeOrderAdminInclude = {
  product: { select: { imageKey: true } },
  user: { select: { id: true, name: true, email: true } },
  handledBy: { select: { id: true, name: true } },
} as const
export type StoreOrderWithRefs = Prisma.StoreOrderGetPayload<{ include: typeof storeOrderAdminInclude }>

export interface StoreOrderFilters {
  status?: StoreOrderStatus
  userId?: string
  productId?: string
}

function filtersToWhere(filters: StoreOrderFilters): Prisma.StoreOrderWhereInput {
  return {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.userId ? { userId: filters.userId } : {}),
    ...(filters.productId ? { productId: filters.productId } : {}),
  }
}

export async function listOrdersForAdmin(
  actor: StoreAdminActor,
  filters: StoreOrderFilters,
  page: number,
): Promise<{ orders: StoreOrderWithRefs[]; total: number }> {
  const db = scopedPrisma(actor.companyId)
  const where = filtersToWhere(filters)
  const [orders, total] = await Promise.all([
    db.storeOrder.findMany({
      where,
      include: storeOrderAdminInclude,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * STORE_ORDER_PAGE_SIZE,
      take: STORE_ORDER_PAGE_SIZE,
    }),
    db.storeOrder.count({ where }),
  ])
  return { orders, total }
}

async function loadOrder(actor: StoreAdminActor, id: string): Promise<StoreOrderWithRefs> {
  const order = await scopedPrisma(actor.companyId).storeOrder.findFirst({
    where: { id },
    include: storeOrderAdminInclude,
  })
  if (!order) throw new OrderNotFoundError()
  return order
}

/**
 * Muda o status do pedido, estornando quando cancela.
 *
 * O UPDATE CONDICIONAL vem primeiro de propósito: `where: { status: <o observado> }`
 * é o que toma o lock da linha e reavalia o predicado contra a versão já commitada.
 * Sob Read Committed, a transação concorrente bloqueia nele, vê que o status mudou e
 * devolve count 0 — é isso que impede aprovar e cancelar o mesmo pedido em paralelo,
 * ou estornar duas vezes. Reler o pedido com um SELECT simples NÃO teria esse efeito.
 *
 * O advisory lock por PESSOA é o mesmo do resgate: cancelamento e resgate da mesma
 * pessoa não podem correr em paralelo, senão o saldo lido lá fica velho.
 */
export async function updateOrderStatus(
  actor: StoreAdminActor,
  id: string,
  next: StoreOrderStatus,
  adminNotes: string | null,
): Promise<StoreOrderWithRefs> {
  const current = await loadOrder(actor, id)
  if (!canTransitionStoreOrder(current.status, next)) throw new InvalidStatusTransitionError()

  const now = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`store:${current.userId}`}))`

    const { count } = await tx.storeOrder.updateMany({
      where: { id, companyId: actor.companyId, status: current.status },
      data: { status: next, handledById: actor.id, handledAt: now, adminNotes },
    })
    if (count === 0) throw new InvalidStatusTransitionError()

    if (next === 'CANCELLED') {
      // Segunda rede: mesmo que o recheck acima escape, a unique (userId, dedupeKey)
      // barra o crédito repetido.
      const outcome = await refundCoins({
        userId: current.userId,
        companyId: actor.companyId,
        amount: current.pricePaid,
        orderId: current.id,
        tx,
        now,
      })
      if (outcome.status === 'DUPLICATE') throw new InvalidStatusTransitionError()

      // Produto apagado depois do resgate: estorna os coins e segue. Não há
      // para onde devolver o estoque, e o pedido continua valendo como histórico.
      if (current.productId) {
        await tx.storeProduct.updateMany({
          where: { id: current.productId, companyId: actor.companyId },
          data: { stock: { increment: 1 } },
        })
      }
    }

    await recordAuditLog({
      actorId: actor.id,
      entityType: 'StoreOrder',
      entityId: id,
      action: 'UPDATE',
      companyId: actor.companyId,
      before: { status: current.status },
      after: { status: next, adminNotes },
      tx,
    })
  })

  return loadOrder(actor, id)
}

/**
 * Lote: item a item, pelo MESMO caminho de código do individual. Nada de
 * Promise.all — erro de um não pode abortar nem sumir. O resultado sempre diz o
 * que passou e o que falhou.
 */
export async function updateOrdersBatch(
  actor: StoreAdminActor,
  ids: string[],
  next: StoreOrderStatus,
  adminNotes: string | null,
): Promise<StoreOrderBatchResult> {
  const result: StoreOrderBatchResult = { succeeded: [], failed: [] }

  for (const id of ids) {
    try {
      await updateOrderStatus(actor, id, next, adminNotes)
      result.succeeded.push(id)
    } catch (err) {
      const message = err instanceof StoreError ? err.message : 'Falha inesperada ao processar este pedido.'
      if (!(err instanceof StoreError)) {
        console.error(`[store-admin-service] falha no lote (pedido ${id})`, err)
      }
      result.failed.push({ id, message })
    }
  }

  return result
}

const CSV_HEADER = ['Pessoa', 'E-mail', 'Produto', 'Preço pago', 'Status', 'Resgatado em', 'Tratado em', 'Tratado por', 'Nota interna']

/**
 * CSV do recorte filtrado inteiro — não da página. Separador `;` e BOM UTF-8
 * porque o Excel em pt-BR abre assim sem pedir importação.
 */
export async function exportOrdersCsv(
  actor: StoreAdminActor,
  filters: StoreOrderFilters,
): Promise<string> {
  const rows = await scopedPrisma(actor.companyId).storeOrder.findMany({
    where: filtersToWhere(filters),
    include: storeOrderAdminInclude,
    orderBy: { createdAt: 'desc' },
    take: STORE_EXPORT_MAX_ROWS,
  })

  const lines = [CSV_HEADER.join(';')]
  for (const row of rows) {
    lines.push(
      [
        csvCell(row.user.name),
        csvCell(row.user.email),
        csvCell(row.productTitle),
        String(row.pricePaid),
        STORE_ORDER_STATUS_LABELS[row.status],
        csvDate(row.createdAt),
        csvDate(row.handledAt),
        csvCell(row.handledBy?.name ?? null),
        csvCell(row.adminNotes),
      ].join(';'),
    )
  }

  return `﻿${lines.join('\n')}\n`
}
```

- [ ] **Step 4: Rode os testes e confirme que passam**

Run: `LEGENDS_DB_PORT=<porta> pnpm --filter @legends/api exec vitest run src/services/store-admin-queue.test.ts src/services/store-admin-service.test.ts`
Expected: PASS nos dois.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/store-admin-service.ts apps/api/src/services/store-admin-queue.test.ts
git commit -m "feat(api): fila de pedidos com estorno idempotente, lote e CSV"
```

---

### Task 9: Notificação de decisão

**Files:**
- Modify: `apps/api/src/services/notification-service.ts`
- Modify: `apps/api/src/services/notification-service.test.ts`
- Modify: `apps/api/src/services/store-admin-service.ts`

**Interfaces:**
- Consumes: `createNotification` (já no arquivo), `updateOrderStatus` (Task 8).
- Produces: `notifyStoreOrderStatus(order: { id: string; userId: string; productTitle: string; pricePaid: number }, status: 'APPROVED' | 'DELIVERED' | 'CANCELLED', actorId: string, companyId: string): Promise<void>`.

- [ ] **Step 1: Escreva o teste que falha**

Acrescente a `apps/api/src/services/notification-service.test.ts`:

```ts
describe('notifyStoreOrderStatus', () => {
  it('avisa que o pedido foi aprovado', async () => {
    const user = await prisma.user.create({
      data: { name: 'Pessoa', email: `n-${Math.random()}@x.com`, passwordHash: 'x', role: 'LEGEND' },
    })
    await notifyStoreOrderStatus(
      { id: 'o1', userId: user.id, productTitle: 'Fone', pricePaid: 100 },
      'APPROVED',
      user.id,
      DEFAULT_COMPANY_ID,
    )

    const notif = await prisma.notification.findFirst({ where: { userId: user.id } })
    expect(notif?.type).toBe('STORE_ORDER_APPROVED')
    expect(notif?.title).toBe('Seu resgate de "Fone" foi aprovado')
    expect(notif?.link).toBe('/loja?tab=pedidos')
  })

  // O cancelamento é o aviso mais importante: os coins voltaram.
  it('avisa o cancelamento dizendo quantos coins voltaram', async () => {
    const user = await prisma.user.create({
      data: { name: 'Pessoa', email: `n-${Math.random()}@x.com`, passwordHash: 'x', role: 'LEGEND' },
    })
    await notifyStoreOrderStatus(
      { id: 'o2', userId: user.id, productTitle: 'Fone', pricePaid: 100 },
      'CANCELLED',
      user.id,
      DEFAULT_COMPANY_ID,
    )

    const notif = await prisma.notification.findFirst({ where: { userId: user.id } })
    expect(notif?.type).toBe('STORE_ORDER_CANCELLED')
    expect(notif?.title).toBe('Seu resgate de "Fone" foi cancelado — 100 coins devolvidos')
  })
})
```

- [ ] **Step 2: Rode o teste e confirme que falha**

Run: `LEGENDS_DB_PORT=<porta> pnpm --filter @legends/api exec vitest run src/services/notification-service.test.ts`
Expected: FAIL — `notifyStoreOrderStatus is not exported`.

- [ ] **Step 3: Implemente a notificação**

Ao final de `apps/api/src/services/notification-service.ts`:

```ts
const STORE_ORDER_NOTIFICATION_TYPES = {
  APPROVED: 'STORE_ORDER_APPROVED',
  DELIVERED: 'STORE_ORDER_DELIVERED',
  CANCELLED: 'STORE_ORDER_CANCELLED',
} as const

export async function notifyStoreOrderStatus(
  order: { id: string; userId: string; productTitle: string; pricePaid: number },
  status: 'APPROVED' | 'DELIVERED' | 'CANCELLED',
  actorId: string,
  companyId: string,
): Promise<void> {
  const title =
    status === 'APPROVED'
      ? `Seu resgate de "${order.productTitle}" foi aprovado`
      : status === 'DELIVERED'
        ? `Seu resgate de "${order.productTitle}" foi entregue`
        // O cancelamento é o aviso que mais importa: diz que os coins voltaram.
        : `Seu resgate de "${order.productTitle}" foi cancelado — ${order.pricePaid} coins devolvidos`

  await createNotification({
    userId: order.userId,
    type: STORE_ORDER_NOTIFICATION_TYPES[status],
    title,
    actorId,
    link: '/loja?tab=pedidos',
    companyId,
  })
}
```

- [ ] **Step 4: Ligue no fluxo da fila**

Em `apps/api/src/services/store-admin-service.ts`, acrescente o import e o aviso **depois** do commit da transação, dentro de `updateOrderStatus`, logo antes do `return loadOrder(actor, id)`:

```ts
import * as notificationService from './notification-service'
```

```ts
  // Best-effort e SEMPRE depois do commit: falha ao notificar não pode desfazer a
  // decisão nem o estorno.
  try {
    await notificationService.notifyStoreOrderStatus(
      { id: current.id, userId: current.userId, productTitle: current.productTitle, pricePaid: current.pricePaid },
      next,
      actor.id,
      actor.companyId,
    )
  } catch (err) {
    console.error(`[store-admin-service] falha ao notificar decisão (pedido ${id})`, err)
  }
```

`next` aqui já é `'APPROVED' | 'DELIVERED' | 'CANCELLED'` na prática — `PENDING` nunca é destino em `STORE_ORDER_TRANSITIONS`. Estreite o tipo com um `if (next !== 'PENDING')` em volta do bloco para o TypeScript aceitar sem cast.

- [ ] **Step 5: Rode os testes e confirme que passam**

Run: `LEGENDS_DB_PORT=<porta> pnpm --filter @legends/api exec vitest run src/services/notification-service.test.ts src/services/store-admin-queue.test.ts`
Expected: PASS nos dois.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/notification-service.ts apps/api/src/services/notification-service.test.ts \
        apps/api/src/services/store-admin-service.ts
git commit -m "feat(api): notifica aprovação, entrega e cancelamento de resgate"
```

---

### Task 10: Rotas de administração

**Files:**
- Modify: `apps/api/src/lib/serialize.ts`
- Create: `apps/api/src/routes/admin-store.ts`
- Create: `apps/api/src/routes/admin-store.test.ts`
- Modify: `apps/api/src/app.ts`

**Interfaces:**
- Consumes: tudo de `store-admin-service` (Tasks 7 e 8), `toStoreOrderDTO`/`toStoreProductDTO` (Task 5).
- Produces: `toStoreOrderAdminDTO(order: StoreOrderWithRefs): StoreOrderAdminDTO`; as rotas listadas no spec.

- [ ] **Step 1: Escreva o teste que falha**

`apps/api/src/routes/admin-store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

let app: Awaited<ReturnType<typeof buildApp>>

beforeEach(async () => {
  app = await buildApp()
  await app.ready()
})

async function makeUser(role: 'LEGEND' | 'ADMIN' | 'SUBADMIN') {
  return prisma.user.create({
    data: { name: 'Pessoa', email: `as-${Math.random()}@x.com`, passwordHash: 'x', role, sectorId: DEFAULT_SECTOR_ID },
  })
}

function tokenFor(user: { id: string; role: string }, features: string[] = []) {
  return app.jwt.sign({ sub: user.id, role: user.role, companyId: DEFAULT_COMPANY_ID, features })
}

const BODY = { title: 'Fone', category: 'Equipamento', priceInCoins: 100, stock: 5 }

describe('acesso ao /admin/store', () => {
  it('barra colaborador', async () => {
    const user = await makeUser('LEGEND')
    const res = await app.inject({
      method: 'GET', url: '/admin/store/products',
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    })
    expect(res.statusCode).toBe(403)
  })

  // requireSectorFeature: SUBADMIN só entra com a feature do bloco ligada no setor dele.
  it('barra SUBADMIN sem a feature gente-gestao', async () => {
    const user = await makeUser('SUBADMIN')
    const res = await app.inject({
      method: 'GET', url: '/admin/store/products',
      headers: { authorization: `Bearer ${tokenFor(user, ['desenvolvimento-produto'])}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('libera SUBADMIN com a feature gente-gestao', async () => {
    const user = await makeUser('SUBADMIN')
    const res = await app.inject({
      method: 'GET', url: '/admin/store/products',
      headers: { authorization: `Bearer ${tokenFor(user, ['gente-gestao'])}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('libera ADMIN global sem feature nenhuma', async () => {
    const user = await makeUser('ADMIN')
    const res = await app.inject({
      method: 'GET', url: '/admin/store/products',
      headers: { authorization: `Bearer ${tokenFor(user)}` },
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('CRUD de produto pela rota', () => {
  it('recusa preço zero com 400 e issues', async () => {
    const admin = await makeUser('ADMIN')
    const res = await app.inject({
      method: 'POST', url: '/admin/store/products',
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: { ...BODY, priceInCoins: 0 },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json()).toHaveProperty('issues')
  })

  it('cria produto', async () => {
    const admin = await makeUser('ADMIN')
    const res = await app.inject({
      method: 'POST', url: '/admin/store/products',
      headers: { authorization: `Bearer ${tokenFor(admin)}` },
      payload: BODY,
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().product.title).toBe('Fone')
  })
})

describe('fila pela rota', () => {
  async function pendingOrder(adminToken: string) {
    const created = await app.inject({
      method: 'POST', url: '/admin/store/products',
      headers: { authorization: `Bearer ${adminToken}` }, payload: BODY,
    })
    const productId = created.json().product.id
    const user = await makeUser('LEGEND')
    await prisma.coinTransaction.create({
      data: { userId: user.id, kind: 'MANUAL_CREDIT', amount: 500, dedupeKey: `MANUAL:${Math.random()}`,
              day: new Date('2026-08-02'), companyId: DEFAULT_COMPANY_ID },
    })
    const order = await app.inject({
      method: 'POST', url: '/store/orders',
      headers: { authorization: `Bearer ${app.jwt.sign({ sub: user.id, role: 'LEGEND', companyId: DEFAULT_COMPANY_ID, features: ['coins'] })}` },
      payload: { productId },
    })
    return { orderId: order.json().order.id, userId: user.id }
  }

  it('a fila expõe a nota interna e a pessoa', async () => {
    const admin = await makeUser('ADMIN')
    const token = tokenFor(admin)
    const { orderId } = await pendingOrder(token)

    await app.inject({
      method: 'PATCH', url: `/admin/store/orders/${orderId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { status: 'APPROVED', adminNotes: 'Separado' },
    })
    const res = await app.inject({
      method: 'GET', url: '/admin/store/orders',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.json().orders[0].adminNotes).toBe('Separado')
    expect(res.json().orders[0].user.email).toBeTruthy()
  })

  it('lote responde com succeeded e failed', async () => {
    const admin = await makeUser('ADMIN')
    const token = tokenFor(admin)
    const a = await pendingOrder(token)
    const b = await pendingOrder(token)

    const res = await app.inject({
      method: 'POST', url: '/admin/store/orders/batch',
      headers: { authorization: `Bearer ${token}` },
      payload: { ids: [a.orderId, b.orderId], status: 'APPROVED' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().succeeded).toHaveLength(2)
    expect(res.json().failed).toHaveLength(0)
  })

  it('exporta CSV com o content-type de arquivo', async () => {
    const admin = await makeUser('ADMIN')
    const token = tokenFor(admin)
    await pendingOrder(token)

    const res = await app.inject({
      method: 'GET', url: '/admin/store/orders/export',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.body).toContain('Pessoa;E-mail;Produto')
  })
})
```

- [ ] **Step 2: Rode o teste e confirme que falha**

Run: `LEGENDS_DB_PORT=<porta> pnpm --filter @legends/api exec vitest run src/routes/admin-store.test.ts`
Expected: FAIL — 404 nas rotas.

- [ ] **Step 3: Escreva o serializer da fila**

Em `apps/api/src/lib/serialize.ts`, ao lado de `toStoreOrderDTO`:

```ts
/** DTO da FILA: o do colaborador mais a nota interna, a pessoa e quem tratou. */
export function toStoreOrderAdminDTO(order: StoreOrderWithRefs): StoreOrderAdminDTO {
  return {
    ...toStoreOrderDTO(order),
    adminNotes: order.adminNotes,
    user: { id: order.user.id, name: order.user.name, email: order.user.email },
    handledBy: order.handledBy ? { id: order.handledBy.id, name: order.handledBy.name } : null,
  }
}
```

- [ ] **Step 4: Escreva as rotas**

`apps/api/src/routes/admin-store.ts`:

```ts
import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  STORE_ADMIN_NOTES_MAX_LENGTH,
  STORE_BATCH_MAX_IDS,
  STORE_ORDER_PAGE_SIZE,
  STORE_ORDER_STATUSES,
  STORE_PRICE_MAX,
  STORE_PRICE_MIN,
  STORE_PRODUCT_CATEGORIES,
  STORE_PRODUCT_DESCRIPTION_MAX_LENGTH,
  STORE_PRODUCT_TITLE_MAX_LENGTH,
  STORE_STOCK_MAX,
} from '@legends/shared'
import { toStoreOrderAdminDTO, toStoreProductDTO } from '../lib/serialize'
import {
  createProduct,
  deleteProduct,
  exportOrdersCsv,
  listOrdersForAdmin,
  listProductsForAdmin,
  updateOrderStatus,
  updateOrdersBatch,
  updateProduct,
  type StoreOrderFilters,
} from '../services/store-admin-service'
import { StoreError } from '../services/store-service'

const idParamsSchema = z.object({ id: z.string().min(1) })

const productSchema = z.object({
  title: z.string().trim().min(1).max(STORE_PRODUCT_TITLE_MAX_LENGTH),
  description: z.string().trim().max(STORE_PRODUCT_DESCRIPTION_MAX_LENGTH).nullable().optional(),
  category: z.enum(STORE_PRODUCT_CATEGORIES),
  priceInCoins: z.number().int().min(STORE_PRICE_MIN).max(STORE_PRICE_MAX),
  stock: z.number().int().min(0).max(STORE_STOCK_MAX),
  imageKey: z.string().min(1).nullable().optional(),
  isDigital: z.boolean().optional(),
  isActive: z.boolean().optional(),
})
const productPatchSchema = productSchema.partial()

const orderFiltersSchema = z.object({
  status: z.enum(STORE_ORDER_STATUSES).optional(),
  userId: z.string().min(1).optional(),
  productId: z.string().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
})

const orderPatchSchema = z.object({
  status: z.enum(STORE_ORDER_STATUSES),
  adminNotes: z.string().trim().max(STORE_ADMIN_NOTES_MAX_LENGTH).nullable().optional(),
})

const batchSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(STORE_BATCH_MAX_IDS),
  status: z.enum(STORE_ORDER_STATUSES),
  adminNotes: z.string().trim().max(STORE_ADMIN_NOTES_MAX_LENGTH).nullable().optional(),
})

function handleStoreError(err: unknown, reply: FastifyReply) {
  if (err instanceof StoreError) return reply.code(err.status).send({ message: err.message })
  throw err
}

function actorFrom(request: { user: { sub: string; companyId: string } }) {
  return { id: request.user.sub, companyId: request.user.companyId }
}

export async function adminStoreRoutes(app: FastifyInstance) {
  // requireSectorFeature e NÃO requireAdminOrSubadmin: a loja é um bloco de Gente e
  // Gestão. requireAdminOrSubadmin liberaria o SUBADMIN de qualquer setor, e não há
  // sectorId no produto para recortar isso no service.
  const guard = { onRequest: [app.authenticate, app.requireSectorFeature('gente-gestao')] }

  app.get('/admin/store/products', guard, async (request) => {
    const products = await listProductsForAdmin(actorFrom(request))
    return { products: products.map(toStoreProductDTO) }
  })

  app.post('/admin/store/products', guard, async (request, reply) => {
    const parsed = productSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    const product = await createProduct(actorFrom(request), parsed.data)
    return reply.code(201).send({ product: toStoreProductDTO(product) })
  })

  app.patch('/admin/store/products/:id', guard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    const parsed = productPatchSchema.safeParse(request.body)
    if (!params.success || !parsed.success) {
      const issues = [...(params.success ? [] : params.error.issues), ...(parsed.success ? [] : parsed.error.issues)]
      return reply.code(400).send({ message: 'Dados inválidos', issues })
    }
    try {
      const product = await updateProduct(actorFrom(request), params.data.id, parsed.data)
      return { product: toStoreProductDTO(product) }
    } catch (err) {
      return handleStoreError(err, reply)
    }
  })

  app.delete('/admin/store/products/:id', guard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: params.error.issues })
    }
    try {
      await deleteProduct(actorFrom(request), params.data.id)
      return reply.code(204).send()
    } catch (err) {
      return handleStoreError(err, reply)
    }
  })

  app.get('/admin/store/orders', guard, async (request, reply) => {
    const parsed = orderFiltersSchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    const { page, ...filters } = parsed.data
    const { orders, total } = await listOrdersForAdmin(actorFrom(request), filters, page)
    return { orders: orders.map(toStoreOrderAdminDTO), total, page, pageSize: STORE_ORDER_PAGE_SIZE }
  })

  app.patch('/admin/store/orders/:id', guard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    const parsed = orderPatchSchema.safeParse(request.body)
    if (!params.success || !parsed.success) {
      const issues = [...(params.success ? [] : params.error.issues), ...(parsed.success ? [] : parsed.error.issues)]
      return reply.code(400).send({ message: 'Dados inválidos', issues })
    }
    try {
      const order = await updateOrderStatus(
        actorFrom(request), params.data.id, parsed.data.status, parsed.data.adminNotes ?? null,
      )
      return { order: toStoreOrderAdminDTO(order) }
    } catch (err) {
      return handleStoreError(err, reply)
    }
  })

  app.post('/admin/store/orders/batch', guard, async (request, reply) => {
    const parsed = batchSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    // O lote nunca falha inteiro: o resultado diz o que passou e o que não.
    return updateOrdersBatch(
      actorFrom(request), parsed.data.ids, parsed.data.status, parsed.data.adminNotes ?? null,
    )
  })

  app.get('/admin/store/orders/export', guard, async (request, reply) => {
    const parsed = orderFiltersSchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    const { page: _page, ...filters } = parsed.data
    const csv = await exportOrdersCsv(actorFrom(request), filters as StoreOrderFilters)
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', 'attachment; filename="pedidos-loja.csv"')
      .send(csv)
  })
}
```

Em `apps/api/src/app.ts`:

```ts
import { adminStoreRoutes } from './routes/admin-store'
// …
  app.register(adminStoreRoutes)
```

- [ ] **Step 5: Rode o teste e confirme que passa**

Run: `LEGENDS_DB_PORT=<porta> pnpm --filter @legends/api exec vitest run src/routes/admin-store.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/serialize.ts apps/api/src/routes/admin-store.ts \
        apps/api/src/routes/admin-store.test.ts apps/api/src/app.ts
git commit -m "feat(api): rotas de administração da loja"
```

---

### Task 11: Vitrine e meus pedidos no web

**Files:**
- Create: `apps/web/src/lib/use-store.ts`
- Create: `apps/web/src/pages/StorePage.tsx`
- Create: `apps/web/src/pages/StorePage.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/components/nav-items.ts`

**Interfaces:**
- Consumes: `StoreProductListResponse`, `StoreOrderListResponse`, `CreateStoreOrderResponse` (Task 1); rotas da Task 5; `apiFetch`, `invalidateCoins`, `useHasCoins`, `useCoinBalance`.
- Produces: `useStoreProducts()`, `useMyStoreOrders(page)`, `useRedeemProduct()`, `STORE_KEY`, componente `StorePage`.

- [ ] **Step 1: Escreva o teste que falha**

`apps/web/src/pages/StorePage.test.tsx` (copie o wrapper de `QueryClientProvider` + `MemoryRouter` do teste de página vizinho, ex.: `ChallengesPage.test.tsx`):

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { StorePage } from './StorePage'
import * as api from '../lib/api'

vi.mock('../lib/use-coins', async () => {
  const actual = await vi.importActual<typeof import('../lib/use-coins')>('../lib/use-coins')
  return { ...actual, useCoinBalance: () => ({ data: { balance: 150 }, isLoading: false }) }
})

const PRODUCTS = {
  products: [
    { id: 'p1', title: 'Fone', description: null, category: 'Equipamento', priceInCoins: 100,
      stock: 3, imageUrl: null, isDigital: false, isActive: true,
      createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' },
    { id: 'p2', title: 'Day off', description: null, category: 'Experiência', priceInCoins: 500,
      stock: 1, imageUrl: null, isDigital: true, isActive: true,
      createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z' },
  ],
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/loja']}>
        <StorePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
    if (path.startsWith('/store/products')) return PRODUCTS as never
    if (path.startsWith('/store/orders')) return { orders: [], total: 0, page: 1, pageSize: 20 } as never
    throw new Error(`rota inesperada: ${path}`)
  })
})

describe('StorePage', () => {
  it('mostra os produtos da vitrine com preço em coins', async () => {
    renderPage()
    expect(await screen.findByText('Fone')).toBeInTheDocument()
    expect(screen.getByText('100 coins')).toBeInTheDocument()
  })

  it('desabilita o resgate quando o saldo não cobre o preço', async () => {
    renderPage()
    await screen.findByText('Day off')

    const botoes = screen.getAllByRole('button', { name: 'Resgatar' })
    expect(botoes[0]).toBeEnabled()   // Fone, 100 coins, saldo 150
    expect(botoes[1]).toBeDisabled()  // Day off, 500 coins
  })

  it('mostra a mensagem do backend quando o resgate falha', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string, options?: RequestInit) => {
      if (path.startsWith('/store/products')) return PRODUCTS as never
      if (path === '/store/orders' && options?.method === 'POST') {
        throw new Error('Saldo insuficiente para resgatar este produto.')
      }
      if (path.startsWith('/store/orders')) return { orders: [], total: 0, page: 1, pageSize: 20 } as never
      throw new Error(`rota inesperada: ${path}`)
    })

    renderPage()
    await screen.findByText('Fone')
    await userEvent.click(screen.getAllByRole('button', { name: 'Resgatar' })[0])
    await userEvent.click(await screen.findByRole('button', { name: 'Confirmar resgate' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Saldo insuficiente para resgatar este produto.',
      )
    })
  })
})
```

- [ ] **Step 2: Rode o teste e confirme que falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/StorePage.test.tsx`
Expected: FAIL — `Failed to resolve import "./StorePage"`.

- [ ] **Step 3: Escreva os hooks**

`apps/web/src/lib/use-store.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CreateStoreOrderResponse,
  StoreOrderListResponse,
  StoreProductListResponse,
} from '@legends/shared'
import { apiFetch } from './api'
import { invalidateCoins } from './use-coins'

export const STORE_KEY = ['store'] as const

export function useStoreProducts() {
  return useQuery({
    queryKey: ['store', 'products'],
    queryFn: () => apiFetch<StoreProductListResponse>('/store/products'),
  })
}

export function useMyStoreOrders(page: number) {
  return useQuery({
    queryKey: ['store', 'orders', page],
    queryFn: () => apiFetch<StoreOrderListResponse>(`/store/orders?page=${page}`),
  })
}

/**
 * Resgate. Invalida a loja E os coins: o saldo do chip do cabeçalho muda no
 * mesmo clique, e o estoque do produto também.
 */
export function useRedeemProduct() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (productId: string) =>
      apiFetch<CreateStoreOrderResponse>('/store/orders', {
        method: 'POST',
        body: JSON.stringify({ productId }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: STORE_KEY })
      invalidateCoins(queryClient)
    },
  })
}
```

- [ ] **Step 4: Escreva a página**

`apps/web/src/pages/StorePage.tsx` — vitrine e meus pedidos, aba por `?tab=`. Siga a estrutura de `EngagementPage.tsx` para as abas e o visual de card/`Panel` da página vizinha:

```tsx
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { STORE_ORDER_STATUS_LABELS, type StoreProductDTO } from '@legends/shared'
import { useCoinBalance } from '../lib/use-coins'
import { useMyStoreOrders, useRedeemProduct, useStoreProducts } from '../lib/use-store'

type StoreTab = 'vitrine' | 'pedidos'
const TAB_LABELS: Record<StoreTab, string> = { vitrine: 'Vitrine', pedidos: 'Meus pedidos' }

export function StorePage() {
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab') as StoreTab | null
  const tab: StoreTab = requested === 'pedidos' ? 'pedidos' : 'vitrine'

  const balanceQuery = useCoinBalance()
  const balance = balanceQuery.data?.balance ?? 0

  return (
    <section>
      <header className="mb-lg flex items-center justify-between">
        <h1 className="text-headline-sm">Loja</h1>
        <p className="text-body-md text-on-surface-variant">{balance} EMR Coins</p>
      </header>

      <div role="tablist" className="mb-lg flex gap-sm">
        {(Object.keys(TAB_LABELS) as StoreTab[]).map((option) => (
          <button
            key={option}
            role="tab"
            aria-selected={tab === option}
            onClick={() => setParams({ tab: option }, { replace: true })}
            className={`rounded-full px-md py-xs text-label-lg ${
              tab === option ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'
            }`}
          >
            {TAB_LABELS[option]}
          </button>
        ))}
      </div>

      {tab === 'vitrine' ? <Showcase balance={balance} /> : <MyOrders />}
    </section>
  )
}

function Showcase({ balance }: { balance: number }) {
  const { data, isLoading } = useStoreProducts()
  const redeem = useRedeemProduct()
  const [confirming, setConfirming] = useState<StoreProductDTO | null>(null)

  if (isLoading) return <p className="text-body-md text-on-surface-variant">Carregando…</p>

  const products = data?.products ?? []
  if (products.length === 0) {
    return <p className="text-body-md text-on-surface-variant">Nenhum produto disponível no momento.</p>
  }

  return (
    <>
      {redeem.isError && (
        <p role="alert" className="mb-md text-body-sm text-error">
          {redeem.error instanceof Error ? redeem.error.message : 'Não foi possível concluir o resgate.'}
        </p>
      )}

      <ul className="grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-3">
        {products.map((product) => (
          <li key={product.id} className="rounded-lg bg-surface-container p-md">
            {product.imageUrl && (
              <img src={product.imageUrl} alt="" className="mb-sm h-40 w-full rounded-md object-cover" />
            )}
            <p className="text-label-sm text-on-surface-variant">{product.category}</p>
            <h2 className="text-title-md">{product.title}</h2>
            {product.description && (
              <p className="mt-xs text-body-sm text-on-surface-variant">{product.description}</p>
            )}
            <p className="mt-sm text-title-sm">{product.priceInCoins} coins</p>
            <button
              className="mt-sm rounded-full bg-primary px-md py-xs text-label-lg text-on-primary disabled:opacity-50"
              disabled={balance < product.priceInCoins || redeem.isPending}
              onClick={() => setConfirming(product)}
            >
              Resgatar
            </button>
          </li>
        ))}
      </ul>

      {confirming && (
        <div role="dialog" aria-label="Confirmar resgate" className="mt-lg rounded-lg bg-surface-container p-md">
          <p className="text-body-md">
            Resgatar “{confirming.title}” por {confirming.priceInCoins} coins? O valor sai do seu saldo
            agora e o pedido vai para a fila de Gente e Gestão.
          </p>
          <div className="mt-sm flex gap-sm">
            <button
              className="rounded-full bg-primary px-md py-xs text-label-lg text-on-primary"
              onClick={() => {
                redeem.mutate(confirming.id)
                setConfirming(null)
              }}
            >
              Confirmar resgate
            </button>
            <button className="rounded-full px-md py-xs text-label-lg" onClick={() => setConfirming(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </>
  )
}

function MyOrders() {
  const { data, isLoading } = useMyStoreOrders(1)
  if (isLoading) return <p className="text-body-md text-on-surface-variant">Carregando…</p>

  const orders = data?.orders ?? []
  if (orders.length === 0) {
    return <p className="text-body-md text-on-surface-variant">Você ainda não resgatou nada.</p>
  }

  return (
    <ul className="flex flex-col gap-sm">
      {orders.map((order) => (
        <li key={order.id} className="flex items-center justify-between rounded-lg bg-surface-container p-md">
          <div>
            {/* Título congelado no resgate — não é o nome atual do produto. */}
            <p className="text-title-sm">{order.productTitle}</p>
            <p className="text-body-sm text-on-surface-variant">
              {order.pricePaid} coins · {new Date(order.createdAt).toLocaleDateString('pt-BR')}
            </p>
          </div>
          <span className="text-label-lg">{STORE_ORDER_STATUS_LABELS[order.status]}</span>
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 5: Ligue rota e menu**

Em `apps/web/src/App.tsx`, junto das outras rotas de colaborador:

```tsx
<Route path="/loja" element={<StorePage />} />
```

Em `apps/web/src/components/nav-items.ts`, logo depois de Engajamento (nos dois blocos onde Engajamento aparece, mantendo o padrão de cada um):

```ts
{ to: '/loja', label: 'Loja', icon: 'redeem', anyOfFeatures: ['coins'] },
```

- [ ] **Step 6: Rode os testes e confirme que passam**

Run: `pnpm --filter @legends/web exec vitest run src/pages/StorePage.test.tsx src/components/nav-items.test.ts`
Expected: PASS nos dois — `nav-items.test.ts` entra porque o menu mudou.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/use-store.ts apps/web/src/pages/StorePage.tsx \
        apps/web/src/pages/StorePage.test.tsx apps/web/src/App.tsx \
        apps/web/src/components/nav-items.ts apps/web/src/components/nav-items.test.ts
git commit -m "feat(web): vitrine da loja e meus pedidos"
```

---

### Task 12: Administração da loja no web

**Files:**
- Create: `apps/web/src/pages/admin/StoreSection.tsx`
- Create: `apps/web/src/pages/admin/StoreOrdersTab.tsx`
- Create: `apps/web/src/pages/admin/StoreOrdersTab.test.tsx`
- Create: `apps/web/src/pages/admin/StoreProductsTab.tsx`
- Create: `apps/web/src/pages/admin/StoreProductForm.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/pages/admin/AdminSidebar.tsx`

**Interfaces:**
- Consumes: rotas da Task 10; `StoreOrderAdminListResponse`, `StoreOrderBatchResult`, `StoreProductListResponse`, `CreateStoreProductRequest`, `STORE_ORDER_STATUS_LABELS`, `STORE_PRODUCT_CATEGORIES` (Task 1); `apiFetch`, `apiFetchBlob`, `useImageUploadsEnabled`, `validateImageFile`, `UploadError`.
- Produces: `StoreSection` (default do bloco), `StoreOrdersTab`, `StoreProductsTab`, `StoreProductForm`.

- [ ] **Step 1: Escreva o teste que falha**

`apps/web/src/pages/admin/StoreOrdersTab.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StoreOrdersTab } from './StoreOrdersTab'
import * as api from '../../lib/api'

const ORDERS = {
  orders: [
    { id: 'o1', status: 'PENDING', productId: 'p1', productTitle: 'Fone', pricePaid: 100,
      imageUrl: null, handledAt: null, createdAt: '2026-08-01T12:00:00.000Z',
      adminNotes: null, user: { id: 'u1', name: 'Ana', email: 'ana@x.com' }, handledBy: null },
    { id: 'o2', status: 'PENDING', productId: 'p2', productTitle: 'Day off', pricePaid: 500,
      imageUrl: null, handledAt: null, createdAt: '2026-08-01T13:00:00.000Z',
      adminNotes: null, user: { id: 'u2', name: 'Bia', email: 'bia@x.com' }, handledBy: null },
  ],
  total: 2, page: 1, pageSize: 20,
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <StoreOrdersTab />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string) => {
    if (path.startsWith('/admin/store/orders')) return ORDERS as never
    if (path.startsWith('/admin/store/products')) return { products: [] } as never
    throw new Error(`rota inesperada: ${path}`)
  })
})

describe('StoreOrdersTab', () => {
  it('lista os pedidos com pessoa e preço congelado', async () => {
    renderTab()
    expect(await screen.findByText('Ana')).toBeInTheDocument()
    expect(screen.getByText('Fone')).toBeInTheDocument()
    expect(screen.getByText('100 coins')).toBeInTheDocument()
  })

  it('aprova em lote e relata quantos passaram', async () => {
    const fetchSpy = vi.spyOn(api, 'apiFetch').mockImplementation(async (path: string, options?: RequestInit) => {
      if (path === '/admin/store/orders/batch' && options?.method === 'POST') {
        return { succeeded: ['o1'], failed: [{ id: 'o2', message: 'Não é possível mudar o pedido para este status.' }] } as never
      }
      if (path.startsWith('/admin/store/orders')) return ORDERS as never
      throw new Error(`rota inesperada: ${path}`)
    })

    renderTab()
    await screen.findByText('Ana')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Selecionar pedido de Ana' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Selecionar pedido de Bia' }))
    await userEvent.click(screen.getByRole('button', { name: 'Aprovar selecionados' }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('1 de 2 pedidos atualizados')
    })
    expect(screen.getByRole('status')).toHaveTextContent('Não é possível mudar o pedido para este status.')
    expect(fetchSpy).toHaveBeenCalledWith(
      '/admin/store/orders/batch',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
```

- [ ] **Step 2: Rode o teste e confirme que falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/admin/StoreOrdersTab.test.tsx`
Expected: FAIL — `Failed to resolve import "./StoreOrdersTab"`.

- [ ] **Step 3: Escreva a aba de pedidos**

`apps/web/src/pages/admin/StoreOrdersTab.tsx`:

```tsx
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  STORE_ORDER_STATUSES,
  STORE_ORDER_STATUS_LABELS,
  type StoreOrderAdminListResponse,
  type StoreOrderBatchResult,
  type StoreOrderStatus,
} from '@legends/shared'
import { apiFetch, apiFetchBlob } from '../../lib/api'

const ADMIN_STORE_ORDERS_KEY = ['admin-store-orders']

export function StoreOrdersTab() {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<StoreOrderStatus | ''>('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [report, setReport] = useState<StoreOrderBatchResult | null>(null)

  const query = `?page=${page}${status ? `&status=${status}` : ''}`
  const { data, isLoading } = useQuery({
    queryKey: [...ADMIN_STORE_ORDERS_KEY, status, page],
    queryFn: () => apiFetch<StoreOrderAdminListResponse>(`/admin/store/orders${query}`),
  })

  const batch = useMutation({
    mutationFn: (next: StoreOrderStatus) =>
      apiFetch<StoreOrderBatchResult>('/admin/store/orders/batch', {
        method: 'POST',
        body: JSON.stringify({ ids: selected, status: next, adminNotes: notes.trim() || null }),
      }),
    onSuccess: (result) => {
      // O lote nunca é tudo-ou-nada: mostramos exatamente o que passou e o que não.
      setReport(result)
      setSelected([])
      setNotes('')
      void queryClient.invalidateQueries({ queryKey: ADMIN_STORE_ORDERS_KEY })
    },
  })

  async function exportCsv() {
    const { blob, filename } = await apiFetchBlob(`/admin/store/orders/export${query}`)
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename ?? 'pedidos-loja.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  const orders = data?.orders ?? []

  return (
    <div>
      <div className="mb-md flex flex-wrap items-center gap-sm">
        <label className="text-label-md">
          Status
          <select
            className="ml-xs rounded-md bg-surface-container px-sm py-xs"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as StoreOrderStatus | '')
              setPage(1)
            }}
          >
            <option value="">Todos</option>
            {STORE_ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>{STORE_ORDER_STATUS_LABELS[s]}</option>
            ))}
          </select>
        </label>
        <button className="rounded-full px-md py-xs text-label-lg" onClick={exportCsv}>
          Exportar CSV
        </button>
      </div>

      {report && (
        <div role="status" className="mb-md rounded-lg bg-surface-container p-md text-body-sm">
          <p>
            {report.succeeded.length} de {report.succeeded.length + report.failed.length} pedidos atualizados
          </p>
          {report.failed.map((f) => (
            <p key={f.id} className="text-on-surface-variant">{f.message}</p>
          ))}
        </div>
      )}

      {selected.length > 0 && (
        <div className="mb-md flex flex-wrap items-center gap-sm">
          <input
            className="rounded-md bg-surface-container px-sm py-xs"
            placeholder="Nota interna (opcional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <button
            className="rounded-full bg-primary px-md py-xs text-label-lg text-on-primary"
            disabled={batch.isPending}
            onClick={() => batch.mutate('APPROVED')}
          >
            Aprovar selecionados
          </button>
          <button
            className="rounded-full px-md py-xs text-label-lg"
            disabled={batch.isPending}
            onClick={() => batch.mutate('DELIVERED')}
          >
            Marcar como entregues
          </button>
          <button
            className="rounded-full px-md py-xs text-label-lg text-error"
            disabled={batch.isPending}
            onClick={() => batch.mutate('CANCELLED')}
          >
            Cancelar selecionados
          </button>
        </div>
      )}

      {isLoading ? (
        <p className="text-body-md text-on-surface-variant">Carregando…</p>
      ) : orders.length === 0 ? (
        <p className="text-body-md text-on-surface-variant">Nenhum pedido nesse recorte.</p>
      ) : (
        <ul className="flex flex-col gap-sm">
          {orders.map((order) => (
            <li key={order.id} className="flex items-center gap-md rounded-lg bg-surface-container p-md">
              <input
                type="checkbox"
                aria-label={`Selecionar pedido de ${order.user.name}`}
                checked={selected.includes(order.id)}
                onChange={(e) =>
                  setSelected((prev) =>
                    e.target.checked ? [...prev, order.id] : prev.filter((id) => id !== order.id),
                  )
                }
              />
              <div className="flex-1">
                <p className="text-title-sm">{order.user.name}</p>
                <p className="text-body-sm text-on-surface-variant">{order.productTitle}</p>
                {order.adminNotes && (
                  <p className="text-body-sm text-on-surface-variant">Nota: {order.adminNotes}</p>
                )}
              </div>
              <span className="text-body-sm">{order.pricePaid} coins</span>
              <span className="text-label-lg">{STORE_ORDER_STATUS_LABELS[order.status]}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-md flex items-center gap-sm">
        <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Anterior</button>
        <span className="text-body-sm">Página {page}</span>
        <button
          disabled={(data?.total ?? 0) <= page * (data?.pageSize ?? 20)}
          onClick={() => setPage((p) => p + 1)}
        >
          Próxima
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Rode o teste e confirme que passa**

Run: `pnpm --filter @legends/web exec vitest run src/pages/admin/StoreOrdersTab.test.tsx`
Expected: PASS.

- [ ] **Step 5: Escreva o formulário e a aba de produtos**

`apps/web/src/pages/admin/StoreProductForm.tsx` — formulário controlado, sem chamada de rede (quem salva é a aba). Campos: título, descrição, categoria (`STORE_PRODUCT_CATEGORIES`), preço, estoque, digital, ativo, capa. Espelhe a assinatura de `ChallengeForm.tsx`:

```tsx
import { STORE_PRODUCT_CATEGORIES, type StoreProductCategory } from '@legends/shared'

export interface StoreProductFormState {
  title: string
  description: string
  category: StoreProductCategory
  priceInCoins: string
  stock: string
  isDigital: boolean
  isActive: boolean
}

export const EMPTY_STORE_PRODUCT_FORM: StoreProductFormState = {
  title: '', description: '', category: 'Equipamento',
  priceInCoins: '', stock: '', isDigital: false, isActive: true,
}

export function StoreProductForm({
  form, onChange, onSubmit, onCancel, onPickImage, imagePreviewUrl, uploadsEnabled, uploadBusy, saving, editing,
}: {
  form: StoreProductFormState
  onChange: (next: StoreProductFormState) => void
  onSubmit: () => void
  onCancel: () => void
  onPickImage: (file: File) => void
  imagePreviewUrl: string | null
  uploadsEnabled: boolean
  uploadBusy: boolean
  saving: boolean
  editing: boolean
}) {
  return (
    <form
      className="mb-lg flex flex-col gap-sm"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      <label className="text-label-md">
        Título
        <input
          className="mt-xs w-full rounded-md bg-surface-container px-sm py-xs"
          value={form.title}
          onChange={(e) => onChange({ ...form, title: e.target.value })}
          required
        />
      </label>

      <label className="text-label-md">
        Descrição
        <textarea
          className="mt-xs w-full rounded-md bg-surface-container px-sm py-xs"
          value={form.description}
          onChange={(e) => onChange({ ...form, description: e.target.value })}
        />
      </label>

      <label className="text-label-md">
        Categoria
        <select
          className="mt-xs w-full rounded-md bg-surface-container px-sm py-xs"
          value={form.category}
          onChange={(e) => onChange({ ...form, category: e.target.value as StoreProductCategory })}
        >
          {STORE_PRODUCT_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </label>

      <label className="text-label-md">
        Preço em coins
        <input
          type="number" min={1}
          className="mt-xs w-full rounded-md bg-surface-container px-sm py-xs"
          value={form.priceInCoins}
          onChange={(e) => onChange({ ...form, priceInCoins: e.target.value })}
          required
        />
      </label>

      <label className="text-label-md">
        Estoque
        <input
          type="number" min={0}
          className="mt-xs w-full rounded-md bg-surface-container px-sm py-xs"
          value={form.stock}
          onChange={(e) => onChange({ ...form, stock: e.target.value })}
          required
        />
      </label>

      <label className="flex items-center gap-xs text-label-md">
        <input
          type="checkbox"
          checked={form.isDigital}
          onChange={(e) => onChange({ ...form, isDigital: e.target.checked })}
        />
        Produto digital (sem entrega física)
      </label>

      <label className="flex items-center gap-xs text-label-md">
        <input
          type="checkbox"
          checked={form.isActive}
          onChange={(e) => onChange({ ...form, isActive: e.target.checked })}
        />
        Ativo na vitrine
      </label>

      {uploadsEnabled && (
        <label className="text-label-md">
          Capa
          <input
            type="file"
            accept="image/*"
            className="mt-xs block"
            disabled={uploadBusy}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) onPickImage(file)
            }}
          />
          {uploadBusy && <p className="mt-1 text-body-sm text-on-surface-variant">Enviando…</p>}
          {imagePreviewUrl && <img src={imagePreviewUrl} alt="" className="mt-xs h-24 rounded-md object-cover" />}
        </label>
      )}

      <div className="flex gap-sm">
        <button
          type="submit"
          disabled={saving}
          className="rounded-full bg-primary px-md py-xs text-label-lg text-on-primary"
        >
          {editing ? 'Salvar' : 'Criar produto'}
        </button>
        <button type="button" className="rounded-full px-md py-xs text-label-lg" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  )
}
```

`apps/web/src/pages/admin/StoreProductsTab.tsx` — lista + form + upload. O `imageKey` só entra no corpo quando o form subiu arquivo novo nesta sessão; omitido, o PATCH preserva a capa (o DTO nunca devolve a chave):

```tsx
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CreateStoreProductRequest,
  PresignImageUploadResponse,
  StoreProductDTO,
  StoreProductListResponse,
} from '@legends/shared'
import { apiFetch } from '../../lib/api'
import { UploadError, validateImageFile } from '../../lib/upload'
import { useImageUploadsEnabled } from '../../lib/use-image-upload'
import { EMPTY_STORE_PRODUCT_FORM, StoreProductForm, type StoreProductFormState } from './StoreProductForm'

const ADMIN_STORE_PRODUCTS_KEY = ['admin-store-products']

function toRequest(form: StoreProductFormState, newImageKey: string | null): CreateStoreProductRequest {
  const body: CreateStoreProductRequest = {
    title: form.title.trim(),
    description: form.description.trim() === '' ? null : form.description.trim(),
    category: form.category,
    priceInCoins: Number(form.priceInCoins),
    stock: Number(form.stock),
    isDigital: form.isDigital,
    isActive: form.isActive,
  }
  if (newImageKey !== null) body.imageKey = newImageKey
  return body
}

export function StoreProductsTab() {
  const queryClient = useQueryClient()
  const uploadsEnabled = useImageUploadsEnabled()
  const [form, setForm] = useState(EMPTY_STORE_PRODUCT_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newImageKey, setNewImageKey] = useState<string | null>(null)
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)
  const [uploadBusy, setUploadBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ADMIN_STORE_PRODUCTS_KEY,
    queryFn: () => apiFetch<StoreProductListResponse>('/admin/store/products'),
  })

  function resetForm() {
    setForm(EMPTY_STORE_PRODUCT_FORM)
    setEditingId(null)
    setNewImageKey(null)
    setImagePreviewUrl(null)
  }

  const save = useMutation({
    mutationFn: (payload: { id: string | null; body: CreateStoreProductRequest }) =>
      apiFetch<{ product: StoreProductDTO }>(
        payload.id ? `/admin/store/products/${payload.id}` : '/admin/store/products',
        { method: payload.id ? 'PATCH' : 'POST', body: JSON.stringify(payload.body) },
      ),
    onSuccess: () => {
      resetForm()
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ADMIN_STORE_PRODUCTS_KEY })
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Não foi possível salvar o produto.'),
  })

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/admin/store/products/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ADMIN_STORE_PRODUCTS_KEY }),
  })

  async function handleFile(file: File) {
    setUploadBusy(true)
    try {
      validateImageFile(file)
      const presign = await apiFetch<PresignImageUploadResponse>('/uploads/images/presign', {
        method: 'POST',
        body: JSON.stringify({ contentType: file.type, size: file.size }),
      })
      // PUT direto no S3 (fetch cru, fora do apiFetch): sem Authorization, Content-Type do arquivo.
      const put = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      if (!put.ok) throw new UploadError('Falha ao enviar a imagem.')
      setNewImageKey(presign.key)
      setImagePreviewUrl(presign.publicUrl)
    } catch (err) {
      setError(err instanceof UploadError ? err.message : 'Falha ao enviar a imagem.')
    } finally {
      setUploadBusy(false)
    }
  }

  function startEdit(product: StoreProductDTO) {
    setEditingId(product.id)
    setNewImageKey(null)
    setImagePreviewUrl(product.imageUrl)
    setForm({
      title: product.title,
      description: product.description ?? '',
      category: product.category,
      priceInCoins: String(product.priceInCoins),
      stock: String(product.stock),
      isDigital: product.isDigital,
      isActive: product.isActive,
    })
  }

  return (
    <div>
      {error && <p role="alert" className="mb-md text-body-sm text-error">{error}</p>}

      <StoreProductForm
        form={form}
        onChange={setForm}
        onSubmit={() => save.mutate({ id: editingId, body: toRequest(form, newImageKey) })}
        onCancel={resetForm}
        onPickImage={handleFile}
        imagePreviewUrl={imagePreviewUrl}
        uploadsEnabled={uploadsEnabled}
        uploadBusy={uploadBusy}
        saving={save.isPending}
        editing={editingId !== null}
      />

      {isLoading ? (
        <p className="text-body-md text-on-surface-variant">Carregando…</p>
      ) : (
        <ul className="flex flex-col gap-sm">
          {(data?.products ?? []).map((product) => (
            <li key={product.id} className="flex items-center gap-md rounded-lg bg-surface-container p-md">
              <div className="flex-1">
                <p className="text-title-sm">{product.title}</p>
                <p className="text-body-sm text-on-surface-variant">
                  {product.category} · {product.priceInCoins} coins · estoque {product.stock}
                  {!product.isActive && ' · inativo'}
                </p>
              </div>
              <button className="text-label-lg" onClick={() => startEdit(product)}>Editar</button>
              <button className="text-label-lg text-error" onClick={() => remove.mutate(product.id)}>
                Apagar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Escreva a seção com as abas**

`apps/web/src/pages/admin/StoreSection.tsx`:

```tsx
import { useState } from 'react'
import { StoreOrdersTab } from './StoreOrdersTab'
import { StoreProductsTab } from './StoreProductsTab'

type AdminStoreTab = 'pedidos' | 'produtos'
const TAB_LABELS: Record<AdminStoreTab, string> = { pedidos: 'Pedidos', produtos: 'Produtos' }

/** Pedidos é a aba padrão: é a tela de trabalho da G&G, o catálogo muda pouco. */
export function StoreSection() {
  const [tab, setTab] = useState<AdminStoreTab>('pedidos')

  return (
    <section>
      <h1 className="mb-lg text-headline-sm">Loja</h1>
      <div role="tablist" className="mb-lg flex gap-sm">
        {(Object.keys(TAB_LABELS) as AdminStoreTab[]).map((option) => (
          <button
            key={option}
            role="tab"
            aria-selected={tab === option}
            onClick={() => setTab(option)}
            className={`rounded-full px-md py-xs text-label-lg ${
              tab === option ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'
            }`}
          >
            {TAB_LABELS[option]}
          </button>
        ))}
      </div>
      {tab === 'pedidos' ? <StoreOrdersTab /> : <StoreProductsTab />}
    </section>
  )
}
```

- [ ] **Step 7: Ligue rota e menu do admin**

Em `apps/web/src/App.tsx`, entre as rotas aninhadas de `/admin` (mesmo padrão de `pessoas`):

```tsx
<Route path="loja" element={<AdminSectorFeatureOnly feature="gente-gestao"><StoreSection /></AdminSectorFeatureOnly>} />
```

Em `apps/web/src/pages/admin/AdminSidebar.tsx`, no grupo onde está `/admin/coins`:

```ts
      { to: '/admin/loja', label: 'Loja', featureKey: 'gente-gestao' },
```

- [ ] **Step 8: Rode os testes do web e confirme que passam**

Run: `pnpm --filter @legends/web exec vitest run src/pages/admin/StoreOrdersTab.test.tsx src/pages/admin/AdminSidebar.test.tsx`
Expected: PASS nos dois — `AdminSidebar.test.tsx` entra porque o menu mudou.

- [ ] **Step 9: Verificação final e commit**

```bash
docker ps --format '{{.Names}}\t{{.Ports}}' | grep -i postgres
LEGENDS_DB_PORT=<porta> pnpm test
```

Expected: suíte inteira verde. Só agora — durante as tasks anteriores, só os arquivos alterados.

```bash
git add apps/web/src/pages/admin/StoreSection.tsx apps/web/src/pages/admin/StoreOrdersTab.tsx \
        apps/web/src/pages/admin/StoreOrdersTab.test.tsx apps/web/src/pages/admin/StoreProductsTab.tsx \
        apps/web/src/pages/admin/StoreProductForm.tsx apps/web/src/App.tsx \
        apps/web/src/pages/admin/AdminSidebar.tsx apps/web/src/pages/admin/AdminSidebar.test.tsx
git commit -m "feat(web): administração da loja com fila, lote e CRUD de produtos"
```

---

## Rastreamento dos critérios de aceite

| Critério do PBI | Onde é travado |
|---|---|
| Produto inativo ou zerado não aparece nem é resgatável por chamada direta | Task 4, testes "esconde produto inativo…", "recusa produto inativo…", "recusa produto com estoque zero…" |
| Resgate debita o preço exato e tira 1 do estoque, na mesma transação | Task 4, teste "debita o preço exato…" |
| Sem saldo → 400 em português, nada gravado | Task 4 "recusa por saldo insuficiente e não grava NADA"; Task 5 rota devolve 400 com a mensagem |
| Dois resgates simultâneos do último item: um conclui, estoque nunca negativo | Task 4, teste "dois resgates simultâneos do último item" |
| Cancelar devolve coins e estoque; cancelar de novo não credita | Task 8, testes "devolve os coins e o estoque" e "cancelar duas vezes não credita duas" |
| Ação em lote aprova os selecionados e relata quantos | Task 8 service, Task 10 rota, Task 12 tela ("1 de 2 pedidos atualizados") |
| Preço alterado depois não muda pedidos antigos | Task 4, teste "preço alterado depois não muda o valor registrado" |
| Transição de status inválida recusada | Task 8, testes de transição |
| SUBADMIN só entra pelo bloco de G&G | Task 10, testes de acesso |

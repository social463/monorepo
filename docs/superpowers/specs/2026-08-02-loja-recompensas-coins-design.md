# Loja de recompensas em EMR Coins — design

Data: 2026-08-02
Origem: portal EMR, `/app/admin/loja` (`src/routes/app.admin.loja.tsx`).
PBI dependente de: Engajamento / EMR Coins (#22236).

## Problema

Moeda sem loja é número na tela. O PBI de Engajamento entregou o livro-razão e o
saldo derivado, mas sem catálogo e sem fila de resgate o coin não vira nada — o
incentivo morre no primeiro mês. Falta o **sink**.

## Estado atual do Legends

Levantado no código antes de desenhar, não suposto:

- **O livro-razão está de pé e serve.** `CoinTransaction` é append-only, com
  `@@unique([userId, dedupeKey])` e saldo derivado por `aggregate` — sem coluna
  materializada (`coin-service.ts`). `awardFixedCoins({ tx })` já prova que dá para
  escrever no razão dentro de uma transação de outro domínio. A dependência do
  #22236 está satisfeita; **não se cria um segundo controle de saldo**.
- **Existe um template quase exato**: `challenge-submission-service.ts` — fila
  paginada por cursor, decisão em `$transaction` com *UPDATE condicional primeiro*
  (é ele que toma o lock e revalida sob Read Committed), `recordAuditLog({ tx })`,
  notificação best-effort pós-commit, lote item-a-item com relatório e CSV com
  neutralização de injeção de fórmula.
- `Challenge` já resolve os mesmos problemas de catálogo: `imageKey` do S3 (a chave
  nunca sai no DTO), `category` como string e não enum do Prisma, `isActive`.
- `/admin/coins` hoje é `adminOnly: true`; `/engajamento` é gated por `coins`.
- Nenhuma branch remota, worktree ou spec tocando loja/store.

## Decisões

### Acesso: bloco `gente-gestao`, não `requireAdminOrSubadmin`

O PBI pede `requireAdminOrSubadmin` + recorte do SUBADMIN pelo próprio `sectorId`.
Não cabe aqui: o catálogo é **da empresa**, os models não têm `sectorId` e não faz
sentido terem — loja por setor é outro produto. Com `requireAdminOrSubadmin` e sem
`sectorId` para recortar, o SUBADMIN de *qualquer* setor administraria a loja
inteira, que é justamente o que o `AGENTS.md` manda evitar.

Fica: `app.requireSectorFeature('gente-gestao')` na rota e `AdminSectorFeatureOnly`
no front. Entra o ADMIN global e o SUBADMIN do setor com a feature ligada — que é o
que o PBI quer dizer por "líder de Gente e Gestão", escrito na convenção do repo.

### Lançamento: kinds `SPEND` e `REFUND` novos

Reusar `MANUAL_DEBIT`/`MANUAL_CREDIT` misturaria gasto na loja com ajuste manual de
admin no extrato e em `CoinReportDTO.manual`, com `actorId` nulo mentindo que houve
um admin — e depois só uma heurística de string separaria os dois. Kind próprio
mantém o relatório honesto e dá de graça a idempotência do estorno:

```
dedupeKey  STORE_ORDER:<orderId>   débito do resgate    (amount negativo)
           STORE_REFUND:<orderId>  estorno do cancelamento (amount positivo)
```

A unique `(userId, dedupeKey)` **é** a garantia de que cancelar duas vezes não
credita duas, no banco, independente do que o código faça.

### Concorrência: advisory lock por pessoa + UPDATE condicional no produto

São dois problemas distintos e nenhuma solução cobre os dois:

- **Estoque, entre pessoas diferentes** — resolvido pelo `updateMany` condicional
  (`stock: { gt: 0 }`), que toma o lock da linha e reavalia o predicado contra a
  versão já commitada. É o padrão de `challenge-submission-service`.
- **Saldo, na mesma pessoa** — `aggregate` não trava nada. Sob Read Committed, duas
  transações leem 100, cada uma debita 60, e o saldo vai a −20. Resolvido com
  `pg_advisory_xact_lock(hashtext('store:' || userId))` na primeira linha da
  transação: serializa só os resgates daquela pessoa e solta sozinho no
  commit/rollback, sem encostar em nenhuma outra escrita de `User`. Colisão de
  `hashtext` serializa a mais, nunca deixa passar.

Coluna de saldo materializada foi rejeitada: seria o segundo controle de saldo que
o PBI proíbe.

### Vitrine: rota `/loja` própria

Não é aba de `/engajamento`. A grade de produtos precisa da largura toda, e "Meus
pedidos" viraria sub-aba de sub-aba. Item próprio no menu, gated pela feature
`coins`.

## Dados

Uma migration nova (`pnpm db:migrate`). Nunca editar migration aplicada.

```prisma
enum StoreOrderStatus { PENDING  APPROVED  DELIVERED  CANCELLED }

enum CoinTransactionKind { EARN  MANUAL_CREDIT  MANUAL_DEBIT  SPEND  REFUND }

model StoreProduct {
  id           String  @id @default(cuid())
  title        String
  description  String?
  /// Uma de STORE_PRODUCT_CATEGORIES (@legends/shared). String e não enum do Prisma,
  /// mesmo racional de Challenge.category: catálogo de produto não é invariante do
  /// banco — incluir uma categoria não deve custar migration.
  category     String
  priceInCoins Int
  stock        Int     @default(0)
  /// Chave do S3. Guarda-se a chave, nunca a URL.
  imageKey     String?
  isDigital    Boolean @default(false)
  isActive     Boolean @default(true)
  companyId    String  @default("company-emr")
  createdById  String
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([companyId, isActive, category])
  @@index([companyId])
}

model StoreOrder {
  id           String  @id @default(cuid())
  userId       String
  /// SetNull: apagar um produto não pode apagar o histórico de quem já resgatou.
  productId    String?
  /// CONGELADOS no resgate. O produto muda de nome e de preço depois; o pedido é
  /// histórico e não pode acompanhar essa mudança.
  productTitle String
  pricePaid    Int
  status       StoreOrderStatus @default(PENDING)
  /// Nota INTERNA da G&G. Nunca sai no DTO do colaborador.
  adminNotes   String?
  handledById  String?
  handledAt    DateTime?
  companyId    String  @default("company-emr")
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([companyId, status, createdAt])
  @@index([companyId, userId, createdAt])
}
```

Dois desvios conscientes da letra do PBI, ambos por causa de histórico:

1. `productId` é **opcional**, com `onDelete: SetNull`. Com `productId` obrigatório,
   ou o DELETE de produto trava para sempre, ou o pedido antigo morre junto.
   Consequência tratada no service: cancelar pedido de produto já apagado **estorna
   os coins e pula a devolução de estoque** — não há para onde devolver.
2. **Dois DTOs de pedido**, porque `adminNotes` é nota interna e não pode vazar na
   tela "Meus pedidos".

## Contrato — `packages/shared/src/store.ts`

Contrato primeiro, barril em `index.ts`, e só então os dois lados.

```ts
export const STORE_PRODUCT_CATEGORIES = ['Conteúdo', 'Equipamento', 'Experiência'] as const
export const STORE_ORDER_STATUSES = ['PENDING', 'APPROVED', 'DELIVERED', 'CANCELLED'] as const

export const STORE_ORDER_STATUS_LABELS: Record<StoreOrderStatus, string> = {
  PENDING: 'Pendente', APPROVED: 'Aprovado', DELIVERED: 'Entregue', CANCELLED: 'Cancelado',
}

/** Única fonte de verdade das transições — service e web leem daqui, ninguém reescreve a regra. */
export const STORE_ORDER_TRANSITIONS: Record<StoreOrderStatus, readonly StoreOrderStatus[]> = {
  PENDING:   ['APPROVED', 'CANCELLED'],
  APPROVED:  ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],   // terminal
  CANCELLED: [],   // terminal
}
export function canTransitionStoreOrder(from: StoreOrderStatus, to: StoreOrderStatus): boolean

StoreProductDTO    { id, title, description, category, priceInCoins, stock, imageUrl,
                     isDigital, isActive, createdAt, updatedAt }
StoreOrderDTO      { id, status, productId, productTitle, pricePaid, imageUrl,
                     handledAt, createdAt }                                  // colaborador
StoreOrderAdminDTO extends StoreOrderDTO
                   + { adminNotes, user: {id,name,email}, handledBy: {id,name} | null }  // fila
```

Mais os limites: `STORE_PRODUCT_TITLE_MAX_LENGTH`, `STORE_PRODUCT_DESCRIPTION_MAX_LENGTH`,
`STORE_ADMIN_NOTES_MAX_LENGTH`, `STORE_PRICE_MIN`/`STORE_PRICE_MAX`, `STORE_STOCK_MAX`,
`STORE_ORDER_PAGE_SIZE`, `STORE_EXPORT_MAX_ROWS`, `STORE_BATCH_MAX_IDS`.

Em `coin.ts`, os kinds novos entram em `COIN_TRANSACTION_KINDS` com rótulo —
`SPEND: 'Resgate na loja'`, `REFUND: 'Estorno de resgate'`. Como
`COIN_TRANSACTION_KIND_LABELS` é `Record<CoinTransactionKind, string>`, o TypeScript
obriga a preencher os dois. `CoinReportDTO.manual` continua contando só `MANUAL_*`.

## Backend

Dois services, espelhando a divisão de Desafios:
`services/store-service.ts` (catálogo público + resgate) e
`services/store-admin-service.ts` (CRUD de produto + fila).

Erros de domínio em `StoreError`, classe tipada com `status`, no padrão de
`VoteError`/`ChallengeError`; a rota faz `instanceof` e responde com `err.status`:

| Erro | HTTP | Mensagem |
|---|---|---|
| `ProductNotFoundError` | 404 | Produto não encontrado. |
| `ProductUnavailableError` | 409 | Este produto não está disponível para resgate. |
| `OutOfStockError` | 409 | Este produto está sem estoque. |
| `InsufficientBalanceError` | **400** | Saldo insuficiente para resgatar este produto. |
| `OrderNotFoundError` | 404 | Pedido não encontrado. |
| `InvalidStatusTransitionError` | 409 | Não é possível mudar o pedido para este status. |

### O resgate

A ordem das operações é a regra, não detalhe de implementação:

```ts
await prisma.$transaction(async (tx) => {
  // 1. Serializa os resgates DESTA pessoa. Solta sozinho no commit/rollback.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`store:${userId}`}))`

  // 2. Preço e disponibilidade lidos DENTRO da transação — o produto pode ter mudado.
  const product = await tx.storeProduct.findFirst({ where: { id: productId, companyId } })
  if (!product) throw new ProductNotFoundError()
  if (!product.isActive) throw new ProductUnavailableError()

  // 3. Saldo. Só é confiável por causa do lock do passo 1: aggregate não trava nada.
  const { _sum } = await tx.coinTransaction.aggregate({
    where: { userId, companyId }, _sum: { amount: true },
  })
  if ((_sum.amount ?? 0) < product.priceInCoins) throw new InsufficientBalanceError()

  // 4. UPDATE CONDICIONAL — é ele que trava a linha do produto e revalida o estoque
  //    contra a versão já commitada. count 0 = outra pessoa levou o último item.
  //    Um SELECT antes de um update cego NÃO teria esse efeito.
  const { count } = await tx.storeProduct.updateMany({
    where: { id: productId, companyId, isActive: true, stock: { gt: 0 } },
    data: { stock: { decrement: 1 } },
  })
  if (count === 0) throw new OutOfStockError()

  // 5. Pedido com título e preço CONGELADOS.
  const order = await tx.storeOrder.create({
    data: { userId, productId, productTitle: product.title,
            pricePaid: product.priceInCoins, companyId },
  })

  // 6. Débito. dedupeKey `STORE_ORDER:<orderId>` — a unique (userId, dedupeKey) é a 2ª rede.
  await spendCoins({ userId, companyId, amount: product.priceInCoins, orderId: order.id, tx })
})
```

O `tx` cru não passa por `scopedPrisma`, então `companyId` vai explícito em todo
`where` e `data` — mesmo padrão de `recordAuditLog` e `awardFixedCoins`.

As duas proteções são complementares e nenhuma substitui a outra: o **advisory
lock** cobre a mesma pessoa clicando duas vezes (saldo); o **UPDATE condicional**
cobre pessoas diferentes disputando o último item (estoque).

A escrita no livro-razão fica com o dono do livro-razão: `spendCoins` e
`refundCoins` entram em `coin-service.ts`, ao lado de `awardFixedCoins`, aceitando
`tx`. `store-service` não monta `CoinTransaction` na mão.

### O cancelamento

Mesma fila do resgate, idempotente em dois níveis:

```ts
await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`store:${order.userId}`}))`
const { count } = await tx.storeOrder.updateMany({
  where: { id, companyId, status: { in: ['PENDING', 'APPROVED'] } },   // recheck sob lock
  data: { status: 'CANCELLED', handledById: actor.id, handledAt: now, adminNotes },
})
if (count === 0) throw new InvalidStatusTransitionError()            // 1ª rede: já era terminal
const outcome = await refundCoins({ ..., orderId: order.id, tx })    // STORE_REFUND:<orderId>
if (outcome.status === 'DUPLICATE') throw new InvalidStatusTransitionError()  // 2ª rede: o banco
if (order.productId) {
  await tx.storeProduct.updateMany({ where: { id: order.productId, companyId },
                                     data: { stock: { increment: 1 } } })
}
await recordAuditLog({ ..., tx })
```

### Aprovar e entregar

Não mexem em coin nem em estoque. Valida com `canTransitionStoreOrder(order.status,
next)`, aplica `updateMany` com `where: { status: order.status }` — o status
*observado*, de modo que uma mudança concorrente devolve `count` 0 e a transição é
recusada — e grava auditoria na mesma transação. Notificação é **best-effort** depois
do commit, em `try/catch` com log: falha ao notificar nunca desfaz a decisão.

### Lote

Item a item, pelo mesmo caminho de código do individual. Nada de `Promise.all`: erro
de um não pode abortar nem sumir. Devolve `{ succeeded: string[], failed: { id,
message }[] }`.

### Rotas

```
routes/store.ts        onRequest: [app.authenticate, app.requireFeature('coins')]
  GET  /store/products          vitrine: isActive && stock > 0
  POST /store/orders            { productId } → 201 { order, balance }
  GET  /store/orders            meus pedidos, paginado

routes/admin-store.ts  onRequest: [app.authenticate, app.requireSectorFeature('gente-gestao')]
  GET|POST         /admin/store/products
  PATCH|DELETE     /admin/store/products/:id
  GET              /admin/store/orders          filtros userId, productId, status + página
  PATCH            /admin/store/orders/:id      { status, adminNotes? }
  POST             /admin/store/orders/batch    { ids, status }
  GET              /admin/store/orders/export   CSV do recorte filtrado inteiro
```

Rota fina: Zod `safeParse` → `400 { message, issues }`, chama o service, serializa
com `toStoreProductDTO` / `toStoreOrderDTO` / `toStoreOrderAdminDTO` em
`lib/serialize.ts` (`imageUrl` derivado de `imageKey` via `publicUrlFor`; a chave
nunca sai). Registro em `app.ts` (`buildApp`). Toda mutação de admin grava
`recordAuditLog` dentro da mesma transação.

Três `NotificationType` novos — `STORE_ORDER_APPROVED`, `STORE_ORDER_DELIVERED`,
`STORE_ORDER_CANCELLED`, com `link: '/loja?tab=pedidos'`. O de cancelamento não está
na letra do PBI, mas é o único aviso de que os coins voltaram.

### Limpeza pontual no caminho

`csvCell` — o que neutraliza injeção de fórmula (`=`, `+`, `-`, `@`) antes de o
Excel abrir o arquivo — hoje é privado de `challenge-submission-service.ts`. Em vez
de copiá-lo, extrair para `lib/csv.ts` e apontar os dois para lá. Copiar essa guarda
é como ela some na próxima vez.

## Web

**Colaborador** — `pages/StorePage.tsx` em `/loja`, item novo em `nav-items.ts` com
feature `coins`, rota em `App.tsx`. Abas por `?tab=` (`vitrine` | `pedidos`), padrão
de `EngagementPage`; o deep-link importa porque a notificação aponta para
`/loja?tab=pedidos`.

Vitrine: grade de cards (imagem, título, categoria, preço, chip Digital/Físico) com
o saldo no topo. `Resgatar` desabilitado quando o saldo não cobre o preço, e com
confirmação antes de gastar — gasto de coin não tem desfazer pelo colaborador.
Produto inativo ou zerado não vem da API, então não existe estado "esgotado" na
tela. No sucesso, invalida as queries de saldo, produtos e pedidos; no erro, mostra
a mensagem do service (já em português). "Meus pedidos" mostra o **título congelado**
do pedido, não o nome atual do produto.

**Admin** — `/admin/loja` sob `/admin` no `App.tsx`, item no `AdminSidebar.tsx` com
`featureKey: 'gente-gestao'`, tela envolvida em `AdminSectorFeatureOnly`. Abas
**Pedidos** (padrão — é a tela de trabalho) e **Produtos**. Dividida para nenhum
arquivo virar o dono de tudo:

```
pages/admin/StoreSection.tsx       abas + guarda de acesso
pages/admin/StoreOrdersTab.tsx     fila: filtros, seleção múltipla, lote, paginação, CSV
pages/admin/StoreProductsTab.tsx   tabela de produtos
pages/admin/StoreProductForm.tsx   formulário + upload de imagem (presign do ChallengeForm)
```

Aprovar, entregar e cancelar abrem o campo de nota interna. O lote mostra o relatório
do service — "7 de 9 aprovados", com o motivo de cada falha, nunca um erro genérico.
Dados via React Query + `apiFetch`.

## Testes

Vitest ao lado do arquivo; API contra Postgres real.

| Arquivo | O que trava |
|---|---|
| `store-service.test.ts` | saldo insuficiente → 400 **e nada gravado** (sem pedido, sem lançamento, estoque intacto); produto inativo e estoque 0 recusados **por chamada direta ao POST**, não só escondidos da vitrine; resgate feliz debita exatamente `priceInCoins` e tira 1 do estoque; **dois resgates concorrentes do último item** → um conclui, o outro recusa, estoque final 0 e nunca negativo; **dois resgates simultâneos da mesma pessoa** com saldo para um só → saldo final ≥ 0; preço alterado depois não muda `pricePaid` de pedido antigo |
| `store-admin-service.test.ts` | transição inválida recusada (`DELIVERED → APPROVED`, cancelado → qualquer); cancelar devolve coins e estoque; **cancelar de novo falha e o saldo não muda** — uma única linha `REFUND`; cancelar pedido de produto apagado estorna sem quebrar; lote relata succeeded/failed; auditoria gravada na mesma transação |
| `routes/admin-store.test.ts` | SUBADMIN de setor sem `gente-gestao` leva 403; Zod devolve `400 { message, issues }`; CSV com BOM e `;` |
| `StorePage.test.tsx`, `StoreOrdersTab.test.tsx` | botão desabilitado sem saldo; erro em português; lote com a contagem |

Os testes de concorrência usam `Promise.allSettled` com transações de verdade em
paralelo — é o único jeito de o advisory lock e o UPDATE condicional serem exercidos.

## Fora de escopo

Pagamento em dinheiro, integração com fornecedor ou logística, e carrinho com
múltiplos itens. Um resgate = um produto.

**Cancelamento pelo colaborador também fica de fora**: só a G&G cancela, e por isso
só ela estorna. A pessoa vê o status do pedido e nada mais — abrir o cancelamento
para quem resgatou é uma decisão de produto que este PBI não tomou.

## Deixado para depois (triado no review final da branch)

Nada aqui bloqueia o merge; está registrado para não se perder.

- **Sem confirmação de sucesso no resgate.** A vitrine mostra erro, mas o caminho feliz
  só se percebe pelo saldo mudando. Vale um retorno explícito quando alguém encostar
  nessa tela.
- **Erro de query vira estado vazio** nas três telas novas (`StorePage`, as duas abas do
  admin): elas ramificam em `isLoading` e depois em `length === 0`, nunca em `isError`.
  Um 500 lê como "Nenhum produto disponível". Consistente entre as três, então é padrão
  deliberado — mas manda alguém investigar uma loja "vazia" que na verdade está fora do ar.
- **Sem ação por linha na fila.** Aprovar/entregar/cancelar um pedido só passa por marcar
  a caixa e usar a barra de lote. O irmão `SubmissionRow` tem ação por linha.
- **Filtros de pessoa e produto** existem na API e no spec, mas a tela só expõe o de status.
- **Cancelamento em lote não invalida `['admin-store-products']`**, então a aba Produtos
  mostra estoque velho até o próximo refetch.
- **Não há como remover a capa de um produto** depois de definida: a API aceita
  `imageKey: null`, a tela não tem o controle. Apagar produto também deixa o objeto órfão
  no S3 — mesmo comportamento de `Challenge`.
- **Sem paginação em "Meus pedidos"** (o hook aceita página; a tela sempre passa 1).
- **`StoreProductsTab`, `StoreProductForm` e `StoreSection` não têm teste.** Dois dos
  defeitos achados no review final moravam justamente nesses arquivos.
- **Índice redundante**: `StoreProduct` tem `@@index([companyId])` além de
  `@@index([companyId, isActive, category])`. Remover custa migration; juntar na próxima.
- **`listCoinTransactions` e `listAuditLog`** paginam sem desempate no `orderBy`, o mesmo
  problema que corrigimos na loja. Fora do escopo desta branch, mas é a mesma classe.

### O truncamento dos testes da API

`apps/api/test/setup.ts` apaga tabela por tabela numa ordem fixa, e um comentário exige
que `adminAuditLog.deleteMany()` fique adjacente a `user.deleteMany()` — porque escritas
de auditoria best-effort aterrissam de outra conexão e uma linha órfã trava o delete do
usuário por FK `RESTRICT`, abortando a transação inteira do truncamento.

Nesta branch, duas linhas inseridas nesse intervalo derrubaram **346 testes** sem relação
aparente com a mudança. A adjacência que o comentário exige, aliás, **não existe**: cinco
statements pré-existentes já ficam entre os dois. O comentário descreve uma regra que o
arquivo não cumpre.

Recomendação: trocar a cascata de `deleteMany` por um único
`TRUNCATE TABLE ... RESTART IDENTITY CASCADE`. Sem "entre", sem ordem a manter, e mais
rápido em 169 arquivos com `fileParallelism: false`. Enquanto isso não acontece, o mínimo
é restaurar a adjacência de verdade e reescrever o comentário nomeando o sintoma — a suíte
inteira falhando com P2003 —, que é o que transforma uma tarde perdida em cinco minutos.

## Notas operacionais

- O PBI cita `LEGENDS_DB_PORT=5442`, mas a 5442 é o Postgres de **outro worktree**.
  Conferir `docker ps` antes de `pnpm db:migrate` para não migrar no banco de um
  colega, e antes de rodar a suíte para não colidir no `legends_test`.

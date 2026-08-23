# Multi-tenancy em Review (mural/resenha) — Design

## Contexto

Quarta fatia da linha de trabalho pra trazer Feedback/FeedbackReaction/MoodEntry/Review/
Notification/escritório pro escopo de multi-tenancy (Feedback, MoodEntry e Notification já foram
commitadas). A família `Review` tem 7 models sem `companyId` — `Review`, `ReviewComment`,
`ReviewReaction`, `ReviewCommentReaction`, `ReviewShare`, `ReviewMention`, `ReviewCommentMention`.

## Vazamento real fechado por esta fatia (o mais severo até agora)

`listFeed` (`review-service.ts`), que alimenta `GET /reviews` — **o feed principal da Resenha** —
é hoje totalmente global: `prisma.review.findMany({ where: { author: { active: true }, ... } })`
sem nenhum filtro de empresa. Diferente do mural (um widget agregado periférico, já corrigido nas
fatias anteriores), este é **o feed social inteiro**: qualquer usuário autenticado vê resenhas,
comentários, reações e menções de **todas as empresas** hoje.

## Gap adjacente real fechado por esta fatia

`resolveMentions` (helper privado usado por `createReview`/`createComment` pra resolver
`@menções`) busca usuários mencionáveis sem filtro de empresa — hoje dá pra mencionar/notificar um
usuário de outra empresa, se o autor souber o id dele.

## Escopo

- Migration: `companyId` nos 7 models da família `Review`.
- `apps/api/src/services/review-service.ts` — todas as 11 funções exportadas + `resolveMentions`.
- `apps/api/src/routes/review.ts` — os ~11 call-sites, todos self-service.
- `apps/api/src/services/mural-service.ts` — só a query de `reviewShare` dentro de
  `getMuralItems`.

### Não-objetivos

- `reviewHub` (`lib/review-hub.ts`) — WebSocket pub/sub em memória, canal único global, sem
  salas. O payload dos eventos (`{type, reviewId?}`) não carrega conteúdo de resenha nenhum — só
  sinaliza "refaça o fetch". Não é vazamento de dado (o cliente vai buscar via `GET /reviews`, já
  escopado depois desta fatia); só dispara um refetch à toa pra clientes de outras empresas. Fora
  de escopo, mesmo tratamento dado a infraestrutura de broadcast em fatias anteriores.
- Nenhuma mudança de comportamento observável em produção — só existe uma empresa hoje.

## Mecanismo

### Migration

Cada um dos 7 models ganha `companyId String @default("company-emr")` + `company Company
@relation(...)` + `@@index([companyId])`. `Company` ganha as 7 relações inversas correspondentes.
Registrar todos os 7 nomes em `TENANT_SCOPED_MODELS`. Mesmo padrão aditivo das migrations
anteriores (`ADD COLUMN ... NOT NULL DEFAULT`, `CREATE INDEX`, `ADD CONSTRAINT ... FOREIGN KEY`).

Como todo `ReviewComment`/`ReviewReaction`/etc. só é criado depois de uma busca escopada do
`Review`/`ReviewComment` pai (ver abaixo), o invariante "linha filha tem o mesmo `companyId` do
pai" se mantém naturalmente — não precisa de validação extra: se o pai não é encontrado no escopo
do ator, a função já rejeita antes de criar a linha filha.

### Padrão geral

`companyId` sempre novo parâmetro, sempre vindo de `request.user.companyId` na rota (self-service,
sem query extra em nenhum call-site) — nas funções que já recebem um objeto de input, vira mais um
campo desse objeto (mesmo padrão de `createNotification`); nas que recebem parâmetros posicionais
(`listFeed`, `getReviewForViewer`, `listComments`), vira um novo parâmetro posicional.

### Assinaturas resultantes

```ts
createReview(input: { authorId, content, mentionedUserIds?, gif?, image?, companyId })
listFeed(viewerId, companyId, opts)
getReviewForViewer(reviewId, viewerId, companyId)
deleteReview(input: { reviewId, userId, role, companyId })
listComments(reviewId, companyId, opts)
createComment(input: { reviewId, authorId, content, mentionedUserIds?, gif?, image?, companyId })
deleteComment(input: { commentId, userId, role, companyId })
toggleReviewReaction(input: { reviewId, userId, emoji, companyId })
toggleCommentReaction(input: { commentId, userId, emoji, companyId })
shareReview(input: { reviewId, userId, companyId })
unshareReview(input: { reviewId, userId, companyId })
```

`resolveMentions(userIds, companyId)` — ganha `companyId`, escopa
`scopedPrisma(companyId).user.findMany(...)` (fecha o gap adjacente).

### Exemplo representativo — `listFeed` (o vazamento real)

```ts
export async function listFeed(
  viewerId: string,
  companyId: string,
  opts: { cursor?: string; limit: number },
): Promise<{ items: ReviewWithRelations[]; nextCursor: string | null; sharedReviewIds: Set<string> }> {
  const decoded = opts.cursor ? decodeCursor(opts.cursor) : null
  const where: Prisma.ReviewWhereInput = {
    author: { active: true },
    ...(decoded ? { OR: [...] } : {}),
  }
  const db = scopedPrisma(companyId)
  const rows = await db.review.findMany({ where, include: reviewInclude, orderBy: [...], take: opts.limit + 1 })
  // ...hasMore/items/nextCursor iguais...
  const shares = items.length
    ? await db.reviewShare.findMany({ where: { userId: viewerId, reviewId: { in: items.map((r) => r.id) } }, select: { reviewId: true } })
    : []
  return { items, nextCursor, sharedReviewIds: new Set(shares.map((s) => s.reviewId)) }
}
```

### Exemplo representativo — `createReview` + `resolveMentions` (o gap adjacente)

```ts
async function resolveMentions(userIds: string[] | undefined, companyId: string): Promise<{ userId: string; name: string }[]> {
  if (!userIds?.length) return []
  const unique = [...new Set(userIds)].slice(0, MAX_REVIEW_MENTIONS)
  const users = await scopedPrisma(companyId).user.findMany({
    where: { id: { in: unique }, active: true, role: { notIn: ['ADMIN', 'SUBADMIN'] } },
    select: { id: true, name: true },
  })
  return users.map((u) => ({ userId: u.id, name: u.name }))
}

export async function createReview(input: {
  authorId: string
  content: string
  mentionedUserIds?: string[]
  gif?: AttachedGif
  image?: AttachedImage
  companyId: string
}): Promise<ReviewWithRelations> {
  // ...validações de conteúdo/gif/imagem iguais...
  const author = await prisma.user.findUnique({ where: { id: input.authorId } })
  if (!author || !author.active) throw new ReviewError('Autor inválido.', 400)
  const mentions = await resolveMentions(input.mentionedUserIds, input.companyId)
  return scopedPrisma(input.companyId).review.create({ data: { ... }, include: reviewInclude })
}
```

As demais 8 funções (`getReviewForViewer`, `deleteReview`, `listComments`, `createComment`,
`deleteComment`, `toggleReviewReaction`, `toggleCommentReaction`, `shareReview`, `unshareReview`)
seguem o mesmo padrão: a busca do `Review`/`ReviewComment` pai passa a usar
`scopedPrisma(companyId)` — se não encontrado no escopo, cai no `ReviewError('...não
encontrado(a).', 404)` já existente (nenhuma mensagem nova); as operações subsequentes sobre
`ReviewComment`/`ReviewReaction`/`ReviewCommentReaction`/`ReviewShare` também usam o mesmo `db`
escopado.

### `apps/api/src/routes/review.ts`

Todos os ~11 call-sites passam `request.user.companyId` como o novo argumento/campo — self-service
em todos os casos (nenhuma rota aceita um `:id` de terceiro; `:id`/`:commentId` são sempre ids de
resenha/comentário, não de usuário).

### `apps/api/src/services/mural-service.ts`

Mesma troca já aplicada a `feedback`/`moodEntry` na mesma função: a query de `reviewShare` dentro
de `getMuralItems` passa a usar `scopedPrisma(viewer.companyId)` (`viewer` já carregado na mesma
função desde a fatia de Feedback).

## Testes

- `review-service.test.ts`: adversarial pro vazamento real — `listFeed` não retorna resenha de
  outra empresa; `getReviewForViewer`/`toggleReviewReaction`/`shareReview`/`createComment`/etc. dão
  404 pra `reviewId` de outra empresa; `createReview`/`createComment` não notificam/mencionam
  usuário de outra empresa mesmo que o autor passe o id (fecha o gap de `resolveMentions`).
- `mural-service.test.ts`: adversarial — share de resenha de outra empresa não aparece no mural do
  viewer.
- Todos com fixture de 2ª empresa real, mesmo padrão das fatias anteriores.

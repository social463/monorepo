# Resenha — Design Spec

- **Data:** 2026-06-26
- **Autor:** lucca.secco
- **Status:** aprovado (brainstorming)

## Resumo

**Resenha** é um feed interno estilo Twitter/X para o time. Qualquer usuário
publica um texto curto (≤ 280 caracteres); os demais podem **reagir** (emoji),
**comentar** (comentários planos, 1 nível) e **compartilhar** a resenha no mural
do time. O histórico é exibido numa página dedicada com **scroll infinito**. O
card mostra o **avatar do autor** e os **avatares de quem reagiu**. O admin tem
**moderação**: excluir qualquer resenha/comentário inline no feed e numa página
de moderação dedicada.

A feature espelha de perto o padrão já existente de **Feedback** (reações,
moderação, serialização) e de **Notificações** (paginação por cursor, espelhamento
no Teams), maximizando consistência com o repo.

## Decisões (do brainstorming)

- **Comentários:** planos, 1 nível (sem threads aninhadas).
- **Localização:** página dedicada `/resenha` (caixa de composição no topo +
  histórico com scroll infinito).
- **Reações:** reusam os 12 emojis de `FEEDBACK_REACTIONS`, com toggle e contagem,
  tanto na resenha quanto nos comentários.
- **Compartilhar no mural:** qualquer usuário compartilha (estilo "repost"); a
  resenha passa a aparecer no carrossel do mural.
- **Edição:** não há edição — apenas exclusão (autor exclui o seu; admin exclui
  qualquer um).
- **Notificações:** autor da resenha é notificado em comentário, reação e
  compartilhamento; quem já comentou numa resenha é notificado quando alguém
  comenta depois ("te responderam num post que você comentou"); tudo espelhado no
  Teams (best-effort), sem notificar a si mesmo.
- **Moderação:** botão de excluir inline visível só para admin **+** página de
  moderação dedicada (`/admin/resenha`).
- **Limite:** 280 caracteres (resenha e comentário).
- **Paginação do feed:** por **cursor** (`createdAt|id` em base64url), robusto
  contra novos posts entrando no topo. Comentários por **offset/limit**.
- **Mural:** uma resenha compartilhada aparece **uma única vez**, ordenada pelo
  share mais recente, mesmo com vários compartilhamentos.

## Abordagem escolhida

**A — Espelhar o padrão do Feedback.** Models dedicados (`Review`,
`ReviewComment`, `ReviewReaction`, `ReviewCommentReaction`, `ReviewShare`), rotas
finas → service → Prisma, contrato em `@legends/shared`, reuso de
`summarizeReactions`, `Avatar` e `useInfiniteQuery`. Preço aceito: duas tabelas de
reação quase idênticas, em troca de cascades e queries simples.

(Descartadas: **B** modelo polimórfico `Post.parentId` + `Reaction` polimórfica —
constraints XOR que o Prisma não força bem, foge do padrão; **C** mínima sem
reação em comentários — contraria a decisão de reagir em comentários.)

## Modelo de dados (Prisma)

Arquivo: `apps/api/prisma/schema.prisma`. Migration nova via `pnpm db:migrate`
(nunca editar migrations aplicadas). Adicionar back-relations no `User`.

```prisma
model Review {
  id        String   @id @default(cuid())
  authorId  String
  content   String                       // ≤ 280, validado no Zod
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  author    User                @relation("ReviewsAuthored", fields: [authorId], references: [id], onDelete: Cascade)
  comments  ReviewComment[]
  reactions ReviewReaction[]
  shares    ReviewShare[]

  @@index([createdAt])          // feed por cursor (createdAt desc, id)
  @@index([authorId])
}

model ReviewComment {
  id        String   @id @default(cuid())
  reviewId  String
  authorId  String
  content   String
  createdAt DateTime @default(now())

  review    Review                   @relation(fields: [reviewId], references: [id], onDelete: Cascade)
  author    User                     @relation("ReviewCommentsAuthored", fields: [authorId], references: [id], onDelete: Cascade)
  reactions ReviewCommentReaction[]

  @@index([reviewId, createdAt])
  @@index([authorId])
}

model ReviewReaction {
  id        String   @id @default(cuid())
  reviewId  String
  userId    String
  emoji     String
  createdAt DateTime @default(now())

  review Review @relation(fields: [reviewId], references: [id], onDelete: Cascade)
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([reviewId, userId, emoji])
  @@index([reviewId])
}

model ReviewCommentReaction {
  id        String   @id @default(cuid())
  commentId String
  userId    String
  emoji     String
  createdAt DateTime @default(now())

  comment ReviewComment @relation(fields: [commentId], references: [id], onDelete: Cascade)
  user    User          @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([commentId, userId, emoji])
  @@index([commentId])
}

model ReviewShare {            // "repost" pro mural; toggle por usuário
  id        String   @id @default(cuid())
  reviewId  String
  userId    String
  createdAt DateTime @default(now())

  review Review @relation(fields: [reviewId], references: [id], onDelete: Cascade)
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([reviewId, userId])
  @@index([reviewId])
  @@index([createdAt])         // mural: shares dos últimos 30 dias
}
```

Enum `NotificationType` ganha: `REVIEW_COMMENT`, `REVIEW_COMMENT_REPLY`,
`REVIEW_REACTION`, `REVIEW_SHARED`.

## Contrato compartilhado (`packages/shared/src/review.ts`)

```ts
export const REVIEW_MAX_LENGTH = 280
export const REVIEW_REACTIONS = FEEDBACK_REACTIONS   // reusa os 12 emojis

// AvatarRef = subset de PublicUser para o <Avatar> renderizar
export interface AvatarRef {
  id: string
  name: string
  photoUrl: string | null
  avatarStyle: AvatarStyleKey | null
  avatarSeed: string | null
  avatarOptions: AvatarOptions | null
}

// reusa ReactionSummary { emoji, count, reactedByMe, users:{id,name}[] }

export interface ReviewDTO {
  id: string
  author: PublicUser
  content: string
  createdAt: string
  reactions: ReactionSummary[]
  reactors: AvatarRef[]        // distintos que reagiram (cap 8) p/ fileira de avatares
  reactorCount: number         // total de reactors distintos
  commentCount: number
  shareCount: number
  sharedByMe: boolean
}

export interface ReviewCommentDTO {
  id: string
  author: PublicUser
  content: string
  createdAt: string
  reactions: ReactionSummary[]
}

export interface ReviewFeedResponse { items: ReviewDTO[]; nextCursor: string | null }
export interface ReviewCommentsResponse { items: ReviewCommentDTO[]; hasMore: boolean }
```

`AvatarRef` pode ser reaproveitado de um tipo existente equivalente, se já houver
no shared; caso contrário, definido aqui. Barril `index.ts` reexporta o módulo.

## Backend (`apps/api`)

Fluxo: **route → service → Prisma**. Rotas finas, lógica no service, DTO no
serialize. Todas autenticadas (`onRequest: [app.authenticate]`), registradas em
`src/app.ts`.

### Rotas — `src/routes/review.ts`

| Método | Rota | Ação |
|---|---|---|
| GET | `/reviews?cursor&limit` | feed newest-first; cursor base64url `createdAt|id`; `limit` clamp (default 20, máx 50) |
| POST | `/reviews` | cria; Zod `content` 1–280 (trim) |
| DELETE | `/reviews/:id` | autor **ou** admin |
| POST | `/reviews/:id/reactions/toggle` | `{ emoji }` (valida emoji ∈ `REVIEW_REACTIONS`); add/remove |
| POST | `/reviews/:id/share` | compartilha no mural (idempotente) |
| DELETE | `/reviews/:id/share` | desfaz compartilhamento |
| GET | `/reviews/:id/comments?offset&limit` | comentários (offset/limit + `hasMore`) |
| POST | `/reviews/:id/comments` | cria comentário; Zod 1–280 (trim) |
| DELETE | `/reviews/comments/:commentId` | autor **ou** admin |
| POST | `/reviews/comments/:commentId/reactions/toggle` | `{ emoji }` |

Validação Zod com `safeParse` → `400 { message, issues }` em falha (padrão do repo).

### Service — `src/services/review-service.ts`

- Classe `ReviewError` com `status` HTTP (padrão `VoteError`/`FeedbackError`); a
  route faz `instanceof` e responde com `err.status`. Erros inesperados sobem.
- Funções: `listFeed`, `createReview`, `deleteReview`, `toggleReviewReaction`,
  `shareReview`, `unshareReview`, `listComments`, `createComment`,
  `deleteComment`, `toggleCommentReaction`.
- Includes Prisma: resenha carrega `author`, `reactions.user`, `_count` de
  comments/shares, e se `sharedByMe` (share do viewer). Comentário carrega
  `author`, `reactions.user`.
- `deleteReview`/`deleteComment`: permite se `authorId === viewer.id` **ou**
  `viewer.role === 'ADMIN'`, senão `ReviewError(403)`; 404 se não existir.
- Reações/comentários/shares são best-effort para notificação: a notificação
  falha logada, **não derruba** a ação principal.

### Serialização — `src/lib/serialize.ts`

- `toReviewDTO(review, viewerId)` e `toReviewCommentDTO(comment, viewerId)`,
  reusando `summarizeReactions`. `reactors` = usuários distintos que reagiram
  (deduplicados por id entre emojis), limitados a 8, com `reactorCount` total.

### Cursor do feed

Mesmo padrão de `notification-service`: encode `createdAt.toISOString() + '|' + id`
em base64url; filtro `createdAt < decoded OR (createdAt == decoded AND id < decoded.id)`;
retorna `nextCursor: string | null`.

## Notificações

`src/services/notification-service.ts`:

- `notifyReviewComment({ reviewAuthorId, actorId, reviewId })` — type
  `REVIEW_COMMENT`, para o autor da resenha.
- `notifyReviewCommentReply({ recipientIds, actorId, reviewId })` — type
  `REVIEW_COMMENT_REPLY`, para os demais participantes que já comentaram. Os
  `recipientIds` são os autores **distintos** de comentários anteriores na
  resenha, **menos** o ator e **menos** o autor da resenha (este já recebe
  `REVIEW_COMMENT`), evitando notificação duplicada.
- `notifyReviewReaction({ reviewAuthorId, actorId, reviewId, emoji })` — type
  `REVIEW_REACTION`.
- `notifyReviewShared({ reviewAuthorId, actorId, reviewId })` — type
  `REVIEW_SHARED`.

Todas com `link: '/resenha'` (ancorando a resenha, ex. `/resenha#<reviewId>`),
sem notificar a si mesmo (`actorId === destinatário` → no-op), reusando retention
(90 dias) e `mirrorToTeams` (best-effort). Disparadas só no *toggle-on* da reação
e no *share* (não no unshare). Ao comentar, o service dispara `notifyReviewComment`
(autor) **e** `notifyReviewCommentReply` (co-participantes) numa única operação.

## Mural

- `packages/shared/src/mural.ts`: novo membro do discriminated union
  `MuralReviewItem` (`type: 'review'`) com `review: ReviewDTO`-like reduzido
  (id, author, content, createdAt, reactorCount, sharers: `AvatarRef[]`).
- `src/services/mural-service.ts`: agrega resenhas com ≥ 1 share nos últimos
  30 dias, **deduplicadas** (uma vez por resenha), ordenadas pelo share mais
  recente; inclui avatares dos sharers (cap).
- `src/lib/serialize.ts`: `toMuralReviewItem`.
- `apps/web/src/components/MuralBanner.tsx`: novo `ReviewSlide` com cor própria.

## Moderação (admin)

- Reusa os endpoints `DELETE /reviews/:id` e `DELETE /reviews/comments/:commentId`
  (já aceitam admin). **Sem endpoints admin novos.**
- Página `/admin/resenha` reusa `GET /reviews` (feed) e `GET /reviews/:id/comments`,
  renderizando layout de moderação com botões de excluir. Confirmação antes de
  excluir.
- No feed normal, botões de excluir aparecem em resenhas/comentários quando o
  viewer é autor **ou** admin.

## Frontend (`apps/web`)

- Rota `/resenha` (`src/pages/ResenhaPage.tsx`) + link na navegação principal.
- Rota admin `/admin/resenha` (página de moderação), protegida por role admin.
- Componentes (`src/components/` ou `src/pages/resenha/`):
  - `ReviewComposer` — textarea + contador 280 + submit (desabilita vazio/excedido).
  - `ReviewCard` — `<Avatar>` do autor, texto, tempo relativo, barra de reações +
    fileira de avatares dos reactors (cap 8 + "+N"), toggle de comentários, botão
    compartilhar (estado `sharedByMe`), botão excluir (autor/admin).
  - `ReviewComments` — lista paginada (offset) + `ReviewCommentComposer` +
    reações por comentário; "carregar mais comentários".
  - Componente de reações reaproveitando o padrão de `FeedbackReactions`.
- Hooks React Query (`src/lib/use-reviews.ts`):
  - `useReviewFeed` — `useInfiniteQuery` por cursor + `IntersectionObserver`
    (sentinela) para scroll infinito.
  - `useCreateReview`, `useToggleReviewReaction` (otimista), `useShareReview`,
    `useReviewComments`, `useCreateComment`, `useToggleCommentReaction`,
    `useDeleteReview`, `useDeleteComment`.
- Padrão `apiFetch` / auth em memória já existente; chamadas via `/api...`.

## Testes

### API (Vitest + Postgres real — `pnpm db:up` antes)

- Criar resenha valida limite 280 (trim; vazio → 400).
- Feed pagina por cursor sem duplicar nem pular itens ao inserir novo post.
- Toggle de reação idempotente (mesmo emoji 2x volta ao estado inicial); contagem
  e `reactedByMe` corretos.
- Share/unshare alterna `sharedByMe` e `shareCount`; share é idempotente.
- Comentário/reação/share notificam o autor; **não** notificam quando o ator é o
  próprio autor.
- Comentar notifica os co-participantes (autores de comentários anteriores),
  deduplicados, **sem** notificar o ator nem duplicar com o autor da resenha.
- `DELETE` de resenha/comentário: 200 para autor, 200 para admin, 403 para
  terceiros, 404 inexistente.
- Cascade: excluir resenha apaga comentários, reações e shares.
- Resenha com ≥ 1 share aparece no mural (uma vez); sem share, não aparece.

### Web (jsdom + Testing Library)

- Composer respeita limite e desabilita submit quando vazio/excedido.
- `ReviewCard` mostra avatar do autor e fileira de reactors.
- Scroll infinito dispara `fetchNextPage` ao atingir a sentinela.
- Botão de excluir só aparece para autor/admin.

## Fora de escopo (YAGNI)

- Edição de resenha/comentário.
- Threads aninhadas (comentário de comentário).
- Menções (@), hashtags, anexos/imagens.
- Promoção automática ao mural por engajamento.
```
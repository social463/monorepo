# Multi-tenancy em Review (mural/resenha) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trazer a família `Review` (7 models: `Review`, `ReviewComment`, `ReviewReaction`,
`ReviewCommentReaction`, `ReviewShare`, `ReviewMention`, `ReviewCommentMention`) pro escopo de
multi-tenancy. Fecha o vazamento real e severo de `listFeed` (o feed principal da Resenha, hoje
100% global) e o gap adjacente de `resolveMentions` (menção cross-empresa).

**Architecture:** Migration adiciona `companyId` aos 7 models (mesmo padrão aditivo das fatias
anteriores). Cada uma das 11 funções de `review-service.ts` ganha `companyId` como novo parâmetro
— dentro do objeto de input onde já existe um, ou como parâmetro posicional novo — sempre vindo de
`request.user.companyId` nas rotas (self-service, sem query extra em nenhum call-site).

**Tech Stack:** Fastify 4, Prisma 5, PostgreSQL, Vitest.

## Global Constraints

- Base: branch `feat/multi-empresa-auth-jwt-clean` (PR #10609) — mesma onde as fatias anteriores
  de multi-tenancy foram commitadas. Trabalhar em worktree isolado.
- **Antes de rodar `prisma migrate dev` ou qualquer comando que grave no Postgres, confirme que
  `apps/api/.env`'s `DATABASE_URL` é `postgresql://legends:legends@localhost:5432/legends?schema=public`
  (Postgres local). Se for qualquer outra coisa, pare e reporte BLOCKED sem executar nada.**
- Como `ReviewComment`/`ReviewReaction`/`ReviewCommentReaction`/`ReviewShare`/`ReviewMention`/
  `ReviewCommentMention` só são criados depois de uma busca escopada do `Review`/`ReviewComment`
  pai, o invariante "linha filha tem o mesmo `companyId` do pai" se mantém naturalmente — nenhuma
  validação extra é necessária.
- `reviewHub` (`lib/review-hub.ts`) fica intocado — WebSocket pub/sub em memória cujo payload não
  carrega conteúdo de resenha (só `{type, reviewId?}`), não é vazamento de dado, fora de escopo.
- Nenhuma rota muda de assinatura de request/response — todas self-service, `request.user.companyId`
  já disponível via JWT em todas.
- Zero mudança de comportamento observável em produção — só existe uma empresa hoje.

---

### Task 1: Migration + registro em `TENANT_SCOPED_MODELS`

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `apps/api/src/lib/tenant-scope.ts`

**Interfaces:**
- Produces: `companyId: string` em `Review`, `ReviewComment`, `ReviewReaction`,
  `ReviewCommentReaction`, `ReviewShare`, `ReviewMention`, `ReviewCommentMention` — todos passam a
  estar na allowlist de `scopedPrisma`.

- [ ] **Step 1: Editar `schema.prisma`**

Modify `apps/api/prisma/schema.prisma` — em cada um dos 7 models, adicionar `companyId`, a
relação `company`, e o índice (mesmo padrão em todos):

```prisma
model Review {
  id        String   @id @default(cuid())
  authorId  String
  content   String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  gifUrl    String?
  gifWidth  Int?
  gifHeight Int?
  imageUrl    String?
  imageWidth  Int?
  imageHeight Int?
  companyId String   @default("company-emr")

  author    User            @relation("ReviewsAuthored", fields: [authorId], references: [id], onDelete: Cascade)
  comments  ReviewComment[]
  reactions ReviewReaction[]
  shares    ReviewShare[]
  mentions  ReviewMention[]
  company   Company         @relation(fields: [companyId], references: [id])

  @@index([createdAt])
  @@index([authorId])
  @@index([companyId])
}

model ReviewComment {
  id        String   @id @default(cuid())
  reviewId  String
  authorId  String
  content   String
  createdAt DateTime @default(now())
  gifUrl    String?
  gifWidth  Int?
  gifHeight Int?
  imageUrl    String?
  imageWidth  Int?
  imageHeight Int?
  companyId String   @default("company-emr")

  review    Review                  @relation(fields: [reviewId], references: [id], onDelete: Cascade)
  author    User                    @relation("ReviewCommentsAuthored", fields: [authorId], references: [id], onDelete: Cascade)
  reactions ReviewCommentReaction[]
  mentions  ReviewCommentMention[]
  company   Company                 @relation(fields: [companyId], references: [id])

  @@index([reviewId, createdAt])
  @@index([authorId])
  @@index([companyId])
}

model ReviewReaction {
  id        String   @id @default(cuid())
  reviewId  String
  userId    String
  emoji     String
  createdAt DateTime @default(now())
  companyId String   @default("company-emr")

  review  Review  @relation(fields: [reviewId], references: [id], onDelete: Cascade)
  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  company Company @relation(fields: [companyId], references: [id])

  @@unique([reviewId, userId, emoji])
  @@index([reviewId])
  @@index([companyId])
}

model ReviewCommentReaction {
  id        String   @id @default(cuid())
  commentId String
  userId    String
  emoji     String
  createdAt DateTime @default(now())
  companyId String   @default("company-emr")

  comment ReviewComment @relation(fields: [commentId], references: [id], onDelete: Cascade)
  user    User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  company Company       @relation(fields: [companyId], references: [id])

  @@unique([commentId, userId, emoji])
  @@index([commentId])
  @@index([companyId])
}

model ReviewShare {
  id        String   @id @default(cuid())
  reviewId  String
  userId    String
  createdAt DateTime @default(now())
  companyId String   @default("company-emr")

  review  Review  @relation(fields: [reviewId], references: [id], onDelete: Cascade)
  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  company Company @relation(fields: [companyId], references: [id])

  @@unique([reviewId, userId])
  @@index([reviewId])
  @@index([createdAt])
  @@index([companyId])
}

model ReviewMention {
  id        String   @id @default(cuid())
  reviewId  String
  userId    String
  name      String
  createdAt DateTime @default(now())
  companyId String   @default("company-emr")

  review  Review  @relation(fields: [reviewId], references: [id], onDelete: Cascade)
  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  company Company @relation(fields: [companyId], references: [id])

  @@unique([reviewId, userId])
  @@index([reviewId])
  @@index([companyId])
}

model ReviewCommentMention {
  id        String   @id @default(cuid())
  commentId String
  userId    String
  name      String
  createdAt DateTime @default(now())
  companyId String   @default("company-emr")

  comment ReviewComment @relation(fields: [commentId], references: [id], onDelete: Cascade)
  user    User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  company Company       @relation(fields: [companyId], references: [id])

  @@unique([commentId, userId])
  @@index([commentId])
  @@index([companyId])
}
```

No `model Company`, adicionar as 7 relações inversas (depois de `notifications Notification[]`):

```prisma
model Company {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  active    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  sectors                 Sector[]
  users                   User[]
  votingPeriods           VotingPeriod[]
  votes                   Vote[]
  squads                  Squad[]
  thirdPartyInvites       ThirdPartyInvite[]
  categories              Category[]
  badges                  Badge[]
  feedbacks               Feedback[]
  feedbackReactions       FeedbackReaction[]
  moodEntries             MoodEntry[]
  notifications           Notification[]
  reviews                 Review[]
  reviewComments          ReviewComment[]
  reviewReactions         ReviewReaction[]
  reviewCommentReactions  ReviewCommentReaction[]
  reviewShares            ReviewShare[]
  reviewMentions          ReviewMention[]
  reviewCommentMentions   ReviewCommentMention[]
}
```

- [ ] **Step 2: Gerar a migration**

Run: `pnpm db:up && pnpm --filter @legends/api exec prisma migrate dev --name add_company_to_review`
Expected: cria uma nova pasta em `apps/api/prisma/migrations/`, SQL puramente aditivo (`ALTER
TABLE ... ADD COLUMN "companyId" TEXT NOT NULL DEFAULT 'company-emr'`, `CREATE INDEX`,
`ADD CONSTRAINT ... FOREIGN KEY`, repetido pras 7 tabelas) — sem `DROP`/recreate. Se o Prisma
gerar algo diferente, pare e ajuste o schema antes de aceitar.

- [ ] **Step 3: Registrar os 7 models em `tenant-scope.ts`**

Modify `apps/api/src/lib/tenant-scope.ts`:

```ts
const TENANT_SCOPED_MODELS = new Set([
  'Sector',
  'User',
  'VotingPeriod',
  'Vote',
  'Squad',
  'ThirdPartyInvite',
  'Category',
  'Badge',
  'Feedback',
  'FeedbackReaction',
  'MoodEntry',
  'Notification',
  'Review',
  'ReviewComment',
  'ReviewReaction',
  'ReviewCommentReaction',
  'ReviewShare',
  'ReviewMention',
  'ReviewCommentMention',
])
```

- [ ] **Step 4: Rodar a suíte da API pra confirmar que nada quebrou**

Run: `pnpm --filter @legends/api test`
Expected: PASS em todos os arquivos (a migration só adiciona colunas com default). Falha
aceitável: só a flake conhecida `office-map-service.test.ts`.

- [ ] **Step 5: Rodar tsc**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/src/lib/tenant-scope.ts
git commit -m "feat: adiciona companyId à família Review (migration + allowlist)"
```

---

### Task 2: `createReview` + `resolveMentions` + `listFeed` + `getReviewForViewer`

**Files:**
- Modify: `apps/api/src/services/review-service.ts`
- Modify: `apps/api/src/services/review-service.test.ts`

**Interfaces:**
- Consumes: `scopedPrisma(companyId)` (Task 1).
- Produces:
  ```ts
  createReview(input: { authorId, content, mentionedUserIds?, gif?, image?, companyId: string }): Promise<ReviewWithRelations>
  listFeed(viewerId: string, companyId: string, opts: { cursor?, limit }): Promise<{...}>
  getReviewForViewer(reviewId: string, viewerId: string, companyId: string): Promise<{ review, sharedByMe }>
  ```
  (`resolveMentions` é privada, sem impacto pra outras tasks — só usada internamente por
  `createReview`/`createComment`.)

Este task fecha o vazamento real (`listFeed` global) e o gap adjacente (`resolveMentions` sem
escopo).

- [ ] **Step 1: Escrever os testes falhando**

Modify `apps/api/src/services/review-service.test.ts` — adicionar o import de
`DEFAULT_COMPANY_ID`:

```ts
import { DEFAULT_COMPANY_ID } from '@legends/shared'
```

Em **todas** as chamadas de `createReview({...})` no arquivo (as ~20 ocorrências, em todos os
`describe` blocks), adicionar `companyId: DEFAULT_COMPANY_ID` como novo campo do objeto de input.
Exemplo da transformação (aplicar a mesma regra em toda ocorrência):

```ts
// antes:
const review = await createReview({ authorId: u.id, content: '  Olá time!  ' })
// depois:
const review = await createReview({ authorId: u.id, content: '  Olá time!  ', companyId: DEFAULT_COMPANY_ID })
```

Nas **4** chamadas de `listFeed(viewerId, opts)`, inserir `DEFAULT_COMPANY_ID` como novo 2º
argumento:

```ts
// antes:
const page1 = await listFeed(u.id, { limit: 2 })
// depois:
const page1 = await listFeed(u.id, DEFAULT_COMPANY_ID, { limit: 2 })
```

(mesma troca nas outras 3 ocorrências, incluindo `listFeed(u.id, { cursor: page1.nextCursor!, limit: 2 })`
→ `listFeed(u.id, DEFAULT_COMPANY_ID, { cursor: page1.nextCursor!, limit: 2 })`.)

As chamadas de `createComment(...)` que aparecem no mesmo arquivo (usadas por testes de menção/gif/
imagem que também tocam este describe) **não mudam nesta task** — `createComment` ainda não aceita
`companyId` (Task 3). Isso vai gerar erros de `tsc` esperados nessas chamadas; documentado no
Step 4.

Adicionar ao final do arquivo (novo describe, testa a função ainda sem uso direto no arquivo):

```ts

describe('review-service: getReviewForViewer escopado por empresa', () => {
  it('lança erro pra resenha de outra empresa', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Review', slug: 'outra-empresa-review-test' } })
    const author = await prisma.user.create({
      data: { name: 'AutorOutraEmpresaReview', email: 'autor-outra-empresa-review@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    const review = await prisma.review.create({ data: { authorId: author.id, content: 'de outra empresa', companyId: otherCompany.id } })
    const viewer = await makeUser('viewer-review-empresa@x.com')

    await expect(getReviewForViewer(review.id, viewer.id, DEFAULT_COMPANY_ID)).rejects.toThrow()
  })
})

describe('resolveMentions escopado por empresa (via createReview)', () => {
  it('não inclui menção a usuário de outra empresa mesmo que o id seja passado', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Mencao', slug: 'outra-empresa-mencao-test' } })
    const author = await makeUser('autor-mencao-empresa@x.com')
    const outsider = await prisma.user.create({
      data: { name: 'ForaMencao', email: 'fora-mencao@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })

    const review = await createReview({
      authorId: author.id,
      content: 'tentando mencionar alguém de outra empresa',
      mentionedUserIds: [outsider.id],
      companyId: DEFAULT_COMPANY_ID,
    })

    expect(review.mentions).toHaveLength(0)
  })
})
```

Modify o import de `getReviewForViewer` — adicionar ao import existente de `./review-service`:

```ts
import { createReview, listFeed, ReviewError, createComment, deleteComment, deleteReview, listComments, toggleCommentReaction, toggleReviewReaction, shareReview, unshareReview, getReviewForViewer } from './review-service'
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @legends/api exec vitest run src/services/review-service.test.ts`
Expected: FAIL — erro de compilação (assinaturas ainda não aceitam `companyId`); os 2 novos testes
falham mesmo depois de corrigir a compilação local (o vazamento real: `getReviewForViewer` acha a
resenha de outra empresa via `findUniqueOrThrow` sem escopo; `resolveMentions` inclui o outsider).

- [ ] **Step 3: Implementar o escopo**

Modify `apps/api/src/services/review-service.ts` — adicionar o import:

```ts
import { scopedPrisma } from '../lib/tenant-scope'
```

Trocar `resolveMentions`:

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
```

Trocar `createReview`:

```ts
export async function createReview(input: {
  authorId: string
  content: string
  mentionedUserIds?: string[]
  gif?: AttachedGif
  image?: AttachedImage
  companyId: string
}): Promise<ReviewWithRelations> {
  assertSingleAttachment(input.gif, input.image)
  const content = assertContentOrAttachment(input.content, Boolean(input.gif || input.image))
  assertGifHost(input.gif)
  assertImageHost(input.image)
  const author = await prisma.user.findUnique({ where: { id: input.authorId } })
  if (!author || !author.active) {
    throw new ReviewError('Autor inválido.', 400)
  }
  const mentions = await resolveMentions(input.mentionedUserIds, input.companyId)
  return scopedPrisma(input.companyId).review.create({
    data: {
      authorId: input.authorId,
      content,
      ...(input.gif ? { gifUrl: input.gif.url, gifWidth: input.gif.width, gifHeight: input.gif.height } : {}),
      ...(input.image
        ? { imageUrl: input.image.url, imageWidth: input.image.width, imageHeight: input.image.height }
        : {}),
      ...(mentions.length
        ? { mentions: { create: mentions.map((m) => ({ userId: m.userId, name: m.name })) } }
        : {}),
    },
    include: reviewInclude,
  })
}
```

Trocar `listFeed`:

```ts
export async function listFeed(
  viewerId: string,
  companyId: string,
  opts: { cursor?: string; limit: number },
): Promise<{ items: ReviewWithRelations[]; nextCursor: string | null; sharedReviewIds: Set<string> }> {
  const decoded = opts.cursor ? decodeCursor(opts.cursor) : null
  const where: Prisma.ReviewWhereInput = {
    author: { active: true },
    ...(decoded
      ? {
          OR: [
            { createdAt: { lt: decoded.createdAt } },
            { createdAt: decoded.createdAt, id: { lt: decoded.id } },
          ],
        }
      : {}),
  }
  const db = scopedPrisma(companyId)
  const rows = await db.review.findMany({
    where,
    include: reviewInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: opts.limit + 1,
  })
  const hasMore = rows.length > opts.limit
  const items = hasMore ? rows.slice(0, opts.limit) : rows
  const nextCursor = hasMore ? encodeCursor(items[items.length - 1]) : null
  const shares = items.length
    ? await db.reviewShare.findMany({
        where: { userId: viewerId, reviewId: { in: items.map((r) => r.id) } },
        select: { reviewId: true },
      })
    : []
  return { items, nextCursor, sharedReviewIds: new Set(shares.map((s) => s.reviewId)) }
}
```

Trocar `getReviewForViewer`:

```ts
export async function getReviewForViewer(
  reviewId: string,
  viewerId: string,
  companyId: string,
): Promise<{ review: ReviewWithRelations; sharedByMe: boolean }> {
  const db = scopedPrisma(companyId)
  const review = await db.review.findUniqueOrThrow({ where: { id: reviewId }, include: reviewInclude })
  const share = await db.reviewShare.findUnique({
    where: { reviewId_userId: { reviewId, userId: viewerId } },
    select: { id: true },
  })
  return { review, sharedByMe: Boolean(share) }
}
```

(o resto do arquivo — `deleteReview`, `listComments`, `createComment`, `deleteComment`,
`toggleReviewReaction`, `toggleCommentReaction`, `shareReview`, `unshareReview` — fica inalterado
nesta task; a Task 3 cuida delas.)

- [ ] **Step 4: Rodar e confirmar que passa (com a exceção esperada)**

Run: `pnpm --filter @legends/api exec vitest run src/services/review-service.test.ts`
Expected: os testes dos describes `'review-service: createReview + listFeed'`,
`'getReviewForViewer escopado por empresa'` e `'resolveMentions escopado por empresa'` PASSAM.
Testes que também chamam `createComment` (nos describes de comentários/menções/gif/imagem) FALHAM
com erro de tipo — esperado, corrigido na Task 3.

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: erros só nas chamadas de `createComment` (ainda sem `companyId`) dentro deste mesmo
arquivo de teste, e nos call-sites de produção em `review.ts` (Task 4, ainda não despachada).
Nenhum erro dentro das 4 funções que esta task tocou.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/review-service.ts apps/api/src/services/review-service.test.ts
git commit -m "fix: escopa listFeed/getReviewForViewer/createReview/resolveMentions por empresa"
```

---

### Task 3: `deleteReview`, `listComments`, `createComment`, `deleteComment`, `toggleReviewReaction`, `toggleCommentReaction`, `shareReview`, `unshareReview`

**Files:**
- Modify: `apps/api/src/services/review-service.ts`
- Modify: `apps/api/src/services/review-service.test.ts`

**Interfaces:**
- Consumes: `scopedPrisma(companyId)` (Task 1), `resolveMentions(userIds, companyId)` (Task 2).
- Produces:
  ```ts
  deleteReview(input: { reviewId, userId, role, companyId: string }): Promise<void>
  listComments(reviewId: string, companyId: string, opts: { offset, limit }): Promise<ReviewCommentWithRelations[]>
  createComment(input: { reviewId, authorId, content, mentionedUserIds?, gif?, image?, companyId: string }): Promise<{...}>
  deleteComment(input: { commentId, userId, role, companyId: string }): Promise<{ reviewId }>
  toggleReviewReaction(input: { reviewId, userId, emoji, companyId: string }): Promise<{...}>
  toggleCommentReaction(input: { commentId, userId, emoji, companyId: string }): Promise<{ comment }>
  shareReview(input: { reviewId, userId, companyId: string }): Promise<{ reviewAuthorId, created }>
  unshareReview(input: { reviewId, userId, companyId: string }): Promise<void>
  ```

- [ ] **Step 1: Atualizar os call-sites de teste existentes**

Modify `apps/api/src/services/review-service.test.ts` — em **todas** as chamadas das 8 funções
acima (`deleteReview`, `listComments`, `createComment`, `deleteComment`, `toggleReviewReaction`,
`toggleCommentReaction`, `shareReview`, `unshareReview`), adicionar `companyId: DEFAULT_COMPANY_ID`
como novo campo do objeto de input (ou, no caso de `listComments`, como novo 2º argumento
posicional). Exemplos da transformação (aplicar a mesma regra em toda ocorrência de cada função):

```ts
// deleteReview — antes:
await deleteReview({ reviewId: review.id, userId: stranger.id, role: 'LEGEND' })
// depois:
await deleteReview({ reviewId: review.id, userId: stranger.id, role: 'LEGEND', companyId: DEFAULT_COMPANY_ID })

// listComments — antes:
const rows = await listComments(review.id, { offset: 0, limit: 2 })
// depois:
const rows = await listComments(review.id, DEFAULT_COMPANY_ID, { offset: 0, limit: 2 })

// createComment — antes:
const first = await createComment({ reviewId: review.id, authorId: p1.id, content: 'oi' })
// depois:
const first = await createComment({ reviewId: review.id, authorId: p1.id, content: 'oi', companyId: DEFAULT_COMPANY_ID })

// deleteComment — antes:
await deleteComment({ commentId: c.comment.id, userId: 'someone', role: 'ADMIN' })
// depois:
await deleteComment({ commentId: c.comment.id, userId: 'someone', role: 'ADMIN', companyId: DEFAULT_COMPANY_ID })

// toggleReviewReaction — antes:
const add = await toggleReviewReaction({ reviewId: review.id, userId: u.id, emoji: '😂' })
// depois:
const add = await toggleReviewReaction({ reviewId: review.id, userId: u.id, emoji: '😂', companyId: DEFAULT_COMPANY_ID })

// toggleCommentReaction — antes:
const res = await toggleCommentReaction({ commentId: comment.id, userId: u.id, emoji: '😂' })
// depois:
const res = await toggleCommentReaction({ commentId: comment.id, userId: u.id, emoji: '😂', companyId: DEFAULT_COMPANY_ID })

// shareReview — antes:
const first = await shareReview({ reviewId: review.id, userId: sharer.id })
// depois:
const first = await shareReview({ reviewId: review.id, userId: sharer.id, companyId: DEFAULT_COMPANY_ID })

// unshareReview — antes:
await unshareReview({ reviewId: review.id, userId: sharer.id })
// depois:
await unshareReview({ reviewId: review.id, userId: sharer.id, companyId: DEFAULT_COMPANY_ID })
```

Adicionar ao final do arquivo:

```ts

describe('mutações de resenha escopadas por empresa', () => {
  it('deleteReview/toggleReviewReaction/shareReview/createComment tratam resenha de outra empresa como inexistente (404)', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Review Mutacao', slug: 'outra-empresa-review-mutacao-test' } })
    const author = await prisma.user.create({
      data: { name: 'AutorOutraEmpresaMutacao', email: 'autor-outra-empresa-mutacao@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    const review = await prisma.review.create({ data: { authorId: author.id, content: 'de outra empresa', companyId: otherCompany.id } })
    const actor = await makeUser('ator-mutacao-empresa@x.com')

    await expect(
      deleteReview({ reviewId: review.id, userId: actor.id, role: 'ADMIN', companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      toggleReviewReaction({ reviewId: review.id, userId: actor.id, emoji: '😂', companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      shareReview({ reviewId: review.id, userId: actor.id, companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      createComment({ reviewId: review.id, authorId: actor.id, content: 'comentário', companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 404 })
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @legends/api exec vitest run src/services/review-service.test.ts`
Expected: FAIL — erro de compilação (assinaturas ainda não aceitam `companyId`); o novo teste
falha depois de corrigir a compilação local (as 4 mutações hoje têm sucesso contra a resenha de
outra empresa).

- [ ] **Step 3: Implementar o escopo nas 8 funções**

Modify `apps/api/src/services/review-service.ts` — trocar `deleteReview`:

```ts
export async function deleteReview(input: { reviewId: string; userId: string; role: string; companyId: string }): Promise<void> {
  const db = scopedPrisma(input.companyId)
  const existing = await db.review.findUnique({ where: { id: input.reviewId }, select: { authorId: true } })
  if (!existing) throw new ReviewError('Resenha não encontrada.', 404)
  if (existing.authorId !== input.userId && input.role !== 'ADMIN' && input.role !== 'SUBADMIN') {
    throw new ReviewError('Sem permissão para excluir esta resenha.', 403)
  }
  await db.review.delete({ where: { id: input.reviewId } })
}
```

Trocar `listComments`:

```ts
export async function listComments(
  reviewId: string,
  companyId: string,
  opts: { offset: number; limit: number },
): Promise<ReviewCommentWithRelations[]> {
  const db = scopedPrisma(companyId)
  const review = await db.review.findUnique({ where: { id: reviewId }, select: { id: true } })
  if (!review) throw new ReviewError('Resenha não encontrada.', 404)
  return db.reviewComment.findMany({
    where: { reviewId },
    include: reviewCommentInclude,
    orderBy: { createdAt: 'asc' },
    skip: opts.offset,
    take: opts.limit + 1,
  })
}
```

Trocar `createComment`:

```ts
export async function createComment(input: {
  reviewId: string
  authorId: string
  content: string
  mentionedUserIds?: string[]
  gif?: AttachedGif
  image?: AttachedImage
  companyId: string
}): Promise<{ comment: ReviewCommentWithRelations; reviewAuthorId: string; replyRecipientIds: string[] }> {
  assertSingleAttachment(input.gif, input.image)
  const content = assertContentOrAttachment(input.content, Boolean(input.gif || input.image))
  assertGifHost(input.gif)
  assertImageHost(input.image)
  const db = scopedPrisma(input.companyId)
  const review = await db.review.findUnique({ where: { id: input.reviewId }, select: { authorId: true } })
  if (!review) throw new ReviewError('Resenha não encontrada.', 404)
  const prior = await db.reviewComment.findMany({
    where: { reviewId: input.reviewId },
    select: { authorId: true },
    distinct: ['authorId'],
  })
  const mentions = await resolveMentions(input.mentionedUserIds, input.companyId)
  const comment = await db.reviewComment.create({
    data: {
      reviewId: input.reviewId,
      authorId: input.authorId,
      content,
      ...(input.gif ? { gifUrl: input.gif.url, gifWidth: input.gif.width, gifHeight: input.gif.height } : {}),
      ...(input.image
        ? { imageUrl: input.image.url, imageWidth: input.image.width, imageHeight: input.image.height }
        : {}),
      ...(mentions.length
        ? { mentions: { create: mentions.map((m) => ({ userId: m.userId, name: m.name })) } }
        : {}),
    },
    include: reviewCommentInclude,
  })
  const replyRecipientIds = [...new Set(prior.map((c) => c.authorId))].filter(
    (id) => id !== input.authorId && id !== review.authorId,
  )
  return { comment, reviewAuthorId: review.authorId, replyRecipientIds }
}
```

Trocar `deleteComment`:

```ts
export async function deleteComment(input: {
  commentId: string
  userId: string
  role: string
  companyId: string
}): Promise<{ reviewId: string }> {
  const db = scopedPrisma(input.companyId)
  const existing = await db.reviewComment.findUnique({
    where: { id: input.commentId },
    select: { authorId: true, reviewId: true },
  })
  if (!existing) throw new ReviewError('Comentário não encontrado.', 404)
  if (existing.authorId !== input.userId && input.role !== 'ADMIN' && input.role !== 'SUBADMIN') {
    throw new ReviewError('Sem permissão para excluir este comentário.', 403)
  }
  await db.reviewComment.delete({ where: { id: input.commentId } })
  return { reviewId: existing.reviewId }
}
```

Trocar `toggleReviewReaction`:

```ts
export async function toggleReviewReaction(input: {
  reviewId: string
  userId: string
  emoji: string
  companyId: string
}): Promise<{ review: ReviewWithRelations; added: boolean; reviewAuthorId: string; sharedByMe: boolean }> {
  assertEmoji(input.emoji)
  const db = scopedPrisma(input.companyId)
  const review = await db.review.findUnique({ where: { id: input.reviewId }, select: { authorId: true } })
  if (!review) throw new ReviewError('Resenha não encontrada.', 404)
  const existing = await db.reviewReaction.findUnique({
    where: { reviewId_userId_emoji: { reviewId: input.reviewId, userId: input.userId, emoji: input.emoji } },
  })
  let added: boolean
  if (existing) {
    await db.reviewReaction.delete({ where: { id: existing.id } })
    added = false
  } else {
    await db.reviewReaction.create({
      data: { reviewId: input.reviewId, userId: input.userId, emoji: input.emoji },
    })
    added = true
  }
  const full = await db.review.findUniqueOrThrow({ where: { id: input.reviewId }, include: reviewInclude })
  const share = await db.reviewShare.findUnique({
    where: { reviewId_userId: { reviewId: input.reviewId, userId: input.userId } },
    select: { id: true },
  })
  return { review: full, added, reviewAuthorId: review.authorId, sharedByMe: Boolean(share) }
}
```

Trocar `toggleCommentReaction`:

```ts
export async function toggleCommentReaction(input: {
  commentId: string
  userId: string
  emoji: string
  companyId: string
}): Promise<{ comment: ReviewCommentWithRelations }> {
  assertEmoji(input.emoji)
  const db = scopedPrisma(input.companyId)
  const comment = await db.reviewComment.findUnique({ where: { id: input.commentId }, select: { id: true } })
  if (!comment) throw new ReviewError('Comentário não encontrado.', 404)
  const existing = await db.reviewCommentReaction.findUnique({
    where: { commentId_userId_emoji: { commentId: input.commentId, userId: input.userId, emoji: input.emoji } },
  })
  if (existing) {
    await db.reviewCommentReaction.delete({ where: { id: existing.id } })
  } else {
    await db.reviewCommentReaction.create({
      data: { commentId: input.commentId, userId: input.userId, emoji: input.emoji },
    })
  }
  const full = await db.reviewComment.findUniqueOrThrow({
    where: { id: input.commentId },
    include: reviewCommentInclude,
  })
  return { comment: full }
}
```

Trocar `shareReview`:

```ts
export async function shareReview(input: {
  reviewId: string
  userId: string
  companyId: string
}): Promise<{ reviewAuthorId: string; created: boolean }> {
  const db = scopedPrisma(input.companyId)
  const review = await db.review.findUnique({ where: { id: input.reviewId }, select: { authorId: true } })
  if (!review) throw new ReviewError('Resenha não encontrada.', 404)
  const existing = await db.reviewShare.findUnique({
    where: { reviewId_userId: { reviewId: input.reviewId, userId: input.userId } },
  })
  if (existing) return { reviewAuthorId: review.authorId, created: false }
  await db.reviewShare.create({ data: { reviewId: input.reviewId, userId: input.userId } })
  return { reviewAuthorId: review.authorId, created: true }
}
```

Trocar `unshareReview`:

```ts
export async function unshareReview(input: { reviewId: string; userId: string; companyId: string }): Promise<void> {
  await scopedPrisma(input.companyId).reviewShare.deleteMany({ where: { reviewId: input.reviewId, userId: input.userId } })
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm --filter @legends/api exec vitest run src/services/review-service.test.ts`
Expected: PASS (todos os testes, incluindo os novos)

- [ ] **Step 5: Rodar tsc**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: erros só nos call-sites de produção em `review.ts` (Task 4, ainda não despachada).
Nenhum erro dentro de `review-service.ts` ou `review-service.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/review-service.ts apps/api/src/services/review-service.test.ts
git commit -m "feat: escopa deleteReview/listComments/createComment/deleteComment/toggleReviewReaction/toggleCommentReaction/shareReview/unshareReview por empresa"
```

---

### Task 4: wire — rota `review.ts`

**Files:**
- Modify: `apps/api/src/routes/review.ts`
- Modify: `apps/api/src/routes/review.test.ts`

**Interfaces:**
- Consumes: as novas assinaturas de `review-service.ts` (Tasks 2-3). Nenhuma rota muda de
  assinatura de request/response — só passa a repassar `companyId` (sempre
  `request.user.companyId`).

- [ ] **Step 1: Escrever o teste falhando (HTTP-level, garante o vazamento fechado ponta a ponta)**

Adicionar ao final do `describe('review routes', ...)` em `apps/api/src/routes/review.test.ts`
(antes do `})` que fecha o describe):

```ts

  it('GET /reviews não mostra resenha de outra empresa', async () => {
    const { app, token } = await setup()
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Review Rota', slug: 'outra-empresa-review-rota-test' } })
    const outsider = await prisma.user.create({
      data: { name: 'ForaReviewRota', email: 'fora-review-rota@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    await prisma.review.create({ data: { authorId: outsider.id, content: 'de outra empresa', companyId: otherCompany.id } })

    const res = await app.inject({ method: 'GET', url: '/reviews', headers: auth(token) })
    expect(res.statusCode).toBe(200)
    expect(res.json().items).toHaveLength(0)
    await app.close()
  })
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @legends/api exec vitest run src/routes/review.test.ts`
Expected: FAIL — erro de compilação (`review.ts` ainda chama as funções de serviço sem
`companyId`); depois de corrigir a compilação localmente pra rodar, o novo teste falharia mostrando
o vazamento (a resenha de outra empresa aparece no feed).

- [ ] **Step 3: Atualizar `review.ts`**

Modify `apps/api/src/routes/review.ts` — arquivo inteiro:

```ts
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { REVIEW_MAX_LENGTH, REVIEW_REACTIONS, MAX_REVIEW_MENTIONS } from '@legends/shared'
import {
  ReviewError,
  createComment,
  createReview,
  deleteComment,
  deleteReview,
  getReviewForViewer,
  listComments,
  listFeed,
  shareReview,
  toggleCommentReaction,
  toggleReviewReaction,
  unshareReview,
} from '../services/review-service'
import {
  notifyReviewComment,
  notifyReviewCommentReply,
  notifyReviewMention,
  notifyReviewReaction,
  notifyReviewShared,
} from '../services/notification-service'
import { toReviewCommentDTO, toReviewDTO } from '../lib/serialize'
import { reviewHub } from '../lib/review-hub'

/** Limite do feed: default 20, mínimo 1, máximo 50. */
function clampLimit(raw: string | undefined, fallback = 20): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(Math.floor(n), 50)
}

const gifSchema = z.object({
  url: z.string().url(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
})
const imageSchema = z.object({
  url: z.string().url(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
})
const contentSchema = z
  .object({
    content: z.string().trim().max(REVIEW_MAX_LENGTH).optional().default(''),
    mentionedUserIds: z.array(z.string()).max(MAX_REVIEW_MENTIONS).optional(),
    gif: gifSchema.optional(),
    image: imageSchema.optional(),
  })
  .refine((v) => v.content.trim().length >= 1 || v.gif || v.image, {
    message: 'Escreva algo ou anexe um GIF ou imagem.',
  })
const reactionSchema = z.object({ emoji: z.enum(REVIEW_REACTIONS) })
const invalidContent = { message: `Escreva algo (até ${REVIEW_MAX_LENGTH} caracteres) ou anexe um GIF ou imagem.` }

export async function reviewRoutes(app: FastifyInstance) {
  app.get('/reviews', { onRequest: [app.authenticate, app.requireFeature('resenha')] }, async (request, reply) => {
    const query = request.query as { cursor?: string; limit?: string }
    try {
      const { items, nextCursor, sharedReviewIds } = await listFeed(request.user.sub, request.user.companyId, {
        cursor: query.cursor,
        limit: clampLimit(query.limit),
      })
      return reply.send({
        items: items.map((r) => toReviewDTO(r, request.user.sub, sharedReviewIds.has(r.id))),
        nextCursor,
      })
    } catch (err) {
      if (err instanceof ReviewError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/reviews', { onRequest: [app.authenticate, app.requireFeature('resenha')] }, async (request, reply) => {
    const parsed = contentSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...invalidContent, issues: parsed.error.flatten() })
    try {
      const review = await createReview({
        authorId: request.user.sub,
        content: parsed.data.content,
        mentionedUserIds: parsed.data.mentionedUserIds,
        gif: parsed.data.gif,
        image: parsed.data.image,
        companyId: request.user.companyId,
      })
      try {
        await notifyReviewMention({
          recipientIds: review.mentions.map((m) => m.userId),
          actorId: request.user.sub,
          reviewId: review.id,
        }, request.user.companyId)
      } catch (notifyErr) {
        request.log.error(notifyErr)
      }
      reviewHub.broadcast({ type: 'feed:changed' })
      return reply.code(201).send({ review: toReviewDTO(review, request.user.sub, false) })
    } catch (err) {
      if (err instanceof ReviewError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/reviews/:id', { onRequest: [app.authenticate, app.requireFeature('resenha')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      await deleteReview({ reviewId: id, userId: request.user.sub, role: request.user.role, companyId: request.user.companyId })
      reviewHub.broadcast({ type: 'feed:changed' })
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof ReviewError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/reviews/:id/reactions/toggle', { onRequest: [app.authenticate, app.requireFeature('resenha')] }, async (request, reply) => {
    const parsed = reactionSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Reação inválida.', issues: parsed.error.flatten() })
    const { id } = request.params as { id: string }
    try {
      const { review, added, reviewAuthorId, sharedByMe } = await toggleReviewReaction({
        reviewId: id,
        userId: request.user.sub,
        emoji: parsed.data.emoji,
        companyId: request.user.companyId,
      })
      if (added) {
        try {
          await notifyReviewReaction({ reviewAuthorId, actorId: request.user.sub, reviewId: id }, request.user.companyId)
        } catch (notifyErr) {
          request.log.error(notifyErr)
        }
      }
      reviewHub.broadcast({ type: 'review:changed', reviewId: id })
      return reply.send({ review: toReviewDTO(review, request.user.sub, sharedByMe) })
    } catch (err) {
      if (err instanceof ReviewError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/reviews/:id/share', { onRequest: [app.authenticate, app.requireFeature('resenha')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const { reviewAuthorId, created } = await shareReview({ reviewId: id, userId: request.user.sub, companyId: request.user.companyId })
      if (created) {
        try {
          await notifyReviewShared({ reviewAuthorId, actorId: request.user.sub, reviewId: id }, request.user.companyId)
        } catch (notifyErr) {
          request.log.error(notifyErr)
        }
      }
      const { review, sharedByMe } = await getReviewForViewer(id, request.user.sub, request.user.companyId)
      reviewHub.broadcast({ type: 'review:changed', reviewId: id })
      return reply.send({ review: toReviewDTO(review, request.user.sub, sharedByMe) })
    } catch (err) {
      if (err instanceof ReviewError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/reviews/:id/share', { onRequest: [app.authenticate, app.requireFeature('resenha')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      await unshareReview({ reviewId: id, userId: request.user.sub, companyId: request.user.companyId })
      const { review, sharedByMe } = await getReviewForViewer(id, request.user.sub, request.user.companyId)
      reviewHub.broadcast({ type: 'review:changed', reviewId: id })
      return reply.send({ review: toReviewDTO(review, request.user.sub, sharedByMe) })
    } catch (err) {
      if (err instanceof ReviewError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.get('/reviews/:id/comments', { onRequest: [app.authenticate, app.requireFeature('resenha')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const query = request.query as { offset?: string; limit?: string }
    const limit = clampLimit(query.limit, 10)
    const offset = Math.max(0, Number(query.offset) || 0)
    try {
      const rows = await listComments(id, request.user.companyId, { offset, limit })
      const hasMore = rows.length > limit
      const page = hasMore ? rows.slice(0, limit) : rows
      return reply.send({ items: page.map((c) => toReviewCommentDTO(c, request.user.sub)), hasMore })
    } catch (err) {
      if (err instanceof ReviewError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/reviews/:id/comments', { onRequest: [app.authenticate, app.requireFeature('resenha')] }, async (request, reply) => {
    const parsed = contentSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...invalidContent, issues: parsed.error.flatten() })
    const { id } = request.params as { id: string }
    try {
      const { comment, reviewAuthorId, replyRecipientIds } = await createComment({
        reviewId: id,
        authorId: request.user.sub,
        content: parsed.data.content,
        mentionedUserIds: parsed.data.mentionedUserIds,
        gif: parsed.data.gif,
        image: parsed.data.image,
        companyId: request.user.companyId,
      })
      try {
        await notifyReviewComment({ reviewAuthorId, actorId: request.user.sub, reviewId: id }, request.user.companyId)
      } catch (notifyErr) {
        request.log.error(notifyErr)
      }
      try {
        await notifyReviewCommentReply({ recipientIds: replyRecipientIds, actorId: request.user.sub, reviewId: id }, request.user.companyId)
      } catch (notifyErr) {
        request.log.error(notifyErr)
      }
      try {
        await notifyReviewMention({
          recipientIds: comment.mentions.map((m) => m.userId),
          actorId: request.user.sub,
          reviewId: id,
        }, request.user.companyId)
      } catch (notifyErr) {
        request.log.error(notifyErr)
      }
      reviewHub.broadcast({ type: 'comments:changed', reviewId: id })
      return reply.code(201).send({ comment: toReviewCommentDTO(comment, request.user.sub) })
    } catch (err) {
      if (err instanceof ReviewError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/reviews/comments/:commentId', { onRequest: [app.authenticate, app.requireFeature('resenha')] }, async (request, reply) => {
    const { commentId } = request.params as { commentId: string }
    try {
      const { reviewId } = await deleteComment({ commentId, userId: request.user.sub, role: request.user.role, companyId: request.user.companyId })
      reviewHub.broadcast({ type: 'comments:changed', reviewId })
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof ReviewError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post(
    '/reviews/comments/:commentId/reactions/toggle',
    { onRequest: [app.authenticate, app.requireFeature('resenha')] },
    async (request, reply) => {
      const parsed = reactionSchema.safeParse(request.body)
      if (!parsed.success) return reply.code(400).send({ message: 'Reação inválida.', issues: parsed.error.flatten() })
      const { commentId } = request.params as { commentId: string }
      try {
        const { comment } = await toggleCommentReaction({
          commentId,
          userId: request.user.sub,
          emoji: parsed.data.emoji,
          companyId: request.user.companyId,
        })
        reviewHub.broadcast({ type: 'comments:changed', reviewId: comment.reviewId })
        return reply.send({ comment: toReviewCommentDTO(comment, request.user.sub) })
      } catch (err) {
        if (err instanceof ReviewError) return reply.code(err.status).send({ message: err.message })
        throw err
      }
    },
  )
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm --filter @legends/api exec vitest run src/routes/review.test.ts`
Expected: PASS (todos os testes, incluindo o novo)

- [ ] **Step 5: Rodar a suíte completa da API e typecheck**

Run: `pnpm --filter @legends/api test && pnpm --filter @legends/api exec tsc --noEmit`
Expected: PASS / erros só na Task 5 restante (`mural-service.ts`).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/review.ts apps/api/src/routes/review.test.ts
git commit -m "feat: repassa companyId nos call-sites de rota de review-service"
```

---

### Task 5: query de `reviewShare` em `getMuralItems` (`mural-service.ts`)

**Files:**
- Modify: `apps/api/src/services/mural-service.ts`
- Modify: `apps/api/src/services/mural-service.test.ts`

**Interfaces:**
- Consumes: `scopedPrisma(companyId)` (Task 1). `viewer` já é carregado em `getMuralItems` desde a
  fatia de Feedback (`prisma.user.findUniqueOrThrow`).
- Produces: `getMuralItems(viewerId, now?)` mantém a assinatura.

- [ ] **Step 1: Escrever o teste falhando**

Adicionar ao final do `describe('getMuralItems', ...)` em
`apps/api/src/services/mural-service.test.ts` (o arquivo já importa `prisma`, `getMuralItems` —
reuse eles):

```ts

  it('não mostra resenha compartilhada de outra empresa', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Mural Review', slug: 'outra-empresa-mural-review-test' } })
    const authorOutraEmpresa = await prisma.user.create({
      data: { name: 'AutorOutraEmpresaMuralReview', email: 'autor-outra-empresa-mural-review@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    const sharerOutraEmpresa = await prisma.user.create({
      data: { name: 'SharerOutraEmpresaMuralReview', email: 'sharer-outra-empresa-mural-review@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    const review = await prisma.review.create({
      data: { authorId: authorOutraEmpresa.id, content: 'resenha de outra empresa', companyId: otherCompany.id },
    })
    await prisma.reviewShare.create({
      data: { reviewId: review.id, userId: sharerOutraEmpresa.id, companyId: otherCompany.id },
    })
    const viewer = await prisma.user.create({ data: { name: 'ViewerEmpresaPadraoMuralReview', email: 'viewer-empresa-padrao-mural-review@x.com', passwordHash: 'x' } })
    const items = await getMuralItems(viewer.id)
    expect(items.filter((i) => i.type === 'review')).toHaveLength(0)
  })
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @legends/api exec vitest run src/services/mural-service.test.ts`
Expected: FAIL — o novo teste falha (a resenha compartilhada de outra empresa aparece no mural do
viewer); os demais testes continuam passando.

- [ ] **Step 3: Implementar o escopo**

Modify `apps/api/src/services/mural-service.ts` — trocar só a query de `reviewShare` dentro do
`Promise.all` de `getMuralItems` (o resto da função — `feedback`/`moodEntry` já escopados,
`userBadge`, agregação, ordenação — fica igual):

```ts
    scopedPrisma(viewer.companyId).reviewShare.findMany({
      where: { createdAt: { gte: since }, review: { author: { active: true } } },
      include: { user: true, review: { include: reviewInclude } },
      orderBy: { createdAt: 'desc' },
    }),
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm --filter @legends/api exec vitest run src/services/mural-service.test.ts`
Expected: PASS (todos os testes, incluindo o novo)

- [ ] **Step 5: Rodar a suíte completa da API e typecheck**

Run: `pnpm --filter @legends/api test && pnpm --filter @legends/api exec tsc --noEmit`
Expected: PASS / sem erros (última task de código desta fatia).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/mural-service.ts apps/api/src/services/mural-service.test.ts
git commit -m "fix: escopa query de reviewShare em getMuralItems por empresa"
```

---

### Task 6: Verificação final

**Files:** nenhum (só execução de comandos)

- [ ] **Step 1: Suíte completa de todos os workspaces**

Run: `pnpm test`
Expected: PASS em `@legends/shared`, `@legends/api`, `@legends/web`. As únicas falhas aceitáveis
são as duas flakes pré-existentes e não-relacionadas já documentadas nas fatias anteriores:
`apps/web/src/App.third-party-route.test.tsx` e `apps/api/src/services/office-map-service.test.ts`
(colisão de email por `Date.now()`). Qualquer outra falha precisa ser investigada antes de
prosseguir.

- [ ] **Step 2: Typecheck por workspace**

Run:
```bash
pnpm --filter @legends/api exec tsc --noEmit
pnpm --filter @legends/web exec tsc --noEmit
pnpm --filter @legends/shared exec tsc --noEmit
```
Expected: sem erros nos 3 workspaces.

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: sucesso em todos os workspaces.

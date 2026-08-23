# Visualização de features por setor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir vazamentos de UX/dado entre setores: Resenha, Mural do time e Lista de time
passam a ser sectorizados; a Home para de tratar "feature desligada" como erro; e a UI de
votação/reconhecimento (Home e ProfilePage) some quando `votar` está desligada para o setor.

**Architecture:** Sem migration — `User.sectorId` já existe (obrigatório) e todo request
autenticado já carrega `request.user.sectorId` (JWT). A sectorização de dado é feita via relation
filter no Prisma (`author: { sectorId }`, `user: { sectorId }` etc.), o mesmo padrão que
`GET /users/showcase` já usa. Ids de outro setor viram 404 "não encontrado", igual a um id
inexistente. No frontend, um helper único (`effectiveFeatures`) decide o set de features
habilitadas e substitui os `{!isLead && (...)}` / renderizações incondicionais que hoje ignoram o
toggle de feature.

**Tech Stack:** Fastify 4, Prisma 5, PostgreSQL, Vitest, React 18, TypeScript strict/ESM.

## Global Constraints

- `pnpm db:up` precisa estar de pé antes de rodar testes da API (Postgres real,
  `fileParallelism: false`).
- Mensagens ao usuário em pt-BR; identificadores em inglês.
- Sem migration nesta feature — se algum passo parecer exigir uma, pare e reavalie (é sinal de
  desvio da spec).
- Rode só o(s) arquivo(s) de teste alterado(s) durante a implementação; `pnpm test` completo só
  entra como verificação final (Task 9).
- Nunca edite uma migration já aplicada.

---

### Task 1: Extrair `sectorFeaturesFor` para um lib compartilhável

**Files:**
- Create: `apps/api/src/lib/sector-features.ts`
- Modify: `apps/api/src/routes/auth.ts:26-29` (remove a função local, importa do lib)
- Test: `apps/api/src/lib/sector-features.test.ts`

**Interfaces:**
- Produces: `sectorFeaturesFor(sectorId: string): Promise<string[]>` — usada pela Task 6
  (`ProfileDTO.votingEnabled`) e por `auth.ts` (comportamento inalterado).

- [ ] **Step 1: Escrever o teste (falhando)**

Create `apps/api/src/lib/sector-features.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { prisma } from './prisma'
import { sectorFeaturesFor } from './sector-features'

describe('sectorFeaturesFor', () => {
  it('retorna as features habilitadas do setor', async () => {
    const features = await sectorFeaturesFor('sector-dev-produto')
    expect(features).toContain('votar')
    expect(features).toContain('resenha')
  })

  it('retorna [] para setor inexistente', async () => {
    const features = await sectorFeaturesFor('setor-que-nao-existe')
    expect(features).toEqual([])
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @legends/api exec vitest run src/lib/sector-features.test.ts`
Expected: FAIL — `Cannot find module './sector-features'`

- [ ] **Step 3: Criar o lib**

Create `apps/api/src/lib/sector-features.ts`:

```ts
import { prisma } from './prisma'

/** Features habilitadas para o setor (via `Sector.enabledFeatures`); [] se o setor não existir. */
export async function sectorFeaturesFor(sectorId: string): Promise<string[]> {
  const sector = await prisma.sector.findUnique({ where: { id: sectorId } })
  return Array.isArray(sector?.enabledFeatures) ? (sector.enabledFeatures as string[]) : []
}
```

- [ ] **Step 4: Atualizar `auth.ts` para importar do lib**

Modify `apps/api/src/routes/auth.ts`:

```ts
// Remover (linhas 26-29):
async function sectorFeaturesFor(sectorId: string): Promise<string[]> {
  const sector = await prisma.sector.findUnique({ where: { id: sectorId } })
  return Array.isArray(sector?.enabledFeatures) ? (sector.enabledFeatures as string[]) : []
}
```

```ts
// Adicionar ao bloco de imports do topo do arquivo:
import { sectorFeaturesFor } from '../lib/sector-features'
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/api exec vitest run src/lib/sector-features.test.ts apps/api/src/routes/auth.test.ts`
Expected: PASS (se `auth.test.ts` não existir com esse nome exato, rode
`pnpm --filter @legends/api exec vitest run src/routes/auth`)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/lib/sector-features.ts apps/api/src/lib/sector-features.test.ts apps/api/src/routes/auth.ts
git commit -m "refactor(api): extrai sectorFeaturesFor para lib compartilhado"
```

---

### Task 2: Sectorizar `review-service.ts` (Resenha)

**Files:**
- Modify: `apps/api/src/services/review-service.ts`
- Test: `apps/api/src/services/review-service.test.ts` (reescrita completa — todo call site ganha
  um `sectorId`/`viewerSectorId`)

**Interfaces:**
- Consumes: `createSector` de `../services/sector-service` (já existe, usado por
  `apps/api/src/routes/users.test.ts:135` — assinatura
  `createSector(input: { name; enabledFeatures: string[]; roles: UserRole[] }, actorId: string, companyId: string)`),
  `DEFAULT_COMPANY_ID` de `@legends/shared`.
- Produces (novas assinaturas, consumidas pela Task 3):
  - `listFeed(viewerId: string, viewerSectorId: string, opts: { cursor?: string; limit: number })`
  - `getReviewForViewer(reviewId: string, viewerId: string, viewerSectorId: string)`
  - `deleteReview(input: { reviewId: string; userId: string; role: string; sectorId: string })`
  - `listComments(reviewId: string, viewerSectorId: string, opts: { offset: number; limit: number })`
  - `createComment(input: { reviewId: string; authorId: string; viewerSectorId: string; content: string; mentionedUserIds?: string[]; gif?: AttachedGif; image?: AttachedImage })`
  - `deleteComment(input: { commentId: string; userId: string; role: string; sectorId: string })`
  - `toggleReviewReaction(input: { reviewId: string; userId: string; emoji: string; sectorId: string })`
  - `toggleCommentReaction(input: { commentId: string; userId: string; emoji: string; sectorId: string })`
  - `shareReview(input: { reviewId: string; userId: string; sectorId: string })`
  - `createReview` e `unshareReview` **não mudam de assinatura**.

- [ ] **Step 1: Reescrever `review-service.test.ts` com os novos parâmetros (falhando)**

Substituir o conteúdo de `apps/api/src/services/review-service.test.ts` por:

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { createSector } from './sector-service'
import { createReview, listFeed, ReviewError, createComment, deleteComment, deleteReview, listComments, toggleCommentReaction, toggleReviewReaction, shareReview, unshareReview, getReviewForViewer } from './review-service'
import { isGiphyHost } from '@legends/shared'

// s3Config() só resolve com bucket+region+publicBaseUrl definidos (ver lib/s3-client.ts).
// Forçado (não `??`) para o teste ser hermético mesmo quando o .env local tem S3 real:
// o fixture IMG abaixo precisa casar com S3_PUBLIC_BASE_URL em assertImageHost.
process.env.S3_BUCKET = 'bucket-teste'
process.env.S3_REGION = 'us-east-1'
process.env.S3_PUBLIC_BASE_URL = 'https://cdn.exemplo.com'
const IMG = { url: 'https://cdn.exemplo.com/reviews/u/x.png', width: 100, height: 80 }
const SECTOR = 'sector-dev-produto'

async function makeUser(email: string, sectorId = SECTOR) {
  return prisma.user.create({ data: { name: email.split('@')[0], email, passwordHash: 'x', sectorId } })
}

async function makeAdminActor() {
  return prisma.user.create({ data: { name: 'admin', email: `admin-${Math.random()}@empresa.com`, passwordHash: 'x', role: 'ADMIN' } })
}

/** Cria um 2º setor (para testes de isolamento) e um usuário nele. */
async function makeUserInOtherSector(email: string) {
  const admin = await makeAdminActor()
  const sector = await createSector({ name: `Outro Setor ${Math.random()}`, enabledFeatures: [], roles: [] }, admin.id, DEFAULT_COMPANY_ID)
  return makeUser(email, sector.id)
}

describe('review-service: createReview + listFeed', () => {
  it('cria uma resenha com conteúdo válido', async () => {
    const u = await makeUser('a@empresa.com')
    const review = await createReview({ authorId: u.id, content: '  Olá time!  ' })
    expect(review.content).toBe('Olá time!')
    expect(review.author.id).toBe(u.id)
  })

  it('rejeita conteúdo vazio e acima de 280 (ReviewError 400)', async () => {
    const u = await makeUser('b@empresa.com')
    await expect(createReview({ authorId: u.id, content: '   ' })).rejects.toBeInstanceOf(ReviewError)
    await expect(createReview({ authorId: u.id, content: 'x'.repeat(281) })).rejects.toBeInstanceOf(ReviewError)
  })

  it('pagina o feed por cursor, mais novo primeiro, sem duplicar', async () => {
    const u = await makeUser('c@empresa.com')
    for (let i = 0; i < 5; i++) await createReview({ authorId: u.id, content: `r${i}` })

    const page1 = await listFeed(u.id, SECTOR, { limit: 2 })
    expect(page1.items).toHaveLength(2)
    expect(page1.items[0].content).toBe('r4')
    expect(page1.nextCursor).toBeTruthy()

    const page2 = await listFeed(u.id, SECTOR, { cursor: page1.nextCursor!, limit: 2 })
    expect(page2.items.map((r) => r.content)).toEqual(['r2', 'r1'])

    const ids = new Set([...page1.items, ...page2.items].map((r) => r.id))
    expect(ids.size).toBe(4)
  })

  it('não inclui resenhas de autores desativados no feed', async () => {
    const active = await makeUser('active@empresa.com')
    const inactive = await prisma.user.create({
      data: { name: 'inactive', email: 'inactive@empresa.com', passwordHash: 'x', active: false, sectorId: SECTOR },
    })
    const viewer = await makeUser('viewer@empresa.com')
    await createReview({ authorId: active.id, content: 'visível' })
    // criar resenha diretamente no banco para contornar a validação de autor ativo em createReview
    await prisma.review.create({ data: { authorId: inactive.id, content: 'invisível' } })

    const feed = await listFeed(viewer.id, SECTOR, { limit: 10 })
    expect(feed.items.map((r) => r.content)).toContain('visível')
    expect(feed.items.map((r) => r.content)).not.toContain('invisível')
  })

  it('marca sharedReviewIds para o viewer', async () => {
    const u = await makeUser('d@empresa.com')
    const r = await createReview({ authorId: u.id, content: 'compartilhável' })
    await prisma.reviewShare.create({ data: { reviewId: r.id, userId: u.id } })
    const feed = await listFeed(u.id, SECTOR, { limit: 10 })
    expect(feed.sharedReviewIds.has(r.id)).toBe(true)
  })
})

describe('review-service: comentários e exclusão', () => {
  it('cria comentário e calcula destinatários de reply (distintos, sem ator nem autor da resenha)', async () => {
    const author = await makeUser('rauthor@empresa.com')
    const p1 = await makeUser('p1@empresa.com')
    const p2 = await makeUser('p2@empresa.com')
    const review = await createReview({ authorId: author.id, content: 'thread' })

    // p1 comenta (sem participantes anteriores)
    const first = await createComment({ reviewId: review.id, authorId: p1.id, viewerSectorId: SECTOR, content: 'oi' })
    expect(first.reviewAuthorId).toBe(author.id)
    expect(first.replyRecipientIds).toEqual([])

    // p1 comenta de novo: participante anterior é p1 (== ator) → filtrado
    const again = await createComment({ reviewId: review.id, authorId: p1.id, viewerSectorId: SECTOR, content: 'de novo' })
    expect(again.replyRecipientIds).toEqual([])

    // p2 comenta: participante anterior p1 entra; author é o autor da resenha (não duplica)
    const third = await createComment({ reviewId: review.id, authorId: p2.id, viewerSectorId: SECTOR, content: 'cheguei' })
    expect(third.replyRecipientIds).toEqual([p1.id])

    // author comenta na própria resenha: participantes anteriores p1,p2; nenhum é o ator
    const byAuthor = await createComment({ reviewId: review.id, authorId: author.id, viewerSectorId: SECTOR, content: 'valeu' })
    expect(byAuthor.replyRecipientIds.sort()).toEqual([p1.id, p2.id].sort())
  })

  it('lista comentários do mais antigo ao mais novo com hasMore via take+1', async () => {
    const author = await makeUser('lc@empresa.com')
    const review = await createReview({ authorId: author.id, content: 'r' })
    for (let i = 0; i < 3; i++) await createComment({ reviewId: review.id, authorId: author.id, viewerSectorId: SECTOR, content: `c${i}` })
    const rows = await listComments(review.id, SECTOR, { offset: 0, limit: 2 })
    expect(rows).toHaveLength(3) // take = limit + 1
    expect(rows[0].content).toBe('c0')
  })

  it('deleteReview: autor 204, terceiro 403, admin ok, inexistente 404', async () => {
    const author = await makeUser('dr@empresa.com')
    const stranger = await makeUser('str@empresa.com')
    const review = await createReview({ authorId: author.id, content: 'apagar' })

    await expect(
      deleteReview({ reviewId: review.id, userId: stranger.id, role: 'LEGEND', sectorId: SECTOR }),
    ).rejects.toMatchObject({ status: 403 })
    await deleteReview({ reviewId: review.id, userId: author.id, role: 'LEGEND', sectorId: SECTOR })
    expect(await prisma.review.count()).toBe(0)
    await expect(
      deleteReview({ reviewId: 'nope', userId: author.id, role: 'ADMIN', sectorId: SECTOR }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('deleteReview: SUBADMIN também pode excluir resenha de terceiro', async () => {
    const author = await makeUser('dr-sub@empresa.com')
    const review = await createReview({ authorId: author.id, content: 'apagar via subadmin' })
    await deleteReview({ reviewId: review.id, userId: 'someone', role: 'SUBADMIN', sectorId: SECTOR })
    expect(await prisma.review.count()).toBe(0)
  })

  it('deleteComment: admin pode excluir comentário de terceiro', async () => {
    const author = await makeUser('dc@empresa.com')
    const review = await createReview({ authorId: author.id, content: 'r' })
    const c = await createComment({ reviewId: review.id, authorId: author.id, viewerSectorId: SECTOR, content: 'x' })
    await deleteComment({ commentId: c.comment.id, userId: 'someone', role: 'ADMIN', sectorId: SECTOR })
    expect(await prisma.reviewComment.count()).toBe(0)
  })

  it('deleteComment: SUBADMIN também pode excluir comentário de terceiro', async () => {
    const author = await makeUser('dc-sub@empresa.com')
    const review = await createReview({ authorId: author.id, content: 'r' })
    const c = await createComment({ reviewId: review.id, authorId: author.id, viewerSectorId: SECTOR, content: 'x' })
    await deleteComment({ commentId: c.comment.id, userId: 'someone', role: 'SUBADMIN', sectorId: SECTOR })
    expect(await prisma.reviewComment.count()).toBe(0)
  })

  it('deleteComment retorna o reviewId do comentário removido', async () => {
    const author = await makeUser('ana-del@empresa.com')
    const review = await createReview({ authorId: author.id, content: 'oi' })
    const { comment } = await createComment({ reviewId: review.id, authorId: author.id, viewerSectorId: SECTOR, content: 'comentário' })

    const result = await deleteComment({ commentId: comment.id, userId: author.id, role: 'COLLABORATOR', sectorId: SECTOR })

    expect(result.reviewId).toBe(review.id)
  })
})

describe('review-service: reações', () => {
  it('toggle de reação na resenha é idempotente (add → remove)', async () => {
    const u = await makeUser('rr@empresa.com')
    const review = await createReview({ authorId: u.id, content: 'reagir' })

    const add = await toggleReviewReaction({ reviewId: review.id, userId: u.id, emoji: '😂', sectorId: SECTOR })
    expect(add.added).toBe(true)
    expect(add.review.reactions).toHaveLength(1)

    const remove = await toggleReviewReaction({ reviewId: review.id, userId: u.id, emoji: '😂', sectorId: SECTOR })
    expect(remove.added).toBe(false)
    expect(remove.review.reactions).toHaveLength(0)
  })

  it('rejeita emoji fora do conjunto (400)', async () => {
    const u = await makeUser('rrx@empresa.com')
    const review = await createReview({ authorId: u.id, content: 'x' })
    await expect(
      toggleReviewReaction({ reviewId: review.id, userId: u.id, emoji: '🍕', sectorId: SECTOR }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('toggle de reação no comentário funciona', async () => {
    const u = await makeUser('cr@empresa.com')
    const review = await createReview({ authorId: u.id, content: 'r' })
    const { comment } = await createComment({ reviewId: review.id, authorId: u.id, viewerSectorId: SECTOR, content: 'c' })
    const res = await toggleCommentReaction({ commentId: comment.id, userId: u.id, emoji: '😂', sectorId: SECTOR })
    expect(res.comment.reactions).toHaveLength(1)
  })
})

describe('review-service: compartilhamento', () => {
  it('compartilha (idempotente) e descompartilha', async () => {
    const author = await makeUser('sa@empresa.com')
    const sharer = await makeUser('sh@empresa.com')
    const review = await createReview({ authorId: author.id, content: 'mural!' })

    const first = await shareReview({ reviewId: review.id, userId: sharer.id, sectorId: SECTOR })
    expect(first.created).toBe(true)
    expect(first.reviewAuthorId).toBe(author.id)

    const again = await shareReview({ reviewId: review.id, userId: sharer.id, sectorId: SECTOR })
    expect(again.created).toBe(false)
    expect(await prisma.reviewShare.count()).toBe(1)

    await unshareReview({ reviewId: review.id, userId: sharer.id })
    expect(await prisma.reviewShare.count()).toBe(0)
  })

  it('404 ao compartilhar resenha inexistente', async () => {
    const u = await makeUser('s404@empresa.com')
    await expect(shareReview({ reviewId: 'nope', userId: u.id, sectorId: SECTOR })).rejects.toMatchObject({ status: 404 })
  })
})

describe('review-service: menções', () => {
  it('grava menções (dedup, ativos não-admin, cap 10) e o DTO as inclui', async () => {
    const author = await makeUser('m-author@empresa.com')
    const a = await makeUser('m-a@empresa.com')
    const b = await makeUser('m-b@empresa.com')
    const inativo = await prisma.user.create({
      data: { name: 'Inativo', email: 'm-inativo@empresa.com', passwordHash: 'x', active: false, sectorId: SECTOR },
    })
    const admin = await prisma.user.create({
      data: { name: 'Admin', email: 'm-admin@empresa.com', passwordHash: 'x', role: 'ADMIN', sectorId: SECTOR },
    })

    const review = await createReview({
      authorId: author.id,
      content: `oi @${a.name} @${b.name}`,
      mentionedUserIds: [a.id, a.id, b.id, inativo.id, admin.id, 'inexistente'],
    })
    // dedup + filtro: só a e b
    expect(review.mentions.map((m) => m.userId).sort()).toEqual([a.id, b.id].sort())
    expect(review.mentions.find((m) => m.userId === a.id)?.name).toBe(a.name)
  })

  it('cap de 10 menções', async () => {
    const author = await makeUser('m-cap@empresa.com')
    const users = []
    for (let i = 0; i < 12; i++) users.push(await makeUser(`m-cap-${i}@empresa.com`))
    const review = await createReview({
      authorId: author.id,
      content: 'muitos',
      mentionedUserIds: users.map((u) => u.id),
    })
    expect(review.mentions).toHaveLength(10)
  })

  it('comentário também grava menções no DTO', async () => {
    const author = await makeUser('mc-author@empresa.com')
    const alvo = await makeUser('mc-alvo@empresa.com')
    const review = await createReview({ authorId: author.id, content: 'r' })
    const { comment } = await createComment({
      reviewId: review.id,
      authorId: author.id,
      viewerSectorId: SECTOR,
      content: `e aí @${alvo.name}`,
      mentionedUserIds: [alvo.id],
    })
    expect(comment.mentions.map((m) => m.userId)).toEqual([alvo.id])
  })

  it('não permite mencionar alguém de outro setor', async () => {
    const author = await makeUser('m-cross-author@empresa.com')
    const outro = await makeUserInOtherSector('m-cross-outro@empresa.com')
    const review = await createReview({
      authorId: author.id,
      content: `oi @${outro.name}`,
      mentionedUserIds: [outro.id],
    })
    expect(review.mentions).toHaveLength(0)
  })
})

describe('review-service: gif', () => {
  it('cria resenha com gif (texto + gif)', async () => {
    const u = await makeUser('gif1@empresa.com')
    const review = await createReview({
      authorId: u.id,
      content: 'olha esse',
      gif: { url: 'https://media.giphy.com/x.gif', width: 100, height: 80 },
    })
    expect(review.gifUrl).toBe('https://media.giphy.com/x.gif')
    expect(review.gifWidth).toBe(100)
    expect(review.gifHeight).toBe(80)
  })

  it('cria resenha só com gif (sem texto)', async () => {
    const u = await makeUser('gif2@empresa.com')
    const review = await createReview({
      authorId: u.id,
      content: '',
      gif: { url: 'https://media.giphy.com/y.gif', width: 1, height: 1 },
    })
    expect(review.content).toBe('')
    expect(review.gifUrl).toBe('https://media.giphy.com/y.gif')
  })

  it('rejeita vazio sem gif (400)', async () => {
    const u = await makeUser('gif3@empresa.com')
    await expect(createReview({ authorId: u.id, content: '   ' })).rejects.toMatchObject({ status: 400 })
  })

  it('rejeita gif de host fora da allowlist (400)', async () => {
    const u = await makeUser('gif4@empresa.com')
    await expect(
      createReview({ authorId: u.id, content: 'x', gif: { url: 'https://evil.example/z.gif', width: 1, height: 1 } }),
    ).rejects.toMatchObject({ status: 400 })
    expect(isGiphyHost('media.giphy.com')).toBe(true)
  })

  it('cria comentário só com gif (sem texto)', async () => {
    const author = await makeUser('gif-comment@empresa.com')
    const review = await createReview({ authorId: author.id, content: 'r' })
    const result = await createComment({
      reviewId: review.id,
      authorId: author.id,
      viewerSectorId: SECTOR,
      content: '',
      gif: { url: 'https://media.giphy.com/c.gif', width: 50, height: 40 },
    })
    expect(result.comment.gifUrl).toBe('https://media.giphy.com/c.gif')
    expect(result.comment.gifWidth).toBe(50)
    expect(result.comment.gifHeight).toBe(40)
  })
})

describe('review-service: imagem anexada', () => {
  it('persiste a imagem na resenha', async () => {
    const u = await makeUser('img1@empresa.com')
    const review = await createReview({ authorId: u.id, content: '', image: IMG })
    expect(review.imageUrl).toBe(IMG.url)
    expect(review.imageWidth).toBe(100)
    expect(review.imageHeight).toBe(80)
  })

  it('aceita só imagem, sem texto', async () => {
    const u = await makeUser('img2@empresa.com')
    await expect(createReview({ authorId: u.id, content: '   ', image: IMG })).resolves.toBeTruthy()
  })

  it('rejeita imagem e gif juntos (400)', async () => {
    const u = await makeUser('img3@empresa.com')
    const gif = { url: 'https://media.giphy.com/a.gif', width: 10, height: 10 }
    await expect(
      createReview({ authorId: u.id, content: 'oi', gif, image: IMG }),
    ).rejects.toBeInstanceOf(ReviewError)
  })

  it('rejeita imagem de host fora do bucket (400)', async () => {
    const u = await makeUser('img4@empresa.com')
    const evil = { url: 'https://evil.com/x.png', width: 10, height: 10 }
    await expect(createReview({ authorId: u.id, content: 'oi', image: evil })).rejects.toBeInstanceOf(ReviewError)
  })

  it('persiste imagem no comentário', async () => {
    const author = await makeUser('img5@empresa.com')
    const review = await createReview({ authorId: author.id, content: 'post' })
    const { comment } = await createComment({ reviewId: review.id, authorId: author.id, viewerSectorId: SECTOR, content: '', image: IMG })
    expect(comment.imageUrl).toBe(IMG.url)
  })
})

describe('review-service: isolamento por setor', () => {
  it('listFeed não retorna resenha de outro setor', async () => {
    const viewer = await makeUser('iso-viewer@empresa.com')
    const outro = await makeUserInOtherSector('iso-outro@empresa.com')
    await createReview({ authorId: outro.id, content: 'resenha de outro setor' })
    const feed = await listFeed(viewer.id, SECTOR, { limit: 10 })
    expect(feed.items.map((r) => r.content)).not.toContain('resenha de outro setor')
  })

  it('getReviewForViewer/deleteReview/comentar/reagir/compartilhar em resenha de outro setor: 404', async () => {
    const outroAuthor = await makeUserInOtherSector('iso-author@empresa.com')
    const viewer = await makeUser('iso-actor@empresa.com')
    const review = await createReview({ authorId: outroAuthor.id, content: 'privada do outro setor' })

    await expect(getReviewForViewer(review.id, viewer.id, SECTOR)).rejects.toMatchObject({ status: 404 })
    await expect(
      deleteReview({ reviewId: review.id, userId: viewer.id, role: 'ADMIN', sectorId: SECTOR }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      createComment({ reviewId: review.id, authorId: viewer.id, viewerSectorId: SECTOR, content: 'oi' }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      toggleReviewReaction({ reviewId: review.id, userId: viewer.id, emoji: '😂', sectorId: SECTOR }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      shareReview({ reviewId: review.id, userId: viewer.id, sectorId: SECTOR }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(listComments(review.id, SECTOR, { offset: 0, limit: 10 })).rejects.toMatchObject({ status: 404 })
  })

  it('deleteComment/toggleCommentReaction em comentário de resenha de outro setor: 404', async () => {
    const outroAuthor = await makeUserInOtherSector('iso-c-author@empresa.com')
    const viewer = await makeUser('iso-c-actor@empresa.com')
    const review = await createReview({ authorId: outroAuthor.id, content: 'r' })
    const { comment } = await createComment({ reviewId: review.id, authorId: outroAuthor.id, viewerSectorId: outroAuthor.sectorId, content: 'c' })

    await expect(
      deleteComment({ commentId: comment.id, userId: viewer.id, role: 'ADMIN', sectorId: SECTOR }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      toggleCommentReaction({ commentId: comment.id, userId: viewer.id, emoji: '😂', sectorId: SECTOR }),
    ).rejects.toMatchObject({ status: 404 })
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha (assinaturas antigas não bate com os novos argumentos)**

Run: `pnpm --filter @legends/api exec vitest run src/services/review-service.test.ts`
Expected: FAIL (erros de tipo/assinatura — ex. `listFeed` chamado com 3 args mas aceita 2)

- [ ] **Step 3: Implementar a sectorização em `review-service.ts`**

Modify `apps/api/src/services/review-service.ts`:

```ts
// resolveMentions ganha authorSectorId e filtra por ele:
/** Resolve mentionedUserIds em {userId, name}: dedup, só ativos não-admin do mesmo setor, cap MAX_REVIEW_MENTIONS. */
async function resolveMentions(userIds: string[] | undefined, authorSectorId: string): Promise<{ userId: string; name: string }[]> {
  if (!userIds?.length) return []
  const unique = [...new Set(userIds)].slice(0, MAX_REVIEW_MENTIONS)
  const users = await prisma.user.findMany({
    where: { id: { in: unique }, active: true, role: { notIn: ['ADMIN', 'SUBADMIN'] }, sectorId: authorSectorId },
    select: { id: true, name: true },
  })
  return users.map((u) => ({ userId: u.id, name: u.name }))
}
```

```ts
export async function createReview(input: {
  authorId: string
  content: string
  mentionedUserIds?: string[]
  gif?: AttachedGif
  image?: AttachedImage
}): Promise<ReviewWithRelations> {
  assertSingleAttachment(input.gif, input.image)
  const content = assertContentOrAttachment(input.content, Boolean(input.gif || input.image))
  assertGifHost(input.gif)
  assertImageHost(input.image)
  const author = await prisma.user.findUnique({ where: { id: input.authorId } })
  if (!author || !author.active) {
    throw new ReviewError('Autor inválido.', 400)
  }
  const mentions = await resolveMentions(input.mentionedUserIds, author.sectorId)
  return prisma.review.create({
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

export async function listFeed(
  viewerId: string,
  viewerSectorId: string,
  opts: { cursor?: string; limit: number },
): Promise<{ items: ReviewWithRelations[]; nextCursor: string | null; sharedReviewIds: Set<string> }> {
  const decoded = opts.cursor ? decodeCursor(opts.cursor) : null
  const where: Prisma.ReviewWhereInput = {
    author: { active: true, sectorId: viewerSectorId },
    ...(decoded
      ? {
          OR: [
            { createdAt: { lt: decoded.createdAt } },
            { createdAt: decoded.createdAt, id: { lt: decoded.id } },
          ],
        }
      : {}),
  }
  const rows = await prisma.review.findMany({
    where,
    include: reviewInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: opts.limit + 1,
  })
  const hasMore = rows.length > opts.limit
  const items = hasMore ? rows.slice(0, opts.limit) : rows
  const nextCursor = hasMore ? encodeCursor(items[items.length - 1]) : null
  const shares = items.length
    ? await prisma.reviewShare.findMany({
        where: { userId: viewerId, reviewId: { in: items.map((r) => r.id) } },
        select: { reviewId: true },
      })
    : []
  return { items, nextCursor, sharedReviewIds: new Set(shares.map((s) => s.reviewId)) }
}

export async function getReviewForViewer(
  reviewId: string,
  viewerId: string,
  viewerSectorId: string,
): Promise<{ review: ReviewWithRelations; sharedByMe: boolean }> {
  const review = await prisma.review.findUnique({ where: { id: reviewId }, include: reviewInclude })
  if (!review || review.author.sectorId !== viewerSectorId) {
    throw new ReviewError('Resenha não encontrada.', 404)
  }
  const share = await prisma.reviewShare.findUnique({
    where: { reviewId_userId: { reviewId, userId: viewerId } },
    select: { id: true },
  })
  return { review, sharedByMe: Boolean(share) }
}

export async function deleteReview(input: {
  reviewId: string
  userId: string
  role: string
  sectorId: string
}): Promise<void> {
  const existing = await prisma.review.findUnique({
    where: { id: input.reviewId },
    select: { authorId: true, author: { select: { sectorId: true } } },
  })
  if (!existing || existing.author.sectorId !== input.sectorId) throw new ReviewError('Resenha não encontrada.', 404)
  if (existing.authorId !== input.userId && input.role !== 'ADMIN' && input.role !== 'SUBADMIN') {
    throw new ReviewError('Sem permissão para excluir esta resenha.', 403)
  }
  await prisma.review.delete({ where: { id: input.reviewId } })
}

export async function listComments(
  reviewId: string,
  viewerSectorId: string,
  opts: { offset: number; limit: number },
): Promise<ReviewCommentWithRelations[]> {
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    select: { id: true, author: { select: { sectorId: true } } },
  })
  if (!review || review.author.sectorId !== viewerSectorId) throw new ReviewError('Resenha não encontrada.', 404)
  return prisma.reviewComment.findMany({
    where: { reviewId },
    include: reviewCommentInclude,
    orderBy: { createdAt: 'asc' },
    skip: opts.offset,
    take: opts.limit + 1,
  })
}

export async function createComment(input: {
  reviewId: string
  authorId: string
  viewerSectorId: string
  content: string
  mentionedUserIds?: string[]
  gif?: AttachedGif
  image?: AttachedImage
}): Promise<{ comment: ReviewCommentWithRelations; reviewAuthorId: string; replyRecipientIds: string[] }> {
  assertSingleAttachment(input.gif, input.image)
  const content = assertContentOrAttachment(input.content, Boolean(input.gif || input.image))
  assertGifHost(input.gif)
  assertImageHost(input.image)
  const review = await prisma.review.findUnique({
    where: { id: input.reviewId },
    select: { authorId: true, author: { select: { sectorId: true } } },
  })
  if (!review || review.author.sectorId !== input.viewerSectorId) throw new ReviewError('Resenha não encontrada.', 404)
  // Participantes anteriores (distintos) ANTES de inserir o novo comentário.
  const prior = await prisma.reviewComment.findMany({
    where: { reviewId: input.reviewId },
    select: { authorId: true },
    distinct: ['authorId'],
  })
  const mentions = await resolveMentions(input.mentionedUserIds, input.viewerSectorId)
  const comment = await prisma.reviewComment.create({
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

export async function deleteComment(input: {
  commentId: string
  userId: string
  role: string
  sectorId: string
}): Promise<{ reviewId: string }> {
  const existing = await prisma.reviewComment.findUnique({
    where: { id: input.commentId },
    select: { authorId: true, reviewId: true, review: { select: { author: { select: { sectorId: true } } } } },
  })
  if (!existing || existing.review.author.sectorId !== input.sectorId) {
    throw new ReviewError('Comentário não encontrado.', 404)
  }
  if (existing.authorId !== input.userId && input.role !== 'ADMIN' && input.role !== 'SUBADMIN') {
    throw new ReviewError('Sem permissão para excluir este comentário.', 403)
  }
  await prisma.reviewComment.delete({ where: { id: input.commentId } })
  return { reviewId: existing.reviewId }
}

function assertEmoji(emoji: string) {
  if (!(REVIEW_REACTIONS as readonly string[]).includes(emoji)) {
    throw new ReviewError('Reação inválida.', 400)
  }
}

export async function toggleReviewReaction(input: {
  reviewId: string
  userId: string
  emoji: string
  sectorId: string
}): Promise<{ review: ReviewWithRelations; added: boolean; reviewAuthorId: string; sharedByMe: boolean }> {
  assertEmoji(input.emoji)
  const review = await prisma.review.findUnique({
    where: { id: input.reviewId },
    select: { authorId: true, author: { select: { sectorId: true } } },
  })
  if (!review || review.author.sectorId !== input.sectorId) throw new ReviewError('Resenha não encontrada.', 404)
  const existing = await prisma.reviewReaction.findUnique({
    where: { reviewId_userId_emoji: { reviewId: input.reviewId, userId: input.userId, emoji: input.emoji } },
  })
  let added: boolean
  if (existing) {
    await prisma.reviewReaction.delete({ where: { id: existing.id } })
    added = false
  } else {
    await prisma.reviewReaction.create({
      data: { reviewId: input.reviewId, userId: input.userId, emoji: input.emoji },
    })
    added = true
  }
  const full = await prisma.review.findUniqueOrThrow({ where: { id: input.reviewId }, include: reviewInclude })
  const share = await prisma.reviewShare.findUnique({
    where: { reviewId_userId: { reviewId: input.reviewId, userId: input.userId } },
    select: { id: true },
  })
  return { review: full, added, reviewAuthorId: review.authorId, sharedByMe: Boolean(share) }
}

export async function toggleCommentReaction(input: {
  commentId: string
  userId: string
  emoji: string
  sectorId: string
}): Promise<{ comment: ReviewCommentWithRelations }> {
  assertEmoji(input.emoji)
  const comment = await prisma.reviewComment.findUnique({
    where: { id: input.commentId },
    select: { id: true, review: { select: { author: { select: { sectorId: true } } } } },
  })
  if (!comment || comment.review.author.sectorId !== input.sectorId) {
    throw new ReviewError('Comentário não encontrado.', 404)
  }
  const existing = await prisma.reviewCommentReaction.findUnique({
    where: { commentId_userId_emoji: { commentId: input.commentId, userId: input.userId, emoji: input.emoji } },
  })
  if (existing) {
    await prisma.reviewCommentReaction.delete({ where: { id: existing.id } })
  } else {
    await prisma.reviewCommentReaction.create({
      data: { commentId: input.commentId, userId: input.userId, emoji: input.emoji },
    })
  }
  const full = await prisma.reviewComment.findUniqueOrThrow({
    where: { id: input.commentId },
    include: reviewCommentInclude,
  })
  return { comment: full }
}

export async function shareReview(input: {
  reviewId: string
  userId: string
  sectorId: string
}): Promise<{ reviewAuthorId: string; created: boolean }> {
  const review = await prisma.review.findUnique({
    where: { id: input.reviewId },
    select: { authorId: true, author: { select: { sectorId: true } } },
  })
  if (!review || review.author.sectorId !== input.sectorId) throw new ReviewError('Resenha não encontrada.', 404)
  const existing = await prisma.reviewShare.findUnique({
    where: { reviewId_userId: { reviewId: input.reviewId, userId: input.userId } },
  })
  if (existing) return { reviewAuthorId: review.authorId, created: false }
  await prisma.reviewShare.create({ data: { reviewId: input.reviewId, userId: input.userId } })
  return { reviewAuthorId: review.authorId, created: true }
}

export async function unshareReview(input: { reviewId: string; userId: string }): Promise<void> {
  await prisma.reviewShare.deleteMany({ where: { reviewId: input.reviewId, userId: input.userId } })
}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/api exec vitest run src/services/review-service.test.ts`
Expected: PASS (todos os `describe`, incluindo o novo `review-service: isolamento por setor`)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/review-service.ts apps/api/src/services/review-service.test.ts
git commit -m "feat(api): sectoriza resenha (Review) — feed, comentarios, reacoes e shares por setor"
```

---

### Task 3: Repassar `sectorId` nas rotas de Resenha

**Files:**
- Modify: `apps/api/src/routes/review.ts`

**Interfaces:**
- Consumes: as novas assinaturas da Task 2.

- [ ] **Step 1: Atualizar todos os call sites em `review.ts`**

Modify `apps/api/src/routes/review.ts` (cada handler abaixo troca a chamada ao service; o resto do
arquivo — validação Zod, notificações, broadcast do `reviewHub` — não muda):

```ts
  app.get('/reviews', { onRequest: [app.authenticate, app.requireFeature('resenha')] }, async (request, reply) => {
    const query = request.query as { cursor?: string; limit?: string }
    try {
      const { items, nextCursor, sharedReviewIds } = await listFeed(request.user.sub, request.user.sectorId, {
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
```

```ts
  app.delete('/reviews/:id', { onRequest: [app.authenticate, app.requireFeature('resenha')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      await deleteReview({ reviewId: id, userId: request.user.sub, role: request.user.role, sectorId: request.user.sectorId })
      reviewHub.broadcast({ type: 'feed:changed' })
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof ReviewError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
```

```ts
  app.post('/reviews/:id/reactions/toggle', { onRequest: [app.authenticate, app.requireFeature('resenha')] }, async (request, reply) => {
    const parsed = reactionSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Reação inválida.', issues: parsed.error.flatten() })
    const { id } = request.params as { id: string }
    try {
      const { review, added, reviewAuthorId, sharedByMe } = await toggleReviewReaction({
        reviewId: id,
        userId: request.user.sub,
        emoji: parsed.data.emoji,
        sectorId: request.user.sectorId,
      })
      if (added) {
        try {
          await notifyReviewReaction({ reviewAuthorId, actorId: request.user.sub, reviewId: id })
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
```

```ts
  app.post('/reviews/:id/share', { onRequest: [app.authenticate, app.requireFeature('resenha')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const { reviewAuthorId, created } = await shareReview({ reviewId: id, userId: request.user.sub, sectorId: request.user.sectorId })
      if (created) {
        try {
          await notifyReviewShared({ reviewAuthorId, actorId: request.user.sub, reviewId: id })
        } catch (notifyErr) {
          request.log.error(notifyErr)
        }
      }
      const { review, sharedByMe } = await getReviewForViewer(id, request.user.sub, request.user.sectorId)
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
      await unshareReview({ reviewId: id, userId: request.user.sub })
      const { review, sharedByMe } = await getReviewForViewer(id, request.user.sub, request.user.sectorId)
      reviewHub.broadcast({ type: 'review:changed', reviewId: id })
      return reply.send({ review: toReviewDTO(review, request.user.sub, sharedByMe) })
    } catch (err) {
      if (err instanceof ReviewError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
```

```ts
  app.get('/reviews/:id/comments', { onRequest: [app.authenticate, app.requireFeature('resenha')] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const query = request.query as { offset?: string; limit?: string }
    const limit = clampLimit(query.limit, 10)
    const offset = Math.max(0, Number(query.offset) || 0)
    try {
      const rows = await listComments(id, request.user.sectorId, { offset, limit })
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
        viewerSectorId: request.user.sectorId,
        content: parsed.data.content,
        mentionedUserIds: parsed.data.mentionedUserIds,
        gif: parsed.data.gif,
        image: parsed.data.image,
      })
      try {
        await notifyReviewComment({ reviewAuthorId, actorId: request.user.sub, reviewId: id })
      } catch (notifyErr) {
        request.log.error(notifyErr)
      }
      try {
        await notifyReviewCommentReply({ recipientIds: replyRecipientIds, actorId: request.user.sub, reviewId: id })
      } catch (notifyErr) {
        request.log.error(notifyErr)
      }
      try {
        await notifyReviewMention({
          recipientIds: comment.mentions.map((m) => m.userId),
          actorId: request.user.sub,
          reviewId: id,
        })
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
      const { reviewId } = await deleteComment({ commentId, userId: request.user.sub, role: request.user.role, sectorId: request.user.sectorId })
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
          sectorId: request.user.sectorId,
        })
        reviewHub.broadcast({ type: 'comments:changed', reviewId: comment.reviewId })
        return reply.send({ comment: toReviewCommentDTO(comment, request.user.sub) })
      } catch (err) {
        if (err instanceof ReviewError) return reply.code(err.status).send({ message: err.message })
        throw err
      }
    },
  )
```

- [ ] **Step 2: Rodar os testes de rota de resenha (se existirem) e o typecheck do workspace**

Run: `pnpm --filter @legends/api exec tsc --noEmit`
Expected: sem erros (nenhuma referência antiga com assinatura errada sobrando)

Run: `find apps/api/src/routes -iname "review*.test.ts"` — se existir um teste de rota HTTP de
resenha, rode-o também: `pnpm --filter @legends/api exec vitest run <arquivo encontrado>`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/routes/review.ts
git commit -m "feat(api): rotas de resenha repassam sectorId do JWT pro service"
```

---

### Task 4: Sectorizar `mural-service.ts` (Mural do time)

**Files:**
- Modify: `apps/api/src/services/mural-service.ts`
- Modify: `apps/api/src/routes/mural.ts`
- Test: `apps/api/src/services/mural-service.test.ts` (reescrita completa)

**Interfaces:**
- Produces: `getMuralItems(viewerId: string, viewerSectorId: string, now?: Date): Promise<MuralItemDTO[]>`
  (era `getMuralItems(viewerId, now?)`).

- [ ] **Step 1: Reescrever `mural-service.test.ts` com o novo parâmetro + testes de isolamento (falhando)**

Substituir o conteúdo de `apps/api/src/services/mural-service.test.ts` por:

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { createSector } from './sector-service'
import { getMuralItems } from './mural-service'
import { todayInSaoPaulo, addDays, dayFromYmd } from '../lib/sao-paulo-date'

const SECTOR = 'sector-dev-produto'

async function makeUser(email: string, sectorId = SECTOR) {
  return prisma.user.create({ data: { name: email, email, passwordHash: 'x', sectorId } })
}

async function makeUserInOtherSector(email: string) {
  const admin = await prisma.user.create({
    data: { name: 'admin', email: `admin-${Math.random()}@x.com`, passwordHash: 'x', role: 'ADMIN' },
  })
  const sector = await createSector({ name: `Outro Setor ${Math.random()}`, enabledFeatures: [], roles: [] }, admin.id, DEFAULT_COMPANY_ID)
  return makeUser(email, sector.id)
}

describe('getMuralItems', () => {
  it('inclui feedback público compartilhado dentro de 7d e exclui não compartilhado', async () => {
    const author = await makeUser('m-author@x.com')
    const target = await makeUser('m-target@x.com')
    const shared = await prisma.feedback.create({
      data: { authorId: author.id, targetId: target.id, message: 'feedback compartilhado específico', category: 'POSITIVO', sharedAt: new Date() },
    })
    await prisma.feedback.create({
      data: { authorId: author.id, targetId: target.id, message: 'feedback não compartilhado aqui', category: 'POSITIVO' },
    })
    const items = await getMuralItems(target.id, target.sectorId)
    const fbItems = items.filter((i) => i.type === 'feedback')
    expect(fbItems.map((i) => i.id)).toContain(shared.id)
    expect(fbItems).toHaveLength(1)
  })

  it('exclui feedback compartilhado há mais de 7 dias', async () => {
    const author = await makeUser('m-old-author@x.com')
    const target = await makeUser('m-old-target@x.com')
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000)
    await prisma.feedback.create({
      data: { authorId: author.id, targetId: target.id, message: 'feedback antigo demais aqui', category: 'POSITIVO', sharedAt: old },
    })
    const items = await getMuralItems(target.id, target.sectorId)
    expect(items.filter((i) => i.type === 'feedback')).toHaveLength(0)
  })

  it('exclui feedback compartilhado de alvo desativado', async () => {
    const author = await makeUser('m-inactive-author@x.com')
    const target = await prisma.user.create({
      data: { name: 'inativo', email: 'm-inactive-target@x.com', passwordHash: 'x', active: false, sectorId: SECTOR },
    })
    await prisma.feedback.create({
      data: { authorId: author.id, targetId: target.id, message: 'feedback de alvo desativado', category: 'POSITIVO', sharedAt: new Date() },
    })
    const items = await getMuralItems(author.id, author.sectorId)
    expect(items.filter((i) => i.type === 'feedback')).toHaveLength(0)
  })

  it('exclui selo de usuário desativado', async () => {
    const user = await prisma.user.create({
      data: { name: 'inativo', email: 'm-inactive-badge@x.com', passwordHash: 'x', active: false, sectorId: SECTOR },
    })
    const badge = await prisma.badge.create({
      data: { slug: 'mural-inativo', name: 'Selo Inativo', description: 'd', kind: 'IMPACT', iconKey: 'trophy' },
    })
    await prisma.userBadge.create({ data: { userId: user.id, badgeId: badge.id } })
    const items = await getMuralItems(user.id, user.sectorId)
    expect(items.filter((i) => i.type === 'badge')).toHaveLength(0)
  })

  it('ordena por timestamp desc (mais recente primeiro)', async () => {
    const author = await makeUser('m-ord-author@x.com')
    const target = await makeUser('m-ord-target@x.com')
    const older = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
    const newer = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)
    const a = await prisma.feedback.create({
      data: { authorId: author.id, targetId: target.id, message: 'feedback mais antigo do par', category: 'POSITIVO', sharedAt: older },
    })
    const b = await prisma.feedback.create({
      data: { authorId: author.id, targetId: target.id, message: 'feedback mais recente do par', category: 'ELOGIO', sharedAt: newer },
    })
    const items = await getMuralItems(target.id, target.sectorId)
    const ids = items.filter((i) => i.type === 'feedback').map((i) => i.id)
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id))
  })

  it('inclui aviso de quem respondeu ao humor hoje (sem expor o humor)', async () => {
    const responder = await makeUser('m-mood-today@x.com')
    const { day } = todayInSaoPaulo()
    const entry = await prisma.moodEntry.create({
      data: { userId: responder.id, day, mood: 'GREAT', note: 'segredo' },
    })
    const items = await getMuralItems(responder.id, responder.sectorId)
    const moodItems = items.filter((i) => i.type === 'mood')
    expect(moodItems).toHaveLength(1)
    expect(moodItems[0].id).toBe(entry.id)
    expect(moodItems[0].user.id).toBe(responder.id)
    // O humor e a nota nunca aparecem no item do mural.
    expect(JSON.stringify(moodItems[0])).not.toContain('GREAT')
    expect(JSON.stringify(moodItems[0])).not.toContain('segredo')
  })

  it('exclui aviso de humor registrado em dias anteriores', async () => {
    const responder = await makeUser('m-mood-old@x.com')
    const { ymd } = todayInSaoPaulo()
    await prisma.moodEntry.create({
      data: { userId: responder.id, day: dayFromYmd(addDays(ymd, -1)), mood: 'GOOD', note: null },
    })
    const items = await getMuralItems(responder.id, responder.sectorId)
    expect(items.filter((i) => i.type === 'mood')).toHaveLength(0)
  })

  it('exclui aviso de humor de usuário desativado', async () => {
    const responder = await prisma.user.create({
      data: { name: 'inativo', email: 'm-mood-inactive@x.com', passwordHash: 'x', active: false, sectorId: SECTOR },
    })
    const { day } = todayInSaoPaulo()
    await prisma.moodEntry.create({
      data: { userId: responder.id, day, mood: 'NEUTRAL', note: null },
    })
    const items = await getMuralItems(responder.id, responder.sectorId)
    expect(items.filter((i) => i.type === 'mood')).toHaveLength(0)
  })

  it('isolamento por setor: feedback, badge, mood e review share de outro setor não aparecem', async () => {
    const viewer = await makeUser('m-iso-viewer@x.com')
    const outroAuthor = await makeUserInOtherSector('m-iso-author@x.com')
    const outroTarget = await makeUserInOtherSector('m-iso-target@x.com')

    await prisma.feedback.create({
      data: { authorId: outroAuthor.id, targetId: outroTarget.id, message: 'feedback de outro setor', category: 'POSITIVO', sharedAt: new Date() },
    })
    const badge = await prisma.badge.create({
      data: { slug: 'mural-outro-setor', name: 'Selo Outro Setor', description: 'd', kind: 'IMPACT', iconKey: 'trophy' },
    })
    await prisma.userBadge.create({ data: { userId: outroTarget.id, badgeId: badge.id } })
    const { day } = todayInSaoPaulo()
    await prisma.moodEntry.create({ data: { userId: outroTarget.id, day, mood: 'GOOD', note: null } })
    const outroReview = await prisma.review.create({ data: { authorId: outroAuthor.id, content: 'resenha de outro setor' } })
    await prisma.reviewShare.create({ data: { reviewId: outroReview.id, userId: outroTarget.id } })

    const items = await getMuralItems(viewer.id, viewer.sectorId)
    expect(items.filter((i) => i.type === 'feedback')).toHaveLength(0)
    expect(items.filter((i) => i.type === 'badge')).toHaveLength(0)
    expect(items.filter((i) => i.type === 'mood')).toHaveLength(0)
    expect(items.filter((i) => i.type === 'review')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @legends/api exec vitest run src/services/mural-service.test.ts`
Expected: FAIL (assinatura antiga de `getMuralItems` não aceita/ignora o 2º argumento como
`sectorId`, ou os testes de isolamento falham por ainda não haver filtro)

- [ ] **Step 3: Implementar a sectorização em `mural-service.ts`**

Modify `apps/api/src/services/mural-service.ts`:

```ts
export async function getMuralItems(
  viewerId: string,
  viewerSectorId: string,
  now: Date = new Date(),
): Promise<MuralItemDTO[]> {
  const since = new Date(now.getTime() - WINDOW_MS)
  // Avisos de humor têm vida útil de um dia: filtramos pela data civil de hoje (America/Sao_Paulo),
  // então na virada do dia eles somem sozinhos e reaparecem se a pessoa responder de novo.
  const { day: today } = todayInSaoPaulo()

  const [feedbacks, badges, moods, reviewShares] = await Promise.all([
    prisma.feedback.findMany({
      where: {
        sharedAt: { gte: since },
        category: { in: [...PUBLIC_FEEDBACK_CATEGORIES] },
        target: { active: true, sectorId: viewerSectorId },
      },
      include: { ...feedbackInclude, target: true },
      orderBy: { sharedAt: 'desc' },
    }),
    prisma.userBadge.findMany({
      where: { awardedAt: { gte: since }, user: { active: true, sectorId: viewerSectorId } },
      include: { user: true, badge: true },
      orderBy: { awardedAt: 'desc' },
    }),
    prisma.moodEntry.findMany({
      where: { day: today, user: { active: true, sectorId: viewerSectorId } },
      select: { id: true, createdAt: true, user: true },
      orderBy: { createdAt: 'desc' },
    }),
    // Shares (mais recentes primeiro) das resenhas de autores ativos do mesmo setor, na janela.
    prisma.reviewShare.findMany({
      where: { createdAt: { gte: since }, review: { author: { active: true, sectorId: viewerSectorId } } },
      include: { user: true, review: { include: reviewInclude } },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  // Dedup por resenha: a 1ª ocorrência (ordem desc) é o share mais recente; agrega os sharers.
  const byReview = new Map<
    string,
    { review: (typeof reviewShares)[number]['review']; sharers: (typeof reviewShares)[number]['user'][]; latestShareAt: Date }
  >()
  for (const share of reviewShares) {
    const entry = byReview.get(share.reviewId)
    if (entry) {
      entry.sharers.push(share.user)
    } else {
      byReview.set(share.reviewId, { review: share.review, sharers: [share.user], latestShareAt: share.createdAt })
    }
  }

  const items: MuralItemDTO[] = [
    ...feedbacks.map((f) => toMuralFeedbackItem(f, viewerId)),
    ...badges.map((b) => toMuralBadgeItem(b)),
    ...moods.map((m) => toMuralMoodItem(m)),
    ...[...byReview.values()].map((r) => toMuralReviewItem(r)),
  ]
  return items.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0))
}
```

(Nota: a query de `feedback` perdeu o filtro solto `category: {in: PUBLIC_FEEDBACK_CATEGORIES}`?
Não — ele continua, só ganhou `sectorId` dentro de `target`. Confira que o diff acima preserva
`category: { in: [...PUBLIC_FEEDBACK_CATEGORIES] }`.)

- [ ] **Step 4: Atualizar a rota `/mural` para passar o `sectorId`**

Modify `apps/api/src/routes/mural.ts`:

```ts
import type { FastifyInstance } from 'fastify'
import { getMuralItems } from '../services/mural-service'

export async function muralRoutes(app: FastifyInstance) {
  app.get('/mural', { onRequest: [app.authenticate] }, async (request, reply) => {
    const items = await getMuralItems(request.user.sub, request.user.sectorId)
    return reply.send({ items })
  })
}
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/api exec vitest run src/services/mural-service.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/mural-service.ts apps/api/src/routes/mural.ts apps/api/src/services/mural-service.test.ts
git commit -m "feat(api): sectoriza o Mural do time (feedback, selo, humor e resenha compartilhada)"
```

---

### Task 5: Sectorizar `GET /users` (Lista de time)

**Files:**
- Modify: `apps/api/src/routes/users.ts`
- Test: `apps/api/src/routes/users.test.ts` (adiciona 1 teste)

**Interfaces:**
- Nenhuma mudança de assinatura pública (é uma rota HTTP, não uma função de service).

- [ ] **Step 1: Escrever o teste (falhando)**

Modify `apps/api/src/routes/users.test.ts` — adicionar dentro de `describe('GET /users', ...)`,
depois do teste `'inclui lideranças (LEAD) na listagem do time'`:

```ts
  it('não lista colegas de outro setor', async () => {
    const app = buildApp()
    await app.ready()
    const token = await registerAndToken(app, 'ana-setor@empresa.com')
    const admin = await prisma.user.create({ data: { name: 'Admin', email: 'admin-users-setor@empresa.com', passwordHash: 'x', role: 'ADMIN' } })
    const sectorB = await createSector({ name: 'Setor Time B (rota)', enabledFeatures: [], roles: [] }, admin.id, DEFAULT_COMPANY_ID)
    await prisma.user.create({ data: { name: 'De Outro Setor', email: 'outro-setor-time@empresa.com', passwordHash: 'x', sectorId: sectorB.id } })

    const res = await app.inject({
      method: 'GET',
      url: '/users',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const emails = res.json().users.map((u: { email: string }) => u.email)
    expect(emails).not.toContain('outro-setor-time@empresa.com')
    await app.close()
  })
```

(`createSector` e `DEFAULT_COMPANY_ID` já são importados no topo do arquivo — ver
`apps/api/src/routes/users.test.ts:2-5`.)

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @legends/api exec vitest run src/routes/users.test.ts -t "não lista colegas de outro setor"`
Expected: FAIL — `De Outro Setor` aparece na lista

- [ ] **Step 3: Implementar o filtro**

Modify `apps/api/src/routes/users.ts`:

```ts
  app.get('/users', { onRequest: [app.authenticate] }, async (request, reply) => {
    const users = await prisma.user.findMany({
      // Time: colegas do mesmo setor, menos admins. Inclui lideranças (LEAD), que fazem parte do
      // time e têm perfil, mas não recebem votos (filtradas na tela de votação).
      where: {
        active: true,
        role: { notIn: ['ADMIN', 'SUBADMIN'] },
        id: { not: request.user.sub },
        sectorId: request.user.sectorId,
      },
      orderBy: { name: 'asc' },
    })
    return reply.send({ users: users.map((u) => toPublicUser(u)) })
  })
```

- [ ] **Step 4: Rodar todos os testes do arquivo e confirmar que passam**

Run: `pnpm --filter @legends/api exec vitest run src/routes/users.test.ts`
Expected: PASS (inclusive os testes pré-existentes, que não criam usuários em outro setor)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/users.ts apps/api/src/routes/users.test.ts
git commit -m "feat(api): GET /users lista só colegas do mesmo setor"
```

---

### Task 6: Expor `votingEnabled` no `ProfileDTO`

**Files:**
- Modify: `packages/shared/src/profile.ts`
- Modify: `apps/api/src/routes/profile.ts`
- Test: `apps/api/src/routes/profile.test.ts` (adiciona 1 teste)

**Interfaces:**
- Consumes: `sectorFeaturesFor` da Task 1 (`apps/api/src/lib/sector-features.ts`).
- Produces: `ProfileDTO.votingEnabled: boolean`, consumido pela Task 8 (frontend).

- [ ] **Step 1: Escrever o teste (falhando)**

Modify `apps/api/src/routes/profile.test.ts` — adicionar dentro de `describe('profile routes', ...)`,
depois do teste `'returns the aggregated profile (GET /users/:id/profile)'`:

```ts
  it('votingEnabled reflete a feature "votar" do SETOR do dono do perfil (não do viewer)', async () => {
    const { app, token, target } = await setup()
    const before = await app.inject({ method: 'GET', url: `/users/${target.id}/profile`, headers: { authorization: `Bearer ${token}` } })
    expect(before.json().votingEnabled).toBe(true) // setor default tem "votar" habilitada

    const admin = await prisma.user.create({ data: { name: 'Admin', email: 'admin-profile-voting@empresa.com', passwordHash: 'x', role: 'ADMIN' } })
    const sectorSemVotar = await createSector({ name: 'Setor Sem Votar', enabledFeatures: [], roles: [] }, admin.id, DEFAULT_COMPANY_ID)
    await prisma.user.update({ where: { id: target.id }, data: { sectorId: sectorSemVotar.id } })

    const after = await app.inject({ method: 'GET', url: `/users/${target.id}/profile`, headers: { authorization: `Bearer ${token}` } })
    expect(after.json().votingEnabled).toBe(false)
    await app.close()
  })
```

Adicionar aos imports do topo do arquivo:

```ts
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { createSector } from '../services/sector-service'
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @legends/api exec vitest run src/routes/profile.test.ts -t "votingEnabled"`
Expected: FAIL — `before.json().votingEnabled` é `undefined`

- [ ] **Step 3: Adicionar o campo ao `ProfileDTO` compartilhado**

Modify `packages/shared/src/profile.ts`:

```ts
export interface ProfileDTO {
  user: PublicUser
  stats: ProfileStats
  categoryBreakdown: CategoryBreakdownItem[]
  months: string[]
  badges: AwardedBadgeDTO[]
  actions: RetroActionItemDTO[]
  /** Se a feature "votar" está habilitada para o SETOR do usuário do perfil (não do viewer). */
  votingEnabled: boolean
}
```

- [ ] **Step 4: Resolver e devolver o campo na rota**

Modify `apps/api/src/routes/profile.ts`:

```ts
import { getUserProfile, listUserActions, listVotesReceived, setFeaturedBadges, ProfileError } from '../services/profile-service'
import { evaluateTenureBadgesForUser, listBadgesForUser } from '../services/badge-service'
import { notifyBadgesEarned } from '../services/notification-service'
import { sectorFeaturesFor } from '../lib/sector-features'
import { squadLabel, toAwardedBadgeDTO, toPublicUser, toRetroActionItemDTO, toVoteDTO } from '../lib/serialize'
```

```ts
  app.get('/users/:id/profile', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const profile = await getUserProfile(id)
    if (!profile) {
      return reply.code(404).send({ message: 'Usuário não encontrado' })
    }
    // Avaliação preguiçosa dos selos de tempo de casa: best-effort, nunca derruba o perfil.
    try {
      const awarded = await evaluateTenureBadgesForUser(id)
      if (awarded.length > 0) {
        await notifyBadgesEarned(id, awarded.map((b) => b.badgeId))
      }
    } catch (err) {
      request.log.error(err)
    }
    const badges = await listBadgesForUser(id)
    const actions = await listUserActions(id)
    const votingEnabled = (await sectorFeaturesFor(profile.user.sectorId)).includes('votar')
    return reply.send({
      user: toPublicUser(profile.user),
      stats: {
        totalVotesReceived: profile.totalVotesReceived,
        monthsRecognized: profile.monthsRecognized,
      },
      categoryBreakdown: profile.categoryBreakdown,
      months: profile.months,
      badges: badges.map(toAwardedBadgeDTO),
      actions: actions.map((c) => toRetroActionItemDTO(c, c.room.sprint, squadLabel(c.room.squads))),
      votingEnabled,
    })
  })
```

- [ ] **Step 5: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/api exec vitest run src/routes/profile.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/profile.ts apps/api/src/routes/profile.ts apps/api/src/routes/profile.test.ts
git commit -m "feat(api): expoe votingEnabled no ProfileDTO (feature votar do setor do dono do perfil)"
```

---

### Task 7: Home — gate de Resenha e "Minhas Conquistas" por feature de setor

**Files:**
- Create: `apps/web/src/lib/features.ts`
- Create: `apps/web/src/lib/features.test.ts`
- Modify: `apps/web/src/components/nav-items.ts` (usa o novo helper — comportamento inalterado)
- Modify: `apps/web/src/pages/HomePage.tsx`
- Modify: `apps/web/src/components/MyStatsCard.tsx`
- Modify: `apps/web/src/pages/HomePage.test.tsx`
- Modify: `apps/web/src/components/MyStatsCard.test.tsx`

**Interfaces:**
- Produces: `effectiveFeatures(args: { role?: UserRole; enabledFeatures?: FeatureKey[]; sectorFeatures?: FeatureKey[] }): Set<FeatureKey>`,
  usada por `nav-items.ts`, `HomePage.tsx` e `MyStatsCard.tsx`.

- [ ] **Step 1: Escrever o teste do helper (falhando)**

Create `apps/web/src/lib/features.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { effectiveFeatures } from './features'

describe('effectiveFeatures', () => {
  it('usa sectorFeatures para papéis normais', () => {
    const set = effectiveFeatures({ role: 'LEGEND', sectorFeatures: ['resenha', 'votar'], enabledFeatures: [] })
    expect(set.has('resenha')).toBe(true)
    expect(set.has('votar')).toBe(true)
    expect(set.has('lendas')).toBe(false)
  })

  it('usa enabledFeatures (allowlist individual) para THIRD_PARTY, ignorando sectorFeatures', () => {
    const set = effectiveFeatures({ role: 'THIRD_PARTY', sectorFeatures: ['resenha', 'votar'], enabledFeatures: ['escritorio'] })
    expect(set.has('escritorio')).toBe(true)
    expect(set.has('resenha')).toBe(false)
  })

  it('retorna set vazio sem role/features', () => {
    expect(effectiveFeatures({}).size).toBe(0)
  })
})
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run src/lib/features.test.ts`
Expected: FAIL — `Cannot find module './features'`

- [ ] **Step 3: Criar o helper**

Create `apps/web/src/lib/features.ts`:

```ts
import type { FeatureKey, UserRole } from '@legends/shared'

/** Features efetivas do usuário: allowlist individual pra THIRD_PARTY, senão o toggle do setor. */
export function effectiveFeatures(args: {
  role?: UserRole
  enabledFeatures?: FeatureKey[]
  sectorFeatures?: FeatureKey[]
}): Set<FeatureKey> {
  const effective = args.role === 'THIRD_PARTY' ? (args.enabledFeatures ?? []) : (args.sectorFeatures ?? [])
  return new Set(effective)
}
```

- [ ] **Step 4: Rodar o teste do helper e confirmar que passa**

Run: `pnpm --filter @legends/web exec vitest run src/lib/features.test.ts`
Expected: PASS

- [ ] **Step 5: Refatorar `nav-items.ts` para usar o helper (sem mudar comportamento)**

Modify `apps/web/src/components/nav-items.ts` — no topo, adicionar o import:

```ts
import type { FeatureKey, UserRole } from "@legends/shared";
import { effectiveFeatures } from "../lib/features";
```

E no fim de `buildNavItems`, substituir:

```ts
  const effective = role === 'THIRD_PARTY' ? (enabledFeatures ?? []) : (sectorFeatures ?? []);
  const enabled = new Set(effective);
  return items.filter((item) => !item.feature || enabled.has(item.feature));
```

por:

```ts
  const enabled = effectiveFeatures({ role, enabledFeatures, sectorFeatures });
  return items.filter((item) => !item.feature || enabled.has(item.feature));
```

Run: `pnpm --filter @legends/web exec vitest run src/components/nav-items.test.ts`
Expected: PASS (comportamento idêntico — nenhum teste deste arquivo muda)

- [ ] **Step 6: Reescrever `HomePage.test.tsx` com mock de `useAuth` configurável + 2 novos testes (falhando)**

Substituir o conteúdo de `apps/web/src/pages/HomePage.test.tsx` por:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { HomePage } from './HomePage'
import { apiFetch } from '../lib/api'
import type { Mock } from 'vitest'

const ALL_FEATURES = ['resenha', 'votar', 'time', 'lendas', 'selos', 'destaques', 'notificacoes', 'quinta-desenvolvimento', 'retrospectivas', 'escritorio']

const mockUseAuth = vi.fn()
vi.mock('../auth/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => mockUseAuth(),
}))

function baseUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    name: 'Test User',
    role: 'LEGEND',
    position: null,
    squad: null,
    photoUrl: null,
    avatarStyle: null,
    avatarSeed: null,
    avatarOptions: null,
    active: true,
    joinedAt: '2026-01-01T00:00:00.000Z',
    enabledFeatures: [],
    sectorFeatures: ALL_FEATURES,
    ...overrides,
  }
}

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})
const mockApiFetch = apiFetch as unknown as Mock

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAuth.mockReturnValue({
      user: baseUser(),
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
      setUser: vi.fn(),
    })
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/periods/current') return Promise.resolve({ period: null })
      if (path === '/mural') return Promise.resolve({ items: [] })
      if (path === '/badges') return Promise.resolve({ badges: [] })
      if (path === '/users/u1/badges') return Promise.resolve({ badges: [] })
      // Humor de hoje já registrado por padrão → seletor fica escondido.
      if (path === '/me/mood/today')
        return Promise.resolve({ day: '2026-06-30', mood: 'GOOD', note: null })
      return Promise.resolve({ items: [], nextCursor: null })
    })
  })

  // A saudação "Olá, {nome}!" mora no header global (AppLayout), não aqui.
  it('mostra mural, resenha e stats', async () => {
    wrap(<HomePage />)

    expect(screen.getByRole('heading', { name: /resenha do time/i })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /minhas conquistas/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /ver tudo/i })).toHaveAttribute('href', '/resenha')
    expect(await screen.findByRole('textbox')).toBeInTheDocument()
  })

  it('mostra o seletor de humor quando o humor de hoje ainda não foi registrado', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/periods/current') return Promise.resolve({ period: null })
      if (path === '/mural') return Promise.resolve({ items: [] })
      if (path === '/badges') return Promise.resolve({ badges: [] })
      if (path === '/users/u1/badges') return Promise.resolve({ badges: [] })
      if (path === '/me/mood/today')
        return Promise.resolve({ day: '2026-06-30', mood: null, note: null })
      return Promise.resolve({ items: [], nextCursor: null })
    })

    wrap(<HomePage />)

    expect(
      await screen.findByRole('heading', { name: /como você está se sentindo hoje/i }),
    ).toBeInTheDocument()
  })

  it('esconde a seção de Resenha quando a feature não está habilitada pro setor', async () => {
    mockUseAuth.mockReturnValue({
      user: baseUser({ sectorFeatures: ALL_FEATURES.filter((f) => f !== 'resenha') }),
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
      setUser: vi.fn(),
    })
    wrap(<HomePage />)
    await screen.findByRole('heading', { name: /minhas conquistas/i })
    expect(screen.queryByRole('heading', { name: /resenha do time/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /ver tudo/i })).not.toBeInTheDocument()
  })

  it('esconde "Minhas Conquistas" quando "votar" não está habilitada pro setor', async () => {
    mockUseAuth.mockReturnValue({
      user: baseUser({ sectorFeatures: ALL_FEATURES.filter((f) => f !== 'votar') }),
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
      setUser: vi.fn(),
    })
    wrap(<HomePage />)
    await screen.findByRole('heading', { name: /resenha do time/i })
    expect(screen.queryByRole('heading', { name: /minhas conquistas/i })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 7: Reescrever `MyStatsCard.test.tsx` com mock de `useAuth` configurável + 1 novo teste (falhando)**

Substituir o conteúdo de `apps/web/src/components/MyStatsCard.test.tsx` por:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import { MyStatsCard } from './MyStatsCard'
import { apiFetch } from '../lib/api'

const mockUseAuth = vi.fn()
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}))

function baseUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    name: 'Ana Silva',
    role: 'LEGEND',
    joinedAt: '2023-06-01T00:00:00.000Z',
    enabledFeatures: [],
    sectorFeatures: ['votar'],
    ...overrides,
  }
}

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})
const mockApiFetch = apiFetch as unknown as Mock

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

function badge(slug: string, name: string, current: number, target: number, kind = 'IMPACT'): unknown {
  return {
    id: slug, slug, name, description: 'd', kind, iconKey: 'k',
    threshold: target, categorySlug: null, requirement: 'r',
    progress: { current, target },
  }
}

describe('MyStatsCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAuth.mockReturnValue({ user: baseUser() })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(new Date('2026-06-29T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('mostra contagem de selos, anos de casa e top-3 por progresso', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/badges')
        return Promise.resolve({
          badges: [
            badge('a', 'Quase lá', 4, 5),    // 80%
            badge('b', 'No meio', 5, 10),     // 50%
            badge('c', 'Começando', 1, 10),   // 10%
            badge('d', 'Bem baixo', 1, 100),  // 1% — fica de fora do top-3
            badge('earned', 'Conquistado', 5, 5),
          ],
        })
      if (path === '/users/u1/badges')
        return Promise.resolve({ badges: [{ badge: { slug: 'earned' } }, { badge: { slug: 'x2' } }] })
      throw new Error(`unexpected ${path}`)
    })

    wrap(<MyStatsCard />)

    // 2 selos conquistados.
    expect(await screen.findByText('2')).toBeInTheDocument()
    // joinedAt 2023-06 → em 2026-06 = 3 anos.
    expect(screen.getByText(/3 anos de casa/i)).toBeInTheDocument()
    // Top-3 por progresso; o de 1% e o conquistado ficam de fora.
    expect(await screen.findByText('Quase lá')).toBeInTheDocument()
    expect(screen.getByText('No meio')).toBeInTheDocument()
    expect(screen.getByText('Começando')).toBeInTheDocument()
    expect(screen.queryByText('Bem baixo')).toBeNull()
    expect(screen.queryByText('Conquistado')).toBeNull()
    // Link para a galeria.
    expect(screen.getByRole('link', { name: /ver galeria completa/i })).toHaveAttribute('href', '/selos')
  })

  it('mostra só o próximo marco de tempo de casa, não a escada inteira', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/badges')
        return Promise.resolve({
          badges: [
            badge('t4', '4 anos de casa', 3, 4, 'TENURE'),
            badge('t5', '5 anos de casa', 3, 5, 'TENURE'),
            badge('t6', '6 anos de casa', 3, 6, 'TENURE'),
            badge('imp', 'Incansável', 5, 10, 'IMPACT'),
          ],
        })
      if (path === '/users/u1/badges') return Promise.resolve({ badges: [] })
      throw new Error(`unexpected ${path}`)
    })

    wrap(<MyStatsCard />)

    // Só o marco mais próximo (4 anos) aparece; 5 e 6 ficam de fora na Home.
    expect(await screen.findByText('4 anos de casa')).toBeInTheDocument()
    expect(screen.queryByText('5 anos de casa')).toBeNull()
    expect(screen.queryByText('6 anos de casa')).toBeNull()
    // Selos de outros tipos seguem normalmente.
    expect(screen.getByText('Incansável')).toBeInTheDocument()
  })

  it('esconde "Próximos selos" quando não há selos em progresso', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/badges') return Promise.resolve({ badges: [badge('earned', 'Conquistado', 5, 5)] })
      if (path === '/users/u1/badges') return Promise.resolve({ badges: [{ badge: { slug: 'earned' } }] })
      throw new Error(`unexpected ${path}`)
    })
    wrap(<MyStatsCard />)
    expect(await screen.findByText('1')).toBeInTheDocument()
    expect(screen.queryByText(/próximos selos/i)).toBeNull()
  })

  it('não renderiza quando "votar" não está habilitada pro setor', () => {
    mockUseAuth.mockReturnValue({ user: baseUser({ sectorFeatures: [] }) })
    wrap(<MyStatsCard />)
    expect(screen.queryByText('Minhas Conquistas')).toBeNull()
  })
})
```

- [ ] **Step 8: Rodar os dois arquivos e confirmar que falham (componentes ainda não fazem o gate)**

Run: `pnpm --filter @legends/web exec vitest run src/pages/HomePage.test.tsx src/components/MyStatsCard.test.tsx`
Expected: FAIL nos 2 novos testes de cada arquivo (a seção/card aparece mesmo sem a feature)

- [ ] **Step 9: Implementar o gate em `HomePage.tsx`**

Modify `apps/web/src/pages/HomePage.tsx`:

```tsx
import { Link } from 'react-router-dom'
import { MuralBanner } from '../components/MuralBanner'
import { MyStatsCard } from '../components/MyStatsCard'
import { VotingBanner } from '../components/VotingBanner'
import { Icon } from '../components/Icon'
import { useAuth } from '../auth/AuthContext'
import { effectiveFeatures } from '../lib/features'
import { MoodOfDay } from './profile/MoodOfDay'
import { ResenhaFeed } from './resenha/ResenhaFeed'

/** Home "pulso do time": votação + mural-hero + resenha & stats. A saudação
 * "Olá, {nome}!" vive no header global (AppLayout). */
export function HomePage() {
  const { user } = useAuth()
  const features = effectiveFeatures({
    role: user?.role,
    enabledFeatures: user?.enabledFeatures,
    sectorFeatures: user?.sectorFeatures,
  })
  return (
    <section className="mx-auto flex max-w-7xl flex-col gap-lg p-lg md:p-xl">
      <VotingBanner />
      <MuralBanner />

      {user && <MoodOfDay />}

      <div className="grid items-start gap-lg lg:grid-cols-[minmax(0,1fr)_320px]">
        {features.has('resenha') && (
          <div>
            <div className="mb-lg flex items-center justify-between gap-md">
              <h2 className="font-headline text-headline-md text-on-surface">Resenha do time</h2>
              <Link
                to="/resenha"
                className="group flex items-center gap-1 font-label text-label-md text-primary"
              >
                <span className="group-hover:underline">Ver tudo</span>
                <Icon
                  name="arrow_forward"
                  className="text-[16px] transition-transform group-hover:translate-x-0.5"
                />
              </Link>
            </div>
            <ResenhaFeed />
          </div>
        )}
        <MyStatsCard />
      </div>
    </section>
  )
}
```

- [ ] **Step 10: Implementar o gate em `MyStatsCard.tsx`**

Modify `apps/web/src/components/MyStatsCard.tsx` — no topo, adicionar o import:

```tsx
import { effectiveFeatures } from '../lib/features'
```

E no corpo da função, logo após `const { user } = useAuth()`, antes das duas `useQuery`, não
alterar nada (os hooks continuam incondicionais); alterar apenas o final da função, antes do
`return`:

```tsx
export function MyStatsCard() {
  const { user } = useAuth()

  const catalogQuery = useQuery({
    queryKey: ['badges'],
    queryFn: () => apiFetch<{ badges: BadgeCatalogEntryDTO[] }>('/badges'),
  })
  const earnedQuery = useQuery({
    queryKey: ['badges', 'me', user?.id],
    queryFn: () => apiFetch<{ badges: AwardedBadgeDTO[] }>(`/users/${user!.id}/badges`),
    enabled: Boolean(user),
  })

  const earnedSlugs = new Set(earnedQuery.data?.badges.map((e) => e.badge.slug))
  const earnedCount = earnedQuery.data?.badges.length ?? 0

  // Selos não conquistados com progresso mensurável.
  const candidates = (catalogQuery.data?.badges ?? []).filter(
    (b) => !earnedSlugs.has(b.slug) && b.progress && b.progress.target > 0,
  )
  // Os selos de tempo de casa formam uma escada (4, 5, 6 anos…) e apareceriam
  // todos de uma vez. Na Home exibimos só o próximo marco (o de menor alvo).
  const nextTenure = candidates
    .filter((b) => b.kind === 'TENURE')
    .reduce<BadgeCatalogEntryDTO | null>(
      (closest, b) =>
        !closest || b.progress!.target < closest.progress!.target ? b : closest,
      null,
    )
  const inProgress = candidates
    .filter((b) => b.kind !== 'TENURE' || b === nextTenure)
    .sort((a, b) => b.progress!.current / b.progress!.target - a.progress!.current / a.progress!.target)
    .slice(0, MAX_PROGRESS)

  const features = effectiveFeatures({
    role: user?.role,
    enabledFeatures: user?.enabledFeatures,
    sectorFeatures: user?.sectorFeatures,
  })
  if (!features.has('votar')) return null

  return (
    <aside
      data-testid="my-stats-card"
      className="flex flex-col gap-lg rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg"
    >
      {/* ... resto do JSX inalterado ... */}
    </aside>
  )
}
```

- [ ] **Step 11: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web exec vitest run src/pages/HomePage.test.tsx src/components/MyStatsCard.test.tsx src/components/nav-items.test.ts src/lib/features.test.ts`
Expected: PASS em todos

- [ ] **Step 12: Commit**

```bash
git add apps/web/src/lib/features.ts apps/web/src/lib/features.test.ts apps/web/src/components/nav-items.ts apps/web/src/pages/HomePage.tsx apps/web/src/components/MyStatsCard.tsx apps/web/src/pages/HomePage.test.tsx apps/web/src/components/MyStatsCard.test.tsx
git commit -m "feat(web): Home esconde Resenha e Minhas Conquistas quando a feature do setor esta desligada"
```

---

### Task 8: ProfilePage — esconder UI de votação quando `votar` está desligada no setor do perfil

**Files:**
- Modify: `apps/web/src/pages/ProfilePage.tsx`
- Modify: `apps/web/src/pages/ProfilePage.test.tsx`

**Interfaces:**
- Consumes: `ProfileDTO.votingEnabled` (Task 6).

- [ ] **Step 1: Adicionar `votingEnabled` ao fixture padrão e escrever os novos testes (falhando)**

Modify `apps/web/src/pages/ProfilePage.test.tsx`:

No objeto retornado por `/users/u1/profile` dentro de `setupFetch()` (o `Promise.resolve({...})`
que hoje termina em `actions: [...]`), adicionar o campo `votingEnabled: true` logo depois de
`actions`:

```ts
        actions: [
          {
            id: "a1",
            plan: "Documentar deploy",
            problem: "Daily foi cancelada sem aviso",
            note: null,
            dueDate: "2026-07-01",
            done: false,
            doneAt: null,
            sprint: 5,
            squad: "Core",
            roomId: "r1",
            auditStatus: null,
          },
        ],
        votingEnabled: true,
      });
```

No fixture do teste de LEAD (`"mostra galeria de selos e área de feedback no perfil de uma
liderança (LEAD)"`), adicionar `votingEnabled: true,` logo após `months: [],` (o valor é
irrelevante para LEAD, mas mantém o objeto no formato do tipo `ProfileDTO`):

```ts
          stats: { totalVotesReceived: 0, monthsRecognized: 0 },
          categoryBreakdown: [],
          months: [],
          votingEnabled: true,
          badges: [
```

Adicionar um novo `describe` ao final do arquivo (antes do fechamento do arquivo, fora do
`describe("ProfilePage", ...)` existente, para poder customizar `setupFetch` sem afetar os outros
testes):

```tsx
describe("ProfilePage — votar desligado no setor do perfil", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockImplementation((path: string) => {
      if (path === "/me/featured-badges") return Promise.resolve({ badges: [] });
      if (path === "/users/u1/profile") {
        return Promise.resolve({
          user: {
            id: "u1",
            name: "Bruno Lima",
            email: "b@e.com",
            role: "LEGEND",
            position: "Backend",
            squad: "Core",
            photoUrl: null,
            active: true,
            joinedAt: "2026-01-01T00:00:00.000Z",
          },
          stats: { totalVotesReceived: 3, monthsRecognized: 2 },
          categoryBreakdown: [
            { categorySlug: "colaboracao", categoryName: "Colaboração", count: 2 },
          ],
          months: ["2026-06"],
          badges: [],
          actions: [],
          votingEnabled: false,
        });
      }
      if (path.startsWith("/users/u1/votes")) return Promise.resolve({ votes: [], hasMore: false });
      if (path.startsWith("/users/u1/feedbacks")) return Promise.resolve({ feedbacks: [], hasMore: false });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
  });

  it("esconde Reconhecer, Impacto acumulado, aba Reconhecimentos e Categorias reconhecidas — mas mantém Selos e Feedbacks", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { name: "Bruno Lima" })).toBeInTheDocument();
    expect(screen.getByText("Galeria de selos")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Feedbacks" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Reconhecer/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Impacto acumulado")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reconhecimentos" })).not.toBeInTheDocument();
    expect(screen.queryByText("Histórico de reconhecimento")).not.toBeInTheDocument();
    expect(screen.queryByText("Categorias reconhecidas")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @legends/web exec vitest run src/pages/ProfilePage.test.tsx`
Expected: FAIL no novo `describe` (o componente hoje ignora `votingEnabled` e mostra tudo)

- [ ] **Step 3: Implementar o gate em `ProfilePage.tsx`**

Modify `apps/web/src/pages/ProfilePage.tsx`:

No destructuring da linha `const { user, stats, categoryBreakdown, badges, months } = profile;`:

```tsx
  const profile = profileQuery.data;
  const { user, stats, categoryBreakdown, badges, months, votingEnabled } = profile;
  // Lideranças (LEAD, MANAGER, HEAD) fazem parte do time e têm perfil/avatar,
  // mas nunca recebem votos — então as áreas de reconhecimento ficam ocultas.
  const isLead = isLeaderRole(user.role);
  // A parte de votação/reconhecimento (botão Reconhecer, Impacto acumulado, aba
  // Reconhecimentos, Categorias reconhecidas) também some se o SETOR DO DONO DO
  // PERFIL não tem a feature "votar" habilitada — sem isso não há voto real por trás.
  const showRecognition = !isLead && votingEnabled;
  const effectiveView = showRecognition ? profileView : "feedbacks";
```

No botão "Reconhecer" (trecho que hoje começa com `{!isLead && (` logo antes de
`<Link to="/votar" ...>`):

```tsx
                {showRecognition && (
                  <Link
                    to="/votar"
                    className="inline-flex items-center gap-sm rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary transition-all hover:bg-primary-container active:scale-[0.98]"
                  >
                    <Icon name="how_to_vote" className="text-[18px]" />
                    Reconhecer
                  </Link>
                )}
```

No painel "Impacto acumulado" (trecho que hoje começa com
`{/* Resumo de impacto — só para quem recebe reconhecimento */} {!isLead && (`):

```tsx
            {/* Resumo de impacto — só para quem recebe reconhecimento */}
            {showRecognition && (
              <div className="col-span-12 flex flex-col gap-lg rounded-xl border border-primary/20 bg-primary/5 p-lg lg:col-span-4">
                {/* ...conteúdo inalterado... */}
              </div>
            )}
```

No bloco da coluna direita (troca só a condição do ternário interno e o `headerAction`; o wrapper
externo continua `{!isLead && (`):

```tsx
              <div className="col-span-12 rounded-xl border border-outline-variant/40 bg-surface-container p-lg lg:col-span-7">
                {effectiveView === "reconhecimentos" ? (
                  /* Histórico de reconhecimento */
                  <div>
                    {/* ...conteúdo inalterado (inclui o ViewToggle interno, que só
                        renderiza quando effectiveView já é "reconhecimentos" —
                        ou seja, só quando showRecognition é true)... */}
                  </div>
                ) : (
                  <FeedbackSection
                    targetId={user.id}
                    embedded
                    highlightId={highlightFeedbackId}
                    headerAction={
                      showRecognition ? (
                        <ViewToggle value={profileView} onChange={setProfileView} />
                      ) : undefined
                    }
                  />
                )}
              </div>
```

E no bloco "Categorias reconhecidas":

```tsx
              {effectiveView === "reconhecimentos" && (
                /* Categorias reconhecidas (barras) */
                <div className="col-span-12 rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
                  {/* ...conteúdo inalterado... */}
                </div>
              )}
```

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `pnpm --filter @legends/web exec vitest run src/pages/ProfilePage.test.tsx`
Expected: PASS (todos, incluindo o teste de LEAD e o novo describe)

- [ ] **Step 5: Typecheck do workspace web**

Run: `pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros — confirma que `ProfileDTO.votingEnabled` (Task 6) está sendo consumido com o
tipo certo

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/ProfilePage.tsx apps/web/src/pages/ProfilePage.test.tsx
git commit -m "feat(web): ProfilePage esconde UI de votacao quando o setor do perfil nao tem votar habilitada"
```

---

### Task 9: Verificação final

**Files:** nenhum (só execução)

- [ ] **Step 1: Subir o Postgres de teste**

Run: `pnpm db:up`
Expected: container sobe (ou já está de pé)

- [ ] **Step 2: Rodar a suíte completa**

Run: `pnpm test`
Expected: todos os workspaces (`@legends/shared`, `@legends/api`, `@legends/web`) passam

- [ ] **Step 3: Typecheck de cada workspace (build não faz typecheck — ver nota do repo)**

Run: `pnpm --filter @legends/shared exec tsc --noEmit && pnpm --filter @legends/api exec tsc --noEmit && pnpm --filter @legends/web exec tsc --noEmit`
Expected: sem erros nos 3 workspaces

- [ ] **Step 4: Build**

Run: `pnpm build`
Expected: sucesso

- [ ] **Step 5: Revisão manual rápida (opcional, se o dev server estiver disponível)**

Suba `pnpm dev`, logue com um usuário do setor default, confirme que Resenha e Minhas Conquistas
aparecem normalmente; crie (via admin) um setor sem `votar`/`resenha` e um usuário nele, logue como
esse usuário e confirme que a Home não mostra Resenha nem Minhas Conquistas, e que o perfil dele
(visto por outro usuário) não mostra Reconhecer/Impacto acumulado/aba Reconhecimentos.

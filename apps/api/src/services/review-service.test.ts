import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { createSector } from './sector-service'
import { createReview, listFeed, ReviewError, createComment, deleteComment, deleteReview, listComments, listReviewPollVotes, toggleCommentReaction, toggleReviewReaction, shareReview, unshareReview, getReviewForViewer, voteReviewPoll } from './review-service'
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
    const review = await createReview({ authorId: u.id, content: '  Olá time!  ', companyId: DEFAULT_COMPANY_ID })
    expect(review.content).toBe('Olá time!')
    expect(review.author.id).toBe(u.id)
  })

  it('rejeita conteúdo vazio e acima de 280 (ReviewError 400)', async () => {
    const u = await makeUser('b@empresa.com')
    await expect(createReview({ authorId: u.id, content: '   ', companyId: DEFAULT_COMPANY_ID })).rejects.toBeInstanceOf(ReviewError)
    await expect(createReview({ authorId: u.id, content: 'x'.repeat(281), companyId: DEFAULT_COMPANY_ID })).rejects.toBeInstanceOf(ReviewError)
  })

  it('pagina o feed por cursor, mais novo primeiro, sem duplicar', async () => {
    const u = await makeUser('c@empresa.com')
    for (let i = 0; i < 5; i++) await createReview({ authorId: u.id, content: `r${i}`, companyId: DEFAULT_COMPANY_ID })

    const page1 = await listFeed(u.id, DEFAULT_COMPANY_ID, SECTOR, { limit: 2 })
    expect(page1.items).toHaveLength(2)
    expect(page1.items[0].content).toBe('r4')
    expect(page1.nextCursor).toBeTruthy()

    const page2 = await listFeed(u.id, DEFAULT_COMPANY_ID, SECTOR, { cursor: page1.nextCursor!, limit: 2 })
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
    await createReview({ authorId: active.id, content: 'visível', companyId: DEFAULT_COMPANY_ID })
    // criar resenha diretamente no banco para contornar a validação de autor ativo em createReview
    await prisma.review.create({ data: { authorId: inactive.id, content: 'invisível', sectorId: SECTOR } })

    const feed = await listFeed(viewer.id, DEFAULT_COMPANY_ID, SECTOR, { limit: 10 })
    expect(feed.items.map((r) => r.content)).toContain('visível')
    expect(feed.items.map((r) => r.content)).not.toContain('invisível')
  })

  it('marca sharedReviewIds para o viewer', async () => {
    const u = await makeUser('d@empresa.com')
    const r = await createReview({ authorId: u.id, content: 'compartilhável', companyId: DEFAULT_COMPANY_ID })
    await prisma.reviewShare.create({ data: { reviewId: r.id, userId: u.id, sectorId: SECTOR } })
    const feed = await listFeed(u.id, DEFAULT_COMPANY_ID, SECTOR, { limit: 10 })
    expect(feed.sharedReviewIds.has(r.id)).toBe(true)
  })
})

describe('review-service: comentários e exclusão', () => {
  it('cria comentário e calcula destinatários de reply (distintos, sem ator nem autor da resenha)', async () => {
    const author = await makeUser('rauthor@empresa.com')
    const p1 = await makeUser('p1@empresa.com')
    const p2 = await makeUser('p2@empresa.com')
    const review = await createReview({ authorId: author.id, content: 'thread', companyId: DEFAULT_COMPANY_ID })

    // p1 comenta (sem participantes anteriores)
    const first = await createComment({ reviewId: review.id, authorId: p1.id, viewerSectorId: SECTOR, content: 'oi', companyId: DEFAULT_COMPANY_ID })
    expect(first.reviewAuthorId).toBe(author.id)
    expect(first.replyRecipientIds).toEqual([])

    // p1 comenta de novo: participante anterior é p1 (== ator) → filtrado
    const again = await createComment({ reviewId: review.id, authorId: p1.id, viewerSectorId: SECTOR, content: 'de novo', companyId: DEFAULT_COMPANY_ID })
    expect(again.replyRecipientIds).toEqual([])

    // p2 comenta: participante anterior p1 entra; author é o autor da resenha (não duplica)
    const third = await createComment({ reviewId: review.id, authorId: p2.id, viewerSectorId: SECTOR, content: 'cheguei', companyId: DEFAULT_COMPANY_ID })
    expect(third.replyRecipientIds).toEqual([p1.id])

    // author comenta na própria resenha: participantes anteriores p1,p2; nenhum é o ator
    const byAuthor = await createComment({ reviewId: review.id, authorId: author.id, viewerSectorId: SECTOR, content: 'valeu', companyId: DEFAULT_COMPANY_ID })
    expect(byAuthor.replyRecipientIds.sort()).toEqual([p1.id, p2.id].sort())
  })

  it('lista comentários do mais antigo ao mais novo com hasMore via take+1', async () => {
    const author = await makeUser('lc@empresa.com')
    const review = await createReview({ authorId: author.id, content: 'r', companyId: DEFAULT_COMPANY_ID })
    for (let i = 0; i < 3; i++) {
      await createComment({ reviewId: review.id, authorId: author.id, viewerSectorId: SECTOR, content: `c${i}`, companyId: DEFAULT_COMPANY_ID })
    }
    const rows = await listComments(review.id, DEFAULT_COMPANY_ID, SECTOR, { offset: 0, limit: 2 })
    expect(rows).toHaveLength(3) // take = limit + 1
    expect(rows[0].content).toBe('c0')
  })

  it('deleteReview: autor 204, terceiro 403, admin ok, inexistente 404', async () => {
    const author = await makeUser('dr@empresa.com')
    const stranger = await makeUser('str@empresa.com')
    const review = await createReview({ authorId: author.id, content: 'apagar', companyId: DEFAULT_COMPANY_ID })

    await expect(
      deleteReview({ reviewId: review.id, userId: stranger.id, role: 'LEGEND', companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR }),
    ).rejects.toMatchObject({ status: 403 })
    await deleteReview({ reviewId: review.id, userId: author.id, role: 'LEGEND', companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR })
    expect(await prisma.review.count()).toBe(0)
    await expect(
      deleteReview({ reviewId: 'nope', userId: author.id, role: 'ADMIN', companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('deleteReview: SUBADMIN também pode excluir resenha de terceiro', async () => {
    const author = await makeUser('dr-sub@empresa.com')
    const review = await createReview({ authorId: author.id, content: 'apagar via subadmin', companyId: DEFAULT_COMPANY_ID })
    await deleteReview({ reviewId: review.id, userId: 'someone', role: 'SUBADMIN', companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR })
    expect(await prisma.review.count()).toBe(0)
  })

  it('deleteComment: admin pode excluir comentário de terceiro', async () => {
    const author = await makeUser('dc@empresa.com')
    const review = await createReview({ authorId: author.id, content: 'r', companyId: DEFAULT_COMPANY_ID })
    const c = await createComment({ reviewId: review.id, authorId: author.id, viewerSectorId: SECTOR, content: 'x', companyId: DEFAULT_COMPANY_ID })
    await deleteComment({ commentId: c.comment.id, userId: 'someone', role: 'ADMIN', companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR })
    expect(await prisma.reviewComment.count()).toBe(0)
  })

  it('deleteComment: SUBADMIN também pode excluir comentário de terceiro', async () => {
    const author = await makeUser('dc-sub@empresa.com')
    const review = await createReview({ authorId: author.id, content: 'r', companyId: DEFAULT_COMPANY_ID })
    const c = await createComment({ reviewId: review.id, authorId: author.id, viewerSectorId: SECTOR, content: 'x', companyId: DEFAULT_COMPANY_ID })
    await deleteComment({ commentId: c.comment.id, userId: 'someone', role: 'SUBADMIN', companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR })
    expect(await prisma.reviewComment.count()).toBe(0)
  })

  it('deleteComment retorna o reviewId do comentário removido', async () => {
    const author = await makeUser('ana-del@empresa.com')
    const review = await createReview({ authorId: author.id, content: 'oi', companyId: DEFAULT_COMPANY_ID })
    const { comment } = await createComment({ reviewId: review.id, authorId: author.id, viewerSectorId: SECTOR, content: 'comentário', companyId: DEFAULT_COMPANY_ID })

    const result = await deleteComment({ commentId: comment.id, userId: author.id, role: 'COLLABORATOR', companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR })

    expect(result.reviewId).toBe(review.id)
  })
})

describe('review-service: reações', () => {
  it('toggle de reação na resenha é idempotente (add → remove)', async () => {
    const u = await makeUser('rr@empresa.com')
    const review = await createReview({ authorId: u.id, content: 'reagir', companyId: DEFAULT_COMPANY_ID })

    const add = await toggleReviewReaction({ reviewId: review.id, userId: u.id, emoji: '😂', companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR })
    expect(add.added).toBe(true)
    expect(add.review.reactions).toHaveLength(1)

    const remove = await toggleReviewReaction({ reviewId: review.id, userId: u.id, emoji: '😂', companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR })
    expect(remove.added).toBe(false)
    expect(remove.review.reactions).toHaveLength(0)
  })

  it('rejeita emoji fora do conjunto (400)', async () => {
    const u = await makeUser('rrx@empresa.com')
    const review = await createReview({ authorId: u.id, content: 'x', companyId: DEFAULT_COMPANY_ID })
    await expect(
      toggleReviewReaction({ reviewId: review.id, userId: u.id, emoji: '🍕', companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('toggle de reação no comentário funciona', async () => {
    const u = await makeUser('cr@empresa.com')
    const review = await createReview({ authorId: u.id, content: 'r', companyId: DEFAULT_COMPANY_ID })
    const { comment } = await createComment({ reviewId: review.id, authorId: u.id, viewerSectorId: SECTOR, content: 'c', companyId: DEFAULT_COMPANY_ID })
    const res = await toggleCommentReaction({ commentId: comment.id, userId: u.id, emoji: '😂', companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR })
    expect(res.comment.reactions).toHaveLength(1)
  })
})

describe('review-service: compartilhamento', () => {
  it('compartilha (idempotente) e descompartilha', async () => {
    const author = await makeUser('sa@empresa.com')
    const sharer = await makeUser('sh@empresa.com')
    const review = await createReview({ authorId: author.id, content: 'mural!', companyId: DEFAULT_COMPANY_ID })

    const first = await shareReview({ reviewId: review.id, userId: sharer.id, companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR })
    expect(first.created).toBe(true)
    expect(first.reviewAuthorId).toBe(author.id)

    const again = await shareReview({ reviewId: review.id, userId: sharer.id, companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR })
    expect(again.created).toBe(false)
    expect(await prisma.reviewShare.count()).toBe(1)

    await unshareReview({ reviewId: review.id, userId: sharer.id, companyId: DEFAULT_COMPANY_ID })
    expect(await prisma.reviewShare.count()).toBe(0)
  })

  it('404 ao compartilhar resenha inexistente', async () => {
    const u = await makeUser('s404@empresa.com')
    await expect(
      shareReview({ reviewId: 'nope', userId: u.id, companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR }),
    ).rejects.toMatchObject({ status: 404 })
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
      companyId: DEFAULT_COMPANY_ID,
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
      companyId: DEFAULT_COMPANY_ID,
    })
    expect(review.mentions).toHaveLength(10)
  })

  it('comentário também grava menções no DTO', async () => {
    const author = await makeUser('mc-author@empresa.com')
    const alvo = await makeUser('mc-alvo@empresa.com')
    const review = await createReview({ authorId: author.id, content: 'r', companyId: DEFAULT_COMPANY_ID })
    const { comment } = await createComment({
      reviewId: review.id,
      authorId: author.id,
      viewerSectorId: SECTOR,
      content: `e aí @${alvo.name}`,
      mentionedUserIds: [alvo.id],
      companyId: DEFAULT_COMPANY_ID,
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
      companyId: DEFAULT_COMPANY_ID,
    })
    expect(review.mentions).toHaveLength(0)
  })

  it('menção criada em resenha de empresa não-default herda o companyId real (não o default do banco)', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Empresa Nao Default Mencao', slug: 'empresa-nao-default-mencao-test' } })
    const author = await prisma.user.create({
      data: { name: 'AutorEmpresaNaoDefault', email: 'autor-empresa-nao-default@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    const mentioned = await prisma.user.create({
      data: { name: 'MencionadoEmpresaNaoDefault', email: 'mencionado-empresa-nao-default@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    const review = await createReview({
      authorId: author.id,
      content: 'oi @mencionado',
      mentionedUserIds: [mentioned.id],
      companyId: otherCompany.id,
    })
    const mention = await prisma.reviewMention.findFirstOrThrow({ where: { reviewId: review.id } })
    expect(mention.companyId).toBe(otherCompany.id)
  })

  it('menção criada em comentário de empresa não-default herda o companyId real', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Empresa Nao Default Mencao Comentario', slug: 'empresa-nao-default-mencao-comentario-test' } })
    const author = await prisma.user.create({
      data: { name: 'AutorComentarioEmpresaNaoDefault', email: 'autor-comentario-empresa-nao-default@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    const mentioned = await prisma.user.create({
      data: { name: 'MencionadoComentarioEmpresaNaoDefault', email: 'mencionado-comentario-empresa-nao-default@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    const review = await createReview({ authorId: author.id, content: 'r', companyId: otherCompany.id })
    const { comment } = await createComment({
      reviewId: review.id,
      authorId: author.id,
      viewerSectorId: author.sectorId,
      content: 'e aí @mencionado',
      mentionedUserIds: [mentioned.id],
      companyId: otherCompany.id,
    })
    const mention = await prisma.reviewCommentMention.findFirstOrThrow({ where: { commentId: comment.id } })
    expect(mention.companyId).toBe(otherCompany.id)
  })
})

describe('review-service: gif', () => {
  it('cria resenha com gif (texto + gif)', async () => {
    const u = await makeUser('gif1@empresa.com')
    const review = await createReview({
      authorId: u.id,
      content: 'olha esse',
      gif: { url: 'https://media.giphy.com/x.gif', width: 100, height: 80 },
      companyId: DEFAULT_COMPANY_ID,
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
      companyId: DEFAULT_COMPANY_ID,
    })
    expect(review.content).toBe('')
    expect(review.gifUrl).toBe('https://media.giphy.com/y.gif')
  })

  it('rejeita vazio sem gif (400)', async () => {
    const u = await makeUser('gif3@empresa.com')
    await expect(createReview({ authorId: u.id, content: '   ', companyId: DEFAULT_COMPANY_ID })).rejects.toMatchObject({ status: 400 })
  })

  it('rejeita gif de host fora da allowlist (400)', async () => {
    const u = await makeUser('gif4@empresa.com')
    await expect(
      createReview({
        authorId: u.id,
        content: 'x',
        gif: { url: 'https://evil.example/z.gif', width: 1, height: 1 },
        companyId: DEFAULT_COMPANY_ID,
      }),
    ).rejects.toMatchObject({ status: 400 })
    expect(isGiphyHost('media.giphy.com')).toBe(true)
  })

  it('cria comentário só com gif (sem texto)', async () => {
    const author = await makeUser('gif-comment@empresa.com')
    const review = await createReview({ authorId: author.id, content: 'r', companyId: DEFAULT_COMPANY_ID })
    const result = await createComment({
      reviewId: review.id,
      authorId: author.id,
      viewerSectorId: SECTOR,
      content: '',
      gif: { url: 'https://media.giphy.com/c.gif', width: 50, height: 40 },
      companyId: DEFAULT_COMPANY_ID,
    })
    expect(result.comment.gifUrl).toBe('https://media.giphy.com/c.gif')
    expect(result.comment.gifWidth).toBe(50)
    expect(result.comment.gifHeight).toBe(40)
  })
})

describe('review-service: imagem anexada', () => {
  it('persiste a imagem na resenha', async () => {
    const u = await makeUser('img1@empresa.com')
    const review = await createReview({ authorId: u.id, content: '', image: IMG, companyId: DEFAULT_COMPANY_ID })
    expect(review.imageUrl).toBe(IMG.url)
    expect(review.imageWidth).toBe(100)
    expect(review.imageHeight).toBe(80)
  })

  it('aceita só imagem, sem texto', async () => {
    const u = await makeUser('img2@empresa.com')
    await expect(
      createReview({ authorId: u.id, content: '   ', image: IMG, companyId: DEFAULT_COMPANY_ID }),
    ).resolves.toBeTruthy()
  })

  it('rejeita imagem e gif juntos (400)', async () => {
    const u = await makeUser('img3@empresa.com')
    const gif = { url: 'https://media.giphy.com/a.gif', width: 10, height: 10 }
    await expect(
      createReview({ authorId: u.id, content: 'oi', gif, image: IMG, companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toBeInstanceOf(ReviewError)
  })

  it('rejeita imagem de host fora do bucket (400)', async () => {
    const u = await makeUser('img4@empresa.com')
    const evil = { url: 'https://evil.com/x.png', width: 10, height: 10 }
    await expect(
      createReview({ authorId: u.id, content: 'oi', image: evil, companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toBeInstanceOf(ReviewError)
  })

  it('persiste imagem no comentário', async () => {
    const author = await makeUser('img5@empresa.com')
    const review = await createReview({ authorId: author.id, content: 'post', companyId: DEFAULT_COMPANY_ID })
    const { comment } = await createComment({ reviewId: review.id, authorId: author.id, viewerSectorId: SECTOR, content: '', image: IMG, companyId: DEFAULT_COMPANY_ID })
    expect(comment.imageUrl).toBe(IMG.url)
  })
})

describe('review-service: getReviewForViewer escopado por empresa', () => {
  it('lança erro pra resenha de outra empresa', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Review', slug: 'outra-empresa-review-test' } })
    const author = await prisma.user.create({
      data: { name: 'AutorOutraEmpresaReview', email: 'autor-outra-empresa-review@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    const review = await prisma.review.create({
      data: { authorId: author.id, content: 'de outra empresa', companyId: otherCompany.id, sectorId: SECTOR },
    })
    const viewer = await makeUser('viewer-review-empresa@x.com')

    await expect(getReviewForViewer(review.id, viewer.id, DEFAULT_COMPANY_ID, SECTOR)).rejects.toThrow()
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

describe('mutações de resenha escopadas por empresa', () => {
  it('deleteReview/toggleReviewReaction/shareReview/createComment tratam resenha de outra empresa como inexistente (404)', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Review Mutacao', slug: 'outra-empresa-review-mutacao-test' } })
    const author = await prisma.user.create({
      data: { name: 'AutorOutraEmpresaMutacao', email: 'autor-outra-empresa-mutacao@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    const review = await prisma.review.create({
      data: { authorId: author.id, content: 'de outra empresa', companyId: otherCompany.id, sectorId: SECTOR },
    })
    const actor = await makeUser('ator-mutacao-empresa@x.com')

    await expect(
      deleteReview({ reviewId: review.id, userId: actor.id, role: 'ADMIN', companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      toggleReviewReaction({ reviewId: review.id, userId: actor.id, emoji: '😂', companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      shareReview({ reviewId: review.id, userId: actor.id, companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      createComment({ reviewId: review.id, authorId: actor.id, viewerSectorId: SECTOR, content: 'comentário', companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('review-service: isolamento por setor', () => {
  it('listFeed não retorna resenha de outro setor', async () => {
    const viewer = await makeUser('iso-viewer@empresa.com')
    const outro = await makeUserInOtherSector('iso-outro@empresa.com')
    await createReview({ authorId: outro.id, content: 'resenha de outro setor', companyId: DEFAULT_COMPANY_ID })
    const feed = await listFeed(viewer.id, DEFAULT_COMPANY_ID, SECTOR, { limit: 10 })
    expect(feed.items.map((r) => r.content)).not.toContain('resenha de outro setor')
  })

  it('getReviewForViewer/deleteReview/comentar/reagir/compartilhar em resenha de outro setor: 404', async () => {
    const outroAuthor = await makeUserInOtherSector('iso-author@empresa.com')
    const viewer = await makeUser('iso-actor@empresa.com')
    const review = await createReview({ authorId: outroAuthor.id, content: 'privada do outro setor', companyId: DEFAULT_COMPANY_ID })

    await expect(getReviewForViewer(review.id, viewer.id, DEFAULT_COMPANY_ID, SECTOR)).rejects.toMatchObject({ status: 404 })
    await expect(
      deleteReview({ reviewId: review.id, userId: viewer.id, role: 'ADMIN', companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      createComment({ reviewId: review.id, authorId: viewer.id, viewerSectorId: SECTOR, content: 'oi', companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      toggleReviewReaction({ reviewId: review.id, userId: viewer.id, emoji: '😂', companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      shareReview({ reviewId: review.id, userId: viewer.id, companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(listComments(review.id, DEFAULT_COMPANY_ID, SECTOR, { offset: 0, limit: 10 })).rejects.toMatchObject({ status: 404 })
  })

  it('deleteComment/toggleCommentReaction em comentário de resenha de outro setor: 404', async () => {
    const outroAuthor = await makeUserInOtherSector('iso-c-author@empresa.com')
    const viewer = await makeUser('iso-c-actor@empresa.com')
    const review = await createReview({ authorId: outroAuthor.id, content: 'r', companyId: DEFAULT_COMPANY_ID })
    const { comment } = await createComment({
      reviewId: review.id,
      authorId: outroAuthor.id,
      viewerSectorId: outroAuthor.sectorId,
      content: 'c',
      companyId: DEFAULT_COMPANY_ID,
    })

    await expect(
      deleteComment({ commentId: comment.id, userId: viewer.id, role: 'ADMIN', companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      toggleCommentReaction({ commentId: comment.id, userId: viewer.id, emoji: '😂', companyId: DEFAULT_COMPANY_ID, sectorId: SECTOR }),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('review-service: enquetes', () => {
  it('cria enquete sem texto, normaliza pergunta/opções e cascateia com a resenha', async () => {
    const author = await makeUser('poll-author@empresa.com')
    const review = await createReview({
      authorId: author.id,
      content: '',
      poll: { question: '  Qual tema?  ', options: [' TypeScript ', ' React '] },
      companyId: DEFAULT_COMPANY_ID,
    })

    expect(review.poll?.question).toBe('Qual tema?')
    expect(review.poll?.options.map((option) => option.text)).toEqual(['TypeScript', 'React'])

    await prisma.review.delete({ where: { id: review.id } })
    expect(await prisma.reviewPoll.count()).toBe(0)
    expect(await prisma.reviewPollOption.count()).toBe(0)
  })

  it('rejeita opções repetidas e enquete junto de outro anexo', async () => {
    const author = await makeUser('poll-invalid@empresa.com')
    await expect(
      createReview({
        authorId: author.id,
        content: '',
        poll: { question: 'Escolha', options: ['React', ' react '] },
        companyId: DEFAULT_COMPANY_ID,
      }),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      createReview({
        authorId: author.id,
        content: 'Escolha',
        gif: { url: 'https://media.giphy.com/a.gif', width: 10, height: 10 },
        poll: { question: 'Escolha', options: ['A', 'B'] },
        companyId: DEFAULT_COMPANY_ID,
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('registra um voto por usuário e rejeita segundo voto com 409', async () => {
    const author = await makeUser('poll-vote-author@empresa.com')
    const voter = await makeUser('poll-voter@empresa.com')
    const review = await createReview({
      authorId: author.id,
      content: '',
      poll: { question: 'Escolha', options: ['A', 'B'] },
      companyId: DEFAULT_COMPANY_ID,
    })
    const optionId = review.poll!.options[0].id

    const result = await voteReviewPoll({
      reviewId: review.id,
      optionId,
      userId: voter.id,
      companyId: DEFAULT_COMPANY_ID,
      sectorId: SECTOR,
    })
    expect(result.review.poll?.votes).toEqual([{ optionId }])
    expect(result.review.poll?.options[0]._count.votes).toBe(1)

    await expect(
      voteReviewPoll({
        reviewId: review.id,
        optionId: review.poll!.options[1].id,
        userId: voter.id,
        companyId: DEFAULT_COMPANY_ID,
        sectorId: SECTOR,
      }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('não aceita opção de outra enquete nem enquete de outro setor', async () => {
    const author = await makeUser('poll-scope-author@empresa.com')
    const voter = await makeUser('poll-scope-voter@empresa.com')
    const first = await createReview({
      authorId: author.id,
      content: '',
      poll: { question: 'Primeira', options: ['A', 'B'] },
      companyId: DEFAULT_COMPANY_ID,
    })
    const second = await createReview({
      authorId: author.id,
      content: '',
      poll: { question: 'Segunda', options: ['C', 'D'] },
      companyId: DEFAULT_COMPANY_ID,
    })
    await expect(
      voteReviewPoll({
        reviewId: first.id,
        optionId: second.poll!.options[0].id,
        userId: voter.id,
        companyId: DEFAULT_COMPANY_ID,
        sectorId: SECTOR,
      }),
    ).rejects.toMatchObject({ status: 404 })

    const outsider = await makeUserInOtherSector('poll-other-sector@empresa.com')
    await expect(
      voteReviewPoll({
        reviewId: first.id,
        optionId: first.poll!.options[0].id,
        userId: outsider.id,
        companyId: DEFAULT_COMPANY_ID,
        sectorId: outsider.sectorId,
      }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('só lista os votantes depois que o viewer vota e agrupa por opção', async () => {
    const author = await makeUser('poll-list-author@empresa.com')
    const viewer = await makeUser('poll-list-viewer@empresa.com')
    const review = await createReview({
      authorId: author.id,
      content: '',
      poll: { question: 'Escolha', options: ['A', 'B'] },
      companyId: DEFAULT_COMPANY_ID,
    })

    await expect(
      listReviewPollVotes({
        reviewId: review.id,
        viewerId: viewer.id,
        companyId: DEFAULT_COMPANY_ID,
        sectorId: SECTOR,
      }),
    ).rejects.toMatchObject({ status: 403 })

    await voteReviewPoll({
      reviewId: review.id,
      optionId: review.poll!.options[1].id,
      userId: viewer.id,
      companyId: DEFAULT_COMPANY_ID,
      sectorId: SECTOR,
    })
    const poll = await listReviewPollVotes({
      reviewId: review.id,
      viewerId: viewer.id,
      companyId: DEFAULT_COMPANY_ID,
      sectorId: SECTOR,
    })
    expect(poll.options[0].votes).toHaveLength(0)
    expect(poll.options[1].votes.map((vote) => vote.user.id)).toEqual([viewer.id])
  })
})

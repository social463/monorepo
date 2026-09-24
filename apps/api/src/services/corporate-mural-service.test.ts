import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID, type RichDoc } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'
import { createSector } from './sector-service'
import {
  CorporateMuralError,
  approvePost,
  createComment,
  createPost,
  deleteComment,
  deletePost,
  getPost,
  listComments,
  listFeed,
  listPendingPosts,
  markPostRead,
  pinPost,
  rejectPost,
  toggleCommentReaction,
  togglePostReaction,
  unpinPost,
  updatePost,
  voteCorporatePostPoll,
  listCorporatePostPollVotes,
  type CorporateMuralViewer,
} from './corporate-mural-service'

const SECTOR = 'sector-dev-produto'

async function makeUser(email: string, role = 'LEAD', sectorId = SECTOR) {
  return prisma.user.create({
    data: { name: email.split('@')[0], email, passwordHash: 'x', role: role as never, sectorId },
  })
}

async function makeAdminActor() {
  return prisma.user.create({
    data: { name: 'admin', email: `admin-${Math.random()}@empresa.com`, passwordHash: 'x', role: 'ADMIN' },
  })
}

/** Cria um 2º setor e um usuário nele — usado no recorte de público-alvo. */
async function makeUserInOtherSector(email: string, role = 'LEAD') {
  const admin = await makeAdminActor()
  const sector = await createSector(
    { name: `Outro Setor ${Math.random()}`, enabledFeatures: [], roles: [] },
    admin.id,
    DEFAULT_COMPANY_ID,
  )
  return makeUser(email, role, sector.id)
}

/** Viewer a partir de um usuário do banco — é o que o service recebe da rota. */
function viewerOf(user: { id: string; role: string; sectorId: string; companyId: string }): CorporateMuralViewer {
  return {
    userId: user.id,
    role: user.role,
    sectorId: user.sectorId,
    companyId: user.companyId,
  }
}

function doc(...lines: string[]): RichDoc {
  return { blocks: lines.map((text) => ({ type: 'paragraph' as const, spans: [{ text }] })) }
}

describe('corporate-mural-service: quem publica direto e quem cai na fila', () => {
  it.each(['ADMIN', 'SUBADMIN'])('%s publica direto', async (role) => {
    const u = await makeUser(`pub-${role.toLowerCase()}@empresa.com`, role)
    const post = await createPost({ authorId: u.id, content: 'comunicado', companyId: DEFAULT_COMPANY_ID })
    expect(post.status).toBe('PUBLISHED')
  })

  // A mudança de fundo desta rodada: escrever deixou de ser privilégio, então
  // ninguém mais leva 403 aqui — o papel decide se sai publicado ou pendente.
  it.each(['LEAD', 'MANAGER', 'HEAD', 'LEGEND', 'THIRD_PARTY'])('%s escreve, mas fica pendente', async (role) => {
    const u = await makeUser(`fila-${role.toLowerCase()}@empresa.com`, role)
    const post = await createPost({ authorId: u.id, content: 'posso?', companyId: DEFAULT_COMPANY_ID })
    expect(post.status).toBe('PENDING')
  })

  it('acesso administrativo delegado publica direto mesmo sendo lenda', async () => {
    const u = await prisma.user.create({
      data: {
        name: 'delegado',
        email: 'delegado-feed@empresa.com',
        passwordHash: 'x',
        role: 'LEGEND',
        adminAccess: true,
      },
    })
    const post = await createPost({ authorId: u.id, content: 'com acesso', companyId: DEFAULT_COMPANY_ID })
    expect(post.status).toBe('PUBLISHED')
  })

  it('post pendente não entra no feed nem para o próprio autor', async () => {
    const autor = await makeUser('pendente-autor@empresa.com', 'LEGEND')
    await createPost({ authorId: autor.id, content: 'aguardando', companyId: DEFAULT_COMPANY_ID })

    const feed = await listFeed(viewerOf(autor), { limit: 10 })
    expect(feed.items.map((p) => p.content)).not.toContain('aguardando')

    // Ele não some: aparece em "Meus envios", que é onde o estado faz sentido.
    const mine = await listPendingPosts(viewerOf(autor))
    expect(mine.map((p) => p.content)).toEqual(['aguardando'])
  })
})

describe('corporate-mural-service: createPost + listFeed', () => {
  it('trima o conteúdo e rejeita vazio ou acima do limite do corpo', async () => {
    const u = await makeUser('conteudo@empresa.com', 'ADMIN')
    const post = await createPost({ authorId: u.id, content: '  Bom dia!  ', companyId: DEFAULT_COMPANY_ID })
    expect(post.content).toBe('Bom dia!')
    await expect(createPost({ authorId: u.id, content: '   ', companyId: DEFAULT_COMPANY_ID })).rejects.toBeInstanceOf(
      CorporateMuralError,
    )
    await expect(
      createPost({ authorId: u.id, content: 'x'.repeat(5_001), companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toBeInstanceOf(CorporateMuralError)
  })

  it('deriva o texto puro do documento rico e guarda os dois', async () => {
    const u = await makeUser('rico@empresa.com', 'ADMIN')
    const post = await createPost({
      authorId: u.id,
      title: '  Novidade  ',
      body: { blocks: [{ type: 'paragraph', spans: [{ text: 'Olá, ' }, { text: 'time', bold: true }] }] },
      companyId: DEFAULT_COMPANY_ID,
    })

    expect(post.title).toBe('Novidade')
    expect(post.content).toBe('Olá, time')
    expect(post.contentJson).toMatchObject({ blocks: [{ type: 'paragraph' }] })
  })

  it('menciona quem está marcado dentro do documento rico', async () => {
    const autor = await makeUser('mencao-rica-autor@empresa.com', 'ADMIN')
    const alvo = await makeUser('mencao-rica-alvo@empresa.com', 'LEGEND')
    const post = await createPost({
      authorId: autor.id,
      body: { blocks: [{ type: 'paragraph', spans: [{ text: alvo.name, mentionId: alvo.id }] }] },
      companyId: DEFAULT_COMPANY_ID,
    })
    expect(post.mentions.map((m) => m.userId)).toEqual([alvo.id])
  })

  it('pagina por cursor, mais novo primeiro, sem duplicar', async () => {
    const u = await makeUser('paginacao@empresa.com', 'ADMIN')
    for (let i = 0; i < 5; i++) await createPost({ authorId: u.id, content: `p${i}`, companyId: DEFAULT_COMPANY_ID })

    const page1 = await listFeed(viewerOf(u), { limit: 2 })
    expect(page1.items.map((p) => p.content)).toEqual(['p4', 'p3'])
    expect(page1.nextCursor).toBeTruthy()

    const page2 = await listFeed(viewerOf(u), { cursor: page1.nextCursor!, limit: 2 })
    expect(page2.items.map((p) => p.content)).toEqual(['p2', 'p1'])

    const ids = new Set([...page1.items, ...page2.items].map((p) => p.id))
    expect(ids.size).toBe(4)
  })

  it('não inclui publicações de autores desativados', async () => {
    const ativo = await makeUser('ativo-mural@empresa.com', 'ADMIN')
    const inativo = await prisma.user.create({
      data: { name: 'inativo', email: 'inativo-mural@empresa.com', passwordHash: 'x', role: 'HEAD', active: false },
    })
    await createPost({ authorId: ativo.id, content: 'visível', companyId: DEFAULT_COMPANY_ID })
    await prisma.corporatePost.create({ data: { authorId: inativo.id, content: 'invisível' } })

    const feed = await listFeed(viewerOf(ativo), { limit: 10 })
    expect(feed.items.map((p) => p.content)).toContain('visível')
    expect(feed.items.map((p) => p.content)).not.toContain('invisível')
  })
})

describe('corporate-mural-service: público-alvo', () => {
  it('comunicado de setor não aparece para quem é de outro setor', async () => {
    const autor = await makeUser('audiencia-autor@empresa.com', 'ADMIN')
    const deFora = await makeUserInOtherSector('audiencia-fora@empresa.com', 'LEGEND')
    const doSetor = await makeUser('audiencia-dentro@empresa.com', 'LEGEND')

    await createPost({
      authorId: autor.id,
      content: 'só para o produto',
      audience: 'SECTORS',
      audienceSectorIds: [SECTOR],
      companyId: DEFAULT_COMPANY_ID,
    })

    expect((await listFeed(viewerOf(doSetor), { limit: 10 })).items.map((p) => p.content)).toContain('só para o produto')
    expect((await listFeed(viewerOf(deFora), { limit: 10 })).items.map((p) => p.content)).not.toContain(
      'só para o produto',
    )
  })

  it('o deep-link também é 404 para quem está fora do público', async () => {
    const autor = await makeUser('deeplink-autor@empresa.com', 'ADMIN')
    const deFora = await makeUserInOtherSector('deeplink-fora@empresa.com', 'LEGEND')
    const post = await createPost({
      authorId: autor.id,
      content: 'segmentado',
      audience: 'SECTORS',
      audienceSectorIds: [SECTOR],
      companyId: DEFAULT_COMPANY_ID,
    })

    await expect(getPost(post.id, viewerOf(deFora))).rejects.toMatchObject({ status: 404 })
    // …e as interações também: sem isso o comentário seria a porta de leitura.
    await expect(
      createComment({ postId: post.id, content: 'oi', viewer: viewerOf(deFora) }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      togglePostReaction({ postId: post.id, emoji: '💚', viewer: viewerOf(deFora) }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(listComments(post.id, viewerOf(deFora), { offset: 0, limit: 10 })).rejects.toMatchObject({
      status: 404,
    })
    await expect(markPostRead({ postId: post.id, viewer: viewerOf(deFora) })).rejects.toMatchObject({ status: 404 })
  })

  it('quem administra enxerga o comunicado segmentado de qualquer setor', async () => {
    const autor = await makeUser('audiencia-admin-autor@empresa.com', 'ADMIN')
    const post = await createPost({
      authorId: autor.id,
      content: 'segmentado',
      audience: 'SECTORS',
      audienceSectorIds: [SECTOR],
      companyId: DEFAULT_COMPANY_ID,
    })
    const adminDeOutroSetor = await makeUserInOtherSector('audiencia-admin-outro@empresa.com', 'ADMIN')

    await expect(getPost(post.id, viewerOf(adminDeOutroSetor))).resolves.toMatchObject({ id: post.id })
  })

  it('escopo SECTORS sem setor nenhum é 400', async () => {
    const autor = await makeUser('audiencia-vazia@empresa.com', 'ADMIN')
    await expect(
      createPost({
        authorId: autor.id,
        content: 'para ninguém',
        audience: 'SECTORS',
        audienceSectorIds: [],
        companyId: DEFAULT_COMPANY_ID,
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('ignora setor de outra empresa no público-alvo', async () => {
    const outraEmpresa = await prisma.company.create({
      data: { name: 'Empresa Audiencia', slug: `empresa-audiencia-${Math.random()}` },
    })
    const adminFora = await prisma.user.create({
      data: {
        name: 'AdminFora',
        email: `admin-audiencia-${Math.random()}@x.com`,
        passwordHash: 'x',
        role: 'ADMIN',
        companyId: outraEmpresa.id,
      },
    })
    const setorFora = await createSector(
      { name: `Setor Fora ${Math.random()}`, enabledFeatures: [], roles: [] },
      adminFora.id,
      outraEmpresa.id,
    )
    const autor = await makeUser('audiencia-cross@empresa.com', 'ADMIN')

    await expect(
      createPost({
        authorId: autor.id,
        content: 'tentativa',
        audience: 'SECTORS',
        audienceSectorIds: [setorFora.id],
        companyId: DEFAULT_COMPANY_ID,
      }),
    ).rejects.toMatchObject({ status: 400 })
  })
})

describe('corporate-mural-service: aprovação', () => {
  it('aprovar publica e registra quem revisou', async () => {
    const autor = await makeUser('aprovar-autor@empresa.com', 'LEGEND')
    const admin = await makeAdminActor()
    const post = await createPost({ authorId: autor.id, content: 'da lenda', companyId: DEFAULT_COMPANY_ID })

    const aprovado = await approvePost({ postId: post.id, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })

    expect(aprovado.status).toBe('PUBLISHED')
    expect(aprovado.reviewedById).toBe(admin.id)
    expect((await listFeed(viewerOf(autor), { limit: 10 })).items.map((p) => p.content)).toContain('da lenda')
  })

  it('autor não pode aprovar o próprio comunicado, mesmo com acesso administrativo', async () => {
    const autor = await prisma.user.create({
      data: {
        name: 'auto-aprovador',
        email: 'auto-aprovador@empresa.com',
        passwordHash: 'x',
        role: 'LEGEND',
        adminAccess: true,
      },
    })
    // `createPost` publicaria direto para este autor — força PENDING para testar a aprovação isoladamente.
    const post = await prisma.corporatePost.create({
      data: { authorId: autor.id, content: 'auto aprovação', status: 'PENDING' },
    })

    await expect(
      approvePost({ postId: post.id, actorId: autor.id, companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 403 })

    expect((await prisma.corporatePost.findUniqueOrThrow({ where: { id: post.id } })).status).toBe('PENDING')
  })

  it('autor não pode recusar o próprio comunicado', async () => {
    const autor = await makeUser('auto-recusa@empresa.com', 'LEGEND')
    const post = await createPost({ authorId: autor.id, content: 'auto recusa', companyId: DEFAULT_COMPANY_ID })

    await expect(
      rejectPost({ postId: post.id, actorId: autor.id, companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('duas aprovações concorrentes: uma vence, a outra é 409', async () => {
    const autor = await makeUser('corrida-autor@empresa.com', 'LEGEND')
    const admin = await makeAdminActor()
    const post = await createPost({ authorId: autor.id, content: 'corrida', companyId: DEFAULT_COMPANY_ID })

    const resultados = await Promise.allSettled([
      approvePost({ postId: post.id, actorId: admin.id, companyId: DEFAULT_COMPANY_ID }),
      approvePost({ postId: post.id, actorId: admin.id, companyId: DEFAULT_COMPANY_ID }),
    ])

    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const recusada = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(recusada.reason).toMatchObject({ status: 409 })
  })

  it('recusar guarda o motivo e mantém o post fora do feed', async () => {
    const autor = await makeUser('recusa-autor@empresa.com', 'LEGEND')
    const admin = await makeAdminActor()
    const post = await createPost({ authorId: autor.id, content: 'recusado', companyId: DEFAULT_COMPANY_ID })

    const recusado = await rejectPost({
      postId: post.id,
      actorId: admin.id,
      companyId: DEFAULT_COMPANY_ID,
      reason: 'Fora do tom da casa',
    })

    expect(recusado.status).toBe('REJECTED')
    expect(recusado.rejectionReason).toBe('Fora do tom da casa')
    expect((await listFeed(viewerOf(autor), { limit: 10 })).items).toHaveLength(0)
    // O autor continua vendo a recusa (e o motivo) em "Meus envios".
    expect((await listPendingPosts(viewerOf(autor))).map((p) => p.status)).toEqual(['REJECTED'])
  })

  it('a fila do admin mostra só pendentes de todo mundo', async () => {
    const admin = await makeAdminActor()
    const autorA = await makeUser('fila-a@empresa.com', 'LEGEND')
    const autorB = await makeUser('fila-b@empresa.com', 'LEAD')
    await createPost({ authorId: autorA.id, content: 'de A', companyId: DEFAULT_COMPANY_ID })
    await createPost({ authorId: autorB.id, content: 'de B', companyId: DEFAULT_COMPANY_ID })
    await createPost({ authorId: admin.id, content: 'do admin, já publicado', companyId: DEFAULT_COMPANY_ID })

    const fila = await listPendingPosts(viewerOf(admin))

    expect(fila.map((p) => p.content).sort()).toEqual(['de A', 'de B'])
  })
})

describe('corporate-mural-service: edição', () => {
  it('admin edita o texto e o post passa a exibir "editado"', async () => {
    const admin = await makeAdminActor()
    const post = await createPost({ authorId: admin.id, content: 'original', companyId: DEFAULT_COMPANY_ID })

    const editado = await updatePost({
      postId: post.id,
      actorId: admin.id,
      role: 'ADMIN',
      companyId: DEFAULT_COMPANY_ID,
      body: doc('corrigido'),
    })

    expect(editado.content).toBe('corrigido')
    expect(editado.editedAt).toBeInstanceOf(Date)
  })

  it('mudar só o público-alvo não marca como editado', async () => {
    const admin = await makeAdminActor()
    const post = await createPost({ authorId: admin.id, content: 'original', companyId: DEFAULT_COMPANY_ID })

    const editado = await updatePost({
      postId: post.id,
      actorId: admin.id,
      role: 'ADMIN',
      companyId: DEFAULT_COMPANY_ID,
      audience: 'SECTORS',
      audienceSectorIds: [SECTOR],
    })

    expect(editado.editedAt).toBeNull()
    expect(editado.sectors.map((s) => s.sectorId)).toEqual([SECTOR])
  })

  it('o autor edita o próprio pendente, mas não depois de publicado', async () => {
    const autor = await makeUser('edicao-autor@empresa.com', 'LEGEND')
    const admin = await makeAdminActor()
    const post = await createPost({ authorId: autor.id, content: 'rascunho', companyId: DEFAULT_COMPANY_ID })

    await updatePost({
      postId: post.id,
      actorId: autor.id,
      role: 'LEGEND',
      companyId: DEFAULT_COMPANY_ID,
      body: doc('rascunho revisado'),
    })

    await approvePost({ postId: post.id, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })

    await expect(
      updatePost({
        postId: post.id,
        actorId: autor.id,
        role: 'LEGEND',
        companyId: DEFAULT_COMPANY_ID,
        body: doc('troquei depois de aprovado'),
      }),
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe('corporate-mural-service: comentários, reações e exclusão', () => {
  it('calcula destinatários de reply (distintos, sem ator nem autor do post)', async () => {
    const autor = await makeUser('thread-autor@empresa.com', 'ADMIN')
    const p1 = await makeUser('thread-p1@empresa.com', 'LEGEND')
    const p2 = await makeUser('thread-p2@empresa.com', 'LEGEND')
    const post = await createPost({ authorId: autor.id, content: 'thread', companyId: DEFAULT_COMPANY_ID })

    const first = await createComment({ postId: post.id, content: 'oi', viewer: viewerOf(p1) })
    expect(first.replyRecipientIds).toEqual([])
    expect(first.firstOfAuthor).toBe(true)

    const again = await createComment({ postId: post.id, content: 'de novo', viewer: viewerOf(p1) })
    expect(again.replyRecipientIds).toEqual([])
    // Segundo comentário da mesma pessoa não paga XP de novo.
    expect(again.firstOfAuthor).toBe(false)

    const third = await createComment({ postId: post.id, content: 'cheguei', viewer: viewerOf(p2) })
    expect(third.replyRecipientIds).toEqual([p1.id])

    const byAuthor = await createComment({ postId: post.id, content: 'valeu', viewer: viewerOf(autor) })
    expect(byAuthor.replyRecipientIds.sort()).toEqual([p1.id, p2.id].sort())
  })

  it('alterna reação de post e de comentário (liga/desliga)', async () => {
    const autor = await makeUser('reacao-autor@empresa.com', 'ADMIN')
    const lenda = await makeUser('reacao-lenda@empresa.com', 'LEGEND')
    const post = await createPost({ authorId: autor.id, content: 'reaja aí', companyId: DEFAULT_COMPANY_ID })
    const { comment } = await createComment({ postId: post.id, content: 'c', viewer: viewerOf(lenda) })

    const on = await togglePostReaction({ postId: post.id, emoji: '🔥', viewer: viewerOf(lenda) })
    expect(on.added).toBe(true)
    expect(on.viewerHasReaction).toBe(true)
    const off = await togglePostReaction({ postId: post.id, emoji: '🔥', viewer: viewerOf(lenda) })
    expect(off.added).toBe(false)
    expect(off.viewerHasReaction).toBe(false)
    expect(off.post.reactions).toHaveLength(0)

    const reacted = await toggleCommentReaction({ commentId: comment.id, emoji: '👏', viewer: viewerOf(autor) })
    expect(reacted.comment.reactions.map((r) => r.emoji)).toEqual(['👏'])
  })

  it('tirar um emoji de dois não zera a reação da pessoa no post', async () => {
    const autor = await makeUser('reacao-multi-autor@empresa.com', 'ADMIN')
    const lenda = await makeUser('reacao-multi@empresa.com', 'LEGEND')
    const post = await createPost({ authorId: autor.id, content: 'reaja', companyId: DEFAULT_COMPANY_ID })

    await togglePostReaction({ postId: post.id, emoji: '💚', viewer: viewerOf(lenda) })
    await togglePostReaction({ postId: post.id, emoji: '🎉', viewer: viewerOf(lenda) })
    const parcial = await togglePostReaction({ postId: post.id, emoji: '🎉', viewer: viewerOf(lenda) })

    // É isto que impede o estorno de XP enquanto ainda há reação da pessoa.
    expect(parcial.viewerHasReaction).toBe(true)
  })

  it('aceita o coração verde e rejeita emoji fora da lista (400)', async () => {
    const autor = await makeUser('emoji-autor@empresa.com', 'ADMIN')
    const post = await createPost({ authorId: autor.id, content: 'x', companyId: DEFAULT_COMPANY_ID })

    const verde = await togglePostReaction({ postId: post.id, emoji: '💚', viewer: viewerOf(autor) })
    expect(verde.added).toBe(true)

    await expect(togglePostReaction({ postId: post.id, emoji: '🍕', viewer: viewerOf(autor) })).rejects.toMatchObject({
      status: 400,
    })
  })

  it('só o autor, ADMIN ou SUBADMIN excluem post e comentário', async () => {
    const autor = await makeUser('del-autor@empresa.com', 'ADMIN')
    const outro = await makeUser('del-outro@empresa.com', 'LEGEND')
    const post = await createPost({ authorId: autor.id, content: 'apagável', companyId: DEFAULT_COMPANY_ID })
    const { comment } = await createComment({ postId: post.id, content: 'c', viewer: viewerOf(autor) })

    await expect(
      deletePost({ postId: post.id, userId: outro.id, role: 'LEGEND', companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      deleteComment({ commentId: comment.id, userId: outro.id, role: 'LEGEND', companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 403 })

    await deleteComment({ commentId: comment.id, userId: outro.id, role: 'SUBADMIN', companyId: DEFAULT_COMPANY_ID })
    await deletePost({ postId: post.id, userId: autor.id, role: 'ADMIN', companyId: DEFAULT_COMPANY_ID })
    expect(await prisma.corporatePost.findUnique({ where: { id: post.id } })).toBeNull()
  })

  it('apagar o último comentário da pessoa avisa o call site do estorno', async () => {
    const autor = await makeUser('estorno-autor@empresa.com', 'ADMIN')
    const lenda = await makeUser('estorno-lenda@empresa.com', 'LEGEND')
    const post = await createPost({ authorId: autor.id, content: 'aviso', companyId: DEFAULT_COMPANY_ID })
    const primeiro = await createComment({ postId: post.id, content: 'um', viewer: viewerOf(lenda) })
    const segundo = await createComment({ postId: post.id, content: 'dois', viewer: viewerOf(lenda) })

    const aindaTem = await deleteComment({
      commentId: primeiro.comment.id,
      userId: lenda.id,
      role: 'LEGEND',
      companyId: DEFAULT_COMPANY_ID,
    })
    expect(aindaTem).toMatchObject({ commentAuthorId: lenda.id, authorHasOtherComments: true })

    const ultimo = await deleteComment({
      commentId: segundo.comment.id,
      userId: lenda.id,
      role: 'LEGEND',
      companyId: DEFAULT_COMPANY_ID,
    })
    expect(ultimo.authorHasOtherComments).toBe(false)
  })
})

describe('corporate-mural-service: escopo por empresa', () => {
  it('publicação de outra empresa não aparece no feed e é 404 nas mutações', async () => {
    const outraEmpresa = await prisma.company.create({
      data: { name: 'Outra Empresa Mural', slug: 'outra-empresa-mural-test' },
    })
    const autorFora = await prisma.user.create({
      data: {
        name: 'AutorForaMural',
        email: 'autor-fora-mural@x.com',
        passwordHash: 'x',
        role: 'HEAD',
        companyId: outraEmpresa.id,
      },
    })
    const post = await prisma.corporatePost.create({
      data: { authorId: autorFora.id, content: 'de outra empresa', companyId: outraEmpresa.id },
    })
    const ator = await makeUser('ator-mural-empresa@x.com', 'ADMIN')

    const feed = await listFeed(viewerOf(ator), { limit: 10 })
    expect(feed.items.map((p) => p.content)).not.toContain('de outra empresa')

    await expect(getPost(post.id, viewerOf(ator))).rejects.toMatchObject({ status: 404 })
    await expect(
      deletePost({ postId: post.id, userId: ator.id, role: 'ADMIN', companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 404 })
    await expect(togglePostReaction({ postId: post.id, emoji: '😂', viewer: viewerOf(ator) })).rejects.toMatchObject({
      status: 404,
    })
    await expect(createComment({ postId: post.id, content: 'oi', viewer: viewerOf(ator) })).rejects.toMatchObject({
      status: 404,
    })
    await expect(listComments(post.id, viewerOf(ator), { offset: 0, limit: 10 })).rejects.toMatchObject({ status: 404 })
  })

  it('não menciona usuário de outra empresa mesmo recebendo o id', async () => {
    const outraEmpresa = await prisma.company.create({
      data: { name: 'Outra Empresa Mural Mencao', slug: 'outra-empresa-mural-mencao-test' },
    })
    const autor = await makeUser('mencao-empresa-autor@x.com', 'ADMIN')
    const fora = await prisma.user.create({
      data: { name: 'ForaMencaoMural', email: 'fora-mencao-mural@x.com', passwordHash: 'x', companyId: outraEmpresa.id },
    })

    const post = await createPost({
      authorId: autor.id,
      content: 'oi',
      mentionedUserIds: [fora.id],
      companyId: DEFAULT_COMPANY_ID,
    })
    expect(post.mentions).toHaveLength(0)
  })

  it('marcar leitura em post de outra empresa é 404 e não grava a leitura', async () => {
    const outraEmpresa = await prisma.company.create({
      data: { name: 'Outra Empresa Mural Leitura', slug: 'outra-empresa-mural-leitura-test' },
    })
    const adminOutraEmpresa = await prisma.user.create({
      data: {
        name: 'AdminOutraEmpresaMuralLeitura',
        email: `admin-outra-empresa-mural-leitura-${Math.random()}@x.com`,
        passwordHash: 'x',
        role: 'ADMIN',
        companyId: outraEmpresa.id,
      },
    })
    const setorOutraEmpresa = await createSector(
      { name: `Setor Outra Empresa Mural Leitura ${Math.random()}`, enabledFeatures: [], roles: [] },
      adminOutraEmpresa.id,
      outraEmpresa.id,
    )
    const autorOutraEmpresa = await prisma.user.create({
      data: {
        name: 'AutorOutraEmpresaMuralLeitura',
        email: `autor-outra-empresa-mural-leitura-${Math.random()}@x.com`,
        passwordHash: 'x',
        role: 'ADMIN',
        companyId: outraEmpresa.id,
        sectorId: setorOutraEmpresa.id,
      },
    })
    const postOutraEmpresa = await createPost({
      authorId: autorOutraEmpresa.id,
      content: 'aviso de outra empresa',
      companyId: outraEmpresa.id,
    })
    const leitor = await makeUser('leitor-outra-empresa@empresa.com', 'LEGEND')

    await expect(markPostRead({ postId: postOutraEmpresa.id, viewer: viewerOf(leitor) })).rejects.toMatchObject({
      status: 404,
    })

    expect(await prisma.corporatePostRead.count({ where: { postId: postOutraEmpresa.id } })).toBe(0)
  })
})

describe('corporate-mural-service: fixar post', () => {
  it('fixa um post e registra quem fixou', async () => {
    const admin = await makeAdminActor()
    const post = await createPost({ authorId: admin.id, content: 'aviso', companyId: DEFAULT_COMPANY_ID })

    const pinned = await pinPost({ postId: post.id, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })

    expect(pinned.pinnedAt).toBeInstanceOf(Date)
    expect(pinned.pinnedById).toBe(admin.id)
  })

  it('fixar um segundo post desfixa o primeiro — nunca há dois fixados', async () => {
    const admin = await makeAdminActor()
    const primeiro = await createPost({ authorId: admin.id, content: 'aviso 1', companyId: DEFAULT_COMPANY_ID })
    const segundo = await createPost({ authorId: admin.id, content: 'aviso 2', companyId: DEFAULT_COMPANY_ID })

    await pinPost({ postId: primeiro.id, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })
    await pinPost({ postId: segundo.id, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })

    const fixados = await prisma.corporatePost.findMany({ where: { pinnedAt: { not: null } } })
    expect(fixados.map((p) => p.id)).toEqual([segundo.id])
  })

  it('desfixa e grava auditoria; desfixar de novo é no-op sem log', async () => {
    const admin = await makeAdminActor()
    const post = await createPost({ authorId: admin.id, content: 'aviso', companyId: DEFAULT_COMPANY_ID })
    await pinPost({ postId: post.id, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })

    const desfixado = await unpinPost({ postId: post.id, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })
    expect(desfixado.pinnedAt).toBeNull()
    expect(desfixado.pinnedById).toBeNull()

    const logsDepoisDoPrimeiro = await prisma.adminAuditLog.count({ where: { entityId: post.id } })
    await unpinPost({ postId: post.id, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })
    expect(await prisma.adminAuditLog.count({ where: { entityId: post.id } })).toBe(logsDepoisDoPrimeiro)
  })

  it('grava auditoria da fixação com entityType CorporatePost', async () => {
    const admin = await makeAdminActor()
    const post = await createPost({ authorId: admin.id, content: 'aviso', companyId: DEFAULT_COMPANY_ID })

    await pinPost({ postId: post.id, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })

    const log = await prisma.adminAuditLog.findFirst({ where: { entityId: post.id } })
    expect(log).toMatchObject({ entityType: 'CorporatePost', action: 'UPDATE', actorId: admin.id })
  })

  it('404 em post inexistente', async () => {
    const admin = await makeAdminActor()
    await expect(
      pinPost({ postId: 'nao-existe', actorId: admin.id, companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('404 em post inexistente ao desfixar', async () => {
    const admin = await makeAdminActor()
    await expect(
      unpinPost({ postId: 'nao-existe', actorId: admin.id, companyId: DEFAULT_COMPANY_ID }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('fixar post na empresa A não desfixa o post fixado na empresa B', async () => {
    const outraEmpresa = await prisma.company.create({
      data: { name: 'Outra Empresa Mural Fixar', slug: 'outra-empresa-mural-fixar-test' },
    })
    const adminOutraEmpresa = await prisma.user.create({
      data: {
        name: 'AdminOutraEmpresaMural',
        email: `admin-outra-empresa-mural-${Math.random()}@x.com`,
        passwordHash: 'x',
        role: 'ADMIN',
        companyId: outraEmpresa.id,
      },
    })
    const setorOutraEmpresa = await createSector(
      { name: `Setor Outra Empresa Mural ${Math.random()}`, enabledFeatures: [], roles: [] },
      adminOutraEmpresa.id,
      outraEmpresa.id,
    )
    const autorOutraEmpresa = await prisma.user.create({
      data: {
        name: 'AutorOutraEmpresaMural',
        email: `autor-outra-empresa-mural-${Math.random()}@x.com`,
        passwordHash: 'x',
        role: 'ADMIN',
        companyId: outraEmpresa.id,
        sectorId: setorOutraEmpresa.id,
      },
    })
    const postOutraEmpresa = await createPost({
      authorId: autorOutraEmpresa.id,
      content: 'aviso de outra empresa',
      companyId: outraEmpresa.id,
    })
    await pinPost({ postId: postOutraEmpresa.id, actorId: adminOutraEmpresa.id, companyId: outraEmpresa.id })

    const admin = await makeAdminActor()
    const post = await createPost({ authorId: admin.id, content: 'aviso empresa padrão', companyId: DEFAULT_COMPANY_ID })
    await pinPost({ postId: post.id, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })

    const aindaFixado = await prisma.corporatePost.findUnique({ where: { id: postOutraEmpresa.id } })
    expect(aindaFixado?.pinnedAt).toBeInstanceOf(Date)
    expect(aindaFixado?.pinnedById).toBe(adminOutraEmpresa.id)
  })
})

describe('corporate-mural-service: feed com post fixado', () => {
  it('põe o fixado no topo mesmo sendo o mais antigo', async () => {
    const admin = await makeAdminActor()
    const antigo = await createPost({ authorId: admin.id, content: 'antigo', companyId: DEFAULT_COMPANY_ID })
    await createPost({ authorId: admin.id, content: 'novo', companyId: DEFAULT_COMPANY_ID })
    await pinPost({ postId: antigo.id, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })

    const { items } = await listFeed(viewerOf(admin), { limit: 20 })

    expect(items[0].id).toBe(antigo.id)
    expect(items).toHaveLength(2)
  })

  it('não repete o fixado na página seguinte', async () => {
    const admin = await makeAdminActor()
    const primeiro = await createPost({ authorId: admin.id, content: 'p1', companyId: DEFAULT_COMPANY_ID })
    await createPost({ authorId: admin.id, content: 'p2', companyId: DEFAULT_COMPANY_ID })
    await createPost({ authorId: admin.id, content: 'p3', companyId: DEFAULT_COMPANY_ID })
    await pinPost({ postId: primeiro.id, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })

    const page1 = await listFeed(viewerOf(admin), { limit: 1 })
    const page2 = await listFeed(viewerOf(admin), { limit: 1, cursor: page1.nextCursor! })

    // page1 = [fixado, p3]: o fixado não ocupa vaga do keyset, então com
    // limit:1 a 1ª página devolve 2 itens (fixado + 1 do keyset) — não é bug,
    // ver JSDoc de listFeed. O cursor sai do keyset (p3), não do fixado.
    expect(page1.items).toHaveLength(2)
    expect(page1.items[0].id).toBe(primeiro.id)
    const idsPage2 = page2.items.map((p) => p.id)
    expect(idsPage2).not.toContain(primeiro.id)
    expect(idsPage2).toHaveLength(1)
  })

  it('sem fixado, o feed segue igual (mais novo primeiro)', async () => {
    const admin = await makeAdminActor()
    await createPost({ authorId: admin.id, content: 'a', companyId: DEFAULT_COMPANY_ID })
    const b = await createPost({ authorId: admin.id, content: 'b', companyId: DEFAULT_COMPANY_ID })

    const { items } = await listFeed(viewerOf(admin), { limit: 20 })

    expect(items[0].id).toBe(b.id)
  })

  it('fixado com autor desativado some do feed (não aparece nem prefixado nem no keyset)', async () => {
    const admin = await makeAdminActor()
    const leitor = await makeUser('leitor-fixado@empresa.com', 'ADMIN')
    const post = await createPost({ authorId: admin.id, content: 'aviso', companyId: DEFAULT_COMPANY_ID })
    await pinPost({ postId: post.id, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })
    await prisma.user.update({ where: { id: admin.id }, data: { active: false } })

    const { items } = await listFeed(viewerOf(leitor), { limit: 20 })

    expect(items.map((p) => p.id)).not.toContain(post.id)
  })
})

describe('corporate-mural-service: marcar leitura', () => {
  it('registra a leitura de quem viu o post', async () => {
    const autor = await makeUser('autor-leitura@empresa.com', 'ADMIN')
    const leitor = await makeUser('leitor@empresa.com', 'LEGEND')
    const post = await createPost({ authorId: autor.id, content: 'aviso', companyId: DEFAULT_COMPANY_ID })

    await markPostRead({ postId: post.id, viewer: viewerOf(leitor) })

    const reads = await prisma.corporatePostRead.findMany({ where: { postId: post.id } })
    expect(reads).toHaveLength(1)
    expect(reads[0]).toMatchObject({ userId: leitor.id, companyId: DEFAULT_COMPANY_ID })
  })

  it('marcar duas vezes não duplica', async () => {
    const autor = await makeUser('autor-leitura2@empresa.com', 'ADMIN')
    const leitor = await makeUser('leitor2@empresa.com', 'LEGEND')
    const post = await createPost({ authorId: autor.id, content: 'aviso', companyId: DEFAULT_COMPANY_ID })

    await markPostRead({ postId: post.id, viewer: viewerOf(leitor) })
    await markPostRead({ postId: post.id, viewer: viewerOf(leitor) })

    expect(await prisma.corporatePostRead.count({ where: { postId: post.id } })).toBe(1)
  })

  it('`full` só credita quando o post é longo o bastante para ser cortado', async () => {
    const autor = await makeUser('autor-leitura-full@empresa.com', 'ADMIN')
    const leitor = await makeUser('leitor-full@empresa.com', 'LEGEND')
    const curto = await createPost({ authorId: autor.id, content: 'uma linha só', companyId: DEFAULT_COMPANY_ID })
    const longo = await createPost({
      authorId: autor.id,
      body: doc('l1', 'l2', 'l3', 'l4', 'l5'),
      companyId: DEFAULT_COMPANY_ID,
    })

    // Cliente mandando `full: true` num post de uma linha não ganha XP: quem
    // decide se o post é longo é o servidor.
    expect(await markPostRead({ postId: curto.id, viewer: viewerOf(leitor), full: true })).toEqual({
      creditFull: false,
    })
    expect(await markPostRead({ postId: longo.id, viewer: viewerOf(leitor), full: true })).toEqual({
      creditFull: true,
    })
    // Sem `full`, é a marcação do painel de alcance — nunca credita.
    expect(await markPostRead({ postId: longo.id, viewer: viewerOf(leitor) })).toEqual({ creditFull: false })
  })

  it('404 em post inexistente', async () => {
    const leitor = await makeUser('leitor3@empresa.com', 'LEGEND')
    await expect(markPostRead({ postId: 'nao-existe', viewer: viewerOf(leitor) })).rejects.toMatchObject({
      status: 404,
    })
  })
})

describe('corporate-mural-service: auditoria da moderação', () => {
  it('grava auditoria quando o admin apaga post de outro autor', async () => {
    const autor = await makeUser('autor-moderado@empresa.com', 'ADMIN')
    const admin = await makeAdminActor()
    const post = await createPost({ authorId: autor.id, content: 'polêmico', companyId: DEFAULT_COMPANY_ID })

    await deletePost({ postId: post.id, userId: admin.id, role: 'ADMIN', companyId: DEFAULT_COMPANY_ID })

    const log = await prisma.adminAuditLog.findFirst({ where: { entityId: post.id } })
    expect(log).toMatchObject({ entityType: 'CorporatePost', action: 'DELETE', actorId: admin.id })
  })

  it('não grava auditoria quando o autor apaga o próprio post', async () => {
    const autor = await makeUser('autor-apaga-proprio@empresa.com', 'ADMIN')
    const post = await createPost({ authorId: autor.id, content: 'meu', companyId: DEFAULT_COMPANY_ID })

    await deletePost({ postId: post.id, userId: autor.id, role: 'ADMIN', companyId: DEFAULT_COMPANY_ID })

    expect(await prisma.adminAuditLog.count({ where: { entityId: post.id } })).toBe(0)
  })

  it('a auditoria da aprovação carrega um rótulo legível, mesmo sem título', async () => {
    const autor = await makeUser('sem-titulo@empresa.com', 'LEGEND')
    const admin = await makeAdminActor()
    const post = await createPost({
      authorId: autor.id,
      content: 'Olá pessoal, boa tarde! espero que vocês estejam bem',
      companyId: DEFAULT_COMPANY_ID,
    })

    await approvePost({ postId: post.id, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })

    const log = await prisma.adminAuditLog.findFirstOrThrow({ where: { entityId: post.id } })
    expect((log.after as { subject: string }).subject).toBe('Olá pessoal, boa tarde! espero que vocês estejam bem')
  })

  it('trunca o rótulo de auditoria quando o comunicado é longo', async () => {
    const autor = await makeUser('longo@empresa.com', 'LEGEND')
    const admin = await makeAdminActor()
    const post = await createPost({ authorId: autor.id, content: 'x'.repeat(200), companyId: DEFAULT_COMPANY_ID })

    await approvePost({ postId: post.id, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })

    const log = await prisma.adminAuditLog.findFirstOrThrow({ where: { entityId: post.id } })
    expect((log.after as { subject: string }).subject).toBe(`${'x'.repeat(60)}…`)
  })

  it('grava auditoria quando o admin apaga comentário de outro autor', async () => {
    const autor = await makeUser('autor-post-c@empresa.com', 'ADMIN')
    const comentarista = await makeUser('comentarista@empresa.com', 'LEGEND')
    const admin = await makeAdminActor()
    const post = await createPost({ authorId: autor.id, content: 'aviso', companyId: DEFAULT_COMPANY_ID })
    const { comment } = await createComment({
      postId: post.id,
      content: 'comentário ruim',
      viewer: viewerOf(comentarista),
    })

    await deleteComment({ commentId: comment.id, userId: admin.id, role: 'ADMIN', companyId: DEFAULT_COMPANY_ID })

    const log = await prisma.adminAuditLog.findFirst({ where: { entityId: comment.id } })
    expect(log).toMatchObject({ entityType: 'CorporatePostComment', action: 'DELETE', actorId: admin.id })
  })
})

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


describe('corporate-mural-service: enquete', () => {
  const enquete = { question: 'Qual logo?', options: ['Azul', 'Verde'] }

  async function postComEnquete() {
    const autor = await makeUser(`enq-autor-${Math.random()}@empresa.com`, 'ADMIN')
    const post = await createPost({
      authorId: autor.id,
      content: 'Escolha aí',
      companyId: DEFAULT_COMPANY_ID,
      poll: enquete,
    })
    return { autor, post }
  }

  it('cria a enquete junto do post, com as opções na ordem digitada', async () => {
    const { post } = await postComEnquete()

    expect(post.poll?.question).toBe('Qual logo?')
    expect(post.poll?.options.map((o) => o.text)).toEqual(['Azul', 'Verde'])
    expect(post.poll?.options.map((o) => o.position)).toEqual([0, 1])
  })

  // A enquete NÃO disputa vaga com anexo: "banner + enquete" é o formato normal
  // de comunicação interna, e é o que a regra da Resenha proibiria.
  it('convive com GIF no mesmo post', async () => {
    const autor = await makeUser(`enq-gif-${Math.random()}@empresa.com`, 'ADMIN')
    const post = await createPost({
      authorId: autor.id,
      content: 'Com gif e enquete',
      companyId: DEFAULT_COMPANY_ID,
      gif: { url: 'https://media.giphy.com/media/x/giphy.gif', width: 1, height: 1 },
      poll: enquete,
    })

    expect(post.poll).not.toBeNull()
    expect(post.gifUrl).toBeTruthy()
  })

  it('post que é só a enquete é válido, sem texto', async () => {
    const autor = await makeUser(`enq-so-${Math.random()}@empresa.com`, 'ADMIN')
    const post = await createPost({
      authorId: autor.id,
      content: '',
      companyId: DEFAULT_COMPANY_ID,
      poll: enquete,
    })

    expect(post.poll?.question).toBe('Qual logo?')
  })

  it.each([
    [{ question: '', options: ['A', 'B'] }, /pergunta/i],
    [{ question: 'Q', options: ['A'] }, /opções/i],
    [{ question: 'Q', options: ['Sim', 'sim'] }, /diferentes/i],
  ])('recusa enquete inválida (%#)', async (poll, mensagem) => {
    const autor = await makeUser(`enq-inv-${Math.random()}@empresa.com`, 'ADMIN')

    await expect(
      createPost({ authorId: autor.id, content: 'x', companyId: DEFAULT_COMPANY_ID, poll }),
    ).rejects.toThrow(mensagem)
  })

  it('vota uma vez, e o segundo voto é 409', async () => {
    const { post } = await postComEnquete()
    const votante = await makeUser(`enq-voto-${Math.random()}@empresa.com`)
    const viewer = viewerOf({ ...votante, companyId: DEFAULT_COMPANY_ID })
    const opcao = post.poll!.options[0].id

    const depois = await voteCorporatePostPoll({ postId: post.id, optionId: opcao, viewer })
    expect(depois.poll?.votes).toHaveLength(1)

    await expect(
      voteCorporatePostPoll({ postId: post.id, optionId: opcao, viewer }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('opção de outra enquete é 404', async () => {
    const { post } = await postComEnquete()
    const outro = await postComEnquete()
    const votante = await makeUser(`enq-outra-${Math.random()}@empresa.com`)

    await expect(
      voteCorporatePostPoll({
        postId: post.id,
        optionId: outro.post.poll!.options[0].id,
        viewer: viewerOf({ ...votante, companyId: DEFAULT_COMPANY_ID }),
      }),
    ).rejects.toMatchObject({ status: 404 })
  })

  // 409 e não 404: o post existe e a pessoa até o vê na fila; o que ainda não
  // existe é a votação.
  it('post pendente não aceita voto', async () => {
    const autor = await makeUser(`enq-pend-${Math.random()}@empresa.com`, 'LEAD')
    const post = await createPost({
      authorId: autor.id,
      content: 'aguardando',
      companyId: DEFAULT_COMPANY_ID,
      poll: enquete,
    })
    expect(post.status).toBe('PENDING')
    const votante = await makeUser(`enq-pend-v-${Math.random()}@empresa.com`)

    await expect(
      voteCorporatePostPoll({
        postId: post.id,
        optionId: post.poll!.options[0].id,
        viewer: viewerOf({ ...votante, companyId: DEFAULT_COMPANY_ID }),
      }),
    ).rejects.toMatchObject({ status: 409 })
  })

  // Moderar não é participar: o ADMIN enxerga o post de outro setor, mas o voto
  // dele sujaria uma enquete dirigida àquele setor.
  it('quem está fora do público-alvo não vota, nem sendo ADMIN', async () => {
    const autor = await makeUser(`enq-alvo-${Math.random()}@empresa.com`, 'ADMIN')
    const deFora = await makeUserInOtherSector(`enq-fora-${Math.random()}@empresa.com`)
    const post = await createPost({
      authorId: autor.id,
      content: 'só para um setor',
      companyId: DEFAULT_COMPANY_ID,
      poll: enquete,
      audience: 'SECTORS',
      audienceSectorIds: [SECTOR],
    })

    await expect(
      voteCorporatePostPoll({
        postId: post.id,
        optionId: post.poll!.options[0].id,
        viewer: { ...viewerOf({ ...deFora, companyId: DEFAULT_COMPANY_ID }), role: 'ADMIN' },
      }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('ver votantes exige ter votado', async () => {
    const { post } = await postComEnquete()
    const votante = await makeUser(`enq-lista-${Math.random()}@empresa.com`)
    const viewer = viewerOf({ ...votante, companyId: DEFAULT_COMPANY_ID })

    await expect(listCorporatePostPollVotes({ postId: post.id, viewer })).rejects.toMatchObject({
      status: 403,
    })

    await voteCorporatePostPoll({ postId: post.id, optionId: post.poll!.options[1].id, viewer })
    const lista = await listCorporatePostPollVotes({ postId: post.id, viewer })

    expect(lista.options[0].voters).toHaveLength(0)
    expect(lista.options[1].voters.map((v) => v.id)).toEqual([votante.id])
  })

  it('a enquete pode ser corrigida enquanto ninguém votou', async () => {
    const { autor, post } = await postComEnquete()

    const editado = await updatePost({
      postId: post.id,
      actorId: autor.id,
      role: 'ADMIN',
      companyId: DEFAULT_COMPANY_ID,
      poll: { question: 'Qual logotipo?', options: ['Azul', 'Verde', 'Roxo'] },
    })

    expect(editado.poll?.question).toBe('Qual logotipo?')
    expect(editado.poll?.options).toHaveLength(3)
  })

  it('depois do primeiro voto a enquete congela', async () => {
    const { autor, post } = await postComEnquete()
    const votante = await makeUser(`enq-congela-${Math.random()}@empresa.com`)
    await voteCorporatePostPoll({
      postId: post.id,
      optionId: post.poll!.options[0].id,
      viewer: viewerOf({ ...votante, companyId: DEFAULT_COMPANY_ID }),
    })

    await expect(
      updatePost({
        postId: post.id,
        actorId: autor.id,
        role: 'ADMIN',
        companyId: DEFAULT_COMPANY_ID,
        poll: { question: 'Outra pergunta', options: ['A', 'B'] },
      }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('apagar o post leva a enquete e os votos junto', async () => {
    const { autor, post } = await postComEnquete()
    const votante = await makeUser(`enq-cascade-${Math.random()}@empresa.com`)
    await voteCorporatePostPoll({
      postId: post.id,
      optionId: post.poll!.options[0].id,
      viewer: viewerOf({ ...votante, companyId: DEFAULT_COMPANY_ID }),
    })

    await deletePost({ postId: post.id, userId: autor.id, role: 'ADMIN', companyId: DEFAULT_COMPANY_ID })

    expect(await prisma.corporatePostPoll.count({ where: { postId: post.id } })).toBe(0)
    expect(await prisma.corporatePostPollVote.count()).toBe(0)
  })
})

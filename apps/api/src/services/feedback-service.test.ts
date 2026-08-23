import { describe, it, expect } from 'vitest'
import { prisma } from '../lib/prisma'
import {
  createFeedback,
  toggleReaction,
  setFeedbackShared,
  listFeedbacksForUser,
  FeedbackError,
  updateFeedback,
  deleteFeedback,
} from './feedback-service'

const LONG = 'feedback suficientemente longo para passar na validação de tamanho mínimo'

async function makeUser(name: string, role: 'LEGEND' | 'LEAD' | 'ADMIN' | 'SUBADMIN' = 'LEGEND') {
  return prisma.user.create({
    data: { name, email: `${name.toLowerCase()}@empresa.com`, passwordHash: 'x', role },
  })
}

describe('createFeedback', () => {
  it('rejeita SUBADMIN como autor (403)', async () => {
    const sub = await makeUser('SubAutor', 'SUBADMIN')
    const target = await makeUser('AlvoSub', 'LEAD')
    await expect(
      createFeedback({ authorId: sub.id, targetId: target.id, message: LONG, category: 'POSITIVO' }),
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe('toggleReaction', () => {
  it('adiciona quando não existe e remove no segundo toggle (idempotente)', async () => {
    const author = await makeUser('Autor')
    const target = await makeUser('Alvo', 'LEAD')
    const fb = await createFeedback({ authorId: author.id, targetId: target.id, message: LONG, category: 'POSITIVO' })

    const after1 = await toggleReaction({ feedbackId: fb.id, userId: target.id, emoji: '👏', viewerRole: 'LEAD' })
    expect(after1.reactions).toHaveLength(1)
    expect(after1.reactions[0].emoji).toBe('👏')

    const after2 = await toggleReaction({ feedbackId: fb.id, userId: target.id, emoji: '👏', viewerRole: 'LEAD' })
    expect(after2.reactions).toHaveLength(0)
  })

  it('rejeita emoji fora da lista permitida (400)', async () => {
    const author = await makeUser('Autor')
    const target = await makeUser('Alvo', 'LEAD')
    const fb = await createFeedback({ authorId: author.id, targetId: target.id, message: LONG, category: 'POSITIVO' })
    await expect(
      toggleReaction({ feedbackId: fb.id, userId: target.id, emoji: '💩', viewerRole: 'LEAD' }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('bloqueia reação em feedback privado não visível ao usuário (404)', async () => {
    const author = await makeUser('Autor')
    const target = await makeUser('Alvo', 'LEAD')
    const stranger = await makeUser('Estranho')
    const fb = await createFeedback({ authorId: author.id, targetId: target.id, message: LONG, category: 'ORIENTACAO' })
    await expect(
      toggleReaction({ feedbackId: fb.id, userId: stranger.id, emoji: '👏', viewerRole: 'LEGEND' }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('remove as reações em cascata ao excluir o feedback', async () => {
    const author = await makeUser('Autor')
    const target = await makeUser('Alvo', 'LEAD')
    const fb = await createFeedback({ authorId: author.id, targetId: target.id, message: LONG, category: 'POSITIVO' })
    await toggleReaction({ feedbackId: fb.id, userId: target.id, emoji: '🔥', viewerRole: 'LEAD' })
    await prisma.feedback.delete({ where: { id: fb.id } })
    const remaining = await prisma.feedbackReaction.count({ where: { feedbackId: fb.id } })
    expect(remaining).toBe(0)
  })
})

describe('setFeedbackShared', () => {
  it('marca sharedAt quando o alvo compartilha um feedback público', async () => {
    const author = await prisma.user.create({ data: { name: 'A', email: 'a-share@x.com', passwordHash: 'x' } })
    const target = await prisma.user.create({ data: { name: 'T', email: 't-share@x.com', passwordHash: 'x' } })
    const fb = await prisma.feedback.create({
      data: { authorId: author.id, targetId: target.id, message: 'mensagem bem específica aqui', category: 'POSITIVO' },
    })
    const updated = await setFeedbackShared({ feedbackId: fb.id, userId: target.id, shared: true })
    expect(updated.sharedAt).not.toBeNull()
  })

  // A 2ª rodada da G&G inverteu o dono da decisão: o AUTOR marca "Tornar
  // público no mural" no envio, então ele também publica depois. Quem recebeu
  // continua podendo — é o caminho dos feedbacks antigos, recebidos em privado.
  it('deixa o autor publicar e rejeita um terceiro (403)', async () => {
    const author = await prisma.user.create({ data: { name: 'A', email: 'a-share2@x.com', passwordHash: 'x' } })
    const target = await prisma.user.create({ data: { name: 'T', email: 't-share2@x.com', passwordHash: 'x' } })
    const estranho = await prisma.user.create({ data: { name: 'E', email: 'e-share2@x.com', passwordHash: 'x' } })
    const fb = await prisma.feedback.create({
      data: { authorId: author.id, targetId: target.id, message: 'mensagem bem específica aqui', category: 'POSITIVO' },
    })

    await expect(setFeedbackShared({ feedbackId: fb.id, userId: estranho.id, shared: true }))
      .rejects.toBeInstanceOf(FeedbackError)

    const publicado = await setFeedbackShared({ feedbackId: fb.id, userId: author.id, shared: true })
    expect(publicado.sharedAt).not.toBeNull()
  })

  it('rejeita categoria privada (403)', async () => {
    const author = await prisma.user.create({ data: { name: 'A', email: 'a-share3@x.com', passwordHash: 'x' } })
    const target = await prisma.user.create({ data: { name: 'T', email: 't-share3@x.com', passwordHash: 'x' } })
    const fb = await prisma.feedback.create({
      data: { authorId: author.id, targetId: target.id, message: 'mensagem bem específica aqui', category: 'MELHORIA' },
    })
    await expect(setFeedbackShared({ feedbackId: fb.id, userId: target.id, shared: true }))
      .rejects.toBeInstanceOf(FeedbackError)
  })

  it('descompartilha limpando sharedAt', async () => {
    const author = await prisma.user.create({ data: { name: 'A', email: 'a-share4@x.com', passwordHash: 'x' } })
    const target = await prisma.user.create({ data: { name: 'T', email: 't-share4@x.com', passwordHash: 'x' } })
    const fb = await prisma.feedback.create({
      data: { authorId: author.id, targetId: target.id, message: 'mensagem bem específica aqui', category: 'ELOGIO', sharedAt: new Date() },
    })
    const updated = await setFeedbackShared({ feedbackId: fb.id, userId: target.id, shared: false })
    expect(updated.sharedAt).toBeNull()
  })
})

describe('createFeedback escopado por empresa', () => {
  it('rejeita alvo de outra empresa (404)', async () => {
    const author = await makeUser('AutorCrossEmpresa')
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Feedback', slug: 'outra-empresa-feedback-svc-test' } })
    const target = await prisma.user.create({
      data: { name: 'AlvoOutraEmpresa', email: 'alvo-outra-empresa-feedback@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    await expect(
      createFeedback({ authorId: author.id, targetId: target.id, message: LONG, category: 'POSITIVO' }),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('listFeedbacksForUser escopado por empresa', () => {
  it('não retorna feedback com companyId divergente do alvo (defesa em profundidade)', async () => {
    const target = await makeUser('AlvoDefesaEmpresa')
    const author = await makeUser('AutorDefesaEmpresa')
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Defesa', slug: 'outra-empresa-defesa-test' } })
    // Linha com companyId divergente do alvo — inatingível via createFeedback (que já valida
    // author/target na mesma empresa), mas o filtro de leitura precisa estar lá mesmo assim.
    await prisma.feedback.create({
      data: { authorId: author.id, targetId: target.id, message: LONG, category: 'POSITIVO', companyId: otherCompany.id },
    })
    const page = await listFeedbacksForUser(target.id, { id: target.id, role: 'LEGEND' })
    expect(page.feedbacks).toEqual([])
    expect(page.total).toBe(0)
  })
})

describe('updateFeedback escopado por empresa', () => {
  it('ator de outra empresa recebe 404 (feedback não encontrado no seu escopo)', async () => {
    const author = await makeUser('AutorUpdate')
    const target = await makeUser('AlvoUpdate', 'LEAD')
    const fb = await createFeedback({ authorId: author.id, targetId: target.id, message: LONG, category: 'POSITIVO' })
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Update', slug: 'outra-empresa-update-test' } })
    const outsider = await prisma.user.create({
      data: { name: 'ForaUpdate', email: 'fora-update@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    await expect(
      updateFeedback({ feedbackId: fb.id, userId: outsider.id, message: 'nova mensagem bem específica' }),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('setFeedbackShared escopado por empresa', () => {
  it('ator de outra empresa recebe 404 (feedback não encontrado no seu escopo)', async () => {
    const author = await makeUser('AutorShareEmpresa')
    const target = await makeUser('AlvoShareEmpresa', 'LEAD')
    const fb = await createFeedback({ authorId: author.id, targetId: target.id, message: LONG, category: 'POSITIVO' })
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Share', slug: 'outra-empresa-share-test' } })
    const outsider = await prisma.user.create({
      data: { name: 'ForaShare', email: 'fora-share@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    await expect(
      setFeedbackShared({ feedbackId: fb.id, userId: outsider.id, shared: true }),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('deleteFeedback escopado por empresa', () => {
  it('ADMIN de outra empresa não consegue apagar (404)', async () => {
    const author = await makeUser('AutorDelete')
    const target = await makeUser('AlvoDelete', 'LEAD')
    const fb = await createFeedback({ authorId: author.id, targetId: target.id, message: LONG, category: 'POSITIVO' })
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Delete', slug: 'outra-empresa-delete-test' } })
    const adminOutraEmpresa = await prisma.user.create({
      data: { name: 'AdminOutraEmpresa', email: 'admin-outra-empresa-delete@x.com', passwordHash: 'x', role: 'ADMIN', companyId: otherCompany.id },
    })
    await expect(
      deleteFeedback({ feedbackId: fb.id, userId: adminOutraEmpresa.id }),
    ).rejects.toMatchObject({ status: 404 })
  })
})

describe('toggleReaction escopado por empresa', () => {
  it('usuário de outra empresa não consegue reagir a feedback público (404)', async () => {
    const author = await makeUser('AutorReacaoEmpresa')
    const target = await makeUser('AlvoReacaoEmpresa', 'LEAD')
    const fb = await createFeedback({ authorId: author.id, targetId: target.id, message: LONG, category: 'POSITIVO' })
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Reacao', slug: 'outra-empresa-reacao-test' } })
    const strangerOutraEmpresa = await prisma.user.create({
      data: { name: 'EstranhoOutraEmpresa', email: 'estranho-outra-empresa@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    await expect(
      toggleReaction({ feedbackId: fb.id, userId: strangerOutraEmpresa.id, emoji: '👏', viewerRole: 'LEGEND' }),
    ).rejects.toMatchObject({ status: 404 })
  })
})

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

  it('não mostra feedback, selo, aviso de humor e resenha compartilhada de outra empresa', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Mural', slug: 'outra-empresa-mural-test' } })
    const authorOutraEmpresa = await prisma.user.create({
      data: { name: 'AutorOutraEmpresaMural', email: 'autor-outra-empresa-mural@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    const targetOutraEmpresa = await prisma.user.create({
      data: { name: 'AlvoOutraEmpresaMural', email: 'alvo-outra-empresa-mural@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    await prisma.feedback.create({
      data: {
        authorId: authorOutraEmpresa.id,
        targetId: targetOutraEmpresa.id,
        message: 'feedback compartilhado de outra empresa',
        category: 'POSITIVO',
        sharedAt: new Date(),
        companyId: otherCompany.id,
      },
    })
    const badge = await prisma.badge.create({
      data: { slug: 'mural-outra-empresa', name: 'Selo Outra Empresa', description: 'd', kind: 'IMPACT', iconKey: 'trophy' },
    })
    await prisma.userBadge.create({ data: { userId: targetOutraEmpresa.id, badgeId: badge.id, companyId: otherCompany.id } })
    const viewer = await makeUser('m-viewer-empresa-padrao@x.com')
    const items = await getMuralItems(viewer.id, viewer.sectorId)
    expect(items.filter((i) => i.type === 'feedback')).toHaveLength(0)
    expect(items.filter((i) => i.type === 'badge')).toHaveLength(0)
  })

  it('não mostra aviso de humor de outra empresa', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Mural Mood', slug: 'outra-empresa-mural-mood-test' } })
    const responderOutraEmpresa = await prisma.user.create({
      data: { name: 'ResponderOutraEmpresaMural', email: 'responder-outra-empresa-mural@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    const { day } = todayInSaoPaulo()
    await prisma.moodEntry.create({
      data: { userId: responderOutraEmpresa.id, day, mood: 'GREAT', note: null, companyId: otherCompany.id },
    })
    const viewer = await makeUser('m-viewer-empresa-padrao-mood@x.com')
    const items = await getMuralItems(viewer.id, viewer.sectorId)
    expect(items.filter((i) => i.type === 'mood')).toHaveLength(0)
  })

  it('não mostra resenha compartilhada de outra empresa', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Mural Review', slug: 'outra-empresa-mural-review-test' } })
    const authorOutraEmpresa = await prisma.user.create({
      data: { name: 'AutorOutraEmpresaMuralReview', email: 'autor-outra-empresa-mural-review@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    const sharerOutraEmpresa = await prisma.user.create({
      data: { name: 'SharerOutraEmpresaMuralReview', email: 'sharer-outra-empresa-mural-review@x.com', passwordHash: 'x', companyId: otherCompany.id },
    })
    const review = await prisma.review.create({
      data: { authorId: authorOutraEmpresa.id, content: 'resenha de outra empresa', companyId: otherCompany.id, sectorId: SECTOR },
    })
    await prisma.reviewShare.create({
      data: { reviewId: review.id, userId: sharerOutraEmpresa.id, companyId: otherCompany.id, sectorId: SECTOR },
    })
    const viewer = await makeUser('m-viewer-empresa-padrao-review@x.com')
    const items = await getMuralItems(viewer.id, viewer.sectorId)
    expect(items.filter((i) => i.type === 'review')).toHaveLength(0)
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
    const outroReview = await prisma.review.create({ data: { authorId: outroAuthor.id, content: 'resenha de outro setor', sectorId: outroAuthor.sectorId } })
    await prisma.reviewShare.create({ data: { reviewId: outroReview.id, userId: outroTarget.id, sectorId: outroAuthor.sectorId } })

    const items = await getMuralItems(viewer.id, viewer.sectorId)
    expect(items.filter((i) => i.type === 'feedback')).toHaveLength(0)
    expect(items.filter((i) => i.type === 'badge')).toHaveLength(0)
    expect(items.filter((i) => i.type === 'mood')).toHaveLength(0)
    expect(items.filter((i) => i.type === 'review')).toHaveLength(0)
  })
})

import { describe, it, expect } from 'vitest'
import { MAX_FEATURED_BADGES, DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { getUserProfile, listShowcase, setFeaturedBadges, ProfileError } from './profile-service'
import { materializeVoteFeedbacks } from './vote-feedback-service'
import { createSector } from './sector-service'

let counter = 0
async function makeUser(name: string) {
  counter += 1
  return prisma.user.create({ data: { name, email: `${name}-${counter}@empresa.com`, passwordHash: 'x' } })
}
/** Período com o destaque já publicado pelo admin — é o que materializa os feedbacks do voto. */
async function makePeriod(monthRef: string) {
  return prisma.votingPeriod.create({
    data: { monthRef, startsAt: new Date(`${monthRef}-01`), endsAt: new Date(`${monthRef}-28`), status: 'CLOSED', highlightStatus: 'PUBLISHED' },
  })
}
const just = 'justificativa válida'

/** Feedback recebido, com destinatário e categoria — é o que o perfil agrega. */
async function giveFeedback(authorId: string, targetId: string, categoryId: string, createdAt: Date) {
  return prisma.feedback.create({
    data: {
      authorId,
      targetId,
      message: just,
      category: 'ELOGIO',
      createdAt,
      recipients: { create: [{ userId: targetId }] },
      recognitionCategories: { create: [{ categoryId }] },
    },
  })
}

async function seedScenario() {
  const target = await makeUser('Alvo')
  const a = await makeUser('A')
  const b = await makeUser('B')
  const c = await makeUser('C')
  const colaboracao = await prisma.recognitionCategory.create({ data: { name: 'Colaboração', slug: 'colaboracao' } })
  const inovacao = await prisma.recognitionCategory.create({ data: { name: 'Inovação', slug: 'inovacao' } })
  // recebidos pelo Alvo: 2 em colaboração (maio) + 1 em inovação (junho)
  await giveFeedback(a.id, target.id, colaboracao.id, new Date('2026-05-10T12:00:00.000Z'))
  await giveFeedback(b.id, target.id, colaboracao.id, new Date('2026-05-20T12:00:00.000Z'))
  await giveFeedback(c.id, target.id, inovacao.id, new Date('2026-06-10T12:00:00.000Z'))
  return { target }
}

describe('profile service', () => {
  it('agrega total, meses distintos e quebra por categoria dos feedbacks recebidos', async () => {
    const { target } = await seedScenario()
    const profile = await getUserProfile(target.id)
    expect(profile).not.toBeNull()
    expect(profile!.totalFeedbacksReceived).toBe(3)
    expect(profile!.monthsWithFeedback).toBe(2)
    expect(profile!.categoryBreakdown).toEqual([
      { categorySlug: 'colaboracao', categoryName: 'Colaboração', count: 2 },
      { categorySlug: 'inovacao', categoryName: 'Inovação', count: 1 },
    ])
    expect(profile!.months).toEqual(['2026-06', '2026-05'])
  })

  it('returns null for an unknown user', async () => {
    expect(await getUserProfile('nope')).toBeNull()
  })

  it('voto de período em aberto não aparece no perfil — só vira feedback na publicação', async () => {
    const target = await makeUser('AguardandoFechamento')
    const voter = await makeUser('Votante')
    const category = await prisma.recognitionCategory.create({ data: { name: 'Colaboração', slug: 'colaboracao-open' } })
    const period = await prisma.votingPeriod.create({
      data: { monthRef: '2026-07', startsAt: new Date('2026-07-01'), endsAt: new Date('2026-07-31'), status: 'OPEN' },
    })
    await prisma.vote.create({
      data: {
        voterId: voter.id,
        votedId: target.id,
        periodId: period.id,
        justification: just,
        categories: { create: [{ categoryId: category.id }] },
      },
    })

    const profile = await getUserProfile(target.id)
    const row = (await listShowcase()).find((r) => r.user.id === target.id)

    expect(profile?.totalFeedbacksReceived).toBe(0)
    expect(profile?.monthsWithFeedback).toBe(0)
    expect(profile?.months).toEqual([])
    expect(profile?.categoryBreakdown).toEqual([])
    expect(row?.feedbacksReceived).toBe(0)
  })

  it('publicar o destaque materializa o voto como feedback e o perfil passa a contar', async () => {
    const target = await makeUser('AguardandoPublicacao')
    const voter = await makeUser('VotanteDraft')
    const category = await prisma.recognitionCategory.create({ data: { name: 'Colaboração', slug: 'colaboracao-draft' } })
    const period = await prisma.votingPeriod.create({
      data: { monthRef: '2026-08', startsAt: new Date('2026-08-01'), endsAt: new Date('2026-08-31'), status: 'CLOSED', highlightStatus: 'DRAFT' },
    })
    await prisma.vote.create({
      data: {
        voterId: voter.id,
        votedId: target.id,
        periodId: period.id,
        justification: just,
        categories: { create: [{ categoryId: category.id }] },
      },
    })

    expect((await getUserProfile(target.id))?.totalFeedbacksReceived).toBe(0)

    // É o que `publishHighlight` dispara depois do commit.
    await materializeVoteFeedbacks(period.id)

    const profile = await getUserProfile(target.id)
    expect(profile?.totalFeedbacksReceived).toBe(1)
    expect(profile?.categoryBreakdown).toEqual([
      { categorySlug: 'colaboracao-draft', categoryName: 'Colaboração', count: 1 },
    ])
    expect((await listShowcase()).find((r) => r.user.id === target.id)?.feedbacksReceived).toBe(1)
  })

  it('inclui lideranças (LEAD) na galeria de conquistas, independente do papel', async () => {
    await makeUser('Dev')
    counter += 1
    await prisma.user.create({ data: { name: 'Lider', email: `lider-${counter}@empresa.com`, passwordHash: 'x', role: 'LEAD' } })
    const rows = await listShowcase()
    const names = rows.map((r) => r.user.name)
    expect(names).toContain('Dev')
    expect(names).toContain('Lider')
  })

  it('mantém usuários inativos fora da galeria de conquistas', async () => {
    counter += 1
    await prisma.user.create({ data: { name: 'Inativo', email: `inativo-${counter}@empresa.com`, passwordHash: 'x', active: false } })
    const rows = await listShowcase()
    expect(rows.map((r) => r.user.name)).not.toContain('Inativo')
  })

  it('separa ex-lendas (leftAt setado) do showcase ativo via opção former', async () => {
    const ativa = await makeUser('Ativa')
    const exLenda = await prisma.user.create({
      data: { name: 'Saiu', email: 'saiu@empresa.com', passwordHash: 'x', active: false, leftAt: new Date('2026-07-10T00:00:00.000Z') },
    })

    const ativos = await listShowcase()
    expect(ativos.map((r) => r.user.id)).toContain(ativa.id)
    expect(ativos.map((r) => r.user.id)).not.toContain(exLenda.id)

    const former = await listShowcase({ former: true })
    expect(former.map((r) => r.user.id)).toContain(exLenda.id)
    expect(former.map((r) => r.user.id)).not.toContain(ativa.id)
  })

  it('listShowcase filtra por sectorId quando informado', async () => {
    const actor = await prisma.user.create({ data: { name: 'Admin', email: `admin-profile-sector-${counter}@x.com`, passwordHash: 'x', role: 'ADMIN' } })
    const sectorA = await createSector({ name: 'Setor Showcase A', enabledFeatures: [], roles: [] }, actor.id, DEFAULT_COMPANY_ID)
    const sectorB = await createSector({ name: 'Setor Showcase B', enabledFeatures: [], roles: [] }, actor.id, DEFAULT_COMPANY_ID)
    counter += 1
    const devA = await prisma.user.create({ data: { name: 'Dev A', email: `deva-${counter}@empresa.com`, passwordHash: 'x', sectorId: sectorA.id } })
    counter += 1
    const devB = await prisma.user.create({ data: { name: 'Dev B', email: `devb-${counter}@empresa.com`, passwordHash: 'x', sectorId: sectorB.id } })

    const rowsA = await listShowcase({ sectorId: sectorA.id })
    expect(rowsA.map((r) => r.user.id)).toContain(devA.id)
    expect(rowsA.map((r) => r.user.id)).not.toContain(devB.id)

    const all = await listShowcase()
    expect(all.map((r) => r.user.id)).toContain(devA.id)
    expect(all.map((r) => r.user.id)).toContain(devB.id)
  })
})

describe('featured badges', () => {
  async function makeBadge(slug: string) {
    return prisma.badge.create({
      data: { slug, name: slug, description: 'd', kind: 'IMPACT', iconKey: 'fire', threshold: 0 },
    })
  }

  it('coloca os selos destacados na frente no showcase', async () => {
    const user = await makeUser('Vitrine')
    const b1 = await makeBadge('antigo')
    const b2 = await makeBadge('novo')
    // antigo é o mais recente por awardedAt; sem destaque viria primeiro
    const oldUb = await prisma.userBadge.create({ data: { userId: user.id, badgeId: b1.id, awardedAt: new Date('2026-06-02') } })
    await prisma.userBadge.create({ data: { userId: user.id, badgeId: b2.id, awardedAt: new Date('2026-06-01') } })

    await setFeaturedBadges(user.id, [oldUb.id])

    const rows = await listShowcase()
    const row = rows.find((r) => r.user.id === user.id)!
    expect(row.badges[0].id).toBe(oldUb.id)
    expect(row.badges[0].featured).toBe(true)
  })

  it('substitui o conjunto de destaques (idempotente)', async () => {
    const user = await makeUser('Troca')
    const b1 = await makeBadge('um')
    const b2 = await makeBadge('dois')
    const ub1 = await prisma.userBadge.create({ data: { userId: user.id, badgeId: b1.id } })
    const ub2 = await prisma.userBadge.create({ data: { userId: user.id, badgeId: b2.id } })

    await setFeaturedBadges(user.id, [ub1.id])
    await setFeaturedBadges(user.id, [ub2.id])

    const after = await prisma.userBadge.findMany({ where: { userId: user.id, featured: true } })
    expect(after.map((u) => u.id)).toEqual([ub2.id])
  })

  it('rejeita selo que não pertence ao usuário', async () => {
    const user = await makeUser('Dono')
    const outro = await makeUser('Outro')
    const badge = await makeBadge('alheio')
    const ub = await prisma.userBadge.create({ data: { userId: outro.id, badgeId: badge.id } })

    await expect(setFeaturedBadges(user.id, [ub.id])).rejects.toBeInstanceOf(ProfileError)
  })

  it('rejeita acima do limite de destaques', async () => {
    const user = await makeUser('Excesso')
    const ids: string[] = []
    for (let i = 0; i < MAX_FEATURED_BADGES + 1; i += 1) {
      const badge = await makeBadge(`selo-${i}`)
      const ub = await prisma.userBadge.create({ data: { userId: user.id, badgeId: badge.id } })
      ids.push(ub.id)
    }
    await expect(setFeaturedBadges(user.id, ids)).rejects.toBeInstanceOf(ProfileError)
  })
})

describe('profile-service escopado por empresa', () => {
  it('getUserProfile não conta feedback de outra empresa mesmo quando o destinatário é o usuário do perfil', async () => {
    // Vazamento real: uma linha de FeedbackRecipient apontando para o usuário do
    // perfil, mas com companyId de outra empresa (construível direto no banco,
    // contornando o invariante do service) — é o cenário de defesa em
    // profundidade que o escopo cobre.
    const user = await prisma.user.create({ data: { name: 'Dev Empresa Padrão Profile', email: 'dev-empresa-padrao-profile@x.com', passwordHash: 'x' } })

    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Profile', slug: 'outra-empresa-profile-test' } })
    const otherCategory = await prisma.recognitionCategory.create({ data: { name: 'Cat Outra Empresa Profile', slug: 'cat-outra-empresa-profile-test', companyId: otherCompany.id } })
    const otherAuthor = await prisma.user.create({ data: { name: 'Autor Outra Empresa', email: 'autor-outra-empresa-profile@x.com', passwordHash: 'x', companyId: otherCompany.id } })
    await prisma.feedback.create({
      data: {
        authorId: otherAuthor.id,
        targetId: user.id,
        message: just,
        category: 'ELOGIO',
        companyId: otherCompany.id,
        recipients: { create: [{ userId: user.id, companyId: otherCompany.id }] },
        recognitionCategories: { create: [{ categoryId: otherCategory.id, companyId: otherCompany.id }] },
      },
    })

    const profile = await getUserProfile(user.id)
    expect(profile?.totalFeedbacksReceived).toBe(0)
    expect(profile?.monthsWithFeedback).toBe(0)
    expect(profile?.categoryBreakdown).toEqual([])
  })

  it('listShowcase isola por empresa quando companyId é informado', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Showcase', slug: 'outra-empresa-showcase-test' } })
    await prisma.user.create({ data: { name: 'Dev Outra Empresa Showcase', email: 'dev-outra-empresa-showcase@x.com', passwordHash: 'x', companyId: otherCompany.id } })
    const user = await prisma.user.create({ data: { name: 'Dev Empresa Padrão Showcase', email: 'dev-empresa-padrao-showcase@x.com', passwordHash: 'x' } })

    const rows = await listShowcase({ companyId: DEFAULT_COMPANY_ID })
    expect(rows.some((r) => r.user.id === user.id)).toBe(true)
    expect(rows.some((r) => r.user.name === 'Dev Outra Empresa Showcase')).toBe(false)
  })
})

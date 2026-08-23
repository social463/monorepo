import { describe, it, expect } from 'vitest'
import { prisma } from '../lib/prisma'
import { materializeVoteFeedbacks } from './vote-feedback-service'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import {
  evaluateBadgesForUser,
  evaluateTenureBadgesForUser,
  evaluateTenureBadgesForAllUsers,
  listBadgesForUser,
  grantBadgeManually,
  revokeManualBadge,
  syncFeedbackBadgesForUser,
  getBadgeCatalog,
  BadgeError,
  completedYears,
} from './badge-service'

let counter = 0
async function makeUser(name: string) {
  counter += 1
  return prisma.user.create({ data: { name, email: `${name}-${counter}@empresa.com`, passwordHash: 'x' } })
}
async function makeFeedbackBadge(threshold: number, slug = `feedbacker-${threshold}`) {
  return prisma.badge.create({
    data: { slug, name: `Feedbacker ${threshold}`, description: `${threshold} feedbacks feitos`, kind: 'FEEDBACK', iconKey: 'chat', threshold },
  })
}
async function giveFeedback(authorId: string, targetId: string) {
  return prisma.feedback.create({
    data: { authorId, targetId, message: 'feedback suficientemente longo para a contagem', category: 'POSITIVO' },
  })
}
/**
 * Feedback RECEBIDO — é o que CATEGORY, IMPACT e RECURRENCE contam desde a
 * unificação. `FeedbackRecipient` é a fonte, e não `targetId`, por causa do
 * feedback grupal.
 */
async function receiveFeedback(
  targetId: string,
  opts: { categoryId?: string; createdAt?: Date } = {},
) {
  const author = await makeUser('Autor')
  return prisma.feedback.create({
    data: {
      authorId: author.id,
      targetId,
      message: 'feedback suficientemente longo para a contagem',
      category: 'ELOGIO',
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
      recipients: { create: [{ userId: targetId }] },
      ...(opts.categoryId ? { recognitionCategories: { create: [{ categoryId: opts.categoryId }] } } : {}),
    },
  })
}

const just = 'justificativa válida'

describe('badge service', () => {
  it('concede o selo de CATEGORIA ao atingir o total de feedbacks na categoria, idempotente', async () => {
    const target = await makeUser('Alvo')
    const cat = await prisma.recognitionCategory.create({ data: { name: 'Colaboração', slug: 'colaboracao' } })
    const badge = await prisma.badge.create({
      data: { slug: 'conector', name: 'Conector', description: '2 em colaboração', kind: 'CATEGORY', iconKey: 'link', threshold: 2, categorySlug: 'colaboracao' },
    })

    await receiveFeedback(target.id, { categoryId: cat.id })
    expect(await evaluateBadgesForUser(target.id)).toHaveLength(0)

    await receiveFeedback(target.id, { categoryId: cat.id })
    const awarded = await evaluateBadgesForUser(target.id)
    expect(awarded).toHaveLength(1)
    expect(awarded[0].badgeId).toBe(badge.id)

    // idempotente: não concede de novo
    expect(await evaluateBadgesForUser(target.id)).toHaveLength(0)
  })

  it('concede o selo de IMPACTO pelo total de feedbacks recebidos', async () => {
    const target = await makeUser('Alvo')
    const cat = await prisma.recognitionCategory.create({ data: { name: 'Impacto', slug: 'impacto' } })
    await prisma.badge.create({
      data: { slug: 'reconhecido', name: 'Reconhecido', description: '3 feedbacks', kind: 'IMPACT', iconKey: 'star', threshold: 3 },
    })
    for (let i = 0; i < 3; i += 1) await receiveFeedback(target.id, { categoryId: cat.id })
    const awarded = await evaluateBadgesForUser(target.id)
    expect(awarded).toHaveLength(1)
  })

  // Voto novo já nasce com o feedback junto (`createVote`), então conta na hora.
  // O que este teste cobre é o legado: voto gravado antes dessa mudança, sem
  // feedback, não conta até a materialização alcançá-lo.
  it('voto antigo sem feedback materializado não conta; a materialização faz contar', async () => {
    const target = await makeUser('VotoLegado')
    const cat = await prisma.recognitionCategory.create({ data: { name: 'Impacto', slug: 'impacto-voto-legado' } })
    const badge = await prisma.badge.create({
      data: { slug: 'reconhecido-voto-legado', name: 'Reconhecido', description: '2 feedbacks', kind: 'IMPACT', iconKey: 'star', threshold: 2 },
    })
    const period = await prisma.votingPeriod.create({
      data: { monthRef: '2026-07', startsAt: new Date('2026-07-01'), endsAt: new Date('2026-07-31'), status: 'CLOSED', highlightStatus: 'DRAFT' },
    })
    for (let i = 0; i < 2; i += 1) {
      const voter = await makeUser(`VoterLegado${i}`)
      await prisma.vote.create({ data: { voterId: voter.id, votedId: target.id, periodId: period.id, justification: just, categories: { create: [{ categoryId: cat.id }] } } })
    }

    expect(await evaluateBadgesForUser(target.id)).toHaveLength(0)
    const catalog = await getBadgeCatalog(target.id)
    expect(catalog.find((e) => e.badge.id === badge.id)?.progress).toEqual({ current: 0, target: 2 })

    // A materialização (roda na publicação do destaque) transforma o voto legado
    // em feedback; aí os mesmos textos valem.
    await materializeVoteFeedbacks(period.id)
    const awarded = await evaluateBadgesForUser(target.id)
    expect(awarded.map((a) => a.badgeId)).toContain(badge.id)
  })

  it('evaluateBadgesForUser não avalia/concede selo específico de outro setor', async () => {
    const sectorA = await prisma.sector.create({ data: { name: 'Setor A', slug: 'setor-a-badge-test', enabledFeatures: [] } })
    const sectorB = await prisma.sector.create({ data: { name: 'Setor B', slug: 'setor-b-badge-test', enabledFeatures: [] } })
    const user = await prisma.user.create({ data: { name: 'U', email: 'u-badge-sector@x.com', passwordHash: 'x', sectorId: sectorA.id } })
    const badgeB = await prisma.badge.create({
      data: { name: 'Só Setor B', slug: 'so-setor-b-badge', description: 'd', kind: 'IMPACT', iconKey: 'star', threshold: 0, global: false, sectors: { create: [{ sectorId: sectorB.id }] } },
    })
    await evaluateBadgesForUser(user.id)
    const owned = await prisma.userBadge.findMany({ where: { userId: user.id, badgeId: badgeB.id } })
    expect(owned).toHaveLength(0)
  })

  it('evaluateBadgesForUser concede selo global normalmente', async () => {
    const sectorA = await prisma.sector.create({ data: { name: 'Setor A2', slug: 'setor-a2-badge-test', enabledFeatures: [] } })
    const user = await prisma.user.create({ data: { name: 'U2', email: 'u2-badge-sector@x.com', passwordHash: 'x', sectorId: sectorA.id } })
    const badgeGlobal = await prisma.badge.create({
      data: { name: 'Global Impact', slug: 'global-impact-badge', description: 'd', kind: 'IMPACT', iconKey: 'star', threshold: 0 },
    })
    await evaluateBadgesForUser(user.id)
    const owned = await prisma.userBadge.findMany({ where: { userId: user.id, badgeId: badgeGlobal.id } })
    expect(owned).toHaveLength(1)
  })

  it('concede o selo de RECORRÊNCIA por meses distintos com feedback recebido', async () => {
    const target = await makeUser('Alvo')
    const cat = await prisma.recognitionCategory.create({ data: { name: 'Colaboração', slug: 'colaboracao' } })
    await prisma.badge.create({
      data: { slug: 'constante', name: 'Presença Constante', description: '2 meses', kind: 'RECURRENCE', iconKey: 'calendar', threshold: 2 },
    })
    // Dois feedbacks no mesmo mês contam como UM mês — daí o terceiro em junho.
    await receiveFeedback(target.id, { categoryId: cat.id, createdAt: new Date('2026-05-03T12:00:00.000Z') })
    await receiveFeedback(target.id, { categoryId: cat.id, createdAt: new Date('2026-05-20T12:00:00.000Z') })
    expect(await evaluateBadgesForUser(target.id)).toHaveLength(0)

    await receiveFeedback(target.id, { categoryId: cat.id, createdAt: new Date('2026-06-04T12:00:00.000Z') })
    const awarded = await evaluateBadgesForUser(target.id)
    expect(awarded).toHaveLength(1)
  })

  it('lists badges awarded to a user with badge details', async () => {
    const target = await makeUser('Alvo')
    const badge = await prisma.badge.create({
      data: { slug: 'x', name: 'Selo X', description: 'd', kind: 'IMPACT', iconKey: 'star', threshold: 0 },
    })
    await prisma.userBadge.create({ data: { userId: target.id, badgeId: badge.id } })
    const list = await listBadgesForUser(target.id)
    expect(list).toHaveLength(1)
    expect(list[0].badge.name).toBe('Selo X')
  })

  it('grants a badge manually with MANUAL source and the awarding admin', async () => {
    const member = await makeUser('Membro')
    const admin = await makeUser('Admin')
    const badge = await prisma.badge.create({
      data: { slug: 'honra', name: 'Honra', description: 'manual', kind: 'IMPACT', iconKey: 'star', threshold: 0 },
    })
    const awarded = await grantBadgeManually(member.id, badge.id, admin.id)
    expect(awarded.source).toBe('MANUAL')
    expect(awarded.awardedById).toBe(admin.id)
    expect(awarded.periodId).toBeNull()
    expect(awarded.badge.name).toBe('Honra')
  })

  it('never persists the awarding admin passwordHash/teamsWebhookUrl in the audit log (nested User via awardedBy)', async () => {
    const member = await makeUser('Membro')
    const admin = await prisma.user.create({
      data: {
        name: 'Admin Segredo',
        email: `admin-segredo-${Date.now()}@empresa.com`,
        passwordHash: 'super-secret-hash-nao-pode-vazar',
        teamsWebhookUrl: 'https://outlook.office.com/webhook/nao-pode-vazar',
      },
    })
    const badge = await prisma.badge.create({
      data: { slug: 'honra-segura', name: 'Honra Segura', description: 'manual', kind: 'IMPACT', iconKey: 'star', threshold: 0 },
    })
    const awarded = await grantBadgeManually(member.id, badge.id, admin.id)

    const log = await prisma.adminAuditLog.findFirst({ where: { entityType: 'UserBadge', entityId: awarded.id } })
    expect(log).not.toBeNull()
    const serialized = JSON.stringify(log?.after)
    expect(serialized).not.toContain('passwordHash')
    expect(serialized).not.toContain('super-secret-hash-nao-pode-vazar')
    expect(serialized).not.toContain('teamsWebhookUrl')
    expect(serialized).not.toContain('nao-pode-vazar')
    // continua rastreável: id e nome do concedente sobrevivem, só os dados sensíveis somem
    expect(serialized).toContain(admin.id)
    expect(serialized).toContain('Admin Segredo')
  })

  it('rejects granting the same badge twice (unique violation)', async () => {
    const member = await makeUser('Membro')
    const admin = await makeUser('Admin')
    const badge = await prisma.badge.create({
      data: { slug: 'honra', name: 'Honra', description: 'manual', kind: 'IMPACT', iconKey: 'star', threshold: 0 },
    })
    await grantBadgeManually(member.id, badge.id, admin.id)
    await expect(grantBadgeManually(member.id, badge.id, admin.id)).rejects.toMatchObject({ code: 'P2002' })
  })

  it('revokes a manual award', async () => {
    const member = await makeUser('Membro')
    const admin = await makeUser('Admin')
    const badge = await prisma.badge.create({
      data: { slug: 'honra', name: 'Honra', description: 'manual', kind: 'IMPACT', iconKey: 'star', threshold: 0 },
    })
    const awarded = await grantBadgeManually(member.id, badge.id, admin.id)
    await revokeManualBadge(member.id, awarded.id, admin.id, DEFAULT_COMPANY_ID)
    expect(await prisma.userBadge.findUnique({ where: { id: awarded.id } })).toBeNull()
  })

  it('refuses to revoke an automatic award (409)', async () => {
    const member = await makeUser('Membro')
    const badge = await prisma.badge.create({
      data: { slug: 'auto', name: 'Auto', description: 'a', kind: 'IMPACT', iconKey: 'star', threshold: 0 },
    })
    const auto = await prisma.userBadge.create({ data: { userId: member.id, badgeId: badge.id } })
    await expect(revokeManualBadge(member.id, auto.id, member.id, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 409 })
  })

  it('errors when revoking an award that does not belong to the member (404)', async () => {
    const member = await makeUser('Membro')
    const other = await makeUser('Outro')
    const admin = await makeUser('Admin')
    const badge = await prisma.badge.create({
      data: { slug: 'honra', name: 'Honra', description: 'manual', kind: 'IMPACT', iconKey: 'star', threshold: 0 },
    })
    const awarded = await grantBadgeManually(member.id, badge.id, admin.id)
    await expect(revokeManualBadge(other.id, awarded.id, admin.id, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 404 })
  })

  it('revokeManualBadge rejeita quando o companyId do ator não bate com o do membro (404)', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Revoke Badge', slug: 'outra-empresa-revoke-badge-test' } })
    const otherSector = await prisma.sector.create({ data: { name: 'Setor Outra Empresa Revoke Badge', slug: 'setor-outra-empresa-revoke-badge-test', companyId: otherCompany.id } })
    const member = await prisma.user.create({ data: { name: 'Membro Outra', email: 'membro-outra-revoke-badge@x.com', passwordHash: 'x', companyId: otherCompany.id, sectorId: otherSector.id } })
    const admin = await makeUser('Admin')
    const badge = await prisma.badge.create({
      data: { slug: 'honra-outra-empresa', name: 'Honra Outra Empresa', description: 'manual', kind: 'IMPACT', iconKey: 'star', threshold: 0 },
    })
    const awarded = await prisma.userBadge.create({ data: { userId: member.id, badgeId: badge.id, source: 'MANUAL', awardedById: admin.id } })

    await expect(revokeManualBadge(member.id, awarded.id, admin.id, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 404 })
  })

  it('awards a FEEDBACK badge once the author reaches the threshold of feedbacks given', async () => {
    const author = await makeUser('Autor')
    const t1 = await makeUser('Alvo1')
    const t2 = await makeUser('Alvo2')
    const badge = await makeFeedbackBadge(2)

    await giveFeedback(author.id, t1.id)
    expect((await syncFeedbackBadgesForUser(author.id)).awarded).toHaveLength(0)

    await giveFeedback(author.id, t2.id)
    const res = await syncFeedbackBadgesForUser(author.id)
    expect(res.awarded).toHaveLength(1)
    expect(res.awarded[0].badgeId).toBe(badge.id)

    // idempotente
    expect((await syncFeedbackBadgesForUser(author.id)).awarded).toHaveLength(0)
  })

  it('revokes an AUTO FEEDBACK badge when the count drops below the threshold', async () => {
    const author = await makeUser('Autor')
    const t1 = await makeUser('Alvo1')
    const t2 = await makeUser('Alvo2')
    const badge = await makeFeedbackBadge(2)

    const f1 = await giveFeedback(author.id, t1.id)
    await giveFeedback(author.id, t2.id)
    expect((await syncFeedbackBadgesForUser(author.id)).awarded).toHaveLength(1)

    await prisma.feedback.delete({ where: { id: f1.id } })
    const res = await syncFeedbackBadgesForUser(author.id)
    expect(res.revoked).toBe(1)
    expect(await prisma.userBadge.count({ where: { userId: author.id, badgeId: badge.id } })).toBe(0)
  })

  it('does not revoke a MANUAL FEEDBACK badge even below the threshold', async () => {
    const author = await makeUser('Autor')
    const admin = await makeUser('Admin')
    const badge = await makeFeedbackBadge(5)
    await prisma.userBadge.create({
      data: { userId: author.id, badgeId: badge.id, source: 'MANUAL', awardedById: admin.id, periodId: null },
    })

    const res = await syncFeedbackBadgesForUser(author.id)
    expect(res.revoked).toBe(0)
    expect(await prisma.userBadge.count({ where: { userId: author.id, badgeId: badge.id } })).toBe(1)
  })

  it('evaluateBadgesForUser ignores FEEDBACK badges', async () => {
    const author = await makeUser('Autor')
    const t1 = await makeUser('Alvo1')
    await makeFeedbackBadge(1)
    await giveFeedback(author.id, t1.id)

    expect(await evaluateBadgesForUser(author.id)).toHaveLength(0)
  })

  it('getBadgeCatalog derives a FEEDBACK requirement and the user progress', async () => {
    const author = await makeUser('Autor')
    const t1 = await makeUser('Alvo1')
    const t2 = await makeUser('Alvo2')
    const t3 = await makeUser('Alvo3')
    await makeFeedbackBadge(5)
    await giveFeedback(author.id, t1.id)
    await giveFeedback(author.id, t2.id)
    await giveFeedback(author.id, t3.id)

    const catalog = await getBadgeCatalog(author.id)
    const entry = catalog.find((e) => e.badge.kind === 'FEEDBACK')
    expect(entry?.requirement).toBe('Faça 5 feedbacks')
    expect(entry?.progress).toEqual({ current: 3, target: 5 })
  })

  it('getBadgeCatalog derives a CATEGORY requirement using the category name', async () => {
    const user = await makeUser('User')
    await prisma.recognitionCategory.create({ data: { name: 'Colaboração', slug: 'colaboracao' } })
    await prisma.badge.create({
      data: { slug: 'conector', name: 'Conector', description: 'd', kind: 'CATEGORY', iconKey: 'link', threshold: 4, categorySlug: 'colaboracao' },
    })

    const catalog = await getBadgeCatalog(user.id)
    const entry = catalog.find((e) => e.badge.slug === 'conector')
    expect(entry?.requirement).toBe('Receba 4 feedbacks em Colaboração')
    expect(entry?.progress).toEqual({ current: 0, target: 4 })
  })

  it('getBadgeCatalog falls back to the slug for an orphan category and gives HIGHLIGHT no progress', async () => {
    const user = await makeUser('User')
    await prisma.badge.create({
      data: { slug: 'orfao', name: 'Órfão', description: 'd', kind: 'CATEGORY', iconKey: 'link', threshold: 2, categorySlug: 'inexistente' },
    })
    await prisma.badge.create({
      data: { slug: 'destaque', name: 'Destaque', description: 'd', kind: 'HIGHLIGHT', iconKey: 'trophy', threshold: 0, categorySlug: null },
    })

    const catalog = await getBadgeCatalog(user.id)
    const orphan = catalog.find((e) => e.badge.slug === 'orfao')
    expect(orphan?.requirement).toBe('Receba 2 feedbacks em inexistente')
    const highlight = catalog.find((e) => e.badge.slug === 'destaque')
    expect(highlight?.requirement).toBe('Seja o destaque do mês')
    expect(highlight?.progress).toBeNull()
  })

  it('catálogo mostra requisito e progresso do selo de tempo de casa (valor exato)', async () => {
    const joinedAt = new Date('2000-01-02')
    const user = await prisma.user.create({
      data: { name: 'Casa', email: `casa-${Date.now()}@empresa.com`, passwordHash: 'x', joinedAt },
    })
    await prisma.badge.create({
      data: { slug: 'tempo-de-casa-3-anos', name: '3 anos de casa', description: '3 anos', kind: 'TENURE', iconKey: 'fe-medal-gold', threshold: 3 },
    })

    const catalog = await getBadgeCatalog(user.id)
    const entry = catalog.find((e) => e.badge.slug === 'tempo-de-casa-3-anos')
    expect(entry?.requirement).toBe('Complete 3 anos na equipe')
    expect(entry?.progress?.target).toBe(3)
    expect(entry?.progress?.current).toBe(completedYears(joinedAt, new Date()))
  })

  it('catálogo usa singular "1 ano" para selo de tempo de casa com threshold 1', async () => {
    const user = await prisma.user.create({
      data: { name: 'Iniciante', email: `iniciante-${Date.now()}@empresa.com`, passwordHash: 'x', joinedAt: new Date('2000-01-02') },
    })
    await prisma.badge.create({
      data: { slug: 'tempo-de-casa-1-ano', name: '1 ano de casa', description: '1 ano', kind: 'TENURE', iconKey: 'fe-medal-bronze', threshold: 1 },
    })

    const catalog = await getBadgeCatalog(user.id)
    const entry = catalog.find((e) => e.badge.slug === 'tempo-de-casa-1-ano')
    expect(entry?.requirement).toBe('Complete 1 ano na equipe')
  })
})

describe('completedYears', () => {
  it('conta 0 antes do primeiro aniversário', () => {
    expect(completedYears(new Date('2025-06-18'), new Date('2026-06-17'))).toBe(0)
  })
  it('conta 1 no dia exato do aniversário', () => {
    expect(completedYears(new Date('2025-06-18'), new Date('2026-06-18'))).toBe(1)
  })
  it('conta 3 anos completos', () => {
    expect(completedYears(new Date('2023-01-10'), new Date('2026-06-18'))).toBe(3)
  })
  it('não conta o ano quando ainda falta o mês', () => {
    expect(completedYears(new Date('2024-12-31'), new Date('2026-06-18'))).toBe(1)
  })
  it('29/fev só vira aniversário em 01/mar de ano não-bissexto', () => {
    expect(completedYears(new Date('2024-02-29'), new Date('2026-02-28'))).toBe(1)
    expect(completedYears(new Date('2024-02-29'), new Date('2026-03-01'))).toBe(2)
  })
  it('nunca retorna negativo', () => {
    expect(completedYears(new Date('2030-01-01'), new Date('2026-06-18'))).toBe(0)
  })
})

async function makeTenureBadge(years: number) {
  return prisma.badge.create({
    data: {
      slug: `tempo-de-casa-${years}`,
      name: `${years} ano(s) de casa`,
      description: `${years} anos de equipe`,
      kind: 'TENURE',
      iconKey: 'fe-medal-bronze',
      threshold: years,
    },
  })
}

describe('evaluateTenureBadgesForUser', () => {
  it('concede todos os níveis já atingidos, acumulando', async () => {
    const user = await prisma.user.create({
      data: { name: 'Tempo', email: `tempo-${Date.now()}@empresa.com`, passwordHash: 'x', joinedAt: new Date('2023-01-01') },
    })
    await makeTenureBadge(1)
    await makeTenureBadge(2)
    await makeTenureBadge(3)
    await makeTenureBadge(4)

    const awarded = await evaluateTenureBadgesForUser(user.id, new Date('2026-06-18'))
    expect(awarded).toHaveLength(3) // 1, 2 e 3 anos; ainda não 4
  })

  it('não concede quando ainda não completou 1 ano', async () => {
    const user = await prisma.user.create({
      data: { name: 'Novato', email: `novato-${Date.now()}@empresa.com`, passwordHash: 'x', joinedAt: new Date('2026-01-01') },
    })
    await makeTenureBadge(1)
    expect(await evaluateTenureBadgesForUser(user.id, new Date('2026-06-18'))).toHaveLength(0)
  })

  it('é idempotente: não concede o mesmo selo duas vezes', async () => {
    const user = await prisma.user.create({
      data: { name: 'Veterano', email: `vet-${Date.now()}@empresa.com`, passwordHash: 'x', joinedAt: new Date('2024-01-01') },
    })
    await makeTenureBadge(1)
    expect(await evaluateTenureBadgesForUser(user.id, new Date('2026-06-18'))).toHaveLength(1)
    expect(await evaluateTenureBadgesForUser(user.id, new Date('2026-06-18'))).toHaveLength(0)
  })
})

describe('evaluateTenureBadgesForAllUsers', () => {
  it('concede selos de tempo de casa a todos os usuários ativos elegíveis, sem visitar perfis', async () => {
    const vet = await prisma.user.create({
      data: { name: 'Vet', email: `vet-all-${Date.now()}@empresa.com`, passwordHash: 'x', joinedAt: new Date('2024-01-01') },
    })
    const novato = await prisma.user.create({
      data: { name: 'Novato', email: `nov-all-${Date.now()}@empresa.com`, passwordHash: 'x', joinedAt: new Date('2026-01-01') },
    })
    await makeTenureBadge(1)

    const awarded = await evaluateTenureBadgesForAllUsers(DEFAULT_COMPANY_ID, new Date('2026-06-18'))
    expect(awarded).toBe(1)

    const vetBadges = await listBadgesForUser(vet.id)
    expect(vetBadges.map((b) => b.badge.kind)).toContain('TENURE')
    expect(await listBadgesForUser(novato.id)).toHaveLength(0)
  })

  it('é idempotente: não reconcede em chamadas repetidas', async () => {
    await prisma.user.create({
      data: { name: 'Vet2', email: `vet2-all-${Date.now()}@empresa.com`, passwordHash: 'x', joinedAt: new Date('2024-01-01') },
    })
    await makeTenureBadge(1)
    expect(await evaluateTenureBadgesForAllUsers(DEFAULT_COMPANY_ID, new Date('2026-06-18'))).toBe(1)
    expect(await evaluateTenureBadgesForAllUsers(DEFAULT_COMPANY_ID, new Date('2026-06-18'))).toBe(0)
  })

  it('ignora usuários inativos', async () => {
    await prisma.user.create({
      data: { name: 'Inativo', email: `inativo-all-${Date.now()}@empresa.com`, passwordHash: 'x', joinedAt: new Date('2024-01-01'), active: false },
    })
    await makeTenureBadge(1)
    expect(await evaluateTenureBadgesForAllUsers(DEFAULT_COMPANY_ID, new Date('2026-06-18'))).toBe(0)
  })
})

describe('badge-service escopado por empresa', () => {
  it('selo global de outra empresa não é concedido pra usuário desta empresa', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Badge Eval', slug: 'outra-empresa-badge-eval-test' } })
    await prisma.badge.create({
      data: { name: 'Selo Outra Empresa', description: 'd', slug: 'selo-outra-empresa-eval-test', kind: 'IMPACT', iconKey: 'star', threshold: 1, global: true, companyId: otherCompany.id },
    })
    const user = await prisma.user.create({ data: { name: 'Dev Empresa Padrão', email: 'dev-empresa-padrao-badge-eval@x.com', passwordHash: 'x', role: 'LEGEND' } })
    await prisma.vote.create({
      data: {
        voterId: (await prisma.user.create({ data: { name: 'Voter', email: 'voter-badge-eval@x.com', passwordHash: 'x' } })).id,
        votedId: user.id,
        periodId: (await prisma.votingPeriod.create({ data: { monthRef: '2026-06', startsAt: new Date('2026-06-01'), endsAt: new Date('2026-06-30') } })).id,
        justification: 'justificativa válida',
      },
    })

    const awarded = await evaluateBadgesForUser(user.id)
    const otherBadgeId = (await prisma.badge.findFirstOrThrow({ where: { slug: 'selo-outra-empresa-eval-test' } })).id
    expect(awarded.some((a) => a.badgeId === otherBadgeId)).toBe(false)
  })

  it('getBadgeCatalog não inclui selo global de outra empresa', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Catalog', slug: 'outra-empresa-catalog-test' } })
    const otherBadge = await prisma.badge.create({
      data: { name: 'Selo Catálogo Outra Empresa', description: 'd', slug: 'selo-catalogo-outra-empresa-test', kind: 'IMPACT', iconKey: 'star', threshold: 1, global: true, companyId: otherCompany.id },
    })
    const user = await prisma.user.create({ data: { name: 'Dev Catalogo', email: 'dev-catalogo-badge@x.com', passwordHash: 'x', role: 'LEGEND' } })

    const catalog = await getBadgeCatalog(user.id)
    expect(catalog.some((entry) => entry.badge.id === otherBadge.id)).toBe(false)
  })

  it('grantBadgeManually rejeita selo de outra empresa (404)', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Grant', slug: 'outra-empresa-grant-test' } })
    const otherBadge = await prisma.badge.create({
      data: { name: 'Selo Grant Outra Empresa', description: 'd', slug: 'selo-grant-outra-empresa-test', kind: 'IMPACT', iconKey: 'star', threshold: 1, global: false, companyId: otherCompany.id },
    })
    const user = await prisma.user.create({ data: { name: 'Dev Grant', email: 'dev-grant-badge@x.com', passwordHash: 'x', role: 'LEGEND' } })
    const admin = await prisma.user.create({ data: { name: 'Admin Grant', email: 'admin-grant-badge@x.com', passwordHash: 'x', role: 'ADMIN' } })

    await expect(grantBadgeManually(user.id, otherBadge.id, admin.id)).rejects.toMatchObject({ status: 404 })
  })

  it('countFeedbacksAuthored não conta feedback com companyId de outra empresa (defesa em profundidade)', async () => {
    const author = await makeUser('AutorContagemEmpresa')
    const target = await makeUser('AlvoContagemEmpresa')
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Badge Feedback', slug: 'outra-empresa-badge-feedback-test' } })
    await makeFeedbackBadge(1, 'feedbacker-empresa-test')
    // Linha com companyId divergente do próprio autor — inatingível via createFeedback, mas o
    // filtro de contagem precisa estar lá mesmo assim.
    await prisma.feedback.create({
      data: { authorId: author.id, targetId: target.id, message: 'feedback suficientemente longo para a contagem', category: 'POSITIVO', companyId: otherCompany.id },
    })
    const res = await syncFeedbackBadgesForUser(author.id)
    expect(res.awarded).toHaveLength(0)
  })
})

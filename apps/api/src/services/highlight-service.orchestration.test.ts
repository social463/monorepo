import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'

// Mocka as fronteiras caras: Gemini, render e gravação de arquivo.
vi.mock('../lib/gemini-client', () => ({
  buildCongratsText: vi.fn(async () => 'Parabéns, Ana, pelo destaque!'),
}))
vi.mock('../lib/card-renderer', () => ({
  renderCard: vi.fn(async () => Buffer.from('89504e470d0a1a0a', 'hex')),
}))
vi.mock('../lib/highlight-storage', () => ({
  saveCardPng: vi.fn(async (companyId: string, monthRef: string) => `https://cdn.test/highlights/${companyId}/${monthRef}.png`),
  highlightStorageEnabled: vi.fn(() => true),
}))

import { buildCongratsText } from '../lib/gemini-client'
import { highlightStorageEnabled } from '../lib/highlight-storage'
import {
  generateHighlightDraft,
  updateHighlightText,
  generateHighlightImage,
  publishHighlight,
  listPublishedHighlights,
  HighlightError,
} from './highlight-service'

async function seed() {
  const category = await prisma.recognitionCategory.create({ data: { name: 'Colaboração', slug: 'colaboracao' } })
  const ana = await prisma.user.create({ data: { name: 'Ana', email: 'ana@empresa.com', passwordHash: 'x' } })
  const period = await prisma.votingPeriod.create({
    data: { monthRef: '2026-06', startsAt: new Date('2026-06-01'), endsAt: new Date('2026-06-30'), status: 'CLOSED' },
  })
  const v1 = await prisma.user.create({ data: { name: 'V1', email: 'v1@e.com', passwordHash: 'x' } })
  await prisma.vote.create({
    data: { voterId: v1.id, votedId: ana.id, periodId: period.id, justification: 'ótimo trabalho', categories: { create: [{ categoryId: category.id }] } },
  })
  await prisma.badge.create({
    data: { slug: 'destaque-do-mes', name: 'Destaque do Mês', description: 'x', kind: 'HIGHLIGHT', iconKey: 'trophy', threshold: 0 },
  })
  const actor = await prisma.user.create({ data: { name: 'Actor', email: `actor-${Date.now()}-${Math.random()}@e.com`, passwordHash: 'x', role: 'ADMIN' } })
  return { period, ana, actor }
}

beforeEach(() => vi.clearAllMocks())

describe('generateHighlightDraft', () => {
  it('elects the winner, generates text and stores a DRAFT without image', async () => {
    const { period, ana, actor } = await seed()
    const result = await generateHighlightDraft(period.id, actor.id, DEFAULT_COMPANY_ID)
    expect(result.highlightStatus).toBe('DRAFT')
    expect(result.winnerId).toBe(ana.id)
    expect(result.winnerVotes).toBe(1)
    expect(result.highlightText).toBe('Parabéns, Ana, pelo destaque!')
    expect(result.highlightImagePath).toBeNull()
    expect(buildCongratsText).toHaveBeenCalledOnce()
  })

  it('refuses to generate twice (no extra Gemini call)', async () => {
    const { period, actor } = await seed()
    await generateHighlightDraft(period.id, actor.id, DEFAULT_COMPANY_ID)
    await expect(generateHighlightDraft(period.id, actor.id, DEFAULT_COMPANY_ID)).rejects.toBeInstanceOf(HighlightError)
    expect(buildCongratsText).toHaveBeenCalledOnce()
  })

  it('refuses when there are no votes', async () => {
    const category = await prisma.recognitionCategory.create({ data: { name: 'C', slug: 'c' } })
    void category
    const period = await prisma.votingPeriod.create({
      data: { monthRef: '2026-07', startsAt: new Date('2026-07-01'), endsAt: new Date('2026-07-31'), status: 'CLOSED' },
    })
    const actor = await prisma.user.create({ data: { name: 'Actor2', email: `actor2-${Date.now()}-${Math.random()}@e.com`, passwordHash: 'x', role: 'ADMIN' } })
    await expect(generateHighlightDraft(period.id, actor.id, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 422 })
  })
})

describe('updateHighlightText', () => {
  it('edits the text without rendering a card or calling Gemini', async () => {
    const { period, actor } = await seed()
    await generateHighlightDraft(period.id, actor.id, DEFAULT_COMPANY_ID)
    vi.clearAllMocks()
    const updated = await updateHighlightText(period.id, 'Texto editado pelo admin', actor.id, DEFAULT_COMPANY_ID)
    expect(updated.highlightText).toBe('Texto editado pelo admin')
    expect(updated.highlightImagePath).toBeNull()
    expect(buildCongratsText).not.toHaveBeenCalled()
  })

  it('edits the referenced highlight month without rendering the image', async () => {
    const { period, actor } = await seed()
    await generateHighlightDraft(period.id, actor.id, DEFAULT_COMPANY_ID)
    const updated = await updateHighlightText(period.id, 'Texto editado pelo admin', actor.id, DEFAULT_COMPANY_ID, '2026-05')
    expect(updated.highlightMonthRef).toBe('2026-05')
    expect(updated.highlightImagePath).toBeNull()
  })

  it('refuses to edit when not in DRAFT', async () => {
    const { period, actor } = await seed()
    await expect(updateHighlightText(period.id, 'x', actor.id, DEFAULT_COMPANY_ID)).rejects.toBeInstanceOf(HighlightError)
  })
})

describe('generateHighlightImage', () => {
  it('renders and stores the image while keeping the highlight in DRAFT', async () => {
    const { period, actor } = await seed()
    await generateHighlightDraft(period.id, actor.id, DEFAULT_COMPANY_ID)
    const updated = await generateHighlightImage(period.id, actor.id, DEFAULT_COMPANY_ID)
    expect(updated.highlightStatus).toBe('DRAFT')
    expect(updated.highlightImagePath).toBe('https://cdn.test/highlights/company-emr/2026-06.png')
  })

  it('refuses to render when the highlight draft does not exist', async () => {
    const { period, actor } = await seed()
    await expect(generateHighlightImage(period.id, actor.id, DEFAULT_COMPANY_ID)).rejects.toBeInstanceOf(HighlightError)
  })

  it('refuses with 503 when S3 storage is not configured', async () => {
    const { period, actor } = await seed()
    await generateHighlightDraft(period.id, actor.id, DEFAULT_COMPANY_ID)
    vi.mocked(highlightStorageEnabled).mockReturnValueOnce(false)
    await expect(generateHighlightImage(period.id, actor.id, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 503 })
  })
})

describe('publishHighlight', () => {
  it('publishes and awards the HIGHLIGHT badge to the winner', async () => {
    const { period, ana, actor } = await seed()
    await generateHighlightDraft(period.id, actor.id, DEFAULT_COMPANY_ID)
    await generateHighlightImage(period.id, actor.id, DEFAULT_COMPANY_ID)
    const published = await publishHighlight(period.id, actor.id, DEFAULT_COMPANY_ID)
    expect(published.highlightStatus).toBe('PUBLISHED')

    const awarded = await prisma.userBadge.findFirst({
      where: { userId: ana.id, periodId: period.id, badge: { slug: 'destaque-do-mes' } },
    })
    expect(awarded).not.toBeNull()

    const list = await listPublishedHighlights(period.companyId, period.sectorId)
    expect(list).toHaveLength(1)
    expect(list[0].winner?.id).toBe(ana.id)
  })

  it('premia o selo de destaque DESTA empresa, e não o homônimo de outra', async () => {
    const { period, ana, actor } = await seed()
    const outra = await prisma.company.create({ data: { name: 'Outra Empresa Destaque', slug: 'outra-empresa-destaque-test' } })
    // Mesmo slug em duas empresas — impossível até a migration
    // `20260820160000_selo_unico_por_empresa`, quando o índice de slug era do
    // banco inteiro: a segunda empresa simplesmente não tinha como ter o selo, e
    // publicar o destaque dela morria em 500 "Selo não encontrado (rode o seed)".
    const seloDaOutra = await prisma.badge.create({
      data: { slug: 'destaque-do-mes', name: 'Destaque do Mês', description: 'x', kind: 'HIGHLIGHT', iconKey: 'trophy', threshold: 0, companyId: outra.id },
    })
    await generateHighlightDraft(period.id, actor.id, DEFAULT_COMPANY_ID)
    await generateHighlightImage(period.id, actor.id, DEFAULT_COMPANY_ID)
    await publishHighlight(period.id, actor.id, DEFAULT_COMPANY_ID)

    const awarded = await prisma.userBadge.findFirstOrThrow({ where: { userId: ana.id, periodId: period.id } })
    const daEmpresa = await prisma.badge.findFirstOrThrow({
      where: { slug: 'destaque-do-mes', companyId: DEFAULT_COMPANY_ID },
    })
    expect(awarded.badgeId).toBe(daEmpresa.id)
    expect(awarded.badgeId).not.toBe(seloDaOutra.id)
  })

  /**
   * Rede de segurança da publicação: voto **anterior** à mudança que fez o
   * feedback nascer junto com o voto (aqui simulado inserindo a linha direto no
   * banco, sem passar por `createVote`) é materializado agora, e só então rende
   * selo.
   */
  it('materializa na publicação o voto que ficou sem feedback, e aí concede o selo', async () => {
    const { period, ana, actor } = await seed()
    const impacto = await prisma.badge.create({
      data: { slug: 'reconhecido-publish', name: 'Reconhecido', description: '1 feedback', kind: 'IMPACT', iconKey: 'star', threshold: 1 },
    })

    await generateHighlightDraft(period.id, actor.id, DEFAULT_COMPANY_ID)
    await generateHighlightImage(period.id, actor.id, DEFAULT_COMPANY_ID)
    expect(await prisma.userBadge.findFirst({ where: { userId: ana.id, badgeId: impacto.id } })).toBeNull()
    expect(await prisma.notification.count({ where: { userId: ana.id } })).toBe(0)

    await publishHighlight(period.id, actor.id, DEFAULT_COMPANY_ID)

    expect(await prisma.feedback.count({ where: { targetId: ana.id, voteId: { not: null } } })).toBeGreaterThan(0)
    expect(await prisma.userBadge.findFirst({ where: { userId: ana.id, badgeId: impacto.id } })).not.toBeNull()
    const notifications = await prisma.notification.findMany({ where: { userId: ana.id } })
    expect(notifications.map((n) => n.type).sort()).toEqual(['BADGE_EARNED', 'HIGHLIGHT_PUBLISHED'])
    // O aviso da publicação é sobre o Destaque do Mês, não sobre "seus
    // reconhecimentos" — esses já chegaram quando alguém votou.
    const publicado = notifications.find((n) => n.type === 'HIGHLIGHT_PUBLISHED')
    expect(publicado?.link).toBe('/destaques')
    expect(publicado?.title).toMatch(/Destaque de/)
  })

  it('refuses to publish a period that is not in DRAFT', async () => {
    const { period, actor } = await seed()
    await expect(publishHighlight(period.id, actor.id, DEFAULT_COMPANY_ID)).rejects.toBeInstanceOf(HighlightError)
  })

  it('refuses to publish a DRAFT without an image', async () => {
    const { period, actor } = await seed()
    await generateHighlightDraft(period.id, actor.id, DEFAULT_COMPANY_ID)
    await expect(publishHighlight(period.id, actor.id, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 409 })
  })

  it('audita generateHighlightDraft/updateHighlightText/publishHighlight', async () => {
    const { period } = await seed()
    const admin = await prisma.user.create({ data: { name: 'AuditAdmin', email: 'auditadmin-hl@empresa.com', passwordHash: 'x', role: 'ADMIN' } })
    await generateHighlightDraft(period.id, admin.id, DEFAULT_COMPANY_ID)
    await updateHighlightText(period.id, 'Texto editado', admin.id, DEFAULT_COMPANY_ID)
    await generateHighlightImage(period.id, admin.id, DEFAULT_COMPANY_ID)
    await publishHighlight(period.id, admin.id, DEFAULT_COMPANY_ID)

    const rows = await prisma.adminAuditLog.findMany({ where: { entityType: 'VotingPeriod', entityId: period.id }, orderBy: { createdAt: 'asc' } })
    expect(rows.map((r) => r.action)).toEqual(['UPDATE', 'UPDATE', 'UPDATE', 'UPDATE'])
  })
})

describe('highlight-service — escopo por empresa', () => {
  it('generateHighlightDraft/updateHighlightText/generateHighlightImage/publishHighlight rejeitam período de outra empresa', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Highlight Scope', slug: 'outra-empresa-highlight-scope-test' } })
    const otherSector = await prisma.sector.create({ data: { name: 'Setor Outra Empresa Highlight Scope', slug: 'setor-outra-empresa-highlight-scope-test', companyId: otherCompany.id } })
    const category = await prisma.recognitionCategory.create({ data: { name: 'Cat Highlight Scope', slug: 'cat-highlight-scope-test' } })
    const ana = await prisma.user.create({ data: { name: 'Ana Outra', email: 'ana-outra-highlight-scope@x.com', passwordHash: 'x', companyId: otherCompany.id, sectorId: otherSector.id } })
    const voter = await prisma.user.create({ data: { name: 'Voter Outra', email: 'voter-outra-highlight-scope@x.com', passwordHash: 'x', companyId: otherCompany.id, sectorId: otherSector.id } })
    const period = await prisma.votingPeriod.create({
      data: { monthRef: '2026-06', startsAt: new Date('2026-06-01'), endsAt: new Date('2026-06-30'), status: 'CLOSED', companyId: otherCompany.id, sectorId: otherSector.id },
    })
    await prisma.vote.create({
      data: { voterId: voter.id, votedId: ana.id, periodId: period.id, justification: 'ótimo trabalho', companyId: otherCompany.id, categories: { create: [{ categoryId: category.id }] } },
    })
    await prisma.badge.create({ data: { slug: 'destaque-do-mes', name: 'Destaque do Mês', description: 'x', kind: 'HIGHLIGHT', iconKey: 'trophy', threshold: 0 } })
    const actor = await prisma.user.create({ data: { name: 'Actor Default', email: `actor-default-highlight-scope-${Date.now()}@e.com`, passwordHash: 'x', role: 'ADMIN' } })

    await expect(generateHighlightDraft(period.id, actor.id, DEFAULT_COMPANY_ID)).rejects.toBeInstanceOf(HighlightError)
  })
})

import { describe, it, expect } from 'vitest'
import type { User } from '@prisma/client'
import { defaultCharacterFromSeed } from '@legends/shared'
import {
  sanitizeAvatarOptions,
  toAdminUser,
  toBadgeDTO,
  toCoinRuleDTO,
  toCoinTransactionDTO,
  toMuralBadgeItem,
  toOfficeMeetingDTO,
  toPublicUser,
  toReviewCommentDTO,
  toReviewDTO,
  toVacationDTO,
  toVoteDTO,
} from './serialize'
import type { ReviewCommentWithRelations, ReviewWithRelations } from '../services/review-service'

// Fixture v2 canônica (catálogo real) — reusada nos testes de migração.
const CHARACTER_V2 = {
  bodyType: 'male' as const,
  items: {
    body: { item: 'body', variant: 'light' },
    head: { item: 'heads_human_male', variant: 'light' },
    clothes: { item: 'torso_clothes_shortsleeve', variant: 'navy' },
    legs: { item: 'legs_pants', variant: 'black' },
    shoes: { item: 'feet_shoes', variant: 'brown' },
  },
}

// Fixture v1 (shape da curadoria antiga, persistida no banco antes da migração para o catálogo LPC).
const CHARACTER_V1 = {
  bodyType: 'male' as const,
  skinTone: 'olive',
  hair: { style: 'buzzcut', color: 'black' },
  beard: null,
  torso: { item: 'shortsleeve', color: 'blue' },
  legs: { item: 'pants', color: 'black' },
  feet: { item: 'boots', color: 'brown' },
  glasses: null,
  hat: null,
}

describe('sanitizeAvatarOptions', () => {
  it('mantém v2 válido intacto (sanitizado)', () => {
    expect(sanitizeAvatarOptions(CHARACTER_V2)).toEqual(CHARACTER_V2)
  })

  it('migra shape v1 legado para v2, com items.body.variant = skinTone', () => {
    const migrated = sanitizeAvatarOptions(CHARACTER_V1)
    expect(migrated).not.toBeNull()
    expect(migrated?.bodyType).toBe('male')
    expect(migrated?.items.body).toEqual({ item: 'body', variant: 'olive' })
  })

  it('descarta lixo (ex. avatar DiceBear legado) para null', () => {
    expect(sanitizeAvatarOptions({ dicebear: 'legacy' })).toBeNull()
  })
})

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'u1',
    name: 'Fulano',
    email: 'fulano@empresa.com',
    passwordHash: 'x',
    role: 'LEGEND',
    area: null,
    position: null,
    squad: null,
    photoUrl: null,
    avatarStyle: null,
    avatarSeed: null,
    avatarOptions: null,
    teamsWebhookUrl: null,
    active: true,
    leftAt: null,
    joinedAt: new Date('2023-01-01T00:00:00.000Z'),
    ...overrides,
  } as User
}

describe('toPublicUser', () => {
  it('expõe e-mail e leftAt=null para lenda ativa', () => {
    const dto = toPublicUser(makeUser())
    expect(dto.email).toBe('fulano@empresa.com')
    expect(dto.leftAt).toBeNull()
  })

  it('oculta o e-mail e expõe leftAt (ISO) para ex-lenda', () => {
    const dto = toPublicUser(makeUser({ active: false, leftAt: new Date('2026-07-10T00:00:00.000Z') }))
    expect(dto.email).toBeNull()
    expect(dto.leftAt).toBe('2026-07-10T00:00:00.000Z')
  })

  it('sanitiza avatarStyle/avatarOptions legados (open-peeps) para null', () => {
    const dto = toPublicUser(
      makeUser({
        avatarStyle: 'open-peeps',
        avatarOptions: { top: 'shortHair', accessories: 'kurt' },
      }),
    )
    expect(dto.avatarStyle).toBeNull()
    expect(dto.avatarOptions).toBeNull()
  })

  it('mantém avatarStyle lpc e avatarOptions válidos intactos', () => {
    const options = defaultCharacterFromSeed('fulano')
    // Json? no Prisma volta como valor já desserializado — simula o round-trip.
    const dto = toPublicUser(makeUser({ avatarStyle: 'lpc', avatarOptions: JSON.parse(JSON.stringify(options)) }))
    expect(dto.avatarStyle).toBe('lpc')
    expect(dto.avatarOptions).toEqual(options)
  })

  it('inclui enabledFeatures do usuário (vazio quando não setado)', () => {
    const base = makeUser({ enabledFeatures: [] })
    expect(toPublicUser(base).enabledFeatures).toEqual([])

    const thirdParty = makeUser({ role: 'THIRD_PARTY', enabledFeatures: ['escritorio', 'time'] as any })
    expect(toPublicUser(thirdParty).enabledFeatures).toEqual(['escritorio', 'time'])
  })
})

describe('toAdminUser', () => {
  it('mantém o e-mail real mesmo para ex-lenda', () => {
    const dto = toAdminUser(makeUser({ active: false, leftAt: new Date('2026-07-10T00:00:00.000Z') }))
    expect(dto.email).toBe('fulano@empresa.com')
    expect(dto.leftAt).toBe('2026-07-10T00:00:00.000Z')
  })
})

describe('toMuralBadgeItem', () => {
  it('mapeia um UserBadge para item de mural', () => {
    const item = toMuralBadgeItem({
      id: 'ub1',
      awardedAt: new Date('2026-06-10T12:00:00Z'),
      user: {
        id: 'u1', name: 'Ana', email: 'a@x.com', role: 'LEGEND', position: null, squad: null,
        photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null,
        active: true, joinedAt: new Date('2026-01-01T00:00:00Z'),
      },
      badge: { slug: 's', name: 'Selo', description: 'desc', iconKey: 'k', kind: 'IMPACT' },
    } as never)
    expect(item.type).toBe('badge')
    expect(item.id).toBe('ub1')
    expect(item.timestamp).toBe('2026-06-10T12:00:00.000Z')
    expect(item.user.name).toBe('Ana')
    expect(item.badge.name).toBe('Selo')
  })
})

// Factory mínima para ReviewWithRelations de testes (sem bater no banco)
function makeReview(overrides: Partial<ReviewWithRelations> = {}): ReviewWithRelations {
  return {
    id: 'r1',
    authorId: 'u1',
    content: 'texto',
    createdAt: new Date('2026-06-10T12:00:00Z'),
    updatedAt: new Date('2026-06-10T12:00:00Z'),
    gifUrl: null,
    gifWidth: null,
    gifHeight: null,
    author: {
      id: 'u1', name: 'Ana', email: 'a@x.com', role: 'LEGEND', position: null, squad: null,
      photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null,
      active: true, joinedAt: new Date('2026-01-01T00:00:00Z'),
      passwordHash: 'x', teamsWebhookUrl: null, area: null,
    },
    reactions: [],
    mentions: [],
    _count: { comments: 0, shares: 0 },
    ...overrides,
  } as unknown as ReviewWithRelations
}

function makeComment(overrides: Partial<ReviewCommentWithRelations> = {}): ReviewCommentWithRelations {
  return {
    id: 'c1',
    reviewId: 'r1',
    authorId: 'u1',
    content: 'comentário',
    createdAt: new Date('2026-06-10T12:00:00Z'),
    updatedAt: new Date('2026-06-10T12:00:00Z'),
    gifUrl: null,
    gifWidth: null,
    gifHeight: null,
    author: {
      id: 'u1', name: 'Ana', email: 'a@x.com', role: 'LEGEND', position: null, squad: null,
      photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null,
      active: true, joinedAt: new Date('2026-01-01T00:00:00Z'),
      passwordHash: 'x', teamsWebhookUrl: null, area: null,
    },
    reactions: [],
    mentions: [],
    ...overrides,
  } as unknown as ReviewCommentWithRelations
}

describe('toReviewDTO — gif', () => {
  it('inclui gif quando gifUrl está presente', () => {
    const review = makeReview({ gifUrl: 'https://media.giphy.com/g.gif', gifWidth: 200, gifHeight: 150 })
    const dto = toReviewDTO(review, 'u1', false)
    expect(dto.gif).toEqual({ url: 'https://media.giphy.com/g.gif', width: 200, height: 150 })
  })

  it('retorna gif: null quando gifUrl é null', () => {
    const dto = toReviewDTO(makeReview(), 'u1', false)
    expect(dto.gif).toBeNull()
  })
})

describe('toReviewDTO — enquete', () => {
  const poll = {
    id: 'p1',
    reviewId: 'r1',
    question: 'Qual opção?',
    createdAt: new Date(),
    companyId: 'company-emr',
    sectorId: 'sector-dev-produto',
    options: [
      { id: 'o1', pollId: 'p1', text: 'A', position: 0, companyId: 'company-emr', sectorId: 'sector-dev-produto', _count: { votes: 2 } },
      { id: 'o2', pollId: 'p1', text: 'B', position: 1, companyId: 'company-emr', sectorId: 'sector-dev-produto', _count: { votes: 1 } },
    ],
    votes: [],
  }

  it('oculta contagens e percentuais antes do voto do viewer', () => {
    const dto = toReviewDTO(makeReview({ poll: poll as never }), 'u1', false)
    expect(dto.poll).toMatchObject({ hasVoted: false, selectedOptionId: null, totalVotes: null })
    expect(dto.poll?.options).toEqual([
      { id: 'o1', text: 'A', voteCount: null, percentage: null },
      { id: 'o2', text: 'B', voteCount: null, percentage: null },
    ])
  })

  it('expõe resultado e escolha somente depois do voto do viewer', () => {
    const dto = toReviewDTO(makeReview({ poll: { ...poll, votes: [{ optionId: 'o1' }] } as never }), 'u1', false)
    expect(dto.poll).toMatchObject({ hasVoted: true, selectedOptionId: 'o1', totalVotes: 3 })
    expect(dto.poll?.options).toEqual([
      { id: 'o1', text: 'A', voteCount: 2, percentage: 67 },
      { id: 'o2', text: 'B', voteCount: 1, percentage: 33 },
    ])
  })
})

describe('toReviewCommentDTO — gif', () => {
  it('inclui gif quando gifUrl está presente', () => {
    const comment = makeComment({ gifUrl: 'https://media.giphy.com/c.gif', gifWidth: 320, gifHeight: 240 })
    const dto = toReviewCommentDTO(comment, 'u1')
    expect(dto.gif).toEqual({ url: 'https://media.giphy.com/c.gif', width: 320, height: 240 })
  })

  it('retorna gif: null quando gifUrl é null', () => {
    const dto = toReviewCommentDTO(makeComment(), 'u1')
    expect(dto.gif).toBeNull()
  })
})

describe('toVoteDTO', () => {
  it('serializa categorias do voto', () => {
    const vote = {
      id: 'v1',
      voter: { id: 'u1', name: 'Ana' },
      voted: { id: 'u2', name: 'Bruno' },
      categories: [{ category: { id: 'c1', name: 'Colaboração', slug: 'colaboracao' } }],
      justification: 'texto',
      createdAt: new Date('2026-06-10T00:00:00Z'),
      periodId: 'p1',
      period: { monthRef: '2026-06' },
    } as unknown as Parameters<typeof toVoteDTO>[0]

    expect(toVoteDTO(vote).categories).toEqual([{ id: 'c1', name: 'Colaboração', slug: 'colaboracao' }])
  })
})

describe('toBadgeDTO', () => {
  it('expõe sectorIds vazio quando a relação não foi incluída', () => {
    const badge = { id: 'b1', slug: 'b', name: 'B', description: 'd', kind: 'IMPACT' as const, iconKey: 'star', threshold: 1, categorySlug: null, badgeCategoryId: null, rewardPoints: null, rewardCoins: null, global: true, companyId: 'company-emr' }
    expect(toBadgeDTO(badge).sectorIds).toEqual([])
  })

  it('expõe sectorIds a partir da relação sectors incluída', () => {
    const badge = {
      id: 'b1', slug: 'b', name: 'B', description: 'd', kind: 'IMPACT' as const, iconKey: 'star', threshold: 1, categorySlug: null,
      badgeCategoryId: null, rewardPoints: null, rewardCoins: null, global: false, companyId: 'company-emr',
      sectors: [{ sectorId: 's1' }],
    }
    expect(toBadgeDTO(badge).sectorIds).toEqual(['s1'])
  })
})

describe('toOfficeMeetingDTO', () => {
  const meeting = {
    id: 'mtg1',
    companyId: 'company-emr',
    roomExternalKey: 'aurora',
    roomName: 'Aurora',
    title: 'Planning',
    agenda: null,
    startsAt: new Date('2026-07-30T17:00:00.000Z'),
    endsAt: new Date('2026-07-30T18:00:00.000Z'),
    organizerId: 'u1',
    canceledAt: null,
    sequence: 0,
    remindedAt: null,
    createdAt: new Date('2026-07-29T10:00:00.000Z'),
    updatedAt: new Date('2026-07-29T10:00:00.000Z'),
    organizer: { id: 'u1', name: 'Ana', email: 'ana@x.com' },
    participants: [{ user: { id: 'u2', name: 'Bruno', email: 'bruno@x.com' } }],
  }

  it('devolve datas ISO, pessoas enxutas e links de calendário prontos', () => {
    const dto = toOfficeMeetingDTO(meeting)
    expect(dto.startsAt).toBe('2026-07-30T17:00:00.000Z')
    expect(dto.canceled).toBe(false)
    expect(dto.organizer).toEqual({ id: 'u1', name: 'Ana' })
    expect(dto.participants).toEqual([{ id: 'u2', name: 'Bruno' }])
    expect(dto.googleCalendarUrl).toContain('calendar.google.com')
    expect(dto.outlookCalendarUrl).toContain('outlook.office.com')
    expect(dto.icsPath).toBe('/office/meetings/mtg1/ics')
  })

  it('marca canceled quando há canceledAt', () => {
    expect(toOfficeMeetingDTO({ ...meeting, canceledAt: new Date() }).canceled).toBe(true)
  })
})

// Um User mínimo é suficiente: toPublicUser já é testado à parte.
function userRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1', email: 'a@x.com', passwordHash: 'x', name: 'Ana', position: null, squad: null,
    photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null,
    officeCharacterName: null, teamsWebhookUrl: null, role: 'LEGEND', sectorId: 's1',
    companyId: 'c1', enabledFeatures: [], area: null, active: true, leftAt: null,
    joinedAt: new Date('2024-01-01T00:00:00.000Z'), birthDate: null,
    createdAt: new Date('2024-01-01T00:00:00.000Z'), updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

describe('toVacationDTO', () => {
  it('devolve as datas civis em YYYY-MM-DD', () => {
    const dto = toVacationDTO({
      id: 'v1',
      userId: 'u1',
      startDate: new Date('2026-08-03T00:00:00.000Z'),
      endDate: new Date('2026-08-14T00:00:00.000Z'),
      note: 'Férias',
      createdById: 'u2',
      companyId: 'c1',
      createdAt: new Date(),
      updatedAt: new Date(),
      user: userRow() as never,
    } as never)

    expect(dto).toMatchObject({ id: 'v1', startDate: '2026-08-03', endDate: '2026-08-14', note: 'Férias' })
    expect(dto.user.id).toBe('u1')
  })
})

describe('serialização de EMR Coins', () => {
  it('toCoinRuleDTO devolve datas em ISO', () => {
    const dto = toCoinRuleDTO({
      id: 'rule1',
      event: 'VOTE_CAST',
      amount: 50,
      capWindow: 'DAY',
      capAmount: 100,
      active: true,
      companyId: 'company-emr',
      createdAt: new Date('2026-07-30T10:00:00.000Z'),
      updatedAt: new Date('2026-07-30T11:00:00.000Z'),
    })
    expect(dto).toMatchObject({ event: 'VOTE_CAST', amount: 50, capWindow: 'DAY', capAmount: 100 })
    expect(dto.createdAt).toBe('2026-07-30T10:00:00.000Z')
  })

  it('toCoinTransactionDTO expõe o dia civil como YYYY-MM-DD e o autor só no ajuste manual', () => {
    const base = {
      id: 'tx1',
      userId: 'u1',
      ruleId: 'rule1',
      dedupeKey: 'VOTE_CAST:v1',
      day: new Date('2026-07-30T00:00:00.000Z'),
      createdAt: new Date('2026-07-30T23:30:00.000Z'),
      companyId: 'company-emr',
    }

    const earned = toCoinTransactionDTO({
      ...base,
      kind: 'EARN',
      event: 'VOTE_CAST',
      amount: 50,
      reason: null,
      actorId: null,
      actor: null,
    })
    expect(earned.day).toBe('2026-07-30')
    expect(earned.actor).toBeNull()

    const manual = toCoinTransactionDTO({
      ...base,
      id: 'tx2',
      kind: 'MANUAL_CREDIT',
      event: null,
      ruleId: null,
      dedupeKey: 'MANUAL:abc',
      amount: 20,
      reason: 'palestra',
      actorId: 'admin1',
      actor: { id: 'admin1', name: 'Ana' },
    })
    expect(manual.actor).toEqual({ id: 'admin1', name: 'Ana' })
    expect(manual.reason).toBe('palestra')
  })
})

import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import { dayFromYmd } from '../lib/sao-paulo-date'
import { evaluateStreakBadgesForUser, getBadgeCatalog } from './badge-service'
import { getStreakSummary } from './streak-service'

async function makeUser(email: string): Promise<string> {
  const app = buildApp()
  await app.ready()
  await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Ana', email, password: 'changeme123' },
  })
  await app.close()
  const user = await prisma.user.findUniqueOrThrow({ where: { email } })
  return user.id
}

async function seedDays(userId: string, ymds: string[]) {
  await prisma.moodEntry.createMany({
    data: ymds.map((ymd) => ({ userId, mood: 'GOOD' as const, day: dayFromYmd(ymd) })),
  })
}

async function makeStreakBadge(slug: string, name: string, threshold: number) {
  return prisma.badge.create({
    data: { slug, name, description: 'x', kind: 'STREAK', iconKey: 'fe-fire', threshold },
  })
}

// 7 dias úteis consecutivos (ponte de fim de semana): 06-01..06-05 + 06-08, 06-09.
const SEVEN_BIZ = ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05', '2026-06-08', '2026-06-09']

describe('selos de ofensiva', () => {
  it('concede só os níveis cujo threshold <= bestStreak', async () => {
    const userId = await makeUser('a@empresa.com')
    await seedDays(userId, SEVEN_BIZ) // bestStreak = 7
    const b7 = await makeStreakBadge('ofensiva-7-dias-uteis', 'Em chamas', 7)
    await makeStreakBadge('ofensiva-14-dias-uteis', 'Imparável', 14)
    const awarded = await evaluateStreakBadgesForUser(userId)
    expect(awarded).toHaveLength(1)
    expect(awarded[0].badgeId).toBe(b7.id)
    const owned = await prisma.userBadge.findMany({ where: { userId } })
    expect(owned).toHaveLength(1)
    expect(owned[0].badgeId).toBe(b7.id)
  })

  it('é idempotente e não revoga ao rodar de novo', async () => {
    const userId = await makeUser('b@empresa.com')
    await seedDays(userId, SEVEN_BIZ)
    await makeStreakBadge('ofensiva-7-dias-uteis', 'Em chamas', 7)
    await evaluateStreakBadgesForUser(userId)
    const second = await evaluateStreakBadgesForUser(userId)
    expect(second).toHaveLength(0)
    expect(await prisma.userBadge.count({ where: { userId } })).toBe(1)
  })

  it('concede pelo recorde mesmo com a sequência atual zerada (não revoga após quebra)', async () => {
    const userId = await makeUser('d@empresa.com')
    await seedDays(userId, SEVEN_BIZ) // recorde 7, mas tudo no passado
    await makeStreakBadge('ofensiva-7-dias-uteis', 'Em chamas', 7)
    // "hoje" bem depois do último boost → a sequência atual já quebrou (0).
    const FUTURE = '2026-09-01' // terça-feira, longe dos dias semeados
    const summary = await getStreakSummary(userId, DEFAULT_COMPANY_ID, FUTURE)
    expect(summary.currentStreak).toBe(0)
    expect(summary.bestStreak).toBe(7)
    const awarded = await evaluateStreakBadgesForUser(userId, FUTURE)
    expect(awarded).toHaveLength(1)
    expect(await prisma.userBadge.count({ where: { userId } })).toBe(1)
  })

  it('catálogo traz requisito e progresso do selo de ofensiva', async () => {
    const userId = await makeUser('c@empresa.com')
    await seedDays(userId, SEVEN_BIZ) // bestStreak = 7
    await makeStreakBadge('ofensiva-14-dias-uteis', 'Imparável', 14)
    const catalog = await getBadgeCatalog(userId)
    const entry = catalog.find((e) => e.badge.slug === 'ofensiva-14-dias-uteis')
    expect(entry?.requirement).toBe('Mantenha uma ofensiva de 14 dias úteis')
    expect(entry?.progress).toEqual({ current: 7, target: 14 })
  })
})

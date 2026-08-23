import { describe, it, expect } from 'vitest'
import { prisma } from '../lib/prisma'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { MoodAlreadyAnsweredError, getTodayMood, setTodayMood, todayInSaoPaulo } from './mood-service'

async function makeUser(email: string) {
  return prisma.user.create({ data: { name: email, email, passwordHash: 'x' } })
}

describe('mood-service', () => {
  // Vale a PRIMEIRA resposta do dia: se desse para regravar, o painel de clima
  // mediria o humor que a pessoa achou apresentável depois de pensar.
  it('setTodayMood grava a primeira resposta e recusa a segunda do mesmo dia', async () => {
    const user = await makeUser('mood-svc-a@x.com')
    const created = await setTodayMood(user.id, DEFAULT_COMPANY_ID, 'GOOD', 'dia bom')
    expect(created.mood).toBe('GOOD')
    expect(created.note).toBe('dia bom')

    await expect(
      setTodayMood(user.id, DEFAULT_COMPANY_ID, 'LOW', 'mudei de ideia', 'WORKLOAD'),
    ).rejects.toBeInstanceOf(MoodAlreadyAnsweredError)

    // A primeira resposta continua intacta, e não virou uma segunda linha.
    const stored = await prisma.moodEntry.findFirstOrThrow({ where: { userId: user.id } })
    expect(stored).toMatchObject({ mood: 'GOOD', note: 'dia bom' })
    expect(await prisma.moodEntry.count({ where: { userId: user.id } })).toBe(1)
  })

  // O motivo é do mal-estar: guardá-lo num "Ótimo" deixaria a categoria órfã e
  // contaminaria o ranking de motivos do painel de clima.
  it('humor positivo descarta o motivo enviado junto', async () => {
    const user = await makeUser('mood-svc-reason@x.com')
    const positivo = await setTodayMood(user.id, DEFAULT_COMPANY_ID, 'GREAT', null, 'WORKLOAD')
    expect(positivo.reason).toBeNull()

    const stored = await prisma.moodEntry.findFirstOrThrow({ where: { userId: user.id } })
    expect(stored.reason).toBeNull()
  })

  it('getTodayMood não retorna entrada com companyId divergente do próprio usuário (defesa em profundidade)', async () => {
    const user = await makeUser('mood-svc-b@x.com')
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Mood Svc', slug: 'outra-empresa-mood-svc-test' } })
    const { day } = todayInSaoPaulo()
    await prisma.moodEntry.create({ data: { userId: user.id, day, mood: 'GOOD', note: null, companyId: otherCompany.id } })

    const result = await getTodayMood(user.id, DEFAULT_COMPANY_ID)
    expect(result).toBeNull()
  })
})

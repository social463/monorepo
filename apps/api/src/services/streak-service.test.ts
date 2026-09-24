import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import { dayFromYmd } from '../lib/sao-paulo-date'
import { getStreakSummary, getStreakCalendar } from './streak-service'

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

async function seedHoliday(ymd: string, title: string, createdById: string) {
  const type = await prisma.calendarEventType.upsert({
    where: { companyId_slug: { companyId: DEFAULT_COMPANY_ID, slug: 'feriado' } },
    create: { name: 'Feriado', slug: 'feriado', companyId: DEFAULT_COMPANY_ID },
    update: {},
  })
  await prisma.calendarEvent.create({
    data: { title, date: dayFromYmd(ymd), typeId: type.id, createdById, companyId: DEFAULT_COMPANY_ID },
  })
}

// Semana de referência (2026): 06-01 seg ... 06-05 sex, 06-06 sáb, 06-07 dom,
// 06-08 seg. "today" é injetado para deixar o cálculo determinístico.
describe('streak-service (dias úteis)', () => {
  it('streak atual conta dias úteis consecutivos incluindo hoje', async () => {
    const userId = await makeUser('a@empresa.com')
    await seedDays(userId, ['2026-06-01', '2026-06-02', '2026-06-03'])
    const s = await getStreakSummary(userId, DEFAULT_COMPANY_ID, '2026-06-03') // quarta
    expect(s.currentStreak).toBe(3)
    expect(s.registeredToday).toBe(true)
    expect(s.today).toBe('2026-06-03')
  })

  it('ponte de fim de semana: sexta + segunda são consecutivos', async () => {
    const userId = await makeUser('b@empresa.com')
    await seedDays(userId, ['2026-06-05', '2026-06-08']) // sexta + segunda
    const s = await getStreakSummary(userId, DEFAULT_COMPANY_ID, '2026-06-08') // segunda
    expect(s.currentStreak).toBe(2)
  })

  it('graça no fim de semana: hoje sábado, sexta com boost segura o streak', async () => {
    const userId = await makeUser('c@empresa.com')
    await seedDays(userId, ['2026-06-04', '2026-06-05']) // quinta + sexta
    const s = await getStreakSummary(userId, DEFAULT_COMPANY_ID, '2026-06-06') // sábado
    expect(s.currentStreak).toBe(2)
    expect(s.registeredToday).toBe(false)
  })

  it('graça na manhã de segunda: sem boost hoje, sexta com boost segura', async () => {
    const userId = await makeUser('d@empresa.com')
    await seedDays(userId, ['2026-06-04', '2026-06-05']) // quinta + sexta
    const s = await getStreakSummary(userId, DEFAULT_COMPANY_ID, '2026-06-08') // segunda, ainda sem boost
    expect(s.currentStreak).toBe(2)
    expect(s.registeredToday).toBe(false)
  })

  it('falta de um dia útil quebra a sequência', async () => {
    const userId = await makeUser('e@empresa.com')
    // quarta com boost, depois pula quinta e sexta, segunda com boost
    await seedDays(userId, ['2026-06-03', '2026-06-08'])
    const s = await getStreakSummary(userId, DEFAULT_COMPANY_ID, '2026-06-08') // segunda
    expect(s.currentStreak).toBe(1)
  })

  it('entrada de fim de semana é ignorada no melhor streak', async () => {
    const userId = await makeUser('f@empresa.com')
    await seedDays(userId, ['2026-06-05', '2026-06-06', '2026-06-08']) // sex, sáb, seg
    const s = await getStreakSummary(userId, DEFAULT_COMPANY_ID, '2026-06-08')
    expect(s.bestStreak).toBe(2) // sexta→segunda; sábado não conta nem quebra
  })

  it('melhor streak escolhe o maior run histórico de dias úteis', async () => {
    const userId = await makeUser('g@empresa.com')
    // run de 3 (seg/ter/qua), buraco (sem quinta), sexta isolada
    await seedDays(userId, ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-05'])
    const s = await getStreakSummary(userId, DEFAULT_COMPANY_ID, '2026-06-05')
    expect(s.bestStreak).toBe(3)
  })

  it('usuário sem registros: tudo zero', async () => {
    const userId = await makeUser('h@empresa.com')
    const s = await getStreakSummary(userId, DEFAULT_COMPANY_ID, '2026-06-03')
    expect(s).toMatchObject({ currentStreak: 0, bestStreak: 0, registeredToday: false })
  })

  it('calendário do mês conta só dias úteis (exclui fim de semana)', async () => {
    const userId = await makeUser('i@empresa.com')
    await seedDays(userId, ['2026-06-05', '2026-06-06', '2026-06-08']) // sex, sáb, seg
    const cal = await getStreakCalendar(userId, DEFAULT_COMPANY_ID, '2026-06')
    expect(cal.ref).toBe('2026-06')
    expect(cal.days).toEqual(['2026-06-05', '2026-06-08'])
    expect(cal.count).toBe(2)
  })

  it('feriado nacional é ponte, igual fim de semana: não quebra a sequência de quem não marcou humor', async () => {
    const userId = await makeUser('j@empresa.com')
    // segunda (07/09, feriado) e terça (08/09) com boost; segunda sem marcação.
    await seedDays(userId, ['2026-09-04', '2026-09-08']) // sexta + terça
    await seedHoliday('2026-09-07', 'Independência do Brasil', userId)
    const s = await getStreakSummary(userId, DEFAULT_COMPANY_ID, '2026-09-08') // terça
    expect(s.currentStreak).toBe(2)
  })

  it('sem feriado cadastrado, o mesmo dia útil vazio quebra a sequência', async () => {
    const userId = await makeUser('k@empresa.com')
    await seedDays(userId, ['2026-09-04', '2026-09-08'])
    const s = await getStreakSummary(userId, DEFAULT_COMPANY_ID, '2026-09-08')
    expect(s.currentStreak).toBe(1)
  })

  it('não conta entrada com companyId divergente do próprio usuário (defesa em profundidade)', async () => {
    const userId = await makeUser('mood-streak-empresa@x.com')
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Streak', slug: 'outra-empresa-streak-test' } })
    await prisma.moodEntry.create({ data: { userId, day: dayFromYmd('2026-06-03'), mood: 'GOOD', companyId: otherCompany.id } })
    const s = await getStreakSummary(userId, DEFAULT_COMPANY_ID, '2026-06-03')
    expect(s.currentStreak).toBe(0)
    expect(s.registeredToday).toBe(false)
  })
})

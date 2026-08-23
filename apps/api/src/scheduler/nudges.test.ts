import { describe, it, expect, vi, afterEach } from 'vitest'
import { prisma } from '../lib/prisma'
import * as streakService from '../services/streak-service'
import { runNudgeTick } from './nudges'

// 2026-06-25 (quinta) às 19:00Z == 16:00 SP, dia útil → janela do nudge.
const FIRE = new Date('2026-06-25T19:00:00.000Z')

let counter = 0
async function makeUser(opts: { active?: boolean; teamsWebhookUrl?: string | null } = {}) {
  counter += 1
  return prisma.user.create({
    data: {
      name: `Dev ${counter}`,
      email: `dev-${counter}@empresa.com`,
      passwordHash: 'x',
      active: opts.active ?? true,
      teamsWebhookUrl: opts.teamsWebhookUrl ?? null,
    },
  })
}

/** Cria boosts de humor nos dias úteis informados (YYYY-MM-DD em SP). */
async function giveMood(userId: string, ymds: string[]) {
  for (const ymd of ymds) {
    await prisma.moodEntry.create({
      data: { userId, day: new Date(`${ymd}T00:00:00.000Z`), mood: 'GOOD' },
    })
  }
}

function fetchSpyOk() {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
}

afterEach(() => vi.restoreAllMocks())

describe('runNudgeTick — ofensiva em risco', () => {
  it('notifica in-app e dispara Teams para quem tem streak e não registrou hoje', async () => {
    const fetchSpy = fetchSpyOk()
    const u = await makeUser({ teamsWebhookUrl: 'https://flow.example/u' })
    // boost ontem e anteontem (dias úteis), sem boost hoje (25)
    await giveMood(u.id, ['2026-06-24', '2026-06-23'])

    await runNudgeTick(FIRE)

    const notifs = await prisma.notification.findMany({ where: { userId: u.id } })
    expect(notifs).toHaveLength(1)
    expect(notifs[0].type).toBe('STREAK_AT_RISK')
    expect(notifs[0].link).toBe(`/perfil/${u.id}`)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)
    expect(body.type).toBe('message')
    const content = body.attachments[0].content
    expect(content.type).toBe('AdaptiveCard')
    // CTA aponta para a tela de login (URL absoluta)
    expect(content.actions[0].url).toMatch(/\/login$/)
    // streak de 2 dias (boosts em 24 e 23) aparece no corpo do card
    expect(JSON.stringify(content.body)).toContain('2 dias')
  })

  it('cria in-app mas NÃO chama Teams quando não há teamsWebhookUrl', async () => {
    const fetchSpy = fetchSpyOk()
    const u = await makeUser({ teamsWebhookUrl: null })
    await giveMood(u.id, ['2026-06-24'])

    await runNudgeTick(FIRE)

    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('é idempotente: segundo tick no mesmo dia não duplica', async () => {
    const fetchSpy = fetchSpyOk()
    const u = await makeUser({ teamsWebhookUrl: 'https://flow.example/u' })
    await giveMood(u.id, ['2026-06-24'])

    await runNudgeTick(FIRE)
    await runNudgeTick(FIRE)

    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('não notifica quem não tem streak (sem boosts)', async () => {
    fetchSpyOk()
    const u = await makeUser()
    await runNudgeTick(FIRE)
    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(0)
  })

  it('não notifica quem já registrou humor hoje', async () => {
    fetchSpyOk()
    const u = await makeUser()
    await giveMood(u.id, ['2026-06-24', '2026-06-25'])
    await runNudgeTick(FIRE)
    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(0)
  })

  it('não notifica usuário ADMIN mesmo com streak ativo e sem humor hoje', async () => {
    fetchSpyOk()
    counter += 1
    const admin = await prisma.user.create({
      data: {
        name: `Admin ${counter}`,
        email: `admin-${counter}@empresa.com`,
        passwordHash: 'x',
        active: true,
        role: 'ADMIN',
      },
    })
    await giveMood(admin.id, ['2026-06-24'])
    await runNudgeTick(FIRE)
    expect(await prisma.notification.count({ where: { userId: admin.id } })).toBe(0)
  })

  it('não notifica usuário SUBADMIN mesmo com streak ativo e sem humor hoje', async () => {
    fetchSpyOk()
    counter += 1
    const subadmin = await prisma.user.create({
      data: {
        name: `Subadmin ${counter}`,
        email: `subadmin-${counter}@empresa.com`,
        passwordHash: 'x',
        active: true,
        role: 'SUBADMIN',
      },
    })
    await giveMood(subadmin.id, ['2026-06-24'])
    await runNudgeTick(FIRE)
    expect(await prisma.notification.count({ where: { userId: subadmin.id } })).toBe(0)
  })

  it('não notifica usuário inativo', async () => {
    fetchSpyOk()
    const u = await makeUser({ active: false })
    await giveMood(u.id, ['2026-06-24'])
    await runNudgeTick(FIRE)
    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(0)
  })

  it('no-op fora da janela: fim de semana', async () => {
    fetchSpyOk()
    const u = await makeUser({ teamsWebhookUrl: 'https://flow.example/u' })
    await giveMood(u.id, ['2026-06-25', '2026-06-24'])
    // 2026-06-27 é sábado, 19:00Z == 16:00 SP
    await runNudgeTick(new Date('2026-06-27T19:00:00.000Z'))
    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(0)
  })

  it('no-op fora da janela: hora errada (9h SP)', async () => {
    fetchSpyOk()
    const u = await makeUser()
    await giveMood(u.id, ['2026-06-24'])
    // 2026-06-25T12:00Z == 09:00 SP
    await runNudgeTick(new Date('2026-06-25T12:00:00.000Z'))
    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(0)
  })

  it('falha no Teams não impede a notificação in-app', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('boom'))
    const u = await makeUser({ teamsWebhookUrl: 'https://flow.example/u' })
    await giveMood(u.id, ['2026-06-24'])
    await runNudgeTick(FIRE)
    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(1)
  })

  it('erro em um usuário não aborta o lote: segundo usuário ainda é notificado', async () => {
    fetchSpyOk()
    const u1 = await makeUser()
    const u2 = await makeUser()
    // ambos com streak (dia útil ontem), sem boost hoje
    await giveMood(u1.id, ['2026-06-24'])
    await giveMood(u2.id, ['2026-06-24'])

    // Faz getStreakSummary lançar apenas para o primeiro usuário; o segundo
    // retorna um summary elegível para o nudge.
    const spy = vi.spyOn(streakService, 'getStreakSummary')
      .mockRejectedValueOnce(new Error('falha simulada — exercita o catch externo'))
      .mockResolvedValueOnce({ currentStreak: 1, bestStreak: 1, today: '2026-06-25', registeredToday: false })

    await expect(runNudgeTick(FIRE)).resolves.toBeUndefined()

    // u1 falhou no catch — sem notificação
    expect(await prisma.notification.count({ where: { userId: u1.id } })).toBe(0)
    // u2 foi processado normalmente — deve ter 1 notificação
    expect(await prisma.notification.count({ where: { userId: u2.id } })).toBe(1)
    expect(spy).toHaveBeenCalledTimes(2)
  })
})

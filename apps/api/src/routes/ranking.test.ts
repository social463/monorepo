import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID, PRESENCE_ONLINE_WINDOW_MINUTES } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

type App = ReturnType<typeof buildApp>

let seq = 0

async function legend(
  app: App,
  name: string,
  overrides: { lastSeenAt?: Date | null; sectorId?: string; role?: 'LEGEND' | 'THIRD_PARTY'; active?: boolean } = {},
) {
  seq += 1
  const user = await prisma.user.create({
    data: {
      name,
      email: `ranking-${seq}-${Date.now()}@x.com`,
      passwordHash: 'x',
      role: overrides.role ?? 'LEGEND',
      sectorId: overrides.sectorId ?? DEFAULT_SECTOR_ID,
      active: overrides.active ?? true,
      lastSeenAt: overrides.lastSeenAt ?? null,
    },
  })
  const token = app.jwt.sign({
    sub: user.id,
    role: user.role,
    sectorId: user.sectorId,
    companyId: DEFAULT_COMPANY_ID,
    features: [],
  })
  return { user, token }
}

async function adminToken(app: App) {
  seq += 1
  const user = await prisma.user.create({
    data: {
      name: 'Admin',
      email: `ranking-admin-${seq}-${Date.now()}@x.com`,
      passwordHash: 'x',
      role: 'ADMIN',
    },
  })
  return app.jwt.sign({
    sub: user.id,
    role: 'ADMIN',
    sectorId: DEFAULT_SECTOR_ID,
    companyId: DEFAULT_COMPANY_ID,
    features: [],
  })
}

/** Credita XP direto no livro-razão — o ranking soma a mesma tabela do card de perfil. */
async function credit(userId: string, amount: number, opts: { day?: Date; event?: 'VOTE_CAST' | 'MOOD_ANSWERED' } = {}) {
  seq += 1
  const event = opts.event ?? 'VOTE_CAST'
  const rule = await prisma.xpRule.upsert({
    where: { companyId_event: { companyId: DEFAULT_COMPANY_ID, event } },
    create: { event, amount: 1, companyId: DEFAULT_COMPANY_ID },
    update: {},
  })
  await prisma.xpTransaction.create({
    data: {
      userId,
      event,
      ruleId: rule.id,
      amount,
      dedupeKey: `${event}:seed-${seq}`,
      day: opts.day ?? new Date('2026-08-12T00:00:00.000Z'),
      companyId: DEFAULT_COMPANY_ID,
    },
  })
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` })

describe('GET /ranking', () => {
  it('ordena por pontos, numera as posições e devolve a posição de quem pediu', async () => {
    const app = buildApp()
    await app.ready()
    const primeiro = await legend(app, 'Ana')
    const segundo = await legend(app, 'Bruno')
    const viewer = await legend(app, 'Carla')
    await credit(primeiro.user.id, 300)
    await credit(segundo.user.id, 120)
    await credit(viewer.user.id, 10)

    const res = await app.inject({ method: 'GET', url: '/ranking', headers: auth(viewer.token) })
    expect(res.statusCode).toBe(200)
    const body = res.json()

    expect(body.entries.map((e: { user: { name: string } }) => e.user.name)).toEqual(['Ana', 'Bruno', 'Carla'])
    expect(body.entries.map((e: { position: number }) => e.position)).toEqual([1, 2, 3])
    expect(body.entries[0].points).toBe(300)
    expect(body.total).toBe(3)
    expect(body.me).toEqual({ position: 3, points: 10 })
  })

  it('empate de pontos desempata por nome, e quem nunca pontuou entra com zero', async () => {
    const app = buildApp()
    await app.ready()
    const zeca = await legend(app, 'Zeca')
    const ana = await legend(app, 'Ana')
    await legend(app, 'Sem pontos')
    await credit(zeca.user.id, 50)
    await credit(ana.user.id, 50)

    const res = await app.inject({ method: 'GET', url: '/ranking', headers: auth(zeca.token) })
    const body = res.json()
    expect(body.entries.map((e: { user: { name: string } }) => e.user.name)).toEqual(['Ana', 'Zeca', 'Sem pontos'])
    expect(body.entries[2].points).toBe(0)
  })

  it('marca on-line quem foi visto dentro da janela e inativo quem não foi', async () => {
    const app = buildApp()
    await app.ready()
    const agora = new Date()
    const online = await legend(app, 'Online', { lastSeenAt: agora })
    const antigo = new Date(agora.getTime() - (PRESENCE_ONLINE_WINDOW_MINUTES + 1) * 60 * 1000)
    const offline = await legend(app, 'Offline', { lastSeenAt: antigo })
    const nunca = await legend(app, 'Nunca visto')
    await credit(online.user.id, 30)
    await credit(offline.user.id, 20)
    await credit(nunca.user.id, 10)

    const res = await app.inject({ method: 'GET', url: '/ranking', headers: auth(online.token) })
    const byName = Object.fromEntries(
      res.json().entries.map((e: { user: { name: string }; online: boolean }) => [e.user.name, e.online]),
    )
    expect(byName).toEqual({ Online: true, Offline: false, 'Nunca visto': false })
  })

  it('deixa de fora conta de administração, terceirizado, inativo e quem já saiu', async () => {
    const app = buildApp()
    await app.ready()
    const viewer = await legend(app, 'Ativa')
    await legend(app, 'Terceirizada', { role: 'THIRD_PARTY' })
    await legend(app, 'Desativada', { active: false })
    const saiu = await legend(app, 'Ex-lenda')
    await prisma.user.update({ where: { id: saiu.user.id }, data: { leftAt: new Date() } })
    await adminToken(app)

    const res = await app.inject({ method: 'GET', url: '/ranking', headers: auth(viewer.token) })
    expect(res.json().entries.map((e: { user: { name: string } }) => e.user.name)).toEqual(['Ativa'])
  })

  it('limit corta a lista mas preserva total e a posição real de quem pediu', async () => {
    const app = buildApp()
    await app.ready()
    const top = await legend(app, 'Topo')
    const meio = await legend(app, 'Meio')
    const viewer = await legend(app, 'Ultimo')
    await credit(top.user.id, 900)
    await credit(meio.user.id, 500)
    await credit(viewer.user.id, 100)

    const res = await app.inject({ method: 'GET', url: '/ranking?limit=1', headers: auth(viewer.token) })
    const body = res.json()
    expect(body.entries).toHaveLength(1)
    expect(body.total).toBe(3)
    expect(body.me).toEqual({ position: 3, points: 100 })
  })

  it('leva o nível junto, derivado dos mesmos pontos', async () => {
    const app = buildApp()
    await app.ready()
    const viewer = await legend(app, 'Ouro')
    await credit(viewer.user.id, 1_500)

    const res = await app.inject({ method: 'GET', url: '/ranking', headers: auth(viewer.token) })
    expect(res.json().entries[0].level.name).toBe('Ouro')
  })

  it('exige autenticação', async () => {
    const app = buildApp()
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/ranking' })
    expect(res.statusCode).toBe(401)
  })

  it('rejeita limit fora da faixa', async () => {
    const app = buildApp()
    await app.ready()
    const viewer = await legend(app, 'Alguém')
    const res = await app.inject({ method: 'GET', url: '/ranking?limit=0', headers: auth(viewer.token) })
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /ranking/streaks', () => {
  it('ordena por sequência atual e conta dias úteis seguidos', async () => {
    const app = buildApp()
    await app.ready()
    const constante = await legend(app, 'Constante')
    const esporadica = await legend(app, 'Esporádica')

    // 12/08/2026 é uma quarta-feira; 10, 11 e 12 são dias úteis seguidos.
    for (const ymd of ['2026-08-10', '2026-08-11', '2026-08-12']) {
      await prisma.moodEntry.create({
        data: {
          userId: constante.user.id,
          day: new Date(`${ymd}T00:00:00.000Z`),
          mood: 'GOOD',
          companyId: DEFAULT_COMPANY_ID,
        },
      })
    }
    await prisma.moodEntry.create({
      data: {
        userId: esporadica.user.id,
        day: new Date('2026-08-12T00:00:00.000Z'),
        mood: 'GOOD',
        companyId: DEFAULT_COMPANY_ID,
      },
    })

    const res = await app.inject({ method: 'GET', url: '/ranking/streaks', headers: auth(constante.token) })
    expect(res.statusCode).toBe(200)
    const entries = res.json().entries as { user: { name: string }; bestStreak: number }[]
    expect(entries[0].user.name).toBe('Constante')
    expect(entries[0].bestStreak).toBe(3)
    expect(entries.find((e) => e.user.name === 'Esporádica')?.bestStreak).toBe(1)
  })

  it('exige autenticação', async () => {
    const app = buildApp()
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/ranking/streaks' })
    expect(res.statusCode).toBe(401)
  })
})

describe('GET /admin/ranking/overview', () => {
  it('resume a economia de XP: adesão, evento, setor e quem ficou de fora', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const ativa = await legend(app, 'Ativa no mês')
    const parada = await legend(app, 'Parada')

    await credit(ativa.user.id, 200, { day: new Date(), event: 'VOTE_CAST' })
    await credit(ativa.user.id, 50, { day: new Date(), event: 'MOOD_ANSWERED' })
    // Crédito antigo: conta no acumulado, não na adesão do mês corrente.
    await credit(parada.user.id, 400, { day: new Date('2020-01-15T00:00:00.000Z') })

    const res = await app.inject({ method: 'GET', url: '/admin/ranking/overview', headers: auth(token) })
    expect(res.statusCode).toBe(200)
    const overview = res.json().overview

    expect(overview.people).toBe(2)
    expect(overview.scored).toBe(2)
    expect(overview.activeThisMonth).toBe(1)
    expect(overview.totalPoints).toBe(650)
    expect(overview.pointsThisMonth).toBe(250)

    const events = Object.fromEntries(
      overview.byEvent.map((row: { event: string; points: number }) => [row.event, row.points]),
    )
    expect(events).toEqual({ VOTE_CAST: 600, MOOD_ANSWERED: 50 })

    expect(overview.bySector).toHaveLength(1)
    expect(overview.bySector[0].people).toBe(2)
    expect(overview.bySector[0].points).toBe(650)

    // Quem não pontuou NESTE mês entra na lista de ociosos, mesmo com acumulado alto.
    expect(overview.idle.map((row: { user: { name: string } }) => row.user.name)).toEqual(['Parada'])
    expect(overview.idle[0].lastPointAt).not.toBeNull()
    expect(overview.top[0].user.name).toBe('Parada')
  })

  it('é fechado para quem não é admin', async () => {
    const app = buildApp()
    await app.ready()
    const viewer = await legend(app, 'Lenda')
    const res = await app.inject({ method: 'GET', url: '/admin/ranking/overview', headers: auth(viewer.token) })
    expect(res.statusCode).toBe(403)
  })
})

describe('presença', () => {
  it('POST /me/presence carimba o último sinal e acende a bolinha', async () => {
    const app = buildApp()
    await app.ready()
    const { user, token } = await legend(app, 'Pessoa')
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).lastSeenAt).toBeNull()

    const res = await app.inject({ method: 'POST', url: '/me/presence', headers: auth(token) })
    expect(res.statusCode).toBe(204)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).lastSeenAt).not.toBeNull()

    const ranking = await app.inject({ method: 'GET', url: '/ranking', headers: auth(token) })
    expect(ranking.json().entries[0].online).toBe(true)
  })

  it('o ping de navegação também carimba presença, sem exigir heartbeat', async () => {
    const app = buildApp()
    await app.ready()
    const { user, token } = await legend(app, 'Navegante')

    const res = await app.inject({
      method: 'POST',
      url: '/access-logs',
      headers: auth(token),
      payload: { path: '/mural-feedbacks' },
    })
    expect(res.statusCode).toBe(204)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).lastSeenAt).not.toBeNull()
    // A linha de navegação continua sendo gravada — os dois registros convivem.
    expect(await prisma.accessLog.count({ where: { userId: user.id } })).toBe(1)
  })

  it('exige autenticação', async () => {
    const app = buildApp()
    await app.ready()
    const res = await app.inject({ method: 'POST', url: '/me/presence' })
    expect(res.statusCode).toBe(401)
  })
})

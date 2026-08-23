import { describe, expect, it } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

async function tokenFor(app: ReturnType<typeof buildApp>, email = 'dev@empresa.com') {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Dev', email, password: 'changeme123' },
  })
  return { token: res.json().accessToken as string, userId: res.json().user.id as string }
}

async function adminToken(app: ReturnType<typeof buildApp>) {
  await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Admin', email: 'admin@empresa.com', password: 'changeme123' } })
  await prisma.user.update({ where: { email: 'admin@empresa.com' }, data: { role: 'ADMIN' } })
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'admin@empresa.com', password: 'changeme123' } })
  return res.json().accessToken as string
}

describe('development thursday routes', () => {
  it('exige autenticação para listar e criar eventos', async () => {
    const app = buildApp()
    await app.ready()

    expect((await app.inject({ method: 'GET', url: '/development-thursday/events' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/development-thursday/events', payload: { title: 'T', description: 'D' } })).statusCode).toBe(401)

    await app.close()
  })

  it('cria um tema na sprint informada e notifica usuários ativos', async () => {
    const app = buildApp()
    await app.ready()
    const { token, userId } = await tokenFor(app)
    const other = await prisma.user.create({ data: { name: 'Bia', email: 'bia@empresa.com', passwordHash: 'x', role: 'LEAD' } })
    await prisma.user.create({ data: { name: 'Admin', email: 'admin2@empresa.com', passwordHash: 'x', role: 'ADMIN' } })

    const res = await app.inject({
      method: 'POST',
      url: '/development-thursday/events',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: 'TypeScript sem medo',
        description: 'Um papo prático sobre tipos úteis no dia a dia.',
        eventDate: '2026-07-08',
        startTime: '09:00',
        endTime: '10:15',
        sprintStart: '2026-07-06',
      },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().event).toMatchObject({
      title: 'TypeScript sem medo',
      sprintStart: '2026-07-06',
      sprintEnd: '2026-07-17',
      eventDate: '2026-07-08',
      startTime: '09:00',
      endTime: '10:15',
      presenter: { id: userId, name: 'Dev' },
    })
    expect(await prisma.notification.count({ where: { type: 'DEVELOPMENT_THURSDAY_EVENT' } })).toBe(2)
    expect(await prisma.notification.count({ where: { userId: other.id, type: 'DEVELOPMENT_THURSDAY_EVENT' } })).toBe(1)

    await app.close()
  })

  it('bloqueia segundo tema para a mesma sprint', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await tokenFor(app)
    const payload = { title: 'Tema', description: 'Descrição', sprintStart: '2026-07-06' }

    await app.inject({ method: 'POST', url: '/development-thursday/events', headers: { authorization: `Bearer ${token}` }, payload })
    const res = await app.inject({ method: 'POST', url: '/development-thursday/events', headers: { authorization: `Bearer ${token}` }, payload })

    expect(res.statusCode).toBe(409)
    await app.close()
  })

  it('rejeita evento em fim de semana', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await tokenFor(app)

    const res = await app.inject({
      method: 'POST',
      url: '/development-thursday/events',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: 'Tema',
        description: 'Descrição',
        eventDate: '2026-07-12',
        sprintStart: '2026-07-06',
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().message).toBe('Escolha um dia útil para a Quinta de Desenvolvimento.')
    await app.close()
  })

  it('rejeita horário de fim antes do início', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await tokenFor(app)

    const res = await app.inject({
      method: 'POST',
      url: '/development-thursday/events',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: 'Tema',
        description: 'Descrição',
        eventDate: '2026-07-08',
        startTime: '11:00',
        endTime: '10:00',
        sprintStart: '2026-07-06',
      },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().message).toBe('O horário de fim deve ser depois do início.')
    await app.close()
  })

  it('lista eventos dentro do intervalo solicitado', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await tokenFor(app)
    await app.inject({
      method: 'POST',
      url: '/development-thursday/events',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'Tema', description: 'Descrição', sprintStart: '2026-07-20' },
    })

    const res = await app.inject({
      method: 'GET',
      url: '/development-thursday/events?from=2026-07-01&to=2026-07-31',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().events).toHaveLength(1)
    expect(res.json().events[0].eventDate).toBe('2026-07-23')
    await app.close()
  })

  it('permite ao autor editar título, descrição e data do tema', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await tokenFor(app)
    const created = await app.inject({
      method: 'POST',
      url: '/development-thursday/events',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: 'Tema inicial',
        description: 'Descrição inicial',
        eventDate: '2026-07-08',
        sprintStart: '2026-07-06',
      },
    })

    const res = await app.inject({
      method: 'PATCH',
      url: `/development-thursday/events/${created.json().event.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        title: 'Tema editado',
        description: 'Descrição editada',
        eventDate: '2026-07-10',
        startTime: '14:00',
        endTime: '15:00',
      },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().event).toMatchObject({
      title: 'Tema editado',
      description: 'Descrição editada',
      eventDate: '2026-07-10',
      startTime: '14:00',
      endTime: '15:00',
    })
    await app.close()
  })

  it('bloqueia edição por outro usuário', async () => {
    const app = buildApp()
    await app.ready()
    const author = await tokenFor(app, 'autor@empresa.com')
    const other = await tokenFor(app, 'outro@empresa.com')
    const created = await app.inject({
      method: 'POST',
      url: '/development-thursday/events',
      headers: { authorization: `Bearer ${author.token}` },
      payload: { title: 'Tema', description: 'Descrição', eventDate: '2026-07-08', sprintStart: '2026-07-06' },
    })

    const res = await app.inject({
      method: 'PATCH',
      url: `/development-thursday/events/${created.json().event.id}`,
      headers: { authorization: `Bearer ${other.token}` },
      payload: { title: 'Tentativa' },
    })

    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('permite ao autor excluir o tema', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await tokenFor(app)
    const created = await app.inject({
      method: 'POST',
      url: '/development-thursday/events',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'Tema', description: 'Descrição', eventDate: '2026-07-08', sprintStart: '2026-07-06' },
    })

    const res = await app.inject({
      method: 'DELETE',
      url: `/development-thursday/events/${created.json().event.id}`,
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.statusCode).toBe(204)
    expect(await prisma.developmentThursdayEvent.count()).toBe(0)
    await app.close()
  })

  it('registra feedback no card após a apresentação e conta para selo de feedback', async () => {
    const app = buildApp()
    await app.ready()
    const presenter = await tokenFor(app, 'palestrante@empresa.com')
    const author = await tokenFor(app, 'feedbacker@empresa.com')
    const badge = await prisma.badge.create({
      data: {
        slug: 'feedback-primeiro-card',
        name: 'Feedback em Dia',
        description: 'Deu um feedback.',
        iconKey: 'chat',
        kind: 'FEEDBACK',
        threshold: 1,
      },
    })
    const created = await app.inject({
      method: 'POST',
      url: '/development-thursday/events',
      headers: { authorization: `Bearer ${presenter.token}` },
      payload: {
        title: 'Arquitetura orientada a eventos',
        description: 'Como usamos filas para desacoplar domínios.',
        eventDate: '2000-01-13',
        sprintStart: '2000-01-10',
      },
    })

    const res = await app.inject({
      method: 'POST',
      url: `/development-thursday/events/${created.json().event.id}/feedbacks`,
      headers: { authorization: `Bearer ${author.token}` },
      payload: {
        message: 'A apresentação foi clara, trouxe exemplos reais e abriu uma boa conversa técnica.',
        category: 'ELOGIO',
      },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().feedback.author.name).toBe('Dev')
    expect(res.json().feedback.category).toBe('ELOGIO')
    const stored = await prisma.feedback.findUniqueOrThrow({ where: { id: res.json().feedback.id } })
    expect(stored.targetId).toBe(presenter.userId)
    expect(stored.developmentThursdayEventId).toBe(created.json().event.id)
    expect(await prisma.userBadge.count({ where: { userId: author.userId, badgeId: badge.id } })).toBe(1)

    const list = await app.inject({
      method: 'GET',
      url: `/development-thursday/events/${created.json().event.id}/feedbacks`,
      headers: { authorization: `Bearer ${presenter.token}` },
    })
    expect(list.statusCode).toBe(200)
    expect(list.json().feedbacks).toHaveLength(1)

    const profile = await app.inject({
      method: 'GET',
      url: `/users/${presenter.userId}/feedbacks`,
      headers: { authorization: `Bearer ${presenter.token}` },
    })
    expect(profile.json().feedbacks.map((f: { id: string }) => f.id)).toContain(res.json().feedback.id)

    await app.close()
  })

  it('bloqueia feedback antes da apresentação terminar', async () => {
    const app = buildApp()
    await app.ready()
    const presenter = await tokenFor(app, 'palestrante-futuro@empresa.com')
    const author = await tokenFor(app, 'feedbacker-futuro@empresa.com')
    const created = await app.inject({
      method: 'POST',
      url: '/development-thursday/events',
      headers: { authorization: `Bearer ${presenter.token}` },
      payload: {
        title: 'Tema futuro',
        description: 'Apresentação ainda não aconteceu.',
        eventDate: '2030-01-17',
        sprintStart: '2030-01-14',
      },
    })

    const res = await app.inject({
      method: 'POST',
      url: `/development-thursday/events/${created.json().event.id}/feedbacks`,
      headers: { authorization: `Bearer ${author.token}` },
      payload: {
        message: 'Tentativa com texto suficiente antes da apresentação acontecer.',
        category: 'POSITIVO',
      },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().message).toBe('Feedbacks ficam disponíveis após a apresentação.')
    await app.close()
  })

  it('bloqueia exclusão de tema com feedbacks registrados', async () => {
    const app = buildApp()
    await app.ready()
    const presenter = await tokenFor(app, 'palestrante-com-feedback@empresa.com')
    const author = await tokenFor(app, 'autor-feedback-card@empresa.com')
    const created = await app.inject({
      method: 'POST',
      url: '/development-thursday/events',
      headers: { authorization: `Bearer ${presenter.token}` },
      payload: {
        title: 'Tema com histórico',
        description: 'Esse card já recebeu feedback.',
        eventDate: '2000-01-13',
        sprintStart: '2000-01-10',
      },
    })
    await app.inject({
      method: 'POST',
      url: `/development-thursday/events/${created.json().event.id}/feedbacks`,
      headers: { authorization: `Bearer ${author.token}` },
      payload: {
        message: 'Feedback suficiente para preservar o histórico deste card.',
        category: 'POSITIVO',
      },
    })

    const res = await app.inject({
      method: 'DELETE',
      url: `/development-thursday/events/${created.json().event.id}`,
      headers: { authorization: `Bearer ${presenter.token}` },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().message).toBe('Não é possível excluir um tema com feedbacks registrados.')
    await app.close()
  })

  it('bloqueia exclusão por outro usuário', async () => {
    const app = buildApp()
    await app.ready()
    const author = await tokenFor(app, 'autor-delete@empresa.com')
    const other = await tokenFor(app, 'outro-delete@empresa.com')
    const created = await app.inject({
      method: 'POST',
      url: '/development-thursday/events',
      headers: { authorization: `Bearer ${author.token}` },
      payload: { title: 'Tema', description: 'Descrição', eventDate: '2026-07-08', sprintStart: '2026-07-06' },
    })

    const res = await app.inject({
      method: 'DELETE',
      url: `/development-thursday/events/${created.json().event.id}`,
      headers: { authorization: `Bearer ${other.token}` },
    })

    expect(res.statusCode).toBe(403)
    expect(await prisma.developmentThursdayEvent.count()).toBe(1)
    await app.close()
  })
})

describe('development thursday admin settings', () => {
  it('permite ao admin cadastrar a URL do canal Teams', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)

    const patch = await app.inject({
      method: 'PATCH',
      url: '/admin/development-thursday/settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { teamsWebhookUrl: 'https://example.com/teams-hook' },
    })
    expect(patch.statusCode).toBe(200)
    expect(patch.json().settings.teamsWebhookUrl).toBe('https://example.com/teams-hook')

    const get = await app.inject({
      method: 'GET',
      url: '/admin/development-thursday/settings',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(get.json().settings.teamsWebhookUrl).toBe('https://example.com/teams-hook')
    await app.close()
  })

  it('bloqueia não-admin na configuração do Teams', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await tokenFor(app)
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/development-thursday/settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { teamsWebhookUrl: 'https://example.com/teams-hook' },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('isolamento por empresa: GET /development-thursday/events não lista tema de outra empresa; webhook do Teams não é compartilhado', async () => {
    const app = buildApp()
    await app.ready()

    await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'SuperAdmin', email: 'super-admin-dt@empresa.com', password: 'changeme123' } })
    await prisma.user.update({ where: { email: 'super-admin-dt@empresa.com' }, data: { role: 'SUPER_ADMIN' } })
    const superLogin = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'super-admin-dt@empresa.com', password: 'changeme123' } })
    const superToken = superLogin.json().accessToken as string

    await app.inject({
      method: 'POST', url: '/super-admin/companies',
      headers: { authorization: `Bearer ${superToken}` },
      payload: { name: 'Outra Empresa Quinta Rota', admin: { name: 'Admin Outra', email: 'admin-outra-empresa-dt@empresa.com', password: 'changeme123' } },
    })
    const outraEmpresaAdminLogin = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'admin-outra-empresa-dt@empresa.com', password: 'changeme123' } })
    const outraEmpresaAdminToken = outraEmpresaAdminLogin.json().accessToken as string

    await app.inject({
      method: 'PATCH', url: '/admin/development-thursday/settings',
      headers: { authorization: `Bearer ${outraEmpresaAdminToken}` },
      payload: { teamsWebhookUrl: 'https://outra-empresa.example.com/teams-hook' },
    })
    const createdOutra = await app.inject({
      method: 'POST', url: '/development-thursday/events',
      headers: { authorization: `Bearer ${outraEmpresaAdminToken}` },
      payload: { title: 'Tema de outra empresa', description: 'Não deveria aparecer aqui', eventDate: '2026-07-09' },
    })
    expect(createdOutra.statusCode).toBe(201)

    const { token } = await tokenFor(app, 'dev-isolamento-dt@empresa.com')
    const list = await app.inject({ method: 'GET', url: '/development-thursday/events', headers: { authorization: `Bearer ${token}` } })
    expect(list.json().events).toHaveLength(0)

    const adminToken2 = await adminToken(app)
    const settings = await app.inject({ method: 'GET', url: '/admin/development-thursday/settings', headers: { authorization: `Bearer ${adminToken2}` } })
    expect(settings.json().settings.teamsWebhookUrl).toBeNull()
    await app.close()
  })
})

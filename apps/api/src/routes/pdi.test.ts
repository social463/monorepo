import { describe, expect, it } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

async function tokenFor(app: ReturnType<typeof buildApp>, email: string, name = 'Dev') {
  const res = await app.inject({ method: 'POST', url: '/auth/register', payload: { name, email, password: 'changeme123' } })
  return { token: res.json().accessToken as string, userId: res.json().user.id as string }
}

/** Líder do plano precisa de papel acima na hierarquia — a regra é do service. */
async function leaderTokenFor(app: ReturnType<typeof buildApp>, email: string, name: string) {
  const created = await tokenFor(app, email, name)
  await prisma.user.update({ where: { id: created.userId }, data: { role: 'LEAD' } })
  return created
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` })

describe('rotas de PDI', () => {
  it('exige autenticação', async () => {
    const app = buildApp()
    await app.ready()

    expect((await app.inject({ method: 'GET', url: '/pdi/plans' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/pdi/reviews/pending' })).statusCode).toBe(401)

    await app.close()
  })

  it('bloqueia quem não tem a feature `pdi` liberada', async () => {
    const app = buildApp()
    await app.ready()
    const user = await prisma.user.create({
      data: { name: 'Terceirizado', email: 'terceiro@x.com', passwordHash: 'x', role: 'THIRD_PARTY' },
    })
    const sign = (features: string[]) =>
      app.jwt.sign({ sub: user.id, role: 'THIRD_PARTY', sectorId: 'sector-dev-produto', companyId: 'company-emr', features })

    expect((await app.inject({ method: 'GET', url: '/pdi/plans', headers: auth(sign([])) })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/pdi/plans', headers: auth(sign(['pdi'])) })).statusCode).toBe(200)

    await app.close()
  })

  it('uma pessoa não acessa o PDI de outra nem por chamada direta', async () => {
    const app = buildApp()
    await app.ready()
    const owner = await tokenFor(app, 'dona@empresa.com', 'Dona')
    const stranger = await tokenFor(app, 'outra@empresa.com', 'Outra')

    const created = await app.inject({
      method: 'POST',
      url: '/pdi/plans',
      headers: auth(owner.token),
      payload: { title: 'PDI 2026-Q1', cyclePeriod: '2026-Q1' },
    })
    expect(created.statusCode).toBe(201)
    const planId = created.json().plan.id as string

    const read = await app.inject({ method: 'GET', url: `/pdi/plans/${planId}`, headers: auth(stranger.token) })
    expect(read.statusCode).toBe(403)

    const edited = await app.inject({
      method: 'PATCH',
      url: `/pdi/plans/${planId}`,
      headers: auth(stranger.token),
      payload: { title: 'Sequestrado' },
    })
    expect(edited.statusCode).toBe(403)

    const listed = await app.inject({ method: 'GET', url: '/pdi/plans', headers: auth(stranger.token) })
    expect(listed.json().plans).toHaveLength(0)

    await app.close()
  })

  it('conclui a ação com evidência e reflexão e o líder valida pela fila', async () => {
    const app = buildApp()
    await app.ready()
    const owner = await tokenFor(app, 'dona@empresa.com', 'Dona')
    const leader = await leaderTokenFor(app, 'lider@empresa.com', 'Líder')

    const plan = await app.inject({
      method: 'POST',
      url: '/pdi/plans',
      headers: auth(owner.token),
      payload: { title: 'PDI 2026-Q1', leaderId: leader.userId },
    })
    const planId = plan.json().plan.id as string

    const action = await app.inject({
      method: 'POST',
      url: `/pdi/plans/${planId}/actions`,
      headers: auth(owner.token),
      payload: { description: 'Concluir o curso de liderança', type: 'COURSE', priority: 'HIGH' },
    })
    expect(action.statusCode).toBe(201)
    const actionId = action.json().action.id as string

    const completed = await app.inject({
      method: 'POST',
      url: `/pdi/actions/${actionId}/complete`,
      headers: auth(owner.token),
      payload: {
        practicalApplication: 'Levei o combinado para o 1:1 do time e registrei em ata.',
        reflection: { mainLearning: 'Feedback precisa de fato, não de rótulo.' },
        evidences: [{ kind: 'COMPLETION', externalUrl: 'https://exemplo.com/certificado' }],
      },
    })
    expect(completed.statusCode).toBe(200)
    expect(completed.json()).toMatchObject({ awaitingReview: true })

    const queue = await app.inject({ method: 'GET', url: '/pdi/reviews/pending', headers: auth(leader.token) })
    expect(queue.json().items).toHaveLength(1)

    const approved = await app.inject({
      method: 'POST',
      url: `/pdi/actions/${actionId}/review`,
      headers: auth(leader.token),
      payload: { decision: 'APPROVE' },
    })
    expect(approved.statusCode).toBe(200)
    expect(approved.json().action.status).toBe('DONE')

    await app.close()
  })

  it('quem não é o líder do plano não valida a ação', async () => {
    const app = buildApp()
    await app.ready()
    const owner = await tokenFor(app, 'dona@empresa.com', 'Dona')
    const leader = await leaderTokenFor(app, 'lider@empresa.com', 'Líder')
    const stranger = await tokenFor(app, 'outra@empresa.com', 'Outra')

    const plan = await app.inject({
      method: 'POST',
      url: '/pdi/plans',
      headers: auth(owner.token),
      payload: { title: 'PDI', leaderId: leader.userId },
    })
    const action = await app.inject({
      method: 'POST',
      url: `/pdi/plans/${plan.json().plan.id}/actions`,
      headers: auth(owner.token),
      payload: { description: 'Ler um livro', type: 'BOOK', priority: 'LOW' },
    })
    const actionId = action.json().action.id as string
    await app.inject({
      method: 'POST',
      url: `/pdi/actions/${actionId}/complete`,
      headers: auth(owner.token),
      payload: {
        practicalApplication: 'Apresentei os aprendizados para a equipe na reunião semanal.',
        reflection: { mainLearning: 'Escuta ativa muda o rumo da conversa.' },
        evidences: [{ kind: 'COMPLETION', externalUrl: 'https://exemplo.com/resenha' }],
      },
    })

    const res = await app.inject({
      method: 'POST',
      url: `/pdi/actions/${actionId}/review`,
      headers: auth(stranger.token),
      payload: { decision: 'APPROVE' },
    })

    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('plano de outra empresa responde 404', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await tokenFor(app, 'dev@empresa.com')
    const company = await prisma.company.create({ data: { id: 'company-outra', name: 'Outra', slug: 'outra' } })
    const sector = await prisma.sector.create({ data: { id: 'setor-outra', name: 'Outro', slug: 'outro', companyId: company.id } })
    const alien = await prisma.user.create({
      data: { name: 'Alheia', email: 'alheia@x.com', passwordHash: 'x', companyId: company.id, sectorId: sector.id },
    })
    const alienPlan = await prisma.pdiPlan.create({
      data: { userId: alien.id, title: 'PDI de outra empresa', companyId: company.id },
    })

    const res = await app.inject({ method: 'GET', url: `/pdi/plans/${alienPlan.id}`, headers: auth(token) })

    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('devolve as configurações de desenvolvimento e esconde os links externos sem URL', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await tokenFor(app, 'dev@empresa.com')

    const res = await app.inject({ method: 'GET', url: '/development/settings', headers: auth(token) })

    expect(res.statusCode).toBe(200)
    expect(res.json().settings).toEqual({
      leaderApprovalRequired: true,
      impulseUpUrl: null,
      inovaCommunityUrl: null,
    })
    await app.close()
  })

  it('admin configura os links externos e a exigência de validação', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await tokenFor(app, 'dev@empresa.com')
    await prisma.user.create({ data: { name: 'Admin', email: 'admin@empresa.com', passwordHash: 'x', role: 'ADMIN' } })
    const login = await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Adm', email: 'adm@empresa.com', password: 'changeme123' } })
    await prisma.user.update({ where: { email: 'adm@empresa.com' }, data: { role: 'ADMIN' } })
    const adminLogin = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'adm@empresa.com', password: 'changeme123' } })
    void login

    const patched = await app.inject({
      method: 'PATCH',
      url: '/admin/development/settings',
      headers: auth(adminLogin.json().accessToken),
      payload: {
        impulseUpUrl: 'https://eu-medico-residente.impulseup.com/',
        inovaCommunityUrl: 'https://inovacomunidadeemr.lovable.app/auth',
        leaderApprovalRequired: false,
      },
    })
    expect(patched.statusCode).toBe(200)

    const seen = await app.inject({ method: 'GET', url: '/development/settings', headers: auth(token) })
    expect(seen.json().settings).toEqual({
      leaderApprovalRequired: false,
      impulseUpUrl: 'https://eu-medico-residente.impulseup.com/',
      inovaCommunityUrl: 'https://inovacomunidadeemr.lovable.app/auth',
    })

    // Colaborador não configura.
    const denied = await app.inject({
      method: 'PATCH',
      url: '/admin/development/settings',
      headers: auth(token),
      payload: { leaderApprovalRequired: true },
    })
    expect(denied.statusCode).toBe(403)

    await app.close()
  })
})

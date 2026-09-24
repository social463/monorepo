import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import { materializeVoteFeedbacks } from '../services/vote-feedback-service'
import { createSector } from '../services/sector-service'
import { signAccessToken } from '../lib/jwt'

async function registerAndToken(app: ReturnType<typeof buildApp>, email: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: email.split('@')[0], email, password: 'changeme123' },
  })
  return res.json().accessToken as string
}

describe('GET /users', () => {
  it('lists active users excluding the requester', async () => {
    const app = buildApp()
    await app.ready()
    const token = await registerAndToken(app, 'ana@empresa.com')
    await registerAndToken(app, 'bruno@empresa.com')
    await registerAndToken(app, 'carla@empresa.com')

    const res = await app.inject({
      method: 'GET',
      url: '/users',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const emails = res.json().users.map((u: { email: string }) => u.email)
    expect(emails).toContain('bruno@empresa.com')
    expect(emails).toContain('carla@empresa.com')
    expect(emails).not.toContain('ana@empresa.com')
    await app.close()
  })

  it('rejects unauthenticated requests (401)', async () => {
    const app = buildApp()
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/users' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('não expõe teamsWebhookUrl na resposta pública (anti-vazamento)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await registerAndToken(app, 'ana@empresa.com')
    const outro = await prisma.user.create({
      data: { name: 'Outro Dev', email: 'outro@empresa.com', passwordHash: 'x', active: true },
    })
    await prisma.user.update({ where: { id: outro.id }, data: { teamsWebhookUrl: 'https://flow.example/secret' } })

    const res = await app.inject({
      method: 'GET',
      url: '/users',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const users = res.json().users as object[]
    expect(users.length).toBeGreaterThan(0)
    for (const u of users) {
      expect(u).not.toHaveProperty('teamsWebhookUrl')
    }
    await app.close()
  })

  it('inclui lideranças (LEAD) na listagem do time', async () => {
    const app = buildApp()
    await app.ready()
    const token = await registerAndToken(app, 'ana@empresa.com')
    await prisma.user.create({ data: { name: 'Lider', email: 'lider@empresa.com', passwordHash: 'x', role: 'LEAD' } })

    const res = await app.inject({
      method: 'GET',
      url: '/users',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const emails = res.json().users.map((u: { email: string }) => u.email)
    expect(emails).toContain('lider@empresa.com')
    await app.close()
  })

  it('não lista colegas de outro setor', async () => {
    const app = buildApp()
    await app.ready()
    const token = await registerAndToken(app, 'ana-setor@empresa.com')
    const admin = await prisma.user.create({ data: { name: 'Admin', email: 'admin-users-setor@empresa.com', passwordHash: 'x', role: 'ADMIN' } })
    const sectorB = await createSector({ name: 'Setor Time B (rota)', enabledFeatures: [], roles: [] }, admin.id, DEFAULT_COMPANY_ID)
    await prisma.user.create({ data: { name: 'De Outro Setor', email: 'outro-setor-time@empresa.com', passwordHash: 'x', sectorId: sectorB.id } })

    const res = await app.inject({
      method: 'GET',
      url: '/users',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const emails = res.json().users.map((u: { email: string }) => u.email)
    expect(emails).not.toContain('outro-setor-time@empresa.com')
    await app.close()
  })
})

describe('GET /users/company', () => {
  it('por padrão é a lista de destinatários de feedback: sem você mesmo, sem admins', async () => {
    const app = buildApp()
    await app.ready()
    const token = await registerAndToken(app, 'karla@empresa.com')
    await prisma.user.create({ data: { name: 'Colega', email: 'colega-company@empresa.com', passwordHash: 'x' } })
    await prisma.user.create({ data: { name: 'Admin', email: 'admin-company@empresa.com', passwordHash: 'x', role: 'ADMIN' } })

    const res = await app.inject({ method: 'GET', url: '/users/company', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const emails = res.json().users.map((u: { email: string }) => u.email)
    expect(emails).toContain('colega-company@empresa.com')
    expect(emails).not.toContain('karla@empresa.com')
    expect(emails).not.toContain('admin-company@empresa.com')
    await app.close()
  })

  it('?scope=all traz você mesmo e os admins — quem cadastra projeto precisa se achar', async () => {
    const app = buildApp()
    await app.ready()
    const token = await registerAndToken(app, 'karla@empresa.com')
    await prisma.user.create({ data: { name: 'Admin', email: 'admin-company-all@empresa.com', passwordHash: 'x', role: 'ADMIN' } })
    await prisma.user.create({
      data: { name: 'Desligada', email: 'inativa-company@empresa.com', passwordHash: 'x', active: false },
    })

    const res = await app.inject({
      method: 'GET',
      url: '/users/company?scope=all',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const emails = res.json().users.map((u: { email: string }) => u.email)
    expect(emails).toContain('karla@empresa.com')
    expect(emails).toContain('admin-company-all@empresa.com')
    // Inativo continua fora: o que ?scope=all derruba é regra de feedback, não o cadastro.
    expect(emails).not.toContain('inativa-company@empresa.com')
    await app.close()
  })

  it('THIRD_PARTY: nem com ?scope=all sai do próprio setor', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await prisma.user.create({
      data: { name: 'Admin', email: 'admin-company-tp@empresa.com', passwordHash: 'x', role: 'ADMIN' },
    })
    const sectorB = await createSector({ name: 'Setor Company TP', enabledFeatures: [], roles: [] }, admin.id, DEFAULT_COMPANY_ID)
    await prisma.user.create({
      data: { name: 'De Outro Setor', email: 'outro-setor-company@empresa.com', passwordHash: 'x', sectorId: sectorB.id },
    })
    const thirdParty = await prisma.user.create({
      data: { name: 'Terceirizado', email: 'terceirizado-company@empresa.com', passwordHash: 'x', role: 'THIRD_PARTY' },
    })
    const token = signAccessToken(app, thirdParty, [])

    const res = await app.inject({
      method: 'GET',
      url: '/users/company?scope=all',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const emails = res.json().users.map((u: { email: string }) => u.email)
    expect(emails).not.toContain('outro-setor-company@empresa.com')
    await app.close()
  })
})

describe('GET /users/showcase', () => {
  it('lista os devs com o total de feedbacks recebidos e os selos, do maior para o menor', async () => {
    const app = buildApp()
    await app.ready()
    const token = await registerAndToken(app, 'ana@empresa.com')
    const voter = await prisma.user.findUniqueOrThrow({ where: { email: 'ana@empresa.com' } })
    const top = await prisma.user.create({ data: { name: 'Top Dev', email: 'top@empresa.com', passwordHash: 'x' } })
    const quiet = await prisma.user.create({ data: { name: 'Quiet Dev', email: 'quiet@empresa.com', passwordHash: 'x' } })
    const cat = await prisma.recognitionCategory.create({ data: { name: 'Colaboração', slug: 'colaboracao' } })
    const period = await prisma.votingPeriod.create({ data: { monthRef: '2026-06', startsAt: new Date('2026-06-01'), endsAt: new Date('2026-06-30'), status: 'CLOSED', highlightStatus: 'PUBLISHED' } })
    await prisma.vote.create({ data: { voterId: voter.id, votedId: top.id, periodId: period.id, justification: 'reconhecimento de teste', categories: { create: [{ categoryId: cat.id }] } } })
    // Destaque publicado: é o que transforma o voto no feedback que a galeria conta.
    await materializeVoteFeedbacks(period.id)
    const badge = await prisma.badge.create({ data: { name: 'Reconhecido', slug: 'reconhecido', description: 'd', kind: 'IMPACT', iconKey: 'star', threshold: 1 } })
    await prisma.userBadge.create({ data: { userId: top.id, badgeId: badge.id } })

    const res = await app.inject({ method: 'GET', url: '/users/showcase', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const entries = res.json().entries as Array<{ user: { name: string }; feedbacksReceived: number; badges: unknown[] }>
    expect(entries[0].user.name).toBe('Top Dev')
    expect(entries[0].feedbacksReceived).toBe(1)
    expect(entries[0].badges).toHaveLength(1)
    const quietEntry = entries.find((e) => e.user.name === 'Quiet Dev')
    expect(quietEntry?.feedbacksReceived).toBe(0)
    await app.close()
  })

  it('mostra selos de tempo de casa de veteranos sem precisar abrir o perfil', async () => {
    const app = buildApp()
    await app.ready()
    const token = await registerAndToken(app, 'ana@empresa.com')
    const veterano = await prisma.user.create({
      data: { name: 'Veterano', email: 'veterano@empresa.com', passwordHash: 'x', joinedAt: new Date('2023-01-01') },
    })
    await prisma.badge.create({
      data: { slug: 'tempo-de-casa-1-ano', name: '1 ano de casa', description: '1 ano', kind: 'TENURE', iconKey: 'fe-medal-bronze', threshold: 1 },
    })

    const res = await app.inject({ method: 'GET', url: '/users/showcase', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const entries = res.json().entries as Array<{ user: { id: string }; badges: Array<{ badge: { slug: string } }> }>
    const vetEntry = entries.find((e) => e.user.id === veterano.id)
    expect(vetEntry?.badges.map((b) => b.badge.slug)).toContain('tempo-de-casa-1-ano')
    await app.close()
  })

  it('mostra só a galeria do próprio setor do usuário logado', async () => {
    const app = buildApp()
    await app.ready()
    const token = await registerAndToken(app, 'viewer@empresa.com')
    const actor = await prisma.user.create({ data: { name: 'Admin', email: 'admin-users-showcase@empresa.com', passwordHash: 'x', role: 'ADMIN' } })
    const sectorB = await createSector({ name: 'Setor Showcase B (rota)', enabledFeatures: [], roles: [] }, actor.id, DEFAULT_COMPANY_ID)
    await prisma.user.create({ data: { name: 'De Outro Setor', email: 'outro-setor@empresa.com', passwordHash: 'x', sectorId: sectorB.id } })

    const res = await app.inject({ method: 'GET', url: '/users/showcase', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const entries = res.json().entries as Array<{ user: { name: string } }>
    expect(entries.map((e) => e.user.name)).not.toContain('De Outro Setor')
    await app.close()
  })

  it('?sectorId=<outro> mostra a galeria daquele setor', async () => {
    const app = buildApp()
    await app.ready()
    const token = await registerAndToken(app, 'viewer-cross@empresa.com')
    const actor = await prisma.user.create({ data: { name: 'Admin', email: 'admin-users-showcase-cross@empresa.com', passwordHash: 'x', role: 'ADMIN' } })
    const sectorB = await createSector({ name: 'Setor Showcase C (cross)', enabledFeatures: [], roles: [] }, actor.id, DEFAULT_COMPANY_ID)
    await prisma.user.create({ data: { name: 'Do Outro Setor Cross', email: 'outro-setor-cross@empresa.com', passwordHash: 'x', sectorId: sectorB.id } })

    const res = await app.inject({ method: 'GET', url: `/users/showcase?sectorId=${sectorB.id}`, headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const entries = res.json().entries as Array<{ user: { name: string } }>
    expect(entries.map((e) => e.user.name)).toContain('Do Outro Setor Cross')
    await app.close()
  })

  it('?sectorId=all mostra a galeria de todos os setores', async () => {
    const app = buildApp()
    await app.ready()
    const token = await registerAndToken(app, 'viewer-all@empresa.com')
    const actor = await prisma.user.create({ data: { name: 'Admin', email: 'admin-users-showcase-all@empresa.com', passwordHash: 'x', role: 'ADMIN' } })
    const sectorB = await createSector({ name: 'Setor Showcase D (all)', enabledFeatures: [], roles: [] }, actor.id, DEFAULT_COMPANY_ID)
    await prisma.user.create({ data: { name: 'Do Outro Setor All', email: 'outro-setor-all@empresa.com', passwordHash: 'x', sectorId: sectorB.id } })

    const res = await app.inject({ method: 'GET', url: '/users/showcase?sectorId=all', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const entries = res.json().entries as Array<{ user: { name: string } }>
    expect(entries.map((e) => e.user.name)).toContain('Do Outro Setor All')
    await app.close()
  })

  it('THIRD_PARTY: ?sectorId= é ignorado, sempre vê o próprio setor', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await prisma.user.create({ data: { name: 'Admin', email: 'admin-users-showcase-tp@empresa.com', passwordHash: 'x', role: 'ADMIN' } })
    const sectorB = await createSector({ name: 'Setor Showcase E (tp)', enabledFeatures: ['lendas'], roles: ['THIRD_PARTY'] }, admin.id, DEFAULT_COMPANY_ID)
    await prisma.user.create({ data: { name: 'Do Outro Setor TP', email: 'outro-setor-tp@empresa.com', passwordHash: 'x', sectorId: sectorB.id } })
    const thirdParty = await prisma.user.create({
      data: { name: 'Terceirizado', email: 'terceirizado-showcase@empresa.com', passwordHash: 'x', role: 'THIRD_PARTY', enabledFeatures: ['lendas'] },
    })
    // POST /auth/register sempre cria LEGEND (não dá pra registrar THIRD_PARTY por ali) e
    // /auth/login exige a senha batendo com o hash — geramos o token do mesmo jeito que as
    // rotas fazem, com signAccessToken, sem passar por login HTTP.
    const token = signAccessToken(app, thirdParty, [])

    const res = await app.inject({ method: 'GET', url: `/users/showcase?sectorId=${sectorB.id}`, headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const entries = res.json().entries as Array<{ user: { name: string } }>
    expect(entries.map((e) => e.user.name)).not.toContain('Do Outro Setor TP')
    await app.close()
  })

  it('inclui sectorName correto por entry, inclusive misturando setores com ?sectorId=all', async () => {
    const app = buildApp()
    await app.ready()
    const token = await registerAndToken(app, 'viewer-sectorname@empresa.com')
    const actor = await prisma.user.create({ data: { name: 'Admin', email: 'admin-users-showcase-sectorname@empresa.com', passwordHash: 'x', role: 'ADMIN' } })
    const sectorB = await createSector({ name: 'Setor Showcase F (sectorName)', enabledFeatures: [], roles: [] }, actor.id, DEFAULT_COMPANY_ID)
    await prisma.user.create({ data: { name: 'Do Setor F', email: 'do-setor-f@empresa.com', passwordHash: 'x', sectorId: sectorB.id } })

    const res = await app.inject({ method: 'GET', url: '/users/showcase?sectorId=all', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const entries = res.json().entries as Array<{ user: { name: string; sectorName: string } }>
    const found = entries.find((e) => e.user.name === 'Do Setor F')
    expect(found?.user.sectorName).toBe('Setor Showcase F (sectorName)')
    const viewerEntry = entries.find((e) => e.user.name.startsWith('viewer-sectorname'))
    expect(viewerEntry?.user.sectorName).toBe('Desenvolvimento de Produto')
  })

  it('a vitrine traz o nível de cada pessoa, numa consulta só', async () => {
    const app = buildApp()
    await app.ready()
    const token = await registerAndToken(app, 'vitrine-xp@empresa.com')
    const companyId = DEFAULT_COMPANY_ID
    const lenda = await prisma.user.create({
      data: {
        name: 'Lenda com XP',
        email: `xp-${Math.random()}@empresa.com`,
        passwordHash: 'x',
        role: 'LEGEND',
        companyId,
      },
    })
    await prisma.xpTransaction.create({
      data: {
        userId: lenda.id,
        event: 'VOTE_CAST',
        amount: 600,
        dedupeKey: 'VOTE_CAST:vitrine',
        day: new Date('2026-06-01T00:00:00.000Z'),
        companyId,
      },
    })

    const res = await app.inject({
      method: 'GET',
      url: '/users/showcase?sectorId=all',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.statusCode).toBe(200)
    const entry = res.json().entries.find((e: { user: { id: string } }) => e.user.id === lenda.id)
    expect(entry.xp).toMatchObject({ points: 600, level: { name: 'Prata' } })
    // Quem nunca pontuou vem com zero — é a TELA que decide não afirmar nível.
    const semXp = res.json().entries.find((e: { user: { id: string } }) => e.user.id !== lenda.id)
    if (semXp) expect(semXp.xp.points).toBe(0)
    await app.close()
  })
})

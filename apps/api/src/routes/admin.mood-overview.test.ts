import { describe, it, expect } from 'vitest'
import { DEFAULT_SECTOR_ID, MOOD_ANONYMITY_MIN, type MoodLevel } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import { todayInSaoPaulo } from '../lib/sao-paulo-date'

async function tokenFor(app: ReturnType<typeof buildApp>, email: string, role: string, sectorId = DEFAULT_SECTOR_ID) {
  await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Pessoa', email, password: 'changeme123' } })
  await prisma.user.update({ where: { email }, data: { role: role as never, sectorId } })
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'changeme123' } })
  return res.json().accessToken as string
}

let seq = 0

/** Registros de hoje (dia civil de SP), um por pessoa, no setor informado. */
async function seedToday(moods: MoodLevel[], sectorId = DEFAULT_SECTOR_ID, note?: string) {
  const { day } = todayInSaoPaulo()
  for (const mood of moods) {
    seq += 1
    const user = await prisma.user.create({
      data: { name: `Pessoa ${seq}`, email: `overview-${seq}@x.com`, passwordHash: 'x', sectorId },
    })
    await prisma.moodEntry.create({ data: { userId: user.id, day, mood, note: note ?? null, reason: 'WORKLOAD' } })
  }
}

const ENOUGH: MoodLevel[] = Array(MOOD_ANONYMITY_MIN).fill('LOW')

describe('GET /admin/mood/overview', () => {
  it('devolve o painel agregado para o ADMIN', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'admin-clima@empresa.com', 'ADMIN')
    await seedToday(ENOUGH)

    const res = await app.inject({
      method: 'GET',
      url: '/admin/mood/overview?days=30',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.statusCode).toBe(200)
    const { overview } = res.json()
    expect(overview.days).toBe(30)
    expect(overview.trend).toHaveLength(30)
    expect(overview.totalEntries).toBe(MOOD_ANONYMITY_MIN)
    expect(overview.weekAverage).toBe(2)
    await app.close()
  })

  it('os comentários vêm com autor; os agregados seguem anônimos', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'admin-anon@empresa.com', 'ADMIN')
    await seedToday(ENOUGH, DEFAULT_SECTOR_ID, 'time sobrecarregado')

    const res = await app.inject({
      method: 'GET',
      url: '/admin/mood/overview',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.statusCode).toBe(200)
    const overview = res.json().overview
    expect(overview.comments.length).toBe(MOOD_ANONYMITY_MIN)
    // A G&G pediu identificação para conseguir agir sobre o que lê (Documento 3,
    // seção 4.6) — e a copy do colaborador deixou de prometer confidencialidade
    // junto com esta mudança. Este teste afirmava o contrário até então.
    for (const comment of overview.comments) {
      expect(comment.author.id).toBeTruthy()
      expect(comment.author.name).toBeTruthy()
    }
    // O que NÃO mudou: agregado nenhum carrega pessoa. Média, tendência e
    // distribuição continuam sendo do recorte, não de quem respondeu.
    for (const point of overview.trend) expect(point).not.toHaveProperty('userId')
    for (const slice of overview.todayDistribution) expect(slice).not.toHaveProperty('userId')
    // O autor é um `PublicUser` inteiro, e-mail incluído — é o mesmo DTO que o
    // feed, o perfil e o ranking já entregam a qualquer pessoa logada, então
    // identificar o comentário não abre nada que o produto já não mostrasse. O
    // que restringe aqui é a porta: o painel é do bloco de Gente e Gestão.
    await app.close()
  })

  it('403 para quem não é admin nem subadmin', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'legend-clima@empresa.com', 'LEGEND')

    const res = await app.inject({
      method: 'GET',
      url: '/admin/mood/overview',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('401 sem token', async () => {
    const app = buildApp()
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/admin/mood/overview' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('SUBADMIN só enxerga o próprio setor e é barrado ao pedir outro', async () => {
    const app = buildApp()
    await app.ready()
    // O painel de clima é área de Gente e Gestão: o subadmin precisa estar no
    // setor com a feature ligada, senão nem chega no recorte por setor (403).
    const gente = await prisma.sector.create({
      data: { name: 'Gente e Gestão', slug: 'gente-overview', enabledFeatures: ['gente-gestao'] },
    })
    const outro = await prisma.sector.create({ data: { name: 'Outro', slug: 'outro-overview' } })
    const token = await tokenFor(app, 'subadmin-clima@empresa.com', 'SUBADMIN', gente.id)
    await seedToday(ENOUGH, gente.id)
    await seedToday(['HARD', 'HARD', 'HARD', 'HARD'], outro.id)

    const own = await app.inject({
      method: 'GET',
      url: '/admin/mood/overview',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(own.statusCode).toBe(200)
    expect(own.json().overview.sectorId).toBe(gente.id)
    expect(own.json().overview.totalEntries).toBe(MOOD_ANONYMITY_MIN)

    const alheio = await app.inject({
      method: 'GET',
      url: `/admin/mood/overview?sectorId=${outro.id}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(alheio.statusCode).toBe(403)
    await app.close()
  })

  it('days fora da faixa permitida retorna 400', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'admin-days@empresa.com', 'ADMIN')

    const res = await app.inject({
      method: 'GET',
      url: '/admin/mood/overview?days=365',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().message).toBe('Dados inválidos')
    await app.close()
  })
})

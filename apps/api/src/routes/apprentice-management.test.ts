import { beforeEach, describe, expect, it } from 'vitest'
import { APPRENTICE_POSITION_CATEGORY } from '@legends/shared'
import { buildApp } from '../app'
import { signAccessToken } from '../lib/jwt'
import { prisma } from '../lib/prisma'

/** Fase 2 da trilha: jornada, movimentações de setor e quadro de gestão do RH. */

let app: Awaited<ReturnType<typeof buildApp>>

beforeEach(async () => {
  app = buildApp()
  await app.ready()
})

async function criarUsuario(
  email: string,
  overrides: Partial<Parameters<typeof prisma.user.create>[0]['data']> = {},
) {
  return prisma.user.create({
    data: {
      name: 'Aprendiz de Tal',
      email,
      passwordHash: 'x',
      positionCategory: APPRENTICE_POSITION_CATEGORY,
      ...overrides,
    } as Parameters<typeof prisma.user.create>[0]['data'],
  })
}

function authOf(user: Awaited<ReturnType<typeof criarUsuario>>, features: string[] = []) {
  return { authorization: `Bearer ${signAccessToken(app, user, features)}` }
}

async function admin() {
  return criarUsuario('admin@empresa.com', { role: 'ADMIN', positionCategory: 'Head' })
}

describe('jornada do aprendiz', () => {
  it('lê setor, líder e admissão do CADASTRO, e não de um cadastro próprio', async () => {
    const chefe = await criarUsuario('lider@empresa.com', { name: 'Líder Lima', positionCategory: 'Head' })
    await criarUsuario('aprendiz@empresa.com', {
      name: 'Aprendiz Um',
      managerId: chefe.id,
      squad: 'Squad Alfa',
      joinedAt: new Date('2026-01-10T00:00:00.000Z'),
    })
    const gestor = await admin()

    const res = await app.inject({
      method: 'GET',
      url: '/admin/apprentice/journeys',
      headers: authOf(gestor),
    })
    expect(res.statusCode).toBe(200)
    const journey = res.json().find((row: { person: { name: string } }) => row.person.name === 'Aprendiz Um')
    expect(journey.leaderName).toBe('Líder Lima')
    expect(journey.squad).toBe('Squad Alfa')
    expect(journey.joinedOn).toBe('2026-01-10')
    // O que é do módulo nasce vazio.
    expect(journey.contractEndsOn).toBeNull()
    expect(journey.activities).toBe('')
  })

  it('grava só o que é do módulo: fim de contrato e atividades', async () => {
    const pessoa = await criarUsuario('aprendiz@empresa.com')
    const gestor = await admin()

    const res = await app.inject({
      method: 'PUT',
      url: `/admin/apprentice/journeys/${pessoa.id}`,
      headers: authOf(gestor),
      payload: { contractEndsOn: '2027-06-30', activities: 'Atender o balcão\nConferir notas' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      contractEndsOn: '2027-06-30',
      activities: 'Atender o balcão\nConferir notas',
    })
  })

  it('a elegibilidade conta da última mudança, não da admissão', async () => {
    const pessoa = await criarUsuario('aprendiz@empresa.com', {
      joinedAt: new Date('2024-01-01T00:00:00.000Z'),
    })
    const gestor = await admin()

    const antes = await app.inject({
      method: 'GET',
      url: '/admin/apprentice/journeys',
      headers: authOf(gestor),
    })
    expect(antes.json()[0].eligibleForSectorChange).toBe(true)

    const hoje = new Date().toISOString().slice(0, 10)
    await app.inject({
      method: 'POST',
      url: '/admin/apprentice/sector-moves',
      headers: authOf(gestor),
      payload: { userId: pessoa.id, toSector: 'Marketing', movedOn: hoje, reason: 'Rodízio' },
    })

    const depois = await app.inject({
      method: 'GET',
      url: '/admin/apprentice/journeys',
      headers: authOf(gestor),
    })
    const journey = depois.json()[0]
    expect(journey.eligibleForSectorChange).toBe(false)
    expect(journey.monthsInCurrentSector).toBe(0)
    expect(journey.inSectorSince).toBe(hoje)
    expect(journey.moves).toHaveLength(1)
    expect(journey.moves[0]).toMatchObject({ toSector: 'Marketing', reason: 'Rodízio' })
  })

  it('registra a mudança mesmo sem elegibilidade — o histórico é o fato, não a regra', async () => {
    const pessoa = await criarUsuario('aprendiz@empresa.com', { joinedAt: new Date() })
    const gestor = await admin()

    const res = await app.inject({
      method: 'POST',
      url: '/admin/apprentice/sector-moves',
      headers: authOf(gestor),
      payload: {
        userId: pessoa.id,
        toSector: 'Financeiro',
        movedOn: new Date().toISOString().slice(0, 10),
      },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().moves).toHaveLength(1)
  })

  it('só o facilitador entra: aprendiz leva 403', async () => {
    const pessoa = await criarUsuario('aprendiz@empresa.com')
    const res = await app.inject({
      method: 'GET',
      url: '/admin/apprentice/journeys',
      headers: authOf(pessoa),
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('quadro de gestão', () => {
  it('cria a tarefa com checklist e ela nasce em "A fazer"', async () => {
    const gestor = await admin()
    const res = await app.inject({
      method: 'POST',
      url: '/admin/apprentice/tasks',
      headers: authOf(gestor),
      payload: {
        title: 'Reservar a sala do Encontro 2',
        category: 'Logística',
        items: ['Confirmar sala', 'Imprimir materiais'],
      },
    })
    expect(res.statusCode).toBe(201)
    const task = res.json()[0]
    expect(task).toMatchObject({ boardColumn: 'AFAZER', category: 'Logística' })
    expect(task.items).toHaveLength(2)
  })

  it('recusa categoria fora do catálogo', async () => {
    const gestor = await admin()
    const res = await app.inject({
      method: 'POST',
      url: '/admin/apprentice/tasks',
      headers: authOf(gestor),
      payload: { title: 'Tarefa', category: 'Inventada' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('mover de coluna e marcar item do checklist', async () => {
    const gestor = await admin()
    const criada = await app.inject({
      method: 'POST',
      url: '/admin/apprentice/tasks',
      headers: authOf(gestor),
      payload: { title: 'Alinhar com o gestor', items: ['Marcar conversa'] },
    })
    const task = criada.json()[0]

    const movida = await app.inject({
      method: 'PATCH',
      url: `/admin/apprentice/tasks/${task.id}`,
      headers: authOf(gestor),
      payload: { boardColumn: 'CONCLUIDO' },
    })
    expect(movida.json()[0].boardColumn).toBe('CONCLUIDO')

    const marcada = await app.inject({
      method: 'PUT',
      url: `/admin/apprentice/task-items/${task.items[0].id}`,
      headers: authOf(gestor),
      payload: { done: true },
    })
    expect(marcada.json()[0].items[0].done).toBe(true)
  })

  it('atrasada é a pendente com prazo vencido; concluída nunca está', async () => {
    const gestor = await admin()
    // Data claramente no passado, e não "ontem" calculado em UTC: o servidor
    // compara pelo dia civil de São Paulo, e à noite os dois não coincidem.
    const vencido = '2020-01-01'

    const criada = await app.inject({
      method: 'POST',
      url: '/admin/apprentice/tasks',
      headers: authOf(gestor),
      payload: { title: 'Vencida', dueOn: vencido },
    })
    expect(criada.json()[0].overdue).toBe(true)

    const concluida = await app.inject({
      method: 'PATCH',
      url: `/admin/apprentice/tasks/${criada.json()[0].id}`,
      headers: authOf(gestor),
      payload: { boardColumn: 'CONCLUIDO' },
    })
    expect(concluida.json()[0].overdue).toBe(false)
  })

  it('o quadro é do facilitador: aprendiz leva 403', async () => {
    const pessoa = await criarUsuario('aprendiz@empresa.com')
    const res = await app.inject({
      method: 'GET',
      url: '/admin/apprentice/tasks',
      headers: authOf(pessoa),
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('material do encontro', () => {
  async function criarEncontro() {
    return prisma.apprenticeMeeting.create({
      data: { order: 1, title: 'Encontro 1', accessReleased: true },
    })
  }

  it('aceita link, e recusa link e arquivo juntos', async () => {
    const gestor = await admin()
    const encontro = await criarEncontro()

    const comLink = await app.inject({
      method: 'POST',
      url: `/admin/apprentice/meetings/${encontro.id}/materials`,
      headers: authOf(gestor),
      payload: { name: 'Guia', url: 'https://exemplo.com/guia.pdf' },
    })
    expect(comLink.statusCode).toBe(201)

    const ambos = await app.inject({
      method: 'POST',
      url: `/admin/apprentice/meetings/${encontro.id}/materials`,
      headers: authOf(gestor),
      payload: {
        name: 'Guia',
        url: 'https://exemplo.com/guia.pdf',
        documentKey: 'apprentice-materials/company-emr/abc.pdf',
      },
    })
    expect(ambos.statusCode).toBe(400)
  })

  it('recusa chave de arquivo de outra empresa', async () => {
    const gestor = await admin()
    const encontro = await criarEncontro()

    const res = await app.inject({
      method: 'POST',
      url: `/admin/apprentice/meetings/${encontro.id}/materials`,
      headers: authOf(gestor),
      payload: { name: 'Guia', documentKey: 'apprentice-materials/outra-empresa/abc.pdf' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('material sem link nem arquivo não entra', async () => {
    const gestor = await admin()
    const encontro = await criarEncontro()

    const res = await app.inject({
      method: 'POST',
      url: `/admin/apprentice/meetings/${encontro.id}/materials`,
      headers: authOf(gestor),
      payload: { name: 'Só o nome' },
    })
    expect(res.statusCode).toBe(400)
  })
})

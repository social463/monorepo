import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { createActionItem, createSeries, getMeeting, listMeetings, updateActionItem } from './one-on-one-service'

async function makeUser(name: string) {
  return prisma.user.create({
    data: { name, email: `${name.toLowerCase()}@empresa.com`, passwordHash: 'x', companyId: DEFAULT_COMPANY_ID },
  })
}
const viewerOf = (user: { id: string }) => ({ userId: user.id, companyId: DEFAULT_COMPANY_ID })

async function umaSerieSemanal() {
  const ana = await makeUser('Ana')
  const bruno = await makeUser('Bruno')
  const { meetings } = await createSeries(viewerOf(ana), {
    counterpartId: bruno.id,
    date: '2026-08-10',
    startTime: '10:00',
    durationMinutes: 30,
    recurrence: 'WEEKLY',
    recurrenceCount: 3,
  })
  return { ana, bruno, meetings }
}

describe('one-on-one — ações', () => {
  it('ação aberta no primeiro encontro reaparece no encontro seguinte', async () => {
    const { ana, bruno, meetings } = await umaSerieSemanal()
    await createActionItem(viewerOf(ana), meetings[0].id, {
      description: 'Levantar escopo do projeto X',
      ownerId: bruno.id,
      dueDate: null,
    })

    const segundo = await getMeeting(viewerOf(bruno), meetings[1].id)
    expect(segundo.openActions).toHaveLength(1)
    expect(segundo.openActions[0].owner.id).toBe(bruno.id)
  })

  it('ação concluída some dos pendentes e fica no encontro onde nasceu', async () => {
    const { ana, bruno, meetings } = await umaSerieSemanal()
    const acao = await createActionItem(viewerOf(ana), meetings[0].id, {
      description: 'Levantar escopo',
      ownerId: bruno.id,
      dueDate: null,
    })

    // Quem conclui pode ser qualquer um dos dois — o combinado é dos dois.
    const concluida = await updateActionItem(viewerOf(ana), acao.id, { status: 'DONE' })
    expect(concluida.completedById).toBe(ana.id)
    expect(concluida.completedAt).not.toBeNull()

    const segundo = await getMeeting(viewerOf(bruno), meetings[1].id)
    expect(segundo.openActions).toEqual([])

    const primeiro = await getMeeting(viewerOf(bruno), meetings[0].id)
    expect(primeiro.closedActions).toHaveLength(1)
  })

  it('reabrir limpa quem concluiu e quando', async () => {
    const { ana, bruno, meetings } = await umaSerieSemanal()
    const acao = await createActionItem(viewerOf(ana), meetings[0].id, {
      description: 'Levantar escopo',
      ownerId: bruno.id,
      dueDate: null,
    })
    await updateActionItem(viewerOf(ana), acao.id, { status: 'DONE' })

    const reaberta = await updateActionItem(viewerOf(bruno), acao.id, { status: 'OPEN' })
    expect(reaberta.status).toBe('OPEN')
    expect(reaberta.completedById).toBeNull()
    expect(reaberta.completedAt).toBeNull()
  })

  it('recusa dono que não é do par', async () => {
    const { ana, meetings } = await umaSerieSemanal()
    const carla = await makeUser('Carla')

    await expect(
      createActionItem(viewerOf(ana), meetings[0].id, {
        description: 'Tarefa da Carla',
        ownerId: carla.id,
        dueDate: null,
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('terceiro não cria nem mexe em ação', async () => {
    const { ana, bruno, meetings } = await umaSerieSemanal()
    const carla = await makeUser('Carla')
    const acao = await createActionItem(viewerOf(ana), meetings[0].id, {
      description: 'Levantar escopo',
      ownerId: bruno.id,
      dueDate: null,
    })

    await expect(updateActionItem(viewerOf(carla), acao.id, { status: 'DONE' })).rejects.toMatchObject({ status: 404 })
  })

  it('notifica a outra pessoa quando o 1:1 é marcado (e não quem marcou)', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')

    await createSeries(viewerOf(ana), {
      counterpartId: bruno.id,
      date: '2026-08-10',
      startTime: '10:00',
      durationMinutes: 30,
      recurrence: 'WEEKLY',
      recurrenceCount: 3,
    })

    // Uma notificação por SÉRIE, não por ocorrência: três encontros marcados de
    // uma vez não viram três avisos.
    expect(await prisma.notification.count({ where: { userId: bruno.id, type: 'ONE_ON_ONE_INVITED' } })).toBe(1)
    expect(await prisma.notification.count({ where: { userId: ana.id, type: 'ONE_ON_ONE_INVITED' } })).toBe(0)
  })

  it('notifica quem virou dono da ação (e não notifica quem criou para si)', async () => {
    const { ana, bruno, meetings } = await umaSerieSemanal()
    await createActionItem(viewerOf(ana), meetings[0].id, {
      description: 'Levantar escopo',
      ownerId: bruno.id,
      dueDate: null,
    })
    await createActionItem(viewerOf(ana), meetings[0].id, {
      description: 'Minha própria tarefa',
      ownerId: ana.id,
      dueDate: null,
    })

    expect(await prisma.notification.count({ where: { userId: bruno.id, type: 'ONE_ON_ONE_ACTION_ASSIGNED' } })).toBe(1)
    expect(await prisma.notification.count({ where: { userId: ana.id, type: 'ONE_ON_ONE_ACTION_ASSIGNED' } })).toBe(0)
  })
})

/**
 * A ação pendente pertence ao PAR, não à série: qualquer encontro entre as duas
 * pessoas a enxerga, inclusive se a série for encerrada e outra começar depois
 * (spec `2026-08-05-um-a-um-design.md`, "Modelo de dados"). É para isso que o
 * par é guardado normalizado e existe o índice `[companyId, userAId, userBId]`.
 */
describe('one-on-one — carryover é do par, não da série', () => {
  async function serieAvulsa(quem: { id: string }, comQuem: { id: string }, date: string) {
    const { seriesId, meetings } = await createSeries(viewerOf(quem), {
      counterpartId: comQuem.id,
      date,
      startTime: '10:00',
      durationMinutes: 30,
      recurrence: 'NONE',
    })
    return { seriesId, meeting: meetings[0] }
  }

  it('ação aberta na primeira série aparece num encontro de OUTRA série do mesmo par', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    const antiga = await serieAvulsa(ana, bruno, '2026-08-10')
    const nova = await serieAvulsa(bruno, ana, '2026-09-14')

    await createActionItem(viewerOf(ana), antiga.meeting.id, {
      description: 'Combinado que sobreviveu à série antiga',
      ownerId: bruno.id,
      dueDate: null,
    })

    const detalhe = await getMeeting(viewerOf(bruno), nova.meeting.id)
    expect(detalhe.openActions.map((a) => a.description)).toEqual(['Combinado que sobreviveu à série antiga'])
    // O contador do resumo conta a mesma coisa que a lista.
    expect(detalhe.openActionCount).toBe(1)
    // Mas ela nasceu na outra série: não entra no histórico DESTE encontro.
    expect(detalhe.closedActions).toEqual([])
  })

  it('não vaza para um par diferente que compartilha uma das pessoas', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    const carla = await makeUser('Carla')
    const comBruno = await serieAvulsa(ana, bruno, '2026-08-10')
    const comCarla = await serieAvulsa(ana, carla, '2026-08-11')

    await createActionItem(viewerOf(ana), comBruno.meeting.id, {
      description: 'Coisa do par Ana↔Bruno',
      ownerId: ana.id,
      dueDate: null,
    })

    const outroPar = await getMeeting(viewerOf(ana), comCarla.meeting.id)
    expect(outroPar.openActions).toEqual([])
    expect(outroPar.openActionCount).toBe(0)
  })

  it('listMeetings conta as pendentes do par em cada encontro, some a série que for', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    const carla = await makeUser('Carla')
    const antiga = await serieAvulsa(ana, bruno, '2026-08-10')
    await serieAvulsa(bruno, ana, '2026-08-20')
    await serieAvulsa(ana, carla, '2026-08-25')

    await createActionItem(viewerOf(ana), antiga.meeting.id, {
      description: 'Pendência do par Ana↔Bruno',
      ownerId: bruno.id,
      dueDate: null,
    })

    const agenda = await listMeetings(viewerOf(ana), '2026-08-01', '2026-08-31')
    const porContraparte = new Map(agenda.map((m) => [`${m.counterpart.id}-${m.startsAt.slice(0, 10)}`, m]))

    expect(porContraparte.get(`${bruno.id}-2026-08-10`)?.openActionCount).toBe(1)
    // Encontro de outra SÉRIE do mesmo par: mesma pendência.
    expect(porContraparte.get(`${bruno.id}-2026-08-20`)?.openActionCount).toBe(1)
    // Outro par: zero.
    expect(porContraparte.get(`${carla.id}-2026-08-25`)?.openActionCount).toBe(0)
  })
})

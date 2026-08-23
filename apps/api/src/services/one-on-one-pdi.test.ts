import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import {
  createActionItem,
  createSeries,
  getMeeting,
  promoteActionToPdi,
  updateActionItem,
} from './one-on-one-service'

async function makeUser(name: string, role: 'LEGEND' | 'LEAD' = 'LEGEND') {
  return prisma.user.create({
    data: { name, email: `${name.toLowerCase()}@empresa.com`, passwordHash: 'x', role, companyId: DEFAULT_COMPANY_ID },
  })
}
const viewerOf = (user: { id: string }) => ({ userId: user.id, companyId: DEFAULT_COMPANY_ID })

async function parComPlano() {
  const liderado = await makeUser('Ana')
  const lider = await makeUser('Bruno', 'LEAD')
  const plan = await prisma.pdiPlan.create({
    data: {
      userId: liderado.id,
      leaderId: lider.id,
      title: 'Ciclo 2026',
      status: 'IN_PROGRESS',
      companyId: DEFAULT_COMPANY_ID,
    },
  })
  const { meetings } = await createSeries(viewerOf(lider), {
    counterpartId: liderado.id,
    date: '2026-08-10',
    startTime: '10:00',
    durationMinutes: 30,
    recurrence: 'NONE',
  })
  return { liderado, lider, plan, meetingId: meetings[0].id }
}

describe('one-on-one — bloco de PDI', () => {
  it('aparece para os dois quando existe plano do liderado com o outro como líder', async () => {
    const { liderado, lider, plan, meetingId } = await parComPlano()

    const visaoLider = await getMeeting(viewerOf(lider), meetingId)
    const visaoLiderado = await getMeeting(viewerOf(liderado), meetingId)

    expect(visaoLider.pdi?.planId).toBe(plan.id)
    expect(visaoLiderado.pdi?.planId).toBe(plan.id)
  })

  it('só o dono do plano pode promover', async () => {
    const { liderado, lider, meetingId } = await parComPlano()

    expect((await getMeeting(viewerOf(liderado), meetingId)).pdi?.canPromote).toBe(true)
    expect((await getMeeting(viewerOf(lider), meetingId)).pdi?.canPromote).toBe(false)
  })

  it('não aparece quando o par não tem relação de plano', async () => {
    const ana = await makeUser('Ana')
    const carla = await makeUser('Carla')
    const { meetings } = await createSeries(viewerOf(ana), {
      counterpartId: carla.id,
      date: '2026-08-10',
      startTime: '10:00',
      durationMinutes: 30,
      recurrence: 'NONE',
    })

    expect((await getMeeting(viewerOf(ana), meetings[0].id)).pdi).toBeNull()
  })
})

describe('one-on-one — promoção ao PDI', () => {
  it('o dono do plano promove: nasce PdiAction e a ação sai dos pendentes', async () => {
    const { liderado, lider, plan, meetingId } = await parComPlano()
    const acao = await createActionItem(viewerOf(lider), meetingId, {
      description: 'Fazer curso de liderança',
      ownerId: liderado.id,
      dueDate: '2026-09-30T00:00:00.000Z',
    })

    const promovida = await promoteActionToPdi(viewerOf(liderado), acao.id)

    expect(promovida.status).toBe('PROMOTED')
    expect(promovida.pdiActionId).not.toBeNull()

    const pdiAction = await prisma.pdiAction.findUniqueOrThrow({ where: { id: promovida.pdiActionId! } })
    expect(pdiAction.planId).toBe(plan.id)
    expect(pdiAction.description).toBe('Fazer curso de liderança')
    expect(pdiAction.type).toBe('OTHER')
    expect(pdiAction.priority).toBe('MEDIUM')
    expect(pdiAction.dueDate?.toISOString().slice(0, 10)).toBe('2026-09-30')

    const detalhe = await getMeeting(viewerOf(liderado), meetingId)
    expect(detalhe.openActions).toEqual([])
    expect(detalhe.closedActions[0].pdiActionId).toBe(pdiAction.id)
  })

  it('o líder não promove no plano do outro', async () => {
    const { liderado, lider, meetingId } = await parComPlano()
    const acao = await createActionItem(viewerOf(lider), meetingId, {
      description: 'Fazer curso',
      ownerId: liderado.id,
      dueDate: null,
    })

    await expect(promoteActionToPdi(viewerOf(lider), acao.id)).rejects.toMatchObject({ status: 403 })
  })

  it('sem plano ativo, explica em vez de estourar', async () => {
    const ana = await makeUser('Ana')
    const carla = await makeUser('Carla')
    const { meetings } = await createSeries(viewerOf(ana), {
      counterpartId: carla.id,
      date: '2026-08-10',
      startTime: '10:00',
      durationMinutes: 30,
      recurrence: 'NONE',
    })
    const acao = await createActionItem(viewerOf(ana), meetings[0].id, {
      description: 'Estudar',
      ownerId: ana.id,
      dueDate: null,
    })

    await expect(promoteActionToPdi(viewerOf(ana), acao.id)).rejects.toMatchObject({ status: 400 })
  })

  it('promover duas vezes não duplica a ação de PDI', async () => {
    const { liderado, lider, meetingId } = await parComPlano()
    const acao = await createActionItem(viewerOf(lider), meetingId, {
      description: 'Curso',
      ownerId: liderado.id,
      dueDate: null,
    })
    await promoteActionToPdi(viewerOf(liderado), acao.id)

    await expect(promoteActionToPdi(viewerOf(liderado), acao.id)).rejects.toMatchObject({ status: 409 })
    expect(await prisma.pdiAction.count()).toBe(1)
  })
})

/**
 * A promoção escreve no plano do viewer, mas o plano precisa ser o DO PAR — o
 * mesmo que faz o bloco de PDI existir no DTO. Sem isso, o DTO devolvia
 * `pdi: null` (a UI nem mostrava o botão) e um POST direto no endpoint jogava
 * a ação combinada com Bruno no plano que Ana tem com a Carla: conteúdo de 1:1
 * escapando da conversa, pela única rota por onde isso era possível.
 */
describe('one-on-one — promoção exige plano DO PAR', () => {
  it('recusa promover num 1:1 sem relação de plano, mesmo com plano ativo com outra pessoa', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    const carla = await makeUser('Carla', 'LEAD')
    // Plano da Ana, mas com a Carla como líder — nada a ver com o 1:1 do Bruno.
    await prisma.pdiPlan.create({
      data: {
        userId: ana.id,
        leaderId: carla.id,
        title: 'Ciclo com a Carla',
        status: 'IN_PROGRESS',
        companyId: DEFAULT_COMPANY_ID,
      },
    })
    const { meetings } = await createSeries(viewerOf(ana), {
      counterpartId: bruno.id,
      date: '2026-08-10',
      startTime: '10:00',
      durationMinutes: 30,
      recurrence: 'NONE',
    })
    const acao = await createActionItem(viewerOf(ana), meetings[0].id, {
      description: 'Combinado com o Bruno',
      ownerId: ana.id,
      dueDate: null,
    })

    // O DTO já dizia que não dá (sem bloco de PDI); o endpoint agora concorda.
    expect((await getMeeting(viewerOf(ana), meetings[0].id)).pdi).toBeNull()
    await expect(promoteActionToPdi(viewerOf(ana), acao.id)).rejects.toMatchObject({ status: 400 })
    expect(await prisma.pdiAction.count()).toBe(0)
  })

  it('recusa promover uma ação já concluída', async () => {
    const { liderado, lider, meetingId } = await parComPlano()
    const acao = await createActionItem(viewerOf(lider), meetingId, {
      description: 'Curso',
      ownerId: liderado.id,
      dueDate: null,
    })
    await updateActionItem(viewerOf(liderado), acao.id, { status: 'DONE' })

    await expect(promoteActionToPdi(viewerOf(liderado), acao.id)).rejects.toMatchObject({ status: 409 })
    expect(await prisma.pdiAction.count()).toBe(0)
  })
})

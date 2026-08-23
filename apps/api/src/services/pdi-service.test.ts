import { beforeEach, describe, expect, it } from 'vitest'
import type { UserRole } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { PDI_LEADER_APPROVAL_KEY } from './development-settings-service'
import {
  PdiError,
  canSeeShowcase,
  completeAction,
  createAction,
  createPlan,
  getPlan,
  getShowcase,
  listActionHistory,
  listEligibleLeaders,
  listPendingReviews,
  reviewAction,
  updateAction,
  updateShowcaseVisibility,
} from './pdi-service'

const COMPANY = 'company-emr'

async function makeUser(email: string, name: string, sectorId?: string, role: UserRole = 'LEGEND') {
  const user = await prisma.user.create({
    data: { name, email, passwordHash: 'x', role, ...(sectorId ? { sectorId } : {}) },
  })
  return { userId: user.id, companyId: COMPANY, row: user }
}

async function setLeaderApproval(required: boolean) {
  await prisma.appSetting.upsert({
    where: { key_companyId: { key: PDI_LEADER_APPROVAL_KEY, companyId: COMPANY } },
    create: { key: PDI_LEADER_APPROVAL_KEY, companyId: COMPANY, value: String(required) },
    update: { value: String(required) },
  })
}

const COMPLETION = {
  practicalApplication: 'Apliquei o combinado do 1:1 na rotina do time e registrei em ata.',
  reflection: { mainLearning: 'Feedback precisa de fato, não de rótulo.' },
  evidences: [{ kind: 'COMPLETION' as const, externalUrl: 'https://exemplo.com/certificado' }],
}

describe('pdi-service', () => {
  let owner: Awaited<ReturnType<typeof makeUser>>
  let leader: Awaited<ReturnType<typeof makeUser>>
  let stranger: Awaited<ReturnType<typeof makeUser>>

  beforeEach(async () => {
    owner = await makeUser('dona@empresa.com', 'Dona do plano')
    leader = await makeUser('lider@empresa.com', 'Líder', undefined, 'LEAD')
    stranger = await makeUser('outra@empresa.com', 'Outra pessoa')
  })

  async function planWithAction(leaderId: string | null = leader.userId) {
    const plan = await createPlan(owner, { title: 'PDI 2026-Q1', leaderId, cyclePeriod: '2026-Q1' })
    const action = await createAction(owner, plan.id, {
      description: 'Concluir o curso de liderança',
      type: 'COURSE',
      priority: 'HIGH',
    })
    return { plan, action }
  }

  it('uma pessoa não lê nem edita o PDI de outra', async () => {
    const { plan, action } = await planWithAction()

    await expect(getPlan(stranger, plan.id)).rejects.toMatchObject({ status: 403 })
    await expect(updateAction(stranger, action.id, { progressPct: 50 })).rejects.toMatchObject({ status: 403 })
    await expect(completeAction(stranger, action.id, COMPLETION)).rejects.toMatchObject({ status: 403 })
  })

  it('o líder do plano lê, mas não edita as ações da pessoa', async () => {
    const { plan, action } = await planWithAction()

    expect((await getPlan(leader, plan.id)).id).toBe(plan.id)
    await expect(updateAction(leader, action.id, { progressPct: 50 })).rejects.toMatchObject({ status: 403 })
  })

  it('com aprovação exigida, concluir manda a ação para a fila do líder e o notifica', async () => {
    await setLeaderApproval(true)
    const { action } = await planWithAction()

    const result = await completeAction(owner, action.id, COMPLETION)

    expect(result.awaitingReview).toBe(true)
    expect(result.action.status).toBe('AWAITING_REVIEW')
    expect(result.action.completedAt).toBeNull()

    const queue = await listPendingReviews(leader)
    expect(queue).toHaveLength(1)
    expect(queue[0].owner.name).toBe('Dona do plano')

    const notifications = await prisma.notification.findMany({ where: { userId: leader.userId } })
    expect(notifications.map((n) => n.type)).toContain('PDI_ACTION_AWAITING_REVIEW')
  })

  it('com a exigência desligada, a ação conclui direto', async () => {
    await setLeaderApproval(false)
    const { action } = await planWithAction()

    const result = await completeAction(owner, action.id, COMPLETION)

    expect(result.awaitingReview).toBe(false)
    expect(result.action.status).toBe('DONE')
    expect(result.action.completedAt).not.toBeNull()
    expect(await listPendingReviews(leader)).toHaveLength(0)
  })

  it('sem líder no plano a ação conclui direto, mesmo com a exigência ligada', async () => {
    await setLeaderApproval(true)
    const { action } = await planWithAction(null)

    const result = await completeAction(owner, action.id, COMPLETION)

    expect(result.awaitingReview).toBe(false)
    expect(result.action.status).toBe('DONE')
  })

  it('a conclusão exige evidência e reflexão', async () => {
    await setLeaderApproval(false)
    const { action } = await planWithAction()

    await expect(completeAction(owner, action.id, { ...COMPLETION, evidences: [] })).rejects.toBeInstanceOf(PdiError)
    await expect(
      completeAction(owner, action.id, { ...COMPLETION, reflection: {} }),
    ).rejects.toBeInstanceOf(PdiError)
    await expect(
      completeAction(owner, action.id, { ...COMPLETION, practicalApplication: 'curto' }),
    ).rejects.toBeInstanceOf(PdiError)
  })

  it('o líder aprova: a ação conclui, notifica a pessoa e vira evento no histórico', async () => {
    await setLeaderApproval(true)
    const { action } = await planWithAction()
    await completeAction(owner, action.id, COMPLETION)

    const reviewed = await reviewAction(leader, action.id, { decision: 'APPROVE' })

    expect(reviewed.status).toBe('DONE')
    expect(reviewed.reviewedBy?.name).toBe('Líder')
    const history = await listActionHistory(owner, action.id)
    expect(history.map((entry) => entry.eventType)).toEqual([
      'CREATED',
      'SUBMITTED_FOR_REVIEW',
      'APPROVED',
      'COMPLETED',
    ])
    const notifications = await prisma.notification.findMany({ where: { userId: owner.userId } })
    expect(notifications.map((n) => n.type)).toContain('PDI_ACTION_APPROVED')
  })

  it('pedir ajustes devolve a ação para em andamento, com comentário, e notifica a pessoa', async () => {
    await setLeaderApproval(true)
    const { action } = await planWithAction()
    await completeAction(owner, action.id, COMPLETION)

    const reviewed = await reviewAction(leader, action.id, {
      decision: 'REQUEST_CHANGES',
      comment: 'Anexe o certificado, o link não abre.',
    })

    expect(reviewed.status).toBe('IN_PROGRESS')
    expect(reviewed.reviewComment).toBe('Anexe o certificado, o link não abre.')
    expect(reviewed.completedAt).toBeNull()
    const notifications = await prisma.notification.findMany({ where: { userId: owner.userId } })
    expect(notifications.map((n) => n.type)).toContain('PDI_ACTION_CHANGES_REQUESTED')
  })

  it('pedir ajustes exige comentário', async () => {
    await setLeaderApproval(true)
    const { action } = await planWithAction()
    await completeAction(owner, action.id, COMPLETION)

    await expect(reviewAction(leader, action.id, { decision: 'REQUEST_CHANGES' })).rejects.toBeInstanceOf(PdiError)
  })

  it('um líder só valida ação de plano em que ele é o líder', async () => {
    await setLeaderApproval(true)
    const { action } = await planWithAction()
    await completeAction(owner, action.id, COMPLETION)

    await expect(reviewAction(stranger, action.id, { decision: 'APPROVE' })).rejects.toMatchObject({ status: 403 })
    expect(await listPendingReviews(stranger)).toHaveLength(0)
  })

  it('ação aguardando validação não pode ser editada pela pessoa', async () => {
    await setLeaderApproval(true)
    const { action } = await planWithAction()
    await completeAction(owner, action.id, COMPLETION)

    await expect(updateAction(owner, action.id, { progressPct: 10 })).rejects.toMatchObject({ status: 409 })
  })

  it('cada mudança de estado gera evento com autor e data', async () => {
    await setLeaderApproval(false)
    const { action } = await planWithAction()
    await updateAction(owner, action.id, { progressPct: 40 })
    await completeAction(owner, action.id, COMPLETION)

    const history = await listActionHistory(owner, action.id)

    expect(history.map((entry) => entry.eventType)).toEqual(['CREATED', 'PROGRESS_UPDATED', 'COMPLETED'])
    expect(history.every((entry) => entry.actor?.id === owner.userId)).toBe(true)
    expect(history.every((entry) => Boolean(entry.createdAt))).toBe(true)
  })

  it('progresso manual acima de zero move a ação para em andamento', async () => {
    const { action } = await planWithAction()

    const updated = await updateAction(owner, action.id, { progressPct: 30 })

    expect(updated.status).toBe('IN_PROGRESS')
    expect(updated.progressPct).toBe(30)
  })
})

describe('líderes elegíveis para validar o PDI', () => {
  async function sector(id: string) {
    return prisma.sector.create({ data: { id, name: id, slug: id, enabledFeatures: [] } })
  }

  it('para uma Lenda, lista Líder, Gerente e Head do próprio setor', async () => {
    const legend = await makeUser('lenda@empresa.com', 'Lenda')
    await makeUser('lead@empresa.com', 'Um líder', undefined, 'LEAD')
    await makeUser('manager@empresa.com', 'Uma gerente', undefined, 'MANAGER')
    await makeUser('head@empresa.com', 'Uma head', undefined, 'HEAD')
    await makeUser('colega@empresa.com', 'Outra lenda')

    const leaders = await listEligibleLeaders(legend)

    expect(leaders.map((leader) => leader.name).sort()).toEqual(['Um líder', 'Uma gerente', 'Uma head'])
  })

  it('para um Líder, lista só Gerente e Head', async () => {
    const lead = await makeUser('lead@empresa.com', 'Um líder', undefined, 'LEAD')
    await makeUser('outro-lead@empresa.com', 'Outro líder', undefined, 'LEAD')
    await makeUser('manager@empresa.com', 'Uma gerente', undefined, 'MANAGER')
    await makeUser('head@empresa.com', 'Uma head', undefined, 'HEAD')

    const leaders = await listEligibleLeaders(lead)

    expect(leaders.map((leader) => leader.name).sort()).toEqual(['Uma gerente', 'Uma head'])
  })

  it('para um Gerente, lista só Head', async () => {
    const manager = await makeUser('manager@empresa.com', 'Uma gerente', undefined, 'MANAGER')
    await makeUser('lead@empresa.com', 'Um líder', undefined, 'LEAD')
    await makeUser('head@empresa.com', 'Uma head', undefined, 'HEAD')

    const leaders = await listEligibleLeaders(manager)

    expect(leaders.map((leader) => leader.name)).toEqual(['Uma head'])
  })

  it('para um Head, a lista é vazia — é o topo da hierarquia', async () => {
    const head = await makeUser('head@empresa.com', 'Uma head', undefined, 'HEAD')
    await makeUser('outra-head@empresa.com', 'Outra head', undefined, 'HEAD')

    expect(await listEligibleLeaders(head)).toEqual([])
  })

  it('não lista líder de outro setor', async () => {
    await sector('setor-b')
    const legend = await makeUser('lenda@empresa.com', 'Lenda')
    await makeUser('lead-b@empresa.com', 'Líder do outro setor', 'setor-b', 'LEAD')

    expect(await listEligibleLeaders(legend)).toEqual([])
  })

  it('não lista quem saiu ou está inativo', async () => {
    const legend = await makeUser('lenda@empresa.com', 'Lenda')
    const inativo = await makeUser('inativo@empresa.com', 'Líder inativo', undefined, 'LEAD')
    const saiu = await makeUser('saiu@empresa.com', 'Líder que saiu', undefined, 'LEAD')
    await prisma.user.update({ where: { id: inativo.userId }, data: { active: false } })
    await prisma.user.update({ where: { id: saiu.userId }, data: { leftAt: new Date() } })

    expect(await listEligibleLeaders(legend)).toEqual([])
  })

  it('recusa escolher como líder alguém fora da lista, mesmo por chamada direta', async () => {
    const legend = await makeUser('lenda@empresa.com', 'Lenda')
    const colega = await makeUser('colega@empresa.com', 'Outra lenda')
    await sector('setor-b')
    const deOutroSetor = await makeUser('lead-b@empresa.com', 'Líder do outro setor', 'setor-b', 'LEAD')

    // Colega de mesmo papel não lidera.
    await expect(createPlan(legend, { title: 'PDI', leaderId: colega.userId })).rejects.toMatchObject({ status: 400 })
    // Líder de outro setor também não.
    await expect(createPlan(legend, { title: 'PDI', leaderId: deOutroSetor.userId })).rejects.toMatchObject({
      status: 400,
    })
    // A própria pessoa, idem.
    await expect(createPlan(legend, { title: 'PDI', leaderId: legend.userId })).rejects.toBeInstanceOf(PdiError)
  })

  it('aceita líder elegível e permite plano sem líder', async () => {
    const legend = await makeUser('lenda@empresa.com', 'Lenda')
    const lead = await makeUser('lead@empresa.com', 'Um líder', undefined, 'LEAD')

    const comLider = await createPlan(legend, { title: 'PDI', leaderId: lead.userId })
    const semLider = await createPlan(legend, { title: 'PDI sem líder', leaderId: null })

    expect(comLider.leader?.name).toBe('Um líder')
    expect(semLider.leader).toBeNull()
  })
})

describe('visibilidade da vitrine', () => {
  const target = (visibility: 'ALL' | 'TEAM' | 'LEADER' | 'PRIVATE', sectorId = 'setor-a') => ({
    id: 'alvo',
    sectorId,
    pdiShowcaseVisibility: visibility,
  })

  it('ALL libera qualquer pessoa da empresa', () => {
    expect(canSeeShowcase(target('ALL'), { id: 'outra', sectorId: 'setor-b' }, false)).toBe(true)
  })

  it('TEAM libera só o mesmo setor (e o líder)', () => {
    expect(canSeeShowcase(target('TEAM'), { id: 'outra', sectorId: 'setor-a' }, false)).toBe(true)
    expect(canSeeShowcase(target('TEAM'), { id: 'outra', sectorId: 'setor-b' }, false)).toBe(false)
    expect(canSeeShowcase(target('TEAM'), { id: 'outra', sectorId: 'setor-b' }, true)).toBe(true)
  })

  it('LEADER libera só o líder do plano', () => {
    expect(canSeeShowcase(target('LEADER'), { id: 'outra', sectorId: 'setor-a' }, true)).toBe(true)
    expect(canSeeShowcase(target('LEADER'), { id: 'outra', sectorId: 'setor-a' }, false)).toBe(false)
  })

  it('PRIVATE não libera ninguém além da própria pessoa', () => {
    expect(canSeeShowcase(target('PRIVATE'), { id: 'outra', sectorId: 'setor-a' }, true)).toBe(false)
    expect(canSeeShowcase(target('PRIVATE'), { id: 'alvo', sectorId: 'setor-a' }, false)).toBe(true)
  })
})

describe('vitrine do perfil', () => {
  it('em privado, ninguém além da própria pessoa vê as ações concluídas', async () => {
    const owner = await makeUser('dona2@empresa.com', 'Dona')
    const watcher = await makeUser('curiosa@empresa.com', 'Curiosa')
    await setLeaderApproval(false)
    const plan = await createPlan(owner, { title: 'PDI', leaderId: null })
    const action = await createAction(owner, plan.id, {
      description: 'Ler um livro de comunicação',
      type: 'BOOK',
      priority: 'LOW',
      competency: 'Comunicação',
    })
    await completeAction(owner, action.id, COMPLETION)
    await updateShowcaseVisibility(owner, 'PRIVATE')

    const mine = await getShowcase(owner, owner.userId)
    const theirs = await getShowcase(watcher, owner.userId)

    expect(mine.visible).toBe(true)
    expect(mine.actions).toHaveLength(1)
    expect(mine.competencies).toEqual(['Comunicação'])
    expect(theirs.visible).toBe(false)
    expect(theirs.actions).toHaveLength(0)
  })
})

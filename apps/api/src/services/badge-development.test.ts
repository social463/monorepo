import { beforeEach, describe, expect, it } from 'vitest'
import type { UserRole } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { getBadgeCatalog, syncCourseBadgesForUser, syncPdiBadgesForUser } from './badge-service'
import { enrollInCourse, setLessonCompletion } from './learning-service'
import { completeAction, createAction, createPlan, reviewAction } from './pdi-service'
import { PDI_LEADER_APPROVAL_KEY } from './development-settings-service'

const COMPANY = 'company-emr'

async function makeUser(email: string, name = 'Dev', role: UserRole = 'LEGEND') {
  const user = await prisma.user.create({ data: { name, email, passwordHash: 'x', role } })
  return { userId: user.id, companyId: COMPANY }
}

async function makeCourseBadge(threshold: number, slug = `curso-${threshold}`) {
  return prisma.badge.create({
    data: {
      slug,
      name: `Concluiu ${threshold}`,
      description: 'x',
      kind: 'COURSE',
      iconKey: 'fe-medal-bronze',
      threshold,
    },
  })
}

async function makePdiBadge(threshold: number, slug = `pdi-${threshold}`) {
  return prisma.badge.create({
    data: { slug, name: `PDI ${threshold}`, description: 'x', kind: 'PDI', iconKey: 'fe-medal-bronze', threshold },
  })
}

/** Curso publicado com N aulas de 30 min. */
async function makeCourse(slug: string, lessonCount = 1) {
  const course = await prisma.course.create({
    data: { slug, title: `Curso ${slug}`, category: 'Liderança', published: true, publishedAt: new Date() },
  })
  const courseModule = await prisma.courseModule.create({ data: { courseId: course.id, title: 'Módulo' } })
  const lessons = []
  for (let index = 0; index < lessonCount; index++) {
    lessons.push(
      await prisma.courseLesson.create({
        data: {
          courseId: course.id,
          moduleId: courseModule.id,
          title: `Aula ${index + 1}`,
          durationMinutes: 30,
          sortOrder: index,
        },
      }),
    )
  }
  return { course, lessons }
}

async function setLeaderApproval(required: boolean) {
  await prisma.appSetting.upsert({
    where: { key_companyId: { key: PDI_LEADER_APPROVAL_KEY, companyId: COMPANY } },
    create: { key: PDI_LEADER_APPROVAL_KEY, companyId: COMPANY, value: String(required) },
    update: { value: String(required) },
  })
}

const COMPLETION = {
  practicalApplication: 'Levei o combinado para o 1:1 do time e registrei em ata.',
  reflection: { mainLearning: 'Feedback precisa de fato, não de rótulo.' },
  evidences: [{ kind: 'COMPLETION' as const, externalUrl: 'https://exemplo.com/certificado' }],
}

async function ownedBadgeSlugs(userId: string): Promise<string[]> {
  const rows = await prisma.userBadge.findMany({ where: { userId }, include: { badge: true } })
  return rows.map((row) => row.badge.slug).sort()
}

describe('selos de Aprendizado', () => {
  let viewer: { userId: string; companyId: string }

  beforeEach(async () => {
    viewer = await makeUser('dev@empresa.com')
  })

  it('concede o selo ao concluir o curso, pelo próprio fluxo de marcar aula', async () => {
    await makeCourseBadge(1)
    const { course, lessons } = await makeCourse('primeiro', 2)
    await enrollInCourse(viewer, course.id)

    await setLessonCompletion(viewer, lessons[0].id, true)
    expect(await ownedBadgeSlugs(viewer.userId)).toEqual([])

    await setLessonCompletion(viewer, lessons[1].id, true)
    expect(await ownedBadgeSlugs(viewer.userId)).toEqual(['curso-1'])
  })

  it('só concede o selo de threshold maior quando a contagem chega lá', async () => {
    await makeCourseBadge(1)
    await makeCourseBadge(2)
    const primeiro = await makeCourse('a')
    const segundo = await makeCourse('b')

    await enrollInCourse(viewer, primeiro.course.id)
    await setLessonCompletion(viewer, primeiro.lessons[0].id, true)
    expect(await ownedBadgeSlugs(viewer.userId)).toEqual(['curso-1'])

    await enrollInCourse(viewer, segundo.course.id)
    await setLessonCompletion(viewer, segundo.lessons[0].id, true)
    expect(await ownedBadgeSlugs(viewer.userId)).toEqual(['curso-1', 'curso-2'])
  })

  it('desmarcar a aula tira o curso da contagem e revoga o selo', async () => {
    await makeCourseBadge(1)
    const { course, lessons } = await makeCourse('revogavel')
    await enrollInCourse(viewer, course.id)
    await setLessonCompletion(viewer, lessons[0].id, true)
    expect(await ownedBadgeSlugs(viewer.userId)).toEqual(['curso-1'])

    await setLessonCompletion(viewer, lessons[0].id, false)

    expect(await ownedBadgeSlugs(viewer.userId)).toEqual([])
  })

  it('não revoga concessão manual do mesmo selo', async () => {
    const badge = await makeCourseBadge(5)
    const admin = await makeUser('admin@empresa.com', 'Admin')
    await prisma.userBadge.create({
      data: { userId: viewer.userId, badgeId: badge.id, source: 'MANUAL', awardedById: admin.userId },
    })

    await syncCourseBadgesForUser(viewer.userId)

    expect(await ownedBadgeSlugs(viewer.userId)).toEqual(['curso-5'])
  })

  it('mostra requisito e progresso no catálogo de selos', async () => {
    await makeCourseBadge(3)
    const { course, lessons } = await makeCourse('progresso')
    await enrollInCourse(viewer, course.id)
    await setLessonCompletion(viewer, lessons[0].id, true)

    const entry = (await getBadgeCatalog(viewer.userId)).find((item) => item.badge.slug === 'curso-3')

    expect(entry?.requirement).toBe('Conclua 3 cursos')
    expect(entry?.progress).toEqual({ current: 1, target: 3 })
  })
})

describe('selos de PDI', () => {
  let owner: { userId: string; companyId: string }
  let leader: { userId: string; companyId: string }

  beforeEach(async () => {
    owner = await makeUser('dona@empresa.com', 'Dona')
    leader = await makeUser('lider@empresa.com', 'Líder', 'LEAD')
  })

  async function planWithAction(leaderId: string | null) {
    const plan = await createPlan(owner, { title: 'PDI 2026-Q1', leaderId })
    const action = await createAction(owner, plan.id, {
      description: 'Concluir o curso de liderança',
      type: 'COURSE',
      priority: 'HIGH',
    })
    return action
  }

  it('concede o selo quando a ação conclui direto (sem validação do líder)', async () => {
    await setLeaderApproval(false)
    await makePdiBadge(1)
    const action = await planWithAction(null)

    await completeAction(owner, action.id, COMPLETION)

    expect(await ownedBadgeSlugs(owner.userId)).toEqual(['pdi-1'])
  })

  it('não concede enquanto a ação está aguardando validação — só depois de aprovada', async () => {
    await setLeaderApproval(true)
    await makePdiBadge(1)
    const action = await planWithAction(leader.userId)

    await completeAction(owner, action.id, COMPLETION)
    expect(await ownedBadgeSlugs(owner.userId)).toEqual([])

    await reviewAction(leader, action.id, { decision: 'APPROVE' })
    expect(await ownedBadgeSlugs(owner.userId)).toEqual(['pdi-1'])
  })

  it('o selo é de quem fez a ação, não de quem validou', async () => {
    await setLeaderApproval(true)
    await makePdiBadge(1)
    const action = await planWithAction(leader.userId)
    await completeAction(owner, action.id, COMPLETION)

    await reviewAction(leader, action.id, { decision: 'APPROVE' })

    expect(await ownedBadgeSlugs(leader.userId)).toEqual([])
  })

  it('pedir ajustes tira a ação de DONE e revoga o selo', async () => {
    await setLeaderApproval(true)
    await makePdiBadge(1)
    const action = await planWithAction(leader.userId)
    await completeAction(owner, action.id, COMPLETION)
    await reviewAction(leader, action.id, { decision: 'APPROVE' })
    expect(await ownedBadgeSlugs(owner.userId)).toEqual(['pdi-1'])

    // Reabre a ação para o líder poder pedir ajustes de novo.
    await prisma.pdiAction.update({ where: { id: action.id }, data: { status: 'AWAITING_REVIEW' } })
    await reviewAction(leader, action.id, { decision: 'REQUEST_CHANGES', comment: 'Faltou evidência.' })

    expect(await ownedBadgeSlugs(owner.userId)).toEqual([])
  })

  it('notifica a pessoa quando o selo de PDI é conquistado', async () => {
    await setLeaderApproval(false)
    await makePdiBadge(1)
    const action = await planWithAction(null)

    await completeAction(owner, action.id, COMPLETION)

    const notifications = await prisma.notification.findMany({ where: { userId: owner.userId } })
    expect(notifications.map((n) => n.type)).toContain('BADGE_EARNED')
  })

  it('mostra requisito e progresso no catálogo de selos', async () => {
    await setLeaderApproval(false)
    await makePdiBadge(3)
    const action = await planWithAction(null)
    await completeAction(owner, action.id, COMPLETION)

    const entry = (await getBadgeCatalog(owner.userId)).find((item) => item.badge.slug === 'pdi-3')

    expect(entry?.requirement).toBe('Conclua 3 ações do seu PDI')
    expect(entry?.progress).toEqual({ current: 1, target: 3 })
  })

  it('conta só as ações do próprio plano', async () => {
    await setLeaderApproval(false)
    await makePdiBadge(1)
    const outraAcao = await (async () => {
      const plan = await createPlan(leader, { title: 'PDI do líder', leaderId: null })
      return createAction(leader, plan.id, { description: 'Ler um livro', type: 'BOOK', priority: 'LOW' })
    })()
    await completeAction(leader, outraAcao.id, COMPLETION)

    await syncPdiBadgesForUser(owner.userId)

    expect(await ownedBadgeSlugs(owner.userId)).toEqual([])
    expect(await ownedBadgeSlugs(leader.userId)).toEqual(['pdi-1'])
  })
})

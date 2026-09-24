import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import type { CourseActor } from './course-admin-service'
import { getCourseDashboard } from './course-dashboard-service'

const admin: CourseActor = {
  id: 'admin-dashboard',
  role: 'ADMIN',
  sectorId: DEFAULT_SECTOR_ID,
  companyId: DEFAULT_COMPANY_ID,
}

const DIA = 24 * 60 * 60 * 1000

async function makeCourse(
  input: { status?: string; lessonMinutes?: number[]; title?: string } = {},
): Promise<string> {
  const course = await prisma.course.create({
    data: {
      slug: `curso-${Math.random().toString(36).slice(2)}`,
      title: input.title ?? 'Curso',
      status: (input.status ?? 'PUBLISHED') as never,
      companyId: DEFAULT_COMPANY_ID,
    },
  })
  const minutos = input.lessonMinutes ?? []
  if (minutos.length > 0) {
    const mod = await prisma.courseModule.create({ data: { courseId: course.id, title: 'M' } })
    for (const [i, duration] of minutos.entries()) {
      await prisma.courseLesson.create({
        data: { courseId: course.id, moduleId: mod.id, title: `A${i}`, durationMinutes: duration, sortOrder: i },
      })
    }
  }
  return course.id
}

async function makeUser(): Promise<string> {
  const user = await prisma.user.create({
    data: {
      name: 'Pessoa',
      email: `dash-${Math.random().toString(36).slice(2)}@empresa.com`,
      passwordHash: 'x',
      companyId: DEFAULT_COMPANY_ID,
    },
  })
  return user.id
}

async function enroll(
  courseId: string,
  userId: string,
  input: { completed?: boolean; diasParado?: number } = {},
) {
  const ultimaAtividade = new Date(Date.now() - (input.diasParado ?? 0) * DIA)
  return prisma.courseEnrollment.create({
    data: {
      courseId,
      userId,
      status: input.completed ? 'COMPLETED' : 'IN_PROGRESS',
      completedAt: input.completed ? new Date() : null,
      startedAt: ultimaAtividade,
      lastAccessedAt: ultimaAtividade,
      companyId: DEFAULT_COMPANY_ID,
    },
  })
}

beforeEach(async () => {
  await prisma.user.create({
    data: {
      id: admin.id,
      name: 'Admin',
      email: `admin-dash-${Math.random().toString(36).slice(2)}@empresa.com`,
      passwordHash: 'x',
      role: 'ADMIN',
      companyId: DEFAULT_COMPANY_ID,
    },
  })
})

describe('dashboard da Central de Cursos (Documento 4, seção 9.6)', () => {
  it('devolve zeros num catálogo vazio, sem NaN', async () => {
    const d = await getCourseDashboard(admin)
    expect(d.total).toBe(0)
    expect(d.completionPct).toBe(0)
    expect(d.averageRating).toBe(0)
    expect(d.hoursOffered).toBe(0)
    expect(d.mostEnrolled).toEqual([])
  })

  // Os cinco estados sempre aparecem, mesmo zerados: um que some da lista faz o
  // gráfico mudar de forma a cada leitura.
  it('conta os cinco estados, e os vazios continuam na lista', async () => {
    await makeCourse({ status: 'PUBLISHED' })
    await makeCourse({ status: 'PUBLISHED' })
    await makeCourse({ status: 'DRAFT' })

    const d = await getCourseDashboard(admin)
    expect(d.total).toBe(3)
    expect(d.byStatus).toHaveLength(5)
    expect(d.byStatus.find((s) => s.status === 'PUBLISHED')?.count).toBe(2)
    expect(d.byStatus.find((s) => s.status === 'DRAFT')?.count).toBe(1)
    expect(d.byStatus.find((s) => s.status === 'ARCHIVED')?.count).toBe(0)
  })

  // Curso em rascunho não é oferta: ninguém pode fazê-lo.
  it('as horas ofertadas somam só o que está publicado', async () => {
    await makeCourse({ status: 'PUBLISHED', lessonMinutes: [60, 30] })
    await makeCourse({ status: 'DRAFT', lessonMinutes: [600] })

    expect((await getCourseDashboard(admin)).hoursOffered).toBe(1.5)
  })

  it('conta pessoas distintas, não inscrições', async () => {
    const [a, b] = [await makeCourse(), await makeCourse()]
    const pessoa = await makeUser()
    await enroll(a, pessoa)
    await enroll(b, pessoa)

    const d = await getCourseDashboard(admin)
    expect(d.studentsEnrolled).toBe(1)
    expect(d.mostEnrolled.reduce((soma, linha) => soma + linha.enrollments, 0)).toBe(2)
  })

  it('a taxa de conclusão é sobre inscrições', async () => {
    const curso = await makeCourse()
    await enroll(curso, await makeUser(), { completed: true })
    await enroll(curso, await makeUser(), { completed: true })
    await enroll(curso, await makeUser())
    await enroll(curso, await makeUser())

    expect((await getCourseDashboard(admin)).completionPct).toBe(50)
  })

  /**
   * O ponto do desenho: abandono é "parou", não "não terminou". Quem se
   * inscreveu ontem não abandonou nada, e contá-lo faria todo curso novo nascer
   * com abandono alto.
   */
  it('só conta como abandono quem parou há mais de 30 dias', async () => {
    const curso = await makeCourse({ title: 'Com abandono' })
    for (let i = 0; i < 4; i += 1) await enroll(curso, await makeUser(), { diasParado: 60 })
    for (let i = 0; i < 4; i += 1) await enroll(curso, await makeUser(), { diasParado: 1 })

    const linha = (await getCourseDashboard(admin)).mostAbandoned[0]
    expect(linha?.title).toBe('Com abandono')
    expect(linha?.abandonedPct).toBe(50)
  })

  it('quem concluiu nunca conta como abandono, por mais antigo que seja', async () => {
    const curso = await makeCourse()
    for (let i = 0; i < 5; i += 1) {
      await enroll(curso, await makeUser(), { completed: true, diasParado: 400 })
    }

    expect((await getCourseDashboard(admin)).mostAbandoned).toEqual([])
  })

  /**
   * Sem o piso, um curso com uma inscrição parada apareceria com 100% no topo —
   * número verdadeiro e conclusão errada.
   */
  it('curso com poucas inscrições não entra na tabela de abandono', async () => {
    const pequeno = await makeCourse({ title: 'Pequeno' })
    await enroll(pequeno, await makeUser(), { diasParado: 90 })

    const grande = await makeCourse({ title: 'Grande' })
    for (let i = 0; i < 5; i += 1) await enroll(grande, await makeUser(), { diasParado: 90 })

    const d = await getCourseDashboard(admin)
    expect(d.mostAbandoned.map((linha) => linha.title)).toEqual(['Grande'])
  })

  it('a média de avaliação vem do que foi avaliado', async () => {
    const curso = await makeCourse()
    for (const rating of [5, 4]) {
      await prisma.courseRating.create({
        data: { courseId: curso, userId: await makeUser(), rating, companyId: DEFAULT_COMPANY_ID },
      })
    }

    const d = await getCourseDashboard(admin)
    expect(d.averageRating).toBe(4.5)
    expect(d.totalRatings).toBe(2)
  })

  // Mesmo recorte da listagem de autoria: o subadmin vê o que administra.
  it('o SUBADMIN só enxerga os indicadores do próprio setor', async () => {
    const outro = await prisma.sector.upsert({
      where: { id: 'setor-outro' },
      create: { id: 'setor-outro', name: 'Outro', slug: 'outro' },
      update: {},
    })
    const meu = await makeCourse()
    await prisma.course.update({ where: { id: meu }, data: { sectorId: DEFAULT_SECTOR_ID } })
    const alheio = await makeCourse()
    await prisma.course.update({ where: { id: alheio }, data: { sectorId: outro.id } })

    const subadmin: CourseActor = { ...admin, role: 'SUBADMIN' }
    expect((await getCourseDashboard(subadmin)).total).toBe(1)
    expect((await getCourseDashboard(admin)).total).toBe(2)
  })
})

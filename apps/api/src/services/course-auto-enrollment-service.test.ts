import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { runAutoEnrollmentForCourse, runAutoEnrollmentTick } from './course-auto-enrollment-service'
import { listCourses } from './learning-service'

async function makeSector(id: string) {
  return prisma.sector.upsert({
    where: { id },
    create: { id, name: id, slug: id },
    update: {},
  })
}

async function makeUser(input: { sectorId?: string; positionCategory?: string | null; active?: boolean } = {}) {
  return prisma.user.create({
    data: {
      name: `Pessoa ${Math.random().toString(36).slice(2, 7)}`,
      email: `auto-${Math.random().toString(36).slice(2)}@empresa.com`,
      passwordHash: 'x',
      sectorId: input.sectorId ?? DEFAULT_SECTOR_ID,
      positionCategory: input.positionCategory ?? null,
      active: input.active ?? true,
      companyId: DEFAULT_COMPANY_ID,
    },
  })
}

async function makeCourse(
  input: {
    autoEnroll?: boolean
    status?: 'DRAFT' | 'PUBLISHED'
    sectorId?: string | null
    audienceSectorIds?: string[]
    audiencePositionCategories?: string[]
  } = {},
) {
  const course = await prisma.course.create({
    data: {
      slug: `curso-${Math.random().toString(36).slice(2)}`,
      title: 'Curso',
      status: input.status ?? 'PUBLISHED',
      publishedAt: new Date(),
      autoEnroll: input.autoEnroll ?? true,
      sectorId: input.sectorId === undefined ? null : input.sectorId,
      audiencePositionCategories: input.audiencePositionCategories ?? [],
      companyId: DEFAULT_COMPANY_ID,
    },
  })
  for (const sectorId of input.audienceSectorIds ?? []) {
    await prisma.courseAudienceSector.create({ data: { courseId: course.id, sectorId } })
  }
  return course
}

async function inscritos(courseId: string): Promise<number> {
  return prisma.courseEnrollment.count({ where: { courseId } })
}

beforeEach(async () => {
  await makeSector(DEFAULT_SECTOR_ID)
})

describe('matrícula automática (Documento 4, seção 9.2)', () => {
  it('sem público definido, matricula a empresa toda', async () => {
    await makeUser()
    await makeUser()
    const course = await makeCourse()

    expect(await runAutoEnrollmentForCourse(course.id)).toBe(2)
    expect(await inscritos(course.id)).toBe(2)
  })

  it('recorta por setor — o dono e os do público', async () => {
    const comercial = await makeSector('setor-comercial')
    const marketing = await makeSector('setor-marketing')
    const doComercial = await makeUser({ sectorId: comercial.id })
    await makeUser({ sectorId: marketing.id })
    // Toda pessoa tem setor (`User.sectorId` é obrigatório); "de fora" é quem
    // está num setor que não é nem o dono nem público.
    const deFora = await makeUser({ sectorId: DEFAULT_SECTOR_ID })

    const course = await makeCourse({ sectorId: comercial.id, audienceSectorIds: [marketing.id] })
    await runAutoEnrollmentForCourse(course.id)

    expect(await inscritos(course.id)).toBe(2)
    expect(await prisma.courseEnrollment.count({ where: { courseId: course.id, userId: doComercial.id } })).toBe(1)
    expect(await prisma.courseEnrollment.count({ where: { courseId: course.id, userId: deFora.id } })).toBe(0)
  })

  it('recorta por categoria de cargo', async () => {
    const analista = await makeUser({ positionCategory: 'Analista' })
    await makeUser({ positionCategory: 'Diretor' })
    await makeUser({ positionCategory: null })

    const course = await makeCourse({ audiencePositionCategories: ['Analista'] })
    await runAutoEnrollmentForCourse(course.id)

    expect(await inscritos(course.id)).toBe(1)
    expect(await prisma.courseEnrollment.count({ where: { courseId: course.id, userId: analista.id } })).toBe(1)
  })

  /**
   * O tick roda de hora em hora. Rodar duas vezes não pode inscrever de novo —
   * é o `@@unique([userId, courseId])` com `skipDuplicates` que garante.
   */
  it('é idempotente: rodar de novo não duplica nem toca em quem já começou', async () => {
    const pessoa = await makeUser()
    const course = await makeCourse()

    expect(await runAutoEnrollmentForCourse(course.id)).toBe(1)
    // A pessoa avança no curso…
    await prisma.courseEnrollment.updateMany({
      where: { courseId: course.id, userId: pessoa.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    })

    expect(await runAutoEnrollmentForCourse(course.id)).toBe(0)
    expect(await inscritos(course.id)).toBe(1)
    const inscricao = await prisma.courseEnrollment.findFirst({ where: { courseId: course.id } })
    expect(inscricao?.status).toBe('COMPLETED')
  })

  it('ignora curso em rascunho e curso com a matrícula automática desligada', async () => {
    await makeUser()
    const rascunho = await makeCourse({ status: 'DRAFT' })
    const desligado = await makeCourse({ autoEnroll: false })

    expect(await runAutoEnrollmentForCourse(rascunho.id)).toBe(0)
    expect(await runAutoEnrollmentForCourse(desligado.id)).toBe(0)
  })

  it('não matricula quem está inativo', async () => {
    await makeUser({ active: false })
    const course = await makeCourse()
    expect(await runAutoEnrollmentForCourse(course.id)).toBe(0)
  })

  it('o tick passa por todos os cursos com a matrícula ligada', async () => {
    await makeUser()
    await makeCourse()
    await makeCourse()
    await makeCourse({ autoEnroll: false })

    const resultado = await runAutoEnrollmentTick()
    expect(resultado.courses).toBe(2)
    expect(resultado.created).toBe(2)
  })

  /**
   * O ponto do desenho: o público-alvo é a MESMA definição usada pela
   * visibilidade. Um curso não pode matricular quem nem consegue abri-lo.
   */
  it('quem é matriculado é exatamente quem enxerga o curso', async () => {
    const comercial = await makeSector('setor-comercial')
    const doComercial = await makeUser({ sectorId: comercial.id, positionCategory: 'Analista' })
    const outroCargo = await makeUser({ sectorId: comercial.id, positionCategory: 'Diretor' })

    const course = await makeCourse({ sectorId: comercial.id, audiencePositionCategories: ['Analista'] })
    await runAutoEnrollmentForCourse(course.id)

    const viewer = { userId: doComercial.id, companyId: DEFAULT_COMPANY_ID }
    const outroViewer = { userId: outroCargo.id, companyId: DEFAULT_COMPANY_ID }

    expect((await listCourses(viewer)).courses.map((c) => c.id)).toEqual([course.id])
    expect((await listCourses(outroViewer)).courses).toEqual([])
    expect(await prisma.courseEnrollment.count({ where: { courseId: course.id, userId: outroCargo.id } })).toBe(0)
  })

  // A pegadinha registrada no schema: sem o dado importado, o recorte por cargo
  // esvazia o catálogo em silêncio. É comportamento correto — quem não tem o
  // atributo não casa com a restrição —, e o teste existe para que a mudança
  // seja consciente.
  it('curso restrito por cargo é invisível para quem está sem categoria', async () => {
    const semCargo = await makeUser({ positionCategory: null })
    const course = await makeCourse({ audiencePositionCategories: ['Analista'] })

    const { courses } = await listCourses({ userId: semCargo.id, companyId: DEFAULT_COMPANY_ID })
    expect(courses).toEqual([])
  })
})

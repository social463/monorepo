import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import {
  CourseAdminError,
  createCourse,
  createLesson,
  createModule,
  deleteCourse,
  deleteLesson,
  deleteModule,
  getCourseForAdmin,
  updateCourse,
  updateLesson,
  updateModule,
  type CourseActor,
} from './course-admin-service'

const OUTRO_SETOR = 'setor-outro-course-admin'

/** Ator com usuário real no banco — `recordAuditLog` grava `actorId` com FK pra `User`. */
async function makeActor(overrides: Partial<Omit<CourseActor, 'id'>> = {}): Promise<CourseActor> {
  const role = overrides.role ?? 'SUBADMIN'
  const sectorId = overrides.sectorId ?? DEFAULT_SECTOR_ID
  const companyId = overrides.companyId ?? DEFAULT_COMPANY_ID
  const user = await prisma.user.create({
    data: {
      name: `Ator ${role}`,
      email: `ator-${role.toLowerCase()}-${Math.random().toString(36).slice(2)}@empresa.com`,
      passwordHash: 'x',
      role: role as never,
      sectorId,
      companyId,
    },
  })
  return { id: user.id, role, sectorId, companyId }
}

/** Curso com módulo e aula já montados, pra exercitar as funções de módulo/aula. */
async function makeCourseWithContent(sectorId: string | null) {
  const course = await prisma.course.create({
    data: {
      slug: `curso-${Math.random().toString(36).slice(2)}`,
      title: 'Curso de teste',
      sectorId,
    },
  })
  const courseModule = await prisma.courseModule.create({
    data: { courseId: course.id, title: 'Módulo 1', sortOrder: 0 },
  })
  const lesson = await prisma.courseLesson.create({
    data: { courseId: course.id, moduleId: courseModule.id, title: 'Aula 1', sortOrder: 0 },
  })
  return { course, courseModule, lesson }
}

beforeEach(async () => {
  await prisma.sector.create({ data: { id: OUTRO_SETOR, name: 'Outro setor', slug: 'outro-setor-course-admin' } })
})

describe('course-admin-service — recorte por setor na escrita', () => {
  describe('leitura (SUBADMIN alcança o próprio setor e o curso sem setor)', () => {
    it('SUBADMIN lê curso sem setor (da empresa toda)', async () => {
      const { course } = await makeCourseWithContent(null)
      const actor = await makeActor()

      const dto = await getCourseForAdmin(actor, course.id)

      expect(dto.id).toBe(course.id)
    })

    it('SUBADMIN lê curso do próprio setor', async () => {
      const { course } = await makeCourseWithContent(DEFAULT_SECTOR_ID)
      const actor = await makeActor()

      const dto = await getCourseForAdmin(actor, course.id)

      expect(dto.id).toBe(course.id)
    })

    it('SUBADMIN recebe 404 ao ler curso de outro setor', async () => {
      const { course } = await makeCourseWithContent(OUTRO_SETOR)
      const actor = await makeActor()

      await expect(getCourseForAdmin(actor, course.id)).rejects.toMatchObject({ status: 404 })
    })
  })

  describe('escrita em Course — SUBADMIN não alcança curso sem setor nem de outro setor', () => {
    it('SUBADMIN recebe 404 ao editar curso sem setor (da empresa toda)', async () => {
      const { course } = await makeCourseWithContent(null)
      const actor = await makeActor()

      await expect(
        updateCourse({ courseId: course.id, data: { title: 'Novo título' }, actor }),
      ).rejects.toMatchObject({ status: 404 })
    })

    it('SUBADMIN recebe 404 ao apagar curso sem setor (da empresa toda)', async () => {
      const { course } = await makeCourseWithContent(null)
      const actor = await makeActor()

      await expect(deleteCourse({ courseId: course.id, actor })).rejects.toMatchObject({ status: 404 })
    })

    it('SUBADMIN recebe 404 ao publicar curso sem setor (da empresa toda)', async () => {
      const { course, courseModule } = await makeCourseWithContent(null)
      await prisma.courseLesson.create({
        data: { courseId: course.id, moduleId: courseModule.id, title: 'Aula extra', sortOrder: 1 },
      })
      const actor = await makeActor()

      await expect(
        updateCourse({ courseId: course.id, data: { status: 'PUBLISHED' }, actor }),
      ).rejects.toMatchObject({ status: 404 })
    })

    it('SUBADMIN recebe 404 ao editar curso de outro setor', async () => {
      const { course } = await makeCourseWithContent(OUTRO_SETOR)
      const actor = await makeActor()

      await expect(
        updateCourse({ courseId: course.id, data: { title: 'Invasão' }, actor }),
      ).rejects.toMatchObject({ status: 404 })
    })

    it('SUBADMIN edita curso do próprio setor normalmente', async () => {
      const { course } = await makeCourseWithContent(DEFAULT_SECTOR_ID)
      const actor = await makeActor()

      const dto = await updateCourse({ courseId: course.id, data: { title: 'Título atualizado' }, actor })

      expect(dto.title).toBe('Título atualizado')
    })
  })

  describe('escrita em módulo — resolve o curso e escapa a regra se não checar', () => {
    it('SUBADMIN recebe 404 ao criar módulo em curso sem setor', async () => {
      const { course } = await makeCourseWithContent(null)
      const actor = await makeActor()

      await expect(
        createModule({ courseId: course.id, data: { title: 'Módulo intruso' }, actor }),
      ).rejects.toMatchObject({ status: 404 })
    })

    it('SUBADMIN recebe 404 ao editar módulo de curso sem setor', async () => {
      const { courseModule } = await makeCourseWithContent(null)
      const actor = await makeActor()

      await expect(
        updateModule({ moduleId: courseModule.id, data: { title: 'Editado' }, actor }),
      ).rejects.toMatchObject({ status: 404 })
    })

    it('SUBADMIN recebe 404 ao apagar módulo de curso sem setor', async () => {
      const { courseModule } = await makeCourseWithContent(null)
      const actor = await makeActor()

      await expect(deleteModule({ moduleId: courseModule.id, actor })).rejects.toMatchObject({ status: 404 })
    })

    it('SUBADMIN recebe 404 ao criar/editar/apagar módulo de curso de outro setor', async () => {
      const { course, courseModule } = await makeCourseWithContent(OUTRO_SETOR)
      const actor = await makeActor()

      await expect(
        createModule({ courseId: course.id, data: { title: 'X' }, actor }),
      ).rejects.toMatchObject({ status: 404 })
      await expect(
        updateModule({ moduleId: courseModule.id, data: { title: 'X' }, actor }),
      ).rejects.toMatchObject({ status: 404 })
      await expect(deleteModule({ moduleId: courseModule.id, actor })).rejects.toMatchObject({ status: 404 })
    })

    it('SUBADMIN cria/edita/apaga módulo do próprio setor normalmente', async () => {
      const { course } = await makeCourseWithContent(DEFAULT_SECTOR_ID)
      const actor = await makeActor()

      const created = await createModule({ courseId: course.id, data: { title: 'Módulo novo' }, actor })
      const newModuleId = created.modules.find((m) => m.title === 'Módulo novo')!.id

      const updated = await updateModule({ moduleId: newModuleId, data: { title: 'Módulo renomeado' }, actor })
      expect(updated.modules.some((m) => m.title === 'Módulo renomeado')).toBe(true)

      const afterDelete = await deleteModule({ moduleId: newModuleId, actor })
      expect(afterDelete.modules.some((m) => m.id === newModuleId)).toBe(false)
    })
  })

  describe('escrita em aula — resolve o módulo/curso e escapa a regra se não checar', () => {
    it('SUBADMIN recebe 404 ao criar aula em módulo de curso sem setor', async () => {
      const { courseModule } = await makeCourseWithContent(null)
      const actor = await makeActor()

      await expect(
        createLesson({ moduleId: courseModule.id, data: { title: 'Aula intrusa' }, actor }),
      ).rejects.toMatchObject({ status: 404 })
    })

    it('SUBADMIN recebe 404 ao editar aula de curso sem setor', async () => {
      const { lesson } = await makeCourseWithContent(null)
      const actor = await makeActor()

      await expect(
        updateLesson({ lessonId: lesson.id, data: { title: 'Editada' }, actor }),
      ).rejects.toMatchObject({ status: 404 })
    })

    it('SUBADMIN recebe 404 ao apagar aula de curso sem setor', async () => {
      const { lesson } = await makeCourseWithContent(null)
      const actor = await makeActor()

      await expect(deleteLesson({ lessonId: lesson.id, actor })).rejects.toMatchObject({ status: 404 })
    })

    it('SUBADMIN recebe 404 ao criar/editar/apagar aula de curso de outro setor', async () => {
      const { courseModule, lesson } = await makeCourseWithContent(OUTRO_SETOR)
      const actor = await makeActor()

      await expect(
        createLesson({ moduleId: courseModule.id, data: { title: 'X' }, actor }),
      ).rejects.toMatchObject({ status: 404 })
      await expect(
        updateLesson({ lessonId: lesson.id, data: { title: 'X' }, actor }),
      ).rejects.toMatchObject({ status: 404 })
      await expect(deleteLesson({ lessonId: lesson.id, actor })).rejects.toMatchObject({ status: 404 })
    })

    it('SUBADMIN cria/edita/apaga aula do próprio setor normalmente', async () => {
      const { courseModule } = await makeCourseWithContent(DEFAULT_SECTOR_ID)
      const actor = await makeActor()

      const created = await createLesson({
        moduleId: courseModule.id,
        data: { title: 'Aula nova' },
        actor,
      })
      const newLessonId = created.modules[0].lessons.find((l) => l.title === 'Aula nova')!.id

      const updated = await updateLesson({ lessonId: newLessonId, data: { title: 'Aula renomeada' }, actor })
      expect(updated.modules[0].lessons.some((l) => l.title === 'Aula renomeada')).toBe(true)

      const afterDelete = await deleteLesson({ lessonId: newLessonId, actor })
      expect(afterDelete.modules[0].lessons.some((l) => l.id === newLessonId)).toBe(false)
    })
  })

  describe('criação de curso — setor nasce do ator, pedido de outro setor é ignorado', () => {
    it('curso criado por SUBADMIN nasce no setor dele mesmo pedindo outro', async () => {
      const actor = await makeActor()

      const dto = await createCourse({
        data: { title: 'Curso do subadmin', sectorId: OUTRO_SETOR },
        actor,
      })

      const stored = await prisma.course.findUniqueOrThrow({ where: { id: dto.id } })
      expect(stored.sectorId).toBe(DEFAULT_SECTOR_ID)
    })

    it('curso criado por SUBADMIN sem sectorId no payload nasce no setor dele', async () => {
      const actor = await makeActor()

      const dto = await createCourse({ data: { title: 'Curso simples' }, actor })

      const stored = await prisma.course.findUniqueOrThrow({ where: { id: dto.id } })
      expect(stored.sectorId).toBe(DEFAULT_SECTOR_ID)
    })

    it('ADMIN escolhe o setor livremente ao criar, inclusive nulo', async () => {
      const admin = await makeActor({ role: 'ADMIN' })

      const withSector = await createCourse({
        data: { title: 'Curso setorial', sectorId: OUTRO_SETOR },
        actor: admin,
      })
      const companyWide = await createCourse({
        data: { title: 'Curso geral', sectorId: null },
        actor: admin,
      })
      const implicitNull = await createCourse({
        data: { title: 'Curso sem setor por omissão' },
        actor: admin,
      })

      expect((await prisma.course.findUniqueOrThrow({ where: { id: withSector.id } })).sectorId).toBe(OUTRO_SETOR)
      expect((await prisma.course.findUniqueOrThrow({ where: { id: companyWide.id } })).sectorId).toBeNull()
      expect((await prisma.course.findUniqueOrThrow({ where: { id: implicitNull.id } })).sectorId).toBeNull()
    })

    it('ADMIN alcança e edita curso de qualquer setor, inclusive movendo para outro', async () => {
      const { course } = await makeCourseWithContent(DEFAULT_SECTOR_ID)
      const admin = await makeActor({ role: 'ADMIN' })

      const dto = await updateCourse({ courseId: course.id, data: { sectorId: OUTRO_SETOR }, actor: admin })
      expect(dto.title).toBe(course.title)
      expect((await prisma.course.findUniqueOrThrow({ where: { id: course.id } })).sectorId).toBe(OUTRO_SETOR)
    })

    it('pedido de SUBADMIN pra mover curso de setor em update é ignorado, não recusado', async () => {
      const { course } = await makeCourseWithContent(DEFAULT_SECTOR_ID)
      const actor = await makeActor()

      const dto = await updateCourse({
        courseId: course.id,
        data: { title: 'Renomeado', sectorId: OUTRO_SETOR },
        actor,
      })

      expect(dto.title).toBe('Renomeado')
      expect((await prisma.course.findUniqueOrThrow({ where: { id: course.id } })).sectorId).toBe(DEFAULT_SECTOR_ID)
    })
  })

  it('erro de recorte é sempre CourseAdminError com status 404', async () => {
    const { course } = await makeCourseWithContent(null)
    const actor = await makeActor()

    try {
      await deleteCourse({ courseId: course.id, actor })
      expect.unreachable()
    } catch (err) {
      expect(err).toBeInstanceOf(CourseAdminError)
      expect((err as CourseAdminError).status).toBe(404)
    }
  })
})

/**
 * O recorte por setor decide o que o ator ALCANÇA; isto aqui é a outra metade:
 * o setor referenciado precisa ser da MESMA empresa. Mesmo teste (e mesma
 * forma) do que a `main` fez para desafio no commit 1ba06ddf.
 */
describe('course-admin-service — sectorId precisa ser da mesma empresa', () => {
  async function makeSectorOfAnotherCompany(slug: string) {
    const company = await prisma.company.create({ data: { name: `Outra Empresa ${slug}`, slug: `empresa-${slug}` } })
    return prisma.sector.create({ data: { name: 'Setor de fora', slug: `setor-${slug}`, companyId: company.id } })
  }

  it('rejeita sectorId de outra empresa na criação (404)', async () => {
    const actor = await makeActor({ role: 'ADMIN' })
    const foreign = await makeSectorOfAnotherCompany('curso-create')

    await expect(
      createCourse({ data: { title: 'Curso', sectorId: foreign.id }, actor }),
    ).rejects.toMatchObject({ status: 404, message: 'Setor não encontrado.' })
    expect(await prisma.course.count({ where: { title: 'Curso' } })).toBe(0)
  })

  it('rejeita sectorId inexistente na criação (404, nunca P2003 cru virando 500)', async () => {
    const actor = await makeActor({ role: 'ADMIN' })

    await expect(
      createCourse({ data: { title: 'Curso', sectorId: 'setor-que-nao-existe' }, actor }),
    ).rejects.toMatchObject({ status: 404, message: 'Setor não encontrado.' })
  })

  it('rejeita sectorId de outra empresa na atualização (404) e não move o curso', async () => {
    const { course } = await makeCourseWithContent(null)
    const actor = await makeActor({ role: 'ADMIN' })
    const foreign = await makeSectorOfAnotherCompany('curso-update')

    await expect(updateCourse({ courseId: course.id, data: { sectorId: foreign.id }, actor })).rejects.toMatchObject({
      status: 404,
      message: 'Setor não encontrado.',
    })
    expect((await prisma.course.findUniqueOrThrow({ where: { id: course.id } })).sectorId).toBeNull()
  })

  it('setor da própria empresa continua sendo aceito na criação e na atualização', async () => {
    const actor = await makeActor({ role: 'ADMIN' })

    const created = await createCourse({ data: { title: 'Curso local', sectorId: OUTRO_SETOR }, actor })
    expect(created.sectorId).toBe(OUTRO_SETOR)

    const updated = await updateCourse({ courseId: created.id, data: { sectorId: DEFAULT_SECTOR_ID }, actor })
    expect(updated.sectorId).toBe(DEFAULT_SECTOR_ID)
  })

  it('SUBADMIN segue ignorando (não recusando) um sectorId alheio — inclusive um de outra empresa', async () => {
    const { course } = await makeCourseWithContent(DEFAULT_SECTOR_ID)
    const actor = await makeActor({ role: 'SUBADMIN' })
    const foreign = await makeSectorOfAnotherCompany('curso-subadmin')

    const updated = await updateCourse({ courseId: course.id, data: { title: 'Novo título', sectorId: foreign.id }, actor })

    expect(updated.title).toBe('Novo título')
    expect(updated.sectorId).toBe(DEFAULT_SECTOR_ID)
  })
})

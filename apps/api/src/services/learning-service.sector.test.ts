import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SECTOR_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import {
  LearningError,
  enrollInCourse,
  getCourseDetail,
  learningHome,
  learningSummary,
  listCourses,
  listTracks,
  myLearning,
  setLessonCompletion,
} from './learning-service'

const COMPANY = 'company-emr'
/** Setor de quem NÃO é o leitor: tudo que estiver preso a ele precisa sumir. */
const OUTRO_SETOR = 'sector-outro'

interface CourseFixture {
  id: string
  lessonId: string
}

async function makeCourse(input: {
  slug: string
  sectorId: string | null
  category?: string
  competency?: string
}): Promise<CourseFixture> {
  const course = await prisma.course.create({
    data: {
      slug: input.slug,
      title: `Curso ${input.slug}`,
      category: input.category ?? 'Liderança',
      competencies: [input.competency ?? 'Liderança'],
      published: true,
      publishedAt: new Date(),
      // Todos obrigatórios: é o que faz o resumo de pendentes discriminar o recorte.
      mandatory: true,
      sectorId: input.sectorId,
    },
  })
  const courseModule = await prisma.courseModule.create({ data: { courseId: course.id, title: 'Módulo 1' } })
  const lesson = await prisma.courseLesson.create({
    data: { courseId: course.id, moduleId: courseModule.id, title: 'Aula 1', durationMinutes: 30, sortOrder: 0 },
  })
  return { id: course.id, lessonId: lesson.id }
}

async function makeTrackWith(courseIds: string[]): Promise<string> {
  const track = await prisma.learningTrack.create({
    data: { title: 'Trilha de liderança', category: 'Liderança', published: true },
  })
  await prisma.learningTrackCourse.createMany({
    data: courseIds.map((courseId, index) => ({ trackId: track.id, courseId, sortOrder: index })),
  })
  return track.id
}

/** Inscrição criada direto no banco: o caminho de leitura precisa recortar sozinho,
 *  sem depender de `enrollInCourse` ter recusado antes (setor pode mudar depois). */
async function enrollDirectly(userId: string, courseId: string): Promise<void> {
  await prisma.courseEnrollment.create({ data: { userId, courseId, lastAccessedAt: new Date() } })
}

const titlesOf = (courses: { title: string }[]) => courses.map((course) => course.title).sort()

describe('recorte por setor na leitura', () => {
  let viewer: { userId: string; companyId: string }
  let semSetor: CourseFixture
  let doMeuSetor: CourseFixture
  let deOutroSetor: CourseFixture

  beforeEach(async () => {
    await prisma.sector.create({ data: { id: OUTRO_SETOR, name: 'Outro setor', slug: 'outro-setor' } })
    // `sectorId` do usuário nasce com o default do schema (DEFAULT_SECTOR_ID).
    const user = await prisma.user.create({ data: { name: 'Dev', email: 'dev@empresa.com', passwordHash: 'x' } })
    expect(user.sectorId).toBe(DEFAULT_SECTOR_ID)
    viewer = { userId: user.id, companyId: COMPANY }

    semSetor = await makeCourse({ slug: 'sem-setor', sectorId: null })
    doMeuSetor = await makeCourse({ slug: 'do-meu-setor', sectorId: DEFAULT_SECTOR_ID })
    deOutroSetor = await makeCourse({
      slug: 'de-outro-setor',
      sectorId: OUTRO_SETOR,
      category: 'Categoria do outro setor',
      competency: 'Competência do outro setor',
    })
    await makeTrackWith([semSetor.id, doMeuSetor.id, deOutroSetor.id])
  })

  it('catálogo mostra curso sem setor e do próprio setor, e nem o nome da categoria do outro setor vaza', async () => {
    const { courses, categories, competencies } = await listCourses(viewer)

    expect(titlesOf(courses)).toEqual(['Curso do-meu-setor', 'Curso sem-setor'])
    expect(categories).not.toContain('Categoria do outro setor')
    expect(competencies).not.toContain('Competência do outro setor')
  })

  it('busca livre por título ou competência do outro setor não devolve nada', async () => {
    // A busca monta um `OR` na raiz do `where`; se o recorte usasse a mesma chave,
    // um dos dois sumiria em silêncio — e seria exatamente aqui que o curso vazaria.
    expect((await listCourses(viewer, { search: 'de-outro-setor' })).courses).toEqual([])
    expect((await listCourses(viewer, { search: 'Competência do outro setor' })).courses).toEqual([])
    expect(titlesOf((await listCourses(viewer, { search: 'Curso' })).courses)).toEqual([
      'Curso do-meu-setor',
      'Curso sem-setor',
    ])
  })

  it('"meus cursos" não devolve inscrição em curso de outro setor', async () => {
    await enrollDirectly(viewer.userId, semSetor.id)
    await enrollDirectly(viewer.userId, doMeuSetor.id)
    await enrollDirectly(viewer.userId, deOutroSetor.id)

    const { enrollments } = await myLearning(viewer)

    expect(titlesOf(enrollments.map((enrollment) => enrollment.course))).toEqual([
      'Curso do-meu-setor',
      'Curso sem-setor',
    ])
  })

  it('curso obrigatório de outro setor não conta como pendente no resumo', async () => {
    const summary = await learningSummary(viewer)

    // Três obrigatórios no banco; só dois estão ao alcance de quem lê.
    expect(summary.pendingMandatory).toBe(2)
  })

  it('resumo não conta inscrição de outro setor em andamento, mas preserva certificado já emitido', async () => {
    await enrollDirectly(viewer.userId, semSetor.id)
    await enrollDirectly(viewer.userId, doMeuSetor.id)
    await enrollDirectly(viewer.userId, deOutroSetor.id)
    await prisma.certificate.create({
      data: {
        code: 'EMR-TESTE001',
        userId: viewer.userId,
        courseId: deOutroSetor.id,
        title: 'Curso de-outro-setor',
        hours: 1,
      },
    })

    const summary = await learningSummary(viewer)

    // `inProgress` precisa bater com o `continueLearning` da home, que é recortado.
    expect(summary.inProgress).toBe(2)
    // Certificado é registro da pessoa, não catálogo: continua contando de propósito.
    expect(summary.certificates).toBe(1)
  })

  it('o recorte sobrevive à combinação de filtros do catálogo', async () => {
    // Guarda de composição: nenhum filtro do catálogo pode encostar no recorte,
    // porque todos entram como item do mesmo `AND`, nunca por spread de chave.
    // Filtros que os três cursos satisfazem: só o recorte de setor pode tirar o
    // curso de outro setor daqui.
    const { courses } = await listCourses(viewer, { search: 'Curso', level: 'BEGINNER', onlyMandatory: true })

    expect(titlesOf(courses)).toEqual(['Curso do-meu-setor', 'Curso sem-setor'])
  })

  it('trilha não lista curso de outro setor', async () => {
    const tracks = await listTracks(viewer)

    expect(tracks).toHaveLength(1)
    expect(titlesOf(tracks[0].courses)).toEqual(['Curso do-meu-setor', 'Curso sem-setor'])
  })

  it('a home de aprendizado não vaza curso de outro setor em nenhuma seção', async () => {
    const home = await learningHome(viewer)

    const secoes = [home.mandatory, home.recommended, home.newest, home.popular, ...home.tracks.map((t) => t.courses)]
    for (const secao of secoes) {
      expect(secao.map((course) => course.title)).not.toContain('Curso de-outro-setor')
    }
  })

  it('getCourseDetail responde 404 — nunca 403 — para curso de outro setor, e abre os do alcance', async () => {
    await expect(getCourseDetail(viewer, deOutroSetor.id)).rejects.toBeInstanceOf(LearningError)
    await expect(getCourseDetail(viewer, deOutroSetor.id)).rejects.toMatchObject({ status: 404 })

    expect((await getCourseDetail(viewer, semSetor.id)).title).toBe('Curso sem-setor')
    expect((await getCourseDetail(viewer, doMeuSetor.id)).title).toBe('Curso do-meu-setor')
  })

  it('enrollInCourse responde 404 e não cria inscrição em curso de outro setor', async () => {
    await expect(enrollInCourse(viewer, deOutroSetor.id)).rejects.toMatchObject({ status: 404 })
    expect(await prisma.courseEnrollment.count({ where: { courseId: deOutroSetor.id } })).toBe(0)

    const enrollment = await enrollInCourse(viewer, semSetor.id)
    expect(enrollment.courseId).toBe(semSetor.id)
  })

  it('marcar aula de curso de outro setor responde 404 mesmo com inscrição já existente', async () => {
    await enrollDirectly(viewer.userId, deOutroSetor.id)

    await expect(setLessonCompletion(viewer, deOutroSetor.lessonId, true)).rejects.toMatchObject({ status: 404 })
    expect(await prisma.lessonProgress.count({ where: { userId: viewer.userId } })).toBe(0)
  })
})

/**
 * Preservação do comportamento em produção: todo curso existente tem `sectorId`
 * nulo, logo continua visível para qualquer pessoa, de qualquer setor. Este teste
 * passa antes E depois da implementação de propósito — é exatamente a garantia de
 * que a feature já entregue não muda de comportamento.
 */
describe('curso sem setor (todo curso existente) continua visível para qualquer setor', () => {
  it('aparece no catálogo, em "meus cursos", nos obrigatórios e na trilha, e abre normalmente', async () => {
    await prisma.sector.create({ data: { id: OUTRO_SETOR, name: 'Outro setor', slug: 'outro-setor' } })
    const user = await prisma.user.create({
      data: { name: 'De outro setor', email: 'outro@empresa.com', passwordHash: 'x', sectorId: OUTRO_SETOR },
    })
    const viewer = { userId: user.id, companyId: COMPANY }
    const legado = await makeCourse({ slug: 'legado', sectorId: null })
    await makeTrackWith([legado.id])

    const { courses } = await listCourses(viewer)
    expect(titlesOf(courses)).toEqual(['Curso legado'])

    const detail = await getCourseDetail(viewer, legado.id)
    expect(detail.title).toBe('Curso legado')

    const enrollment = await enrollInCourse(viewer, legado.id)
    expect(enrollment.courseId).toBe(legado.id)

    const { enrollments, summary } = await myLearning(viewer)
    expect(titlesOf(enrollments.map((row) => row.course))).toEqual(['Curso legado'])
    expect(summary.pendingMandatory).toBe(1)

    const tracks = await listTracks(viewer)
    expect(titlesOf(tracks[0].courses)).toEqual(['Curso legado'])

    const progress = await setLessonCompletion(viewer, legado.lessonId, true)
    expect(progress.progressPct).toBe(100)
  })
})

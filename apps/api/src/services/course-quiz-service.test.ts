import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Prisma, type QuizAttempt } from '@prisma/client'
import { DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID, type QuizOption } from '@legends/shared'
import { prisma } from '../lib/prisma'
import type { CourseActor } from './course-admin-service'
import {
  createAttemptWithRetry,
  createQuestion,
  createQuiz,
  deleteQuestion,
  deleteQuiz,
  getQuizForAuthor,
  getQuizForRespondent,
  listQuizzesForCourse,
  reorderQuestions,
  submitQuizAttempt,
  updateQuestion,
  updateQuiz,
} from './course-quiz-service'
import { listCertificates, setLessonCompletion } from './learning-service'

const OUTRO_SETOR = 'setor-outro-course-quiz'

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

async function makeCourse(sectorId: string | null) {
  return prisma.course.create({
    data: {
      slug: `curso-quiz-${Math.random().toString(36).slice(2)}`,
      title: 'Curso de teste',
      category: 'Liderança',
      sectorId,
    },
  })
}

async function makeLesson(courseId: string) {
  const courseModule = await prisma.courseModule.create({ data: { courseId, title: 'Módulo 1', sortOrder: 0 } })
  return prisma.courseLesson.create({
    data: { courseId, moduleId: courseModule.id, title: 'Aula 1', type: 'TEXT', sortOrder: 0 },
  })
}

/** Curso publicado e alcançável — só assim o respondente enxerga o quiz (ver `visibleCourseWhere`). */
async function makePublishedCourse(sectorId: string | null) {
  return prisma.course.create({
    data: {
      slug: `curso-resp-${Math.random().toString(36).slice(2)}`,
      title: 'Curso respondível',
      category: 'Liderança',
      sectorId,
      published: true,
      publishedAt: new Date(),
    },
  })
}

/** Pessoa comum (não autora) que vai responder o quiz. */
async function makeRespondent(sectorId: string = DEFAULT_SECTOR_ID) {
  const user = await prisma.user.create({
    data: {
      name: 'Respondente',
      email: `respondente-${Math.random().toString(36).slice(2)}@empresa.com`,
      passwordHash: 'x',
      role: 'LEGEND',
      sectorId,
      companyId: DEFAULT_COMPANY_ID,
    },
  })
  return { userId: user.id, companyId: DEFAULT_COMPANY_ID }
}

function enroll(userId: string, courseId: string) {
  return prisma.courseEnrollment.create({ data: { userId, courseId, lastAccessedAt: new Date() } })
}

const twoOptions = (correctIndex = 0): QuizOption[] => [
  { id: 'op-1', text: 'Opção 1', correct: correctIndex === 0 },
  { id: 'op-2', text: 'Opção 2', correct: correctIndex === 1 },
]

beforeEach(async () => {
  await prisma.sector.create({ data: { id: OUTRO_SETOR, name: 'Outro setor', slug: 'outro-setor-course-quiz' } })
})

describe('course-quiz-service — quiz', () => {
  describe('quiz final — um por curso', () => {
    it('cria o quiz final do curso', async () => {
      const course = await makeCourse(DEFAULT_SECTOR_ID)
      const actor = await makeActor()

      const dto = await createQuiz({ courseId: course.id, data: { title: 'Prova final' }, actor })

      expect(dto.lessonId).toBeNull()
      expect(dto.courseId).toBe(course.id)
      expect(dto.passingScore).toBe(70)
      expect(dto.maxAttempts).toBeNull()
      expect(dto.questionCount).toBe(0)
    })

    it('segunda tentativa de quiz final no mesmo curso recebe 409', async () => {
      const course = await makeCourse(DEFAULT_SECTOR_ID)
      const actor = await makeActor()
      await createQuiz({ courseId: course.id, data: { title: 'Prova final' }, actor })

      await expect(createQuiz({ courseId: course.id, data: { title: 'Outra prova final' }, actor })).rejects.toMatchObject({
        status: 409,
        message: 'Este curso já tem um quiz final.',
      })
    })
  })

  describe('quiz de aula — uma aula, no máximo um quiz', () => {
    it('cria o quiz de uma aula', async () => {
      const course = await makeCourse(DEFAULT_SECTOR_ID)
      const lesson = await makeLesson(course.id)
      const actor = await makeActor()

      const dto = await createQuiz({ courseId: course.id, data: { title: 'Quiz da aula', lessonId: lesson.id }, actor })

      expect(dto.lessonId).toBe(lesson.id)
    })

    it('segunda tentativa de quiz na mesma aula recebe 409 com mensagem clara (P2002 mapeado)', async () => {
      const course = await makeCourse(DEFAULT_SECTOR_ID)
      const lesson = await makeLesson(course.id)
      const actor = await makeActor()
      await createQuiz({ courseId: course.id, data: { title: 'Quiz da aula', lessonId: lesson.id }, actor })

      await expect(
        createQuiz({ courseId: course.id, data: { title: 'Quiz duplicado', lessonId: lesson.id }, actor }),
      ).rejects.toMatchObject({ status: 409, message: 'Esta aula já tem um quiz.' })
    })

    it('lessonId de outro curso é rejeitado', async () => {
      const course = await makeCourse(DEFAULT_SECTOR_ID)
      const otherCourse = await makeCourse(DEFAULT_SECTOR_ID)
      const otherLesson = await makeLesson(otherCourse.id)
      const actor = await makeActor()

      await expect(
        createQuiz({ courseId: course.id, data: { title: 'Quiz intruso', lessonId: otherLesson.id }, actor }),
      ).rejects.toMatchObject({ status: 400 })
    })
  })

  describe('validação de passingScore e maxAttempts', () => {
    it('rejeita passingScore fora de 0..100', async () => {
      const course = await makeCourse(DEFAULT_SECTOR_ID)
      const actor = await makeActor()

      await expect(createQuiz({ courseId: course.id, data: { title: 'Quiz', passingScore: 101 }, actor })).rejects.toMatchObject({
        status: 400,
      })
      await expect(createQuiz({ courseId: course.id, data: { title: 'Quiz', passingScore: -1 }, actor })).rejects.toMatchObject({
        status: 400,
      })
    })

    it('aceita maxAttempts nulo (ilimitado) e rejeita menor que 1', async () => {
      const course = await makeCourse(DEFAULT_SECTOR_ID)
      const actor = await makeActor()

      const dto = await createQuiz({ courseId: course.id, data: { title: 'Quiz', maxAttempts: null }, actor })
      expect(dto.maxAttempts).toBeNull()

      await expect(
        createQuiz({ courseId: course.id, data: { title: 'Quiz aula', maxAttempts: 0 }, actor }),
      ).rejects.toMatchObject({ status: 400 })
    })
  })

  describe('update e delete de quiz', () => {
    it('atualiza título, passingScore e maxAttempts', async () => {
      const course = await makeCourse(DEFAULT_SECTOR_ID)
      const actor = await makeActor()
      const created = await createQuiz({ courseId: course.id, data: { title: 'Quiz' }, actor })

      const updated = await updateQuiz({
        quizId: created.id,
        data: { title: 'Quiz atualizado', passingScore: 80, maxAttempts: 3 },
        actor,
      })

      expect(updated.title).toBe('Quiz atualizado')
      expect(updated.passingScore).toBe(80)
      expect(updated.maxAttempts).toBe(3)
    })

    it('mover quiz de aula para final quando já existe um quiz final recebe 409', async () => {
      const course = await makeCourse(DEFAULT_SECTOR_ID)
      const lesson = await makeLesson(course.id)
      const actor = await makeActor()
      await createQuiz({ courseId: course.id, data: { title: 'Prova final' }, actor })
      const lessonQuiz = await createQuiz({ courseId: course.id, data: { title: 'Quiz da aula', lessonId: lesson.id }, actor })

      await expect(updateQuiz({ quizId: lessonQuiz.id, data: { lessonId: null }, actor })).rejects.toMatchObject({
        status: 409,
        message: 'Este curso já tem um quiz final.',
      })
    })

    it('apaga o quiz (e cai em cascata as questões)', async () => {
      const course = await makeCourse(DEFAULT_SECTOR_ID)
      const actor = await makeActor()
      const created = await createQuiz({ courseId: course.id, data: { title: 'Quiz' }, actor })
      await createQuestion({ quizId: created.id, data: { statement: 'Pergunta?', options: twoOptions() }, actor })

      await deleteQuiz({ quizId: created.id, actor })

      await expect(getQuizForAuthor(actor, created.id)).rejects.toMatchObject({ status: 404 })
      expect(await prisma.courseQuestion.count({ where: { quizId: created.id } })).toBe(0)
    })
  })

  describe('listagem e leitura', () => {
    it('lista quizzes do curso e busca um quiz com suas questões', async () => {
      const course = await makeCourse(DEFAULT_SECTOR_ID)
      const actor = await makeActor()
      const quiz = await createQuiz({ courseId: course.id, data: { title: 'Quiz' }, actor })
      await createQuestion({ quizId: quiz.id, data: { statement: 'P1?', options: twoOptions() }, actor })

      const list = await listQuizzesForCourse(actor, course.id)
      expect(list).toHaveLength(1)
      expect(list[0].questionCount).toBe(1)

      const full = await getQuizForAuthor(actor, quiz.id)
      expect(full.questions).toHaveLength(1)
      expect(full.questions[0].statement).toBe('P1?')
    })
  })

  describe('auditoria', () => {
    it('createQuiz, updateQuiz e deleteQuiz gravam AdminAuditLog', async () => {
      const course = await makeCourse(DEFAULT_SECTOR_ID)
      const actor = await makeActor()

      const created = await createQuiz({ courseId: course.id, data: { title: 'Quiz' }, actor })
      expect(await prisma.adminAuditLog.count({ where: { entityType: 'CourseQuiz', entityId: created.id, action: 'CREATE' } })).toBe(1)

      await updateQuiz({ quizId: created.id, data: { title: 'Renomeado' }, actor })
      expect(await prisma.adminAuditLog.count({ where: { entityType: 'CourseQuiz', entityId: created.id, action: 'UPDATE' } })).toBe(1)

      await deleteQuiz({ quizId: created.id, actor })
      expect(await prisma.adminAuditLog.count({ where: { entityType: 'CourseQuiz', entityId: created.id, action: 'DELETE' } })).toBe(1)
    })
  })

  describe('recorte por setor — SUBADMIN não alcança quiz de curso fora do próprio setor', () => {
    it('404 ao criar quiz em curso sem setor (empresa toda) e de outro setor', async () => {
      const noSector = await makeCourse(null)
      const otherSector = await makeCourse(OUTRO_SETOR)
      const actor = await makeActor()

      await expect(createQuiz({ courseId: noSector.id, data: { title: 'Quiz' }, actor })).rejects.toMatchObject({ status: 404 })
      await expect(createQuiz({ courseId: otherSector.id, data: { title: 'Quiz' }, actor })).rejects.toMatchObject({ status: 404 })
    })

    it('404 ao editar/apagar quiz de curso fora do setor do ator', async () => {
      const otherSector = await makeCourse(OUTRO_SETOR)
      const admin = await makeActor({ role: 'ADMIN' })
      const quiz = await createQuiz({ courseId: otherSector.id, data: { title: 'Quiz' }, actor: admin })
      const subadmin = await makeActor()

      await expect(updateQuiz({ quizId: quiz.id, data: { title: 'X' }, actor: subadmin })).rejects.toMatchObject({ status: 404 })
      await expect(deleteQuiz({ quizId: quiz.id, actor: subadmin })).rejects.toMatchObject({ status: 404 })
    })

    it('ADMIN alcança e edita quiz de qualquer setor', async () => {
      const otherSector = await makeCourse(OUTRO_SETOR)
      const admin = await makeActor({ role: 'ADMIN' })
      const quiz = await createQuiz({ courseId: otherSector.id, data: { title: 'Quiz' }, actor: admin })

      const updated = await updateQuiz({ quizId: quiz.id, data: { title: 'Editado pelo admin' }, actor: admin })
      expect(updated.title).toBe('Editado pelo admin')
    })
  })
})

describe('course-quiz-service — questões', () => {
  async function makeQuiz(actor: CourseActor, sectorId: string | null = DEFAULT_SECTOR_ID) {
    const course = await makeCourse(sectorId)
    return createQuiz({ courseId: course.id, data: { title: 'Quiz' }, actor })
  }

  describe('validação de opções via quizOptionsSchema', () => {
    it('rejeita questão com menos de duas opções', async () => {
      const actor = await makeActor()
      const quiz = await makeQuiz(actor)

      await expect(
        createQuestion({ quizId: quiz.id, data: { statement: 'P?', options: [{ id: 'a', text: 'A', correct: true }] }, actor }),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('rejeita questão sem nenhuma opção correta', async () => {
      const actor = await makeActor()
      const quiz = await makeQuiz(actor)

      await expect(
        createQuestion({
          quizId: quiz.id,
          data: {
            statement: 'P?',
            options: [
              { id: 'a', text: 'A', correct: false },
              { id: 'b', text: 'B', correct: false },
            ],
          },
          actor,
        }),
      ).rejects.toMatchObject({ status: 400 })
    })

    it('cria questão válida com duas opções e uma correta', async () => {
      const actor = await makeActor()
      const quiz = await makeQuiz(actor)

      const question = await createQuestion({ quizId: quiz.id, data: { statement: 'P?', options: twoOptions() }, actor })

      expect(question.statement).toBe('P?')
      expect(question.options).toHaveLength(2)
      expect(question.sortOrder).toBe(0)
    })

    // Id repetido dentro da questão corrompe a correção (ela casa a resposta
    // por id): a escolha de uma opção passa a valer pela outra. O editor do
    // web deixava isso acontecer sozinho depois de um reload — mas a regra
    // precisa estar no servidor, que não pode confiar no cliente.
    it('recusa opções com id repetido', async () => {
      const actor = await makeActor()
      const quiz = await makeQuiz(actor)

      await expect(
        createQuestion({
          quizId: quiz.id,
          data: {
            statement: 'Questão com id repetido',
            options: [
              { id: 'op-1', text: 'Certa', correct: true },
              { id: 'op-1', text: 'Errada', correct: false },
            ],
          },
          actor,
        }),
      ).rejects.toMatchObject({
        status: 400,
        message: 'As opções da questão não podem repetir o mesmo identificador.',
      })
    })
  })

describe('posição da nova questão — max(sortOrder) + 1, nunca count()', () => {
    it('cria posição correta depois de apagar uma questão do meio', async () => {
      const actor = await makeActor()
      const quiz = await makeQuiz(actor)

      const q1 = await createQuestion({ quizId: quiz.id, data: { statement: 'Q1', options: twoOptions() }, actor })
      const q2 = await createQuestion({ quizId: quiz.id, data: { statement: 'Q2', options: twoOptions() }, actor })
      const q3 = await createQuestion({ quizId: quiz.id, data: { statement: 'Q3', options: twoOptions() }, actor })
      expect([q1.sortOrder, q2.sortOrder, q3.sortOrder]).toEqual([0, 1, 2])

      // Apaga a questão do meio (sortOrder 1). Se a próxima posição vier de
      // `count()` (agora 2), ela colidiria com o sortOrder 2 já existente (q3).
      await deleteQuestion({ questionId: q2.id, actor })

      const q4 = await createQuestion({ quizId: quiz.id, data: { statement: 'Q4', options: twoOptions() }, actor })
      expect(q4.sortOrder).toBe(3)

      const all = await getQuizForAuthor(actor, quiz.id)
      const sortOrders = all.questions.map((q) => q.sortOrder).sort((a, b) => a - b)
      expect(sortOrders).toEqual([0, 2, 3])
      expect(new Set(sortOrders).size).toBe(sortOrders.length)
    })
  })

  describe('update e delete de questão', () => {
    it('atualiza enunciado, opções e explicação', async () => {
      const actor = await makeActor()
      const quiz = await makeQuiz(actor)
      const question = await createQuestion({ quizId: quiz.id, data: { statement: 'P?', options: twoOptions() }, actor })

      const updated = await updateQuestion({
        questionId: question.id,
        data: { statement: 'P atualizada?', options: twoOptions(1), explanation: 'Porque sim.' },
        actor,
      })

      expect(updated.statement).toBe('P atualizada?')
      expect(updated.explanation).toBe('Porque sim.')
      expect(updated.options.find((o) => o.id === 'op-2')?.correct).toBe(true)
    })

    it('updateQuestion NÃO move a questão mesmo recebendo sortOrder — só reorderQuestions muda posição', async () => {
      const actor = await makeActor()
      const quiz = await makeQuiz(actor)
      const a = await createQuestion({ quizId: quiz.id, data: { statement: 'A', options: twoOptions() }, actor })
      const b = await createQuestion({ quizId: quiz.id, data: { statement: 'B', options: twoOptions() }, actor })
      const c = await createQuestion({ quizId: quiz.id, data: { statement: 'C', options: twoOptions() }, actor })
      expect([a.sortOrder, b.sortOrder, c.sortOrder]).toEqual([0, 1, 2])

      // `sortOrder` foi removido de `UpdateQuizQuestionRequest` (Task 6): a única
      // forma de mudar posição é `reorderQuestions`, que valida a lista completa
      // de ids. Este teste simula um corpo de requisição bruto (JSON não passa
      // pelo checador de tipos) com `sortOrder` solto, pra garantir que o service
      // continua ignorando o campo mesmo que ele chegue por fora do contrato —
      // sem essa guarda, ele empataria posições, já que `CourseQuestion` não tem
      // `@@unique([quizId, sortOrder])`.
      const rawBody = { sortOrder: 2, statement: 'A editada' } as unknown as { statement: string }
      const updated = await updateQuestion({ questionId: a.id, data: rawBody, actor })

      expect(updated.statement).toBe('A editada')
      expect(updated.sortOrder).toBe(0)

      const sortOrders = (await prisma.courseQuestion.findMany({ where: { quizId: quiz.id }, orderBy: { sortOrder: 'asc' } })).map(
        (q) => q.sortOrder,
      )
      expect(sortOrders).toEqual([0, 1, 2])
      expect(new Set(sortOrders).size).toBe(sortOrders.length)
    })

    it('apaga a questão', async () => {
      const actor = await makeActor()
      const quiz = await makeQuiz(actor)
      const question = await createQuestion({ quizId: quiz.id, data: { statement: 'P?', options: twoOptions() }, actor })

      await deleteQuestion({ questionId: question.id, actor })

      const full = await getQuizForAuthor(actor, quiz.id)
      expect(full.questions).toHaveLength(0)
    })
  })

  describe('reorderQuestions — exige a lista completa de ids do quiz', () => {
    it('reordena com sucesso passando todos os ids', async () => {
      const actor = await makeActor()
      const quiz = await makeQuiz(actor)
      const q1 = await createQuestion({ quizId: quiz.id, data: { statement: 'Q1', options: twoOptions() }, actor })
      const q2 = await createQuestion({ quizId: quiz.id, data: { statement: 'Q2', options: twoOptions() }, actor })
      const q3 = await createQuestion({ quizId: quiz.id, data: { statement: 'Q3', options: twoOptions() }, actor })

      const reordered = await reorderQuestions({ quizId: quiz.id, data: { ids: [q3.id, q1.id, q2.id] }, actor })

      expect(reordered.map((q) => q.id)).toEqual([q3.id, q1.id, q2.id])
      expect(reordered.map((q) => q.sortOrder)).toEqual([0, 1, 2])

      // Evento em lote: audita o quiz dono, não uma `CourseQuestion` com
      // `entityId` do quiz (que não existiria como linha desse model).
      expect(await prisma.adminAuditLog.count({ where: { entityType: 'CourseQuiz', entityId: quiz.id, action: 'UPDATE' } })).toBe(1)
    })

    it('id faltando recebe 400 com mensagem para recarregar a página', async () => {
      const actor = await makeActor()
      const quiz = await makeQuiz(actor)
      const q1 = await createQuestion({ quizId: quiz.id, data: { statement: 'Q1', options: twoOptions() }, actor })
      await createQuestion({ quizId: quiz.id, data: { statement: 'Q2', options: twoOptions() }, actor })

      await expect(reorderQuestions({ quizId: quiz.id, data: { ids: [q1.id] }, actor })).rejects.toMatchObject({
        status: 400,
        message: 'A ordem enviada não corresponde aos itens atuais. Recarregue a página.',
      })
    })

    it('id de outro quiz (pai errado) recebe 400', async () => {
      const actor = await makeActor()
      const quiz = await makeQuiz(actor)
      const otherQuiz = await makeQuiz(actor)
      const q1 = await createQuestion({ quizId: quiz.id, data: { statement: 'Q1', options: twoOptions() }, actor })
      const q2 = await createQuestion({ quizId: quiz.id, data: { statement: 'Q2', options: twoOptions() }, actor })
      const foreign = await createQuestion({ quizId: otherQuiz.id, data: { statement: 'F1', options: twoOptions() }, actor })

      await expect(
        reorderQuestions({ quizId: quiz.id, data: { ids: [q1.id, foreign.id] }, actor }),
      ).rejects.toMatchObject({ status: 400 })
      // A questão do outro quiz não pode ter sido tocada.
      const untouched = await prisma.courseQuestion.findUniqueOrThrow({ where: { id: foreign.id } })
      expect(untouched.sortOrder).toBe(0)
      expect(q2.sortOrder).toBe(1)
    })

    it('id repetido ([a,a,b,c]) recebe 400 mesmo com o tamanho da lista batendo', async () => {
      const actor = await makeActor()
      const quiz = await makeQuiz(actor)
      const a = await createQuestion({ quizId: quiz.id, data: { statement: 'A', options: twoOptions() }, actor })
      const b = await createQuestion({ quizId: quiz.id, data: { statement: 'B', options: twoOptions() }, actor })
      const c = await createQuestion({ quizId: quiz.id, data: { statement: 'C', options: twoOptions() }, actor })
      const d = await createQuestion({ quizId: quiz.id, data: { statement: 'D', options: twoOptions() }, actor })

      // [a,a,b,c]: mesmo tamanho de existing (4), mas "d" sumiu e "a" está
      // duplicado — uma checagem que dedupliqua antes de comparar deixaria passar.
      await expect(
        reorderQuestions({ quizId: quiz.id, data: { ids: [a.id, a.id, b.id, c.id] }, actor }),
      ).rejects.toMatchObject({ status: 400, message: 'A ordem enviada não corresponde aos itens atuais. Recarregue a página.' })

      // Nenhuma questão foi corrompida pela tentativa.
      const sortOrders = (await prisma.courseQuestion.findMany({ where: { quizId: quiz.id }, orderBy: { sortOrder: 'asc' } })).map(
        (q) => q.sortOrder,
      )
      expect(sortOrders).toEqual([0, 1, 2, 3])
      void d
    })
  })

  describe('auditoria de questões', () => {
    it('createQuestion, updateQuestion e deleteQuestion gravam AdminAuditLog', async () => {
      const actor = await makeActor()
      const quiz = await makeQuiz(actor)
      const question = await createQuestion({ quizId: quiz.id, data: { statement: 'P?', options: twoOptions() }, actor })
      expect(
        await prisma.adminAuditLog.count({ where: { entityType: 'CourseQuestion', entityId: question.id, action: 'CREATE' } }),
      ).toBe(1)

      await updateQuestion({ questionId: question.id, data: { statement: 'P2?' }, actor })
      expect(
        await prisma.adminAuditLog.count({ where: { entityType: 'CourseQuestion', entityId: question.id, action: 'UPDATE' } }),
      ).toBe(1)

      await deleteQuestion({ questionId: question.id, actor })
      expect(
        await prisma.adminAuditLog.count({ where: { entityType: 'CourseQuestion', entityId: question.id, action: 'DELETE' } }),
      ).toBe(1)
    })
  })

  describe('recorte por setor — questão herda o recorte do curso do quiz', () => {
    it('404 ao criar/editar/apagar questão de quiz fora do setor do ator', async () => {
      const admin = await makeActor({ role: 'ADMIN' })
      const quiz = await makeQuiz(admin, OUTRO_SETOR)
      const question = await createQuestion({ quizId: quiz.id, data: { statement: 'P?', options: twoOptions() }, actor: admin })
      const subadmin = await makeActor()

      await expect(
        createQuestion({ quizId: quiz.id, data: { statement: 'Intrusa', options: twoOptions() }, actor: subadmin }),
      ).rejects.toMatchObject({ status: 404 })
      await expect(
        updateQuestion({ questionId: question.id, data: { statement: 'X' }, actor: subadmin }),
      ).rejects.toMatchObject({ status: 404 })
      await expect(deleteQuestion({ questionId: question.id, actor: subadmin })).rejects.toMatchObject({ status: 404 })
      await expect(
        reorderQuestions({ quizId: quiz.id, data: { ids: [question.id] }, actor: subadmin }),
      ).rejects.toMatchObject({ status: 404 })
    })
  })
})

describe('course-quiz-service — responder', () => {
  async function setupQuiz(
    opts: { passingScore?: number; maxAttempts?: number | null; sectorId?: string | null } = {},
  ) {
    const author = await makeActor({ role: 'ADMIN' })
    const course = await makePublishedCourse(opts.sectorId === undefined ? DEFAULT_SECTOR_ID : opts.sectorId)
    const quiz = await createQuiz({
      courseId: course.id,
      data: { title: 'Quiz', passingScore: opts.passingScore ?? 70, maxAttempts: opts.maxAttempts },
      actor: author,
    })
    const q1 = await createQuestion({
      quizId: quiz.id,
      data: {
        statement: 'Quanto é 2 + 2?',
        options: [
          { id: 'a', text: '3', correct: false },
          { id: 'b', text: '4', correct: true },
        ],
        explanation: 'Dois mais dois é quatro.',
      },
      actor: author,
    })
    const q2 = await createQuestion({
      quizId: quiz.id,
      data: {
        statement: 'Capital do Brasil?',
        options: [
          { id: 'a', text: 'Brasília', correct: true },
          { id: 'b', text: 'Rio de Janeiro', correct: false },
        ],
        explanation: 'A capital é Brasília.',
      },
      actor: author,
    })
    return { course, quiz, q1, q2 }
  }

  describe('gabarito nunca chega a quem responde', () => {
    it('o DTO devolvido não contém correct nem explanation, em nenhuma questão ou opção', async () => {
      const { course, quiz } = await setupQuiz()
      const respondent = await makeRespondent()
      await enroll(respondent.userId, course.id)

      const dto = await getQuizForRespondent(respondent, quiz.id)

      expect(dto.questions).toHaveLength(2)
      for (const question of dto.questions) {
        expect(question).not.toHaveProperty('explanation')
        expect(question).not.toHaveProperty('correct')
        for (const option of question.options) {
          expect(option).not.toHaveProperty('correct')
        }
      }
    })
  })

  describe('contagem de tentativas no DTO', () => {
    /**
     * O DTO não expõe histórico (nota nem resposta anterior) — só quantas
     * tentativas a pessoa já usou e quantas restam. É o que faltava para a
     * tela dizer a verdade antes do primeiro envio da sessão, em vez de
     * repetir o teto e prometer tentativa já gasta.
     */
    it('devolve usadas e restantes, descontando as tentativas anteriores da própria pessoa', async () => {
      const { course, quiz, q1 } = await setupQuiz({ maxAttempts: 3 })
      const respondent = await makeRespondent()
      await enroll(respondent.userId, course.id)

      const before = await getQuizForRespondent(respondent, quiz.id)
      expect(before.attemptsUsed).toBe(0)
      expect(before.attemptsLeft).toBe(3)

      await submitQuizAttempt(respondent, quiz.id, { answers: [{ questionId: q1.id, optionId: 'b' }] })
      await submitQuizAttempt(respondent, quiz.id, { answers: [{ questionId: q1.id, optionId: 'b' }] })

      const after = await getQuizForRespondent(respondent, quiz.id)
      expect(after.attemptsUsed).toBe(2)
      expect(after.attemptsLeft).toBe(1)
    })

    it('conta só as tentativas de quem pede — a de outra pessoa não entra', async () => {
      const { course, quiz, q1 } = await setupQuiz({ maxAttempts: 3 })
      const respondent = await makeRespondent()
      const other = await makeRespondent()
      await enroll(respondent.userId, course.id)
      await enroll(other.userId, course.id)

      await submitQuizAttempt(other, quiz.id, { answers: [{ questionId: q1.id, optionId: 'b' }] })

      const dto = await getQuizForRespondent(respondent, quiz.id)
      expect(dto.attemptsUsed).toBe(0)
      expect(dto.attemptsLeft).toBe(3)
    })

    it('tentativas ilimitadas: restantes é nulo, mas as usadas continuam contadas', async () => {
      const { course, quiz, q1 } = await setupQuiz({ maxAttempts: null })
      const respondent = await makeRespondent()
      await enroll(respondent.userId, course.id)
      await submitQuizAttempt(respondent, quiz.id, { answers: [{ questionId: q1.id, optionId: 'b' }] })

      const dto = await getQuizForRespondent(respondent, quiz.id)
      expect(dto.attemptsLeft).toBeNull()
      expect(dto.attemptsUsed).toBe(1)
    })
  })

  describe('inscrição e recorte por setor', () => {
    it('404 para quiz de curso em que a pessoa não está inscrita', async () => {
      const { quiz } = await setupQuiz()
      const respondent = await makeRespondent()

      await expect(getQuizForRespondent(respondent, quiz.id)).rejects.toMatchObject({ status: 404 })
      await expect(submitQuizAttempt(respondent, quiz.id, { answers: [] })).rejects.toMatchObject({ status: 404 })
    })

    it('404 (nunca 403) para quiz de curso fora do setor da pessoa', async () => {
      const { course, quiz } = await setupQuiz({ sectorId: OUTRO_SETOR })
      const respondent = await makeRespondent(DEFAULT_SECTOR_ID)
      await enroll(respondent.userId, course.id)

      await expect(getQuizForRespondent(respondent, quiz.id)).rejects.toMatchObject({ status: 404 })
    })
  })

  describe('quiz sem questões', () => {
    /**
     * Sem esta guarda, o quiz vazio pontuava 0: a pessoa via "Reprovado — 0%"
     * numa tela sem pergunta nenhuma e, se fosse o quiz final, ficava sem
     * certificado por causa de um quiz que o admin ainda nem terminou de
     * escrever. Com `passingScore: 0` era pior — o vazio APROVAVA.
     */
    it('recusa responder um quiz sem nenhuma questão (409) e não grava tentativa', async () => {
      const author = await makeActor({ role: 'ADMIN' })
      const course = await makePublishedCourse(DEFAULT_SECTOR_ID)
      const quiz = await createQuiz({ courseId: course.id, data: { title: 'Quiz vazio' }, actor: author })
      const respondent = await makeRespondent()
      await enroll(respondent.userId, course.id)

      await expect(submitQuizAttempt(respondent, quiz.id, { answers: [] })).rejects.toMatchObject({
        status: 409,
        message: 'Este quiz ainda não tem questões.',
      })
      expect(await prisma.quizAttempt.count({ where: { quizId: quiz.id } })).toBe(0)
    })

    it('nota de corte 0 não transforma o quiz vazio em aprovação automática', async () => {
      const author = await makeActor({ role: 'ADMIN' })
      const course = await makePublishedCourse(DEFAULT_SECTOR_ID)
      const quiz = await createQuiz({
        courseId: course.id,
        data: { title: 'Quiz vazio com corte 0', passingScore: 0 },
        actor: author,
      })
      const respondent = await makeRespondent()
      await enroll(respondent.userId, course.id)

      await expect(submitQuizAttempt(respondent, quiz.id, { answers: [] })).rejects.toMatchObject({ status: 409 })
      expect(await listCertificates(respondent)).toHaveLength(0)
    })
  })

  describe('correção no servidor', () => {
    it('calcula score e passed a partir do gabarito real, nunca do que o cliente envia', async () => {
      const { course, quiz, q1, q2 } = await setupQuiz({ passingScore: 70 })
      const respondent = await makeRespondent()
      await enroll(respondent.userId, course.id)

      // Corpo "forjado" tenta embutir score/passed prontos — devem ser ignorados.
      const forged = {
        answers: [
          { questionId: q1.id, optionId: 'b' }, // correta
          { questionId: q2.id, optionId: 'a' }, // correta
        ],
        score: 0,
        passed: false,
      } as unknown as { answers: { questionId: string; optionId: string }[] }

      const result = await submitQuizAttempt(respondent, quiz.id, forged)

      expect(result.score).toBe(100)
      expect(result.passed).toBe(true)
      expect(result.attemptNumber).toBe(1)
      expect(result.feedback).toHaveLength(2)
      expect(result.feedback.find((f) => f.questionId === q1.id)).toMatchObject({
        correct: true,
        explanation: 'Dois mais dois é quatro.',
      })
      expect(result.feedback.find((f) => f.questionId === q2.id)).toMatchObject({
        correct: true,
        explanation: 'A capital é Brasília.',
      })
    })

    it('resposta parcialmente errada rebaixa o score e passed conforme a nota de corte', async () => {
      const { course, quiz, q1, q2 } = await setupQuiz({ passingScore: 70 })
      const respondent = await makeRespondent()
      await enroll(respondent.userId, course.id)

      const result = await submitQuizAttempt(respondent, quiz.id, {
        answers: [
          { questionId: q1.id, optionId: 'b' }, // correta
          { questionId: q2.id, optionId: 'b' }, // errada
        ],
      })

      expect(result.score).toBe(50)
      expect(result.passed).toBe(false)
      expect(result.feedback.find((f) => f.questionId === q2.id)?.correct).toBe(false)
    })
  })

  describe('attemptNumber e limite de tentativas', () => {
    it('attemptNumber deriva das tentativas anteriores daquela pessoa', async () => {
      const { course, quiz, q1 } = await setupQuiz({ maxAttempts: null })
      const respondent = await makeRespondent()
      await enroll(respondent.userId, course.id)

      const first = await submitQuizAttempt(respondent, quiz.id, { answers: [{ questionId: q1.id, optionId: 'b' }] })
      const second = await submitQuizAttempt(respondent, quiz.id, { answers: [{ questionId: q1.id, optionId: 'a' }] })

      expect(first.attemptNumber).toBe(1)
      expect(second.attemptNumber).toBe(2)
      expect(first.attemptsLeft).toBeNull()
      expect(second.attemptsLeft).toBeNull()
    })

    it('acima do limite recebe 409 com o N real na mensagem', async () => {
      const { course, quiz, q1 } = await setupQuiz({ maxAttempts: 2 })
      const respondent = await makeRespondent()
      await enroll(respondent.userId, course.id)

      await submitQuizAttempt(respondent, quiz.id, { answers: [{ questionId: q1.id, optionId: 'b' }] })
      const second = await submitQuizAttempt(respondent, quiz.id, { answers: [{ questionId: q1.id, optionId: 'b' }] })
      expect(second.attemptsLeft).toBe(0)

      await expect(
        submitQuizAttempt(respondent, quiz.id, { answers: [{ questionId: q1.id, optionId: 'b' }] }),
      ).rejects.toMatchObject({
        status: 409,
        message: 'Você já usou todas as 2 tentativas deste quiz.',
      })
      expect(await prisma.quizAttempt.count({ where: { quizId: quiz.id, userId: respondent.userId } })).toBe(2)
    })

    it('duas submissões concorrentes não colidem no attemptNumber (P2002 tratado)', async () => {
      const { course, quiz, q1 } = await setupQuiz({ maxAttempts: null })
      const respondent = await makeRespondent()
      await enroll(respondent.userId, course.id)

      const [a, b] = await Promise.all([
        submitQuizAttempt(respondent, quiz.id, { answers: [{ questionId: q1.id, optionId: 'b' }] }),
        submitQuizAttempt(respondent, quiz.id, { answers: [{ questionId: q1.id, optionId: 'b' }] }),
      ])

      expect(new Set([a.attemptNumber, b.attemptNumber]).size).toBe(2)
      expect(await prisma.quizAttempt.count({ where: { quizId: quiz.id, userId: respondent.userId } })).toBe(2)
    })
  })

  // `createAttemptWithRetry` isolado: provocar de propósito o esgotamento das
  // `maxRetries` voltas exigiria vencer a corrida contra a própria chamada um
  // número exato de vezes seguidas — impraticável com Postgres real (o teste
  // de concorrência acima já cobre uma colisão isolada, não o esgotamento).
  // Aqui o `createAttempt` é injetado e sempre falha, então cada volta tem que
  // colidir de propósito.
  describe('createAttemptWithRetry — esgotamento e propagação de erro', () => {
    function fakeP2002(): Prisma.PrismaClientKnownRequestError {
      return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      })
    }

    it('esgota as tentativas por colisão (P2002) e devolve 409 — nunca o erro cru do Prisma', async () => {
      const createAttempt = vi.fn().mockRejectedValue(fakeP2002())
      const countAttempts = vi.fn().mockResolvedValue(0)

      await expect(
        createAttemptWithRetry({ maxAttempts: null, countAttempts, createAttempt, maxRetries: 3 }),
      ).rejects.toMatchObject({ status: 409, message: 'Não foi possível registrar a tentativa. Tente novamente.' })

      // As 3 voltas tentaram criar — nenhuma saiu antes da hora, nenhuma sobrou.
      expect(createAttempt).toHaveBeenCalledTimes(3)
    })

    it('erro que não é P2002 sobe imediatamente — não é tratado como corrida, não esgota tentativas', async () => {
      const boom = new Error('falha de conexão, não é conflito de índice')
      const createAttempt = vi.fn().mockRejectedValue(boom)
      const countAttempts = vi.fn().mockResolvedValue(0)

      await expect(
        createAttemptWithRetry({ maxAttempts: null, countAttempts, createAttempt, maxRetries: 5 }),
      ).rejects.toBe(boom)

      expect(createAttempt).toHaveBeenCalledTimes(1)
    })

    it('recupera de uma colisão isolada e cria normalmente na volta seguinte', async () => {
      const createAttempt = vi
        .fn()
        .mockRejectedValueOnce(fakeP2002())
        .mockResolvedValueOnce({ attemptNumber: 2 } as QuizAttempt)
      const countAttempts = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2)

      const result = await createAttemptWithRetry({ maxAttempts: null, countAttempts, createAttempt, maxRetries: 5 })

      expect(result).toEqual({ attemptNumber: 2 })
      expect(createAttempt).toHaveBeenCalledTimes(2)
    })
  })
})

/**
 * Ordem natural do curso: terminar as aulas primeiro, passar no quiz final
 * depois. Antes de `tryIssueCertificateAfterFinalQuiz`, essa ordem era um beco
 * sem saída — a emissão só era tentada por `setLessonCompletion`, então quem
 * concluísse as aulas com o quiz final ainda não aprovado nunca mais tinha
 * outro gatilho. Os testes anteriores só passavam porque semeavam a
 * `QuizAttempt` aprovada ANTES de marcar a última aula.
 */
describe('course-quiz-service — passar no quiz final emite o certificado', () => {
  /** Curso publicado com uma aula e um quiz final de uma questão. */
  async function setupCourseWithFinalQuiz(opts: { requiresApproval?: boolean } = {}) {
    const author = await makeActor({ role: 'ADMIN' })
    const course = await makePublishedCourse(DEFAULT_SECTOR_ID)
    if (opts.requiresApproval) {
      await prisma.course.update({ where: { id: course.id }, data: { requiresCertificateApproval: true } })
    }
    const lesson = await makeLesson(course.id)
    const quiz = await createQuiz({
      courseId: course.id,
      data: { title: 'Quiz final', passingScore: 70 },
      actor: author,
    })
    const question = await createQuestion({
      quizId: quiz.id,
      data: { statement: 'Quanto é 2 + 2?', options: twoOptions(1) },
      actor: author,
    })
    return { course, lesson, quiz, question }
  }

  it('concluir as aulas não emite (quiz final pendente) e passar no quiz final emite', async () => {
    const { course, lesson, quiz, question } = await setupCourseWithFinalQuiz()
    const respondent = await makeRespondent()
    await enroll(respondent.userId, course.id)

    // 1. Todas as aulas concluídas: a inscrição fecha, mas o quiz final segura o certificado.
    const completion = await setLessonCompletion(respondent, lesson.id, true)
    expect(completion.status).toBe('COMPLETED')
    expect(completion.certificate).toBeNull()
    expect(await listCertificates(respondent)).toHaveLength(0)

    // 2. Passar no quiz final: agora sim.
    const result = await submitQuizAttempt(respondent, quiz.id, {
      answers: [{ questionId: question.id, optionId: 'op-2' }],
    })
    expect(result.passed).toBe(true)

    const certificates = await listCertificates(respondent)
    expect(certificates).toHaveLength(1)
    expect(certificates[0].courseId).toBe(course.id)
  })

  it('curso com aprovação obrigatória: passar no quiz final cria a solicitação PENDENTE, sem emitir', async () => {
    const { course, lesson, quiz, question } = await setupCourseWithFinalQuiz({ requiresApproval: true })
    const respondent = await makeRespondent()
    await enroll(respondent.userId, course.id)

    await setLessonCompletion(respondent, lesson.id, true)
    expect(await prisma.certificateRequest.count({ where: { userId: respondent.userId } })).toBe(0)

    await submitQuizAttempt(respondent, quiz.id, { answers: [{ questionId: question.id, optionId: 'op-2' }] })

    expect(await listCertificates(respondent)).toHaveLength(0)
    const requests = await prisma.certificateRequest.findMany({ where: { userId: respondent.userId, courseId: course.id } })
    expect(requests).toHaveLength(1)
    expect(requests[0].status).toBe('PENDING')
  })

  it('passar no quiz final sem ter concluído as aulas não emite nada — a guarda de inscrição segue valendo', async () => {
    const { course, quiz, question } = await setupCourseWithFinalQuiz()
    const respondent = await makeRespondent()
    await enroll(respondent.userId, course.id)

    const result = await submitQuizAttempt(respondent, quiz.id, {
      answers: [{ questionId: question.id, optionId: 'op-2' }],
    })

    expect(result.passed).toBe(true)
    expect(await listCertificates(respondent)).toHaveLength(0)
    expect(await prisma.certificateRequest.count({ where: { userId: respondent.userId } })).toBe(0)
  })

  it('reprovar no quiz final não emite', async () => {
    const { course, lesson, quiz, question } = await setupCourseWithFinalQuiz()
    const respondent = await makeRespondent()
    await enroll(respondent.userId, course.id)
    await setLessonCompletion(respondent, lesson.id, true)

    const result = await submitQuizAttempt(respondent, quiz.id, {
      answers: [{ questionId: question.id, optionId: 'op-1' }],
    })

    expect(result.passed).toBe(false)
    expect(await listCertificates(respondent)).toHaveLength(0)
  })

  it('passar num quiz de AULA não dispara emissão — quiz de aula é formativo', async () => {
    const author = await makeActor({ role: 'ADMIN' })
    const course = await makePublishedCourse(DEFAULT_SECTOR_ID)
    const lesson = await makeLesson(course.id)
    // Quiz final não aprovado: é ele que segura o certificado. Com questão —
    // quiz final vazio é casca e, de propósito, não bloqueia ninguém.
    const finalQuiz = await createQuiz({ courseId: course.id, data: { title: 'Quiz final' }, actor: author })
    await createQuestion({
      quizId: finalQuiz.id,
      data: { statement: 'Pergunta do quiz final', options: twoOptions(1) },
      actor: author,
    })
    const lessonQuiz = await createQuiz({
      courseId: course.id,
      data: { title: 'Quiz da aula', lessonId: lesson.id },
      actor: author,
    })
    const question = await createQuestion({
      quizId: lessonQuiz.id,
      data: { statement: 'Quanto é 2 + 2?', options: twoOptions(1) },
      actor: author,
    })
    const respondent = await makeRespondent()
    await enroll(respondent.userId, course.id)
    await setLessonCompletion(respondent, lesson.id, true)

    const result = await submitQuizAttempt(respondent, lessonQuiz.id, {
      answers: [{ questionId: question.id, optionId: 'op-2' }],
    })

    expect(result.passed).toBe(true)
    expect(await listCertificates(respondent)).toHaveLength(0)
  })
})

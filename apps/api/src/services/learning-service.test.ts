import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '../lib/prisma'
import { courseProgressPct } from '../lib/serialize-learning'
import {
  LearningError,
  enrollInCourse,
  getCourseDetail,
  learningSummary,
  listCertificates,
  listCourses,
  rateCourse,
  requestCertificate,
  setCourseFavorite,
  setLessonCompletion,
} from './learning-service'
import { resolveCertificateTemplateForCourse } from './certificate-request-service'

/**
 * `resolveCertificateTemplateForCourse` (Task 8) fica atrás de um spy que
 * delega pra implementação de verdade — não é um mock burro. Serve só pra Task
 * 9 provar QUANDO `issueCertificate` chama (ou não chama) a resolução do
 * modelo, sem mudar o comportamento de nenhum outro teste deste arquivo.
 */
vi.mock('./certificate-request-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./certificate-request-service')>()
  return { ...actual, resolveCertificateTemplateForCourse: vi.fn(actual.resolveCertificateTemplateForCourse) }
})

const COMPANY = 'company-emr'

async function makeUser(email: string, name = 'Dev') {
  return prisma.user.create({ data: { name, email, passwordHash: 'x' } })
}

async function makeCourse(input: { slug: string; lessons: number; status?: 'DRAFT' | 'PUBLISHED'; certificate?: boolean; mandatory?: boolean }) {
  const course = await prisma.course.create({
    data: {
      slug: input.slug,
      title: `Curso ${input.slug}`,
      status: input.status ?? 'PUBLISHED',
      publishedAt: new Date(),
      certificateEnabled: input.certificate ?? true,
      mandatory: input.mandatory ?? false,
    },
  })
  const courseModule = await prisma.courseModule.create({ data: { courseId: course.id, title: 'Módulo 1' } })
  const lessons = []
  for (let index = 0; index < input.lessons; index++) {
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

describe('courseProgressPct', () => {
  it('deriva o percentual das aulas concluídas e trata curso sem aula', () => {
    expect(courseProgressPct(0, 4)).toBe(0)
    expect(courseProgressPct(1, 4)).toBe(25)
    expect(courseProgressPct(3, 4)).toBe(75)
    expect(courseProgressPct(4, 4)).toBe(100)
    expect(courseProgressPct(0, 0)).toBe(0)
  })
})

describe('learning-service', () => {
  let viewer: { userId: string; companyId: string }

  beforeEach(async () => {
    const user = await makeUser('dev@empresa.com')
    viewer = { userId: user.id, companyId: COMPANY }
  })

  it('não expõe curso em rascunho no catálogo nem por id direto', async () => {
    const { course } = await makeCourse({ slug: 'rascunho', lessons: 2, status: 'DRAFT' })

    const { courses } = await listCourses(viewer)
    expect(courses).toHaveLength(0)
    await expect(getCourseDetail(viewer, course.id)).rejects.toMatchObject({ status: 404 })
  })

  it('a segunda inscrição no mesmo curso não cria uma segunda inscrição', async () => {
    const { course } = await makeCourse({ slug: 'lideranca', lessons: 2 })

    const first = await enrollInCourse(viewer, course.id)
    const second = await enrollInCourse(viewer, course.id)

    expect(second.id).toBe(first.id)
    expect(await prisma.courseEnrollment.count({ where: { userId: viewer.userId, courseId: course.id } })).toBe(1)
  })

  it('marcar a mesma aula duas vezes não altera o percentual nem duplica o registro', async () => {
    const { course, lessons } = await makeCourse({ slug: 'idempotente', lessons: 4 })
    await enrollInCourse(viewer, course.id)

    const first = await setLessonCompletion(viewer, lessons[0].id, true)
    const again = await setLessonCompletion(viewer, lessons[0].id, true)

    expect(first.progressPct).toBe(25)
    expect(again.progressPct).toBe(25)
    expect(await prisma.lessonProgress.count({ where: { userId: viewer.userId, courseId: course.id } })).toBe(1)
  })

  it('concluir a última aula move a inscrição para concluída, carimba a data e emite o certificado', async () => {
    const { course, lessons } = await makeCourse({ slug: 'completo', lessons: 2 })
    await enrollInCourse(viewer, course.id)

    await setLessonCompletion(viewer, lessons[0].id, true)
    const result = await setLessonCompletion(viewer, lessons[1].id, true)

    expect(result.progressPct).toBe(100)
    expect(result.status).toBe('COMPLETED')
    expect(result.certificate?.code).toMatch(/^EMR-[A-Z0-9]{8}$/)
    // Carga horária derivada das aulas: 2 × 30 min = 1h.
    expect(result.certificate?.hours).toBe(1)

    const enrollment = await prisma.courseEnrollment.findFirstOrThrow({ where: { userId: viewer.userId } })
    expect(enrollment.completedAt).not.toBeNull()
  })

  /**
   * Recompensa por curso (Documento 4, seção 9.6). Até aqui concluir rendia
   * SELO, e era o selo que carregava ponto e moeda.
   */
  describe('recompensa ao concluir', () => {
    async function saldo(courseId: string) {
      const [coins, xp] = await Promise.all([
        prisma.coinTransaction.findMany({ where: { userId: viewer.userId, event: 'COURSE_COMPLETED' } }),
        prisma.xpTransaction.findMany({ where: { userId: viewer.userId, event: 'COURSE_COMPLETED' } }),
      ])
      return {
        coins: coins.reduce((soma, t) => soma + t.amount, 0),
        xp: xp.reduce((soma, t) => soma + t.amount, 0),
        lancamentos: coins.length + xp.length,
        referenciaCoin: coins[0]?.dedupeKey,
      }
    }

    it('credita o valor DO CURSO ao concluir, com os padrões do documento', async () => {
      const { course, lessons } = await makeCourse({ slug: 'com-premio', lessons: 1 })
      await enrollInCourse(viewer, course.id)
      await setLessonCompletion(viewer, lessons[0].id, true)

      const depois = await saldo(course.id)
      expect(depois.xp).toBe(25)
      expect(depois.coins).toBe(10)
      // O dedupe é por CURSO: é ele que impede pagar duas vezes.
      expect(depois.referenciaCoin).toBe(`COURSE_COMPLETED:${course.id}`)
    })

    it('respeita o valor configurado no curso', async () => {
      const { course, lessons } = await makeCourse({ slug: 'premio-alto', lessons: 1 })
      await prisma.course.update({ where: { id: course.id }, data: { rewardPoints: 100, rewardCoins: 50 } })
      await enrollInCourse(viewer, course.id)
      await setLessonCompletion(viewer, lessons[0].id, true)

      const depois = await saldo(course.id)
      expect(depois.xp).toBe(100)
      expect(depois.coins).toBe(50)
    })

    /**
     * O ponto do desenho: desmarcar uma aula e marcar de novo reconclui o curso,
     * e não pode pagar de novo. Quem garante é o `@@unique([userId, dedupeKey])`
     * — não uma consulta "já paguei?" antes de creditar.
     */
    it('reconcluir não paga de novo', async () => {
      const { course, lessons } = await makeCourse({ slug: 'reconcluido', lessons: 1 })
      await enrollInCourse(viewer, course.id)

      await setLessonCompletion(viewer, lessons[0].id, true)
      await setLessonCompletion(viewer, lessons[0].id, false)
      await setLessonCompletion(viewer, lessons[0].id, true)

      const depois = await saldo(course.id)
      expect(depois.lancamentos).toBe(2)
      expect(depois.xp).toBe(25)
      expect(depois.coins).toBe(10)
    })

    // Zero é "sem recompensa", e um extrato com "0 EMR Coins" seria ruído.
    it('zero não gera lançamento', async () => {
      const { course, lessons } = await makeCourse({ slug: 'sem-premio', lessons: 1 })
      await prisma.course.update({ where: { id: course.id }, data: { rewardPoints: 0, rewardCoins: 0 } })
      await enrollInCourse(viewer, course.id)
      await setLessonCompletion(viewer, lessons[0].id, true)

      expect((await saldo(course.id)).lancamentos).toBe(0)
    })

    it('não paga antes de o curso estar concluído', async () => {
      const { course, lessons } = await makeCourse({ slug: 'no-meio', lessons: 3 })
      await enrollInCourse(viewer, course.id)
      await setLessonCompletion(viewer, lessons[0].id, true)

      expect((await saldo(course.id)).lancamentos).toBe(0)
    })
  })

  it('não emite certificado enquanto a inscrição não estiver concluída', async () => {
    const { course, lessons } = await makeCourse({ slug: 'parcial', lessons: 3 })
    await enrollInCourse(viewer, course.id)

    const result = await setLessonCompletion(viewer, lessons[0].id, true)

    expect(result.certificate).toBeNull()
    expect(await listCertificates(viewer)).toHaveLength(0)
    void course
  })

  it('não emite certificado para curso com certificado desabilitado', async () => {
    const { course, lessons } = await makeCourse({ slug: 'sem-cert', lessons: 1, certificate: false })
    await enrollInCourse(viewer, course.id)

    const result = await setLessonCompletion(viewer, lessons[0].id, true)

    expect(result.status).toBe('COMPLETED')
    expect(result.certificate).toBeNull()
    void course
  })

  it('reconcluir o curso devolve o mesmo certificado, com o mesmo código', async () => {
    const { course, lessons } = await makeCourse({ slug: 'recompleto', lessons: 1 })
    await enrollInCourse(viewer, course.id)

    const first = await setLessonCompletion(viewer, lessons[0].id, true)
    await setLessonCompletion(viewer, lessons[0].id, false)
    const second = await setLessonCompletion(viewer, lessons[0].id, true)

    expect(second.certificate?.code).toBe(first.certificate?.code)
    expect(await prisma.certificate.count({ where: { userId: viewer.userId, courseId: course.id } })).toBe(1)
  })

  it('exige inscrição antes de marcar aula', async () => {
    const { lessons } = await makeCourse({ slug: 'sem-inscricao', lessons: 1 })

    await expect(setLessonCompletion(viewer, lessons[0].id, true)).rejects.toMatchObject({ status: 409 })
  })

  it('aceita nota de 1 a 5, uma por pessoa por curso — avaliar de novo atualiza a existente', async () => {
    const { course } = await makeCourse({ slug: 'avaliado', lessons: 1 })

    const first = await rateCourse(viewer, course.id, { rating: 4, comment: 'Bom' })
    expect(first.rating.rating).toBe(4)
    expect(first.averageRating).toBe(4)

    const second = await rateCourse(viewer, course.id, { rating: 5, comment: null })
    expect(second.rating.rating).toBe(5)
    expect(second.totalRatings).toBe(1)
    expect(await prisma.courseRating.count({ where: { userId: viewer.userId, courseId: course.id } })).toBe(1)

    await expect(rateCourse(viewer, course.id, { rating: 6 })).rejects.toBeInstanceOf(LearningError)
    await expect(rateCourse(viewer, course.id, { rating: 0 })).rejects.toBeInstanceOf(LearningError)
  })

  it('favoritar é idempotente e desfavoritar remove', async () => {
    const { course } = await makeCourse({ slug: 'favorito', lessons: 1 })

    await setCourseFavorite(viewer, course.id, true)
    await setCourseFavorite(viewer, course.id, true)
    expect(await prisma.courseFavorite.count({ where: { userId: viewer.userId } })).toBe(1)

    await setCourseFavorite(viewer, course.id, false)
    expect(await prisma.courseFavorite.count({ where: { userId: viewer.userId } })).toBe(0)
  })

  it('resume horas do mês, certificados, cursos em andamento e obrigatórios pendentes', async () => {
    const { course, lessons } = await makeCourse({ slug: 'obrigatorio', lessons: 2, mandatory: true })
    const outro = await makeCourse({ slug: 'opcional', lessons: 2 })
    await enrollInCourse(viewer, course.id)
    await enrollInCourse(viewer, outro.course.id)
    await setLessonCompletion(viewer, lessons[0].id, true)

    const summary = await learningSummary(viewer)

    expect(summary.monthMinutes).toBe(30)
    expect(summary.inProgress).toBe(2)
    expect(summary.pendingMandatory).toBe(1)
    expect(summary.certificates).toBe(0)
  })

  it('a duração do curso é a soma das aulas, sem total próprio a desincronizar', async () => {
    const { course } = await makeCourse({ slug: 'derivado', lessons: 3 })

    const detail = await getCourseDetail(viewer, course.id)

    expect(detail.durationMinutes).toBe(90)
    expect(detail.totalLessons).toBe(3)
  })

  it('expõe o id do quiz da aula e do quiz final do curso, quando existem', async () => {
    const { course, lessons } = await makeCourse({ slug: 'com-quiz', lessons: 2 })
    const lessonQuiz = await prisma.courseQuiz.create({
      data: { courseId: course.id, lessonId: lessons[0].id, title: 'Quiz da aula 1' },
    })
    const finalQuiz = await prisma.courseQuiz.create({
      data: { courseId: course.id, lessonId: null, title: 'Quiz final' },
    })

    const detail = await getCourseDetail(viewer, course.id)

    const [firstLesson, secondLesson] = detail.modules[0].lessons
    expect(firstLesson.quizId).toBe(lessonQuiz.id)
    expect(secondLesson.quizId).toBeNull()
    expect(detail.finalQuizId).toBe(finalQuiz.id)
  })

  it('curso sem quiz não expõe quizId em nenhuma aula nem finalQuizId', async () => {
    const { course } = await makeCourse({ slug: 'sem-quiz', lessons: 1 })

    const detail = await getCourseDetail(viewer, course.id)

    expect(detail.modules[0].lessons[0].quizId).toBeNull()
    expect(detail.finalQuizId).toBeNull()
  })

  it('isola por empresa: curso de outra empresa não aparece no catálogo', async () => {
    const company = await prisma.company.create({ data: { id: 'company-outra', name: 'Outra', slug: 'outra' } })
    await prisma.course.create({
      data: {
        slug: 'de-outra-empresa',
        title: 'De outra empresa',
        status: 'PUBLISHED',
        publishedAt: new Date(),
        companyId: company.id,
      },
    })
    await makeCourse({ slug: 'da-minha-empresa', lessons: 1 })

    const { courses } = await listCourses(viewer)

    expect(courses.map((course) => course.title)).toEqual(['Curso da-minha-empresa'])
  })
})

/**
 * Task 9: o desvio no início de `issueCertificate` — guarda 3 (quiz final) e
 * guarda 4 (aprovação obrigatória) — sem alterar o caminho de emissão de
 * sempre para curso que não usa nenhuma das duas.
 */
describe('issueCertificate — quiz final e fila de aprovação (Task 9)', () => {
  let viewer: { userId: string; companyId: string }

  beforeEach(async () => {
    const user = await makeUser(`task9-${Math.random().toString(36).slice(2)}@empresa.com`)
    viewer = { userId: user.id, companyId: COMPANY }
    vi.mocked(resolveCertificateTemplateForCourse).mockClear()
  })

  /**
   * Quiz final DE VERDADE: com ao menos uma questão. Um quiz sem questão é uma
   * casca inacabada e, de propósito, não bloqueia o certificado de ninguém
   * (ver `hasUnpassedFinalQuiz` e o teste da casca mais abaixo) — então um
   * quiz vazio aqui não exercitaria a guarda que estes testes querem cobrir.
   */
  async function makeFinalQuiz(courseId: string, passingScore = 70) {
    const quiz = await prisma.courseQuiz.create({
      data: { courseId, lessonId: null, title: 'Quiz final', passingScore },
    })
    await prisma.courseQuestion.create({
      data: {
        quizId: quiz.id,
        statement: 'Quanto é 2 + 2?',
        options: [
          { id: 'op-1', text: '3', correct: false },
          { id: 'op-2', text: '4', correct: true },
        ],
        sortOrder: 0,
      },
    })
    return quiz
  }

  it('curso com quiz final e ninguém tentou ainda: concluir as aulas não emite certificado', async () => {
    const { course, lessons } = await makeCourse({ slug: 'quiz-sem-tentativa', lessons: 1 })
    await makeFinalQuiz(course.id)
    await enrollInCourse(viewer, course.id)

    const result = await setLessonCompletion(viewer, lessons[0].id, true)

    expect(result.status).toBe('COMPLETED')
    expect(result.certificate).toBeNull()
    expect(await listCertificates(viewer)).toHaveLength(0)
  })

  it('curso com quiz final reprovado: concluir as aulas não emite certificado', async () => {
    const { course, lessons } = await makeCourse({ slug: 'quiz-reprovado', lessons: 1 })
    const quiz = await makeFinalQuiz(course.id)
    await enrollInCourse(viewer, course.id)
    await prisma.quizAttempt.create({
      data: { quizId: quiz.id, userId: viewer.userId, attemptNumber: 1, score: 40, passed: false, answers: [] },
    })

    const result = await setLessonCompletion(viewer, lessons[0].id, true)

    expect(result.certificate).toBeNull()
  })

  it('curso com quiz final aprovado: concluir as aulas emite o certificado', async () => {
    const { course, lessons } = await makeCourse({ slug: 'quiz-aprovado', lessons: 1 })
    const quiz = await makeFinalQuiz(course.id)
    await enrollInCourse(viewer, course.id)
    await prisma.quizAttempt.create({
      data: { quizId: quiz.id, userId: viewer.userId, attemptNumber: 1, score: 90, passed: true, answers: [] },
    })

    const result = await setLessonCompletion(viewer, lessons[0].id, true)

    expect(result.certificate).not.toBeNull()
  })

  it('quiz final SEM questões (casca inacabada) não bloqueia o certificado', async () => {
    const { course, lessons } = await makeCourse({ slug: 'quiz-final-vazio', lessons: 1 })
    // Só o quiz, sem nenhuma questão — é o que o admin tem entre criar o quiz
    // final e escrever a primeira questão. Ninguém consegue ser aprovado nele
    // (responder devolve 409), então segurar o certificado de todo o curso
    // aqui não teria saída.
    await prisma.courseQuiz.create({ data: { courseId: course.id, lessonId: null, title: 'Quiz final vazio' } })
    await enrollInCourse(viewer, course.id)

    const result = await setLessonCompletion(viewer, lessons[0].id, true)

    expect(result.certificate).not.toBeNull()
  })

  it('quiz de AULA (não final) é formativo: não bloqueia o certificado mesmo sem tentativa', async () => {
    const { course, lessons } = await makeCourse({ slug: 'quiz-de-aula', lessons: 1 })
    await prisma.courseQuiz.create({ data: { courseId: course.id, lessonId: lessons[0].id, title: 'Quiz da aula 1' } })
    await enrollInCourse(viewer, course.id)

    const result = await setLessonCompletion(viewer, lessons[0].id, true)

    expect(result.certificate).not.toBeNull()
  })

  it('curso com aprovação obrigatória: concluir as aulas cria uma solicitação PENDENTE e não emite', async () => {
    const { course, lessons } = await makeCourse({ slug: 'requer-aprovacao', lessons: 1 })
    await prisma.course.update({ where: { id: course.id }, data: { requiresCertificateApproval: true } })
    await enrollInCourse(viewer, course.id)

    const result = await setLessonCompletion(viewer, lessons[0].id, true)

    expect(result.status).toBe('COMPLETED')
    expect(result.certificate).toBeNull()
    expect(await listCertificates(viewer)).toHaveLength(0)

    const requests = await prisma.certificateRequest.findMany({ where: { userId: viewer.userId, courseId: course.id } })
    expect(requests).toHaveLength(1)
    expect(requests[0].status).toBe('PENDING')
  })

  it('curso com aprovação obrigatória: chamar de novo não duplica nem quebra a solicitação (idempotente)', async () => {
    const { course, lessons } = await makeCourse({ slug: 'requer-aprovacao-idempotente', lessons: 1 })
    await prisma.course.update({ where: { id: course.id }, data: { requiresCertificateApproval: true } })
    await enrollInCourse(viewer, course.id)

    await setLessonCompletion(viewer, lessons[0].id, true)
    // Reabrir e marcar de novo re-executa `issueCertificate` com a inscrição já concluída.
    await setLessonCompletion(viewer, lessons[0].id, false)
    const second = await setLessonCompletion(viewer, lessons[0].id, true)

    expect(second.certificate).toBeNull()
    const requests = await prisma.certificateRequest.findMany({ where: { userId: viewer.userId, courseId: course.id } })
    expect(requests).toHaveLength(1)
    expect(requests[0].status).toBe('PENDING')
  })

  it(
    'a resolução do modelo de certificado (Task 8) só roda numa emissão NOVA — devolver um certificado ' +
      'já existente nunca re-resolve nem re-renderiza o modelo, para o certificado já emitido não mudar de visual',
    async () => {
      const { course, lessons } = await makeCourse({ slug: 'pin-template-resolution', lessons: 1 })
      await enrollInCourse(viewer, course.id)

      const first = await setLessonCompletion(viewer, lessons[0].id, true)
      expect(first.certificate).not.toBeNull()
      expect(resolveCertificateTemplateForCourse).toHaveBeenCalledTimes(1)

      vi.mocked(resolveCertificateTemplateForCourse).mockClear()

      // Reabrir e marcar de novo: `issueCertificate` acha o certificado já
      // existente e devolve na hora — nunca chega a resolver modelo de novo.
      await setLessonCompletion(viewer, lessons[0].id, false)
      const second = await setLessonCompletion(viewer, lessons[0].id, true)

      expect(second.certificate?.code).toBe(first.certificate?.code)
      expect(resolveCertificateTemplateForCourse).not.toHaveBeenCalled()
    },
  )
})

/**
 * Documento 4, seção 9.3: o certificado era 100% automático. Quem concluía um
 * curso que exige aprovação entrava na fila sem saber, e quem era barrado por
 * outra razão não via nada — não havia o que pedir nem o que ler.
 */
describe('requestCertificate — pedido feito pela pessoa', () => {
  let viewer: { userId: string; companyId: string }

  beforeEach(async () => {
    const user = await makeUser('pede-cert@empresa.com')
    viewer = { userId: user.id, companyId: COMPANY }
  })

  it('recusa antes da conclusão — é a mesma guarda que a tela aplica no botão', async () => {
    const { course } = await makeCourse({ slug: 'pedir-sem-concluir', lessons: 2 })
    await enrollInCourse(viewer, course.id)

    await expect(requestCertificate(viewer, course.id)).rejects.toThrow(LearningError)
    expect(await prisma.certificateRequest.count({ where: { userId: viewer.userId } })).toBe(0)
  })

  it('recusa curso que não emite certificado', async () => {
    const { course, lessons } = await makeCourse({ slug: 'pedir-sem-cert', lessons: 1, certificate: false })
    await enrollInCourse(viewer, course.id)
    await setLessonCompletion(viewer, lessons[0].id, true)

    await expect(requestCertificate(viewer, course.id)).rejects.toThrow(LearningError)
  })

  it('enfileira o pedido do curso concluído que espera aprovação', async () => {
    const { course, lessons } = await makeCourse({ slug: 'pedir-com-aprovacao', lessons: 1 })
    await prisma.course.update({ where: { id: course.id }, data: { requiresCertificateApproval: true } })
    await enrollInCourse(viewer, course.id)
    await setLessonCompletion(viewer, lessons[0].id, true)
    await prisma.certificateRequest.deleteMany({ where: { userId: viewer.userId } })

    await requestCertificate(viewer, course.id)

    const pedidos = await prisma.certificateRequest.findMany({ where: { userId: viewer.userId } })
    expect(pedidos).toHaveLength(1)
    expect(pedidos[0].status).toBe('PENDING')
  })

  it('pedir de novo é idempotente — não abre uma segunda linha na fila', async () => {
    const { course, lessons } = await makeCourse({ slug: 'pedir-duas-vezes', lessons: 1 })
    await prisma.course.update({ where: { id: course.id }, data: { requiresCertificateApproval: true } })
    await enrollInCourse(viewer, course.id)
    await setLessonCompletion(viewer, lessons[0].id, true)

    await requestCertificate(viewer, course.id)
    await requestCertificate(viewer, course.id)

    expect(await prisma.certificateRequest.count({ where: { userId: viewer.userId } })).toBe(1)
  })

  it('reabre a recusa em vez de criar outra linha', async () => {
    const { course, lessons } = await makeCourse({ slug: 'pedir-apos-recusa', lessons: 1 })
    await prisma.course.update({ where: { id: course.id }, data: { requiresCertificateApproval: true } })
    await enrollInCourse(viewer, course.id)
    await setLessonCompletion(viewer, lessons[0].id, true)
    await prisma.certificateRequest.updateMany({
      where: { userId: viewer.userId },
      data: { status: 'REJECTED', rejectionReason: 'Falta o quiz final.' },
    })

    await requestCertificate(viewer, course.id)

    const pedidos = await prisma.certificateRequest.findMany({ where: { userId: viewer.userId } })
    expect(pedidos).toHaveLength(1)
    expect(pedidos[0].status).toBe('PENDING')
    // O motivo da recusa anterior fica: outro revisor precisa saber que já foi
    // recusada uma vez (ver `ensureCertificateRequestForEnrollment`).
    expect(pedidos[0].rejectionReason).toBe('Falta o quiz final.')
  })

  it('curso já emitido é no-op — não há o que aprovar', async () => {
    const { course, lessons } = await makeCourse({ slug: 'pedir-com-certificado', lessons: 1 })
    await enrollInCourse(viewer, course.id)
    const concluido = await setLessonCompletion(viewer, lessons[0].id, true)
    expect(concluido.certificate).not.toBeNull()

    await requestCertificate(viewer, course.id)

    expect(await prisma.certificateRequest.count({ where: { userId: viewer.userId } })).toBe(0)
  })

  it('o detalhe do curso devolve o estado da fila', async () => {
    const { course, lessons } = await makeCourse({ slug: 'detalhe-com-pedido', lessons: 1 })
    await prisma.course.update({ where: { id: course.id }, data: { requiresCertificateApproval: true } })
    await enrollInCourse(viewer, course.id)
    await setLessonCompletion(viewer, lessons[0].id, true)

    const detalhe = await getCourseDetail(viewer, course.id)

    expect(detalhe.certificateRequest?.status).toBe('PENDING')
  })
})

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

async function tokenFor(app: ReturnType<typeof buildApp>, email = 'dev@empresa.com') {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Dev', email, password: 'changeme123' },
  })
  return { token: res.json().accessToken as string, userId: res.json().user.id as string }
}

function thirdPartyToken(app: ReturnType<typeof buildApp>, userId: string, features: string[]) {
  return app.jwt.sign({
    sub: userId,
    role: 'THIRD_PARTY',
    sectorId: 'sector-dev-produto',
    companyId: 'company-emr',
    features,
  })
}

async function seedCourse(companyId = 'company-emr', sectorId: string | null = null) {
  const course = await prisma.course.create({
    data: {
      slug: `curso-${Math.random().toString(36).slice(2, 8)}`,
      title: 'Liderança na prática',
      category: 'Liderança',
      published: true,
      publishedAt: new Date(),
      companyId,
      sectorId,
    },
  })
  const courseModule = await prisma.courseModule.create({
    data: { courseId: course.id, title: 'Módulo', companyId },
  })
  const lesson = await prisma.courseLesson.create({
    data: { courseId: course.id, moduleId: courseModule.id, title: 'Aula 1', durationMinutes: 60, companyId },
  })
  return { course, lesson }
}

/** Quiz final com duas questões, gabarito conhecido: 'b' é sempre a correta. */
async function seedQuiz(courseId: string, opts: { passingScore?: number; maxAttempts?: number | null } = {}) {
  const quiz = await prisma.courseQuiz.create({
    data: { courseId, title: 'Prova final', passingScore: opts.passingScore ?? 70, maxAttempts: opts.maxAttempts ?? null },
  })
  const q1 = await prisma.courseQuestion.create({
    data: {
      quizId: quiz.id,
      statement: 'Quanto é 2 + 2?',
      options: [
        { id: 'a', text: '3', correct: false },
        { id: 'b', text: '4', correct: true },
      ],
      explanation: 'Dois mais dois é quatro.',
      sortOrder: 0,
    },
  })
  const q2 = await prisma.courseQuestion.create({
    data: {
      quizId: quiz.id,
      statement: 'Capital do Brasil?',
      options: [
        { id: 'a', text: 'Brasília', correct: true },
        { id: 'b', text: 'Rio de Janeiro', correct: false },
      ],
      explanation: 'A capital é Brasília.',
      sortOrder: 1,
    },
  })
  return { quiz, q1, q2 }
}

/**
 * O PNG do certificado só é gerado com S3 configurado (`certificateStorageEnabled`),
 * e a config sai do ambiente. Sem zerar isso aqui, o resultado da suíte passa a
 * depender do `.env` de quem roda: com as chaves de S3 preenchidas, `imageUrl`
 * vem com URL e a asserção de `null` falha sem nada ter regredido.
 */
const S3_KEYS = ['S3_BUCKET', 'S3_REGION', 'S3_PUBLIC_BASE_URL'] as const
const s3Original: Partial<Record<(typeof S3_KEYS)[number], string | undefined>> = {}

beforeAll(() => {
  for (const key of S3_KEYS) {
    s3Original[key] = process.env[key]
    delete process.env[key]
  }
})

afterAll(() => {
  for (const key of S3_KEYS) {
    if (s3Original[key] === undefined) delete process.env[key]
    else process.env[key] = s3Original[key]
  }
})

describe('rotas de aprendizado', () => {
  it('exige autenticação', async () => {
    const app = buildApp()
    await app.ready()

    expect((await app.inject({ method: 'GET', url: '/learning/courses' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/learning/me' })).statusCode).toBe(401)

    await app.close()
  })

  it('bloqueia quem não tem a feature `aprendizado` liberada', async () => {
    const app = buildApp()
    await app.ready()
    const user = await prisma.user.create({
      data: { name: 'Terceirizado', email: 'terceiro@x.com', passwordHash: 'x', role: 'THIRD_PARTY' },
    })

    const blocked = thirdPartyToken(app, user.id, [])
    const allowed = thirdPartyToken(app, user.id, ['aprendizado'])

    expect(
      (await app.inject({ method: 'GET', url: '/learning/courses', headers: { authorization: `Bearer ${blocked}` } }))
        .statusCode,
    ).toBe(403)
    expect(
      (await app.inject({ method: 'GET', url: '/learning/courses', headers: { authorization: `Bearer ${allowed}` } }))
        .statusCode,
    ).toBe(200)

    await app.close()
  })

  it('percorre o fluxo: catálogo, inscrição, aula concluída e certificado', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await tokenFor(app)
    const { course, lesson } = await seedCourse()

    const catalog = await app.inject({
      method: 'GET',
      url: '/learning/courses',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(catalog.json().courses).toHaveLength(1)
    expect(catalog.json().categories).toEqual(['Liderança'])

    const enroll = await app.inject({
      method: 'POST',
      url: `/learning/courses/${course.id}/enroll`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(enroll.statusCode).toBe(201)

    const complete = await app.inject({
      method: 'PUT',
      url: `/learning/lessons/${lesson.id}/complete`,
      headers: { authorization: `Bearer ${token}` },
      payload: { completed: true },
    })
    expect(complete.statusCode).toBe(200)
    expect(complete.json()).toMatchObject({ progressPct: 100, status: 'COMPLETED' })

    const certificates = await app.inject({
      method: 'GET',
      url: '/learning/certificates',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(certificates.json().certificates).toHaveLength(1)

    const code = certificates.json().certificates[0].code as string
    // Verificação pública: sem login, de propósito (é o link do LinkedIn).
    const publicRes = await app.inject({ method: 'GET', url: `/learning/certificates/code/${code}` })
    expect(publicRes.statusCode).toBe(200)
    expect(publicRes.json().certificate).toMatchObject({ code, title: 'Liderança na prática', userName: 'Dev' })
    expect(publicRes.json().certificate.imageUrl ?? null).toBeNull()

    await app.close()
  })

  it('curso de outra empresa responde 404, mesmo com o id na mão', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await tokenFor(app)
    await prisma.company.create({ data: { id: 'company-outra', name: 'Outra', slug: 'outra' } })
    const { course } = await seedCourse('company-outra')

    const res = await app.inject({
      method: 'GET',
      url: `/learning/courses/${course.id}`,
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('recusa nota fora da faixa de 1 a 5', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await tokenFor(app)
    const { course } = await seedCourse()

    const res = await app.inject({
      method: 'PUT',
      url: `/learning/courses/${course.id}/rating`,
      headers: { authorization: `Bearer ${token}` },
      payload: { rating: 9 },
    })

    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('código de certificado inexistente responde 404 na rota pública', async () => {
    const app = buildApp()
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/learning/certificates/code/EMR-NAOEXISTE' })

    expect(res.statusCode).toBe(404)
    await app.close()
  })

  describe('quiz — responder', () => {
    it('GET /learning/quizzes/:id: o JSON da resposta não contém "correct" nem "explanation" em lugar nenhum', async () => {
      const app = buildApp()
      await app.ready()
      const { token, userId } = await tokenFor(app)
      const { course } = await seedCourse()
      const { quiz } = await seedQuiz(course.id)
      await prisma.courseEnrollment.create({ data: { userId, courseId: course.id, lastAccessedAt: new Date() } })

      const res = await app.inject({
        method: 'GET',
        url: `/learning/quizzes/${quiz.id}`,
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.statusCode).toBe(200)
      const raw = res.payload
      expect(raw).not.toContain('correct')
      expect(raw).not.toContain('explanation')
      expect(res.json().quiz.questions).toHaveLength(2)
      expect(res.json().quiz.questions[0].options[0]).toEqual({ id: 'a', text: '3' })

      await app.close()
    })

    it('POST /learning/quizzes/:id/attempts: corrige no servidor e devolve feedback com explanation', async () => {
      const app = buildApp()
      await app.ready()
      const { token, userId } = await tokenFor(app)
      const { course } = await seedCourse()
      const { quiz, q1, q2 } = await seedQuiz(course.id, { passingScore: 70 })
      await prisma.courseEnrollment.create({ data: { userId, courseId: course.id, lastAccessedAt: new Date() } })

      const res = await app.inject({
        method: 'POST',
        url: `/learning/quizzes/${quiz.id}/attempts`,
        headers: { authorization: `Bearer ${token}` },
        payload: { answers: [{ questionId: q1.id, optionId: 'b' }, { questionId: q2.id, optionId: 'a' }] },
      })

      expect(res.statusCode).toBe(201)
      expect(res.json().result).toMatchObject({ score: 100, passed: true, attemptNumber: 1, attemptsLeft: null })
      expect(res.json().result.feedback).toContainEqual({
        questionId: q1.id,
        correct: true,
        explanation: 'Dois mais dois é quatro.',
      })

      await app.close()
    })

    it('acima do limite de tentativas responde 409 com o N real na mensagem', async () => {
      const app = buildApp()
      await app.ready()
      const { token, userId } = await tokenFor(app)
      const { course } = await seedCourse()
      const { quiz, q1 } = await seedQuiz(course.id, { maxAttempts: 1 })
      await prisma.courseEnrollment.create({ data: { userId, courseId: course.id, lastAccessedAt: new Date() } })

      const payload = { answers: [{ questionId: q1.id, optionId: 'b' }] }
      const first = await app.inject({
        method: 'POST',
        url: `/learning/quizzes/${quiz.id}/attempts`,
        headers: { authorization: `Bearer ${token}` },
        payload,
      })
      expect(first.statusCode).toBe(201)

      const second = await app.inject({
        method: 'POST',
        url: `/learning/quizzes/${quiz.id}/attempts`,
        headers: { authorization: `Bearer ${token}` },
        payload,
      })
      expect(second.statusCode).toBe(409)
      expect(second.json().message).toBe('Você já usou todas as 1 tentativas deste quiz.')

      await app.close()
    })

    it('quiz de curso em que a pessoa não está inscrita responde 404', async () => {
      const app = buildApp()
      await app.ready()
      const { token } = await tokenFor(app)
      const { course } = await seedCourse()
      const { quiz } = await seedQuiz(course.id)

      const res = await app.inject({
        method: 'GET',
        url: `/learning/quizzes/${quiz.id}`,
        headers: { authorization: `Bearer ${token}` },
      })

      expect(res.statusCode).toBe(404)
      await app.close()
    })
  })
})

import { describe, expect, it } from 'vitest'
import { COURSE_TITLE_MAX_LENGTH, DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

async function devToken(app: ReturnType<typeof buildApp>, email = 'dev@empresa.com') {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Dev', email, password: 'changeme123' },
  })
  return res.json().accessToken as string
}

async function adminToken(app: ReturnType<typeof buildApp>) {
  await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Admin', email: 'admin@empresa.com', password: 'changeme123' },
  })
  await prisma.user.update({ where: { email: 'admin@empresa.com' }, data: { role: 'ADMIN' } })
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: 'admin@empresa.com', password: 'changeme123' },
  })
  return res.json().accessToken as string
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` })

async function createCourse(app: ReturnType<typeof buildApp>, token: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/admin/courses',
    headers: auth(token),
    payload: { title: 'Liderança na prática' },
  })
  return res.json().course as { id: string; slug: string; published: boolean; modules: { id: string }[] }
}

/**
 * Ator SUBADMIN direto por JWT (sem passar por registro/login) — precisa de um setor
 * específico para os testes de recorte.
 *
 * O `features: ['gente-gestao']` é o **bloco de administração**, não a feature de
 * consumo do colaborador: sem ele o `requireSectorFeature` do módulo barra com 403
 * antes de a rota rodar, e os testes de recorte por setor — que existem para provar
 * que fora de alcance é 404, nunca 403 — passariam a medir o gate errado.
 */
async function subadminToken(app: ReturnType<typeof buildApp>, sectorId = DEFAULT_SECTOR_ID) {
  const user = await prisma.user.create({
    data: {
      name: 'Subadmin',
      email: `subadmin-quiz-${Math.random().toString(36).slice(2)}@empresa.com`,
      passwordHash: 'x',
      role: 'SUBADMIN',
      sectorId,
    },
  })
  return app.jwt.sign({
    sub: user.id,
    role: 'SUBADMIN',
    sectorId,
    companyId: DEFAULT_COMPANY_ID,
    features: ['gente-gestao'],
  })
}

async function createCourseWithLesson(app: ReturnType<typeof buildApp>, token: string) {
  const course = await createCourse(app, token)
  const moduleRes = await app.inject({
    method: 'POST',
    url: `/admin/courses/${course.id}/modules`,
    headers: auth(token),
    payload: { title: 'Módulo' },
  })
  const moduleId = moduleRes.json().course.modules[0].id as string
  const lessonRes = await app.inject({
    method: 'POST',
    url: `/admin/course-modules/${moduleId}/lessons`,
    headers: auth(token),
    payload: { title: 'Aula', durationMinutes: 10 },
  })
  const lessonId = lessonRes.json().course.modules[0].lessons[0].id as string
  return { courseId: course.id, lessonId }
}

function twoOptions(correctIndex = 0) {
  return [
    { id: 'op-1', text: 'Opção 1', correct: correctIndex === 0 },
    { id: 'op-2', text: 'Opção 2', correct: correctIndex === 1 },
  ]
}

describe('autoria de curso (admin)', () => {
  it('exige autenticação e bloqueia quem não é admin', async () => {
    const app = buildApp()
    await app.ready()
    const dev = await devToken(app)

    expect((await app.inject({ method: 'GET', url: '/admin/courses' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/admin/courses', headers: auth(dev) })).statusCode).toBe(403)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/admin/courses',
          headers: auth(dev),
          payload: { title: 'X' },
        })
      ).statusCode,
    ).toBe(403)

    await app.close()
  })

  it('cria o curso em rascunho, com slug gerado a partir do título', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)

    const course = await createCourse(app, token)

    expect(course.published).toBe(false)
    expect(course.slug).toBe('lideranca-na-pratica')
    await app.close()
  })

  it('gera slug único quando o título se repete', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)

    const first = await createCourse(app, token)
    const second = await createCourse(app, token)

    expect(first.slug).toBe('lideranca-na-pratica')
    expect(second.slug).toBe('lideranca-na-pratica-2')
    await app.close()
  })

  it('monta módulo e aula com link de vídeo, e a duração do curso soma as aulas', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const course = await createCourse(app, token)

    const withModule = await app.inject({
      method: 'POST',
      url: `/admin/courses/${course.id}/modules`,
      headers: auth(token),
      payload: { title: 'Fundamentos' },
    })
    expect(withModule.statusCode).toBe(201)
    const moduleId = withModule.json().course.modules[0].id as string

    const withLesson = await app.inject({
      method: 'POST',
      url: `/admin/course-modules/${moduleId}/lessons`,
      headers: auth(token),
      payload: {
        title: 'O que é 1:1',
        blocks: [
          { id: 'b1', type: 'video', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', source: 'youtube' },
          { id: 'b2', type: 'text', text: 'Assista antes de vir.' },
        ],
        durationMinutes: 25,
      },
    })
    expect(withLesson.statusCode).toBe(201)

    const second = await app.inject({
      method: 'POST',
      url: `/admin/course-modules/${moduleId}/lessons`,
      headers: auth(token),
      payload: {
        title: 'Preparando a pauta',
        blocks: [{ id: 'b3', type: 'text', text: 'Oi' }],
        durationMinutes: 35,
      },
    })
    const body = second.json().course

    // Uma aula, dois blocos, na ordem em que foram enviados — que é o que a
    // seção 9.1 pede e o que o formato único não permitia.
    expect(body.modules[0].lessons[0].blocks).toEqual([
      { id: 'b1', type: 'video', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', source: 'youtube' },
      { id: 'b2', type: 'text', text: 'Assista antes de vir.' },
    ])
    expect(body.modules[0].lessons.map((l: { sortOrder: number }) => l.sortOrder)).toEqual([0, 1])
    expect(body.durationMinutes).toBe(60)
    expect(body.totalLessons).toBe(2)

    await app.close()
  })

  it('recusa bloco com URL de protocolo perigoso', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const course = await createCourse(app, token)
    const withModule = await app.inject({
      method: 'POST',
      url: `/admin/courses/${course.id}/modules`,
      headers: auth(token),
      payload: { title: 'Fundamentos' },
    })
    const moduleId = withModule.json().course.modules[0].id as string

    // O renderer é React e não injeta marcação, mas `href` aceitaria
    // `javascript:` — e aí o clique do aluno vira execução. Quem barra é o
    // schema compartilhado, e este teste é o que prova que a rota o usa.
    const res = await app.inject({
      method: 'POST',
      url: `/admin/course-modules/${moduleId}/lessons`,
      headers: auth(token),
      payload: {
        title: 'Aula',
        blocks: [{ id: 'b1', type: 'button', label: 'Clique', url: 'javascript:alert(1)' }],
      },
    })
    expect(res.statusCode).toBe(400)

    await app.close()
  })

  /**
   * Cinco estados (Documento 4, seção 9.6). O que muda entre eles é o que a G&G
   * vê na fila de trabalho; para o aluno, só `PUBLISHED` existe.
   */
  it('percorre os estados intermediários sem publicar, e a guarda vale só para publicar', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const course = await createCourse(app, token)

    // Curso vazio PODE ir para revisão: é justamente para isso que os estados
    // intermediários servem. Só publicar exige conteúdo.
    for (const status of ['REVIEW', 'PENDING_APPROVAL', 'ARCHIVED', 'DRAFT'] as const) {
      const res = await app.inject({
        method: 'PATCH',
        url: `/admin/courses/${course.id}`,
        headers: auth(token),
        payload: { status },
      })
      expect(res.statusCode, status).toBe(200)
      expect(res.json().course.status).toBe(status)
      // `published` é derivado: nenhum dos quatro o liga.
      expect(res.json().course.published, status).toBe(false)
    }

    await app.close()
  })

  // `publishedAt` é a PRIMEIRA publicação — ordena "Novos cursos" e não pode
  // pular para o topo a cada ida e volta entre rascunho e revisão.
  it('publishedAt marca a primeira publicação e não é reescrito depois', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const { courseId } = await createCourseWithLesson(app, token)

    const patch = (status: string) =>
      app.inject({ method: 'PATCH', url: `/admin/courses/${courseId}`, headers: auth(token), payload: { status } })

    const primeira = (await patch('PUBLISHED')).json().course.publishedAt
    expect(primeira).not.toBeNull()

    await patch('DRAFT')
    await patch('REVIEW')
    const republicado = (await patch('PUBLISHED')).json().course.publishedAt
    expect(republicado).toBe(primeira)

    await app.close()
  })

  it('recusa publicar curso sem aula e publica depois que existe conteúdo', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const course = await createCourse(app, token)

    const tooEarly = await app.inject({
      method: 'PATCH',
      url: `/admin/courses/${course.id}`,
      headers: auth(token),
      payload: { status: 'PUBLISHED' },
    })
    expect(tooEarly.statusCode).toBe(409)

    const moduleRes = await app.inject({
      method: 'POST',
      url: `/admin/courses/${course.id}/modules`,
      headers: auth(token),
      payload: { title: 'Módulo' },
    })
    await app.inject({
      method: 'POST',
      url: `/admin/course-modules/${moduleRes.json().course.modules[0].id}/lessons`,
      headers: auth(token),
      payload: { title: 'Aula', durationMinutes: 10 },
    })

    const published = await app.inject({
      method: 'PATCH',
      url: `/admin/courses/${course.id}`,
      headers: auth(token),
      payload: { status: 'PUBLISHED' },
    })
    expect(published.statusCode).toBe(200)
    expect(published.json().course.published).toBe(true)
    expect(published.json().course.publishedAt).not.toBeNull()

    await app.close()
  })

  it('rascunho não aparece no catálogo do colaborador; publicado aparece', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const dev = await devToken(app, 'colaboradora@empresa.com')
    const course = await createCourse(app, token)
    const moduleRes = await app.inject({
      method: 'POST',
      url: `/admin/courses/${course.id}/modules`,
      headers: auth(token),
      payload: { title: 'Módulo' },
    })
    await app.inject({
      method: 'POST',
      url: `/admin/course-modules/${moduleRes.json().course.modules[0].id}/lessons`,
      headers: auth(token),
      payload: { title: 'Aula', durationMinutes: 10 },
    })

    const draftCatalog = await app.inject({ method: 'GET', url: '/learning/courses', headers: auth(dev) })
    expect(draftCatalog.json().courses).toHaveLength(0)

    await app.inject({
      method: 'PATCH',
      url: `/admin/courses/${course.id}`,
      headers: auth(token),
      payload: { status: 'PUBLISHED' },
    })

    const liveCatalog = await app.inject({ method: 'GET', url: '/learning/courses', headers: auth(dev) })
    expect(liveCatalog.json().courses).toHaveLength(1)
    expect(liveCatalog.json().courses[0].durationMinutes).toBe(10)

    await app.close()
  })

  it('recusa excluir curso com pessoas inscritas', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const dev = await devToken(app, 'inscrita@empresa.com')
    const course = await createCourse(app, token)
    const moduleRes = await app.inject({
      method: 'POST',
      url: `/admin/courses/${course.id}/modules`,
      headers: auth(token),
      payload: { title: 'Módulo' },
    })
    await app.inject({
      method: 'POST',
      url: `/admin/course-modules/${moduleRes.json().course.modules[0].id}/lessons`,
      headers: auth(token),
      payload: { title: 'Aula', durationMinutes: 10 },
    })
    await app.inject({
      method: 'PATCH',
      url: `/admin/courses/${course.id}`,
      headers: auth(token),
      payload: { status: 'PUBLISHED' },
    })
    await app.inject({ method: 'POST', url: `/learning/courses/${course.id}/enroll`, headers: auth(dev) })

    const res = await app.inject({ method: 'DELETE', url: `/admin/courses/${course.id}`, headers: auth(token) })

    expect(res.statusCode).toBe(409)
    await app.close()
  })

  it('curso de outra empresa responde 404 na autoria', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const company = await prisma.company.create({ data: { id: 'company-outra', name: 'Outra', slug: 'outra' } })
    const alien = await prisma.course.create({
      data: { slug: 'alheio', title: 'Alheio', companyId: company.id },
    })

    const res = await app.inject({ method: 'GET', url: `/admin/courses/${alien.id}`, headers: auth(token) })

    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('recusa duração de aula fora do limite', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const course = await createCourse(app, token)
    const moduleRes = await app.inject({
      method: 'POST',
      url: `/admin/courses/${course.id}/modules`,
      headers: auth(token),
      payload: { title: 'Módulo' },
    })

    const res = await app.inject({
      method: 'POST',
      url: `/admin/course-modules/${moduleRes.json().course.modules[0].id}/lessons`,
      headers: auth(token),
      payload: { title: 'Aula', durationMinutes: 99999 },
    })

    expect(res.statusCode).toBe(400)
    await app.close()
  })
})

describe('autoria de quiz (admin)', () => {
  it('exige autenticação e bloqueia quem não é admin', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const course = await createCourse(app, token)
    const dev = await devToken(app, 'dev-quiz@empresa.com')

    const noToken = await app.inject({
      method: 'POST',
      url: `/admin/courses/${course.id}/quizzes`,
      payload: { title: 'Quiz final' },
    })
    expect(noToken.statusCode).toBe(401)

    const asLegend = await app.inject({
      method: 'POST',
      url: `/admin/courses/${course.id}/quizzes`,
      headers: auth(dev),
      payload: { title: 'Quiz final' },
    })
    expect(asLegend.statusCode).toBe(403)

    await app.close()
  })

  it('recusa dados inválidos com issues detalhados (400)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const course = await createCourse(app, token)

    const badQuiz = await app.inject({
      method: 'POST',
      url: `/admin/courses/${course.id}/quizzes`,
      headers: auth(token),
      payload: { title: '' },
    })
    expect(badQuiz.statusCode).toBe(400)
    expect(badQuiz.json().issues).toBeDefined()

    // Mesmo teto que `courseBodySchema.title`/`moduleSchema.title` já usam —
    // `CourseQuiz.title` é `String` (text) no Postgres, sem limite do banco.
    const tooLongQuiz = await app.inject({
      method: 'POST',
      url: `/admin/courses/${course.id}/quizzes`,
      headers: auth(token),
      payload: { title: 'x'.repeat(COURSE_TITLE_MAX_LENGTH + 1) },
    })
    expect(tooLongQuiz.statusCode).toBe(400)
    expect(tooLongQuiz.json().issues).toBeDefined()

    const quizRes = await app.inject({
      method: 'POST',
      url: `/admin/courses/${course.id}/quizzes`,
      headers: auth(token),
      payload: { title: 'Quiz final' },
    })
    const quizId = quizRes.json().quiz.id as string

    // Opção única: `quizOptionsSchema` exige ao menos duas — o 400 nasce do
    // schema compartilhado, não de uma regra escrita à mão na rota.
    const badQuestion = await app.inject({
      method: 'POST',
      url: `/admin/course-quizzes/${quizId}/questions`,
      headers: auth(token),
      payload: { statement: 'P?', options: [{ id: 'op-1', text: 'Só uma opção', correct: true }] },
    })
    expect(badQuestion.statusCode).toBe(400)
    expect(badQuestion.json().issues).toBeDefined()

    await app.close()
  })

  it('curso fora do setor de quem edita responde 404, nunca 403', async () => {
    const app = buildApp()
    await app.ready()
    const outroSector = await prisma.sector.create({ data: { name: 'Financeiro', slug: 'financeiro-quiz' } })
    const alien = await prisma.course.create({
      data: { slug: 'curso-fora-do-setor', title: 'Curso de outro setor', sectorId: outroSector.id },
    })
    const own = await prisma.course.create({
      data: { slug: 'curso-do-setor', title: 'Curso do próprio setor', sectorId: DEFAULT_SECTOR_ID },
    })
    const token = await subadminToken(app)

    const res = await app.inject({
      method: 'POST',
      url: `/admin/courses/${alien.id}/quizzes`,
      headers: auth(token),
      payload: { title: 'Quiz final' },
    })
    expect(res.statusCode).toBe(404)

    // Controle positivo: o mesmo SUBADMIN, no próprio setor, tem que conseguir —
    // sem isso o 404 acima também passaria com a rota simplesmente inexistente.
    const ownRes = await app.inject({
      method: 'POST',
      url: `/admin/courses/${own.id}/quizzes`,
      headers: auth(token),
      payload: { title: 'Quiz final' },
    })
    expect(ownRes.statusCode).toBe(201)

    await app.close()
  })

  it('cria, lê, atualiza e exclui o quiz final do curso', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const course = await createCourse(app, token)

    const created = await app.inject({
      method: 'POST',
      url: `/admin/courses/${course.id}/quizzes`,
      headers: auth(token),
      payload: { title: 'Quiz final', passingScore: 80 },
    })
    expect(created.statusCode).toBe(201)
    const quiz = created.json().quiz
    expect(quiz.lessonId).toBeNull()
    expect(quiz.passingScore).toBe(80)

    const got = await app.inject({ method: 'GET', url: `/admin/course-quizzes/${quiz.id}`, headers: auth(token) })
    expect(got.statusCode).toBe(200)
    expect(got.json().quiz.id).toBe(quiz.id)
    expect(got.json().questions).toEqual([])

    const patched = await app.inject({
      method: 'PATCH',
      url: `/admin/course-quizzes/${quiz.id}`,
      headers: auth(token),
      payload: { title: 'Quiz final revisado' },
    })
    expect(patched.statusCode).toBe(200)
    expect(patched.json().quiz.title).toBe('Quiz final revisado')

    const deleted = await app.inject({ method: 'DELETE', url: `/admin/course-quizzes/${quiz.id}`, headers: auth(token) })
    expect(deleted.statusCode).toBe(204)

    const afterDelete = await app.inject({ method: 'GET', url: `/admin/course-quizzes/${quiz.id}`, headers: auth(token) })
    expect(afterDelete.statusCode).toBe(404)

    await app.close()
  })

  it('cria quiz de aula via lessonId e recusa um segundo quiz final (409)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const { courseId, lessonId } = await createCourseWithLesson(app, token)

    const lessonQuiz = await app.inject({
      method: 'POST',
      url: `/admin/courses/${courseId}/quizzes`,
      headers: auth(token),
      payload: { title: 'Quiz da aula', lessonId },
    })
    expect(lessonQuiz.statusCode).toBe(201)
    expect(lessonQuiz.json().quiz.lessonId).toBe(lessonId)

    const firstFinal = await app.inject({
      method: 'POST',
      url: `/admin/courses/${courseId}/quizzes`,
      headers: auth(token),
      payload: { title: 'Quiz final' },
    })
    expect(firstFinal.statusCode).toBe(201)

    const secondFinal = await app.inject({
      method: 'POST',
      url: `/admin/courses/${courseId}/quizzes`,
      headers: auth(token),
      payload: { title: 'Outro quiz final' },
    })
    expect(secondFinal.statusCode).toBe(409)

    await app.close()
  })

  it('cria, atualiza e exclui questão, e reordena a lista completa', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const course = await createCourse(app, token)
    const quizRes = await app.inject({
      method: 'POST',
      url: `/admin/courses/${course.id}/quizzes`,
      headers: auth(token),
      payload: { title: 'Quiz final' },
    })
    const quizId = quizRes.json().quiz.id as string

    const q1 = await app.inject({
      method: 'POST',
      url: `/admin/course-quizzes/${quizId}/questions`,
      headers: auth(token),
      payload: { statement: 'Primeira?', options: twoOptions() },
    })
    expect(q1.statusCode).toBe(201)
    const q2 = await app.inject({
      method: 'POST',
      url: `/admin/course-quizzes/${quizId}/questions`,
      headers: auth(token),
      payload: { statement: 'Segunda?', options: twoOptions(1) },
    })
    expect(q2.statusCode).toBe(201)
    const q1Id = q1.json().question.id as string
    const q2Id = q2.json().question.id as string
    expect(q1.json().question.sortOrder).toBe(0)
    expect(q2.json().question.sortOrder).toBe(1)

    const patched = await app.inject({
      method: 'PATCH',
      url: `/admin/course-questions/${q1Id}`,
      headers: auth(token),
      payload: { statement: 'Primeira, revisada?' },
    })
    expect(patched.statusCode).toBe(200)
    expect(patched.json().question.statement).toBe('Primeira, revisada?')

    const reordered = await app.inject({
      method: 'PUT',
      url: `/admin/course-quizzes/${quizId}/questions/order`,
      headers: auth(token),
      payload: { ids: [q2Id, q1Id] },
    })
    expect(reordered.statusCode).toBe(204)

    const afterReorder = await app.inject({ method: 'GET', url: `/admin/course-quizzes/${quizId}`, headers: auth(token) })
    expect(afterReorder.json().questions.map((q: { id: string }) => q.id)).toEqual([q2Id, q1Id])

    const deleted = await app.inject({ method: 'DELETE', url: `/admin/course-questions/${q1Id}`, headers: auth(token) })
    expect(deleted.statusCode).toBe(204)

    const finalList = await app.inject({ method: 'GET', url: `/admin/course-quizzes/${quizId}`, headers: auth(token) })
    expect(finalList.json().questions).toHaveLength(1)

    await app.close()
  })

  it('lista os quizzes do curso (final e de aula)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const { courseId, lessonId } = await createCourseWithLesson(app, token)

    const empty = await app.inject({ method: 'GET', url: `/admin/courses/${courseId}/quizzes`, headers: auth(token) })
    expect(empty.statusCode).toBe(200)
    expect(empty.json().quizzes).toEqual([])

    await app.inject({
      method: 'POST',
      url: `/admin/courses/${courseId}/quizzes`,
      headers: auth(token),
      payload: { title: 'Quiz da aula', lessonId },
    })
    await app.inject({
      method: 'POST',
      url: `/admin/courses/${courseId}/quizzes`,
      headers: auth(token),
      payload: { title: 'Quiz final' },
    })

    const listed = await app.inject({ method: 'GET', url: `/admin/courses/${courseId}/quizzes`, headers: auth(token) })
    expect(listed.statusCode).toBe(200)
    const quizzes = listed.json().quizzes as { lessonId: string | null; title: string }[]
    expect(quizzes).toHaveLength(2)
    expect(quizzes.find((q) => q.lessonId === lessonId)?.title).toBe('Quiz da aula')
    expect(quizzes.find((q) => q.lessonId === null)?.title).toBe('Quiz final')

    await app.close()
  })
})

/**
 * As duas colunas existiam no `Course` e eram LIDAS (por `issueCertificate` e
 * pela fila de aprovação), mas ninguém as escrevia: não estavam no contrato
 * compartilhado, nem no schema Zod, nem no patch de `updateCourse`. Na prática
 * `requiresCertificateApproval` era sempre `false` — a fila de aprovação
 * inteira era código inalcançável — e `certificateTemplateId` sempre nulo.
 */
describe('curso — aprovação de certificado e modelo (round-trip)', () => {
  async function createTemplate(companyId = DEFAULT_COMPANY_ID, name = 'Modelo A') {
    return prisma.certificateTemplate.create({
      data: {
        name,
        title: 'Certificado',
        accentColor: '#2f8b4d',
        signatureName: 'Ana',
        signatureRole: 'CEO',
        companyId,
      },
    })
  }

  it('cria o curso já com a fila de aprovação ligada e um modelo escolhido', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const template = await createTemplate()

    const res = await app.inject({
      method: 'POST',
      url: '/admin/courses',
      headers: auth(token),
      payload: {
        title: 'Curso com fila',
        requiresCertificateApproval: true,
        certificateTemplateId: template.id,
      },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().course).toMatchObject({
      requiresCertificateApproval: true,
      certificateTemplateId: template.id,
    })
    const row = await prisma.course.findUniqueOrThrow({ where: { id: res.json().course.id } })
    expect(row.requiresCertificateApproval).toBe(true)
    expect(row.certificateTemplateId).toBe(template.id)

    await app.close()
  })

  it('curso nasce sem fila e sem modelo quando os campos não vêm', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)

    const course = await createCourse(app, token)

    const row = await prisma.course.findUniqueOrThrow({ where: { id: course.id } })
    expect(row.requiresCertificateApproval).toBe(false)
    expect(row.certificateTemplateId).toBeNull()

    await app.close()
  })

  it('atualiza os dois campos e volta ao modelo padrão da empresa com string vazia', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const template = await createTemplate()
    const course = await createCourse(app, token)

    const on = await app.inject({
      method: 'PATCH',
      url: `/admin/courses/${course.id}`,
      headers: auth(token),
      payload: { requiresCertificateApproval: true, certificateTemplateId: template.id },
    })
    expect(on.statusCode).toBe(200)
    expect(on.json().course).toMatchObject({
      requiresCertificateApproval: true,
      certificateTemplateId: template.id,
    })

    // '' do formulário vira null (mesmo `emptyToNull` do `sectorId`).
    const off = await app.inject({
      method: 'PATCH',
      url: `/admin/courses/${course.id}`,
      headers: auth(token),
      payload: { requiresCertificateApproval: false, certificateTemplateId: '' },
    })
    expect(off.json().course).toMatchObject({
      requiresCertificateApproval: false,
      certificateTemplateId: null,
    })

    await app.close()
  })

  it('recusa (404) um modelo de outra empresa, na criação e na atualização', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const otherCompany = await prisma.company.create({
      data: { name: 'Outra Empresa Modelo', slug: 'outra-empresa-modelo-curso' },
    })
    const foreign = await createTemplate(otherCompany.id, 'Modelo de fora')

    const created = await app.inject({
      method: 'POST',
      url: '/admin/courses',
      headers: auth(token),
      payload: { title: 'Curso com modelo alheio', certificateTemplateId: foreign.id },
    })
    expect(created.statusCode).toBe(404)
    expect(created.json().message).toBe('Modelo de certificado não encontrado.')
    expect(await prisma.course.count({ where: { title: 'Curso com modelo alheio' } })).toBe(0)

    const course = await createCourse(app, token)
    const updated = await app.inject({
      method: 'PATCH',
      url: `/admin/courses/${course.id}`,
      headers: auth(token),
      payload: { certificateTemplateId: foreign.id },
    })
    expect(updated.statusCode).toBe(404)
    expect((await prisma.course.findUniqueOrThrow({ where: { id: course.id } })).certificateTemplateId).toBeNull()

    await app.close()
  })
})

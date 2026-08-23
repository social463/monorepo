import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import type { CourseActor } from './course-admin-service'
import {
  CertificateError,
  approveCertificateRequest,
  createCertificateTemplate,
  deleteCertificateTemplate,
  ensureCertificateRequestForEnrollment,
  listCertificateRequests,
  listCertificateTemplates,
  rejectCertificateRequest,
  resolveCertificateTemplateForCourse,
  updateCertificateTemplate,
  type CertificateActor,
} from './certificate-request-service'
import { notifyCertificateApproved } from './notification-service'
import { scopedPrisma } from '../lib/tenant-scope'

/**
 * `notifyCertificateApproved` fica atrás de um spy que delega pra implementação
 * de verdade (grava a notificação de verdade) — não é um mock burro. Serve só
 * pra provar, num teste específico, que uma falha ao notificar não desfaz a
 * aprovação já commitada (best-effort).
 */
vi.mock('./notification-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./notification-service')>()
  return { ...actual, notifyCertificateApproved: vi.fn(actual.notifyCertificateApproved) }
})

/**
 * CRUD de `CertificateTemplate` (Task 8) e fila de aprovação de certificado
 * (Task 9, no fim do arquivo).
 */

/** `recordAuditLog` exige um `actorId` que exista de verdade (FK) — nunca um id solto. */
async function makeActor(companyId = DEFAULT_COMPANY_ID): Promise<CertificateActor> {
  const user = await prisma.user.create({
    data: {
      name: 'Admin',
      email: `admin-cert-${Math.random().toString(36).slice(2)}@empresa.com`,
      passwordHash: 'x',
      role: 'ADMIN',
      companyId,
    },
  })
  return { id: user.id, companyId }
}

let actor: CertificateActor

beforeEach(async () => {
  actor = await makeActor()
})

function templateInput(overrides: Partial<Parameters<typeof createCertificateTemplate>[1]> = {}) {
  return {
    name: 'Modelo padrão',
    title: 'Certificado de conclusão',
    accentColor: '#2f8b4d',
    signatureName: 'Ana Diretora',
    signatureRole: 'Diretora de Gente e Gestão',
    ...overrides,
  }
}

describe('CRUD de modelo de certificado', () => {
  it('cria um modelo com os dados enviados', async () => {
    const created = await createCertificateTemplate(actor, templateInput())

    expect(created.name).toBe('Modelo padrão')
    expect(created.title).toBe('Certificado de conclusão')
    expect(created.accentColor).toBe('#2f8b4d')
    expect(created.signatureName).toBe('Ana Diretora')
    expect(created.isDefault).toBe(false)
    expect(created.backgroundUrl).toBeNull()
    expect(created.logoUrl).toBeNull()
  })

  it('lista os modelos da empresa', async () => {
    await createCertificateTemplate(actor, templateInput({ name: 'A' }))
    await createCertificateTemplate(actor, templateInput({ name: 'B' }))

    const templates = await listCertificateTemplates(actor)

    expect(templates.map((t) => t.name).sort()).toEqual(['A', 'B'])
  })

  it('atualiza campos parciais sem tocar no resto', async () => {
    const created = await createCertificateTemplate(actor, templateInput())

    const updated = await updateCertificateTemplate(actor, created.id, { accentColor: '#000000' })

    expect(updated.accentColor).toBe('#000000')
    expect(updated.name).toBe(created.name)
    expect(updated.signatureName).toBe(created.signatureName)
  })

  it('exclui um modelo', async () => {
    const created = await createCertificateTemplate(actor, templateInput())

    await deleteCertificateTemplate(actor, created.id)

    const templates = await listCertificateTemplates(actor)
    expect(templates).toHaveLength(0)
  })

  it('atualizar ou excluir modelo inexistente responde 404', async () => {
    await expect(updateCertificateTemplate(actor, 'id-que-nao-existe', { name: 'X' })).rejects.toMatchObject({
      status: 404,
    })
    await expect(deleteCertificateTemplate(actor, 'id-que-nao-existe')).rejects.toMatchObject({ status: 404 })
  })

  it('recusa nome vazio', async () => {
    await expect(createCertificateTemplate(actor, templateInput({ name: '  ' }))).rejects.toBeInstanceOf(CertificateError)
  })

  it('modelo de outra empresa é 404 para esta empresa (isolamento de tenant)', async () => {
    const otherCompany = await prisma.company.create({ data: { id: 'company-cert-outra', name: 'Outra', slug: 'outra-cert' } })
    const alienTemplate = await prisma.certificateTemplate.create({
      data: { ...templateInput(), companyId: otherCompany.id },
    })

    await expect(updateCertificateTemplate(actor, alienTemplate.id, { name: 'X' })).rejects.toMatchObject({ status: 404 })

    const templates = await listCertificateTemplates(actor)
    expect(templates.find((t) => t.id === alienTemplate.id)).toBeUndefined()
  })
})

describe('só um modelo isDefault por empresa', () => {
  it('marcar um novo isDefault na criação desmarca o anterior', async () => {
    const first = await createCertificateTemplate(actor, templateInput({ name: 'Primeiro', isDefault: true }))
    expect(first.isDefault).toBe(true)

    const second = await createCertificateTemplate(actor, templateInput({ name: 'Segundo', isDefault: true }))
    expect(second.isDefault).toBe(true)

    const reloadedFirst = await prisma.certificateTemplate.findUniqueOrThrow({ where: { id: first.id } })
    expect(reloadedFirst.isDefault).toBe(false)
  })

  it('marcar isDefault num update desmarca o anterior, sem afetar outra empresa', async () => {
    const otherCompany = await prisma.company.create({ data: { id: 'company-cert-b', name: 'B', slug: 'b-cert' } })
    const otherActor = await makeActor(otherCompany.id)

    const ownDefault = await createCertificateTemplate(actor, templateInput({ name: 'Padrão', isDefault: true }))
    const ownCandidate = await createCertificateTemplate(actor, templateInput({ name: 'Candidato' }))
    const otherDefault = await createCertificateTemplate(otherActor, templateInput({ name: 'Padrão de outra empresa', isDefault: true }))

    const promoted = await updateCertificateTemplate(actor, ownCandidate.id, { isDefault: true })
    expect(promoted.isDefault).toBe(true)

    const reloadedOwnDefault = await prisma.certificateTemplate.findUniqueOrThrow({ where: { id: ownDefault.id } })
    expect(reloadedOwnDefault.isDefault).toBe(false)

    // Empresa alheia não é tocada pela troca de isDefault desta empresa.
    const reloadedOtherDefault = await prisma.certificateTemplate.findUniqueOrThrow({ where: { id: otherDefault.id } })
    expect(reloadedOtherDefault.isDefault).toBe(true)
  })

  it('atualizar um modelo sem mexer em isDefault não desmarca o isDefault atual', async () => {
    const current = await createCertificateTemplate(actor, templateInput({ name: 'Padrão', isDefault: true }))

    const updated = await updateCertificateTemplate(actor, current.id, { accentColor: '#111111' })

    expect(updated.isDefault).toBe(true)
  })

  /**
   * Corrida de verdade: duas criações com `isDefault: true` disparadas ao
   * mesmo tempo (sem `await` entre elas), nenhum modelo `isDefault` existindo
   * ainda. Sob READ COMMITTED, o `updateMany` de cada transação não acha
   * nenhuma linha `isDefault: true` pra travar (a outra transação ainda não
   * commitou a sua), então as duas seguem e criam, e as DUAS terminam com
   * `isDefault: true` — a invariante quebra. Sob `Serializable`, o Postgres
   * detecta o conflito de predicado entre as duas transações e aborta uma
   * delas (`P2034`), que a service converte num 409 — nunca deixa passar.
   */
  it('duas criações concorrentes marcando isDefault nunca deixam dois modelos como padrão', async () => {
    const results = await Promise.allSettled([
      createCertificateTemplate(actor, templateInput({ name: 'Concorrente A', isDefault: true })),
      createCertificateTemplate(actor, templateInput({ name: 'Concorrente B', isDefault: true })),
    ])

    for (const result of results) {
      if (result.status === 'rejected') {
        expect(result.reason).toBeInstanceOf(CertificateError)
        expect((result.reason as CertificateError).status).toBe(409)
      }
    }

    const defaults = await prisma.certificateTemplate.findMany({ where: { companyId: actor.companyId, isDefault: true } })
    expect(defaults).toHaveLength(1)
  })
})

describe('cadeia de fallback: curso → isDefault da empresa → nenhum', () => {
  async function seedCourse(certificateTemplateId: string | null) {
    return prisma.course.create({
      data: {
        slug: `curso-cert-${Math.random().toString(36).slice(2)}`,
        title: 'Curso',
        category: 'X',
        companyId: DEFAULT_COMPANY_ID,
        certificateTemplateId,
      },
    })
  }

  it('usa o modelo do curso quando ele existe', async () => {
    const courseTemplate = await createCertificateTemplate(actor, templateInput({ name: 'Do curso' }))
    await createCertificateTemplate(actor, templateInput({ name: 'Padrão da empresa', isDefault: true }))
    const course = await seedCourse(courseTemplate.id)

    const resolved = await resolveCertificateTemplateForCourse(actor.companyId, course)

    expect(resolved?.id).toBe(courseTemplate.id)
  })

  it('sem modelo no curso, cai no isDefault da empresa', async () => {
    const companyDefault = await createCertificateTemplate(actor, templateInput({ name: 'Padrão da empresa', isDefault: true }))
    const course = await seedCourse(null)

    const resolved = await resolveCertificateTemplateForCourse(actor.companyId, course)

    expect(resolved?.id).toBe(companyDefault.id)
  })

  it('sem modelo no curso e sem isDefault, não resolve nenhum (visual embutido no renderer)', async () => {
    const course = await seedCourse(null)

    const resolved = await resolveCertificateTemplateForCourse(actor.companyId, course)

    expect(resolved).toBeNull()
  })
})

describe('fila de aprovação de certificado (Task 9)', () => {
  /** Ator da fila: papel e setor decidem o escopo (aprovação segue o escopo do curso). */
  async function makeCourseActor(overrides: Partial<Omit<CourseActor, 'id'>> = {}): Promise<CourseActor> {
    const role = overrides.role ?? 'ADMIN'
    const sectorId = overrides.sectorId ?? DEFAULT_SECTOR_ID
    const companyId = overrides.companyId ?? DEFAULT_COMPANY_ID
    if (sectorId !== DEFAULT_SECTOR_ID) {
      await prisma.sector.upsert({ where: { id: sectorId }, create: { id: sectorId, name: sectorId, slug: sectorId }, update: {} })
    }
    const user = await prisma.user.create({
      data: {
        name: `Ator ${role}`,
        email: `ator-fila-${Math.random().toString(36).slice(2)}@empresa.com`,
        passwordHash: 'x',
        role: role as never,
        sectorId,
        companyId,
      },
    })
    return { id: user.id, role, sectorId, companyId }
  }

  /** Curso com aprovação obrigatória, inscrição concluída e uma `CertificateRequest` PENDING —
   *  o estado em que a fila normalmente encontra uma solicitação nova. */
  async function makeRequestFixture(opts: { sectorId?: string | null; courseTitle?: string } = {}) {
    // `Course.sectorId` tem FK pra `Sector` — um id fora do `DEFAULT_SECTOR_ID`
    // (que sobrevive ao truncamento entre testes) precisa existir de verdade.
    if (opts.sectorId && opts.sectorId !== DEFAULT_SECTOR_ID) {
      await prisma.sector.upsert({
        where: { id: opts.sectorId },
        create: { id: opts.sectorId, name: opts.sectorId, slug: opts.sectorId },
        update: {},
      })
    }
    const course = await prisma.course.create({
      data: {
        slug: `curso-fila-${Math.random().toString(36).slice(2)}`,
        title: opts.courseTitle ?? 'Curso com aprovação obrigatória',
        category: 'Liderança',
        companyId: DEFAULT_COMPANY_ID,
        requiresCertificateApproval: true,
        sectorId: opts.sectorId ?? null,
      },
    })
    const courseModule = await prisma.courseModule.create({ data: { courseId: course.id, title: 'Módulo 1' } })
    const lesson = await prisma.courseLesson.create({
      data: { courseId: course.id, moduleId: courseModule.id, title: 'Aula 1', durationMinutes: 60, sortOrder: 0 },
    })
    const student = await prisma.user.create({
      data: {
        name: 'Estudante',
        email: `estudante-fila-${Math.random().toString(36).slice(2)}@empresa.com`,
        passwordHash: 'x',
        companyId: DEFAULT_COMPANY_ID,
      },
    })
    const enrollment = await prisma.courseEnrollment.create({
      data: { userId: student.id, courseId: course.id, status: 'COMPLETED', completedAt: new Date() },
    })
    const request = await prisma.certificateRequest.create({
      data: { enrollmentId: enrollment.id, userId: student.id, courseId: course.id },
    })
    return { course, student, enrollment, request, lesson }
  }

  beforeEach(() => {
    vi.mocked(notifyCertificateApproved).mockClear()
  })

  describe('listar', () => {
    it('lista por status e sem filtro lista tudo', async () => {
      const admin = await makeCourseActor()
      const { request: pending } = await makeRequestFixture()
      const { request: other } = await makeRequestFixture()
      await prisma.certificateRequest.update({
        where: { id: other.id },
        data: { status: 'REJECTED', reviewedById: admin.id, reviewedAt: new Date(), rejectionReason: 'Motivo' },
      })

      const onlyPending = await listCertificateRequests(admin, 'PENDING')
      expect(onlyPending.map((r) => r.id)).toEqual([pending.id])

      const all = await listCertificateRequests(admin)
      expect(all.map((r) => r.id).sort()).toEqual([pending.id, other.id].sort())
    })

    it('SUBADMIN só vê solicitação de curso do próprio setor', async () => {
      const subadmin = await makeCourseActor({ role: 'SUBADMIN', sectorId: DEFAULT_SECTOR_ID })
      const { request: doMeuSetor } = await makeRequestFixture({ sectorId: DEFAULT_SECTOR_ID })
      await makeRequestFixture({ sectorId: 'setor-outro-fila' })
      await makeRequestFixture({ sectorId: null })

      const requests = await listCertificateRequests(subadmin)

      expect(requests.map((r) => r.id)).toEqual([doMeuSetor.id])
    })
  })

  describe('aprovar', () => {
    it('emite pelo caminho existente e notifica', async () => {
      const admin = await makeCourseActor()
      const { request, student, course } = await makeRequestFixture()

      const { request: updated, certificate } = await approveCertificateRequest(admin, request.id)

      expect(updated.status).toBe('APPROVED')
      expect(updated.reviewedBy?.id).toBe(admin.id)
      expect(certificate.code).toMatch(/^EMR-[A-Z0-9]{8}$/)
      // Carga horária derivada da aula: 60 min = 1h.
      expect(certificate.hours).toBe(1)

      const stored = await prisma.certificate.findMany({ where: { userId: student.id, courseId: course.id } })
      expect(stored).toHaveLength(1)
      expect(stored[0].code).toBe(certificate.code)

      const notifications = await prisma.notification.findMany({
        where: { userId: student.id, type: 'CERTIFICATE_APPROVED' },
      })
      expect(notifications).toHaveLength(1)
      expect(vi.mocked(notifyCertificateApproved)).toHaveBeenCalledTimes(1)
    })

    it('não emite (e não notifica) para solicitação PENDING inexistente', async () => {
      const admin = await makeCourseActor()
      await expect(approveCertificateRequest(admin, 'id-que-nao-existe')).rejects.toMatchObject({ status: 404 })
    })

    it('aprovar uma solicitação já avaliada responde 409, sem emitir um segundo certificado', async () => {
      const admin = await makeCourseActor()
      const { request, student, course } = await makeRequestFixture()
      await approveCertificateRequest(admin, request.id)

      await expect(approveCertificateRequest(admin, request.id)).rejects.toMatchObject({ status: 409 })

      const stored = await prisma.certificate.count({ where: { userId: student.id, courseId: course.id } })
      expect(stored).toBe(1)
    })

    it('SUBADMIN de outro setor recebe 404 (nunca 403) ao tentar aprovar', async () => {
      const subadmin = await makeCourseActor({ role: 'SUBADMIN', sectorId: 'setor-fora-fila' })
      const { request } = await makeRequestFixture({ sectorId: DEFAULT_SECTOR_ID })

      await expect(approveCertificateRequest(subadmin, request.id)).rejects.toMatchObject({ status: 404 })
    })

    /**
     * Uma solicitação PENDING pode ficar dias na fila — o mundo ao redor dela
     * pode mudar. `approveCertificateRequest` reexecuta as mesmas guardas de
     * `issueCertificate` dentro da transação, não confia que "PENDING" ainda
     * implica elegível.
     */
    describe('reconfere elegibilidade no momento de aprovar (não confia que PENDING ainda vale)', () => {
      it('curso deixou de emitir certificado depois do pedido: 409, sem emitir', async () => {
        const admin = await makeCourseActor()
        const { request, student, course } = await makeRequestFixture()
        await prisma.course.update({ where: { id: course.id }, data: { certificateEnabled: false } })

        await expect(approveCertificateRequest(admin, request.id)).rejects.toMatchObject({ status: 409 })

        const stored = await prisma.certificate.count({ where: { userId: student.id, courseId: course.id } })
        expect(stored).toBe(0)
        const stillPending = await prisma.certificateRequest.findUniqueOrThrow({ where: { id: request.id } })
        expect(stillPending.status).toBe('PENDING')
      })

      it('a pessoa desmarcou uma aula depois do pedido (inscrição não está mais concluída): 409, sem emitir', async () => {
        const admin = await makeCourseActor()
        const { request, student, course, enrollment } = await makeRequestFixture()
        await prisma.courseEnrollment.update({
          where: { id: enrollment.id },
          data: { status: 'IN_PROGRESS', completedAt: null },
        })

        await expect(approveCertificateRequest(admin, request.id)).rejects.toMatchObject({ status: 409 })

        const stored = await prisma.certificate.count({ where: { userId: student.id, courseId: course.id } })
        expect(stored).toBe(0)
      })

      it('um quiz final foi adicionado depois do pedido e a pessoa não passou: 409, sem emitir', async () => {
        const admin = await makeCourseActor()
        const { request, student, course } = await makeRequestFixture()
        const newQuiz = await prisma.courseQuiz.create({
          data: { courseId: course.id, lessonId: null, title: 'Quiz final novo' },
        })
        // Com questão: quiz final sem nenhuma questão é casca e, de propósito,
        // não bloqueia (ver `hasUnpassedFinalQuiz`).
        await prisma.courseQuestion.create({
          data: {
            quizId: newQuiz.id,
            statement: 'Quanto é 2 + 2?',
            options: [
              { id: 'op-1', text: '3', correct: false },
              { id: 'op-2', text: '4', correct: true },
            ],
            sortOrder: 0,
          },
        })

        await expect(approveCertificateRequest(admin, request.id)).rejects.toMatchObject({ status: 409 })

        const stored = await prisma.certificate.count({ where: { userId: student.id, courseId: course.id } })
        expect(stored).toBe(0)
      })
    })

    it('notificação é best-effort: falha ao notificar não desfaz a aprovação já commitada', async () => {
      const admin = await makeCourseActor()
      const { request, student, course } = await makeRequestFixture()
      vi.mocked(notifyCertificateApproved).mockRejectedValueOnce(new Error('falha simulada de notificação'))

      const { request: updated, certificate } = await approveCertificateRequest(admin, request.id)

      expect(updated.status).toBe('APPROVED')
      expect(certificate.code).toMatch(/^EMR-/)
      const stored = await prisma.certificate.count({ where: { userId: student.id, courseId: course.id } })
      expect(stored).toBe(1)
    })

    /**
     * Corrida de verdade: duas aprovações da MESMA solicitação disparadas ao
     * mesmo tempo (sem `await` entre elas). Sem `Serializable`, as duas
     * leriam PENDING antes de qualquer uma escrever e as duas prosseguiriam —
     * dois audit logs, duas notificações, `reviewedBy` de quem commitou por
     * último. Sob `Serializable`, o Postgres detecta o conflito entre as duas
     * transações e aborta uma com `P2034` (mapeado para 409 por esta
     * service) — nunca deixa as duas passarem.
     */
    it('duas aprovações concorrentes na mesma solicitação nunca emitem dois certificados, nem duplicam auditoria ou notificação', async () => {
      const admin = await makeCourseActor()
      const { request, student, course } = await makeRequestFixture()

      const results = await Promise.allSettled([
        approveCertificateRequest(admin, request.id),
        approveCertificateRequest(admin, request.id),
      ])

      // Incondicionais de propósito (não `if (rejected) { ... }`): sem
      // `Serializable`, as DUAS transações passariam pela checagem "está
      // PENDENTE" antes de qualquer uma escrever. A segunda bateria no unique
      // index de `Certificate` (`userId_courseId`), cairia no fallback
      // `created: false` de `createCertificateRecord` e devolveria sucesso do
      // mesmo jeito — um certificado, status certo, e ESTE teste passaria
      // mesmo assim, mascarando dois audit logs e duas notificações (o dano
      // que o docblock de `approveCertificateRequest` descreve). Por isso as
      // asserções abaixo exigem exatamente uma rejeição, não "se houver".
      const fulfilled = results.filter((result) => result.status === 'fulfilled')
      const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      expect(rejected[0].reason).toBeInstanceOf(CertificateError)
      expect((rejected[0].reason as CertificateError).status).toBe(409)

      const stored = await prisma.certificate.count({ where: { userId: student.id, courseId: course.id } })
      expect(stored).toBe(1)

      const finalRequest = await prisma.certificateRequest.findUniqueOrThrow({ where: { id: request.id } })
      expect(finalRequest.status).toBe('APPROVED')

      const auditLogs = await prisma.adminAuditLog.count({
        where: { entityType: 'CertificateRequest', entityId: request.id, action: 'UPDATE' },
      })
      expect(auditLogs).toBe(1)

      const notifications = await prisma.notification.count({
        where: { userId: student.id, type: 'CERTIFICATE_APPROVED' },
      })
      expect(notifications).toBe(1)
    })
  })

  describe('recusar', () => {
    it('exige motivo — recusa vazio', async () => {
      const admin = await makeCourseActor()
      const { request } = await makeRequestFixture()

      await expect(rejectCertificateRequest(admin, request.id, '   ')).rejects.toBeInstanceOf(CertificateError)

      const stillPending = await prisma.certificateRequest.findUniqueOrThrow({ where: { id: request.id } })
      expect(stillPending.status).toBe('PENDING')
    })

    it('guarda o motivo e não emite certificado', async () => {
      const admin = await makeCourseActor()
      const { request, student, course } = await makeRequestFixture()

      const rejected = await rejectCertificateRequest(admin, request.id, 'Evidência de conclusão insuficiente.')

      expect(rejected.status).toBe('REJECTED')
      expect(rejected.rejectionReason).toBe('Evidência de conclusão insuficiente.')
      expect(rejected.reviewedBy?.id).toBe(admin.id)
      const stored = await prisma.certificate.count({ where: { userId: student.id, courseId: course.id } })
      expect(stored).toBe(0)
    })

    it('recusar uma solicitação já avaliada responde 409', async () => {
      const admin = await makeCourseActor()
      const { request } = await makeRequestFixture()
      await rejectCertificateRequest(admin, request.id, 'Motivo qualquer')

      await expect(rejectCertificateRequest(admin, request.id, 'Outro motivo')).rejects.toMatchObject({ status: 409 })
    })

    it(
      'permite nova solicitação depois: reabre a mesma linha para PENDING, sem duplicar, ' +
        'e o motivo da recusa anterior SOBREVIVE à reabertura (não é um "pedir de novo" deliberado)',
      async () => {
        const admin = await makeCourseActor()
        const { request, enrollment, student, course } = await makeRequestFixture()
        await rejectCertificateRequest(admin, request.id, 'Evidência insuficiente.')

        // "Nova solicitação" não é uma ação deliberada da pessoa — é a MESMA
        // guarda que `issueCertificate` chama toda vez que `setLessonCompletion`
        // reentra num curso já concluído (ex.: desmarcar/remarcar qualquer
        // aula). Por isso reabrir não pode apagar a evidência de que já foi
        // recusada — outro revisor não pode ver uma fila "imaculada" e aprovar
        // sem saber que já houve uma recusa.
        await ensureCertificateRequestForEnrollment(scopedPrisma(course.companyId), {
          enrollmentId: enrollment.id,
          userId: student.id,
          courseId: course.id,
        })

        const all = await prisma.certificateRequest.findMany({ where: { enrollmentId: enrollment.id } })
        expect(all).toHaveLength(1)
        expect(all[0].id).toBe(request.id)
        expect(all[0].status).toBe('PENDING')
        expect(all[0].rejectionReason).toBe('Evidência insuficiente.')
        expect(all[0].reviewedById).toBe(admin.id)

        // O DTO da fila também expõe esse histórico enquanto PENDING — quem
        // revisa vê, sem precisar abrir auditoria.
        const [listed] = await listCertificateRequests(admin, 'PENDING')
        expect(listed.rejectionReason).toBe('Evidência insuficiente.')
      },
    )

    it('aprovar depois de uma reabertura limpa o motivo da recusa anterior (não fica contraditório)', async () => {
      const admin = await makeCourseActor()
      const { request, enrollment, student, course } = await makeRequestFixture()
      await rejectCertificateRequest(admin, request.id, 'Evidência insuficiente.')
      await ensureCertificateRequestForEnrollment(scopedPrisma(course.companyId), {
        enrollmentId: enrollment.id,
        userId: student.id,
        courseId: course.id,
      })

      const { request: approved } = await approveCertificateRequest(admin, request.id)

      expect(approved.status).toBe('APPROVED')
      expect(approved.rejectionReason).toBeNull()
    })

    it('SUBADMIN de outro setor recebe 404 (nunca 403) ao tentar recusar', async () => {
      const subadmin = await makeCourseActor({ role: 'SUBADMIN', sectorId: 'setor-fora-fila-2' })
      const { request } = await makeRequestFixture({ sectorId: DEFAULT_SECTOR_ID })

      await expect(rejectCertificateRequest(subadmin, request.id, 'Motivo')).rejects.toMatchObject({ status: 404 })
    })
  })
})

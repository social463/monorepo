import { describe, expect, it } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

async function devToken(app: ReturnType<typeof buildApp>, email = 'dev-cert@empresa.com') {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Dev', email, password: 'changeme123' },
  })
  return res.json().accessToken as string
}

async function adminToken(app: ReturnType<typeof buildApp>, email = 'admin-cert@empresa.com') {
  await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Admin', email, password: 'changeme123' } })
  await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } })
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'changeme123' } })
  return res.json().accessToken as string
}

async function subadminToken(app: ReturnType<typeof buildApp>, email = 'subadmin-cert@empresa.com') {
  await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Subadmin', email, password: 'changeme123' } })
  await prisma.user.update({ where: { email }, data: { role: 'SUBADMIN' } })
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'changeme123' } })
  return res.json().accessToken as string
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` })

const TEMPLATE_PAYLOAD = {
  name: 'Modelo padrão',
  title: 'Certificado de conclusão',
  accentColor: '#2f8b4d',
  signatureName: 'Ana Diretora',
  signatureRole: 'Diretora de Gente e Gestão',
}

describe('modelos de certificado (admin) — restrito a ADMIN', () => {
  it('exige autenticação e bloqueia quem não é admin, inclusive SUBADMIN', async () => {
    const app = buildApp()
    await app.ready()
    const dev = await devToken(app)
    const subadmin = await subadminToken(app)

    expect((await app.inject({ method: 'GET', url: '/admin/certificate-templates' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/admin/certificate-templates', headers: auth(dev) })).statusCode).toBe(403)
    // Diferente da autoria de curso: SUBADMIN também é bloqueado aqui — modelo
    // de certificado é documento da empresa, não do setor.
    expect(
      (await app.inject({ method: 'GET', url: '/admin/certificate-templates', headers: auth(subadmin) })).statusCode,
    ).toBe(403)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/admin/certificate-templates',
          headers: auth(subadmin),
          payload: TEMPLATE_PAYLOAD,
        })
      ).statusCode,
    ).toBe(403)

    await app.close()
  })

  it('cria, lista, atualiza e exclui um modelo', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)

    const created = await app.inject({
      method: 'POST',
      url: '/admin/certificate-templates',
      headers: auth(token),
      payload: TEMPLATE_PAYLOAD,
    })
    expect(created.statusCode).toBe(201)
    const template = created.json().template
    expect(template.name).toBe('Modelo padrão')
    expect(template.isDefault).toBe(false)

    const listed = await app.inject({ method: 'GET', url: '/admin/certificate-templates', headers: auth(token) })
    expect(listed.statusCode).toBe(200)
    expect(listed.json().templates).toHaveLength(1)

    const updated = await app.inject({
      method: 'PATCH',
      url: `/admin/certificate-templates/${template.id}`,
      headers: auth(token),
      payload: { accentColor: '#000000' },
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json().template.accentColor).toBe('#000000')

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/admin/certificate-templates/${template.id}`,
      headers: auth(token),
    })
    expect(deleted.statusCode).toBe(204)

    const afterDelete = await app.inject({ method: 'GET', url: '/admin/certificate-templates', headers: auth(token) })
    expect(afterDelete.json().templates).toHaveLength(0)

    await app.close()
  })

  it('recusa dados inválidos com issues detalhados (400)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)

    const res = await app.inject({
      method: 'POST',
      url: '/admin/certificate-templates',
      headers: auth(token),
      payload: { ...TEMPLATE_PAYLOAD, name: '' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().issues).toBeDefined()

    await app.close()
  })

  it('modelo inexistente responde 404 ao atualizar ou excluir', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)

    const patched = await app.inject({
      method: 'PATCH',
      url: '/admin/certificate-templates/id-que-nao-existe',
      headers: auth(token),
      payload: { name: 'X' },
    })
    expect(patched.statusCode).toBe(404)

    const deleted = await app.inject({
      method: 'DELETE',
      url: '/admin/certificate-templates/id-que-nao-existe',
      headers: auth(token),
    })
    expect(deleted.statusCode).toBe(404)

    await app.close()
  })

  it('marcar isDefault ao criar desmarca o modelo anterior', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)

    const first = await app.inject({
      method: 'POST',
      url: '/admin/certificate-templates',
      headers: auth(token),
      payload: { ...TEMPLATE_PAYLOAD, name: 'Primeiro', isDefault: true },
    })
    expect(first.json().template.isDefault).toBe(true)

    const second = await app.inject({
      method: 'POST',
      url: '/admin/certificate-templates',
      headers: auth(token),
      payload: { ...TEMPLATE_PAYLOAD, name: 'Segundo', isDefault: true },
    })
    expect(second.json().template.isDefault).toBe(true)

    const listed = await app.inject({ method: 'GET', url: '/admin/certificate-templates', headers: auth(token) })
    const templates = listed.json().templates as { name: string; isDefault: boolean }[]
    expect(templates.find((t) => t.name === 'Primeiro')?.isDefault).toBe(false)
    expect(templates.find((t) => t.name === 'Segundo')?.isDefault).toBe(true)

    await app.close()
  })

  it('modelo de outra empresa responde 404, nunca 403', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const company = await prisma.company.create({ data: { id: 'company-cert-rotas', name: 'Outra', slug: 'outra-cert-rotas' } })
    const alien = await prisma.certificateTemplate.create({ data: { ...TEMPLATE_PAYLOAD, companyId: company.id } })

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/certificate-templates/${alien.id}`,
      headers: auth(token),
      payload: { name: 'X' },
    })
    expect(res.statusCode).toBe(404)

    await app.close()
  })
})

/** Curso com aprovação obrigatória, inscrição concluída e uma `CertificateRequest`
 *  PENDING já pronta — criada direto via Prisma, como o resto deste arquivo já faz
 *  para "alien" (fora do fluxo normal de conclusão de curso). */
async function makeRequestFixture(email: string) {
  await prisma.user.upsert({
    where: { email },
    create: { name: 'Estudante da fila', email, passwordHash: 'x' },
    update: {},
  })
  const student = await prisma.user.findUniqueOrThrow({ where: { email } })
  const course = await prisma.course.create({
    data: {
      slug: `curso-fila-rota-${Math.random().toString(36).slice(2)}`,
      title: 'Curso com aprovação obrigatória',
      category: 'Liderança',
      requiresCertificateApproval: true,
    },
  })
  const courseModule = await prisma.courseModule.create({ data: { courseId: course.id, title: 'Módulo 1' } })
  await prisma.courseLesson.create({
    data: { courseId: course.id, moduleId: courseModule.id, title: 'Aula 1', durationMinutes: 60, sortOrder: 0 },
  })
  const enrollment = await prisma.courseEnrollment.create({
    data: { userId: student.id, courseId: course.id, status: 'COMPLETED', completedAt: new Date() },
  })
  const request = await prisma.certificateRequest.create({
    data: { enrollmentId: enrollment.id, userId: student.id, courseId: course.id },
  })
  return { student, course, request }
}

describe('fila de aprovação de certificado (admin) — ADMIN e SUBADMIN, escopo do curso', () => {
  it('exige autenticação e bloqueia DEV; ADMIN e SUBADMIN passam (diferente do CRUD de modelo)', async () => {
    const app = buildApp()
    await app.ready()
    const dev = await devToken(app)
    const admin = await adminToken(app)
    const subadmin = await subadminToken(app)

    expect((await app.inject({ method: 'GET', url: '/admin/certificate-requests' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: '/admin/certificate-requests', headers: auth(dev) })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/admin/certificate-requests', headers: auth(admin) })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/admin/certificate-requests', headers: auth(subadmin) })).statusCode).toBe(
      200,
    )

    await app.close()
  })

  it('lista, filtra por status, aprova (emite certificado) e recusa (com motivo obrigatório)', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await adminToken(app)

    const { request: pending, student, course } = await makeRequestFixture('estudante-fila-rota-1@empresa.com')
    const { request: toReject } = await makeRequestFixture('estudante-fila-rota-2@empresa.com')

    const listed = await app.inject({ method: 'GET', url: '/admin/certificate-requests', headers: auth(admin) })
    expect(listed.statusCode).toBe(200)
    expect(listed.json().requests.map((r: { id: string }) => r.id).sort()).toEqual([pending.id, toReject.id].sort())

    const onlyPending = await app.inject({
      method: 'GET',
      url: '/admin/certificate-requests?status=PENDING',
      headers: auth(admin),
    })
    expect(onlyPending.json().requests).toHaveLength(2)

    // Recusa sem motivo é 400 — motivo é obrigatório.
    const rejectWithoutReason = await app.inject({
      method: 'POST',
      url: `/admin/certificate-requests/${toReject.id}/reject`,
      headers: auth(admin),
      payload: {},
    })
    expect(rejectWithoutReason.statusCode).toBe(400)

    const rejected = await app.inject({
      method: 'POST',
      url: `/admin/certificate-requests/${toReject.id}/reject`,
      headers: auth(admin),
      payload: { rejectionReason: 'Faltou anexar a evidência.' },
    })
    expect(rejected.statusCode).toBe(200)
    expect(rejected.json().request.status).toBe('REJECTED')
    expect(rejected.json().request.rejectionReason).toBe('Faltou anexar a evidência.')

    const approved = await app.inject({
      method: 'POST',
      url: `/admin/certificate-requests/${pending.id}/approve`,
      headers: auth(admin),
    })
    expect(approved.statusCode).toBe(200)
    expect(approved.json().request.status).toBe('APPROVED')
    expect(approved.json().certificate.code).toMatch(/^EMR-/)

    const stored = await prisma.certificate.count({ where: { userId: student.id, courseId: course.id } })
    expect(stored).toBe(1)

    await app.close()
  })

  it('solicitação inexistente responde 404 ao aprovar ou recusar', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await adminToken(app)

    const approve = await app.inject({
      method: 'POST',
      url: '/admin/certificate-requests/id-que-nao-existe/approve',
      headers: auth(admin),
    })
    expect(approve.statusCode).toBe(404)

    const reject = await app.inject({
      method: 'POST',
      url: '/admin/certificate-requests/id-que-nao-existe/reject',
      headers: auth(admin),
      payload: { rejectionReason: 'Motivo' },
    })
    expect(reject.statusCode).toBe(404)

    await app.close()
  })
})

import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import { createSquad } from '../services/squad-service'

async function adminToken(app: ReturnType<typeof buildApp>) {
  await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Admin', email: 'admin@empresa.com', password: 'changeme123' } })
  await prisma.user.update({ where: { email: 'admin@empresa.com' }, data: { role: 'ADMIN' } })
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'admin@empresa.com', password: 'changeme123' } })
  return res.json().accessToken as string
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Janela de votação inteiramente no futuro, ancorada em "agora" — o único jeito
 * de o estado esperado (SCHEDULED) valer em qualquer dia em que a suíte rodar.
 * `monthRef` sai do próprio início para não divergir da janela.
 */
function futureWindow(startInDays = 10, durationDays = 20) {
  const startsAt = new Date(Date.now() + startInDays * DAY_MS)
  const endsAt = new Date(startsAt.getTime() + durationDays * DAY_MS)
  return { monthRef: startsAt.toISOString().slice(0, 7), startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }
}

/** Mês corrente (YYYY-MM) — o único, além dos futuros, que a rota deixa editar. */
function currentMonthRef(): string {
  return new Date().toISOString().slice(0, 7)
}

async function devToken(app: ReturnType<typeof buildApp>) {
  const res = await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Dev', email: 'dev@empresa.com', password: 'changeme123' } })
  return res.json().accessToken as string
}

async function subadminToken(app: ReturnType<typeof buildApp>, sectorId: string) {
  const email = `subadmin-${sectorId}@empresa.com`
  await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Subadmin', email, password: 'changeme123' } })
  await prisma.user.update({ where: { email }, data: { role: 'SUBADMIN', sectorId } })
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'changeme123' } })
  return res.json().accessToken as string
}

async function adminTokenForCompany(app: ReturnType<typeof buildApp>, companyId: string, sectorId: string) {
  const email = `admin-${companyId}@empresa.com`
  await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Admin', email, password: 'changeme123' } })
  await prisma.user.update({ where: { email }, data: { role: 'ADMIN', companyId, sectorId } })
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'changeme123' } })
  return res.json().accessToken as string
}

describe('admin routes', () => {
  it('creates a category as admin (slug auto-generated)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const res = await app.inject({
      method: 'POST',
      url: '/admin/categories',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Bug Killer do Mês' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().category.slug).toBe('bug-killer-do-mes')
    expect(res.json().category.active).toBe(true)
    await app.close()
  })

  it('forbids a non-admin from creating a category (403)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await devToken(app)
    const res = await app.inject({
      method: 'POST',
      url: '/admin/categories',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Qualquer' },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('requires authentication (401)', async () => {
    const app = buildApp()
    await app.ready()
    const res = await app.inject({ method: 'POST', url: '/admin/categories', payload: { name: 'X' } })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('rejects a duplicate category name (409)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const payload = { name: 'Colaboração' }
    await app.inject({ method: 'POST', url: '/admin/categories', headers: { authorization: `Bearer ${token}` }, payload })
    const res = await app.inject({ method: 'POST', url: '/admin/categories', headers: { authorization: `Bearer ${token}` }, payload })
    expect(res.statusCode).toBe(409)
    await app.close()
  })

  it('lists all categories including inactive (GET /admin/categories)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    await prisma.recognitionCategory.create({ data: { name: 'Ativa', slug: 'ativa' } })
    await prisma.recognitionCategory.create({ data: { name: 'Inativa', slug: 'inativa', active: false } })
    const res = await app.inject({ method: 'GET', url: '/admin/categories', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json().categories).toHaveLength(2)
    await app.close()
  })

  it('updates a category (deactivate)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const category = await prisma.recognitionCategory.create({ data: { name: 'Colaboração', slug: 'colaboracao' } })
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/categories/${category.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { active: false },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().category.active).toBe(false)
    await app.close()
  })

  it('cria categoria com descrição e ordem, e desativa em vez de apagar', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)

    const created = await app.inject({
      method: 'POST', url: '/admin/categories',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Categoria Nova Test', description: 'Ajuda ativa e apoio.', order: 3 },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().category.slug).toBe('categoria-nova-test')
    expect(created.json().category.description).toBe('Ajuda ativa e apoio.')
    expect(created.json().category.order).toBe(3)

    const categoryId = created.json().category.id
    const off = await app.inject({
      method: 'PATCH', url: `/admin/categories/${categoryId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { active: false },
    })
    expect(off.statusCode).toBe(200)
    expect(off.json().category.active).toBe(false)

    // Desativada some do catálogo que o composer e a votação oferecem…
    const publico = await app.inject({ method: 'GET', url: '/categories', headers: { authorization: `Bearer ${token}` } })
    expect(publico.json().categories.some((c: { id: string }) => c.id === categoryId)).toBe(false)
    // …mas continua na lista da administração, para poder ser religada.
    const admin = await app.inject({ method: 'GET', url: '/admin/categories', headers: { authorization: `Bearer ${token}` } })
    expect(admin.json().categories.some((c: { id: string }) => c.id === categoryId)).toBe(true)
    await app.close()
  })

  it('audita a criação da categoria com nome e slug', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const created = await app.inject({
      method: 'POST', url: '/admin/categories',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Categoria Audit Test' },
    })
    const categoryId = created.json().category.id
    const log = await prisma.adminAuditLog.findFirst({ where: { entityType: 'RecognitionCategory', entityId: categoryId, action: 'CREATE' } })
    expect(log).not.toBeNull()
    expect((log!.after as { name: string; slug: string })).toMatchObject({
      name: 'Categoria Audit Test',
      slug: 'categoria-audit-test',
    })
    await app.close()
  })

  it('o catálogo de categorias é da empresa inteira — Subadmin vê e edita tudo', async () => {
    // O recorte por setor morreu com a unificação dos catálogos: a lista vale
    // para o feedback e para a votação, e é a mesma para toda a empresa
    // (`specs/2026-08-20-unificar-reconhecimento-em-feedback-design.md`).
    const app = buildApp()
    await app.ready()
    const sectorA = await prisma.sector.create({ data: { name: 'Setor A Cat', slug: 'setor-a-cat', enabledFeatures: [] } })
    const token = await subadminToken(app, sectorA.id)
    const existente = await prisma.recognitionCategory.create({ data: { name: 'Colaboração', slug: 'colaboracao' } })

    const list = await app.inject({ method: 'GET', url: '/admin/categories', headers: { authorization: `Bearer ${token}` } })
    expect(list.json().categories.map((c: { name: string }) => c.name)).toContain('Colaboração')

    const created = await app.inject({
      method: 'POST', url: '/admin/categories',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Nova Categoria Subadmin' },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().category.slug).toBe('nova-categoria-subadmin')

    const editado = await app.inject({
      method: 'PATCH', url: `/admin/categories/${existente.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Colaboração e apoio' },
    })
    expect(editado.statusCode).toBe(200)
    expect(editado.json().category.name).toBe('Colaboração e apoio')
    // Renomear NÃO mexe no slug: é ele que os selos de categoria referenciam.
    expect(editado.json().category.slug).toBe('colaboracao')
    await app.close()
  })

  it('schedules a future voting period (201, state SCHEDULED) and closes it', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    // Janela relativa a "agora": com datas cravadas o teste vira bomba-relógio —
    // no dia em que o calendário alcança o início, o período nasce ACTIVE e o
    // SCHEDULED esperado aqui deixa de valer.
    const future = futureWindow()
    const open = await app.inject({
      method: 'POST',
      url: '/admin/periods',
      headers: { authorization: `Bearer ${token}` },
      payload: { monthRef: future.monthRef, startsAt: future.startsAt, endsAt: future.endsAt },
    })
    expect(open.statusCode).toBe(201)
    expect(open.json().period.status).toBe('OPEN')
    expect(open.json().period.state).toBe('SCHEDULED')
    const periodId = open.json().period.id
    const close = await app.inject({ method: 'POST', url: `/admin/periods/${periodId}/close`, headers: { authorization: `Bearer ${token}` } })
    expect(close.statusCode).toBe(200)
    expect(close.json().period.status).toBe('CLOSED')
    expect(close.json().period.state).toBe('ENDED')
    await app.close()
  })

  it('preserves custom start and end times when scheduling a period', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    // Datas no futuro (senão a rota recusa), mas com hora "quebrada" cravada —
    // é justamente o horário que este teste verifica que sobrevive.
    const startsAt = new Date(Date.now() + 10 * DAY_MS)
    startsAt.setUTCHours(9, 30, 0, 0)
    const endsAt = new Date(Date.now() + 17 * DAY_MS)
    endsAt.setUTCHours(18, 45, 0, 0)

    const res = await app.inject({
      method: 'POST',
      url: '/admin/periods',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        monthRef: startsAt.toISOString().slice(0, 7),
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().period.startsAt).toBe(startsAt.toISOString())
    expect(res.json().period.endsAt).toBe(endsAt.toISOString())
    await app.close()
  })

  it('rejects scheduling when endsAt is not after startsAt (400)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const res = await app.inject({
      method: 'POST',
      url: '/admin/periods',
      headers: { authorization: `Bearer ${token}` },
      payload: { monthRef: '2026-08', startsAt: '2026-08-10', endsAt: '2026-08-05' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('rejects scheduling a period entirely in the past (400)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const res = await app.inject({
      method: 'POST',
      url: '/admin/periods',
      headers: { authorization: `Bearer ${token}` },
      payload: { monthRef: '2020-01', startsAt: '2020-01-01', endsAt: '2020-01-31' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('rejects a duplicate month (409)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const payload = futureWindow()
    await app.inject({ method: 'POST', url: '/admin/periods', headers: { authorization: `Bearer ${token}` }, payload })
    const res = await app.inject({ method: 'POST', url: '/admin/periods', headers: { authorization: `Bearer ${token}` }, payload })
    expect(res.statusCode).toBe(409)
    await app.close()
  })

  it('edits the window of a current/future period (PATCH 200)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    // Mês corrente: só ele (ou futuro) é editável — com um mês cravado o teste
    // passaria a bater no 409 de "mês já passou" assim que o calendário virasse.
    const created = await prisma.votingPeriod.create({
      data: { monthRef: currentMonthRef(), startsAt: new Date(), endsAt: new Date(Date.now() + DAY_MS), status: 'OPEN' },
    })
    const startsAt = new Date(Date.now() + 5 * DAY_MS)
    const endsAt = new Date(Date.now() + 20 * DAY_MS)
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/periods/${created.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().period.startsAt).toBe(startsAt.toISOString())
    expect(res.json().period.endsAt).toBe(endsAt.toISOString())
    await app.close()
  })

  it('re-opens a closed period when editing its window so it becomes upcoming again', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    // Período do mês corrente, fechado, mas com janela no futuro (cenário de "reagendar").
    const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
    const later = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
    const created = await prisma.votingPeriod.create({
      data: { monthRef: new Date().toISOString().slice(0, 7), startsAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), endsAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), status: 'CLOSED' },
    })
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/periods/${created.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { startsAt: future.toISOString(), endsAt: later.toISOString() },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().period.status).toBe('OPEN')
    expect(res.json().period.state).toBe('SCHEDULED')
    // E agora aparece como próximo período para o desenvolvedor.
    const next = await app.inject({ method: 'GET', url: '/periods/next', headers: { authorization: `Bearer ${token}` } })
    expect(next.json().period.id).toBe(created.id)
    await app.close()
  })

  it('refuses to edit a period whose month already passed (409)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const past = await prisma.votingPeriod.create({ data: { monthRef: '2026-01', startsAt: new Date('2026-01-01'), endsAt: new Date('2026-01-31'), status: 'CLOSED' } })
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/periods/${past.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { startsAt: '2026-01-05', endsAt: '2026-01-20' },
    })
    expect(res.statusCode).toBe(409)
    await app.close()
  })

  it('returns 404 editing an unknown period', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/periods/unknown',
      headers: { authorization: `Bearer ${token}` },
      payload: { startsAt: '2026-08-01', endsAt: '2026-08-10' },
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('rejects editing with endsAt not after startsAt (400)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    // Mês corrente, senão o 409 de "mês já passou" mascararia o 400 de janela
    // invertida que este teste quer provar.
    const created = await prisma.votingPeriod.create({
      data: { monthRef: currentMonthRef(), startsAt: new Date(), endsAt: new Date(Date.now() + DAY_MS), status: 'OPEN' },
    })
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/periods/${created.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        startsAt: new Date(Date.now() + 20 * DAY_MS).toISOString(),
        endsAt: new Date(Date.now() + 10 * DAY_MS).toISOString(),
      },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('agenda períodos independentes por setor para o mesmo mês (POST /admin/periods)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const sectorRes = await app.inject({
      method: 'POST',
      url: '/admin/sectors',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Vendas', enabledFeatures: [], roles: [] },
    })
    const sectorId = sectorRes.json().sector.id

    // O mesmo mês nos dois setores — é o ponto do teste (a unique é por setor).
    const sameMonth = futureWindow()

    const defaultPeriod = await app.inject({
      method: 'POST',
      url: '/admin/periods',
      headers: { authorization: `Bearer ${token}` },
      payload: sameMonth,
    })
    expect(defaultPeriod.statusCode).toBe(201)
    expect(defaultPeriod.json().period.sectorId).toBe('sector-dev-produto')

    const sectorPeriod = await app.inject({
      method: 'POST',
      url: '/admin/periods',
      headers: { authorization: `Bearer ${token}` },
      payload: { ...sameMonth, sectorId },
    })
    expect(sectorPeriod.statusCode).toBe(201)
    expect(sectorPeriod.json().period.sectorId).toBe(sectorId)
    await app.close()
  })

  it('lists all periods for management (GET /admin/periods)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    await prisma.votingPeriod.create({ data: { monthRef: '2026-09', startsAt: new Date('2026-09-01'), endsAt: new Date('2026-09-30'), status: 'OPEN' } })
    await prisma.votingPeriod.create({ data: { monthRef: '2026-01', startsAt: new Date('2026-01-01'), endsAt: new Date('2026-01-31'), status: 'OPEN' } })
    const res = await app.inject({ method: 'GET', url: '/admin/periods', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const periods = res.json().periods as Array<{ monthRef: string; state: string }>
    expect(periods).toHaveLength(2)
    // Ordenado por startsAt desc: setembro antes de janeiro.
    expect(periods[0].monthRef).toBe('2026-09')
    expect(periods.every((p) => typeof p.state === 'string')).toBe(true)
    await app.close()
  })

  it('GET /admin/periods não lista períodos de outra empresa', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa GET Periods', slug: 'outra-empresa-get-periods-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa GET Periods', slug: 'setor-outra-empresa-get-periods-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const otherPeriod = await prisma.votingPeriod.create({
      data: { monthRef: '2026-09', startsAt: new Date('2026-09-01'), endsAt: new Date('2026-09-30'), status: 'OPEN', sectorId: otherSector.id, companyId: otherCompany.id },
    })

    const res = await app.inject({ method: 'GET', url: '/admin/periods', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const ids = (res.json().periods as Array<{ id: string }>).map((p) => p.id)
    expect(ids).not.toContain(otherPeriod.id)
    await app.close()
  })

  it('POST /admin/periods rejeita sectorId de outra empresa (400) e exige sectorId explícito fora da empresa default', async () => {
    const app = buildApp()
    await app.ready()
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa POST Period', slug: 'outra-empresa-post-period-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa POST Period', slug: 'setor-outra-empresa-post-period-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const otherAdmin = await prisma.user.create({
      data: { name: 'Admin Outra Period', email: `admin-outra-post-period-${Date.now()}@x.com`, passwordHash: 'x', role: 'ADMIN', companyId: otherCompany.id, sectorId: otherSector.id },
    })
    const otherAdminToken = app.jwt.sign({ sub: otherAdmin.id, role: 'ADMIN', sectorId: otherSector.id, companyId: otherCompany.id, features: [] })

    // sem sectorId, empresa não-default: 400 (não pode cair silenciosamente na empresa default)
    const missing = await app.inject({
      method: 'POST',
      url: '/admin/periods',
      headers: { authorization: `Bearer ${otherAdminToken}` },
      payload: { monthRef: '2026-08', startsAt: '2026-08-01', endsAt: '2026-08-31' },
    })
    expect(missing.statusCode).toBe(400)

    // sectorId de outra empresa: 400 (não pode criar período em empresa diferente da do ator).
    // A janela precisa ser futura: com data no passado o 400 viria da validação de
    // janela e o teste passaria sem nunca exercitar o isolamento entre empresas.
    const alphaAdminToken = await adminToken(app)
    const cross = await app.inject({
      method: 'POST',
      url: '/admin/periods',
      headers: { authorization: `Bearer ${alphaAdminToken}` },
      payload: { ...futureWindow(), sectorId: otherSector.id },
    })
    expect(cross.statusCode).toBe(400)

    await app.close()
  })

  it('Subadmin só vê/agenda/edita períodos do próprio setor', async () => {
    const app = buildApp()
    await app.ready()
    const sectorA = await prisma.sector.create({ data: { name: 'Setor A Período', slug: 'setor-a-periodo', enabledFeatures: [] } })
    const sectorB = await prisma.sector.create({ data: { name: 'Setor B Período', slug: 'setor-b-periodo', enabledFeatures: [] } })
    const token = await subadminToken(app, sectorA.id)
    const periodB = await prisma.votingPeriod.create({
      data: { sectorId: sectorB.id, monthRef: '2026-08', startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 2 * 86400000), status: 'OPEN' },
    })

    // ?sectorId= de outro setor é ignorado, sempre volta só o próprio.
    const list = await app.inject({ method: 'GET', url: `/admin/periods?sectorId=${sectorB.id}`, headers: { authorization: `Bearer ${token}` } })
    const monthRefs = list.json().periods.map((p: { monthRef: string }) => p.monthRef)
    expect(monthRefs).not.toContain('2026-08')

    const created = await app.inject({
      method: 'POST',
      url: '/admin/periods',
      headers: { authorization: `Bearer ${token}` },
      payload: { monthRef: '2026-09', startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: new Date(Date.now() + 2 * 86400000).toISOString(), sectorId: sectorB.id },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().period.sectorId).toBe(sectorA.id)

    const editOther = await app.inject({
      method: 'PATCH',
      url: `/admin/periods/${periodB.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: new Date(Date.now() + 3 * 86400000).toISOString() },
    })
    expect(editOther.statusCode).toBe(404)
    await app.close()
  })

  it('deletes a vote for moderation (204), then 404', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const voter = await prisma.user.create({ data: { name: 'V', email: 'v@empresa.com', passwordHash: 'x' } })
    const voted = await prisma.user.create({ data: { name: 'W', email: 'w@empresa.com', passwordHash: 'x' } })
    const cat = await prisma.recognitionCategory.create({ data: { name: 'Colaboração', slug: 'colaboracao' } })
    const period = await prisma.votingPeriod.create({ data: { monthRef: '2026-06', startsAt: new Date('2026-06-01'), endsAt: new Date('2026-06-30'), status: 'OPEN' } })
    const vote = await prisma.vote.create({ data: { voterId: voter.id, votedId: voted.id, periodId: period.id, justification: 'conteúdo a moderar', categories: { create: [{ categoryId: cat.id }] } } })
    const del = await app.inject({ method: 'DELETE', url: `/admin/votes/${vote.id}`, headers: { authorization: `Bearer ${token}` } })
    expect(del.statusCode).toBe(204)
    const again = await app.inject({ method: 'DELETE', url: `/admin/votes/${vote.id}`, headers: { authorization: `Bearer ${token}` } })
    expect(again.statusCode).toBe(404)
    await app.close()
  })

  it('lists developers including inactive, excluding admins (GET /admin/users)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    await prisma.user.create({ data: { name: 'Inativo', email: 'inativo@empresa.com', passwordHash: 'x', active: false } })
    const res = await app.inject({ method: 'GET', url: '/admin/users', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const users = res.json().users as Array<{ name: string; role: string }>
    expect(users.some((u) => u.name === 'Inativo')).toBe(true)
    expect(users.some((u) => u.role === 'ADMIN')).toBe(false)
    await app.close()
  })

  it('lista contas ADMIN/SUBADMIN em GET /admin/administrators (admin only)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const adminUser = await prisma.user.create({ data: { name: 'Outro Admin', email: 'outro-admin@empresa.com', passwordHash: 'x', role: 'ADMIN' } })
    const subadminUser = await prisma.user.create({ data: { name: 'Um Subadmin', email: 'um-subadmin@empresa.com', passwordHash: 'x', role: 'SUBADMIN' } })
    const legendUser = await prisma.user.create({ data: { name: 'Uma Lenda', email: 'uma-lenda@empresa.com', passwordHash: 'x', role: 'LEGEND' } })

    const res = await app.inject({ method: 'GET', url: '/admin/administrators', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const ids = res.json().users.map((u: { id: string }) => u.id)
    expect(ids).toContain(adminUser.id)
    expect(ids).toContain(subadminUser.id)
    expect(ids).not.toContain(legendUser.id)
    await app.close()
  })

  it('GET /admin/users e GET /admin/administrators não listam usuários de outra empresa', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa GET Users', slug: 'outra-empresa-get-users-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa GET Users', slug: 'setor-outra-empresa-get-users-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const otherLegend = await prisma.user.create({ data: { name: 'Lenda Outra Empresa', email: 'lenda-outra-empresa-get-users@x.com', passwordHash: 'x', role: 'LEGEND', companyId: otherCompany.id, sectorId: otherSector.id } })
    const otherAdmin = await prisma.user.create({ data: { name: 'Admin Outra Empresa', email: 'admin-outra-empresa-get-users@x.com', passwordHash: 'x', role: 'ADMIN', companyId: otherCompany.id, sectorId: otherSector.id } })

    const users = await app.inject({ method: 'GET', url: '/admin/users', headers: { authorization: `Bearer ${token}` } })
    expect(users.json().users.map((u: { id: string }) => u.id)).not.toContain(otherLegend.id)

    const admins = await app.inject({ method: 'GET', url: '/admin/administrators', headers: { authorization: `Bearer ${token}` } })
    expect(admins.json().users.map((u: { id: string }) => u.id)).not.toContain(otherAdmin.id)

    await app.close()
  })

  it('PATCH /admin/users/:id rejeita id de usuário de outra empresa (404, não 200)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Patch Users', slug: 'outra-empresa-patch-users-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa Patch Users', slug: 'setor-outra-empresa-patch-users-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const otherUser = await prisma.user.create({ data: { name: 'Dev Outra Empresa', email: 'dev-outra-empresa-patch-users@x.com', passwordHash: 'x', role: 'LEGEND', companyId: otherCompany.id, sectorId: otherSector.id, active: true } })

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${otherUser.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { active: false },
    })
    expect(res.statusCode).toBe(404)

    const stillActive = await prisma.user.findUniqueOrThrow({ where: { id: otherUser.id } })
    expect(stillActive.active).toBe(true)
    await app.close()
  })

  it('GET /admin/users/:userId/badges rejeita id de usuário de outra empresa (404)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Badges Users', slug: 'outra-empresa-badges-users-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa Badges Users', slug: 'setor-outra-empresa-badges-users-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const otherUser = await prisma.user.create({ data: { name: 'Dev Outra Empresa Badges', email: 'dev-outra-empresa-badges-users@x.com', passwordHash: 'x', role: 'LEGEND', companyId: otherCompany.id, sectorId: otherSector.id } })

    const res = await app.inject({ method: 'GET', url: `/admin/users/${otherUser.id}/badges`, headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  // A foto é a identificação da pessoa em toda a plataforma (o personagem LPC
  // vale só no Escritório Virtual), e quem cadastra é o admin.
  it('grava, troca e limpa a foto do colaborador (POST/PATCH /admin/users)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const sector = await prisma.sector.create({ data: { name: 'Setor Foto', slug: 'setor-foto', enabledFeatures: [], roles: { create: [{ role: 'LEGEND' }] } } })

    const created = await app.inject({
      method: 'POST', url: '/admin/users',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Lenda Com Foto',
        email: 'foto@x.com',
        password: 'changeme123',
        sectorId: sector.id,
        photoUrl: 'https://cdn.exemplo.com/fotos/lenda.jpg',
      },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().user.photoUrl).toBe('https://cdn.exemplo.com/fotos/lenda.jpg')
    const userId = created.json().user.id as string

    const trocada = await app.inject({
      method: 'PATCH', url: `/admin/users/${userId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { photoUrl: 'https://cdn.exemplo.com/fotos/outra.jpg' },
    })
    expect(trocada.json().user.photoUrl).toBe('https://cdn.exemplo.com/fotos/outra.jpg')

    const limpa = await app.inject({
      method: 'PATCH', url: `/admin/users/${userId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { photoUrl: null },
    })
    expect(limpa.json().user.photoUrl).toBeNull()
    await app.close()
  })

  // Só URL: a rota nunca recebe binário — o arquivo vai direto para o S3 pelo
  // presign, e um caminho solto aqui viraria `src` quebrado em toda tela.
  it('recusa photoUrl que não é URL', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const sector = await prisma.sector.create({ data: { name: 'Setor Foto Ruim', slug: 'setor-foto-ruim', enabledFeatures: [], roles: { create: [{ role: 'LEGEND' }] } } })

    const res = await app.inject({
      method: 'POST', url: '/admin/users',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Foto Ruim', email: 'fotoruim@x.com', password: 'changeme123', sectorId: sector.id, photoUrl: 'uploads/foto.jpg' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('persiste a data de nascimento na criação, na edição e ao limpar (POST/PATCH /admin/users)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const sector = await prisma.sector.create({ data: { name: 'Setor Nascimento', slug: 'setor-nascimento', enabledFeatures: [], roles: { create: [{ role: 'LEGEND' }] } } })

    const created = await app.inject({
      method: 'POST', url: '/admin/users',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Nova Lenda Nascimento', email: 'nascimento@x.com', password: 'changeme123', sectorId: sector.id, birthDate: '1990-05-20' },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().user.birthDate).toBe('1990-05-20')
    const userId = created.json().user.id as string

    const updated = await app.inject({
      method: 'PATCH', url: `/admin/users/${userId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { birthDate: '1991-08-03' },
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json().user.birthDate).toBe('1991-08-03')

    // String vazia (input date em branco) e null limpam o campo.
    const cleared = await app.inject({
      method: 'PATCH', url: `/admin/users/${userId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { birthDate: '' },
    })
    expect(cleared.statusCode).toBe(200)
    expect(cleared.json().user.birthDate).toBeNull()
    await app.close()
  })

  it('bloqueia Subadmin em GET /admin/administrators (403)', async () => {
    const app = buildApp()
    await app.ready()
    const sector = await prisma.sector.create({ data: { name: 'Setor Administradores', slug: 'setor-administradores', enabledFeatures: [], roles: { create: [{ role: 'LEGEND' }] } } })
    const token = await subadminToken(app, sector.id)
    const res = await app.inject({ method: 'GET', url: '/admin/administrators', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('Subadmin só vê/cria/edita lendas do próprio setor', async () => {
    const app = buildApp()
    await app.ready()
    const sectorA = await prisma.sector.create({ data: { name: 'Setor A Lendas', slug: 'setor-a-lendas', enabledFeatures: [], roles: { create: [{ role: 'LEGEND' }] } } })
    const sectorB = await prisma.sector.create({ data: { name: 'Setor B Lendas', slug: 'setor-b-lendas', enabledFeatures: [], roles: { create: [{ role: 'LEGEND' }] } } })
    const token = await subadminToken(app, sectorA.id)
    const userA = await prisma.user.create({ data: { name: 'Dev A', email: 'dev-a-lendas@x.com', passwordHash: 'x', sectorId: sectorA.id } })
    const userB = await prisma.user.create({ data: { name: 'Dev B', email: 'dev-b-lendas@x.com', passwordHash: 'x', sectorId: sectorB.id } })

    const list = await app.inject({ method: 'GET', url: '/admin/users', headers: { authorization: `Bearer ${token}` } })
    const names = list.json().users.map((u: { name: string }) => u.name)
    expect(names).toContain('Dev A')
    expect(names).not.toContain('Dev B')

    const created = await app.inject({
      method: 'POST', url: '/admin/users',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Novo Dev', email: 'novo-dev-lendas@x.com', password: 'changeme123', sectorId: sectorB.id },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().user.sectorId).toBe(sectorA.id) // ignora o sectorId do payload, força o próprio

    const editOther = await app.inject({
      method: 'PATCH', url: `/admin/users/${userB.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Tentativa' },
    })
    expect(editOther.statusCode).toBe(404)
    await app.close()
  })

  it('Subadmin não consegue criar ou promover para ADMIN/SUBADMIN', async () => {
    const app = buildApp()
    await app.ready()
    const sector = await prisma.sector.create({ data: { name: 'Setor Escalada', slug: 'setor-escalada', enabledFeatures: [], roles: { create: [{ role: 'LEGEND' }] } } })
    const token = await subadminToken(app, sector.id)

    const created = await app.inject({
      method: 'POST', url: '/admin/users',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'X', email: 'escalada@x.com', password: 'changeme123', role: 'ADMIN' },
    })
    expect(created.statusCode).toBe(400)

    const otherDev = await prisma.user.create({ data: { name: 'Dev C', email: 'dev-c-escalada@x.com', passwordHash: 'x', sectorId: sector.id } })
    const promoted = await app.inject({
      method: 'PATCH', url: `/admin/users/${otherDev.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { role: 'SUBADMIN' },
    })
    expect(promoted.statusCode).toBe(400)
    await app.close()
  })

  it('Admin cria um Subadmin escolhendo livremente o setor, mesmo sem o papel habilitado no setor (POST /admin/users)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const sector = await prisma.sector.create({ data: { name: 'Setor Subadmin Create', slug: 'setor-subadmin-create', enabledFeatures: [], roles: { create: [{ role: 'LEGEND' }] } } })
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Novo Subadmin', email: 'novo-subadmin@empresa.com', password: 'changeme123', role: 'SUBADMIN', sectorId: sector.id },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().user.role).toBe('SUBADMIN')
    expect(res.json().user.sectorId).toBe(sector.id)
    await app.close()
  })

  it('Admin promove um usuário existente a Subadmin (PATCH /admin/users/:id)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const user = await prisma.user.create({ data: { name: 'A Promover', email: 'promover-subadmin@empresa.com', passwordHash: 'x' } })
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${user.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { role: 'SUBADMIN' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().user.role).toBe('SUBADMIN')
    await app.close()
  })

  it('creates a developer (POST /admin/users)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Nova Dev', email: 'nova@empresa.com', password: 'changeme123', position: 'Backend', squad: 'Core', sectorId: 'sector-dev-produto' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().user.name).toBe('Nova Dev')
    expect(res.json().user.role).toBe('LEGEND')
    expect(res.json().user.position).toBe('Backend')
    await app.close()
  })

  it('usuário criado herda o companyId do ator (não cai em company-emr fixo)', async () => {
    const app = buildApp()
    await app.ready()
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Criar Usuario', slug: 'outra-empresa-criar-usuario-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa Criar Usuario', slug: 'setor-outra-empresa-criar-usuario-test', enabledFeatures: [], companyId: otherCompany.id, roles: { create: [{ role: 'LEGEND' }] } },
    })
    const token = await adminTokenForCompany(app, otherCompany.id, otherSector.id)
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Nova Dev Outra Empresa', email: 'nova-dev-outra-empresa@x.com', password: 'changeme123', sectorId: otherSector.id },
    })
    expect(res.statusCode).toBe(201)
    const created = await prisma.user.findUniqueOrThrow({ where: { id: res.json().user.id } })
    expect(created.companyId).toBe(otherCompany.id)
    await app.close()
  })

  it('rejeita sectorId de outra empresa em POST /admin/users (400, mensagem genérica)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Setor Invalido', slug: 'outra-empresa-setor-invalido-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor De Outra Empresa', slug: 'setor-de-outra-empresa-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Invasor', email: 'invasor-setor@x.com', password: 'changeme123', sectorId: otherSector.id },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toBe('Setor inválido.')
    await app.close()
  })

  it('ADMIN sem sectorId no body recebe 400 pedindo o setor (sem cair no default fixo da EMR)', async () => {
    const app = buildApp()
    await app.ready()
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Sem Setor', slug: 'outra-empresa-sem-setor-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa Sem Setor', slug: 'setor-outra-empresa-sem-setor-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const token = await adminTokenForCompany(app, otherCompany.id, otherSector.id)
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Sem Setor', email: 'sem-setor@x.com', password: 'changeme123' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toBe('Especifique o setor.')
    // e garante que NÃO criou o usuário no setor default da EMR por engano
    expect(await prisma.user.findUnique({ where: { email: 'sem-setor@x.com' } })).toBeNull()
    await app.close()
  })

  it('creates a developer with an explicit role (POST /admin/users)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Nova Head', email: 'head@empresa.com', password: 'changeme123', role: 'HEAD', sectorId: 'sector-dev-produto' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().user.role).toBe('HEAD')
    await app.close()
  })

  it('creates and edits a user area (POST/PATCH /admin/users)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const created = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Eng Dev', email: 'engdev@empresa.com', password: 'changeme123', area: 'ENGINEERING', sectorId: 'sector-dev-produto' },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().user.area).toBe('ENGINEERING')

    const id = created.json().user.id
    const moved = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { area: 'PRODUCT' },
    })
    expect(moved.statusCode).toBe(200)
    expect(moved.json().user.area).toBe('PRODUCT')

    const cleared = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { area: null },
    })
    expect(cleared.statusCode).toBe(200)
    expect(cleared.json().user.area).toBeNull()
    await app.close()
  })

  it('rejects a duplicate developer email (409)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const payload = { name: 'Dup', email: 'dup@empresa.com', password: 'changeme123', sectorId: 'sector-dev-produto' }
    await app.inject({ method: 'POST', url: '/admin/users', headers: { authorization: `Bearer ${token}` }, payload })
    const res = await app.inject({ method: 'POST', url: '/admin/users', headers: { authorization: `Bearer ${token}` }, payload })
    expect(res.statusCode).toBe(409)
    await app.close()
  })

  it('edits developer info (PATCH /admin/users/:id)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const user = await prisma.user.create({ data: { name: 'Antigo', email: 'edit@empresa.com', passwordHash: 'x' } })
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${user.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Novo Nome', position: 'Staff Eng', squad: 'Plataforma' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().user.name).toBe('Novo Nome')
    expect(res.json().user.position).toBe('Staff Eng')
    expect(res.json().user.squad).toBe('Plataforma')
    await app.close()
  })

  it('edits developer joinedAt to an earlier date (PATCH /admin/users/:id)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const user = await prisma.user.create({ data: { name: 'Veterano', email: 'vet@empresa.com', passwordHash: 'x' } })
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${user.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { joinedAt: '2019-03-15' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().user.joinedAt).toMatch(/^2019-03-15/)
    await app.close()
  })

  it('edits a user role (PATCH /admin/users/:id)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const user = await prisma.user.create({ data: { name: 'Promovido', email: 'promo@empresa.com', passwordHash: 'x' } })
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${user.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { role: 'HEAD' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().user.role).toBe('HEAD')
    await app.close()
  })

  it('rejects an admin removing their own admin role (400)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@empresa.com' } })
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${admin.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { role: 'LEGEND' },
    })
    expect(res.statusCode).toBe(400)
    const stillAdmin = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })
    expect(stillAdmin.role).toBe('ADMIN')
    await app.close()
  })

  it('toggles a user active flag (PATCH /admin/users/:id)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const user = await prisma.user.create({ data: { name: 'Alvo', email: 'alvo@empresa.com', passwordHash: 'x' } })
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${user.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { active: false },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().user.active).toBe(false)
    await app.close()
  })

  it('edits developer email (PATCH /admin/users/:id)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const user = await prisma.user.create({ data: { name: 'Troca', email: 'antigo@empresa.com', passwordHash: 'x' } })
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${user.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: 'novo@empresa.com' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().user.email).toBe('novo@empresa.com')
    await app.close()
  })

  it('rejects editing to an email already in use (409)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    await prisma.user.create({ data: { name: 'Existente', email: 'existe@empresa.com', passwordHash: 'x' } })
    const user = await prisma.user.create({ data: { name: 'Outro', email: 'outro@empresa.com', passwordHash: 'x' } })
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${user.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { email: 'existe@empresa.com' },
    })
    expect(res.statusCode).toBe(409)
    await app.close()
  })

  it('resets a developer password (PATCH /admin/users/:id)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const user = await prisma.user.create({ data: { name: 'Senha', email: 'senha@empresa.com', passwordHash: 'x' } })
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${user.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { password: 'novasenha123' },
    })
    expect(res.statusCode).toBe(200)
    // A senha em texto puro não pode vazar no retorno.
    expect(JSON.stringify(res.json())).not.toContain('novasenha123')
    // E o login com a nova senha deve funcionar.
    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'senha@empresa.com', password: 'novasenha123' } })
    expect(login.statusCode).toBe(200)
    await app.close()
  })

  it('rejects a password shorter than 8 chars (400)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const user = await prisma.user.create({ data: { name: 'Curta', email: 'curta@empresa.com', passwordHash: 'x' } })
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${user.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { password: 'curta' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('returns 404 toggling an unknown user', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const res = await app.inject({
      method: 'PATCH',
      url: '/admin/users/unknown',
      headers: { authorization: `Bearer ${token}` },
      payload: { active: false },
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('forbids a non-admin from listing users (403)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await devToken(app)
    const res = await app.inject({ method: 'GET', url: '/admin/users', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('lists recent votes for moderation (GET /admin/votes)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const voter = await prisma.user.create({ data: { name: 'V', email: 'v@empresa.com', passwordHash: 'x' } })
    const voted = await prisma.user.create({ data: { name: 'W', email: 'w@empresa.com', passwordHash: 'x' } })
    const cat = await prisma.recognitionCategory.create({ data: { name: 'Colaboração', slug: 'colaboracao' } })
    const period = await prisma.votingPeriod.create({ data: { monthRef: '2026-06', startsAt: new Date('2026-06-01'), endsAt: new Date('2026-06-30'), status: 'OPEN' } })
    await prisma.vote.create({ data: { voterId: voter.id, votedId: voted.id, periodId: period.id, justification: 'conteúdo qualquer', categories: { create: [{ categoryId: cat.id }] } } })
    const res = await app.inject({ method: 'GET', url: '/admin/votes', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json().votes).toHaveLength(1)
    expect(res.json().votes[0].voter.name).toBe('V')
    await app.close()
  })

  it('Subadmin só vê/remove votos do período do próprio setor', async () => {
    const app = buildApp()
    await app.ready()
    const sectorA = await prisma.sector.create({ data: { name: 'Setor A Voto', slug: 'setor-a-voto', enabledFeatures: [] } })
    const sectorB = await prisma.sector.create({ data: { name: 'Setor B Voto', slug: 'setor-b-voto', enabledFeatures: [] } })
    const token = await subadminToken(app, sectorA.id)
    const periodB = await prisma.votingPeriod.create({
      data: { sectorId: sectorB.id, monthRef: '2026-10', startsAt: new Date(Date.now() - 86400000), endsAt: new Date(Date.now() + 86400000), status: 'OPEN' },
    })
    const category = await prisma.recognitionCategory.create({ data: { name: 'Cat Voto Sub', slug: 'cat-voto-sub-test' } })
    const voterB = await prisma.user.create({ data: { name: 'Voter B', email: 'voterb-voto@x.com', passwordHash: 'x', sectorId: sectorB.id } })
    const votedB = await prisma.user.create({ data: { name: 'Voted B', email: 'votedb-voto@x.com', passwordHash: 'x', sectorId: sectorB.id } })
    const voteB = await prisma.vote.create({
      data: { voterId: voterB.id, votedId: votedB.id, periodId: periodB.id, justification: 'Justificativa válida aqui.', categories: { create: [{ categoryId: category.id }] } },
    })

    const list = await app.inject({ method: 'GET', url: '/admin/votes', headers: { authorization: `Bearer ${token}` } })
    expect(list.json().votes.map((v: { id: string }) => v.id)).not.toContain(voteB.id)

    const del = await app.inject({ method: 'DELETE', url: `/admin/votes/${voteB.id}`, headers: { authorization: `Bearer ${token}` } })
    expect(del.statusCode).toBe(404)
    await app.close()
  })

  it('creates a badge (POST /admin/badges, slug auto)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const res = await app.inject({
      method: 'POST',
      url: '/admin/badges',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Herói do Deploy', description: '10 deploys sem rollback', kind: 'IMPACT', iconKey: 'rocket', threshold: 10 },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().badge.slug).toBe('heroi-do-deploy')
    expect(res.json().badge.kind).toBe('IMPACT')
    await app.close()
  })

  it('creates a FEEDBACK badge (POST /admin/badges)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const res = await app.inject({
      method: 'POST',
      url: '/admin/badges',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Mentor de Feedback', description: '10 feedbacks feitos', kind: 'FEEDBACK', iconKey: 'chat', threshold: 10 },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().badge.kind).toBe('FEEDBACK')
    await app.close()
  })

  it('creates a TENURE badge (POST /admin/badges)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const res = await app.inject({
      method: 'POST',
      url: '/admin/badges',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: '5 anos de casa', description: '5 anos de equipe', kind: 'TENURE', iconKey: 'fe-crown', threshold: 5 },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().badge.kind).toBe('TENURE')
    await app.close()
  })

  it('edits a TENURE badge (PATCH /admin/badges/:id)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const badge = await prisma.badge.create({ data: { name: '1 ano de casa', slug: 'tempo-de-casa-1-ano', description: '1 ano', kind: 'TENURE', iconKey: 'fe-medal-bronze', threshold: 1 } })
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/badges/${badge.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { description: '1 ano completo de equipe', kind: 'TENURE', threshold: 1 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().badge.kind).toBe('TENURE')
    await app.close()
  })

  it('edits a badge (PATCH /admin/badges/:id)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const badge = await prisma.badge.create({ data: { name: 'X', slug: 'x', description: 'd', kind: 'IMPACT', iconKey: 'star', threshold: 5 } })
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/badges/${badge.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { threshold: 20, description: 'novo critério' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().badge.threshold).toBe(20)
    expect(res.json().badge.description).toBe('novo critério')
    await app.close()
  })

  it('lista todos os selos sem filtro de setor (GET /admin/badges)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const otherSector = await prisma.sector.create({ data: { name: 'Setor Selo Test', slug: 'setor-selo-test', enabledFeatures: [] } })
    await prisma.badge.create({ data: { name: 'Global Selo', slug: 'global-selo-admin-test', description: 'd', kind: 'IMPACT', iconKey: 'star', threshold: 1 } })
    await prisma.badge.create({
      data: { name: 'Selo Setor', slug: 'selo-setor-admin-test', description: 'd', kind: 'IMPACT', iconKey: 'star', threshold: 1, global: false, sectors: { create: [{ sectorId: otherSector.id }] } },
    })
    const res = await app.inject({ method: 'GET', url: '/admin/badges', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const names = res.json().badges.map((b: { name: string }) => b.name)
    expect(names).toContain('Global Selo')
    expect(names).toContain('Selo Setor')
    await app.close()
  })

  it('proíbe não-admin de listar selos do admin (403)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await devToken(app)
    const res = await app.inject({ method: 'GET', url: '/admin/badges', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('cria selo específico de setores e permite trocar depois', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const sector = await prisma.sector.create({ data: { name: 'Setor Selo Criar', slug: 'setor-selo-criar', enabledFeatures: [] } })
    const created = await app.inject({
      method: 'POST', url: '/admin/badges',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Selo Restrito Test', description: 'd', kind: 'IMPACT', iconKey: 'star', threshold: 1, global: false, sectorIds: [sector.id] },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().badge.global).toBe(false)
    expect(created.json().badge.sectorIds).toEqual([sector.id])

    const badgeId = created.json().badge.id
    const madeGlobal = await app.inject({
      method: 'PATCH', url: `/admin/badges/${badgeId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { global: true },
    })
    expect(madeGlobal.statusCode).toBe(200)
    expect(madeGlobal.json().badge.global).toBe(true)
    expect(madeGlobal.json().badge.sectorIds).toEqual([])
    await app.close()
  })

  it('Subadmin vê globais + específicos do próprio setor de Selos, cria sempre específico, e não edita item compartilhado', async () => {
    const app = buildApp()
    await app.ready()
    const sectorA = await prisma.sector.create({ data: { name: 'Setor A Selo', slug: 'setor-a-selo', enabledFeatures: [] } })
    const sectorB = await prisma.sector.create({ data: { name: 'Setor B Selo', slug: 'setor-b-selo', enabledFeatures: [] } })
    const token = await subadminToken(app, sectorA.id)
    await prisma.badge.create({ data: { name: 'Global Selo Sub', slug: 'global-selo-sub-test', description: 'd', kind: 'IMPACT', iconKey: 'star', threshold: 1 } })
    const soB = await prisma.badge.create({
      data: { name: 'Só B Selo', slug: 'so-b-selo-sub-test', description: 'd', kind: 'IMPACT', iconKey: 'star', threshold: 1, global: false, sectors: { create: [{ sectorId: sectorB.id }] } },
    })
    const shared = await prisma.badge.create({
      data: { name: 'Compartilhado Selo', slug: 'compartilhado-selo-sub-test', description: 'd', kind: 'IMPACT', iconKey: 'star', threshold: 1, global: false, sectors: { create: [{ sectorId: sectorA.id }, { sectorId: sectorB.id }] } },
    })

    const list = await app.inject({ method: 'GET', url: '/admin/badges', headers: { authorization: `Bearer ${token}` } })
    const names = list.json().badges.map((b: { name: string }) => b.name)
    expect(names).toContain('Global Selo Sub')
    expect(names).toContain('Compartilhado Selo')
    expect(names).not.toContain('Só B Selo')

    const created = await app.inject({
      method: 'POST', url: '/admin/badges',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Novo Selo Subadmin', description: 'd', kind: 'IMPACT', iconKey: 'star', threshold: 1, global: true },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().badge.global).toBe(false)
    expect(created.json().badge.sectorIds).toEqual([sectorA.id])

    const editShared = await app.inject({
      method: 'PATCH', url: `/admin/badges/${shared.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { description: 'Tentativa' },
    })
    expect(editShared.statusCode).toBe(403)

    // Item exclusivo de outro setor (B): o Subadmin (setor A) não o vê em
    // nenhuma listagem, então o PATCH deve devolver 404 (não 403), para não
    // vazar a existência do item via diferença de status code.
    const editOther = await app.inject({
      method: 'PATCH', url: `/admin/badges/${soB.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { description: 'Tentativa' },
    })
    expect(editOther.statusCode).toBe(404)
    await app.close()
  })

  it('deletes a badge and its awards (DELETE /admin/badges/:id)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const dev = await prisma.user.create({ data: { name: 'Dev', email: 'd@empresa.com', passwordHash: 'x' } })
    const badge = await prisma.badge.create({ data: { name: 'Y', slug: 'y', description: 'd', kind: 'IMPACT', iconKey: 'star', threshold: 1 } })
    await prisma.userBadge.create({ data: { userId: dev.id, badgeId: badge.id } })
    const del = await app.inject({ method: 'DELETE', url: `/admin/badges/${badge.id}`, headers: { authorization: `Bearer ${token}` } })
    expect(del.statusCode).toBe(204)
    expect(await prisma.userBadge.count({ where: { badgeId: badge.id } })).toBe(0)
    const again = await app.inject({ method: 'DELETE', url: `/admin/badges/${badge.id}`, headers: { authorization: `Bearer ${token}` } })
    expect(again.statusCode).toBe(404)
    await app.close()
  })

  async function makeMember(name: string, email: string) {
    return prisma.user.create({ data: { name, email, passwordHash: 'x', role: 'LEGEND' } })
  }
  async function makeBadge() {
    return prisma.badge.create({
      data: { slug: 'honra', name: 'Honra', description: 'manual', kind: 'IMPACT', iconKey: 'star', threshold: 0 },
    })
  }

  it('grants a badge to a member manually (201 with source MANUAL)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const member = await makeMember('Membro', 'membro@empresa.com')
    const badge = await makeBadge()
    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${member.id}/badges`,
      headers: { authorization: `Bearer ${token}` },
      payload: { badgeId: badge.id },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().badge.source).toBe('MANUAL')
    expect(res.json().badge.awardedBy.name).toBe('Admin')
    await app.close()
  })

  it('rejects granting the same badge twice (409)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const member = await makeMember('Membro', 'membro@empresa.com')
    const badge = await makeBadge()
    const grant = () =>
      app.inject({ method: 'POST', url: `/admin/users/${member.id}/badges`, headers: { authorization: `Bearer ${token}` }, payload: { badgeId: badge.id } })
    await grant()
    const res = await grant()
    expect(res.statusCode).toBe(409)
    await app.close()
  })

  it('returns 404 when granting an unknown badge', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const member = await makeMember('Membro', 'membro@empresa.com')
    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${member.id}/badges`,
      headers: { authorization: `Bearer ${token}` },
      payload: { badgeId: 'inexistente' },
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('rejeita conceder selo a usuário de outra empresa (404)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Badge Admin', slug: 'outra-empresa-badge-admin-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa Badge Admin', slug: 'setor-outra-empresa-badge-admin-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const outsider = await prisma.user.create({
      data: { name: 'ForaBadgeAdmin', email: 'fora-badge-admin@x.com', passwordHash: 'x', companyId: otherCompany.id, sectorId: otherSector.id },
    })
    const badge = await makeBadge()
    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${outsider.id}/badges`,
      headers: { authorization: `Bearer ${token}` },
      payload: { badgeId: badge.id },
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('lists the badges of a member', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const member = await makeMember('Membro', 'membro@empresa.com')
    const badge = await makeBadge()
    await app.inject({ method: 'POST', url: `/admin/users/${member.id}/badges`, headers: { authorization: `Bearer ${token}` }, payload: { badgeId: badge.id } })
    const res = await app.inject({ method: 'GET', url: `/admin/users/${member.id}/badges`, headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json().badges).toHaveLength(1)
    expect(res.json().badges[0].source).toBe('MANUAL')
    await app.close()
  })

  it('revokes a manual award (204)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const member = await makeMember('Membro', 'membro@empresa.com')
    const badge = await makeBadge()
    const granted = await app.inject({ method: 'POST', url: `/admin/users/${member.id}/badges`, headers: { authorization: `Bearer ${token}` }, payload: { badgeId: badge.id } })
    const userBadgeId = granted.json().badge.id
    const res = await app.inject({ method: 'DELETE', url: `/admin/users/${member.id}/badges/${userBadgeId}`, headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(204)
    await app.close()
  })

  it('refuses to revoke an automatic award (409)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const member = await makeMember('Membro', 'membro@empresa.com')
    const badge = await makeBadge()
    const auto = await prisma.userBadge.create({ data: { userId: member.id, badgeId: badge.id } })
    const res = await app.inject({ method: 'DELETE', url: `/admin/users/${member.id}/badges/${auto.id}`, headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(409)
    await app.close()
  })

  it('forbids a non-admin from granting a badge (403)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await devToken(app)
    const member = await makeMember('Membro', 'membro@empresa.com')
    const badge = await makeBadge()
    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${member.id}/badges`,
      headers: { authorization: `Bearer ${token}` },
      payload: { badgeId: badge.id },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('admin cria squad, adiciona membros com a regra DEV<=1, e desativa', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)

    const created = await app.inject({
      method: 'POST', url: '/admin/squads',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Inovação' },
    })
    expect(created.statusCode).toBe(201)
    const squadId = created.json().squad.id
    expect(created.json().squad.slug).toBe('inovacao')
    expect(created.json().squad.members).toEqual([])

    const dup = await app.inject({
      method: 'POST', url: '/admin/squads',
      headers: { authorization: `Bearer ${token}` }, payload: { name: 'Inovação' },
    })
    expect(dup.statusCode).toBe(409)

    const dev = await prisma.user.create({ data: { name: 'Dev1', email: 'dev1@x.com', passwordHash: 'x', role: 'LEGEND' } })
    const other = await app.inject({
      method: 'POST', url: '/admin/squads',
      headers: { authorization: `Bearer ${token}` }, payload: { name: 'B2B' },
    })
    const otherId = other.json().squad.id

    const add1 = await app.inject({
      method: 'POST', url: `/admin/squads/${squadId}/members`,
      headers: { authorization: `Bearer ${token}` }, payload: { userId: dev.id },
    })
    expect(add1.statusCode).toBe(201)
    expect(add1.json().squad.members.map((m: { id: string }) => m.id)).toContain(dev.id)

    // Sem limite de squads por integrante: o mesmo DEV pode entrar numa segunda squad.
    const add2 = await app.inject({
      method: 'POST', url: `/admin/squads/${otherId}/members`,
      headers: { authorization: `Bearer ${token}` }, payload: { userId: dev.id },
    })
    expect(add2.statusCode).toBe(201)
    expect(add2.json().squad.members.map((m: { id: string }) => m.id)).toContain(dev.id)

    const rm = await app.inject({
      method: 'DELETE', url: `/admin/squads/${squadId}/members/${dev.id}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(rm.statusCode).toBe(204)

    const off = await app.inject({
      method: 'PATCH', url: `/admin/squads/${squadId}`,
      headers: { authorization: `Bearer ${token}` }, payload: { active: false },
    })
    expect(off.statusCode).toBe(200)
    expect(off.json().squad.active).toBe(false)
    await app.close()
  })

  it('define e limpa o líder de uma squad', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await prisma.user.create({ data: { name: 'Adm', email: 'adm-leader@x.com', passwordHash: 'x', role: 'ADMIN' } })
    const lead = await prisma.user.create({ data: { name: 'Lia', email: 'lia-leader@x.com', passwordHash: 'x', role: 'LEAD' } })
    const token = app.jwt.sign({ sub: admin.id, role: 'ADMIN', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: [] })
    const squad = await prisma.squad.create({ data: { name: 'Squad X', slug: 'squad-x' } })

    const set = await app.inject({
      method: 'PATCH', url: `/admin/squads/${squad.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { leaderId: lead.id },
    })
    expect(set.statusCode).toBe(200)
    expect(set.json().squad.leaderId).toBe(lead.id)
    expect(set.json().squad.leader).toEqual({ id: lead.id, name: 'Lia' })

    const clear = await app.inject({
      method: 'PATCH', url: `/admin/squads/${squad.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { leaderId: null },
    })
    expect(clear.statusCode).toBe(200)
    expect(clear.json().squad.leaderId).toBeNull()
    expect(clear.json().squad.leader).toBeNull()
    await app.close()
  })

  it('rejeita líder inexistente', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await prisma.user.create({ data: { name: 'Adm2', email: 'adm2-leader@x.com', passwordHash: 'x', role: 'ADMIN' } })
    const token = app.jwt.sign({ sub: admin.id, role: 'ADMIN', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: [] })
    const squad = await prisma.squad.create({ data: { name: 'Squad Y', slug: 'squad-y' } })
    const res = await app.inject({
      method: 'PATCH', url: `/admin/squads/${squad.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { leaderId: 'nao-existe' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('rejeita leaderId de usuário INATIVO (400)', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await prisma.user.create({ data: { name: 'Adm3', email: 'adm3-leader@x.com', passwordHash: 'x', role: 'ADMIN' } })
    const token = app.jwt.sign({ sub: admin.id, role: 'ADMIN', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: [] })
    const squad = await prisma.squad.create({ data: { name: 'Squad Z', slug: 'squad-z' } })
    const inactiveUser = await prisma.user.create({ data: { name: 'Inativo', email: 'inativo-lead@x.com', passwordHash: 'x', role: 'LEGEND', active: false } })
    const res = await app.inject({
      method: 'PATCH', url: `/admin/squads/${squad.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { leaderId: inactiveUser.id },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('cria squad com setor default quando não informado, e permite trocar o setor', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const otherSector = await prisma.sector.create({
      data: { name: 'Comercial', slug: 'comercial-squad-test', enabledFeatures: [] },
    })

    const created = await app.inject({
      method: 'POST', url: '/admin/squads',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Squad Setor Default' },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().squad.sectorId).toBe('sector-dev-produto')

    const withSector = await app.inject({
      method: 'POST', url: '/admin/squads',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Squad Comercial', sectorId: otherSector.id },
    })
    expect(withSector.statusCode).toBe(201)
    expect(withSector.json().squad.sectorId).toBe(otherSector.id)

    const squadId = created.json().squad.id
    const moved = await app.inject({
      method: 'PATCH', url: `/admin/squads/${squadId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { sectorId: otherSector.id },
    })
    expect(moved.statusCode).toBe(200)
    expect(moved.json().squad.sectorId).toBe(otherSector.id)
    await app.close()
  })

  it('rejeita setor inexistente ao criar ou atualizar squad (400)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)

    const created = await app.inject({
      method: 'POST', url: '/admin/squads',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Squad Setor Inválido', sectorId: 'nao-existe' },
    })
    expect(created.statusCode).toBe(400)

    const ok = await app.inject({
      method: 'POST', url: '/admin/squads',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Squad OK' },
    })
    const squadId = ok.json().squad.id
    const updated = await app.inject({
      method: 'PATCH', url: `/admin/squads/${squadId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { sectorId: 'nao-existe' },
    })
    expect(updated.statusCode).toBe(400)
    await app.close()
  })

  it('Subadmin só vê/cria/edita squads do próprio setor', async () => {
    const app = buildApp()
    await app.ready()
    const sectorA = await prisma.sector.create({ data: { name: 'Setor A Squad', slug: 'setor-a-squad', enabledFeatures: [] } })
    const sectorB = await prisma.sector.create({ data: { name: 'Setor B Squad', slug: 'setor-b-squad', enabledFeatures: [] } })
    const token = await subadminToken(app, sectorA.id)
    const squadB = await prisma.squad.create({ data: { name: 'Squad B', slug: 'squad-b-scope', sectorId: sectorB.id } })

    const list = await app.inject({ method: 'GET', url: '/admin/squads', headers: { authorization: `Bearer ${token}` } })
    const names = list.json().squads.map((s: { name: string }) => s.name)
    expect(names).not.toContain('Squad B')

    const created = await app.inject({
      method: 'POST', url: '/admin/squads',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Squad Nova Subadmin', sectorId: sectorB.id },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().squad.sectorId).toBe(sectorA.id) // ignora sectorId do payload

    const editOther = await app.inject({
      method: 'PATCH', url: `/admin/squads/${squadB.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Tentativa' },
    })
    expect(editOther.statusCode).toBe(404)
    await app.close()
  })

  it('proíbe não-admin de criar squad (403)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await devToken(app)
    const res = await app.inject({
      method: 'POST', url: '/admin/squads',
      headers: { authorization: `Bearer ${token}` }, payload: { name: 'X' },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('admin cria e edita teamsWebhookUrl e ele aparece no DTO admin', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)

    const created = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Karina',
        email: 'karina@empresa.com',
        password: 'senha1234',
        teamsWebhookUrl: 'https://flow.example/karina',
        sectorId: 'sector-dev-produto',
      },
    })
    expect(created.statusCode).toBe(201)
    expect(created.json().user.teamsWebhookUrl).toBe('https://flow.example/karina')

    const id = created.json().user.id
    const patched = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { teamsWebhookUrl: '' },
    })
    expect(patched.statusCode).toBe(200)
    expect(patched.json().user.teamsWebhookUrl).toBeNull()

    await app.close()
  })

  it('creates a STREAK badge as admin', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const res = await app.inject({
      method: 'POST',
      url: '/admin/badges',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: 'Em chamas',
        description: 'Recorde de ofensiva de 7 dias úteis',
        kind: 'STREAK',
        iconKey: 'fe-fire',
        threshold: 7,
      },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().badge.kind).toBe('STREAK')
    await app.close()
  })

  it('desliga um colaborador setando leftAt e o readmite limpando', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const created = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Ex Lenda', email: 'ex@empresa.com', password: 'changeme123', sectorId: 'sector-dev-produto' },
    })
    const id = created.json().user.id as string
    const squad = await prisma.squad.create({ data: { name: 'Squad Ex', slug: 'squad-ex', leaderId: id } })
    await prisma.squadMember.create({ data: { squadId: squad.id, userId: id } })

    const off = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { active: false, leftAt: '2026-07-10T00:00:00.000Z' },
    })
    expect(off.statusCode).toBe(200)
    expect(off.json().user.active).toBe(false)
    expect(off.json().user.leftAt).toBe('2026-07-10T00:00:00.000Z')
    expect(await prisma.squadMember.count({ where: { userId: id } })).toBe(0)
    expect((await prisma.squad.findUnique({ where: { id: squad.id } }))?.leaderId).toBeNull()

    const back = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { active: true, leftAt: null },
    })
    expect(back.statusCode).toBe(200)
    expect(back.json().user.active).toBe(true)
    expect(back.json().user.leftAt).toBeNull()
    await app.close()
  })

  it('GET /admin/calendar-settings devolve estado não configurado e o redirect URI', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const res = await app.inject({
      method: 'GET',
      url: '/admin/calendar-settings',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.google).toMatchObject({ configured: false, clientId: null })
    expect(body.google.redirectUri).toContain('/api/calendar/callback/google')
    expect(body.microsoft.redirectUri).toContain('/api/calendar/callback/microsoft')
    await app.close()
  })

  it('PUT /admin/calendar-settings grava credenciais e nunca devolve o secret', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/calendar-settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { google: { clientId: 'cid', clientSecret: 'csecret' } },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().google).toMatchObject({ configured: true, clientId: 'cid' })
    expect(JSON.stringify(res.json())).not.toContain('csecret')
    await app.close()
  })

  it('PUT /admin/calendar-settings sem o secret mantém o que já estava', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const headers = { authorization: `Bearer ${token}` }
    await app.inject({
      method: 'PUT',
      url: '/admin/calendar-settings',
      headers,
      payload: { google: { clientId: 'cid', clientSecret: 'csecret' } },
    })
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/calendar-settings',
      headers,
      payload: { google: { clientId: 'cid-2' } },
    })
    expect(res.json().google).toMatchObject({ configured: true, clientId: 'cid-2' })
    await app.close()
  })

  it('PUT /admin/calendar-settings rejeita payload inválido com 400', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/calendar-settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { google: { clientId: 123 } },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('/admin/calendar-settings é restrito a admin', async () => {
    const app = buildApp()
    await app.ready()
    const token = await devToken(app)
    const res = await app.inject({
      method: 'GET',
      url: '/admin/calendar-settings',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})

describe('terceirizados em /admin/users', () => {
  it('exclui THIRD_PARTY de /admin/users, lista em /admin/third-party-users e valida enabledFeatures', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await prisma.user.create({
      data: { name: 'Admin', email: `admin-${Date.now()}@x.com`, passwordHash: 'x', role: 'ADMIN' },
    })
    const adminToken = app.jwt.sign({ sub: admin.id, role: 'ADMIN', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: [] })
    const thirdParty = await prisma.user.create({
      data: {
        name: 'Terceirizado',
        email: `terceirizado-${Date.now()}@x.com`,
        passwordHash: 'x',
        role: 'THIRD_PARTY',
        enabledFeatures: ['escritorio'],
      },
    })

    const collaborators = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(collaborators.json().users.some((u: { id: string }) => u.id === thirdParty.id)).toBe(false)

    const thirdPartyUsers = await app.inject({
      method: 'GET',
      url: '/admin/third-party-users',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(thirdPartyUsers.statusCode).toBe(200)
    expect(thirdPartyUsers.json().users.map((u: { id: string }) => u.id)).toEqual([thirdParty.id])

    const updated = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${thirdParty.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { enabledFeatures: ['escritorio', 'lendas'] },
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json().user.enabledFeatures).toEqual(['escritorio', 'lendas'])

    const deactivated = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${thirdParty.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { active: false },
    })
    expect(deactivated.statusCode).toBe(200)
    expect(deactivated.json().user.active).toBe(false)

    const stillListed = await app.inject({
      method: 'GET',
      url: '/admin/third-party-users',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(stillListed.json().users.map((u: { id: string }) => u.id)).toContain(thirdParty.id)

    const reactivated = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${thirdParty.id}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { active: true },
    })
    expect(reactivated.json().user.active).toBe(true)

    await app.close()
  })

  it('GET /admin/third-party-users não lista terceirizado de outra empresa', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await prisma.user.create({
      data: { name: 'Admin', email: `admin-tp-scope-${Date.now()}@x.com`, passwordHash: 'x', role: 'ADMIN' },
    })
    const adminToken = app.jwt.sign({ sub: admin.id, role: 'ADMIN', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: [] })

    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa TP Users', slug: 'outra-empresa-tp-users-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa TP Users', slug: 'setor-outra-empresa-tp-users-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const otherThirdParty = await prisma.user.create({
      data: { name: 'Terceirizado Outra Empresa', email: 'terceirizado-outra-empresa-tp@x.com', passwordHash: 'x', role: 'THIRD_PARTY', sectorId: otherSector.id, companyId: otherCompany.id },
    })

    const res = await app.inject({ method: 'GET', url: '/admin/third-party-users', headers: { authorization: `Bearer ${adminToken}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json().users.map((u: { id: string }) => u.id)).not.toContain(otherThirdParty.id)
    await app.close()
  })
})

describe('setores (/admin/sectors)', () => {
  it('lista o setor default criado pela migration', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const res = await app.inject({ method: 'GET', url: '/admin/sectors', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const sectors = res.json().sectors as Array<{ id: string; name: string; roles: string[] }>
    expect(sectors.some((s) => s.id === 'sector-dev-produto' && s.roles.length === 7)).toBe(true)
    await app.close()
  })

  it('cria um setor novo, forçando escritório habilitado, e rejeita nome duplicado (POST)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const res = await app.inject({
      method: 'POST',
      url: '/admin/sectors',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Comercial', enabledFeatures: ['votar'], roles: ['LEGEND', 'LEAD'] },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().sector.enabledFeatures.sort()).toEqual(['escritorio', 'votar'])
    expect(res.json().sector.roles.sort()).toEqual(['LEAD', 'LEGEND'])

    const dup = await app.inject({
      method: 'POST',
      url: '/admin/sectors',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Comercial', enabledFeatures: [], roles: [] },
    })
    expect(dup.statusCode).toBe(409)
    await app.close()
  })

  it('edita nome, active, features e roles de um setor (PATCH)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const created = await app.inject({
      method: 'POST',
      url: '/admin/sectors',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'RH', enabledFeatures: [], roles: ['LEGEND'] },
    })
    const id = created.json().sector.id
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/sectors/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Gente e Cultura', active: false, roles: ['LEGEND', 'HEAD'] },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().sector.name).toBe('Gente e Cultura')
    expect(res.json().sector.active).toBe(false)
    expect(res.json().sector.roles.sort()).toEqual(['HEAD', 'LEGEND'])
    await app.close()
  })

  it('forbids non-admin from managing sectors (403)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await devToken(app)
    const res = await app.inject({ method: 'GET', url: '/admin/sectors', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('permite Subadmin listar todos os setores (GET, referência de leitura, não gestão)', async () => {
    const app = buildApp()
    await app.ready()
    const sectorA = await prisma.sector.create({ data: { name: 'Setor A List', slug: 'setor-a-list', enabledFeatures: [] } })
    const sectorB = await prisma.sector.create({ data: { name: 'Setor B List', slug: 'setor-b-list', enabledFeatures: [] } })
    const token = await subadminToken(app, sectorA.id)
    const res = await app.inject({ method: 'GET', url: '/admin/sectors', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const ids = (res.json().sectors as Array<{ id: string }>).map((s) => s.id)
    expect(ids).toContain('sector-dev-produto')
    expect(ids).toContain(sectorA.id)
    expect(ids).toContain(sectorB.id)
    await app.close()
  })

  it('mantém POST/PATCH de setores restritos ao Admin mesmo com GET liberado ao Subadmin (403)', async () => {
    const app = buildApp()
    await app.ready()
    const sectorA = await prisma.sector.create({ data: { name: 'Setor A Sec', slug: 'setor-a-sec', enabledFeatures: [] } })
    const token = await subadminToken(app, sectorA.id)
    const post = await app.inject({
      method: 'POST',
      url: '/admin/sectors',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Não Deveria', enabledFeatures: [], roles: [] },
    })
    expect(post.statusCode).toBe(403)
    const patch = await app.inject({
      method: 'PATCH',
      url: `/admin/sectors/${sectorA.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Não Deveria' },
    })
    expect(patch.statusCode).toBe(403)
    await app.close()
  })
})

describe('sectorId em /admin/users', () => {
  it('rejeita POST /admin/users sem sectorId (400) e aceita com sectorId explícito', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const noSector = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Sem Setor', email: 'semsetor@empresa.com', password: 'changeme123' },
    })
    expect(noSector.statusCode).toBe(400)
    expect(noSector.json().message).toBe('Especifique o setor.')

    const sectorRes = await app.inject({
      method: 'POST',
      url: '/admin/sectors',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Comercial', enabledFeatures: [], roles: ['LEGEND'] },
    })
    const sectorId = sectorRes.json().sector.id

    const withSector = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Com Setor', email: 'comsetor@empresa.com', password: 'changeme123', sectorId },
    })
    expect(withSector.statusCode).toBe(201)
    expect(withSector.json().user.sectorId).toBe(sectorId)
    await app.close()
  })

  it('rejeita papel não habilitado no setor selecionado (400)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const sectorRes = await app.inject({
      method: 'POST',
      url: '/admin/sectors',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Financeiro', enabledFeatures: [], roles: ['LEGEND'] },
    })
    const sectorId = sectorRes.json().sector.id
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Head Indevido', email: 'head-indevido@empresa.com', password: 'changeme123', sectorId, role: 'HEAD' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('move usuário de setor via PATCH e revalida o papel no setor novo', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const created = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Movida', email: 'movida@empresa.com', password: 'changeme123', role: 'HEAD', sectorId: 'sector-dev-produto' },
    })
    const id = created.json().user.id
    const sectorRes = await app.inject({
      method: 'POST',
      url: '/admin/sectors',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Suporte', enabledFeatures: [], roles: ['LEGEND'] },
    })
    const sectorId = sectorRes.json().sector.id
    const rejected = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { sectorId },
    })
    expect(rejected.statusCode).toBe(400)

    const accepted = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { sectorId, role: 'LEGEND' },
    })
    expect(accepted.statusCode).toBe(200)
    expect(accepted.json().user.sectorId).toBe(sectorId)
    await app.close()
  })
})

describe('GET /admin/audit-log', () => {
  it('lista, filtra por entityType/actorId e pagina', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    await app.inject({ method: 'POST', url: '/admin/categories', headers: { authorization: `Bearer ${token}` }, payload: { name: 'Auditoria A' } })
    await app.inject({ method: 'POST', url: '/admin/categories', headers: { authorization: `Bearer ${token}` }, payload: { name: 'Auditoria B' } })

    const res = await app.inject({ method: 'GET', url: '/admin/audit-log?entityType=RecognitionCategory&page=1&pageSize=1', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { entries: Array<{ entityType: string; action: string }>; total: number; page: number; pageSize: number }
    expect(body.entries).toHaveLength(1)
    expect(body.total).toBeGreaterThanOrEqual(2)
    expect(body.entries[0].entityType).toBe('RecognitionCategory')
    expect(body.entries[0].action).toBe('CREATE')
    await app.close()
  })

  it('forbids non-admin (403)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await devToken(app)
    const res = await app.inject({ method: 'GET', url: '/admin/audit-log', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})

describe('GET /admin/audit-log/actors', () => {
  it('lista só os autores distintos que já aparecem no log (inclui admins, exclui quem nunca atuou)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    await app.inject({ method: 'POST', url: '/admin/categories', headers: { authorization: `Bearer ${token}` }, payload: { name: 'Autores A' } })

    const res = await app.inject({ method: 'GET', url: '/admin/audit-log/actors', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { actors: Array<{ id: string; name: string }> }
    expect(body.actors).toHaveLength(1)
    expect(body.actors[0].name).toBe('Admin')

    // /admin/users, por outro lado, exclui admins — não serve pra popular esse filtro.
    const usersRes = await app.inject({ method: 'GET', url: '/admin/users', headers: { authorization: `Bearer ${token}` } })
    const usersBody = usersRes.json() as { users: Array<{ name: string }> }
    expect(usersBody.users.find((u) => u.name === 'Admin')).toBeUndefined()
    await app.close()
  })

  it('forbids non-admin (403)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await devToken(app)
    const res = await app.inject({ method: 'GET', url: '/admin/audit-log/actors', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})

describe('auditoria — categorias, quinta-dev, escritório', () => {
  it('audita criação e edição de categoria', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const created = await app.inject({ method: 'POST', url: '/admin/categories', headers: { authorization: `Bearer ${token}` }, payload: { name: 'Foco no cliente' } })
    const id = created.json().category.id

    await app.inject({ method: 'PATCH', url: `/admin/categories/${id}`, headers: { authorization: `Bearer ${token}` }, payload: { active: false } })

    const rows = await prisma.adminAuditLog.findMany({ where: { entityType: 'RecognitionCategory', entityId: id }, orderBy: { createdAt: 'asc' } })
    expect(rows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE'])
    expect(rows[1].before).toMatchObject({ active: true })
    expect((rows[1].after as { active: boolean }).active).toBe(false)
    await app.close()
  })

  it('audita config de quinta-dev e do escritório', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    await app.inject({ method: 'PATCH', url: '/admin/development-thursday/settings', headers: { authorization: `Bearer ${token}` }, payload: { teamsWebhookUrl: 'https://example.com/hook' } })
    await app.inject({ method: 'PATCH', url: '/admin/office-settings', headers: { authorization: `Bearer ${token}` }, payload: { broadcastEnabled: true } })

    expect(await prisma.adminAuditLog.count({ where: { entityType: 'AppSetting' } })).toBe(1)
    expect(await prisma.adminAuditLog.count({ where: { entityType: 'OfficeSetting' } })).toBe(1)
    await app.close()
  })

  it('audita criação e edição de usuário', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const created = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Auditada', email: 'auditada@empresa.com', password: 'changeme123', sectorId: 'sector-dev-produto' },
    })
    const id = created.json().user.id
    await app.inject({ method: 'PATCH', url: `/admin/users/${id}`, headers: { authorization: `Bearer ${token}` }, payload: { position: 'PM' } })

    const rows = await prisma.adminAuditLog.findMany({ where: { entityType: 'User', entityId: id }, orderBy: { createdAt: 'asc' } })
    expect(rows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE'])
    expect((rows[0].after as { passwordHash?: string }).passwordHash).toBeUndefined()
    expect((rows[1].before as { passwordHash?: string }).passwordHash).toBeUndefined()
    expect((rows[1].after as { passwordHash?: string }).passwordHash).toBeUndefined()
    await app.close()
  })
})

describe('auditoria — votos e selos', () => {
  it('audita exclusão de voto', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const voter = await prisma.user.create({ data: { name: 'Votante Audit', email: 'votanteaudit@empresa.com', passwordHash: 'x' } })
    const voted = await prisma.user.create({ data: { name: 'Votada Audit', email: 'votadaaudit@empresa.com', passwordHash: 'x' } })
    const cat = await prisma.recognitionCategory.create({ data: { name: 'Colaboração Audit', slug: 'colaboracao-audit' } })
    const period = await prisma.votingPeriod.create({ data: { monthRef: '2027-04', startsAt: new Date('2027-04-01'), endsAt: new Date('2027-04-30'), status: 'OPEN' } })
    const vote = await prisma.vote.create({ data: { voterId: voter.id, votedId: voted.id, periodId: period.id, justification: 'justificativa válida', categories: { create: [{ categoryId: cat.id }] } } })

    await app.inject({ method: 'DELETE', url: `/admin/votes/${vote.id}`, headers: { authorization: `Bearer ${token}` } })

    const row = await prisma.adminAuditLog.findFirstOrThrow({ where: { entityType: 'Vote', entityId: vote.id } })
    expect(row.action).toBe('DELETE')
    await app.close()
  })

  it('audita create/update/delete de selo e concessão/revogação manual', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const created = await app.inject({ method: 'POST', url: '/admin/badges', headers: { authorization: `Bearer ${token}` }, payload: { name: 'Selo Audit', description: 'd', kind: 'IMPACT', iconKey: 'star' } })
    const badgeId = created.json().badge.id
    await app.inject({ method: 'PATCH', url: `/admin/badges/${badgeId}`, headers: { authorization: `Bearer ${token}` }, payload: { description: 'd2' } })

    const target = await prisma.user.create({ data: { name: 'Alvo Selo', email: 'alvoselo@empresa.com', passwordHash: 'x' } })
    const granted = await app.inject({ method: 'POST', url: `/admin/users/${target.id}/badges`, headers: { authorization: `Bearer ${token}` }, payload: { badgeId } })
    const userBadgeId = granted.json().badge.id
    await app.inject({ method: 'DELETE', url: `/admin/users/${target.id}/badges/${userBadgeId}`, headers: { authorization: `Bearer ${token}` } })
    await app.inject({ method: 'DELETE', url: `/admin/badges/${badgeId}`, headers: { authorization: `Bearer ${token}` } })

    const badgeRows = await prisma.adminAuditLog.findMany({ where: { entityType: 'Badge', entityId: badgeId }, orderBy: { createdAt: 'asc' } })
    expect(badgeRows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE', 'DELETE'])
    const userBadgeRows = await prisma.adminAuditLog.findMany({ where: { entityType: 'UserBadge', entityId: userBadgeId }, orderBy: { createdAt: 'asc' } })
    expect(userBadgeRows.map((r) => r.action)).toEqual(['CREATE', 'DELETE'])
    await app.close()
  })

  it('audita edição e exclusão definitiva de sala de retro pelo admin', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@empresa.com' } })
    const squad = await createSquad({ name: 'Squad Retro Audit', sectorId: DEFAULT_SECTOR_ID }, admin.id, DEFAULT_COMPANY_ID)
    const room = await prisma.retroRoom.create({
      data: { sprint: 1, votesPerParticipant: 3, createdById: admin.id, squads: { create: [{ squadId: squad.id }] } },
    })

    await app.inject({ method: 'PATCH', url: `/admin/retro/rooms/${room.id}`, headers: { authorization: `Bearer ${token}` }, payload: { votesPerParticipant: 5 } })
    await app.inject({ method: 'DELETE', url: `/admin/retro/rooms/${room.id}`, headers: { authorization: `Bearer ${token}` } })

    const rows = await prisma.adminAuditLog.findMany({ where: { entityType: 'RetroRoom', entityId: room.id }, orderBy: { createdAt: 'asc' } })
    expect(rows.map((r) => r.action)).toEqual(['UPDATE', 'DELETE'])
    await app.close()
  })

  it('GET /admin/dashboard retorna um card por setor', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const res = await app.inject({ method: 'GET', url: '/admin/dashboard', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    const body = res.json() as { sectors: Array<{ sectorId: string; sectorName: string }> }
    expect(body.sectors.some((s) => s.sectorId === 'sector-dev-produto')).toBe(true)
    await app.close()
  })

  it('Subadmin vê só o card do próprio setor no Dashboard', async () => {
    const app = buildApp()
    await app.ready()
    const sectorA = await prisma.sector.create({ data: { name: 'Setor A Dash', slug: 'setor-a-dash', enabledFeatures: [] } })
    await prisma.sector.create({ data: { name: 'Setor B Dash', slug: 'setor-b-dash', enabledFeatures: [] } })
    const token = await subadminToken(app, sectorA.id)
    const res = await app.inject({ method: 'GET', url: '/admin/dashboard', headers: { authorization: `Bearer ${token}` } })
    expect(res.json().sectors).toHaveLength(1)
    expect(res.json().sectors[0].sectorId).toBe(sectorA.id)
    await app.close()
  })
})

describe('escopo por empresa (companyId real do token)', () => {
  it('ADMIN de uma empresa não vê nem edita setor de outra empresa', async () => {
    const app = buildApp()
    await app.ready()

    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Admin Test', slug: 'outra-empresa-admin-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa Admin', slug: 'setor-outra-empresa-admin-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const tokenOther = await adminTokenForCompany(app, otherCompany.id, otherSector.id)
    const tokenDefault = await adminToken(app)

    const createRes = await app.inject({
      method: 'POST',
      url: '/admin/sectors',
      headers: { authorization: `Bearer ${tokenDefault}` },
      payload: { name: 'Setor Padrão Isolamento', enabledFeatures: [], roles: [] },
    })
    expect(createRes.statusCode).toBe(201)
    const createdSectorId = createRes.json().sector.id

    const listRes = await app.inject({ method: 'GET', url: '/admin/sectors', headers: { authorization: `Bearer ${tokenOther}` } })
    expect(listRes.json().sectors.some((s: { id: string }) => s.id === createdSectorId)).toBe(false)

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/admin/sectors/${createdSectorId}`,
      headers: { authorization: `Bearer ${tokenOther}` },
      payload: { name: 'Invasão' },
    })
    expect(patchRes.statusCode).toBe(404)

    await app.close()
  })

  it('ADMIN de uma empresa não edita/adiciona/remove membro de squad de outra empresa', async () => {
    const app = buildApp()
    await app.ready()

    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Squad Admin', slug: 'outra-empresa-squad-admin-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa Squad Admin', slug: 'setor-outra-empresa-squad-admin-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const otherSquad = await prisma.squad.create({ data: { name: 'Squad Outra Empresa Admin', slug: 'squad-outra-empresa-admin-test', sectorId: otherSector.id, companyId: otherCompany.id } })
    const otherDev = await prisma.user.create({ data: { name: 'Dev Outra Empresa Squad', email: 'dev-outra-empresa-squad@x.com', passwordHash: 'x', sectorId: otherSector.id, companyId: otherCompany.id } })
    const tokenDefault = await adminToken(app)

    const patch = await app.inject({
      method: 'PATCH',
      url: `/admin/squads/${otherSquad.id}`,
      headers: { authorization: `Bearer ${tokenDefault}` },
      payload: { name: 'Invasão Squad' },
    })
    expect(patch.statusCode).toBe(404)

    const addMemberRes = await app.inject({
      method: 'POST',
      url: `/admin/squads/${otherSquad.id}/members`,
      headers: { authorization: `Bearer ${tokenDefault}` },
      payload: { userId: otherDev.id },
    })
    expect(addMemberRes.statusCode).toBe(404)

    const removeMemberRes = await app.inject({
      method: 'DELETE',
      url: `/admin/squads/${otherSquad.id}/members/${otherDev.id}`,
      headers: { authorization: `Bearer ${tokenDefault}` },
    })
    expect(removeMemberRes.statusCode).toBe(204) // no-op silencioso, igual ao comportamento pré-existente para membro/squad não encontrado

    await app.close()
  })

  it('ADMIN de uma empresa não edita/fecha/gera destaque de período de outra empresa', async () => {
    const app = buildApp()
    await app.ready()

    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Periodo Admin', slug: 'outra-empresa-periodo-admin-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa Periodo Admin', slug: 'setor-outra-empresa-periodo-admin-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const otherPeriod = await prisma.votingPeriod.create({
      data: { monthRef: '2026-11', startsAt: new Date(Date.now() + 86400000), endsAt: new Date(Date.now() + 2 * 86400000), status: 'OPEN', sectorId: otherSector.id, companyId: otherCompany.id },
    })
    const tokenDefault = await adminToken(app)

    const patch = await app.inject({
      method: 'PATCH',
      url: `/admin/periods/${otherPeriod.id}`,
      headers: { authorization: `Bearer ${tokenDefault}` },
      payload: { startsAt: new Date(Date.now() + 86400000).toISOString(), endsAt: new Date(Date.now() + 3 * 86400000).toISOString() },
    })
    expect(patch.statusCode).toBe(404)

    const close = await app.inject({ method: 'POST', url: `/admin/periods/${otherPeriod.id}/close`, headers: { authorization: `Bearer ${tokenDefault}` } })
    expect(close.statusCode).toBe(404)

    const draft = await app.inject({ method: 'POST', url: `/admin/periods/${otherPeriod.id}/highlight`, headers: { authorization: `Bearer ${tokenDefault}` } })
    expect(draft.statusCode).toBe(404)

    const getHighlight = await app.inject({ method: 'GET', url: `/admin/periods/${otherPeriod.id}/highlight`, headers: { authorization: `Bearer ${tokenDefault}` } })
    expect(getHighlight.statusCode).toBe(404)

    await app.close()
  })

  it('ADMIN de uma empresa não vê nem apaga voto de outra empresa (DELETE /admin/votes/:id)', async () => {
    const app = buildApp()
    await app.ready()

    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Voto Admin', slug: 'outra-empresa-voto-admin-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa Voto Admin', slug: 'setor-outra-empresa-voto-admin-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const otherVoter = await prisma.user.create({ data: { name: 'Voter Outra Empresa Voto', email: 'voter-outra-empresa-voto@x.com', passwordHash: 'x', companyId: otherCompany.id, sectorId: otherSector.id } })
    const otherVoted = await prisma.user.create({ data: { name: 'Voted Outra Empresa Voto', email: 'voted-outra-empresa-voto@x.com', passwordHash: 'x', companyId: otherCompany.id, sectorId: otherSector.id } })
    const otherPeriod = await prisma.votingPeriod.create({
      data: { monthRef: '2026-12', startsAt: new Date('2026-12-01'), endsAt: new Date('2026-12-31'), status: 'OPEN', sectorId: otherSector.id, companyId: otherCompany.id },
    })
    const otherVote = await prisma.vote.create({
      data: { voterId: otherVoter.id, votedId: otherVoted.id, periodId: otherPeriod.id, justification: 'justificativa válida', companyId: otherCompany.id },
    })
    const tokenDefault = await adminToken(app)

    const list = await app.inject({ method: 'GET', url: '/admin/votes', headers: { authorization: `Bearer ${tokenDefault}` } })
    expect(list.json().votes.map((v: { id: string }) => v.id)).not.toContain(otherVote.id)

    const del = await app.inject({ method: 'DELETE', url: `/admin/votes/${otherVote.id}`, headers: { authorization: `Bearer ${tokenDefault}` } })
    expect(del.statusCode).toBe(404)

    await app.close()
  })

  it('ADMIN de uma empresa não revoga selo manual de usuário de outra empresa', async () => {
    const app = buildApp()
    await app.ready()

    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Revoke Selo Rota', slug: 'outra-empresa-revoke-selo-rota-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa Revoke Selo Rota', slug: 'setor-outra-empresa-revoke-selo-rota-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const otherMember = await prisma.user.create({ data: { name: 'Membro Outra Rota', email: 'membro-outra-revoke-rota@x.com', passwordHash: 'x', companyId: otherCompany.id, sectorId: otherSector.id } })
    const otherAdmin = await prisma.user.create({ data: { name: 'Admin Outra Rota', email: 'admin-outra-revoke-rota@x.com', passwordHash: 'x', role: 'ADMIN', companyId: otherCompany.id, sectorId: otherSector.id } })
    const badge = await prisma.badge.create({
      data: { slug: 'honra-rota-outra-empresa', name: 'Honra Rota Outra Empresa', description: 'manual', kind: 'IMPACT', iconKey: 'star', threshold: 0 },
    })
    const awarded = await prisma.userBadge.create({ data: { userId: otherMember.id, badgeId: badge.id, source: 'MANUAL', awardedById: otherAdmin.id } })
    const tokenDefault = await adminToken(app)

    const res = await app.inject({
      method: 'DELETE',
      url: `/admin/users/${otherMember.id}/badges/${awarded.id}`,
      headers: { authorization: `Bearer ${tokenDefault}` },
    })
    expect(res.statusCode).toBe(404)

    await app.close()
  })

  it('define o líder direto de um colaborador', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const chefe = await prisma.user.create({ data: { name: 'Chefe', email: 'chefe-manager@x.com', passwordHash: 'x', role: 'MANAGER' } })
    const liderado = await prisma.user.create({ data: { name: 'Liderado', email: 'liderado-manager@x.com', passwordHash: 'x' } })

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${liderado.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { managerId: chefe.id },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().user.managerId).toBe(chefe.id)

    const limpa = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${liderado.id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { managerId: null },
    })
    expect(limpa.statusCode).toBe(200)
    expect(limpa.json().user.managerId).toBeNull()

    await app.close()
  })

  it('recusa líder direto inválido: si mesmo, ciclo, inativo ou de outra empresa', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const topo = await prisma.user.create({ data: { name: 'Topo', email: 'topo-manager@x.com', passwordHash: 'x', role: 'HEAD' } })
    const meio = await prisma.user.create({ data: { name: 'Meio', email: 'meio-manager@x.com', passwordHash: 'x', role: 'LEAD', managerId: topo.id } })
    const base = await prisma.user.create({ data: { name: 'Base', email: 'base-manager@x.com', passwordHash: 'x', managerId: meio.id } })
    const desligado = await prisma.user.create({ data: { name: 'Desligado', email: 'desligado-manager@x.com', passwordHash: 'x', active: false } })

    const otherCompany = await prisma.company.create({ data: { name: 'Outra Manager', slug: 'outra-manager-test' } })
    const otherSector = await prisma.sector.create({ data: { name: 'Setor Outro', slug: 'setor-outro-manager-test', companyId: otherCompany.id } })
    const externo = await prisma.user.create({
      data: { name: 'Externo', email: 'externo-manager@x.com', passwordHash: 'x', companyId: otherCompany.id, sectorId: otherSector.id },
    })

    async function patchManager(userId: string, managerId: string) {
      return app.inject({
        method: 'PATCH',
        url: `/admin/users/${userId}`,
        headers: { authorization: `Bearer ${token}` },
        payload: { managerId },
      })
    }

    const proprio = await patchManager(meio.id, meio.id)
    expect(proprio.statusCode).toBe(400)
    expect(proprio.json().message).toContain('próprio líder')

    // Topo passar a responder à Base fecharia o laço Topo → Meio → Base → Topo.
    const ciclo = await patchManager(topo.id, base.id)
    expect(ciclo.statusCode).toBe(400)
    expect(ciclo.json().message).toContain('ciclo')

    const inativo = await patchManager(base.id, desligado.id)
    expect(inativo.statusCode).toBe(400)

    const outraEmpresa = await patchManager(base.id, externo.id)
    expect(outraEmpresa.statusCode).toBe(400)

    // Nada disso pode ter sido gravado.
    const recarregado = await prisma.user.findUnique({ where: { id: base.id } })
    expect(recarregado?.managerId).toBe(meio.id)

    await app.close()
  })
})


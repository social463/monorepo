import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import { RECOGNITION_CATEGORY_SEED, XP_RULE_SEED } from '@legends/shared'

async function superAdminToken(app: ReturnType<typeof buildApp>) {
  const email = 'super-admin-test@legends.internal'
  await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Super', email, password: 'changeme123' } })
  await prisma.user.update({ where: { email }, data: { role: 'SUPER_ADMIN' } })
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'changeme123' } })
  return res.json().accessToken as string
}

async function adminToken(app: ReturnType<typeof buildApp>) {
  const email = 'admin-super-test@empresa.com'
  await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Admin', email, password: 'changeme123' } })
  await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } })
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'changeme123' } })
  return res.json().accessToken as string
}

describe('super-admin routes', () => {
  it('cria empresa + primeiro admin atomicamente, e o admin consegue logar isolado', async () => {
    const app = buildApp()
    await app.ready()
    const token = await superAdminToken(app)

    const createRes = await app.inject({
      method: 'POST',
      url: '/super-admin/companies',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Empresa Nova Ltda', admin: { name: 'Admin Nova', email: 'admin@empresanova.com', password: 'changeme123' } },
    })
    expect(createRes.statusCode).toBe(201)
    const body = createRes.json()
    expect(body.company.slug).toBe('empresa-nova-ltda')
    expect(body.admin.role).toBe('ADMIN')

    const loginRes = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'admin@empresanova.com', password: 'changeme123' } })
    expect(loginRes.statusCode).toBe(200)

    const created = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@empresanova.com' } })
    expect(created.companyId).toBe(body.company.id)
    const sector = await prisma.sector.findUniqueOrThrow({ where: { id: created.sectorId } })
    expect(sector.companyId).toBe(body.company.id)
    expect(sector.name).toBe('Geral')
    // Empresa nova nasce com o Calendário habilitado — sem isso, os cards de
    // aniversário da Home apontam para uma rota que o FeatureGate bloqueia.
    expect(sector.enabledFeatures).toEqual(expect.arrayContaining(['escritorio', 'calendario']))
    // … e com o catálogo de competências do Mural: sem nenhuma categoria o envio
    // de reconhecimento não fecha, porque a validação exige ao menos uma.
    const competencias = await prisma.recognitionCategory.findMany({ where: { companyId: body.company.id } })
    expect(competencias).toHaveLength(RECOGNITION_CATEGORY_SEED.length)
    expect(competencias.map((c) => c.name)).toEqual(expect.arrayContaining([...RECOGNITION_CATEGORY_SEED]))
    // … e com as regras de pontos: sem nenhuma, `awardXp` devolve NO_RULE e a
    // empresa nasce sem gamificação sem ter escolhido isso.
    const regras = await prisma.xpRule.findMany({ where: { companyId: body.company.id } })
    expect(regras).toHaveLength(XP_RULE_SEED.length)
    expect(regras.find((r) => r.event === 'CORPORATE_POST_READ_FULL')?.amount).toBe(3)

    await app.close()
  })

  it('rejeita nome de empresa duplicado (409)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await superAdminToken(app)
    const basePayload = { name: 'Empresa Duplicada', admin: { name: 'A', email: 'a@dup.com', password: 'changeme123' } }
    await app.inject({ method: 'POST', url: '/super-admin/companies', headers: { authorization: `Bearer ${token}` }, payload: basePayload })
    const res2 = await app.inject({
      method: 'POST',
      url: '/super-admin/companies',
      headers: { authorization: `Bearer ${token}` },
      payload: { ...basePayload, admin: { ...basePayload.admin, email: 'b@dup.com' } },
    })
    expect(res2.statusCode).toBe(409)
    await app.close()
  })

  it('GET /super-admin/companies lista todas as empresas', async () => {
    const app = buildApp()
    await app.ready()
    const token = await superAdminToken(app)
    const res = await app.inject({ method: 'GET', url: '/super-admin/companies', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json().companies.length).toBeGreaterThanOrEqual(1)
    await app.close()
  })

  it('rejeita ADMIN comum (403) e requisição sem token (401)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await adminToken(app)
    const res = await app.inject({ method: 'GET', url: '/super-admin/companies', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(403)
    const noAuthRes = await app.inject({ method: 'GET', url: '/super-admin/companies' })
    expect(noAuthRes.statusCode).toBe(401)
    await app.close()
  })

  it('PATCH renomeia a empresa e recalcula o slug', async () => {
    const app = buildApp()
    await app.ready()
    const token = await superAdminToken(app)
    const created = await app.inject({
      method: 'POST', url: '/super-admin/companies',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Empresa Original', admin: { name: 'A', email: 'a@original.com', password: 'changeme123' } },
    })
    const companyId = created.json().company.id as string

    const res = await app.inject({
      method: 'PATCH', url: `/super-admin/companies/${companyId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Empresa Renomeada' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().company.name).toBe('Empresa Renomeada')
    expect(res.json().company.slug).toBe('empresa-renomeada')
    await app.close()
  })

  it('PATCH ativa/desativa a empresa', async () => {
    const app = buildApp()
    await app.ready()
    const token = await superAdminToken(app)
    const created = await app.inject({
      method: 'POST', url: '/super-admin/companies',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Empresa Toggle', admin: { name: 'A', email: 'a@toggle.com', password: 'changeme123' } },
    })
    const companyId = created.json().company.id as string

    const off = await app.inject({
      method: 'PATCH', url: `/super-admin/companies/${companyId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { active: false },
    })
    expect(off.statusCode).toBe(200)
    expect(off.json().company.active).toBe(false)

    const on = await app.inject({
      method: 'PATCH', url: `/super-admin/companies/${companyId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { active: true },
    })
    expect(on.json().company.active).toBe(true)
    await app.close()
  })

  it('PATCH em empresa inexistente devolve 404', async () => {
    const app = buildApp()
    await app.ready()
    const token = await superAdminToken(app)
    const res = await app.inject({
      method: 'PATCH', url: '/super-admin/companies/nao-existe',
      headers: { authorization: `Bearer ${token}` },
      payload: { active: false },
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('PATCH rejeita nome colidindo com slug de outra empresa (409)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await superAdminToken(app)
    await app.inject({
      method: 'POST', url: '/super-admin/companies',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Empresa Alvo', admin: { name: 'A', email: 'a@alvo.com', password: 'changeme123' } },
    })
    const other = await app.inject({
      method: 'POST', url: '/super-admin/companies',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Empresa Outra', admin: { name: 'B', email: 'b@outra.com', password: 'changeme123' } },
    })
    const otherId = other.json().company.id as string

    const res = await app.inject({
      method: 'PATCH', url: `/super-admin/companies/${otherId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Empresa Alvo' },
    })
    expect(res.statusCode).toBe(409)
    await app.close()
  })

  it('PATCH rejeita corpo vazio (400) e ADMIN comum (403)', async () => {
    const app = buildApp()
    await app.ready()
    const superToken = await superAdminToken(app)
    const created = await app.inject({
      method: 'POST', url: '/super-admin/companies',
      headers: { authorization: `Bearer ${superToken}` },
      payload: { name: 'Empresa Guard', admin: { name: 'A', email: 'a@guard.com', password: 'changeme123' } },
    })
    const companyId = created.json().company.id as string

    const emptyBody = await app.inject({
      method: 'PATCH', url: `/super-admin/companies/${companyId}`,
      headers: { authorization: `Bearer ${superToken}` },
      payload: {},
    })
    expect(emptyBody.statusCode).toBe(400)

    const adminTk = await adminToken(app)
    const forbidden = await app.inject({
      method: 'PATCH', url: `/super-admin/companies/${companyId}`,
      headers: { authorization: `Bearer ${adminTk}` },
      payload: { active: false },
    })
    expect(forbidden.statusCode).toBe(403)
    await app.close()
  })

  it('GET /companies/:id/dashboard retorna totalUsers e sectorBreakdown (inclui setor sem usuários)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await superAdminToken(app)
    const created = await app.inject({
      method: 'POST', url: '/super-admin/companies',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Empresa Dashboard', admin: { name: 'A', email: 'a@dashboard.com', password: 'changeme123' } },
    })
    const companyId = created.json().company.id as string
    const sectorId = (await prisma.user.findUniqueOrThrow({ where: { email: 'a@dashboard.com' } })).sectorId

    // Setor extra sem nenhum usuário — precisa aparecer com userCount: 0
    await prisma.sector.create({ data: { name: 'Vazio', slug: `vazio-${companyId}`, companyId } })

    // Usuário inativo (offboarded) no mesmo setor — não deve contar em totalUsers/userCount
    await prisma.user.create({
      data: { name: 'Ex-Colaborador', email: 'ex-colaborador@dashboard.com', passwordHash: 'x', sectorId, companyId, active: false },
    })

    const res = await app.inject({
      method: 'GET', url: `/super-admin/companies/${companyId}/dashboard`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.company.id).toBe(companyId)
    expect(body.totalUsers).toBe(1)
    expect(body.sectorBreakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sectorId, sectorName: 'Geral', userCount: 1 }),
        expect.objectContaining({ sectorName: 'Vazio', userCount: 0 }),
      ]),
    )
    await app.close()
  })

  it('GET /companies/:id/dashboard devolve 404 pra empresa inexistente', async () => {
    const app = buildApp()
    await app.ready()
    const token = await superAdminToken(app)
    const res = await app.inject({
      method: 'GET', url: '/super-admin/companies/nao-existe/dashboard',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('GET /companies/:id/admins lista os admins, inclusive os inativos', async () => {
    const app = buildApp()
    await app.ready()
    const token = await superAdminToken(app)
    const created = await app.inject({
      method: 'POST', url: '/super-admin/companies',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Empresa Lista Admins', admin: { name: 'Ana', email: 'ana@lista.com', password: 'changeme123' } },
    })
    const companyId = created.json().company.id as string
    const sectorId = (await prisma.user.findUniqueOrThrow({ where: { email: 'ana@lista.com' } })).sectorId
    await prisma.user.create({
      data: { name: 'Bruno', email: 'bruno@lista.com', passwordHash: 'x', role: 'ADMIN', sectorId, companyId, active: false },
    })
    // Colaborador comum da mesma empresa não é admin — não pode aparecer.
    await prisma.user.create({
      data: { name: 'Carla', email: 'carla@lista.com', passwordHash: 'x', sectorId, companyId },
    })

    const res = await app.inject({
      method: 'GET', url: `/super-admin/companies/${companyId}/admins`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const admins = res.json().admins as { name: string; email: string; active: boolean }[]
    expect(admins.map((a) => a.name)).toEqual(['Ana', 'Bruno'])
    expect(admins.find((a) => a.name === 'Bruno')?.active).toBe(false)
    await app.close()
  })

  it('POST /companies/:id/admins cria admin que loga na empresa certa', async () => {
    const app = buildApp()
    await app.ready()
    const token = await superAdminToken(app)
    const created = await app.inject({
      method: 'POST', url: '/super-admin/companies',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Empresa Add Admin', admin: { name: 'Ana', email: 'ana@add.com', password: 'changeme123' } },
    })
    const companyId = created.json().company.id as string

    const res = await app.inject({
      method: 'POST', url: `/super-admin/companies/${companyId}/admins`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Bruno', email: 'bruno@add.com', password: 'changeme123' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().admin.email).toBe('bruno@add.com')

    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'bruno@add.com', password: 'changeme123' } })
    expect(login.statusCode).toBe(200)
    const novo = await prisma.user.findUniqueOrThrow({ where: { email: 'bruno@add.com' } })
    expect(novo.role).toBe('ADMIN')
    expect(novo.companyId).toBe(companyId)
    const sector = await prisma.sector.findUniqueOrThrow({ where: { id: novo.sectorId } })
    expect(sector.companyId).toBe(companyId)
    await app.close()
  })

  it('POST /companies/:id/admins rejeita e-mail já usado (409) e empresa inexistente (404)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await superAdminToken(app)
    const created = await app.inject({
      method: 'POST', url: '/super-admin/companies',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Empresa Dup Admin', admin: { name: 'Ana', email: 'ana@dupadmin.com', password: 'changeme123' } },
    })
    const companyId = created.json().company.id as string

    const dup = await app.inject({
      method: 'POST', url: `/super-admin/companies/${companyId}/admins`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Outra Ana', email: 'ana@dupadmin.com', password: 'changeme123' },
    })
    expect(dup.statusCode).toBe(409)

    const semEmpresa = await app.inject({
      method: 'POST', url: '/super-admin/companies/nao-existe/admins',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Bruno', email: 'bruno@dupadmin.com', password: 'changeme123' },
    })
    expect(semEmpresa.statusCode).toBe(404)
    await app.close()
  })

  it('PATCH /companies/:id/admins/:userId edita nome e e-mail', async () => {
    const app = buildApp()
    await app.ready()
    const token = await superAdminToken(app)
    const created = await app.inject({
      method: 'POST', url: '/super-admin/companies',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Empresa Edita Admin', admin: { name: 'Ana', email: 'ana@edita.com', password: 'changeme123' } },
    })
    const companyId = created.json().company.id as string
    const adminId = (await prisma.user.findUniqueOrThrow({ where: { email: 'ana@edita.com' } })).id

    const res = await app.inject({
      method: 'PATCH', url: `/super-admin/companies/${companyId}/admins/${adminId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Ana Maria', email: 'ana.maria@edita.com' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().admin).toMatchObject({ name: 'Ana Maria', email: 'ana.maria@edita.com', active: true })
    await app.close()
  })

  it('PATCH redefine a senha e derruba as sessões abertas', async () => {
    const app = buildApp()
    await app.ready()
    const token = await superAdminToken(app)
    const created = await app.inject({
      method: 'POST', url: '/super-admin/companies',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Empresa Senha Admin', admin: { name: 'Ana', email: 'ana@senha.com', password: 'changeme123' } },
    })
    const companyId = created.json().company.id as string
    const adminId = (await prisma.user.findUniqueOrThrow({ where: { email: 'ana@senha.com' } })).id
    await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'ana@senha.com', password: 'changeme123' } })
    expect(await prisma.refreshToken.count({ where: { userId: adminId, revokedAt: null } })).toBeGreaterThan(0)

    const res = await app.inject({
      method: 'PATCH', url: `/super-admin/companies/${companyId}/admins/${adminId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { password: 'novasenha123' },
    })
    expect(res.statusCode).toBe(200)

    const antiga = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'ana@senha.com', password: 'changeme123' } })
    expect(antiga.statusCode).toBe(401)
    const nova = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'ana@senha.com', password: 'novasenha123' } })
    expect(nova.statusCode).toBe(200)
    await app.close()
  })

  it('DELETE desativa o admin, derruba a sessão e bloqueia o login', async () => {
    const app = buildApp()
    await app.ready()
    const token = await superAdminToken(app)
    const created = await app.inject({
      method: 'POST', url: '/super-admin/companies',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Empresa Remove Admin', admin: { name: 'Ana', email: 'ana@remove.com', password: 'changeme123' } },
    })
    const companyId = created.json().company.id as string
    await app.inject({
      method: 'POST', url: `/super-admin/companies/${companyId}/admins`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Bruno', email: 'bruno@remove.com', password: 'changeme123' },
    })
    const brunoId = (await prisma.user.findUniqueOrThrow({ where: { email: 'bruno@remove.com' } })).id
    await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'bruno@remove.com', password: 'changeme123' } })

    const res = await app.inject({
      method: 'DELETE', url: `/super-admin/companies/${companyId}/admins/${brunoId}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(204)
    // Desativa em vez de apagar: a linha continua lá, com o histórico junto.
    expect((await prisma.user.findUniqueOrThrow({ where: { id: brunoId } })).active).toBe(false)
    expect(await prisma.refreshToken.count({ where: { userId: brunoId, revokedAt: null } })).toBe(0)

    const login = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'bruno@remove.com', password: 'changeme123' } })
    expect(login.statusCode).toBe(401)

    // E dá pra desfazer.
    const volta = await app.inject({
      method: 'PATCH', url: `/super-admin/companies/${companyId}/admins/${brunoId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { active: true },
    })
    expect(volta.statusCode).toBe(200)
    expect(volta.json().admin.active).toBe(true)
    await app.close()
  })

  it('não deixa a empresa ficar sem nenhum admin ativo (409 no DELETE e no PATCH)', async () => {
    const app = buildApp()
    await app.ready()
    const token = await superAdminToken(app)
    const created = await app.inject({
      method: 'POST', url: '/super-admin/companies',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Empresa Ultimo Admin', admin: { name: 'Ana', email: 'ana@ultimo.com', password: 'changeme123' } },
    })
    const companyId = created.json().company.id as string
    const adminId = (await prisma.user.findUniqueOrThrow({ where: { email: 'ana@ultimo.com' } })).id

    const del = await app.inject({
      method: 'DELETE', url: `/super-admin/companies/${companyId}/admins/${adminId}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(del.statusCode).toBe(409)

    const patch = await app.inject({
      method: 'PATCH', url: `/super-admin/companies/${companyId}/admins/${adminId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { active: false },
    })
    expect(patch.statusCode).toBe(409)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: adminId } })).active).toBe(true)
    await app.close()
  })

  it('404 para usuário de outra empresa ou que não é ADMIN', async () => {
    const app = buildApp()
    await app.ready()
    const token = await superAdminToken(app)
    const alvo = await app.inject({
      method: 'POST', url: '/super-admin/companies',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Empresa Alvo Admin', admin: { name: 'Ana', email: 'ana@alvoadmin.com', password: 'changeme123' } },
    })
    const alvoId = alvo.json().company.id as string
    const outra = await app.inject({
      method: 'POST', url: '/super-admin/companies',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Empresa Vizinha Admin', admin: { name: 'Bruno', email: 'bruno@vizinha.com', password: 'changeme123' } },
    })
    const vizinhaId = outra.json().company.id as string
    const brunoId = (await prisma.user.findUniqueOrThrow({ where: { email: 'bruno@vizinha.com' } })).id
    const sectorId = (await prisma.user.findUniqueOrThrow({ where: { email: 'ana@alvoadmin.com' } })).sectorId
    const comum = await prisma.user.create({
      data: { name: 'Carla', email: 'carla@alvoadmin.com', passwordHash: 'x', sectorId, companyId: alvoId },
    })

    const cruzada = await app.inject({
      method: 'PATCH', url: `/super-admin/companies/${alvoId}/admins/${brunoId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Invasor' },
    })
    expect(cruzada.statusCode).toBe(404)
    expect((await prisma.user.findUniqueOrThrow({ where: { id: brunoId } })).name).toBe('Bruno')
    expect(vizinhaId).not.toBe(alvoId)

    const naoAdmin = await app.inject({
      method: 'DELETE', url: `/super-admin/companies/${alvoId}/admins/${comum.id}`,
      headers: { authorization: `Bearer ${token}` },
    })
    expect(naoAdmin.statusCode).toBe(404)
    await app.close()
  })

  it('rotas de admins rejeitam ADMIN comum (403)', async () => {
    const app = buildApp()
    await app.ready()
    const superToken = await superAdminToken(app)
    const created = await app.inject({
      method: 'POST', url: '/super-admin/companies',
      headers: { authorization: `Bearer ${superToken}` },
      payload: { name: 'Empresa Guard Admins', admin: { name: 'Ana', email: 'ana@guardadmins.com', password: 'changeme123' } },
    })
    const companyId = created.json().company.id as string
    const adminId = (await prisma.user.findUniqueOrThrow({ where: { email: 'ana@guardadmins.com' } })).id
    const adminTk = await adminToken(app)

    const lista = await app.inject({
      method: 'GET', url: `/super-admin/companies/${companyId}/admins`,
      headers: { authorization: `Bearer ${adminTk}` },
    })
    expect(lista.statusCode).toBe(403)

    const cria = await app.inject({
      method: 'POST', url: `/super-admin/companies/${companyId}/admins`,
      headers: { authorization: `Bearer ${adminTk}` },
      payload: { name: 'X', email: 'x@guardadmins.com', password: 'changeme123' },
    })
    expect(cria.statusCode).toBe(403)

    const remove = await app.inject({
      method: 'DELETE', url: `/super-admin/companies/${companyId}/admins/${adminId}`,
      headers: { authorization: `Bearer ${adminTk}` },
    })
    expect(remove.statusCode).toBe(403)
    await app.close()
  })

  it('GET /companies/:id/dashboard rejeita ADMIN comum (403)', async () => {
    const app = buildApp()
    await app.ready()
    const superToken = await superAdminToken(app)
    const created = await app.inject({
      method: 'POST', url: '/super-admin/companies',
      headers: { authorization: `Bearer ${superToken}` },
      payload: { name: 'Empresa Guard Dashboard', admin: { name: 'A', email: 'a@guarddash.com', password: 'changeme123' } },
    })
    const companyId = created.json().company.id as string
    const adminTk = await adminToken(app)
    const res = await app.inject({
      method: 'GET', url: `/super-admin/companies/${companyId}/dashboard`,
      headers: { authorization: `Bearer ${adminTk}` },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})

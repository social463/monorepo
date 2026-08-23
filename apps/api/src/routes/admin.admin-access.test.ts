import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

/**
 * Acesso administrativo delegado: o painel de admin aberto para uma conta
 * específica, sem mexer na `role` dela.
 *
 * Spec: `docs/superpowers/specs/2026-08-15-acesso-admin-delegado-design.md`
 */

async function registerUser(app: ReturnType<typeof buildApp>, name: string, email: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name, email, password: 'changeme123' },
  })
  return res.json().user.id as string
}

async function login(app: ReturnType<typeof buildApp>, email: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email, password: 'changeme123' },
  })
  return res.json().accessToken as string
}

async function adminToken(app: ReturnType<typeof buildApp>) {
  await registerUser(app, 'Admin', 'admin@empresa.com')
  await prisma.user.update({ where: { email: 'admin@empresa.com' }, data: { role: 'ADMIN' } })
  return login(app, 'admin@empresa.com')
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` })

describe('acesso administrativo delegado', () => {
  it('abre as rotas de admin sem trocar o papel da pessoa', async () => {
    const app = buildApp()
    const admin = await adminToken(app)
    const legendId = await registerUser(app, 'Ana Lenda', 'ana@empresa.com')

    // Sem o acesso, a rota de admin é fechada.
    const antes = await login(app, 'ana@empresa.com')
    expect((await app.inject({ method: 'GET', url: '/admin/users', headers: auth(antes) })).statusCode).toBe(403)

    const grant = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${legendId}`,
      headers: auth(admin),
      payload: { adminAccess: true },
    })
    expect(grant.statusCode).toBe(200)
    expect(grant.json().user.adminAccess).toBe(true)
    // O papel não se mexeu: é o ponto todo do mecanismo.
    expect(grant.json().user.role).toBe('LEGEND')

    // O claim entra no token no próximo login (ou refresh).
    const depois = await login(app, 'ana@empresa.com')
    expect((await app.inject({ method: 'GET', url: '/admin/users', headers: auth(depois) })).statusCode).toBe(200)
    // Inclusive nas rotas de ADMIN pleno, onde o SUBADMIN não entra.
    expect((await app.inject({ method: 'GET', url: '/admin/audit-log', headers: auth(depois) })).statusCode).toBe(200)
  })

  it('revogar fecha o painel de novo', async () => {
    const app = buildApp()
    const admin = await adminToken(app)
    const legendId = await registerUser(app, 'Ana Lenda', 'ana@empresa.com')
    await app.inject({ method: 'PATCH', url: `/admin/users/${legendId}`, headers: auth(admin), payload: { adminAccess: true } })

    await app.inject({ method: 'PATCH', url: `/admin/users/${legendId}`, headers: auth(admin), payload: { adminAccess: false } })
    const token = await login(app, 'ana@empresa.com')
    expect((await app.inject({ method: 'GET', url: '/admin/users', headers: auth(token) })).statusCode).toBe(403)
  })

  it('token antigo, sem o claim, não vira admin', async () => {
    const app = buildApp()
    const admin = await adminToken(app)
    const legendId = await registerUser(app, 'Ana Lenda', 'ana@empresa.com')
    // Token emitido ANTES da concessão — é o que sobrevive por até 15 minutos.
    const antigo = await login(app, 'ana@empresa.com')

    await app.inject({ method: 'PATCH', url: `/admin/users/${legendId}`, headers: auth(admin), payload: { adminAccess: true } })

    expect((await app.inject({ method: 'GET', url: '/admin/users', headers: auth(antigo) })).statusCode).toBe(403)
  })

  it('o delegado não passa o poder adiante — nem pelo switch, nem promovendo', async () => {
    const app = buildApp()
    const admin = await adminToken(app)
    const anaId = await registerUser(app, 'Ana Lenda', 'ana@empresa.com')
    const brunoId = await registerUser(app, 'Bruno Lenda', 'bruno@empresa.com')
    await app.inject({ method: 'PATCH', url: `/admin/users/${anaId}`, headers: auth(admin), payload: { adminAccess: true } })
    const ana = await login(app, 'ana@empresa.com')

    const switchOutro = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${brunoId}`,
      headers: auth(ana),
      payload: { adminAccess: true },
    })
    expect(switchOutro.statusCode).toBe(403)

    // A porta dos fundos: promover a ADMIN daria o mesmo poder por outro caminho.
    const promover = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${brunoId}`,
      headers: auth(ana),
      payload: { role: 'ADMIN' },
    })
    expect(promover.statusCode).toBe(403)

    const autopromover = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${anaId}`,
      headers: auth(ana),
      payload: { role: 'ADMIN' },
    })
    expect(autopromover.statusCode).toBe(403)

    const criar = await app.inject({
      method: 'POST',
      url: '/admin/users',
      headers: auth(ana),
      payload: { name: 'Novo Admin', email: 'novo@empresa.com', password: 'changeme123', role: 'ADMIN', sectorId: 'sector-dev-produto' },
    })
    expect(criar.statusCode).toBe(403)
  })

  it('subadmin também não concede', async () => {
    const app = buildApp()
    await adminToken(app)
    const legendId = await registerUser(app, 'Ana Lenda', 'ana@empresa.com')
    await registerUser(app, 'Sub', 'sub@empresa.com')
    await prisma.user.update({ where: { email: 'sub@empresa.com' }, data: { role: 'SUBADMIN' } })
    const sub = await login(app, 'sub@empresa.com')

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${legendId}`,
      headers: auth(sub),
      payload: { adminAccess: true },
    })
    expect(res.statusCode).toBe(403)
  })

  it('recusa a concessão sobre papel não elegível', async () => {
    const app = buildApp()
    const admin = await adminToken(app)
    const id = await registerUser(app, 'Terceiro', 'terceiro@empresa.com')
    await prisma.user.update({ where: { id }, data: { role: 'THIRD_PARTY' } })

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${id}`,
      headers: auth(admin),
      payload: { adminAccess: true },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toMatch(/Lenda, Líder, Gerente ou Head/)
  })

  it('mudar para papel não elegível derruba o acesso junto', async () => {
    const app = buildApp()
    const admin = await adminToken(app)
    const id = await registerUser(app, 'Ana Lenda', 'ana@empresa.com')
    await app.inject({ method: 'PATCH', url: `/admin/users/${id}`, headers: auth(admin), payload: { adminAccess: true } })

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/users/${id}`,
      headers: auth(admin),
      payload: { role: 'THIRD_PARTY' },
    })
    expect(res.statusCode).toBe(200)
    // Flag pendurado numa conta que não pode mais recebê-lo é privilégio
    // invisível esperando a próxima promoção.
    expect(res.json().user.adminAccess).toBe(false)
  })

  it('a lista de administradores mostra as contas de gestão e os delegados', async () => {
    const app = buildApp()
    const admin = await adminToken(app)
    const anaId = await registerUser(app, 'Ana Lenda', 'ana@empresa.com')
    await registerUser(app, 'Bruno Lenda', 'bruno@empresa.com')
    await app.inject({ method: 'PATCH', url: `/admin/users/${anaId}`, headers: auth(admin), payload: { adminAccess: true } })

    const res = await app.inject({ method: 'GET', url: '/admin/administrators', headers: auth(admin) })
    expect(res.statusCode).toBe(200)
    const emails = (res.json().users as { email: string }[]).map((u) => u.email)
    expect(emails).toContain('admin@empresa.com')
    expect(emails).toContain('ana@empresa.com')
    expect(emails).not.toContain('bruno@empresa.com')
  })

  it('o delegado continua na lista de colaboradores', async () => {
    const app = buildApp()
    const admin = await adminToken(app)
    const anaId = await registerUser(app, 'Ana Lenda', 'ana@empresa.com')
    await app.inject({ method: 'PATCH', url: `/admin/users/${anaId}`, headers: auth(admin), payload: { adminAccess: true } })

    const res = await app.inject({ method: 'GET', url: '/admin/users', headers: auth(admin) })
    const emails = (res.json().users as { email: string }[]).map((u) => u.email)
    expect(emails).toContain('ana@empresa.com')
  })
})

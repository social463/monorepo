import { describe, it, expect } from 'vitest'
import { buildApp } from './app'
import { prisma } from './lib/prisma'

describe('health route', () => {
  it('returns ok status', async () => {
    const app = buildApp()
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
    await app.close()
  })
})

describe('requireFeature', () => {
  it('requireFeature libera SUBADMIN mesmo sem a feature na lista', async () => {
    const app = buildApp()
    await app.ready()
    const sub = await prisma.user.create({ data: { name: 'Sub', email: 'sub-feature@x.com', passwordHash: 'x', role: 'SUBADMIN' } })
    const token = app.jwt.sign({ sub: sub.id, role: 'SUBADMIN', sectorId: 'sector-dev-produto', companyId: 'company-emr', features: [] })
    const res = await app.inject({ method: 'GET', url: '/badges', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).not.toBe(403)
    await app.close()
  })
})

/**
 * Acesso administrativo delegado nos guardas.
 * Spec: `docs/superpowers/specs/2026-08-15-acesso-admin-delegado-design.md`
 */
describe('guardas e o acesso administrativo delegado', () => {
  async function delegatedToken(app: ReturnType<typeof buildApp>, email: string, features: string[] = []) {
    const user = await prisma.user.create({
      data: { name: 'Delegada', email, passwordHash: 'x', role: 'LEGEND', adminAccess: true },
    })
    return app.jwt.sign({
      sub: user.id,
      role: 'LEGEND',
      sectorId: 'sector-dev-produto',
      companyId: 'company-emr',
      features,
      adminAccess: true,
    })
  }

  it('requireAdmin e requireSectorFeature aceitam o acesso delegado', async () => {
    const app = buildApp()
    app.get('/so-admin', { onRequest: [app.authenticate, app.requireAdmin] }, async () => ({ ok: true }))
    app.get('/bloco-gg', { onRequest: [app.authenticate, app.requireSectorFeature('gente-gestao')] }, async () => ({ ok: true }))
    await app.ready()

    // Sem a feature `gente-gestao` no setor: o SUBADMIN seria barrado, o
    // delegado passa — o poder dele é pleno, não de setor.
    const token = await delegatedToken(app, 'delegada-guard@x.com')
    const headers = { authorization: `Bearer ${token}` }
    expect((await app.inject({ method: 'GET', url: '/so-admin', headers })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/bloco-gg', headers })).statusCode).toBe(200)
    await app.close()
  })

  /**
   * A exceção deliberada. `requireFeature` guarda rota de COLABORADOR, e a
   * feature diz o que o setor consome: liberar o delegado ali o faria votar e
   * participar de dinâmicas que o setor dele tem desligadas.
   */
  it('requireFeature ignora o acesso delegado — quem administra consome o que o setor libera', async () => {
    const app = buildApp()
    app.get('/feature-colaborador', { onRequest: [app.authenticate, app.requireFeature('selos')] }, async () => ({ ok: true }))
    await app.ready()

    const semFeature = await delegatedToken(app, 'delegada-sem-feature@x.com')
    const bloqueada = await app.inject({
      method: 'GET',
      url: '/feature-colaborador',
      headers: { authorization: `Bearer ${semFeature}` },
    })
    expect(bloqueada.statusCode).toBe(403)

    const comFeature = await delegatedToken(app, 'delegada-com-feature@x.com', ['selos'])
    const liberada = await app.inject({
      method: 'GET',
      url: '/feature-colaborador',
      headers: { authorization: `Bearer ${comFeature}` },
    })
    expect(liberada.statusCode).toBe(200)
    await app.close()
  })

  it('o acesso delegado não abre o console da equipe interna', async () => {
    const app = buildApp()
    app.get('/so-super', { onRequest: [app.authenticate, app.requireSuperAdmin] }, async () => ({ ok: true }))
    await app.ready()

    const token = await delegatedToken(app, 'delegada-super@x.com')
    const res = await app.inject({ method: 'GET', url: '/so-super', headers: { authorization: `Bearer ${token}` } })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})

describe('requireSuperAdmin', () => {
  it('requireSuperAdmin bloqueia quem não é SUPER_ADMIN', async () => {
    const app = buildApp()
    app.get('/only-super-admin', { onRequest: [app.authenticate, app.requireSuperAdmin] }, async () => ({ ok: true }))
    await app.ready()

    await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Admin', email: 'admin-guard-test@x.com', password: 'changeme123' } })
    await prisma.user.update({ where: { email: 'admin-guard-test@x.com' }, data: { role: 'ADMIN' } })
    const adminLogin = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'admin-guard-test@x.com', password: 'changeme123' } })
    const adminRes = await app.inject({ method: 'GET', url: '/only-super-admin', headers: { authorization: `Bearer ${adminLogin.json().accessToken}` } })
    expect(adminRes.statusCode).toBe(403)

    await app.inject({ method: 'POST', url: '/auth/register', payload: { name: 'Super', email: 'super-guard-test@x.com', password: 'changeme123' } })
    await prisma.user.update({ where: { email: 'super-guard-test@x.com' }, data: { role: 'SUPER_ADMIN' } })
    const superLogin = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'super-guard-test@x.com', password: 'changeme123' } })
    const superRes = await app.inject({ method: 'GET', url: '/only-super-admin', headers: { authorization: `Bearer ${superLogin.json().accessToken}` } })
    expect(superRes.statusCode).toBe(200)

    await app.close()
  })
})

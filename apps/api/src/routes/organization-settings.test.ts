import { describe, expect, it } from 'vitest'
import { DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID } from '@legends/shared'
import { buildApp } from '../app'
import { signAccessToken } from '../lib/jwt'
import { prisma } from '../lib/prisma'

describe('responsáveis do organograma no admin', () => {
  it('configura o responsável da empresa e o responsável do setor', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await prisma.user.create({
      data: {
        name: 'Admin Organização',
        email: 'admin-organization-settings@empresa.com',
        passwordHash: 'x',
        role: 'ADMIN',
      },
    })
    const responsible = await prisma.user.create({
      data: {
        name: 'Responsável Organização',
        email: 'responsible-organization-settings@empresa.com',
        passwordHash: 'x',
        role: 'HEAD',
      },
    })
    const secondResponsible = await prisma.user.create({
      data: {
        name: 'Segunda Responsável Organização',
        email: 'second-responsible-organization-settings@empresa.com',
        passwordHash: 'x',
        role: 'MANAGER',
      },
    })
    const token = signAccessToken(app, admin)

    const companyResponse = await app.inject({
      method: 'PATCH',
      url: '/admin/organization-settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { companyResponsibleIds: [responsible.id, secondResponsible.id] },
    })
    expect(companyResponse.statusCode).toBe(200)
    expect(companyResponse.json().settings.companyResponsibleIds).toEqual([responsible.id, secondResponsible.id])

    const sectorResponse = await app.inject({
      method: 'PATCH',
      url: `/admin/sectors/${DEFAULT_SECTOR_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { responsibleId: responsible.id },
    })
    expect(sectorResponse.statusCode).toBe(200)
    expect(sectorResponse.json().sector.responsibleId).toBe(responsible.id)

    const settingsResponse = await app.inject({
      method: 'GET',
      url: '/admin/organization-settings',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(settingsResponse.statusCode).toBe(200)
    expect(settingsResponse.json().settings.companyResponsibleIds).toEqual([responsible.id, secondResponsible.id])
    expect(await prisma.adminAuditLog.count({ where: { actorId: admin.id } })).toBe(2)
    await app.close()
  })

  it('rejeita responsáveis de outra empresa ou de outro setor', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await prisma.user.create({
      data: {
        name: 'Admin Validação Organização',
        email: 'admin-organization-validation@empresa.com',
        passwordHash: 'x',
        role: 'ADMIN',
      },
    })
    const token = signAccessToken(app, admin)
    const otherSector = await prisma.sector.create({
      data: {
        name: 'Outro setor responsável',
        slug: 'outro-setor-responsavel-validation',
        companyId: DEFAULT_COMPANY_ID,
      },
    })
    const wrongSectorUser = await prisma.user.create({
      data: {
        name: 'Pessoa de outro setor',
        email: 'wrong-sector-responsible@empresa.com',
        passwordHash: 'x',
        role: 'MANAGER',
        sectorId: otherSector.id,
      },
    })
    const otherCompany = await prisma.company.create({
      data: { name: 'Empresa externa responsável', slug: 'empresa-externa-responsavel-validation' },
    })
    const otherCompanySector = await prisma.sector.create({
      data: {
        name: 'Setor externo responsável',
        slug: 'setor-externo-responsavel-validation',
        companyId: otherCompany.id,
      },
    })
    const externalUser = await prisma.user.create({
      data: {
        name: 'Pessoa externa responsável',
        email: 'external-responsible-validation@empresa.com',
        passwordHash: 'x',
        role: 'HEAD',
        companyId: otherCompany.id,
        sectorId: otherCompanySector.id,
      },
    })

    const companyResponse = await app.inject({
      method: 'PATCH',
      url: '/admin/organization-settings',
      headers: { authorization: `Bearer ${token}` },
      payload: { companyResponsibleIds: [externalUser.id] },
    })
    expect(companyResponse.statusCode).toBe(400)

    const sectorResponse = await app.inject({
      method: 'PATCH',
      url: `/admin/sectors/${DEFAULT_SECTOR_ID}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { responsibleId: wrongSectorUser.id },
    })
    expect(sectorResponse.statusCode).toBe(400)
    const companyRows = await prisma.$queryRaw<Array<{ userId: string }>>`
      SELECT "userId" FROM "CompanyResponsible" WHERE "companyId" = ${DEFAULT_COMPANY_ID}
    `
    const sectorRows = await prisma.$queryRaw<Array<{ responsibleId: string | null }>>`
      SELECT "responsibleId" FROM "Sector" WHERE "id" = ${DEFAULT_SECTOR_ID}
    `
    expect(companyRows).toEqual([])
    expect(sectorRows[0].responsibleId).toBeNull()
    await app.close()
  })
})

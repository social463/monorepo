import { describe, expect, it } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from './prisma'
import { scopedPrisma } from './tenant-scope'

describe('isolamento por empresa do HrDashboard', () => {
  it('injeta o companyId no create e esconde painel de outra empresa', async () => {
    const other = await prisma.company.create({ data: { name: 'Outra', slug: 'outra-hr' } })
    const author = await prisma.user.create({
      data: { name: 'Autora Painel', email: 'autora-painel@empresa.com', passwordHash: 'x', role: 'ADMIN' },
    })

    const created = await scopedPrisma(DEFAULT_COMPANY_ID).hrDashboard.create({
      data: {
        title: 'Headcount',
        embedUrl: 'https://app.powerbi.com/view?r=abc',
        height: 720,
        sortOrder: 0,
        createdById: author.id,
      },
    })
    expect(created.companyId).toBe(DEFAULT_COMPANY_ID)

    const fromOtherCompany = await scopedPrisma(other.id).hrDashboard.findMany()
    expect(fromOtherCompany).toEqual([])

    const fromOwnCompany = await scopedPrisma(DEFAULT_COMPANY_ID).hrDashboard.findMany()
    expect(fromOwnCompany.map((d) => d.id)).toEqual([created.id])
  })
})

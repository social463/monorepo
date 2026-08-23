import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from './prisma'
import { scopedPrisma } from './tenant-scope'

const OTHER_COMPANY_ID = 'company-outra'

async function ensureOtherCompany() {
  await prisma.company.upsert({
    where: { id: OTHER_COMPANY_ID },
    update: {},
    create: { id: OTHER_COMPANY_ID, name: 'Outra', slug: 'outra' },
  })
}

describe('isolamento por empresa da loja', () => {
  it('produto de uma empresa não vaza para a outra', async () => {
    await ensureOtherCompany()
    const admin = await prisma.user.create({
      data: { name: 'Admin', email: `a-${Math.random()}@x.com`, passwordHash: 'x', role: 'ADMIN' },
    })
    await scopedPrisma(DEFAULT_COMPANY_ID).storeProduct.create({
      data: {
        title: 'Fone', category: 'Equipamento', priceInCoins: 100, stock: 3,
        createdById: admin.id,
      },
    })

    const daEmpresa = await scopedPrisma(DEFAULT_COMPANY_ID).storeProduct.findMany()
    const daOutra = await scopedPrisma(OTHER_COMPANY_ID).storeProduct.findMany()

    expect(daEmpresa).toHaveLength(1)
    expect(daOutra).toHaveLength(0)
  })
})

import { describe, it, expect } from 'vitest'
import { prisma } from './prisma'
import { scopedPrisma } from './tenant-scope'

async function makeCompany(id: string) {
  return prisma.company.create({ data: { id, name: id, slug: id } })
}

describe('isolamento por empresa da galeria', () => {
  it('não devolve álbum de outra empresa', async () => {
    await makeCompany('company-outra')
    const autor = await prisma.user.create({
      data: { name: 'Autor', email: `autor-${Math.random()}@empresa.com`, passwordHash: 'x', sectorId: 'sector-dev-produto' },
    })
    await prisma.eventAlbum.create({
      data: { title: 'Confra da EMR', createdById: autor.id, companyId: 'company-emr' },
    })
    await prisma.eventAlbum.create({
      data: { title: 'Confra alheia', createdById: autor.id, companyId: 'company-outra' },
    })

    const visiveis = await scopedPrisma('company-emr').eventAlbum.findMany()

    expect(visiveis.map((a) => a.title)).toEqual(['Confra da EMR'])
  })

  it('injeta o companyId do escopo ao criar', async () => {
    const autor = await prisma.user.create({
      data: { name: 'Autor', email: `autor-${Math.random()}@empresa.com`, passwordHash: 'x', sectorId: 'sector-dev-produto' },
    })
    const album = await scopedPrisma('company-emr').eventAlbum.create({
      data: { title: 'Hackathon', createdById: autor.id },
    })
    expect(album.companyId).toBe('company-emr')
  })
})

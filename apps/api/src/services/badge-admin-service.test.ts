import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { createBadgeAdmin, updateBadgeAdmin, listBadgesAdmin, getBadgeAdmin } from './badge-admin-service'

async function createActor() {
  const user = await prisma.user.create({
    data: { name: 'Admin', email: `admin-${Date.now()}-${Math.random()}@x.com`, passwordHash: 'x', role: 'ADMIN' },
  })
  return user.id
}

describe('badge-admin-service', () => {
  it('cria selo global e rejeita nome duplicado', async () => {
    const actorId = await createActor()
    const b = await createBadgeAdmin(
      { name: 'Mentor', description: 'Ajuda os colegas', kind: 'FEEDBACK', iconKey: 'star', global: true, sectorIds: [] },
      actorId,
      DEFAULT_COMPANY_ID,
    )
    expect(b.slug).toBe('mentor')
    await expect(
      createBadgeAdmin(
        { name: 'Mentor', description: 'Dup', kind: 'FEEDBACK', iconKey: 'star', global: true, sectorIds: [] },
        actorId,
        DEFAULT_COMPANY_ID,
      ),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('duas empresas podem ter selos com o mesmo nome', async () => {
    const actorId = await createActor()
    const outra = await prisma.company.create({ data: { name: 'Outra Empresa Slug', slug: 'outra-empresa-slug-test' } })
    const daEmr = await createBadgeAdmin(
      { name: 'Inovador do Ano', description: 'Traz ideias novas', kind: 'IMPACT', iconKey: 'bulb', global: true, sectorIds: [] },
      actorId,
      DEFAULT_COMPANY_ID,
    )
    // Mesmo nome, mesmo slug, outra empresa: até a migration
    // `20260820160000_selo_unico_por_empresa` isto estourava 409 porque o índice
    // de slug era do banco inteiro — um inquilino bloqueava o vocabulário do outro.
    const daOutra = await createBadgeAdmin(
      { name: 'Inovador do Ano', description: 'Traz ideias novas', kind: 'IMPACT', iconKey: 'bulb', global: true, sectorIds: [] },
      actorId,
      outra.id,
    )
    expect(daOutra.slug).toBe(daEmr.slug)
    expect(daOutra.companyId).toBe(outra.id)
    expect(daEmr.companyId).toBe(DEFAULT_COMPANY_ID)
    // E cada uma continua vendo só o seu.
    expect((await listBadgesAdmin(outra.id)).map((b) => b.id)).toEqual([daOutra.id])
  })

  it('atualiza selo e substitui vínculos de setor', async () => {
    const actorId = await createActor()
    const sectorA = await prisma.sector.create({ data: { name: 'Setor A Badge', slug: 'setor-a-badge-test', enabledFeatures: [] } })
    const b = await createBadgeAdmin(
      { name: 'Inovador', description: 'Traz ideias novas', kind: 'IMPACT', iconKey: 'bulb', global: false, sectorIds: [sectorA.id] },
      actorId,
      DEFAULT_COMPANY_ID,
    )
    const updated = await updateBadgeAdmin(b.id, { description: 'Traz ideias novas e as executa' }, actorId, DEFAULT_COMPANY_ID)
    expect(updated.description).toBe('Traz ideias novas e as executa')
    expect(updated.sectors.map((s) => s.sectorId)).toEqual([sectorA.id])
  })

  it('rejeita update de selo inexistente (404)', async () => {
    const actorId = await createActor()
    await expect(updateBadgeAdmin('nao-existe', { name: 'X' }, actorId, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 404 })
  })

  it('isola selos por empresa: selo global de outra empresa não aparece na listagem nem é editável', async () => {
    const actorId = await createActor()
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Badge', slug: 'outra-empresa-badge-test' } })
    const otherBadge = await createBadgeAdmin(
      { name: 'Selo Outra Empresa', description: 'X', kind: 'FEEDBACK', iconKey: 'star', global: true, sectorIds: [] },
      actorId,
      otherCompany.id,
    )

    const listed = await listBadgesAdmin(DEFAULT_COMPANY_ID)
    expect(listed.some((b) => b.id === otherBadge.id)).toBe(false)
    expect(await getBadgeAdmin(otherBadge.id, DEFAULT_COMPANY_ID)).toBeNull()
    await expect(updateBadgeAdmin(otherBadge.id, { name: 'Invasão' }, actorId, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 404 })
  })

  it('rejeita vínculo de selo com setor de outra empresa (create e update)', async () => {
    const actorId = await createActor()
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Badge Sector', slug: 'outra-empresa-badge-sector-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa Badge', slug: 'setor-outra-empresa-badge-test', enabledFeatures: [], companyId: otherCompany.id },
    })

    await expect(
      createBadgeAdmin(
        { name: 'Selo Cross Empresa', description: 'X', kind: 'FEEDBACK', iconKey: 'star', global: false, sectorIds: [otherSector.id] },
        actorId,
        DEFAULT_COMPANY_ID,
      ),
    ).rejects.toMatchObject({ status: 400 })

    const sectorSame = await prisma.sector.create({ data: { name: 'Setor Mesma Empresa Badge', slug: 'setor-mesma-empresa-badge-test', enabledFeatures: [] } })
    const b = await createBadgeAdmin(
      { name: 'Selo Válido', description: 'X', kind: 'FEEDBACK', iconKey: 'star', global: false, sectorIds: [sectorSame.id] },
      actorId,
      DEFAULT_COMPANY_ID,
    )
    await expect(
      updateBadgeAdmin(b.id, { sectorIds: [otherSector.id] }, actorId, DEFAULT_COMPANY_ID),
    ).rejects.toMatchObject({ status: 400 })
  })
})

import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { createSector, updateSector, listSectors, SectorError } from './sector-service'

async function createActor() {
  const user = await prisma.user.create({
    data: { name: 'Admin', email: `admin-${Date.now()}-${Math.random()}@x.com`, passwordHash: 'x', role: 'ADMIN' },
  })
  return user.id
}

describe('sector-service', () => {
  it('cria setor com slug, força escritório habilitado e rejeita nome duplicado', async () => {
    const actorId = await createActor()
    const s = await createSector({ name: 'Comercial', enabledFeatures: [], roles: ['LEGEND', 'LEAD'] }, actorId, DEFAULT_COMPANY_ID)
    expect(s.slug).toBe('comercial')
    expect(s.companyId).toBe(DEFAULT_COMPANY_ID)
    expect(s.enabledFeatures).toContain('escritorio')
    expect(s.roles.map((r) => r.role).sort()).toEqual(['LEAD', 'LEGEND'])
    await expect(
      createSector({ name: 'Comercial', enabledFeatures: [], roles: [] }, actorId, DEFAULT_COMPANY_ID),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('duas empresas podem ter setores com o mesmo nome', async () => {
    const actorId = await createActor()
    const outra = await prisma.company.create({ data: { name: 'Outra Empresa Setor', slug: 'outra-empresa-setor-test' } })
    const daEmr = await createSector({ name: 'Engenharia', enabledFeatures: [], roles: [] }, actorId, DEFAULT_COMPANY_ID)
    // Até a migration `20260820170000_setor_e_squad_unicos_por_empresa` isto era
    // 409: o índice de slug era do banco inteiro, e "Engenharia" é o primeiro
    // setor que qualquer cliente novo cadastra.
    const daOutra = await createSector({ name: 'Engenharia', enabledFeatures: [], roles: [] }, actorId, outra.id)
    expect(daOutra.slug).toBe(daEmr.slug)
    expect(daOutra.companyId).toBe(outra.id)
    expect((await listSectors(outra.id)).map((x) => x.id)).toEqual([daOutra.id])
  })

  it('atualiza nome, features e papéis habilitados (substitui, não soma)', async () => {
    const actorId = await createActor()
    const s = await createSector({ name: 'Marketing', enabledFeatures: ['votar'], roles: ['LEGEND'] }, actorId, DEFAULT_COMPANY_ID)
    const updated = await updateSector(
      s.id,
      {
        name: 'Marketing Digital',
        enabledFeatures: ['votar', 'selos'],
        roles: ['LEGEND', 'HEAD'],
      },
      actorId,
      DEFAULT_COMPANY_ID,
    )
    expect(updated.name).toBe('Marketing Digital')
    expect(updated.slug).toBe('marketing-digital')
    expect((updated.enabledFeatures as string[]).sort()).toEqual(['selos', 'votar'])
    expect(updated.roles.map((r) => r.role).sort()).toEqual(['HEAD', 'LEGEND'])
  })

  it('desativa setor (active=false) e listSectors traz todos, ativos e inativos', async () => {
    const actorId = await createActor()
    const s = await createSector({ name: 'Financeiro', enabledFeatures: [], roles: [] }, actorId, DEFAULT_COMPANY_ID)
    const off = await updateSector(s.id, { active: false }, actorId, DEFAULT_COMPANY_ID)
    expect(off.active).toBe(false)
    const all = await listSectors(DEFAULT_COMPANY_ID)
    expect(all.some((x) => x.id === s.id && !x.active)).toBe(true)
  })

  it('rejeita update de setor inexistente (404) e nome vazio (400)', async () => {
    const actorId = await createActor()
    await expect(updateSector('nao-existe', { name: 'X' }, actorId, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 404 })
    const s = await createSector({ name: 'RH', enabledFeatures: [], roles: [] }, actorId, DEFAULT_COMPANY_ID)
    await expect(updateSector(s.id, { name: '   ' }, actorId, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 400 })
  })

  it('audita create e update', async () => {
    const admin = await prisma.user.create({ data: { name: 'AuditAdmin', email: 'auditadmin-sector@x.com', passwordHash: 'x', role: 'ADMIN' } })
    const s = await createSector({ name: 'Setor Auditado', enabledFeatures: [], roles: [] }, admin.id, DEFAULT_COMPANY_ID)
    await updateSector(s.id, { name: 'Setor Auditado 2' }, admin.id, DEFAULT_COMPANY_ID)

    const rows = await prisma.adminAuditLog.findMany({ where: { entityType: 'Sector', entityId: s.id }, orderBy: { createdAt: 'asc' } })
    expect(rows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE'])
  })

  it('rejeita ler/editar setor de outra empresa', async () => {
    const actorId = await createActor()
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa', slug: 'outra-empresa-sector-test' } })
    const s = await createSector({ name: 'Setor Isolado', enabledFeatures: [], roles: [] }, actorId, otherCompany.id)
    await expect(updateSector(s.id, { name: 'Invasão' }, actorId, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 404 })
    const listed = await listSectors(DEFAULT_COMPANY_ID)
    expect(listed.some((x) => x.id === s.id)).toBe(false)
  })
})

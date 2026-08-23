import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { recordAuditLog, listAuditLog, listAuditLogActors } from './audit-log-service'

async function mkUser(name: string) {
  return prisma.user.create({ data: { name, email: `${name}@x.com`, passwordHash: 'x', role: 'ADMIN' } })
}

describe('recordAuditLog', () => {
  it('grava CREATE com before nulo', async () => {
    const admin = await mkUser('Ana')
    await recordAuditLog({ actorId: admin.id, entityType: 'Category', entityId: 'cat-1', action: 'CREATE', after: { name: 'Colaboração' }, companyId: DEFAULT_COMPANY_ID })
    const rows = await prisma.adminAuditLog.findMany({ where: { entityId: 'cat-1' } })
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('CREATE')
    expect(rows[0].before).toBeNull()
    expect(rows[0].after).toEqual({ name: 'Colaboração' })
    expect(rows[0].companyId).toBe(DEFAULT_COMPANY_ID)
  })

  it('grava UPDATE com before e after, normalizando Date para string', async () => {
    const admin = await mkUser('Bia')
    const createdAt = new Date('2026-01-01T00:00:00.000Z')
    await recordAuditLog({
      actorId: admin.id,
      entityType: 'Category',
      entityId: 'cat-2',
      action: 'UPDATE',
      before: { name: 'Antigo', createdAt },
      after: { name: 'Novo', createdAt },
      companyId: DEFAULT_COMPANY_ID,
    })
    const row = await prisma.adminAuditLog.findFirstOrThrow({ where: { entityId: 'cat-2' } })
    expect(row.before).toEqual({ name: 'Antigo', createdAt: createdAt.toISOString() })
    expect(row.after).toEqual({ name: 'Novo', createdAt: createdAt.toISOString() })
  })

  it('grava DELETE com after nulo', async () => {
    const admin = await mkUser('Caio')
    await recordAuditLog({ actorId: admin.id, entityType: 'Category', entityId: 'cat-3', action: 'DELETE', before: { name: 'Sumiu' }, companyId: DEFAULT_COMPANY_ID })
    const row = await prisma.adminAuditLog.findFirstOrThrow({ where: { entityId: 'cat-3' } })
    expect(row.after).toBeNull()
  })

  it('funciona dentro de uma transação existente (tx)', async () => {
    const admin = await mkUser('Duda')
    await prisma.$transaction(async (tx) => {
      await recordAuditLog({ actorId: admin.id, entityType: 'Category', entityId: 'cat-4', action: 'CREATE', after: { name: 'X' }, companyId: DEFAULT_COMPANY_ID, tx })
    })
    expect(await prisma.adminAuditLog.count({ where: { entityId: 'cat-4' } })).toBe(1)
  })
})

describe('listAuditLog', () => {
  it('pagina e filtra por entityType e actorId', async () => {
    const ana = await mkUser('Ana2')
    const bia = await mkUser('Bia2')
    await recordAuditLog({ actorId: ana.id, entityType: 'Category', entityId: 'c1', action: 'CREATE', after: {}, companyId: DEFAULT_COMPANY_ID })
    await recordAuditLog({ actorId: bia.id, entityType: 'Badge', entityId: 'b1', action: 'CREATE', after: {}, companyId: DEFAULT_COMPANY_ID })
    await recordAuditLog({ actorId: ana.id, entityType: 'Category', entityId: 'c2', action: 'CREATE', after: {}, companyId: DEFAULT_COMPANY_ID })

    const byType = await listAuditLog({ entityType: 'Category', page: 1, pageSize: 10 }, DEFAULT_COMPANY_ID)
    expect(byType.total).toBe(2)
    expect(byType.entries.every((e) => e.entityType === 'Category')).toBe(true)

    const byActor = await listAuditLog({ actorId: bia.id, page: 1, pageSize: 10 }, DEFAULT_COMPANY_ID)
    expect(byActor.total).toBe(1)
    expect(byActor.entries[0].actorId).toBe(bia.id)
  })

  it('ordena do mais recente pro mais antigo e pagina', async () => {
    const ana = await mkUser('Ana3')
    for (let i = 0; i < 3; i += 1) {
      await recordAuditLog({ actorId: ana.id, entityType: 'Category', entityId: `p${i}`, action: 'CREATE', after: { i }, companyId: DEFAULT_COMPANY_ID })
    }
    const page1 = await listAuditLog({ page: 1, pageSize: 2 }, DEFAULT_COMPANY_ID)
    expect(page1.entries).toHaveLength(2)
    expect(page1.total).toBeGreaterThanOrEqual(3)
    const page2 = await listAuditLog({ page: 2, pageSize: 2 }, DEFAULT_COMPANY_ID)
    expect(page2.entries.length).toBeGreaterThanOrEqual(1)
  })

  it('isola por empresa: não mostra nem conta entradas de outra empresa', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Audit Log', slug: 'outra-empresa-audit-log-test' } })
    const outsider = await prisma.user.create({
      data: { name: 'ForaAuditLog', email: 'fora-audit-log@x.com', passwordHash: 'x', role: 'ADMIN', companyId: otherCompany.id },
    })
    await recordAuditLog({ actorId: outsider.id, entityType: 'Category', entityId: 'outra-empresa-1', action: 'CREATE', after: {}, companyId: otherCompany.id })

    const ana = await mkUser('AnaIsolamento')
    await recordAuditLog({ actorId: ana.id, entityType: 'Category', entityId: 'minha-empresa-1', action: 'CREATE', after: {}, companyId: DEFAULT_COMPANY_ID })

    const { entries, total } = await listAuditLog({ page: 1, pageSize: 50 }, DEFAULT_COMPANY_ID)
    expect(entries.some((e) => e.entityId === 'outra-empresa-1')).toBe(false)
    expect(total).toBe(1)
    expect(entries).toHaveLength(1)
    expect(entries[0].entityId).toBe('minha-empresa-1')

    const actors = await listAuditLogActors(DEFAULT_COMPANY_ID)
    expect(actors.some((a) => a.id === outsider.id)).toBe(false)
  })
})

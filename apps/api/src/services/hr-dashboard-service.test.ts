import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { HrDashboardError } from '../lib/hr-dashboard-error'
import {
  createHrDashboard,
  deleteHrDashboard,
  listHrDashboards,
  updateHrDashboard,
  type HrDashboardActor,
} from './hr-dashboard-service'

const URL_OK = 'https://app.powerbi.com/view?r=abc'

let admin: HrDashboardActor
let subadmin: HrDashboardActor
let outroSetorId: string

beforeEach(async () => {
  const outroSetor = await prisma.sector.create({ data: { name: 'Gente e Gestão', slug: 'gente-e-gestao' } })
  outroSetorId = outroSetor.id
  const adminRow = await prisma.user.create({
    data: { name: 'Admin Painel', email: 'admin-painel@empresa.com', passwordHash: 'x', role: 'ADMIN' },
  })
  const subadminRow = await prisma.user.create({
    data: {
      name: 'Sub Painel',
      email: 'sub-painel@empresa.com',
      passwordHash: 'x',
      role: 'SUBADMIN',
      sectorId: outroSetor.id,
    },
  })
  admin = { id: adminRow.id, role: 'ADMIN', sectorId: adminRow.sectorId, companyId: DEFAULT_COMPANY_ID }
  subadmin = { id: subadminRow.id, role: 'SUBADMIN', sectorId: outroSetor.id, companyId: DEFAULT_COMPANY_ID }
})

describe('createHrDashboard', () => {
  it('cria painel da empresa e grava auditoria', async () => {
    const created = await createHrDashboard(admin, { title: 'Headcount', embedUrl: URL_OK })

    expect(created.sectorId).toBeNull()
    expect(created.height).toBe(720)
    expect(await prisma.adminAuditLog.count({ where: { entityType: 'HrDashboard', action: 'CREATE' } })).toBe(1)
  })

  it('recusa host fora da allowlist', async () => {
    await expect(createHrDashboard(admin, { title: 'X', embedUrl: 'https://evil.com/x' })).rejects.toMatchObject({
      status: 400,
    })
  })

  it('força o painel do subadmin para o setor dele quando o setor é omitido', async () => {
    const created = await createHrDashboard(subadmin, { title: 'Turnover', embedUrl: URL_OK })
    expect(created.sectorId).toBe(outroSetorId)
  })

  it('recusa subadmin criando painel de outro escopo', async () => {
    await expect(
      createHrDashboard(subadmin, { title: 'X', embedUrl: URL_OK, sectorId: DEFAULT_SECTOR_ID }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      createHrDashboard(subadmin, { title: 'X', embedUrl: URL_OK, sectorId: null }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('recusa setor inexistente informado pelo admin', async () => {
    await expect(
      createHrDashboard(admin, { title: 'X', embedUrl: URL_OK, sectorId: 'setor-que-nao-existe' }),
    ).rejects.toBeInstanceOf(HrDashboardError)
  })
})

describe('listHrDashboards', () => {
  it('devolve na ordem de sortOrder, com createdAt como desempate', async () => {
    await createHrDashboard(admin, { title: 'Terceiro', embedUrl: URL_OK, sortOrder: 30 })
    await createHrDashboard(admin, { title: 'Primeiro', embedUrl: URL_OK, sortOrder: 10 })
    await createHrDashboard(admin, { title: 'Segundo', embedUrl: URL_OK, sortOrder: 20 })

    const listed = await listHrDashboards(admin)
    expect(listed.map((d) => d.title)).toEqual(['Primeiro', 'Segundo', 'Terceiro'])
  })

  it('mostra ao subadmin os painéis da empresa e do próprio setor, não os de outro setor', async () => {
    await createHrDashboard(admin, { title: 'Da empresa', embedUrl: URL_OK })
    await createHrDashboard(admin, { title: 'Do meu setor', embedUrl: URL_OK, sectorId: outroSetorId })
    await createHrDashboard(admin, { title: 'De outro setor', embedUrl: URL_OK, sectorId: DEFAULT_SECTOR_ID })

    const listed = await listHrDashboards(subadmin)
    expect(listed.map((d) => d.title).sort()).toEqual(['Da empresa', 'Do meu setor'])
  })

  it('filtra por escopo para o admin', async () => {
    await createHrDashboard(admin, { title: 'Da empresa', embedUrl: URL_OK })
    await createHrDashboard(admin, { title: 'Do setor', embedUrl: URL_OK, sectorId: outroSetorId })

    expect((await listHrDashboards(admin, 'company')).map((d) => d.title)).toEqual(['Da empresa'])
    expect((await listHrDashboards(admin, outroSetorId)).map((d) => d.title)).toEqual(['Do setor'])
    expect((await listHrDashboards(admin, 'all')).length).toBe(2)
  })

  it('inclui o nome do setor do painel', async () => {
    await createHrDashboard(admin, { title: 'Do setor', embedUrl: URL_OK, sectorId: outroSetorId })
    const [dashboard] = await listHrDashboards(admin)
    expect(dashboard.sector?.name).toBe('Gente e Gestão')
  })
})

describe('updateHrDashboard', () => {
  it('atualiza campos, revalida a URL e grava auditoria com before/after', async () => {
    const created = await createHrDashboard(admin, { title: 'Headcount', embedUrl: URL_OK })

    const updated = await updateHrDashboard(admin, created.id, {
      title: 'Headcount 2026',
      embedUrl: 'https://lookerstudio.google.com/embed/reporting/xyz',
      height: 900,
    })

    expect(updated.title).toBe('Headcount 2026')
    expect(updated.height).toBe(900)
    const log = await prisma.adminAuditLog.findFirst({ where: { entityType: 'HrDashboard', action: 'UPDATE' } })
    expect((log?.before as { title: string }).title).toBe('Headcount')
    expect((log?.after as { title: string }).title).toBe('Headcount 2026')
  })

  it('recusa URL inválida na atualização', async () => {
    const created = await createHrDashboard(admin, { title: 'Headcount', embedUrl: URL_OK })
    await expect(
      updateHrDashboard(admin, created.id, { embedUrl: 'http://app.powerbi.com/view' }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('recusa subadmin editando painel da empresa ou de outro setor', async () => {
    const daEmpresa = await createHrDashboard(admin, { title: 'Da empresa', embedUrl: URL_OK })
    const deOutro = await createHrDashboard(admin, { title: 'De outro', embedUrl: URL_OK, sectorId: DEFAULT_SECTOR_ID })

    await expect(updateHrDashboard(subadmin, daEmpresa.id, { title: 'X' })).rejects.toMatchObject({ status: 403 })
    await expect(updateHrDashboard(subadmin, deOutro.id, { title: 'X' })).rejects.toMatchObject({ status: 403 })
  })

  it('recusa subadmin movendo o próprio painel para outro escopo', async () => {
    const meu = await createHrDashboard(subadmin, { title: 'Meu', embedUrl: URL_OK })
    await expect(updateHrDashboard(subadmin, meu.id, { sectorId: null })).rejects.toMatchObject({ status: 403 })
  })

  it('devolve 404 para painel inexistente', async () => {
    await expect(updateHrDashboard(admin, 'nao-existe', { title: 'X' })).rejects.toMatchObject({ status: 404 })
  })
})

describe('deleteHrDashboard', () => {
  it('apaga e grava auditoria', async () => {
    const created = await createHrDashboard(admin, { title: 'Headcount', embedUrl: URL_OK })
    await deleteHrDashboard(admin, created.id)

    expect(await prisma.hrDashboard.count()).toBe(0)
    expect(await prisma.adminAuditLog.count({ where: { entityType: 'HrDashboard', action: 'DELETE' } })).toBe(1)
  })

  it('recusa subadmin apagando painel da empresa', async () => {
    const created = await createHrDashboard(admin, { title: 'Da empresa', embedUrl: URL_OK })
    await expect(deleteHrDashboard(subadmin, created.id)).rejects.toMatchObject({ status: 403 })
  })
})

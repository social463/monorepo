import { describe, expect, it } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { createOfficeGuestInvite, getValidOfficeGuestInvite } from './office-guest-service'

describe('office-guest-service', () => {
  it('cria convite com validade clampeada', async () => {
    const admin = await prisma.user.create({
      data: { name: 'Admin', email: `admin-${Date.now()}@x.com`, passwordHash: 'x', role: 'ADMIN' },
    })
    const { invite, rawToken } = await createOfficeGuestInvite(admin.id, 5, DEFAULT_COMPANY_ID)
    expect(invite.expiresAt.getTime()).toBeGreaterThan(Date.now())
    expect(rawToken).toHaveLength(43)
  })

  it('audita criação de convite de convidado', async () => {
    const admin = await prisma.user.create({ data: { name: 'AuditGuestAdmin', email: 'auditguest@x.com', passwordHash: 'x', role: 'ADMIN' } })
    const { invite } = await createOfficeGuestInvite(admin.id, 60, DEFAULT_COMPANY_ID)
    const row = await prisma.adminAuditLog.findFirstOrThrow({ where: { entityType: 'OfficeGuestInvite', entityId: invite.id } })
    expect(row.action).toBe('CREATE')
  })

  it('convite criado por admin de uma empresa herda o companyId do admin, não o default', async () => {
    const company = await prisma.company.create({ data: { name: 'Outra Empresa Guest', slug: 'outra-empresa-guest-test' } })
    const admin = await prisma.user.create({
      data: { name: 'Admin Outra Empresa', email: `admin-outra-${Date.now()}@x.com`, passwordHash: 'x', role: 'ADMIN', companyId: company.id },
    })
    const { invite } = await createOfficeGuestInvite(admin.id, 30, company.id)
    expect(invite.companyId).toBe(company.id)
  })

  it('validação de convite continua funcionando sem sessão de empresa (convidado não tem companyId próprio)', async () => {
    const company = await prisma.company.create({ data: { name: 'Outra Empresa Guest Validate', slug: 'outra-empresa-guest-validate-test' } })
    const admin = await prisma.user.create({
      data: { name: 'Admin Validate', email: `admin-validate-${Date.now()}@x.com`, passwordHash: 'x', role: 'ADMIN', companyId: company.id },
    })
    const { rawToken, invite } = await createOfficeGuestInvite(admin.id, 30, company.id)
    const found = await getValidOfficeGuestInvite(rawToken)
    expect(found.id).toBe(invite.id)
    expect(found.companyId).toBe(company.id)
  })
})

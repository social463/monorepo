import { describe, expect, it } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { buildApp } from '../app'
import {
  ThirdPartyInviteError,
  createThirdPartyInvite,
  deleteThirdPartyInvite,
  getValidThirdPartyInvite,
  acceptThirdPartyInvite,
  revokeThirdPartyInvite,
  listThirdPartyInvites,
} from './third-party-invite-service'

describe('third-party-invite-service', () => {
  it('cria convite com validade clampeada e valida token inválido', async () => {
    const admin = await prisma.user.create({
      data: { name: 'Admin', email: 'admin@x.com', passwordHash: 'x', role: 'ADMIN' },
    })
    const { invite, rawToken } = await createThirdPartyInvite(admin.id, 5, ['escritorio', 'time'], 'sector-dev-produto')
    expect(invite.expiresAt.getTime()).toBeGreaterThan(Date.now())
    expect(rawToken).toHaveLength(43)

    await expect(getValidThirdPartyInvite('token-invalido')).rejects.toThrow(ThirdPartyInviteError)
  })

  it('revogar pelo admin bloqueia o accept mesmo com o convite ainda dentro da validade', async () => {
    const admin = await prisma.user.create({
      data: { name: 'Admin', email: `admin-${Date.now()}@x.com`, passwordHash: 'x', role: 'ADMIN' },
    })
    const { invite, rawToken } = await createThirdPartyInvite(admin.id, 120, ['escritorio'], 'sector-dev-produto')
    await expect(getValidThirdPartyInvite(rawToken)).resolves.toMatchObject({ id: invite.id })

    await revokeThirdPartyInvite(invite.id, admin.id, DEFAULT_COMPANY_ID)
    await expect(getValidThirdPartyInvite(rawToken)).rejects.toThrow(ThirdPartyInviteError)
  })

  it('deleteThirdPartyInvite apaga o convite independente do status', async () => {
    const admin = await prisma.user.create({
      data: { name: 'Admin', email: `admin-${Date.now()}@x.com`, passwordHash: 'x', role: 'ADMIN' },
    })
    const { invite: pending } = await createThirdPartyInvite(admin.id, 120, ['escritorio'], 'sector-dev-produto')
    await deleteThirdPartyInvite(pending.id, admin.id, DEFAULT_COMPANY_ID)
    await expect(prisma.thirdPartyInvite.findUnique({ where: { id: pending.id } })).resolves.toBeNull()

    const { invite: revoked } = await createThirdPartyInvite(admin.id, 120, ['escritorio'], 'sector-dev-produto')
    await revokeThirdPartyInvite(revoked.id, admin.id, DEFAULT_COMPANY_ID)
    await deleteThirdPartyInvite(revoked.id, admin.id, DEFAULT_COMPANY_ID)
    await expect(prisma.thirdPartyInvite.findUnique({ where: { id: revoked.id } })).resolves.toBeNull()
  })

  it('deleteThirdPartyInvite falha para convite inexistente', async () => {
    const admin = await prisma.user.create({
      data: { name: 'Admin', email: `admin-${Date.now()}@x.com`, passwordHash: 'x', role: 'ADMIN' },
    })
    await expect(deleteThirdPartyInvite('inexistente', admin.id, DEFAULT_COMPANY_ID)).rejects.toThrow(ThirdPartyInviteError)
  })

  it('revokeThirdPartyInvite é idempotente (no-op) quando já revogado ou inexistente', async () => {
    const admin = await prisma.user.create({
      data: { name: 'Admin', email: `admin-${Date.now()}@x.com`, passwordHash: 'x', role: 'ADMIN' },
    })
    const { invite } = await createThirdPartyInvite(admin.id, 120, ['escritorio'], 'sector-dev-produto')
    await revokeThirdPartyInvite(invite.id, admin.id, DEFAULT_COMPANY_ID)
    const afterFirst = await prisma.thirdPartyInvite.findUniqueOrThrow({ where: { id: invite.id } })

    await expect(revokeThirdPartyInvite(invite.id, admin.id, DEFAULT_COMPANY_ID)).resolves.toBeUndefined()
    const afterSecond = await prisma.thirdPartyInvite.findUniqueOrThrow({ where: { id: invite.id } })
    expect(afterSecond.revokedAt).toEqual(afterFirst.revokedAt)

    await expect(revokeThirdPartyInvite('inexistente', admin.id, DEFAULT_COMPANY_ID)).resolves.toBeUndefined()

    const updateRows = await prisma.adminAuditLog.findMany({
      where: { entityType: 'ThirdPartyInvite', entityId: invite.id, action: 'UPDATE' },
    })
    expect(updateRows).toHaveLength(1)
  })

  it('audita revoke e delete de convite', async () => {
    const admin = await prisma.user.create({ data: { name: 'AuditInviteAdmin', email: 'auditinvite@x.com', passwordHash: 'x', role: 'ADMIN' } })
    const { invite } = await createThirdPartyInvite(admin.id, 60, [], 'sector-dev-produto')
    await revokeThirdPartyInvite(invite.id, admin.id, DEFAULT_COMPANY_ID)

    const { invite: invite2 } = await createThirdPartyInvite(admin.id, 60, [], 'sector-dev-produto')
    await deleteThirdPartyInvite(invite2.id, admin.id, DEFAULT_COMPANY_ID)

    const revokeRow = await prisma.adminAuditLog.findFirstOrThrow({
      where: { entityType: 'ThirdPartyInvite', entityId: invite.id, action: 'UPDATE' },
    })
    expect(revokeRow.action).toBe('UPDATE')
    const deleteRow = await prisma.adminAuditLog.findFirstOrThrow({
      where: { entityType: 'ThirdPartyInvite', entityId: invite2.id, action: 'DELETE' },
    })
    expect(deleteRow.action).toBe('DELETE')
  })

  it('aceita o convite criando a conta e bloqueia reuso', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await prisma.user.create({
      data: { name: 'Admin', email: `admin-${Date.now()}@x.com`, passwordHash: 'x', role: 'ADMIN' },
    })
    const { rawToken } = await createThirdPartyInvite(admin.id, 120, ['escritorio'], 'sector-dev-produto')

    const accepted = await acceptThirdPartyInvite(app, {
      token: rawToken,
      name: 'Fulano',
      email: `terceirizado-${Date.now()}@x.com`,
      password: 'senha1234',
    })
    expect(accepted.user.role).toBe('THIRD_PARTY')
    expect(accepted.user.enabledFeatures).toEqual(['escritorio'])
    expect(accepted.accessToken).toBeTruthy()

    await expect(
      acceptThirdPartyInvite(app, {
        token: rawToken,
        name: 'Outro',
        email: `outro-${Date.now()}@x.com`,
        password: 'senha1234',
      }),
    ).rejects.toThrow(ThirdPartyInviteError)

    await app.close()
  })

  it('rejeita accept quando o e-mail já existe como usuário (mesmo fora do pré-check)', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await prisma.user.create({
      data: { name: 'Admin', email: `admin-${Date.now()}@x.com`, passwordHash: 'x', role: 'ADMIN' },
    })
    const email = `duplicado-${Date.now()}@x.com`
    await prisma.user.create({ data: { name: 'Existente', email, passwordHash: 'x', role: 'LEGEND' } })
    const { rawToken } = await createThirdPartyInvite(admin.id, 120, ['escritorio'], 'sector-dev-produto')

    await expect(
      acceptThirdPartyInvite(app, { token: rawToken, name: 'Fulano', email, password: 'senha1234' }),
    ).rejects.toMatchObject({ status: 409 })

    await app.close()
  })

  it('cria convite com sectorId informado, e a conta aceita herda esse setor', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await prisma.user.create({
      data: { name: 'Admin', email: `admin-${Date.now()}@x.com`, passwordHash: 'x', role: 'ADMIN' },
    })
    const otherSector = await prisma.sector.create({
      data: { name: 'Comercial', slug: 'comercial-invite-test', enabledFeatures: [] },
    })
    const { invite, rawToken } = await createThirdPartyInvite(admin.id, 60, ['escritorio'], otherSector.id)
    expect(invite.sectorId).toBe(otherSector.id)

    const { user } = await acceptThirdPartyInvite(app, {
      token: rawToken,
      name: 'Terceiro',
      email: `terceiro-${Date.now()}@x.com`,
      password: 'changeme123',
    })
    expect(user.sectorId).toBe(otherSector.id)

    await app.close()
  })

  it('isola convites por empresa: listagem não vaza entre empresas', async () => {
    const admin = await prisma.user.create({ data: { name: 'AdminCompanyInvite', email: `admin-company-invite-${Date.now()}@x.com`, passwordHash: 'x', role: 'ADMIN' } })
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Invite', slug: 'outra-empresa-invite-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa Invite', slug: 'setor-outra-empresa-invite', enabledFeatures: [], companyId: otherCompany.id },
    })

    const { invite: inviteDefault } = await createThirdPartyInvite(admin.id, 60, [], 'sector-dev-produto')
    const { invite: inviteOther } = await createThirdPartyInvite(admin.id, 60, [], otherSector.id)
    expect(inviteDefault.companyId).toBe(DEFAULT_COMPANY_ID)
    expect(inviteOther.companyId).toBe(otherCompany.id)

    const listedDefault = await listThirdPartyInvites(DEFAULT_COMPANY_ID)
    expect(listedDefault.some((i) => i.id === inviteOther.id)).toBe(false)
    expect(listedDefault.some((i) => i.id === inviteDefault.id)).toBe(true)
  })

  it('revokeThirdPartyInvite/deleteThirdPartyInvite rejeitam quando o companyId do ator não bate com o do convite', async () => {
    const admin = await prisma.user.create({ data: { name: 'AdminOutraInvite', email: `admin-outra-invite-${Date.now()}@x.com`, passwordHash: 'x', role: 'ADMIN' } })
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Revoke Invite', slug: 'outra-empresa-revoke-invite-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa Revoke Invite', slug: 'setor-outra-empresa-revoke-invite-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const { invite } = await createThirdPartyInvite(admin.id, 60, [], otherSector.id)
    expect(invite.companyId).toBe(otherCompany.id)

    // ator "de fora" tentando revogar/apagar usando o companyId default (não o da empresa do convite)
    await expect(revokeThirdPartyInvite(invite.id, admin.id, DEFAULT_COMPANY_ID)).resolves.toBeUndefined()
    const stillPending = await prisma.thirdPartyInvite.findUniqueOrThrow({ where: { id: invite.id } })
    expect(stillPending.revokedAt).toBeNull() // no-op: não revogou, porque o convite não existe no escopo do ator

    await expect(deleteThirdPartyInvite(invite.id, admin.id, DEFAULT_COMPANY_ID)).rejects.toThrow(ThirdPartyInviteError)
    const stillExists = await prisma.thirdPartyInvite.findUnique({ where: { id: invite.id } })
    expect(stillExists).not.toBeNull()
  })
})

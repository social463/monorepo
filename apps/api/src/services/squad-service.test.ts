import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { createSquad, updateSquad, deleteSquad, addMember, removeMember, listSquads, SquadError } from './squad-service'

async function mkUser(role: 'LEGEND' | 'LEAD' | 'ADMIN' | 'SUBADMIN', name: string, sectorId?: string) {
  return prisma.user.create({ data: { name, email: `${name}@x.com`, passwordHash: 'x', role, ...(sectorId ? { sectorId } : {}) } })
}

describe('squad-service', () => {
  it('cria squad com slug e rejeita nome duplicado', async () => {
    const admin = await mkUser('ADMIN', 'Admin1')
    const s = await createSquad({ name: 'Inovação', sectorId: DEFAULT_SECTOR_ID }, admin.id, DEFAULT_COMPANY_ID)
    expect(s.slug).toBe('inovacao')
    expect(s.members).toEqual([])
    await expect(createSquad({ name: 'Inovação', sectorId: DEFAULT_SECTOR_ID }, admin.id, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 409 })
  })

  it('duas empresas podem ter squads com o mesmo nome', async () => {
    const admin = await mkUser('ADMIN', 'AdminSlugPorEmpresa')
    const outra = await prisma.company.create({ data: { name: 'Outra Empresa Nome Squad', slug: 'outra-empresa-nome-squad-test' } })
    const outroSetor = await prisma.sector.create({
      data: { name: 'Setor Outra', slug: 'setor-outra-nome-squad', enabledFeatures: [], companyId: outra.id },
    })
    const daEmr = await createSquad({ name: 'Plataforma', sectorId: DEFAULT_SECTOR_ID }, admin.id, DEFAULT_COMPANY_ID)
    // `Squad.name` e `Squad.slug` eram únicos no banco inteiro até a migration
    // `20260820170000_setor_e_squad_unicos_por_empresa` — um inquilino tomava o
    // nome do outro.
    const daOutra = await createSquad({ name: 'Plataforma', sectorId: outroSetor.id }, admin.id, outra.id)
    expect(daOutra.slug).toBe(daEmr.slug)
    expect(daOutra.companyId).toBe(outra.id)
    expect((await listSquads(outra.id)).map((x) => x.id)).toEqual([daOutra.id])
  })

  it('renomeia e desativa', async () => {
    const admin = await mkUser('ADMIN', 'Admin2')
    const s = await createSquad({ name: 'B2B', sectorId: DEFAULT_SECTOR_ID }, admin.id, DEFAULT_COMPANY_ID)
    const renamed = await updateSquad(s.id, { name: 'B2B Plus' }, admin.id, DEFAULT_COMPANY_ID)
    expect(renamed.name).toBe('B2B Plus')
    expect(renamed.slug).toBe('b2b-plus')
    const off = await updateSquad(s.id, { active: false }, admin.id, DEFAULT_COMPANY_ID)
    expect(off.active).toBe(false)
  })

  it('qualquer integrante (DEV ou LEAD) pode estar em várias squads', async () => {
    const admin = await mkUser('ADMIN', 'Admin3')
    const s1 = await createSquad({ name: 'Estudar Mais', sectorId: DEFAULT_SECTOR_ID }, admin.id, DEFAULT_COMPANY_ID)
    const s2 = await createSquad({ name: 'Estudar Melhor', sectorId: DEFAULT_SECTOR_ID }, admin.id, DEFAULT_COMPANY_ID)
    const dev = await mkUser('LEGEND', 'Dan')
    const lead = await mkUser('LEAD', 'Lia')

    await addMember(s1.id, dev.id, admin.id, DEFAULT_COMPANY_ID)
    const devAfter = await addMember(s2.id, dev.id, admin.id, DEFAULT_COMPANY_ID)
    expect(devAfter.members.map((m) => m.userId)).toContain(dev.id)

    await addMember(s1.id, lead.id, admin.id, DEFAULT_COMPANY_ID)
    const leadAfter = await addMember(s2.id, lead.id, admin.id, DEFAULT_COMPANY_ID)
    expect(leadAfter.members.map((m) => m.userId)).toContain(lead.id)
  })

  it('rejeita ADMIN como integrante e membro duplicado na mesma squad', async () => {
    const actor = await mkUser('ADMIN', 'Admin4')
    const s = await createSquad({ name: 'Sucesso do Cliente', sectorId: DEFAULT_SECTOR_ID }, actor.id, DEFAULT_COMPANY_ID)
    const admin = await mkUser('ADMIN', 'Ada')
    await expect(addMember(s.id, admin.id, actor.id, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 400 })
    const dev = await mkUser('LEGEND', 'Deo')
    await addMember(s.id, dev.id, actor.id, DEFAULT_COMPANY_ID)
    await expect(addMember(s.id, dev.id, actor.id, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 409 })
  })

  it('rejeita SUBADMIN como integrante', async () => {
    const actor = await mkUser('ADMIN', 'Admin4b')
    const s = await createSquad({ name: 'Sucesso do Cliente Sub', sectorId: DEFAULT_SECTOR_ID }, actor.id, DEFAULT_COMPANY_ID)
    const sub = await mkUser('SUBADMIN', 'Suba')
    await expect(addMember(s.id, sub.id, actor.id, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 400 })
  })

  it('remove integrante e lista só ativas quando pedido', async () => {
    const admin = await mkUser('ADMIN', 'Admin5')
    const s = await createSquad({ name: 'X', sectorId: DEFAULT_SECTOR_ID }, admin.id, DEFAULT_COMPANY_ID)
    const dev = await mkUser('LEGEND', 'Rui')
    await addMember(s.id, dev.id, admin.id, DEFAULT_COMPANY_ID)
    await removeMember(s.id, dev.id, admin.id, DEFAULT_COMPANY_ID)
    const reloaded = (await listSquads(DEFAULT_COMPANY_ID)).find((x) => x.id === s.id)
    expect(reloaded?.members).toEqual([])
    await updateSquad(s.id, { active: false }, admin.id, DEFAULT_COMPANY_ID)
    expect((await listSquads(DEFAULT_COMPANY_ID, { activeOnly: true })).some((x) => x.id === s.id)).toBe(false)
  })

  it('rejeita integrante de outro setor ao adicionar (400) e aceita integrante do mesmo setor', async () => {
    const admin = await mkUser('ADMIN', 'AdminSectorAdd')
    const sectorB = await prisma.sector.create({ data: { name: 'Setor B Squad Add', slug: 'setor-b-squad-add', enabledFeatures: [] } })
    const s = await createSquad({ name: 'Squad Setorizada Add', sectorId: DEFAULT_SECTOR_ID }, admin.id, DEFAULT_COMPANY_ID)
    const devOther = await mkUser('LEGEND', 'DevOutroSetorAdd', sectorB.id)
    await expect(addMember(s.id, devOther.id, admin.id, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 400, message: 'Integrante inválido.' })

    const devSame = await mkUser('LEGEND', 'DevMesmoSetorAdd')
    const after = await addMember(s.id, devSame.id, admin.id, DEFAULT_COMPANY_ID)
    expect(after.members.map((m) => m.userId)).toContain(devSame.id)
  })

  it('rejeita líder de outro setor ao definir (400) e aceita líder do mesmo setor', async () => {
    const admin = await mkUser('ADMIN', 'AdminSectorLead')
    const sectorB = await prisma.sector.create({ data: { name: 'Setor B Squad Lead', slug: 'setor-b-squad-lead', enabledFeatures: [] } })
    const s = await createSquad({ name: 'Squad Setorizada Lead', sectorId: DEFAULT_SECTOR_ID }, admin.id, DEFAULT_COMPANY_ID)
    const leadOther = await mkUser('LEAD', 'LeadOutroSetor', sectorB.id)
    await expect(updateSquad(s.id, { leaderId: leadOther.id }, admin.id, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 400, message: 'Integrante inválido.' })

    const leadSame = await mkUser('LEAD', 'LeadMesmoSetor')
    const updated = await updateSquad(s.id, { leaderId: leadSame.id }, admin.id, DEFAULT_COMPANY_ID)
    expect(updated.leader?.id).toBe(leadSame.id)
  })

  it('audita create/update/addMember/removeMember', async () => {
    const admin = await mkUser('ADMIN', 'AuditAdmin')
    const dev = await mkUser('LEGEND', 'AuditDev')

    const s = await createSquad({ name: 'Squad Auditada', sectorId: DEFAULT_SECTOR_ID }, admin.id, DEFAULT_COMPANY_ID)
    await updateSquad(s.id, { name: 'Squad Auditada 2' }, admin.id, DEFAULT_COMPANY_ID)
    await addMember(s.id, dev.id, admin.id, DEFAULT_COMPANY_ID)
    await removeMember(s.id, dev.id, admin.id, DEFAULT_COMPANY_ID)

    const rows = await prisma.adminAuditLog.findMany({ where: { entityType: { in: ['Squad', 'SquadMember'] } }, orderBy: { createdAt: 'asc' } })
    expect(rows.map((r) => [r.entityType, r.action])).toEqual([
      ['Squad', 'CREATE'],
      ['Squad', 'UPDATE'],
      ['SquadMember', 'CREATE'],
      ['SquadMember', 'DELETE'],
    ])
  })

  it('rejeita mover squad para setor de outra empresa e isola listagem por empresa', async () => {
    const admin = await mkUser('ADMIN', 'AdminCompanySquad')
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Squad', slug: 'outra-empresa-squad-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa', slug: 'setor-outra-empresa-squad', enabledFeatures: [], companyId: otherCompany.id },
    })
    const s = await createSquad({ name: 'Squad Empresa Padrão', sectorId: DEFAULT_SECTOR_ID }, admin.id, DEFAULT_COMPANY_ID)

    await expect(updateSquad(s.id, { sectorId: otherSector.id }, admin.id, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 400 })

    // Criar já apontando pro setor de outra empresa também deve ser rejeitado — sem essa
    // checagem, um ADMIN podia informar o sectorId de outra empresa e a squad nascia lá.
    await expect(createSquad({ name: 'Squad Outra Empresa', sectorId: otherSector.id }, admin.id, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 400 })

    const listed = await listSquads(DEFAULT_COMPANY_ID)
    expect(listed.some((x) => x.id === s.id)).toBe(true)
  })
})

describe('squad-service — excluir', () => {
  it('exclui a squad e leva os vínculos de integrante junto', async () => {
    const admin = await mkUser('ADMIN', 'AdminDel1')
    const dev = await mkUser('LEGEND', 'DevDel1')
    const squad = await createSquad({ name: 'Receita Antiga', sectorId: DEFAULT_SECTOR_ID }, admin.id, DEFAULT_COMPANY_ID)
    await addMember(squad.id, dev.id, admin.id, DEFAULT_COMPANY_ID)

    await deleteSquad(squad.id, admin.id, DEFAULT_COMPANY_ID)

    expect(await prisma.squad.findUnique({ where: { id: squad.id } })).toBeNull()
    expect(await prisma.squadMember.count({ where: { squadId: squad.id } })).toBe(0)
    // O nome volta a ficar livre — é o que desativar não devolvia.
    const renascida = await createSquad({ name: 'Receita Antiga', sectorId: DEFAULT_SECTOR_ID }, admin.id, DEFAULT_COMPANY_ID)
    expect(renascida.id).not.toBe(squad.id)
  })

  it('exclui squad desativada', async () => {
    const admin = await mkUser('ADMIN', 'AdminDel2')
    const squad = await createSquad({ name: 'Squad Morta', sectorId: DEFAULT_SECTOR_ID }, admin.id, DEFAULT_COMPANY_ID)
    await updateSquad(squad.id, { active: false }, admin.id, DEFAULT_COMPANY_ID)
    await deleteSquad(squad.id, admin.id, DEFAULT_COMPANY_ID)
    expect(await prisma.squad.findUnique({ where: { id: squad.id } })).toBeNull()
  })

  it('recusa com 409 quando a squad tem retrospectiva ligada', async () => {
    const admin = await mkUser('ADMIN', 'AdminDel3')
    const squad = await createSquad({ name: 'Squad Com Retro', sectorId: DEFAULT_SECTOR_ID }, admin.id, DEFAULT_COMPANY_ID)
    const room = await prisma.retroRoom.create({ data: { sprint: 1, createdById: admin.id, votesPerParticipant: 3 } })
    await prisma.retroRoomSquad.create({ data: { roomId: room.id, squadId: squad.id } })

    await expect(deleteSquad(squad.id, admin.id, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 409 })
    expect(await prisma.squad.findUnique({ where: { id: squad.id } })).not.toBeNull()
  })

  it('registra no log de auditoria', async () => {
    const admin = await mkUser('ADMIN', 'AdminDel4')
    const squad = await createSquad({ name: 'Squad Auditada', sectorId: DEFAULT_SECTOR_ID }, admin.id, DEFAULT_COMPANY_ID)
    await deleteSquad(squad.id, admin.id, DEFAULT_COMPANY_ID)
    const log = await prisma.adminAuditLog.findFirst({ where: { entityType: 'Squad', entityId: squad.id, action: 'DELETE' } })
    expect(log).not.toBeNull()
  })

  it('squad de outra empresa rejeita com 404 e continua de pé', async () => {
    const admin = await mkUser('ADMIN', 'AdminDel5')
    const outra = await prisma.company.create({ data: { name: 'Outra Empresa Del Squad', slug: 'outra-empresa-del-squad-test' } })
    const outroSetor = await prisma.sector.create({
      data: { name: 'Setor Outra Del', slug: 'setor-outra-del-squad-test', enabledFeatures: [], companyId: outra.id },
    })
    const alheia = await prisma.squad.create({
      data: { name: 'Squad Alheia Del', slug: 'squad-alheia-del-test', sectorId: outroSetor.id, companyId: outra.id },
    })

    await expect(deleteSquad(alheia.id, admin.id, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 404 })
    expect(await prisma.squad.findUnique({ where: { id: alheia.id } })).not.toBeNull()
  })
})

describe('squad-service — escopo por empresa', () => {
  it('updateSquad de uma squad de outra empresa rejeita com 404 (companyId do ator)', async () => {
    const admin = await prisma.user.create({ data: { name: 'Admin', email: `admin-squad-scope-${Date.now()}@x.com`, passwordHash: 'x', role: 'ADMIN' } })
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Squad Scope', slug: 'outra-empresa-squad-scope-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa Squad Scope', slug: 'setor-outra-empresa-squad-scope-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const otherSquad = await prisma.squad.create({ data: { name: 'Squad De Outra Empresa', slug: 'squad-de-outra-empresa-scope-test', sectorId: otherSector.id, companyId: otherCompany.id } })

    await expect(updateSquad(otherSquad.id, { name: 'Invasão' }, admin.id, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 404 })
  })

  it('addMember/removeMember em squad de outra empresa rejeita com 404', async () => {
    const admin = await prisma.user.create({ data: { name: 'Admin', email: `admin-squad-scope2-${Date.now()}@x.com`, passwordHash: 'x', role: 'ADMIN' } })
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Squad Scope 2', slug: 'outra-empresa-squad-scope-2-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa Squad Scope 2', slug: 'setor-outra-empresa-squad-scope-2-test', enabledFeatures: [], companyId: otherCompany.id },
    })
    const otherSquad = await prisma.squad.create({ data: { name: 'Squad De Outra Empresa 2', slug: 'squad-de-outra-empresa-2-scope-test', sectorId: otherSector.id, companyId: otherCompany.id } })
    const otherDev = await prisma.user.create({ data: { name: 'Dev Outra', email: `dev-outra-squad-scope@x.com`, passwordHash: 'x', sectorId: otherSector.id, companyId: otherCompany.id } })

    await expect(addMember(otherSquad.id, otherDev.id, admin.id, DEFAULT_COMPANY_ID)).rejects.toMatchObject({ status: 404 })
    // Cria o vínculo diretamente (fora do service) para provar que removeMember com o companyId
    // errado não o afeta — addMember acima rejeitou antes de criar nada, então sem isso o teste
    // não provaria nada sobre o efeito de removeMember.
    await prisma.squadMember.create({ data: { squadId: otherSquad.id, userId: otherDev.id } })
    // removeMember não lança para squad de outra empresa hoje (scopedPrisma não encontra e a
    // função retorna sem apagar); a asserção correta é que a remoção NÃO afeta a squad de outra
    // empresa quando o service é chamado com o companyId do ator errado:
    await removeMember(otherSquad.id, otherDev.id, admin.id, DEFAULT_COMPANY_ID)
    const stillMember = await prisma.squadMember.findFirst({ where: { squadId: otherSquad.id, userId: otherDev.id } })
    expect(stillMember).not.toBeNull() // membro de outra empresa não foi removido pelo ator errado
  })
})

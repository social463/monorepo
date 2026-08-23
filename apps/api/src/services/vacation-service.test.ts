import { describe, it, expect } from 'vitest'
import { prisma } from '../lib/prisma'
import { addDays, todayInSaoPaulo } from '../lib/sao-paulo-date'
import {
  VacationError,
  createVacation,
  deleteVacation,
  listSectorVacations,
  listTeamVacations,
  updateVacation,
} from './vacation-service'

async function makeUser(name: string, role: string, extra: Record<string, unknown> = {}) {
  return prisma.user.create({
    data: { name, email: `${name.toLowerCase()}@x.com`, passwordHash: 'x', role: role as never, ...extra },
  })
}

/** Quem lidera quem sai do líder direto (`managerId`), como no organograma. */
async function leadWithMember() {
  const lead = await makeUser('Lider', 'LEAD')
  const member = await makeUser('Liderado', 'LEGEND', { managerId: lead.id })
  return { lead, member }
}

describe('createVacation', () => {
  it('cria o período para um liderado', async () => {
    const { lead, member } = await leadWithMember()
    const dto = await createVacation(lead.id, {
      userId: member.id, startDate: '2026-08-03', endDate: '2026-08-14', note: 'Férias',
    })
    expect(dto).toMatchObject({ startDate: '2026-08-03', endDate: '2026-08-14', note: 'Férias' })
    expect(dto.user.id).toBe(member.id)
  })

  it('ADMIN lança para qualquer um da empresa', async () => {
    const admin = await makeUser('Admin', 'ADMIN')
    const alguem = await makeUser('Alguem', 'LEGEND')
    const dto = await createVacation(admin.id, {
      userId: alguem.id, startDate: '2026-09-01', endDate: '2026-09-05', note: null,
    })
    expect(dto.user.id).toBe(alguem.id)
  })

  it('recusa quem não gerencia o alvo (403)', async () => {
    const lead = await makeUser('Lider2', 'LEAD')
    const estranho = await makeUser('Estranho', 'LEGEND')
    await expect(
      createVacation(lead.id, { userId: estranho.id, startDate: '2026-08-03', endDate: '2026-08-14', note: null }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it('recusa fim antes do início (400)', async () => {
    const { lead, member } = await leadWithMember()
    await expect(
      createVacation(lead.id, { userId: member.id, startDate: '2026-08-14', endDate: '2026-08-03', note: null }),
    ).rejects.toBeInstanceOf(VacationError)
  })

  it('recusa período que sobrepõe outro da mesma pessoa (400)', async () => {
    const { lead, member } = await leadWithMember()
    await createVacation(lead.id, { userId: member.id, startDate: '2026-08-03', endDate: '2026-08-14', note: null })
    await expect(
      createVacation(lead.id, { userId: member.id, startDate: '2026-08-14', endDate: '2026-08-20', note: null }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('aceita período colado no anterior sem sobrepor', async () => {
    const { lead, member } = await leadWithMember()
    await createVacation(lead.id, { userId: member.id, startDate: '2026-08-03', endDate: '2026-08-14', note: null })
    const segundo = await createVacation(lead.id, {
      userId: member.id, startDate: '2026-08-15', endDate: '2026-08-20', note: null,
    })
    expect(segundo.startDate).toBe('2026-08-15')
  })
})

describe('updateVacation', () => {
  it('edita ignorando o próprio registro na checagem de sobreposição', async () => {
    const { lead, member } = await leadWithMember()
    const dto = await createVacation(lead.id, { userId: member.id, startDate: '2026-08-03', endDate: '2026-08-14', note: null })
    const editado = await updateVacation(lead.id, dto.id, { endDate: '2026-08-18' })
    expect(editado.endDate).toBe('2026-08-18')
  })

  it('recusa edição de quem não gerencia o alvo (403)', async () => {
    const { lead, member } = await leadWithMember()
    const outro = await makeUser('Outro', 'LEGEND')
    const dto = await createVacation(lead.id, { userId: member.id, startDate: '2026-08-03', endDate: '2026-08-14', note: null })
    await expect(updateVacation(outro.id, dto.id, { endDate: '2026-08-18' })).rejects.toMatchObject({ status: 403 })
  })
})

describe('deleteVacation', () => {
  it('remove o período', async () => {
    const { lead, member } = await leadWithMember()
    const dto = await createVacation(lead.id, { userId: member.id, startDate: '2026-08-03', endDate: '2026-08-14', note: null })
    await deleteVacation(lead.id, dto.id)
    expect(await prisma.vacation.count()).toBe(0)
  })
})

describe('listSectorVacations', () => {
  it('traz só quem intersecta o intervalo, do mesmo setor', async () => {
    const { lead, member } = await leadWithMember()
    await createVacation(lead.id, { userId: member.id, startDate: '2026-08-03', endDate: '2026-08-14', note: null })
    await createVacation(lead.id, { userId: member.id, startDate: '2026-12-01', endDate: '2026-12-10', note: null })

    const agosto = await listSectorVacations(lead.id, lead.sectorId, '2026-08-01', '2026-08-31')
    expect(agosto.map((v) => v.startDate)).toEqual(['2026-08-03'])
  })

  it('inclui período que começa antes e termina depois da janela', async () => {
    const { lead, member } = await leadWithMember()
    await createVacation(lead.id, { userId: member.id, startDate: '2026-07-20', endDate: '2026-08-10', note: null })
    const agosto = await listSectorVacations(lead.id, lead.sectorId, '2026-08-01', '2026-08-31')
    expect(agosto).toHaveLength(1)
  })

  it('não vaza férias de outro setor', async () => {
    const { lead, member } = await leadWithMember()
    const outroSetor = await prisma.sector.create({ data: { name: 'Outro', slug: 'outro' } })
    await prisma.user.update({ where: { id: member.id }, data: { sectorId: outroSetor.id } })
    await createVacation(lead.id, { userId: member.id, startDate: '2026-08-03', endDate: '2026-08-14', note: null })

    expect(await listSectorVacations(lead.id, lead.sectorId, '2026-08-01', '2026-08-31')).toEqual([])
  })

  it('não vaza férias de outra empresa mesmo passando o sectorId de lá diretamente', async () => {
    // Empresa A (default): viewer que vai consultar.
    const { lead: leadA } = await leadWithMember()

    // Empresa B: setor e liderado próprios, com um período de férias.
    const companyB = await prisma.company.create({
      data: { name: 'Empresa B Vacation Test', slug: 'empresa-b-vacation-test' },
    })
    const sectorB = await prisma.sector.create({
      data: { name: 'Setor B Vacation Test', slug: 'setor-b-vacation-test', companyId: companyB.id },
    })
    const leadB = await makeUser('LiderB', 'LEAD', { companyId: companyB.id, sectorId: sectorB.id })
    const memberB = await makeUser('LideradoB', 'LEGEND', {
      companyId: companyB.id,
      sectorId: sectorB.id,
      managerId: leadB.id,
    })
    await createVacation(leadB.id, {
      userId: memberB.id, startDate: '2026-08-03', endDate: '2026-08-14', note: null,
    })

    // O viewer é da empresa A, mas passa o sectorId da empresa B — isolamento por
    // empresa não pode depender de o setor "por acaso" só ter gente da própria empresa.
    expect(await listSectorVacations(leadA.id, sectorB.id, '2026-08-01', '2026-08-31')).toEqual([])
  })
})

describe('listTeamVacations', () => {
  // Data relativa a hoje, e não cravada: `listTeamVacations` só devolve período
  // futuro ou em curso, então uma data fixa passa até a virar passado — foi o
  // que aconteceu em 15/08/2026 com o período 03/08–14/08.
  it('agrupa os liderados com seus períodos', async () => {
    const { lead, member } = await leadWithMember()
    const { ymd: hoje } = todayInSaoPaulo()
    const inicio = addDays(hoje, 7)
    await createVacation(lead.id, { userId: member.id, startDate: inicio, endDate: addDays(hoje, 18), note: null })

    const { groups } = await listTeamVacations(lead.id)
    expect(groups).toHaveLength(1)
    expect(groups[0].members[0].user.id).toBe(member.id)
    expect(groups[0].members[0].vacations.map((v) => v.startDate)).toEqual([inicio])
  })

  it('devolve vazio para quem não lidera ninguém', async () => {
    const legend = await makeUser('Lenda', 'LEGEND')
    expect((await listTeamVacations(legend.id)).groups).toEqual([])
  })

  it('só traz períodos futuros: um já encerrado some, um em curso aparece', async () => {
    const { lead, member } = await leadWithMember()
    const { ymd: hoje } = todayInSaoPaulo()
    await createVacation(lead.id, {
      userId: member.id, startDate: addDays(hoje, -30), endDate: addDays(hoje, -20), note: 'Já passou',
    })
    await createVacation(lead.id, {
      userId: member.id, startDate: addDays(hoje, -1), endDate: addDays(hoje, 1), note: 'Em curso',
    })

    const { groups } = await listTeamVacations(lead.id)
    expect(groups[0].members[0].vacations.map((v) => v.note)).toEqual(['Em curso'])
  })
})

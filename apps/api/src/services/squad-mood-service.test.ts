import { describe, it, expect } from 'vitest'
import { prisma } from '../lib/prisma'
import type { UserRole } from '@legends/shared'
import { getTeamMoodGroups, getMemberMoodHistory, MoodAccessError } from './squad-mood-service'

/**
 * O escopo de "meu time" é o líder direto (`managerId`) — a mesma cadeia do
 * organograma. Squad e área não dão mais acesso; ver `team-scope-service`.
 */
async function mkUser(
  name: string,
  email: string,
  role: UserRole = 'LEGEND',
  extra: Record<string, unknown> = {},
) {
  return prisma.user.create({ data: { name, email, passwordHash: 'x', role, ...extra } })
}

function dateOf(ymd: string) {
  return new Date(ymd) // UTC midnight, compatível com @db.Date
}

describe('squad-mood-service', () => {
  it('lista os liderados diretos com o humor atual de cada um (sem o próprio líder)', async () => {
    const lead = await mkUser('Lia', 'lia@x.com', 'LEAD')
    const ana = await mkUser('Ana', 'ana@x.com', 'LEGEND', { managerId: lead.id })
    await mkUser('Bob', 'bob@x.com', 'LEGEND', { managerId: lead.id })
    await prisma.moodEntry.create({ data: { userId: ana.id, day: dateOf('2026-06-20'), mood: 'GOOD', note: 'ok' } })
    await prisma.moodEntry.create({ data: { userId: ana.id, day: dateOf('2026-06-22'), mood: 'GREAT', note: null } })
    // Bob sem registro.

    const result = await getTeamMoodGroups(lead.id)
    expect(result).toHaveLength(1)
    expect(result[0].squadName).toBe('Meu time')
    const names = result[0].members.map((m) => m.name).sort()
    expect(names).toEqual(['Ana', 'Bob'])
    expect(names).not.toContain('Lia')
    const anaDto = result[0].members.find((m) => m.name === 'Ana')!
    expect(anaDto.currentMood).toEqual({ day: '2026-06-22', mood: 'GREAT', note: null })
    const bobDto = result[0].members.find((m) => m.name === 'Bob')!
    expect(bobDto.currentMood).toBeNull()
  })

  it('histórico paginado por dia desc, com cursor', async () => {
    const lead = await mkUser('Lia2', 'lia2@x.com')
    const ana = await mkUser('Ana2', 'ana2@x.com', 'LEGEND', { managerId: lead.id })
    for (const d of ['2026-06-18', '2026-06-19', '2026-06-20', '2026-06-21', '2026-06-22']) {
      await prisma.moodEntry.create({ data: { userId: ana.id, day: dateOf(d), mood: 'NEUTRAL', note: d } })
    }
    const page1 = await getMemberMoodHistory(lead.id, ana.id, null, 2)
    expect(page1.entries.map((e) => e.day)).toEqual(['2026-06-22', '2026-06-21'])
    expect(page1.nextCursor).toBe('2026-06-21')

    const page2 = await getMemberMoodHistory(lead.id, ana.id, page1.nextCursor, 2)
    expect(page2.entries.map((e) => e.day)).toEqual(['2026-06-20', '2026-06-19'])
    expect(page2.nextCursor).toBe('2026-06-19')

    const page3 = await getMemberMoodHistory(lead.id, ana.id, page2.nextCursor, 2)
    expect(page3.entries.map((e) => e.day)).toEqual(['2026-06-18'])
    expect(page3.nextCursor).toBeNull()
  })

  it('nega histórico se o requisitante não lidera o alvo (403)', async () => {
    const lead = await mkUser('Lia3', 'lia3@x.com')
    const outroLead = await mkUser('Léo', 'leo@x.com')
    const ana = await mkUser('Ana3', 'ana3@x.com', 'LEGEND', { managerId: lead.id })

    await expect(getMemberMoodHistory(outroLead.id, ana.id, null, 10)).rejects.toMatchObject({
      name: 'MoodAccessError',
      status: 403,
    })
    expect(MoodAccessError).toBeDefined()
  })

  it('squad liderada não dá mais acesso ao humor do time', async () => {
    const lead = await mkUser('Lia4', 'lia4@x.com', 'LEAD')
    const ana = await mkUser('Ana4', 'ana4@x.com')
    const squad = await prisma.squad.create({ data: { name: 'Alpha', slug: 'alpha', leaderId: lead.id } })
    await prisma.squadMember.create({ data: { squadId: squad.id, userId: ana.id } })
    await prisma.moodEntry.create({ data: { userId: ana.id, day: dateOf('2026-06-22'), mood: 'GOOD', note: null } })

    expect(await getTeamMoodGroups(lead.id)).toHaveLength(0)
    await expect(getMemberMoodHistory(lead.id, ana.id, null, 10)).rejects.toMatchObject({
      name: 'MoodAccessError',
      status: 403,
    })
  })

  it('o painel é de quem tem liderado direto, seja qual for o papel ou a área', async () => {
    const head = await mkUser('Heitor', 'heitor@x.com', 'HEAD', { area: 'ENGINEERING' })
    const devEng = await mkUser('Dev Eng', 'deveng@x.com', 'LEGEND', { area: 'ENGINEERING', managerId: head.id })
    await mkUser('Dev Prod', 'devprod@x.com', 'LEGEND', { area: 'PRODUCT', managerId: head.id })
    await mkUser('Fora do time', 'fora@x.com', 'LEGEND', { area: 'ENGINEERING' })
    await prisma.moodEntry.create({ data: { userId: devEng.id, day: dateOf('2026-06-22'), mood: 'LOW', note: 'cansado' } })

    // HEAD não tinha painel nenhum na regra antiga; a área em comum, que dava
    // acesso ao MANAGER, agora não vale por si.
    const groups = await getTeamMoodGroups(head.id)
    expect(groups).toHaveLength(1)
    expect(groups[0].squadName).toBe('Meu time')
    expect(groups[0].members.map((m) => m.name).sort()).toEqual(['Dev Eng', 'Dev Prod'])
    const dto = groups[0].members.find((m) => m.name === 'Dev Eng')!
    expect(dto.currentMood).toEqual({ day: '2026-06-22', mood: 'LOW', note: 'cansado' })
  })

  it('quem não tem liderado direto não tem painel', async () => {
    const semTime = await mkUser('Gabi2', 'gabi2@x.com', 'MANAGER', { area: 'ENGINEERING' })
    await mkUser('Dev', 'devx@x.com', 'LEGEND', { area: 'ENGINEERING' })
    expect(await getTeamMoodGroups(semTime.id)).toEqual([])
  })

  it('alcança o histórico de quem está dois níveis abaixo, mas não de quem está fora da subárvore', async () => {
    const head = await mkUser('Gabi3', 'gabi3@x.com', 'HEAD')
    const meio = await mkUser('Meio', 'meio@x.com', 'MANAGER', { managerId: head.id })
    const base = await mkUser('Base', 'base@x.com', 'LEGEND', { managerId: meio.id })
    const fora = await mkUser('Fora', 'fora-subarvore@x.com', 'LEGEND')
    await prisma.moodEntry.create({ data: { userId: base.id, day: dateOf('2026-06-22'), mood: 'GOOD', note: null } })

    const page = await getMemberMoodHistory(head.id, base.id, null, 10)
    expect(page.entries.map((e) => e.day)).toEqual(['2026-06-22'])

    await expect(getMemberMoodHistory(head.id, fora.id, null, 10)).rejects.toMatchObject({
      name: 'MoodAccessError',
      status: 403,
    })
  })

  it('não vê liderado de outra empresa, mesmo apontando para o líder (dashboard)', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Mood', slug: 'outra-empresa-mood-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor externo', slug: 'setor-externo-mood-test', companyId: otherCompany.id },
    })
    const lider = await mkUser('Gabi4', 'gabi4@x.com', 'MANAGER')
    const devOutraEmpresa = await prisma.user.create({
      data: {
        name: 'Dev Outra Empresa',
        email: 'dev-outra-empresa-mood@x.com',
        passwordHash: 'x',
        role: 'LEGEND',
        companyId: otherCompany.id,
        sectorId: otherSector.id,
        managerId: lider.id,
      },
    })
    await prisma.moodEntry.create({ data: { userId: devOutraEmpresa.id, day: dateOf('2026-06-22'), mood: 'GOOD', note: null } })

    const groups = await getTeamMoodGroups(lider.id)
    const allNames = groups.flatMap((g) => g.members.map((m) => m.name))
    expect(allNames).not.toContain('Dev Outra Empresa')
  })

  it('não vê histórico de quem é de outra empresa, mesmo apontando para o líder (403)', async () => {
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Mood2', slug: 'outra-empresa-mood2-test' } })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor externo 2', slug: 'setor-externo-mood2-test', companyId: otherCompany.id },
    })
    const lider = await mkUser('Gabi5', 'gabi5@x.com', 'MANAGER')
    const devOutraEmpresa = await prisma.user.create({
      data: {
        name: 'Dev Outra Empresa2',
        email: 'dev-outra-empresa-mood2@x.com',
        passwordHash: 'x',
        role: 'LEGEND',
        companyId: otherCompany.id,
        sectorId: otherSector.id,
        managerId: lider.id,
      },
    })
    await prisma.moodEntry.create({ data: { userId: devOutraEmpresa.id, day: dateOf('2026-06-22'), mood: 'GOOD', note: null } })

    await expect(getMemberMoodHistory(lider.id, devOutraEmpresa.id, null, 10)).rejects.toMatchObject({
      name: 'MoodAccessError',
      status: 403,
    })
  })

  it('getMemberMoodHistory não retorna entrada com companyId divergente do alvo (defesa em profundidade)', async () => {
    const lead = await mkUser('LiaDefesaEmpresa', 'lia-defesa-empresa@x.com')
    const ana = await mkUser('AnaDefesaEmpresa', 'ana-defesa-empresa@x.com', 'LEGEND', { managerId: lead.id })
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Squad Mood', slug: 'outra-empresa-squad-mood-test' } })
    await prisma.moodEntry.create({ data: { userId: ana.id, day: dateOf('2026-06-22'), mood: 'GOOD', note: null, companyId: otherCompany.id } })

    const page = await getMemberMoodHistory(lead.id, ana.id, null, 10)
    expect(page.entries).toHaveLength(0)
  })
})

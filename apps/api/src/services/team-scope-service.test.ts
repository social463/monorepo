import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { listManagedGroups, managesUser } from './team-scope-service'

async function makeUser(name: string, role: string, extra: Record<string, unknown> = {}) {
  return prisma.user.create({
    data: { name, email: `${name.toLowerCase()}@x.com`, passwordHash: 'x', role: role as never, ...extra },
  })
}

describe('managesUser', () => {
  it('lidera quem aponta para ele como líder direto, qualquer que seja o papel', async () => {
    const head = await makeUser('Head', 'HEAD')
    const direto = await makeUser('Direto', 'LEGEND', { managerId: head.id })

    // HEAD não gerenciava ninguém na regra antiga (squad/área); com o líder
    // direto, quem tem gente apontando para si lidera.
    expect(await managesUser(head.id, direto.id)).toBe(true)
  })

  it('alcança a subárvore inteira, não só o primeiro nível', async () => {
    const head = await makeUser('HeadFundo', 'HEAD')
    const meio = await makeUser('Meio', 'MANAGER', { managerId: head.id })
    const base = await makeUser('Base', 'LEGEND', { managerId: meio.id })

    // Autorizar é fundo (líder de líderes lança férias de quem está embaixo),
    // ainda que a listagem seja rasa.
    expect(await managesUser(head.id, base.id)).toBe(true)
    expect(await managesUser(base.id, head.id)).toBe(false)
  })

  it('não lidera quem responde a outra pessoa, nem a si mesmo', async () => {
    const lider = await makeUser('LiderA', 'MANAGER')
    const outroLider = await makeUser('LiderB', 'MANAGER')
    const alheio = await makeUser('Alheio', 'LEGEND', { managerId: outroLider.id })

    expect(await managesUser(lider.id, alheio.id)).toBe(false)
    expect(await managesUser(lider.id, lider.id)).toBe(false)
  })

  it('não lidera quem saiu da cadeia de comando', async () => {
    const lider = await makeUser('LiderC', 'MANAGER')
    const desligado = await makeUser('Desligado', 'LEGEND', { managerId: lider.id, leftAt: new Date() })
    const inativo = await makeUser('Inativo', 'LEGEND', { managerId: lider.id, active: false })
    const terceiro = await makeUser('Terceiro', 'THIRD_PARTY', { managerId: lider.id })

    expect(await managesUser(lider.id, desligado.id)).toBe(false)
    expect(await managesUser(lider.id, inativo.id)).toBe(false)
    expect(await managesUser(lider.id, terceiro.id)).toBe(false)
  })

  it('o elo se rompe num líder intermediário que saiu, como no organograma', async () => {
    const head = await makeUser('HeadRompido', 'HEAD')
    const meioSaiu = await makeUser('MeioSaiu', 'MANAGER', { managerId: head.id, active: false })
    const base = await makeUser('BaseSolta', 'LEGEND', { managerId: meioSaiu.id })

    // A subárvore do desligado vira raiz no organograma; aqui ela também
    // deixa de responder ao head.
    expect(await managesUser(head.id, base.id)).toBe(false)
  })

  it('não entra em laço quando a hierarquia gravada tem ciclo', async () => {
    const a = await makeUser('CicloA', 'MANAGER')
    const b = await makeUser('CicloB', 'MANAGER', { managerId: a.id })
    await prisma.user.update({ where: { id: a.id }, data: { managerId: b.id } })
    const fora = await makeUser('ForaDoCiclo', 'MANAGER')

    expect(await managesUser(a.id, b.id)).toBe(true)
    expect(await managesUser(fora.id, b.id)).toBe(false)
  })

  it('squad liderada e área em comum não dão mais escopo', async () => {
    const lead = await makeUser('LeadSquad', 'LEAD', { area: 'ENGINEERING' })
    const membro = await makeUser('MembroSquad', 'LEGEND', { area: 'ENGINEERING' })
    const squad = await prisma.squad.create({ data: { name: 'Squad A', slug: 'squad-a', leaderId: lead.id } })
    await prisma.squadMember.create({ data: { squadId: squad.id, userId: membro.id } })

    // Sem `managerId`, nem a squad nem a área bastam: era por aqui que "meu
    // time" divergia do organograma.
    expect(await managesUser(lead.id, membro.id)).toBe(false)
  })
})

describe('listManagedGroups', () => {
  it('devolve um grupo com os liderados diretos, em ordem de nome', async () => {
    const lider = await makeUser('LiderLista', 'HEAD')
    const bruno = await makeUser('Bruno', 'LEAD', { managerId: lider.id })
    const ana = await makeUser('Ana', 'LEGEND', { managerId: lider.id })
    // Neto: aparece na autorização, não na listagem.
    const neto = await makeUser('Neto', 'LEGEND', { managerId: bruno.id })

    const groups = await listManagedGroups(lider.id)
    expect(groups).toHaveLength(1)
    expect(groups[0].groupId).toBe(`manager:${lider.id}`)
    expect(groups[0].groupName).toBe('Meu time')
    expect(groups[0].members.map((m) => m.id)).toEqual([ana.id, bruno.id])
    expect(await managesUser(lider.id, neto.id)).toBe(true)
  })

  it('não devolve grupo para quem não tem liderado direto', async () => {
    const sozinha = await makeUser('Sozinha', 'MANAGER', { area: 'ENGINEERING' })
    await makeUser('MesmaArea', 'LEGEND', { area: 'ENGINEERING' })

    // A área inteira era o grupo do MANAGER na regra antiga.
    expect(await listManagedGroups(sozinha.id)).toEqual([])
  })

  it('deixa de fora quem não está na cadeia de comando', async () => {
    const inactiveSector = await prisma.sector.create({
      data: {
        name: 'Setor inativo',
        slug: 'setor-inativo-team-scope-test',
        active: false,
        companyId: DEFAULT_COMPANY_ID,
      },
    })
    const lider = await makeUser('LiderFiltro', 'HEAD')
    const valido = await makeUser('Valido', 'LEGEND', { managerId: lider.id })
    await makeUser('AdminSubordinado', 'ADMIN', { managerId: lider.id })
    await makeUser('TerceiroSubordinado', 'THIRD_PARTY', { managerId: lider.id })
    await makeUser('SetorInativo', 'LEGEND', { managerId: lider.id, sectorId: inactiveSector.id })

    const groups = await listManagedGroups(lider.id)
    expect(groups[0].members.map((m) => m.id)).toEqual([valido.id])
  })
})

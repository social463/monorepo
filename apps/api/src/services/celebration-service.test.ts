import { describe, it, expect } from 'vitest'
import type { UserRole } from '@legends/shared'
import { DEFAULT_SECTOR_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { getCelebrations } from './celebration-service'

/** Data civil como Date à meia-noite UTC — o formato que `@db.Date` devolve. */
function dateOf(ymd: string) {
  return new Date(`${ymd}T00:00:00.000Z`)
}

async function mkUser(
  name: string,
  email: string,
  birthDate: string | null,
  extra: { role?: UserRole; active?: boolean; leftAt?: Date; sectorId?: string; joinedAt?: string } = {},
) {
  return prisma.user.create({
    data: {
      name,
      email,
      passwordHash: 'x',
      role: extra.role ?? 'LEGEND',
      active: extra.active ?? true,
      leftAt: extra.leftAt,
      sectorId: extra.sectorId ?? DEFAULT_SECTOR_ID,
      birthDate: birthDate ? dateOf(birthDate) : null,
      // Padrão longe de julho/fevereiro, para não virar aniversário de casa sem querer.
      joinedAt: dateOf(extra.joinedAt ?? '2020-10-05'),
    },
  })
}

/** Meio-dia UTC de `ymd` — mesma data civil em America/Sao_Paulo (UTC-3). */
function noonAt(ymd: string) {
  return new Date(`${ymd}T12:00:00.000Z`)
}

describe('celebration-service — próximos aniversários de nascimento', () => {
  it('separa o mês do "próximos" e ordena o mês por dia', async () => {
    const viewer = await mkUser('Quem Olha', 'v@x.com', null)
    const hoje = await mkUser('Faz Hoje', 'hoje@x.com', '1990-07-15')
    const antes = await mkUser('Fez Dia 3', 'antes@x.com', '1991-07-03')
    const depois = await mkUser('Faz Dia 28', 'depois@x.com', '1992-07-28')
    const outroMes = await mkUser('Outro Mês', 'outro@x.com', '1993-08-15')

    const { birthdays, referenceDay } = await getCelebrations(viewer.id, noonAt('2026-07-15'))

    expect(referenceDay).toBe('2026-07-15')
    // "Fez Dia 3" já passou este ano (03/07 < 15/07): vira a 4ª data mais
    // próxima (2027-07-03) e fica de fora dos "próximos" — mas continua no mês.
    expect(birthdays.month.map((b) => b.user.id)).toEqual([antes.id, hoje.id, depois.id])
    expect(birthdays.month.some((b) => b.user.id === outroMes.id)).toBe(false)
    expect(birthdays.month.some((b) => b.user.id === viewer.id)).toBe(false)

    // "próximos" cruza mês, mas dentro da janela de 15 dias: hoje (0d) e
    // depois (13d) entram; agosto (31d) fica fora da janela e "antes", que já
    // passou, fica fora por ter rolado para o ano seguinte.
    expect(birthdays.upcoming.map((b) => b.user.id)).toEqual([hoje.id, depois.id])
    expect(birthdays.upcoming.map((b) => b.daysUntil)).toEqual([0, 13])
    expect(birthdays.upcoming.some((b) => b.user.id === antes.id)).toBe(false)
    expect(birthdays.upcoming.some((b) => b.user.id === outroMes.id)).toBe(false)
  })

  it('expõe só dia e mês (o ano de nascimento não trafega)', async () => {
    const viewer = await mkUser('Quem Olha', 'v@x.com', null)
    await mkUser('Aniversariante', 'a@x.com', '1988-07-10')

    const { birthdays } = await getCelebrations(viewer.id, noonAt('2026-07-10'))

    expect(birthdays.upcoming).toHaveLength(1)
    expect(birthdays.upcoming[0].day).toBe(10)
    expect(birthdays.upcoming[0].month).toBe(7)
    expect(birthdays.upcoming[0].daysUntil).toBe(0)
    expect(JSON.stringify(birthdays.upcoming[0])).not.toContain('1988')
  })

  it('inclui o próprio viewer quando é o aniversário dele hoje', async () => {
    const viewer = await mkUser('Quem Olha', 'v@x.com', '1990-07-15')

    const { birthdays } = await getCelebrations(viewer.id, noonAt('2026-07-15'))

    expect(birthdays.upcoming.map((b) => b.user.id)).toEqual([viewer.id])
    expect(birthdays.upcoming[0].daysUntil).toBe(0)
  })

  // A virada de ano é observável dentro da janela quando a data cai logo depois
  // do Réveillon — antes da janela existir, dava para vê-la a 300 dias.
  it('quando a data já passou este ano, calcula a próxima ocorrência no ano seguinte', async () => {
    const viewer = await mkUser('Quem Olha', 'v@x.com', null)
    const viraOAno = await mkUser('Vira o Ano', 'p@x.com', '1990-01-05')

    const { birthdays } = await getCelebrations(viewer.id, noonAt('2026-12-28'))

    expect(birthdays.upcoming.map((b) => b.user.id)).toEqual([viraOAno.id])
    expect(birthdays.upcoming[0]).toMatchObject({ day: 5, month: 1, observedDate: '2027-01-05', daysUntil: 8 })
  })

  // Sem a janela, uma empresa pequena em mês vazio mostrava aniversário de dois
  // meses adiante como se fosse notícia.
  it('não traz "próximos" fora da janela de 15 dias, nem quando sobram vagas', async () => {
    const viewer = await mkUser('Quem Olha', 'v@x.com', null)
    const dentro = await mkUser('No Limite', 'd@x.com', '1990-07-30')
    await mkUser('Um Dia Depois', 'f@x.com', '1991-07-31')

    const { birthdays } = await getCelebrations(viewer.id, noonAt('2026-07-15'))

    // 30/07 são exatamente 15 dias: a janela é inclusiva. 31/07 são 16.
    expect(birthdays.upcoming.map((b) => b.user.id)).toEqual([dentro.id])
    expect(birthdays.upcoming[0].daysUntil).toBe(15)
  })

  it('comemora 29/02 em 28/02 nos anos não bissextos, e no dia certo nos bissextos', async () => {
    const viewer = await mkUser('Quem Olha', 'v@x.com', null)
    const bissexto = await mkUser('Nasceu em 29/02', 'b@x.com', '1992-02-29')

    // 2026 não é bissexto: aparece em 28/02.
    const em28 = await getCelebrations(viewer.id, noonAt('2026-02-28'))
    expect(em28.birthdays.upcoming.map((b) => b.user.id)).toEqual([bissexto.id])
    expect(em28.birthdays.upcoming[0]).toMatchObject({ day: 29, daysUntil: 0, observedDate: '2026-02-28' })

    // 2028 é bissexto: em 28/02 ainda não chegou (comemora em 29), falta 1 dia.
    const em28Bissexto = await getCelebrations(viewer.id, noonAt('2028-02-28'))
    expect(em28Bissexto.birthdays.upcoming.some((b) => b.daysUntil === 0)).toBe(false)
    expect(em28Bissexto.birthdays.upcoming.map((b) => b.user.id)).toEqual([bissexto.id])
    expect(em28Bissexto.birthdays.upcoming[0]).toMatchObject({ daysUntil: 1, observedDate: '2028-02-29' })

    // No dia 29/02 bissexto, cai exatamente em cima.
    const em29Bissexto = await getCelebrations(viewer.id, noonAt('2028-02-29'))
    expect(em29Bissexto.birthdays.upcoming.map((b) => b.user.id)).toEqual([bissexto.id])
    expect(em29Bissexto.birthdays.upcoming[0]).toMatchObject({ daysUntil: 0, observedDate: '2028-02-29' })
  })

  it('mostra todo mundo de uma data mesmo quando passa de 3 pessoas — o corte é por data, não por pessoa', async () => {
    const viewer = await mkUser('Quem Olha', 'v@x.com', null)
    const d1 = await mkUser('Dia Um', 'd1@x.com', '1990-07-16') // 1ª data: 1 dia
    const p1 = await mkUser('Ana', 'p1@x.com', '1990-07-20') // 2ª data: 4 pessoas
    const p2 = await mkUser('Bruno', 'p2@x.com', '1991-07-20')
    const p3 = await mkUser('Carla', 'p3@x.com', '1992-07-20')
    const p4 = await mkUser('Duda', 'p4@x.com', '1993-07-20')
    const c1 = await mkUser('Elias', 'c1@x.com', '1990-07-29') // 3ª data
    const fora = await mkUser('Fica De Fora', 'fora@x.com', '1990-09-01') // fora da janela

    const { birthdays } = await getCelebrations(viewer.id, noonAt('2026-07-15'))

    expect(birthdays.upcoming.map((b) => b.user.id)).toEqual([d1.id, p1.id, p2.id, p3.id, p4.id, c1.id])
    expect(birthdays.upcoming.some((b) => b.user.id === fora.id)).toBe(false)
  })

  it('ignora inativos, ex-lendas, admins e terceirizados', async () => {
    const viewer = await mkUser('Quem Olha', 'v@x.com', null)
    await mkUser('Inativo', 'i@x.com', '1990-07-15', { active: false })
    await mkUser('Ex Lenda', 'e@x.com', '1990-07-15', { leftAt: new Date('2026-01-01') })
    await mkUser('Admin', 'ad@x.com', '1990-07-15', { role: 'ADMIN' })
    await mkUser('Subadmin', 'sub@x.com', '1990-07-15', { role: 'SUBADMIN' })
    await mkUser('Terceirizado', 't@x.com', '1990-07-15', { role: 'THIRD_PARTY' })
    const lenda = await mkUser('Lenda', 'l@x.com', '1990-07-15')

    const { birthdays } = await getCelebrations(viewer.id, noonAt('2026-07-15'))

    expect(birthdays.upcoming.map((b) => b.user.id)).toEqual([lenda.id])
  })

  it('mostra colegas de todos os setores da empresa', async () => {
    const outroSetor = await prisma.sector.create({ data: { id: 'sector-outro', name: 'Outro', slug: 'outro' } })
    const viewer = await mkUser('Quem Olha', 'v@x.com', null)
    const mesmoSetor = await mkUser('Mesmo Setor', 'm@x.com', '1990-07-15')
    const outro = await mkUser('Outro Setor', 'o@x.com', '1990-07-15', { sectorId: outroSetor.id })

    const { birthdays } = await getCelebrations(viewer.id, noonAt('2026-07-15'))

    expect(birthdays.upcoming.map((b) => b.user.id).sort()).toEqual([mesmoSetor.id, outro.id].sort())
    // Cruzando setores, o nome do setor é o que distingue colega de outro time na tela.
    expect(birthdays.upcoming.find((b) => b.user.id === outro.id)?.user.sectorName).toBe('Outro')
  })

  it('terceirizado continua vendo só o próprio setor', async () => {
    const outroSetor = await prisma.sector.create({ data: { id: 'sector-outro', name: 'Outro', slug: 'outro' } })
    const viewer = await mkUser('Terceirizado', 'v@x.com', null, { role: 'THIRD_PARTY' })
    const mesmoSetor = await mkUser('Mesmo Setor', 'm@x.com', '1990-07-15')
    await mkUser('Outro Setor', 'o@x.com', '1990-07-15', { sectorId: outroSetor.id })

    const { birthdays } = await getCelebrations(viewer.id, noonAt('2026-07-15'))

    expect(birthdays.upcoming.map((b) => b.user.id)).toEqual([mesmoSetor.id])
  })
})

describe('celebration-service — próximos aniversários de casa', () => {
  it('conta os anos completos no mês e nos "próximos", cruzando mês e ano', async () => {
    const viewer = await mkUser('Quem Olha', 'v@x.com', null, { joinedAt: '2020-01-02' })
    const tresAnos = await mkUser('Três Anos', 'tres@x.com', null, { joinedAt: '2023-07-15' })
    const umAno = await mkUser('Um Ano', 'um@x.com', null, { joinedAt: '2025-07-15' })
    const outroDia = await mkUser('Outro Dia', 'od@x.com', null, { joinedAt: '2022-07-03' })
    const outroMes = await mkUser('Outro Mês', 'om@x.com', null, { joinedAt: '2022-08-15' })

    const { workAnniversaries } = await getCelebrations(viewer.id, noonAt('2026-07-15'))

    // Ordem alfabética dentro do mesmo dia: "Três Anos" antes de "Um Ano".
    expect(workAnniversaries.month.map((w) => w.user.id)).toEqual([outroDia.id, tresAnos.id, umAno.id])
    expect(workAnniversaries.month.some((w) => w.user.id === outroMes.id)).toBe(false)

    // "próximos" dentro da janela de 15 dias: só hoje (tresAnos+umAno, 0d).
    // Agosto (31d) e o aniversário de casa do viewer (2027-01-02) ficam fora,
    // assim como "Outro Dia" (03/07), que já passou este ano.
    expect(workAnniversaries.upcoming.map((w) => [w.user.id, w.years, w.daysUntil])).toEqual([
      [tresAnos.id, 3, 0],
      [umAno.id, 1, 0],
    ])
    expect(workAnniversaries.upcoming.some((w) => w.user.id === outroMes.id)).toBe(false)
    expect(workAnniversaries.upcoming.some((w) => w.user.id === outroDia.id)).toBe(false)
  })

  it('empurra quem completaria 0 anos hoje para o próximo aniversário válido', async () => {
    const viewer = await mkUser('Quem Olha', 'v@x.com', null, { joinedAt: '2020-01-02' })
    const novo = await mkUser('Entrou Hoje', 'novo@x.com', null, { joinedAt: '2026-07-15' })

    const { workAnniversaries } = await getCelebrations(viewer.id, noonAt('2026-07-15'))

    // Ninguém completa aniversário de casa hoje: quem entrou hoje é empurrado
    // para 2027, que está fora da janela de 15 dias.
    expect(workAnniversaries.upcoming.some((w) => w.daysUntil === 0)).toBe(false)
    expect(workAnniversaries.upcoming.some((w) => w.user.id === novo.id)).toBe(false)
  })

  it('inclui o próprio viewer no aniversário de casa dele hoje', async () => {
    const viewer = await mkUser('Quem Olha', 'v@x.com', null, { joinedAt: '2021-07-15' })

    const { workAnniversaries } = await getCelebrations(viewer.id, noonAt('2026-07-15'))

    const entry = workAnniversaries.upcoming.find((w) => w.user.id === viewer.id)
    expect(entry).toMatchObject({ years: 5, daysUntil: 0 })
  })

  it('aplica as mesmas exclusões dos aniversários de nascimento', async () => {
    const viewer = await mkUser('Quem Olha', 'v@x.com', null, { joinedAt: '2020-01-02' })
    await mkUser('Ex Lenda', 'e@x.com', null, { joinedAt: '2022-07-15', leftAt: new Date('2026-01-01') })
    await mkUser('Admin', 'ad@x.com', null, { joinedAt: '2022-07-15', role: 'ADMIN' })
    const lenda = await mkUser('Lenda', 'l@x.com', null, { joinedAt: '2022-07-15' })

    const { workAnniversaries } = await getCelebrations(viewer.id, noonAt('2026-07-15'))

    // Sobra só a lenda, que faz hoje: o aniversário de casa do viewer (02/01)
    // já passou este ano e vira 2027, fora da janela de 15 dias.
    expect(workAnniversaries.upcoming.map((w) => w.user.id)).toEqual([lenda.id])
    expect(workAnniversaries.upcoming[0].daysUntil).toBe(0)
  })
})

describe('getCelebrations com mês explícito', () => {
  it('devolve o mês pedido e mantém os "próximos" a partir do dia real', async () => {
    const viewer = await mkUser('Quem Olha', 'v-month@x.com', null)
    await mkUser('Agosto', 'agosto@x.com', '1990-08-10')
    await mkUser('Julho', 'julho@x.com', '1990-07-05')

    const res = await getCelebrations(viewer.id, noonAt('2026-07-05'), '2026-08')

    expect(res.birthdays.month.map((b) => b.day)).toEqual([10])
    // Os "próximos" continuam a partir de hoje (05/07), não do mês navegado —
    // e 10/08 está a 36 dias, fora da janela de 15.
    expect(res.birthdays.upcoming.map((b) => b.day)).toEqual([5])
    expect(res.birthdays.upcoming.find((b) => b.day === 5)?.daysUntil).toBe(0)
    expect(res.referenceDay).toBe('2026-07-05')
  })

  it('conta anos de casa relativos ao ano pedido', async () => {
    const viewer = await mkUser('Viewer2', 'v2-month@x.com', null)
    await mkUser('Veterana', 'veterana@x.com', null, { joinedAt: '2020-08-10' })

    const res = await getCelebrations(viewer.id, noonAt('2026-07-05'), '2027-08')

    expect(res.workAnniversaries.month.map((w) => w.years)).toEqual([7])
  })
})

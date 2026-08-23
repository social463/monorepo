import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { OneOnOneError, createSeries, getMeeting, listMeetings, occurrenceDates } from './one-on-one-service'

async function makeUser(name: string) {
  return prisma.user.create({
    data: { name, email: `${name.toLowerCase()}@empresa.com`, passwordHash: 'x', companyId: DEFAULT_COMPANY_ID },
  })
}

function viewerOf(user: { id: string }) {
  return { userId: user.id, companyId: DEFAULT_COMPANY_ID }
}

const base = {
  date: '2026-08-10',
  startTime: '10:00',
  durationMinutes: 30,
  recurrence: 'NONE' as const,
}

describe('one-on-one-service — série e ocorrências', () => {
  it('cria uma ocorrência única quando não há recorrência', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')

    const { meetings } = await createSeries(viewerOf(ana), { ...base, counterpartId: bruno.id })

    expect(meetings).toHaveLength(1)
    expect(meetings[0].counterpart.id).toBe(bruno.id)
    expect(meetings[0].status).toBe('SCHEDULED')
  })

  it('materializa a quantidade pedida na recorrência semanal, de 7 em 7 dias', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')

    const { meetings } = await createSeries(viewerOf(ana), {
      ...base,
      counterpartId: bruno.id,
      recurrence: 'WEEKLY',
      recurrenceCount: 4,
    })

    expect(meetings).toHaveLength(4)
    const dias = meetings.map((m) => m.startsAt.slice(0, 10))
    expect(dias).toEqual(['2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31'])
  })

  it('respeita o teto de 52 ocorrências numa série sem fim declarado', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')

    const { meetings } = await createSeries(viewerOf(ana), {
      ...base,
      counterpartId: bruno.id,
      recurrence: 'WEEKLY',
    })

    expect(meetings).toHaveLength(52)
  })

  it('guarda o par com os ids ordenados, marque quem marcar', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    const [menor, maior] = [ana.id, bruno.id].sort()

    const { seriesId } = await createSeries(viewerOf(bruno), { ...base, counterpartId: ana.id })

    const serie = await prisma.oneOnOneSeries.findUniqueOrThrow({ where: { id: seriesId } })
    expect(serie.userAId).toBe(menor)
    expect(serie.userBId).toBe(maior)
    expect(serie.createdById).toBe(bruno.id)
  })

  it('recusa 1:1 com a própria pessoa', async () => {
    const ana = await makeUser('Ana')
    await expect(createSeries(viewerOf(ana), { ...base, counterpartId: ana.id })).rejects.toBeInstanceOf(OneOnOneError)
  })

  /**
   * `/1-1` e `/1-1/:id` vivem sob `DevOnly`, que manda ADMIN e SUBADMIN para o
   * `/admin`: eles recebem a notificação, clicam no link e caem em outra tela,
   * sem nunca ver pauta, ação ou nota. Fecha-se pela porta estreita — ninguém
   * cria um encontro que uma das pontas não consegue abrir.
   */
  it('recusa marcar 1:1 com ADMIN ou SUBADMIN — eles não têm a tela do encontro', async () => {
    const ana = await makeUser('Ana')
    const admin = await prisma.user.create({
      data: { name: 'Admin', email: 'admin-1a1@empresa.com', passwordHash: 'x', role: 'ADMIN', companyId: DEFAULT_COMPANY_ID },
    })
    const subadmin = await prisma.user.create({
      data: { name: 'Sub', email: 'sub-1a1@empresa.com', passwordHash: 'x', role: 'SUBADMIN', companyId: DEFAULT_COMPANY_ID },
    })

    await expect(createSeries(viewerOf(ana), { ...base, counterpartId: admin.id })).rejects.toMatchObject({
      status: 400,
    })
    await expect(createSeries(viewerOf(ana), { ...base, counterpartId: subadmin.id })).rejects.toMatchObject({
      status: 400,
    })
    expect(await prisma.oneOnOneSeries.count()).toBe(0)
  })

  it('recusa alguém de outra empresa', async () => {
    const ana = await makeUser('Ana')
    const outra = await prisma.company.create({ data: { name: 'Outra', slug: `outra-1a1-${Date.now()}` } })
    const forasteiro = await prisma.user.create({
      data: { name: 'Zeca', email: 'zeca@outra.com', passwordHash: 'x', companyId: outra.id },
    })

    await expect(
      createSeries(viewerOf(ana), { ...base, counterpartId: forasteiro.id }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('lista para os dois participantes, cada um vendo o outro como counterpart', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    await createSeries(viewerOf(ana), { ...base, counterpartId: bruno.id })

    const daAna = await listMeetings(viewerOf(ana), '2026-08-01', '2026-08-31')
    const doBruno = await listMeetings(viewerOf(bruno), '2026-08-01', '2026-08-31')

    expect(daAna[0].counterpart.id).toBe(bruno.id)
    expect(doBruno[0].counterpart.id).toBe(ana.id)
  })

  it('não lista o 1:1 dos outros', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    const carla = await makeUser('Carla')
    await createSeries(viewerOf(ana), { ...base, counterpartId: bruno.id })

    expect(await listMeetings(viewerOf(carla), '2026-08-01', '2026-08-31')).toEqual([])
  })

  it('devolve 404 no detalhe para quem não é do par — inclusive ADMIN', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    const chefe = await prisma.user.create({
      data: { name: 'Chefe', email: 'chefe@empresa.com', passwordHash: 'x', role: 'ADMIN', companyId: DEFAULT_COMPANY_ID },
    })
    const { meetings } = await createSeries(viewerOf(ana), { ...base, counterpartId: bruno.id })

    await expect(getMeeting(viewerOf(chefe), meetings[0].id)).rejects.toMatchObject({ status: 404 })
  })
})

describe('one-on-one-service — occurrenceDates: recorrência mensal ancorada (mês civil)', () => {
  it('grampeia no último dia do mês quando o dia da âncora não existe naquele mês, sem transbordar', () => {
    const datas = occurrenceDates({
      first: new Date('2026-01-31T10:00:00'),
      recurrence: 'MONTHLY',
      until: null,
      count: 5,
    })
    expect(datas.map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
    ])
  })

  it('cai em 29 de fevereiro quando o ano é bissexto', () => {
    const datas = occurrenceDates({
      first: new Date('2028-01-31T10:00:00'),
      recurrence: 'MONTHLY',
      until: null,
      count: 2,
    })
    expect(datas.map((d) => d.toISOString().slice(0, 10))).toEqual(['2028-01-31', '2028-02-29'])
  })

  it('dia comum do mês (10) segue trivial, sem grampeamento', () => {
    const datas = occurrenceDates({
      first: new Date('2026-01-10T10:00:00'),
      recurrence: 'MONTHLY',
      until: null,
      count: 3,
    })
    expect(datas.map((d) => d.toISOString().slice(0, 10))).toEqual(['2026-01-10', '2026-02-10', '2026-03-10'])
  })
})

describe('one-on-one-service — occurrenceDates: outras recorrências', () => {
  it('quinzenal avança de 14 em 14 dias', () => {
    const datas = occurrenceDates({
      first: new Date('2026-08-10T10:00:00'),
      recurrence: 'BIWEEKLY',
      until: null,
      count: 3,
    })
    expect(datas.map((d) => d.toISOString().slice(0, 10))).toEqual(['2026-08-10', '2026-08-24', '2026-09-07'])
  })

  it('corta em recurrenceUntil, mesmo com count maior pedido', () => {
    const datas = occurrenceDates({
      first: new Date('2026-08-10T10:00:00'),
      recurrence: 'WEEKLY',
      until: new Date('2026-08-20T23:59:59'),
      count: 10,
    })
    expect(datas.map((d) => d.toISOString().slice(0, 10))).toEqual(['2026-08-10', '2026-08-17'])
  })

  it('grampeia recurrenceCount pedido acima do teto em MAX_ONE_ON_ONE_OCCURRENCES (52)', () => {
    const datas = occurrenceDates({
      first: new Date('2026-08-10T10:00:00'),
      recurrence: 'WEEKLY',
      until: null,
      count: 100,
    })
    expect(datas).toHaveLength(52)
  })
})

describe('one-on-one-service — detalhe do encontro (getMeeting), caminho feliz', () => {
  it('traz tópicos ordenados, ações abertas de outro encontro da série (carryover), fechadas só as deste encontro, e a nota de quem pediu — nunca a do outro', async () => {
    const ana = await makeUser('Ana')
    const bruno = await makeUser('Bruno')
    const { seriesId, meetings } = await createSeries(viewerOf(ana), {
      ...base,
      counterpartId: bruno.id,
      recurrence: 'WEEKLY',
      recurrenceCount: 2,
    })
    const [primeiro, segundo] = meetings

    // Pauta do segundo encontro, criada fora de ordem para testar o sortOrder.
    await prisma.oneOnOneTopic.createMany({
      data: [
        {
          meetingId: segundo.id,
          text: 'Segundo tópico',
          origin: 'CUSTOM',
          sortOrder: 1,
          createdById: ana.id,
          companyId: DEFAULT_COMPANY_ID,
        },
        {
          meetingId: segundo.id,
          text: 'Primeiro tópico',
          origin: 'CUSTOM',
          sortOrder: 0,
          createdById: ana.id,
          companyId: DEFAULT_COMPANY_ID,
        },
      ],
    })

    // Ação aberta no PRIMEIRO encontro: precisa aparecer no detalhe do SEGUNDO
    // (carryover — combinado do par, não do encontro).
    const acaoAberta = await prisma.oneOnOneAction.create({
      data: {
        seriesId,
        createdInMeetingId: primeiro.id,
        description: 'Ação em aberto do primeiro encontro',
        ownerId: bruno.id,
        status: 'OPEN',
        companyId: DEFAULT_COMPANY_ID,
      },
    })

    // Ação fechada, mas criada no PRIMEIRO encontro: não deve entrar no
    // closedActions do segundo (closedActions é só do encontro pedido).
    await prisma.oneOnOneAction.create({
      data: {
        seriesId,
        createdInMeetingId: primeiro.id,
        description: 'Ação concluída no primeiro encontro',
        ownerId: ana.id,
        status: 'DONE',
        completedById: ana.id,
        completedAt: new Date(),
        companyId: DEFAULT_COMPANY_ID,
      },
    })

    // Ação fechada NO segundo encontro: essa sim aparece em closedActions.
    const acaoFechadaAqui = await prisma.oneOnOneAction.create({
      data: {
        seriesId,
        createdInMeetingId: segundo.id,
        description: 'Ação concluída no segundo encontro',
        ownerId: bruno.id,
        status: 'PROMOTED',
        companyId: DEFAULT_COMPANY_ID,
      },
    })

    // Nota privada dos dois participantes no segundo encontro — só a de quem
    // pediu pode aparecer no DTO.
    await prisma.oneOnOnePrivateNote.create({
      data: { meetingId: segundo.id, authorId: ana.id, body: 'Nota da Ana', companyId: DEFAULT_COMPANY_ID },
    })
    await prisma.oneOnOnePrivateNote.create({
      data: { meetingId: segundo.id, authorId: bruno.id, body: 'Nota do Bruno', companyId: DEFAULT_COMPANY_ID },
    })

    const detalheDaAna = await getMeeting(viewerOf(ana), segundo.id)
    expect(detalheDaAna.topics.map((t) => t.text)).toEqual(['Primeiro tópico', 'Segundo tópico'])
    expect(detalheDaAna.openActions.map((a) => a.id)).toEqual([acaoAberta.id])
    expect(detalheDaAna.closedActions.map((a) => a.id)).toEqual([acaoFechadaAqui.id])
    expect(detalheDaAna.note).toBe('Nota da Ana')

    const detalheDoBruno = await getMeeting(viewerOf(bruno), segundo.id)
    expect(detalheDoBruno.note).toBe('Nota do Bruno')
  })
})

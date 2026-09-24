import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import { occurrencesFor } from '../services/birthday-greeting-service'

/**
 * Mural de aniversário — o que substituiu o "parabéns vira feedback".
 * Nada aqui toca o `feedback-service`: é essa a decisão da spec.
 */

const SECTOR = 'sector-dev-produto'

async function setup() {
  const app = buildApp()
  await app.ready()
  return app
}

/** Cria alguém com aniversário e entrada na empresa em datas controladas. */
async function makeUser(
  name: string,
  opts: { role?: string; birthDate?: string; joinedAt?: string } = {},
) {
  return prisma.user.create({
    data: {
      name,
      email: `${name.toLowerCase()}-${Math.random()}@empresa.com`,
      passwordHash: 'x',
      role: (opts.role ?? 'LEGEND') as never,
      sectorId: SECTOR,
      birthDate: opts.birthDate ? new Date(`${opts.birthDate}T00:00:00.000Z`) : null,
      ...(opts.joinedAt ? { joinedAt: new Date(`${opts.joinedAt}T00:00:00.000Z`) } : {}),
    },
  })
}

function tokenFor(app: Awaited<ReturnType<typeof setup>>, user: { id: string; role: string }) {
  return app.jwt.sign({
    sub: user.id,
    role: user.role,
    sectorId: SECTOR,
    companyId: DEFAULT_COMPANY_ID,
    features: [],
  })
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` }
}

/** Hoje em São Paulo — o servidor decide a janela, então os testes seguem ele. */
function todayYmd(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function shiftDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** A mesma data (dia/mês) num ano bem anterior — vira aniversário de hoje. */
function birthDateForToday(offsetDays = 0): string {
  const target = shiftDays(todayYmd(), offsetDays)
  return `1990-${target.slice(5)}`
}

describe('mural de aniversário', () => {
  it('assina o mural de quem faz aniversário hoje e conta a assinatura', async () => {
    const app = await setup()
    const ano = Number(todayYmd().slice(0, 4))
    const aniversariante = await makeUser('Victoria', { birthDate: birthDateForToday() })
    const colega = await makeUser('Lucca')

    const assinou = await app.inject({
      method: 'POST',
      url: `/users/${aniversariante.id}/birthday-wall`,
      headers: auth(tokenFor(app, colega)),
      payload: { kind: 'BIRTH', year: ano, message: 'Parabéns, Victoria! 🎉' },
    })
    expect(assinou.statusCode).toBe(201)

    const mural = await app.inject({
      method: 'GET',
      url: `/users/${aniversariante.id}/birthday-wall`,
      headers: auth(tokenFor(app, colega)),
    })
    const body = mural.json()
    expect(body.selected).toMatchObject({ kind: 'BIRTH', year: ano, isToday: true, isOpen: true })
    expect(body.greetings).toHaveLength(1)
    expect(body.greetings[0].message).toBe('Parabéns, Victoria! 🎉')
    expect(body.selected.greetingCount).toBe(1)
    expect(body.mySignatureId).toBe(body.greetings[0].id)
  })

  it('felicitação NÃO vira feedback — a lista de feedbacks continua vazia', async () => {
    const app = await setup()
    const ano = Number(todayYmd().slice(0, 4))
    const aniversariante = await makeUser('Victoria', { birthDate: birthDateForToday() })
    const colega = await makeUser('Lucca')

    await app.inject({
      method: 'POST',
      url: `/users/${aniversariante.id}/birthday-wall`,
      headers: auth(tokenFor(app, colega)),
      payload: { kind: 'BIRTH', year: ano, message: 'Parabéns!' },
    })

    // É o ponto da spec: o parabéns saiu do feedback e não conta para selo,
    // coins nem para a lista do perfil.
    expect(await prisma.feedback.count()).toBe(0)
  })

  it('assinar de novo reescreve a própria mensagem, em vez de empilhar', async () => {
    const app = await setup()
    const ano = Number(todayYmd().slice(0, 4))
    const aniversariante = await makeUser('Victoria', { birthDate: birthDateForToday() })
    const colega = await makeUser('Lucca')
    const url = `/users/${aniversariante.id}/birthday-wall`

    await app.inject({
      method: 'POST',
      url,
      headers: auth(tokenFor(app, colega)),
      payload: { kind: 'BIRTH', year: ano, message: 'Parabens' },
    })
    await app.inject({
      method: 'POST',
      url,
      headers: auth(tokenFor(app, colega)),
      payload: { kind: 'BIRTH', year: ano, message: 'Parabéns! 🎉' },
    })

    const mural = await app.inject({ method: 'GET', url, headers: auth(tokenFor(app, colega)) })
    expect(mural.json().greetings).toHaveLength(1)
    expect(mural.json().greetings[0].message).toBe('Parabéns! 🎉')
  })

  it('não deixa assinar o próprio mural', async () => {
    const app = await setup()
    const ano = Number(todayYmd().slice(0, 4))
    const aniversariante = await makeUser('Victoria', { birthDate: birthDateForToday() })

    const resposta = await app.inject({
      method: 'POST',
      url: `/users/${aniversariante.id}/birthday-wall`,
      headers: auth(tokenFor(app, aniversariante)),
      payload: { kind: 'BIRTH', year: ano, message: 'Parabéns pra mim' },
    })
    expect(resposta.statusCode).toBe(403)
  })

  it('recusa assinatura fora da janela e mantém o mural em leitura', async () => {
    const app = await setup()
    const ano = Number(todayYmd().slice(0, 4))
    // Aniversário daqui a 60 dias: fora dos 3 dias de antecedência.
    const aniversariante = await makeUser('Victoria', { birthDate: birthDateForToday(60) })
    const colega = await makeUser('Lucca')

    const resposta = await app.inject({
      method: 'POST',
      url: `/users/${aniversariante.id}/birthday-wall`,
      headers: auth(tokenFor(app, colega)),
      payload: { kind: 'BIRTH', year: ano, message: 'Parabéns adiantado' },
    })
    expect(resposta.statusCode).toBe(409)

    const mural = await app.inject({
      method: 'GET',
      url: `/users/${aniversariante.id}/birthday-wall`,
      headers: auth(tokenFor(app, colega)),
    })
    expect(mural.json().canSign).toBe(false)
  })

  it('aniversário de empresa tem mural próprio, com os anos de casa', async () => {
    const app = await setup()
    const hoje = todayYmd()
    const anoAtual = Number(hoje.slice(0, 4))
    const aniversariante = await makeUser('Diego', { joinedAt: `${anoAtual - 3}-${hoje.slice(5)}` })
    const colega = await makeUser('Lucca')

    const assinou = await app.inject({
      method: 'POST',
      url: `/users/${aniversariante.id}/birthday-wall`,
      headers: auth(tokenFor(app, colega)),
      payload: { kind: 'WORK', year: anoAtual, message: 'Parabéns pelo tempo de casa!' },
    })
    expect(assinou.statusCode).toBe(201)

    const mural = await app.inject({
      method: 'GET',
      url: `/users/${aniversariante.id}/birthday-wall?kind=WORK&year=${anoAtual}`,
      headers: auth(tokenFor(app, colega)),
    })
    expect(mural.json().selected).toMatchObject({ kind: 'WORK', years: 3, isToday: true })
  })

  it('o autor edita e apaga a própria mensagem; um terceiro não', async () => {
    const app = await setup()
    const ano = Number(todayYmd().slice(0, 4))
    const aniversariante = await makeUser('Victoria', { birthDate: birthDateForToday() })
    const autor = await makeUser('Lucca')
    const terceiro = await makeUser('Ana')

    const criada = await app.inject({
      method: 'POST',
      url: `/users/${aniversariante.id}/birthday-wall`,
      headers: auth(tokenFor(app, autor)),
      payload: { kind: 'BIRTH', year: ano, message: 'Parabens' },
    })
    const id = criada.json().greeting.id

    const doTerceiro = await app.inject({
      method: 'PATCH',
      url: `/birthday-greetings/${id}`,
      headers: auth(tokenFor(app, terceiro)),
      payload: { message: 'não é minha' },
    })
    expect(doTerceiro.statusCode).toBe(403)

    const editada = await app.inject({
      method: 'PATCH',
      url: `/birthday-greetings/${id}`,
      headers: auth(tokenFor(app, autor)),
      payload: { message: 'Parabéns! 🎂' },
    })
    expect(editada.statusCode).toBe(200)
    expect(editada.json().greeting.message).toBe('Parabéns! 🎂')

    const apagada = await app.inject({
      method: 'DELETE',
      url: `/birthday-greetings/${id}`,
      headers: auth(tokenFor(app, autor)),
    })
    expect(apagada.statusCode).toBe(204)
  })

  it('admin modera: apaga a felicitação de outra pessoa', async () => {
    const app = await setup()
    const ano = Number(todayYmd().slice(0, 4))
    const aniversariante = await makeUser('Victoria', { birthDate: birthDateForToday() })
    const autor = await makeUser('Lucca')
    const admin = await makeUser('Admin', { role: 'ADMIN' })

    const criada = await app.inject({
      method: 'POST',
      url: `/users/${aniversariante.id}/birthday-wall`,
      headers: auth(tokenFor(app, autor)),
      payload: { kind: 'BIRTH', year: ano, message: 'mensagem fora de tom' },
    })
    const id = criada.json().greeting.id

    const apagada = await app.inject({
      method: 'DELETE',
      url: `/birthday-greetings/${id}`,
      headers: auth(tokenFor(app, admin)),
    })
    expect(apagada.statusCode).toBe(204)
    expect(await prisma.birthdayGreeting.count()).toBe(0)
  })

  it('reação liga e desliga, como no mural de feedbacks', async () => {
    const app = await setup()
    const ano = Number(todayYmd().slice(0, 4))
    const aniversariante = await makeUser('Victoria', { birthDate: birthDateForToday() })
    const autor = await makeUser('Lucca')
    const ana = await makeUser('Ana')

    const criada = await app.inject({
      method: 'POST',
      url: `/users/${aniversariante.id}/birthday-wall`,
      headers: auth(tokenFor(app, autor)),
      payload: { kind: 'BIRTH', year: ano, message: 'Parabéns!' },
    })
    const id = criada.json().greeting.id
    const url = `/birthday-greetings/${id}/reactions`

    const ligada = await app.inject({ method: 'POST', url, headers: auth(tokenFor(app, ana)), payload: { emoji: '🎉' } })
    expect(ligada.json().greeting.reactions).toEqual([
      expect.objectContaining({ emoji: '🎉', count: 1, reactedByMe: true }),
    ])

    const desligada = await app.inject({ method: 'POST', url, headers: auth(tokenFor(app, ana)), payload: { emoji: '🎉' } })
    expect(desligada.json().greeting.reactions).toEqual([])
  })

  it('notifica o aniversariante na primeira assinatura, e só nela', async () => {
    const app = await setup()
    const ano = Number(todayYmd().slice(0, 4))
    const aniversariante = await makeUser('Victoria', { birthDate: birthDateForToday() })
    const colega = await makeUser('Lucca')
    const url = `/users/${aniversariante.id}/birthday-wall`

    await app.inject({
      method: 'POST',
      url,
      headers: auth(tokenFor(app, colega)),
      payload: { kind: 'BIRTH', year: ano, message: 'Parabéns!' },
    })
    await app.inject({
      method: 'POST',
      url,
      headers: auth(tokenFor(app, colega)),
      payload: { kind: 'BIRTH', year: ano, message: 'Parabéns! 🎉' },
    })

    const notificacoes = await prisma.notification.findMany({ where: { userId: aniversariante.id } })
    expect(notificacoes).toHaveLength(1)
    expect(notificacoes[0]!.type).toBe('BIRTHDAY_GREETING_RECEIVED')
  })

  it('o card da Home recebe quantas pessoas já assinaram o mural de hoje', async () => {
    const app = await setup()
    const ano = Number(todayYmd().slice(0, 4))
    const aniversariante = await makeUser('Victoria', { birthDate: birthDateForToday() })
    const colega = await makeUser('Lucca')

    await app.inject({
      method: 'POST',
      url: `/users/${aniversariante.id}/birthday-wall`,
      headers: auth(tokenFor(app, colega)),
      payload: { kind: 'BIRTH', year: ano, message: 'Parabéns!' },
    })

    const celebracoes = await app.inject({
      method: 'GET',
      url: '/celebrations',
      headers: auth(tokenFor(app, colega)),
    })
    const hoje = celebracoes
      .json()
      .birthdays.upcoming.find((b: { user: { id: string } }) => b.user.id === aniversariante.id)
    expect(hoje.greetingCount).toBe(1)
  })

  it('occurrencesFor abre a janela que atravessa a virada do ano', () => {
    // Aniversário em 31/12; hoje é 2 de janeiro. A ocorrência aberta é a de
    // 2025, não a de 2026 — é por isso que a varredura olha três anos.
    const abertas = occurrencesFor(
      { birthDate: new Date('1990-12-31T00:00:00.000Z'), joinedAt: new Date('2020-06-01T00:00:00.000Z') },
      '2026-01-02',
    )
    expect(abertas).toEqual([
      expect.objectContaining({ kind: 'BIRTH', year: 2025, date: '2025-12-31', isOpen: true, isToday: false }),
    ])
  })
})

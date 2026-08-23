import { describe, it, expect } from 'vitest'
import { defaultCharacterFromSeed } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

async function setup() {
  const app = buildApp()
  await app.ready()
  const reg = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' },
  })
  const token = reg.json().accessToken as string
  const ana = await prisma.user.findUniqueOrThrow({ where: { email: 'ana@empresa.com' } })
  const bruno = await prisma.user.create({
    data: { name: 'Bruno', email: 'bruno@empresa.com', passwordHash: 'x', companyId: ana.companyId },
  })
  return { app, token, ana, bruno }
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` })

async function criar(app: Awaited<ReturnType<typeof setup>>['app'], token: string, counterpartId: string) {
  return app.inject({
    method: 'POST',
    url: '/one-on-ones',
    headers: auth(token),
    payload: {
      counterpartId,
      date: '2026-08-10',
      startTime: '10:00',
      durationMinutes: 30,
      recurrence: 'NONE',
    },
  })
}

describe('rotas de 1:1', () => {
  it('exige autenticação', async () => {
    const { app } = await setup()
    expect((await app.inject({ method: 'GET', url: '/one-on-ones?from=2026-08-01&to=2026-08-31' })).statusCode).toBe(401)
    await app.close()
  })

  it('POST /one-on-ones cria e devolve as ocorrências', async () => {
    const { app, token, bruno } = await setup()
    const res = await criar(app, token, bruno.id)

    expect(res.statusCode).toBe(201)
    expect(res.json().meetings).toHaveLength(1)
    await app.close()
  })

  it('POST /one-on-ones recusa payload inválido com 400', async () => {
    const { app, token, bruno } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/one-on-ones',
      headers: auth(token),
      payload: { counterpartId: bruno.id, date: '10/08/2026', startTime: '10:00', durationMinutes: 30, recurrence: 'NONE' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().issues).toBeTruthy()
    await app.close()
  })

  it('POST /one-on-ones recusa recorrência com fim duplicado', async () => {
    const { app, token, bruno } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/one-on-ones',
      headers: auth(token),
      payload: {
        counterpartId: bruno.id,
        date: '2026-08-10',
        startTime: '10:00',
        durationMinutes: 30,
        recurrence: 'WEEKLY',
        recurrenceUntil: '2026-12-01',
        recurrenceCount: 5,
      },
    })

    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('GET /one-on-ones/:id devolve o detalhe para quem é do par', async () => {
    const { app, token, bruno } = await setup()
    const meetingId = (await criar(app, token, bruno.id)).json().meetings[0].id

    const res = await app.inject({ method: 'GET', url: `/one-on-ones/${meetingId}`, headers: auth(token) })

    expect(res.statusCode).toBe(200)
    expect(res.json().counterpart.id).toBe(bruno.id)
    expect(res.json().openActions).toEqual([])
    await app.close()
  })

  /**
   * O `<Avatar>` do front resolve na ordem personagem LPC → `photoUrl` →
   * iniciais. Quem monta personagem normalmente não sobe foto, então derrubar
   * `avatarStyle`/`avatarOptions` no serializer não quebra nada visível no
   * teste — só faz o 1:1 inteiro exibir iniciais. Daí este teste.
   */
  it('GET /one-on-ones/:id leva os dados de avatar da contraparte e do dono da ação', async () => {
    const { app, token, ana, bruno } = await setup()
    const personagem = defaultCharacterFromSeed('bruno')
    await prisma.user.update({
      where: { id: bruno.id },
      data: { avatarStyle: 'lpc', avatarSeed: 'bruno', avatarOptions: personagem as object },
    })
    const meetingId = (await criar(app, token, bruno.id)).json().meetings[0].id
    await app.inject({
      method: 'POST',
      url: `/one-on-ones/${meetingId}/actions`,
      headers: auth(token),
      payload: { description: 'Enviar material', ownerId: bruno.id },
    })

    const detalhe = (await app.inject({ method: 'GET', url: `/one-on-ones/${meetingId}`, headers: auth(token) })).json()

    expect(detalhe.counterpart).toMatchObject({ avatarStyle: 'lpc', avatarSeed: 'bruno' })
    expect(detalhe.counterpart.avatarOptions).toEqual(personagem)
    expect(detalhe.openActions[0].owner).toMatchObject({ avatarStyle: 'lpc', avatarSeed: 'bruno' })

    // …e a lista, que é de onde sai o histórico da tela de detalhe.
    const lista = (
      await app.inject({ method: 'GET', url: '/one-on-ones?from=2026-08-01&to=2026-08-31', headers: auth(token) })
    ).json()
    expect(lista.meetings[0].counterpart).toMatchObject({ avatarStyle: 'lpc', avatarSeed: 'bruno' })
    expect(ana.id).toBeTruthy()
    await app.close()
  })

  /** `topicCount` é o que a lista usa para avisar "sem pauta" antes da conversa. */
  it('GET /one-on-ones conta a pauta de cada encontro', async () => {
    const { app, token, bruno } = await setup()
    const meetingId = (await criar(app, token, bruno.id)).json().meetings[0].id

    const antes = (
      await app.inject({ method: 'GET', url: '/one-on-ones?from=2026-08-01&to=2026-08-31', headers: auth(token) })
    ).json()
    expect(antes.meetings[0].topicCount).toBe(0)

    await app.inject({
      method: 'POST',
      url: `/one-on-ones/${meetingId}/topics`,
      headers: auth(token),
      payload: { text: 'Carreira', origin: 'CUSTOM' },
    })

    const depois = (
      await app.inject({ method: 'GET', url: '/one-on-ones?from=2026-08-01&to=2026-08-31', headers: auth(token) })
    ).json()
    expect(depois.meetings[0].topicCount).toBe(1)
    await app.close()
  })

  it('GET /one-on-ones/:id devolve 404 para terceiro', async () => {
    const { app, token, bruno } = await setup()
    const meetingId = (await criar(app, token, bruno.id)).json().meetings[0].id
    const outro = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { name: 'Carla', email: 'carla@empresa.com', password: 'changeme123' },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/one-on-ones/${meetingId}`,
      headers: auth(outro.json().accessToken),
    })

    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('PUT /one-on-ones/:id/note grava a nota de quem pediu', async () => {
    const { app, token, bruno } = await setup()
    const meetingId = (await criar(app, token, bruno.id)).json().meetings[0].id

    const res = await app.inject({
      method: 'PUT',
      url: `/one-on-ones/${meetingId}/note`,
      headers: auth(token),
      payload: { body: 'só minha' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().note).toBe('só minha')
    await app.close()
  })

  it('POST /one-on-ones/:id/actions cria o combinado', async () => {
    const { app, token, bruno } = await setup()
    const meetingId = (await criar(app, token, bruno.id)).json().meetings[0].id

    const res = await app.inject({
      method: 'POST',
      url: `/one-on-ones/${meetingId}/actions`,
      headers: auth(token),
      payload: { description: 'Levantar escopo', ownerId: bruno.id },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json().action.owner.id).toBe(bruno.id)
    await app.close()
  })

  it('POST /one-on-ones/:id/actions recusa dueDate inválida com 400', async () => {
    const { app, token, bruno } = await setup()
    const meetingId = (await criar(app, token, bruno.id)).json().meetings[0].id

    const res = await app.inject({
      method: 'POST',
      url: `/one-on-ones/${meetingId}/actions`,
      headers: auth(token),
      payload: { description: 'Levantar escopo', ownerId: bruno.id, dueDate: 'lixo' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().issues).toBeTruthy()
    await app.close()
  })

  it('PATCH /one-on-ones/actions/:id recusa dueDate inválida com 400', async () => {
    const { app, token, bruno } = await setup()
    const meetingId = (await criar(app, token, bruno.id)).json().meetings[0].id
    const criado = await app.inject({
      method: 'POST',
      url: `/one-on-ones/${meetingId}/actions`,
      headers: auth(token),
      payload: { description: 'Levantar escopo', ownerId: bruno.id },
    })
    const actionId = criado.json().action.id

    const res = await app.inject({
      method: 'PATCH',
      url: `/one-on-ones/actions/${actionId}`,
      headers: auth(token),
      payload: { dueDate: 'lixo' },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().issues).toBeTruthy()
    await app.close()
  })

  it('GET /one-on-ones/topic-templates devolve o catálogo ativo', async () => {
    const { app, token, ana } = await setup()
    await prisma.oneOnOneTopicTemplate.createMany({
      data: [
        { theme: 'Carreira', text: 'Onde você quer chegar?', companyId: ana.companyId },
        { theme: 'Carreira', text: 'Inativo', active: false, companyId: ana.companyId },
      ],
    })

    const res = await app.inject({ method: 'GET', url: '/one-on-ones/topic-templates', headers: auth(token) })

    expect(res.statusCode).toBe(200)
    expect(res.json().templates).toHaveLength(1)
    await app.close()
  })
})

/**
 * O escopo viaja na QUERY, não no corpo — é o ponto onde ele mais fácil se
 * perde entre a tela e o service (o service já é coberto em
 * `one-on-one-schedule.test.ts`, mas por chamada direta).
 */
describe('rotas de 1:1 — escopo de série', () => {
  async function serieDeTres(app: Awaited<ReturnType<typeof setup>>['app'], token: string, counterpartId: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/one-on-ones',
      headers: auth(token),
      payload: {
        counterpartId,
        date: '2026-08-10',
        startTime: '10:00',
        durationMinutes: 30,
        recurrence: 'WEEKLY',
        recurrenceCount: 3,
      },
    })
    return res.json().meetings as { id: string; startsAt: string }[]
  }

  it('DELETE ?scope=future cancela a ocorrência e as seguintes', async () => {
    const { app, token, bruno } = await setup()
    const meetings = await serieDeTres(app, token, bruno.id)

    const res = await app.inject({
      method: 'DELETE',
      url: `/one-on-ones/${meetings[1].id}?scope=future`,
      headers: auth(token),
    })

    expect(res.statusCode).toBe(204)
    expect(await prisma.oneOnOneMeeting.count({ where: { status: 'CANCELED' } })).toBe(2)
    await app.close()
  })

  it('DELETE sem scope cancela só a ocorrência pedida', async () => {
    const { app, token, bruno } = await setup()
    const meetings = await serieDeTres(app, token, bruno.id)

    await app.inject({ method: 'DELETE', url: `/one-on-ones/${meetings[1].id}`, headers: auth(token) })

    expect(await prisma.oneOnOneMeeting.count({ where: { status: 'CANCELED' } })).toBe(1)
    await app.close()
  })
})

/** O escopo e o papel de cada lado viajam pela rota — é onde eles se perdem. */
describe('rotas de 1:1 — convite', () => {
  /** Os dois com senha de verdade: o convidado precisa do próprio token. */
  async function parAutenticado() {
    const app = buildApp()
    await app.ready()
    const registrar = async (name: string, email: string) => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { name, email, password: 'changeme123' },
      })
      return res.json().accessToken as string
    }
    const tokenAna = await registrar('Ana', 'ana@empresa.com')
    const tokenBruno = await registrar('Bruno', 'bruno@empresa.com')
    const bruno = await prisma.user.findUniqueOrThrow({ where: { email: 'bruno@empresa.com' } })

    const criada = await app.inject({
      method: 'POST',
      url: '/one-on-ones',
      headers: auth(tokenAna),
      payload: {
        counterpartId: bruno.id,
        date: '2026-08-11',
        startTime: '10:00',
        durationMinutes: 30,
        recurrence: 'WEEKLY',
        recurrenceCount: 2,
      },
    })
    return { app, tokenAna, tokenBruno, meetings: criada.json().meetings as { id: string }[] }
  }

  it('o convidado recusa com sugestão e quem marcou aceita movendo a série', async () => {
    const { app, tokenAna, tokenBruno, meetings } = await parAutenticado()

    const recusa = await app.inject({
      method: 'POST',
      url: `/one-on-ones/${meetings[0].id}/response?scope=this`,
      headers: auth(tokenBruno),
      payload: { response: 'DECLINED', proposedStartsAt: '2026-08-13T17:00:00.000Z', declineNote: 'Terça não dá' },
    })
    expect(recusa.statusCode).toBe(200)
    expect(recusa.json().meeting.inviteeResponse).toBe('DECLINED')
    expect(recusa.json().meeting.proposedStartsAt).toBe('2026-08-13T17:00:00.000Z')

    const aceite = await app.inject({
      method: 'POST',
      url: `/one-on-ones/${meetings[0].id}/proposal/accept?scope=future`,
      headers: auth(tokenAna),
    })
    expect(aceite.statusCode).toBe(200)
    expect(aceite.json().meeting.startsAt).toBe('2026-08-13T17:00:00.000Z')
    expect(aceite.json().meeting.inviteeResponse).toBe('ACCEPTED')

    // O mesmo deslocamento vale para a seguinte: quinta, e não terça.
    const seguintes = await prisma.oneOnOneMeeting.findMany({ orderBy: { startsAt: 'asc' } })
    expect(seguintes[1].startsAt.toISOString()).toBe('2026-08-20T17:00:00.000Z')
    await app.close()
  })

  it('quem marcou não responde ao próprio convite', async () => {
    const { app, tokenAna, meetings } = await parAutenticado()

    const res = await app.inject({
      method: 'POST',
      url: `/one-on-ones/${meetings[0].id}/response`,
      headers: auth(tokenAna),
      payload: { response: 'ACCEPTED' },
    })

    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('POST /proposal/accept sem sugestão gravada responde 400', async () => {
    const { app, tokenAna, meetings } = await parAutenticado()

    const res = await app.inject({
      method: 'POST',
      url: `/one-on-ones/${meetings[0].id}/proposal/accept?scope=this`,
      headers: auth(tokenAna),
    })

    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('POST /response valida o corpo', async () => {
    const { app, tokenBruno, meetings } = await parAutenticado()

    const res = await app.inject({
      method: 'POST',
      url: `/one-on-ones/${meetings[0].id}/response`,
      headers: auth(tokenBruno),
      payload: { response: 'TALVEZ' },
    })

    expect(res.statusCode).toBe(400)
    await app.close()
  })
})

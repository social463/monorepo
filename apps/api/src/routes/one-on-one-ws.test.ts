import { describe, it, expect } from 'vitest'
import WebSocket from 'ws'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

type Evento = { type: string; meetingId?: string }

function abrir(ws: WebSocket) {
  return new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve())
    ws.on('error', reject)
  })
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Sobe o app numa porta real (WebSocket não passa por `app.inject`) com duas
 * pessoas da MESMA empresa e uma terceira de fora do par, que é quem prova o
 * recorte: o 1:1 é conversa fechada, e nem "mudou alguma coisa" pode vazar.
 */
async function setup() {
  const app = buildApp()
  await app.listen({ port: 0, host: '127.0.0.1' })
  const port = (app.server.address() as { port: number }).port

  const reg = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' },
  })
  const anaToken = reg.json().accessToken as string
  const ana = await prisma.user.findUniqueOrThrow({ where: { email: 'ana@empresa.com' } })
  const bruno = await prisma.user.create({
    data: { name: 'Bruno', email: 'bruno@empresa.com', passwordHash: 'x', companyId: ana.companyId },
  })
  const carla = await prisma.user.create({
    data: { name: 'Carla', email: 'carla@empresa.com', passwordHash: 'x', companyId: ana.companyId },
  })

  const tokenDe = (id: string) =>
    app.jwt.sign({
      sub: id,
      role: 'LEGEND',
      sectorId: ana.sectorId ?? '',
      companyId: ana.companyId,
      features: ['um-a-um'],
    })

  const conectar = (token: string) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/one-on-ones/ws?token=${token}`)
    const eventos: Evento[] = []
    ws.on('message', (d) => eventos.push(JSON.parse(d.toString()) as Evento))
    return { ws, eventos }
  }

  return { app, port, anaToken, ana, bruno, carla, tokenDe, conectar }
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` })

describe('websocket de 1:1', () => {
  it('avisa as duas pessoas do par — e ninguém mais — quando a pauta muda', async () => {
    const { app, anaToken, bruno, carla, tokenDe, conectar } = await setup()

    const criado = await app.inject({
      method: 'POST',
      url: '/one-on-ones',
      headers: auth(anaToken),
      payload: { counterpartId: bruno.id, date: '2026-08-10', startTime: '10:00', durationMinutes: 30, recurrence: 'NONE' },
    })
    const meetingId = criado.json().meetings[0].id as string

    const doBruno = conectar(tokenDe(bruno.id))
    const daCarla = conectar(tokenDe(carla.id))
    await Promise.all([abrir(doBruno.ws), abrir(daCarla.ws)])

    await app.inject({
      method: 'POST',
      url: `/one-on-ones/${meetingId}/topics`,
      headers: auth(anaToken),
      payload: { text: 'Carreira', origin: 'CUSTOM' },
    })
    await delay(150)

    expect(doBruno.eventos).toContainEqual({ type: 'meeting:changed', meetingId })
    expect(daCarla.eventos).toHaveLength(0)

    doBruno.ws.close()
    daCarla.ws.close()
    await app.close()
  })

  it('avisa quando um combinado é criado, editado e concluído', async () => {
    const { app, anaToken, ana, bruno, tokenDe, conectar } = await setup()

    const criado = await app.inject({
      method: 'POST',
      url: '/one-on-ones',
      headers: auth(anaToken),
      payload: { counterpartId: bruno.id, date: '2026-08-10', startTime: '10:00', durationMinutes: 30, recurrence: 'NONE' },
    })
    const meetingId = criado.json().meetings[0].id as string

    const doBruno = conectar(tokenDe(bruno.id))
    await abrir(doBruno.ws)

    const acao = await app.inject({
      method: 'POST',
      url: `/one-on-ones/${meetingId}/actions`,
      headers: auth(anaToken),
      payload: { description: 'Levantar escopo', ownerId: ana.id },
    })
    const actionId = acao.json().action.id as string

    // Editar quem responde pelo combinado é mudança de tela igual às outras.
    await app.inject({
      method: 'PATCH',
      url: `/one-on-ones/actions/${actionId}`,
      headers: auth(anaToken),
      payload: { description: 'Levantar escopo com o time', ownerId: bruno.id },
    })
    await app.inject({
      method: 'PATCH',
      url: `/one-on-ones/actions/${actionId}`,
      headers: auth(anaToken),
      payload: { status: 'DONE' },
    })
    await delay(150)

    expect(doBruno.eventos.filter((e) => e.type === 'actions:changed')).toHaveLength(3)

    doBruno.ws.close()
    await app.close()
  })

  it('avisa o par quando o encontro é marcado como realizado', async () => {
    const { app, anaToken, bruno, tokenDe, conectar } = await setup()

    const criado = await app.inject({
      method: 'POST',
      url: '/one-on-ones',
      headers: auth(anaToken),
      payload: { counterpartId: bruno.id, date: '2026-08-10', startTime: '10:00', durationMinutes: 30, recurrence: 'NONE' },
    })
    const meetingId = criado.json().meetings[0].id as string

    const doBruno = conectar(tokenDe(bruno.id))
    await abrir(doBruno.ws)

    await app.inject({ method: 'POST', url: `/one-on-ones/${meetingId}/done`, headers: auth(anaToken) })
    await delay(150)

    expect(doBruno.eventos).toContainEqual({ type: 'agenda:changed' })

    doBruno.ws.close()
    await app.close()
  })

  it('a nota privada não gera evento — nem o aviso de que ela existe', async () => {
    const { app, anaToken, bruno, tokenDe, conectar } = await setup()

    const criado = await app.inject({
      method: 'POST',
      url: '/one-on-ones',
      headers: auth(anaToken),
      payload: { counterpartId: bruno.id, date: '2026-08-10', startTime: '10:00', durationMinutes: 30, recurrence: 'NONE' },
    })
    const meetingId = criado.json().meetings[0].id as string

    const doBruno = conectar(tokenDe(bruno.id))
    await abrir(doBruno.ws)

    await app.inject({
      method: 'PUT',
      url: `/one-on-ones/${meetingId}/note`,
      headers: auth(anaToken),
      payload: { body: 'ele anda cansado' },
    })
    // Um tópico logo depois serve de marco: se o evento da nota existisse, ele
    // teria chegado antes deste.
    await app.inject({
      method: 'POST',
      url: `/one-on-ones/${meetingId}/topics`,
      headers: auth(anaToken),
      payload: { text: 'Carreira', origin: 'CUSTOM' },
    })
    await delay(150)

    expect(doBruno.eventos).toEqual([{ type: 'meeting:changed', meetingId }])

    doBruno.ws.close()
    await app.close()
  })

  /**
   * O bloco "Plano de X" da tela do 1:1 é lido pelos dois, mas quem escreve nele
   * é o `/pdi` — outra tela, outro service. Sem este aviso, mexer no plano
   * durante a conversa só apareceria para quem mexeu.
   */
  it('avisa o líder quando o plano de PDI do liderado muda', async () => {
    const { app, anaToken, ana, bruno, tokenDe, conectar } = await setup()
    // Líder precisa de papel acima na hierarquia e do mesmo setor — regra do service.
    await prisma.user.update({ where: { id: bruno.id }, data: { role: 'LEAD', sectorId: ana.sectorId } })

    const doBruno = conectar(tokenDe(bruno.id))
    await abrir(doBruno.ws)

    const plano = await app.inject({
      method: 'POST',
      url: '/pdi/plans',
      headers: auth(anaToken),
      payload: { title: 'PDI 2026-Q3', leaderId: bruno.id },
    })
    expect(plano.statusCode).toBe(201)
    const planId = plano.json().plan.id as string

    await app.inject({
      method: 'POST',
      url: `/pdi/plans/${planId}/actions`,
      headers: auth(anaToken),
      payload: { description: 'Estudar arquitetura', type: 'OTHER', priority: 'MEDIUM' },
    })
    await delay(150)

    expect(doBruno.eventos.filter((e) => e.type === 'pdi:changed')).toHaveLength(2)

    doBruno.ws.close()
    await app.close()
  })

  it('recusa conexão sem token válido', async () => {
    const { app, port } = await setup()
    const client = new WebSocket(`ws://127.0.0.1:${port}/one-on-ones/ws?token=invalido`)

    const recusado = await new Promise<boolean>((resolve) => {
      client.on('close', () => resolve(true))
      client.on('error', () => resolve(true))
      client.on('open', () => resolve(false))
    })

    expect(recusado).toBe(true)
    await app.close()
  })

  it('recusa quem não tem a feature de 1:1 liberada', async () => {
    const { app, port, carla, ana } = await setup()
    const semFeature = app.jwt.sign({
      sub: carla.id,
      role: 'LEGEND',
      sectorId: ana.sectorId ?? '',
      companyId: ana.companyId,
      features: [],
    })
    const client = new WebSocket(`ws://127.0.0.1:${port}/one-on-ones/ws?token=${semFeature}`)

    const recusado = await new Promise<boolean>((resolve) => {
      client.on('close', () => resolve(true))
      client.on('error', () => resolve(true))
      client.on('open', () => resolve(false))
    })

    expect(recusado).toBe(true)
    await app.close()
  })
})

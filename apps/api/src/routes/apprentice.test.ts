import { beforeEach, describe, expect, it } from 'vitest'
import { APPRENTICE_POSITION_CATEGORY, type ApprenticeActivitySchema } from '@legends/shared'
import { buildApp } from '../app'
import { signAccessToken } from '../lib/jwt'
import { prisma } from '../lib/prisma'

let app: Awaited<ReturnType<typeof buildApp>>

beforeEach(async () => {
  app = buildApp()
  await app.ready()
})

async function criarUsuario(
  email: string,
  overrides: Partial<Parameters<typeof prisma.user.create>[0]['data']> = {},
) {
  return prisma.user.create({
    data: {
      name: 'Aprendiz de Tal',
      email,
      passwordHash: 'x',
      positionCategory: APPRENTICE_POSITION_CATEGORY,
      ...overrides,
    } as Parameters<typeof prisma.user.create>[0]['data'],
  })
}

function authOf(user: Awaited<ReturnType<typeof criarUsuario>>, features: string[] = []) {
  return { authorization: `Bearer ${signAccessToken(app, user, features)}` }
}

const SCHEMA: ApprenticeActivitySchema = {
  blocks: [{ title: 'Bloco', fields: [{ id: 'resposta', type: 'linha', required: true }] }],
}

async function criarEncontro(order: number, overrides: Record<string, unknown> = {}) {
  return prisma.apprenticeMeeting.create({
    data: {
      order,
      title: `Encontro ${order}`,
      theme: 'Tema',
      objectives: ['Objetivo'],
      deliverable: 'Entregável',
      scheduledOn: new Date(`2026-09-${String(10 + order).padStart(2, '0')}T00:00:00.000Z`),
      accessReleased: true,
      ...overrides,
    } as Parameters<typeof prisma.apprenticeMeeting.create>[0]['data'],
  })
}

async function criarFicha(meetingId: string, overrides: Record<string, unknown> = {}) {
  return prisma.apprenticeActivity.create({
    data: {
      meetingId,
      title: 'Ficha do encontro',
      kind: 'ACTIVITY',
      order: 1,
      schema: SCHEMA as object,
      ...overrides,
    } as Parameters<typeof prisma.apprenticeActivity.create>[0]['data'],
  })
}

describe('acesso à área', () => {
  it('quem não é aprendiz nem facilitador não entra', async () => {
    const pessoa = await criarUsuario('analista@empresa.com', { positionCategory: 'Analista' })
    const res = await app.inject({ method: 'GET', url: '/apprentice/track', headers: authOf(pessoa) })
    expect(res.statusCode).toBe(403)
  })

  it('o cargo de Jovem Aprendiz abre a trilha', async () => {
    await criarEncontro(1)
    const pessoa = await criarUsuario('aprendiz@empresa.com')
    const res = await app.inject({ method: 'GET', url: '/apprentice/track', headers: authOf(pessoa) })
    expect(res.statusCode).toBe(200)
    expect(res.json().viewer.isApprentice).toBe(true)
  })

  it('o ADMIN entra como facilitador, mesmo sem o cargo', async () => {
    await criarEncontro(1)
    const admin = await criarUsuario('admin@empresa.com', { role: 'ADMIN', positionCategory: 'Head' })
    const res = await app.inject({ method: 'GET', url: '/apprentice/track', headers: authOf(admin) })
    expect(res.statusCode).toBe(200)
    expect(res.json().viewer.isFacilitator).toBe(true)
  })

  it('o painel é do bloco de Gente e Gestão: SUBADMIN de outro setor leva 403', async () => {
    const subadmin = await criarUsuario('sub@empresa.com', { role: 'SUBADMIN' })
    const semFeature = await app.inject({
      method: 'GET',
      url: '/admin/apprentice/meetings',
      headers: authOf(subadmin),
    })
    expect(semFeature.statusCode).toBe(403)

    const comFeature = await app.inject({
      method: 'GET',
      url: '/admin/apprentice/meetings',
      headers: authOf(subadmin, ['gente-gestao']),
    })
    expect(comFeature.statusCode).toBe(200)
  })
})

describe('trava do encontro', () => {
  it('encontro não liberado não abre para o aprendiz', async () => {
    const encontro = await criarEncontro(1, { accessReleased: false })
    const pessoa = await criarUsuario('aprendiz@empresa.com')
    const res = await app.inject({
      method: 'GET',
      url: `/apprentice/meetings/${encontro.id}`,
      headers: authOf(pessoa),
    })
    expect(res.statusCode).toBe(403)
  })

  it('quem faltou ao anterior não entra no seguinte; corrigir a chamada destrava', async () => {
    const primeiro = await criarEncontro(1)
    const segundo = await criarEncontro(2)
    const pessoa = await criarUsuario('aprendiz@empresa.com')
    await prisma.apprenticeAttendance.create({
      data: { meetingId: primeiro.id, userId: pessoa.id, present: false },
    })

    const bloqueado = await app.inject({
      method: 'GET',
      url: `/apprentice/meetings/${segundo.id}`,
      headers: authOf(pessoa),
    })
    expect(bloqueado.statusCode).toBe(403)

    await prisma.apprenticeAttendance.updateMany({
      where: { meetingId: primeiro.id, userId: pessoa.id },
      data: { present: true },
    })
    const liberado = await app.inject({
      method: 'GET',
      url: `/apprentice/meetings/${segundo.id}`,
      headers: authOf(pessoa),
    })
    expect(liberado.statusCode).toBe(200)
  })

  it('chamada não lançada no anterior não bloqueia o seguinte', async () => {
    await criarEncontro(1)
    const segundo = await criarEncontro(2)
    const pessoa = await criarUsuario('aprendiz@empresa.com')

    const res = await app.inject({
      method: 'GET',
      url: `/apprentice/meetings/${segundo.id}`,
      headers: authOf(pessoa),
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('preenchimento da ficha', () => {
  it('rascunho salva incompleto; o envio exige o obrigatório', async () => {
    const encontro = await criarEncontro(1)
    const ficha = await criarFicha(encontro.id)
    const pessoa = await criarUsuario('aprendiz@empresa.com')

    const rascunho = await app.inject({
      method: 'PUT',
      url: `/apprentice/activities/${ficha.id}/submission`,
      headers: authOf(pessoa),
      payload: { values: { resposta: '' }, submit: false },
    })
    expect(rascunho.statusCode).toBe(200)
    expect(rascunho.json().submittedAt).toBeNull()

    const invalido = await app.inject({
      method: 'PUT',
      url: `/apprentice/activities/${ficha.id}/submission`,
      headers: authOf(pessoa),
      payload: { values: { resposta: '  ' }, submit: true },
    })
    expect(invalido.statusCode).toBe(400)

    const enviado = await app.inject({
      method: 'PUT',
      url: `/apprentice/activities/${ficha.id}/submission`,
      headers: authOf(pessoa),
      payload: { values: { resposta: 'Minha resposta' }, submit: true },
    })
    expect(enviado.statusCode).toBe(200)
    expect(enviado.json().submittedAt).not.toBeNull()
  })

  it('reenviar mantém a data do primeiro envio — é a que o mural contou', async () => {
    const encontro = await criarEncontro(1)
    const ficha = await criarFicha(encontro.id)
    const pessoa = await criarUsuario('aprendiz@empresa.com')

    const primeiro = await app.inject({
      method: 'PUT',
      url: `/apprentice/activities/${ficha.id}/submission`,
      headers: authOf(pessoa),
      payload: { values: { resposta: 'v1' }, submit: true },
    })
    const segundo = await app.inject({
      method: 'PUT',
      url: `/apprentice/activities/${ficha.id}/submission`,
      headers: authOf(pessoa),
      payload: { values: { resposta: 'v2' }, submit: true },
    })
    expect(segundo.json().submittedAt).toBe(primeiro.json().submittedAt)
    expect(segundo.json().values.resposta).toBe('v2')
  })

  it('não grava ficha de encontro bloqueado, mesmo por requisição direta', async () => {
    const encontro = await criarEncontro(1, { accessReleased: false })
    const ficha = await criarFicha(encontro.id)
    const pessoa = await criarUsuario('aprendiz@empresa.com')

    const res = await app.inject({
      method: 'PUT',
      url: `/apprentice/activities/${ficha.id}/submission`,
      headers: authOf(pessoa),
      payload: { values: { resposta: 'tentativa' }, submit: true },
    })
    expect(res.statusCode).toBe(403)
  })

  it('a revisão mostra o compromisso que a pessoa escreveu no encontro anterior', async () => {
    const primeiro = await criarEncontro(1)
    const segundo = await criarEncontro(2)
    // O compromisso usa o campo `vou`, que é o que a revisão lê
    // (`APPRENTICE_COMMITMENT_FIELD_ID`) — igual ao seed.
    const compromisso = await criarFicha(primeiro.id, {
      title: 'Compromisso',
      kind: 'COMMITMENT',
      order: 90,
      schema: {
        blocks: [
          { title: 'Até o próximo encontro, eu vou:', fields: [{ id: 'vou', type: 'texto', required: true }] },
        ],
      } as object,
    })
    await criarFicha(segundo.id, { title: 'Revisão', kind: 'REVIEW', order: 0 })
    const pessoa = await criarUsuario('aprendiz@empresa.com')

    await app.inject({
      method: 'PUT',
      url: `/apprentice/activities/${compromisso.id}/submission`,
      headers: authOf(pessoa),
      payload: { values: { vou: 'Chegar no horário todos os dias' }, submit: true },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/apprentice/meetings/${segundo.id}`,
      headers: authOf(pessoa),
    })
    expect(res.json().previousCommitment).toBe('Chegar no horário todos os dias')
  })
})

describe('pesquisa anônima', () => {
  it('grava a resposta sem vínculo com quem respondeu, e o recibo à parte', async () => {
    const encontro = await criarEncontro(1, { surveyOpen: true })
    const pessoa = await criarUsuario('aprendiz@empresa.com')

    const res = await app.inject({
      method: 'POST',
      url: `/apprentice/meetings/${encontro.id}/survey`,
      headers: authOf(pessoa),
      payload: { score: 9, takeaway: 'Levo a estrutura do pitch', improvement: '', learned: 'SIM' },
    })
    expect(res.statusCode).toBe(204)

    const respostas = await prisma.apprenticeSurveyResponse.findMany()
    expect(respostas).toHaveLength(1)
    // A tabela não tem coluna de usuário: o anonimato é estrutural.
    expect(Object.keys(respostas[0]!)).not.toContain('userId')

    const recibos = await prisma.apprenticeSurveyReceipt.findMany()
    expect(recibos[0]!.userId).toBe(pessoa.id)
  })

  it('não responde duas vezes, nem com a pesquisa fechada', async () => {
    const aberto = await criarEncontro(1, { surveyOpen: true })
    const fechado = await criarEncontro(2, { surveyOpen: false })
    const pessoa = await criarUsuario('aprendiz@empresa.com')
    const payload = { score: 8, takeaway: 'Algo', improvement: '', learned: 'EM_PARTE' }

    await app.inject({
      method: 'POST',
      url: `/apprentice/meetings/${aberto.id}/survey`,
      headers: authOf(pessoa),
      payload,
    })
    const repetida = await app.inject({
      method: 'POST',
      url: `/apprentice/meetings/${aberto.id}/survey`,
      headers: authOf(pessoa),
      payload,
    })
    expect(repetida.statusCode).toBe(400)

    const semAbertura = await app.inject({
      method: 'POST',
      url: `/apprentice/meetings/${fechado.id}/survey`,
      headers: authOf(pessoa),
      payload,
    })
    expect(semAbertura.statusCode).toBe(400)
  })
})

describe('portfólio e contrato', () => {
  it('um aprendiz não lê o portfólio do outro; o facilitador lê', async () => {
    await criarEncontro(1)
    const um = await criarUsuario('um@empresa.com')
    const outro = await criarUsuario('outro@empresa.com')
    const admin = await criarUsuario('admin@empresa.com', { role: 'ADMIN' })

    const negado = await app.inject({
      method: 'GET',
      url: `/apprentice/portfolio?userId=${outro.id}`,
      headers: authOf(um),
    })
    expect(negado.statusCode).toBe(403)

    const permitido = await app.inject({
      method: 'GET',
      url: `/apprentice/portfolio?userId=${outro.id}`,
      headers: authOf(admin),
    })
    expect(permitido.statusCode).toBe(200)
    expect(permitido.json().person.id).toBe(outro.id)
  })

  it('o facilitador abre o portfólio da turma; o aprendiz não', async () => {
    const encontro = await criarEncontro(1)
    const ficha = await criarFicha(encontro.id)
    const pessoa = await criarUsuario('aprendiz@empresa.com')
    const admin = await criarUsuario('admin@empresa.com', {
      role: 'ADMIN',
      positionCategory: 'Gerente',
    })
    await app.inject({
      method: 'PUT',
      url: `/apprentice/activities/${ficha.id}/submission`,
      headers: authOf(pessoa),
      payload: { values: { resposta: 'feito' }, submit: true },
    })

    // O admin não é aprendiz: pedir o portfólio "dele" é o 404 que deixava a
    // tela vazia. A visão de turma é o que ele abre.
    const proprio = await app.inject({
      method: 'GET',
      url: '/apprentice/portfolio',
      headers: authOf(admin),
    })
    expect(proprio.statusCode).toBe(404)

    const turma = await app.inject({
      method: 'GET',
      url: '/apprentice/portfolio/overview',
      headers: authOf(admin),
    })
    expect(turma.statusCode).toBe(200)
    const body = turma.json()
    expect(body.totalMeetings).toBe(1)
    expect(body.people).toHaveLength(1)
    expect(body.people[0].person.id).toBe(pessoa.id)
    expect(body.people[0].submittedCount).toBe(1)
    // Sem a pesquisa respondida o encontro não conta como concluído.
    expect(body.people[0].completedMeetings).toBe(0)
    // Situação, nunca conteúdo de ficha.
    expect(JSON.stringify(body)).not.toContain('feito')

    const negado = await app.inject({
      method: 'GET',
      url: '/apprentice/portfolio/overview',
      headers: authOf(pessoa),
    })
    expect(negado.statusCode).toBe(403)
  })

  it('assinar é idempotente e sem contrato publicado não assina', async () => {
    const pessoa = await criarUsuario('aprendiz@empresa.com')

    const semContrato = await app.inject({
      method: 'POST',
      url: '/apprentice/contract/signature',
      headers: authOf(pessoa),
    })
    expect(semContrato.statusCode).toBe(400)

    await prisma.apprenticeContract.create({ data: { clauses: ['Chegar no horário.'] } })
    await app.inject({
      method: 'POST',
      url: '/apprentice/contract/signature',
      headers: authOf(pessoa),
    })
    const segunda = await app.inject({
      method: 'POST',
      url: '/apprentice/contract/signature',
      headers: authOf(pessoa),
    })
    expect(segunda.statusCode).toBe(201)
    expect(await prisma.apprenticeContractSignature.count()).toBe(1)
  })
})

describe('mural', () => {
  it('mostra o status da entrega e nunca o que foi escrito', async () => {
    const encontro = await criarEncontro(1)
    const ficha = await criarFicha(encontro.id)
    const pessoa = await criarUsuario('aprendiz@empresa.com')
    await app.inject({
      method: 'PUT',
      url: `/apprentice/activities/${ficha.id}/submission`,
      headers: authOf(pessoa),
      payload: { values: { resposta: 'segredo meu' }, submit: true },
    })

    const res = await app.inject({ method: 'GET', url: '/apprentice/wall', headers: authOf(pessoa) })
    expect(res.statusCode).toBe(200)
    const body = res.body
    expect(body).not.toContain('segredo meu')
    const entry = res.json().entries.find((row: { person: { id: string } }) => row.person.id === pessoa.id)
    expect(entry.status).toBe('ENTREGUE')
  })
})

describe('painel do facilitador', () => {
  it('a chamada lista a turma inteira, inclusive quem falta lançar', async () => {
    const encontro = await criarEncontro(1)
    const admin = await criarUsuario('admin@empresa.com', { role: 'ADMIN', positionCategory: 'Head' })
    await criarUsuario('a1@empresa.com', { name: 'Aprendiz Um' })
    await criarUsuario('a2@empresa.com', { name: 'Aprendiz Dois' })

    const res = await app.inject({
      method: 'GET',
      url: `/admin/apprentice/meetings/${encontro.id}/attendance`,
      headers: authOf(admin),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toHaveLength(2)
    expect(res.json().every((row: { present: boolean | null }) => row.present === null)).toBe(true)
  })

  it('marcar presente limpa a justificativa e a reposição da falta anterior', async () => {
    const encontro = await criarEncontro(1)
    const admin = await criarUsuario('admin@empresa.com', { role: 'ADMIN', positionCategory: 'Head' })
    const pessoa = await criarUsuario('aprendiz@empresa.com')

    await app.inject({
      method: 'PUT',
      url: `/admin/apprentice/meetings/${encontro.id}/attendance`,
      headers: authOf(admin),
      payload: {
        userId: pessoa.id,
        present: false,
        justification: 'Atestado médico',
        needsMakeup: true,
      },
    })
    const res = await app.inject({
      method: 'PUT',
      url: `/admin/apprentice/meetings/${encontro.id}/attendance`,
      headers: authOf(admin),
      payload: { userId: pessoa.id, present: true },
    })

    const row = res.json().find((item: { person: { id: string } }) => item.person.id === pessoa.id)
    expect(row.present).toBe(true)
    expect(row.justification).toBeNull()
    expect(row.needsMakeup).toBe(false)
  })

  it('só quem tem o cargo de Jovem Aprendiz entra numa turma', async () => {
    const admin = await criarUsuario('admin@empresa.com', { role: 'ADMIN', positionCategory: 'Head' })
    const analista = await criarUsuario('analista@empresa.com', { positionCategory: 'Analista' })
    const turma = await prisma.apprenticeClass.create({ data: { name: 'Turma A', shift: 'Manhã' } })

    const res = await app.inject({
      method: 'PUT',
      url: '/admin/apprentice/enrollments',
      headers: authOf(admin),
      payload: { userId: analista.id, classId: turma.id },
    })
    expect(res.statusCode).toBe(400)
  })

  it('o painel conta o cumprimento a partir das revisões enviadas', async () => {
    const primeiro = await criarEncontro(1)
    const segundo = await criarEncontro(2)
    const revisao = await criarFicha(segundo.id, {
      title: 'Revisão',
      kind: 'REVIEW',
      order: 0,
      schema: {
        blocks: [
          {
            title: 'Status',
            fields: [
              {
                id: 'status',
                type: 'select',
                required: true,
                options: ['Cumpri totalmente', 'Cumpri parcialmente', 'Não cumpri'],
              },
            ],
          },
        ],
      } as object,
    })
    const admin = await criarUsuario('admin@empresa.com', { role: 'ADMIN', positionCategory: 'Head' })
    const pessoa = await criarUsuario('aprendiz@empresa.com')
    await prisma.apprenticeAttendance.create({
      data: { meetingId: primeiro.id, userId: pessoa.id, present: true },
    })

    await app.inject({
      method: 'PUT',
      url: `/apprentice/activities/${revisao.id}/submission`,
      headers: authOf(pessoa),
      payload: { values: { status: 'Cumpri totalmente' }, submit: true },
    })

    const res = await app.inject({
      method: 'GET',
      url: '/admin/apprentice/overview',
      headers: authOf(admin),
    })
    expect(res.json().commitments).toMatchObject({ reviews: 1, fulfilled: 1, rate: 100 })
  })
})

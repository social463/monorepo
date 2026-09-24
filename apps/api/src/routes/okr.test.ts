import { describe, expect, it } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

type App = ReturnType<typeof buildApp>

async function person(app: App, email: string, role = 'LEGEND', companyId = 'company-emr', features: string[] = ['metas']) {
  const user = await prisma.user.create({
    data: { name: email.split('@')[0], email, passwordHash: 'x', role: role as never, companyId },
  })
  const token = app.jwt.sign({
    sub: user.id,
    role,
    sectorId: 'sector-dev-produto',
    companyId,
    features,
    adminAccess: false,
  })
  return { id: user.id, headers: { authorization: `Bearer ${token}` } }
}

async function cycle(extra: Record<string, unknown> = {}) {
  return prisma.okrCycle.create({
    data: {
      name: 'Ciclo EMR - 2027',
      status: 'OPEN',
      startDate: new Date('2026-01-01T00:00:00Z'),
      finishDate: new Date('2028-01-31T00:00:00Z'),
      progressRanges: [
        { color: 'red', min: null, max: 30 },
        { color: 'yellow', min: 30, max: 60 },
        { color: 'green', min: 60, max: 100 },
        { color: 'blue', min: 100, max: null },
      ],
      ...extra,
    },
  })
}

/** Admin cria objetivo + KR, com dono e responsável. Devolve o objetivo e o KR. */
async function seedGoal(
  app: App,
  admin: { headers: Record<string, string> },
  cycleId: string,
  assignee: string,
  kr: Record<string, unknown> = {},
  objective: Record<string, unknown> = {},
) {
  const created = await app.inject({
    method: 'POST',
    url: '/okr/objectives',
    headers: admin.headers,
    payload: { cycleId, name: '% de Bugs Squad', scope: 'TEAM', ...objective },
  })
  expect(created.statusCode, created.body).toBe(201)
  const objectiveId = created.json().objective.id as string
  const withKr = await app.inject({
    method: 'POST',
    url: `/okr/objectives/${objectiveId}/key-results`,
    headers: admin.headers,
    payload: {
      name: '% de Bugs Squad',
      metricType: 'PERCENTAGE',
      target: 10,
      direction: 'LOWER_IS_BETTER',
      assignments: [{ personId: assignee, role: 'ASSIGNED_TO' }],
      ...kr,
    },
  })
  expect(withKr.statusCode, withKr.body).toBe(201)
  return { objectiveId, krId: withKr.json().objective.keyResults[0].id as string }
}

describe('rotas de metas e OKRs', () => {
  it('exige autenticação e barra terceirizado', async () => {
    const app = buildApp()
    await app.ready()
    expect((await app.inject({ method: 'GET', url: '/okr/cycles' })).statusCode).toBe(401)
    const third = await person(app, 'terceiro@x.com', 'THIRD_PARTY')
    expect((await app.inject({ method: 'GET', url: '/okr/cycles', headers: third.headers })).statusCode).toBe(403)
    await app.close()
  })

  it('é liberado por setor: sem a feature `metas`, colaborador fica de fora e admin continua entrando', async () => {
    const app = buildApp()
    await app.ready()
    const semFeature = await person(app, 'sem-metas@x.com', 'LEGEND', 'company-emr', [])
    expect((await app.inject({ method: 'GET', url: '/okr/cycles', headers: semFeature.headers })).statusCode).toBe(403)
    const admin = await person(app, 'admin-sem-metas@x.com', 'ADMIN', 'company-emr', [])
    expect((await app.inject({ method: 'GET', url: '/okr/cycles', headers: admin.headers })).statusCode).toBe(200)
    // A allowlist do terceirizado não o libera: metas são dado interno.
    const third = await person(app, 'terceiro-metas@x.com', 'THIRD_PARTY', 'company-emr', ['metas'])
    expect((await app.inject({ method: 'GET', url: '/okr/cycles', headers: third.headers })).statusCode).toBe(403)
    await app.close()
  })

  it('check-in é a série: valor atual derivado, atingimento respeita a direção, soft delete volta ao anterior', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await person(app, 'admin@x.com', 'ADMIN')
    const dev = await person(app, 'dev@x.com')
    const { id: cycleId } = await cycle()
    const { krId, objectiveId } = await seedGoal(app, admin, cycleId, dev.id)

    const post = (payload: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: `/okr/key-results/${krId}/check-ins`, headers: dev.headers, payload })

    expect((await post({ value: 8.3, effectiveAt: '2026-08-31', comment: 'sprint 18' })).statusCode).toBe(201)
    const late = await post({ value: 15.03, effectiveAt: '2026-09-14', comment: 'sprint 19' })
    expect(late.statusCode).toBe(201)
    // Correção de competência antiga, escrita por último: não vira o valor atual.
    expect((await post({ value: 1, effectiveAt: '2026-08-17', comment: 'sprint 17' })).statusCode).toBe(201)

    const read = await app.inject({ method: 'GET', url: `/okr/objectives/${objectiveId}`, headers: dev.headers })
    const kr = read.json().objective.keyResults[0]
    expect(kr.currentValue).toBe(15.03)
    expect(kr.progressLinear).toBeCloseTo(150.3)
    expect(kr.attainment).toBeCloseTo(0.6653, 4)
    expect(kr.goalMet).toBe(false)
    expect(kr.color).toBe('green')
    expect(kr.permissions).toEqual({ updateKeyResult: false, updateKeyResultStatus: false, createCheckIn: true })
    expect(read.json().objective.attainment).toBeCloseTo(0.6653, 4)

    const series = await app.inject({ method: 'GET', url: `/okr/key-results/${krId}/check-ins`, headers: dev.headers })
    expect(series.json().checkIns.map((c: { effectiveAt: string }) => c.effectiveAt)).toEqual([
      '2026-09-14',
      '2026-08-31',
      '2026-08-17',
    ])

    const removed = await app.inject({
      method: 'DELETE',
      url: `/okr/check-ins/${late.json().checkIn.id}`,
      headers: dev.headers,
    })
    expect(removed.statusCode).toBe(204)
    const after = await app.inject({ method: 'GET', url: `/okr/objectives/${objectiveId}`, headers: dev.headers })
    expect(after.json().objective.keyResults[0]).toMatchObject({ currentValue: 8.3, goalMet: true, color: 'blue' })
    expect(await prisma.okrCheckIn.count({ where: { keyResultId: krId } })).toBe(3)
    await app.close()
  })

  it('acumula razão como Σnum ÷ Σden (5,93%, e não a média 5,66%)', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await person(app, 'admin@x.com', 'ADMIN')
    const dev = await person(app, 'dev@x.com')
    const { id: cycleId } = await cycle()
    const { krId, objectiveId } = await seedGoal(app, admin, cycleId, dev.id)
    for (const [numerator, denominator, effectiveAt] of [
      [3, 45, '2026-08-17'],
      [1, 38, '2026-08-31'],
      [4, 52, '2026-09-14'],
    ] as const) {
      const res = await app.inject({
        method: 'POST',
        url: `/okr/key-results/${krId}/check-ins`,
        headers: dev.headers,
        payload: { numerator, denominator, effectiveAt, sourceRef: 'https://notion.so/sprint' },
      })
      expect(res.statusCode, res.body).toBe(201)
    }
    const kr = (await app.inject({ method: 'GET', url: `/okr/objectives/${objectiveId}`, headers: dev.headers })).json()
      .objective.keyResults[0]
    expect(kr.currentValue).toBeCloseTo(7.692, 3)
    expect(kr.accumulatedValue).toBeCloseTo(5.93, 2)
    expect(kr.goalMet).toBe(true)
    await app.close()
  })

  it('regras de check-in: responsável, comentário obrigatório, janela, ciclo encerrado e KR calculado', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await person(app, 'admin@x.com', 'ADMIN')
    const dev = await person(app, 'dev@x.com')
    const other = await person(app, 'outra@x.com')
    const open = await cycle({ forceCommentOnCheckIn: true })
    const { krId, objectiveId } = await seedGoal(app, admin, open.id, dev.id)
    const post = (who: { headers: Record<string, string> }, payload: Record<string, unknown>, id = krId) =>
      app.inject({ method: 'POST', url: `/okr/key-results/${id}/check-ins`, headers: who.headers, payload })

    expect((await post(other, { value: 1, comment: 'x' })).statusCode).toBe(403)
    expect((await post(dev, { value: 1 })).statusCode).toBe(422)
    expect((await post(dev, { comment: 'sem valor' })).statusCode).toBe(422)
    expect((await post(dev, { value: 1, comment: 'ok' })).statusCode).toBe(201)

    // Fora da janela: responsável não, admin sim.
    await prisma.okrCycle.update({
      where: { id: open.id },
      data: { updateWindowStart: new Date('2020-01-01T00:00:00Z'), updateWindowFinish: new Date('2020-12-31T00:00:00Z') },
    })
    expect((await post(dev, { value: 2, comment: 'tarde' })).statusCode).toBe(403)
    expect((await post(admin, { value: 2, comment: 'admin' })).statusCode).toBe(201)

    // KR calculado recusa check-in manual.
    const calc = await app.inject({
      method: 'POST',
      url: `/okr/objectives/${objectiveId}/key-results`,
      headers: admin.headers,
      payload: { name: 'Calculado', metricType: 'PERCENTAGE', target: 100 },
    })
    // Objetivo KR_ONLY não aceita segundo KR.
    expect(calc.statusCode).toBe(422)
    await app.inject({ method: 'PATCH', url: `/okr/objectives/${objectiveId}`, headers: admin.headers, payload: { aggregation: 'WEIGHTED_KRS' } })
    const calc2 = await app.inject({
      method: 'POST',
      url: `/okr/objectives/${objectiveId}/key-results`,
      headers: admin.headers,
      payload: {
        name: 'Calculado',
        metricType: 'PERCENTAGE',
        target: 100,
        dependencies: { strategy: 'AVERAGE', calcType: 'PROGRESS', items: [{ dependsOnKrId: krId }] },
      },
    })
    expect(calc2.statusCode, calc2.body).toBe(201)
    const calcKr = calc2.json().objective.keyResults.find((k: { calculated: boolean }) => k.calculated)
    expect(calcKr.permissions.createCheckIn).toBe(false)
    const refused = await post(admin, { value: 5, comment: 'x' }, calcKr.id)
    expect(refused.statusCode).toBe(422)
    expect(refused.json().message).toMatch(/calculado/)

    // Ciclo encerrado bloqueia tudo, até para o admin.
    await prisma.okrCycle.update({ where: { id: open.id }, data: { status: 'CLOSED' } })
    expect((await post(admin, { value: 3, comment: 'x' })).statusCode).toBe(403)
    const patch = await app.inject({ method: 'PATCH', url: `/okr/key-results/${krId}`, headers: admin.headers, payload: { target: 5 } })
    expect(patch.statusCode).toBe(403)
    await app.close()
  })

  it('dono edita a definição e desdobra filhos; peso acima de 100% é recusado', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await person(app, 'admin@x.com', 'ADMIN')
    const lead = await person(app, 'lider@x.com', 'LEAD')
    const dev = await person(app, 'dev@x.com')
    const { id: cycleId } = await cycle()
    const { objectiveId, krId } = await seedGoal(app, admin, cycleId, dev.id, {}, {
      aggregation: 'CHILDREN',
      assignments: [{ personId: lead.id, role: 'OWNER' }],
    })

    expect((await app.inject({ method: 'PATCH', url: `/okr/key-results/${krId}`, headers: dev.headers, payload: { target: 5 } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'PATCH', url: `/okr/key-results/${krId}`, headers: lead.headers, payload: { target: 8 } })).statusCode).toBe(200)

    const child = (weight: number) =>
      app.inject({
        method: 'POST',
        url: '/okr/objectives',
        headers: lead.headers,
        payload: { cycleId, parentId: objectiveId, name: `filho ${weight}`, scope: 'INDIVIDUAL', weight },
      })
    const first = await child(0.7)
    expect(first.statusCode, first.body).toBe(201)
    expect(first.json().objective.path).toEqual([objectiveId, first.json().objective.id])
    expect((await child(0.4)).statusCode).toBe(422)

    // Sem pai que seja seu, colaborador não cria objetivo.
    const orphan = await app.inject({
      method: 'POST',
      url: '/okr/objectives',
      headers: dev.headers,
      payload: { cycleId, name: 'meu', scope: 'INDIVIDUAL' },
    })
    expect(orphan.statusCode).toBe(403)

    // Excluir leva a subárvore junto.
    expect((await app.inject({ method: 'DELETE', url: `/okr/objectives/${objectiveId}`, headers: lead.headers })).statusCode).toBe(204)
    const list = await app.inject({ method: 'GET', url: `/okr/cycles/${cycleId}/objectives`, headers: admin.headers })
    expect(list.json().objectives).toHaveLength(0)
    await app.close()
  })

  it('visibilidade, resultados por pessoa, resumo e isolamento por empresa', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await person(app, 'admin@x.com', 'ADMIN')
    const dev = await person(app, 'dev@x.com')
    const other = await person(app, 'outra@x.com')
    const { id: cycleId } = await cycle()
    const { objectiveId } = await seedGoal(app, admin, cycleId, dev.id, {}, { visibility: 'PRIVATE' })
    await seedGoal(app, admin, cycleId, other.id, { direction: 'HIGHER_IS_BETTER', target: 80 }, { name: 'Say/Do' })

    // PRIVATE: só dono/criador/admin — nem o responsável do KR vê pelo objetivo.
    expect((await app.inject({ method: 'GET', url: `/okr/objectives/${objectiveId}`, headers: other.headers })).statusCode).toBe(404)
    const listed = await app.inject({ method: 'GET', url: `/okr/cycles/${cycleId}/objectives`, headers: other.headers })
    expect(listed.json().objectives).toHaveLength(1)

    const results = await app.inject({ method: 'GET', url: `/okr/people/${other.id}/results?cycle_id=${cycleId}`, headers: admin.headers })
    expect(results.json().results.objectives.map((o: { name: string }) => o.name)).toEqual(['Say/Do'])

    const summary = await app.inject({ method: 'GET', url: `/okr/cycles/${cycleId}/summary`, headers: admin.headers })
    expect(summary.json().summary).toMatchObject({ objectives: 2, keyResults: 2, goalsMet: 0 })

    await prisma.company.create({ data: { id: 'company-outra', name: 'Outra', slug: 'outra' } })
    const stranger = await person(app, 'x@outra.com', 'ADMIN', 'company-outra')
    expect((await app.inject({ method: 'GET', url: `/okr/cycles/${cycleId}`, headers: stranger.headers })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/okr/cycles', headers: stranger.headers })).json().cycles).toHaveLength(0)
    await app.close()
  })

  it('check-in declara a confiança do objetivo junto com o progresso', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await person(app, 'admin@x.com', 'ADMIN')
    const dev = await person(app, 'dev@x.com')
    const outsider = await person(app, 'outro@x.com')
    const { id: cycleId } = await cycle()
    const { krId, objectiveId } = await seedGoal(app, admin, cycleId, dev.id)
    const post = (headers: Record<string, string>, payload: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: `/okr/key-results/${krId}/check-ins`, headers, payload })
    const confidence = async () =>
      (await app.inject({ method: 'GET', url: `/okr/objectives/${objectiveId}`, headers: admin.headers })).json().objective
        .confidenceLevel

    // O responsável não é dono do objetivo, e ainda assim declara a confiança.
    expect((await post(dev.headers, { value: 8, comment: 'sprint 1', confidenceLevel: 'AT_RISK' })).statusCode).toBe(201)
    expect(await confidence()).toBe('AT_RISK')

    // Sem o campo, a confiança fica como estava.
    expect((await post(dev.headers, { value: 9, comment: 'sprint 2' })).statusCode).toBe(201)
    expect(await confidence()).toBe('AT_RISK')

    // Quem não pode registrar o check-in também não mexe na confiança.
    expect((await post(outsider.headers, { value: 1, comment: 'x', confidenceLevel: 'COMPLETED' })).statusCode).toBe(403)
    expect(await confidence()).toBe('AT_RISK')

    expect((await post(dev.headers, { value: 9, comment: 'x', confidenceLevel: 'TALVEZ' })).statusCode).toBe(400)
    await app.close()
  })

  it('administração de metas cria e edita ciclo; colaborador não', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await person(app, 'admin@x.com', 'ADMIN')
    const gente = await person(app, 'subadmin@x.com', 'SUBADMIN', 'company-emr', ['gente-gestao'])
    const dev = await person(app, 'dev@x.com')
    const novo = {
      name: 'Ciclo EMR - 2028',
      startDate: '2028-01-01',
      finishDate: '2028-12-31',
      forceCommentOnCheckIn: true,
    }
    const post = (headers: Record<string, string>, payload: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: '/okr/cycles', headers, payload })

    expect((await post(dev.headers, novo)).statusCode).toBe(403)
    const criado = await post(admin.headers, novo)
    expect(criado.statusCode, criado.body).toBe(201)
    // Sem semáforo informado, o ciclo nasce com as quatro faixas padrão.
    expect(criado.json().cycle).toMatchObject({ status: 'DRAFT', forceCommentOnCheckIn: true })
    expect(criado.json().cycle.progressRanges).toHaveLength(4)
    expect(criado.json().cycle.decimals).toEqual({ percentage: 2, numeric: 2, currency: 2 })

    // O SUBADMIN de Gente e Gestão é administração de metas: abre o ciclo.
    const aberto = await app.inject({
      method: 'PATCH',
      url: `/okr/cycles/${criado.json().cycle.id}`,
      headers: gente.headers,
      payload: { status: 'OPEN', name: 'Ciclo EMR - 2028 (revisado)' },
    })
    expect(aberto.statusCode, aberto.body).toBe(200)
    expect(aberto.json().cycle).toMatchObject({ status: 'OPEN', name: 'Ciclo EMR - 2028 (revisado)' })

    const doDev = await app.inject({
      method: 'PATCH',
      url: `/okr/cycles/${criado.json().cycle.id}`,
      headers: dev.headers,
      payload: { name: 'meu ciclo' },
    })
    expect(doDev.statusCode).toBe(403)
    await app.close()
  })

  it('ciclo recusa data invertida, janela fora do ciclo e semáforo com buraco', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await person(app, 'admin@x.com', 'ADMIN')
    const post = (payload: Record<string, unknown>) =>
      app.inject({ method: 'POST', url: '/okr/cycles', headers: admin.headers, payload })
    const base = { name: 'Ciclo', startDate: '2028-01-01', finishDate: '2028-12-31' }

    expect((await post({ ...base, finishDate: '2027-12-31' })).statusCode).toBe(422)
    expect((await post({ ...base, updateWindowStart: '2029-01-01' })).statusCode).toBe(422)
    expect((await post({ ...base, updateWindowStart: '2028-06-01', updateWindowFinish: '2028-05-01' })).statusCode).toBe(422)
    const comBuraco = await post({
      ...base,
      progressRanges: [
        { min: null, max: 30, color: '#eb5656' },
        { min: 40, max: null, color: '#86bd49' },
      ],
    })
    expect(comBuraco.statusCode).toBe(422)
    expect(comBuraco.json().message).toMatch(/contínuas/)
    await app.close()
  })

  it('ciclo encerrado barra check-in, e reabrir devolve a escrita', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await person(app, 'admin@x.com', 'ADMIN')
    const dev = await person(app, 'dev@x.com')
    const { id: cycleId } = await cycle()
    const { krId } = await seedGoal(app, admin, cycleId, dev.id)
    const checkIn = () =>
      app.inject({
        method: 'POST',
        url: `/okr/key-results/${krId}/check-ins`,
        headers: dev.headers,
        payload: { value: 8, comment: 'sprint' },
      })
    const setStatus = (status: string) =>
      app.inject({ method: 'PATCH', url: `/okr/cycles/${cycleId}`, headers: admin.headers, payload: { status } })

    expect((await setStatus('CLOSED')).statusCode).toBe(200)
    expect((await checkIn()).statusCode).toBe(403)
    expect((await setStatus('OPEN')).statusCode).toBe(200)
    expect((await checkIn()).statusCode).toBe(201)
    await app.close()
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID, EMR_VACATION_POLICY } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

let app: ReturnType<typeof buildApp>

beforeEach(async () => {
  app = buildApp()
  await app.ready()
})

let seq = 0
async function makeUser(
  role: 'LEGEND' | 'LEAD' | 'ADMIN' | 'SUBADMIN',
  extra: { managerId?: string; joinedAt?: Date; adminAccess?: boolean } = {},
) {
  seq += 1
  return prisma.user.create({
    data: {
      name: `Pessoa ${seq}`,
      email: `vp-${seq}-${Math.random()}@x.com`,
      passwordHash: 'x',
      role,
      sectorId: DEFAULT_SECTOR_ID,
      // Data-base padrão: quem entrou em 08/04/2025 fecha o 1º aquisitivo em
      // 07/04/2026 e o 2º em 07/04/2027 — a linha real da planilha da G&G.
      joinedAt: extra.joinedAt ?? new Date('2025-04-08T00:00:00Z'),
      ...(extra.adminAccess ? { adminAccess: true } : {}),
      ...(extra.managerId ? { managerId: extra.managerId } : {}),
    },
  })
}

function tokenFor(user: { id: string; role: string; adminAccess?: boolean }, features: string[] = []) {
  return app.jwt.sign({
    sub: user.id,
    role: user.role,
    sectorId: DEFAULT_SECTOR_ID,
    companyId: DEFAULT_COMPANY_ID,
    features,
    adminAccess: user.adminAccess === true,
  })
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` })

/** Abre a campanha pela rota da G&G — é ela que semeia os direitos. */
async function abrirCampanha(gente: { id: string; role: string }, over: Record<string, unknown> = {}) {
  return app.inject({
    method: 'PUT',
    url: '/admin/vacation-planning/campaign',
    headers: auth(tokenFor(gente, ['gente-gestao'])),
    payload: { year: 2027, opensAt: '2026-08-01', deadline: '2027-06-30', ...over },
  })
}

describe('campanha de férias', () => {
  it('abrir a campanha cria os direitos de quem já completou o aquisitivo', async () => {
    const gente = await makeUser('ADMIN')
    await makeUser('LEGEND')

    const res = await abrirCampanha(gente)

    expect(res.statusCode).toBe(200)
    expect(res.json().campaign.year).toBe(2027)
    // Sem semear, a G&G abriria uma campanha vazia e ninguém saberia por que os
    // cartões não aparecem.
    expect(res.json().entitlementsCreated).toBeGreaterThan(0)
  })

  it('o direito é derivado da admissão, com o limite de gozo em 11 meses', async () => {
    const gente = await makeUser('ADMIN')
    const pessoa = await makeUser('LEGEND')
    await abrirCampanha(gente)

    const direito = await prisma.vacationEntitlement.findFirst({
      where: { userId: pessoa.id },
      orderBy: { acquisitionEnd: 'desc' },
    })

    // Admissão 08/04/2025 → 2º aquisitivo fecha em 07/04/2027…
    expect(direito?.acquisitionEnd.toISOString().slice(0, 10)).toBe('2027-04-07')
    // …e o limite de gozo é 11 meses depois, que é a margem da EMPRESA sobre o
    // período concessivo legal de 12.
    expect(direito?.dueDate.toISOString().slice(0, 10)).toBe('2028-03-07')
  })

  it('a data-base do DP ganha da admissão', async () => {
    const gente = await makeUser('ADMIN')
    const pessoa = await makeUser('LEGEND')
    // Volta de afastamento pelo INSS: a contagem recomeça daqui.
    await app.inject({
      method: 'PATCH',
      url: `/admin/vacation-planning/users/${pessoa.id}/anchor`,
      headers: auth(tokenFor(gente, ['gente-gestao'])),
      payload: { anchorDate: '2025-06-01' },
    })

    await abrirCampanha(gente)

    const direito = await prisma.vacationEntitlement.findFirst({
      where: { userId: pessoa.id },
      orderBy: { acquisitionEnd: 'asc' },
    })
    // Volta em 01/06/2025 → o ciclo que fecha em 2027 vai até 31/05/2027, e não
    // até 07/04 como iria pela admissão.
    expect(direito?.acquisitionEnd.toISOString().slice(0, 10)).toBe('2027-05-31')
  })

  it('reabrir a campanha não duplica direito', async () => {
    const gente = await makeUser('ADMIN')
    await makeUser('LEGEND')
    await abrirCampanha(gente)
    const depoisDaPrimeira = await prisma.vacationEntitlement.count()

    const segunda = await abrirCampanha(gente, { deadline: '2027-07-31' })

    expect(segunda.json().entitlementsCreated).toBe(0)
    expect(await prisma.vacationEntitlement.count()).toBe(depoisDaPrimeira)
  })

  it('só o bloco de G&G abre campanha', async () => {
    const subadmin = await makeUser('SUBADMIN')
    const semFeature = await app.inject({
      method: 'PUT',
      url: '/admin/vacation-planning/campaign',
      headers: auth(tokenFor(subadmin, ['desenvolvimento-produto'])),
      payload: { year: 2027, opensAt: '2026-08-01', deadline: '2027-06-30' },
    })
    expect(semFeature.statusCode).toBe(403)
  })
})

/**
 * A conta que recebeu o switch de admin sem mudar de papel (`adminAccess`).
 * Ela administra a empresa inteira, mas continua LEGEND e não lidera ninguém —
 * é exatamente a combinação em que ler `role` cru a rebaixa a gestor comum.
 */
describe('acesso administrativo delegado', () => {
  async function cenario() {
    const delegada = await makeUser('LEGEND', { adminAccess: true })
    const lider = await makeUser('LEAD')
    const pessoa = await makeUser('LEGEND', { managerId: lider.id })
    return { delegada, lider, pessoa }
  }

  async function direitoDe(userId: string) {
    return (await prisma.vacationEntitlement.findFirst({
      where: { userId },
      orderBy: { acquisitionEnd: 'desc' },
    }))!
  }

  it('abre a campanha sem a feature de setor — o acesso delegado é pleno', async () => {
    const { delegada } = await cenario()

    const res = await app.inject({
      method: 'PUT',
      url: '/admin/vacation-planning/campaign',
      // Sem `gente-gestao` no token: quem passa aqui é o acesso delegado, não a
      // feature do setor dela.
      headers: auth(tokenFor(delegada)),
      payload: { year: 2027, opensAt: '2026-08-01', deadline: '2027-06-30' },
    })

    expect(res.statusCode).toBe(200)
  })

  it('programa as férias de quem não é liderado dela', async () => {
    const { delegada, pessoa } = await cenario()
    await abrirCampanha(delegada)
    const direito = await direitoDe(pessoa.id)

    const res = await app.inject({
      method: 'PUT',
      url: '/vacation-planning/plans',
      headers: auth(tokenFor(delegada)),
      payload: { entitlementId: direito.id, periods: [{ startDate: '2027-05-03', days: 30 }] },
    })

    expect(res.statusCode).toBe(200)
  })

  it('continua editando e confirmando depois de a campanha ser bloqueada', async () => {
    const { delegada, pessoa } = await cenario()
    // O bloqueio é o que trava o GESTOR. Quem administra edita depois dele —
    // senão a G&G delegada não conseguiria corrigir nada no fim da campanha.
    await abrirCampanha(delegada, { manuallyLocked: true })
    const direito = await direitoDe(pessoa.id)

    const salvo = await app.inject({
      method: 'PUT',
      url: '/vacation-planning/plans',
      headers: auth(tokenFor(delegada)),
      payload: { entitlementId: direito.id, periods: [{ startDate: '2027-05-03', days: 30 }] },
    })
    expect(salvo.statusCode).toBe(200)

    const confirmado = await app.inject({
      method: 'POST',
      url: '/vacation-planning/confirm',
      headers: auth(tokenFor(delegada)),
      payload: { entitlementIds: [direito.id] },
    })
    expect(confirmado.statusCode).toBe(200)
    expect(confirmado.json().confirmed).toBe(1)
  })
})

describe('a tela do gestor', () => {
  it('mostra um cartão por direito dos liderados diretos', async () => {
    const gente = await makeUser('ADMIN')
    const lider = await makeUser('LEAD')
    await makeUser('LEGEND', { managerId: lider.id })
    // Alguém de fora do time não pode aparecer.
    await makeUser('LEGEND')
    await abrirCampanha(gente)

    const res = await app.inject({
      method: 'GET',
      url: '/vacation-planning/team',
      headers: auth(tokenFor(lider)),
    })

    expect(res.statusCode).toBe(200)
    const planos = res.json().plans
    expect(planos.length).toBeGreaterThan(0)
    expect(new Set(planos.map((p: { user: { id: string } }) => p.user.id)).size).toBe(1)
  })

  it('quem não lidera ninguém não vê cartão nenhum', async () => {
    const gente = await makeUser('ADMIN')
    const sozinho = await makeUser('LEGEND')
    await abrirCampanha(gente)

    const res = await app.inject({
      method: 'GET',
      url: '/vacation-planning/team',
      headers: auth(tokenFor(sozinho)),
    })

    expect(res.json().plans).toEqual([])
  })

  it('sem campanha aberta, a tela não inventa dado', async () => {
    const lider = await makeUser('LEAD')
    await makeUser('LEGEND', { managerId: lider.id })

    const res = await app.inject({
      method: 'GET',
      url: '/vacation-planning/team',
      headers: auth(tokenFor(lider)),
    })

    expect(res.json()).toEqual({ campaign: null, plans: [], holidays: [], monthOverlaps: [] })
  })
})

describe('programar', () => {
  async function cenario() {
    const gente = await makeUser('ADMIN')
    const lider = await makeUser('LEAD')
    const pessoa = await makeUser('LEGEND', { managerId: lider.id })
    await abrirCampanha(gente)
    const direito = (await prisma.vacationEntitlement.findFirst({
      where: { userId: pessoa.id },
      orderBy: { acquisitionEnd: 'desc' },
    }))!
    return { gente, lider, pessoa, direito }
  }

  it('salva uma combinação válida e calcula o fim e o abono', async () => {
    const { lider, direito } = await cenario()

    const res = await app.inject({
      method: 'PUT',
      url: '/vacation-planning/plans',
      headers: auth(tokenFor(lider)),
      // 20 dias vendendo 10 — a primeira das cinco combinações.
      payload: { entitlementId: direito.id, periods: [{ startDate: '2027-05-03', days: 20 }] },
    })

    expect(res.statusCode).toBe(200)
    const plano = res.json().plan
    expect(plano.periods).toHaveLength(1)
    // Inclusivo nas duas pontas: 20 dias a partir de 03/05 terminam em 22/05.
    expect(plano.periods[0].endDate).toBe('2027-05-22')
    expect(plano.periods[0].soldDays).toBe(10)
    expect(plano.sellDays).toBe(true)
  })

  it('recusa programar as férias de quem não é do time (403)', async () => {
    const { direito } = await cenario()
    const estranho = await makeUser('LEGEND')

    const res = await app.inject({
      method: 'PUT',
      url: '/vacation-planning/plans',
      headers: auth(tokenFor(estranho)),
      payload: { entitlementId: direito.id, periods: [{ startDate: '2027-05-03', days: 20 }] },
    })

    expect(res.statusCode).toBe(403)
  })

  it('rascunho com erro pode ser salvo — confirmar é que não', async () => {
    const { lider, direito } = await cenario()
    // 07/05/2027 é uma sexta: quebra a regra do dia da semana.
    const salvo = await app.inject({
      method: 'PUT',
      url: '/vacation-planning/plans',
      headers: auth(tokenFor(lider)),
      payload: { entitlementId: direito.id, periods: [{ startDate: '2027-05-07', days: 30 }] },
    })
    // Perder o que já foi digitado por causa de uma data pela metade seria pior
    // do que guardar algo inválido.
    expect(salvo.statusCode).toBe(200)

    const confirmado = await app.inject({
      method: 'POST',
      url: '/vacation-planning/confirm',
      headers: auth(tokenFor(lider)),
      payload: { entitlementIds: [direito.id] },
    })
    expect(confirmado.statusCode).toBe(400)
    expect(confirmado.json().message).toContain('sexta-feira')
  })

  it('confirma em lote e carimba quem conferiu', async () => {
    const { lider, direito } = await cenario()
    await app.inject({
      method: 'PUT',
      url: '/vacation-planning/plans',
      headers: auth(tokenFor(lider)),
      payload: { entitlementId: direito.id, periods: [{ startDate: '2027-05-03', days: 30 }] },
    })

    const res = await app.inject({
      method: 'POST',
      url: '/vacation-planning/confirm',
      headers: auth(tokenFor(lider)),
      payload: { entitlementIds: [direito.id] },
    })

    expect(res.json().confirmed).toBe(1)
    const plano = await prisma.vacationPlan.findFirst({ where: { entitlementId: direito.id } })
    expect(plano?.status).toBe('CONFIRMED')
    expect(plano?.confirmedById).toBe(lider.id)
  })

  it('depois do prazo o gestor fica em somente leitura', async () => {
    const { gente, lider, direito } = await cenario()
    await abrirCampanha(gente, { manuallyLocked: true })

    const res = await app.inject({
      method: 'PUT',
      url: '/vacation-planning/plans',
      headers: auth(tokenFor(lider)),
      payload: { entitlementId: direito.id, periods: [{ startDate: '2027-05-03', days: 30 }] },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json().message).toContain('prazo')
  })

  it('a G&G reabre UM plano, e não o sistema inteiro', async () => {
    const { gente, lider, direito } = await cenario()
    await abrirCampanha(gente, { manuallyLocked: true })

    await app.inject({
      method: 'POST',
      url: '/admin/vacation-planning/unlock',
      headers: auth(tokenFor(gente, ['gente-gestao'])),
      payload: { entitlementId: direito.id, until: '2027-12-31' },
    })

    const res = await app.inject({
      method: 'PUT',
      url: '/vacation-planning/plans',
      headers: auth(tokenFor(lider)),
      payload: { entitlementId: direito.id, periods: [{ startDate: '2027-05-03', days: 30 }] },
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('validação da G&G', () => {
  async function programado(over: { days?: number; startDate?: string } = {}) {
    const gente = await makeUser('ADMIN')
    const lider = await makeUser('LEAD')
    const pessoa = await makeUser('LEGEND', { managerId: lider.id })
    await abrirCampanha(gente)
    const direito = (await prisma.vacationEntitlement.findFirst({
      where: { userId: pessoa.id },
      orderBy: { acquisitionEnd: 'desc' },
    }))!
    await app.inject({
      method: 'PUT',
      url: '/vacation-planning/plans',
      headers: auth(tokenFor(lider)),
      payload: {
        entitlementId: direito.id,
        periods: [{ startDate: over.startDate ?? '2027-05-03', days: over.days ?? 30 }],
      },
    })
    await app.inject({
      method: 'POST',
      url: '/vacation-planning/confirm',
      headers: auth(tokenFor(lider)),
      payload: { entitlementIds: [direito.id] },
    })
    return { gente, lider, pessoa, direito }
  }

  const validar = (gente: { id: string; role: string }, ids: string[]) =>
    app.inject({
      method: 'POST',
      url: '/admin/vacation-planning/validate',
      headers: auth(tokenFor(gente, ['gente-gestao'])),
      payload: { entitlementIds: ids },
    })

  it('a validação materializa o período no calendário', async () => {
    const { gente, pessoa, direito } = await programado()

    const res = await validar(gente, [direito.id])

    expect(res.json().validated).toBe(1)
    // É isto que faz a programação aparecer na Home, na Liderança e no perfil,
    // sem tela nova. Hoje ela morre num Excel.
    const ferias = await prisma.vacation.findMany({ where: { userId: pessoa.id } })
    expect(ferias).toHaveLength(1)
    expect(ferias[0]!.startDate.toISOString().slice(0, 10)).toBe('2027-05-03')
    expect(ferias[0]!.endDate.toISOString().slice(0, 10)).toBe('2027-06-01')
    expect(ferias[0]!.planPeriodId).not.toBeNull()
  })

  it('avisa o colaborador, que hoje descobre por e-mail depois de decidido', async () => {
    const { gente, pessoa, direito } = await programado()

    await validar(gente, [direito.id])

    const aviso = await prisma.notification.findFirst({
      where: { userId: pessoa.id, type: 'VACATION_PLAN_VALIDATED' },
    })
    expect(aviso).not.toBeNull()
    expect(aviso!.title).toContain('03/05/2027')
  })

  it('plano só confirmado pelo gestor ainda NÃO está no calendário', async () => {
    const { pessoa } = await programado()
    // Confirmado, não validado: até a G&G conferir é plano, e o calendário da
    // empresa não mostra plano como se fosse fato.
    expect(await prisma.vacation.count({ where: { userId: pessoa.id } })).toBe(0)
  })

  it('a campanha ganha do período lançado à mão que colide', async () => {
    const { gente, lider, pessoa, direito } = await programado()
    // Alguém já tinha lançado férias na mesma janela, à mão.
    await prisma.vacation.create({
      data: {
        userId: pessoa.id,
        startDate: new Date('2027-05-10T00:00:00Z'),
        endDate: new Date('2027-05-20T00:00:00Z'),
        createdById: lider.id,
        note: 'Lançado à mão',
      },
    })

    await validar(gente, [direito.id])

    const ferias = await prisma.vacation.findMany({ where: { userId: pessoa.id } })
    // Substituído, e não recusado: sem isso a materialização esbarraria na
    // regra de sobreposição de `createVacation`.
    expect(ferias).toHaveLength(1)
    expect(ferias[0]!.planPeriodId).not.toBeNull()
  })

  it('não encosta em férias fora da janela da campanha', async () => {
    const { gente, lider, pessoa, direito } = await programado()
    // Férias em curso, antes da abertura: não são da campanha de 2027.
    await prisma.vacation.create({
      data: {
        userId: pessoa.id,
        startDate: new Date('2026-08-03T00:00:00Z'),
        endDate: new Date('2026-08-14T00:00:00Z'),
        createdById: lider.id,
        note: 'Em curso',
      },
    })

    await validar(gente, [direito.id])

    const notas = (await prisma.vacation.findMany({ where: { userId: pessoa.id } })).map((v) => v.note)
    expect(notas).toContain('Em curso')
  })

  it('sobrescrever não é sumir em silêncio', async () => {
    const { gente, lider, pessoa, direito } = await programado()
    await prisma.vacation.create({
      data: {
        userId: pessoa.id,
        startDate: new Date('2027-05-10T00:00:00Z'),
        endDate: new Date('2027-05-20T00:00:00Z'),
        createdById: lider.id,
        note: 'Combinado antes',
      },
    })

    await validar(gente, [direito.id])

    const log = await prisma.adminAuditLog.findFirst({
      where: { entityType: 'VacationPlan', action: 'UPDATE' },
      orderBy: { createdAt: 'desc' },
    })
    expect(JSON.stringify(log?.before)).toContain('Combinado antes')
  })

  it('validar de novo não duplica o período no calendário', async () => {
    const { gente, pessoa, direito } = await programado()
    await validar(gente, [direito.id])
    // O segundo passe não tem o que validar (o plano já saiu de CONFIRMED).
    const segunda = await validar(gente, [direito.id])

    expect(segunda.statusCode).toBe(409)
    expect(await prisma.vacation.count({ where: { userId: pessoa.id } })).toBe(1)
  })

  it('recusa validar o que o gestor ainda não confirmou', async () => {
    const gente = await makeUser('ADMIN')
    const lider = await makeUser('LEAD')
    const pessoa = await makeUser('LEGEND', { managerId: lider.id })
    await abrirCampanha(gente)
    const direito = (await prisma.vacationEntitlement.findFirst({ where: { userId: pessoa.id } }))!

    const res = await validar(gente, [direito.id])

    expect(res.statusCode).toBe(409)
  })

  it('o painel da G&G conta o andamento por setor', async () => {
    const { gente, direito } = await programado()
    await validar(gente, [direito.id])

    const res = await app.inject({
      method: 'GET',
      url: '/admin/vacation-planning/overview',
      headers: auth(tokenFor(gente, ['gente-gestao'])),
    })

    expect(res.statusCode).toBe(200)
    const linha = res.json().progress[0]
    expect(linha.validated).toBe(1)
  })
})

describe('o lado do colaborador', () => {
  async function cenario() {
    const gente = await makeUser('ADMIN')
    const lider = await makeUser('LEAD')
    const pessoa = await makeUser('LEGEND', { managerId: lider.id })
    await abrirCampanha(gente)
    const direito = (await prisma.vacationEntitlement.findFirst({
      where: { userId: pessoa.id },
      orderBy: { acquisitionEnd: 'desc' },
    }))!
    return { gente, lider, pessoa, direito }
  }

  it('a pessoa vê os próprios direitos, do mais urgente ao menos', async () => {
    const { pessoa, direito } = await cenario()
    // Dois aquisitivos em aberto é caso real (26 das 86 pessoas da planilha da
    // G&G), mas não sai da derivação: quem sabe o que já foi gozado é o saldo,
    // que vem da folha. Aqui o segundo direito entra como o DP o criaria.
    await prisma.vacationEntitlement.create({
      data: {
        userId: pessoa.id,
        companyId: DEFAULT_COMPANY_ID,
        acquisitionStart: new Date('2025-04-08T00:00:00Z'),
        acquisitionEnd: new Date('2026-04-07T00:00:00Z'),
        dueDate: new Date('2027-03-07T00:00:00Z'),
        balanceDays: 10,
      },
    })

    const res = await app.inject({
      method: 'GET',
      url: '/me/vacation-planning',
      headers: auth(tokenFor(pessoa)),
    })

    expect(res.statusCode).toBe(200)
    const itens = res.json().items as { entitlement: { id: string; dueDate: string; balanceDays: number } }[]
    expect(itens.length).toBe(2)
    // Ordenados pelo limite: primeiro o que vence antes.
    expect(itens[0]!.entitlement.dueDate).toBe('2027-03-07')
    const atual = itens.find((i) => i.entitlement.id === direito.id)!
    expect(atual.entitlement.balanceDays).toBe(30)
    expect(atual.entitlement.dueDate).toBe('2028-03-07')
  })

  it('registra o pedido, e o gestor vê ao programar', async () => {
    const { lider, pessoa, direito } = await cenario()

    const pedido = await app.inject({
      method: 'PUT',
      url: '/me/vacation-planning/request',
      headers: auth(tokenFor(pessoa)),
      payload: {
        entitlementId: direito.id,
        periods: [{ startDate: '2027-07-05', days: 20 }],
        note: 'Casamento em julho, se der.',
      },
    })
    expect(pedido.statusCode).toBe(200)

    // É o ponto do pedido existir: aparecer ANTES de o gestor decidir.
    const doLider = await app.inject({
      method: 'GET',
      url: '/vacation-planning/team',
      headers: auth(tokenFor(lider)),
    })
    // Pela pessoa não basta: ela tem dois direitos abertos, e o pedido é de um.
    const plano = doLider
      .json()
      .plans.find((p: { entitlement: { id: string } }) => p.entitlement.id === direito.id)
    expect(plano.request.periods).toEqual([{ startDate: '2027-07-05', days: 20 }])
    expect(plano.request.note).toContain('Casamento')
  })

  it('atualizar o pedido substitui, não acumula', async () => {
    const { pessoa, direito } = await cenario()
    const pedir = (startDate: string) =>
      app.inject({
        method: 'PUT',
        url: '/me/vacation-planning/request',
        headers: auth(tokenFor(pessoa)),
        payload: { entitlementId: direito.id, periods: [{ startDate, days: 30 }] },
      })

    await pedir('2027-07-05')
    await pedir('2027-09-06')

    expect(await prisma.vacationRequest.count({ where: { entitlementId: direito.id } })).toBe(1)
    const res = await app.inject({
      method: 'GET',
      url: '/me/vacation-planning',
      headers: auth(tokenFor(pessoa)),
    })
    const item = (res.json().items as { entitlement: { id: string }; request: { periods: { startDate: string }[] } | null }[])
      .find((i) => i.entitlement.id === direito.id)!
    expect(item.request!.periods[0]!.startDate).toBe('2027-09-06')
  })

  it('ninguém pede férias em nome de outra pessoa', async () => {
    const { direito } = await cenario()
    const estranho = await makeUser('LEGEND')

    const res = await app.inject({
      method: 'PUT',
      url: '/me/vacation-planning/request',
      headers: auth(tokenFor(estranho)),
      payload: { entitlementId: direito.id, periods: [{ startDate: '2027-07-05', days: 30 }] },
    })

    // Sem esta checagem, trocar o id na requisição bastaria.
    expect(res.statusCode).toBe(404)
  })

  it('o pedido não passa pelas combinações — é pedido, não programação', async () => {
    const { pessoa, direito } = await cenario()

    // 7 dias não é combinação nenhuma, e numa sexta-feira ainda por cima.
    const res = await app.inject({
      method: 'PUT',
      url: '/me/vacation-planning/request',
      headers: auth(tokenFor(pessoa)),
      payload: { entitlementId: direito.id, periods: [{ startDate: '2027-07-09', days: 7 }] },
    })

    // Recusar "queria uma semana em julho" transformaria a conversa num
    // formulário, que é exatamente o que este campo evita.
    expect(res.statusCode).toBe(200)
  })

  it('sem campanha aberta a pessoa não vê nada inventado', async () => {
    const sozinho = await makeUser('LEGEND')

    const res = await app.inject({
      method: 'GET',
      url: '/me/vacation-planning',
      headers: auth(tokenFor(sozinho)),
    })

    expect(res.json()).toEqual({ campaign: null, items: [] })
  })
})

describe('planilha consolidada', () => {
  async function cenario() {
    const gente = await makeUser('ADMIN')
    const lider = await makeUser('LEAD')
    const pessoa = await makeUser('LEGEND', { managerId: lider.id })
    await abrirCampanha(gente)
    const direito = (await prisma.vacationEntitlement.findFirst({
      where: { userId: pessoa.id },
      orderBy: { acquisitionEnd: 'desc' },
    }))!
    await app.inject({
      method: 'PUT',
      url: '/vacation-planning/plans',
      headers: auth(tokenFor(lider)),
      payload: { entitlementId: direito.id, periods: [{ startDate: '2027-05-03', days: 20 }] },
    })
    return { gente, lider, pessoa, direito }
  }

  it('sai no cabeçalho que o DP já lê, com BOM e ponto e vírgula', async () => {
    const { gente } = await cenario()

    const res = await app.inject({
      method: 'GET',
      url: '/admin/vacation-planning/export',
      headers: auth(tokenFor(gente, ['gente-gestao'])),
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    // BOM: é o que faz o Excel em pt-BR abrir sem pedir importação.
    expect(res.body.startsWith('﻿')).toBe(true)
    const cabecalho = res.body.split('\n')[0]!
    expect(cabecalho).toContain('Empregado;Centro de Custo;Squad;Lider')
    // A capitalização estranha é a do arquivo original, e fica de propósito.
    expect(cabecalho).toContain('InIcio Aquisitivo')
  })

  it('traz os períodos programados e o abono', async () => {
    const { gente, pessoa } = await cenario()

    const res = await app.inject({
      method: 'GET',
      url: '/admin/vacation-planning/export',
      headers: auth(tokenFor(gente, ['gente-gestao'])),
    })

    // Pelo nome não basta: a pessoa tem DOIS direitos abertos e sai em duas
    // linhas — a primeira é a do aquisitivo antigo, sem período nenhum.
    const linha = res.body
      .split('\n')
      .find((l: string) => l.includes(pessoa.name) && l.includes('07/04/2027'))!
    expect(linha).toContain('20;03/05/2027;22/05/2027;10')
    // 20 dias de descanso + 10 vendidos zeram o saldo de 30.
    expect(linha).toContain(';0;Em preenchimento')
  })

  it('o gestor baixa a própria estrutura, não a empresa', async () => {
    const { lider, pessoa } = await cenario()
    const deOutroTime = await makeUser('LEGEND')

    const res = await app.inject({
      method: 'GET',
      url: '/vacation-planning/export',
      headers: auth(tokenFor(lider)),
    })

    expect(res.body).toContain(pessoa.name)
    expect(res.body).not.toContain(deOutroTime.name)
  })

  it('quem não lidera ninguém leva só o cabeçalho', async () => {
    const { gente } = await cenario()
    const sozinho = await makeUser('LEGEND')
    void gente

    const res = await app.inject({
      method: 'GET',
      url: '/vacation-planning/export',
      headers: auth(tokenFor(sozinho)),
    })

    // Melhor do que devolver a empresa inteira por um recorte vazio ter virado
    // "sem filtro" — que é o erro clássico de `undefined` num `where`.
    expect(res.body.trim().split('\n')).toHaveLength(1)
  })

  it('colaborador não baixa o consolidado da empresa', async () => {
    const { pessoa } = await cenario()

    const res = await app.inject({
      method: 'GET',
      url: '/admin/vacation-planning/export',
      headers: auth(tokenFor(pessoa)),
    })

    expect(res.statusCode).toBe(403)
  })
})

describe('semeadura dos direitos', () => {
  it('cria só o ciclo que se completa no ano da campanha', async () => {
    const gente = await makeUser('ADMIN')
    // Admitida em 2019: tem oito ciclos completos, mas sete já foram
    // programados em campanhas passadas.
    const veterana = await makeUser('LEGEND', { joinedAt: new Date('2019-02-01T00:00:00Z') })

    await abrirCampanha(gente)

    const direitos = await prisma.vacationEntitlement.findMany({
      where: { userId: veterana.id },
      orderBy: { acquisitionEnd: 'asc' },
    })
    expect(direitos).toHaveLength(1)
    expect(direitos[0]!.acquisitionEnd.toISOString().slice(0, 10)).toBe('2027-01-31')
  })

  it('quem tem dois aquisitivos em aberto entra pela correção do DP, não pela derivação', async () => {
    const gente = await makeUser('ADMIN')
    const pessoa = await makeUser('LEGEND')
    await abrirCampanha(gente)

    // A derivação não tem como saber o que já foi gozado — quem sabe é o saldo,
    // que vem da folha.
    expect(await prisma.vacationEntitlement.count({ where: { userId: pessoa.id } })).toBe(1)
  })
})

describe('colaborador PJ', () => {
  async function pjComDireito() {
    const gente = await makeUser('ADMIN')
    const lider = await makeUser('LEAD')
    const pessoa = await makeUser('LEGEND', { managerId: lider.id })
    // Marcado pela TELA — que é o caminho que a carga em lote não apaga.
    await app.inject({
      method: 'PATCH',
      url: `/admin/vacation-planning/users/${pessoa.id}/employment`,
      headers: auth(tokenFor(gente, ['gente-gestao'])),
      payload: { employmentType: 'PJ' },
    })
    await abrirCampanha(gente)
    const direito = (await prisma.vacationEntitlement.findFirst({
      where: { userId: pessoa.id },
      orderBy: { acquisitionEnd: 'desc' },
    }))!
    return { gente, lider, pessoa, direito }
  }

  it('nasce com 20 dias, não com 30', async () => {
    const { direito } = await pjComDireito()
    expect(direito.balanceDays).toBe(20)
  })

  it('o cartão do gestor diz que é PJ', async () => {
    const { lider, direito } = await pjComDireito()

    const res = await app.inject({
      method: 'GET',
      url: '/vacation-planning/team',
      headers: auth(tokenFor(lider)),
    })

    const plano = res
      .json()
      .plans.find((p: { entitlement: { id: string } }) => p.entitlement.id === direito.id)
    expect(plano.entitlement.employmentType).toBe('PJ')
    expect(plano.entitlement.balanceDays).toBe(20)
  })

  it('aceita divisão livre e sexta-feira, que a CLT recusaria', async () => {
    const { lider, direito } = await pjComDireito()

    const salvo = await app.inject({
      method: 'PUT',
      url: '/vacation-planning/plans',
      headers: auth(tokenFor(lider)),
      // 07/05/2027 é sexta, e 7+13 não é combinação nenhuma da EMR.
      payload: {
        entitlementId: direito.id,
        periods: [
          { startDate: '2027-05-07', days: 7 },
          { startDate: '2027-07-05', days: 13 },
        ],
      },
    })
    expect(salvo.statusCode).toBe(200)
    expect(salvo.json().plan.sellDays).toBe(false)

    // E confirma, que é o que a CLT barraria.
    const confirmado = await app.inject({
      method: 'POST',
      url: '/vacation-planning/confirm',
      headers: auth(tokenFor(lider)),
      payload: { entitlementIds: [direito.id] },
    })
    expect(confirmado.statusCode).toBe(200)
    expect(confirmado.json().confirmed).toBe(1)
  })

  it('não vende dias — abono é da CLT', async () => {
    const { lider, direito } = await pjComDireito()
    await app.inject({
      method: 'PUT',
      url: '/vacation-planning/plans',
      headers: auth(tokenFor(lider)),
      payload: { entitlementId: direito.id, periods: [{ startDate: '2027-05-03', days: 20 }] },
    })

    const periodo = await prisma.vacationPlanPeriod.findFirst({
      where: { plan: { entitlementId: direito.id } },
    })
    expect(periodo?.soldDays).toBe(0)
  })

  it('mas o saldo continua sendo teto', async () => {
    const { lider, direito } = await pjComDireito()
    await app.inject({
      method: 'PUT',
      url: '/vacation-planning/plans',
      headers: auth(tokenFor(lider)),
      payload: { entitlementId: direito.id, periods: [{ startDate: '2027-05-03', days: 25 }] },
    })

    const res = await app.inject({
      method: 'POST',
      url: '/vacation-planning/confirm',
      headers: auth(tokenFor(lider)),
      payload: { entitlementIds: [direito.id] },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toContain('passou do saldo')
  })

  it('o CLT do mesmo time segue com 30 dias e as combinações', async () => {
    const { gente, lider } = await pjComDireito()
    const clt = await makeUser('LEGEND', { managerId: lider.id })
    await abrirCampanha(gente)
    const direitoClt = (await prisma.vacationEntitlement.findFirst({
      where: { userId: clt.id },
      orderBy: { acquisitionEnd: 'desc' },
    }))!

    expect(direitoClt.balanceDays).toBe(30)
    // Sexta-feira continua recusada para quem é CLT.
    await app.inject({
      method: 'PUT',
      url: '/vacation-planning/plans',
      headers: auth(tokenFor(lider)),
      payload: { entitlementId: direitoClt.id, periods: [{ startDate: '2027-05-07', days: 30 }] },
    })
    const res = await app.inject({
      method: 'POST',
      url: '/vacation-planning/confirm',
      headers: auth(tokenFor(lider)),
      payload: { entitlementIds: [direitoClt.id] },
    })
    expect(res.json().message).toContain('sexta-feira')
  })

  it('só o bloco de G&G marca o regime', async () => {
    const gente = await makeUser('ADMIN')
    const qualquer = await makeUser('LEGEND')
    void gente

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/vacation-planning/users/${qualquer.id}/employment`,
      headers: auth(tokenFor(qualquer)),
      payload: { employmentType: 'PJ' },
    })
    expect(res.statusCode).toBe(403)
  })
})

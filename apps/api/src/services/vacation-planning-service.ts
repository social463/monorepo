/**
 * Programação anual de férias — fase 1.
 *
 * Spec: docs/superpowers/specs/2026-08-25-programacao-anual-de-ferias-design.md
 *
 * Quatro substantivos, e não um: o **direito** (período aquisitivo, saldo,
 * limite), a **campanha** (prazo e a regra vigente), o **plano** (o que o gestor
 * programou) e o `Vacation` que já existia — o que virou realidade.
 *
 * A validação da G&G é o que **materializa** `Vacation`. Até lá é plano, e o
 * calendário da empresa não mostra plano como se fosse fato.
 */
import {
  DEFAULT_VACATION_NOTICE_TEMPLATE,
  EMR_VACATION_POLICY,
  FULL_VACATION_BALANCE,
  acquisitionEndFor,
  acquisitionStartFor,
  canAdminister,
  dueDateFor,
  formatCivilDate,
  matchSplit,
  periodEndDate,
  renderVacationNotice,
  soldDaysPerPeriod,
  teamMonthOverlaps,
  validateVacationPlan,
  type PlannedPeriod,
  type VacationCampaignDTO,
  type EmploymentType,
  type MyVacationPlanningResponse,
  type VacationCampaignOverviewResponse,
  type VacationPlanDTO,
  type VacationPlanningResponse,
  type VacationPolicy,
} from '@legends/shared'
import type { Prisma, User } from '@prisma/client'
import { csvCell } from '../lib/csv'
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'
import { dayFromYmd, todayInSaoPaulo, ymdOf } from '../lib/sao-paulo-date'
import { toPublicUser } from '../lib/serialize'
import { listManagedGroups, managesUser } from './team-scope-service'
import { createNotification } from './notification-service'
import { recordAuditLog } from './audit-log-service'

export class VacationPlanningError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message)
    this.name = 'VacationPlanningError'
  }
}

/** Papéis fora do quadro de férias — os mesmos de `vacation-service`. */
const OUT_OF_SCOPE_ROLES = ['ADMIN', 'SUBADMIN', 'THIRD_PARTY'] as const

// ---------------------------------------------------------------------------
// Campanha
// ---------------------------------------------------------------------------

function readPolicy(raw: Prisma.JsonValue | null): VacationPolicy {
  // Política congelada na campanha. Se vier corrompida ou de uma versão antiga
  // sem algum campo, o preset preenche o buraco em vez de derrubar a tela.
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return EMR_VACATION_POLICY
  return { ...EMR_VACATION_POLICY, ...(raw as unknown as Partial<VacationPolicy>) }
}

function campaignLocked(campaign: { deadline: Date; manuallyLocked: boolean }, today: string): boolean {
  return campaign.manuallyLocked || today > ymdOf(campaign.deadline)
}

type CampaignRow = {
  id: string
  year: number
  opensAt: Date
  deadline: Date
  manuallyLocked: boolean
  policy: Prisma.JsonValue
  noticeTemplate: string
}

function toCampaignDTO(row: CampaignRow, today: string): VacationCampaignDTO {
  return {
    id: row.id,
    year: row.year,
    opensAt: ymdOf(row.opensAt),
    deadline: ymdOf(row.deadline),
    manuallyLocked: row.manuallyLocked,
    locked: campaignLocked(row, today),
    policy: readPolicy(row.policy),
    noticeTemplate: row.noticeTemplate || DEFAULT_VACATION_NOTICE_TEMPLATE,
  }
}

/**
 * A campanha corrente: a mais recente já aberta. Campanha do ano que vem
 * cadastrada com antecedência não aparece antes de `opensAt` — senão o gestor
 * programaria 2029 enquanto 2028 ainda está em aberto.
 */
async function currentCampaign(companyId: string, today: string) {
  return scopedPrisma(companyId).vacationCampaign.findFirst({
    where: { opensAt: { lte: dayFromYmd(today) } },
    orderBy: { year: 'desc' },
  })
}

export async function upsertCampaign(
  actorId: string,
  input: {
    year: number
    opensAt: string
    deadline: string
    manuallyLocked?: boolean
    noticeTemplate?: string
  },
): Promise<VacationCampaignDTO> {
  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { companyId: true } })
  if (!actor) throw new VacationPlanningError('Usuário não encontrado.', 404)
  if (input.deadline < input.opensAt) {
    throw new VacationPlanningError('O prazo não pode ser anterior à abertura da campanha.')
  }

  const db = scopedPrisma(actor.companyId)
  const existing = await db.vacationCampaign.findFirst({ where: { year: input.year } })
  const data = {
    opensAt: dayFromYmd(input.opensAt),
    deadline: dayFromYmd(input.deadline),
    manuallyLocked: input.manuallyLocked ?? false,
    ...(input.noticeTemplate !== undefined ? { noticeTemplate: input.noticeTemplate } : {}),
  }

  const row = existing
    ? await db.vacationCampaign.update({ where: { id: existing.id }, data })
    : await db.vacationCampaign.create({
        data: {
          ...data,
          year: input.year,
          companyId: actor.companyId,
          // A regra vigente é copiada para dentro da campanha no momento em que
          // ela nasce. Depois disso ela não acompanha mudança de preset.
          policy: EMR_VACATION_POLICY as unknown as Prisma.InputJsonValue,
          noticeTemplate: input.noticeTemplate ?? DEFAULT_VACATION_NOTICE_TEMPLATE,
        },
      })

  await recordAuditLog({
    actorId,
    companyId: actor.companyId,
    entityType: 'VacationCampaign',
    entityId: row.id,
    action: existing ? 'UPDATE' : 'CREATE',
    before: existing ? { deadline: ymdOf(existing.deadline), manuallyLocked: existing.manuallyLocked } : null,
    after: { deadline: ymdOf(row.deadline), manuallyLocked: row.manuallyLocked },
  })

  return toCampaignDTO(row, todayInSaoPaulo().ymd)
}

// ---------------------------------------------------------------------------
// Direito
// ---------------------------------------------------------------------------

/** A data-base de férias: a correção do DP quando existe, senão a admissão. */
export function anchorDateOf(user: { vacationAnchorDate: Date | null; joinedAt: Date }): string {
  return ymdOf(user.vacationAnchorDate ?? user.joinedAt)
}

/**
 * Cria os direitos que faltam para a campanha, derivando da data-base.
 *
 * Idempotente por `(empresa, pessoa, fim do aquisitivo)`: rodar de novo não
 * duplica nem sobrescreve o que a G&G já corrigiu à mão. É por isso que a
 * correção de saldo sobrevive à sincronização seguinte.
 */
export async function syncEntitlements(companyId: string, campaign: { year: number; policy: VacationPolicy }) {
  const db = scopedPrisma(companyId)
  const people = await db.user.findMany({
    where: { active: true, role: { notIn: [...OUT_OF_SCOPE_ROLES] } },
    select: { id: true, joinedAt: true, vacationAnchorDate: true, employmentType: true },
  })

  const existing = await db.vacationEntitlement.findMany({ select: { userId: true, acquisitionEnd: true } })
  const seen = new Set(existing.map((e) => `${e.userId}|${ymdOf(e.acquisitionEnd)}`))

  const toCreate: Prisma.VacationEntitlementCreateManyInput[] = []
  for (const person of people) {
    const anchor = anchorDateOf(person)
    // O ciclo programado na campanha do ano N é o que se completa até o fim de N.
    for (let cycle = 1; cycle <= 60; cycle += 1) {
      const acquisitionEnd = acquisitionEndFor(anchor, cycle)
      if (acquisitionEnd > `${campaign.year}-12-31`) break
      // **Só o ciclo que se completa NO ano da campanha.** Ciclos anteriores já
      // foram programados nas campanhas passadas — semear o de 2026 junto com o
      // de 2027 daria dois cartões a quase todo mundo, quando o caso real de
      // dois aquisitivos em aberto é minoria (26 das 86 pessoas da planilha da
      // G&G).
      //
      // Quem de fato tem um ciclo antigo em aberto entra pela correção do DP ou
      // pela importação da folha — é lá que mora o saldo, e é o saldo que sabe
      // o que já foi gozado. A derivação não tem como saber isso sozinha.
      if (acquisitionEnd < `${campaign.year}-01-01`) continue
      if (seen.has(`${person.id}|${acquisitionEnd}`)) continue
      toCreate.push({
        userId: person.id,
        companyId,
        acquisitionStart: dayFromYmd(acquisitionStartFor(anchor, cycle)),
        acquisitionEnd: dayFromYmd(acquisitionEnd),
        dueDate: dayFromYmd(dueDateFor(acquisitionEnd, campaign.policy)),
        // O PJ tem outro padrão: 20 dias, não 30. Sem isto ele nasce com o
        // saldo da CLT e o gestor programa 30 dias que não existem.
        balanceDays:
          person.employmentType === 'PJ'
            ? campaign.policy.pj.balanceDays
            : FULL_VACATION_BALANCE,
      })
      seen.add(`${person.id}|${acquisitionEnd}`)
    }
  }

  if (toCreate.length) await db.vacationEntitlement.createMany({ data: toCreate })
  return toCreate.length
}

export async function correctEntitlement(
  actorId: string,
  entitlementId: string,
  input: {
    balanceDays?: number
    acquisitionStart?: string
    acquisitionEnd?: string
    dueDate?: string
    note?: string | null
  },
) {
  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { companyId: true } })
  if (!actor) throw new VacationPlanningError('Usuário não encontrado.', 404)

  const db = scopedPrisma(actor.companyId)
  const before = await db.vacationEntitlement.findFirst({ where: { id: entitlementId } })
  if (!before) throw new VacationPlanningError('Direito não encontrado.', 404)

  const after = await db.vacationEntitlement.update({
    where: { id: entitlementId },
    data: {
      ...(input.balanceDays !== undefined ? { balanceDays: input.balanceDays } : {}),
      ...(input.acquisitionStart ? { acquisitionStart: dayFromYmd(input.acquisitionStart) } : {}),
      ...(input.acquisitionEnd ? { acquisitionEnd: dayFromYmd(input.acquisitionEnd) } : {}),
      ...(input.dueDate ? { dueDate: dayFromYmd(input.dueDate) } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
    },
  })

  await recordAuditLog({
    actorId,
    companyId: actor.companyId,
    entityType: 'VacationEntitlement',
    entityId: entitlementId,
    action: 'UPDATE',
    before: { balanceDays: before.balanceDays, dueDate: ymdOf(before.dueDate), note: before.note },
    after: { balanceDays: after.balanceDays, dueDate: ymdOf(after.dueDate), note: after.note },
  })
  return after
}

/**
 * Grava a data-base de férias de alguém (volta de afastamento pelo INSS).
 *
 * É a **tela** que grava isso, nunca a importação por planilha: apagar uma
 * célula sem querer reverteria a pessoa para a admissão em silêncio, e o erro
 * só apareceria na programação do ano seguinte.
 */
export async function setVacationAnchorDate(actorId: string, userId: string, anchorDate: string | null) {
  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { companyId: true } })
  if (!actor) throw new VacationPlanningError('Usuário não encontrado.', 404)

  const db = scopedPrisma(actor.companyId)
  const before = await db.user.findFirst({ where: { id: userId }, select: { vacationAnchorDate: true } })
  if (!before) throw new VacationPlanningError('Pessoa não encontrada.', 404)

  await db.user.update({
    where: { id: userId },
    data: { vacationAnchorDate: anchorDate ? dayFromYmd(anchorDate) : null },
  })
  await recordAuditLog({
    actorId,
    companyId: actor.companyId,
    entityType: 'User',
    entityId: userId,
    action: 'UPDATE',
    before: { vacationAnchorDate: before.vacationAnchorDate ? ymdOf(before.vacationAnchorDate) : null },
    after: { vacationAnchorDate: anchorDate },
  })
}

/**
 * Marca o regime de contratação de alguém.
 *
 * Anda junto da data-base e pelo mesmo motivo: é fato do contrato da pessoa,
 * vale uma vez na vida dela e **não pode ser apagado por uma carga em lote com
 * a coluna vazia**. A planilha preenche em massa na primeira vez; daí em diante
 * quem corrige é esta tela.
 */
export async function setEmploymentType(actorId: string, userId: string, employmentType: EmploymentType) {
  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { companyId: true } })
  if (!actor) throw new VacationPlanningError('Usuário não encontrado.', 404)

  const db = scopedPrisma(actor.companyId)
  const before = await db.user.findFirst({ where: { id: userId }, select: { employmentType: true } })
  if (!before) throw new VacationPlanningError('Pessoa não encontrada.', 404)

  await db.user.update({ where: { id: userId }, data: { employmentType } })
  await recordAuditLog({
    actorId,
    companyId: actor.companyId,
    entityType: 'User',
    entityId: userId,
    action: 'UPDATE',
    before: { employmentType: before.employmentType },
    after: { employmentType },
  })
}

// ---------------------------------------------------------------------------
// Feriados: vêm do calendário da empresa, não de lista cravada
// ---------------------------------------------------------------------------

/**
 * Feriados da empresa na janela, como `YYYY-MM-DD` → nome.
 *
 * Lê o calendário (`CalendarEvent` da categoria `feriado`), que a G&G já
 * importa por planilha. A ferramenta de origem cravava Recife/PE de 2026 a
 * 2028 no código — o que entrega a regra da EMR para o próximo cliente e vence
 * em 2029.
 */
export async function companyHolidays(companyId: string, from: string, to: string) {
  const rows = await scopedPrisma(companyId).calendarEvent.findMany({
    where: { type: { slug: 'feriado' }, date: { gte: dayFromYmd(from), lte: dayFromYmd(to) } },
    select: { date: true, title: true },
    orderBy: { date: 'asc' },
  })
  const map = new Map<string, string>()
  for (const row of rows) map.set(ymdOf(row.date), row.title)
  return map
}

// ---------------------------------------------------------------------------
// A tela do gestor
// ---------------------------------------------------------------------------

const PLAN_INCLUDE = {
  periods: { orderBy: { startDate: 'asc' } },
  confirmedBy: { select: { name: true } },
  validatedBy: { select: { name: true } },
} as const

/**
 * O que o gestor vê: um cartão por DIREITO dos liderados diretos.
 *
 * Por direito, e não por pessoa — quem tem dois períodos aquisitivos em aberto
 * aparece em dois cartões, cada um com o próprio limite de gozo. Na planilha de
 * origem isso é quase um terço do quadro.
 *
 * Ordenado por limite de gozo: o custo real de uma programação malfeita é
 * pagamento em dobro, então quem está prestes a perder férias vem primeiro.
 */
export async function getTeamPlanning(viewerId: string): Promise<VacationPlanningResponse> {
  const viewer = await prisma.user.findUnique({ where: { id: viewerId }, select: { companyId: true } })
  if (!viewer) throw new VacationPlanningError('Usuário não encontrado.', 404)

  const today = todayInSaoPaulo().ymd
  const campaignRow = await currentCampaign(viewer.companyId, today)
  if (!campaignRow) return { campaign: null, plans: [], holidays: [], monthOverlaps: [] }

  const campaign = toCampaignDTO(campaignRow, today)
  const groups = await listManagedGroups(viewerId)
  const members = groups.flatMap((g) => g.members)
  if (members.length === 0) return { campaign, plans: [], holidays: [], monthOverlaps: [] }

  return buildPlanning(viewer.companyId, campaign, campaignRow.id, members, today)
}

async function buildPlanning(
  companyId: string,
  campaign: VacationCampaignDTO,
  campaignId: string,
  members: User[],
  today: string,
): Promise<VacationPlanningResponse> {
  const db = scopedPrisma(companyId)
  const memberIds = members.map((m) => m.id)

  const entitlements = await db.vacationEntitlement.findMany({
    where: { userId: { in: memberIds } },
    orderBy: { dueDate: 'asc' },
    include: { request: true, user: { select: { employmentType: true } } },
  })
  const plans = await db.vacationPlan.findMany({
    where: { campaignId, entitlementId: { in: entitlements.map((e) => e.id) } },
    include: PLAN_INCLUDE,
  })
  const planByEntitlement = new Map(plans.map((p) => [p.entitlementId, p]))

  // Férias já lançadas à mão que a validação vai substituir. Aparecem AQUI, na
  // hora de programar, e não na validação: um período lançado à mão costuma ter
  // um motivo, e quem programa precisa ver que está passando por cima dele.
  const manual = await db.vacation.findMany({
    where: {
      userId: { in: memberIds },
      planPeriodId: null,
      startDate: { gte: dayFromYmd(campaign.policy.minStartDate) },
    },
    select: { userId: true, startDate: true, endDate: true, note: true },
  })

  const holidayWindow = await companyHolidays(
    companyId,
    campaign.policy.minStartDate,
    `${campaign.year + 2}-12-31`,
  )

  const memberById = new Map(members.map((m) => [m.id, m]))
  const dtos: VacationPlanDTO[] = entitlements.map((entitlement) => {
    const plan = planByEntitlement.get(entitlement.id) ?? null
    const user = memberById.get(entitlement.userId)!
    const dueDate = ymdOf(entitlement.dueDate)
    return {
      id: plan?.id ?? null,
      user: toPublicUser(user),
      entitlement: {
        id: entitlement.id,
        employmentType: entitlement.user.employmentType,
        acquisitionStart: ymdOf(entitlement.acquisitionStart),
        acquisitionEnd: ymdOf(entitlement.acquisitionEnd),
        dueDate,
        balanceDays: entitlement.balanceDays,
        note: entitlement.note,
        daysToDueDate: Math.round(
          (dayFromYmd(dueDate).getTime() - dayFromYmd(today).getTime()) / 86_400_000,
        ),
      },
      periods: (plan?.periods ?? []).map((p) => ({
        startDate: ymdOf(p.startDate),
        endDate: ymdOf(p.endDate),
        days: p.days,
        soldDays: p.soldDays,
      })),
      sellDays: plan?.sellDays ?? false,
      note: plan?.note ?? null,
      status: plan?.status ?? 'DRAFT',
      changeRequested: plan?.changeRequested ?? false,
      confirmedBy: plan?.confirmedBy?.name ?? null,
      confirmedAt: plan?.confirmedAt?.toISOString() ?? null,
      validatedBy: plan?.validatedBy?.name ?? null,
      validatedAt: plan?.validatedAt?.toISOString() ?? null,
      unlockedUntil: plan?.unlockedUntil?.toISOString() ?? null,
      request: entitlement.request
        ? {
            periods: readRequestPeriods(entitlement.request.periods),
            note: entitlement.request.note,
          }
        : null,
      replacing: manual
        .filter((v) => v.userId === entitlement.userId)
        .map((v) => ({ startDate: ymdOf(v.startDate), endDate: ymdOf(v.endDate), note: v.note })),
    }
  })

  // Informativo de coincidência: mais de uma pessoa do time fora no mesmo mês.
  // NUNCA impedimento — a G&G foi explícita de que quem avalia a cobertura da
  // área é o gestor. Por isso viaja num campo próprio, e não junto dos erros.
  const monthOverlaps = teamMonthOverlaps(
    dtos.flatMap((plan) =>
      plan.periods.map((p) => ({ userId: plan.user.id, startDate: p.startDate, endDate: p.endDate })),
    ),
  )

  return {
    campaign,
    plans: dtos,
    holidays: [...holidayWindow.entries()].map(([date, name]) => ({ date, name })),
    monthOverlaps,
  }
}

// ---------------------------------------------------------------------------
// Salvar, confirmar, validar
// ---------------------------------------------------------------------------

/**
 * Só o gestor da subárvore, ou quem administra a empresa, mexe num plano.
 *
 * "Administra" passa por `canAdminister`, e não por `role` cru: o acesso
 * administrativo delegado é poder de admin pleno (ver
 * `@legends/shared/permissions`).
 */
async function assertCanPlan(actorId: string, targetUserId: string): Promise<{ companyId: string }> {
  const [actor, target] = await Promise.all([
    prisma.user.findUnique({ where: { id: actorId }, select: { role: true, companyId: true, adminAccess: true } }),
    prisma.user.findUnique({ where: { id: targetUserId }, select: { companyId: true } }),
  ])
  if (!actor || !target) throw new VacationPlanningError('Usuário não encontrado.', 404)
  if (actor.companyId !== target.companyId) {
    throw new VacationPlanningError('Sem permissão para programar as férias desta pessoa.', 403)
  }
  // Listar é raso e autorizar é fundo: a tela mostra os diretos, mas líder de
  // líderes programa quem está dois níveis abaixo.
  if (canAdminister(actor)) return { companyId: actor.companyId }
  if (await managesUser(actorId, targetUserId)) return { companyId: actor.companyId }
  throw new VacationPlanningError('Sem permissão para programar as férias desta pessoa.', 403)
}

/** O prazo trava o gestor; a G&G continua editando, e pode reabrir um plano. */
function assertEditable(
  campaign: { deadline: Date; manuallyLocked: boolean },
  plan: { unlockedUntil: Date | null } | null,
  isAdmin: boolean,
  now: Date,
  today: string,
) {
  if (isAdmin) return
  if (plan?.unlockedUntil && plan.unlockedUntil > now) return
  if (campaignLocked(campaign, today)) {
    throw new VacationPlanningError(
      'O prazo para preenchimento terminou. Fale com o time de Gente e Gestão.',
      409,
    )
  }
}

export interface SavePlanInput {
  entitlementId: string
  periods: PlannedPeriod[]
  note?: string | null
  changeRequested?: boolean
}

export async function savePlan(actorId: string, input: SavePlanInput): Promise<VacationPlanDTO> {
  const actor = await prisma.user.findUnique({
    where: { id: actorId },
    select: { companyId: true, role: true, adminAccess: true },
  })
  if (!actor) throw new VacationPlanningError('Usuário não encontrado.', 404)

  const db = scopedPrisma(actor.companyId)
  const entitlement = await db.vacationEntitlement.findFirst({
    where: { id: input.entitlementId },
    include: { user: true },
  })
  if (!entitlement) throw new VacationPlanningError('Direito não encontrado.', 404)
  await assertCanPlan(actorId, entitlement.userId)

  const today = todayInSaoPaulo().ymd
  const campaignRow = await currentCampaign(actor.companyId, today)
  if (!campaignRow) throw new VacationPlanningError('Não há campanha de férias aberta.', 409)
  const policy = readPolicy(campaignRow.policy)

  const existing = await db.vacationPlan.findFirst({
    where: { campaignId: campaignRow.id, entitlementId: entitlement.id },
    include: PLAN_INCLUDE,
  })
  const isAdmin = canAdminister(actor)
  assertEditable(campaignRow, existing, isAdmin, new Date(), today)

  const periods = input.periods.filter((p) => p.startDate && p.days > 0)
  const holidays = await companyHolidays(actor.companyId, policy.minStartDate, `${campaignRow.year + 2}-12-31`)
  const employmentType = entitlement.user.employmentType
  const validation = validateVacationPlan({
    policy,
    balanceDays: entitlement.balanceDays,
    acquisitionEnd: ymdOf(entitlement.acquisitionEnd),
    dueDate: ymdOf(entitlement.dueDate),
    periods,
    holidays,
    today,
    employmentType,
  })
  // Rascunho com erro pode ser salvo — é o salvamento automático do formulário,
  // e perder o que já foi digitado por causa de uma data pela metade seria pior
  // do que guardar algo inválido. Confirmar é que exige estar limpo.
  const split = employmentType === 'PJ' ? null : matchSplit(policy, entitlement.balanceDays, periods)
  const sold = soldDaysPerPeriod(policy, entitlement.balanceDays, periods, employmentType)

  const plan = await prisma.$transaction(async (tx) => {
    const saved = existing
      ? await tx.vacationPlan.update({
          where: { id: existing.id },
          data: {
            sellDays: (split?.soldDays.reduce((a, b) => a + b, 0) ?? 0) > 0,
            note: input.note ?? null,
            ...(input.changeRequested !== undefined ? { changeRequested: input.changeRequested } : {}),
            // Mexer no plano depois de validado o devolve para rascunho: o que
            // está no calendário deixou de corresponder ao que foi conferido.
            status: 'DRAFT',
            confirmedById: null,
            confirmedAt: null,
            validatedById: null,
            validatedAt: null,
          },
        })
      : await tx.vacationPlan.create({
          data: {
            campaignId: campaignRow.id,
            entitlementId: entitlement.id,
            companyId: actor.companyId,
            sellDays: (split?.soldDays.reduce((a, b) => a + b, 0) ?? 0) > 0,
            note: input.note ?? null,
            changeRequested: input.changeRequested ?? false,
          },
        })

    await tx.vacationPlanPeriod.deleteMany({ where: { planId: saved.id } })
    if (periods.length) {
      await tx.vacationPlanPeriod.createMany({
        data: periods.map((p, i) => ({
          planId: saved.id,
          companyId: actor.companyId,
          startDate: dayFromYmd(p.startDate),
          endDate: dayFromYmd(periodEndDate(p.startDate, p.days)!),
          days: p.days,
          soldDays: sold[i] ?? 0,
        })),
      })
    }
    return saved
  })

  await recordAuditLog({
    actorId,
    companyId: actor.companyId,
    entityType: 'VacationPlan',
    entityId: plan.id,
    action: existing ? 'UPDATE' : 'CREATE',
    before: existing ? { periods: existing.periods.map((p) => `${ymdOf(p.startDate)}+${p.days}`) } : null,
    after: { periods: periods.map((p) => `${p.startDate}+${p.days}`), status: validation.status },
  })

  const refreshed = await db.vacationPlan.findFirst({ where: { id: plan.id }, include: PLAN_INCLUDE })
  return {
    id: refreshed!.id,
    user: toPublicUser(entitlement.user),
    entitlement: {
      id: entitlement.id,
      employmentType: entitlement.user.employmentType,
      acquisitionStart: ymdOf(entitlement.acquisitionStart),
      acquisitionEnd: ymdOf(entitlement.acquisitionEnd),
      dueDate: ymdOf(entitlement.dueDate),
      balanceDays: entitlement.balanceDays,
      note: entitlement.note,
      daysToDueDate: Math.round(
        (entitlement.dueDate.getTime() - dayFromYmd(today).getTime()) / 86_400_000,
      ),
    },
    periods: refreshed!.periods.map((p) => ({
      startDate: ymdOf(p.startDate),
      endDate: ymdOf(p.endDate),
      days: p.days,
      soldDays: p.soldDays,
    })),
    sellDays: refreshed!.sellDays,
    note: refreshed!.note,
    status: refreshed!.status,
    changeRequested: refreshed!.changeRequested,
    confirmedBy: null,
    confirmedAt: null,
    validatedBy: null,
    validatedAt: null,
    unlockedUntil: refreshed!.unlockedUntil?.toISOString() ?? null,
    request: null,
    replacing: [],
  }
}

/**
 * Confirmação do gestor — em lote, a área inteira de uma vez.
 *
 * Confirmar pessoa a pessoa em quinze cartões é atrito puro, e é assim que a
 * ferramenta de origem já funciona. Plano com erro de regra não passa: o que se
 * tolera em rascunho não se tolera na entrega.
 */
export async function confirmPlans(actorId: string, entitlementIds: string[]): Promise<number> {
  const actor = await prisma.user.findUnique({
    where: { id: actorId },
    select: { companyId: true, role: true, adminAccess: true },
  })
  if (!actor) throw new VacationPlanningError('Usuário não encontrado.', 404)

  const today = todayInSaoPaulo().ymd
  const db = scopedPrisma(actor.companyId)
  const campaignRow = await currentCampaign(actor.companyId, today)
  if (!campaignRow) throw new VacationPlanningError('Não há campanha de férias aberta.', 409)
  const policy = readPolicy(campaignRow.policy)
  const holidays = await companyHolidays(actor.companyId, policy.minStartDate, `${campaignRow.year + 2}-12-31`)

  const plans = await db.vacationPlan.findMany({
    where: { campaignId: campaignRow.id, entitlementId: { in: entitlementIds } },
    include: {
      ...PLAN_INCLUDE,
      entitlement: { include: { user: { select: { id: true, name: true, employmentType: true } } } },
    },
  })

  const isAdmin = canAdminister(actor)
  const now = new Date()
  for (const plan of plans) {
    await assertCanPlan(actorId, plan.entitlement.userId)
    assertEditable(campaignRow, plan, isAdmin, now, today)

    const validation = validateVacationPlan({
      policy,
      balanceDays: plan.entitlement.balanceDays,
      acquisitionEnd: ymdOf(plan.entitlement.acquisitionEnd),
      dueDate: ymdOf(plan.entitlement.dueDate),
      periods: plan.periods.map((p) => ({ startDate: ymdOf(p.startDate), days: p.days })),
      holidays,
      today,
      employmentType: plan.entitlement.user.employmentType,
    })
    if (validation.status === 'erro' || validation.status === 'vazio') {
      throw new VacationPlanningError(
        `A programação de ${plan.entitlement.user.name} ainda não pode ser confirmada: ${validation.errors[0] ?? 'nenhuma data informada.'}`,
      )
    }
  }

  const { count } = await db.vacationPlan.updateMany({
    where: { id: { in: plans.map((p) => p.id) } },
    data: { status: 'CONFIRMED', confirmedById: actorId, confirmedAt: now, changeRequested: false },
  })
  return count
}

/**
 * Validação da G&G: confere, **materializa** em `Vacation` e avisa a pessoa.
 *
 * Três coisas acontecem juntas, e é de propósito que sejam a mesma operação:
 *
 * 1. o plano vira `VALIDATED`;
 * 2. cada período vira um `Vacation` — que é o que faz a programação aparecer
 *    na Home, na Liderança, no perfil e na busca, sem tela nova;
 * 3. o colaborador recebe o aviso com as datas.
 *
 * A campanha **ganha** do lançamento à mão: um período avulso que colida é
 * substituído, em vez de a materialização esbarrar na regra de sobreposição de
 * `createVacation`. Duas cercas nisso, e nenhuma é zelo excessivo: só se
 * substitui **dentro da janela da campanha** — férias passadas e em curso não
 * são dela —, e o que foi substituído vai para o `AdminAuditLog`, porque
 * sobrescrever não é sumir em silêncio.
 */
export async function validatePlans(actorId: string, entitlementIds: string[]): Promise<number> {
  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { companyId: true } })
  if (!actor) throw new VacationPlanningError('Usuário não encontrado.', 404)

  const today = todayInSaoPaulo().ymd
  const db = scopedPrisma(actor.companyId)
  const campaignRow = await currentCampaign(actor.companyId, today)
  if (!campaignRow) throw new VacationPlanningError('Não há campanha de férias aberta.', 409)
  const campaign = toCampaignDTO(campaignRow, today)

  const plans = await db.vacationPlan.findMany({
    where: { campaignId: campaignRow.id, entitlementId: { in: entitlementIds }, status: 'CONFIRMED' },
    include: { periods: true, entitlement: { include: { user: { select: { id: true, name: true } } } } },
  })
  if (plans.length === 0) {
    throw new VacationPlanningError('Nenhuma programação confirmada para validar.', 409)
  }

  const now = new Date()
  let validated = 0

  for (const plan of plans) {
    const userId = plan.entitlement.userId
    const windowStart = dayFromYmd(campaign.policy.minStartDate)

    const replaced = await prisma.$transaction(async (tx) => {
      // Períodos lançados à mão que colidem com o que foi programado, dentro da
      // janela. Nunca período que termina antes dela — férias em curso ficam.
      const clashing = await tx.vacation.findMany({
        where: {
          userId,
          planPeriodId: null,
          endDate: { gte: windowStart },
          OR: plan.periods.map((p) => ({
            startDate: { lte: p.endDate },
            endDate: { gte: p.startDate },
          })),
        },
      })
      if (clashing.length) {
        await tx.vacation.deleteMany({ where: { id: { in: clashing.map((v) => v.id) } } })
      }

      for (const period of plan.periods) {
        // Já materializado numa validação anterior? Atualiza em vez de duplicar.
        const already = await tx.vacation.findUnique({ where: { planPeriodId: period.id } })
        if (already) {
          await tx.vacation.update({
            where: { id: already.id },
            data: { startDate: period.startDate, endDate: period.endDate },
          })
          continue
        }
        await tx.vacation.create({
          data: {
            userId,
            companyId: actor.companyId,
            startDate: period.startDate,
            endDate: period.endDate,
            createdById: actorId,
            planPeriodId: period.id,
            note: `Programação de férias ${campaignRow.year}`,
          },
        })
      }

      await tx.vacationPlan.update({
        where: { id: plan.id },
        data: { status: 'VALIDATED', validatedById: actorId, validatedAt: now },
      })
      return clashing
    })

    validated += 1

    await recordAuditLog({
      actorId,
      companyId: actor.companyId,
      entityType: 'VacationPlan',
      entityId: plan.id,
      action: 'UPDATE',
      before: {
        status: 'CONFIRMED',
        // O que foi substituído fica registrado: um período lançado à mão tinha
        // um motivo, e apagá-lo sem deixar rastro esconde a decisão.
        substituidos: replaced.map((v) => `${ymdOf(v.startDate)} a ${ymdOf(v.endDate)}${v.note ? ` (${v.note})` : ''}`),
      },
      after: { status: 'VALIDATED', periodos: plan.periods.map((p) => `${ymdOf(p.startDate)} a ${ymdOf(p.endDate)}`) },
    })

    const periodos = plan.periods
      .map((p) => `${formatCivilDate(ymdOf(p.startDate))} a ${formatCivilDate(ymdOf(p.endDate))}`)
      .join(' e ')
    // Best-effort, como a avaliação de selos pós-voto: o aviso é importante,
    // mas não pode derrubar a validação de 40 planos porque o sino falhou.
    try {
      await createNotification({
        userId,
        companyId: actor.companyId,
        type: 'VACATION_PLAN_VALIDATED',
        actorId,
        title: renderVacationNotice(campaign.noticeTemplate, {
          nome: plan.entitlement.user.name.split(' ')[0] ?? plan.entitlement.user.name,
          periodos,
          ano: campaignRow.year,
        }),
        link: '/perfil',
      })
    } catch (err) {
      console.error('[vacation-planning] falha ao avisar o colaborador', err)
    }
  }

  return validated
}

/** Reabre UM plano depois do prazo — a exceção de alguém não abre a porta a todos. */
export async function unlockPlan(actorId: string, entitlementId: string, until: string) {
  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { companyId: true } })
  if (!actor) throw new VacationPlanningError('Usuário não encontrado.', 404)

  const db = scopedPrisma(actor.companyId)
  const campaignRow = await currentCampaign(actor.companyId, todayInSaoPaulo().ymd)
  if (!campaignRow) throw new VacationPlanningError('Não há campanha de férias aberta.', 409)

  const entitlement = await db.vacationEntitlement.findFirst({ where: { id: entitlementId } })
  if (!entitlement) throw new VacationPlanningError('Direito não encontrado.', 404)

  // O caso comum de reabertura é justamente quem NÃO preencheu nada e perdeu o
  // prazo — aí ainda não existe plano. Exigir que existisse deixaria a G&G sem
  // saída para a única pessoa que mais precisa dela.
  const plan = await db.vacationPlan.findFirst({
    where: { campaignId: campaignRow.id, entitlementId },
  })
  const saved = plan
    ? await db.vacationPlan.update({
        where: { id: plan.id },
        data: { unlockedUntil: dayFromYmd(until) },
      })
    : await db.vacationPlan.create({
        data: {
          campaignId: campaignRow.id,
          entitlementId,
          companyId: actor.companyId,
          unlockedUntil: dayFromYmd(until),
        },
      })
  await recordAuditLog({
    actorId,
    companyId: actor.companyId,
    entityType: 'VacationPlan',
    entityId: saved.id,
    action: plan ? 'UPDATE' : 'CREATE',
    before: { unlockedUntil: plan?.unlockedUntil?.toISOString() ?? null },
    after: { unlockedUntil: until },
  })
}

// ---------------------------------------------------------------------------
// Painel da G&G
// ---------------------------------------------------------------------------

/**
 * Progresso por área e os pedidos de alteração.
 *
 * É o que substitui "sinalize por e-mail para o DP": a G&G vê quem falta em vez
 * de caçar gestor.
 */
export async function getCampaignOverview(companyId: string): Promise<VacationCampaignOverviewResponse> {
  const today = todayInSaoPaulo().ymd
  const campaignRow = await currentCampaign(companyId, today)
  if (!campaignRow) return { campaign: null, progress: [], changeRequests: [] }

  const db = scopedPrisma(companyId)
  const plans = await db.vacationPlan.findMany({
    where: { campaignId: campaignRow.id },
    include: {
      entitlement: {
        include: {
          user: {
            select: {
              name: true,
              sector: { select: { id: true, name: true } },
              manager: { select: { name: true } },
            },
          },
        },
      },
    },
  })

  const bySector = new Map<string, VacationCampaignProgressRow>()
  for (const plan of plans) {
    const sector = plan.entitlement.user.sector
    const key = sector?.id ?? 'sem-setor'
    if (!bySector.has(key)) {
      bySector.set(key, {
        sectorId: key,
        sectorName: sector?.name ?? 'Sem setor',
        total: 0,
        draft: 0,
        confirmed: 0,
        validated: 0,
        changeRequested: 0,
      })
    }
    const row = bySector.get(key)!
    row.total += 1
    if (plan.status === 'DRAFT') row.draft += 1
    if (plan.status === 'CONFIRMED') row.confirmed += 1
    if (plan.status === 'VALIDATED') row.validated += 1
    if (plan.changeRequested) row.changeRequested += 1
  }

  return {
    campaign: toCampaignDTO(campaignRow, today),
    progress: [...bySector.values()].sort((a, b) => a.sectorName.localeCompare(b.sectorName, 'pt-BR')),
    changeRequests: plans
      .filter((p) => p.changeRequested)
      .map((p) => ({
        userName: p.entitlement.user.name,
        sectorName: p.entitlement.user.sector?.name ?? 'Sem setor',
        managerName: p.entitlement.user.manager?.name ?? null,
      }))
      .sort((a, b) => a.userName.localeCompare(b.userName, 'pt-BR')),
  }
}

type VacationCampaignProgressRow = VacationCampaignOverviewResponse['progress'][number]

// ---------------------------------------------------------------------------
// O lado do colaborador
// ---------------------------------------------------------------------------

function readRequestPeriods(raw: Prisma.JsonValue | null): { startDate: string; days: number }[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is { startDate: string; days: number } =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as { startDate?: unknown }).startDate === 'string' &&
      typeof (item as { days?: unknown }).days === 'number',
    )
    .map((item) => ({ startDate: item.startDate, days: item.days }))
}

/**
 * O que a própria pessoa vê das férias dela: o direito, o que ela pediu e o que
 * o gestor programou.
 *
 * Hoje ela descobre as próprias férias por e-mail, depois de decididas. Aqui
 * ela acompanha — e o `status` diz em que pé está, sem precisar perguntar.
 */
export async function getMyVacationPlanning(userId: string): Promise<MyVacationPlanningResponse> {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { companyId: true } })
  if (!me) throw new VacationPlanningError('Usuário não encontrado.', 404)

  const today = todayInSaoPaulo().ymd
  const campaignRow = await currentCampaign(me.companyId, today)
  if (!campaignRow) return { campaign: null, items: [] }

  const db = scopedPrisma(me.companyId)
  const entitlements = await db.vacationEntitlement.findMany({
    where: { userId },
    orderBy: { dueDate: 'asc' },
    include: {
      request: true,
      user: { select: { employmentType: true } },
      plans: {
        where: { campaignId: campaignRow.id },
        include: { periods: { orderBy: { startDate: 'asc' } } },
      },
    },
  })

  return {
    campaign: toCampaignDTO(campaignRow, today),
    items: entitlements.map((entitlement) => {
      const plan = entitlement.plans[0] ?? null
      return {
        entitlement: {
          id: entitlement.id,
          employmentType: entitlement.user.employmentType,
          acquisitionStart: ymdOf(entitlement.acquisitionStart),
          acquisitionEnd: ymdOf(entitlement.acquisitionEnd),
          dueDate: ymdOf(entitlement.dueDate),
          balanceDays: entitlement.balanceDays,
          note: entitlement.note,
          daysToDueDate: Math.round(
            (entitlement.dueDate.getTime() - dayFromYmd(today).getTime()) / 86_400_000,
          ),
        },
        // Só depois de validado o plano é mostrado como decidido. Antes disso a
        // pessoa veria como certo algo que o gestor ainda pode mudar.
        plan: plan
          ? {
              periods: plan.periods.map((p) => ({
                startDate: ymdOf(p.startDate),
                endDate: ymdOf(p.endDate),
                days: p.days,
                soldDays: p.soldDays,
              })),
              status: plan.status,
              validatedAt: plan.validatedAt?.toISOString() ?? null,
            }
          : null,
        request: entitlement.request
          ? {
              periods: readRequestPeriods(entitlement.request.periods),
              note: entitlement.request.note,
              updatedAt: entitlement.request.updatedAt.toISOString(),
            }
          : null,
      }
    }),
  }
}

/**
 * A pessoa registra o que gostaria — para o gestor ver antes de programar.
 *
 * Não passa pela validação das combinações de propósito: é pedido, não
 * programação. Recusar "queria julho" porque não fecha 30 dias transformaria a
 * conversa num formulário, que é exatamente o que este campo evita.
 */
export async function saveMyVacationRequest(
  userId: string,
  input: { entitlementId: string; periods: { startDate: string; days: number }[]; note?: string | null },
) {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { companyId: true } })
  if (!me) throw new VacationPlanningError('Usuário não encontrado.', 404)

  const db = scopedPrisma(me.companyId)
  const entitlement = await db.vacationEntitlement.findFirst({ where: { id: input.entitlementId } })
  // O pedido é sobre as férias da PRÓPRIA pessoa: sem esta checagem, trocar o
  // id na requisição deixaria alguém pedir férias em nome de outro.
  if (!entitlement || entitlement.userId !== userId) {
    throw new VacationPlanningError('Direito não encontrado.', 404)
  }

  const existing = await db.vacationRequest.findFirst({ where: { entitlementId: entitlement.id } })
  const data = {
    periods: input.periods as unknown as Prisma.InputJsonValue,
    note: input.note ?? null,
  }
  return existing
    ? db.vacationRequest.update({ where: { id: existing.id }, data })
    : db.vacationRequest.create({
        data: { ...data, entitlementId: entitlement.id, companyId: me.companyId },
      })
}

// ---------------------------------------------------------------------------
// Consolidado
// ---------------------------------------------------------------------------

/**
 * Cabeçalho no formato do "Controle Geral" que o DP já lê.
 *
 * As capitalizações estranhas (`InIcio Aquisitivo`) são as do arquivo original,
 * e ficam: conferir contra uma planilha diferente da de sempre é onde erro passa
 * despercebido.
 */
const CSV_HEADER = [
  'Empregado',
  'Centro de Custo',
  'Squad',
  'Lider',
  'Data Admissão',
  'InIcio Aquisitivo',
  'Fim Aquisitivo',
  'Limite p/ gozo',
  '1º Período - Dias',
  '1º Período - Início',
  '1º Período - Término',
  '1º Período - Venda',
  '2º Período - Dias',
  '2º Período - Início',
  '2º Período - Término',
  '2º Período - Venda',
  'Saldo Disponível (após programação)',
  'Situação',
  'Conferido por',
  'Observação',
]

const CSV_STATUS: Record<string, string> = {
  DRAFT: 'Em preenchimento',
  CONFIRMED: 'Confirmado pelo gestor',
  VALIDATED: 'Validado pelo DP',
}

/**
 * CSV da campanha. `escopo` decide o recorte: a G&G leva tudo, o gestor leva a
 * própria estrutura — e é o servidor que resolve isso, nunca um parâmetro da
 * requisição.
 *
 * Separador `;` e BOM UTF-8 porque o Excel em pt-BR abre assim sem pedir
 * importação, igual à exportação da Loja. Sem dependência nova: o DP abre no
 * Excel de qualquer jeito, e uma biblioteca de xlsx aqui pagaria formatação que
 * ninguém pediu.
 */
export async function exportCampaignCsv(actorId: string, escopo: 'empresa' | 'meu-time'): Promise<string> {
  const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { companyId: true } })
  if (!actor) throw new VacationPlanningError('Usuário não encontrado.', 404)

  const today = todayInSaoPaulo().ymd
  const campaignRow = await currentCampaign(actor.companyId, today)
  if (!campaignRow) throw new VacationPlanningError('Não há campanha de férias aberta.', 409)

  const db = scopedPrisma(actor.companyId)
  let userIds: string[] | null = null
  if (escopo === 'meu-time') {
    const groups = await listManagedGroups(actorId)
    userIds = groups.flatMap((g) => g.members.map((m) => m.id))
    // Sem liderado direto o arquivo sai só com o cabeçalho — melhor do que
    // devolver a empresa inteira por um recorte vazio ter virado "sem filtro".
    if (userIds.length === 0) return `﻿${CSV_HEADER.join(';')}\n`
  }

  const entitlements = await db.vacationEntitlement.findMany({
    where: userIds ? { userId: { in: userIds } } : {},
    orderBy: [{ user: { sector: { name: 'asc' } } }, { user: { name: 'asc' } }, { dueDate: 'asc' }],
    include: {
      user: {
        select: {
          name: true,
          joinedAt: true,
          squad: true,
          sector: { select: { name: true } },
          manager: { select: { name: true } },
        },
      },
      plans: {
        where: { campaignId: campaignRow.id },
        include: { periods: { orderBy: { startDate: 'asc' } }, confirmedBy: { select: { name: true } } },
      },
    },
  })

  const lines = [CSV_HEADER.join(';')]
  for (const entitlement of entitlements) {
    const plan = entitlement.plans[0] ?? null
    const periods = plan?.periods ?? []
    const usados = periods.reduce((sum, p) => sum + p.days + p.soldDays, 0)
    const celulasPeriodo = (i: number) => {
      const p = periods[i]
      if (!p) return ['', '', '', '']
      return [
        String(p.days),
        formatCivilDate(ymdOf(p.startDate)),
        formatCivilDate(ymdOf(p.endDate)),
        p.soldDays > 0 ? String(p.soldDays) : '',
      ]
    }
    lines.push(
      [
        csvCell(entitlement.user.name),
        csvCell(entitlement.user.sector?.name ?? null),
        csvCell(entitlement.user.squad),
        csvCell(entitlement.user.manager?.name ?? null),
        formatCivilDate(ymdOf(entitlement.user.joinedAt)),
        formatCivilDate(ymdOf(entitlement.acquisitionStart)),
        formatCivilDate(ymdOf(entitlement.acquisitionEnd)),
        formatCivilDate(ymdOf(entitlement.dueDate)),
        ...celulasPeriodo(0),
        ...celulasPeriodo(1),
        String(Math.max(0, entitlement.balanceDays - usados)),
        plan ? (CSV_STATUS[plan.status] ?? plan.status) : 'Não preenchido',
        csvCell(plan?.confirmedBy?.name ?? null),
        csvCell(entitlement.note),
      ].join(';'),
    )
  }
  return `﻿${lines.join('\n')}\n`
}

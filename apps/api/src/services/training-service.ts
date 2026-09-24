/**
 * Registro de treinamento — o módulo de T&D.
 *
 * O fato é um só (`TrainingRecord`) e entra por três portas: o autoatendimento
 * do colaborador, o evento interno e o cadastro pelo T&D. Substitui o envio de
 * certificado externo (`CertificateRequest` com `origin = EXTERNAL`), que era
 * isto sem carga horária, instituição nem data de conclusão — ver
 * `docs/superpowers/specs/2026-09-12-modulo-de-treinamentos-td-design.md`.
 *
 * Duas coisas que este serviço faz e valem a leitura:
 *
 * 1. **Snapshot, não join.** Setor, squad, líder, cargo, categoria de cargo e
 *    vínculo são copiados para a linha na hora da escrita. Quem muda de setor em
 *    março não leva o treinamento de janeiro junto — o painel responde "qual
 *    área se desenvolveu naquele momento".
 * 2. **Filtro e agregação são do servidor.** O navegador recebe DTO pronto. A
 *    versão de origem baixava milhares de linhas e somava no cliente, o que num
 *    produto multi-empresa é vazamento de escopo e KPI que muda ao virar página.
 */

import { Prisma, type TrainingRecord } from '@prisma/client'
import {
  MAX_TRAINING_REASONS,
  TRAINING_COURSE_TITLE_MAX_LENGTH,
  TRAINING_DEFAULT_SLA_DAYS,
  TRAINING_INSTITUTION_MAX_LENGTH,
  TRAINING_LEARNING_TYPE_MAX_LENGTH,
  TRAINING_MAX_HOURS,
  TRAINING_MAX_INVESTMENT_CENTS,
  TRAINING_MAX_SLA_DAYS,
  TRAINING_MIN_SLA_DAYS,
  TRAINING_NOTES_MAX_LENGTH,
  TRAINING_PARTICIPATION_STATUS,
  TRAINING_PRIORITIES,
  TRAINING_RECORDS_PAGE_SIZE,
  TRAINING_REJECTION_REASON_MAX_LENGTH,
  TRAINING_REASON_LABELS,
  TRAINING_SPONSOR_LABELS,
  TRAINING_SPONSOR_OTHER_MAX_LENGTH,
  TRAINING_TYPE_LABELS,
  TRAINING_VALIDATION_STATUS_LABELS,
  computeTrainingCoverage,
  computeTrainingKpis,
  groupTrainingBy,
  trainingMonthlySeries,
  trainingQuarter,
  trainingSemester,
  trainingSlaDays,
  trainingSlaStatus,
  trainingYear,
  type CreateTrainingRecordRequest,
  type ReviewTrainingRecordRequest,
  type TrainingFact,
  type TrainingFilterOptionsDTO,
  type TrainingFilters,
  type TrainingDashboardDTO,
  type TrainingParticipationStatus,
  type TrainingPriority,
  type TrainingReason,
  type TrainingSlaStatus,
  type TrainingSource,
  type UpdateTrainingRecordRequest,
} from '@legends/shared'
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'
import { TrainingError } from '../lib/training-error'
import { CERTIFICATE_ATTACHMENT_PREFIX } from '../lib/s3-client'
import { dayFromYmd, todayInSaoPaulo, ymdOf } from '../lib/sao-paulo-date'
import { csvCell } from '../lib/csv'
import { recordAuditLog } from './audit-log-service'
import { notifyTrainingReviewed } from './notification-service'

export interface TrainingActor {
  id: string
  role: string
  sectorId: string
  companyId: string
}

/** Chave da configuração de SLA, em `AppSetting` (por empresa). */
export const TRAINING_SLA_DAYS_KEY = 'training_sla_days'

/**
 * Teto de linhas lidas por consulta. Filtro por semestre/trimestre e por SLA são
 * derivados de data e não viram `WHERE` — eles são aplicados sobre as linhas já
 * recortadas. O teto existe para que isso nunca vire uma varredura da tabela
 * inteira; empresa que chegar perto dele precisa de recorte por período, não de
 * mais memória.
 */
const QUERY_LIMIT = 5000

const RECORD_INCLUDE = {
  event: { select: { id: true, name: true } },
  user: { select: { id: true, name: true, photoUrl: true } },
  reviewedBy: { select: { id: true, name: true } },
} as const

export type TrainingRecordRow = Prisma.TrainingRecordGetPayload<{ include: typeof RECORD_INCLUDE }>

// ---------------------------------------------------------------------------
// Configuração
// ---------------------------------------------------------------------------

export async function getTrainingSlaDays(companyId: string): Promise<number> {
  const setting = await prisma.appSetting.findUnique({
    where: { key_companyId: { key: TRAINING_SLA_DAYS_KEY, companyId } },
  })
  const parsed = Number(setting?.value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : TRAINING_DEFAULT_SLA_DAYS
}

export async function setTrainingSlaDays(actor: TrainingActor, days: number): Promise<number> {
  if (!Number.isInteger(days) || days < TRAINING_MIN_SLA_DAYS || days > TRAINING_MAX_SLA_DAYS) {
    throw new TrainingError(`O SLA precisa ficar entre ${TRAINING_MIN_SLA_DAYS} e ${TRAINING_MAX_SLA_DAYS} dias.`)
  }
  const before = await getTrainingSlaDays(actor.companyId)
  await prisma.appSetting.upsert({
    where: { key_companyId: { key: TRAINING_SLA_DAYS_KEY, companyId: actor.companyId } },
    create: { key: TRAINING_SLA_DAYS_KEY, companyId: actor.companyId, value: String(days) },
    update: { value: String(days) },
  })
  await recordAuditLog({
    actorId: actor.id,
    entityType: 'AppSetting',
    entityId: TRAINING_SLA_DAYS_KEY,
    action: 'UPDATE',
    before: { slaDays: before },
    after: { slaDays: days },
    companyId: actor.companyId,
  })
  return days
}

// ---------------------------------------------------------------------------
// Snapshot de quem fez
// ---------------------------------------------------------------------------

export interface TrainingIdentity {
  userName: string
  sectorName: string | null
  squad: string | null
  leaderName: string | null
  position: string | null
  positionCategory: string | null
  employmentType: string | null
}

/**
 * A identidade do colaborador no momento da escrita.
 *
 * Sai do `User` do Legends, e o líder vem de `managerId` — a mesma cadeia do
 * organograma e de `team-scope-service`. Squad é o campo do usuário, não a
 * `Squad` liderada: o que o painel quer saber é a qual time a pessoa pertencia.
 */
export async function trainingIdentityOf(userId: string, companyId: string): Promise<TrainingIdentity> {
  const user = await scopedPrisma(companyId).user.findFirst({
    where: { id: userId },
    select: {
      name: true,
      squad: true,
      position: true,
      positionCategory: true,
      employmentType: true,
      sector: { select: { name: true } },
      manager: { select: { name: true } },
    },
  })
  if (!user) throw new TrainingError('Colaborador não encontrado.', 404)
  return {
    userName: user.name,
    sectorName: user.sector?.name ?? null,
    squad: user.squad,
    leaderName: user.manager?.name ?? null,
    position: user.position,
    positionCategory: user.positionCategory,
    employmentType: user.employmentType,
  }
}

// ---------------------------------------------------------------------------
// Validação de entrada
// ---------------------------------------------------------------------------

function cleanText(value: string | null | undefined, max: number, field: string): string | null {
  const text = value?.trim()
  if (!text) return null
  if (text.length > max) throw new TrainingError(`${field} passa de ${max} caracteres.`)
  return text
}

function assertReasons(reasons: TrainingReason[]): TrainingReason[] {
  const unique = Array.from(new Set(reasons))
  if (unique.length === 0) throw new TrainingError('Escolha ao menos um motivo.')
  if (unique.length > MAX_TRAINING_REASONS) {
    throw new TrainingError(`Escolha no máximo ${MAX_TRAINING_REASONS} motivos.`)
  }
  return unique
}

function assertHours(hours: number): number {
  if (!Number.isFinite(hours) || hours < 0 || hours > TRAINING_MAX_HOURS) {
    throw new TrainingError('Carga horária inválida.')
  }
  // Duas casas: o banco é DECIMAL(6,2) e arredondar aqui evita que 0,333 vire
  // uma diferença silenciosa entre o que a tela mostrou e o que foi gravado.
  return Math.round(hours * 100) / 100
}

/**
 * O valor investido só é guardado quando quem pagou foi a empresa — gravá-lo
 * em outro caso seria um número que a tela nunca mostra. Regra herdada do envio
 * de certificado, e é ela que mantém o indicador de investimento honesto.
 */
function resolveInvestment(sponsor: string, cents: number | null | undefined): number {
  if (sponsor !== 'EMR' || cents == null) return 0
  if (!Number.isInteger(cents) || cents < 0 || cents > TRAINING_MAX_INVESTMENT_CENTS) {
    throw new TrainingError('Valor investido inválido.')
  }
  return cents
}

function assertDate(ymd: string, field: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) throw new TrainingError(`${field} inválida.`)
  const day = dayFromYmd(ymd)
  if (Number.isNaN(day.getTime())) throw new TrainingError(`${field} inválida.`)
  return day
}

function assertPriority(priority: string | undefined): TrainingPriority {
  if (!priority) return 'Média'
  if (!(TRAINING_PRIORITIES as readonly string[]).includes(priority)) {
    throw new TrainingError('Prioridade inválida.')
  }
  return priority as TrainingPriority
}

function assertParticipation(status: string | undefined): TrainingParticipationStatus | undefined {
  if (!status) return undefined
  if (!(TRAINING_PARTICIPATION_STATUS as readonly string[]).includes(status)) {
    throw new TrainingError('Situação de participação inválida.')
  }
  return status as TrainingParticipationStatus
}

/**
 * O anexo nasce sob `certificate-requests/<userId>/` no presign. Conferir o
 * prefixo é o que impede alguém de anexar ao próprio registro a chave do
 * documento de outra pessoa — mesma guarda que o envio de certificado tinha.
 */
function assertAttachmentKey(key: string | null | undefined, userId: string): string | null {
  if (!key) return null
  if (!key.startsWith(`${CERTIFICATE_ATTACHMENT_PREFIX}/${userId}/`)) {
    throw new TrainingError('Anexo inválido. Envie o arquivo de novo.')
  }
  return key
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

export interface CreateTrainingRecordInput extends CreateTrainingRecordRequest {
  /** De quem é o treinamento. */
  userId: string
  companyId: string
  /** Quem está gravando — igual a `userId` no autoatendimento. */
  actorId: string
  source: TrainingSource
}

/**
 * Cria o registro.
 *
 * Nasce `PENDING` no autoatendimento (alguém da G&G confere o comprovante) e
 * `APPROVED` quando quem cadastra é o próprio T&D: exigir que o time valide o
 * que ele mesmo acabou de digitar seria fila por fila.
 */
export async function createTrainingRecord(input: CreateTrainingRecordInput): Promise<TrainingRecordRow> {
  const courseTitle = cleanText(input.courseTitle, TRAINING_COURSE_TITLE_MAX_LENGTH, 'O nome do treinamento')
  if (!courseTitle) throw new TrainingError('Informe o curso ou capacitação.')

  const learningType =
    cleanText(input.learningType, TRAINING_LEARNING_TYPE_MAX_LENGTH, 'O tipo de aprendizado') ?? 'Curso'
  const reasons = assertReasons(input.reasons)
  const hours = assertHours(input.hours)
  const investmentCents = resolveInvestment(input.sponsor, input.investmentCents)
  const completionDate = assertDate(input.completionDate, 'A data de conclusão')
  const requestDate = input.requestDate
    ? assertDate(input.requestDate, 'A data da solicitação')
    : dayFromYmd(todayInSaoPaulo().ymd)
  const identity = await trainingIdentityOf(input.userId, input.companyId)
  const selfService = input.source === 'Autoatendimento do colaborador'

  const created = await scopedPrisma(input.companyId).trainingRecord.create({
    data: {
      userId: input.userId,
      ...identity,
      courseTitle,
      learningType,
      modality: cleanText(input.modality, 40, 'A modalidade'),
      trainingType: input.trainingType ?? null,
      hours,
      institution: cleanText(input.institution, TRAINING_INSTITUTION_MAX_LENGTH, 'A instituição'),
      sponsor: input.sponsor,
      sponsorOther:
        input.sponsor === 'OUTRO'
          ? cleanText(input.sponsorOther, TRAINING_SPONSOR_OTHER_MAX_LENGTH, 'O patrocinador')
          : null,
      investmentCents,
      reasons,
      priority: assertPriority(input.priority),
      requestDate,
      completionDate,
      source: input.source,
      notes: cleanText(input.notes, TRAINING_NOTES_MAX_LENGTH, 'As observações'),
      attachmentKey: assertAttachmentKey(input.attachmentKey, input.userId),
      validationStatus: selfService ? 'PENDING' : 'APPROVED',
      ...(selfService ? {} : { reviewedById: input.actorId, reviewedAt: new Date() }),
      createdById: input.actorId,
    },
    include: RECORD_INCLUDE,
  })
  return created
}

async function loadRecord(id: string, companyId: string): Promise<TrainingRecordRow> {
  const record = await scopedPrisma(companyId).trainingRecord.findFirst({
    where: { id, deletedAt: null },
    include: RECORD_INCLUDE,
  })
  if (!record) throw new TrainingError('Registro não encontrado.', 404)
  return record
}

/**
 * Quem pode mexer no registro.
 *
 * O dono edita o próprio **enquanto a G&G não avaliou** — depois de validado, o
 * número já entrou no indicador, e deixá-lo mudar por baixo seria reescrever o
 * painel do mês passado. Recusado continua editável de propósito: é justamente
 * o que a pessoa precisa corrigir para reenviar.
 */
function assertCanEdit(record: TrainingRecord, actor: TrainingActor, isAdmin: boolean): void {
  if (isAdmin) return
  if (record.userId !== actor.id) throw new TrainingError('Registro não encontrado.', 404)
  if (record.validationStatus === 'APPROVED') {
    throw new TrainingError('Este treinamento já foi validado pelo T&D. Fale com a G&G para corrigir.', 409)
  }
}

export async function updateTrainingRecord(
  id: string,
  input: UpdateTrainingRecordRequest,
  actor: TrainingActor,
  isAdmin: boolean,
): Promise<TrainingRecordRow> {
  const before = await loadRecord(id, actor.companyId)
  assertCanEdit(before, actor, isAdmin)

  const data: Prisma.TrainingRecordUpdateInput = {}
  if (input.courseTitle !== undefined) {
    const title = cleanText(input.courseTitle, TRAINING_COURSE_TITLE_MAX_LENGTH, 'O nome do treinamento')
    if (!title) throw new TrainingError('Informe o curso ou capacitação.')
    data.courseTitle = title
  }
  if (input.learningType !== undefined) {
    data.learningType =
      cleanText(input.learningType, TRAINING_LEARNING_TYPE_MAX_LENGTH, 'O tipo de aprendizado') ?? 'Curso'
  }
  if (input.modality !== undefined) data.modality = cleanText(input.modality, 40, 'A modalidade')
  if (input.trainingType !== undefined) data.trainingType = input.trainingType
  if (input.hours !== undefined) data.hours = assertHours(input.hours)
  if (input.institution !== undefined) {
    data.institution = cleanText(input.institution, TRAINING_INSTITUTION_MAX_LENGTH, 'A instituição')
  }
  if (input.reasons !== undefined) data.reasons = assertReasons(input.reasons)
  if (input.priority !== undefined) data.priority = assertPriority(input.priority)
  if (input.notes !== undefined) data.notes = cleanText(input.notes, TRAINING_NOTES_MAX_LENGTH, 'As observações')
  if (input.completionDate !== undefined) data.completionDate = assertDate(input.completionDate, 'A data de conclusão')
  if (input.requestDate !== undefined && input.requestDate) {
    data.requestDate = assertDate(input.requestDate, 'A data da solicitação')
  }
  if (input.attachmentKey !== undefined) {
    data.attachmentKey = assertAttachmentKey(input.attachmentKey, before.userId)
  }
  const participation = assertParticipation(input.participationStatus)
  if (participation) {
    if (!isAdmin) throw new TrainingError('Só o T&D muda a situação de participação.', 403)
    data.participationStatus = participation
  }
  // Patrocinador e valor andam juntos: trocar um sem reavaliar o outro deixaria
  // investimento gravado num registro que passou a ser gratuito.
  if (input.sponsor !== undefined || input.investmentCents !== undefined) {
    const sponsor = input.sponsor ?? before.sponsor
    data.sponsor = sponsor
    data.sponsorOther =
      sponsor === 'OUTRO'
        ? cleanText(input.sponsorOther ?? before.sponsorOther, TRAINING_SPONSOR_OTHER_MAX_LENGTH, 'O patrocinador')
        : null
    data.investmentCents = resolveInvestment(sponsor, input.investmentCents ?? before.investmentCents)
  }

  // Correção do dono volta para a fila: o que a G&G validou foi a versão
  // anterior. Edição do próprio T&D não reabre nada — ele É a validação.
  if (!isAdmin && before.validationStatus === 'REJECTED') {
    data.validationStatus = 'PENDING'
    data.rejectionReason = null
  }

  const updated = await scopedPrisma(actor.companyId).trainingRecord.update({
    where: { id },
    data,
    include: RECORD_INCLUDE,
  })

  if (isAdmin) {
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'TrainingRecord',
      entityId: id,
      action: 'UPDATE',
      before,
      after: updated,
      companyId: actor.companyId,
    })
  }
  return updated
}

/** Exclusão é lógica: o registro sai das telas, mas o histórico de auditoria continua fazendo sentido. */
export async function deleteTrainingRecord(id: string, actor: TrainingActor, isAdmin: boolean): Promise<void> {
  const record = await loadRecord(id, actor.companyId)
  assertCanEdit(record, actor, isAdmin)

  await scopedPrisma(actor.companyId).trainingRecord.update({ where: { id }, data: { deletedAt: new Date() } })
  if (isAdmin) {
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'TrainingRecord',
      entityId: id,
      action: 'DELETE',
      before: record,
      companyId: actor.companyId,
    })
  }
}

/**
 * A G&G valida ou recusa. Notificar é best-effort: falhar em avisar não desfaz
 * uma validação já gravada.
 */
export async function reviewTrainingRecord(
  id: string,
  input: ReviewTrainingRecordRequest,
  actor: TrainingActor,
): Promise<TrainingRecordRow> {
  const before = await loadRecord(id, actor.companyId)
  const reason =
    input.status === 'REJECTED'
      ? cleanText(input.rejectionReason, TRAINING_REJECTION_REASON_MAX_LENGTH, 'O motivo')
      : null
  if (input.status === 'REJECTED' && !reason) throw new TrainingError('Informe o motivo da recusa.')

  const updated = await scopedPrisma(actor.companyId).trainingRecord.update({
    where: { id },
    data: {
      validationStatus: input.status,
      rejectionReason: reason,
      reviewedById: actor.id,
      reviewedAt: new Date(),
    },
    include: RECORD_INCLUDE,
  })

  await recordAuditLog({
    actorId: actor.id,
    entityType: 'TrainingRecord',
    entityId: id,
    action: 'UPDATE',
    before,
    after: updated,
    companyId: actor.companyId,
  })

  try {
    await notifyTrainingReviewed({
      userId: updated.userId,
      courseTitle: updated.courseTitle,
      approved: input.status === 'APPROVED',
      rejectionReason: reason,
      companyId: actor.companyId,
    })
  } catch (err) {
    console.error('[training-service] Falha ao notificar validação de treinamento.', err)
  }
  return updated
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/** Os registros da própria pessoa, do mais recente para o mais antigo. */
export function listMyTrainingRecords(userId: string, companyId: string): Promise<TrainingRecordRow[]> {
  return scopedPrisma(companyId).trainingRecord.findMany({
    where: { userId, deletedAt: null },
    include: RECORD_INCLUDE,
    orderBy: [{ completionDate: 'desc' }, { createdAt: 'desc' }],
    take: QUERY_LIMIT,
  })
}

/**
 * Traduz os filtros em `WHERE`.
 *
 * Semestre, trimestre e SLA ficam de fora de propósito: os três são derivados de
 * data e não existem como coluna (ver decisão 4 do spec). Eles são aplicados
 * depois, em `refine`, sobre o conjunto já recortado.
 */
function buildWhere(filters: TrainingFilters): Prisma.TrainingRecordWhereInput {
  const where: Prisma.TrainingRecordWhereInput = { deletedAt: null }

  const completion: Prisma.DateTimeFilter = {}
  if (filters.from) completion.gte = dayFromYmd(filters.from)
  if (filters.to) completion.lte = dayFromYmd(filters.to)
  const year = Number(filters.year)
  if (Number.isInteger(year) && year > 1900) {
    completion.gte = dayFromYmd(`${year}-01-01`)
    completion.lte = dayFromYmd(`${year}-12-31`)
  }
  if (Object.keys(completion).length > 0) where.completionDate = completion

  if (filters.sector) where.sectorName = filters.sector
  if (filters.squad) where.squad = filters.squad
  if (filters.leader) where.leaderName = filters.leader
  if (filters.positionCategory) where.positionCategory = filters.positionCategory
  if (filters.employmentType) where.employmentType = filters.employmentType
  if (filters.learningType) where.learningType = filters.learningType
  if (filters.institution) where.institution = filters.institution
  if (filters.priority) where.priority = filters.priority
  if (filters.source) where.source = filters.source
  if (filters.participationStatus) where.participationStatus = filters.participationStatus
  if (filters.eventId) where.eventId = filters.eventId
  if (filters.sponsor) where.sponsor = filters.sponsor as Prisma.TrainingRecordWhereInput['sponsor']
  if (filters.validationStatus) {
    where.validationStatus = filters.validationStatus as Prisma.TrainingRecordWhereInput['validationStatus']
  }
  if (filters.reason) where.reasons = { has: filters.reason as TrainingReason }

  const search = filters.search?.trim()
  if (search) {
    where.OR = [
      { courseTitle: { contains: search, mode: 'insensitive' } },
      { userName: { contains: search, mode: 'insensitive' } },
      { institution: { contains: search, mode: 'insensitive' } },
      { sectorName: { contains: search, mode: 'insensitive' } },
    ]
  }
  return where
}

/** O que o `WHERE` não expressa: semestre, trimestre e SLA. */
function refine(rows: TrainingRecordRow[], filters: TrainingFilters, slaDays: number): TrainingRecordRow[] {
  if (!filters.semester && !filters.quarter && !filters.sla) return rows
  return rows.filter((row) => {
    const month = row.completionDate ? row.completionDate.getUTCMonth() + 1 : null
    if (filters.semester) {
      if (month == null) return false
      const semester = month <= 6 ? '1º semestre' : '2º semestre'
      if (semester !== filters.semester) return false
    }
    if (filters.quarter) {
      if (month == null) return false
      if (`T${Math.ceil(month / 3)}` !== filters.quarter) return false
    }
    if (filters.sla) {
      const status: TrainingSlaStatus = trainingSlaStatus(
        { requestDate: ymdOf(row.requestDate), completionDate: row.completionDate ? ymdOf(row.completionDate) : null },
        slaDays,
      )
      if (status !== filters.sla) return false
    }
    return true
  })
}

/** A linha como os agregados a enxergam — sem assinar URL de anexo para somar horas. */
export function toTrainingFact(row: TrainingRecordRow): TrainingFact {
  return {
    userId: row.userId,
    eventId: row.eventId,
    courseTitle: row.courseTitle,
    sectorName: row.sectorName,
    squad: row.squad,
    leaderName: row.leaderName,
    positionCategory: row.positionCategory,
    learningType: row.learningType,
    institution: row.institution,
    source: row.source,
    hours: Number(row.hours),
    investmentCents: row.investmentCents,
    reasons: row.reasons,
    participationStatus: row.participationStatus as TrainingParticipationStatus,
    requestDate: ymdOf(row.requestDate),
    completionDate: row.completionDate ? ymdOf(row.completionDate) : null,
  }
}

async function findFiltered(companyId: string, filters: TrainingFilters, slaDays: number) {
  const rows = await scopedPrisma(companyId).trainingRecord.findMany({
    where: buildWhere(filters),
    include: RECORD_INCLUDE,
    orderBy: [{ completionDate: 'desc' }, { createdAt: 'desc' }],
    take: QUERY_LIMIT,
  })
  return refine(rows, filters, slaDays)
}

export interface TrainingRecordsPage {
  rows: TrainingRecordRow[]
  page: number
  pageCount: number
  total: number
  pending: number
}

export async function listTrainingRecords(
  companyId: string,
  filters: TrainingFilters,
  page: number,
): Promise<TrainingRecordsPage> {
  const slaDays = await getTrainingSlaDays(companyId)
  const rows = await findFiltered(companyId, filters, slaDays)
  const pageCount = Math.max(1, Math.ceil(rows.length / TRAINING_RECORDS_PAGE_SIZE))
  const current = Math.min(Math.max(1, page), pageCount)
  const start = (current - 1) * TRAINING_RECORDS_PAGE_SIZE
  return {
    rows: rows.slice(start, start + TRAINING_RECORDS_PAGE_SIZE),
    page: current,
    pageCount,
    total: rows.length,
    pending: rows.filter((row) => row.validationStatus === 'PENDING').length,
  }
}

/**
 * O painel.
 *
 * Os indicadores contam o que a G&G **validou** — número de painel executivo não
 * pode se mexer porque alguém anexou um PDF em branco. A Central, essa sim,
 * mostra tudo: é lá que a pendência precisa aparecer para ser resolvida.
 */
export async function trainingOverview(companyId: string, filters: TrainingFilters): Promise<TrainingDashboardDTO> {
  const slaDays = await getTrainingSlaDays(companyId)
  const rows = await findFiltered(companyId, filters, slaDays)
  const facts = rows.filter((row) => row.validationStatus === 'APPROVED').map(toTrainingFact)

  const population = await scopedPrisma(companyId).user.findMany({
    where: { active: true },
    select: { id: true, sector: { select: { name: true } } },
  })
  const people = population.map((person) => ({ userId: person.id, sectorName: person.sector?.name ?? null }))

  const hours = (fact: TrainingFact) => fact.hours
  const money = (fact: TrainingFact) => fact.investmentCents

  const sla = (['Dentro do SLA', 'Fora do SLA', 'Pendente'] as const).map((name) => ({
    name,
    value: facts.filter((fact) => trainingSlaStatus(fact, slaDays) === name).length,
  }))

  return {
    kpis: computeTrainingKpis(facts, slaDays, people.length),
    monthly: trainingMonthlySeries(facts),
    bySector: groupTrainingBy(facts, (fact) => fact.sectorName).slice(0, 10),
    hoursBySector: groupTrainingBy(
      facts.filter((fact) => fact.participationStatus === 'Participou'),
      (fact) => fact.sectorName,
      hours,
    ).slice(0, 10),
    investmentBySector: groupTrainingBy(facts, (fact) => fact.sectorName, money).slice(0, 10),
    byLearningType: groupTrainingBy(facts, (fact) => fact.learningType),
    byInstitution: groupTrainingBy(facts, (fact) => fact.institution).slice(0, 8),
    bySource: groupTrainingBy(facts, (fact) => fact.source),
    byReason: groupTrainingBy(facts, (fact) => fact.reasons[0] ?? null),
    byLeader: groupTrainingBy(facts, (fact) => fact.leaderName).slice(0, 10),
    byPositionCategory: groupTrainingBy(facts, (fact) => fact.positionCategory),
    sla,
    coverageBySector: computeTrainingCoverage(facts, people).slice(0, 10),
    slaDays,
  }
}

/** Todas as linhas do recorte, para o CSV — sem paginar. */
export async function listTrainingRecordsForExport(
  companyId: string,
  filters: TrainingFilters,
): Promise<TrainingRecordRow[]> {
  const slaDays = await getTrainingSlaDays(companyId)
  return findFiltered(companyId, filters, slaDays)
}

/**
 * Valores realmente em uso, para os seletores. Sai dos REGISTROS, e não do
 * cadastro: filtro que oferece um setor sem nenhum treinamento é um caminho que
 * só leva a tela vazia.
 */
export async function listTrainingFilterOptions(companyId: string): Promise<TrainingFilterOptionsDTO> {
  const db = scopedPrisma(companyId)
  const [rows, events, slaDays] = await Promise.all([
    db.trainingRecord.findMany({
      where: { deletedAt: null },
      select: {
        sectorName: true,
        squad: true,
        leaderName: true,
        positionCategory: true,
        institution: true,
        learningType: true,
        completionDate: true,
      },
      take: QUERY_LIMIT,
    }),
    db.trainingEvent.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { eventDate: 'desc' },
      take: 200,
    }),
    getTrainingSlaDays(companyId),
  ])

  const distinct = (pick: (row: (typeof rows)[number]) => string | null): string[] =>
    [...new Set(rows.map(pick).filter((value): value is string => Boolean(value?.trim())))].sort((a, b) =>
      a.localeCompare(b, 'pt-BR'),
    )

  return {
    sectors: distinct((row) => row.sectorName),
    squads: distinct((row) => row.squad),
    leaders: distinct((row) => row.leaderName),
    positionCategories: distinct((row) => row.positionCategory),
    institutions: distinct((row) => row.institution),
    learningTypes: distinct((row) => row.learningType),
    years: [
      ...new Set(rows.map((row) => row.completionDate?.getUTCFullYear()).filter((y): y is number => Boolean(y))),
    ].sort((a, b) => b - a),
    events,
    slaDays,
  }
}

// ---------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------

const CSV_HEADER = [
  'Pessoa',
  'Setor',
  'Squad',
  'Liderança',
  'Cargo',
  'Categoria de cargo',
  'Vínculo',
  'Treinamento',
  'Tipo de aprendizado',
  'Natureza',
  'Modalidade',
  'Instituição',
  'Carga horária',
  'Patrocinador',
  'Investimento (R$)',
  'Motivos',
  'Prioridade',
  'Participação',
  'Origem do registro',
  'Evento',
  'Solicitado em',
  'Concluído em',
  'Ano',
  'Trimestre',
  'Semestre',
  'Dias de SLA',
  'Situação do SLA',
  'Validação',
  'Validado por',
  'Motivo da recusa',
]

/**
 * CSV do recorte filtrado INTEIRO — não da página. Separador `;` e BOM UTF-8
 * porque o Excel em pt-BR abre assim sem pedir importação.
 *
 * O CPF da planilha de origem não entra: o arquivo circula por e-mail e o campo
 * não responde nenhuma pergunta do T&D que o nome já não responda.
 */
export async function exportTrainingCsv(companyId: string, filters: TrainingFilters): Promise<string> {
  const slaDays = await getTrainingSlaDays(companyId)
  const rows = await findFiltered(companyId, filters, slaDays)

  const lines = [CSV_HEADER.join(';')]
  for (const row of rows) {
    const fact = toTrainingFact(row)
    lines.push(
      [
        csvCell(row.userName),
        csvCell(row.sectorName),
        csvCell(row.squad),
        csvCell(row.leaderName),
        csvCell(row.position),
        csvCell(row.positionCategory),
        csvCell(row.employmentType),
        csvCell(row.courseTitle),
        csvCell(row.learningType),
        csvCell(row.trainingType ? TRAINING_TYPE_LABELS[row.trainingType] : null),
        csvCell(row.modality),
        csvCell(row.institution),
        String(fact.hours).replace('.', ','),
        csvCell(TRAINING_SPONSOR_LABELS[row.sponsor]),
        (row.investmentCents / 100).toFixed(2).replace('.', ','),
        csvCell(row.reasons.map((reason) => TRAINING_REASON_LABELS[reason]).join(', ')),
        csvCell(row.priority),
        csvCell(row.participationStatus),
        csvCell(row.source),
        csvCell(row.event?.name ?? null),
        fact.requestDate,
        fact.completionDate ?? '',
        String(trainingYear(fact.completionDate) ?? ''),
        trainingQuarter(fact.completionDate) ?? '',
        trainingSemester(fact.completionDate) ?? '',
        String(trainingSlaDays(fact.requestDate, fact.completionDate) ?? ''),
        trainingSlaStatus(fact, slaDays),
        TRAINING_VALIDATION_STATUS_LABELS[row.validationStatus],
        csvCell(row.reviewedBy?.name ?? null),
        csvCell(row.rejectionReason),
      ].join(';'),
    )
  }
  return `﻿${lines.join('\n')}\n`
}

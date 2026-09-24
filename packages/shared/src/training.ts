/**
 * Contrato do módulo de Treinamentos (T&D).
 *
 * O fato é o **registro de treinamento**: uma pessoa fez uma ação de
 * desenvolvimento, em tal data, com tanta carga horária e tanto investimento.
 * Ele nasce por três portas (`TrainingSource`) — o autoatendimento do
 * colaborador, o evento interno cadastrado pelo T&D e o cadastro manual — e é
 * sempre a MESMA linha, para que o painel e a fila de validação nunca discordem.
 *
 * Não confundir com `training-analytics.ts`, que é outra coisa: lá o fato é a
 * conclusão de curso do CATÁLOGO INTERNO (`CourseEnrollment.completedAt`), e a
 * pergunta é sobre o consumo do que a empresa publicou. Aqui a pergunta é sobre
 * o desenvolvimento da pessoa, tenha ele acontecido dentro ou fora do portal.
 *
 * Spec: `docs/superpowers/specs/2026-09-12-modulo-de-treinamentos-td-design.md`.
 */

/** Natureza do conteúdo. Herdado do envio de certificado externo, que já o pedia. */
export const TRAINING_TYPES = ['COMPLIANCE', 'TECNICO', 'COMPORTAMENTAL'] as const
export type TrainingType = (typeof TRAINING_TYPES)[number]

export const TRAINING_TYPE_LABELS: Record<TrainingType, string> = {
  COMPLIANCE: 'Compliance (regras, políticas, ética, LGPD…)',
  TECNICO: 'Técnico (conteúdos da função, ferramentas e processos)',
  COMPORTAMENTAL: 'Comportamental (comunicação, liderança, colaboração…)',
}

/**
 * Quem pagou. `EMR` é o valor histórico da coluna e continua sendo "a empresa" —
 * o rótulo é neutro de propósito, porque o produto é white label e o registro de
 * outro cliente não fala de EMR.
 */
export const TRAINING_SPONSORS = ['GRATUITO', 'EMR', 'PROPRIO', 'OUTRO'] as const
export type TrainingSponsor = (typeof TRAINING_SPONSORS)[number]

export const TRAINING_SPONSOR_LABELS: Record<TrainingSponsor, string> = {
  GRATUITO: 'Gratuito',
  EMR: 'A empresa',
  PROPRIO: 'Meu dinheiro',
  OUTRO: 'Outro',
}

/**
 * De onde veio a demanda. É este eixo — e não um campo `lnt_pdi` de texto — que
 * diz se o treinamento foi PEDIDO por alguém, o que decide se há SLA a cumprir.
 */
export const TRAINING_REASONS = [
  'INICIATIVA_PROPRIA',
  'SOLICITACAO_GESTOR',
  'LNT',
  'PDI',
  'OBRIGATORIO',
] as const
export type TrainingReason = (typeof TRAINING_REASONS)[number]

export const TRAINING_REASON_LABELS: Record<TrainingReason, string> = {
  INICIATIVA_PROPRIA: 'Por iniciativa própria',
  SOLICITACAO_GESTOR: 'Solicitação do gestor',
  LNT: 'Levantamento de necessidades (LNT)',
  PDI: 'Faz parte do PDI',
  OBRIGATORIO: 'Obrigatório',
}

/** O formulário pede "selecione até 2" desde o envio de certificado. */
export const MAX_TRAINING_REASONS = 2

/**
 * A demanda partiu de alguém (LNT, PDI ou pedido do líder)? Só aí existe prazo a
 * cumprir: curso que a pessoa fez por conta própria não tem SLA de ninguém, e
 * contá-lo afundaria o indicador do time sem que houvesse falha.
 */
export function isDemandDrivenTraining(reasons: readonly TrainingReason[]): boolean {
  return reasons.some((reason) => reason === 'LNT' || reason === 'PDI' || reason === 'SOLICITACAO_GESTOR')
}

/** Formato da ação. Lista aberta pelo "Outro", que grava o texto que a pessoa escreveu. */
export const TRAINING_LEARNING_TYPES = [
  'Curso',
  'Workshop',
  'Palestra',
  'Webinar',
  'Treinamento',
  'Evento',
  'Capacitação',
  'Mentoria',
  'Outro',
] as const

export const TRAINING_MODALITIES = ['Online ao vivo', 'Online gravado', 'Presencial', 'Híbrido'] as const

export const TRAINING_PRIORITIES = ['Alta', 'Média', 'Baixa'] as const
export type TrainingPriority = (typeof TRAINING_PRIORITIES)[number]

/**
 * Situação na ação — o eixo do evento interno. Inscrever cem pessoas e depois
 * marcar quem apareceu é o fluxo, e "Inscrito" não é hora de aprendizagem:
 * horas e cobertura contam só `Participou`.
 */
export const TRAINING_PARTICIPATION_STATUS = [
  'Participou',
  'Inscrito',
  'Não participou',
  'Ausente',
  'Cancelado',
] as const
export type TrainingParticipationStatus = (typeof TRAINING_PARTICIPATION_STATUS)[number]

/** Por qual porta a linha entrou. */
export const TRAINING_SOURCES = [
  'Autoatendimento do colaborador',
  'Evento interno',
  'Cadastro pelo T&D',
] as const
export type TrainingSource = (typeof TRAINING_SOURCES)[number]

/**
 * Validação da G&G — outro eixo, não confundir com a participação. Registro de
 * autoatendimento nasce `PENDING` (alguém confere o comprovante); o que o T&D
 * cadastra ou que vem de evento nasce `APPROVED`, porque quem cadastrou já é a
 * fonte. Indicador conta o aprovado.
 */
export const TRAINING_VALIDATION_STATUS = ['PENDING', 'APPROVED', 'REJECTED'] as const
export type TrainingValidationStatus = (typeof TRAINING_VALIDATION_STATUS)[number]

export const TRAINING_VALIDATION_STATUS_LABELS: Record<TrainingValidationStatus, string> = {
  PENDING: 'Em análise',
  APPROVED: 'Validado',
  REJECTED: 'Recusado',
}

export type TrainingSlaStatus = 'Dentro do SLA' | 'Fora do SLA' | 'Pendente'

/** Prazo padrão entre solicitar e concluir, em dias. Editável por empresa. */
export const TRAINING_DEFAULT_SLA_DAYS = 90
export const TRAINING_MIN_SLA_DAYS = 1
export const TRAINING_MAX_SLA_DAYS = 730

export const TRAINING_COURSE_TITLE_MAX_LENGTH = 160
export const TRAINING_INSTITUTION_MAX_LENGTH = 120
export const TRAINING_SPONSOR_OTHER_MAX_LENGTH = 120
export const TRAINING_LEARNING_TYPE_MAX_LENGTH = 60
export const TRAINING_NOTES_MAX_LENGTH = 1000
export const TRAINING_REJECTION_REASON_MAX_LENGTH = 500
export const TRAINING_EVENT_NAME_MAX_LENGTH = 160
export const TRAINING_EVENT_DESCRIPTION_MAX_LENGTH = 1000
/** Uma jornada de 24h/dia por um ano ainda cabe; acima disso é erro de digitação. */
export const TRAINING_MAX_HOURS = 9999
/** R$ 1.000.000,00 em centavos — teto de sanidade do investimento por registro. */
export const TRAINING_MAX_INVESTMENT_CENTS = 100_000_000

/** Quantas linhas a Central devolve por página. */
export const TRAINING_RECORDS_PAGE_SIZE = 25

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface TrainingReviewerRef {
  id: string
  name: string
}

/**
 * O registro como a tela o lê.
 *
 * Os campos de identificação (`sectorName`, `squad`, `leaderName`, `position`,
 * `positionCategory`, `employmentType`) são SNAPSHOT do momento da escrita, não
 * join: quem muda de setor em março não leva o treinamento de janeiro junto.
 */
export interface TrainingRecordDTO {
  id: string
  userId: string
  userName: string
  userPhotoUrl: string | null
  sectorName: string | null
  squad: string | null
  leaderName: string | null
  position: string | null
  positionCategory: string | null
  employmentType: string | null

  eventId: string | null
  eventName: string | null

  courseTitle: string
  learningType: string
  modality: string | null
  trainingType: TrainingType | null
  hours: number
  institution: string | null
  sponsor: TrainingSponsor
  sponsorOther: string | null
  investmentCents: number
  reasons: TrainingReason[]
  priority: TrainingPriority

  /** Data civil `YYYY-MM-DD`: o registro é de um dia, não de um instante. */
  requestDate: string
  completionDate: string | null
  participationStatus: TrainingParticipationStatus
  source: TrainingSource
  notes: string | null

  /** URL assinada e temporária do comprovante; null quando não há anexo. */
  certificateUrl: string | null
  hasCertificate: boolean

  validationStatus: TrainingValidationStatus
  reviewedBy: TrainingReviewerRef | null
  reviewedAt: string | null
  rejectionReason: string | null

  /** Derivados — calculados, nunca guardados (ver `trainingYear` e vizinhas). */
  year: number | null
  quarter: string | null
  semester: string | null
  slaDays: number | null
  slaStatus: TrainingSlaStatus

  createdAt: string
  updatedAt: string
}

/** Evento interno: o molde de onde nascem várias participações de uma vez. */
export interface TrainingEventDTO {
  id: string
  name: string
  description: string | null
  learningType: string
  modality: string | null
  eventDate: string | null
  hours: number
  institution: string | null
  trainingType: TrainingType | null
  reasons: TrainingReason[]
  priority: TrainingPriority
  defaultInvestmentCents: number
  status: string
  participants: number
  attended: number
  createdAt: string
}

export interface CreateTrainingRecordRequest {
  courseTitle: string
  learningType: string
  modality?: string | null
  trainingType?: TrainingType | null
  hours: number
  institution?: string | null
  sponsor: TrainingSponsor
  sponsorOther?: string | null
  investmentCents?: number | null
  reasons: TrainingReason[]
  priority?: TrainingPriority
  completionDate: string
  /** Quando a demanda nasceu; ausente = a data de hoje, no servidor. */
  requestDate?: string | null
  notes?: string | null
  attachmentKey?: string | null
}

export type UpdateTrainingRecordRequest = Partial<CreateTrainingRecordRequest> & {
  participationStatus?: TrainingParticipationStatus
}

export interface ReviewTrainingRecordRequest {
  status: Extract<TrainingValidationStatus, 'APPROVED' | 'REJECTED'>
  rejectionReason?: string | null
}

/**
 * Filtros da Central e do painel. Todos opcionais, todos aplicados no
 * SERVIDOR: filtrar depois de paginar esconderia o resultado da página seguinte,
 * e somar KPI só do que está na tela faria o número mudar ao virar a página.
 */
export interface TrainingFilters {
  /** Recorte por data de conclusão (`YYYY-MM-DD`). */
  from?: string
  to?: string
  year?: string
  semester?: string
  quarter?: string
  sector?: string
  squad?: string
  leader?: string
  positionCategory?: string
  employmentType?: string
  learningType?: string
  institution?: string
  sponsor?: string
  reason?: string
  participationStatus?: string
  validationStatus?: string
  sla?: string
  priority?: string
  source?: string
  eventId?: string
  search?: string
}

/** Valores realmente em uso, para montar os seletores sem inventar opção vazia. */
export interface TrainingFilterOptionsDTO {
  sectors: string[]
  squads: string[]
  leaders: string[]
  positionCategories: string[]
  institutions: string[]
  learningTypes: string[]
  years: number[]
  events: { id: string; name: string }[]
  slaDays: number
}

export interface TrainingKpisDTO {
  /** Ações distintas: o evento conta uma vez, não uma por participante. */
  trainings: number
  participations: number
  people: number
  hours: number
  avgHours: number
  investmentCents: number
  avgInvestmentCents: number
  pctConcluded: number
  pctPdi: number
  pctLnt: number
  pctMandatory: number
  avgSla: number
  pctInSla: number
  /** % de gente ativa com ao menos uma ação no recorte. */
  coverage: number
  totalCollaborators: number
}

export interface TrainingSliceDTO {
  name: string
  value: number
}

export interface TrainingMonthPointDTO {
  /** `YYYY-MM`. */
  month: string
  trainings: number
  hours: number
  investmentCents: number
}

/**
 * O painel inteiro em uma resposta. Não se chama `TrainingOverviewDTO` porque
 * esse nome já é de `training-analytics.ts`, que responde outra pergunta (o
 * consumo do catálogo interno) — dois tipos com o mesmo nome no barril seriam
 * ambiguidade de export e, pior, confusão de leitura.
 */
export interface TrainingDashboardDTO {
  kpis: TrainingKpisDTO
  monthly: TrainingMonthPointDTO[]
  bySector: TrainingSliceDTO[]
  hoursBySector: TrainingSliceDTO[]
  investmentBySector: TrainingSliceDTO[]
  byLearningType: TrainingSliceDTO[]
  byInstitution: TrainingSliceDTO[]
  bySource: TrainingSliceDTO[]
  byReason: TrainingSliceDTO[]
  byLeader: TrainingSliceDTO[]
  byPositionCategory: TrainingSliceDTO[]
  sla: TrainingSliceDTO[]
  coverageBySector: TrainingSliceDTO[]
  slaDays: number
}

export interface TrainingRecordsPageDTO {
  records: TrainingRecordDTO[]
  page: number
  pageCount: number
  total: number
  /** Quantos aguardam validação no recorte inteiro — o contador da aba. */
  pending: number
}

export interface MyTrainingResponse {
  records: TrainingRecordDTO[]
  /** Horas e investimento da própria pessoa, no ano corrente. */
  yearHours: number
  yearTrainings: number
}

// ---------------------------------------------------------------------------
// Derivados — funções puras
// ---------------------------------------------------------------------------

/**
 * O mínimo que os agregados precisam de uma linha.
 *
 * `TrainingRecordDTO` satisfaz esta forma, mas o serviço agrega ANTES de
 * serializar: montar o DTO completo assinaria uma URL de S3 por linha só para
 * somar horas.
 */
export interface TrainingFact {
  userId: string
  eventId: string | null
  courseTitle: string
  sectorName: string | null
  squad: string | null
  leaderName: string | null
  positionCategory: string | null
  learningType: string
  institution: string | null
  source: string
  hours: number
  investmentCents: number
  reasons: readonly TrainingReason[]
  participationStatus: TrainingParticipationStatus
  requestDate: string
  completionDate: string | null
}

const MISSING = 'Não informado'

/** Milissegundos de um `YYYY-MM-DD` lido ao meio-dia UTC — sem virada de fuso. */
function dayMs(ymd: string): number {
  return Date.parse(`${ymd}T12:00:00Z`)
}

export function trainingYear(completionDate: string | null): number | null {
  if (!completionDate) return null
  const year = Number(completionDate.slice(0, 4))
  return Number.isFinite(year) ? year : null
}

export function trainingQuarter(completionDate: string | null): string | null {
  if (!completionDate) return null
  const month = Number(completionDate.slice(5, 7))
  if (!month) return null
  return `T${Math.ceil(month / 3)}`
}

export function trainingSemester(completionDate: string | null): string | null {
  if (!completionDate) return null
  const month = Number(completionDate.slice(5, 7))
  if (!month) return null
  return month <= 6 ? '1º semestre' : '2º semestre'
}

/**
 * Dias entre solicitar e concluir. Negativo é possível e fica como está: quem
 * concluiu antes de a demanda ser registrada tem zero de atraso, e esconder o
 * sinal apagaria o erro de cadastro em vez de mostrá-lo.
 */
export function trainingSlaDays(requestDate: string, completionDate: string | null): number | null {
  if (!completionDate) return null
  const diff = dayMs(completionDate) - dayMs(requestDate)
  if (!Number.isFinite(diff)) return null
  return Math.round(diff / 86_400_000)
}

export function trainingSlaStatus(
  fact: Pick<TrainingFact, 'requestDate' | 'completionDate'>,
  slaDays: number,
): TrainingSlaStatus {
  const days = trainingSlaDays(fact.requestDate, fact.completionDate)
  if (days == null) return 'Pendente'
  return days <= slaDays ? 'Dentro do SLA' : 'Fora do SLA'
}

/** Só o que a pessoa de fato fez vira hora de aprendizagem. */
export function isCountedTraining(fact: Pick<TrainingFact, 'participationStatus'>): boolean {
  return fact.participationStatus === 'Participou'
}

function percent(part: number, total: number): number {
  if (total <= 0) return 0
  return Math.round((part / total) * 1000) / 10
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

export function computeTrainingKpis(
  facts: readonly TrainingFact[],
  slaDays: number,
  totalCollaborators: number,
): TrainingKpisDTO {
  const counted = facts.filter(isCountedTraining)
  const people = new Set(counted.map((fact) => fact.userId))
  // Ação distinta: o evento agrupa por id; o registro avulso, por curso + data —
  // duas pessoas no mesmo curso no mesmo dia são um treinamento, não dois.
  const trainings = new Set(
    facts.map((fact) => fact.eventId ?? `${fact.courseTitle.toLowerCase()}|${fact.completionDate ?? ''}`),
  )
  const hours = counted.reduce((sum, fact) => sum + fact.hours, 0)
  const investmentCents = facts.reduce((sum, fact) => sum + fact.investmentCents, 0)
  const concluded = facts.filter((fact) => fact.completionDate).length

  const withSla = facts.filter((fact) => isDemandDrivenTraining(fact.reasons) && fact.completionDate)
  const slaSum = withSla.reduce((sum, fact) => sum + (trainingSlaDays(fact.requestDate, fact.completionDate) ?? 0), 0)
  const inSla = withSla.filter((fact) => trainingSlaStatus(fact, slaDays) === 'Dentro do SLA').length

  return {
    trainings: trainings.size,
    participations: facts.length,
    people: people.size,
    hours: round2(hours),
    avgHours: people.size ? round2(hours / people.size) : 0,
    investmentCents,
    avgInvestmentCents: people.size ? Math.round(investmentCents / people.size) : 0,
    pctConcluded: percent(concluded, facts.length),
    pctPdi: percent(facts.filter((fact) => fact.reasons.includes('PDI')).length, facts.length),
    pctLnt: percent(facts.filter((fact) => fact.reasons.includes('LNT')).length, facts.length),
    pctMandatory: percent(facts.filter((fact) => fact.reasons.includes('OBRIGATORIO')).length, facts.length),
    avgSla: withSla.length ? Math.round(slaSum / withSla.length) : 0,
    pctInSla: percent(inSla, withSla.length),
    coverage: percent(people.size, totalCollaborators),
    totalCollaborators,
  }
}

/**
 * Soma por chave, do maior para o menor. Linha sem o campo entra como
 * "Não informado" em vez de sumir — buraco de cadastro que desaparece do gráfico
 * é buraco que ninguém vai preencher.
 */
export function groupTrainingBy(
  facts: readonly TrainingFact[],
  key: (fact: TrainingFact) => string | null | undefined,
  value: (fact: TrainingFact) => number = () => 1,
): TrainingSliceDTO[] {
  const totals = new Map<string, number>()
  for (const fact of facts) {
    const name = key(fact)?.trim() || MISSING
    totals.set(name, (totals.get(name) ?? 0) + value(fact))
  }
  return [...totals.entries()]
    .map(([name, total]) => ({ name, value: round2(total) }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'pt-BR'))
}

export function trainingMonthlySeries(facts: readonly TrainingFact[]): TrainingMonthPointDTO[] {
  const months = new Map<string, TrainingMonthPointDTO>()
  for (const fact of facts) {
    const month = (fact.completionDate ?? fact.requestDate).slice(0, 7)
    const point = months.get(month) ?? { month, trainings: 0, hours: 0, investmentCents: 0 }
    point.trainings += 1
    if (isCountedTraining(fact)) point.hours += fact.hours
    point.investmentCents += fact.investmentCents
    months.set(month, point)
  }
  return [...months.values()]
    .map((point) => ({ ...point, hours: round2(point.hours) }))
    .sort((a, b) => a.month.localeCompare(b.month))
}

/**
 * Cobertura por grupo: dos ativos de cada setor, quantos % fizeram ao menos uma
 * ação no recorte. O denominador é a POPULAÇÃO (vem do cadastro), não quem
 * aparece nos registros — senão todo setor teria 100%.
 */
export function computeTrainingCoverage(
  facts: readonly TrainingFact[],
  population: readonly { sectorName: string | null; userId: string }[],
): TrainingSliceDTO[] {
  const totals = new Map<string, Set<string>>()
  for (const person of population) {
    const name = person.sectorName?.trim() || MISSING
    if (!totals.has(name)) totals.set(name, new Set())
    totals.get(name)!.add(person.userId)
  }

  const trained = new Map<string, Set<string>>()
  for (const fact of facts.filter(isCountedTraining)) {
    const name = fact.sectorName?.trim() || MISSING
    if (!trained.has(name)) trained.set(name, new Set())
    trained.get(name)!.add(fact.userId)
  }

  return [...totals.entries()]
    .map(([name, everyone]) => ({ name, value: percent(trained.get(name)?.size ?? 0, everyone.size) }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name, 'pt-BR'))
}

/** Reais a partir de centavos, no formato que a tela mostra. */
export function formatTrainingMoney(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function formatTrainingHours(hours: number): string {
  return `${hours.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}h`
}

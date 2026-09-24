/**
 * Eu Aprendiz — trilha do programa Jovem Aprendiz.
 * Spec: docs/superpowers/specs/2026-09-14-eu-aprendiz-design.md
 *
 * Não confundir com Treinamentos (`training.ts`), que é o registro de ação de
 * desenvolvimento de QUALQUER colaborador, nem com a Central de Cursos: aqui o
 * fato é a participação num encontro da trilha e a ficha preenchida nele.
 */

/** Categoria de cargo que dá acesso à área. Valor canônico de `POSITION_CATEGORIES`. */
export const APPRENTICE_POSITION_CATEGORY = 'Jovem Aprendiz'

/** Quantos encontros a trilha tem por padrão (o seed cria estes). Não é limite: o painel cria mais. */
export const APPRENTICE_DEFAULT_MEETING_COUNT = 6

export const APPRENTICE_CONTRACT_MAX_CLAUSES = 30
export const APPRENTICE_CONTRACT_CLAUSE_MAX_LENGTH = 400
export const APPRENTICE_TEXT_MAX_LENGTH = 4000
export const APPRENTICE_TITLE_MAX_LENGTH = 160
export const APPRENTICE_LIST_MAX_ITEMS = 20

// ---- Campos e fichas ----

/**
 * `lista` é o tipo que o protótipo não tinha: a Linha do Tempo do Encontro 1
 * pede cinco eventos com os mesmos subcampos, e sem isto ela teria de continuar
 * sendo um componente fixo em código — que é exatamente o que esta feature
 * deixou de ter.
 */
export const APPRENTICE_FIELD_TYPES = ['linha', 'texto', 'select', 'checkbox', 'lista'] as const
export type ApprenticeFieldType = (typeof APPRENTICE_FIELD_TYPES)[number]

export interface ApprenticeField {
  id: string
  label?: string
  type: ApprenticeFieldType
  placeholder?: string
  /** Só para `select`. */
  options?: string[]
  /** Só para `texto`: altura do campo. */
  rows?: number
  /** Só para `lista`: os subcampos que se repetem em cada item. */
  fields?: ApprenticeField[]
  /** Só para `lista`: quantos itens nascem prontos no formulário. */
  items?: number
  /** Campo exigido para o envio (rascunho salva de qualquer jeito). */
  required?: boolean
}

export interface ApprenticeBlockItem {
  title?: string
  lines: string[]
}

export interface ApprenticeBlock {
  /** Numeração visível do bloco ("1", "2"…). Ausente = bloco sem número. */
  number?: number
  title: string
  /** Tempo sugerido para o bloco, quando o roteiro do encontro define um. */
  time?: string
  note?: string
  highlight?: boolean
  /** Conteúdo fixo, só leitura — guias e listas de regras. */
  items?: ApprenticeBlockItem[]
  fields?: ApprenticeField[]
}

export interface ApprenticeActivitySchema {
  eyebrow?: string
  subtitle?: string
  footer?: string
  blocks: ApprenticeBlock[]
}

/** Um item de campo `lista`: subcampo → valor. */
export type ApprenticeListItem = Record<string, string>

export type ApprenticeFieldValue = string | boolean | ApprenticeListItem[]

export type ApprenticeValues = Record<string, ApprenticeFieldValue>

/**
 * `ACTIVITY` é ficha comum. `COMMITMENT` é o Cartão do Compromisso do Mês, um
 * por encontro. `REVIEW` é a revisão do compromisso do encontro ANTERIOR — a
 * única ficha que lê a submissão de outro encontro, e por isso só existe a
 * partir do segundo.
 */
export const APPRENTICE_ACTIVITY_KINDS = ['ACTIVITY', 'COMMITMENT', 'REVIEW'] as const
export type ApprenticeActivityKind = (typeof APPRENTICE_ACTIVITY_KINDS)[number]

/** Campo que a revisão lê do compromisso anterior, e o que ela grava. */
export const APPRENTICE_COMMITMENT_FIELD_ID = 'vou'
export const APPRENTICE_REVIEW_STATUS_FIELD_ID = 'status'

export const APPRENTICE_REVIEW_STATUSES = [
  'Cumpri totalmente',
  'Cumpri parcialmente',
  'Não cumpri',
] as const
export type ApprenticeReviewStatus = (typeof APPRENTICE_REVIEW_STATUSES)[number]

export const APPRENTICE_REVIEW_STATUS_EMOJI: Record<ApprenticeReviewStatus, string> = {
  'Cumpri totalmente': '🟢',
  'Cumpri parcialmente': '🟡',
  'Não cumpri': '🔴',
}

// ---- Encontro ----

export const APPRENTICE_MEETING_STATUSES = ['CONCLUIDO', 'PROXIMO', 'FUTURO'] as const
export type ApprenticeMeetingStatus = (typeof APPRENTICE_MEETING_STATUSES)[number]

export const APPRENTICE_MEETING_STATUS_LABELS: Record<ApprenticeMeetingStatus, string> = {
  CONCLUIDO: 'Concluído',
  PROXIMO: 'Próximo',
  FUTURO: 'Futuro',
}

export const APPRENTICE_LOCKED_MESSAGE =
  'Este conteúdo será liberado após a realização do encontro anterior e autorização do facilitador.'

// ---- Pesquisa ----

export const APPRENTICE_SURVEY_LEARNED = ['SIM', 'EM_PARTE', 'NAO'] as const
export type ApprenticeSurveyLearned = (typeof APPRENTICE_SURVEY_LEARNED)[number]

export const APPRENTICE_SURVEY_LEARNED_LABELS: Record<ApprenticeSurveyLearned, string> = {
  SIM: 'Sim',
  EM_PARTE: 'Em parte',
  NAO: 'Não',
}

export const APPRENTICE_SURVEY_MIN_SCORE = 0
export const APPRENTICE_SURVEY_MAX_SCORE = 10

// ---- DTOs ----

export interface ApprenticeClassDTO {
  id: string
  name: string
  shift: string | null
  active: boolean
  /** Quantos aprendizes matriculados. */
  memberCount: number
}

export interface ApprenticePersonDTO {
  id: string
  name: string
  photoUrl: string | null
  classId: string | null
  className: string | null
}

export interface ApprenticeMaterialDTO {
  id: string
  name: string
  /** Link externo, quando o material é um link. */
  url: string | null
  /**
   * URL assinada e temporária do arquivo no S3, quando o material é upload.
   * A chave nunca sai do servidor — como o comprovante de treinamento.
   */
  downloadUrl: string | null
  fileName: string | null
  sizeBytes: number | null
}

export interface ApprenticeActivityDTO {
  id: string
  meetingId: string
  order: number
  kind: ApprenticeActivityKind
  title: string
  schema: ApprenticeActivitySchema
}

export interface ApprenticeSubmissionDTO {
  id: string
  activityId: string
  userId: string
  values: ApprenticeValues
  /** Nulo enquanto é rascunho. */
  submittedAt: string | null
  draftSavedAt: string | null
}

export interface ApprenticeMeetingDTO {
  id: string
  order: number
  title: string
  theme: string
  objectives: string[]
  deliverable: string
  /** Data civil YYYY-MM-DD; nula enquanto o encontro não tem data marcada. */
  scheduledOn: string | null
  status: ApprenticeMeetingStatus
  accessReleased: boolean
  surveyOpen: boolean
  slideUrl: string | null
}

/** O encontro como o aprendiz o vê na trilha: com a trava e o próprio progresso. */
export interface ApprenticeTrackMeetingDTO extends ApprenticeMeetingDTO {
  unlocked: boolean
  activityCount: number
  submittedCount: number
  surveyAnswered: boolean
  /** Todas as fichas enviadas E a pesquisa respondida. É o que move a linha do tempo. */
  completed: boolean
}

export interface ApprenticeMakeupDTO {
  id: string
  meetingId: string
  meetingOrder: number
  /** Instante da reposição (data + hora). */
  scheduledAt: string
  attendees: ApprenticePersonDTO[]
}

export interface ApprenticeTrackDTO {
  /** Quem está olhando: aprendiz matriculado, facilitador, ou os dois. */
  viewer: {
    userId: string
    isApprentice: boolean
    isFacilitator: boolean
    classId: string | null
    className: string | null
  }
  meetings: ApprenticeTrackMeetingDTO[]
  /** Reposições agendadas para quem está olhando (vazio para o facilitador). */
  makeups: ApprenticeMakeupDTO[]
  contractSigned: boolean
}

export interface ApprenticeMeetingDetailDTO {
  meeting: ApprenticeTrackMeetingDTO
  /**
   * Apresentação enviada como arquivo, em URL assinada e temporária. Fica só
   * aqui e não no `ApprenticeMeetingDTO`: assinar uma URL por encontro na lista
   * da trilha seriam seis chamadas ao S3 para um link que ninguém clicou.
   */
  slideDownloadUrl: string | null
  materials: ApprenticeMaterialDTO[]
  activities: ApprenticeActivityDTO[]
  /** Submissões de quem está olhando, indexadas por `activityId`. */
  submissions: ApprenticeSubmissionDTO[]
  /**
   * O que a pessoa escreveu no Compromisso do Mês do encontro anterior — é o que
   * a ficha de revisão mostra no topo. Nulo quando não houve compromisso.
   */
  previousCommitment: string | null
  /** Situação de entrega de cada aprendiz neste encontro (o Mural do Encontro). */
  wall: ApprenticeWallEntryDTO[]
  surveyOpen: boolean
  surveyAnswered: boolean
}

export const APPRENTICE_DELIVERY_STATUSES = ['ENTREGUE', 'PENDENTE', 'NAO_ENTREGUE'] as const
export type ApprenticeDeliveryStatus = (typeof APPRENTICE_DELIVERY_STATUSES)[number]

export const APPRENTICE_DELIVERY_STATUS_LABELS: Record<ApprenticeDeliveryStatus, string> = {
  ENTREGUE: 'Entregue',
  PENDENTE: 'Pendente',
  NAO_ENTREGUE: 'Não entregue',
}

/**
 * Uma célula do mural: o que uma pessoa entregou num encontro. Nunca carrega o
 * TEXTO da ficha — no mural entra o status, não o que foi escrito.
 */
export interface ApprenticeWallEntryDTO {
  meetingId: string
  meetingOrder: number
  meetingTitle: string
  deliverable: string
  person: ApprenticePersonDTO
  status: ApprenticeDeliveryStatus
  submittedCount: number
  activityCount: number
  /** Instante do último envio, ou null quando nada foi entregue. */
  lastSubmittedAt: string | null
}

export interface ApprenticeWallDTO {
  entries: ApprenticeWallEntryDTO[]
  classes: ApprenticeClassDTO[]
  meetings: ApprenticeMeetingDTO[]
}

export interface ApprenticeContractDTO {
  clauses: string[]
  updatedAt: string | null
  signatures: { person: ApprenticePersonDTO; signedAt: string }[]
  /** Se quem está olhando já assinou. */
  signedByViewer: boolean
}

/**
 * Uma linha da visão de turma do portfólio: quanto a pessoa já entregou, sem o
 * conteúdo das fichas. O que ela escreveu é dela e do facilitador, e continua
 * só no portfólio individual — aqui o facilitador vê situação, não texto, como
 * no mural.
 */
export interface ApprenticePortfolioPersonDTO {
  person: ApprenticePersonDTO
  /** Encontros concluídos (fichas enviadas e pesquisa respondida). */
  completedMeetings: number
  /** Fichas enviadas e fichas esperadas em toda a trilha. */
  submittedCount: number
  activityCount: number
  /** Um item por encontro, na ordem da trilha. */
  meetings: { id: string; order: number; completed: boolean }[]
}

/**
 * O portfólio da turma — o que o facilitador abre por padrão, já que ele não é
 * aprendiz e não tem portfólio próprio.
 */
export interface ApprenticePortfolioOverviewDTO {
  people: ApprenticePortfolioPersonDTO[]
  totalMeetings: number
  /** Entregas de toda a turma: soma das fichas enviadas e das esperadas. */
  submittedCount: number
  activityCount: number
}

export interface ApprenticePortfolioMeetingDTO {
  meeting: ApprenticeTrackMeetingDTO
  activities: ApprenticeActivityDTO[]
  submissions: ApprenticeSubmissionDTO[]
}

export interface ApprenticePortfolioDTO {
  person: ApprenticePersonDTO
  meetings: ApprenticePortfolioMeetingDTO[]
  completedMeetings: number
  totalMeetings: number
}

export interface ApprenticeAttendanceDTO {
  meetingId: string
  person: ApprenticePersonDTO
  /** `null` = chamada ainda não lançada para esta pessoa. */
  present: boolean | null
  justification: string | null
  needsMakeup: boolean
}

export const APPRENTICE_JUSTIFICATIONS = [
  'Atestado médico',
  'Compromisso no setor',
  'Falta não informada',
  'Outro motivo',
] as const

export interface ApprenticeSurveyResultDTO {
  meetingId: string | null
  total: number
  averageScore: number | null
  nps: number | null
  promoters: number
  neutrals: number
  detractors: number
  learned: Record<ApprenticeSurveyLearned, number>
  takeaways: string[]
  improvements: string[]
}

export interface ApprenticeOverviewDTO {
  survey: ApprenticeSurveyResultDTO
  attendance: {
    called: number
    present: number
    absences: number
    justifiedAbsences: number
    rate: number | null
  }
  activities: {
    submitted: number
    expected: number
    rate: number | null
  }
  commitments: {
    reviews: number
    fulfilled: number
    partial: number
    unfulfilled: number
    rate: number | null
  }
}

// ---- Funções puras ----

/** Quem tem acesso à área por cargo. */
export function isApprentice(user: { positionCategory?: string | null } | null | undefined): boolean {
  return user?.positionCategory === APPRENTICE_POSITION_CATEGORY
}

/**
 * Status por DATA, e não por campo editável: um status à mão ao lado de uma data
 * é um status que alguém esquece de mudar. Concluído é o que já passou; Próximo é
 * o primeiro que não passou; o resto é Futuro.
 */
export function meetingStatusesOf(
  meetings: { id: string; order: number; scheduledOn: string | null }[],
  today: string,
): Record<string, ApprenticeMeetingStatus> {
  const sorted = [...meetings].sort((a, b) => a.order - b.order)
  const statuses: Record<string, ApprenticeMeetingStatus> = {}
  let nextFound = false
  for (const meeting of sorted) {
    const past = meeting.scheduledOn !== null && meeting.scheduledOn < today
    if (past) {
      statuses[meeting.id] = 'CONCLUIDO'
      continue
    }
    statuses[meeting.id] = nextFound ? 'FUTURO' : 'PROXIMO'
    nextFound = true
  }
  return statuses
}

/**
 * O encontro está aberto para este aprendiz?
 *
 * Diferente do protótipo: chamada **não lançada** não bloqueia. Lá, quem ainda
 * não tinha presença registrada ficava travado, o que transformava um
 * esquecimento do facilitador em turma inteira parada. O portão só morde depois
 * que a chamada aconteceu — e quem faltou volta a passar quando o facilitador
 * corrige a chamada depois da reposição.
 */
export function isMeetingUnlocked(input: {
  accessReleased: boolean
  order: number
  isFacilitator: boolean
  /** Presença no encontro de ordem imediatamente anterior. `null` = não lançada. */
  previousAttendance: boolean | null
}): boolean {
  if (input.isFacilitator) return true
  if (!input.accessReleased) return false
  if (input.order <= 1) return true
  return input.previousAttendance !== false
}

/** Percorre o schema devolvendo todos os campos, inclusive os de dentro de uma `lista`. */
export function apprenticeSchemaFields(schema: ApprenticeActivitySchema): ApprenticeField[] {
  return (schema.blocks ?? []).flatMap((block) => block.fields ?? [])
}

function isFilled(value: ApprenticeFieldValue | undefined, field: ApprenticeField): boolean {
  if (field.type === 'checkbox') return value === true
  if (field.type === 'lista') {
    const items = Array.isArray(value) ? value : []
    const sub = field.fields ?? []
    return items.some((item) => sub.some((child) => String(item[child.id] ?? '').trim() !== ''))
  }
  return typeof value === 'string' && value.trim() !== ''
}

/**
 * Pode enviar? Rascunho salva sempre; o envio exige os campos marcados
 * `required`. Schema sem nenhum campo obrigatório pede pelo menos um preenchido —
 * senão "enviar" viraria um botão que grava ficha em branco.
 */
export function canSubmitApprenticeActivity(
  schema: ApprenticeActivitySchema,
  values: ApprenticeValues,
): boolean {
  const fields = apprenticeSchemaFields(schema)
  if (fields.length === 0) return true
  const required = fields.filter((field) => field.required)
  if (required.length > 0) return required.every((field) => isFilled(values[field.id], field))
  return fields.some((field) => isFilled(values[field.id], field))
}

/** Situação de entrega de uma pessoa num encontro, para o mural. */
export function deliveryStatusOf(input: {
  submittedCount: number
  activityCount: number
  /** O encontro seguinte já foi liberado? Se foi, o que não veio não vem mais. */
  nextMeetingReleased: boolean
}): ApprenticeDeliveryStatus {
  if (input.activityCount > 0 && input.submittedCount >= input.activityCount) return 'ENTREGUE'
  return input.nextMeetingReleased ? 'NAO_ENTREGUE' : 'PENDENTE'
}

/** NPS da pesquisa: promotores (9–10) menos detratores (0–6), em pontos percentuais. */
export function apprenticeNps(scores: number[]): number | null {
  if (scores.length === 0) return null
  const promoters = scores.filter((score) => score >= 9).length
  const detractors = scores.filter((score) => score <= 6).length
  return Math.round((promoters / scores.length) * 100 - (detractors / scores.length) * 100)
}

/**
 * Lê um schema vindo do banco (coluna `Json`) sem confiar no formato. Um schema
 * corrompido vira ficha vazia em vez de derrubar a tela inteira.
 */
export function asApprenticeSchema(value: unknown): ApprenticeActivitySchema {
  if (!value || typeof value !== 'object') return { blocks: [] }
  const raw = value as Partial<ApprenticeActivitySchema>
  if (!Array.isArray(raw.blocks)) return { blocks: [] }
  return {
    ...(raw.eyebrow ? { eyebrow: raw.eyebrow } : {}),
    ...(raw.subtitle ? { subtitle: raw.subtitle } : {}),
    ...(raw.footer ? { footer: raw.footer } : {}),
    blocks: raw.blocks.filter((block): block is ApprenticeBlock => Boolean(block && typeof block.title === 'string')),
  }
}

/** Lê os valores de uma submissão vindos do banco sem confiar no formato. */
export function asApprenticeValues(value: unknown): ApprenticeValues {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: ApprenticeValues = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string' || typeof raw === 'boolean') {
      out[key] = raw
    } else if (Array.isArray(raw)) {
      out[key] = raw
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
        .map((item) => {
          const cleaned: ApprenticeListItem = {}
          for (const [field, fieldValue] of Object.entries(item)) {
            if (typeof fieldValue === 'string') cleaned[field] = fieldValue
          }
          return cleaned
        })
    }
  }
  return out
}

// ============================================================================
// Fase 2 — jornada, movimentações de setor e quadro de gestão
// ============================================================================

/**
 * Etapas do contrato de aprendizagem, derivadas da ADMISSÃO — não são campo.
 * Um ciclo de 24 meses em quatro blocos de seis.
 */
export const APPRENTICE_JOURNEY_STAGES = [
  '1º Ciclo — Onboarding e Integração',
  '2º Ciclo — Consolidação I',
  '3º Ciclo — Consolidação II',
  '4º Ciclo — Transição e Encerramento',
] as const
export type ApprenticeJourneyStage = (typeof APPRENTICE_JOURNEY_STAGES)[number]

/**
 * Permanência mínima no setor antes de uma troca. Constante, e não
 * `AppSetting`: é regra do desenho do programa, e hoje uma empresa só o usa.
 * Se um segundo cliente pedir outro número, promova para `AppSetting` como o
 * `training_sla_days` — o cálculo já recebe o valor por parâmetro.
 */
export const APPRENTICE_MIN_MONTHS_IN_SECTOR = 6

/** Janela em que o fim do contrato vira alerta no painel. */
export const APPRENTICE_CONTRACT_WARNING_DAYS = 90

export const APPRENTICE_TASK_COLUMNS = ['AFAZER', 'ANDAMENTO', 'VALIDACAO', 'CONCLUIDO'] as const
export type ApprenticeTaskColumn = (typeof APPRENTICE_TASK_COLUMNS)[number]

export const APPRENTICE_TASK_COLUMN_LABELS: Record<ApprenticeTaskColumn, string> = {
  AFAZER: 'A fazer / Planejamento',
  ANDAMENTO: 'Em andamento',
  VALIDACAO: 'Em validação / Alinhamento',
  CONCLUIDO: 'Concluído',
}

export const APPRENTICE_TASK_CATEGORIES = [
  'Logística',
  'Alinhamento com Gestor',
  'Conteúdo',
  'Feedback',
  'Outros',
] as const
export type ApprenticeTaskCategory = (typeof APPRENTICE_TASK_CATEGORIES)[number]

export const APPRENTICE_TASK_TITLE_MAX_LENGTH = 200
export const APPRENTICE_TASK_MAX_ITEMS = 30

// ---- DTOs ----

export interface ApprenticeSectorMoveDTO {
  id: string
  userId: string
  fromSector: string
  toSector: string
  movedOn: string
  reason: string
  responsibles: string
}

export interface ApprenticeJourneyDTO {
  person: ApprenticePersonDTO
  /** Vem do cadastro do colaborador, não daqui. */
  sectorName: string | null
  squad: string | null
  leaderName: string | null
  /** `User.joinedAt` como data civil. */
  joinedOn: string | null
  /** Fim previsto do contrato — este sim é do módulo. */
  contractEndsOn: string | null
  activities: string
  notes: string | null
  stage: ApprenticeJourneyStage | null
  monthsSinceJoined: number | null
  /** Dias até o fim do contrato; negativo = já encerrou. */
  daysToContractEnd: number | null
  eligibleForSectorChange: boolean
  monthsInCurrentSector: number | null
  /** Data a partir da qual a permanência é contada (última mudança, ou admissão). */
  inSectorSince: string | null
  moves: ApprenticeSectorMoveDTO[]
}

export interface ApprenticeTaskItemDTO {
  id: string
  text: string
  done: boolean
}

export interface ApprenticeTaskDTO {
  id: string
  title: string
  category: string
  meetingId: string | null
  meetingOrder: number | null
  dueOn: string | null
  boardColumn: ApprenticeTaskColumn
  sortOrder: number
  items: ApprenticeTaskItemDTO[]
  /** Derivado do prazo: pendente com prazo vencido. */
  overdue: boolean
}

// ---- Funções puras ----

/** Meses completos entre uma data civil e hoje. Null quando a data é inválida. */
export function monthsSince(ymd: string | null, today: string): number | null {
  if (!ymd) return null
  const [fromYear, fromMonth, fromDay] = ymd.split('-').map(Number)
  const [toYear, toMonth, toDay] = today.split('-').map(Number)
  if (!fromYear || !fromMonth || !fromDay || !toYear || !toMonth || !toDay) return null
  let months = (toYear - fromYear) * 12 + (toMonth - fromMonth)
  if (toDay < fromDay) months -= 1
  return months < 0 ? 0 : months
}

/** Etapa da jornada calculada pela data de admissão. */
export function apprenticeStageOf(joinedOn: string | null, today: string): ApprenticeJourneyStage | null {
  const months = monthsSince(joinedOn, today)
  if (months === null) return null
  if (months < 6) return APPRENTICE_JOURNEY_STAGES[0]
  if (months < 12) return APPRENTICE_JOURNEY_STAGES[1]
  if (months < 18) return APPRENTICE_JOURNEY_STAGES[2]
  return APPRENTICE_JOURNEY_STAGES[3]
}

/**
 * Elegibilidade de troca de setor. Conta da ÚLTIMA MUDANÇA, não da admissão —
 * sem o histórico, quem trocou de setor no mês passado pareceria elegível por
 * já estar há um ano na empresa.
 */
export function sectorChangeEligibility(input: {
  joinedOn: string | null
  lastMoveOn: string | null
  today: string
  minMonths?: number
}): { eligible: boolean; months: number | null; since: string | null } {
  const since = input.lastMoveOn ?? input.joinedOn
  const months = monthsSince(since, input.today)
  const minMonths = input.minMonths ?? APPRENTICE_MIN_MONTHS_IN_SECTOR
  return { eligible: months !== null && months >= minMonths, months, since }
}

/** Dias entre hoje e uma data civil. Negativo = já passou. */
export function daysUntil(ymd: string | null, today: string): number | null {
  if (!ymd) return null
  const target = Date.parse(`${ymd}T00:00:00.000Z`)
  const now = Date.parse(`${today}T00:00:00.000Z`)
  if (Number.isNaN(target) || Number.isNaN(now)) return null
  return Math.round((target - now) / 86_400_000)
}

/** Tempo de casa por extenso, a partir da admissão. */
export function apprenticeTenureLabel(joinedOn: string | null, today: string): string {
  const months = monthsSince(joinedOn, today)
  if (months === null) return '—'
  const years = Math.floor(months / 12)
  const rest = months % 12
  if (years === 0) return `${rest} ${rest === 1 ? 'mês' : 'meses'}`
  const yearLabel = `${years} ${years === 1 ? 'ano' : 'anos'}`
  return rest === 0 ? yearLabel : `${yearLabel} e ${rest} ${rest === 1 ? 'mês' : 'meses'}`
}

/** Tarefa pendente com prazo vencido. Concluída nunca está atrasada. */
export function isApprenticeTaskOverdue(
  task: { dueOn: string | null; boardColumn: ApprenticeTaskColumn },
  today: string,
): boolean {
  if (task.boardColumn === 'CONCLUIDO' || !task.dueOn) return false
  return task.dueOn < today
}

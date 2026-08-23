/**
 * Contrato do Meu PDI (Plano de Desenvolvimento Individual).
 *
 * O plano é da pessoa: ela monta as ações do ciclo, acompanha o progresso e
 * conclui cada ação com evidência e reflexão. O líder do plano valida.
 */

export const PDI_PLAN_STATUSES = ['DRAFT', 'IN_PROGRESS', 'DONE', 'ARCHIVED'] as const
export type PdiPlanStatus = (typeof PDI_PLAN_STATUSES)[number]

export const PDI_PLAN_STATUS_LABELS: Record<PdiPlanStatus, string> = {
  DRAFT: 'Rascunho',
  IN_PROGRESS: 'Em andamento',
  DONE: 'Concluído',
  ARCHIVED: 'Arquivado',
}

export const PDI_ACTION_STATUSES = ['NOT_STARTED', 'IN_PROGRESS', 'AWAITING_REVIEW', 'DONE'] as const
export type PdiActionStatus = (typeof PDI_ACTION_STATUSES)[number]

export const PDI_ACTION_STATUS_LABELS: Record<PdiActionStatus, string> = {
  NOT_STARTED: 'Não iniciado',
  IN_PROGRESS: 'Em andamento',
  AWAITING_REVIEW: 'Aguardando validação',
  DONE: 'Concluído',
}

export const PDI_ACTION_TYPES = ['COURSE', 'BOOK', 'MENTORING', 'PRACTICE', 'OTHER'] as const
export type PdiActionType = (typeof PDI_ACTION_TYPES)[number]

export const PDI_ACTION_TYPE_LABELS: Record<PdiActionType, string> = {
  COURSE: 'Curso',
  BOOK: 'Livro',
  MENTORING: 'Mentoria',
  PRACTICE: 'Desafio prático',
  OTHER: 'Outros',
}

/** Ícone (Material Symbols) de cada tipo de ação — usado no card e na fila do líder. */
export const PDI_ACTION_TYPE_ICONS: Record<PdiActionType, string> = {
  COURSE: 'school',
  BOOK: 'menu_book',
  MENTORING: 'groups',
  PRACTICE: 'trophy',
  OTHER: 'auto_awesome',
}

export const PDI_ACTION_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH'] as const
export type PdiActionPriority = (typeof PDI_ACTION_PRIORITIES)[number]

export const PDI_ACTION_PRIORITY_LABELS: Record<PdiActionPriority, string> = {
  LOW: 'Baixa',
  MEDIUM: 'Média',
  HIGH: 'Alta',
}

export const PDI_SHOWCASE_VISIBILITIES = ['ALL', 'TEAM', 'LEADER', 'PRIVATE'] as const
export type PdiShowcaseVisibility = (typeof PDI_SHOWCASE_VISIBILITIES)[number]

export const PDI_SHOWCASE_VISIBILITY_LABELS: Record<PdiShowcaseVisibility, string> = {
  ALL: 'Toda a empresa',
  TEAM: 'Meu setor',
  LEADER: 'Só meu líder',
  PRIVATE: 'Só eu',
}

export const PDI_EVIDENCE_KINDS = ['COMPLETION', 'APPLICATION'] as const
export type PdiEvidenceKind = (typeof PDI_EVIDENCE_KINDS)[number]

export const PDI_EVIDENCE_KIND_LABELS: Record<PdiEvidenceKind, string> = {
  COMPLETION: 'Comprovante da conclusão',
  APPLICATION: 'Evidência da aplicação',
}

export const PDI_ACTION_EVENT_TYPES = [
  'CREATED',
  'PROGRESS_UPDATED',
  'SUBMITTED_FOR_REVIEW',
  'APPROVED',
  'CHANGES_REQUESTED',
  'COMPLETED',
] as const
export type PdiActionEventType = (typeof PDI_ACTION_EVENT_TYPES)[number]

export const PDI_ACTION_EVENT_LABELS: Record<PdiActionEventType, string> = {
  CREATED: 'Ação criada',
  PROGRESS_UPDATED: 'Progresso atualizado',
  SUBMITTED_FOR_REVIEW: 'Enviada para validação',
  APPROVED: 'Aprovada pelo líder',
  CHANGES_REQUESTED: 'Ajustes solicitados',
  COMPLETED: 'Ação concluída',
}

/** Perguntas da reflexão guiada da conclusão. Só a primeira é obrigatória. */
export const PDI_REFLECTION_FIELDS = [
  { key: 'mainLearning', label: 'Qual foi o principal aprendizado desta ação?', emoji: '🎯', required: true },
  { key: 'challenge', label: 'O que foi mais desafiador?', emoji: '🧗', required: false },
  { key: 'contribution', label: 'Como esse conhecimento contribuirá para sua atuação?', emoji: '💼', required: false },
  { key: 'nextTime', label: 'O que você faria diferente na próxima vez?', emoji: '🔁', required: false },
] as const

export type PdiReflectionKey = (typeof PDI_REFLECTION_FIELDS)[number]['key']
export type PdiReflection = Partial<Record<PdiReflectionKey, string>>

export const PDI_PLAN_TITLE_MAX_LENGTH = 120
export const PDI_ACTION_DESCRIPTION_MAX_LENGTH = 400
export const PDI_ACTION_NOTES_MAX_LENGTH = 2000
export const PDI_COMPETENCY_MAX_LENGTH = 80
export const MIN_PDI_REFLECTION_LENGTH = 5
export const MAX_PDI_REFLECTION_LENGTH = 1000
export const MIN_PDI_PRACTICAL_APPLICATION_LENGTH = 10
export const MAX_PDI_PRACTICAL_APPLICATION_LENGTH = 2000
export const MAX_PDI_EVIDENCES_PER_ACTION = 10
export const MAX_PDI_CHECKLIST_ITEMS = 20
export const PDI_REVIEW_COMMENT_MAX_LENGTH = 1000

/** Tipos aceitos como evidência: comprovante em imagem ou PDF. */
export const PDI_EVIDENCE_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const
export type PdiEvidenceContentType = (typeof PDI_EVIDENCE_CONTENT_TYPES)[number]
export const PDI_EVIDENCE_MAX_BYTES = 20 * 1024 * 1024

export function isPdiEvidenceContentType(value: string): value is PdiEvidenceContentType {
  return (PDI_EVIDENCE_CONTENT_TYPES as readonly string[]).includes(value)
}

/** Extensão do arquivo por content-type (usada pra montar a chave no storage). */
export const PDI_EVIDENCE_EXTENSIONS: Record<PdiEvidenceContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
}

export interface PdiEvidenceUploadConfig {
  enabled: boolean
  maxBytes: number
  allowedContentTypes: PdiEvidenceContentType[]
}

export interface PdiEvidencePresignResponse {
  uploadUrl: string
  key: string
}

export interface PdiChecklistItem {
  id: string
  text: string
  done: boolean
}

export interface PdiPersonDTO {
  id: string
  name: string
  photoUrl: string | null
  position: string | null
}

export interface PdiActionEvidenceDTO {
  id: string
  kind: PdiEvidenceKind
  fileName: string | null
  mimeType: string | null
  externalUrl: string | null
  /** URL assinada de download; `null` para evidência que é só link externo. */
  downloadUrl: string | null
  createdAt: string
}

export interface PdiActionHistoryEntryDTO {
  id: string
  eventType: PdiActionEventType
  actor: PdiPersonDTO | null
  metadata: Record<string, unknown>
  createdAt: string
}

export interface PdiActionDTO {
  id: string
  planId: string
  description: string
  type: PdiActionType
  priority: PdiActionPriority
  status: PdiActionStatus
  dueDate: string | null
  progressPct: number
  competency: string | null
  notes: string | null
  checklist: PdiChecklistItem[]
  reflection: PdiReflection | null
  practicalApplication: string | null
  submittedForReviewAt: string | null
  reviewedAt: string | null
  reviewedBy: PdiPersonDTO | null
  reviewComment: string | null
  completedAt: string | null
  evidences: PdiActionEvidenceDTO[]
  createdAt: string
  updatedAt: string
}

export interface PdiPlanDTO {
  id: string
  title: string
  status: PdiPlanStatus
  cyclePeriod: string | null
  startsAt: string | null
  endsAt: string | null
  owner: PdiPersonDTO
  leader: PdiPersonDTO | null
  actions: PdiActionDTO[]
  /** Média do progresso das ações do plano (0–100). */
  progressPct: number
  createdAt: string
}

export interface PdiCycleDTO {
  cyclePeriod: string
  plans: number
  actions: number
  doneActions: number
  progressPct: number
}

export interface PdiDashboardDTO {
  plans: number
  actions: number
  doneActions: number
  awaitingReview: number
  overdue: number
  progressPct: number
  byType: { type: PdiActionType; total: number; done: number }[]
  competencies: { competency: string; total: number }[]
}

export interface PdiShowcaseDTO {
  user: PdiPersonDTO
  visibility: PdiShowcaseVisibility
  /** `false` quando a visibilidade escolhida esconde a vitrine de quem está olhando. */
  visible: boolean
  competencies: string[]
  actions: {
    id: string
    description: string
    type: PdiActionType
    competency: string | null
    completedAt: string
  }[]
}

export interface PdiReviewQueueItemDTO {
  action: PdiActionDTO
  /** `progressPct` é o do plano inteiro, não só das ações na fila: a lista do
   *  líder mostra o quanto falta do ciclo de cada liderado. */
  plan: { id: string; title: string; cyclePeriod: string | null; progressPct: number }
  owner: PdiPersonDTO
}

export interface PdiSettingsDTO {
  leaderApprovalRequired: boolean
}

export interface DevelopmentSettingsDTO {
  leaderApprovalRequired: boolean
  /** Link externo de Avaliações e Pesquisas (ImpulseUP); `null` esconde o item do menu. */
  impulseUpUrl: string | null
  /**
   * Link externo da Comunidade INOVA; `null` esconde o item do menu.
   *
   * Config por empresa, como o ImpulseUP, e não item fixo: a comunidade é de um
   * cliente, e num produto white label cravar o destino de um tenant no código
   * o entregaria para todos os outros.
   */
  inovaCommunityUrl: string | null
}

export interface PdiLeadersResponse {
  /** Vazia para quem está no topo da hierarquia (Head). */
  leaders: PdiPersonDTO[]
}

export interface PdiPlanListResponse {
  plans: PdiPlanDTO[]
  settings: PdiSettingsDTO
  visibility: PdiShowcaseVisibility
}

export interface PdiPlanResponse {
  plan: PdiPlanDTO
}

export interface PdiActionResponse {
  action: PdiActionDTO
}

export interface CreatePdiPlanRequest {
  title: string
  leaderId?: string | null
  cyclePeriod?: string | null
  startsAt?: string | null
  endsAt?: string | null
  status?: PdiPlanStatus
}

export type UpdatePdiPlanRequest = Partial<CreatePdiPlanRequest>

export interface CreatePdiActionRequest {
  description: string
  type: PdiActionType
  priority: PdiActionPriority
  dueDate?: string | null
  competency?: string | null
  notes?: string | null
  checklist?: PdiChecklistItem[]
}

export interface UpdatePdiActionRequest extends Partial<CreatePdiActionRequest> {
  progressPct?: number
  status?: Extract<PdiActionStatus, 'NOT_STARTED' | 'IN_PROGRESS'>
}

export interface PdiEvidenceInput {
  kind: PdiEvidenceKind
  storageKey?: string | null
  fileName?: string | null
  mimeType?: string | null
  externalUrl?: string | null
}

export interface CompletePdiActionRequest {
  practicalApplication: string
  reflection: PdiReflection
  evidences: PdiEvidenceInput[]
}

export interface CompletePdiActionResponse {
  action: PdiActionDTO
  /** `true` quando a ação foi para a fila do líder em vez de concluir direto. */
  awaitingReview: boolean
}

export const PDI_REVIEW_DECISIONS = ['APPROVE', 'REQUEST_CHANGES'] as const
export type PdiReviewDecision = (typeof PDI_REVIEW_DECISIONS)[number]

export interface ReviewPdiActionRequest {
  decision: PdiReviewDecision
  comment?: string | null
}

export interface PdiReviewQueueResponse {
  items: PdiReviewQueueItemDTO[]
}

export interface PdiHistoryResponse {
  entries: PdiActionHistoryEntryDTO[]
}

export interface PdiDashboardResponse {
  dashboard: PdiDashboardDTO
  cycles: PdiCycleDTO[]
}

export interface PdiShowcaseResponse {
  showcase: PdiShowcaseDTO
}

export interface UpdatePdiVisibilityRequest {
  visibility: PdiShowcaseVisibility
}

/** Progresso médio de um conjunto de ações (0–100, inteiro). */
export function pdiProgressOf(actions: { progressPct: number; status: PdiActionStatus }[]): number {
  if (actions.length === 0) return 0
  const total = actions.reduce((sum, action) => sum + (action.status === 'DONE' ? 100 : action.progressPct), 0)
  return Math.round(total / actions.length)
}

/** A reflexão está completa? (só a primeira pergunta é obrigatória) */
export function isPdiReflectionComplete(reflection: PdiReflection): boolean {
  return PDI_REFLECTION_FIELDS.every(
    (field) => !field.required || (reflection[field.key]?.trim().length ?? 0) >= MIN_PDI_REFLECTION_LENGTH,
  )
}

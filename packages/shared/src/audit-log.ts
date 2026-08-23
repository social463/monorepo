export const ADMIN_AUDIT_ACTIONS = ['CREATE', 'UPDATE', 'DELETE'] as const
export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[number]

export const ADMIN_AUDIT_ACTION_LABELS: Record<AdminAuditAction, string> = {
  CREATE: 'Criou',
  UPDATE: 'Editou',
  DELETE: 'Excluiu',
}

export interface AuditLogActorRef {
  id: string
  name: string
}

export interface AuditLogEntryDTO {
  id: string
  actor: AuditLogActorRef
  entityType: string
  entityId: string
  action: AdminAuditAction
  before: unknown
  after: unknown
  createdAt: string
}

export interface AuditLogListResponse {
  entries: AuditLogEntryDTO[]
  total: number
  page: number
  pageSize: number
}

// Autores distintos que já aparecem no log de auditoria (não "todos os admins" —
// só quem de fato praticou uma ação auditada), usado para popular o filtro por autor.
export interface AuditLogActorsResponse {
  actors: AuditLogActorRef[]
}

/**
 * Nome em pt-BR de cada entidade auditada. O log grava `entityType` como o nome
 * do model do Prisma, que é o identificador certo para filtrar e errado para
 * ler: "OfficeMapPublication" não diz nada a quem audita.
 *
 * Tipo novo sem entrada aqui cai no próprio nome do model — degrada, não quebra.
 * A lista sai de `grep "entityType: '...'"` na api.
 */
export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  AiSettings: 'Configuração de IA',
  AppSetting: 'Configuração da plataforma',
  Badge: 'Selo',
  BenchmarkPractice: 'Prática de benchmarking',
  Branding: 'Marca da empresa',
  CalendarEvent: 'Evento do calendário',
  CalendarEventType: 'Tipo de evento',
  CalendarSettings: 'Configuração do calendário',
  Campaign: 'Campanha',
  CampaignPost: 'Publicação de campanha',
  Category: 'Categoria',
  CertificateRequest: 'Pedido de certificado',
  CertificateTemplate: 'Modelo de certificado',
  Challenge: 'Desafio',
  ChallengeSubmission: 'Participação em desafio',
  CoinRule: 'Regra de coins',
  CoinTransaction: 'Transação de coins',
  Company: 'Empresa',
  CorporatePost: 'Publicação do feed',
  CorporatePostComment: 'Comentário do feed',
  Course: 'Curso',
  CourseQuestion: 'Questão de quiz',
  CourseQuiz: 'Quiz',
  CultureBenefit: 'Benefício',
  CultureManual: 'Manual',
  CulturePage: 'Página de cultura',
  EventAlbum: 'Álbum de evento',
  GlassReview: 'Avaliação externa',
  HrDashboard: 'Painel de RH',
  KnowledgeEntry: 'Base de conhecimento',
  OfficeDeskClaim: 'Reserva de mesa',
  OfficeGuestInvite: 'Convite de visitante',
  OfficeMap: 'Mapa do escritório',
  OfficeMapAsset: 'Asset de mapa',
  OfficeMapPublication: 'Publicação de mapa',
  OfficeRoom: 'Sala do escritório',
  OfficeSetting: 'Configuração do escritório',
  OneOnOneTopicTemplate: 'Modelo de tópico de 1:1',
  RetroRoom: 'Sala de retrospectiva',
  Sector: 'Setor',
  Squad: 'Squad',
  SquadMember: 'Membro de squad',
  StoreOrder: 'Pedido da loja',
  StoreProduct: 'Produto da loja',
  ThirdPartyInvite: 'Convite de terceirizado',
  User: 'Colaborador',
  UserBadge: 'Selo concedido',
  Vote: 'Voto',
  VotingPeriod: 'Período de votação',
  XpRule: 'Regra de XP',
}

/** Nome legível do tipo; o próprio `entityType` quando não há rótulo. */
export function auditEntityLabel(entityType: string): string {
  return AUDIT_ENTITY_LABELS[entityType] ?? entityType
}

/**
 * Como identificar o ALVO da ação.
 *
 * O log não guarda um rótulo do alvo — mas guarda o objeto inteiro em
 * `before`/`after`, e é de lá que o nome sai. Ler do payload (e não resolver
 * por join na hora de exibir) é a escolha certa para um log de auditoria por
 * dois motivos: mostra o nome **da época do evento**, que é o que aconteceu de
 * fato, e continua funcionando para entidade que já foi apagada.
 */
const SUBJECT_NAME_KEYS = ['name', 'title', 'label', 'question', 'email', 'slug', 'key', 'monthRef']

/** Nome do alvo da ação, tirado do payload; `null` quando não há nada legível. */
export function auditSubjectName(entry: Pick<AuditLogEntryDTO, 'before' | 'after'>): string | null {
  // `after` primeiro: numa edição, o estado final é o que a pessoa quis.
  for (const source of [entry.after, entry.before]) {
    if (typeof source !== 'object' || source === null) continue
    const obj = source as Record<string, unknown>
    for (const key of SUBJECT_NAME_KEYS) {
      const value = obj[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  }
  return null
}

/**
 * Campos que mudam sozinhos e não dizem nada sobre a intenção de quem editou.
 * Sem isso, toda edição listaria "atualizado em" junto do que importa.
 */
const NOISY_FIELDS = new Set(['updatedAt', 'createdAt', 'id'])

/** Rótulo dos campos mais auditados; os demais aparecem com o próprio nome. */
export const AUDIT_FIELD_LABELS: Record<string, string> = {
  active: 'ativo',
  adminAccess: 'acesso administrativo',
  area: 'área',
  birthDate: 'data de nascimento',
  description: 'descrição',
  email: 'e-mail',
  enabledFeatures: 'recursos habilitados',
  endsAt: 'fim',
  joinedAt: 'entrada na equipe',
  leftAt: 'saída',
  managerId: 'líder direto',
  name: 'nome',
  passwordHash: 'senha',
  photoUrl: 'foto',
  position: 'cargo',
  role: 'papel',
  sectorId: 'setor',
  squad: 'squad',
  startsAt: 'início',
  teamsWebhookUrl: 'webhook do Teams',
  title: 'título',
}

export function auditFieldLabel(field: string): string {
  return AUDIT_FIELD_LABELS[field] ?? field
}

/**
 * Campos que mudaram entre `before` e `after`, sem os ruidosos e já com
 * rótulo. Vazio quando não é uma edição de objeto (criação, exclusão).
 */
export function auditChangedFields(before: unknown, after: unknown): string[] {
  if (typeof before !== 'object' || before === null || typeof after !== 'object' || after === null) {
    return []
  }
  const beforeObj = before as Record<string, unknown>
  const afterObj = after as Record<string, unknown>
  return [...new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)])]
    .filter((key) => !NOISY_FIELDS.has(key))
    .filter((key) => JSON.stringify(beforeObj[key]) !== JSON.stringify(afterObj[key]))
    .sort()
}

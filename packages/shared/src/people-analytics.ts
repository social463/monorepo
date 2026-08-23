import type { MoodLevel } from './mood'

// Janela de análise da tela de People Analytics. Vale para TODOS os blocos da
// página ao mesmo tempo (visão geral e clima/engajamento).
export const PEOPLE_ANALYTICS_RANGES = ['7d', '30d', '90d'] as const

export type PeopleAnalyticsRange = (typeof PEOPLE_ANALYTICS_RANGES)[number]

export const PEOPLE_ANALYTICS_RANGE_DAYS: Record<PeopleAnalyticsRange, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
}

export const PEOPLE_ANALYTICS_RANGE_LABELS: Record<PeopleAnalyticsRange, string> = {
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  '90d': 'Últimos 90 dias',
}

// Tamanho máximo aceito no `path` de POST /access-logs. Guarda contra corpo
// gigante numa rota que qualquer usuário autenticado consegue chamar.
export const ACCESS_LOG_PATH_MAX_LENGTH = 512

/**
 * Um ponto da série diária de acessos. `day` é a data civil em
 * America/Sao_Paulo (YYYY-MM-DD); dias sem acesso aparecem zerados, para a
 * série nunca ter buraco.
 */
export interface AccessSeriesPointDTO {
  day: string
  accesses: number
  uniqueUsers: number
}

/** Fatia de uma distribuição (por papel, por squad, por humor). */
export interface DistributionSliceDTO {
  key: string
  label: string
  count: number
}

/**
 * Adesão do período de votação corrente do recorte. `eligible` são as lendas
 * ativas que podem votar; `voted`, quantas votaram. `rate` é percentual
 * arredondado (0–100). Null quando não há período aberto/ativo no recorte.
 */
export interface VotingAdoptionDTO {
  periodId: string
  monthRef: string
  eligible: number
  voted: number
  rate: number
}

/**
 * Uma célula do mapa de calor de atividade. `weekday` segue o padrão de
 * `Date.getDay()` (0 = domingo) e `hour` é a hora civil em São Paulo (0–23).
 * Só voltam células com pelo menos um acesso — a UI preenche o resto com zero.
 */
export interface AccessHeatmapCellDTO {
  weekday: number
  hour: number
  accesses: number
}

export const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'] as const

export interface PeopleOverviewDTO {
  range: PeopleAnalyticsRange
  /** Setor efetivamente aplicado (o do token, no caso do SUBADMIN). */
  sectorId: string | null
  /** Pessoas ativas no recorte — a base de todas as taxas. */
  activePeople: number
  uniqueUsers7d: number
  uniqueUsers30d: number
  /** Percentual de `activePeople` que acessou nos últimos 30 dias (0–100). */
  adoptionRate: number
  accessSeries: AccessSeriesPointDTO[]
  votingAdoption: VotingAdoptionDTO | null
  feedbacksCount: number
  feedbackReactionsCount: number
  byRole: DistributionSliceDTO[]
  bySquad: DistributionSliceDTO[]
  accessHeatmap: AccessHeatmapCellDTO[]
}

/**
 * Alcance de um post do Mural da empresa. Não há telemetria de visualização
 * por post — `engagedUsers` é quem comentou ou reagiu (distintos), e o número
 * de quem "viu" mora em `MuralReachDTO.uniqueViewers`, no nível da tela.
 */
export interface MuralPostReachDTO {
  postId: string
  authorName: string
  excerpt: string
  createdAt: string
  comments: number
  reactions: number
  engagedUsers: number
}

export interface MuralReachDTO {
  postCount: number
  /** Pessoas distintas que abriram a tela do Mural no período. */
  uniqueViewers: number
  posts: MuralPostReachDTO[]
}

export interface ScreenAccessDTO {
  path: string
  label: string
  accesses: number
  uniqueUsers: number
}

/**
 * Um dia da tendência de clima. `average` é null no dia em que ninguém
 * registrou humor — a linha deve *interromper* aí, não desenhar zero (zero
 * não existe na escala 1–5 e leria como "time péssimo").
 */
export interface EngagementMoodTrendPointDTO {
  day: string
  average: number | null
  entries: number
}

export interface MoodSummaryDTO {
  entries: number
  participants: number
  /** Média na escala 1 (HARD) a 5 (GREAT); null quando não há registro. */
  average: number | null
  distribution: DistributionSliceDTO[]
  trend: EngagementMoodTrendPointDTO[]
}

export interface EngagementOverviewDTO {
  range: PeopleAnalyticsRange
  sectorId: string | null
  mood: MoodSummaryDTO
  muralReach: MuralReachDTO
  topScreens: ScreenAccessDTO[]
}

export interface PeopleOverviewResponse {
  overview: PeopleOverviewDTO
}

export interface EngagementOverviewResponse {
  engagement: EngagementOverviewDTO
}

import type { MoodLevel } from './mood'

/**
 * Atalhos de período da tela de People Analytics. Valem para TODOS os blocos da
 * página ao mesmo tempo — o mapa de calor é a única exceção, e por escolha dele
 * (tem filtro próprio, ver `AccessHeatmapCard`).
 *
 * `custom` não está aqui: ele não tem número fixo de dias, é `from`/`to`.
 */
export const PEOPLE_ANALYTICS_RANGES = ['hoje', '7d', '30d', '90d', 'ano'] as const

export type PeopleAnalyticsRange = (typeof PEOPLE_ANALYTICS_RANGES)[number]

/**
 * Dias de cada atalho, hoje incluso. `ano` é "este ano" — do dia 1º de janeiro
 * até hoje —, então o número de dias muda conforme a data e é resolvido em
 * `resolveAnalyticsWindow`, não aqui.
 */
export const PEOPLE_ANALYTICS_RANGE_DAYS: Record<Exclude<PeopleAnalyticsRange, 'ano'>, number> = {
  hoje: 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
}

export const PEOPLE_ANALYTICS_RANGE_LABELS: Record<PeopleAnalyticsRange, string> = {
  hoje: 'Hoje',
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  '90d': 'Últimos 90 dias',
  ano: 'Este ano',
}

/**
 * O recorte de tempo pedido pela tela. `range: 'custom'` exige `from` e `to`
 * (datas civis `YYYY-MM-DD` em São Paulo); nos atalhos os dois são ignorados.
 *
 * Viaja na query string como `?range=custom&from=2026-06-01&to=2026-07-10`.
 */
export interface AnalyticsWindowRequest {
  range: PeopleAnalyticsRange | 'custom'
  from?: string
  to?: string
}

/**
 * Teto da janela personalizada, em dias.
 *
 * Não é limite de banco: `accessSeries` devolve **um ponto por dia** e o mapa de
 * calor varre a janela inteira. Sem teto, um `from` de 2020 monta uma resposta
 * de milhares de pontos que nenhum gráfico da tela desenha.
 */
export const ANALYTICS_WINDOW_MAX_DAYS = 366

/** `2026-06-01` → `01/06`. Corte de string: sem `Date`, sem fuso. */
function shortBr(ymd: string): string {
  const [, month, day] = ymd.split('-')
  return `${day}/${month}`
}

/**
 * O texto que acompanha os cards — é ele que torna a legenda **dinâmica**, em
 * vez do "Únicos em 7 dias" cravado na tela que a G&G apontou (seção 4.1).
 *
 * `days` é o tamanho da janela já resolvida: quem chama é a tela, que recebeu o
 * recorte efetivo do servidor, e não recalcula data nenhuma.
 */
export function describeAnalyticsWindow(window: AnalyticsWindowRequest, days: number): string {
  if (window.range === 'custom' && window.from && window.to) {
    return window.from === window.to
      ? `Em ${shortBr(window.from)}`
      : `De ${shortBr(window.from)} a ${shortBr(window.to)}`
  }
  if (window.range === 'hoje') return 'Hoje'
  if (window.range === 'ano') return 'Este ano'
  return `Nos últimos ${days} dias`
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

/** Um dia da série de engajamento do Dashboard. */
export interface EngagementSeriesPointDTO {
  day: string
  feedbacks: number
  reactions: number
  comments: number
}

export interface PeopleOverviewDTO {
  /** A janela efetivamente aplicada, devolvida pelo servidor. */
  range: PeopleAnalyticsRange | 'custom'
  /** Primeiro e último dia civil do recorte (YYYY-MM-DD), inclusivos. */
  from: string
  to: string
  /** Tamanho da janela em dias — é o que a legenda dinâmica usa. */
  days: number
  /** Setor efetivamente aplicado (o do token, no caso do SUBADMIN). */
  sectorId: string | null
  /** Pessoas ativas no recorte — a base de todas as taxas. */
  activePeople: number
  /**
   * Pessoas distintas que acessaram **na janela selecionada**.
   *
   * Substituiu `uniqueUsers7d`/`uniqueUsers30d`, que eram calculados com janelas
   * fixas de 7 e 30 dias e por isso não mexiam quando o filtro mudava — o
   * problema que a G&G relatou na seção 4.1.
   */
  uniqueUsersInRange: number
  /** Acessos totais na janela (não distintos). */
  accessesInRange: number
  /** Percentual de `activePeople` que acessou na janela (0–100). */
  adoptionRate: number
  accessSeries: AccessSeriesPointDTO[]
  engagementSeries: EngagementSeriesPointDTO[]
  feedbacksCount: number
  feedbackReactionsCount: number
  /** Comunicados do Feed publicados na janela (KPI do Dashboard). */
  postsPublished: number
  /**
   * Feedbacks por competência do catálogo e por tag (a categoria personalizada
   * que quem escreve digita). Contagem por VÍNCULO: um feedback com três
   * competências conta em cada uma, então a soma passa de `feedbacksCount`.
   */
  feedbacksByCategory: DistributionSliceDTO[]
  feedbacksByTag: DistributionSliceDTO[]
  byRole: DistributionSliceDTO[]
  bySquad: DistributionSliceDTO[]
}

/**
 * Mapa de calor + tempo médio de sessão. Bloco próprio porque tem filtro de
 * período e setor independente do resto da tela (seção 4.2).
 */
export interface AccessHeatmapDTO {
  from: string
  to: string
  days: number
  sectorId: string | null
  cells: AccessHeatmapCellDTO[]
  /**
   * Tempo médio de sessão em minutos, **derivado** do `AccessLog` — não há
   * captura de duração no portal. Acessos consecutivos da mesma pessoa formam
   * uma sessão enquanto o intervalo for menor que `SESSION_GAP_MINUTES`.
   *
   * É um **piso**: a última tela da sessão não tem acesso seguinte que a feche,
   * então sessão de um acesso só conta zero. Null quando não houve acesso.
   */
  avgSessionMinutes: number | null
  /** Sessões consideradas na média — dá escala ao número acima. */
  sessions: number
}

/** Intervalo que fecha uma sessão, em minutos. O mesmo corte usual de analytics. */
export const SESSION_GAP_MINUTES = 30

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
  range: PeopleAnalyticsRange | 'custom'
  from: string
  to: string
  days: number
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

// ---------------------------------------------------------------------------
// Comunidade INOVA — sub-aba de Desenvolvimento (Guia AI First)
// ---------------------------------------------------------------------------

/** Quantas linhas o log de acessos recentes do Guia devolve, no máximo. */
export const INOVA_ACCESS_LOG_LIMIT = 200

/** Uma linha do log de acessos recentes ao Guia AI First. */
export interface InovaAccessLogRowDTO {
  id: string
  userName: string
  userEmail: string
  path: string
  label: string
  createdAt: string
}

export interface InovaAnalyticsDTO {
  range: PeopleAnalyticsRange | 'custom'
  from: string
  to: string
  days: number
  sectorId: string | null
  totalAccesses: number
  uniqueUsers: number
  /** Null quando não houve nenhum acesso no recorte. */
  topPage: ScreenAccessDTO | null
  byPage: ScreenAccessDTO[]
  /** Os mais recentes primeiro, até `INOVA_ACCESS_LOG_LIMIT`. */
  recentLogs: InovaAccessLogRowDTO[]
  /** Total de acessos no recorte — pode ser maior que `recentLogs.length`. */
  recentLogsTotal: number
}

export interface InovaAnalyticsResponse {
  inova: InovaAnalyticsDTO
}

// ---------------------------------------------------------------------------
// Comunicação Interna (Documento 3, seção 4.8)
// ---------------------------------------------------------------------------

/** Um dia da série do painel de comunicação. */
export interface CommunicationSeriesPointDTO {
  day: string
  reads: number
  interactions: number
}

/** Alcance de um setor: quantos dos seus leram os comunicados da janela. */
export interface SectorReachDTO {
  sectorId: string
  sectorName: string
  people: number
  readers: number
  /** Percentual inteiro (0..100). */
  reachPct: number
}

/** Fatia da rosca de reações. `key` é o emoji, ou `outras` no agrupado. */
export interface ReactionSliceDTO {
  key: string
  label: string
  count: number
}

/** Linha do Top 5 de comunicados mais engajados. */
export interface TopPostDTO {
  postId: string
  excerpt: string
  createdAt: string
  reads: number
  reactions: number
  comments: number
  readPct: number
}

/**
 * "Melhor horário de envio": o par (dia da semana, faixa de hora) com a maior
 * taxa média de leitura. Null quando nenhuma combinação atingiu o mínimo de
 * comunicados — com um post só, "melhor horário" é palpite, não indicador.
 */
export interface BestSendTimeDTO {
  /** 0 = domingo, como `Date.getDay()`. */
  weekday: number
  hour: number
  /** Taxa média de leitura dessa combinação (0..100). */
  readPct: number
  posts: number
}

/** Quantos comunicados uma combinação precisa ter para virar recomendação. */
export const BEST_SEND_TIME_MIN_POSTS = 3

/** Dias sem interação que ligam o alerta de baixo alcance (seção 4.8). */
export const LOW_REACH_ALERT_DAYS = 15

/** Setor no alerta de baixo alcance. `daysSince` null = nunca interagiu. */
export interface LowReachSectorDTO {
  sectorId: string
  sectorName: string
  daysSince: number | null
}

export interface CommunicationOverviewDTO {
  from: string
  to: string
  days: number
  sectorId: string | null
  tagId: string | null
  /** Média das taxas de leitura dos comunicados da janela (0..100). */
  averageReadPct: number
  /** Reações + comentários na janela. */
  totalEngagement: number
  postsPublished: number
  /** O mais lido da janela; null quando nada foi publicado. */
  mostRead: TopPostDTO | null
  /**
   * Pontos (XP) creditados por interação no Feed na janela.
   *
   * **Não são EMR Coins**, ao contrário do que a seção 4.8 pede: `CoinEvent` não
   * tem evento de mural nenhum — reagir, comentar e ler comunicado paga em XP
   * (`CORPORATE_POST_REACTION`, `CORPORATE_POST_COMMENT`,
   * `CORPORATE_POST_READ_FULL`). Um card em coins mostraria zero para sempre.
   */
  pointsAwarded: number
  series: CommunicationSeriesPointDTO[]
  bySector: SectorReachDTO[]
  reactions: ReactionSliceDTO[]
  topPosts: TopPostDTO[]
  bestSendTime: BestSendTimeDTO | null
  lowReachSectors: LowReachSectorDTO[]
}

export interface CommunicationOverviewResponse {
  communication: CommunicationOverviewDTO
}

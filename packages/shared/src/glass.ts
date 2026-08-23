/**
 * Contrato do GlassAgent — avaliações externas (Glassdoor) coladas por um
 * administrador.
 *
 * A avaliação é **anônima por construção**: nenhum campo aqui identifica quem a
 * escreveu, e não existe campo onde isso caberia. `createdById` no model é quem
 * COLOU o texto, não quem o escreveu.
 *
 * Os vocabulários abaixo são **fechados** de propósito. Sem eles não existe
 * agregação de tema: "liderança", "gestão ruim" e "chefia" virariam três linhas
 * distintas no relatório.
 */

export const GLASS_SENTIMENTS = ['POSITIVO', 'NEUTRO', 'NEGATIVO'] as const
export type GlassSentiment = (typeof GLASS_SENTIMENTS)[number]

export const GLASS_SENTIMENT_LABELS: Record<GlassSentiment, string> = {
  POSITIVO: 'Positivo',
  NEUTRO: 'Neutro',
  NEGATIVO: 'Negativo',
}

/** Linha antiga (import parcial) pode não ter sentimento — a tela diz isso, não chuta. */
export const GLASS_SENTIMENT_UNCLASSIFIED_LABEL = 'Não classificado'

export const GLASS_THEMES_POSITIVE = [
  'AMBIENTE_EQUIPE',
  'LIDERANCA',
  'APRENDIZADO',
  'FLEXIBILIDADE',
  'BENEFICIOS',
  'CULTURA_VALORES',
  'ESTABILIDADE',
  'PROPOSITO',
  'ESTRUTURA_FERRAMENTAS',
  'RECONHECIMENTO',
  'REMUNERACAO',
  'EQUILIBRIO_VIDA_TRABALHO',
] as const
export type GlassThemePositive = (typeof GLASS_THEMES_POSITIVE)[number]

export const GLASS_THEMES_NEGATIVE = [
  'REMUNERACAO',
  'SOBRECARGA',
  'LIDERANCA_GESTAO',
  'PLANO_DE_CARREIRA',
  'COMUNICACAO_INTERNA',
  'PROCESSOS_BUROCRACIA',
  'CLIMA_TOXICO',
  'ROTATIVIDADE',
  'FALTA_DE_RECONHECIMENTO',
  'BENEFICIOS_INSUFICIENTES',
  'ASSEDIO',
  'SAUDE_MENTAL',
  'FALTA_DE_ESTRUTURA',
  'INSTABILIDADE',
] as const
export type GlassThemeNegative = (typeof GLASS_THEMES_NEGATIVE)[number]

/** Rótulos de tema para a tela — a chave é técnica, o usuário lê português. */
export const GLASS_THEME_LABELS: Record<string, string> = {
  AMBIENTE_EQUIPE: 'Ambiente e equipe',
  LIDERANCA: 'Liderança',
  APRENDIZADO: 'Aprendizado e desenvolvimento',
  FLEXIBILIDADE: 'Flexibilidade',
  BENEFICIOS: 'Benefícios',
  CULTURA_VALORES: 'Cultura e valores',
  ESTABILIDADE: 'Estabilidade',
  PROPOSITO: 'Propósito e impacto',
  ESTRUTURA_FERRAMENTAS: 'Estrutura e ferramentas',
  RECONHECIMENTO: 'Reconhecimento',
  REMUNERACAO: 'Remuneração',
  EQUILIBRIO_VIDA_TRABALHO: 'Equilíbrio vida-trabalho',
  SOBRECARGA: 'Sobrecarga e jornada',
  LIDERANCA_GESTAO: 'Liderança e gestão',
  PLANO_DE_CARREIRA: 'Plano de carreira',
  COMUNICACAO_INTERNA: 'Comunicação interna',
  PROCESSOS_BUROCRACIA: 'Processos e burocracia',
  CLIMA_TOXICO: 'Clima tóxico',
  ROTATIVIDADE: 'Rotatividade',
  FALTA_DE_RECONHECIMENTO: 'Falta de reconhecimento',
  BENEFICIOS_INSUFICIENTES: 'Benefícios insuficientes',
  ASSEDIO: 'Assédio',
  SAUDE_MENTAL: 'Saúde mental',
  FALTA_DE_ESTRUTURA: 'Falta de estrutura',
  INSTABILIDADE: 'Instabilidade',
}

export const GLASS_STATUS = ['ATIVO', 'EX_FUNCIONARIO'] as const
export type GlassStatus = (typeof GLASS_STATUS)[number]

export const GLASS_STATUS_LABELS: Record<GlassStatus, string> = {
  ATIVO: 'Funcionário atual',
  EX_FUNCIONARIO: 'Ex-funcionário',
}

/**
 * Faixas **contínuas**: qualquer tempo de casa cai em exatamente um bucket. A
 * versão anterior pulava de "1 a 2" para "3 a 5" e deixava "2 anos e meio" sem
 * casa — o modelo devolvia null (forçando o admin a escolher um bucket errado)
 * ou chutava um vizinho, e o recorte por tempo carregava linha falsa.
 */
export const GLASS_TENURE_BUCKETS = [
  'MENOS_DE_1_ANO',
  'DE_1_A_3_ANOS',
  'DE_3_A_5_ANOS',
  'MAIS_DE_5_ANOS',
] as const
export type GlassTenure = (typeof GLASS_TENURE_BUCKETS)[number]

export const GLASS_TENURE_LABELS: Record<GlassTenure, string> = {
  MENOS_DE_1_ANO: 'Menos de 1 ano',
  DE_1_A_3_ANOS: 'De 1 a 3 anos',
  DE_3_A_5_ANOS: 'De 3 a 5 anos',
  MAIS_DE_5_ANOS: 'Mais de 5 anos',
}

/**
 * Limiares dos alertas. Ficam aqui, e não espalhados pelo código, porque são a
 * política de risco da empresa — quem for calibrar mexe num lugar só.
 */
export const GLASS_ALERT_RULES = {
  /** Nota máxima que dispara NOTA_BAIXA_ATIVO (≤). */
  lowRatingMax: 2,
  /** Quantas avaliações recentes abaixo da média disparam QUEDA_CONSECUTIVA. */
  consecutiveBelowAverage: 3,
  /** Nota abaixo da qual a avaliação conta para SETOR_CRITICO (<). */
  sectorLowRatingCutoff: 3,
  /** Quantas dessas bastam para o setor virar crítico (≥). */
  sectorMinLowReviews: 3,
} as const

export type GlassAlertKey =
  // por avaliação — dependem só da linha, gravados em `alerts[]`
  | 'NOTA_BAIXA_ATIVO'
  | 'PALAVRA_CRITICA_BURNOUT'
  | 'PALAVRA_CRITICA_ASSEDIO'
  | 'PALAVRA_CRITICA_TOXICO'
  | 'PALAVRA_CRITICA_DEMISSAO'
  // agregados — dependem das vizinhas, calculados na leitura
  | 'QUEDA_CONSECUTIVA'
  | 'SETOR_CRITICO'

export const GLASS_ALERT_LABELS: Record<GlassAlertKey, string> = {
  NOTA_BAIXA_ATIVO: 'Nota baixa de pessoa ativa',
  PALAVRA_CRITICA_BURNOUT: 'Menção a esgotamento',
  PALAVRA_CRITICA_ASSEDIO: 'Menção a assédio',
  PALAVRA_CRITICA_TOXICO: 'Menção a clima tóxico',
  PALAVRA_CRITICA_DEMISSAO: 'Menção a demissão em massa',
  QUEDA_CONSECUTIVA: 'Queda consecutiva nas notas',
  SETOR_CRITICO: 'Setor com repetição de nota baixa',
}

/**
 * Palavras já **normalizadas**: minúsculas, sem acento. O casamento acontece
 * sobre o texto normalizado do mesmo jeito (ver `lib/glass-alerts.ts`).
 *
 * O grupo `demissao` só reconhece formulação de **massa**. "Demissão" sozinha
 * aparece em quase toda avaliação de ex-funcionário e viraria alerta
 * permanente — alerta que sempre dispara não é alerta.
 */
export const GLASS_CRITICAL_KEYWORDS = {
  burnout: ['burnout', 'esgotamento', 'exaustao', 'exausto', 'adoeci'],
  assedio: ['assedio', 'assediada', 'assediado', 'humilhacao', 'humilhada', 'humilhado', 'constrangimento'],
  toxico: ['toxico', 'toxica', 'gritaria', 'perseguicao', 'retaliacao'],
  demissao: [
    'demissao em massa',
    'demissoes em massa',
    'layoff',
    'corte de pessoal',
    'desligamento em massa',
    'onda de demissoes',
  ],
} as const

export type GlassKeywordGroup = keyof typeof GLASS_CRITICAL_KEYWORDS

/** Grupo de palavra-chave → alerta correspondente. */
export const GLASS_KEYWORD_ALERTS: Record<GlassKeywordGroup, GlassAlertKey> = {
  burnout: 'PALAVRA_CRITICA_BURNOUT',
  assedio: 'PALAVRA_CRITICA_ASSEDIO',
  toxico: 'PALAVRA_CRITICA_TOXICO',
  demissao: 'PALAVRA_CRITICA_DEMISSAO',
}

/**
 * Empresas de comparação do prompt. Vazia por padrão: o portal de origem
 * cravava nomes de concorrentes no código, e o Legends é whitelabel.
 */
export const GLASS_BENCHMARK_COMPANIES: readonly string[] = []

export const GLASS_COMMANDS = ['/relatorio', '/tendencia', '/criticos', '/cruzamento'] as const
export type GlassCommand = (typeof GLASS_COMMANDS)[number]

/** A mensagem é comando quando a primeira palavra é um dos comandos conhecidos. */
export function isGlassCommand(message: string): boolean {
  return parseGlassCommand(message) !== null
}

export function parseGlassCommand(message: string): { command: GlassCommand; args: string[] } | null {
  const [head, ...args] = message.trim().toLowerCase().split(/\s+/)
  const command = GLASS_COMMANDS.find((entry) => entry === head)
  return command ? { command, args } : null
}

export const GLASS_BREAKDOWN_DIMENSIONS = ['setor', 'cargo', 'tempo', 'status'] as const
export type GlassDimension = (typeof GLASS_BREAKDOWN_DIMENSIONS)[number]

/** Campos exigidos na gravação. A coluna aceita null; a porta de entrada não. */
export const GLASS_REQUIRED_FIELDS = ['sector', 'role', 'tenure'] as const
export type GlassRequiredField = (typeof GLASS_REQUIRED_FIELDS)[number]

export const GLASS_REQUIRED_FIELD_LABELS: Record<GlassRequiredField, string> = {
  sector: 'Setor',
  role: 'Cargo',
  tenure: 'Tempo de casa',
}

/** Teto do texto colado. É uma avaliação, não um dossiê. */
export const GLASS_RAW_MAX_LENGTH = 8000
export const GLASS_TEXT_MAX_LENGTH = 4000
export const GLASS_SHORT_TEXT_MAX_LENGTH = 200

/**
 * Rascunho devolvido pelo `/parse` — nada disso está gravado ainda. Os campos
 * são nuláveis porque a avaliação colada pode não trazer tudo; `missingFields`
 * diz o que a pessoa precisa completar antes de confirmar.
 */
export interface GlassReviewDraft {
  /** ISO `AAAA-MM-DD`. */
  reviewDate: string | null
  rating: number | null
  role: string | null
  level: string | null
  sector: string | null
  tenure: GlassTenure | null
  status: GlassStatus | null
  recommends: boolean | null
  leadershipApproval: boolean | null
  title: string | null
  positives: string | null
  negatives: string | null
  advice: string | null
  sentiment: GlassSentiment
  themesPositive: GlassThemePositive[]
  themesNegative: GlassThemeNegative[]
  aiSummary: string | null
}

export interface GlassParseRequest {
  raw: string
}

export interface GlassParseResponse {
  draft: GlassReviewDraft
  /** Vazio quando a avaliação veio completa. */
  missingFields: GlassRequiredField[]
}

/** O que a tela envia ao confirmar. Os três obrigatórios não são nuláveis aqui. */
export interface CreateGlassReviewRequest extends Omit<GlassReviewDraft, 'sector' | 'role' | 'tenure'> {
  sector: string
  role: string
  tenure: GlassTenure
}

/**
 * `sentiment` é **nulável na leitura** e não-nulável no rascunho: a extração
 * sempre classifica, mas a coluna aceita null (import parcial de histórico). O
 * DTO precisa contar a mesma história que o overview, que só soma os não-nulos —
 * tapar o buraco com 'NEUTRO' faria as duas leituras discordarem sobre as mesmas
 * linhas, e uma delas mostraria um valor que ninguém produziu.
 */
export interface GlassReviewDTO extends Omit<GlassReviewDraft, 'sentiment'> {
  id: string
  sentiment: GlassSentiment | null
  /** Só os alertas por avaliação; os agregados vivem no overview. */
  alerts: GlassAlertKey[]
  createdAt: string
}

export interface GlassBreakdownRowDTO {
  key: string
  count: number
  averageRating: number | null
}

export interface GlassTrendPointDTO {
  /** `AAAA-MM`. */
  month: string
  averageRating: number
  count: number
}

export interface GlassThemeCountDTO {
  theme: string
  count: number
}

export interface GlassAggregateAlertDTO {
  key: GlassAlertKey
  /** Setor em SETOR_CRITICO; ausente em QUEDA_CONSECUTIVA, que é da empresa. */
  scope?: string
  /** Quantas avaliações sustentam o alerta — a tela mostra o porquê, não só o aviso. */
  count: number
}

export interface GlassOverviewDTO {
  totalReviews: number
  averageRating: number | null
  /** Proporção 0–1 entre as avaliações que responderam. */
  recommendRate: number | null
  leadershipApprovalRate: number | null
  sentimentCounts: Record<GlassSentiment, number>
  trend: GlassTrendPointDTO[]
  bySector: GlassBreakdownRowDTO[]
  byRole: GlassBreakdownRowDTO[]
  byTenure: GlassBreakdownRowDTO[]
  byStatus: GlassBreakdownRowDTO[]
  topThemesPositive: GlassThemeCountDTO[]
  topThemesNegative: GlassThemeCountDTO[]
  alerts: GlassAggregateAlertDTO[]
}

export interface GlassOverviewResponse {
  overview: GlassOverviewDTO
}

export interface GlassReviewListResponse {
  /** Página atual — cortada em `limit`. */
  reviews: GlassReviewDTO[]
  /** Quantas avaliações casam com o filtro, independente do `limit`. */
  total: number
}

export interface GlassCrossTabCellDTO {
  rowKey: string
  columnKey: string
  count: number
  averageRating: number | null
}

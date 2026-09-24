import type { PublicUser } from './auth'
import type { MoodLevel, MoodReason } from './mood'

/**
 * Contrato do painel de clima (`GET /admin/mood/overview`).
 *
 * **Os comentários deixaram de ser anônimos** (Documento 3, seção 4.6): a G&G
 * pediu identificação para conseguir agir sobre o que lê, e a decisão alcança o
 * histórico. Este arquivo dizia o contrário até então — "nenhum campo carrega
 * `userId`" —, e a reversão vem com duas obrigações que não são opcionais:
 *
 * 1. a tela do colaborador (`MoodOfDay`) não promete mais confidencialidade;
 * 2. o piso de `MOOD_ANONYMITY_MIN` **continua** valendo para os agregados
 *    (média, tendência, distribuição). Ele protege o recorte pequeno, não o
 *    comentário, e nada no documento pede para tirá-lo.
 *
 * Quem lê continua sendo só o bloco de Gente e Gestão: líder não vê comentário
 * identificado de terceiro.
 */

/** Um dia da série de tendência. `average` em 1..5 (escala `MOOD_SCORES`). */
export interface MoodTrendPointDTO {
  /** YYYY-MM-DD, data civil em America/Sao_Paulo. */
  day: string
  /** null quando o dia não teve registros OU foi suprimido pelo piso. */
  average: number | null
  /** Registros do dia; 0 em dia suprimido — o piso não expõe a contagem. */
  count: number
  /** true quando houve registro no dia, mas abaixo do piso de anonimato. */
  suppressed: boolean
}

/** Uma fatia da distribuição do dia, por carinha. */
export interface MoodDistributionSliceDTO {
  mood: MoodLevel
  count: number
  /** Percentual inteiro (0..100) sobre o total do dia. */
  percent: number
}

/** Uma fatia do ranking de motivos. `reason` null = "Não informado". */
export interface MoodReasonSliceDTO {
  reason: MoodReason | null
  count: number
  /** Percentual inteiro (0..100) sobre o total de registros negativos. */
  percent: number
}

/** Nota de humor negativo, sem autor. `daysAgo` evita expor o horário exato. */
export interface MoodCommentDTO {
  id: string
  day: string
  daysAgo: number
  mood: MoodLevel
  reason: MoodReason | null
  note: string
  /** Quem escreveu. Ver a nota de topo deste arquivo. */
  author: PublicUser
}

/** Participação do dia: quantos registraram sobre quantos poderiam registrar. */
export interface MoodParticipationDTO {
  responded: number
  total: number
  /** Percentual inteiro (0..100). */
  percent: number
}

export interface MoodOverviewDTO {
  /** Janela pedida, em dias (inclui hoje). */
  days: number
  /** Setor do recorte; null = empresa inteira. */
  sectorId: string | null
  /** Média ponderada dos últimos 7 dias (1..5); null se suprimida/sem dados. */
  weekAverage: number | null
  /** null quando hoje ficou abaixo do piso de anonimato. */
  participationToday: MoodParticipationDTO | null
  /** Registros na janela inteira (não é recorte de dia — não sofre supressão). */
  totalEntries: number
  /** Um ponto por dia da janela, do mais antigo ao mais recente. */
  trend: MoodTrendPointDTO[]
  /** Vazio quando hoje ficou abaixo do piso. */
  todayDistribution: MoodDistributionSliceDTO[]
  /** Do mais frequente ao menos; vazio quando o recorte ficou abaixo do piso. */
  reasons: MoodReasonSliceDTO[]
  /**
   * **Causas de alerta**: só de humor negativo (Estressado e Desanimado).
   * É a Caixa 1 da seção 4.6.
   */
  alertComments: MoodCommentDTO[]
  /**
   * **Comentários**: toda a escala, do mais negativo ao mais positivo — a
   * Caixa 2. Inclui os de `alertComments`; as duas listas se sobrepõem de
   * propósito, porque a Caixa 2 é "tudo o que foi escrito".
   */
  comments: MoodCommentDTO[]
}

export interface MoodOverviewResponse {
  overview: MoodOverviewDTO
}

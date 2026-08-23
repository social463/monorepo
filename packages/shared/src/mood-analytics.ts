import type { MoodLevel, MoodReason } from './mood'

/**
 * Contrato do painel agregado de clima (`GET /admin/mood/overview`).
 *
 * Regra que atravessa o arquivo inteiro: **nenhum campo carrega `userId`**.
 * O anonimato aqui é garantia técnica do formato, não escolha de UI — se um
 * identificador de pessoa aparecer em qualquer ponto deste DTO, a entrega está
 * quebrada. Todo recorte com menos de `MOOD_ANONYMITY_MIN` respostas vem
 * suprimido (o service corta antes de serializar).
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
  /** Só de dias que atingiram o piso, do mais recente ao mais antigo. */
  comments: MoodCommentDTO[]
}

export interface MoodOverviewResponse {
  overview: MoodOverviewDTO
}

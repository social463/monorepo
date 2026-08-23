import type { PublicUser } from './auth'
import type { AwardedBadgeDTO } from './badge'
import type { RetroActionItemDTO } from './retro'
import type { XpLevelInfo } from './xp'

export interface CategoryBreakdownItem {
  categorySlug: string
  categoryName: string
  count: number
}

export interface ProfileStats {
  /** Feedbacks recebidos — inclui o que veio do voto, materializado na publicação do destaque. */
  totalFeedbacksReceived: number
  /** Meses distintos em que a pessoa recebeu feedback. */
  monthsWithFeedback: number
}

/**
 * Progressão de quem é dono do perfil. `points` é o total acumulado e `level` é
 * o degrau derivado dele — sempre presente, mesmo com zero ponto, porque quem
 * decide se mostra é a tela: a regra do produto é não afirmar nível nenhum
 * antes do primeiro ponto (ver `HomeProfileCard`).
 */
export interface ProfileXp {
  points: number
  level: XpLevelInfo
}

export interface ProfileDTO {
  user: PublicUser
  stats: ProfileStats
  xp: ProfileXp
  categoryBreakdown: CategoryBreakdownItem[]
  months: string[]
  badges: AwardedBadgeDTO[]
  actions: RetroActionItemDTO[]
  /**
   * Quantas ações o dono do perfil arquivou. Só a contagem: a lista em si é
   * buscada sob demanda. Existe para a seção não sumir de quem arquivou tudo —
   * sem ela, arquivar a última ação levaria embora o caminho de volta.
   */
  archivedActionCount: number
  /** Se a feature "votar" está habilitada para o SETOR do usuário do perfil (não do viewer). */
  votingEnabled: boolean
}

import type { PublicUser } from './auth'
import type { AwardedBadgeDTO } from './badge'
import type { ProfileXp } from './profile'

/** Um desenvolvedor na galeria de conquistas: identidade + feedbacks + selos. */
export interface ShowcaseEntry {
  user: PublicUser
  feedbacksReceived: number
  badges: AwardedBadgeDTO[]
  /**
   * Progressão da pessoa. `points` 0 significa que ela ainda não pontuou — e aí
   * a tela NÃO afirma nível nenhum, mesma regra do card de perfil da Home.
   */
  xp: ProfileXp
}

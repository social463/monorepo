import type { MoodSummaryDTO, PeopleAnalyticsRange, ScreenAccessDTO } from './people-analytics'

/**
 * Indicadores do time na página de Liderança.
 *
 * É o People Analytics recortado por **pessoas lideradas** em vez de setor: os
 * mesmos DTOs de clima (`MoodSummaryDTO`) e de telas (`ScreenAccessDTO`) são
 * reusados de propósito, para as duas telas não divergirem na definição de
 * "humor médio" ou "tela mais acessada". O que é exclusivo do líder são os
 * feedbacks do time e a pontuação (XP) por pessoa.
 */

/** XP de um liderado dentro da janela selecionada. */
export interface TeamMemberScoreDTO {
  userId: string
  name: string
  points: number
}

/**
 * Feedbacks do time na janela. São duas perguntas diferentes para um líder —
 * o quanto o time escreve e o quanto o time é reconhecido —, então nunca vire
 * isso num número só.
 */
export interface TeamFeedbackSummaryDTO {
  written: number
  received: number
}

export interface TeamScoreSummaryDTO {
  /** Média de XP por liderado na janela; 0 quando não há ninguém no time. */
  average: number
  /** Um item por liderado, do maior XP para o menor. Inclui quem ficou em 0. */
  perPerson: TeamMemberScoreDTO[]
}

export interface LeadershipOverviewDTO {
  range: PeopleAnalyticsRange
  /** Liderados distintos no recorte. Zero = quem vê a tela não lidera ninguém. */
  teamSize: number
  mood: MoodSummaryDTO
  feedbacks: TeamFeedbackSummaryDTO
  topScreens: ScreenAccessDTO[]
  scores: TeamScoreSummaryDTO
}

export interface LeadershipOverviewResponse {
  overview: LeadershipOverviewDTO
}

export interface StreakSummaryDTO {
  currentStreak: number
  bestStreak: number
  today: string // YYYY-MM-DD em America/Sao_Paulo
  registeredToday: boolean
}

export interface StreakCalendarDTO {
  ref: string // "YYYY-MM"
  days: string[] // YYYY-MM-DD com boost no mês
  count: number // boosts no mês
}

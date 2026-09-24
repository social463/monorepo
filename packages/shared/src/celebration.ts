import type { PublicUser } from './auth'

/**
 * Um aniversário de nascimento. Só dia e mês trafegam: o ano fica no banco
 * (visível apenas para admin, em `AdminUserDTO.birthDate`) para não expor a
 * idade de ninguém no feed da Home.
 */
export interface BirthdayDTO {
  user: PublicUser
  /** Dia do mês (1–31). */
  day: number
  /** Mês (1–12). */
  month: number
}

/** Um aniversário de casa ("aniversariante de empresa"), derivado de `joinedAt`. */
export interface WorkAnniversaryDTO {
  user: PublicUser
  /** Dia do mês (1–31). */
  day: number
  /** Mês (1–12). */
  month: number
  /** Anos completos de casa nessa data — sempre ≥ 1 (quem entrou no ano não conta). */
  years: number
}

/** Campos extras de uma ocorrência futura (usados na lista de "próximos"). */
interface UpcomingOccurrence {
  /** Dias até essa ocorrência a partir de `referenceDay` (0 = hoje). */
  daysUntil: number
  /** Data observada da ocorrência (YYYY-MM-DD), já aplicando a regra de 29/02. */
  observedDate: string
  /**
   * Assinaturas que o mural desta ocorrência já tem. Serve o card da Home
   * ("3 já assinaram"), e por isso é contado só para quem comemora HOJE —
   * nas demais datas vem 0, e não vale como "ninguém assinou".
   */
  greetingCount: number
}

export interface UpcomingBirthdayDTO extends BirthdayDTO, UpcomingOccurrence {}
export interface UpcomingWorkAnniversaryDTO extends WorkAnniversaryDTO, UpcomingOccurrence {}

/**
 * Até quantos dias à frente uma celebração ainda conta como "próxima".
 *
 * Sem a janela, uma empresa pequena em mês vazio mostrava aniversário de dois
 * meses adiante como se fosse notícia — e o card da Home é sobre o que está
 * acontecendo agora. As 3 datas mais próximas continuam valendo como teto; esta
 * constante é o piso de relevância.
 */
export const UPCOMING_CELEBRATION_WINDOW_DAYS = 15

export interface CelebrationsResponse {
  /** Data civil de referência em America/Sao_Paulo (YYYY-MM-DD). */
  referenceDay: string
  birthdays: {
    /** Aniversariantes do mês corrente, ordenados por dia e depois por nome. */
    month: BirthdayDTO[]
    /**
     * Aniversariantes das 3 datas mais próximas a partir de hoje (hoje incluso),
     * dentro da janela de `UPCOMING_CELEBRATION_WINDOW_DAYS`.
     * O corte é por data, não por pessoa: uma data com várias pessoas aparece
     * inteira. Ordenado por `daysUntil` e, dentro da mesma data, por nome.
     */
    upcoming: UpcomingBirthdayDTO[]
  }
  workAnniversaries: {
    month: WorkAnniversaryDTO[]
    upcoming: UpcomingWorkAnniversaryDTO[]
  }
}

/** Nomes dos meses em pt-BR, indexados de 1 a 12 (índice 0 não é usado). */
export const MONTH_LABELS = [
  '',
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const

/** "1 ano de casa" / "3 anos de casa". */
export function tenureLabel(years: number): string {
  return years === 1 ? '1 ano de casa' : `${years} anos de casa`
}

import type { PublicUser } from './auth'
import { isFullAdmin } from './permissions'

/**
 * Destaques do Mês **curados pela G&G** — uma ou várias pessoas por grupo, por
 * mês.
 *
 * Não confundir com o **Destaque do Mês da votação** (`highlight.ts`), que
 * continua existindo e é derivado do `VotingPeriod`: lá o vencedor sai dos
 * votos e é um por setor; aqui a escolha é editorial, e o mesmo mês tem quantas
 * pessoas a G&G quiser. Os dois convivem na mesma tela, em abas.
 */

/** Teto de pessoas por cadastro em lote — o quadro do mês, não a empresa toda. */
export const MAX_HIGHLIGHTS_PER_REQUEST = 50

/** Limite da justificativa (o texto que hoje a G&G manda por fora). */
export const HIGHLIGHT_MESSAGE_MAX_LENGTH = 500

/** `AAAA-MM`, o mesmo formato do `monthRef` da votação. */
export function isMonthRef(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
}

const MONTH_NAMES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
]

/** "Agosto de 2026" — é assim que o texto oficial do vazio pede o mês. */
export function monthRefLabel(monthRef: string): string {
  const [year, month] = monthRef.split('-')
  const name = MONTH_NAMES[Number(month) - 1]
  return name ? `${name} de ${year}` : monthRef
}

export const MONTH_OPTIONS = MONTH_NAMES.map((name, index) => ({
  value: String(index + 1).padStart(2, '0'),
  label: name,
}))

/**
 * Quem cadastra, edita e exclui destaque: só a administração. Líder e
 * colaborador visualizam — é o que a tabela de permissões do documento pede.
 */
export function canManageMonthlyHighlights(role?: string | null, adminAccess = false): boolean {
  return isFullAdmin({ role, adminAccess }) || role === 'SUBADMIN'
}

/** Grupo de exibição do destaque. Hoje é o SETOR (ver a spec, decisão 2). */
export interface HighlightGroupRef {
  id: string
  name: string
}

export interface MonthlyHighlightDTO {
  id: string
  monthRef: string
  person: PublicUser
  /** Grupo no momento do cadastro — snapshot, não o setor atual da pessoa. */
  group: HighlightGroupRef
  /** Justificativa do reconhecimento; null quando a G&G ainda não escreveu. */
  message: string | null
  createdAt: string
}

/** Um bloco do quadro: o grupo e as pessoas reconhecidas nele. */
export interface MonthlyHighlightGroupDTO {
  group: HighlightGroupRef
  people: MonthlyHighlightDTO[]
}

export interface MonthlyHighlightsResponse {
  monthRef: string
  groups: MonthlyHighlightGroupDTO[]
  /** Total de pessoas no mês — o que decide entre o quadro e o estado vazio. */
  total: number
}

export interface MyRecognitionsResponse {
  highlights: MonthlyHighlightDTO[]
}

export interface CreateMonthlyHighlightsRequest {
  monthRef: string
  /** Ids das pessoas. O setor de cada uma é lido do cadastro, não enviado. */
  userIds: string[]
  message?: string
}

export interface UpdateMonthlyHighlightRequest {
  message?: string | null
}

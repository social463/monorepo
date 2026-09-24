import { ARENA_TEAMS, type ArenaTeam } from './arena-match'

/**
 * Pegue a bandeira, sobre a mesma base do mata-mata: times, abate e
 * renascimento já existem; o que muda é o que dá ponto.
 *
 * As regras moram aqui, puras — o hub cuida do relógio e do broadcast.
 */

/** Distância (px) para encostar numa bandeira: pegar, devolver ou capturar. */
export const ARENA_FLAG_REACH = 22

/** Quanto uma bandeira caída espera no chão antes de voltar sozinha. */
export const ARENA_FLAG_RETURN_MS = 20_000

/** Capturas para vencer. Baixo de propósito: partida de bandeira é lenta. */
export const ARENA_FLAG_SCORE_LIMIT = 3

export type ArenaFlagState =
  /** Na base do próprio time. */
  | { at: 'base' }
  /** Na mão de alguém do time adversário. */
  | { at: 'carregada'; byUserId: string }
  /**
   * Caída no campo. `returnsInMs` é tempo RESTANTE, nunca instante absoluto —
   * o cliente conta a partir do que recebe, como no resto do contrato.
   */
  | { at: 'caida'; x: number; y: number; returnsInMs: number }

export type ArenaFlags = Record<ArenaTeam, ArenaFlagState>

export function initialFlags(): ArenaFlags {
  return { oeste: { at: 'base' }, leste: { at: 'base' } }
}

/** O outro time. */
export function rivalTeam(team: ArenaTeam): ArenaTeam {
  return ARENA_TEAMS[0] === team ? ARENA_TEAMS[1] : ARENA_TEAMS[0]
}

export interface FlagActor {
  userId: string
  team: ArenaTeam
  x: number
  y: number
  /** Abatido não interage com bandeira nenhuma. */
  downed: boolean
}

/** O que encostar numa bandeira provoca. */
export type ArenaFlagEvent =
  /** Pegou a bandeira do adversário. */
  | { kind: 'pegou'; team: ArenaTeam; userId: string }
  /** Devolveu a própria bandeira caída para a base. */
  | { kind: 'devolveu'; team: ArenaTeam; userId: string }
  /** Levou a bandeira adversária até a própria base: ponto. */
  | { kind: 'capturou'; team: ArenaTeam; userId: string }

export interface FlagInteractionOptions {
  flags: ArenaFlags
  actor: FlagActor
  /** Onde fica a base de cada time, em pixels. */
  bases: Record<ArenaTeam, { x: number; y: number }>
}

const perto = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  alcance = ARENA_FLAG_REACH,
) => Math.hypot(a.x - b.x, a.y - b.y) <= alcance

/**
 * O que este jogador provoca na posição em que está.
 *
 * Devolve NO MÁXIMO um evento por chamada — o hub aplica e chama de novo no
 * tick seguinte. Encadear (pegar e capturar no mesmo quadro) esconderia
 * estado do cliente: ele veria o placar mudar sem nunca ver a bandeira sair
 * do lugar.
 */
export function flagInteraction({
  flags,
  actor,
  bases,
}: FlagInteractionOptions): ArenaFlagEvent | null {
  if (actor.downed) return null
  const adversario = rivalTeam(actor.team)
  const minha = flags[actor.team]
  const dele = flags[adversario]

  // 1) Capturar: estou com a bandeira dele e cheguei na MINHA base.
  if (dele.at === 'carregada' && dele.byUserId === actor.userId) {
    // Regra clássica: só pontua com a própria bandeira em casa. É o que faz a
    // defesa existir — sem ela, o jogo vira corrida de ida e volta e ninguém
    // tem motivo para ficar atrás. O retorno automático evita que isso trave a
    // partida.
    if (minha.at === 'base' && perto(actor, bases[actor.team])) {
      return { kind: 'capturou', team: actor.team, userId: actor.userId }
    }
    return null
  }

  // 2) Devolver a minha bandeira caída.
  if (minha.at === 'caida' && perto(actor, minha)) {
    return { kind: 'devolveu', team: actor.team, userId: actor.userId }
  }

  // 3) Pegar a bandeira dele — na base dele ou caída no campo.
  if (dele.at === 'base' && perto(actor, bases[adversario])) {
    return { kind: 'pegou', team: adversario, userId: actor.userId }
  }
  if (dele.at === 'caida' && perto(actor, dele)) {
    return { kind: 'pegou', team: adversario, userId: actor.userId }
  }

  return null
}

/** Quem está carregando a bandeira de um time, se alguém. */
export function flagCarrier(flags: ArenaFlags, team: ArenaTeam): string | null {
  const flag = flags[team]
  return flag.at === 'carregada' ? flag.byUserId : null
}

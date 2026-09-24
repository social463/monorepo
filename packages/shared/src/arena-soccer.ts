import { ARENA_TEAMS, type ArenaTeam } from './arena-match'
import type { BodyBallState } from './body-ball'

/**
 * Futebol na arena: a geometria do campo e o que conta como gol.
 *
 * As regras moram aqui, puras — o hub cuida do relógio e do broadcast, e o
 * mapa (`arena-soccer-map.ts`) é DESENHADO a partir desta geometria. É por
 * isso que ela vive neste módulo e não lá: a trave que o jogador vê e a linha
 * que o servidor mede têm de ser a mesma coisa, e a única forma de garantir
 * isso é uma fonte só.
 */

/** Lado do tile do campo. O mesmo do escritório, para os sprites servirem sem escala. */
export const SOCCER_TILE = 32

/**
 * Dimensões em tiles. Bem menor que o campo de batalha (121×85) de propósito:
 * lá, não se encontrar é mecânica; aqui, é o fim do jogo.
 *
 * Ímpar nos dois eixos para haver linha e coluna centrais exatas — o círculo
 * central e a marca do meio caem em pixel inteiro.
 */
export const SOCCER_MAP_WIDTH = 81
export const SOCCER_MAP_HEIGHT = 49

/** Faixa de muro em volta, em tiles. Como no campo de batalha. */
export const SOCCER_WALL_TILES = 2

/** Tamanho da peça de rede do acervo (`school/rede-de-gol-*`), em tiles. */
export const SOCCER_GOAL_COLS = 3
export const SOCCER_GOAL_ROWS = 5

/**
 * Um gol, em PIXELS.
 *
 * `line` é a boca — o plano que a bola precisa cruzar. No futebol de verdade a
 * linha do gol é a de entre as traves, não o fundo da rede, e é assim que ela
 * é medida aqui.
 *
 * `inside` diz para que lado fica o fundo: −1 quando a rede está à esquerda da
 * boca (gol oeste), +1 quando está à direita. É ele que transforma "cruzou" em
 * uma comparação só, sem um `if` por time.
 */
export interface SoccerGoal {
  /** X da boca do gol, em px. */
  line: number
  /** Extremos verticais da boca (entre as traves), em px. */
  top: number
  bottom: number
  /** Para que lado a bola entra: −1 (oeste) ou +1 (leste). */
  inside: -1 | 1
  /** Canto superior-esquerdo da peça de rede, em TILES. */
  netTileX: number
  netTileY: number
}

export interface SoccerField {
  /** Limites do gramado jogável (dentro do muro), em px. */
  left: number
  right: number
  top: number
  bottom: number
  centerX: number
  centerY: number
  /** Raio do círculo central, em px. */
  circleRadius: number
  /** Grande área: profundidade a partir da linha do gol e altura total, em px. */
  penaltyDepth: number
  penaltyHeight: number
  /** Área pequena. */
  goalAreaDepth: number
  goalAreaHeight: number
  /** Distância da marca do pênalti até a linha, em px. */
  penaltySpot: number
  /**
   * O gol que cada time DEFENDE. Quem cruza o de `oeste` pontua para `leste` —
   * a leitura é a mesma da bandeira, onde `flags[team]` é a bandeira DAQUELE
   * time e quem a captura é o outro.
   */
  goals: Record<ArenaTeam, SoccerGoal>
  /** Tile de nascimento de cada time (o meio do próprio campo). */
  bases: Record<ArenaTeam, { x: number; y: number }>
}

function buildField(): SoccerField {
  const T = SOCCER_TILE
  const left = SOCCER_WALL_TILES * T
  const right = (SOCCER_MAP_WIDTH - SOCCER_WALL_TILES) * T
  const top = SOCCER_WALL_TILES * T
  const bottom = (SOCCER_MAP_HEIGHT - SOCCER_WALL_TILES) * T
  const centerX = (SOCCER_MAP_WIDTH * T) / 2
  const centerY = (SOCCER_MAP_HEIGHT * T) / 2

  // A rede encosta no muro; a boca fica a `SOCCER_GOAL_COLS` tiles dele.
  const oesteNetX = SOCCER_WALL_TILES
  const lesteNetX = SOCCER_MAP_WIDTH - SOCCER_WALL_TILES - SOCCER_GOAL_COLS
  const netY = Math.round(centerY / T) - Math.floor(SOCCER_GOAL_ROWS / 2)
  const mouthTop = netY * T
  const mouthBottom = (netY + SOCCER_GOAL_ROWS) * T

  // Base no meio do PRÓPRIO campo: quem renasce (ou volta de um gol) cai atrás
  // da linha do meio, como numa saída de bola.
  const baseTileX = Math.round(SOCCER_MAP_WIDTH / 4)
  const baseTileY = Math.round(centerY / T)

  return {
    left,
    right,
    top,
    bottom,
    centerX,
    centerY,
    circleRadius: 5 * T,
    penaltyDepth: 8 * T,
    penaltyHeight: 17 * T,
    goalAreaDepth: 3 * T,
    goalAreaHeight: 9 * T,
    penaltySpot: 5 * T,
    goals: {
      oeste: {
        line: (oesteNetX + SOCCER_GOAL_COLS) * T,
        top: mouthTop,
        bottom: mouthBottom,
        inside: -1,
        netTileX: oesteNetX,
        netTileY: netY,
      },
      leste: {
        line: lesteNetX * T,
        top: mouthTop,
        bottom: mouthBottom,
        inside: 1,
        netTileX: lesteNetX,
        netTileY: netY,
      },
    },
    bases: {
      oeste: { x: baseTileX, y: baseTileY },
      leste: { x: SOCCER_MAP_WIDTH - 1 - baseTileX, y: baseTileY },
    },
  }
}

/** A geometria do campo. Constante: mesmo campo no servidor e no cliente. */
export const SOCCER_FIELD: SoccerField = buildField()

/** Gols para vencer. Baixo: partida de dez minutos no meio do expediente. */
export const ARENA_SOCCER_SCORE_LIMIT = 5

/**
 * Quanto tempo a bola fica travada no centro depois de um gol.
 *
 * É prazo, não fase da partida: `phase` continua `jogando`, e o que muda é só
 * um instante guardado (`ballLockedUntil`) — mesmo desenho da bandeira caída,
 * que também é prazo e não timer agendado. E ninguém perde o teclado durante a
 * comemoração: congelar todo mundo por três segundos é pausa que só um replay
 * justificaria.
 */
export const ARENA_SOCCER_KICKOFF_MS = 3_000

/**
 * Que time PONTUOU com a bola nesta posição, ou `null` se ainda não foi gol.
 *
 * Mede o centro da bola contra a boca do gol: cruzar entre as traves é gol, e
 * é assim que a regra de verdade também mede.
 */
export function soccerGoalScored(
  ball: Pick<BodyBallState, 'x' | 'y'>,
  field: SoccerField = SOCCER_FIELD,
): ArenaTeam | null {
  for (const defende of ARENA_TEAMS) {
    const goal = field.goals[defende]
    if (ball.y < goal.top || ball.y > goal.bottom) continue
    const cruzou = goal.inside < 0 ? ball.x <= goal.line : ball.x >= goal.line
    // Quem defende o gol cruzado NÃO pontua: o ponto é do outro.
    if (cruzou) return ARENA_TEAMS[0] === defende ? ARENA_TEAMS[1] : ARENA_TEAMS[0]
  }
  return null
}

/** Onde a bola volta na saída: o meio do campo. */
export function soccerKickoffSpot(field: SoccerField = SOCCER_FIELD): { x: number; y: number } {
  return { x: field.centerX, y: field.centerY }
}

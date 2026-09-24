import { ARENA_FLAG_SCORE_LIMIT } from './arena-flag'
import { ARENA_SOCCER_SCORE_LIMIT } from './arena-soccer'

/**
 * Partida da arena: times, pontuação, abate e renascimento.
 *
 * As REGRAS moram aqui, puras e testáveis fora do servidor — mesma escolha de
 * `stepBody` e `fireBodyShot`. O hub cuida do relógio e do broadcast; quem
 * decide se um tiro conta é esta função, e ela pode ser exercitada sem socket,
 * sem banco e sem navegador.
 */

/**
 * Dois times, nomeados pelas bases do mapa. O campo é espelhado no eixo
 * vertical desde que foi gerado, justamente para que os dois lados sejam
 * equivalentes — mapa assimétrico dá vantagem de lado, e num modo por times
 * isso é a diferença entre jogo e sorteio.
 */
export const ARENA_TEAMS = ['oeste', 'leste'] as const
export type ArenaTeam = (typeof ARENA_TEAMS)[number]

/**
 * Cor do time. Não sai da paleta de tinta (`PAINTBALL_COLORS`) de propósito: a
 * tinta diz QUEM acertou, o time diz DE QUE LADO a pessoa está — se as duas
 * usassem a mesma paleta, uma mancha vermelha num inimigo vermelho não diria
 * nada.
 */
export const ARENA_TEAM_COLORS: Record<ArenaTeam, number> = {
  oeste: 0x4da3ff,
  leste: 0xff8a3d,
}

/**
 * Quantos tiros um personagem aguenta antes de cair.
 *
 * Paintball de verdade é um tiro e você sai — e foi assim que a arena nasceu.
 * Três muda o jogo de lugar: com um só, quem atira primeiro ganha sempre, e o
 * duelo acaba antes de virar duelo. Com três, dá para levar um tiro, recuar
 * para trás de um carro e responder — que é o que a cobertura do mapa existe
 * para permitir.
 */
export const ARENA_MAX_HITS = 3

/**
 * Tempo sem levar tinta para recuperar UM tiro.
 *
 * Sem recuperação, quem levasse dois tiros ficaria frágil pelo resto da
 * partida e a única saída seria morrer para zerar — o incentivo vira jogar mal
 * de propósito. Com ela, recuar e esperar é uma jogada legítima, e é o que dá
 * função ao mapa ter esconderijo.
 */
export const ARENA_HIT_RECOVERY_MS = 6_000

/** Quanto tempo alguém fica fora depois de cair. */
export const ARENA_RESPAWN_MS = 3_000

/**
 * Carência ao renascer. Sem ela, quem espera na base do adversário abate a
 * pessoa no quadro em que ela volta, e o jogo vira fila de execução.
 */
export const ARENA_SPAWN_PROTECTION_MS = 1_500

/** Pontos para vencer. Alcançado antes do tempo, a partida acaba na hora. */
export const ARENA_SCORE_LIMIT = 25

/** Duração de uma partida. */
export const ARENA_MATCH_MS = 5 * 60 * 1000

/** Intervalo entre o fim de uma partida e o começo da seguinte. */
export const ARENA_INTERMISSION_MS = 12_000

export type ArenaMatchPhase = 'jogando' | 'intervalo'

/**
 * Os modos. A escolha é da INSTÂNCIA da arena (vem no `arenaId`), não de um
 * voto em partida: com a arena já aberta, trocar de modo no meio zeraria o
 * jogo de quem está dentro.
 */
export const ARENA_MODES = ['mata-mata', 'bandeira', 'futebol', 'corrida'] as const
export type ArenaMode = (typeof ARENA_MODES)[number]

export function isArenaMode(value: unknown): value is ArenaMode {
  return (ARENA_MODES as readonly unknown[]).includes(value)
}

/** Rótulo curto para a tela. */
export const ARENA_MODE_LABELS: Record<ArenaMode, string> = {
  'mata-mata': 'Mata-mata',
  bandeira: 'Pegue a bandeira',
  futebol: 'Futebol',
  corrida: 'Corrida de kart',
}

/**
 * Se o modo é de tiro. Futebol e corrida não são — e a pergunta é do SERVIDOR
 * antes de ser da tela: esconder o botão de atirar deixaria um cliente
 * adulterado atirando num modo que não tem nenhuma defesa contra isso (sem
 * vida, sem abate, sem carência).
 */
export function modeHasShooting(mode: ArenaMode): boolean {
  return mode !== 'futebol' && mode !== 'corrida'
}

/**
 * Se o modo é a corrida.
 *
 * Vale a função em vez do `===` espalhado porque a corrida é o primeiro modo que
 * NÃO usa o placar de time: quem pergunta são o hub (para trocar o passo, o
 * spawn e o fim de partida), o contrato (para mandar `race` no snapshot) e a
 * cena (para desenhar kart em vez de pedestre).
 */
export function modeIsRace(mode: ArenaMode): boolean {
  return mode === 'corrida'
}

export interface ArenaMatchState {
  mode: ArenaMode
  phase: ArenaMatchPhase
  scores: Record<ArenaTeam, number>
  /** Quanto falta da fase atual, em ms. Nunca instante absoluto: o cliente
   *  conta a partir do que recebe, sem depender de relógio sincronizado. */
  remainingMs: number
  /** Vencedor da partida que acabou, durante o intervalo. `null` = empate. */
  winner?: ArenaTeam | null
  /**
   * Pódio da corrida que acabou, em ordem de chegada (ids), durante o intervalo.
   *
   * Campo próprio em vez de reaproveitar `winner` porque a corrida é individual:
   * o vencedor é uma PESSOA, e quem chegou em 2º e 3º também importa. `winner`
   * continua sendo do time, e na corrida vem sempre `null`.
   */
  podium?: string[]
}

/** Quem está em campo, do ponto de vista das regras. */
export interface ArenaCombatant {
  userId: string
  team: ArenaTeam
  /** Instante em que volta a jogar; `0` = está em campo. */
  downedUntil: number
  /** Instante até o qual não pode ser atingido (carência de renascimento). */
  protectedUntil: number
  /** Tiros acumulados, antes de aplicar a recuperação pelo tempo. */
  hits: number
  /** Quando levou o último tiro — base da recuperação. */
  lastHitAt: number
}

/**
 * Tiros que ainda contam AGORA, descontando a recuperação.
 *
 * Derivado do tempo em vez de zerado por um timer: um `setTimeout` por
 * jogador seria estado agendado para algo que só importa quando alguém atira
 * — mesma escolha das marcas de tinta e das bandeiras caídas.
 */
export function hitsAfterRecovery(hits: number, lastHitAt: number, now: number): number {
  if (hits <= 0) return 0
  const recuperados = Math.floor(Math.max(0, now - lastHitAt) / ARENA_HIT_RECOVERY_MS)
  return Math.max(0, hits - recuperados)
}

/** O que um tiro que CONTA provoca em quem levou. */
export interface ArenaHitOutcome {
  /** Tiros acumulados depois deste. */
  hits: number
  /** Encheu: a pessoa cai. */
  downed: boolean
}

/**
 * Aplica um tiro já validado por `arenaHitRefusal`.
 *
 * Separado da recusa de propósito: uma coisa é decidir se o tiro conta (time,
 * carência, fase), outra é o que ele faz. Misturar as duas deixaria o teste de
 * "fogo amigo não conta" preso à contagem de vida.
 */
export function applyArenaHit(target: ArenaCombatant, now: number): ArenaHitOutcome {
  const hits = hitsAfterRecovery(target.hits, target.lastHitAt, now) + 1
  return { hits, downed: hits >= ARENA_MAX_HITS }
}

/**
 * Time de quem entra agora: o que tiver menos gente, e o primeiro da lista no
 * empate.
 *
 * Determinístico de propósito — sortear time deixaria duas pessoas que entram
 * juntas caírem no mesmo lado com frequência incômoda, e ninguém entende por
 * quê.
 */
export function balanceTeam(counts: Record<ArenaTeam, number>): ArenaTeam {
  return ARENA_TEAMS.reduce((menor, time) => (counts[time] < counts[menor] ? time : menor))
}

/** Motivo pelo qual um tiro não conta. `null` = conta. */
export type ArenaHitRefusal = 'mesmo-time' | 'ja-abatido' | 'protegido' | 'fora-de-jogo'

/**
 * Se um acerto vale ponto e abate.
 *
 * **Fogo amigo não conta.** Num jogo de escritório, punir quem passou na
 * frente do colega transforma equipe em armadilha — e a alternativa (abater
 * sem pontuar) é pior ainda, porque castiga o time inteiro por um acidente.
 */
export function arenaHitRefusal(
  shooter: ArenaCombatant | undefined,
  target: ArenaCombatant | undefined,
  now: number,
  phase: ArenaMatchPhase,
): ArenaHitRefusal | null {
  if (!shooter || !target) return 'fora-de-jogo'
  if (phase !== 'jogando') return 'fora-de-jogo'
  if (shooter.team === target.team) return 'mesmo-time'
  if (target.downedUntil > now) return 'ja-abatido'
  if (target.protectedUntil > now) return 'protegido'
  return null
}

/** Se a partida deve terminar agora. */
/** Pontos para vencer, por modo. Bandeira e futebol são mais lentos, então
 *  pontuam menos. */
export function scoreLimitFor(mode: ArenaMode): number {
  if (mode === 'bandeira') return ARENA_FLAG_SCORE_LIMIT
  if (mode === 'futebol') return ARENA_SOCCER_SCORE_LIMIT
  // A corrida não pontua por time: `scores` fica zerado e o fim dela é decidido
  // pelas VOLTAS, no hub. Um limite finito aqui encerraria a partida no zero a
  // zero — `Infinity` diz "este modo não acaba por placar", que é a verdade.
  if (mode === 'corrida') return Infinity
  return ARENA_SCORE_LIMIT
}

export function matchIsOver(
  state: Pick<ArenaMatchState, 'scores' | 'remainingMs'> & { mode?: ArenaMode },
): boolean {
  const limite = scoreLimitFor(state.mode ?? 'mata-mata')
  return state.remainingMs <= 0 || ARENA_TEAMS.some((time) => state.scores[time] >= limite)
}

/** Vencedor pela pontuação, ou `null` no empate. */
export function matchWinner(scores: Record<ArenaTeam, number>): ArenaTeam | null {
  const [a, b] = ARENA_TEAMS
  if (scores[a] === scores[b]) return null
  return scores[a] > scores[b] ? a : b
}

/** Placar zerado — começo de partida. */
export function emptyScores(): Record<ArenaTeam, number> {
  return { oeste: 0, leste: 0 }
}

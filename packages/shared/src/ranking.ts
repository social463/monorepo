import type { PublicUser } from './auth'
import type { XpEvent, XpLevelInfo } from './xp'

/**
 * Ranking de engajamento — a leitura pública do XP que já existe.
 *
 * Nada de livro-razão novo: a pontuação daqui é a MESMA soma de `XpTransaction`
 * que alimenta o nível no card de perfil (`getXpPoints`). Materializar um
 * "total de pontos" só para o ranking criaria uma segunda verdade que sairia do
 * lugar no primeiro estorno.
 *
 * O recorte é **acumulado de sempre**, e não do mês: nível e ranking precisam
 * contar a mesma história — quem é Ouro no perfil não pode aparecer atrás de um
 * Bronze no ranking porque o mês virou.
 */

/**
 * Por quanto tempo depois do último sinal a pessoa ainda conta como on-line.
 *
 * Cinco minutos porque o heartbeat do front bate a cada dois: dá margem para uma
 * batida perdida (aba em segundo plano, rede oscilando) sem apagar a bolinha de
 * quem está ali. Janela mais curta pisca; mais longa mostra verde para quem já
 * fechou o navegador.
 */
export const PRESENCE_ONLINE_WINDOW_MINUTES = 5

/** De quanto em quanto tempo o front avisa que continua ali (ver `PRESENCE_ONLINE_WINDOW_MINUTES`). */
export const PRESENCE_HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000

/** Quantas pessoas o bloco da Home mostra. */
export const RANKING_TOP_LIMIT = 5

/**
 * Teto de linhas que a API devolve de uma vez. O mesmo do protótipo: a tela
 * pagina no cliente e ninguém rola até a milésima posição.
 */
export const RANKING_MAX_ENTRIES = 200

/** Opções do seletor de linhas por página da tela de ranking. */
export const RANKING_PAGE_SIZES = [10, 25, 50, 100] as const

export interface RankingEntryDTO {
  /** 1-based, já com empate resolvido pela ordenação do servidor. */
  position: number
  user: PublicUser
  points: number
  /** Derivado de `points` no servidor, para a tela não repetir `computeLevel`. */
  level: XpLevelInfo
  /** Visto na plataforma nos últimos `PRESENCE_ONLINE_WINDOW_MINUTES` minutos. */
  online: boolean
}

export interface RankingResponse {
  entries: RankingEntryDTO[]
  /** Participantes considerados no ranking inteiro — pode ser maior que `entries.length`. */
  total: number
  /** Posição e pontos de quem pediu; null para quem não participa (admin, terceirizado fora do recorte). */
  me: { position: number; points: number } | null
}

/**
 * Ranking de consistência: dias ÚTEIS seguidos com humor registrado.
 *
 * Mesma métrica do indicador de streak que já aparece na barra superior — e por
 * isso mesmo sem coluna nova: os dois saem de `MoodEntry`.
 */
export interface StreakRankingEntryDTO {
  position: number
  user: PublicUser
  currentStreak: number
  bestStreak: number
  online: boolean
}

export interface StreakRankingResponse {
  entries: StreakRankingEntryDTO[]
  total: number
  me: { position: number; currentStreak: number } | null
}

// ---------------------------------------------------------------------------
// Visão do admin
//
// Não confundir com `EngagementOverviewDTO` de `people-analytics.ts`: aquele é
// humor, alcance do mural e telas mais vistas. Este é a economia de XP — quanto
// se distribuiu, por qual evento, para quem, e quem ficou de fora.
// ---------------------------------------------------------------------------

export interface RankingSectorRowDTO {
  sectorId: string
  sectorName: string
  /** Pessoas do setor no recorte do ranking. */
  people: number
  /** Quantas delas já pontuaram alguma vez. */
  scored: number
  points: number
  /** Média por pessoa do setor (inclusive quem tem zero), arredondada. */
  averagePoints: number
}

export interface RankingEventRowDTO {
  event: XpEvent
  /** XP distribuído por este evento, acumulado. */
  points: number
  /** Quantos créditos (linhas do livro-razão). */
  credits: number
  /** Quantas pessoas distintas receberam por ele. */
  people: number
}

/** Alguém que está fora do jogo: sem nenhum crédito no mês corrente. */
export interface RankingIdlePersonDTO {
  user: PublicUser
  /** Acumulado de sempre — pode ser > 0 mesmo quem não pontuou no mês. */
  points: number
  /** Último crédito recebido (ISO); null para quem nunca pontuou. */
  lastPointAt: string | null
}

export interface RankingOverviewDTO {
  /** Mês de referência da adesão, AAAA-MM em America/Sao_Paulo. */
  monthRef: string
  /** Pessoas no recorte do ranking. */
  people: number
  /** Quantas já pontuaram alguma vez. */
  scored: number
  /** Quantas pontuaram no mês de referência. */
  activeThisMonth: number
  /** XP distribuído desde sempre. */
  totalPoints: number
  /** XP distribuído no mês de referência. */
  pointsThisMonth: number
  byEvent: RankingEventRowDTO[]
  bySector: RankingSectorRowDTO[]
  /** Quem não pontuou no mês, do maior acumulado para o menor. */
  idle: RankingIdlePersonDTO[]
  /** As primeiras posições, para o admin ver o pódio sem sair da tela. */
  top: RankingEntryDTO[]
}

export interface RankingOverviewResponse {
  overview: RankingOverviewDTO
}

/** Quantas pessoas ociosas a visão do admin lista. */
export const RANKING_IDLE_LIMIT = 20

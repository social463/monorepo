/**
 * Voz e vídeo da arena — salas LiveKit e alcance da voz.
 *
 * Separado de `office-media.ts` pelo mesmo motivo que o contrato do socket é
 * separado: o escritório mede em TILE e resolve a sala pela zona do mapa; a
 * arena mede em PIXEL e tem uma sala por instância (o modo). O que os dois
 * compartilham de verdade é o grafo de áudio (ganho + pan por distância), que
 * já vive em `spatialAudio.ts` no front e fala em tiles.
 */

/** Identificador da instância de bate-papo de quem ainda está no menu. */
export const ARENA_LOBBY_ID = 'lobby';

/**
 * Raio de queda da voz na arena, em TILES.
 *
 * Bem maior que o `PROXIMITY_RADIUS` do escritório (3) de propósito: lá o raio
 * é de conversa de mesa, e o mapa inteiro tem 30 tiles de largura; aqui o mapa
 * tem 121×85 e a câmera sozinha já mostra ~20 tiles. Com 3 tiles, dois
 * jogadores que se veem na tela ficariam mudos um para o outro — e voz que só
 * funciona no abraço não serve para combinar jogada.
 */
export const ARENA_VOICE_RADIUS_TILES = 12;

/**
 * Raio de ASSINATURA, maior que o da voz: assinar é caro e demora (renegociação
 * WebRTC), então quem chega no limite do alcance precisa já estar assinado para
 * a primeira sílaba não sumir. A margem também evita o liga-desliga de quem
 * anda em cima da fronteira.
 */
export const ARENA_VOICE_SUBSCRIBE_RADIUS_TILES = ARENA_VOICE_RADIUS_TILES * 1.5;

/**
 * Sala LiveKit de uma arena. O `companyId` entra no nome porque `arenaId` é o
 * MODO (`mata-mata`, `bandeira`, `lobby`) — igual em todo tenant — e a
 * instância do LiveKit é compartilhada: sem ele, duas empresas cairiam na
 * mesma sala de voz.
 */
export function arenaMediaRoom(companyId: string, arenaId: string): string {
  return `arena-${companyId}-${arenaId}`;
}

export interface ArenaMediaTokenRequest {
  /** O modo em que a pessoa está, ou `ARENA_LOBBY_ID` para o saguão. */
  arenaId: string;
}

export interface ArenaMediaTokenResponse {
  token: string;
  url: string;
  /** Nome da sala concedida — o cliente não o calcula (não conhece o `companyId`). */
  room: string;
}

/** Está dentro do alcance de assinatura? `dx`/`dy` em tiles. */
export function isWithinArenaVoiceRange(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) <= ARENA_VOICE_SUBSCRIBE_RADIUS_TILES;
}

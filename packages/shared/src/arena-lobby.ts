import type { CharacterOptions } from './character';

/**
 * Saguão da arena — quem está no MENU, antes de escolher o modo.
 *
 * É um contrato próprio, e não um modo do `ArenaHub`, porque aqui não há
 * simulação nenhuma: sem posição, sem tick, sem partida. O saguão é presença e
 * conversa — o que faz o menu deixar de ser uma tela de espera solitária e
 * virar o lugar onde se combina o que jogar.
 *
 * A voz do saguão, por isso mesmo, NÃO é espacial: sem posição não há
 * distância, e todo mundo que está ali se ouve por igual.
 */

/** Quem está no saguão. Efêmero, como toda presença destes hubs. */
export interface ArenaLobbyMember {
  userId: string;
  name: string;
  photoUrl?: string | null;
  avatarSeed?: string | null;
  avatarOptions?: CharacterOptions | null;
}

export interface ArenaLobbyChatMessage {
  userId: string;
  name: string;
  text: string;
  sentAt: string;
}

export type ArenaLobbyClientMessage =
  /** Mensagem de texto para todos no saguão. */
  | { type: 'chat'; text: string };

export type ArenaLobbyServerMessage =
  | { type: 'welcome'; youId: string; members: ArenaLobbyMember[] }
  | { type: 'joined'; member: ArenaLobbyMember }
  | { type: 'left'; userId: string }
  /**
   * Retransmitida para todos MENOS quem escreveu — como no chat de sala do
   * escritório, quem escreve já viu a própria mensagem localmente.
   */
  | ({ type: 'chat' } & ArenaLobbyChatMessage);

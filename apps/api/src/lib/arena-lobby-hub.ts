import {
  ROOM_CHAT_MESSAGE_MAX_LENGTH,
  type ArenaLobbyMember,
  type ArenaLobbyServerMessage,
} from '@legends/shared'

export interface ArenaLobbySocket {
  send(data: string): void
}

/**
 * Saguão da arena — quem está no menu, antes de escolher o modo.
 *
 * Deliberadamente burro em comparação com o `ArenaHub`: presença e chat, sem
 * tick, sem simulação, sem partida. Um hub por empresa, criado no primeiro que
 * entra e descartado quando esvazia — arena vazia não custa nada, e saguão
 * vazio também não.
 */
export class ArenaLobbyHub {
  private entries = new Map<string, { member: ArenaLobbyMember; sockets: Set<ArenaLobbySocket> }>()
  private socketOwner = new Map<ArenaLobbySocket, string>()

  join(socket: ArenaLobbySocket, member: ArenaLobbyMember): void {
    this.socketOwner.set(socket, member.userId)
    const existing = this.entries.get(member.userId)
    if (existing) {
      // Outra aba da mesma pessoa entra na MESMA presença, como no escritório.
      existing.sockets.add(socket)
    } else {
      this.entries.set(member.userId, { member, sockets: new Set([socket]) })
      this.broadcast({ type: 'joined', member }, member.userId)
    }
    this.sendTo(socket, { type: 'welcome', youId: member.userId, members: this.members() })
  }

  leave(socket: ArenaLobbySocket, userId: string): void {
    if (this.socketOwner.get(socket) !== userId) return
    this.socketOwner.delete(socket)
    const entry = this.entries.get(userId)
    if (!entry) return
    entry.sockets.delete(socket)
    if (entry.sockets.size > 0) return
    this.entries.delete(userId)
    this.broadcast({ type: 'left', userId })
  }

  chat(socket: ArenaLobbySocket, userId: string, text: string): void {
    if (this.socketOwner.get(socket) !== userId) return
    const entry = this.entries.get(userId)
    if (!entry) return
    const trimmed = text.trim().slice(0, ROOM_CHAT_MESSAGE_MAX_LENGTH)
    if (!trimmed) return
    this.broadcast(
      {
        type: 'chat',
        userId,
        name: entry.member.name,
        text: trimmed,
        sentAt: new Date().toISOString(),
      },
      userId,
    )
  }

  members(): ArenaLobbyMember[] {
    return [...this.entries.values()].map((entry) => ({ ...entry.member }))
  }

  /**
   * Autoriza o token do LiveKit do saguão — a presença é a credencial, e o
   * nome vai junto porque o access token não o carrega (ver `ArenaHub.nameOf`).
   */
  nameOf(userId: string): string | null {
    return this.entries.get(userId)?.member.name ?? null
  }

  size(): number {
    return this.entries.size
  }

  private sendTo(socket: ArenaLobbySocket, message: ArenaLobbyServerMessage): void {
    socket.send(JSON.stringify(message))
  }

  private broadcast(message: ArenaLobbyServerMessage, exceptUserId?: string): void {
    const payload = JSON.stringify(message)
    for (const [userId, entry] of this.entries) {
      if (userId === exceptUserId) continue
      for (const socket of entry.sockets) socket.send(payload)
    }
  }
}

const lobbies = new Map<string, ArenaLobbyHub>()

/** Uma instância por empresa, no molde de `getArenaHub`. */
export function getArenaLobbyHub(companyId: string): ArenaLobbyHub {
  let hub = lobbies.get(companyId)
  if (!hub) {
    hub = new ArenaLobbyHub()
    lobbies.set(companyId, hub)
  }
  return hub
}

/** Só para teste: zera o registry entre casos. */
export function __resetArenaLobbyHubs(): void {
  lobbies.clear()
}

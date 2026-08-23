export interface RetroSocket {
  send(data: string): void
}

export interface RetroConnection {
  socket: RetroSocket
  userId: string
  name: string
}

/**
 * Registro em memória de conexões WebSocket por sala. Postgres é a fonte da
 * verdade; o hub só faz fan-out. Preso a uma instância (ver spec: Redis é futuro).
 */
export class RetroHub {
  private rooms = new Map<string, Set<RetroConnection>>()
  private locks = new Map<string, Map<string, { userId: string; name: string }>>()

  subscribe(roomId: string, conn: RetroConnection): void {
    let set = this.rooms.get(roomId)
    if (!set) {
      set = new Set()
      this.rooms.set(roomId, set)
    }
    set.add(conn)
  }

  unsubscribe(roomId: string, conn: RetroConnection): void {
    const set = this.rooms.get(roomId)
    if (!set) return
    set.delete(conn)
    if (set.size === 0) {
      this.rooms.delete(roomId)
      this.locks.delete(roomId)
    }
  }

  presentUserIds(roomId: string): string[] {
    const set = this.rooms.get(roomId)
    if (!set) return []
    return [...new Set([...set].map((c) => c.userId))]
  }

  /**
   * Envia a cada conexão da sala o payload produzido por `build(viewerId)`.
   * Quando `build` retorna `null`, aquela conexão é pulada (respeita
   * anonimato/visibilidade por usuário).
   */
  broadcast(roomId: string, build: (viewerId: string) => unknown | null): void {
    const set = this.rooms.get(roomId)
    if (!set) return
    for (const conn of set) {
      const payload = build(conn.userId)
      if (payload == null) continue
      try {
        conn.socket.send(JSON.stringify(payload))
      } catch {
        // conexão morta: será limpa no close handler
      }
    }
  }

  private roomLocks(roomId: string): Map<string, { userId: string; name: string }> {
    let m = this.locks.get(roomId)
    if (!m) {
      m = new Map()
      this.locks.set(roomId, m)
    }
    return m
  }

  /** Adquire o lock se livre ou já é do próprio usuário. Retorna false se está com outro. */
  grabCard(roomId: string, cardId: string, userId: string, name: string): boolean {
    const m = this.roomLocks(roomId)
    const cur = m.get(cardId)
    if (cur && cur.userId !== userId) return false
    m.set(cardId, { userId, name })
    return true
  }

  /** Libera o lock se for do usuário. Retorna true se liberou. */
  dropCard(roomId: string, cardId: string, userId: string): boolean {
    const m = this.locks.get(roomId)
    const cur = m?.get(cardId)
    if (m && cur && cur.userId === userId) {
      m.delete(cardId)
      return true
    }
    return false
  }

  lockOwner(roomId: string, cardId: string): { userId: string; name: string } | undefined {
    return this.locks.get(roomId)?.get(cardId)
  }

  /** Libera todos os locks do usuário na sala (ex.: no disconnect). Retorna os cardIds liberados. */
  releaseLocksHeldBy(roomId: string, userId: string): string[] {
    const m = this.locks.get(roomId)
    if (!m) return []
    const freed: string[] = []
    for (const [cardId, owner] of m) {
      if (owner.userId === userId) {
        m.delete(cardId)
        freed.push(cardId)
      }
    }
    return freed
  }
}

export const retroHub = new RetroHub()

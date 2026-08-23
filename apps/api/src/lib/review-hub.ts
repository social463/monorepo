import type { ReviewEvent } from '@legends/shared'

export interface ReviewSocket {
  send(data: string): void
}

export interface ReviewConnection {
  socket: ReviewSocket
}

/**
 * Registro em memória das conexões WebSocket do feed de resenha. Canal único
 * e global (sem salas): qualquer evento vai para todas as conexões abertas.
 * Postgres é a fonte da verdade; o hub só faz fan-out. Preso a uma instância
 * (Redis/multi-instância fica como futuro, igual ao retro).
 */
export class ReviewHub {
  private conns = new Set<ReviewConnection>()

  subscribe(conn: ReviewConnection): void {
    this.conns.add(conn)
  }

  unsubscribe(conn: ReviewConnection): void {
    this.conns.delete(conn)
  }

  size(): number {
    return this.conns.size
  }

  broadcast(event: ReviewEvent): void {
    const payload = JSON.stringify(event)
    for (const conn of this.conns) {
      try {
        conn.socket.send(payload)
      } catch {
        // conexão morta: será limpa no close handler da rota
      }
    }
  }
}

export const reviewHub = new ReviewHub()

import type { CorporateMuralEvent } from '@legends/shared'

export interface CorporateMuralSocket {
  send(data: string): void
}

export interface CorporateMuralConnection {
  socket: CorporateMuralSocket
}

/**
 * Registro em memória das conexões WebSocket do mural corporativo. Canal único
 * e global (sem salas) — o mural é da empresa inteira, então todo evento
 * interessa a todas as conexões abertas. Postgres é a fonte da verdade; o hub
 * só faz fan-out. Preso a uma instância, igual ao hub da resenha.
 */
export class CorporateMuralHub {
  private conns = new Set<CorporateMuralConnection>()

  subscribe(conn: CorporateMuralConnection): void {
    this.conns.add(conn)
  }

  unsubscribe(conn: CorporateMuralConnection): void {
    this.conns.delete(conn)
  }

  size(): number {
    return this.conns.size
  }

  broadcast(event: CorporateMuralEvent): void {
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

export const corporateMuralHub = new CorporateMuralHub()

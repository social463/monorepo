import type { OneOnOneEvent } from '@legends/shared'

export interface OneOnOneSocket {
  send(data: string): void
}

export interface OneOnOneConnection {
  socket: OneOnOneSocket
  /** Dono da conexão. É a chave do canal: cada pessoa só recebe o que é dela. */
  userId: string
}

/**
 * Registro em memória das conexões WebSocket do 1:1.
 *
 * Diferente da resenha e do mural (canal único e global) e da retro (canal por
 * SALA), aqui o canal é por **pessoa**. O 1:1 é uma conversa fechada entre dois:
 * uma sala por encontro não serviria, porque um combinado em aberto pertence ao
 * par e aparece em todos os encontros dele — e a lista `/1-1` não tem encontro
 * nenhum em mãos para entrar numa sala. Endereçar por pessoa resolve as duas
 * telas com uma conexão só e, principalmente, torna vazamento impossível: o
 * servidor escolhe explicitamente os dois destinatários de cada evento.
 *
 * Postgres continua sendo a fonte da verdade — o hub só faz fan-out de avisos
 * magros, e cada cliente reconsulta com as permissões dele. Preso a uma
 * instância (Redis/multi-instância fica como futuro, igual ao retro).
 */
export class OneOnOneHub {
  private byUser = new Map<string, Set<OneOnOneConnection>>()

  subscribe(conn: OneOnOneConnection): void {
    const atual = this.byUser.get(conn.userId)
    if (atual) atual.add(conn)
    else this.byUser.set(conn.userId, new Set([conn]))
  }

  unsubscribe(conn: OneOnOneConnection): void {
    const atual = this.byUser.get(conn.userId)
    if (!atual) return
    atual.delete(conn)
    // Sem o delete do Map, uma empresa grande deixaria um Set vazio por pessoa
    // que já usou a tela — memória que nunca mais é liberada.
    if (atual.size === 0) this.byUser.delete(conn.userId)
  }

  size(): number {
    let total = 0
    for (const conns of this.byUser.values()) total += conns.size
    return total
  }

  connectionsOf(userId: string): number {
    return this.byUser.get(userId)?.size ?? 0
  }

  /**
   * Empurra o evento para as pessoas indicadas. Ids repetidos são ignorados —
   * um 1:1 tem duas pessoas distintas, mas quem chama passa o par cru e não
   * deveria precisar saber disso.
   */
  emit(userIds: readonly string[], event: OneOnOneEvent): void {
    const payload = JSON.stringify(event)
    for (const userId of new Set(userIds)) {
      for (const conn of this.byUser.get(userId) ?? []) {
        try {
          conn.socket.send(payload)
        } catch {
          // conexão morta: será limpa no close handler da rota
        }
      }
    }
  }
}

export const oneOnOneHub = new OneOnOneHub()

import { BODY_INTERP_MS, type ArenaSnapshotPlayer, type Direction } from '@legends/shared'

interface Sample {
  at: number
  x: number
  y: number
  dir: Direction
  /** Rumo do kart, em radianos. Ausente fora da corrida. */
  heading?: number
}

/**
 * Interpola ângulo pelo ARCO CURTO.
 *
 * Interpolar linear é o bug clássico do rumo: entre `3,10` e `−3,10` rad — dois
 * rumos praticamente idênticos, com o zero no meio — a média linear passa por
 * todos os valores intermediários e o kart dá uma pirueta de 355° na tela. Aqui,
 * a diferença é trazida para (−π, π] antes de ser somada.
 */
function lerpAngle(from: number, to: number, t: number): number {
  const volta = Math.PI * 2
  let diferenca = (to - from) % volta
  if (diferenca > Math.PI) diferenca -= volta
  if (diferenca < -Math.PI) diferenca += volta
  return from + diferenca * t
}

/**
 * Buffer de interpolação dos OUTROS jogadores.
 *
 * O servidor manda 20 snapshots por segundo. Desenhar cada um assim que chega
 * faz os outros andarem aos solavancos (20 posições por segundo, com o jitter
 * da rede por cima). A solução padrão é desenhá-los um pouco NO PASSADO —
 * `BODY_INTERP_MS` atrás —, sempre entre dois snapshots já recebidos, o que
 * transforma pacotes discretos em movimento contínuo.
 *
 * O custo é ver os outros ~100ms atrasados. É o preço deste modelo, e é
 * invisível para quem joga: quem precisa de resposta imediata é o próprio
 * personagem, e esse não passa por aqui (ver `ArenaPredictor`).
 */
export class ArenaInterpolator {
  private samples = new Map<string, Sample[]>()

  /** Guarda o snapshot com o instante de chegada (relógio local, sempre coerente consigo). */
  push(players: readonly ArenaSnapshotPlayer[], now: number): void {
    const seen = new Set<string>()
    for (const player of players) {
      seen.add(player.userId)
      const list = this.samples.get(player.userId) ?? []
      // Snapshot fora de ordem não entra: ele faria o alvo andar para trás.
      if (list.length > 0 && now <= list[list.length - 1].at) continue
      list.push({
        at: now,
        x: player.x,
        y: player.y,
        dir: player.dir,
        ...(player.h === undefined ? {} : { heading: player.h }),
      })
      // Duas amostras bastam para interpolar; guardar mais só atrasaria a poda.
      while (list.length > 3) list.shift()
      this.samples.set(player.userId, list)
    }
    for (const userId of [...this.samples.keys()]) {
      if (!seen.has(userId)) this.samples.delete(userId)
    }
  }

  forget(userId: string): void {
    this.samples.delete(userId)
  }

  /** Onde desenhar alguém agora, ou `null` se ainda não há amostra. */
  at(userId: string, now: number): Sample | null {
    const list = this.samples.get(userId)
    if (!list || list.length === 0) return null
    const target = now - BODY_INTERP_MS
    if (list.length === 1) return list[0]

    for (let i = list.length - 1; i > 0; i -= 1) {
      const to = list[i]
      const from = list[i - 1]
      if (target >= from.at && target <= to.at) {
        const span = to.at - from.at
        const t = span <= 0 ? 1 : (target - from.at) / span
        return {
          at: target,
          x: from.x + (to.x - from.x) * t,
          y: from.y + (to.y - from.y) * t,
          // A pose não interpola: é discreta (quatro poses do LPC).
          dir: to.dir,
          // O RUMO interpola, e é o oposto da pose: ele é contínuo, e o kart
          // girando aos saltos de 20Hz é justamente o que se vê num modo em que
          // todo mundo está sempre virando.
          ...(from.heading === undefined || to.heading === undefined
            ? {}
            : { heading: lerpAngle(from.heading, to.heading, t) }),
        }
      }
    }
    // Alvo fora do intervalo coberto: ou o buffer ainda está enchendo (usa a
    // amostra mais velha) ou a rede parou (segura na mais nova, sem extrapolar
    // — extrapolar inventa movimento e depois puxa o personagem de volta).
    return target < list[0].at ? list[0] : list[list.length - 1]
  }
}

import {
  BODY_MAX_UNACKED_INPUTS,
  stepBody,
  type BodyCollisionGrid,
  type BodyInput,
  type BodyState,
  type BodyStepOptions,
} from '@legends/shared'

/**
 * O passo que este preditor reexecuta.
 *
 * Injetável porque a arena tem DOIS: o pedestre (`stepBody`) e o kart
 * (`stepBodyKart`), que carrega rumo e velocidade. O que não podia acontecer
 * era um segundo preditor: duas implementações de reconciliação divergem
 * sempre, e a lógica de fila, `ack` e reexecução é a mesma nos dois casos —
 * o que muda é só a função de dentro do laço.
 */
export type ArenaStepFn<S extends BodyState> = (
  state: S,
  input: BodyInput,
  grid: BodyCollisionGrid,
) => S

/**
 * Predição e reconciliação do PRÓPRIO personagem.
 *
 * O problema: se o cliente só desenhasse o que o servidor manda, cada tecla
 * apareceria um round-trip depois — intolerável. Se o cliente andasse por
 * conta, divergiria da autoridade. A saída padrão é prever e depois corrigir:
 *
 * 1. cada input é aplicado NA HORA, localmente, e guardado;
 * 2. quando o snapshot chega, ele traz a posição autoritativa e o último `seq`
 *    que o servidor processou;
 * 3. o cliente reancora naquela posição e **reexecuta** os inputs mais novos
 *    que o `seq` — os que o servidor ainda não viu.
 *
 * O passo (1) e o (3) chamam `stepBody`, a MESMA função do servidor. É o que
 * faz a correção ser invisível no caso normal: reexecutar os pendentes sobre a
 * posição autoritativa dá exatamente onde o cliente já estava. A correção só
 * aparece quando o servidor discordou de verdade (parede, trapaça, pacote
 * perdido) — que é quando ela deve aparecer mesmo.
 */
export class ArenaPredictor<S extends BodyState = BodyState> {
  /** Inputs enviados e ainda não confirmados pelo servidor, em ordem de `seq`. */
  private pending: BodyInput[] = []
  private state: S
  private seq = 0
  /**
   * Maior `seq` já confirmado. É o que identifica snapshot atrasado — e ele
   * NÃO dá para deduzir da fila de pendentes: quando o servidor alcança o
   * cliente, a fila esvazia, e aí um pacote velho passaria direto e
   * teleportaria o personagem para o passado.
   */
  private lastAck = 0

  constructor(
    initial: S,
    private readonly grid: BodyCollisionGrid,
    options: BodyStepOptions = {},
    /**
     * O padrão é o pedestre, que é o que os três primeiros modos usam. A
     * corrida passa `stepBodyKart` fechado sobre o estado da largada.
     */
    private readonly step: ArenaStepFn<S> = ((state, input, grid) =>
      stepBody(state, input, grid, options)) as ArenaStepFn<S>,
  ) {
    this.state = initial
  }

  current(): S {
    return this.state
  }

  /**
   * Retoma a numeração de onde o servidor parou.
   *
   * Necessário onde a presença SOBREVIVE a uma queda: reconectar cria um
   * preditor novo, e começar do zero faria todo input chegar com `seq` menor
   * que o já processado — descartado como atrasado, e o personagem nunca mais
   * sai do lugar. Quem sabe o número é o servidor, e ele o manda no `welcome`.
   *
   * Só avança: um valor menor que o atual seria um convite a reprocessar input
   * já confirmado.
   */
  resumeAt(seq: number): void {
    if (seq <= this.seq) return
    this.seq = seq
    this.lastAck = seq
  }

  pendingCount(): number {
    return this.pending.length
  }

  /** A fila encheu — ninguém está confirmando (ver `BODY_MAX_UNACKED_INPUTS`). */
  isStalled(): boolean {
    return this.pending.length >= BODY_MAX_UNACKED_INPUTS
  }

  /**
   * Aplica um input localmente e devolve o pacote a mandar. O `seq` é
   * monotônico e é o que amarra input, confirmação e reexecução.
   *
   * Devolve `null` quando a fila de não confirmados estourou o teto: a essa
   * altura o servidor não está respondendo, e continuar prevendo só afasta o
   * personagem de onde ele realmente está — para voltar de teleporte quando a
   * rede retornar. Parar é mais honesto que andar em falso.
   */
  predict(dx: number, dy: number, dtMs: number, sprint = false): BodyInput | null {
    if (this.isStalled()) return null
    this.seq += 1
    const input: BodyInput = { seq: this.seq, dx, dy, dtMs, ...(sprint ? { sprint } : {}) }
    this.state = this.step(this.state, input, this.grid)
    this.pending.push(input)
    return input
  }

  /**
   * Reancora no estado autoritativo e reexecuta o que o servidor ainda não
   * processou.
   *
   * Snapshot atrasado (com `seq` menor que um já reconciliado) é ignorado:
   * aplicá-lo puxaria o personagem para trás, e a fila de pendentes dele já
   * foi descartada.
   */
  reconcile(authoritative: S, ackSeq: number): void {
    if (ackSeq < this.lastAck) return
    this.lastAck = ackSeq

    this.pending = this.pending.filter((input) => input.seq > ackSeq)
    let state = authoritative
    for (const input of this.pending) {
      state = this.step(state, input, this.grid)
    }
    this.state = state
  }
}

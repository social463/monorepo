import {
  canStepTo,
  MOVE_DIRECTION_DELTAS,
  type MapDocumentV1,
  type MoveDirection,
  type OfficeKart,
  type TilePosition,
} from '@legends/shared'

/** O que a cena deve fazer IMEDIATAMENTE com uma intenção local de movimento. */
export type PredictedAction =
  /** Tile andável: anima o passo agora (o eco `moved` só confirma). */
  | { kind: 'step'; x: number; y: number }
  /** Parede: só encara a direção — sem passo para animar. */
  | { kind: 'face' }
  /** Sem base ainda (antes do welcome): nada a prever. */
  | { kind: 'pass' }

/**
 * Tempo máximo que um passo previsto pode ficar sem eco antes de ser
 * descartado. Round-trip normal é de dezenas de milissegundos; este teto só
 * pega o que se perdeu de vez (passo descartado em silêncio pelo rate limit do
 * hub, pacote perdido). Folgado de propósito: expirar cedo demais desfaria
 * passo legítimo numa conexão ruim.
 */
export const PENDING_TIMEOUT_MS = 1500

interface PendingStep extends TilePosition {
  /** Sequência enviada ao servidor — casa o `sync` de recusa com ESTE passo. */
  seq?: number
  /** Instante da predição, para a expiração. */
  at: number
}

export interface MovementPredictorOptions {
  /**
   * Leitura VIVA do estado autoritativo dos karts (a cena é dona dele). É um
   * getter, e não uma lista copiada, justamente para não existir um ponto de
   * sincronização que dá para esquecer de chamar — a divergência entre a
   * colisão do cliente e a do servidor é o bug que este predictor causa quando
   * as duas regras saem do lugar.
   */
  karts?: () => readonly OfficeKart[]
  /** Relógio injetado (testes). */
  now?: () => number
}

/**
 * Predição de movimento do PRÓPRIO personagem — mata o round-trip entre a
 * intenção (tecla/Seguir) e o passo aparecer na tela.
 *
 * O servidor continua autoritativo: isto aqui é otimismo puramente VISUAL,
 * possível porque a regra de colisão é a mesma dos dois lados (`isMapTileWalkable`
 * sobre o MESMO `MapDocumentV1` publicado e a MESMA lista de karts) e outros
 * ocupantes não bloqueiam. Cada passo previsto entra numa fila e é baixado
 * quando o eco `moved` do servidor o confirma; um eco que não bate (passo
 * descartado pelo rate limit, outra aba andando) descarta a fila e re-ancora
 * na posição do servidor.
 *
 * `sync` com a posição já confirmada é o eco de uma batida na parede — não
 * desfaz passos ainda em voo (senão encostar na parede e sair andando faria
 * o personagem "voltar" um instante). O `seq` distingue os dois casos que a
 * posição sozinha confunde: recusa DO passo previsto (kart que chegou, sala
 * trancada) re-ancora; eco de parede que o cliente já previu como `face`, não.
 * `pruneStale` fecha o resto: o que nunca voltou não fica pendurado.
 *
 * Classe pura (sem Phaser/React), no padrão do FollowController.
 */
export class MovementPredictor {
  /** Último tile CONFIRMADO pelo servidor (welcome/moved/sync). */
  private base: TilePosition | null = null
  /** Passos previstos ainda sem eco, na ordem em que foram enviados. */
  private pending: PendingStep[] = []
  private readonly karts: () => readonly OfficeKart[]
  private readonly now: () => number

  constructor(
    private document: MapDocumentV1,
    options: MovementPredictorOptions = {},
  ) {
    this.karts = options.karts ?? (() => [])
    this.now = options.now ?? (() => Date.now())
  }

  /** Troca o documento (ex.: publicação de decoração) sem perder o estado de predição. */
  setDocument(document: MapDocumentV1): void {
    this.document = document
  }

  /** (Re)ancora no estado do servidor. `null` = desconhecido (pré-welcome). */
  reset(tile: TilePosition | null): void {
    this.base = tile ? { x: tile.x, y: tile.y } : null
    this.pending = []
  }

  /**
   * Intenção local (teclado ou Seguir). Avança a predição se o tile for
   * andável. `seq` é o identificador do move enviado ao servidor — sem ele a
   * recusa desse passo específico não tem como ser reconhecida no `sync`.
   */
  predict(move: MoveDirection, seq?: number): PredictedAction {
    if (!this.base) return { kind: 'pass' }
    const from = this.pending[this.pending.length - 1] ?? this.base
    // `canStepTo`, e não `isMapTileWalkable`: na diagonal a regra inclui as
    // duas ortogonais, e é a MESMA função que o servidor chama — divergir aqui
    // é o que produz predição recusada e o "teleporte" de re-ancoragem.
    if (!canStepTo(this.document, from, move, this.karts())) return { kind: 'face' }
    const delta = MOVE_DIRECTION_DELTAS[move]
    const x = from.x + delta.x
    const y = from.y + delta.y
    this.pending.push({ x, y, seq, at: this.now() })
    return { kind: 'step', x, y }
  }

  /**
   * Eco `moved` do próprio usuário. `true` = era o passo previsto (a cena já
   * animou; ignorar). `false` = divergiu — a cena deve animar até (x,y).
   */
  confirmMove(x: number, y: number): boolean {
    const head = this.pending[0]
    if (head && head.x === x && head.y === y) {
      this.pending.shift()
      this.base = { x, y }
      return true
    }
    this.pending = []
    this.base = { x, y }
    return false
  }

  /**
   * `sync` do servidor (move recusado). `'ignore'` = mera confirmação da
   * posição que já temos (eco de parede) — passos em voo seguem valendo.
   * `'reanchor'` = divergência real: predições descartadas, cena re-ancora.
   *
   * `seq` é o do move recusado. Se ele corresponde a um passo previsto, a
   * recusa é DAQUELE passo — descarta a fila inteira (o que veio depois foi
   * previsto em cima de uma base que o servidor nunca aceitou) e re-ancora,
   * mesmo que a posição do servidor seja igual à base atual.
   */
  confirmSync(x: number, y: number, seq?: number): 'ignore' | 'reanchor' {
    const predicted = seq !== undefined && this.pending.some((step) => step.seq === seq)
    if (!predicted && this.base && this.base.x === x && this.base.y === y) return 'ignore'
    this.pending = []
    this.base = { x, y }
    return 'reanchor'
  }

  /**
   * Rede de segurança do que se perdeu no caminho: devolve a posição em que a
   * cena deve re-ancorar quando a predição mais antiga passou do prazo sem
   * eco, ou `null` se não há nada a corrigir. Sem isto, um passo descartado em
   * silêncio pelo servidor (rate limit) deixa a tela permanentemente à frente
   * da posição autoritativa, e o erro cresce a cada passo seguinte.
   */
  pruneStale(): TilePosition | null {
    const oldest = this.pending[0]
    if (!oldest || this.now() - oldest.at <= PENDING_TIMEOUT_MS) return null
    this.pending = []
    return this.base ? { ...this.base } : null
  }
}

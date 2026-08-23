import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  OFFICE_ANNOTATION_ABANDON_MS,
  OFFICE_ANNOTATION_BATCH_MS,
  OFFICE_ANNOTATION_MAX_LIVE_STROKES,
  OFFICE_ANNOTATION_MAX_POINTS,
  OFFICE_ANNOTATION_MAX_STROKE_POINTS,
  OFFICE_ANNOTATION_STROKE_ID_MAX_LENGTH,
  OFFICE_ANNOTATION_STROKE_TTL_MS,
  type OfficeAnnotationPoint,
} from '@legends/shared'
import type { OfficeBridge } from '../OfficeBridge'
import { annotationColor } from './annotation-color'

export interface AnnotationStroke {
  strokeId: string
  userId: string
  sharerId: string
  points: OfficeAnnotationPoint[]
  color: string
  /** ms (Date.now) em que o traço terminou; `null` = ainda em andamento. */
  doneAt: number | null
  /** ms do último ponto recebido. */
  lastAt: number
}

export interface ScreenAnnotationsState {
  /** Traços vivos daquela tela, já podados por TTL. */
  strokesFor(sharerId: string): AnnotationStroke[]
  beginStroke(sharerId: string, point: OfficeAnnotationPoint): void
  extendStroke(point: OfficeAnnotationPoint): void
  endStroke(): void
}

interface LocalStroke {
  strokeId: string
  sharerId: string
  /** Pontos ainda não enviados, com o último já enviado na frente (continuidade). */
  pending: OfficeAnnotationPoint[]
}

/**
 * Chave do Map de traços vivos: userId + strokeId, não só strokeId. O
 * broadcast do hub manda o mesmo strokeId para todo mundo, então chavear só
 * por ele deixaria um cliente adulterado continuar (ou fechar) o traço de
 * outra pessoa mandando um lote com o strokeId alheio — a única garantia que
 * o servidor acrescenta (carimbar o userId do remetente) viraria decoração.
 * Com userId na chave, um lote "sequestrador" cai numa entrada PRÓPRIA, sem
 * tocar no traço original.
 */
function strokeKey(userId: string, strokeId: string): string {
  return `${userId}:${strokeId}`
}

/** Arredonda para a mesma precisão que o servidor aplica (`sanitizeAnnotationPoints`) — enviar mais casas decimais só infla o payload sem ganhar precisão visual. */
function roundPoint(point: OfficeAnnotationPoint): OfficeAnnotationPoint {
  return { x: Math.round(point.x * 1000) / 1000, y: Math.round(point.y * 1000) / 1000 }
}

/**
 * Remove do Map traços expirados: terminados há mais que o TTL de fade, ou
 * nunca terminados há mais que o teto de abandono. Compartilhada pelo laço
 * de desenho (`strokesFor`, rodando a 60fps quando a grade tem tela em
 * destaque) e pelo `upsert` (toda mensagem que chega) — sem isto, o Map só
 * era podado enquanto alguém estava olhando uma tela em destaque; no estado
 * normal (grade recolhida) ele crescia sem limite enquanto colegas riscavam.
 */
function sweep(strokes: Map<string, AnnotationStroke>, now: number): void {
  for (const [key, stroke] of strokes) {
    const expired =
      stroke.doneAt !== null
        ? now - stroke.doneAt > OFFICE_ANNOTATION_STROKE_TTL_MS
        : now - stroke.lastAt > OFFICE_ANNOTATION_ABANDON_MS
    if (expired) strokes.delete(key)
  }
}

/** Descarta o traço vivo com a atividade mais antiga — só entra em jogo quando o Map ainda está no teto de segurança mesmo depois da poda por TTL (ex.: cliente adulterado mandando muitos strokeId distintos, mais rápido do que eles expirariam). */
function evictOldest(strokes: Map<string, AnnotationStroke>): void {
  let oldestKey: string | null = null
  let oldestAt = Infinity
  for (const [key, stroke] of strokes) {
    if (stroke.lastAt < oldestAt) {
      oldestAt = stroke.lastAt
      oldestKey = key
    }
  }
  if (oldestKey !== null) strokes.delete(oldestKey)
}

/**
 * Traços vivos sobre telas compartilhadas: os que chegam pelo socket e os que
 * a própria pessoa está desenhando.
 *
 * O estado mora em ref, não em state: o canvas redesenha em rAF lendo daqui, e
 * um `setState` por ponto (dezenas por segundo) só geraria re-render inútil da
 * árvore inteira da grade. Nada persiste — traço terminado morre no TTL, e
 * quem entra no meio simplesmente não vê o que já passou.
 */
export function useScreenAnnotations(
  bridge: OfficeBridge,
  youId: string | null,
): ScreenAnnotationsState {
  const strokesRef = useRef<Map<string, AnnotationStroke>>(new Map())
  const localRef = useRef<LocalStroke | null>(null)
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const youIdRef = useRef(youId)
  youIdRef.current = youId

  const upsert = useCallback(
    (
      userId: string,
      sharerId: string,
      strokeId: string,
      points: OfficeAnnotationPoint[],
      done: boolean,
    ) => {
      const now = Date.now()
      const strokes = strokesRef.current
      const key = strokeKey(userId, strokeId)
      const existing = strokes.get(key)
      if (existing) {
        // Teto de pontos por traço: um strokeId que nunca recebe `done`
        // (quem desenhava caiu) não pode crescer para sempre — o rAF do
        // canvas redesenha O(n) pontos a 60fps.
        const room = OFFICE_ANNOTATION_MAX_STROKE_POINTS - existing.points.length
        if (room > 0) existing.points.push(...points.slice(0, room))
        existing.lastAt = now
        if (done) existing.doneAt = now
        return
      }
      // Poda barata: só varre quando o Map já está no teto — a imensa
      // maioria das mensagens (append a um traço existente, acima) não paga
      // esse custo.
      if (strokes.size >= OFFICE_ANNOTATION_MAX_LIVE_STROKES) sweep(strokes, now)
      if (strokes.size >= OFFICE_ANNOTATION_MAX_LIVE_STROKES) evictOldest(strokes)
      strokes.set(key, {
        strokeId,
        userId,
        sharerId,
        points: [...points].slice(0, OFFICE_ANNOTATION_MAX_STROKE_POINTS),
        color: annotationColor(userId),
        doneAt: done ? now : null,
        lastAt: now,
      })
    },
    [],
  )

  useEffect(
    () =>
      bridge.onServerMessage((message) => {
        if (message.type !== 'screen-annotation') return
        upsert(
          message.userId,
          message.sharerId,
          message.strokeId,
          message.points,
          message.done === true,
        )
      }),
    [bridge, upsert],
  )

  const flush = useCallback(
    (done: boolean) => {
      const local = localRef.current
      if (!local) return
      // Um único ponto pendente que já foi enviado (a "cauda" de continuidade)
      // não é novidade: só vale mandar se o traço está fechando.
      if (local.pending.length <= 1 && !done) return
      while (local.pending.length > 0) {
        const chunk = local.pending.slice(0, OFFICE_ANNOTATION_MAX_POINTS)
        const rest = local.pending.slice(OFFICE_ANNOTATION_MAX_POINTS)
        const last = rest.length === 0
        bridge.emitClientMessage({
          type: 'screen-annotation',
          sharerId: local.sharerId,
          strokeId: local.strokeId,
          points: chunk,
          ...(done && last ? { done: true } : {}),
        })
        // Mantém o último ponto na frente do próximo lote: o receptor
        // CONCATENA os pontos de lotes consecutivos (`upsert` faz
        // `points.push(...)`), então a linha já fica ligada de qualquer
        // forma. O ponto repetido é só um vértice duplicado inofensivo —
        // mantém cada lote autossuficiente (desenhável sozinho) sem
        // depender do lote anterior ter chegado.
        local.pending = rest.length === 0 ? chunk.slice(-1) : rest
        if (rest.length === 0) break
      }
      if (done) local.pending = []
    },
    [bridge],
  )

  const stopTimer = useCallback(() => {
    if (flushTimerRef.current === null) return
    clearInterval(flushTimerRef.current)
    flushTimerRef.current = null
  }, [])

  // Fecha o traço local em aberto: esvazia o buffer `pending` com `done: true`
  // e marca `doneAt`. Usada tanto por `endStroke` (fechamento normal) quanto
  // por `beginStroke` (fechamento forçado de um traço anterior nunca
  // encerrado, ex.: segundo pointerdown sem o pointerup correspondente).
  const closeLocalStroke = useCallback(() => {
    const local = localRef.current
    const userId = youIdRef.current
    if (!local || !userId) return
    flush(true)
    const stroke = strokesRef.current.get(strokeKey(userId, local.strokeId))
    if (stroke) stroke.doneAt = Date.now()
    localRef.current = null
    stopTimer()
  }, [flush, stopTimer])

  const beginStroke = useCallback(
    (sharerId: string, point: OfficeAnnotationPoint) => {
      const userId = youIdRef.current
      if (!userId) return
      // Se já havia um traço aberto (segundo pointerdown sem pointerup
      // anterior, troca de ponteiro, chamada duplicada), fecha-o primeiro —
      // senão ele fica com pontos perdidos e `doneAt: null` até o TTL de
      // abandono expirar, congelado na tela de todo mundo.
      closeLocalStroke()
      // Corta no teto aceito pelo hub: hoje o id gerado (~45-58 chars) não
      // estoura, mas se um dia estourar o hub descartaria o lote inteiro em
      // silêncio.
      const strokeId = `${userId}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`.slice(
        0,
        OFFICE_ANNOTATION_STROKE_ID_MAX_LENGTH,
      )
      const rounded = roundPoint(point)
      localRef.current = { strokeId, sharerId, pending: [rounded] }
      upsert(userId, sharerId, strokeId, [rounded], false)
      stopTimer()
      flushTimerRef.current = setInterval(() => flush(false), OFFICE_ANNOTATION_BATCH_MS)
    },
    [closeLocalStroke, flush, stopTimer, upsert],
  )

  const extendStroke = useCallback(
    (point: OfficeAnnotationPoint) => {
      const local = localRef.current
      const userId = youIdRef.current
      if (!local || !userId) return
      const rounded = roundPoint(point)
      local.pending.push(rounded)
      upsert(userId, local.sharerId, local.strokeId, [rounded], false)
    },
    [upsert],
  )

  const endStroke = useCallback(() => {
    const userId = youIdRef.current
    if (!localRef.current || !userId) return
    closeLocalStroke()
  }, [closeLocalStroke])

  useEffect(() => stopTimer, [stopTimer])

  const strokesFor = useCallback((sharerId: string): AnnotationStroke[] => {
    const now = Date.now()
    sweep(strokesRef.current, now)
    const result: AnnotationStroke[] = []
    for (const stroke of strokesRef.current.values()) {
      if (stroke.sharerId === sharerId) result.push(stroke)
    }
    return result
  }, [])

  return useMemo(
    () => ({ strokesFor, beginStroke, extendStroke, endStroke }),
    [strokesFor, beginStroke, extendStroke, endStroke],
  )
}

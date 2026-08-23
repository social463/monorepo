import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import {
  OFFICE_ANNOTATION_BATCH_MS,
  OFFICE_ANNOTATION_MAX_LIVE_STROKES,
  OFFICE_ANNOTATION_MAX_STROKE_POINTS,
  OFFICE_ANNOTATION_STROKE_ID_MAX_LENGTH,
  OFFICE_ANNOTATION_STROKE_TTL_MS,
  type OfficeClientMessage,
} from '@legends/shared'
import { OfficeBridge } from '../OfficeBridge'
import { useScreenAnnotations } from './useScreenAnnotations'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('useScreenAnnotations', () => {
  it('traço remoto entra na lista do sharer certo e some do sharer errado', () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(() => useScreenAnnotations(bridge, 'eu'))

    act(() => {
      bridge.emitServerMessage({
        type: 'screen-annotation',
        userId: 'ana',
        sharerId: 'bruno',
        strokeId: 's1',
        points: [{ x: 0.1, y: 0.1 }],
      })
    })

    expect(result.current.strokesFor('bruno')).toHaveLength(1)
    expect(result.current.strokesFor('bruno')[0].userId).toBe('ana')
    expect(result.current.strokesFor('carla')).toHaveLength(0)
  })

  it('lotes do mesmo strokeId acumulam pontos no mesmo traço', () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(() => useScreenAnnotations(bridge, 'eu'))

    act(() => {
      bridge.emitServerMessage({
        type: 'screen-annotation',
        userId: 'ana',
        sharerId: 'bruno',
        strokeId: 's1',
        points: [{ x: 0.1, y: 0.1 }],
      })
      bridge.emitServerMessage({
        type: 'screen-annotation',
        userId: 'ana',
        sharerId: 'bruno',
        strokeId: 's1',
        points: [{ x: 0.2, y: 0.2 }],
        done: true,
      })
    })

    expect(result.current.strokesFor('bruno')[0].points).toHaveLength(2)
    expect(result.current.strokesFor('bruno')[0].doneAt).not.toBeNull()
  })

  it('traço terminado some depois do TTL', () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(() => useScreenAnnotations(bridge, 'eu'))

    act(() => {
      bridge.emitServerMessage({
        type: 'screen-annotation',
        userId: 'ana',
        sharerId: 'bruno',
        strokeId: 's1',
        points: [{ x: 0.1, y: 0.1 }],
        done: true,
      })
    })
    expect(result.current.strokesFor('bruno')).toHaveLength(1)

    act(() => {
      vi.advanceTimersByTime(OFFICE_ANNOTATION_STROKE_TTL_MS + 1)
    })
    expect(result.current.strokesFor('bruno')).toHaveLength(0)
  })

  it('desenhar aparece localmente antes de qualquer resposta do servidor', () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(() => useScreenAnnotations(bridge, 'eu'))

    act(() => {
      result.current.beginStroke('bruno', { x: 0.1, y: 0.1 })
      result.current.extendStroke({ x: 0.2, y: 0.2 })
    })

    const [stroke] = result.current.strokesFor('bruno')
    expect(stroke.userId).toBe('eu')
    expect(stroke.points).toHaveLength(2)
  })

  it('envia em lote no intervalo, repetindo o último ponto para não abrir furo entre lotes', () => {
    const bridge = new OfficeBridge()
    const sent: OfficeClientMessage[] = []
    bridge.onClientMessage((message) => sent.push(message))
    const { result } = renderHook(() => useScreenAnnotations(bridge, 'eu'))

    act(() => {
      result.current.beginStroke('bruno', { x: 0.1, y: 0.1 })
      result.current.extendStroke({ x: 0.2, y: 0.2 })
      vi.advanceTimersByTime(OFFICE_ANNOTATION_BATCH_MS)
    })

    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      type: 'screen-annotation',
      sharerId: 'bruno',
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.2, y: 0.2 },
      ],
    })

    act(() => {
      result.current.extendStroke({ x: 0.3, y: 0.3 })
      vi.advanceTimersByTime(OFFICE_ANNOTATION_BATCH_MS)
    })

    expect(sent).toHaveLength(2)
    expect(sent[1]).toMatchObject({
      points: [
        { x: 0.2, y: 0.2 },
        { x: 0.3, y: 0.3 },
      ],
    })
  })

  it('endStroke fecha o traço na hora, com done', () => {
    const bridge = new OfficeBridge()
    const sent: OfficeClientMessage[] = []
    bridge.onClientMessage((message) => sent.push(message))
    const { result } = renderHook(() => useScreenAnnotations(bridge, 'eu'))

    act(() => {
      result.current.beginStroke('bruno', { x: 0.1, y: 0.1 })
      result.current.endStroke()
    })

    expect(sent.at(-1)).toMatchObject({ type: 'screen-annotation', done: true })
    expect(result.current.strokesFor('bruno')[0].doneAt).not.toBeNull()
  })

  it('beginStroke sem endStroke anterior fecha o traço antigo antes de abrir o novo', () => {
    const bridge = new OfficeBridge()
    const sent: OfficeClientMessage[] = []
    bridge.onClientMessage((message) => sent.push(message))
    const { result } = renderHook(() => useScreenAnnotations(bridge, 'eu'))

    act(() => {
      result.current.beginStroke('bruno', { x: 0.1, y: 0.1 })
      result.current.extendStroke({ x: 0.2, y: 0.2 })
    })

    const [firstStroke] = result.current.strokesFor('bruno')
    const firstStrokeId = firstStroke.strokeId

    act(() => {
      // Segundo pointerdown sem o pointerup correspondente: o traço anterior
      // ainda está aberto (doneAt null) e tem ponto pendente no buffer.
      result.current.beginStroke('bruno', { x: 0.9, y: 0.9 })
    })

    // O lote de fechamento do primeiro traço saiu antes do segundo começar,
    // levando TODOS os pontos que ainda estavam no buffer `pending` — é isso
    // que garante que nada se perde no meio do traço interrompido.
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      type: 'screen-annotation',
      strokeId: firstStrokeId,
      done: true,
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.2, y: 0.2 },
      ],
    })

    const strokes = result.current.strokesFor('bruno')
    const closedFirst = strokes.find((stroke) => stroke.strokeId === firstStrokeId)
    expect(closedFirst?.doneAt).not.toBeNull()

    const second = strokes.find((stroke) => stroke.strokeId !== firstStrokeId)
    expect(second).toBeDefined()
    expect(second?.doneAt).toBeNull()
    expect(second?.points).toEqual([{ x: 0.9, y: 0.9 }])
  })

  it('sequestro: lote de outro userId no mesmo strokeId não altera o traço original', () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(() => useScreenAnnotations(bridge, 'eu'))

    act(() => {
      bridge.emitServerMessage({
        type: 'screen-annotation',
        userId: 'ana',
        sharerId: 'bruno',
        strokeId: 's1',
        points: [{ x: 0.1, y: 0.1 }],
      })
      // Um cliente adulterado manda um lote com o MESMO strokeId, mas em nome
      // de outro userId (o hub carimba o userId de quem realmente enviou —
      // não há como se passar pela ana de verdade). Se o Map fosse chaveado
      // só por strokeId, isto continuaria (ou fecharia) o traço da ana.
      bridge.emitServerMessage({
        type: 'screen-annotation',
        userId: 'invasor',
        sharerId: 'bruno',
        strokeId: 's1',
        points: [{ x: 0.9, y: 0.9 }],
        done: true,
      })
    })

    const strokes = result.current.strokesFor('bruno')
    expect(strokes).toHaveLength(2)
    const anaStroke = strokes.find((stroke) => stroke.userId === 'ana')
    expect(anaStroke?.points).toEqual([{ x: 0.1, y: 0.1 }])
    expect(anaStroke?.doneAt).toBeNull()
    const invasorStroke = strokes.find((stroke) => stroke.userId === 'invasor')
    expect(invasorStroke?.points).toEqual([{ x: 0.9, y: 0.9 }])
  })

  it('teto de traços vivos: muitos strokeId distintos não crescem o Map sem limite', () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(() => useScreenAnnotations(bridge, 'eu'))

    act(() => {
      for (let i = 0; i < OFFICE_ANNOTATION_MAX_LIVE_STROKES + 50; i += 1) {
        bridge.emitServerMessage({
          type: 'screen-annotation',
          userId: `invasor-${i}`,
          sharerId: 'bruno',
          strokeId: `s${i}`,
          points: [{ x: 0.1, y: 0.1 }],
        })
      }
    })

    expect(result.current.strokesFor('bruno').length).toBeLessThanOrEqual(OFFICE_ANNOTATION_MAX_LIVE_STROKES)
  })

  it('teto de pontos por traço: um strokeId que nunca fecha não cresce sem limite', () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(() => useScreenAnnotations(bridge, 'eu'))

    act(() => {
      for (let i = 0; i < 100; i += 1) {
        bridge.emitServerMessage({
          type: 'screen-annotation',
          userId: 'ana',
          sharerId: 'bruno',
          strokeId: 's1',
          points: Array.from({ length: 64 }, () => ({ x: 0.1, y: 0.1 })),
        })
      }
    })

    const [stroke] = result.current.strokesFor('bruno')
    expect(stroke.points.length).toBeLessThanOrEqual(OFFICE_ANNOTATION_MAX_STROKE_POINTS)
  })

  it('arredonda os pontos para 3 casas antes de enfileirar para envio', () => {
    const bridge = new OfficeBridge()
    const sent: OfficeClientMessage[] = []
    bridge.onClientMessage((message) => sent.push(message))
    const { result } = renderHook(() => useScreenAnnotations(bridge, 'eu'))

    act(() => {
      result.current.beginStroke('bruno', { x: 0.462352941, y: 0.1 })
      result.current.endStroke()
    })

    expect(sent.at(-1)).toMatchObject({ points: [{ x: 0.462, y: 0.1 }] })
  })

  it('o strokeId gerado nunca passa do teto aceito pelo servidor', () => {
    const bridge = new OfficeBridge()
    const sent: OfficeClientMessage[] = []
    bridge.onClientMessage((message) => sent.push(message))
    const { result } = renderHook(() => useScreenAnnotations(bridge, 'eu'))

    act(() => {
      result.current.beginStroke('bruno', { x: 0.1, y: 0.1 })
      result.current.endStroke()
    })

    const message = sent.at(-1) as Extract<OfficeClientMessage, { type: 'screen-annotation' }>
    expect(message.strokeId.length).toBeLessThanOrEqual(OFFICE_ANNOTATION_STROKE_ID_MAX_LENGTH)
  })

  it('sem identidade (youId nulo) não desenha nem envia — sessão ainda não pronta', () => {
    const bridge = new OfficeBridge()
    const sent: OfficeClientMessage[] = []
    bridge.onClientMessage((message) => sent.push(message))
    const { result } = renderHook(() => useScreenAnnotations(bridge, null))

    act(() => {
      result.current.beginStroke('bruno', { x: 0.1, y: 0.1 })
      result.current.endStroke()
    })

    expect(sent).toHaveLength(0)
    expect(result.current.strokesFor('bruno')).toHaveLength(0)
  })
})

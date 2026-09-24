import { fireEvent, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { OfficeBall, OfficeOccupant } from '@legends/shared'
import { OfficeBridge } from './OfficeBridge'
import { BALL_CHARGE_MS, useOfficeBall } from './useOfficeBall'

const you = {
  userId: 'ana',
  name: 'Ana',
  photoUrl: null,
  avatarStyle: null,
  avatarSeed: null,
  avatarOptions: null,
  characterName: null,
  status: 'online',
  // Em PIXEL — centro do tile (4,4). O occupant fala pixel desde o movimento
  // livre, e o alcance da bola passou a ser medido em pixel também.
  x: 144,
  y: 144,
  dir: 'down',
} satisfies OfficeOccupant

const nearbyBall = { id: 'ball-1', x: 176, y: 144, vx: 0, vy: 0 } satisfies OfficeBall

describe('useOfficeBall', () => {
  it('Z toca na hora; X e C só chutam ao SOLTAR a tecla', () => {
    const bridge = new OfficeBridge()
    const emit = vi.spyOn(bridge, 'emitClientMessage')
    const { result } = renderHook(() => useOfficeBall(bridge, you, [nearbyBall]))

    expect(result.current.nearbyBall).toEqual(nearbyBall)
    expect(result.current.canKick).toBe(true)

    fireEvent.keyDown(window, { key: 'z' })
    expect(emit).toHaveBeenCalledWith({ type: 'kick-ball', power: 'touch' })

    fireEvent.keyDown(window, { key: 'x' })
    expect(emit).not.toHaveBeenCalledWith(expect.objectContaining({ power: 'kick' }))
    fireEvent.keyUp(window, { key: 'x' })
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'kick-ball', power: 'kick' }))

    fireEvent.keyDown(window, { key: 'c' })
    expect(emit).not.toHaveBeenCalledWith(expect.objectContaining({ power: 'lob' }))
    fireEvent.keyUp(window, { key: 'c' })
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'kick-ball', power: 'lob' }))
  })

  it('segurar X mais tempo manda uma carga maior', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_000)
      const bridge = new OfficeBridge()
      const emit = vi.spyOn(bridge, 'emitClientMessage')
      renderHook(() => useOfficeBall(bridge, you, [nearbyBall]))

      fireEvent.keyDown(window, { key: 'x' })
      vi.setSystemTime(1_000 + BALL_CHARGE_MS)
      fireEvent.keyUp(window, { key: 'x' })

      expect(emit).toHaveBeenCalledWith({ type: 'kick-ball', power: 'kick' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('toque rápido em X manda a carga mínima', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(1_000)
      const bridge = new OfficeBridge()
      const emit = vi.spyOn(bridge, 'emitClientMessage')
      renderHook(() => useOfficeBall(bridge, you, [nearbyBall]))

      fireEvent.keyDown(window, { key: 'x' })
      vi.setSystemTime(1_010)
      fireEvent.keyUp(window, { key: 'x' })

      expect(emit).toHaveBeenCalledWith({
        type: 'kick-ball',
        power: 'kick',
        charge: expect.closeTo(10 / BALL_CHARGE_MS, 5),
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('perder o foco da janela cancela a carga em andamento, sem chutar', () => {
    const bridge = new OfficeBridge()
    const emit = vi.spyOn(bridge, 'emitClientMessage')
    renderHook(() => useOfficeBall(bridge, you, [nearbyBall]))

    fireEvent.keyDown(window, { key: 'x' })
    fireEvent(window, new Event('blur'))
    fireEvent.keyUp(window, { key: 'x' })

    expect(emit).not.toHaveBeenCalled()
  })

  // A barra é do push-to-talk, e só: dividi-la com a bola foi o que fazia o
  // chute morrer durante a condução (ver o comentário de `BALL_KEYS`).
  it('a barra de espaço não chuta mais nada', () => {
    const bridge = new OfficeBridge()
    const emit = vi.spyOn(bridge, 'emitClientMessage')
    renderHook(() => useOfficeBall(bridge, you, [nearbyBall]))

    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    fireEvent.keyUp(window, { key: ' ', code: 'Space' })

    expect(emit).not.toHaveBeenCalled()
  })

  it('Shift no momento de SOLTAR vira chute com corrida', () => {
    const bridge = new OfficeBridge()
    const emit = vi.spyOn(bridge, 'emitClientMessage')
    renderHook(() => useOfficeBall(bridge, you, [nearbyBall]))

    fireEvent.keyDown(window, { key: 'x' })
    fireEvent.keyUp(window, { key: 'x', shiftKey: true })

    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ power: 'kick', sprint: true }))

    fireEvent.keyDown(window, { key: 'c' })
    fireEvent.keyUp(window, { key: 'c', shiftKey: true })

    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ power: 'lob', sprint: true }))
  })

  it('estar em cima da bola conta como alcance', () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(() => useOfficeBall(bridge, you, [{ id: 'ball-1', x: 144, y: 144, vx: 0, vy: 0 }]))

    expect(result.current.canKick).toBe(true)
  })

  it('bola longe, edição ligada ou campo de texto em foco não chutam', () => {
    const bridge = new OfficeBridge()
    const emit = vi.spyOn(bridge, 'emitClientMessage')
    const { result: far } = renderHook(() => useOfficeBall(bridge, you, [{ id: 'ball-1', x: 240, y: 240, vx: 0, vy: 0 }]))
    expect(far.current.canKick).toBe(false)

    const { result: editing } = renderHook(() => useOfficeBall(bridge, you, [nearbyBall], false))
    expect(editing.current.canKick).toBe(false)

    renderHook(() => useOfficeBall(bridge, you, [nearbyBall]))
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: 'x', bubbles: true })
    input.remove()

    expect(emit).not.toHaveBeenCalled()
  })

  // Conduzindo, o personagem na tela vai à frente da posição autoritativa: se
  // a tecla dependesse só dela, a barra desarmava no meio da corrida e o
  // Espaço voltava a ser push-to-talk (ver `BALL_INPUT_REACH`).
  it('segue armado um pouco além do alcance do servidor, por causa da predição', () => {
    // A 44px do centro, 36 da superfície: além dos 32 que o servidor aceita, e
    // dentro dos 40 do cliente. O botão some DEPOIS de a bola sair do alcance,
    // nunca antes — quem está andando em direção a ela já chegou quando aperta.
    const bridge = new OfficeBridge()
    const emit = vi.spyOn(bridge, 'emitClientMessage')
    const { result } = renderHook(() => useOfficeBall(bridge, you, [{ id: 'ball-1', x: 188, y: 144, vx: 0, vy: 0 }]))

    expect(result.current.canKick).toBe(true)
    fireEvent.keyDown(window, { key: 'x' })
    fireEvent.keyUp(window, { key: 'x' })
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'kick-ball', power: 'kick' }))
  })

  it('escolhe a bola mais próxima quando há mais de uma ao alcance', () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(() =>
      useOfficeBall(bridge, you, [
        { id: 'ball-diagonal', x: 176, y: 176, vx: 0, vy: 0 },
        { id: 'ball-colada', x: 144, y: 176, vx: 0, vy: 0 },
      ]),
    )

    expect(result.current.nearbyBall?.id).toBe('ball-colada')
  })
})

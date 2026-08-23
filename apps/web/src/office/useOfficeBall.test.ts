import { fireEvent, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { OfficeBall, OfficeOccupant } from '@legends/shared'
import { OfficeBridge } from './OfficeBridge'
import { useOfficeBall } from './useOfficeBall'

const you = {
  userId: 'ana',
  name: 'Ana',
  photoUrl: null,
  avatarStyle: null,
  avatarSeed: null,
  avatarOptions: null,
  characterName: null,
  status: 'online',
  x: 4,
  y: 4,
  dir: 'down',
} satisfies OfficeOccupant

const nearbyBall = { id: 'ball-1', x: 5, y: 4 } satisfies OfficeBall

describe('useOfficeBall', () => {
  it('Z toca, X chuta e C levanta a bola ao alcance', () => {
    const bridge = new OfficeBridge()
    const emit = vi.spyOn(bridge, 'emitClientMessage')
    const { result } = renderHook(() => useOfficeBall(bridge, you, [nearbyBall]))

    expect(result.current.nearbyBall).toEqual(nearbyBall)
    expect(result.current.canKick).toBe(true)

    fireEvent.keyDown(window, { key: 'z' })
    expect(emit).toHaveBeenCalledWith({ type: 'kick-ball', power: 'touch' })

    fireEvent.keyDown(window, { key: 'x' })
    expect(emit).toHaveBeenCalledWith({ type: 'kick-ball', power: 'kick' })

    fireEvent.keyDown(window, { key: 'c' })
    expect(emit).toHaveBeenCalledWith({ type: 'kick-ball', power: 'lob' })
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

  it('Shift junto vira chute com corrida', () => {
    const bridge = new OfficeBridge()
    const emit = vi.spyOn(bridge, 'emitClientMessage')
    renderHook(() => useOfficeBall(bridge, you, [nearbyBall]))

    fireEvent.keyDown(window, { key: 'x', shiftKey: true })

    expect(emit).toHaveBeenCalledWith({ type: 'kick-ball', power: 'kick', sprint: true })

    fireEvent.keyDown(window, { key: 'c', shiftKey: true })

    expect(emit).toHaveBeenCalledWith({ type: 'kick-ball', power: 'lob', sprint: true })
  })

  it('estar em cima da bola conta como alcance', () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(() => useOfficeBall(bridge, you, [{ id: 'ball-1', x: 4, y: 4 }]))

    expect(result.current.canKick).toBe(true)
  })

  it('bola longe, edição ligada ou campo de texto em foco não chutam', () => {
    const bridge = new OfficeBridge()
    const emit = vi.spyOn(bridge, 'emitClientMessage')
    const { result: far } = renderHook(() => useOfficeBall(bridge, you, [{ id: 'ball-1', x: 7, y: 7 }]))
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
  it('segue armado um tile além do alcance do servidor, por causa da predição', () => {
    const bridge = new OfficeBridge()
    const emit = vi.spyOn(bridge, 'emitClientMessage')
    const { result } = renderHook(() => useOfficeBall(bridge, you, [{ id: 'ball-1', x: 6, y: 4 }]))

    expect(result.current.canKick).toBe(true)
    fireEvent.keyDown(window, { key: 'x' })
    expect(emit).toHaveBeenCalledWith({ type: 'kick-ball', power: 'kick' })
  })

  it('escolhe a bola mais próxima quando há mais de uma ao alcance', () => {
    const bridge = new OfficeBridge()
    const { result } = renderHook(() =>
      useOfficeBall(bridge, you, [
        { id: 'ball-diagonal', x: 5, y: 5 },
        { id: 'ball-colada', x: 4, y: 5 },
      ]),
    )

    expect(result.current.nearbyBall?.id).toBe('ball-colada')
  })
})

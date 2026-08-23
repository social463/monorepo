import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCharacterScreenPositions } from './useCharacterScreenPositions'
import type { OfficeCanvasHandle } from '../OfficeCanvas'

describe('useCharacterScreenPositions', () => {
  let rafCallbacks: FrameRequestCallback[]
  let rafId: number

  beforeEach(() => {
    rafCallbacks = []
    rafId = 0
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb)
      return ++rafId
    })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function tick() {
    const callbacks = rafCallbacks
    rafCallbacks = []
    callbacks.forEach((cb) => cb(0))
  }

  function fakeCanvasRef(getScreenPosition: OfficeCanvasHandle['getScreenPosition']) {
    return {
      current: {
        getScreenPosition,
        getScene: () => null,
        getDeskScreenPosition: () => null,
        zoomAtClientPoint: () => {},
        startDeskReminderPlacement: () => false,
        cancelDeskReminderPlacement: () => {},
      },
    }
  }

  it('antes do primeiro frame processar, o mapa vem vazio', () => {
    const canvasRef = fakeCanvasRef(() => ({ x: 1, y: 2, zoom: 1 }))
    const { result } = renderHook(() => useCharacterScreenPositions(canvasRef, ['ana']))
    expect(result.current.size).toBe(0)
  })

  it('depois de um frame, popula o mapa com o retorno de getScreenPosition', () => {
    const canvasRef = fakeCanvasRef(() => ({ x: 10, y: 20, zoom: 1.5 }))
    const { result } = renderHook(() => useCharacterScreenPositions(canvasRef, ['ana']))

    act(() => tick())

    expect(result.current.get('ana')).toEqual({ x: 10, y: 20, zoom: 1.5 })
  })

  it('userId sem posição (getScreenPosition retorna null) fica null no mapa', () => {
    const canvasRef = fakeCanvasRef(() => null)
    const { result } = renderHook(() => useCharacterScreenPositions(canvasRef, ['ana']))

    act(() => tick())

    expect(result.current.get('ana')).toBeNull()
  })

  it('consulta a posição de cada userId da lista', () => {
    const getScreenPosition = vi.fn((userId: string) => ({ x: userId.length, y: 0, zoom: 1 }))
    const canvasRef = fakeCanvasRef(getScreenPosition)
    const { result } = renderHook(() => useCharacterScreenPositions(canvasRef, ['ana', 'bob']))

    act(() => tick())

    expect(result.current.get('ana')).toEqual({ x: 3, y: 0, zoom: 1 })
    expect(result.current.get('bob')).toEqual({ x: 3, y: 0, zoom: 1 })
    expect(getScreenPosition).toHaveBeenCalledWith('ana')
    expect(getScreenPosition).toHaveBeenCalledWith('bob')
  })

  it('lista vazia de userIds não agenda frame nenhum', () => {
    const rafSpy = vi.fn()
    vi.stubGlobal('requestAnimationFrame', rafSpy)
    const canvasRef = { current: null }
    renderHook(() => useCharacterScreenPositions(canvasRef, []))
    expect(rafSpy).not.toHaveBeenCalled()
  })

  it('cancela o frame agendado no unmount', () => {
    const cancelSpy = vi.fn()
    vi.stubGlobal('cancelAnimationFrame', cancelSpy)
    const canvasRef = fakeCanvasRef(() => null)
    const { unmount } = renderHook(() => useCharacterScreenPositions(canvasRef, ['ana']))
    unmount()
    expect(cancelSpy).toHaveBeenCalled()
  })

  it('não gera um novo Map (nem re-render) quando a posição não muda entre frames', () => {
    const canvasRef = fakeCanvasRef(() => ({ x: 10, y: 20, zoom: 1 }))
    const { result } = renderHook(() => useCharacterScreenPositions(canvasRef, ['ana']))

    act(() => tick())
    const firstMap = result.current

    act(() => tick())
    expect(result.current).toBe(firstMap)
  })

  it('troca de userId com o mesmo tamanho da lista (ex: alguém saiu, outro entrou), ambos fora do viewport, não fica com o mapa desatualizado', () => {
    const canvasRef = fakeCanvasRef(() => null)
    const { result, rerender } = renderHook(
      ({ userIds }: { userIds: string[] }) => useCharacterScreenPositions(canvasRef, userIds),
      { initialProps: { userIds: ['ana'] } },
    )

    act(() => tick())
    expect(result.current.has('ana')).toBe(true)
    expect(result.current.has('bob')).toBe(false)

    rerender({ userIds: ['bob'] })
    act(() => tick())

    expect(result.current.has('bob')).toBe(true)
    expect(result.current.has('ana')).toBe(false)
  })
})

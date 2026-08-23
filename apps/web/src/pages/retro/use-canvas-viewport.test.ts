import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { worldToScreen, screenToWorld, useCanvasViewport } from './use-canvas-viewport'

describe('canvas viewport math', () => {
  it('worldToScreen aplica zoom e pan', () => {
    expect(worldToScreen(10, 20, { x: 5, y: 5 }, 2)).toEqual({ x: 25, y: 45 })
  })
  it('screenToWorld é o inverso', () => {
    const pan = { x: 30, y: -10 }, zoom = 1.5
    const s = worldToScreen(12, 34, pan, zoom)
    const w = screenToWorld(s.x, s.y, pan, zoom)
    expect(w.x).toBeCloseTo(12)
    expect(w.y).toBeCloseTo(34)
  })
})

const RECT = { left: 0, top: 0, width: 800, height: 600 } as DOMRect

describe('useCanvasViewport zoom controls', () => {
  it('zoomIn aumenta e respeita o teto 2.5; zoomOut diminui e respeita o piso 0.3', () => {
    const { result } = renderHook(() => useCanvasViewport())
    for (let i = 0; i < 30; i++) act(() => result.current.zoomIn(RECT))
    expect(result.current.zoom).toBeLessThanOrEqual(2.5)
    expect(result.current.zoom).toBeGreaterThan(0.8)
    for (let i = 0; i < 60; i++) act(() => result.current.zoomOut(RECT))
    expect(result.current.zoom).toBeGreaterThanOrEqual(0.3)
  })

  it('reset volta pan/zoom ao estado inicial', () => {
    const { result } = renderHook(() => useCanvasViewport())
    act(() => result.current.zoomIn(RECT))
    act(() => result.current.panBy(50, 50))
    act(() => result.current.reset())
    expect(result.current.zoom).toBe(0.8)
    expect(result.current.pan).toEqual({ x: 120, y: 80 })
  })

  it('fitTo enquadra os bounds: respeita o piso 0.3, centraliza e ignora rect vazio', () => {
    const { result } = renderHook(() => useCanvasViewport())
    // bounds maiores que a viewport => zoom limita pela menor razão, com clamp no piso 0.3
    const bounds = { x: 0, y: 0, w: 3400, h: 2180 }
    act(() => result.current.fitTo(RECT, bounds, 48))
    expect(result.current.zoom).toBeGreaterThanOrEqual(0.3)
    expect(result.current.zoom).toBeLessThan(0.8)
    // centro dos bounds cai no centro da viewport
    const cx = bounds.w / 2, cy = bounds.h / 2
    expect(result.current.pan.x).toBeCloseTo(RECT.width / 2 - cx * result.current.zoom)
    expect(result.current.pan.y).toBeCloseTo(RECT.height / 2 - cy * result.current.zoom)
    // rect vazio (ex.: jsdom) não altera o viewport
    const before = result.current.zoom
    act(() => result.current.fitTo({ left: 0, top: 0, width: 0, height: 0 } as DOMRect, bounds))
    expect(result.current.zoom).toBe(before)
  })
})

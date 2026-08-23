import { useCallback, useState } from 'react'

export interface Pan { x: number; y: number }

export function worldToScreen(wx: number, wy: number, pan: Pan, zoom: number): { x: number; y: number } {
  return { x: wx * zoom + pan.x, y: wy * zoom + pan.y }
}
export function screenToWorld(sx: number, sy: number, pan: Pan, zoom: number): { x: number; y: number } {
  return { x: (sx - pan.x) / zoom, y: (sy - pan.y) / zoom }
}

const MIN_ZOOM = 0.3
const MAX_ZOOM = 2.5
const INITIAL_PAN: Pan = { x: 120, y: 80 }
const INITIAL_ZOOM = 0.8

export function useCanvasViewport() {
  const [pan, setPan] = useState<Pan>(INITIAL_PAN)
  const [zoom, setZoom] = useState(INITIAL_ZOOM)

  const panBy = useCallback((dx: number, dy: number) => {
    setPan((p) => ({ x: p.x + dx, y: p.y + dy }))
  }, [])

  const zoomAt = useCallback((clientX: number, clientY: number, rect: DOMRect, deltaY: number) => {
    setZoom((z) => {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z * (deltaY < 0 ? 1.1 : 1 / 1.1)))
      // mantém o ponto sob o cursor estável
      setPan((p) => {
        const sx = clientX - rect.left
        const sy = clientY - rect.top
        const wx = (sx - p.x) / z
        const wy = (sy - p.y) / z
        return { x: sx - wx * next, y: sy - wy * next }
      })
      return next
    })
  }, [])

  const toWorld = useCallback(
    (clientX: number, clientY: number, rect: DOMRect) => screenToWorld(clientX - rect.left, clientY - rect.top, pan, zoom),
    [pan, zoom],
  )

  const zoomIn = useCallback(
    (rect: DOMRect) => zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, rect, -1),
    [zoomAt],
  )
  const zoomOut = useCallback(
    (rect: DOMRect) => zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, rect, 1),
    [zoomAt],
  )
  const reset = useCallback(() => {
    setPan(INITIAL_PAN)
    setZoom(INITIAL_ZOOM)
  }, [])

  // Enquadra `bounds` (coords de mundo) dentro de `rect` (viewport), centralizado, com folga.
  const fitTo = useCallback((rect: DOMRect, bounds: { x: number; y: number; w: number; h: number }, padding = 48) => {
    if (rect.width === 0 || rect.height === 0) return
    const zx = (rect.width - padding * 2) / bounds.w
    const zy = (rect.height - padding * 2) / bounds.h
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(zx, zy)))
    const cx = bounds.x + bounds.w / 2
    const cy = bounds.y + bounds.h / 2
    setZoom(z)
    setPan({ x: rect.width / 2 - cx * z, y: rect.height / 2 - cy * z })
  }, [])

  return { pan, zoom, panBy, zoomAt, toWorld, zoomIn, zoomOut, reset, fitTo }
}

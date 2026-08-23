import { useEffect, useRef, useState, type RefObject } from 'react'
import type { OfficeCanvasHandle } from './OfficeCanvas'
import type { ScreenPosition } from './scenes/OfficeScene'

/**
 * Poll de posição de tela via `requestAnimationFrame` — sincroniza o card de
 * hover (DOM) com a posição da mesa no canvas do Phaser enquanto a câmera se
 * move/dá zoom. Mesmo padrão de `useCharacterScreenPositions`, mas para uma
 * única mesa (a que está em hover no momento, ou nenhuma).
 */
export function useDeskScreenPosition(
  canvasRef: RefObject<OfficeCanvasHandle | null>,
  externalKey: string | null,
): ScreenPosition | null {
  const [position, setPosition] = useState<ScreenPosition | null>(null)
  const externalKeyRef = useRef(externalKey)
  externalKeyRef.current = externalKey

  useEffect(() => {
    if (!externalKey) {
      setPosition(null)
      return
    }
    let frame: number
    const tick = () => {
      const key = externalKeyRef.current
      const next = key ? (canvasRef.current?.getDeskScreenPosition(key) ?? null) : null
      setPosition((prev) =>
        prev?.x === next?.x && prev?.y === next?.y && prev?.zoom === next?.zoom ? prev : next,
      )
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
    // `canvasRef` fica de fora de propósito — é um RefObject estável (useRef).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalKey])

  return position
}

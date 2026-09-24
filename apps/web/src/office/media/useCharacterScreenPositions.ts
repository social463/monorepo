import { useEffect, useRef, useState, type RefObject } from 'react'
import type { ScreenPosition } from '../../lib/screenPosition'

/**
 * O mínimo de que este hook precisa. Estrutural (e não `OfficeCanvasHandle`)
 * porque a cena da arena também ancora balões de webcam por aqui, e ela não é
 * um canvas de escritório.
 */
export interface ScreenPositionSource {
  getScreenPosition(userId: string): ScreenPosition | null
}

/**
 * Comparação rasa entre dois `Map` de posições — usada pra evitar
 * `setPositions` (e o re-render de 60fps que isso causaria) quando nada
 * mudou de fato entre um frame e outro (câmera parada, personagens parados).
 */
function positionsEqual(
  a: Map<string, ScreenPosition | null>,
  b: Map<string, ScreenPosition | null>,
): boolean {
  if (a.size !== b.size) return false
  for (const [userId, value] of a) {
    // `.has` primeiro: sem isso, uma chave ausente em `b` (`get` retorna
    // `undefined`) e uma chave presente com valor `null` ficam
    // indistinguíveis abaixo — dois mapas do mesmo tamanho mas com
    // usuários DIFERENTES (ex: um saiu, outro entrou, ambos fora do
    // viewport) seriam considerados "iguais" por engano.
    if (!b.has(userId)) return false
    const other = b.get(userId) ?? null
    if (value === null || other === null) {
      if (value !== other) return false
      continue
    }
    if (value.x !== other.x || value.y !== other.y || value.zoom !== other.zoom) return false
  }
  return true
}

/**
 * Poll de posição de tela via `requestAnimationFrame` — sincroniza balões
 * de vídeo (DOM) com a posição do personagem no canvas do Phaser, que não
 * emite nenhum evento reativo pra "personagem se moveu na tela" (zoom e
 * scroll da câmera também mudam a posição, sem disparar nada no React).
 */
export function useCharacterScreenPositions(
  canvasRef: RefObject<ScreenPositionSource | null>,
  userIds: string[],
): Map<string, ScreenPosition | null> {
  const [positions, setPositions] = useState<Map<string, ScreenPosition | null>>(new Map())
  const userIdsRef = useRef(userIds)
  userIdsRef.current = userIds

  useEffect(() => {
    if (userIds.length === 0) {
      setPositions(new Map())
      return
    }
    let frame: number
    const tick = () => {
      const canvas = canvasRef.current
      const next = new Map<string, ScreenPosition | null>()
      for (const userId of userIdsRef.current) {
        next.set(userId, canvas?.getScreenPosition(userId) ?? null)
      }
      setPositions((prev) => (positionsEqual(prev, next) ? prev : next))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
    // `canvasRef` fica de fora de propósito: é um RefObject, estável por
    // convenção (useRef nunca muda de identidade) — incluí-lo aqui faria o
    // efeito reiniciar sempre que um chamador passasse um objeto não
    // memoizado (ex: `{ current: ... }` literal), causando um loop de
    // render (setPositions -> novo objeto -> efeito recria -> setPositions).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userIds.length])

  return positions
}

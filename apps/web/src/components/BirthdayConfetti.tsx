import { useEffect, useMemo, useState } from 'react'
import { useBirthdayConfetti } from '../lib/use-birthday-confetti'

const PIECE_COLORS = ['bg-primary', 'bg-secondary', 'bg-tertiary', 'bg-error']
const PIECE_COUNT = 40
const VISIBLE_MS = 4000

interface Piece {
  id: number
  left: number
  delay: number
  duration: number
  rotate: number
  color: string
}

function makePieces(): Piece[] {
  return Array.from({ length: PIECE_COUNT }, (_, id) => ({
    id,
    left: Math.random() * 100,
    delay: Math.random() * 0.6,
    duration: 2.6 + Math.random() * 1.2,
    rotate: Math.random() * 360,
    color: PIECE_COLORS[id % PIECE_COLORS.length],
  }))
}

/**
 * Chuva de confete cobrindo a tela no aniversário de `targetUserId` (padrão: o
 * próprio usuário logado). `once` (padrão `true`) limita a uma vez por dia
 * civil; ver `useBirthdayConfetti`.
 */
export function BirthdayConfetti({ targetUserId, once }: { targetUserId?: string; once?: boolean } = {}) {
  const trigger = useBirthdayConfetti(targetUserId, { once })
  const [visible, setVisible] = useState(false)
  const pieces = useMemo(() => makePieces(), [trigger])

  useEffect(() => {
    if (!trigger) return
    setVisible(true)
    const timer = setTimeout(() => setVisible(false), VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [trigger])

  if (!visible) return null

  return (
    <div data-testid="birthday-confetti" className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {pieces.map((piece) => (
        <span
          key={piece.id}
          className={`absolute top-[-5%] h-3 w-1.5 animate-confetti-fall rounded-sm ${piece.color}`}
          style={{
            left: `${piece.left}%`,
            animationDelay: `${piece.delay}s`,
            animationDuration: `${piece.duration}s`,
            transform: `rotate(${piece.rotate}deg)`,
          }}
        />
      ))}
    </div>
  )
}

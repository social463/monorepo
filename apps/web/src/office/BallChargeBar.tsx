import { useEffect, useState } from 'react'
import { BALL_CHARGE_MS, type OfficeBallCharge } from './useOfficeBall'

/**
 * Barra de força do chute carregável (X/C). Só existe enquanto `charging` não
 * é `null` — some sozinha ao soltar a tecla, porque é o próprio hook que zera
 * `charging` nesse instante.
 *
 * Poll por `requestAnimationFrame`, mesmo padrão de `useDeskScreenPosition`:
 * o progresso depende do RELÓGIO (`Date.now() - startedAt`), não de um estado
 * que muda sozinho, então precisa de alguém perguntando a cada quadro.
 */
export function BallChargeBar({ charging }: { charging: OfficeBallCharge | null }) {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (!charging) {
      setProgress(0)
      return
    }
    let frame: number
    const tick = () => {
      const elapsed = Date.now() - charging.startedAt
      setProgress(Math.max(0, Math.min(1, elapsed / BALL_CHARGE_MS)))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [charging])

  if (!charging) return null

  const percent = Math.round(progress * 100)
  return (
    <div
      role="progressbar"
      aria-label="Força do chute"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-container-highest"
    >
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-75 ease-linear"
        style={{ width: `${percent}%` }}
      />
    </div>
  )
}

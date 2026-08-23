import { useEffect, useRef, useState } from 'react'
import {
  CHARACTER_FRAME_SIZE,
  characterIdleFrame,
  characterWalkFrames,
  characterSignature,
  type CharacterOptions,
} from '@legends/shared'
import { composeCharacterSheet } from '../lib/character'

const DIRECTIONS = ['down', 'left', 'up', 'right'] as const
type PreviewDirection = (typeof DIRECTIONS)[number]
const WALK_FPS = 8

/**
 * Personagem de corpo inteiro tocando o walk cycle num <canvas>, com botão
 * para girar a direção — mostra exatamente o que anda no escritório.
 */
export function CharacterPreview({ options, size = 160 }: { options: CharacterOptions; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [dirIndex, setDirIndex] = useState(0)
  const dir: PreviewDirection = DIRECTIONS[dirIndex]

  useEffect(() => {
    let alive = true
    let raf = 0
    void composeCharacterSheet(options).then((sheet) => {
      if (!alive) return
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (!canvas || !ctx) return
      ctx.imageSmoothingEnabled = false
      const frames = [characterIdleFrame(dir), ...characterWalkFrames(dir)]
      const start = performance.now()
      const draw = (now: number) => {
        const step = Math.floor(((now - start) / 1000) * WALK_FPS)
        const frame = frames[1 + (step % (frames.length - 1))] // anima só os frames de passo
        const sx = (frame % 9) * CHARACTER_FRAME_SIZE
        const sy = Math.floor(frame / 9) * CHARACTER_FRAME_SIZE
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(sheet, sx, sy, CHARACTER_FRAME_SIZE, CHARACTER_FRAME_SIZE, 0, 0, canvas.width, canvas.height)
        raf = requestAnimationFrame(draw)
      }
      raf = requestAnimationFrame(draw)
    }).catch(() => {})
    return () => {
      alive = false
      cancelAnimationFrame(raf)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characterSignature(options), dir])

  return (
    <div className="flex flex-col items-center gap-sm">
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        style={{ imageRendering: 'pixelated' }}
        className="rounded-lg bg-surface-container-highest"
        aria-label="Prévia do personagem"
      />
      <button
        type="button"
        onClick={() => setDirIndex((i) => (i + 1) % DIRECTIONS.length)}
        className="rounded-md border border-outline-variant/50 px-md py-xs font-label text-label-sm text-on-surface hover:border-primary"
      >
        Girar
      </button>
    </div>
  )
}

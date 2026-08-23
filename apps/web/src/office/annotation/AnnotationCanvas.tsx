import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { OFFICE_ANNOTATION_STROKE_TTL_MS, type OfficeAnnotationPoint } from '@legends/shared'
import { toLocal, toNormalized, videoContentRect } from './annotation-geometry'
import type { ScreenAnnotationsState } from './useScreenAnnotations'

const LINE_WIDTH = 4

/**
 * Overlay de desenho sobre a tela compartilhada em destaque. Único arquivo da
 * feature que toca DOM/Canvas: geometria, cor e estado vivem fora daqui.
 *
 * Redesenha em rAF lendo o ref do hook — não há estado React no laço, então
 * desenhar não re-renderiza a grade inteira a cada ponto.
 */
export function AnnotationCanvas({
  sharerId,
  annotations,
  active,
  videoRef,
}: {
  sharerId: string
  annotations: ScreenAnnotationsState
  active: boolean
  videoRef: RefObject<HTMLVideoElement>
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawingRef = useRef(false)
  const annotationsRef = useRef(annotations)
  annotationsRef.current = annotations

  useEffect(() => {
    let frame = 0
    const draw = () => {
      frame = requestAnimationFrame(draw)
      const canvas = canvasRef.current
      const video = videoRef.current
      if (!canvas || !video) return
      const context = canvas.getContext('2d')
      if (!context) return

      const ratio = window.devicePixelRatio || 1
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
        canvas.width = Math.round(width * ratio)
        canvas.height = Math.round(height * ratio)
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, width, height)

      const rect = videoContentRect({
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        clientWidth: width,
        clientHeight: height,
      })
      const now = Date.now()
      context.lineCap = 'round'
      context.lineJoin = 'round'
      context.lineWidth = LINE_WIDTH
      for (const stroke of annotations.strokesFor(sharerId)) {
        if (stroke.points.length === 0) continue
        // Traço em andamento fica opaco; terminado desaparece ao longo do TTL.
        const age = stroke.doneAt === null ? 0 : now - stroke.doneAt
        context.globalAlpha = Math.max(0, 1 - age / OFFICE_ANNOTATION_STROKE_TTL_MS)
        context.strokeStyle = stroke.color
        context.beginPath()
        const first = toLocal(stroke.points[0], rect)
        context.moveTo(first.x, first.y)
        const rest = stroke.points.slice(1)
        if (rest.length === 0) {
          // Toque rápido sem arrastar: um moveTo sozinho não pinta nada com
          // stroke(). Um lineTo pro mesmo ponto, com lineCap 'round', desenha
          // um círculo — assim o toque fica visível pra quem está assistindo.
          context.lineTo(first.x, first.y)
        } else {
          for (const point of rest) {
            const local = toLocal(point, rect)
            context.lineTo(local.x, local.y)
          }
        }
        context.stroke()
      }
      context.globalAlpha = 1
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [annotations, sharerId, videoRef])

  // Modo desligado no meio de um traço (botão, P ou Esc): fecha o que estava
  // aberto, senão ele ficaria sem o lote final e só morreria pela rede de
  // segurança de traço abandonado, muito depois.
  useEffect(() => {
    if (active || !drawingRef.current) return
    drawingRef.current = false
    annotations.endStroke()
  }, [active, annotations])

  // Desmontar com o traço aberto (o destaque deixou de ser esta tela, a
  // grade recolheu) não passa por `active` virando `false` — o componente já
  // não existe mais para reagir ao efeito acima. Sem este cleanup, o traço
  // fica sem o lote final e congelado nos outros clientes pelos 15s do teto
  // de abandono, em vez de fechar na hora. Deps vazias de propósito: só deve
  // rodar no desmonte, nunca por `annotations` trocar de identidade entre
  // renders (que fecharia um traço ainda em andamento por engano).
  useEffect(() => {
    return () => {
      if (!drawingRef.current) return
      drawingRef.current = false
      annotationsRef.current.endStroke()
    }
  }, [])

  const pointAt = useCallback(
    (event: ReactPointerEvent<HTMLCanvasElement>): OfficeAnnotationPoint => {
      const canvas = event.currentTarget
      const bounds = canvas.getBoundingClientRect()
      const video = videoRef.current
      const rect = videoContentRect({
        videoWidth: video?.videoWidth ?? 0,
        videoHeight: video?.videoHeight ?? 0,
        clientWidth: bounds.width,
        clientHeight: bounds.height,
      })
      return toNormalized({ x: event.clientX - bounds.left, y: event.clientY - bounds.top }, rect)
    },
    [videoRef],
  )

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!active) return
    // O `VideoTile` em destaque (onde este overlay vive) não recebe `onClick`
    // — não há pin para trocar aqui, diferente dos tiles da grade/sidebar.
    // Ainda assim não deixamos o clique borbulhar: é defesa inofensiva contra
    // qualquer handler que um dia venha a existir no ancestral do tile.
    event.stopPropagation()
    event.preventDefault()
    drawingRef.current = true
    event.currentTarget.setPointerCapture?.(event.pointerId)
    annotations.beginStroke(sharerId, pointAt(event))
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!active || !drawingRef.current) return
    annotations.extendStroke(pointAt(event))
  }

  const finish = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    drawingRef.current = false
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    annotations.endStroke()
  }

  return (
    <canvas
      ref={canvasRef}
      data-testid="annotation-canvas"
      aria-hidden="true"
      className="absolute inset-0 z-10 h-full w-full"
      style={{ pointerEvents: active ? 'auto' : 'none', cursor: active ? 'crosshair' : 'default' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onPointerLeave={finish}
    />
  )
}

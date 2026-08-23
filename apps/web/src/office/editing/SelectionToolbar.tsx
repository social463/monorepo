import { useEffect, useRef, useState, type RefObject } from 'react'
import { Icon } from '../../components/Icon'
import type { OfficeCanvasHandle } from '../OfficeCanvas'
import type { ScreenPosition } from '../scenes/OfficeScene'

export interface SelectionToolbarProps {
  canvasRef: RefObject<OfficeCanvasHandle>
  /** Bbox (pixel) do grupo de mobília selecionado — a mesma usada no overlay azul da cena. */
  bounds: { x: number; y: number; width: number; height: number }
  onRotate: (direction: 'cw' | 'ccw') => void
  onFlip: (axis: 'horizontal' | 'vertical') => void
  onReorder: (direction: 'forward' | 'front' | 'backward' | 'back') => void
  onClear: () => void
  /** Se o grupo selecionado tem colisão pareada — mostra o botão "remover colisão". */
  hasCollision: boolean
  onRemoveCollision: () => void
}

/** Transformações do grupo (girar/espelhar) — sempre visíveis, nesta ordem. */
const TRANSFORM_ACTIONS: { icon: string; label: string; hint: string; run: (p: SelectionToolbarProps) => void }[] = [
  { icon: 'rotate_left', label: 'Girar à esquerda', hint: 'Shift+R', run: (p) => p.onRotate('ccw') },
  { icon: 'rotate_right', label: 'Girar à direita', hint: 'R', run: (p) => p.onRotate('cw') },
  { icon: 'swap_horiz', label: 'Espelhar na horizontal', hint: 'H', run: (p) => p.onFlip('horizontal') },
  { icon: 'swap_vert', label: 'Espelhar na vertical', hint: 'V', run: (p) => p.onFlip('vertical') },
]

/** Ordem visual da mobília, do movimento incremental ao extremo. */
const LAYER_ACTIONS: { icon: string; label: string; run: (p: SelectionToolbarProps) => void }[] = [
  { icon: 'arrow_upward', label: 'Subir uma camada', run: (p) => p.onReorder('forward') },
  { icon: 'vertical_align_top', label: 'Trazer para frente de tudo', run: (p) => p.onReorder('front') },
  { icon: 'arrow_downward', label: 'Descer uma camada', run: (p) => p.onReorder('backward') },
  { icon: 'vertical_align_bottom', label: 'Enviar para trás de tudo', run: (p) => p.onReorder('back') },
]

/** Traço fino separando grupos de ações — evita confundir "remover colisão" com o X de limpar seleção ao lado. */
function Divider() {
  return <div className="mx-0.5 h-5 w-px bg-outline-variant/40" />
}

/**
 * Barra de ações ancorada na seleção de mobília. Fica sobre o canvas, não no
 * drawer, para o olho não ir e voltar entre o móvel e o painel lateral.
 *
 * A posição é recalculada por `requestAnimationFrame` enquanto a barra existe:
 * a câmera do Phaser se move por scroll e zoom sem emitir um evento que dê
 * para assinar de fora, e a seleção é efêmera — o custo de um rAF durante a
 * edição é irrelevante perto do loop de render da cena que já roda.
 */
export default function SelectionToolbar(props: SelectionToolbarProps) {
  const { canvasRef, bounds } = props
  const [position, setPosition] = useState<ScreenPosition | null>(null)
  const boundsRef = useRef(bounds)
  boundsRef.current = bounds

  useEffect(() => {
    let frame: number
    const tick = () => {
      const scene = canvasRef.current?.getScene()
      const b = boundsRef.current
      const centerX = b.x + b.width / 2
      const topY = b.y
      // `null` (seleção rolou para fora do viewport) esconde a barra.
      const next = scene ? scene.worldToScreen(centerX, topY) : null
      // Evita `setPosition` (e o re-render de 60fps que isso causaria) quando
      // nada mudou de fato entre um frame e outro (câmera parada, seleção parada).
      setPosition((prev) =>
        prev?.x === next?.x && prev?.y === next?.y && prev?.zoom === next?.zoom ? prev : next,
      )
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
    // `canvasRef` fica de fora de propósito — é um RefObject estável (useRef).
    // Incluí-lo faria o efeito reiniciar sempre que um chamador passasse um
    // ref não memoizado, causando um loop de render (setPosition -> novo
    // objeto -> efeito recria -> setPosition). `bounds` também fica de fora:
    // o tick já lê o valor atual via `boundsRef` a cada frame, então
    // reiniciar o loop a cada mudança seria só custo sem benefício.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!position) return null

  return (
    <div
      className="pointer-events-auto absolute z-[75] flex -translate-x-1/2 -translate-y-full items-center gap-xs rounded-full border border-outline-variant/40 bg-surface-container-highest/95 px-xs py-xs shadow-xl backdrop-blur"
      style={{ left: position.x, top: position.y - 12 }}
    >
      {TRANSFORM_ACTIONS.map((action) => (
        <button
          key={action.icon}
          type="button"
          aria-label={action.label}
          title={`${action.label} (${action.hint})`}
          onClick={() => action.run(props)}
          className="flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
        >
          <Icon name={action.icon} className="text-[18px]" />
        </button>
      ))}
      <Divider />
      {LAYER_ACTIONS.map((action) => (
        <button
          key={action.icon}
          type="button"
          aria-label={action.label}
          title={action.label}
          onClick={() => action.run(props)}
          className="flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
        >
          <Icon name={action.icon} className="text-[18px]" />
        </button>
      ))}
      {props.hasCollision && (
        <>
          <Divider />
          <button
            type="button"
            aria-label="Remover colisão"
            title="Remover colisão — deixa a peça andável, sem apagá-la"
            onClick={props.onRemoveCollision}
            className="flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
          >
            <Icon name="directions_walk" className="text-[18px]" />
          </button>
        </>
      )}
      <Divider />
      <button
        type="button"
        aria-label="Limpar seleção"
        title="Limpar seleção (Esc)"
        onClick={props.onClear}
        className="flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
      >
        <Icon name="close" className="text-[18px]" />
      </button>
    </div>
  )
}

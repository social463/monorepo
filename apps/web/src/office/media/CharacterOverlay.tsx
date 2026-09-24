import { useCallback, useRef } from 'react'
import type { LocalVideoTrack, RemoteVideoTrack } from 'livekit-client'
import type { OfficeUserStatus } from '@legends/shared'
import type { ScreenPosition } from '../scenes/OfficeScene'
import { presenceStatusDotCls } from '../presence-status'

/** Tamanho do quadrado de vídeo (px) em zoom 1. */
const BUBBLE_BASE_SIZE = 64
/**
 * Deslocamento (px em zoom 1) do TOPO do quadrado/badge até a origem do
 * personagem (`position.y`, o centro do seu Container no Phaser). Precisa
 * ser maior que a altura do próprio quadrado (`BUBBLE_BASE_SIZE` + o
 * triângulo embaixo, ~71px) mais uma folga — senão cobre a cabeça do
 * personagem em vez de flutuar acima dela.
 */
const BUBBLE_BASE_OFFSET_Y = 90
/**
 * Mesma ideia de `BUBBLE_BASE_OFFSET_Y`, mas pro badge de nome (sem vídeo):
 * bem mais baixo que o quadrado de vídeo, então usar o mesmo offset deixava
 * um vão grande entre o balão e a cabeça do personagem.
 */
const NAME_BADGE_OFFSET_Y = 48

/**
 * Um quadrado só por personagem, flutuando sobre o canvas do Phaser
 * (posicionado por `useCharacterScreenPositions`), decidindo o conteúdo por
 * prioridade: tela compartilhada > câmera > badge de nome (com bolinha de
 * status). Nunca mais de um ao mesmo tempo — substitui os antigos
 * `CharacterVideoBubble` (só câmera) e `ScreenShareIndicator` (pill
 * separado ao lado), que competiam por espaços diferentes.
 */
export function CharacterOverlay({
  name,
  isGuest = false,
  status = 'online',
  isRoomManager = false,
  cameraTrack,
  screenTrack,
  mirrored = false,
  position,
  onClickScreen,
}: {
  name: string
  isGuest?: boolean
  status?: OfficeUserStatus
  /** Manda na sala em que está — desenha o selo ao lado do nome. */
  isRoomManager?: boolean
  cameraTrack: RemoteVideoTrack | LocalVideoTrack | null
  screenTrack: RemoteVideoTrack | LocalVideoTrack | null
  /** Espelha o vídeo (só faz sentido pra própria câmera, nunca pra tela). */
  mirrored?: boolean
  position: ScreenPosition | null
  /** Clique no quadrado quando ele mostra tela compartilhada — abre a grade de mídia. */
  onClickScreen?: () => void
}) {
  const showingScreen = screenTrack !== null
  const track = screenTrack ?? cameraTrack

  // Callback ref (não useEffect+useRef): o quadrado monta/desmonta o
  // <video> conforme a prioridade muda (tela liga/desliga, câmera liga/
  // desliga) ou `position` vira null/não-null — uma callback ref dispara
  // exatamente nesses momentos.
  const attachedElRef = useRef<HTMLVideoElement | null>(null)
  const setVideoRef = useCallback(
    (el: HTMLVideoElement | null) => {
      if (attachedElRef.current && track) track.detach(attachedElRef.current)
      attachedElRef.current = el
      if (el && track) track.attach(el)
    },
    [track],
  )

  if (!position) return null

  const wrapperStyle = (offsetY: number) => ({
    left: position.x,
    top: position.y - offsetY,
    transform: 'translateX(-50%)',
  })

  if (track) {
    const size = BUBBLE_BASE_SIZE * position.zoom
    const videoEl = (
      <video
        ref={setVideoRef}
        autoPlay
        playsInline
        muted={mirrored}
        className={`h-full w-full object-cover ${!showingScreen && mirrored ? 'scale-x-[-1]' : ''}`}
      />
    )
    return (
      <figure
        aria-label={showingScreen ? `Tela de ${name} — clique para ver` : name}
        className="pointer-events-none absolute flex flex-col items-center"
        style={wrapperStyle(BUBBLE_BASE_OFFSET_Y * position.zoom)}
      >
        {showingScreen ? (
          <button
            type="button"
            aria-label={`Tela de ${name} — clique para ver`}
            onClick={onClickScreen}
            className="pointer-events-auto overflow-hidden rounded-lg border-2 border-primary bg-black shadow-lg"
            style={{ width: size, height: size }}
          >
            {videoEl}
          </button>
        ) : (
          <div className="overflow-hidden rounded-lg border-2 border-primary bg-black shadow-lg" style={{ width: size, height: size }}>
            {videoEl}
          </div>
        )}
        <div className="-mt-px h-2 w-2 rotate-45 border-b-2 border-r-2 border-primary bg-black" />
      </figure>
    )
  }

  return (
    <figure
      aria-label={name}
      className="pointer-events-none absolute flex flex-col items-center"
      style={wrapperStyle(NAME_BADGE_OFFSET_Y * position.zoom)}
    >
      <span className="flex items-center gap-1 rounded-full bg-primary px-2 py-1 text-on-primary shadow-lg">
        <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${presenceStatusDotCls[status]}`} />
        <span className="max-w-[7rem] truncate font-label text-label-sm font-semibold">{name}</span>
        {isRoomManager && (
          <span
            aria-label="Responsável pela sala"
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-on-primary font-label text-[10px] font-semibold leading-none text-primary"
          >
            M
          </span>
        )}
        {isGuest && <span className="font-label text-[10px] font-semibold opacity-85">(Convidado)</span>}
      </span>
      <div className="-mt-px h-2 w-2 rotate-45 bg-primary" />
    </figure>
  )
}

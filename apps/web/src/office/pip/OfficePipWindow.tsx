import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { LocalVideoTrack, RemoteVideoTrack } from 'livekit-client'
import { Avatar } from '../../components/Avatar'
import { Icon } from '../../components/Icon'
import { useOfficeSession, type OfficeSessionValue } from '../session/OfficeSessionContext'

const MARGIN = 16
const MAX_TILES = 4
const DRAG_THRESHOLD_PX = 4

const pipToolCls = (active: boolean) =>
  `flex h-8 w-8 items-center justify-center rounded-lg border transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
    active
      ? 'border-primary/70 bg-primary/20 text-primary'
      : 'border-outline-variant/40 bg-surface-container-high text-on-surface-variant hover:text-on-surface'
  }`

/** Anexa um track de vídeo enquanto montado — irmão do RemoteAudio. */
function PipVideo({
  track,
  mirrored,
}: {
  track: LocalVideoTrack | RemoteVideoTrack
  mirrored: boolean
}) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    track.attach(el)
    return () => {
      track.detach(el)
    }
  }, [track])
  return (
    <video
      ref={ref}
      autoPlay
      muted
      playsInline
      className={`h-full w-full object-cover ${mirrored ? '-scale-x-100' : ''}`}
    />
  )
}

/**
 * Escritório minimizado: janelinha flutuante com câmeras + controles, viva em
 * qualquer rota que não seja o próprio escritório. Clique volta para a página;
 * o X encerra a sessão (a saída de verdade).
 */
export function OfficePipWindow() {
  const session = useOfficeSession()
  const location = useLocation()
  if (session.status !== 'active' || location.pathname === '/escritorio') return null
  return <PipWindowBody session={session} />
}

function PipWindowBody({ session }: { session: OfficeSessionValue }) {
  const navigate = useNavigate()
  const { media, broadcast, occupants, exitOffice } = session
  const containerRef = useRef<HTMLDivElement>(null)
  // Offset a partir da âncora (canto inferior direito); só em memória — volta
  // ao padrão ao remontar (reload ou passagem pelo /escritorio).
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragRef = useRef<{
    startX: number
    startY: number
    baseX: number
    baseY: number
    moved: boolean
  } | null>(null)

  const screenSharers: Array<{ key: string; name: string; track: LocalVideoTrack | RemoteVideoTrack }> = []
  if (media.localScreenTrack) {
    screenSharers.push({ key: 'local', name: 'Você', track: media.localScreenTrack })
  }
  for (const r of media.remotes) {
    if (r.screenTrack) screenSharers.push({ key: r.userId, name: r.name, track: r.screenTrack })
  }
  const featuredScreen =
    screenSharers.length > 0
      ? screenSharers.reduce((best, s) => {
          const bestOrder = media.screenShareOrder.get(best.key) ?? Infinity
          const sOrder = media.screenShareOrder.get(s.key) ?? Infinity
          return sOrder < bestOrder ? s : best
        })
      : null

  const tiles: Array<{
    key: string
    name: string
    track: LocalVideoTrack | RemoteVideoTrack
    mirrored: boolean
  }> = []
  if (media.cameraEnabled && media.localCameraTrack) {
    tiles.push({ key: 'you', name: 'Você', track: media.localCameraTrack, mirrored: true })
  }
  for (const r of media.remotes) {
    if (r.cameraTrack) tiles.push({ key: r.userId, name: r.name, track: r.cameraTrack, mirrored: false })
  }
  const visible = tiles.length > MAX_TILES ? tiles.slice(0, MAX_TILES - 1) : tiles
  const hiddenCount = tiles.length - visible.length

  const count = occupants.length
  const countLabel = count === 1 ? '1 pessoa no escritório' : `${count} pessoas no escritório`
  const mediaControlsDisabled = media.status !== 'connected'

  function clampOffset(next: { x: number; y: number }): { x: number; y: number } {
    const el = containerRef.current
    if (!el) return next
    const rect = el.getBoundingClientRect()
    const minX = Math.min(0, -(window.innerWidth - rect.width - MARGIN * 2))
    const minY = Math.min(0, -(window.innerHeight - rect.height - MARGIN * 2))
    return {
      x: Math.min(0, Math.max(minX, next.x)),
      y: Math.min(0, Math.max(minY, next.y)),
    }
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // Botões cuidam do próprio clique; arrastar/expandir é só no corpo.
    if ((event.target as HTMLElement).closest('button')) return
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      baseX: offset.x,
      baseY: offset.y,
      moved: false,
    }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // jsdom não implementa pointer capture — inofensivo em teste.
    }
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX) drag.moved = true
    setOffset(clampOffset({ x: drag.baseX + dx, y: drag.baseY + dy }))
  }

  function onPointerUp() {
    const drag = dragRef.current
    dragRef.current = null
    if (drag && !drag.moved) navigate('/escritorio')
  }

  return (
    <div
      ref={containerRef}
      role="complementary"
      aria-label="Escritório em miniatura"
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      className="fixed bottom-4 right-4 z-50 w-72 cursor-pointer touch-none select-none overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container/95 shadow-2xl backdrop-blur"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div className="flex items-center justify-between gap-sm px-md py-sm">
        <div className="flex min-w-0 items-center gap-xs">
          <Icon name="chair" className="shrink-0 text-[18px] text-primary" />
          <span className="truncate font-label text-label-sm text-on-surface">Escritório</span>
          {broadcast.speakers.length > 0 && (
            // Icon é decorativo por padrão (aria-hidden); o rótulo acessível
            // vai no wrapper, seguindo a convenção documentada no componente.
            <span aria-label="Alto-falante ativo" className="shrink-0">
              <Icon name="campaign" className="text-[18px] text-primary" />
            </span>
          )}
        </div>
        <div className="flex items-center gap-xs">
          <button
            type="button"
            aria-label="Voltar ao escritório"
            title="Voltar ao escritório"
            onClick={() => navigate('/escritorio')}
            className="flex h-7 w-7 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface"
          >
            <Icon name="open_in_full" className="text-[16px]" />
          </button>
          <button
            type="button"
            aria-label="Sair do escritório"
            title="Sair do escritório"
            onClick={exitOffice}
            className="flex h-7 w-7 items-center justify-center rounded-md text-on-surface-variant hover:bg-error/20 hover:text-error"
          >
            <Icon name="close" className="text-[16px]" />
          </button>
        </div>
      </div>

      {featuredScreen ? (
        <div className="relative aspect-video overflow-hidden bg-black">
          <PipVideo track={featuredScreen.track} mirrored={false} />
          <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 font-label text-[10px] text-white">
            Tela de {featuredScreen.name}
          </span>
        </div>
      ) : visible.length > 0 ? (
        <div
          className={`grid gap-px bg-outline-variant/20 ${
            visible.length + (hiddenCount > 0 ? 1 : 0) > 1 ? 'grid-cols-2' : 'grid-cols-1'
          }`}
        >
          {visible.map((tile) => (
            <div key={tile.key} className="relative aspect-video overflow-hidden bg-black">
              <PipVideo track={tile.track} mirrored={tile.mirrored} />
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 font-label text-[10px] text-white">
                {tile.name}
              </span>
            </div>
          ))}
          {hiddenCount > 0 && (
            <div className="flex aspect-video items-center justify-center bg-surface-container-high font-label text-label-md text-on-surface">
              +{hiddenCount}
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-sm px-md py-sm">
          <div className="flex -space-x-2">
            {/* Personagem, não foto: é a mesma regra do resto do escritório. */}
            {occupants.slice(0, 3).map((o) => (
              <span
                key={o.userId}
                className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border-2 border-surface-container bg-surface-container-high"
              >
                <Avatar preferCharacter user={o} initialsClassName="font-label text-[10px] text-on-surface" />
              </span>
            ))}
          </div>
          <p className="font-body text-body-sm text-on-surface-variant">{countLabel}</p>
        </div>
      )}

      <div className="flex items-center justify-center gap-xs border-t border-outline-variant/20 px-md py-sm">
        <button
          type="button"
          aria-label={media.micEnabled ? 'Silenciar microfone' : 'Ativar microfone'}
          title={media.micEnabled ? 'Silenciar microfone' : 'Ativar microfone'}
          disabled={mediaControlsDisabled}
          onClick={() => void media.toggleMic()}
          className={pipToolCls(media.micEnabled)}
        >
          <Icon name={media.micEnabled ? 'mic' : 'mic_off'} className="text-[18px]" />
        </button>
        <button
          type="button"
          aria-label={media.cameraEnabled ? 'Desligar câmera' : 'Ligar câmera'}
          title={media.cameraEnabled ? 'Desligar câmera' : 'Ligar câmera'}
          disabled={mediaControlsDisabled}
          onClick={() => void media.toggleCamera()}
          className={pipToolCls(media.cameraEnabled)}
        >
          <Icon name={media.cameraEnabled ? 'videocam' : 'videocam_off'} className="text-[18px]" />
        </button>
      </div>
    </div>
  )
}

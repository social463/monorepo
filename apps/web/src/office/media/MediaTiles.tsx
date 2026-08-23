import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { LocalVideoTrack, RemoteVideoTrack } from 'livekit-client'
import type { AvatarStyleKey, CharacterOptions, OfficeOccupant } from '@legends/shared'
import type { RemoteMedia } from './useOfficeMedia'
import type { RoomChatMessage } from './useRoomChat'
import { RoomChatPanel } from './RoomChatPanel'
import { RoomPeoplePanel } from './RoomPeoplePanel'
import { Icon } from '../../components/Icon'
import { Avatar, type AvatarSource } from '../../components/Avatar'
import { UserVolumeControl } from './UserVolumeControl'
import type { RemoteUserVolumeControls } from './remoteUserVolumePreferences'
import { AnnotationCanvas } from '../annotation/AnnotationCanvas'
import type { ScreenAnnotationsState } from '../annotation/useScreenAnnotations'
import { fullscreenElement, useFullscreen } from './useFullscreen'

const FEATURED_SIDEBAR_PAGE_SIZE = 6
const UNIFORM_GRID_PAGE_SIZE = 9

/**
 * Chip escuro dos controles que flutuam sobre vídeo. Não usa token de
 * superfície de propósito: o que está atrás é conteúdo arbitrário (tela clara,
 * câmera clara), não a superfície do tema.
 */
const OVERLAY_CHIP_CLS =
  'flex items-center justify-center rounded-full bg-black/65 text-white ring-1 ring-white/25 backdrop-blur-sm transition hover:bg-black/80'

/**
 * Botão de tela cheia de verdade. Some onde o navegador não suporta
 * (iOS), em vez de virar um botão morto.
 *
 * Fica só no canto da grade, um por tela. Chegou a existir um por tile,
 * aparecendo no hover, e foi retirado: no destaque ele caía exatamente em cima
 * deste, e fazia a mesma coisa que destacar + tela cheia já faz.
 */
function FullscreenButton({
  isFullscreen,
  supported,
  onToggle,
}: {
  isFullscreen: boolean
  supported: boolean
  onToggle: () => void
}) {
  if (!supported) return null
  return (
    <button
      type="button"
      aria-label={isFullscreen ? 'Sair da tela cheia' : 'Ver a grade em tela cheia'}
      title={isFullscreen ? 'Sair da tela cheia (Esc)' : 'Tela cheia'}
      onClick={onToggle}
      className={`${OVERLAY_CHIP_CLS} h-10 w-10`}
    >
      {/* Par de ícones diferente do `fullscreen_exit` do botão de recolher, que
          fica encostado neste — dois pares de setas iguais lado a lado não
          diriam qual é qual. */}
      <Icon name={isFullscreen ? 'close_fullscreen' : 'open_in_full'} className="text-[20px]" />
    </button>
  )
}

/** Selo de mão levantada (ícone + posição na fila), reaproveitado no tile de vídeo e no de avatar. */
function RaisedHandBadge({ position, className = 'left-0 top-0' }: { position: number; className?: string }) {
  return (
    <span
      className={`absolute z-10 flex h-6 min-w-6 items-center justify-center gap-0.5 rounded-full border-2 border-surface bg-yellow-400 px-1 ${className}`}
      aria-label={`Mão levantada — posição ${position} na fila`}
      title={`Mão levantada — posição ${position} na fila`}
    >
      <Icon name="back_hand" className="text-[12px] text-black" />
      <span className="font-label text-label-sm font-bold text-black">{position}</span>
    </span>
  )
}

/** Selo de mic aberto/mudo (com pulso enquanto fala), reaproveitado no tile de vídeo e no de avatar. */
function MicBadge({ micOpen, speaking }: { micOpen: boolean; speaking: boolean }) {
  return (
    <span
      className={`absolute bottom-0 right-0 z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 border-surface bg-surface-container-highest ${
        speaking ? 'mic-speaking' : ''
      }`}
      aria-label={micOpen ? 'Microfone aberto' : 'Microfone mudo'}
      title={micOpen ? 'Microfone aberto' : 'Microfone mudo'}
    >
      {/* O selo é uma superfície do tema (`surface-container-highest`), então o
          ícone mudo segue o token, não branco cravado: num tenant claro o
          branco sumia dentro do próprio selo. */}
      <Icon
        name={micOpen ? 'mic' : 'mic_off'}
        className={`text-[13px] ${micOpen ? 'text-primary' : 'text-on-surface-variant'}`}
      />
    </span>
  )
}

function pageItems<T>(items: T[], page: number, pageSize: number): T[] {
  return items.slice(page * pageSize, page * pageSize + pageSize)
}

function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize))
}

function PaginationControls({
  page,
  total,
  pageSize,
  onPageChange,
  label,
}: {
  page: number
  total: number
  pageSize: number
  onPageChange: (page: number) => void
  label: string
}) {
  if (total <= pageSize) return null
  const pages = pageCount(total, pageSize)
  const start = page * pageSize + 1
  const end = Math.min(total, (page + 1) * pageSize)
  return (
    <div className="flex shrink-0 items-center justify-center gap-xs rounded-full bg-white/10 px-xs py-xs text-white/85">
      <button
        type="button"
        aria-label={`Página anterior de ${label}`}
        disabled={page === 0}
        onClick={() => onPageChange(Math.max(0, page - 1))}
        className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Icon name="chevron_left" className="text-[20px]" />
      </button>
      <span className="min-w-[6.25rem] text-center font-label text-label-sm">
        {start}-{end} de {total}
      </span>
      <button
        type="button"
        aria-label={`Próxima página de ${label}`}
        disabled={page >= pages - 1}
        onClick={() => onPageChange(Math.min(pages - 1, page + 1))}
        className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Icon name="chevron_right" className="text-[20px]" />
      </button>
    </div>
  )
}

function VideoTile({
  track,
  label,
  mirrored = false,
  onClick,
  className = 'w-40 shrink-0',
  videoClassName = 'w-full',
  raisedIndex = null,
  speaking = false,
  micOpen = null,
  volumeControl = null,
  annotation = null,
}: {
  track: RemoteVideoTrack | LocalVideoTrack
  label: string
  mirrored?: boolean
  onClick?: () => void
  className?: string
  videoClassName?: string
  raisedIndex?: number | null
  speaking?: boolean
  /** `null` = tile sem mic próprio (ex.: tela compartilhada) — sem selo. */
  micOpen?: boolean | null
  volumeControl?: { value: number; onChange: (volume: number) => void } | null
  /** Overlay de riscar — só o tile de tela em destaque recebe. */
  annotation?: { sharerId: string; state: ScreenAnnotationsState; active: boolean } | null
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
    <figure className={`${className} cursor-pointer`} onClick={onClick}>
      <div className="relative min-h-0 flex-1">
        {raisedIndex !== null && <RaisedHandBadge position={raisedIndex + 1} />}
        <video
          ref={ref}
          autoPlay
          playsInline
          className={`${videoClassName} rounded-md bg-black ${mirrored ? 'scale-x-[-1]' : ''} ${
            raisedIndex !== null ? 'ring-4 ring-yellow-400' : ''
          }`}
        />
        {annotation && (
          <AnnotationCanvas
            sharerId={annotation.sharerId}
            annotations={annotation.state}
            active={annotation.active}
            videoRef={ref}
          />
        )}
        {volumeControl && (
          <UserVolumeControl
            name={label}
            volume={volumeControl.value}
            onVolumeChange={volumeControl.onChange}
            compact
            className="absolute left-2 top-2 z-20"
          />
        )}
        {micOpen !== null && <MicBadge micOpen={micOpen} speaking={speaking} />}
      </div>
      {/* O nome fica direto no palco preto, então segue o palco (branco), e não
          o `on-surface-variant` do tema — que num tenant claro é cinza escuro. */}
      <figcaption className="truncate font-label text-label-sm text-white/85">{label}</figcaption>
    </figure>
  )
}

function AvatarTile({
  user,
  label,
  onClick,
  className = 'w-40 shrink-0',
  fill = false,
  circle = false,
  speaking = false,
  micOpen = false,
  raisedIndex = null,
  volumeControl = null,
}: {
  user: AvatarSource
  label: string
  onClick?: () => void
  className?: string
  fill?: boolean
  /** Formato Meet-style (círculo + selo de mic) usado na grade uniforme e nos tiles de identidade do spotlight/sidebar. */
  circle?: boolean
  speaking?: boolean
  micOpen?: boolean
  raisedIndex?: number | null
  volumeControl?: { value: number; onChange: (volume: number) => void } | null
}) {
  return (
    <figure className={`${className} cursor-pointer`} onClick={onClick}>
      <div
        /*
         * O campo do tile é PALCO, não superfície do tema: `bg-white/10` sobre
         * o `bg-black/90` do overlay. Com `surface-container-highest` ele saía
         * quase branco num tenant claro e virava um retângulo ofuscante do
         * tamanho da tela — a marca continua no anel do avatar e no painel
         * lateral, que é onde ela é conteúdo. Translúcido de propósito: o mesmo
         * valor serve aos dois esquemas, sem alpha diferente por tenant.
         */
        className={`relative flex items-center justify-center overflow-hidden rounded-md bg-white/10 ${
          fill || circle ? 'min-h-0 w-full flex-1' : 'aspect-square w-full'
        }`}
      >
        {volumeControl && (
          <UserVolumeControl
            name={label}
            volume={volumeControl.value}
            onVolumeChange={volumeControl.onChange}
            compact
            className="absolute left-2 top-2 z-20"
          />
        )}
        {circle ? (
          <div className="relative flex aspect-square h-[65%] shrink-0 items-center justify-center">
            {speaking && (
              <>
                <span className="speaking-wave" style={{ animationDelay: '0s' }} aria-hidden="true" />
                <span className="speaking-wave" style={{ animationDelay: '0.5s' }} aria-hidden="true" />
                <span className="speaking-wave" style={{ animationDelay: '1s' }} aria-hidden="true" />
              </>
            )}
            {raisedIndex !== null && <RaisedHandBadge position={raisedIndex + 1} />}
            <div
              className={`relative h-full w-full overflow-hidden rounded-full border-4 bg-surface-container-highest ${
                raisedIndex !== null ? 'border-yellow-400' : 'border-primary'
              }`}
            >
              <Avatar preferCharacter user={user} initialsClassName="font-label text-label-lg font-bold text-primary" />
            </div>
            <MicBadge micOpen={micOpen} speaking={speaking} />
          </div>
        ) : (
          <div className="relative h-full w-full">
            <Avatar preferCharacter user={user} initialsClassName="font-label text-label-lg font-bold text-primary" />
          </div>
        )}
      </div>
      {/* O nome fica direto no palco preto, então segue o palco (branco), e não
          o `on-surface-variant` do tema — que num tenant claro é cinza escuro. */}
      <figcaption className="truncate font-label text-label-sm text-white/85">{label}</figcaption>
    </figure>
  )
}

type TileKind = 'camera' | 'screen' | 'avatar'

interface Tile {
  key: string
  userId: string | null
  kind: TileKind
  label: string
  track: RemoteVideoTrack | LocalVideoTrack | null
  mirrored: boolean
  avatar: AvatarSource
  sharerId: string | null
  speaking: boolean
  micOpen: boolean
  /** Posição (0-based) na fila de mãos levantadas, ou `null` se a pessoa não está com a mão levantada. */
  raisedIndex: number | null
}

function buildTiles(
  remotes: RemoteMedia[],
  local: {
    track: LocalVideoTrack | null
    screenTrack?: LocalVideoTrack | null
    name: string
    photoUrl?: string | null
    avatarStyle?: AvatarStyleKey | null
    avatarSeed?: string | null
    avatarOptions?: CharacterOptions | null
    micEnabled?: boolean
    speaking?: boolean
  } | null | undefined,
  raisedHandQueue: readonly string[],
  youId: string | null | undefined,
): Tile[] {
  const raisedIndexOf = (userId: string | null | undefined): number | null => {
    if (!userId) return null
    const index = raisedHandQueue.indexOf(userId)
    return index === -1 ? null : index
  }
  const tiles: Tile[] = []
  if (local) {
    // Tile de identidade (câmera ou avatar) sempre existe, independente de
    // estar compartilhando tela — compartilhar tela não deve "engolir" a
    // própria presença na grade.
    tiles.push({
      key: 'local',
      userId: youId ?? null,
      kind: local.track ? 'camera' : 'avatar',
      label: local.name,
      track: local.track,
      mirrored: true,
      avatar: local,
      sharerId: null,
      speaking: local.speaking ?? false,
      micOpen: local.micEnabled ?? false,
      raisedIndex: raisedIndexOf(youId),
    })
    if (local.screenTrack) {
      tiles.push({
        key: 'local-screen',
        userId: youId ?? null,
        kind: 'screen',
        label: `Tela de ${local.name}`,
        track: local.screenTrack,
        mirrored: false,
        avatar: local,
        sharerId: 'local',
        speaking: false,
        micOpen: false,
        raisedIndex: null,
      })
    }
  }
  for (const r of remotes) {
    if (r.cameraTrack) {
      tiles.push({
        key: `cam:${r.userId}`,
        userId: r.userId,
        kind: 'camera',
        label: r.name,
        track: r.cameraTrack,
        mirrored: false,
        avatar: r,
        sharerId: null,
        speaking: r.speaking,
        micOpen: r.micOpen,
        raisedIndex: raisedIndexOf(r.userId),
      })
    }
    if (r.screenTrack) {
      tiles.push({
        key: `screen:${r.userId}`,
        userId: r.userId,
        kind: 'screen',
        label: `Tela de ${r.name}`,
        track: r.screenTrack,
        mirrored: false,
        avatar: r,
        sharerId: r.userId,
        speaking: false,
        micOpen: false,
        raisedIndex: null,
      })
    }
    if (!r.cameraTrack) {
      tiles.push({
        key: `avatar:${r.userId}`,
        userId: r.userId,
        kind: 'avatar',
        label: r.name,
        track: null,
        mirrored: false,
        avatar: r,
        sharerId: null,
        speaking: r.speaking,
        micOpen: r.micOpen,
        raisedIndex: raisedIndexOf(r.userId),
      })
    }
  }
  return tiles
}

function earliestScreen(screens: Tile[], screenShareOrder: ReadonlyMap<string, number>): Tile {
  return screens.reduce((best, tile) => {
    const bestOrder = best.sharerId ? screenShareOrder.get(best.sharerId) ?? Infinity : Infinity
    const tileOrder = tile.sharerId ? screenShareOrder.get(tile.sharerId) ?? Infinity : Infinity
    return tileOrder < bestOrder ? tile : best
  })
}

function resolveFeatured(tiles: Tile[], pin: string | null, screenShareOrder: ReadonlyMap<string, number>): Tile | null {
  const pinned = pin ? tiles.find((t) => t.key === pin) : undefined
  if (pinned) return pinned
  const screens = tiles.filter((t) => t.kind === 'screen')
  // Sem pin nenhum ainda (grade recém-aberta): só uma tela compartilhada
  // justifica destacar algo sozinha — câmeras não roubam o grid uniforme.
  if (!pin) return screens.length > 0 ? earliestScreen(screens, screenShareOrder) : null
  // Pin existia mas o alvo sumiu (perdeu mídia/saiu): recupera pra qualquer
  // mídia ativa restante antes de desistir e voltar pro grid uniforme.
  if (screens.length > 0) return earliestScreen(screens, screenShareOrder)
  return tiles.find((t) => t.kind === 'camera') ?? null
}

/**
 * Grade de câmeras em tela cheia (Meet-style). Fora do modo `expanded`,
 * não renderiza nada visível (câmeras aparecem como quadrado sobre o
 * personagem no mapa — ver `CharacterOverlay`); esta grade existe só
 * pra quando alguém pede uma visão consolidada de todo mundo.
 */
export function MediaTiles({
  remotes,
  local,
  expanded = false,
  onToggleExpanded = () => {},
  showAllPresent = false,
  screenShareOrder = new Map(),
  roomPanel = null,
  roomChatMessages = [],
  canSendRoomChatMessage = false,
  onSendRoomChatMessage = () => false,
  roomOccupants = [],
  onCloseRoomPanel = () => {},
  raisedHandQueue = [],
  youId = null,
  remoteUserVolumes,
  annotations,
  onAnnotateStateChange,
}: {
  remotes: RemoteMedia[]
  local?: {
    track: LocalVideoTrack | null
    screenTrack?: LocalVideoTrack | null
    name: string
    photoUrl?: string | null
    avatarStyle?: AvatarStyleKey | null
    avatarSeed?: string | null
    avatarOptions?: CharacterOptions | null
    micEnabled?: boolean
    speaking?: boolean
  } | null
  expanded?: boolean
  onToggleExpanded?: () => void
  showAllPresent?: boolean
  screenShareOrder?: ReadonlyMap<string, number>
  roomPanel?: 'chat' | 'people' | null
  roomChatMessages?: RoomChatMessage[]
  canSendRoomChatMessage?: boolean
  onSendRoomChatMessage?: (text: string) => boolean
  roomOccupants?: OfficeOccupant[]
  onCloseRoomPanel?: () => void
  /** Fila de mãos levantadas da sala (userIds, na ordem em que levantaram) — usada só pra destacar tiles na grade. */
  raisedHandQueue?: readonly string[]
  youId?: string | null
  remoteUserVolumes?: RemoteUserVolumeControls
  /** Estado de anotação da sessão do escritório; ausente = feature indisponível nesta tela. */
  annotations?: ScreenAnnotationsState
  /**
   * O botão de "riscar" mora na MediaBar (não aqui) — só quem sabe se dá pra
   * riscar (tela em destaque?) é esta grade, então reporta o estado pra cima
   * a cada mudança em vez de renderizar o próprio botão.
   */
  onAnnotateStateChange?: (state: { canAnnotate: boolean; annotating: boolean; toggle: () => void }) => void
}) {
  // Tela cheia da grade inteira mira o DOCUMENTO, não o overlay: a MediaBar é
  // irmã do overlay (fica no OfficePage), então botar o overlay em tela cheia
  // esconderia justamente os controles de mic/câmera/sair.
  const pageRef = useRef<HTMLElement | null>(typeof document === 'undefined' ? null : document.documentElement)
  const page = useFullscreen(pageRef)
  const [featuredPin, setFeaturedPin] = useState<string | null>(null)
  const [featuredPage, setFeaturedPage] = useState(0)
  const [gridPage, setGridPage] = useState(0)
  const [annotating, setAnnotating] = useState(false)
  const toggleAnnotating = useCallback(() => setAnnotating((value) => !value), [])

  // Reseta o destaque toda vez que a grade expande de novo — nunca herda o
  // pin de uma sessão anterior de tela cheia.
  useEffect(() => {
    if (expanded) {
      setFeaturedPin(null)
      setFeaturedPage(0)
      setGridPage(0)
    }
  }, [expanded])

  const tiles = buildTiles(remotes, local, raisedHandQueue, youId)

  // Dentro de sala/zona (showAllPresent), presença já basta pra grade abrir
  // — quem não tem câmera/tela vira tile de avatar. Fora de sala, só mídia
  // ativa conta (evita abrir/manter aberta uma grade vazia sem contexto de
  // sala).
  const hasVisible = showAllPresent ? tiles.length > 0 : tiles.some((t) => t.kind !== 'avatar')

  // Ninguém mais tem câmera/tela visível enquanto a grade está aberta: recolhe
  // sozinha, senão fica uma grade vazia ocupando a tela.
  useEffect(() => {
    if (expanded && !hasVisible) onToggleExpanded()
  }, [expanded, hasVisible, onToggleExpanded])

  const featured = resolveFeatured(tiles, featuredPin, screenShareOrder)

  // Riscar só existe sobre tela compartilhada, e a identidade do dono é o
  // `userId` do tile — o `sharerId` do tile local é a string 'local', que não
  // serve como identidade na rede.
  const annotationSharerId =
    featured && featured.kind === 'screen' && featured.userId ? featured.userId : null
  const canAnnotate = expanded && annotations !== undefined && annotationSharerId !== null

  // Reporta pro botão da MediaBar. `toggleAnnotating` é estável (só usa o
  // setter de estado, que o React garante estável) — as deps aqui não
  // recriam o objeto reportado a cada render, só quando o estado real muda.
  useEffect(() => {
    onAnnotateStateChange?.({ canAnnotate, annotating, toggle: toggleAnnotating })
  }, [canAnnotate, annotating, onAnnotateStateChange, toggleAnnotating])

  // Roda sempre que `canAnnotate` ou `annotationSharerId` mudam — ou seja,
  // sempre que a grade recolhe, o destaque deixa de ser tela, ou o destaque
  // troca de uma tela pra outra (ex.: duas pessoas compartilhando e o clique
  // muda o alvo). `annotating` fica fora das deps de propósito: alternar o
  // próprio modo não pode, sozinho, disparar este reset.
  useEffect(() => {
    setAnnotating(false)
  }, [canAnnotate, annotationSharerId])

  const sidebarTiles = featured ? tiles.filter((t) => t.key !== featured.key) : []
  const sidebarPageCount = pageCount(sidebarTiles.length, FEATURED_SIDEBAR_PAGE_SIZE)
  const visibleSidebarTiles = pageItems(sidebarTiles, featuredPage, FEATURED_SIDEBAR_PAGE_SIZE)
  const gridPageCount = pageCount(tiles.length, UNIFORM_GRID_PAGE_SIZE)
  const visibleGridTiles = pageItems(tiles, gridPage, UNIFORM_GRID_PAGE_SIZE)
  const gridCols = Math.max(1, Math.ceil(Math.sqrt(visibleGridTiles.length)))
  const gridRows = Math.max(1, Math.ceil(visibleGridTiles.length / gridCols))

  useEffect(() => {
    if (featuredPage > sidebarPageCount - 1) setFeaturedPage(sidebarPageCount - 1)
  }, [featuredPage, sidebarPageCount])

  useEffect(() => {
    if (gridPage > gridPageCount - 1) setGridPage(gridPageCount - 1)
  }, [gridPage, gridPageCount])

  useEffect(() => {
    setFeaturedPage(0)
  }, [featured?.key])

  // Destaque automático (Fluxo 1, tela compartilhada no cold-start) só existe
  // "de fato" quando comprometido no pin — senão, ao a tela sumir, a
  // recuperação (Fluxo 4) não consegue distinguir "nunca destacou nada" de
  // "algo era destacado e sumiu", e cai direto pro grid uniforme mesmo
  // havendo outra câmera ativa. Comprometer o resultado automático assim que
  // ele aparece resolve isso sem duplicar a lógica de fallback.
  useEffect(() => {
    if (expanded && featuredPin === null && featured) setFeaturedPin(featured.key)
  }, [expanded, featuredPin, featured])

  // Nota: diferente de uma versão anterior (que tinha um dialog separado só
  // pra tela compartilhada), aqui um pin comprometido que ficou "stale"
  // (alvo sumiu, destaque recuperou pra outro tile) pode ressurgir se aquele
  // mesmo alvo voltar a ter mídia — decisão deliberada, no estilo Meet:
  // reapresentar uma tela chama atenção de novo.

  // Esc fecha a grade em tela cheia, mesmo padrão usado no CharacterCard. Com
  // o modo de riscar ligado, P alterna o modo e o primeiro Esc só sai dele.
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable === true
      if (e.key === 'Escape') {
        // Em tela cheia, Esc é do navegador — ele sai da tela cheia e a grade
        // continua aberta. Sem esta guarda, um único Esc faria as duas coisas
        // nos navegadores que ainda entregam o evento à página (o Chrome não
        // entrega; o Firefox entrega).
        if (fullscreenElement()) return
        // Com o modo ligado, Esc é "saia de riscar" — fechar a grade fica pro
        // segundo Esc, senão some tudo de uma vez sem querer.
        if (annotating) setAnnotating(false)
        else onToggleExpanded()
        return
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key.toLowerCase() === 'p' && canAnnotate) setAnnotating((value) => !value)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded, onToggleExpanded, annotating, canAnnotate])

  const volumeControlFor = (tile: Tile) => {
    if (!remoteUserVolumes || !tile.userId || tile.userId === youId || tile.kind === 'screen') return null
    return {
      value: remoteUserVolumes.getUserVolume(tile.userId),
      onChange: (volume: number) => remoteUserVolumes.setUserVolume(tile.userId!, volume),
    }
  }

  return (
    <div>
      {expanded && hasVisible && createPortal(
        <div
          className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-black/90"
          role="region"
          aria-label="Câmeras em tela cheia"
        >
          <div className="flex min-h-0 flex-1">
            {/* `relative` aqui (não mais fixed à viewport): o botão fica
                preso ao canto da área central, que encolhe quando o painel
                lateral abre — nunca mais fica atrás do X do painel. */}
            {/* `pb-24` (bem maior que o `p-lg` dos outros lados): reserva
                espaço pro MediaBar, que fica fixo por cima da grade
                (z-[60] em OfficePage) — sem isso, a última fileira de tiles
                fica escondida atrás da barra de controles. */}
            <div className="relative min-w-0 flex-1 overflow-hidden p-lg pb-24">
              <div className="absolute right-4 top-4 z-10 flex items-center gap-sm">
                <FullscreenButton
                  isFullscreen={page.isFullscreen}
                  supported={page.supported}
                  onToggle={page.toggle}
                />
                <button
                  type="button"
                  aria-label="Recolher câmeras"
                  onClick={onToggleExpanded}
                  // Fundo opaco escuro, e não `bg-white/10`: o botão flutua sobre
                  // conteúdo arbitrário (tela compartilhada clara, câmera clara),
                  // onde branco translúcido sobre claro sumia. Aqui não cabe token
                  // de superfície — o que está atrás é vídeo, não a superfície do
                  // tema.
                  className={`${OVERLAY_CHIP_CLS} h-10 w-10`}
                >
                  <Icon name="fullscreen_exit" className="text-[22px]" />
                </button>
              </div>
              {featured ? (
                <div className="flex h-full min-h-0 flex-col gap-md lg:flex-row">
                  <div className="flex min-w-0 flex-1 flex-col" data-testid="featured-tile">
                    {featured.kind === 'avatar' ? (
                      <AvatarTile
                        user={featured.avatar}
                        label={featured.label}
                        className="flex h-full flex-1 flex-col"
                        fill
                        circle
                        speaking={featured.speaking}
                        micOpen={featured.micOpen}
                        raisedIndex={featured.raisedIndex}
                        volumeControl={volumeControlFor(featured)}
                        // Clicar no destaque desfaz o pin e volta pro grid
                        // uniforme — só faz sentido pra pessoa (avatar/câmera);
                        // tela compartilhada sempre reassume o destaque
                        // sozinha (ver `resolveFeatured`), então não ganha
                        // esse clique.
                        onClick={() => setFeaturedPin(null)}
                      />
                    ) : (
                      <VideoTile
                        track={featured.track!}
                        label={featured.label}
                        mirrored={featured.mirrored}
                        className="flex h-full flex-1 flex-col"
                        videoClassName="h-full w-full object-contain"
                        raisedIndex={featured.raisedIndex}
                        speaking={featured.speaking}
                        micOpen={featured.kind === 'camera' ? featured.micOpen : null}
                        volumeControl={volumeControlFor(featured)}
                        annotation={
                          annotations && annotationSharerId
                            ? { sharerId: annotationSharerId, state: annotations, active: annotating }
                            : null
                        }
                        onClick={featured.kind === 'camera' ? () => setFeaturedPin(null) : undefined}
                      />
                    )}
                  </div>
                  <div className="flex min-h-32 shrink-0 flex-col gap-sm lg:h-full lg:w-56 lg:min-h-0">
                    <div
                      className="flex min-h-0 flex-1 gap-sm overflow-x-auto pb-1 lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto lg:pb-0"
                      data-testid="featured-sidebar"
                    >
                      {visibleSidebarTiles.map((t) =>
                        t.kind === 'avatar' ? (
                          <AvatarTile
                            key={t.key}
                            user={t.avatar}
                            label={t.label}
                            className="flex h-32 w-44 shrink-0 flex-col lg:h-40 lg:w-full"
                            fill
                            circle
                            speaking={t.speaking}
                            micOpen={t.micOpen}
                            raisedIndex={t.raisedIndex}
                            volumeControl={volumeControlFor(t)}
                            onClick={() => setFeaturedPin(t.key)}
                          />
                        ) : (
                          <VideoTile
                            key={t.key}
                            track={t.track!}
                            label={t.label}
                            mirrored={t.mirrored}
                            className="flex h-32 w-44 shrink-0 flex-col lg:h-40 lg:w-full"
                            videoClassName="h-full w-full object-contain"
                            raisedIndex={t.raisedIndex}
                            speaking={t.speaking}
                            micOpen={t.kind === 'camera' ? t.micOpen : null}
                            volumeControl={volumeControlFor(t)}
                            onClick={() => setFeaturedPin(t.key)}
                          />
                        ),
                      )}
                    </div>
                    <PaginationControls
                      page={featuredPage}
                      total={sidebarTiles.length}
                      pageSize={FEATURED_SIDEBAR_PAGE_SIZE}
                      onPageChange={setFeaturedPage}
                      label="participantes"
                    />
                  </div>
                </div>
              ) : (
                <div className="flex h-full min-h-0 w-full flex-col gap-sm">
                  <div
                    className="grid min-h-0 flex-1 gap-md"
                    data-testid="uniform-grid"
                    style={{
                      gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))`,
                      gridTemplateRows: `repeat(${gridRows}, minmax(0, 1fr))`,
                    }}
                  >
                    {visibleGridTiles.map((tile) =>
                      tile.kind === 'avatar' ? (
                        <AvatarTile
                          key={tile.key}
                          user={tile.avatar}
                          label={tile.label}
                          className="flex h-full min-h-0 min-w-0 flex-col"
                          circle
                          speaking={tile.speaking}
                          micOpen={tile.micOpen}
                          raisedIndex={tile.raisedIndex}
                          volumeControl={volumeControlFor(tile)}
                          onClick={() => setFeaturedPin(tile.key)}
                        />
                      ) : (
                        <VideoTile
                          key={tile.key}
                          track={tile.track!}
                          label={tile.label}
                          mirrored={tile.mirrored}
                          className="flex h-full min-h-0 min-w-0 flex-col"
                          videoClassName="h-full w-full object-contain"
                          raisedIndex={tile.raisedIndex}
                          speaking={tile.speaking}
                          micOpen={tile.kind === 'camera' ? tile.micOpen : null}
                          volumeControl={volumeControlFor(tile)}
                          onClick={() => setFeaturedPin(tile.key)}
                        />
                      ),
                    )}
                  </div>
                  <PaginationControls
                    page={gridPage}
                    total={tiles.length}
                    pageSize={UNIFORM_GRID_PAGE_SIZE}
                    onPageChange={setGridPage}
                    label="câmeras"
                  />
                </div>
              )}
            </div>
            {/* Superfície do painel lateral em TOKEN, não cinza cravado: o
                conteúdo (chat/pessoas) é todo `text-on-surface`, então num
                tenant de tema claro o texto escuro sumia dentro do cinza
                escuro fixo que estava aqui. O painel segue a marca; o palco
                atrás é que é sempre escuro, como em qualquer sala de vídeo. */}
            {roomPanel && (
              <aside className="flex w-[360px] shrink-0 flex-col overflow-y-auto border-l border-outline-variant bg-surface-container">
                {roomPanel === 'chat' ? (
                  <RoomChatPanel
                    messages={roomChatMessages}
                    occupants={roomOccupants}
                    canSend={canSendRoomChatMessage}
                    onSendMessage={onSendRoomChatMessage}
                    onClose={onCloseRoomPanel}
                  />
                ) : (
                  <RoomPeoplePanel
                    occupants={roomOccupants}
                    youId={youId}
                    remoteUserVolumes={remoteUserVolumes}
                    onClose={onCloseRoomPanel}
                  />
                )}
              </aside>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}

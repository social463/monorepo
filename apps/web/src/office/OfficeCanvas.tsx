import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { MapDocumentV1, OfficeDeskDTO, OfficeDeskReminderSummaryDTO, OfficeMapAssetDTO } from '@legends/shared'
import type { OfficeBridge } from './OfficeBridge'
import { sameLockedZones, type ZoneLockKind } from './lockedZones'
import type { OfficeScene, ScreenPosition } from './scenes/OfficeScene'

/** Fallback ESTÁVEL: mapa vazio novo a cada render dispararia redesenho. */
const EMPTY_LOCKED_ZONES: ReadonlyMap<string, ZoneLockKind> = new Map()

export interface OfficeCanvasHandle {
  /** Posição de tela do personagem `userId` agora, ou `null` se não existir/estiver fora do viewport. */
  getScreenPosition(userId: string): ScreenPosition | null
  /** Cena Phaser viva, para chamadas imperativas de edição (Task C3/C4). `null` até o mount assíncrono terminar. */
  getScene(): OfficeScene | null
  /** Posição de tela da mesa `externalKey` agora, ou `null` se não existir/estiver fora do viewport. */
  getDeskScreenPosition(externalKey: string): ScreenPosition | null
  /** Aplica o zoom ancorado num ponto em coordenadas de CLIENTE (ex.: `event.clientX/Y` do wheel) — mantém o ponto sob o cursor fixo. */
  zoomAtClientPoint(zoom: number, clientX: number, clientY: number): void
  /** Inicia a escolha livre da posição de um presente dentro da mesa. */
  startDeskReminderPlacement(externalKey: string, onConfirm: (position: { x: number; y: number }) => void): boolean
  /** Cancela a escolha livre da posição de um presente, se estiver ativa. */
  cancelDeskReminderPlacement(): void
}

interface OfficeCanvasProps {
  bridge: OfficeBridge
  zoom: number
  inputLocked?: boolean
  focusUserId?: string | null
  floatingReactionsActive?: boolean
  document: MapDocumentV1
  assets: OfficeMapAssetDTO[]
  desks: OfficeDeskDTO[]
  deskReminders: OfficeDeskReminderSummaryDTO[]
  /**
   * Salas que aparecem trancadas no mapa, por `externalKey` (ver
   * `lockedZonesByExternalKey`). Vale pra todo mundo, não só pra quem está
   * dentro da sala.
   */
  lockedZones?: ReadonlyMap<string, ZoneLockKind>
  /**
   * Menor zoom que ainda afasta de verdade neste mapa/janela — quem calcula é
   * a cena (`computeMinCameraZoom`), porque só ela conhece o viewport do
   * Phaser. Reemitido quando a janela muda de tamanho.
   */
  onMinZoomChange?: (minZoom: number) => void
}

/**
 * Monta o jogo UMA vez e o destrói no unmount. O `bridge` é a única via de
 * comunicação — nenhuma prop que muda entra aqui, então o React nunca
 * re-renderiza o Phaser.
 *
 * O `import()` dinâmico mantém o Phaser (~350 kB gzip) fora do bundle principal:
 * só quem abre o escritório paga por ele.
 *
 * Expõe `getScreenPosition` via `forwardRef` — é a única leitura de estado
 * que o React precisa fazer de volta do Phaser (pra posicionar balões de
 * vídeo por cima do canvas); tudo o mais é bridge (dados de jogo) ou
 * chamada de método imperativa (comandos de UI: zoom, foco, lock).
 */
export const OfficeCanvas = forwardRef<OfficeCanvasHandle, OfficeCanvasProps>(function OfficeCanvas(
  { bridge, zoom, inputLocked = false, focusUserId = null, floatingReactionsActive = false, document, assets, desks, deskReminders, lockedZones, onMinZoomChange },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<import('./scenes/OfficeScene').OfficeScene | null>(null)
  const zoomRef = useRef(zoom)
  const inputLockedRef = useRef(inputLocked)
  const focusUserIdRef = useRef<string | null>(focusUserId)
  const floatingReactionsActiveRef = useRef(floatingReactionsActive)
  const latestDocumentRef = useRef(document)
  const latestAssetsRef = useRef(assets)
  const latestDesksRef = useRef(desks)
  const latestDeskRemindersRef = useRef(deskReminders)
  const onMinZoomChangeRef = useRef(onMinZoomChange)
  const lockedZonesRef = useRef<ReadonlyMap<string, ZoneLockKind>>(lockedZones ?? EMPTY_LOCKED_ZONES)

  onMinZoomChangeRef.current = onMinZoomChange
  latestDocumentRef.current = document
  latestAssetsRef.current = assets
  latestDesksRef.current = desks
  latestDeskRemindersRef.current = deskReminders
  inputLockedRef.current = inputLocked

  useImperativeHandle(
    ref,
    () => ({
      getScreenPosition: (userId: string) => sceneRef.current?.getScreenPosition(userId) ?? null,
      getScene: () => sceneRef.current,
      getDeskScreenPosition: (externalKey: string) => sceneRef.current?.getDeskScreenPosition(externalKey) ?? null,
      zoomAtClientPoint: (zoom: number, clientX: number, clientY: number) => {
        const scene = sceneRef.current
        const host = hostRef.current
        if (!scene || !host) return
        const rect = host.getBoundingClientRect()
        zoomRef.current = zoom
        scene.setCameraZoomAt(zoom, clientX - rect.left, clientY - rect.top)
      },
      startDeskReminderPlacement: (externalKey, onConfirm) => (
        sceneRef.current?.startDeskReminderPlacement(externalKey, onConfirm) ?? false
      ),
      cancelDeskReminderPlacement: () => sceneRef.current?.cancelDeskReminderPlacement(),
    }),
    [],
  )

  useEffect(() => {
    zoomRef.current = zoom
    sceneRef.current?.setCameraZoom(zoom)
  }, [zoom])

  useEffect(() => {
    // Compara antes de mandar: `lockedZones` costuma nascer novo a cada render
    // do pai, e reenviar à cena redesenharia cadeado à toa (ver `sameDesks`).
    const next = lockedZones ?? EMPTY_LOCKED_ZONES
    if (sameLockedZones(lockedZonesRef.current, next)) return
    lockedZonesRef.current = next
    sceneRef.current?.setLockedZones(next)
  }, [lockedZones])

  useEffect(() => {
    focusUserIdRef.current = focusUserId
    sceneRef.current?.setFocusUser(focusUserId)
  }, [focusUserId])

  useEffect(() => {
    floatingReactionsActiveRef.current = floatingReactionsActive
    sceneRef.current?.setFloatingReactionsActive(floatingReactionsActive)
  }, [floatingReactionsActive])

  useEffect(() => {
    bridge.setMovementLocked(inputLocked)
    sceneRef.current?.setInputLocked(inputLocked)
    return () => {
      bridge.setMovementLocked(false)
    }
  }, [bridge, inputLocked])

  useEffect(() => {
    let game: import('phaser').Game | null = null
    let resizeObserver: ResizeObserver | null = null
    let cancelled = false

    void (async () => {
      const [{ default: Phaser }, { OfficeScene }] = await Promise.all([
        import('phaser'),
        import('./scenes/OfficeScene'),
      ])
      if (cancelled || !hostRef.current) return

      const latestDocument = latestDocumentRef.current
      const scene = new OfficeScene(
        bridge,
        latestDocument,
        latestAssetsRef.current,
        latestDesksRef.current,
        latestDeskRemindersRef.current,
      )
      scene.setMinCameraZoomListener((minZoom) => onMinZoomChangeRef.current?.(minZoom))
      scene.setLockedZones(lockedZonesRef.current)
      scene.setCameraZoom(zoomRef.current)
      scene.setInputLocked(inputLockedRef.current)
      scene.setFocusUser(focusUserIdRef.current)
      scene.setFloatingReactionsActive(floatingReactionsActiveRef.current)
      sceneRef.current = scene
      const width = hostRef.current.clientWidth || latestDocument.map.width * latestDocument.map.tileWidth
      const height = hostRef.current.clientHeight || latestDocument.map.height * latestDocument.map.tileHeight
      game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: hostRef.current,
        width,
        height,
        backgroundColor: '#15151a',
        pixelArt: true,
        scale: {
          mode: Phaser.Scale.RESIZE,
        },
        scene,
      })

      resizeObserver = new ResizeObserver(([entry]) => {
        const { width: nextWidth, height: nextHeight } = entry.contentRect
        if (nextWidth > 0 && nextHeight > 0) {
          game?.scale.resize(nextWidth, nextHeight)
        }
      })
      resizeObserver.observe(hostRef.current)
    })()

    return () => {
      cancelled = true
      resizeObserver?.disconnect()
      game?.destroy(true)
      game = null
      sceneRef.current = null
    }
    // A cena é criada UMA vez por `bridge`. Mudanças de `document`/`assets`
    // (publicação de decoração) atualizam o mapa in-place via `applyMap` no
    // efeito abaixo, sem remontar a cena nem mexer nas pessoas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bridge])

  // Publicação de decoração (caminho suave): atualiza o mapa no lugar.
  useEffect(() => {
    void sceneRef.current?.applyMap(document, assets)
  }, [document, assets])

  useEffect(() => {
    sceneRef.current?.setDeskReminders(deskReminders)
  }, [deskReminders])

  return (
    <div
      ref={hostRef}
      className="h-full w-full overflow-hidden bg-surface-container-highest"
      aria-label="Mapa do escritório"
    />
  )
})

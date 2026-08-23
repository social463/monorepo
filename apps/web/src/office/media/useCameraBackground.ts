import { useCallback, useEffect, useRef, useState } from 'react'
import type { LocalVideoTrack } from 'livekit-client'
import {
  CAMERA_BACKGROUNDS,
  CAMERA_BACKGROUND_STORAGE_KEY,
  isCameraBackgroundId,
  type CameraBackgroundId,
} from './camera-backgrounds'
import { loadTrackProcessors } from './track-processors-loader'

const BLUR_RADII = { 'blur-leve': 5, 'blur-forte': 15 } as const

// Self-host parcial do MediaPipe: o fileset WASM (vendorizado de
// @mediapipe/tasks-vision/wasm, ver apps/web/scripts/vendor-mediapipe-assets.mjs)
// é servido pelo próprio host em vez do CDN jsdelivr default do pacote. O
// modelo de segmentação (.tflite) continua vindo do CDN do Google (não é
// vendorizável: não é parte de nenhum pacote instalado localmente) — ver
// docs/superpowers/specs/2026-07-16-camera-fundo-virtual-design.md ("Casos de
// borda") para o detalhe da decisão.
const MEDIAPIPE_ASSETS_PATH = '/mediapipe-vision'
const MEDIAPIPE_ASSET_PATHS = { tasksVisionFileSet: MEDIAPIPE_ASSETS_PATH }

export interface CameraBackgroundState {
  background: CameraBackgroundId
  setBackground(id: CameraBackgroundId): void
  supported: boolean
  error: boolean
}

/** Pré-checagem barata: os processors exigem insertable streams do browser. */
function hasInsertableStreams(): boolean {
  const w = window as unknown as Record<string, unknown>
  return (
    typeof w.MediaStreamTrackProcessor === 'function' &&
    typeof w.MediaStreamTrackGenerator === 'function'
  )
}

function readStoredBackground(): CameraBackgroundId {
  const raw = localStorage.getItem(CAMERA_BACKGROUND_STORAGE_KEY)
  return isCameraBackgroundId(raw) ? raw : 'none'
}

/**
 * Dono do efeito de fundo da câmera. Declarativo: o efeito garante que o
 * processor do track atual corresponde à escolha — religar a câmera (track
 * novo) reaplica sozinho. A escolha persiste em localStorage por dispositivo.
 * O efeito vai no track PUBLICADO: todos os participantes veem o fundo.
 */
export function useCameraBackground(
  localCameraTrack: LocalVideoTrack | null,
  backgroundOverride?: CameraBackgroundId,
): CameraBackgroundState {
  const [background, setBackgroundState] = useState<CameraBackgroundId>(readStoredBackground)
  const effectiveBackground = backgroundOverride ?? background
  const [supported, setSupported] = useState(hasInsertableStreams)
  const [error, setError] = useState(false)
  // Geração invalida aplicações em voo quando track/escolha mudam no meio de
  // um await (mesmo padrão do useOfficeMedia).
  const generationRef = useRef(0)

  const setBackground = useCallback(
    (id: CameraBackgroundId) => {
      if (!supported && id !== 'none') return
      setError(false)
      setBackgroundState(id)
      localStorage.setItem(CAMERA_BACKGROUND_STORAGE_KEY, id)
    },
    [supported],
  )

  useEffect(() => {
    const track = localCameraTrack
    if (!track) {
      // Track sumiu (câmera desligada): ninguém vai rodar o effect para
      // invalidar uma aplicação em voo — incrementamos a geração nós mesmos,
      // senão a continuação pendente aplica num track já descartado.
      generationRef.current += 1
      return
    }
    const gen = ++generationRef.current
    void (async () => {
      try {
        if (effectiveBackground === 'none') {
          await track.stopProcessor()
          return
        }
        const processors = await loadTrackProcessors()
        if (gen !== generationRef.current) return
        if (!processors.supportsBackgroundProcessors()) {
          setSupported(false)
          setBackgroundState('none')
          localStorage.setItem(CAMERA_BACKGROUND_STORAGE_KEY, 'none')
          return
        }
        // BackgroundProcessor (não os deprecated BackgroundBlur/VirtualBackground)
        // é o único jeito de passar assetPaths — os helpers legados não o expõem.
        const processor =
          effectiveBackground === 'blur-leve' || effectiveBackground === 'blur-forte'
            ? processors.BackgroundProcessor({
                mode: 'background-blur',
                blurRadius: BLUR_RADII[effectiveBackground],
                assetPaths: MEDIAPIPE_ASSET_PATHS,
              })
            : processors.BackgroundProcessor({
                mode: 'virtual-background',
                imagePath:
                  CAMERA_BACKGROUNDS.find((bg) => `img:${bg.id}` === effectiveBackground)?.src ?? '',
                assetPaths: MEDIAPIPE_ASSET_PATHS,
              })
        await track.setProcessor(processor)
      } catch {
        if (gen !== generationRef.current) return
        // Falha ao aplicar (WASM não carregou, GPU): avisa e volta ao natural.
        setError(true)
        setBackgroundState('none')
        localStorage.setItem(CAMERA_BACKGROUND_STORAGE_KEY, 'none')
        void track.stopProcessor().catch(() => {})
      }
    })()
  }, [localCameraTrack, effectiveBackground])

  return { background: effectiveBackground, setBackground, supported, error }
}

import type { OfficeAnnotationPoint } from '@legends/shared'

/** Retângulo em pixels, relativo ao canto do elemento de vídeo. */
export interface AnnotationRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Área realmente ocupada pelo conteúdo dentro do `<video>`. O tile usa
 * `object-contain`, então o vídeo é centralizado com barras (letterbox) quando
 * as proporções não batem — desenhar em cima da barra não faria sentido, e
 * normalizar pelo elemento faria o traço escorregar entre janelas de tamanhos
 * diferentes.
 */
export function videoContentRect(video: {
  videoWidth: number
  videoHeight: number
  clientWidth: number
  clientHeight: number
}): AnnotationRect {
  const { videoWidth, videoHeight, clientWidth, clientHeight } = video
  // Metadados ainda não chegaram: o elemento inteiro é a melhor aproximação.
  if (videoWidth <= 0 || videoHeight <= 0) {
    return { left: 0, top: 0, width: clientWidth, height: clientHeight }
  }
  const scale = Math.min(clientWidth / videoWidth, clientHeight / videoHeight)
  const width = videoWidth * scale
  const height = videoHeight * scale
  return { left: (clientWidth - width) / 2, top: (clientHeight - height) / 2, width, height }
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/** Pixel do elemento → fração 0–1 do conteúdo, presa às bordas. */
export function toNormalized(px: { x: number; y: number }, rect: AnnotationRect): OfficeAnnotationPoint {
  return {
    x: rect.width > 0 ? clamp01((px.x - rect.left) / rect.width) : 0,
    y: rect.height > 0 ? clamp01((px.y - rect.top) / rect.height) : 0,
  }
}

/** Fração 0–1 do conteúdo → pixel do elemento. */
export function toLocal(point: OfficeAnnotationPoint, rect: AnnotationRect): { x: number; y: number } {
  return { x: rect.left + point.x * rect.width, y: rect.top + point.y * rect.height }
}

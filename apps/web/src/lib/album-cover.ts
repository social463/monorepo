import type { CSSProperties } from 'react'
import type { EventAlbumCover } from '@legends/shared'

/**
 * Estilo da capa a partir do enquadramento gravado.
 *
 * Vive fora das duas telas porque o editor (admin) e a grade (galeria) PRECISAM
 * renderizar igual: o ajuste só vale se o que a pessoa vê ao arrastar o controle
 * for o que o time vê na galeria. Duas cópias divergiriam na primeira mudança.
 *
 * `transformOrigin` acompanha a posição vertical de propósito — sem isso, o zoom
 * cresceria sempre a partir do meio e empurraria para fora justamente a parte
 * que a pessoa acabou de escolher.
 */
export function coverImageStyle(cover: EventAlbumCover): CSSProperties {
  return {
    objectFit: cover.fit === 'CONTAIN' ? 'contain' : 'cover',
    objectPosition: `center ${cover.positionY}%`,
    transform: `scale(${cover.scale / 100})`,
    transformOrigin: `center ${cover.positionY}%`,
  }
}

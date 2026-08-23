import {
  EVENT_ALBUM_COVER_POSITION_MAX,
  EVENT_ALBUM_COVER_POSITION_MIN,
  EVENT_ALBUM_COVER_SCALE_MAX,
  EVENT_ALBUM_COVER_SCALE_MIN,
  type EventAlbumCover,
} from '@legends/shared'
import { coverImageStyle } from '../lib/album-cover'

/**
 * Ajuste de enquadramento da capa: modo, zoom e posição vertical, com prévia no
 * mesmo formato do card da galeria (16:9).
 *
 * "Encaixar" existe para arte de divulgação, que não pode ter as bordas
 * cortadas; "Preencher" é o caso comum da foto de evento. O zoom continua
 * valendo nos dois: em "Encaixar" ele aproxima dentro da sobra.
 */
export function CoverFramer({
  url,
  value,
  onChange,
}: {
  url: string
  value: EventAlbumCover
  onChange: (next: EventAlbumCover) => void
}) {
  return (
    <div className="flex flex-col gap-sm">
      <div className="overflow-hidden rounded-lg border border-outline-variant/40 bg-surface-container">
        <img
          src={url}
          alt="Prévia da capa"
          className="aspect-video w-full"
          style={coverImageStyle(value)}
        />
      </div>

      <div role="group" aria-label="Modo de enquadramento" className="flex gap-sm">
        <button
          type="button"
          aria-pressed={value.fit === 'COVER'}
          onClick={() => onChange({ ...value, fit: 'COVER' })}
          className={`rounded-md border px-3 py-1 font-label text-label-sm ${
            value.fit === 'COVER'
              ? 'border-primary bg-primary text-on-primary'
              : 'border-outline-variant/40 text-on-surface'
          }`}
        >
          Preencher
        </button>
        <button
          type="button"
          aria-pressed={value.fit === 'CONTAIN'}
          onClick={() => onChange({ ...value, fit: 'CONTAIN' })}
          className={`rounded-md border px-3 py-1 font-label text-label-sm ${
            value.fit === 'CONTAIN'
              ? 'border-primary bg-primary text-on-primary'
              : 'border-outline-variant/40 text-on-surface'
          }`}
        >
          Encaixar (sem cortar)
        </button>
      </div>

      <label className="flex items-center gap-sm text-body-sm text-on-surface-variant">
        <span className="w-24 shrink-0">Zoom</span>
        <input
          type="range"
          aria-label="Zoom da capa"
          min={EVENT_ALBUM_COVER_SCALE_MIN}
          max={EVENT_ALBUM_COVER_SCALE_MAX}
          value={value.scale}
          onChange={(e) => onChange({ ...value, scale: Number(e.target.value) })}
          className="flex-1 accent-primary"
        />
        <span className="w-12 shrink-0 text-right tabular-nums">{value.scale}%</span>
      </label>

      <label className="flex items-center gap-sm text-body-sm text-on-surface-variant">
        <span className="w-24 shrink-0">Posição</span>
        <input
          type="range"
          aria-label="Posição vertical da capa"
          min={EVENT_ALBUM_COVER_POSITION_MIN}
          max={EVENT_ALBUM_COVER_POSITION_MAX}
          value={value.positionY}
          onChange={(e) => onChange({ ...value, positionY: Number(e.target.value) })}
          className="flex-1 accent-primary"
        />
        <span className="w-12 shrink-0 text-right tabular-nums">{value.positionY}%</span>
      </label>
    </div>
  )
}

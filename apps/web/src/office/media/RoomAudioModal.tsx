import { useEffect, useRef, useState } from 'react'
import { parseYouTubeVideoId } from '@legends/shared'
import { Icon } from '../../components/Icon'

/**
 * Onde a pessoa cola o link do YouTube para tocar na sala. Valida antes de
 * enviar — o hub valida de novo, mas errar o link não precisa de round-trip.
 */
export function RoomAudioModal({
  onSubmit,
  onClose,
  error,
}: {
  onSubmit: (rawUrl: string) => void
  onClose: () => void
  /** Recusa vinda do servidor (sala ocupada, cooldown…), mostrada abaixo do campo. */
  error?: string | null
}) {
  const [url, setUrl] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    const closeOnEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEsc)
    return () => window.removeEventListener('keydown', closeOnEsc)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/60 p-4"
      role="presentation"
      // Clique FORA fecha, como no resto dos diálogos (ver `VacationDialog`).
      // A conferência de alvo é o que impede o clique no formulário de subir
      // até aqui e fechar sozinho.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Compartilhar áudio na sala"
        className="w-full max-w-md rounded-2xl bg-surface p-5 shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault()
          if (!parseYouTubeVideoId(url)) {
            setLocalError('Cole um link de vídeo do YouTube.')
            return
          }
          setLocalError(null)
          onSubmit(url)
        }}
      >
        <div className="flex items-center gap-2">
          <Icon name="music_note" className="text-primary" />
          <h2 className="font-label text-label-lg text-on-surface">Compartilhar áudio na sala</h2>
        </div>
        <p className="mt-1 font-body text-body-sm text-on-surface-variant">
          Todo mundo na sala ouve junto, no mesmo ponto. Cada pessoa regula o próprio volume, e só você pode parar.
        </p>

        <label className="mt-4 block font-label text-label-sm text-on-surface-variant" htmlFor="room-audio-url">
          Link do YouTube
        </label>
        <input
          id="room-audio-url"
          ref={inputRef}
          value={url}
          onChange={(event) => {
            setUrl(event.target.value)
            setLocalError(null)
          }}
          placeholder="https://www.youtube.com/watch?v=…"
          className="mt-1 w-full rounded-xl border border-outline-variant/40 bg-surface-container px-3 py-2 font-body text-body-md text-on-surface outline-none focus:border-primary"
        />
        {(localError ?? error) && (
          <p role="alert" className="mt-2 font-body text-body-sm text-error">
            {localError ?? error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 font-label text-label-md text-on-surface-variant transition-all hover:bg-surface-container-highest/40"
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="rounded-xl bg-primary px-4 py-2 font-label text-label-md text-on-primary transition-all hover:opacity-90"
          >
            Tocar na sala
          </button>
        </div>
      </form>
    </div>
  )
}

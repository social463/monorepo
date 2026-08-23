import { useState } from 'react'
import { DEFAULT_EVENT_ALBUM_COVER, type EventAlbumCover, type EventAlbumDTO } from '@legends/shared'
import { uploadEventPhoto } from '../lib/upload'
import { CoverFramer } from './CoverFramer'

/** O que os dois formulários de álbum editam. */
export interface AlbumDraft {
  title: string
  description: string
  /** 'AAAA-MM-DD', o formato do input date; vazio quando não há data. */
  eventDate: string
  /** Chave da capa nova; null enquanto ninguém escolheu outra imagem. */
  coverStorageKey: string | null
  /** O que a prévia mostra: o arquivo recém-escolhido ou a capa que já existia. */
  coverPreviewUrl: string | null
  cover: EventAlbumCover
}

export function emptyAlbumDraft(): AlbumDraft {
  return {
    title: '',
    description: '',
    eventDate: '',
    coverStorageKey: null,
    coverPreviewUrl: null,
    cover: DEFAULT_EVENT_ALBUM_COVER,
  }
}

export function albumDraftFrom(album: EventAlbumDTO): AlbumDraft {
  return {
    title: album.title,
    description: album.description ?? '',
    eventDate: album.eventDate ? album.eventDate.slice(0, 10) : '',
    coverStorageKey: null,
    coverPreviewUrl: album.coverUrl,
    cover: album.cover,
  }
}

/**
 * Corpo da requisição a partir do rascunho.
 *
 * `coverStorageKey` só entra quando há imagem nova: mandá-la como `null` num
 * PATCH apagaria a capa de quem só quis corrigir o título.
 */
export function albumPayload(draft: AlbumDraft): Record<string, unknown> {
  return {
    title: draft.title,
    description: draft.description || null,
    // O input date dá 'AAAA-MM-DD'; a API espera ISO-8601 completo.
    eventDate: draft.eventDate ? new Date(`${draft.eventDate}T00:00:00.000Z`).toISOString() : null,
    ...(draft.coverStorageKey ? { coverStorageKey: draft.coverStorageKey } : {}),
    cover: draft.cover,
  }
}

/**
 * Título, descrição, data e capa de um álbum — os mesmos campos no console de
 * administração e no diálogo de edição da galeria. Um formulário só porque são
 * a mesma coisa: duas cópias divergiriam no primeiro campo novo.
 *
 * O upload da capa acontece ao escolher o arquivo, não no submit: assim a
 * prévia é a imagem de verdade e o enquadramento é ajustado vendo o resultado.
 */
export function AlbumFields({
  idPrefix,
  draft,
  onChange,
}: {
  idPrefix: string
  draft: AlbumDraft
  onChange: (next: AlbumDraft) => void
}) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function pickCover(file: File | undefined) {
    if (!file) return
    setError(null)
    setUploading(true)
    try {
      const { storageKey } = await uploadEventPhoto(file)
      onChange({ ...draft, coverStorageKey: storageKey, coverPreviewUrl: URL.createObjectURL(file) })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao enviar a capa.')
    } finally {
      setUploading(false)
    }
  }

  const field = 'rounded-md border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-body-md text-on-surface'
  const label = 'font-label text-label-md text-on-surface'

  return (
    <>
      <label className={label} htmlFor={`${idPrefix}-titulo`}>
        Título
      </label>
      <input
        id={`${idPrefix}-titulo`}
        value={draft.title}
        onChange={(e) => onChange({ ...draft, title: e.target.value })}
        className={field}
      />

      <label className={label} htmlFor={`${idPrefix}-descricao`}>
        Descrição
      </label>
      <textarea
        id={`${idPrefix}-descricao`}
        value={draft.description}
        onChange={(e) => onChange({ ...draft, description: e.target.value })}
        className={field}
      />

      <label className={label} htmlFor={`${idPrefix}-data`}>
        Data do evento
      </label>
      <input
        id={`${idPrefix}-data`}
        type="date"
        value={draft.eventDate}
        onChange={(e) => onChange({ ...draft, eventDate: e.target.value })}
        className={field}
      />

      <label className={label} htmlFor={`${idPrefix}-capa`}>
        Imagem de capa
      </label>
      <input
        id={`${idPrefix}-capa`}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onChange={(e) => void pickCover(e.target.files?.[0])}
        className="text-body-sm text-on-surface-variant"
      />
      {uploading && <p className="text-body-sm text-on-surface-variant">Enviando a capa…</p>}
      {error && (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      )}
      {draft.coverPreviewUrl && (
        <CoverFramer
          url={draft.coverPreviewUrl}
          value={draft.cover}
          onChange={(cover) => onChange({ ...draft, cover })}
        />
      )}
    </>
  )
}

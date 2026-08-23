import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { EventAlbumDetailResponse, EventAlbumListResponse } from '@legends/shared'
import { apiFetch, ApiError } from '../../lib/api'
import { useAlbumPhotoUpload } from '../../lib/use-album-photos'
import { AlbumFields, albumPayload, emptyAlbumDraft, type AlbumDraft } from '../../components/AlbumFields'
import { Panel } from './shared'

/**
 * Fotos de um álbum no console: enviar, definir capa e remover.
 *
 * O envio e a exclusão também existem na tela do álbum (`/galeria/:id`) para
 * quem administra G&G — este painel continua sendo o lugar de quem está
 * arrumando a galeria inteira, e não olhando um evento.
 */
function AlbumPhotos({ albumId }: { albumId: string }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const detail = useQuery({
    queryKey: ['admin', 'event-albums', albumId],
    queryFn: () => apiFetch<EventAlbumDetailResponse>(`/event-albums/${albumId}`),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'event-albums'] })
  }

  const upload = useAlbumPhotoUpload(albumId, async () => {
    invalidate()
    await detail.refetch()
  })

  const setCover = useMutation({
    mutationFn: (photoId: string) =>
      apiFetch<unknown>(`/admin/event-albums/${albumId}/cover`, {
        method: 'PATCH',
        body: JSON.stringify({ photoId }),
      }),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao definir a capa do álbum.'),
  })

  const removePhoto = useMutation({
    mutationFn: (photoId: string) =>
      apiFetch<unknown>(`/admin/event-albums/${albumId}/photos/${photoId}`, { method: 'DELETE' }),
    onSuccess: async () => {
      invalidate()
      await detail.refetch()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao remover a foto.'),
  })

  return (
    <div className="mt-md flex flex-col gap-md">
      {(error || upload.error) && (
        <p role="alert" className="text-body-sm text-error">
          {error ?? upload.error}
        </p>
      )}
      <label className="font-label text-label-md text-on-surface" htmlFor={`fotos-${albumId}`}>
        Adicionar fotos
      </label>
      <input
        id={`fotos-${albumId}`}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        multiple
        onChange={(e) => void upload.sendFiles(e.target.files)}
        className="text-body-sm text-on-surface-variant"
      />

      {upload.uploads.length > 0 && (
        <ul className="flex flex-col gap-1">
          {upload.uploads.map((u) => (
            <li key={u.fileName} className="text-body-sm text-on-surface-variant">
              {u.fileName} —{' '}
              {u.status === 'erro' ? (
                <span className="text-error">{u.message}</span>
              ) : (
                <span>{u.status === 'pronto' ? 'enviada' : 'enviando…'}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <ul className="grid grid-cols-2 gap-md sm:grid-cols-4">
        {detail.data?.photos.map((photo) => (
          <li key={photo.id} className="flex flex-col gap-1">
            <img src={photo.url} alt="" className="aspect-square w-full rounded-lg object-cover" />
            <button
              type="button"
              onClick={() => setCover.mutate(photo.id)}
              className="rounded-md border border-outline-variant/40 px-2 py-1 font-label text-label-sm text-on-surface"
            >
              Definir como capa
            </button>
            <button
              type="button"
              onClick={() => removePhoto.mutate(photo.id)}
              className="rounded-md border border-error/40 px-2 py-1 font-label text-label-sm text-error"
            >
              Remover foto
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function EventAlbumsSection() {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<AlbumDraft>(emptyAlbumDraft)
  const [openAlbumId, setOpenAlbumId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const albums = useQuery({
    queryKey: ['admin', 'event-albums'],
    queryFn: () => apiFetch<EventAlbumListResponse>('/event-albums'),
  })

  const createAlbum = useMutation({
    mutationFn: () =>
      apiFetch<unknown>('/admin/event-albums', {
        method: 'POST',
        // Na criação a chave vai sempre: sem capa escolhida, `null` é o certo.
        body: JSON.stringify({ ...albumPayload(draft), coverStorageKey: draft.coverStorageKey }),
      }),
    onSuccess: () => {
      setDraft(emptyAlbumDraft())
      setError(null)
      queryClient.invalidateQueries({ queryKey: ['admin', 'event-albums'] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao criar o álbum.'),
  })

  const removeAlbum = useMutation({
    mutationFn: (id: string) => apiFetch<unknown>(`/admin/event-albums/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'event-albums'] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao excluir o álbum.'),
  })

  return (
    <Panel title="Galeria de eventos">
      {error && (
        <p role="alert" className="mb-md text-body-sm text-error">
          {error}
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          createAlbum.mutate()
        }}
        className="mb-lg flex flex-col gap-sm"
      >
        <AlbumFields idPrefix="novo-album" draft={draft} onChange={setDraft} />

        <button
          type="submit"
          disabled={draft.title.trim().length === 0 || createAlbum.isPending}
          className="self-start rounded-md bg-primary px-4 py-2 font-label text-label-md text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
        >
          Criar álbum
        </button>
      </form>

      {albums.data?.albums.length === 0 && (
        <p className="text-body-sm text-on-surface-variant">Nenhum álbum publicado ainda.</p>
      )}

      <ul className="flex flex-col gap-md">
        {albums.data?.albums.map((album) => (
          <li key={album.id} className="rounded-lg border border-outline-variant/20 bg-surface-container-low p-md">
            <div className="flex items-start justify-between gap-md">
              <div className="min-w-0">
                <p className="font-label text-label-md text-on-surface">{album.title}</p>
                <p className="text-body-sm text-on-surface-variant">
                  {album.photoCount} {album.photoCount === 1 ? 'foto' : 'fotos'}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                {/* Editar leva para a galeria: é lá que a capa aparece no
                    tamanho real, e o formulário é exatamente o mesmo. */}
                <Link
                  to={`/galeria?editar=${album.id}`}
                  aria-label={`Editar ${album.title}`}
                  className="rounded-md border border-outline-variant/40 px-3 py-1 font-label text-label-sm text-on-surface"
                >
                  Editar
                </Link>
                <button
                  type="button"
                  onClick={() => setOpenAlbumId(openAlbumId === album.id ? null : album.id)}
                  aria-label={`Gerenciar fotos de ${album.title}`}
                  className="rounded-md border border-outline-variant/40 px-3 py-1 font-label text-label-sm text-on-surface"
                >
                  Gerenciar fotos
                </button>
                <button
                  type="button"
                  onClick={() => removeAlbum.mutate(album.id)}
                  className="rounded-md border border-error/40 px-3 py-1 font-label text-label-sm text-error"
                >
                  Excluir álbum
                </button>
              </div>
            </div>
            {openAlbumId === album.id && <AlbumPhotos albumId={album.id} />}
          </li>
        ))}
      </ul>
    </Panel>
  )
}

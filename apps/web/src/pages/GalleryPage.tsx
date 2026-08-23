import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { EventAlbumDTO, EventAlbumListResponse } from '@legends/shared'
import { apiFetch, ApiError } from '../lib/api'
import { coverImageStyle } from '../lib/album-cover'
import { administersBlock } from '../lib/features'
import { useAuth } from '../auth/AuthContext'
import { AlbumFields, albumDraftFrom, albumPayload, type AlbumDraft } from '../components/AlbumFields'
import { Icon } from '../components/Icon'

function formatEventDate(iso: string | null): string {
  if (!iso) return 'Sem data'
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })
}

/** Edição do álbum na própria galeria, com os mesmos campos do console. */
function EditAlbumDialog({ album, onClose }: { album: EventAlbumDTO; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<AlbumDraft>(() => albumDraftFrom(album))
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () =>
      apiFetch<unknown>(`/admin/event-albums/${album.id}`, {
        method: 'PATCH',
        body: JSON.stringify(albumPayload(draft)),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['event-albums'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'event-albums'] })
      onClose()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao editar o álbum.'),
  })

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Editar ${album.title}`}
      className="fixed inset-0 z-50 overflow-y-auto bg-black/60 p-lg"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
        className="mx-auto flex w-full max-w-xl flex-col gap-sm rounded-2xl border border-outline-variant/40 bg-surface p-lg"
      >
        <h2 className="font-headline text-headline-sm text-on-surface">Editar álbum</h2>
        {error && (
          <p role="alert" className="text-body-sm text-error">
            {error}
          </p>
        )}

        <AlbumFields idPrefix={`editar-${album.id}`} draft={draft} onChange={setDraft} />

        <div className="mt-sm flex gap-sm">
          <button
            type="submit"
            disabled={draft.title.trim().length === 0 || save.isPending}
            className="rounded-md bg-primary px-4 py-2 font-label text-label-md text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
          >
            Salvar alterações
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-outline-variant/40 px-4 py-2 font-label text-label-md text-on-surface"
          >
            Cancelar
          </button>
        </div>
      </form>
    </div>
  )
}

export function GalleryPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const canManage = administersBlock(user, 'gente-gestao')
  const [searchParams, setSearchParams] = useSearchParams()
  const [editing, setEditing] = useState<EventAlbumDTO | null>(null)
  const [confirming, setConfirming] = useState<EventAlbumDTO | null>(null)
  const [error, setError] = useState<string | null>(null)

  const albums = useQuery({
    queryKey: ['event-albums'],
    queryFn: () => apiFetch<EventAlbumListResponse>('/event-albums'),
  })

  const removeAlbum = useMutation({
    mutationFn: (id: string) => apiFetch<unknown>(`/admin/event-albums/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setConfirming(null)
      queryClient.invalidateQueries({ queryKey: ['event-albums'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'event-albums'] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao excluir o álbum.'),
  })

  // `?editar=<id>` abre o diálogo direto — é como o console manda para cá.
  const requestedEdit = searchParams.get('editar')
  const albumToEdit =
    editing ?? (requestedEdit ? (albums.data?.albums.find((a) => a.id === requestedEdit) ?? null) : null)

  function closeEditor() {
    setEditing(null)
    if (requestedEdit) {
      const next = new URLSearchParams(searchParams)
      next.delete('editar')
      setSearchParams(next, { replace: true })
    }
  }

  return (
    <section className="mx-auto flex max-w-page flex-col gap-lg p-lg md:p-xl">
      <header>
        <h1 className="font-headline text-headline-xl text-on-surface">Galeria de eventos</h1>
        <p className="mt-2 max-w-xl text-body-md text-on-surface-variant">
          A memória visual da empresa, evento a evento.
        </p>
      </header>

      {(albums.isError || error) && (
        <p role="alert" className="text-body-sm text-error">
          {error ?? 'Erro ao carregar os álbuns.'}
        </p>
      )}

      {albums.isLoading && <p className="text-body-sm text-on-surface-variant">Carregando…</p>}

      {!albums.isLoading && !albums.isError && albums.data?.albums.length === 0 && (
        <p className="text-body-sm text-on-surface-variant">Nenhum álbum publicado ainda.</p>
      )}

      <ul className="grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-3">
        {albums.data?.albums.map((album) => (
          <li key={album.id} className="group relative">
            <Link
              to={`/galeria/${album.id}`}
              aria-label={`Abrir álbum ${album.title}`}
              className="flex w-full flex-col overflow-hidden rounded-xl border border-outline-variant/30 bg-surface-container text-left transition-all hover:border-primary/60 hover:bg-surface-container-high hover:shadow-lg"
            >
              {album.coverUrl ? (
                // O enquadramento é o que o admin ajustou no formulário —
                // renderizado aqui igualzinho à prévia do editor.
                <img
                  src={album.coverUrl}
                  alt=""
                  className="aspect-video w-full bg-surface-container"
                  style={coverImageStyle(album.cover)}
                />
              ) : (
                <div className="flex aspect-video w-full items-center justify-center bg-surface-container">
                  <span className="text-body-sm text-on-surface-variant">Sem capa</span>
                </div>
              )}
              <div className="p-md">
                <p className="font-label text-label-md text-on-surface">{album.title}</p>
                <p className="text-body-sm text-on-surface-variant">
                  {formatEventDate(album.eventDate)} · {album.photoCount}{' '}
                  {album.photoCount === 1 ? 'foto' : 'fotos'}
                </p>
              </div>
            </Link>

            {/* Ações de quem administra G&G, sobre a capa. Aparecem no hover do
                mouse E no foco pelo teclado: escondidas só por hover, elas
                seriam inalcançáveis para quem navega por tab. */}
            {canManage && (
              <div className="absolute right-sm top-sm flex gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                <button
                  type="button"
                  aria-label={`Editar ${album.title}`}
                  onClick={() => setEditing(album)}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-surface text-on-surface shadow-md"
                >
                  <Icon name="edit" className="text-[18px]" />
                </button>
                <button
                  type="button"
                  aria-label={`Excluir ${album.title}`}
                  onClick={() => setConfirming(album)}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-surface text-error shadow-md"
                >
                  <Icon name="delete" className="text-[18px]" />
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {albumToEdit && <EditAlbumDialog album={albumToEdit} onClose={closeEditor} />}

      {/* Excluir álbum leva as fotos, os comentários e as reações junto — é o
          tipo de ação que não pode acontecer por um clique errado no hover. */}
      {confirming && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Excluir ${confirming.title}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-lg"
        >
          <div className="flex w-full max-w-md flex-col gap-md rounded-2xl border border-outline-variant/40 bg-surface p-lg">
            <h2 className="font-headline text-headline-sm text-on-surface">Excluir álbum</h2>
            <p className="text-body-md text-on-surface-variant">
              As {confirming.photoCount} {confirming.photoCount === 1 ? 'foto' : 'fotos'} de{' '}
              <strong className="text-on-surface">{confirming.title}</strong> serão apagadas junto, com os
              comentários e as reações. Não dá para desfazer.
            </p>
            <div className="flex gap-sm">
              <button
                type="button"
                onClick={() => removeAlbum.mutate(confirming.id)}
                disabled={removeAlbum.isPending}
                className="rounded-md border border-error/60 px-4 py-2 font-label text-label-md text-error disabled:opacity-50"
              >
                Excluir mesmo assim
              </button>
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="rounded-md border border-outline-variant/40 px-4 py-2 font-label text-label-md text-on-surface"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

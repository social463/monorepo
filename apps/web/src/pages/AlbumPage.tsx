import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  EVENT_PHOTO_REACTIONS,
  type EventAlbumDetailResponse,
  type EventPhotoCommentListResponse,
  type EventPhotoDTO,
  type EventPhotoReactionEmoji,
} from '@legends/shared'
import { apiFetch, ApiError } from '../lib/api'
import { administersBlock } from '../lib/features'
import { useAlbumPhotoUpload } from '../lib/use-album-photos'
import { useAuth } from '../auth/AuthContext'
import { Avatar } from '../components/Avatar'
import { Icon } from '../components/Icon'
import { FeedbackReactions } from './profile/FeedbackReactions'

/** Tempo relativo compacto, o mesmo da timeline da resenha. */
function formatRelative(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const diff = Math.floor((Date.now() - d.getTime()) / 1000)
  if (diff < 60) return 'agora'
  if (diff < 3600) return `${Math.floor(diff / 60)}min`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  if (diff < 604800) return `${Math.floor(diff / 86400)}d`
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
}

function PhotoDetail({
  photo,
  canManage,
  onClose,
  onDeleted,
}: {
  photo: EventPhotoDTO
  canManage: boolean
  onClose: () => void
  onDeleted: () => void
}) {
  const queryClient = useQueryClient()
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const comments = useQuery({
    queryKey: ['event-photo-comments', photo.id],
    queryFn: () => apiFetch<EventPhotoCommentListResponse>(`/event-albums/photos/${photo.id}/comments`),
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['event-album', photo.albumId] })
    queryClient.invalidateQueries({ queryKey: ['event-photo-comments', photo.id] })
  }

  // POST adiciona (idempotente na API), DELETE remove: o toggle é a escolha do verbo.
  const react = useMutation({
    mutationFn: ({ emoji, reacted }: { emoji: string; reacted: boolean }) =>
      apiFetch<unknown>(`/event-albums/photos/${photo.id}/reactions`, {
        method: reacted ? 'DELETE' : 'POST',
        body: JSON.stringify({ emoji }),
      }),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao reagir à foto.'),
  })

  const comment = useMutation({
    mutationFn: () =>
      apiFetch<unknown>(`/event-albums/photos/${photo.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      }),
    onSuccess: () => {
      setBody('')
      invalidate()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao comentar na foto.'),
  })

  const deleteComment = useMutation({
    mutationFn: (commentId: string) => apiFetch<unknown>(`/event-albums/comments/${commentId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao excluir o comentário.'),
  })

  // O link assinado é pedido no clique, não junto da foto: ele expira em 5
  // minutos, e gerar um por foto na abertura do álbum seria assinar dezenas de
  // URLs que ninguém vai usar.
  const download = useMutation({
    mutationFn: async () => {
      const { url } = await apiFetch<{ url: string }>(`/event-albums/photos/${photo.id}/download`)
      window.location.assign(url)
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao baixar a foto.'),
  })

  const deletePhoto = useMutation({
    mutationFn: () =>
      apiFetch<unknown>(`/admin/event-albums/${photo.albumId}/photos/${photo.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidate()
      onDeleted()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao excluir a foto.'),
  })

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Foto do álbum"
      // `bg-scrim` não existe no tema (ver tailwind.config.ts): a classe não
      // gerava regra nenhuma e o lightbox abria transparente, com a galeria
      // aparecendo por trás da foto. `bg-black` é o escurecimento dos demais
      // modais do projeto — aqui em /90 porque cobre a tela inteira.
      className="fixed inset-0 z-50 flex flex-col gap-md overflow-y-auto bg-black/90 p-lg"
    >
      <div className="flex justify-end gap-sm">
        <button
          type="button"
          onClick={() => download.mutate()}
          disabled={download.isPending}
          className="inline-flex items-center gap-xs rounded-md border border-outline-variant/40 px-3 py-1 font-label text-label-sm text-on-surface disabled:opacity-50"
        >
          <Icon name="download" className="text-[16px]" />
          Baixar
        </button>
        {canManage && (
          <button
            type="button"
            onClick={() => deletePhoto.mutate()}
            disabled={deletePhoto.isPending}
            className="rounded-md border border-error/60 px-3 py-1 font-label text-label-sm text-error disabled:opacity-50"
          >
            Excluir foto
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-outline-variant/40 px-3 py-1 font-label text-label-sm text-on-surface"
        >
          Fechar
        </button>
      </div>

      {error && (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      )}

      <img src={photo.url} alt="" className="mx-auto max-h-[60vh] rounded-lg object-contain" />

      {/* A mesma barra do feedback e da resenha: um gatilho que abre o
          seletor, e os emojis já usados como chips. Antes eram os 16 emojis
          sempre na tela, que não é o padrão de lugar nenhum do produto. */}
      <div className="mx-auto flex w-full max-w-2xl">
        <FeedbackReactions
          reactions={photo.reactions}
          options={EVENT_PHOTO_REACTIONS}
          onToggle={(emoji: EventPhotoReactionEmoji) =>
            react.mutate({
              emoji,
              reacted: photo.reactions.find((r) => r.emoji === emoji)?.reactedByMe ?? false,
            })
          }
        />
      </div>

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-sm">
        <ul className="flex flex-col gap-2">
          {comments.data?.comments.map((c) => (
            <li key={c.id} className="flex items-start gap-sm rounded-lg bg-surface-container-low p-sm">
              <Link
                to={`/perfil/${c.author.id}`}
                className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-outline-variant/60 bg-surface-container-highest"
              >
                <Avatar user={c.author} />
              </Link>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-xs">
                  <Link
                    to={`/perfil/${c.author.id}`}
                    className="truncate font-label text-label-sm font-bold text-on-surface hover:underline"
                  >
                    {c.author.name}
                  </Link>
                  <span className="shrink-0 text-on-surface-variant">·</span>
                  <span className="shrink-0 font-label text-label-sm text-on-surface-variant">
                    {formatRelative(c.createdAt)}
                  </span>
                </div>
                <p className="text-body-sm text-on-surface-variant">{c.body}</p>
              </div>
              {c.canDelete && (
                <button
                  type="button"
                  aria-label={`Excluir comentário de ${c.author.name}`}
                  onClick={() => deleteComment.mutate(c.id)}
                  disabled={deleteComment.isPending}
                  className="shrink-0 rounded-md border border-error/40 px-2 py-1 font-label text-label-sm text-error disabled:opacity-50"
                >
                  Excluir
                </button>
              )}
            </li>
          ))}
        </ul>

        <label className="font-label text-label-md text-on-surface" htmlFor={`comentario-${photo.id}`}>
          Escreva um comentário
        </label>
        <textarea
          id={`comentario-${photo.id}`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="rounded-md border border-outline-variant/40 bg-surface-container-low px-3 py-2 text-body-md text-on-surface"
        />
        <button
          type="button"
          disabled={body.trim().length === 0 || comment.isPending}
          onClick={() => comment.mutate()}
          className="self-start rounded-md bg-primary px-4 py-2 font-label text-label-md text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
        >
          Comentar
        </button>
      </div>
    </div>
  )
}

/** Envio de fotos: botão e área de arrastar. Só para quem administra G&G. */
function PhotoUploader({ albumId, onDone }: { albumId: string; onDone: () => void | Promise<void> }) {
  const [dragging, setDragging] = useState(false)
  const upload = useAlbumPhotoUpload(albumId, onDone)

  return (
    <section className="flex flex-col gap-sm">
      <div className="flex items-center gap-md">
        <label
          htmlFor={`enviar-fotos-${albumId}`}
          className="inline-flex cursor-pointer items-center gap-xs rounded-md bg-primary px-4 py-2 font-label text-label-md text-on-primary"
        >
          <Icon name="upload" className="text-[18px]" />
          Enviar fotos
        </label>
        <input
          id={`enviar-fotos-${albumId}`}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          onChange={(e) => void upload.sendFiles(e.target.files)}
          className="sr-only"
        />
      </div>

      {/* A área de arrastar é um complemento do botão, não a única via: sem
          teclado nem leitor de tela dá para soltar arquivo aqui. */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          void upload.sendFiles(e.dataTransfer.files)
        }}
        className={`rounded-xl border border-dashed p-lg text-center text-body-sm ${
          dragging ? 'border-primary bg-primary/10 text-on-surface' : 'border-outline-variant/60 text-on-surface-variant'
        }`}
      >
        Arraste fotos para cá ou use o botão acima.
      </div>

      {upload.error && (
        <p role="alert" className="text-body-sm text-error">
          {upload.error}
        </p>
      )}

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
    </section>
  )
}

/**
 * Um álbum em rota própria (`/galeria/:albumId`).
 *
 * Estava dentro da galeria, em estado local: não dava para mandar o link de um
 * evento para o time, que é metade da graça de ter álbum.
 */
export function AlbumPage() {
  const { albumId = '' } = useParams()
  const { user } = useAuth()
  const canManage = administersBlock(user, 'gente-gestao')
  const [openPhotoId, setOpenPhotoId] = useState<string | null>(null)

  const detail = useQuery({
    queryKey: ['event-album', albumId],
    queryFn: () => apiFetch<EventAlbumDetailResponse>(`/event-albums/${albumId}`),
  })

  const openPhoto = detail.data?.photos.find((p) => p.id === openPhotoId) ?? null

  return (
    <section className="mx-auto flex max-w-page flex-col gap-md p-lg md:p-xl">
      <Link
        to="/galeria"
        className="inline-flex w-fit items-center gap-xs rounded-md border border-outline-variant/40 px-3 py-1 font-label text-label-sm text-on-surface"
      >
        <Icon name="arrow_back" className="text-[16px]" />
        Voltar para a galeria
      </Link>

      {detail.isError && (
        <p role="alert" className="text-body-sm text-error">
          Erro ao carregar o álbum.
        </p>
      )}

      <header>
        <h1 className="font-headline text-headline-xl text-on-surface">{detail.data?.album.title}</h1>
        {detail.data?.album.description && (
          <p className="mt-2 max-w-xl text-body-md text-on-surface-variant">{detail.data.album.description}</p>
        )}
      </header>

      {canManage && <PhotoUploader albumId={albumId} onDone={() => void detail.refetch()} />}

      {detail.data?.photos.length === 0 && (
        <p className="text-body-sm text-on-surface-variant">Nenhuma foto neste álbum ainda.</p>
      )}

      {/* Mosaico em colunas CSS, até 4 por linha: cada foto entra na altura
          que tem, e elas se encaixam entre si. No quadrado recortado de antes,
          foto em pé perdia metade do enquadramento e o álbum inteiro virava
          uma grade de rostos cortados. */}
      <ul className="columns-2 gap-md sm:columns-3 lg:columns-4 [&>li]:mb-md">
        {detail.data?.photos.map((photo, index) => (
          <li key={photo.id} className="break-inside-avoid">
            <button
              type="button"
              aria-label={`Ampliar foto ${index + 1}`}
              onClick={() => setOpenPhotoId(photo.id)}
              className="block w-full overflow-hidden rounded-lg"
            >
              {/* `aspect-ratio` a partir das dimensões gravadas reserva o
                  espaço antes de a imagem chegar — sem isso o mosaico se
                  remonta a cada foto que carrega. */}
              <img
                src={photo.url}
                alt=""
                loading="lazy"
                className="w-full bg-surface-container object-cover transition-transform hover:scale-[1.02]"
                style={
                  photo.width && photo.height ? { aspectRatio: `${photo.width} / ${photo.height}` } : undefined
                }
              />
            </button>
          </li>
        ))}
      </ul>

      {openPhoto && (
        <PhotoDetail
          photo={openPhoto}
          canManage={canManage}
          onClose={() => setOpenPhotoId(null)}
          onDeleted={() => {
            setOpenPhotoId(null)
            void detail.refetch()
          }}
        />
      )}
    </section>
  )
}

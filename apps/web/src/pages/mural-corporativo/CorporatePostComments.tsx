import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import {
  CORPORATE_COMMENT_MAX_LENGTH,
  CORPORATE_POST_REACTIONS,
  type CorporatePostReactionEmoji,
} from '@legends/shared'
import type { AttachedGif } from '@legends/shared'
import type { AttachedImage } from '@legends/shared'
import { Avatar } from '../../components/Avatar'
import { Icon } from '../../components/Icon'
import { MentionTextarea } from '../../components/MentionTextarea'
import { GifPicker } from '../../components/GifPicker'
import { ImagePicker } from '../../components/ImagePicker'
import { ImageLightbox } from '../../components/ImageLightbox'
import { FeedbackReactions } from '../profile/FeedbackReactions'
import { renderWithMentions } from '../../lib/mentions'
import { useColleagues } from '../../lib/use-colleagues'
import { useAuth } from '../../auth/AuthContext'
import { useGifsEnabled } from '../../lib/use-gifs'
import { useImageUploadsEnabled } from '../../lib/use-image-upload'
import {
  useCorporatePostComments,
  useCreateCorporatePostComment,
  useDeleteCorporatePostComment,
  useToggleCorporateCommentReaction,
} from '../../lib/use-corporate-mural'

/** Tempo relativo compacto, igual ao do card. */
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

export function CorporatePostComments({ postId }: { postId: string }) {
  const { user } = useAuth()
  const gifsEnabled = useGifsEnabled()
  const imageUploadsEnabled = useImageUploadsEnabled()
  const [image, setImage] = useState<AttachedImage | null>(null)
  const [text, setText] = useState('')
  const [mentionIds, setMentionIds] = useState<string[]>([])
  const [gif, setGif] = useState<AttachedGif | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  // Imagem do comentário aberta em tela cheia. É uma por comentário, então
  // guardar a URL basta — não há navegação entre elas.
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)
  const colleagues = useColleagues('company').data ?? []
  const commentsQuery = useCorporatePostComments(postId, true)
  const create = useCreateCorporatePostComment(postId)
  const remove = useDeleteCorporatePostComment(postId)
  const react = useToggleCorporateCommentReaction(postId)

  const comments = commentsQuery.data?.pages.flatMap((p) => p.items) ?? []
  const trimmed = text.trim()
  const canSubmit =
    (trimmed.length >= 1 || gif !== null || image !== null) &&
    trimmed.length <= CORPORATE_COMMENT_MAX_LENGTH &&
    !create.isPending

  function doSubmit() {
    if (!canSubmit) return
    create.mutate(
      { content: trimmed, mentionedUserIds: mentionIds, ...(gif ? { gif } : {}), ...(image ? { image } : {}) },
      {
        onSuccess: () => {
          setText('')
          setMentionIds([])
          setGif(null)
          setImage(null)
        },
      },
    )
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    doSubmit()
  }

  return (
    <div className="mt-md border-t border-outline-variant/30 pt-sm">
      <ul className="flex flex-col divide-y divide-outline-variant/20">
        {comments.map((c) => {
          const canDelete = user?.id === c.author.id || user?.role === 'ADMIN' || user?.role === 'SUBADMIN'
          return (
            <li key={c.id} className="group/comment flex gap-sm py-sm">
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
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm('Excluir este comentário?')) remove.mutate(c.id)
                      }}
                      disabled={remove.isPending}
                      aria-label="Excluir comentário"
                      className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-on-surface-variant opacity-0 transition-opacity hover:bg-error/10 hover:text-error focus:opacity-100 disabled:opacity-50 group-hover/comment:opacity-100"
                    >
                      <Icon name="delete" className="text-[14px]" />
                    </button>
                  )}
                </div>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-body-sm text-on-surface">
                  {renderWithMentions(c.content, c.mentions)}
                </p>

                {c.gif && (
                  <img
                    src={c.gif.url}
                    alt="GIF"
                    width={c.gif.width || undefined}
                    height={c.gif.height || undefined}
                    loading="lazy"
                    className="mt-xs max-h-64 max-w-full rounded-lg border border-outline-variant/40"
                  />
                )}

                {c.image && (
                  <button
                    type="button"
                    onClick={() => setLightboxUrl(c.image!.url)}
                    aria-label="Ampliar imagem do comentário"
                    className="mt-sm block cursor-zoom-in overflow-hidden rounded-lg border border-outline-variant/40"
                  >
                    <img
                      src={c.image.url}
                      alt="Imagem do comentário"
                      loading="lazy"
                      className="max-h-72 max-w-full object-contain"
                    />
                  </button>
                )}

                <div className="mt-xs">
                  <FeedbackReactions
                    reactions={c.reactions}
                    options={CORPORATE_POST_REACTIONS}
                    onToggle={(emoji: CorporatePostReactionEmoji) => {
                      if (user) react.mutate({ commentId: c.id, emoji })
                    }}
                  />
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      {commentsQuery.hasNextPage && (
        <button
          type="button"
          onClick={() => commentsQuery.fetchNextPage()}
          disabled={commentsQuery.isFetchingNextPage}
          className="mt-xs font-label text-label-sm text-primary hover:underline disabled:opacity-50"
        >
          {commentsQuery.isFetchingNextPage ? 'Carregando…' : 'Carregar mais comentários'}
        </button>
      )}

      <form onSubmit={submit} className="mt-sm flex items-start gap-sm">
        {user && (
          <div className="hidden h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-outline-variant/60 bg-surface-container-highest sm:flex">
            <Avatar user={user} />
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <MentionTextarea
            value={text}
            onChange={setText}
            onMentionsChange={setMentionIds}
            colleagues={colleagues}
            placeholder="Comentar…"
            ariaLabel="Seu comentário"
            rows={1}
            className="min-w-0 w-full resize-none rounded-2xl border border-outline-variant/60 bg-surface-container-highest px-md py-2 text-body-sm text-on-surface outline-none focus:border-primary"
            onEnterSubmit={doSubmit}
          />
          {gif && (
            <div className="relative mt-sm w-fit">
              <img src={gif.url} alt="GIF" className="max-h-48 rounded-lg border border-outline-variant/40" />
              <button
                type="button"
                onClick={() => setGif(null)}
                aria-label="Remover GIF"
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-surface/90 text-on-surface hover:bg-surface"
              >
                <Icon name="close" className="text-[16px]" />
              </button>
            </div>
          )}
          {image && (
            <div className="relative mt-sm w-fit">
              <img
                src={image.url}
                alt="Imagem anexada"
                className="max-h-48 max-w-full rounded-lg border border-outline-variant/40"
              />
              <button
                type="button"
                onClick={() => setImage(null)}
                aria-label="Remover imagem"
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-surface/90 text-on-surface hover:bg-surface"
              >
                <Icon name="close" className="text-[16px]" />
              </button>
            </div>
          )}
          <div className="mt-xs flex items-center gap-sm">
            {gifsEnabled && !image && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setPickerOpen((v) => !v)}
                  aria-label="Adicionar GIF"
                  className="flex items-center gap-xs rounded-full border border-outline-variant/60 px-sm py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
                >
                  <Icon name="gif_box" className="text-[18px]" /> GIF
                </button>
                {pickerOpen && (
                  <GifPicker
                    onSelect={(g) => {
                      setGif({ url: g.url, width: g.width, height: g.height })
                      setPickerOpen(false)
                    }}
                    onClose={() => setPickerOpen(false)}
                  />
                )}
              </div>
            )}
            {imageUploadsEnabled && !gif && <ImagePicker onSelect={setImage} />}
          </div>
        </div>
        <button
          type="submit"
          disabled={!canSubmit}
          className="shrink-0 rounded-full bg-primary px-lg py-2 font-label text-label-sm font-bold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
        >
          Enviar
        </button>
      </form>

      {lightboxUrl && (
        <ImageLightbox
          images={[{ url: lightboxUrl, name: 'Imagem do comentário' }]}
          index={0}
          onIndexChange={() => {}}
          onClose={() => setLightboxUrl(null)}
        />
      )}
    </div>
  )
}

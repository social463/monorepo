import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CORPORATE_POST_REACTIONS,
  canPinCorporatePost,
  type CorporatePostDTO,
  type CorporatePostReactionEmoji,
} from '@legends/shared'
import { Avatar } from '../../components/Avatar'
import { Icon } from '../../components/Icon'
import { FeedbackReactions } from '../profile/FeedbackReactions'
import { useAuth } from '../../auth/AuthContext'
import {
  useDeleteCorporatePost,
  usePinCorporatePost,
  useToggleCorporatePostReaction,
} from '../../lib/use-corporate-mural'
import { markCorporatePostReadFull, useCorporatePostRead } from '../../lib/use-corporate-post-read'
import { useXpAmount } from '../../lib/use-xp'
import { renderWithMentions } from '../../lib/mentions'
import { RichTextView } from '../../components/rich-text/RichTextView'
import { ImageLightbox } from '../../components/ImageLightbox'
import { PostReactorsDialog } from '../../components/PostReactorsDialog'
import { CorporatePostComments } from './CorporatePostComments'
import { CorporatePostEditForm } from './CorporatePostEditForm'

/** Assinatura do comunicado: "11 de ago., 13:31". Data e hora por extenso, e não
 * o "2d" relativo da timeline — comunicado da empresa é documento datado, e foi
 * o que a G&G pediu ao lado do setor do autor. */
function formatStamp(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Data completa — o que fica no `title` da assinatura (traz o ano). */
function formatFullDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Ação da barra inferior: pílula com ícone E rótulo. Ícone sozinho obrigava a
 * adivinhar o que cada um faz numa barra com três verbos diferentes. */
function ActionPill({
  icon,
  label,
  active,
  onClick,
}: {
  icon: string
  label: string
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-xs rounded-full border px-md py-1 font-label text-label-sm transition-colors ${
        active
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-outline-variant/60 text-on-surface-variant hover:border-primary hover:text-primary'
      }`}
    >
      <Icon name={icon} className="text-[16px]" />
      {label}
    </button>
  )
}

/** Ícone de administração do card (editar, fixar, excluir). */
function IconAction({
  icon,
  label,
  tone = 'neutral',
  active,
  disabled,
  onClick,
}: {
  icon: string
  label: string
  tone?: 'neutral' | 'danger'
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  const color = active
    ? 'text-primary'
    : tone === 'danger'
      ? 'text-on-surface-variant hover:bg-error/10 hover:text-error'
      : 'text-on-surface-variant hover:bg-primary/10 hover:text-primary'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50 ${color}`}
    >
      <Icon name={icon} className="text-[18px]" />
    </button>
  )
}

/** Compartilhar: link direto para o comunicado no feed. O deep-link é o mesmo
 * `#<id>` que a notificação usa — o feed carrega páginas até achar o post e rola
 * até ele —, então não há rota nova para manter. */
function ShareAction({ postId, title }: { postId: string; title: string }) {
  const [copied, setCopied] = useState(false)
  const url = `${window.location.origin}/mural-corporativo#${postId}`

  async function share() {
    // `navigator.share` só existe em navegador móvel (e sob HTTPS); onde não
    // existe, ou onde a pessoa cancela, o comportamento útil é copiar.
    const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> }
    if (nav.share) {
      try {
        await nav.share({ title, url })
        return
      } catch {
        return
      }
    }
    try {
      await navigator.clipboard?.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // Sem permissão de área de transferência não há o que fazer sem inventar
      // um diálogo só para isso: o link continua acessível pela barra do
      // navegador depois do deep-link.
    }
  }

  return (
    <ActionPill icon={copied ? 'check' : 'share'} label={copied ? 'Link copiado' : 'Compartilhar'} onClick={share} />
  )
}

export function CorporatePostCard({ post }: { post: CorporatePostDTO }) {
  const { user } = useAuth()
  const [showComments, setShowComments] = useState(false)
  const [collapsed, setCollapsed] = useState(post.collapsible)
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // Índice da imagem aberta em tela cheia; null com o visualizador fechado.
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)
  const [showReactors, setShowReactors] = useState(false)
  // Só as fotos entram no visualizador: vídeo e documento têm player e link
  // próprios, e misturá-los faria a seta "próxima" pular para um PDF.
  const imageAttachments = post.attachments.filter((att) => att.kind === 'IMAGE')
  const toggleReaction = useToggleCorporatePostReaction(user ? { id: user.id, name: user.name } : null)
  const remove = useDeleteCorporatePost()
  const pin = usePinCorporatePost()
  const readRef = useCorporatePostRead(post.id)
  const readFullXp = useXpAmount('CORPORATE_POST_READ_FULL')
  const canPin = canPinCorporatePost(user?.role, user?.adminAccess)
  const isPinned = post.pinnedAt !== null

  const canDelete = user?.id === post.author.id || user?.role === 'ADMIN' || user?.role === 'SUBADMIN'

  return (
    <li
      ref={readRef}
      id={post.id}
      className={`rounded-2xl border bg-surface-container-low p-lg transition-colors ${
        isPinned ? 'border-primary/40 ring-1 ring-primary/20' : 'border-outline-variant/40'
      }`}
    >
      {/* Faixa do fixado ACIMA do cabeçalho, e não um chip perdido na linha do
          nome: é o estado do card inteiro, não um atributo do autor. */}
      {isPinned && (
        <p className="mb-sm flex items-center gap-xs font-label text-label-sm font-bold text-primary">
          <Icon name="push_pin" className="text-[16px]" />
          Fixado no topo
        </p>
      )}

      <header className="flex items-start gap-sm">
        <Link
          to={`/perfil/${post.author.id}`}
          className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-outline-variant/60 bg-surface-container-highest"
        >
          <Avatar user={post.author} />
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-xs">
            <Link
              to={`/perfil/${post.author.id}`}
              className="truncate font-label text-label-md font-bold text-on-surface hover:underline"
            >
              {post.author.name}
            </Link>
            {/* Sem o papel do autor ao lado do nome: no comunicado da empresa o
                que situa quem falou é o SETOR, que já vem na linha de baixo —
                "Lenda"/"Head" só repetia hierarquia interna em cada card. */}
            {post.audience === 'SECTORS' && post.audienceSectors.length > 0 && (
              <span className="shrink-0 truncate rounded-full bg-surface-container-highest px-sm font-label text-label-sm text-on-surface-variant">
                {post.audienceSectors.map((s) => s.name).join(', ')}
              </span>
            )}
          </div>
          {/* Segunda linha da autoria: SETOR · data e hora, como no desenho da
              G&G. Maiúsculas pequenas para não competir com o nome. */}
          <p className="truncate font-label text-label-sm text-on-surface-variant">
            {post.authorSectorName && <span className="uppercase tracking-wide">{post.authorSectorName} · </span>}
            <span title={formatFullDate(post.createdAt)}>{formatStamp(post.createdAt)}</span>
            {post.editedAt && <span title={`Editado em ${formatFullDate(post.editedAt)}`}> · editado</span>}
          </p>
        </div>

        {/* Ações de administração sempre visíveis: escondidas no hover elas não
            existem para quem usa teclado nem para quem está no toque. */}
        <div className="flex shrink-0 items-center gap-xs">
          {/* Confirmação em dois passos DENTRO do card, como no detalhe do
              calendário — `window.confirm` mostra "localhost:5173 diz", não
              aceita estilo e não dá para testar. */}
          {confirmingDelete ? (
            <>
              <span className="hidden font-label text-label-sm text-on-surface-variant sm:inline">Excluir?</span>
              <button
                type="button"
                onClick={() => remove.mutate(post.id)}
                disabled={remove.isPending}
                className="rounded-full bg-error px-md py-1 font-label text-label-sm font-bold text-on-error transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                Confirmar
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                className="rounded-full px-sm py-1 font-label text-label-sm text-on-surface-variant hover:text-on-surface"
              >
                Cancelar
              </button>
            </>
          ) : (
            <>
              {canPin && <IconAction icon="edit" label="Editar publicação" onClick={() => setEditing((v) => !v)} />}
              {canPin && (
                <IconAction
                  icon={isPinned ? 'keep_off' : 'push_pin'}
                  label={isPinned ? 'Desafixar publicação' : 'Fixar publicação'}
                  active={isPinned}
                  disabled={pin.isPending}
                  onClick={() => pin.mutate({ postId: post.id, pin: !isPinned })}
                />
              )}
              {canDelete && (
                <IconAction
                  icon="delete"
                  label="Excluir publicação"
                  tone="danger"
                  disabled={remove.isPending}
                  onClick={() => setConfirmingDelete(true)}
                />
              )}
            </>
          )}
        </div>
      </header>

      {editing ? (
        <CorporatePostEditForm post={post} onDone={() => setEditing(false)} />
      ) : (
        <>
          {post.title && (
            <h3 className="mt-sm font-headline text-headline-sm text-on-surface">{post.title}</h3>
          )}

          {/* Corte + "Ver conteúdo completo": quem decide se o post é longo é o
              SERVIDOR (`collapsible` no DTO), a mesma decisão que libera o XP. */}
          <div className={collapsed ? 'relative mt-sm max-h-24 overflow-hidden' : 'mt-sm'}>
            {post.body ? (
              <RichTextView doc={post.body} className="flex flex-col gap-sm" />
            ) : (
              <p className="whitespace-pre-wrap break-words text-body-md text-on-surface">
                {renderWithMentions(post.content, post.mentions)}
              </p>
            )}
            {collapsed && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-b from-transparent to-surface-container-low" />
            )}
          </div>

          {post.collapsible && collapsed && (
            <button
              type="button"
              onClick={() => {
                setCollapsed(false)
                markCorporatePostReadFull(post.id)
              }}
              className="mt-xs font-label text-label-md text-primary hover:underline"
            >
              Ver conteúdo completo
              {/* O valor é o da regra da empresa, e some quando ela está
                  desligada: prometer "+3 pts" onde o servidor não credita nada
                  seria mentira na única tela em que a pessoa cobra o ponto. */}
              {readFullXp !== null && ` (+${readFullXp} pts)`}
            </button>
          )}

          {post.attachments.length > 0 && (
            <ul className="mt-sm flex flex-col gap-sm">
              {post.attachments.map((att) => (
                <li key={att.id}>
                  {att.kind === 'IMAGE' && (
                    // `object-contain`, e não `cover`: banner largo (o formato
                    // que a G&G publica) era esticado até 320px de altura e
                    // cortado nas bordas — sumia justamente o texto da arte.
                    // Contido, a foto ocupa a altura que a proporção dela pede,
                    // e o clique abre a versão inteira.
                    <button
                      type="button"
                      onClick={() => setLightboxIndex(imageAttachments.findIndex((i) => i.id === att.id))}
                      aria-label={`Ampliar imagem: ${att.name}`}
                      className="block w-full cursor-zoom-in overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container-highest"
                    >
                      <img
                        src={att.url}
                        alt={att.name}
                        loading="lazy"
                        className="mx-auto max-h-[26rem] w-auto max-w-full object-contain"
                      />
                    </button>
                  )}
                  {att.kind === 'VIDEO' && (
                    <video
                      src={att.url}
                      controls
                      preload="metadata"
                      className="max-h-80 w-full rounded-xl border border-outline-variant/40"
                    />
                  )}
                  {att.kind === 'DOCUMENT' && (
                    <a
                      href={att.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="flex items-center gap-sm rounded-lg border border-outline-variant/40 px-sm py-1 text-body-sm text-on-surface hover:border-primary hover:text-primary"
                    >
                      <Icon name="description" className="text-[18px]" />
                      <span className="min-w-0 flex-1 truncate">{att.name}</span>
                      <Icon name="download" className="text-[18px]" />
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}

          {post.gif && (
            <img
              src={post.gif.url}
              alt="GIF"
              width={post.gif.width || undefined}
              height={post.gif.height || undefined}
              loading="lazy"
              className="mt-sm max-h-80 max-w-full rounded-xl border border-outline-variant/40"
            />
          )}

          {/* `post.image` (legado) NÃO é renderizado aqui: o serialize já devolve
              a imagem antiga dentro de `attachments`, então desenhá-la de novo
              duplicaria a foto nos posts anteriores a esta rodada. */}
        </>
      )}

      {/* A fileira para em 8 avatares (`reactors`): com nove reações, a nona
          pessoa não aparecia em lugar nenhum. Clicar abre a lista completa —
          quem enxerga o comunicado enxerga quem reagiu a ele. */}
      {post.reactorCount > 0 && (
        <button
          type="button"
          onClick={() => setShowReactors(true)}
          aria-label="Ver quem reagiu"
          className="group/reactors mt-sm flex items-center gap-xs"
        >
          <div className="flex -space-x-2">
            {post.reactors.map((r) => (
              <div
                key={r.id}
                className="h-6 w-6 overflow-hidden rounded-full border-2 border-surface-container-low bg-surface-container-highest"
              >
                <Avatar user={r} />
              </div>
            ))}
          </div>
          <span className="font-label text-label-sm text-on-surface-variant group-hover/reactors:text-primary group-hover/reactors:underline">
            {post.reactorCount} {post.reactorCount === 1 ? 'reação' : 'reações'}
          </span>
        </button>
      )}

      <div className="mt-md flex flex-wrap items-center gap-sm border-t border-outline-variant/40 pt-sm">
        <FeedbackReactions
          reactions={post.reactions}
          options={CORPORATE_POST_REACTIONS}
          onToggle={(emoji: CorporatePostReactionEmoji) => {
            if (user) toggleReaction.mutate({ postId: post.id, emoji })
          }}
        />
        <ActionPill
          icon="chat_bubble"
          label={post.commentCount > 0 ? `Comentar · ${post.commentCount}` : 'Comentar'}
          active={showComments}
          onClick={() => setShowComments((v) => !v)}
        />
        <ShareAction postId={post.id} title={post.title ?? 'Comunicado'} />
      </div>

      {showComments && <CorporatePostComments postId={post.id} />}

      {showReactors && <PostReactorsDialog postId={post.id} onClose={() => setShowReactors(false)} />}

      {lightboxIndex !== null && (
        <ImageLightbox
          images={imageAttachments.map((att) => ({ url: att.url, name: att.name }))}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </li>
  )
}

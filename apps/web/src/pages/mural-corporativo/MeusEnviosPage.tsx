import { useState } from 'react'
import { CORPORATE_POST_STATUS_LABELS, type PendingCorporatePostDTO } from '@legends/shared'
import { BackButton } from '../../components/BackButton'
import { RichTextView } from '../../components/rich-text/RichTextView'
import { useCorporatePendingPosts } from '../../lib/use-corporate-mural'
import { CorporatePostEditForm } from './CorporatePostEditForm'

/**
 * "Meus envios": o que a pessoa mandou para o feed e ainda não foi ao ar.
 *
 * Existe porque comunicado pendente **não** entra no feed nem para o próprio
 * autor — mostrar um post que a empresa ainda não vê, no meio do que ela vê,
 * seria mentira. Aqui o estado é o assunto da tela, e o motivo da recusa tem
 * onde aparecer (é para cá que a notificação de recusa aponta).
 */
function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/**
 * Um envio. O botão de editar só aparece em `PENDING`: publicado sai da lista, e
 * recusado o servidor não deixa mais mexer (a fila já foi revisada) — mostrar o
 * botão ali só renderia 403 na cara de quem clicasse.
 */
function EnvioCard({ post }: { post: PendingCorporatePostDTO }) {
  const [editing, setEditing] = useState(false)

  return (
    <li className="flex flex-col gap-xs rounded-xl border border-outline-variant/40 bg-surface-container p-md">
      <div className="flex flex-wrap items-center gap-xs">
        <span
          className={`rounded-full px-sm font-label text-label-sm ${
            post.status === 'REJECTED' ? 'bg-error/10 text-error' : 'bg-primary/10 text-primary'
          }`}
        >
          {CORPORATE_POST_STATUS_LABELS[post.status]}
        </span>
        <span className="font-label text-label-sm text-on-surface-variant">
          enviado em {formatDate(post.createdAt)}
        </span>
        {post.status === 'PENDING' && !editing && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="ml-auto font-label text-label-sm text-primary hover:underline"
          >
            Editar
          </button>
        )}
      </div>

      {editing ? (
        <CorporatePostEditForm post={post} onDone={() => setEditing(false)} />
      ) : (
        <>
          {post.title && <p className="font-headline text-title-sm font-bold text-on-surface">{post.title}</p>}
          {post.body ? (
            <RichTextView doc={post.body} className="flex flex-col gap-1" />
          ) : (
            <p className="whitespace-pre-wrap text-body-sm text-on-surface">{post.content}</p>
          )}
        </>
      )}

      {post.rejectionReason && <p className="text-body-sm text-error">Motivo da recusa: {post.rejectionReason}</p>}
    </li>
  )
}

export function MeusEnviosPage() {
  const envios = useCorporatePendingPosts({ mine: true })
  const items = envios.data?.items ?? []

  return (
    <section className="mx-auto max-w-page p-lg md:p-xl">
      <div className="mb-xs flex items-center gap-sm">
        <BackButton fallback="/mural-corporativo" className="-ml-sm" />
        <h1 className="font-headline text-headline-xl text-on-surface">Meus envios</h1>
      </div>
      <p className="mb-lg text-body-sm text-on-surface-variant">
        Comunicados que você enviou e ainda não foram publicados. Assim que Gente e Gestão aprovar, eles aparecem no
        feed da empresa.
      </p>

      {envios.isLoading ? (
        <p className="text-body-sm text-on-surface-variant">Carregando…</p>
      ) : envios.isError ? (
        <p role="alert" className="text-body-sm text-error">
          Erro ao carregar seus envios.
        </p>
      ) : items.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">Você não tem comunicados aguardando aprovação.</p>
      ) : (
        <ul className="flex flex-col gap-sm">
          {items.map((post) => (
            <EnvioCard key={post.id} post={post} />
          ))}
        </ul>
      )}
    </section>
  )
}

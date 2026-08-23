import { useState } from 'react'
import {
  CORPORATE_POST_TITLE_MAX_LENGTH,
  isEmptyRichDoc,
  plainTextToRichDoc,
  type CorporatePostDTO,
  type RichDoc,
} from '@legends/shared'
import { RichTextEditor } from '../../components/rich-text/RichTextEditor'
import { useUpdateCorporatePost } from '../../lib/use-corporate-mural'

/**
 * Edição de um comunicado já gravado. Usada em dois lugares com a mesma regra
 * do servidor: no card do feed (quem administra) e em "Meus envios" (o autor,
 * enquanto o comunicado está pendente).
 *
 * O post antigo é texto puro (`body` nulo): `plainTextToRichDoc` o transforma
 * em documento para o editor abrir, sem precisar migrar dado no banco.
 */
export function CorporatePostEditForm({
  post,
  onDone,
}: {
  post: CorporatePostDTO
  onDone: () => void
}) {
  const update = useUpdateCorporatePost()
  const [title, setTitle] = useState(post.title ?? '')
  const [doc, setDoc] = useState<RichDoc>(post.body ?? plainTextToRichDoc(post.content))

  function save() {
    if (isEmptyRichDoc(doc)) return
    update.mutate(
      { postId: post.id, body: { title: title.trim(), body: doc } },
      { onSuccess: onDone },
    )
  }

  return (
    <div className="mt-sm flex flex-col gap-sm">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value.slice(0, CORPORATE_POST_TITLE_MAX_LENGTH))}
        placeholder="Título (opcional)"
        aria-label="Título do comunicado"
        className="w-full bg-transparent font-headline text-title-md font-bold text-on-surface outline-none placeholder:font-normal placeholder:text-on-surface-variant"
      />
      <RichTextEditor value={doc} onChange={setDoc} ariaLabel="Editar o comunicado" />
      {update.isError && (
        <span role="alert" className="text-label-sm text-error">
          {(update.error as Error).message}
        </span>
      )}
      <div className="flex items-center gap-sm">
        <button
          type="button"
          onClick={save}
          disabled={update.isPending || isEmptyRichDoc(doc)}
          className="rounded-full bg-primary px-lg py-1 font-label text-label-md font-bold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
        >
          {update.isPending ? 'Salvando…' : 'Salvar'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="font-label text-label-md text-on-surface-variant hover:text-on-surface"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}

import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BADGE_CLAIM_STORY_MAX_LENGTH,
  type BadgeCatalogEntryDTO,
  type CorporatePostAttachmentKind,
} from '@legends/shared'
import { ApiError, apiFetch } from '../lib/api'
import { uploadBadgeClaimAttachment, UploadError } from '../lib/upload'
import { Icon } from './Icon'

/**
 * Reivindicação de selo (Documento 4, seção 11.2).
 *
 * Os textos são copy oficial da G&G e estão literais — inclusive o placeholder
 * do relato. Antes disto, selo de comportamento se pedia no Teams.
 *
 * O anexo sobe ANTES do envio, por presign: a chave é montada no servidor
 * (`badge-claims/<userId>/…`) e o service confere esse prefixo, então o
 * navegador nunca escolhe onde o arquivo é gravado.
 */
export function BadgeClaimDialog({
  badge,
  onClose,
}: {
  badge: BadgeCatalogEntryDTO
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [story, setStory] = useState('')
  const [link, setLink] = useState('')
  const [anexo, setAnexo] = useState<{ key: string; kind: CorporatePostAttachmentKind; name: string } | null>(null)
  const [enviandoAnexo, setEnviandoAnexo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const enviar = useMutation({
    mutationFn: () =>
      apiFetch<unknown>(`/badges/${badge.id}/claims`, {
        method: 'POST',
        body: JSON.stringify({
          story: story.trim(),
          attachmentKey: anexo?.key ?? null,
          attachmentKind: anexo?.kind ?? null,
          link: link.trim() || null,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['badgeClaims', 'me'] })
      onClose()
    },
    onError: (err) => setErro(err instanceof ApiError ? err.message : 'Não foi possível enviar a solicitação.'),
  })

  async function handleFile(file: File | null): Promise<void> {
    if (!file) return setAnexo(null)
    setEnviandoAnexo(true)
    setErro(null)
    try {
      const { key, kind } = await uploadBadgeClaimAttachment(file)
      setAnexo({ key, kind, name: file.name })
    } catch (err) {
      setAnexo(null)
      setErro(err instanceof UploadError ? err.message : 'Não foi possível enviar o anexo.')
    } finally {
      setEnviandoAnexo(false)
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!story.trim() || enviandoAnexo) return
    enviar.mutate()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-md">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Reivindicar "${badge.name}"`}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-outline-variant/40 bg-surface-container p-lg shadow-lg"
      >
        <div className="mb-md flex items-start justify-between gap-md">
          <h2 className="font-headline text-title-lg text-on-surface">Reivindicar "{badge.name}"</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-full px-sm py-1 font-label text-label-md text-on-surface-variant hover:bg-surface-container-highest"
          >
            ✕
          </button>
        </div>

        <p className="mb-md text-body-md text-on-surface-variant">
          Conte como você conquistou este emblema. Sua solicitação será analisada pelo time de Gente e
          Gestão.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-md">
          <label className="flex flex-col gap-1">
            <textarea
              value={story}
              onChange={(event) => setStory(event.target.value)}
              rows={5}
              maxLength={BADGE_CLAIM_STORY_MAX_LENGTH}
              aria-label="Relato da conquista"
              placeholder="Explique sua conquista: projeto, comportamento, resultado…"
              className="w-full rounded-lg border border-outline-variant/40 bg-surface p-md text-body-md text-on-surface outline-none focus:border-primary"
            />
            <span className="self-end font-label text-label-sm text-on-surface-variant">
              {story.length}/{BADGE_CLAIM_STORY_MAX_LENGTH}
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">
              Anexo — print, foto ou certificado (imagem ou PDF)
            </span>
            <input
              type="file"
              accept="image/*,application/pdf"
              aria-label="Anexo — print, foto ou certificado (imagem ou PDF)"
              onChange={(event) => void handleFile(event.target.files?.[0] ?? null)}
              className="text-body-sm text-on-surface-variant"
            />
            {enviandoAnexo && <span className="text-body-sm text-on-surface-variant">Enviando anexo…</span>}
            {anexo && !enviandoAnexo && (
              <span className="flex items-center gap-xs text-body-sm text-primary">
                <Icon name="check_circle" className="text-[16px]" />
                {anexo.name}
              </span>
            )}
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Ou cole um link (opcional)</span>
            <input
              value={link}
              onChange={(event) => setLink(event.target.value)}
              aria-label="Ou cole um link (opcional)"
              placeholder="https://…"
              className="w-full rounded-lg border border-outline-variant/40 bg-surface px-md py-sm text-body-md text-on-surface outline-none focus:border-primary"
            />
          </label>

          {erro && (
            <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
              <Icon name="error" className="text-[16px]" />
              {erro}
            </p>
          )}

          <button
            type="submit"
            disabled={!story.trim() || enviandoAnexo || enviar.isPending}
            className="w-fit rounded-full bg-primary px-lg py-sm font-label text-label-md text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
          >
            Enviar solicitação
          </button>
        </form>
      </div>
    </div>
  )
}

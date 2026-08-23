import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CulturePageDTO, CulturePageSlug } from '@legends/shared'
import { CULTURE_BODY_MAX_LENGTH } from '@legends/shared'
import { ApiError, apiFetch } from '../../../lib/api'
import { Markdown } from '../../../components/Markdown'
import { Panel, inputCls } from '../shared'

interface CulturePageEditorProps {
  slug: CulturePageSlug
  panelTitle: string
  /** O que a página é, em uma frase — some quando não faz falta. */
  hint?: string
  titlePlaceholder?: string
  subtitlePlaceholder?: string
  bodyPlaceholder?: string
  /**
   * Mensagens explícitas por conteúdo em vez de uma frase genérica montada a
   * partir do nome: em português o artigo e o gênero mudam ("o manifesto", "as
   * regras"), e texto costurado sai errado em metade dos casos.
   */
  savedMessage: string
  errorMessage: string
}

/**
 * Editor de uma página institucional: textarea de Markdown com pré-visualização
 * ao vivo pelo MESMO componente da tela do colaborador — o que se vê aqui é o
 * que sai lá.
 *
 * Parametrizado por slug porque `CulturePage` sempre foi genérica (o schema diz
 * isso desde o manifesto): cada conteúdo novo é um slug, não uma tela nova com
 * um editor copiado.
 */
export function CulturePageEditor({
  slug,
  panelTitle,
  hint,
  titlePlaceholder,
  subtitlePlaceholder,
  bodyPlaceholder,
  savedMessage,
  errorMessage,
}: CulturePageEditorProps) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [subtitle, setSubtitle] = useState('')
  const [body, setBody] = useState('')
  const [published, setPublished] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const pageQuery = useQuery({
    queryKey: ['admin', 'culture', 'page', slug],
    queryFn: () => apiFetch<{ page: CulturePageDTO | null }>(`/admin/culture/pages/${slug}`),
  })

  // Carrega o formulário quando a página chega do backend.
  useEffect(() => {
    const page = pageQuery.data?.page
    if (!page) return
    setTitle(page.title)
    setSubtitle(page.subtitle ?? '')
    setBody(page.body)
    setPublished(page.published)
  }, [pageQuery.data])

  const save = useMutation({
    mutationFn: () =>
      apiFetch<{ page: CulturePageDTO }>(`/admin/culture/pages/${slug}`, {
        method: 'PUT',
        body: JSON.stringify({
          title: title.trim(),
          subtitle: subtitle.trim() ? subtitle.trim() : null,
          body,
          published,
        }),
      }),
    onSuccess: () => {
      setError(null)
      setSaved(true)
      queryClient.invalidateQueries({ queryKey: ['admin', 'culture', 'page', slug] })
      queryClient.invalidateQueries({ queryKey: ['culture', 'page', slug] })
    },
    onError: (err) => {
      setSaved(false)
      setError(err instanceof ApiError ? err.message : errorMessage)
    },
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSaved(false)
    if (!title.trim() || !body.trim()) {
      setError('Título e conteúdo são obrigatórios.')
      return
    }
    save.mutate()
  }

  return (
    <Panel title={panelTitle}>
      {hint && <p className="mb-md text-body-sm text-on-surface-variant">{hint}</p>}
      {pageQuery.isLoading && <p className="text-body-sm text-on-surface-variant">Carregando…</p>}

      <form onSubmit={handleSubmit} className="flex flex-col gap-md">
        <label className="flex flex-col gap-xs">
          <span className="font-label text-label-sm text-on-surface-variant">Título</span>
          <input
            className={inputCls}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={titlePlaceholder}
          />
        </label>

        <label className="flex flex-col gap-xs">
          <span className="font-label text-label-sm text-on-surface-variant">Subtítulo (opcional)</span>
          <input
            className={inputCls}
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            placeholder={subtitlePlaceholder}
          />
        </label>

        <div className="grid gap-md lg:grid-cols-2">
          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-sm text-on-surface-variant">
              Conteúdo (Markdown) — {body.length}/{CULTURE_BODY_MAX_LENGTH}
            </span>
            <textarea
              className={`${inputCls} min-h-[28rem] font-mono`}
              value={body}
              maxLength={CULTURE_BODY_MAX_LENGTH}
              onChange={(e) => setBody(e.target.value)}
              placeholder={bodyPlaceholder}
            />
          </label>

          <div className="flex flex-col gap-xs">
            <span className="font-label text-label-sm text-on-surface-variant">Pré-visualização</span>
            <div className="min-h-[28rem] overflow-y-auto rounded-md border border-outline-variant/40 bg-surface-container-low p-md">
              {body.trim() ? (
                <Markdown content={body} />
              ) : (
                <p className="text-body-sm text-on-surface-variant">
                  O conteúdo aparece aqui conforme você escreve.
                </p>
              )}
            </div>
          </div>
        </div>

        <label className="flex items-center gap-xs font-label text-label-sm text-on-surface">
          <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
          Publicado (visível para os colaboradores)
        </label>

        {error && <p className="text-body-sm text-error">{error}</p>}
        {saved && !error && <p className="text-body-sm text-primary">{savedMessage}</p>}

        <div>
          <button
            type="submit"
            disabled={save.isPending}
            className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
          >
            {save.isPending ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </Panel>
  )
}

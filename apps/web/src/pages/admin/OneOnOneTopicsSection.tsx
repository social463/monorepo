import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { OneOnOneTopicTemplateDTO } from '@legends/shared'
import { apiFetch } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { Panel, inputCls, errorMessage } from './shared'

const QUERY_KEY = ['admin-one-on-one-topics']

/**
 * Catálogo de tópicos sugeridos no 1:1 (aba "Pauta" do encontro): o gestor
 * escolhe entre estas perguntas prontas, agrupadas por tema. Inativar mantém
 * o histórico (encontros já usam o texto congelado), só some da sugestão.
 */
export function OneOnOneTopicsSection() {
  const qc = useQueryClient()
  const [theme, setTheme] = useState('')
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const topicsQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => apiFetch<{ templates: OneOnOneTopicTemplateDTO[] }>('/admin/one-on-one-topics'),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: QUERY_KEY })

  const createTopic = useMutation({
    mutationFn: (body: { theme: string; text: string }) =>
      apiFetch<{ template: OneOnOneTopicTemplateDTO }>('/admin/one-on-one-topics', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setTheme('')
      setText('')
      setError(null)
      invalidate()
    },
    onError: (err) => setError(errorMessage(err, 'Erro ao criar tópico.')),
  })

  const toggleTopic = useMutation({
    mutationFn: (vars: { id: string; active: boolean }) =>
      apiFetch<{ template: OneOnOneTopicTemplateDTO }>(`/admin/one-on-one-topics/${vars.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: vars.active }),
      }),
    onSuccess: invalidate,
    onError: (err) => setError(errorMessage(err, 'Erro ao atualizar tópico.')),
  })

  const deleteTopic = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/admin/one-on-one-topics/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
    onError: (err) => setError(errorMessage(err, 'Erro ao excluir tópico.')),
  })

  const templates = topicsQuery.data?.templates ?? []
  const groups = groupByTheme(templates)

  function handleCreate(event: FormEvent) {
    event.preventDefault()
    if (!theme.trim() || !text.trim()) return
    createTopic.mutate({ theme: theme.trim(), text: text.trim() })
  }

  function handleDelete(topic: OneOnOneTopicTemplateDTO) {
    if (!window.confirm(`Excluir o tópico "${topic.text}"? Esta ação não pode ser desfeita.`)) return
    deleteTopic.mutate(topic.id)
  }

  return (
    <Panel title="Tópicos de 1:1">
      <p className="mb-lg text-body-sm text-on-surface-variant">
        Perguntas sugeridas na pauta do 1:1, agrupadas por tema. Desativar mantém o histórico dos encontros que já
        usaram a pergunta.
      </p>

      <form onSubmit={handleCreate} className="mb-lg flex flex-col gap-sm sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Tema</span>
          <input
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            aria-label="Tema"
            placeholder="Ex.: Carreira"
            className={inputCls}
          />
        </label>
        <label className="flex flex-[2] flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Pergunta</span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label="Pergunta"
            placeholder="Ex.: Onde você quer chegar?"
            className={inputCls}
          />
        </label>
        <button
          type="submit"
          disabled={createTopic.isPending}
          className="inline-flex items-center gap-sm rounded-md bg-primary px-lg py-2 font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
        >
          <Icon name="add" className="text-[18px]" />
          Adicionar
        </button>
      </form>

      {error && (
        <p role="alert" className="mb-md flex items-center gap-sm text-body-sm text-error">
          <Icon name="error" className="text-[16px]" />
          {error}
        </p>
      )}

      <div className="flex flex-col gap-lg">
        {groups.map((group) => (
          <div key={group.theme}>
            <h4 className="mb-sm font-label text-label-sm font-bold uppercase tracking-wide text-on-surface-variant">
              {group.theme}
            </h4>
            <ul className="flex flex-col gap-sm">
              {group.items.map((topic) => (
                <li
                  key={topic.id}
                  className="flex items-center justify-between gap-md rounded-lg border border-outline-variant/20 bg-surface-container-low p-md"
                >
                  <span className={topic.active ? 'text-on-surface' : 'text-on-surface-variant line-through'}>
                    {topic.text}
                  </span>
                  <div className="flex shrink-0 items-center gap-sm">
                    <button
                      type="button"
                      onClick={() => toggleTopic.mutate({ id: topic.id, active: !topic.active })}
                      className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
                    >
                      {topic.active ? 'Desativar' : 'Ativar'}
                    </button>
                    <button
                      type="button"
                      aria-label={`Excluir ${topic.text}`}
                      onClick={() => handleDelete(topic)}
                      className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant hover:border-error hover:text-error"
                    >
                      <Icon name="delete" className="text-[16px]" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {templates.length === 0 && !topicsQuery.isLoading && (
          <p className="text-body-sm text-on-surface-variant">Nenhum tópico cadastrado ainda.</p>
        )}
      </div>
    </Panel>
  )
}

/**
 * Agrupa preservando a ordem de chegada dos itens (não ordena por conta
 * própria): depende do backend já devolver os templates ordenados por
 * `theme asc, sortOrder asc` (ver `one-on-one-topic-admin-service.ts`). Se o
 * service mudar essa ordenação, os temas e as perguntas dentro de cada tema
 * aparecem fora de ordem aqui sem nenhum erro visível.
 */
function groupByTheme(
  templates: OneOnOneTopicTemplateDTO[],
): { theme: string; items: OneOnOneTopicTemplateDTO[] }[] {
  const byTheme = new Map<string, OneOnOneTopicTemplateDTO[]>()
  for (const template of templates) {
    const bucket = byTheme.get(template.theme)
    if (bucket) bucket.push(template)
    else byTheme.set(template.theme, [template])
  }
  return Array.from(byTheme.entries()).map(([theme, items]) => ({ theme, items }))
}

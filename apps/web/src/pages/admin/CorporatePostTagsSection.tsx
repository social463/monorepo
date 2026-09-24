import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CORPORATE_POST_TAG_NAME_MAX_LENGTH, type CorporatePostTagDTO } from '@legends/shared'
import { ApiError, apiFetch } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { Panel, inputCls } from './shared'

const KEY = ['admin', 'corporate-post-tags'] as const

/** Paleta de partida das tags novas — a primária e as complementares da marca. */
const COLORS = ['#264641', '#6CE190', '#50BCFF', '#FF7013', '#9500DB', '#FFCB05', '#FF514D', '#009B3F']

/**
 * Catálogo de **tipos de comunicação** do Feed Corporativo (Documento 3,
 * seção 13).
 *
 * A OBS da seção pede que a lista seja gerenciável pela G&G "sem depender do
 * time de TI" — daí a tela existir em vez de a lista ser constante no código.
 *
 * Não há excluir, e isso é decisão: apagar uma tag deixaria comunicado órfão e
 * sumiria com a série histórica do painel de Comunicação Interna. Desativar tira
 * a categoria de circulação (some do editor e do filtro) sem reescrever o
 * passado — a mesma regra do catálogo de categorias de feedback.
 */
export function CorporatePostTagsSection() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [color, setColor] = useState(COLORS[1])
  const [editing, setEditing] = useState<{ id: string; name: string; color: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const tagsQuery = useQuery({
    queryKey: KEY,
    queryFn: () => apiFetch<{ tags: CorporatePostTagDTO[] }>('/admin/corporate-post-tags'),
  })
  const tags = tagsQuery.data?.tags ?? []

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: KEY })
    // O seletor do editor e as pílulas do Feed leem outra query.
    void queryClient.invalidateQueries({ queryKey: ['corporate-post-tags'] })
  }

  const create = useMutation({
    mutationFn: (body: { name: string; color: string }) =>
      apiFetch('/admin/corporate-post-tags', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setName('')
      setError(null)
      invalidate()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao criar a categoria.'),
  })

  const update = useMutation({
    mutationFn: (vars: { id: string; body: Record<string, unknown> }) =>
      apiFetch(`/admin/corporate-post-tags/${vars.id}`, { method: 'PATCH', body: JSON.stringify(vars.body) }),
    onSuccess: () => {
      setEditing(null)
      setError(null)
      invalidate()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao atualizar a categoria.'),
  })

  function handleCreate(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) {
      setError('Informe o nome da categoria.')
      return
    }
    create.mutate({ name: name.trim(), color })
  }

  function handleEdit(event: FormEvent) {
    event.preventDefault()
    if (!editing) return
    update.mutate({ id: editing.id, body: { name: editing.name.trim(), color: editing.color } })
  }

  return (
    <section className="flex flex-col gap-lg">
      <header>
        <h2 className="font-headline text-headline-lg text-on-surface">Tipos de comunicação</h2>
        <p className="mt-2 text-body-md text-on-surface-variant">
          As categorias do Feed Corporativo. Elas aparecem no editor de comunicado, no filtro do topo do Feed
          e no painel de Comunicação Interna.
        </p>
      </header>

      <Panel title="Categorias">
        {error && (
          <p role="alert" className="mb-md flex items-center gap-sm text-body-sm text-error">
            <Icon name="error" className="text-[16px]" />
            {error}
          </p>
        )}

        <form onSubmit={handleCreate} className="mb-lg flex flex-wrap items-end gap-sm">
          <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            Nome
            <input
              className={`${inputCls} w-64`}
              value={name}
              maxLength={CORPORATE_POST_TAG_NAME_MAX_LENGTH}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Treinamento"
              aria-label="Nome da categoria"
            />
          </label>
          <ColorPicker value={color} onChange={setColor} label="Cor da categoria" />
          <button
            type="submit"
            disabled={create.isPending}
            className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
          >
            Adicionar
          </button>
        </form>

        {tagsQuery.isLoading && <p className="text-body-sm text-on-surface-variant">Carregando…</p>}

        {!tagsQuery.isLoading && tags.length === 0 && (
          <p className="text-body-sm text-on-surface-variant">
            Nenhuma categoria cadastrada — sem categoria, o filtro do Feed não aparece.
          </p>
        )}

        <ul className="flex flex-col gap-sm">
          {tags.map((tag) => (
            <li
              key={tag.id}
              className="flex flex-wrap items-center justify-between gap-md rounded-lg border border-outline-variant/30 p-md"
            >
              {editing?.id === tag.id ? (
                <form onSubmit={handleEdit} className="flex flex-wrap items-end gap-sm">
                  <input
                    className={`${inputCls} w-64`}
                    value={editing.name}
                    maxLength={CORPORATE_POST_TAG_NAME_MAX_LENGTH}
                    onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                    aria-label="Nome da categoria"
                  />
                  <ColorPicker
                    value={editing.color}
                    onChange={(next) => setEditing({ ...editing, color: next })}
                    label="Cor da categoria"
                  />
                  <button
                    type="submit"
                    className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container"
                  >
                    Salvar
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="rounded-md border border-outline-variant/60 px-lg py-sm font-label text-label-md text-on-surface-variant hover:text-on-surface"
                  >
                    Cancelar
                  </button>
                </form>
              ) : (
                <>
                  <span className="flex items-center gap-sm">
                    <span aria-hidden className="h-3 w-3 rounded-full" style={{ backgroundColor: tag.color }} />
                    <span className={tag.active ? 'text-on-surface' : 'text-on-surface-variant line-through'}>
                      {tag.name}
                    </span>
                    {!tag.active && (
                      <span className="rounded-full bg-surface-container-highest px-sm py-[1px] font-label text-label-sm text-on-surface-variant">
                        inativa
                      </span>
                    )}
                  </span>
                  <span className="flex gap-sm">
                    <button
                      type="button"
                      onClick={() => setEditing({ id: tag.id, name: tag.name, color: tag.color })}
                      className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => update.mutate({ id: tag.id, body: { active: !tag.active } })}
                      className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
                    >
                      {tag.active ? 'Desativar' : 'Ativar'}
                    </button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>

        <p className="mt-md text-body-sm text-on-surface-variant">
          Categoria é desativada, nunca apagada: os comunicados que já a usam continuam classificados, e a
          série do painel de Comunicação Interna não perde o passado.
        </p>
      </Panel>
    </section>
  )
}

/** Amostras clicáveis da paleta da marca, com o hexadecimal ao lado para o resto. */
function ColorPicker({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (color: string) => void
  label: string
}) {
  return (
    <span className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
      {label}
      <span role="group" aria-label={label} className="flex items-center gap-xs">
        {COLORS.map((option) => (
          <button
            key={option}
            type="button"
            aria-label={`Cor ${option}`}
            aria-pressed={value.toUpperCase() === option.toUpperCase()}
            onClick={() => onChange(option)}
            className={`h-7 w-7 rounded-full border-2 transition-transform ${
              value.toUpperCase() === option.toUpperCase()
                ? 'scale-110 border-on-surface'
                : 'border-transparent hover:scale-105'
            }`}
            style={{ backgroundColor: option }}
          />
        ))}
      </span>
    </span>
  )
}

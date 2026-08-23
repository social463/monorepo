import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  RECOGNITION_CATEGORY_NAME_MAX_LENGTH,
  type RecognitionCategoriesResponse,
  type RecognitionCategoryDTO,
} from '@legends/shared'
import { ApiError, apiFetch } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { Panel, inputCls } from './shared'

/**
 * Administração › Categorias: o vocabulário da empresa — **um só** para o
 * feedback e para a votação do mês desde
 * `specs/2026-08-20-unificar-reconhecimento-em-feedback-design.md`. Eram duas
 * telas, com a mesma cara e listas diferentes.
 *
 * Categoria é **desativada**, nunca apagada: apagar levaria junto os chips dos
 * feedbacks já escritos e as categorias dos votos já apurados, reescrevendo o
 * passado de quem foi reconhecido.
 */
const KEY = ['admin', 'categories'] as const

function CategoryRow({ category }: { category: RecognitionCategoryDTO }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(category.name)
  const [editing, setEditing] = useState(false)

  const update = useMutation({
    mutationFn: (body: { name?: string; active?: boolean; order?: number }) =>
      apiFetch<{ category: RecognitionCategoryDTO }>(`/admin/categories/${category.id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setEditing(false)
      queryClient.invalidateQueries({ queryKey: KEY })
      queryClient.invalidateQueries({ queryKey: ['categories'] })
    },
  })

  return (
    <li className="flex flex-wrap items-center gap-sm rounded-lg border border-outline-variant/20 bg-surface-container-low p-md">
      {editing ? (
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, RECOGNITION_CATEGORY_NAME_MAX_LENGTH))}
          aria-label={`Nome da categoria ${category.name}`}
          className={`${inputCls} min-w-[14rem] flex-1`}
        />
      ) : (
        <span className={`min-w-[14rem] flex-1 font-label text-label-md ${category.active ? 'text-on-surface' : 'text-on-surface-variant line-through'}`}>
          {category.name}
        </span>
      )}

      {editing ? (
        <>
          <button
            type="button"
            onClick={() => update.mutate({ name: name.trim() })}
            disabled={update.isPending || !name.trim()}
            className="rounded-md bg-primary px-3 py-1 font-label text-label-sm font-bold text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
          >
            Salvar
          </button>
          <button
            type="button"
            onClick={() => {
              setName(category.name)
              setEditing(false)
            }}
            className="font-label text-label-sm text-on-surface-variant hover:text-on-surface"
          >
            Cancelar
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
          >
            Renomear
          </button>
          <button
            type="button"
            onClick={() => update.mutate({ active: !category.active })}
            disabled={update.isPending}
            className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
          >
            {category.active ? 'Desativar' : 'Reativar'}
          </button>
        </>
      )}

      {update.isError && (
        <span role="alert" className="w-full text-label-sm text-error">
          {(update.error as ApiError).message}
        </span>
      )}
    </li>
  )
}

export function CategoriesSection() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const categories = useQuery({
    queryKey: KEY,
    queryFn: () => apiFetch<RecognitionCategoriesResponse>('/admin/categories'),
  })
  const create = useMutation({
    mutationFn: () =>
      apiFetch<{ category: RecognitionCategoryDTO }>('/admin/categories', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), order: (categories.data?.categories.length ?? 0) + 1 }),
      }),
    onSuccess: () => {
      setName('')
      queryClient.invalidateQueries({ queryKey: KEY })
      queryClient.invalidateQueries({ queryKey: ['categories'] })
    },
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim() || create.isPending) return
    create.mutate()
  }

  return (
    <Panel title="Categorias">
      <p className="mb-md text-body-sm text-on-surface-variant">
        A lista que aparece no seletor de quem escreve um feedback, no filtro de
        quem lê o mural e na votação do mês.
      </p>

      <form onSubmit={handleSubmit} className="mb-lg flex flex-wrap items-center gap-sm">
        <label className="sr-only" htmlFor="nova-competencia">
          Nova categoria
        </label>
        <input
          id="nova-competencia"
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, RECOGNITION_CATEGORY_NAME_MAX_LENGTH))}
          placeholder="Ex.: Foco no Cliente"
          className={`${inputCls} min-w-[16rem] flex-1`}
        />
        <button
          type="submit"
          disabled={!name.trim() || create.isPending}
          className="rounded-md bg-primary px-lg py-2 font-label text-label-md font-bold text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
        >
          Adicionar
        </button>
        {create.isError && (
          <span role="alert" className="w-full text-label-sm text-error">
            {(create.error as ApiError).message}
          </span>
        )}
      </form>

      {categories.isLoading ? (
        <p className="text-body-sm text-on-surface-variant">Carregando…</p>
      ) : categories.isError ? (
        <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
          <Icon name="error" className="text-[16px]" />
          Erro ao carregar as categorias.
        </p>
      ) : (categories.data?.categories.length ?? 0) === 0 ? (
        <p className="text-body-sm text-on-surface-variant">Nenhuma categoria cadastrada ainda.</p>
      ) : (
        <ul className="flex flex-col gap-sm">
          {categories.data?.categories.map((category) => (
            <CategoryRow key={category.id} category={category} />
          ))}
        </ul>
      )}
    </Panel>
  )
}

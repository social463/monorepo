import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BADGE_CATEGORY_NAME_MAX_LENGTH, type BadgeCategoryDTO } from '@legends/shared'
import { ApiError, apiFetch } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { Panel, inputCls } from './shared'

/**
 * Temas do catálogo de selos (Documento 4, seção 11.4): a G&G cria e edita.
 *
 * **Não é a categoria de reconhecimento.** Aquela é a categoria do feedback e
 * mora em Administração › Categorias; esta só organiza a gaveta do Painel de
 * Emblemas. Ver o comentário no `schema.prisma`.
 *
 * Desativa em vez de apagar: o `slug` é o que a importação por planilha casa, e
 * apagar levaria junto a classificação dos selos.
 */
export function BadgeCategoriesPanel() {
  const queryClient = useQueryClient()
  const [nome, setNome] = useState('')
  const [editandoId, setEditandoId] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const categoriesQuery = useQuery({
    queryKey: ['admin', 'badgeCategories'],
    queryFn: () => apiFetch<{ categories: BadgeCategoryDTO[] }>('/admin/badge-categories'),
  })

  function aoSalvar() {
    setNome('')
    setEditandoId(null)
    setErro(null)
    queryClient.invalidateQueries({ queryKey: ['admin', 'badgeCategories'] })
    queryClient.invalidateQueries({ queryKey: ['badgeCategories'] })
    queryClient.invalidateQueries({ queryKey: ['admin', 'badges'] })
  }

  const criar = useMutation({
    mutationFn: (name: string) =>
      apiFetch<unknown>('/admin/badge-categories', { method: 'POST', body: JSON.stringify({ name }) }),
    onSuccess: aoSalvar,
    onError: (err) => setErro(err instanceof ApiError ? err.message : 'Erro ao criar o tema.'),
  })

  const atualizar = useMutation({
    mutationFn: (vars: { id: string; data: Record<string, unknown> }) =>
      apiFetch<unknown>(`/admin/badge-categories/${vars.id}`, {
        method: 'PATCH',
        body: JSON.stringify(vars.data),
      }),
    onSuccess: aoSalvar,
    onError: (err) => setErro(err instanceof ApiError ? err.message : 'Erro ao salvar o tema.'),
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const limpo = nome.trim()
    if (!limpo) return
    if (editandoId) atualizar.mutate({ id: editandoId, data: { name: limpo } })
    else criar.mutate(limpo)
  }

  const categories = categoriesQuery.data?.categories ?? []

  return (
    <Panel title="Temas do catálogo">
      <p className="mb-md text-body-sm text-on-surface-variant">
        A gaveta em que cada selo aparece no catálogo. Não confundir com as categorias de
        reconhecimento, que são do feedback e ficam em Administração › Categorias.
      </p>

      <form onSubmit={handleSubmit} className="mb-md flex flex-wrap items-center gap-sm">
        <input
          className={`${inputCls} min-w-[14rem] flex-grow`}
          value={nome}
          maxLength={BADGE_CATEGORY_NAME_MAX_LENGTH}
          onChange={(e) => setNome(e.target.value)}
          aria-label={editandoId ? 'Novo nome do tema' : 'Nome do tema'}
          placeholder="Ex.: Cultura"
        />
        <button
          type="submit"
          disabled={criar.isPending || atualizar.isPending || !nome.trim()}
          className="rounded-md bg-primary px-lg py-sm font-label text-label-md text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
        >
          {editandoId ? 'Salvar' : 'Adicionar tema'}
        </button>
        {editandoId && (
          <button
            type="button"
            onClick={() => {
              setEditandoId(null)
              setNome('')
            }}
            className="rounded-md border border-outline-variant/60 px-lg py-sm font-label text-label-md text-on-surface-variant hover:text-on-surface"
          >
            Cancelar
          </button>
        )}
      </form>

      {erro && (
        <p role="alert" className="mb-md flex items-center gap-sm text-body-sm text-error">
          <Icon name="error" className="text-[16px]" />
          {erro}
        </p>
      )}

      <ul className="flex flex-col gap-1">
        {categories.map((category) => (
          <li
            key={category.id}
            className="flex items-center gap-sm rounded-lg border border-outline-variant/20 bg-surface-container-low px-md py-sm"
          >
            <span className={`flex-grow font-label text-label-md ${category.active ? 'text-on-surface' : 'text-on-surface-variant line-through'}`}>
              {category.name}
            </span>
            <span className="font-label text-label-sm text-on-surface-variant">
              {category.badgeCount} {category.badgeCount === 1 ? 'selo' : 'selos'}
            </span>
            <button
              type="button"
              onClick={() => {
                setEditandoId(category.id)
                setNome(category.name)
              }}
              aria-label={`Renomear tema ${category.name}`}
              className="rounded-md border border-outline-variant/60 p-1 text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
            >
              <Icon name="edit" className="text-[18px]" />
            </button>
            <button
              type="button"
              onClick={() => atualizar.mutate({ id: category.id, data: { active: !category.active } })}
              aria-label={`${category.active ? 'Desativar' : 'Reativar'} tema ${category.name}`}
              className="rounded-md border border-outline-variant/60 p-1 text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
            >
              <Icon name={category.active ? 'visibility_off' : 'visibility'} className="text-[18px]" />
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

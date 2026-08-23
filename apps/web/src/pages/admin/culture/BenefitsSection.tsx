import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CultureBenefitDTO } from '@legends/shared'
import { ApiError, apiFetch } from '../../../lib/api'
import { Icon } from '../../../components/Icon'
import { Markdown } from '../../../components/Markdown'
import { Panel, inputCls } from '../shared'

interface FormState {
  id: string | null
  title: string
  summary: string
  icon: string
  body: string
  published: boolean
}

const EMPTY: FormState = { id: null, title: '', summary: '', icon: '', body: '', published: true }

export function BenefitsSection() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState | null>(null)
  const [error, setError] = useState<string | null>(null)

  const benefitsQuery = useQuery({
    queryKey: ['admin', 'culture', 'benefits'],
    queryFn: () => apiFetch<{ benefits: CultureBenefitDTO[] }>('/admin/culture/benefits'),
  })
  const benefits = benefitsQuery.data?.benefits ?? []

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['admin', 'culture', 'benefits'] })
    queryClient.invalidateQueries({ queryKey: ['culture', 'benefits'] })
  }

  const saveBenefit = useMutation({
    mutationFn: (state: FormState) => {
      const payload = {
        title: state.title.trim(),
        summary: state.summary.trim(),
        icon: state.icon.trim() ? state.icon.trim() : null,
        body: state.body,
        published: state.published,
      }
      return state.id
        ? apiFetch<{ benefit: CultureBenefitDTO }>(`/admin/culture/benefits/${state.id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          })
        : apiFetch<{ benefit: CultureBenefitDTO }>('/admin/culture/benefits', {
            method: 'POST',
            body: JSON.stringify(payload),
          })
    },
    onSuccess: () => {
      setForm(null)
      setError(null)
      invalidate()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao salvar o benefício.'),
  })

  const removeBenefit = useMutation({
    mutationFn: (id: string) => apiFetch(`/admin/culture/benefits/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao excluir o benefício.'),
  })

  const reorder = useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch('/admin/culture/benefits/reorder', { method: 'POST', body: JSON.stringify({ ids }) }),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao reordenar.'),
  })

  function move(index: number, delta: number) {
    const next = [...benefits]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    reorder.mutate(next.map((b) => b.id))
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!form) return
    if (!form.title.trim() || !form.summary.trim() || !form.body.trim()) {
      setError('Título, resumo e conteúdo são obrigatórios.')
      return
    }
    saveBenefit.mutate(form)
  }

  return (
    <Panel
      title="Benefícios"
      action={
        <button
          type="button"
          onClick={() => {
            setError(null)
            setForm({ ...EMPTY })
          }}
          className="rounded-md bg-primary px-md py-sm font-label text-label-md font-bold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container"
        >
          Novo benefício
        </button>
      }
    >
      {error && <p className="mb-md text-body-sm text-error">{error}</p>}

      {form && (
        <form
          onSubmit={handleSubmit}
          className="mb-lg flex flex-col gap-md rounded-lg border border-outline-variant/30 bg-surface-container-low p-md"
        >
          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-sm text-on-surface-variant">Título</span>
            <input
              className={inputCls}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="CVV — 188"
            />
          </label>

          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-sm text-on-surface-variant">Resumo (aparece no card)</span>
            <input
              className={inputCls}
              value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
              placeholder="Atendimento 24h para apoio emocional"
            />
          </label>

          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-sm text-on-surface-variant">
              Ícone (nome do Material Symbol, ex.: favorite)
            </span>
            <div className="flex items-center gap-sm">
              <input
                className={inputCls}
                value={form.icon}
                onChange={(e) => setForm({ ...form, icon: e.target.value })}
                placeholder="volunteer_activism"
              />
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <Icon name={form.icon.trim() || 'volunteer_activism'} className="text-[22px]" />
              </span>
            </div>
          </label>

          <div className="grid gap-md lg:grid-cols-2">
            <label className="flex flex-col gap-xs">
              <span className="font-label text-label-sm text-on-surface-variant">
                Detalhe em Markdown (modal)
              </span>
              <textarea
                className={`${inputCls} min-h-56 font-mono`}
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                placeholder={'## O que é\n\nTexto do benefício…'}
              />
            </label>
            <div className="flex flex-col gap-xs">
              <span className="font-label text-label-sm text-on-surface-variant">Pré-visualização</span>
              <div className="min-h-56 overflow-y-auto rounded-md border border-outline-variant/40 bg-surface-container p-md">
                {form.body.trim() ? (
                  <Markdown content={form.body} />
                ) : (
                  <p className="text-body-sm text-on-surface-variant">O detalhe aparece aqui.</p>
                )}
              </div>
            </div>
          </div>

          <label className="flex items-center gap-xs font-label text-label-sm text-on-surface">
            <input
              type="checkbox"
              checked={form.published}
              onChange={(e) => setForm({ ...form, published: e.target.checked })}
            />
            Publicado
          </label>

          <div className="flex gap-sm">
            <button
              type="submit"
              disabled={saveBenefit.isPending}
              className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
            >
              {form.id ? 'Salvar alterações' : 'Criar benefício'}
            </button>
            <button
              type="button"
              onClick={() => {
                setForm(null)
                setError(null)
              }}
              className="rounded-md border border-outline-variant/60 px-lg py-sm font-label text-label-md text-on-surface-variant hover:border-primary hover:text-primary"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {benefitsQuery.isLoading && <p className="text-body-sm text-on-surface-variant">Carregando…</p>}

      {!benefitsQuery.isLoading && benefits.length === 0 && (
        <p className="text-body-sm text-on-surface-variant">Nenhum benefício cadastrado ainda.</p>
      )}

      <ul className="flex flex-col gap-sm">
        {benefits.map((benefit, index) => (
          <li
            key={benefit.id}
            className="flex flex-wrap items-center justify-between gap-md rounded-lg border border-outline-variant/20 bg-surface-container-low p-md"
          >
            <div className="flex min-w-0 items-center gap-md">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <Icon name={benefit.icon || 'volunteer_activism'} className="text-[22px]" />
              </span>
              <div className="min-w-0">
                <p className={benefit.published ? 'text-on-surface' : 'text-on-surface-variant line-through'}>
                  {benefit.title}
                </p>
                <p className="text-body-sm text-on-surface-variant">{benefit.summary}</p>
              </div>
            </div>
            <div className="flex items-center gap-xs">
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label={`Subir ${benefit.title}`}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-outline-variant/60 text-on-surface-variant disabled:opacity-40"
              >
                <Icon name="arrow_upward" className="text-[18px]" />
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === benefits.length - 1}
                aria-label={`Descer ${benefit.title}`}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-outline-variant/60 text-on-surface-variant disabled:opacity-40"
              >
                <Icon name="arrow_downward" className="text-[18px]" />
              </button>
              <button
                type="button"
                onClick={() =>
                  setForm({
                    id: benefit.id,
                    title: benefit.title,
                    summary: benefit.summary,
                    icon: benefit.icon ?? '',
                    body: benefit.body,
                    published: benefit.published,
                  })
                }
                className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
              >
                Editar
              </button>
              <button
                type="button"
                onClick={() => removeBenefit.mutate(benefit.id)}
                className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-error hover:border-error"
              >
                Excluir
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

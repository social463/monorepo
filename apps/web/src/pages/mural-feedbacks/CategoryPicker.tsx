import { useEffect, useMemo, useRef, useState } from 'react'
import type { RecognitionCategoryDTO } from '@legends/shared'
import { Icon } from '../../components/Icon'
import { categoryDotClass } from './category-colors'

/**
 * Seleção das categorias do feedback, no modelo da referência da G&G:
 * um campo fechado que mostra o que já foi escolhido, e que abre em busca +
 * lista rolável com marcador colorido por competência.
 *
 * Substituiu a fileira de 13 chips soltos. Com o catálogo inteiro à mostra o
 * bloco ocupava três linhas antes de a pessoa escrever qualquer coisa, e crescia
 * com o catálogo de cada empresa — a caixa fechada tem altura previsível e a
 * busca é o que salva quem tem catálogo grande.
 */
export function CategoryPicker({
  categories,
  value,
  onChange,
  max,
  loading = false,
}: {
  categories: RecognitionCategoryDTO[]
  value: string[]
  onChange: (ids: string[]) => void
  /** Teto de competências por feedback; ao encher, o resto fica desabilitado. */
  max: number
  loading?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const selected = useMemo(
    () => value.map((id) => categories.find((c) => c.id === id)).filter((c): c is RecognitionCategoryDTO => Boolean(c)),
    [value, categories],
  )
  const results = useMemo(() => {
    const term = query.trim().toLowerCase()
    return term ? categories.filter((c) => c.name.toLowerCase().includes(term)) : categories
  }, [categories, query])

  // Fecha ao clicar fora, como no seletor de colega.
  useEffect(() => {
    if (!open) return
    function handlePointer(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handlePointer)
    return () => document.removeEventListener('mousedown', handlePointer)
  }, [open])

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])
  }

  const cheio = value.length >= max

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-controls="feedback-category-list"
        aria-label="Categorias do feedback"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-[42px] w-full items-center justify-between gap-sm rounded-md border border-outline-variant/60 bg-surface-container-highest px-sm py-1.5 text-left transition-colors hover:border-primary"
      >
        {selected.length === 0 ? (
          <span className="text-body-sm text-on-surface-variant">Selecione as categorias…</span>
        ) : (
          <span className="flex flex-wrap gap-xs">
            {selected.map((category) => (
              <span
                key={category.id}
                className="flex items-center gap-xs rounded-full bg-primary/10 px-sm py-0.5 font-label text-label-sm text-primary"
              >
                <span aria-hidden className={`h-2 w-2 rounded-full ${categoryDotClass(category.name)}`} />
                {category.name}
              </span>
            ))}
          </span>
        )}
        <Icon name="unfold_more" className="shrink-0 text-[18px] text-on-surface-variant" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-xs w-full overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container shadow-lg">
          <label className="group relative block border-b border-outline-variant/40">
            <span className="sr-only">Buscar categoria</span>
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-on-surface-variant transition-colors group-focus-within:text-primary">
              <Icon name="search" className="text-[18px]" />
            </span>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setOpen(false)
              }}
              placeholder="Buscar categoria…"
              className="w-full bg-transparent py-2 pl-10 pr-4 text-body-sm text-on-surface outline-none placeholder:text-on-surface-variant"
            />
          </label>

          <ul id="feedback-category-list" role="listbox" aria-multiselectable className="max-h-64 overflow-y-auto py-1">
            {loading ? (
              <li className="px-md py-sm text-body-sm text-on-surface-variant">Carregando categorias…</li>
            ) : results.length === 0 ? (
              <li className="px-md py-sm text-body-sm text-on-surface-variant">
                {categories.length === 0 ? 'Nenhuma categoria cadastrada.' : 'Nenhuma categoria encontrada.'}
              </li>
            ) : (
              results.map((category) => {
                const active = value.includes(category.id)
                return (
                  <li key={category.id} role="option" aria-selected={active}>
                    <button
                      type="button"
                      disabled={!active && cheio}
                      onClick={() => toggle(category.id)}
                      className={`flex w-full items-center gap-sm px-md py-sm text-left text-body-sm transition-colors disabled:opacity-40 ${
                        active
                          ? 'bg-primary/10 text-primary'
                          : 'text-on-surface hover:bg-surface-container-highest disabled:hover:bg-transparent'
                      }`}
                    >
                      <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${categoryDotClass(category.name)}`} />
                      <span className="flex-grow">{category.name}</span>
                      {active && <Icon name="check" className="shrink-0 text-[18px]" />}
                    </button>
                  </li>
                )
              })
            )}
          </ul>

          {cheio && (
            <p className="border-t border-outline-variant/40 px-md py-sm text-label-sm text-on-surface-variant">
              Máximo de {max} categorias por feedback.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

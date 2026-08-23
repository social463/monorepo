import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'

export interface SelectMenuOption {
  value: string
  label: string
  /** Enfeite à esquerda do rótulo (ex.: o ponto colorido de uma competência). */
  adornment?: ReactNode
}

/** A partir de quantas opções a caixa ganha campo de busca. */
const SEARCH_THRESHOLD = 8

/**
 * Seleção única no visual do app.
 *
 * O `<select>` nativo não aceita estilo no painel de opções: o menu vem do
 * sistema operacional, com fundo claro e destaque azul do Windows/macOS mesmo
 * num app em tema escuro. Aqui o painel é do app — as mesmas bordas, superfícies
 * e cor de marca dos outros campos —, e ganha busca sozinho quando a lista passa
 * de {@link SEARCH_THRESHOLD} opções.
 */
export function SelectMenu({
  value,
  onChange,
  options,
  label,
  placeholder = 'Selecione…',
  searchPlaceholder = 'Buscar…',
  className = '',
}: {
  value: string
  onChange: (value: string) => void
  options: SelectMenuOption[]
  /** Nome acessível do campo — vira o `aria-label` do gatilho. */
  label: string
  placeholder?: string
  searchPlaceholder?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  const selected = options.find((o) => o.value === value)
  const searchable = options.length > SEARCH_THRESHOLD
  const results = useMemo(() => {
    const term = query.trim().toLowerCase()
    return term ? options.filter((o) => o.label.toLowerCase().includes(term)) : options
  }, [options, query])

  useEffect(() => {
    if (!open) return
    function handlePointer(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handlePointer)
    return () => document.removeEventListener('mousedown', handlePointer)
  }, [open])

  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-sm rounded-md border border-outline-variant/60 bg-surface-container-highest px-sm py-2 text-left transition-colors hover:border-primary"
      >
        <span className={`truncate text-body-sm ${selected ? 'text-on-surface' : 'text-on-surface-variant'}`}>
          {selected ? (
            <span className="flex items-center gap-xs">
              {selected.adornment}
              {selected.label}
            </span>
          ) : (
            placeholder
          )}
        </span>
        <Icon name="unfold_more" className="shrink-0 text-[18px] text-on-surface-variant" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-xs min-w-full overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container shadow-lg">
          {searchable && (
            <label className="group relative block border-b border-outline-variant/40">
              <span className="sr-only">{searchPlaceholder}</span>
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
                placeholder={searchPlaceholder}
                className="w-full bg-transparent py-2 pl-10 pr-4 text-body-sm text-on-surface outline-none placeholder:text-on-surface-variant"
              />
            </label>
          )}
          <ul role="listbox" aria-label={label} className="max-h-64 overflow-y-auto py-1">
            {results.length === 0 ? (
              <li className="px-md py-sm text-body-sm text-on-surface-variant">Nada encontrado.</li>
            ) : (
              results.map((option) => {
                const active = option.value === value
                return (
                  <li key={option.value} role="option" aria-selected={active}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(option.value)
                        setOpen(false)
                      }}
                      className={`flex w-full items-center gap-sm whitespace-nowrap px-md py-sm text-left text-body-sm transition-colors ${
                        active ? 'bg-primary/10 text-primary' : 'text-on-surface hover:bg-surface-container-highest'
                      }`}
                    >
                      {option.adornment}
                      <span className="flex-grow">{option.label}</span>
                      {active && <Icon name="check" className="shrink-0 text-[18px]" />}
                    </button>
                  </li>
                )
              })
            )}
          </ul>
        </div>
      )}
    </div>
  )
}

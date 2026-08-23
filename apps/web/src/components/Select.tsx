import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from './Icon'
import { foldText } from '../lib/text'

export type SelectOption = { value: string; label: string }

interface SelectProps {
  options: SelectOption[]
  value: string
  onChange: (value: string) => void
  ariaLabel: string
  placeholder?: string
  searchable?: boolean
  disabled?: boolean
  className?: string
}

const triggerCls =
  'flex w-full items-center justify-between gap-sm rounded-md border border-outline-variant/60 bg-surface-container-highest px-3 py-2 text-body-sm outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/30 disabled:opacity-50'

export function Select({
  options,
  value,
  onChange,
  ariaLabel,
  placeholder = 'Selecione…',
  searchable,
  disabled,
  className = '',
}: SelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const canSearch = searchable ?? options.length > 6
  const selected = options.find((o) => o.value === value) ?? null

  const filtered = useMemo(() => {
    if (!canSearch || !query.trim()) return options
    // Dobrado: "reuniao" acha "Reunião" e "SAO" acha "São".
    const q = foldText(query.trim())
    return options.filter((o) => foldText(o.label).includes(q))
  }, [options, query, canSearch])

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  useEffect(() => {
    if (!open) {
      setQuery('')
      return
    }
    const idx = options.findIndex((o) => o.value === value)
    setHighlight(idx >= 0 ? idx : 0)
    if (canSearch) searchRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function choose(option: SelectOption) {
    onChange(option.value)
    setOpen(false)
  }

  function onKeyDown(event: KeyboardEvent) {
    if (disabled) return
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        setOpen(true)
      }
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlight((h) => Math.min(h + 1, filtered.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const opt = filtered[highlight]
      if (opt) choose(opt)
    } else if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  const activeId = filtered[highlight] ? `${listId}-opt-${highlight}` : undefined

  return (
    <div ref={wrapperRef} className={`relative ${className}`} onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={ariaLabel}
        aria-activedescendant={open ? activeId : undefined}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={triggerCls}
      >
        <span className={selected ? 'text-on-surface' : 'text-on-surface-variant'}>
          {selected ? selected.label : placeholder}
        </span>
        <Icon
          name="expand_more"
          className={`text-[20px] text-on-surface-variant transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-md border border-outline-variant/60 bg-surface-container-high shadow-lg">
          {canSearch && (
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setHighlight(0)
              }}
              aria-label={`Buscar em ${ariaLabel}`}
              placeholder="Buscar…"
              className="w-full border-b border-outline-variant/40 bg-transparent px-3 py-2 text-body-sm text-on-surface outline-none placeholder:text-on-surface-variant"
            />
          )}
          <ul role="listbox" id={listId} className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-body-sm text-on-surface-variant">Nenhum resultado</li>
            ) : (
              filtered.map((option, index) => {
                const isSelected = option.value === value
                const isHighlighted = index === highlight
                return (
                  <li
                    key={option.value}
                    id={`${listId}-opt-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => choose(option)}
                    ref={
                      isHighlighted
                        ? (el) => {
                            el?.scrollIntoView?.({ block: 'nearest' })
                          }
                        : undefined
                    }
                    className={`flex cursor-pointer items-center gap-sm px-3 py-2 text-body-sm ${
                      isHighlighted ? 'bg-primary/10 text-primary' : 'text-on-surface'
                    }`}
                  >
                    <Icon name="check" className={`text-[16px] ${isSelected ? 'opacity-100' : 'opacity-0'}`} />
                    {option.label}
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

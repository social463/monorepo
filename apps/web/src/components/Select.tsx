import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Icon } from './Icon'
import { foldText } from '../lib/text'

/**
 * `disabled` marca a opção que existe mas não pode ser escolhida AGORA — o
 * atalho "Hoje" na aba Clima, cujo recorte a API recusa. Some do teclado e do
 * clique, mas continua visível: escondê-la faria a opção sumir sem explicação
 * de uma aba para a outra.
 */
export type SelectOption = { value: string; label: string; disabled?: boolean }

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

/**
 * Próximo índice navegável a partir de `from`, na direção `step`. Pular a opção
 * desabilitada no teclado é o que impede o cursor de encalhar nela — parar em
 * cima de algo que o Enter ignora parece travamento.
 */
function nextEnabled(options: SelectOption[], from: number, step: number): number {
  for (let i = from + step; i >= 0 && i < options.length; i += step) {
    if (!options[i]?.disabled) return i
  }
  return from
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
  // Painel ancorado à direita do gatilho quando abrir à esquerda estouraria a
  // janela. Medido, e não decidido por classe fixa: o mesmo Select aparece no
  // canto direito do cabeçalho (Período/Setor) e no meio de formulários.
  const [alignRight, setAlignRight] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
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

  // O painel cresce até caber a opção mais longa, então pode passar da borda da
  // janela — aí ele vira para a esquerda. Antes da pintura (`useLayoutEffect`)
  // para o usuário não ver o salto, e sempre a partir do alinhamento à esquerda,
  // senão a medição do quadro seguinte leria a posição já corrigida e ficaria
  // presa nela.
  useLayoutEffect(() => {
    if (!open) {
      setAlignRight(false)
      return
    }
    const panel = panelRef.current
    if (!panel) return
    const rect = panel.getBoundingClientRect()
    if (rect.right > window.innerWidth - 8) setAlignRight(true)
  }, [open])

  function choose(option: SelectOption) {
    if (option.disabled) return
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
      setHighlight((h) => nextEnabled(filtered, h, 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((h) => nextEnabled(filtered, h, -1))
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
        <div
          ref={panelRef}
          // `min-w-full w-max`: nunca mais estreito que o gatilho, e largo o
          // bastante para a opção inteira. Preso à largura do gatilho, "Últimos
          // 7 dias" quebrava em duas linhas e ainda ficava atrás da barra de
          // rolagem. O teto (`max-w-xs`, 20rem) evita que um setor de nome longo
          // vire um painel do tamanho da tela; quem cuida da borda da janela é o
          // `alignRight`.
          className={`absolute top-full z-20 mt-1 w-max min-w-full max-w-xs overflow-hidden rounded-md border border-outline-variant/60 bg-surface-container-high shadow-lg ${
            alignRight ? 'right-0' : 'left-0'
          }`}
        >
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
          {/* `overflow-x-hidden` explícito: com overflow-y em `auto` e o eixo x
              em `visible`, o CSS promove o x para `auto` — era daí que vinha a
              barra de rolagem horizontal no rodapé do painel. */}
          <ul role="listbox" id={listId} className="max-h-64 overflow-y-auto overflow-x-hidden py-1">
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
                    aria-disabled={option.disabled || undefined}
                    onMouseEnter={() => !option.disabled && setHighlight(index)}
                    onClick={() => choose(option)}
                    ref={
                      isHighlighted
                        ? (el) => {
                            el?.scrollIntoView?.({ block: 'nearest' })
                          }
                        : undefined
                    }
                    className={`flex items-center gap-sm px-3 py-2 text-body-sm ${
                      option.disabled
                        // Token mais apagado, não opacidade: alfa em cor de
                        // texto reprova contraste no tema claro (brand-alpha).
                        ? 'cursor-not-allowed text-outline'
                        : `cursor-pointer ${isHighlighted ? 'bg-primary/10 text-primary' : 'text-on-surface'}`
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

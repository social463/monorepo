import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../../../../components/Icon'
import { GUIA_SEARCH_EXAMPLES, GUIA_SEARCH_KIND_LABEL, searchGuia } from '../content/search'
import { cx } from '../lib/cx'

/**
 * Busca global do guia (Cmd/Ctrl+K ou o botão "Buscar" do cabeçalho): situações,
 * prompts, vídeos, FAQs e seções num lugar só.
 *
 * O campo é um combobox e o cursor é `aria-activedescendant`: o foco fica no
 * input o tempo todo, e as setas só mudam qual resultado está ativo — tirar o
 * foco do campo obrigaria a clicar de volta para refinar a busca.
 */
export function GuiaGlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const listId = useId()
  const results = useMemo(() => searchGuia(query), [query])
  const showExamples = query.trim().length < 2

  // Cada abertura começa do zero, com o foco no campo; ao fechar, o foco volta
  // para quem abriu (botão ou o elemento onde estava o atalho).
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    setQuery('')
    setCursor(0)
    inputRef.current?.focus()
    return () => previous?.focus?.()
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  function go(href: string) {
    onClose()
    navigate(href)
  }

  const activeId = !showExamples && results[cursor] ? `${listId}-${cursor}` : undefined

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-md pt-[12vh]"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Busca global do guia"
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-outline-variant/40 bg-surface shadow-xl"
      >
        <div className="flex items-center gap-sm border-b border-outline-variant/40 px-lg py-md">
          <Icon name="search" className="text-[22px] text-on-surface-variant" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded={!showExamples && results.length > 0}
            aria-controls={listId}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-label="Buscar situações, prompts, vídeos e FAQ"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setCursor(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setCursor((c) => Math.min(c + 1, results.length - 1))
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setCursor((c) => Math.max(c - 1, 0))
              }
              if (event.key === 'Enter' && results[cursor]) {
                event.preventDefault()
                go(results[cursor].href)
              }
            }}
            placeholder="Busque: feedback, planilha, reunião, promoção, dados, apresentação…"
            className="min-w-0 flex-1 bg-transparent text-body-lg text-on-surface outline-none placeholder:text-on-surface-variant"
          />
          <button
            type="button"
            aria-label="Fechar busca"
            onClick={onClose}
            className="rounded-full p-xs text-on-surface-variant hover:text-on-surface"
          >
            <Icon name="close" className="text-[20px]" />
          </button>
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-sm">
          {showExamples ? (
            <div className="p-md">
              <p className="font-label text-label-sm font-bold uppercase tracking-wide text-on-surface-variant">Exemplos</p>
              <div className="mt-sm flex flex-wrap gap-xs">
                {GUIA_SEARCH_EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => {
                      setQuery(example)
                      setCursor(0)
                      inputRef.current?.focus()
                    }}
                    className="rounded-full border border-outline-variant/60 px-md py-xs text-body-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          ) : results.length === 0 ? (
            <p className="p-lg text-body-md text-on-surface-variant">
              Nada encontrado por aqui. Tente descrever a situação com suas palavras, ou abra a Bússola e responda três
              perguntas rápidas.
            </p>
          ) : (
            <ul id={listId} role="listbox" aria-label="Resultados">
              {results.map((doc, i) => (
                <li
                  key={`${doc.kind}-${doc.id}`}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === cursor}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => go(doc.href)}
                  className={cx(
                    'flex cursor-pointer items-start gap-sm rounded-xl px-md py-sm transition-colors',
                    i === cursor ? 'bg-primary/10' : 'hover:bg-surface-container',
                  )}
                >
                  <span className="mt-0.5 shrink-0 rounded-full border border-outline-variant/60 bg-surface px-sm py-0.5 font-label text-[11px] font-bold text-on-surface-variant">
                    {GUIA_SEARCH_KIND_LABEL[doc.kind]}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-label text-label-md font-bold text-on-surface">{doc.title}</span>
                    <span className="line-clamp-1 block text-body-sm text-on-surface-variant">{doc.subtitle}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { get as getEmoji, search as searchEmoji } from 'node-emoji'
import type { PublicUser } from '@legends/shared'
import { Avatar } from './Avatar'

const MAX_OPTIONS = 6

/** Detecta um "@query" ativo imediatamente antes do cursor (sem espaço no meio). */
function activeMention(text: string, caret: number): { query: string; start: number } | null {
  const upto = text.slice(0, caret)
  const match = /(?:^|\s)@([^\s@]*)$/.exec(upto)
  if (!match) return null
  const query = match[1]
  return { query, start: caret - query.length - 1 }
}

/** Detecta um ":query" de emoji em digitação (sem o ":" final ainda) antes do cursor. */
function activeEmoji(text: string, caret: number): { query: string; start: number } | null {
  const upto = text.slice(0, caret)
  const match = /(?:^|\s):([a-zA-Z0-9_+-]+)$/.exec(upto)
  if (!match) return null
  const query = match[1]
  return { query, start: caret - query.length - 1 }
}

/** Detecta um ":shortcode:" completo (com os dois ":") terminando no cursor. */
function completedEmoji(text: string, caret: number): { name: string; start: number } | null {
  const upto = text.slice(0, caret)
  const match = /(?:^|\s):([a-zA-Z0-9_+-]+):$/.exec(upto)
  if (!match) return null
  return { name: match[1], start: caret - match[1].length - 2 }
}

type EmojiOption = { emoji: string; name: string }

/** Ordena os resultados do search por relevância do shortcode: exato → prefixo → contém. */
function rankEmoji(results: EmojiOption[], query: string): EmojiOption[] {
  const q = query.toLowerCase()
  const score = (name: string) => (name === q ? 0 : name.startsWith(q) ? 1 : 2)
  return [...results].sort((a, b) => score(a.name) - score(b.name) || a.name.length - b.name.length)
}

type Trigger =
  | { kind: 'mention'; q: string; start: number }
  | { kind: 'emoji'; q: string; start: number }

export function MentionTextarea({
  value,
  onChange,
  onMentionsChange,
  colleagues,
  placeholder,
  ariaLabel,
  className,
  rows = 2,
  onEnterSubmit,
}: {
  value: string
  onChange: (v: string) => void
  onMentionsChange: (ids: string[]) => void
  colleagues: PublicUser[]
  placeholder?: string
  ariaLabel: string
  className?: string
  rows?: number
  onEnterSubmit?: () => void
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  // nome escolhido -> userId; usado para recomputar quais menções seguem no texto.
  const pickedRef = useRef<Map<string, string>>(new Map())
  const [trigger, setTrigger] = useState<Trigger | null>(null)
  const [caretToSet, setCaretToSet] = useState<number | null>(null)
  const [highlightedIndex, setHighlightedIndex] = useState(0)

  // Reposiciona o cursor após inserir uma menção ou emoji.
  useEffect(() => {
    if (caretToSet != null && ref.current) {
      ref.current.focus()
      ref.current.setSelectionRange(caretToSet, caretToSet)
      setCaretToSet(null)
    }
  }, [caretToSet])

  const mentionOptions =
    trigger?.kind === 'mention'
      ? colleagues
          .filter((c) => c.name.toLowerCase().includes(trigger.q.toLowerCase()))
          .slice(0, MAX_OPTIONS)
      : []
  const emojiOptions: EmojiOption[] =
    trigger?.kind === 'emoji'
      ? rankEmoji(searchEmoji(trigger.q.toLowerCase()), trigger.q).slice(0, MAX_OPTIONS)
      : []
  const optionCount = trigger?.kind === 'emoji' ? emojiOptions.length : mentionOptions.length

  // Reseta o índice destacado sempre que a lista de opções muda.
  useEffect(() => {
    setHighlightedIndex(0)
  }, [optionCount, trigger?.q, trigger?.kind])

  /** Reporta os ids cujo "@nome" ainda aparece no texto. */
  function reportMentions(text: string) {
    const ids: string[] = []
    for (const [name, id] of pickedRef.current) {
      if (text.includes(`@${name}`)) ids.push(id)
    }
    onMentionsChange([...new Set(ids)])
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const text = e.target.value
    const caret = e.target.selectionStart ?? text.length

    // 1) Auto-replace de ":shortcode:" completo por um emoji conhecido.
    const done = completedEmoji(text, caret)
    if (done) {
      const emoji = getEmoji(done.name.toLowerCase())
      if (emoji) {
        const before = text.slice(0, done.start)
        const after = text.slice(caret)
        const next = before + emoji + after
        onChange(next)
        setTrigger(null)
        setCaretToSet((before + emoji).length)
        reportMentions(next)
        return
      }
    }

    onChange(text)

    // 2) Dropdowns: menção (@) tem prioridade; depois emoji (:).
    const mention = activeMention(text, caret)
    if (mention) {
      setTrigger({ kind: 'mention', q: mention.query, start: mention.start })
      reportMentions(text)
      return
    }
    const emoji = activeEmoji(text, caret)
    setTrigger(emoji ? { kind: 'emoji', q: emoji.query, start: emoji.start } : null)
    reportMentions(text)
  }

  function selectMention(user: PublicUser) {
    const el = ref.current
    if (!el || trigger?.kind !== 'mention') return
    const caret = el.selectionStart ?? value.length
    const before = value.slice(0, trigger.start)
    const after = value.slice(caret)
    const insert = `@${user.name} `
    const next = before + insert + after
    pickedRef.current.set(user.name, user.id)
    onChange(next)
    setTrigger(null)
    setCaretToSet((before + insert).length)
    reportMentions(next)
  }

  function selectEmoji(opt: EmojiOption) {
    const el = ref.current
    if (!el || trigger?.kind !== 'emoji') return
    const caret = el.selectionStart ?? value.length
    const before = value.slice(0, trigger.start)
    const after = value.slice(caret)
    const next = before + opt.emoji + after
    onChange(next)
    setTrigger(null)
    setCaretToSet((before + opt.emoji).length)
  }

  function selectHighlighted() {
    if (trigger?.kind === 'emoji') selectEmoji(emojiOptions[highlightedIndex])
    else selectMention(mentionOptions[highlightedIndex])
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (optionCount > 0) {
      // Dropdown está aberto — navegação por teclado.
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHighlightedIndex((i) => (i + 1) % optionCount)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHighlightedIndex((i) => (i - 1 + optionCount) % optionCount)
        return
      }
      // Enter ou Tab selecionam a opção destacada e mantêm o foco para continuar digitando.
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        selectHighlighted()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setTrigger(null)
        return
      }
    } else if (e.key === 'Enter' && !e.shiftKey && onEnterSubmit) {
      // Dropdown fechado + Enter sem Shift: delega ao composer do comentário.
      e.preventDefault()
      onEnterSubmit()
    }
  }

  return (
    <div className="relative">
      <textarea
        ref={ref}
        className={className}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => setTimeout(() => setTrigger(null), 120)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        rows={rows}
      />
      {trigger?.kind === 'mention' && mentionOptions.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-60 w-72 overflow-auto rounded-lg border border-outline-variant/40 bg-surface-container shadow-lg">
          {mentionOptions.map((c, index) => (
            <li key={c.id}>
              <button
                type="button"
                // mouseDown (não click) para disparar antes do blur do textarea.
                onMouseDown={(e) => {
                  e.preventDefault()
                  selectMention(c)
                }}
                className={`flex w-full items-center gap-sm px-sm py-2 text-left hover:bg-surface-container-high${index === highlightedIndex ? ' bg-surface-container-high' : ''}`}
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full border border-outline-variant/60">
                  <Avatar user={c} />
                </span>
                <span className="truncate font-label text-label-sm text-on-surface">{c.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {trigger?.kind === 'emoji' && emojiOptions.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-60 w-72 overflow-auto rounded-lg border border-outline-variant/40 bg-surface-container shadow-lg">
          {emojiOptions.map((opt, index) => (
            <li key={opt.name}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  selectEmoji(opt)
                }}
                className={`flex w-full items-center gap-sm px-sm py-2 text-left hover:bg-surface-container-high${index === highlightedIndex ? ' bg-surface-container-high' : ''}`}
              >
                <span className="w-6 shrink-0 text-center text-[18px] leading-none">{opt.emoji}</span>
                <span className="truncate font-label text-label-sm text-on-surface-variant">:{opt.name}:</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

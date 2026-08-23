import { useLayoutEffect, useRef, useState } from 'react'
import { type ReactionSummary } from '@legends/shared'
import { Icon } from '../../components/Icon'

// Largura aproximada do popover (w-[13rem]) usada para decidir o lado de abertura.
const PICKER_WIDTH = 208

/**
 * Barra de reações reutilizada por feedback e resenha. O conjunto de emojis do
 * picker vem de `options` (FEEDBACK_REACTIONS ou REVIEW_REACTIONS), o que também
 * fixa o tipo do emoji devolvido por `onToggle`.
 */
export function FeedbackReactions<E extends string>({
  reactions,
  options,
  onToggle,
}: {
  reactions: ReactionSummary[]
  options: readonly E[]
  onToggle: (emoji: E) => void
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // Por padrão abre para a direita (left-0); se não couber, alinha à direita do botão.
  const [alignRight, setAlignRight] = useState(false)

  // Ao abrir, mede o espaço à direita do botão e decide o lado para não estourar a tela.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    setAlignRight(rect.left + PICKER_WIDTH > window.innerWidth - 8)
  }, [open])

  return (
    <div className="flex flex-wrap items-center gap-xs">
      {reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          onClick={() => onToggle(r.emoji as E)}
          className={`group relative flex items-center gap-xs rounded-full border px-sm py-0.5 font-label text-label-sm transition-colors ${
            r.reactedByMe
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-outline-variant/60 text-on-surface-variant hover:border-primary'
          }`}
        >
          <span className="text-[14px] leading-none">{r.emoji}</span>
          <span>{r.count}</span>
          {/* Tooltip custom com os nomes (substitui o title nativo). */}
          <span
            role="tooltip"
            className="pointer-events-none invisible absolute bottom-full left-1/2 z-30 mb-1.5 w-max max-w-[14rem] -translate-x-1/2 whitespace-normal break-words rounded-md border border-outline-variant/40 bg-surface-container-highest px-2 py-1 text-left font-normal leading-snug text-on-surface opacity-0 shadow-lg transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus:visible group-focus:opacity-100"
          >
            <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-on-surface-variant">
              {r.emoji} {r.count === 1 ? 'reagiu' : 'reagiram'}
            </span>
            {r.users.map((u) => u.name).join(', ')}
          </span>
        </button>
      ))}

      <div className="relative">
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Adicionar reação"
          aria-expanded={open}
          className="flex h-7 w-7 items-center justify-center rounded-full border border-outline-variant/60 text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
        >
          <Icon name="add_reaction" className="text-[16px]" />
        </button>
        {open && (
          <>
            {/* Backdrop invisível para fechar ao clicar fora. */}
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
            <div
              className={`absolute bottom-full z-20 mb-xs grid w-[13rem] grid-cols-6 gap-xs rounded-lg border border-outline-variant/40 bg-surface-container p-sm shadow-lg ${
                alignRight ? 'right-0' : 'left-0'
              }`}
            >
              {options.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    onToggle(emoji)
                    setOpen(false)
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-md text-[18px] transition-colors hover:bg-surface-container-highest"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

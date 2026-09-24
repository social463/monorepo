import { useLayoutEffect, useRef, useState } from 'react'
import { type ReactionSummary } from '@legends/shared'
import { Icon } from '../../components/Icon'

// Largura aproximada do popover (w-[13rem]) usada para decidir o lado de abertura.
const PICKER_WIDTH = 208
// Teto do tooltip de nomes (max-w-[14rem]); mesma ideia do PICKER_WIDTH.
const TOOLTIP_WIDTH = 224
// Folga da borda da janela, para o tooltip não encostar no vidro.
const EDGE_MARGIN = 8

type TooltipAlign = 'center' | 'left' | 'right'

const TOOLTIP_ALIGN_CLS: Record<TooltipAlign, string> = {
  center: 'left-1/2 -translate-x-1/2',
  left: 'left-0',
  right: 'right-0',
}

/**
 * Uma pílula de reação, com o tooltip dos nomes.
 *
 * O tooltip nasce centrado na pílula, e era só isso — numa reação perto da
 * borda da janela ele saía da tela e os nomes apareciam cortados ao meio. Agora
 * ele mede antes de aparecer e encosta na ponta que couber, que é o mesmo
 * tratamento que o picker de emoji ao lado já tinha.
 *
 * A medição é no `mouseenter`/`focus`, e não no render: a posição da pílula
 * depende da largura da janela e de quantas reações vieram antes dela, e as
 * duas coisas mudam sem o componente re-renderizar.
 */
function ReactionPill<E extends string>({
  reaction,
  onToggle,
}: {
  reaction: ReactionSummary
  onToggle: (emoji: E) => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const [align, setAlign] = useState<TooltipAlign>('center')

  function medir() {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const meio = rect.left + rect.width / 2
    const metade = TOOLTIP_WIDTH / 2
    if (meio - metade < EDGE_MARGIN) setAlign('left')
    else if (meio + metade > window.innerWidth - EDGE_MARGIN) setAlign('right')
    else setAlign('center')
  }

  return (
    <button
      ref={ref}
      type="button"
      onClick={() => onToggle(reaction.emoji as E)}
      onMouseEnter={medir}
      onFocus={medir}
      className={`group relative flex items-center gap-xs rounded-full border px-sm py-0.5 font-label text-label-sm transition-colors ${
        reaction.reactedByMe
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-outline-variant/60 text-on-surface-variant hover:border-primary'
      }`}
    >
      <span className="text-[14px] leading-none">{reaction.emoji}</span>
      <span>{reaction.count}</span>
      {/* Tooltip custom com os nomes (substitui o title nativo). */}
      <span
        role="tooltip"
        className={`pointer-events-none invisible absolute bottom-full z-30 mb-1.5 w-max max-w-[14rem] whitespace-normal break-words rounded-md border border-outline-variant/40 bg-surface-container-highest px-2 py-1 text-left font-normal leading-snug text-on-surface opacity-0 shadow-lg transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus:visible group-focus:opacity-100 ${TOOLTIP_ALIGN_CLS[align]}`}
      >
        <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-on-surface-variant">
          {reaction.emoji} {reaction.count === 1 ? 'reagiu' : 'reagiram'}
        </span>
        {reaction.users.map((u) => u.name).join(', ')}
      </span>
    </button>
  )
}

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
        <ReactionPill key={r.emoji} reaction={r} onToggle={onToggle} />
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

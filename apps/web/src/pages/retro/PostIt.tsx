import { useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { POSTIT_WIDTH, POSTIT_WIDTH_WIDE, POSTIT_HEIGHT, SHAPE_HEIGHT, SHAPE_WIDTH, type RetroCardColor, type RetroCardDTO, type RetroShape } from '@legends/shared'
import { CARD_COLOR_CLASS } from './ColorPalette'
import { ShapeArt } from './ShapeArt'
import { Avatar } from '../../components/Avatar'

export interface ActionFormState {
  plan: string
  responsible: string
  dueDate: string
}

/** Textarea que cresce para baixo conforme o conteúdo. */
function AutoGrowTextarea({
  value,
  onChange,
  onBlur,
  placeholder,
  className,
}: {
  value: string
  onChange: (text: string) => void
  onBlur?: () => void
  placeholder?: string
  className?: string
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      value={value}
      rows={1}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      className={className}
    />
  )
}

export function PostIt({
  card,
  readOnly,
  interactive = !readOnly,
  lockedBy,
  selected,
  editing,
  editingText,
  onPointerDown,
  onResizePointerDown,
  onEditChange,
  onEndEdit,
  wide,
  regionColorClass,
  actionForm,
}: {
  card: RetroCardDTO
  /** Sem afordância de edição de texto/resize (não-autor ou sala fechada). */
  readOnly: boolean
  /** Permite iniciar arrasto/seleção/voto/reação no card. Padrão: `!readOnly`. */
  interactive?: boolean
  lockedBy: { byUserId: string; byName: string } | null
  selected: boolean
  editing: boolean
  editingText: string
  onPointerDown: (e: ReactPointerEvent) => void
  onResizePointerDown?: (e: ReactPointerEvent) => void
  onEditChange: (text: string) => void
  onEndEdit: () => void
  /** Card numa região de ação (ruim/começar/parar): renderiza mais largo. */
  wide?: boolean
  /** Cor padronizada pelo quadrante (sobrescreve a cor do card; só para notes). */
  regionColorClass?: string
  actionForm?: {
    value: ActionFormState
    users: { id: string; name: string }[]
    onChange: (next: ActionFormState) => void
    /** Persiste os campos (gera/atualiza o card de ação automaticamente). */
    onCommit: (value: ActionFormState) => void
  }
}) {
  const locked = lockedBy != null
  const colorClass = regionColorClass ?? CARD_COLOR_CLASS[card.color as RetroCardColor] ?? CARD_COLOR_CLASS.yellow
  const authorLabel = card.mine
    ? 'Você'
    : card.masked
      ? 'Anônimo'
      : card.author?.name ?? 'Anônimo'
  const reactions = card.reactions.filter((r) => r.count > 0)
  const isShape = card.kind === 'shape'
  const width = isShape ? card.width || SHAPE_WIDTH : POSTIT_WIDTH
  const height = isShape ? card.height || SHAPE_HEIGHT : POSTIT_HEIGHT

  if (isShape) {
    const shape = card.shape ?? 'rectangle'
    return (
      <div
        data-card
        data-selected={selected || undefined}
        aria-label={`Forma ${shape}`}
        className={`absolute flex items-center justify-center ${selected ? 'ring-2 ring-primary ring-offset-2' : ''} ${locked ? 'opacity-70 ring-2 ring-primary' : ''}`}
        style={{ left: card.x, top: card.y, width, height, touchAction: 'none' }}
        onPointerDown={(e) => {
          if (locked || !interactive) return
          onPointerDown(e)
        }}
      >
        {locked && (
          <span className="absolute -top-5 left-0 rounded bg-primary px-1.5 py-0.5 font-label text-[10px] text-on-primary">
            {lockedBy!.byName} movendo
          </span>
        )}
        <svg viewBox="0 0 160 104" className="h-full w-full">
          <ShapeArt shape={shape} color={card.color as RetroCardColor} solid={card.shapeStyle !== 'outline'} />
        </svg>
        {selected && card.mine && !readOnly && onResizePointerDown && (
          <button
            type="button"
            aria-label="Redimensionar forma"
            className="absolute -bottom-3 -right-3 flex h-6 w-6 items-center justify-center rounded-full"
            style={{ cursor: 'nwse-resize' }}
            onPointerDown={(e) => {
              e.stopPropagation()
              onResizePointerDown(e)
            }}
          >
            <span className="h-4 w-4 rounded-full border-2 border-white bg-primary shadow-md" />
          </button>
        )}
      </div>
    )
  }

  return (
    <div
      data-card
      data-selected={selected || undefined}
      className={`absolute flex flex-col rounded-lg border-2 p-2 shadow-md ${colorClass} ${
        selected ? 'ring-2 ring-primary ring-offset-1' : ''
      } ${locked ? 'opacity-70 ring-2 ring-primary' : ''}`}
      style={{ left: card.x, top: card.y, width: wide ? POSTIT_WIDTH_WIDE : POSTIT_WIDTH, minHeight: POSTIT_HEIGHT, touchAction: 'none' }}
      onPointerDown={(e) => {
        if (editing || locked || !interactive) return
        onPointerDown(e)
      }}
    >
      {locked && (
        <span className="absolute -top-5 left-0 rounded bg-primary px-1.5 py-0.5 font-label text-[10px] text-on-primary">
          {lockedBy!.byName} movendo
        </span>
      )}

      <span className="group absolute -top-2 -right-2">
        <span
          aria-label={authorLabel}
          className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-zinc-700 shadow ring-1 ring-white/60"
        >
          <Avatar user={card.author ?? { name: authorLabel }} initialsClassName="text-[10px] font-bold text-white" />
        </span>
        <span
          role="tooltip"
          className="pointer-events-none invisible absolute top-full right-0 z-30 mt-1.5 w-max max-w-[10rem] whitespace-normal break-words rounded-md border border-outline-variant/40 bg-surface-container-highest px-2 py-1 text-right text-[11px] font-normal leading-snug text-on-surface opacity-0 shadow-lg transition-opacity duration-150 group-hover:visible group-hover:opacity-100"
        >
          {authorLabel}
        </span>
      </span>

      {editing ? (
        <textarea
          autoFocus
          value={editingText}
          placeholder="Escreva seu ponto…"
          onChange={(e) => onEditChange(e.target.value)}
          onBlur={onEndEdit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onEndEdit()
            }
          }}
          className="flex-1 resize-none rounded bg-white/60 p-1 text-body-sm text-zinc-900 outline-none"
          rows={5}
        />
      ) : card.masked ? (
        <div className="flex-1 space-y-1.5 py-1" aria-label="conteúdo oculto">
          <span className="block h-2.5 w-5/6 rounded bg-zinc-400/50" />
          <span className="block h-2.5 w-2/3 rounded bg-zinc-400/50" />
          <span className="block h-2.5 w-3/4 rounded bg-zinc-400/50" />
        </div>
      ) : (
        <p className="flex-1 whitespace-pre-wrap break-words text-body-sm text-zinc-900">{card.text}</p>
      )}

      {(card.voteCount > 0 || reactions.length > 0) && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {card.voteCount > 0 && (
            <span className="rounded-full bg-white/70 px-1.5 text-[11px] font-bold text-zinc-800">★ {card.voteCount}</span>
          )}
          {reactions.map((r) => (
            <span key={r.emoji} className="rounded-full bg-white/60 px-1 text-[12px] text-zinc-800">{r.emoji} {r.count}</span>
          ))}
        </div>
      )}

      {card.editedBy && (
        <p className="mt-1 font-label text-[10px] text-zinc-500">
          editado por {card.editedBy.name}{card.editedAt ? ` em ${new Date(card.editedAt).toLocaleDateString('pt-BR')}` : ''}
        </p>
      )}

      {actionForm && (
        <div className="mt-2 space-y-1.5 rounded-md border border-zinc-700/15 bg-white/55 p-2" onPointerDown={(e) => e.stopPropagation()}>
          <p className="font-label text-[10px] font-bold uppercase tracking-wide text-zinc-700">Plano</p>
          <AutoGrowTextarea
            value={actionForm.value.plan}
            onChange={(plan) => actionForm.onChange({ ...actionForm.value, plan })}
            onBlur={() => actionForm.onCommit(actionForm.value)}
            placeholder="Plano"
            className="min-h-[28px] w-full resize-none overflow-hidden rounded border border-zinc-400/40 bg-white/75 px-2 py-1 text-[12px] leading-snug text-zinc-900 outline-none focus:border-primary"
          />
          <select
            value={actionForm.value.responsible}
            onChange={(e) => {
              const next = { ...actionForm.value, responsible: e.target.value }
              actionForm.onChange(next)
              actionForm.onCommit(next)
            }}
            className="h-7 w-full rounded border border-zinc-400/40 bg-white/75 px-2 text-[12px] text-zinc-900 outline-none focus:border-primary"
          >
            <option value="">Responsável…</option>
            {actionForm.users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
          <input
            type="date"
            value={actionForm.value.dueDate}
            onChange={(e) => {
              const next = { ...actionForm.value, dueDate: e.target.value }
              actionForm.onChange(next)
              actionForm.onCommit(next)
            }}
            className="h-7 w-full rounded border border-zinc-400/40 bg-white/75 px-2 text-[12px] text-zinc-900 outline-none focus:border-primary"
          />
        </div>
      )}
    </div>
  )
}

import { useState } from 'react'
import type { InovaActivityDTO } from '@legends/shared'
import { Icon } from '../Icon'

const VISIBLE_BY_DEFAULT = 8

/** Ícone e cor por tipo de mudança — tarefa, diário, fase ou o próprio projeto. */
function kindOf(item: InovaActivityDTO): { icon: string; className: string } {
  if (item.action === 'PHASE_CHANGED') return { icon: 'arrow_forward', className: 'bg-primary text-on-primary' }
  if (item.entity === 'InovaProjectTask') return { icon: 'checklist', className: 'bg-secondary-container text-on-secondary-container' }
  if (item.entity === 'InovaDiaryEntry') return { icon: 'menu_book', className: 'bg-tertiary-container text-on-tertiary-container' }
  return { icon: 'edit', className: 'bg-primary-container text-on-primary-container' }
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Histórico de alterações do projeto, como no INOVA original: linha do tempo
 * com ícone por tipo, quem fez e quando (com hora), as 8 mais recentes e o
 * resto atrás de "Ver todos".
 */
export function InovaActivityLog({ items }: { items: InovaActivityDTO[] }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? items : items.slice(0, VISIBLE_BY_DEFAULT)

  if (items.length === 0) {
    return (
      <p className="text-body-sm text-on-surface-variant">
        Nenhuma alteração registrada ainda. As próximas movimentações aparecem aqui automaticamente.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-sm">
      <ol className="relative flex flex-col gap-md pl-lg">
        <span aria-hidden className="absolute bottom-2 left-[11px] top-2 w-0.5 bg-outline-variant/60" />
        {visible.map((item) => {
          const kind = kindOf(item)
          return (
            <li key={item.id} className="relative">
              <span
                aria-hidden
                className={`absolute -left-lg top-0.5 flex h-[22px] w-[22px] items-center justify-center rounded-full ${kind.className}`}
              >
                <Icon name={kind.icon} className="text-[14px]" />
              </span>
              <p className="ml-xs text-body-sm text-on-surface">{item.summary}</p>
              <p className="ml-xs mt-0.5 flex flex-wrap items-center gap-x-md gap-y-0.5 text-[11px] text-on-surface-variant">
                <span className="inline-flex items-center gap-0.5">
                  <Icon name="person" className="text-[12px]" />
                  {item.actorName}
                </span>
                <span className="inline-flex items-center gap-0.5">
                  <Icon name="event" className="text-[12px]" />
                  {formatDateTime(item.createdAt)}
                </span>
              </p>
            </li>
          )
        })}
      </ol>
      {items.length > VISIBLE_BY_DEFAULT && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="w-fit text-body-sm text-primary hover:underline"
        >
          {expanded ? 'Mostrar menos' : `Ver todos (${items.length})`}
        </button>
      )}
    </div>
  )
}

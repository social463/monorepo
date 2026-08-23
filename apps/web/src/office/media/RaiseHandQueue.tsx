import { useEffect, useState } from 'react'
import type { OfficeOccupant } from '@legends/shared'
import { Icon } from '../../components/Icon'
import { Avatar } from '../../components/Avatar'

/**
 * Contador de mãos levantadas da sala atual, no topo da tela — clicar expande
 * a lista na ordem da fila. Não renderiza nada com a fila vazia (o pai ainda
 * pode condicionar por `inMeetingRoom` também, mas isto sozinho já é seguro).
 */
export function RaiseHandQueue({
  queue,
  occupants,
  raised,
}: {
  queue: string[]
  occupants: OfficeOccupant[]
  /** Se o PRÓPRIO usuário está com a mão levantada agora — abre a lista sozinha ao levantar. */
  raised: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  // Levantar a própria mão já abre a fila, sem precisar clicar no contador.
  useEffect(() => {
    if (raised) setExpanded(true)
  }, [raised])
  if (queue.length === 0) return null

  const people = queue
    .map((userId) => occupants.find((o) => o.userId === userId))
    .filter((o): o is OfficeOccupant => o !== undefined)

  return (
    <div className="absolute top-3 left-1/2 z-[60] -translate-x-1/2">
      <button
        type="button"
        aria-label={expanded ? 'Recolher fila de mãos levantadas' : 'Expandir fila de mãos levantadas'}
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="flex items-center gap-sm rounded-full border border-outline-variant/40 bg-surface-container/95 px-md py-sm shadow-lg backdrop-blur"
      >
        <Icon name="back_hand" className="text-[20px]" />
        <span className="font-label text-label-sm text-on-surface">{queue.length}</span>
      </button>
      {expanded && (
        <ul className="mt-xs w-56 overflow-hidden rounded-xl border border-outline-variant bg-surface-container py-xs shadow-2xl backdrop-blur">
          {people.map((person, index) => (
            <li key={person.userId} className="flex items-center gap-sm px-md py-xs text-on-surface">
              <span className="w-4 shrink-0 text-right font-label text-label-sm text-on-surface-variant">{index + 1}</span>
              <div className="flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-container-highest">
                <Avatar preferCharacter user={person} initialsClassName="font-label text-label-sm font-bold text-primary" />
              </div>
              <span className="truncate font-body text-body-sm">{person.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

import type { JSX } from 'react'
import type { PublicUser, RetroParticipantDTO } from '@legends/shared'

export function ParticipantsPanel({
  participants,
  invitable,
  busy,
  onAdd,
  onRemove,
  onClose,
}: {
  participants: RetroParticipantDTO[]
  invitable: PublicUser[]
  busy?: boolean
  onAdd: (userId: string) => void
  onRemove: (userId: string) => void
  onClose: () => void
}): JSX.Element {
  const row = 'flex items-center justify-between rounded px-2 py-1 text-body-sm text-on-surface'
  const iconBtn = 'flex h-6 w-6 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-highest disabled:opacity-40'
  return (
    <div className="absolute right-0 top-0 z-20 flex h-full w-72 flex-col border-l border-outline-variant/40 bg-surface-container shadow-xl">
      <div className="flex items-center justify-between border-b border-outline-variant/40 px-4 py-3">
        <h3 className="font-label text-title-sm font-bold text-on-surface">Participantes</h3>
        <button type="button" aria-label="Fechar" onClick={onClose} className={iconBtn}>✕</button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <p className="mb-1 font-label text-label-sm uppercase tracking-wide text-on-surface-variant">Na sala</p>
        <ul className="space-y-1">
          {participants.map((p) => (
            <li key={p.user.id} className={row}>
              <span>
                {p.user.name}
                {p.isCreator && <span className="ml-1 text-label-sm text-on-surface-variant">(criador)</span>}
              </span>
              {!p.isCreator && (
                <button type="button" aria-label={`Remover ${p.user.name}`} disabled={busy} onClick={() => onRemove(p.user.id)} className={iconBtn}>
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
        <p className="mb-1 mt-4 font-label text-label-sm uppercase tracking-wide text-on-surface-variant">Adicionar</p>
        <ul className="space-y-1">
          {invitable.map((u) => (
            <li key={u.id} className={row}>
              <span>{u.name}</span>
              <button type="button" aria-label={`Adicionar ${u.name}`} disabled={busy} onClick={() => onAdd(u.id)} className={iconBtn}>
                +
              </button>
            </li>
          ))}
          {invitable.length === 0 && <li className="px-2 py-1 text-body-sm text-on-surface-variant">Ninguém para adicionar.</li>}
        </ul>
      </div>
    </div>
  )
}

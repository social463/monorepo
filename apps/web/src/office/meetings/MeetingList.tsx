import type { OfficeMeetingDTO } from '@legends/shared'
import { MeetingExportActions } from './MeetingExportActions'
import { formatWhen } from './format'

/**
 * Agenda da sala. Cada linha carrega as ações de exportar (Google, .ics, link)
 * e, para o organizador, editar e cancelar.
 */
export function MeetingList({
  meetings,
  isLoading,
  youId,
  editingId,
  cancelPending,
  error,
  onEdit,
  onCancel,
}: {
  meetings: OfficeMeetingDTO[] | undefined
  isLoading: boolean
  youId: string
  editingId: string | null
  cancelPending: boolean
  error: string | null
  onEdit: (meeting: OfficeMeetingDTO) => void
  onCancel: (meeting: OfficeMeetingDTO) => void
}) {
  return (
    <section className="mb-lg" aria-label="Próximas nesta sala">
      <h3 className="mb-xs font-label text-label-md text-on-surface-variant">Próximas nesta sala</h3>
      {isLoading && <p className="text-body-sm text-on-surface-variant">Carregando…</p>}
      {meetings?.length === 0 && <p className="text-body-sm text-on-surface-variant">Nenhuma reunião marcada.</p>}
      {error && <p className="mb-xs text-body-sm text-error">{error}</p>}
      <ul className="space-y-xs">
        {meetings?.map((item) => {
          const yours = item.organizer.id === youId
          // Reunião alheia aparece na agenda da sala, mas o .ics dela é 403.
          const naReuniao = yours || item.participants.some((person) => person.id === youId)
          return (
            <li
              key={item.id}
              className="space-y-xs rounded-md bg-surface-container-highest/60 px-sm py-xs"
              aria-label={item.title}
            >
              <div className="flex items-start justify-between gap-sm">
                <div>
                  <p
                    className={`text-body-sm ${item.canceled ? 'text-on-surface-variant line-through' : 'text-on-surface'}`}
                  >
                    {item.title}
                  </p>
                  <p className="text-body-sm text-on-surface-variant">
                    {formatWhen(item.startsAt)} · {item.organizer.name}
                    {item.canceled && ' · cancelada'}
                  </p>
                </div>
                {yours && !item.canceled && (
                  <div className="flex shrink-0 items-center gap-sm">
                    <button
                      type="button"
                      onClick={() => onEdit(item)}
                      disabled={editingId === item.id}
                      className="font-label text-label-sm text-primary hover:underline disabled:opacity-45"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => onCancel(item)}
                      disabled={cancelPending}
                      className="font-label text-label-sm text-error hover:underline disabled:opacity-45"
                    >
                      Cancelar
                    </button>
                  </div>
                )}
              </div>
              <MeetingExportActions meeting={item} canDownloadIcs={naReuniao} />
            </li>
          )
        })}
      </ul>
    </section>
  )
}

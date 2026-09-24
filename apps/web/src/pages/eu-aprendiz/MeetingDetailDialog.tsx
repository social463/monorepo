import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import type { ApprenticeTrackMeetingDTO } from '@legends/shared'
import { Icon } from '../../components/Icon'

interface Props {
  meeting: ApprenticeTrackMeetingDTO
  /** Data já formatada, a mesma do card — o diálogo não reformata. */
  dateLabel: string
  onClose: () => void
}

/**
 * Resumo do encontro antes de entrar nele: tema, objetivos e entregável. Só
 * abre para encontro liberado — o bloqueado continua explicando a trava no
 * próprio card, como no protótipo.
 */
export function MeetingDetailDialog({ meeting, dateLabel, onClose }: Props) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const sectionLabel = 'font-label text-label-sm uppercase tracking-wide text-on-surface-variant'

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Encontro ${meeting.order} — ${meeting.title}`}
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-outline-variant/40 bg-surface-container p-lg shadow-xl"
      >
        <div className="flex items-start justify-between gap-md">
          <div className="min-w-0">
            <p className="font-label text-label-sm text-on-surface-variant">
              Encontro {meeting.order} · {dateLabel}
            </p>
            <h2 className="mt-xs font-headline text-headline-sm text-on-surface">{meeting.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-outline-variant/40 text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface"
          >
            <Icon name="close" className="text-[18px]" />
          </button>
        </div>

        {meeting.theme && (
          <>
            <p className={`mt-lg ${sectionLabel}`}>Tema</p>
            <p className="mt-xs font-body text-body-md text-on-surface">{meeting.theme}</p>
          </>
        )}

        {meeting.objectives.length > 0 && (
          <>
            <p className={`mt-lg ${sectionLabel}`}>Objetivos do encontro</p>
            <ul className="mt-xs list-disc space-y-xs pl-lg font-body text-body-md text-on-surface">
              {meeting.objectives.map((objective) => (
                <li key={objective}>{objective}</li>
              ))}
            </ul>
          </>
        )}

        {meeting.deliverable && (
          <>
            <p className={`mt-lg ${sectionLabel}`}>Entregável esperado</p>
            <p className="mt-xs font-body text-body-md text-on-surface">{meeting.deliverable}</p>
          </>
        )}

        <Link
          to={`/eu-aprendiz/encontro/${meeting.id}`}
          className="mt-xl block rounded-lg bg-primary px-lg py-md text-center font-label text-label-lg text-on-primary hover:bg-primary/90"
        >
          Abrir o encontro
        </Link>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { addedByLabel, calendarDurationLabel, type CalendarEventOccurrenceDTO } from '@legends/shared'
import { Icon } from '../../components/Icon'
import { periodLabel, timeLabel } from './calendar-events'
import { readableOn } from './EventBar'

/**
 * Detalhe do evento clicado: categoria, período, público-alvo e descrição —
 * exatamente o que a referência mostra. É o que substituiu o painel "Selecione
 * um dia": o dia inteiro já está desenhado na grade, e o que faltava era
 * abrir UM evento.
 */
export function CalendarEventDetails({
  event,
  canEdit,
  deleting,
  onEdit,
  onDelete,
  onClose,
}: {
  event: CalendarEventOccurrenceDTO
  canEdit: boolean
  deleting: boolean
  onEdit: () => void
  onDelete: () => void
  onClose: () => void
}) {
  useEffect(() => {
    const closeOnEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const duracao = calendarDurationLabel(event)
  // Excluir apaga o CADASTRO inteiro, não a ocorrência clicada — num evento que
  // se repete isso some com a série. Confirmação em dois passos, aqui dentro, em
  // vez de `window.confirm`: o modal nativo não é estilizável nem testável.
  const [confirmando, setConfirmando] = useState(false)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={event.title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-xl border border-outline-variant/40 bg-surface-container shadow-xl">
        <header className="flex items-start gap-sm p-lg pb-md">
          <span
            className="mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
            style={{ backgroundColor: event.color, color: readableOn(event.color) }}
          >
            <Icon name={event.typeIcon} className="text-[14px]" />
          </span>
          <h2 className="min-w-0 flex-1 font-headline text-title-lg text-on-surface">{event.title}</h2>
          <button
            type="button"
            aria-label="Fechar"
            onClick={onClose}
            className="rounded-md p-1 text-on-surface-variant transition-colors hover:text-on-surface"
          >
            <Icon name="close" className="text-[20px]" />
          </button>
        </header>

        <div className="flex flex-col gap-md px-lg pb-lg">
          <div className="flex flex-wrap gap-xs">
            {event.isInternalComm && (
              <span className="rounded-full bg-tertiary-container px-3 py-1 font-label text-label-sm text-on-tertiary-container">
                📌 Comunicação Interna
              </span>
            )}
            {/* Etiqueta primeiro, categoria depois: a etiqueta é o que a pessoa
                reconhece ("Simulado"); a categoria é o recorte que dá a cor e o
                filtro. Só a categoria vem pintada — duas cores brigando aqui
                fariam a etiqueta parecer um segundo filtro. */}
            {event.tag && event.tag !== event.typeName && (
              <span className="rounded-full border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface">
                {event.tag}
              </span>
            )}
            <span
              className="rounded-full px-3 py-1 font-label text-label-sm"
              style={{ backgroundColor: event.color, color: readableOn(event.color) }}
            >
              {event.typeName}
            </span>
          </div>

          <section className="rounded-lg border border-outline-variant/40 bg-surface-container-low p-md">
            <p className="flex items-center gap-xs font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
              <Icon name="calendar_month" className="text-[16px]" /> Período
            </p>
            <p className="mt-1 text-body-md text-on-surface">{periodLabel(event)}</p>
            <p className="mt-1 flex items-center gap-xs text-body-sm text-on-surface-variant">
              <Icon name="schedule" className="text-[16px]" />
              {timeLabel(event)}
              {duracao !== timeLabel(event) && <span>· {duracao}</span>}
            </p>
          </section>

          <section>
            <p className="flex items-center gap-xs font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
              <Icon name="group" className="text-[16px]" /> Público-alvo
            </p>
            <div className="mt-1 flex flex-wrap gap-xs">
              {/* Sem tag é a empresa inteira — dizer "Todos" é mais honesto do
                  que deixar a seção vazia, que se lê como "ninguém". */}
              {(event.audienceTags.length > 0 ? event.audienceTags : ['Todos']).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant"
                >
                  {tag}
                </span>
              ))}
            </div>
          </section>

          {event.description && (
            <section>
              <p className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">Descrição</p>
              <p className="mt-1 whitespace-pre-line text-body-md text-on-surface">{event.description}</p>
            </section>
          )}

          <p className="text-body-sm text-on-surface-variant">
            {addedByLabel(event.createdByName, event.createdAt)}
          </p>

          {canEdit && (
            <div className="flex flex-wrap gap-sm border-t border-outline-variant/30 pt-md">
              <button
                type="button"
                onClick={onEdit}
                className="inline-flex items-center gap-xs rounded-md border border-outline-variant/60 px-lg py-sm font-label text-label-md text-on-surface transition-colors hover:border-primary hover:text-primary"
              >
                <Icon name="edit" className="text-[16px]" /> Editar
              </button>
              {confirmando ? (
                <>
                  <button
                    type="button"
                    onClick={onDelete}
                    disabled={deleting}
                    className="inline-flex items-center gap-xs rounded-md bg-error px-lg py-sm font-label text-label-md font-bold text-on-error transition-opacity hover:opacity-90 disabled:opacity-50"
                  >
                    <Icon name="delete" className="text-[16px]" />
                    Confirmar exclusão
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmando(false)}
                    className="rounded-md px-lg py-sm font-label text-label-md text-on-surface-variant transition-colors hover:text-on-surface"
                  >
                    Cancelar
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmando(true)}
                  className="inline-flex items-center gap-xs rounded-md px-lg py-sm font-label text-label-md text-error transition-colors hover:bg-error-container"
                >
                  <Icon name="delete" className="text-[16px]" /> Excluir
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

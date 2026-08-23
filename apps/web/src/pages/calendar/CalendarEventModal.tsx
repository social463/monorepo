import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CalendarEventResponse, CalendarEventTypeDTO, UpsertCalendarEventRequest } from '@legends/shared'
import { apiFetch } from '../../lib/api'
import { errorMessage } from '../admin/shared'
import { Icon } from '../../components/Icon'
import {
  CalendarEventForm,
  EMPTY_CALENDAR_EVENT,
  calendarEventToForm,
  normalizeCalendarEvent,
  type SectorOption,
} from '../../components/CalendarEventForm'

/**
 * Cadastro e edição de evento a partir do próprio calendário. Existe porque
 * quem pode cadastrar não entra necessariamente no `/admin` (a liderança não
 * entra), e porque o protótipo pede o botão "Novo evento" na própria tela.
 *
 * Os setores vêm de `/sectors` (qualquer usuário autenticado), não de
 * `/admin/sectors`, que o líder não pode chamar.
 */
export function CalendarEventModal({
  eventId,
  types,
  initialDate,
  canMarkInternal,
  onClose,
}: {
  /** `null` cria; um id abre o cadastro existente para edição. */
  eventId: string | null
  types: CalendarEventTypeDTO[]
  initialDate: string
  canMarkInternal: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<UpsertCalendarEventRequest>({
    ...EMPTY_CALENDAR_EVENT,
    // O dia em foco já entra preenchido: quem clica "Novo evento" olhando um dia
    // quase sempre quer aquele dia.
    date: initialDate,
    typeId: types[0]?.id ?? '',
    color: types[0]?.color ?? '',
  })

  const sectors = useQuery({
    queryKey: ['sectors'],
    queryFn: () => apiFetch<{ sectors: SectorOption[] }>('/sectors'),
  })

  // A ocorrência desenhada na grade não carrega a REGRA que a gerou (recorrência,
  // setores, lembretes), então editar busca o cadastro inteiro.
  const existing = useQuery({
    queryKey: ['calendar-event', eventId],
    queryFn: () => apiFetch<CalendarEventResponse>(`/calendar/events/${eventId}`),
    enabled: eventId !== null,
    // Sem isto, um refetch (voltar o foco para a aba) reidrata o formulário e
    // apaga o que a pessoa acabou de digitar.
    staleTime: Infinity,
  })

  useEffect(() => {
    if (existing.data) setForm(calendarEventToForm(existing.data.event))
  }, [existing.data])

  // Esc fecha, igual aos demais modais do projeto (VacationDialog,
  // ScheduleMeetingModal) — o clique fora fica no overlay, mais abaixo.
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const saveMut = useMutation({
    mutationFn: (data: UpsertCalendarEventRequest) =>
      apiFetch(eventId ? `/calendar/events/${eventId}` : '/calendar/events', {
        method: eventId ? 'PATCH' : 'POST',
        body: JSON.stringify(normalizeCalendarEvent(data)),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['calendar-events'] })
      await qc.invalidateQueries({ queryKey: ['calendar-event'] })
      onClose()
    },
    onError: (err) => setError(errorMessage(err, 'Erro ao salvar o evento.')),
  })

  const carregando = eventId !== null && existing.isLoading

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={eventId ? 'Editar evento do calendário' : 'Novo evento no calendário'}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      {/* Formulário alto (datas, horário, público-alvo, repetição): rola dentro
          da caixa em vez de empurrar o overlay. */}
      <div className="max-h-full w-full max-w-2xl overflow-y-auto rounded-xl border border-outline-variant/40 bg-surface-container p-lg shadow-xl">
        <div className="mb-lg flex items-center justify-between gap-md">
          <h2 className="font-headline text-title-lg text-on-surface">{eventId ? 'Editar evento' : 'Novo evento'}</h2>
          <button
            type="button"
            aria-label="Fechar"
            onClick={onClose}
            className="rounded-md p-1 text-on-surface-variant transition-colors hover:text-on-surface"
          >
            <Icon name="close" className="text-[20px]" />
          </button>
        </div>

        {error && (
          <p role="alert" className="mb-md flex items-center gap-sm text-body-sm text-error">
            <Icon name="error" /> {error}
          </p>
        )}

        {carregando ? (
          <p className="text-body-sm text-on-surface-variant">Carregando o evento…</p>
        ) : types.length === 0 ? (
          <p className="text-body-sm text-on-surface-variant">
            Nenhuma categoria cadastrada ainda. Peça a um administrador para criar uma em Administração › Eventos do
            calendário.
          </p>
        ) : (
          <CalendarEventForm
            value={form}
            types={types}
            sectors={sectors.data?.sectors ?? []}
            pending={saveMut.isPending}
            canMarkInternal={canMarkInternal}
            onChange={setForm}
            onCancel={onClose}
            onSubmit={(values) => saveMut.mutate(values)}
          />
        )}
      </div>
    </div>
  )
}

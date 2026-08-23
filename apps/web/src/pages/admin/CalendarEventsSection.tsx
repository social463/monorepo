import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CALENDAR_RECURRENCE_LABELS,
  addedByLabel,
  canSeeInternalCalendarEvents,
  reminderOffsetLabel,
  type CalendarEventDTO,
  type CalendarEventListResponse,
  type UpsertCalendarEventRequest,
} from '@legends/shared'
import {
  CalendarEventForm,
  EMPTY_CALENDAR_EVENT,
  calendarEventToForm,
  normalizeCalendarEvent,
  type SectorOption,
} from '../../components/CalendarEventForm'
import { useAuth } from '../../auth/AuthContext'
import { apiFetch } from '../../lib/api'
import { Panel, errorMessage, inputCls } from './shared'
import { Icon } from '../../components/Icon'

const QUERY_KEY = ['calendar', 'managed-events']

function formatDate(ymd: string): string {
  const [y, m, d] = ymd.split('-')
  return `${d}/${m}/${y}`
}

/**
 * Resumo do público na listagem. Os dois recortes aparecem juntos porque valem
 * juntos: tags de público-alvo E setores. Nenhum dos dois é a empresa inteira.
 */
function audienceLabel(event: CalendarEventDTO): string {
  const partes = [...event.audienceTags, ...event.sectorNames]
  return partes.length === 0 ? 'Toda a empresa' : partes.join(', ')
}

/** "03/08/2026", ou "03/08/2026 → 07/08/2026" quando o evento ocupa vários dias. */
function periodLabel(event: CalendarEventDTO): string {
  return event.endDate ? `${formatDate(event.date)} → ${formatDate(event.endDate)}` : formatDate(event.date)
}

/** "às 14:00", "14:00–15:30" ou vazio (o evento é de dia todo). */
function timeLabel(event: CalendarEventDTO): string {
  if (!event.startTime) return ''
  return event.endTime ? ` ${event.startTime}–${event.endTime}` : ` às ${event.startTime}`
}

function reminderLabel(event: CalendarEventDTO): string {
  if (event.reminderDaysBefore.length === 0) return 'Sem lembrete'
  return event.reminderDaysBefore.map(reminderOffsetLabel).join(', ')
}

/**
 * Eventos de calendário da empresa: prova B2B, prazo, campanha, treinamento,
 * comunicado com data. Bloco de Desenvolvimento de Produto — a rota da API é
 * `produtoAdmin`, e o `AdminSectorFeatureOnly` no `App.tsx` espelha isso.
 */
export function CalendarEventsSection() {
  const { user } = useAuth()
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: QUERY_KEY })
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<UpsertCalendarEventRequest | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [newType, setNewType] = useState('')

  const data = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => apiFetch<CalendarEventListResponse>('/calendar/managed-events'),
  })
  const sectors = useQuery({
    queryKey: ['sectors'],
    queryFn: () => apiFetch<{ sectors: SectorOption[] }>('/sectors'),
  })

  const saveMut = useMutation({
    mutationFn: (vars: { id: string | null; data: UpsertCalendarEventRequest }) =>
      vars.id
        ? apiFetch(`/calendar/events/${vars.id}`, { method: 'PATCH', body: JSON.stringify(vars.data) })
        : apiFetch('/calendar/events', { method: 'POST', body: JSON.stringify(vars.data) }),
    onSuccess: () => {
      setForm(null)
      setEditingId(null)
      setError(null)
      invalidate()
    },
    onError: (err) => setError(errorMessage(err, 'Erro ao salvar o evento.')),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => apiFetch(`/calendar/events/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(),
    onError: (err) => setError(errorMessage(err, 'Erro ao excluir o evento.')),
  })

  const typeMut = useMutation({
    mutationFn: (name: string) =>
      apiFetch('/admin/calendar-event-types', { method: 'POST', body: JSON.stringify({ name }) }),
    onSuccess: () => {
      setNewType('')
      setError(null)
      invalidate()
    },
    onError: (err) => setError(errorMessage(err, 'Erro ao criar o tipo.')),
  })

  const deleteTypeMut = useMutation({
    mutationFn: (id: string) => apiFetch(`/admin/calendar-event-types/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidate(),
    onError: (err) => setError(errorMessage(err, 'Erro ao excluir o tipo.')),
  })

  const events = data.data?.events ?? []
  const types = data.data?.types ?? []

  function startCreate() {
    setEditingId(null)
    // A cor entra já preenchida pela categoria — é o que o formulário mostra, e
    // deixá-la vazia faria o seletor de cor abrir num valor que ninguém escolheu.
    setForm({ ...EMPTY_CALENDAR_EVENT, typeId: types[0]?.id ?? '', color: types[0]?.color ?? '' })
  }

  function startEdit(event: CalendarEventDTO) {
    setEditingId(event.id)
    setForm(calendarEventToForm(event))
  }

  function submit(values: UpsertCalendarEventRequest) {
    saveMut.mutate({ id: editingId, data: normalizeCalendarEvent(values) })
  }

  return (
    <div className="flex flex-col gap-lg">
      <Panel
        title="Eventos do calendário"
        action={
          <button
            type="button"
            onClick={startCreate}
            disabled={types.length === 0}
            className="inline-flex items-center gap-sm rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
          >
            <Icon name="add" className="text-[18px]" />
            Novo evento
          </button>
        }
      >
        {error && (
          <p role="alert" className="mb-md flex items-center gap-sm text-body-sm text-error">
            <Icon name="error" /> {error}
          </p>
        )}

        {types.length === 0 && (
          <p className="mb-md text-body-sm text-on-surface-variant">
            Cadastre um tipo antes de criar eventos — é o tipo que vira filtro no calendário.
          </p>
        )}

        {form && (
          <CalendarEventForm
            value={form}
            types={types}
            sectors={sectors.data?.sectors ?? []}
            pending={saveMut.isPending}
            canMarkInternal={canSeeInternalCalendarEvents(user?.role, user?.sectorFeatures ?? [], user?.adminAccess)}
            onChange={setForm}
            onCancel={() => {
              setForm(null)
              setEditingId(null)
            }}
            onSubmit={submit}
          />
        )}

        {data.isLoading ? (
          <p className="text-body-sm text-on-surface-variant">Carregando…</p>
        ) : events.length === 0 ? (
          <p className="text-body-sm text-on-surface-variant">Nenhum evento cadastrado ainda.</p>
        ) : (
          <ul className="flex flex-col gap-md">
            {events.map((event) => (
              <li
                key={event.id}
                className="rounded-lg border border-outline-variant/40 bg-surface-container-highest p-md"
              >
                <div className="flex flex-wrap items-start justify-between gap-md">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-sm font-label text-label-md text-on-surface">
                      <span style={{ color: event.color ?? event.type.color }} className="inline-flex">
                        <Icon name={event.type.icon} className="text-[18px]" />
                      </span>
                      {event.title}
                      <span
                        className="rounded-full px-2 py-0.5 font-label text-label-sm"
                        style={{ backgroundColor: `${event.color ?? event.type.color}26` }}
                      >
                        {event.type.name}
                      </span>
                      {event.isInternalComm && (
                        <span className="rounded-full bg-tertiary-container px-2 py-0.5 font-label text-label-sm text-on-tertiary-container">
                          📌 Comunicação Interna
                        </span>
                      )}
                    </p>
                    {event.description && (
                      <p className="mt-1 text-body-sm text-on-surface-variant">{event.description}</p>
                    )}
                    <p className="mt-1 text-body-sm text-on-surface-variant">
                      {periodLabel(event)}
                      {timeLabel(event)} · {CALENDAR_RECURRENCE_LABELS[event.recurrence]} · {audienceLabel(event)} ·{' '}
                      {reminderLabel(event)}
                    </p>
                    {/* Rastro de autoria — a pergunta "quem colocou isso aqui?"
                        precisa ter resposta na tela, não só no log de auditoria. */}
                    <p className="mt-1 font-label text-label-sm text-on-surface-variant">
                      {addedByLabel(event.createdByName, event.createdAt)}
                    </p>
                  </div>
                  <div className="flex gap-sm">
                    <button
                      type="button"
                      onClick={() => startEdit(event)}
                      className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteMut.mutate(event.id)}
                      className="rounded-md border border-error/50 px-md py-1 font-label text-label-sm text-error transition-colors hover:bg-error/10"
                    >
                      Excluir
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Tipos de evento">
        <p className="mb-md text-body-sm text-on-surface-variant">
          Cada tipo vira um chip de filtro no calendário de quem tem a funcionalidade Calendário.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (newType.trim()) typeMut.mutate(newType.trim())
          }}
          className="mb-md flex flex-wrap gap-sm"
        >
          <input
            aria-label="Nome do tipo"
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            placeholder="Ex.: Provas B2B"
            maxLength={60}
            className={`${inputCls} sm:w-64`}
          />
          <button
            type="submit"
            disabled={typeMut.isPending || !newType.trim()}
            className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
          >
            Adicionar
          </button>
        </form>

        {types.length === 0 ? (
          <p className="text-body-sm text-on-surface-variant">Nenhum tipo cadastrado.</p>
        ) : (
          <ul className="flex flex-wrap gap-sm">
            {types.map((type) => (
              <li
                key={type.id}
                className="inline-flex items-center gap-sm rounded-full border border-outline-variant/50 px-md py-1 font-label text-label-sm text-on-surface"
              >
                <Icon name={type.icon} className="text-[16px] text-primary" />
                {type.name}
                <button
                  type="button"
                  aria-label={`Excluir tipo ${type.name}`}
                  onClick={() => deleteTypeMut.mutate(type.id)}
                  className="text-on-surface-variant transition-colors hover:text-error"
                >
                  <Icon name="close" className="text-[16px]" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

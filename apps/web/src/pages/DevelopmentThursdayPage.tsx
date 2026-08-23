import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  FEEDBACK_CATEGORY_LABELS,
  MIN_FEEDBACK_FIELD_LENGTH,
  PUBLIC_FEEDBACK_CATEGORIES,
  type DevelopmentThursdayEventDTO,
  type FeedbackCategory,
  type FeedbackDTO,
} from '@legends/shared'
import { Icon } from '../components/Icon'
import { ApiError } from '../lib/api'
import { useAuth } from '../auth/AuthContext'
import {
  createDevelopmentThursdayEventFeedback,
  createDevelopmentThursdayEvent,
  deleteDevelopmentThursdayEvent,
  listDevelopmentThursdayEventFeedbacks,
  listDevelopmentThursdayEvents,
  updateDevelopmentThursdayEvent,
} from '../lib/development-thursday-api'

const DAY_MS = 24 * 60 * 60 * 1000
const SPRINT_ANCHOR = '2026-07-06'
// Nova sprint a cada 14 dias (sempre numa segunda), encerrando na sexta da 2ª semana (start + 11).
const SPRINT_DAYS = 14
const SPRINT_END_OFFSET = 11
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']
// Hachura diagonal para sinalizar dias de uma sprint que já tem tema cadastrado.
const HATCH_STYLE = {
  backgroundImage:
    'repeating-linear-gradient(-45deg, rgba(127,127,127,0.16) 0, rgba(127,127,127,0.16) 1px, transparent 1px, transparent 8px)',
}

function utcDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS)
}

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay()
  return day === 0 || day === 6
}

function monthLabel(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date)
}

function longDate(date: string): string {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', timeZone: 'UTC' }).format(utcDate(date))
}

function timeLabel(event: DevelopmentThursdayEventDTO): string {
  return event.startTime && event.endTime ? `${event.startTime} até ${event.endTime}` : 'Horário a definir'
}

function currentHm(): string {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

function localYmd(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function isEventFinished(event: DevelopmentThursdayEventDTO): boolean {
  const today = localYmd()
  if (event.eventDate < today) return true
  if (event.eventDate > today) return false
  return event.endTime ? currentHm() >= event.endTime : false
}

function sprintWindowFor(date: Date) {
  const anchor = utcDate(SPRINT_ANCHOR)
  const day = utcDate(isoDate(date))
  const diffDays = Math.floor((day.getTime() - anchor.getTime()) / DAY_MS)
  const sprintIndex = Math.floor(diffDays / SPRINT_DAYS)
  const sprintStart = addDays(anchor, sprintIndex * SPRINT_DAYS)
  const sprintEnd = addDays(sprintStart, SPRINT_END_OFFSET)
  return { sprintStart, sprintEnd }
}

function monthBounds(month: Date) {
  const first = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), 1))
  const last = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0))
  const gridStart = addDays(first, -first.getUTCDay())
  const gridEnd = addDays(last, 6 - last.getUTCDay())
  return { first, last, gridStart, gridEnd }
}

function buildMonthDays(month: Date) {
  const { first, gridStart } = monthBounds(month)
  return Array.from({ length: 42 }, (_, index) => {
    const date = addDays(gridStart, index)
    return {
      date,
      iso: isoDate(date),
      inMonth: date.getUTCMonth() === first.getUTCMonth(),
      day: date.getUTCDate(),
    }
  })
}

export function DevelopmentThursdayPage() {
  const qc = useQueryClient()
  const { user } = useAuth()
  const today = useMemo(() => utcDate(new Date().toISOString().slice(0, 10)), [])
  const [month, setMonth] = useState(() => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)))
  const [selectedDate, setSelectedDate] = useState(today)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [editingEventId, setEditingEventId] = useState<string | null>(null)
  const [eventToDelete, setEventToDelete] = useState<DevelopmentThursdayEventDTO | null>(null)
  const [eventDetails, setEventDetails] = useState<DevelopmentThursdayEventDTO | null>(null)

  const { gridStart, gridEnd } = monthBounds(month)
  const from = isoDate(gridStart)
  const to = isoDate(gridEnd)
  const eventsQuery = useQuery({
    queryKey: ['development-thursday-events', from, to],
    queryFn: () => listDevelopmentThursdayEvents(from, to),
  })
  const events = eventsQuery.data?.events ?? []
  const eventByDate = new Map(events.map((event) => [event.eventDate, event]))
  const eventBySprintStart = new Map(events.map((event) => [event.sprintStart, event]))
  const selectedSprint = sprintWindowFor(selectedDate)
  const selectedSprintStart = isoDate(selectedSprint.sprintStart)
  const selectedSprintEnd = isoDate(selectedSprint.sprintEnd)
  const selectedSprintEvent = events.find((event) => event.sprintStart === selectedSprintStart)
  const selectedDateIsWeekend = isWeekend(selectedDate)
  const isAuthor = !!selectedSprintEvent && selectedSprintEvent.presenter.id === user?.id
  const isEditing = !!selectedSprintEvent && editingEventId === selectedSprintEvent.id
  const formDisabled = selectedDateIsWeekend || (!!selectedSprintEvent && !isEditing)

  const createEvent = useMutation({
    mutationFn: () =>
      createDevelopmentThursdayEvent({
        title: title.trim(),
        description: description.trim(),
        eventDate: isoDate(selectedDate),
        startTime: startTime || null,
        endTime: endTime || null,
        sprintStart: selectedSprintStart,
      }),
    onSuccess: () => {
      setTitle('')
      setDescription('')
      setStartTime('')
      setEndTime('')
      setEditingEventId(null)
      setEventToDelete(null)
      setEventDetails(null)
      setError(null)
      qc.invalidateQueries({ queryKey: ['development-thursday-events'] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao cadastrar tema.'),
  })
  const updateEvent = useMutation({
    mutationFn: () =>
      updateDevelopmentThursdayEvent(editingEventId ?? '', {
        title: title.trim(),
        description: description.trim(),
        eventDate: isoDate(selectedDate),
        startTime: startTime || null,
        endTime: endTime || null,
      }),
    onSuccess: () => {
      setTitle('')
      setDescription('')
      setStartTime('')
      setEndTime('')
      setEditingEventId(null)
      setEventDetails(null)
      setError(null)
      qc.invalidateQueries({ queryKey: ['development-thursday-events'] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao editar tema.'),
  })
  const deleteEvent = useMutation({
    mutationFn: (id: string) => deleteDevelopmentThursdayEvent(id),
    onSuccess: () => {
      setTitle('')
      setDescription('')
      setStartTime('')
      setEndTime('')
      setEditingEventId(null)
      setEventToDelete(null)
      setEventDetails(null)
      setError(null)
      qc.invalidateQueries({ queryKey: ['development-thursday-events'] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao excluir tema.'),
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim() || !description.trim() || selectedDateIsWeekend) return
    if (isEditing) {
      updateEvent.mutate()
      return
    }
    if (selectedSprintEvent) return
    createEvent.mutate()
  }

  function changeMonth(delta: number) {
    setMonth((current) => new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + delta, 1)))
  }

  function selectDate(date: Date) {
    const nextSprintStart = isoDate(sprintWindowFor(date).sprintStart)
    if (editingEventId && selectedSprintEvent?.sprintStart !== nextSprintStart) {
      setEditingEventId(null)
      setTitle('')
      setDescription('')
      setStartTime('')
      setEndTime('')
    }
    setSelectedDate(date)
  }

  function startEditing(event: DevelopmentThursdayEventDTO) {
    setEditingEventId(event.id)
    setSelectedDate(utcDate(event.eventDate))
    setTitle(event.title)
    setDescription(event.description)
    setStartTime(event.startTime ?? '')
    setEndTime(event.endTime ?? '')
    setError(null)
  }

  function cancelEditing() {
    setEditingEventId(null)
    setTitle('')
    setDescription('')
    setStartTime('')
    setEndTime('')
    setError(null)
  }

  function removeEvent(event: DevelopmentThursdayEventDTO) {
    setEventToDelete(event)
  }

  function confirmDelete() {
    if (!eventToDelete) return
    deleteEvent.mutate(eventToDelete.id)
  }

  return (
    <section className="mx-auto flex max-w-page flex-col gap-lg p-lg md:p-xl">
      <header className="flex flex-col gap-md md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-sm text-primary">
            <Icon name="school" className="text-[20px]" />
            <span className="font-label text-label-md uppercase tracking-[0.18em]">Quinta de Desenvolvimento</span>
          </div>
          <h1 className="mt-2 font-headline text-headline-xl text-on-surface">Calendário de temas</h1>
        </div>
        <div className="flex items-center gap-sm">
          <button type="button" onClick={() => changeMonth(-1)} aria-label="Mês anterior" className="rounded-md border border-outline-variant/50 p-2 text-on-surface-variant hover:border-primary hover:text-primary">
            <Icon name="chevron_left" className="text-[20px]" />
          </button>
          <strong className="min-w-48 text-center font-label text-label-lg capitalize text-on-surface">{monthLabel(month)}</strong>
          <button type="button" onClick={() => changeMonth(1)} aria-label="Próximo mês" className="rounded-md border border-outline-variant/50 p-2 text-on-surface-variant hover:border-primary hover:text-primary">
            <Icon name="chevron_right" className="text-[20px]" />
          </button>
        </div>
      </header>

      <div className="grid gap-lg lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container">
          <div className="grid grid-cols-7 border-b border-outline-variant/30 bg-surface-container-highest">
            {WEEKDAYS.map((day) => (
              <div key={day} className="px-2 py-2 text-center font-label text-label-sm text-on-surface-variant">{day}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {buildMonthDays(month).map((day) => {
              const item = eventByDate.get(day.iso)
              const sprintEvent = eventBySprintStart.get(isoDate(sprintWindowFor(day.date).sprintStart))
              const selected = isoDate(selectedDate) === day.iso
              const isToday = isoDate(today) === day.iso
              const weekend = isWeekend(day.date)
              // Sprint já ocupada: hachura os dias úteis que não são o dia do tema.
              const hatched = !weekend && !item && !!sprintEvent
              return (
                <button
                  key={day.iso}
                  type="button"
                  disabled={weekend}
                  aria-label={
                    weekend
                      ? `${day.day} indisponível`
                      : hatched
                        ? `${day.day} — sprint já tem tema cadastrado`
                        : undefined
                  }
                  onClick={() => {
                    selectDate(day.date)
                    if (item) setEventDetails(item)
                  }}
                  style={hatched ? HATCH_STYLE : undefined}
                  className={`min-h-24 border-b border-r border-outline-variant/20 p-2 text-left transition-colors sm:min-h-32 ${
                    weekend
                      ? 'cursor-not-allowed bg-surface-container-lowest'
                      : `${day.inMonth ? 'bg-surface-container' : 'bg-surface text-on-surface-variant'} hover:bg-surface-container-highest`
                  } ${selected && !weekend ? 'ring-2 ring-inset ring-primary' : ''}`}
                >
                  <span className={`inline-flex h-7 w-7 items-center justify-center rounded-full font-label text-label-sm ${isToday && !weekend ? 'bg-primary text-on-primary' : weekend ? 'text-on-surface-variant' : 'text-on-surface-variant'}`}>{day.day}</span>
                  {item && <CalendarEvent event={item} />}
                </button>
              )
            })}
          </div>
        </div>

        <aside className="rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
          <div className="mb-lg">
            <p className="font-label text-label-md text-primary">
              Sprint {longDate(selectedSprintStart)} - {longDate(selectedSprintEnd)}
            </p>
            {selectedDateIsWeekend ? (
              <p className="mt-1 text-body-sm text-on-surface-variant">Selecione um dia útil.</p>
            ) : selectedSprintEvent ? (
              <div className="mt-md rounded-lg border border-primary/30 bg-primary-container/15 p-md">
                <p className="font-label text-label-md text-on-surface">{selectedSprintEvent.title}</p>
                <p className="mt-1 text-body-sm text-on-surface-variant">{selectedSprintEvent.description}</p>
                <p className="mt-3 text-label-sm text-on-surface-variant">
                  {selectedSprintEvent.presenter.name} - {longDate(selectedSprintEvent.eventDate)} - {timeLabel(selectedSprintEvent)}
                </p>
                {isAuthor && !isEditing && (
                  <div className="mt-md flex flex-wrap gap-sm">
                    <button
                      type="button"
                      onClick={() => startEditing(selectedSprintEvent)}
                      className="inline-flex items-center gap-xs rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
                    >
                      <Icon name="edit" className="text-[16px]" />
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => removeEvent(selectedSprintEvent)}
                      disabled={deleteEvent.isPending}
                      className="inline-flex items-center gap-xs rounded-md border border-error/40 px-3 py-1 font-label text-label-sm text-error hover:border-error disabled:opacity-50"
                    >
                      <Icon name="delete" className="text-[16px]" />
                      Excluir
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <p className="mt-1 text-body-sm text-on-surface-variant">Sem tema cadastrado.</p>
            )}
            {selectedSprintEvent && !isEditing && (
              <p className="mt-md flex items-start gap-xs rounded-md bg-surface-container-highest px-md py-sm text-body-sm text-on-surface-variant">
                <Icon name="info" className="mt-px shrink-0 text-[16px] text-primary" />
                Só é possível cadastrar um tema por sprint.
              </p>
            )}
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-md">
            <label className="flex flex-col gap-1">
              <span className="font-label text-label-sm text-on-surface-variant">Título</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} disabled={formDisabled} className="rounded-md border border-outline-variant/60 bg-surface-container-highest px-3 py-2 text-body-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 disabled:opacity-50" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-label text-label-sm text-on-surface-variant">Descrição</span>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={800} rows={5} disabled={formDisabled} className="resize-none rounded-md border border-outline-variant/60 bg-surface-container-highest px-3 py-2 text-body-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 disabled:opacity-50" />
            </label>
            <div className="grid gap-sm sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="font-label text-label-sm text-on-surface-variant">Início</span>
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={formDisabled} className="rounded-md border border-outline-variant/60 bg-surface-container-highest px-3 py-2 text-body-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 disabled:opacity-50" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-label text-label-sm text-on-surface-variant">Fim</span>
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} disabled={formDisabled} className="rounded-md border border-outline-variant/60 bg-surface-container-highest px-3 py-2 text-body-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/30 disabled:opacity-50" />
              </label>
            </div>
            {error && <p role="alert" className="text-body-sm text-error">{error}</p>}
            <div className="flex flex-wrap gap-sm">
              <button type="submit" disabled={formDisabled || createEvent.isPending || updateEvent.isPending || !title.trim() || !description.trim()} className="inline-flex items-center justify-center gap-sm rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container disabled:cursor-not-allowed disabled:bg-surface-container disabled:text-on-surface-variant">
                <Icon name={isEditing ? 'save' : 'add'} className="text-[18px]" />
                {isEditing ? 'Salvar alterações' : 'Cadastrar tema'}
              </button>
              {isEditing && (
                <button type="button" onClick={cancelEditing} className="rounded-md border border-outline-variant/60 px-lg py-sm font-label text-label-md text-on-surface-variant hover:border-primary hover:text-primary">
                  Cancelar
                </button>
              )}
            </div>
          </form>
        </aside>
      </div>
      {eventToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-lg backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-development-topic-title"
            className="w-full max-w-md rounded-xl border border-outline-variant/40 bg-surface-container p-lg shadow-xl"
          >
            <div className="mb-md flex items-start gap-md">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-error-container text-error">
                <Icon name="delete" className="text-[22px]" />
              </span>
              <div className="min-w-0">
                <h3 id="delete-development-topic-title" className="font-headline text-title-lg text-on-surface">
                  Excluir tema?
                </h3>
                <p className="mt-1 text-body-sm text-on-surface-variant">
                  {eventToDelete.title}
                </p>
              </div>
            </div>
            <div className="mt-lg flex flex-col-reverse gap-sm sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setEventToDelete(null)}
                disabled={deleteEvent.isPending}
                className="rounded-md border border-outline-variant/60 px-lg py-sm font-label text-label-md text-on-surface-variant hover:border-primary hover:text-primary disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={deleteEvent.isPending}
                className="inline-flex items-center justify-center gap-sm rounded-md bg-error px-lg py-sm font-label text-label-md font-bold text-on-error hover:bg-error/90 disabled:opacity-50"
              >
                <Icon name="delete" className="text-[18px]" />
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
      {eventDetails && (
        <EventDetailsModal
          event={eventDetails}
          onClose={() => setEventDetails(null)}
          onEdit={eventDetails.presenter.id === user?.id ? () => {
            setEventDetails(null)
            startEditing(eventDetails)
          } : undefined}
          onDelete={eventDetails.presenter.id === user?.id ? () => {
            setEventDetails(null)
            removeEvent(eventDetails)
          } : undefined}
        />
      )}
    </section>
  )
}

function CalendarEvent({ event }: { event: DevelopmentThursdayEventDTO }) {
  return (
    <div className="mt-2 min-h-16 rounded-[4px] border border-[#16865f] bg-[#22a36f] py-2 pl-1.5 pr-3 text-left shadow-sm ring-1 ring-white/35">
      <div className="h-full border-l-2 border-white/80 pl-1.5">
        <p className="line-clamp-2 font-label text-label-sm font-bold leading-4 text-white">{event.title}</p>
        <p className="mt-1 truncate text-[11px] leading-4 text-white/90">{timeLabel(event)}</p>
      </div>
    </div>
  )
}

function EventDetailsModal({
  event,
  onClose,
  onEdit,
  onDelete,
}: {
  event: DevelopmentThursdayEventDTO
  onClose: () => void
  onEdit?: () => void
  onDelete?: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-lg backdrop-blur-[1px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="development-topic-details-title"
        className="w-full max-w-lg rounded-lg border border-outline-variant/40 bg-surface-container shadow-xl"
      >
        <div className="flex items-start justify-between gap-md border-b border-outline-variant/30 px-lg py-md">
          <div className="flex min-w-0 gap-md">
            <span className="mt-1 h-10 w-2 shrink-0 rounded-full bg-[#22a36f]" />
            <div className="min-w-0">
              <h3 id="development-topic-details-title" className="truncate font-headline text-title-lg text-on-surface">
                {event.title}
              </h3>
              <p className="mt-1 text-body-sm text-on-surface-variant">
                {longDate(event.eventDate)} · {timeLabel(event)}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-xs">
            {onEdit && (
              <button type="button" onClick={onEdit} aria-label="Editar tema" className="rounded-md p-2 text-on-surface-variant hover:bg-surface-container-highest hover:text-primary">
                <Icon name="edit" className="text-[18px]" />
              </button>
            )}
            {onDelete && (
              <button type="button" onClick={onDelete} aria-label="Excluir tema" className="rounded-md p-2 text-on-surface-variant hover:bg-surface-container-highest hover:text-error">
                <Icon name="delete" className="text-[18px]" />
              </button>
            )}
            <button type="button" onClick={onClose} aria-label="Fechar detalhes" className="rounded-md p-2 text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface">
              <Icon name="close" className="text-[18px]" />
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-md px-lg py-lg">
          <div className="rounded-md border border-primary/20 bg-primary-container/15 px-md py-sm">
            <p className="flex items-center gap-sm font-label text-label-md text-primary">
              <Icon name="schedule" className="text-[18px]" />
              Horário
            </p>
            <p className="mt-1 text-body-sm text-on-surface">{timeLabel(event)}</p>
          </div>

          <div className="rounded-md border border-outline-variant/30 bg-surface-container-low px-md py-sm">
            <p className="flex items-center gap-sm font-label text-label-md text-on-surface">
              <Icon name="subject" className="text-[18px] text-primary" />
              Descrição
            </p>
            <p className="mt-2 whitespace-pre-wrap text-body-sm leading-6 text-on-surface-variant">
              {event.description}
            </p>
          </div>

          <div className="flex items-center gap-sm rounded-md border border-outline-variant/30 bg-surface-container-low px-md py-sm">
            <Icon name="person" className="text-[18px] text-primary" />
            <p className="text-body-sm text-on-surface-variant">
              Apresentador: <span className="font-label text-on-surface">{event.presenter.name}</span>
            </p>
          </div>

          <DevelopmentThursdayFeedbackPanel event={event} />
        </div>
      </div>
    </div>
  )
}

function DevelopmentThursdayFeedbackPanel({ event }: { event: DevelopmentThursdayEventDTO }) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const [message, setMessage] = useState('')
  const [category, setCategory] = useState<FeedbackCategory>('ELOGIO')
  const [error, setError] = useState<string | null>(null)
  const finished = isEventFinished(event)
  const canLeaveFeedback = finished && user?.id !== event.presenter.id
  const feedbacksQuery = useQuery({
    queryKey: ['development-thursday-event-feedbacks', event.id],
    queryFn: () => listDevelopmentThursdayEventFeedbacks(event.id),
  })
  const feedbacks = feedbacksQuery.data?.feedbacks ?? []
  const createFeedback = useMutation({
    mutationFn: () =>
      createDevelopmentThursdayEventFeedback(event.id, {
        message: message.trim(),
        category,
      }),
    onSuccess: () => {
      setMessage('')
      setCategory('ELOGIO')
      setError(null)
      qc.invalidateQueries({ queryKey: ['development-thursday-event-feedbacks', event.id] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao enviar feedback.'),
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!canLeaveFeedback || message.trim().length < MIN_FEEDBACK_FIELD_LENGTH) return
    createFeedback.mutate()
  }

  return (
    <section className="border-t border-outline-variant/30 pt-md">
      <div className="mb-sm flex items-center gap-sm">
        <Icon name="reviews" className="text-[18px] text-primary" />
        <h4 className="font-label text-label-lg text-on-surface">Feedbacks da apresentação</h4>
      </div>

      {feedbacksQuery.isLoading ? (
        <p className="text-body-sm text-on-surface-variant">Carregando feedbacks...</p>
      ) : feedbacks.length === 0 ? (
        <p className="rounded-md border border-outline-variant/30 bg-surface-container-low px-md py-sm text-body-sm text-on-surface-variant">
          Nenhum feedback registrado neste tema.
        </p>
      ) : (
        <div className="flex max-h-56 flex-col gap-sm overflow-y-auto pr-1">
          {feedbacks.map((feedback) => (
            <DevelopmentThursdayFeedbackItem key={feedback.id} feedback={feedback} />
          ))}
        </div>
      )}

      {canLeaveFeedback ? (
        <form onSubmit={submit} className="mt-md flex flex-col gap-sm">
          <div className="flex flex-wrap gap-xs">
            {PUBLIC_FEEDBACK_CATEGORIES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setCategory(option)}
                className={`rounded-md border px-3 py-1 font-label text-label-sm ${
                  category === option
                    ? 'border-primary bg-primary text-on-primary'
                    : 'border-outline-variant/60 text-on-surface-variant hover:border-primary hover:text-primary'
                }`}
              >
                {FEEDBACK_CATEGORY_LABELS[option]}
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Seu feedback</span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={3}
              maxLength={800}
              className="resize-none rounded-md border border-outline-variant/60 bg-surface-container-highest px-3 py-2 text-body-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
            />
          </label>
          {error && <p role="alert" className="text-body-sm text-error">{error}</p>}
          <button
            type="submit"
            disabled={createFeedback.isPending || message.trim().length < MIN_FEEDBACK_FIELD_LENGTH}
            className="inline-flex items-center justify-center gap-sm self-start rounded-md bg-primary px-md py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container disabled:cursor-not-allowed disabled:bg-surface-container disabled:text-on-surface-variant"
          >
            <Icon name="send" className="text-[18px]" />
            Enviar feedback
          </button>
        </form>
      ) : (
        user?.id !== event.presenter.id && (
          <p className="mt-md rounded-md bg-surface-container-highest px-md py-sm text-body-sm text-on-surface-variant">
            Feedbacks ficam disponíveis após a apresentação.
          </p>
        )
      )}
    </section>
  )
}

function DevelopmentThursdayFeedbackItem({ feedback }: { feedback: FeedbackDTO }) {
  return (
    <article className="rounded-md border border-outline-variant/30 bg-surface-container-low px-md py-sm">
      <div className="flex flex-wrap items-center gap-xs">
        <strong className="font-label text-label-md text-on-surface">{feedback.author.name}</strong>
        <span className="rounded-full bg-primary-container/25 px-2 py-0.5 font-label text-[11px] text-primary">
          {FEEDBACK_CATEGORY_LABELS[feedback.category]}
        </span>
      </div>
      <p className="mt-1 whitespace-pre-wrap text-body-sm leading-6 text-on-surface-variant">{feedback.message}</p>
    </article>
  )
}

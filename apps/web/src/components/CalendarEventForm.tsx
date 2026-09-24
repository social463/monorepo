/**
 * Formulário de evento de calendário — compartilhado por dois pontos de entrada
 * que têm públicos diferentes: a tela de gestão em `/admin/eventos` (admin e
 * subadmin do bloco) e o modal do próprio `/calendario` (liderança, que não
 * entra no `/admin`). Um só formulário para as duas portas: campo novo aqui
 * aparece nos dois lugares, sem chance de divergirem.
 */
import {
  CALENDAR_AUDIENCE_SUGGESTIONS,
  CALENDAR_EVENT_DESCRIPTION_MAX_LENGTH,
  CALENDAR_EVENT_TAG_MAX_LENGTH,
  CALENDAR_EVENT_TITLE_MAX_LENGTH,
  CALENDAR_RECURRENCES,
  CALENDAR_RECURRENCE_LABELS,
  CALENDAR_REMINDER_OFFSETS,
  CALENDAR_CATEGORY_FALLBACK_COLOR,
  reminderOffsetLabel,
  type CalendarEventTypeDTO,
  type CalendarRecurrence,
  type PublicUser,
  type UpsertCalendarEventRequest,
} from '@legends/shared'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { Icon } from './Icon'
import { TargetPicker } from '../pages/mural-feedbacks/TargetPicker'
import { inputCls } from '../pages/admin/shared'

/** Setor no que o formulário precisa: id e nome (serve ao DTO admin e ao /sectors). */
export interface SectorOption {
  id: string
  name: string
}

/** Campos vazios de um evento novo — `typeId` entra no call site, do catálogo. */
export const EMPTY_CALENDAR_EVENT: UpsertCalendarEventRequest = {
  title: '',
  description: '',
  tag: '',
  date: '',
  endDate: '',
  startTime: '',
  endTime: '',
  typeId: '',
  color: '',
  audienceTags: [],
  isInternalComm: false,
  sectorIds: [],
  guestIds: [],
  recurrence: 'NONE',
  recurrenceUntil: '',
  recurrenceCount: null,
  reminderDaysBefore: [],
}

/**
 * Normaliza antes de enviar: campo opcional vazio vira null, porque string
 * vazia não é data, hora nem cor, e o Zod da rota recusaria.
 */
export function normalizeCalendarEvent(values: UpsertCalendarEventRequest): UpsertCalendarEventRequest {
  return {
    ...values,
    tag: values.tag?.trim() ? values.tag.trim() : null,
    endDate: values.endDate ? values.endDate : null,
    startTime: values.startTime ? values.startTime : null,
    // Hora de fim sem hora de início não significa nada — some junto, em vez de
    // chegar na API só para tomar 400.
    endTime: values.startTime && values.endTime ? values.endTime : null,
    color: values.color ? values.color : null,
    recurrenceUntil: values.recurrence === 'NONE' || !values.recurrenceUntil ? null : values.recurrenceUntil,
    recurrenceCount: values.recurrence === 'NONE' ? null : (values.recurrenceCount ?? null),
  }
}

/** O DTO de um evento já salvo, no formato que o formulário edita. */
export function calendarEventToForm(event: {
  title: string
  description: string
  tag: string | null
  date: string
  endDate: string | null
  startTime: string | null
  endTime: string | null
  color: string | null
  audienceTags: string[]
  isInternalComm: boolean
  type: { id: string }
  sectorIds: string[]
  guests: PublicUser[]
  recurrence: CalendarRecurrence
  recurrenceUntil: string | null
  recurrenceCount: number | null
  reminderDaysBefore: number[]
}): UpsertCalendarEventRequest {
  return {
    title: event.title,
    description: event.description,
    tag: event.tag ?? '',
    date: event.date,
    endDate: event.endDate ?? '',
    startTime: event.startTime ?? '',
    endTime: event.endTime ?? '',
    typeId: event.type.id,
    color: event.color ?? '',
    audienceTags: event.audienceTags,
    isInternalComm: event.isInternalComm,
    sectorIds: event.sectorIds,
    guestIds: event.guests.map((g) => g.id),
    recurrence: event.recurrence,
    recurrenceUntil: event.recurrenceUntil ?? '',
    recurrenceCount: event.recurrenceCount,
    reminderDaysBefore: event.reminderDaysBefore,
  }
}

function colorOf(types: CalendarEventTypeDTO[], typeId: string): string {
  return types.find((t) => t.id === typeId)?.color ?? CALENDAR_CATEGORY_FALLBACK_COLOR
}

export function CalendarEventForm({
  value,
  types,
  sectors,
  pending,
  canMarkInternal = false,
  onChange,
  onCancel,
  onSubmit,
}: {
  value: UpsertCalendarEventRequest
  types: CalendarEventTypeDTO[]
  sectors: SectorOption[]
  pending: boolean
  /** Só o admin e o time de G&G enxergam — e portanto marcam — comunicação interna. */
  canMarkInternal?: boolean
  onChange: (value: UpsertCalendarEventRequest) => void
  onCancel: () => void
  onSubmit: (value: UpsertCalendarEventRequest) => void
}) {
  const set = (patch: Partial<UpsertCalendarEventRequest>) => onChange({ ...value, ...patch })
  const sectorIds = value.sectorIds ?? []
  const reminders = value.reminderDaysBefore ?? []
  const audienceTags = value.audienceTags ?? []
  const guestIds = value.guestIds ?? []
  /*
   * Os nomes dos convidados saem da MESMA query que o `TargetPicker` usa
   * (`['users','company']`), já em cache: o formulário guarda só os ids, e
   * manter uma segunda lista de objetos em estado local seria a chance de as
   * duas divergirem — o clássico "removi o chip e o id continuou no payload".
   */
  const empresa = useQuery({
    queryKey: ['users', 'company'],
    queryFn: () => apiFetch<{ users: PublicUser[] }>('/users/company'),
    staleTime: 60_000,
  })
  const convidados = guestIds
    .map((id) => empresa.data?.users.find((u) => u.id === id))
    .filter((u): u is PublicUser => Boolean(u))
  const corDaCategoria = colorOf(types, value.typeId)

  function toggleSector(id: string) {
    set({ sectorIds: sectorIds.includes(id) ? sectorIds.filter((s) => s !== id) : [...sectorIds, id] })
  }

  function toggleReminder(days: number) {
    set({ reminderDaysBefore: reminders.includes(days) ? reminders.filter((d) => d !== days) : [...reminders, days] })
  }

  /**
   * Trocar de categoria repinta o evento com a cor dela — é o comportamento
   * pedido ("a cor padrão daquela categoria já é aplicada sem ajuste manual").
   * Cor escolhida à mão sobrevive: só é substituída se ainda for a da categoria
   * anterior, senão o ajuste manual se perderia a cada troca.
   */
  function changeType(typeId: string) {
    const anterior = corDaCategoria
    const manual = value.color && value.color.toLowerCase() !== anterior.toLowerCase()
    set({ typeId, color: manual ? value.color : colorOf(types, typeId) })
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(value)
      }}
      className="mb-lg flex flex-col gap-md rounded-lg border border-primary/30 bg-surface-container-low p-md"
    >
      <div className="grid gap-md sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Título</span>
          <input
            required
            value={value.title}
            maxLength={CALENDAR_EVENT_TITLE_MAX_LENGTH}
            onChange={(e) => set({ title: e.target.value })}
            className={inputCls}
          />
        </label>
        <div className="grid grid-cols-[1fr_auto] gap-sm">
          <label className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Categoria</span>
            <select value={value.typeId} onChange={(e) => changeType(e.target.value)} className={inputCls}>
              {types.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Cor</span>
            <input
              type="color"
              aria-label="Cor do evento"
              value={value.color || corDaCategoria}
              onChange={(e) => set({ color: e.target.value })}
              className="h-10 w-12 cursor-pointer rounded-md border border-outline-variant/60 bg-surface-container p-1"
            />
          </label>
        </div>
      </div>

      {/* A etiqueta é mais fina que a categoria ("Simulado" dentro de "Evento")
          e por isso NÃO dá cor nem entra no filtro: uma coluna de filtro por
          vocabulário novo faria a barra crescer sem dono. */}
      <label className="flex flex-col gap-1">
        <span className="font-label text-label-sm text-on-surface-variant">
          Etiqueta (opcional)
        </span>
        <input
          value={value.tag ?? ''}
          maxLength={CALENDAR_EVENT_TAG_MAX_LENGTH}
          placeholder="Ex.: Simulado, Circuito, Café Temático"
          onChange={(e) => set({ tag: e.target.value })}
          className={inputCls}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-label text-label-sm text-on-surface-variant">Descrição</span>
        <textarea
          value={value.description ?? ''}
          maxLength={CALENDAR_EVENT_DESCRIPTION_MAX_LENGTH}
          rows={2}
          onChange={(e) => set({ description: e.target.value })}
          className={inputCls}
        />
      </label>

      <div className="grid gap-md sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Data início</span>
          <input
            required
            type="date"
            value={value.date}
            onChange={(e) => set({ date: e.target.value })}
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Data fim (opcional)</span>
          <input
            type="date"
            min={value.date || undefined}
            value={value.endDate ?? ''}
            onChange={(e) => set({ endDate: e.target.value })}
            className={inputCls}
          />
        </label>
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className="font-label text-label-sm text-on-surface-variant">Horário (opcional)</legend>
        <div className="flex items-center gap-sm">
          <input
            type="time"
            aria-label="Hora de início"
            value={value.startTime ?? ''}
            onChange={(e) => set({ startTime: e.target.value })}
            className={inputCls}
          />
          <span className="text-on-surface-variant">–</span>
          <input
            type="time"
            aria-label="Hora de fim"
            disabled={!value.startTime}
            value={value.endTime ?? ''}
            onChange={(e) => set({ endTime: e.target.value })}
            className={`${inputCls} disabled:opacity-50`}
          />
        </div>
        <p className="text-body-sm text-on-surface-variant">
          Sem horário, o evento aparece na faixa “Dia todo”, no topo da grade.
        </p>
      </fieldset>

      <label className="flex flex-col gap-1">
        <span className="font-label text-label-sm text-on-surface-variant">Público-alvo (separado por vírgula)</span>
        <input
          placeholder={CALENDAR_AUDIENCE_SUGGESTIONS.join(', ')}
          value={audienceTags.join(', ')}
          onChange={(e) =>
            set({
              audienceTags: e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          className={inputCls}
        />
        <span className="text-body-sm text-on-surface-variant">
          Use “Todos” para visibilidade geral. Outras tags filtram por perfil (setor G&amp;G, lideranças, CEO).
        </span>
      </label>

      {/* Convidados nominais (Documento 3, seção 11). Convive com o público-alvo
          acima: um evento pode ter os dois, e eles se SOMAM — o convidado vê o
          evento mesmo estando fora do setor e fora da tag. */}
      <div className="flex flex-col gap-1">
        <span className="font-label text-label-sm text-on-surface-variant">Convidados (por nome)</span>
        <TargetPicker
          value={null}
          onChange={(user) => {
            if (user && !guestIds.includes(user.id)) set({ guestIds: [...guestIds, user.id] })
          }}
          excludeIds={guestIds}
          placeholder="Procurar pessoa na empresa…"
        />
        {convidados.length > 0 && (
          <ul className="mt-xs flex flex-wrap gap-xs">
            {convidados.map((guest) => (
              <li key={guest.id}>
                <button
                  type="button"
                  onClick={() => set({ guestIds: guestIds.filter((id) => id !== guest.id) })}
                  aria-label={`Remover ${guest.name} dos convidados`}
                  className="flex items-center gap-xs rounded-full border border-primary/40 bg-primary/10 px-sm py-0.5 font-label text-label-sm text-primary hover:border-error hover:text-error"
                >
                  {guest.name}
                  <Icon name="close" className="text-[14px]" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <span className="text-body-sm text-on-surface-variant">
          Quem for convidado enxerga o evento e recebe o aviso, mesmo fora do setor e do público-alvo acima.
        </span>
      </div>

      {canMarkInternal && (
        <label className="flex cursor-pointer items-start justify-between gap-md rounded-lg border border-tertiary/40 bg-tertiary-container/20 p-md">
          <span className="min-w-0">
            <span className="block font-label text-label-md text-on-surface">
              📌 Ação de Comunicação Interna (Apenas para o G&amp;G)
            </span>
            <span className="mt-1 block text-body-sm text-on-surface-variant">
              Marque para ocultar este registro dos colaboradores. Visível apenas no calendário do time de Gente e
              Gestão.
            </span>
          </span>
          <input
            type="checkbox"
            checked={value.isInternalComm ?? false}
            onChange={(e) => set({ isInternalComm: e.target.checked })}
            className="mt-1 h-5 w-5 shrink-0 accent-primary"
          />
        </label>
      )}

      <div className="grid gap-md sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Repetição</span>
          <select
            value={value.recurrence ?? 'NONE'}
            onChange={(e) => set({ recurrence: e.target.value as CalendarRecurrence })}
            className={inputCls}
          >
            {CALENDAR_RECURRENCES.map((option) => (
              <option key={option} value={option}>
                {CALENDAR_RECURRENCE_LABELS[option]}
              </option>
            ))}
          </select>
        </label>
        {value.recurrence !== 'NONE' && (
          <>
            <label className="flex flex-col gap-1">
              <span className="font-label text-label-sm text-on-surface-variant">Repetir até (opcional)</span>
              <input
                type="date"
                value={value.recurrenceUntil ?? ''}
                onChange={(e) => set({ recurrenceUntil: e.target.value, recurrenceCount: null })}
                className={inputCls}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-label text-label-sm text-on-surface-variant">Ou nº de ocorrências (opcional)</span>
              <input
                type="number"
                min={1}
                max={500}
                value={value.recurrenceCount ?? ''}
                onChange={(e) =>
                  set({ recurrenceCount: e.target.value ? Number(e.target.value) : null, recurrenceUntil: '' })
                }
                className={inputCls}
              />
            </label>
          </>
        )}
      </div>

      <fieldset className="flex flex-col gap-sm">
        <legend className="font-label text-label-sm text-on-surface-variant">
          Setores — nenhum marcado é a empresa inteira
        </legend>
        <div className="flex flex-wrap gap-sm">
          {sectors.map((sector) => (
            <label
              key={sector.id}
              className="inline-flex items-center gap-xs rounded-full border border-outline-variant/50 px-md py-1 font-label text-label-sm text-on-surface"
            >
              <input
                type="checkbox"
                checked={sectorIds.includes(sector.id)}
                onChange={() => toggleSector(sector.id)}
                className="h-4 w-4 accent-primary"
              />
              {sector.name}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-sm">
        <legend className="font-label text-label-sm text-on-surface-variant">Lembrete (opcional)</legend>
        <div className="flex flex-wrap gap-sm">
          {CALENDAR_REMINDER_OFFSETS.map((days) => (
            <label
              key={days}
              className="inline-flex items-center gap-xs rounded-full border border-outline-variant/50 px-md py-1 font-label text-label-sm text-on-surface"
            >
              <input
                type="checkbox"
                checked={reminders.includes(days)}
                onChange={() => toggleReminder(days)}
                className="h-4 w-4 accent-primary"
              />
              {reminderOffsetLabel(days)}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex gap-sm">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
        >
          Salvar
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-outline-variant/60 px-lg py-sm font-label text-label-md text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
        >
          Cancelar
        </button>
      </div>
    </form>
  )
}

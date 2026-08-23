import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  MEETING_AGENDA_MAX_LENGTH,
  MEETING_DURATION_MINUTES,
  MEETING_TITLE_MAX_LENGTH,
  type MeetingDurationMinutes,
  type PublicUser,
} from '@legends/shared'
import { Select } from '../../components/Select'
import { fetchOfficeRooms } from '../../lib/office-rooms-api'
import { foldText } from '../../lib/text'
import { fetchCompanyUsers } from './api'

export interface MeetingFormValues {
  title: string
  agenda: string
  startsAtLocal: string
  durationMinutes: MeetingDurationMinutes
  participantIds: string[]
  roomExternalKey: string
}

export const EMPTY_MEETING_FORM: MeetingFormValues = {
  title: '',
  agenda: '',
  startsAtLocal: '',
  durationMinutes: 30,
  participantIds: [],
  roomExternalKey: '',
}

/**
 * Formulário de reunião — o mesmo para marcar e para editar. Guarda os próprios
 * campos; quem monta troca `key` para remontar com outros valores iniciais.
 * Cada digitada chama `onDirty`, que é como o modal derruba um aviso de
 * conflito que já não descreve o que está na tela.
 */
export function MeetingForm({
  initialValues,
  roomFixed,
  submitLabel,
  pending,
  youId,
  onDirty,
  onRoomChange,
  onSubmit,
  onCancelEdit,
  children,
}: {
  initialValues: MeetingFormValues
  /** Sala vinda de fora (fluxo do escritório): campo não aparece, valor de `initialValues` vale como está. */
  roomFixed?: boolean
  submitLabel: string
  pending: boolean
  youId: string
  onDirty: () => void
  /**
   * Sala livre (fluxo do calendário): dispara assim que a pessoa escolhe no
   * `Select`, não só no envio — é o que deixa quem monta o formulário (o
   * `ScheduleMeetingModal`) acompanhar a sala em tempo real, para a agenda do
   * topo mostrar a sala certa antes mesmo do envio.
   */
  onRoomChange?: (roomExternalKey: string) => void
  onSubmit: (values: MeetingFormValues) => void
  onCancelEdit?: () => void
  /** Banner de conflito e mensagem de erro, logo acima do botão de enviar. */
  children?: ReactNode
}) {
  const [title, setTitle] = useState(initialValues.title)
  const [agenda, setAgenda] = useState(initialValues.agenda)
  const [startsAtLocal, setStartsAtLocal] = useState(initialValues.startsAtLocal)
  const [durationMinutes, setDurationMinutes] = useState(initialValues.durationMinutes)
  const [participantIds, setParticipantIds] = useState(initialValues.participantIds)
  const [roomExternalKey, setRoomExternalKey] = useState(initialValues.roomExternalKey)

  // Sala fixa não busca a lista — é a mesma economia que `useRoomMeetings` já
  // faz com `enabled`, e evita uma chamada inútil no fluxo do escritório.
  const rooms = useQuery({ queryKey: ['office-rooms'], queryFn: fetchOfficeRooms, enabled: !roomFixed })
  const roomOptions = useMemo(
    () =>
      (rooms.data?.rooms ?? []).map((room) => ({
        value: room.externalKey,
        label: room.capacity ? `${room.name} · ${room.capacity} lugares` : room.name,
      })),
    [rooms.data],
  )

  const canSubmit = title.trim().length > 0 && startsAtLocal !== '' && (roomFixed || roomExternalKey !== '')

  return (
    <section className="space-y-sm" aria-label={onCancelEdit ? 'Editar reunião' : 'Nova reunião'}>
      <div className="flex items-center justify-between">
        <h3 className="font-label text-label-md text-on-surface-variant">
          {onCancelEdit ? 'Editar reunião' : 'Nova reunião'}
        </h3>
        {onCancelEdit && (
          <button
            type="button"
            onClick={onCancelEdit}
            className="font-label text-label-sm text-on-surface-variant hover:underline"
          >
            Cancelar edição
          </button>
        )}
      </div>

      {!roomFixed && (
        // `<div>`, não `<label>`: embrulhar o `Select` num rótulo reabria o
        // dropdown a cada escolha. O clique na opção fecha a lista, e em
        // seguida o `<label>` reencaminha o mesmo clique para o
        // `<button role="combobox">` — que faz `setOpen(v => !v)` e reabre.
        // O nome acessível vem do `ariaLabel`, então nada se perde.
        <div className="flex flex-col gap-1 text-body-sm text-on-surface-variant">
          <span>Sala</span>
          <Select
            options={roomOptions}
            value={roomExternalKey}
            onChange={(value) => {
              setRoomExternalKey(value)
              onRoomChange?.(value)
              onDirty()
            }}
            ariaLabel="Sala"
            placeholder="Escolha a sala…"
          />
        </div>
      )}

      <div>
        <label className="mb-xs block text-body-sm text-on-surface-variant" htmlFor="meeting-title">
          Título
        </label>
        <input
          id="meeting-title"
          value={title}
          maxLength={MEETING_TITLE_MAX_LENGTH}
          onChange={(event) => {
            onDirty()
            setTitle(event.target.value)
          }}
          className="w-full rounded-md bg-surface-container-highest px-sm py-xs text-body-sm text-on-surface"
        />
      </div>

      <div>
        <label className="mb-xs block text-body-sm text-on-surface-variant" htmlFor="meeting-agenda">
          Pauta (opcional)
        </label>
        <textarea
          id="meeting-agenda"
          value={agenda}
          maxLength={MEETING_AGENDA_MAX_LENGTH}
          onChange={(event) => {
            onDirty()
            setAgenda(event.target.value)
          }}
          className="w-full rounded-md bg-surface-container-highest px-sm py-xs text-body-sm text-on-surface"
          rows={3}
        />
      </div>

      <div>
        <label className="mb-xs block text-body-sm text-on-surface-variant" htmlFor="meeting-start">
          Data e hora
        </label>
        <input
          id="meeting-start"
          type="datetime-local"
          value={startsAtLocal}
          onChange={(event) => {
            onDirty()
            setStartsAtLocal(event.target.value)
          }}
          className="w-full rounded-md bg-surface-container-highest px-sm py-xs text-body-sm text-on-surface"
        />
      </div>

      <div>
        <label className="mb-xs block text-body-sm text-on-surface-variant" htmlFor="meeting-duration">
          Duração
        </label>
        <select
          id="meeting-duration"
          value={durationMinutes}
          onChange={(event) => {
            onDirty()
            setDurationMinutes(Number(event.target.value) as MeetingDurationMinutes)
          }}
          className="w-full rounded-md bg-surface-container-highest px-sm py-xs text-body-sm text-on-surface"
        >
          {MEETING_DURATION_MINUTES.map((minutes) => (
            <option key={minutes} value={minutes}>
              {minutes} min
            </option>
          ))}
        </select>
      </div>

      <ParticipantPicker
        youId={youId}
        selectedIds={participantIds}
        onChange={(next) => {
          onDirty()
          setParticipantIds(next)
        }}
      />

      {children}

      <button
        type="button"
        disabled={!canSubmit || pending}
        onClick={() => onSubmit({ title, agenda, startsAtLocal, durationMinutes, participantIds, roomExternalKey })}
        className="w-full rounded-md bg-primary px-md py-sm font-label text-label-sm font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
      >
        {submitLabel}
      </button>
    </section>
  )
}

/** Quantos convidados aparecem como chip antes de virar "+N". */
const MAX_VISIBLE_CHIPS = 8

/** Setor de quem ainda não foi lotado — a lista não pode escondê-lo. */
const NO_SECTOR = 'Sem setor'

interface SectorGroup {
  name: string
  people: PublicUser[]
}

/**
 * Pessoas por setor, em ordem alfabética nos dois níveis (a API já devolve os
 * usuários por nome; aqui só os setores precisam de ordenação).
 */
function groupBySector(people: PublicUser[]): SectorGroup[] {
  const groups = new Map<string, PublicUser[]>()
  for (const person of people) {
    const name = person.sectorName?.trim() || NO_SECTOR
    const list = groups.get(name)
    if (list) list.push(person)
    else groups.set(name, [person])
  }
  return [...groups.entries()]
    .map(([name, list]) => ({ name, people: list }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}

/**
 * Checkbox de "marcar tudo": marcado quando todos já estão, parcial quando só
 * alguns. O `indeterminate` não existe em HTML como atributo — só como
 * propriedade do elemento —, daí o `ref`.
 */
function BulkCheckbox({
  label,
  count,
  ids,
  selectedIds,
  onChange,
}: {
  label: string
  count: number
  ids: string[]
  selectedIds: string[]
  onChange: (next: string[]) => void
}) {
  const chosen = ids.filter((id) => selectedIds.includes(id)).length
  const all = ids.length > 0 && chosen === ids.length
  return (
    <label className="flex items-center gap-xs rounded-md px-xs py-[2px] font-label text-label-sm text-on-surface hover:bg-surface-container-highest">
      <input
        type="checkbox"
        checked={all}
        ref={(el) => {
          if (el) el.indeterminate = chosen > 0 && !all
        }}
        onChange={() =>
          onChange(
            all
              ? selectedIds.filter((id) => !ids.includes(id))
              : [...selectedIds, ...ids.filter((id) => !selectedIds.includes(id))],
          )
        }
      />
      {/* O espaço é explícito: sem ele o nome acessível do checkbox sai
          colado ("Empresa inteira(3)"), porque a contagem é outro nó. */}
      {label}{' '}
      <span className="text-on-surface-variant">({count})</span>
    </label>
  )
}

/**
 * Convidados: qualquer pessoa da empresa, esteja conectada ao escritório ou
 * não — marcar a planning de quinta com quem não está online agora é o caso
 * normal. A lista vem agrupada por setor, com um checkbox no cabeçalho de cada
 * um e um "Empresa inteira" no topo: convidar o time todo é um clique, e ainda
 * dá para tirar uma pessoa dele depois.
 *
 * Os cabeçalhos agem sempre sobre o setor (ou a empresa) **inteiro**, mesmo com
 * filtro ligado — a contagem ao lado do rótulo é a de todo mundo, e seria uma
 * armadilha "Empresa inteira (47)" marcar só os 3 que o filtro deixou à vista.
 */
function ParticipantPicker({
  youId,
  selectedIds,
  onChange,
}: {
  youId: string
  selectedIds: string[]
  onChange: (next: string[]) => void
}) {
  const [filter, setFilter] = useState('')
  const [showAllChips, setShowAllChips] = useState(false)
  // Mesma query do TargetPicker do Mural: a empresa inteira, com `sectorName`
  // resolvido. `/users` (sem `scope`) traria só o próprio setor, e não haveria
  // como convidar outro time.
  const { data } = useQuery({
    queryKey: ['users', 'company'],
    queryFn: fetchCompanyUsers,
    staleTime: 60_000,
  })

  // O organizador não se convida — o backend o tira da lista de qualquer jeito.
  const people = useMemo(() => (data?.users ?? []).filter((user) => user.id !== youId), [data, youId])
  const selected = people.filter((person) => selectedIds.includes(person.id))
  const groups = useMemo(() => groupBySector(people), [people])

  // Só a exibição é filtrada: quem já foi escolhido continua contado e visível
  // como chip, e os cabeçalhos seguem falando pelo setor inteiro.
  const visible = useMemo(() => {
    const term = foldText(filter.trim())
    if (!term) return groups
    return groups
      .map((group) => ({ ...group, people: group.people.filter((p) => foldText(p.name).includes(term)) }))
      .filter((group) => group.people.length > 0)
  }, [groups, filter])

  /** Escolher alguém zera a busca: o normal é procurar a próxima pessoa. */
  function choose(next: string[]) {
    setFilter('')
    onChange(next)
  }

  function toggle(id: string) {
    choose(selectedIds.includes(id) ? selectedIds.filter((other) => other !== id) : [...selectedIds, id])
  }

  const chips = showAllChips ? selected : selected.slice(0, MAX_VISIBLE_CHIPS)

  return (
    <fieldset>
      <legend className="mb-xs flex w-full items-center justify-between gap-sm text-body-sm text-on-surface-variant">
        <span>Participantes</span>
        {selected.length > 0 && (
          <span className="font-label text-label-sm">
            {selected.length} {selected.length === 1 ? 'escolhido' : 'escolhidos'}
          </span>
        )}
      </legend>

      {selected.length > 0 && (
        <div className="mb-xs flex flex-wrap items-center gap-xs">
          {chips.map((person) => (
            <button
              key={person.id}
              type="button"
              onClick={() => toggle(person.id)}
              aria-label={`Remover ${person.name}`}
              className="flex items-center gap-xs rounded-full bg-primary/20 px-sm py-[2px] font-label text-label-sm text-on-surface hover:bg-primary/30"
            >
              {person.name} ✕
            </button>
          ))}
          {selected.length > chips.length && (
            <button
              type="button"
              onClick={() => setShowAllChips(true)}
              className="font-label text-label-sm text-primary hover:underline"
            >
              +{selected.length - chips.length}
            </button>
          )}
          <button
            type="button"
            onClick={() => choose([])}
            className="font-label text-label-sm text-on-surface-variant hover:underline"
          >
            Limpar
          </button>
        </div>
      )}

      <input
        type="search"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        aria-label="Filtrar pessoas"
        placeholder="Filtrar pessoas…"
        className="mb-xs w-full rounded-md bg-surface-container-highest px-sm py-xs text-body-sm text-on-surface"
      />

      <div className="max-h-40 space-y-[2px] overflow-y-auto rounded-md border border-outline-variant/40 p-xs">
        {people.length > 0 && (
          <BulkCheckbox
            label="Empresa inteira"
            count={people.length}
            ids={people.map((person) => person.id)}
            selectedIds={selectedIds}
            onChange={choose}
          />
        )}

        {visible.length === 0 ? (
          <p className="text-body-sm text-on-surface-variant">Ninguém encontrado.</p>
        ) : (
          visible.map((group) => {
            const todos = groups.find((g) => g.name === group.name)?.people ?? group.people
            return (
              <div key={group.name} className="pt-xs">
                <BulkCheckbox
                  label={group.name}
                  count={todos.length}
                  ids={todos.map((person) => person.id)}
                  selectedIds={selectedIds}
                  onChange={choose}
                />
                {group.people.map((person) => (
                  <label
                    key={person.id}
                    className="flex items-center gap-xs rounded-md px-xs py-[2px] pl-md text-body-sm text-on-surface hover:bg-surface-container-highest"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(person.id)}
                      onChange={() => toggle(person.id)}
                    />
                    {person.name}
                  </label>
                ))}
              </div>
            )
          })
        )}
      </div>
    </fieldset>
  )
}

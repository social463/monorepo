import { useMemo, useState, type ReactNode } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  MAX_VOTES_PER_PARTICIPANT,
  MIN_VOTES_PER_PARTICIPANT,
  MIN_SPRINT,
  MAX_SPRINT,
  retroRoomTitle,
  isLeaderRole,
  type RetroRoomStatus,
  type RetroRoomSummaryDTO,
} from '@legends/shared'
import { useAuth } from '../auth/AuthContext'
import { Icon } from '../components/Icon'
import { BackButton } from '../components/BackButton'
import { createRetroRoom, deleteRetroRoom, listInvitableUsers, listRetroRooms, listRetroSquads } from '../lib/retro-api'

const STATUS_LABEL: Record<RetroRoomStatus, string> = {
  OPEN: 'Aberta',
  CONCLUDED: 'Concluída',
}

function ArrowAffordance() {
  return (
    <span
      aria-hidden
      className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-container-highest text-on-surface-variant transition-colors group-hover:bg-primary group-hover:text-on-primary"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
        <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}

function Chip({ tone = 'neutral', children }: { tone?: 'primary' | 'neutral'; children: ReactNode }) {
  const tones = {
    primary: 'bg-primary/15 text-primary',
    neutral: 'bg-surface-container-highest text-on-surface-variant',
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-label text-[11px] font-medium ${tones[tone]}`}>
      {children}
    </span>
  )
}

/** Linha de lista compartilhada: barra de destaque, círculo, conteúdo, chips e seta. */
function ListRow({
  to,
  accent,
  title,
  meta,
  chips,
  action,
}: {
  to: string
  accent: 'primary' | 'muted'
  title: ReactNode
  meta?: ReactNode
  chips?: ReactNode
  action?: ReactNode
}) {
  return (
    <li className="relative">
      <Link
        to={to}
        className="group relative flex items-center gap-md overflow-hidden rounded-xl border border-outline-variant/30 bg-surface-container py-md pl-lg pr-md transition-all hover:border-primary/60 hover:bg-surface-container-high hover:shadow-lg"
      >
        <span
          aria-hidden
          className={`absolute inset-y-0 left-0 w-1.5 rounded-r-full ${accent === 'primary' ? 'bg-primary' : 'bg-outline-variant/60'}`}
        />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-headline text-title-md text-on-surface">{title}</h3>
          {meta && <p className="mt-0.5 truncate text-body-sm text-on-surface-variant">{meta}</p>}
        </div>
        {chips && <div className="hidden shrink-0 items-center gap-sm sm:flex">{chips}</div>}
        <ArrowAffordance />
      </Link>
      {action && <div className="absolute right-2 top-2 z-10">{action}</div>}
    </li>
  )
}

function RoomCard({ room, onArchive }: { room: RetroRoomSummaryDTO; onArchive?: (room: RetroRoomSummaryDTO) => void }) {
  return (
    <ListRow
      to={`/retrospectivas/${room.id}`}
      accent={room.status === 'OPEN' ? 'primary' : 'muted'}
      title={room.squads.map((s) => s.name).join(', ')}
      meta={`${room.creator.name} · ${room.participantCount} participantes`}
      chips={
        <>
          <Chip tone={room.status === 'OPEN' ? 'primary' : 'neutral'}>{STATUS_LABEL[room.status]}</Chip>
          {room.anonymous && <Chip>anônima</Chip>}
        </>
      }
      action={
        onArchive ? (
          <button
            type="button"
            aria-label="Arquivar sala"
            onClick={(e) => { e.preventDefault(); onArchive(room) }}
            className="grid h-9 w-9 place-items-center rounded-full bg-surface-container-highest text-on-surface-variant transition-colors hover:bg-error hover:text-on-error"
          >
            <Icon name="delete" className="text-[18px]" />
          </button>
        ) : undefined
      }
    />
  )
}

export function RetrosPage() {
  const { user } = useAuth()
  const isLead = isLeaderRole(user?.role)
  const rooms = useQuery({ queryKey: ['retro-rooms'], queryFn: listRetroRooms })
  const [modalOpen, setModalOpen] = useState(false)

  const bySprint = useMemo(() => {
    const map = new Map<number, number>()
    for (const r of rooms.data?.rooms ?? []) map.set(r.sprint, (map.get(r.sprint) ?? 0) + 1)
    return [...map.entries()].sort((a, b) => b[0] - a[0])
  }, [rooms.data])

  return (
    <section className={`mx-auto max-w-page p-lg md:p-xl ${isLead ? 'pb-28 md:pb-xl' : ''}`}>
      <header className="mb-xl flex items-start justify-between gap-md">
        <div>
          <h1 className="font-headline text-headline-xl text-on-surface">Retrospectivas</h1>
          <p className="mt-2 max-w-xl text-body-md text-on-surface-variant">
            Quadros de retrospectiva de sprint do time, em tempo real.
          </p>
        </div>
        {isLead && (
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="hidden shrink-0 rounded-md bg-primary px-lg py-sm font-label text-label-lg font-bold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container md:block"
          >
            Nova sala
          </button>
        )}
      </header>

      {rooms.isLoading ? (
        <p className="py-2xl text-center text-on-surface-variant">Carregando…</p>
      ) : bySprint.length === 0 ? (
        <p className="py-2xl text-center text-on-surface-variant">Nenhuma sala por aqui ainda.</p>
      ) : (
        <ul className="flex flex-col gap-sm">
          {bySprint.map(([sprint, count]) => (
            <ListRow
              key={sprint}
              to={`/retrospectivas/sprint/${sprint}`}
              accent="primary"
              title={`Sprint ${sprint}`}
              chips={<Chip tone="primary">{count === 1 ? '1 sala' : `${count} salas`}</Chip>}
            />
          ))}
        </ul>
      )}

      {isLead && (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="fixed bottom-6 right-4 z-40 flex items-center gap-sm rounded-full bg-primary px-lg py-md font-label text-label-lg font-bold text-on-primary shadow-lg transition-colors hover:bg-primary-container hover:text-on-primary-container md:hidden"
        >
          <Icon name="add" className="text-[20px]" />
          Nova sala
        </button>
      )}

      {modalOpen && <CreateRoomModal onClose={() => setModalOpen(false)} />}
    </section>
  )
}

export function RetroSprintPage() {
  const { user } = useAuth()
  const isLead = isLeaderRole(user?.role)
  const isAdmin = user?.role === 'ADMIN'
  const qc = useQueryClient()
  const { sprint } = useParams<{ sprint: string }>()
  const sprintNum = Number(sprint)
  const rooms = useQuery({ queryKey: ['retro-rooms'], queryFn: listRetroRooms })
  const [modalOpen, setModalOpen] = useState(false)
  const [toArchive, setToArchive] = useState<RetroRoomSummaryDTO | null>(null)

  const archive = useMutation({
    mutationFn: (room: RetroRoomSummaryDTO) => deleteRetroRoom(room.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['retro-rooms'] })
      setToArchive(null)
    },
  })

  const filtered = (rooms.data?.rooms ?? []).filter((r) => r.sprint === sprintNum)

  if (!Number.isInteger(sprintNum) || sprintNum < 1) return <Navigate to="/retrospectivas" replace />

  return (
    <section className={`mx-auto max-w-page p-lg md:p-xl ${isLead ? 'pb-28 md:pb-xl' : ''}`}>
      <header className="mb-xl flex items-center justify-between gap-md">
        <div className="flex items-center gap-sm">
          <BackButton fallback="/retrospectivas" className="-ml-sm" />
          <h2 className="font-headline text-headline-xl text-on-surface">Sprint {sprintNum}</h2>
        </div>
        {isLead && (
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="hidden shrink-0 rounded-md bg-primary px-lg py-sm font-label text-label-lg font-bold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container md:block"
          >
            Nova sala
          </button>
        )}
      </header>

      {rooms.isLoading ? (
        <p className="py-2xl text-center text-on-surface-variant">Carregando…</p>
      ) : filtered.length === 0 ? (
        <p className="py-2xl text-center text-on-surface-variant">Nenhuma sala nesta sprint.</p>
      ) : (
        <ul className="flex flex-col gap-sm">
          {filtered.map((room) => (
            <RoomCard key={room.id} room={room} onArchive={isAdmin ? setToArchive : undefined} />
          ))}
        </ul>
      )}

      {isLead && (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="fixed bottom-6 right-4 z-40 flex items-center gap-sm rounded-full bg-primary px-lg py-md font-label text-label-lg font-bold text-on-primary shadow-lg transition-colors hover:bg-primary-container hover:text-on-primary-container md:hidden"
        >
          <Icon name="add" className="text-[20px]" />
          Nova sala
        </button>
      )}

      {modalOpen && <CreateRoomModal onClose={() => setModalOpen(false)} defaultSprint={sprintNum} />}

      {toArchive && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-lg" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl bg-surface-container-high p-lg shadow-xl">
            <h3 className="font-headline text-title-lg text-on-surface">Arquivar sala</h3>
            <p className="mt-2 text-body-md text-on-surface-variant">
              Arquivar a sala da sprint {toArchive.sprint} ({toArchive.squads.map((s) => s.name).join(', ')})?
              Os dados ficam ocultos, mas não são apagados.
            </p>
            <div className="mt-lg flex justify-end gap-sm">
              <button
                type="button"
                onClick={() => setToArchive(null)}
                className="rounded-md px-lg py-sm font-label text-label-lg text-on-surface-variant hover:bg-surface-container-highest"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={archive.isPending}
                onClick={() => archive.mutate(toArchive)}
                className="rounded-md bg-error px-lg py-sm font-label text-label-lg font-bold text-on-error transition-colors hover:bg-error/90 disabled:opacity-60"
              >
                Arquivar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function CreateRoomModal({ onClose, defaultSprint }: { onClose: () => void; defaultSprint?: number }) {
  const qc = useQueryClient()
  const candidates = useQuery({ queryKey: ['retro-invitable'], queryFn: listInvitableUsers })
  const squads = useQuery({ queryKey: ['retro-squads'], queryFn: listRetroSquads })
  const [sprint, setSprint] = useState<number>(defaultSprint ?? 1)
  const [squadIds, setSquadIds] = useState<string[]>([])
  const [votes, setVotes] = useState(3)
  const [selected, setSelected] = useState<string[]>([])

  const create = useMutation({
    mutationFn: () =>
      createRetroRoom({ sprint, squadIds, votesPerParticipant: votes, participantIds: selected }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['retro-rooms'] })
      onClose()
    },
  })

  function toggleSquad(id: string) {
    setSquadIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      const chosen = squads.data?.squads.filter((s) => next.includes(s.id)) ?? []
      const union = [...new Set(chosen.flatMap((s) => s.members.map((m) => m.id)))]
      setSelected(union)
      return next
    })
  }

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const squadNames = (squads.data?.squads ?? [])
    .filter((s) => squadIds.includes(s.id))
    .map((s) => s.name)
    .sort((a, b) => a.localeCompare(b, 'pt-BR'))
  const canSubmit = sprint >= MIN_SPRINT && squadIds.length >= 1 && !create.isPending

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-lg" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-xl border border-outline-variant/40 bg-surface-container p-xl">
        <h3 className="font-headline text-title-lg text-on-surface">Nova retrospectiva</h3>

        <div className="mt-lg flex gap-md">
          <label className="block flex-1 text-label-md text-on-surface-variant">
            Número da Sprint
            <input
              type="number"
              min={MIN_SPRINT}
              max={MAX_SPRINT}
              value={sprint}
              onChange={(e) => setSprint(Number(e.target.value))}
              className="mt-1 w-full rounded-md border border-outline-variant/40 bg-surface px-md py-sm text-on-surface"
            />
          </label>
          <fieldset className="block flex-1 text-label-md text-on-surface-variant">
            <legend>Squads</legend>
            <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-outline-variant/40 bg-surface p-sm">
              {squads.data?.squads.map((s) => (
                <label key={s.id} className="flex items-center gap-sm py-1 text-body-md text-on-surface">
                  <input type="checkbox" checked={squadIds.includes(s.id)} onChange={() => toggleSquad(s.id)} />
                  {s.name}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        {squadNames.length > 0 && (
          <p className="mt-sm text-body-sm text-on-surface-variant">{retroRoomTitle(sprint, squadNames)}</p>
        )}

        <div className="mt-md flex items-center gap-lg">
          <label className="flex items-center gap-sm text-body-md text-on-surface">
            Votos por pessoa
            <input
              type="number"
              min={MIN_VOTES_PER_PARTICIPANT}
              max={MAX_VOTES_PER_PARTICIPANT}
              value={votes}
              onChange={(e) => setVotes(Number(e.target.value))}
              className="w-16 rounded-md border border-outline-variant/40 bg-surface px-sm py-1 text-on-surface"
            />
          </label>
        </div>

        <fieldset className="mt-md">
          <legend className="text-label-md text-on-surface-variant">Participantes</legend>
          <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-outline-variant/30 p-sm">
            {candidates.data?.users.map((u) => (
              <label key={u.id} className="flex items-center gap-sm py-1 text-body-md text-on-surface">
                <input type="checkbox" checked={selected.includes(u.id)} onChange={() => toggle(u.id)} />
                {u.name}
              </label>
            ))}
          </div>
        </fieldset>

        {create.isError && <p className="mt-md text-body-sm text-error">Não foi possível criar a sala.</p>}

        <div className="mt-xl flex justify-end gap-sm">
          <button type="button" onClick={onClose} className="rounded-md px-lg py-sm text-on-surface-variant hover:bg-surface-container-highest">
            Cancelar
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => create.mutate()}
            className="rounded-md bg-primary px-lg py-sm font-label font-bold text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
          >
            {create.isPending ? 'Criando…' : 'Criar sala'}
          </button>
        </div>
      </div>
    </div>
  )
}

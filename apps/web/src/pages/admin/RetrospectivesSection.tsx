import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { RetroRoomSummaryDTO, SquadWithMembersDTO } from '@legends/shared'
import { MIN_VOTES_PER_PARTICIPANT, MAX_VOTES_PER_PARTICIPANT } from '@legends/shared'
import { ApiError, apiFetch } from '../../lib/api'
import {
  listAdminRetroRooms,
  updateAdminRetroRoom,
  hardDeleteAdminRetroRoom,
  deleteRetroRoom,
} from '../../lib/retro-api'
import { Panel, inputCls } from './shared'
import { Icon } from '../../components/Icon'

type Confirm = { roomId: string; mode: 'archive' | 'delete' } | null

export function RetrospectivesSection() {
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'retro-rooms'] })
  const [editing, setEditing] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [error, setError] = useState<string | null>(null)

  const rooms = useQuery({ queryKey: ['admin', 'retro-rooms'], queryFn: listAdminRetroRooms })
  const squads = useQuery({
    queryKey: ['admin', 'squads'],
    queryFn: () => apiFetch<{ squads: SquadWithMembersDTO[] }>('/admin/squads'),
  })

  const editMut = useMutation({
    mutationFn: (vars: { id: string; sprint: number; squadIds: string[]; votesPerParticipant: number }) =>
      updateAdminRetroRoom(vars.id, { sprint: vars.sprint, squadIds: vars.squadIds, votesPerParticipant: vars.votesPerParticipant }),
    onSuccess: () => { setEditing(null); setError(null); invalidate() },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao editar sala.'),
  })
  const archiveMut = useMutation({
    mutationFn: (id: string) => deleteRetroRoom(id),
    onSuccess: () => { setConfirm(null); invalidate() },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao arquivar sala.'),
  })
  const deleteMut = useMutation({
    mutationFn: (id: string) => hardDeleteAdminRetroRoom(id),
    onSuccess: () => { setConfirm(null); invalidate() },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao deletar sala.'),
  })

  const list = rooms.data?.rooms ?? []

  return (
    <Panel title="Retrospectivas">
      {error && (
        <p role="alert" className="mb-md flex items-center gap-sm text-body-sm text-error">
          <Icon name="error" /> {error}
        </p>
      )}
      {list.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">Nenhuma sala por aqui ainda.</p>
      ) : (
        <ul className="flex flex-col gap-md">
          {list.map((room) => (
            <li key={room.id} className="rounded-lg border border-outline-variant/40 bg-surface-container-highest p-md">
              {editing === room.id ? (
                <EditForm
                  room={room}
                  squads={squads.data?.squads ?? []}
                  pending={editMut.isPending}
                  onCancel={() => setEditing(null)}
                  onSave={(vars) => editMut.mutate({ id: room.id, ...vars })}
                />
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-md">
                  <div>
                    <p className="font-label text-label-md text-on-surface">{room.title}</p>
                    <p className="text-body-sm text-on-surface-variant">
                      Sprint {room.sprint} · {room.status === 'OPEN' ? 'Aberta' : 'Concluída'} ·{' '}
                      {room.participantCount} participante(s) · por {room.creator.name}
                    </p>
                  </div>
                  <div className="flex gap-sm">
                    <button
                      type="button"
                      onClick={() => { setError(null); setEditing(room.id) }}
                      className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => { setError(null); setConfirm({ roomId: room.id, mode: 'archive' }) }}
                      className="rounded-md border border-error/40 px-md py-1 font-label text-label-sm text-error transition-colors hover:border-error"
                    >
                      Arquivar
                    </button>
                    <button
                      type="button"
                      onClick={() => { setError(null); setConfirm({ roomId: room.id, mode: 'delete' }) }}
                      className="rounded-md border border-error/40 px-md py-1 font-label text-label-sm text-error transition-colors hover:border-error"
                    >
                      Deletar
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-lg">
          <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-xl bg-surface-container p-lg">
            <h4 className="font-headline text-headline-sm text-on-surface">
              {confirm.mode === 'archive' ? 'Arquivar sala?' : 'Deletar sala permanentemente?'}
            </h4>
            <p className="mt-2 text-body-sm text-on-surface-variant">
              {confirm.mode === 'archive'
                ? 'A sala some das listagens e fica inacessível, mas os dados continuam no banco.'
                : 'Esta ação é irreversível: apaga a sala e todos os cards, votos, reações e histórico de edições.'}
            </p>
            <div className="mt-lg flex justify-end gap-sm">
              <button
                type="button"
                onClick={() => setConfirm(null)}
                className="rounded-md border border-outline-variant/60 px-lg py-sm font-label text-label-sm text-on-surface-variant"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={confirm.mode === 'archive' ? archiveMut.isPending : deleteMut.isPending}
                onClick={() => (confirm.mode === 'archive' ? archiveMut.mutate(confirm.roomId) : deleteMut.mutate(confirm.roomId))}
                className="rounded-md bg-error px-lg py-sm font-label text-label-md font-bold text-on-error disabled:opacity-50"
              >
                {confirm.mode === 'archive' ? 'Arquivar' : 'Deletar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </Panel>
  )
}

function EditForm({
  room,
  squads,
  pending,
  onCancel,
  onSave,
}: {
  room: RetroRoomSummaryDTO
  squads: SquadWithMembersDTO[]
  pending: boolean
  onCancel: () => void
  onSave: (vars: { sprint: number; squadIds: string[]; votesPerParticipant: number }) => void
}) {
  const [sprint, setSprint] = useState(room.sprint)
  const [votes, setVotes] = useState(room.votesPerParticipant)
  const [squadIds, setSquadIds] = useState<string[]>(room.squads.map((s) => s.id))

  const toggleSquad = (id: string) =>
    setSquadIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))

  return (
    <form
      className="flex flex-col gap-md"
      onSubmit={(e) => {
        e.preventDefault()
        if (squadIds.length === 0) return
        onSave({ sprint, squadIds, votesPerParticipant: votes })
      }}
    >
      <div className="flex flex-wrap gap-md">
        <label className="flex flex-col gap-1 text-body-sm text-on-surface-variant">
          Sprint
          <input type="number" min={1} value={sprint} onChange={(e) => setSprint(Number(e.target.value))} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-body-sm text-on-surface-variant">
          Votos por pessoa
          <input
            type="number"
            min={MIN_VOTES_PER_PARTICIPANT}
            max={MAX_VOTES_PER_PARTICIPANT}
            value={votes}
            onChange={(e) => setVotes(Number(e.target.value))}
            className={inputCls}
          />
        </label>
      </div>
      <fieldset className="flex flex-wrap gap-sm">
        <legend className="mb-1 text-body-sm text-on-surface-variant">Squads</legend>
        {squads.map((s) => (
          <label key={s.id} className="flex items-center gap-1 text-body-sm text-on-surface">
            <input type="checkbox" checked={squadIds.includes(s.id)} onChange={() => toggleSquad(s.id)} />
            {s.name}
          </label>
        ))}
      </fieldset>
      <div className="flex gap-sm">
        <button
          type="submit"
          disabled={pending || squadIds.length === 0}
          className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
        >
          Salvar
        </button>
        <button type="button" onClick={onCancel} className="rounded-md border border-outline-variant/60 px-lg py-sm font-label text-label-sm text-on-surface-variant">
          Cancelar
        </button>
      </div>
    </form>
  )
}

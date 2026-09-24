import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { isSectorAdminOnly } from '@legends/shared'
import type { PublicUser, SectorDTO, SquadWithMembersDTO } from '@legends/shared'
import { ApiError, apiFetch } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { Select } from '../../components/Select'
import { Panel, inputCls, groupBySector, SectorAccordion } from './shared'
import { useAuth } from '../../auth/AuthContext'

export function SquadsSection() {
  const { user } = useAuth()
  const isSubadmin = isSectorAdminOnly(user)
  const queryClient = useQueryClient()
  const [squadName, setSquadName] = useState('')
  const [squadSectorId, setSquadSectorId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  const squadsQuery = useQuery({
    queryKey: ['admin', 'squads'],
    queryFn: () => apiFetch<{ squads: SquadWithMembersDTO[] }>('/admin/squads'),
  })
  const usersQuery = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => apiFetch<{ users: PublicUser[] }>('/admin/users'),
  })
  const sectorsQuery = useQuery({
    queryKey: ['admin', 'sectors'],
    queryFn: () => apiFetch<{ sectors: SectorDTO[] }>('/admin/sectors'),
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'squads'] })

  const createSquad = useMutation({
    mutationFn: (body: { name: string; sectorId?: string }) =>
      apiFetch<{ squad: SquadWithMembersDTO }>('/admin/squads', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => { setSquadName(''); setSquadSectorId(''); setError(null); setShowForm(false); invalidate() },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao criar squad.'),
  })
  const toggleSquad = useMutation({
    mutationFn: (vars: { id: string; active: boolean }) =>
      apiFetch<{ squad: SquadWithMembersDTO }>(`/admin/squads/${vars.id}`, { method: 'PATCH', body: JSON.stringify({ active: vars.active }) }),
    onSuccess: invalidate,
  })
  // Excluir é irreversível e o padrão do /admin para isso é o `window.confirm`
  // (ver ChallengesSection, OneOnOneTopicsSection). O texto conta os integrantes
  // porque eles saem da squad junto — o `SquadMember` cascateia no banco.
  const deleteSquad = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/admin/squads/${id}`, { method: 'DELETE' }),
    onSuccess: () => { setError(null); invalidate() },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao excluir squad.'),
  })
  const addMember = useMutation({
    mutationFn: (vars: { squadId: string; userId: string }) =>
      apiFetch<{ squad: SquadWithMembersDTO }>(`/admin/squads/${vars.squadId}/members`, { method: 'POST', body: JSON.stringify({ userId: vars.userId }) }),
    onSuccess: () => { setError(null); invalidate() },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao adicionar integrante.'),
  })
  const removeMember = useMutation({
    mutationFn: (vars: { squadId: string; userId: string }) =>
      apiFetch<void>(`/admin/squads/${vars.squadId}/members/${vars.userId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  })
  const setLeader = useMutation({
    mutationFn: (vars: { id: string; leaderId: string | null }) =>
      apiFetch<{ squad: SquadWithMembersDTO }>(`/admin/squads/${vars.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ leaderId: vars.leaderId }),
      }),
    onSuccess: invalidate,
  })
  const setSector = useMutation({
    mutationFn: (vars: { id: string; sectorId: string }) =>
      apiFetch<{ squad: SquadWithMembersDTO }>(`/admin/squads/${vars.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ sectorId: vars.sectorId }),
      }),
    onSuccess: () => { setError(null); invalidate() },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao mudar o setor da squad.'),
  })

  const squads = squadsQuery.data?.squads ?? []
  const users = usersQuery.data?.users ?? []
  const sectors = sectorsQuery.data?.sectors ?? []

  function handleCreate(event: FormEvent) {
    event.preventDefault()
    if (!squadName.trim()) return
    createSquad.mutate({ name: squadName.trim(), sectorId: squadSectorId || undefined })
  }

  return (
    <Panel
      title="Squads"
      action={
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
        >
          {showForm ? 'Cancelar' : '+ Adicionar squad'}
        </button>
      }
    >
      {showForm && (
        <form onSubmit={handleCreate} className="mb-lg flex gap-sm">
          <input value={squadName} onChange={(e) => setSquadName(e.target.value)} aria-label="Nova squad" placeholder="Nova squad" className={`${inputCls} flex-1`} />
          {!isSubadmin && (
          <Select
            ariaLabel="Setor da nova squad"
            value={squadSectorId}
            onChange={setSquadSectorId}
            options={[{ value: '', label: 'Padrão' }, ...sectors.map((s) => ({ value: s.id, label: s.name }))]}
            className="min-w-64"
          />
          )}
          <button type="submit" className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container">
            Adicionar
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="mb-md flex items-center gap-sm text-body-sm text-error">
          <Icon name="error" className="text-[16px]" />
          {error}
        </p>
      )}
      <div className="flex flex-col gap-sm">
        {groupBySector(squads, sectors).map((group) => (
          <SectorAccordion key={group.key} name={group.name} count={group.items.length}>
            <ul className="flex flex-col gap-md">
              {group.items.map((squad) => {
                const memberIds = new Set(squad.members.map((m) => m.id))
                const addable = users.filter((u) => !memberIds.has(u.id))
                return (
                  <li key={squad.id} className="rounded-lg border border-outline-variant/20 bg-surface-container-low p-md">
                    <div className="flex items-center justify-between">
                      <span className={squad.active ? 'text-on-surface' : 'text-on-surface-variant line-through'}>{squad.name}</span>
                      <div className="flex items-center gap-sm">
                        <button
                          onClick={() => toggleSquad.mutate({ id: squad.id, active: !squad.active })}
                          className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
                        >
                          {squad.active ? 'Desativar' : 'Ativar'}
                        </button>
                        <button
                          onClick={() => {
                            const members =
                              squad.members.length === 1
                                ? ' 1 integrante sai dela.'
                                : squad.members.length > 1
                                  ? ` Os ${squad.members.length} integrantes saem dela.`
                                  : ''
                            if (window.confirm(`Excluir a squad "${squad.name}"?${members} Esta ação não pode ser desfeita.`)) {
                              deleteSquad.mutate(squad.id)
                            }
                          }}
                          className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant hover:border-error hover:text-error"
                        >
                          Excluir
                        </button>
                      </div>
                    </div>
                    <div className="mt-sm flex items-center gap-sm">
                      <span className="font-label text-label-sm text-on-surface-variant">Líder:</span>
                      <Select
                        ariaLabel={`Líder da ${squad.name}`}
                        className="max-w-xs flex-1"
                        value={squad.leaderId ?? ''}
                        onChange={(v) => setLeader.mutate({ id: squad.id, leaderId: v || null })}
                        options={[{ value: '', label: 'Sem líder' }, ...users.map((u) => ({ value: u.id, label: u.name }))]}
                        searchable
                      />
                    </div>
                    {!isSubadmin && (
                    <div className="mt-sm flex items-center gap-sm">
                      <span className="font-label text-label-sm text-on-surface-variant">Setor:</span>
                      <Select
                        ariaLabel={`Setor da ${squad.name}`}
                        className="max-w-xs flex-1"
                        value={squad.sectorId}
                        onChange={(value) => setSector.mutate({ id: squad.id, sectorId: value })}
                        options={sectors.map((s) => ({ value: s.id, label: s.name }))}
                      />
                    </div>
                    )}
                    <ul className="mt-sm flex flex-wrap gap-2">
                      {squad.members.map((m) => (
                        <li key={m.id} className="flex items-center gap-1 rounded-full bg-surface-container-highest px-3 py-1 text-body-sm text-on-surface">
                          {m.name}
                          <button aria-label={`Remover ${m.name}`} onClick={() => removeMember.mutate({ squadId: squad.id, userId: m.id })} className="text-on-surface-variant hover:text-error">
                            ×
                          </button>
                        </li>
                      ))}
                      {squad.members.length === 0 && <li className="text-body-sm text-on-surface-variant">Sem integrantes.</li>}
                    </ul>
                    <Select
                      ariaLabel={`Adicionar integrante à ${squad.name}`}
                      className="mt-sm"
                      placeholder="+ Adicionar integrante…"
                      value=""
                      onChange={(v) => { if (v) addMember.mutate({ squadId: squad.id, userId: v }) }}
                      options={addable.map((u) => ({ value: u.id, label: u.name }))}
                      searchable
                    />
                  </li>
                )
              })}
            </ul>
          </SectorAccordion>
        ))}
      </div>
    </Panel>
  )
}

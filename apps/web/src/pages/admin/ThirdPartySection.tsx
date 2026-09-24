import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  AdminUserDTO,
  Area,
  SectorDTO,
  ThirdPartyInviteDTO,
  FeatureKey,
} from '@legends/shared'
import {isSectorAdminOnly, AREAS, AREA_LABELS, FEATURE_LABELS, THIRD_PARTY_FEATURE_KEYS } from '@legends/shared'
import { ApiError, apiFetch } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { Select } from '../../components/Select'
import { Panel, inputCls } from './shared'
import { useAuth } from '../../auth/AuthContext'

function FeatureChecklist({
  selected,
  onToggle,
}: {
  selected: Set<FeatureKey>
  onToggle: (key: FeatureKey) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-sm sm:grid-cols-3">
      {/* Só features de colaborador: as de bloco administrativo (`gente-gestao`,
          `desenvolvimento-produto`) não valem para THIRD_PARTY — a guarda exige
          ADMIN ou SUBADMIN — e oferecê-las aqui só sugeriria um poder inexistente.
          Pelo mesmo motivo ficam de fora as internas (`metas`), que a API nega
          a terceirizado. */}
      {THIRD_PARTY_FEATURE_KEYS.map((key) => (
        <label key={key} className="flex items-center gap-xs font-label text-label-sm text-on-surface">
          <input
            type="checkbox"
            aria-label={FEATURE_LABELS[key]}
            checked={selected.has(key)}
            onChange={() => onToggle(key)}
          />
          {FEATURE_LABELS[key]}
        </label>
      ))}
    </div>
  )
}

function InviteForm({ onCreated }: { onCreated: (url: string) => void }) {
  const [expiresInMinutes, setExpiresInMinutes] = useState(24 * 60)
  const [features, setFeatures] = useState<Set<FeatureKey>>(new Set())
  const [error, setError] = useState<string | null>(null)

  const createInvite = useMutation({
    mutationFn: () =>
      apiFetch<{ invite: ThirdPartyInviteDTO }>('/admin/third-party-invites', {
        method: 'POST',
        body: JSON.stringify({ expiresInMinutes, enabledFeatures: Array.from(features) }),
      }),
    onSuccess: (data) => {
      if (data.invite.url) onCreated(data.invite.url)
      setError(null)
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao criar convite.'),
  })

  function toggle(key: FeatureKey) {
    setFeatures((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <div className="flex flex-col gap-sm rounded-lg border border-outline-variant/30 bg-surface-container-low p-md">
      <label className="flex max-w-xs flex-col gap-1 font-label text-label-sm text-on-surface-variant">
        Validade do link (minutos)
        <input
          className={inputCls}
          type="number"
          min={60}
          value={expiresInMinutes}
          onChange={(e) => setExpiresInMinutes(Number(e.target.value))}
          aria-label="Validade do link em minutos"
        />
      </label>
      <FeatureChecklist selected={features} onToggle={toggle} />
      {error && <p role="alert" className="text-body-sm text-error">{error}</p>}
      <div>
        <button
          type="button"
          onClick={() => createInvite.mutate()}
          className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container"
        >
          Gerar convite
        </button>
      </div>
    </div>
  )
}

/** Payload editável de um terceirizado — mesmos campos de perfil de uma Lenda (`CollaboratorRow`), sem `role` (trocar de papel não é uma edição de perfil). */
export interface ThirdPartyUserEdit {
  name: string
  email: string
  position: string
  squad: string
  joinedAt: string
  area: Area | null
  sectorId: string
  password?: string
  teamsWebhookUrl: string | null
  enabledFeatures: FeatureKey[]
}

function ThirdPartyRow({
  member,
  sectors,
  isSubadmin,
  onSave,
  onToggleActive,
}: {
  member: AdminUserDTO
  sectors: SectorDTO[]
  isSubadmin: boolean
  onSave: (id: string, data: ThirdPartyUserEdit) => Promise<unknown>
  onToggleActive: (id: string, active: boolean) => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(member.name)
  const [email, setEmail] = useState(member.email)
  const [position, setPosition] = useState(member.position ?? '')
  const [squad, setSquad] = useState(member.squad ?? '')
  const [joinedAt, setJoinedAt] = useState(member.joinedAt.slice(0, 10))
  const [area, setArea] = useState<Area | null>(member.area)
  const [sectorId, setSectorId] = useState(member.sectorId)
  const [password, setPassword] = useState('')
  const [teamsWebhookUrl, setTeamsWebhookUrl] = useState(member.teamsWebhookUrl ?? '')
  const [features, setFeatures] = useState<Set<FeatureKey>>(new Set(member.enabledFeatures))
  const [error, setError] = useState<string | null>(null)

  function toggle(key: FeatureKey) {
    setFeatures((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function handleSave() {
    setError(null)
    const trimmedPassword = password.trim()
    if (trimmedPassword && trimmedPassword.length < 8) {
      setError('A nova senha deve ter pelo menos 8 caracteres.')
      return
    }
    try {
      await onSave(member.id, {
        name: name.trim(),
        email: email.trim(),
        position: position.trim(),
        squad: squad.trim(),
        joinedAt,
        area,
        sectorId,
        password: trimmedPassword || undefined,
        teamsWebhookUrl: teamsWebhookUrl.trim() || null,
        enabledFeatures: Array.from(features),
      })
      setPassword('')
      setEditing(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erro ao salvar.')
    }
  }

  if (editing) {
    return (
      <li className="flex flex-col gap-sm rounded-lg border border-primary/40 bg-surface-container-low p-md">
        <div className="grid gap-sm sm:grid-cols-2">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} aria-label="Nome do terceirizado" placeholder="Nome" />
          <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} aria-label="E-mail do terceirizado" placeholder="E-mail" type="email" />
          <input className={inputCls} value={position} onChange={(e) => setPosition(e.target.value)} aria-label="Cargo do terceirizado" placeholder="Cargo" />
          <input className={inputCls} value={squad} onChange={(e) => setSquad(e.target.value)} aria-label="Squad do terceirizado" placeholder="Squad" />
          <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            Área
            <Select
              ariaLabel="Área do terceirizado"
              value={area ?? ''}
              onChange={(value) => setArea((value || null) as Area | null)}
              options={[{ value: '', label: '—' }, ...AREAS.map((a) => ({ value: a, label: AREA_LABELS[a] }))]}
            />
          </label>
          {!isSubadmin && (
          <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            Setor
            <Select
              ariaLabel="Setor do terceirizado"
              value={sectorId}
              onChange={setSectorId}
              options={sectors.map((s) => ({ value: s.id, label: s.name }))}
            />
          </label>
          )}
          <input className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Nova senha do terceirizado" placeholder="Nova senha (deixe em branco para manter)" type="password" autoComplete="new-password" />
          <input
            className={inputCls}
            value={teamsWebhookUrl}
            onChange={(e) => setTeamsWebhookUrl(e.target.value)}
            aria-label="URL do fluxo Teams do terceirizado"
            placeholder="URL do fluxo Teams (Power Automate)"
            type="url"
          />
          <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            Na equipe desde
            <input className={inputCls} type="date" value={joinedAt} onChange={(e) => setJoinedAt(e.target.value)} aria-label="Na equipe desde (terceirizado)" />
          </label>
        </div>
        <FeatureChecklist selected={features} onToggle={toggle} />
        {error && (
          <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
            <Icon name="error" className="text-[16px]" />
            {error}
          </p>
        )}
        <div className="flex gap-sm">
          <button
            onClick={handleSave}
            className="rounded-md bg-primary px-md py-1 font-label text-label-sm font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container"
          >
            Salvar
          </button>
          <button
            onClick={() => {
              setError(null)
              setEditing(false)
            }}
            className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant hover:text-on-surface"
          >
            Cancelar
          </button>
        </div>
      </li>
    )
  }

  return (
    <li className="flex items-center justify-between gap-md rounded-lg border border-outline-variant/20 bg-surface-container-low p-md">
      <span className={member.active ? 'text-on-surface' : 'text-on-surface-variant line-through'}>
        {member.name}
        <span className="ml-2 font-label text-label-sm text-on-surface-variant">
          {member.email}
          {member.area ? ` · ${AREA_LABELS[member.area]}` : ''}
          {member.position ? ` · ${member.position}` : ''}
          {member.squad ? ` · ${member.squad}` : ''}
        </span>
      </span>
      <div className="flex shrink-0 gap-sm">
        <button
          onClick={() => setEditing(true)}
          className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
        >
          Editar
        </button>
        <button
          onClick={() => onToggleActive(member.id, !member.active)}
          className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
        >
          {member.active ? 'Desativar' : 'Ativar'}
        </button>
      </div>
    </li>
  )
}

export function ThirdPartySection() {
  const { user } = useAuth()
  const isSubadmin = isSectorAdminOnly(user)
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null)
  const [revokeError, setRevokeError] = useState<string | null>(null)
  const [accountError, setAccountError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const usersQuery = useQuery({
    queryKey: ['admin', 'third-party-users'],
    queryFn: () => apiFetch<{ users: AdminUserDTO[] }>('/admin/third-party-users'),
  })
  const invitesQuery = useQuery({
    queryKey: ['admin', 'third-party-invites'],
    queryFn: () => apiFetch<{ invites: ThirdPartyInviteDTO[] }>('/admin/third-party-invites'),
  })
  const sectorsQuery = useQuery({
    queryKey: ['admin', 'sectors'],
    queryFn: () => apiFetch<{ sectors: SectorDTO[] }>('/admin/sectors'),
  })
  const sectors = sectorsQuery.data?.sectors ?? []
  const updateUser = useMutation({
    mutationFn: (vars: { id: string; data: ThirdPartyUserEdit }) =>
      apiFetch<{ user: AdminUserDTO }>(`/admin/users/${vars.id}`, {
        method: 'PATCH',
        body: JSON.stringify(vars.data),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'third-party-users'] }),
  })
  const toggleActive = useMutation({
    mutationFn: (vars: { id: string; active: boolean }) =>
      apiFetch<{ user: AdminUserDTO }>(`/admin/users/${vars.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ active: vars.active }),
      }),
    onSuccess: () => {
      setAccountError(null)
      queryClient.invalidateQueries({ queryKey: ['admin', 'third-party-users'] })
    },
    onError: (err) => setAccountError(err instanceof ApiError ? err.message : 'Erro ao atualizar conta.'),
  })
  const revokeInvite = useMutation({
    mutationFn: (id: string) => apiFetch(`/admin/third-party-invites/${id}/revoke`, { method: 'POST' }),
    onSuccess: () => {
      setRevokeError(null)
      queryClient.invalidateQueries({ queryKey: ['admin', 'third-party-invites'] })
    },
    onError: (err) => setRevokeError(err instanceof ApiError ? err.message : 'Erro ao revogar convite.'),
  })
  const deleteInvite = useMutation({
    mutationFn: (id: string) => apiFetch(`/admin/third-party-invites/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setRevokeError(null)
      queryClient.invalidateQueries({ queryKey: ['admin', 'third-party-invites'] })
    },
    onError: (err) => setRevokeError(err instanceof ApiError ? err.message : 'Erro ao excluir convite.'),
  })

  function handleDeleteInvite(id: string) {
    if (window.confirm('Excluir este link de convite? Essa ação não pode ser desfeita.')) {
      deleteInvite.mutate(id)
    }
  }

  async function copyInviteUrl() {
    if (!lastInviteUrl) return
    try {
      await navigator.clipboard.writeText(lastInviteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Panel
      title="Terceirizados"
      action={
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
        >
          {showForm ? 'Cancelar' : '+ Convidar terceirizado'}
        </button>
      }
    >
      {showForm && (
        <div className="mb-lg">
          <InviteForm
            onCreated={(url) => {
              setLastInviteUrl(url)
              queryClient.invalidateQueries({ queryKey: ['admin', 'third-party-invites'] })
            }}
          />
        </div>
      )}
      {lastInviteUrl && (
        <div className="mb-lg flex flex-col gap-sm rounded-lg border border-primary/30 bg-primary/10 px-md py-sm font-body text-body-sm text-on-surface">
          <p className="break-all">
            Link do convite: <a href={lastInviteUrl}>{lastInviteUrl}</a>
          </p>
          <div>
            <button
              type="button"
              onClick={copyInviteUrl}
              className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
            >
              {copied ? 'Copiado!' : 'Copiar link'}
            </button>
          </div>
        </div>
      )}

      <h3 className="mb-sm font-label text-label-md uppercase tracking-wide text-on-surface-variant">Convites</h3>
      {revokeError && (
        <p role="alert" className="mb-sm text-body-sm text-error">
          {revokeError}
        </p>
      )}
      <ul className="mb-lg flex flex-col gap-2">
        {invitesQuery.data?.invites.map((invite) => (
          <li key={invite.id} className="flex items-center justify-between gap-md rounded-lg border border-outline-variant/20 bg-surface-container-low p-md">
            <span className="font-label text-label-sm text-on-surface-variant">
              {invite.usedAt ? 'Usado' : invite.revokedAt ? 'Revogado' : 'Pendente'}
              {' · '}
              expira em {new Date(invite.expiresAt).toLocaleString('pt-BR')}
            </span>
            <div className="flex shrink-0 gap-sm">
              {!invite.usedAt && !invite.revokedAt && (
                <button
                  onClick={() => revokeInvite.mutate(invite.id)}
                  className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
                >
                  Revogar
                </button>
              )}
              <button
                onClick={() => handleDeleteInvite(invite.id)}
                className="rounded-md border border-error/60 px-3 py-1 font-label text-label-sm text-error hover:bg-error/10"
              >
                Excluir
              </button>
            </div>
          </li>
        ))}
      </ul>

      <h3 className="mb-sm font-label text-label-md uppercase tracking-wide text-on-surface-variant">Contas</h3>
      {accountError && (
        <p role="alert" className="mb-sm text-body-sm text-error">
          {accountError}
        </p>
      )}
      <ul className="flex flex-col gap-2">
        {usersQuery.data?.users.map((member) => (
          <ThirdPartyRow
            key={member.id}
            member={member}
            sectors={sectors}
            isSubadmin={isSubadmin}
            onSave={(id, data) => updateUser.mutateAsync({ id, data })}
            onToggleActive={(id, active) => toggleActive.mutate({ id, active })}
          />
        ))}
      </ul>
    </Panel>
  )
}

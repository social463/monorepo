import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  AdminUserDTO,
  FeatureKey,
  OrganizationSettingsDTO,
  SectorDTO,
  UpdateSectorRequest,
  UserRole,
} from '@legends/shared'
import {
  ADMIN_BLOCK_FEATURE_KEYS,
  COLLABORATOR_FEATURE_KEYS,
  FEATURE_LABELS,
  USER_ROLES,
  USER_ROLE_LABELS,
} from '@legends/shared'
import { ApiError, apiFetch } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { Select, type SelectOption } from '../../components/Select'
import { Panel, inputCls } from './shared'

const RESPONSIBLE_ROLES = new Set<UserRole>(['HEAD', 'MANAGER', 'LEAD', 'LEGEND'])
const EMPTY_RESPONSIBLE_IDS: string[] = []

function responsibleOptions(users: AdminUserDTO[]): SelectOption[] {
  return [
    { value: '', label: 'Sem responsável' },
    ...users.map((user) => ({
      value: user.id,
      label: `${user.name}${user.position ? ` · ${user.position}` : ''}`,
    })),
  ]
}

function CompanyResponsiblesEditor({
  users,
  initialIds,
  loading,
  saving,
  onSave,
}: {
  users: AdminUserDTO[]
  initialIds: string[]
  loading: boolean
  saving: boolean
  onSave: (ids: string[]) => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set(initialIds))

  useEffect(() => {
    setSelected(new Set(initialIds))
  }, [initialIds])

  function toggle(userId: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  return (
    <fieldset disabled={loading || saving} className="space-y-sm">
      <legend className="font-label text-label-sm font-bold text-on-surface">Responsáveis pela empresa</legend>
      <div className="grid max-h-56 gap-xs overflow-y-auto rounded-md border border-outline-variant/60 bg-surface-container-highest p-sm sm:grid-cols-2">
        {users.length > 0 ? (
          users.map((user) => (
            <label
              key={user.id}
              className="flex cursor-pointer items-center gap-sm rounded-md px-sm py-xs text-body-sm text-on-surface hover:bg-primary/10"
            >
              <input
                type="checkbox"
                checked={selected.has(user.id)}
                onChange={() => toggle(user.id)}
                aria-label={`Selecionar ${user.name} como responsável pela empresa`}
              />
              <span className="min-w-0">
                <span className="block truncate font-semibold">{user.name}</span>
                {user.position && <span className="block truncate text-label-sm text-on-surface-variant">{user.position}</span>}
              </span>
            </label>
          ))
        ) : (
          <p className="col-span-full p-sm text-body-sm text-on-surface-variant">Nenhum colaborador ativo disponível.</p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <p className="text-body-sm text-on-surface-variant">
          {selected.size === 0
            ? 'Nenhum responsável selecionado.'
            : `${selected.size} ${selected.size === 1 ? 'responsável selecionado' : 'responsáveis selecionados'}.`}
        </p>
        <button
          type="button"
          onClick={() => onSave(Array.from(selected))}
          disabled={loading || saving}
          className="rounded-md bg-primary px-md py-sm font-label text-label-sm font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
        >
          {saving ? 'Salvando…' : 'Salvar responsáveis'}
        </button>
      </div>
    </fieldset>
  )
}

/**
 * Bloco nomeado de caixas. Sem o título e a explicação, as três listas viram um
 * paredão único de 26 caixas e ninguém distingue funcionalidade de papel —
 * era exatamente a confusão que esta tela tinha.
 */
function CheckGroup({
  title,
  hint,
  children,
}: {
  title: string
  hint: string
  children: ReactNode
}) {
  return (
    <fieldset className="flex flex-col gap-xs rounded-lg border border-outline-variant/30 p-sm">
      <legend className="px-1 font-label text-label-sm font-bold uppercase tracking-wide text-on-surface-variant">
        {title}
      </legend>
      <p className="text-body-sm text-on-surface-variant">{hint}</p>
      <div className="grid grid-cols-2 gap-sm sm:grid-cols-3">{children}</div>
    </fieldset>
  )
}

function CheckItem({
  label,
  checked,
  onToggle,
  readOnly,
}: {
  label: string
  checked: boolean
  onToggle: () => void
  readOnly?: boolean
}) {
  return (
    <label
      className={`flex items-center gap-xs font-label text-label-sm ${
        readOnly && !checked ? 'text-on-surface-variant' : 'text-on-surface'
      }`}
    >
      <input
        type="checkbox"
        aria-label={label}
        checked={checked}
        // No card do setor as caixas só informam: `disabled` deixa isso óbvio,
        // em vez de parecerem clicáveis e não reagirem.
        disabled={readOnly}
        onChange={onToggle}
      />
      {label}
    </label>
  )
}

/**
 * As três listas que descrevem um setor, cada uma com o próprio título:
 * o que o colaborador usa, qual bloco do /admin o setor administra, e quais
 * papéis existem no setor.
 */
function SectorChecklists({
  features,
  roles,
  onToggleFeature,
  onToggleRole,
  readOnly,
}: {
  features: Set<FeatureKey>
  roles: Set<UserRole>
  onToggleFeature: (key: FeatureKey) => void
  onToggleRole: (role: UserRole) => void
  readOnly?: boolean
}) {
  return (
    <div className="flex flex-col gap-sm">
      <CheckGroup
        title="Funcionalidades do colaborador"
        hint="Telas e recursos liberados para quem trabalha neste setor."
      >
        {COLLABORATOR_FEATURE_KEYS.map((key) => (
          <CheckItem
            key={key}
            label={FEATURE_LABELS[key]}
            checked={features.has(key)}
            onToggle={() => onToggleFeature(key)}
            readOnly={readOnly}
          />
        ))}
      </CheckGroup>

      <CheckGroup
        title="Administração de áreas"
        hint="Quais blocos da administração o subadmin deste setor gerencia. Não libera nada para o colaborador — e o admin global enxerga todos, marcados ou não."
      >
        {ADMIN_BLOCK_FEATURE_KEYS.map((key) => (
          <CheckItem
            key={key}
            label={FEATURE_LABELS[key]}
            checked={features.has(key)}
            onToggle={() => onToggleFeature(key)}
            readOnly={readOnly}
          />
        ))}
      </CheckGroup>

      <CheckGroup title="Papéis do setor" hint="Cargos que podem ser atribuídos a alguém deste setor.">
        {USER_ROLES.map((role) => (
          <CheckItem
            key={role}
            label={USER_ROLE_LABELS[role]}
            checked={roles.has(role)}
            onToggle={() => onToggleRole(role)}
            readOnly={readOnly}
          />
        ))}
      </CheckGroup>
    </div>
  )
}

function SectorForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('')
  const [features, setFeatures] = useState<Set<FeatureKey>>(new Set(['escritorio']))
  const [roles, setRoles] = useState<Set<UserRole>>(new Set(['LEGEND']))
  const [error, setError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: () =>
      apiFetch<{ sector: SectorDTO }>('/admin/sectors', {
        method: 'POST',
        body: JSON.stringify({ name, enabledFeatures: Array.from(features), roles: Array.from(roles) }),
      }),
    onSuccess: () => {
      setName('')
      setError(null)
      onCreated()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao criar setor.'),
  })

  function toggleFeature(key: FeatureKey) {
    setFeatures((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleRole(role: UserRole) {
    setRoles((prev) => {
      const next = new Set(prev)
      if (next.has(role)) next.delete(role)
      else next.add(role)
      return next
    })
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    create.mutate()
  }

  return (
    <form onSubmit={handleSubmit} className="mb-lg flex flex-col gap-sm rounded-lg border border-outline-variant/30 bg-surface-container-low p-md">
      <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
        Nome do setor
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} aria-label="Nome do novo setor" placeholder="Ex.: Comercial" />
      </label>
      <SectorChecklists
        features={features}
        roles={roles}
        onToggleFeature={toggleFeature}
        onToggleRole={toggleRole}
      />
      {error && (
        <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
          <Icon name="error" className="text-[16px]" />
          {error}
        </p>
      )}
      <div>
        <button type="submit" className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container">
          Criar setor
        </button>
      </div>
    </form>
  )
}

function SectorRow({
  sector,
  users,
  onSave,
}: {
  sector: SectorDTO
  users: AdminUserDTO[]
  onSave: (id: string, data: UpdateSectorRequest) => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(sector.name)
  const [features, setFeatures] = useState<Set<FeatureKey>>(new Set(sector.enabledFeatures))
  const [roles, setRoles] = useState<Set<UserRole>>(new Set(sector.roles))
  const [responsibleId, setResponsibleId] = useState(sector.responsibleId ?? '')
  const sectorUsers = users.filter((user) => user.sectorId === sector.id)
  const responsible = users.find((user) => user.id === sector.responsibleId)

  function toggleFeature(key: FeatureKey) {
    setFeatures((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleRole(role: UserRole) {
    setRoles((prev) => {
      const next = new Set(prev)
      if (next.has(role)) next.delete(role)
      else next.add(role)
      return next
    })
  }

  if (editing) {
    return (
      <li className="flex flex-col gap-sm rounded-lg border border-primary/40 bg-surface-container-low p-md">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} aria-label={`Nome do setor ${sector.name}`} />
        <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
          Responsável pelo setor
          <Select
            ariaLabel={`Responsável pelo setor ${sector.name}`}
            value={responsibleId}
            onChange={setResponsibleId}
            options={responsibleOptions(sectorUsers)}
            searchable
          />
        </label>
        <SectorChecklists
          features={features}
          roles={roles}
          onToggleFeature={toggleFeature}
          onToggleRole={toggleRole}
        />
        <div className="flex gap-sm">
          <button
            onClick={() => {
              onSave(sector.id, {
                name: name.trim(),
                active: sector.active,
                responsibleId: responsibleId || null,
                enabledFeatures: Array.from(features),
                roles: Array.from(roles),
              })
              setEditing(false)
            }}
            className="rounded-md bg-primary px-md py-1 font-label text-label-sm font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container"
          >
            Salvar
          </button>
          <button onClick={() => setEditing(false)} className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant hover:text-on-surface">
            Cancelar
          </button>
        </div>
      </li>
    )
  }

  return (
    <li className="flex flex-col gap-sm rounded-lg border border-outline-variant/20 bg-surface-container-low p-md">
      <div className="flex items-center justify-between">
        <span className={sector.active ? 'text-on-surface' : 'text-on-surface-variant line-through'}>
          {sector.name}
          <span className="ml-2 font-label text-label-sm text-on-surface-variant">
            · Responsável: {responsible?.name ?? 'não definido'}
          </span>
        </span>
        <div className="flex shrink-0 gap-sm">
          <button onClick={() => setEditing(true)} className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary">
            Editar
          </button>
          <button
            onClick={() => onSave(sector.id, {
              name: sector.name,
              active: !sector.active,
              responsibleId: sector.responsibleId,
              enabledFeatures: sector.enabledFeatures,
              roles: sector.roles,
            })}
            className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
          >
            {sector.active ? 'Desativar' : 'Ativar'}
          </button>
        </div>
      </div>
      <SectorChecklists
        features={new Set(sector.enabledFeatures)}
        roles={new Set(sector.roles)}
        onToggleFeature={() => {}}
        onToggleRole={() => {}}
        readOnly
      />
    </li>
  )
}

export function SectorsSection() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)

  const sectorsQuery = useQuery({
    queryKey: ['admin', 'sectors'],
    queryFn: () => apiFetch<{ sectors: SectorDTO[] }>('/admin/sectors'),
  })
  const usersQuery = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => apiFetch<{ users: AdminUserDTO[] }>('/admin/users'),
  })
  const organizationSettingsQuery = useQuery({
    queryKey: ['admin', 'organization-settings'],
    queryFn: () => apiFetch<{ settings: OrganizationSettingsDTO }>('/admin/organization-settings'),
  })
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'sectors'] })
  const updateSector = useMutation({
    mutationFn: (vars: { id: string; data: UpdateSectorRequest }) =>
      apiFetch<{ sector: SectorDTO }>(`/admin/sectors/${vars.id}`, { method: 'PATCH', body: JSON.stringify(vars.data) }),
    onSuccess: () => {
      setUpdateError(null)
      invalidate()
      queryClient.invalidateQueries({ queryKey: ['organization'] })
    },
    onError: (err) => setUpdateError(err instanceof ApiError ? err.message : 'Erro ao salvar setor.'),
  })
  const updateOrganizationSettings = useMutation({
    mutationFn: (companyResponsibleIds: string[]) =>
      apiFetch<{ settings: OrganizationSettingsDTO }>('/admin/organization-settings', {
        method: 'PATCH',
        body: JSON.stringify({ companyResponsibleIds }),
      }),
    onSuccess: () => {
      setUpdateError(null)
      queryClient.invalidateQueries({ queryKey: ['admin', 'organization-settings'] })
      queryClient.invalidateQueries({ queryKey: ['organization'] })
    },
    onError: (err) => setUpdateError(err instanceof ApiError ? err.message : 'Erro ao salvar responsável da empresa.'),
  })

  const sectors = sectorsQuery.data?.sectors ?? []
  const eligibleUsers = (usersQuery.data?.users ?? []).filter(
    (user) => user.active && !user.leftAt && RESPONSIBLE_ROLES.has(user.role),
  )

  return (
    <Panel
      title="Setores"
      action={
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
        >
          {showForm ? 'Cancelar' : '+ Adicionar setor'}
        </button>
      }
    >
      <section className="mb-lg rounded-lg border border-primary/30 bg-primary/5 p-md">
        <CompanyResponsiblesEditor
          users={eligibleUsers}
          initialIds={organizationSettingsQuery.data?.settings.companyResponsibleIds ?? EMPTY_RESPONSIBLE_IDS}
          loading={organizationSettingsQuery.isLoading}
          saving={updateOrganizationSettings.isPending}
          onSave={(ids) => updateOrganizationSettings.mutate(ids)}
        />
        <p className="mt-xs text-body-sm text-on-surface-variant">
          Essas pessoas aparecem lado a lado no topo do organograma, acima dos setores.
        </p>
      </section>
      {showForm && <SectorForm onCreated={() => { setShowForm(false); invalidate() }} />}
      {updateError && (
        <p role="alert" className="mb-md flex items-center gap-sm text-body-sm text-error">
          <Icon name="error" className="text-[16px]" />
          {updateError}
        </p>
      )}
      <ul className="flex flex-col gap-md">
        {sectors.map((sector) => (
          <SectorRow
            key={sector.id}
            sector={sector}
            users={eligibleUsers}
            onSave={(id, data) => updateSector.mutate({ id, data })}
          />
        ))}
      </ul>
    </Panel>
  )
}

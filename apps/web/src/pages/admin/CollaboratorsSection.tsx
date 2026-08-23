import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AdminUserDTO, UserRole, Area, SectorDTO, PublicUser } from '@legends/shared'
import { canReceiveAdminAccess, isSectorAdminOnly, USER_ROLES, USER_ROLE_LABELS, AREAS, AREA_LABELS } from '@legends/shared'
import { ApiError, apiFetch } from '../../lib/api'
import { downloadCsv, toCsv } from '../../lib/csv'
import { Icon } from '../../components/Icon'
import { Select } from '../../components/Select'
import { PhotoUploadField } from '../../components/PhotoUploadField'
import { VacationDialog } from '../../components/VacationDialog'
import { UserImportDialog } from './UserImportDialog'
import { Panel, inputCls, groupBySector, SectorAccordion } from './shared'
import { useAuth } from '../../auth/AuthContext'

const CSV_HEADERS = [
  'Nome',
  'E-mail',
  'Papel',
  'Área',
  'Setor',
  'Squad',
  'Cargo',
  'Situação',
  'Na equipe desde',
  'Desligado em',
]

function csvRow(member: AdminUserDTO, sectorName: string): unknown[] {
  return [
    member.name,
    member.email,
    USER_ROLE_LABELS[member.role],
    member.area ? AREA_LABELS[member.area] : '',
    sectorName,
    member.squad ?? '',
    member.position ?? '',
    member.active ? 'Ativo' : 'Inativo',
    member.joinedAt.slice(0, 10),
    member.leftAt ? member.leftAt.slice(0, 10) : '',
  ]
}

/**
 * Aplica busca livre + filtros de setor/squad/papel. A busca cobre os campos
 * que a pessoa usaria para procurar alguém (nome, e-mail, cargo, squad),
 * sem diferenciar acento nem caixa.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

export function filterCollaborators(
  members: AdminUserDTO[],
  filters: { search: string; sectorId: string; squad: string; role: string },
): AdminUserDTO[] {
  const term = normalize(filters.search.trim())
  return members.filter((member) => {
    if (filters.sectorId && member.sectorId !== filters.sectorId) return false
    if (filters.role && member.role !== filters.role) return false
    if (filters.squad && (member.squad ?? '') !== filters.squad) return false
    if (!term) return true
    return [member.name, member.email ?? '', member.position ?? '', member.squad ?? ''].some((field) =>
      normalize(field).includes(term),
    )
  })
}

// ----- Linha de colaborador (com edição inline) -----
function CollaboratorRow({
  member,
  sectors,
  leaderOptions,
  isSubadmin,
  canGrantAdminAccess,
  onSave,
  onToggle,
  onSetLeft,
  onOpenVacations,
}: {
  member: AdminUserDTO
  sectors: SectorDTO[]
  leaderOptions: { value: string; label: string }[]
  isSubadmin: boolean
  /** Só o ADMIN por papel concede acesso administrativo — a API recusa o resto com 403. */
  canGrantAdminAccess: boolean
  onSave: (
    id: string,
    data: { name: string; email: string; position: string; squad: string; joinedAt: string; birthDate: string | null; role: UserRole; area: Area | null; sectorId: string; managerId: string | null; password?: string; teamsWebhookUrl: string | null; photoUrl: string | null; adminAccess?: boolean },
  ) => void
  onToggle: (id: string, active: boolean) => void
  onSetLeft: (id: string, leftAt: string | null) => void
  onOpenVacations: (member: AdminUserDTO) => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(member.name)
  const [email, setEmail] = useState(member.email)
  const [position, setPosition] = useState(member.position ?? '')
  const [squad, setSquad] = useState(member.squad ?? '')
  const [joinedAt, setJoinedAt] = useState(member.joinedAt.slice(0, 10))
  const [birthDate, setBirthDate] = useState(member.birthDate ?? '')
  const [role, setRole] = useState<UserRole>(member.role)
  const [area, setArea] = useState<Area | null>(member.area)
  const [sectorId, setSectorId] = useState(member.sectorId)
  const [managerId, setManagerId] = useState(member.managerId ?? '')
  const [password, setPassword] = useState('')
  const [teamsWebhookUrl, setTeamsWebhookUrl] = useState(member.teamsWebhookUrl ?? '')
  const [photoUrl, setPhotoUrl] = useState<string | null>(member.photoUrl)
  const [adminAccess, setAdminAccess] = useState(member.adminAccess)
  const [error, setError] = useState<string | null>(null)

  // O switch acompanha o papel escolhido no próprio formulário: mudar para
  // Terceirizado com o acesso ligado seria salvar um estado que a API recusa.
  const roleTakesAdminAccess = canReceiveAdminAccess(role)

  function reset() {
    setEditing(false)
    setError(null)
    setPassword('')
    setPhotoUrl(member.photoUrl)
    setAdminAccess(member.adminAccess)
  }

  function handleSave() {
    const trimmedPassword = password.trim()
    if (trimmedPassword && trimmedPassword.length < 8) {
      setError('A nova senha deve ter pelo menos 8 caracteres.')
      return
    }
    onSave(member.id, {
      name: name.trim(),
      email: email.trim(),
      position: position.trim(),
      squad: squad.trim(),
      joinedAt,
      // Campo em branco limpa a data de nascimento (o back aceita null).
      birthDate: birthDate || null,
      role,
      area,
      sectorId,
      managerId: managerId || null,
      password: trimmedPassword || undefined,
      teamsWebhookUrl: teamsWebhookUrl.trim() || null,
      photoUrl,
      // Só vai no payload quem pode mexer nele: a API responde 403 ao campo
      // vindo de quem não é ADMIN, mesmo que o valor não tenha mudado.
      ...(canGrantAdminAccess ? { adminAccess: adminAccess && roleTakesAdminAccess } : {}),
    })
    reset()
  }

  if (editing) {
    return (
      <li className="flex flex-col gap-sm rounded-lg border border-primary/40 bg-surface-container-low p-md">
        <PhotoUploadField value={photoUrl} onChange={setPhotoUrl} label="Foto do colaborador" />
        <div className="grid gap-sm sm:grid-cols-2">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} aria-label="Nome do colaborador" placeholder="Nome" />
          <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} aria-label="E-mail do colaborador" placeholder="E-mail" type="email" />
          <input className={inputCls} value={position} onChange={(e) => setPosition(e.target.value)} aria-label="Cargo do colaborador" placeholder="Cargo" />
          <input className={inputCls} value={squad} onChange={(e) => setSquad(e.target.value)} aria-label="Squad do colaborador" placeholder="Squad" />
          <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            Papel
            <Select
              ariaLabel="Papel do colaborador"
              value={role}
              onChange={(value) => setRole(value as UserRole)}
              options={(isSubadmin ? USER_ROLES.filter((r) => r !== 'ADMIN' && r !== 'SUBADMIN') : USER_ROLES).map((r) => ({ value: r, label: USER_ROLE_LABELS[r] }))}
            />
          </label>
          <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            Área
            <Select
              ariaLabel="Área do colaborador"
              value={area ?? ''}
              onChange={(value) => setArea((value || null) as Area | null)}
              options={[{ value: '', label: '—' }, ...AREAS.map((a) => ({ value: a, label: AREA_LABELS[a] }))]}
            />
          </label>
          {!isSubadmin && (
          <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            Setor
            <Select
              ariaLabel="Setor do colaborador"
              value={sectorId}
              onChange={setSectorId}
              options={sectors.map((s) => ({ value: s.id, label: s.name }))}
            />
          </label>
          )}
          <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            Líder direto
            <Select
              ariaLabel="Líder direto do colaborador"
              value={managerId}
              onChange={setManagerId}
              options={[
                { value: '', label: 'Sem líder (topo do organograma)' },
                ...leaderOptions.filter((option) => option.value !== member.id),
              ]}
            />
          </label>
          <input className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} aria-label="Nova senha do colaborador" placeholder="Nova senha (deixe em branco para manter)" type="password" autoComplete="new-password" />
          <input
            className={inputCls}
            value={teamsWebhookUrl}
            onChange={(e) => setTeamsWebhookUrl(e.target.value)}
            aria-label="URL do fluxo Teams"
            placeholder="URL do fluxo Teams (Power Automate)"
            type="url"
          />
          <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            Na equipe desde
            <input className={inputCls} type="date" value={joinedAt} onChange={(e) => setJoinedAt(e.target.value)} aria-label="Na equipe desde" />
          </label>
          <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            Data de nascimento
            <input className={inputCls} type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} aria-label="Data de nascimento do colaborador" />
          </label>
        </div>
        {canGrantAdminAccess && (
          <div className="flex items-center justify-between gap-md rounded-lg border border-outline-variant/40 p-md">
            <div>
              <p className="font-label text-label-lg text-on-surface">Acesso administrativo</p>
              <p className="font-body text-body-sm text-on-surface-variant">
                {roleTakesAdminAccess
                  ? 'Abre o painel de administração com poderes completos, sem mudar o papel: a pessoa continua no time, com tudo que o papel dela permite. Vale no próximo acesso (até 15 minutos).'
                  : 'Disponível apenas para Lenda, Líder, Gerente e Head.'}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={adminAccess && roleTakesAdminAccess}
              aria-label="Acesso administrativo do colaborador"
              disabled={!roleTakesAdminAccess}
              onClick={() => setAdminAccess((v) => !v)}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
                adminAccess && roleTakesAdminAccess ? 'bg-primary' : 'bg-surface-container-highest'
              } disabled:bg-surface-container disabled:text-on-surface-variant`}
            >
              <span
                className={`absolute top-1 h-5 w-5 rounded-full bg-surface transition-all ${
                  adminAccess && roleTakesAdminAccess ? 'left-6' : 'left-1'
                }`}
              />
            </button>
          </div>
        )}
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
            onClick={reset}
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
        {member.leftAt && <span className="text-on-surface-variant"> · ex-lenda</span>}
        {member.adminAccess && (
          <span className="ml-2 rounded-full bg-tertiary-container px-2 py-0.5 font-label text-label-sm text-on-tertiary-container">
            Acesso admin
          </span>
        )}
        <span className="ml-2 font-label text-label-sm text-on-surface-variant">
          {USER_ROLE_LABELS[member.role]}
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
          type="button"
          onClick={() => onOpenVacations(member)}
          className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
        >
          Férias
        </button>
        <button
          onClick={() => onToggle(member.id, !member.active)}
          className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
        >
          {member.active ? 'Desativar' : 'Ativar'}
        </button>
        <button
          type="button"
          onClick={() =>
            member.leftAt
              ? onSetLeft(member.id, null)
              : onSetLeft(member.id, new Date().toISOString())
          }
          className="rounded-lg px-md py-sm font-label text-label-sm text-on-surface-variant hover:text-on-surface"
        >
          {member.leftAt ? 'Readmitir' : 'Desligar'}
        </button>
      </div>
    </li>
  )
}

export function CollaboratorsSection() {
  const { user } = useAuth()
  const isSubadmin = isSectorAdminOnly(user)
  // Conceder acesso administrativo é do ADMIN por papel — quem entrou pelo
  // próprio acesso delegado não passa o poder adiante (a API responde 403).
  const canGrantAdminAccess = user?.role === 'ADMIN'
  const queryClient = useQueryClient()
  const emptyDev = { name: '', email: '', password: '', position: '', squad: '', joinedAt: '', birthDate: '', role: 'LEGEND' as UserRole, area: null as Area | null, teamsWebhookUrl: '', sectorId: '', managerId: '', photoUrl: null as string | null }
  const [devForm, setDevForm] = useState(emptyDev)
  const [devError, setDevError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [vacationTarget, setVacationTarget] = useState<PublicUser | null>(null)
  const [importing, setImporting] = useState(false)
  const [search, setSearch] = useState('')
  const [filterSector, setFilterSector] = useState('')
  const [filterSquad, setFilterSquad] = useState('')
  const [filterRole, setFilterRole] = useState('')

  const usersQuery = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => apiFetch<{ users: AdminUserDTO[] }>('/admin/users'),
  })
  const sectorsQuery = useQuery({
    queryKey: ['admin', 'sectors'],
    queryFn: () => apiFetch<{ sectors: SectorDTO[] }>('/admin/sectors'),
  })
  const sectors = sectorsQuery.data?.sectors ?? []
  const allMembers = usersQuery.data?.users ?? []

  const squadOptions = useMemo(() => {
    const names = new Set<string>()
    for (const member of allMembers) if (member.squad?.trim()) names.add(member.squad)
    return [...names].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [allMembers])

  // Só quem aparece no organograma pode liderar; a API recusa o resto de todo jeito.
  const leaderOptions = useMemo(
    () =>
      allMembers
        .filter((member) => member.active && !member.leftAt)
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
        .map((member) => ({
          value: member.id,
          label: member.position ? `${member.name} — ${member.position}` : member.name,
        })),
    [allMembers],
  )

  const filters = { search, sectorId: filterSector, squad: filterSquad, role: filterRole }
  const filtering = Boolean(search.trim() || filterSector || filterSquad || filterRole)
  const members = useMemo(
    () => filterCollaborators(allMembers, filters),
    [allMembers, search, filterSector, filterSquad, filterRole],
  )

  function handleExportCsv() {
    const sectorNames = new Map(sectors.map((sector) => [sector.id, sector.name]))
    // Exporta o que está na tela: filtro aplicado é filtro exportado.
    const csv = toCsv(CSV_HEADERS, members.map((m) => csvRow(m, sectorNames.get(m.sectorId) ?? 'Sem setor')))
    downloadCsv(`lendas-${new Date().toISOString().slice(0, 10)}.csv`, csv)
  }

  const createUser = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch<{ user: AdminUserDTO }>('/admin/users', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setDevForm(emptyDev)
      setDevError(null)
      setShowForm(false)
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
    onError: (err) => setDevError(err instanceof ApiError ? err.message : 'Erro ao criar lenda.'),
  })
  const updateUser = useMutation({
    mutationFn: (vars: { id: string; data: Record<string, unknown> }) =>
      apiFetch<{ user: AdminUserDTO }>(`/admin/users/${vars.id}`, { method: 'PATCH', body: JSON.stringify(vars.data) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
  })

  function handleCreateDev(event: FormEvent) {
    event.preventDefault()
    if (!devForm.name.trim() || !devForm.email.trim() || devForm.password.length < 8) {
      setDevError('Nome, e-mail e senha (mín. 8 caracteres) são obrigatórios.')
      return
    }
    const payload: Record<string, unknown> = {
      name: devForm.name.trim(),
      email: devForm.email.trim(),
      password: devForm.password,
      position: devForm.position.trim(),
      squad: devForm.squad.trim(),
      role: devForm.role,
      area: devForm.area,
      teamsWebhookUrl: devForm.teamsWebhookUrl.trim() || null,
      photoUrl: devForm.photoUrl,
    }
    if (devForm.joinedAt) payload.joinedAt = devForm.joinedAt
    if (devForm.birthDate) payload.birthDate = devForm.birthDate
    if (devForm.sectorId) payload.sectorId = devForm.sectorId
    if (devForm.managerId) payload.managerId = devForm.managerId
    createUser.mutate(payload)
  }

  return (
    <Panel
      title="Lendas"
      action={
        <div className="flex gap-sm">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={members.length === 0}
            className="flex items-center gap-xs rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary disabled:opacity-40 disabled:hover:border-outline-variant/60 disabled:hover:text-on-surface-variant"
          >
            <Icon name="download" className="text-[16px]" />
            Exportar CSV
          </button>
          <button
            type="button"
            onClick={() => setImporting(true)}
            className="flex items-center gap-xs rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
          >
            <Icon name="upload" className="text-[16px]" />
            Importar planilha
          </button>
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
          >
            {showForm ? 'Cancelar' : '+ Adicionar lenda'}
          </button>
        </div>
      }
    >
      {showForm && (
      <form onSubmit={handleCreateDev} className="mb-lg flex flex-col gap-sm rounded-lg border border-outline-variant/30 bg-surface-container-low p-md">
        <p className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">Adicionar lenda</p>
        <div className="grid gap-sm sm:grid-cols-2">
          <div className="sm:col-span-2">
            <PhotoUploadField
              value={devForm.photoUrl}
              onChange={(url) => setDevForm({ ...devForm, photoUrl: url })}
              label="Foto do colaborador"
            />
          </div>
          <input className={inputCls} value={devForm.name} onChange={(e) => setDevForm({ ...devForm, name: e.target.value })} aria-label="Nome" placeholder="Nome" />
          <input className={inputCls} value={devForm.email} onChange={(e) => setDevForm({ ...devForm, email: e.target.value })} aria-label="E-mail" placeholder="E-mail" type="email" />
          <input className={inputCls} value={devForm.position} onChange={(e) => setDevForm({ ...devForm, position: e.target.value })} aria-label="Cargo" placeholder="Cargo (opcional)" />
          <input className={inputCls} value={devForm.squad} onChange={(e) => setDevForm({ ...devForm, squad: e.target.value })} aria-label="Squad" placeholder="Squad (opcional)" />
          <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            Área
            <Select
              ariaLabel="Área"
              value={devForm.area ?? ''}
              onChange={(value) => setDevForm({ ...devForm, area: (value || null) as Area | null })}
              options={[{ value: '', label: '—' }, ...AREAS.map((a) => ({ value: a, label: AREA_LABELS[a] }))]}
            />
          </label>
          <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            Papel
            <Select
              ariaLabel="Papel"
              value={devForm.role}
              onChange={(value) => setDevForm({ ...devForm, role: value as UserRole })}
              options={(isSubadmin ? USER_ROLES.filter((r) => r !== 'ADMIN' && r !== 'SUBADMIN') : USER_ROLES).map((r) => ({ value: r, label: USER_ROLE_LABELS[r] }))}
            />
          </label>
          {!isSubadmin && (
          <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            Setor
            <Select
              ariaLabel="Setor"
              value={devForm.sectorId}
              onChange={(value) => setDevForm({ ...devForm, sectorId: value })}
              options={[{ value: '', label: 'Padrão' }, ...sectors.map((s) => ({ value: s.id, label: s.name }))]}
            />
          </label>
          )}
          <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            Líder direto
            <Select
              ariaLabel="Líder direto"
              value={devForm.managerId}
              onChange={(value) => setDevForm({ ...devForm, managerId: value })}
              options={[{ value: '', label: 'Sem líder (topo do organograma)' }, ...leaderOptions]}
            />
          </label>
          <input className={inputCls} value={devForm.password} onChange={(e) => setDevForm({ ...devForm, password: e.target.value })} aria-label="Senha provisória" placeholder="Senha provisória (mín. 8)" type="password" />
          <input
            className={inputCls}
            value={devForm.teamsWebhookUrl}
            onChange={(e) => setDevForm({ ...devForm, teamsWebhookUrl: e.target.value })}
            aria-label="URL do fluxo Teams"
            placeholder="URL do fluxo Teams (opcional)"
            type="url"
          />
          <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            Na equipe desde (opcional)
            <input className={inputCls} type="date" value={devForm.joinedAt} onChange={(e) => setDevForm({ ...devForm, joinedAt: e.target.value })} aria-label="Na equipe desde" />
          </label>
          <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            Data de nascimento (opcional)
            <input className={inputCls} type="date" value={devForm.birthDate} onChange={(e) => setDevForm({ ...devForm, birthDate: e.target.value })} aria-label="Data de nascimento" />
          </label>
        </div>
        {devError && (
          <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
            <Icon name="error" className="text-[16px]" />
            {devError}
          </p>
        )}
        <div>
          <button type="submit" className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container">
            Criar lenda
          </button>
        </div>
      </form>
      )}

      <div className="mb-lg flex flex-col gap-sm">
        <div className="grid gap-sm sm:grid-cols-2 lg:grid-cols-4">
          <input
            className={inputCls}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar pessoa"
            placeholder="Buscar por nome, e-mail, cargo ou squad…"
            type="search"
          />
          {!isSubadmin && (
            <Select
              ariaLabel="Filtrar por setor"
              value={filterSector}
              onChange={setFilterSector}
              options={[{ value: '', label: 'Todos os setores' }, ...sectors.map((s) => ({ value: s.id, label: s.name }))]}
            />
          )}
          <Select
            ariaLabel="Filtrar por squad"
            value={filterSquad}
            onChange={setFilterSquad}
            options={[{ value: '', label: 'Todas as squads' }, ...squadOptions.map((s) => ({ value: s, label: s }))]}
          />
          <Select
            ariaLabel="Filtrar por papel"
            value={filterRole}
            onChange={setFilterRole}
            options={[{ value: '', label: 'Todos os papéis' }, ...USER_ROLES.map((r) => ({ value: r, label: USER_ROLE_LABELS[r] }))]}
          />
        </div>
        <p className="font-label text-label-sm text-on-surface-variant">
          {members.length} de {allMembers.length} {allMembers.length === 1 ? 'pessoa' : 'pessoas'}
          {filtering && (
            <button
              type="button"
              onClick={() => {
                setSearch('')
                setFilterSector('')
                setFilterSquad('')
                setFilterRole('')
              }}
              className="ml-sm text-primary hover:underline"
            >
              Limpar filtros
            </button>
          )}
        </p>
      </div>

      <div className="flex flex-col gap-sm">
        {filtering && members.length === 0 && (
          <p className="rounded-lg border border-dashed border-outline-variant/50 p-lg text-body-sm text-on-surface-variant">
            Nenhuma pessoa encontrada com esses filtros.
          </p>
        )}
        {groupBySector(members, sectors).map((group) => (
          // Filtrando, os grupos abrem sozinhos — resultado escondido dentro de
          // acordeão fechado parece "não achou nada".
          <SectorAccordion key={group.key} name={group.name} count={group.items.length} forceOpen={filtering}>
            <ul className="flex flex-col gap-2">
              {group.items.map((member) => (
                <CollaboratorRow
                  key={member.id}
                  member={member}
                  sectors={sectors}
                  leaderOptions={leaderOptions}
                  isSubadmin={isSubadmin}
                  canGrantAdminAccess={canGrantAdminAccess}
                  onSave={(id, data) => updateUser.mutate({ id, data })}
                  onToggle={(id, active) => updateUser.mutate({ id, data: { active } })}
                  onSetLeft={(id, leftAt) =>
                    updateUser.mutate({ id, data: leftAt ? { active: false, leftAt } : { active: true, leftAt: null } })
                  }
                  onOpenVacations={setVacationTarget}
                />
              ))}
            </ul>
          </SectorAccordion>
        ))}
      </div>

      {vacationTarget && (
        <VacationDialog user={vacationTarget} vacation={null} onClose={() => setVacationTarget(null)} />
      )}

      {importing && <UserImportDialog onClose={() => setImporting(false)} />}
    </Panel>
  )
}

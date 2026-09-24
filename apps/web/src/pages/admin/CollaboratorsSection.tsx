import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AdminUserDTO, UserRole, Area, SectorDTO, PublicUser } from '@legends/shared'
import {
  canReceiveAdminAccess,
  isSectorAdminOnly,
  viewerAudienceTags,
  USER_ROLES,
  USER_ROLE_LABELS,
  AREAS,
  AREA_LABELS,
} from '@legends/shared'
import { ApiError, apiFetch } from '../../lib/api'
import { downloadCsv, toCsv } from '../../lib/csv'
import { Icon } from '../../components/Icon'
import { Select } from '../../components/Select'
import { PhotoUploadField } from '../../components/PhotoUploadField'
import { VacationDialog } from '../../components/VacationDialog'
import { UserImportDialog } from './UserImportDialog'
import { Panel, inputCls } from './shared'
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

export interface CollaboratorFilters {
  search: string
  sectorId: string
  squad: string
  role: string
  /** Cargo exato, do seletor de coluna. */
  position: string
  /** Id do líder direto. */
  managerId: string
  /** Tag de público-alvo (derivada). */
  tag: string
  /** `'ativo' | 'inativo' | 'desligado'`; vazio = todos. */
  status: string
}

/**
 * Busca livre + filtros por coluna (seção 4.4).
 *
 * A busca cobre os campos que a pessoa usaria para procurar alguém — nome,
 * e-mail, cargo, squad e agora **líder** —, sem diferenciar acento nem caixa.
 * O líder entra pelo nome, e não pelo id: quem procura digita "Ana", não um cuid.
 *
 * CPF não está aqui, e não é esquecimento: `User` não guarda esse campo. Ver a
 * pendência na spec do Documento 3, Lote B.
 */
export function filterCollaborators(
  members: AdminUserDTO[],
  filters: CollaboratorFilters,
  leaderNameById: Map<string, string> = new Map(),
  tagsById: Map<string, string[]> = new Map(),
): AdminUserDTO[] {
  const term = normalize(filters.search.trim())
  return members.filter((member) => {
    if (filters.sectorId && member.sectorId !== filters.sectorId) return false
    if (filters.role && member.role !== filters.role) return false
    if (filters.squad && (member.squad ?? '') !== filters.squad) return false
    if (filters.position && (member.position ?? '') !== filters.position) return false
    if (filters.managerId && (member.managerId ?? '') !== filters.managerId) return false
    if (filters.tag && !(tagsById.get(member.id) ?? []).includes(filters.tag)) return false
    if (filters.status) {
      const status = member.leftAt ? 'desligado' : member.active ? 'ativo' : 'inativo'
      if (status !== filters.status) return false
    }
    if (!term) return true
    const leader = member.managerId ? (leaderNameById.get(member.managerId) ?? '') : ''
    return [member.name, member.email ?? '', member.position ?? '', member.squad ?? '', leader].some(
      (field) => normalize(field).includes(term),
    )
  })
}

// ----- Linha de colaborador (com edição inline) -----
function CollaboratorRow({
  member,
  sectors,
  sectorName,
  leaderName,
  tags,
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
  /** Nome do setor da pessoa — a linha só tem o `sectorId`. */
  sectorName: string
  /** Nome do líder direto, resolvido pelo `managerId`. */
  leaderName: string
  /** Público-alvo derivado (`viewerAudienceTags`), não campo guardado. */
  tags: string[]
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
      <tr>
        <td colSpan={7} className="py-sm">
          <div className="flex flex-col gap-sm rounded-lg border border-primary/40 bg-surface-container-low p-md">
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
          </div>
        </td>
      </tr>
    )
  }

  // Uma linha da TABELA (seção 4.4): a listagem deixou de ser agrupada por setor
  // em acordeão — para achar uma pessoa era preciso adivinhar em qual bloco ela
  // estava. As colunas são as da planilha que a G&G já usa.
  return (
    <tr className="border-b border-outline-variant/20 last:border-0 hover:bg-surface-container-low">
      <td className="py-sm pr-md">
        <span className={member.active ? 'text-on-surface' : 'text-on-surface-variant line-through'}>
          {member.name}
        </span>
        {member.adminAccess && (
          <span className="ml-2 rounded-full bg-tertiary-container px-2 py-0.5 font-label text-label-sm text-on-tertiary-container">
            Acesso admin
          </span>
        )}
        <span className="block truncate text-label-sm text-on-surface-variant">{member.email}</span>
      </td>
      <td className="py-sm pr-md text-body-sm text-on-surface-variant">{sectorName || '—'}</td>
      <td className="py-sm pr-md text-body-sm text-on-surface-variant">{member.position || '—'}</td>
      <td className="py-sm pr-md text-body-sm text-on-surface-variant">{leaderName || '—'}</td>
      <td className="py-sm pr-md">
        <span className="flex flex-wrap gap-xs">
          {tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-surface-container-highest px-sm py-[1px] font-label text-label-sm text-on-surface-variant"
            >
              {tag}
            </span>
          ))}
        </span>
      </td>
      <td className="py-sm pr-md">
        <span
          className={`rounded-full px-sm py-[2px] font-label text-label-sm ${
            member.leftAt
              ? 'bg-outline-variant/30 text-on-surface-variant'
              : member.active
                ? 'bg-primary/15 text-primary'
                : 'bg-error-container/40 text-on-error-container'
          }`}
        >
          {member.leftAt ? 'Desligado' : member.active ? 'Ativo' : 'Inativo'}
        </span>
      </td>
      <td className="py-sm">
        <div className="flex justify-end gap-xs">
          <button
            onClick={() => setEditing(true)}
            className="rounded-md border border-outline-variant/60 px-2 py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
          >
            Editar
          </button>
          <button
            type="button"
            onClick={() => onOpenVacations(member)}
            className="rounded-md border border-outline-variant/60 px-2 py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
          >
            Férias
          </button>
          <button
            onClick={() => onToggle(member.id, !member.active)}
            className="rounded-md border border-outline-variant/60 px-2 py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
          >
            {member.active ? 'Desativar' : 'Ativar'}
          </button>
          <button
            type="button"
            onClick={() =>
              member.leftAt ? onSetLeft(member.id, null) : onSetLeft(member.id, new Date().toISOString())
            }
            className="rounded-md px-2 py-1 font-label text-label-sm text-on-surface-variant hover:text-on-surface"
          >
            {member.leftAt ? 'Readmitir' : 'Desligar'}
          </button>
        </div>
      </td>
    </tr>
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
  const [filterPosition, setFilterPosition] = useState('')
  const [filterManager, setFilterManager] = useState('')
  const [filterTag, setFilterTag] = useState('')
  const [filterStatus, setFilterStatus] = useState('')

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

  const sectorNameById = useMemo(
    () => new Map(sectors.map((sector) => [sector.id, sector.name])),
    [sectors],
  )
  const leaderNameById = useMemo(
    () => new Map(allMembers.map((member) => [member.id, member.name])),
    [allMembers],
  )

  /**
   * Tags de público-alvo por pessoa — **derivadas**, não guardadas.
   *
   * É o mesmo vocabulário que o calendário usa para casar evento com gente
   * (`viewerAudienceTags`): "Todos", o setor, "G&G", "Líder" e "CEO". Uma coluna
   * no banco viraria segunda fonte de verdade e sairia do ar assim que alguém
   * mudasse de setor.
   */
  const tagsById = useMemo(() => {
    const featuresBySector = new Map(sectors.map((sector) => [sector.id, sector.enabledFeatures ?? []]))
    return new Map(
      allMembers.map((member) => [
        member.id,
        viewerAudienceTags({
          role: member.role,
          sectorName: sectorNameById.get(member.sectorId) ?? null,
          sectorFeatures: featuresBySector.get(member.sectorId) ?? [],
          position: member.position,
        }),
      ]),
    )
  }, [allMembers, sectors, sectorNameById])

  const positionOptions = useMemo(() => {
    const names = new Set<string>()
    for (const member of allMembers) if (member.position?.trim()) names.add(member.position)
    return [...names].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [allMembers])

  const tagOptions = useMemo(() => {
    const names = new Set<string>()
    for (const tags of tagsById.values()) for (const tag of tags) names.add(tag)
    return [...names].sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [tagsById])

  const filters: CollaboratorFilters = {
    search,
    sectorId: filterSector,
    squad: filterSquad,
    role: filterRole,
    position: filterPosition,
    managerId: filterManager,
    tag: filterTag,
    status: filterStatus,
  }
  const filtering = Boolean(
    search.trim() ||
      filterSector ||
      filterSquad ||
      filterRole ||
      filterPosition ||
      filterManager ||
      filterTag ||
      filterStatus,
  )
  const members = useMemo(
    () => filterCollaborators(allMembers, filters, leaderNameById, tagsById),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      allMembers,
      search,
      filterSector,
      filterSquad,
      filterRole,
      filterPosition,
      filterManager,
      filterTag,
      filterStatus,
      leaderNameById,
      tagsById,
    ],
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
          <Select
            ariaLabel="Filtrar por cargo"
            value={filterPosition}
            onChange={setFilterPosition}
            options={[{ value: '', label: 'Todos os cargos' }, ...positionOptions.map((c) => ({ value: c, label: c }))]}
          />
          <Select
            ariaLabel="Filtrar por líder"
            value={filterManager}
            onChange={setFilterManager}
            options={[{ value: '', label: 'Todos os líderes' }, ...leaderOptions]}
          />
          <Select
            ariaLabel="Filtrar por tag"
            value={filterTag}
            onChange={setFilterTag}
            options={[{ value: '', label: 'Todas as tags' }, ...tagOptions.map((t) => ({ value: t, label: t }))]}
          />
          <Select
            ariaLabel="Filtrar por status"
            value={filterStatus}
            onChange={setFilterStatus}
            options={[
              { value: '', label: 'Todos os status' },
              { value: 'ativo', label: 'Ativo' },
              { value: 'inativo', label: 'Inativo' },
              { value: 'desligado', label: 'Desligado' },
            ]}
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
                setFilterPosition('')
                setFilterManager('')
                setFilterTag('')
                setFilterStatus('')
              }}
              className="ml-sm text-primary hover:underline"
            >
              Limpar filtros
            </button>
          )}
        </p>
      </div>

      {/* Uma linha por pessoa, e não acordeão por setor (seção 4.4): para
          consultar alguém era preciso saber de antemão em qual setor procurar.
          `overflow-x-auto` porque sete colunas não cabem em tela estreita — o
          que rola é a tabela, nunca a página. */}
      <div className="overflow-x-auto">
        {members.length === 0 ? (
          <p className="rounded-lg border border-dashed border-outline-variant/50 p-lg text-body-sm text-on-surface-variant">
            {filtering ? 'Nenhuma pessoa encontrada com esses filtros.' : 'Nenhuma pessoa cadastrada ainda.'}
          </p>
        ) : (
          <table className="w-full min-w-[64rem] border-collapse text-left">
            <thead>
              <tr className="border-b border-outline-variant/40 font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
                <th className="py-sm pr-md font-normal">Nome</th>
                <th className="py-sm pr-md font-normal">Setor</th>
                <th className="py-sm pr-md font-normal">Cargo</th>
                <th className="py-sm pr-md font-normal">Líder</th>
                <th className="py-sm pr-md font-normal">Tags</th>
                <th className="py-sm pr-md font-normal">Status</th>
                <th className="py-sm text-right font-normal">Ações</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <CollaboratorRow
                  key={member.id}
                  member={member}
                  sectors={sectors}
                  sectorName={sectorNameById.get(member.sectorId) ?? ''}
                  leaderName={member.managerId ? (leaderNameById.get(member.managerId) ?? '') : ''}
                  tags={tagsById.get(member.id) ?? []}
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
            </tbody>
          </table>
        )}
      </div>

      {vacationTarget && (
        <VacationDialog user={vacationTarget} vacation={null} onClose={() => setVacationTarget(null)} />
      )}

      {importing && <UserImportDialog onClose={() => setImporting(false)} />}
    </Panel>
  )
}

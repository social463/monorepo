import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AdminUserDTO, UserRole, SectorDTO } from '@legends/shared'
import { USER_ROLE_LABELS } from '@legends/shared'
import { ApiError, apiFetch } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { Select } from '../../components/Select'
import { Panel, inputCls, groupBySector, SectorAccordion } from './shared'

const ADMIN_ROLES: UserRole[] = ['ADMIN', 'SUBADMIN']

interface AdminFormState {
  name: string
  email: string
  password: string
  role: UserRole
  sectorId: string
}

const emptyAdminForm: AdminFormState = {
  name: '',
  email: '',
  password: '',
  role: 'SUBADMIN',
  sectorId: '',
}

// ----- Linha de administrador (com edição inline) -----
function AdministratorRow({
  member,
  sectors,
  onSave,
  onToggle,
}: {
  member: AdminUserDTO
  sectors: SectorDTO[]
  onSave: (id: string, data: { name: string; email: string; role: UserRole; sectorId: string; active: boolean; password?: string }) => void
  onToggle: (id: string, active: boolean) => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(member.name)
  const [email, setEmail] = useState(member.email)
  const [role, setRole] = useState<UserRole>(member.role)
  const [sectorId, setSectorId] = useState(member.sectorId)
  const [active, setActive] = useState(member.active)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setEditing(false)
    setName(member.name)
    setEmail(member.email)
    setRole(member.role)
    setSectorId(member.sectorId)
    setActive(member.active)
    setPassword('')
    setError(null)
  }

  function handleSave() {
    const trimmedPassword = password.trim()
    if (!name.trim() || !email.trim()) {
      setError('Nome e e-mail são obrigatórios.')
      return
    }
    if (trimmedPassword && trimmedPassword.length < 8) {
      setError('A nova senha deve ter pelo menos 8 caracteres.')
      return
    }
    if (role === 'SUBADMIN' && !sectorId) {
      setError('Subadmin precisa estar vinculado a um setor.')
      return
    }

    onSave(member.id, {
      name: name.trim(),
      email: email.trim(),
      role,
      sectorId,
      active,
      password: trimmedPassword || undefined,
    })
    reset()
  }

  const sectorName = sectors.find((s) => s.id === member.sectorId)?.name ?? 'Sem setor'

  if (editing) {
    return (
      <li className="flex flex-col gap-sm rounded-lg border border-primary/40 bg-surface-container-low p-md">
        <div className="grid gap-sm sm:grid-cols-2">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} aria-label={`Nome de ${member.name}`} placeholder="Nome" />
          <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} aria-label={`E-mail de ${member.name}`} placeholder="E-mail" type="email" />
          <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            Papel
            <Select
              ariaLabel={`Papel de ${member.name}`}
              value={role}
              onChange={(value) => setRole(value as UserRole)}
              options={ADMIN_ROLES.map((r) => ({ value: r, label: USER_ROLE_LABELS[r] }))}
            />
          </label>
          <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            Setor
            <Select
              ariaLabel={`Setor de ${member.name}`}
              value={sectorId}
              onChange={setSectorId}
              options={[{ value: '', label: 'Sem setor' }, ...sectors.map((s) => ({ value: s.id, label: s.name }))]}
            />
          </label>
          <input className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} aria-label={`Nova senha de ${member.name}`} placeholder="Nova senha (deixe em branco para manter)" type="password" autoComplete="new-password" />
        </div>
        <label className="flex items-center gap-sm font-label text-label-sm text-on-surface-variant">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} aria-label={`Ativo — ${member.name}`} />
          Ativo
        </label>
        {error && (
          <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
            <Icon name="error" className="text-[16px]" />
            {error}
          </p>
        )}
        <div className="flex gap-sm">
          <button
            type="button"
            onClick={handleSave}
            className="rounded-md bg-primary px-md py-1 font-label text-label-sm font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container"
          >
            Salvar
          </button>
          <button
            type="button"
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
    <li className="flex flex-wrap items-center justify-between gap-md rounded-lg border border-outline-variant/20 bg-surface-container-low p-md">
      <span className={member.active ? 'text-on-surface' : 'text-on-surface-variant line-through'}>
        {member.name}
        <span className="ml-2 font-label text-label-sm text-on-surface-variant">
          {USER_ROLE_LABELS[member.role]} · {member.role === 'ADMIN' ? 'Global' : sectorName}
        </span>
        <span className="ml-2 font-label text-label-sm text-on-surface-variant">{member.email}</span>
      </span>
      <div className="flex shrink-0 gap-sm">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
        >
          Editar
        </button>
        <button
          type="button"
          onClick={() => onToggle(member.id, !member.active)}
          className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary"
        >
          {member.active ? 'Desativar' : 'Ativar'}
        </button>
      </div>
    </li>
  )
}

export function AdministratorsSection() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<AdminFormState>(emptyAdminForm)
  const [showForm, setShowForm] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)

  const administratorsQuery = useQuery({
    queryKey: ['admin', 'administrators'],
    queryFn: () => apiFetch<{ users: AdminUserDTO[] }>('/admin/administrators'),
  })
  const sectorsQuery = useQuery({
    queryKey: ['admin', 'sectors'],
    queryFn: () => apiFetch<{ sectors: SectorDTO[] }>('/admin/sectors'),
  })
  const sectors = sectorsQuery.data?.sectors ?? []
  const invalidateAdministrators = () => queryClient.invalidateQueries({ queryKey: ['admin', 'administrators'] })
  const createUser = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch<{ user: AdminUserDTO }>('/admin/users', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setForm(emptyAdminForm)
      setShowForm(false)
      setFormError(null)
      invalidateAdministrators()
    },
    onError: (err) => setFormError(err instanceof ApiError ? err.message : 'Erro ao criar administrador.'),
  })
  const updateUser = useMutation({
    mutationFn: (vars: { id: string; data: Record<string, unknown> }) =>
      apiFetch<{ user: AdminUserDTO }>(`/admin/users/${vars.id}`, { method: 'PATCH', body: JSON.stringify(vars.data) }),
    onSuccess: () => {
      setUpdateError(null)
      invalidateAdministrators()
    },
    onError: (err) => setUpdateError(err instanceof ApiError ? err.message : 'Erro ao atualizar administrador.'),
  })

  // A rota devolve as duas coisas numa lista só — quem administra pelo PAPEL e
  // quem administra pelo acesso delegado. São públicos diferentes: os primeiros
  // se editam aqui, os segundos são colaboradores e só se revogam.
  const everyone = administratorsQuery.data?.users ?? []
  const accounts = everyone.filter((u) => u.role === 'ADMIN' || u.role === 'SUBADMIN')
  const delegated = everyone.filter((u) => u.adminAccess && u.role !== 'ADMIN' && u.role !== 'SUBADMIN')

  function handleCreate(event: FormEvent) {
    event.preventDefault()
    if (!form.name.trim() || !form.email.trim() || form.password.length < 8) {
      setFormError('Nome, e-mail e senha (mín. 8 caracteres) são obrigatórios.')
      return
    }
    if (form.role === 'SUBADMIN' && !form.sectorId) {
      setFormError('Subadmin precisa estar vinculado a um setor.')
      return
    }
    createUser.mutate({
      name: form.name.trim(),
      email: form.email.trim(),
      password: form.password,
      role: form.role,
      sectorId: form.sectorId || undefined,
    })
  }

  return (
    <Panel
      title="Administradores"
      action={
        <button
          type="button"
          onClick={() => {
            setShowForm((v) => !v)
            setFormError(null)
          }}
          className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
        >
          {showForm ? 'Cancelar' : '+ Adicionar admin'}
        </button>
      }
    >
      {showForm && (
        <form onSubmit={handleCreate} className="mb-lg flex flex-col gap-sm rounded-lg border border-outline-variant/30 bg-surface-container-low p-md">
          <p className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">Adicionar conta de gestão</p>
          <div className="grid gap-sm sm:grid-cols-2">
            <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Nome" placeholder="Nome" />
            <input className={inputCls} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} aria-label="E-mail" placeholder="E-mail" type="email" />
            <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
              Papel
              <Select
                ariaLabel="Papel"
                value={form.role}
                onChange={(value) => setForm({ ...form, role: value as UserRole })}
                options={ADMIN_ROLES.map((r) => ({ value: r, label: USER_ROLE_LABELS[r] }))}
              />
            </label>
            <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
              Setor
              <Select
                ariaLabel="Setor"
                value={form.sectorId}
                onChange={(value) => setForm({ ...form, sectorId: value })}
                options={[{ value: '', label: 'Sem setor' }, ...sectors.map((s) => ({ value: s.id, label: s.name }))]}
              />
            </label>
            <input className={inputCls} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} aria-label="Senha provisória" placeholder="Senha provisória (mín. 8)" type="password" />
          </div>
          {formError && (
            <p role="alert" className="flex items-center gap-sm text-body-sm text-error">
              <Icon name="error" className="text-[16px]" />
              {formError}
            </p>
          )}
          <div>
            <button type="submit" className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container">
              Criar conta
            </button>
          </div>
        </form>
      )}

      {updateError && (
        <p role="alert" className="mb-md flex items-center gap-sm text-body-sm text-error">
          <Icon name="error" className="text-[16px]" />
          {updateError}
        </p>
      )}

      {administratorsQuery.isLoading || sectorsQuery.isLoading ? (
        <p className="text-body-sm text-on-surface-variant">Carregando administradores...</p>
      ) : (
        <div className="flex flex-col gap-sm">
          {groupBySector(accounts, sectors).map((group) => (
            <SectorAccordion key={group.key} name={group.name} count={group.items.length}>
              <ul className="flex flex-col gap-2">
                {group.items.map((member) => (
                  <AdministratorRow
                    key={member.id}
                    member={member}
                    sectors={sectors}
                    onSave={(id, data) => updateUser.mutate({ id, data })}
                    onToggle={(id, active) => updateUser.mutate({ id, data: { active } })}
                  />
                ))}
              </ul>
            </SectorAccordion>
          ))}

          {/* Colaboradores com acesso delegado ficam à parte: eles não são contas
              de gestão — continuam no time, com o papel deles — e o que se faz
              aqui é revogar. Editar nome, papel ou senha é na ficha do
              colaborador, em Administração › Colaboradores. */}
          {delegated.length > 0 && (
            <section className="mt-lg flex flex-col gap-sm">
              <div>
                <h4 className="font-label text-label-lg text-on-surface">Acesso administrativo delegado</h4>
                <p className="font-body text-body-sm text-on-surface-variant">
                  Colaboradores que administram a plataforma sem deixar de ser do time. O cadastro
                  deles fica em Colaboradores; aqui só se revoga o acesso.
                </p>
              </div>
              <ul className="flex flex-col gap-2">
                {delegated.map((member) => (
                  <li
                    key={member.id}
                    className="flex flex-wrap items-center justify-between gap-md rounded-lg border border-outline-variant/20 bg-surface-container-low p-md"
                  >
                    <span className={member.active ? 'text-on-surface' : 'text-on-surface-variant line-through'}>
                      {member.name}
                      <span className="ml-2 font-label text-label-sm text-on-surface-variant">
                        {USER_ROLE_LABELS[member.role]} ·{' '}
                        {sectors.find((s) => s.id === member.sectorId)?.name ?? 'Sem setor'}
                      </span>
                      <span className="ml-2 font-label text-label-sm text-on-surface-variant">{member.email}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => updateUser.mutate({ id: member.id, data: { adminAccess: false } })}
                      className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-error hover:text-error"
                    >
                      Revogar acesso
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </Panel>
  )
}

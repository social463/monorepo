import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import type {
  CompanyAdminDTO,
  CompanyDashboardDTO,
  CreateCompanyAdminRequest,
  UpdateCompanyAdminRequest,
} from '@legends/shared'
import { ApiError, apiFetch } from '../lib/api'
import { Icon } from '../components/Icon'
import { Panel, errorMessage, inputCls } from './admin/shared'
import { BrandingSection } from './super-admin/BrandingSection'
import {
  ErrorBanner,
  StatCard,
  StatusChip,
  dangerBtn,
  ghostBtn,
  ghostBtnLg,
  primaryBtn,
} from './super-admin/shared'

interface AdminFormState {
  name: string
  email: string
  password: string
}

const emptyAdminForm: AdminFormState = { name: '', email: '', password: '' }

// ----- Linha de administrador (com edição inline) -----
function AdminRow({
  admin,
  onSave,
  onRemove,
  onRestore,
}: {
  admin: CompanyAdminDTO
  onSave: (userId: string, data: UpdateCompanyAdminRequest) => void
  onRemove: (userId: string) => void
  onRestore: (userId: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(admin.name)
  const [email, setEmail] = useState(admin.email)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmingRemove, setConfirmingRemove] = useState(false)

  function reset() {
    setEditing(false)
    setName(admin.name)
    setEmail(admin.email)
    setPassword('')
    setError(null)
  }

  function handleSave() {
    if (!name.trim() || !email.trim()) {
      setError('Nome e e-mail são obrigatórios.')
      return
    }
    if (password && password.length < 8) {
      setError('A senha nova precisa de pelo menos 8 caracteres.')
      return
    }
    // Só manda o que mudou: um PATCH com o mesmo e-mail passaria pelo índice
    // único, mas `password: ''` viraria uma troca de senha silenciosa.
    const data: UpdateCompanyAdminRequest = {}
    if (name.trim() !== admin.name) data.name = name.trim()
    if (email.trim() !== admin.email) data.email = email.trim()
    if (password) data.password = password
    if (Object.keys(data).length === 0) {
      reset()
      return
    }
    onSave(admin.id, data)
    setEditing(false)
    setPassword('')
  }

  return (
    <li
      className={`flex flex-col gap-md rounded-xl border bg-surface-container-low p-md transition-colors ${
        editing ? 'border-primary/40' : 'border-outline-variant/20'
      }`}
    >
      {/* Igual à linha de empresa: a identidade não some enquanto se edita. */}
      <div className="flex items-center justify-between gap-md">
        <span className="flex min-w-0 items-center gap-md">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-outline-variant/40 bg-surface-container-highest font-label text-label-md font-bold text-primary">
            {admin.name.trim().charAt(0).toUpperCase() || '—'}
          </span>
          <span className="flex min-w-0 flex-col gap-[2px]">
            <span className="flex items-center gap-sm">
              <span className={`truncate font-label text-title-sm ${admin.active ? 'text-on-surface' : 'text-on-surface-variant'}`}>
                {admin.name}
              </span>
              {!admin.active && <StatusChip active={false} labels={['Ativo', 'Removido']} />}
            </span>
            <span className="truncate font-label text-label-sm text-on-surface-variant">{admin.email}</span>
          </span>
        </span>

        {!editing && (
          <div className="flex shrink-0 items-center gap-sm">
            {admin.active ? (
              confirmingRemove ? (
                <>
                  <span className="font-label text-label-sm text-on-surface-variant">Remover acesso?</span>
                  <button
                    type="button"
                    onClick={() => { setConfirmingRemove(false); onRemove(admin.id) }}
                    className="rounded-md border border-error/60 px-3 py-1 font-label text-label-sm text-error transition-colors hover:bg-error/10"
                  >
                    Confirmar
                  </button>
                  <button type="button" onClick={() => setConfirmingRemove(false)} className={ghostBtn}>
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  <button type="button" onClick={() => setEditing(true)} className={ghostBtn}>
                    Editar
                  </button>
                  <button type="button" onClick={() => setConfirmingRemove(true)} className={dangerBtn}>
                    Remover
                  </button>
                </>
              )
            ) : (
              <button type="button" onClick={() => onRestore(admin.id)} className={ghostBtn}>
                Reativar
              </button>
            )}
          </div>
        )}
      </div>

      {editing && (
        <div className="flex flex-col gap-sm border-t border-outline-variant/20 pt-md">
          <div className="grid gap-sm sm:grid-cols-2">
            <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
              Nome
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} aria-label="Nome do admin" />
            </label>
            <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
              E-mail
              <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} aria-label="E-mail do admin" type="email" />
            </label>
            <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant sm:col-span-2">
              Nova senha
              <input
                className={inputCls}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-label="Nova senha do admin"
                placeholder="Deixe em branco para manter a atual"
                type="password"
                autoComplete="new-password"
              />
            </label>
          </div>
          {error && <ErrorBanner message={error} />}
          <div className="flex gap-sm">
            <button type="button" onClick={handleSave} className={primaryBtn}>
              Salvar
            </button>
            <button type="button" onClick={reset} className={ghostBtnLg}>
              Cancelar
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

/**
 * Contas ADMIN da empresa. "Remover" desativa o acesso (a API não apaga a
 * linha), então a conta reaparece aqui como inativa e pode voltar em um clique.
 */
function CompanyAdminsPanel({ companyId }: { companyId: string }) {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<AdminFormState>(emptyAdminForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  const queryKey = ['super-admin', 'companies', companyId, 'admins']
  const adminsQuery = useQuery({
    queryKey,
    queryFn: () => apiFetch<{ admins: CompanyAdminDTO[] }>(`/super-admin/companies/${companyId}/admins`),
  })
  // O card de usuários vem do dashboard; um admin novo muda esse total.
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey })
    void queryClient.invalidateQueries({ queryKey: ['super-admin', 'companies', companyId, 'dashboard'] })
  }

  const createAdmin = useMutation({
    mutationFn: (body: CreateCompanyAdminRequest) =>
      apiFetch<{ admin: CompanyAdminDTO }>(`/super-admin/companies/${companyId}/admins`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setForm(emptyAdminForm)
      setShowForm(false)
      setFormError(null)
      invalidate()
    },
    onError: (err) => setFormError(errorMessage(err, 'Erro ao criar o administrador.')),
  })

  const updateAdmin = useMutation({
    mutationFn: (vars: { userId: string; data: UpdateCompanyAdminRequest }) =>
      apiFetch<{ admin: CompanyAdminDTO }>(`/super-admin/companies/${companyId}/admins/${vars.userId}`, {
        method: 'PATCH',
        body: JSON.stringify(vars.data),
      }),
    onSuccess: () => {
      setListError(null)
      invalidate()
    },
    onError: (err) => setListError(errorMessage(err, 'Erro ao atualizar o administrador.')),
  })

  const removeAdmin = useMutation({
    mutationFn: (userId: string) =>
      apiFetch<void>(`/super-admin/companies/${companyId}/admins/${userId}`, { method: 'DELETE' }),
    onSuccess: () => {
      setListError(null)
      invalidate()
    },
    onError: (err) => setListError(errorMessage(err, 'Erro ao remover o administrador.')),
  })

  function handleCreate(event: FormEvent) {
    event.preventDefault()
    if (!form.name.trim() || !form.email.trim() || form.password.length < 8) {
      setFormError('Nome, e-mail e senha (mín. 8 caracteres) são obrigatórios.')
      return
    }
    createAdmin.mutate({ name: form.name.trim(), email: form.email.trim(), password: form.password })
  }

  return (
    <Panel
      title="Administradores"
      action={
        <button
          type="button"
          onClick={() => { setShowForm((v) => !v); setFormError(null) }}
          className={showForm ? ghostBtnLg : primaryBtn}
        >
          {showForm ? 'Cancelar' : '+ Novo admin'}
        </button>
      }
    >
      {showForm && (
        <form onSubmit={handleCreate} className="mb-lg flex flex-col gap-sm rounded-xl border border-primary/40 bg-surface-container-low p-md">
          <p className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">Novo administrador</p>
          <div className="grid gap-sm sm:grid-cols-2">
            <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Nome do novo admin" placeholder="Nome" />
            <input className={inputCls} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} aria-label="E-mail do novo admin" placeholder="E-mail" type="email" />
            <input className={inputCls} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} aria-label="Senha do novo admin" placeholder="Senha provisória (mín. 8)" type="password" />
          </div>
          {formError && <ErrorBanner message={formError} />}
          <div>
            <button type="submit" className={primaryBtn}>
              Criar administrador
            </button>
          </div>
        </form>
      )}

      {listError && <div className="mb-md"><ErrorBanner message={listError} /></div>}

      {adminsQuery.isLoading ? (
        <p className="text-body-sm text-on-surface-variant">Carregando administradores...</p>
      ) : (adminsQuery.data?.admins ?? []).length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">Nenhum administrador cadastrado.</p>
      ) : (
        <ul className="flex flex-col gap-sm">
          {(adminsQuery.data?.admins ?? []).map((admin) => (
            <AdminRow
              key={admin.id}
              admin={admin}
              onSave={(userId, data) => updateAdmin.mutate({ userId, data })}
              onRemove={(userId) => removeAdmin.mutate(userId)}
              onRestore={(userId) => updateAdmin.mutate({ userId, data: { active: true } })}
            />
          ))}
        </ul>
      )}
    </Panel>
  )
}

export function CompanyDashboardPage() {
  const { id = '' } = useParams()

  const dashboardQuery = useQuery({
    queryKey: ['super-admin', 'companies', id, 'dashboard'],
    queryFn: () => apiFetch<CompanyDashboardDTO>(`/super-admin/companies/${id}/dashboard`),
  })

  // Mesma chave do painel de administradores: o React Query serve as duas
  // leituras com uma requisição só, e o card de admins acompanha a lista.
  const adminsQuery = useQuery({
    queryKey: ['super-admin', 'companies', id, 'admins'],
    queryFn: () => apiFetch<{ admins: CompanyAdminDTO[] }>(`/super-admin/companies/${id}/admins`),
    enabled: Boolean(id),
  })

  if (dashboardQuery.isLoading) {
    return <p className="text-body-sm text-on-surface-variant">Carregando...</p>
  }

  if (dashboardQuery.isError) {
    const message =
      dashboardQuery.error instanceof ApiError ? dashboardQuery.error.message : 'Erro ao carregar a empresa.'
    return (
      <>
        <p className="text-body-sm text-error">{message}</p>
        <Link to="/super-admin" className="mt-md inline-block font-label text-label-sm text-primary hover:underline">
          ← Voltar para as empresas
        </Link>
      </>
    )
  }

  const { company, totalUsers, sectorBreakdown } = dashboardQuery.data!
  const activeAdmins = (adminsQuery.data?.admins ?? []).filter((a) => a.active).length

  return (
    <>
      <nav aria-label="Você está aqui" className="mb-md flex items-center gap-xs font-label text-label-sm">
        <Link to="/super-admin" className="text-primary hover:underline">
          Empresas
        </Link>
        <Icon name="chevron_right" className="text-[16px] text-on-surface-variant" />
        <span className="text-on-surface-variant">{company.name}</span>
      </nav>

      <header className="mb-lg flex flex-wrap items-center justify-between gap-md">
        <div className="flex min-w-0 flex-col gap-[2px]">
          <div className="flex items-center gap-sm">
            <h1 className="truncate font-headline text-headline-lg text-on-surface">{company.name}</h1>
            <StatusChip active={company.active} />
          </div>
          <p className="font-label text-label-sm text-on-surface-variant">
            {company.slug} · criada em {new Date(company.createdAt).toLocaleDateString('pt-BR')}
          </p>
        </div>
      </header>

      <div className="mb-lg grid gap-md sm:grid-cols-3">
        <StatCard label="Usuários ativos" value={totalUsers} icon="group" />
        <StatCard label="Setores" value={sectorBreakdown.length} icon="account_tree" />
        <StatCard label="Administradores ativos" value={adminsQuery.isLoading ? '—' : activeAdmins} icon="shield_person" />
      </div>

      <div className="mb-lg">
        <Panel title="Usuários por setor">
          {sectorBreakdown.length === 0 ? (
            <p className="text-body-sm text-on-surface-variant">Nenhum setor cadastrado.</p>
          ) : (
            <ul className="flex flex-col gap-sm">
              {sectorBreakdown.map((sector) => (
                <li
                  key={sector.sectorId}
                  className="flex items-center justify-between rounded-lg border border-outline-variant/20 bg-surface-container-low px-md py-sm"
                >
                  <span className="truncate text-body-sm text-on-surface">{sector.sectorName}</span>
                  <span className="shrink-0 font-label text-label-sm text-on-surface-variant">
                    {sector.userCount} {sector.userCount === 1 ? 'usuário' : 'usuários'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* Agrupados com o mesmo `lg` que separa os blocos acima: os dois painéis
          nasciam colados porque nenhum dos dois trazia margem própria. */}
      <div className="flex flex-col gap-lg">
        <CompanyAdminsPanel companyId={company.id} />

        {/* Marca do cliente: identidade faz parte do que o fornecedor entrega. */}
        <BrandingSection companyId={company.id} />
      </div>
    </>
  )
}

import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import type { CompanyDTO, PublicUser, UpdateCompanyRequest } from '@legends/shared'
import type { CompanyDashboardDTO } from '@legends/shared'
import { apiFetch } from '../lib/api'
import { Panel, errorMessage, inputCls } from './admin/shared'
import {
  CompanyMonogram,
  ErrorBanner,
  StatusChip,
  dangerBtn,
  ghostBtn,
  ghostBtnLg,
  primaryBtn,
} from './super-admin/shared'

interface CreateCompanyForm {
  name: string
  adminName: string
  adminEmail: string
  adminPassword: string
}

const emptyForm: CreateCompanyForm = { name: '', adminName: '', adminEmail: '', adminPassword: '' }

/** Linha de resumo da empresa: slug + números que só o dashboard sabe. */
function CompanyStats({ company }: { company: CompanyDTO }) {
  const dashboardQuery = useQuery({
    queryKey: ['super-admin', 'companies', company.id, 'dashboard'],
    queryFn: () => apiFetch<CompanyDashboardDTO>(`/super-admin/companies/${company.id}/dashboard`),
  })
  const data = dashboardQuery.data
  const parts = [company.slug]
  if (data) {
    parts.push(`${data.totalUsers} ${data.totalUsers === 1 ? 'usuário' : 'usuários'}`)
    parts.push(`${data.sectorBreakdown.length} ${data.sectorBreakdown.length === 1 ? 'setor' : 'setores'}`)
  }
  return <span className="truncate font-label text-label-sm text-on-surface-variant">{parts.join(' · ')}</span>
}

// ----- Linha de empresa (com edição inline) -----
function CompanyRow({
  company,
  onSave,
  onToggle,
}: {
  company: CompanyDTO
  onSave: (id: string, data: UpdateCompanyRequest) => void
  onToggle: (id: string, active: boolean) => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(company.name)
  const [error, setError] = useState<string | null>(null)
  const [confirmingOff, setConfirmingOff] = useState(false)

  function reset() {
    setEditing(false)
    setName(company.name)
    setError(null)
  }

  function handleSave() {
    if (!name.trim()) {
      setError('O nome da empresa é obrigatório.')
      return
    }
    onSave(company.id, { name: name.trim() })
    setEditing(false)
  }

  return (
    <li
      className={`flex flex-col gap-md rounded-xl border bg-surface-container-low p-md transition-colors ${
        editing ? 'border-primary/40' : 'border-outline-variant/20'
      }`}
    >
      {/* O cabeçalho fica de pé mesmo em edição: sem ele a empresa some da lista
          enquanto o formulário está aberto, e com ela o link para o detalhe. */}
      <div className="flex items-center justify-between gap-md">
        <span className="flex min-w-0 items-center gap-md">
          <CompanyMonogram name={company.name} />
          <span className="flex min-w-0 flex-col gap-[2px]">
            <span className="flex items-center gap-sm">
              <Link
                to={`/super-admin/companies/${company.id}`}
                className={`truncate font-headline text-title-lg hover:underline ${
                  company.active ? 'text-on-surface' : 'text-on-surface-variant'
                }`}
              >
                {company.name}
              </Link>
              <StatusChip active={company.active} />
            </span>
            <CompanyStats company={company} />
          </span>
        </span>

        {!editing && (
          <div className="flex shrink-0 items-center gap-sm">
            {confirmingOff ? (
              <>
                <span className="font-label text-label-sm text-on-surface-variant">Desativar?</span>
                <button
                  type="button"
                  onClick={() => { setConfirmingOff(false); onToggle(company.id, false) }}
                  className="rounded-md border border-error/60 px-3 py-1 font-label text-label-sm text-error transition-colors hover:bg-error/10"
                >
                  Confirmar
                </button>
                <button type="button" onClick={() => setConfirmingOff(false)} className={ghostBtn}>
                  Cancelar
                </button>
              </>
            ) : (
              <>
                <Link to={`/super-admin/companies/${company.id}`} className={ghostBtn}>
                  Abrir
                </Link>
                <button type="button" onClick={() => setEditing(true)} className={ghostBtn}>
                  Editar
                </button>
                {company.active ? (
                  <button type="button" onClick={() => setConfirmingOff(true)} className={dangerBtn}>
                    Desativar
                  </button>
                ) : (
                  <button type="button" onClick={() => onToggle(company.id, true)} className={ghostBtn}>
                    Ativar
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {editing && (
        <div className="flex flex-col gap-sm border-t border-outline-variant/20 pt-md">
          <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            Nome da empresa
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} aria-label="Nome da empresa" />
          </label>
          <p className="font-label text-label-sm text-on-surface-variant">
            O slug é recalculado a partir do nome. Ativar/desativar fica nos botões da linha.
          </p>
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

export function SuperAdminPage() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<CreateCompanyForm>(emptyForm)
  const [showForm, setShowForm] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [updateError, setUpdateError] = useState<string | null>(null)

  const companiesQuery = useQuery({
    queryKey: ['super-admin', 'companies'],
    queryFn: () => apiFetch<{ companies: CompanyDTO[] }>('/super-admin/companies'),
  })
  const invalidateCompanies = () => queryClient.invalidateQueries({ queryKey: ['super-admin', 'companies'] })

  const createCompany = useMutation({
    mutationFn: (body: { name: string; admin: { name: string; email: string; password: string } }) =>
      apiFetch<{ company: CompanyDTO; admin: PublicUser }>('/super-admin/companies', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setForm(emptyForm)
      setShowForm(false)
      setFormError(null)
      invalidateCompanies()
    },
    onError: (err) => setFormError(errorMessage(err, 'Erro ao criar empresa.')),
  })

  const updateCompany = useMutation({
    mutationFn: (vars: { id: string; data: UpdateCompanyRequest }) =>
      apiFetch<{ company: CompanyDTO }>(`/super-admin/companies/${vars.id}`, {
        method: 'PATCH',
        body: JSON.stringify(vars.data),
      }),
    onSuccess: () => {
      setUpdateError(null)
      invalidateCompanies()
    },
    onError: (err) => setUpdateError(errorMessage(err, 'Erro ao atualizar empresa.')),
  })

  function handleCreate(event: FormEvent) {
    event.preventDefault()
    if (!form.name.trim() || !form.adminName.trim() || !form.adminEmail.trim() || form.adminPassword.length < 8) {
      setFormError('Nome da empresa, nome, e-mail e senha (mín. 8 caracteres) do admin são obrigatórios.')
      return
    }
    createCompany.mutate({
      name: form.name.trim(),
      admin: { name: form.adminName.trim(), email: form.adminEmail.trim(), password: form.adminPassword },
    })
  }

  const companies = companiesQuery.data?.companies ?? []

  return (
    <>
      <header className="mb-lg">
        <h1 className="font-headline text-headline-lg text-on-surface">Empresas</h1>
        <p className="mt-xs text-body-sm text-on-surface-variant">
          Cada empresa é um tenant isolado, com setores, usuários e administradores próprios.
        </p>
      </header>

      <Panel
        title="Empresas cadastradas"
        action={
          <button
            type="button"
            onClick={() => { setShowForm((v) => !v); setFormError(null) }}
            className={showForm ? ghostBtnLg : primaryBtn}
          >
            {showForm ? 'Cancelar' : '+ Nova empresa'}
          </button>
        }
      >
        {showForm && (
          <form onSubmit={handleCreate} className="mb-lg flex flex-col gap-sm rounded-xl border border-primary/40 bg-surface-container-low p-md">
            <p className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">Nova empresa</p>
            <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Nome da empresa" placeholder="Nome da empresa" />
            <p className="mt-sm font-label text-label-sm uppercase tracking-wide text-on-surface-variant">Primeiro administrador</p>
            <div className="grid gap-sm sm:grid-cols-2">
              <input className={inputCls} value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} aria-label="Nome do admin" placeholder="Nome do primeiro admin" />
              <input className={inputCls} value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} aria-label="E-mail do admin" placeholder="E-mail do primeiro admin" type="email" />
              <input className={inputCls} value={form.adminPassword} onChange={(e) => setForm({ ...form, adminPassword: e.target.value })} aria-label="Senha do admin" placeholder="Senha provisória (mín. 8)" type="password" />
            </div>
            {formError && <ErrorBanner message={formError} />}
            <div>
              <button type="submit" className={primaryBtn}>
                Criar empresa
              </button>
            </div>
          </form>
        )}

        {updateError && <div className="mb-md"><ErrorBanner message={updateError} /></div>}

        {companiesQuery.isLoading ? (
          <p className="text-body-sm text-on-surface-variant">Carregando empresas...</p>
        ) : companies.length === 0 ? (
          <p className="text-body-sm text-on-surface-variant">Nenhuma empresa cadastrada.</p>
        ) : (
          <ul className="flex flex-col gap-sm">
            {companies.map((company) => (
              <CompanyRow
                key={company.id}
                company={company}
                onSave={(id, data) => updateCompany.mutate({ id, data })}
                onToggle={(id, active) => updateCompany.mutate({ id, data: { active } })}
              />
            ))}
          </ul>
        )}
      </Panel>
    </>
  )
}

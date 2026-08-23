import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  HR_DASHBOARD_DEFAULT_HEIGHT,
  HR_DASHBOARD_MAX_HEIGHT,
  HR_DASHBOARD_MIN_HEIGHT,
  HR_DASHBOARD_SCOPE_ALL,
  HR_DASHBOARD_SCOPE_COMPANY,
  type CreateHrDashboardRequest,
  type HrDashboardDTO,
  type HrDashboardListResponse,
  type SectorDTO,
  isFullAdmin,} from '@legends/shared'
import { apiFetch } from '../../lib/api'
import { useAuth } from '../../auth/AuthContext'
import { Panel, inputCls } from './shared'

interface FormState {
  title: string
  description: string
  embedUrl: string
  height: number
  sortOrder: number
  sectorId: string
}

const EMPTY_FORM: FormState = {
  title: '',
  description: '',
  embedUrl: '',
  height: HR_DASHBOARD_DEFAULT_HEIGHT,
  sortOrder: 0,
  sectorId: '',
}

function toRequest(form: FormState, isAdmin: boolean): CreateHrDashboardRequest {
  return {
    title: form.title.trim(),
    description: form.description.trim() === '' ? null : form.description.trim(),
    embedUrl: form.embedUrl.trim(),
    height: form.height,
    sortOrder: form.sortOrder,
    // O SUBADMIN não escolhe escopo: o backend força o setor dele.
    ...(isAdmin ? { sectorId: form.sectorId === '' ? null : form.sectorId } : {}),
  }
}

/**
 * Painéis externos de BI embutidos na administração. A URL nunca é validada
 * aqui: quem decide o que pode virar `src` de iframe é o backend, contra a
 * allowlist de hosts — a lista só aparece na tela como dica.
 */
export function HrDashboardsSection() {
  const { user } = useAuth()
  const isAdmin = isFullAdmin(user)
  const queryClient = useQueryClient()
  const [scope, setScope] = useState<string>(HR_DASHBOARD_SCOPE_ALL)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const listKey = ['admin', 'hr-dashboards', scope] as const
  const { data, isLoading } = useQuery({
    queryKey: listKey,
    queryFn: () => apiFetch<HrDashboardListResponse>(`/admin/hr-dashboards?scope=${encodeURIComponent(scope)}`),
  })
  const { data: sectorsData } = useQuery({
    queryKey: ['admin', 'sectors'] as const,
    queryFn: () => apiFetch<{ sectors: SectorDTO[] }>('/admin/sectors'),
    enabled: isAdmin,
  })

  const sectors = sectorsData?.sectors ?? []
  const dashboards = data?.dashboards ?? []
  const allowedHosts = data?.allowedHosts ?? []

  function closeForm() {
    setFormOpen(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
    saveMutation.reset()
  }

  const saveMutation = useMutation({
    mutationFn: (payload: { id: string | null; body: CreateHrDashboardRequest }) =>
      apiFetch<{ dashboard: HrDashboardDTO }>(
        payload.id ? `/admin/hr-dashboards/${payload.id}` : '/admin/hr-dashboards',
        { method: payload.id ? 'PATCH' : 'POST', body: JSON.stringify(payload.body) },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'hr-dashboards'] })
      closeForm()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/admin/hr-dashboards/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'hr-dashboards'] })
      setPendingDeleteId(null)
    },
  })

  function startEdit(dashboard: HrDashboardDTO) {
    saveMutation.reset()
    deleteMutation.reset()
    setPendingDeleteId(null)
    setEditingId(dashboard.id)
    setForm({
      title: dashboard.title,
      description: dashboard.description ?? '',
      embedUrl: dashboard.embedUrl,
      height: dashboard.height,
      sortOrder: dashboard.sortOrder,
      sectorId: dashboard.sectorId ?? '',
    })
    setFormOpen(true)
  }

  // Painel de RH é configuração compartilhada, sem undo — exige confirmação
  // explícita antes de chamar a API (diálogo inline, não `window.confirm`:
  // trava automação/testes e não é o padrão do repo).
  function startDelete(id: string) {
    deleteMutation.reset()
    setPendingDeleteId(id)
  }

  function cancelDelete() {
    deleteMutation.reset()
    setPendingDeleteId(null)
  }

  /** ADMIN gerencia qualquer painel; SUBADMIN só o do próprio setor — nunca o
   * da empresa inteira (`sectorId: null`). Espelha `assertCanManage` do
   * backend: aqui é só para não oferecer Editar/Excluir que vão ser negados. */
  function canManage(dashboard: HrDashboardDTO): boolean {
    return isAdmin || dashboard.sectorId === user?.sectorId
  }

  return (
    <Panel
      title="Painéis de RH"
      action={
        <div className="flex flex-wrap items-center gap-sm">
          {isAdmin && (
            <select
              aria-label="Escopo"
              className={inputCls}
              value={scope}
              onChange={(event) => setScope(event.target.value)}
            >
              <option value={HR_DASHBOARD_SCOPE_ALL}>Todos os escopos</option>
              <option value={HR_DASHBOARD_SCOPE_COMPANY}>Empresa</option>
              {sectors.map((sector) => (
                <option key={sector.id} value={sector.id}>
                  {/* Prefixo evita colidir com o nome do setor mostrado no card do painel
                      (mesmo texto, elemento diferente) quando ambos estão na tela. */}
                  Setor: {sector.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="rounded-md bg-primary px-md py-sm font-label text-label-md text-on-primary"
            onClick={() => {
              saveMutation.reset()
              deleteMutation.reset()
              setPendingDeleteId(null)
              setEditingId(null)
              setForm(EMPTY_FORM)
              setFormOpen(true)
            }}
          >
            Novo painel
          </button>
        </div>
      }
    >
      {formOpen && (
        <form
          className="mb-lg flex flex-col gap-md rounded-lg border border-outline-variant/40 p-md"
          onSubmit={(event) => {
            event.preventDefault()
            saveMutation.mutate({ id: editingId, body: toRequest(form, isAdmin) })
          }}
        >
          <label className="flex flex-col gap-xs font-label text-label-sm text-on-surface">
            Título
            <input
              className={inputCls}
              value={form.title}
              onChange={(event) => setForm((f) => ({ ...f, title: event.target.value }))}
              required
            />
          </label>
          <label className="flex flex-col gap-xs font-label text-label-sm text-on-surface">
            Descrição
            <input
              className={inputCls}
              value={form.description}
              onChange={(event) => setForm((f) => ({ ...f, description: event.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-xs font-label text-label-sm text-on-surface">
            URL de embed
            <input
              className={inputCls}
              value={form.embedUrl}
              onChange={(event) => setForm((f) => ({ ...f, embedUrl: event.target.value }))}
              required
            />
          </label>
          <p className="font-body text-body-sm text-on-surface-variant">
            Ferramentas liberadas: {allowedHosts.join(', ')}
          </p>
          <div className="flex flex-wrap gap-md">
            <label className="flex flex-col gap-xs font-label text-label-sm text-on-surface">
              Altura (px)
              <input
                type="number"
                className={inputCls}
                min={HR_DASHBOARD_MIN_HEIGHT}
                max={HR_DASHBOARD_MAX_HEIGHT}
                value={form.height}
                onChange={(event) => setForm((f) => ({ ...f, height: Number(event.target.value) }))}
              />
            </label>
            <label className="flex flex-col gap-xs font-label text-label-sm text-on-surface">
              Ordem
              <input
                type="number"
                className={inputCls}
                min={0}
                value={form.sortOrder}
                onChange={(event) => setForm((f) => ({ ...f, sortOrder: Number(event.target.value) }))}
              />
            </label>
            {isAdmin && (
              <label className="flex flex-col gap-xs font-label text-label-sm text-on-surface">
                Escopo do painel
                <select
                  className={inputCls}
                  value={form.sectorId}
                  onChange={(event) => setForm((f) => ({ ...f, sectorId: event.target.value }))}
                >
                  <option value="">Empresa inteira</option>
                  {sectors.map((sector) => (
                    <option key={sector.id} value={sector.id}>
                      {sector.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          {saveMutation.isError && (
            <p role="alert" className="font-body text-body-sm text-error">
              {(saveMutation.error as Error).message}
            </p>
          )}
          <div className="flex gap-sm">
            <button
              type="submit"
              disabled={saveMutation.isPending}
              className="rounded-md bg-primary px-md py-sm font-label text-label-md text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
            >
              Salvar painel
            </button>
            <button
              type="button"
              onClick={closeForm}
              className="rounded-md px-md py-sm font-label text-label-md text-on-surface-variant"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {isLoading && <p className="font-body text-body-sm text-on-surface-variant">Carregando painéis…</p>}

      {!isLoading && dashboards.length === 0 && !formOpen && (
        <div className="flex flex-col items-start gap-md rounded-lg border border-dashed border-outline-variant/60 p-lg">
          <p className="font-headline text-headline-sm text-on-surface">Nenhum painel cadastrado ainda</p>
          <p className="font-body text-body-sm text-on-surface-variant">
            Cadastre um painel do Power BI, Looker Studio ou Metabase para acompanhar os números de RH aqui dentro.
          </p>
          <button
            type="button"
            className="rounded-md bg-primary px-md py-sm font-label text-label-md text-on-primary"
            onClick={() => setFormOpen(true)}
          >
            Cadastrar o primeiro painel
          </button>
        </div>
      )}

      <div className="flex flex-col gap-lg">
        {dashboards.map((dashboard) => (
          <article key={dashboard.id} className="flex flex-col gap-sm rounded-lg border border-outline-variant/40 p-md">
            <header className="flex flex-wrap items-start justify-between gap-sm">
              <div>
                <h4 className="font-headline text-headline-sm text-on-surface">{dashboard.title}</h4>
                {dashboard.description && (
                  <p className="font-body text-body-sm text-on-surface-variant">{dashboard.description}</p>
                )}
                <span className="font-label text-label-sm text-on-surface-variant">
                  {dashboard.sectorName ?? 'Empresa'}
                </span>
              </div>
              <div className="flex flex-wrap gap-sm">
                <a
                  href={dashboard.embedUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="rounded-md border border-outline-variant/60 px-md py-sm font-label text-label-sm text-on-surface"
                >
                  Abrir em nova aba
                </a>
                {canManage(dashboard) && (
                  <>
                    <button
                      type="button"
                      onClick={() => startEdit(dashboard)}
                      className="rounded-md border border-outline-variant/60 px-md py-sm font-label text-label-sm text-on-surface"
                    >
                      Editar
                    </button>
                    {pendingDeleteId === dashboard.id ? (
                      <>
                        <button
                          type="button"
                          disabled={deleteMutation.isPending}
                          onClick={() => deleteMutation.mutate(dashboard.id)}
                          className="rounded-md bg-error px-md py-sm font-label text-label-sm font-bold text-on-error disabled:opacity-50"
                        >
                          Confirmar exclusão
                        </button>
                        <button
                          type="button"
                          onClick={cancelDelete}
                          className="rounded-md border border-outline-variant/60 px-md py-sm font-label text-label-sm text-on-surface-variant"
                        >
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startDelete(dashboard.id)}
                        className="rounded-md border border-error/60 px-md py-sm font-label text-label-sm text-error"
                      >
                        Excluir
                      </button>
                    )}
                  </>
                )}
              </div>
            </header>
            {deleteMutation.isError && deleteMutation.variables === dashboard.id && (
              <p role="alert" className="font-body text-body-sm text-error">
                {(deleteMutation.error as Error).message}
              </p>
            )}
            {/*
              `allow-scripts allow-same-origin` juntos só anulariam o sandbox se o
              conteúdo fosse da MESMA origem do Legends — aqui é sempre terceiro, e as
              ferramentas de BI precisam dos dois para autenticar a sessão. Sem
              allow-top-navigation e sem allow-popups de propósito.
            */}
            <iframe
              src={dashboard.embedUrl}
              title={dashboard.title}
              height={dashboard.height}
              loading="lazy"
              referrerPolicy="no-referrer"
              sandbox="allow-scripts allow-same-origin"
              className="w-full rounded-lg border border-outline-variant/40 bg-surface-container-lowest"
            />
          </article>
        ))}
      </div>
    </Panel>
  )
}

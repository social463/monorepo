import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  COIN_ADJUSTMENT_REASON_MAX_LENGTH,
  COIN_CAP_WINDOWS,
  COIN_CAP_WINDOW_LABELS,
  COIN_CURRENCY_LABEL,
  COIN_EVENT_DESCRIPTIONS,
  COIN_EVENT_LABELS,
  COIN_LEDGER_PAGE_SIZE,
  COIN_RULE_EVENTS,
  COIN_TRANSACTION_KINDS,
  COIN_TRANSACTION_KIND_LABELS,
  type AdminUserDTO,
  type CoinCapWindow,
  type CoinEvent,
  type CoinLedgerResponse,
  type CoinReportDTO,
  type CoinRuleDTO,
  type CoinTransactionKind,
  type SectorDTO,
} from '@legends/shared'
import { ApiError, apiFetch } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { Select } from '../../components/Select'
import { Panel, inputCls } from './shared'

const ADMIN_COINS_KEY = ['admin', 'coins'] as const

function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="mb-md flex items-center gap-sm text-body-sm text-error">
      <Icon name="error" className="text-[16px]" />
      {message}
    </p>
  )
}

function capLabel(rule: CoinRuleDTO): string {
  if (rule.capWindow === 'NONE' || rule.capAmount == null) return 'Sem teto'
  return `Até ${rule.capAmount} ${COIN_CAP_WINDOW_LABELS[rule.capWindow].toLowerCase()}`
}

function RulesPanel() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [event, setEvent] = useState<CoinEvent | ''>('')
  const [amount, setAmount] = useState('10')
  const [capWindow, setCapWindow] = useState<CoinCapWindow>('NONE')
  const [capAmount, setCapAmount] = useState('')
  const [error, setError] = useState<string | null>(null)

  const rulesQuery = useQuery({
    queryKey: ['admin', 'coins', 'rules'],
    queryFn: () => apiFetch<{ rules: CoinRuleDTO[] }>('/admin/coins/rules'),
  })
  const rules = rulesQuery.data?.rules ?? []
  const usedEvents = new Set(rules.map((rule) => rule.event))
  const availableEvents = COIN_RULE_EVENTS.filter((option) => !usedEvents.has(option))

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ADMIN_COINS_KEY })

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch('/admin/coins/rules', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setShowForm(false)
      setEvent('')
      setAmount('10')
      setCapWindow('NONE')
      setCapAmount('')
      setError(null)
      void invalidate()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao criar a regra.'),
  })

  const update = useMutation({
    mutationFn: (vars: { id: string; body: Record<string, unknown> }) =>
      apiFetch(`/admin/coins/rules/${vars.id}`, { method: 'PATCH', body: JSON.stringify(vars.body) }),
    onSuccess: () => {
      setError(null)
      void invalidate()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao atualizar a regra.'),
  })

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/admin/coins/rules/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setError(null)
      void invalidate()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao remover a regra.'),
  })

  function handleSubmit(submitEvent: FormEvent) {
    submitEvent.preventDefault()
    if (!event) {
      setError('Escolha o evento da regra.')
      return
    }
    create.mutate({
      event,
      amount: Number(amount),
      capWindow,
      capAmount: capWindow === 'NONE' ? null : Number(capAmount),
    })
  }

  return (
    <Panel
      title="Regras"
      action={
        availableEvents.length > 0 ? (
          <button
            type="button"
            onClick={() => setShowForm((value) => !value)}
            className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
          >
            {showForm ? 'Cancelar' : '+ Adicionar regra'}
          </button>
        ) : null
      }
    >
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-lg flex flex-col gap-sm rounded-lg border border-outline-variant/30 bg-surface-container-low p-md"
        >
          <Select
            value={event}
            onChange={(value) => setEvent(value as CoinEvent)}
            ariaLabel="Evento"
            placeholder="Escolha o evento"
            options={availableEvents.map((option) => ({ value: option, label: COIN_EVENT_LABELS[option] }))}
          />
          {event && <p className="text-body-sm text-on-surface-variant">{COIN_EVENT_DESCRIPTIONS[event]}</p>}
          <div className="flex flex-wrap gap-sm">
            <input
              type="number"
              min={1}
              value={amount}
              onChange={(input) => setAmount(input.target.value)}
              aria-label="Coins por ação"
              placeholder="Coins por ação"
              className={`${inputCls} w-40`}
            />
            <Select
              value={capWindow}
              onChange={(value) => setCapWindow(value as CoinCapWindow)}
              ariaLabel="Janela do teto"
              options={COIN_CAP_WINDOWS.map((option) => ({ value: option, label: COIN_CAP_WINDOW_LABELS[option] }))}
            />
            {capWindow !== 'NONE' && (
              <input
                type="number"
                min={1}
                value={capAmount}
                onChange={(input) => setCapAmount(input.target.value)}
                aria-label="Teto da janela"
                placeholder="Teto da janela"
                className={`${inputCls} w-40`}
              />
            )}
            <button
              type="submit"
              className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container"
            >
              Adicionar
            </button>
          </div>
        </form>
      )}

      <ErrorLine message={error} />

      {rules.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">
          Nenhuma regra configurada — sem regra, nenhuma ação credita {COIN_CURRENCY_LABEL}.
        </p>
      ) : (
        <ul className="flex flex-col gap-sm">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="flex flex-wrap items-center justify-between gap-md rounded-lg border border-outline-variant/30 p-md"
            >
              <div>
                <p className="text-body-md text-on-surface">{COIN_EVENT_LABELS[rule.event]}</p>
                <p className="text-body-sm text-on-surface-variant">
                  +{rule.amount} · {capLabel(rule)} · {rule.active ? 'ativa' : 'inativa'}
                </p>
              </div>
              <div className="flex gap-sm">
                <button
                  type="button"
                  onClick={() => update.mutate({ id: rule.id, body: { active: !rule.active } })}
                  className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
                >
                  {rule.active ? 'Desativar' : 'Ativar'}
                </button>
                <button
                  type="button"
                  onClick={() => remove.mutate(rule.id)}
                  className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-error hover:border-error"
                >
                  Excluir
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function formatDay(day: string): string {
  const [year, month, dayOfMonth] = day.split('-')
  return `${dayOfMonth}/${month}/${year}`
}

function BalancePanel() {
  const queryClient = useQueryClient()
  const [userId, setUserId] = useState('')
  const [page, setPage] = useState(1)
  const [kind, setKind] = useState<CoinTransactionKind | ''>('')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  const usersQuery = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => apiFetch<{ users: AdminUserDTO[] }>('/admin/users'),
  })
  const balanceQuery = useQuery({
    queryKey: ['admin', 'coins', 'balance', userId],
    queryFn: () => apiFetch<{ balance: number }>(`/admin/users/${userId}/coins`),
    enabled: Boolean(userId),
  })
  const ledgerQuery = useQuery({
    queryKey: ['admin', 'coins', 'ledger', userId, page, kind],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page) })
      if (kind) params.set('kind', kind)
      return apiFetch<CoinLedgerResponse>(`/admin/users/${userId}/coins/transactions?${params}`)
    },
    enabled: Boolean(userId),
  })

  const adjust = useMutation({
    mutationFn: (body: { amount: number; reason: string }) =>
      apiFetch(`/admin/users/${userId}/coins/adjustments`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setAmount('')
      setReason('')
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ADMIN_COINS_KEY })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao lançar o ajuste.'),
  })

  const entries = ledgerQuery.data?.entries ?? []
  const totalPages = Math.max(1, Math.ceil((ledgerQuery.data?.total ?? 0) / COIN_LEDGER_PAGE_SIZE))

  return (
    <Panel title="Saldo e extrato">
      <div className="flex flex-wrap gap-sm">
        <Select
          value={userId}
          onChange={(value) => {
            setUserId(value)
            setPage(1)
          }}
          ariaLabel="Colaborador"
          placeholder="Escolha o colaborador"
          searchable
          options={(usersQuery.data?.users ?? []).map((user) => ({ value: user.id, label: user.name }))}
        />
        <Select
          value={kind}
          onChange={(value) => {
            setKind(value as CoinTransactionKind)
            setPage(1)
          }}
          ariaLabel="Tipo de lançamento"
          placeholder="Todos os tipos"
          options={[
            { value: '', label: 'Todos os tipos' },
            ...COIN_TRANSACTION_KINDS.map((option) => ({
              value: option,
              label: COIN_TRANSACTION_KIND_LABELS[option],
            })),
          ]}
        />
      </div>

      {!userId && (
        <p className="mt-md text-body-sm text-on-surface-variant">
          Escolha um colaborador para ver saldo, extrato e lançar ajustes.
        </p>
      )}

      {userId && (
        <>
          <p className="mt-md font-headline text-headline-sm text-on-surface">
            🪙 {balanceQuery.data?.balance ?? 0}{' '}
            <span className="font-label text-label-md text-on-surface-variant">{COIN_CURRENCY_LABEL}</span>
          </p>

          <form
            className="mt-md flex flex-wrap items-start gap-sm"
            onSubmit={(submitEvent) => {
              submitEvent.preventDefault()
              const parsed = Number(amount)
              if (!Number.isInteger(parsed) || parsed === 0) {
                setError('Informe um valor inteiro diferente de zero.')
                return
              }
              adjust.mutate({ amount: parsed, reason })
            }}
          >
            <input
              type="number"
              value={amount}
              onChange={(input) => setAmount(input.target.value)}
              aria-label="Valor do ajuste"
              placeholder="Valor (negativo debita)"
              className={`${inputCls} w-48`}
            />
            <input
              value={reason}
              onChange={(input) => setReason(input.target.value)}
              maxLength={COIN_ADJUSTMENT_REASON_MAX_LENGTH}
              aria-label="Justificativa"
              placeholder="Justificativa"
              className={`${inputCls} flex-1`}
            />
            <button
              type="submit"
              className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container"
            >
              Lançar ajuste
            </button>
          </form>

          <div className="mt-md">
            <ErrorLine message={error} />
          </div>

          {entries.length === 0 ? (
            <p className="text-body-sm text-on-surface-variant">Nenhum lançamento no filtro atual.</p>
          ) : (
            <ul className="flex flex-col gap-sm">
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-center justify-between gap-md border-b border-outline-variant/20 pb-sm last:border-none"
                >
                  <div>
                    <p className="text-body-md text-on-surface">
                      {entry.event
                        ? COIN_EVENT_LABELS[entry.event]
                        : COIN_TRANSACTION_KIND_LABELS[entry.kind]}
                    </p>
                    <p className="text-body-sm text-on-surface-variant">
                      {formatDay(entry.day)}
                      {entry.reason ? ` · ${entry.reason}` : ''}
                      {entry.actor ? ` · por ${entry.actor.name}` : ''}
                    </p>
                  </div>
                  <p className={`font-label text-label-lg ${entry.amount < 0 ? 'text-error' : 'text-primary'}`}>
                    {entry.amount > 0 ? `+${entry.amount}` : entry.amount}
                  </p>
                </li>
              ))}
            </ul>
          )}

          {totalPages > 1 && (
            <div className="mt-md flex items-center gap-md">
              <button
                type="button"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page === 1}
                className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm disabled:opacity-40"
              >
                Anterior
              </button>
              <span className="text-body-sm text-on-surface-variant">
                Página {page} de {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                disabled={page >= totalPages}
                className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm disabled:opacity-40"
              >
                Próxima
              </button>
            </div>
          )}
        </>
      )}
    </Panel>
  )
}

function ReportPanel() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [sectorId, setSectorId] = useState('')

  const sectorsQuery = useQuery({
    queryKey: ['admin', 'sectors'],
    queryFn: () => apiFetch<{ sectors: SectorDTO[] }>('/admin/sectors'),
  })
  const reportQuery = useQuery({
    queryKey: ['admin', 'coins', 'report', from, to, sectorId],
    queryFn: () => {
      const params = new URLSearchParams()
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      if (sectorId) params.set('sectorId', sectorId)
      const query = params.toString()
      return apiFetch<CoinReportDTO>(`/admin/coins/report${query ? `?${query}` : ''}`)
    },
  })

  const report = reportQuery.data

  return (
    <Panel title="Relatório">
      <div className="flex flex-wrap gap-sm">
        <input
          type="date"
          value={from}
          onChange={(input) => setFrom(input.target.value)}
          aria-label="De"
          className={`${inputCls} w-44`}
        />
        <input
          type="date"
          value={to}
          onChange={(input) => setTo(input.target.value)}
          aria-label="Até"
          className={`${inputCls} w-44`}
        />
        <Select
          value={sectorId}
          onChange={setSectorId}
          ariaLabel="Setor"
          placeholder="Todos os setores"
          options={[
            { value: '', label: 'Todos os setores' },
            ...(sectorsQuery.data?.sectors ?? []).map((sector) => ({ value: sector.id, label: sector.name })),
          ]}
        />
      </div>

      <ul className="mt-md flex flex-col gap-sm">
        {(report?.rows ?? []).map((row) => (
          <li key={row.event} className="flex items-center justify-between gap-md">
            <div>
              <p className="text-body-md text-on-surface">{COIN_EVENT_LABELS[row.event]}</p>
              <p className="text-body-sm text-on-surface-variant">
                {row.transactionCount} lançamentos · {row.userCount} pessoas
                {row.amount != null ? ` · regra vale ${row.amount}` : ' · sem regra ativa'}
              </p>
            </div>
            <p className="font-label text-label-lg text-primary">{row.totalAmount}</p>
          </li>
        ))}
      </ul>

      {report && (
        <p className="mt-md text-body-sm text-on-surface-variant">
          Ajustes manuais: +{report.manual.creditedAmount} / {report.manual.debitedAmount} em{' '}
          {report.manual.transactionCount} lançamentos · total distribuído: {report.totalAmount}
        </p>
      )}
    </Panel>
  )
}

/** Administração de EMR Coins: regras, saldo/extrato por colaborador e relatório. */
export function CoinsSection() {
  return (
    <div className="flex flex-col gap-lg">
      <RulesPanel />
      <BalancePanel />
      <ReportPanel />
    </div>
  )
}

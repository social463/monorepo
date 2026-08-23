import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  XP_CAP_WINDOWS,
  XP_CAP_WINDOW_LABELS,
  XP_CURRENCY_LABEL,
  XP_EVENT_DESCRIPTIONS,
  XP_EVENT_LABELS,
  XP_LEVELS,
  XP_RULE_EVENTS,
  type XpCapWindow,
  type XpEvent,
  type XpRuleDTO,
} from '@legends/shared'
import { ApiError, apiFetch } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { Select } from '../../components/Select'
import { Panel, inputCls } from './shared'

const ADMIN_XP_KEY = ['admin', 'xp'] as const

function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="mb-md flex items-center gap-sm text-body-sm text-error">
      <Icon name="error" className="text-[16px]" />
      {message}
    </p>
  )
}

function capLabel(rule: XpRuleDTO): string {
  if (rule.capWindow === 'NONE' || rule.capAmount == null) return 'Sem teto'
  return `Até ${rule.capAmount} ${XP_CAP_WINDOW_LABELS[rule.capWindow].toLowerCase()}`
}

function RulesPanel() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [event, setEvent] = useState<XpEvent | ''>('')
  const [amount, setAmount] = useState('10')
  const [capWindow, setCapWindow] = useState<XpCapWindow>('NONE')
  const [capAmount, setCapAmount] = useState('')
  const [error, setError] = useState<string | null>(null)

  const rulesQuery = useQuery({
    queryKey: ['admin', 'xp', 'rules'],
    queryFn: () => apiFetch<{ rules: XpRuleDTO[] }>('/admin/xp/rules'),
  })
  const rules = rulesQuery.data?.rules ?? []
  const usedEvents = new Set(rules.map((rule) => rule.event))
  const availableEvents = XP_RULE_EVENTS.filter((option) => !usedEvents.has(option))

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ADMIN_XP_KEY })

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch('/admin/xp/rules', { method: 'POST', body: JSON.stringify(body) }),
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
      apiFetch(`/admin/xp/rules/${vars.id}`, { method: 'PATCH', body: JSON.stringify(vars.body) }),
    onSuccess: () => {
      setError(null)
      void invalidate()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao atualizar a regra.'),
  })

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/admin/xp/rules/${id}`, { method: 'DELETE' }),
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
      title="Regras de pontos"
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
            onChange={(value) => setEvent(value as XpEvent)}
            ariaLabel="Evento"
            placeholder="Escolha o evento"
            options={availableEvents.map((option) => ({ value: option, label: XP_EVENT_LABELS[option] }))}
          />
          {event && <p className="text-body-sm text-on-surface-variant">{XP_EVENT_DESCRIPTIONS[event]}</p>}
          <div className="flex flex-wrap gap-sm">
            <input
              type="number"
              min={1}
              value={amount}
              onChange={(input) => setAmount(input.target.value)}
              aria-label="Pontos por ação"
              placeholder="Pontos por ação"
              className={`${inputCls} w-40`}
            />
            <Select
              value={capWindow}
              onChange={(value) => setCapWindow(value as XpCapWindow)}
              ariaLabel="Janela do teto"
              options={XP_CAP_WINDOWS.map((option) => ({ value: option, label: XP_CAP_WINDOW_LABELS[option] }))}
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
          Nenhuma regra configurada — sem regra ninguém ganha {XP_CURRENCY_LABEL.toLowerCase()}, e todo mundo
          fica no primeiro nível.
        </p>
      ) : (
        <ul className="flex flex-col gap-sm">
          {rules.map((rule) => (
            <li
              key={rule.id}
              className="flex flex-wrap items-center justify-between gap-md rounded-lg border border-outline-variant/30 p-md"
            >
              <div>
                <p className="text-body-md text-on-surface">{XP_EVENT_LABELS[rule.event]}</p>
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

/** A escada é do produto, não da empresa: aqui é só leitura, para consulta. */
function LevelsPanel() {
  return (
    <Panel title="Níveis">
      <p className="mb-md text-body-sm text-on-surface-variant">
        Os degraus são iguais para todas as empresas. O que muda entre elas é a velocidade — isso quem
        define são as regras acima.
      </p>
      <ul className="flex flex-wrap gap-sm">
        {XP_LEVELS.map((tier) => (
          <li key={tier.name} className="rounded-lg border border-outline-variant/30 px-md py-sm">
            <p className="flex items-center gap-sm font-label text-label-md text-on-surface">
              <span aria-hidden className="h-3 w-3 rounded-full" style={{ backgroundColor: tier.color }} />
              {tier.name}
            </p>
            <p className="text-body-sm text-on-surface-variant">
              {tier.min.toLocaleString('pt-BR')}+ pontos
            </p>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

/**
 * Administração dos Pontos (XP). Espelha a seção de EMR Coins de propósito —
 * mesmo formulário, mesmo vocabulário —, mas são domínios separados: coin é
 * saldo (a Lojinha debita) e XP só acumula, porque é dele que sai o nível.
 */
export function XpSection() {
  return (
    <div className="flex flex-col gap-lg">
      <RulesPanel />
      <LevelsPanel />
    </div>
  )
}

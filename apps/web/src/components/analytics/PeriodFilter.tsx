import { useState } from 'react'
import {
  PEOPLE_ANALYTICS_RANGES,
  PEOPLE_ANALYTICS_RANGE_LABELS,
  type AnalyticsWindowRequest,
} from '@legends/shared'
import { Icon } from '../Icon'
import { Select } from '../Select'

/** Hoje em `YYYY-MM-DD`, hora local — é o teto do seletor de data. */
function todayYmd(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

const OPTIONS = [
  ...PEOPLE_ANALYTICS_RANGES.map((value) => ({ value, label: PEOPLE_ANALYTICS_RANGE_LABELS[value] })),
  { value: 'custom', label: 'Personalizado…' },
]

/**
 * Filtro de período dos painéis: atalhos (Hoje, 7, 30, 90 dias, Este ano) mais
 * **Personalizado**, com data inicial e final livres (seção 4.1 do Documento 3).
 *
 * A janela é sempre estado de quem chama — o filtro não guarda nada. Isso é o
 * que permite o mapa de calor ter recorte próprio (seção 4.2) usando o mesmo
 * componente, nascendo com o valor do cabeçalho e se soltando depois.
 *
 * As duas datas só sobem juntas: `onChange` não dispara com meia janela
 * preenchida, senão cada tecla digitada no campo de data viraria uma consulta —
 * e a maioria delas com intervalo inválido.
 *
 * `disabledRanges` desliga atalhos que o painel da vez não sabe responder (a
 * aba Clima desliga "Hoje": a série do termômetro começa em
 * `MOOD_OVERVIEW_MIN_DAYS`). Eles continuam na lista, apagados — some-los faria
 * o seletor mudar de tamanho de aba para aba, sem dizer por quê. Quem explica é
 * o painel, que já mostra o aviso.
 */
export function PeriodFilter({
  value,
  onChange,
  label = 'Período',
  disabledRanges = [],
}: {
  value: AnalyticsWindowRequest
  onChange: (window: AnalyticsWindowRequest) => void
  label?: string
  disabledRanges?: string[]
}) {
  const [from, setFrom] = useState(value.from ?? '')
  const [to, setTo] = useState(value.to ?? '')
  const custom = value.range === 'custom'
  const max = todayYmd()
  const invertido = Boolean(from && to && from > to)

  function selectRange(next: string) {
    if (next !== 'custom') {
      onChange({ range: next as AnalyticsWindowRequest['range'] })
      return
    }
    // Entrar no modo personalizado não consulta nada: só quando as duas pontas
    // estiverem preenchidas é que a janela sobe.
    if (from && to && from <= to) onChange({ range: 'custom', from, to })
    else onChange({ range: 'custom', from: value.from, to: value.to })
  }

  function applyDates(nextFrom: string, nextTo: string) {
    setFrom(nextFrom)
    setTo(nextTo)
    if (nextFrom && nextTo && nextFrom <= nextTo) onChange({ range: 'custom', from: nextFrom, to: nextTo })
  }

  return (
    <div className="flex flex-wrap items-end gap-md">
      <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
        {label}
        <Select
          ariaLabel={label}
          value={value.range}
          onChange={selectRange}
          options={OPTIONS.map((option) => ({
            ...option,
            disabled: disabledRanges.includes(option.value),
          }))}
        />
      </label>

      {custom && (
        <>
          <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            De
            <input
              type="date"
              // O rótulo carrega o nome do filtro porque a tela tem mais de um
              // (o do cabeçalho e o do mapa de calor): dois campos chamados "De"
              // seriam indistinguíveis para leitor de tela e para teste.
              aria-label={`${label} — data inicial`}
              value={from}
              max={to || max}
              onChange={(e) => applyDates(e.target.value, to)}
              className="rounded-md border border-outline-variant/60 bg-surface-container-highest px-sm py-2 font-body text-body-sm text-on-surface outline-none focus:border-primary"
            />
          </label>
          <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            Até
            <input
              type="date"
              aria-label={`${label} — data final`}
              value={to}
              min={from || undefined}
              max={max}
              onChange={(e) => applyDates(from, e.target.value)}
              className="rounded-md border border-outline-variant/60 bg-surface-container-highest px-sm py-2 font-body text-body-sm text-on-surface outline-none focus:border-primary"
            />
          </label>
          {invertido && (
            <p role="alert" className="flex items-center gap-xs pb-2 text-body-sm text-error">
              <Icon name="error" className="text-[16px]" />
              A data inicial não pode ser depois da final.
            </p>
          )}
        </>
      )}
    </div>
  )
}

/** Serializa a janela na query string — o mesmo formato que a API valida. */
export function windowQuery(window: AnalyticsWindowRequest, sectorId: string): string {
  const params = new URLSearchParams({ range: window.range })
  if (window.range === 'custom' && window.from && window.to) {
    params.set('from', window.from)
    params.set('to', window.to)
  }
  if (sectorId) params.set('sectorId', sectorId)
  return params.toString()
}

/** Chave estável de cache do React Query para uma janela. */
export function windowKey(window: AnalyticsWindowRequest): string {
  return window.range === 'custom' ? `custom:${window.from ?? ''}:${window.to ?? ''}` : window.range
}

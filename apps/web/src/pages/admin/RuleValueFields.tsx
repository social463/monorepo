import { useState } from 'react'
import { Select } from '../../components/Select'
import { inputCls } from './shared'

/** O que uma regra de recompensa vale: quanto credita e até quanto por janela. */
export interface RuleValue {
  amount: string
  capWindow: string
  capAmount: string
}

export function emptyRuleValue(amount = '10'): RuleValue {
  return { amount, capWindow: 'NONE', capAmount: '' }
}

/**
 * Corpo do payload de regra a partir dos campos da tela. Teto só viaja quando há
 * janela: `capAmount` preenchido com `capWindow: 'NONE'` seria um limite que
 * nunca é contado, e a API o recusaria de todo jeito.
 */
export function ruleValueBody(value: RuleValue): { amount: number; capWindow: string; capAmount: number | null } {
  return {
    amount: Number(value.amount),
    capWindow: value.capWindow,
    capAmount: value.capWindow === 'NONE' ? null : Number(value.capAmount),
  }
}

/**
 * Valor e teto de uma regra de recompensa — os dois únicos campos editáveis.
 *
 * Compartilhado por EMR Coins e Pontos (XP), e pelos dois usos de cada um:
 * criar e **editar** (seção 5 do Documento 3). As duas telas eram gêmeas linha a
 * linha; duplicar o formulário uma terceira e quarta vez para a edição era
 * garantir que uma delas ficasse para trás na próxima mudança.
 *
 * O **evento** não está aqui de propósito. Junto com a empresa ele é a
 * identidade da regra (`@@unique([companyId, event])`) e o que a liga à ação que
 * credita: trocá-lo numa regra existente seria apagar uma e criar outra por
 * baixo, com o extrato apontando para a errada. Por isso ele só aparece na
 * criação, e a API nem aceita o campo no `PATCH`.
 */
export function RuleValueFields({
  value,
  onChange,
  amountLabel,
  capWindows,
  capWindowLabels,
  submitLabel,
  onCancel,
}: {
  value: RuleValue
  onChange: (value: RuleValue) => void
  /** "Coins por ação" ou "Pontos por ação" — é o que distingue as duas telas. */
  amountLabel: string
  capWindows: readonly string[]
  capWindowLabels: Record<string, string>
  submitLabel: string
  /** Ausente na criação (o painel já tem o "Cancelar" no cabeçalho). */
  onCancel?: () => void
}) {
  return (
    <div className="flex flex-wrap gap-sm">
      <input
        type="number"
        min={1}
        value={value.amount}
        onChange={(input) => onChange({ ...value, amount: input.target.value })}
        aria-label={amountLabel}
        placeholder={amountLabel}
        className={`${inputCls} w-40`}
      />
      <Select
        value={value.capWindow}
        onChange={(next) => onChange({ ...value, capWindow: next })}
        ariaLabel="Janela do teto"
        options={capWindows.map((option) => ({ value: option, label: capWindowLabels[option] ?? option }))}
      />
      {value.capWindow !== 'NONE' && (
        <input
          type="number"
          min={1}
          value={value.capAmount}
          onChange={(input) => onChange({ ...value, capAmount: input.target.value })}
          aria-label="Teto da janela"
          placeholder="Teto da janela"
          className={`${inputCls} w-40`}
        />
      )}
      <button
        type="submit"
        className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container"
      >
        {submitLabel}
      </button>
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-outline-variant/60 px-lg py-sm font-label text-label-md text-on-surface-variant hover:text-on-surface"
        >
          Cancelar
        </button>
      )}
    </div>
  )
}

/**
 * Estado da edição inline: qual regra está aberta e com que valores.
 * `null` = nenhuma linha em edição, que é o estado normal do painel.
 */
export function useRuleEditing() {
  const [editing, setEditing] = useState<{ id: string; value: RuleValue } | null>(null)
  return {
    editing,
    start: (id: string, value: RuleValue) => setEditing({ id, value }),
    change: (value: RuleValue) => setEditing((current) => (current ? { ...current, value } : current)),
    stop: () => setEditing(null),
  }
}

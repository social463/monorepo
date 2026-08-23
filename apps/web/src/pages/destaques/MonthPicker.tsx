import { MONTH_OPTIONS } from '@legends/shared'
import { Select } from '../../components/Select'

/**
 * Filtro de mês e ano dos Destaques do Mês.
 *
 * O ano é uma lista curta em torno do ano corrente, e não um `<input
 * type="number">`: destaque é sempre de um mês que já aconteceu (ou do mês em
 * curso), então digitar 1998 é sempre erro, e a lista tira o erro do caminho.
 */
export function MonthPicker({
  monthRef,
  onChange,
  label = 'Mês',
}: {
  monthRef: string
  onChange: (monthRef: string) => void
  label?: string
}) {
  const [year, month] = monthRef.split('-')
  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: 6 }, (_, i) => String(currentYear - 4 + i))

  return (
    <div className="flex items-center gap-sm">
      <div className="w-40">
        <Select
          ariaLabel={label}
          value={month}
          onChange={(value) => onChange(`${year}-${value}`)}
          options={MONTH_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
        />
      </div>
      <div className="w-28">
        <Select
          ariaLabel="Ano"
          value={year}
          onChange={(value) => onChange(`${value}-${month}`)}
          options={years.map((value) => ({ value, label: value }))}
        />
      </div>
    </div>
  )
}

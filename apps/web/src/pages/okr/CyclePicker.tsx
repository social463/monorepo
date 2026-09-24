import type { OkrCycleDTO } from '@legends/shared'
import { Select } from '../../components/Select'
import { formatYmd } from './okr-format'

export function CyclePicker({
  cycles,
  cycle,
  onSelect,
}: {
  cycles: OkrCycleDTO[]
  cycle: OkrCycleDTO
  onSelect: (id: string) => void
}) {
  return (
    <label className="flex w-full max-w-[16rem] flex-col gap-xs">
      <span className="font-label text-label-md text-on-surface">Ciclo</span>
      <Select
        ariaLabel="Ciclo"
        value={cycle.id}
        onChange={onSelect}
        options={cycles.map((c) => ({ value: c.id, label: c.name }))}
      />
      <span className="font-body text-body-sm text-on-surface-variant">
        {formatYmd(cycle.startDate)} a {formatYmd(cycle.finishDate)}
        {cycle.status === 'CLOSED' ? ' · encerrado' : ''}
      </span>
    </label>
  )
}

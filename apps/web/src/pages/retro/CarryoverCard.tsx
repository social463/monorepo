import { useState, type JSX } from 'react'
import type { RetroCarryoverItemDTO } from '@legends/shared'
import { Avatar } from '../../components/Avatar'
import { CARRYOVER_CARD_CLASS } from './ColorPalette'

function formatDue(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ymd
}
export type CarryoverAction = 'validate' | 'reject' | 'reschedule' | 'done'

export function CarryoverCard({
  item, canAct, onAction,
}: {
  item: RetroCarryoverItemDTO
  canAct: boolean
  onAction: (cardId: string, action: CarryoverAction, dueDate?: string) => void
}): JSX.Element {
  const [newDate, setNewDate] = useState('')
  const isOverdue = item.type === 'overdue'
  return (
    <div className={`flex w-[220px] flex-col gap-1 rounded-lg border-2 p-2 shadow-md ${CARRYOVER_CARD_CLASS[item.type]}`}>
      <span className="font-label text-[10px] font-bold uppercase tracking-wide text-zinc-700">
        {isOverdue ? 'Vencida' : 'A validar'} · Sprint {item.sprint}
      </span>
      <div className="flex items-center gap-1">
        <span className="flex h-5 w-5 items-center justify-center overflow-hidden rounded-full bg-zinc-700 ring-1 ring-white/60">
          <Avatar user={item.responsible ?? { name: '?' }} initialsClassName="text-[9px] font-bold text-white" />
        </span>
        <span className="text-[11px] text-zinc-800">{item.responsible?.name ?? 'Sem responsável'}</span>
      </div>
      <p className="text-body-sm text-zinc-900">{item.plan}</p>
      {item.note && (
        <p className="text-[11px] text-zinc-700">
          <span className="font-bold">Observação do responsável:</span> {item.note}
        </p>
      )}
      <p className={`font-label text-[11px] ${isOverdue ? 'font-bold text-red-700' : 'text-zinc-700'}`}>
        {isOverdue ? `Venceu em ${formatDue(item.dueDate)}` : `Prazo: ${formatDue(item.dueDate)}`}
      </p>
      {canAct && !isOverdue && (
        <div className="mt-1 flex gap-1">
          <button type="button" onClick={() => onAction(item.id, 'validate')} className="rounded bg-primary px-2 py-0.5 font-label text-[11px] font-bold text-on-primary">Validar</button>
          <button type="button" onClick={() => onAction(item.id, 'reject')} className="rounded border border-zinc-400/60 px-2 py-0.5 font-label text-[11px] text-zinc-800">Reprovar</button>
        </div>
      )}
      {canAct && isOverdue && (
        <div className="mt-1 flex flex-col gap-1">
          <button type="button" onClick={() => onAction(item.id, 'done')} className="rounded bg-primary px-2 py-0.5 font-label text-[11px] font-bold text-on-primary">Concluir</button>
          <div className="flex items-center gap-1">
            <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="h-6 flex-1 rounded border border-zinc-400/60 bg-white/80 px-1 text-[11px] text-zinc-900" />
            <button type="button" disabled={!newDate} onClick={() => onAction(item.id, 'reschedule', newDate)} className="rounded border border-zinc-400/60 px-2 py-0.5 font-label text-[11px] text-zinc-800 disabled:opacity-40">Novo prazo</button>
          </div>
        </div>
      )}
    </div>
  )
}

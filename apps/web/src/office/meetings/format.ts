import { MEETING_DURATION_MINUTES, type MeetingDurationMinutes, type OfficeMeetingDTO } from '@legends/shared'

export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** `datetime-local` devolve hora local sem timezone — o Date do browser resolve. */
export function toIso(localValue: string): string {
  return new Date(localValue).toISOString()
}

/**
 * ISO → valor de `datetime-local` (hora local, sem timezone). Usado ao
 * pré-preencher o formulário na edição.
 */
export function toLocalInputValue(iso: string): string {
  const date = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`
}

/**
 * Duração da reunião em minutos, presa às opções do select. Reunião criada por
 * outro caminho (ou com duração legada) cai na opção mais próxima.
 */
export function durationOf(meeting: OfficeMeetingDTO): MeetingDurationMinutes {
  const minutes = Math.round((new Date(meeting.endsAt).getTime() - new Date(meeting.startsAt).getTime()) / 60_000)
  const exact = MEETING_DURATION_MINUTES.find((option) => option === minutes)
  if (exact) return exact
  return MEETING_DURATION_MINUTES.reduce((closest, option) =>
    Math.abs(option - minutes) < Math.abs(closest - minutes) ? option : closest,
  )
}

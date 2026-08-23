import type { VotingPeriodState, VotingPeriodStatus } from '@legends/shared'

/** Mês de uma data no formato "YYYY-MM". */
export function monthRefFor(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Um período só é editável se o seu mês (monthRef) for o mês atual ou futuro.
 * Meses passados são imutáveis. Comparação de string YYYY-MM (zero-padded) é
 * cronológica.
 */
export function isPeriodEditable(monthRef: string, now: Date): boolean {
  return monthRef >= monthRefFor(now)
}

/**
 * Estado efetivo de um período a partir de "agora". A ativação é por data, sem
 * job: um período agendado vira ACTIVE sozinho quando entra na janela.
 *   - ENDED:     fechado manualmente (CLOSED) ou já passou de endsAt
 *   - SCHEDULED: ainda não chegou em startsAt
 *   - ACTIVE:    agora está dentro de [startsAt, endsAt]
 */
export function derivePeriodState(
  period: { startsAt: Date; endsAt: Date; status: VotingPeriodStatus },
  now: Date,
): VotingPeriodState {
  if (period.status === 'CLOSED' || now > period.endsAt) return 'ENDED'
  if (now < period.startsAt) return 'SCHEDULED'
  return 'ACTIVE'
}

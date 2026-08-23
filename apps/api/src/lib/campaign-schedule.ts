import { addDays, saoPauloMidnightUtc, ymdInSaoPaulo } from './sao-paulo-date'
import { CampaignError } from './campaign-error'

/**
 * Horários de publicação dentro de um dia. Quatro é o teto deliberado: acima
 * disso a campanha vira spam, e empilhar comunicados no mesmo horário seria pior
 * do que pedir ao usuário para ampliar a janela.
 */
export const CAMPAIGN_SLOT_HOURS = [9, 11, 14, 16] as const

const HOUR_MS = 60 * 60 * 1000

function daysInWindow(startsAt: Date, endsAt: Date): string[] {
  const first = ymdInSaoPaulo(startsAt)
  const last = ymdInSaoPaulo(endsAt)
  const days: string[] = []
  let cursor = first
  while (cursor <= last) {
    days.push(cursor)
    cursor = addDays(cursor, 1)
  }
  return days
}

/** Escolhe `n` dias igualmente espaçados da lista, sempre incluindo o primeiro. */
function pickEvenly(days: string[], n: number): string[] {
  if (n === 1) return [days[0]]
  return Array.from({ length: n }, (_, i) => days[Math.round((i * (days.length - 1)) / (n - 1))])
}

function instantAt(ymd: string, hour: number): Date {
  return new Date(saoPauloMidnightUtc(ymd).getTime() + hour * HOUR_MS)
}

/**
 * Grade de datas da campanha. É o servidor que decide as datas — pedir ao modelo
 * que as distribua produz colisão e item fora da janela. Com a grade calculada
 * aqui, "todo rascunho dentro da janela" passa a ser garantia de construção.
 */
export function buildScheduleSlots(input: { startsAt: Date; endsAt: Date; quantity: number }): Date[] {
  const { startsAt, endsAt, quantity } = input
  if (endsAt.getTime() < startsAt.getTime()) {
    throw new CampaignError('A data final não pode ser anterior à data inicial.', 400)
  }
  const days = daysInWindow(startsAt, endsAt)
  const capacity = days.length * CAMPAIGN_SLOT_HOURS.length
  if (quantity > capacity) {
    throw new CampaignError(
      `A janela informada comporta no máximo ${capacity} comunicado(s). Reduza a quantidade ou amplie o período.`,
      400,
    )
  }

  if (quantity <= days.length) {
    return pickEvenly(days, quantity).map((ymd) => instantAt(ymd, CAMPAIGN_SLOT_HOURS[0]))
  }

  // Mais itens que dias: distribui o excedente nos primeiros dias, para a
  // campanha começar densa e afinar — e não o contrário.
  const base = Math.floor(quantity / days.length)
  const extra = quantity % days.length
  const slots: Date[] = []
  days.forEach((ymd, index) => {
    const count = base + (index < extra ? 1 : 0)
    for (let k = 0; k < count; k += 1) slots.push(instantAt(ymd, CAMPAIGN_SLOT_HOURS[k]))
  })
  return slots
}

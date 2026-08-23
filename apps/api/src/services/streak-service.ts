import type { StreakSummaryDTO, StreakCalendarDTO } from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'
import {
  todayInSaoPaulo,
  ymdOf,
  monthBounds,
  isBusinessDay,
  prevBusinessDay,
  nextBusinessDay,
} from '../lib/sao-paulo-date'

export async function getStreakSummary(
  userId: string,
  companyId: string,
  todayYmd: string = todayInSaoPaulo().ymd,
): Promise<StreakSummaryDTO> {
  const entries = await scopedPrisma(companyId).moodEntry.findMany({
    where: { userId },
    select: { day: true },
    orderBy: { day: 'asc' },
  })
  const set = new Set(entries.map((e) => ymdOf(e.day)))

  const registeredToday = set.has(todayYmd)

  // Dia útil de referência: hoje se for dia útil; senão o último dia útil
  // anterior (sexta, no fim de semana). Fins de semana são ponte.
  const lastBiz = isBusinessDay(todayYmd) ? todayYmd : prevBusinessDay(todayYmd)

  // Streak atual com regra de graça: se o dia útil de referência ainda não tem
  // boost, não quebra — começa a contar do dia útil anterior. Caminha para trás
  // por dias úteis (fins de semana são pontados).
  let currentStreak = 0
  let cursor = set.has(lastBiz) ? lastBiz : prevBusinessDay(lastBiz)
  while (set.has(cursor)) {
    currentStreak++
    cursor = prevBusinessDay(cursor)
  }

  // Melhor streak: maior run de dias úteis consecutivos com boost. Entradas de
  // fim de semana são ignoradas; dois dias úteis são consecutivos se um é o dia
  // útil imediatamente seguinte do outro (sexta→segunda conta).
  const bizYmds = [...set].filter(isBusinessDay).sort()
  let bestStreak = 0
  let run = 0
  let prev: string | null = null
  for (const ymd of bizYmds) {
    run = prev !== null && nextBusinessDay(prev) === ymd ? run + 1 : 1
    if (run > bestStreak) bestStreak = run
    prev = ymd
  }

  return { currentStreak, bestStreak, today: todayYmd, registeredToday }
}

export async function getStreakCalendar(
  userId: string,
  companyId: string,
  monthRef: string,
): Promise<StreakCalendarDTO> {
  const { start, endExclusive } = monthBounds(monthRef)
  const entries = await scopedPrisma(companyId).moodEntry.findMany({
    where: { userId, day: { gte: start, lt: endExclusive } },
    select: { day: true },
    orderBy: { day: 'asc' },
  })
  // Só dias úteis contam como boost (fim de semana é neutro).
  const days = entries.map((e) => ymdOf(e.day)).filter(isBusinessDay)
  return { ref: monthRef, days, count: days.length }
}

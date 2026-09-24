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
import { companyHolidays } from './vacation-planning-service'

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

  // Feriado é ponte, igual fim de semana: sem isso, feriado em dia útil
  // quebraria a sequência de quem não tinha como marcar humor. A janela cobre
  // do primeiro registro (ou hoje, sem registro nenhum) até hoje — é tudo que
  // os laços de dia útil abaixo percorrem.
  const minDay = entries.length > 0 ? ymdOf(entries[0]!.day) : todayYmd
  const holidays = new Set((await companyHolidays(companyId, minDay, todayYmd)).keys())

  // Dia útil de referência: hoje se for dia útil; senão o último dia útil
  // anterior (sexta, no fim de semana). Fins de semana são ponte.
  const lastBiz = isBusinessDay(todayYmd, holidays) ? todayYmd : prevBusinessDay(todayYmd, holidays)

  // Streak atual com regra de graça: se o dia útil de referência ainda não tem
  // boost, não quebra — começa a contar do dia útil anterior. Caminha para trás
  // por dias úteis (fins de semana são pontados).
  let currentStreak = 0
  let cursor = set.has(lastBiz) ? lastBiz : prevBusinessDay(lastBiz, holidays)
  while (set.has(cursor)) {
    currentStreak++
    cursor = prevBusinessDay(cursor, holidays)
  }

  // Melhor streak: maior run de dias úteis consecutivos com boost. Entradas de
  // fim de semana são ignoradas; dois dias úteis são consecutivos se um é o dia
  // útil imediatamente seguinte do outro (sexta→segunda conta, feriado no meio também).
  const bizYmds = [...set].filter((ymd) => isBusinessDay(ymd, holidays)).sort()
  let bestStreak = 0
  let run = 0
  let prev: string | null = null
  for (const ymd of bizYmds) {
    run = prev !== null && nextBusinessDay(prev, holidays) === ymd ? run + 1 : 1
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
  const holidays = new Set((await companyHolidays(companyId, ymdOf(start), ymdOf(endExclusive))).keys())
  // Só dias úteis contam como boost (fim de semana e feriado são neutros).
  const days = entries.map((e) => ymdOf(e.day)).filter((ymd) => isBusinessDay(ymd, holidays))
  return { ref: monthRef, days, count: days.length }
}

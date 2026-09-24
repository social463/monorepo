import { prisma } from '../lib/prisma'
import { ymdInSaoPaulo, hourInSaoPaulo, isBusinessDay, dayFromYmd } from '../lib/sao-paulo-date'
import { getStreakSummary } from '../services/streak-service'
import { createNotification } from '../services/notification-service'
import { companyHolidays } from '../services/vacation-planning-service'
import { postTeamsNudge } from '../lib/teams-client'
import { absoluteUrl } from '../lib/app-url'
import { runVoteReminderTick } from './vote-reminders'

const FIRE_HOUR_SP = 16

/**
 * Um tick do nudge de "ofensiva em risco". Recebe `now` injetado (testável sem
 * timers). Só age em dia útil às 16h (hora São Paulo). Para cada usuário ativo
 * com ofensiva ativa que ainda não registrou humor hoje, cria uma notificação
 * in-app (idempotente por dia) e, se houver teamsWebhookUrl, dispara o Teams.
 */
export async function runNudgeTick(now: Date): Promise<void> {
  const ymd = ymdInSaoPaulo(now)
  if (!isBusinessDay(ymd) || hourInSaoPaulo(now) !== FIRE_HOUR_SP) return

  // 00:00 UTC do dia civil SP. Como o nudge dispara só às 16h SP (19h UTC), o
  // nudge de ontem cai antes deste corte e o de hoje depois — separação limpa.
  const dayStart = dayFromYmd(ymd)
  const users = await prisma.user.findMany({ where: { active: true, role: { notIn: ['ADMIN', 'SUBADMIN'] } } })

  // Feriado é por empresa (calendário próprio), então o cache é por companyId
  // — não dá pra decidir "hoje é dia útil" uma vez só para o lote inteiro.
  const holidaysByCompany = new Map<string, Set<string>>()
  async function holidaysFor(companyId: string): Promise<Set<string>> {
    const cached = holidaysByCompany.get(companyId)
    if (cached) return cached
    const set = new Set((await companyHolidays(companyId, ymd, ymd)).keys())
    holidaysByCompany.set(companyId, set)
    return set
  }

  for (const user of users) {
    try {
      const holidays = await holidaysFor(user.companyId)
      if (!isBusinessDay(ymd, holidays)) continue

      const streak = await getStreakSummary(user.id, user.companyId, ymd)
      if (streak.currentStreak < 1 || streak.registeredToday) continue

      const already = await prisma.notification.findFirst({
        where: { userId: user.id, type: 'STREAK_AT_RISK', createdAt: { gte: dayStart } },
      })
      if (already) continue

      const message = `Não perca sua ofensiva de ${streak.currentStreak} dias — registre seu humor de hoje 🔥`
      const link = `/perfil/${user.id}`

      await createNotification({ userId: user.id, type: 'STREAK_AT_RISK', title: message, link, skipTeamsMirror: true, companyId: user.companyId })

      if (user.teamsWebhookUrl) {
        await postTeamsNudge(user.teamsWebhookUrl, {
          event: 'streak_at_risk',
          name: user.name,
          streakDays: streak.currentStreak,
          ctaUrl: absoluteUrl('/login'),
          recipient: user.email,
        })
      }
    } catch (err) {
      console.error(`[nudges] falha ao processar usuário ${user.id}`, err)
    }
  }
}

const ONE_HOUR_MS = 60 * 60 * 1000

/**
 * Sobe o scheduler in-process (1 tick/hora). Não inicia em testes (que usam só
 * buildApp). O tick é idempotente, então timing exato e restart não duplicam.
 */
export function startNudgeScheduler(): void {
  if (process.env.NODE_ENV === 'test') return
  setInterval(() => {
    runNudgeTick(new Date()).catch((err) => console.error('[nudges] tick falhou', err))
    runVoteReminderTick(new Date()).catch((err) => console.error('[vote-reminders] tick falhou', err))
  }, ONE_HOUR_MS)
}

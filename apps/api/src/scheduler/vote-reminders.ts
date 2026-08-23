import { prisma } from '../lib/prisma'
import type { VotingPeriod } from '@prisma/client'
import { getCurrentOpenPeriod } from '../services/voting-service'
import { createNotification } from '../services/notification-service'
import { monthLabel } from '../lib/month-label'

const ONE_HOUR_MS = 60 * 60 * 1000

type Marco = 'MIDWAY' | 'CLOSING'

/**
 * Marco do lembrete neste tick, ou null. CLOSING tem prioridade (cobre o caso
 * de janelas muito curtas em que o ponto médio cai na última hora).
 */
function marcoFor(now: Date, period: VotingPeriod): Marco | null {
  const start = period.startsAt.getTime()
  const end = period.endsAt.getTime()
  const t = now.getTime()
  const midpoint = start + (end - start) / 2
  const closingStart = end - ONE_HOUR_MS
  if (t >= closingStart && t < end) return 'CLOSING'
  if (t >= midpoint && t < closingStart) return 'MIDWAY'
  return null
}

/**
 * Um tick de lembrete de votação. `now` é injetável (testável sem timers).
 * Cada setor tem sua própria janela de votação — o tick percorre todos os
 * setores de todas as empresas e processa o período aberto de cada um
 * independentemente, só notificando usuários do PRÓPRIO setor (nunca vaza
 * aviso entre setores nem entre empresas).
 */
export async function runVoteReminderTick(now: Date): Promise<void> {
  const sectors = await prisma.sector.findMany({ select: { id: true, companyId: true } })
  for (const sector of sectors) {
    await runVoteReminderTickForSector(sector.id, sector.companyId, now)
  }
}

/**
 * No ponto médio da janela e na última hora antes do fim, notifica cada
 * usuário ativo não-ADMIN do setor que ainda não votou. Idempotente por
 * marco/período: o dedup é feito pelo `metadata.periodId` gravado na
 * notificação, garantindo que movimentações na janela do período (admin
 * edita `startsAt`/`endsAt`) não re-disparem o mesmo marco. O Teams é
 * espelhado pelo próprio `createNotification`.
 */
async function runVoteReminderTickForSector(sectorId: string, companyId: string, now: Date): Promise<void> {
  const period = await getCurrentOpenPeriod(sectorId, companyId, now)
  if (!period) return

  const marco = marcoFor(now, period)
  if (!marco) return

  const type = marco === 'MIDWAY' ? 'VOTE_REMINDER_MIDWAY' : 'VOTE_REMINDER_CLOSING'
  const mes = monthLabel(period.monthRef)
  const title =
    marco === 'MIDWAY'
      ? `A votação de ${mes} está na metade e você ainda não votou. Reconheça um colega!`
      : `Última hora pra votar em ${mes} — não deixe pra depois!`

  const users = await prisma.user.findMany({
    where: { active: true, role: { notIn: ['ADMIN', 'SUBADMIN'] }, sectorId },
    select: { id: true },
  })

  for (const user of users) {
    try {
      const voted = await prisma.vote.findFirst({
        where: { voterId: user.id, periodId: period.id },
        select: { id: true },
      })
      if (voted) continue

      const already = await prisma.notification.findFirst({
        where: {
          userId: user.id,
          type,
          metadata: { path: ['periodId'], equals: period.id },
        },
      })
      if (already) continue

      await createNotification({ userId: user.id, type, title, link: '/votar', metadata: { periodId: period.id }, companyId })
    } catch (err) {
      console.error(`[vote-reminders] falha ao processar usuário ${user.id}`, err)
    }
  }
}

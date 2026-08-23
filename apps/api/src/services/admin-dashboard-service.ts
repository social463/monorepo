import type { AdminDashboardResponse, SectorDashboardCardDTO } from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'
import { derivePeriodState } from '../lib/period-state'

export async function getAdminDashboard(now: Date = new Date(), companyId: string, sectorId?: string): Promise<AdminDashboardResponse> {
  const db = scopedPrisma(companyId)
  const sectors = await db.sector.findMany({
    where: sectorId ? { id: sectorId } : undefined,
    orderBy: { name: 'asc' },
  })
  const cards: SectorDashboardCardDTO[] = []

  for (const sector of sectors) {
    const [activeUserCount, periods] = await Promise.all([
      db.user.count({ where: { sectorId: sector.id, active: true } }),
      db.votingPeriod.findMany({ where: { sectorId: sector.id }, orderBy: { startsAt: 'desc' } }),
    ])

    // Um setor pode ter mais de um período não encerrado ao mesmo tempo (só
    // (sectorId, monthRef) é único). Prioridade: ACTIVE sempre vence sobre
    // SCHEDULED; entre SCHEDULED, o de startsAt mais próximo (mesma semântica
    // de getCurrentOpenPeriod/getNextScheduledPeriod em voting-service.ts).
    const activePeriod = periods.find((p) => derivePeriodState(p, now) === 'ACTIVE')
    const scheduledPeriods = periods.filter((p) => derivePeriodState(p, now) === 'SCHEDULED')
    const nearestScheduled = scheduledPeriods.reduce<(typeof periods)[number] | undefined>((nearest, p) => {
      if (!nearest || p.startsAt < nearest.startsAt) return p
      return nearest
    }, undefined)
    const openOrScheduled = activePeriod ?? nearestScheduled
    const lastEnded = periods.find((p) => derivePeriodState(p, now) === 'ENDED')

    let votesCast = 0
    let periodCard: SectorDashboardCardDTO['period'] = null
    if (openOrScheduled) {
      votesCast = await db.vote.count({ where: { periodId: openOrScheduled.id } })
      periodCard = {
        id: openOrScheduled.id,
        monthRef: openOrScheduled.monthRef,
        state: derivePeriodState(openOrScheduled, now),
        startsAt: openOrScheduled.startsAt.toISOString(),
        endsAt: openOrScheduled.endsAt.toISOString(),
        votesCast,
      }
    }

    cards.push({
      sectorId: sector.id,
      sectorName: sector.name,
      activeUserCount,
      period: periodCard,
      pendingHighlight: lastEnded ? lastEnded.highlightStatus !== 'PUBLISHED' : false,
    })
  }

  return { sectors: cards }
}

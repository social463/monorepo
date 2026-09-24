/**
 * Lembrete do prazo da campanha de férias.
 *
 * Substitui o "confirme e nos sinalize por e-mail para o DP" da ferramenta de
 * origem: em vez de a G&G caçar gestor, o portal cobra quem ainda tem gente sem
 * programar — no sino e, para quem tem webhook, no Teams.
 *
 * **Cobra o gestor, não o colaborador.** Quem preenche é a liderança; avisar a
 * pessoa de que o líder dela está atrasado só produziria constrangimento sem
 * mudar nada.
 *
 * Antecedência em DIAS, então "7 dias antes" é um dia, não um instante: o tick é
 * horário e o disparo sai às 9h de São Paulo do dia `prazo − offset`. Mesmo
 * molde de `calendar-event-reminders`.
 *
 * A reivindicação é o próprio `Notification` do dia: antes de criar, o tick
 * procura um `VACATION_PLAN_DEADLINE` para aquele gestor criado depois da
 * meia-noite de hoje. Diferente do calendário, aqui não há tabela de controle —
 * e não precisa, porque a chave natural é (gestor, dia) e a consulta é barata.
 */
import { VACATION_DEADLINE_REMINDER_DAYS } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { dayFromYmd, hourInSaoPaulo, ymdInSaoPaulo } from '../lib/sao-paulo-date'
import { createNotification } from '../services/notification-service'

const TICK_MS = 60 * 60 * 1000

/** Hora do disparo em São Paulo — de manhã, como os outros lembretes. */
const REMINDER_HOUR = 9

/** Um tick. `now` é injetável para o teste não depender de timer. */
export async function runVacationDeadlineReminderTick(now: Date): Promise<number> {
  if (hourInSaoPaulo(now) !== REMINDER_HOUR) return 0

  const today = ymdInSaoPaulo(now)
  const campaigns = await prisma.vacationCampaign.findMany({
    where: { manuallyLocked: false, deadline: { gte: dayFromYmd(today) } },
  })

  let enviados = 0
  for (const campaign of campaigns) {
    const faltam = Math.round(
      (campaign.deadline.getTime() - dayFromYmd(today).getTime()) / 86_400_000,
    )
    if (!(VACATION_DEADLINE_REMINDER_DAYS as readonly number[]).includes(faltam)) continue

    // Quem ainda tem gente sem programar. Plano validado ou confirmado está
    // resolvido; rascunho e ausência de plano, não.
    const pendentes = await prisma.vacationEntitlement.findMany({
      where: {
        companyId: campaign.companyId,
        user: { active: true, managerId: { not: null } },
        OR: [
          { plans: { none: { campaignId: campaign.id } } },
          { plans: { some: { campaignId: campaign.id, status: 'DRAFT' } } },
        ],
      },
      select: { user: { select: { managerId: true } } },
    })

    const porGestor = new Map<string, number>()
    for (const item of pendentes) {
      const managerId = item.user.managerId!
      porGestor.set(managerId, (porGestor.get(managerId) ?? 0) + 1)
    }

    for (const [managerId, quantos] of porGestor) {
      const jaAvisado = await prisma.notification.findFirst({
        where: {
          userId: managerId,
          type: 'VACATION_PLAN_DEADLINE',
          createdAt: { gte: dayFromYmd(today) },
        },
        select: { id: true },
      })
      if (jaAvisado) continue

      await createNotification({
        userId: managerId,
        companyId: campaign.companyId,
        type: 'VACATION_PLAN_DEADLINE',
        title:
          faltam === 0
            ? `Hoje é o último dia para programar as férias de ${campaign.year}: ${quantos} pendente(s) no seu time`
            : `Faltam ${faltam} dia(s) para o prazo das férias de ${campaign.year} — ${quantos} pendente(s) no seu time`,
        link: '/lideranca',
      })
      enviados += 1
    }
  }
  return enviados
}

export function startVacationDeadlineReminderScheduler(): void {
  if (process.env.NODE_ENV === 'test') return
  setInterval(() => {
    runVacationDeadlineReminderTick(new Date()).catch((err) =>
      console.error('[vacation-deadline-reminders] tick falhou', err),
    )
  }, TICK_MS)
}

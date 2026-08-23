/**
 * Lembrete de 1:1: 10 minutos antes, uma notificação in-app para as duas
 * pessoas do par.
 *
 * **Não vai para o Teams, de propósito.** Todo o resto do 1:1 (convite, ação
 * combinada) espelha na DM de quem tem webhook; este não. O lembrete de 10
 * minutos é para quem está com o Legends aberto agora, e uma DM que chega junto
 * com o convite do calendário e com o lembrete do próprio Teams vira a terceira
 * batida do mesmo aviso. Daí o `skipTeamsMirror`.
 *
 * A reivindicação é `updateMany({ where: { remindedAt: null } })`, molde do
 * `meeting-reminders.ts`: o `UPDATE ... WHERE remindedAt IS NULL` é atômico no
 * Postgres, então de duas tentativas concorrentes (tick sobreposto, ou dois
 * processos) só uma tem `count === 1` — essa notifica; a outra pula.
 *
 * Trade-off herdado do molde e aceito igual: reivindica antes de notificar, então
 * falha na entrega perde aquele lembrete — não há nova tentativa.
 */
import { ONE_ON_ONE_REMINDER_MINUTES } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { hhmmInSaoPaulo } from '../lib/sao-paulo-date'
import { effectiveInviteResponse } from '../lib/serialize-one-on-one'
import { createNotification } from '../services/notification-service'

const TICK_MS = 60 * 1000

/** Um tick. `now` é injetável (testável sem timers). */
export async function runOneOnOneReminderTick(now: Date): Promise<void> {
  const limite = new Date(now.getTime() + ONE_ON_ONE_REMINDER_MINUTES * 60 * 1000)

  const meetings = await prisma.oneOnOneMeeting.findMany({
    where: {
      status: 'SCHEDULED',
      remindedAt: null,
      startsAt: { gt: now, lte: limite },
    },
    include: { series: { select: { userAId: true, userBId: true, inviteeResponse: true } } },
  })

  for (const meeting of meetings) {
    // Encontro que uma das pontas recusou não gera lembrete: avisar sobre ele é
    // ruído, e avisar só o outro lado seria pior.
    if (effectiveInviteResponse(meeting) === 'DECLINED') continue
    try {
      const reivindicado = await prisma.oneOnOneMeeting.updateMany({
        where: { id: meeting.id, remindedAt: null },
        data: { remindedAt: now },
      })
      if (reivindicado.count === 0) continue

      // O título é do ponto de vista de quem recebe — cada lado vê o nome do
      // OUTRO —, então não dá para montar um só e reaproveitar.
      const pares = [
        { userId: meeting.series.userAId, outroId: meeting.series.userBId },
        { userId: meeting.series.userBId, outroId: meeting.series.userAId },
      ]
      const nomes = await prisma.user.findMany({
        where: { id: { in: [meeting.series.userAId, meeting.series.userBId] } },
        select: { id: true, name: true },
      })
      const nomePor = new Map(nomes.map((u) => [u.id, u.name]))

      for (const { userId, outroId } of pares) {
        await createNotification({
          userId,
          type: 'ONE_ON_ONE_REMINDER',
          // A hora vai no título, e não um "começa em instantes": a notificação
          // fica no sino até ser lida, então quem só abrir o Legends no dia
          // seguinte precisa que o texto ainda faça sentido.
          title: `Seu 1:1 com ${nomePor.get(outroId) ?? 'seu par'} começa às ${hhmmInSaoPaulo(meeting.startsAt)}`,
          link: `/1-1/${meeting.id}`,
          companyId: meeting.companyId,
          skipTeamsMirror: true,
        })
      }
    } catch (err) {
      console.error(`[one-on-one-reminders] falha no encontro ${meeting.id}`, err)
    }
  }
}

/**
 * Tick de 1 minuto — a granularidade horária dos nudges não serve para um
 * lembrete de 10 minutos. Não sobe em teste (que usa só buildApp).
 */
export function startOneOnOneReminderScheduler(): void {
  if (process.env.NODE_ENV === 'test') return
  setInterval(() => {
    runOneOnOneReminderTick(new Date()).catch((err) =>
      console.error('[one-on-one-reminders] tick falhou', err),
    )
  }, TICK_MS)
}

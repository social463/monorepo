/**
 * Lembrete de reunião de sala: 10 minutos antes, uma notificação in-app para
 * organizador e convidados — que o `createNotification` já espelha como card na
 * DM do Teams de quem tem webhook.
 *
 * A reivindicação da reunião é feita com `updateMany({ where: { remindedAt: null } })`:
 * o `UPDATE ... WHERE remindedAt IS NULL` é atômico no Postgres, então de duas
 * tentativas concorrentes (tick sobreposto no mesmo processo, ou dois processos)
 * só uma tem `count === 1` — essa é quem notifica; a outra vê `count === 0` e
 * pula a reunião. Isso é o que de fato impede lembrete duplicado.
 *
 * O que continua sendo trade-off aceito: se a notificação falhar depois da
 * reivindicação, o lembrete se perde (não há nova tentativa); e se a lista de
 * destinatários falhar no meio, a entrega fica parcial — outra iteração do loop
 * não vai reprocessar essa reunião porque ela já foi reivindicada.
 */
import { MEETING_REMINDER_MINUTES, officeRoomDeepLinkPath } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { hhmmInSaoPaulo } from '../lib/sao-paulo-date'
import { createNotification } from '../services/notification-service'

const TICK_MS = 60 * 1000

export async function runMeetingReminderTick(now: Date): Promise<void> {
  const limite = new Date(now.getTime() + MEETING_REMINDER_MINUTES * 60 * 1000)

  const meetings = await prisma.officeMeeting.findMany({
    where: {
      canceledAt: null,
      remindedAt: null,
      startsAt: { gt: now, lte: limite },
    },
    include: { participants: { select: { userId: true } } },
  })

  for (const meeting of meetings) {
    try {
      // Reivindicação condicional: o WHERE remindedAt: null torna o UPDATE
      // atômico no Postgres. Se count vier 0, outro tick (ou outro processo)
      // já reivindicou essa reunião entre o findMany e aqui — pula sem notificar.
      const reivindicada = await prisma.officeMeeting.updateMany({
        where: { id: meeting.id, remindedAt: null },
        data: { remindedAt: now },
      })
      if (reivindicada.count === 0) continue

      const destinatarios = [meeting.organizerId, ...meeting.participants.map((p) => p.userId)]
      // A hora vai no título, e não um "começa em instantes": a notificação fica
      // no sino até ser lida, e "em instantes" lido no dia seguinte é mentira.
      const title = `"${meeting.title}" começa às ${hhmmInSaoPaulo(meeting.startsAt)} na sala ${meeting.roomName}`

      for (const userId of new Set(destinatarios)) {
        await createNotification({
          userId,
          type: 'MEETING_REMINDER',
          title,
          link: officeRoomDeepLinkPath(meeting.roomExternalKey),
          companyId: meeting.companyId,
        })
      }
    } catch (err) {
      console.error(`[meeting-reminders] falha na reunião ${meeting.id}`, err)
    }
  }
}

/**
 * Tick de 1 minuto — a granularidade horária do scheduler de nudges não serve
 * para um lembrete de 10 minutos. Não sobe em teste (que usa só buildApp).
 */
export function startMeetingReminderScheduler(): void {
  if (process.env.NODE_ENV === 'test') return
  setInterval(() => {
    runMeetingReminderTick(new Date()).catch((err) =>
      console.error('[meeting-reminders] tick falhou', err),
    )
  }, TICK_MS)
}

/**
 * Publicação de comunicado agendado (Documento 4, seção 12).
 *
 * O comunicado agendado nasce `SCHEDULED` com `publishAt` preenchido e fica
 * fora do feed (`feedWhere` só enxerga `PUBLISHED`). Este tick vira o status no
 * instante marcado e chama o MESMO `announceCorporatePostPublished` da
 * publicação imediata.
 *
 * **Por que um job, e não publicação preguiçosa na leitura do feed.** Tratar
 * `SCHEDULED` vencido como publicado na hora de listar seria menos código e
 * estaria errado: o comunicado apareceria no feed sem sininho e sem card no
 * Teams, porque `notifyCorporatePostPublished` só roda no ato da publicação.
 * Comunicado agendado que ninguém é avisado que saiu não é comunicado.
 *
 * A reivindicação é o `updateMany({ where: { status: 'SCHEDULED' } })`: o
 * `UPDATE ... WHERE status = 'SCHEDULED'` é atômico no Postgres, então de dois
 * ticks concorrentes (sobreposição no mesmo processo, ou dois processos) só um
 * tem `count === 1` — é ele que notifica. Mesmo molde do `remindedAt` de
 * `meeting-reminders`, e com o mesmo trade-off aceito: falha na notificação
 * depois da reivindicação perde o aviso, sem nova tentativa. O post, porém,
 * fica publicado — o que é o certo: republicar depois duplicaria o comunicado.
 */
import { prisma } from '../lib/prisma'
import { announceCorporatePostPublished } from '../services/corporate-mural-service'

const TICK_MS = 60 * 1000

/** Um tick. `now` é injetável, para o teste não depender de timer. */
export async function runScheduledPostTick(now: Date): Promise<void> {
  const vencidos = await prisma.corporatePost.findMany({
    where: { status: 'SCHEDULED', publishAt: { lte: now } },
    select: {
      id: true,
      title: true,
      authorId: true,
      companyId: true,
      audienceScope: true,
      mentions: { select: { userId: true } },
      sectors: { select: { sectorId: true } },
    },
  })

  for (const post of vencidos) {
    try {
      const reivindicado = await prisma.corporatePost.updateMany({
        where: { id: post.id, status: 'SCHEDULED' },
        data: {
          status: 'PUBLISHED',
          // Mesmo motivo do reset em `approvePost`: o card do mural exibe
          // `createdAt`, e o feed é ordenado por ele. Manter o instante do
          // agendamento faria o card mostrar a hora marcada (ex. 11h31) em vez
          // da hora real em que o comunicado ficou visível (ex. 12h20).
          createdAt: new Date(),
        },
      })
      if (reivindicado.count === 0) continue

      await announceCorporatePostPublished(post, post.companyId, {
        error: (err) => console.error(`[scheduled-posts] notificação do post ${post.id}`, err),
      })
    } catch (err) {
      console.error(`[scheduled-posts] falha no comunicado ${post.id}`, err)
    }
  }
}

/**
 * Tick de 1 minuto: "agendado para 14h30" tem que sair às 14h30, e a
 * granularidade horária do scheduler de nudges atrasaria até 59 minutos.
 * Não sobe em teste (que usa só `buildApp`).
 */
export function startScheduledPostScheduler(): void {
  if (process.env.NODE_ENV === 'test') return
  setInterval(() => {
    runScheduledPostTick(new Date()).catch((err) =>
      console.error('[scheduled-posts] tick falhou', err),
    )
  }, TICK_MS)
}

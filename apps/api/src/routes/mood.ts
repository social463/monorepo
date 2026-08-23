import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  MOOD_LEVELS,
  MOOD_NOTE_MAX_LENGTH,
  MOOD_REASON_REQUIRED_MESSAGE,
  MOOD_SCORES,
  MOOD_SELECTABLE_REASONS,
  isNegativeMood,
} from '@legends/shared'
import { captureFor } from '../lib/analytics/request'
import { MoodAlreadyAnsweredError, getTodayMood, setTodayMood, todayInSaoPaulo } from '../services/mood-service'
import { toTodayMoodDTO } from '../lib/serialize'
import { evaluateStreakBadgesForUser } from '../services/badge-service'
import { notifyBadgesEarned } from '../services/notification-service'
import { awardCoins } from '../services/coin-service'
import { awardXp } from '../services/xp-service'

const setMoodSchema = z.object({
  mood: z.enum(MOOD_LEVELS),
  note: z.string().trim().max(MOOD_NOTE_MAX_LENGTH).optional(),
  // Motivo só vale para humor negativo — o service descarta o resto (ver
  // setTodayMood). `nullish` para o front poder limpar a escolha ao trocar para
  // um humor positivo; a obrigatoriedade no humor negativo é checada abaixo, e
  // não aqui, para a mensagem sair em português em vez de erro de schema.
  // Só os motivos SELECIONÁVEIS entram: os legados existem no enum para o
  // painel de clima ler o passado, não para alguém escolher de novo.
  reason: z.enum(MOOD_SELECTABLE_REASONS).nullish(),
})

export async function moodRoutes(app: FastifyInstance) {
  app.get('/me/mood/today', { onRequest: [app.authenticate] }, async (request, reply) => {
    const { ymd } = todayInSaoPaulo()
    const today = await getTodayMood(request.user.sub, request.user.companyId)
    return reply.send(toTodayMoodDTO(ymd, today?.mood ?? null, today?.note ?? null, today?.reason ?? null))
  })

  app.put('/me/mood/today', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = setMoodSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    // Humor negativo sem motivo é recusado no servidor, e não só na tela: o
    // motivo é o que o painel de clima usa para dizer O QUÊ está pesando, e um
    // "Não informado" que cresce sozinho esvazia o painel inteiro.
    if (isNegativeMood(parsed.data.mood) && !parsed.data.reason) {
      return reply.code(400).send({ message: MOOD_REASON_REQUIRED_MESSAGE })
    }
    const { ymd } = todayInSaoPaulo()
    // Nota ausente ou vazia (após trim) é guardada como null.
    const note = parsed.data.note && parsed.data.note.length > 0 ? parsed.data.note : null
    let today
    try {
      today = await setTodayMood(
        request.user.sub,
        request.user.companyId,
        parsed.data.mood,
        note,
        parsed.data.reason ?? null,
      )
    } catch (err) {
      if (err instanceof MoodAlreadyAnsweredError) {
        return reply.code(err.status).send({ message: err.message })
      }
      throw err
    }
    // Avaliação dos selos de ofensiva: best-effort, nunca derruba o registro.
    try {
      const awarded = await evaluateStreakBadgesForUser(request.user.sub)
      if (awarded.length > 0) {
        await notifyBadgesEarned(request.user.sub, awarded.map((b) => b.badgeId), request.user.companyId)
      }
    } catch (err) {
      request.log.error(err)
    }
    // Crédito de EMR Coins, best-effort e em try próprio. A referência é o dia civil:
    // trocar o humor no mesmo dia não credita de novo.
    try {
      await awardCoins({
        userId: request.user.sub,
        companyId: request.user.companyId,
        event: 'MOOD_ANSWERED',
        reference: ymd,
      })
    } catch (coinErr) {
      request.log.error(coinErr)
    }
    // XP em try próprio: as duas moedas têm regras independentes.
    try {
      await awardXp({
        userId: request.user.sub,
        companyId: request.user.companyId,
        event: 'MOOD_ANSWERED',
        reference: ymd,
      })
    } catch (xpErr) {
      request.log.error(xpErr)
    }
    captureFor(request, 'mood_registered', {
      scale: MOOD_SCORES[today.mood],
      reason: today.reason,
    })
    return reply.send(toTodayMoodDTO(ymd, today.mood, today.note, today.reason))
  })
}

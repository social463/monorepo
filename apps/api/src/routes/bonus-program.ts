/**
 * Configuração do Todos Pelos 9 (Documento 4, seção 14).
 *
 * Duas guardas diferentes de propósito: **ler é de todo mundo logado**, porque
 * a calculadora precisa dos pools e do total de cotas para fazer a conta, e a
 * página é do colaborador; **escrever é do bloco de Gente e Gestão**, que é
 * quem responde pelos números do programa.
 */

import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import type { BonusProgramSettings } from '@legends/shared'
import {
  BonusProgramError,
  getBonusProgram,
  updateBonusProgram,
} from '../services/bonus-program-service'

const tierSchema = z.object({
  percent: z.number().positive().max(1000),
  pool: z.number().nonnegative().max(1_000_000_000_000),
})

const updateSchema = z.object({
  totalQuotas: z.number().positive().max(1_000_000_000_000),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida'),
  tiers: z.array(tierSchema).min(1).max(20),
  manualId: z.string().min(1).nullable(),
})

function handle(err: unknown, reply: FastifyReply) {
  if (err instanceof BonusProgramError) return reply.code(err.status).send({ message: err.message })
  throw err
}

export async function bonusProgramRoutes(app: FastifyInstance) {
  app.get('/bonus-program', { onRequest: [app.authenticate] }, async (request, reply) => {
    const settings = await getBonusProgram(request.user.companyId)
    return reply.send({ settings })
  })

  app.put(
    '/admin/bonus-program',
    { onRequest: [app.authenticate, app.requireSectorFeature('gente-gestao')] },
    async (request, reply) => {
      const parsed = updateSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
      }
      try {
        const settings = await updateBonusProgram(
          { id: request.user.sub, companyId: request.user.companyId },
          parsed.data as BonusProgramSettings,
        )
        return reply.send({ settings })
      } catch (err) {
        return handle(err, reply)
      }
    },
  )
}

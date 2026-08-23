import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getDevelopmentSettings, updateDevelopmentSettings } from '../services/development-settings-service'

const updateSchema = z.object({
  leaderApprovalRequired: z.boolean().optional(),
  impulseUpUrl: z.string().trim().url().nullable().optional().or(z.literal('')),
  inovaCommunityUrl: z.string().trim().url().nullable().optional().or(z.literal('')),
})

export async function developmentRoutes(app: FastifyInstance) {
  /**
   * Configuração da aba Desenvolvimento. Só autenticação (sem feature gate): o
   * front usa a resposta pra decidir se mostra o item externo do ImpulseUP no
   * menu, e esse item não pertence nem ao Aprendizado nem ao PDI.
   */
  app.get('/development/settings', { onRequest: [app.authenticate] }, async (request, reply) => {
    return reply.send({ settings: await getDevelopmentSettings(request.user.companyId) })
  })

  app.patch(
    '/admin/development/settings',
    { onRequest: [app.authenticate, app.requireAdminOrSubadmin] },
    async (request, reply) => {
      const parsed = updateSchema.safeParse(request.body)
      if (!parsed.success) {
        return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.flatten() })
      }
      const settings = await updateDevelopmentSettings({
        leaderApprovalRequired: parsed.data.leaderApprovalRequired,
        impulseUpUrl: parsed.data.impulseUpUrl === '' ? null : parsed.data.impulseUpUrl,
        inovaCommunityUrl: parsed.data.inovaCommunityUrl === '' ? null : parsed.data.inovaCommunityUrl,
        actorId: request.user.sub,
        companyId: request.user.companyId,
      })
      return reply.send({ settings })
    },
  )
}

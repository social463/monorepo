import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  AI_API_KEY_MAX_LENGTH,
  AI_BASE_URL_MAX_LENGTH,
  AI_MODEL_MAX_LENGTH,
  AI_PROVIDERS,
} from '@legends/shared'
import { getAiSettings, updateAiSettings } from '../services/ai-settings-service'

/**
 * `.trim()` fica de fora de propósito: string vazia precisa chegar ao service
 * como sinal explícito de "remover a chave". O trim acontece lá.
 *
 * `baseUrl` aceita vazio (limpa) ou uma URL http(s) — o valor vira endpoint de
 * requisição do servidor, então validar aqui evita mandar o agente para
 * `file://` ou coisa pior.
 */
const updateSchema = z.object({
  provider: z.enum(AI_PROVIDERS).optional(),
  apiKey: z.string().max(AI_API_KEY_MAX_LENGTH).optional(),
  model: z.string().max(AI_MODEL_MAX_LENGTH).optional(),
  baseUrl: z
    .string()
    .max(AI_BASE_URL_MAX_LENGTH)
    .refine((value) => value.trim() === '' || /^https?:\/\/\S+$/i.test(value.trim()), {
      message: 'A URL da API deve começar com http:// ou https://.',
    })
    .optional(),
})

/**
 * Configuração da credencial de IA da empresa. Guarda mais apertada que a dos
 * agentes: SUBADMIN **usa** o agente, mas não vê nem edita a chave — por isso
 * `requireAdmin`, e não `requireAdminOrSubadmin`.
 */
export async function aiSettingsRoutes(app: FastifyInstance) {
  const adminOnly = { onRequest: [app.authenticate, app.requireAdmin] }

  app.get('/admin/ai-settings', adminOnly, async (request, reply) => {
    return reply.send(await getAiSettings(request.user.companyId))
  })

  app.put('/admin/ai-settings', adminOnly, async (request, reply) => {
    const parsed = updateSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    const settings = await updateAiSettings({
      companyId: request.user.companyId,
      actorId: request.user.sub,
      body: parsed.data,
    })
    return reply.send(settings)
  })
}

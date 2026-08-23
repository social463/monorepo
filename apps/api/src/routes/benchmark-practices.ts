import type { FastifyInstance, FastifyReply } from 'fastify'
import { z } from 'zod'
import {
  BENCHMARK_PRACTICE_CATEGORY_MAX_LENGTH,
  BENCHMARK_PRACTICE_CHANNEL_MAX_LENGTH,
  BENCHMARK_PRACTICE_DESCRIPTION_MAX_LENGTH,
  BENCHMARK_PRACTICE_MAX_TAGS,
  BENCHMARK_PRACTICE_TAG_MAX_LENGTH,
  BENCHMARK_PRACTICE_TITLE_MAX_LENGTH,
} from '@legends/shared'
import { AgentError } from '../lib/agent-error'
import { toBenchmarkPracticeDTO } from '../lib/serialize'
import {
  createBenchmarkPractice,
  deleteBenchmarkPractice,
  listBenchmarkPractices,
  updateBenchmarkPractice,
  type BenchmarkActor,
} from '../services/benchmark-practice-service'

const idParamsSchema = z.object({ id: z.string().min(1) })

const baseSchema = {
  category: z.string().trim().min(1).max(BENCHMARK_PRACTICE_CATEGORY_MAX_LENGTH),
  title: z.string().trim().min(1).max(BENCHMARK_PRACTICE_TITLE_MAX_LENGTH),
  description: z.string().trim().max(BENCHMARK_PRACTICE_DESCRIPTION_MAX_LENGTH).nullable().optional(),
  channel: z.string().trim().max(BENCHMARK_PRACTICE_CHANNEL_MAX_LENGTH).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(BENCHMARK_PRACTICE_TAG_MAX_LENGTH)).max(BENCHMARK_PRACTICE_MAX_TAGS).optional(),
}
const createSchema = z.object(baseSchema)
const updateSchema = z.object(baseSchema).partial()

function handleAgentError(err: unknown, reply: FastifyReply) {
  if (err instanceof AgentError) return reply.code(err.status).send({ message: err.message })
  throw err
}

function actorFrom(request: { user: { sub: string; companyId: string } }): BenchmarkActor {
  return { id: request.user.sub, companyId: request.user.companyId }
}

/**
 * Inventário de práticas internas — o contexto que o agente de Benchmarking
 * compara com o mercado. Mesma guarda do agente: ADMIN, ou SUBADMIN do setor
 * com a feature `gente-gestao` ligada.
 */
export async function benchmarkPracticeRoutes(app: FastifyInstance) {
  const guard = { onRequest: [app.authenticate, app.requireSectorFeature('gente-gestao')] }

  app.get('/admin/benchmark-practices', guard, async (request, reply) => {
    const practices = await listBenchmarkPractices(actorFrom(request))
    return reply.send({ practices: practices.map(toBenchmarkPracticeDTO) })
  })

  app.post('/admin/benchmark-practices', guard, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      const created = await createBenchmarkPractice(actorFrom(request), parsed.data)
      return reply.code(201).send({ practice: toBenchmarkPracticeDTO(created) })
    } catch (err) {
      return handleAgentError(err, reply)
    }
  })

  app.patch('/admin/benchmark-practices/:id', guard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ message: 'Parâmetros inválidos.', issues: params.error.issues })
    }
    const parsed = updateSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.issues })
    }
    try {
      const updated = await updateBenchmarkPractice(actorFrom(request), params.data.id, parsed.data)
      return reply.send({ practice: toBenchmarkPracticeDTO(updated) })
    } catch (err) {
      return handleAgentError(err, reply)
    }
  })

  app.delete('/admin/benchmark-practices/:id', guard, async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params)
    if (!params.success) {
      return reply.code(400).send({ message: 'Parâmetros inválidos.', issues: params.error.issues })
    }
    try {
      await deleteBenchmarkPractice(actorFrom(request), params.data.id)
      return reply.code(204).send()
    } catch (err) {
      return handleAgentError(err, reply)
    }
  })
}

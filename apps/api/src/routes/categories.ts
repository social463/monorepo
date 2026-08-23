import type { FastifyInstance } from 'fastify'
import { listCategories } from '../services/category-service'
import { toRecognitionCategoryDTO } from '../lib/serialize'

/**
 * Catálogo de categorias da empresa — o mesmo para o feedback e para o voto
 * (`specs/2026-08-20-unificar-reconhecimento-em-feedback-design.md`). Só as
 * ativas: a inativa continua existindo nos feedbacks e votos antigos, mas não
 * pode ser escolhida de novo.
 */
export async function categoryRoutes(app: FastifyInstance) {
  app.get('/categories', { onRequest: [app.authenticate] }, async (request, reply) => {
    const categories = await listCategories(request.user.companyId, { activeOnly: true })
    return reply.send({ categories: categories.map(toRecognitionCategoryDTO) })
  })
}

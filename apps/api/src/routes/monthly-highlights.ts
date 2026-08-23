import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  HIGHLIGHT_MESSAGE_MAX_LENGTH,
  MAX_HIGHLIGHTS_PER_REQUEST,
  canManageMonthlyHighlights,
  isMonthRef,
} from '@legends/shared'
import {
  MonthlyHighlightError,
  createMany,
  listByMonth,
  listForUser,
  listMonthsWithHighlights,
  removeHighlight,
  updateHighlight,
} from '../services/monthly-highlight-service'
import { toMonthlyHighlightDTO, toMonthlyHighlightGroups } from '../lib/serialize'

/** Mês corrente em São Paulo, que é o default de quem abre a tela. */
function currentMonthRef(): string {
  const now = new Date()
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  })
  return formatter.format(now).slice(0, 7)
}

const createSchema = z.object({
  monthRef: z.string().refine(isMonthRef, { message: 'Mês inválido.' }),
  userIds: z.array(z.string().min(1)).min(1).max(MAX_HIGHLIGHTS_PER_REQUEST),
  message: z.string().trim().max(HIGHLIGHT_MESSAGE_MAX_LENGTH).optional(),
})

const updateSchema = z.object({
  message: z.string().trim().max(HIGHLIGHT_MESSAGE_MAX_LENGTH).nullable().optional(),
})

export async function monthlyHighlightRoutes(app: FastifyInstance) {
  const auth = { onRequest: [app.authenticate] }
  // Cadastrar/editar/excluir é da administração; visualizar é de todo mundo —
  // é a tabela de permissões do documento (Colaborador e Líder só enxergam).
  const adminGuard = { onRequest: [app.authenticate, app.requireAdminOrSubadmin] }

  app.get('/monthly-highlights', auth, async (request, reply) => {
    const query = request.query as { monthRef?: string }
    const monthRef = query.monthRef && isMonthRef(query.monthRef) ? query.monthRef : currentMonthRef()
    try {
      const rows = await listByMonth(request.user.companyId, monthRef)
      return reply.send({
        monthRef,
        groups: toMonthlyHighlightGroups(rows),
        total: rows.length,
        // A web usa isto para decidir se mostra "+ Adicionar destaque"; o
        // servidor continua sendo a autoridade (403 no POST).
        canManage: canManageMonthlyHighlights(request.user.role, request.user.adminAccess),
      })
    } catch (err) {
      if (err instanceof MonthlyHighlightError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  /** Meses que já têm destaque — o seletor não precisa chutar um intervalo. */
  app.get('/monthly-highlights/months', auth, async (request, reply) => {
    const months = await listMonthsWithHighlights(request.user.companyId)
    return reply.send({ months })
  })

  /** Aba "Meus reconhecimentos": o que ESTA pessoa recebeu. */
  app.get('/monthly-highlights/mine', auth, async (request, reply) => {
    const query = request.query as { monthRef?: string }
    try {
      const rows = await listForUser(request.user.sub, request.user.companyId, {
        monthRef: query.monthRef && isMonthRef(query.monthRef) ? query.monthRef : undefined,
      })
      return reply.send({ highlights: rows.map(toMonthlyHighlightDTO) })
    } catch (err) {
      if (err instanceof MonthlyHighlightError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/monthly-highlights', adminGuard, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.flatten() })
    }
    try {
      const created = await createMany({
        monthRef: parsed.data.monthRef,
        userIds: parsed.data.userIds,
        message: parsed.data.message,
        actorId: request.user.sub,
        companyId: request.user.companyId,
      })
      return reply.code(201).send({ highlights: created.map(toMonthlyHighlightDTO) })
    } catch (err) {
      if (err instanceof MonthlyHighlightError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.patch('/monthly-highlights/:id', adminGuard, async (request, reply) => {
    const parsed = updateSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos.', issues: parsed.error.flatten() })
    }
    const { id } = request.params as { id: string }
    try {
      const updated = await updateHighlight({
        id,
        message: parsed.data.message,
        actorId: request.user.sub,
        companyId: request.user.companyId,
      })
      return reply.send({ highlight: toMonthlyHighlightDTO(updated) })
    } catch (err) {
      if (err instanceof MonthlyHighlightError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/monthly-highlights/:id', adminGuard, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      await removeHighlight({ id, actorId: request.user.sub, companyId: request.user.companyId })
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof MonthlyHighlightError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
}

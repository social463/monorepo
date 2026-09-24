import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { ACCESS_LOG_PATH_MAX_LENGTH, PEOPLE_ANALYTICS_RANGES } from '@legends/shared'
import { getCommunicationOverview } from '../services/communication-analytics-service'
import { getTrainingOverview, listPositions } from '../services/training-analytics-service'
import {
  AnalyticsWindowError,
  getAccessHeatmap,
  getEngagementOverview,
  getInovaOverview,
  getPeopleOverview,
  recordAccess,
} from '../services/people-analytics-service'
import { touchPresence } from '../services/presence-service'

const accessLogSchema = z.object({
  path: z.string().min(1).max(ACCESS_LOG_PATH_MAX_LENGTH),
})

/** Data civil `YYYY-MM-DD`, o mesmo formato que o resto do módulo usa. */
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD.')

const analyticsQuerySchema = z.object({
  // `custom` não está em PEOPLE_ANALYTICS_RANGES: ele não é atalho de N dias, é
  // o par from/to. O par só é exigido quando o range é esse — validar no service
  // (`resolveWindow`) mantém a regra num lugar só, com mensagem em português.
  range: z.union([z.enum(PEOPLE_ANALYTICS_RANGES), z.literal('custom')]).default('30d'),
  from: ymd.optional(),
  to: ymd.optional(),
  sectorId: z.string().min(1).optional(),
  /** Categoria de comunicado — só o painel de Comunicação Interna usa. */
  tagId: z.string().min(1).optional(),
  /**
   * Cargo (`User.position`) — só a aba de Treinamentos usa (Documento 4, seção
   * 9.5). Acrescentá-lo aos outros painéis mudaria o contrato de quatro telas
   * por causa de uma.
   */
  position: z.string().min(1).max(120).optional(),
})

export async function peopleAnalyticsRoutes(app: FastifyInstance) {
  // Área de Gente e Gestão: ADMIN global, ou SUBADMIN do setor com a feature
  // `gente-gestao` ligada. Subadmin de outro setor não entra.
  const adminOrSubadmin = { onRequest: [app.authenticate, app.requireSectorFeature('gente-gestao')] }

  /**
   * Ping de navegação. Aberto a qualquer autenticado e best-effort: uma falha
   * ao gravar não pode virar erro na tela de quem está navegando, então o
   * catch responde 204 do mesmo jeito (só registra no log do servidor).
   *
   * Grava DUAS coisas de propósitos diferentes: a linha do `AccessLog` (série
   * de navegação, People Analytics) e o carimbo de presença (último sinal, que
   * acende a bolinha do ranking). Quem navegou está on-line — seria desperdício
   * exigir um heartbeat separado para descobrir isso.
   */
  app.post('/access-logs', { onRequest: [app.authenticate] }, async (request, reply) => {
    const parsed = accessLogSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    try {
      await Promise.all([
        recordAccess({
          userId: request.user.sub,
          companyId: request.user.companyId,
          path: parsed.data.path,
        }),
        touchPresence(request.user.sub, request.user.companyId),
      ])
    } catch (err) {
      request.log.error(err)
    }
    return reply.code(204).send()
  })

  /**
   * Heartbeat de presença: "continuo aqui".
   *
   * Separado do `/access-logs` porque NÃO gera linha de navegação — quem está
   * parado lendo o mural há vinte minutos não visitou vinte telas, e inflar o
   * People Analytics com isso estragaria o dado de tela mais vista.
   */
  app.post('/me/presence', { onRequest: [app.authenticate] }, async (request, reply) => {
    try {
      await touchPresence(request.user.sub, request.user.companyId)
    } catch (err) {
      request.log.error(err)
    }
    return reply.code(204).send()
  })

  app.get('/admin/people/overview', adminOrSubadmin, async (request, reply) => {
    const parsed = analyticsQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    const { range, from, to, sectorId } = parsed.data
    try {
      return reply.send({
        overview: await getPeopleOverview({
          companyId: request.user.companyId,
          sectorId: resolveSectorId(request, sectorId),
          window: { range, from, to },
        }),
      })
    } catch (err) {
      if (err instanceof AnalyticsWindowError) return reply.code(400).send({ message: err.message })
      throw err
    }
  })

  app.get('/admin/people/engagement', adminOrSubadmin, async (request, reply) => {
    const parsed = analyticsQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    const { range, from, to, sectorId } = parsed.data
    try {
      return reply.send({
        engagement: await getEngagementOverview({
          companyId: request.user.companyId,
          sectorId: resolveSectorId(request, sectorId),
          window: { range, from, to },
        }),
      })
    } catch (err) {
      if (err instanceof AnalyticsWindowError) return reply.code(400).send({ message: err.message })
      throw err
    }
  })

  /**
   * Painel de Comunicação Interna (Documento 3, seção 4.8). Mora na aba
   * Engajamento e substitui o bloco simples de alcance do Feed.
   */
  app.get('/admin/communication/overview', adminOrSubadmin, async (request, reply) => {
    const parsed = analyticsQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    const { range, from, to, sectorId, tagId } = parsed.data
    try {
      return reply.send({
        communication: await getCommunicationOverview({
          companyId: request.user.companyId,
          sectorId: resolveSectorId(request, sectorId),
          window: { range, from, to },
          tagId,
        }),
      })
    } catch (err) {
      if (err instanceof AnalyticsWindowError) return reply.code(400).send({ message: err.message })
      throw err
    }
  })

  /**
   * Mapa de calor + tempo médio de sessão. Endpoint próprio, e não um campo do
   * overview, porque o bloco tem filtro de período e setor **independente** do
   * cabeçalho da tela (seção 4.2 do Documento 3).
   */
  /**
   * Analytics de Treinamento e Desenvolvimento (Documento 4, seção 9.5).
   *
   * Mesmo gate e mesmo recorte de setor das abas vizinhas: subadmin continua
   * preso ao próprio setor por `resolveSectorId`, e não pelo que mandou na
   * query.
   */
  app.get('/admin/people/training', adminOrSubadmin, async (request, reply) => {
    const parsed = analyticsQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    const { range, from, to, sectorId, position } = parsed.data
    try {
      const [training, positions] = await Promise.all([
        getTrainingOverview({
          companyId: request.user.companyId,
          sectorId: resolveSectorId(request, sectorId),
          position: position ?? null,
          window: { range, from, to },
        }),
        listPositions(request.user.companyId),
      ])
      return reply.send({ training, positions })
    } catch (err) {
      if (err instanceof AnalyticsWindowError) return reply.code(400).send({ message: err.message })
      throw err
    }
  })

  /**
   * Analytics de acesso ao Guia AI First (Comunidade INOVA), sub-aba de
   * Desenvolvimento. Mesmo gate e mesmo recorte das abas vizinhas.
   */
  app.get('/admin/people/inova', adminOrSubadmin, async (request, reply) => {
    const parsed = analyticsQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    const { range, from, to, sectorId } = parsed.data
    try {
      return reply.send({
        inova: await getInovaOverview({
          companyId: request.user.companyId,
          sectorId: resolveSectorId(request, sectorId),
          window: { range, from, to },
        }),
      })
    } catch (err) {
      if (err instanceof AnalyticsWindowError) return reply.code(400).send({ message: err.message })
      throw err
    }
  })

  app.get('/admin/people/heatmap', adminOrSubadmin, async (request, reply) => {
    const parsed = analyticsQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Dados inválidos', issues: parsed.error.issues })
    }
    const { range, from, to, sectorId } = parsed.data
    try {
      return reply.send({
        heatmap: await getAccessHeatmap({
          companyId: request.user.companyId,
          sectorId: resolveSectorId(request, sectorId),
          window: { range, from, to },
        }),
      })
    } catch (err) {
      if (err instanceof AnalyticsWindowError) return reply.code(400).send({ message: err.message })
      throw err
    }
  })
}

/**
 * O SUBADMIN enxerga só o próprio setor: o `sectorId` da query é *ignorado*
 * (não é erro — a UI dele simplesmente não oferece o filtro). O ADMIN escolhe
 * livremente; sem filtro, vê a empresa inteira.
 */
function resolveSectorId(request: { user: { role: string; sectorId: string } }, requested?: string): string | null {
  if (request.user.role === 'SUBADMIN') return request.user.sectorId
  return requested ?? null
}

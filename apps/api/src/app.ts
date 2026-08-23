import Fastify, { type FastifyInstance } from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import cookie from '@fastify/cookie'
import fastifyStatic from '@fastify/static'
import websocket from '@fastify/websocket'
import multipart from '@fastify/multipart'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { canAdminister, isFullAdmin } from '@legends/shared'
import { resolveJwtSecret } from './lib/config'
import { authRoutes } from './routes/auth'
import { userRoutes } from './routes/users'
import { organizationRoutes } from './routes/organization'
import { categoryRoutes } from './routes/categories'
import { sectorRoutes } from './routes/sectors'
import { periodRoutes } from './routes/periods'
import { voteRoutes } from './routes/votes'
import { badgeRoutes } from './routes/badges'
import { profileRoutes } from './routes/profile'
import { feedbackRoutes } from './routes/feedback'
import { adminRoutes } from './routes/admin'
import { adminUserImportRoutes } from './routes/admin.users-import'
import { highlightRoutes } from './routes/highlights'
import { monthlyHighlightRoutes } from './routes/monthly-highlights'
import { muralRoutes } from './routes/mural'
import { celebrationRoutes } from './routes/celebrations'
import { vacationRoutes } from './routes/vacations'
import { notificationRoutes } from './routes/notifications'
import { retroRoutes } from './routes/retro'
import { retroWsRoutes } from './routes/retro-ws'
import { reviewWsRoutes } from './routes/review-ws'
import { officeWsRoutes } from './routes/office-ws'
import { officeMediaRoutes } from './routes/office-media'
import { officeGuestRoutes } from './routes/office-guests'
import { officeMeetingRoutes } from './routes/office-meetings'
import { moodRoutes } from './routes/mood'
import { streakRoutes } from './routes/streak'
import { calendarRoutes } from './routes/calendar'
import { coinRoutes } from './routes/coins'
import { xpRoutes } from './routes/xp'
import { rankingRoutes } from './routes/ranking'
import { squadMoodRoutes } from './routes/squad-mood'
import { reviewRoutes } from './routes/review'
import { corporateMuralRoutes } from './routes/corporate-mural'
import { corporateMuralWsRoutes } from './routes/corporate-mural-ws'
import { gifRoutes } from './routes/gifs'
import { imageUploadRoutes } from './routes/image-uploads'
import { cultureRoutes } from './routes/culture'
import { eventAlbumRoutes } from './routes/event-albums'
import { hrDashboardRoutes } from './routes/hr-dashboards'
import { adminChallengeRoutes } from './routes/admin-challenges'
import { challengeRoutes } from './routes/challenges'
import { storeRoutes } from './routes/store'
import { adminStoreRoutes } from './routes/admin-store'
import { developmentThursdayRoutes } from './routes/development-thursday'
import { learningRoutes } from './routes/learning'
import { coursesAdminRoutes } from './routes/courses-admin'
import { adminCertificateRoutes } from './routes/admin-certificates'
import { pdiRoutes } from './routes/pdi'
import { oneOnOneRoutes } from './routes/one-on-one'
import { oneOnOneWsRoutes } from './routes/one-on-one-ws'
import { adminOneOnOneTopicRoutes } from './routes/admin.one-on-one-topics'
import { developmentRoutes } from './routes/development'
import { officeMapRoutes } from './routes/office-maps'
import { characterFavoriteRoutes } from './routes/character-favorites'
import { thirdPartyInviteRoutes } from './routes/third-party-invites'
import { superAdminRoutes } from './routes/super-admin'
import { adminChallengeSubmissionRoutes } from './routes/admin.challenges'
import { peopleAnalyticsRoutes } from './routes/people-analytics'
import { leadershipRoutes } from './routes/leadership'
import { agentRoutes } from './routes/agents'
import { glassRoutes } from './routes/glass'
import { benchmarkPracticeRoutes } from './routes/benchmark-practices'
import { campaignRoutes } from './routes/campaigns'
import { aiSettingsRoutes } from './routes/ai-settings'
import { brandingRoutes } from './routes/branding'
import { assistantRoutes } from './routes/assistant'

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false })

  app.register(cors, { origin: true })
  app.register(websocket)
  app.register(jwt, { secret: resolveJwtSecret(process.env), sign: { expiresIn: '15m' } })
  app.register(cookie)
  app.register(multipart, { limits: { files: 1 } })

  /**
   * Erro não tratado nunca sai cru para o cliente.
   *
   * O default do Fastify devolve `err.message` no corpo, e a mensagem do Prisma
   * carrega caminho absoluto do arquivo, trecho do `schema.prisma` e nome de
   * coluna — já apareceu inteira na tela de login quando faltou `DATABASE_URL`.
   * Isso é mapa da casa para quem estiver do outro lado, e não diz nada de útil
   * para quem só queria entrar.
   *
   * Abaixo de 500 a mensagem é nossa e é para ser lida (validação, 401, 403,
   * 404, 409, 413…), então passa intacta. O status acima de 500 é preservado —
   * só a mensagem vira genérica: 503 e 502 dizem coisas diferentes de 500 para
   * quem monitora.
   *
   * `issues` fica de fora de propósito: no resto do projeto ele é sempre o
   * `flatten()` do Zod montado pela própria rota, e nenhuma rota usa validação
   * por schema do Fastify. Devolver `err.validation` aqui criaria um terceiro
   * formato para o mesmo campo.
   */
  app.setErrorHandler((err, request, reply) => {
    const status = err.statusCode ?? 500
    if (status < 500) {
      return reply.code(status).send({ message: err.message })
    }
    request.log.error({ err, url: request.url }, 'erro não tratado')
    // Sem logger configurado (`logger: false`), o console é o que sobra para
    // diagnosticar em dev — a mensagem crua morre aqui, não na tela.
    console.error(`[${status}] ${request.method} ${request.url}`, err)
    return reply.code(status).send({ message: 'Erro inesperado. Tente de novo em instantes.' })
  })

  app.decorate('authenticate', async function (request, reply) {
    try {
      await request.jwtVerify()
    } catch {
      return reply.code(401).send({ message: 'Não autorizado' })
    }
  })

  // Os guardas abaixo perguntam "pode administrar?", e por isso passam pelos
  // predicados de `@legends/shared`: o acesso administrativo delegado vale
  // aqui. Checagem de "é conta de administrador, logo não participa" (não vota,
  // não entra em squad, não faz retro) continua lendo `role` cru nos services.
  app.decorate('requireAdmin', async function (request, reply) {
    if (!isFullAdmin(request.user)) {
      return reply.code(403).send({ message: 'Acesso restrito a administradores' })
    }
  })

  app.decorate('requireAdminOrSubadmin', async function (request, reply) {
    if (!canAdminister(request.user)) {
      return reply.code(403).send({ message: 'Acesso restrito a administradores' })
    }
  })

  app.decorate('requireSuperAdmin', async function (request, reply) {
    if (request.user.role !== 'SUPER_ADMIN') {
      return reply.code(403).send({ message: 'Acesso restrito à equipe interna' })
    }
  })

  /**
   * Guarda de recurso de setor. Diferente de `requireFeature`, que libera todo
   * ADMIN e todo SUBADMIN: aqui o SUBADMIN só passa se a feature estiver ligada
   * **no setor dele**. É o que restringe o agente de Benchmarking ao líder de
   * Gente e Gestão sem cravar o nome do setor no código — cada empresa liga a
   * feature no setor que faz esse papel.
   */
  app.decorate('requireSectorFeature', function (key: string) {
    return async function (request, reply) {
      if (isFullAdmin(request.user)) return
      if (request.user.role === 'SUBADMIN' && (request.user.features ?? []).includes(key)) return
      return reply.code(403).send({ message: 'Acesso restrito a administradores' })
    }
  })

  /**
   * Diferente dos guardas acima, este NÃO olha o acesso delegado — e é a única
   * exceção deliberada.
   *
   * `requireFeature` guarda rota de COLABORADOR (votar, retro, 1:1, desafios), e
   * a feature diz o que o setor da pessoa consome. Liberar o delegado aqui o
   * faria votar e participar de dinâmicas que o setor dele tem desligadas —
   * exatamente a expansão de identidade que o acesso delegado existe para
   * evitar. Ele administra a plataforma; consome o que o setor dele libera,
   * como qualquer colega.
   */
  app.decorate('requireFeature', function (key: string) {
    return async function (request, reply) {
      if (request.user.role === 'ADMIN' || request.user.role === 'SUBADMIN') return
      const features = request.user.features ?? []
      if (!features.includes(key)) {
        return reply.code(403).send({ message: 'Acesso não liberado para este usuário' })
      }
    }
  })

  app.get('/health', async () => ({ status: 'ok' }))

  const highlightsRoot = join(process.cwd(), 'storage', 'highlights')
  mkdirSync(highlightsRoot, { recursive: true })
  app.register(fastifyStatic, {
    root: highlightsRoot,
    prefix: '/highlights/',
    decorateReply: false,
  })

  app.register(authRoutes, { prefix: '/auth' })
  app.register(userRoutes)
  app.register(organizationRoutes)
  app.register(categoryRoutes)
  app.register(sectorRoutes)
  app.register(periodRoutes)
  app.register(voteRoutes)
  app.register(badgeRoutes)
  app.register(profileRoutes)
  app.register(feedbackRoutes)
  app.register(adminRoutes)
  app.register(adminUserImportRoutes)
  app.register(highlightRoutes)
  // Destaques curados pela G&G — mecanismo NOVO, ao lado do destaque da
  // votação acima (ver a spec 2026-08-17-destaques-do-mes-curados).
  app.register(monthlyHighlightRoutes)
  app.register(muralRoutes)
  app.register(celebrationRoutes)
  app.register(vacationRoutes)
  app.register(reviewRoutes)
  app.register(corporateMuralRoutes)
  app.register(gifRoutes)
  app.register(imageUploadRoutes)
  app.register(cultureRoutes)
  app.register(eventAlbumRoutes)
  app.register(hrDashboardRoutes)
  app.register(adminChallengeRoutes)
  app.register(challengeRoutes)
  app.register(storeRoutes)
  app.register(adminStoreRoutes)
  app.register(developmentThursdayRoutes)
  app.register(learningRoutes)
  app.register(coursesAdminRoutes)
  app.register(adminCertificateRoutes)
  app.register(pdiRoutes)
  app.register(oneOnOneRoutes)
  app.register(oneOnOneWsRoutes)
  app.register(adminOneOnOneTopicRoutes)
  app.register(developmentRoutes)
  app.register(notificationRoutes)
  app.register(retroRoutes)
  app.register(retroWsRoutes)
  app.register(reviewWsRoutes)
  app.register(corporateMuralWsRoutes)
  app.register(officeWsRoutes)
  app.register(officeMediaRoutes)
  app.register(officeGuestRoutes)
  app.register(officeMeetingRoutes)
  app.register(officeMapRoutes)
  app.register(characterFavoriteRoutes)
  app.register(moodRoutes)
  app.register(streakRoutes)
  app.register(calendarRoutes)
  app.register(coinRoutes)
  app.register(xpRoutes)
  app.register(rankingRoutes)
  app.register(squadMoodRoutes)
  app.register(thirdPartyInviteRoutes)
  app.register(superAdminRoutes)
  app.register(adminChallengeSubmissionRoutes)
  app.register(peopleAnalyticsRoutes)
  app.register(leadershipRoutes)
  app.register(agentRoutes)
  app.register(glassRoutes)
  app.register(benchmarkPracticeRoutes)
  app.register(campaignRoutes)
  app.register(aiSettingsRoutes)
  app.register(brandingRoutes)
  app.register(assistantRoutes)

  return app
}

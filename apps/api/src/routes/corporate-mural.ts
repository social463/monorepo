import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import {
  CORPORATE_COMMENT_MAX_LENGTH,
  CORPORATE_POST_AI_PROMPT_MAX_LENGTH,
  CORPORATE_POST_ATTACHMENT_KINDS,
  CORPORATE_POST_AUDIENCES,
  CORPORATE_POST_BODY_MAX_LENGTH,
  CORPORATE_POST_REACTIONS,
  CORPORATE_POST_TITLE_MAX_LENGTH,
  MAX_CORPORATE_POST_ATTACHMENTS,
  MAX_CORPORATE_POST_MENTIONS,
  RICH_BLOCK_TYPES,
  RICH_DOC_MAX_BLOCKS,
  RICH_DOC_MAX_SPANS_PER_BLOCK,
  RICH_TEXT_COLORS,
  RICH_TEXT_SIZES,
  canModerateCorporatePost,
  canPublishCorporatePostDirectly,
  canSeeCorporateMural,
  isSafeHref,
} from '@legends/shared'
import {
  CorporateMuralError,
  approvePost,
  createComment,
  createPost,
  deleteComment,
  deletePost,
  generateCorporatePost,
  getPost,
  getPostReach,
  listPostReactors,
  listComments,
  listFeed,
  listPendingPosts,
  markPostRead,
  pinPost,
  rejectPost,
  toggleCommentReaction,
  togglePostReaction,
  unpinPost,
  updatePost,
  type CorporateMuralViewer,
} from '../services/corporate-mural-service'
import {
  notifyCorporatePostApproved,
  notifyCorporatePostAwaitingReview,
  notifyCorporatePostComment,
  notifyCorporatePostCommentReply,
  notifyCorporatePostMention,
  notifyCorporatePostPublished,
  notifyCorporatePostReaction,
  notifyCorporatePostRejected,
} from '../services/notification-service'
import { awardXp, revokeXp } from '../services/xp-service'
import { toCorporatePostCommentDTO, toCorporatePostDTO, toPendingCorporatePostDTO } from '../lib/serialize'
import { corporateMuralHub } from '../lib/corporate-mural-hub'

/** Limite do feed: default 20, mínimo 1, máximo 50. */
function clampLimit(raw: string | undefined, fallback = 20): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.min(Math.floor(n), 50)
}

/** Quem está lendo — o recorte de público-alvo do service sai daqui. */
function viewerOf(request: FastifyRequest): CorporateMuralViewer {
  return {
    userId: request.user.sub,
    sectorId: request.user.sectorId,
    role: request.user.role,
    adminAccess: request.user.adminAccess,
    companyId: request.user.companyId,
  }
}

const reachQuerySchema = z.object({
  sort: z.enum(['date_desc', 'date_asc']).optional().default('date_desc'),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
})

const gifSchema = z.object({
  url: z.string().url(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
})
const imageSchema = z.object({
  url: z.string().url(),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
})

/**
 * Zod do documento rico. Cada campo é validado contra as listas fechadas de
 * `@legends/shared`: cor fora da paleta, tamanho fora da escala ou `href` que
 * não passa em `isSafeHref` viram **400**, não sanitização silenciosa. É esta
 * validação que substitui o sanitizador de HTML que o repo não tem (e não quer:
 * ver o cabeçalho de `rich-text.ts`).
 */
const richSpanSchema = z.object({
  text: z.string().max(CORPORATE_POST_BODY_MAX_LENGTH),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  size: z.enum(RICH_TEXT_SIZES).optional(),
  color: z.enum(RICH_TEXT_COLORS).optional(),
  highlight: z.enum(RICH_TEXT_COLORS).optional(),
  href: z.string().refine(isSafeHref, { message: 'Link não permitido.' }).optional(),
  mentionId: z.string().optional(),
})
const richBlockSchema = z.object({
  type: z.enum(RICH_BLOCK_TYPES),
  spans: z.array(richSpanSchema).max(RICH_DOC_MAX_SPANS_PER_BLOCK),
})
const richDocSchema = z.object({
  blocks: z.array(richBlockSchema).max(RICH_DOC_MAX_BLOCKS),
})

const attachmentSchema = z.object({
  // `kind` viaja para a web saber o que desenhar enquanto o post não recarrega,
  // mas quem manda no servidor é o content-type (ver `assertAttachments`).
  kind: z.enum(CORPORATE_POST_ATTACHMENT_KINDS),
  url: z.string().url(),
  name: z.string().trim().min(1).max(200),
  contentType: z.string().min(1),
  size: z.number().int().nonnegative(),
  width: z.number().int().nonnegative().optional(),
  height: z.number().int().nonnegative().optional(),
})

const postSchema = z.object({
  title: z.string().trim().max(CORPORATE_POST_TITLE_MAX_LENGTH).optional(),
  body: richDocSchema.optional(),
  /** Texto puro — caminho de cliente antigo e de quem não formata nada. */
  content: z.string().trim().max(CORPORATE_POST_BODY_MAX_LENGTH).optional(),
  mentionedUserIds: z.array(z.string()).max(MAX_CORPORATE_POST_MENTIONS).optional(),
  gif: gifSchema.optional(),
  image: imageSchema.optional(),
  attachments: z.array(attachmentSchema).max(MAX_CORPORATE_POST_ATTACHMENTS).optional(),
  audience: z.enum(CORPORATE_POST_AUDIENCES).optional(),
  audienceSectorIds: z.array(z.string()).max(50).optional(),
})

const commentSchema = z
  .object({
    content: z.string().trim().max(CORPORATE_COMMENT_MAX_LENGTH).optional().default(''),
    mentionedUserIds: z.array(z.string()).max(MAX_CORPORATE_POST_MENTIONS).optional(),
    gif: gifSchema.optional(),
    image: imageSchema.optional(),
  })
  .refine((v) => v.content.trim().length >= 1 || v.gif || v.image, {
    message: 'Escreva algo ou anexe um GIF ou imagem.',
  })

const reactionSchema = z.object({ emoji: z.enum(CORPORATE_POST_REACTIONS) })
const readSchema = z.object({ full: z.boolean().optional() })
const rejectSchema = z.object({ reason: z.string().trim().max(280).optional() })
const generateSchema = z.object({
  instructions: z.string().trim().min(1).max(CORPORATE_POST_AI_PROMPT_MAX_LENGTH),
  audience: z.enum(CORPORATE_POST_AUDIENCES).optional(),
  audienceSectorIds: z.array(z.string()).max(50).optional(),
})

const invalidComment = {
  message: `Escreva algo (até ${CORPORATE_COMMENT_MAX_LENGTH} caracteres) ou anexe um GIF ou imagem.`,
}
const invalidPost = { message: 'Comunicado inválido. Revise o texto, o título e os anexos.' }

/**
 * O feed é da empresa toda, então não passa pelo `requireFeature` de setor: só
 * o terceirizado precisa da feature na allowlist individual (ver
 * `canSeeCorporateMural`). Sem isto a Home quebrava com 403 para quem não tinha
 * a feature habilitada no setor — uma lenda, por exemplo.
 *
 * Não confundir com o **público-alvo** de cada comunicado, que é recorte por
 * post e vive no service: este guard é o da porta, aquele é o do item.
 */
async function requireCorporateMuralAccess(request: FastifyRequest, reply: FastifyReply) {
  if (!canSeeCorporateMural({ role: request.user.role, features: request.user.features })) {
    return reply.code(403).send({ message: 'Acesso não liberado para este usuário' })
  }
}

export async function corporateMuralRoutes(app: FastifyInstance) {
  const guard = { onRequest: [app.authenticate, requireCorporateMuralAccess] }
  // Fixar/moderar/medir não tem recorte de setor: quem administra, administra o
  // feed inteiro, igual ao que a exclusão já fazia.
  const adminGuard = { onRequest: [app.authenticate, app.requireAdminOrSubadmin] }

  app.get('/corporate-posts', guard, async (request, reply) => {
    const query = request.query as { cursor?: string; limit?: string }
    try {
      const { items, nextCursor } = await listFeed(viewerOf(request), {
        cursor: query.cursor,
        limit: clampLimit(query.limit),
      })
      return reply.send({
        items: items.map((p) => toCorporatePostDTO(p, request.user.sub)),
        nextCursor,
        // Todo mundo publica agora; isto diz se sai publicado ou pendente, e é o
        // que a web usa para avisar "vai para aprovação" no composer.
        canPublish: true,
        canPublishDirectly: canPublishCorporatePostDirectly(request.user.role, request.user.adminAccess),
      })
    } catch (err) {
      if (err instanceof CorporateMuralError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  /**
   * Fila de revisão. Rota estática antes da paramétrica no arquivo por clareza —
   * o roteador do Fastify já prioriza segmento fixo sobre `:id`.
   *
   * Guard comum (não `adminGuard`): para quem administra é a fila da empresa,
   * para o colaborador é "Meus envios". O service decide o escopo.
   */
  app.get('/corporate-posts/pending', guard, async (request, reply) => {
    const query = request.query as { mine?: string }
    try {
      const items = await listPendingPosts(viewerOf(request), { mine: query.mine === 'true' })
      return reply.send({ items: items.map((p) => toPendingCorporatePostDTO(p, request.user.sub)) })
    } catch (err) {
      if (err instanceof CorporateMuralError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  /**
   * Post isolado: é daqui que sai o toast do comunicado novo (o WebSocket manda
   * só o id) e o deep-link da notificação. Fora do público-alvo é 404.
   */
  app.get('/corporate-posts/:id', guard, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const post = await getPost(id, viewerOf(request))
      return reply.send({ post: toCorporatePostDTO(post, request.user.sub) })
    } catch (err) {
      if (err instanceof CorporateMuralError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/corporate-posts', guard, async (request, reply) => {
    const parsed = postSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...invalidPost, issues: parsed.error.flatten() })
    try {
      const post = await createPost({
        authorId: request.user.sub,
        title: parsed.data.title,
        body: parsed.data.body,
        content: parsed.data.content,
        mentionedUserIds: parsed.data.mentionedUserIds,
        gif: parsed.data.gif,
        image: parsed.data.image,
        attachments: parsed.data.attachments,
        audience: parsed.data.audience,
        audienceSectorIds: parsed.data.audienceSectorIds,
        companyId: request.user.companyId,
      })
      if (post.status === 'PUBLISHED') {
        await announcePublished(request, post)
      } else {
        // Pendente não vai para o feed nem para o sininho da empresa: quem
        // precisa saber é quem aprova.
        try {
          await notifyCorporatePostAwaitingReview({ postId: post.id, authorId: post.authorId }, request.user.companyId)
        } catch (notifyErr) {
          request.log.error(notifyErr)
        }
      }
      return reply.code(201).send({ post: toCorporatePostDTO(post, request.user.sub) })
    } catch (err) {
      if (err instanceof CorporateMuralError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  /** Edição: admin em qualquer post, autor enquanto o dele está pendente. */
  app.patch('/corporate-posts/:id', guard, async (request, reply) => {
    const parsed = postSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...invalidPost, issues: parsed.error.flatten() })
    const { id } = request.params as { id: string }
    try {
      const post = await updatePost({
        postId: id,
        actorId: request.user.sub,
        role: request.user.role,
        adminAccess: request.user.adminAccess,
        companyId: request.user.companyId,
        title: parsed.data.title,
        body: parsed.data.body,
        content: parsed.data.content,
        attachments: parsed.data.attachments,
        audience: parsed.data.audience,
        audienceSectorIds: parsed.data.audienceSectorIds,
      })
      corporateMuralHub.broadcast({ type: 'post:changed', postId: id })
      return reply.send({ post: toCorporatePostDTO(post, request.user.sub) })
    } catch (err) {
      if (err instanceof CorporateMuralError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/corporate-posts/:id/approve', adminGuard, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const post = await approvePost({ postId: id, actorId: request.user.sub, companyId: request.user.companyId })
      try {
        await notifyCorporatePostApproved(
          { postId: post.id, authorId: post.authorId, actorId: request.user.sub },
          request.user.companyId,
        )
      } catch (notifyErr) {
        request.log.error(notifyErr)
      }
      await announcePublished(request, post)
      return reply.send({ post: toCorporatePostDTO(post, request.user.sub) })
    } catch (err) {
      if (err instanceof CorporateMuralError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/corporate-posts/:id/reject', adminGuard, async (request, reply) => {
    const parsed = rejectSchema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send({ message: 'Motivo inválido.', issues: parsed.error.flatten() })
    const { id } = request.params as { id: string }
    try {
      const post = await rejectPost({
        postId: id,
        actorId: request.user.sub,
        companyId: request.user.companyId,
        reason: parsed.data.reason,
      })
      try {
        await notifyCorporatePostRejected(
          {
            postId: post.id,
            authorId: post.authorId,
            actorId: request.user.sub,
            reason: post.rejectionReason,
          },
          request.user.companyId,
        )
      } catch (notifyErr) {
        request.log.error(notifyErr)
      }
      return reply.send({ post: toPendingCorporatePostDTO(post, request.user.sub) })
    } catch (err) {
      if (err instanceof CorporateMuralError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  /** Botão de IA do composer: gera título + corpo a partir de instruções. */
  app.post('/corporate-posts/ai/generate', guard, async (request, reply) => {
    const parsed = generateSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Escreva o que você quer comunicar.', issues: parsed.error.flatten() })
    }
    try {
      const draft = await generateCorporatePost({
        userId: request.user.sub,
        companyId: request.user.companyId,
        instructions: parsed.data.instructions,
        audience: parsed.data.audience,
        audienceSectorIds: parsed.data.audienceSectorIds,
      })
      return reply.send(draft)
    } catch (err) {
      if (err instanceof CorporateMuralError) return reply.code(err.status).send({ message: err.message })
      // Sem chave cadastrada pela empresa, `AgentError` vira 503 tratado — o
      // mesmo caminho dos outros agentes (ver AGENTS.md).
      const status = (err as { status?: number }).status
      if (typeof status === 'number' && status >= 400 && status < 600) {
        return reply.code(status).send({ message: (err as Error).message })
      }
      throw err
    }
  })

  app.delete('/corporate-posts/:id', guard, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      await deletePost({
        postId: id,
        userId: request.user.sub,
        role: request.user.role,
        adminAccess: request.user.adminAccess,
        companyId: request.user.companyId,
      })
      corporateMuralHub.broadcast({ type: 'feed:changed' })
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof CorporateMuralError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  /**
   * Quem reagiu no comunicado. Guard comum, e não `adminGuard`: quem enxerga o
   * post enxerga a lista (o service confere o público-alvo). É o que sustenta
   * tanto o "N reações" do card quanto o painel de alcance da moderação.
   */
  app.get('/corporate-posts/:id/reactions', guard, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      return reply.send(await listPostReactors(id, viewerOf(request)))
    } catch (err) {
      if (err instanceof CorporateMuralError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/corporate-posts/:id/reactions/toggle', guard, async (request, reply) => {
    const parsed = reactionSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Reação inválida.', issues: parsed.error.flatten() })
    const { id } = request.params as { id: string }
    try {
      const { post, added, postAuthorId, viewerHasReaction } = await togglePostReaction({
        postId: id,
        emoji: parsed.data.emoji,
        viewer: viewerOf(request),
      })
      if (added) {
        // XP best-effort, como nos demais créditos. A referência é o postId (e
        // não `postId:emoji`): a regra vale uma vez por publicação, então três
        // emojis no mesmo comunicado continuam pagando um.
        try {
          await awardXp({
            userId: request.user.sub,
            companyId: request.user.companyId,
            event: 'CORPORATE_POST_REACTION',
            reference: id,
          })
        } catch (xpErr) {
          request.log.error(xpErr)
        }
        try {
          await notifyCorporatePostReaction({ postAuthorId, actorId: request.user.sub, postId: id }, request.user.companyId)
        } catch (notifyErr) {
          request.log.error(notifyErr)
        }
      } else if (!viewerHasReaction) {
        // Caiu a ÚLTIMA reação da pessoa no post: o crédito sai do extrato.
        try {
          await revokeXp({
            userId: request.user.sub,
            companyId: request.user.companyId,
            event: 'CORPORATE_POST_REACTION',
            reference: id,
          })
        } catch (xpErr) {
          request.log.error(xpErr)
        }
      }
      corporateMuralHub.broadcast({ type: 'post:changed', postId: id })
      return reply.send({ post: toCorporatePostDTO(post, request.user.sub) })
    } catch (err) {
      if (err instanceof CorporateMuralError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.get('/corporate-posts/:id/comments', guard, async (request, reply) => {
    const { id } = request.params as { id: string }
    const query = request.query as { offset?: string; limit?: string }
    const limit = clampLimit(query.limit, 10)
    const offset = Math.max(0, Number(query.offset) || 0)
    try {
      const rows = await listComments(id, viewerOf(request), { offset, limit })
      const hasMore = rows.length > limit
      const page = hasMore ? rows.slice(0, limit) : rows
      return reply.send({ items: page.map((c) => toCorporatePostCommentDTO(c, request.user.sub)), hasMore })
    } catch (err) {
      if (err instanceof CorporateMuralError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/corporate-posts/:id/comments', guard, async (request, reply) => {
    const parsed = commentSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ ...invalidComment, issues: parsed.error.flatten() })
    const { id } = request.params as { id: string }
    try {
      const { comment, postAuthorId, replyRecipientIds, firstOfAuthor } = await createComment({
        postId: id,
        content: parsed.data.content,
        mentionedUserIds: parsed.data.mentionedUserIds,
        gif: parsed.data.gif,
        image: parsed.data.image,
        viewer: viewerOf(request),
      })
      if (firstOfAuthor) {
        try {
          await awardXp({
            userId: request.user.sub,
            companyId: request.user.companyId,
            event: 'CORPORATE_POST_COMMENT',
            reference: id,
          })
        } catch (xpErr) {
          request.log.error(xpErr)
        }
      }
      try {
        await notifyCorporatePostComment({ postAuthorId, actorId: request.user.sub, postId: id }, request.user.companyId)
      } catch (notifyErr) {
        request.log.error(notifyErr)
      }
      try {
        await notifyCorporatePostCommentReply({ recipientIds: replyRecipientIds, actorId: request.user.sub, postId: id }, request.user.companyId)
      } catch (notifyErr) {
        request.log.error(notifyErr)
      }
      try {
        await notifyCorporatePostMention({
          recipientIds: comment.mentions.map((m) => m.userId),
          actorId: request.user.sub,
          postId: id,
        }, request.user.companyId)
      } catch (notifyErr) {
        request.log.error(notifyErr)
      }
      corporateMuralHub.broadcast({ type: 'comments:changed', postId: id })
      return reply.code(201).send({ comment: toCorporatePostCommentDTO(comment, request.user.sub) })
    } catch (err) {
      if (err instanceof CorporateMuralError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/corporate-posts/comments/:commentId', guard, async (request, reply) => {
    const { commentId } = request.params as { commentId: string }
    try {
      const { postId, commentAuthorId, authorHasOtherComments } = await deleteComment({
        commentId,
        userId: request.user.sub,
        role: request.user.role,
        adminAccess: request.user.adminAccess,
        companyId: request.user.companyId,
      })
      if (!authorHasOtherComments) {
        // O estorno é do AUTOR do comentário, não de quem apagou: admin
        // moderando não pode tirar XP de si mesmo.
        try {
          await revokeXp({
            userId: commentAuthorId,
            companyId: request.user.companyId,
            event: 'CORPORATE_POST_COMMENT',
            reference: postId,
          })
        } catch (xpErr) {
          request.log.error(xpErr)
        }
      }
      corporateMuralHub.broadcast({ type: 'comments:changed', postId })
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof CorporateMuralError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/corporate-posts/comments/:commentId/reactions/toggle', guard, async (request, reply) => {
    const parsed = reactionSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ message: 'Reação inválida.', issues: parsed.error.flatten() })
    const { commentId } = request.params as { commentId: string }
    try {
      const { comment } = await toggleCommentReaction({
        commentId,
        emoji: parsed.data.emoji,
        viewer: viewerOf(request),
      })
      corporateMuralHub.broadcast({ type: 'comments:changed', postId: comment.postId })
      return reply.send({ comment: toCorporatePostCommentDTO(comment, request.user.sub) })
    } catch (err) {
      if (err instanceof CorporateMuralError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.post('/corporate-posts/:id/pin', adminGuard, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const post = await pinPost({
        postId: id,
        actorId: request.user.sub,
        companyId: request.user.companyId,
      })
      // Fixar reordena o feed inteiro — mesmo evento que o post novo emite.
      corporateMuralHub.broadcast({ type: 'feed:changed' })
      return reply.send({ post: toCorporatePostDTO(post, request.user.sub) })
    } catch (err) {
      if (err instanceof CorporateMuralError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.delete('/corporate-posts/:id/pin', adminGuard, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const post = await unpinPost({
        postId: id,
        actorId: request.user.sub,
        companyId: request.user.companyId,
      })
      corporateMuralHub.broadcast({ type: 'feed:changed' })
      return reply.send({ post: toCorporatePostDTO(post, request.user.sub) })
    } catch (err) {
      if (err instanceof CorporateMuralError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  /**
   * Leitura NÃO é broadcast: seria ruído inútil e vazaria quem leu o quê.
   *
   * Sem `full`, é a marcação do painel de alcance (vem do `IntersectionObserver`
   * e não paga XP). Com `full: true`, é o clique em "Ver conteúdo completo" — e
   * quem decide se o post é longo o bastante para pagar é o service.
   */
  app.post('/corporate-posts/:id/read', guard, async (request, reply) => {
    const parsed = readSchema.safeParse(request.body ?? {})
    if (!parsed.success) return reply.code(400).send({ message: 'Requisição inválida.' })
    const { id } = request.params as { id: string }
    try {
      const { creditFull } = await markPostRead({
        postId: id,
        viewer: viewerOf(request),
        full: parsed.data.full,
      })
      if (creditFull) {
        try {
          await awardXp({
            userId: request.user.sub,
            companyId: request.user.companyId,
            event: 'CORPORATE_POST_READ_FULL',
            reference: id,
          })
        } catch (xpErr) {
          request.log.error(xpErr)
        }
      }
      return reply.code(204).send()
    } catch (err) {
      if (err instanceof CorporateMuralError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })

  app.get('/admin/corporate-posts/reach', adminGuard, async (request, reply) => {
    const parsed = reachQuerySchema.safeParse(request.query)
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Filtro inválido.', issues: parsed.error.flatten() })
    }
    try {
      const reach = await getPostReach(request.user.companyId, parsed.data)
      return reply.send(reach)
    } catch (err) {
      if (err instanceof CorporateMuralError) return reply.code(err.status).send({ message: err.message })
      throw err
    }
  })
}

/**
 * Comunicado no ar: menções, sininho do público-alvo e os dois eventos de
 * WebSocket. `post:published` é o que vira toast — magro de propósito, só o id:
 * o hub é canal único e global, então título no broadcast vazaria comunicado de
 * uma empresa para conexão de outra (ver `corporate-mural-hub.ts`).
 */
async function announcePublished(
  request: FastifyRequest,
  post: {
    id: string
    title: string | null
    authorId: string
    mentions: { userId: string }[]
    sectors: { sectorId: string }[]
  },
): Promise<void> {
  try {
    await notifyCorporatePostMention(
      { recipientIds: post.mentions.map((m) => m.userId), actorId: post.authorId, postId: post.id },
      request.user.companyId,
    )
  } catch (notifyErr) {
    request.log.error(notifyErr)
  }
  try {
    await notifyCorporatePostPublished(
      {
        postId: post.id,
        title: post.title,
        authorId: post.authorId,
        sectorIds: post.sectors.map((s) => s.sectorId),
      },
      request.user.companyId,
    )
  } catch (notifyErr) {
    request.log.error(notifyErr)
  }
  corporateMuralHub.broadcast({ type: 'feed:changed' })
  corporateMuralHub.broadcast({ type: 'post:published', postId: post.id })
}

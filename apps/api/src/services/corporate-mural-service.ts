import { Prisma } from '@prisma/client'
import type { User } from '@prisma/client'
import {
  CORPORATE_COMMENT_MAX_LENGTH,
  CORPORATE_POST_AI_PROMPT_MAX_LENGTH,
  CORPORATE_POST_BODY_MAX_LENGTH,
  CORPORATE_POST_EXCERPT_LENGTH,
  CORPORATE_POST_REACTIONS,
  CORPORATE_POST_TITLE_MAX_LENGTH,
  MAX_CORPORATE_POST_ATTACHMENTS,
  MAX_CORPORATE_POST_MENTIONS,
  canAdminister,
  audienceHasSectors,
  canModerateCorporatePost,
  isLeaderRole,
  LEADER_ROLES,
  canPublishCorporatePostDirectly,
  isCollapsibleCorporatePost,
  isGiphyHost,
  isRichDoc,
  mediaKindFor,
  mediaMaxBytesFor,
  plainTextToRichDoc,
  richDocMentionIds,
  richDocToPlainText,
  type AttachedGif,
  type AttachedImage,
  type CorporatePostAttachmentInput,
  type CorporatePostAudience,
  type CorporatePostReachResponse,
  type CorporatePostReactorsResponse,
  type GenerateCorporatePostResponse,
  type RichDoc,
  CORPORATE_POST_POLL_QUESTION_MAX_LENGTH,
  CORPORATE_POST_POLL_OPTION_MAX_LENGTH,
  CORPORATE_POST_POLL_MIN_OPTIONS,
  CORPORATE_POST_POLL_MAX_OPTIONS,
  type CreateCorporatePostPollRequest,
  isInCorporatePostAudience,
} from '@legends/shared'
import { prisma } from '../lib/prisma'
import { CorporateMuralError } from '../lib/corporate-mural-error'
import { s3Config } from '../lib/s3-client'
import { scopedPrisma } from '../lib/tenant-scope'
// `toReactorRef` mora no serialize e é usado aqui (e não na rota) porque o
// vizinho `getPostReach` já monta o DTO do painel dentro do service. O import
// não fecha ciclo: o serialize só importa *tipos* deste arquivo.
import { toReactorRef } from '../lib/serialize'
import { recordAuditLog } from './audit-log-service'
import { buildCorporatePostPrompt, parseGeneratedCorporatePost } from '../lib/corporate-post-prompt'
import { requestAgentCompletion, type AgentCompletionFn } from '../lib/agent-client'
import { resolveAiCredentials } from './ai-settings-service'
import { resolveCampaignPromptTemplate } from './campaign-settings-service'
import { corporateMuralHub } from '../lib/corporate-mural-hub'
import { notifyCorporatePostMention, notifyCorporatePostPublished } from './notification-service'

// Reexportado para os call sites (rotas e testes) não mudarem de import: a
// classe mora em `lib/` para o prompt da IA poder lançá-la sem ciclo.
export { CorporateMuralError } from '../lib/corporate-mural-error'

/**
 * Relações que todo post carrega para virar DTO.
 *
 * É **função** por causa de `reads`: o que interessa é se QUEM ESTÁ OLHANDO já
 * leu, não a lista de leitores. Com `@@unique([postId, userId])`, o filtro por
 * viewer devolve 0 ou 1 linha por post; sem ele, uma página do feed traria todos
 * os leitores de todos os comunicados só para responder um booleano — e o custo
 * cresceria com o tamanho da empresa.
 */
export function corporatePostInclude(viewerId: string) {
  return {
    // `sector` vem junto do autor porque a autoria do card exibe "nome · setor".
    author: { include: { sector: { select: { id: true, name: true } } } },
    reactions: { include: { user: true }, orderBy: { createdAt: 'asc' } },
    mentions: true,
    sectors: { include: { sector: { select: { id: true, name: true } } } },
    attachments: { orderBy: { createdAt: 'asc' } },
    // A enquete traz a contagem agregada por opção e, dos votos, SÓ o do
    // próprio viewer. É o que impede id de votante alheio de sair daqui — o
    // resultado é escondido na API, não na tela.
    poll: {
      include: {
        options: { orderBy: { position: 'asc' }, include: { _count: { select: { votes: true } } } },
        votes: { where: { userId: viewerId }, select: { optionId: true } },
      },
    },
    reads: { where: { userId: viewerId }, select: { readAt: true } },
    tag: true,
    _count: { select: { comments: true } },
  } as const
}
export type CorporatePostWithRelations = Prisma.CorporatePostGetPayload<{
  include: ReturnType<typeof corporatePostInclude>
}>

export const corporatePostCommentInclude = {
  author: true,
  reactions: { include: { user: true }, orderBy: { createdAt: 'asc' } },
  mentions: true,
} as const
export type CorporatePostCommentWithRelations = Prisma.CorporatePostCommentGetPayload<{
  include: typeof corporatePostCommentInclude
}>

/** Conteúdo do comentário: texto (1..MAX) OU anexo (gif/imagem). Devolve o texto trimado. */
function assertCommentContent(content: string, hasAttachment: boolean): string {
  const trimmed = content.trim()
  if (trimmed.length > CORPORATE_COMMENT_MAX_LENGTH) {
    throw new CorporateMuralError(`O texto precisa ter no máximo ${CORPORATE_COMMENT_MAX_LENGTH} caracteres.`, 400)
  }
  if (trimmed.length === 0 && !hasAttachment) {
    throw new CorporateMuralError('Escreva algo ou anexe um GIF ou imagem.', 400)
  }
  return trimmed
}

/**
 * Corpo do post. O limite é medido no **texto puro** derivado do documento
 * rico, não no JSON: contar caracteres do markup faria o mesmo texto caber ou
 * não conforme a formatação, o que é incompreensível para quem escreve.
 */
function assertPostBody(
  body: RichDoc | undefined,
  fallbackContent: string,
  hasAttachment: boolean,
): { content: string; contentJson: RichDoc | null } {
  const contentJson = body ?? null
  const content = (body ? richDocToPlainText(body) : fallbackContent).trim()
  if (content.length > CORPORATE_POST_BODY_MAX_LENGTH) {
    throw new CorporateMuralError(
      `O comunicado precisa ter no máximo ${CORPORATE_POST_BODY_MAX_LENGTH} caracteres.`,
      400,
    )
  }
  if (content.length === 0 && !hasAttachment) {
    throw new CorporateMuralError('Escreva algo ou anexe um arquivo.', 400)
  }
  return { content, contentJson }
}

/** Título é opcional; quando vem, vem dentro do limite e sem só espaço. */
function normalizeTitle(title: string | undefined): string | null {
  const trimmed = title?.trim() ?? ''
  if (!trimmed) return null
  if (trimmed.length > CORPORATE_POST_TITLE_MAX_LENGTH) {
    throw new CorporateMuralError(`O título precisa ter no máximo ${CORPORATE_POST_TITLE_MAX_LENGTH} caracteres.`, 400)
  }
  return trimmed
}

/**
 * Anexos: espécie derivada do content-type (não a que o cliente rotulou), teto
 * de tamanho por espécie e URL obrigatoriamente do nosso bucket público.
 *
 * O `kind` do corpo é ignorado de propósito: quem manda o JSON escolheria
 * "IMAGE" para um .exe e o card tentaria desenhá-lo como foto.
 */
function assertAttachments(attachments: CorporatePostAttachmentInput[] | undefined) {
  if (!attachments?.length) return []
  if (attachments.length > MAX_CORPORATE_POST_ATTACHMENTS) {
    throw new CorporateMuralError(`Anexe no máximo ${MAX_CORPORATE_POST_ATTACHMENTS} arquivos.`, 400)
  }
  const cfg = s3Config()
  return attachments.map((att) => {
    const kind = mediaKindFor(att.contentType)
    if (!kind) throw new CorporateMuralError('Formato de anexo não suportado.', 400)
    if (att.size > mediaMaxBytesFor(kind)) throw new CorporateMuralError('Anexo maior que o limite.', 400)
    if (!cfg || !att.url.startsWith(`${cfg.publicBaseUrl}/`)) {
      throw new CorporateMuralError('Anexo inválido.', 400)
    }
    return {
      kind,
      url: att.url,
      name: att.name.trim().slice(0, 200) || 'arquivo',
      contentType: att.contentType,
      size: att.size,
      width: att.width ?? null,
      height: att.height ?? null,
    }
  })
}

/** Quem está lendo o feed — o recorte de visibilidade sai daqui. */
export interface CorporateMuralViewer {
  userId: string
  sectorId: string
  role: string
  adminAccess?: boolean
  companyId: string
}

/**
 * Recorte por **público-alvo** do post. ADMIN/SUBADMIN não têm recorte: sem
 * isso a G&G não conseguiria moderar o que ela mesma segmentou.
 *
 * Vale em TODO ponto de leitura (feed, post isolado, comentários, reação,
 * leitura) — se valesse só no feed, o deep-link da notificação entregaria o
 * comunicado a quem está fora do público.
 */
function audienceWhere(viewer: CorporateMuralViewer): Prisma.CorporatePostWhereInput {
  if (canModerateCorporatePost(viewer.role, viewer.adminAccess)) return {}
  return {
    OR: [
      { audienceScope: 'ALL' },
      { sectors: { some: { sectorId: viewer.sectorId } } },
      // Comunicado da liderança: alcança pelo PAPEL, não pelo setor. Quem não
      // lidera nunca casa aqui, e quem modera já entrou pelo atalho acima.
      ...(isLeaderRole(viewer.role) ? [{ audienceScope: 'LEADERS' as const }] : []),
    ],
  }
}

/**
 * Recorte do feed: publicado **e** dentro do público. Pendente não entra nem
 * para o autor — ele vê o próprio envio na fila ("Meus envios"), que é onde o
 * estado do post faz sentido.
 *
 * Composto em `AND` (e não espalhado no objeto) porque `audienceWhere` usa
 * `OR`, e o keyset do cursor também: dois `OR` na mesma raiz sobrescreveriam
 * um ao outro.
 */
function feedWhere(viewer: CorporateMuralViewer, extra: Prisma.CorporatePostWhereInput[] = []) {
  return {
    author: { active: true },
    status: 'PUBLISHED' as const,
    AND: [audienceWhere(viewer), ...extra],
  }
}

/**
 * Resolve o público-alvo em ids de setor válidos: só setores ativos da própria
 * empresa (o `scopedPrisma` recorta), sem repetição. Escopo `SECTORS` sem setor
 * nenhum é 400 — publicar para ninguém é sempre erro de quem preencheu.
 */
async function resolveAudienceSectors(
  audience: CorporatePostAudience,
  sectorIds: string[] | undefined,
  companyId: string,
): Promise<string[]> {
  // `ALL` e `LEADERS` não têm setor: o primeiro é a empresa toda, o segundo
  // recorta por papel. Exigir setor neles seria pedir um dado sem significado.
  if (!audienceHasSectors(audience)) return []
  const unique = [...new Set(sectorIds ?? [])]
  if (unique.length === 0) {
    throw new CorporateMuralError('Escolha ao menos um setor para o público-alvo.', 400)
  }
  const rows = await scopedPrisma(companyId).sector.findMany({
    where: { id: { in: unique }, active: true },
    select: { id: true },
  })
  if (rows.length === 0) {
    throw new CorporateMuralError('Nenhum dos setores escolhidos está disponível.', 400)
  }
  return rows.map((s) => s.id)
}

/** Valida que a URL do gif aponta para um host de CDN do Giphy permitido. */
function assertGifHost(gif?: AttachedGif): void {
  if (!gif) return
  let hostname = ''
  try {
    hostname = new URL(gif.url).hostname
  } catch {
    throw new CorporateMuralError('GIF inválido.', 400)
  }
  if (!isGiphyHost(hostname)) {
    throw new CorporateMuralError('GIF inválido.', 400)
  }
}

/**
 * Pergunta e opções da enquete, já limpas — ou `null` quando não há enquete.
 *
 * Mesmos limites da enquete da Resenha (`normalizePoll`, em review-service): é
 * a mesma pergunta feita em outro lugar, e divergir criaria duas regras para o
 * usuário decorar. Opções iguais depois do trim são recusadas comparando sem
 * caixa em pt-BR — "Sim" e "sim" na mesma enquete é erro de digitação, não
 * escolha.
 */
function normalizePoll(poll?: CreateCorporatePostPollRequest | null): {
  question: string
  options: string[]
} | null {
  if (!poll) return null
  const question = poll.question.trim()
  if (question.length === 0 || question.length > CORPORATE_POST_POLL_QUESTION_MAX_LENGTH) {
    throw new CorporateMuralError(
      `A pergunta precisa ter de 1 a ${CORPORATE_POST_POLL_QUESTION_MAX_LENGTH} caracteres.`,
      400,
    )
  }
  const options = (poll.options ?? []).map((opt) => opt.trim())
  if (
    options.length < CORPORATE_POST_POLL_MIN_OPTIONS ||
    options.length > CORPORATE_POST_POLL_MAX_OPTIONS
  ) {
    throw new CorporateMuralError(
      `A enquete precisa ter de ${CORPORATE_POST_POLL_MIN_OPTIONS} a ${CORPORATE_POST_POLL_MAX_OPTIONS} opções.`,
      400,
    )
  }
  for (const option of options) {
    if (option.length === 0 || option.length > CORPORATE_POST_POLL_OPTION_MAX_LENGTH) {
      throw new CorporateMuralError(
        `Cada opção precisa ter de 1 a ${CORPORATE_POST_POLL_OPTION_MAX_LENGTH} caracteres.`,
        400,
      )
    }
  }
  const distintas = new Set(options.map((opt) => opt.toLocaleLowerCase('pt-BR')))
  if (distintas.size !== options.length) {
    throw new CorporateMuralError('Use opções diferentes.', 400)
  }
  return { question, options }
}

/** Um post/comentário aceita no máximo um anexo: gif OU imagem. */
function assertSingleAttachment(gif?: AttachedGif, image?: AttachedImage): void {
  if (gif && image) {
    throw new CorporateMuralError('Anexe um GIF ou uma imagem, não os dois.', 400)
  }
}

/** Valida que a URL da imagem aponta para o nosso bucket público (S3_PUBLIC_BASE_URL). */
function assertImageHost(image?: AttachedImage): void {
  if (!image) return
  const cfg = s3Config()
  if (!cfg || !image.url.startsWith(`${cfg.publicBaseUrl}/`)) {
    throw new CorporateMuralError('Imagem inválida.', 400)
  }
}

/**
 * Resolve mentionedUserIds em {userId, name}: dedup, só ativos não-admin da
 * empresa — sem recorte de setor, o mural é de todo mundo. Cap
 * MAX_CORPORATE_POST_MENTIONS.
 */
async function resolveMentions(
  userIds: string[] | undefined,
  companyId: string,
): Promise<{ userId: string; name: string }[]> {
  if (!userIds?.length) return []
  const unique = [...new Set(userIds)].slice(0, MAX_CORPORATE_POST_MENTIONS)
  const users = await scopedPrisma(companyId).user.findMany({
    where: { id: { in: unique }, active: true, role: { notIn: ['ADMIN', 'SUBADMIN'] } },
    select: { id: true, name: true },
  })
  return users.map((u) => ({ userId: u.id, name: u.name }))
}

function encodeCursor(n: { createdAt: Date; id: string }): string {
  return Buffer.from(`${n.createdAt.toISOString()}|${n.id}`).toString('base64url')
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|', 2)
    const createdAt = new Date(iso)
    if (!id || Number.isNaN(createdAt.getTime())) return null
    return { createdAt, id }
  } catch {
    return null
  }
}

/**
 * Cria um comunicado. **Todo colaborador escreve**; o papel decide se ele nasce
 * `PUBLISHED` ou `PENDING` (ver `canPublishCorporatePostDirectly`) — publicar
 * deixou de ser privilégio de liderança porque escrever deixou de ser.
 *
 * `body` é o documento rico do composer; `content` (texto puro) é o caminho de
 * quem só tem texto — a publicação de um item do calendário editorial, por
 * exemplo. Quando os dois vêm, o texto puro é **derivado** do documento: ter
 * duas fontes de verdade divergentes é o que a coluna antiga não pode ter.
 */
export async function createPost(input: {
  authorId: string
  content?: string
  body?: RichDoc
  title?: string
  mentionedUserIds?: string[]
  gif?: AttachedGif
  image?: AttachedImage
  attachments?: CorporatePostAttachmentInput[]
  audience?: CorporatePostAudience
  audienceSectorIds?: string[]
  /** Tipo de comunicação (seção 13). Opcional — comunicado sem tipo é válido. */
  tagId?: string | null
  /**
   * Instante marcado para a publicação (Documento 4, seção 12). Ignorado
   * quando o autor cai na fila de aprovação: agendar o que ainda pode ser
   * recusado é prometer uma publicação que não se controla.
   */
  publishAt?: Date | null
  poll?: CreateCorporatePostPollRequest | null
  companyId: string
  /**
   * Cliente de uma transação já aberta pelo chamador. Existe para publicar um
   * item do calendário editorial e marcá-lo como publicado atomicamente: sem
   * isso, uma falha no meio deixaria post no mural com item ainda agendado, e a
   * próxima tentativa duplicaria o comunicado.
   */
  tx?: Prisma.TransactionClient
}): Promise<CorporatePostWithRelations> {
  assertSingleAttachment(input.gif, input.image)
  const attachments = assertAttachments(input.attachments)
  const poll = normalizePoll(input.poll)
  // A enquete conta como conteúdo: post que é só a pergunta é legítimo, e
  // exigir texto junto obrigaria a escrever a pergunta duas vezes.
  const hasAttachment = Boolean(input.gif || input.image || attachments.length || poll)
  const { content, contentJson } = assertPostBody(input.body, input.content ?? '', hasAttachment)
  const title = normalizeTitle(input.title)
  assertGifHost(input.gif)
  assertImageHost(input.image)
  const author = await prisma.user.findUnique({ where: { id: input.authorId } })
  if (!author || !author.active) {
    throw new CorporateMuralError('Autor inválido.', 400)
  }
  const audienceScope = input.audience ?? 'ALL'
  const sectorIds = await resolveAudienceSectors(audienceScope, input.audienceSectorIds, input.companyId)
  // As menções vêm do documento (o editor marca a pessoa no texto) e também da
  // lista explícita, que é o caminho do composer antigo e dos comentários.
  const mentions = await resolveMentions(
    [...(input.mentionedUserIds ?? []), ...(input.body ? richDocMentionIds(input.body) : [])],
    input.companyId,
  )
  const publicaDireto = canPublishCorporatePostDirectly(author.role, author.adminAccess)
  const publishAt = publicaDireto ? (input.publishAt ?? null) : null
  const status = publicaDireto ? (publishAt ? 'SCHEDULED' : 'PUBLISHED') : 'PENDING'
  const db = input.tx ?? scopedPrisma(input.companyId)
  return db.corporatePost.create({
    data: {
      companyId: input.companyId,
      authorId: input.authorId,
      content,
      ...(contentJson ? { contentJson: contentJson as unknown as Prisma.InputJsonValue } : {}),
      ...(title ? { title } : {}),
      status,
      ...(publishAt ? { publishAt } : {}),
      audienceScope,
      ...(input.gif ? { gifUrl: input.gif.url, gifWidth: input.gif.width, gifHeight: input.gif.height } : {}),
      ...(input.image
        ? { imageUrl: input.image.url, imageWidth: input.image.width, imageHeight: input.image.height }
        : {}),
      ...(input.tagId ? { tagId: input.tagId } : {}),
      ...(sectorIds.length
        ? { sectors: { create: sectorIds.map((sectorId) => ({ sectorId, companyId: input.companyId })) } }
        : {}),
      ...(attachments.length
        ? { attachments: { create: attachments.map((att) => ({ ...att, companyId: input.companyId })) } }
        : {}),
      ...(poll
        ? {
            poll: {
              create: {
                question: poll.question,
                companyId: input.companyId,
                options: {
                  create: poll.options.map((text, position) => ({
                    text,
                    position,
                    companyId: input.companyId,
                  })),
                },
              },
            },
          }
        : {}),
      ...(mentions.length
        ? {
            mentions: {
              create: mentions.map((m) => ({
                userId: m.userId,
                name: m.name,
                companyId: input.companyId,
              })),
            },
          }
        : {}),
    },
    include: corporatePostInclude(input.authorId),
  })
}

/**
 * Comunicado no ar: menções, sininho do público-alvo e os dois eventos de
 * WebSocket. `post:published` é o que vira toast — magro de propósito, só o id:
 * o hub é canal único e global, então título no broadcast vazaria comunicado de
 * uma empresa para conexão de outra (ver `corporate-mural-hub.ts`).
 *
 * Mora no service, e não na rota, porque quem publica não é só a request:
 * o scheduler dos agendados (Documento 4, seção 12) publica no tick e precisa
 * avisar exatamente do mesmo jeito. Duas cópias divergiriam no primeiro ajuste,
 * e comunicado agendado que sai sem notificação não é comunicado.
 *
 * Best-effort dos dois lados: falha de notificação é logada e não desfaz a
 * publicação.
 */
export async function announceCorporatePostPublished(
  post: {
    id: string
    title: string | null
    authorId: string
    mentions: { userId: string }[]
    sectors: { sectorId: string }[]
    audienceScope: CorporatePostAudience
  },
  companyId: string,
  log: { error: (err: unknown) => void },
): Promise<void> {
  try {
    await notifyCorporatePostMention(
      { recipientIds: post.mentions.map((m) => m.userId), actorId: post.authorId, postId: post.id },
      companyId,
    )
  } catch (notifyErr) {
    log.error(notifyErr)
  }
  try {
    await notifyCorporatePostPublished(
      {
        postId: post.id,
        title: post.title,
        authorId: post.authorId,
        sectorIds: post.sectors.map((s) => s.sectorId),
        audience: post.audienceScope,
      },
      companyId,
    )
  } catch (notifyErr) {
    log.error(notifyErr)
  }
  corporateMuralHub.broadcast({ type: 'feed:changed' })
  corporateMuralHub.broadcast({ type: 'post:published', postId: post.id })
}

/**
 * Edita o texto, o título, o público e os anexos de um comunicado.
 *
 * Quem edita: quem administra (é o pedido da G&G) e o **autor enquanto o post
 * está pendente** — mexer no próprio rascunho antes de alguém aprovar não é
 * moderação. Publicado, só a administração edita: senão daria para publicar um
 * texto inócuo, passar pela aprovação e trocar o conteúdo depois.
 *
 * `editedAt` é gravado só quando o texto/título muda de fato — mudar apenas o
 * público-alvo não é "editado" para quem lê o card.
 */
export async function updatePost(input: {
  postId: string
  actorId: string
  role: string
  adminAccess?: boolean
  companyId: string
  content?: string
  body?: RichDoc
  title?: string
  attachments?: CorporatePostAttachmentInput[]
  audience?: CorporatePostAudience
  audienceSectorIds?: string[]
  /** `null` limpa o tipo; `undefined` não mexe. */
  tagId?: string | null
  /** `null` remove a enquete; `undefined` não mexe. Só antes do primeiro voto. */
  poll?: CreateCorporatePostPollRequest | null
}): Promise<CorporatePostWithRelations> {
  const db = scopedPrisma(input.companyId)
  const existing = await db.corporatePost.findUnique({
    where: { id: input.postId },
    select: {
      id: true,
      authorId: true,
      title: true,
      content: true,
      status: true,
      audienceScope: true,
      gifUrl: true,
      imageUrl: true,
      _count: { select: { attachments: true } },
      poll: { select: { id: true, _count: { select: { votes: true } } } },
    },
  })
  if (!existing) throw new CorporateMuralError('Publicação não encontrada.', 404)

  const moderator = canModerateCorporatePost(input.role, input.adminAccess)
  const ownPending = existing.authorId === input.actorId && existing.status === 'PENDING'
  if (!moderator && !ownPending) {
    throw new CorporateMuralError('Sem permissão para editar esta publicação.', 403)
  }

  // `attachments` ausente no corpo significa "não mexa nos anexos" — então o
  // que conta para "o post tem anexo?" são os que já estão gravados.
  const attachments = input.attachments === undefined ? null : assertAttachments(input.attachments)
  // A enquete congela no primeiro voto: trocar a pergunta ou uma opção depois
  // que alguém votou transforma o resultado em resposta a outra coisa. Antes
  // disso — post na fila de aprovação, tipicamente — corrigir é legítimo.
  const poll = input.poll === undefined ? undefined : normalizePoll(input.poll)
  if (input.poll !== undefined && existing.poll && existing.poll._count.votes > 0) {
    throw new CorporateMuralError('A enquete não pode mudar depois do primeiro voto.', 409)
  }
  const temEnqueteDepois = input.poll === undefined ? Boolean(existing.poll) : poll !== null
  const hasAttachment = Boolean(
    existing.gifUrl ||
      existing.imageUrl ||
      (attachments === null ? existing._count.attachments : attachments.length) ||
      temEnqueteDepois,
  )
  const textChanged = input.body !== undefined || input.content !== undefined
  const { content, contentJson } = textChanged
    ? assertPostBody(input.body, input.content ?? '', hasAttachment)
    : { content: existing.content, contentJson: null }
  const title = input.title === undefined ? undefined : normalizeTitle(input.title)
  const audienceScope = input.audience ?? existing.audienceScope
  const sectorIds =
    input.audience === undefined && input.audienceSectorIds === undefined
      ? null
      : await resolveAudienceSectors(audienceScope, input.audienceSectorIds, input.companyId)

  const titleChanged = title !== undefined && title !== existing.title
  const contentChanged = textChanged && content !== existing.content

  return db.$transaction(async (tx) => {
    if (sectorIds !== null) {
      await tx.corporatePostSector.deleteMany({ where: { postId: input.postId } })
      if (sectorIds.length) {
        await tx.corporatePostSector.createMany({
          data: sectorIds.map((sectorId) => ({ postId: input.postId, sectorId, companyId: input.companyId })),
        })
      }
    }
    if (attachments !== null) {
      await tx.corporatePostAttachment.deleteMany({ where: { postId: input.postId } })
      if (attachments.length) {
        await tx.corporatePostAttachment.createMany({
          data: attachments.map((att) => ({ ...att, postId: input.postId, companyId: input.companyId })),
        })
      }
    }
    if (input.poll !== undefined) {
      // Apaga e recria em vez de casar opção a opção: sem voto gravado não há
      // nada a preservar, e reconciliar posição por posição só criaria caminhos
      // para divergir.
      await tx.corporatePostPoll.deleteMany({ where: { postId: input.postId } })
      if (poll) {
        await tx.corporatePostPoll.create({
          data: {
            postId: input.postId,
            question: poll.question,
            companyId: input.companyId,
            options: {
              create: poll.options.map((text, position) => ({
                text,
                position,
                companyId: input.companyId,
              })),
            },
          },
        })
      }
    }
    const updated = await tx.corporatePost.update({
      where: { id: input.postId },
      data: {
        ...(textChanged
          ? { content, contentJson: (contentJson ?? Prisma.DbNull) as Prisma.InputJsonValue | typeof Prisma.DbNull }
          : {}),
        ...(title !== undefined ? { title } : {}),
        ...(input.audience !== undefined ? { audienceScope } : {}),
        // `null` limpa o tipo, `undefined` não mexe — trocar a categoria não é
        // edição de texto, então não carimba `editedAt`.
        ...(input.tagId !== undefined ? { tagId: input.tagId } : {}),
        ...(titleChanged || contentChanged ? { editedAt: new Date() } : {}),
      },
      include: corporatePostInclude(input.actorId),
    })
    await recordAuditLog({
      actorId: input.actorId,
      entityType: 'CorporatePost',
      entityId: input.postId,
      action: 'UPDATE',
      before: {
        subject: auditPostSubject(existing),
        title: existing.title,
        content: existing.content,
        audienceScope: existing.audienceScope,
      },
      after: {
        subject: auditPostSubject(updated),
        title: updated.title,
        content: updated.content,
        audienceScope: updated.audienceScope,
      },
      companyId: input.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
    return updated
  })
}

/**
 * Rótulo curto do comunicado para a linha da auditoria (`subject`, lido por
 * `auditSubjectName`) — a maioria dos comunicados não tem título (é só texto
 * corrido), e sem isso a tela de Auditoria caía no cuid puro do post, o que
 * ninguém reconhece de cabeça.
 */
function auditPostSubject(post: { title: string | null; content: string }): string {
  const title = post.title?.trim()
  if (title) return title
  const trimmed = post.content.trim()
  return trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed
}

/**
 * Aprova um comunicado da fila. O `updateMany` condicional em `status: PENDING`
 * é o ponto de serialização (mesmo padrão de `publishCampaignPost`): duas
 * aprovações concorrentes lêem `PENDING` as duas, mas só uma casa a linha — a
 * outra recebe `count: 0` e vira 409, então o autor é notificado uma vez só.
 */
export async function approvePost(input: {
  postId: string
  actorId: string
  companyId: string
}): Promise<CorporatePostWithRelations> {
  const db = scopedPrisma(input.companyId)
  const existing = await db.corporatePost.findUnique({
    where: { id: input.postId },
    select: { id: true, status: true, authorId: true, title: true, content: true },
  })
  if (!existing) throw new CorporateMuralError('Publicação não encontrada.', 404)
  if (existing.status === 'PUBLISHED') throw new CorporateMuralError('Este comunicado já foi publicado.', 409)
  // A fila existe para um segundo par de olhos ver o que o autor escreveu — o
  // guard da rota (admin/subadmin) não basta sozinho: um autor com acesso
  // administrativo delegado passaria nele e aprovaria o próprio comunicado.
  if (existing.authorId === input.actorId) {
    throw new CorporateMuralError('Você não pode aprovar o próprio comunicado.', 403)
  }

  return db.$transaction(async (tx) => {
    const claimed = await tx.corporatePost.updateMany({
      where: { id: input.postId, status: 'PENDING' },
      data: {
        status: 'PUBLISHED',
        reviewedAt: new Date(),
        reviewedById: input.actorId,
        rejectionReason: null,
        // O comunicado passa a existir para a empresa agora, não quando foi
        // escrito: o feed é ordenado por `createdAt`, e manter a data do envio
        // faria o post aprovado dias depois nascer no meio do feed, invisível.
        createdAt: new Date(),
      },
    })
    if (claimed.count === 0) throw new CorporateMuralError('Este comunicado já foi revisado.', 409)
    const updated = await tx.corporatePost.findUniqueOrThrow({
      where: { id: input.postId },
      include: corporatePostInclude(input.actorId),
    })
    await recordAuditLog({
      actorId: input.actorId,
      entityType: 'CorporatePost',
      entityId: input.postId,
      action: 'UPDATE',
      before: { subject: auditPostSubject(existing), status: existing.status },
      after: { subject: auditPostSubject(existing), status: updated.status },
      companyId: input.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
    return updated
  })
}

/** Recusa um comunicado da fila, com motivo opcional. Mesmo travamento do approve. */
export async function rejectPost(input: {
  postId: string
  actorId: string
  companyId: string
  reason?: string
}): Promise<CorporatePostWithRelations> {
  const db = scopedPrisma(input.companyId)
  const existing = await db.corporatePost.findUnique({
    where: { id: input.postId },
    select: { id: true, status: true, authorId: true, title: true, content: true },
  })
  if (!existing) throw new CorporateMuralError('Publicação não encontrada.', 404)
  if (existing.status !== 'PENDING') throw new CorporateMuralError('Este comunicado já foi revisado.', 409)
  if (existing.authorId === input.actorId) {
    throw new CorporateMuralError('Você não pode recusar o próprio comunicado.', 403)
  }

  return db.$transaction(async (tx) => {
    const claimed = await tx.corporatePost.updateMany({
      where: { id: input.postId, status: 'PENDING' },
      data: {
        status: 'REJECTED',
        reviewedAt: new Date(),
        reviewedById: input.actorId,
        rejectionReason: input.reason?.trim() || null,
      },
    })
    if (claimed.count === 0) throw new CorporateMuralError('Este comunicado já foi revisado.', 409)
    const updated = await tx.corporatePost.findUniqueOrThrow({
      where: { id: input.postId },
      include: corporatePostInclude(input.actorId),
    })
    await recordAuditLog({
      actorId: input.actorId,
      entityType: 'CorporatePost',
      entityId: input.postId,
      action: 'UPDATE',
      before: { subject: auditPostSubject(existing), status: existing.status },
      after: { subject: auditPostSubject(existing), status: updated.status, rejectionReason: updated.rejectionReason },
      companyId: input.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
    return updated
  })
}

/**
 * Fila de revisão. Para quem administra, é a fila da empresa; para o
 * colaborador, é "Meus envios" — o mesmo dado com escopo diferente, porque é o
 * único lugar onde o autor vê o próprio post pendente ou recusado.
 */
export async function listPendingPosts(
  viewer: CorporateMuralViewer,
  opts: { mine?: boolean } = {},
): Promise<CorporatePostWithRelations[]> {
  const moderator = canModerateCorporatePost(viewer.role, viewer.adminAccess)
  const mine = opts.mine || !moderator
  return scopedPrisma(viewer.companyId).corporatePost.findMany({
    where: {
      // O agendado entra em "Meus envios": é o único lugar onde quem marcou a
      // data confere o que marcou. Sem isso, agendar seria publicar num buraco.
      status: mine ? { in: ['PENDING', 'SCHEDULED', 'REJECTED'] } : 'PENDING',
      ...(mine ? { authorId: viewer.userId } : {}),
    },
    include: corporatePostInclude(viewer.userId),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 100,
  })
}

/**
 * `limit` limita a página do keyset (posts não fixados). O fixado não ocupa
 * vaga do keyset — ele é buscado à parte e prefixado só na 1ª página — então
 * quando existe um fixado a 1ª página pode devolver `limit + 1` itens
 * (fixado + `limit` do keyset). Reservar uma vaga do `limit` pro fixado
 * quebraria em `limit: 1`: o keyset devolveria zero linhas, `nextCursor`
 * não teria de onde sair, e os próximos posts seriam pulados.
 */
/**
 * Agendados do feed da empresa numa janela de datas — o que o calendário
 * editorial mostra ao lado dos itens de campanha.
 *
 * Sem recorte por autor, ao contrário de `listPendingPosts`: ali a pergunta é
 * "o que EU mandei e ainda não saiu", aqui é "o que a empresa vai publicar
 * neste mês". Quem pode fazer a pergunta é a rota que chama, não esta função.
 *
 * `PENDING` fica de fora de propósito: comunicado que ainda pode ser recusado
 * não tem data marcada (`createPost` ignora `publishAt` de quem cai na fila),
 * então não teria onde cair na grade.
 */
export function listScheduledFeedPosts(
  companyId: string,
  range: { from: Date; to: Date },
): Promise<ScheduledFeedPost[]> {
  return scopedPrisma(companyId).corporatePost.findMany({
    where: { status: 'SCHEDULED', publishAt: { gte: range.from, lte: range.to } },
    select: {
      id: true,
      title: true,
      content: true,
      publishAt: true,
      createdAt: true,
      author: { select: { id: true, name: true } },
    },
    orderBy: { publishAt: 'asc' },
  })
}

export interface ScheduledFeedPost {
  id: string
  title: string | null
  content: string
  publishAt: Date | null
  createdAt: Date
  author: { id: string; name: string }
}

export async function listFeed(
  viewer: CorporateMuralViewer,
  opts: { cursor?: string; limit: number; tagId?: string },
): Promise<{ items: CorporatePostWithRelations[]; nextCursor: string | null }> {
  const db = scopedPrisma(viewer.companyId)
  const decoded = opts.cursor ? decodeCursor(opts.cursor) : null
  // Filtro por tipo de comunicação (seção 13). É do SERVIDOR, e não do cliente:
  // o feed pagina por cursor, e filtrar depois de paginar esconderia o
  // comunicado que está na página seguinte.
  const tagFilter: Prisma.CorporatePostWhereInput[] = opts.tagId ? [{ tagId: opts.tagId }] : []

  // O fixado sai do keyset e entra prefixado só na 1ª página. Ordenar por
  // `pinnedAt` dentro do keyset obrigaria a mudar o formato do cursor sem
  // ganho: no máximo um post fica fixado por vez.
  const pinned = await db.corporatePost.findFirst({
    where: feedWhere(viewer, [{ pinnedAt: { not: null } }, ...tagFilter]),
    include: corporatePostInclude(viewer.userId),
    orderBy: { pinnedAt: 'desc' },
  })

  const where: Prisma.CorporatePostWhereInput = feedWhere(viewer, [
    ...tagFilter,
    ...(pinned ? [{ id: { not: pinned.id } }] : []),
    ...(decoded
      ? [
          {
            OR: [
              { createdAt: { lt: decoded.createdAt } },
              { createdAt: decoded.createdAt, id: { lt: decoded.id } },
            ],
          },
        ]
      : []),
  ])
  const rows = await db.corporatePost.findMany({
    where,
    include: corporatePostInclude(viewer.userId),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: opts.limit + 1,
  })
  const hasMore = rows.length > opts.limit
  const page = hasMore ? rows.slice(0, opts.limit) : rows
  // O cursor sai SEMPRE do último item do keyset (`page`), nunca do fixado —
  // prefixar o fixado no cursor faria a página seguinte pular posts.
  const nextCursor = hasMore ? encodeCursor(page[page.length - 1]) : null
  const items = !decoded && pinned ? [pinned, ...page] : page
  return { items, nextCursor }
}

/**
 * Post isolado — é o que sustenta o deep-link da notificação e o toast do
 * comunicado novo (o WebSocket manda só o id; o conteúdo vem daqui).
 *
 * Fora do público-alvo é **404**, não 403: dizer "existe, mas não é para você"
 * já vaza que houve comunicado para outro setor. O autor vê o próprio post em
 * qualquer status; quem administra vê todos.
 */
export async function getPost(postId: string, viewer: CorporateMuralViewer): Promise<CorporatePostWithRelations> {
  const post = await scopedPrisma(viewer.companyId).corporatePost.findFirst({
    where: {
      id: postId,
      AND: [
        audienceWhere(viewer),
        canModerateCorporatePost(viewer.role, viewer.adminAccess)
          ? {}
          : { OR: [{ status: 'PUBLISHED' }, { authorId: viewer.userId }] },
      ],
    },
    include: corporatePostInclude(viewer.userId),
  })
  if (!post) throw new CorporateMuralError('Publicação não encontrada.', 404)
  return post
}

/**
 * Confere que o viewer alcança o post antes de comentar, reagir ou marcar
 * leitura. Devolve o mínimo que os call sites usam.
 *
 * Interagir exige post **publicado** — nem o autor comenta o próprio pendente,
 * que ainda não existe para a empresa.
 */
/**
 * Voto na enquete do post.
 *
 * Três recusas distintas, de propósito — cada uma diz uma coisa diferente para
 * quem está do outro lado:
 *
 * - **404** o post ou a opção não existem no escopo de quem pediu;
 * - **409** o post existe mas ainda não está publicado (pendente ou agendado):
 *   não é "não encontrei", é "ainda não abriu";
 * - **403** quem pede está fora do público-alvo. É o caso do ADMIN moderando um
 *   comunicado de outro setor: ele enxerga, mas não participa.
 */
export async function voteCorporatePostPoll(input: {
  postId: string
  optionId: string
  viewer: CorporateMuralViewer
}): Promise<CorporatePostWithRelations> {
  const { viewer } = input
  const db = scopedPrisma(viewer.companyId)
  const post = await db.corporatePost.findUnique({
    where: { id: input.postId },
    select: {
      id: true,
      status: true,
      audienceScope: true,
      sectors: { select: { sectorId: true } },
      poll: { select: { id: true, options: { select: { id: true } } } },
    },
  })
  if (!post || !post.poll) {
    throw new CorporateMuralError('Enquete não encontrada.', 404)
  }
  if (post.status !== 'PUBLISHED') {
    throw new CorporateMuralError('Esta enquete ainda não está aberta para votos.', 409)
  }
  if (!isInCorporatePostAudience(post, viewer)) {
    throw new CorporateMuralError('Esta enquete é de outro público.', 403)
  }
  if (!post.poll.options.some((option) => option.id === input.optionId)) {
    throw new CorporateMuralError('Opção da enquete não encontrada.', 404)
  }

  const jaVotou = await prisma.corporatePostPollVote.findUnique({
    where: { pollId_userId: { pollId: post.poll.id, userId: viewer.userId } },
    select: { id: true },
  })
  if (jaVotou) {
    throw new CorporateMuralError('Você já votou nesta enquete.', 409)
  }
  try {
    await db.corporatePostPollVote.create({
      data: {
        pollId: post.poll.id,
        optionId: input.optionId,
        userId: viewer.userId,
        companyId: viewer.companyId,
      },
    })
  } catch (err) {
    // A checagem acima cobre o caminho normal; a unique cobre os dois cliques
    // que chegaram juntos. As duas respondem a mesma coisa.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new CorporateMuralError('Você já votou nesta enquete.', 409)
    }
    throw err
  }

  const atualizado = await db.corporatePost.findUnique({
    where: { id: input.postId },
    include: corporatePostInclude(viewer.userId),
  })
  if (!atualizado) throw new CorporateMuralError('Publicação não encontrada.', 404)
  return atualizado
}

/**
 * Quem votou em quê. Só para quem já votou — antes disso, ver a lista nominal
 * seria ver o resultado sem pagar o preço de se posicionar, que é exatamente o
 * que a enquete esconde.
 */
export async function listCorporatePostPollVotes(input: {
  postId: string
  viewer: CorporateMuralViewer
}): Promise<{
  pollId: string
  question: string
  /** `User` cru: quem serializa é a rota, com `toReactorRef` — é ele que
   *  sanitiza estilo e opções de avatar gravados por versões antigas. */
  options: { optionId: string; text: string; voters: User[] }[]
}> {
  const { viewer } = input
  const poll = await scopedPrisma(viewer.companyId).corporatePostPoll.findUnique({
    where: { postId: input.postId },
    include: {
      votes: { where: { userId: viewer.userId }, select: { id: true } },
      options: {
        orderBy: { position: 'asc' },
        include: {
          votes: { orderBy: { createdAt: 'asc' }, include: { user: true } },
        },
      },
    },
  })
  if (!poll) {
    throw new CorporateMuralError('Enquete não encontrada.', 404)
  }
  if (poll.votes.length === 0) {
    throw new CorporateMuralError('Vote na enquete para ver quem votou.', 403)
  }
  return {
    pollId: poll.id,
    question: poll.question,
    options: poll.options.map((option) => ({
      optionId: option.id,
      text: option.text,
      voters: option.votes.map((vote) => vote.user),
    })),
  }
}

async function requireVisiblePost(
  postId: string,
  viewer: CorporateMuralViewer,
): Promise<{ id: string; authorId: string; content: string; contentJson: Prisma.JsonValue }> {
  const post = await scopedPrisma(viewer.companyId).corporatePost.findFirst({
    where: { id: postId, status: 'PUBLISHED', AND: [audienceWhere(viewer)] },
    select: { id: true, authorId: true, content: true, contentJson: true },
  })
  if (!post) throw new CorporateMuralError('Publicação não encontrada.', 404)
  return post
}

export async function deletePost(input: {
  postId: string
  userId: string
  role: string
  adminAccess?: boolean
  companyId: string
}): Promise<void> {
  const db = scopedPrisma(input.companyId)
  const existing = await db.corporatePost.findUnique({
    where: { id: input.postId },
    select: { authorId: true, content: true, createdAt: true },
  })
  if (!existing) throw new CorporateMuralError('Publicação não encontrada.', 404)
  if (existing.authorId !== input.userId && !canAdminister(input)) {
    throw new CorporateMuralError('Sem permissão para excluir esta publicação.', 403)
  }
  /**
   * O item do calendário editorial cai junto (Documento 4, seção 13.2).
   *
   * `CampaignPost.publishedPost` está declarado `onDelete: SetNull`, com a
   * justificativa de que apagar o post do mural não pode derrubar o histórico
   * editorial. A consequência era a que a G&G viu: apagado o comunicado, a
   * linha ficava com `status: PUBLISHED` e `publishedPostId: null`, e o
   * calendário de campanhas seguia mostrando um comunicado que não existe mais.
   *
   * A reversão é deliberada: o "histórico" que o `SetNull` preservava é uma
   * linha órfã afirmando que algo foi publicado quando não foi. O calendário É
   * a lista dos `CampaignPost` — não há como tirar o item da tela sem tirar a
   * linha. Cai só o item ligado a este post; o resto da campanha fica.
   */
  await db.$transaction([
    db.campaignPost.deleteMany({ where: { publishedPostId: input.postId } }),
    db.corporatePost.delete({ where: { id: input.postId } }),
  ])
  // Só ato de moderação vira log: apagar o próprio post é uso normal do mural.
  if (existing.authorId !== input.userId) {
    await recordAuditLog({
      actorId: input.userId,
      entityType: 'CorporatePost',
      entityId: input.postId,
      action: 'DELETE',
      before: { authorId: existing.authorId, content: existing.content, createdAt: existing.createdAt },
      companyId: input.companyId,
    })
  }
}

/**
 * Fixa um post no topo do mural. **No máximo um fixado por empresa** é a
 * intenção: a mesma transação desfixa os demais. Guardamos o instante e o
 * autor (`pinnedAt`/`pinnedById`), não um booleano, porque o histórico
 * importa para auditoria.
 *
 * Ordem importa: marcamos o novo post **antes** de desfixar os outros, não o
 * contrário. Em READ COMMITTED (isolamento padrão, sem `Serializable` — não
 * queremos abort 40001 nem um retry loop), se duas chamadas concorrentes
 * fixam posts diferentes enquanto nenhum está fixado, um `updateMany` de
 * "desfixe quem estiver fixado" rodando primeiro não casaria linha nenhuma
 * (nada fixado ainda) e não travaria nada. Marcando primeiro, o `update` do
 * post-alvo sempre toca uma linha (e a bloqueia), o que fecha a janela na
 * maioria dos casos.
 *
 * Isso **não é uma garantia**: em READ COMMITTED cada `updateMany` enxerga
 * sua própria foto do banco no início da instrução, não o que a outra
 * transação já gravou e ainda não commitou. Na intercalação
 * `T1.update(A) → T2.update(B) → T1.updateMany → T2.updateMany → ambos
 * commitam`, nenhum dos dois `updateMany` vê a linha do outro como fixada
 * (ainda não commitada) — nenhum bloqueia, e os dois posts saem fixados.
 * A ordem estreita bastante a janela de corrida (o caso comum, "nada fixado
 * ainda", vira uma trava real), mas não a fecha. Se isso acontecer, quem lê
 * a lista não quebra: `listFeed` já busca o fixado com `findFirst` e
 * `orderBy: { pinnedAt: 'desc' }`, então só o mais recente aparece — o outro
 * fica com `pinnedAt` preenchido no banco, mas invisível no feed, até
 * alguém fixar de novo e a próxima corrida (ou uma limpeza manual) resolver.
 */
export async function pinPost(input: {
  postId: string
  actorId: string
  companyId: string
}): Promise<CorporatePostWithRelations> {
  const db = scopedPrisma(input.companyId)
  const existing = await db.corporatePost.findUnique({
    where: { id: input.postId },
    select: { id: true, pinnedAt: true, pinnedById: true },
  })
  if (!existing) throw new CorporateMuralError('Publicação não encontrada.', 404)

  return db.$transaction(async (tx) => {
    const updated = await tx.corporatePost.update({
      where: { id: input.postId },
      data: { pinnedAt: new Date(), pinnedById: input.actorId },
      include: corporatePostInclude(input.actorId),
    })
    await tx.corporatePost.updateMany({
      where: { pinnedAt: { not: null }, id: { not: input.postId } },
      data: { pinnedAt: null, pinnedById: null },
    })
    // `tx` é o client estendido por `scopedPrisma`; `recordAuditLog` põe o
    // companyId explícito no data, então o cast só reconcilia a assinatura.
    await recordAuditLog({
      actorId: input.actorId,
      entityType: 'CorporatePost',
      entityId: input.postId,
      action: 'UPDATE',
      before: { pinnedAt: existing.pinnedAt, pinnedById: existing.pinnedById },
      after: { pinnedAt: updated.pinnedAt, pinnedById: updated.pinnedById },
      companyId: input.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
    return updated
  })
}

/**
 * Desfixa o post. Idempotente: se já não estava fixado, devolve o post sem
 * gravar auditoria — não houve o que desfixar.
 */
export async function unpinPost(input: {
  postId: string
  actorId: string
  companyId: string
}): Promise<CorporatePostWithRelations> {
  const db = scopedPrisma(input.companyId)
  const existing = await db.corporatePost.findUnique({
    where: { id: input.postId },
    select: { id: true, pinnedAt: true, pinnedById: true },
  })
  if (!existing) throw new CorporateMuralError('Publicação não encontrada.', 404)
  if (!existing.pinnedAt) {
    return db.corporatePost.findUniqueOrThrow({
      where: { id: input.postId },
      include: corporatePostInclude(input.actorId),
    })
  }

  return db.$transaction(async (tx) => {
    const updated = await tx.corporatePost.update({
      where: { id: input.postId },
      data: { pinnedAt: null, pinnedById: null },
      include: corporatePostInclude(input.actorId),
    })
    await recordAuditLog({
      actorId: input.actorId,
      entityType: 'CorporatePost',
      entityId: input.postId,
      action: 'UPDATE',
      before: { pinnedAt: existing.pinnedAt, pinnedById: existing.pinnedById },
      after: { pinnedAt: null, pinnedById: null },
      companyId: input.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
    return updated
  })
}

export async function listComments(
  postId: string,
  viewer: CorporateMuralViewer,
  opts: { offset: number; limit: number },
): Promise<CorporatePostCommentWithRelations[]> {
  const db = scopedPrisma(viewer.companyId)
  await requireVisiblePost(postId, viewer)
  return db.corporatePostComment.findMany({
    where: { postId },
    include: corporatePostCommentInclude,
    orderBy: { createdAt: 'asc' },
    skip: opts.offset,
    take: opts.limit + 1,
  })
}

export async function createComment(input: {
  postId: string
  content: string
  mentionedUserIds?: string[]
  gif?: AttachedGif
  image?: AttachedImage
  viewer: CorporateMuralViewer
}): Promise<{
  comment: CorporatePostCommentWithRelations
  postAuthorId: string
  replyRecipientIds: string[]
  /** True no PRIMEIRO comentário desta pessoa no post — é o que paga XP. */
  firstOfAuthor: boolean
}> {
  assertSingleAttachment(input.gif, input.image)
  const content = assertCommentContent(input.content, Boolean(input.gif || input.image))
  assertGifHost(input.gif)
  assertImageHost(input.image)
  const db = scopedPrisma(input.viewer.companyId)
  const companyId = input.viewer.companyId
  const authorId = input.viewer.userId
  const post = await requireVisiblePost(input.postId, input.viewer)
  // Participantes anteriores (distintos) ANTES de inserir o novo comentário.
  const prior = await db.corporatePostComment.findMany({
    where: { postId: input.postId },
    select: { authorId: true },
    distinct: ['authorId'],
  })
  const firstOfAuthor = !prior.some((c) => c.authorId === authorId)
  const mentions = await resolveMentions(input.mentionedUserIds, companyId)
  const comment = await db.corporatePostComment.create({
    data: {
      postId: input.postId,
      authorId,
      content,
      ...(input.gif ? { gifUrl: input.gif.url, gifWidth: input.gif.width, gifHeight: input.gif.height } : {}),
      ...(input.image
        ? { imageUrl: input.image.url, imageWidth: input.image.width, imageHeight: input.image.height }
        : {}),
      ...(mentions.length
        ? {
            mentions: {
              create: mentions.map((m) => ({
                userId: m.userId,
                name: m.name,
                companyId,
              })),
            },
          }
        : {}),
    },
    include: corporatePostCommentInclude,
  })
  const replyRecipientIds = [...new Set(prior.map((c) => c.authorId))].filter(
    (id) => id !== authorId && id !== post.authorId,
  )
  return { comment, postAuthorId: post.authorId, replyRecipientIds, firstOfAuthor }
}

export async function deleteComment(input: {
  commentId: string
  userId: string
  role: string
  adminAccess?: boolean
  companyId: string
}): Promise<{
  postId: string
  /** Autor do comentário apagado — é dele o XP a estornar, não de quem apagou. */
  commentAuthorId: string
  /** False quando o autor ficou sem nenhum comentário no post: aí o XP sai. */
  authorHasOtherComments: boolean
}> {
  const db = scopedPrisma(input.companyId)
  const existing = await db.corporatePostComment.findUnique({
    where: { id: input.commentId },
    select: { authorId: true, postId: true, content: true, createdAt: true },
  })
  if (!existing) throw new CorporateMuralError('Comentário não encontrado.', 404)
  if (existing.authorId !== input.userId && !canAdminister(input)) {
    throw new CorporateMuralError('Sem permissão para excluir este comentário.', 403)
  }
  await db.corporatePostComment.delete({ where: { id: input.commentId } })
  const remaining = await db.corporatePostComment.count({
    where: { postId: existing.postId, authorId: existing.authorId },
  })
  if (existing.authorId !== input.userId) {
    await recordAuditLog({
      actorId: input.userId,
      entityType: 'CorporatePostComment',
      entityId: input.commentId,
      action: 'DELETE',
      before: {
        authorId: existing.authorId,
        postId: existing.postId,
        content: existing.content,
        createdAt: existing.createdAt,
      },
      companyId: input.companyId,
    })
  }
  return {
    postId: existing.postId,
    commentAuthorId: existing.authorId,
    authorHasOtherComments: remaining > 0,
  }
}

function assertEmoji(emoji: string) {
  if (!(CORPORATE_POST_REACTIONS as readonly string[]).includes(emoji)) {
    throw new CorporateMuralError('Reação inválida.', 400)
  }
}

export async function togglePostReaction(input: {
  postId: string
  emoji: string
  viewer: CorporateMuralViewer
}): Promise<{
  post: CorporatePostWithRelations
  added: boolean
  postAuthorId: string
  /**
   * A pessoa ainda tem alguma reação neste post depois do toggle. O XP é "uma
   * vez por publicação", então ele só sai quando cai a **última** — tirar um
   * emoji de três não estorna nada.
   */
  viewerHasReaction: boolean
}> {
  assertEmoji(input.emoji)
  const db = scopedPrisma(input.viewer.companyId)
  const userId = input.viewer.userId
  const post = await requireVisiblePost(input.postId, input.viewer)
  const existing = await db.corporatePostReaction.findUnique({
    where: { postId_userId_emoji: { postId: input.postId, userId, emoji: input.emoji } },
  })
  let added: boolean
  if (existing) {
    await db.corporatePostReaction.delete({ where: { id: existing.id } })
    added = false
  } else {
    await db.corporatePostReaction.create({
      data: { postId: input.postId, userId, emoji: input.emoji },
    })
    added = true
  }
  const full = await db.corporatePost.findUniqueOrThrow({
    where: { id: input.postId },
    include: corporatePostInclude(userId),
  })
  const viewerHasReaction = full.reactions.some((r) => r.userId === userId)
  return { post: full, added, postAuthorId: post.authorId, viewerHasReaction }
}

/**
 * Marca o post como lido por alguém. Idempotente: o `@@unique([postId, userId])`
 * mais `skipDuplicates` resolvem a repetição em uma ida só ao banco.
 * `upsert` **não** é opção — o `scopedPrisma` lança nele (ver `lib/tenant-scope.ts`).
 *
 * `full` é o clique em "Ver conteúdo completo", e só ele paga XP. Quem decide
 * se o post é longo o bastante para isso é **o servidor**
 * (`isCollapsibleCorporatePost`, a mesma função que a web usa para cortar o
 * texto): se dependesse do cliente, qualquer um mandaria `full: true` num post
 * de uma linha e catava XP por publicação sem ler nada.
 */
export async function markPostRead(input: {
  postId: string
  viewer: CorporateMuralViewer
  full?: boolean
}): Promise<{ creditFull: boolean }> {
  const db = scopedPrisma(input.viewer.companyId)
  const post = await requireVisiblePost(input.postId, input.viewer)
  await db.corporatePostRead.createMany({
    data: [{ postId: input.postId, userId: input.viewer.userId }],
    skipDuplicates: true,
  })
  if (!input.full) return { creditFull: false }
  const body = isRichDoc(post.contentJson) ? post.contentJson : null
  return { creditFull: isCollapsibleCorporatePost({ content: post.content, body }) }
}

export async function toggleCommentReaction(input: {
  commentId: string
  emoji: string
  viewer: CorporateMuralViewer
}): Promise<{ comment: CorporatePostCommentWithRelations }> {
  assertEmoji(input.emoji)
  const db = scopedPrisma(input.viewer.companyId)
  const userId = input.viewer.userId
  const comment = await db.corporatePostComment.findUnique({
    where: { id: input.commentId },
    select: { id: true, postId: true },
  })
  if (!comment) throw new CorporateMuralError('Comentário não encontrado.', 404)
  // O comentário herda a visibilidade do post: sem esta checagem, reagir a um
  // comentário seria a porta de leitura de comunicado de outro setor.
  await requireVisiblePost(comment.postId, input.viewer)
  const existing = await db.corporatePostCommentReaction.findUnique({
    where: { commentId_userId_emoji: { commentId: input.commentId, userId, emoji: input.emoji } },
  })
  if (existing) {
    await db.corporatePostCommentReaction.delete({ where: { id: existing.id } })
  } else {
    await db.corporatePostCommentReaction.create({
      data: { commentId: input.commentId, userId, emoji: input.emoji },
    })
  }
  const full = await db.corporatePostComment.findUniqueOrThrow({
    where: { id: input.commentId },
    include: corporatePostCommentInclude,
  })
  return { comment: full }
}

/**
 * Gera o comunicado a partir de instruções em linguagem natural.
 *
 * Reusa o caminho das campanhas de propósito: chave, provedor, modelo e URL são
 * os que **a empresa** cadastrou (`resolveAiCredentials`), nunca do ambiente —
 * sem chave própria o agente responde 503 tratado, como os outros. Nada é
 * gravado aqui: o texto volta para o composer e quem publica é a pessoa.
 */
export async function generateCorporatePost(
  input: {
    userId: string
    companyId: string
    instructions: string
    audience?: CorporatePostAudience
    audienceSectorIds?: string[]
  },
  complete: AgentCompletionFn = requestAgentCompletion,
): Promise<GenerateCorporatePostResponse> {
  const instructions = input.instructions.trim()
  if (!instructions) {
    throw new CorporateMuralError('Escreva o que você quer comunicar.', 400)
  }
  if (instructions.length > CORPORATE_POST_AI_PROMPT_MAX_LENGTH) {
    throw new CorporateMuralError(
      `As instruções precisam ter no máximo ${CORPORATE_POST_AI_PROMPT_MAX_LENGTH} caracteres.`,
      400,
    )
  }

  const credentials = await resolveAiCredentials(input.companyId)
  const db = scopedPrisma(input.companyId)
  const [company, author, sectors] = await Promise.all([
    prisma.company.findUnique({ where: { id: input.companyId }, select: { name: true } }),
    db.user.findUnique({ where: { id: input.userId }, select: { name: true } }),
    input.audience === 'SECTORS' && input.audienceSectorIds?.length
      ? db.sector.findMany({ where: { id: { in: input.audienceSectorIds } }, select: { name: true } })
      : Promise.resolve([]),
  ])

  // Mesmo modelo do gerador de campanhas (Documento 4, seção 13.4): a voz da
  // comunicação interna é uma só, e a OBS da seção pede isso explicitamente.
  const prompt = buildCorporatePostPrompt({
    companyName: company?.name ?? 'a empresa',
    authorName: author?.name ?? 'quem publica',
    instructions,
    audienceLabel: sectors.length ? sectors.map((s) => s.name).join(', ') : 'toda a empresa',
    template: await resolveCampaignPromptTemplate(input.companyId),
  })

  const raw = await complete({
    provider: credentials.provider,
    apiKey: credentials.apiKey,
    model: credentials.model,
    baseUrl: credentials.baseUrl,
    systemPrompt: prompt,
    turns: [{ role: 'user', content: 'Gere o comunicado.' }],
  })

  return parseGeneratedCorporatePost(raw)
}

/** Trecho do post para a tabela de alcance: uma linha, sem quebra. */
function toExcerpt(content: string): string {
  const flat = content.replace(/\s+/g, ' ').trim()
  if (flat.length <= CORPORATE_POST_EXCERPT_LENGTH) return flat
  return `${flat.slice(0, CORPORATE_POST_EXCERPT_LENGTH)}…`
}

/**
 * Teto da lista nominal de quem reagiu. A tabela de alcance é leitura de
 * painel, não exportação: um comunicado da empresa inteira com 400 reações
 * viraria 400 linhas num modal que ninguém rola. O `total` da resposta continua
 * sendo a contagem real, e a web avisa quando a lista trunca.
 */
export const POST_REACTORS_LIMIT = 200

/**
 * Quem reagiu num comunicado, com nome e setor. Serve os dois lados: a lista
 * que abre ao clicar em "N reações" no card do feed e o detalhe da coluna
 * "Reações" do painel de alcance.
 *
 * **Quem vê o post vê quem reagiu** — daí o `requireVisiblePost`, e não um
 * guard de admin: o recorte é o do público-alvo, o mesmo dos comentários.
 * Reagir num comunicado é ato público para a audiência dele; o que continua
 * fechado é a lista de quem *leu*, que ninguém escolheu tornar visível.
 *
 * Uma linha por (pessoa, emoji), como o banco guarda — é o mesmo número que
 * `getPostReach` conta, e agrupar por pessoa aqui faria a soma da lista não
 * bater com a da tabela ao lado. Inativo e terceirizado **entram**: diferente
 * do `readPct`, isto não é percentual de base nenhuma, é quem de fato reagiu.
 */
export async function listPostReactors(
  postId: string,
  viewer: CorporateMuralViewer,
): Promise<CorporatePostReactorsResponse> {
  const db = scopedPrisma(viewer.companyId)
  await requireVisiblePost(postId, viewer)

  const [rows, total] = await Promise.all([
    db.corporatePostReaction.findMany({
      where: { postId },
      include: { user: { include: { sector: { select: { name: true } } } } },
      orderBy: { createdAt: 'desc' },
      take: POST_REACTORS_LIMIT,
    }),
    db.corporatePostReaction.count({ where: { postId } }),
  ])

  return {
    items: rows.map((row) => ({
      user: toReactorRef(row.user),
      sectorName: row.user.sector?.name ?? null,
      emoji: row.emoji,
      createdAt: row.createdAt.toISOString(),
    })),
    total,
  }
}

/**
 * Painel de alcance: por post, quantas pessoas leram, comentaram e reagiram.
 * Só contagem — a lista nominal de quem leu **nunca** sai daqui.
 *
 * Agregação com Prisma, sem `$queryRaw`: SQL cru furaria o isolamento por
 * empresa do `scopedPrisma` (mesma razão do relatório de coins). O
 * `@@unique([postId, userId])` de `CorporatePostRead` faz `_count.reads` já
 * ser leitores únicos; `_count.reactions` é o total de reações (uma pessoa com
 * três emojis conta três), igual ao número que o card do mural mostra.
 *
 * `_count.reads` é filtrado (`where` na relação, suportado desde o Prisma 5
 * usado aqui) pelo mesmo critério do denominador `audience` — ativo e
 * não-terceirizado — senão o numerador cresce mais que o denominador e
 * `readPct` passa de 100%. Duas formas disso acontecer sem o filtro: um
 * terceirizado com `mural-corporativo` na allowlist individual lê pela rota
 * comum (`POST /corporate-posts/:id/read`, guard do mural comum, não o
 * admin); ou alguém lê e é desativado depois — a linha de leitura sobrevive.
 *
 * O denominador é **por post**, não a empresa inteira: com público-alvo por
 * setor, "12 de 48" num comunicado que só 8 pessoas podiam ler seria mentira.
 * `audience` da resposta continua sendo o total da empresa, como referência do
 * topo da tabela. Só posts publicados entram — pendente e recusado não tiveram
 * alcance nenhum, e contá-los afundaria a média da G&G.
 */
export async function getPostReach(
  companyId: string,
  opts: { sort: 'date_desc' | 'date_asc'; page: number; pageSize: number },
): Promise<CorporatePostReachResponse> {
  const db = scopedPrisma(companyId)
  const orderBy: Prisma.CorporatePostOrderByWithRelationInput = {
    createdAt: opts.sort === 'date_asc' ? 'asc' : 'desc',
  }
  const where: Prisma.CorporatePostWhereInput = { status: 'PUBLISHED' }
  const [rows, total, audience, leaders, bySector] = await Promise.all([
    db.corporatePost.findMany({
      where,
      select: {
        id: true,
        content: true,
        title: true,
        createdAt: true,
        audienceScope: true,
        sectors: { select: { sectorId: true } },
        _count: {
          select: {
            reads: { where: { user: { active: true, role: { not: 'THIRD_PARTY' } } } },
            comments: true,
            reactions: true,
          },
        },
      },
      orderBy,
      skip: (opts.page - 1) * opts.pageSize,
      take: opts.pageSize,
    }),
    db.corporatePost.count({ where }),
    // Base do percentual: quem de fato enxerga o mural por padrão. O
    // terceirizado só vê com a feature na allowlist individual, então contá-lo
    // deixaria o percentual cronicamente subestimado.
    db.user.count({ where: { active: true, role: { not: 'THIRD_PARTY' } } }),
    // Base do comunicado dirigido à liderança. Sem ela, um post lido por TODOS
    // os líderes marcaria ~10% de alcance, medido contra a empresa inteira.
    db.user.count({ where: { active: true, role: { in: [...LEADER_ROLES] } } }),
    // Uma agregação para todos os setores, e não uma contagem por post: a
    // página tem até 100 linhas, e um `count` por post seria N+1.
    db.user.groupBy({
      by: ['sectorId'],
      where: { active: true, role: { not: 'THIRD_PARTY' } },
      _count: { _all: true },
    }),
  ])
  const peopleBySector = new Map(bySector.map((row) => [row.sectorId, row._count._all]))

  return {
    items: rows.map((row) => {
      const postAudience =
        row.audienceScope === 'ALL'
          ? audience
          : row.audienceScope === 'LEADERS'
            ? leaders
            : row.sectors.reduce((sum, s) => sum + (peopleBySector.get(s.sectorId) ?? 0), 0)
      return {
        postId: row.id,
        // Título na frente quando existe: é o que a G&G reconhece na tabela.
        excerpt: toExcerpt(row.title ? `${row.title} — ${row.content}` : row.content),
        readers: row._count.reads,
        comments: row._count.comments,
        reactions: row._count.reactions,
        readPct: postAudience > 0 ? Math.round((row._count.reads / postAudience) * 1000) / 10 : 0,
        audience: postAudience,
        createdAt: row.createdAt.toISOString(),
      }
    }),
    audience,
    total,
  }
}

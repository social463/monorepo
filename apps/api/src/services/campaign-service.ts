import { Prisma, type CampaignPost } from '@prisma/client'
import type {
  CampaignDraftDTO,
  ConfirmCampaignRequest,
  CreateCampaignPostRequest,
  GenerateCampaignRequest,
  UpdateCampaignPostRequest,
} from '@legends/shared'
import { prisma } from '../lib/prisma'
import { buildScheduleSlots } from '../lib/campaign-schedule'
import { buildCampaignPrompt, parseCampaignDrafts } from '../lib/campaign-prompt'
import { requestAgentCompletion, type AgentCompletionFn } from '../lib/agent-client'
import { resolveAiCredentials } from './ai-settings-service'
import { CampaignError } from '../lib/campaign-error'
import { findUserInCompany, scopedPrisma } from '../lib/tenant-scope'
import { recordAuditLog } from './audit-log-service'
import { createPost } from './corporate-mural-service'

export interface CampaignActor {
  id: string
  companyId: string
}

/**
 * Reusado por edição/publicação/cancelamento (tarefa seguinte) — mantido aqui
 * para não duplicar o `include` nem o tipo composto entre arquivos.
 */
export const postInclude = {
  campaign: { select: { id: true, theme: true } },
  responsible: { select: { id: true, name: true } },
} as const

export type CampaignPostWithRelations = CampaignPost & {
  campaign: { id: string; theme: string } | null
  responsible: { id: string; name: string } | null
}

/**
 * `responsibleId` aponta para `User`, que não é escopado por tenant na FK —
 * um id de outra empresa é um id válido. Sem essa checagem o item ficaria com
 * responsável de outro tenant (id existente) ou estouraria P2003 cru num id
 * inexistente (500 em vez de erro tratado). Reusado por `confirmCampaign`,
 * `createCampaignPost` e, na próxima tarefa, `updateCampaignPost`.
 */
async function ensureResponsibleInCompany(companyId: string, responsibleId: string | null | undefined): Promise<void> {
  if (!responsibleId) return
  const user = await findUserInCompany(companyId, responsibleId)
  if (!user) {
    throw new CampaignError('Responsável não encontrado nesta empresa.', 404)
  }
}

/**
 * Gera N rascunhos e **não toca no banco**. É a etapa de revisão: nada é
 * gravado sem confirmação humana, e é por isso que uma resposta ruim da IA não
 * consegue deixar item pela metade no banco.
 *
 * `complete` entra por parâmetro para o teste injetar um duplo sem rede nem
 * chave — mesmo padrão do `agent-service`.
 */
export async function generateCampaignPreview(
  actor: CampaignActor,
  input: GenerateCampaignRequest,
  complete: AgentCompletionFn = requestAgentCompletion,
): Promise<CampaignDraftDTO[]> {
  // A grade vem antes da IA: janela inválida é erro do usuário e não deve custar
  // uma chamada paga ao provedor.
  const slots = buildScheduleSlots({
    startsAt: new Date(input.startsAt),
    endsAt: new Date(input.endsAt),
    quantity: input.quantity,
  })

  const credentials = await resolveAiCredentials(actor.companyId)
  const company = await prisma.company.findUnique({ where: { id: actor.companyId } })

  const prompt = buildCampaignPrompt({
    companyName: company?.name ?? 'a empresa',
    theme: input.theme,
    audience: input.audience,
    notes: input.notes,
    slots,
  })

  const raw = await complete({
    provider: credentials.provider,
    apiKey: credentials.apiKey,
    model: credentials.model,
    baseUrl: credentials.baseUrl,
    systemPrompt: prompt,
    turns: [{ role: 'user', content: 'Gere os comunicados da campanha.' }],
  })

  return parseCampaignDrafts(raw, slots)
}

/**
 * Grava a campanha e os N itens **como o usuário os deixou na tela**. O service
 * não regenera nem reaproveita o texto original: é isso que faz a edição feita
 * no preview sobreviver até o item agendado.
 */
export async function confirmCampaign(
  actor: CampaignActor,
  input: ConfirmCampaignRequest,
): Promise<CampaignPostWithRelations[]> {
  const startsAt = new Date(input.startsAt)
  const endsAt = new Date(input.endsAt)
  if (endsAt.getTime() < startsAt.getTime()) {
    throw new CampaignError('A data final não pode ser anterior à data inicial.', 400)
  }
  if (input.posts.length === 0) {
    throw new CampaignError('Nenhum comunicado para agendar.', 400)
  }

  const db = scopedPrisma(actor.companyId)
  return db.$transaction(async (tx) => {
    const campaign = await tx.campaign.create({
      data: {
        companyId: actor.companyId,
        theme: input.theme,
        startsAt,
        endsAt,
        audience: input.audience,
        notes: input.notes ?? null,
        createdById: actor.id,
      },
    })

    const created: CampaignPostWithRelations[] = []
    for (const post of input.posts) {
      // Checagem por item, dentro do loop: se um post no meio da lista tiver
      // responsável inválido, a campanha e os posts já criados antes dele nesta
      // mesma transação voltam atrás junto — não é só "checar tudo antes".
      await ensureResponsibleInCompany(actor.companyId, post.responsibleId)
      created.push(
        await tx.campaignPost.create({
          data: {
            companyId: actor.companyId,
            campaignId: campaign.id,
            title: post.title,
            body: post.body,
            visualHint: post.visualHint ?? null,
            scheduledFor: new Date(post.scheduledFor),
            channel: post.channel,
            audience: input.audience,
            responsibleId: post.responsibleId ?? null,
          },
          include: postInclude,
        }),
      )
    }

    await recordAuditLog({
      actorId: actor.id,
      entityType: 'Campaign',
      entityId: campaign.id,
      action: 'CREATE',
      after: { ...campaign, posts: created.length },
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })

    return created
  })
}

/** Itens da janela pedida — é o que alimenta a grade de mês do calendário. */
export function listCampaignPosts(
  actor: CampaignActor,
  range: { from: Date; to: Date },
): Promise<CampaignPostWithRelations[]> {
  return scopedPrisma(actor.companyId).campaignPost.findMany({
    where: { scheduledFor: { gte: range.from, lte: range.to } },
    include: postInclude,
    orderBy: { scheduledFor: 'asc' },
  })
}

/**
 * Item avulso, sem campanha. É o caminho que mantém o calendário utilizável
 * quando a empresa não cadastrou chave de IA.
 */
export async function createCampaignPost(
  actor: CampaignActor,
  input: CreateCampaignPostRequest,
): Promise<CampaignPostWithRelations> {
  await ensureResponsibleInCompany(actor.companyId, input.responsibleId)

  const db = scopedPrisma(actor.companyId)
  return db.$transaction(async (tx) => {
    const created = await tx.campaignPost.create({
      data: {
        companyId: actor.companyId,
        title: input.title,
        body: input.body,
        visualHint: input.visualHint ?? null,
        scheduledFor: new Date(input.scheduledFor),
        channel: input.channel,
        audience: input.audience,
        responsibleId: input.responsibleId ?? null,
      },
      include: postInclude,
    })
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'CampaignPost',
      entityId: created.id,
      action: 'CREATE',
      after: created,
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
    return created
  })
}

async function findPostOrThrow(actor: CampaignActor, id: string): Promise<CampaignPostWithRelations> {
  const post = await scopedPrisma(actor.companyId).campaignPost.findFirst({
    where: { id },
    include: postInclude,
  })
  if (!post) throw new CampaignError('Comunicado não encontrado.', 404)
  return post
}

export async function updateCampaignPost(
  actor: CampaignActor,
  id: string,
  input: UpdateCampaignPostRequest,
): Promise<CampaignPostWithRelations> {
  const before = await findPostOrThrow(actor, id)
  if (before.status === 'PUBLISHED') {
    throw new CampaignError('Comunicado já publicado não pode ser editado.', 409)
  }
  if (input.responsibleId !== undefined) {
    await ensureResponsibleInCompany(actor.companyId, input.responsibleId)
  }

  const data: Prisma.CampaignPostUncheckedUpdateInput = {}
  if (input.title !== undefined) data.title = input.title
  if (input.body !== undefined) data.body = input.body
  if (input.visualHint !== undefined) data.visualHint = input.visualHint ?? null
  if (input.scheduledFor !== undefined) data.scheduledFor = new Date(input.scheduledFor)
  if (input.channel !== undefined) data.channel = input.channel
  if (input.audience !== undefined) data.audience = input.audience
  if (input.responsibleId !== undefined) data.responsibleId = input.responsibleId ?? null

  const db = scopedPrisma(actor.companyId)
  return db.$transaction(async (tx) => {
    await tx.campaignPost.update({ where: { id }, data })
    const after = await tx.campaignPost.findUniqueOrThrow({ where: { id }, include: postInclude })
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'CampaignPost',
      entityId: id,
      action: 'UPDATE',
      before,
      after,
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
    return after
  })
}

/**
 * Publica o item no Mural da empresa. O post nasce **dentro** da transação que
 * marca o item como publicado: se o update falhasse depois de um create solto,
 * ficaria post no mural com item ainda agendado, e a próxima tentativa
 * duplicaria o comunicado.
 *
 * O guard de status por si só (ler `before` fora da transação e comparar) é
 * check-then-act: dois publishes concorrentes sobre o mesmo item (duplo
 * clique, duas abas, retry de request lenta) leriam `SCHEDULED` os dois, e os
 * dois criariam um `CorporatePost` — o `publishedPostId` é único, mas em
 * colunas diferentes, então não impede a dupla publicação. Por isso o
 * `updateMany` condicional abaixo é quem serializa: ele só marca `PUBLISHED`
 * (e só um dos dois consegue) depois de a linha já casar `status: 'SCHEDULED'`
 * — é o `UPDATE ... WHERE status = 'SCHEDULED'` do Postgres que garante que só
 * uma transação "ganha" a linha, a outra recebe `count: 0` e vira 409 antes de
 * chegar perto do `createPost`.
 *
 * Só o canal `MURAL` publica — Teams e e-mail ficam registrados no dado, com
 * entrega manual (ver spec, Decisão 6).
 */
export async function publishCampaignPost(
  actor: CampaignActor,
  id: string,
): Promise<CampaignPostWithRelations> {
  // Pré-voo fora da transação: só para o 404 e as mensagens amigáveis de
  // CANCELLED / canal não-MURAL. Não é o ponto de serialização — por isso o
  // status aqui pode já estar desatualizado quando dois publishes correm em
  // paralelo; o `updateMany` dentro da transação é quem decide de verdade.
  const before = await findPostOrThrow(actor, id)
  if (before.status === 'PUBLISHED') throw new CampaignError('Este comunicado já foi publicado.', 409)
  if (before.status === 'CANCELLED') throw new CampaignError('Comunicado cancelado não pode ser publicado.', 409)
  if (before.channel !== 'MURAL') {
    throw new CampaignError(
      'Só o canal Feed Corporativo publica automaticamente. Registre a entrega manualmente e cancele ou reagende este item.',
      400,
    )
  }

  const db = scopedPrisma(actor.companyId)
  return db.$transaction(async (tx) => {
    // Reivindica a linha antes de criar o post: se outra transação concorrente
    // já ganhou (ou o item foi cancelado entre o pré-voo e aqui), `count` vem
    // 0 e nada é criado no Mural.
    const claimed = await tx.campaignPost.updateMany({
      where: { id, status: 'SCHEDULED' },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    })
    if (claimed.count === 0) {
      throw new CampaignError('Este comunicado já foi publicado.', 409)
    }

    const post = await createPost({
      authorId: actor.id,
      content: before.body,
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
    await tx.campaignPost.update({
      where: { id },
      data: { publishedPostId: post.id },
    })
    const after = await tx.campaignPost.findUniqueOrThrow({ where: { id }, include: postInclude })
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'CampaignPost',
      entityId: id,
      action: 'UPDATE',
      before,
      after,
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
    return after
  })
}

/** Cancelar não apaga: o histórico editorial continua visível no calendário. */
export async function cancelCampaignPost(
  actor: CampaignActor,
  id: string,
): Promise<CampaignPostWithRelations> {
  const before = await findPostOrThrow(actor, id)
  if (before.status === 'PUBLISHED') {
    throw new CampaignError('Comunicado já publicado não pode ser cancelado.', 409)
  }

  const db = scopedPrisma(actor.companyId)
  return db.$transaction(async (tx) => {
    await tx.campaignPost.update({ where: { id }, data: { status: 'CANCELLED' } })
    const after = await tx.campaignPost.findUniqueOrThrow({ where: { id }, include: postInclude })
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'CampaignPost',
      entityId: id,
      action: 'DELETE',
      before,
      after,
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
    return after
  })
}

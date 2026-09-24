import type { AgentConversation, AgentKind, AgentMessage } from '@prisma/client'
import {
  AGENT_CONVERSATION_MAX_MESSAGES,
  AGENT_CONVERSATION_TITLE_MAX_LENGTH,
  INOVA_PROJECT_PHASES,
  meetingStatusesOf,
  type AgentKey,
} from '@legends/shared'
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'
import { AgentError } from '../lib/agent-error'
import { buildBenchmarkSystemPrompt } from '../lib/benchmark-prompt'
import { buildGlassSystemPrompt, fenceData } from '../lib/glass-prompt'
import { buildAssistantSystemPrompt } from '../lib/assistant-prompt'
import { buildInovaAdminSystemPrompt } from '../lib/inova-admin-prompt'
import { requestAgentCompletion, type AgentCompletionFn } from '../lib/agent-client'
import { resolveAiCredentials } from './ai-settings-service'
import { getGlassOverview } from './glass-overview-service'
import { resolveGlassCommand } from './glass-command-service'
import { loadAssistantChatContext } from './assistant-service'
import { getAssistantPersonaName } from './assistant-persona-service'
import { ensureInovaModuleEnabled } from './inova-service'
import { buildApprenticeSystemPrompt } from '../lib/apprentice-prompt'
import { apprenticeToday, listApprenticePeople } from './apprentice-service'
import { getApprenticeOverview } from './apprentice-admin-service'

export interface AgentActor {
  id: string
  companyId: string
  /** Só o agente `assistant` usa — recorta a base de conhecimento pelo setor da pessoa. */
  sectorId?: string | null
}

export type ConversationWithMessages = AgentConversation & { messages: AgentMessage[] }

const AGENT_KEY_TO_KIND: Record<AgentKey, AgentKind> = {
  benchmark: 'BENCHMARK',
  glass: 'GLASS',
  assistant: 'ASSISTANT',
  inova: 'INOVA',
  apprentice: 'APPRENTICE',
}

/**
 * Empresa cujo slug é `emr` — hoje o único gate do bloco de acolhimento
 * emocional (ver `lib/assistant-prompt.ts`). Provisório: a ideia é que isso
 * se torne uma feature que o super-admin liga por empresa, camada acima do
 * feature flag de setor que já existe (ver AGENTS.md, "Blocos de administração
 * por setor"). Até essa camada existir, EMR é a única empresa com o bloco.
 */
const EMR_SLUG = 'emr'

/** Título derivado da primeira pergunta — o usuário nunca precisa nomear a conversa. */
export function deriveConversationTitle(message: string): string {
  const flat = message.replace(/\s+/g, ' ').trim()
  if (flat.length <= AGENT_CONVERSATION_TITLE_MAX_LENGTH) return flat
  return `${flat.slice(0, AGENT_CONVERSATION_TITLE_MAX_LENGTH - 1).trimEnd()}…`
}

export function listConversations(actor: AgentActor, agent: AgentKey) {
  return scopedPrisma(actor.companyId).agentConversation.findMany({
    where: { userId: actor.id, agent: AGENT_KEY_TO_KIND[agent] },
    include: { _count: { select: { messages: true } } },
    orderBy: { updatedAt: 'desc' },
  })
}

/**
 * Conversa é sempre **da pessoa**: `userId` entra no where junto do escopo de
 * empresa, então a conversa de um colega da mesma empresa é 404, não 403 — não
 * se confirma nem a existência.
 */
export async function getConversation(
  actor: AgentActor,
  agent: AgentKey,
  conversationId: string,
): Promise<ConversationWithMessages> {
  const conversation = await scopedPrisma(actor.companyId).agentConversation.findFirst({
    where: { id: conversationId, userId: actor.id, agent: AGENT_KEY_TO_KIND[agent] },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  })
  if (!conversation) throw new AgentError('Conversa não encontrada.', 404)
  return conversation
}

/**
 * Quantas perguntas anteriores entram na busca da base, além da atual.
 *
 * Só importa quando a base não cabe inteira no prompt e o ranking volta a
 * recortar (ver `selectKnowledgeContext`): aí "e quais os benefícios?" ou "e
 * sobre isso?" precisa do assunto que ficou no turno anterior, senão busca com
 * duas palavras genéricas e traz a entrada errada.
 */
const KNOWLEDGE_SEARCH_HISTORY_TURNS = 2

function knowledgeSearchText(history: AgentMessage[], message: string): string {
  const recentQuestions = history
    .filter((entry) => entry.role === 'USER')
    .slice(-KNOWLEDGE_SEARCH_HISTORY_TURNS)
    .map((entry) => entry.content)
  return [...recentQuestions, message].join(' ')
}

/**
 * Recorte opcional dos dados que o agente enxerga NESTE turno.
 *
 * `inovaProjectIds`: o painel do INOVA filtra por setor e período, e a IA
 * precisa responder sobre o mesmo recorte que a tela mostra — senão "qual
 * setor mais avançou?" com o filtro em Marketing respondia sobre a empresa
 * toda. Vale por turno, não por conversa: trocar o filtro no meio da conversa
 * muda o que a próxima resposta enxerga.
 */
export interface AgentTurnScope {
  inovaProjectIds?: string[]
}

/**
 * Contexto que cada agente injeta no turno.
 *
 * `dataBlock` existe para o GlassAgent responder comando de relatório com
 * números vindos do Postgres: ele é anexado ao turno enviado ao provedor, mas
 * **não** ao que é persistido no histórico. A conversa continua legível e não
 * incha com tabelas repetidas.
 */
async function buildAgentTurn(
  actor: AgentActor,
  agent: AgentKey,
  message: string,
  history: AgentMessage[],
  scope: AgentTurnScope = {},
): Promise<{ systemPrompt: string; dataBlock?: string }> {
  const company = await prisma.company.findUnique({ where: { id: actor.companyId } })
  const companyName = company?.name ?? 'a empresa'

  if (agent === 'benchmark') {
    const practices = await scopedPrisma(actor.companyId).benchmarkPractice.findMany({
      orderBy: { createdAt: 'desc' },
    })
    return { systemPrompt: buildBenchmarkSystemPrompt({ companyName, practices }) }
  }

  if (agent === 'assistant') {
    const [personaName, knowledgeContext] = await Promise.all([
      getAssistantPersonaName(actor.companyId),
      loadAssistantChatContext(
        { companyId: actor.companyId, sectorId: actor.sectorId },
        knowledgeSearchText(history, message),
      ),
    ])
    return {
      systemPrompt: buildAssistantSystemPrompt({
        companyName,
        personaName,
        includeEmotionalSupport: company?.slug === EMR_SLUG,
        knowledgeContext,
      }),
    }
  }

  if (agent === 'apprentice') {
    const db = scopedPrisma(actor.companyId)
    const [meetings, classes, people, overview] = await Promise.all([
      db.apprenticeMeeting.findMany({
        orderBy: { order: 'asc' },
        include: { activities: { select: { id: true } } },
      }),
      db.apprenticeClass.findMany({ orderBy: { name: 'asc' } }),
      listApprenticePeople(actor.companyId),
      getApprenticeOverview(actor.companyId, {}),
    ])
    const statuses = meetingStatusesOf(
      meetings.map((meeting) => ({
        id: meeting.id,
        order: meeting.order,
        scheduledOn: meeting.scheduledOn ? meeting.scheduledOn.toISOString().slice(0, 10) : null,
      })),
      apprenticeToday(),
    )
    return {
      systemPrompt: buildApprenticeSystemPrompt({
        companyName,
        apprenticeCount: people.length,
        classNames: classes.map((turma) => [turma.name, turma.shift].filter(Boolean).join(' · ')),
        meetings: meetings.map((meeting) => ({
          order: meeting.order,
          title: meeting.title,
          theme: meeting.theme,
          deliverable: meeting.deliverable,
          scheduledOn: meeting.scheduledOn ? meeting.scheduledOn.toISOString().slice(0, 10) : null,
          status: statuses[meeting.id] ?? 'FUTURO',
          accessReleased: meeting.accessReleased,
          activityCount: meeting.activities.length,
        })),
        overview,
      }),
    }
  }

  if (agent === 'inova') {
    await ensureInovaModuleEnabled(actor.companyId)
    const projects = await scopedPrisma(actor.companyId).inovaProject.findMany({
      // O recorte vem do painel (ids que a tela mostra). O `scopedPrisma` já
      // prende à empresa: id de outro tenant não casa com nada.
      where: { archived: false, ...(scope.inovaProjectIds && { id: { in: scope.inovaProjectIds } }) },
      select: {
        title: true,
        sector: true,
        category: true,
        phase: true,
        createdAt: true,
        costReduction: true,
        hoursSaved: true,
        responsible1: { select: { name: true } },
        responsible2: { select: { name: true } },
      },
    })
    const phaseLabel = (phase: string) => INOVA_PROJECT_PHASES.find((p) => p.value === phase)?.label ?? phase
    return {
      systemPrompt: buildInovaAdminSystemPrompt({
        companyName,
        scoped: scope.inovaProjectIds !== undefined,
        projects: projects.map((p) => ({
          ...p,
          phase: phaseLabel(p.phase),
          createdAt: p.createdAt.toISOString(),
          responsible1: p.responsible1?.name ?? null,
          responsible2: p.responsible2?.name ?? null,
        })),
      }),
    }
  }

  // Uma leitura só por turno: o overview vai para o system prompt e é o mesmo
  // que `/relatorio` e `/tendencia` usam. Buscar de novo lá dentro custava duas
  // varreduras completas da tabela por pergunta.
  const overview = await getGlassOverview(actor, {})
  const commandData = await resolveGlassCommand(actor, message, overview)

  return {
    systemPrompt: buildGlassSystemPrompt({ companyName, overview }),
    dataBlock: commandData ?? undefined,
  }
}

export interface AskAgentInput {
  actor: AgentActor
  agent: AgentKey
  conversationId?: string
  message: string
  /** Recorte do contexto do turno — hoje só o INOVA usa (ver `AgentTurnScope`). */
  scope?: AgentTurnScope
  /** Injetável para teste: o service nunca fala com a rede direto. */
  complete?: AgentCompletionFn
}

/**
 * Um turno de conversa. A ordem importa: tudo que pode falhar (limite, chave
 * ausente, IA) acontece **antes** de qualquer escrita, e a pergunta só é
 * persistida junto com a resposta, na mesma transação. Turno que falhou não
 * deixa mensagem órfã na conversa, e reenviar não duplica.
 */
export async function askAgent(input: AskAgentInput): Promise<ConversationWithMessages> {
  const { actor, agent, message } = input
  const complete = input.complete ?? requestAgentCompletion

  const existing = input.conversationId ? await getConversation(actor, agent, input.conversationId) : null
  const history = existing?.messages ?? []

  // +1 pela pergunta que chega agora; a resposta do agente entra no mesmo teto.
  if (history.length + 1 >= AGENT_CONVERSATION_MAX_MESSAGES) {
    throw new AgentError(
      `Esta conversa atingiu o limite de ${AGENT_CONVERSATION_MAX_MESSAGES} mensagens. Comece uma nova conversa.`,
      400,
    )
  }

  const [credentials, turnContext] = await Promise.all([
    resolveAiCredentials(actor.companyId),
    buildAgentTurn(actor, agent, message, history, input.scope),
  ])

  // Marcado antes da chamada: é o instante em que a pergunta foi feita, e
  // garante que ela seja anterior à resposta — a chamada ao provedor demora.
  const askedAt = new Date()

  // O bloco de dados vai para o provedor, não para o histórico: `message` é o
  // que a pessoa escreveu e é o que fica gravado.
  const outgoing = turnContext.dataBlock
    ? `${message}\n\n${fenceData('dados_calculados', turnContext.dataBlock)}`
    : message

  const reply = await complete({
    provider: credentials.provider,
    apiKey: credentials.apiKey,
    model: credentials.model,
    baseUrl: credentials.baseUrl,
    systemPrompt: turnContext.systemPrompt,
    turns: [
      ...history.map((entry) => ({
        role: entry.role === 'ASSISTANT' ? ('assistant' as const) : ('user' as const),
        content: entry.content,
      })),
      { role: 'user' as const, content: outgoing },
    ],
  })

  return appendAgentTurn({ actor, agent, conversationId: existing?.id, message, reply, askedAt })
}

export interface AppendAgentTurnInput {
  actor: AgentActor
  agent: AgentKey
  /** Conversa existente; ausente, nasce uma nova com título derivado da pergunta. */
  conversationId?: string
  message: string
  reply: string
  /** Instante da pergunta — ver por que não fica no default do banco, abaixo. */
  askedAt?: Date
}

/**
 * Grava um turno (pergunta + resposta) na conversa, criando-a se preciso.
 *
 * Separado de `askAgent` porque nem todo turno vem do provedor de IA: a
 * assistente responde da base de conhecimento quando a empresa não tem
 * credencial (`assistant-chat-service.ts`), e esse turno precisa entrar na
 * mesma conversa, com a mesma forma, para o histórico não ter buraco.
 */
export async function appendAgentTurn(input: AppendAgentTurnInput): Promise<ConversationWithMessages> {
  const { actor, agent, message, reply } = input
  const db = scopedPrisma(actor.companyId)

  // Marcado aqui, e não no default do banco: no Postgres `CURRENT_TIMESTAMP` é o
  // início da transação, então as duas mensagens do turno nasceriam com o mesmo
  // `createdAt` e o `orderBy` poderia devolver a resposta antes da pergunta.
  const askedAt = input.askedAt ?? new Date()
  const answeredAt = new Date(Math.max(Date.now(), askedAt.getTime() + 1))

  // A conversa é sempre da pessoa: id de outro dono (ou de outro agente) é 404,
  // igual a `getConversation`. Confere aqui, e não só no chamador, para a função
  // ser segura sozinha — o custo é um findFirst ao lado de uma chamada de IA.
  const existing = input.conversationId
    ? await db.agentConversation.findFirst({
        where: { id: input.conversationId, userId: actor.id, agent: AGENT_KEY_TO_KIND[agent] },
        select: { id: true },
      })
    : null
  if (input.conversationId && !existing) throw new AgentError('Conversa não encontrada.', 404)

  return db.$transaction(async (tx) => {
    const conversationId =
      existing?.id ??
      (
        await tx.agentConversation.create({
          data: {
            companyId: actor.companyId,
            userId: actor.id,
            agent: AGENT_KEY_TO_KIND[agent],
            title: deriveConversationTitle(message),
          },
        })
      ).id

    await tx.agentMessage.createMany({
      data: [
        { companyId: actor.companyId, conversationId, role: 'USER', content: message, createdAt: askedAt },
        { companyId: actor.companyId, conversationId, role: 'ASSISTANT', content: reply, createdAt: answeredAt },
      ],
    })

    // `update` explícito para o @updatedAt subir também quando a conversa já
    // existia — criar mensagem filha não toca a linha da conversa.
    await tx.agentConversation.update({ where: { id: conversationId }, data: { updatedAt: answeredAt } })

    return tx.agentConversation.findUniqueOrThrow({
      where: { id: conversationId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    })
  })
}

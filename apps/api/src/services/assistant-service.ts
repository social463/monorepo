import { Prisma, type KnowledgeEntry } from '@prisma/client'
import {
  ASSISTANT_HOURLY_LIMIT,
  ASSISTANT_NOT_FOUND_MESSAGE,
  type AssistantAnswerSource,
  type AssistantGapDTO,
  type CreateKnowledgeEntryRequest,
  type UpdateKnowledgeEntryRequest,
} from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'
import { AssistantError } from '../lib/assistant-error'
import { classifySmallTalk } from '../lib/assistant-smalltalk'
import {
  normalizeQuestion,
  rankKnowledgeEntries,
  selectKnowledgeContext,
  type RankableEntry,
} from '../lib/assistant-search'
import { buildAssistantAnswer } from '../lib/gemini-client'
import { recordAuditLog } from './audit-log-service'

export interface AssistantActor {
  id: string
  role: string
  sectorId: string
  companyId: string
}

export interface AskAssistantResult {
  queryId: string
  answer: string
  answered: boolean
  source: AssistantAnswerSource
  sources: RankableEntry[]
}

const HOUR_MS = 60 * 60 * 1000

/**
 * Teto por pessoa/hora, contado no próprio histórico — sobrevive a restart e vale
 * entre instâncias. Exportado porque o chat multi-turno (`agent-service.ts`, agente
 * `assistant`) grava no mesmo `assistantQuery` e precisa do mesmo teto.
 */
export async function assertWithinHourlyLimit(actor: AssistantActor): Promise<void> {
  const usadas = await scopedPrisma(actor.companyId).assistantQuery.count({
    where: { userId: actor.id, createdAt: { gte: new Date(Date.now() - HOUR_MS) } },
  })
  if (usadas >= ASSISTANT_HOURLY_LIMIT) {
    throw new AssistantError(
      `Você já fez ${ASSISTANT_HOURLY_LIMIT} perguntas na última hora. Tente novamente mais tarde.`,
      429,
    )
  }
}

export interface KnowledgeScopeActor {
  companyId: string
  sectorId?: string | null
}

/** Entradas ativas visíveis para o escopo da pessoa, rankeadas para a pergunta. */
export async function findMatchedEntries(
  actor: KnowledgeScopeActor,
  question: string,
): Promise<RankableEntry[]> {
  const entries = await scopedPrisma(actor.companyId).knowledgeEntry.findMany({
    where: { isActive: true, OR: [{ sectorId: null }, { sectorId: actor.sectorId ?? undefined }] },
    select: { id: true, category: true, question: true, answer: true, keywords: true },
  })
  return rankKnowledgeEntries(entries, question)
}

/**
 * A base que o chat da assistente injeta no system prompt. Carrega o mesmo
 * escopo de `findMatchedEntries` — empresa, ativas, do setor da pessoa ou de
 * ninguém — e deixa `selectKnowledgeContext` decidir se cabe inteira.
 *
 * São duas perguntas diferentes, e por isso duas funções: `findMatchedEntries`
 * responde "o que casou", que é o que vira `matchedEntryIds` no `AssistantQuery`
 * (fonte do painel de lacunas) e o que o fallback sem IA lê literalmente. Esta
 * responde "o que o modelo precisa ter lido para escrever a resposta" — mandar a
 * base inteira para a primeira faria toda pergunta parecer respondida.
 */
export async function loadAssistantChatContext(
  actor: KnowledgeScopeActor,
  searchText: string,
): Promise<RankableEntry[]> {
  const entries = await scopedPrisma(actor.companyId).knowledgeEntry.findMany({
    where: { isActive: true, OR: [{ sectorId: null }, { sectorId: actor.sectorId ?? undefined }] },
    select: { id: true, category: true, question: true, answer: true, keywords: true },
    // Ordem estável e agrupada por assunto: quando a base vai inteira, é assim
    // que ela chega ao prompt, e categoria junta ajuda o modelo a listar tudo
    // sobre um tema de uma vez.
    orderBy: [{ category: 'asc' }, { question: 'asc' }],
  })
  return selectKnowledgeContext(entries, searchText)
}

/**
 * Registra o turno do chat multi-turno da assistente (agente `assistant`) como
 * `AssistantQuery` — mesma tabela que alimenta o painel de lacunas e o feedback da
 * assistente de pergunta única. `askAgent` já persistiu o turno na conversa; esta
 * função só duplica o registro para as duas features que dependem de `AssistantQuery`
 * continuarem funcionando: `/admin/assistant/gaps` e `/assistant/queries/:id/feedback`.
 */
export async function logAssistantChatTurn(
  actor: AssistantActor,
  question: string,
  answer: string,
  /** Entradas já rankeadas, quando o chamador acabou de calculá-las — evita a segunda varredura. */
  matched?: RankableEntry[],
): Promise<string> {
  const entries = matched ?? (await findMatchedEntries(actor, question))
  const query = await scopedPrisma(actor.companyId).assistantQuery.create({
    data: { userId: actor.id, question, answer, matchedEntryIds: entries.map((entry) => entry.id) },
  })
  return query.id
}

/**
 * Texto da resposta. Com chave de IA, o Gemini escreve ancorado no contexto; sem
 * chave — ou se o Gemini falhar — cai para a melhor entrada da base. Falha de IA é
 * best-effort: logada e degradada, nunca 500 na cara do usuário.
 */
async function resolveAnswer(
  question: string,
  matched: RankableEntry[],
): Promise<{ answer: string; source: AssistantAnswerSource }> {
  const fallback = { answer: matched[0]!.answer, source: 'KNOWLEDGE_BASE' as const }
  if (!process.env.GEMINI_API_KEY) return fallback
  try {
    const answer = await buildAssistantAnswer({
      question,
      entries: matched.map((entry) => ({
        category: entry.category,
        question: entry.question,
        answer: entry.answer,
      })),
    })
    return { answer, source: 'AI' }
  } catch (err) {
    console.error('[assistant] falha ao gerar resposta com IA, caindo para a base', err)
    return fallback
  }
}

export async function askAssistant(actor: AssistantActor, question: string): Promise<AskAssistantResult> {
  const db = scopedPrisma(actor.companyId)
  await assertWithinHourlyLimit(actor)

  // Só entradas ativas, da empresa (garantido pela extensão) e do escopo da pessoa:
  // as da empresa inteira mais as do setor dela.
  const matched = await findMatchedEntries(actor, question)

  if (matched.length === 0) {
    const query = await db.assistantQuery.create({
      data: {
        userId: actor.id,
        question,
        answer: ASSISTANT_NOT_FOUND_MESSAGE,
        matchedEntryIds: [],
      },
    })
    return {
      queryId: query.id,
      answer: ASSISTANT_NOT_FOUND_MESSAGE,
      answered: false,
      source: 'NONE',
      sources: [],
    }
  }

  const { answer, source } = await resolveAnswer(question, matched)
  const query = await db.assistantQuery.create({
    data: {
      userId: actor.id,
      question,
      answer,
      matchedEntryIds: matched.map((entry) => entry.id),
    },
  })
  return { queryId: query.id, answer, answered: true, source, sources: matched }
}

export interface AssistantFeedbackInput {
  rating: -1 | 1
  comment?: string | null
}

/**
 * Registra o polegar da pessoa na resposta que ela recebeu. Um feedback por pergunta:
 * reclicar atualiza. Não usa `upsert` — a extensão de isolamento não suporta.
 */
export async function recordAssistantFeedback(
  actor: AssistantActor,
  queryId: string,
  input: AssistantFeedbackInput,
): Promise<void> {
  const db = scopedPrisma(actor.companyId)
  // findFirst (e não findUnique): a extensão acrescenta companyId ao where, e não
  // existe unique composto (id, companyId). Pergunta de outra empresa vira 404.
  const query = await db.assistantQuery.findFirst({ where: { id: queryId } })
  if (!query) throw new AssistantError('Pergunta não encontrada.', 404)
  if (query.userId !== actor.id) {
    throw new AssistantError('Você só pode avaliar as respostas das suas próprias perguntas.', 403)
  }

  const comment = input.comment?.trim() ? input.comment.trim() : null
  const existente = await db.assistantFeedback.findFirst({ where: { queryId } })
  if (existente) {
    await db.assistantFeedback.update({
      where: { id: existente.id },
      data: { rating: input.rating, comment },
    })
    return
  }
  await db.assistantFeedback.create({
    data: { queryId, userId: actor.id, rating: input.rating, comment },
  })
}

const sectorInclude = { sector: { select: { id: true, name: true } } } as const

export type KnowledgeEntryWithSector = KnowledgeEntry & { sector: { id: string; name: string } | null }

export interface KnowledgeEntryFilters {
  q?: string
  category?: string
  sectorId?: string
  isActive?: boolean
}

/** SUBADMIN só gerencia entrada do próprio setor — nem as da empresa, nem as de outro setor. */
function assertCanManage(actor: AssistantActor, sectorId: string | null): void {
  if (actor.role === 'SUBADMIN' && sectorId !== actor.sectorId) {
    throw new AssistantError('Você só pode gerenciar entradas do seu setor.', 403)
  }
}

/**
 * Escopo de destino de uma escrita. Para o SUBADMIN, `sectorId` omitido assume o setor
 * dele; qualquer escopo explícito diferente (inclusive `null`, que é a entrada da
 * empresa) é 403.
 */
function resolveSectorIdForWrite(actor: AssistantActor, requested: string | null | undefined): string | null {
  if (actor.role === 'SUBADMIN') {
    if (requested === undefined || requested === actor.sectorId) return actor.sectorId
    throw new AssistantError('Você só pode gerenciar entradas do seu setor.', 403)
  }
  return requested ?? null
}

async function assertSectorExists(companyId: string, sectorId: string | null): Promise<void> {
  if (sectorId === null) return
  const sector = await scopedPrisma(companyId).sector.findFirst({ where: { id: sectorId } })
  if (!sector) throw new AssistantError('Setor não encontrado.', 404)
}

function normalizeKeywords(keywords: string[] | undefined): string[] {
  if (!keywords) return []
  return [...new Set(keywords.map((k) => k.trim()).filter((k) => k.length > 0))]
}

export async function listKnowledgeEntries(
  actor: AssistantActor,
  filters: KnowledgeEntryFilters,
): Promise<{ entries: KnowledgeEntryWithSector[]; categories: string[] }> {
  const db = scopedPrisma(actor.companyId)

  // Escopo e busca textual são DOIS predicados independentes e vão em `AND`. Espalhar
  // duas chaves `OR` no mesmo literal faria a segunda apagar a primeira em silêncio —
  // e o SUBADMIN que buscasse por texto passaria a enxergar todos os setores.
  const scopeFilter: Prisma.KnowledgeEntryWhereInput | null =
    actor.role === 'SUBADMIN'
      ? { OR: [{ sectorId: null }, { sectorId: actor.sectorId }] }
      : filters.sectorId
        ? { sectorId: filters.sectorId }
        : null

  const textFilter: Prisma.KnowledgeEntryWhereInput | null = filters.q
    ? {
        OR: [
          { question: { contains: filters.q, mode: 'insensitive' } },
          { answer: { contains: filters.q, mode: 'insensitive' } },
        ],
      }
    : null

  const and = [scopeFilter, textFilter].filter(
    (clause): clause is Prisma.KnowledgeEntryWhereInput => clause !== null,
  )

  const where: Prisma.KnowledgeEntryWhereInput = {
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
    ...(and.length > 0 ? { AND: and } : {}),
  }

  const entries = await db.knowledgeEntry.findMany({
    where,
    include: sectorInclude,
    orderBy: [{ category: 'asc' }, { question: 'asc' }],
  })

  const comCategoria = await db.knowledgeEntry.findMany({
    // Mesmo escopo da listagem: SUBADMIN não pode ver nome de categoria usada
    // só em setor alheio.
    where: { category: { not: null }, ...(scopeFilter ?? {}) },
    select: { category: true },
    distinct: ['category'],
  })
  const categories = comCategoria
    .map((row) => row.category)
    .filter((category): category is string => category !== null)
    .sort((a, b) => a.localeCompare(b))

  return { entries, categories }
}

export async function createKnowledgeEntry(
  actor: AssistantActor,
  input: CreateKnowledgeEntryRequest,
): Promise<KnowledgeEntryWithSector> {
  const db = scopedPrisma(actor.companyId)
  const sectorId = resolveSectorIdForWrite(actor, input.sectorId)
  await assertSectorExists(actor.companyId, sectorId)

  return db.$transaction(async (tx) => {
    const created = await tx.knowledgeEntry.create({
      data: {
        category: input.category?.trim() ? input.category.trim() : null,
        question: input.question.trim(),
        answer: input.answer.trim(),
        keywords: normalizeKeywords(input.keywords),
        isActive: input.isActive ?? true,
        sectorId,
        createdById: actor.id,
      },
      include: sectorInclude,
    })
    // Mesmo cast dos outros services: o tx da extensão não é um TransactionClient
    // cru, mas o companyId vai explícito no recordAuditLog.
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'KnowledgeEntry',
      entityId: created.id,
      action: 'CREATE',
      after: created,
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
    return created
  })
}

export async function updateKnowledgeEntry(
  actor: AssistantActor,
  id: string,
  input: UpdateKnowledgeEntryRequest,
): Promise<KnowledgeEntryWithSector> {
  const db = scopedPrisma(actor.companyId)
  const before = await db.knowledgeEntry.findFirst({ where: { id }, include: sectorInclude })
  if (!before) throw new AssistantError('Entrada não encontrada.', 404)
  assertCanManage(actor, before.sectorId)

  const data: Prisma.KnowledgeEntryUncheckedUpdateInput = {}
  if (input.category !== undefined) data.category = input.category?.trim() ? input.category.trim() : null
  if (input.question !== undefined) data.question = input.question.trim()
  if (input.answer !== undefined) data.answer = input.answer.trim()
  if (input.keywords !== undefined) data.keywords = normalizeKeywords(input.keywords)
  if (input.isActive !== undefined) data.isActive = input.isActive
  if (input.sectorId !== undefined) {
    const nextSectorId = resolveSectorIdForWrite(actor, input.sectorId)
    await assertSectorExists(actor.companyId, nextSectorId)
    data.sectorId = nextSectorId
  }

  return db.$transaction(async (tx) => {
    await tx.knowledgeEntry.update({ where: { id }, data })
    const after = await tx.knowledgeEntry.findUniqueOrThrow({ where: { id }, include: sectorInclude })
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'KnowledgeEntry',
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

export async function deleteKnowledgeEntry(actor: AssistantActor, id: string): Promise<void> {
  const db = scopedPrisma(actor.companyId)
  const before = await db.knowledgeEntry.findFirst({ where: { id }, include: sectorInclude })
  if (!before) throw new AssistantError('Entrada não encontrada.', 404)
  assertCanManage(actor, before.sectorId)

  await db.$transaction(async (tx) => {
    await tx.knowledgeEntry.delete({ where: { id } })
    await recordAuditLog({
      actorId: actor.id,
      entityType: 'KnowledgeEntry',
      entityId: id,
      action: 'DELETE',
      before,
      companyId: actor.companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
  })
}

export interface AssistantGapsOptions {
  days: number
  limit: number
}

export interface AssistantGapsResult {
  unanswered: AssistantGapDTO[]
  frequent: AssistantGapDTO[]
  negative: { entry: KnowledgeEntryWithSector; negativeCount: number; comments: string[] }[]
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Agrupa perguntas pela forma normalizada: a mesma dúvida repetida vira uma linha com contador. */
function groupQuestions(
  queries: { question: string; createdAt: Date }[],
  limit: number,
): AssistantGapDTO[] {
  const groups = new Map<string, { sample: string; count: number; lastAskedAt: Date }>()
  for (const query of queries) {
    const normalized = normalizeQuestion(query.question)
    if (normalized === '') continue
    const current = groups.get(normalized)
    if (!current) {
      groups.set(normalized, { sample: query.question, count: 1, lastAskedAt: query.createdAt })
      continue
    }
    current.count += 1
    // O exemplo legível é sempre a ocorrência mais recente.
    if (query.createdAt > current.lastAskedAt) {
      current.lastAskedAt = query.createdAt
      current.sample = query.question
    }
  }

  return [...groups.entries()]
    .map(([normalized, group]) => ({
      normalized,
      sample: group.sample,
      count: group.count,
      lastAskedAt: group.lastAskedAt.toISOString(),
    }))
    .sort((a, b) => b.count - a.count || b.lastAskedAt.localeCompare(a.lastAskedAt))
    .slice(0, limit)
}

/**
 * Fila de trabalho de quem cura a base: o que ninguém achou, o que mais perguntam e
 * o que está recebendo polegar para baixo.
 */
export async function listAssistantGaps(
  actor: AssistantActor,
  options: AssistantGapsOptions,
): Promise<AssistantGapsResult> {
  const db = scopedPrisma(actor.companyId)
  const since = new Date(Date.now() - options.days * DAY_MS)

  const queries = await db.assistantQuery.findMany({
    where: { createdAt: { gte: since } },
    select: { id: true, question: true, createdAt: true, matchedEntryIds: true },
    orderBy: { createdAt: 'desc' },
  })

  // Sem entrada casada é o sinal de lacuna — mas "oi", "obrigada" e "ok"
  // também não casam com nada, e não são pergunta que falta na base. Sem este
  // filtro, o topo do painel de Gente e Gestão vira cumprimento e enterra a
  // dúvida real. Filtrado na LEITURA, de propósito: vale também para o que já
  // foi gravado, sem migration nem coluna nova.
  const unanswered = groupQuestions(
    queries.filter(
      (query) => query.matchedEntryIds.length === 0 && classifySmallTalk(query.question) === null,
    ),
    options.limit,
  )
  const frequent = groupQuestions(
    queries.filter((query) => query.matchedEntryIds.length > 0),
    options.limit,
  )

  const negatives = await db.assistantFeedback.findMany({
    where: { rating: -1, createdAt: { gte: since } },
    select: { queryId: true, comment: true },
  })
  const matchedByQuery = new Map(queries.map((query) => [query.id, query.matchedEntryIds]))

  const porEntrada = new Map<string, { negativeCount: number; comments: string[] }>()
  for (const feedback of negatives) {
    for (const entryId of matchedByQuery.get(feedback.queryId) ?? []) {
      const current = porEntrada.get(entryId) ?? { negativeCount: 0, comments: [] }
      current.negativeCount += 1
      if (feedback.comment) current.comments.push(feedback.comment)
      porEntrada.set(entryId, current)
    }
  }

  // Mesmo escopo de setor que listKnowledgeEntries aplica: SUBADMIN não pode ver
  // pergunta/resposta de entrada de outro setor aqui, já que lá elas ficam escondidas.
  // `unanswered`/`frequent` ficam de fora de propósito — são perguntas da empresa
  // inteira, sem entrada associada, então não há setor para restringir.
  const scopeFilter: Prisma.KnowledgeEntryWhereInput | null =
    actor.role === 'SUBADMIN' ? { OR: [{ sectorId: null }, { sectorId: actor.sectorId }] } : null

  // Entrada apagada depois da pergunta deixa id órfão no histórico: some da fila em
  // vez de reescrever o passado.
  const entries = porEntrada.size
    ? await db.knowledgeEntry.findMany({
        where: { id: { in: [...porEntrada.keys()] }, ...(scopeFilter ?? {}) },
        include: sectorInclude,
      })
    : []

  const negative = entries
    .map((entry) => ({
      entry,
      negativeCount: porEntrada.get(entry.id)!.negativeCount,
      comments: porEntrada.get(entry.id)!.comments,
    }))
    .sort((a, b) => b.negativeCount - a.negativeCount)
    .slice(0, options.limit)

  return { unanswered, frequent, negative }
}

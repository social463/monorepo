import { Prisma } from '@prisma/client'
import {
  MAX_ONE_ON_ONE_OCCURRENCES,
  ONE_ON_ONE_ACTION_DESCRIPTION_MAX_LENGTH,
  ONE_ON_ONE_DECLINE_NOTE_MAX_LENGTH,
  ONE_ON_ONE_NOTE_MAX_LENGTH,
  ONE_ON_ONE_TOPIC_MAX_LENGTH,
  normalizeOneOnOnePair,
  type CreateOneOnOneRequest,
  type OneOnOneInviteResponse,
  type OneOnOneActionDTO,
  type OneOnOneCompletedActionDTO,
  type OneOnOneEvent,
  type OneOnOneMeetingDetailDTO,
  type OneOnOneMeetingSummaryDTO,
  type OneOnOnePdiBlockDTO,
  type OneOnOneTopicDTO,
  type OneOnOneTopicOrigin,
  type OneOnOneTopicTemplateDTO,
  type RespondToOneOnOneRequest,
} from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'
import { oneOnOneHub } from '../lib/one-on-one-hub'
import {
  hhmmInSaoPaulo,
  hhmmssInSaoPaulo,
  saoPauloEndOfDayUtc,
  saoPauloInstant,
  ymdInSaoPaulo,
} from '../lib/sao-paulo-date'
import {
  counterpartIdOf,
  counterpartOf,
  toOneOnOneActionDTO,
  toOneOnOneMeetingSummary,
  toOneOnOnePersonDTO,
  toOneOnOneTopicDTO,
  viewerSideOf,
  type OneOnOneMeetingWithSeries,
  type OneOnOnePersonSource,
} from '../lib/serialize-one-on-one'
import {
  notifyOneOnOneActionAssigned,
  notifyOneOnOneInvited,
  notifyOneOnOneProposalDecided,
  notifyOneOnOneResponded,
} from './notification-service'

export class OneOnOneError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'OneOnOneError'
    this.status = status
  }
}

export interface OneOnOneViewer {
  userId: string
  companyId: string
}

/**
 * O include de toda consulta de encontro: as duas pessoas do par e o tamanho da
 * pauta. O `_count` fica aqui, e não só no `listMeetings`, para que qualquer
 * rota que devolva um resumo já responda "tem pauta?" — é uma agregação no
 * mesmo SELECT, não uma consulta a mais.
 */
const SERIES_INCLUDE = {
  series: { include: { userA: true, userB: true } },
  _count: { select: { topics: true } },
} as const

const DAY_MS = 24 * 60 * 60 * 1000

/** Passo da recorrência em dias; `MONTHLY` é tratado à parte (mês civil). */
const STEP_DAYS: Record<string, number> = { WEEKLY: 7, BIWEEKLY: 14 }

/**
 * Soma `months` meses a `base`, ancorada sempre no DIA de `base` (nunca no
 * resultado do mês anterior — é o que faz a ocorrência de março voltar pro dia
 * 31 em vez de ficar presa no 28 de fevereiro). Quando o dia não existe no mês
 * alvo (31 de fevereiro), grampeia no último dia daquele mês em vez de
 * transbordar pro mês seguinte (comportamento nativo do `Date.setMonth`).
 *
 * A conta é feita no calendário de **São Paulo**, não no do processo: um 1:1 das
 * 22h já é do dia seguinte em UTC, e um servidor em UTC ancoraria a série no dia
 * errado do mês.
 */
function addMonthsAnchored(base: Date, months: number): Date {
  const [ano, mes, dia] = ymdInSaoPaulo(base).split('-').map(Number)
  const alvoAno = ano + Math.floor((mes - 1 + months) / 12)
  const alvoMes = ((mes - 1 + months) % 12) + 1
  // Dia 0 do mês seguinte é o último dia do mês alvo.
  const ultimoDiaDoMes = new Date(Date.UTC(alvoAno, alvoMes, 0)).getUTCDate()
  const alvoDia = Math.min(dia, ultimoDiaDoMes)
  const ymd = `${alvoAno}-${String(alvoMes).padStart(2, '0')}-${String(alvoDia).padStart(2, '0')}`
  return saoPauloInstant(ymd, hhmmssInSaoPaulo(base))
}

/**
 * As datas de cada ocorrência. Série sem fim declarado gera o teto
 * (`MAX_ONE_ON_ONE_OCCURRENCES`) em vez de linhas até 2099; `recurrenceUntil` e
 * `recurrenceCount` são exclusivos entre si (a rota valida).
 */
export function occurrenceDates(input: {
  first: Date
  recurrence: string
  until: Date | null
  count: number | null
}): Date[] {
  if (input.recurrence === 'NONE') return [input.first]
  const limite = Math.min(input.count ?? MAX_ONE_ON_ONE_OCCURRENCES, MAX_ONE_ON_ONE_OCCURRENCES)
  const datas: Date[] = []
  for (let i = 0; i < limite; i += 1) {
    const data =
      input.recurrence === 'MONTHLY'
        ? addMonthsAnchored(input.first, i)
        : new Date(input.first.getTime() + i * STEP_DAYS[input.recurrence] * DAY_MS)
    if (input.until && data > input.until) break
    datas.push(data)
  }
  return datas
}

/**
 * O encontro que o viewer pode ver: só quem está no par. Terceiro recebe 404 —
 * nem confirma a existência. ADMIN não é exceção: 1:1 é conversa privada.
 */
async function findParticipantMeeting(
  viewer: OneOnOneViewer,
  meetingId: string,
): Promise<OneOnOneMeetingWithSeries> {
  const meeting = await scopedPrisma(viewer.companyId).oneOnOneMeeting.findUnique({
    where: { id: meetingId },
    include: SERIES_INCLUDE,
  })
  if (!meeting) throw new OneOnOneError('1:1 não encontrado.', 404)
  const { userAId, userBId } = meeting.series
  if (viewer.userId !== userAId && viewer.userId !== userBId) {
    throw new OneOnOneError('1:1 não encontrado.', 404)
  }
  return meeting
}

export async function createSeries(
  viewer: OneOnOneViewer,
  input: CreateOneOnOneRequest,
): Promise<{ seriesId: string; meetings: OneOnOneMeetingSummaryDTO[] }> {
  const db = scopedPrisma(viewer.companyId)
  if (input.counterpartId === viewer.userId) {
    throw new OneOnOneError('Escolha outra pessoa para o 1:1.')
  }
  // `scopedPrisma` já recorta por empresa: pessoa de outro tenant simplesmente
  // não existe daqui, e a resposta é 404 — não 403.
  const outro = await db.user.findUnique({ where: { id: input.counterpartId } })
  if (!outro || !outro.active) throw new OneOnOneError('Pessoa não encontrada.', 404)
  // ADMIN e SUBADMIN não têm a tela do encontro (`/1-1/:id` vive sob `DevOnly`,
  // que os manda para o `/admin`): marcar com eles criaria um 1:1 que uma das
  // pontas recebe por notificação e nunca consegue abrir.
  if (outro.role === 'ADMIN' || outro.role === 'SUBADMIN') {
    throw new OneOnOneError('Administradores não participam de 1:1. Escolha outra pessoa.')
  }

  // A tela manda dia e hora de relógio de parede, sem fuso; quem os interpreta é
  // São Paulo, e não o fuso do processo (UTC no contêiner) — ver `saoPauloInstant`.
  const first = saoPauloInstant(input.date, input.startTime)
  if (Number.isNaN(first.getTime())) throw new OneOnOneError('Data ou hora inválida.')

  const datas = occurrenceDates({
    first,
    recurrence: input.recurrence,
    until: input.recurrenceUntil ? saoPauloEndOfDayUtc(input.recurrenceUntil) : null,
    count: input.recurrenceCount ?? null,
  })
  if (datas.length === 0) throw new OneOnOneError('A recorrência não gera nenhum encontro.')

  const { userAId, userBId } = normalizeOneOnOnePair(viewer.userId, input.counterpartId)
  const series = await db.oneOnOneSeries.create({
    data: {
      userAId,
      userBId,
      createdById: viewer.userId,
      recurrence: input.recurrence,
      recurrenceUntil: input.recurrenceUntil ? saoPauloEndOfDayUtc(input.recurrenceUntil) : null,
      durationMinutes: input.durationMinutes,
      companyId: viewer.companyId,
      meetings: {
        create: datas.map((startsAt) => ({
          startsAt,
          endsAt: new Date(startsAt.getTime() + input.durationMinutes * 60_000),
          companyId: viewer.companyId,
        })),
      },
    },
    include: { userA: true, userB: true, meetings: { orderBy: { startsAt: 'asc' } } },
  })

  const meetings = series.meetings.map((meeting) =>
    toOneOnOneMeetingSummary({ ...meeting, series }, viewer.userId, 0),
  )

  const autor = viewerSideOf(series, viewer.userId)
  if (series.meetings[0]) {
    // Uma notificação por SÉRIE, não por ocorrência: marcar 3 encontros de uma
    // vez não deve virar 3 avisos. Best-effort — falha ao notificar não desfaz a série.
    await notifyOneOnOneInvited({
      userId: input.counterpartId,
      actorId: viewer.userId,
      actorName: autor.name,
      meetingId: series.meetings[0].id,
      companyId: viewer.companyId,
    }).catch((err) => console.error('[one-on-one] falha ao notificar convite', err))
  }

  avisarPar(series, { type: 'agenda:changed' })
  return { seriesId: series.id, meetings }
}

/**
 * O par de uma série, do jeito que ele é guardado: ids normalizados. Serve de
 * chave de agrupamento e de `where` — é o formato do índice
 * `[companyId, userAId, userBId]`.
 */
type OneOnOnePair = { userAId: string; userBId: string }

function pairOf(series: OneOnOnePair): OneOnOnePair {
  return { userAId: series.userAId, userBId: series.userBId }
}

function pairKey(pair: OneOnOnePair): string {
  return `${pair.userAId}|${pair.userBId}`
}

/**
 * Avisa as DUAS pessoas do par que algo mudou, para a tela delas se atualizar
 * sozinha durante a conversa.
 *
 * Fica no service, e não na rota como em retro/resenha, porque o destinatário
 * aqui é o PAR — exatamente o que a rota não tem em mãos (ela recebe um id de
 * tópico ou de ação, e descobrir o par custaria uma consulta a mais em toda
 * escrita). O service já carrega a série em todas elas, e já é daqui que saem as
 * notificações. Síncrono e sem `await`: o hub é memória local, e nada nele pode
 * atrasar ou derrubar a escrita que acabou de ser confirmada.
 */
function avisarPar(pair: OneOnOnePair, event: OneOnOneEvent): void {
  oneOnOneHub.emit([pair.userAId, pair.userBId], event)
}

/**
 * Quantas ações `OPEN` cada PAR tem em aberto — não cada série.
 *
 * A pendência é do par (spec: "ação pendente pertence ao par, então qualquer
 * encontro entre as duas pessoas a enxerga, inclusive se a série for encerrada
 * e outra começar depois"), e nada impede duas séries do mesmo par (um avulso
 * mais um quinzenal, ou uma série encerrada e outra nova). Contar por
 * `seriesId` prendia o combinado na série onde ele nasceu.
 *
 * Duas consultas em vez de um `groupBy` só: o `groupBy` agrupa por coluna da
 * própria ação, e "par" mora na série — então primeiro resolvem-se as séries
 * dos pares (pelo índice normalizado), depois somam-se as ações delas.
 */
async function openActionCountByPair(
  viewer: OneOnOneViewer,
  pairs: OneOnOnePair[],
): Promise<Map<string, number>> {
  const contagem = new Map<string, number>()
  if (pairs.length === 0) return contagem

  const db = scopedPrisma(viewer.companyId)
  const series = await db.oneOnOneSeries.findMany({
    where: { OR: pairs },
    select: { id: true, userAId: true, userBId: true },
  })
  if (series.length === 0) return contagem

  const parDaSerie = new Map(series.map((s) => [s.id, pairKey(s)]))
  const abertas = await db.oneOnOneAction.groupBy({
    by: ['seriesId'],
    where: { status: 'OPEN', seriesId: { in: series.map((s) => s.id) } },
    _count: { _all: true },
  })
  for (const linha of abertas) {
    const chave = parDaSerie.get(linha.seriesId)
    if (!chave) continue
    contagem.set(chave, (contagem.get(chave) ?? 0) + linha._count._all)
  }
  return contagem
}

export async function listMeetings(
  viewer: OneOnOneViewer,
  from: string,
  to: string,
): Promise<OneOnOneMeetingSummaryDTO[]> {
  const db = scopedPrisma(viewer.companyId)
  const meetings = await db.oneOnOneMeeting.findMany({
    where: {
      // A janela é de dias civis de São Paulo: em UTC, `from` começaria 3h tarde
      // e engoliria o encontro das 00h–03h do primeiro dia.
      startsAt: { gte: saoPauloInstant(from, '00:00'), lte: saoPauloEndOfDayUtc(to) },
      status: { not: 'CANCELED' },
      series: { OR: [{ userAId: viewer.userId }, { userBId: viewer.userId }] },
    },
    include: SERIES_INCLUDE,
    orderBy: { startsAt: 'asc' },
  })
  const pares = new Map(meetings.map((m) => [pairKey(m.series), pairOf(m.series)]))
  const porPar = await openActionCountByPair(viewer, [...pares.values()])
  return meetings.map((meeting) =>
    toOneOnOneMeetingSummary(meeting, viewer.userId, porPar.get(pairKey(meeting.series)) ?? 0),
  )
}

/** Planos que ainda aceitam ação — arquivado e concluído não recebem promoção. */
const PLANOS_ATIVOS = ['DRAFT', 'IN_PROGRESS'] as const

/**
 * O `where` do plano ativo QUE LIGA AS DUAS PESSOAS do 1:1 — em qualquer
 * direção (o viewer é o dono e o outro é o líder, ou o contrário).
 *
 * Fonte única do bloco de PDI no DTO e da promoção de ação: as duas coisas
 * respondem à mesma pergunta ("este par tem plano?"), e é essa amarração que
 * impede uma ação combinada aqui de cair no plano que o viewer tem com um
 * terceiro — plano de outra conversa, que outra pessoa lê.
 */
function pairPlanWhere(series: OneOnOnePair, viewerId: string) {
  const outroId = counterpartIdOf(series, viewerId)
  return {
    status: { in: [...PLANOS_ATIVOS] },
    OR: [
      { userId: viewerId, leaderId: outroId },
      { userId: outroId, leaderId: viewerId },
    ],
  }
}

/**
 * O bloco de PDI existe SÓ quando o par é líder↔liderado, e o teste é o fato
 * (existe `PdiPlan` de um deles com o outro como `leaderId`), não o papel:
 * hierarquia diria que dois LEAD não têm relação, mas o plano diz quem valida
 * quem. `canPromote` é do dono, porque o PDI só aceita escrita do dono.
 */
async function pdiBlockFor(
  viewer: OneOnOneViewer,
  series: {
    userAId: string
    userBId: string
    userA: OneOnOnePersonSource
    userB: OneOnOnePersonSource
  },
): Promise<OneOnOnePdiBlockDTO | null> {
  const plan = await scopedPrisma(viewer.companyId).pdiPlan.findFirst({
    where: pairPlanWhere(series, viewer.userId),
    include: { actions: { orderBy: { createdAt: 'asc' } } },
    orderBy: { updatedAt: 'desc' },
  })
  if (!plan) return null

  const dono = series.userA.id === plan.userId ? series.userA : series.userB
  return {
    planId: plan.id,
    planTitle: plan.title,
    owner: toOneOnOnePersonDTO(dono),
    actions: plan.actions.map((action) => ({
      id: action.id,
      description: action.description,
      status: action.status,
      progressPct: action.progressPct,
      dueDate: action.dueDate ? action.dueDate.toISOString() : null,
    })),
    canPromote: plan.userId === viewer.userId,
  }
}

export async function getMeeting(
  viewer: OneOnOneViewer,
  meetingId: string,
): Promise<OneOnOneMeetingDetailDTO> {
  const db = scopedPrisma(viewer.companyId)
  const meeting = await findParticipantMeeting(viewer, meetingId)

  const [topics, abertas, fechadasAqui, note] = await Promise.all([
    db.oneOnOneTopic.findMany({ where: { meetingId }, orderBy: { sortOrder: 'asc' } }),
    db.oneOnOneAction.findMany({
      // Ações abertas do PAR — não da série. É o que faz o combinado sobreviver
      // ao fim de uma série e reaparecer na próxima entre as mesmas duas
      // pessoas; o filtro pela série normalizada é servido pelo índice
      // `[companyId, userAId, userBId]`.
      where: { status: 'OPEN', series: pairOf(meeting.series) },
      include: { owner: true },
      orderBy: { createdAt: 'asc' },
    }),
    // Já as fechadas ficam no encontro onde nasceram: é histórico daquele dia.
    db.oneOnOneAction.findMany({
      where: { createdInMeetingId: meetingId, status: { not: 'OPEN' } },
      include: { owner: true },
      orderBy: { createdAt: 'asc' },
    }),
    db.oneOnOnePrivateNote.findUnique({
      where: { meetingId_authorId: { meetingId, authorId: viewer.userId } },
    }),
  ])

  return {
    ...toOneOnOneMeetingSummary(meeting, viewer.userId, abertas.length),
    topics: topics.map(toOneOnOneTopicDTO),
    openActions: abertas.map(toOneOnOneActionDTO),
    closedActions: fechadasAqui.map(toOneOnOneActionDTO),
    // A nota do outro participante não é buscada — não existe caminho para ela.
    note: note?.body ?? null,
    pdi: await pdiBlockFor(viewer, meeting.series),
  }
}

export { findParticipantMeeting }

/**
 * Tópico que o viewer pode mexer: o de um encontro em que ele está. Devolve o
 * encontro junto porque quem escreve precisa dele de qualquer jeito — é de lá
 * que sai o par que recebe o aviso de tempo real.
 */
async function findParticipantTopic(viewer: OneOnOneViewer, topicId: string) {
  const topic = await scopedPrisma(viewer.companyId).oneOnOneTopic.findUnique({ where: { id: topicId } })
  if (!topic) throw new OneOnOneError('Tópico não encontrado.', 404)
  const meeting = await findParticipantMeeting(viewer, topic.meetingId)
  return { topic, meeting }
}

export async function addTopic(
  viewer: OneOnOneViewer,
  meetingId: string,
  input: { text: string; origin: OneOnOneTopicOrigin },
): Promise<OneOnOneTopicDTO> {
  const meeting = await findParticipantMeeting(viewer, meetingId)
  const text = input.text.trim().slice(0, ONE_ON_ONE_TOPIC_MAX_LENGTH)
  if (!text) throw new OneOnOneError('Escreva o tópico.')

  const db = scopedPrisma(viewer.companyId)
  const ultimo = await db.oneOnOneTopic.findFirst({ where: { meetingId }, orderBy: { sortOrder: 'desc' } })
  const topic = await db.oneOnOneTopic.create({
    data: {
      meetingId,
      text,
      origin: input.origin,
      sortOrder: (ultimo?.sortOrder ?? -1) + 1,
      createdById: viewer.userId,
      companyId: viewer.companyId,
    },
  })
  avisarPar(meeting.series, { type: 'meeting:changed', meetingId })
  return toOneOnOneTopicDTO(topic)
}

export async function updateTopic(
  viewer: OneOnOneViewer,
  topicId: string,
  input: { text?: string; discussed?: boolean },
): Promise<OneOnOneTopicDTO> {
  const { meeting } = await findParticipantTopic(viewer, topicId)
  const data: { text?: string; discussed?: boolean } = {}
  if (input.text !== undefined) {
    const text = input.text.trim().slice(0, ONE_ON_ONE_TOPIC_MAX_LENGTH)
    if (!text) throw new OneOnOneError('Escreva o tópico.')
    data.text = text
  }
  if (input.discussed !== undefined) data.discussed = input.discussed

  const topic = await scopedPrisma(viewer.companyId).oneOnOneTopic.update({ where: { id: topicId }, data })
  avisarPar(meeting.series, { type: 'meeting:changed', meetingId: meeting.id })
  return toOneOnOneTopicDTO(topic)
}

export async function deleteTopic(viewer: OneOnOneViewer, topicId: string): Promise<void> {
  const { meeting } = await findParticipantTopic(viewer, topicId)
  await scopedPrisma(viewer.companyId).oneOnOneTopic.delete({ where: { id: topicId } })
  avisarPar(meeting.series, { type: 'meeting:changed', meetingId: meeting.id })
}

/**
 * Upsert da nota de QUEM PEDIU. Corpo vazio apaga — é como a pessoa desfaz o
 * que escreveu sem um botão de excluir separado. A extensão de isolamento de
 * tenant não suporta `upsert` (ver `tenant-scope.ts`), então é find→create/update
 * na mão, com fallback pra `update` se um create concorrente colidir no unique
 * `[meetingId, authorId]` (mesmo padrão de `mood-service.ts`).
 */
export async function saveNote(
  viewer: OneOnOneViewer,
  meetingId: string,
  body: string,
): Promise<string | null> {
  await findParticipantMeeting(viewer, meetingId)
  const db = scopedPrisma(viewer.companyId)
  const texto = body.trim().slice(0, ONE_ON_ONE_NOTE_MAX_LENGTH)
  const chave = { meetingId_authorId: { meetingId, authorId: viewer.userId } }

  if (!texto) {
    await db.oneOnOnePrivateNote.deleteMany({ where: { meetingId, authorId: viewer.userId } })
    return null
  }

  const existing = await db.oneOnOnePrivateNote.findUnique({ where: chave })
  if (existing) {
    const note = await db.oneOnOnePrivateNote.update({ where: chave, data: { body: texto } })
    return note.body
  }
  try {
    const note = await db.oneOnOnePrivateNote.create({
      data: { meetingId, authorId: viewer.userId, body: texto, companyId: viewer.companyId },
    })
    return note.body
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const note = await db.oneOnOnePrivateNote.update({ where: chave, data: { body: texto } })
      return note.body
    }
    throw err
  }
}

export async function listTopicTemplates(companyId: string): Promise<OneOnOneTopicTemplateDTO[]> {
  const templates = await scopedPrisma(companyId).oneOnOneTopicTemplate.findMany({
    where: { active: true },
    orderBy: [{ theme: 'asc' }, { sortOrder: 'asc' }],
  })
  return templates.map((t) => ({ id: t.id, theme: t.theme, text: t.text, active: t.active, sortOrder: t.sortOrder }))
}

/** A ação que o viewer pode mexer: a de uma série em que ele está. */
async function findParticipantAction(viewer: OneOnOneViewer, actionId: string) {
  const action = await scopedPrisma(viewer.companyId).oneOnOneAction.findUnique({
    where: { id: actionId },
    include: { owner: true, series: true },
  })
  if (!action) throw new OneOnOneError('Ação não encontrada.', 404)
  if (viewer.userId !== action.series.userAId && viewer.userId !== action.series.userBId) {
    throw new OneOnOneError('Ação não encontrada.', 404)
  }
  return action
}

export async function createActionItem(
  viewer: OneOnOneViewer,
  meetingId: string,
  input: { description: string; ownerId: string; dueDate: string | null },
): Promise<OneOnOneActionDTO> {
  const meeting = await findParticipantMeeting(viewer, meetingId)
  const description = input.description.trim().slice(0, ONE_ON_ONE_ACTION_DESCRIPTION_MAX_LENGTH)
  if (!description) throw new OneOnOneError('Descreva a ação combinada.')
  // Dono precisa ser um dos dois: ação de 1:1 é combinado do par, não delegação.
  if (input.ownerId !== meeting.series.userAId && input.ownerId !== meeting.series.userBId) {
    throw new OneOnOneError('O responsável precisa ser uma das duas pessoas do 1:1.')
  }

  const action = await scopedPrisma(viewer.companyId).oneOnOneAction.create({
    data: {
      seriesId: meeting.seriesId,
      createdInMeetingId: meetingId,
      description,
      ownerId: input.ownerId,
      dueDate: input.dueDate ? new Date(input.dueDate) : null,
      companyId: viewer.companyId,
    },
    include: { owner: true },
  })

  if (input.ownerId !== viewer.userId) {
    const autor = viewerSideOf(meeting.series, viewer.userId)
    // Best-effort, no padrão do resto do repo: falhar ao notificar não desfaz o combinado.
    await notifyOneOnOneActionAssigned({
      userId: input.ownerId,
      actorId: viewer.userId,
      actorName: autor.name,
      meetingId,
      description,
      companyId: viewer.companyId,
    }).catch((err) => console.error('[one-on-one] falha ao notificar dono da ação', err))
  }
  avisarPar(meeting.series, { type: 'actions:changed' })
  return toOneOnOneActionDTO(action)
}

export async function updateActionItem(
  viewer: OneOnOneViewer,
  actionId: string,
  input: { description?: string; ownerId?: string; dueDate?: string | null; status?: 'OPEN' | 'DONE' },
): Promise<OneOnOneActionDTO> {
  const atual = await findParticipantAction(viewer, actionId)
  if (atual.status === 'PROMOTED') {
    throw new OneOnOneError('Esta ação virou ação de PDI — o acompanhamento é por lá.', 409)
  }

  const data: Record<string, unknown> = {}
  if (input.description !== undefined) {
    const description = input.description.trim().slice(0, ONE_ON_ONE_ACTION_DESCRIPTION_MAX_LENGTH)
    if (!description) throw new OneOnOneError('Descreva a ação combinada.')
    data.description = description
  }
  if (input.ownerId !== undefined) {
    if (input.ownerId !== atual.series.userAId && input.ownerId !== atual.series.userBId) {
      throw new OneOnOneError('O responsável precisa ser uma das duas pessoas do 1:1.')
    }
    data.ownerId = input.ownerId
  }
  if (input.dueDate !== undefined) data.dueDate = input.dueDate ? new Date(input.dueDate) : null
  if (input.status !== undefined) {
    data.status = input.status
    // Concluir grava quem fechou; reabrir limpa o rastro para não mentir depois.
    data.completedById = input.status === 'DONE' ? viewer.userId : null
    data.completedAt = input.status === 'DONE' ? new Date() : null
  }

  const action = await scopedPrisma(viewer.companyId).oneOnOneAction.update({
    where: { id: actionId },
    data,
    include: { owner: true },
  })
  avisarPar(atual.series, { type: 'actions:changed' })
  return toOneOnOneActionDTO(action)
}

export { findParticipantAction }

export type OneOnOneScope = 'this' | 'future'

/**
 * Filtro do lote de ocorrências SEGUINTES ao encontro pedido, usado tanto por
 * remarcar quanto por cancelar com `scope: 'future'`. Só entram `SCHEDULED`:
 * já canceladas ou já realizadas não fazem parte de "as próximas".
 */
function futureScheduledWhere(seriesId: string, from: Date) {
  return { seriesId, startsAt: { gte: from }, status: 'SCHEDULED' as const }
}

/**
 * Garante que o encontro PEDIDO ainda aceita a ação antes de qualquer escrita.
 * Vale para os dois escopos: com `future`, se o alvo já estiver `CANCELED`/`DONE`,
 * a checagem barra aqui — sem isso, ele saía do lote (filtro `SCHEDULED`) mas as
 * ocorrências seguintes eram mexidas do mesmo jeito, deixando o pedido "quieto"
 * sem avisar ninguém.
 */
function assertMeetingActionable(
  meeting: { status: string },
  mensagens: Partial<Record<'CANCELED' | 'DONE', string>>,
) {
  const mensagem = mensagens[meeting.status as 'CANCELED' | 'DONE']
  if (mensagem) throw new OneOnOneError(mensagem, 409)
}

/** Ações OPEN do PAR — mesma contagem usada por `listMeetings`/`getMeeting`. */
async function countOpenActions(viewer: OneOnOneViewer, series: OneOnOnePair): Promise<number> {
  return scopedPrisma(viewer.companyId).oneOnOneAction.count({
    where: { status: 'OPEN', series: pairOf(series) },
  })
}

/**
 * Remarcar. `this` move uma ocorrência; `future` move esta e as seguintes pelo
 * MESMO deslocamento, preservando o intervalo entre elas — encontro passado
 * nunca é reescrito.
 */
export async function rescheduleMeeting(
  viewer: OneOnOneViewer,
  meetingId: string,
  input: { date: string; startTime: string; durationMinutes: number },
  scope: OneOnOneScope,
): Promise<OneOnOneMeetingSummaryDTO[]> {
  const db = scopedPrisma(viewer.companyId)
  const meeting = await findParticipantMeeting(viewer, meetingId)
  assertMeetingActionable(meeting, { CANCELED: 'Este 1:1 foi cancelado.', DONE: 'Este 1:1 já aconteceu.' })
  const novo = saoPauloInstant(input.date, input.startTime)
  if (Number.isNaN(novo.getTime())) throw new OneOnOneError('Data ou hora inválida.')
  const deslocamento = novo.getTime() - meeting.startsAt.getTime()

  const alvos =
    scope === 'this'
      ? [meeting]
      : await db.oneOnOneMeeting.findMany({
          where: futureScheduledWhere(meeting.seriesId, meeting.startsAt),
          include: SERIES_INCLUDE,
          orderBy: { startsAt: 'asc' },
        })

  // ANTES do deslocamento, de propósito: "esta e as seguintes" é definido pelos
  // horários ATUAIS. Depois do UPDATE as linhas já se moveram, e um encontro
  // puxado para trás sairia do recorte — ficando com a resposta antiga de pé.
  //
  // Horário novo, aceite novo — mesma lógica do lembrete. A exceção é aceitar a
  // contraproposta, que remarca PARA o horário que o convidado sugeriu e por
  // isso grava `ACCEPTED` logo em seguida (ver `acceptProposal`).
  await aplicarResposta(viewer, meeting, scope, 'PENDING')

  const atualizados = await db.$transaction(
    alvos.map((alvo) => {
      const startsAt = new Date(alvo.startsAt.getTime() + deslocamento)
      return db.oneOnOneMeeting.update({
        where: { id: alvo.id },
        data: {
          startsAt,
          endsAt: new Date(startsAt.getTime() + input.durationMinutes * 60_000),
          // Horário novo, lembrete novo: sem zerar, um encontro empurrado para
          // frente nunca mais avisaria (a reivindicação do horário antigo ficaria
          // de pé). Mesma decisão do `OfficeMeeting` ao ser remarcado.
          remindedAt: null,
        },
        include: SERIES_INCLUDE,
      })
    }),
  )
  const abertas = await countOpenActions(viewer, meeting.series)
  avisarPar(meeting.series, { type: 'agenda:changed' })
  return atualizados.map((m) => toOneOnOneMeetingSummary(m, viewer.userId, abertas))
}

/**
 * Grava a resposta do convite no lugar certo, que depende do escopo:
 *
 * - `future` grava na SÉRIE e **limpa os overrides** das ocorrências dali para
 *   frente — senão uma exceção antiga sobreviveria a uma resposta mais nova, e a
 *   pessoa veria uma recusa que ela acabou de desfazer.
 * - `this` grava só o override daquela ocorrência, deixando a série intacta.
 *
 * A ação mais recente vence. É a regra que mantém o par (série, override)
 * legível: sem ela, "aceitei a série" e "recusei aquela semana" empatariam.
 */
async function aplicarResposta(
  viewer: OneOnOneViewer,
  meeting: OneOnOneMeetingWithSeries,
  scope: OneOnOneScope,
  response: OneOnOneInviteResponse,
  extras: { proposedStartsAt?: Date | null; declineNote?: string | null } = {},
): Promise<void> {
  const db = scopedPrisma(viewer.companyId)
  const agora = new Date()
  const proposta = {
    proposedStartsAt: extras.proposedStartsAt ?? null,
    declineNote: extras.declineNote ?? null,
  }

  if (scope === 'this') {
    await db.oneOnOneMeeting.update({
      where: { id: meeting.id },
      data: { inviteeResponse: response, inviteeRespondedAt: agora, ...proposta },
    })
    return
  }

  await db.$transaction([
    db.oneOnOneSeries.update({
      where: { id: meeting.seriesId },
      data: { inviteeResponse: response, inviteeRespondedAt: agora },
    }),
    db.oneOnOneMeeting.updateMany({
      where: futureScheduledWhere(meeting.seriesId, meeting.startsAt),
      data: { inviteeResponse: null, inviteeRespondedAt: null, proposedStartsAt: null, declineNote: null },
    }),
    // A contraproposta e o motivo continuam sendo DESTA ocorrência: o que se
    // propõe é um horário concreto, e horário é de um encontro.
    db.oneOnOneMeeting.update({ where: { id: meeting.id }, data: proposta }),
  ])
}

export async function cancelMeeting(
  viewer: OneOnOneViewer,
  meetingId: string,
  scope: OneOnOneScope,
): Promise<void> {
  const db = scopedPrisma(viewer.companyId)
  const meeting = await findParticipantMeeting(viewer, meetingId)
  assertMeetingActionable(meeting, { CANCELED: 'Este 1:1 já foi cancelado.', DONE: 'Este 1:1 já aconteceu.' })
  await db.oneOnOneMeeting.updateMany({
    where: scope === 'this' ? { id: meetingId } : futureScheduledWhere(meeting.seriesId, meeting.startsAt),
    data: { status: 'CANCELED' },
  })
  if (scope === 'future') {
    await db.oneOnOneSeries.update({ where: { id: meeting.seriesId }, data: { endedAt: new Date() } })
  }
  avisarPar(meeting.series, { type: 'agenda:changed' })
}

/** Quem marcou não responde ao próprio convite — o aceite dele é implícito. */
function assertIsInvitee(meeting: OneOnOneMeetingWithSeries, viewer: OneOnOneViewer) {
  if (meeting.series.createdById === viewer.userId) {
    throw new OneOnOneError('Quem marcou o 1:1 não responde ao próprio convite.', 403)
  }
}

/** …e o contrário: só quem marcou decide o que fazer com a contraproposta. */
function assertIsCreator(meeting: OneOnOneMeetingWithSeries, viewer: OneOnOneViewer) {
  if (meeting.series.createdById !== viewer.userId) {
    throw new OneOnOneError('Só quem marcou o 1:1 responde à sugestão de horário.', 403)
  }
}

/** A duração atual do encontro, para remarcar sem inventar um número novo. */
function duracaoEmMinutos(meeting: { startsAt: Date; endsAt: Date }): number {
  return Math.round((meeting.endsAt.getTime() - meeting.startsAt.getTime()) / 60_000)
}

/**
 * O convidado aceita ou recusa. Recusar pode vir com contraproposta de horário e
 * um motivo — e não cancela nada: o encontro fica na agenda, marcado, e quem
 * marcou decide. Cancelar aqui jogaria fora a pauta já escrita e tiraria das duas
 * pessoas a chance de negociar, que é justamente o que faltava.
 */
export async function respondToInvite(
  viewer: OneOnOneViewer,
  meetingId: string,
  input: RespondToOneOnOneRequest,
  scope: OneOnOneScope,
): Promise<OneOnOneMeetingSummaryDTO> {
  const meeting = await findParticipantMeeting(viewer, meetingId)
  assertMeetingActionable(meeting, { CANCELED: 'Este 1:1 foi cancelado.', DONE: 'Este 1:1 já aconteceu.' })
  assertIsInvitee(meeting, viewer)

  let proposta: Date | null = null
  if (input.proposedStartsAt) {
    if (input.response !== 'DECLINED') {
      throw new OneOnOneError('Sugestão de horário só faz sentido ao recusar.')
    }
    proposta = new Date(input.proposedStartsAt)
    if (Number.isNaN(proposta.getTime())) throw new OneOnOneError('Horário sugerido inválido.')
    if (proposta.getTime() === meeting.startsAt.getTime()) {
      throw new OneOnOneError('O horário sugerido é o mesmo que já estava marcado.')
    }
  }
  const nota = input.declineNote?.trim() || null
  if (nota && nota.length > ONE_ON_ONE_DECLINE_NOTE_MAX_LENGTH) {
    throw new OneOnOneError(`O motivo deve ter no máximo ${ONE_ON_ONE_DECLINE_NOTE_MAX_LENGTH} caracteres.`)
  }

  await aplicarResposta(viewer, meeting, scope, input.response, {
    proposedStartsAt: proposta,
    declineNote: nota,
  })

  await notifyOneOnOneResponded({
    userId: meeting.series.createdById,
    actorId: viewer.userId,
    actorName: viewerSideOf(meeting.series, viewer.userId).name,
    meetingId: meeting.id,
    accepted: input.response === 'ACCEPTED',
    startsAt: meeting.startsAt,
    proposedStartsAt: proposta,
    companyId: viewer.companyId,
  })

  avisarPar(meeting.series, { type: 'agenda:changed' })
  return recarregarResumo(viewer, meeting.id)
}

/**
 * Quem marcou aceita a sugestão. Remarca (com escopo) e grava `ACCEPTED` na
 * sequência: quem propôs o horário já concordou com ele, e pedir um aceite
 * depois seria pedir duas vezes a mesma coisa.
 *
 * Com `future`, o deslocamento vale para as seguintes — é o `rescheduleMeeting`
 * que já existe, então a série quinzenal de terça vira quinzenal de quinta sem
 * máquina nova. É o que resolve numa rodada só o caso que mais geraria ida e
 * volta: "esse dia da semana não funciona para mim".
 */
export async function acceptProposal(
  viewer: OneOnOneViewer,
  meetingId: string,
  scope: OneOnOneScope,
): Promise<OneOnOneMeetingSummaryDTO> {
  const meeting = await findParticipantMeeting(viewer, meetingId)
  assertMeetingActionable(meeting, { CANCELED: 'Este 1:1 foi cancelado.', DONE: 'Este 1:1 já aconteceu.' })
  assertIsCreator(meeting, viewer)
  if (!meeting.proposedStartsAt) throw new OneOnOneError('Não há sugestão de horário neste 1:1.')

  const proposta = meeting.proposedStartsAt
  await rescheduleMeeting(
    viewer,
    meetingId,
    {
      date: ymdInSaoPaulo(proposta),
      startTime: hhmmInSaoPaulo(proposta),
      durationMinutes: duracaoEmMinutos(meeting),
    },
    scope,
  )
  // Depois do remarcar, e não antes: ele devolve tudo para `PENDING`. E sobre o
  // encontro RECARREGADO — o recorte "esta e as seguintes" precisa do horário
  // novo, que é onde as ocorrências estão agora.
  await aplicarResposta(viewer, await findParticipantMeeting(viewer, meetingId), scope, 'ACCEPTED')

  await notifyOneOnOneProposalDecided({
    userId: counterpartIdOf(meeting.series, viewer.userId),
    actorId: viewer.userId,
    actorName: viewerSideOf(meeting.series, viewer.userId).name,
    meetingId: meeting.id,
    accepted: true,
    companyId: viewer.companyId,
  })

  avisarPar(meeting.series, { type: 'agenda:changed' })
  return recarregarResumo(viewer, meeting.id)
}

/**
 * Quem marcou descarta a sugestão: o horário fica como estava e o convite volta
 * a `PENDING`. Não é uma recusa da recusa — é devolver a bola, e quem marcou
 * segue livre para remarcar por conta própria ou cancelar.
 */
export async function declineProposal(
  viewer: OneOnOneViewer,
  meetingId: string,
): Promise<OneOnOneMeetingSummaryDTO> {
  const meeting = await findParticipantMeeting(viewer, meetingId)
  assertMeetingActionable(meeting, { CANCELED: 'Este 1:1 foi cancelado.', DONE: 'Este 1:1 já aconteceu.' })
  assertIsCreator(meeting, viewer)
  if (!meeting.proposedStartsAt) throw new OneOnOneError('Não há sugestão de horário neste 1:1.')

  await aplicarResposta(viewer, meeting, 'this', 'PENDING')

  await notifyOneOnOneProposalDecided({
    userId: counterpartIdOf(meeting.series, viewer.userId),
    actorId: viewer.userId,
    actorName: viewerSideOf(meeting.series, viewer.userId).name,
    meetingId: meeting.id,
    accepted: false,
    companyId: viewer.companyId,
  })

  avisarPar(meeting.series, { type: 'agenda:changed' })
  return recarregarResumo(viewer, meeting.id)
}

/** O resumo já com a resposta efetiva recalculada — as três operações devolvem isso. */
async function recarregarResumo(
  viewer: OneOnOneViewer,
  meetingId: string,
): Promise<OneOnOneMeetingSummaryDTO> {
  const atual = await findParticipantMeeting(viewer, meetingId)
  return toOneOnOneMeetingSummary(atual, viewer.userId, await countOpenActions(viewer, atual.series))
}

export async function markMeetingDone(
  viewer: OneOnOneViewer,
  meetingId: string,
): Promise<OneOnOneMeetingSummaryDTO> {
  const atual = await findParticipantMeeting(viewer, meetingId)
  // Só CANCELED barra: marcar como feito um encontro já DONE é idempotente, não
  // um erro — diferente de remarcar/cancelar, aqui não há estado a "desfazer".
  assertMeetingActionable(atual, { CANCELED: 'Este 1:1 foi cancelado.' })
  const meeting = await scopedPrisma(viewer.companyId).oneOnOneMeeting.update({
    where: { id: meetingId },
    data: { status: 'DONE' },
    include: SERIES_INCLUDE,
  })
  const abertas = await countOpenActions(viewer, meeting.series)
  avisarPar(meeting.series, { type: 'agenda:changed' })
  return toOneOnOneMeetingSummary(meeting, viewer.userId, abertas)
}

/**
 * Promove o combinado do 1:1 a ação de PDI. Um dono só, um status só: a ação
 * daqui vira `PROMOTED` e sai dos pendentes, porque a cobrança passa a ser do
 * PDI — onde já existe validação do líder.
 */
export async function promoteActionToPdi(
  viewer: OneOnOneViewer,
  actionId: string,
): Promise<OneOnOneActionDTO> {
  const db = scopedPrisma(viewer.companyId)
  const acao = await findParticipantAction(viewer, actionId)
  if (acao.status === 'PROMOTED') throw new OneOnOneError('Esta ação já está no PDI.', 409)
  if (acao.status === 'DONE') throw new OneOnOneError('Esta ação já foi concluída.', 409)

  // O plano precisa ser o DO PAR — o mesmo que faz o bloco de PDI aparecer no
  // DTO. Procurar "qualquer plano ativo do viewer" deixava um POST direto no
  // endpoint jogar o combinado com Bruno no plano que Ana tem com a Carla, e
  // conteúdo do 1:1 passava a ser lido por quem não estava na conversa.
  const plan = await db.pdiPlan.findFirst({
    where: pairPlanWhere(acao.series, viewer.userId),
    orderBy: { updatedAt: 'desc' },
  })
  if (!plan) {
    throw new OneOnOneError('Você ainda não tem um plano de PDI ativo com esta pessoa.', 400)
  }
  // O plano é da pessoa: o líder não escreve no plano do liderado nem por aqui.
  if (plan.userId !== viewer.userId) {
    throw new OneOnOneError('Só a própria pessoa adiciona ações ao PDI dela.', 403)
  }

  const pdiAction = await db.pdiAction.create({
    data: {
      planId: plan.id,
      description: acao.description,
      type: 'OTHER',
      priority: 'MEDIUM',
      dueDate: acao.dueDate,
      companyId: viewer.companyId,
    },
  })
  await db.pdiActionHistory.create({
    data: {
      actionId: pdiAction.id,
      eventType: 'CREATED',
      actorId: viewer.userId,
      metadata: { origem: 'one-on-one', oneOnOneActionId: acao.id },
      companyId: viewer.companyId,
    },
  })

  const atualizada = await db.oneOnOneAction.update({
    where: { id: actionId },
    data: { status: 'PROMOTED', promotedPdiActionId: pdiAction.id },
    include: { owner: true },
  })
  // Dois avisos porque mexeu em dois lugares da tela: o combinado saiu dos
  // pendentes e o plano ganhou uma ação.
  avisarPar(acao.series, { type: 'actions:changed' })
  avisarPar(acao.series, { type: 'pdi:changed' })
  return toOneOnOneActionDTO(atualizada)
}

/**
 * Combinados já concluídos, para a seção do PERFIL.
 *
 * O recorte é a promessa de privacidade da feature levada ao perfil: quem olha
 * só enxerga os combinados dos 1:1 de que ELE participou. No próprio perfil,
 * isso é tudo que a pessoa combinou com qualquer colega; no perfil de outra
 * pessoa, só o que os dois combinaram entre si. Nenhum terceiro lê o combinado
 * de uma conversa que não foi dele — mesmo sendo ADMIN.
 */
export async function listCompletedActionsForProfile(
  viewer: OneOnOneViewer,
  profileUserId: string,
): Promise<OneOnOneCompletedActionDTO[]> {
  const db = scopedPrisma(viewer.companyId)
  const doProprioPerfil = profileUserId === viewer.userId
  const acoes = await db.oneOnOneAction.findMany({
    where: {
      status: { in: ['DONE', 'PROMOTED'] },
      series: doProprioPerfil
        ? { OR: [{ userAId: viewer.userId }, { userBId: viewer.userId }] }
        : normalizeOneOnOnePair(viewer.userId, profileUserId),
    },
    include: { owner: true, series: { include: { userA: true, userB: true } } },
    orderBy: [{ completedAt: 'desc' }, { updatedAt: 'desc' }],
  })

  return acoes.map((acao) => ({
    id: acao.id,
    description: acao.description,
    owner: toOneOnOnePersonDTO(acao.owner),
    counterpart: toOneOnOnePersonDTO(counterpartOf(acao.series, viewer.userId)),
    completedAt: acao.completedAt ? acao.completedAt.toISOString() : null,
    meetingId: acao.createdInMeetingId,
    pdiActionId: acao.promotedPdiActionId,
  }))
}

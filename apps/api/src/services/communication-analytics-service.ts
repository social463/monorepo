import type {
  BestSendTimeDTO,
  CommunicationOverviewDTO,
  CommunicationSeriesPointDTO,
  LowReachSectorDTO,
  ReactionSliceDTO,
  SectorReachDTO,
  TopPostDTO,
} from '@legends/shared'
import { BEST_SEND_TIME_MIN_POSTS, LEADER_ROLES, LOW_REACH_ALERT_DAYS } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'
import { hourInSaoPaulo, ymdInSaoPaulo } from '../lib/sao-paulo-date'
import { resolveWindow, type AnalyticsScope } from './people-analytics-service'

/** Quantos comunicados o Top entrega. O documento pede cinco. */
const TOP_POSTS_LIMIT = 5

/**
 * Quantos emojis distintos a rosca mostra antes de agrupar em "outras".
 *
 * O catálogo do mural tem 17 reações; desenhar as 17 faria uma roda de fatias de
 * 1% em que nada se lê. Seis é o que ainda dá para distinguir de relance.
 */
const REACTION_SLICES = 6

/** Papéis que não contam como público do Feed — mesma regra de `getPostReach`. */
const AUDIENCE_WHERE = { active: true, role: { not: 'THIRD_PARTY' as const } }

function toExcerpt(text: string, max = 80): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/**
 * Painel de Comunicação Interna (Documento 3, seção 4.8).
 *
 * A telemetria que o documento pede para instrumentar **já existe**:
 * `CorporatePostRead` grava quem leu cada comunicado desde antes deste lote, e é
 * dela que sai toda a taxa de leitura daqui — inclusive retroativamente.
 *
 * O denominador de alcance é **por post**, e não a empresa inteira: com
 * público-alvo por setor, "12 de 48" num comunicado que só 8 pessoas podiam ler
 * seria mentira. É o mesmo critério de `getPostReach`.
 */
export async function getCommunicationOverview(
  scope: AnalyticsScope & { tagId?: string | null },
): Promise<CommunicationOverviewDTO> {
  const now = scope.now ?? new Date()
  const window = resolveWindow(scope.window, now)
  const db = scopedPrisma(scope.companyId)
  const inWindow = { gte: window.since, lt: window.until }

  const postWhere = {
    status: 'PUBLISHED' as const,
    createdAt: inWindow,
    ...(scope.tagId ? { tagId: scope.tagId } : {}),
    // Filtro de setor do painel = comunicados dirigidos àquele setor. Os de
    // público ALL entram junto: eles alcançam o setor também, e escondê-los
    // faria o alcance do recorte parecer menor do que é.
    ...(scope.sectorId
      ? {
          OR: [
            { audienceScope: 'ALL' as const },
            // O comunicado da liderança alcança gente daquele setor, então ele
            // entra no recorte pelo mesmo motivo que o de público ALL entra.
            { audienceScope: 'LEADERS' as const },
            { sectors: { some: { sectorId: scope.sectorId } } },
          ],
        }
      : {}),
  }

  const [posts, sectors, peopleBySector, totalAudience, leaderAudience, pointsAgg, reactionRows] =
    await Promise.all([
      db.corporatePost.findMany({
        where: postWhere,
        select: {
          id: true,
          title: true,
          content: true,
          createdAt: true,
          audienceScope: true,
          sectors: { select: { sectorId: true } },
          reads: { select: { readAt: true, user: { select: { id: true, sectorId: true } } } },
          _count: { select: { comments: true, reactions: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      db.sector.findMany({ where: { active: true }, select: { id: true, name: true } }),
      db.user.groupBy({ by: ['sectorId'], where: AUDIENCE_WHERE, _count: { _all: true } }),
      db.user.count({ where: AUDIENCE_WHERE }),
      // Base do comunicado dirigido à liderança: medido contra a empresa toda, um
      // post lido por TODOS os líderes marcaria ~10% de alcance.
      db.user.count({ where: { ...AUDIENCE_WHERE, role: { in: [...LEADER_ROLES] } } }),
      // Pontos, e NÃO coins: `CoinEvent` não tem evento de mural — ver o DTO.
      db.xpTransaction.aggregate({
        where: {
          createdAt: inWindow,
          event: { in: ['CORPORATE_POST_REACTION', 'CORPORATE_POST_COMMENT', 'CORPORATE_POST_READ_FULL'] },
          ...(scope.sectorId ? { user: { sectorId: scope.sectorId } } : {}),
        },
        _sum: { amount: true },
      }),
      db.corporatePostReaction.groupBy({
        by: ['emoji'],
        where: { post: postWhere },
        _count: { _all: true },
      }),
    ])

  const audienceBySector = new Map(peopleBySector.map((row) => [row.sectorId, row._count._all]))
  const audienceOf = (post: (typeof posts)[number]) =>
    post.audienceScope === 'ALL'
      ? totalAudience
      : post.audienceScope === 'LEADERS'
        ? leaderAudience
        : post.sectors.reduce((sum, s) => sum + (audienceBySector.get(s.sectorId) ?? 0), 0)

  const readPctOf = (post: (typeof posts)[number]) => {
    const audience = audienceOf(post)
    return audience > 0 ? Math.round((post.reads.length / audience) * 1000) / 10 : 0
  }

  const toTopPost = (post: (typeof posts)[number]): TopPostDTO => ({
    postId: post.id,
    excerpt: toExcerpt(post.title ? `${post.title} — ${post.content}` : post.content),
    createdAt: post.createdAt.toISOString(),
    reads: post.reads.length,
    reactions: post._count.reactions,
    comments: post._count.comments,
    readPct: readPctOf(post),
  })

  // ── KPIs
  const averageReadPct =
    posts.length > 0
      ? Math.round((posts.reduce((sum, post) => sum + readPctOf(post), 0) / posts.length) * 10) / 10
      : 0
  const totalEngagement = posts.reduce((sum, p) => sum + p._count.reactions + p._count.comments, 0)
  const mostRead = posts.length
    ? toTopPost([...posts].sort((a, b) => readPctOf(b) - readPctOf(a))[0]!)
    : null

  // ── série diária: leituras e interações
  const readsByDay = new Map<string, number>()
  for (const post of posts) {
    for (const read of post.reads) {
      const day = ymdInSaoPaulo(read.readAt)
      readsByDay.set(day, (readsByDay.get(day) ?? 0) + 1)
    }
  }
  // Interações entram no dia do COMUNICADO, não no da reação: a reação não tem
  // recorte de janela própria aqui, e misturar as duas datas faria a série somar
  // interação de post que está fora do recorte.
  const interactionsByDay = new Map<string, number>()
  for (const post of posts) {
    const day = ymdInSaoPaulo(post.createdAt)
    interactionsByDay.set(day, (interactionsByDay.get(day) ?? 0) + post._count.reactions + post._count.comments)
  }
  const series: CommunicationSeriesPointDTO[] = window.days.map((day) => ({
    day,
    reads: readsByDay.get(day) ?? 0,
    interactions: interactionsByDay.get(day) ?? 0,
  }))

  // ── alcance por setor
  //
  // "Percentual de colaboradores de cada área que abriram e leram os
  // comunicados" — o pedido literal da seção. O numerador é de PESSOAS
  // distintas que leram ao menos um comunicado da janela, não de leituras:
  // contar leituras faria um setor de duas pessoas muito engajadas passar de
  // 100%, e a pergunta ("quem está desengajado") deixaria de ter resposta.
  const readersBySector = new Map<string, Set<string>>()
  for (const post of posts) {
    for (const read of post.reads) {
      const sectorId = read.user.sectorId
      if (!readersBySector.has(sectorId)) readersBySector.set(sectorId, new Set())
      readersBySector.get(sectorId)!.add(read.user.id)
    }
  }
  const bySector: SectorReachDTO[] = sectors
    .map((sector) => {
      const people = audienceBySector.get(sector.id) ?? 0
      const readers = readersBySector.get(sector.id)?.size ?? 0
      return {
        sectorId: sector.id,
        sectorName: sector.name,
        people,
        readers,
        reachPct: people > 0 ? Math.round((readers / people) * 100) : 0,
      }
    })
    .sort((a, b) => b.reachPct - a.reachPct || a.sectorName.localeCompare(b.sectorName, 'pt-BR'))

  // ── rosca de reações
  const ordered = [...reactionRows].sort((a, b) => b._count._all - a._count._all)
  const reactions: ReactionSliceDTO[] = ordered.slice(0, REACTION_SLICES).map((row) => ({
    key: row.emoji,
    label: row.emoji,
    count: row._count._all,
  }))
  const rest = ordered.slice(REACTION_SLICES).reduce((sum, row) => sum + row._count._all, 0)
  if (rest > 0) reactions.push({ key: 'outras', label: 'outras', count: rest })

  // ── Top 5 por engajamento
  const topPosts = [...posts]
    .sort(
      (a, b) =>
        b.reads.length + b._count.reactions + b._count.comments -
        (a.reads.length + a._count.reactions + a._count.comments),
    )
    .slice(0, TOP_POSTS_LIMIT)
    .map(toTopPost)

  return {
    from: window.days[0]!,
    to: window.days[window.days.length - 1]!,
    days: window.days.length,
    sectorId: scope.sectorId,
    tagId: scope.tagId ?? null,
    averageReadPct,
    totalEngagement,
    postsPublished: posts.length,
    mostRead,
    pointsAwarded: pointsAgg._sum.amount ?? 0,
    series,
    bySector,
    reactions,
    topPosts,
    bestSendTime: computeBestSendTime(posts.map((p) => ({ at: p.createdAt, readPct: readPctOf(p) }))),
    lowReachSectors: await computeLowReachSectors(scope.companyId, sectors, now),
  }
}

/**
 * "Melhor horário de envio": o par (dia da semana, hora) com maior taxa média de
 * leitura, medido no fuso de São Paulo.
 *
 * Exige `BEST_SEND_TIME_MIN_POSTS` comunicados na mesma combinação. Sem esse
 * piso, o "melhor horário" seria a taxa de um post só — e a G&G passaria a
 * agendar comunicado com base em ruído.
 */
export function computeBestSendTime(posts: { at: Date; readPct: number }[]): BestSendTimeDTO | null {
  const buckets = new Map<string, { weekday: number; hour: number; total: number; count: number }>()
  for (const post of posts) {
    // `getDay` no fuso certo: um post das 22h de SP é 01h UTC do dia seguinte, e
    // o dia da semana viraria junto.
    const hour = hourInSaoPaulo(post.at)
    const weekday = new Date(`${ymdInSaoPaulo(post.at)}T12:00:00.000Z`).getUTCDay()
    const key = `${weekday}:${hour}`
    const bucket = buckets.get(key) ?? { weekday, hour, total: 0, count: 0 }
    bucket.total += post.readPct
    bucket.count += 1
    buckets.set(key, bucket)
  }
  const elegiveis = [...buckets.values()].filter((b) => b.count >= BEST_SEND_TIME_MIN_POSTS)
  if (elegiveis.length === 0) return null
  const melhor = elegiveis.sort((a, b) => b.total / b.count - a.total / a.count)[0]!
  return {
    weekday: melhor.weekday,
    hour: melhor.hour,
    readPct: Math.round((melhor.total / melhor.count) * 10) / 10,
    posts: melhor.count,
  }
}

/**
 * Setores sem leitura, reação ou comentário de comunicado há mais de
 * `LOW_REACH_ALERT_DAYS` dias — o alerta que a seção 4.8 pede.
 *
 * A janela do painel **não** entra aqui de propósito: o alerta pergunta "há
 * quanto tempo esse setor sumiu", e recortá-lo pelo filtro da tela faria todo
 * setor parecer sumido sempre que alguém escolhesse "Hoje".
 */
async function computeLowReachSectors(
  companyId: string,
  sectors: { id: string; name: string }[],
  now: Date,
): Promise<LowReachSectorDTO[]> {
  const rows = await prisma.$queryRaw<{ sectorId: string; lastAt: Date | null }[]>`
    SELECT u."sectorId" AS "sectorId", MAX(i."at") AS "lastAt"
    FROM "User" u
    LEFT JOIN (
      SELECT "userId", "readAt" AS at FROM "CorporatePostRead" WHERE "companyId" = ${companyId}
      UNION ALL
      SELECT "userId", "createdAt" AS at FROM "CorporatePostReaction" WHERE "companyId" = ${companyId}
      UNION ALL
      SELECT "authorId" AS "userId", "createdAt" AS at FROM "CorporatePostComment" WHERE "companyId" = ${companyId}
    ) i ON i."userId" = u."id"
    WHERE u."companyId" = ${companyId} AND u."active" = true AND u."role" <> 'THIRD_PARTY'
    GROUP BY u."sectorId"
  `
  const lastBySector = new Map(rows.map((row) => [row.sectorId, row.lastAt]))
  const limite = LOW_REACH_ALERT_DAYS * 86_400_000

  return sectors
    .map((sector) => {
      const last = lastBySector.get(sector.id) ?? null
      return {
        sectorId: sector.id,
        sectorName: sector.name,
        daysSince: last ? Math.floor((now.getTime() - last.getTime()) / 86_400_000) : null,
      }
    })
    // `null` (nunca interagiu) entra no alerta: é o caso mais grave, não o mais
    // brando — e um `daysSince` inventado esconderia isso.
    .filter((row) => row.daysSince === null || row.daysSince * 86_400_000 > limite)
    .sort((a, b) => (b.daysSince ?? Infinity) - (a.daysSince ?? Infinity))
}

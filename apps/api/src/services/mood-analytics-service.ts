import type {
  MoodCommentDTO,
  MoodDistributionSliceDTO,
  MoodLevel,
  MoodOverviewDTO,
  MoodReason,
  MoodReasonSliceDTO,
  MoodTrendPointDTO,
} from '@legends/shared'
import {
  MOOD_ANONYMITY_MIN,
  MOOD_LEVELS,
  MOOD_SCORES,
  NEGATIVE_MOOD_LEVELS,
} from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'
import { toPublicUser } from '../lib/serialize'
import { addDays, dayFromYmd, todayInSaoPaulo, ymdInSaoPaulo, ymdOf } from '../lib/sao-paulo-date'

export class MoodOverviewError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'MoodOverviewError'
  }
}

/** Janela padrão quando a rota não recebe `days` nem `from`/`to`. O piso e o
 * teto vivem em `@legends/shared` — a tela precisa deles para não oferecer um
 * recorte que a rota recusa. */
export const MOOD_OVERVIEW_DEFAULT_DAYS = 30

/** Teto de comentários devolvidos por consulta — a lista é um recorte recente, não um export. */
const COMMENT_LIMIT = 50

/**
 * Papéis que nunca registram humor (não têm o card no perfil). Ficam de fora do
 * denominador da participação para não afundar o percentual artificialmente.
 */
const NON_RESPONDING_ROLES = ['ADMIN', 'SUBADMIN', 'SUPER_ADMIN'] as const

export interface MoodOverviewParams {
  companyId: string
  /** Papel de quem consulta: SUBADMIN fica preso ao próprio setor. */
  viewerRole: string
  viewerSectorId: string
  days?: number
  /**
   * Período personalizado (datas civis `YYYY-MM-DD`), vindo do mesmo filtro da
   * tela de People Analytics. Quando os dois vêm preenchidos, ganham de `days`.
   */
  from?: string
  to?: string
  /** Setor pedido no filtro; undefined/null = empresa inteira (só ADMIN). */
  sectorId?: string | null
  /** Injetável nos testes para fixar "hoje". */
  now?: Date
}

/**
 * Resolve o setor do recorte conforme o papel:
 * - SUBADMIN: sempre o próprio setor. Pedir outro explicitamente é 403 —
 *   e não um recorte silenciosamente trocado, que confundiria quem consulta.
 * - ADMIN (e demais que passem pelo requireAdminOrSubadmin): o filtro pedido,
 *   ou a empresa inteira quando nenhum setor é informado.
 */
function resolveSectorId(params: MoodOverviewParams): string | null {
  if (params.viewerRole === 'SUBADMIN') {
    if (params.sectorId && params.sectorId !== params.viewerSectorId) {
      throw new MoodOverviewError('Acesso restrito ao seu setor.', 403)
    }
    return params.viewerSectorId
  }
  return params.sectorId ?? null
}

/** Recorte vazio — devolvido quando a janela inteira fica abaixo do piso de anonimato. */
function emptyOverview(days: number, sectorId: string | null, trendDays: string[]): MoodOverviewDTO {
  return {
    days,
    sectorId,
    weekAverage: null,
    participationToday: null,
    totalEntries: 0,
    trend: trendDays.map((day) => ({ day, average: null, count: 0, suppressed: false })),
    todayDistribution: [],
    reasons: [],
    alertComments: [],
    comments: [],
  }
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100
}

function percentOf(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0
}

/**
 * Painel agregado de clima. Nenhuma consulta aqui seleciona `userId`: o DTO é
 * anônimo por construção, não por omissão na UI. Todo recorte com menos de
 * `MOOD_ANONYMITY_MIN` respostas sai suprimido.
 *
 * Desde 08/09/2026 esse piso vale 1, a pedido da G&G: na prática nada é
 * suprimido, e um único registro no dia já aparece na série e na distribuição.
 * Os `if` abaixo continuam aqui de propósito — são eles que voltam a valer
 * quando o piso subir, e apagá-los custaria reescrever a função inteira.
 */
export async function getMoodOverview(params: MoodOverviewParams): Promise<MoodOverviewDTO> {
  const sectorId = resolveSectorId(params)
  const db = scopedPrisma(params.companyId)

  // Todo recorte de dia é a data civil de São Paulo — quem registra às 23h de
  // SP conta no dia de SP, não no dia UTC que já virou.
  const todayYmd = params.now ? ymdInSaoPaulo(params.now) : todayInSaoPaulo().ymd
  // Janela personalizada ganha de `days` quando as duas pontas vêm (seção 4.6).
  // O fim é limitado a hoje: "participação de hoje" e "distribuição de hoje" não
  // teriam sentido numa janela que termina no futuro.
  const custom = params.from && params.to && params.from <= params.to
  const endYmd = custom ? (params.to! < todayYmd ? params.to! : todayYmd) : todayYmd
  const startYmd = custom
    ? params.from!
    : addDays(endYmd, -((params.days ?? MOOD_OVERVIEW_DEFAULT_DAYS) - 1))
  const windowDays: string[] = []
  for (let ymd = startYmd; ymd <= endYmd; ymd = addDays(ymd, 1)) windowDays.push(ymd)
  const days = windowDays.length

  const userScope = sectorId ? { user: { sectorId } } : {}
  const windowWhere = { day: { gte: dayFromYmd(startYmd), lte: dayFromYmd(endYmd) }, ...userScope }

  // Uma passada só: contagem por (dia, humor) alimenta tendência, média da
  // semana e distribuição de hoje.
  const byDayAndMood = await db.moodEntry.groupBy({
    by: ['day', 'mood'],
    where: windowWhere,
    _count: { _all: true },
  })

  const totalsByDay = new Map<string, { count: number; score: number }>()
  const moodCountsByDay = new Map<string, Map<MoodLevel, number>>()
  for (const row of byDayAndMood) {
    const ymd = ymdOf(row.day)
    const count = row._count._all
    const mood = row.mood as MoodLevel
    const totals = totalsByDay.get(ymd) ?? { count: 0, score: 0 }
    totals.count += count
    totals.score += count * MOOD_SCORES[mood]
    totalsByDay.set(ymd, totals)
    const moods = moodCountsByDay.get(ymd) ?? new Map<MoodLevel, number>()
    moods.set(mood, (moods.get(mood) ?? 0) + count)
    moodCountsByDay.set(ymd, moods)
  }

  const totalEntries = [...totalsByDay.values()].reduce((sum, t) => sum + t.count, 0)
  if (totalEntries < MOOD_ANONYMITY_MIN) return emptyOverview(days, sectorId, windowDays)

  const trend: MoodTrendPointDTO[] = windowDays.map((day) => {
    const totals = totalsByDay.get(day)
    if (!totals) return { day, average: null, count: 0, suppressed: false }
    // Dia com registro mas abaixo do piso: nem a média nem a contagem saem.
    if (totals.count < MOOD_ANONYMITY_MIN) return { day, average: null, count: 0, suppressed: true }
    return { day, average: roundToTwo(totals.score / totals.count), count: totals.count, suppressed: false }
  })

  // Média de 7 dias ponderada pelo nº de registros de cada dia (soma das notas
  // ÷ total de registros) — média de médias daria peso igual a um dia com 1
  // registro e a um com 40. Dia sem registro simplesmente não entra na conta.
  const weekYmds = new Set(windowDays.slice(-7))
  let weekScore = 0
  let weekCount = 0
  for (const [ymd, totals] of totalsByDay) {
    if (!weekYmds.has(ymd)) continue
    weekScore += totals.score
    weekCount += totals.count
  }
  const weekAverage = weekCount >= MOOD_ANONYMITY_MIN ? roundToTwo(weekScore / weekCount) : null

  const todayTotals = totalsByDay.get(todayYmd)
  const todayCount = todayTotals?.count ?? 0
  const todayMeetsFloor = todayCount >= MOOD_ANONYMITY_MIN

  let participationToday: MoodOverviewDTO['participationToday'] = null
  let todayDistribution: MoodDistributionSliceDTO[] = []
  if (todayMeetsFloor) {
    const eligible = await db.user.count({
      where: {
        active: true,
        leftAt: null,
        role: { notIn: [...NON_RESPONDING_ROLES] },
        ...(sectorId ? { sectorId } : {}),
      },
    })
    participationToday = {
      responded: todayCount,
      total: eligible,
      percent: percentOf(todayCount, eligible),
    }
    const moods = moodCountsByDay.get(todayYmd) ?? new Map<MoodLevel, number>()
    todayDistribution = MOOD_LEVELS.map((mood) => {
      const count = moods.get(mood) ?? 0
      return { mood, count, percent: percentOf(count, todayCount) }
    })
  }

  // Ranking de motivos entre os registros negativos da janela.
  const negativeWhere = { ...windowWhere, mood: { in: [...NEGATIVE_MOOD_LEVELS] } }
  const byReason = await db.moodEntry.groupBy({
    by: ['reason'],
    where: negativeWhere,
    _count: { _all: true },
  })
  const negativeTotal = byReason.reduce((sum, row) => sum + row._count._all, 0)
  const reasons: MoodReasonSliceDTO[] =
    negativeTotal >= MOOD_ANONYMITY_MIN
      ? byReason
          .map((row) => ({
            reason: (row.reason as MoodReason | null) ?? null,
            count: row._count._all,
            percent: percentOf(row._count._all, negativeTotal),
          }))
          .sort((a, b) => b.count - a.count)
      : []

  // Duas caixas (seção 4.6): "Causas de alerta" traz só o humor negativo,
  // "Comentários" traz a escala inteira. Uma consulta só, da escala inteira, e a
  // Caixa 1 é recorte dela — buscar duas vezes leria as mesmas linhas.
  //
  // O comentário sai IDENTIFICADO. O piso de anonimato deixou de filtrá-lo: ele
  // existia para o comentário não ser atribuível por dedução, e não faz sentido
  // esconder por dedução o que agora vem com nome. O piso continua valendo para
  // os agregados, acima.
  const commentRows = await db.moodEntry.findMany({
    where: { ...windowWhere, note: { not: null } },
    select: { id: true, day: true, mood: true, reason: true, note: true, user: true },
    orderBy: [{ day: 'desc' }, { createdAt: 'desc' }],
    take: COMMENT_LIMIT,
  })
  const todayDate = dayFromYmd(todayYmd)
  const comments: MoodCommentDTO[] = commentRows.map((row) => ({
    id: row.id,
    day: ymdOf(row.day),
    daysAgo: Math.round((todayDate.getTime() - row.day.getTime()) / 86_400_000),
    mood: row.mood as MoodLevel,
    reason: (row.reason as MoodReason | null) ?? null,
    note: row.note as string,
    author: toPublicUser(row.user),
  }))
  const negativeLevels = new Set<MoodLevel>(NEGATIVE_MOOD_LEVELS)
  const alertComments = comments.filter((comment) => negativeLevels.has(comment.mood))

  return {
    days,
    sectorId,
    weekAverage,
    participationToday,
    totalEntries,
    trend,
    todayDistribution,
    reasons,
    alertComments,
    comments,
  }
}

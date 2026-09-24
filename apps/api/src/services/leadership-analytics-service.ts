import type { LeadershipOverviewDTO, PeopleAnalyticsRange, TeamMemberScoreDTO } from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'
import { addDays, dayFromYmd } from '../lib/sao-paulo-date'
import { listManagedGroups } from './team-scope-service'
import { loadMoodSummary, loadTopScreens, resolveWindow } from './people-analytics-service'
import { getXpPointsForUsers } from './xp-service'

/**
 * Indicadores do time para a página de Liderança.
 *
 * É o People Analytics com outra audiência: clima e telas saem das MESMAS
 * agregações (`loadMoodSummary`, `loadTopScreens`), só que recortadas pela
 * lista de liderados em vez de por setor. Duplicar as consultas aqui deixaria
 * "humor médio" com duas definições no produto.
 *
 * Quem não lidera ninguém (ADMIN, Gente e Gestão) recebe o payload zerado em
 * vez de 403: a página é aberta a eles, e a aba simplesmente fica vazia.
 */

export interface LeadershipAnalyticsScope {
  viewerId: string
  companyId: string
  range: PeopleAnalyticsRange
  /** Instante de referência; injetável nos testes. */
  now?: Date
}

/** Liderados distintos do viewer — uma pessoa em duas squads conta uma vez. */
async function listLedMembers(viewerId: string): Promise<{ id: string; name: string }[]> {
  const groups = await listManagedGroups(viewerId)
  const byId = new Map<string, { id: string; name: string }>()
  for (const group of groups) {
    for (const member of group.members) byId.set(member.id, { id: member.id, name: member.name })
  }
  return [...byId.values()]
}

export async function getLeadershipOverview(scope: LeadershipAnalyticsScope): Promise<LeadershipOverviewDTO> {
  const now = scope.now ?? new Date()
  const { companyId, range } = scope
  // A Liderança segue com os atalhos: o filtro personalizável é da tela de
  // People Analytics (Documento 3, seção 4.1), e nada foi pedido aqui.
  const window = resolveWindow({ range }, now)
  const db = scopedPrisma(companyId)

  const members = await listLedMembers(scope.viewerId)
  const memberIds = members.map((member) => member.id)
  const audience = { kind: 'users', userIds: memberIds } as const
  const inWindow = { gte: window.since, lt: window.until }
  // XP tem coluna `day` (@db.Date), como o humor: o recorte é por dia civil,
  // não pelos instantes UTC usados nas tabelas com `createdAt`.
  const xpWindow = {
    gte: dayFromYmd(window.days[0]),
    lt: dayFromYmd(addDays(window.days[window.days.length - 1], 1)),
  }

  // Time vazio não precisa de atalho: `in: []` e o filtro `FALSE` do SQL já
  // devolvem tudo zerado, com a mesma forma de payload.
  const [mood, topScreens, written, received, xpByUser] = await Promise.all([
    loadMoodSummary(companyId, audience, window),
    loadTopScreens(companyId, audience, window),
    db.feedback.count({ where: { createdAt: inWindow, authorId: { in: memberIds } } }),
    db.feedback.count({ where: { createdAt: inWindow, targetId: { in: memberIds } } }),
    getXpPointsForUsers(memberIds, companyId, xpWindow),
  ])

  const perPerson: TeamMemberScoreDTO[] = members
    .map((member) => ({ userId: member.id, name: member.name, points: xpByUser.get(member.id) ?? 0 }))
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'pt-BR'))
  const totalPoints = perPerson.reduce((total, member) => total + member.points, 0)

  return {
    range,
    teamSize: members.length,
    mood,
    feedbacks: { written, received },
    topScreens,
    scores: {
      average: members.length > 0 ? Math.round(totalPoints / members.length) : 0,
      perPerson,
    },
  }
}

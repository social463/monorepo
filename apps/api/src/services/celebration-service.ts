import { UPCOMING_CELEBRATION_WINDOW_DAYS, type CelebrationKind } from '@legends/shared'
import type {
  BirthdayDTO,
  CelebrationsResponse,
  UpcomingBirthdayDTO,
  UpcomingWorkAnniversaryDTO,
  WorkAnniversaryDTO,
} from '@legends/shared'
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'
import { toPublicUser } from '../lib/serialize'
import { sectorNamesFor } from '../lib/sector-features'
import { ymdInSaoPaulo } from '../lib/sao-paulo-date'
import { civilDayMonth, daysBetween, observedDay, occurrenceYmd } from '../lib/celebration-date'
import { countGreetingsForToday } from './birthday-greeting-service'

/**
 * Próxima ocorrência de um aniversário de nascimento a partir de `referenceDay`
 * (hoje conta como ocorrência válida — `daysUntil` pode ser 0). Se a data deste
 * ano já passou, cai no ano seguinte (recalculando 29/02 para o novo ano).
 */
function nextBirthdayOccurrence(
  month: number,
  day: number,
  referenceDay: string,
): { observedYmd: string; daysUntil: number } {
  const refYear = Number(referenceDay.slice(0, 4))
  let observedYmd = occurrenceYmd(month, day, refYear)
  if (observedYmd < referenceDay) observedYmd = occurrenceYmd(month, day, refYear + 1)
  return { observedYmd, daysUntil: daysBetween(referenceDay, observedYmd) }
}

/**
 * Próximo aniversário de casa a partir de `referenceDay`. Igual à ocorrência de
 * nascimento, mas pula a ocorrência deste ano quando ela ainda somaria 0 anos
 * (quem entrou neste mesmo ano civil só comemora a partir do ano que vem).
 */
function nextWorkAnniversaryOccurrence(
  joinedAt: Date,
  referenceDay: string,
): { observedYmd: string; daysUntil: number; years: number } {
  const { day, month } = civilDayMonth(joinedAt)
  const joinYear = joinedAt.getUTCFullYear()
  const refYear = Number(referenceDay.slice(0, 4))

  let year = refYear
  let observedYmd = occurrenceYmd(month, day, year)
  if (observedYmd < referenceDay || year - joinYear < 1) {
    year += 1
    observedYmd = occurrenceYmd(month, day, year)
  }
  return { observedYmd, daysUntil: daysBetween(referenceDay, observedYmd), years: year - joinYear }
}

/**
 * Das ocorrências dadas, mantém só as que caem nas 3 datas observadas mais
 * próximas — sem cortar por pessoa: uma data com várias pessoas entra inteira.
 * `entries` já deve vir ordenado por nome (a query do Prisma já é alfabética),
 * o que preserva o desempate por nome dentro do mesmo dia.
 *
 * A janela de `UPCOMING_CELEBRATION_WINDOW_DAYS` corta ANTES do limite de datas:
 * as duas regras se somam, e é a janela que impede um mês vazio de puxar
 * aniversário de dois meses adiante para o card da Home.
 */
function nearestThreeDates<T extends { observedDate: string; daysUntil: number }>(entries: T[]): T[] {
  const sorted = entries
    .filter((e) => e.daysUntil <= UPCOMING_CELEBRATION_WINDOW_DAYS)
    .sort((a, b) => a.daysUntil - b.daysUntil)
  const dates: string[] = []
  for (const e of sorted) {
    if (dates.includes(e.observedDate)) continue
    if (dates.length >= 3) break
    dates.push(e.observedDate)
  }
  return sorted.filter((e) => dates.includes(e.observedDate))
}

/**
 * Celebrações visíveis para quem está olhando: aniversários de nascimento e de
 * casa dos colegas ativos da **empresa inteira**, todos os setores — aniversário
 * é da casa, não do time, e um calendário que escondia metade da empresa fazia
 * a data passar em branco. Inclui o próprio viewer — são as datas dele também.
 * A exceção é o THIRD_PARTY, que enxerga só o próprio setor (mesma regra de
 * `/users/company`): terceirizado não recebe o quadro de pessoas da empresa.
 *
 * O filtro por dia/mês é feito em memória de propósito: o Prisma não expõe
 * `EXTRACT`, e o universo aqui é uma empresa (centenas de pessoas), não uma
 * tabela de escala.
 */
export async function getCelebrations(
  viewerId: string,
  now: Date = new Date(),
  /** Mês exibido na tela, YYYY-MM. Ausente = mês corrente. */
  monthRef?: string,
): Promise<CelebrationsResponse> {
  // viewerId vem sempre de request.user.sub (JWT já validado) — sempre existe.
  const viewer = await prisma.user.findUniqueOrThrow({
    where: { id: viewerId },
    select: { companyId: true, sectorId: true, role: true },
  })
  const referenceDay = ymdInSaoPaulo(now)
  const [year, month] = referenceDay.split('-').map(Number)

  const users = await scopedPrisma(viewer.companyId).user.findMany({
    where: {
      active: true,
      leftAt: null,
      role: { notIn: ['ADMIN', 'SUBADMIN', 'THIRD_PARTY'] },
      ...(viewer.role === 'THIRD_PARTY' ? { sectorId: viewer.sectorId } : {}),
    },
    orderBy: { name: 'asc' },
  })

  // A lista cruza setores: sem o nome do setor, dois colegas de times diferentes
  // ficam indistinguíveis no card. Em lote, para não fazer N+1.
  const sectorNames = await sectorNamesFor(users.map((u) => u.sectorId))
  const publicUser = (user: (typeof users)[number]) =>
    toPublicUser(user, [], { sectorName: sectorNames.get(user.sectorId) ?? '' })

  /**
   * Aniversários e tempo de casa daquele mês naquele ano. Chamado duas vezes:
   * uma para o dia de hoje (ano/mês correntes) e outra para o mês exibido na
   * tela — que pode ser de outro ano, e aí a contagem de "anos de casa" muda.
   */
  function collect(rows: typeof users, year: number, month: number) {
    const birthdays: { dto: BirthdayDTO; observed: number }[] = []
    const workAnniversaries: { dto: WorkAnniversaryDTO; observed: number }[] = []

    for (const user of rows) {
      if (user.birthDate) {
        const { day: d, month: m } = civilDayMonth(user.birthDate)
        if (m === month) {
          birthdays.push({ dto: { user: publicUser(user), day: d, month: m }, observed: observedDay(m, d, year) })
        }
      }
      const { day: jd, month: jm } = civilDayMonth(user.joinedAt)
      const years = year - user.joinedAt.getUTCFullYear()
      // Quem entrou neste mesmo ano ainda não tem aniversário de casa a comemorar.
      if (jm === month && years >= 1) {
        workAnniversaries.push({
          dto: { user: publicUser(user), day: jd, month: jm, years },
          observed: observedDay(jm, jd, year),
        })
      }
    }

    // Ordem do mês: dia crescente e, dentro do dia, o nome (a query já veio alfabética).
    birthdays.sort((a, b) => a.dto.day - b.dto.day)
    workAnniversaries.sort((a, b) => a.dto.day - b.dto.day)
    return { birthdays, workAnniversaries }
  }

  const current = collect(users, year, month)
  const [targetYear, targetMonth] = monthRef ? monthRef.split('-').map(Number) : [year, month]
  const target = monthRef ? collect(users, targetYear, targetMonth) : current

  // Próximos aniversariantes: independente do mês exibido na tela — sempre a
  // partir de hoje, podendo cruzar mês e ano.
  const upcomingBirthdays: UpcomingBirthdayDTO[] = []
  const upcomingWorkAnniversaries: UpcomingWorkAnniversaryDTO[] = []
  for (const user of users) {
    if (user.birthDate) {
      const { day: d, month: m } = civilDayMonth(user.birthDate)
      const occ = nextBirthdayOccurrence(m, d, referenceDay)
      upcomingBirthdays.push({
        user: publicUser(user),
        day: d,
        month: m,
        daysUntil: occ.daysUntil,
        observedDate: occ.observedYmd,
        greetingCount: 0,
      })
    }
    const { day: jd, month: jm } = civilDayMonth(user.joinedAt)
    const occ = nextWorkAnniversaryOccurrence(user.joinedAt, referenceDay)
    upcomingWorkAnniversaries.push({
      user: publicUser(user),
      day: jd,
      month: jm,
      years: occ.years,
      daysUntil: occ.daysUntil,
      observedDate: occ.observedYmd,
      greetingCount: 0,
    })
  }

  const birthdaysUpcoming = nearestThreeDates(upcomingBirthdays)
  const workUpcoming = nearestThreeDates(upcomingWorkAnniversaries)
  await fillGreetingCounts(viewer.companyId, birthdaysUpcoming, 'BIRTH')
  await fillGreetingCounts(viewer.companyId, workUpcoming, 'WORK')

  return {
    referenceDay,
    birthdays: { month: target.birthdays.map((e) => e.dto), upcoming: birthdaysUpcoming },
    workAnniversaries: { month: target.workAnniversaries.map((e) => e.dto), upcoming: workUpcoming },
  }
}

/**
 * Preenche `greetingCount` das ocorrências de HOJE — o "3 já assinaram" do card
 * da Home. Só hoje porque é o único dia em que o número diz alguma coisa: no
 * mural de daqui a 12 dias, zero é o normal, e mostrá-lo pareceria abandono.
 */
async function fillGreetingCounts(
  companyId: string,
  occurrences: (UpcomingBirthdayDTO | UpcomingWorkAnniversaryDTO)[],
  kind: CelebrationKind,
): Promise<void> {
  const today = occurrences.filter((occurrence) => occurrence.daysUntil === 0)
  if (today.length === 0) return
  const counts = await countGreetingsForToday(
    companyId,
    today.map((occurrence) => ({
      userId: occurrence.user.id,
      kind,
      year: Number(occurrence.observedDate.slice(0, 4)),
    })),
  )
  for (const occurrence of today) {
    const year = Number(occurrence.observedDate.slice(0, 4))
    occurrence.greetingCount = counts.get(`${occurrence.user.id}:${kind}:${year}`) ?? 0
  }
}

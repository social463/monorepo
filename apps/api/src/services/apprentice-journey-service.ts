import {
  APPRENTICE_MIN_MONTHS_IN_SECTOR,
  apprenticeStageOf,
  daysUntil,
  monthsSince,
  sectorChangeEligibility,
  type ApprenticeJourneyDTO,
  type ApprenticeSectorMoveDTO,
} from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'
import { ApprenticeError } from '../lib/apprentice-error'
import type { ApprenticeContext } from '../lib/apprentice-context'
import { apprenticeToday, listApprenticePeople } from './apprentice-service'

/**
 * Acompanhamento da jornada do aprendiz.
 *
 * Metade do que o protótipo pedia já existe em `User` e no planejamento de
 * férias da Liderança: setor, squad, líder, admissão. Aqui só mora o que não
 * existia — fim PREVISTO do contrato, atividades sob responsabilidade e o
 * histórico de troca de setor. O resto é LIDO do cadastro, nunca copiado: um
 * segundo cadastro da mesma pessoa diverge do primeiro no dia seguinte.
 */

const ymdOf = (date: Date | null | undefined): string | null =>
  date ? date.toISOString().slice(0, 10) : null

function toMoveDTO(row: {
  id: string
  userId: string
  fromSector: string
  toSector: string
  movedOn: Date
  reason: string
  responsibles: string
}): ApprenticeSectorMoveDTO {
  return {
    id: row.id,
    userId: row.userId,
    fromSector: row.fromSector,
    toSector: row.toSector,
    movedOn: row.movedOn.toISOString().slice(0, 10),
    reason: row.reason,
    responsibles: row.responsibles,
  }
}

export async function listApprenticeJourneys(companyId: string): Promise<ApprenticeJourneyDTO[]> {
  const db = scopedPrisma(companyId)
  const people = await listApprenticePeople(companyId)
  if (people.length === 0) return []
  const ids = people.map((person) => person.id)

  const [users, journeys, moves] = await Promise.all([
    db.user.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        squad: true,
        joinedAt: true,
        sector: { select: { name: true } },
        manager: { select: { name: true } },
      },
    }),
    db.apprenticeJourney.findMany({ where: { userId: { in: ids } } }),
    db.apprenticeSectorMove.findMany({
      where: { userId: { in: ids } },
      orderBy: { movedOn: 'desc' },
    }),
  ])

  const userById = new Map(users.map((user) => [user.id, user]))
  const journeyByUser = new Map(journeys.map((row) => [row.userId, row]))
  const today = apprenticeToday()

  return people.map((person) => {
    const user = userById.get(person.id)
    const journey = journeyByUser.get(person.id)
    const own = moves.filter((move) => move.userId === person.id)
    const joinedOn = ymdOf(user?.joinedAt)
    const contractEndsOn = ymdOf(journey?.contractEndsOn)

    // A permanência conta da última mudança registrada; sem nenhuma, da admissão.
    const eligibility = sectorChangeEligibility({
      joinedOn,
      lastMoveOn: own[0] ? own[0].movedOn.toISOString().slice(0, 10) : null,
      today,
      minMonths: APPRENTICE_MIN_MONTHS_IN_SECTOR,
    })

    return {
      person,
      sectorName: user?.sector?.name ?? null,
      squad: user?.squad ?? null,
      leaderName: user?.manager?.name ?? null,
      joinedOn,
      contractEndsOn,
      activities: journey?.activities ?? '',
      notes: journey?.notes ?? null,
      stage: apprenticeStageOf(joinedOn, today),
      monthsSinceJoined: monthsSince(joinedOn, today),
      daysToContractEnd: daysUntil(contractEndsOn, today),
      eligibleForSectorChange: eligibility.eligible,
      monthsInCurrentSector: eligibility.months,
      inSectorSince: eligibility.since,
      moves: own.map(toMoveDTO),
    }
  })
}

export interface JourneyInput {
  contractEndsOn?: string | null
  activities?: string
  notes?: string | null
}

export async function saveApprenticeJourney(
  context: ApprenticeContext,
  userId: string,
  input: JourneyInput,
): Promise<ApprenticeJourneyDTO> {
  const db = scopedPrisma(context.companyId)
  const people = await listApprenticePeople(context.companyId)
  if (!people.some((person) => person.id === userId)) {
    throw new ApprenticeError('Aprendiz não encontrado.', 404)
  }

  const contractEndsOn =
    input.contractEndsOn === undefined
      ? undefined
      : input.contractEndsOn
        ? new Date(`${input.contractEndsOn}T00:00:00.000Z`)
        : null
  if (contractEndsOn && Number.isNaN(contractEndsOn.getTime())) {
    throw new ApprenticeError('Data de término inválida.', 400)
  }

  const data = {
    ...(contractEndsOn !== undefined ? { contractEndsOn } : {}),
    ...(input.activities !== undefined ? { activities: input.activities.slice(0, 4000) } : {}),
    ...(input.notes !== undefined ? { notes: input.notes?.slice(0, 4000) ?? null } : {}),
    updatedById: context.userId,
  }

  // `upsert` não passa pela extensão de isolamento — findFirst + create/update.
  const existing = await db.apprenticeJourney.findFirst({ where: { userId } })
  if (existing) {
    await db.apprenticeJourney.update({ where: { id: existing.id }, data })
  } else {
    await db.apprenticeJourney.create({ data: { userId, ...data } })
  }

  const all = await listApprenticeJourneys(context.companyId)
  return all.find((row) => row.person.id === userId)!
}

export interface SectorMoveInput {
  userId: string
  fromSector?: string
  toSector: string
  movedOn: string
  reason?: string
  responsibles?: string
}

export async function createApprenticeSectorMove(
  context: ApprenticeContext,
  input: SectorMoveInput,
): Promise<ApprenticeJourneyDTO> {
  const toSector = input.toSector.trim().slice(0, 120)
  if (!toSector) throw new ApprenticeError('Informe o setor de destino.', 400)

  const movedOn = new Date(`${input.movedOn}T00:00:00.000Z`)
  if (Number.isNaN(movedOn.getTime())) throw new ApprenticeError('Data da mudança inválida.', 400)

  const db = scopedPrisma(context.companyId)
  const journeys = await listApprenticeJourneys(context.companyId)
  const journey = journeys.find((row) => row.person.id === input.userId)
  if (!journey) throw new ApprenticeError('Aprendiz não encontrado.', 404)

  // A elegibilidade NÃO barra o registro: o histórico tem de conseguir gravar a
  // mudança que de fato aconteceu, mesmo antes dos seis meses. Quem avisa é a
  // tela, que pede confirmação; aqui o dado é o fato.
  await db.apprenticeSectorMove.create({
    data: {
      userId: input.userId,
      fromSector: (input.fromSector ?? journey.sectorName ?? '').trim().slice(0, 120),
      toSector,
      movedOn,
      reason: (input.reason ?? '').trim().slice(0, 1000),
      responsibles: (input.responsibles ?? '').trim().slice(0, 200),
      createdById: context.userId,
    },
  })

  const all = await listApprenticeJourneys(context.companyId)
  return all.find((row) => row.person.id === input.userId)!
}

export async function deleteApprenticeSectorMove(companyId: string, moveId: string): Promise<void> {
  const db = scopedPrisma(companyId)
  const found = await db.apprenticeSectorMove.findFirst({ where: { id: moveId } })
  if (!found) throw new ApprenticeError('Movimentação não encontrada.', 404)
  await db.apprenticeSectorMove.delete({ where: { id: moveId } })
}

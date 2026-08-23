import type { VotingPeriod } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { scopedPrisma } from '../lib/tenant-scope'
import { recordAuditLog } from './audit-log-service'

export { monthRefFor } from '../lib/period-state'

export class AdminServiceError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'AdminServiceError'
  }
}

interface ScheduleVotingPeriodInput {
  sectorId: string
  monthRef: string
  startsAt: Date
  endsAt: Date
}

/**
 * Agenda o período (destaque do mês) DE UM SETOR. O mês é escolhido pelo admin e a
 * janela `[startsAt, endsAt]` define quando a votação fica aberta. Nasce OPEN e se
 * ativa sozinho por data (ver getCurrentOpenPeriod). (sectorId, monthRef) é único:
 * um período por mês por setor — duplicata cai no P2002. `companyId` é um parâmetro
 * explícito (a empresa do ator) validado contra o setor escolhido — sem essa
 * checagem um ADMIN podia informar o sectorId de OUTRA empresa e o período nascia
 * lá (o companyId derivava só do setor, nunca do ator).
 */
export async function scheduleVotingPeriod(input: ScheduleVotingPeriodInput, actorId: string, companyId: string): Promise<VotingPeriod> {
  const sector = await prisma.sector.findUniqueOrThrow({ where: { id: input.sectorId } })
  if (sector.companyId !== companyId) {
    throw new AdminServiceError('Setor inválido.', 400)
  }
  const period = await scopedPrisma(companyId).votingPeriod.create({
    data: { sectorId: input.sectorId, monthRef: input.monthRef, startsAt: input.startsAt, endsAt: input.endsAt, status: 'OPEN' },
  })
  await recordAuditLog({ actorId, entityType: 'VotingPeriod', entityId: period.id, action: 'CREATE', after: period, companyId })
  return period
}

/**
 * Atualiza a janela de votação de um período e o reabre (status OPEN). Editar
 * a janela de um ciclo que ainda não passou significa "agendá-lo" — então um
 * período antes fechado volta a valer pela nova janela (vira SCHEDULED/ACTIVE).
 * A regra de "mês não passado" é validada na rota (precisa do monthRef atual).
 */
export async function updateVotingPeriod(
  id: string,
  data: { startsAt: Date; endsAt: Date },
  actorId: string,
  companyId: string,
): Promise<VotingPeriod> {
  const db = scopedPrisma(companyId)
  const before = await db.votingPeriod.findUniqueOrThrow({ where: { id } })
  const updated = await db.votingPeriod.update({ where: { id }, data: { ...data, status: 'OPEN' } })
  await recordAuditLog({ actorId, entityType: 'VotingPeriod', entityId: id, action: 'UPDATE', before, after: updated, companyId })
  return updated
}

export async function closeVotingPeriod(id: string, actorId: string, companyId: string): Promise<VotingPeriod> {
  const db = scopedPrisma(companyId)
  const before = await db.votingPeriod.findUniqueOrThrow({ where: { id } })
  const updated = await db.votingPeriod.update({ where: { id }, data: { status: 'CLOSED' } })
  await recordAuditLog({ actorId, entityType: 'VotingPeriod', entityId: id, action: 'UPDATE', before, after: updated, companyId })
  return updated
}

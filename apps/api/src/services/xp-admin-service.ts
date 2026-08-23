import { Prisma, type XpCapWindow, type XpEvent, type XpRule } from '@prisma/client'
import { XP_RULE_SEED } from '@legends/shared'
import { scopedPrisma } from '../lib/tenant-scope'
import { recordAuditLog } from './audit-log-service'

export class XpAdminError extends Error {
  constructor(message: string, public status: number) {
    super(message)
    this.name = 'XpAdminError'
  }
}

export interface CreateXpRuleInput {
  event: XpEvent
  amount: number
  capWindow: XpCapWindow
  capAmount: number | null
  active?: boolean
}

/** O evento não é editável: junto com a empresa, ele é a identidade da regra. */
export interface UpdateXpRuleInput {
  amount?: number
  capWindow?: XpCapWindow
  capAmount?: number | null
  active?: boolean
}

/**
 * Normaliza e valida o par (janela, teto), igual ao de `coin-admin-service`:
 * `NONE` zera o teto; janela com teto ausente e teto menor que o valor por ação
 * são erros — no segundo caso a regra nunca pagaria nada, o que parece bug para
 * quem configurou.
 */
function normalizeCap(
  capWindow: XpCapWindow,
  capAmount: number | null | undefined,
  amount: number,
): number | null {
  if (capWindow === 'NONE') return null
  if (capAmount == null) {
    throw new XpAdminError('Informe o teto para a janela escolhida.', 400)
  }
  if (capAmount < amount) {
    throw new XpAdminError('O teto deve ser pelo menos igual ao valor por ação.', 400)
  }
  return capAmount
}

/**
 * Regras com que uma empresa nova começa a pontuar.
 *
 * Empresa sem regra nenhuma não paga XP: `awardXp` devolve `NO_RULE` e o
 * "Como ganhar pontos" não é montado — a gamificação fica desligada em
 * silêncio, sem ninguém ter escolhido isso. `skipDuplicates` porque a mesma
 * provisão roda no backfill das empresas antigas (migration
 * `20260818140000`) e no seed de dev.
 */
export async function provisionXpRules(
  db: Pick<Prisma.TransactionClient, 'xpRule'>,
  companyId: string,
): Promise<void> {
  await db.xpRule.createMany({
    data: XP_RULE_SEED.map((rule) => ({ ...rule, companyId })),
    skipDuplicates: true,
  })
}

export function listXpRules(companyId: string): Promise<XpRule[]> {
  return scopedPrisma(companyId).xpRule.findMany({ orderBy: { event: 'asc' } })
}

export async function createXpRule(
  input: CreateXpRuleInput,
  actorId: string,
  companyId: string,
): Promise<XpRule> {
  const capAmount = normalizeCap(input.capWindow, input.capAmount, input.amount)
  const db = scopedPrisma(companyId)
  try {
    return await db.$transaction(async (tx) => {
      const created = await tx.xpRule.create({
        data: {
          event: input.event,
          amount: input.amount,
          capWindow: input.capWindow,
          capAmount,
          active: input.active ?? true,
        },
      })
      // O cast reconcilia o client estendido por `scopedPrisma` com a assinatura de
      // `recordAuditLog`; o companyId vai explícito.
      await recordAuditLog({
        actorId,
        entityType: 'XpRule',
        entityId: created.id,
        action: 'CREATE',
        after: created,
        companyId,
        tx: tx as unknown as Prisma.TransactionClient,
      })
      return created
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new XpAdminError('Já existe uma regra de XP para este evento.', 409)
    }
    throw err
  }
}

export async function updateXpRule(
  id: string,
  input: UpdateXpRuleInput,
  actorId: string,
  companyId: string,
): Promise<XpRule> {
  const db = scopedPrisma(companyId)
  const before = await db.xpRule.findUnique({ where: { id } })
  if (!before) throw new XpAdminError('Regra não encontrada.', 404)

  const amount = input.amount ?? before.amount
  const capWindow = input.capWindow ?? before.capWindow
  // Trocar a janela exige informar o teto novo: o teto antigo foi pensado para
  // outra janela, e herdá-lo em silêncio muda o significado da regra.
  const capAmount = normalizeCap(
    capWindow,
    input.capWindow !== undefined && input.capAmount === undefined ? null : (input.capAmount ?? before.capAmount),
    amount,
  )

  try {
    return await db.$transaction(async (tx) => {
      const updated = await tx.xpRule.update({
        where: { id },
        data: { amount, capWindow, capAmount, ...(input.active !== undefined ? { active: input.active } : {}) },
      })
      await recordAuditLog({
        actorId,
        entityType: 'XpRule',
        entityId: id,
        action: 'UPDATE',
        before,
        after: updated,
        companyId,
        tx: tx as unknown as Prisma.TransactionClient,
      })
      return updated
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      throw new XpAdminError('Regra não encontrada.', 404)
    }
    throw err
  }
}

/**
 * Remove a regra. Os lançamentos ficam: `ruleId` vira null (SetNull) e o `event`
 * denormalizado mantém o extrato legível — ninguém perde XP porque o admin
 * mudou de ideia sobre a regra.
 */
export async function deleteXpRule(id: string, actorId: string, companyId: string): Promise<void> {
  const db = scopedPrisma(companyId)
  const before = await db.xpRule.findUnique({ where: { id } })
  if (!before) throw new XpAdminError('Regra não encontrada.', 404)
  await db.$transaction(async (tx) => {
    await tx.xpRule.delete({ where: { id } })
    await recordAuditLog({
      actorId,
      entityType: 'XpRule',
      entityId: id,
      action: 'DELETE',
      before,
      companyId,
      tx: tx as unknown as Prisma.TransactionClient,
    })
  })
}

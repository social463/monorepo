/**
 * Configuração do programa Todos Pelos 9, por empresa (Documento 4, seção 14).
 *
 * Mora num JSON único em `AppSetting`, como a marca — e não num model próprio:
 * é um punhado de números por empresa, sem consulta nem relação, e uma tabela
 * para isso custaria migration sem devolver nada. Sem nada gravado valem os
 * números da EMR (`DEFAULT_BONUS_PROGRAM`), pelo mesmo critério do modelo de
 * comunicado: o padrão é ponto de partida, não verdade cravada.
 *
 * Quem lê é qualquer pessoa logada — a calculadora precisa dos pools para
 * fazer a conta. Quem escreve é o bloco de Gente e Gestão, na rota.
 */

import {
  DEFAULT_BONUS_PROGRAM,
  type BonusProgramSettings,
  type BonusTier,
} from '@legends/shared'
import { prisma } from '../lib/prisma'
import { recordAuditLog } from './audit-log-service'

/** Chave em `AppSetting`. */
export const BONUS_PROGRAM_KEY = 'bonus_program'

export class BonusProgramError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'BonusProgramError'
  }
}

/**
 * JSON gravado → configuração utilizável.
 *
 * Tudo que estiver corrompido ou ausente cai no padrão, campo a campo: um JSON
 * meio escrito não pode derrubar a calculadora de todo mundo, e devolver o
 * padrão é mais útil que devolver erro para quem só queria simular o bônus.
 */
function parse(raw: string | null | undefined): BonusProgramSettings {
  if (!raw) return DEFAULT_BONUS_PROGRAM
  let data: Partial<BonusProgramSettings>
  try {
    data = JSON.parse(raw) as Partial<BonusProgramSettings>
  } catch {
    return DEFAULT_BONUS_PROGRAM
  }
  const tiers = Array.isArray(data.tiers)
    ? data.tiers.filter(
        (t): t is BonusTier =>
          typeof t?.percent === 'number' &&
          Number.isFinite(t.percent) &&
          typeof t?.pool === 'number' &&
          Number.isFinite(t.pool),
      )
    : []
  return {
    totalQuotas:
      typeof data.totalQuotas === 'number' && data.totalQuotas > 0
        ? data.totalQuotas
        : DEFAULT_BONUS_PROGRAM.totalQuotas,
    deadline:
      typeof data.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.deadline)
        ? data.deadline
        : DEFAULT_BONUS_PROGRAM.deadline,
    // Lista vazia cai no padrão: calculadora sem nenhuma meta não tem o que
    // mostrar, e a tela ficaria em branco sem dizer por quê.
    tiers: tiers.length > 0 ? [...tiers].sort((a, b) => a.percent - b.percent) : DEFAULT_BONUS_PROGRAM.tiers,
    manualId: typeof data.manualId === 'string' && data.manualId ? data.manualId : null,
  }
}

export async function getBonusProgram(companyId: string): Promise<BonusProgramSettings> {
  const setting = await prisma.appSetting.findUnique({
    where: { key_companyId: { key: BONUS_PROGRAM_KEY, companyId } },
  })
  return parse(setting?.value)
}

/**
 * Valida o que a G&G mandou. É conta sobre salário: número impossível aqui vira
 * bônus impossível na tela de todo mundo, então a recusa é explícita, e não um
 * `?? padrão` silencioso como na LEITURA — quem está gravando precisa saber que
 * errou.
 */
function validate(input: BonusProgramSettings): void {
  if (!Number.isFinite(input.totalQuotas) || input.totalQuotas <= 0) {
    throw new BonusProgramError('O total de cotas da empresa precisa ser maior que zero.')
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.deadline) || Number.isNaN(Date.parse(`${input.deadline}T00:00:00.000Z`))) {
    throw new BonusProgramError('A data final do ciclo precisa ser uma data válida.')
  }
  if (input.tiers.length === 0) {
    throw new BonusProgramError('Informe ao menos uma meta.')
  }
  for (const tier of input.tiers) {
    if (!Number.isFinite(tier.percent) || tier.percent <= 0) {
      throw new BonusProgramError('Cada meta precisa de um percentual maior que zero.')
    }
    if (!Number.isFinite(tier.pool) || tier.pool < 0) {
      throw new BonusProgramError('O valor distribuído em cada meta não pode ser negativo.')
    }
  }
  const percentuais = input.tiers.map((t) => t.percent)
  if (new Set(percentuais).size !== percentuais.length) {
    throw new BonusProgramError('Há duas metas com o mesmo percentual.')
  }
}

export async function updateBonusProgram(
  actor: { id: string; companyId: string },
  input: BonusProgramSettings,
): Promise<BonusProgramSettings> {
  validate(input)
  const anterior = await getBonusProgram(actor.companyId)
  // Ordenado na gravação, e não só na leitura: a tabela da calculadora sai na
  // ordem das metas, e depender da ordem em que a G&G digitou é o tipo de coisa
  // que só aparece em produção.
  const valor: BonusProgramSettings = { ...input, tiers: [...input.tiers].sort((a, b) => a.percent - b.percent) }

  await prisma.appSetting.upsert({
    where: { key_companyId: { key: BONUS_PROGRAM_KEY, companyId: actor.companyId } },
    update: { value: JSON.stringify(valor) },
    create: { key: BONUS_PROGRAM_KEY, companyId: actor.companyId, value: JSON.stringify(valor) },
  })

  await recordAuditLog({
    actorId: actor.id,
    companyId: actor.companyId,
    action: 'UPDATE',
    entityType: 'BonusProgram',
    entityId: BONUS_PROGRAM_KEY,
    before: anterior,
    after: valor,
  })

  return valor
}

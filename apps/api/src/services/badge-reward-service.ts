/**
 * O que acontece quando alguém conquista um selo (Documento 4, seção 11.4).
 *
 * Desde o Documento 4 são **duas** consequências: o aviso, que já existia, e a
 * recompensa em Pontos e EMR Coins, que é nova e vem configurada por selo.
 *
 * Este arquivo existe para haver **um** lugar que saiba disso. `userBadge.create`
 * aparece em seis pontos de `badge-service.ts` e `notifyBadgesEarned` era
 * chamada de onze — pendurar o crédito em cada um é garantir que o próximo selo
 * automático que alguém escrever esqueça de pagar.
 *
 * O valor sai do `Badge`, e não de `CoinRule`/`XpRule`: regra só sabe valor
 * fixo por evento, e aqui o valor é por selo. É o mesmo problema da recompensa
 * de desafio, então é a mesma solução — `awardFixedCoins`/`awardFixedXp`.
 */

import type { Prisma } from '@prisma/client'
import { scopedPrisma } from '../lib/tenant-scope'
import { awardFixedCoins } from './coin-service'
import { awardFixedXp } from './xp-service'
import { notifyBadgesEarned } from './notification-service'

/**
 * Credita a recompensa dos selos recém-conquistados.
 *
 * **O `reference` do dedupe é o `badgeId`, não o id da concessão.** A chave
 * única do livro-razão é `(userId, dedupeKey)`, então `BADGE_EARNED:<badgeId>`
 * quer dizer "este selo paga uma vez por pessoa, para sempre": revogar e
 * conceder de novo não paga duas vezes. É essa idempotência que torna seguro
 * chamar isto de onze lugares que às vezes se sobrepõem.
 *
 * Aceita `tx` para a aprovação de uma reivindicação creditar na MESMA
 * transação que concede o selo.
 */
export async function creditBadgeRewards(
  userId: string,
  badgeIds: string[],
  companyId: string,
  tx?: Prisma.TransactionClient,
): Promise<void> {
  if (badgeIds.length === 0) return

  // Dentro de uma transação o client cru não passa por `scopedPrisma`, então o
  // companyId entra explícito no where — mesmo padrão de `recordAuditLog`.
  const badges = tx
    ? await tx.badge.findMany({
        where: { id: { in: badgeIds }, companyId },
        select: { id: true, rewardPoints: true, rewardCoins: true },
      })
    : await scopedPrisma(companyId).badge.findMany({
        where: { id: { in: badgeIds } },
        select: { id: true, rewardPoints: true, rewardCoins: true },
      })

  for (const badge of badges) {
    // `awardFixed*` já devolve SKIPPED para <= 0; o `?? 0` só traduz "não
    // configurado" para "não credita".
    await awardFixedCoins({
      userId,
      companyId,
      amount: badge.rewardCoins ?? 0,
      event: 'BADGE_EARNED',
      reference: badge.id,
      tx,
    })
    await awardFixedXp({
      userId,
      companyId,
      amount: badge.rewardPoints ?? 0,
      event: 'BADGE_EARNED',
      reference: badge.id,
      tx,
    })
  }
}

/**
 * Fecha a conquista: credita e avisa. É o que os call sites chamam no lugar de
 * `notifyBadgesEarned`.
 *
 * Best-effort dos dois lados, como a avaliação de selos já era (ver
 * `AGENTS.md`): falha aqui é logada e não derruba o voto, o feedback ou o curso
 * que gerou o selo. Crédito e aviso são independentes de propósito — a falha de
 * um não pode levar o outro junto.
 */
export async function settleBadgesEarned(
  userId: string,
  badgeIds: string[],
  companyId: string,
): Promise<void> {
  if (badgeIds.length === 0) return
  try {
    await creditBadgeRewards(userId, badgeIds, companyId)
  } catch (err) {
    console.error('[badge-reward] falha ao creditar recompensa de selo', err)
  }
  await notifyBadgesEarned(userId, badgeIds, companyId)
}

import type { XpEvent } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { awardXp } from './xp-service'
import { awardCoins } from './coin-service'
import { saoPauloInstant, ymdOf } from '../lib/sao-paulo-date'

/**
 * Uma ação já registrada no banco que, pelas regras de hoje, valeria XP.
 *
 * `reference` tem que ser IDÊNTICA à que o call site em produção usa — é dela
 * que sai o `dedupeKey` (`${event}:${reference}`) que impede pagar duas vezes a
 * mesma ação, agora ou quando ela acontecer de novo.
 */
/**
 * Eventos que este backfill reconstrói — os cinco que têm histórico no banco.
 *
 * É um subconjunto de `XpEvent`, e não o enum inteiro, porque a mesma fila
 * alimenta `awardCoins`: os eventos do Feed Corporativo existem em XP e **não**
 * em coins, então tipar como `XpEvent` faria o backfill de coins não compilar.
 * Reconstruí-los também não faria sentido — reação e leitura de comunicado só
 * passaram a valer XP agora, e o histórico anterior não tem o dado da leitura.
 */
export type BackfillableXpEvent = Extract<
  XpEvent,
  'VOTE_CAST' | 'FEEDBACK_PUBLISHED' | 'FEEDBACK_REACTION' | 'MOOD_ANSWERED' | 'CHALLENGE_APPROVED'
>

export interface XpAction {
  userId: string
  event: BackfillableXpEvent
  reference: string
  /** Instante da ação. Define o dia civil do lançamento e a janela do teto. */
  at: Date
}

export interface BackfillEventReport {
  /** Ações candidatas encontradas no histórico. */
  actions: number
  credited: number
  /** Quanto foi efetivamente creditado, na moeda do backfill. */
  amount: number
  /** Já pagas antes (mesmo `dedupeKey`) — o que torna o backfill repetível. */
  duplicates: number
  /** Barradas pelo teto da regra na janela histórica. */
  capped: number
  /** Sem regra ativa para o evento. */
  skipped: number
}

export interface BackfillReport extends BackfillEventReport {
  currency: BackfillCurrency
  companyId: string
  /** Quantas pessoas receberam ao menos um crédito. */
  users: number
  byEvent: Partial<Record<XpEvent, BackfillEventReport>>
}

function emptyReport(): BackfillEventReport {
  return { actions: 0, credited: 0, amount: 0, duplicates: 0, capped: 0, skipped: 0 }
}

/**
 * Todo o histórico de uma empresa que hoje valeria XP, em ordem cronológica.
 *
 * As cinco fontes são exatamente os cinco `awardXp` que existem no código, com
 * a mesma `reference` de cada um:
 *
 * | evento               | fonte                        | reference               |
 * |----------------------|------------------------------|-------------------------|
 * | `VOTE_CAST`          | `Vote`                       | `vote.id`               |
 * | `FEEDBACK_PUBLISHED` | `Feedback`                   | `feedback.id`           |
 * | `FEEDBACK_REACTION`  | `FeedbackReaction`           | `${feedbackId}:${emoji}`|
 * | `MOOD_ANSWERED`      | `MoodEntry`                  | `ymd` do dia            |
 * | `CHALLENGE_APPROVED` | `ChallengeSubmission` (APPROVED) | `submission.id`     |
 *
 * A ordem cronológica não é cosmética: o teto de cada regra é contado por
 * janela (dia/semana/mês), então pagar fora de ordem mudaria quem entra no
 * teto e quem fica de fora.
 */
export async function collectXpActions(companyId: string): Promise<XpAction[]> {
  const [votes, feedbacks, reactions, moods, submissions] = await Promise.all([
    prisma.vote.findMany({ where: { companyId }, select: { id: true, voterId: true, createdAt: true } }),
    prisma.feedback.findMany({ where: { companyId }, select: { id: true, authorId: true, createdAt: true } }),
    prisma.feedbackReaction.findMany({
      where: { companyId },
      select: { feedbackId: true, userId: true, emoji: true, createdAt: true },
    }),
    prisma.moodEntry.findMany({ where: { companyId }, select: { userId: true, day: true } }),
    prisma.challengeSubmission.findMany({
      where: { companyId, status: 'APPROVED' },
      select: { id: true, userId: true, submittedAt: true, reviewedAt: true },
    }),
  ])

  const actions: XpAction[] = [
    ...votes.map((v) => ({ userId: v.voterId, event: 'VOTE_CAST' as const, reference: v.id, at: v.createdAt })),
    ...feedbacks.map((f) => ({
      userId: f.authorId,
      event: 'FEEDBACK_PUBLISHED' as const,
      reference: f.id,
      at: f.createdAt,
    })),
    ...reactions.map((r) => ({
      userId: r.userId,
      event: 'FEEDBACK_REACTION' as const,
      reference: `${r.feedbackId}:${r.emoji}`,
      at: r.createdAt,
    })),
    // MoodEntry só guarda o dia civil (`@db.Date`), sem hora. Meio-dia de São
    // Paulo é um instante seguro dentro dele: a meia-noite UTC do mesmo `day`
    // cairia no dia ANTERIOR no fuso, e o lançamento nasceria com a data errada.
    ...moods.map((m) => {
      const ymd = ymdOf(m.day)
      return { userId: m.userId, event: 'MOOD_ANSWERED' as const, reference: ymd, at: saoPauloInstant(ymd, '12:00') }
    }),
    // A aprovação é o que paga; quando ela não foi carimbada, sobra o envio.
    ...submissions.map((s) => ({
      userId: s.userId,
      event: 'CHALLENGE_APPROVED' as const,
      reference: s.id,
      at: s.reviewedAt ?? s.submittedAt,
    })),
  ]

  return actions.sort((a, b) => a.at.getTime() - b.at.getTime())
}

/**
 * Qual moeda o backfill paga. As duas são independentes: uma empresa pode ter
 * regra de XP e não ter de coins, e o histórico é o mesmo para as duas.
 */
export type BackfillCurrency = 'xp' | 'coins'

/** As regras ativas e os lançamentos já feitos da moeda escolhida. */
async function ledgerState(currency: BackfillCurrency, companyId: string) {
  if (currency === 'xp') {
    return Promise.all([
      prisma.xpRule.findMany({ where: { companyId, active: true }, select: { event: true } }),
      prisma.xpTransaction.findMany({ where: { companyId }, select: { userId: true, dedupeKey: true } }),
    ])
  }
  return Promise.all([
    prisma.coinRule.findMany({ where: { companyId, active: true }, select: { event: true } }),
    // Os ajustes manuais do admin entram na lista, mas nunca casam: a chave
    // deles é `MANUAL:<uuid>`, e a do histórico é `${event}:${referência}`.
    prisma.coinTransaction.findMany({ where: { companyId }, select: { userId: true, dedupeKey: true } }),
  ])
}

/**
 * Paga retroativamente o histórico de uma empresa pelas regras ativas HOJE da
 * moeda escolhida, respeitando o teto de cada regra na janela em que a ação
 * aconteceu.
 *
 * É seguro rodar quantas vezes precisar: cada lançamento carrega o mesmo
 * `dedupeKey` que o crédito em tempo real usaria, e a unique `(userId,
 * dedupeKey)` transforma a segunda passada em `DUPLICATE`. Pela mesma razão,
 * uma ação paga aqui não paga de novo se acontecer de ser reprocessada.
 *
 * O crédito passa por `awardXp`/`awardCoins` de propósito, em vez de inserir
 * direto: teto, regra inativa e idempotência ficam num lugar só, e um backfill
 * que reimplementasse essas contas seria a primeira coisa a divergir.
 *
 * Cuidado que não existe no XP: **coin é saldo gastável**. Creditar coin
 * retroativo cria poder de compra na Lojinha que não existia — some com o
 * histórico antes de rodar isto num ambiente onde já há resgate.
 */
export async function backfillForCompany(
  companyId: string,
  currency: BackfillCurrency = 'xp',
): Promise<BackfillReport> {
  const [rules, paid] = await ledgerState(currency, companyId)
  const payable = new Set<XpEvent>(rules.map((rule) => rule.event as XpEvent))
  // O que já foi pago sai da fila antes do crédito. Sem isto, a segunda passada
  // acusaria "no teto" em vez de "já paga": o teto é conferido ANTES da
  // inserção, e a janela já está cheia justamente pelo crédito da primeira
  // passada. Não creditava de novo — a unique garante isso —, mas o relatório
  // mentia sobre o motivo, que é o que alguém lê para decidir se rodou certo.
  const already = new Set(paid.map((entry) => `${entry.userId}|${entry.dedupeKey}`))

  const report: BackfillReport = { companyId, currency, ...emptyReport(), users: 0, byEvent: {} }
  const credited = new Set<string>()

  for (const action of await collectXpActions(companyId)) {
    const perEvent = (report.byEvent[action.event] ??= emptyReport())
    report.actions++
    perEvent.actions++

    if (!payable.has(action.event)) {
      report.skipped++
      perEvent.skipped++
      continue
    }

    if (already.has(`${action.userId}|${action.event}:${action.reference}`)) {
      report.duplicates++
      perEvent.duplicates++
      continue
    }

    const input = {
      userId: action.userId,
      companyId,
      event: action.event,
      reference: action.reference,
      now: action.at,
    }
    const outcome = currency === 'xp' ? await awardXp(input) : await awardCoins(input)

    if (outcome.status === 'CREDITED') {
      report.credited++
      report.amount += outcome.amount
      perEvent.credited++
      perEvent.amount += outcome.amount
      credited.add(action.userId)
    } else if (outcome.status === 'DUPLICATE') {
      report.duplicates++
      perEvent.duplicates++
    } else if (outcome.status === 'CAP_REACHED') {
      report.capped++
      perEvent.capped++
    } else {
      report.skipped++
      perEvent.skipped++
    }
  }

  report.users = credited.size
  return report
}

/** Backfill de todas as empresas, uma por vez — usado pelo script. */
export async function backfillForAllCompanies(currency: BackfillCurrency = 'xp'): Promise<BackfillReport[]> {
  const companies = await prisma.company.findMany({ select: { id: true }, orderBy: { id: 'asc' } })
  const reports: BackfillReport[] = []
  for (const company of companies) {
    reports.push(await backfillForCompany(company.id, currency))
  }
  return reports
}

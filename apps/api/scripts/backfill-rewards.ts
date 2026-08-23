/**
 * Backfill retroativo de Pontos (XP) e EMR Coins.
 *
 * Paga o histórico já registrado (votos, feedbacks, reações, humor e desafios
 * aprovados) pelas regras ativas hoje, respeitando o teto de cada regra na
 * janela em que a ação aconteceu. Rodar de novo não duplica nada: a
 * idempotência é a mesma do crédito em tempo real (`dedupeKey`).
 *
 *   pnpm --filter @legends/api exec tsx scripts/backfill-rewards.ts --dry-run
 *   pnpm --filter @legends/api exec tsx scripts/backfill-rewards.ts --currency=xp
 *   pnpm --filter @legends/api exec tsx scripts/backfill-rewards.ts --currency=both
 *   pnpm --filter @legends/api exec tsx scripts/backfill-rewards.ts --company=company-emr
 *
 * Sem `--currency`, roda só `xp`: **coin é saldo gastável** e creditar coin
 * retroativo cria poder de compra na Lojinha que não existia. Peça `coins`
 * explicitamente, e só depois de olhar a prévia.
 *
 * O alvo é o `DATABASE_URL` do ambiente — confira antes de rodar: o `.env` de
 * desenvolvimento deste repo costuma apontar para homologação, não para o
 * Postgres local.
 */
import { prisma } from '../src/lib/prisma'
import {
  backfillForCompany,
  collectXpActions,
  type BackfillCurrency,
  type BackfillReport,
} from '../src/services/backfill-service'

const CURRENCY_LABELS: Record<BackfillCurrency, string> = { xp: 'Pontos', coins: 'EMR Coins' }

function flag(name: string): string | undefined {
  const found = process.argv.find((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`))
  if (!found) return undefined
  return found.includes('=') ? found.slice(found.indexOf('=') + 1) : ''
}

/** Host do banco, sem credencial — só para o operador conferir o alvo. */
function databaseTarget(): string {
  try {
    const url = new URL(process.env.DATABASE_URL ?? '')
    return `${url.host}${url.pathname}`
  } catch {
    return '(DATABASE_URL ausente ou inválida)'
  }
}

function printReport(report: BackfillReport): void {
  console.log(`\n▸ ${report.companyId} · ${CURRENCY_LABELS[report.currency]}`)
  console.log(
    `  ${report.actions} ações · ${report.credited} creditadas (+${report.amount.toLocaleString('pt-BR')})` +
      ` · ${report.duplicates} já pagas · ${report.capped} no teto · ${report.skipped} sem regra` +
      ` · ${report.users} pessoas`,
  )
  for (const [event, stats] of Object.entries(report.byEvent)) {
    console.log(
      `    ${event.padEnd(20)} ${String(stats.actions).padStart(6)} ações  ` +
        `${String(stats.credited).padStart(6)} creditadas  ` +
        `+${stats.amount.toLocaleString('pt-BR').padStart(8)}  ` +
        `${String(stats.duplicates).padStart(5)} dup  ${String(stats.capped).padStart(4)} teto`,
    )
  }
}

/**
 * Prévia sem escrever: quantas ações existem e quantas já foram pagas. O teto
 * NÃO é simulado — ele depende da ordem dos créditos, e reimplementá-lo aqui
 * seria criar uma segunda verdade. Por isso o número real de créditos pode ser
 * menor do que o "a creditar" desta prévia.
 */
async function dryRun(companyId: string, currency: BackfillCurrency): Promise<void> {
  const [actions, xpRules, coinRules, xpPaid, coinPaid] = await Promise.all([
    collectXpActions(companyId),
    prisma.xpRule.findMany({ where: { companyId, active: true }, select: { event: true, amount: true } }),
    prisma.coinRule.findMany({ where: { companyId, active: true }, select: { event: true, amount: true } }),
    prisma.xpTransaction.findMany({ where: { companyId }, select: { dedupeKey: true } }),
    prisma.coinTransaction.findMany({ where: { companyId }, select: { dedupeKey: true } }),
  ])
  const rules = currency === 'xp' ? xpRules : coinRules
  const paid = currency === 'xp' ? xpPaid : coinPaid
  const amountByEvent = new Map(rules.map((rule) => [rule.event as string, rule.amount]))
  const already = new Set(paid.map((entry) => entry.dedupeKey))

  const rows = new Map<string, { total: number; pending: number; amount: number }>()
  for (const action of actions) {
    const row = rows.get(action.event) ?? { total: 0, pending: 0, amount: 0 }
    row.total++
    const amount = amountByEvent.get(action.event)
    if (amount !== undefined && !already.has(`${action.event}:${action.reference}`)) {
      row.pending++
      row.amount += amount
    }
    rows.set(action.event, row)
  }

  console.log(`\n▸ ${companyId} · ${CURRENCY_LABELS[currency]} (prévia)`)
  let pending = 0
  let total = 0
  for (const [event, row] of rows) {
    const sem = amountByEvent.has(event) ? '' : '  (sem regra ativa)'
    console.log(
      `    ${event.padEnd(20)} ${String(row.total).padStart(6)} ações  ` +
        `${String(row.pending).padStart(6)} a creditar  +${row.amount.toLocaleString('pt-BR').padStart(8)}${sem}`,
    )
    pending += row.pending
    total += row.amount
  }
  console.log(`  ${pending} a creditar, até +${total.toLocaleString('pt-BR')} (antes dos tetos).`)
}

function requestedCurrencies(): BackfillCurrency[] {
  const raw = flag('currency')
  if (raw === 'both') return ['xp', 'coins']
  if (raw === 'coins') return ['coins']
  if (raw === undefined || raw === '' || raw === 'xp') return ['xp']
  throw new Error(`--currency inválido: ${raw}. Use xp, coins ou both.`)
}

async function main() {
  const only = flag('company')
  const isDryRun = flag('dry-run') !== undefined
  const currencies = requestedCurrencies()

  console.log(`Banco: ${databaseTarget()}`)
  console.log(`Moeda: ${currencies.map((c) => CURRENCY_LABELS[c]).join(' + ')}`)
  console.log(isDryRun ? 'Modo: prévia (não escreve nada)' : 'Modo: aplicar')

  const companies = only
    ? [{ id: only }]
    : await prisma.company.findMany({ select: { id: true }, orderBy: { id: 'asc' } })

  for (const company of companies) {
    for (const currency of currencies) {
      if (isDryRun) {
        await dryRun(company.id, currency)
      } else {
        printReport(await backfillForCompany(company.id, currency))
      }
    }
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

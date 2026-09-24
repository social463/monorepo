/**
 * Importa metas da ImpulseUp para o módulo de Metas e OKRs. One-way, só leitura
 * na origem: nenhum PUT/POST/DELETE sai deste script, em nenhuma circunstância.
 *
 *   pnpm --filter @legends/api exec tsx scripts/import-impulseup-okr.ts \
 *     [--apply] [--cycle <id>] [--email <e-mail>]... [--company company-emr] \
 *     [--snapshot <arquivo.json>] [--save-snapshot <arquivo.json>] \
 *     [--impulseup-dir ~/automacoes/b2b-sprint-report/impulseup] [--max-people 150]
 *
 * Sem `--apply` é DRY-RUN (o padrão): lê, calcula e relata o que mudaria.
 *
 * Acesso: não há API pública. A sessão é a da automação de sprint — `lib.js`
 * dirige o Chrome com perfil persistente e chama a API interna com o Bearer do
 * Keycloak lido do localStorage DENTRO da página. O token nunca chega a este
 * processo, e por isso nunca é logado nem gravado. Sessão vencida: rode
 * `node <impulseup-dir>/login.js` e repita.
 *
 * `--snapshot` pula a ImpulseUp e lê um snapshot salvo com `--save-snapshot` —
 * útil para rodar o dry-run e o apply sobre exatamente os mesmos dados. O
 * snapshot tem nome e e-mail de colaboradores: guarde fora do repositório.
 *
 * Sementes do rastreio: os `--email` informados mais os e-mails do
 * `config.json` da automação. A partir delas o crawler segue quem aparece nos
 * papéis (ver `src/lib/impulseup-okr.ts`).
 *
 * Saída: 0 ok | 2 argumento ou snapshot inválido | 3 sessão da ImpulseUp
 * expirada | 4 a conferência com a ImpulseUp não bateu.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import {
  conferImpulseUpPlan,
  crawlImpulseUp,
  isSessionError,
  planImpulseUpImport,
  type ImpulseUpSnapshot,
} from '../src/lib/impulseup-okr'
import { prisma } from '../src/lib/prisma'
import { importImpulseUpPlan, type ImportEntity } from '../src/services/okr-import-service'

const EXIT_BAD_INPUT = 2
const EXIT_SESSION_EXPIRED = 3
const EXIT_CONFERENCE_FAILED = 4

const DEFAULT_CYCLE = '7341e10f-4943-4bd2-ac1f-cd0d56f68c4a'

function flag(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

function flags(nome: string): string[] {
  return process.argv.flatMap((arg, i) => (arg === `--${nome}` && process.argv[i + 1] ? [process.argv[i + 1]] : []))
}

const tem = (nome: string) => process.argv.includes(`--${nome}`)
const expandir = (caminho: string) => resolve(caminho.replace(/^~(?=\/|$)/, homedir()))

interface LibImpulseUp {
  openSession: (opts?: { headless?: boolean }) => Promise<{ ctx: { close: () => Promise<void> }; page: unknown }>
  ensureLoggedIn: (page: unknown) => Promise<void>
  makeApi: (page: unknown) => (method: string, path: string, body?: unknown) => Promise<unknown>
}

async function baixarSnapshot(dir: string, cycleId: string, sementes: string[], maxPeople: number): Promise<ImpulseUpSnapshot> {
  const libPath = join(dir, 'lib.js')
  if (!existsSync(libPath)) {
    console.error(`lib.js não encontrado em ${dir} — informe --impulseup-dir.`)
    process.exit(EXIT_BAD_INPUT)
  }
  const lib = createRequire(import.meta.url)(libPath) as LibImpulseUp
  const { ctx, page } = await lib.openSession()
  try {
    await lib.ensureLoggedIn(page)
    const api = lib.makeApi(page)
    // Só GET: o importador nunca recebe o `api` cru, só esta função.
    const get = (path: string) => api('GET', path)
    return await crawlImpulseUp(get, { cycleId, seedEmails: sementes, maxPeople, log: (line) => console.log(line) })
  } finally {
    await ctx.close()
  }
}

function sementesDoConfig(dir: string): string[] {
  const caminho = join(dir, 'config.json')
  if (!existsSync(caminho)) return []
  const config = JSON.parse(readFileSync(caminho, 'utf8')) as { metas?: { email?: string }[] }
  return (config.metas ?? []).flatMap((meta) => (meta.email ? [meta.email] : []))
}

const fmt = (n: number | null) => (n == null ? '—' : n.toFixed(2).replace('.', ','))

async function main() {
  const apply = tem('apply')
  const companyId = flag('company') ?? DEFAULT_COMPANY_ID
  const cycleId = flag('cycle') ?? DEFAULT_CYCLE
  const dir = expandir(flag('impulseup-dir') ?? '~/automacoes/b2b-sprint-report/impulseup')
  const maxPeople = Number(flag('max-people') ?? 150)
  if (!Number.isInteger(maxPeople) || maxPeople < 1) {
    console.error('--max-people precisa ser inteiro positivo.')
    process.exit(EXIT_BAD_INPUT)
  }
  const company = await prisma.company.findUnique({ where: { id: companyId } })
  if (!company) {
    console.error(`Empresa ${companyId} não existe neste banco.`)
    process.exit(EXIT_BAD_INPUT)
  }

  let snapshot: ImpulseUpSnapshot
  const arquivo = flag('snapshot')
  if (arquivo) {
    try {
      snapshot = JSON.parse(readFileSync(expandir(arquivo), 'utf8')) as ImpulseUpSnapshot
    } catch (err) {
      console.error(`Snapshot inválido: ${err instanceof Error ? err.message : err}`)
      process.exit(EXIT_BAD_INPUT)
    }
    if (!snapshot.cycle || !Array.isArray(snapshot.objectives)) {
      console.error('Snapshot sem ciclo ou objetivos.')
      process.exit(EXIT_BAD_INPUT)
    }
  } else {
    const sementes = [...flags('email'), ...sementesDoConfig(dir)]
    if (sementes.length === 0) {
      console.error('Nenhuma semente: informe --email ou mantenha o config.json da automação.')
      process.exit(EXIT_BAD_INPUT)
    }
    console.log(`Lendo a ImpulseUp (ciclo ${cycleId}, ${new Set(sementes).size} semente(s))…`)
    try {
      snapshot = await baixarSnapshot(dir, cycleId, sementes, maxPeople)
    } catch (err) {
      if (!isSessionError(err)) throw err
      console.error(`Sessão da ImpulseUp expirada. Rode \`node ${join(dir, 'login.js')}\` e repita.`)
      process.exit(EXIT_SESSION_EXPIRED)
    }
  }
  const salvar = flag('save-snapshot')
  if (salvar) {
    writeFileSync(expandir(salvar), JSON.stringify(snapshot, null, 1))
    console.log(`Snapshot salvo em ${expandir(salvar)} (contém nomes e e-mails — fora do repo).`)
  }

  const plan = planImpulseUpImport(snapshot)
  const conference = conferImpulseUpPlan(plan, snapshot.dashboard)
  const report = await importImpulseUpPlan(plan, { companyId, apply })

  console.log(`\n${apply ? 'APLICADO' : 'DRY-RUN (nada gravado; use --apply)'} — empresa ${company.name}, ciclo "${plan.cycle.name}"`)
  const linhas: [ImportEntity, string][] = [
    ['cycle', 'ciclo'],
    ['objectives', 'objetivos'],
    ['keyResults', 'key results'],
    ['assignments', 'papéis'],
    ['dependencies', 'dependências'],
    ['checkIns', 'check-ins'],
  ]
  console.log('\n  entidade        criado  atualizado  inalterado  removido')
  for (const [entity, rotulo] of linhas) {
    const c = report.counts[entity]
    console.log(
      `  ${rotulo.padEnd(14)} ${String(c.created).padStart(7)} ${String(c.updated).padStart(11)} ${String(c.unchanged).padStart(11)} ${String(c.removed).padStart(9)}`,
    )
  }

  console.log(
    `\nCheck-ins: ${report.checkIns.total} no total, ${report.checkIns.withoutValue} SEM VALOR ` +
      `(dívida de dados herdada: a ImpulseUp não guarda valor no comentário), ${report.checkIns.synthetic} sintético(s).`,
  )
  if (report.unmatchedEmails.length > 0) {
    console.log(`\nPessoas sem conta no Legends (papel/autoria ignorados): ${report.unmatchedEmails.length}`)
    for (const email of report.unmatchedEmails) console.log(`  - ${email}`)
  }
  if (report.skippedDependencies > 0 || snapshot.unreachable.keyResults.length > 0) {
    console.log(
      `\nDependências de KR calculado fora do snapshot: ${report.skippedDependencies} ` +
        `(${snapshot.unreachable.keyResults.length} KR(s) não alcançados pelo rastreio). ` +
        'O KR calculado fica sem essas parcelas até elas serem importadas.',
    )
  }
  if (snapshot.unreachable.objectives.length > 0) {
    console.log(`Objetivos pai não alcançados: ${snapshot.unreachable.objectives.join(', ')}`)
  }
  for (const warning of plan.warnings) console.log(`  aviso: ${warning}`)

  console.log('\nConferência com a ImpulseUp (progresso linear, a régua de lá):')
  console.log(`  KRs com valor: ${conference.keyResults.matched}/${conference.keyResults.total} batem`)
  for (const m of conference.keyResults.mismatches) console.log(`    ✗ ${m.name}: ImpulseUp ${fmt(m.source)} × nosso ${fmt(m.ours)}`)
  if (conference.calculatedSkipped.length > 0) {
    console.log(`  KRs calculados fora da paridade (a média aqui é de atingimento): ${conference.calculatedSkipped.join(', ')}`)
  }
  console.log(`  dashboard/objectives: ${conference.dashboard.matched}/${conference.dashboard.total} batem`)
  for (const m of conference.dashboard.mismatches) console.log(`    ✗ ${m.name}: ImpulseUp ${fmt(m.source)} × nosso ${fmt(m.ours)}`)
  if (snapshot.dashboard) {
    console.log(
      `  (dashboard: total ${snapshot.dashboard.total ?? '—'}, realizado ${snapshot.dashboard.totalRealized ?? '—'}, ` +
        `${fmt(snapshot.dashboard.percentTotal ?? null)}% — semântica de total não confirmada, só exibido)`,
    )
  }
  if (conference.divergentColors.length > 0) {
    console.log('\nOnde a cor muda com a direção (ImpulseUp ≥ 100% × meta cumprida aqui):')
    for (const d of conference.divergentColors) {
      console.log(
        `  ${d.name}: ImpulseUp ${fmt(d.sourceProgress)}% → atingimento ${fmt(d.attainment == null ? null : d.attainment * 100)}%, ` +
          `${d.goalMet ? 'cumprida' : 'NÃO cumprida'}`,
      )
    }
  }

  const falhou = conference.keyResults.mismatches.length > 0 || conference.dashboard.mismatches.length > 0
  process.exitCode = falhou ? EXIT_CONFERENCE_FAILED : 0
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

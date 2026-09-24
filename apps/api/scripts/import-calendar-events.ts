/**
 * Importa uma planilha do Calendário Endomarketing por linha de comando.
 *
 * É a mesma importação da tela (Administração › Eventos do calendário ›
 * Importar planilha) — chama o **mesmo** service, então valida, dedup e
 * auditoria são idênticos. Existe para carregar o calendário de uma empresa
 * sem depender de alguém logado no navegador (HML, produção, ambiente novo).
 *
 *   pnpm --filter @legends/api exec tsx scripts/import-calendar-events.ts \
 *     [caminho-da-planilha.csv] [--company company-emr] [--actor email] \
 *     [--batch 40] [--dry-run]
 *
 * Sem argumentos, importa `scripts/data/calendario-endomarketing-2026.csv`
 * para a empresa padrão, em nome do primeiro ADMIN dela.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../src/lib/prisma'
import {
  CalendarImportError,
  commitCalendarImport,
  previewCalendarImport,
} from '../src/services/calendar-event-import-service'

const AQUI = dirname(fileURLToPath(import.meta.url))
const PLANILHA_PADRAO = resolve(AQUI, 'data/calendario-endomarketing-2026.csv')

/**
 * A transação do commit tem teto de 30 s, e rodando **de fora do cluster** cada
 * statement paga a latência da rede: 135 eventos numa transação só estouram o
 * teto contra o HML (a mesma pedra em que a importação de Lendas bateu). Pela
 * tela isso não acontece — lá a API fala com o banco na mesma rede.
 *
 * Como a identidade de um evento é (título, data), rodar de novo é idempotente:
 * lote que falhou pode ser repetido sem duplicar nada.
 */
const LOTE_PADRAO = 40

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? undefined : process.argv[index + 1]
}

/**
 * Fatia o arquivo em registros preservando os **bytes originais** — cada lote é
 * o cabeçalho mais N registros, tal como estavam. Reescrever o CSV aqui seria
 * uma segunda gramática de escrita, e a primeira a divergir estragaria o
 * arquivo justamente no caso difícil (descrição com quebra de linha e vírgula).
 */
function fatiar(text: string, tamanho: number): string[] {
  const registros: string[] = []
  let inicio = 0
  let aspas = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    if (char === '"') {
      if (aspas && text[i + 1] === '"') i += 1
      else aspas = !aspas
      continue
    }
    if (aspas) continue
    if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1
      registros.push(text.slice(inicio, i + 1))
      inicio = i + 1
    }
  }
  if (inicio < text.length) registros.push(`${text.slice(inicio)}\r\n`)

  const [cabecalho, ...linhas] = registros
  const lotes: string[] = []
  for (let i = 0; i < linhas.length; i += tamanho) {
    lotes.push(cabecalho + linhas.slice(i, i + tamanho).join(''))
  }
  return lotes
}

async function main() {
  const caminho = process.argv[2]?.startsWith('--') ? PLANILHA_PADRAO : (process.argv[2] ?? PLANILHA_PADRAO)
  const companyId = flag('company') ?? DEFAULT_COMPANY_ID
  const dryRun = process.argv.includes('--dry-run')
  const actorEmail = flag('actor')
  const tamanhoLote = Number(flag('batch') ?? LOTE_PADRAO)

  const actor = await prisma.user.findFirst({
    where: actorEmail ? { email: actorEmail } : { companyId, role: 'ADMIN', active: true },
    select: { id: true, name: true, email: true, companyId: true },
  })
  if (!actor) throw new Error(`Nenhum ADMIN ativo em ${companyId} para assinar a importação.`)
  if (actor.companyId !== companyId) {
    throw new Error(`${actor.email} é da empresa ${actor.companyId}, não de ${companyId}.`)
  }

  const texto = readFileSync(caminho, 'utf8')
  const lotes = fatiar(texto, tamanhoLote)
  const quem = { id: actor.id, companyId }

  console.log(`Planilha: ${caminho}`)
  console.log(`Empresa: ${companyId} · em nome de ${actor.name} <${actor.email}>`)
  console.log(`${lotes.length} ${lotes.length === 1 ? 'lote' : 'lotes'} de até ${tamanhoLote} linhas`)

  const total = { created: 0, updated: 0, unchanged: 0 }
  const categorias: string[] = []

  for (const [indice, lote] of lotes.entries()) {
    const buffer = Buffer.from(lote, 'utf8')
    const preview = await previewCalendarImport(quem, buffer)
    const rotulo = `lote ${indice + 1}/${lotes.length}`

    if (indice === 0) for (const warning of preview.warnings) console.log(`Aviso: ${warning}`)

    if (preview.blocked) {
      for (const row of preview.rows) {
        for (const issue of row.issues) {
          console.error(`  linha ${issue.line}${issue.column ? ` · ${issue.column}` : ''}: ${issue.message}`)
        }
      }
      throw new Error(`${rotulo} bloqueado: corrija as linhas com erro. Os lotes anteriores já foram gravados.`)
    }

    if (dryRun) {
      console.log(
        `${rotulo}: ${preview.counts.CREATE} a criar, ${preview.counts.UPDATE} a atualizar, ` +
          `${preview.counts.UNCHANGED} sem mudança` +
          (preview.plan.typesToCreate.length > 0
            ? ` · categorias novas: ${preview.plan.typesToCreate.map((type) => type.name).join(', ')}`
            : ''),
      )
      continue
    }

    const result = await commitCalendarImport(quem, buffer, preview.fileHash)
    total.created += result.created
    total.updated += result.updated
    total.unchanged += result.unchanged
    categorias.push(...result.typesCreated)
    console.log(
      `${rotulo}: ${result.created} criados, ${result.updated} atualizados, ${result.unchanged} sem mudança`,
    )
  }

  if (dryRun) {
    console.log('--dry-run: nada foi gravado.')
    return
  }

  console.log(
    `Pronto: ${total.created} criados, ${total.updated} atualizados, ${total.unchanged} sem mudança` +
      (categorias.length > 0 ? ` · categorias criadas: ${categorias.join(', ')}` : ''),
  )
}

main()
  .catch((err) => {
    console.error(err instanceof CalendarImportError ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())

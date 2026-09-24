/**
 * Importação e exportação do catálogo de selos por planilha (Documento 4,
 * seção 11.5).
 *
 * Mesma anatomia da importação de eventos do calendário e da de colaboradores:
 * `preview` e `commit` passam pelo **mesmo** `resolveImport`, então a
 * confirmação enxerga o estado atual do banco e não o de quando a
 * pré-visualização foi gerada, e o arquivo é reenviado inteiro em vez das
 * linhas já interpretadas — nada que o navegador monte entra no banco sem
 * passar pelas mesmas regras.
 *
 * A chave de reconciliação é o **`slug`**, derivado do nome, que é a mesma
 * chave do cadastro manual (`Badge.slug`, único por empresa). É o que permite a
 * G&G exportar, mexer na planilha e reimportar sem duplicar o catálogo inteiro.
 */

import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import {
  BADGE_IMPORT_COLUMNS,
  BADGE_IMPORT_COLUMN_ALIASES,
  BADGE_IMPORT_MAX_ROWS,
  BADGE_IMPORT_REQUIRED_COLUMNS,
  BADGE_IMPORT_TEMPLATE_EXAMPLE,
  BADGE_EXPORT_FILENAME,
  BADGE_KINDS,
  BADGE_KIND_LABELS,
  type BadgeImportColumn,
  type BadgeImportIssueDTO,
  type BadgeImportPreviewDTO,
  type BadgeImportResultDTO,
  type BadgeImportRowAction,
  type BadgeImportRowPreviewDTO,
  type BadgeKind,
} from '@legends/shared'
import { csvCell } from '../lib/csv'
import { parseCsvTable } from '../lib/csv-parse'
import { slugify } from '../lib/slug'
import { scopedPrisma } from '../lib/tenant-scope'
import { recordAuditLog } from './audit-log-service'

export class BadgeImportError extends Error {
  constructor(
    message: string,
    public status: number,
    public issues: BadgeImportIssueDTO[] = [],
  ) {
    super(message)
    this.name = 'BadgeImportError'
  }
}

export interface BadgeImportActor {
  id: string
  companyId: string
}

// ───────────────────────────── template ─────────────────────────────

/**
 * O template sai com `;` e BOM porque é o que o Excel em pt-BR abre sem passar
 * pelo assistente de importação. Na volta o parser fareja o separador, então a
 * planilha exportada do Google Sheets (que sai com vírgula) também é aceita.
 */
export function buildBadgeImportTemplate(): string {
  const header = BADGE_IMPORT_COLUMNS.map((column) => csvCell(column)).join(';')
  const example = BADGE_IMPORT_TEMPLATE_EXAMPLE.map((cell) => csvCell(cell)).join(';')
  return `﻿${header}\r\n${example}\r\n`
}

// ─────────────────────────── normalização ───────────────────────────

/** Sem acento, sem caixa e com espaços colapsados — para casar cabeçalho e rótulo. */
function flatten(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

const COLUMN_BY_HEADER = new Map<string, BadgeImportColumn>()
for (const column of BADGE_IMPORT_COLUMNS) {
  COLUMN_BY_HEADER.set(flatten(column), column)
  for (const alias of BADGE_IMPORT_COLUMN_ALIASES[column]) COLUMN_BY_HEADER.set(flatten(alias), column)
}

/**
 * Sinônimos do tipo de selo, além do rótulo canônico de `BADGE_KIND_LABELS`.
 *
 * A tela do admin usa rótulos LONGOS ("Por impacto (total de votos)") e o
 * catálogo compartilhado usa os curtos ("Impacto") — quem copia da tela para a
 * planilha escreve o longo, e travar por isso seria travar o caso comum.
 */
const KIND_ALIASES: Partial<Record<BadgeKind, readonly string[]>> = {
  CATEGORY: ['por categoria', 'por categoria de feedback'],
  IMPACT: ['por impacto', 'por impacto (total de votos)'],
  RECURRENCE: ['recorrencia (meses distintos)', 'por recorrencia'],
  FEEDBACK: ['feedback (total de feedbacks feitos)', 'por feedback'],
  TENURE: ['tempo de casa (anos)'],
  STREAK: ['ofensiva (dias uteis consecutivos)'],
  COURSE: ['aprendizado (cursos concluidos)', 'curso', 'cursos'],
  PDI: ['pdi (acoes concluidas)'],
}

/** Rótulo em português → enum. A planilha é da G&G, não do banco. */
const KIND_BY_LABEL = new Map<string, BadgeKind>()
for (const kind of BADGE_KINDS) {
  KIND_BY_LABEL.set(flatten(BADGE_KIND_LABELS[kind]), kind)
  // O enum cru também é aceito: quem exportou de outro lugar não deveria travar.
  KIND_BY_LABEL.set(flatten(kind), kind)
  for (const alias of KIND_ALIASES[kind] ?? []) KIND_BY_LABEL.set(flatten(alias), kind)
}

/** Inteiro não negativo, ou `null` quando a célula está vazia. `undefined` = inválido. */
function parseInteiro(raw: string): number | null | undefined {
  const limpo = raw.trim()
  if (!limpo) return null
  if (!/^\d+$/.test(limpo)) return undefined
  const valor = Number(limpo)
  return Number.isSafeInteger(valor) && valor <= 100_000 ? valor : undefined
}

function mapHeaders(headers: string[]): { columnAt: (BadgeImportColumn | null)[]; warnings: string[] } {
  const warnings: string[] = []
  const columnAt: (BadgeImportColumn | null)[] = []
  const seen = new Set<BadgeImportColumn>()
  const unknown: string[] = []

  headers.forEach((header) => {
    const column = COLUMN_BY_HEADER.get(flatten(header))
    if (column) {
      if (seen.has(column)) throw new BadgeImportError(`A coluna "${column}" aparece duas vezes na planilha.`, 400)
      seen.add(column)
      columnAt.push(column)
      return
    }
    columnAt.push(null)
    if (header.trim().length > 0) unknown.push(header.trim())
  })

  const missing = BADGE_IMPORT_REQUIRED_COLUMNS.filter((column) => !seen.has(column))
  if (missing.length > 0) {
    const list = missing.map((column) => `"${column}"`).join(', ')
    throw new BadgeImportError(
      `A planilha não tem ${missing.length === 1 ? 'a coluna' : 'as colunas'} ${list}. Baixe o modelo e preencha a partir dele.`,
      400,
    )
  }
  if (unknown.length > 0) {
    warnings.push(
      `${unknown.map((column) => `"${column}"`).join(', ')} não ${unknown.length === 1 ? 'é uma coluna' : 'são colunas'} do modelo e foi ignorada.`,
    )
  }
  return { columnAt, warnings }
}

// ────────────────────────────── resolução ──────────────────────────────

interface RowDraft {
  line: number
  name: string
  slug: string
  description: string
  kind: BadgeKind | null
  kindLabel: string
  badgeCategoryId: string | null
  categoryName: string
  iconKey: string
  threshold: number
  categorySlug: string | null
  rewardPoints: number | null
  rewardCoins: number | null
  action: BadgeImportRowAction
  changes: string[]
  issues: BadgeImportIssueDTO[]
}

interface ResolvedImport {
  preview: BadgeImportPreviewDTO
  rows: RowDraft[]
}

function addIssue(row: RowDraft, column: BadgeImportColumn | null, message: string): void {
  row.issues.push({ line: row.line, column, message })
  row.action = 'ERROR'
}

/** Parseia, valida tudo e diz o que seria gravado. Não escreve nada. */
async function resolveImport(actor: BadgeImportActor, buffer: Buffer): Promise<ResolvedImport> {
  const table = parseCsvTable(buffer)
  const { columnAt, warnings } = mapHeaders(table.headers)

  if (table.rows.length > BADGE_IMPORT_MAX_ROWS) {
    throw new BadgeImportError(
      `A planilha tem ${table.rows.length} linhas; o limite é ${BADGE_IMPORT_MAX_ROWS}.`,
      400,
    )
  }

  const db = scopedPrisma(actor.companyId)
  const [existentes, temas, categoriasDeFeedback] = await Promise.all([
    db.badge.findMany({
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        kind: true,
        iconKey: true,
        threshold: true,
        categorySlug: true,
        badgeCategoryId: true,
        rewardPoints: true,
        rewardCoins: true,
      },
    }),
    db.badgeCategory.findMany({ select: { id: true, name: true, slug: true } }),
    db.recognitionCategory.findMany({ select: { slug: true } }),
  ])

  const porSlug = new Map(existentes.map((badge) => [badge.slug, badge]))
  const temaPorSlug = new Map(temas.map((tema) => [tema.slug, tema]))
  const slugsDeFeedback = new Set(categoriasDeFeedback.map((c) => c.slug))

  const rows: RowDraft[] = []
  const slugsNoArquivo = new Set<string>()

  for (const record of table.rows) {
    const valorDe = (column: BadgeImportColumn): string => {
      const index = columnAt.indexOf(column)
      return index >= 0 ? (record.cells[index] ?? '').trim() : ''
    }

    const name = valorDe('Nome')
    const row: RowDraft = {
      line: record.line,
      name,
      slug: slugify(name),
      description: valorDe('Descrição'),
      kind: null,
      kindLabel: valorDe('Tipo'),
      badgeCategoryId: null,
      categoryName: '',
      iconKey: valorDe('Ícone'),
      threshold: 0,
      categorySlug: null,
      rewardPoints: null,
      rewardCoins: null,
      action: 'CREATE',
      changes: [],
      issues: [],
    }

    if (!name) addIssue(row, 'Nome', 'Informe o nome do selo.')
    else if (!row.slug) addIssue(row, 'Nome', 'O nome precisa ter letras ou números.')
    else if (slugsNoArquivo.has(row.slug)) {
      addIssue(row, 'Nome', 'Este selo aparece duas vezes na planilha.')
    }
    if (row.slug) slugsNoArquivo.add(row.slug)

    if (!row.description) addIssue(row, 'Descrição', 'Informe a descrição do selo.')

    const kind = KIND_BY_LABEL.get(flatten(row.kindLabel))
    if (!kind) {
      addIssue(
        row,
        'Tipo',
        row.kindLabel
          ? `"${row.kindLabel}" não é um tipo de selo conhecido.`
          : 'Informe o tipo do selo.',
      )
    } else {
      row.kind = kind
    }

    // Tema desconhecido é ERRO da linha, e não tema criado em silêncio: o
    // catálogo de temas é decisão da G&G, e criar por typo o encheria de gêmeos.
    const temaBruto = valorDe('Tema')
    if (temaBruto) {
      const tema = temaPorSlug.get(slugify(temaBruto))
      if (!tema) {
        addIssue(row, 'Tema', `O tema "${temaBruto}" não existe. Crie-o antes de importar.`)
      } else {
        row.badgeCategoryId = tema.id
        row.categoryName = tema.name
      }
    }

    const limiar = parseInteiro(valorDe('Limiar'))
    if (limiar === undefined) addIssue(row, 'Limiar', 'O limiar precisa ser um número inteiro.')
    else row.threshold = limiar ?? 0

    // `categorySlug` só faz sentido no selo de tipo CATEGORY — em qualquer
    // outro ele seria dado morto, e dado morto é o que diverge depois.
    const catFeedback = valorDe('Categoria de reconhecimento')
    if (catFeedback) {
      if (row.kind && row.kind !== 'CATEGORY') {
        addIssue(
          row,
          'Categoria de reconhecimento',
          'Só o tipo "Por categoria" usa a categoria de reconhecimento.',
        )
      } else if (!slugsDeFeedback.has(slugify(catFeedback))) {
        addIssue(row, 'Categoria de reconhecimento', `"${catFeedback}" não é uma categoria da empresa.`)
      } else {
        row.categorySlug = slugify(catFeedback)
      }
    }

    const pontos = parseInteiro(valorDe('Pontos'))
    if (pontos === undefined) addIssue(row, 'Pontos', 'A recompensa em Pontos precisa ser um número inteiro.')
    else row.rewardPoints = pontos

    const coins = parseInteiro(valorDe('EMR Coins'))
    if (coins === undefined) addIssue(row, 'EMR Coins', 'A recompensa em EMR Coins precisa ser um número inteiro.')
    else row.rewardCoins = coins

    // Só decide CREATE/UPDATE/UNCHANGED se a linha sobreviveu à validação.
    if (row.action !== 'ERROR') {
      const atual = porSlug.get(row.slug)
      if (!atual) {
        row.action = 'CREATE'
      } else {
        const mudancas: string[] = []
        if (atual.name !== row.name) mudancas.push(`nome: "${atual.name}" → "${row.name}"`)
        if (atual.description !== row.description) mudancas.push('descrição')
        if (atual.kind !== row.kind) mudancas.push(`tipo: ${BADGE_KIND_LABELS[atual.kind]} → ${row.kindLabel}`)
        if (row.iconKey && atual.iconKey !== row.iconKey) mudancas.push(`ícone: ${atual.iconKey} → ${row.iconKey}`)
        if (atual.threshold !== row.threshold) mudancas.push(`limiar: ${atual.threshold} → ${row.threshold}`)
        if (atual.badgeCategoryId !== row.badgeCategoryId) mudancas.push('tema')
        if (atual.categorySlug !== row.categorySlug) mudancas.push('categoria de reconhecimento')
        if (atual.rewardPoints !== row.rewardPoints) mudancas.push(`Pontos: ${atual.rewardPoints ?? '—'} → ${row.rewardPoints ?? '—'}`)
        if (atual.rewardCoins !== row.rewardCoins) mudancas.push(`EMR Coins: ${atual.rewardCoins ?? '—'} → ${row.rewardCoins ?? '—'}`)
        row.changes = mudancas
        row.action = mudancas.length > 0 ? 'UPDATE' : 'UNCHANGED'
      }
    }

    rows.push(row)
  }

  const counts: Record<BadgeImportRowAction, number> = { CREATE: 0, UPDATE: 0, UNCHANGED: 0, ERROR: 0 }
  for (const row of rows) counts[row.action] += 1

  // Selo com regra automática e limiar vazio não é erro de planilha: é selo que
  // simplesmente não vai sair sozinho (ver `meetsThreshold`, em badge-service).
  // Antes ele saía — para a empresa inteira —, então o silêncio aqui era pior
  // que o aviso. `CATEGORY` sem categoria de reconhecimento fica de fora porque
  // é o jeito deliberado de cadastrar selo só-manual.
  const semLimiar = rows.filter(
    (row) =>
      row.issues.length === 0 &&
      row.kind !== null &&
      row.threshold < 1 &&
      !(row.kind === 'CATEGORY' && !row.categorySlug),
  )
  if (semLimiar.length > 0) {
    warnings.push(
      `${semLimiar.length} ${semLimiar.length === 1 ? 'selo está' : 'selos estão'} sem limiar ` +
        `(${semLimiar.map((r) => r.name).join(', ')}). ` +
        'Eles serão criados, mas não são concedidos automaticamente — só pela liderança ou por solicitação aprovada.',
    )
  }

  const preview: BadgeImportPreviewDTO = {
    fileHash: createHash('sha256').update(buffer).digest('hex'),
    totalRows: rows.length,
    counts,
    rows: rows.map(
      (row): BadgeImportRowPreviewDTO => ({
        line: row.line,
        name: row.name,
        kindLabel: row.kindLabel,
        categoryName: row.categoryName,
        threshold: row.threshold,
        rewardPoints: row.rewardPoints,
        rewardCoins: row.rewardCoins,
        action: row.action,
        changes: row.changes,
        issues: row.issues,
      }),
    ),
    blocked: counts.ERROR > 0,
    warnings,
  }

  return { preview, rows }
}

export async function previewBadgeImport(actor: BadgeImportActor, buffer: Buffer): Promise<BadgeImportPreviewDTO> {
  const { preview } = await resolveImport(actor, buffer)
  return preview
}

export async function commitBadgeImport(
  actor: BadgeImportActor,
  buffer: Buffer,
  fileHash: string,
): Promise<BadgeImportResultDTO> {
  const { preview, rows } = await resolveImport(actor, buffer)

  if (preview.fileHash !== fileHash) {
    throw new BadgeImportError('O arquivo mudou depois da pré-visualização. Gere a pré-visualização de novo.', 409)
  }
  if (preview.blocked) {
    throw new BadgeImportError(
      `A planilha tem ${preview.counts.ERROR} ${preview.counts.ERROR === 1 ? 'linha' : 'linhas'} com erro. Nada foi criado nem alterado.`,
      422,
      preview.rows.flatMap((row) => row.issues),
    )
  }

  const db = scopedPrisma(actor.companyId)
  const resultado: BadgeImportResultDTO = { created: 0, updated: 0, unchanged: preview.counts.UNCHANGED }

  await db.$transaction(async (tx) => {
    for (const row of rows) {
      if (row.action === 'UNCHANGED') continue
      const dados = {
        name: row.name,
        description: row.description,
        kind: row.kind as BadgeKind,
        threshold: row.threshold,
        categorySlug: row.categorySlug,
        badgeCategoryId: row.badgeCategoryId,
        rewardPoints: row.rewardPoints,
        rewardCoins: row.rewardCoins,
      }

      if (row.action === 'CREATE') {
        const criado = await tx.badge.create({
          // Ícone vazio cai no padrão: a planilha da G&G não tinha essa coluna,
          // e travar a importação por causa dela seria travar o caso comum.
          data: { ...dados, slug: row.slug, iconKey: row.iconKey || 'trophy' },
        })
        resultado.created += 1
        await recordAuditLog({
          actorId: actor.id,
          entityType: 'Badge',
          entityId: criado.id,
          action: 'CREATE',
          after: criado,
          companyId: actor.companyId,
          tx: tx as unknown as Prisma.TransactionClient,
        })
        continue
      }

      const atual = await tx.badge.findFirstOrThrow({ where: { slug: row.slug } })
      const atualizado = await tx.badge.update({
        where: { id: atual.id },
        // Ícone vazio na planilha NÃO apaga o que já está cadastrado: a coluna
        // é opcional, e célula em branco significa "não mexi nisso".
        data: { ...dados, ...(row.iconKey ? { iconKey: row.iconKey } : {}) },
      })
      resultado.updated += 1
      await recordAuditLog({
        actorId: actor.id,
        entityType: 'Badge',
        entityId: atual.id,
        action: 'UPDATE',
        before: atual,
        after: atualizado,
        companyId: actor.companyId,
        tx: tx as unknown as Prisma.TransactionClient,
      })
    }
  })

  return resultado
}

/**
 * Exporta o catálogo com **as mesmas colunas do template** — é o que fecha o
 * ciclo exportar → editar → importar. Sem isso a G&G teria de montar a planilha
 * de importação à mão a partir de uma exportação com outro formato.
 */
export async function exportBadgesCsv(companyId: string): Promise<{ fileName: string; csv: string }> {
  const badges = await scopedPrisma(companyId).badge.findMany({
    include: { badgeCategory: { select: { name: true } } },
    orderBy: { name: 'asc' },
  })

  const linhas = badges.map((badge) =>
    [
      badge.name,
      badge.description,
      BADGE_KIND_LABELS[badge.kind],
      badge.badgeCategory?.name ?? '',
      badge.iconKey,
      String(badge.threshold),
      badge.categorySlug ?? '',
      badge.rewardPoints == null ? '' : String(badge.rewardPoints),
      badge.rewardCoins == null ? '' : String(badge.rewardCoins),
    ]
      .map((cell) => csvCell(cell))
      .join(';'),
  )

  const header = BADGE_IMPORT_COLUMNS.map((column) => csvCell(column)).join(';')
  return { fileName: BADGE_EXPORT_FILENAME, csv: `﻿${[header, ...linhas].join('\r\n')}\r\n` }
}

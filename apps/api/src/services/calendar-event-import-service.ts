/**
 * Importação de eventos do calendário por planilha.
 *
 * Mesma anatomia da importação de colaboradores (`user-import-service`):
 * `preview` e `commit` passam pelo **mesmo** `resolveImport`, então a
 * confirmação enxerga o estado atual do banco e não o de quando a
 * pré-visualização foi gerada, e o arquivo é reenviado inteiro em vez de as
 * linhas já interpretadas — nada que o navegador monte entra no banco sem
 * passar pelas mesmas regras.
 *
 * O que muda de lá para cá é o formato: aqui o arquivo é o **Calendário
 * Endomarketing** que a G&G já mantém em planilha, coluna por coluna
 * (`@legends/shared`, `calendar-event-import.ts`).
 */

import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import {
  CALENDAR_EVENT_DESCRIPTION_MAX_LENGTH,
  CALENDAR_EVENT_TITLE_MAX_LENGTH,
  CALENDAR_EVENT_CATEGORIES,
  CALENDAR_EVENT_TAG_MAX_LENGTH,
  CALENDAR_IMPORT_COLUMNS,
  CALENDAR_IMPORT_COLUMN_ALIASES,
  CALENDAR_IMPORT_FALLBACK_CATEGORY,
  CALENDAR_IMPORT_IGNORED_COLUMNS,
  CALENDAR_IMPORT_MAX_ROWS,
  CALENDAR_IMPORT_REQUIRED_COLUMNS,
  CALENDAR_IMPORT_ROW_ACTIONS,
  CALENDAR_IMPORT_TAG_CATEGORIES,
  CALENDAR_IMPORT_TEMPLATE_EXAMPLE,
  calendarImportRowKey,
  normalizeAudienceTag,
  type CalendarImportColumn,
  type CalendarImportIssueDTO,
  type CalendarImportPreviewDTO,
  type CalendarImportResultDTO,
  type CalendarImportRowAction,
  type CalendarImportRowPreviewDTO,
} from '@legends/shared'
import { csvCell } from '../lib/csv'
import { parseCsvTable } from '../lib/csv-parse'
import { prisma } from '../lib/prisma'
import { dayFromYmd, ymdOf } from '../lib/sao-paulo-date'
import { parseSpreadsheetDate, parseSpreadsheetTimeRange } from '../lib/spreadsheet-values'
import { scopedPrisma } from '../lib/tenant-scope'
import { recordAuditLog } from './audit-log-service'

export class CalendarImportError extends Error {
  constructor(
    message: string,
    public status: number,
    public issues: CalendarImportIssueDTO[] = [],
  ) {
    super(message)
    this.name = 'CalendarImportError'
  }
}

export interface CalendarImportActor {
  id: string
  companyId: string
}

// ───────────────────────────── template ─────────────────────────────

/**
 * O template sai com `;` e BOM porque é o que o Excel em pt-BR abre sem passar
 * pelo assistente de importação. Na volta o parser fareja o separador, então a
 * planilha exportada do Google Sheets (que sai com vírgula) também é aceita.
 */
export function buildCalendarImportTemplate(): string {
  const header = CALENDAR_IMPORT_COLUMNS.map((column) => csvCell(column)).join(';')
  const example = CALENDAR_IMPORT_TEMPLATE_EXAMPLE.map((cell) => csvCell(cell)).join(';')
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

const COLUMN_BY_HEADER = new Map<string, CalendarImportColumn>()
for (const column of CALENDAR_IMPORT_COLUMNS) {
  COLUMN_BY_HEADER.set(flatten(column), column)
  for (const alias of CALENDAR_IMPORT_COLUMN_ALIASES[column]) COLUMN_BY_HEADER.set(flatten(alias), column)
}

const IGNORED = new Set<string>(CALENDAR_IMPORT_IGNORED_COLUMNS.map(flatten))

/** Mesmo slug do cadastro manual de tipo — é ele que casa "Cultura" da planilha com a categoria que já existe. */
function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

const CATEGORY_BY_SLUG = new Map<string, { slug: string; label: string; color: string; icon: string }>(
  CALENDAR_EVENT_CATEGORIES.map((categoria) => [categoria.slug, categoria]),
)

/**
 * A **categoria** em que a `Tag` da planilha cai. Três degraus, nesta ordem:
 * a tag JÁ é uma categoria do catálogo ("Reunião" → `reuniao`); a tag está no
 * mapa de vocabulário da planilha ("Simulado" → `evento`); ou nada casa, e aí
 * vira Evento com aviso.
 *
 * Criar uma categoria por tag — o que esta importação fazia antes — deixava o
 * calendário inteiro da mesma cor (categoria fora do catálogo nasce com a de
 * fallback) e a barra de filtro com um chip por vocabulário novo da planilha.
 * A grafia original não se perde: ela vira `CalendarEvent.tag`.
 */
function categoriaDaTag(tag: string): { slug: string; reconhecida: boolean } {
  const slug = slugify(tag)
  if (CATEGORY_BY_SLUG.has(slug)) return { slug, reconhecida: true }
  const mapeada = CALENDAR_IMPORT_TAG_CATEGORIES[slug]
  if (mapeada) return { slug: mapeada, reconhecida: true }
  return { slug: CALENDAR_IMPORT_FALLBACK_CATEGORY, reconhecida: false }
}

/**
 * "Líder, G&G" → `['Líder', 'G&G']`. Deduplica pela forma **comparável**
 * (`G&G` e `g & g` são a mesma tag) mas guarda a grafia escrita, igual ao
 * cadastro manual (`normalizeAudience`, em `calendar-event-service`).
 */
function parseAudience(raw: string): string[] {
  const vistas = new Set<string>()
  const out: string[] = []
  for (const bruta of raw.split(/[,;/]/)) {
    const tag = bruta.trim()
    if (!tag) continue
    const chave = normalizeAudienceTag(tag)
    if (!chave || vistas.has(chave)) continue
    vistas.add(chave)
    out.push(tag)
  }
  return out
}

/** "Dia todo", "15:00", "15:00–22:00" — o que a tabela de conferência mostra. */
function timeLabel(start: string | null, end: string | null): string {
  if (!start) return 'Dia todo'
  return end ? `${start}–${end}` : start
}

function sameTags(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((tag, index) => tag === b[index])
}

// ────────────────────────── estado interno ──────────────────────────

interface TypeRef {
  id: string | null
  name: string
  slug: string
  color: string
  create: boolean
}

interface ExistingEvent {
  id: string
  title: string
  description: string
  tag: string | null
  date: Date
  endDate: Date | null
  startTime: string | null
  endTime: string | null
  typeId: string
  audienceTags: string[]
}

interface RowDraft {
  line: number
  title: string
  /** YYYY-MM-DD, vazio quando a data não parseou. */
  date: string
  endDate: string | null
  startTime: string | null
  endTime: string | null
  description: string
  audienceTags: string[]
  /** A coluna `Tag` como está na planilha — vira a etiqueta do evento. */
  tag: string
  /** Nome da categoria em que a tag caiu. */
  typeName: string
  typeKey: string | null
  action: CalendarImportRowAction
  changes: string[]
  issues: CalendarImportIssueDTO[]
  existing: ExistingEvent | null
}

interface ResolvedImport {
  preview: CalendarImportPreviewDTO
  rows: RowDraft[]
  types: Map<string, TypeRef>
}

function addIssue(row: RowDraft, column: CalendarImportColumn | null, message: string): void {
  row.issues.push({ line: row.line, column, message })
  row.action = 'ERROR'
}

// ─────────────────────────────── leitura ───────────────────────────────

function mapHeaders(headers: string[]): { columnAt: (CalendarImportColumn | null)[]; warnings: string[] } {
  const warnings: string[] = []
  const columnAt: (CalendarImportColumn | null)[] = []
  const seen = new Set<CalendarImportColumn>()
  const ignored: string[] = []
  const unknown: string[] = []

  headers.forEach((header) => {
    const key = flatten(header)
    const column = COLUMN_BY_HEADER.get(key)
    if (column) {
      if (seen.has(column)) throw new CalendarImportError(`A coluna "${column}" aparece duas vezes na planilha.`, 400)
      seen.add(column)
      columnAt.push(column)
      // `Mês` e `Duração` são colunas do modelo, mas derivadas: entram no mapa
      // para não virarem "coluna desconhecida", e o aviso explica o descarte.
      if (IGNORED.has(flatten(column))) ignored.push(column)
      return
    }
    columnAt.push(null)
    if (header.trim().length === 0) return
    unknown.push(header.trim())
  })

  const missing = CALENDAR_IMPORT_REQUIRED_COLUMNS.filter((column) => !seen.has(column))
  if (missing.length > 0) {
    const list = missing.map((column) => `"${column}"`).join(', ')
    throw new CalendarImportError(
      `A planilha não tem ${missing.length === 1 ? 'a coluna' : 'as colunas'} ${list}. Baixe o modelo e preencha a partir dele.`,
      400,
    )
  }

  if (ignored.length > 0) {
    warnings.push(
      `${ignored.map((column) => `"${column}"`).join(' e ')} ${ignored.length === 1 ? 'foi ignorada' : 'foram ignoradas'}: o mês sai da data de início e a duração sai do horário.`,
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

/** Parseia, valida tudo e diz o que seria gravado. Não escreve nada. */
async function resolveImport(actor: CalendarImportActor, buffer: Buffer): Promise<ResolvedImport> {
  const table = parseCsvTable(buffer)
  const { columnAt, warnings } = mapHeaders(table.headers)

  if (table.rows.length === 0) {
    throw new CalendarImportError('A planilha não tem nenhuma linha preenchida.', 400)
  }
  if (table.rows.length > CALENDAR_IMPORT_MAX_ROWS) {
    throw new CalendarImportError(
      `A planilha tem ${table.rows.length} linhas; o limite é ${CALENDAR_IMPORT_MAX_ROWS}. Divida em arquivos menores.`,
      400,
    )
  }

  const db = scopedPrisma(actor.companyId)
  const types = new Map<string, TypeRef>()
  for (const type of await db.calendarEventType.findMany()) {
    types.set(type.slug, { id: type.id, name: type.name, slug: type.slug, color: type.color, create: false })
  }

  // ── 1. linha a linha, o que dá pra validar sem banco
  const rows: RowDraft[] = []
  const keyLines = new Map<string, number[]>()
  const tagsSemCategoria = new Set<string>()

  for (const record of table.rows) {
    const cells: Partial<Record<CalendarImportColumn, string>> = {}
    record.cells.forEach((cell, index) => {
      const column = columnAt[index]
      if (column) cells[column] = cell
    })

    const row: RowDraft = {
      line: record.line,
      title: (cells['Evento / Celebração'] ?? '').trim(),
      date: '',
      endDate: null,
      startTime: null,
      endTime: null,
      description: (cells['Descrição'] ?? '').trim(),
      audienceTags: parseAudience(cells['Tags (Público-Alvo)'] ?? ''),
      tag: (cells.Tag ?? '').trim(),
      typeName: '',
      typeKey: null,
      action: 'CREATE',
      changes: [],
      issues: [],
      existing: null,
    }
    rows.push(row)

    if (!row.title) addIssue(row, 'Evento / Celebração', 'Informe o nome do evento.')
    else if (row.title.length > CALENDAR_EVENT_TITLE_MAX_LENGTH) {
      addIssue(row, 'Evento / Celebração', `Nome com mais de ${CALENDAR_EVENT_TITLE_MAX_LENGTH} caracteres.`)
    }

    if (row.description.length > CALENDAR_EVENT_DESCRIPTION_MAX_LENGTH) {
      addIssue(row, 'Descrição', `Descrição com mais de ${CALENDAR_EVENT_DESCRIPTION_MAX_LENGTH} caracteres.`)
    }

    // Tag vazia não vira "sem categoria": todo evento aparece no calendário com
    // a cor e o ícone da categoria, e o filtro do topo é por categoria.
    if (!row.tag) {
      addIssue(row, 'Tag', 'Informe a tag do evento.')
    } else if (row.tag.length > CALENDAR_EVENT_TAG_MAX_LENGTH) {
      addIssue(row, 'Tag', `Tag com mais de ${CALENDAR_EVENT_TAG_MAX_LENGTH} caracteres.`)
    } else {
      const { slug, reconhecida } = categoriaDaTag(row.tag)
      const padrao = CATEGORY_BY_SLUG.get(slug)!
      row.typeKey = slug
      row.typeName = types.get(slug)?.name ?? padrao.label
      if (!reconhecida) tagsSemCategoria.add(row.tag)
      if (!types.has(slug)) {
        // A categoria é do catálogo padrão, mas a empresa pode tê-la apagado:
        // nesse caso ela renasce com nome, cor e ícone do catálogo — e não com
        // a cor de fallback, que é o que deixava tudo da mesma cor.
        types.set(slug, { id: null, name: padrao.label, slug, color: padrao.color, create: true })
      }
    }

    const rawDate = (cells['Data de Início'] ?? '').trim()
    if (!rawDate) addIssue(row, 'Data de Início', 'Informe a data de início.')
    else {
      const date = parseSpreadsheetDate(rawDate)
      if (!date) addIssue(row, 'Data de Início', `Data "${rawDate}" inválida. Use DD/MM/AAAA.`)
      else row.date = ymdOf(date)
    }

    const rawEndDate = (cells['Data Final'] ?? '').trim()
    if (rawEndDate) {
      const endDate = parseSpreadsheetDate(rawEndDate)
      if (!endDate) addIssue(row, 'Data Final', `Data "${rawEndDate}" inválida. Use DD/MM/AAAA.`)
      else {
        const ymd = ymdOf(endDate)
        if (row.date && ymd < row.date) addIssue(row, 'Data Final', 'A data final não pode ser anterior à de início.')
        // Fim igual ao início é evento de um dia: guardar `null` mantém uma
        // leitura só de "cabe num dia", igual ao cadastro manual.
        else if (ymd !== row.date) row.endDate = ymd
      }
    }

    const rawTime = (cells['Horário'] ?? '').trim()
    const time = parseSpreadsheetTimeRange(rawTime)
    if (!time) {
      addIssue(row, 'Horário', `Horário "${rawTime}" não reconhecido. Use "14h-15h30", "14:00" ou "Dia todo".`)
    } else {
      row.startTime = time.start
      row.endTime = time.end
      // Num evento de um dia só, fim antes do início desenharia uma faixa de
      // altura negativa na grade. Em evento de vários dias a hora é a do
      // primeiro e a do último, então essa comparação não vale.
      if (!row.endDate && row.startTime && row.endTime && row.endTime <= row.startTime) {
        addIssue(row, 'Horário', 'A hora de fim precisa ser depois da de início.')
      }
    }

    if (row.date && row.title) {
      const key = calendarImportRowKey(row.title, row.date)
      keyLines.set(key, [...(keyLines.get(key) ?? []), row.line])
    }
  }

  for (const [key, lines] of keyLines) {
    if (lines.length < 2) continue
    for (const row of rows.filter((candidate) => calendarImportRowKey(candidate.title, candidate.date) === key)) {
      addIssue(row, null, `Este evento aparece mais de uma vez na planilha, na mesma data (linhas ${lines.join(' e ')}).`)
    }
  }

  // ── 2. o que já existe: mesmo título, mesma data de início
  const dates = [...new Set(rows.map((row) => row.date).filter(Boolean))].map(dayFromYmd)
  const existingEvents =
    dates.length === 0
      ? []
      : await db.calendarEvent.findMany({
          where: { date: { in: dates } },
          select: {
            id: true,
            title: true,
            description: true,
            tag: true,
            date: true,
            endDate: true,
            startTime: true,
            endTime: true,
            typeId: true,
            audienceTags: true,
          },
        })
  const existingByKey = new Map<string, ExistingEvent>()
  for (const event of existingEvents) {
    existingByKey.set(calendarImportRowKey(event.title, ymdOf(event.date)), event)
  }

  // ── 3. o diff de cada linha
  for (const row of rows) {
    if (row.action === 'ERROR' || !row.date) continue
    const existing = existingByKey.get(calendarImportRowKey(row.title, row.date))
    if (!existing) continue

    row.existing = existing
    const type = row.typeKey ? types.get(row.typeKey) : null
    const changes: string[] = []
    if (existing.description !== row.description) changes.push('Descrição')
    if ((existing.tag ?? '') !== row.tag) changes.push('Tag')
    if (ymdOf(existing.endDate ?? existing.date) !== (row.endDate ?? row.date)) changes.push('Data final')
    if (existing.startTime !== row.startTime || existing.endTime !== row.endTime) changes.push('Horário')
    // Tipo novo ainda não tem id: por definição é diferente do que está gravado.
    if (type && (type.id === null || type.id !== existing.typeId)) changes.push('Categoria')
    if (!sameTags(existing.audienceTags, row.audienceTags)) changes.push('Público-alvo')

    row.changes = changes
    row.action = changes.length > 0 ? 'UPDATE' : 'UNCHANGED'
  }

  const counts = Object.fromEntries(CALENDAR_IMPORT_ROW_ACTIONS.map((action) => [action, 0])) as Record<
    CalendarImportRowAction,
    number
  >
  for (const row of rows) counts[row.action] += 1

  const previewRows: CalendarImportRowPreviewDTO[] = rows.map((row) => ({
    line: row.line,
    title: row.title,
    tag: row.tag,
    date: row.date,
    endDate: row.endDate,
    timeLabel: timeLabel(row.startTime, row.endTime),
    typeName: row.typeName,
    typeIsNew: row.typeKey ? (types.get(row.typeKey)?.create ?? false) : false,
    audienceTags: row.audienceTags,
    action: row.action,
    changes: row.changes,
    issues: row.issues,
  }))

  if (tagsSemCategoria.size > 0) {
    warnings.push(
      `${[...tagsSemCategoria].map((tag) => `"${tag}"`).join(', ')} não ${tagsSemCategoria.size === 1 ? 'casa com nenhuma categoria e entrou' : 'casam com nenhuma categoria e entraram'} como Evento. A tag continua na etiqueta do evento.`,
    )
  }

  const preview: CalendarImportPreviewDTO = {
    fileHash: createHash('sha256').update(buffer).digest('hex'),
    totalRows: rows.length,
    counts,
    rows: previewRows,
    plan: {
      typesToCreate: [...types.values()]
        .filter((type) => type.create)
        .map((type) => ({ name: type.name, color: type.color })),
    },
    blocked: counts.ERROR > 0,
    warnings,
  }

  return { preview, rows, types }
}

export async function previewCalendarImport(
  actor: CalendarImportActor,
  buffer: Buffer,
): Promise<CalendarImportPreviewDTO> {
  const { preview } = await resolveImport(actor, buffer)
  return preview
}

export async function commitCalendarImport(
  actor: CalendarImportActor,
  buffer: Buffer,
  fileHash: string,
): Promise<CalendarImportResultDTO> {
  const { preview, rows, types } = await resolveImport(actor, buffer)

  if (preview.fileHash !== fileHash) {
    throw new CalendarImportError('O arquivo mudou depois da pré-visualização. Gere a pré-visualização de novo.', 409)
  }
  if (preview.blocked) {
    throw new CalendarImportError(
      `A planilha tem ${preview.counts.ERROR} ${preview.counts.ERROR === 1 ? 'linha' : 'linhas'} com erro. Nada foi criado nem alterado.`,
      422,
      preview.rows.flatMap((row) => row.issues),
    )
  }

  const db = scopedPrisma(actor.companyId)
  const typesCreated: string[] = []

  await db.$transaction(
    async (tx) => {
      const typeIdByKey = new Map<string, string>()
      for (const [key, type] of types) {
        if (type.id) {
          typeIdByKey.set(key, type.id)
          continue
        }
        const created = await tx.calendarEventType.create({
          data: { name: type.name, slug: type.slug, icon: 'event', color: type.color, companyId: actor.companyId },
        })
        typeIdByKey.set(key, created.id)
        typesCreated.push(type.name)
        await recordAuditLog({
          actorId: actor.id,
          entityType: 'CalendarEventType',
          entityId: created.id,
          action: 'CREATE',
          after: created,
          companyId: actor.companyId,
          tx: tx as unknown as Prisma.TransactionClient,
        })
      }

      for (const row of rows) {
        if (row.action === 'UNCHANGED') continue
        const typeId = typeIdByKey.get(row.typeKey!)!
        const fields = {
          title: row.title,
          description: row.description,
          tag: row.tag,
          date: dayFromYmd(row.date),
          endDate: row.endDate ? dayFromYmd(row.endDate) : null,
          startTime: row.startTime,
          endTime: row.endTime,
          typeId,
          audienceTags: row.audienceTags,
        }

        // Atualização mexe **só** no que a planilha traz: recorrência,
        // lembretes, setores, cor própria e a marca de comunicação interna
        // continuam como quem cadastrou deixou. A planilha não tem essas
        // colunas — zerá-las seria apagar configuração sem ninguém pedir.
        const event = row.existing
          ? await tx.calendarEvent.update({ where: { id: row.existing.id }, data: fields })
          : await tx.calendarEvent.create({
              data: { ...fields, createdById: actor.id, companyId: actor.companyId },
            })

        await recordAuditLog({
          actorId: actor.id,
          entityType: 'CalendarEvent',
          entityId: event.id,
          action: row.existing ? 'UPDATE' : 'CREATE',
          after: event,
          companyId: actor.companyId,
          tx: tx as unknown as Prisma.TransactionClient,
        })
      }

      await recordAuditLog({
        actorId: actor.id,
        entityType: 'CalendarEventImport',
        entityId: preview.fileHash,
        action: 'CREATE',
        after: {
          totalRows: preview.totalRows,
          created: preview.counts.CREATE,
          updated: preview.counts.UPDATE,
          unchanged: preview.counts.UNCHANGED,
          typesCreated,
        },
        companyId: actor.companyId,
        tx: tx as unknown as Prisma.TransactionClient,
      })
    },
    { timeout: 30_000, maxWait: 10_000 },
  )

  return {
    created: preview.counts.CREATE,
    updated: preview.counts.UPDATE,
    unchanged: preview.counts.UNCHANGED,
    typesCreated,
  }
}

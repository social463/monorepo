import { createHash } from 'node:crypto'
import { Prisma, type Area, type UserRole } from '@prisma/client'
import {
  AREA_LABELS,
  AREAS,
  USER_IMPORT_COLUMNS,
  USER_IMPORT_COLUMN_ALIASES,
  USER_IMPORT_IGNORED_COLUMNS,
  USER_IMPORT_MAX_ROWS,
  USER_IMPORT_REQUIRED_COLUMNS,
  USER_IMPORT_ROLES,
  USER_IMPORT_ROW_ACTIONS,
  USER_IMPORT_TEMPLATE_EXAMPLE,
  USER_ROLE_LABELS,
  type UserImportColumn,
  type UserImportCredentialDTO,
  type UserImportIssueDTO,
  type UserImportPreviewDTO,
  type UserImportResultDTO,
  type UserImportRole,
  type UserImportRowAction,
  type UserImportRowPreviewDTO,
} from '@legends/shared'
import { csvCell } from '../lib/csv'
import { parseCsvTable } from '../lib/csv-parse'
import { prisma } from '../lib/prisma'
import { generateTemporaryPassword, hashPassword } from '../lib/password'
import { slugify } from '../lib/slug'
import { scopedPrisma } from '../lib/tenant-scope'
import { recordAuditLog } from './audit-log-service'
import { assertManagerGraphAssignable, type ManagerGraphEntry } from './organization-service'
import { withEscritorioForced } from './sector-service'

export class UserImportError extends Error {
  constructor(
    message: string,
    public status: number,
    public issues: UserImportIssueDTO[] = [],
  ) {
    super(message)
    this.name = 'UserImportError'
  }
}

export interface UserImportActor {
  id: string
  role: UserRole
  sectorId: string
  companyId: string
}

/** Papéis que a importação nunca cria nem altera. */
const ADMINISTRATIVE_ROLES = new Set<UserRole>(['ADMIN', 'SUBADMIN', 'SUPER_ADMIN'])

// ───────────────────────────── template ─────────────────────────────

/**
 * O template sai com `;` e BOM porque é o que o Excel em pt-BR abre sem passar
 * pelo assistente de importação. Na volta o parser fareja o separador, então
 * quem salvar com vírgula também é aceito.
 */
export function buildImportTemplate(): string {
  const header = USER_IMPORT_COLUMNS.map((column) => csvCell(column)).join(';')
  const example = USER_IMPORT_TEMPLATE_EXAMPLE.map((cell) => csvCell(cell)).join(';')
  return `﻿${header}\r\n${example}\r\n`
}

// ─────────────────────────── normalização ───────────────────────────

/** Sem acento, sem caixa e com espaços colapsados — para casar cabeçalho e rótulo. */
function flatten(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

const COLUMN_BY_HEADER = new Map<string, UserImportColumn>()
for (const column of USER_IMPORT_COLUMNS) {
  COLUMN_BY_HEADER.set(flatten(column), column)
  for (const alias of USER_IMPORT_COLUMN_ALIASES[column]) COLUMN_BY_HEADER.set(flatten(alias), column)
}

const IGNORED_BY_HEADER = new Map<string, string>()
for (const column of USER_IMPORT_IGNORED_COLUMNS) IGNORED_BY_HEADER.set(flatten(column), column)

const ROLE_BY_LABEL = new Map<string, UserRole>()
for (const [role, label] of Object.entries(USER_ROLE_LABELS)) {
  ROLE_BY_LABEL.set(flatten(label), role as UserRole)
  ROLE_BY_LABEL.set(flatten(role), role as UserRole)
}

const AREA_BY_LABEL = new Map<string, Area>()
for (const area of AREAS) {
  AREA_BY_LABEL.set(flatten(AREA_LABELS[area]), area as Area)
  AREA_BY_LABEL.set(flatten(area), area as Area)
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** `DD/MM/AAAA` (o que o Excel pt-BR grava) ou `AAAA-MM-DD` (o que o input date manda). */
function parseImportDate(raw: string): Date | null {
  const brazilian = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw)
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw)
  let year: number
  let month: number
  let day: number
  if (brazilian) {
    day = Number(brazilian[1])
    month = Number(brazilian[2])
    year = Number(brazilian[3])
  } else if (iso) {
    year = Number(iso[1])
    month = Number(iso[2])
    day = Number(iso[3])
  } else {
    return null
  }
  const date = new Date(Date.UTC(year, month - 1, day))
  // Rejeita 31/02 e afins: o Date normaliza em silêncio para 03/03.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return date
}

function sameDay(a: Date | null, b: Date | null): boolean {
  if (a === null || b === null) return a === b
  return a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10)
}

// ────────────────────────── estado interno ──────────────────────────

interface RowDraft {
  line: number
  cells: Partial<Record<UserImportColumn, string>>
  name: string
  email: string
  issues: UserImportIssueDTO[]
  action: UserImportRowAction
  changes: string[]
  sectorName: string
  sectorKey: string | null
  squadName: string | null
  squadKey: string | null
  role: UserImportRole
  area: Area | null
  position: string | null
  joinedAt: Date | null
  birthDate: Date | null
  managerKey: string | null
  existing: ExistingUser | null
}

interface ExistingUser {
  id: string
  email: string
  name: string
  companyId: string
  sectorId: string
  role: UserRole
  active: boolean
  leftAt: Date | null
  position: string | null
  squad: string | null
  managerId: string | null
  area: Area | null
  joinedAt: Date
  birthDate: Date | null
}

interface SectorRef {
  id: string | null
  name: string
  slug: string
  roles: Set<UserRole>
  active: boolean
  create: boolean
}

interface SquadRef {
  id: string | null
  name: string
  slug: string
  sectorKey: string
  active: boolean
  create: boolean
}

interface ResolvedImport {
  preview: UserImportPreviewDTO
  rows: RowDraft[]
  sectors: Map<string, SectorRef>
  squads: Map<string, SquadRef>
  managerIdByKey: Map<string, string>
}

function addIssue(row: RowDraft, column: UserImportColumn | null, message: string): void {
  row.issues.push({ line: row.line, column, message })
  row.action = 'ERROR'
}

// ─────────────────────────────── leitura ───────────────────────────────

interface HeaderMap {
  columnAt: (UserImportColumn | null)[]
  warnings: string[]
}

function mapHeaders(headers: string[]): HeaderMap {
  const warnings: string[] = []
  const columnAt: (UserImportColumn | null)[] = []
  const seen = new Map<UserImportColumn, number>()
  const ignored: string[] = []
  const unknown: string[] = []

  headers.forEach((header, index) => {
    const key = flatten(header)
    const column = COLUMN_BY_HEADER.get(key)
    if (column) {
      const previous = seen.get(column)
      if (previous !== undefined) {
        throw new UserImportError(`A coluna "${column}" aparece duas vezes na planilha.`, 400)
      }
      seen.set(column, index)
      columnAt.push(column)
      return
    }
    columnAt.push(null)
    if (header.trim().length === 0) return
    if (IGNORED_BY_HEADER.has(key)) ignored.push(IGNORED_BY_HEADER.get(key)!)
    else unknown.push(header.trim())
  })

  const missing = USER_IMPORT_REQUIRED_COLUMNS.filter((column) => !seen.has(column))
  if (missing.length > 0) {
    const list = missing.map((column) => `"${column}"`).join(', ')
    throw new UserImportError(
      `A planilha não tem ${missing.length === 1 ? 'a coluna' : 'as colunas'} ${list}. Baixe o modelo e preencha a partir dele.`,
      400,
    )
  }

  if (ignored.length > 0) {
    warnings.push(
      `${ignored.map((column) => `"${column}"`).join(' e ')} ${ignored.length === 1 ? 'foi ignorada' : 'foram ignoradas'}: a importação nunca desliga nem reativa ninguém.`,
    )
  }
  if (unknown.length > 0) {
    warnings.push(`${unknown.map((column) => `"${column}"`).join(', ')} não ${unknown.length === 1 ? 'é uma coluna' : 'são colunas'} do modelo e foi ignorada.`)
  }
  return { columnAt, warnings }
}

// ────────────────────────────── resolução ──────────────────────────────

/**
 * Parseia, valida tudo e devolve o diagnóstico completo mais o que seria
 * gravado. Não escreve nada — é o mesmo caminho do preview e do commit, o que
 * garante que a confirmação enxergue o estado atual do banco, e não o de quando
 * a pré-visualização foi gerada.
 */
async function resolveImport(actor: UserImportActor, buffer: Buffer): Promise<ResolvedImport> {
  const table = parseCsvTable(buffer)
  const { columnAt, warnings } = mapHeaders(table.headers)

  if (table.rows.length === 0) {
    throw new UserImportError('A planilha não tem nenhuma linha preenchida.', 400)
  }
  if (table.rows.length > USER_IMPORT_MAX_ROWS) {
    throw new UserImportError(
      `A planilha tem ${table.rows.length} linhas; o limite é ${USER_IMPORT_MAX_ROWS}. Divida em arquivos menores.`,
      400,
    )
  }

  const isSubadmin = actor.role === 'SUBADMIN'
  const db = scopedPrisma(actor.companyId)

  const [existingSectors, existingSquads] = await Promise.all([
    db.sector.findMany({ include: { roles: true } }),
    db.squad.findMany(),
  ])

  const sectors = new Map<string, SectorRef>()
  for (const sector of existingSectors) {
    sectors.set(sector.slug, {
      id: sector.id,
      name: sector.name,
      slug: sector.slug,
      roles: new Set(sector.roles.map((entry) => entry.role)),
      active: sector.active,
      create: false,
    })
  }
  const sectorById = new Map(existingSectors.map((sector) => [sector.id, sector]))
  const actorSector = sectorById.get(actor.sectorId)

  const squads = new Map<string, SquadRef>()
  for (const squad of existingSquads) {
    const sectorSlug = sectorById.get(squad.sectorId)?.slug ?? ''
    squads.set(squad.slug, {
      id: squad.id,
      name: squad.name,
      slug: squad.slug,
      sectorKey: sectorSlug,
      active: squad.active,
      create: false,
    })
  }

  // ── 1. linha a linha, o que dá pra validar sem banco
  const rows: RowDraft[] = []
  const emailLines = new Map<string, number[]>()

  for (const record of table.rows) {
    const cells: Partial<Record<UserImportColumn, string>> = {}
    record.cells.forEach((cell, index) => {
      const column = columnAt[index]
      if (column) cells[column] = cell
    })

    const row: RowDraft = {
      line: record.line,
      cells,
      name: (cells.Nome ?? '').trim(),
      email: (cells['E-mail'] ?? '').trim().toLowerCase(),
      issues: [],
      action: 'CREATE',
      changes: [],
      sectorName: (cells.Setor ?? '').trim(),
      sectorKey: null,
      squadName: (cells.Squad ?? '').trim() || null,
      squadKey: null,
      role: 'LEGEND',
      area: null,
      position: (cells.Cargo ?? '').trim() || null,
      joinedAt: null,
      birthDate: null,
      managerKey: (cells['Líder (e-mail)'] ?? '').trim().toLowerCase() || null,
      existing: null,
    }
    rows.push(row)

    if (!row.name) addIssue(row, 'Nome', 'Informe o nome.')
    if (row.position && row.position.length > 120) addIssue(row, 'Cargo', 'Cargo com mais de 120 caracteres.')

    if (!row.email) addIssue(row, 'E-mail', 'Informe o e-mail.')
    else if (!EMAIL_PATTERN.test(row.email)) addIssue(row, 'E-mail', 'E-mail inválido.')
    else emailLines.set(row.email, [...(emailLines.get(row.email) ?? []), row.line])

    const rawRole = (cells.Papel ?? '').trim()
    if (rawRole) {
      const role = ROLE_BY_LABEL.get(flatten(rawRole))
      if (!role) {
        addIssue(row, 'Papel', `Papel "${rawRole}" não reconhecido. Use Lenda, Líder, Gerente ou Head.`)
      } else if (!(USER_IMPORT_ROLES as readonly string[]).includes(role)) {
        addIssue(
          row,
          'Papel',
          'A importação não cria nem altera contas de administrador ou terceirizado. Use Administração › Administradores.',
        )
      } else {
        row.role = role as UserImportRole
      }
    }

    const rawArea = (cells['Área'] ?? '').trim()
    if (rawArea) {
      const area = AREA_BY_LABEL.get(flatten(rawArea))
      if (!area) addIssue(row, 'Área', `Área "${rawArea}" não reconhecida. Use Engenharia, Produto ou deixe em branco.`)
      else row.area = area
    }

    const rawJoinedAt = (cells['Na equipe desde'] ?? '').trim()
    if (rawJoinedAt) {
      const date = parseImportDate(rawJoinedAt)
      if (!date) addIssue(row, 'Na equipe desde', 'Data inválida. Use DD/MM/AAAA.')
      else if (!withinRange(date)) addIssue(row, 'Na equipe desde', 'Data fora do intervalo (1900 até um ano à frente).')
      else row.joinedAt = date
    }

    const rawBirthDate = (cells['Data de nascimento'] ?? '').trim()
    if (rawBirthDate) {
      const date = parseImportDate(rawBirthDate)
      if (!date) addIssue(row, 'Data de nascimento', 'Data inválida. Use DD/MM/AAAA.')
      else if (date.getTime() > Date.now()) addIssue(row, 'Data de nascimento', 'Data de nascimento no futuro.')
      else if (!withinRange(date)) addIssue(row, 'Data de nascimento', 'Data fora do intervalo (1900 até um ano à frente).')
      else row.birthDate = date
    }
  }

  for (const [email, lines] of emailLines) {
    if (lines.length < 2) continue
    for (const row of rows.filter((candidate) => candidate.email === email)) {
      addIssue(row, 'E-mail', `Este e-mail aparece mais de uma vez na planilha (linhas ${lines.join(' e ')}).`)
    }
  }

  // ── 2. quem já existe (busca global: o unique de e-mail atravessa empresas)
  //
  // Vem antes do setor de propósito: o papel efetivo de quem já existe depende
  // disto, e é o papel que decide tanto a validação contra o setor quanto os
  // papéis com que um setor novo nasce.
  const emails = [...new Set(rows.map((row) => row.email).filter(Boolean))]
  const existingUsers =
    emails.length === 0
      ? []
      : await prisma.$queryRaw<ExistingUser[]>`
          SELECT id, email, name, "companyId", "sectorId", role, active, "leftAt",
                 position, squad, "managerId", area, "joinedAt", "birthDate"
          FROM "User" WHERE lower(email) = ANY(${emails})
        `
  const existingByEmail = new Map(existingUsers.map((user) => [user.email.toLowerCase(), user]))

  const memberships =
    existingUsers.length === 0
      ? []
      : await prisma.squadMember.findMany({
          where: { userId: { in: existingUsers.map((user) => user.id) } },
          include: { squad: { select: { id: true, name: true, slug: true, sectorId: true } } },
        })
  const membershipsByUser = new Map<string, typeof memberships>()
  for (const membership of memberships) {
    membershipsByUser.set(membership.userId, [...(membershipsByUser.get(membership.userId) ?? []), membership])
  }

  for (const row of rows) {
    if (row.action === 'ERROR' || !row.email) continue
    const existing = existingByEmail.get(row.email)
    if (!existing) continue
    row.existing = existing

    if (existing.companyId !== actor.companyId) {
      addIssue(row, 'E-mail', 'Este e-mail já está cadastrado em outra empresa da plataforma. Use outro e-mail.')
      continue
    }
    if (ADMINISTRATIVE_ROLES.has(existing.role)) {
      addIssue(row, 'E-mail', 'Este e-mail é de uma conta de administrador. A importação não mexe em administradores.')
      continue
    }
    if (existing.role === 'THIRD_PARTY') {
      addIssue(row, 'E-mail', 'Este e-mail é de uma conta de terceirizado. A importação não mexe em terceirizados.')
      continue
    }
    if (isSubadmin && existing.sectorId !== actor.sectorId) {
      addIssue(row, 'E-mail', `Esta pessoa é de outro setor. Você só importa pessoas do setor "${actorSector?.name ?? ''}".`)
      continue
    }
    if (!existing.active || existing.leftAt !== null) {
      row.action = 'SKIP'
      row.changes = ['Pessoa desligada — nada foi alterado. Reative em Administração › Lendas antes de importar.']
      continue
    }
  }

  // ── 3. papel efetivo de cada linha
  //
  // Coluna Papel em branco quer dizer "não mexe", igual a qualquer outra. Sem
  // isto o default `LEGEND` seria validado contra o setor e recusaria um
  // MANAGER num setor que não habilita Lenda — sem que papel nenhum fosse
  // mudar — e ainda faria um setor novo nascer sem o papel de quem vai para lá.
  for (const row of rows) {
    if (row.cells.Papel?.trim()) continue
    const current = row.existing?.role
    if (current && (USER_IMPORT_ROLES as readonly string[]).includes(current)) row.role = current as UserImportRole
  }

  // ── 4. o que a plataforma já tem com esses nomes
  //
  // Uma consulta para todos os slugs, não uma por linha: `Sector.slug` e
  // `Squad.name` têm unique global (defeito pré-existente), então o nome pode
  // estar tomado por outra empresa e a importação precisa saber disso antes de
  // planejar a criação.
  const candidateSectorSlugs = new Set<string>()
  const candidateSquadSlugs = new Set<string>()
  const candidateSquadNames = new Set<string>()
  for (const row of rows) {
    if (row.action === 'SKIP') continue
    const sectorName = row.sectorName || (isSubadmin && actorSector ? actorSector.name : '')
    const sectorSlug = sectorName ? slugify(sectorName) : ''
    if (sectorSlug && !sectors.has(sectorSlug)) candidateSectorSlugs.add(sectorSlug)
    const squadSlug = row.squadName ? slugify(row.squadName) : ''
    if (squadSlug && !squads.has(squadSlug)) {
      candidateSquadSlugs.add(squadSlug)
      candidateSquadNames.add(row.squadName!)
    }
  }

  const [takenSectors, takenSquads] = await Promise.all([
    candidateSectorSlugs.size === 0
      ? []
      : prisma.sector.findMany({ where: { slug: { in: [...candidateSectorSlugs] } }, select: { slug: true } }),
    candidateSquadSlugs.size === 0
      ? []
      : prisma.squad.findMany({
          where: { OR: [{ slug: { in: [...candidateSquadSlugs] } }, { name: { in: [...candidateSquadNames] } }] },
          select: { slug: true, name: true },
        }),
  ])
  const takenSectorSlugs = new Set(takenSectors.map((sector) => sector.slug))
  const takenSquadSlugs = new Set(takenSquads.map((squad) => squad.slug))
  const takenSquadNames = new Set(takenSquads.map((squad) => squad.name))

  // ── 5. setor de cada linha
  for (const row of rows) {
    // Desligado não é gravado, então o setor dele não vira erro do arquivo nem
    // faz um setor novo entrar no plano de criação.
    if (row.action === 'SKIP') continue
    if (row.action === 'ERROR' && row.issues.some((issue) => issue.column === 'Setor')) continue

    if (!row.sectorName) {
      if (isSubadmin && actorSector) {
        row.sectorKey = actorSector.slug
        row.sectorName = actorSector.name
      } else {
        addIssue(row, 'Setor', 'Informe o setor.')
        continue
      }
    }

    const slug = slugify(row.sectorName)
    if (!slug) {
      addIssue(row, 'Setor', `O setor "${row.sectorName}" precisa ter ao menos uma letra ou número no nome.`)
      continue
    }
    row.sectorKey = slug

    const existing = sectors.get(slug)
    if (existing?.create) {
      // Setor que a própria planilha está criando, visto por uma segunda linha:
      // o papel dela entra no conjunto do setor em vez de ser recusado. Validar
      // contra os papéis já acumulados só puniria quem aparece depois — o setor
      // nasce com a união do que o arquivo inteiro pede.
      existing.roles.add(row.role)
      row.sectorName = existing.name
      continue
    }
    if (existing) {
      if (isSubadmin && existing.id !== actor.sectorId) {
        addIssue(row, 'Setor', `Você só importa pessoas para o setor "${actorSector?.name ?? ''}".`)
        continue
      }
      if (!existing.active) {
        addIssue(row, 'Setor', `O setor "${existing.name}" está desativado. Reative-o em Administração › Setores.`)
        continue
      }
      if (!existing.roles.has(row.role)) {
        addIssue(
          row,
          'Papel',
          'Esse papel não está habilitado para o setor selecionado. Habilite-o em Administração › Setores.',
        )
      }
      row.sectorName = existing.name
      continue
    }

    if (isSubadmin) {
      addIssue(row, 'Setor', `Setor "${row.sectorName}" não encontrado. Só o Admin cria setores novos.`)
      continue
    }

    // Não existe na empresa: pode ser nome novo ou slug tomado por outra empresa.
    if (takenSectorSlugs.has(slug)) {
      addIssue(
        row,
        'Setor',
        `O setor "${row.sectorName}" não pode ser criado: o identificador "${slug}" já está em uso na plataforma. Renomeie o setor na planilha ou crie-o em Administração › Setores.`,
      )
      continue
    }

    // LEGEND sempre entra: é o papel default de quem for cadastrado depois, pela
    // tela. As demais linhas do mesmo setor somam os papéis delas logo acima.
    const roles = new Set<UserRole>(['LEGEND', row.role])
    sectors.set(slug, { id: null, name: row.sectorName, slug, roles, active: true, create: true })
  }

  // ── 6. squad de cada linha
  for (const row of rows) {
    if (!row.squadName || !row.sectorKey) continue
    if (row.action === 'ERROR' || row.action === 'SKIP') continue

    const slug = slugify(row.squadName)
    if (!slug) {
      addIssue(row, 'Squad', `A squad "${row.squadName}" precisa ter ao menos uma letra ou número no nome.`)
      continue
    }
    row.squadKey = slug

    const existing = squads.get(slug)
    if (existing) {
      if (!existing.active) {
        addIssue(row, 'Squad', `A squad "${existing.name}" está desativada. Reative-a em Administração › Squads.`)
        continue
      }
      if (existing.sectorKey !== row.sectorKey) {
        const sectorName = sectors.get(existing.sectorKey)?.name ?? existing.sectorKey
        if (existing.create) {
          // Squad que a própria planilha está inventando, puxada para dois
          // setores. Culpar só a segunda linha esconderia metade do conflito.
          const message = `A squad "${existing.name}" aparece na planilha em dois setores ("${sectorName}" e "${row.sectorName}"). Uma squad pertence a um setor só.`
          addIssue(row, 'Squad', message)
          for (const previous of rows) {
            if (previous !== row && previous.squadKey === slug) addIssue(previous, 'Squad', message)
          }
        } else {
          addIssue(
            row,
            'Squad',
            `A squad "${existing.name}" é do setor "${sectorName}"; esta pessoa está no setor "${row.sectorName}". Uma squad pertence a um setor só.`,
          )
        }
        continue
      }
      row.squadName = existing.name
      continue
    }

    if (takenSquadSlugs.has(slug) || takenSquadNames.has(row.squadName)) {
      addIssue(
        row,
        'Squad',
        `A squad "${row.squadName}" não pode ser criada: já existe uma squad com esse nome na plataforma. Renomeie na planilha ou crie-a em Administração › Squads.`,
      )
      continue
    }

    squads.set(slug, { id: null, name: row.squadName, slug, sectorKey: row.sectorKey, active: true, create: true })
  }

  // ── 7. o que muda em quem já existe
  for (const row of rows) {
    const existing = row.existing
    if (!existing || row.action === 'ERROR' || row.action === 'SKIP') continue

    const targetSector = row.sectorKey ? sectors.get(row.sectorKey) : undefined
    // Setor que a planilha ainda vai criar não tem id, mas mover alguém para
    // ele é uma mudança como qualquer outra — e é o que o commit vai gravar.
    // Tratar como "nada mudou" escondia o movimento de quem revisa e pulava a
    // checagem de squad presa ao setor atual.
    const changingSector = targetSector !== undefined && targetSector.id !== existing.sectorId
    if (changingSector) {
      const stuck = (membershipsByUser.get(existing.id) ?? []).find(
        (membership) => membership.squad.sectorId === existing.sectorId,
      )
      if (stuck) {
        const currentSector = sectorById.get(existing.sectorId)?.name ?? ''
        addIssue(
          row,
          'Setor',
          `Esta pessoa está na squad "${stuck.squad.name}", do setor "${currentSector}". Tire-a da squad em Administração › Squads antes de mudá-la de setor.`,
        )
        continue
      }
    }

    const changes: string[] = []
    if (row.name && row.name !== existing.name) changes.push(`Nome: "${existing.name}" → "${row.name}"`)
    if (row.position && row.position !== existing.position) changes.push(`Cargo: "${existing.position ?? ''}" → "${row.position}"`)
    if (row.cells.Papel?.trim() && row.role !== existing.role) {
      changes.push(`Papel: ${USER_ROLE_LABELS[existing.role]} → ${USER_ROLE_LABELS[row.role]}`)
    }
    if (changingSector) changes.push(`Setor: "${sectorById.get(existing.sectorId)?.name ?? ''}" → "${row.sectorName}"`)
    if (row.area && row.area !== existing.area) changes.push(`Área: ${AREA_LABELS[row.area]}`)
    if (row.joinedAt && !sameDay(row.joinedAt, existing.joinedAt)) changes.push('Na equipe desde')
    if (row.birthDate && !sameDay(row.birthDate, existing.birthDate)) changes.push('Data de nascimento')

    if (row.squadKey) {
      const squad = squads.get(row.squadKey)
      const alreadyMember = (membershipsByUser.get(existing.id) ?? []).some(
        (membership) => membership.squad.slug === row.squadKey,
      )
      if (alreadyMember) {
        if (existing.squad !== squad?.name) changes.push(`Squad: "${squad?.name ?? ''}"`)
      } else {
        const other = (membershipsByUser.get(existing.id) ?? []).map((membership) => membership.squad.name)
        changes.push(
          other.length > 0
            ? `Entra na squad "${squad?.name ?? ''}" (continua em "${other.join('", "')}")`
            : `Entra na squad "${squad?.name ?? ''}"`,
        )
      }
    }

    row.changes = changes
    row.action = changes.length > 0 ? 'UPDATE' : 'UNCHANGED'
  }

  // ── 8. líderes, com o grafo do banco fundido ao do arquivo
  const graphEntries: ManagerGraphEntry[] = rows
    .filter((row) => row.action !== 'ERROR' && row.action !== 'SKIP' && row.email)
    .map((row) => ({
      key: row.email,
      managerKey: row.managerKey,
      existingId: row.existing?.id ?? null,
      role: row.role,
    }))
  const { issues: managerIssues, managerIdByKey } = await assertManagerGraphAssignable(actor.companyId, graphEntries)
  for (const issue of managerIssues) {
    const row = rows.find((candidate) => candidate.email === issue.key)
    if (row) addIssue(row, 'Líder (e-mail)', issue.message)
  }

  // Troca de líder direto entra no diff de qualquer linha que já exista, e não
  // só das que estavam `UNCHANGED`: o commit grava o `managerId` em toda linha
  // `CREATE`/`UPDATE`, então deixar de fora seria mexer na hierarquia sem que a
  // pré-visualização dissesse.
  const rowByEmail = new Map(rows.map((row) => [row.email, row]))
  for (const row of rows) {
    if (row.action !== 'UPDATE' && row.action !== 'UNCHANGED') continue
    if (!row.managerKey || !row.existing) continue
    const managerRow = rowByEmail.get(row.managerKey)
    const targetId = managerIdByKey.get(row.email) ?? managerRow?.existing?.id ?? null
    // Líder que nasce na própria planilha ainda não tem id: o vínculo é novo por
    // definição, e o commit o amarra na segunda passada.
    const bornInFile = targetId === null && managerRow?.action === 'CREATE'
    if (bornInFile || (targetId !== null && targetId !== row.existing.managerId)) {
      row.changes.push('Líder direto')
      row.action = 'UPDATE'
    }
  }

  const counts = Object.fromEntries(USER_IMPORT_ROW_ACTIONS.map((action) => [action, 0])) as Record<
    UserImportRowAction,
    number
  >
  for (const row of rows) counts[row.action] += 1

  const previewRows: UserImportRowPreviewDTO[] = rows.map((row) => ({
    line: row.line,
    name: row.name,
    email: row.email,
    action: row.action,
    sectorName: row.sectorName,
    squadName: row.squadName,
    changes: row.changes,
    issues: row.issues,
  }))

  const preview: UserImportPreviewDTO = {
    fileHash: createHash('sha256').update(buffer).digest('hex'),
    totalRows: rows.length,
    counts,
    rows: previewRows,
    plan: {
      sectorsToCreate: [...sectors.values()]
        .filter((sector) => sector.create)
        .map((sector) => ({ name: sector.name, roles: [...sector.roles] as UserImportRole[] })),
      squadsToCreate: [...squads.values()]
        .filter((squad) => squad.create)
        .map((squad) => ({ name: squad.name, sectorName: sectors.get(squad.sectorKey)?.name ?? '' })),
    },
    blocked: counts.ERROR > 0,
    warnings,
  }

  return { preview, rows, sectors, squads, managerIdByKey }
}

function withinRange(date: Date): boolean {
  const year = date.getUTCFullYear()
  return year >= 1900 && year <= new Date().getUTCFullYear() + 1
}

export async function previewUserImport(actor: UserImportActor, buffer: Buffer): Promise<UserImportPreviewDTO> {
  const { preview } = await resolveImport(actor, buffer)
  return preview
}

export async function commitUserImport(
  actor: UserImportActor,
  buffer: Buffer,
  fileHash: string,
): Promise<UserImportResultDTO> {
  const resolved = await resolveImport(actor, buffer)
  const { preview, rows, sectors, squads, managerIdByKey } = resolved

  if (preview.fileHash !== fileHash) {
    throw new UserImportError('O arquivo mudou depois da pré-visualização. Gere a pré-visualização de novo.', 409)
  }
  if (preview.blocked) {
    const issues = preview.rows.flatMap((row) => row.issues)
    throw new UserImportError(
      `A planilha tem ${preview.counts.ERROR} ${preview.counts.ERROR === 1 ? 'linha' : 'linhas'} com erro. Nada foi criado nem alterado.`,
      422,
      issues,
    )
  }

  // bcrypt custa ~80 ms por senha; 200 linhas seriam ~16 s dentro da transação,
  // muito além do timeout. Nada aqui toca o banco, então fica fora dela.
  const credentials: UserImportCredentialDTO[] = []
  const passwordHashByEmail = new Map<string, string>()
  for (const row of rows) {
    if (row.action !== 'CREATE') continue
    const password = generateTemporaryPassword()
    credentials.push({ name: row.name, email: row.email, password })
    passwordHashByEmail.set(row.email, await hashPassword(password))
  }

  const db = scopedPrisma(actor.companyId)
  const sectorsCreated: string[] = []
  const squadsCreated: string[] = []

  try {
    await db.$transaction(
      async (tx) => {
        const sectorIdByKey = new Map<string, string>()
        for (const [key, sector] of sectors) {
          if (sector.id) {
            sectorIdByKey.set(key, sector.id)
            continue
          }
          const created = await tx.sector.create({
            data: {
              name: sector.name,
              slug: sector.slug,
              enabledFeatures: withEscritorioForced([]),
              roles: { create: [...sector.roles].map((role) => ({ role })) },
            },
          })
          sectorIdByKey.set(key, created.id)
          sectorsCreated.push(sector.name)
          await recordAuditLog({
            actorId: actor.id,
            entityType: 'Sector',
            entityId: created.id,
            action: 'CREATE',
            after: created,
            companyId: actor.companyId,
            tx: tx as unknown as Prisma.TransactionClient,
          })
        }

        const squadIdByKey = new Map<string, string>()
        for (const [key, squad] of squads) {
          if (squad.id) {
            squadIdByKey.set(key, squad.id)
            continue
          }
          const created = await tx.squad.create({
            data: { name: squad.name, slug: squad.slug, sectorId: sectorIdByKey.get(squad.sectorKey)! },
          })
          squadIdByKey.set(key, created.id)
          squadsCreated.push(squad.name)
          await recordAuditLog({
            actorId: actor.id,
            entityType: 'Squad',
            entityId: created.id,
            action: 'CREATE',
            after: created,
            companyId: actor.companyId,
            tx: tx as unknown as Prisma.TransactionClient,
          })
        }

        // Pessoas primeiro sem líder: quem lidera pode estar linhas abaixo, ainda
        // por criar. O vínculo entra na segunda passada, com todo id já existindo.
        const userIdByEmail = new Map<string, string>()
        for (const row of rows) {
          if (row.existing) userIdByEmail.set(row.email, row.existing.id)
        }

        const touched: { id: string; email: string }[] = []
        for (const row of rows) {
          if (row.action !== 'CREATE') continue
          const created = await tx.user.create({
            data: {
              name: row.name,
              email: row.email,
              passwordHash: passwordHashByEmail.get(row.email)!,
              position: row.position ?? undefined,
              squad: row.squadKey ? squads.get(row.squadKey)!.name : undefined,
              role: row.role,
              area: row.area,
              sectorId: sectorIdByKey.get(row.sectorKey!)!,
              ...(row.joinedAt ? { joinedAt: row.joinedAt } : {}),
              birthDate: row.birthDate,
            },
          })
          userIdByEmail.set(row.email, created.id)
          touched.push({ id: created.id, email: row.email })
        }

        for (const row of rows) {
          if (row.action !== 'UPDATE' || !row.existing) continue
          await tx.user.update({
            where: { id: row.existing.id },
            data: {
              ...(row.name ? { name: row.name } : {}),
              ...(row.position ? { position: row.position } : {}),
              ...(row.cells.Papel?.trim() ? { role: row.role } : {}),
              ...(row.area ? { area: row.area } : {}),
              ...(row.sectorKey ? { sectorId: sectorIdByKey.get(row.sectorKey)! } : {}),
              ...(row.squadKey ? { squad: squads.get(row.squadKey)!.name } : {}),
              ...(row.joinedAt ? { joinedAt: row.joinedAt } : {}),
              ...(row.birthDate ? { birthDate: row.birthDate } : {}),
            },
          })
          touched.push({ id: row.existing.id, email: row.email })
        }

        for (const row of rows) {
          if (row.action !== 'CREATE' && row.action !== 'UPDATE') continue
          if (!row.managerKey) continue
          const managerId = managerIdByKey.get(row.email) ?? userIdByEmail.get(row.managerKey)
          const userId = userIdByEmail.get(row.email)
          if (!managerId || !userId) continue
          await tx.user.update({ where: { id: userId }, data: { managerId } })
        }

        for (const row of rows) {
          if (row.action !== 'CREATE' && row.action !== 'UPDATE') continue
          if (!row.squadKey) continue
          const squadId = squadIdByKey.get(row.squadKey)
          const userId = userIdByEmail.get(row.email)
          if (!squadId || !userId) continue
          // `SquadMember` não tem companyId (não passa pelo tenant-scope): o
          // isolamento vem de squadId e userId já terem sido resolvidos dentro
          // do escopo da empresa.
          const already = await tx.squadMember.findUnique({ where: { squadId_userId: { squadId, userId } } })
          if (!already) await tx.squadMember.create({ data: { squadId, userId } })
        }

        const finalUsers = await tx.user.findMany({ where: { id: { in: touched.map((entry) => entry.id) } } })
        for (const user of finalUsers) {
          const { passwordHash: _omit, ...safeUser } = user
          await recordAuditLog({
            actorId: actor.id,
            entityType: 'User',
            entityId: user.id,
            action: preview.rows.find((row) => row.email === user.email.toLowerCase())?.action === 'CREATE' ? 'CREATE' : 'UPDATE',
            after: safeUser,
            companyId: actor.companyId,
            tx: tx as unknown as Prisma.TransactionClient,
          })
        }

        await recordAuditLog({
          actorId: actor.id,
          entityType: 'UserImport',
          entityId: preview.fileHash,
          action: 'CREATE',
          after: {
            totalRows: preview.totalRows,
            created: preview.counts.CREATE,
            updated: preview.counts.UPDATE,
            unchanged: preview.counts.UNCHANGED,
            skipped: preview.counts.SKIP,
            sectorsCreated,
            squadsCreated,
          },
          companyId: actor.companyId,
          tx: tx as unknown as Prisma.TransactionClient,
        })
      },
      { timeout: 30_000, maxWait: 10_000 },
    )
  } catch (err) {
    // Fora da transação de propósito: capturar dentro engoliria a falha e
    // deixaria o lote gravado pela metade. Aqui o rollback já aconteceu.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new UserImportError(
        'Alguém cadastrou um desses e-mails enquanto você confirmava. Gere a pré-visualização de novo.',
        409,
      )
    }
    throw err
  }

  return {
    created: preview.counts.CREATE,
    updated: preview.counts.UPDATE,
    unchanged: preview.counts.UNCHANGED,
    skipped: preview.counts.SKIP,
    sectorsCreated,
    squadsCreated,
    credentials,
  }
}

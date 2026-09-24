import { createHash } from 'node:crypto'
import { Prisma, type Area, type UserRole } from '@prisma/client'
import {
  AREA_LABELS,
  AREAS,
  isPositionCategory,
  POSITION_CATEGORIES,
  USER_IMPORT_COLUMNS,
  USER_IMPORT_COLUMN_ALIASES,
  USER_IMPORT_IGNORED_COLUMNS,
  USER_IMPORT_INACTIVE_STATUSES,
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
import { isMirrorOf, mirrorPhoto, normalizePhotoSourceUrl, PhotoMirrorError } from '../lib/photo-mirror'
import { parseSpreadsheetDate } from '../lib/spreadsheet-values'
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

const INACTIVE_STATUS = new Set(USER_IMPORT_INACTIVE_STATUSES.map(flatten))

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

/**
 * Categoria do cargo (das que indicam liderança) → Papel. Fora daqui,
 * `deriveRoleFromFuncao` cai no fallback conservador: Função=Líder sem
 * categoria de liderança reconhecida vira Líder, nunca Gerente/Head sozinho.
 */
const LEADERSHIP_ROLE_BY_CATEGORY = new Map<string, UserImportRole>([
  ['coordenador', 'LEAD'],
  ['supervisor', 'LEAD'],
  ['team leader', 'LEAD'],
  ['gerente', 'MANAGER'],
  ['head', 'HEAD'],
  ['diretor', 'HEAD'],
])

/**
 * Deriva Papel de Função (Colaborador/Líder) + Categoria do cargo, para
 * planilhas que não trazem a coluna Papel diretamente (export do BI
 * Dashboard de Colaboradores). `null` quando Função não é reconhecida —
 * quem chama mantém o Papel default/já resolvido por outra via.
 */
function deriveRoleFromFuncao(rawFuncao: string, positionCategory: string | null): UserImportRole | null {
  const funcao = flatten(rawFuncao)
  if (funcao === 'colaborador') return 'LEGEND'
  if (funcao !== 'lider') return null
  return LEADERSHIP_ROLE_BY_CATEGORY.get(flatten(positionCategory ?? '')) ?? 'LEAD'
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
  positionCategory: string | null
  /**
   * URL de ORIGEM da foto, já normalizada (`normalizePhotoSourceUrl`). `null` =
   * célula vazia, e a foto gravada fica. O espelho no bucket só é criado no
   * commit — o preview não baixa imagem nenhuma.
   */
  photoSourceUrl: string | null
  /** `null` = a planilha não disse nada, e o que está gravado fica. */
  employmentType: 'CLT' | 'PJ' | null
  joinedAt: Date | null
  birthDate: Date | null
  /** `true` quando o Papel veio explícito (coluna Papel) ou derivado de Função + Categoria do cargo. */
  roleExplicit: boolean
  managerKey: string | null
  /** Valor bruto de "Líder (e-mail)", antes de resolver e-mail vs. nome. `null` = célula vazia. */
  managerRaw: string | null
  existing: ExistingUser | null
  /** `Situação` = Desligado na planilha (seção 4.4 do Documento 3). */
  wantsDeactivation: boolean
  /** `Desligado em`, quando informado; a data de hoje é o padrão. */
  leftAt: Date | null
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
  positionCategory: string | null
  photoUrl: string | null
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
  /** Setor de DESTINO: já é o novo quando a planilha move a squad. */
  sectorKey: string
  active: boolean
  create: boolean
  /**
   * Setor de origem quando a planilha está movendo uma squad que já existe.
   * `null` é o caso normal (squad nova, ou squad que fica onde está).
   */
  moveFromSectorKey?: string | null
  /** Movimento planejado que virou erro: não entra no plano da pré-visualização. */
  moveBlocked?: boolean
}

interface ResolvedImport {
  preview: UserImportPreviewDTO
  rows: RowDraft[]
  sectors: Map<string, SectorRef>
  squads: Map<string, SquadRef>
  managerIdByKey: Map<string, string>
}

/**
 * Linhas que não entram no planejamento de setor, squad e hierarquia.
 *
 * `SKIP` porque nada é alterado, e `DEACTIVATE` porque criar setor ou mover de
 * squad para quem está saindo da empresa seria trabalho sem destinatário.
 */
function skipsPlanning(row: RowDraft): boolean {
  return row.action === 'SKIP' || row.action === 'DEACTIVATE'
}

function addIssue(row: RowDraft, column: UserImportColumn | null, message: string): void {
  row.issues.push({ line: row.line, column, message })
  row.action = 'ERROR'
}

// ─────────────────────────────── leitura ───────────────────────────────

interface HeaderMap {
  columnAt: (UserImportColumn | null)[]
  /**
   * Índice da coluna "Função" (Colaborador/Líder), quando a planilha trouxer
   * uma — não é um `UserImportColumn`: só entra pra derivar Papel junto com
   * Categoria do cargo quando a planilha não traz Papel diretamente (ver
   * `deriveRoleFromFuncao`). `null` quando a planilha não tem essa coluna.
   */
  funcaoIndex: number | null
  warnings: string[]
}

const FUNCAO_HEADER_KEY = flatten('Função')

function mapHeaders(headers: string[]): HeaderMap {
  const warnings: string[] = []
  const columnAt: (UserImportColumn | null)[] = []
  const seen = new Map<UserImportColumn, number>()
  const ignored: string[] = []
  const unknown: string[] = []
  let funcaoIndex: number | null = null

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
    if (key === FUNCAO_HEADER_KEY) {
      if (funcaoIndex !== null) throw new UserImportError('A coluna "Função" aparece duas vezes na planilha.', 400)
      funcaoIndex = index
      return
    }
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
      `${ignored.map((column) => `"${column}"`).join(' e ')} ${ignored.length === 1 ? 'foi ignorada' : 'foram ignoradas'}: a importação não usa ${ignored.length === 1 ? 'essa coluna' : 'essas colunas'}.`,
    )
  }
  if (unknown.length > 0) {
    warnings.push(`${unknown.map((column) => `"${column}"`).join(', ')} não ${unknown.length === 1 ? 'é uma coluna' : 'são colunas'} do modelo e foi ignorada.`)
  }
  return { columnAt, funcaoIndex, warnings }
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
  const { columnAt, funcaoIndex, warnings } = mapHeaders(table.headers)

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
      positionCategory: (cells['Categoria do cargo'] ?? '').trim() || null,
      joinedAt: null,
      birthDate: null,
      roleExplicit: false,
      managerKey: null,
      managerRaw: (cells['Líder (e-mail)'] ?? '').trim() || null,
      existing: null,
      wantsDeactivation: INACTIVE_STATUS.has(flatten(cells['Situação'] ?? '')),
      leftAt: null,
      employmentType: null,
      photoSourceUrl: null,
    }
    rows.push(row)

    const rawPhoto = (cells['Foto (URL)'] ?? '').trim()
    if (rawPhoto) {
      const normalized = normalizePhotoSourceUrl(rawPhoto)
      if (!normalized) addIssue(row, 'Foto (URL)', 'Link inválido. Cole o endereço completo, começando com https://.')
      else row.photoSourceUrl = normalized
    }

    if (!row.name) addIssue(row, 'Nome', 'Informe o nome.')
    if (row.position && row.position.length > 120) addIssue(row, 'Cargo', 'Cargo com mais de 120 caracteres.')
    // Lista fechada: valor de fora dela viraria segmentação que nunca casa —
    // e o curso restrito sumiria de todo mundo, sem erro visível.
    if (row.positionCategory && !isPositionCategory(row.positionCategory)) {
      addIssue(
        row,
        'Categoria do cargo',
        `"${row.positionCategory}" não está na lista (${POSITION_CATEGORIES.join(', ')}).`,
      )
    }

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
        row.roleExplicit = true
      }
    } else if (funcaoIndex !== null) {
      const derived = deriveRoleFromFuncao(record.cells[funcaoIndex] ?? '', row.positionCategory)
      if (derived) {
        row.role = derived
        row.roleExplicit = true
      }
    }

    if (row.managerRaw) {
      if (EMAIL_PATTERN.test(row.managerRaw)) row.managerKey = row.managerRaw.toLowerCase()
      // Valor sem "@": nome curto (planilha da G&G). Resolvido no passo 1b,
      // depois que todas as linhas (e possíveis líderes citados nelas) existem.
    }

    const rawArea = (cells['Área'] ?? '').trim()
    if (rawArea) {
      const area = AREA_BY_LABEL.get(flatten(rawArea))
      if (!area) addIssue(row, 'Área', `Área "${rawArea}" não reconhecida. Use Engenharia, Produto ou deixe em branco.`)
      else row.area = area
    }

    const rawJoinedAt = (cells['Na equipe desde'] ?? '').trim()
    if (rawJoinedAt) {
      const date = parseSpreadsheetDate(rawJoinedAt)
      if (!date) addIssue(row, 'Na equipe desde', 'Data inválida. Use DD/MM/AAAA.')
      else if (!withinRange(date)) addIssue(row, 'Na equipe desde', 'Data fora do intervalo (1900 até um ano à frente).')
      else row.joinedAt = date
    }

    const rawLeftAt = (cells['Desligado em'] ?? '').trim()
    if (rawLeftAt) {
      const date = parseSpreadsheetDate(rawLeftAt)
      if (!date) addIssue(row, 'Desligado em', 'Data inválida. Use DD/MM/AAAA.')
      else if (!withinRange(date)) addIssue(row, 'Desligado em', 'Data fora do intervalo (1900 até um ano à frente).')
      else row.leftAt = date
    }
    // Data de saída sem "Desligado" na Situação é quase sempre erro de
    // preenchimento — e adivinhar a intenção de quem digitou é justamente o que
    // não se deve fazer com desligamento.
    if (row.leftAt && !row.wantsDeactivation) {
      addIssue(row, 'Situação', 'Há data de desligamento, mas a Situação não é "Desligado".')
    }

    // Regime de contratação. Coluna vazia NÃO devolve ninguém para CLT: regime é
    // fato do contrato, e apagá-lo por esquecimento numa carga de 100 linhas só
    // apareceria na programação de férias do ano seguinte.
    const rawContrato = flatten(cells['Tipo de contrato'] ?? '')
    if (rawContrato) {
      if (rawContrato === 'clt') row.employmentType = 'CLT'
      else if (rawContrato === 'pj') row.employmentType = 'PJ'
      else addIssue(row, 'Tipo de contrato', 'Use CLT ou PJ.')
    }

    const rawBirthDate = (cells['Data de nascimento'] ?? '').trim()
    if (rawBirthDate) {
      const date = parseSpreadsheetDate(rawBirthDate)
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

  // ── 1b. líder por nome (planilha da G&G: "Líder" traz o nome curto, não
  // o e-mail — ex. "Waghner Reis" para "Waghner Bruno Reis Soares Silva").
  // Resolve contra as outras linhas do arquivo e contra quem já existe na
  // empresa; sem casamento único, erra a linha em vez de arriscar hierarquia
  // errada (ver design em docs/superpowers — importação aceita a planilha do BI).
  const rowsWithNamedManager = rows.filter((row) => row.managerRaw && row.managerKey === null)
  if (rowsWithNamedManager.length > 0) {
    const companyUsers = await scopedPrisma(actor.companyId).user.findMany({
      where: { active: true, leftAt: null },
      select: { name: true, email: true },
    })
    const candidatesByEmail = new Map<string, string[]>()
    for (const row of rows) {
      if (!row.email || !row.name) continue
      if (!candidatesByEmail.has(row.email)) candidatesByEmail.set(row.email, flatten(row.name).split(' '))
    }
    for (const user of companyUsers) {
      const email = user.email.toLowerCase()
      if (!candidatesByEmail.has(email)) candidatesByEmail.set(email, flatten(user.name).split(' '))
    }

    for (const row of rowsWithNamedManager) {
      const [first, ...rest] = flatten(row.managerRaw!).split(' ')
      const matches = new Set<string>()
      for (const [email, words] of candidatesByEmail) {
        if (words[0] !== first) continue
        if (rest.every((word) => words.slice(1).some((candidateWord) => candidateWord.includes(word)))) {
          matches.add(email)
        }
      }
      if (matches.size === 1) row.managerKey = [...matches][0]
      else if (matches.size === 0) {
        addIssue(row, 'Líder (e-mail)', `Líder "${row.managerRaw}" não encontrado. Preencha com o e-mail.`)
      } else {
        addIssue(
          row,
          'Líder (e-mail)',
          `Líder "${row.managerRaw}" é ambíguo (${matches.size} pessoas com esse nome). Preencha com o e-mail.`,
        )
      }
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
                 position, "positionCategory", "photoUrl", squad, "managerId", area, "joinedAt", "birthDate"
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
      // A planilha desliga, mas NÃO reativa (ver `USER_IMPORT_INACTIVE_STATUSES`):
      // reabrir acesso de quem saiu da empresa por causa de uma célula errada não
      // se desfaz, ao contrário de um desligamento indevido.
      row.action = 'SKIP'
      row.changes = ['Pessoa já desligada — nada foi alterado. A importação não reativa ninguém.']
      continue
    }
    if (row.wantsDeactivation) {
      // Desativar é o fim da linha para esta pessoa nesta importação: não faz
      // sentido também mudar cargo ou setor de quem está saindo.
      row.action = 'DEACTIVATE'
      row.changes = ['Desativar — sai das listagens e não entra mais. Histórico preservado.']
      continue
    }
  }

  // ── 3. papel efetivo de cada linha
  //
  // Coluna Papel em branco (e sem Função+Categoria do cargo que a substitua)
  // quer dizer "não mexe", igual a qualquer outra. Sem isto o default
  // `LEGEND` seria validado contra o setor e recusaria um MANAGER num setor
  // que não habilita Lenda — sem que papel nenhum fosse mudar — e ainda
  // faria um setor novo nascer sem o papel de quem vai para lá.
  for (const row of rows) {
    if (row.roleExplicit) continue
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
    if (skipsPlanning(row)) continue
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
    if (skipsPlanning(row)) continue
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
  //
  // A planilha é fonte da verdade do organograma: ela cria setor, cria squad e
  // move pessoa de setor. Aqui ela também **move a squad** — quando todas as
  // linhas que a citam apontam para um setor diferente do atual, a squad vai
  // junto com a gente dela. O que ela nunca faz é rachar uma squad entre dois
  // setores, e por isso a decisão é da planilha inteira (`squadClaims`), não da
  // primeira linha que aparecer.
  const sectorLabel = (key: string): string => sectors.get(key)?.name ?? key
  const squadClaims = new Map<string, { sectorKey: string; rows: RowDraft[] }>()

  for (const row of rows) {
    if (!row.squadName || !row.sectorKey) continue
    if (row.action === 'ERROR' || skipsPlanning(row)) continue

    const slug = slugify(row.squadName)
    if (!slug) {
      addIssue(row, 'Squad', `A squad "${row.squadName}" precisa ter ao menos uma letra ou número no nome.`)
      continue
    }
    row.squadKey = slug

    const existing = squads.get(slug)
    if (existing && !existing.active) {
      // Desativar é ato deliberado da tela; a planilha vem de fora, com nome
      // digitado por gente. Reativar em silêncio desfaria a decisão do admin.
      addIssue(row, 'Squad', `A squad "${existing.name}" está desativada. Reative-a em Administração › Squads.`)
      continue
    }

    const claim = squadClaims.get(slug)
    if (claim) {
      if (claim.sectorKey !== row.sectorKey) {
        // Culpar só a segunda linha esconderia metade do conflito.
        const name = existing?.name ?? row.squadName
        const message = `A squad "${name}" aparece na planilha em dois setores ("${sectorLabel(claim.sectorKey)}" e "${sectorLabel(row.sectorKey)}"). Uma squad pertence a um setor só.`
        addIssue(row, 'Squad', message)
        for (const previous of claim.rows) addIssue(previous, 'Squad', message)
        continue
      }
      claim.rows.push(row)
      if (existing) row.squadName = existing.name
      continue
    }

    if (existing) {
      squadClaims.set(slug, { sectorKey: row.sectorKey, rows: [row] })
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

    squadClaims.set(slug, { sectorKey: row.sectorKey, rows: [row] })
    squads.set(slug, { id: null, name: row.squadName, slug, sectorKey: row.sectorKey, active: true, create: true })
  }

  // ── 6.1. squads que a planilha move de setor
  //
  // O destino só entra em `sectorKey` depois que todas as linhas concordaram —
  // decidir na primeira linha faria a pré-visualização anunciar um movimento
  // que a linha seguinte contradiz.
  for (const [slug, claim] of squadClaims) {
    const squad = squads.get(slug)
    if (!squad || squad.create) continue
    if (squad.sectorKey === claim.sectorKey) continue
    if (claim.rows.every((row) => row.action === 'ERROR')) continue
    squad.moveFromSectorKey = squad.sectorKey
    squad.sectorKey = claim.sectorKey
  }

  // Mover a squad só é honesto se ninguém ficar para trás: integrante que
  // continua no setor antigo ficaria numa squad de outro setor — o estado que
  // `addMember` recusa na tela, e que `updateSquad` recusa para o líder. A
  // importação não pode ser a porta dos fundos para ele. Por isso a conferência
  // é sobre TODO integrante ativo do banco (não só quem está na planilha) mais
  // o líder, e não sobre as linhas do arquivo.
  const movingSquads = [...squads.values()].filter((squad) => squad.id && squad.moveFromSectorKey)
  if (movingSquads.length > 0) {
    const movingIds = movingSquads.map((squad) => squad.id!)
    const [movingMembers, movingSquadRows] = await Promise.all([
      prisma.squadMember.findMany({
        where: { squadId: { in: movingIds }, user: { active: true, leftAt: null } },
        select: { squadId: true, user: { select: { id: true, name: true, email: true, sectorId: true } } },
      }),
      prisma.squad.findMany({
        where: { id: { in: movingIds }, leaderId: { not: null } },
        select: { id: true, leader: { select: { id: true, name: true, email: true, sectorId: true, active: true, leftAt: true } } },
      }),
    ])

    const peopleBySquad = new Map<string, { id: string; name: string; email: string; sectorId: string }[]>()
    const push = (squadId: string, person: { id: string; name: string; email: string; sectorId: string }) => {
      const bucket = peopleBySquad.get(squadId) ?? []
      if (!bucket.some((entry) => entry.id === person.id)) bucket.push(person)
      peopleBySquad.set(squadId, bucket)
    }
    for (const member of movingMembers) push(member.squadId, member.user)
    for (const squadRow of movingSquadRows) {
      const leader = squadRow.leader
      if (leader && leader.active && !leader.leftAt) push(squadRow.id, leader)
    }

    for (const squad of movingSquads) {
      const claim = squadClaims.get(squad.slug)!
      const leftBehind: string[] = []
      for (const person of peopleBySquad.get(squad.id!) ?? []) {
        const personRow = rows.find((row) => row.email === person.email.toLowerCase())
        // Quem a planilha desliga não conta: está saindo da empresa.
        if (personRow && (personRow.action === 'DEACTIVATE' || personRow.action === 'SKIP')) continue
        const targetKey =
          personRow && personRow.action !== 'ERROR' && personRow.sectorKey
            ? personRow.sectorKey
            : (sectorById.get(person.sectorId)?.slug ?? '')
        if (targetKey !== squad.sectorKey) leftBehind.push(person.name)
      }
      if (leftBehind.length === 0) continue

      squad.moveBlocked = true
      const names = leftBehind.slice(0, 3).join(', ')
      const rest = leftBehind.length > 3 ? ` e mais ${leftBehind.length - 3}` : ''
      const message = `A squad "${squad.name}" é do setor "${sectorLabel(squad.moveFromSectorKey!)}" e a planilha a levaria para "${sectorLabel(squad.sectorKey)}", mas ${names}${rest} ${leftBehind.length === 1 ? 'continua' : 'continuam'} fora desse setor. Traga ${leftBehind.length === 1 ? 'essa pessoa' : 'essas pessoas'} na planilha para "${sectorLabel(squad.sectorKey)}" ou tire ${leftBehind.length === 1 ? 'ela' : 'elas'} da squad em Administração › Squads.`
      for (const row of claim.rows) addIssue(row, 'Squad', message)
    }
  }

  // ── 7. o que muda em quem já existe
  for (const row of rows) {
    const existing = row.existing
    if (!existing || row.action === 'ERROR' || skipsPlanning(row)) continue

    const targetSector = row.sectorKey ? sectors.get(row.sectorKey) : undefined
    // Setor que a planilha ainda vai criar não tem id, mas mover alguém para
    // ele é uma mudança como qualquer outra — e é o que o commit vai gravar.
    // Tratar como "nada mudou" escondia o movimento de quem revisa e pulava a
    // checagem de squad presa ao setor atual.
    const changingSector = targetSector !== undefined && targetSector.id !== existing.sectorId
    if (changingSector) {
      const stuck = (membershipsByUser.get(existing.id) ?? []).find((membership) => {
        if (membership.squad.sectorId !== existing.sectorId) return false
        // Squad que a seção 6 leva junto para o setor de destino não prende
        // ninguém — recusar aqui desfaria o movimento recém-planejado.
        const planned = squads.get(membership.squad.slug)
        return !(planned && planned.moveFromSectorKey && planned.sectorKey === row.sectorKey)
      })
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
    if (row.positionCategory && row.positionCategory !== existing.positionCategory) {
      changes.push(`Categoria do cargo: "${existing.positionCategory ?? ''}" → "${row.positionCategory}"`)
    }
    if (row.roleExplicit && row.role !== existing.role) {
      changes.push(`Papel: ${USER_ROLE_LABELS[existing.role]} → ${USER_ROLE_LABELS[row.role]}`)
    }
    if (changingSector) changes.push(`Setor: "${sectorById.get(existing.sectorId)?.name ?? ''}" → "${row.sectorName}"`)
    if (row.area && row.area !== existing.area) changes.push(`Área: ${AREA_LABELS[row.area]}`)
    if (row.joinedAt && !sameDay(row.joinedAt, existing.joinedAt)) changes.push('Na equipe desde')
    if (row.birthDate && !sameDay(row.birthDate, existing.birthDate)) changes.push('Data de nascimento')
    // Comparação por ORIGEM, não pela URL final: o espelho tem nome derivado do
    // link da planilha, então reimportar o mesmo arquivo não vira "Foto" toda
    // vez — e nem rebaixa a imagem. Ver `lib/photo-mirror.ts`.
    if (row.photoSourceUrl && !isMirrorOf(existing.photoUrl, actor.companyId, row.photoSourceUrl)) {
      changes.push(existing.photoUrl ? 'Foto (substituída)' : 'Foto')
    }

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
    .filter((row) => row.action !== 'ERROR' && !skipsPlanning(row) && row.email)
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
      squadsToMove: [...squads.values()]
        .filter((squad) => squad.moveFromSectorKey && !squad.moveBlocked)
        .map((squad) => ({
          name: squad.name,
          fromSectorName: sectors.get(squad.moveFromSectorKey!)?.name ?? '',
          toSectorName: sectors.get(squad.sectorKey)?.name ?? '',
        })),
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

  // Fotos: baixar e re-hospedar ANTES da transação, pelo mesmo motivo do bcrypt —
  // são chamadas de rede a um servidor de terceiro, e 200 delas dentro da
  // transação estourariam o timeout com o banco travado esperando o Google.
  //
  // Falha aqui é AVISO, não erro: o link do Drive pode estar fechado, e travar o
  // cadastro inteiro de 100 pessoas por causa de uma permissão de arquivo seria
  // desproporcional. A linha entra sem mexer na foto, e o resultado diz quais.
  const photoUrlByEmail = new Map<string, string>()
  const photoWarnings: string[] = []
  const mirroredBySource = new Map<string, string>()
  for (const row of rows) {
    if (row.action !== 'CREATE' && row.action !== 'UPDATE') continue
    const source = row.photoSourceUrl
    if (!source) continue
    if (row.existing && isMirrorOf(row.existing.photoUrl, actor.companyId, source)) continue

    const already = mirroredBySource.get(source)
    if (already) {
      photoUrlByEmail.set(row.email, already)
      continue
    }
    try {
      const mirrored = await mirrorPhoto(source, actor.companyId)
      mirroredBySource.set(source, mirrored)
      photoUrlByEmail.set(row.email, mirrored)
    } catch (error) {
      if (!(error instanceof PhotoMirrorError)) throw error
      photoWarnings.push(`Linha ${row.line} (${row.name}): a foto não foi importada — ${error.message}.`)
    }
  }

  const db = scopedPrisma(actor.companyId)
  const sectorsCreated: string[] = []
  const squadsCreated: string[] = []
  const squadsMoved: string[] = []

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
            if (squad.moveFromSectorKey) {
              const before = await tx.squad.findUnique({ where: { id: squad.id } })
              const moved = await tx.squad.update({
                where: { id: squad.id },
                data: { sectorId: sectorIdByKey.get(squad.sectorKey)! },
              })
              squadsMoved.push(squad.name)
              await recordAuditLog({
                actorId: actor.id,
                entityType: 'Squad',
                entityId: squad.id,
                action: 'UPDATE',
                before,
                after: moved,
                companyId: actor.companyId,
                tx: tx as unknown as Prisma.TransactionClient,
              })
            }
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
              positionCategory: row.positionCategory ?? undefined,
              squad: row.squadKey ? squads.get(row.squadKey)!.name : undefined,
              role: row.role,
              area: row.area,
              sectorId: sectorIdByKey.get(row.sectorKey!)!,
              ...(row.joinedAt ? { joinedAt: row.joinedAt } : {}),
              ...(row.employmentType ? { employmentType: row.employmentType } : {}),
              ...(photoUrlByEmail.has(row.email) ? { photoUrl: photoUrlByEmail.get(row.email) } : {}),
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
              ...(row.positionCategory ? { positionCategory: row.positionCategory } : {}),
              ...(row.roleExplicit ? { role: row.role } : {}),
              ...(row.area ? { area: row.area } : {}),
              ...(row.sectorKey ? { sectorId: sectorIdByKey.get(row.sectorKey)! } : {}),
              ...(row.squadKey ? { squad: squads.get(row.squadKey)!.name } : {}),
              ...(row.joinedAt ? { joinedAt: row.joinedAt } : {}),
              ...(row.employmentType ? { employmentType: row.employmentType } : {}),
              ...(row.birthDate ? { birthDate: row.birthDate } : {}),
              ...(photoUrlByEmail.has(row.email) ? { photoUrl: photoUrlByEmail.get(row.email) } : {}),
            },
          })
          touched.push({ id: row.existing.id, email: row.email })
        }

        // Desativação por planilha (seção 4.4 do Documento 3). Desativar NÃO é
        // apagar: pontos, EMR Coins, feedbacks e selos ficam onde estão — a
        // pessoa some das listagens e não entra mais. É isso que permite a
        // planilha ser fonte da verdade sem destruir histórico.
        for (const row of rows) {
          if (row.action !== 'DEACTIVATE' || !row.existing) continue
          await tx.user.update({
            where: { id: row.existing.id },
            data: { active: false, leftAt: row.leftAt ?? new Date() },
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
            action:
              preview.rows.find((row) => row.email === user.email.toLowerCase())?.action === 'CREATE'
                ? 'CREATE'
                : 'UPDATE',
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
            deactivated: preview.counts.DEACTIVATE,
            skipped: preview.counts.SKIP,
            sectorsCreated,
            squadsCreated,
            squadsMoved,
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
    squadsMoved,
    credentials,
    photosImported: photoUrlByEmail.size,
    photoWarnings,
  }
}

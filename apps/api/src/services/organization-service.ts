import type { Prisma, Sector, User } from '@prisma/client'
import type {
  OrganizationChartDTO,
  OrganizationNodeDTO,
  OrganizationPersonDTO,
  UserRole,
} from '@legends/shared'
import { prisma } from '../lib/prisma'
import { sanitizeAvatarOptions, sanitizeAvatarStyle } from '../lib/serialize'
import { scopedPrisma } from '../lib/tenant-scope'

const ORGANIZATION_ROLES = ['HEAD', 'MANAGER', 'LEAD', 'LEGEND'] as const satisfies readonly UserRole[]

/**
 * Quem existe na cadeia de comando. É a **única** definição de elegibilidade:
 * o organograma desenha exatamente estas pessoas, e o escopo de liderança
 * (`team-scope-service`) lê daqui para "meu time" ser o mesmo nos dois lugares.
 * Fora: contas administrativas, terceirizados, desligados e setor desativado.
 */
export const ORGANIZATION_MEMBER_WHERE: Prisma.UserWhereInput = {
  active: true,
  leftAt: null,
  role: { in: [...ORGANIZATION_ROLES] },
  sector: { active: true },
}

export class OrganizationError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'OrganizationError'
  }
}

function toPerson(user: User & { sector: Pick<Sector, 'name'> }): OrganizationPersonDTO {
  return {
    id: user.id,
    name: user.name,
    position: user.position,
    role: user.role,
    sectorId: user.sectorId,
    sectorName: user.sector.name,
    photoUrl: user.photoUrl,
    avatarStyle: sanitizeAvatarStyle(user.avatarStyle),
    avatarSeed: user.avatarSeed,
    avatarOptions: sanitizeAvatarOptions(user.avatarOptions),
  }
}

/** Mais liderados primeiro; empate pelo nome. Dá o mesmo desenho do modelo de referência. */
function byHierarchy(a: OrganizationNodeDTO, b: OrganizationNodeDTO): number {
  return b.reportsCount - a.reportsCount || a.name.localeCompare(b.name, 'pt-BR')
}

/**
 * `managerId` é um campo livre, então nada no banco impede A→B→A. Quebra o elo
 * que fecha o ciclo (promovendo esse nó a raiz) para a árvore nunca ser infinita.
 * Muta `managerOf` no lugar.
 */
function breakCycles(managerOf: Map<string, string | null>): void {
  const validated = new Set<string>()
  for (const start of managerOf.keys()) {
    const path: string[] = []
    const inPath = new Set<string>()
    let current: string | null = start
    while (current && !validated.has(current)) {
      if (inPath.has(current)) {
        managerOf.set(current, null)
        break
      }
      inPath.add(current)
      path.push(current)
      current = managerOf.get(current) ?? null
    }
    for (const id of path) validated.add(id)
  }
}

/** Preenche `reportsCount` de baixo para cima e ordena cada nível. */
function settleSubtree(node: OrganizationNodeDTO): number {
  let total = 0
  for (const report of node.reports) total += settleSubtree(report) + 1
  node.reportsCount = total
  node.reports.sort(byHierarchy)
  return total
}

/** Monta a visão pública do organograma, sempre isolada à empresa autenticada. */
export async function getOrganizationChart(companyId: string): Promise<OrganizationChartDTO> {
  const [company, users] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true } }),
    scopedPrisma(companyId).user.findMany({
      where: { ...ORGANIZATION_MEMBER_WHERE },
      include: { sector: { select: { name: true } } },
      orderBy: { name: 'asc' },
    }),
  ])

  if (!company) throw new Error(`Empresa ${companyId} não encontrada`)

  const eligibleIds = new Set(users.map((user) => user.id))
  // Líder que não está na árvore (saiu, virou admin, setor desativado) não conta:
  // quem respondia a ele sobe para a raiz em vez de sumir.
  const managerOf = new Map<string, string | null>(
    users.map((user) => [
      user.id,
      user.managerId && eligibleIds.has(user.managerId) ? user.managerId : null,
    ]),
  )
  breakCycles(managerOf)

  const nodes = new Map<string, OrganizationNodeDTO>(
    users.map((user) => [user.id, { ...toPerson(user), reports: [], reportsCount: 0 }]),
  )
  const roots: OrganizationNodeDTO[] = []
  for (const user of users) {
    const node = nodes.get(user.id)!
    const managerId = managerOf.get(user.id)
    const manager = managerId ? nodes.get(managerId) : undefined
    if (manager) manager.reports.push(node)
    else roots.push(node)
  }

  for (const root of roots) settleSubtree(root)
  roots.sort(byHierarchy)

  return {
    company: { id: company.id, name: company.name },
    roots,
    totalPeople: users.length,
  }
}

/**
 * Recorte do organograma para a entrada da **Liderança**: a pessoa autenticada
 * no topo e quem responde diretamente a ela. Um nível só, de propósito — essa
 * entrada responde "quem é o meu time", não "como a empresa se organiza"; a
 * visão completa continua em `GET /organization`.
 *
 * Sem liderado direto a resposta vem vazia (`roots: []`), e não com o card
 * solitário de quem pediu: uma pessoa sozinha na tela passaria por organograma
 * quebrado em vez de "você ainda não tem liderados".
 */
export async function getDirectReportsChart(
  companyId: string,
  userId: string,
): Promise<OrganizationChartDTO> {
  const [company, viewer, reports] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true } }),
    scopedPrisma(companyId).user.findUnique({
      where: { id: userId },
      include: { sector: { select: { name: true } } },
    }),
    scopedPrisma(companyId).user.findMany({
      where: { managerId: userId, ...ORGANIZATION_MEMBER_WHERE },
      include: { sector: { select: { name: true } } },
      orderBy: { name: 'asc' },
    }),
  ])

  if (!company) throw new Error(`Empresa ${companyId} não encontrada`)

  const chartCompany = { id: company.id, name: company.name }
  if (!viewer || reports.length === 0) return { company: chartCompany, roots: [], totalPeople: 0 }

  // `reportsCount` é o tamanho da subárvore **desta** resposta: como ela para no
  // primeiro nível, quem lidera alguém mais abaixo aparece aqui como folha.
  const root: OrganizationNodeDTO = {
    ...toPerson(viewer),
    reports: reports.map((report) => ({ ...toPerson(report), reports: [], reportsCount: 0 })),
    reportsCount: reports.length,
  }

  return { company: chartCompany, roots: [root], totalPeople: reports.length + 1 }
}

/**
 * Valida um `managerId` antes de gravar. Fora as checagens óbvias, barra o ciclo
 * na escrita — a leitura sabe se defender, mas hierarquia circular gravada é dado
 * ruim que ninguém consegue enxergar pela tela.
 */
export async function assertManagerAssignable(
  companyId: string,
  /** `null` na criação: quem ainda não existe não tem liderados, logo não fecha ciclo. */
  userId: string | null,
  managerId: string | null,
): Promise<void> {
  if (managerId === null) return
  if (managerId === userId) {
    throw new OrganizationError('Uma pessoa não pode ser o próprio líder direto.', 400)
  }

  const manager = await scopedPrisma(companyId).user.findUnique({ where: { id: managerId } })
  if (!manager) throw new OrganizationError('Líder direto inválido.', 400)
  if (!manager.active || manager.leftAt !== null || !ORGANIZATION_ROLES.includes(manager.role as (typeof ORGANIZATION_ROLES)[number])) {
    throw new OrganizationError('O líder direto precisa ser um colaborador ativo.', 400)
  }

  const rows = await scopedPrisma(companyId).user.findMany({ select: { id: true, managerId: true } })
  const managerOf = new Map(rows.map((row) => [row.id, row.managerId]))
  const seen = new Set<string>(userId ? [userId] : [])
  let current: string | null = managerId
  while (current) {
    if (seen.has(current)) {
      throw new OrganizationError('Esse líder direto criaria um ciclo na hierarquia.', 400)
    }
    seen.add(current)
    current = managerOf.get(current) ?? null
  }
}

/**
 * Uma pessoa do lote: a chave é o e-mail do próprio arquivo, **em minúsculas**
 * — é assim que ele casa com o e-mail de quem já está no banco.
 */
export interface ManagerGraphEntry {
  key: string
  /** E-mail do líder, também em minúsculas; `null` quando a linha não informa. */
  managerKey: string | null
  /** Id de quem já existe no banco; `null` para quem ainda vai ser criado. */
  existingId: string | null
  role: UserRole
}

export interface ManagerGraphIssue {
  key: string
  message: string
}

export interface ManagerGraphResult {
  issues: ManagerGraphIssue[]
  /**
   * Chave da linha → id do líder, para os líderes que **já existem** no banco.
   * Quem tem o líder na própria planilha fica de fora: esse id só nasce no
   * commit, e é lá que ele é amarrado.
   */
  managerIdByKey: Map<string, string>
}

/**
 * Versão em lote de `assertManagerAssignable`, para a importação por planilha.
 *
 * Não dá pra chamar a individual linha a linha por duas razões. Ela varre a
 * tabela de usuários inteira a cada chamada — 200 linhas, 200 varreduras. E,
 * pior, ela só enxerga quem já existe: numa planilha o líder costuma estar
 * algumas linhas abaixo, ainda por criar, e seria recusado como inexistente.
 *
 * Aqui o grafo existente é carregado **uma vez** e fundido com as linhas do
 * arquivo, então a detecção de ciclo enxerga as duas metades. As mensagens são
 * as mesmas da validação individual, de propósito.
 */
export async function assertManagerGraphAssignable(
  companyId: string,
  entries: ManagerGraphEntry[],
): Promise<ManagerGraphResult> {
  const issues: ManagerGraphIssue[] = []
  const managerIdByKey = new Map<string, string>()
  const byKey = new Map(entries.map((entry) => [entry.key, entry]))

  // Uma consulta só para as duas perguntas: o grafo atual (id → líder) e quem é
  // o dono de cada e-mail. Buscar o líder linha a linha faria uma ida ao banco
  // por linha da planilha, que é justamente o que esta versão em lote evita.
  const rows = await scopedPrisma(companyId).user.findMany({
    select: { id: true, managerId: true, email: true, active: true, leftAt: true, role: true },
  })
  const managerOfId = new Map(rows.map((row) => [row.id, row.managerId]))
  const userByEmail = new Map(rows.map((row) => [row.email.toLowerCase(), row]))

  // Grafo unificado: quem já existe entra pelo id, quem vem da planilha entra
  // pela própria chave. O que a planilha diz vence o que está no banco — é
  // exatamente o que o commit vai gravar.
  const managerOf = new Map<string, string | null>()
  for (const [id, managerId] of managerOfId) managerOf.set(id, managerId)
  for (const entry of entries) {
    const self = entry.existingId ?? entry.key
    const target = entry.managerKey ? (byKey.get(entry.managerKey)?.existingId ?? entry.managerKey) : null
    if (entry.managerKey === null && entry.existingId) continue // linha sem líder não mexe no vínculo atual
    managerOf.set(self, target)
  }

  for (const entry of entries) {
    if (!entry.managerKey) continue
    const self = entry.existingId ?? entry.key
    if (entry.managerKey === entry.key) {
      issues.push({ key: entry.key, message: 'Uma pessoa não pode ser o próprio líder direto.' })
      continue
    }

    const inFile = byKey.get(entry.managerKey)
    if (inFile) {
      if (!ORGANIZATION_ROLES.includes(inFile.role as (typeof ORGANIZATION_ROLES)[number])) {
        issues.push({ key: entry.key, message: 'O líder direto precisa ser um colaborador ativo.' })
        continue
      }
    } else {
      const manager = userByEmail.get(entry.managerKey)
      if (!manager) {
        issues.push({
          key: entry.key,
          message: `Líder direto não encontrado: nenhum colaborador com o e-mail "${entry.managerKey}".`,
        })
        continue
      }
      if (
        !manager.active ||
        manager.leftAt !== null ||
        !ORGANIZATION_ROLES.includes(manager.role as (typeof ORGANIZATION_ROLES)[number])
      ) {
        issues.push({ key: entry.key, message: 'O líder direto precisa ser um colaborador ativo.' })
        continue
      }
      managerOf.set(self, manager.id)
      managerIdByKey.set(entry.key, manager.id)
    }

    const seen = new Set<string>([self])
    let current: string | null = managerOf.get(self) ?? null
    while (current) {
      if (seen.has(current)) {
        issues.push({ key: entry.key, message: 'Esse líder direto criaria um ciclo na hierarquia.' })
        break
      }
      seen.add(current)
      current = managerOf.get(current) ?? null
    }
  }

  return { issues, managerIdByKey }
}

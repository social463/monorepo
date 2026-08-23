import { describe, expect, it } from 'vitest'
import { DEFAULT_COMPANY_ID, type OrganizationChartDTO, type OrganizationNodeDTO } from '@legends/shared'
import { buildApp } from '../app'
import { signAccessToken } from '../lib/jwt'
import { prisma } from '../lib/prisma'

async function registerAndToken(app: ReturnType<typeof buildApp>, email: string) {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Pessoa atual', email, password: 'changeme123' },
  })
  return response.json().accessToken as string
}

function names(nodes: OrganizationNodeDTO[]): string[] {
  return nodes.map((node) => node.name)
}

function findNode(nodes: OrganizationNodeDTO[], name: string): OrganizationNodeDTO | null {
  for (const node of nodes) {
    if (node.name === name) return node
    const found = findNode(node.reports, name)
    if (found) return found
  }
  return null
}

describe('GET /organization', () => {
  it('monta a cadeia de comando a partir do líder direto', async () => {
    const app = buildApp()
    await app.ready()
    const token = await registerAndToken(app, 'viewer-organization@empresa.com')
    const inactiveSector = await prisma.sector.create({
      data: {
        name: 'Setor inativo',
        slug: 'setor-inativo-organization-test',
        active: false,
        enabledFeatures: ['time'],
        companyId: DEFAULT_COMPANY_ID,
      },
    })

    const ceo = await prisma.user.create({
      data: { name: 'Ana Head', email: 'head-org@empresa.com', passwordHash: 'x', role: 'HEAD', position: 'CEO' },
    })
    const cto = await prisma.user.create({
      data: { name: 'Bruno Manager', email: 'manager-org@empresa.com', passwordHash: 'x', role: 'MANAGER', managerId: ceo.id },
    })
    const lead = await prisma.user.create({
      data: {
        name: 'Carla Lead',
        email: 'lead-org@empresa.com',
        passwordHash: 'x',
        role: 'LEAD',
        managerId: cto.id,
        teamsWebhookUrl: 'https://secret.invalid',
      },
    })
    await prisma.user.create({
      data: { name: 'Diego Dev', email: 'dev-org@empresa.com', passwordHash: 'x', position: 'Dev sênior', managerId: lead.id },
    })
    // Líder que saiu da árvore: quem respondia a ele sobe para a raiz, não some.
    const desligado = await prisma.user.create({
      data: { name: 'Fabio Desligado', email: 'left-org@empresa.com', passwordHash: 'x', active: false },
    })
    await prisma.user.create({
      data: { name: 'Gabi Órfã', email: 'orphan-org@empresa.com', passwordHash: 'x', managerId: desligado.id },
    })

    await prisma.user.create({
      data: { name: 'Admin oculto', email: 'admin-org@empresa.com', passwordHash: 'x', role: 'ADMIN' },
    })
    await prisma.user.create({
      data: { name: 'Terceiro oculto', email: 'third-org@empresa.com', passwordHash: 'x', role: 'THIRD_PARTY' },
    })
    await prisma.user.create({
      data: { name: 'Setor inativo oculto', email: 'inactive-sector-org@empresa.com', passwordHash: 'x', sectorId: inactiveSector.id },
    })

    const otherCompany = await prisma.company.create({
      data: { name: 'Outra Empresa Org', slug: 'outra-empresa-org-test' },
    })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor externo', slug: 'setor-externo-org-test', enabledFeatures: ['time'], companyId: otherCompany.id },
    })
    await prisma.user.create({
      data: {
        name: 'Pessoa externa',
        email: 'external-org@empresa.com',
        passwordHash: 'x',
        companyId: otherCompany.id,
        sectorId: otherSector.id,
      },
    })

    const response = await app.inject({
      method: 'GET',
      url: '/organization',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(200)
    const chart = response.json() as OrganizationChartDTO
    expect(chart.company.id).toBe(DEFAULT_COMPANY_ID)
    // 5 elegíveis: Ana, Bruno, Carla, Diego, Gabi e a própria Pessoa atual.
    expect(chart.totalPeople).toBe(6)

    // Raízes ordenadas por tamanho da equipe; quem não tem líder elegível também é raiz.
    expect(names(chart.roots)).toEqual(['Ana Head', 'Gabi Órfã', 'Pessoa atual'])

    const ana = chart.roots[0]
    expect(ana.reportsCount).toBe(3)
    expect(names(ana.reports)).toEqual(['Bruno Manager'])
    expect(ana.reports[0].reportsCount).toBe(2)
    expect(names(ana.reports[0].reports)).toEqual(['Carla Lead'])
    expect(names(ana.reports[0].reports[0].reports)).toEqual(['Diego Dev'])
    expect(ana.reports[0].reports[0].reports[0].reportsCount).toBe(0)

    const diego = findNode(chart.roots, 'Diego Dev')!
    expect(diego.position).toBe('Dev sênior')
    expect(diego.sectorName).toBe('Desenvolvimento de Produto')

    const serializedLead = JSON.stringify(findNode(chart.roots, 'Carla Lead'))
    expect(serializedLead).not.toContain('lead-org@empresa.com')
    expect(serializedLead).not.toContain('secret.invalid')
    expect(JSON.stringify(chart)).not.toContain('Pessoa externa')
    expect(JSON.stringify(chart)).not.toContain('Admin oculto')
    expect(JSON.stringify(chart)).not.toContain('Terceiro oculto')
    expect(JSON.stringify(chart)).not.toContain('Setor inativo oculto')
    expect(JSON.stringify(chart)).not.toContain('Fabio Desligado')
    await app.close()
  })

  it('não entra em laço quando a hierarquia gravada tem ciclo', async () => {
    const app = buildApp()
    await app.ready()
    const token = await registerAndToken(app, 'viewer-cycle-org@empresa.com')

    const a = await prisma.user.create({
      data: { name: 'Ciclo A', email: 'cycle-a-org@empresa.com', passwordHash: 'x' },
    })
    const b = await prisma.user.create({
      data: { name: 'Ciclo B', email: 'cycle-b-org@empresa.com', passwordHash: 'x', managerId: a.id },
    })
    // Fecha o ciclo por fora da validação da rota, simulando dado legado ruim.
    await prisma.user.update({ where: { id: a.id }, data: { managerId: b.id } })

    const response = await app.inject({
      method: 'GET',
      url: '/organization',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(200)
    const chart = response.json() as OrganizationChartDTO
    expect(chart.totalPeople).toBe(3)
    // O elo que fecha o ciclo é rompido: ninguém some e ninguém aparece duas vezes.
    expect(findNode(chart.roots, 'Ciclo A')).not.toBeNull()
    expect(findNode(chart.roots, 'Ciclo B')).not.toBeNull()
    await app.close()
  })

  it('exige autenticação e a feature time', async () => {
    const app = buildApp()
    await app.ready()
    const unauthenticated = await app.inject({ method: 'GET', url: '/organization' })
    expect(unauthenticated.statusCode).toBe(401)

    const user = await prisma.user.create({
      data: { name: 'Sem feature', email: 'sem-feature-org@empresa.com', passwordHash: 'x' },
    })
    const token = signAccessToken(app, user, [])
    const forbidden = await app.inject({
      method: 'GET',
      url: '/organization',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(forbidden.statusCode).toBe(403)
    await app.close()
  })
})

describe('GET /organization/direct-reports', () => {
  it('devolve só quem responde diretamente a quem pediu', async () => {
    const app = buildApp()
    await app.ready()
    const inactiveSector = await prisma.sector.create({
      data: {
        name: 'Setor inativo',
        slug: 'setor-inativo-direct-reports-test',
        active: false,
        enabledFeatures: ['time'],
        companyId: DEFAULT_COMPANY_ID,
      },
    })

    const leader = await prisma.user.create({
      data: {
        name: 'Lia Líder',
        email: 'leader-direct@empresa.com',
        passwordHash: 'x',
        role: 'MANAGER',
        position: 'Gerente',
      },
    })
    const direct = await prisma.user.create({
      data: {
        name: 'Carla Lead',
        email: 'direct-lead@empresa.com',
        passwordHash: 'x',
        role: 'LEAD',
        managerId: leader.id,
        teamsWebhookUrl: 'https://secret.invalid',
      },
    })
    // Neto: responde à Carla, não à Lia — a árvore para no primeiro nível.
    await prisma.user.create({
      data: { name: 'Diego Dev', email: 'grandchild-direct@empresa.com', passwordHash: 'x', managerId: direct.id },
    })
    // Chefe da Lia: está acima dela, não pode aparecer no time dela.
    const boss = await prisma.user.create({
      data: { name: 'Ana Head', email: 'boss-direct@empresa.com', passwordHash: 'x', role: 'HEAD' },
    })
    await prisma.user.update({ where: { id: leader.id }, data: { managerId: boss.id } })
    // Liderado de outra pessoa.
    await prisma.user.create({
      data: { name: 'Outro liderado', email: 'other-direct@empresa.com', passwordHash: 'x', managerId: boss.id },
    })
    // Liderados que saíram da árvore continuam fora dela.
    await prisma.user.create({
      data: { name: 'Fabio Desligado', email: 'left-direct@empresa.com', passwordHash: 'x', active: false, managerId: leader.id },
    })
    await prisma.user.create({
      data: { name: 'Terceiro oculto', email: 'third-direct@empresa.com', passwordHash: 'x', role: 'THIRD_PARTY', managerId: leader.id },
    })
    await prisma.user.create({
      data: {
        name: 'Setor inativo oculto',
        email: 'inactive-sector-direct@empresa.com',
        passwordHash: 'x',
        sectorId: inactiveSector.id,
        managerId: leader.id,
      },
    })

    const token = signAccessToken(app, leader, ['time'])
    const response = await app.inject({
      method: 'GET',
      url: '/organization/direct-reports',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(200)
    const chart = response.json() as OrganizationChartDTO
    expect(chart.company.id).toBe(DEFAULT_COMPANY_ID)
    // A própria líder mais a única liderada direta elegível.
    expect(chart.totalPeople).toBe(2)
    expect(names(chart.roots)).toEqual(['Lia Líder'])
    expect(chart.roots[0].reportsCount).toBe(1)
    expect(names(chart.roots[0].reports)).toEqual(['Carla Lead'])
    // Folha: a resposta não desce para o time da Carla.
    expect(chart.roots[0].reports[0].reports).toEqual([])
    expect(chart.roots[0].reports[0].reportsCount).toBe(0)

    const serialized = JSON.stringify(chart)
    expect(serialized).not.toContain('direct-lead@empresa.com')
    expect(serialized).not.toContain('secret.invalid')
    for (const hidden of ['Diego Dev', 'Ana Head', 'Outro liderado', 'Fabio Desligado', 'Terceiro oculto', 'Setor inativo oculto']) {
      expect(serialized).not.toContain(hidden)
    }
    await app.close()
  })

  it('vem vazio para quem não tem liderado direto', async () => {
    const app = buildApp()
    await app.ready()
    const solo = await prisma.user.create({
      data: { name: 'Sozinha', email: 'solo-direct@empresa.com', passwordHash: 'x' },
    })
    const token = signAccessToken(app, solo, ['time'])

    const response = await app.inject({
      method: 'GET',
      url: '/organization/direct-reports',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(200)
    const chart = response.json() as OrganizationChartDTO
    // Nem o card solitário de quem pediu: a tela precisa saber que está vazio.
    expect(chart.roots).toEqual([])
    expect(chart.totalPeople).toBe(0)
    await app.close()
  })

  it('não enxerga liderado de outra empresa', async () => {
    const app = buildApp()
    await app.ready()
    const leader = await prisma.user.create({
      data: { name: 'Líder EMR', email: 'leader-tenant-direct@empresa.com', passwordHash: 'x', role: 'MANAGER' },
    })
    const otherCompany = await prisma.company.create({
      data: { name: 'Outra Empresa Direct', slug: 'outra-empresa-direct-test' },
    })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor externo', slug: 'setor-externo-direct-test', enabledFeatures: ['time'], companyId: otherCompany.id },
    })
    await prisma.user.create({
      data: {
        name: 'Pessoa externa',
        email: 'external-direct@empresa.com',
        passwordHash: 'x',
        companyId: otherCompany.id,
        sectorId: otherSector.id,
        managerId: leader.id,
      },
    })

    const token = signAccessToken(app, leader, ['time'])
    const response = await app.inject({
      method: 'GET',
      url: '/organization/direct-reports',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(response.statusCode).toBe(200)
    const chart = response.json() as OrganizationChartDTO
    expect(chart.roots).toEqual([])
    expect(JSON.stringify(chart)).not.toContain('Pessoa externa')
    await app.close()
  })

  it('exige autenticação e a feature time', async () => {
    const app = buildApp()
    await app.ready()
    const unauthenticated = await app.inject({ method: 'GET', url: '/organization/direct-reports' })
    expect(unauthenticated.statusCode).toBe(401)

    const user = await prisma.user.create({
      data: { name: 'Sem feature direct', email: 'sem-feature-direct@empresa.com', passwordHash: 'x' },
    })
    const forbidden = await app.inject({
      method: 'GET',
      url: '/organization/direct-reports',
      headers: { authorization: `Bearer ${signAccessToken(app, user, [])}` },
    })
    expect(forbidden.statusCode).toBe(403)
    await app.close()
  })
})

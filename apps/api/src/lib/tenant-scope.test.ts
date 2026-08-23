import { describe, it, expect } from 'vitest'
import { prisma } from './prisma'
import { findUserInCompany, scopedPrisma, TENANT_SCOPED_MODELS, TenantScopeError } from './tenant-scope'

async function createCompany(slug: string) {
  return prisma.company.create({ data: { name: slug, slug } })
}

describe('scopedPrisma', () => {
  it('injeta companyId automaticamente na criação', async () => {
    const company = await createCompany('empresa-a-tenant-scope')
    const sector = await scopedPrisma(company.id).sector.create({
      data: { name: 'Setor X', slug: 'setor-x-tenant-scope', enabledFeatures: [] },
    })
    expect(sector.companyId).toBe(company.id)
  })

  it('rejeita create com companyId divergente do escopo', async () => {
    const companyA = await createCompany('empresa-b-tenant-scope')
    const companyB = await createCompany('empresa-c-tenant-scope')
    await expect(
      scopedPrisma(companyA.id).sector.create({
        data: { name: 'Setor Y', slug: 'setor-y-tenant-scope', enabledFeatures: [], companyId: companyB.id },
      }),
    ).rejects.toBeInstanceOf(TenantScopeError)
  })

  it('nunca lê linha de outra empresa (findMany/findUnique)', async () => {
    const companyA = await createCompany('empresa-d-tenant-scope')
    const companyB = await createCompany('empresa-e-tenant-scope')
    const sectorA = await scopedPrisma(companyA.id).sector.create({ data: { name: 'A', slug: 'sector-a-read-test', enabledFeatures: [] } })
    await scopedPrisma(companyB.id).sector.create({ data: { name: 'B', slug: 'sector-b-read-test', enabledFeatures: [] } })

    const listedByA = await scopedPrisma(companyA.id).sector.findMany({})
    expect(listedByA.map((s) => s.id)).toEqual([sectorA.id])

    const foundFromB = await scopedPrisma(companyB.id).sector.findUnique({ where: { id: sectorA.id } })
    expect(foundFromB).toBeNull()
  })

  it('nunca atualiza ou apaga linha de outra empresa', async () => {
    const companyA = await createCompany('empresa-f-tenant-scope')
    const companyB = await createCompany('empresa-g-tenant-scope')
    const sectorA = await scopedPrisma(companyA.id).sector.create({ data: { name: 'A2', slug: 'sector-a2-write-test', enabledFeatures: [] } })

    await expect(
      scopedPrisma(companyB.id).sector.update({ where: { id: sectorA.id }, data: { name: 'Hackeado' } }),
    ).rejects.toThrow()

    await scopedPrisma(companyB.id).sector.deleteMany({ where: { id: sectorA.id } })
    const stillThere = await prisma.sector.findUnique({ where: { id: sectorA.id } })
    expect(stillThere).not.toBeNull()
  })

  it('modelos fora da allowlist não sofrem interferência (ex: AdminAuditLog)', async () => {
    const company = await createCompany('empresa-h-tenant-scope')
    const user = await scopedPrisma(company.id).user.create({ data: { name: 'U', email: 'u-tenant-scope@x.com', passwordHash: 'x' } })
    const log = await scopedPrisma(company.id).adminAuditLog.create({
      data: { actorId: user.id, entityType: 'X', entityId: '1', action: 'CREATE' },
    })
    expect(log.id).toBeTruthy()
  })

  it('rejeita upsert em model tenant-scoped (não suportado ainda)', async () => {
    const company = await createCompany('empresa-i-tenant-scope')
    await expect(
      scopedPrisma(company.id).sector.upsert({
        where: { companyId_slug: { companyId: company.id, slug: 'nao-existe-upsert-test' } },
        create: { name: 'Z', slug: 'nao-existe-upsert-test', enabledFeatures: [] },
        update: {},
      }),
    ).rejects.toBeInstanceOf(TenantScopeError)
  })

  it('isola a base de conhecimento entre empresas', async () => {
    const outra = await prisma.company.create({
      data: { name: 'Outra Empresa', slug: `outra-${Date.now()}` },
    })
    const autor = await prisma.user.create({
      data: { name: 'Autor', email: `autor-kb-${Date.now()}@empresa.com`, passwordHash: 'x', role: 'ADMIN' },
    })

    await scopedPrisma('company-emr').knowledgeEntry.create({
      data: { question: 'Quantos dias de férias?', answer: '30 dias.', keywords: ['ferias'], createdById: autor.id },
    })

    const daEmpresa = await scopedPrisma('company-emr').knowledgeEntry.findMany()
    const daOutra = await scopedPrisma(outra.id).knowledgeEntry.findMany()

    expect(daEmpresa).toHaveLength(1)
    expect(daEmpresa[0]?.companyId).toBe('company-emr')
    expect(daOutra).toHaveLength(0)
  })

  it('apaga a entrada da base de conhecimento quando o setor dela é apagado (não promove pra empresa)', async () => {
    const autor = await prisma.user.create({
      data: { name: 'Autora', email: `autora-kb-cascade-${Date.now()}@empresa.com`, passwordHash: 'x', role: 'ADMIN' },
    })
    const setor = await prisma.sector.create({
      data: { name: 'Setor Cascade', slug: `setor-cascade-${Date.now()}`, enabledFeatures: [] },
    })

    const entry = await scopedPrisma('company-emr').knowledgeEntry.create({
      data: {
        question: 'Como peço reembolso?',
        answer: 'Via portal de RH.',
        keywords: ['reembolso'],
        createdById: autor.id,
        sectorId: setor.id,
      },
    })

    await prisma.sector.delete({ where: { id: setor.id } })

    const daEmpresa = await scopedPrisma('company-emr').knowledgeEntry.findMany({ where: { id: entry.id } })
    expect(daEmpresa).toHaveLength(0)
  })
})

describe('TENANT_SCOPED_MODELS', () => {
  it('inclui os models novos de quiz, certificado e setor do curso', () => {
    for (const model of ['CourseQuiz', 'CourseQuestion', 'QuizAttempt', 'CertificateTemplate', 'CertificateRequest']) {
      expect(TENANT_SCOPED_MODELS.has(model)).toBe(true)
    }
  })

  it('inclui os models da enquete da Resenha', () => {
    for (const model of ['ReviewPoll', 'ReviewPollOption', 'ReviewPollVote']) {
      expect(TENANT_SCOPED_MODELS.has(model)).toBe(true)
    }
  })

  // O 1:1 é conversa privada entre duas pessoas: um model dele fora da
  // allowlist vazaria pauta, nota ou combinado entre empresas.
  it('inclui os models do 1:1', () => {
    for (const model of [
      'OneOnOneSeries',
      'OneOnOneMeeting',
      'OneOnOneTopic',
      'OneOnOnePrivateNote',
      'OneOnOneAction',
      'OneOnOneTopicTemplate',
    ]) {
      expect(TENANT_SCOPED_MODELS.has(model)).toBe(true)
    }
  })
})

describe('findUserInCompany', () => {
  it('retorna o usuário quando ele pertence à empresa informada', async () => {
    const company = await createCompany('empresa-j-find-user')
    const user = await scopedPrisma(company.id).user.create({
      data: { name: 'U', email: 'u-find-user@x.com', passwordHash: 'x' },
    })
    const found = await findUserInCompany(company.id, user.id)
    expect(found?.id).toBe(user.id)
  })

  it('retorna null quando o usuário pertence a outra empresa', async () => {
    const companyA = await createCompany('empresa-k-find-user')
    const companyB = await createCompany('empresa-l-find-user')
    const user = await scopedPrisma(companyB.id).user.create({
      data: { name: 'U2', email: 'u2-find-user@x.com', passwordHash: 'x' },
    })
    const found = await findUserInCompany(companyA.id, user.id)
    expect(found).toBeNull()
  })

  it('retorna null quando o id simplesmente não existe', async () => {
    const company = await createCompany('empresa-m-find-user')
    const found = await findUserInCompany(company.id, 'id-que-nao-existe')
    expect(found).toBeNull()
  })
})

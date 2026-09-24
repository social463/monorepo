import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { updateAiSettings } from './ai-settings-service'
import { updateDevelopmentSettings } from './development-settings-service'
import { InovaError } from './inova-service'
import { askAgent } from './agent-service'

async function cenarioEmr() {
  const sector = await prisma.sector.findFirstOrThrow({ where: { companyId: DEFAULT_COMPANY_ID } })
  const admin = await prisma.user.create({
    data: {
      email: `admin-${Math.random()}@emr.com`,
      passwordHash: 'x',
      name: 'Admin',
      role: 'ADMIN',
      companyId: DEFAULT_COMPANY_ID,
      sectorId: sector.id,
    },
  })
  await updateDevelopmentSettings({ inovaModuleEnabled: true, actorId: admin.id, companyId: DEFAULT_COMPANY_ID })
  await updateAiSettings({ companyId: DEFAULT_COMPANY_ID, actorId: admin.id, body: { apiKey: 'chave-de-teste' } })
  return { id: admin.id, companyId: DEFAULT_COMPANY_ID }
}

describe('askAgent — agente inova', () => {
  it('injeta só projetos não arquivados no system prompt', async () => {
    const actor = await cenarioEmr()
    await prisma.inovaProject.create({
      data: {
        title: 'Projeto Visível',
        category: 'Automação de processos',
        sector: 'Ensino',
        description: 'desc',
        responsible1Id: actor.id,
        phase: 'IDEA',
        archived: false,
        createdById: actor.id,
        companyId: actor.companyId,
      },
    })
    await prisma.inovaProject.create({
      data: {
        title: 'Projeto Arquivado',
        category: 'Automação de processos',
        sector: 'Ensino',
        description: 'desc',
        responsible1Id: actor.id,
        phase: 'IDEA',
        archived: true,
        createdById: actor.id,
        companyId: actor.companyId,
      },
    })
    const complete = vi.fn().mockResolvedValue('resposta')

    await askAgent({ actor, agent: 'inova', message: 'como estamos?', complete })

    const prompt = complete.mock.calls[0][0].systemPrompt
    expect(prompt).toContain('Projeto Visível')
    expect(prompt).not.toContain('Projeto Arquivado')
  })

  it('com recorte do painel, injeta só os projetos pedidos — e nunca de outra empresa', async () => {
    const actor = await cenarioEmr()
    const base = {
      category: 'Automação de processos',
      description: 'desc',
      phase: 'IDEA' as const,
      createdById: actor.id,
      companyId: actor.companyId,
    }
    const noRecorte = await prisma.inovaProject.create({ data: { ...base, title: 'Projeto do Recorte', sector: 'Marketing' } })
    await prisma.inovaProject.create({ data: { ...base, title: 'Projeto Fora do Recorte', sector: 'Ensino' } })
    const outra = await prisma.company.create({ data: { name: 'Outra', slug: `outra-${Math.random()}` } })
    const setorOutra = await prisma.sector.create({ data: { name: 'Setor', slug: 'setor', companyId: outra.id } })
    const donoOutra = await prisma.user.create({
      data: { email: `x-${Math.random()}@outra.com`, passwordHash: 'x', name: 'X', role: 'ADMIN', companyId: outra.id, sectorId: setorOutra.id },
    })
    const deOutra = await prisma.inovaProject.create({
      data: { ...base, title: 'Projeto de Outra Empresa', sector: 'Ensino', createdById: donoOutra.id, companyId: outra.id },
    })
    const complete = vi.fn().mockResolvedValue('resposta')

    await askAgent({
      actor,
      agent: 'inova',
      message: 'como está o recorte?',
      scope: { inovaProjectIds: [noRecorte.id, deOutra.id] },
      complete,
    })

    const prompt = complete.mock.calls[0][0].systemPrompt
    expect(prompt).toContain('Projeto do Recorte')
    expect(prompt).not.toContain('Projeto Fora do Recorte')
    expect(prompt).not.toContain('Projeto de Outra Empresa')
    expect(prompt).toContain('RECORTE ATUAL DO PAINEL')
  })

  it('recusa empresa que não é EMR mesmo com o módulo ligado', async () => {
    const outra = await prisma.company.create({ data: { name: 'Outra', slug: `outra-${Math.random()}` } })
    const setor = await prisma.sector.create({ data: { name: 'Setor', slug: 'setor', companyId: outra.id } })
    const admin = await prisma.user.create({
      data: { email: `admin-${Math.random()}@outra.com`, passwordHash: 'x', name: 'Admin', role: 'ADMIN', companyId: outra.id, sectorId: setor.id },
    })
    await updateDevelopmentSettings({ inovaModuleEnabled: true, actorId: admin.id, companyId: outra.id })
    await updateAiSettings({ companyId: outra.id, actorId: admin.id, body: { apiKey: 'chave-de-teste' } })
    const complete = vi.fn().mockResolvedValue('resposta')

    await expect(
      askAgent({ actor: { id: admin.id, companyId: outra.id }, agent: 'inova', message: 'oi', complete }),
    ).rejects.toThrow(InovaError)
    expect(complete).not.toHaveBeenCalled()
  })
})

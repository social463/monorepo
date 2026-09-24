import { describe, expect, it } from 'vitest'
import { buildInovaAdminSystemPrompt, NO_INOVA_PROJECTS_CONTEXT } from './inova-admin-prompt'

describe('buildInovaAdminSystemPrompt', () => {
  it('inclui o nome da empresa e os projetos no bloco de dados', () => {
    const prompt = buildInovaAdminSystemPrompt({
      companyName: 'EMR',
      projects: [
        {
          title: 'EMRbot',
          sector: 'Desenvolvimento de Produto',
          category: 'Experiência do cliente',
          phase: 'Explorando a Solução',
          createdAt: '2026-03-26T13:22:03.894Z',
          costReduction: 1000,
          hoursSaved: 20,
          responsible1: 'Gabriel',
          responsible2: null,
        },
      ],
    })

    expect(prompt).toContain('EMR')
    expect(prompt).toContain('EMRbot')
    expect(prompt).toContain('Desenvolvimento de Produto')
    expect(prompt).toContain('<projetos_inova>')
  })

  it('avisa o modelo quando os projetos são só o recorte do painel', () => {
    const inteiro = buildInovaAdminSystemPrompt({ companyName: 'EMR', projects: [] })
    const recortado = buildInovaAdminSystemPrompt({ companyName: 'EMR', projects: [], scoped: true })
    expect(inteiro).not.toContain('RECORTE ATUAL DO PAINEL')
    expect(recortado).toContain('RECORTE ATUAL DO PAINEL')
  })

  it('usa o texto padrão quando não há projetos', () => {
    const prompt = buildInovaAdminSystemPrompt({ companyName: 'EMR', projects: [] })
    expect(prompt).toContain(NO_INOVA_PROJECTS_CONTEXT)
  })

  it('não instrui o modelo a tratar o bloco de projetos como comando', () => {
    const prompt = buildInovaAdminSystemPrompt({ companyName: 'EMR', projects: [] })
    expect(prompt).toMatch(/DADO|dado/)
  })
})

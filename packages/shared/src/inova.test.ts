import { describe, expect, it } from 'vitest'
import { INOVA_PROJECT_PHASES, INOVA_SUGGESTED_SECTORS, INOVA_PHASE_POINTS, INOVA_PROJECT_CATEGORIES, inovaCategoryIcon, inovaSectorKey } from './inova'

describe('catálogo do INOVA', () => {
  it('tem as 6 fases do kanban, na ordem', () => {
    expect(INOVA_PROJECT_PHASES.map((p) => p.value)).toEqual([
      'IDEA',
      'EXPLORING_SOLUTION',
      'TESTING_SOLUTION',
      'ROUTINE_USE',
      'EXPANDING',
      'COMPLETED',
    ])
  })

  it('cada fase tem um rótulo em português, não vazio', () => {
    for (const phase of INOVA_PROJECT_PHASES) {
      expect(phase.label.trim().length).toBeGreaterThan(0)
    }
  })

  it('tem setores sugeridos, sem duplicata', () => {
    expect(INOVA_SUGGESTED_SECTORS.length).toBeGreaterThan(0)
    expect(new Set(INOVA_SUGGESTED_SECTORS).size).toBe(INOVA_SUGGESTED_SECTORS.length)
  })
})

describe('pontos de fase e categorias do INOVA', () => {
  it('tem peso crescente para cada fase, na mesma ordem do kanban', () => {
    const pesos = INOVA_PROJECT_PHASES.map((p) => INOVA_PHASE_POINTS[p.value])
    expect(pesos).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('categorias têm ícone e valor não vazios, sem duplicata', () => {
    expect(INOVA_PROJECT_CATEGORIES.length).toBeGreaterThan(0)
    const valores = INOVA_PROJECT_CATEGORIES.map((c) => c.value)
    expect(new Set(valores).size).toBe(valores.length)
  })

  it('inovaCategoryIcon devolve o emoji certo, e "Outro" para categoria desconhecida', () => {
    expect(inovaCategoryIcon('Análise de dados')).toBe('📊')
    expect(inovaCategoryIcon('categoria que não existe')).toBe('💡')
  })
})

describe('inovaSectorKey', () => {
  it('casa o setor gravado no projeto com o nome do cadastro, apesar de "&", acento e caixa', () => {
    const cadastro = inovaSectorKey('Gente e Gestão')
    expect(inovaSectorKey('Gente & Gestão')).toBe(cadastro)
    expect(inovaSectorKey('gente e gestao')).toBe(cadastro)
    expect(inovaSectorKey('G&G')).toBe(cadastro)
    expect(inovaSectorKey('  Estratégia e Finanças ')).toBe(inovaSectorKey('Estrategia e Financas'))
  })

  it('não junta setores diferentes', () => {
    expect(inovaSectorKey('Marketing')).not.toBe(inovaSectorKey('Comercial'))
    expect(inovaSectorKey('CX')).not.toBe(inovaSectorKey('B2B'))
  })
})

import { describe, expect, it } from 'vitest'
import { sortCategoriesAsTree, type CourseCategoryDTO } from './course-catalog'

function cat(overrides: Partial<CourseCategoryDTO> & { id: string; name: string }): CourseCategoryDTO {
  return {
    slug: overrides.name.toLowerCase(),
    icon: null,
    parentId: null,
    parentName: null,
    order: 0,
    active: true,
    courseCount: 0,
    ...overrides,
  }
}

describe('sortCategoriesAsTree', () => {
  it('põe cada filha logo abaixo da raiz', () => {
    const arvore = sortCategoriesAsTree([
      cat({ id: 'b', name: 'Onboarding', order: 1 }),
      cat({ id: 'b1', name: 'Primeiros 30 dias', parentId: 'b' }),
      cat({ id: 'a', name: 'Liderança', order: 0 }),
      cat({ id: 'a1', name: 'Feedback', parentId: 'a' }),
    ])
    expect(arvore.map((c) => c.id)).toEqual(['a', 'a1', 'b', 'b1'])
  })

  it('desempata pelo nome quando a ordem é a mesma', () => {
    const arvore = sortCategoriesAsTree([cat({ id: 'z', name: 'Zeta' }), cat({ id: 'a', name: 'Alfa' })])
    expect(arvore.map((c) => c.name)).toEqual(['Alfa', 'Zeta'])
  })

  // Categoria é desativada, não apagada: a filha de um pai desativado continua
  // existindo, e sumir da tela sem explicação seria pior do que aparecer solta.
  it('não perde a filha cujo pai não veio na lista', () => {
    const arvore = sortCategoriesAsTree([
      cat({ id: 'a', name: 'Liderança' }),
      cat({ id: 'orfa', name: 'Órfã', parentId: 'sumiu' }),
    ])
    expect(arvore.map((c) => c.id)).toEqual(['a', 'orfa'])
  })

  it('aguenta lista vazia', () => {
    expect(sortCategoriesAsTree([])).toEqual([])
  })
})

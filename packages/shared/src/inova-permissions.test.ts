import { describe, expect, it } from 'vitest'
import { canManageInovaProject, inovaProjectOwnershipOf } from './inova'

/**
 * Regra de quem mexe num projeto do INOVA — ver
 * docs/superpowers/specs/2026-09-15-inova-projeto-de-todos-design.md.
 * Esta função é a fonte única do front e da API: a tela esconde exatamente o
 * que a rota recusaria.
 */
const projeto = { createdById: 'dono', responsible1Id: 'resp1', responsible2Id: 'resp2' }

describe('canManageInovaProject', () => {
  it('quem administra passa, mesmo sem ser dono', () => {
    expect(canManageInovaProject({ id: 'x', role: 'ADMIN' }, projeto)).toBe(true)
    expect(canManageInovaProject({ id: 'x', role: 'SUBADMIN' }, projeto)).toBe(true)
    // Acesso delegado é ADMIN pleno.
    expect(canManageInovaProject({ id: 'x', role: 'LEAD', adminAccess: true }, projeto)).toBe(true)
  })

  it('os donos passam: quem criou e os dois responsáveis', () => {
    for (const id of ['dono', 'resp1', 'resp2']) {
      expect(canManageInovaProject({ id, role: 'LEGEND' }, projeto), id).toBe(true)
    }
  })

  it('colaborador que não é dono não passa', () => {
    expect(canManageInovaProject({ id: 'estranho', role: 'LEGEND' }, projeto)).toBe(false)
  })

  it('sem usuário, sem projeto ou sem id, não passa', () => {
    expect(canManageInovaProject(null, projeto)).toBe(false)
    expect(canManageInovaProject({ id: 'dono', role: 'LEGEND' }, null)).toBe(false)
    // Usuário sem id nunca casa com dono — senão `undefined === undefined`
    // deixaria passar um projeto sem responsável.
    expect(canManageInovaProject({ role: 'LEGEND' }, { createdById: 'dono', responsible1Id: null })).toBe(false)
  })

  it('lê os donos do DTO, que traz responsável como usuário inteiro', () => {
    const ownership = inovaProjectOwnershipOf({
      createdById: 'dono',
      responsible1: { id: 'resp1' },
      responsible2: null,
    })
    expect(ownership).toEqual({ createdById: 'dono', responsible1Id: 'resp1', responsible2Id: null })
    expect(canManageInovaProject({ id: 'resp1', role: 'LEGEND' }, ownership)).toBe(true)
  })
})

import { describe, it, expect } from 'vitest'
import { BADGE_KINDS, BADGE_KIND_LABELS, isLeaderRole, leadershipRank, rolesAboveInHierarchy } from './enums'

describe('isLeaderRole', () => {
  it('é verdadeiro para papéis de liderança', () => {
    expect(isLeaderRole('LEAD')).toBe(true)
    expect(isLeaderRole('MANAGER')).toBe(true)
    expect(isLeaderRole('HEAD')).toBe(true)
  })

  it('é falso para LEGEND, ADMIN e valores ausentes/inválidos', () => {
    expect(isLeaderRole('LEGEND')).toBe(false)
    expect(isLeaderRole('ADMIN')).toBe(false)
    expect(isLeaderRole(null)).toBe(false)
    expect(isLeaderRole(undefined)).toBe(false)
    expect(isLeaderRole('OUTRO')).toBe(false)
  })
})

describe('BADGE_KIND_LABELS', () => {
  it('tem rótulo para todo tipo de selo', () => {
    for (const kind of BADGE_KINDS) {
      expect(BADGE_KIND_LABELS[kind]).toBeTruthy()
    }
  })
})

describe('rolesAboveInHierarchy', () => {
  it('devolve quem pode liderar cada papel', () => {
    expect(rolesAboveInHierarchy('LEGEND')).toEqual(['LEAD', 'MANAGER', 'HEAD'])
    expect(rolesAboveInHierarchy('LEAD')).toEqual(['MANAGER', 'HEAD'])
    expect(rolesAboveInHierarchy('MANAGER')).toEqual(['HEAD'])
  })

  it('Head está no topo: ninguém acima', () => {
    expect(rolesAboveInHierarchy('HEAD')).toEqual([])
  })

  it('papel fora da hierarquia (admin, terceirizado) não tem liderança acima', () => {
    expect(rolesAboveInHierarchy('ADMIN')).toEqual([])
    expect(rolesAboveInHierarchy('THIRD_PARTY')).toEqual([])
    expect(rolesAboveInHierarchy(null)).toEqual([])
    expect(rolesAboveInHierarchy(undefined)).toEqual([])
  })

  it('leadershipRank ordena do colaborador ao topo', () => {
    expect(leadershipRank('LEGEND')).toBeLessThan(leadershipRank('LEAD'))
    expect(leadershipRank('LEAD')).toBeLessThan(leadershipRank('MANAGER'))
    expect(leadershipRank('MANAGER')).toBeLessThan(leadershipRank('HEAD'))
    expect(leadershipRank('SUPER_ADMIN')).toBe(-1)
  })
})

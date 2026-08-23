import { describe, expect, it } from 'vitest'
import {
  ADMIN_ACCESS_ELIGIBLE_ROLES,
  canAdminister,
  canReceiveAdminAccess,
  isFullAdmin,
  isSectorAdminOnly,
} from './permissions'

describe('isFullAdmin', () => {
  it('vale para o ADMIN por papel', () => {
    expect(isFullAdmin({ role: 'ADMIN' })).toBe(true)
  })

  it('vale para quem recebeu o acesso delegado, qualquer que seja o papel', () => {
    expect(isFullAdmin({ role: 'LEGEND', adminAccess: true })).toBe(true)
    expect(isFullAdmin({ role: 'HEAD', adminAccess: true })).toBe(true)
  })

  // O poder delegado é pleno, não de setor: um SUBADMIN sem o flag continua
  // fora dos gates que exigem ADMIN.
  it('não vale para SUBADMIN sem o flag', () => {
    expect(isFullAdmin({ role: 'SUBADMIN' })).toBe(false)
  })

  it('não vale para colaborador sem o flag, nem para sujeito ausente', () => {
    expect(isFullAdmin({ role: 'LEGEND' })).toBe(false)
    expect(isFullAdmin({ role: 'LEGEND', adminAccess: false })).toBe(false)
    expect(isFullAdmin(null)).toBe(false)
    expect(isFullAdmin(undefined)).toBe(false)
  })

  it('não vale para SUPER_ADMIN — é console de outro escopo', () => {
    expect(isFullAdmin({ role: 'SUPER_ADMIN' })).toBe(false)
  })
})

describe('canAdminister', () => {
  it('cobre ADMIN, SUBADMIN e o acesso delegado', () => {
    expect(canAdminister({ role: 'ADMIN' })).toBe(true)
    expect(canAdminister({ role: 'SUBADMIN' })).toBe(true)
    expect(canAdminister({ role: 'LEGEND', adminAccess: true })).toBe(true)
  })

  it('não cobre colaborador sem o flag', () => {
    expect(canAdminister({ role: 'LEAD' })).toBe(false)
    expect(canAdminister({ role: 'THIRD_PARTY' })).toBe(false)
    expect(canAdminister(null)).toBe(false)
  })
})

describe('isSectorAdminOnly', () => {
  it('é o SUBADMIN sem acesso delegado', () => {
    expect(isSectorAdminOnly({ role: 'SUBADMIN' })).toBe(true)
    expect(isSectorAdminOnly({ role: 'SUBADMIN', adminAccess: false })).toBe(true)
  })

  it('deixa de valer quando o SUBADMIN tem acesso pleno', () => {
    expect(isSectorAdminOnly({ role: 'SUBADMIN', adminAccess: true })).toBe(false)
  })

  it('não vale para os demais papéis', () => {
    expect(isSectorAdminOnly({ role: 'ADMIN' })).toBe(false)
    expect(isSectorAdminOnly({ role: 'LEGEND', adminAccess: true })).toBe(false)
  })
})

describe('canReceiveAdminAccess', () => {
  it('aceita só os papéis de colaborador', () => {
    for (const role of ADMIN_ACCESS_ELIGIBLE_ROLES) {
      expect(canReceiveAdminAccess(role)).toBe(true)
    }
  })

  // Redundante em quem já administra; perigoso em conta de fora da empresa.
  it('recusa quem já administra e as contas de fora', () => {
    expect(canReceiveAdminAccess('ADMIN')).toBe(false)
    expect(canReceiveAdminAccess('SUBADMIN')).toBe(false)
    expect(canReceiveAdminAccess('THIRD_PARTY')).toBe(false)
    expect(canReceiveAdminAccess('SUPER_ADMIN')).toBe(false)
    expect(canReceiveAdminAccess(null)).toBe(false)
  })
})

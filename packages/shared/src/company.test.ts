import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID, INTERNAL_COMPANY_ID, type CompanyDashboardDTO, type CompanySectorBreakdownDTO } from './company'

describe('company constants', () => {
  it('expõe DEFAULT_COMPANY_ID e INTERNAL_COMPANY_ID estáveis', () => {
    expect(DEFAULT_COMPANY_ID).toBe('company-emr')
    expect(INTERNAL_COMPANY_ID).toBe('company-legends-internal')
  })

  it('CompanyDashboardDTO e CompanySectorBreakdownDTO têm o shape esperado', () => {
    const breakdown: CompanySectorBreakdownDTO = { sectorId: 's1', sectorName: 'Geral', userCount: 3 }
    const dashboard: CompanyDashboardDTO = {
      company: { id: 'c1', name: 'Empresa', slug: 'empresa', active: true, createdAt: '2026-07-27T00:00:00.000Z' },
      totalUsers: 3,
      sectorBreakdown: [breakdown],
    }
    expect(dashboard.totalUsers).toBe(3)
    expect(dashboard.sectorBreakdown[0].sectorName).toBe('Geral')
  })
})

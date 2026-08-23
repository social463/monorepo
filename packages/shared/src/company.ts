/** IDs fixos criados pela migration de backfill (não são cuids gerados). */
export const DEFAULT_COMPANY_ID = 'company-emr'
export const INTERNAL_COMPANY_ID = 'company-legends-internal'

export interface CompanyDTO {
  id: string
  name: string
  slug: string
  active: boolean
}

export interface UpdateCompanyRequest {
  name?: string
  active?: boolean
}

/** Conta ADMIN de uma empresa, na visão do super admin. */
export interface CompanyAdminDTO {
  id: string
  name: string
  email: string
  active: boolean
  createdAt: string
}

export interface CreateCompanyAdminRequest {
  name: string
  email: string
  password: string
}

/** Campos omitidos ficam como estão; `password` redefine a senha. */
export interface UpdateCompanyAdminRequest {
  name?: string
  email?: string
  password?: string
  active?: boolean
}

export interface CompanySectorBreakdownDTO {
  sectorId: string
  sectorName: string
  userCount: number
}

export interface CompanyDashboardDTO {
  company: CompanyDTO & { createdAt: string }
  totalUsers: number
  sectorBreakdown: CompanySectorBreakdownDTO[]
}

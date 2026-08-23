/**
 * Contrato dos painéis de RH: painéis externos de BI (Power BI, Looker Studio,
 * Metabase) embutidos em <iframe> dentro da administração. `embedUrl` é sempre
 * validada no backend contra uma allowlist de hosts — o front nunca decide.
 */

export const HR_DASHBOARD_MIN_HEIGHT = 300
export const HR_DASHBOARD_MAX_HEIGHT = 2000
export const HR_DASHBOARD_DEFAULT_HEIGHT = 720
export const HR_DASHBOARD_TITLE_MAX_LENGTH = 120
export const HR_DASHBOARD_DESCRIPTION_MAX_LENGTH = 400
export const HR_DASHBOARD_URL_MAX_LENGTH = 2000

export interface HrDashboardDTO {
  id: string
  title: string
  description: string | null
  embedUrl: string
  height: number
  sortOrder: number
  /** null = painel da empresa inteira. */
  sectorId: string | null
  sectorName: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateHrDashboardRequest {
  title: string
  description?: string | null
  embedUrl: string
  height?: number
  sortOrder?: number
  sectorId?: string | null
}

export type UpdateHrDashboardRequest = Partial<CreateHrDashboardRequest>

export interface HrDashboardListResponse {
  dashboards: HrDashboardDTO[]
  /** Hosts aceitos hoje, para o formulário dizer quais ferramentas estão liberadas. */
  allowedHosts: string[]
}

/** Filtro de escopo da listagem — só ADMIN usa; `all` é o default. */
export const HR_DASHBOARD_SCOPE_ALL = 'all'
export const HR_DASHBOARD_SCOPE_COMPANY = 'company'

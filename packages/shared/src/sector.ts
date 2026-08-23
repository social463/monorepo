import type { UserRole } from './enums'
import type { FeatureKey } from './third-party'

/** ID fixo do setor criado pela migration de backfill (não é um cuid gerado). */
export const DEFAULT_SECTOR_ID = 'sector-dev-produto'

export interface SectorDTO {
  id: string
  name: string
  slug: string
  active: boolean
  responsibleId: string | null
  enabledFeatures: FeatureKey[]
  roles: UserRole[]
}

export interface CreateSectorRequest {
  name: string
  enabledFeatures: FeatureKey[]
  roles: UserRole[]
}

export interface UpdateSectorRequest {
  name?: string
  active?: boolean
  responsibleId?: string | null
  enabledFeatures?: FeatureKey[]
  roles?: UserRole[]
}

/** Versão enxuta de SectorDTO pra popular seletores — sem enabledFeatures/roles (dado de admin). */
export interface SectorOptionDTO {
  id: string
  name: string
}

import type { AvatarStyleKey } from './avatar'
import type { CharacterOptions } from './character'
import type { UserRole } from './enums'

/** Dados públicos mínimos de uma pessoa exibida no organograma. */
export interface OrganizationPersonDTO {
  id: string
  name: string
  position: string | null
  role: UserRole
  sectorId: string
  /** Terceira linha do card — o setor de quem a pessoa é, não a sua posição na árvore. */
  sectorName: string
  photoUrl: string | null
  avatarStyle: AvatarStyleKey | null
  avatarSeed: string | null
  avatarOptions: CharacterOptions | null
}

/**
 * Nó da cadeia de comando. A árvore vem do `managerId` de cada pessoa e tem
 * profundidade livre — setor e squad são só rótulos, não níveis da hierarquia.
 */
export interface OrganizationNodeDTO extends OrganizationPersonDTO {
  reports: OrganizationNodeDTO[]
  /** Pessoas abaixo deste nó em qualquer profundidade; não conta o próprio nó. */
  reportsCount: number
}

export interface OrganizationChartDTO {
  company: {
    id: string
    name: string
  }
  /** Quem não tem líder direto elegível — normalmente uma pessoa só, o topo da empresa. */
  roots: OrganizationNodeDTO[]
  /** Total de pessoas na árvore. Ninguém entra nesse total sem aparecer. */
  totalPeople: number
}

export interface OrganizationSettingsDTO {
  companyResponsibleIds: string[]
}

export interface UpdateOrganizationSettingsRequest {
  companyResponsibleIds: string[]
}

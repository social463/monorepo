import type { UserRole, Area } from './enums'
import type { AvatarStyleKey } from './avatar'
import type { CharacterOptions } from './character'
import type { FeatureKey } from './third-party'

export interface PublicUser {
  id: string
  name: string
  email: string | null
  role: UserRole
  area: Area | null
  position: string | null
  squad: string | null
  photoUrl: string | null
  avatarStyle: AvatarStyleKey | null
  avatarSeed: string | null
  avatarOptions: CharacterOptions | null
  active: boolean
  joinedAt: string
  leftAt: string | null
  sectorId: string
  /** Nome do setor — resolvido só onde relevante (showcase, perfil); ausente nos demais DTOs. */
  sectorName?: string
  companyId: string
  /** Nome da empresa — só preenchido pelas rotas que alimentam o AuthContext (login/registro/me); demais DTOs trazem null. */
  companyName: string | null
  enabledFeatures: FeatureKey[]
  /** Features efetivas do SETOR do usuário (vazio para DTOs de "outro usuário" onde isso não é necessário). */
  sectorFeatures: FeatureKey[]
  /**
   * Acesso administrativo delegado: abre o painel de admin sem mexer na `role`.
   * Ortogonal ao papel — ver `permissions.ts`.
   */
  adminAccess: boolean
}

/** Usuário visto pelo admin: inclui campos sensíveis que NÃO vão em PublicUser. */
export interface AdminUserDTO extends PublicUser {
  email: string
  teamsWebhookUrl: string | null
  /** Líder direto — é o que desenha o organograma. `null` = topo da hierarquia. */
  managerId: string | null
  /** Data de nascimento como YYYY-MM-DD (data civil, sem hora). Só o admin vê o ano. */
  birthDate: string | null
}

export interface LoginRequest {
  email: string
  password: string
}

export interface RegisterRequest {
  name: string
  email: string
  password: string
  position?: string
  squad?: string
}

export interface AuthResponse {
  accessToken: string
  user: PublicUser
}

export interface RefreshResponse {
  accessToken: string
}

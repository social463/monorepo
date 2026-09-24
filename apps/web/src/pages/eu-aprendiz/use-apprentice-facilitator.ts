import { isFullAdmin, type FeatureKey } from '@legends/shared'
import { useAuth } from '../../auth/AuthContext'

/**
 * Quem opera o painel da trilha: ADMIN pleno, ou SUBADMIN do setor com o bloco
 * de Gente e Gestão — o "Facilitador (Gente & Gestão)" do protótipo.
 *
 * Espelha `app.requireSectorFeature('gente-gestao')` na API. Aqui é só para não
 * oferecer a aba; quem decide de verdade é a rota.
 */
export function useApprenticeFacilitator(): boolean {
  const { user } = useAuth()
  if (!user) return false
  if (isFullAdmin(user)) return true
  return user.role === 'SUBADMIN' && user.sectorFeatures.includes('gente-gestao' as FeatureKey)
}

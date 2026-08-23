import { isFullAdmin, type FeatureKey, type UserRole } from '@legends/shared'

/**
 * Quem administra um bloco do `/admin`: o ADMIN pleno sempre — inclusive quem
 * tem acesso administrativo delegado —, e o SUBADMIN do setor que tem a feature
 * de bloco ligada.
 *
 * Mesma regra do `AdminSectorFeatureOnly` (que guarda a rota) e do `canModerate`
 * da API — aqui ela serve para DECIDIR O QUE MOSTRAR numa tela que todo mundo
 * abre, como a galeria. Não substitui a checagem do servidor: é só a diferença
 * entre mostrar e esconder o botão.
 */
export function administersBlock(
  user: { role?: UserRole; sectorFeatures?: FeatureKey[]; adminAccess?: boolean } | null | undefined,
  feature: FeatureKey,
): boolean {
  if (!user) return false
  if (isFullAdmin(user)) return true
  return user.role === 'SUBADMIN' && (user.sectorFeatures ?? []).includes(feature)
}

/** Features efetivas do usuário: allowlist individual pra THIRD_PARTY, senão o toggle do setor. */
export function effectiveFeatures(args: {
  role?: UserRole
  enabledFeatures?: FeatureKey[]
  sectorFeatures?: FeatureKey[]
}): Set<FeatureKey> {
  const effective = args.role === 'THIRD_PARTY' ? (args.enabledFeatures ?? []) : (args.sectorFeatures ?? [])
  return new Set(effective)
}

export const USER_ROLES = ['LEGEND', 'LEAD', 'MANAGER', 'HEAD', 'ADMIN', 'SUBADMIN', 'THIRD_PARTY', 'SUPER_ADMIN'] as const
export type UserRole = (typeof USER_ROLES)[number]

// Rótulos em pt-BR para exibição dos papéis na UI. Fonte única (api + web).
export const USER_ROLE_LABELS: Record<UserRole, string> = {
  LEGEND: 'Lenda',
  LEAD: 'Líder',
  MANAGER: 'Gerente',
  HEAD: 'Head',
  ADMIN: 'Admin',
  SUBADMIN: 'Subadmin',
  THIRD_PARTY: 'Terceirizado',
  SUPER_ADMIN: 'Super Admin',
}

// Papéis de liderança: compartilham a "visão de líder" (humor do time,
// retrospectivas, sem reconhecimento). LEGEND é colaborador; ADMIN é à parte.
export const LEADER_ROLES = ['LEAD', 'MANAGER', 'HEAD'] as const

/** True quando o papel é de liderança (LEAD, MANAGER ou HEAD). */
export function isLeaderRole(role?: string | null): boolean {
  return role != null && (LEADER_ROLES as readonly string[]).includes(role)
}

/**
 * Cadeia hierárquica, do colaborador ao topo. ADMIN/SUBADMIN/SUPER_ADMIN ficam de
 * fora de propósito: administram a plataforma, não lideram ninguém no organograma.
 */
export const LEADERSHIP_HIERARCHY = ['LEGEND', 'LEAD', 'MANAGER', 'HEAD'] as const
export type LeadershipRole = (typeof LEADERSHIP_HIERARCHY)[number]

/** Posição na hierarquia; -1 para papel que não participa dela. */
export function leadershipRank(role?: string | null): number {
  return role == null ? -1 : (LEADERSHIP_HIERARCHY as readonly string[]).indexOf(role)
}

/**
 * Papéis acima do informado — quem pode ser líder de quem.
 * Lenda → Líder, Gerente e Head; Líder → Gerente e Head; Gerente → Head;
 * Head → ninguém (é o topo).
 */
export function rolesAboveInHierarchy(role?: string | null): LeadershipRole[] {
  const rank = leadershipRank(role)
  if (rank < 0) return []
  return LEADERSHIP_HIERARCHY.slice(rank + 1) as unknown as LeadershipRole[]
}

// Área de atuação do colaborador (espelha o enum Area do Prisma).
// Usada para o manager ver o humor apenas de quem faz parte da sua área.
export const AREAS = ['ENGINEERING', 'PRODUCT'] as const
export type Area = (typeof AREAS)[number]

export const AREA_LABELS: Record<Area, string> = {
  ENGINEERING: 'Engenharia',
  PRODUCT: 'Produto',
}

export const VOTING_PERIOD_STATUS = ['OPEN', 'CLOSED'] as const
export type VotingPeriodStatus = (typeof VOTING_PERIOD_STATUS)[number]

// Estado efetivo de um período, derivado da janela [startsAt, endsAt] + status.
// Não é persistido — é computado a partir de "agora".
export const VOTING_PERIOD_STATE = ['SCHEDULED', 'ACTIVE', 'ENDED'] as const
export type VotingPeriodState = (typeof VOTING_PERIOD_STATE)[number]

export const BADGE_KINDS = [
  'CATEGORY',
  'RECURRENCE',
  'IMPACT',
  'HIGHLIGHT',
  'FEEDBACK',
  'TENURE',
  'STREAK',
  'COURSE',
  'PDI',
] as const
export type BadgeKind = (typeof BADGE_KINDS)[number]

// Rótulos curtos dos tipos de selo, para os chips de filtro da galeria. Cobrem os
// 9 kinds — inclusive HIGHLIGHT, que o admin não cria (é do sistema) e por isso
// fica fora do BADGE_KINDS local de `pages/admin/BadgesSection.tsx`, cuja lista é
// o subconjunto *criável* com rótulos longos de formulário.
export const BADGE_KIND_LABELS: Record<BadgeKind, string> = {
  CATEGORY: 'Categoria',
  RECURRENCE: 'Recorrência',
  IMPACT: 'Impacto',
  HIGHLIGHT: 'Destaque do mês',
  FEEDBACK: 'Feedback',
  TENURE: 'Tempo de casa',
  STREAK: 'Ofensiva',
  COURSE: 'Aprendizado',
  PDI: 'PDI',
}

export const HIGHLIGHT_STATUS = ['NONE', 'DRAFT', 'PUBLISHED'] as const
export type HighlightStatus = (typeof HIGHLIGHT_STATUS)[number]

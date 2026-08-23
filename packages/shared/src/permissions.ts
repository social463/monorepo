import type { UserRole } from './enums'

/**
 * Quem administra a plataforma, e por quê.
 *
 * Até aqui "poder de admin" e "papel na empresa" eram o mesmo campo: quem
 * administrava tinha `role = ADMIN` (ou `SUBADMIN`). `adminAccess` separa as
 * duas coisas — é o acesso ao painel concedido a uma conta específica, sem
 * mexer no que ela é na empresa.
 *
 * O detalhe que faz o mecanismo funcionar: as checagens de papel espalhadas
 * pelo repo respondem a DUAS perguntas diferentes, que o campo único
 * confundia.
 *
 * - **"Pode administrar?"** — guardas de rota, moderar feedback, editar post de
 *   qualquer autor, publicar mapa do escritório. É aqui que `adminAccess` vale,
 *   e é para isso que estes predicados existem.
 * - **"É conta de administrador, logo não participa?"** — não vota, não entra
 *   em squad, não participa de retrospectiva nem de 1:1, não aparece na lista
 *   de colaboradores. Essas continuam lendo `role` cru, de propósito: o
 *   delegado segue sendo colaborador no produto inteiro.
 *
 * Usar `isFullAdmin` no segundo grupo tiraria do delegado justamente o que ele
 * não deveria perder.
 */
export interface AdminSubject {
  role?: UserRole | string | null
  adminAccess?: boolean | null
}

/**
 * Papéis que podem receber acesso administrativo delegado.
 *
 * `ADMIN`/`SUBADMIN` seriam redundantes (já administram pelo papel), e
 * `THIRD_PARTY`/`SUPER_ADMIN` ficam de fora por serem, cada um à sua maneira,
 * conta de fora da empresa.
 */
export const ADMIN_ACCESS_ELIGIBLE_ROLES = ['LEGEND', 'LEAD', 'MANAGER', 'HEAD'] as const
export type AdminAccessEligibleRole = (typeof ADMIN_ACCESS_ELIGIBLE_ROLES)[number]

/** O papel pode receber o acesso delegado? */
export function canReceiveAdminAccess(role?: UserRole | string | null): boolean {
  return role != null && (ADMIN_ACCESS_ELIGIBLE_ROLES as readonly string[]).includes(role)
}

/**
 * Tem poder de ADMIN **pleno** — o painel inteiro, sem recorte de setor.
 *
 * Substitui `role === 'ADMIN'` em toda checagem de "pode administrar". O
 * SUBADMIN NÃO passa aqui: o acesso dele é do setor, e o delegado recebeu poder
 * pleno, não de setor.
 */
export function isFullAdmin(subject?: AdminSubject | null): boolean {
  if (!subject) return false
  return subject.role === 'ADMIN' || subject.adminAccess === true
}

/** Administra alguma coisa: ADMIN pleno, acesso delegado, ou SUBADMIN do setor. */
export function canAdminister(subject?: AdminSubject | null): boolean {
  if (!subject) return false
  return isFullAdmin(subject) || subject.role === 'SUBADMIN'
}

/**
 * É SUBADMIN "puro" — administra só o próprio setor.
 *
 * O acesso delegado tira a pessoa desse recorte: um SUBADMIN que também
 * recebesse o flag passaria a ser admin pleno, e continuar filtrando a tela
 * pelo setor dele contradiria isso. (Hoje o flag não é concedível a SUBADMIN,
 * mas quem lê a condição não precisa saber disso para acertar.)
 */
export function isSectorAdminOnly(subject?: AdminSubject | null): boolean {
  return subject?.role === 'SUBADMIN' && subject.adminAccess !== true
}

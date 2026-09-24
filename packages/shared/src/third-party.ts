/**
 * Features de **colaborador**: liberam telas e recursos para quem trabalha no
 * setor. É o que a maioria das telas chama de "funcionalidade".
 */
export const COLLABORATOR_FEATURE_KEYS = [
  'time',
  'calendario',
  'lendas',
  'votar',
  'selos',
  'destaques',
  'notificacoes',
  'resenha',
  'mural-corporativo',
  'quinta-desenvolvimento',
  'retrospectivas',
  'escritorio',
  'cultura',
  'coins',
  'desafios',
  'aprendizado',
  'pdi',
  'assistente',
  'galeria',
  'um-a-um',
  'metas',
] as const

/**
 * Features de colaborador que terceirizado não recebe, nem pela allowlist
 * individual: a API recusa THIRD_PARTY de qualquer jeito (metas são dado
 * interno da empresa). Ficam fora do convite para não prometer um acesso que
 * não existe.
 */
export const INTERNAL_ONLY_FEATURE_KEYS = ['metas'] as const satisfies readonly (typeof COLLABORATOR_FEATURE_KEYS)[number][]

export const THIRD_PARTY_FEATURE_KEYS = COLLABORATOR_FEATURE_KEYS.filter(
  (key) => !(INTERNAL_ONLY_FEATURE_KEYS as readonly string[]).includes(key),
)

/**
 * Features de **bloco administrativo**: não liberam nada para o colaborador.
 * Dizem qual setor administra um pedaço do `/admin` — o SUBADMIN desse setor
 * entra, os demais não. O ADMIN global passa sempre, com ou sem elas.
 *
 * Existem para restringir esses blocos sem cravar o nome do setor no código:
 * cada empresa liga a feature no setor que faz o papel.
 *
 * Não confundir com as de colaborador de nome parecido: `cultura` e
 * `aprendizado` dizem quem **consome** Cultura e Aprendizado; `retrospectivas`
 * e `quinta-desenvolvimento` dizem quem **participa** das dinâmicas.
 */
export const ADMIN_BLOCK_FEATURE_KEYS = ['gente-gestao', 'desenvolvimento-produto'] as const

export const FEATURE_KEYS = [...COLLABORATOR_FEATURE_KEYS, ...ADMIN_BLOCK_FEATURE_KEYS] as const
export type FeatureKey = (typeof FEATURE_KEYS)[number]
export type AdminBlockFeatureKey = (typeof ADMIN_BLOCK_FEATURE_KEYS)[number]

export function isAdminBlockFeature(key: FeatureKey): key is AdminBlockFeatureKey {
  return (ADMIN_BLOCK_FEATURE_KEYS as readonly string[]).includes(key)
}

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  time: 'Time',
  calendario: 'Calendário',
  lendas: 'Lendas',
  votar: 'Votar',
  selos: 'Galeria de selos',
  destaques: 'Destaques',
  notificacoes: 'Notificações',
  resenha: 'Resenha',
  'mural-corporativo': 'Mural da empresa',
  'quinta-desenvolvimento': 'Quinta de Dev',
  retrospectivas: 'Retrospectivas',
  escritorio: 'Escritório',
  cultura: 'Cultura',
  coins: 'EMR Coins',
  desafios: 'Desafios',
  aprendizado: 'Aprendizado',
  pdi: 'Meu PDI',
  assistente: 'Assistente de RH',
  galeria: 'Galeria de eventos',
  'um-a-um': '1:1',
  metas: 'Metas e OKRs',
  // Verbo na frente de propósito: deixa claro que é permissão, e evita colidir
  // com o nome do setor homônimo no card da tela de Setores.
  'gente-gestao': 'Administrar Gente e Gestão',
  'desenvolvimento-produto': 'Administrar Desenvolvimento de Produto',
}

export const THIRD_PARTY_INVITE_MIN_MINUTES = 60
export const THIRD_PARTY_INVITE_MAX_MINUTES = 14 * 24 * 60

export interface ThirdPartyInviteDTO {
  id: string
  url: string | null
  enabledFeatures: FeatureKey[]
  expiresAt: string
  createdAt: string
  usedAt: string | null
  revokedAt: string | null
}

export interface ThirdPartyInvitePublicDTO {
  createdByName: string
  expiresAt: string
}

export interface CreateThirdPartyInviteRequest {
  expiresInMinutes: number
  enabledFeatures: FeatureKey[]
}

export interface CreateThirdPartyInviteResponse {
  invite: ThirdPartyInviteDTO
}

export interface ThirdPartyInviteListResponse {
  invites: ThirdPartyInviteDTO[]
}

export interface AcceptThirdPartyInviteRequest {
  name: string
  email: string
  password: string
}

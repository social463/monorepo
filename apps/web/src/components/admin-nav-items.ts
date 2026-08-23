import { isSectorAdminOnly, type FeatureKey, type UserRole } from '@legends/shared'
import type { NavGroup, NavItem } from './nav-items'

/**
 * Navegação do console de administração — os mesmos grupos que viviam na
 * `AdminSidebar`, agora na segunda linha do header, como o resto do produto.
 *
 * A sidebar fixa custava 16rem de largura em toda tela de admin (tabelas de
 * colaboradores, painéis, mapas) e era o único lugar do app com um padrão de
 * navegação próprio. Reaproveitar `NavGroup`/`NavItem` aqui é o que permite
 * usar o mesmo `NavGroupMenu` do `AppLayout` — a barra não sabe se está
 * mostrando Cultura ou Sistema.
 */

interface AdminNavItem extends NavItem {
  /** Exclusivo do ADMIN pleno: o SUBADMIN do setor não vê, mesmo com a feature. */
  adminOnly?: boolean
  /** Feature de BLOCO de administração exigida do SUBADMIN (não é feature de colaborador). */
  featureKey?: FeatureKey
}

interface AdminNavGroup extends NavGroup {
  label: string
  items: AdminNavItem[]
}

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    label: 'Visão geral',
    items: [
      { to: '/admin', label: 'Dashboard', icon: 'dashboard', end: true },
      // Áreas de Gente e Gestão: ADMIN global sempre; entre os SUBADMINs, só o
      // do setor com a feature `gente-gestao` ligada.
      { to: '/admin/pessoas', label: 'People Analytics', icon: 'insights', featureKey: 'gente-gestao' },
      { to: '/admin/paineis', label: 'Painéis de RH', icon: 'monitoring', featureKey: 'gente-gestao' },
    ],
  },
  {
    label: 'Organização',
    items: [
      { to: '/admin/setores', label: 'Setores', icon: 'account_tree', adminOnly: true },
      { to: '/admin/lendas', label: 'Lendas', icon: 'group' },
      { to: '/admin/terceirizados', label: 'Terceirizados', icon: 'badge' },
      { to: '/admin/squads', label: 'Squads', icon: 'groups' },
    ],
  },
  {
    label: 'Feedback e recompensas',
    items: [
      { to: '/admin/periodos', label: 'Períodos', icon: 'event_repeat' },
      // Catálogo único: a mesma lista serve ao feedback e à votação do mês.
      { to: '/admin/categorias', label: 'Categorias', icon: 'category' },
      { to: '/admin/selos', label: 'Selos', icon: 'military_tech' },
      // Regra de coins é da empresa inteira, não do setor — só ADMIN global.
      { to: '/admin/coins', label: 'EMR Coins', icon: 'paid', adminOnly: true },
      // Pontos (XP) segue a mesma regra dos coins: valor de recompensa é da empresa.
      { to: '/admin/xp', label: 'Pontos (XP)', icon: 'stars', adminOnly: true },
      // Vizinho das regras de propósito: ali se define quanto cada ação vale,
      // aqui se vê o que isso produziu.
      { to: '/admin/engajamento', label: 'Engajamento', icon: 'leaderboard', adminOnly: true },
      // Loja de recompensas é o sink dos coins — bloco de G&G, mesma regra de pessoas/painéis.
      { to: '/admin/loja', label: 'Loja', icon: 'storefront', featureKey: 'gente-gestao' },
    ],
  },
  {
    label: 'Comunidade',
    items: [
      { to: '/admin/quinta-dev', label: 'Quinta de Dev', icon: 'co_present', featureKey: 'desenvolvimento-produto' },
      // Gestão do catálogo é de G&G; o consumo pelo colaborador é `aprendizado`.
      { to: '/admin/cursos', label: 'Cursos', icon: 'school', featureKey: 'gente-gestao' },
      // Certificado é parte de Cursos, então segue o mesmo bloco de G&G. Modelo é
      // documento da empresa toda (CRUD é `requireAdmin` na API) — sempre adminOnly,
      // mesmo que o setor tenha o bloco. A fila segue o escopo do CURSO, então o
      // subadmin de G&G entra e o service o restringe ao próprio setor.
      {
        to: '/admin/certificados/modelos',
        label: 'Modelos de certificado',
        icon: 'workspace_premium',
        adminOnly: true,
        featureKey: 'gente-gestao',
      },
      { to: '/admin/certificados/fila', label: 'Fila de certificados', icon: 'pending_actions', featureKey: 'gente-gestao' },
      // Configuração da aba Desenvolvimento (validação do PDI e link do ImpulseUP)
      // vale para a empresa inteira: só ADMIN global.
      { to: '/admin/desenvolvimento', label: 'Desenvolvimento', icon: 'trending_up', adminOnly: true },
      { to: '/admin/retrospectivas', label: 'Retrospectivas', icon: 'dashboard_customize', featureKey: 'desenvolvimento-produto' },
      // Eventos do calendário da empresa (provas B2B, prazos, comunicados com data).
      { to: '/admin/eventos', label: 'Eventos do calendário', icon: 'event', featureKey: 'desenvolvimento-produto' },
      { to: '/admin/moderacao', label: 'Moderação', icon: 'gavel' },
      { to: '/admin/desafios', label: 'Desafios', icon: 'sports_score', featureKey: 'desafios' },
      { to: '/admin/resultados-desafios', label: 'Resultados dos desafios', icon: 'scoreboard' },
      { to: '/admin/resenha', label: 'Resenha', icon: 'forum', featureKey: 'resenha' },
      // Recorte agregado e anônimo do clima — área de G&G.
      { to: '/admin/clima', label: 'Termômetro de humor', icon: 'mood', featureKey: 'gente-gestao' },
      // Catálogo de tópicos sugeridos do 1:1 — ritual de gestão de pessoas.
      { to: '/admin/topicos-1-1', label: 'Tópicos de 1:1', icon: 'record_voice_over', featureKey: 'gente-gestao' },
    ],
  },
  {
    label: 'Cultura',
    items: [
      // Toda a gestão de Cultura é de G&G. A LEITURA de manifesto e benefícios
      // é aberta a qualquer colaborador logado — quem restringe é só a edição.
      { to: '/admin/cultura/manifesto', label: 'Manifesto', icon: 'diversity_3', featureKey: 'gente-gestao' },
      // Gestão dos manuais é de G&G; a leitura pelo colaborador é `cultura`.
      { to: '/admin/cultura/manuais', label: 'Manuais', icon: 'menu_book', featureKey: 'gente-gestao' },
      { to: '/admin/cultura/beneficios', label: 'Benefícios', icon: 'redeem', featureKey: 'gente-gestao' },
      // Peças do kit (banner, fundo de reunião…). Logo e cores continuam com o
      // SUPER_ADMIN, no branding da empresa — não são editáveis por aqui.
      { to: '/admin/cultura/kit-visual', label: 'Kit visual', icon: 'palette', featureKey: 'gente-gestao' },
      // Gestão da galeria é de G&G; o consumo pelo colaborador é `galeria`.
      { to: '/admin/galeria', label: 'Galeria de eventos', icon: 'photo_library', featureKey: 'gente-gestao' },
      // Quem configura a chave da IA, esse sim, é só ADMIN — ver "Sistema".
      { to: '/admin/benchmarking', label: 'Benchmarking', icon: 'query_stats', featureKey: 'gente-gestao' },
      { to: '/admin/glass', label: 'Avaliações externas', icon: 'reviews', featureKey: 'gente-gestao' },
      { to: '/admin/base-conhecimento', label: 'Base de conhecimento', icon: 'book_2', featureKey: 'assistente' },
      { to: '/admin/campanhas', label: 'Campanhas', icon: 'campaign', featureKey: 'gente-gestao' },
    ],
  },
  {
    label: 'Escritório',
    items: [
      { to: '/admin/escritorio', label: 'Escritório', icon: 'chair', adminOnly: true },
      { to: '/admin/mapas', label: 'Mapas', icon: 'map', adminOnly: true },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { to: '/admin/auditoria', label: 'Auditoria', icon: 'receipt_long', adminOnly: true },
      { to: '/admin/calendario', label: 'Calendário', icon: 'calendar_month', adminOnly: true },
      { to: '/admin/ia', label: 'Inteligência Artificial', icon: 'smart_toy', adminOnly: true },
      { to: '/admin/administradores', label: 'Administradores', icon: 'shield_person', adminOnly: true },
    ],
  },
]

export interface BuildAdminNavArgs {
  role?: UserRole
  sectorFeatures?: FeatureKey[]
  /** Acesso administrativo delegado: admin PLENO, então não sofre o recorte de setor. */
  adminAccess?: boolean
}

/**
 * Grupos visíveis para quem está administrando.
 *
 * Só o SUBADMIN "puro" é recortado — pelos itens `adminOnly` e pela feature de
 * bloco do setor dele. ADMIN e acesso delegado veem o console inteiro.
 */
export function buildAdminNavGroups(user: BuildAdminNavArgs | null | undefined): NavGroup[] {
  const restrictToSector = isSectorAdminOnly(user ?? undefined)
  const sectorFeatures = new Set(user?.sectorFeatures ?? [])
  return ADMIN_NAV_GROUPS.map((group) => ({
    ...group,
    items: restrictToSector
      ? group.items.filter((item) => !item.adminOnly && (!item.featureKey || sectorFeatures.has(item.featureKey)))
      : group.items,
  })).filter((group) => group.items.length > 0)
}

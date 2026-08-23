// Mapeia dados dinâmicos do backend para glyphs do Material Symbols Outlined.
// Slugs/keys desconhecidos caem em um fallback seguro.

const CATEGORY_ICONS: Record<string, string> = {
  colaboracao: 'diversity_3',
  'conhecimento-tecnico': 'architecture',
  inovacao: 'lightbulb',
  proatividade: 'bolt',
  mentoria: 'psychology',
  qualidade: 'verified',
  ownership: 'flag',
  comunicacao: 'forum',
  'resolucao-de-problemas': 'troubleshoot',
  impacto: 'rocket_launch',
}

export function categoryIcon(slug: string): string {
  return CATEGORY_ICONS[slug] ?? 'workspace_premium'
}

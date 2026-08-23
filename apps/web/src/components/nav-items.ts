import { isLeaderRole, type FeatureKey, type UserRole } from "@legends/shared";
import { effectiveFeatures } from "../lib/features";

export interface NavItem {
  to: string;
  label: string;
  icon: string;
  /** Only match the exact path (used for the home route). */
  end?: boolean;
  /** Mostra o selo pulsante "Aberta" quando a votação está aberta. */
  showOpenBadge?: boolean;
  /** Chave de feature associada (para filtro por setor/terceirizado); ausente = sempre visível. */
  feature?: FeatureKey;
  /** Visível se o usuário tiver PELO MENOS UMA destas features (páginas que reúnem mais de uma). */
  anyOfFeatures?: FeatureKey[];
  /** Link para fora do app (abre em nova aba com `rel="noopener noreferrer"`). */
  external?: boolean;
  /**
   * Rota do próprio app, mas em outra aba.
   *
   * Diferente de `external`: o destino é interno, então continua sendo o mesmo
   * `to` das demais rotas — muda só onde ele abre. Usa uma aba **nomeada** em
   * vez de `_blank`, para que clicar de novo vá para a aba que já existe em vez
   * de empilhar cópias.
   */
  newTab?: boolean;
  /**
   * Só para lideranças e para o bloco de Gente e Gestão.
   *
   * Não dá para expressar isso com `feature`: `gente-gestao` é feature de BLOCO
   * de administração (do setor), e papel de liderança não é feature nenhuma.
   * O filtro vive em `buildNavGroups`.
   */
  leadershipOnly?: boolean;
  /**
   * Destaca o item com a cor terciária da marca, em vez da primária dos demais.
   * Hoje só a Liderança usa: ela precisa saltar aos olhos de quem tem acesso.
   */
  accent?: boolean;
  /**
   * Sinônimos para a busca global encontrar o destino por palavra que não está
   * no rótulo ("férias" acha "Férias do Mês", mas "descanso" e "recesso" também).
   * A busca já casa `label`; isto é o que ela não teria como adivinhar.
   */
  keywords?: string[];
}

/**
 * Seção da navegação. `label` ausente = itens soltos no topo, sem cabeçalho e
 * sem recolhimento (atalhos que o usuário usa o tempo todo).
 */
export interface NavGroup {
  label?: string;
  items: NavItem[];
}

export interface BuildNavArgs {
  isAdmin: boolean;
  /**
   * Acesso administrativo delegado. Diferente de `isAdmin`: quem tem isto
   * mantém a navegação de COLABORADOR inteira e só ganha o item "Admin" — a
   * árvore de admin apagaria o produto da pessoa, que é o oposto do que o
   * acesso delegado faz.
   */
  adminAccess?: boolean;
  /** Aceito por compatibilidade — nenhum item depende dele desde que "Meu perfil" foi para o menu do avatar. */
  userId?: string;
  role?: UserRole;
  enabledFeatures?: FeatureKey[];
  sectorFeatures?: FeatureKey[];
  /** URL do ImpulseUP configurada para a empresa; sem ela, o item não aparece. */
  impulseUpUrl?: string | null;
  /** URL da Comunidade INOVA configurada para a empresa; sem ela, o item não aparece. */
  inovaCommunityUrl?: string | null;
}

// A navegação é agrupada por ASSUNTO — Cultura, Comunicação, Engajamento,
// Desenvolvimento —, e não por mecânica interna do produto. É a estrutura do
// portal: quem procura "quando fulano volta de férias" pensa em comunicação,
// não em "calendário do setor".
//
// Regra de bolso: no máximo 5 grupos e 6 itens por grupo. Engajamento estoura
// de propósito — o Legends tem Votar e Lendas, que o portal do protótipo não
// tem, mais o Ranking, e espalhá-los por outros grupos custaria mais do que as
// linhas a mais. É o grupo do assunto: o Ranking mostra os pontos que os
// próprios itens vizinhos (Votar, Mural de Feedbacks, Desafios) distribuem.
//
// Fora da sidebar de propósito (o acesso vem do header, não do menu):
// - Notificações → sino do header ("Ver todas" abre /notificacoes)
// - Meu perfil   → menu do avatar
//
// Admins gerenciam a plataforma: não votam nem têm perfil próprio.
// Para eles, Admin é a ação principal e vem antes de tudo.
export function buildNavGroups(args: BuildNavArgs): NavGroup[] {
  const { isAdmin, adminAccess, role, enabledFeatures, sectorFeatures, impulseUpUrl, inovaCommunityUrl } =
    args;
  // "Avaliações e Pesquisas" é ferramenta externa (ImpulseUP): não tem feature
  // própria e cada empresa tem a sua URL — sem URL configurada, some do menu.
  const impulseUpItem: NavItem[] = impulseUpUrl
    ? [
        {
          to: impulseUpUrl,
          label: 'Avaliações e Pesquisas',
          icon: 'open_in_new',
          external: true,
          keywords: ['impulseup', 'pesquisa', 'clima', 'avaliação de desempenho'],
        },
      ]
    : [];

  // Comunidade INOVA: mesma mecânica do ImpulseUP — link de fora, configurado
  // por empresa em Administração › Desenvolvimento. Empresa sem URL cadastrada
  // não vê o item, que é como um destino de um cliente não vaza para os outros.
  const inovaCommunityItem: NavItem[] = inovaCommunityUrl
    ? [
        {
          to: inovaCommunityUrl,
          label: 'Comunidade INOVA',
          icon: 'hub',
          external: true,
          keywords: ['inova', 'comunidade', 'inovação', 'ideias'],
        },
      ]
    : [];

  const leadershipItem: NavItem = {
    to: '/lideranca',
    label: 'Liderança',
    icon: 'workspace_premium',
    leadershipOnly: true,
    accent: true,
    keywords: ['líder', 'gestor', 'time', 'liderados'],
  };

  // Acesso administrativo delegado: a pessoa segue com o menu de colaborador, e
  // o Admin entra no mesmo grupo solto da Liderança — ao lado dela para quem
  // lidera, sozinho para quem não. Destacado como a Liderança: é o outro item
  // que só uma parte do time enxerga, e perdido entre os demais ele não seria
  // encontrado.
  const delegatedAdminItem: NavItem[] = adminAccess
    ? [
        {
          to: '/admin',
          label: 'Admin',
          icon: 'shield_person',
          accent: true,
          keywords: ['administração', 'painel', 'gestão'],
        },
      ]
    : [];

  const groups: NavGroup[] = isAdmin
    ? [
        { items: [{ to: '/admin', label: 'Admin', icon: 'shield_person' }] },
        {
          label: 'Cultura',
          items: [
            { to: '/manifesto', label: 'Manifesto cultural', icon: 'diversity_3', keywords: ['valores', 'propósito'] },
            { to: '/galeria', label: 'Galeria de eventos', icon: 'photo_library', keywords: ['fotos', 'álbum'] },
            { to: '/cultura?aba=manuais', label: 'Manuais', icon: 'menu_book', keywords: ['política', 'processo'] },
            { to: '/cultura?aba=kit-visual', label: 'Kit visual', icon: 'palette', keywords: ['logo', 'marca', 'cores'] },
            { to: '/cultura?aba=beneficios', label: 'Benefícios', icon: 'redeem', keywords: ['plano', 'vale', 'convênio'] },
            { to: '/resenha', label: 'Resenha', icon: 'forum', keywords: ['time', 'conversa'] },
          ],
        },
        {
          label: 'Comunicação',
          items: [
            { to: '/mural-corporativo', label: 'Feed Corporativo', icon: 'campaign', keywords: ['comunicado', 'aviso', 'mural'] },
            { to: '/ferias', label: 'Férias do Mês', icon: 'beach_access', keywords: ['descanso', 'recesso', 'ausência'] },
            { to: '/calendario', label: 'Calendário', icon: 'calendar_month', keywords: ['agenda', 'evento'] },
            { to: '/aniversariantes', label: 'Aniversariantes', icon: 'cake', keywords: ['aniversário', 'tempo de casa'] },
            { to: '/destaques', label: 'Destaques do Mês', icon: 'trophy', keywords: ['destaque', 'vencedor'] },
            { to: '/time', label: 'Organograma', icon: 'account_tree', end: true, keywords: ['time', 'hierarquia', 'setor'] },
          ],
        },
        {
          label: 'Engajamento',
          items: [
            { to: '/mural-feedbacks', label: 'Mural de Feedbacks', icon: 'reviews', keywords: ['elogio', 'retorno'] },
            { to: '/loja', label: 'Lojinha EMR', icon: 'storefront', keywords: ['resgate', 'prêmio', 'coins'] },
            { to: '/desafios', label: 'Desafios do Time', icon: 'sports_score', keywords: ['missão', 'gincana'] },
            { to: '/engajamento', label: 'Meus Emblemas', icon: 'military_tech', keywords: ['selo', 'conquista', 'xp', 'nível'] },
            { to: '/ranking', label: 'Ranking', icon: 'leaderboard', keywords: ['top', 'placar', 'pontos', 'posição', 'engajamento'] },
            { to: '/manual-game', label: 'Manual do Game', icon: 'help_center', keywords: ['regras', 'pontos', 'como ganhar'] },
            { to: '/lendas', label: 'Lendas', icon: 'auto_awesome', keywords: ['galeria', 'hall'] },
          ],
        },
        {
          label: 'Desenvolvimento',
          items: [
            { to: '/aprendizado', label: 'Aprendizado', icon: 'school', keywords: ['curso', 'trilha', 'certificado'] },
            { to: '/quinta-desenvolvimento', label: 'Quinta de Dev', icon: 'groups', keywords: ['apresentação'] },
            ...inovaCommunityItem,
            ...impulseUpItem,
          ],
        },
        { items: [leadershipItem] },
      ]
    : [
        {
          items: [
            // Home é o ponto de partida (pulso do time); o Escritório é o outro
            // destino de uso diário — os dois ficam sempre à vista.
            { to: '/', label: 'Home', icon: 'home', end: true, keywords: ['início', 'começo'] },
            // Em aba própria: o escritório é uma sessão contínua (presença,
            // áudio, vídeo) e navegar para outra tela dentro dele derrubava a
            // sessão. Com aba separada dá para usar o resto da plataforma —
            // entrar numa retrospectiva, por exemplo — sem sair do escritório.
            {
              to: '/escritorio',
              label: 'Escritório',
              icon: 'chair',
              feature: 'escritorio',
              newTab: true,
              keywords: ['virtual', 'mesa', 'sala'],
            },
          ],
        },
        {
          label: 'Cultura',
          items: [
            { to: '/manifesto', label: 'Manifesto cultural', icon: 'diversity_3', keywords: ['valores', 'propósito'] },
            { to: '/galeria', label: 'Galeria de eventos', icon: 'photo_library', feature: 'galeria', keywords: ['fotos', 'álbum'] },
            { to: '/cultura?aba=manuais', label: 'Manuais', icon: 'menu_book', feature: 'cultura', keywords: ['política', 'processo'] },
            { to: '/cultura?aba=kit-visual', label: 'Kit visual', icon: 'palette', keywords: ['logo', 'marca', 'cores'] },
            // Manifesto e Benefícios são leitura de todo mundo, sem feature:
            // são a identidade da empresa (ver AGENTS.md).
            { to: '/cultura?aba=beneficios', label: 'Benefícios', icon: 'redeem', keywords: ['plano', 'vale', 'convênio'] },
            { to: '/resenha', label: 'Resenha', icon: 'forum', feature: 'resenha', keywords: ['time', 'conversa'] },
          ],
        },
        {
          label: 'Comunicação',
          items: [
            { to: '/mural-corporativo', label: 'Feed Corporativo', icon: 'campaign', keywords: ['comunicado', 'aviso', 'mural'] },
            { to: '/ferias', label: 'Férias do Mês', icon: 'beach_access', keywords: ['descanso', 'recesso', 'ausência'] },
            { to: '/calendario', label: 'Calendário', icon: 'calendar_month', feature: 'calendario', keywords: ['agenda', 'evento'] },
            { to: '/aniversariantes', label: 'Aniversariantes', icon: 'cake', keywords: ['aniversário', 'tempo de casa'] },
            { to: '/destaques', label: 'Destaques do Mês', icon: 'trophy', feature: 'destaques', keywords: ['destaque', 'vencedor'] },
            { to: '/time', label: 'Organograma', icon: 'account_tree', end: true, feature: 'time', keywords: ['time', 'hierarquia', 'setor'] },
          ],
        },
        {
          label: 'Engajamento',
          items: [
            { to: '/mural-feedbacks', label: 'Mural de Feedbacks', icon: 'reviews', keywords: ['elogio', 'retorno'] },
            // Loja gasta os mesmos coins do Engajamento, então mora ao lado.
            { to: '/loja', label: 'Lojinha EMR', icon: 'storefront', anyOfFeatures: ['coins'], keywords: ['resgate', 'prêmio', 'coins'] },
            // Desafio paga em coins. Tem feature própria (`desafios`): a API
            // (`requireFeature('desafios')` em routes/challenges.ts) barra quem
            // não tem o setor habilitado, então o item some do menu junto — sem
            // isso o link ficaria quebrado (403).
            { to: '/desafios', label: 'Desafios do Time', icon: 'sports_score', feature: 'desafios', keywords: ['missão', 'gincana'] },
            { to: '/engajamento', label: 'Meus Emblemas', icon: 'military_tech', feature: 'selos', keywords: ['selo', 'conquista', 'xp', 'nível'] },
            // Sem `feature`, igual ao XP que ele exibe: a pontuação já aparece
            // no card de perfil de qualquer pessoa logada, e esconder a leitura
            // pública dela atrás de uma feature deixaria o número sem contexto.
            { to: '/ranking', label: 'Ranking', icon: 'leaderboard', keywords: ['top', 'placar', 'pontos', 'posição', 'engajamento'] },
            { to: '/manual-game', label: 'Manual do Game', icon: 'help_center', keywords: ['regras', 'pontos', 'como ganhar'] },
            { to: '/votar', label: 'Votar', icon: 'how_to_vote', showOpenBadge: true, feature: 'votar', keywords: ['voto', 'período'] },
            { to: '/lendas', label: 'Lendas', icon: 'auto_awesome', feature: 'lendas', keywords: ['galeria', 'hall'] },
          ],
        },
        {
          label: 'Desenvolvimento',
          items: [
            { to: '/aprendizado', label: 'Aprendizado', icon: 'school', feature: 'aprendizado', keywords: ['curso', 'trilha', 'certificado'] },
            { to: '/pdi', label: 'Meu PDI', icon: 'flag', feature: 'pdi', keywords: ['plano', 'carreira', 'meta'] },
            { to: '/1-1', label: '1:1', icon: 'record_voice_over', feature: 'um-a-um', keywords: ['conversa', 'gestor'] },
            { to: '/quinta-desenvolvimento', label: 'Quinta de Dev', icon: 'groups', feature: 'quinta-desenvolvimento', keywords: ['apresentação'] },
            { to: '/retrospectivas', label: 'Retrospectivas', icon: 'dashboard', feature: 'retrospectivas', keywords: ['retro', 'sprint'] },
            ...inovaCommunityItem,
            ...impulseUpItem,
          ],
        },
        { items: [...delegatedAdminItem, leadershipItem] },
      ];

  const enabled = effectiveFeatures({ role, enabledFeatures, sectorFeatures });
  // Liderança: papel de líder OU o bloco de Gente e Gestão. ADMIN entra pelo
  // primeiro braço da mesma forma que entra em todo o resto do console.
  const canLead =
    isAdmin || isLeaderRole(role) || (sectorFeatures ?? []).includes('gente-gestao' as FeatureKey);

  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          (!item.feature || enabled.has(item.feature)) &&
          (!item.anyOfFeatures || item.anyOfFeatures.some((feature) => enabled.has(feature))) &&
          (!item.leadershipOnly || canLead),
      ),
    }))
    // Grupo que ficou sem item nenhum (features desligadas) não vira cabeçalho vazio.
    .filter((group) => group.items.length > 0);
}


/**
 * O item corresponde à rota aberta?
 *
 * Existe porque as telas de Cultura são abas da MESMA rota (`/cultura?aba=…`):
 * comparar só o pathname acenderia os quatro itens de uma vez. Fora daí é a
 * comparação de sempre, pelo caminho.
 */
export function isNavItemActive(item: NavItem, pathname: string, search = ''): boolean {
  const [itemPath, itemQuery] = item.to.split('?')
  if (itemPath !== pathname) return false
  if (!itemQuery) return true

  const wanted = new URLSearchParams(itemQuery).get('aba')
  const current = new URLSearchParams(search).get('aba')
  // Sem `aba` na URL vale a primeira aba, que é o que a página abre por padrão.
  // Quem não tem a feature `cultura` cai em outra aba, mas também não vê este
  // item no menu — então nenhum acende, que é melhor do que acender o errado.
  return current ? current === wanted : wanted === 'manuais'
}

/** Mesma navegação achatada, na ordem em que aparece. */
export function buildNavItems(args: BuildNavArgs): NavItem[] {
  return buildNavGroups(args).flatMap((group) => group.items);
}

// Catálogo de eventos de uso do produto — fonte única de api e web.
//
// Não confundir com `audit-log.ts`: aquele registra ação de admin sobre uma
// entidade (quem criou/editou/excluiu o quê, com before/after) e existe para
// prestar contas. Aqui é uso do produto — quantas pessoas de qual empresa e
// setor exercitam cada fluxo — e a granularidade, o volume e o tempo de
// retenção são outros.
//
// Os nomes seguem as restrições do GA4, que é o sink externo: minúsculas,
// dígitos e underscore, começando por letra, no máximo 40 caracteres. O teste
// ao lado trava isso — um nome inválido no GA4 é descartado em silêncio, e
// evento que some sem erro é a pior falha possível numa instrumentação.

/** Limites do GA4 (property padrão). Ver `analytics.test.ts`. */
export const GA4_LIMITS = {
  eventNameMaxLength: 40,
  paramKeyMaxLength: 40,
  paramValueMaxLength: 100,
  paramsPerEvent: 25,
} as const

/** Prefixos que o GA4 reserva — evento com esse começo é rejeitado. */
export const GA4_RESERVED_PREFIXES = ['ga_', 'google_', 'firebase_'] as const

/** De onde o evento foi emitido. */
export const ANALYTICS_SOURCES = ['api', 'web'] as const
export type AnalyticsSource = (typeof ANALYTICS_SOURCES)[number]

/**
 * Dimensões de tenant que acompanham *todo* evento. São ambientes: o call site
 * não as passa: quem preenche é o enriquecimento a partir do JWT (api) ou do
 * contexto de auth (web). Assim nenhum evento nasce sem empresa/setor por
 * esquecimento de quem instrumentou.
 *
 * Pseudonimizado por decisão de projeto: `userId` é o UUID e nada mais. Nome,
 * e-mail e qualquer texto escrito pela pessoa (justificativa de voto, feedback)
 * nunca saem do banco — o produto é de RH e o sink externo é de terceiro.
 */
export interface AnalyticsTenantContext {
  userId: string | null
  companyId: string | null
  sectorId: string | null
  role: string | null
}

/** Valores aceitos como propriedade de evento. */
export type AnalyticsPropValue = string | number | boolean | null

export type AnalyticsProps = Record<string, AnalyticsPropValue>

/**
 * Propriedades de cada evento. A chave é o nome canônico do evento — é esta
 * interface que impede `vote_cast` de virar `voteCast` no próximo call site.
 */
export interface AnalyticsEventMap {
  // Sessão. Só login de verdade — a rotação de refresh token, que acontece a
  // cada 15 minutos para toda sessão viva, ficaria de fora de propósito: é
  // automática, não é ato de ninguém, e afogaria o resto do volume.
  user_logged_in: { method: 'password' }
  user_logged_out: Record<string, never>

  // Navegação (web)
  page_viewed: { path: string; title?: string }

  // Reconhecimento — o núcleo do produto
  // `justificationLength`, e não um booleano "tem justificativa": ela é
  // obrigatória no schema da rota, então o booleano seria sempre `true`. O
  // comprimento é o que varia e mostra se as pessoas justificam de verdade ou
  // raspam o mínimo — sem tirar o texto do banco.
  vote_cast: { categoryId: string; periodId: string; justificationLength: number }
  badge_earned: { badgeId: string; periodId: string | null }
  highlight_card_generated: { periodId: string; withAi: boolean }
  highlight_card_shared: { periodId: string; channel: string }

  // Feedback entre colegas. `length` é o tamanho do texto, não o texto: mostra
  // se as pessoas escrevem de verdade ou despacham em duas palavras, sem tirar
  // do banco o que alguém escreveu sobre um colega.
  feedback_given: { category: string; length: number }
  feedback_reacted: { reaction: string }

  // Agentes de IA. O agente gasta a cota paga da empresa, então frequência e
  // latência são o que importa aqui.
  //
  // Provedor e modelo ficam de fora de propósito: são *configuração* da empresa
  // (`AppSetting`, via Administração › Inteligência Artificial), não fato do
  // evento. Repetir em cada chamada criaria uma segunda fonte de verdade que
  // diverge silenciosamente no dia em que o admin troca de provedor.
  ai_agent_invoked: { agent: string; outcome: 'success' | 'error'; durationMs: number }

  // Aprendizado
  course_started: { courseId: string }
  course_completed: { courseId: string }
  certificate_issued: { courseId: string }

  // Cultura
  manual_viewed: { manualId: string }
  manifesto_viewed: Record<string, never>
  benefit_viewed: { benefitId: string }

  // Dinâmicas de time
  retro_joined: { retroId: string }
  development_thursday_joined: { sessionId: string }
  // `reason` é a CATEGORIA fechada do mal-estar (o enum `MoodReason`), null em
  // humor não-negativo. O comentário livre da pessoa fica de fora: é texto que
  // alguém escreveu sobre o próprio dia, e vale aqui a mesma regra de PII de
  // `feedback_given`.
  mood_registered: { scale: number; reason: string | null }

  // 1:1
  one_on_one_scheduled: { hasAgenda: boolean }
  one_on_one_accepted: { withCounterProposal: boolean }

  // Escritório virtual
  office_entered: { mapId: string }

  // Administração — mostra qual bloco do /admin cada empresa realmente usa
  admin_screen_viewed: { screen: string }
}

export type AnalyticsEventName = keyof AnalyticsEventMap

/**
 * Lista dos nomes em runtime. Existe para o teste conseguir varrer o catálogo
 * (`keyof` some na compilação) e para validar nome vindo do front, que é
 * entrada não confiável.
 */
export const ANALYTICS_EVENT_NAMES = [
  'user_logged_in',
  'user_logged_out',
  'page_viewed',
  'vote_cast',
  'badge_earned',
  'highlight_card_generated',
  'highlight_card_shared',
  'feedback_given',
  'feedback_reacted',
  'ai_agent_invoked',
  'course_started',
  'course_completed',
  'certificate_issued',
  'manual_viewed',
  'manifesto_viewed',
  'benefit_viewed',
  'retro_joined',
  'development_thursday_joined',
  'mood_registered',
  'one_on_one_scheduled',
  'one_on_one_accepted',
  'office_entered',
  'admin_screen_viewed',
] as const satisfies readonly AnalyticsEventName[]

/**
 * Eventos que o front pode emitir. O resto é só do servidor: se a web pudesse
 * mandar `vote_cast`, qualquer pessoa com o console aberto inflaria a adoção
 * da própria empresa, e o dashboard do super-admin vira ficção.
 */
export const WEB_ANALYTICS_EVENT_NAMES = [
  'page_viewed',
  'manual_viewed',
  'manifesto_viewed',
  'benefit_viewed',
  'admin_screen_viewed',
  'highlight_card_shared',
  'office_entered',
] as const satisfies readonly AnalyticsEventName[]

export type WebAnalyticsEventName = (typeof WEB_ANALYTICS_EVENT_NAMES)[number]

/**
 * Rótulo em português de cada evento, para o painel. O nome canônico é técnico
 * de propósito (o GA4 exige) — quem lê o painel não deveria decorar
 * `development_thursday_joined`.
 */
export const ANALYTICS_EVENT_LABELS: Record<AnalyticsEventName, string> = {
  user_logged_in: 'Login',
  user_logged_out: 'Logout',
  page_viewed: 'Tela aberta',
  vote_cast: 'Voto',
  badge_earned: 'Selo conquistado',
  highlight_card_generated: 'Card do destaque gerado',
  highlight_card_shared: 'Card do destaque compartilhado',
  feedback_given: 'Feedback enviado',
  feedback_reacted: 'Reação a feedback',
  ai_agent_invoked: 'Agente de IA',
  course_started: 'Curso iniciado',
  course_completed: 'Curso concluído',
  certificate_issued: 'Certificado emitido',
  manual_viewed: 'Manual aberto',
  manifesto_viewed: 'Manifesto aberto',
  benefit_viewed: 'Benefício aberto',
  retro_joined: 'Retrospectiva',
  development_thursday_joined: 'Quinta de Dev',
  mood_registered: 'Humor registrado',
  one_on_one_scheduled: '1:1 agendado',
  one_on_one_accepted: '1:1 aceito',
  office_entered: 'Escritório virtual',
  admin_screen_viewed: 'Tela de administração',
}

/** Rótulo do evento, com fallback para o nome cru — o catálogo pode crescer. */
export function analyticsEventLabel(name: string): string {
  return ANALYTICS_EVENT_LABELS[name as AnalyticsEventName] ?? name
}

export function isWebAnalyticsEventName(value: string): value is WebAnalyticsEventName {
  return (WEB_ANALYTICS_EVENT_NAMES as readonly string[]).includes(value)
}

/** Evento já pronto para persistir ou despachar. */
export interface AnalyticsEvent<N extends AnalyticsEventName = AnalyticsEventName> {
  name: N
  props: AnalyticsEventMap[N]
  context: AnalyticsTenantContext
  source: AnalyticsSource
  occurredAt: string
}

// ---------------------------------------------------------------------------
// Painel de adoção (super-admin) — contrato de `GET /super-admin/analytics`
// ---------------------------------------------------------------------------

/** Janelas oferecidas pelo painel, em dias. */
export const ADOPTION_WINDOWS = [7, 30, 90] as const
export type AdoptionWindow = (typeof ADOPTION_WINDOWS)[number]
export const DEFAULT_ADOPTION_WINDOW: AdoptionWindow = 30

export function isAdoptionWindow(value: number): value is AdoptionWindow {
  return (ADOPTION_WINDOWS as readonly number[]).includes(value)
}

export interface EventCountDTO {
  name: string
  count: number
}

export interface SectorAdoptionDTO {
  sectorId: string
  sectorName: string
  activeUsers: number
  totalEvents: number
}

export interface CompanyAdoptionDTO {
  companyId: string
  companyName: string
  active: boolean
  /** Pessoas com ao menos um evento na janela. */
  activeUsers: number
  /** Pessoas ativas na empresa, para dar denominador ao número acima. */
  totalUsers: number
  totalEvents: number
  /** Evento mais recente da empresa; `null` se não houve nenhum na janela. */
  lastEventAt: string | null
  sectors: SectorAdoptionDTO[]
  topEvents: EventCountDTO[]
}

export interface AdoptionOverviewDTO {
  windowDays: AdoptionWindow
  since: string
  companies: CompanyAdoptionDTO[]
}

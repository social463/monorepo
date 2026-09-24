import type { PublicUser } from './auth'
/**
 * Eventos do **Calendário Endomarketing** — ações, datas comemorativas, campanhas
 * e ritos institucionais da empresa. É a única fonte da tela do calendário: as
 * marcações derivadas de outras tabelas (aniversário, tempo de casa, férias,
 * 1:1) saíram de lá de propósito e continuam nas abas próprias de cada assunto.
 * Aqui alguém cadastra, com categoria, período e público-alvo.
 */

import { isLeaderRole } from './enums'
import { isFullAdmin } from './permissions'

/** Periodicidade da regra. `NONE` é evento de uma data só. */
export const CALENDAR_RECURRENCES = ['NONE', 'WEEKLY', 'MONTHLY', 'YEARLY'] as const
export type CalendarRecurrence = (typeof CALENDAR_RECURRENCES)[number]

export const CALENDAR_RECURRENCE_LABELS: Record<CalendarRecurrence, string> = {
  NONE: 'Não se repete',
  WEEKLY: 'Toda semana',
  MONTHLY: 'Todo mês',
  YEARLY: 'Todo ano',
}

/** Antecedências oferecidas no cadastro, em dias. `0` é no próprio dia. */
export const CALENDAR_REMINDER_OFFSETS = [0, 1, 3, 7, 14, 30] as const
export type CalendarReminderOffset = (typeof CALENDAR_REMINDER_OFFSETS)[number]

export function reminderOffsetLabel(days: number): string {
  if (days === 0) return 'No dia'
  return days === 1 ? '1 dia antes' : `${days} dias antes`
}

/** Hora local (São Paulo) em que o lembrete do dia é disparado. */
export const CALENDAR_REMINDER_HOUR = 9

export const CALENDAR_EVENT_TITLE_MAX_LENGTH = 120
/**
 * A **tag** é o rótulo que a planilha da G&G traz na coluna `Tag` — "Simulado",
 * "Circuito", "Porta de Prova", "Café Temático". Ela descreve o evento com a
 * granularidade do negócio, e é MAIS fina que a categoria: as 25 tags da
 * planilha caem nas 10 categorias do catálogo.
 *
 * Cor e ícone continuam saindo da **categoria**, e o filtro do topo também. É
 * o que impede a barra de filtro de crescer uma coluna por vocabulário novo da
 * planilha — a tag aparece como etiqueta no evento, ao lado da categoria, que
 * é como o Portal EMR já fazia.
 */
export const CALENDAR_EVENT_TAG_MAX_LENGTH = 60
export const CALENDAR_EVENT_DESCRIPTION_MAX_LENGTH = 1000

/** Teto do intervalo aceito em `GET /calendar/events` — impede que a rota vire dump. */
export const MAX_CALENDAR_EVENT_RANGE_DAYS = 366

/**
 * Categoria de evento: é **dado**, não enum — a linha vive em
 * `CalendarEventType` e cada empresa tem a sua cópia, o que preserva a FK dos
 * eventos já cadastrados e a tela de catálogo do admin. O `slug` é o que viaja
 * na URL do filtro.
 *
 * A lista fechada do produto é `CALENDAR_EVENT_CATEGORIES`: é ela que a
 * migration semeia por empresa, e é dela que sai a cor aplicada sozinha no
 * cadastro. `color` mora no tipo (e não num mapa fixo no front) porque o
 * catálogo é por empresa — mapa fixo mentiria para quem tem uma categoria a
 * mais.
 */
export interface CalendarEventTypeDTO {
  id: string
  name: string
  slug: string
  /** Nome de ícone Material, igual ao resto do calendário. */
  icon: string
  /** Cor da categoria em hex `#rrggbb` — o padrão aplicado ao evento. */
  color: string
}

/** Cor de quem não tem cor: categoria fora do catálogo padrão nasce com esta. */
export const CALENDAR_CATEGORY_FALLBACK_COLOR = '#6366f1'

/**
 * As dez categorias do Calendário Endomarketing 2026. Fonte única do nome, da
 * cor e do ícone — a migration semeia uma linha de `CalendarEventType` por
 * empresa a partir daqui, e o `slug` é o mesmo que `slugify(label)` produziria
 * no cadastro manual (senão a semeadura duplicaria a categoria).
 */
export const CALENDAR_EVENT_CATEGORIES = [
  { slug: 'acao', label: 'Ação', color: '#8b5cf6', icon: 'campaign' },
  { slug: 'data-comemorativa', label: 'Data comemorativa', color: '#ec4899', icon: 'celebration' },
  { slug: 'evento', label: 'Evento', color: '#10b981', icon: 'event' },
  { slug: 'feriado', label: 'Feriado', color: '#ef4444', icon: 'flag' },
  { slug: 'campanha', label: 'Campanha', color: '#f59e0b', icon: 'ads_click' },
  { slug: 'reuniao', label: 'Reunião', color: '#0ea5e9', icon: 'groups' },
  { slug: 'avaliacao', label: 'Avaliação', color: '#6366f1', icon: 'fact_check' },
  { slug: 'cultura', label: 'Cultura', color: '#14b8a6', icon: 'diversity_3' },
  { slug: 'desenv-humano', label: 'Desenv. Humano', color: '#a855f7', icon: 'school' },
  { slug: 'comunicacao', label: 'Comunicação', color: '#3b82f6', icon: 'forum' },
] as const

export type CalendarCategorySlug = (typeof CALENDAR_EVENT_CATEGORIES)[number]['slug']

/** A cor de uma categoria do catálogo padrão, ou a cor de fallback. */
export function calendarCategoryColor(slug: string): string {
  return CALENDAR_EVENT_CATEGORIES.find((c) => c.slug === slug)?.color ?? CALENDAR_CATEGORY_FALLBACK_COLOR
}

// ---------------------------------------------------------------- público-alvo

/**
 * O público-alvo é uma lista de **tags**, não de setores: é assim que ele chega
 * na planilha de colaboradores, e é o que permite um evento para "Líder, G&G"
 * sem inventar um setor para cada recorte. Vazio — ou contendo `Todos` — é a
 * empresa inteira.
 *
 * Os setores (`sectorIds`) continuam existindo e valendo em paralelo: quem já
 * cadastrou evento por setor não perde o recorte, e as duas regras se somam
 * (o evento precisa passar nas duas).
 */
export const CALENDAR_AUDIENCE_ALL = 'Todos'

/** Sugestões de tag oferecidas no cadastro. Não é uma lista fechada. */
export const CALENDAR_AUDIENCE_SUGGESTIONS = [CALENDAR_AUDIENCE_ALL, 'Líder', 'G&G', 'CEO'] as const

/**
 * Tag comparável: sem acento, sem caixa e sem pontuação — `G&G`, `g & g` e
 * `GG` são a mesma coisa, e a planilha não garante grafia. Comparar cru faria
 * um acento a mais esconder o evento de quem deveria vê-lo.
 */
export function normalizeAudienceTag(tag: string): string {
  return tag
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

/**
 * O evento alcança quem tem `viewerTags`? Lista vazia no evento (ou a tag
 * `Todos`) é visibilidade geral — e não "ninguém", pelo mesmo motivo de
 * `CalendarEventSector`.
 */
export function audienceReaches(eventTags: readonly string[], viewerTags: readonly string[]): boolean {
  const alvo = eventTags.map(normalizeAudienceTag).filter(Boolean)
  if (alvo.length === 0) return true
  if (alvo.includes(normalizeAudienceTag(CALENDAR_AUDIENCE_ALL))) return true
  const minhas = new Set(viewerTags.map(normalizeAudienceTag).filter(Boolean))
  return alvo.some((tag) => minhas.has(tag))
}

/**
 * As tags que uma pessoa carrega, derivadas do que o produto já sabe dela: o
 * setor pelo nome, `G&G` pelo bloco de Gente e Gestão, `Líder` pelo papel de
 * liderança e `CEO` pelo cargo. É o ponto de encontro entre o público-alvo do
 * evento e a planilha de colaboradores.
 */
export function viewerAudienceTags(viewer: {
  role?: string | null
  sectorName?: string | null
  sectorFeatures?: readonly string[]
  position?: string | null
}): string[] {
  const tags = [CALENDAR_AUDIENCE_ALL]
  if (viewer.sectorName) tags.push(viewer.sectorName)
  const ehGenteGestao =
    (viewer.sectorFeatures ?? []).includes('gente-gestao') ||
    normalizeAudienceTag(viewer.sectorName ?? '') === normalizeAudienceTag('Gente e Gestão')
  if (ehGenteGestao) tags.push('G&G')
  if (isLeaderRole(viewer.role)) tags.push('Líder')
  // `\bceo\b` e não `includes('ceo')`: "Assessor do CEO" é CEO, "Ceonardo" não.
  if (viewer.position && /\bceo\b/i.test(viewer.position)) tags.push('CEO')
  return tags
}

/**
 * Quem enxerga evento marcado como **Ação de Comunicação Interna**: o admin
 * pleno e o time de Gente e Gestão (o setor inteiro, não só o subadmin dele —
 * o registro é o controle interno da área). Para todo o resto ele não existe:
 * some da API, não só da tela.
 */
export function canSeeInternalCalendarEvents(
  role: string | null | undefined,
  sectorFeatures: readonly string[] = [],
  adminAccess = false,
): boolean {
  if (isFullAdmin({ role, adminAccess })) return true
  return sectorFeatures.includes('gente-gestao')
}

/**
 * Quem cadastra evento no calendário. Três portas, e só três:
 *
 * - **ADMIN pleno** — sempre. Inclui quem tem acesso administrativo delegado
 *   (`adminAccess`), que é admin pleno sem ser ADMIN de papel.
 * - **SUBADMIN** do setor com a feature de bloco `desenvolvimento-produto`.
 * - **Liderança** (LEAD, MANAGER, HEAD) — pode cadastrar para qualquer público,
 *   inclusive a empresa inteira. A contenção aqui não é a permissão, é o
 *   rastro: todo evento carrega quem criou e quando, e todo CRUD grava no
 *   `AdminAuditLog`.
 *
 * O catálogo de TIPOS continua fora daqui, restrito ao bloco de admin: tipo é
 * taxonomia da empresa e vira chip fixo na barra de filtros do calendário de
 * todo mundo — liberar isso para cada líder faria a barra crescer sem dono.
 */
export function canManageCalendarEvents(
  role: string | null | undefined,
  sectorFeatures: readonly string[] = [],
  adminAccess = false,
): boolean {
  if (isFullAdmin({ role, adminAccess })) return true
  if (role === 'SUBADMIN') return sectorFeatures.includes('desenvolvimento-produto')
  return isLeaderRole(role)
}

/**
 * Quem pode MEXER num evento que já existe. Admin e subadmin do bloco editam
 * qualquer um; líder só o que ele mesmo criou — senão um líder apagaria o
 * comunicado da empresa inteira publicado por outra pessoa.
 */
export function canEditCalendarEvent(
  actor: {
    id: string
    role: string | null | undefined
    sectorFeatures?: readonly string[]
    adminAccess?: boolean
  },
  event: { createdById: string },
): boolean {
  if (isFullAdmin(actor)) return true
  if (actor.role === 'SUBADMIN') return (actor.sectorFeatures ?? []).includes('desenvolvimento-produto')
  return isLeaderRole(actor.role) && event.createdById === actor.id
}

export interface CalendarEventDTO {
  id: string
  title: string
  description: string
  /** Rótulo fino do evento ("Simulado", "Circuito"), ou null. Ver `CALENDAR_EVENT_TAG_MAX_LENGTH`. */
  tag: string | null
  /** Data civil YYYY-MM-DD da primeira (ou única) ocorrência. */
  date: string
  /**
   * Último dia do evento, ou null quando ele cabe num dia só. É a duração em
   * DIAS, e ela acompanha cada ocorrência da recorrência — evento de 3 dias que
   * se repete todo mês ocupa 3 dias em cada mês.
   */
  endDate: string | null
  /** HH:MM local, ou null para evento de dia inteiro. */
  startTime: string | null
  /** HH:MM local do fim, ou null. Sem `startTime` não significa nada. */
  endTime: string | null
  /**
   * Cor do evento em hex, quando alguém sobrescreveu a da categoria. Null é o
   * caso normal: a tela usa `type.color`.
   */
  color: string | null
  /** Tags de público-alvo. Vazio (ou `Todos`) é a empresa inteira. */
  audienceTags: string[]
  /** Ação de Comunicação Interna: só o admin e o time de G&G enxergam. */
  isInternalComm: boolean
  type: CalendarEventTypeDTO
  /**
   * Setores alvo. **Lista vazia significa empresa inteira** — e não "ninguém".
   * Marcar todos os setores no cadastro congelaria o público: setor criado
   * depois ficaria de fora de um evento que era, por definição, de todo mundo.
   */
  sectorIds: string[]
  sectorNames: string[]
  /**
   * Convidados nominalmente (Documento 3, seção 11). Eles enxergam o evento
   * **independentemente de setor e de tag** — é o ponto do convite: chamar quem
   * o recorte por setor não alcança. As três regras se somam.
   *
   * Só viaja para quem ADMINISTRA o evento: a lista de nomes é da gestão, não
   * do calendário de quem só olha.
   */
  guests: PublicUser[]
  recurrence: CalendarRecurrence
  /** Fim da recorrência por data civil, ou null. Exclusivo com `recurrenceCount`. */
  recurrenceUntil: string | null
  /** Fim da recorrência por número de ocorrências, ou null. */
  recurrenceCount: number | null
  /** Antecedências do lembrete, em dias. Vazio = sem lembrete. */
  reminderDaysBefore: number[]
  /** Rastro de autoria — quem cadastrou, para auditoria. */
  createdById: string
  createdByName: string
  createdAt: string
}

/** Uma data concreta em que o evento acontece, já expandida a partir da regra. */
export interface CalendarEventOccurrenceDTO {
  eventId: string
  iso: string
  /** Rótulo fino do evento ("Simulado", "Circuito"), ou null. A cor continua vindo da categoria. */
  tag?: string | null
  /**
   * Último dia DESTA ocorrência (igual a `iso` quando o evento cabe num dia).
   * A tela desenha a barra contínua a partir do par — sem ele, um evento de
   * três dias viraria três marcações soltas.
   */
  endIso: string
  title: string
  description: string
  startTime: string | null
  endTime: string | null
  typeSlug: string
  typeName: string
  typeIcon: string
  /** Cor já resolvida: a do evento se houver, senão a da categoria. */
  color: string
  audienceTags: string[]
  isInternalComm: boolean
  /** Rastro visível a quem vê o evento no calendário: "Adicionado por X em Y". */
  createdById: string
  createdByName: string
  createdAt: string
}

/** "Adicionado por Fulano em 03/08/2026" — mesmo texto na tela admin e no calendário. */
export function addedByLabel(createdByName: string, createdAt: string): string {
  const data = new Date(createdAt)
  const dia = Number.isNaN(data.getTime())
    ? '—'
    : new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(data)
  return `Adicionado por ${createdByName} em ${dia}`
}

export interface CalendarEventsResponse {
  occurrences: CalendarEventOccurrenceDTO[]
  types: CalendarEventTypeDTO[]
  /**
   * O calendário editorial de Campanhas, na mesma janela (Documento 4, seção
   * 13.2): a "visão sistêmica de todos os eventos" que a G&G pediu.
   *
   * Lista separada, e não `CalendarEventOccurrenceDTO` sintético, porque item
   * de campanha **não é evento**: não tem tipo, cor de categoria, recorrência,
   * convidado nem lembrete. Fabricar um `typeId` falso para caber no DTO
   * obrigaria toda tela que consome ocorrência a saber que algumas são mentira.
   *
   * Vazia para quem não é admin nem do bloco de Gente e Gestão — mesma regra de
   * `isInternalComm`: o calendário editorial é material de quem publica, e o
   * resto da empresa vê o comunicado quando ele sai.
   */
  campaignPosts: CalendarCampaignPostDTO[]
}

/** Item do calendário editorial projetado no calendário organizacional. */
export interface CalendarCampaignPostDTO {
  id: string
  title: string
  /** Instante agendado, ISO 8601. */
  scheduledFor: string
  /** `SCHEDULED` | `PUBLISHED` | `CANCELLED`, do catálogo de campanhas. */
  status: string
  /** Rótulo do canal ("Mural da empresa", "Teams"…), já resolvido. */
  channelLabel: string
  /** Tema da campanha, quando o item pertence a uma. */
  campaignTheme: string | null
}

export interface CalendarEventListResponse {
  events: CalendarEventDTO[]
  types: CalendarEventTypeDTO[]
}

/** `GET /calendar/events/:id` — o cadastro inteiro, para o formulário de edição. */
export interface CalendarEventResponse {
  event: CalendarEventDTO
}

export interface UpsertCalendarEventRequest {
  title: string
  description?: string
  tag?: string | null
  date: string
  endDate?: string | null
  startTime?: string | null
  endTime?: string | null
  typeId: string
  color?: string | null
  audienceTags?: string[]
  isInternalComm?: boolean
  sectorIds?: string[]
  /** Ids dos convidados. Ausente = não mexe; lista vazia = tira todos. */
  guestIds?: string[]
  recurrence?: CalendarRecurrence
  recurrenceUntil?: string | null
  recurrenceCount?: number | null
  reminderDaysBefore?: number[]
}

export interface UpsertCalendarEventTypeRequest {
  name: string
  icon?: string
  color?: string
}

/**
 * "1h30", "45min", "Dia todo" — a duração é DERIVADA do horário, não digitada.
 * Um campo de texto livre ao lado de um horário estruturado só cria duas
 * verdades sobre a mesma coisa (e a primeira a divergir é a escrita à mão).
 */
export function calendarDurationLabel(input: {
  startTime: string | null
  endTime: string | null
  iso: string
  endIso: string
}): string {
  const dias = Math.round((Date.parse(`${input.endIso}T00:00:00Z`) - Date.parse(`${input.iso}T00:00:00Z`)) / 86_400_000)
  if (dias > 0) return `${dias + 1} dias`
  if (!input.startTime) return 'Dia todo'
  if (!input.endTime) return input.startTime
  const [sh, sm] = input.startTime.split(':').map(Number)
  const [eh, em] = input.endTime.split(':').map(Number)
  const minutos = eh * 60 + em - (sh * 60 + sm)
  if (!Number.isFinite(minutos) || minutos <= 0) return input.startTime
  const h = Math.floor(minutos / 60)
  const m = minutos % 60
  if (h === 0) return `${m}min`
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}

/** A regra de repetição, do jeito que a expansão precisa dela. */
export interface CalendarRecurrenceRule {
  /** Data civil da primeira ocorrência. */
  date: string
  recurrence: CalendarRecurrence
  recurrenceUntil?: string | null
  recurrenceCount?: number | null
}

/**
 * Teto de segurança da expansão: nenhuma janela legítima do calendário pede
 * mais que isso (um ano de evento semanal são 53). Existe para uma regra
 * malformada nunca virar laço infinito.
 */
const MAX_OCCURRENCES = 800

function parseIso(iso: string): { year: number; month: number; day: number } {
  const [year, month, day] = iso.split('-').map(Number)
  return { year, month, day }
}

function formatIso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Último dia do mês (mês 1-12). `Date.UTC` com dia 0 devolve o último do anterior. */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/**
 * Ocorrência mensal/anual em mês que não tem o dia da regra **cai no último dia
 * do mês**: "todo dia 31" acontece em 30/04, e 29/02 vira 28/02 em ano comum.
 *
 * A alternativa — pular o mês — some com metade das ocorrências de um evento
 * mensal sem explicar por quê; e deixar o `Date` normalizar sozinho jogaria o
 * evento para 01/05, mudando o mês da ocorrência.
 */
function clampDay(year: number, month: number, day: number): string {
  const last = lastDayOfMonth(year, month)
  return formatIso(year, month, day > last ? last : day)
}

function addDaysIso(iso: string, days: number): string {
  const { year, month, day } = parseIso(iso)
  const shifted = new Date(Date.UTC(year, month - 1, day + days))
  return shifted.toISOString().slice(0, 10)
}

/**
 * As datas em que a regra acontece dentro de `[from, to]` (datas civis
 * inclusivas nas duas pontas).
 *
 * A contagem de `recurrenceCount` é a partir da **primeira** ocorrência, não do
 * início da janela: pedir só o mês de março de um evento que começou em janeiro
 * com 5 ocorrências devolve as que caem em março, não as 5 primeiras de março.
 */
export function expandOccurrences(rule: CalendarRecurrenceRule, from: string, to: string): string[] {
  if (from > to) return []

  const start = rule.date
  const hardEnd = rule.recurrenceUntil && rule.recurrenceUntil < to ? rule.recurrenceUntil : to

  if (rule.recurrence === 'NONE') {
    return start >= from && start <= to ? [start] : []
  }

  const { year, month, day } = parseIso(start)
  const limit = rule.recurrenceCount ?? MAX_OCCURRENCES
  const result: string[] = []

  for (let index = 0; index < Math.min(limit, MAX_OCCURRENCES); index += 1) {
    let iso: string
    if (rule.recurrence === 'WEEKLY') {
      iso = addDaysIso(start, index * 7)
    } else if (rule.recurrence === 'MONTHLY') {
      // Meses somam com overflow controlado: (2026, 12) + 1 → janeiro de 2027.
      const total = month - 1 + index
      iso = clampDay(year + Math.floor(total / 12), (total % 12) + 1, day)
    } else {
      iso = clampDay(year + index, month, day)
    }

    if (iso > hardEnd) break
    if (iso >= from) result.push(iso)
  }

  return result
}

/**
 * A data em que o lembrete de uma ocorrência deve sair: `daysBefore` dias antes
 * dela, em data civil. Antecedência `0` é o próprio dia da ocorrência.
 */
export function reminderDateFor(occurrenceIso: string, daysBefore: number): string {
  return addDaysIso(occurrenceIso, -daysBefore)
}

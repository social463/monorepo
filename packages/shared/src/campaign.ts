import type { AttachedImage } from './image'
import type { CalendarEventOccurrenceDTO } from './calendar-event'
import type { BirthdayDTO, WorkAnniversaryDTO } from './celebration'

export const CAMPAIGN_QUANTITY_MIN = 1
export const CAMPAIGN_QUANTITY_MAX = 20
export const CAMPAIGN_THEME_MAX_LENGTH = 200
export const CAMPAIGN_NOTES_MAX_LENGTH = 1000
export const CAMPAIGN_TITLE_MAX_LENGTH = 120
export const CAMPAIGN_VISUAL_HINT_MAX_LENGTH = 200

/**
 * Teto do corpo do rascunho. Já foi 280 — o teto ANTIGO do mural —, e era ele
 * que fazia o gerador entregar comunicado telegráfico: o prompt anunciava o
 * número como limite rígido, então o modelo espremia lide, "Por que isso
 * importa" e bullets em duas linhas secas, e o mesmo tema gerado direto no
 * provedor saía três a quatro vezes maior. Comunicado de campanha continua
 * sendo curto, mas curto é a ORIENTAÇÃO de fôlego do prompt
 * (`CAMPAIGN_BODY_TARGET_*`); isto aqui é só a trave de segurança contra
 * resposta absurda, bem abaixo dos 5.000 que o post aceita.
 */
export const CAMPAIGN_BODY_MAX_LENGTH = 2_000

/**
 * Fôlego pedido ao modelo, em caracteres. Não é validado — é o que o prompt
 * diz para o texto ter começo, meio e fim em vez de encostar no teto e parar.
 */
export const CAMPAIGN_BODY_TARGET_MIN = 600
export const CAMPAIGN_BODY_TARGET_MAX = 1_500

export const CAMPAIGN_AUDIENCES = ['ALL', 'LEADERSHIP'] as const
export type CampaignAudience = (typeof CAMPAIGN_AUDIENCES)[number]

export const CAMPAIGN_CHANNELS = ['MURAL', 'TEAMS', 'EMAIL'] as const
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number]

export const CAMPAIGN_POST_STATUSES = ['SCHEDULED', 'PUBLISHED', 'CANCELLED'] as const
export type CampaignPostStatus = (typeof CAMPAIGN_POST_STATUSES)[number]

export const CAMPAIGN_AUDIENCE_LABELS: Record<CampaignAudience, string> = {
  ALL: 'Todos',
  LEADERSHIP: 'Liderança',
}

export const CAMPAIGN_CHANNEL_LABELS: Record<CampaignChannel, string> = {
  MURAL: 'Mural da empresa',
  TEAMS: 'Teams',
  EMAIL: 'E-mail',
}

export const CAMPAIGN_POST_STATUS_LABELS: Record<CampaignPostStatus, string> = {
  SCHEDULED: 'Agendado',
  PUBLISHED: 'Publicado',
  CANCELLED: 'Cancelado',
}

/** Canais cuja entrega hoje é manual — o Legends registra, não dispara. */
export const CAMPAIGN_MANUAL_DELIVERY_CHANNELS: readonly CampaignChannel[] = ['TEAMS', 'EMAIL']

/**
 * Modelo padrão de comunicado — a fórmula da **Brevidade Inteligente**
 * (Smart Brevity), texto oficial da G&G (Documento 4, seção 13.4).
 *
 * Mora aqui, e não só na API, porque as duas pontas precisam concordar: o
 * servidor injeta isto no prompt, e a tela do admin mostra o oficial enquanto
 * ninguém editou.
 *
 * **Não é constante cravada no comportamento.** É o VALOR PADRÃO de uma
 * configuração por empresa (`campaign_prompt_template` em `AppSetting`): a OBS
 * da seção pede explicitamente que a G&G possa refiná-lo sem depender do time
 * de TI.
 */
export const SMART_BREVITY_PROMPT = `Atue como um especialista em Comunicação Interna e aplique os princípios do livro Brevidade Inteligente (Smart Brevity) no texto abaixo.

Siga estritamente esta estrutura:

1. Título: Máximo de 6 palavras, de alto impacto e com 1 emoji adequado.

2. Lide: Apenas 1 frase direta com a novidade ou informação principal (sem saudações nem perguntas).

3. Por que isso importa: Uma seção curta explicando o motivo/benefício estratégico com o título "Por que isso importa" em negrito e com cor de destaque como nesse tom de **amarelo**.

4. Ação / Detalhes: Bullet points com as informações práticas (quem, quando, onde, prazo e links) e palavras-chave em negrito.

Diretrizes de tom: Tom corporativo, acolhedor e direto. Elimine adjetivos supérfluos, frases longas e qualquer enrolação.`

export const CAMPAIGN_PROMPT_TEMPLATE_MAX_LENGTH = 4000

export interface GenerateCampaignRequest {
  theme: string
  /** ISO 8601. */
  startsAt: string
  endsAt: string
  audience: CampaignAudience
  channel: CampaignChannel
  quantity: number
  notes?: string
  /**
   * Aplica o modelo padrão da empresa ao prompt (Documento 4, seção 13.4).
   * O gerador manda `true` por padrão; desligar é a saída para gerar algo fora
   * do padrão **sem** apagar a configuração da empresa.
   */
  applyTemplate?: boolean
}

/** Resposta de `GET /admin/campaign-prompt-template`. */
export interface CampaignPromptTemplateResponse {
  /** O que está valendo: o da empresa, ou o oficial quando ninguém editou. */
  template: string
  /** `true` quando o valor acima é o oficial, e não um texto da empresa. */
  isDefault: boolean
}

/** Rascunho proposto pela IA. Ainda não existe no banco. */
export interface CampaignDraftDTO {
  title: string
  body: string
  visualHint: string | null
  /** Vem da grade calculada no servidor, nunca do modelo. */
  scheduledFor: string
}

/**
 * A campanha como FAIXA no calendário editorial: o guarda-chuva desenhado por
 * trás dos comunicados que nasceram dele.
 *
 * É `Campaign` sem o que a grade não usa. A janela (`startsAt`/`endsAt`) já
 * existia no model desde sempre, mas nunca chegava ao front — o calendário só
 * recebia `CampaignPost`, que tem um instante (`scheduledFor`) e nenhuma
 * duração. Daí a campanha aparecer como texto solto sob cada item, em vez de
 * como o período que ela é.
 */
export interface CampaignBandDTO {
  id: string
  theme: string
  /**
   * Instantes ISO, a mesma convenção de `CampaignPost.scheduledFor` — e não
   * data civil já resolvida no servidor. A grade coloca o comunicado no dia
   * LOCAL de quem olha; se a faixa viesse com o dia civil do servidor, os dois
   * discordariam na virada do dia e a faixa terminaria um dia antes do último
   * comunicado que ela cobre.
   */
  startsAt: string
  endsAt: string
}

export interface CampaignPostDTO {
  id: string
  campaignId: string | null
  campaignTheme: string | null
  title: string
  body: string
  visualHint: string | null
  /**
   * Arte do comunicado — a imagem que sai junto no Mural.
   *
   * Não se confunde com `visualHint`, que continua sendo o BRIEFING em texto
   * para quem vai produzir a peça ("Imagem do MKT."). Um é o pedido, o outro é
   * a peça pronta: o item pode nascer só com o pedido e ganhar a arte depois, e
   * é por isso que os dois convivem em vez de um substituir o outro.
   *
   * A IA não propõe imagem: `CampaignDraftDTO` segue sem o campo, de propósito
   * — o gerador escreve texto, e arte é upload de gente.
   */
  image: AttachedImage | null
  scheduledFor: string
  channel: CampaignChannel
  audience: CampaignAudience
  status: CampaignPostStatus
  responsibleId: string | null
  responsibleName: string | null
  publishedPostId: string | null
  publishedAt: string | null
  createdAt: string
}

/**
 * Comunicado agendado direto no Feed Corporativo, como o calendário editorial o
 * mostra — **leitura**.
 *
 * Existe porque os agendados do feed não apareciam para a G&G em lugar nenhum:
 * "Meus envios" lista só os do próprio autor, e a fila de moderação só olha
 * `PENDING`. Quem cuida do calendário não tinha como ver que já havia
 * comunicado marcado para o mesmo horário.
 *
 * Deliberadamente magro perto de `CorporatePostDTO`: a grade mostra hora, autor
 * e título, e o painel abre o texto. Reação, comentário e leitura são assunto do
 * feed, não do calendário.
 *
 * Não tem reagendar nem editar de propósito: **nem o autor** edita um agendado
 * hoje (em "Meus envios" o botão só aparece em `PENDING`), então fazê-lo aqui
 * seria inventar regra de propriedade num lugar que não é dono dela. Excluir sai
 * pela rota que já existe no mural, com a permissão que já existe lá.
 */
export interface ScheduledFeedPostDTO {
  id: string
  title: string | null
  content: string
  authorId: string
  authorName: string
  /** Instante marcado para a publicação. Equivale ao `scheduledFor` do item. */
  publishAt: string
  createdAt: string
}

export interface ConfirmCampaignPostInput {
  title: string
  body: string
  visualHint?: string | null
  image?: AttachedImage | null
  scheduledFor: string
  channel: CampaignChannel
  responsibleId?: string | null
}

export interface ConfirmCampaignRequest {
  theme: string
  startsAt: string
  endsAt: string
  audience: CampaignAudience
  notes?: string
  posts: ConfirmCampaignPostInput[]
}

export interface CreateCampaignPostRequest {
  title: string
  body: string
  visualHint?: string | null
  image?: AttachedImage | null
  scheduledFor: string
  channel: CampaignChannel
  audience: CampaignAudience
  responsibleId?: string | null
}

export interface UpdateCampaignPostRequest {
  title?: string
  body?: string
  visualHint?: string | null
  image?: AttachedImage | null
  scheduledFor?: string
  channel?: CampaignChannel
  audience?: CampaignAudience
  responsibleId?: string | null
}

/**
 * Contexto do calendário organizacional projetado no calendário editorial —
 * mesmo princípio de `CalendarCampaignPostDTO` (calendar-event.ts) ao
 * contrário: leitura, não espelho. Quem planeja campanha precisa ver que dia
 * 12 já é feriado ou que três pessoas fazem aniversário antes de marcar um
 * comunicado em cima.
 */
export interface CampaignCalendarContextDTO {
  occurrences: CalendarEventOccurrenceDTO[]
  birthdays: BirthdayDTO[]
  workAnniversaries: WorkAnniversaryDTO[]
}

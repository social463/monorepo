import { z } from 'zod'
import {
  CAMPAIGN_AUDIENCE_LABELS,
  CAMPAIGN_BODY_MAX_LENGTH,
  CAMPAIGN_TITLE_MAX_LENGTH,
  CAMPAIGN_VISUAL_HINT_MAX_LENGTH,
  type CampaignAudience,
  type CampaignDraftDTO,
} from '@legends/shared'
import { CampaignError } from './campaign-error'

export interface CampaignPromptInput {
  companyName: string
  theme: string
  audience: CampaignAudience
  notes?: string | null
  /** Grade de `buildScheduleSlots` — o modelo recebe as datas prontas. */
  slots: Date[]
}

const dataFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  weekday: 'long',
  day: '2-digit',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
})

/**
 * Monta o prompt da campanha. Função pura (testável sem rede), no padrão de
 * `buildCongratsPrompt`. As datas entram como contexto para o modelo adequar o
 * texto ao dia — mas ele não devolve data nenhuma: quem carimba é o parser.
 */
export function buildCampaignPrompt(input: CampaignPromptInput): string {
  const agenda = input.slots
    .map((slot, index) => `${index + 1}. ${dataFormatter.format(slot)}`)
    .join('\n')

  return [
    `Você é o time de comunicação interna da empresa ${input.companyName}, escrevendo em português do Brasil.`,
    `Escreva ${input.slots.length} comunicado(s) para uma campanha sobre: ${input.theme}.`,
    `Público-alvo: ${CAMPAIGN_AUDIENCE_LABELS[input.audience]}.`,
    input.notes?.trim() ? `Observações do solicitante: ${input.notes.trim()}` : null,
    ``,
    `Cada comunicado será publicado em uma destas datas, nesta ordem:`,
    agenda,
    ``,
    `REGRAS`,
    `- Um comunicado por data, na mesma ordem da lista.`,
    `- O corpo tem no máximo ${CAMPAIGN_BODY_MAX_LENGTH} caracteres. Este limite é rígido.`,
    `- O título tem no máximo ${CAMPAIGN_TITLE_MAX_LENGTH} caracteres e é interno (não aparece no post).`,
    `- A campanha deve progredir: abertura, desenvolvimento e encerramento. Não repita o mesmo texto.`,
    `- Não invente número, data, nome de pessoa, benefício ou política que não esteja no tema.`,
    `- Tom caloroso e profissional. Sem markdown, sem emojis, sem aspas.`,
    ``,
    `FORMATO DA RESPOSTA`,
    `Responda APENAS com um array JSON, sem texto antes ou depois, com exatamente ${input.slots.length} objeto(s):`,
    `[{"title": "...", "body": "...", "visualHint": "sugestão de imagem em uma frase"}]`,
  ]
    .filter((line) => line !== null)
    .join('\n')
}

const draftSchema = z.object({
  title: z.string().trim().min(1).max(CAMPAIGN_TITLE_MAX_LENGTH),
  body: z.string().trim().min(1).max(CAMPAIGN_BODY_MAX_LENGTH),
  visualHint: z.string().trim().max(CAMPAIGN_VISUAL_HINT_MAX_LENGTH).nullish(),
})

/** Modelos costumam embrulhar JSON em cerca de markdown mesmo quando proibidos. */
function stripFence(raw: string): string {
  const trimmed = raw.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed)
  return fenced ? fenced[1] : trimmed
}

/**
 * Valida a resposta do modelo e carimba a data da grade por posição.
 *
 * Tudo que sai daqui é `CampaignError` com mensagem em português. Como o preview
 * não grava nada, uma resposta fora do schema não deixa item pela metade no
 * banco — a propriedade vem do desenho, não deste `try/catch`.
 */
export function parseCampaignDrafts(raw: string, slots: Date[]): CampaignDraftDTO[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripFence(raw))
  } catch {
    throw new CampaignError('A IA devolveu uma resposta que não consegui interpretar. Tente gerar de novo.', 502)
  }

  const result = z.array(draftSchema).safeParse(parsed)
  if (!result.success) {
    throw new CampaignError('A IA devolveu comunicados fora do formato esperado. Tente gerar de novo.', 502)
  }
  if (result.data.length !== slots.length) {
    throw new CampaignError(
      `Pedi ${slots.length} comunicado(s) e a IA devolveu ${result.data.length}. Tente gerar de novo.`,
      502,
    )
  }

  return result.data.map((draft, index) => ({
    title: draft.title,
    body: draft.body,
    visualHint: draft.visualHint ?? null,
    scheduledFor: slots[index].toISOString(),
  }))
}

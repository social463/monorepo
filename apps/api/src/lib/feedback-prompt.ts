import { z } from 'zod'
import { FEEDBACK_MESSAGE_MAX_LENGTH, type GenerateFeedbackResponse } from '@legends/shared'
import { FeedbackError } from './feedback-error'

/**
 * Prompt do "Escrever com IA" do Mural de Feedbacks.
 *
 * Reusa o caminho dos outros agentes (credenciais por empresa em
 * `resolveAiCredentials`, chamada em `requestAgentCompletion`); o que muda é o
 * prompt e o formato. Função pura, no padrão de `buildCampaignPrompt` — dá para
 * testar prompt e parser sem rede.
 *
 * O modelo recebe **nome de quem vai receber e competências escolhidas**, e não
 * o histórico da pessoa: reconhecimento é sobre um fato concreto, e dar contexto
 * que o autor não escreveu é o caminho mais curto para a IA inventar elogio.
 */
export interface FeedbackPromptInput {
  companyName: string
  authorName: string
  targetNames: string[]
  categoryNames: string[]
  notes?: string | null
}

/** Bem abaixo do teto do campo: rascunho comprido dá mais trabalho de cortar do que de escrever. */
const PROMPT_MESSAGE_MAX_LENGTH = 500

export function buildFeedbackPrompt(input: FeedbackPromptInput): string {
  const paraQuem =
    input.targetNames.length === 1
      ? input.targetNames[0]
      : `${input.targetNames.slice(0, -1).join(', ')} e ${input.targetNames[input.targetNames.length - 1]}`

  return [
    `Você ajuda alguém da empresa ${input.companyName} a escrever um reconhecimento para colega(s), em português do Brasil.`,
    `Quem escreve: ${input.authorName}. Para quem: ${paraQuem}.`,
    input.categoryNames.length ? `Competências reconhecidas: ${input.categoryNames.join(', ')}.` : null,
    input.notes?.trim() ? `O que ${input.authorName} quer dizer: ${input.notes.trim()}` : null,
    ``,
    `REGRAS`,
    `- Escreva em primeira pessoa, como se fosse ${input.authorName} falando com o colega.`,
    `- No máximo ${PROMPT_MESSAGE_MAX_LENGTH} caracteres. Este limite é rígido.`,
    `- Fale do que a pessoa FEZ e do efeito disso. Reconhecimento genérico não serve.`,
    `- Não invente número, data, projeto, cargo nem fato que não esteja acima.`,
    input.targetNames.length > 1
      ? `- É um reconhecimento ao grupo: fale com todos, sem separar por pessoa.`
      : null,
    `- Tom caloroso e direto. Sem markdown, sem aspas ao redor do texto, sem assinatura.`,
    ``,
    `FORMATO DA RESPOSTA`,
    `Responda APENAS com um objeto JSON, sem texto antes ou depois:`,
    `{"message": "..."}`,
  ]
    .filter((line) => line !== null)
    .join('\n')
}

const generatedSchema = z.object({
  message: z.string().trim().min(1).max(FEEDBACK_MESSAGE_MAX_LENGTH),
})

/** Modelos costumam embrulhar JSON em cerca de markdown mesmo quando proibidos. */
function stripFence(raw: string): string {
  const trimmed = raw.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed)
  return fenced ? fenced[1] : trimmed
}

/**
 * Valida a resposta do modelo. Nada é gravado por este caminho — o texto volta
 * para o formulário e quem envia é a pessoa —, então resposta fora do formato é
 * um 502 tratado, sem feedback pela metade no banco.
 */
export function parseGeneratedFeedback(raw: string): GenerateFeedbackResponse {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripFence(raw))
  } catch {
    throw new FeedbackError('A IA devolveu uma resposta que não consegui interpretar. Tente gerar de novo.', 502)
  }
  const result = generatedSchema.safeParse(parsed)
  if (!result.success) {
    throw new FeedbackError('A IA devolveu um texto fora do formato esperado. Tente gerar de novo.', 502)
  }
  return { message: result.data.message }
}

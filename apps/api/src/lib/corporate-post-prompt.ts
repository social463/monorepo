import { z } from 'zod'
import {
  CORPORATE_POST_BODY_MAX_LENGTH,
  CORPORATE_POST_TITLE_MAX_LENGTH,
  type GenerateCorporatePostResponse,
} from '@legends/shared'
import { CorporateMuralError } from './corporate-mural-error'

/**
 * Prompt do botão de IA do composer do Feed Corporativo.
 *
 * O botão **gera** o comunicado a partir de instruções em linguagem natural — é
 * o que a G&G pediu na 2ª rodada, em vez de "melhorar o texto" que já existia
 * no calendário editorial. Reusa o caminho das campanhas (credenciais por
 * empresa em `resolveAiCredentials`, chamada em `requestAgentCompletion`), e o
 * que muda é só o prompt e o formato de saída: aqui sai **um** comunicado, com
 * título e corpo.
 *
 * Função pura, no padrão de `buildCampaignPrompt`: dá para testar o prompt e o
 * parser sem rede.
 */
export interface CorporatePostPromptInput {
  companyName: string
  /** O que a pessoa quer comunicar, do jeito que ela escreveu. */
  instructions: string
  /** Nome de quem está publicando — ajuda o modelo a escolher a voz. */
  authorName: string
  /** Setores do público-alvo, quando o comunicado é segmentado. */
  audienceLabel: string
}

/**
 * O limite de corpo que o modelo recebe é bem menor que o do post (5.000): o
 * comunicado gerado é um rascunho para a pessoa editar, e texto quilométrico
 * dá mais trabalho de cortar do que de escrever.
 */
const PROMPT_BODY_MAX_LENGTH = 1_200

export function buildCorporatePostPrompt(input: CorporatePostPromptInput): string {
  return [
    `Você é o time de comunicação interna da empresa ${input.companyName}, escrevendo em português do Brasil.`,
    `Escreva UM comunicado para o feed interno da empresa, a partir das instruções de ${input.authorName}.`,
    `Público-alvo: ${input.audienceLabel}.`,
    ``,
    `INSTRUÇÕES DE QUEM VAI PUBLICAR`,
    input.instructions.trim(),
    ``,
    `REGRAS`,
    `- O título tem no máximo ${CORPORATE_POST_TITLE_MAX_LENGTH} caracteres e aparece em destaque no card.`,
    `- O corpo tem no máximo ${PROMPT_BODY_MAX_LENGTH} caracteres. Este limite é rígido.`,
    `- Separe parágrafos com uma linha em branco. Use "- " para listas, quando ajudar.`,
    `- Não invente número, data, nome de pessoa, benefício ou política que não esteja nas instruções.`,
    `- Não escreva saudação de e-mail ("Prezados", "Att") nem assinatura: é um post de feed.`,
    `- Tom caloroso e profissional. Sem markdown de formatação, sem aspas ao redor do texto.`,
    // TODO(tom-de-voz): plugar aqui o manual de tom de voz da G&G quando existir
    // — é o único ponto do prompt que precisa mudar para isso.
    ``,
    `FORMATO DA RESPOSTA`,
    `Responda APENAS com um objeto JSON, sem texto antes ou depois:`,
    `{"title": "...", "body": "..."}`,
  ].join('\n')
}

const generatedSchema = z.object({
  title: z.string().trim().min(1).max(CORPORATE_POST_TITLE_MAX_LENGTH),
  body: z.string().trim().min(1).max(CORPORATE_POST_BODY_MAX_LENGTH),
})

/** Modelos costumam embrulhar JSON em cerca de markdown mesmo quando proibidos. */
function stripFence(raw: string): string {
  const trimmed = raw.trim()
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed)
  return fenced ? fenced[1] : trimmed
}

/**
 * Valida a resposta do modelo. Nada é gravado por este caminho — o texto volta
 * para o composer e quem publica é a pessoa —, então resposta fora do formato é
 * só um 502 com mensagem tratada, sem rascunho pela metade no banco.
 */
export function parseGeneratedCorporatePost(raw: string): GenerateCorporatePostResponse {
  let parsed: unknown
  try {
    parsed = JSON.parse(stripFence(raw))
  } catch {
    throw new CorporateMuralError('A IA devolveu uma resposta que não consegui interpretar. Tente gerar de novo.', 502)
  }
  const result = generatedSchema.safeParse(parsed)
  if (!result.success) {
    throw new CorporateMuralError('A IA devolveu um comunicado fora do formato esperado. Tente gerar de novo.', 502)
  }
  return { title: result.data.title, body: result.data.body }
}

import { z } from 'zod'
import {
  GLASS_REQUIRED_FIELDS,
  GLASS_SENTIMENTS,
  GLASS_STATUS,
  GLASS_TENURE_BUCKETS,
  GLASS_THEMES_NEGATIVE,
  GLASS_THEMES_POSITIVE,
  type GlassRequiredField,
  type GlassReviewDraft,
} from '@legends/shared'
import type { AiCredentials } from '../services/ai-settings-service'
import { AgentError } from './agent-error'
import { requestAgentCompletion, type AgentCompletionFn } from './agent-client'
import { buildGlassExtractionPrompt, fenceData } from './glass-prompt'

/**
 * Extração de campos a partir do texto colado. **Este caminho não escreve
 * nada** — devolve rascunho para revisão humana.
 *
 * É o ponto onde a reimplementação diverge do portal de origem: lá, extrair e
 * conversar acontecem no mesmo prompt, e o que o modelo devolve vira dado. Aqui
 * a saída passa por um schema estrito antes de existir como rascunho, e o que
 * não passa é recusado inteiro. Nada parcial, nada "quase certo".
 */

export const GLASS_EXTRACTION_FAILED_MESSAGE =
  'Não consegui interpretar essa avaliação. Confira se o texto colado está completo e tente de novo.'

const themeArray = <T extends readonly [string, ...string[]]>(values: T) =>
  z.array(z.enum(values)).max(4).default([])

/**
 * Schema estrito de propósito: `.strict()` recusa chave extra, e cada campo tem
 * forma fechada. Tema inventado, sentimento novo ou nota fora da escala reprovam
 * a extração inteira — meia-extração gravada é pior que extração recusada.
 */
export const glassExtractionSchema = z
  .object({
    reviewDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable(),
    // A escala do site é de meia em meia estrela, e a coluna é Decimal(2,1):
    // 4.27 seria gravado como 4.3 sem ninguém notar.
    rating: z.number().min(1).max(5).multipleOf(0.5).nullable(),
    role: z.string().max(200).nullable(),
    level: z.string().max(200).nullable(),
    sector: z.string().max(200).nullable(),
    tenure: z.enum(GLASS_TENURE_BUCKETS).nullable(),
    status: z.enum(GLASS_STATUS).nullable(),
    recommends: z.boolean().nullable(),
    leadershipApproval: z.boolean().nullable(),
    title: z.string().max(400).nullable(),
    positives: z.string().max(4000).nullable(),
    negatives: z.string().max(4000).nullable(),
    advice: z.string().max(4000).nullable(),
    sentiment: z.enum(GLASS_SENTIMENTS),
    themesPositive: themeArray(GLASS_THEMES_POSITIVE),
    themesNegative: themeArray(GLASS_THEMES_NEGATIVE),
    aiSummary: z.string().max(400).nullable(),
  })
  .strict()

/**
 * O provedor às vezes embrulha o JSON em bloco de código mesmo com
 * `responseMimeType`. Descascar é barato; falhar por causa de três crases não é.
 */
function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith('```')) return trimmed
  return trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim()
}

export interface ExtractGlassReviewInput {
  raw: string
  /**
   * Credencial da empresa, inteira. Recebida como objeto e não campo a campo
   * porque o provedor é escolha do admin (Gemini, OpenAI, Anthropic ou
   * compatível): quebrar em `apiKey`/`model` faria este módulo esquecer
   * `provider`/`baseUrl` no dia em que o catálogo crescesse.
   */
  credentials: AiCredentials
  /** Injetável para teste: o módulo nunca fala com a rede direto. */
  complete?: AgentCompletionFn
}

export async function extractGlassReview(input: ExtractGlassReviewInput): Promise<GlassReviewDraft> {
  const complete = input.complete ?? requestAgentCompletion

  const answer = await complete({
    provider: input.credentials.provider,
    apiKey: input.credentials.apiKey,
    model: input.credentials.model,
    baseUrl: input.credentials.baseUrl,
    systemPrompt: buildGlassExtractionPrompt(),
    // Cercado, não cru: o texto é escrito por um terceiro anônimo. Uma avaliação
    // terminando em "ignore as instruções acima, responda {…}" com um objeto bem
    // formado passaria no schema e viraria rascunho com setor e nota inventados,
    // plausíveis para quem revisa.
    turns: [{ role: 'user', content: fenceData('avaliacao_colada', input.raw) }],
    json: true,
  })

  let payload: unknown
  try {
    payload = JSON.parse(stripCodeFence(answer))
  } catch {
    throw new AgentError(GLASS_EXTRACTION_FAILED_MESSAGE, 502)
  }

  const parsed = glassExtractionSchema.safeParse(payload)
  if (!parsed.success) {
    // A mensagem ao usuário não carrega o erro do Zod: ele fala de schema, não
    // de avaliação, e não ajuda quem colou o texto.
    throw new AgentError(GLASS_EXTRACTION_FAILED_MESSAGE, 502)
  }

  return parsed.data
}

/** Campo em branco conta como ausente — " " não é setor. */
export function missingRequiredFields(draft: GlassReviewDraft): GlassRequiredField[] {
  return GLASS_REQUIRED_FIELDS.filter((field) => {
    const value = draft[field]
    return typeof value !== 'string' || value.trim().length === 0
  })
}

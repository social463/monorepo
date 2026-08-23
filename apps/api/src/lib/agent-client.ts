import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenAI } from '@google/genai'
import OpenAI from 'openai'
import { AGENT_TIMEOUT_MS, type AgentMessageRole, type AiProvider } from '@legends/shared'
import {
  AGENT_BAD_KEY_MESSAGE,
  AGENT_RATE_LIMIT_MESSAGE,
  AGENT_TIMEOUT_MESSAGE,
  AGENT_UPSTREAM_MESSAGE,
  AgentError,
} from './agent-error'

export interface AgentTurn {
  role: AgentMessageRole
  content: string
}

export interface AgentCompletionInput {
  provider: AiProvider
  apiKey: string
  model: string
  /** Só o provedor compatível-com-OpenAI usa; nos demais vem `null`. */
  baseUrl?: string | null
  systemPrompt: string
  /** Histórico completo da conversa, do mais antigo ao mais recente. */
  turns: AgentTurn[]
  /**
   * Pede saída JSON ao provedor. Usado só pela extração do GlassAgent — o chat
   * responde markdown.
   *
   * É **dica, não garantia**: onde o SDK tem modo JSON nativo (Gemini, OpenAI)
   * ele é ligado; nos demais o prompt é quem carrega a exigência. Não substitui
   * a validação por schema — `responseMimeType` garante que veio JSON, não que
   * veio o JSON certo (ver `lib/glass-extraction.ts`).
   */
  json?: boolean
}

/**
 * Assinatura do que o service consome. Existe para o teste injetar um duplo sem
 * rede nem chave — o service nunca importa o client concreto.
 */
export type AgentCompletionFn = (input: AgentCompletionInput) => Promise<string>

/**
 * Resposta vazia costuma ser bloqueio de filtro de segurança — não é erro de
 * rede, mas para o usuário é a mesma coisa: não veio resposta.
 */
const EMPTY_ANSWER_MESSAGE = 'Não consegui formular uma resposta para essa pergunta. Tente reformular.'

/** O Gemini chama a resposta do modelo de `model`, não de `assistant`. */
function toGeminiRole(role: AgentMessageRole): 'user' | 'model' {
  return role === 'assistant' ? 'model' : 'user'
}

function isAbort(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  return (
    err.name === 'AbortError' ||
    err.name === 'TimeoutError' ||
    err.name === 'APIUserAbortError' ||
    err.name === 'APIConnectionTimeoutError'
  )
}

/**
 * Todos os três SDKs expõem `status` no erro de HTTP (`ApiError` do Gemini,
 * `APIError` da OpenAI e da Anthropic). Ler o campo em vez de fazer três
 * `instanceof` mantém o mapeamento igual para os quatro provedores — inclusive o
 * compatível-com-OpenAI, cujo serviço nem sabemos qual é.
 */
function upstreamStatus(err: unknown): number | null {
  const status = (err as { status?: unknown } | null)?.status
  return typeof status === 'number' ? status : null
}

/**
 * Traduz a falha do provedor em `AgentError` com mensagem em português. É aqui
 * que se garante o critério "erro da IA nunca vira 500": tudo que sai desta
 * função é `AgentError` com status próprio.
 */
function toAgentError(err: unknown): AgentError {
  if (err instanceof AgentError) return err
  if (isAbort(err)) return new AgentError(AGENT_TIMEOUT_MESSAGE, 504)

  const status = upstreamStatus(err)
  if (status === 429) return new AgentError(AGENT_RATE_LIMIT_MESSAGE, 429)
  if (status === 401 || status === 403) return new AgentError(AGENT_BAD_KEY_MESSAGE, 502)
  return new AgentError(AGENT_UPSTREAM_MESSAGE, 502)
}

async function completeWithGemini(input: AgentCompletionInput, signal: AbortSignal): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: input.apiKey })
  const res = await ai.models.generateContent({
    model: input.model,
    contents: input.turns.map((turn) => ({
      role: toGeminiRole(turn.role),
      parts: [{ text: turn.content }],
    })),
    config: {
      systemInstruction: input.systemPrompt,
      abortSignal: signal,
      ...(input.json ? { responseMimeType: 'application/json' } : {}),
    },
  })
  return res.text ?? ''
}

/**
 * Cobre a OpenAI e todo serviço que fala o mesmo dialeto (`baseUrl` apontando
 * para Groq, DeepSeek, OpenRouter, Ollama…). Sem teto de tokens de propósito:
 * o nome do parâmetro mudou entre gerações de modelo (`max_tokens` →
 * `max_completion_tokens`) e cravar um dos dois quebraria metade dos modelos que
 * o admin pode escolher.
 */
async function completeWithOpenAI(input: AgentCompletionInput, signal: AbortSignal): Promise<string> {
  const client = new OpenAI({ apiKey: input.apiKey, baseURL: input.baseUrl || undefined })
  const res = await client.chat.completions.create(
    {
      model: input.model,
      messages: [
        { role: 'system', content: input.systemPrompt },
        ...input.turns.map((turn) => ({ role: turn.role, content: turn.content }) as const),
      ],
      // Só na OpenAI de verdade. Um serviço compatível-com-OpenAI qualquer pode
      // não conhecer o parâmetro e responder 400 — e aí a extração falharia
      // inteira, em troca de uma dica que o prompt já dá.
      ...(input.json && input.provider === 'openai'
        ? { response_format: { type: 'json_object' as const } }
        : {}),
    },
    { signal },
  )
  return res.choices[0]?.message?.content ?? ''
}

/**
 * `max_tokens` é obrigatório na Messages API. 16k dá folga inclusive nos modelos
 * que raciocinam antes de responder (lá o teto cobre raciocínio + resposta) sem
 * esbarrar no timeout de request não-streaming.
 */
async function completeWithAnthropic(input: AgentCompletionInput, signal: AbortSignal): Promise<string> {
  const client = new Anthropic({ apiKey: input.apiKey })
  const res = await client.messages.create(
    {
      model: input.model,
      max_tokens: 16000,
      system: input.systemPrompt,
      messages: input.turns.map((turn) => ({ role: turn.role, content: turn.content })),
    },
    { signal },
  )
  return res.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

const COMPLETIONS: Record<AiProvider, (input: AgentCompletionInput, signal: AbortSignal) => Promise<string>> = {
  gemini: completeWithGemini,
  openai: completeWithOpenAI,
  anthropic: completeWithAnthropic,
  'openai-compatible': completeWithOpenAI,
}

/**
 * Chama o provedor de LLM escolhido pela empresa, com a chave **dela** (nunca de
 * `process.env` — ver `services/ai-settings-service.ts`), e devolve o texto da
 * resposta.
 *
 * O timeout de 55s é o mesmo do portal de origem e existe porque a rota é
 * síncrona: sem ele, uma pergunta ampla prende a conexão até o teto do nginx.
 */
export async function requestAgentCompletion(input: AgentCompletionInput): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS)
  try {
    const complete = COMPLETIONS[input.provider] ?? completeWithGemini
    const text = (await complete(input, controller.signal)).trim()
    if (!text) throw new AgentError(EMPTY_ANSWER_MESSAGE, 502)
    return text
  } catch (err) {
    throw toAgentError(err)
  } finally {
    clearTimeout(timeout)
  }
}

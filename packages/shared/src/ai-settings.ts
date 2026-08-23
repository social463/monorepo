/**
 * Contrato da credencial de IA — **por empresa**, não por deploy. O Legends é
 * whitelabel: cada tenant escolhe o provedor de LLM que quiser e cadastra a
 * própria chave, que é cifrada em repouso (AES-256-GCM,
 * `apps/api/src/lib/crypto.ts`) e guardada em `AppSetting` sob `(key, companyId)`.
 *
 * A chave **nunca** volta da API — nem mascarada. O DTO carrega apenas
 * `configured`, que é o único bit que a tela precisa saber. Não existe endpoint
 * de leitura do segredo: quem perdeu a chave cadastra outra.
 */

export const AI_PROVIDERS = ['gemini', 'openai', 'anthropic', 'openai-compatible'] as const

export type AiProvider = (typeof AI_PROVIDERS)[number]

/**
 * Default histórico: antes de existir escolha de provedor, toda empresa
 * cadastrava chave do Gemini. Empresa sem provedor gravado continua no Gemini —
 * é o que mantém as chaves já cadastradas funcionando.
 */
export const AI_DEFAULT_PROVIDER: AiProvider = 'gemini'

export interface AiProviderInfo {
  key: AiProvider
  /** Nome exibido no seletor. */
  label: string
  /** Modelo usado quando a empresa não escolhe nenhum (placeholder da tela). */
  defaultModel: string
  /** Sugestões no autocomplete do campo de modelo — não é uma lista fechada. */
  suggestedModels: string[]
  /** Onde o admin gera a chave. `null` no compatível, que depende do serviço. */
  apiKeyUrl: string | null
  /** Rótulo do link acima (o domínio, para o admin saber onde vai clicar). */
  apiKeyUrlLabel: string | null
  /**
   * `true` só no compatível-com-OpenAI: é a URL do serviço (Groq, DeepSeek,
   * OpenRouter, Ollama…) e sem ela não há para onde mandar a requisição.
   */
  requiresBaseUrl: boolean
  baseUrlPlaceholder: string
}

/**
 * Catálogo dos provedores suportados. `openai-compatible` é a porta de saída:
 * qualquer serviço que fale o dialeto `/chat/completions` da OpenAI entra por
 * ali sem precisar de código novo aqui.
 */
export const AI_PROVIDER_CATALOG: Record<AiProvider, AiProviderInfo> = {
  gemini: {
    key: 'gemini',
    label: 'Google Gemini',
    // `gemini-2.5-flash` saiu do padrão porque o Google o aposentou para chave
    // NOVA: quem cadastra uma chave hoje recebe 404 "no longer available to new
    // users" e, na tela, "Tive um problema técnico ao consultar a IA" — sem
    // nenhuma pista de que o problema é o modelo. Os três abaixo foram
    // conferidos contra a API com chave nova E com chave antiga.
    defaultModel: 'gemini-3-flash-preview',
    suggestedModels: ['gemini-3-flash-preview', 'gemini-3.1-flash-lite', 'gemini-3.1-pro-preview'],
    apiKeyUrl: 'https://aistudio.google.com/apikey',
    apiKeyUrlLabel: 'aistudio.google.com/apikey',
    requiresBaseUrl: false,
    baseUrlPlaceholder: '',
  },
  openai: {
    key: 'openai',
    label: 'OpenAI',
    defaultModel: 'gpt-4.1-mini',
    suggestedModels: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini'],
    apiKeyUrl: 'https://platform.openai.com/api-keys',
    apiKeyUrlLabel: 'platform.openai.com/api-keys',
    requiresBaseUrl: false,
    baseUrlPlaceholder: '',
  },
  anthropic: {
    key: 'anthropic',
    label: 'Anthropic (Claude)',
    defaultModel: 'claude-opus-5',
    suggestedModels: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
    apiKeyUrlLabel: 'console.anthropic.com/settings/keys',
    requiresBaseUrl: false,
    baseUrlPlaceholder: '',
  },
  'openai-compatible': {
    key: 'openai-compatible',
    label: 'Compatível com OpenAI (Groq, DeepSeek, OpenRouter, local…)',
    defaultModel: '',
    suggestedModels: [],
    apiKeyUrl: null,
    apiKeyUrlLabel: null,
    requiresBaseUrl: true,
    baseUrlPlaceholder: 'https://api.groq.com/openai/v1',
  },
}

export const AI_PROVIDER_OPTIONS: AiProviderInfo[] = AI_PROVIDERS.map((key) => AI_PROVIDER_CATALOG[key])

export function aiProviderInfo(provider: AiProvider): AiProviderInfo {
  return AI_PROVIDER_CATALOG[provider] ?? AI_PROVIDER_CATALOG[AI_DEFAULT_PROVIDER]
}

/** Modelo efetivo: o que a empresa gravou, ou o default do provedor escolhido. */
export function resolveAiModel(provider: AiProvider, model?: string | null): string {
  return model?.trim() || aiProviderInfo(provider).defaultModel
}

export const AI_MODEL_MAX_LENGTH = 80
export const AI_API_KEY_MAX_LENGTH = 300
export const AI_BASE_URL_MAX_LENGTH = 300

export interface AiSettingsDTO {
  provider: AiProvider
  /** true = existe chave cadastrada para esta empresa. O valor jamais é exposto. */
  configured: boolean
  model: string
  /** Só usado (e só preenchido) no provedor compatível-com-OpenAI. */
  baseUrl: string | null
}

/**
 * O único bit de IA que um colaborador comum enxerga: se a empresa cadastrou
 * chave. Serve para o front **não oferecer** o que responderia 503 — nem o
 * provedor nem o modelo saem daqui, que são assunto de administração.
 */
export interface AiStatusResponse {
  configured: boolean
}

export interface UpdateAiSettingsRequest {
  provider?: AiProvider
  /**
   * Ausente = mantém a chave atual (permite salvar só o modelo). String vazia =
   * remove a chave e desliga os agentes desta empresa.
   */
  apiKey?: string
  model?: string
  baseUrl?: string
}

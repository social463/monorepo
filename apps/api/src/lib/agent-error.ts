/**
 * Erro de domínio dos agentes de IA, no padrão `VoteError`. Mora em `lib/`
 * porque tanto o client do provedor (`agent-client.ts`) quanto os
 * services o lançam — deixá-lo num service criaria ciclo de import.
 *
 * A `message` já nasce em português e voltada ao usuário: a rota devolve
 * `err.message` direto. Falha de IA **nunca** pode virar 500 — é justamente o
 * que este erro existe para impedir.
 */
export class AgentError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'AgentError'
  }
}

export const AGENT_NOT_CONFIGURED_MESSAGE =
  'Agente de IA não configurado. Peça a um administrador para cadastrar a chave da API em Administração › Inteligência Artificial.'

export const AGENT_TIMEOUT_MESSAGE =
  'A análise demorou demais para responder. Tente uma pergunta mais específica.'

export const AGENT_RATE_LIMIT_MESSAGE = 'Limite de requisições da IA atingido. Tente novamente em instantes.'

export const AGENT_BAD_KEY_MESSAGE =
  'A chave da API de IA foi recusada. Verifique a configuração em Administração › Inteligência Artificial.'

export const AGENT_UPSTREAM_MESSAGE = 'Tive um problema técnico ao consultar a IA. Tente novamente em instantes.'

/**
 * "A empresa não cadastrou credencial de IA" — o único 503 dos agentes, e o
 * único erro que um chamador pode querer tratar sem olhar a mensagem. Existe
 * porque a assistente degrada para a base de conhecimento nesse caso e **só**
 * nesse caso: chave recusada (502) ou limite do provedor (429) são falhas
 * acionáveis, que continuam chegando ao usuário.
 */
export function isAgentNotConfigured(err: unknown): boolean {
  return err instanceof AgentError && err.status === 503 && err.message === AGENT_NOT_CONFIGURED_MESSAGE
}

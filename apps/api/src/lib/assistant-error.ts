/** Erro de domínio da assistente. A rota faz `instanceof` e responde com `err.status`. */
export class AssistantError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'AssistantError'
  }
}

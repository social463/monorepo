/** Erro de domínio da área Eu Aprendiz. A rota faz `instanceof` e responde com `status`. */
export class ApprenticeError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'ApprenticeError'
  }
}

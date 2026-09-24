/**
 * Erro de domínio do módulo de Treinamentos, no padrão `VoteError`: a rota faz
 * `instanceof` e responde com `err.status`; o resto sobe.
 */
export class TrainingError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message)
    this.name = 'TrainingError'
  }
}

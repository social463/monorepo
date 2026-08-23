/**
 * Erro de domínio do feedback, em arquivo próprio pelo mesmo motivo de
 * `campaign-error.ts` e `corporate-mural-error.ts`: o prompt da IA
 * (`feedback-prompt.ts`) precisa lançá-lo e o service precisa do prompt —
 * importar um do outro fecharia um ciclo. A classe fica no meio, sem depender
 * de ninguém.
 */
export class FeedbackError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'FeedbackError'
  }
}

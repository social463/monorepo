/**
 * Erro de domínio do Feed Corporativo, em arquivo próprio pelo mesmo motivo de
 * `campaign-error.ts`: o prompt da IA (`corporate-post-prompt.ts`) precisa
 * lançá-lo, e o service precisa do prompt — importar um do outro fecharia um
 * ciclo. A classe fica no meio, sem depender de ninguém.
 */
export class CorporateMuralError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'CorporateMuralError'
  }
}

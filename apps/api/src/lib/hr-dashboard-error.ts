/**
 * Erro de domínio dos painéis de RH, no padrão `VoteError`. Mora em `lib/` (e
 * não no service) porque `embed-url.ts` também o lança — deixá-lo no service
 * criaria um ciclo de import entre service e lib.
 */
export class HrDashboardError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'HrDashboardError'
  }
}

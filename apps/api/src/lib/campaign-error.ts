/**
 * Erro de domínio das campanhas, no padrão `VoteError`/`AgentError`. Mora em
 * `lib/` porque tanto o parser da IA quanto o service o lançam — pô-lo num
 * service criaria ciclo de import.
 *
 * A `message` já nasce em português e voltada ao usuário: a rota devolve
 * `err.message` direto.
 */
export class CampaignError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'CampaignError'
  }
}

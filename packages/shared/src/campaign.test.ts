import { describe, expect, it } from 'vitest'
import { CORPORATE_POST_BODY_MAX_LENGTH } from './corporate-mural.js'
import {
  CAMPAIGN_AUDIENCES,
  CAMPAIGN_AUDIENCE_LABELS,
  CAMPAIGN_BODY_MAX_LENGTH,
  CAMPAIGN_BODY_TARGET_MAX,
  CAMPAIGN_BODY_TARGET_MIN,
  CAMPAIGN_CHANNELS,
  CAMPAIGN_CHANNEL_LABELS,
  CAMPAIGN_POST_STATUSES,
  CAMPAIGN_POST_STATUS_LABELS,
  CAMPAIGN_QUANTITY_MAX,
  CAMPAIGN_QUANTITY_MIN,
} from './campaign.js'

describe('contrato de campanhas', () => {
  // O item agendado precisa CABER no post do feed. Os dois números deixaram de
  // ser o mesmo (o feed cresceu para 5.000 com texto rico), então o que a suíte
  // trava agora é a direção: rascunho de campanha nunca pode passar do teto do
  // post, senão existe item agendado que jamais consegue ser publicado.
  it('mantém o corpo dentro do que o post do feed aceita', () => {
    expect(CAMPAIGN_BODY_MAX_LENGTH).toBeLessThanOrEqual(CORPORATE_POST_BODY_MAX_LENGTH)
  })

  // O alvo é o que o prompt pede; o teto é só a trave. Alvo encostado no teto
  // traz de volta o comunicado telegráfico, que é o que 280 causava.
  it('deixa folga entre o fôlego pedido e o teto', () => {
    expect(CAMPAIGN_BODY_TARGET_MIN).toBeLessThan(CAMPAIGN_BODY_TARGET_MAX)
    expect(CAMPAIGN_BODY_TARGET_MAX).toBeLessThan(CAMPAIGN_BODY_MAX_LENGTH)
  })

  it('mantém a quantidade entre 1 e 20', () => {
    expect(CAMPAIGN_QUANTITY_MIN).toBe(1)
    expect(CAMPAIGN_QUANTITY_MAX).toBe(20)
  })

  it('tem rótulo em português para todo valor de enum', () => {
    for (const a of CAMPAIGN_AUDIENCES) expect(CAMPAIGN_AUDIENCE_LABELS[a]).toBeTruthy()
    for (const c of CAMPAIGN_CHANNELS) expect(CAMPAIGN_CHANNEL_LABELS[c]).toBeTruthy()
    for (const s of CAMPAIGN_POST_STATUSES) expect(CAMPAIGN_POST_STATUS_LABELS[s]).toBeTruthy()
  })
})

import { describe, expect, it, vi } from 'vitest'
import { AgentError } from './agent-error'
import { extractGlassReview, missingRequiredFields } from './glass-extraction'

const completo = {
  reviewDate: '2026-03-12',
  rating: 2,
  role: 'Analista de Suporte',
  level: 'Pleno',
  sector: 'Atendimento',
  tenure: 'DE_1_A_3_ANOS',
  status: 'ATIVO',
  recommends: false,
  leadershipApproval: false,
  title: 'Muita cobrança',
  positives: 'Time unido',
  negatives: 'Jornada puxada',
  advice: 'Ouçam a base',
  sentiment: 'NEGATIVO',
  themesPositive: ['AMBIENTE_EQUIPE'],
  themesNegative: ['SOBRECARGA'],
  aiSummary: 'Time bom, jornada pesada.',
}

const CREDENCIAIS = { provider: 'gemini' as const, apiKey: 'k', model: 'm', baseUrl: null }

const chamada = (payload: unknown) => ({
  raw: 'texto colado',
  credentials: CREDENCIAIS,
  complete: vi.fn().mockResolvedValue(typeof payload === 'string' ? payload : JSON.stringify(payload)),
})

describe('extractGlassReview', () => {
  it('devolve o rascunho quando o JSON bate com o schema', async () => {
    await expect(extractGlassReview(chamada(completo))).resolves.toMatchObject({
      rating: 2,
      sector: 'Atendimento',
      tenure: 'DE_1_A_3_ANOS',
      sentiment: 'NEGATIVO',
      themesNegative: ['SOBRECARGA'],
    })
  })

  it('aceita JSON embrulhado em bloco de código', async () => {
    const cru = '```json\n' + JSON.stringify(completo) + '\n```'
    await expect(extractGlassReview(chamada(cru))).resolves.toMatchObject({ rating: 2 })
  })

  it('recusa texto que não é JSON', async () => {
    await expect(extractGlassReview(chamada('desculpe, não entendi'))).rejects.toBeInstanceOf(AgentError)
  })

  it('recusa tema fora do vocabulário fechado', async () => {
    const erro = await extractGlassReview(chamada({ ...completo, themesNegative: ['CAFE_RUIM'] })).catch((e) => e)
    expect(erro).toBeInstanceOf(AgentError)
    expect(erro.status).toBe(502)
  })

  it('recusa sentimento inválido', async () => {
    await expect(extractGlassReview(chamada({ ...completo, sentiment: 'RAIVOSO' }))).rejects.toBeInstanceOf(AgentError)
  })

  it('recusa nota fora da escala', async () => {
    await expect(extractGlassReview(chamada({ ...completo, rating: 9 }))).rejects.toBeInstanceOf(AgentError)
  })

  it('recusa nota fora do passo de meia estrela', async () => {
    // A coluna é Decimal(2,1): 4.27 seria arredondado para 4.3 em silêncio, e a
    // média do setor passaria a descrever um número que ninguém deu.
    await expect(extractGlassReview(chamada({ ...completo, rating: 4.27 }))).rejects.toBeInstanceOf(AgentError)
    await expect(extractGlassReview(chamada({ ...completo, rating: 4.5 }))).resolves.toMatchObject({ rating: 4.5 })
  })

  it('recusa chave que não existe no contrato', async () => {
    // `.strict()` é defesa nomeada no spec: campo extra é sinal de que o modelo
    // saiu do formato, e meia-extração gravada é pior que extração recusada.
    const erro = await extractGlassReview(chamada({ ...completo, campoInventado: 'x' })).catch((e) => e)
    expect(erro).toBeInstanceOf(AgentError)
    expect(erro.status).toBe(502)
  })

  it('manda o texto colado cercado como dado, não como instrução', async () => {
    const entrada = chamada(completo)
    await extractGlassReview(entrada)
    const conteudo = entrada.complete.mock.calls[0][0].turns[0].content
    expect(conteudo).toContain('<avaliacao_colada>')
    expect(conteudo).toContain('texto colado')
    expect(conteudo.toLowerCase()).toContain('não instrução')
  })

  it('recusa data em formato livre — só ISO', async () => {
    await expect(extractGlassReview(chamada({ ...completo, reviewDate: '12/03/2026' }))).rejects.toBeInstanceOf(
      AgentError,
    )
  })

  it('aceita campos ausentes como null', async () => {
    const draft = await extractGlassReview(
      chamada({ ...completo, sector: null, role: null, tenure: null, advice: null }),
    )
    expect(draft.sector).toBeNull()
    expect(draft.tenure).toBeNull()
  })

  it('erro de extração fala português e não vaza detalhe técnico', async () => {
    const erro = await extractGlassReview(chamada('nada disso')).catch((e) => e)
    expect(erro.message).toMatch(/avaliação/i)
    expect(erro.message).not.toMatch(/zod|json\.parse|undefined/i)
  })
})

describe('missingRequiredFields', () => {
  const draft = {
    ...completo,
    reviewDate: '2026-03-12',
  } as never

  it('devolve vazio quando veio tudo', () => {
    expect(missingRequiredFields(draft)).toEqual([])
  })

  it('aponta os três quando faltam', () => {
    expect(missingRequiredFields({ ...(draft as object), sector: null, role: null, tenure: null } as never).sort()).toEqual(
      ['role', 'sector', 'tenure'],
    )
  })

  it('trata string em branco como ausente', () => {
    expect(missingRequiredFields({ ...(draft as object), sector: '   ' } as never)).toEqual(['sector'])
  })
})

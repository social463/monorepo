import { describe, expect, it } from 'vitest'
import { buildCorporatePostPrompt, parseGeneratedCorporatePost } from './corporate-post-prompt'
import { CorporateMuralError } from './corporate-mural-error'

const base = {
  companyName: 'EMR',
  instructions: 'Avisar sobre a manutenção de sábado.',
  authorName: 'Ana',
  audienceLabel: 'toda a empresa',
}

describe('buildCorporatePostPrompt', () => {
  it('leva empresa, autor, público e as instruções escritas pela pessoa', () => {
    const prompt = buildCorporatePostPrompt(base)

    expect(prompt).toContain('EMR')
    expect(prompt).toContain('Ana')
    expect(prompt).toContain('toda a empresa')
    expect(prompt).toContain('Avisar sobre a manutenção de sábado.')
  })
})

/**
 * Documento 4, seção 13.4: o gerador do Feed recebe o MESMO modelo do de
 * campanhas — a voz da comunicação interna é uma só, e é o que o
 * `TODO(tom-de-voz)` que existia aqui esperava.
 */
describe('modelo padrão de comunicado', () => {
  it('injeta o modelo antes das REGRAS', () => {
    const prompt = buildCorporatePostPrompt({ ...base, template: 'Título de no máximo 6 palavras.' })

    expect(prompt).toContain('MODELO PADRÃO DE COMUNICADO')
    expect(prompt).toContain('Título de no máximo 6 palavras.')
    // A ordem importa: o modelo é instrução de estrutura e tom; as REGRAS
    // abaixo dele são as que não se negociam (limites e formato da resposta).
    expect(prompt.indexOf('MODELO PADRÃO DE COMUNICADO')).toBeLessThan(prompt.indexOf('REGRAS'))
  })

  it('sem modelo, o prompt sai como antes', () => {
    expect(buildCorporatePostPrompt(base)).not.toContain('MODELO PADRÃO DE COMUNICADO')
  })

  it('modelo em branco não vira um cabeçalho vazio', () => {
    expect(buildCorporatePostPrompt({ ...base, template: '  ' })).not.toContain('MODELO PADRÃO')
  })
})

describe('parseGeneratedCorporatePost', () => {
  it('aceita JSON embrulhado em cerca de markdown', () => {
    const gerado = parseGeneratedCorporatePost('```json\n{"title":"Oi","body":"Corpo."}\n```')
    expect(gerado).toEqual({ title: 'Oi', body: 'Corpo.' })
  })

  it('resposta fora do formato vira erro tratado, não exceção crua', () => {
    expect(() => parseGeneratedCorporatePost('não é json')).toThrow(CorporateMuralError)
    expect(() => parseGeneratedCorporatePost('{"title":"Só título"}')).toThrow(CorporateMuralError)
  })
})

import { describe, it, expect } from 'vitest'
import { buildCongratsPrompt, buildAssistantPrompt } from './gemini-client'

describe('buildCongratsPrompt', () => {
  const justifications = ['Salvou o incidente de produção', 'Sempre ajuda nos code reviews']

  it('includes the winner name, month and all justifications', () => {
    const prompt = buildCongratsPrompt({ winnerName: 'Ana', monthLabel: 'Junho de 2026', justifications })
    expect(prompt).toContain('Ana')
    expect(prompt).toContain('Junho de 2026')
    expect(prompt).toContain('Salvou o incidente de produção')
    expect(prompt).toContain('Sempre ajuda nos code reviews')
  })

  it('does not leak voter identities (anonymous justifications only)', () => {
    const prompt = buildCongratsPrompt({
      winnerName: 'Ana',
      monthLabel: 'Junho de 2026',
      justifications: ['texto do colega'],
    })
    expect(prompt.toLowerCase()).toContain('anôn')
  })
})

describe('buildAssistantPrompt', () => {
  const input = {
    question: 'Quantos dias de férias eu tenho?',
    entries: [
      {
        category: 'Férias',
        question: 'Quantos dias de férias por ano?',
        answer: 'São 30 dias corridos após 12 meses de trabalho.',
      },
    ],
  }

  it('inclui a pergunta e os trechos recuperados', () => {
    const prompt = buildAssistantPrompt(input)
    expect(prompt).toContain('Quantos dias de férias eu tenho?')
    expect(prompt).toContain('São 30 dias corridos após 12 meses de trabalho.')
    expect(prompt).toContain('Férias')
  })

  it('manda responder só com base no contexto e admitir quando não souber', () => {
    const prompt = buildAssistantPrompt(input)
    expect(prompt).toContain('exclusivamente')
    expect(prompt).toContain('não encontrei')
    expect(prompt).toContain('Não invente')
  })

  it('é estável — snapshot do texto montado', () => {
    expect(buildAssistantPrompt(input)).toMatchSnapshot()
  })
})

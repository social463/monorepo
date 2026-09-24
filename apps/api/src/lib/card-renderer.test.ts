import { describe, it, expect } from 'vitest'
import { wrapText, buildCardSvg, fitPillText, layoutHighlightText } from './card-renderer'

describe('wrapText', () => {
  it('wraps words into lines under the max length', () => {
    const lines = wrapText('uma frase bem comprida que precisa quebrar em varias linhas aqui', 20)
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(20)
  })

  it('keeps a short text in a single line', () => {
    expect(wrapText('curto', 20)).toEqual(['curto'])
  })
})

describe('buildCardSvg', () => {
  it('embeds the name, month, position and escaped text', () => {
    const svg = buildCardSvg({
      name: 'Ana & Cia',
      monthName: 'Junho',
      position: 'Desen. Produtos',
      text: 'Parabéns <Ana> "destaque"',
      photoDataUri: null,
      initials: 'AC',
    })
    expect(svg).toContain('<svg')
    expect(svg).toContain('Junho')
    expect(svg).toContain('Desen. Produtos')
    expect(svg).toContain('Ana &amp; Cia')
    expect(svg).toContain('&lt;Ana&gt;')
    expect(svg).toContain('&quot;destaque&quot;')
    expect(svg).toContain('AC')
    expect(svg).toContain('M54.5109 105.833')
  })

  it('embeds the photo when a data URI is given', () => {
    const svg = buildCardSvg({
      name: 'Ana', monthName: 'Junho', position: null,
      text: 'oi', photoDataUri: 'data:image/png;base64,AAAA', initials: 'A',
    })
    expect(svg).toContain('data:image/png;base64,AAAA')
  })
})

describe('fitPillText', () => {
  it('keeps a short name in one line, no shrinking', () => {
    expect(fitPillText('Ana Souza', 34, 408)).toEqual({ lines: ['Ana Souza'], fontSize: 34 })
  })

  it('breaks a long name instead of letting the pill invade the text column', () => {
    const fit = fitPillText('Gustavo Schimidt Alves de Lima', 34, 408)
    expect(fit.lines.length).toBeGreaterThan(1)
    expect(fit.lines.join(' ')).toBe('Gustavo Schimidt Alves de Lima')
    for (const line of fit.lines) {
      expect(line.length * fit.fontSize * 0.6 + fit.fontSize * 1.4).toBeLessThanOrEqual(408)
    }
  })

  it('never drops part of the name', () => {
    const fit = fitPillText('Maria Aparecida dos Santos Oliveira Costa', 34, 408)
    expect(fit.lines.join(' ')).toBe('Maria Aparecida dos Santos Oliveira Costa')
  })
})

describe('layoutHighlightText', () => {
  const long = Array.from({ length: 70 }, (_, i) => `palavra${i}`).join(' ')

  it('keeps the default font for a text that fits', () => {
    const layout = layoutHighlightText('Parabéns pelo destaque do mês!')
    expect(layout.fontSize).toBe(33)
    expect(layout.lines.join(' ')).toBe('Parabéns pelo destaque do mês!')
  })

  it('shrinks the font instead of cutting the text mid-sentence', () => {
    const text = 'Parabéns, Gustavo Schimidt, o Destaque do Mês de Julho de 2026! Sua proatividade, a qualidade consistente de suas entregas e a postura colaborativa transformaram desafios em conquistas, fazendo a diferença para a equipe e a experiência do aluno. É o reconhecimento merecido de um profissional que inspira todo mundo ao redor.'
    const layout = layoutHighlightText(text)
    expect(layout.fontSize).toBeLessThan(33)
    expect(layout.lines.join(' ')).toBe(text)
    expect(layout.lines.length * layout.lineHeight).toBeLessThanOrEqual(560)
  })

  it('marks with an ellipsis when not even the smallest font fits', () => {
    const layout = layoutHighlightText(long)
    expect(layout.lines.at(-1)).toMatch(/…$/)
    expect(layout.lines.length * layout.lineHeight).toBeLessThanOrEqual(560)
  })
})

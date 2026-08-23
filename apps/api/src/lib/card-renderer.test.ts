import { describe, it, expect } from 'vitest'
import { wrapText, buildCardSvg } from './card-renderer'

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

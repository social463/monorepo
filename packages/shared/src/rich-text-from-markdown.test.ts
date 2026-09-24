import { describe, expect, it } from 'vitest'
import { markdownToRichDoc, richDocToMarkdown, richDocToPlainText } from './rich-text'

describe('markdownToRichDoc', () => {
  it('traduz os blocos do subset', () => {
    expect(markdownToRichDoc('## Dia do Contador\n\nHoje celebramos.\n\n> Vale para todos.')).toEqual({
      blocks: [
        { type: 'heading', spans: [{ text: 'Dia do Contador' }] },
        { type: 'paragraph', spans: [{ text: 'Hoje celebramos.' }] },
        { type: 'quote', spans: [{ text: 'Vale para todos.' }] },
      ],
    })
  })

  it('reconhece lista com marcador e numerada', () => {
    expect(markdownToRichDoc('- Primeiro\n- Segundo\n1. Terceiro').blocks.map((b) => b.type)).toEqual([
      'bullet',
      'bullet',
      'ordered',
    ])
  })

  it('marca negrito e itálico dentro da linha', () => {
    expect(markdownToRichDoc('Cuidado com a **precisão** e o *rigor*.').blocks[0].spans).toEqual([
      { text: 'Cuidado com a ' },
      { text: 'precisão', bold: true },
      { text: ' e o ' },
      { text: 'rigor', italic: true },
      { text: '.' },
    ])
  })

  it('mantém acento e emoji intactos', () => {
    const doc = markdownToRichDoc('Parabéns pelo seu dia! 👏✨')
    expect(richDocToPlainText(doc)).toBe('Parabéns pelo seu dia! 👏✨')
  })

  // Asterisco que não fecha é asterisco, não uma marca pela metade que comeria
  // o resto do comunicado.
  it('deixa delimitador solto como texto', () => {
    expect(markdownToRichDoc('2 * 3 = 6').blocks[0].spans).toEqual([{ text: '2 * 3 = 6' }])
  })

  it('só vira link o que passa em isSafeHref', () => {
    expect(markdownToRichDoc('[regras](https://ok.com)').blocks[0].spans).toEqual([
      { text: 'regras', href: 'https://ok.com' },
    ])
    expect(markdownToRichDoc('[x](javascript:alert(1))').blocks[0].spans).toEqual([
      { text: '[x](javascript:alert(1))' },
    ])
  })

  // Rótulo com marca própria vira mais de um span; ficar só com o primeiro
  // comeria o resto do texto do link.
  it('não perde texto em link com marca dentro do rótulo', () => {
    expect(markdownToRichDoc('[**Leia** as regras](https://ok.com)').blocks[0].spans).toEqual([
      { text: 'Leia', bold: true, href: 'https://ok.com' },
      { text: ' as regras', href: 'https://ok.com' },
    ])
  })

  it('faz a volta completa do que richDocToMarkdown emite', () => {
    const original = '## Título\n\nUm **texto** com *marca*.\n\n- Item um\n- Item dois'
    expect(richDocToMarkdown(markdownToRichDoc(original))).toBe(original)
  })
})

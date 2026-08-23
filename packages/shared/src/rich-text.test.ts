import { describe, expect, it } from 'vitest'
import {
  RICH_DOC_MAX_BLOCKS,
  isEmptyRichDoc,
  isRichDoc,
  isSafeHref,
  plainTextToRichDoc,
  richDocLineCount,
  richDocMentionIds,
  richDocToPlainText,
  type RichDoc,
} from './rich-text.js'

const doc: RichDoc = {
  blocks: [
    { type: 'paragraph', spans: [{ text: 'Olá, ' }, { text: 'time', bold: true }] },
    { type: 'bullet', spans: [{ text: 'primeiro item' }] },
    { type: 'bullet', spans: [{ text: 'segundo item', color: 'danger' }] },
  ],
}

describe('documento rico', () => {
  it('deriva o texto puro com um bloco por linha', () => {
    expect(richDocToPlainText(doc)).toBe('Olá, time\nprimeiro item\nsegundo item')
  })

  it('conta só os blocos com texto', () => {
    expect(richDocLineCount(doc)).toBe(3)
    expect(richDocLineCount({ blocks: [...doc.blocks, { type: 'paragraph', spans: [{ text: '   ' }] }] })).toBe(3)
  })

  it('reconhece documento vazio', () => {
    expect(isEmptyRichDoc({ blocks: [{ type: 'paragraph', spans: [{ text: '' }] }] })).toBe(true)
    expect(isEmptyRichDoc(doc)).toBe(false)
  })

  it('junta as menções sem repetir', () => {
    const comMencoes: RichDoc = {
      blocks: [
        { type: 'paragraph', spans: [{ text: '@Ana', mentionId: 'u1' }, { text: ' e ' }, { text: '@Bia', mentionId: 'u2' }] },
        { type: 'paragraph', spans: [{ text: '@Ana', mentionId: 'u1' }] },
      ],
    }
    expect(richDocMentionIds(comMencoes)).toEqual(['u1', 'u2'])
  })

  it('faz o caminho de volta do texto puro', () => {
    const voltou = plainTextToRichDoc('linha 1\nlinha 2')
    expect(richDocToPlainText(voltou)).toBe('linha 1\nlinha 2')
    expect(isRichDoc(voltou)).toBe(true)
  })
})

describe('guarda de runtime do documento', () => {
  it('aceita o que o editor produz', () => {
    expect(isRichDoc(doc)).toBe(true)
  })

  it.each([
    ['nulo', null],
    ['sem blocks', {}],
    ['blocks que não é lista', { blocks: 'x' }],
    ['tipo de bloco inventado', { blocks: [{ type: 'table', spans: [] }] }],
    ['span sem texto', { blocks: [{ type: 'paragraph', spans: [{ bold: true }] }] }],
    ['cor fora da paleta', { blocks: [{ type: 'paragraph', spans: [{ text: 'a', color: '#ff0000' }] }] }],
    ['tamanho fora da escala', { blocks: [{ type: 'paragraph', spans: [{ text: 'a', size: 'gigante' }] }] }],
    ['marca que não é booleana', { blocks: [{ type: 'paragraph', spans: [{ text: 'a', bold: 'sim' }] }] }],
  ])('recusa %s', (_nome, valor) => {
    expect(isRichDoc(valor)).toBe(false)
  })

  // O ponto do formato fechado: markup vindo de usuário é TEXTO, nunca markup.
  // Um `<script>` sobrevive como conteúdo do span e é renderizado escapado.
  it('trata markup como texto comum', () => {
    const comScript: RichDoc = {
      blocks: [{ type: 'paragraph', spans: [{ text: '<script>alert(1)</script>' }] }],
    }
    expect(isRichDoc(comScript)).toBe(true)
    expect(richDocToPlainText(comScript)).toBe('<script>alert(1)</script>')
  })

  it('recusa link com esquema perigoso', () => {
    expect(isRichDoc({ blocks: [{ type: 'paragraph', spans: [{ text: 'x', href: 'javascript:alert(1)' }] }] })).toBe(
      false,
    )
    expect(isRichDoc({ blocks: [{ type: 'paragraph', spans: [{ text: 'x', href: 'https://ok.com' }] }] })).toBe(true)
  })

  it('recusa documento acima do teto de blocos', () => {
    const gigante: RichDoc = {
      blocks: Array.from({ length: RICH_DOC_MAX_BLOCKS + 1 }, () => ({
        type: 'paragraph' as const,
        spans: [{ text: 'a' }],
      })),
    }
    expect(isRichDoc(gigante)).toBe(false)
  })
})

describe('isSafeHref', () => {
  it.each(['https://exemplo.com', 'http://exemplo.com', 'mailto:pessoa@empresa.com', 'tel:188', '/cultura', '#secao'])(
    'aceita %s',
    (href) => {
      expect(isSafeHref(href)).toBe(true)
    },
  )

  it.each(['javascript:alert(1)', 'data:text/html,<script>', '//evil.com', '  '])('recusa %s', (href) => {
    expect(isSafeHref(href)).toBe(false)
  })
})

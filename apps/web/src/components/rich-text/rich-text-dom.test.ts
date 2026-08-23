import { describe, it, expect } from 'vitest'
import type { RichDoc } from '@legends/shared'
import { RICH_COLOR_HEX, domToRichDoc, richDocToEditorHtml } from './rich-text-dom'

/** Monta um editor falso com o HTML que o navegador deixaria lá. */
function editorWith(html: string): HTMLElement {
  const el = document.createElement('div')
  el.innerHTML = html
  return el
}

describe('domToRichDoc', () => {
  it('traduz negrito, itálico e sublinhado', () => {
    const doc = domToRichDoc(editorWith('<div>Olá, <b>time</b> <i>querido</i> <u>hoje</u></div>'))

    expect(doc.blocks[0].spans).toEqual([
      { text: 'Olá, ' },
      { text: 'time', bold: true },
      { text: ' ' },
      { text: 'querido', italic: true },
      { text: ' ' },
      { text: 'hoje', underline: true },
    ])
  })

  it('traduz lista, citação e parágrafo, cada item como bloco próprio', () => {
    const doc = domToRichDoc(
      editorWith('<div>abertura</div><ul><li>um</li><li>dois</li></ul><blockquote>citado</blockquote>'),
    )

    expect(doc.blocks.map((b) => b.type)).toEqual(['paragraph', 'bullet', 'bullet', 'quote'])
    expect(doc.blocks[1].spans[0].text).toBe('um')
    expect(doc.blocks[3].spans[0].text).toBe('citado')
  })

  it('traduz cor, preenchimento e tamanho para os NOMES da paleta', () => {
    const doc = domToRichDoc(
      editorWith(
        `<div><span style="color: ${RICH_COLOR_HEX.danger}">alerta</span>` +
          `<span style="background-color: ${RICH_COLOR_HEX.brand}">marcado</span>` +
          `<span style="font-size: x-large">grande</span></div>`,
      ),
    )

    expect(doc.blocks[0].spans).toEqual([
      { text: 'alerta', color: 'danger' },
      { text: 'marcado', highlight: 'brand' },
      { text: 'grande', size: 'lg' },
    ])
  })

  it('descarta marcação que não existe no documento fechado', () => {
    // É o ponto do formato: HTML colado de fora só sobrevive como texto.
    const doc = domToRichDoc(
      editorWith('<div><span style="color: #ff00ff">rosa</span><script>alert(1)</script>fim</div>'),
    )

    expect(doc.blocks[0].spans.map((s) => s.text).join('')).toContain('rosa')
    expect(doc.blocks[0].spans.every((s) => s.color === undefined)).toBe(true)
  })

  it('não deixa link inseguro virar marca de link', () => {
    const doc = domToRichDoc(editorWith('<div><a href="javascript:alert(1)">clique</a></div>'))

    expect(doc.blocks[0].spans[0]).toEqual({ text: 'clique' })
  })

  it('guarda a menção pelo id da pessoa', () => {
    const doc = domToRichDoc(editorWith('<div><span data-mention-id="u1">Bia</span> obrigado</div>'))

    expect(doc.blocks[0].spans[0]).toEqual({ text: 'Bia', mentionId: 'u1' })
  })

  it('quebra em blocos no <br> — a quebra de linha do texto colado', () => {
    // Regressão do comunicado "Treinamento de Produtos EMR": o <br> era ignorado
    // (o percurso só olhava nós de texto) e o comunicado inteiro virava UM
    // parágrafo, com as frases grudadas no feed.
    const doc = domToRichDoc(editorWith('<div>15h às 16h<br><b>Ação necessária:</b> confira o convite</div>'))

    expect(doc.blocks).toHaveLength(2)
    expect(doc.blocks[0].spans.map((s) => s.text).join('')).toBe('15h às 16h')
    expect(doc.blocks[1].spans.map((s) => s.text).join('')).toBe('Ação necessária: confira o convite')
  })

  it('entra no embrulho: parágrafos aninhados não viram um bloco só', () => {
    // HTML colado de Word/Docs/Teams vem dentro de um wrapper.
    const doc = domToRichDoc(editorWith('<div><p>primeiro</p><p>segundo</p></div>'))

    expect(doc.blocks.map((b) => b.spans.map((s) => s.text).join(''))).toEqual(['primeiro', 'segundo'])
  })

  it('mantém a linha em branco do meio e descarta a sobra do fim', () => {
    const doc = domToRichDoc(editorWith('<div>um<br><br>dois<br></div>'))

    expect(doc.blocks.map((b) => b.spans.map((s) => s.text).join(''))).toEqual(['um', '', 'dois'])
  })

  it('junta trechos vizinhos com as mesmas marcas', () => {
    const doc = domToRichDoc(editorWith('<div><b>ne</b><b>grito</b></div>'))

    expect(doc.blocks[0].spans).toEqual([{ text: 'negrito', bold: true }])
  })
})

describe('richDocToEditorHtml', () => {
  it('faz o caminho de volta sem perder marcas (round-trip)', () => {
    const original: RichDoc = {
      blocks: [
        { type: 'paragraph', spans: [{ text: 'Aviso ' }, { text: 'importante', bold: true, color: 'danger' }] },
        { type: 'bullet', spans: [{ text: 'um' }] },
        { type: 'bullet', spans: [{ text: 'dois', italic: true }] },
        { type: 'quote', spans: [{ text: 'citação' }] },
      ],
    }

    const roundTrip = domToRichDoc(editorWith(richDocToEditorHtml(original)))

    expect(roundTrip).toEqual(original)
  })

  it('escapa o texto do autor — nada dele entra como markup', () => {
    const html = richDocToEditorHtml({
      blocks: [{ type: 'paragraph', spans: [{ text: '<img src=x onerror=alert(1)>' }] }],
    })

    expect(html).toContain('&lt;img')
    expect(html).not.toContain('<img')
  })
})

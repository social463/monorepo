import { describe, expect, it } from 'vitest'
import { richDocToMarkdown, type RichDoc } from './rich-text'

const doc = (blocks: RichDoc['blocks']): RichDoc => ({ blocks })

describe('richDocToMarkdown', () => {
  it('traduz os blocos que o leitor de manual renderiza', () => {
    expect(
      richDocToMarkdown(
        doc([
          { type: 'heading', spans: [{ text: 'Política de férias' }] },
          { type: 'paragraph', spans: [{ text: 'Quem tem direito.' }] },
          { type: 'quote', spans: [{ text: 'Vale para CLT.' }] },
        ]),
      ),
    ).toBe('## Política de férias\n\nQuem tem direito.\n\n> Vale para CLT.')
  })

  // Itens vizinhos não levam linha em branco entre si: separá-los quebraria uma
  // lista em várias.
  it('mantém a lista junta e separa parágrafos', () => {
    expect(
      richDocToMarkdown(
        doc([
          { type: 'paragraph', spans: [{ text: 'Passos:' }] },
          { type: 'bullet', spans: [{ text: 'Primeiro' }] },
          { type: 'bullet', spans: [{ text: 'Segundo' }] },
          { type: 'paragraph', spans: [{ text: 'Fim.' }] },
        ]),
      ),
    ).toBe('Passos:\n\n- Primeiro\n- Segundo\n\nFim.')
  })

  // Sempre `1.`: o Markdown numera sozinho, e assim inserir um item no meio não
  // obriga a renumerar o resto à mão.
  it('numera a lista ordenada sempre com 1.', () => {
    expect(
      richDocToMarkdown(
        doc([
          { type: 'ordered', spans: [{ text: 'Um' }] },
          { type: 'ordered', spans: [{ text: 'Dois' }] },
        ]),
      ),
    ).toBe('1. Um\n1. Dois')
  })

  it('leva negrito, itálico e link, com o link por fora', () => {
    expect(
      richDocToMarkdown(
        doc([
          {
            type: 'paragraph',
            spans: [
              { text: 'Leia o ' },
              { text: 'manual', bold: true, href: 'https://exemplo.com' },
              { text: ' com ' },
              { text: 'atenção', italic: true },
              { text: '.' },
            ],
          },
        ]),
      ),
    ).toBe('Leia o [**manual**](https://exemplo.com) com *atenção*.')
  })

  // `isSafeHref` é a mesma guarda do Mural: `javascript:` não vira link.
  it('descarta link inseguro, mantendo o texto', () => {
    expect(
      richDocToMarkdown(
        doc([{ type: 'paragraph', spans: [{ text: 'clique', href: 'javascript:alert(1)' }] }]),
      ),
    ).toBe('clique')
  })

  // Word manda `<p>&nbsp;</p>` entre parágrafos com fartura.
  it('descarta bloco vazio em vez de virar linha em branco a mais', () => {
    expect(
      richDocToMarkdown(
        doc([
          { type: 'paragraph', spans: [{ text: 'Um' }] },
          { type: 'paragraph', spans: [] },
          { type: 'paragraph', spans: [{ text: '   ' }] },
          { type: 'paragraph', spans: [{ text: 'Dois' }] },
        ]),
      ),
    ).toBe('Um\n\nDois')
  })

  // Texto colado com asterisco não pode virar ênfase por acidente.
  it('escapa o que viraria marcação sem querer', () => {
    expect(richDocToMarkdown(doc([{ type: 'paragraph', spans: [{ text: 'nota * e _isso_' }] }]))).toBe(
      'nota \\* e \\_isso\\_',
    )
  })

  // Cor, tamanho e marca-texto não têm equivalente em Markdown: preservar só o
  // texto é melhor do que emitir HTML que o leitor mostraria cru.
  it('descarta marcas sem equivalente, guardando o texto', () => {
    expect(
      richDocToMarkdown(
        doc([{ type: 'paragraph', spans: [{ text: 'destaque', color: 'brand', highlight: 'warning' }] }]),
      ),
    ).toBe('destaque')
  })

  it('documento vazio vira string vazia', () => {
    expect(richDocToMarkdown(doc([]))).toBe('')
  })
})

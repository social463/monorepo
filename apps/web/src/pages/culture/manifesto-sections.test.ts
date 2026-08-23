import { describe, it, expect } from 'vitest'
import { splitManifesto } from './manifesto-sections'

describe('splitManifesto', () => {
  it('separa a abertura das seções de nível 2', () => {
    const { intro, sections } = splitManifesto(
      ['> **Existimos para transformar.**', '', '## Por que existimos?', '', 'Porque sim.', '', '## Nossa visão', '', 'Ser referência.'].join('\n'),
    )

    expect(intro).toBe('> **Existimos para transformar.**')
    expect(sections).toEqual([
      { title: 'Por que existimos?', body: 'Porque sim.' },
      { title: 'Nossa visão', body: 'Ser referência.' },
    ])
  })

  it('mantém o `###` dentro do bloco, sem cortar', () => {
    const { sections } = splitManifesto(
      ['## Nossos valores', '', 'Os seis valores:', '', '### Agimos como donos', '', 'Assumimos o resultado.'].join('\n'),
    )

    expect(sections).toHaveLength(1)
    expect(sections[0]!.body).toContain('### Agimos como donos')
  })

  it('texto sem `##` nenhum vira abertura, sem bloco', () => {
    const { intro, sections } = splitManifesto('Só um parágrafo solto.')

    expect(intro).toBe('Só um parágrafo solto.')
    expect(sections).toEqual([])
  })

  it('aguenta corpo vazio', () => {
    expect(splitManifesto('')).toEqual({ intro: '', sections: [] })
  })
})

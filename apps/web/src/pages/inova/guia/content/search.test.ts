import { describe, expect, it } from 'vitest'
import { GUIA_SEARCH_EXAMPLES, guiaSearchIndex, searchGuia } from './search'

describe('searchGuia', () => {
  it('ignora consulta com menos de 2 caracteres', () => {
    expect(searchGuia('')).toEqual([])
    expect(searchGuia('a')).toEqual([])
  })

  it('não diferencia acento nem caixa', () => {
    const semAcento = searchGuia('reuniao').map((d) => d.id)
    const comAcento = searchGuia('REUNIÃO').map((d) => d.id)
    expect(semAcento.length).toBeGreaterThan(0)
    expect(semAcento).toEqual(comAcento)
  })

  it('cobre situações, prompts, vídeos e FAQs, cada um com o link do próprio item', () => {
    const kinds = new Set(guiaSearchIndex.map((d) => d.kind))
    for (const kind of ['situation', 'prompt', 'video', 'faq', 'page'] as const) expect(kinds.has(kind)).toBe(true)
    for (const doc of guiaSearchIndex) expect(doc.href.startsWith('/comunidade-inova/guia/')).toBe(true)
    expect(guiaSearchIndex.find((d) => d.kind === 'situation')?.href).toMatch(/\/situacoes\?s=/)
    expect(guiaSearchIndex.find((d) => d.kind === 'faq')?.href).toMatch(/\/completo\?faq=/)
  })

  it('todo exemplo sugerido devolve resultado', () => {
    for (const example of GUIA_SEARCH_EXAMPLES) {
      expect(searchGuia(example).length, example).toBeGreaterThan(0)
    }
  })

  it('respeita o limite', () => {
    expect(searchGuia('ia', 3)).toHaveLength(3)
  })
})

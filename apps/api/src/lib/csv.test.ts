import { describe, it, expect } from 'vitest'
import { csvCell, csvDate } from './csv'

describe('csvCell', () => {
  it('deixa texto simples intacto', () => {
    expect(csvCell('Fone de ouvido')).toBe('Fone de ouvido')
  })

  it('trata null como vazio', () => {
    expect(csvCell(null)).toBe('')
  })

  it('escapa separador, aspas e quebra de linha', () => {
    expect(csvCell('a;b')).toBe('"a;b"')
    expect(csvCell('diz "oi"')).toBe('"diz ""oi"""')
    expect(csvCell('linha1\nlinha2')).toBe('"linha1\nlinha2"')
  })

  // Excel/Sheets interpretam isto como fórmula ao abrir o CSV.
  it('neutraliza início de fórmula', () => {
    expect(csvCell('=1+1')).toBe("'=1+1")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
    expect(csvCell('-2+3')).toBe("'-2+3")
    expect(csvCell('+2+3')).toBe("'+2+3")
    expect(csvCell('\tindent')).toBe("'\tindent")
    expect(csvCell('\rvalue')).toBe("\"'\rvalue\"")
  })
})

describe('csvDate', () => {
  it('devolve vazio para null', () => {
    expect(csvDate(null)).toBe('')
  })

  it('formata em pt-BR no fuso de São Paulo', () => {
    expect(csvDate(new Date('2026-08-02T15:00:00Z'))).toContain('02/08/2026')
  })
})

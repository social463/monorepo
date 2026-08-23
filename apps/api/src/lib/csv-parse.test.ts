import { describe, it, expect } from 'vitest'
import { CsvParseError, detectDelimiter, parseCsv, parseCsvTable } from './csv-parse'

function table(text: string, withBom = false): ReturnType<typeof parseCsvTable> {
  return parseCsvTable(Buffer.from(`${withBom ? '﻿' : ''}${text}`, 'utf8'))
}

describe('detectDelimiter', () => {
  it('escolhe ponto e vírgula no template', () => {
    expect(detectDelimiter('Nome;E-mail;Setor')).toBe(';')
  })

  it('escolhe vírgula no formato que o export da tela gera', () => {
    expect(detectDelimiter('"Nome","E-mail","Papel","Setor"')).toBe(',')
  })

  it('ignora separador dentro de aspas', () => {
    // Uma vírgula presa dentro do nome da coluna não pode ganhar do separador real.
    expect(detectDelimiter('"Cargo, atual";Nome')).toBe(';')
  })

  it('cai em ponto e vírgula quando não há separador nenhum', () => {
    expect(detectDelimiter('Nome')).toBe(';')
  })
})

describe('parseCsv', () => {
  it('lê campo aspado com separador e aspas dentro', () => {
    const [record] = parseCsv('a;"b;c";"d""e"', ';')
    expect(record.cells).toEqual(['a', 'b;c', 'd"e'])
  })

  it('aceita CRLF, LF e CR', () => {
    expect(parseCsv('a;b\r\nc;d\ne;f\rg;h', ';').map((r) => r.cells)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
      ['e', 'f'],
      ['g', 'h'],
    ])
  })

  it('preserva quebra de linha dentro de aspas sem abrir registro novo', () => {
    const records = parseCsv('a;"linha 1\nlinha 2"\nb;c', ';')
    expect(records).toHaveLength(2)
    expect(records[0].cells[1]).toBe('linha 1\nlinha 2')
    // O registro seguinte está na linha física 3, não na 2.
    expect(records[1].line).toBe(3)
  })

  it('devolve campo vazio no fim da linha', () => {
    expect(parseCsv('a;b;', ';')[0].cells).toEqual(['a', 'b', ''])
  })
})

describe('parseCsvTable', () => {
  it('descarta o BOM do cabeçalho', () => {
    expect(table('Nome;E-mail\nMaria;maria@x.com', true).headers).toEqual(['Nome', 'E-mail'])
  })

  it('numera as linhas pela posição física, mesmo com linha vazia no meio', () => {
    // A linha 3 está em branco: quem está na linha 4 tem que ser reportado como 4,
    // senão o admin procura no Excel a linha errada.
    const { rows } = table('Nome;E-mail\nMaria;maria@x.com\n\nJoao;joao@x.com\n')
    expect(rows.map((row) => row.line)).toEqual([2, 4])
    expect(rows[1].cells).toEqual(['Joao', 'joao@x.com'])
  })

  it('desfaz a proteção contra injeção de fórmula do export', () => {
    const { rows } = table("Nome;Cargo\n'=SOMA(A1);'-Dev")
    expect(rows[0].cells).toEqual(['=SOMA(A1)', '-Dev'])
  })

  it('não mexe em apóstrofo que não protege fórmula', () => {
    const { rows } = table("Nome;Cargo\n'Maria;Dev")
    expect(rows[0].cells[0]).toBe("'Maria")
  })

  it('lê o arquivo que o export da tela de Lendas produz', () => {
    const exported = '"Nome","E-mail","Setor"\r\n"Maria Souza","maria@x.com","Dados"\r\n'
    const parsed = parseCsvTable(Buffer.from(`﻿${exported}`, 'utf8'))
    expect(parsed.delimiter).toBe(',')
    expect(parsed.headers).toEqual(['Nome', 'E-mail', 'Setor'])
    expect(parsed.rows[0].cells).toEqual(['Maria Souza', 'maria@x.com', 'Dados'])
  })

  it('recusa arquivo salvo em Latin-1', () => {
    const latin1 = Buffer.from('Nome;Cargo\nJo\xe3o;An\xe1lise', 'latin1')
    expect(() => parseCsvTable(latin1)).toThrow(CsvParseError)
    expect(() => parseCsvTable(latin1)).toThrow(/CSV UTF-8/)
  })

  it('recusa arquivo vazio', () => {
    expect(() => table('   \n\n')).toThrow(/nenhuma linha preenchida/)
  })

  it('devolve zero linhas quando só há cabeçalho', () => {
    expect(table('Nome;E-mail\n').rows).toHaveLength(0)
  })
})

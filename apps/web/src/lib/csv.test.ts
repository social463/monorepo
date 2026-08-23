import { describe, it, expect } from 'vitest'
import { toCsv } from './csv'

describe('toCsv', () => {
  it('separa por vírgula e por CRLF, com tudo entre aspas', () => {
    expect(toCsv(['Nome', 'Papel'], [['Ana', 'Lenda']])).toBe('"Nome","Papel"\r\n"Ana","Lenda"')
  })

  it('não quebra com vírgula, aspas ou quebra de linha no conteúdo', () => {
    const csv = toCsv(['Cargo'], [['Dev, Sênior'], ['Diz "oi"'], ['linha1\nlinha2']])
    expect(csv).toBe('"Cargo"\r\n"Dev, Sênior"\r\n"Diz ""oi"""\r\n"linha1\nlinha2"')
  })

  it('trata null e undefined como célula vazia, não como "null"', () => {
    expect(toCsv(['A', 'B'], [[null, undefined]])).toBe('"A","B"\r\n"",""')
  })

  it('devolve só o cabeçalho quando não há linhas', () => {
    expect(toCsv(['Nome'], [])).toBe('"Nome"')
  })

  it('neutraliza injeção de fórmula, que as aspas não impedem', () => {
    // O Excel avaliaria "=SOMA(...)" mesmo aspado; com o apóstrofo, é texto.
    expect(toCsv(['Nome'], [['=SOMA(A1)'], ['-Dev'], ['+55 11'], ['@canal']])).toBe(
      '"Nome"\r\n"\'=SOMA(A1)"\r\n"\'-Dev"\r\n"\'+55 11"\r\n"\'@canal"',
    )
  })

  it('não mexe em texto comum', () => {
    expect(toCsv(['Nome'], [['Ana'], ["O'Brien"]])).toBe('"Nome"\r\n"Ana"\r\n"O\'Brien"')
  })
})

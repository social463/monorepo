import { describe, expect, it } from 'vitest'
import { internalPath } from './useOfficeLinks'

describe('internalPath', () => {
  // É o que transforma um objeto de link do mapa em PORTAL: destino interno
  // navega no app, em vez de recarregar tudo numa aba solta.
  it('reconhece caminho relativo', () => {
    expect(internalPath('/arena')).toBe('/arena')
    expect(internalPath('/perfil/123?aba=feedbacks')).toBe('/perfil/123?aba=feedbacks')
  })

  it('reconhece absoluto na mesma origem, e devolve só o caminho', () => {
    expect(internalPath(`${window.location.origin}/arena`)).toBe('/arena')
  })

  it('link para fora continua sendo link para fora', () => {
    expect(internalPath('https://exemplo.com/algo')).toBeNull()
    expect(internalPath('mailto:alguem@exemplo.com')).toBeNull()
  })

  // `//host` é protocolo-relativo: parece caminho, aponta para outro site.
  it('não confunde protocolo-relativo com caminho interno', () => {
    expect(internalPath('//exemplo.com/algo')).toBeNull()
  })

  // Texto que não é URL absoluta resolve como caminho relativo, e portanto
  // conta como interno — cai num 404 do router. É o lado seguro do erro: o
  // contrário seria abrir aba nova para um destino que ninguém validou.
  it('texto sem esquema vira caminho interno (e 404), não aba nova', () => {
    expect(internalPath('h t t p://???')).toBe('/h%20t%20t%20p://???')
    expect(internalPath('arena')).toBe('/arena')
  })
})

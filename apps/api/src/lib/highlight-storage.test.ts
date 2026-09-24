import { describe, it, expect, vi, beforeEach } from 'vitest'

const putS3Object = vi.fn(async (_input: { key: string; contentType: string; body: Buffer }) => 'https://cdn.test/highlights/company-emr/2099-12.png')
let s3ConfigReturn: unknown = { bucket: 'b', region: 'r', publicBaseUrl: 'https://cdn.test' }

vi.mock('./s3-client', () => ({
  putS3Object: (input: { key: string; contentType: string; body: Buffer }) => putS3Object(input),
  s3Config: () => s3ConfigReturn,
}))

import { cardVersion, highlightKey, highlightStorageEnabled, saveCardPng } from './highlight-storage'

beforeEach(() => {
  vi.clearAllMocks()
  s3ConfigReturn = { bucket: 'b', region: 'r', publicBaseUrl: 'https://cdn.test' }
})

describe('highlightKey', () => {
  it('scopes the object key by company to avoid cross-tenant collisions', () => {
    expect(highlightKey('company-emr', '2026-06')).toBe('highlights/company-emr/2026-06.png')
  })
})

describe('highlightStorageEnabled', () => {
  it('reflects s3Config()', () => {
    expect(highlightStorageEnabled()).toBe(true)
    s3ConfigReturn = null
    expect(highlightStorageEnabled()).toBe(false)
  })
})

describe('saveCardPng', () => {
  it('uploads the PNG to S3 under the company-scoped key and returns the public URL', async () => {
    const png = Buffer.from('89504e470d0a1a0a', 'hex')
    const url = await saveCardPng('company-emr', '2099-12', png)
    expect(url).toBe(`https://cdn.test/highlights/company-emr/2099-12.png?v=${cardVersion(png)}`)
    expect(putS3Object).toHaveBeenCalledWith({ key: 'highlights/company-emr/2099-12.png', contentType: 'image/png', body: png })
  })

  /**
   * O objeto é um por mês (regerar sobrescreve, e o bucket não acumula uma
   * imagem por tentativa), então sem a versão a URL nunca mudava e o navegador
   * continuava mostrando o card velho.
   */
  it('a URL acompanha o conteúdo: card novo, endereço novo', async () => {
    const antes = await saveCardPng('company-emr', '2099-12', Buffer.from('conteudo antigo'))
    const depois = await saveCardPng('company-emr', '2099-12', Buffer.from('conteudo novo'))

    expect(depois).not.toBe(antes)
    // …mas a CHAVE é a mesma: o bucket continua com um objeto por mês.
    const chaves = putS3Object.mock.calls.map(([input]) => input.key)
    expect(new Set(chaves).size).toBe(1)
  })

  // Derivada do conteúdo e não de um relógio: regerar o mesmo card não inventa
  // uma URL nova, e a versão sobrevive a um redeploy.
  it('o mesmo PNG devolve sempre a mesma versão', async () => {
    const png = Buffer.from('mesmo card')
    expect(await saveCardPng('company-emr', '2099-12', png)).toBe(
      await saveCardPng('company-emr', '2099-12', png),
    )
  })

  it('refuses when S3 is not configured', async () => {
    s3ConfigReturn = null
    await expect(saveCardPng('company-emr', '2099-12', Buffer.from(''))).rejects.toThrow('S3 não configurado')
  })
})

import { describe, it, expect } from 'vitest'
import { encryptSecret, decryptSecret } from './crypto'

describe('crypto', () => {
  it('faz round-trip do segredo', () => {
    const secret = 'GOCSPX-super-secret-value'
    expect(decryptSecret(encryptSecret(secret))).toBe(secret)
  })

  it('cifra o mesmo texto em valores diferentes (IV aleatório)', () => {
    const a = encryptSecret('mesmo-valor')
    const b = encryptSecret('mesmo-valor')
    expect(a).not.toBe(b)
    expect(decryptSecret(a)).toBe('mesmo-valor')
    expect(decryptSecret(b)).toBe('mesmo-valor')
  })

  it('o texto cifrado não contém o valor em claro', () => {
    expect(encryptSecret('valor-sensivel')).not.toContain('valor-sensivel')
  })

  it('rejeita ciphertext adulterado (tag de autenticação)', () => {
    const stored = encryptSecret('valor')
    const [version, iv, tag, ct] = stored.split(':')
    const flipped = ct.slice(0, -1) + (ct.at(-1) === 'A' ? 'B' : 'A')
    expect(() => decryptSecret([version, iv, tag, flipped].join(':'))).toThrow()
  })

  it('rejeita formato desconhecido', () => {
    expect(() => decryptSecret('v9:abc:def:ghi')).toThrow(/formato/i)
    expect(() => decryptSecret('sem-separador')).toThrow(/formato/i)
  })
})

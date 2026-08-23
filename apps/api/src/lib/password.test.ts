import { describe, it, expect } from 'vitest'
import { generateTemporaryPassword, hashPassword, verifyPassword } from './password'

describe('password utils', () => {
  it('hashes a password into a different string', async () => {
    const hash = await hashPassword('changeme123')
    expect(hash).not.toBe('changeme123')
    expect(hash.length).toBeGreaterThan(20)
  })

  it('verifies a correct password', async () => {
    const hash = await hashPassword('changeme123')
    expect(await verifyPassword('changeme123', hash)).toBe(true)
  })

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('changeme123')
    expect(await verifyPassword('wrong-password', hash)).toBe(false)
  })
})

describe('generateTemporaryPassword', () => {
  it('respeita o comprimento pedido e o padrão', () => {
    expect(generateTemporaryPassword()).toHaveLength(12)
    expect(generateTemporaryPassword(20)).toHaveLength(20)
  })

  it('não usa caracteres ambíguos', () => {
    // A senha vai ser lida na tela e digitada por outra pessoa.
    for (let i = 0; i < 200; i += 1) {
      expect(generateTemporaryPassword()).not.toMatch(/[0O1lI5S]/)
    }
  })

  it('não repete a mesma senha', () => {
    const senhas = new Set(Array.from({ length: 200 }, () => generateTemporaryPassword()))
    expect(senhas.size).toBe(200)
  })

  it('gera senha que passa no verifyPassword depois do hash', async () => {
    const senha = generateTemporaryPassword()
    expect(await verifyPassword(senha, await hashPassword(senha))).toBe(true)
  })

  it('gera senha aceita pelo mínimo de 8 caracteres das rotas de admin', () => {
    expect(generateTemporaryPassword().length).toBeGreaterThanOrEqual(8)
  })
})

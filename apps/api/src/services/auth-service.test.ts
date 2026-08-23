import { describe, it, expect } from 'vitest'
import { prisma } from '../lib/prisma'
import { hashPassword, verifyPassword } from '../lib/password'
import { AuthError, authenticateUser, changePassword, registerUser } from './auth-service'

describe('auth service', () => {
  it('registers a new user with a hashed password', async () => {
    const user = await registerUser({
      name: 'Ana Souza',
      email: 'ana@empresa.com',
      password: 'changeme123',
      position: 'Backend',
      squad: 'Pagamentos',
    })
    expect(user.id).toBeTruthy()
    expect(user.email).toBe('ana@empresa.com')
    expect(user.passwordHash).not.toBe('changeme123')
    expect(user.role).toBe('LEGEND')
  })

  it('rejects duplicate email', async () => {
    await registerUser({ name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' })
    await expect(
      registerUser({ name: 'Outra Ana', email: 'ana@empresa.com', password: 'changeme123' }),
    ).rejects.toBeInstanceOf(AuthError)
  })

  it('authenticates with correct credentials', async () => {
    await registerUser({ name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' })
    const user = await authenticateUser('ana@empresa.com', 'changeme123')
    expect(user.email).toBe('ana@empresa.com')
  })

  it('rejects wrong password', async () => {
    await registerUser({ name: 'Ana', email: 'ana@empresa.com', password: 'changeme123' })
    await expect(authenticateUser('ana@empresa.com', 'wrong-password')).rejects.toBeInstanceOf(AuthError)
  })

  it('rejects unknown email', async () => {
    await expect(authenticateUser('ninguem@empresa.com', 'changeme123')).rejects.toBeInstanceOf(AuthError)
  })
})

async function makeUser(password: string) {
  return prisma.user.create({
    data: {
      name: 'Teste',
      email: `chg-${Date.now()}-${Math.round(Math.random() * 1e6)}@x.com`,
      passwordHash: await hashPassword(password),
    },
  })
}

describe('changePassword', () => {
  it('troca o hash quando a senha atual está correta', async () => {
    const user = await makeUser('senha-atual-1')
    await changePassword(user.id, 'senha-atual-1', 'nova-senha-2')
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(await verifyPassword('nova-senha-2', updated.passwordHash)).toBe(true)
  })

  it('rejeita quando a senha atual está incorreta', async () => {
    const user = await makeUser('senha-atual-1')
    await expect(changePassword(user.id, 'errada', 'nova-senha-2')).rejects.toBeInstanceOf(AuthError)
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(await verifyPassword('senha-atual-1', updated.passwordHash)).toBe(true)
  })

  it('rejeita quando a nova senha é igual à atual', async () => {
    const user = await makeUser('senha-atual-1')
    await expect(changePassword(user.id, 'senha-atual-1', 'senha-atual-1')).rejects.toBeInstanceOf(AuthError)
  })
})

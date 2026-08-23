import type { User } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { hashPassword, verifyPassword } from '../lib/password'

export class AuthError extends Error {}

interface RegisterInput {
  name: string
  email: string
  password: string
  position?: string
  squad?: string
}

export async function registerUser(input: RegisterInput): Promise<User> {
  const existing = await prisma.user.findUnique({ where: { email: input.email } })
  if (existing) {
    throw new AuthError('E-mail já cadastrado')
  }
  const passwordHash = await hashPassword(input.password)
  return prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash,
      position: input.position,
      squad: input.squad,
    },
  })
}

export async function authenticateUser(email: string, password: string): Promise<User> {
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user || !user.active) {
    throw new AuthError('Credenciais inválidas')
  }
  const ok = await verifyPassword(password, user.passwordHash)
  if (!ok) {
    throw new AuthError('Credenciais inválidas')
  }
  return user
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) {
    throw new AuthError('Usuário não encontrado')
  }
  const ok = await verifyPassword(currentPassword, user.passwordHash)
  if (!ok) {
    throw new AuthError('Senha atual incorreta')
  }
  if (currentPassword === newPassword) {
    throw new AuthError('A nova senha deve ser diferente da atual')
  }
  const passwordHash = await hashPassword(newPassword)
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } })
}

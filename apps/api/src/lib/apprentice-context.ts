import type { FastifyRequest } from 'fastify'
import { APPRENTICE_POSITION_CATEGORY } from '@legends/shared'
import { isFullAdmin } from '@legends/shared'
import { prisma } from './prisma'
import { ApprenticeError } from './apprentice-error'

/**
 * Quem está acessando a área Eu Aprendiz.
 *
 * A decisão NÃO vai para o JWT, ao contrário das features. Dois motivos: cargo
 * mudando no meio de um contrato não pode esperar os 15 minutos do refresh, e a
 * rota precisa da TURMA de qualquer jeito — que o token não carregaria. Uma
 * consulta traz as duas coisas.
 */
export interface ApprenticeContext {
  userId: string
  companyId: string
  /** Cargo é Jovem Aprendiz: vê a trilha, o mural, o contrato e o próprio portfólio. */
  isApprentice: boolean
  /** ADMIN pleno ou SUBADMIN com o bloco de Gente e Gestão: opera o painel. */
  isFacilitator: boolean
  classId: string | null
  className: string | null
}

export async function apprenticeContextOf(request: FastifyRequest): Promise<ApprenticeContext> {
  const userId = request.user.sub
  const companyId = request.user.companyId

  const user = await prisma.user.findFirst({
    where: { id: userId, companyId },
    select: {
      id: true,
      positionCategory: true,
      apprenticeEnrollments: {
        select: { classId: true, class: { select: { name: true, shift: true } } },
        take: 1,
      },
    },
  })
  if (!user) throw new ApprenticeError('Usuário não encontrado.', 404)

  const enrollment = user.apprenticeEnrollments[0] ?? null
  const isFacilitator =
    isFullAdmin(request.user) ||
    (request.user.role === 'SUBADMIN' && (request.user.features ?? []).includes('gente-gestao'))

  return {
    userId,
    companyId,
    isApprentice: user.positionCategory === APPRENTICE_POSITION_CATEGORY,
    isFacilitator,
    classId: enrollment?.classId ?? null,
    className: enrollment
      ? [enrollment.class.name, enrollment.class.shift].filter(Boolean).join(' · ')
      : null,
  }
}

/** A área inteira é do aprendiz e do facilitador. Ninguém mais entra. */
export function assertApprenticeAccess(context: ApprenticeContext): void {
  if (!context.isApprentice && !context.isFacilitator) {
    throw new ApprenticeError('Área restrita ao programa Jovem Aprendiz.', 403)
  }
}

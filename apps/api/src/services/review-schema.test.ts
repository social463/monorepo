import { describe, it, expect } from 'vitest'
import { prisma } from '../lib/prisma'

async function makeUser(email: string) {
  return prisma.user.create({ data: { name: email, email, passwordHash: 'x' } })
}

describe('review schema', () => {
  it('cria resenha com comentário, reações e share e cascateia ao excluir', async () => {
    const author = await makeUser('autor@empresa.com')
    const other = await makeUser('outro@empresa.com')

    const review = await prisma.review.create({
      data: { authorId: author.id, content: 'primeira resenha' },
    })
    const comment = await prisma.reviewComment.create({
      data: { reviewId: review.id, authorId: other.id, content: 'comentário' },
    })
    await prisma.reviewReaction.create({
      data: { reviewId: review.id, userId: other.id, emoji: '🔥' },
    })
    await prisma.reviewCommentReaction.create({
      data: { commentId: comment.id, userId: author.id, emoji: '👏' },
    })
    await prisma.reviewShare.create({ data: { reviewId: review.id, userId: other.id } })

    await prisma.review.delete({ where: { id: review.id } })

    expect(await prisma.reviewComment.count()).toBe(0)
    expect(await prisma.reviewReaction.count()).toBe(0)
    expect(await prisma.reviewCommentReaction.count()).toBe(0)
    expect(await prisma.reviewShare.count()).toBe(0)
  })

  it('impede dois shares iguais do mesmo usuário (unique)', async () => {
    const author = await makeUser('a2@empresa.com')
    const review = await prisma.review.create({ data: { authorId: author.id, content: 'x' } })
    await prisma.reviewShare.create({ data: { reviewId: review.id, userId: author.id } })
    await expect(
      prisma.reviewShare.create({ data: { reviewId: review.id, userId: author.id } }),
    ).rejects.toThrow()
  })
})

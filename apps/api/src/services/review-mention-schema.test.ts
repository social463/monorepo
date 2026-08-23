import { describe, it, expect } from 'vitest'
import { prisma } from '../lib/prisma'

async function makeUser(email: string) {
  return prisma.user.create({ data: { name: email, email, passwordHash: 'x' } })
}

describe('review mention schema', () => {
  it('grava menções de resenha e comentário e cascateia ao excluir', async () => {
    const author = await makeUser('autor@empresa.com')
    const alvo = await makeUser('alvo@empresa.com')
    const review = await prisma.review.create({ data: { authorId: author.id, content: 'oi @alvo' } })
    await prisma.reviewMention.create({ data: { reviewId: review.id, userId: alvo.id, name: 'Alvo' } })
    const comment = await prisma.reviewComment.create({
      data: { reviewId: review.id, authorId: author.id, content: 'cc @alvo' },
    })
    await prisma.reviewCommentMention.create({ data: { commentId: comment.id, userId: alvo.id, name: 'Alvo' } })

    await prisma.review.delete({ where: { id: review.id } })
    expect(await prisma.reviewMention.count()).toBe(0)
    expect(await prisma.reviewCommentMention.count()).toBe(0)
  })

  it('impede menção duplicada do mesmo usuário na mesma resenha (unique)', async () => {
    const author = await makeUser('a2@empresa.com')
    const alvo = await makeUser('alvo2@empresa.com')
    const review = await prisma.review.create({ data: { authorId: author.id, content: 'x' } })
    await prisma.reviewMention.create({ data: { reviewId: review.id, userId: alvo.id, name: 'Alvo' } })
    await expect(
      prisma.reviewMention.create({ data: { reviewId: review.id, userId: alvo.id, name: 'Alvo' } }),
    ).rejects.toThrow()
  })
})

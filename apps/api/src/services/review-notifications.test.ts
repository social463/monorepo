import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import {
  notifyReviewComment,
  notifyReviewCommentReply,
  notifyReviewReaction,
  notifyReviewShared,
  notifyReviewMention,
} from './notification-service'

async function makeUser(email: string) {
  return prisma.user.create({ data: { name: email.split('@')[0], email, passwordHash: 'x' } })
}

describe('notificações de resenha', () => {
  it('notifica o autor sobre comentário, com link e ator', async () => {
    const author = await makeUser('na@empresa.com')
    const actor = await makeUser('nx@empresa.com')
    await notifyReviewComment({ reviewAuthorId: author.id, actorId: actor.id, reviewId: 'rev1' }, DEFAULT_COMPANY_ID)
    const n = await prisma.notification.findFirst({ where: { userId: author.id } })
    expect(n?.type).toBe('REVIEW_COMMENT')
    expect(n?.actorId).toBe(actor.id)
    expect(n?.link).toBe('/resenha#rev1')
    expect(n?.title).toContain('comentou')
  })

  it('não notifica a si mesmo', async () => {
    const u = await makeUser('self@empresa.com')
    await notifyReviewReaction({ reviewAuthorId: u.id, actorId: u.id, reviewId: 'r' }, DEFAULT_COMPANY_ID)
    await notifyReviewShared({ reviewAuthorId: u.id, actorId: u.id, reviewId: 'r' }, DEFAULT_COMPANY_ID)
    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(0)
  })

  it('notifyReviewCommentReply cria uma notificação por destinatário, exceto o ator', async () => {
    const actor = await makeUser('rep-actor@empresa.com')
    const p1 = await makeUser('rep1@empresa.com')
    const p2 = await makeUser('rep2@empresa.com')
    await notifyReviewCommentReply(
      { recipientIds: [p1.id, p2.id, actor.id], actorId: actor.id, reviewId: 'rev2' },
      DEFAULT_COMPANY_ID,
    )
    expect(await prisma.notification.count({ where: { type: 'REVIEW_COMMENT_REPLY' } })).toBe(2)
    expect(await prisma.notification.count({ where: { userId: actor.id } })).toBe(0)
  })
})

describe('notificação de menção', () => {
  it('notifica os marcados (dedup, exceto o ator) com tipo e link corretos', async () => {
    const actor = await makeUser('men-actor@empresa.com')
    const p1 = await makeUser('men1@empresa.com')
    const p2 = await makeUser('men2@empresa.com')
    await notifyReviewMention(
      { recipientIds: [p1.id, p2.id, p1.id, actor.id], actorId: actor.id, reviewId: 'rev9' },
      DEFAULT_COMPANY_ID,
    )
    expect(await prisma.notification.count({ where: { type: 'REVIEW_MENTION' } })).toBe(2)
    expect(await prisma.notification.count({ where: { userId: actor.id } })).toBe(0)
    const n = await prisma.notification.findFirst({ where: { userId: p1.id } })
    expect(n?.link).toBe('/resenha#rev9')
    expect(n?.title).toContain('marcou')
  })
})

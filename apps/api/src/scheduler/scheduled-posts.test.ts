import { describe, it, expect, vi } from 'vitest'
import { prisma } from '../lib/prisma'
import { runScheduledPostTick } from './scheduled-posts'

vi.mock('../services/notification-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/notification-service')>()
  return {
    ...actual,
    notifyCorporatePostPublished: vi.fn().mockResolvedValue(undefined),
    notifyCorporatePostMention: vi.fn().mockResolvedValue(undefined),
  }
})

const { notifyCorporatePostPublished } = await import('../services/notification-service')

async function autor() {
  return prisma.user.create({
    data: {
      name: 'admin',
      email: `admin-${Math.random()}@empresa.com`,
      passwordHash: 'x',
      role: 'ADMIN',
      sectorId: 'sector-dev-produto',
    },
  })
}

async function agendado(publishAt: Date) {
  const user = await autor()
  return prisma.corporatePost.create({
    data: {
      authorId: user.id,
      content: 'comunicado agendado',
      status: 'SCHEDULED',
      publishAt,
      companyId: 'company-emr',
    },
  })
}

describe('runScheduledPostTick', () => {
  it('publica o que venceu e avisa a empresa', async () => {
    const post = await agendado(new Date(Date.now() - 60_000))

    await runScheduledPostTick(new Date())

    const depois = await prisma.corporatePost.findUniqueOrThrow({ where: { id: post.id } })
    expect(depois.status).toBe('PUBLISHED')
    expect(notifyCorporatePostPublished).toHaveBeenCalledWith(
      expect.objectContaining({ postId: post.id }),
      'company-emr',
    )
  })

  it('atualiza createdAt para o instante da publicação real, não o do agendamento', async () => {
    const post = await agendado(new Date(Date.now() - 60_000))
    const agendadoEm = post.createdAt

    await new Promise((resolve) => setTimeout(resolve, 5))
    await runScheduledPostTick(new Date())

    const depois = await prisma.corporatePost.findUniqueOrThrow({ where: { id: post.id } })
    expect(depois.createdAt.getTime()).toBeGreaterThan(agendadoEm.getTime())
  })

  it('não toca no que ainda não chegou a hora', async () => {
    const post = await agendado(new Date(Date.now() + 60 * 60 * 1000))

    await runScheduledPostTick(new Date())

    const depois = await prisma.corporatePost.findUniqueOrThrow({ where: { id: post.id } })
    expect(depois.status).toBe('SCHEDULED')
  })

  it('não republica: o segundo tick não acha mais nada para reivindicar', async () => {
    const post = await agendado(new Date(Date.now() - 60_000))

    await runScheduledPostTick(new Date())
    vi.mocked(notifyCorporatePostPublished).mockClear()
    await runScheduledPostTick(new Date())

    expect(notifyCorporatePostPublished).not.toHaveBeenCalled()
    const depois = await prisma.corporatePost.findUniqueOrThrow({ where: { id: post.id } })
    expect(depois.status).toBe('PUBLISHED')
  })
})

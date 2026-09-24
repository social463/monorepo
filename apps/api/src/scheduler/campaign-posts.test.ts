import { describe, it, expect, vi } from 'vitest'
import { prisma } from '../lib/prisma'
import { createCampaignPost, type CampaignActor } from '../services/campaign-service'
import { runCampaignPostTick } from './campaign-posts'

vi.mock('../services/notification-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/notification-service')>()
  return {
    ...actual,
    notifyCorporatePostPublished: vi.fn().mockResolvedValue(undefined),
    notifyCorporatePostMention: vi.fn().mockResolvedValue(undefined),
  }
})

const { notifyCorporatePostPublished } = await import('../services/notification-service')

const HA_UMA_HORA = new Date(Date.now() - 60 * 60 * 1000).toISOString()
const MES_PASSADO = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
const AMANHA = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

async function ator(email: string, over: { role?: 'ADMIN' | 'LEGEND'; active?: boolean } = {}) {
  const user = await prisma.user.create({
    data: {
      name: 'G&G',
      email,
      passwordHash: 'x',
      role: over.role ?? 'ADMIN',
      active: over.active ?? true,
    },
  })
  return { id: user.id, companyId: user.companyId } satisfies CampaignActor
}

function item(quando: string, over: Partial<Parameters<typeof createCampaignPost>[1]> = {}) {
  return {
    title: 'Homenagem ao Dia do Psicólogo',
    body: 'Corpo do comunicado.',
    scheduledFor: quando,
    channel: 'MURAL' as const,
    audience: 'ALL' as const,
    ...over,
  }
}

describe('runCampaignPostTick', () => {
  it('publica no Mural o item vencido, em nome de quem agendou', async () => {
    // O que faltava: `scheduledFor` era só data de planejamento, e quem
    // agendava para as 13h30 não via nada acontecer às 13h30.
    const gg = await ator('tick-publica@empresa.com')
    const agendado = await createCampaignPost(gg, item(HA_UMA_HORA))

    await runCampaignPostTick(new Date())

    const depois = await prisma.campaignPost.findUniqueOrThrow({ where: { id: agendado.id } })
    expect(depois.status).toBe('PUBLISHED')
    expect(depois.publishedPostId).toBeTruthy()

    const post = await prisma.corporatePost.findUniqueOrThrow({
      where: { id: depois.publishedPostId as string },
    })
    expect(post.content).toBe('Corpo do comunicado.')
    expect(post.authorId).toBe(gg.id)
    expect(post.status).toBe('PUBLISHED')
  })

  it('avisa a empresa, como qualquer comunicado que vai ao ar', async () => {
    // Comunicado que sai sem sininho e sem card no Teams não é comunicado —
    // é a mesma razão pela qual o tick dos agendados do feed notifica.
    const gg = await ator('tick-avisa@empresa.com')
    const agendado = await createCampaignPost(gg, item(HA_UMA_HORA))

    await runCampaignPostTick(new Date())

    const depois = await prisma.campaignPost.findUniqueOrThrow({ where: { id: agendado.id } })
    expect(notifyCorporatePostPublished).toHaveBeenCalledWith(
      expect.objectContaining({ postId: depois.publishedPostId }),
      expect.anything(),
    )
  })

  it('não toca no que ainda não venceu', async () => {
    const gg = await ator('tick-futuro@empresa.com')
    const agendado = await createCampaignPost(gg, item(AMANHA))

    await runCampaignPostTick(new Date())

    const depois = await prisma.campaignPost.findUniqueOrThrow({ where: { id: agendado.id } })
    expect(depois.status).toBe('SCHEDULED')
    expect(await prisma.corporatePost.count()).toBe(0)
  })

  it('não publica canal de entrega manual', async () => {
    // Teams e e-mail o Legends registra, não dispara (spec, Decisão 6).
    const gg = await ator('tick-teams@empresa.com')
    const agendado = await createCampaignPost(gg, item(HA_UMA_HORA, { channel: 'TEAMS' }))

    await runCampaignPostTick(new Date())

    const depois = await prisma.campaignPost.findUniqueOrThrow({ where: { id: agendado.id } })
    expect(depois.status).toBe('SCHEDULED')
    expect(await prisma.corporatePost.count()).toBe(0)
  })

  it('não publica item cancelado', async () => {
    const gg = await ator('tick-cancelado@empresa.com')
    const agendado = await createCampaignPost(gg, item(HA_UMA_HORA))
    await prisma.campaignPost.update({ where: { id: agendado.id }, data: { status: 'CANCELLED' } })

    await runCampaignPostTick(new Date())

    const depois = await prisma.campaignPost.findUniqueOrThrow({ where: { id: agendado.id } })
    expect(depois.status).toBe('CANCELLED')
    expect(await prisma.corporatePost.count()).toBe(0)
  })

  it('deixa para o botão quando quem agendou não pode mais publicar', async () => {
    // Com autor sem permissão de publicar direto, `createPost` criaria um post
    // PENDENTE enquanto o item já teria virado PUBLICADO no calendário —
    // comunicado marcado como no ar que ninguém vê.
    const gg = await ator('tick-sem-permissao@empresa.com')
    const agendado = await createCampaignPost(gg, item(HA_UMA_HORA))
    await prisma.user.update({ where: { id: gg.id }, data: { role: 'LEGEND' } })

    await runCampaignPostTick(new Date())

    const depois = await prisma.campaignPost.findUniqueOrThrow({ where: { id: agendado.id } })
    expect(depois.status).toBe('SCHEDULED')
    expect(await prisma.corporatePost.count()).toBe(0)
  })

  it('deixa para o botão o item antigo, que não tem quem agendou', async () => {
    // Linhas anteriores à coluna `createdById` e sem campanha de onde herdar o
    // autor no backfill: o tick não tem em nome de quem publicar.
    const gg = await ator('tick-sem-autor@empresa.com')
    const agendado = await createCampaignPost(gg, item(HA_UMA_HORA))
    await prisma.campaignPost.update({ where: { id: agendado.id }, data: { createdById: null } })

    await runCampaignPostTick(new Date())

    const depois = await prisma.campaignPost.findUniqueOrThrow({ where: { id: agendado.id } })
    expect(depois.status).toBe('SCHEDULED')
    expect(await prisma.corporatePost.count()).toBe(0)
  })

  it('não despeja no Mural o que ficou para trás no calendário', async () => {
    // A publicação automática chegou depois do calendário: no dia em que ela
    // sobe, todo item de campanha antiga que ninguém publicou está vencido.
    // Sem a janela de atraso, o primeiro tick mandaria todos de uma vez.
    const gg = await ator('tick-atrasadao@empresa.com')
    const agendado = await createCampaignPost(gg, item(MES_PASSADO))

    await runCampaignPostTick(new Date())

    const depois = await prisma.campaignPost.findUniqueOrThrow({ where: { id: agendado.id } })
    expect(depois.status).toBe('SCHEDULED')
    expect(await prisma.corporatePost.count()).toBe(0)
  })

  it('publica uma vez só quando dois ticks correm juntos', async () => {
    const gg = await ator('tick-corrida@empresa.com')
    const agendado = await createCampaignPost(gg, item(HA_UMA_HORA))

    const agora = new Date()
    await Promise.all([runCampaignPostTick(agora), runCampaignPostTick(agora)])

    const depois = await prisma.campaignPost.findUniqueOrThrow({ where: { id: agendado.id } })
    expect(depois.status).toBe('PUBLISHED')
    expect(await prisma.corporatePost.count()).toBe(1)
  })
})

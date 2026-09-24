import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DEFAULT_SECTOR_ID, DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { createSector } from './sector-service'
import {
  notifyFeedbackReceived,
  notifyReaction,
  notifyBadgesEarned,
  notifyPeriodOpened,
  notifyRetroInvited,
  notifyStoreOrderStatus,
  createNotification,
  listNotifications,
  NOTIFICATION_RETENTION_DAYS,
  emojiForNotificationType,
} from './notification-service'

let counter = 0
async function makeUser(
  emailOrOpts?: string | { teamsWebhookUrl?: string | null; active?: boolean },
  over: Record<string, unknown> = {},
) {
  counter += 1
  if (typeof emailOrOpts === 'string') {
    const email = emailOrOpts
    return prisma.user.create({ data: { name: email.split('@')[0], email, passwordHash: 'x', ...over } })
  }
  const opts = emailOrOpts ?? {}
  return prisma.user.create({
    data: {
      name: `Dev ${counter}`,
      email: `dev-teams-${counter}@empresa.com`,
      passwordHash: 'x',
      active: opts.active ?? true,
      teamsWebhookUrl: opts.teamsWebhookUrl ?? null,
    },
  })
}

function fetchSpyOk() {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
}

// O envio ao Teams obedece a `TEAMS_NOTIFICATIONS_ENABLED`, e o `.env` do
// ambiente local costuma deixá-la em `false` (senão qualquer teste vira DM
// para a empresa inteira) — mesmo isolamento de `teams-client.test.ts`.
const teamsFlag = process.env.TEAMS_NOTIFICATIONS_ENABLED
beforeEach(() => {
  process.env.TEAMS_NOTIFICATIONS_ENABLED = 'true'
})
afterEach(() => {
  vi.restoreAllMocks()
  if (teamsFlag === undefined) delete process.env.TEAMS_NOTIFICATIONS_ENABLED
  else process.env.TEAMS_NOTIFICATIONS_ENABLED = teamsFlag
})

describe('notification-service write path', () => {
  it('notifyFeedbackReceived cria notificação para o alvo com link', async () => {
    const author = await makeUser('au@x.com')
    const target = await makeUser('tg@x.com')
    await notifyFeedbackReceived(
      { id: 'fb1', targetId: target.id, authorId: author.id, author: { name: 'Ana' } },
      DEFAULT_COMPANY_ID,
    )

    const rows = await prisma.notification.findMany({ where: { userId: target.id } })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      type: 'FEEDBACK_RECEIVED',
      actorId: author.id,
      link: `/perfil/${target.id}?feedback=fb1`,
    })
    expect(rows[0].title).toContain('Ana')
  })

  it('notifyReaction notifica o autor do feedback, não o reactor', async () => {
    const author = await makeUser('au2@x.com')
    const target = await makeUser('tg2@x.com')
    const reactor = await makeUser('rc2@x.com')
    await notifyReaction({ id: 'fb2', targetId: target.id, authorId: author.id }, reactor.id, 'Bia', DEFAULT_COMPANY_ID)

    const toAuthor = await prisma.notification.findMany({ where: { userId: author.id } })
    expect(toAuthor).toHaveLength(1)
    expect(toAuthor[0].type).toBe('FEEDBACK_REACTION')
    const toReactor = await prisma.notification.findMany({ where: { userId: reactor.id } })
    expect(toReactor).toHaveLength(0)
  })

  it('notifyReaction não notifica quando o reactor é o próprio autor', async () => {
    const author = await makeUser('au3@x.com')
    const target = await makeUser('tg3@x.com')
    await notifyReaction({ id: 'fb3', targetId: target.id, authorId: author.id }, author.id, 'Ana', DEFAULT_COMPANY_ID)
    expect(await prisma.notification.count({ where: { userId: author.id } })).toBe(0)
  })

  it('notifyBadgesEarned ignora o slug destaque-do-mes', async () => {
    const user = await makeUser('bd@x.com')
    const normal = await prisma.badge.create({ data: { slug: 'incansavel', name: 'Incansável', description: 'd', kind: 'IMPACT', iconKey: 'k', threshold: 1 } })
    const destaque = await prisma.badge.create({ data: { slug: 'destaque-do-mes', name: 'Destaque', description: 'd', kind: 'HIGHLIGHT', iconKey: 'k' } })
    await notifyBadgesEarned(user.id, [normal.id, destaque.id], DEFAULT_COMPANY_ID)

    const rows = await prisma.notification.findMany({ where: { userId: user.id } })
    expect(rows).toHaveLength(1)
    expect(rows[0].type).toBe('BADGE_EARNED')
    expect(rows[0].title).toContain('Incansável')
  })

  it('notifyPeriodOpened faz broadcast só para usuários ativos', async () => {
    const a = await makeUser('act@x.com', { active: true })
    const b = await makeUser('inact@x.com', { active: false })
    await notifyPeriodOpened({ monthRef: '2026-06', sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID })
    expect(await prisma.notification.count({ where: { userId: a.id } })).toBe(1)
    expect(await prisma.notification.count({ where: { userId: b.id } })).toBe(0)
    const notif = await prisma.notification.findFirst({ where: { userId: a.id } })
    expect(notif?.link).toBe('/votar')
  })

  it('notifyPeriodOpened avisa só os usuários do setor do período', async () => {
    const actor = await prisma.user.create({ data: { name: 'Admin', email: 'admin-notif-sector@x.com', passwordHash: 'x', role: 'ADMIN' } })
    const sectorB = await createSector({ name: 'Setor Notificação B', enabledFeatures: [], roles: [] }, actor.id, DEFAULT_COMPANY_ID)
    counter += 1
    const userDefault = await prisma.user.create({ data: { name: 'Do Setor Default', email: `default-${counter}@empresa.com`, passwordHash: 'x', active: true } })
    counter += 1
    const userSectorB = await prisma.user.create({ data: { name: 'Do Setor B', email: `setorb-${counter}@empresa.com`, passwordHash: 'x', active: true, sectorId: sectorB.id } })

    await notifyPeriodOpened({ monthRef: '2026-09', sectorId: sectorB.id, companyId: DEFAULT_COMPANY_ID })

    expect(await prisma.notification.count({ where: { userId: userSectorB.id, type: 'PERIOD_OPENED' } })).toBe(1)
    expect(await prisma.notification.count({ where: { userId: userDefault.id, type: 'PERIOD_OPENED' } })).toBe(0)
  })

  it('createNotification expurga notificações além da retenção', async () => {
    const user = await makeUser('old@x.com')
    const old = new Date(Date.now() - (NOTIFICATION_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000)
    await prisma.notification.create({ data: { userId: user.id, type: 'PERIOD_OPENED', title: 'antiga', createdAt: old } })
    await createNotification({ userId: user.id, type: 'PERIOD_CLOSED', title: 'nova', companyId: DEFAULT_COMPANY_ID })

    const rows = await prisma.notification.findMany({ where: { userId: user.id } })
    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe('nova')
  })

  it('listNotifications pagina corretamente quando várias notificações têm o mesmo createdAt (caso de empate)', async () => {
    const user = await makeUser('tie@x.com')
    const tiedAt = new Date('2026-06-01T00:00:00.000Z')
    const insertedIds: string[] = []
    for (let i = 0; i < 5; i++) {
      const n = await prisma.notification.create({
        data: { userId: user.id, type: 'PERIOD_OPENED', title: `notif-${i}`, createdAt: tiedAt },
      })
      insertedIds.push(n.id)
    }

    const collectedIds: string[] = []
    let cursor: string | undefined = undefined
    let pages = 0
    do {
      const result = await listNotifications(user.id, DEFAULT_COMPANY_ID, { cursor, limit: 2 })
      collectedIds.push(...result.items.map((n) => n.id))
      cursor = result.nextCursor ?? undefined
      pages++
    } while (cursor)

    expect(pages).toBe(3) // 2+2+1
    expect(collectedIds).toHaveLength(5)
    // nenhum duplicado
    expect(new Set(collectedIds).size).toBe(5)
    // todos os ids inseridos foram retornados
    expect(new Set(collectedIds)).toEqual(new Set(insertedIds))
  })

  it('notifyRetroInvited cria uma notificação RETRO_INVITED para cada convidado, menos o ator', async () => {
    const lead = await prisma.user.create({ data: { name: 'L', email: 'l@x.com', passwordHash: 'x', role: 'LEAD' } })
    const d1 = await prisma.user.create({ data: { name: 'D1', email: 'd1@x.com', passwordHash: 'x' } })
    const d2 = await prisma.user.create({ data: { name: 'D2', email: 'd2@x.com', passwordHash: 'x' } })

    await notifyRetroInvited(
      { roomId: 'room1', title: 'Retro 1', actorId: lead.id, invitedUserIds: [d1.id, d2.id, lead.id] },
      DEFAULT_COMPANY_ID,
    )

    expect(await prisma.notification.count({ where: { type: 'RETRO_INVITED' } })).toBe(2)
    const toD1 = await prisma.notification.findFirst({ where: { userId: d1.id } })
    expect(toD1?.link).toBe('/retrospectivas/room1')
  })

  it('broadcastToActive não expurga notificações antigas de usuários inativos', async () => {
    const active = await makeUser('act2@x.com', { active: true })
    const inactive = await makeUser('inact2@x.com', { active: false })
    const old = new Date(Date.now() - (NOTIFICATION_RETENTION_DAYS + 1) * 24 * 60 * 60 * 1000)
    // Cria notificação antiga para o usuário inativo
    await prisma.notification.create({ data: { userId: inactive.id, type: 'PERIOD_OPENED', title: 'antiga-inativo', createdAt: old } })
    // Cria notificação antiga para o usuário ativo (deve ser expurgada pelo broadcast)
    await prisma.notification.create({ data: { userId: active.id, type: 'PERIOD_OPENED', title: 'antiga-ativo', createdAt: old } })

    await notifyPeriodOpened({ monthRef: '2026-06', sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID })

    // Usuário ativo: notificação antiga expurgada, nova criada pelo broadcast
    const activeRows = await prisma.notification.findMany({ where: { userId: active.id } })
    expect(activeRows).toHaveLength(1)
    expect(activeRows[0].title).toContain('votação')

    // Usuário inativo: notificação antiga preservada (não recebeu broadcast)
    const inactiveRows = await prisma.notification.findMany({ where: { userId: inactive.id } })
    expect(inactiveRows).toHaveLength(1)
    expect(inactiveRows[0].title).toBe('antiga-inativo')
  })
})

describe('createNotification — espelhamento no Teams', () => {
  it('posta no Teams quando o usuário tem teamsWebhookUrl', async () => {
    const fetchSpy = fetchSpyOk()
    const u = await makeUser({ teamsWebhookUrl: 'https://flow.example/u' })

    await createNotification({ userId: u.id, type: 'FEEDBACK_RECEIVED', title: 'Oi', link: `/perfil/${u.id}`, companyId: DEFAULT_COMPANY_ID })

    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(1)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://flow.example/u')
    const body = JSON.parse(init?.body as string)
    expect(body.attachments[0].content.actions[0].url).toMatch(new RegExp(`/perfil/${u.id}$`))
  })

  it('leva os detalhes ao card do Teams sem sujar a notificação in-app', async () => {
    const fetchSpy = fetchSpyOk()
    const u = await makeUser({ teamsWebhookUrl: 'https://flow.example/u' })

    await createNotification({
      userId: u.id,
      type: 'CALENDAR_EVENT_REMINDER',
      title: 'Provas B2B: "Simulado" é daqui a 7 dias',
      link: '/calendario?dia=2026-09-10',
      teamsFacts: [{ title: 'Quando', value: 'quinta-feira, 10 de setembro de 2026' }],
      companyId: DEFAULT_COMPANY_ID,
    })

    const card = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)
    const conteudo = JSON.stringify(card.attachments[0].content.body)
    expect(conteudo).toContain('quinta-feira, 10 de setembro de 2026')
    expect(card.recipient).toBe(u.email)

    // in-app guarda só o título — o enriquecimento é exclusivo do card
    const [row] = await prisma.notification.findMany({ where: { userId: u.id } })
    expect(row.title).toBe('Provas B2B: "Simulado" é daqui a 7 dias')
  })

  it('NÃO posta no Teams quando não há teamsWebhookUrl', async () => {
    const fetchSpy = fetchSpyOk()
    const u = await makeUser({ teamsWebhookUrl: null })
    await createNotification({ userId: u.id, type: 'FEEDBACK_RECEIVED', title: 'Oi', companyId: DEFAULT_COMPANY_ID })
    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(1)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('falha no Teams não impede a gravação da notificação', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('boom'))
    const u = await makeUser({ teamsWebhookUrl: 'https://flow.example/u' })
    await expect(
      createNotification({ userId: u.id, type: 'FEEDBACK_RECEIVED', title: 'Oi', companyId: DEFAULT_COMPANY_ID }),
    ).resolves.toBeUndefined()
    expect(await prisma.notification.count({ where: { userId: u.id } })).toBe(1)
  })
})

describe('broadcastToActive — espelhamento no Teams', () => {
  it('posta no Teams só para os ativos com webhook', async () => {
    const fetchSpy = fetchSpyOk()
    const comUrl = await makeUser({ teamsWebhookUrl: 'https://flow.example/a' })
    const semUrl = await makeUser({ teamsWebhookUrl: null })

    await notifyPeriodOpened({ monthRef: '2026-06', sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID })

    // notificação in-app para ambos
    expect(await prisma.notification.count({ where: { userId: comUrl.id } })).toBe(1)
    expect(await prisma.notification.count({ where: { userId: semUrl.id } })).toBe(1)
    // Teams só para quem tem URL
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0][0]).toBe('https://flow.example/a')
  })

  it('o card do broadcast leva o emoji do tipo, igual ao dos avisos individuais', async () => {
    const fetchSpy = fetchSpyOk()
    await makeUser({ teamsWebhookUrl: 'https://flow.example/a' })

    await notifyPeriodOpened({ monthRef: '2026-06', sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID })

    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)
    const [colunaEmoji] = body.attachments[0].content.body[0].items[0].columns
    expect(colunaEmoji.items[0].text).toBe(emojiForNotificationType('PERIOD_OPENED'))
  })
})

describe('notifyStoreOrderStatus', () => {
  it('avisa que o pedido foi aprovado', async () => {
    const user = await prisma.user.create({
      data: { name: 'Pessoa', email: `n-${Math.random()}@x.com`, passwordHash: 'x', role: 'LEGEND' },
    })
    await notifyStoreOrderStatus(
      { id: 'o1', userId: user.id, productTitle: 'Fone', pricePaid: 100 },
      'APPROVED',
      user.id,
      DEFAULT_COMPANY_ID,
    )

    const notif = await prisma.notification.findFirst({ where: { userId: user.id } })
    expect(notif?.type).toBe('STORE_ORDER_APPROVED')
    expect(notif?.title).toBe('Seu resgate de "Fone" foi aprovado')
    expect(notif?.link).toBe('/loja?tab=pedidos')
  })

  // O cancelamento é o aviso mais importante: os coins voltaram.
  it('avisa o cancelamento dizendo quantos coins voltaram', async () => {
    const user = await prisma.user.create({
      data: { name: 'Pessoa', email: `n-${Math.random()}@x.com`, passwordHash: 'x', role: 'LEGEND' },
    })
    await notifyStoreOrderStatus(
      { id: 'o2', userId: user.id, productTitle: 'Fone', pricePaid: 100 },
      'CANCELLED',
      user.id,
      DEFAULT_COMPANY_ID,
    )

    const notif = await prisma.notification.findFirst({ where: { userId: user.id } })
    expect(notif?.type).toBe('STORE_ORDER_CANCELLED')
    expect(notif?.title).toBe('Seu resgate de "Fone" foi cancelado — 100 coins devolvidos')
  })
})

describe('emojiForNotificationType', () => {
  it('mapeia tipos conhecidos e cai no sino por padrão', () => {
    expect(emojiForNotificationType('REVIEW_MENTION')).toBe('@')
    expect(emojiForNotificationType('REVIEW_COMMENT')).toBe('💬')
    expect(emojiForNotificationType('REVIEW_REACTION')).toBe('❤️')
    expect(emojiForNotificationType('BADGE_EARNED')).toBe('🏅')
    expect(emojiForNotificationType('PERIOD_OPENED')).toBe('📣')
    expect(emojiForNotificationType('FEEDBACK_RECEIVED')).toBe('📝')
    // tipo fora do mapa cai no sino:
    expect(emojiForNotificationType('UNKNOWN_TYPE' as never)).toBe('🔔')
  })
})

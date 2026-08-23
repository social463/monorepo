import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import {
  postTeamsNudge,
  buildStreakAtRiskCard,
  buildNotificationCard,
  isTeamsRenderableLogo,
  postTeamsNotification,
  type TeamsNudgePayload,
} from './teams-client'

const payload: TeamsNudgePayload = {
  event: 'streak_at_risk',
  name: 'Fulano',
  streakDays: 7,
  ctaUrl: 'https://legends.eumedicoresidente.com.br/login',
}

/**
 * O envio obedece a `TEAMS_NOTIFICATIONS_ENABLED`, e o `.env` do ambiente local
 * costuma deixá-la em `false` (senão qualquer teste do feed vira DM para a
 * empresa inteira). Os casos abaixo ligam a chave de propósito — o caso do
 * desligado tem teste próprio.
 */
const teamsFlag = process.env.TEAMS_NOTIFICATIONS_ENABLED
beforeEach(() => {
  process.env.TEAMS_NOTIFICATIONS_ENABLED = 'true'
})
afterEach(() => {
  vi.restoreAllMocks()
  if (teamsFlag === undefined) delete process.env.TEAMS_NOTIFICATIONS_ENABLED
  else process.env.TEAMS_NOTIFICATIONS_ENABLED = teamsFlag
})

describe('chave geral de envio', () => {
  it('não faz POST nenhum com TEAMS_NOTIFICATIONS_ENABLED=false', async () => {
    process.env.TEAMS_NOTIFICATIONS_ENABLED = 'false'
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    await postTeamsNudge('https://flow.example/x', payload)
    await postTeamsNotification('https://flow.example/x', { title: 'Oi', ctaUrl: 'https://x.test/', ctaLabel: 'Abrir' })

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('buildStreakAtRiskCard', () => {
  it('monta o envelope de Adaptive Card com o CTA apontando para ctaUrl', () => {
    const card = buildStreakAtRiskCard(payload) as any
    expect(card.type).toBe('message')
    const content = card.attachments[0].content
    expect(card.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive')
    expect(content.type).toBe('AdaptiveCard')
    expect(content.actions[0]).toMatchObject({ type: 'Action.OpenUrl', url: payload.ctaUrl })
    // nome e ofensiva aparecem no corpo do card
    const bodyText = JSON.stringify(content.body)
    expect(bodyText).toContain('Fulano')
    expect(bodyText).toContain('7 dias')
  })

  it('singulariza "dia" quando a ofensiva é de 1 dia', () => {
    const card = buildStreakAtRiskCard({ ...payload, streakDays: 1 }) as any
    expect(JSON.stringify(card.attachments[0].content.body)).toContain('1 dia')
  })

  it('leva o destinatário no topo do envelope quando o chamador manda', () => {
    const card = buildStreakAtRiskCard({ ...payload, recipient: 'fulano@empresa.com' }) as any
    expect(card.recipient).toBe('fulano@empresa.com')
    expect('recipient' in (buildStreakAtRiskCard(payload) as any)).toBe(false)
  })

  it('escapa caracteres que quebram markdown de link no nome', () => {
    const card = buildStreakAtRiskCard({ ...payload, name: 'Fula]no)' }) as any
    const bodyText = JSON.stringify(card.attachments[0].content.body)
    expect(bodyText).not.toContain('Fula]no)')
    expect(bodyText).toContain('Fula］no）')
  })
})

describe('postTeamsNudge', () => {
  it('faz POST do Adaptive Card no corpo', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }))
    await postTeamsNudge('https://flow.example/x', payload)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toBe('https://flow.example/x')
    expect(init?.method).toBe('POST')
    const body = JSON.parse(init?.body as string)
    expect(body.type).toBe('message')
    expect(body.attachments[0].content.actions[0].url).toBe(payload.ctaUrl)
  })

  it('engole erro de rede sem lançar', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('boom'))
    await expect(postTeamsNudge('https://flow.example/x', payload)).resolves.toBeUndefined()
  })

  it('engole status não-2xx sem lançar', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 500 }))
    await expect(postTeamsNudge('https://flow.example/x', payload)).resolves.toBeUndefined()
  })
})

function findTextBlocks(card: unknown): { text: string; weight?: string }[] {
  // navega no Adaptive Card e coleta os TextBlocks (incl. dentro de Containers e ColumnSets)
  const content = (card as any).attachments[0].content
  const blocks: { text: string; weight?: string }[] = []
  const walk = (items: any[]) => {
    for (const it of items) {
      if (it.type === 'TextBlock') blocks.push({ text: it.text, weight: it.weight })
      if (it.type === 'Container' || it.type === 'Column') walk(it.items)
      if (it.type === 'ColumnSet') walk(it.columns)
    }
  }
  walk(content.body)
  return blocks
}

describe('buildNotificationCard', () => {
  it('monta o Adaptive Card com o título e o botão de CTA', () => {
    const card = buildNotificationCard({
      title: 'Fulano deixou um feedback pra você',
      ctaUrl: 'https://exemplo.test/perfil/1',
      ctaLabel: 'Abrir no Legends',
    }) as any
    expect(card.type).toBe('message')
    const content = card.attachments[0].content
    expect(content.type).toBe('AdaptiveCard')
    expect(JSON.stringify(content.body)).toContain('Fulano deixou um feedback')
    expect(content.actions[0]).toMatchObject({
      type: 'Action.OpenUrl',
      title: 'Abrir no Legends',
      url: 'https://exemplo.test/perfil/1',
    })
  })

  it('escapa caracteres que quebram markdown de link no título', () => {
    const card = buildNotificationCard({
      title: 'tens]te)',
      ctaUrl: 'https://exemplo.test/',
      ctaLabel: 'Abrir',
    }) as any
    const text = JSON.stringify(card.attachments[0].content.body)
    expect(text).not.toContain('tens]te)')
    expect(text).toContain('tens］te）')
  })

  it('põe o emoji ao lado da manchete em negrito e mantém o botão', () => {
    const card = buildNotificationCard({
      title: 'Bea te marcou numa resenha',
      ctaUrl: 'https://x/y',
      ctaLabel: 'Abrir no Legends',
      emoji: '@',
    })
    const blocks = findTextBlocks(card)
    const header = blocks.find((b) => b.weight === 'Bolder')
    expect(header?.text).toBe('Bea te marcou numa resenha')
    expect(blocks.some((b) => b.text === '@')).toBe(true)
    const actions = (card as any).attachments[0].content.actions
    expect(actions[0]).toMatchObject({ title: 'Abrir no Legends', url: 'https://x/y' })
  })

  it('cai no sino quando o chamador não manda emoji', () => {
    const card = buildNotificationCard({ title: 'T', ctaUrl: 'u', ctaLabel: 'c' })
    expect(findTextBlocks(card).some((b) => b.text === '🔔')).toBe(true)
  })

  it('renderiza o corpo quando presente e o omite quando ausente', () => {
    const withBody = buildNotificationCard({ title: 'T', ctaUrl: 'u', ctaLabel: 'c', body: 'detalhe' })
    expect(findTextBlocks(withBody).some((b) => b.text === 'detalhe')).toBe(true)
    const noBody = buildNotificationCard({ title: 'T', ctaUrl: 'u', ctaLabel: 'c' })
    // emoji + manchete + assinatura do rodapé, sem corpo
    expect(findTextBlocks(noBody).map((b) => b.text)).toEqual(['🔔', 'T', 'Legends'])
  })

  it('usa o verde do tema na faixa e assina com o logo do Legends', () => {
    const card = buildNotificationCard({ title: 'T', ctaUrl: 'u', ctaLabel: 'c' }) as any
    const [header] = card.attachments[0].content.body
    expect(header.style).toBe('good')
    const imagens: any[] = []
    const walk = (items: any[]) => {
      for (const it of items) {
        if (it.type === 'Image') imagens.push(it)
        if (it.type === 'Container' || it.type === 'Column') walk(it.items)
        if (it.type === 'ColumnSet') walk(it.columns)
      }
    }
    walk(card.attachments[0].content.body)
    // URL absoluta: o Teams busca a imagem da internet pública, não do app.
    expect(imagens[0].url).toMatch(/^https?:\/\/.+\/illustration\/logo-mark\.png$/)
  })

  it('assina com a logo da empresa quando ela é um formato que o Teams desenha', () => {
    const card = buildNotificationCard({
      title: 'T',
      ctaUrl: 'u',
      ctaLabel: 'c',
      brand: { appName: 'Portal EMR', logoUrl: 'https://cdn.test/marca.png' },
    }) as any
    expect(JSON.stringify(card.attachments[0].content.body)).toContain('https://cdn.test/marca.png')
    expect(findTextBlocks(card).some((b) => b.text === 'Portal EMR')).toBe(true)
  })

  it('troca a logo em SVG pela arte do produto — o Teams não rasteriza SVG no card', () => {
    const card = buildNotificationCard({
      title: 'T',
      ctaUrl: 'u',
      ctaLabel: 'c',
      brand: { appName: 'Portal EMR', logoUrl: 'https://cdn.test/marca.svg' },
    }) as any
    const body = JSON.stringify(card.attachments[0].content.body)
    expect(body).not.toContain('marca.svg')
    expect(body).toMatch(/\/illustration\/logo-mark\.png/)
    // o nome continua sendo o da empresa; só a arte é que cai no produto
    expect(findTextBlocks(card).some((b) => b.text === 'Portal EMR')).toBe(true)
  })

  it('fixa a largura da coluna do logo, para imagem que falhe não espremer o nome', () => {
    const card = buildNotificationCard({ title: 'T', ctaUrl: 'u', ctaLabel: 'c' }) as any
    const rodape = card.attachments[0].content.body.at(-1)
    expect(rodape.type).toBe('ColumnSet')
    expect(rodape.columns[0].width).toBe('20px')
  })

  it('leva o destinatário no topo do envelope, e omite o campo quando não há', () => {
    const comDestino = buildNotificationCard({
      title: 'T',
      ctaUrl: 'u',
      ctaLabel: 'c',
      recipient: 'fulano@empresa.com',
    }) as any
    expect(comDestino.recipient).toBe('fulano@empresa.com')
    // Fluxo de canal não tem pessoa: o campo não pode virar null no JSON.
    const semDestino = buildNotificationCard({ title: 'T', ctaUrl: 'u', ctaLabel: 'c' }) as any
    expect('recipient' in semDestino).toBe(false)
  })

  it('renderiza os detalhes como FactSet e o omite quando a lista é vazia', () => {
    const comFacts = buildNotificationCard({
      title: 'T',
      ctaUrl: 'u',
      ctaLabel: 'c',
      facts: [{ title: 'Quando', value: 'quarta-feira, 10 de setembro de 2026' }],
    }) as any
    const factSet = comFacts.attachments[0].content.body.find((b: any) => b.type === 'FactSet')
    expect(factSet.facts).toEqual([{ title: 'Quando', value: 'quarta-feira, 10 de setembro de 2026' }])
    const semFacts = buildNotificationCard({ title: 'T', ctaUrl: 'u', ctaLabel: 'c', facts: [] }) as any
    expect(semFacts.attachments[0].content.body.some((b: any) => b.type === 'FactSet')).toBe(false)
  })
})

describe('isTeamsRenderableLogo', () => {
  it('aceita só raster em URL absoluta http(s)', () => {
    expect(isTeamsRenderableLogo('https://cdn.test/a.png')).toBe(true)
    expect(isTeamsRenderableLogo('http://cdn.test/a.JPG')).toBe(true)
    expect(isTeamsRenderableLogo('https://cdn.test/a.jpeg?v=2')).toBe(true)
    expect(isTeamsRenderableLogo('https://cdn.test/a.gif')).toBe(true)
  })

  it('recusa SVG, WebP, caminho relativo, data URI e vazio', () => {
    expect(isTeamsRenderableLogo('https://cdn.test/a.svg')).toBe(false)
    expect(isTeamsRenderableLogo('https://cdn.test/a.webp')).toBe(false)
    expect(isTeamsRenderableLogo('/illustration/logo-mark.png')).toBe(false)
    expect(isTeamsRenderableLogo('data:image/png;base64,AAAA')).toBe(false)
    expect(isTeamsRenderableLogo('https://cdn.test/sem-extensao')).toBe(false)
    expect(isTeamsRenderableLogo(null)).toBe(false)
    expect(isTeamsRenderableLogo(undefined)).toBe(false)
  })
})

describe('postTeamsNotification', () => {
  it('faz POST do card genérico no corpo', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 200 }))
    await postTeamsNotification('https://flow.example/x', {
      title: 'Oi',
      ctaUrl: 'https://exemplo.test/',
      ctaLabel: 'Abrir',
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const body = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)
    expect(body.attachments[0].content.actions[0].url).toBe('https://exemplo.test/')
  })

  it('engole erro de rede sem lançar', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('boom'))
    await expect(
      postTeamsNotification('https://flow.example/x', {
        title: 'Oi',
        ctaUrl: 'https://exemplo.test/',
        ctaLabel: 'Abrir',
      }),
    ).resolves.toBeUndefined()
  })
})

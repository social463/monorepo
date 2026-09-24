import { describe, expect, it, vi } from 'vitest'
import type { ConfirmCampaignRequest, GenerateCampaignRequest } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { CampaignError } from '../lib/campaign-error'
import { AgentError } from '../lib/agent-error'
import { encryptSecret } from '../lib/crypto'
import { AI_SETTING_KEYS } from './ai-settings-service'
import * as muralService from './corporate-mural-service'
import {
  cancelCampaignPost,
  confirmCampaign,
  createCampaignPost,
  deleteCampaignPost,
  generateCampaignPreview,
  listCampaignBands,
  listCampaignPosts,
  publishCampaignPost,
  updateCampaignPost,
  type CampaignActor,
} from './campaign-service'

// `publishCampaignPost` importa `createPost` como named import — `vi.spyOn`
// num objeto de namespace não intercepta essa chamada (ver o mesmo comentário
// em `challenge-submission-service.test.ts`). `vi.mock` funciona porque troca
// o módulo inteiro no registro, antes de qualquer import ser resolvido — por
// padrão encaminha para a implementação real (`importOriginal`); só o teste de
// rollback abaixo troca o comportamento uma única vez, para sabotar o instante
// exato entre o `createPost` ter sucesso e o `campaignPost.update` seguinte,
// sem mudar nada na assinatura de produção.
vi.mock('./corporate-mural-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./corporate-mural-service')>()
  return { ...actual, createPost: vi.fn(actual.createPost) }
})

async function criarAtor(email = 'gg@empresa.com'): Promise<CampaignActor> {
  const user = await prisma.user.create({
    data: { name: 'G&G', email, passwordHash: 'x', role: 'ADMIN' },
  })
  return { id: user.id, companyId: user.companyId }
}

async function cadastrarChave(companyId: string) {
  await prisma.appSetting.create({
    data: { key: AI_SETTING_KEYS.apiKey, companyId, value: encryptSecret('chave-fake') },
  })
}

const pedido: GenerateCampaignRequest = {
  theme: 'Semana da segurança',
  startsAt: '2026-09-01T03:00:00.000Z',
  endsAt: '2026-09-10T03:00:00.000Z',
  audience: 'ALL',
  channel: 'MURAL',
  quantity: 2,
}

const respostaIA = JSON.stringify([
  { title: 'Abertura', body: 'Começa a semana da segurança.', visualHint: 'Capacete' },
  { title: 'Encerramento', body: 'Obrigado a todos.', visualHint: null },
])

describe('preview de campanha', () => {
  it('devolve a quantidade pedida, toda dentro da janela', async () => {
    const ator = await criarAtor()
    await cadastrarChave(ator.companyId)
    const complete = vi.fn().mockResolvedValue(respostaIA)

    const drafts = await generateCampaignPreview(ator, pedido, complete)

    expect(drafts).toHaveLength(2)
    for (const d of drafts) {
      expect(new Date(d.scheduledFor).getTime()).toBeGreaterThanOrEqual(new Date(pedido.startsAt).getTime())
      expect(new Date(d.scheduledFor).getTime()).toBeLessThanOrEqual(
        new Date('2026-09-11T00:00:00.000Z').getTime(),
      )
    }
  })

  it('não grava nada no banco', async () => {
    const ator = await criarAtor()
    await cadastrarChave(ator.companyId)

    await generateCampaignPreview(ator, pedido, vi.fn().mockResolvedValue(respostaIA))

    expect(await prisma.campaign.count()).toBe(0)
    expect(await prisma.campaignPost.count()).toBe(0)
  })

  it('recusa janela invertida antes de chamar a IA', async () => {
    const ator = await criarAtor()
    await cadastrarChave(ator.companyId)
    const complete = vi.fn()

    await expect(
      generateCampaignPreview(ator, { ...pedido, startsAt: pedido.endsAt, endsAt: pedido.startsAt }, complete),
    ).rejects.toThrow(CampaignError)
    expect(complete).not.toHaveBeenCalled()
  })

  it('responde 503 quando a empresa não cadastrou chave', async () => {
    const ator = await criarAtor()
    await expect(generateCampaignPreview(ator, pedido, vi.fn())).rejects.toMatchObject({ status: 503 })
  })

  it('não grava nada quando a IA devolve JSON inválido', async () => {
    const ator = await criarAtor()
    await cadastrarChave(ator.companyId)

    await expect(
      generateCampaignPreview(ator, pedido, vi.fn().mockResolvedValue('não consigo ajudar')),
    ).rejects.toThrow(CampaignError)
    expect(await prisma.campaignPost.count()).toBe(0)
  })
})

const confirmacao: ConfirmCampaignRequest = {
  theme: 'Semana da segurança',
  startsAt: '2026-09-01T03:00:00.000Z',
  endsAt: '2026-09-10T03:00:00.000Z',
  audience: 'ALL',
  posts: [
    {
      title: 'Abertura',
      body: 'Texto EDITADO pelo usuário antes de confirmar.',
      visualHint: 'Capacete',
      scheduledFor: '2026-09-01T12:00:00.000Z',
      channel: 'MURAL',
    },
    {
      title: 'Encerramento',
      body: 'Obrigado a todos.',
      visualHint: null,
      scheduledFor: '2026-09-03T12:00:00.000Z',
      channel: 'MURAL',
    },
  ],
}

describe('confirmar campanha', () => {
  it('cria exatamente N itens preservando o texto editado', async () => {
    const ator = await criarAtor('confirma@empresa.com')

    const criados = await confirmCampaign(ator, confirmacao)

    expect(criados).toHaveLength(2)
    expect(criados[0].body).toBe('Texto EDITADO pelo usuário antes de confirmar.')
    expect(criados[0].status).toBe('SCHEDULED')
    expect(await prisma.campaign.count()).toBe(1)
    expect(await prisma.campaignPost.count()).toBe(2)
  })

  it('grava auditoria da confirmação', async () => {
    const ator = await criarAtor('auditoria@empresa.com')
    await confirmCampaign(ator, confirmacao)
    const logs = await prisma.adminAuditLog.findMany({ where: { entityType: 'Campaign' } })
    expect(logs).toHaveLength(1)
    expect(logs[0].action).toBe('CREATE')
  })

  it('recusa janela invertida', async () => {
    const ator = await criarAtor('invertida@empresa.com')
    await expect(
      confirmCampaign(ator, { ...confirmacao, startsAt: confirmacao.endsAt, endsAt: confirmacao.startsAt }),
    ).rejects.toThrow(CampaignError)
  })

  it('recusa lista vazia', async () => {
    const ator = await criarAtor('vazia@empresa.com')
    await expect(confirmCampaign(ator, { ...confirmacao, posts: [] })).rejects.toThrow(CampaignError)
  })
})

describe('calendário', () => {
  it('lista só os itens da janela pedida, em ordem de data', async () => {
    const ator = await criarAtor('lista@empresa.com')
    await confirmCampaign(ator, confirmacao)

    const setembro = await listCampaignPosts(ator, {
      from: new Date('2026-09-01T00:00:00.000Z'),
      to: new Date('2026-09-30T23:59:59.000Z'),
    })
    expect(setembro).toHaveLength(2)
    expect(setembro[0].scheduledFor.getTime()).toBeLessThan(setembro[1].scheduledFor.getTime())

    const outubro = await listCampaignPosts(ator, {
      from: new Date('2026-10-01T00:00:00.000Z'),
      to: new Date('2026-10-31T23:59:59.000Z'),
    })
    expect(outubro).toHaveLength(0)
  })

  // A faixa da campanha na grade do mês. O filtro é de SOBREPOSIÇÃO, e não de
  // "começa dentro da janela": a campanha que atravessa a virada do mês é
  // justamente o caso que a faixa contínua existe para mostrar.
  it('devolve a campanha que atravessa a janela, não só a que começa nela', async () => {
    const ator = await criarAtor('faixa@empresa.com')
    await confirmCampaign(ator, confirmacao) // 01/09 → 10/09

    // Janela que começa DEPOIS do início da campanha e termina antes do fim.
    const meioDaCampanha = await listCampaignBands(ator, {
      from: new Date('2026-09-05T00:00:00.000Z'),
      to: new Date('2026-09-07T23:59:59.000Z'),
    })
    expect(meioDaCampanha).toHaveLength(1)
    expect(meioDaCampanha[0].theme).toBe('Semana da segurança')

    // Janela que encosta na ponta inicial.
    const bordaInicial = await listCampaignBands(ator, {
      from: new Date('2026-08-20T00:00:00.000Z'),
      to: new Date('2026-09-01T12:00:00.000Z'),
    })
    expect(bordaInicial).toHaveLength(1)

    // Mês inteiro depois do fim: nada.
    const outubro = await listCampaignBands(ator, {
      from: new Date('2026-10-01T00:00:00.000Z'),
      to: new Date('2026-10-31T23:59:59.000Z'),
    })
    expect(outubro).toHaveLength(0)
  })

  it('cria item na mão, sem campanha', async () => {
    const ator = await criarAtor('mao@empresa.com')

    const item = await createCampaignPost(ator, {
      title: 'Aviso de manutenção',
      body: 'O sistema ficará indisponível no sábado.',
      scheduledFor: '2026-09-05T12:00:00.000Z',
      channel: 'MURAL',
      audience: 'ALL',
    })

    expect(item.campaignId).toBeNull()
    expect(item.status).toBe('SCHEDULED')
    expect(await prisma.campaign.count()).toBe(0)
  })
})

describe('responsável do item', () => {
  it('cria item na mão com responsável válido', async () => {
    const ator = await criarAtor('resp-valido@empresa.com')
    const responsavel = await prisma.user.create({
      data: { name: 'Responsável', email: 'responsavel-valido@empresa.com', passwordHash: 'x', role: 'LEGEND' },
    })

    const item = await createCampaignPost(ator, {
      title: 'Aviso',
      body: 'Corpo do aviso.',
      scheduledFor: '2026-09-05T12:00:00.000Z',
      channel: 'MURAL',
      audience: 'ALL',
      responsibleId: responsavel.id,
    })

    expect(item.responsible).toMatchObject({ id: responsavel.id, name: 'Responsável' })
  })

  it('recusa responsável inexistente em createCampaignPost, e nada é gravado', async () => {
    const ator = await criarAtor('resp-inexistente@empresa.com')

    await expect(
      createCampaignPost(ator, {
        title: 'Aviso',
        body: 'Corpo do aviso.',
        scheduledFor: '2026-09-05T12:00:00.000Z',
        channel: 'MURAL',
        audience: 'ALL',
        responsibleId: 'nao-existe',
      }),
    ).rejects.toMatchObject({ status: 404 })
    expect(await prisma.campaignPost.count()).toBe(0)
  })

  it('recusa responsável de outra empresa em createCampaignPost, e nada é gravado', async () => {
    const ator = await criarAtor('resp-outra-empresa@empresa.com')
    const outraEmpresa = await prisma.company.create({
      data: { name: 'Outra Empresa', slug: `outra-empresa-${Date.now()}` },
    })
    const usuarioDeFora = await prisma.user.create({
      data: {
        name: 'De Fora',
        email: 'defora@outraempresa.com',
        passwordHash: 'x',
        role: 'LEGEND',
        companyId: outraEmpresa.id,
      },
    })

    await expect(
      createCampaignPost(ator, {
        title: 'Aviso',
        body: 'Corpo do aviso.',
        scheduledFor: '2026-09-05T12:00:00.000Z',
        channel: 'MURAL',
        audience: 'ALL',
        responsibleId: usuarioDeFora.id,
      }),
    ).rejects.toMatchObject({ status: 404 })
    expect(await prisma.campaignPost.count()).toBe(0)
  })

  it('recusa confirmCampaign quando um post no meio da lista tem responsável inválido, e desfaz tudo (campanha, itens e auditoria)', async () => {
    const ator = await criarAtor('resp-confirm@empresa.com')
    const responsavel = await prisma.user.create({
      data: { name: 'Responsável', email: 'responsavel-confirm@empresa.com', passwordHash: 'x', role: 'LEGEND' },
    })

    await expect(
      confirmCampaign(ator, {
        ...confirmacao,
        posts: [
          { ...confirmacao.posts[0], responsibleId: responsavel.id },
          { ...confirmacao.posts[1], responsibleId: 'nao-existe' },
        ],
      }),
    ).rejects.toMatchObject({ status: 404 })

    // Prova a atomicidade: o primeiro post (com responsável válido) e a
    // campanha já tinham sido gravados dentro da transação quando o segundo
    // post falhou — nada disso pode sobreviver, nem a auditoria.
    expect(await prisma.campaign.count()).toBe(0)
    expect(await prisma.campaignPost.count()).toBe(0)
    expect(await prisma.adminAuditLog.count({ where: { entityType: 'Campaign' } })).toBe(0)
  })
})

async function itemAgendado(ator: CampaignActor) {
  return createCampaignPost(ator, {
    title: 'Aviso',
    body: 'Corpo do comunicado.',
    scheduledFor: '2026-09-05T12:00:00.000Z',
    channel: 'MURAL',
    audience: 'ALL',
  })
}

describe('editar item', () => {
  it('reagenda e troca o texto', async () => {
    const ator = await criarAtor('edita@empresa.com')
    const item = await itemAgendado(ator)

    const editado = await updateCampaignPost(ator, item.id, {
      body: 'Corpo novo.',
      scheduledFor: '2026-09-08T12:00:00.000Z',
    })

    expect(editado.body).toBe('Corpo novo.')
    expect(editado.scheduledFor.toISOString()).toBe('2026-09-08T12:00:00.000Z')
  })

  it('404 para item de outra empresa', async () => {
    const ator = await criarAtor('dono@empresa.com')
    const item = await itemAgendado(ator)
    // Escopo de outra empresa: `scopedPrisma` não acha a linha, e o service
    // devolve 404 em vez de 403 — não se confirma nem a existência.
    const intruso: CampaignActor = { id: ator.id, companyId: 'company-inexistente' }

    await expect(updateCampaignPost(intruso, item.id, { body: 'x' })).rejects.toMatchObject({ status: 404 })
  })

  it('recusa responsável de outra empresa, e nada é gravado', async () => {
    const ator = await criarAtor('edita-resp@empresa.com')
    const item = await itemAgendado(ator)
    const outraEmpresa = await prisma.company.create({
      data: { name: 'Outra Empresa (edição)', slug: `outra-empresa-edicao-${Date.now()}` },
    })
    const usuarioDeFora = await prisma.user.create({
      data: {
        name: 'De Fora',
        email: 'defora-edicao@outraempresa.com',
        passwordHash: 'x',
        role: 'LEGEND',
        companyId: outraEmpresa.id,
      },
    })

    await expect(
      updateCampaignPost(ator, item.id, { responsibleId: usuarioDeFora.id }),
    ).rejects.toMatchObject({ status: 404 })
    const inalterado = await prisma.campaignPost.findUniqueOrThrow({ where: { id: item.id } })
    expect(inalterado.responsibleId).toBeNull()
  })
})

describe('publicar item', () => {
  it('cria o post no mural e liga publishedPostId', async () => {
    const ator = await criarAtor('publica@empresa.com')
    const item = await itemAgendado(ator)

    const publicado = await publishCampaignPost(ator, item.id)

    expect(publicado.status).toBe('PUBLISHED')
    expect(publicado.publishedPostId).toBeTruthy()
    expect(publicado.publishedAt).not.toBeNull()

    const posts = await prisma.corporatePost.findMany()
    expect(posts).toHaveLength(1)
    expect(posts[0].content).toBe('Corpo do comunicado.')
    expect(posts[0].id).toBe(publicado.publishedPostId)
  })

  // O comunicado nasce de um modelo de linguagem e traz marcação. Publicado como
  // texto puro, `**precisão**` chegava ao Feed com os asteriscos à mostra — foi
  // por isso que o prompt proibia markdown e o comunicado saía chapado.
  it('publica o corpo como documento rico, com o negrito preservado', async () => {
    const ator = await criarAtor('rico@empresa.com')
    const item = await createCampaignPost(ator, {
      title: 'Dia do Contador',
      body: '## Por que isso importa\n\nGarante a **precisão** dos números.\n\n- Agradeça ao time',
      scheduledFor: '2026-09-05T12:00:00.000Z',
      channel: 'MURAL',
      audience: 'ALL',
    })

    const publicado = await publishCampaignPost(ator, item.id)
    const post = await prisma.corporatePost.findUniqueOrThrow({
      where: { id: publicado.publishedPostId as string },
    })

    expect(post.contentJson).toEqual({
      blocks: [
        { type: 'heading', spans: [{ text: 'Por que isso importa' }] },
        {
          type: 'paragraph',
          spans: [{ text: 'Garante a ' }, { text: 'precisão', bold: true }, { text: ' dos números.' }],
        },
        { type: 'bullet', spans: [{ text: 'Agradeça ao time' }] },
      ],
    })
    // O texto puro do card e das prévias sai do documento, já sem os asteriscos.
    expect(post.content).toContain('Garante a precisão dos números.')
    expect(post.content).not.toContain('**')
  })

  // O título deixou de ser rótulo interno da grade: a fórmula do comunicado abre
  // por ele, e escondê-lo gastava a linha de maior impacto num campo invisível.
  it('leva o título do item para o título do post', async () => {
    const ator = await criarAtor('titulo@empresa.com')
    const item = await itemAgendado(ator)

    const publicado = await publishCampaignPost(ator, item.id)
    const post = await prisma.corporatePost.findUniqueOrThrow({
      where: { id: publicado.publishedPostId as string },
    })

    expect(post.title).toBe('Aviso')
  })

  it('leva a arte do item para a imagem do comunicado no Mural', async () => {
    // A "sugestão visual" é briefing em texto e continua sendo só isso; a arte
    // é a peça pronta, e é ela que precisa chegar no feed.
    vi.stubEnv('S3_BUCKET', 'legends-teste')
    vi.stubEnv('S3_REGION', 'us-east-1')
    vi.stubEnv('S3_PUBLIC_BASE_URL', 'https://cdn.exemplo.com')

    const ator = await criarAtor('arte@empresa.com')
    const item = await createCampaignPost(ator, {
      title: 'Aviso',
      body: 'Corpo do comunicado.',
      visualHint: 'Imagem do MKT.',
      image: { url: 'https://cdn.exemplo.com/images/arte.png', width: 1200, height: 630 },
      scheduledFor: '2026-09-05T12:00:00.000Z',
      channel: 'MURAL',
      audience: 'ALL',
    })
    expect(item.imageUrl).toBe('https://cdn.exemplo.com/images/arte.png')
    expect(item.visualHint).toBe('Imagem do MKT.')

    const publicado = await publishCampaignPost(ator, item.id)
    const post = await prisma.corporatePost.findUniqueOrThrow({
      where: { id: publicado.publishedPostId as string },
    })
    expect(post.imageUrl).toBe('https://cdn.exemplo.com/images/arte.png')
    expect(post.imageWidth).toBe(1200)
    expect(post.imageHeight).toBe(630)

    vi.unstubAllEnvs()
  })

  it('recusa arte hospedada fora do bucket configurado', async () => {
    // Quem valida o host é o `assertImageHost` do mural, na publicação — não
    // há segunda cópia da regra no calendário.
    vi.stubEnv('S3_BUCKET', 'legends-teste')
    vi.stubEnv('S3_REGION', 'us-east-1')
    vi.stubEnv('S3_PUBLIC_BASE_URL', 'https://cdn.exemplo.com')

    const ator = await criarAtor('arte-de-fora@empresa.com')
    const item = await createCampaignPost(ator, {
      title: 'Aviso',
      body: 'Corpo do comunicado.',
      image: { url: 'https://site-qualquer.com/arte.png', width: 100, height: 100 },
      scheduledFor: '2026-09-05T12:00:00.000Z',
      channel: 'MURAL',
      audience: 'ALL',
    })

    await expect(publishCampaignPost(ator, item.id)).rejects.toMatchObject({ status: 400 })
    const inalterado = await prisma.campaignPost.findUniqueOrThrow({ where: { id: item.id } })
    expect(inalterado.status).toBe('SCHEDULED')
    expect(await prisma.corporatePost.count()).toBe(0)

    vi.unstubAllEnvs()
  })

  it('remover a arte zera as três colunas juntas', async () => {
    // Largura e altura órfãs apontariam para uma URL que não existe mais.
    const ator = await criarAtor('arte-removida@empresa.com')
    const item = await createCampaignPost(ator, {
      title: 'Aviso',
      body: 'Corpo do comunicado.',
      image: { url: 'https://cdn.exemplo.com/images/arte.png', width: 10, height: 20 },
      scheduledFor: '2026-09-05T12:00:00.000Z',
      channel: 'MURAL',
      audience: 'ALL',
    })

    const semArte = await updateCampaignPost(ator, item.id, { image: null })
    expect(semArte.imageUrl).toBeNull()
    expect(semArte.imageWidth).toBeNull()
    expect(semArte.imageHeight).toBeNull()
  })

  it('não mexe na arte quando a edição não fala dela', async () => {
    const ator = await criarAtor('arte-preservada@empresa.com')
    const item = await createCampaignPost(ator, {
      title: 'Aviso',
      body: 'Corpo do comunicado.',
      image: { url: 'https://cdn.exemplo.com/images/arte.png', width: 10, height: 20 },
      scheduledFor: '2026-09-05T12:00:00.000Z',
      channel: 'MURAL',
      audience: 'ALL',
    })

    const editado = await updateCampaignPost(ator, item.id, { body: 'Corpo novo.' })
    expect(editado.imageUrl).toBe('https://cdn.exemplo.com/images/arte.png')
  })

  it('guarda quem agendou, que é quem a publicação automática usa como autor', async () => {
    const ator = await criarAtor('quem-agendou@empresa.com')
    const item = await itemAgendado(ator)
    expect(item.createdById).toBe(ator.id)
  })

  it('recusa publicar duas vezes', async () => {
    const ator = await criarAtor('duasvezes@empresa.com')
    const item = await itemAgendado(ator)
    await publishCampaignPost(ator, item.id)

    await expect(publishCampaignPost(ator, item.id)).rejects.toMatchObject({ status: 409 })
    expect(await prisma.corporatePost.count()).toBe(1)
  })

  it('duas publicações concorrentes no mesmo item resultam em um único post e um 409', async () => {
    // Corrida real: dois clientes chamando `publishCampaignPost` ao mesmo
    // tempo sobre o mesmo item (duplo clique, duas abas, retry de request
    // lenta). O guard antigo lia `status` FORA da transação — os dois liam
    // SCHEDULED e os dois criavam um CorporatePost. O `updateMany` condicional
    // dentro da transação é quem precisa serializar isso: só um consegue
    // reivindicar a linha, o outro recebe count 0 e vira 409 antes de chegar
    // perto do `createPost`.
    const ator = await criarAtor('concorrencia@empresa.com')
    const item = await itemAgendado(ator)

    const resultados = await Promise.allSettled([
      publishCampaignPost(ator, item.id),
      publishCampaignPost(ator, item.id),
    ])

    const sucessos = resultados.filter((r) => r.status === 'fulfilled')
    const falhas = resultados.filter((r): r is PromiseRejectedResult => r.status === 'rejected')

    expect(sucessos).toHaveLength(1)
    expect(falhas).toHaveLength(1)
    expect(falhas[0].reason).toMatchObject({ status: 409 })

    // A prova que importa: nunca dois posts no mural para o mesmo item.
    expect(await prisma.corporatePost.count()).toBe(1)
    const final = await prisma.campaignPost.findUniqueOrThrow({ where: { id: item.id } })
    expect(final.status).toBe('PUBLISHED')
    expect(final.publishedPostId).toBeTruthy()
  })

  it('desfaz o post do mural se a transação falhar depois do createPost ter sucesso', async () => {
    const ator = await criarAtor('rollback-tx@empresa.com')
    const item = await itemAgendado(ator)

    // Deixa o `createPost` real acontecer (grava o post de verdade dentro da
    // transação) e, ANTES de devolver, apaga a linha do `campaignPost` usando
    // o mesmo `tx` que `publishCampaignPost` vai usar em seguida para marcar o
    // item como publicado. O `where: { id }` daquele update deixa de casar
    // (a linha já não existe dentro da própria transação), o Prisma lança
    // P2025, e é isso que prova a atomicidade: se o post nascesse fora da
    // transação (ou numa `$transaction` independente), essa sabotagem não
    // teria como desfazê-lo, e `corporatePost.count()` continuaria 1.
    const { createPost: publicarDeVerdade } = await vi.importActual<typeof import('./corporate-mural-service')>(
      './corporate-mural-service',
    )
    // Guarda contra o modo de falha que este teste já teve: o mock instalado,
    // mas o service ligado ao módulo REAL por causa de um ciclo de imports
    // (`corporate-mural-service` → `lib/serialize` → `campaign-service`). Sem
    // isto, o teste passa a publicar de verdade e a sabotagem nunca roda — que
    // é exatamente como ele começou a falhar, sem ninguém tocar nele.
    const chamadasAntes = vi.mocked(muralService.createPost).mock.calls.length
    vi.mocked(muralService.createPost).mockImplementationOnce(async (input) => {
      const post = await publicarDeVerdade(input)
      await input.tx!.campaignPost.delete({ where: { id: item.id } })
      return post
    })

    await expect(publishCampaignPost(ator, item.id)).rejects.toThrow()
    expect(vi.mocked(muralService.createPost).mock.calls.length).toBe(chamadasAntes + 1)

    expect(await prisma.corporatePost.count()).toBe(0)
    const inalterado = await prisma.campaignPost.findUniqueOrThrow({ where: { id: item.id } })
    expect(inalterado.status).toBe('SCHEDULED')
    expect(inalterado.publishedPostId).toBeNull()
  })
})

describe('excluir item', () => {
  it('apaga a linha, ao contrário do cancelamento', async () => {
    const ator = await criarAtor('exclui@empresa.com')
    const item = await itemAgendado(ator)

    await deleteCampaignPost(ator, item.id)

    expect(await prisma.campaignPost.findUnique({ where: { id: item.id } })).toBeNull()
  })

  it('exclui também o que já foi cancelado', async () => {
    // É o caso que motivou a ação: o cancelado fica riscado na grade e não sai
    // de lá.
    const ator = await criarAtor('exclui-cancelado@empresa.com')
    const item = await itemAgendado(ator)
    await cancelCampaignPost(ator, item.id)

    await deleteCampaignPost(ator, item.id)

    expect(await prisma.campaignPost.findUnique({ where: { id: item.id } })).toBeNull()
  })

  it('recusa excluir item já publicado', async () => {
    // O comunicado está no Mural: apagar só o item perderia o registro
    // editorial de algo que a empresa inteira viu.
    const ator = await criarAtor('exclui-publicado@empresa.com')
    const item = await itemAgendado(ator)
    await publishCampaignPost(ator, item.id)

    await expect(deleteCampaignPost(ator, item.id)).rejects.toMatchObject({ status: 409 })
    expect(await prisma.campaignPost.findUnique({ where: { id: item.id } })).not.toBeNull()
  })

  it('não deixa excluir item de outra empresa', async () => {
    const ator = await criarAtor('exclui-tenant@empresa.com')
    const item = await itemAgendado(ator)
    const outraEmpresa = await prisma.company.create({
      data: { name: 'Outra', slug: `outra-${Math.random()}` },
    })

    await expect(
      deleteCampaignPost({ id: ator.id, companyId: outraEmpresa.id }, item.id),
    ).rejects.toMatchObject({ status: 404 })
    expect(await prisma.campaignPost.findUnique({ where: { id: item.id } })).not.toBeNull()
  })

  it('registra a exclusão na auditoria', async () => {
    const ator = await criarAtor('exclui-auditoria@empresa.com')
    const item = await itemAgendado(ator)

    await deleteCampaignPost(ator, item.id)

    const log = await prisma.adminAuditLog.findFirst({
      where: { entityType: 'CampaignPost', entityId: item.id, action: 'DELETE' },
    })
    expect(log).not.toBeNull()
  })
})

describe('cancelar item', () => {
  it('marca como cancelado sem criar post', async () => {
    const ator = await criarAtor('cancela@empresa.com')
    const item = await itemAgendado(ator)

    const cancelado = await cancelCampaignPost(ator, item.id)

    expect(cancelado.status).toBe('CANCELLED')
    expect(await prisma.corporatePost.count()).toBe(0)
    // Cancelar não apaga: o histórico editorial continua no calendário.
    expect(await prisma.campaignPost.count()).toBe(1)
  })

  it('recusa cancelar item já publicado', async () => {
    const ator = await criarAtor('jápublicado@empresa.com')
    const item = await itemAgendado(ator)
    await publishCampaignPost(ator, item.id)

    await expect(cancelCampaignPost(ator, item.id)).rejects.toMatchObject({ status: 409 })
  })
})

const JANELA_SETEMBRO = { from: new Date('2026-09-01T00:00:00.000Z'), to: new Date('2026-09-30T23:59:59.999Z') }

/**
 * Documento 4, seção 13.2: apagado o comunicado, o item continuava no
 * calendário editorial — `PUBLISHED` com `publishedPostId` nulo, apontando
 * para um post que não existe mais.
 */
describe('comunicado apagado sai do calendário de campanhas', () => {
  it('apagar o post do mural leva junto o item que o publicou', async () => {
    const ator = await criarAtor('gg-delete@empresa.com')
    const item = await createCampaignPost(ator, {
      title: 'Aviso de manutenção',
      body: 'O sistema ficará indisponível no sábado.',
      scheduledFor: '2026-09-05T12:00:00.000Z',
      channel: 'MURAL',
      audience: 'ALL',
    })
    const publicado = await publishCampaignPost(ator, item.id)
    expect(publicado.publishedPostId).not.toBeNull()

    await muralService.deletePost({
      postId: publicado.publishedPostId as string,
      userId: ator.id,
      role: 'ADMIN',
      companyId: ator.companyId,
    })

    expect(await listCampaignPosts(ator, JANELA_SETEMBRO)).toHaveLength(0)
  })

  it('os outros itens da campanha ficam — cai só o que publicou aquele post', async () => {
    const ator = await criarAtor('gg-delete-2@empresa.com')
    const publicado = await publishCampaignPost(
      ator,
      (
        await createCampaignPost(ator, {
          title: 'Sai agora',
          body: 'Corpo.',
          scheduledFor: '2026-09-05T12:00:00.000Z',
          channel: 'MURAL',
          audience: 'ALL',
        })
      ).id,
    )
    const outro = await createCampaignPost(ator, {
      title: 'Fica',
      body: 'Corpo.',
      scheduledFor: '2026-09-06T12:00:00.000Z',
      channel: 'MURAL',
      audience: 'ALL',
    })

    await muralService.deletePost({
      postId: publicado.publishedPostId as string,
      userId: ator.id,
      role: 'ADMIN',
      companyId: ator.companyId,
    })

    const restantes = await listCampaignPosts(ator, JANELA_SETEMBRO)
    expect(restantes.map((entry) => entry.id)).toEqual([outro.id])
  })
})

import { describe, it, expect } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

async function makeUser(
  app: ReturnType<typeof buildApp>,
  role: string,
  features: string[] = ['cultura', 'gente-gestao'],
) {
  const user = await prisma.user.create({
    data: {
      name: role.toLowerCase(),
      email: `${role.toLowerCase()}-${Math.random()}@empresa.com`,
      passwordHash: 'x',
      role: role as never,
      sectorId: 'sector-dev-produto',
    },
  })
  const token = app.jwt.sign({
    sub: user.id,
    role,
    sectorId: 'sector-dev-produto',
    companyId: 'company-emr',
    // `cultura` = leitura do colaborador; `gente-gestao` = gestão de TODA a
    // Cultura (manifesto, manuais e benefícios), que é área de G&G.
    features,
  })
  return { user, token }
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` }
}

describe('admin — manifesto', () => {
  it('admin cria e depois atualiza a página, com auditoria em ambos', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')

    const created = await app.inject({
      method: 'PUT',
      url: '/admin/culture/pages/manifesto',
      headers: auth(admin.token),
      payload: { title: 'Manifesto cultural', subtitle: 'EMR', body: '## Por que existimos', published: true },
    })
    expect(created.statusCode).toBe(200)
    expect(created.json().page.published).toBe(true)

    const updated = await app.inject({
      method: 'PUT',
      url: '/admin/culture/pages/manifesto',
      headers: auth(admin.token),
      payload: { title: 'Manifesto cultural', body: '## Nova versão', published: true },
    })
    expect(updated.statusCode).toBe(200)
    expect(updated.json().page.body).toBe('## Nova versão')
    expect(updated.json().page.subtitle).toBeNull()

    // Uma única página por slug: o PUT é upsert, não cria duplicata.
    expect(await prisma.culturePage.count({ where: { slug: 'manifesto' } })).toBe(1)

    const logs = await prisma.adminAuditLog.findMany({ where: { entityType: 'CulturePage' } })
    expect(logs.map((l) => l.action).sort()).toEqual(['CREATE', 'UPDATE'])
    await app.close()
  })

  it('admin lê o rascunho pela rota de admin', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')
    await prisma.culturePage.create({
      data: { slug: 'manifesto', title: 'Rascunho', body: 'texto', published: false },
    })

    const res = await app.inject({
      method: 'GET',
      url: '/admin/culture/pages/manifesto',
      headers: auth(admin.token),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().page.title).toBe('Rascunho')
    await app.close()
  })

  it('página nunca escrita devolve null (não 404)', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')
    const res = await app.inject({
      method: 'GET',
      url: '/admin/culture/pages/manifesto',
      headers: auth(admin.token),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().page).toBeNull()
    await app.close()
  })

  it('subadmin de G&G edita o manifesto; de outro setor, 403', async () => {
    const app = buildApp()
    await app.ready()
    const gg = await makeUser(app, 'SUBADMIN')
    const outro = await makeUser(app, 'SUBADMIN', ['cultura'])

    const editar = (token: string) =>
      app.inject({
        method: 'PUT',
        url: '/admin/culture/pages/manifesto',
        headers: auth(token),
        payload: { title: 'x', body: 'y' },
      })

    expect((await editar(gg.token)).statusCode).toBe(200)
    // Ter `cultura` (leitura do colaborador) não dá direito de editar.
    expect((await editar(outro.token)).statusCode).toBe(403)
    await app.close()
  })

  it('lenda não edita o manifesto (403)', async () => {
    const app = buildApp()
    await app.ready()
    const lenda = await makeUser(app, 'LEGEND')
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/culture/pages/manifesto',
      headers: auth(lenda.token),
      payload: { title: 'x', body: 'y' },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('corpo vazio é rejeitado (400)', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')
    const res = await app.inject({
      method: 'PUT',
      url: '/admin/culture/pages/manifesto',
      headers: auth(admin.token),
      payload: { title: 'Manifesto', body: '' },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
})

describe('admin — manuais', () => {
  it('subadmin cria, edita, reordena e exclui manual', async () => {
    const app = buildApp()
    await app.ready()
    const sub = await makeUser(app, 'SUBADMIN')

    const created = await app.inject({
      method: 'POST',
      url: '/admin/culture/manuals',
      headers: auth(sub.token),
      payload: {
        title: 'Código de Ética',
        description: 'Princípios e valores',
        referenceLabel: 'Atualizado em junho/2024',
        fileKey: 'manuals/company-emr/etica.pdf',
        fileName: 'etica.pdf',
        fileSize: 1024,
      },
    })
    expect(created.statusCode).toBe(201)
    const first = created.json().manual
    expect(first.order).toBe(0)
    expect(first.downloadPath).toBe(`/culture/manuals/${first.id}/download`)

    const second = await app.inject({
      method: 'POST',
      url: '/admin/culture/manuals',
      headers: auth(sub.token),
      payload: { title: 'Política de Bonificação', description: 'Regras e metas' },
    })
    expect(second.json().manual.order).toBe(1)

    const patched = await app.inject({
      method: 'PATCH',
      url: `/admin/culture/manuals/${first.id}`,
      headers: auth(sub.token),
      payload: { description: 'Nova descrição', published: false },
    })
    expect(patched.statusCode).toBe(200)
    expect(patched.json().manual.description).toBe('Nova descrição')
    expect(patched.json().manual.published).toBe(false)

    const reordered = await app.inject({
      method: 'POST',
      url: '/admin/culture/manuals/reorder',
      headers: auth(sub.token),
      payload: { ids: [second.json().manual.id, first.id] },
    })
    expect(reordered.statusCode).toBe(200)
    expect(reordered.json().manuals.map((m: { title: string }) => m.title)).toEqual([
      'Política de Bonificação',
      'Código de Ética',
    ])

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/admin/culture/manuals/${first.id}`,
      headers: auth(sub.token),
    })
    expect(deleted.statusCode).toBe(204)
    expect(await prisma.cultureManual.count()).toBe(1)

    const logs = await prisma.adminAuditLog.findMany({ where: { entityType: 'CultureManual' } })
    expect(logs.map((l) => l.action).sort()).toEqual(['CREATE', 'CREATE', 'DELETE', 'UPDATE'])
    await app.close()
  })

  it('admin vê rascunho na listagem de admin', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')
    await prisma.cultureManual.create({ data: { title: 'Rascunho', description: 'x', published: false } })

    const res = await app.inject({ method: 'GET', url: '/admin/culture/manuals', headers: auth(admin.token) })
    expect(res.json().manuals).toHaveLength(1)
    await app.close()
  })

  it('lenda não gerencia manuais (403)', async () => {
    const app = buildApp()
    await app.ready()
    const lenda = await makeUser(app, 'LEGEND')
    const res = await app.inject({
      method: 'POST',
      url: '/admin/culture/manuals',
      headers: auth(lenda.token),
      payload: { title: 'x', description: 'y' },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('manual de outra empresa não é editável (404)', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')
    const alheio = await prisma.cultureManual.create({
      data: { title: 'Alheio', description: 'x', companyId: 'company-legends-internal' },
    })
    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/culture/manuals/${alheio.id}`,
      headers: auth(admin.token),
      payload: { title: 'invadido' },
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('reorder com id desconhecido é rejeitado (400)', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')
    const manual = await prisma.cultureManual.create({ data: { title: 'A', description: 'a' } })
    const res = await app.inject({
      method: 'POST',
      url: '/admin/culture/manuals/reorder',
      headers: auth(admin.token),
      payload: { ids: [manual.id, 'nao-existe'] },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })
})

describe('admin — benefícios', () => {
  it('admin cria, edita, reordena e exclui benefício', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')

    const created = await app.inject({
      method: 'POST',
      url: '/admin/culture/benefits',
      headers: auth(admin.token),
      payload: { title: 'CVV — 188', summary: 'Apoio emocional 24h', icon: 'favorite', body: '## Sobre o CVV' },
    })
    expect(created.statusCode).toBe(201)
    const first = created.json().benefit

    const second = await app.inject({
      method: 'POST',
      url: '/admin/culture/benefits',
      headers: auth(admin.token),
      payload: { title: 'Wellhub', summary: 'Academias', body: '## Sobre o Wellhub' },
    })
    expect(second.json().benefit.order).toBe(1)

    const patched = await app.inject({
      method: 'PATCH',
      url: `/admin/culture/benefits/${first.id}`,
      headers: auth(admin.token),
      payload: { summary: 'Novo resumo' },
    })
    expect(patched.json().benefit.summary).toBe('Novo resumo')

    const reordered = await app.inject({
      method: 'POST',
      url: '/admin/culture/benefits/reorder',
      headers: auth(admin.token),
      payload: { ids: [second.json().benefit.id, first.id] },
    })
    expect(reordered.json().benefits.map((b: { title: string }) => b.title)).toEqual(['Wellhub', 'CVV — 188'])

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/admin/culture/benefits/${first.id}`,
      headers: auth(admin.token),
    })
    expect(deleted.statusCode).toBe(204)

    const logs = await prisma.adminAuditLog.findMany({ where: { entityType: 'CultureBenefit' } })
    expect(logs).toHaveLength(4)
    await app.close()
  })

  it('subadmin de G&G gerencia benefícios; de outro setor, 403', async () => {
    const app = buildApp()
    await app.ready()
    const gg = await makeUser(app, 'SUBADMIN')
    const outro = await makeUser(app, 'SUBADMIN', ['cultura'])

    const criar = (token: string) =>
      app.inject({
        method: 'POST',
        url: '/admin/culture/benefits',
        headers: auth(token),
        payload: { title: 'x', summary: 'y', body: 'z' },
      })

    expect((await criar(gg.token)).statusCode).toBe(201)
    expect((await criar(outro.token)).statusCode).toBe(403)
    await app.close()
  })
})

describe('admin — kit visual', () => {
  const KEY = 'visual-assets/company-emr/peca.png'

  async function criar(
    app: ReturnType<typeof buildApp>,
    token: string,
    over: Record<string, unknown> = {},
  ) {
    return app.inject({
      method: 'POST',
      url: '/admin/culture/visual-assets',
      headers: auth(token),
      payload: {
        title: 'Banner para LinkedIn',
        description: '1584 × 396 px — pronto para o seu perfil.',
        storageKey: KEY,
        fileName: 'EMR-Banner-LinkedIn.png',
        ...over,
      },
    })
  }

  it('G&G cria a peça e o colaborador comum a vê publicada', async () => {
    const app = buildApp()
    await app.ready()
    const gg = await makeUser(app, 'SUBADMIN')
    // Sem `gente-gestao`, e sem nem a feature `cultura`: o kit é identidade da
    // empresa, lido por qualquer pessoa logada.
    const lenda = await makeUser(app, 'LEGEND', [])

    const criada = await criar(app, gg.token)
    expect(criada.statusCode).toBe(201)
    expect(criada.json().asset.fit).toBe('COVER')

    const lista = await app.inject({
      method: 'GET',
      url: '/culture/visual-assets',
      headers: auth(lenda.token),
    })
    expect(lista.statusCode).toBe(200)
    expect(lista.json().assets).toHaveLength(1)
    expect(lista.json().assets[0].title).toBe('Banner para LinkedIn')
    // A chave do S3 não vaza no DTO — só a URL derivada dela.
    expect(JSON.stringify(lista.json())).not.toContain('storageKey')

    await app.close()
  })

  it('peça despublicada some da leitura do colaborador, mas fica para o admin', async () => {
    const app = buildApp()
    await app.ready()
    const gg = await makeUser(app, 'SUBADMIN')
    const lenda = await makeUser(app, 'LEGEND', [])

    await criar(app, gg.token, { published: false })

    const doColaborador = await app.inject({
      method: 'GET',
      url: '/culture/visual-assets',
      headers: auth(lenda.token),
    })
    expect(doColaborador.json().assets).toHaveLength(0)

    const doAdmin = await app.inject({
      method: 'GET',
      url: '/admin/culture/visual-assets',
      headers: auth(gg.token),
    })
    expect(doAdmin.json().assets).toHaveLength(1)

    await app.close()
  })

  /**
   * A chave nasce no presign, que já namespaceia por empresa. Sem esta recusa,
   * um POST direto apontaria a peça para o objeto de outro tenant.
   */
  it('recusa chave que não é do prefixo da própria empresa', async () => {
    const app = buildApp()
    await app.ready()
    const gg = await makeUser(app, 'SUBADMIN')

    const res = await criar(app, gg.token, { storageKey: 'visual-assets/outra-empresa/peca.png' })

    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('colaborador comum não cria, não edita e não apaga peça', async () => {
    const app = buildApp()
    await app.ready()
    const gg = await makeUser(app, 'SUBADMIN')
    const lenda = await makeUser(app, 'LEGEND', ['cultura'])
    const id = (await criar(app, gg.token)).json().asset.id as string

    expect((await criar(app, lenda.token)).statusCode).toBe(403)
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/admin/culture/visual-assets/${id}`,
          headers: auth(lenda.token),
          payload: { title: 'invadido' },
        })
      ).statusCode,
    ).toBe(403)
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/admin/culture/visual-assets/${id}`,
          headers: auth(lenda.token),
        })
      ).statusCode,
    ).toBe(403)

    await app.close()
  })

  it('editar sem mandar imagem nova preserva o arquivo publicado', async () => {
    const app = buildApp()
    await app.ready()
    const gg = await makeUser(app, 'SUBADMIN')
    const id = (await criar(app, gg.token)).json().asset.id as string

    const res = await app.inject({
      method: 'PATCH',
      url: `/admin/culture/visual-assets/${id}`,
      headers: auth(gg.token),
      payload: { title: 'Banner novo', fit: 'CONTAIN' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().asset.title).toBe('Banner novo')
    expect(res.json().asset.fit).toBe('CONTAIN')
    const salva = await prisma.cultureVisualAsset.findUniqueOrThrow({ where: { id } })
    expect(salva.storageKey).toBe(KEY)

    await app.close()
  })

  it('reordenar troca a posição e a leitura sai na ordem nova', async () => {
    const app = buildApp()
    await app.ready()
    const gg = await makeUser(app, 'SUBADMIN')
    const lenda = await makeUser(app, 'LEGEND', [])
    const primeira = (await criar(app, gg.token, { title: 'Primeira' })).json().asset.id as string
    const segunda = (await criar(app, gg.token, { title: 'Segunda' })).json().asset.id as string

    const res = await app.inject({
      method: 'POST',
      url: '/admin/culture/visual-assets/reorder',
      headers: auth(gg.token),
      payload: { ids: [segunda, primeira] },
    })
    expect(res.statusCode).toBe(200)

    const lista = await app.inject({
      method: 'GET',
      url: '/culture/visual-assets',
      headers: auth(lenda.token),
    })
    expect(lista.json().assets.map((a: { title: string }) => a.title)).toEqual(['Segunda', 'Primeira'])

    await app.close()
  })

  it('kit-visual é slug válido de página, e o texto publicado chega ao colaborador', async () => {
    const app = buildApp()
    await app.ready()
    const gg = await makeUser(app, 'SUBADMIN')
    const lenda = await makeUser(app, 'LEGEND', [])

    const salvo = await app.inject({
      method: 'PUT',
      url: '/admin/culture/pages/kit-visual',
      headers: auth(gg.token),
      payload: { title: 'Kit visual', body: '## Como usar\n\nNunca distorça o logo.', published: true },
    })
    expect(salvo.statusCode).toBe(200)

    const lido = await app.inject({
      method: 'GET',
      url: '/culture/pages/kit-visual',
      headers: auth(lenda.token),
    })
    expect(lido.statusCode).toBe(200)
    expect(lido.json().page.body).toContain('Nunca distorça o logo.')

    await app.close()
  })
})

describe('admin — material pessoal do kit', () => {
  async function comDestinatario(app: ReturnType<typeof buildApp>) {
    const gg = await makeUser(app, 'SUBADMIN')
    const dono = await makeUser(app, 'LEGEND', [])
    const outro = await makeUser(app, 'LEGEND', [])
    const key = `personal-assets/company-emr/${dono.user.id}/foto.jpg`
    return { gg, dono, outro, key }
  }

  async function enviar(
    app: ReturnType<typeof buildApp>,
    token: string,
    recipientId: string,
    key: string,
    over: Record<string, unknown> = {},
  ) {
    return app.inject({
      method: 'POST',
      url: '/admin/culture/personal-assets',
      headers: auth(token),
      payload: {
        recipientId,
        title: 'Suas fotos do ensaio',
        storageKey: key,
        fileName: 'ensaio.jpg',
        kind: 'IMAGE',
        ...over,
      },
    })
  }

  it('o destinatário vê o material dele — e mais ninguém vê', async () => {
    const app = buildApp()
    await app.ready()
    const { gg, dono, outro, key } = await comDestinatario(app)

    expect((await enviar(app, gg.token, dono.user.id, key)).statusCode).toBe(201)

    const doDono = await app.inject({
      method: 'GET',
      url: '/culture/personal-assets',
      headers: auth(dono.token),
    })
    expect(doDono.json().assets).toHaveLength(1)
    expect(doDono.json().assets[0].title).toBe('Suas fotos do ensaio')
    // O campo `storageKey` não existe no DTO: o que sai é link assinado, que
    // expira. Uma URL durável para o objeto nunca é serializada — é a diferença
    // para a peça global, cujo `imageUrl` vale para sempre.
    expect(doDono.json().assets[0]).not.toHaveProperty('storageKey')

    const doOutro = await app.inject({
      method: 'GET',
      url: '/culture/personal-assets',
      headers: auth(outro.token),
    })
    expect(doOutro.json().assets).toHaveLength(0)

    await app.close()
  })

  /**
   * 404 e não 403: a existência de um material dirigido a alguém já é
   * informação sobre essa pessoa.
   */
  it('colega não baixa o material de outro, e a resposta não confirma que ele existe', async () => {
    const app = buildApp()
    await app.ready()
    const { gg, dono, outro, key } = await comDestinatario(app)
    const id = (await enviar(app, gg.token, dono.user.id, key)).json().asset.id as string

    const res = await app.inject({
      method: 'GET',
      url: `/culture/personal-assets/${id}/download`,
      headers: auth(outro.token),
    })

    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('quem administra Cultura também abre o material', async () => {
    const app = buildApp()
    await app.ready()
    const { gg, dono, key } = await comDestinatario(app)
    const id = (await enviar(app, gg.token, dono.user.id, key)).json().asset.id as string

    const res = await app.inject({
      method: 'GET',
      url: `/culture/personal-assets/${id}/download`,
      headers: auth(gg.token),
    })

    // Sem S3 no ambiente de teste a rota responde 503 — o que importa aqui é que
    // ela NÃO respondeu 404, ou seja, a autorização deixou passar.
    expect(res.statusCode).not.toBe(404)
    await app.close()
  })

  it('recusa chave emitida para outra pessoa', async () => {
    const app = buildApp()
    await app.ready()
    const { gg, dono, outro } = await comDestinatario(app)
    // Chave da pasta do `outro`, mas material anexado ao `dono`.
    const keyDoOutro = `personal-assets/company-emr/${outro.user.id}/foto.jpg`

    const res = await enviar(app, gg.token, dono.user.id, keyDoOutro)

    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('colaborador comum não envia nem apaga material', async () => {
    const app = buildApp()
    await app.ready()
    const { gg, dono, key } = await comDestinatario(app)
    const id = (await enviar(app, gg.token, dono.user.id, key)).json().asset.id as string

    expect((await enviar(app, dono.token, dono.user.id, key)).statusCode).toBe(403)
    // Nem o próprio dono apaga o que recebeu: a entrega é de quem publica.
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/admin/culture/personal-assets/${id}`,
          headers: auth(dono.token),
        })
      ).statusCode,
    ).toBe(403)
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/admin/culture/personal-assets',
          headers: auth(dono.token),
        })
      ).statusCode,
    ).toBe(403)

    await app.close()
  })

  it('a lista da administração filtra por pessoa e traz o destinatário', async () => {
    const app = buildApp()
    await app.ready()
    const { gg, dono, outro, key } = await comDestinatario(app)
    await enviar(app, gg.token, dono.user.id, key)
    await enviar(app, gg.token, outro.user.id, `personal-assets/company-emr/${outro.user.id}/x.jpg`, {
      title: 'Material do outro',
    })

    const todos = await app.inject({
      method: 'GET',
      url: '/admin/culture/personal-assets',
      headers: auth(gg.token),
    })
    expect(todos.json().assets).toHaveLength(2)
    expect(todos.json().assets[0].recipient.name).toBeTruthy()

    const filtrado = await app.inject({
      method: 'GET',
      url: `/admin/culture/personal-assets?userId=${dono.user.id}`,
      headers: auth(gg.token),
    })
    expect(filtrado.json().assets).toHaveLength(1)
    expect(filtrado.json().assets[0].title).toBe('Suas fotos do ensaio')

    await app.close()
  })

  it('excluir tira o material da lista do destinatário', async () => {
    const app = buildApp()
    await app.ready()
    const { gg, dono, key } = await comDestinatario(app)
    const id = (await enviar(app, gg.token, dono.user.id, key)).json().asset.id as string

    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/admin/culture/personal-assets/${id}`,
          headers: auth(gg.token),
        })
      ).statusCode,
    ).toBe(204)

    const doDono = await app.inject({
      method: 'GET',
      url: '/culture/personal-assets',
      headers: auth(dono.token),
    })
    expect(doDono.json().assets).toHaveLength(0)

    await app.close()
  })
})

/**
 * Os materiais da chegada: os MESMOS materiais pessoais, com a janela dos 90
 * dias decidida no servidor. O que se testa aqui é a janela — a lista já é
 * coberta acima.
 */
describe('materiais da chegada no perfil', () => {
  async function comAdmissao(app: ReturnType<typeof buildApp>, diasAtras: number) {
    const gg = await makeUser(app, 'SUBADMIN')
    const dono = await makeUser(app, 'LEGEND', [])
    await prisma.user.update({
      where: { id: dono.user.id },
      data: { joinedAt: new Date(Date.now() - diasAtras * 86_400_000) },
    })
    const key = `personal-assets/company-emr/${dono.user.id}/plano.pdf`
    const enviado = await app.inject({
      method: 'POST',
      url: '/admin/culture/personal-assets',
      headers: auth(gg.token),
      payload: {
        recipientId: dono.user.id,
        title: 'Plano de 90 dias',
        storageKey: key,
        fileName: 'plano-90-dias.pdf',
        kind: 'DOCUMENT',
      },
    })
    expect(enviado.statusCode).toBe(201)
    return { gg, dono }
  }

  it('quem chegou há 10 dias recebe o material e os dias que faltam', async () => {
    const app = buildApp()
    await app.ready()
    const { dono } = await comAdmissao(app, 10)

    const res = await app.inject({
      method: 'GET',
      url: '/culture/onboarding-kit',
      headers: auth(dono.token),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().active).toBe(true)
    expect(res.json().daysLeft).toBe(80)
    expect(res.json().assets.map((a: { title: string }) => a.title)).toEqual(['Plano de 90 dias'])

    await app.close()
  })

  /**
   * Passados os 90 dias a lista vem VAZIA, e não só `active: false`: material
   * de uma pessoa não trafega para uma tela que não vai desenhá-lo. Ele
   * continua em `/culture/personal-assets`, que é onde mora para sempre.
   */
  it('passados os 90 dias a janela fecha, e a lista nem é carregada', async () => {
    const app = buildApp()
    await app.ready()
    const { dono } = await comAdmissao(app, 91)

    const res = await app.inject({
      method: 'GET',
      url: '/culture/onboarding-kit',
      headers: auth(dono.token),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ active: false, endsAt: null, daysLeft: 0, assets: [] })

    const naAba = await app.inject({
      method: 'GET',
      url: '/culture/personal-assets',
      headers: auth(dono.token),
    })
    expect(naAba.json().assets).toHaveLength(1)

    await app.close()
  })

  it('o recorte é o token: o kit de um colega não é alcançável', async () => {
    const app = buildApp()
    await app.ready()
    const { dono } = await comAdmissao(app, 5)
    const colega = await makeUser(app, 'LEGEND', [])

    const res = await app.inject({
      method: 'GET',
      // Não há parâmetro de pessoa na rota — o que sobra é tentar por query,
      // que é ignorada.
      url: `/culture/onboarding-kit?userId=${dono.user.id}`,
      headers: auth(colega.token),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().assets).toHaveLength(0)

    await app.close()
  })
})

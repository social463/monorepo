import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import {
  createPost,
  createComment,
  getPostReach,
  listPostReactors,
  markPostRead,
  togglePostReaction,
  type CorporateMuralViewer,
} from './corporate-mural-service'

const SECTOR = 'sector-dev-produto'

// Atenção: `User.sectorId` é `String` com default (NÃO é nullable) — usuário de
// outra empresa precisa de um setor daquela empresa, não de `null`.
async function makeUser(email: string, role = 'LEGEND', sectorId = SECTOR, companyId = DEFAULT_COMPANY_ID) {
  return prisma.user.create({
    data: { name: email.split('@')[0], email, passwordHash: 'x', role: role as never, sectorId, companyId },
  })
}

/** Viewer a partir de um usuário do banco — é o que o service recebe da rota. */
function viewerOf(user: { id: string; role: string; sectorId: string; companyId: string }): CorporateMuralViewer {
  return { userId: user.id, role: user.role, sectorId: user.sectorId, companyId: user.companyId }
}

describe('getPostReach', () => {
  it('conta leitores únicos, comentários e reações', async () => {
    const autor = await makeUser('autor-alcance@empresa.com', 'ADMIN')
    const a = await makeUser('leitor-a@empresa.com')
    const b = await makeUser('leitor-b@empresa.com')
    const post = await createPost({ authorId: autor.id, content: 'comunicado importante', companyId: DEFAULT_COMPANY_ID })

    await markPostRead({ postId: post.id, viewer: viewerOf(a) })
    await markPostRead({ postId: post.id, viewer: viewerOf(a) })
    await markPostRead({ postId: post.id, viewer: viewerOf(b) })
    await createComment({ postId: post.id, content: 'boa', viewer: viewerOf(a) })
    await togglePostReaction({ postId: post.id, emoji: '🎉', viewer: viewerOf(a) })
    await togglePostReaction({ postId: post.id, emoji: '🎉', viewer: viewerOf(b) })

    const reach = await getPostReach(DEFAULT_COMPANY_ID, { sort: 'date_desc', page: 1, pageSize: 20 })

    expect(reach.items).toHaveLength(1)
    expect(reach.items[0]).toMatchObject({ postId: post.id, readers: 2, comments: 1, reactions: 2 })
    expect(reach.total).toBe(1)
  })

  it('usa a base de ativos não-terceirizados no readPct', async () => {
    const autor = await makeUser('autor-pct@empresa.com', 'ADMIN')
    const leitor = await makeUser('leitor-pct@empresa.com')
    await makeUser('inativo-pct@empresa.com')
    await prisma.user.update({ where: { email: 'inativo-pct@empresa.com' }, data: { active: false } })
    await makeUser('terceiro-pct@empresa.com', 'THIRD_PARTY')
    const post = await createPost({ authorId: autor.id, content: 'aviso', companyId: DEFAULT_COMPANY_ID })
    await markPostRead({ postId: post.id, viewer: viewerOf(leitor) })

    const reach = await getPostReach(DEFAULT_COMPANY_ID, { sort: 'date_desc', page: 1, pageSize: 20 })

    // base = autor + leitor = 2 (inativo e terceirizado fora). 1/2 = 50%.
    expect(reach.audience).toBe(2)
    expect(reach.items[0].readPct).toBe(50)
  })

  it('readers só conta leitura de gente ativa e não-terceirizada, mesmo se a linha de leitura existir', async () => {
    const autor = await makeUser('autor-numerador@empresa.com', 'ADMIN')
    const leitorAtivo = await makeUser('leitor-ativo-numerador@empresa.com')
    const leitorTerceiro = await makeUser('leitor-terceiro-numerador@empresa.com', 'THIRD_PARTY')
    const leitorDesativado = await makeUser('leitor-desativado-numerador@empresa.com')
    const post = await createPost({ authorId: autor.id, content: 'aviso com leitor terceirizado e desativado', companyId: DEFAULT_COMPANY_ID })

    // Terceirizado com a feature na allowlist individual pode ler pela rota comum
    // (guard do mural comum, não o admin) — a leitura fica registrada mesmo assim.
    await markPostRead({ postId: post.id, viewer: viewerOf(leitorAtivo) })
    await markPostRead({ postId: post.id, viewer: viewerOf(leitorTerceiro) })
    await markPostRead({ postId: post.id, viewer: viewerOf(leitorDesativado) })
    // Desativado DEPOIS de ler: a leitura já existia, mas quem leu não conta mais.
    await prisma.user.update({ where: { id: leitorDesativado.id }, data: { active: false } })

    const reach = await getPostReach(DEFAULT_COMPANY_ID, { sort: 'date_desc', page: 1, pageSize: 20 })

    // base = autor + leitorAtivo = 2 (terceiro e desativado ficam fora do denominador).
    expect(reach.audience).toBe(2)
    // numerador: só leitorAtivo — terceiro e desativado não deveriam contar mesmo tendo lido.
    expect(reach.items[0].readers).toBe(1)
    expect(reach.items[0].readPct).toBeLessThanOrEqual(100)
    expect(reach.items[0].readPct).toBe(50)
  })

  it('o denominador de um comunicado segmentado é o público dele, não a empresa', async () => {
    const autor = await makeUser('autor-audiencia-alcance@empresa.com', 'ADMIN')
    const setorB = await prisma.sector.create({
      data: { name: 'Setor B', slug: `setor-b-${Math.random()}`, enabledFeatures: [] },
    })
    const doSetorB = await makeUser('leitor-setor-b@empresa.com', 'LEGEND', setorB.id)
    await makeUser('outro-do-setor-b@empresa.com', 'LEGEND', setorB.id)

    const post = await createPost({
      authorId: autor.id,
      content: 'só para o B',
      audience: 'SECTORS',
      audienceSectorIds: [setorB.id],
      companyId: DEFAULT_COMPANY_ID,
    })
    await markPostRead({ postId: post.id, viewer: viewerOf(doSetorB) })

    const reach = await getPostReach(DEFAULT_COMPANY_ID, { sort: 'date_desc', page: 1, pageSize: 20 })

    // Empresa tem 3 pessoas ativas, mas o público do post são as 2 do setor B:
    // 1 de 2 = 50%. Com o denominador da empresa daria 33% — número mentiroso.
    expect(reach.audience).toBe(3)
    expect(reach.items[0]).toMatchObject({ audience: 2, readers: 1, readPct: 50 })
  })

  it('pendente e recusado ficam fora do alcance', async () => {
    const admin = await makeUser('autor-status-alcance@empresa.com', 'ADMIN')
    const lenda = await makeUser('lenda-status-alcance@empresa.com', 'LEGEND')
    await createPost({ authorId: admin.id, content: 'publicado', companyId: DEFAULT_COMPANY_ID })
    await createPost({ authorId: lenda.id, content: 'pendente', companyId: DEFAULT_COMPANY_ID })

    const reach = await getPostReach(DEFAULT_COMPANY_ID, { sort: 'date_desc', page: 1, pageSize: 20 })

    expect(reach.items.map((i) => i.excerpt)).toEqual(['publicado'])
    expect(reach.total).toBe(1)
  })

  it('não mostra post nem leitura de outra empresa', async () => {
    const outra = await prisma.company.create({
      data: { name: 'Outra', slug: `outra-${Math.random()}` },
    })
    const setorDaOutra = await prisma.sector.create({
      data: { name: 'Setor Outra', slug: `setor-outra-${Math.random()}`, enabledFeatures: [], companyId: outra.id },
    })
    const autorOutra = await makeUser('autor-outra@empresa.com', 'ADMIN', setorDaOutra.id, outra.id)
    await createPost({ authorId: autorOutra.id, content: 'segredo da outra', companyId: outra.id })

    const autor = await makeUser('autor-minha@empresa.com', 'ADMIN')
    await createPost({ authorId: autor.id, content: 'meu aviso', companyId: DEFAULT_COMPANY_ID })

    const reach = await getPostReach(DEFAULT_COMPANY_ID, { sort: 'date_desc', page: 1, pageSize: 20 })

    expect(reach.items).toHaveLength(1)
    expect(reach.items[0].excerpt).toBe('meu aviso')
  })

  it('ordena por data crescente quando pedido', async () => {
    const autor = await makeUser('autor-ordem@empresa.com', 'ADMIN')
    const primeiro = await createPost({ authorId: autor.id, content: 'primeiro', companyId: DEFAULT_COMPANY_ID })
    const segundo = await createPost({ authorId: autor.id, content: 'segundo', companyId: DEFAULT_COMPANY_ID })

    const asc = await getPostReach(DEFAULT_COMPANY_ID, { sort: 'date_asc', page: 1, pageSize: 20 })
    const desc = await getPostReach(DEFAULT_COMPANY_ID, { sort: 'date_desc', page: 1, pageSize: 20 })

    expect(asc.items.map((i) => i.postId)).toEqual([primeiro.id, segundo.id])
    expect(desc.items.map((i) => i.postId)).toEqual([segundo.id, primeiro.id])
  })

  it('corta o trecho em CORPORATE_POST_EXCERPT_LENGTH', async () => {
    const autor = await makeUser('autor-trecho@empresa.com', 'ADMIN')
    await createPost({ authorId: autor.id, content: 'x'.repeat(200), companyId: DEFAULT_COMPANY_ID })

    const reach = await getPostReach(DEFAULT_COMPANY_ID, { sort: 'date_desc', page: 1, pageSize: 20 })

    expect(reach.items[0].excerpt).toHaveLength(81) // 80 + o caractere de reticências
    expect(reach.items[0].excerpt.endsWith('…')).toBe(true)
  })
})

describe('listPostReactors', () => {
  it('lista quem reagiu, com setor e emoji, do mais recente para o mais antigo', async () => {
    const autor = await makeUser('autor-reatores@empresa.com', 'ADMIN')
    const a = await makeUser('reator-a@empresa.com')
    const b = await makeUser('reator-b@empresa.com')
    const post = await createPost({ authorId: autor.id, content: 'quem curtiu', companyId: DEFAULT_COMPANY_ID })

    await togglePostReaction({ postId: post.id, emoji: '💚', viewer: viewerOf(a) })
    await togglePostReaction({ postId: post.id, emoji: '🎉', viewer: viewerOf(b) })

    const { items, total } = await listPostReactors(post.id, viewerOf(a))

    expect(total).toBe(2)
    expect(items.map((i) => i.user.id)).toEqual([b.id, a.id])
    expect(items[0]).toMatchObject({ emoji: '🎉', sectorName: 'Desenvolvimento de Produto' })
    expect(items[1]).toMatchObject({ emoji: '💚' })
  })

  it('a mesma pessoa com dois emojis rende duas linhas — o mesmo total da tabela de alcance', async () => {
    const autor = await makeUser('autor-dois-emojis@empresa.com', 'ADMIN')
    const a = await makeUser('reator-dois-emojis@empresa.com')
    const post = await createPost({ authorId: autor.id, content: 'dois emojis', companyId: DEFAULT_COMPANY_ID })

    await togglePostReaction({ postId: post.id, emoji: '💚', viewer: viewerOf(a) })
    await togglePostReaction({ postId: post.id, emoji: '🚀', viewer: viewerOf(a) })

    const { items, total } = await listPostReactors(post.id, viewerOf(a))
    const reach = await getPostReach(DEFAULT_COMPANY_ID, { sort: 'date_desc', page: 1, pageSize: 20 })

    expect(items).toHaveLength(2)
    expect(total).toBe(2)
    expect(reach.items.find((i) => i.postId === post.id)?.reactions).toBe(2)
  })

  it('reação desfeita some da lista', async () => {
    const autor = await makeUser('autor-toggle@empresa.com', 'ADMIN')
    const a = await makeUser('reator-toggle@empresa.com')
    const post = await createPost({ authorId: autor.id, content: 'toggle', companyId: DEFAULT_COMPANY_ID })

    await togglePostReaction({ postId: post.id, emoji: '💚', viewer: viewerOf(a) })
    await togglePostReaction({ postId: post.id, emoji: '💚', viewer: viewerOf(a) })

    const { items, total } = await listPostReactors(post.id, viewerOf(a))
    expect(items).toEqual([])
    expect(total).toBe(0)
  })

  it('post de outra empresa é 404, não lista vazia', async () => {
    const outra = await prisma.company.create({
      data: { id: 'company-outra-reatores', name: 'Outra', slug: 'outra-reatores' },
    })
    const setorOutra = await prisma.sector.create({
      data: { name: 'Geral', slug: 'geral-reatores', companyId: outra.id },
    })
    const autor = await makeUser('autor-outra-reatores@outra.com', 'ADMIN', setorOutra.id, outra.id)
    const post = await createPost({ authorId: autor.id, content: 'de outra empresa', companyId: outra.id })

    // O viewer é da empresa padrão; o post é da outra. Escopo de tenant vale
    // igual para a lista aberta a todo mundo.
    const forasteiro = await makeUser('forasteiro-reatores@empresa.com')
    await expect(listPostReactors(post.id, viewerOf(forasteiro))).rejects.toThrow(
      'Publicação não encontrada.',
    )
  })
})

describe('listPostReactors — quem pode ver', () => {
  it('quem está fora do público-alvo do comunicado leva 404', async () => {
    const outroSetor = await prisma.sector.create({
      data: { name: 'Comercial reatores', slug: 'comercial-reatores', companyId: DEFAULT_COMPANY_ID },
    })
    const autor = await makeUser('autor-segmentado-reatores@empresa.com', 'ADMIN')
    const dentro = await makeUser('dentro-reatores@empresa.com', 'LEGEND', outroSetor.id)
    const fora = await makeUser('fora-reatores@empresa.com')
    const post = await createPost({
      authorId: autor.id,
      content: 'só para o comercial',
      companyId: DEFAULT_COMPANY_ID,
      audience: 'SECTORS',
      audienceSectorIds: [outroSetor.id],
    })
    await togglePostReaction({ postId: post.id, emoji: '💚', viewer: viewerOf(dentro) })

    const visto = await listPostReactors(post.id, viewerOf(dentro))
    expect(visto.total).toBe(1)

    await expect(listPostReactors(post.id, viewerOf(fora))).rejects.toThrow('Publicação não encontrada.')
  })

  // O painel de alcance passou a usar esta mesma rota (antes havia uma /admin
  // separada): se o recorte de público-alvo valesse para quem modera, a
  // moderação perderia justamente os comunicados segmentados de outros setores.
  it('quem modera vê a lista de um comunicado segmentado fora do setor dele', async () => {
    const outroSetor = await prisma.sector.create({
      data: { name: 'Ensino reatores', slug: 'ensino-reatores', companyId: DEFAULT_COMPANY_ID },
    })
    // ADMIN porque post de LEGEND nasce PENDING, e pendente não é visível a
    // ninguém — nem para quem modera, que o lê pela fila de aprovação.
    const autor = await makeUser('autor-moderacao-reatores@empresa.com', 'ADMIN', outroSetor.id)
    const admin = await makeUser('admin-moderacao-reatores@empresa.com', 'ADMIN')
    const post = await createPost({
      authorId: autor.id,
      content: 'segmentado para o ensino',
      companyId: DEFAULT_COMPANY_ID,
      audience: 'SECTORS',
      audienceSectorIds: [outroSetor.id],
    })
    await togglePostReaction({ postId: post.id, emoji: '🚀', viewer: viewerOf(autor) })

    const { items } = await listPostReactors(post.id, viewerOf(admin))
    expect(items.map((i) => i.user.id)).toEqual([autor.id])
  })

  it('colega comum do público-alvo vê a lista — não é informação de moderação', async () => {
    const autor = await makeUser('autor-aberto-reatores@empresa.com', 'ADMIN')
    const lenda = await makeUser('lenda-aberta-reatores@empresa.com')
    const post = await createPost({ authorId: autor.id, content: 'aberto a todos', companyId: DEFAULT_COMPANY_ID })
    await togglePostReaction({ postId: post.id, emoji: '🎉', viewer: viewerOf(autor) })

    const { items } = await listPostReactors(post.id, viewerOf(lenda))
    expect(items.map((i) => i.user.id)).toEqual([autor.id])
  })
})

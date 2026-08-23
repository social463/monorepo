import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { createSector } from './sector-service'
import { listSharedFeedbacks } from './feedback-service'

const SECTOR = 'sector-dev-produto'

async function makeUser(email: string, sectorId = SECTOR) {
  return prisma.user.create({ data: { name: email, email, passwordHash: 'x', sectorId } })
}

async function makeSector() {
  const admin = await prisma.user.create({
    data: { name: 'admin', email: `admin-${Math.random()}@x.com`, passwordHash: 'x', role: 'ADMIN' },
  })
  const sector = await createSector(
    { name: `Outro Setor ${Math.random()}`, enabledFeatures: [], roles: [] },
    admin.id,
    DEFAULT_COMPANY_ID,
  )
  return sector.id
}

function share(
  authorId: string,
  targetId: string,
  message: string,
  opts: { sharedAt?: Date | null; category?: 'POSITIVO' | 'ELOGIO' | 'ORIENTACAO' | 'MELHORIA' } = {},
) {
  return prisma.feedback.create({
    data: {
      authorId,
      targetId,
      message,
      category: opts.category ?? 'POSITIVO',
      sharedAt: opts.sharedAt === undefined ? new Date() : opts.sharedAt,
    },
  })
}

describe('listSharedFeedbacks', () => {
  it('inclui feedbacks compartilhados de qualquer setor da empresa', async () => {
    const outroSetor = await makeSector()
    const author = await makeUser('w-author@x.com')
    const mesmoSetor = await makeUser('w-target-a@x.com')
    const outro = await makeUser('w-target-b@x.com', outroSetor)
    const a = await share(author.id, mesmoSetor.id, 'feedback do proprio setor aqui')
    const b = await share(author.id, outro.id, 'feedback de outro setor aqui')

    const rows = await listSharedFeedbacks(DEFAULT_COMPANY_ID)
    expect(rows.map((r) => r.id).sort()).toEqual([a.id, b.id].sort())
  })

  it('ignora feedbacks não compartilhados e categorias restritas', async () => {
    const author = await makeUser('w-author-2@x.com')
    const target = await makeUser('w-target-2@x.com')
    const shared = await share(author.id, target.id, 'esse aqui foi compartilhado')
    await share(author.id, target.id, 'esse aqui nao foi compartilhado', { sharedAt: null })
    // Categoria restrita nunca deveria chegar ao mural nem se sharedAt for forçado no banco.
    await share(author.id, target.id, 'orientacao privada compartilhada', { category: 'ORIENTACAO' })

    const rows = await listSharedFeedbacks(DEFAULT_COMPANY_ID)
    expect(rows.map((r) => r.id)).toEqual([shared.id])
  })

  it('exclui feedbacks cujo destinatário está desativado', async () => {
    const author = await makeUser('w-author-3@x.com')
    const target = await prisma.user.create({
      data: { name: 'inativo', email: 'w-inactive@x.com', passwordHash: 'x', active: false, sectorId: SECTOR },
    })
    await share(author.id, target.id, 'feedback para alguem desativado')

    expect(await listSharedFeedbacks(DEFAULT_COMPANY_ID)).toHaveLength(0)
  })

  it('ordena pelo compartilhamento mais recente e pagina por offset', async () => {
    const author = await makeUser('w-author-4@x.com')
    const target = await makeUser('w-target-4@x.com')
    const antigo = await share(author.id, target.id, 'compartilhado ha tres dias', {
      sharedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    })
    const meio = await share(author.id, target.id, 'compartilhado ha dois dias', {
      sharedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    })
    const recente = await share(author.id, target.id, 'compartilhado agora mesmo')

    const primeira = await listSharedFeedbacks(DEFAULT_COMPANY_ID, { limit: 2 })
    // `take: limit + 1` — a rota usa o item extra só para calcular hasMore.
    expect(primeira.map((r) => r.id)).toEqual([recente.id, meio.id, antigo.id])

    const segunda = await listSharedFeedbacks(DEFAULT_COMPANY_ID, { offset: 2, limit: 2 })
    expect(segunda.map((r) => r.id)).toEqual([antigo.id])
  })

  it('restringe ao setor informado (caso do terceirizado)', async () => {
    const outroSetor = await makeSector()
    const author = await makeUser('w-author-5@x.com')
    const mesmoSetor = await makeUser('w-target-5a@x.com')
    const outro = await makeUser('w-target-5b@x.com', outroSetor)
    const doSetor = await share(author.id, mesmoSetor.id, 'feedback visivel ao terceirizado')
    await share(author.id, outro.id, 'feedback de fora do setor dele')

    const rows = await listSharedFeedbacks(DEFAULT_COMPANY_ID, { sectorId: SECTOR })
    expect(rows.map((r) => r.id)).toEqual([doSetor.id])
  })
})

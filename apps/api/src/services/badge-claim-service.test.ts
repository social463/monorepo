import { describe, expect, it, vi } from 'vitest'
import { prisma } from '../lib/prisma'
import {
  BadgeClaimError,
  approveBadgeClaim,
  createBadgeClaim,
  listBadgeClaims,
  listMyBadgeClaims,
  rejectBadgeClaim,
} from './badge-claim-service'

/**
 * Documento 4, seção 11.2: nem todo selo é contável pelo sistema, e o único
 * caminho para um selo de comportamento era pedir no Teams.
 */

vi.mock('./notification-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./notification-service')>()
  return { ...actual, createNotification: vi.fn().mockResolvedValue(undefined) }
})

const COMPANY = 'company-emr'

async function pessoa(email: string) {
  return prisma.user.create({ data: { name: 'Dev', email, passwordHash: 'x' } })
}

async function selo(input: { slug: string; rewardPoints?: number | null; rewardCoins?: number | null }) {
  return prisma.badge.create({
    data: {
      slug: input.slug,
      name: `Selo ${input.slug}`,
      description: 'Conquista de comportamento.',
      kind: 'IMPACT',
      iconKey: 'trophy',
      rewardPoints: input.rewardPoints ?? null,
      rewardCoins: input.rewardCoins ?? null,
      companyId: COMPANY,
    },
  })
}

describe('createBadgeClaim', () => {
  it('registra o relato e nasce em análise', async () => {
    const user = await pessoa('pede@empresa.com')
    const badge = await selo({ slug: 'voz-que-constroi' })

    const claim = await createBadgeClaim({ userId: user.id, companyId: COMPANY }, badge.id, {
      story: 'Liderei a virada do projeto X.',
    })

    expect(claim.status).toBe('PENDING')
    expect(claim.story).toBe('Liderei a virada do projeto X.')
  })

  it('recusa relato vazio — é o que a G&G lê para decidir', async () => {
    const user = await pessoa('vazio@empresa.com')
    const badge = await selo({ slug: 'sem-relato' })

    await expect(
      createBadgeClaim({ userId: user.id, companyId: COMPANY }, badge.id, { story: '   ' }),
    ).rejects.toThrow(BadgeClaimError)
  })

  it('recusa anexo que não nasceu no presign desta pessoa', async () => {
    const user = await pessoa('anexo@empresa.com')
    const badge = await selo({ slug: 'anexo-alheio' })

    await expect(
      createBadgeClaim({ userId: user.id, companyId: COMPANY }, badge.id, {
        story: 'Tenho o certificado.',
        attachmentKey: 'badge-claims/outra-pessoa/abc.pdf',
      }),
    ).rejects.toThrow(BadgeClaimError)
  })

  it('uma reivindicação ATIVA por pessoa e selo', async () => {
    const user = await pessoa('duplicada@empresa.com')
    const badge = await selo({ slug: 'so-uma' })
    await createBadgeClaim({ userId: user.id, companyId: COMPANY }, badge.id, { story: 'Primeira.' })

    await expect(
      createBadgeClaim({ userId: user.id, companyId: COMPANY }, badge.id, { story: 'Segunda.' }),
    ).rejects.toThrow(/já tem uma solicitação em análise/i)
  })

  it('depois de recusada dá para tentar de novo — recusar existe para isso', async () => {
    const user = await pessoa('retentativa@empresa.com')
    const admin = await pessoa('admin-retenta@empresa.com')
    const badge = await selo({ slug: 'tenta-de-novo' })
    const primeira = await createBadgeClaim({ userId: user.id, companyId: COMPANY }, badge.id, { story: 'Primeira.' })
    await rejectBadgeClaim({ id: admin.id, companyId: COMPANY }, primeira.id, 'Falta comprovação.')

    const segunda = await createBadgeClaim({ userId: user.id, companyId: COMPANY }, badge.id, {
      story: 'Agora com o certificado.',
    })

    expect(segunda.status).toBe('PENDING')
    expect(await listMyBadgeClaims({ userId: user.id, companyId: COMPANY })).toHaveLength(2)
  })

  it('recusa quem já tem o selo', async () => {
    const user = await pessoa('ja-tem@empresa.com')
    const badge = await selo({ slug: 'ja-conquistado' })
    await prisma.userBadge.create({ data: { userId: user.id, badgeId: badge.id, companyId: COMPANY } })

    await expect(
      createBadgeClaim({ userId: user.id, companyId: COMPANY }, badge.id, { story: 'Quero de novo.' }),
    ).rejects.toThrow(/já tem este selo/i)
  })
})

describe('approveBadgeClaim', () => {
  it('concede o selo e credita as duas moedas na mesma transação', async () => {
    const user = await pessoa('aprovado@empresa.com')
    const admin = await pessoa('admin-aprova@empresa.com')
    const badge = await selo({ slug: 'com-recompensa', rewardPoints: 50, rewardCoins: 20 })
    const claim = await createBadgeClaim({ userId: user.id, companyId: COMPANY }, badge.id, { story: 'Fiz.' })

    const aprovada = await approveBadgeClaim({ id: admin.id, companyId: COMPANY }, claim.id)

    expect(aprovada.status).toBe('APPROVED')
    const concessao = await prisma.userBadge.findFirst({ where: { userId: user.id, badgeId: badge.id } })
    // MANUAL, e não AUTO: quem concedeu foi uma pessoa olhando a comprovação —
    // e é MANUAL que o admin consegue revogar depois.
    expect(concessao?.source).toBe('MANUAL')

    const coins = await prisma.coinTransaction.findMany({ where: { userId: user.id } })
    const pontos = await prisma.xpTransaction.findMany({ where: { userId: user.id } })
    expect(coins.map((t) => t.amount)).toEqual([20])
    expect(pontos.map((t) => t.amount)).toEqual([50])
  })

  it('selo sem recompensa configurada não credita nada', async () => {
    const user = await pessoa('sem-recompensa@empresa.com')
    const admin = await pessoa('admin-sem@empresa.com')
    const badge = await selo({ slug: 'sem-premio' })
    const claim = await createBadgeClaim({ userId: user.id, companyId: COMPANY }, badge.id, { story: 'Fiz.' })

    await approveBadgeClaim({ id: admin.id, companyId: COMPANY }, claim.id)

    expect(await prisma.coinTransaction.count({ where: { userId: user.id } })).toBe(0)
    expect(await prisma.xpTransaction.count({ where: { userId: user.id } })).toBe(0)
  })

  it('aprovar duas vezes é 409 — e não concede o selo em dobro', async () => {
    const user = await pessoa('dupla@empresa.com')
    const admin = await pessoa('admin-dupla@empresa.com')
    const badge = await selo({ slug: 'aprovar-duas-vezes', rewardCoins: 10 })
    const claim = await createBadgeClaim({ userId: user.id, companyId: COMPANY }, badge.id, { story: 'Fiz.' })

    await approveBadgeClaim({ id: admin.id, companyId: COMPANY }, claim.id)
    await expect(approveBadgeClaim({ id: admin.id, companyId: COMPANY }, claim.id)).rejects.toThrow(
      /já foi revisada/i,
    )

    expect(await prisma.userBadge.count({ where: { userId: user.id, badgeId: badge.id } })).toBe(1)
    expect(await prisma.coinTransaction.count({ where: { userId: user.id } })).toBe(1)
  })
})

describe('rejectBadgeClaim', () => {
  it('exige motivo e devolve ele para quem pediu', async () => {
    const user = await pessoa('recusado@empresa.com')
    const admin = await pessoa('admin-recusa@empresa.com')
    const badge = await selo({ slug: 'recusar' })
    const claim = await createBadgeClaim({ userId: user.id, companyId: COMPANY }, badge.id, { story: 'Fiz.' })

    await expect(rejectBadgeClaim({ id: admin.id, companyId: COMPANY }, claim.id, '  ')).rejects.toThrow(
      BadgeClaimError,
    )

    const recusada = await rejectBadgeClaim({ id: admin.id, companyId: COMPANY }, claim.id, 'Sem comprovação.')
    expect(recusada.status).toBe('REJECTED')
    expect(recusada.rejectionReason).toBe('Sem comprovação.')
    expect(await prisma.userBadge.count({ where: { userId: user.id } })).toBe(0)
  })
})

describe('listBadgeClaims', () => {
  it('filtra a fila por status', async () => {
    const user = await pessoa('fila@empresa.com')
    const admin = await pessoa('admin-fila@empresa.com')
    const a = await selo({ slug: 'fila-a' })
    const b = await selo({ slug: 'fila-b' })
    const claimA = await createBadgeClaim({ userId: user.id, companyId: COMPANY }, a.id, { story: 'A.' })
    await createBadgeClaim({ userId: user.id, companyId: COMPANY }, b.id, { story: 'B.' })
    await approveBadgeClaim({ id: admin.id, companyId: COMPANY }, claimA.id)

    expect(await listBadgeClaims(COMPANY, 'PENDING')).toHaveLength(1)
    expect(await listBadgeClaims(COMPANY, 'APPROVED')).toHaveLength(1)
    expect(await listBadgeClaims(COMPANY)).toHaveLength(2)
  })
})

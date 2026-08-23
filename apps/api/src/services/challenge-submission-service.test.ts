import { describe, it, expect, vi, afterEach } from 'vitest'
import { DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { createChallenge, createSubmission, SubmissionNotPendingError, ChallengeSectorForbiddenError } from './challenge-service'
import {
  approveSubmission,
  rejectSubmission,
  listSubmissions,
  reviewBatch,
  exportSubmissionsCsv,
} from './challenge-submission-service'
import * as notificationService from './notification-service'

const OTHER_SECTOR_ID = 'sector-gente-gestao'

// Setor não vem semeado por padrão (só sector-dev-produto vem da migration) — mesmo
// helper usado em challenge-service.test.ts para o mesmo propósito.
async function ensureOtherSector() {
  await prisma.sector.upsert({
    where: { id: OTHER_SECTOR_ID },
    update: {},
    create: { id: OTHER_SECTOR_ID, name: 'Gente e Gestão', slug: 'gente-gestao', companyId: DEFAULT_COMPANY_ID },
  })
}

async function makeUser(email: string, sectorId = DEFAULT_SECTOR_ID) {
  return prisma.user.create({
    data: { name: 'Pessoa', email, passwordHash: 'x', role: 'LEGEND', sectorId },
  })
}
function adminActor(id: string) {
  return { id, role: 'ADMIN', sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID }
}

/** Desafio da empresa + uma submissão pendente de `participante`. */
async function scenario(rewardCoins = 200) {
  const admin = await makeUser(`admin-${Math.random()}@x.com`)
  const actor = adminActor(admin.id)
  const challenge = await createChallenge(actor, {
    title: 'Ler um livro', description: 'D', category: 'Cultura', rewardCoins, sectorId: null,
  })
  const participant = await makeUser(`p-${Math.random()}@x.com`)
  const submission = await createSubmission(
    { id: participant.id, sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID },
    challenge.id,
    { note: 'Li o livro.' },
  )
  return { actor, challenge, participant, submission }
}

function balanceOf(userId: string) {
  return prisma.coinTransaction
    .aggregate({ where: { userId }, _sum: { amount: true } })
    .then((r) => r._sum.amount ?? 0)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('aprovar submissão', () => {
  it('credita exatamente a recompensa do desafio e marca como aprovada', async () => {
    const { actor, participant, submission } = await scenario(200)

    const result = await approveSubmission(actor, submission.id)

    expect(result.status).toBe('APPROVED')
    expect(result.reviewedById).toBe(actor.id)
    expect(result.reviewedAt).not.toBeNull()
    expect(await balanceOf(participant.id)).toBe(200)
  })

  it('aprovar duas vezes credita uma única vez', async () => {
    const { actor, participant, submission } = await scenario(200)

    await approveSubmission(actor, submission.id)
    await expect(approveSubmission(actor, submission.id)).rejects.toBeInstanceOf(SubmissionNotPendingError)

    expect(await balanceOf(participant.id)).toBe(200)
    expect(await prisma.coinTransaction.count({ where: { userId: participant.id } })).toBe(1)
  })

  it('duas aprovações CONCORRENTES creditam uma única vez', async () => {
    const { actor, participant, submission } = await scenario(200)

    const results = await Promise.allSettled([
      approveSubmission(actor, submission.id),
      approveSubmission(actor, submission.id),
    ])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    // Não basta o perdedor rejeitar — precisa rejeitar com o erro de negócio certo.
    // Um deadlock (P2034) ou timeout de $transaction também rejeitariam e deixariam
    // este teste verde, mas em produção virariam 500 em vez do 409 esperado por um
    // segundo moderador legítimo.
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
    expect(rejected[0].reason).toBeInstanceOf(SubmissionNotPendingError)
    expect(await balanceOf(participant.id)).toBe(200)
    expect(await prisma.coinTransaction.count({ where: { userId: participant.id } })).toBe(1)
  })

  it('aprovar uma já rejeitada falha e não credita', async () => {
    const { actor, participant, submission } = await scenario(200)

    await rejectSubmission(actor, submission.id, 'Faltou evidência do livro.')
    await expect(approveSubmission(actor, submission.id)).rejects.toBeInstanceOf(SubmissionNotPendingError)

    expect(await balanceOf(participant.id)).toBe(0)
  })

  it('recompensa zero aprova sem criar lançamento no extrato', async () => {
    const { actor, participant, submission } = await scenario(0)

    const result = await approveSubmission(actor, submission.id)

    expect(result.status).toBe('APPROVED')
    expect(await prisma.coinTransaction.count({ where: { userId: participant.id } })).toBe(0)
  })

  it('grava auditoria da decisão', async () => {
    const { actor, submission } = await scenario()
    await approveSubmission(actor, submission.id)

    const log = await prisma.adminAuditLog.findFirstOrThrow({
      where: { entityType: 'ChallengeSubmission', entityId: submission.id },
    })
    expect(log.actorId).toBe(actor.id)
    expect(log.action).toBe('UPDATE')
  })

  it('falha na notificação NÃO desfaz a aprovação', async () => {
    const { actor, participant, submission } = await scenario(200)
    // Espiona pelo objeto de namespace de propósito: é assim que o service chama
    // (`notificationService.notifyChallengeReviewed`), então o spy só intercepta
    // enquanto essa chamada continuar indireta. Se alguém "limpar" para um import
    // nomeado, o spy para de valer — por isso as asserções abaixo exigem que o spy
    // (e o catch que o envolve) tenham de fato sido exercitados, em vez de só
    // conferir que a aprovação sobreviveu (o que passaria mesmo sem o caminho
    // best-effort ser testado).
    const spy = vi.spyOn(notificationService, 'notifyChallengeReviewed').mockRejectedValue(new Error('teams caiu'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await approveSubmission(actor, submission.id)

    expect(result.status).toBe('APPROVED')
    expect(await balanceOf(participant.id)).toBe(200)
    expect(spy).toHaveBeenCalledOnce()
    expect(errorSpy).toHaveBeenCalledOnce()
  })

  it('SUBADMIN de outro setor não decide', async () => {
    const { submission } = await scenario()
    await ensureOtherSector()
    const sub = await makeUser('sub-outro@x.com', OTHER_SECTOR_ID)
    const actor = { id: sub.id, role: 'SUBADMIN', sectorId: OTHER_SECTOR_ID, companyId: DEFAULT_COMPANY_ID }

    await expect(approveSubmission(actor, submission.id)).rejects.toBeInstanceOf(ChallengeSectorForbiddenError)
  })
})

describe('rejeitar submissão', () => {
  it('não credita, guarda o motivo e libera nova participação', async () => {
    const { actor, participant, challenge, submission } = await scenario(200)

    const result = await rejectSubmission(actor, submission.id, 'A evidência não confere.')

    expect(result.status).toBe('REJECTED')
    expect(result.rejectionReason).toBe('A evidência não confere.')
    expect(await balanceOf(participant.id)).toBe(0)

    const again = await createSubmission(
      { id: participant.id, sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID },
      challenge.id,
      { note: 'Agora com print.' },
    )
    expect(again.status).toBe('PENDING')
  })
})

/** N submissões pendentes de pessoas distintas no mesmo desafio. */
async function manySubmissions(count: number) {
  const admin = await makeUser(`admin-many-${Math.random()}@x.com`)
  const actor = adminActor(admin.id)
  const challenge = await createChallenge(actor, { title: 'Lote', description: 'D', category: 'Cultura', rewardCoins: 10, sectorId: null })
  const submissions = []
  for (let i = 0; i < count; i += 1) {
    const user = await makeUser(`many-${i}-${Math.random()}@x.com`)
    submissions.push(
      await createSubmission({ id: user.id, sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID }, challenge.id, {}),
    )
  }
  return { actor, challenge, submissions }
}

describe('fila de submissões', () => {
  it('pagina por cursor sem repetir nem pular item', async () => {
    const { actor } = await manySubmissions(5)

    const first = await listSubmissions(actor, {}, { limit: 2 })
    expect(first.items).toHaveLength(2)
    expect(first.nextCursor).not.toBeNull()

    const second = await listSubmissions(actor, {}, { limit: 2, cursor: first.nextCursor! })
    const third = await listSubmissions(actor, {}, { limit: 2, cursor: second.nextCursor! })

    const ids = [...first.items, ...second.items, ...third.items].map((s) => s.id)
    expect(new Set(ids).size).toBe(5)
    expect(third.nextCursor).toBeNull()
  })

  it('filtra por pessoa e por desafio, combinados', async () => {
    const admin = await makeUser('admin-filtro@x.com')
    const actor = adminActor(admin.id)
    const a = await createChallenge(actor, { title: 'A', description: 'D', category: 'Cultura', rewardCoins: 10, sectorId: null })
    const b = await createChallenge(actor, { title: 'B', description: 'D', category: 'Cultura', rewardCoins: 10, sectorId: null })
    const ana = await makeUser('ana@x.com')
    const bruno = await makeUser('bruno@x.com')
    const me = (u: { id: string }) => ({ id: u.id, sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID })

    await createSubmission(me(ana), a.id, {})
    await createSubmission(me(ana), b.id, {})
    await createSubmission(me(bruno), a.id, {})

    const onlyAna = await listSubmissions(actor, { userId: ana.id }, { limit: 10 })
    expect(onlyAna.items).toHaveLength(2)

    const anaOnA = await listSubmissions(actor, { userId: ana.id, challengeId: a.id }, { limit: 10 })
    expect(anaOnA.items).toHaveLength(1)
    expect(anaOnA.items[0].challenge.id).toBe(a.id)
  })

  it('filtra por status para a aba Pendentes', async () => {
    const { actor, submissions } = await manySubmissions(3)
    await rejectSubmission(actor, submissions[0].id, 'Não rolou desta vez.')

    const pending = await listSubmissions(actor, { status: 'PENDING' }, { limit: 10 })
    expect(pending.items).toHaveLength(2)
    expect(pending.items.every((s) => s.status === 'PENDING')).toBe(true)
  })

  it('SUBADMIN só vê a fila do próprio setor, ignorando filtro de setor alheio', async () => {
    await prisma.sector.upsert({
      where: { id: OTHER_SECTOR_ID },
      update: {},
      create: { id: OTHER_SECTOR_ID, name: 'Gente e Gestão', slug: 'gente-gestao', companyId: DEFAULT_COMPANY_ID },
    })
    const admin = await makeUser('admin-setor@x.com')
    const adminAct = adminActor(admin.id)
    const mine = await createChallenge(adminAct, { title: 'Meu', description: 'D', category: 'Cultura', rewardCoins: 10, sectorId: OTHER_SECTOR_ID })
    const company = await createChallenge(adminAct, { title: 'Empresa', description: 'D', category: 'Cultura', rewardCoins: 10, sectorId: null })

    const p1 = await makeUser('p1-setor@x.com', OTHER_SECTOR_ID)
    const p2 = await makeUser('p2-setor@x.com')
    await createSubmission({ id: p1.id, sectorId: OTHER_SECTOR_ID, companyId: DEFAULT_COMPANY_ID }, mine.id, {})
    await createSubmission({ id: p2.id, sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID }, company.id, {})

    const sub = await makeUser('sub-fila@x.com', OTHER_SECTOR_ID)
    const subActor = { id: sub.id, role: 'SUBADMIN', sectorId: OTHER_SECTOR_ID, companyId: DEFAULT_COMPANY_ID }

    const page = await listSubmissions(subActor, { sectorId: DEFAULT_SECTOR_ID }, { limit: 10 })
    expect(page.items).toHaveLength(1)
    expect(page.items[0].challenge.id).toBe(mine.id)
  })

})

describe('decisão em lote', () => {
  it('aprova o lote inteiro creditando cada pessoa uma vez', async () => {
    const { actor, submissions } = await manySubmissions(3)

    const result = await reviewBatch(actor, submissions.map((s) => s.id), 'APPROVE', null)

    expect(result.succeeded).toHaveLength(3)
    expect(result.failed).toHaveLength(0)
    for (const s of submissions) {
      expect(await balanceOf(s.userId)).toBe(10)
    }
  })

  it('lote parcial relata sucessos e falhas sem engolir erro', async () => {
    const { actor, submissions } = await manySubmissions(3)
    await rejectSubmission(actor, submissions[1].id, 'Já decidida antes do lote.')

    const result = await reviewBatch(actor, submissions.map((s) => s.id), 'APPROVE', null)

    expect(result.succeeded).toEqual([submissions[0].id, submissions[2].id])
    expect(result.failed).toEqual([
      { id: submissions[1].id, message: 'Esta participação já foi avaliada.' },
    ])
    // A falha do meio não impediu a terceira de ser creditada.
    expect(await balanceOf(submissions[2].userId)).toBe(10)
  })

  it('lote de rejeição grava o mesmo motivo em todas', async () => {
    const { actor, submissions } = await manySubmissions(2)

    const result = await reviewBatch(actor, submissions.map((s) => s.id), 'REJECT', 'Evidência insuficiente.')

    expect(result.succeeded).toHaveLength(2)
    const rows = await prisma.challengeSubmission.findMany({ where: { id: { in: submissions.map((s) => s.id) } } })
    expect(rows.every((r) => r.status === 'REJECTED' && r.rejectionReason === 'Evidência insuficiente.')).toBe(true)
  })
})

describe('export CSV', () => {
  it('reflete o recorte filtrado, com cabeçalho e BOM', async () => {
    const admin = await makeUser('admin-csv@x.com')
    const actor = adminActor(admin.id)
    const a = await createChallenge(actor, { title: 'Desafio A', description: 'D', category: 'Cultura', rewardCoins: 40, sectorId: null })
    const b = await createChallenge(actor, { title: 'Desafio B', description: 'D', category: 'Cultura', rewardCoins: 10, sectorId: null })
    const ana = await makeUser('ana-csv@x.com')
    const bruno = await makeUser('bruno-csv@x.com')
    const me = (u: { id: string }) => ({ id: u.id, sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID })
    await createSubmission(me(ana), a.id, {})
    await createSubmission(me(bruno), b.id, {})

    const csv = await exportSubmissionsCsv(actor, { challengeId: a.id })

    expect(csv.startsWith('﻿')).toBe(true)
    const lines = csv.replace('﻿', '').trim().split('\n')
    expect(lines[0]).toBe('Pessoa;E-mail;Desafio;Recompensa;Status;Enviado em;Decidido em;Decidido por;Motivo')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('Desafio A')
    expect(lines[1]).not.toContain('Desafio B')
  })

  it('escapa aspas e ponto e vírgula do motivo', async () => {
    const { actor, submissions } = await manySubmissions(1)
    await rejectSubmission(actor, submissions[0].id, 'Faltou o "print"; reenvie.')

    const csv = await exportSubmissionsCsv(actor, {})

    expect(csv).toContain('"Faltou o ""print""; reenvie."')
  })

  it('neutraliza injeção de fórmula no nome (coluna vinda de user.name, escolhida no /register)', async () => {
    const admin = await makeUser('admin-formula@x.com')
    const actor = adminActor(admin.id)
    const challenge = await createChallenge(actor, {
      title: 'Desafio C', description: 'D', category: 'Cultura', rewardCoins: 10, sectorId: null,
    })
    const attacker = await prisma.user.create({
      data: {
        name: '=cmd|"/c calc"!A1',
        email: 'attacker-csv@x.com',
        passwordHash: 'x',
        role: 'LEGEND',
        sectorId: DEFAULT_SECTOR_ID,
      },
    })
    await createSubmission(
      { id: attacker.id, sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID },
      challenge.id,
      {},
    )

    const csv = await exportSubmissionsCsv(actor, { challengeId: challenge.id })
    const lines = csv.replace('﻿', '').trim().split('\n')
    // A célula não pode começar com "=" cru: o Excel abriria isso como fórmula.
    expect(lines[1].startsWith('=')).toBe(false)
    expect(lines[1]).toContain("'=cmd")
  })

  it.each(['=1+1', '+1+1', '-1+1', '@SUM(A1)'])('prefixa aspa simples para valor começando com %s', async (name) => {
    const admin = await makeUser(`admin-formula-${Math.random()}@x.com`)
    const actor = adminActor(admin.id)
    const challenge = await createChallenge(actor, {
      title: 'Desafio D', description: 'D', category: 'Cultura', rewardCoins: 10, sectorId: null,
    })
    const user = await prisma.user.create({
      data: { name, email: `attacker-${Math.random()}@x.com`, passwordHash: 'x', role: 'LEGEND', sectorId: DEFAULT_SECTOR_ID },
    })
    await createSubmission({ id: user.id, sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID }, challenge.id, {})

    const csv = await exportSubmissionsCsv(actor, { challengeId: challenge.id })
    const lines = csv.replace('﻿', '').trim().split('\n')
    expect(lines[1]).toContain(`'${name}`)
  })
})

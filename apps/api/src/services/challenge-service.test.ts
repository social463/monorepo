import { describe, it, expect, beforeEach } from 'vitest'
import { DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID } from '@legends/shared'
import { prisma } from '../lib/prisma'
import {
  ChallengeClosedError,
  ChallengeHasSubmissionsError,
  ChallengeNotFoundError,
  ChallengeSectorForbiddenError,
  InvalidEvidenceKeyError,
  createChallenge,
  createSubmission,
  deleteChallenge,
  getVisibleChallenge,
  listChallengesForAdmin,
  listMyChallenges,
  reorderChallenges,
  SubmissionAlreadyOpenError,
  updateChallenge,
} from './challenge-service'

async function makeUser(email: string) {
  return prisma.user.create({
    data: { name: 'Pessoa', email, passwordHash: 'x', role: 'LEGEND', sectorId: DEFAULT_SECTOR_ID },
  })
}

async function makeChallenge(rewardCoins = 100) {
  const admin = await makeUser(`admin-${Math.random()}@x.com`)
  return prisma.challenge.create({
    data: {
      title: 'Ler um livro técnico',
      description: 'Leia e conte o que aprendeu.',
      rewardCoins,
      companyId: DEFAULT_COMPANY_ID,
      createdById: admin.id,
    },
  })
}

const OTHER_SECTOR_ID = 'sector-gente-gestao'

async function ensureOtherSector() {
  await prisma.sector.upsert({
    where: { id: OTHER_SECTOR_ID },
    update: {},
    create: { id: OTHER_SECTOR_ID, name: 'Gente e Gestão', slug: 'gente-gestao', companyId: DEFAULT_COMPANY_ID },
  })
}

function adminActor(id: string) {
  return { id, role: 'ADMIN', sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID }
}
function subadminActor(id: string, sectorId: string) {
  return { id, role: 'SUBADMIN', sectorId, companyId: DEFAULT_COMPANY_ID }
}

describe('CRUD de desafio', () => {
  it('ADMIN cria desafio da empresa inteira', async () => {
    const admin = await makeUser('admin-crud@x.com')
    const challenge = await createChallenge(adminActor(admin.id), {
      title: 'Indicar um talento',
      description: 'Indique alguém para uma vaga aberta.',
      category: 'Cultura',
      rewardCoins: 300,
      sectorId: null,
    })
    expect(challenge.sectorId).toBeNull()
    expect(challenge.createdById).toBe(admin.id)
  })

  it('SUBADMIN não cria desafio da empresa nem de outro setor', async () => {
    await ensureOtherSector()
    const sub = await makeUser('sub-crud@x.com')
    const actor = subadminActor(sub.id, OTHER_SECTOR_ID)

    await expect(
      createChallenge(actor, { title: 'T', description: 'D', category: 'Cultura', rewardCoins: 10, sectorId: null }),
    ).rejects.toBeInstanceOf(ChallengeSectorForbiddenError)

    await expect(
      createChallenge(actor, { title: 'T', description: 'D', category: 'Cultura', rewardCoins: 10, sectorId: DEFAULT_SECTOR_ID }),
    ).rejects.toBeInstanceOf(ChallengeSectorForbiddenError)

    const ok = await createChallenge(actor, {
      title: 'Café com a liderança',
      description: 'Marque um café.',
      category: 'Cultura',
      rewardCoins: 50,
      sectorId: OTHER_SECTOR_ID,
    })
    expect(ok.sectorId).toBe(OTHER_SECTOR_ID)
  })

  it('SUBADMIN cria desafio do próprio setor quando sectorId vem omitido', async () => {
    await ensureOtherSector()
    const sub = await makeUser('sub-omit@x.com')
    const actor = subadminActor(sub.id, OTHER_SECTOR_ID)

    const created = await createChallenge(actor, {
      title: 'Indicar um talento',
      description: 'Indique alguém.',
      category: 'Cultura',
      rewardCoins: 50,
    })

    expect(created.sectorId).toBe(OTHER_SECTOR_ID)
  })

  it('ADMIN cria desafio da empresa inteira quando sectorId vem omitido', async () => {
    const admin = await makeUser('admin-omit@x.com')

    const created = await createChallenge(adminActor(admin.id), {
      title: 'Indicar um talento',
      description: 'Indique alguém.',
      category: 'Cultura',
      rewardCoins: 50,
    })

    expect(created.sectorId).toBeNull()
  })

  it('rejeita sectorId de outra empresa na criação (404)', async () => {
    const admin = await makeUser('admin-tenant-create@x.com')
    const otherCompany = await prisma.company.create({
      data: { name: 'Outra Empresa Desafio', slug: 'outra-empresa-desafio-create-test' },
    })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa', slug: 'setor-outra-empresa-desafio-create-test', companyId: otherCompany.id },
    })

    await expect(
      createChallenge(adminActor(admin.id), {
        title: 'X',
        description: 'D',
        category: 'Cultura',
        rewardCoins: 10,
        sectorId: otherSector.id,
      }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('rejeita sectorId de outra empresa na atualização (404)', async () => {
    const admin = await makeUser('admin-tenant-update@x.com')
    const challenge = await createChallenge(adminActor(admin.id), {
      title: 'X', description: 'D', category: 'Cultura', rewardCoins: 10, sectorId: null,
    })
    const otherCompany = await prisma.company.create({
      data: { name: 'Outra Empresa Desafio Update', slug: 'outra-empresa-desafio-update-test' },
    })
    const otherSector = await prisma.sector.create({
      data: { name: 'Setor Outra Empresa Update', slug: 'setor-outra-empresa-desafio-update-test', companyId: otherCompany.id },
    })

    await expect(
      updateChallenge(adminActor(admin.id), challenge.id, { sectorId: otherSector.id }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('SUBADMIN só enxerga os desafios do próprio setor', async () => {
    await ensureOtherSector()
    const admin = await makeUser('admin-list@x.com')
    await createChallenge(adminActor(admin.id), { title: 'Empresa', description: 'D', category: 'Cultura', rewardCoins: 10, sectorId: null })
    await createChallenge(adminActor(admin.id), { title: 'Outro', description: 'D', category: 'Cultura', rewardCoins: 10, sectorId: OTHER_SECTOR_ID })

    const sub = await makeUser('sub-list@x.com')
    const visible = await listChallengesForAdmin(subadminActor(sub.id, OTHER_SECTOR_ID), {})
    expect(visible.map((c) => c.title)).toEqual(['Outro'])
  })

  it('não apaga desafio que já tem submissão', async () => {
    const admin = await makeUser('admin-del@x.com')
    const actor = adminActor(admin.id)
    const challenge = await createChallenge(actor, { title: 'X', description: 'D', category: 'Cultura', rewardCoins: 10, sectorId: null })
    const user = await makeUser('participante-del@x.com')
    await prisma.challengeSubmission.create({
      data: { challengeId: challenge.id, userId: user.id, companyId: DEFAULT_COMPANY_ID },
    })

    await expect(deleteChallenge(actor, challenge.id)).rejects.toBeInstanceOf(ChallengeHasSubmissionsError)

    // Desativar é o caminho suportado.
    const off = await updateChallenge(actor, challenge.id, { isActive: false })
    expect(off.isActive).toBe(false)
  })

  it('SUBADMIN não atualiza desafio da empresa nem de outro setor', async () => {
    await ensureOtherSector()
    const admin = await makeUser('admin-upd@x.com')
    const companyChallenge = await createChallenge(adminActor(admin.id), {
      title: 'Empresa',
      description: 'D',
      category: 'Cultura',
      rewardCoins: 10,
      sectorId: null,
    })
    const otherSectorChallenge = await createChallenge(adminActor(admin.id), {
      title: 'Outro',
      description: 'D',
      category: 'Cultura',
      rewardCoins: 10,
      sectorId: OTHER_SECTOR_ID,
    })

    const sub = await makeUser('sub-upd@x.com')
    const actor = subadminActor(sub.id, DEFAULT_SECTOR_ID)

    await expect(
      updateChallenge(actor, companyChallenge.id, { isActive: false }),
    ).rejects.toBeInstanceOf(ChallengeSectorForbiddenError)

    await expect(
      updateChallenge(actor, otherSectorChallenge.id, { isActive: false }),
    ).rejects.toBeInstanceOf(ChallengeSectorForbiddenError)
  })

  it('SUBADMIN não apaga desafio da empresa nem de outro setor', async () => {
    await ensureOtherSector()
    const admin = await makeUser('admin-del2@x.com')
    const companyChallenge = await createChallenge(adminActor(admin.id), {
      title: 'Empresa',
      description: 'D',
      category: 'Cultura',
      rewardCoins: 10,
      sectorId: null,
    })
    const otherSectorChallenge = await createChallenge(adminActor(admin.id), {
      title: 'Outro',
      description: 'D',
      category: 'Cultura',
      rewardCoins: 10,
      sectorId: OTHER_SECTOR_ID,
    })

    const sub = await makeUser('sub-del2@x.com')
    const actor = subadminActor(sub.id, DEFAULT_SECTOR_ID)

    await expect(deleteChallenge(actor, companyChallenge.id)).rejects.toBeInstanceOf(ChallengeSectorForbiddenError)

    await expect(deleteChallenge(actor, otherSectorChallenge.id)).rejects.toBeInstanceOf(ChallengeSectorForbiddenError)
  })
})

describe('participação do colaborador', () => {
  it('lista desafios da empresa e do próprio setor, nunca de outro', async () => {
    await ensureOtherSector()
    const admin = await makeUser('admin-vis@x.com')
    const actor = adminActor(admin.id)
    await createChallenge(actor, { title: 'Empresa', description: 'D', category: 'Cultura', rewardCoins: 10, sectorId: null })
    await createChallenge(actor, { title: 'Meu setor', description: 'D', category: 'Cultura', rewardCoins: 10, sectorId: DEFAULT_SECTOR_ID })
    await createChallenge(actor, { title: 'Setor alheio', description: 'D', category: 'Cultura', rewardCoins: 10, sectorId: OTHER_SECTOR_ID })

    const user = await makeUser('vis@x.com')
    const list = await listMyChallenges({ id: user.id, sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID })
    expect(list.map((i) => i.challenge.title).sort()).toEqual(['Empresa', 'Meu setor'])
    expect(list.every((i) => i.mySubmission === null)).toBe(true)
  })

  it('cria a participação e devolve o estado dela na listagem', async () => {
    const admin = await makeUser('admin-part@x.com')
    const challenge = await createChallenge(adminActor(admin.id), {
      title: 'X', description: 'D', category: 'Cultura', rewardCoins: 10, sectorId: null,
    })
    const user = await makeUser('part@x.com')
    const me = { id: user.id, sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID }

    const submission = await createSubmission(me, challenge.id, { note: 'Feito!' })
    expect(submission.status).toBe('PENDING')
    expect(submission.user.name).toBe('Pessoa')

    const list = await listMyChallenges(me)
    expect(list[0].mySubmission?.id).toBe(submission.id)
  })

  it('barra a segunda participação pendente com erro de domínio', async () => {
    const admin = await makeUser('admin-dup2@x.com')
    const challenge = await createChallenge(adminActor(admin.id), {
      title: 'X', description: 'D', category: 'Cultura', rewardCoins: 10, sectorId: null,
    })
    const user = await makeUser('dup2@x.com')
    const me = { id: user.id, sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID }

    await createSubmission(me, challenge.id, {})
    await expect(createSubmission(me, challenge.id, {})).rejects.toBeInstanceOf(SubmissionAlreadyOpenError)
  })

  it('recusa participação em desafio inativo ou fora da janela', async () => {
    const admin = await makeUser('admin-fech@x.com')
    const actor = adminActor(admin.id)
    const user = await makeUser('fech@x.com')
    const me = { id: user.id, sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID }

    const inactive = await createChallenge(actor, { title: 'Off', description: 'D', category: 'Cultura', rewardCoins: 10, sectorId: null })
    await updateChallenge(actor, inactive.id, { isActive: false })
    await expect(createSubmission(me, inactive.id, {})).rejects.toBeInstanceOf(ChallengeClosedError)

    const expired = await createChallenge(actor, {
      title: 'Venceu', description: 'D', category: 'Cultura', rewardCoins: 10, sectorId: null,
      startsAt: new Date('2026-01-01T00:00:00Z'), endsAt: new Date('2026-01-31T00:00:00Z'),
    })
    await expect(createSubmission(me, expired.id, {})).rejects.toBeInstanceOf(ChallengeClosedError)
  })

  it('recusa participação em desafio de outro setor', async () => {
    await ensureOtherSector()
    const admin = await makeUser('admin-alheio@x.com')
    const challenge = await createChallenge(adminActor(admin.id), {
      title: 'Alheio', description: 'D', category: 'Cultura', rewardCoins: 10, sectorId: OTHER_SECTOR_ID,
    })
    const user = await makeUser('alheio@x.com')
    await expect(
      createSubmission({ id: user.id, sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID }, challenge.id, {}),
    ).rejects.toBeInstanceOf(ChallengeNotFoundError)
  })

  it('continua listando desafio desativado quando a pessoa já tem submissão nele, sem vazar desafio ativo de outro setor', async () => {
    // Este teste falha sob uma composição de `where` que faça
    // `{ ...visibleToUserWhere(sectorId), OR: [...] }`: a segunda chave `OR`
    // sobrescreve a primeira (mesmo nome de chave), a checagem de setor some por
    // completo, e o desafio ATIVO de outro setor passaria a vazar na lista.
    await ensureOtherSector()
    const admin = await makeUser('admin-desativado@x.com')
    const actor = adminActor(admin.id)

    const mine = await createChallenge(actor, {
      title: 'Meu desafio desativado', description: 'D', category: 'Cultura', rewardCoins: 10, sectorId: DEFAULT_SECTOR_ID,
    })
    const otherSectorActive = await createChallenge(actor, {
      title: 'Ativo de outro setor', description: 'D', category: 'Cultura', rewardCoins: 10, sectorId: OTHER_SECTOR_ID,
    })

    const user = await makeUser('desativado@x.com')
    const me = { id: user.id, sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID }
    const submission = await createSubmission(me, mine.id, {})

    // Admin desativa o desafio depois que a pessoa já submeteu.
    await updateChallenge(actor, mine.id, { isActive: false })

    const list = await listMyChallenges(me)
    const titles = list.map((i) => i.challenge.title)
    expect(titles).toContain('Meu desafio desativado')
    expect(titles).not.toContain(otherSectorActive.title)

    const own = list.find((i) => i.challenge.id === mine.id)
    expect(own?.challenge.isActive).toBe(false)
    expect(own?.mySubmission?.id).toBe(submission.id)
  })

  it('não lista desafio desativado sem submissão da pessoa', async () => {
    const admin = await makeUser('admin-desativado2@x.com')
    const actor = adminActor(admin.id)
    const inactive = await createChallenge(actor, {
      title: 'Desativado sem participação', description: 'D', category: 'Cultura', rewardCoins: 10, sectorId: null,
    })
    await updateChallenge(actor, inactive.id, { isActive: false })

    const user = await makeUser('desativado2@x.com')
    const me = { id: user.id, sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID }
    const list = await listMyChallenges(me)
    expect(list.some((i) => i.challenge.id === inactive.id)).toBe(false)
  })

  it('recusa evidenceKey fora do prefixo challenges/<userId>/ do próprio ator', async () => {
    const admin = await makeUser('admin-evid@x.com')
    const challenge = await createChallenge(adminActor(admin.id), {
      title: 'X', description: 'D', category: 'Cultura', rewardCoins: 10, sectorId: null,
    })
    const user = await makeUser('evid@x.com')
    const me = { id: user.id, sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID }

    await expect(
      createSubmission(me, challenge.id, { evidenceKey: 'challenges/outra-pessoa/arquivo.pdf' }),
    ).rejects.toBeInstanceOf(InvalidEvidenceKeyError)

    // Nem um objeto fora do namespace de desafios (ex. um manual interno).
    await expect(
      createSubmission(me, challenge.id, { evidenceKey: 'manuals/company-emr/interno.pdf' }),
    ).rejects.toBeInstanceOf(InvalidEvidenceKeyError)
  })

  it('aceita evidenceKey dentro do próprio prefixo challenges/<userId>/', async () => {
    const admin = await makeUser('admin-evid2@x.com')
    const challenge = await createChallenge(adminActor(admin.id), {
      title: 'X', description: 'D', category: 'Cultura', rewardCoins: 10, sectorId: null,
    })
    const user = await makeUser('evid2@x.com')
    const me = { id: user.id, sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID }

    const submission = await createSubmission(me, challenge.id, { evidenceKey: `challenges/${user.id}/prova.pdf` })
    expect(submission.evidenceKey).toBe(`challenges/${user.id}/prova.pdf`)
  })

  it('libera nova tentativa via createSubmission depois que a anterior é rejeitada', async () => {
    const admin = await makeUser('admin-retry@x.com')
    const challenge = await createChallenge(adminActor(admin.id), {
      title: 'X', description: 'D', category: 'Cultura', rewardCoins: 10, sectorId: null,
    })
    const user = await makeUser('retry@x.com')
    const me = { id: user.id, sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID }

    const first = await createSubmission(me, challenge.id, {})

    await prisma.challengeSubmission.update({
      where: { id: first.id },
      data: { status: 'REJECTED', rejectionReason: 'Sem evidência.' },
    })

    const second = await createSubmission(me, challenge.id, {})
    expect(second.id).not.toBe(first.id)
    expect(second.status).toBe('PENDING')
  })
})

describe('campos de catálogo e auditoria', () => {
  it('cria desafio com os campos de catálogo', async () => {
    const admin = await makeUser('admin-catalogo@x.com')
    const created = await createChallenge(adminActor(admin.id), {
      title: 'Semana do bem-estar',
      description: 'Mexa o corpo',
      category: 'Bem-estar',
      detailsMarkdown: '## Como participar\n\n- Caminhe 30 min',
      imageKey: 'images/capa.png',
      rewardCoins: 50,
      position: 2,
      isFeatured: true,
      requiresReview: false,
      sectorId: null,
    })

    expect(created.category).toBe('Bem-estar')
    expect(created.position).toBe(2)
    expect(created.isFeatured).toBe(true)
    expect(created.requiresReview).toBe(false)
    expect(created.imageKey).toBe('images/capa.png')
  })

  it('categoria fora da lista canônica é recusada com 400', async () => {
    const admin = await makeUser('admin-cat-invalida@x.com')
    await expect(
      createChallenge(adminActor(admin.id), {
        title: 'X',
        description: 'D',
        category: 'Fofoca' as never,
        rewardCoins: 10,
        sectorId: null,
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('criar grava auditoria com o desafio no after', async () => {
    const admin = await makeUser('admin-audit-create@x.com')
    const created = await createChallenge(adminActor(admin.id), {
      title: 'Auditado',
      description: 'D',
      category: 'Cultura',
      rewardCoins: 10,
      sectorId: null,
    })

    const log = await prisma.adminAuditLog.findFirst({
      where: { entityType: 'Challenge', entityId: created.id, action: 'CREATE' },
    })
    expect(log).not.toBeNull()
    expect(log?.actorId).toBe(admin.id)
  })

  it('editar grava auditoria com before e after', async () => {
    const admin = await makeUser('admin-audit-update@x.com')
    const created = await createChallenge(adminActor(admin.id), {
      title: 'Antes',
      description: 'D',
      category: 'Cultura',
      rewardCoins: 10,
      sectorId: null,
    })
    await updateChallenge(adminActor(admin.id), created.id, { title: 'Depois' })

    const log = await prisma.adminAuditLog.findFirst({
      where: { entityType: 'Challenge', entityId: created.id, action: 'UPDATE' },
    })
    expect(log).not.toBeNull()
    expect((log?.before as { title: string }).title).toBe('Antes')
    expect((log?.after as { title: string }).title).toBe('Depois')
  })
})

describe('índice único parcial de submissão ativa', () => {
  it('barra a segunda submissão não-rejeitada e libera após rejeição', async () => {
    const challenge = await makeChallenge()
    const user = await makeUser('dup@x.com')
    const base = { challengeId: challenge.id, userId: user.id, companyId: DEFAULT_COMPANY_ID }

    const first = await prisma.challengeSubmission.create({ data: base })

    await expect(prisma.challengeSubmission.create({ data: base })).rejects.toMatchObject({
      code: 'P2002',
    })

    await prisma.challengeSubmission.update({
      where: { id: first.id },
      data: { status: 'REJECTED', rejectionReason: 'Sem evidência.' },
    })

    // Rejeitada sai do índice: a nova tentativa passa.
    const second = await prisma.challengeSubmission.create({ data: base })
    expect(second.status).toBe('PENDING')

    // E a aprovada também ocupa a vaga: não dá pra submeter de novo.
    await prisma.challengeSubmission.update({ where: { id: second.id }, data: { status: 'APPROVED' } })
    await expect(prisma.challengeSubmission.create({ data: base })).rejects.toMatchObject({
      code: 'P2002',
    })
  })
})

describe('reordenação e visibilidade da vitrine', () => {
  let admin: Awaited<ReturnType<typeof makeUser>>
  let actor: ReturnType<typeof subadminActor>
  let member: { id: string; sectorId: string; companyId: string }

  beforeEach(async () => {
    await ensureOtherSector()
    admin = await makeUser(`admin-vitrine-${Math.random()}@x.com`)
    const sub = await makeUser(`sub-vitrine-${Math.random()}@x.com`)
    actor = subadminActor(sub.id, DEFAULT_SECTOR_ID)
    const collaborator = await makeUser(`member-vitrine-${Math.random()}@x.com`)
    member = { id: collaborator.id, sectorId: DEFAULT_SECTOR_ID, companyId: DEFAULT_COMPANY_ID }
  })

  it('desafio privado não aparece na vitrine', async () => {
    await createChallenge(adminActor(admin.id), {
      title: 'Público', description: 'D', category: 'Cultura',
      rewardCoins: 10, sectorId: null,
    })
    await createChallenge(adminActor(admin.id), {
      title: 'Privado', description: 'D', category: 'Cultura',
      rewardCoins: 10, isPrivate: true, sectorId: null,
    })

    const vitrine = await listMyChallenges(member)
    expect(vitrine.map((v) => v.challenge.title)).toEqual(['Público'])
  })

  it('desafio inativo não aparece na vitrine', async () => {
    await createChallenge(adminActor(admin.id), {
      title: 'Desligado', description: 'D', category: 'Cultura',
      rewardCoins: 10, isActive: false, sectorId: null,
    })

    expect(await listMyChallenges(member)).toEqual([])
  })

  it('desafio com endsAt no passado não aparece na vitrine', async () => {
    await createChallenge(adminActor(admin.id), {
      title: 'Vencido', description: 'D', category: 'Cultura', rewardCoins: 10,
      sectorId: null, endsAt: new Date('2020-01-01'),
    })
    await createChallenge(adminActor(admin.id), {
      title: 'Em aberto', description: 'D', category: 'Cultura', rewardCoins: 10,
      sectorId: null, endsAt: new Date('2999-01-01'),
    })

    const vitrine = await listMyChallenges(member)
    expect(vitrine.map((v) => v.challenge.title)).toEqual(['Em aberto'])
  })

  it('desafio com startsAt no futuro não aparece na vitrine', async () => {
    await createChallenge(adminActor(admin.id), {
      title: 'Ainda não começou', description: 'D', category: 'Cultura', rewardCoins: 10,
      sectorId: null, startsAt: new Date('2999-01-01'),
    })

    expect(await listMyChallenges(member)).toEqual([])
  })

  it('privado continua acessível pelo detalhe para quem está no escopo', async () => {
    const privado = await createChallenge(adminActor(admin.id), {
      title: 'Privado', description: 'D', category: 'Cultura',
      rewardCoins: 10, isPrivate: true, sectorId: null,
    })

    const found = await getVisibleChallenge(member, privado.id)
    expect(found.title).toBe('Privado')
  })

  it('reordenar muda a ordem da vitrine', async () => {
    const a = await createChallenge(adminActor(admin.id), {
      title: 'A', description: 'D', category: 'Cultura', rewardCoins: 10, sectorId: null,
    })
    const b = await createChallenge(adminActor(admin.id), {
      title: 'B', description: 'D', category: 'Cultura', rewardCoins: 10, sectorId: null,
    })

    await reorderChallenges(adminActor(admin.id), [b.id, a.id])

    const vitrine = await listMyChallenges(member)
    expect(vitrine.map((v) => v.challenge.title)).toEqual(['B', 'A'])
  })

  it('SUBADMIN não reordena desafio de fora do setor', async () => {
    const alheio = await createChallenge(adminActor(admin.id), {
      title: 'Alheio', description: 'D', category: 'Cultura',
      rewardCoins: 10, sectorId: OTHER_SECTOR_ID,
    })

    await expect(reorderChallenges(actor, [alheio.id])).rejects.toMatchObject({ status: 403 })
  })
})

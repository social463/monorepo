import { describe, it, expect } from 'vitest'
import { DEFAULT_COMPANY_ID, DEFAULT_SECTOR_ID, USER_IMPORT_MAX_ROWS } from '@legends/shared'
import { prisma } from '../lib/prisma'
import { verifyPassword } from '../lib/password'
import {
  buildImportTemplate,
  commitUserImport,
  previewUserImport,
  UserImportError,
  type UserImportActor,
} from './user-import-service'

const HEADER = 'Nome;E-mail;Cargo;Setor;Squad;Papel;Área;Líder (e-mail);Na equipe desde;Data de nascimento'

function csv(...lines: string[]): Buffer {
  return Buffer.from(`﻿${[HEADER, ...lines].join('\r\n')}\r\n`, 'utf8')
}

async function admin(): Promise<UserImportActor> {
  const user = await prisma.user.create({
    data: { name: 'Admin', email: 'admin@empresa.com', passwordHash: 'x', role: 'ADMIN' },
  })
  return { id: user.id, role: 'ADMIN', sectorId: user.sectorId, companyId: DEFAULT_COMPANY_ID }
}

async function sector(name: string, roles: ('LEGEND' | 'LEAD' | 'MANAGER' | 'HEAD')[] = ['LEGEND']) {
  return prisma.sector.create({
    data: {
      name,
      slug: name.toLowerCase(),
      enabledFeatures: ['escritorio'],
      roles: { create: roles.map((role) => ({ role })) },
    },
  })
}

describe('buildImportTemplate', () => {
  it('sai com BOM, cabeçalho na ordem do contrato e uma linha de exemplo', () => {
    const template = buildImportTemplate()
    expect(template.startsWith('﻿')).toBe(true)
    const [header, example] = template.slice(1).trimEnd().split('\r\n')
    expect(header).toBe(HEADER)
    expect(example.split(';')[1]).toBe('maria.souza@empresa.com.br')
  })

  it('é aceito de volta pela própria importação, sem edição nenhuma', async () => {
    const actor = await admin()
    const preview = await previewUserImport(actor, Buffer.from(buildImportTemplate(), 'utf8'))
    expect(preview.blocked).toBe(false)
    expect(preview.counts.CREATE).toBe(1)
    expect(preview.plan.sectorsToCreate.map((s) => s.name)).toEqual(['Dados'])
  })
})

describe('previewUserImport', () => {
  it('não grava nada', async () => {
    const actor = await admin()
    await sector('Dados')
    const antes = await prisma.user.count()
    const preview = await previewUserImport(
      actor,
      csv('Ana;ana@x.com;Dev;Dados;;;;;;', 'Bia;bia@x.com;Dev;Dados;;;;;;', 'Caio;caio@x.com;Dev;Dados;;;;;;'),
    )
    expect(preview.counts.CREATE).toBe(3)
    expect(await prisma.user.count()).toBe(antes)
  })

  it('recusa planilha sem coluna obrigatória', async () => {
    const actor = await admin()
    const semSetor = Buffer.from('Nome;E-mail\nAna;ana@x.com\n', 'utf8')
    await expect(previewUserImport(actor, semSetor)).rejects.toThrow(/não tem a coluna "Setor"/)
  })

  it('recusa coluna repetida', async () => {
    const actor = await admin()
    const repetida = Buffer.from('Nome;E-mail;E-mail;Setor\nAna;a@x.com;b@x.com;Dados\n', 'utf8')
    await expect(previewUserImport(actor, repetida)).rejects.toThrow(/aparece duas vezes/)
  })

  it('avisa que Situação e Desligado em foram ignoradas', async () => {
    const actor = await admin()
    await sector('Dados')
    const comExtras = Buffer.from(
      'Nome;E-mail;Setor;Situação;Desligado em\nAna;ana@x.com;Dados;Ativa;\n',
      'utf8',
    )
    const preview = await previewUserImport(actor, comExtras)
    expect(preview.warnings.join(' ')).toMatch(/nunca desliga nem reativa/)
    expect(preview.blocked).toBe(false)
  })

  it('aponta e-mail repetido citando as duas linhas', async () => {
    const actor = await admin()
    await sector('Dados')
    const preview = await previewUserImport(actor, csv('Ana;ana@x.com;;Dados;;;;;;', 'Ana 2;ana@x.com;;Dados;;;;;;'))
    expect(preview.blocked).toBe(true)
    expect(preview.rows[0].issues[0].message).toMatch(/linhas 2 e 3/)
  })

  it('recusa papel administrativo', async () => {
    const actor = await admin()
    await sector('Dados')
    const preview = await previewUserImport(actor, csv('Ana;ana@x.com;;Dados;;Admin;;;;'))
    expect(preview.rows[0].issues[0].message).toMatch(/não cria nem altera contas de administrador/)
  })

  it('recusa papel não habilitado no setor que já existe', async () => {
    const actor = await admin()
    await sector('Dados', ['LEGEND'])
    const preview = await previewUserImport(actor, csv('Ana;ana@x.com;;Dados;;Head;;;;'))
    expect(preview.rows[0].issues[0].message).toMatch(/não está habilitado para o setor/)
  })

  it('planeja o setor novo com os papéis que a planilha usa', async () => {
    const actor = await admin()
    const preview = await previewUserImport(actor, csv('Ana;ana@x.com;;Comercial;;Head;;;;'))
    expect(preview.blocked).toBe(false)
    expect(preview.plan.sectorsToCreate).toEqual([{ name: 'Comercial', roles: expect.arrayContaining(['LEGEND', 'HEAD']) }])
  })

  it('soma os papéis de todas as linhas de um setor novo, não só o da primeira', async () => {
    // Regressão: a segunda linha de um setor que a própria planilha cria era
    // validada contra os papéis já acumulados e reprovada como "papel não
    // habilitado" — o setor ainda nem existe, quem manda é o arquivo inteiro.
    const actor = await admin()
    const preview = await previewUserImport(
      actor,
      csv(
        'Ana;ana@x.com;;Comercial;;Head;;;;',
        'Bruno;bruno@x.com;;Comercial;;Gerente;;;;',
        'Caio;caio@x.com;;Comercial;;Lenda;;;;',
      ),
    )
    expect(preview.rows.flatMap((row) => row.issues)).toEqual([])
    expect(preview.blocked).toBe(false)
    expect(preview.counts.CREATE).toBe(3)
    expect(preview.plan.sectorsToCreate[0].roles.sort()).toEqual(['HEAD', 'LEGEND', 'MANAGER'])
  })

  it('não deixa erro de papel derrubar quem aponta a pessoa como líder', async () => {
    // O efeito cascata do mesmo bug: com o líder marcado como ERROR, ele saía do
    // grafo e as linhas lideradas por ele viravam "líder não encontrado".
    const actor = await admin()
    const preview = await previewUserImport(
      actor,
      csv(
        'Ana;ana@x.com;;Comercial;;Head;;;;',
        'Bruno;bruno@x.com;;Comercial;;Gerente;;ana@x.com;;',
        'Caio;caio@x.com;;Comercial;;Lenda;;bruno@x.com;;',
      ),
    )
    expect(preview.rows.flatMap((row) => row.issues)).toEqual([])
  })

  it('recusa setor cujo identificador já é de outra empresa', async () => {
    const actor = await admin()
    const outra = await prisma.company.create({ data: { name: 'Outra', slug: 'outra' } })
    await prisma.sector.create({ data: { name: 'Comercial', slug: 'comercial', companyId: outra.id } })
    const preview = await previewUserImport(actor, csv('Ana;ana@x.com;;Comercial;;;;;;'))
    expect(preview.rows[0].issues[0].message).toMatch(/já está em uso na plataforma/)
  })

  it('recusa nome de setor sem letra nem número', async () => {
    const actor = await admin()
    const preview = await previewUserImport(actor, csv('Ana;ana@x.com;;!!!;;;;;;'))
    expect(preview.rows[0].issues[0].message).toMatch(/ao menos uma letra ou número/)
  })

  it('recusa e-mail que já existe em outra empresa', async () => {
    const actor = await admin()
    await sector('Dados')
    const outra = await prisma.company.create({ data: { name: 'Outra', slug: 'outra' } })
    await prisma.user.create({
      data: { name: 'Ana Alheia', email: 'ana@x.com', passwordHash: 'x', companyId: outra.id },
    })
    const preview = await previewUserImport(actor, csv('Ana;ana@x.com;;Dados;;;;;;'))
    expect(preview.rows[0].issues[0].message).toMatch(/outra empresa/)
  })

  it('não mexe em conta administrativa nem em terceirizado', async () => {
    const actor = await admin()
    await sector('Dados')
    await prisma.user.create({ data: { name: 'Sub', email: 'sub@x.com', passwordHash: 'x', role: 'SUBADMIN' } })
    await prisma.user.create({ data: { name: 'Ter', email: 'ter@x.com', passwordHash: 'x', role: 'THIRD_PARTY' } })
    const preview = await previewUserImport(actor, csv('Sub;sub@x.com;;Dados;;;;;;', 'Ter;ter@x.com;;Dados;;;;;;'))
    expect(preview.rows[0].issues[0].message).toMatch(/conta de administrador/)
    expect(preview.rows[1].issues[0].message).toMatch(/conta de terceirizado/)
  })

  it('marca pessoa desligada como ignorada, sem travar o arquivo', async () => {
    const actor = await admin()
    const dados = await sector('Dados')
    await prisma.user.create({
      data: { name: 'Ex', email: 'ex@x.com', passwordHash: 'x', sectorId: dados.id, leftAt: new Date() },
    })
    const preview = await previewUserImport(actor, csv('Ex;ex@x.com;Dev;Dados;;;;;;'))
    expect(preview.blocked).toBe(false)
    expect(preview.counts.SKIP).toBe(1)
    expect(preview.rows[0].changes[0]).toMatch(/desligada/)
  })

  it('recusa data inválida e data de nascimento no futuro', async () => {
    const actor = await admin()
    await sector('Dados')
    const preview = await previewUserImport(
      actor,
      csv('Ana;ana@x.com;;Dados;;;;;31/02/2026;', 'Bia;bia@x.com;;Dados;;;;;;01/01/2999'),
    )
    expect(preview.rows[0].issues[0].message).toMatch(/Data inválida/)
    expect(preview.rows[1].issues[0].message).toMatch(/futuro|intervalo/)
  })

  it('aceita líder que só existe na própria planilha e recusa ciclo', async () => {
    const actor = await admin()
    await sector('Dados', ['LEGEND', 'HEAD'])
    const ok = await previewUserImport(
      actor,
      csv('Ana;ana@x.com;;Dados;;Head;;;;', 'Bia;bia@x.com;;Dados;;Lenda;;ana@x.com;;'),
    )
    expect(ok.blocked).toBe(false)

    const ciclo = await previewUserImport(
      actor,
      csv('Ana;ana@x.com;;Dados;;Head;;bia@x.com;;', 'Bia;bia@x.com;;Dados;;Head;;ana@x.com;;'),
    )
    expect(ciclo.blocked).toBe(true)
    expect(ciclo.rows.flatMap((r) => r.issues).some((i) => /ciclo/.test(i.message))).toBe(true)
  })

  it('recusa líder inexistente', async () => {
    const actor = await admin()
    await sector('Dados')
    const preview = await previewUserImport(actor, csv('Ana;ana@x.com;;Dados;;;;fantasma@x.com;;'))
    expect(preview.rows[0].issues[0].message).toMatch(/Líder direto não encontrado/)
  })

  it('recusa squad que já pertence a outro setor', async () => {
    const actor = await admin()
    const dados = await sector('Dados')
    await sector('Comercial')
    await prisma.squad.create({ data: { name: 'Insights', slug: 'insights', sectorId: dados.id } })
    const preview = await previewUserImport(actor, csv('Ana;ana@x.com;;Comercial;Insights;;;;;'))
    expect(preview.rows[0].issues[0].message).toMatch(/pertence a um setor só/)
  })

  it('recusa a mesma squad nova em dois setores', async () => {
    const actor = await admin()
    await sector('Dados')
    await sector('Comercial')
    const preview = await previewUserImport(
      actor,
      csv('Ana;ana@x.com;;Dados;Insights;;;;;', 'Bia;bia@x.com;;Comercial;Insights;;;;;'),
    )
    expect(preview.blocked).toBe(true)
    expect(preview.rows[0].issues[0].message).toMatch(/dois setores/)
  })

  it('recusa mudança de setor de quem está numa squad do setor atual', async () => {
    const actor = await admin()
    const dados = await sector('Dados')
    await sector('Comercial')
    const ana = await prisma.user.create({
      data: { name: 'Ana', email: 'ana@x.com', passwordHash: 'x', sectorId: dados.id },
    })
    const squad = await prisma.squad.create({ data: { name: 'Insights', slug: 'insights', sectorId: dados.id } })
    await prisma.squadMember.create({ data: { squadId: squad.id, userId: ana.id } })
    const preview = await previewUserImport(actor, csv('Ana;ana@x.com;;Comercial;;;;;;'))
    expect(preview.rows[0].issues[0].message).toMatch(/Tire-a da squad/)
  })

  // O setor que a planilha ainda vai criar não tem id. Enquanto isso contava
  // como "não mudou de setor", o movimento sumia da revisão e a checagem de
  // squad era pulada — mas o commit gravava o setor novo assim mesmo.
  it('mostra a mudança para um setor que a própria planilha cria', async () => {
    const actor = await admin()
    const dados = await sector('Dados')
    await prisma.user.create({ data: { name: 'Ana', email: 'ana@x.com', passwordHash: 'x', sectorId: dados.id } })

    const preview = await previewUserImport(actor, csv('Ana;ana@x.com;;Comercial;;;;;;'))

    expect(preview.rows[0].action).toBe('UPDATE')
    expect(preview.rows[0].changes).toContain('Setor: "Dados" → "Comercial"')
  })

  it('recusa mudança para setor novo de quem está numa squad do setor atual', async () => {
    const actor = await admin()
    const dados = await sector('Dados')
    const ana = await prisma.user.create({
      data: { name: 'Ana', email: 'ana@x.com', passwordHash: 'x', sectorId: dados.id },
    })
    const squad = await prisma.squad.create({ data: { name: 'Insights', slug: 'insights', sectorId: dados.id } })
    await prisma.squadMember.create({ data: { squadId: squad.id, userId: ana.id } })

    const preview = await previewUserImport(actor, csv('Ana;ana@x.com;;Comercial;;;;;;'))

    expect(preview.rows[0].issues[0].message).toMatch(/Tire-a da squad/)
  })

  // Papel em branco quer dizer "não mexe". Validar o default `LEGEND` contra o
  // setor recusava quem já é MANAGER num setor que não habilita Lenda, sem que
  // papel nenhum fosse mudar — e travava o arquivo inteiro.
  it('não valida o papel contra o setor quando a coluna vem vazia', async () => {
    const actor = await admin()
    const dados = await sector('Dados', ['MANAGER'])
    await prisma.user.create({
      data: { name: 'Ana', email: 'ana@x.com', passwordHash: 'x', sectorId: dados.id, role: 'MANAGER' },
    })

    const preview = await previewUserImport(actor, csv('Ana;ana@x.com;Gerente de Dados;Dados;;;;;;'))

    expect(preview.blocked).toBe(false)
    expect(preview.rows[0].changes).toEqual(['Cargo: "" → "Gerente de Dados"'])
  })

  it('setor novo nasce com o papel de quem já existe, mesmo sem a coluna Papel', async () => {
    const actor = await admin()
    const dados = await sector('Dados', ['LEGEND', 'HEAD'])
    await prisma.user.create({
      data: { name: 'Ana', email: 'ana@x.com', passwordHash: 'x', sectorId: dados.id, role: 'HEAD' },
    })

    const preview = await previewUserImport(actor, csv('Ana;ana@x.com;;Comercial;;;;;;'))

    expect(preview.plan.sectorsToCreate).toEqual([{ name: 'Comercial', roles: expect.arrayContaining(['HEAD']) }])
  })

  it('lista a troca de líder direto mesmo quando a linha já mudava outra coisa', async () => {
    const actor = await admin()
    const dados = await sector('Dados', ['LEGEND', 'MANAGER'])
    await prisma.user.create({
      data: { name: 'Bia', email: 'bia@x.com', passwordHash: 'x', sectorId: dados.id, role: 'MANAGER' },
    })
    await prisma.user.create({ data: { name: 'Ana', email: 'ana@x.com', passwordHash: 'x', sectorId: dados.id } })

    const preview = await previewUserImport(actor, csv('Ana;ana@x.com;Dev;Dados;;;;bia@x.com;;'))

    expect(preview.rows[0].changes).toEqual(['Cargo: "" → "Dev"', 'Líder direto'])
  })

  it('lista o líder direto que nasce na própria planilha', async () => {
    const actor = await admin()
    const dados = await sector('Dados', ['LEGEND', 'MANAGER'])
    await prisma.user.create({ data: { name: 'Ana', email: 'ana@x.com', passwordHash: 'x', sectorId: dados.id } })

    const preview = await previewUserImport(
      actor,
      csv('Ana;ana@x.com;Dev;Dados;;;;bia@x.com;;', 'Bia;bia@x.com;;Dados;;Gerente;;;;'),
    )

    expect(preview.rows[0].changes).toContain('Líder direto')
  })

  it('recusa planilha acima do limite de linhas', async () => {
    const actor = await admin()
    await sector('Dados')
    const linhas = Array.from({ length: USER_IMPORT_MAX_ROWS + 1 }, (_, i) => `P${i};p${i}@x.com;;Dados;;;;;;`)
    await expect(previewUserImport(actor, csv(...linhas))).rejects.toThrow(/o limite é 200/)
  })
})

describe('commitUserImport', () => {
  it('cria as pessoas e devolve as credenciais uma vez (AC 1)', async () => {
    const actor = await admin()
    await sector('Dados')
    const buffer = csv('Ana;ana@x.com;Dev;Dados;;;;;01/02/2026;', 'Bia;bia@x.com;QA;Dados;;;;;;')
    const preview = await previewUserImport(actor, buffer)
    const result = await commitUserImport(actor, buffer, preview.fileHash)

    expect(result.created).toBe(2)
    expect(result.credentials).toHaveLength(2)
    const ana = await prisma.user.findUnique({ where: { email: 'ana@x.com' } })
    expect(ana?.position).toBe('Dev')
    expect(ana?.joinedAt.toISOString().slice(0, 10)).toBe('2026-02-01')
    const senha = result.credentials.find((c) => c.email === 'ana@x.com')!.password
    expect(await verifyPassword(senha, ana!.passwordHash)).toBe(true)
  })

  it('não cria nada pela metade quando uma linha tem erro (AC 2)', async () => {
    const actor = await admin()
    await sector('Dados')
    const buffer = csv('Ana;ana@x.com;;Dados;;;;;;', 'Sem e-mail;;;Dados;;;;;;', 'Caio;caio@x.com;;Dados;;;;;;')
    const preview = await previewUserImport(actor, buffer)
    const antes = await prisma.user.count()
    await expect(commitUserImport(actor, buffer, preview.fileHash)).rejects.toMatchObject({ status: 422 })
    expect(await prisma.user.count()).toBe(antes)
  })

  it('reimportar o mesmo arquivo não duplica ninguém (AC 3)', async () => {
    const actor = await admin()
    await sector('Dados')
    const buffer = csv('Ana;ana@x.com;Dev;Dados;;;;;;', 'Bia;bia@x.com;QA;Dados;;;;;;')
    const primeira = await previewUserImport(actor, buffer)
    await commitUserImport(actor, buffer, primeira.fileHash)
    const depois = await prisma.user.count()

    const segunda = await previewUserImport(actor, buffer)
    expect(segunda.counts.UNCHANGED).toBe(2)
    const result = await commitUserImport(actor, buffer, segunda.fileHash)
    expect(result.created).toBe(0)
    expect(result.unchanged).toBe(2)
    expect(result.credentials).toHaveLength(0)
    expect(await prisma.user.count()).toBe(depois)
  })

  it('atualiza campo preenchido e nunca limpa com célula vazia', async () => {
    const actor = await admin()
    const dados = await sector('Dados')
    await prisma.user.create({
      data: { name: 'Ana', email: 'ana@x.com', passwordHash: 'x', sectorId: dados.id, position: 'Dev', area: 'PRODUCT' },
    })
    const buffer = csv('Ana Souza;ana@x.com;;Dados;;;;;;')
    const preview = await previewUserImport(actor, buffer)
    await commitUserImport(actor, buffer, preview.fileHash)

    const ana = await prisma.user.findUnique({ where: { email: 'ana@x.com' } })
    expect(ana?.name).toBe('Ana Souza')
    expect(ana?.position).toBe('Dev')
    expect(ana?.area).toBe('PRODUCT')
  })

  it('nunca reseta a senha de quem já existe', async () => {
    const actor = await admin()
    const dados = await sector('Dados')
    const antes = await prisma.user.create({
      data: { name: 'Ana', email: 'ana@x.com', passwordHash: 'hash-original', sectorId: dados.id },
    })
    const buffer = csv('Ana Nova;ana@x.com;;Dados;;;;;;')
    const preview = await previewUserImport(actor, buffer)
    await commitUserImport(actor, buffer, preview.fileHash)
    const depois = await prisma.user.findUnique({ where: { id: antes.id } })
    expect(depois?.passwordHash).toBe('hash-original')
  })

  it('cria o setor novo com Escritório e com os papéis usados', async () => {
    const actor = await admin()
    const buffer = csv('Ana;ana@x.com;;Comercial;;Head;;;;')
    const preview = await previewUserImport(actor, buffer)
    const result = await commitUserImport(actor, buffer, preview.fileHash)

    expect(result.sectorsCreated).toEqual(['Comercial'])
    const criado = await prisma.sector.findFirst({ where: { slug: 'comercial' }, include: { roles: true } })
    expect(criado?.enabledFeatures).toEqual(['escritorio'])
    expect(criado?.roles.map((r) => r.role).sort()).toEqual(['HEAD', 'LEGEND'])
  })

  it('move quem já existe para o setor novo, do jeito que a pré-visualização disse', async () => {
    const actor = await admin()
    const dados = await sector('Dados')
    await prisma.user.create({ data: { name: 'Ana', email: 'ana@x.com', passwordHash: 'x', sectorId: dados.id } })
    const buffer = csv('Ana;ana@x.com;;Comercial;;;;;;')
    const preview = await previewUserImport(actor, buffer)
    const result = await commitUserImport(actor, buffer, preview.fileHash)

    expect(result.updated).toBe(1)
    const comercial = await prisma.sector.findFirst({ where: { slug: 'comercial' } })
    const ana = await prisma.user.findUnique({ where: { email: 'ana@x.com' } })
    expect(ana?.sectorId).toBe(comercial!.id)
  })

  it('cria a squad, o vínculo e o campo de texto do usuário', async () => {
    const actor = await admin()
    await sector('Dados')
    const buffer = csv('Ana;ana@x.com;;Dados;Squad Insights;;;;;')
    const preview = await previewUserImport(actor, buffer)
    const result = await commitUserImport(actor, buffer, preview.fileHash)

    expect(result.squadsCreated).toEqual(['Squad Insights'])
    const ana = await prisma.user.findUnique({ where: { email: 'ana@x.com' } })
    expect(ana?.squad).toBe('Squad Insights')
    const membros = await prisma.squadMember.findMany({ where: { userId: ana!.id }, include: { squad: true } })
    expect(membros.map((m) => m.squad.name)).toEqual(['Squad Insights'])
  })

  it('amarra o líder que nasce na própria planilha', async () => {
    const actor = await admin()
    await sector('Dados', ['LEGEND', 'HEAD'])
    const buffer = csv('Ana;ana@x.com;;Dados;;Head;;;;', 'Bia;bia@x.com;;Dados;;Lenda;;ana@x.com;;')
    const preview = await previewUserImport(actor, buffer)
    await commitUserImport(actor, buffer, preview.fileHash)

    const ana = await prisma.user.findUnique({ where: { email: 'ana@x.com' } })
    const bia = await prisma.user.findUnique({ where: { email: 'bia@x.com' } })
    expect(bia?.managerId).toBe(ana?.id)
  })

  it('recusa confirmação de arquivo diferente do pré-visualizado', async () => {
    const actor = await admin()
    await sector('Dados')
    const buffer = csv('Ana;ana@x.com;;Dados;;;;;;')
    await expect(commitUserImport(actor, buffer, 'f'.repeat(64))).rejects.toMatchObject({ status: 409 })
    expect(await prisma.user.count()).toBe(1) // só o admin
  })

  it('não deixa senha nem no log de auditoria', async () => {
    const actor = await admin()
    await sector('Dados')
    const buffer = csv('Ana;ana@x.com;;Dados;;;;;;')
    const preview = await previewUserImport(actor, buffer)
    const result = await commitUserImport(actor, buffer, preview.fileHash)

    const logs = await prisma.adminAuditLog.findMany()
    const serializado = JSON.stringify(logs)
    expect(serializado).not.toContain(result.credentials[0].password)
    expect(serializado).not.toContain('passwordHash')
    expect(logs.some((log) => log.entityType === 'UserImport')).toBe(true)
  })

  it('grava o e-mail em minúsculas para o login funcionar', async () => {
    const actor = await admin()
    await sector('Dados')
    const buffer = csv('Ana;ANA@X.com;;Dados;;;;;;')
    const preview = await previewUserImport(actor, buffer)
    await commitUserImport(actor, buffer, preview.fileHash)
    expect(await prisma.user.findUnique({ where: { email: 'ana@x.com' } })).not.toBeNull()
  })

  it('reconhece quem já existe mesmo com o e-mail em caixa diferente', async () => {
    const actor = await admin()
    const dados = await sector('Dados')
    await prisma.user.create({
      data: { name: 'Ana', email: 'Ana@X.com', passwordHash: 'x', sectorId: dados.id },
    })
    const preview = await previewUserImport(actor, csv('Ana;ana@x.com;;Dados;;;;;;'))
    expect(preview.counts.CREATE).toBe(0)
    expect(preview.counts.UNCHANGED).toBe(1)
  })
})

describe('commitUserImport como subadmin', () => {
  async function subadmin(sectorId: string): Promise<UserImportActor> {
    const user = await prisma.user.create({
      data: { name: 'Sub', email: 'sub@empresa.com', passwordHash: 'x', role: 'SUBADMIN', sectorId },
    })
    return { id: user.id, role: 'SUBADMIN', sectorId, companyId: DEFAULT_COMPANY_ID }
  }

  it('usa o próprio setor quando a coluna vem vazia', async () => {
    const dados = await sector('Dados')
    const actor = await subadmin(dados.id)
    const preview = await previewUserImport(actor, csv('Ana;ana@x.com;;;;;;;;'))
    expect(preview.blocked).toBe(false)
    expect(preview.rows[0].sectorName).toBe('Dados')
  })

  it('recusa linha de outro setor', async () => {
    const dados = await sector('Dados')
    await sector('Comercial')
    const actor = await subadmin(dados.id)
    const preview = await previewUserImport(actor, csv('Ana;ana@x.com;;Comercial;;;;;;'))
    expect(preview.rows[0].issues[0].message).toMatch(/Você só importa pessoas para o setor "Dados"/)
  })

  it('não cria setor novo', async () => {
    const dados = await sector('Dados')
    const actor = await subadmin(dados.id)
    const preview = await previewUserImport(actor, csv('Ana;ana@x.com;;Novo;;;;;;'))
    expect(preview.rows[0].issues[0].message).toMatch(/Só o Admin cria setores novos/)
  })

  it('recusa mexer em pessoa de outro setor', async () => {
    const dados = await sector('Dados')
    const comercial = await sector('Comercial')
    const actor = await subadmin(dados.id)
    await prisma.user.create({
      data: { name: 'Ana', email: 'ana@x.com', passwordHash: 'x', sectorId: comercial.id },
    })
    const preview = await previewUserImport(actor, csv('Ana;ana@x.com;;Dados;;;;;;'))
    expect(preview.rows[0].issues[0].message).toMatch(/Esta pessoa é de outro setor/)
  })
})

describe('UserImportError', () => {
  it('carrega status e issues para a rota traduzir', () => {
    const err = new UserImportError('x', 422, [{ line: 2, column: 'Nome', message: 'y' }])
    expect(err.status).toBe(422)
    expect(err.issues).toHaveLength(1)
  })
})

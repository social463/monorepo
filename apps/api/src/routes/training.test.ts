import { beforeEach, describe, expect, it } from 'vitest'
import { TRAINING_DEFAULT_SLA_DAYS } from '@legends/shared'
import { buildApp } from '../app'
import { signAccessToken } from '../lib/jwt'
import { prisma } from '../lib/prisma'

let app: Awaited<ReturnType<typeof buildApp>>

beforeEach(async () => {
  app = buildApp()
  await app.ready()
})

async function criarUsuario(
  email: string,
  overrides: Partial<Parameters<typeof prisma.user.create>[0]['data']> = {},
) {
  return prisma.user.create({
    data: {
      name: 'Fulana de Tal',
      email,
      passwordHash: 'x',
      position: 'Analista de CRM',
      positionCategory: 'Analista',
      squad: 'Squad Alfa',
      ...overrides,
    } as Parameters<typeof prisma.user.create>[0]['data'],
  })
}

function authOf(user: Awaited<ReturnType<typeof criarUsuario>>, features: string[] = []) {
  return { authorization: `Bearer ${signAccessToken(app, user, features)}` }
}

const REGISTRO = {
  courseTitle: 'Gestão de Produto na Prática',
  learningType: 'Curso',
  modality: 'Online gravado',
  hours: 12.5,
  institution: 'PM3',
  sponsor: 'EMR' as const,
  investmentCents: 50_000,
  reasons: ['PDI' as const],
  completionDate: '2026-03-20',
  requestDate: '2026-01-10',
}

describe('registro de treinamento pelo colaborador', () => {
  it('grava com o snapshot da identidade e nasce aguardando validação', async () => {
    const lider = await criarUsuario('lider-td@empresa.com', { name: 'Líder Lima' })
    const pessoa = await criarUsuario('pessoa-td@empresa.com', { managerId: lider.id })

    const res = await app.inject({
      method: 'POST',
      url: '/training/records',
      headers: authOf(pessoa),
      payload: REGISTRO,
    })

    expect(res.statusCode).toBe(201)
    const registro = res.json()
    expect(registro.validationStatus).toBe('PENDING')
    expect(registro.source).toBe('Autoatendimento do colaborador')
    // Snapshot: o que vale é quem a pessoa era no momento da escrita.
    expect(registro.userName).toBe('Fulana de Tal')
    expect(registro.leaderName).toBe('Líder Lima')
    expect(registro.squad).toBe('Squad Alfa')
    expect(registro.positionCategory).toBe('Analista')
    // Derivados, nunca guardados.
    expect(registro.year).toBe(2026)
    expect(registro.quarter).toBe('T1')
    expect(registro.semester).toBe('1º semestre')
    expect(registro.slaDays).toBe(69)
    expect(registro.slaStatus).toBe('Dentro do SLA')
  })

  it('mudar de setor não reescreve o treinamento antigo', async () => {
    await prisma.sector.upsert({
      where: { id: 'setor-origem' },
      create: { id: 'setor-origem', name: 'Operações', slug: 'operacoes' },
      update: {},
    })
    await prisma.sector.upsert({
      where: { id: 'setor-destino' },
      create: { id: 'setor-destino', name: 'Gente e Gestão', slug: 'gente-gestao-td' },
      update: {},
    })
    const pessoa = await criarUsuario('muda-setor-td@empresa.com', { sectorId: 'setor-origem' })

    const criado = await app.inject({
      method: 'POST', url: '/training/records', headers: authOf(pessoa), payload: REGISTRO,
    })
    expect(criado.json().sectorName).toBe('Operações')

    await prisma.user.update({ where: { id: pessoa.id }, data: { sectorId: 'setor-destino' } })

    const meus = await app.inject({ method: 'GET', url: '/training/me', headers: authOf(pessoa) })
    expect(meus.json().records[0].sectorName).toBe('Operações')
  })

  it('guarda o investimento só quando quem pagou foi a empresa', async () => {
    const pessoa = await criarUsuario('sem-patrocinio-td@empresa.com')

    const res = await app.inject({
      method: 'POST',
      url: '/training/records',
      headers: authOf(pessoa),
      payload: { ...REGISTRO, sponsor: 'PROPRIO', investmentCents: 50_000 },
    })
    expect(res.json().investmentCents).toBe(0)
  })

  it('recusa mais de dois motivos', async () => {
    const pessoa = await criarUsuario('motivos-td@empresa.com')
    const res = await app.inject({
      method: 'POST',
      url: '/training/records',
      headers: authOf(pessoa),
      payload: { ...REGISTRO, reasons: ['PDI', 'LNT', 'OBRIGATORIO'] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('o resumo do ano conta só o que a G&G validou', async () => {
    const pessoa = await criarUsuario('resumo-td@empresa.com')
    const ano = new Date().getUTCFullYear()

    await app.inject({
      method: 'POST', url: '/training/records', headers: authOf(pessoa),
      payload: { ...REGISTRO, completionDate: `${ano}-02-10`, requestDate: `${ano}-01-02` },
    })

    const pendente = await app.inject({ method: 'GET', url: '/training/me', headers: authOf(pessoa) })
    expect(pendente.json().yearHours).toBe(0)

    await prisma.trainingRecord.updateMany({ where: { userId: pessoa.id }, data: { validationStatus: 'APPROVED' } })

    const validado = await app.inject({ method: 'GET', url: '/training/me', headers: authOf(pessoa) })
    expect(validado.json().yearHours).toBe(12.5)
    expect(validado.json().yearTrainings).toBe(1)
  })
})

describe('edição do próprio registro', () => {
  async function registroDe(email: string) {
    const pessoa = await criarUsuario(email)
    const criado = await app.inject({
      method: 'POST', url: '/training/records', headers: authOf(pessoa), payload: REGISTRO,
    })
    return { pessoa, id: criado.json().id as string }
  }

  it('o dono edita enquanto a G&G não avaliou', async () => {
    const { pessoa, id } = await registroDe('edita-td@empresa.com')

    const res = await app.inject({
      method: 'PATCH', url: `/training/records/${id}`, headers: authOf(pessoa),
      payload: { hours: 20 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().hours).toBe(20)
  })

  it('depois de validado, o dono não mexe mais (409)', async () => {
    const { pessoa, id } = await registroDe('travado-td@empresa.com')
    await prisma.trainingRecord.update({ where: { id }, data: { validationStatus: 'APPROVED' } })

    const res = await app.inject({
      method: 'PATCH', url: `/training/records/${id}`, headers: authOf(pessoa), payload: { hours: 99 },
    })
    expect(res.statusCode).toBe(409)
  })

  it('corrigir um registro recusado devolve ele para a fila', async () => {
    const { pessoa, id } = await registroDe('recusado-td@empresa.com')
    await prisma.trainingRecord.update({
      where: { id },
      data: { validationStatus: 'REJECTED', rejectionReason: 'Certificado ilegível' },
    })

    const res = await app.inject({
      method: 'PATCH', url: `/training/records/${id}`, headers: authOf(pessoa), payload: { hours: 10 },
    })
    expect(res.json().validationStatus).toBe('PENDING')
    expect(res.json().rejectionReason).toBeNull()
  })

  it('registro de outra pessoa responde 404, nunca 403', async () => {
    const { id } = await registroDe('dono-td@empresa.com')
    const intruso = await criarUsuario('intruso-td@empresa.com')

    const res = await app.inject({
      method: 'PATCH', url: `/training/records/${id}`, headers: authOf(intruso), payload: { hours: 1 },
    })
    expect(res.statusCode).toBe(404)
  })

  it('só o T&D muda a situação de participação', async () => {
    const { pessoa, id } = await registroDe('participacao-td@empresa.com')

    const res = await app.inject({
      method: 'PATCH', url: `/training/records/${id}`, headers: authOf(pessoa),
      payload: { participationStatus: 'Inscrito' },
    })
    expect(res.statusCode).toBe(403)
  })
})

describe('guarda do bloco de Gente e Gestão', () => {
  it('LEGEND não entra na Central', async () => {
    const pessoa = await criarUsuario('legend-central-td@empresa.com')
    const res = await app.inject({ method: 'GET', url: '/admin/training/records', headers: authOf(pessoa) })
    expect(res.statusCode).toBe(403)
  })

  it('SUBADMIN sem a feature do bloco também não', async () => {
    const subadmin = await criarUsuario('subadmin-sem-td@empresa.com', { role: 'SUBADMIN' })
    const res = await app.inject({ method: 'GET', url: '/admin/training/records', headers: authOf(subadmin) })
    expect(res.statusCode).toBe(403)
  })

  it('SUBADMIN com `gente-gestao` entra', async () => {
    const subadmin = await criarUsuario('subadmin-com-td@empresa.com', { role: 'SUBADMIN' })
    const res = await app.inject({
      method: 'GET', url: '/admin/training/records', headers: authOf(subadmin, ['gente-gestao']),
    })
    expect(res.statusCode).toBe(200)
  })
})

describe('Central de Treinamentos', () => {
  async function cenario() {
    const admin = await criarUsuario('admin-central-td@empresa.com', { role: 'ADMIN' })
    const pessoa = await criarUsuario('pessoa-central-td@empresa.com')
    await app.inject({ method: 'POST', url: '/training/records', headers: authOf(pessoa), payload: REGISTRO })
    return { admin, pessoa }
  }

  it('valida o registro e notifica quem enviou', async () => {
    const { admin, pessoa } = await cenario()
    const fila = await app.inject({ method: 'GET', url: '/admin/training/records', headers: authOf(admin) })
    expect(fila.json().pending).toBe(1)
    const id = fila.json().records[0].id

    const res = await app.inject({
      method: 'POST', url: `/admin/training/records/${id}/review`, headers: authOf(admin),
      payload: { status: 'APPROVED' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().validationStatus).toBe('APPROVED')
    expect(res.json().reviewedBy.id).toBe(admin.id)

    const avisos = await prisma.notification.findMany({ where: { userId: pessoa.id } })
    expect(avisos.map((a) => a.type)).toContain('TRAINING_VALIDATED')
  })

  it('recusar exige motivo', async () => {
    const { admin } = await cenario()
    const fila = await app.inject({ method: 'GET', url: '/admin/training/records', headers: authOf(admin) })
    const id = fila.json().records[0].id

    const semMotivo = await app.inject({
      method: 'POST', url: `/admin/training/records/${id}/review`, headers: authOf(admin),
      payload: { status: 'REJECTED' },
    })
    expect(semMotivo.statusCode).toBe(400)

    const comMotivo = await app.inject({
      method: 'POST', url: `/admin/training/records/${id}/review`, headers: authOf(admin),
      payload: { status: 'REJECTED', rejectionReason: 'Certificado ilegível' },
    })
    expect(comMotivo.json().rejectionReason).toBe('Certificado ilegível')
  })

  it('filtra por setor e por busca', async () => {
    const { admin } = await cenario()
    const outra = await criarUsuario('outra-central-td@empresa.com', { name: 'Outra Pessoa' })
    await app.inject({
      method: 'POST', url: '/training/records', headers: authOf(outra),
      payload: { ...REGISTRO, courseTitle: 'Inglês para negócios' },
    })

    const busca = await app.inject({
      method: 'GET', url: '/admin/training/records?search=ingl%C3%AAs', headers: authOf(admin),
    })
    expect(busca.json().total).toBe(1)
    expect(busca.json().records[0].courseTitle).toBe('Inglês para negócios')
  })

  it('o cadastro pelo T&D nasce validado', async () => {
    const admin = await criarUsuario('admin-cadastro-td@empresa.com', { role: 'ADMIN' })
    const pessoa = await criarUsuario('alvo-cadastro-td@empresa.com')

    const res = await app.inject({
      method: 'POST', url: '/admin/training/records', headers: authOf(admin),
      payload: { ...REGISTRO, userId: pessoa.id },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().validationStatus).toBe('APPROVED')
    expect(res.json().source).toBe('Cadastro pelo T&D')
  })

  it('exporta o recorte inteiro em CSV', async () => {
    const { admin } = await cenario()
    const res = await app.inject({ method: 'GET', url: '/admin/training/records.csv', headers: authOf(admin) })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.body).toContain('Gestão de Produto na Prática')
    expect(res.body.split('\n')[0]).toContain('Situação do SLA')
  })
})

describe('painel de T&D', () => {
  it('conta só o que foi validado, e a cobertura sai da população ativa', async () => {
    const admin = await criarUsuario('admin-painel-td@empresa.com', { role: 'ADMIN' })
    const pessoa = await criarUsuario('pessoa-painel-td@empresa.com')
    await criarUsuario('ninguem-painel-td@empresa.com')

    await app.inject({ method: 'POST', url: '/training/records', headers: authOf(pessoa), payload: REGISTRO })

    const pendente = await app.inject({ method: 'GET', url: '/admin/training/overview', headers: authOf(admin) })
    expect(pendente.json().kpis.participations).toBe(0)

    await prisma.trainingRecord.updateMany({ where: { userId: pessoa.id }, data: { validationStatus: 'APPROVED' } })

    const res = await app.inject({ method: 'GET', url: '/admin/training/overview', headers: authOf(admin) })
    const { kpis } = res.json()
    expect(kpis.participations).toBe(1)
    expect(kpis.people).toBe(1)
    expect(kpis.hours).toBe(12.5)
    expect(kpis.investmentCents).toBe(50_000)
    // 1 de 3 pessoas ativas (admin, pessoa e a que não fez nada).
    expect(kpis.totalCollaborators).toBe(3)
    expect(kpis.coverage).toBeCloseTo(33.3, 1)
    expect(res.json().slaDays).toBe(TRAINING_DEFAULT_SLA_DAYS)
  })

  it('o SLA da empresa muda o corte e fica gravado', async () => {
    const admin = await criarUsuario('admin-sla-td@empresa.com', { role: 'ADMIN' })
    const pessoa = await criarUsuario('pessoa-sla-td@empresa.com')
    await app.inject({ method: 'POST', url: '/training/records', headers: authOf(pessoa), payload: REGISTRO })
    await prisma.trainingRecord.updateMany({ where: { userId: pessoa.id }, data: { validationStatus: 'APPROVED' } })

    await app.inject({
      method: 'PUT', url: '/admin/training/settings', headers: authOf(admin), payload: { slaDays: 30 },
    })

    // 69 dias entre solicitar e concluir: dentro de 90, fora de 30.
    const res = await app.inject({ method: 'GET', url: '/admin/training/overview', headers: authOf(admin) })
    expect(res.json().slaDays).toBe(30)
    expect(res.json().kpis.pctInSla).toBe(0)

    const fora = await app.inject({
      method: 'GET', url: '/admin/training/records?sla=Fora+do+SLA', headers: authOf(admin),
    })
    expect(fora.json().total).toBe(1)
  })
})

describe('correção pelo T&D', () => {
  async function cenarioValidado() {
    const admin = await criarUsuario('admin-correcao-td@empresa.com', { role: 'ADMIN' })
    const pessoa = await criarUsuario('pessoa-correcao-td@empresa.com')
    const criado = await app.inject({
      method: 'POST', url: '/training/records', headers: authOf(pessoa), payload: REGISTRO,
    })
    const id = criado.json().id as string
    await prisma.trainingRecord.update({ where: { id }, data: { validationStatus: 'APPROVED' } })
    return { admin, pessoa, id }
  }

  // É o caso do registro migrado do envio de certificado, que chega com 0h
  // porque o formulário antigo não perguntava carga horária.
  it('o T&D corrige um registro JÁ validado — que o dono não pode mais tocar', async () => {
    const { admin, pessoa, id } = await cenarioValidado()

    const dono = await app.inject({
      method: 'PATCH', url: `/training/records/${id}`, headers: authOf(pessoa), payload: { hours: 8 },
    })
    expect(dono.statusCode).toBe(409)

    const td = await app.inject({
      method: 'PATCH', url: `/training/records/${id}`, headers: authOf(admin), payload: { hours: 8 },
    })
    expect(td.statusCode).toBe(200)
    expect(td.json().hours).toBe(8)
  })

  it('a prioridade chega ao banco — antes o serviço aceitava e o schema descartava', async () => {
    const { admin, id } = await cenarioValidado()

    const res = await app.inject({
      method: 'PATCH', url: `/training/records/${id}`, headers: authOf(admin), payload: { priority: 'Alta' },
    })
    expect(res.json().priority).toBe('Alta')

    const filtrado = await app.inject({
      method: 'GET', url: '/admin/training/records?priority=Alta', headers: authOf(admin),
    })
    expect(filtrado.json().total).toBe(1)
  })

  it('o T&D exclui, e a linha some das telas sem sumir da auditoria', async () => {
    const { admin, id } = await cenarioValidado()

    const res = await app.inject({ method: 'DELETE', url: `/training/records/${id}`, headers: authOf(admin) })
    expect(res.statusCode).toBe(204)

    const fila = await app.inject({ method: 'GET', url: '/admin/training/records', headers: authOf(admin) })
    expect(fila.json().total).toBe(0)

    const linha = await prisma.trainingRecord.findUnique({ where: { id } })
    expect(linha?.deletedAt).not.toBeNull()

    const auditoria = await prisma.adminAuditLog.findMany({ where: { entityId: id, action: 'DELETE' } })
    expect(auditoria).toHaveLength(1)
  })
})

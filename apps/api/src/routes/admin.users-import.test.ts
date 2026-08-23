import { describe, it, expect } from 'vitest'
import { USER_IMPORT_MAX_ROWS } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'
import { parseCsvTable } from '../lib/csv-parse'

const HEADER = 'Nome;E-mail;Cargo;Setor;Squad;Papel;Área;Líder (e-mail);Na equipe desde;Data de nascimento'
const BOUNDARY = 'legends-import-boundary'

function spreadsheet(...lines: string[]): Buffer {
  return Buffer.from(`﻿${[HEADER, ...lines].join('\r\n')}\r\n`, 'utf8')
}

/** Monta o corpo multipart na mão, como o teste de upload de mapa já faz. */
function multipart(content: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(
      `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="lendas.csv"\r\nContent-Type: text/csv\r\n\r\n`,
    ),
    content,
    Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
  ])
}

function uploadHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${BOUNDARY}` }
}

async function tokenFor(app: ReturnType<typeof buildApp>, role: 'ADMIN' | 'SUBADMIN' | 'LEGEND', sectorId?: string) {
  const email = `${role.toLowerCase()}@empresa.com`
  await app.inject({ method: 'POST', url: '/auth/register', payload: { name: role, email, password: 'changeme123' } })
  await prisma.user.update({ where: { email }, data: { role, ...(sectorId ? { sectorId } : {}) } })
  const res = await app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'changeme123' } })
  return res.json().accessToken as string
}

async function sector(name: string) {
  return prisma.sector.create({
    data: { name, slug: name.toLowerCase(), enabledFeatures: ['escritorio'], roles: { create: [{ role: 'LEGEND' }] } },
  })
}

describe('GET /admin/users/import/template', () => {
  it('devolve CSV com nome de arquivo e BOM', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'ADMIN')
    const res = await app.inject({
      method: 'GET',
      url: '/admin/users/import/template',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.headers['content-disposition']).toContain('modelo-importacao-lendas.csv')
    expect(res.body.startsWith('﻿')).toBe(true)
    await app.close()
  })

  it('o próprio template é lido de volta pelo parser, com todas as colunas', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'ADMIN')
    const res = await app.inject({
      method: 'GET',
      url: '/admin/users/import/template',
      headers: { authorization: `Bearer ${token}` },
    })
    const table = parseCsvTable(Buffer.from(res.body, 'utf8'))
    expect(table.headers).toEqual(HEADER.split(';'))
    expect(table.rows).toHaveLength(1)
    await app.close()
  })

  it('exige autenticação e papel de admin', async () => {
    const app = buildApp()
    await app.ready()
    expect((await app.inject({ method: 'GET', url: '/admin/users/import/template' })).statusCode).toBe(401)
    const token = await tokenFor(app, 'LEGEND')
    const res = await app.inject({
      method: 'GET',
      url: '/admin/users/import/template',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})

describe('POST /admin/users/import/preview', () => {
  it('devolve o diagnóstico sem gravar nada', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'ADMIN')
    await sector('Dados')
    const antes = await prisma.user.count()

    const res = await app.inject({
      method: 'POST',
      url: '/admin/users/import/preview',
      headers: uploadHeaders(token),
      payload: multipart(spreadsheet('Ana;ana@x.com;Dev;Dados;;;;;;')),
    })

    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.counts.CREATE).toBe(1)
    expect(body.fileHash).toMatch(/^[0-9a-f]{64}$/)
    expect(await prisma.user.count()).toBe(antes)
    await app.close()
  })

  it('responde 400 quando não vem arquivo', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'ADMIN')
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users/import/preview',
      headers: uploadHeaders(token),
      payload: Buffer.from(`--${BOUNDARY}--\r\n`),
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('responde 400 em planilha acima do limite de linhas', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'ADMIN')
    await sector('Dados')
    const linhas = Array.from({ length: USER_IMPORT_MAX_ROWS + 1 }, (_, i) => `P${i};p${i}@x.com;;Dados;;;;;;`)
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users/import/preview',
      headers: uploadHeaders(token),
      payload: multipart(spreadsheet(...linhas)),
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().message).toMatch(/limite é 200/)
    await app.close()
  })

  it('responde 413 quando o arquivo passa de 1 MB', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'ADMIN')
    await sector('Dados')
    const gordo = Buffer.concat([spreadsheet('Ana;ana@x.com;;Dados;;;;;;'), Buffer.alloc(1_100_000, 0x41)])
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users/import/preview',
      headers: uploadHeaders(token),
      payload: multipart(gordo),
    })
    expect(res.statusCode).toBe(413)
    await app.close()
  })

  it('subadmin sem coluna Setor cai no próprio setor', async () => {
    const app = buildApp()
    await app.ready()
    const dados = await sector('Dados')
    const token = await tokenFor(app, 'SUBADMIN', dados.id)
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users/import/preview',
      headers: uploadHeaders(token),
      payload: multipart(Buffer.from('﻿Nome;E-mail;Setor\r\nAna;ana@x.com;\r\n', 'utf8')),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().rows[0].sectorName).toBe('Dados')
    await app.close()
  })
})

describe('POST /admin/users/import/commit', () => {
  it('cria as pessoas e devolve as credenciais', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'ADMIN')
    await sector('Dados')
    const arquivo = spreadsheet('Ana;ana@x.com;Dev;Dados;;;;;;')

    const preview = await app.inject({
      method: 'POST',
      url: '/admin/users/import/preview',
      headers: uploadHeaders(token),
      payload: multipart(arquivo),
    })
    const { fileHash } = preview.json()

    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/import/commit?fileHash=${fileHash}`,
      headers: uploadHeaders(token),
      payload: multipart(arquivo),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().created).toBe(1)
    expect(res.json().credentials[0].email).toBe('ana@x.com')
    expect(await prisma.user.findUnique({ where: { email: 'ana@x.com' } })).not.toBeNull()
    await app.close()
  })

  it('responde 409 quando o arquivo mudou depois da pré-visualização', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'ADMIN')
    await sector('Dados')
    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/import/commit?fileHash=${'a'.repeat(64)}`,
      headers: uploadHeaders(token),
      payload: multipart(spreadsheet('Ana;ana@x.com;;Dados;;;;;;')),
    })
    expect(res.statusCode).toBe(409)
    expect(await prisma.user.findUnique({ where: { email: 'ana@x.com' } })).toBeNull()
    await app.close()
  })

  it('responde 400 sem fileHash válido', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'ADMIN')
    const res = await app.inject({
      method: 'POST',
      url: '/admin/users/import/commit?fileHash=nope',
      headers: uploadHeaders(token),
      payload: multipart(spreadsheet('Ana;ana@x.com;;Dados;;;;;;')),
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('responde 422 e não grava nada quando há linha com erro', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'ADMIN')
    await sector('Dados')
    const arquivo = spreadsheet('Ana;ana@x.com;;Dados;;;;;;', 'Sem email;;;Dados;;;;;;')

    const preview = await app.inject({
      method: 'POST',
      url: '/admin/users/import/preview',
      headers: uploadHeaders(token),
      payload: multipart(arquivo),
    })
    const { fileHash } = preview.json()
    const antes = await prisma.user.count()

    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/import/commit?fileHash=${fileHash}`,
      headers: uploadHeaders(token),
      payload: multipart(arquivo),
    })

    expect(res.statusCode).toBe(422)
    expect(res.json().issues.length).toBeGreaterThan(0)
    expect(await prisma.user.count()).toBe(antes)
    await app.close()
  })

  it('recusa colaborador comum', async () => {
    const app = buildApp()
    await app.ready()
    const token = await tokenFor(app, 'LEGEND')
    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/import/commit?fileHash=${'a'.repeat(64)}`,
      headers: uploadHeaders(token),
      payload: multipart(spreadsheet('Ana;ana@x.com;;Dados;;;;;;')),
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})

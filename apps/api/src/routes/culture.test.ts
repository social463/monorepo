import { describe, it, expect, afterEach, vi } from 'vitest'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

// getSignedUrl mockado: exercita a rota de download sem bater na AWS.
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'https://s3.amazonaws.com/signed-get-url'),
}))

const FEATURES = ['cultura']

async function makeUser(
  app: ReturnType<typeof buildApp>,
  role: string,
  opts: { features?: string[]; companyId?: string } = {},
) {
  const companyId = opts.companyId ?? 'company-emr'
  const user = await prisma.user.create({
    data: {
      name: role.toLowerCase(),
      email: `${role.toLowerCase()}-${Math.random()}@empresa.com`,
      passwordHash: 'x',
      role: role as never,
      sectorId: 'sector-dev-produto',
      companyId,
    },
  })
  const token = app.jwt.sign({
    sub: user.id,
    role,
    sectorId: 'sector-dev-produto',
    companyId,
    features: opts.features ?? FEATURES,
  })
  return { user, token }
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` }
}

const S3_KEYS = ['S3_BUCKET', 'S3_REGION', 'S3_PUBLIC_BASE_URL'] as const
const original: Record<string, string | undefined> = {}
for (const k of S3_KEYS) original[k] = process.env[k]
function enableS3() {
  process.env.S3_BUCKET = 'bucket'
  process.env.S3_REGION = 'us-east-1'
  process.env.S3_PUBLIC_BASE_URL = 'https://cdn.exemplo.com'
}

describe('rotas de leitura da Cultura', () => {
  afterEach(() => {
    for (const k of S3_KEYS) {
      if (original[k] === undefined) delete process.env[k]
      else process.env[k] = original[k]
    }
    vi.clearAllMocks()
  })

  it('devolve o manifesto publicado', async () => {
    const app = buildApp()
    await app.ready()
    const lenda = await makeUser(app, 'LEGEND')
    await prisma.culturePage.create({
      data: { slug: 'manifesto', title: 'Manifesto cultural', body: '## Por que existimos', published: true },
    })

    const res = await app.inject({ method: 'GET', url: '/culture/pages/manifesto', headers: auth(lenda.token) })
    expect(res.statusCode).toBe(200)
    expect(res.json().page.title).toBe('Manifesto cultural')
    expect(res.json().page.body).toContain('Por que existimos')
    await app.close()
  })

  it('rascunho não vaza para o colaborador (404)', async () => {
    const app = buildApp()
    await app.ready()
    const lenda = await makeUser(app, 'LEGEND')
    await prisma.culturePage.create({
      data: { slug: 'manifesto', title: 'Rascunho', body: 'texto', published: false },
    })

    const res = await app.inject({ method: 'GET', url: '/culture/pages/manifesto', headers: auth(lenda.token) })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('slug desconhecido responde 404', async () => {
    const app = buildApp()
    await app.ready()
    const lenda = await makeUser(app, 'LEGEND')
    const res = await app.inject({ method: 'GET', url: '/culture/pages/kit-visual', headers: auth(lenda.token) })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('manifesto e benefícios são lidos por qualquer colaborador, sem feature', async () => {
    const app = buildApp()
    await app.ready()
    // Sem feature nenhuma: manifesto e benefícios são a identidade da empresa.
    const lenda = await makeUser(app, 'LEGEND', { features: [] })
    await prisma.culturePage.create({
      data: { slug: 'manifesto', title: 'Manifesto', body: 'texto', published: true },
    })
    await prisma.cultureBenefit.create({
      data: { title: 'Plano de saúde', summary: 'x', body: 'y', published: true },
    })

    const manifesto = await app.inject({
      method: 'GET', url: '/culture/pages/manifesto', headers: auth(lenda.token),
    })
    const beneficios = await app.inject({ method: 'GET', url: '/culture/benefits', headers: auth(lenda.token) })
    expect(manifesto.statusCode).toBe(200)
    expect(manifesto.json().page.title).toBe('Manifesto')
    expect(beneficios.statusCode).toBe(200)
    expect(beneficios.json().benefits).toHaveLength(1)

    // Manual continua sendo documento operacional: esse sim exige `cultura`.
    const manuais = await app.inject({ method: 'GET', url: '/culture/manuals', headers: auth(lenda.token) })
    expect(manuais.statusCode).toBe(403)
    await app.close()
  })

  it('sem autenticação responde 401', async () => {
    const app = buildApp()
    await app.ready()
    const res = await app.inject({ method: 'GET', url: '/culture/manuals' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('lista manuais publicados na ordem, escondendo os não publicados', async () => {
    const app = buildApp()
    await app.ready()
    const lenda = await makeUser(app, 'LEGEND')
    await prisma.cultureManual.createMany({
      data: [
        { title: 'Segundo', description: 'b', order: 1 },
        { title: 'Primeiro', description: 'a', order: 0 },
        { title: 'Oculto', description: 'c', order: 2, published: false },
      ],
    })

    const res = await app.inject({ method: 'GET', url: '/culture/manuals', headers: auth(lenda.token) })
    expect(res.statusCode).toBe(200)
    expect(res.json().manuals.map((m: { title: string }) => m.title)).toEqual(['Primeiro', 'Segundo'])
    await app.close()
  })

  it('manual sem PDF não expõe downloadPath; com PDF expõe a rota autenticada', async () => {
    const app = buildApp()
    await app.ready()
    const lenda = await makeUser(app, 'LEGEND')
    await prisma.cultureManual.create({ data: { title: 'Sem arquivo', description: 'a' } })
    const comPdf = await prisma.cultureManual.create({
      data: { title: 'Com arquivo', description: 'b', fileKey: 'manuals/company-emr/x.pdf', fileName: 'x.pdf' },
    })

    const res = await app.inject({ method: 'GET', url: '/culture/manuals', headers: auth(lenda.token) })
    const manuals = res.json().manuals as { title: string; downloadPath: string | null }[]
    expect(manuals.find((m) => m.title === 'Sem arquivo')!.downloadPath).toBeNull()
    expect(manuals.find((m) => m.title === 'Com arquivo')!.downloadPath).toBe(`/culture/manuals/${comPdf.id}/download`)
    // A chave do objeto no S3 nunca sai no DTO.
    expect(JSON.stringify(manuals)).not.toContain('manuals/company-emr/x.pdf')
    await app.close()
  })

  it('lista benefícios publicados na ordem', async () => {
    const app = buildApp()
    await app.ready()
    const lenda = await makeUser(app, 'LEGEND')
    await prisma.cultureBenefit.createMany({
      data: [
        { title: 'CVV', summary: 'apoio', body: 'texto', order: 1 },
        { title: 'Wellhub', summary: 'academia', body: 'texto', order: 0 },
        { title: 'Oculto', summary: 'x', body: 'texto', order: 2, published: false },
      ],
    })

    const res = await app.inject({ method: 'GET', url: '/culture/benefits', headers: auth(lenda.token) })
    expect(res.json().benefits.map((b: { title: string }) => b.title)).toEqual(['Wellhub', 'CVV'])
    await app.close()
  })

  it('conteúdo de outra empresa não aparece', async () => {
    const app = buildApp()
    await app.ready()
    const lenda = await makeUser(app, 'LEGEND')
    await prisma.culturePage.create({
      data: {
        slug: 'manifesto',
        title: 'De outra empresa',
        body: 'texto',
        published: true,
        companyId: 'company-legends-internal',
      },
    })
    await prisma.cultureManual.create({
      data: { title: 'De outra empresa', description: 'x', companyId: 'company-legends-internal' },
    })

    const page = await app.inject({ method: 'GET', url: '/culture/pages/manifesto', headers: auth(lenda.token) })
    expect(page.statusCode).toBe(404)
    const manuals = await app.inject({ method: 'GET', url: '/culture/manuals', headers: auth(lenda.token) })
    expect(manuals.json().manuals).toHaveLength(0)
    await app.close()
  })
})

describe('download do PDF do manual', () => {
  afterEach(() => {
    for (const k of S3_KEYS) {
      if (original[k] === undefined) delete process.env[k]
      else process.env[k] = original[k]
    }
    vi.clearAllMocks()
  })

  it('devolve um link assinado quando há arquivo', async () => {
    enableS3()
    const app = buildApp()
    await app.ready()
    const lenda = await makeUser(app, 'LEGEND')
    const manual = await prisma.cultureManual.create({
      data: { title: 'Código de ética', description: 'a', fileKey: 'manuals/company-emr/x.pdf', fileName: 'etica.pdf' },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/culture/manuals/${manual.id}/download`,
      headers: auth(lenda.token),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().url).toBe('https://s3.amazonaws.com/signed-get-url')
    await app.close()
  })

  it('sem sessão responde 401 — o arquivo não é público', async () => {
    enableS3()
    const app = buildApp()
    await app.ready()
    const manual = await prisma.cultureManual.create({
      data: { title: 'Código de ética', description: 'a', fileKey: 'manuals/company-emr/x.pdf' },
    })

    const res = await app.inject({ method: 'GET', url: `/culture/manuals/${manual.id}/download` })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('sem a feature cultura responde 403', async () => {
    enableS3()
    const app = buildApp()
    await app.ready()
    const lenda = await makeUser(app, 'LEGEND', { features: [] })
    const manual = await prisma.cultureManual.create({
      data: { title: 'Código de ética', description: 'a', fileKey: 'manuals/company-emr/x.pdf' },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/culture/manuals/${manual.id}/download`,
      headers: auth(lenda.token),
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('manual não publicado não pode ser baixado (404)', async () => {
    enableS3()
    const app = buildApp()
    await app.ready()
    const lenda = await makeUser(app, 'LEGEND')
    const manual = await prisma.cultureManual.create({
      data: { title: 'Rascunho', description: 'a', fileKey: 'manuals/company-emr/x.pdf', published: false },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/culture/manuals/${manual.id}/download`,
      headers: auth(lenda.token),
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('manual de outra empresa não pode ser baixado (404)', async () => {
    enableS3()
    const app = buildApp()
    await app.ready()
    const lenda = await makeUser(app, 'LEGEND')
    const manual = await prisma.cultureManual.create({
      data: {
        title: 'De outra empresa',
        description: 'a',
        fileKey: 'manuals/other/x.pdf',
        companyId: 'company-legends-internal',
      },
    })

    const res = await app.inject({
      method: 'GET',
      url: `/culture/manuals/${manual.id}/download`,
      headers: auth(lenda.token),
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })

  it('manual sem arquivo anexado responde 404', async () => {
    enableS3()
    const app = buildApp()
    await app.ready()
    const lenda = await makeUser(app, 'LEGEND')
    const manual = await prisma.cultureManual.create({ data: { title: 'Só texto', description: 'a' } })

    const res = await app.inject({
      method: 'GET',
      url: `/culture/manuals/${manual.id}/download`,
      headers: auth(lenda.token),
    })
    expect(res.statusCode).toBe(404)
    await app.close()
  })
})

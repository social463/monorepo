import { describe, it, expect, afterEach, vi } from 'vitest'
import { IMAGE_MAX_BYTES } from '@legends/shared'
import { buildApp } from '../app'
import { prisma } from '../lib/prisma'

// getSignedUrl é mockado: exercita rota + s3-client reais sem bater na AWS.
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'https://s3.amazonaws.com/signed-put-url'),
}))

async function setup() {
  const app = buildApp()
  await app.ready()
  const reg = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { name: 'Up', email: 'up@empresa.com', password: 'changeme123' },
  })
  const token = reg.json().accessToken as string
  return { app, token }
}
function auth(token: string) {
  return { authorization: `Bearer ${token}` }
}

/** Usuário com papel arbitrário + token assinado (o /auth/register só cria LEGEND). */
async function makeUser(app: ReturnType<typeof buildApp>, role: string) {
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
    features: [],
  })
  return { user, token }
}

const S3_KEYS = ['S3_BUCKET', 'S3_REGION', 'S3_PUBLIC_BASE_URL'] as const
const original: Record<string, string | undefined> = {}
function enableS3() {
  process.env.S3_BUCKET = 'bucket'
  process.env.S3_REGION = 'us-east-1'
  process.env.S3_PUBLIC_BASE_URL = 'https://cdn.exemplo.com'
}
function disableS3() {
  for (const k of S3_KEYS) delete process.env[k]
}

describe('rotas de upload de imagem', () => {
  for (const k of S3_KEYS) original[k] = process.env[k]
  afterEach(() => {
    for (const k of S3_KEYS) {
      if (original[k] === undefined) delete process.env[k]
      else process.env[k] = original[k]
    }
    vi.clearAllMocks()
  })

  it('/uploads/config reflete a flag e expõe limites', async () => {
    enableS3()
    const { app } = await setup()
    const res = await app.inject({ method: 'GET', url: '/uploads/config' })
    expect(res.statusCode).toBe(200)
    expect(res.json().enabled).toBe(true)
    expect(res.json().maxBytes).toBe(10 * 1024 * 1024)
    expect(res.json().allowedContentTypes).toContain('image/png')
    await app.close()
  })

  it('presign devolve uploadUrl + publicUrl (auth)', async () => {
    enableS3()
    const { app, token } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/images/presign',
      headers: auth(token),
      payload: { contentType: 'image/png', size: 1000 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().uploadUrl).toBe('https://s3.amazonaws.com/signed-put-url')
    expect(res.json().publicUrl).toMatch(/^https:\/\/cdn\.exemplo\.com\/reviews\/.+\.png$/)
    await app.close()
  })

  it('presign rejeita content-type inválido (400)', async () => {
    enableS3()
    const { app, token } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/images/presign',
      headers: auth(token),
      payload: { contentType: 'application/pdf', size: 1000 },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('presign rejeita tamanho acima do máximo (400)', async () => {
    enableS3()
    const { app, token } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/images/presign',
      headers: auth(token),
      payload: { contentType: 'image/png', size: 10 * 1024 * 1024 + 1 },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('presign sem auth responde 401', async () => {
    enableS3()
    const { app } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/images/presign',
      payload: { contentType: 'image/png', size: 1000 },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('presign com S3 desabilitado responde 503', async () => {
    disableS3()
    const { app, token } = await setup()
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/images/presign',
      headers: auth(token),
      payload: { contentType: 'image/png', size: 1000 },
    })
    expect(res.statusCode).toBe(503)
    await app.close()
  })
})

describe('rotas de upload de documento (PDF de manual interno)', () => {
  afterEach(() => {
    for (const k of S3_KEYS) {
      if (original[k] === undefined) delete process.env[k]
      else process.env[k] = original[k]
    }
    vi.clearAllMocks()
  })

  it('admin recebe uploadUrl e chave sob manuals/<companyId>/', async () => {
    enableS3()
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/documents/presign',
      headers: auth(admin.token),
      payload: { contentType: 'application/pdf', size: 1000 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().uploadUrl).toBe('https://s3.amazonaws.com/signed-put-url')
    expect(res.json().key).toMatch(/^manuals\/company-emr\/.+\.pdf$/)
    // O manual não é público: a resposta não pode devolver URL pública.
    expect(res.json().publicUrl).toBeUndefined()
    await app.close()
  })

  it('subadmin também sobe documento (é quem gerencia manuais)', async () => {
    enableS3()
    const app = buildApp()
    await app.ready()
    const sub = await makeUser(app, 'SUBADMIN')
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/documents/presign',
      headers: auth(sub.token),
      payload: { contentType: 'application/pdf', size: 1000 },
    })
    expect(res.statusCode).toBe(200)
    await app.close()
  })

  it('lenda comum recebe 403', async () => {
    enableS3()
    const app = buildApp()
    await app.ready()
    const lenda = await makeUser(app, 'LEGEND')
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/documents/presign',
      headers: auth(lenda.token),
      payload: { contentType: 'application/pdf', size: 1000 },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('rejeita content-type que não é PDF (400)', async () => {
    enableS3()
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/documents/presign',
      headers: auth(admin.token),
      payload: { contentType: 'image/png', size: 1000 },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('rejeita arquivo acima de 20MB (400)', async () => {
    enableS3()
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/documents/presign',
      headers: auth(admin.token),
      payload: { contentType: 'application/pdf', size: 20 * 1024 * 1024 + 1 },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('sem S3 configurado responde 503', async () => {
    disableS3()
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/documents/presign',
      headers: auth(admin.token),
      payload: { contentType: 'application/pdf', size: 1000 },
    })
    expect(res.statusCode).toBe(503)
    await app.close()
  })
})

describe('rota de upload de evidência de desafio (qualquer colaborador autenticado)', () => {
  afterEach(() => {
    for (const k of S3_KEYS) {
      if (original[k] === undefined) delete process.env[k]
      else process.env[k] = original[k]
    }
    vi.clearAllMocks()
  })

  it('lenda comum (não admin) recebe uploadUrl e chave sob challenges/<userId>/', async () => {
    enableS3()
    const app = buildApp()
    await app.ready()
    const lenda = await makeUser(app, 'LEGEND')
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/challenge-evidence/presign',
      headers: auth(lenda.token),
      payload: { contentType: 'application/pdf', size: 1000 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().uploadUrl).toBe('https://s3.amazonaws.com/signed-put-url')
    expect(res.json().key).toMatch(new RegExp(`^challenges/${lenda.user.id}/.+\\.pdf$`))
    await app.close()
  })

  it('rejeita content-type que não é PDF (400)', async () => {
    enableS3()
    const app = buildApp()
    await app.ready()
    const lenda = await makeUser(app, 'LEGEND')
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/challenge-evidence/presign',
      headers: auth(lenda.token),
      payload: { contentType: 'image/png', size: 1000 },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('rejeita arquivo acima de 20MB (400)', async () => {
    enableS3()
    const app = buildApp()
    await app.ready()
    const lenda = await makeUser(app, 'LEGEND')
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/challenge-evidence/presign',
      headers: auth(lenda.token),
      payload: { contentType: 'application/pdf', size: 20 * 1024 * 1024 + 1 },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('sem auth responde 401', async () => {
    enableS3()
    const app = buildApp()
    await app.ready()
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/challenge-evidence/presign',
      payload: { contentType: 'application/pdf', size: 1000 },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('sem S3 configurado responde 503', async () => {
    disableS3()
    const app = buildApp()
    await app.ready()
    const lenda = await makeUser(app, 'LEGEND')
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/challenge-evidence/presign',
      headers: auth(lenda.token),
      payload: { contentType: 'application/pdf', size: 1000 },
    })
    expect(res.statusCode).toBe(503)
    await app.close()
  })
})

describe('rota de upload de evidência do diário de bordo do INOVA (qualquer colaborador autenticado)', () => {
  afterEach(() => {
    for (const k of S3_KEYS) {
      if (original[k] === undefined) delete process.env[k]
      else process.env[k] = original[k]
    }
    vi.clearAllMocks()
  })

  it('lenda comum recebe uploadUrl + publicUrl e chave sob inova-diary/<companyId>/<userId>/', async () => {
    enableS3()
    const app = buildApp()
    await app.ready()
    const lenda = await makeUser(app, 'LEGEND')
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/inova-diary/presign',
      headers: auth(lenda.token),
      payload: { contentType: 'image/png', size: 1000 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().uploadUrl).toBe('https://s3.amazonaws.com/signed-put-url')
    expect(res.json().publicUrl).toMatch(/^https:\/\/cdn\.exemplo\.com\/inova-diary\/.+\.png$/)
    expect(res.json().key).toMatch(new RegExp(`^inova-diary/company-emr/${lenda.user.id}/.+\\.png$`))
    expect(res.json().kind).toBe('IMAGE')
    await app.close()
  })

  it('aceita vídeo MP4', async () => {
    enableS3()
    const app = buildApp()
    await app.ready()
    const lenda = await makeUser(app, 'LEGEND')
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/inova-diary/presign',
      headers: auth(lenda.token),
      payload: { contentType: 'video/mp4', size: 1000 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().kind).toBe('VIDEO')
    await app.close()
  })

  it('rejeita content-type que não é imagem nem vídeo (400)', async () => {
    enableS3()
    const app = buildApp()
    await app.ready()
    const lenda = await makeUser(app, 'LEGEND')
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/inova-diary/presign',
      headers: auth(lenda.token),
      payload: { contentType: 'application/pdf', size: 1000 },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('sem auth responde 401', async () => {
    enableS3()
    const app = buildApp()
    await app.ready()
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/inova-diary/presign',
      payload: { contentType: 'image/png', size: 1000 },
    })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('sem S3 configurado responde 503', async () => {
    disableS3()
    const app = buildApp()
    await app.ready()
    const lenda = await makeUser(app, 'LEGEND')
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/inova-diary/presign',
      headers: auth(lenda.token),
      payload: { contentType: 'image/png', size: 1000 },
    })
    expect(res.statusCode).toBe(503)
    await app.close()
  })
})

describe('rota de upload de vídeo da biblioteca do Guia (só admin/subadmin)', () => {
  afterEach(() => {
    for (const k of S3_KEYS) {
      if (original[k] === undefined) delete process.env[k]
      else process.env[k] = original[k]
    }
    vi.clearAllMocks()
  })

  it('admin recebe uploadUrl + storagePath sob inova-guia-videos/<companyId>/', async () => {
    enableS3()
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/inova-guia-video/presign',
      headers: auth(admin.token),
      payload: { contentType: 'video/mp4', size: 1000 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().uploadUrl).toBe('https://s3.amazonaws.com/signed-put-url')
    expect(res.json().publicUrl).toMatch(/^https:\/\/cdn\.exemplo\.com\/inova-guia-videos\/.+\.mp4$/)
    expect(res.json().storagePath).toMatch(/^inova-guia-videos\/company-emr\/.+\.mp4$/)
    await app.close()
  })

  it('lenda comum é recusada (403)', async () => {
    enableS3()
    const app = buildApp()
    await app.ready()
    const lenda = await makeUser(app, 'LEGEND')
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/inova-guia-video/presign',
      headers: auth(lenda.token),
      payload: { contentType: 'video/mp4', size: 1000 },
    })
    expect(res.statusCode).toBe(403)
    await app.close()
  })

  it('rejeita imagem — só vídeo é aceito aqui (400)', async () => {
    enableS3()
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/inova-guia-video/presign',
      headers: auth(admin.token),
      payload: { contentType: 'image/png', size: 1000 },
    })
    expect(res.statusCode).toBe(400)
    await app.close()
  })

  it('sem S3 configurado responde 503', async () => {
    disableS3()
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')
    const res = await app.inject({
      method: 'POST',
      url: '/uploads/inova-guia-video/presign',
      headers: auth(admin.token),
      payload: { contentType: 'video/mp4', size: 1000 },
    })
    expect(res.statusCode).toBe(503)
    await app.close()
  })
})

describe('presign de foto de evento', () => {
  it('recusa content-type fora do permitido, em português', async () => {
    enableS3()
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')

    const res = await app.inject({
      method: 'POST',
      url: '/uploads/event-photos/presign',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { contentType: 'application/pdf', size: 1000 },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().message).toBe('Formato não suportado. Use JPEG, PNG, WebP ou GIF.')
    await app.close()
  })

  it('recusa arquivo acima do limite, em português', async () => {
    enableS3()
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'ADMIN')

    const res = await app.inject({
      method: 'POST',
      url: '/uploads/event-photos/presign',
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { contentType: 'image/jpeg', size: IMAGE_MAX_BYTES + 1 },
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().message).toBe('Imagem muito grande (máx. 10MB).')
    await app.close()
  })

  it('nega quem não administra Gente e Gestão', async () => {
    enableS3()
    const app = buildApp()
    await app.ready()
    const colaborador = await makeUser(app, 'LEGEND')

    const res = await app.inject({
      method: 'POST',
      url: '/uploads/event-photos/presign',
      headers: { authorization: `Bearer ${colaborador.token}` },
      payload: { contentType: 'image/jpeg', size: 1000 },
    })

    expect(res.statusCode).toBe(403)
    await app.close()
  })
})

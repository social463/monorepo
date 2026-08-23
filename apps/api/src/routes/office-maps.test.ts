import { beforeEach, describe, expect, it } from 'vitest'
import type { MapDocumentV1 } from '@legends/shared'
import { OFFICE_TILESET_CATALOG, createEmptyMapDocumentV1, DEFAULT_COMPANY_ID } from '@legends/shared'
import { MapTileSizeSchema } from '@legends/shared'
import { buildApp } from '../app'
import { getOfficeHub } from '../lib/office-hub'
import { prisma } from '../lib/prisma'
import {
  acquireOfficeMapLock as acquireOfficeMapLockService,
  createOfficeMap,
  getActiveOfficeMap,
  publishOfficeMap,
  releaseOfficeMapLock as releaseOfficeMapLockService,
  saveOfficeMapDraft,
} from '../services/office-map-service'

// Todos os testes deste arquivo operam na empresa default.
const officeHub = getOfficeHub(DEFAULT_COMPANY_ID)

async function makeUser(app: ReturnType<typeof buildApp>, suffix: string, role: 'ADMIN' | 'LEGEND') {
  const user = await prisma.user.create({
    data: { name: suffix, email: `${suffix}@x.com`, passwordHash: 'x', role },
  })
  return { user, token: app.jwt.sign({ sub: user.id, role, sectorId: 'sector-dev-produto', companyId: 'company-emr', features: ['escritorio'] }) }
}

function auth(token: string, extra: Record<string, string> = {}) {
  return { authorization: `Bearer ${token}`, ...extra }
}

function builtinTileset48() {
  const tileset = OFFICE_TILESET_CATALOG.find((entry) => entry.tileWidth === 48 && entry.tileHeight === 48)
  if (!tileset) throw new Error('Tileset builtin 48px não encontrado')
  return tileset
}

beforeEach(() => officeHub.reset())

async function seedMemberAndActiveMap(app: ReturnType<typeof buildApp>) {
  const admin = await prisma.user.create({
    data: { name: 'admin-decor', email: `admin-decor-${Date.now()}@x.com`, passwordHash: 'x', role: 'ADMIN' },
  })
  const { id: mapId } = await createOfficeMap({ name: 'Mapa Ativo', width: 20, height: 20, tileSize: 48 }, admin.id, DEFAULT_COMPANY_ID)
  const builtin = builtinTileset48()
  const doc = createEmptyMapDocumentV1({ width: 20, height: 20, tileSize: 48 })
  const tileWidth = MapTileSizeSchema.parse(builtin.tileWidth)
  const tileHeight = MapTileSizeSchema.parse(builtin.tileHeight)
  doc.tilesets.push({
    id: 'ts1', assetId: builtin.assetId, name: builtin.name,
    tileWidth, tileHeight,
    columns: builtin.columns, tileCount: builtin.tileCount,
  })
  const objectsLayer = doc.layers.find((l) => l.key === 'objects')
  if (objectsLayer?.type === 'tile') objectsLayer.data[0] = 'ts1:0'
  const adminLock = await acquireOfficeMapLockService(mapId, admin.id, DEFAULT_COMPANY_ID)
  const draft = await prisma.officeMapDraft.findUniqueOrThrow({ where: { mapId } })
  const saved = await saveOfficeMapDraft(mapId, { revision: draft.revision, document: doc }, admin.id, adminLock.lockToken, DEFAULT_COMPANY_ID)
  await publishOfficeMap(mapId, saved.revision, admin.id, true, DEFAULT_COMPANY_ID)
  await releaseOfficeMapLockService(mapId, admin.id, adminLock.lockToken, DEFAULT_COMPANY_ID)
  const active = await getActiveOfficeMap(DEFAULT_COMPANY_ID)

  const legend = await makeUser(app, `legend-decor-${Date.now()}`, 'LEGEND')
  return { token: legend.token, mapId, activeDoc: active.document, revision: saved.revision }
}

describe('editor administrativo de mapas', () => {
  it('exige administrador para listar e criar mapas', async () => {
    const app = buildApp()
    await app.ready()
    expect((await app.inject({ method: 'GET', url: '/admin/office-maps' })).statusCode).toBe(401)
    const legend = await makeUser(app, 'legend-map', 'LEGEND')
    const response = await app.inject({
      method: 'POST',
      url: '/admin/office-maps',
      headers: auth(legend.token),
      payload: { name: 'Escritório', width: 20, height: 20, tileSize: 32 },
    })
    expect(response.statusCode).toBe(403)
    await app.close()
  })

  it('cria, bloqueia, salva com revisão otimista, publica e serve o snapshot ativo', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'admin-map', 'ADMIN')

    const created = await app.inject({
      method: 'POST',
      url: '/admin/office-maps',
      headers: auth(admin.token),
      payload: { name: 'Matriz', width: 20, height: 16, tileSize: 32 },
    })
    expect(created.statusCode).toBe(201)
    const mapId = (created.json() as { map: { id: string } }).map.id

    const draftResponse = await app.inject({
      method: 'GET', url: `/admin/office-maps/${mapId}/draft`, headers: auth(admin.token),
    })
    const draft = draftResponse.json() as { revision: number; document: MapDocumentV1 }
    expect(draft.document.map).toMatchObject({ width: 20, height: 16, tileWidth: 32 })

    const lockResponse = await app.inject({
      method: 'POST', url: `/admin/office-maps/${mapId}/lock`, headers: auth(admin.token),
    })
    const lock = lockResponse.json() as { lockToken: string; expiresAt: string }
    expect(lock.lockToken).toBeTruthy()
    expect(new Date(lock.expiresAt).getTime()).toBeGreaterThan(Date.now())

    const saved = await app.inject({
      method: 'PUT',
      url: `/admin/office-maps/${mapId}/draft`,
      headers: auth(admin.token, { 'x-map-lock-token': lock.lockToken }),
      payload: { revision: draft.revision, document: draft.document },
    })
    expect(saved.statusCode).toBe(200)
    expect(saved.json()).toMatchObject({ revision: draft.revision + 1 })

    const stale = await app.inject({
      method: 'PUT',
      url: `/admin/office-maps/${mapId}/draft`,
      headers: auth(admin.token, { 'x-map-lock-token': lock.lockToken }),
      payload: { revision: draft.revision, document: draft.document },
    })
    expect(stale.statusCode).toBe(409)
    expect(stale.json()).toMatchObject({ code: 'DRAFT_REVISION_CONFLICT' })

    const published = await app.inject({
      method: 'POST',
      url: `/admin/office-maps/${mapId}/publications`,
      headers: auth(admin.token),
      payload: { revision: draft.revision + 1, activate: true },
    })
    expect(published.statusCode).toBe(201)
    expect(published.json()).toMatchObject({ publication: { version: 1, active: true }, activated: true })

    const runtime = await app.inject({ method: 'GET', url: '/office/map', headers: auth(admin.token) })
    expect(runtime.statusCode).toBe(200)
    expect(runtime.json()).toMatchObject({
      map: { id: mapId, name: 'Matriz' },
      publication: { version: 1, active: true },
      document: { schemaVersion: '1.0.0' },
    })

    const deletion = await app.inject({
      method: 'DELETE', url: `/admin/office-maps/${mapId}`, headers: auth(admin.token),
    })
    expect(deletion.statusCode).toBe(409)
    expect(deletion.json()).toMatchObject({ code: 'MAP_IS_ACTIVE' })
    await app.close()
  })

  it('cura automaticamente um mapa salvo antes da layer reservada "desks" existir', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'admin-legacy-map', 'ADMIN')

    const created = await app.inject({
      method: 'POST',
      url: '/admin/office-maps',
      headers: auth(admin.token),
      payload: { name: 'Mapa legado', width: 20, height: 16, tileSize: 32 },
    })
    const mapId = (created.json() as { map: { id: string } }).map.id

    const before = await prisma.officeMapDraft.findUniqueOrThrow({ where: { mapId } })
    const legacyDocument = {
      ...(before.document as unknown as MapDocumentV1),
      layers: (before.document as unknown as MapDocumentV1).layers.filter((layer) => layer.key !== 'desks'),
    }
    await prisma.officeMapDraft.update({ where: { mapId }, data: { document: legacyDocument as unknown as object } })

    // Abrir o rascunho já cura o documento salvo, sem exigir edição manual.
    const draftResponse = await app.inject({
      method: 'GET', url: `/admin/office-maps/${mapId}/draft`, headers: auth(admin.token),
    })
    const draft = draftResponse.json() as { revision: number; document: MapDocumentV1 }
    expect(draft.document.layers.map((layer) => layer.key)).toContain('desks')

    const validated = await app.inject({
      method: 'POST',
      url: `/admin/office-maps/${mapId}/validate`,
      headers: auth(admin.token),
      payload: { revision: draft.revision },
    })
    expect(validated.statusCode).toBe(200)
    expect(validated.json()).toMatchObject({ valid: true, errors: [] })

    const published = await app.inject({
      method: 'POST',
      url: `/admin/office-maps/${mapId}/publications`,
      headers: auth(admin.token),
      payload: { revision: draft.revision, activate: true },
    })
    expect(published.statusCode).toBe(201)
    expect(published.json()).toMatchObject({ publication: { version: 1, active: true } })
    await app.close()
  })

  it('mantém lock exclusivo e permite renovação pelo dono', async () => {
    const app = buildApp()
    await app.ready()
    const first = await makeUser(app, 'admin-lock-a', 'ADMIN')
    const second = await makeUser(app, 'admin-lock-b', 'ADMIN')
    const created = await app.inject({
      method: 'POST',
      url: '/admin/office-maps',
      headers: auth(first.token),
      payload: { name: 'Filial', width: 10, height: 10, tileSize: 16 },
    })
    const mapId = (created.json() as { map: { id: string } }).map.id
    const acquired = await app.inject({
      method: 'POST', url: `/admin/office-maps/${mapId}/lock`, headers: auth(first.token),
    })
    const token = (acquired.json() as { lockToken: string }).lockToken

    const blocked = await app.inject({
      method: 'POST', url: `/admin/office-maps/${mapId}/lock`, headers: auth(second.token),
    })
    expect(blocked.statusCode).toBe(423)
    expect(blocked.json()).toMatchObject({ code: 'MAP_LOCKED', owner: { id: first.user.id } })

    const heartbeat = await app.inject({
      method: 'POST',
      url: `/admin/office-maps/${mapId}/lock/heartbeat`,
      headers: auth(first.token, { 'x-map-lock-token': token }),
    })
    expect(heartbeat.statusCode).toBe(200)
    expect(heartbeat.json()).toHaveProperty('expiresAt')

    await prisma.officeMapEditLock.update({
      where: { mapId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    })
    const afterExpiry = await app.inject({
      method: 'POST', url: `/admin/office-maps/${mapId}/lock`, headers: auth(second.token),
    })
    expect(afterExpiry.statusCode).toBe(200)
    expect(afterExpiry.json()).toMatchObject({ owner: { id: second.user.id } })
    await app.close()
  })

  it('inclui os assets builtin do rascunho na listagem de assets do mapa', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'admin-builtin-assets', 'ADMIN')
    const { id: mapId } = await createOfficeMap(
      { name: 'Com mobília', width: 20, height: 20, tileSize: 48 },
      admin.user.id,
      DEFAULT_COMPANY_ID,
    )
    const builtin = builtinTileset48()
    const doc = createEmptyMapDocumentV1({ width: 20, height: 20, tileSize: 48 })
    doc.tilesets.push({
      id: 'ts-builtin',
      assetId: builtin.assetId,
      name: builtin.name,
      tileWidth: MapTileSizeSchema.parse(builtin.tileWidth),
      tileHeight: MapTileSizeSchema.parse(builtin.tileHeight),
      columns: builtin.columns,
      tileCount: builtin.tileCount,
    })
    const objectsLayer = doc.layers.find((layer) => layer.key === 'objects')
    if (objectsLayer?.type === 'tile') objectsLayer.data[0] = 'ts-builtin:0'
    const lock = await acquireOfficeMapLockService(mapId, admin.user.id, DEFAULT_COMPANY_ID)
    const draft = await prisma.officeMapDraft.findUniqueOrThrow({ where: { mapId } })
    await saveOfficeMapDraft(
      mapId,
      { revision: draft.revision, document: doc },
      admin.user.id,
      lock.lockToken,
      DEFAULT_COMPANY_ID,
    )
    await releaseOfficeMapLockService(mapId, admin.user.id, lock.lockToken, DEFAULT_COMPANY_ID)

    // O canvas do editor só resolve a textura de um tileset se o asset dele vier
    // nessa listagem — sem os builtins, a mobília do rascunho não é desenhada.
    const response = await app.inject({
      method: 'GET',
      url: `/admin/office-maps/${mapId}/assets`,
      headers: auth(admin.token),
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toContainEqual(expect.objectContaining({ id: builtin.assetId }))
    await app.close()
  })

  it('responde 503 no upload quando o S3 não está configurado', async () => {
    const previous = {
      bucket: process.env.S3_BUCKET,
      region: process.env.S3_REGION,
      base: process.env.S3_PUBLIC_BASE_URL,
    }
    delete process.env.S3_BUCKET
    delete process.env.S3_REGION
    delete process.env.S3_PUBLIC_BASE_URL
    const app = buildApp()
    try {
      await app.ready()
      const admin = await makeUser(app, 'admin-upload', 'ADMIN')
      const created = await app.inject({
        method: 'POST',
        url: '/admin/office-maps',
        headers: auth(admin.token),
        payload: { name: 'Upload', width: 10, height: 10, tileSize: 32 },
      })
      const mapId = (created.json() as { map: { id: string } }).map.id
      const boundary = 'legends-map-boundary'
      const payload = Buffer.from([
        `--${boundary}\r\n`,
        'Content-Disposition: form-data; name="file"; filename="tiles.png"\r\n',
        'Content-Type: image/png\r\n\r\n',
        'imagem',
        `\r\n--${boundary}--\r\n`,
      ].join(''))
      const response = await app.inject({
        method: 'POST',
        url: `/admin/office-maps/${mapId}/assets`,
        headers: auth(admin.token, { 'content-type': `multipart/form-data; boundary=${boundary}` }),
        payload,
      })
      expect(response.statusCode).toBe(503)
      expect(response.json()).toMatchObject({ code: 'S3_DISABLED' })
    } finally {
      await app.close()
      if (previous.bucket === undefined) delete process.env.S3_BUCKET
      else process.env.S3_BUCKET = previous.bucket
      if (previous.region === undefined) delete process.env.S3_REGION
      else process.env.S3_REGION = previous.region
      if (previous.base === undefined) delete process.env.S3_PUBLIC_BASE_URL
      else process.env.S3_PUBLIC_BASE_URL = previous.base
    }
  })

  it('GET /admin/office-maps não lista mapa de outra empresa', async () => {
    const app = buildApp()
    await app.ready()
    const { token } = await makeUser(app, 'admin-outra-empresa-map', 'ADMIN')
    const otherCompany = await prisma.company.create({ data: { name: 'Outra Empresa Office Maps', slug: 'outra-empresa-office-maps-test' } })
    await prisma.officeMap.create({ data: { name: 'Mapa de outra empresa', companyId: otherCompany.id } })

    const res = await app.inject({ method: 'GET', url: '/admin/office-maps', headers: auth(token) })
    expect(res.statusCode).toBe(200)
    expect(res.json().maps.some((m: { name: string }) => m.name === 'Mapa de outra empresa')).toBe(false)
    await app.close()
  })
})

describe('rotas de decoração por membro', () => {
  it('exige autenticação (401 sem token)', async () => {
    const app = buildApp()
    await app.ready()
    expect((await app.inject({ method: 'GET', url: '/office/map/edit/draft' })).statusCode).toBe(401)
    await app.close()
  })

  it('membro adquire lock e salva decoração, mas 403 em delta estrutural', async () => {
    const app = buildApp()
    await app.ready()
    const { token, revision, activeDoc } = await seedMemberAndActiveMap(app)

    const draftResponse = await app.inject({
      method: 'GET', url: '/office/map/edit/draft', headers: auth(token),
    })
    expect(draftResponse.statusCode).toBe(200)

    const lock = await app.inject({
      method: 'POST', url: '/office/map/edit/lock', headers: auth(token),
    })
    expect(lock.statusCode).toBe(200)
    const lockToken = (lock.json() as { lockToken: string }).lockToken

    const bad = JSON.parse(JSON.stringify(activeDoc)) as MapDocumentV1
    ;(bad.map as { height: number }).height += 1
    const res = await app.inject({
      method: 'PUT',
      url: '/office/map/edit/draft',
      headers: auth(token, { 'x-map-lock-token': lockToken }),
      payload: { revision, document: bad },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toMatchObject({ code: 'STRUCTURAL_EDIT_FORBIDDEN' })
    expect(res.json()).toHaveProperty('violations')

    await app.close()
  })

  it('membro salva decoração válida, publica e libera o lock', async () => {
    const app = buildApp()
    await app.ready()
    const { token, revision, activeDoc } = await seedMemberAndActiveMap(app)

    const lock = await app.inject({
      method: 'POST', url: '/office/map/edit/lock', headers: auth(token),
    })
    expect(lock.statusCode).toBe(200)
    const lockToken = (lock.json() as { lockToken: string }).lockToken

    const good = JSON.parse(JSON.stringify(activeDoc)) as MapDocumentV1
    const objects = good.layers.find((l) => l.key === 'objects')
    if (objects?.type === 'tile') objects.data[0] = null

    const saveRes = await app.inject({
      method: 'PUT',
      url: '/office/map/edit/draft',
      headers: auth(token, { 'x-map-lock-token': lockToken }),
      payload: { revision, document: good },
    })
    expect(saveRes.statusCode).toBe(200)
    const savedRevision = (saveRes.json() as { revision: number }).revision

    const heartbeat = await app.inject({
      method: 'POST',
      url: '/office/map/edit/lock/heartbeat',
      headers: auth(token, { 'x-map-lock-token': lockToken }),
    })
    expect(heartbeat.statusCode).toBe(200)

    const publishRes = await app.inject({
      method: 'POST',
      url: '/office/map/edit/publish',
      headers: auth(token),
      payload: { revision: savedRevision },
    })
    expect(publishRes.statusCode).toBe(200)
    expect(publishRes.json()).toMatchObject({ activated: true })

    const release = await app.inject({
      method: 'DELETE',
      url: '/office/map/edit/lock',
      headers: auth(token, { 'x-map-lock-token': lockToken }),
    })
    expect(release.statusCode).toBe(204)
    await app.close()
  })

  it('aceita o merge-publish de um documento acima do bodyLimit padrão do Fastify (1 MiB)', async () => {
    // Todo Salvar manda o mapa INTEIRO. Com o teto de objetos em 10000 e ~276
    // bytes por objeto, o corpo passa de 1 MiB muito antes do teto — e o
    // `bodyLimit` padrão do Fastify derrubaria o save com um 413 genérico,
    // fora do alcance de qualquer validação de documento. O nginx tem o mesmo
    // padrão de 1 MB e é ajustado junto (`nginx/default.conf`).
    const app = buildApp()
    await app.ready()
    const { token, activeDoc } = await seedMemberAndActiveMap(app)

    const active = await app.inject({ method: 'GET', url: '/office/map', headers: auth(token) })
    const { decorRevision, publication } = active.json() as { decorRevision: number; publication: { id: string } }

    const gordo = JSON.parse(JSON.stringify(activeDoc)) as MapDocumentV1
    gordo.objects = [
      ...gordo.objects,
      ...Array.from({ length: 7_000 }, (_, index) => ({
        id: `deco-${index}`,
        layerKey: 'objects',
        type: 'tile-object' as const,
        geometry: {
          kind: 'rectangle' as const,
          x: (index % 20) * 48,
          y: (Math.floor(index / 20) % 20) * 48,
          width: 48,
          height: 48,
        },
        properties: { tilesetId: 'ts1', tileIndex: 0 },
      })),
    ]
    const payload = JSON.stringify({ baseRevision: decorRevision, basePublicationId: publication.id, document: gordo })
    expect(Buffer.byteLength(payload)).toBeGreaterThan(1024 * 1024)

    const res = await app.inject({
      method: 'POST',
      url: '/office/map/edit/merge-publish',
      headers: auth(token, { 'content-type': 'application/json' }),
      payload,
    })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { document: MapDocumentV1 }).document.objects.length).toBeGreaterThan(7_000)
    await app.close()
  })
})

describe('mesas reivindicáveis', () => {
  async function publishMapWithDesk(app: ReturnType<typeof buildApp>, admin: { token: string }) {
    const created = await app.inject({
      method: 'POST',
      url: '/admin/office-maps',
      headers: auth(admin.token),
      payload: { name: 'Mapa com mesa', width: 20, height: 16, tileSize: 32 },
    })
    const mapId = (created.json() as { map: { id: string } }).map.id

    const draftResponse = await app.inject({
      method: 'GET', url: `/admin/office-maps/${mapId}/draft`, headers: auth(admin.token),
    })
    const draft = draftResponse.json() as { revision: number; document: MapDocumentV1 }
    draft.document.objects.push({
      id: 'desk-1',
      layerKey: 'desks',
      type: 'desk',
      geometry: { kind: 'rectangle', x: 64, y: 64, width: 48, height: 32 },
      properties: { externalKey: 'mesa-1', name: 'Mesa 1' },
    })

    const lockResponse = await app.inject({
      method: 'POST', url: `/admin/office-maps/${mapId}/lock`, headers: auth(admin.token),
    })
    const lock = lockResponse.json() as { lockToken: string }

    await app.inject({
      method: 'PUT',
      url: `/admin/office-maps/${mapId}/draft`,
      headers: auth(admin.token, { 'x-map-lock-token': lock.lockToken }),
      payload: { revision: draft.revision, document: draft.document },
    })

    const published = await app.inject({
      method: 'POST',
      url: `/admin/office-maps/${mapId}/publications`,
      headers: auth(admin.token),
      payload: { revision: draft.revision + 1, activate: true },
    })
    expect(published.statusCode).toBe(201)
  }

  it('permite reivindicar, impede reivindicar segunda mesa, e permite abandonar', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'admin-desk', 'ADMIN')
    const legend = await makeUser(app, 'legend-desk', 'LEGEND')
    await publishMapWithDesk(app, admin)

    const officeMap = await app.inject({ method: 'GET', url: '/office/map', headers: auth(legend.token) })
    const desks = (officeMap.json() as { desks: Array<{ id: string; externalKey: string; claimedBy: unknown }> }).desks
    expect(desks).toMatchObject([{ externalKey: 'mesa-1', claimedBy: null }])
    const deskId = desks[0]!.id

    const claimed = await app.inject({
      method: 'POST', url: `/office/desks/${deskId}/claim`, headers: auth(legend.token),
    })
    expect(claimed.statusCode).toBe(200)
    expect(claimed.json()).toMatchObject({ desk: { claimedBy: { id: legend.user.id } } })

    const secondClaimAttempt = await app.inject({
      method: 'POST', url: `/office/desks/${deskId}/claim`, headers: auth(legend.token),
    })
    expect(secondClaimAttempt.statusCode).toBe(409)
    expect(secondClaimAttempt.json()).toMatchObject({ code: 'DESK_ALREADY_CLAIMED' })

    const released = await app.inject({
      method: 'POST', url: `/office/desks/${deskId}/release`, headers: auth(legend.token),
    })
    expect(released.statusCode).toBe(200)
    expect(released.json()).toMatchObject({ desk: { claimedBy: null } })
    await app.close()
  })

  it('admin libera a mesa de qualquer usuário', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'admin-desk-3', 'ADMIN')
    const legend = await makeUser(app, 'legend-desk-3', 'LEGEND')
    await publishMapWithDesk(app, admin)
    const officeMap = await app.inject({ method: 'GET', url: '/office/map', headers: auth(legend.token) })
    const deskId = (officeMap.json() as { desks: Array<{ id: string }> }).desks[0]!.id

    await app.inject({ method: 'POST', url: `/office/desks/${deskId}/claim`, headers: auth(legend.token) })

    const forbidden = await app.inject({
      method: 'DELETE', url: `/admin/office-desks/${deskId}/claim`, headers: auth(legend.token),
    })
    expect(forbidden.statusCode).toBe(403)

    const released = await app.inject({
      method: 'DELETE', url: `/admin/office-desks/${deskId}/claim`, headers: auth(admin.token),
    })
    expect(released.statusCode).toBe(200)
    expect(released.json()).toMatchObject({ desk: { claimedBy: null } })

    const list = await app.inject({ method: 'GET', url: '/admin/office-desks', headers: auth(admin.token) })
    expect(list.json()).toMatchObject({ desks: [{ externalKey: 'mesa-1', claimedBy: null }] })
    await app.close()
  })

  it('permite deixar lembrete privado na mesa de outra pessoa e marca como lido', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'admin-desk-reminder', 'ADMIN')
    const owner = await makeUser(app, 'owner-desk-reminder', 'LEGEND')
    const sender = await makeUser(app, 'sender-desk-reminder', 'LEGEND')
    await publishMapWithDesk(app, admin)

    const officeMap = await app.inject({ method: 'GET', url: '/office/map', headers: auth(owner.token) })
    const deskId = (officeMap.json() as { desks: Array<{ id: string }> }).desks[0]!.id
    await app.inject({ method: 'POST', url: `/office/desks/${deskId}/claim`, headers: auth(owner.token) })

    const created = await app.inject({
      method: 'POST',
      url: `/office/desks/${deskId}/reminders`,
      headers: auth(sender.token),
      payload: { message: 'Passa aqui depois?' },
    })
    expect(created.statusCode).toBe(201)
    const reminder = (created.json() as { reminder: { id: string; sender: { id: string }; recipientId: string } }).reminder
    expect(reminder).toMatchObject({ sender: { id: sender.user.id }, recipientId: owner.user.id })

    const ownerNotification = await prisma.notification.findFirstOrThrow({
      where: { userId: owner.user.id, type: 'OFFICE_DESK_REMINDER_RECEIVED' },
    })
    expect(ownerNotification.actorId).toBe(sender.user.id)

    const senderView = await app.inject({
      method: 'GET',
      url: `/office/desk-reminders/${reminder.id}`,
      headers: auth(sender.token),
    })
    expect(senderView.json()).toMatchObject({ reminder: { canRead: false, message: null, sender: { id: sender.user.id } } })

    const ownerView = await app.inject({
      method: 'GET',
      url: `/office/desk-reminders/${reminder.id}`,
      headers: auth(owner.token),
    })
    expect(ownerView.json()).toMatchObject({ reminder: { canRead: true, message: 'Passa aqui depois?' } })

    const read = await app.inject({
      method: 'POST',
      url: `/office/desk-reminders/${reminder.id}/read`,
      headers: auth(owner.token),
    })
    expect(read.statusCode).toBe(200)

    const senderNotification = await prisma.notification.findFirstOrThrow({
      where: { userId: sender.user.id, type: 'OFFICE_DESK_REMINDER_READ' },
    })
    expect(senderNotification.actorId).toBe(owner.user.id)

    const afterRead = await app.inject({ method: 'GET', url: '/office/map', headers: auth(owner.token) })
    expect((afterRead.json() as { deskReminders: unknown[] }).deskReminders).toEqual([])
    await app.close()
  })

  it('impede reivindicar uma segunda mesa sem abandonar a primeira', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'admin-desk-2', 'ADMIN')
    const legend = await makeUser(app, 'legend-desk-2', 'LEGEND')

    const created = await app.inject({
      method: 'POST', url: '/admin/office-maps', headers: auth(admin.token),
      payload: { name: 'Mapa com 2 mesas', width: 20, height: 16, tileSize: 32 },
    })
    const mapId = (created.json() as { map: { id: string } }).map.id
    const draftResponse = await app.inject({ method: 'GET', url: `/admin/office-maps/${mapId}/draft`, headers: auth(admin.token) })
    const draft = draftResponse.json() as { revision: number; document: MapDocumentV1 }
    draft.document.objects.push(
      { id: 'desk-1', layerKey: 'desks', type: 'desk', geometry: { kind: 'rectangle', x: 64, y: 64, width: 48, height: 32 }, properties: { externalKey: 'mesa-1', name: 'Mesa 1' } },
      { id: 'desk-2', layerKey: 'desks', type: 'desk', geometry: { kind: 'rectangle', x: 128, y: 64, width: 48, height: 32 }, properties: { externalKey: 'mesa-2', name: 'Mesa 2' } },
    )
    const lockResponse = await app.inject({ method: 'POST', url: `/admin/office-maps/${mapId}/lock`, headers: auth(admin.token) })
    const lock = lockResponse.json() as { lockToken: string }
    await app.inject({
      method: 'PUT', url: `/admin/office-maps/${mapId}/draft`,
      headers: auth(admin.token, { 'x-map-lock-token': lock.lockToken }),
      payload: { revision: draft.revision, document: draft.document },
    })
    await app.inject({
      method: 'POST', url: `/admin/office-maps/${mapId}/publications`, headers: auth(admin.token),
      payload: { revision: draft.revision + 1, activate: true },
    })

    const officeMap = await app.inject({ method: 'GET', url: '/office/map', headers: auth(legend.token) })
    const desks = (officeMap.json() as { desks: Array<{ id: string; externalKey: string }> }).desks
    const desk1 = desks.find((d) => d.externalKey === 'mesa-1')!
    const desk2 = desks.find((d) => d.externalKey === 'mesa-2')!

    await app.inject({ method: 'POST', url: `/office/desks/${desk1.id}/claim`, headers: auth(legend.token) })
    const secondClaim = await app.inject({ method: 'POST', url: `/office/desks/${desk2.id}/claim`, headers: auth(legend.token) })
    expect(secondClaim.statusCode).toBe(409)
    expect(secondClaim.json()).toMatchObject({ code: 'DESK_USER_ALREADY_HAS_DESK' })
    await app.close()
  })
})

// Não há teste de `/admin/office-rooms` neste arquivo pra reaproveitar setup — o
// helper mais próximo é `publishMapWithDesk` (acima), que publica um mapa de
// verdade via rotas admin. `publishMapWithRoom` segue o mesmo roteiro trocando o
// objeto `desk` por `meeting-room` (forma do objeto conforme
// office-meetings.test.ts / MeetingRoomObjectV1Schema).
describe('GET /office/rooms', () => {
  async function publishMapWithRoom(app: ReturnType<typeof buildApp>, admin: { token: string }) {
    const created = await app.inject({
      method: 'POST',
      url: '/admin/office-maps',
      headers: auth(admin.token),
      payload: { name: 'Mapa com sala', width: 20, height: 16, tileSize: 32 },
    })
    const mapId = (created.json() as { map: { id: string } }).map.id

    const draftResponse = await app.inject({
      method: 'GET', url: `/admin/office-maps/${mapId}/draft`, headers: auth(admin.token),
    })
    const draft = draftResponse.json() as { revision: number; document: MapDocumentV1 }
    draft.document.objects.push({
      id: 'room-1',
      layerKey: 'meeting-rooms',
      type: 'meeting-room',
      geometry: { kind: 'rectangle', x: 64, y: 64, width: 160, height: 128 },
      properties: { externalKey: 'sala-1', name: 'Sala 1', status: 'OPEN', voiceEnabled: true, accessPolicy: 'OPEN' },
    } as never)

    const lockResponse = await app.inject({
      method: 'POST', url: `/admin/office-maps/${mapId}/lock`, headers: auth(admin.token),
    })
    const lock = lockResponse.json() as { lockToken: string }

    await app.inject({
      method: 'PUT',
      url: `/admin/office-maps/${mapId}/draft`,
      headers: auth(admin.token, { 'x-map-lock-token': lock.lockToken }),
      payload: { revision: draft.revision, document: draft.document },
    })

    const published = await app.inject({
      method: 'POST',
      url: `/admin/office-maps/${mapId}/publications`,
      headers: auth(admin.token),
      payload: { revision: draft.revision + 1, activate: true },
    })
    expect(published.statusCode).toBe(201)
  }

  it('devolve as salas do mapa ativo sem a allowlist', async () => {
    const app = buildApp()
    await app.ready()
    const admin = await makeUser(app, 'admin-rooms', 'ADMIN')
    const legend = await makeUser(app, 'legend-rooms', 'LEGEND')
    await publishMapWithRoom(app, admin)

    const res = await app.inject({ method: 'GET', url: '/office/rooms', headers: auth(legend.token) })
    expect(res.statusCode).toBe(200)
    const rooms = res.json().rooms as Array<Record<string, unknown>>
    expect(rooms.map((r) => r.name)).toContain('Sala 1')
    expect(rooms[0]).not.toHaveProperty('allowedUsers')
    expect(rooms[0]).not.toHaveProperty('id')
    expect(rooms[0]).toHaveProperty('externalKey')
    await app.close()
  })

  it('devolve lista vazia quando não há mapa publicado', async () => {
    const app = buildApp()
    await app.ready()
    const legend = await makeUser(app, 'legend-rooms-empty', 'LEGEND')

    const res = await app.inject({ method: 'GET', url: '/office/rooms', headers: auth(legend.token) })
    expect(res.statusCode).toBe(200)
    expect(res.json().rooms).toEqual([])
    await app.close()
  })

  it('exige autenticação', async () => {
    const app = buildApp()
    await app.ready()
    expect((await app.inject({ method: 'GET', url: '/office/rooms' })).statusCode).toBe(401)
    await app.close()
  })

  // Não está no roteiro do brief, mas o Global Constraints e a auto-revisão exigem
  // barrar convidado — mesma regra de `/office/meetings` (office-meetings.ts, `isGuest`).
  it('convidado recebe 403', async () => {
    const app = buildApp()
    await app.ready()
    const guestPayload: {
      sub: string
      role: string
      sectorId: string
      companyId: string
      features: string[]
      guest: boolean
      name: string
      presetId: string
      inviteId: string
    } = {
      sub: 'guest-rooms-1', role: 'GUEST', sectorId: '', companyId: DEFAULT_COMPANY_ID,
      features: [], guest: true, name: 'Visita', presetId: 'p1', inviteId: 'i1',
    }
    const guestToken = app.jwt.sign(guestPayload)

    const res = await app.inject({ method: 'GET', url: '/office/rooms', headers: auth(guestToken) })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})

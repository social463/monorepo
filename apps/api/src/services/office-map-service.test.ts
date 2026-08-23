import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { OFFICE_TILESET_CATALOG, MapTileSizeSchema, DEFAULT_COMPANY_ID, createEmptyMapDocumentV1, type MapDocumentV1, type MapObjectV1 } from '@legends/shared'
import { prisma } from '../lib/prisma'
import {
  createOfficeMap,
  acquireOfficeMapLock,
  saveOfficeMapDraft,
  getOfficeMapDraft,
  publishOfficeMap,
  getActiveOfficeMap,
  getActiveMapIdForEditing,
  saveOfficeDecorationDraft,
  publishOfficeDecoration,
  renameOfficeMap,
  deleteOfficeMap,
  mergeAndPublishDecoration,
  listOfficeMaps,
  listOfficeMapAssets,
  listActiveOfficeRooms,
  listActiveOfficeDesks,
  claimOfficeDesk,
  updateOfficeRoom,
  listOfficeMapPublications,
  getOfficeMapPublication,
  activateOfficeMapPublication,
} from './office-map-service'

async function admin() {
  return prisma.user.create({ data: { name: 'Admin', email: `a${Date.now()}-${randomUUID()}@x.dev`, passwordHash: 'x', role: 'ADMIN' } })
}

async function member() {
  return prisma.user.create({ data: { name: 'Comum', email: `m${Date.now()}-${randomUUID()}@x.dev`, passwordHash: 'x', role: 'LEGEND' } })
}

function builtinTileset48() {
  const tileset = OFFICE_TILESET_CATALOG.find((entry) => entry.tileWidth === 48 && entry.tileHeight === 48)
  if (!tileset) throw new Error('Tileset builtin 48px não encontrado')
  return tileset
}

async function seedActiveMap(companyId: string = DEFAULT_COMPANY_ID) {
  const user = await admin()
  const { id: mapId } = await createOfficeMap({ name: 'Mapa', width: 20, height: 20, tileSize: 48 }, user.id, companyId)
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
  const lock = await acquireOfficeMapLock(mapId, user.id, companyId)
  const draft = await prisma.officeMapDraft.findUniqueOrThrow({ where: { mapId } })
  const saved = await saveOfficeMapDraft(mapId, { revision: draft.revision, document: doc }, user.id, lock.lockToken, companyId)
  await publishOfficeMap(mapId, saved.revision, user.id, true, companyId)
  const active = await getActiveOfficeMap(companyId)
  return { user, mapId, activeDoc: active.document, revision: saved.revision }
}

describe('auditoria', () => {
  it('audita create/rename/delete de mapa', async () => {
    const user = await admin()
    const map = await createOfficeMap({ name: 'Mapa Audit', width: 10, height: 10, tileSize: 32 }, user.id, DEFAULT_COMPANY_ID)
    await renameOfficeMap(map.id, 'Mapa Audit 2', user.id, DEFAULT_COMPANY_ID)
    await deleteOfficeMap(map.id, user.id, DEFAULT_COMPANY_ID)

    const rows = await prisma.adminAuditLog.findMany({
      where: { entityType: 'OfficeMap', entityId: map.id },
      orderBy: { createdAt: 'asc' },
    })
    expect(rows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE', 'DELETE'])
  })
})

describe('builtin tilesets', () => {
  it('valida e publica documento usando tileset builtin sem linha em OfficeMapAsset', async () => {
    const user = await admin()
    const { id: mapId } = await createOfficeMap({ name: 'Mapa', width: 20, height: 20, tileSize: 48 }, user.id, DEFAULT_COMPANY_ID)
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
    const lock = await acquireOfficeMapLock(mapId, user.id, DEFAULT_COMPANY_ID)
    const draft = await prisma.officeMapDraft.findUniqueOrThrow({ where: { mapId } })
    const saved = await saveOfficeMapDraft(mapId, { revision: draft.revision, document: doc }, user.id, lock.lockToken, DEFAULT_COMPANY_ID)
    const pub = await publishOfficeMap(mapId, saved.revision, user.id, true, DEFAULT_COMPANY_ID)
    expect(pub.activated).toBe(true)
    const active = await getActiveOfficeMap(DEFAULT_COMPANY_ID)
    expect(active.assets.some((a) => a.id === builtin.assetId && a.url === builtin.url)).toBe(true)
  })
})

describe('edição de decoração por membro', () => {
  it('resolve o mapId do publication ativo', async () => {
    const { mapId } = await seedActiveMap()
    await expect(getActiveMapIdForEditing(DEFAULT_COMPANY_ID)).resolves.toBe(mapId)
  })

  it('rejeita delta estrutural com 403', async () => {
    const { user, mapId, activeDoc, revision } = await seedActiveMap()
    const bad = JSON.parse(JSON.stringify(activeDoc))
    bad.map.width += 1
    const lock = await acquireOfficeMapLock(mapId, user.id, DEFAULT_COMPANY_ID)
    await expect(
      saveOfficeDecorationDraft({ revision, document: bad }, { id: user.id, role: 'ADMIN' }, lock.lockToken, DEFAULT_COMPANY_ID),
    ).rejects.toMatchObject({ status: 403, code: 'STRUCTURAL_EDIT_FORBIDDEN' })
  })

  it('aceita decoração e publica pelo caminho suave', async () => {
    const { user, mapId, activeDoc, revision } = await seedActiveMap()
    const good = JSON.parse(JSON.stringify(activeDoc))
    const objects = good.layers.find((l: any) => l.key === 'objects')
    if (objects) objects.data[0] = null // mudança inócua de decoração (segue válido)
    const lock = await acquireOfficeMapLock(mapId, user.id, DEFAULT_COMPANY_ID)
    const saved = await saveOfficeDecorationDraft(
      { revision, document: good },
      { id: user.id, role: 'ADMIN' },
      lock.lockToken,
      DEFAULT_COMPANY_ID,
    )
    const pub = await publishOfficeDecoration(saved.revision, { id: user.id, role: 'ADMIN' }, DEFAULT_COMPANY_ID)
    expect(pub.activated).toBe(true)
  })
})

function collisionObject(id: string, overrides: Partial<MapObjectV1> = {}): MapObjectV1 {
  return {
    id,
    layerKey: 'collision',
    type: 'collision',
    geometry: { kind: 'rectangle', x: 0, y: 0, width: 48, height: 48 },
    properties: {},
    ...overrides,
  } as MapObjectV1
}

/**
 * Monta um mapa ativo com dois objetos protegidos preexistentes: um criado
 * pelo admin (`adminObj`) e outro criado por um usuário comum (`outroObj`),
 * publicados via `mergeAndPublishDecoration` para que já saiam do server com
 * `createdBy` carimbado (mesmo caminho de produção).
 */
async function seedProtectedObjects() {
  const { user: adminUser, mapId } = await seedActiveMap()
  const comum = await member()
  const outroComum = await member()

  const active0 = await getActiveOfficeMap(DEFAULT_COMPANY_ID)
  const withAdminObj: MapDocumentV1 = {
    ...active0.document,
    objects: [...active0.document.objects, collisionObject('admin-obj')],
  }
  const afterAdmin = await mergeAndPublishDecoration(
    { baseRevision: active0.decorRevision, document: withAdminObj },
    { id: adminUser.id, role: 'ADMIN' },
    DEFAULT_COMPANY_ID,
  )

  const withOutroObj: MapDocumentV1 = {
    ...afterAdmin.document,
    objects: [...afterAdmin.document.objects, collisionObject('outro-comum-obj')],
  }
  const afterOutro = await mergeAndPublishDecoration(
    { baseRevision: afterAdmin.decorRevision, document: withOutroObj },
    { id: outroComum.id, role: 'LEGEND' },
    DEFAULT_COMPANY_ID,
  )

  return {
    mapId,
    adminUser,
    comum,
    outroComum,
    activeRevision: afterOutro.decorRevision,
    doc: afterOutro.document,
  }
}

describe('proteção de estruturas do admin (decoração)', () => {
  it('comum não pode apagar objeto do admin (403)', async () => {
    const { comum, activeRevision, doc } = await seedProtectedObjects()
    const docSemOColisionDoAdmin: MapDocumentV1 = {
      ...doc,
      objects: doc.objects.filter((o) => o.id !== 'admin-obj'),
    }
    await expect(
      mergeAndPublishDecoration(
        { baseRevision: activeRevision, document: docSemOColisionDoAdmin },
        { id: comum.id, role: 'LEGEND' },
        DEFAULT_COMPANY_ID,
      ),
    ).rejects.toMatchObject({ status: 403, code: 'STRUCTURAL_EDIT_FORBIDDEN' })
  })

  it('comum pode apagar objeto de outro comum', async () => {
    const { comum, activeRevision, doc } = await seedProtectedObjects()
    const docSemOColisionDoOutroComum: MapDocumentV1 = {
      ...doc,
      objects: doc.objects.filter((o) => o.id !== 'outro-comum-obj'),
    }
    const r = await mergeAndPublishDecoration(
      { baseRevision: activeRevision, document: docSemOColisionDoOutroComum },
      { id: comum.id, role: 'LEGEND' },
      DEFAULT_COMPANY_ID,
    )
    expect(r.decorRevision).toBeGreaterThan(activeRevision)
    expect(r.document.objects.find((o) => o.id === 'outro-comum-obj')).toBeUndefined()
  })

  it('objeto novo do comum nasce com createdBy do comum', async () => {
    const { comum, activeRevision, doc } = await seedProtectedObjects()
    const novoId = 'mobilia-nova-do-comum'
    const docComMobiliaNovaDoComum: MapDocumentV1 = {
      ...doc,
      objects: [...doc.objects, collisionObject(novoId)],
    }
    const r = await mergeAndPublishDecoration(
      { baseRevision: activeRevision, document: docComMobiliaNovaDoComum },
      { id: comum.id, role: 'LEGEND' },
      DEFAULT_COMPANY_ID,
    )
    const novo = r.document.objects.find((o) => o.id === novoId)
    expect(novo?.createdBy).toEqual({ id: comum.id, role: 'LEGEND' })
  })

  it('server sobrescreve createdBy forjado em objeto novo', async () => {
    const { comum, activeRevision, doc } = await seedProtectedObjects()
    const forjado = collisionObject('mobilia-forjada', {
      createdBy: { id: 'x', role: 'ADMIN' },
    })
    const docComObjetoForjado: MapDocumentV1 = {
      ...doc,
      objects: [...doc.objects, forjado],
    }
    const r = await mergeAndPublishDecoration(
      { baseRevision: activeRevision, document: docComObjetoForjado },
      { id: comum.id, role: 'LEGEND' },
      DEFAULT_COMPANY_ID,
    )
    const novo = r.document.objects.find((o) => o.id === forjado.id)
    expect(novo?.createdBy).toEqual({ id: comum.id, role: 'LEGEND' })
  })
})

describe('isolamento multi-empresa (CRUD de mapa + assets)', () => {
  async function otherCompany(slug: string) {
    return prisma.company.create({ data: { name: slug, slug } })
  }

  it('listOfficeMaps de uma empresa não lista mapa de outra', async () => {
    const user = await admin()
    const company = await otherCompany('outra-empresa-map-list-test')
    await createOfficeMap({ name: 'Mapa Empresa A', width: 10, height: 10, tileSize: 32 }, user.id, DEFAULT_COMPANY_ID)
    await createOfficeMap({ name: 'Mapa Empresa B', width: 10, height: 10, tileSize: 32 }, user.id, company.id)

    const listA = await listOfficeMaps(DEFAULT_COMPANY_ID)
    const listB = await listOfficeMaps(company.id)
    expect(listA.some((m) => m.name === 'Mapa Empresa B')).toBe(false)
    expect(listB.some((m) => m.name === 'Mapa Empresa A')).toBe(false)
  })

  it('renameOfficeMap com companyId de outra empresa dá 404', async () => {
    const user = await admin()
    const company = await otherCompany('outra-empresa-map-rename-test')
    const map = await createOfficeMap({ name: 'Mapa Rename', width: 10, height: 10, tileSize: 32 }, user.id, DEFAULT_COMPANY_ID)
    await expect(renameOfficeMap(map.id, 'Hackeado', user.id, company.id)).rejects.toMatchObject({ status: 404, code: 'MAP_NOT_FOUND' })
  })

  it('deleteOfficeMap com companyId de outra empresa dá 404 e não apaga o mapa', async () => {
    const user = await admin()
    const company = await otherCompany('outra-empresa-map-delete-test')
    const map = await createOfficeMap({ name: 'Mapa Delete', width: 10, height: 10, tileSize: 32 }, user.id, DEFAULT_COMPANY_ID)
    await expect(deleteOfficeMap(map.id, user.id, company.id)).rejects.toMatchObject({ status: 404, code: 'MAP_NOT_FOUND' })
    await expect(prisma.officeMap.findUniqueOrThrow({ where: { id: map.id } })).resolves.toBeTruthy()
  })

  it('listOfficeMapAssets com companyId de outra empresa dá 404 em vez de vazar', async () => {
    const user = await admin()
    const company = await otherCompany('outra-empresa-map-assets-test')
    const map = await createOfficeMap({ name: 'Mapa Assets', width: 10, height: 10, tileSize: 32 }, user.id, DEFAULT_COMPANY_ID)
    await expect(listOfficeMapAssets(map.id, company.id)).rejects.toMatchObject({ status: 404, code: 'MAP_NOT_FOUND' })
  })

  it('createOfficeMap cria o OfficeMapDraft com o companyId real, não o default do banco', async () => {
    const user = await admin()
    const company = await otherCompany('outra-empresa-draft-companyid-test')
    const map = await createOfficeMap({ name: 'Mapa Draft CompanyId', width: 10, height: 10, tileSize: 32 }, user.id, company.id)
    const draft = await prisma.officeMapDraft.findUniqueOrThrow({ where: { mapId: map.id } })
    expect(draft.companyId).toBe(company.id)
  })
})

describe('isolamento multi-empresa (salas e mesas)', () => {
  async function otherCompany(slug: string) {
    return prisma.company.create({ data: { name: slug, slug } })
  }

  // `seedActiveMap` publica um documento sem objetos `meeting-room`/`desk` (só um
  // tile na layer `objects`), então `materializePublication` não cria nenhuma linha
  // de `OfficeRoom`/`OfficeDesk` pra ele. Em vez de montar um documento inteiro só
  // pra estes testes, insere a sala/mesa direto contra a publicação ativa já
  // materializada — mais direto, e testa a mesma coisa (isolamento por companyId).
  async function seedRoomAndDesk(companyId: string) {
    const { mapId } = await seedActiveMap(companyId)
    const active = await getActiveOfficeMap(companyId)
    const room = await prisma.officeRoom.create({
      data: {
        mapPublicationId: active.publication.id,
        name: 'Sala Teste',
        externalKey: `sala-teste-${Date.now()}-${Math.random()}`,
        companyId,
      },
    })
    const desk = await prisma.officeDesk.create({
      data: {
        mapPublicationId: active.publication.id,
        name: 'Mesa Teste',
        externalKey: `mesa-teste-${Date.now()}-${Math.random()}`,
        companyId,
      },
    })
    return { mapId, room, desk }
  }

  it('getActiveOfficeMap de uma empresa não enxerga o mapa ativo de outra', async () => {
    const { mapId: mapIdA } = await seedActiveMap()
    const company = await otherCompany('outra-empresa-active-map-test')
    await expect(getActiveOfficeMap(company.id)).rejects.toMatchObject({ status: 404, code: 'ACTIVE_MAP_NOT_FOUND' })
    const activeA = await getActiveOfficeMap(DEFAULT_COMPANY_ID)
    expect(activeA.map.id).toBe(mapIdA)
  })

  it('claimOfficeDesk com companyId de outra empresa dá 404, não vaza mesa alheia', async () => {
    const { desk } = await seedRoomAndDesk(DEFAULT_COMPANY_ID)
    const company = await otherCompany('outra-empresa-desk-claim-test')
    const otherUser = await member()
    await expect(claimOfficeDesk(desk.id, otherUser.id, company.id)).rejects.toMatchObject({ status: 404, code: 'DESK_NOT_FOUND' })
    const claim = await prisma.officeDeskClaim.findUnique({ where: { deskId: desk.id } })
    expect(claim).toBeNull()
  })

  it('listActiveOfficeRooms/listActiveOfficeDesks de uma empresa sem mapa ativo retornam vazio, não o da outra', async () => {
    await seedRoomAndDesk(DEFAULT_COMPANY_ID)
    const company = await otherCompany('outra-empresa-rooms-desks-test')
    expect(await listActiveOfficeRooms(company.id)).toEqual([])
    expect(await listActiveOfficeDesks(company.id)).toEqual([])
  })

  it('updateOfficeRoom com companyId de outra empresa dá 404, não altera a sala', async () => {
    const { room } = await seedRoomAndDesk(DEFAULT_COMPANY_ID)
    const company = await otherCompany('outra-empresa-room-update-test')
    const actor = await admin()
    await expect(updateOfficeRoom(room.id, { status: 'LOCKED' }, actor.id, company.id)).rejects.toMatchObject({ status: 404, code: 'ROOM_NOT_FOUND' })
    const stillOpen = await prisma.officeRoom.findUniqueOrThrow({ where: { id: room.id } })
    expect(stillOpen.status).toBe('OPEN')
  })
})

describe('isolamento multi-empresa (publicação)', () => {
  async function otherCompany(slug: string) {
    return prisma.company.create({ data: { name: slug, slug } })
  }

  it('materializePublication cria OfficeRoom/OfficeDesk com o companyId real, não o default do banco', async () => {
    const company = await otherCompany('outra-empresa-materialize-test')
    const { mapId } = await seedActiveMap(company.id)
    const active = await getActiveOfficeMap(company.id)
    expect(active.map.id).toBe(mapId)
    const rooms = await prisma.officeRoom.findMany({ where: { mapPublication: { mapId } } })
    const desks = await prisma.officeDesk.findMany({ where: { mapPublication: { mapId } } })
    for (const room of rooms) expect(room.companyId).toBe(company.id)
    for (const desk of desks) expect(desk.companyId).toBe(company.id)
    const publication = await prisma.officeMapPublication.findFirstOrThrow({ where: { mapId } })
    expect(publication.companyId).toBe(company.id)
  })

  it('listOfficeMapPublications/getOfficeMapPublication com companyId de outra empresa dá 404', async () => {
    const { mapId } = await seedActiveMap()
    const company = await otherCompany('outra-empresa-pub-list-test')
    await expect(listOfficeMapPublications(mapId, company.id)).rejects.toMatchObject({ status: 404, code: 'MAP_NOT_FOUND' })
    const pubs = await prisma.officeMapPublication.findMany({ where: { mapId } })
    await expect(getOfficeMapPublication(mapId, pubs[0]!.id, company.id)).rejects.toMatchObject({ status: 404 })
  })

  it('activateOfficeMapPublication com companyId de outra empresa dá 404 e não ativa nada', async () => {
    const { mapId } = await seedActiveMap()
    const company = await otherCompany('outra-empresa-pub-activate-test')
    const pubs = await prisma.officeMapPublication.findMany({ where: { mapId } })
    const actor = await admin()
    await expect(activateOfficeMapPublication(pubs[0]!.id, actor.id, company.id)).rejects.toMatchObject({ status: 404, code: 'PUBLICATION_NOT_FOUND' })
    await expect(getOfficeSettingActive(company.id)).resolves.toBeNull()
  })
})

async function getOfficeSettingActive(companyId: string) {
  const row = await prisma.officeSetting.findUnique({ where: { companyId }, select: { activeMapPublicationId: true } })
  return row?.activeMapPublicationId ?? null
}

describe('isolamento multi-empresa (rascunho e lock)', () => {
  async function otherCompany(slug: string) {
    return prisma.company.create({ data: { name: slug, slug } })
  }

  it('getOfficeMapDraft com companyId de outra empresa dá 404', async () => {
    const user = await admin()
    const company = await otherCompany('outra-empresa-draft-test')
    const map = await createOfficeMap({ name: 'Mapa Draft', width: 10, height: 10, tileSize: 32 }, user.id, DEFAULT_COMPANY_ID)
    await expect(getOfficeMapDraft(map.id, company.id)).rejects.toMatchObject({ status: 404, code: 'MAP_NOT_FOUND' })
  })

  it('acquireOfficeMapLock com companyId de outra empresa dá 404, não pega o lock de fato', async () => {
    const user = await admin()
    const company = await otherCompany('outra-empresa-lock-test')
    const map = await createOfficeMap({ name: 'Mapa Lock', width: 10, height: 10, tileSize: 32 }, user.id, DEFAULT_COMPANY_ID)
    await expect(acquireOfficeMapLock(map.id, user.id, company.id)).rejects.toMatchObject({ status: 404, code: 'MAP_NOT_FOUND' })
    const lock = await prisma.officeMapEditLock.findUnique({ where: { mapId: map.id } })
    expect(lock).toBeNull()
  })

  it('saveOfficeMapDraft com companyId de outra empresa dá 404, não altera o rascunho', async () => {
    const user = await admin()
    const company = await otherCompany('outra-empresa-save-draft-test')
    const map = await createOfficeMap({ name: 'Mapa Save', width: 10, height: 10, tileSize: 32 }, user.id, DEFAULT_COMPANY_ID)
    const lock = await acquireOfficeMapLock(map.id, user.id, DEFAULT_COMPANY_ID)
    const draft = await prisma.officeMapDraft.findUniqueOrThrow({ where: { mapId: map.id } })
    await expect(
      saveOfficeMapDraft(map.id, { revision: draft.revision, document: draft.document }, user.id, lock.lockToken, company.id),
    ).rejects.toMatchObject({ status: 404, code: 'MAP_NOT_FOUND' })
    const stillSame = await prisma.officeMapDraft.findUniqueOrThrow({ where: { mapId: map.id } })
    expect(stillSame.revision).toBe(draft.revision)
  })
})

describe('acquireOfficeMapLock — corrida de criação (P2002)', () => {
  it('duas chamadas concorrentes pro mesmo mapId sem lock existente resolvem: uma pega o lock, a outra recebe 423 MAP_LOCKED (não um 500 cru)', async () => {
    // Força a corrida real contra o Postgres: como `acquireOfficeMapLock` não é mais um
    // `upsert` atômico (ver comentário no service), duas chamadas disparadas via
    // `Promise.all` no mesmo tick executam o `findUnique` inicial de cada uma antes de
    // qualquer `create` ter sido commitado — as duas leem `existing === null` e as duas
    // tentam `db.officeMapEditLock.create(...)`. A segunda viola o `@unique` em `mapId`
    // (P2002); sem o catch, isso subiria cru como 500. Repetimos a corrida várias vezes
    // (mapas novos e sem lock a cada rodada) porque o timing não é 100% determinístico —
    // qualquer rodada em que a segunda chamada não caia no `catch` do `create` ainda cai
    // no `if (existing && ...)` acima dele, então a asserção abaixo (exatamente um
    // sucesso, o outro 423 MAP_LOCKED, nunca uma exceção não tratada) vale nos dois casos
    // e cobre o comportamento correto ponta a ponta.
    for (let round = 0; round < 5; round++) {
      const userA = await admin()
      const userB = await member()
      const map = await createOfficeMap({ name: `Mapa Corrida ${round}`, width: 10, height: 10, tileSize: 32 }, userA.id, DEFAULT_COMPANY_ID)
      const existingLock = await prisma.officeMapEditLock.findUnique({ where: { mapId: map.id } })
      expect(existingLock).toBeNull()

      const settled = await Promise.allSettled([
        acquireOfficeMapLock(map.id, userA.id, DEFAULT_COMPANY_ID),
        acquireOfficeMapLock(map.id, userB.id, DEFAULT_COMPANY_ID),
      ])

      const fulfilled = settled.filter((r) => r.status === 'fulfilled')
      const rejected = settled.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      // Nunca um PrismaClientKnownRequestError cru vazando pro caller — sempre o erro de
      // domínio 423/MAP_LOCKED que a função já usa pro caso síncrono.
      expect(rejected[0].reason).toMatchObject({ status: 423, code: 'MAP_LOCKED' })
      expect(rejected[0].reason.code).not.toBe('P2002')

      const finalLock = await prisma.officeMapEditLock.findUniqueOrThrow({ where: { mapId: map.id } })
      expect([userA.id, userB.id]).toContain(finalLock.userId)
    }
  })
})

import { randomUUID } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import {
  OFFICE_TILESET_CATALOG,
  OFFICE_DECOR_REVISION_RING,
  OFFICE_MAP_PUBLICATION_LIMIT,
  MapTileSizeSchema,
  DEFAULT_COMPANY_ID,
  createEmptyMapDocumentV1,
  type MapDocumentV1,
  type MapObjectV1,
} from '@legends/shared'
import { prisma } from '../lib/prisma'
import {
  createOfficeMap,
  acquireOfficeMapLock,
  saveOfficeMapDraft,
  publishOfficeMap,
  getActiveOfficeMap,
  mergeAndPublishDecoration,
  listActiveOfficeRooms,
  listActiveOfficeDesks,
  listOfficeMapPublications,
  activateOfficeMapPublication,
  claimOfficeDesk,
  updateOfficeRoom,
} from './office-map-service'

async function admin() {
  return prisma.user.create({
    data: { name: 'Admin', email: `a${Date.now()}-${randomUUID()}@x.dev`, passwordHash: 'x', role: 'ADMIN' },
  })
}

async function member() {
  return prisma.user.create({
    data: { name: 'Comum', email: `m${Date.now()}-${randomUUID()}@x.dev`, passwordHash: 'x', role: 'LEGEND' },
  })
}

function builtinTileset48() {
  const tileset = OFFICE_TILESET_CATALOG.find((entry) => entry.tileWidth === 48 && entry.tileHeight === 48)
  if (!tileset) throw new Error('Tileset builtin 48px não encontrado')
  return tileset
}

function tileObj(id: string, x: number, y: number): MapObjectV1 {
  return {
    id,
    layerKey: 'objects',
    type: 'tile-object',
    geometry: { kind: 'rectangle', x, y, width: 48, height: 48 },
    properties: { tilesetId: 'ts1', tileIndex: 0 },
  } as MapObjectV1
}

function roomObj(id: string, x: number): MapObjectV1 {
  return {
    id,
    layerKey: 'meeting-rooms',
    type: 'meeting-room',
    geometry: { kind: 'rectangle', x, y: 240, width: 144, height: 96 },
    properties: { externalKey: id, name: `Sala ${id}`, status: 'OPEN', voiceEnabled: true, accessPolicy: 'OPEN' },
  } as MapObjectV1
}

function deskObj(id: string, x: number): MapObjectV1 {
  return {
    id,
    layerKey: 'desks',
    type: 'desk',
    geometry: { kind: 'rectangle', x, y: 480, width: 144, height: 96 },
    properties: { externalKey: id, name: `Mesa ${id}` },
  } as MapObjectV1
}

function withObjects(doc: MapDocumentV1, ...objects: MapObjectV1[]): MapDocumentV1 {
  return { ...doc, objects: [...doc.objects, ...objects] }
}

/**
 * Publica um mapa estruturalmente (caminho do admin) e devolve o estado ativo.
 * `extraObjects` entram já na primeira publicação — é o único caminho que cria
 * mesa, já que o editor de decoração do membro não tem ferramenta de mesa.
 */
async function seedActiveMap(extraObjects: MapObjectV1[] = []) {
  const user = await admin()
  const { id: mapId } = await createOfficeMap({ name: 'Mapa', width: 20, height: 20, tileSize: 48 }, user.id, DEFAULT_COMPANY_ID)
  const builtin = builtinTileset48()
  const doc = createEmptyMapDocumentV1({ width: 20, height: 20, tileSize: 48 })
  doc.tilesets.push({
    id: 'ts1',
    assetId: builtin.assetId,
    name: builtin.name,
    tileWidth: MapTileSizeSchema.parse(builtin.tileWidth),
    tileHeight: MapTileSizeSchema.parse(builtin.tileHeight),
    columns: builtin.columns,
    tileCount: builtin.tileCount,
  })
  doc.objects.push(...extraObjects)
  const lock = await acquireOfficeMapLock(mapId, user.id, DEFAULT_COMPANY_ID)
  const draft = await prisma.officeMapDraft.findUniqueOrThrow({ where: { mapId } })
  const saved = await saveOfficeMapDraft(mapId, { revision: draft.revision, document: doc }, user.id, lock.lockToken, DEFAULT_COMPANY_ID)
  await publishOfficeMap(mapId, saved.revision, user.id, true, DEFAULT_COMPANY_ID)
  const active = await getActiveOfficeMap(DEFAULT_COMPANY_ID)
  return {
    mapId,
    userId: user.id,
    draftRevision: saved.revision,
    baseRevision: active.decorRevision,
    baseDoc: active.document,
    publicationId: active.publication.id,
  }
}

function saveDecor(baseRevision: number, document: MapDocumentV1, userId: string) {
  return mergeAndPublishDecoration({ baseRevision, document }, { id: userId, role: 'ADMIN' }, DEFAULT_COMPANY_ID)
}

describe('save de decoração in-place', () => {
  it('não cria publicação nova e incrementa decorRevision', async () => {
    const { mapId, baseRevision, baseDoc, userId, publicationId } = await seedActiveMap()

    const result = await saveDecor(baseRevision, withObjects(baseDoc, tileObj('novo', 48, 0)), userId)

    expect(result.decorRevision).toBe(baseRevision + 1)
    const publications = await prisma.officeMapPublication.findMany({ where: { mapId } })
    expect(publications).toHaveLength(1)
    expect(publications[0].id).toBe(publicationId)
    expect(publications[0].decorRevision).toBe(baseRevision + 1)

    const active = await getActiveOfficeMap(DEFAULT_COMPANY_ID)
    expect(active.publication.id).toBe(publicationId)
    expect(active.decorRevision).toBe(baseRevision + 1)
    expect(active.document.objects.map((o) => o.id)).toContain('novo')
  })

  it(`retém no máximo ${OFFICE_DECOR_REVISION_RING} revisões e descarta a mais antiga`, async () => {
    const { baseRevision, baseDoc, userId, publicationId } = await seedActiveMap()

    const saves = OFFICE_DECOR_REVISION_RING + 2
    let revision = baseRevision
    let doc = baseDoc
    for (let i = 0; i < saves; i += 1) {
      const result = await saveDecor(revision, withObjects(doc, tileObj(`obj-${i}`, 48 * (i + 1), 0)), userId)
      revision = result.decorRevision
      doc = result.document
    }

    const rows = await prisma.officeMapDecorRevision.findMany({
      where: { publicationId },
      orderBy: { revision: 'asc' },
      select: { revision: true },
    })
    expect(rows).toHaveLength(OFFICE_DECOR_REVISION_RING)
    // `saves` revisões foram empurradas (0..saves-1); sobram as mais recentes.
    expect(rows[0].revision).toBe(saves - OFFICE_DECOR_REVISION_RING)
    expect(rows[rows.length - 1].revision).toBe(saves - 1)
  })

  it('usa o anel como base do merge: editor defasado não apaga o objeto do outro', async () => {
    const { baseRevision, baseDoc, userId } = await seedActiveMap()

    // Editor A publica 'a-1' e avança a revisão.
    const a = await saveDecor(baseRevision, withObjects(baseDoc, tileObj('a-1', 48, 0)), userId)
    expect(a.document.objects.map((o) => o.id)).toContain('a-1')

    // Editor B ainda está ancorado na revisão original e nunca viu 'a-1'.
    const b = await saveDecor(baseRevision, withObjects(baseDoc, tileObj('b-1', 96, 0)), userId)

    const ids = b.document.objects.map((o) => o.id)
    expect(ids).toEqual(expect.arrayContaining(['a-1', 'b-1']))
    expect(b.decorRevision).toBe(a.decorRevision + 1)
  })

  it('cai no fallback quando a revisão base já saiu do anel', async () => {
    const { baseRevision, baseDoc, userId, publicationId } = await seedActiveMap()

    let revision = baseRevision
    let doc = baseDoc
    for (let i = 0; i <= OFFICE_DECOR_REVISION_RING; i += 1) {
      const result = await saveDecor(revision, withObjects(doc, tileObj(`obj-${i}`, 48 * (i + 1), 0)), userId)
      revision = result.decorRevision
      doc = result.document
    }
    const dropped = await prisma.officeMapDecorRevision.findUnique({
      where: { publicationId_revision: { publicationId, revision: baseRevision } },
    })
    expect(dropped).toBeNull()

    const result = await saveDecor(baseRevision, withObjects(baseDoc, tileObj('atrasado', 48 * 19, 0)), userId)
    expect(result.document.objects.map((o) => o.id)).toContain('atrasado')
  })

  // Regressão da revisão cruzada: sob `Serializable` o Postgres aborta a
  // transação perdedora com P2034 ANTES de a guarda otimista devolver
  // `count === 0`. Sem tratar esse código como conflito retryable, uma das
  // pessoas levava 500 e a edição dela sumia.
  it('dois saves simultâneos na mesma revisão preservam as duas edições', async () => {
    const { baseRevision, baseDoc, userId } = await seedActiveMap()

    const [a, b] = await Promise.all([
      saveDecor(baseRevision, withObjects(baseDoc, tileObj('a-1', 48, 0)), userId),
      saveDecor(baseRevision, withObjects(baseDoc, tileObj('b-1', 96, 0)), userId),
    ])

    expect([a.decorRevision, b.decorRevision].sort()).toEqual([baseRevision + 1, baseRevision + 2])
    const active = await getActiveOfficeMap(DEFAULT_COMPANY_ID)
    expect(active.document.objects.map((o) => o.id)).toEqual(expect.arrayContaining(['a-1', 'b-1']))
  })

  it('preserva a claim de mesa', async () => {
    const { baseRevision, baseDoc, userId } = await seedActiveMap([deskObj('mesa-1', 0)])
    const comum = await member()
    const [desk] = await listActiveOfficeDesks(DEFAULT_COMPANY_ID)
    await claimOfficeDesk(desk.id, comum.id, DEFAULT_COMPANY_ID)

    await saveDecor(baseRevision, withObjects(baseDoc, tileObj('novo', 48, 0)), userId)

    const desksDepois = await listActiveOfficeDesks(DEFAULT_COMPANY_ID)
    expect(desksDepois).toHaveLength(1)
    expect(desksDepois[0].id).toBe(desk.id)
    expect(desksDepois[0].claimedBy?.id).toBe(comum.id)
  })
})

/**
 * A reivindicação é do MAPA ATIVO. Ela viaja para a publicação nova enquanto a
 * mesa existir (mesmo `externalKey`); sumindo a mesa, some junto. O que não
 * pode é sobrar presa a uma publicação superada: `userId` é @unique em
 * `OfficeDeskClaim`, então uma claim órfã travava a pessoa para sempre —
 * bloqueava reivindicar e o release recusava a mesa não-ativa com 404.
 */
describe('reivindicação de mesa quando o mapa muda', () => {
  /** Republica o mapa estruturalmente (caminho do admin) com outro conjunto de objetos. */
  async function republicar(mapId: string, userId: string, objects: MapObjectV1[]) {
    const builtin = builtinTileset48()
    const doc = createEmptyMapDocumentV1({ width: 20, height: 20, tileSize: 48 })
    doc.tilesets.push({
      id: 'ts1',
      assetId: builtin.assetId,
      name: builtin.name,
      tileWidth: MapTileSizeSchema.parse(builtin.tileWidth),
      tileHeight: MapTileSizeSchema.parse(builtin.tileHeight),
      columns: builtin.columns,
      tileCount: builtin.tileCount,
    })
    doc.objects.push(...objects)
    const lock = await acquireOfficeMapLock(mapId, userId, DEFAULT_COMPANY_ID)
    const draft = await prisma.officeMapDraft.findUniqueOrThrow({ where: { mapId } })
    const saved = await saveOfficeMapDraft(mapId, { revision: draft.revision, document: doc }, userId, lock.lockToken, DEFAULT_COMPANY_ID)
    await publishOfficeMap(mapId, saved.revision, userId, true, DEFAULT_COMPANY_ID)
  }

  async function seedComMesaReivindicada() {
    const { mapId, userId } = await seedActiveMap([deskObj('mesa-1', 0)])
    const comum = await member()
    const [desk] = await listActiveOfficeDesks(DEFAULT_COMPANY_ID)
    await claimOfficeDesk(desk.id, comum.id, DEFAULT_COMPANY_ID)
    return { mapId, userId, comum, deskAntigoId: desk.id }
  }

  it('mantém a reivindicação da mesa que sobreviveu à republicação', async () => {
    const { mapId, userId, comum } = await seedComMesaReivindicada()

    await republicar(mapId, userId, [deskObj('mesa-1', 0), deskObj('mesa-2', 288)])

    const depois = await listActiveOfficeDesks(DEFAULT_COMPANY_ID)
    expect(depois.find((desk) => desk.externalKey === 'mesa-1')?.claimedBy?.id).toBe(comum.id)
    expect(await prisma.officeDeskClaim.count()).toBe(1)
  })

  it('zera a reivindicação da mesa que saiu do mapa', async () => {
    const { mapId, userId } = await seedComMesaReivindicada()

    await republicar(mapId, userId, [deskObj('mesa-2', 288)])

    expect(await prisma.officeDeskClaim.count()).toBe(0)
  })

  /**
   * Regressão do dado que já existe em HML: claim apontando para a mesa de uma
   * publicação antiga. Ela não pode barrar a reivindicação no mapa ativo — e
   * some no caminho, senão o @unique por usuário derruba o insert.
   */
  it('claim presa a publicação superada não bloqueia reivindicar no mapa ativo', async () => {
    const { mapId, userId, comum, deskAntigoId } = await seedComMesaReivindicada()
    await republicar(mapId, userId, [deskObj('mesa-2', 288)])
    await prisma.officeDeskClaim.create({ data: { deskId: deskAntigoId, userId: comum.id, companyId: DEFAULT_COMPANY_ID } })

    const [mesaAtiva] = await listActiveOfficeDesks(DEFAULT_COMPANY_ID)
    await expect(claimOfficeDesk(mesaAtiva.id, comum.id, DEFAULT_COMPANY_ID)).resolves.toMatchObject({
      claimedBy: { id: comum.id },
    })

    const claims = await prisma.officeDeskClaim.findMany()
    expect(claims).toHaveLength(1)
    expect(claims[0].deskId).toBe(mesaAtiva.id)
  })

  it('continua bloqueando quando a mesa ocupada é do próprio mapa ativo', async () => {
    const { mapId, userId, comum } = await seedComMesaReivindicada()
    await republicar(mapId, userId, [deskObj('mesa-1', 0), deskObj('mesa-2', 288)])

    const mesa2 = (await listActiveOfficeDesks(DEFAULT_COMPANY_ID)).find((desk) => desk.externalKey === 'mesa-2')!
    await expect(claimOfficeDesk(mesa2.id, comum.id, DEFAULT_COMPANY_ID)).rejects.toMatchObject({
      status: 409,
      code: 'DESK_USER_ALREADY_HAS_DESK',
    })
  })
})

describe('reconciliação de salas no save de decoração', () => {
  it('cria sala nova adicionada pela decoração', async () => {
    const { baseRevision, baseDoc, userId } = await seedActiveMap()

    await saveDecor(baseRevision, withObjects(baseDoc, roomObj('sala-nova', 0)), userId)

    const rooms = await listActiveOfficeRooms(DEFAULT_COMPANY_ID)
    expect(rooms.map((room) => room.externalKey)).toEqual(['sala-nova'])
  })

  it('preserva status, capacidade e concessões da sala que continua no documento', async () => {
    const { baseRevision, baseDoc, userId } = await seedActiveMap([roomObj('sala-1', 0)])
    const convidado = await member()
    const [room] = await listActiveOfficeRooms(DEFAULT_COMPANY_ID)
    await updateOfficeRoom(
      room.id,
      { status: 'LOCKED', capacity: 4, accessPolicy: 'ALLOWLIST', allowedUserIds: [convidado.id] },
      userId,
      DEFAULT_COMPANY_ID,
    )

    await saveDecor(baseRevision, withObjects(baseDoc, tileObj('novo', 48, 0)), userId)

    const [depois] = await listActiveOfficeRooms(DEFAULT_COMPANY_ID)
    expect(depois.id).toBe(room.id)
    expect(depois.status).toBe('LOCKED')
    expect(depois.capacity).toBe(4)
    expect(depois.accessPolicy).toBe('ALLOWLIST')
    expect(depois.allowedUsers.map((user) => user.id)).toEqual([convidado.id])
  })

  it('remove a sala que saiu do documento', async () => {
    const { baseRevision, baseDoc, userId } = await seedActiveMap([roomObj('sala-1', 0)])
    expect(await listActiveOfficeRooms(DEFAULT_COMPANY_ID)).toHaveLength(1)

    const semSala: MapDocumentV1 = { ...baseDoc, objects: baseDoc.objects.filter((o) => o.id !== 'sala-1') }
    await saveDecor(baseRevision, semSala, userId)

    expect(await listActiveOfficeRooms(DEFAULT_COMPANY_ID)).toHaveLength(0)
  })
})

describe('salas na republicação estrutural', () => {
  it('mantém sem limite a sala cujo limite o admin removeu, mesmo com capacidade no documento', async () => {
    const comCapacidade = { ...roomObj('sala-1', 0) } as Extract<MapObjectV1, { type: 'meeting-room' }>
    comCapacidade.properties = { ...comCapacidade.properties, capacity: 8 }
    const { mapId, draftRevision, userId } = await seedActiveMap([comCapacidade])
    const [room] = await listActiveOfficeRooms(DEFAULT_COMPANY_ID)
    expect(room.capacity).toBe(8)
    await updateOfficeRoom(room.id, { capacity: null }, userId, DEFAULT_COMPANY_ID)

    await publishOfficeMap(mapId, draftRevision, userId, true, DEFAULT_COMPANY_ID)

    const [depois] = await listActiveOfficeRooms(DEFAULT_COMPANY_ID)
    expect(depois.capacity).toBeNull()
  })
})

describe('poda de publicações no publish estrutural', () => {
  async function publishAgain(mapId: string, draftRevision: number, userId: string, activate: boolean) {
    return publishOfficeMap(mapId, draftRevision, userId, activate, DEFAULT_COMPANY_ID)
  }

  it(`retém no máximo ${OFFICE_MAP_PUBLICATION_LIMIT} publicações por mapa`, async () => {
    const { mapId, draftRevision, userId } = await seedActiveMap()
    const total = OFFICE_MAP_PUBLICATION_LIMIT + 2
    for (let i = 1; i < total; i += 1) await publishAgain(mapId, draftRevision, userId, true)

    const publications = await listOfficeMapPublications(mapId, DEFAULT_COMPANY_ID)
    expect(publications).toHaveLength(OFFICE_MAP_PUBLICATION_LIMIT)
    expect(publications.map((publication) => publication.version)).toEqual(
      Array.from({ length: OFFICE_MAP_PUBLICATION_LIMIT }, (_, i) => total - i),
    )
  })

  it('nunca poda a publicação ativa, e ela ocupa uma das vagas do teto', async () => {
    const { mapId, draftRevision, userId, publicationId } = await seedActiveMap()
    for (let i = 1; i < OFFICE_MAP_PUBLICATION_LIMIT; i += 1) await publishAgain(mapId, draftRevision, userId, true)

    // Volta para a versão 1 e publica mais duas: a v1 sai das mais recentes.
    await activateOfficeMapPublication(publicationId, userId, DEFAULT_COMPANY_ID)
    await publishAgain(mapId, draftRevision, userId, false)
    await publishAgain(mapId, draftRevision, userId, false)

    const publications = await listOfficeMapPublications(mapId, DEFAULT_COMPANY_ID)
    const versions = publications.map((publication) => publication.version)
    expect(publications).toHaveLength(OFFICE_MAP_PUBLICATION_LIMIT)
    expect(publications.find((publication) => publication.version === 1)?.active).toBe(true)
    // A ativa (v1) entra no lugar da mais antiga da janela (v3): sobram a v1 e
    // as OFFICE_MAP_PUBLICATION_LIMIT - 1 mais recentes.
    expect(versions).toEqual([
      ...Array.from({ length: OFFICE_MAP_PUBLICATION_LIMIT - 1 }, (_, i) => OFFICE_MAP_PUBLICATION_LIMIT + 2 - i),
      1,
    ])
  })
})

import { describe, it, expect } from 'vitest'
import {
  MAP_DOCUMENT_V1_LIMITS,
  OFFICE_TILESET_CATALOG,
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
  getOfficeMapDraft,
  mergeAndPublishDecoration,
} from './office-map-service'

async function admin() {
  return prisma.user.create({
    data: { name: 'Admin', email: `a${Date.now()}-${Math.random()}@x.dev`, passwordHash: 'x', role: 'ADMIN' },
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

function withObject(doc: MapDocumentV1, obj: MapObjectV1): MapDocumentV1 {
  return { ...doc, objects: [...doc.objects, obj] }
}

async function seedActiveMap() {
  const user = await admin()
  const { id: mapId } = await createOfficeMap({ name: 'Mapa', width: 20, height: 20, tileSize: 48 }, user.id, DEFAULT_COMPANY_ID)
  const builtin = builtinTileset48()
  const doc = createEmptyMapDocumentV1({ width: 20, height: 20, tileSize: 48 })
  const tileWidth = MapTileSizeSchema.parse(builtin.tileWidth)
  const tileHeight = MapTileSizeSchema.parse(builtin.tileHeight)
  doc.tilesets.push({
    id: 'ts1',
    assetId: builtin.assetId,
    name: builtin.name,
    tileWidth,
    tileHeight,
    columns: builtin.columns,
    tileCount: builtin.tileCount,
  })
  const lock = await acquireOfficeMapLock(mapId, user.id, DEFAULT_COMPANY_ID)
  const draft = await prisma.officeMapDraft.findUniqueOrThrow({ where: { mapId } })
  const saved = await saveOfficeMapDraft(mapId, { revision: draft.revision, document: doc }, user.id, lock.lockToken, DEFAULT_COMPANY_ID)
  await publishOfficeMap(mapId, saved.revision, user.id, true, DEFAULT_COMPANY_ID)
  const active = await getActiveOfficeMap(DEFAULT_COMPANY_ID)
  return {
    mapId,
    baseRevision: active.decorRevision,
    baseDoc: active.document,
    userId: user.id,
    publicationId: active.publication.id,
  }
}

/** Salva no rascunho do admin como o `MapEditor` faz: lock + revisão corrente. */
async function saveDraftAs(mapId: string, userId: string, document: MapDocumentV1) {
  const lock = await acquireOfficeMapLock(mapId, userId, DEFAULT_COMPANY_ID)
  const draft = await prisma.officeMapDraft.findUniqueOrThrow({ where: { mapId } })
  return saveOfficeMapDraft(mapId, { revision: draft.revision, document }, userId, lock.lockToken, DEFAULT_COMPANY_ID)
}

async function activeDocumentObjects() {
  const active = await getActiveOfficeMap(DEFAULT_COMPANY_ID)
  return active.document.objects.map((o) => o.id)
}

describe('mergeAndPublishDecoration', () => {
  it('mescla o trabalho de dois editores concorrentes no documento final', async () => {
    const { baseRevision, baseDoc, userId } = await seedActiveMap()

    // Editor A adiciona 'a-1' e salva.
    const aDoc = withObject(baseDoc, tileObj('a-1', 48, 0))
    const a = await mergeAndPublishDecoration({ baseRevision, document: aDoc }, { id: userId, role: 'ADMIN' }, DEFAULT_COMPANY_ID)

    // Editor B (partiu da MESMA revisão) adiciona 'b-1' e salva depois.
    const bDoc = withObject(baseDoc, tileObj('b-1', 96, 0))
    const b = await mergeAndPublishDecoration({ baseRevision, document: bDoc }, { id: userId, role: 'ADMIN' }, DEFAULT_COMPANY_ID)

    expect(b.decorRevision).toBe(a.decorRevision + 1)
    const ids = b.document.objects.map((o) => o.id)
    expect(ids).toEqual(expect.arrayContaining(['a-1', 'b-1'])) // ambos sobrevivem
  })

  it('faz fallback aditivo (sem remoções) quando a revisão base não existe', async () => {
    const { baseDoc, userId } = await seedActiveMap()
    const doc = withObject(baseDoc, tileObj('novo', 48, 0))
    const res = await mergeAndPublishDecoration({ baseRevision: 9999, document: doc }, { id: userId, role: 'ADMIN' }, DEFAULT_COMPANY_ID)
    expect(res.document.objects.map((o) => o.id)).toContain('novo')
  })

  it('rejeita mudança estrutural com STRUCTURAL_EDIT_FORBIDDEN', async () => {
    const { baseRevision, baseDoc, userId } = await seedActiveMap()
    const structural = { ...baseDoc, map: { ...baseDoc.map, width: baseDoc.map.width + 5 } }
    await expect(
      mergeAndPublishDecoration({ baseRevision, document: structural }, { id: userId, role: 'ADMIN' }, DEFAULT_COMPANY_ID),
    ).rejects.toMatchObject({
      status: 403,
      code: 'STRUCTURAL_EDIT_FORBIDDEN',
    })
  })

  it('rejeita documento malformado com MAP_DOCUMENT_MALFORMED (400) em vez de 500', async () => {
    const { baseRevision, userId } = await seedActiveMap()
    await expect(
      mergeAndPublishDecoration({ baseRevision, document: {} }, { id: userId, role: 'ADMIN' }, DEFAULT_COMPANY_ID),
    ).rejects.toMatchObject({
      status: 400,
      code: 'MAP_DOCUMENT_MALFORMED',
    })
    await expect(
      mergeAndPublishDecoration({ baseRevision, document: 123 }, { id: userId, role: 'ADMIN' }, DEFAULT_COMPANY_ID),
    ).rejects.toMatchObject({
      status: 400,
      code: 'MAP_DOCUMENT_MALFORMED',
    })
  })

  it('estourar um teto do documento diz QUAL teto, não só "Documento inválido"', async () => {
    // O 400 genérico não dava pista de por que o Salvar parou de funcionar —
    // quem chegava ao teto de folhas de mobília não tinha como saber que
    // bastava apagar as peças de um conjunto já usado.
    const { baseRevision, baseDoc, userId } = await seedActiveMap()
    const estourado: MapDocumentV1 = {
      ...baseDoc,
      tilesets: Array.from({ length: MAP_DOCUMENT_V1_LIMITS.maxTilesets + 1 }, (_, index) => ({
        ...baseDoc.tilesets[0],
        id: `ts-extra-${index}`,
      })),
    }
    await expect(
      mergeAndPublishDecoration({ baseRevision, document: estourado }, { id: userId, role: 'ADMIN' }, DEFAULT_COMPANY_ID),
    ).rejects.toMatchObject({
      status: 400,
      code: 'MAP_DOCUMENT_MALFORMED',
      message: `O mapa excede o limite de ${MAP_DOCUMENT_V1_LIMITS.maxTilesets} conjuntos de mobília`,
    })
  })
})

/**
 * O editor do admin (rascunho + publish) e a edição no mapa (`mapData` da
 * publicação ativa) escreviam documentos independentes: quem gravasse por
 * último apagava o trabalho do outro, nas DUAS direções.
 */
describe('editor do admin × edição no mapa', () => {
  it('abrir o rascunho do mapa ativo traz a decoração feita pelo mapa', async () => {
    const { mapId, baseRevision, baseDoc, userId, publicationId } = await seedActiveMap()

    await mergeAndPublishDecoration(
      { baseRevision, basePublicationId: publicationId, document: withObject(baseDoc, tileObj('decorado', 48, 0)) },
      { id: userId, role: 'LEGEND' },
      DEFAULT_COMPANY_ID,
    )

    const draft = await getOfficeMapDraft(mapId, DEFAULT_COMPANY_ID)

    expect(draft.document.objects.map((o) => o.id)).toContain('decorado')
  })

  it('direção A: publish do admin preserva a decoração feita depois que o rascunho abriu', async () => {
    const { mapId, baseRevision, baseDoc, userId, publicationId } = await seedActiveMap()

    // Admin abre o editor e ancora o rascunho no mapa vivo.
    await getOfficeMapDraft(mapId, DEFAULT_COMPANY_ID)
    // Alguém decora pelo mapa enquanto o admin trabalha.
    await mergeAndPublishDecoration(
      { baseRevision, basePublicationId: publicationId, document: withObject(baseDoc, tileObj('decorado', 48, 0)) },
      { id: userId, role: 'LEGEND' },
      DEFAULT_COMPANY_ID,
    )
    // Admin adiciona o objeto dele e publica, sem nunca ter visto 'decorado'.
    const saved = await saveDraftAs(mapId, userId, withObject(baseDoc, tileObj('do-admin', 96, 0)))
    const published = await publishOfficeMap(mapId, saved.revision, userId, true, DEFAULT_COMPANY_ID)

    expect(await activeDocumentObjects()).toEqual(expect.arrayContaining(['decorado', 'do-admin']))
    // O editor aberto precisa adotar o documento publicado, senão o próximo
    // autosave dele reescreve o rascunho sem 'decorado' e a perda volta.
    expect(published.document.objects.map((o) => o.id)).toEqual(expect.arrayContaining(['decorado', 'do-admin']))
  })

  it('direção A: a remoção feita pelo admin continua valendo no publish', async () => {
    const { mapId, baseRevision, baseDoc, userId, publicationId } = await seedActiveMap()

    await mergeAndPublishDecoration(
      { baseRevision, basePublicationId: publicationId, document: withObject(baseDoc, tileObj('descartavel', 48, 0)) },
      { id: userId, role: 'ADMIN' },
      DEFAULT_COMPANY_ID,
    )
    // Admin abre o rascunho (já com 'descartavel') e apaga a peça.
    const draft = await getOfficeMapDraft(mapId, DEFAULT_COMPANY_ID)
    expect(draft.document.objects.map((o) => o.id)).toContain('descartavel')
    const semPeca = { ...draft.document, objects: draft.document.objects.filter((o) => o.id !== 'descartavel') }
    const saved = await saveDraftAs(mapId, userId, semPeca)
    await publishOfficeMap(mapId, saved.revision, userId, true, DEFAULT_COMPANY_ID)

    expect(await activeDocumentObjects()).not.toContain('descartavel')
  })

  it('modo aditivo não vira brecha: usuário comum ainda não move objeto protegido', async () => {
    const { mapId, baseDoc, userId, publicationId } = await seedActiveMap()

    // Admin publica uma parede (sem `createdBy` → protegida, ver isProtectedFromMembers).
    const comParede = withObject(baseDoc, tileObj('parede', 96, 0))
    const saved = await saveDraftAs(mapId, userId, comParede)
    await publishOfficeMap(mapId, saved.revision, userId, true, DEFAULT_COMPANY_ID)

    // Comum, ancorado na publicação ANTIGA (portanto merge aditivo), tenta mover a parede.
    const paredeMovida = { ...comParede, objects: [tileObj('parede', 480, 480)] }
    await expect(
      mergeAndPublishDecoration(
        { baseRevision: 0, basePublicationId: publicationId, document: paredeMovida },
        { id: userId, role: 'LEGEND' },
        DEFAULT_COMPANY_ID,
      ),
    ).rejects.toMatchObject({ status: 403, code: 'STRUCTURAL_EDIT_FORBIDDEN' })
  })

  it('direção B: save no mapa ancorado em publicação antiga não apaga o que o admin publicou', async () => {
    const { mapId, baseDoc, userId, publicationId } = await seedActiveMap()

    // Alguém abre a edição no mapa, ancorado na publicação ATUAL…
    const ancora = { baseRevision: 0, basePublicationId: publicationId }
    // …e o admin publica uma versão nova no meio (publicação nova nasce com
    // decorRevision 0 — a colisão numérica com a âncora é o caminho perigoso).
    const saved = await saveDraftAs(mapId, userId, withObject(baseDoc, tileObj('publicado-pelo-admin', 96, 0)))
    await publishOfficeMap(mapId, saved.revision, userId, true, DEFAULT_COMPANY_ID)

    // Agora o decorador salva o documento dele, que nem sabe do objeto novo.
    await mergeAndPublishDecoration(
      { ...ancora, document: withObject(baseDoc, tileObj('decorado', 48, 0)) },
      { id: userId, role: 'LEGEND' },
      DEFAULT_COMPANY_ID,
    )

    expect(await activeDocumentObjects()).toEqual(expect.arrayContaining(['publicado-pelo-admin', 'decorado']))
  })
})

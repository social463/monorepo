import { describe, expect, it } from 'vitest'
import type { MapDocumentV1, OfficeRuntimeZone } from './index'
import {
  createEmptyMapDocumentV1,
  claimedDeskInMeetingRoom,
  deskRoomDisplayName,
  findMapPath,
  isHighFiveAudible,
  isInSilenceZone,
  isMapTileWalkable,
  mapSpawnTiles,
  mapKarts,
  mapZoneAt,
  meetingRoomEntryTile,
  meetingRoomForDeskKey,
  officeOpenRoom,
  officeRoomForMapPosition,
  officeZoneDisplayName,
  OFFICE_DESK_SIZE_TILES,
} from './index'

describe('runtime do documento de mapa', () => {
  it('deriva karts posicionáveis e suas direções dos tile-objects publicados', () => {
    const document = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 })
    document.tilesets.push({
      id: 'kart-tileset',
      assetId: 'builtin:office/kart-32',
      name: 'Kart',
      tileWidth: 32,
      tileHeight: 32,
      columns: 1,
      tileCount: 1,
    })
    document.objects.push(
      {
        id: 'kart-a',
        layerKey: 'objects',
        type: 'tile-object',
        geometry: { kind: 'rectangle', x: 64, y: 96, width: 32, height: 32 },
        properties: { tilesetId: 'kart-tileset', tileIndex: 0 },
      },
      {
        id: 'kart-b',
        layerKey: 'objects',
        type: 'tile-object',
        geometry: { kind: 'rectangle', x: 129, y: 161, width: 32, height: 32 },
        properties: { tilesetId: 'kart-tileset', tileIndex: 0, rotation: 90 },
      },
    )

    expect(mapKarts(document)).toEqual([
      { id: 'kart-a', x: 2, y: 3, dir: 'up' },
      { id: 'kart-b', x: 4, y: 5, dir: 'right' },
    ])
  })

  it('deriva colisões, spawn, zonas e sala de mídia da publicação', () => {
    const document = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 })
    document.objects.push(
      {
        id: 'collision-1', layerKey: 'collision', type: 'collision',
        geometry: { kind: 'rectangle', x: 32, y: 32, width: 32, height: 32 }, properties: {},
      },
      {
        id: 'room-1', layerKey: 'meeting-rooms', type: 'meeting-room',
        geometry: { kind: 'rectangle', x: 96, y: 96, width: 64, height: 64 },
        properties: {
          externalKey: 'aurora', name: 'Aurora', status: 'OPEN', capacity: 4,
          voiceEnabled: true, accessPolicy: 'OPEN',
        },
      },
    )

    expect(isMapTileWalkable(document, 1, 1)).toBe(false)
    expect(mapSpawnTiles(document)).toHaveLength(1)
    expect(mapZoneAt(document, 3, 3)?.properties.name).toBe('Aurora')
    expect(officeRoomForMapPosition('map-1', document, 3, 3)).toBe('office-map-map-1-zone-aurora')
    expect(officeRoomForMapPosition('map-1', document, 0, 0)).toBe('office-map-map-1-open')
  })

  it('deriva o nome da sala a partir do mapId (estável entre publicações)', () => {
    const document = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 })
    document.objects.push({
      id: 'room-1', layerKey: 'meeting-rooms', type: 'meeting-room',
      geometry: { kind: 'rectangle', x: 96, y: 96, width: 64, height: 64 },
      properties: {
        externalKey: 'aurora', name: 'Aurora', status: 'OPEN', capacity: 4,
        voiceEnabled: true, accessPolicy: 'OPEN',
      },
    })
    expect(officeRoomForMapPosition('map-1', document, 3, 3)).toBe('office-map-map-1-zone-aurora')
    expect(officeRoomForMapPosition('map-1', document, 0, 0)).toBe('office-map-map-1-open')
    expect(officeOpenRoom('map-1')).toBe('office-map-map-1-open')
  })

  describe('mesa reivindicada dentro da sala', () => {
    const documentWithRoomsAndDesks = () => {
      const document = createEmptyMapDocumentV1({ width: 20, height: 20, tileSize: 32 })
      document.objects.push(
        {
          id: 'room-1', layerKey: 'meeting-rooms', type: 'meeting-room',
          geometry: { kind: 'rectangle', x: 96, y: 96, width: 128, height: 96 },
          properties: {
            externalKey: 'aurora', name: 'Aurora', status: 'OPEN', capacity: 4,
            voiceEnabled: true, accessPolicy: 'OPEN',
          },
        },
        {
          id: 'room-2', layerKey: 'meeting-rooms', type: 'meeting-room',
          geometry: { kind: 'rectangle', x: 320, y: 96, width: 96, height: 96 },
          properties: {
            externalKey: 'boreal', name: 'Boreal', status: 'OPEN', capacity: 4,
            voiceEnabled: true, accessPolicy: 'OPEN',
          },
        },
        {
          id: 'desk-1', layerKey: 'desks', type: 'desk',
          geometry: { kind: 'rectangle', x: 112, y: 112, width: 48, height: 32 },
          properties: { externalKey: 'mesa-aurora', name: 'Mesa Aurora' },
        },
        {
          id: 'desk-2', layerKey: 'desks', type: 'desk',
          geometry: { kind: 'rectangle', x: 336, y: 112, width: 48, height: 32 },
          properties: { externalKey: 'mesa-boreal', name: 'Mesa Boreal' },
        },
      )
      return document
    }

    it('retorna a mesa reivindicada cujo centro fica dentro da sala', () => {
      const document = documentWithRoomsAndDesks()
      const desk = claimedDeskInMeetingRoom(document, [
        { id: 'desk-1-db', externalKey: 'mesa-aurora', name: 'Mesa Aurora', claimedBy: { id: 'ana', name: 'Ana' } },
        { id: 'desk-2-db', externalKey: 'mesa-boreal', name: 'Mesa Boreal', claimedBy: null },
      ], 'aurora')

      expect(desk).toMatchObject({ externalKey: 'mesa-aurora', claimedBy: { id: 'ana' } })
    })

    it('ignora mesas livres e salas sem mesa reivindicada', () => {
      const document = documentWithRoomsAndDesks()

      expect(claimedDeskInMeetingRoom(document, [
        { id: 'desk-2-db', externalKey: 'mesa-boreal', name: 'Mesa Boreal', claimedBy: null },
      ], 'boreal')).toBeNull()
      expect(claimedDeskInMeetingRoom(document, [], 'aurora')).toBeNull()
    })
  })

  it('encontra caminho contornando colisões do snapshot', () => {
    const document = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 })
    document.objects.push({
      id: 'collision-1', layerKey: 'collision', type: 'collision',
      geometry: { kind: 'rectangle', x: 32, y: 0, width: 32, height: 64 }, properties: {},
    })
    const path = findMapPath(document, { x: 0, y: 0 }, { x: 2, y: 0 })
    expect(path).not.toBeNull()
    expect(path).toContain('down')
  })

  it('modo exato caminha até o próprio tile-alvo, não só adjacente', () => {
    const document = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 })
    const path = findMapPath(document, { x: 0, y: 0 }, { x: 3, y: 0 }, { exact: true })
    expect(path).toEqual(['right', 'right', 'right'])
  })

  it('kart estacionado torna o tile não-andável; com piloto, não bloqueia', () => {
    const document = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 })

    expect(isMapTileWalkable(document, 3, 3)).toBe(true)
    expect(isMapTileWalkable(document, 3, 3, [{ id: 'kart-1', x: 3, y: 3, dir: 'up' }])).toBe(false)
    // Kart com piloto anda junto com ele: é o personagem que ocupa o tile.
    expect(
      isMapTileWalkable(document, 3, 3, [{ id: 'kart-1', x: 3, y: 3, dir: 'up', riderUserId: 'ana' }]),
    ).toBe(true)
  })

  it('caminho contorna kart estacionado em vez de atravessá-lo', () => {
    const document = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 })
    const karts = [{ id: 'kart-1', x: 1, y: 0, dir: 'up' as const }]

    expect(findMapPath(document, { x: 0, y: 0 }, { x: 2, y: 0 }, { exact: true })).toEqual([
      'right',
      'right',
    ])
    const path = findMapPath(document, { x: 0, y: 0 }, { x: 2, y: 0 }, { exact: true, karts })
    expect(path).not.toBeNull()
    expect(path).toContain('down')
  })

  describe('alcance sonoro do high-five', () => {
    /** Sala em tiles 3..6 nos dois eixos; sala 2 em tiles 10..12. */
    const mapWithRooms = () => {
      const document = createEmptyMapDocumentV1({ width: 20, height: 20, tileSize: 32 })
      document.objects.push(
        {
          id: 'room-1', layerKey: 'meeting-rooms', type: 'meeting-room',
          geometry: { kind: 'rectangle', x: 96, y: 96, width: 128, height: 128 },
          properties: {
            externalKey: 'aurora', name: 'Aurora', status: 'OPEN', capacity: 4,
            voiceEnabled: true, accessPolicy: 'OPEN',
          },
        },
        {
          id: 'room-2', layerKey: 'meeting-rooms', type: 'meeting-room',
          geometry: { kind: 'rectangle', x: 320, y: 320, width: 96, height: 96 },
          properties: {
            externalKey: 'boreal', name: 'Boreal', status: 'OPEN', capacity: 4,
            voiceEnabled: true, accessPolicy: 'OPEN',
          },
        },
      )
      return document
    }

    it('no espaço aberto ouve quem está dentro do raio de proximidade', () => {
      const document = mapWithRooms()
      expect(isHighFiveAudible(document, { x: 13, y: 17 }, { x: 10, y: 17 }, { x: 11, y: 17 })).toBe(true)
    })

    it('no espaço aberto não ouve quem está longe do par', () => {
      const document = mapWithRooms()
      expect(isHighFiveAudible(document, { x: 15, y: 17 }, { x: 10, y: 17 }, { x: 11, y: 17 })).toBe(false)
    })

    it('dentro da sala ouve quem está na mesma sala, mesmo fora do raio', () => {
      const document = mapWithRooms()
      expect(isHighFiveAudible(document, { x: 6, y: 6 }, { x: 3, y: 3 }, { x: 4, y: 3 })).toBe(true)
    })

    it('high-five dentro da sala não vaza para quem está do lado de fora', () => {
      const document = mapWithRooms()
      expect(isHighFiveAudible(document, { x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 })).toBe(false)
    })

    it('não vaza para quem está em outra sala', () => {
      const document = mapWithRooms()
      expect(isHighFiveAudible(document, { x: 11, y: 11 }, { x: 3, y: 3 }, { x: 4, y: 3 })).toBe(false)
    })

    it('quem está na porta ouve o par cujo membro está no aberto ao lado', () => {
      const document = mapWithRooms()
      // O par pode ficar meio dentro, meio fora (um na porta): basta um membro
      // audível para o som valer.
      expect(isHighFiveAudible(document, { x: 8, y: 3 }, { x: 6, y: 3 }, { x: 7, y: 3 })).toBe(true)
    })
  })

  describe('sala de silêncio', () => {
    /** Sala de silêncio em tiles 3..5 nos dois eixos. */
    const mapWithSilenceZone = () => {
      const document = createEmptyMapDocumentV1({ width: 20, height: 20, tileSize: 32 })
      document.objects.push({
        id: 'silencio-1', layerKey: 'private-zones', type: 'private-zone',
        geometry: { kind: 'rectangle', x: 96, y: 96, width: 96, height: 96 },
        properties: { name: 'Área de silêncio', accessPolicy: 'OPEN' },
      })
      return document
    }

    it('reconhece quem está dentro e quem está fora', () => {
      const document = mapWithSilenceZone()
      expect(isInSilenceZone(document, { x: 4, y: 4 })).toBe(true)
      expect(isInSilenceZone(document, { x: 8, y: 8 })).toBe(false)
    })

    it('sala de reunião não é sala de silêncio', () => {
      const document = createEmptyMapDocumentV1({ width: 20, height: 20, tileSize: 32 })
      document.objects.push({
        id: 'room-1', layerKey: 'meeting-rooms', type: 'meeting-room',
        geometry: { kind: 'rectangle', x: 96, y: 96, width: 96, height: 96 },
        properties: {
          externalKey: 'aurora', name: 'Aurora', status: 'OPEN', capacity: 4,
          voiceEnabled: true, accessPolicy: 'OPEN',
        },
      })
      expect(isInSilenceZone(document, { x: 4, y: 4 })).toBe(false)
    })

    it('o high-five de fora não entra na sala (isolamento de zona)', () => {
      const document = mapWithSilenceZone()
      expect(isHighFiveAudible(document, { x: 4, y: 4 }, { x: 7, y: 4 }, { x: 8, y: 4 })).toBe(false)
    })

    it('o high-five feito dentro da sala não vaza para fora', () => {
      const document = mapWithSilenceZone()
      expect(isHighFiveAudible(document, { x: 8, y: 8 }, { x: 3, y: 3 }, { x: 4, y: 3 })).toBe(false)
    })

    // Quem cala o som DENTRO da sala é o portão (`lib/office-silence`), não esta
    // função — que continua respondendo só sobre distância e zona.
    it('sozinha, considera audível o high-five da mesma sala', () => {
      const document = mapWithSilenceZone()
      expect(isHighFiveAudible(document, { x: 5, y: 5 }, { x: 3, y: 3 }, { x: 4, y: 3 })).toBe(true)
    })
  })

  describe('meetingRoomEntryTile', () => {
    const document = {
      schemaVersion: '1',
      map: { width: 20, height: 20, tileWidth: 32, tileHeight: 32 },
      layers: [],
      objects: [
        {
          id: 'room-aurora',
          type: 'meeting-room',
          geometry: { kind: 'rectangle', x: 64, y: 64, width: 128, height: 128 },
          properties: { externalKey: 'aurora', name: 'Aurora', status: 'OPEN', voiceEnabled: true, accessPolicy: 'OPEN' },
        },
      ],
    } as unknown as MapDocumentV1

    it('devolve um tile andável dentro da sala', () => {
      const tile = meetingRoomEntryTile(document, 'aurora')
      expect(tile).not.toBeNull()
      expect(tile!.x).toBeGreaterThanOrEqual(2)
      expect(tile!.x).toBeLessThan(6)
      expect(tile!.y).toBeGreaterThanOrEqual(2)
      expect(tile!.y).toBeLessThan(6)
    })

    it('desvia do tile central quando ele tem colisão', () => {
      const comColisao = {
        ...document,
        objects: [
          ...document.objects,
          {
            id: 'col',
            type: 'collision',
            geometry: { kind: 'rectangle', x: 96, y: 96, width: 32, height: 32 },
            properties: {},
          },
        ],
      } as unknown as MapDocumentV1
      const tile = meetingRoomEntryTile(comColisao, 'aurora')
      expect(tile).not.toEqual({ x: 3, y: 3 })
      expect(tile).not.toBeNull()
    })

    it('devolve null para sala inexistente', () => {
      expect(meetingRoomEntryTile(document, 'nao-existe')).toBeNull()
    })
  })

  it('modo exato falha quando o próprio tile-alvo está bloqueado; modo padrão (adjacente) ainda funciona', () => {
    const document = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 })
    document.objects.push({
      id: 'collision-1', layerKey: 'collision', type: 'collision',
      geometry: { kind: 'rectangle', x: 96, y: 0, width: 32, height: 32 }, properties: {},
    })
    expect(findMapPath(document, { x: 0, y: 0 }, { x: 3, y: 0 }, { exact: true })).toBeNull()
    expect(findMapPath(document, { x: 0, y: 0 }, { x: 3, y: 0 })).not.toBeNull()
  })

  describe('nome exibido da sala da mesa', () => {
    // Sala 'aurora' em (96,96)–(224,192); a mesa 3×2 (96×64px) cabe dentro dela.
    const documentWithDeskInRoom = () => {
      const document = createEmptyMapDocumentV1({ width: 20, height: 20, tileSize: 32 })
      document.objects.push(
        {
          id: 'room-1', layerKey: 'meeting-rooms', type: 'meeting-room',
          geometry: { kind: 'rectangle', x: 96, y: 96, width: 128, height: 96 },
          properties: {
            externalKey: 'aurora', name: 'Aurora', status: 'OPEN',
            voiceEnabled: true, accessPolicy: 'OPEN',
          },
        },
        {
          id: 'desk-1', layerKey: 'desks', type: 'desk',
          geometry: { kind: 'rectangle', x: 96, y: 96, width: 96, height: 64 },
          properties: { externalKey: 'mesa-1', name: 'Nova mesa' },
        },
        {
          id: 'desk-solta', layerKey: 'desks', type: 'desk',
          geometry: { kind: 'rectangle', x: 320, y: 320, width: 96, height: 64 },
          properties: { externalKey: 'mesa-solta', name: 'Mesa solta' },
        },
      )
      return document
    }
    const zoneOf = (document: MapDocumentV1, id: string) =>
      document.objects.find((object) => object.id === id) as OfficeRuntimeZone

    it('a mesa tem 3 tiles de largura por 2 de altura', () => {
      expect(OFFICE_DESK_SIZE_TILES).toEqual({ width: 3, height: 2 })
    })

    it('deskRoomDisplayName monta o nome a partir do dono', () => {
      expect(deskRoomDisplayName('Ana')).toBe('Mesa de Ana')
    })

    it('meetingRoomForDeskKey acha a sala que contém o centro da mesa', () => {
      const document = documentWithDeskInRoom()
      expect(meetingRoomForDeskKey(document, 'mesa-1')?.properties.externalKey).toBe('aurora')
      expect(meetingRoomForDeskKey(document, 'mesa-solta')).toBeNull()
      expect(meetingRoomForDeskKey(document, 'mesa-inexistente')).toBeNull()
    })

    it('sala com mesa reivindicada exibe o nome do dono', () => {
      const document = documentWithDeskInRoom()
      const desks = [{ id: 'd1', name: 'Nova mesa', externalKey: 'mesa-1', claimedBy: { id: 'u1', name: 'Ana' } }]
      expect(officeZoneDisplayName(document, desks, zoneOf(document, 'room-1'))).toBe('Mesa de Ana')
    })

    it('mesa livre, sala sem mesa e zona privada mantêm o nome próprio', () => {
      const document = documentWithDeskInRoom()
      const livre = [{ id: 'd1', name: 'Nova mesa', externalKey: 'mesa-1', claimedBy: null }]
      expect(officeZoneDisplayName(document, livre, zoneOf(document, 'room-1'))).toBe('Aurora')
      expect(officeZoneDisplayName(document, [], zoneOf(document, 'room-1'))).toBe('Aurora')

      document.objects.push({
        id: 'silencio-1', layerKey: 'private-zones', type: 'private-zone',
        geometry: { kind: 'rectangle', x: 320, y: 320, width: 96, height: 64 },
        properties: { name: 'Silêncio', accessPolicy: 'OPEN' },
      })
      const comDono = [{ id: 'd2', name: 'Mesa solta', externalKey: 'mesa-solta', claimedBy: { id: 'u1', name: 'Ana' } }]
      expect(officeZoneDisplayName(document, comDono, zoneOf(document, 'silencio-1'))).toBe('Silêncio')
    })

    it('sala em polígono também reconhece a mesa dentro dela', () => {
      const document = createEmptyMapDocumentV1({ width: 20, height: 20, tileSize: 32 })
      document.objects.push(
        {
          id: 'room-poly', layerKey: 'meeting-rooms', type: 'meeting-room',
          geometry: {
            kind: 'polygon',
            points: [{ x: 96, y: 96 }, { x: 256, y: 96 }, { x: 256, y: 224 }, { x: 96, y: 224 }],
          },
          properties: {
            externalKey: 'poligonal', name: 'Poligonal', status: 'OPEN',
            voiceEnabled: true, accessPolicy: 'OPEN',
          },
        },
        {
          id: 'desk-poly', layerKey: 'desks', type: 'desk',
          geometry: { kind: 'rectangle', x: 128, y: 128, width: 96, height: 64 },
          properties: { externalKey: 'mesa-poly', name: 'Nova mesa' },
        },
      )
      expect(meetingRoomForDeskKey(document, 'mesa-poly')?.properties.externalKey).toBe('poligonal')
    })
  })
})

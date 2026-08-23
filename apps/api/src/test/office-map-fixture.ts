import {
  OFFICE_MAP,
  OFFICE_SPAWN_TILES,
  OFFICE_ZONES,
  createEmptyMapDocumentV1,
  type ActiveOfficeMapDTO,
} from '@legends/shared'

/** Compatibilidade dos testes antigos, isolada do runtime de produção. */
export function legacyOfficeRuntimeFixture(): ActiveOfficeMapDTO {
  const tileSize = 32
  const document = createEmptyMapDocumentV1({
    width: OFFICE_MAP[0]!.length,
    height: OFFICE_MAP.length,
    tileSize,
  })
  document.objects = []
  OFFICE_MAP.forEach((row, y) => [...row].forEach((cell, x) => {
    if (cell !== '#') return
    document.objects.push({
      id: `collision-${x}-${y}`,
      layerKey: 'collision',
      type: 'collision',
      geometry: { kind: 'rectangle', x: x * tileSize, y: y * tileSize, width: tileSize, height: tileSize },
      properties: {},
    })
  }))
  OFFICE_SPAWN_TILES.forEach((spawn, index) => document.objects.push({
    id: `spawn-${index}`,
    layerKey: 'spawn-points',
    type: 'spawn-point',
    geometry: { kind: 'point', x: spawn.x * tileSize + tileSize / 2, y: spawn.y * tileSize + tileSize / 2 },
    properties: { name: `Spawn ${index + 1}`, isDefault: index === 0 },
  }))
  OFFICE_ZONES.forEach((zone) => document.objects.push({
    id: `room-${zone.id}`,
    layerKey: 'meeting-rooms',
    type: 'meeting-room',
    geometry: {
      kind: 'rectangle',
      x: zone.x0 * tileSize,
      y: zone.y0 * tileSize,
      width: (zone.x1 - zone.x0 + 1) * tileSize,
      height: (zone.y1 - zone.y0 + 1) * tileSize,
    },
    properties: {
      externalKey: zone.id,
      name: zone.name,
      status: 'OPEN',
      voiceEnabled: true,
      accessPolicy: 'OPEN',
    },
  }))
  return {
    map: { id: 'legacy-test-map', name: 'Mapa legado de teste' },
    publication: {
      id: 'legacy-test-publication', version: 1, schemaVersion: document.schemaVersion,
      createdAt: new Date(0).toISOString(), createdBy: null, active: true,
    },
    decorRevision: 0,
    document,
    assets: [],
    rooms: OFFICE_ZONES.map((zone) => ({
      id: `room-${zone.id}`,
      name: zone.name,
      externalKey: zone.id,
      status: 'OPEN',
      capacity: null,
      voiceEnabled: true,
      accessPolicy: 'OPEN',
      allowedUsers: [],
    })),
    desks: [],
    deskReminders: [],
  }
}

import { describe, expect, it } from 'vitest'
import { createEmptyMapDocumentV1, type ActiveOfficeMapDTO } from '@legends/shared'
import { OfficeHub, type OfficeSocket } from './office-hub'

function runtime(): ActiveOfficeMapDTO {
  const document = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 })
  const spawn = document.objects[0]!
  if (spawn.type !== 'spawn-point') throw new Error('fixture de spawn inválida')
  spawn.geometry = { kind: 'point', x: 48, y: 48 }
  document.objects.push({
    id: 'room-aurora', layerKey: 'meeting-rooms', type: 'meeting-room',
    geometry: { kind: 'rectangle', x: 64, y: 32, width: 32, height: 32 },
    properties: {
      externalKey: 'aurora', name: 'Aurora', status: 'OPEN', capacity: 1,
      voiceEnabled: true, accessPolicy: 'OPEN',
    },
  })
  return {
    map: { id: 'map-1', name: 'Mapa' },
    publication: {
      id: 'pub-1', version: 1, schemaVersion: '1.0.0', createdAt: new Date(0).toISOString(),
      createdBy: null, active: true,
    },
    decorRevision: 0,
    document,
    assets: [],
    rooms: [{
      id: 'room-db-1', externalKey: 'aurora', name: 'Aurora', status: 'LOCKED',
      capacity: 1, voiceEnabled: true, accessPolicy: 'OPEN', allowedUsers: [],
    }],
    desks: [],
    deskReminders: [],
  }
}

function user(id: string) {
  return {
    id, name: id, photoUrl: null, avatarStyle: null, avatarSeed: null,
    avatarOptions: null, spriteUrl: null,
  }
}

function socket(): OfficeSocket & { messages: unknown[] } {
  const result = { messages: [] as unknown[], send(data: string) { result.messages.push(JSON.parse(data)) } }
  return result
}

describe('OfficeHub com publicação de mapa', () => {
  it('usa spawn e bloqueia entrada em sala trancada', () => {
    const hub = new OfficeHub()
    const map = runtime()
    const client = socket()
    hub.join(client, user('ana'), map)
    expect(hub.occupantOf('ana')).toMatchObject({ x: 1, y: 1 })
    hub.move(client, 'ana', 'right')
    expect(hub.occupantOf('ana')).toMatchObject({ x: 1, y: 1, dir: 'right' })
  })

  it('aplica allowlist, capacidade e nomes LiveKit estáveis por mapId (edição não re-chaveia mídia/WS)', () => {
    const hub = new OfficeHub()
    const map = runtime()
    map.rooms[0]!.status = 'OPEN'
    map.rooms[0]!.accessPolicy = 'ALLOWLIST'
    map.rooms[0]!.allowedUsers = [{ id: 'ana', name: 'ana' }]
    const anaSocket = socket()
    const brunoSocket = socket()
    hub.join(anaSocket, user('ana'), map)
    hub.join(brunoSocket, user('bruno'), map)
    hub.move(anaSocket, 'ana', 'right')
    expect(hub.occupantOf('ana')).toMatchObject({ x: 2, y: 1 })
    expect(hub.mediaRoomForPosition(2, 1)).toBe('office-map-map-1-zone-aurora')
    hub.move(brunoSocket, 'bruno', 'right')
    expect(hub.occupantOf('bruno')).toMatchObject({ x: 1, y: 1 })
  })

  it('avisa map-changed antes de limpar presenças da versão anterior', () => {
    const hub = new OfficeHub()
    const first = runtime()
    const client = socket()
    hub.join(client, user('ana'), first)
    const next = runtime()
    next.publication = { ...next.publication, id: 'pub-2', version: 2 }
    hub.configure(next, true)
    expect(client.messages).toContainEqual({ type: 'map-changed', publicationId: 'pub-2' })
    expect(hub.occupants()).toEqual([])
  })

  it('broadcastDeskClaimed e broadcastDeskReleased notificam todos os sockets conectados', () => {
    const hub = new OfficeHub()
    const map = runtime()
    const anaSocket = socket()
    const brunoSocket = socket()
    hub.join(anaSocket, user('ana'), map)
    hub.join(brunoSocket, user('bruno'), map)

    hub.broadcastDeskClaimed('desk-1', 'mesa-1', { id: 'ana', name: 'ana' })
    expect(brunoSocket.messages).toContainEqual({
      type: 'desk-claimed', deskId: 'desk-1', externalKey: 'mesa-1', user: { id: 'ana', name: 'ana' },
    })

    hub.broadcastDeskReleased('desk-1', 'mesa-1')
    expect(brunoSocket.messages).toContainEqual({ type: 'desk-released', deskId: 'desk-1', externalKey: 'mesa-1' })
  })
})

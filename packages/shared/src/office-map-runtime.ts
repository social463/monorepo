import type {
  Direction,
  DeskObjectV1,
  OfficeDeskDTO,
  OfficeBall,
  OfficeKart,
  MapDocumentV1,
  MapObjectV1,
  MeetingRoomObjectV1,
  PrivateZoneObjectV1,
  TilePosition,
} from './index'
import { officeBallCell } from './office-ball-assets'
import { MOVE_DIRECTION_DELTAS, type MoveDirection } from './office'
import { isWithinProximity } from './office-media'
import {
  findOfficePath,
  officeWalkGrid,
  pointInMapObject,
  type OfficePathOptions,
} from './office-pathfinding'

export type OfficeRuntimeZone = MeetingRoomObjectV1 | PrivateZoneObjectV1

export const OFFICE_KART_ASSET_PREFIX = 'builtin:office/kart-'

export function isOfficeKartAssetId(assetId: string): boolean {
  return assetId.startsWith(OFFICE_KART_ASSET_PREFIX)
}

/**
 * Materializa os veículos iniciais a partir dos `tile-object` do sheet
 * funcional de kart. A mobília pode estar em posição livre; o runtime usa o
 * tile que contém o centro da peça.
 */
export function mapKarts(document: MapDocumentV1): OfficeKart[] {
  const kartTilesetIds = new Set(
    document.tilesets
      .filter((tileset) => isOfficeKartAssetId(tileset.assetId))
      .map((tileset) => tileset.id),
  )
  const directionByRotation: Record<number, Direction> = {
    0: 'up',
    90: 'right',
    180: 'down',
    270: 'left',
  }
  return document.objects.flatMap((object) => {
    if (object.type !== 'tile-object' || !kartTilesetIds.has(object.properties.tilesetId)) return []
    const centerX = object.geometry.x + object.geometry.width / 2
    const centerY = object.geometry.y + object.geometry.height / 2
    return [{
      id: object.id,
      x: Math.max(0, Math.min(document.map.width - 1, Math.floor(centerX / document.map.tileWidth))),
      y: Math.max(0, Math.min(document.map.height - 1, Math.floor(centerY / document.map.tileHeight))),
      dir: directionByRotation[object.properties.rotation ?? 0] ?? 'up',
    }]
  })
}

/**
 * Materializa as bolas a partir dos `tile-object` publicados (ver
 * `officeBallCell`).
 *
 * Bola de UM tile vira uma bola por objeto. As de 2×2 (pilates) chegam aqui
 * como quatro slices, e viram UMA peça: os slices da mesma entrada do catálogo
 * que se encostam formam um componente conexo. Agrupar por vizinhança, e não
 * pelo id do grupo do editor (`grp-x__0-1`), é o que faz funcionar também o
 * que o editor do admin publicou slice a slice — e tolera peça rotacionada ou
 * com um pedaço apagado.
 *
 * Efeito colateral aceito: duas bolas de pilates IGUAIS coladas uma na outra
 * viram uma peça só de 2×4. Duas bolas de um tile nunca se fundem — ali cada
 * objeto é sua própria bola.
 */
export function mapBalls(document: MapDocumentV1): OfficeBall[] {
  const tilesetsById = new Map(document.tilesets.map((tileset) => [tileset.id, tileset]))
  const { tileWidth, tileHeight } = document.map
  const parts = document.objects.flatMap((object, index) => {
    if (object.type !== 'tile-object') return []
    const tileset = tilesetsById.get(object.properties.tilesetId)
    if (!tileset) return []
    const cell = officeBallCell(tileset.assetId, object.properties.tileIndex)
    if (!cell) return []
    return [{ object, cell, index }]
  })

  const groups: { entryId: string; members: typeof parts }[] = []
  const pending = [...parts]
  while (pending.length > 0) {
    const seed = pending.shift() as (typeof parts)[number]
    const members = [seed]
    if (seed.cell.cols * seed.cell.rows > 1) {
      // Flood fill: puxa todo slice da MESMA peça encostado no que já entrou.
      for (let i = 0; i < members.length; i += 1) {
        const current = members[i]
        for (let j = pending.length - 1; j >= 0; j -= 1) {
          const candidate = pending[j]
          if (candidate.cell.entryId !== current.cell.entryId) continue
          if (!touches(current.object.geometry, candidate.object.geometry)) continue
          members.push(candidate)
          pending.splice(j, 1)
        }
      }
    }
    // Ordem do documento: o flood fill puxa os vizinhos de trás para a frente
    // (é o que permite remover de `pending` sem embaralhar o índice).
    members.sort((a, b) => a.index - b.index)
    groups.push({ entryId: seed.cell.entryId, members })
  }

  return groups.map(({ members }) => {
    const minX = Math.min(...members.map((member) => member.object.geometry.x))
    const minY = Math.min(...members.map((member) => member.object.geometry.y))
    const maxX = Math.max(...members.map((member) => member.object.geometry.x + member.object.geometry.width))
    const maxY = Math.max(...members.map((member) => member.object.geometry.y + member.object.geometry.height))
    const ball: OfficeBall = {
      id: members[0].object.id,
      x: Math.max(0, Math.min(document.map.width - 1, Math.floor((minX + tileWidth / 2) / tileWidth))),
      y: Math.max(0, Math.min(document.map.height - 1, Math.floor((minY + tileHeight / 2) / tileHeight))),
      memberIds: members.map((member) => member.object.id),
    }
    const w = Math.max(1, Math.round((maxX - minX) / tileWidth))
    const h = Math.max(1, Math.round((maxY - minY) / tileHeight))
    if (w !== 1) ball.w = w
    if (h !== 1) ball.h = h
    return ball
  })
}

/** Dois retângulos que se tocam (bordas coladas contam) — vizinhança do flood fill. */
function touches(a: MapObjectV1['geometry'], b: MapObjectV1['geometry']): boolean {
  if (a.kind !== 'rectangle' || b.kind !== 'rectangle') return false
  return (
    a.x <= b.x + b.width &&
    b.x <= a.x + a.width &&
    a.y <= b.y + b.height &&
    b.y <= a.y + a.height
  )
}

export function mapTileCenter(document: MapDocumentV1, x: number, y: number) {
  return {
    x: x * document.map.tileWidth + document.map.tileWidth / 2,
    y: y * document.map.tileHeight + document.map.tileHeight / 2,
  }
}

/**
 * Regra ÚNICA de colisão do escritório — servidor (`OfficeHub.walkable`),
 * predição local (`MovementPredictor`) e caminhada automática (`findMapPath`)
 * chamam esta função com a MESMA lista de karts.
 *
 * Isso não é preciosismo: enquanto o kart bloqueava o tile só no servidor, o
 * cliente previa o passo, andava por cima do veículo e a divergência com a
 * posição autoritativa se acumulava até o primeiro eco divergente re-ancorar
 * tudo de uma vez — o "teleporte" ao passar por cima do kart.
 *
 * Kart COM piloto não bloqueia: ele anda junto com o personagem, e quem ocupa
 * o tile é o próprio ocupante (já tratado pelas regras de presença).
 */
export function isMapTileWalkable(
  document: MapDocumentV1,
  x: number,
  y: number,
  karts: readonly OfficeKart[] = [],
): boolean {
  if (x < 0 || y < 0 || x >= document.map.width || y >= document.map.height) return false
  if (karts.some((kart) => !kart.riderUserId && kart.x === x && kart.y === y)) return false
  // Grade memoizada em vez de varrer `document.objects` a cada consulta: mesma
  // regra (centro do tile dentro de um objeto `collision`), custo O(1) depois
  // da primeira leitura do documento — ver `officeWalkGrid`.
  const grid = officeWalkGrid(document)
  return grid.blocked[y * grid.width + x] === 0
}

/**
 * Se um passo é possível a partir de `from` — a regra ÚNICA do movimento,
 * chamada pelo servidor (`OfficeHub.move`) e pela predição do cliente
 * (`MovementPredictor`), como `isMapTileWalkable` já é para o tile.
 *
 * Na diagonal exige as DUAS ortogonais livres: sem isso o personagem passa
 * raspando pela quina entre duas mesas encostadas, atravessando um vão por
 * onde ele não caberia andando reto.
 */
export function canStepTo(
  document: MapDocumentV1,
  from: TilePosition,
  move: MoveDirection,
  karts: readonly OfficeKart[] = [],
): boolean {
  const delta = MOVE_DIRECTION_DELTAS[move]
  if (!isMapTileWalkable(document, from.x + delta.x, from.y + delta.y, karts)) return false
  if (delta.x === 0 || delta.y === 0) return true
  return (
    isMapTileWalkable(document, from.x + delta.x, from.y, karts) &&
    isMapTileWalkable(document, from.x, from.y + delta.y, karts)
  )
}

export function mapSpawnTiles(document: MapDocumentV1): TilePosition[] {
  return document.objects
    .filter((object) => object.type === 'spawn-point')
    .sort((a, b) => Number(b.properties.isDefault) - Number(a.properties.isDefault))
    .map((object) => ({
      x: Math.max(0, Math.min(document.map.width - 1, Math.floor(object.geometry.x / document.map.tileWidth))),
      y: Math.max(0, Math.min(document.map.height - 1, Math.floor(object.geometry.y / document.map.tileHeight))),
    }))
    .filter((position) => isMapTileWalkable(document, position.x, position.y))
}

export function mapZoneAt(document: MapDocumentV1, x: number, y: number): OfficeRuntimeZone | null {
  const center = mapTileCenter(document, x, y)
  return (
    document.objects.find(
      (object): object is OfficeRuntimeZone =>
        (object.type === 'meeting-room' || object.type === 'private-zone') &&
        pointInMapObject(center.x, center.y, object),
    ) ?? null
  )
}

function objectCenter(object: MapObjectV1): { x: number; y: number } {
  const geometry = object.geometry
  if (geometry.kind === 'point') return { x: geometry.x, y: geometry.y }
  if (geometry.kind === 'rectangle') {
    return { x: geometry.x + geometry.width / 2, y: geometry.y + geometry.height / 2 }
  }
  const totals = geometry.points.reduce(
    (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
    { x: 0, y: 0 },
  )
  return { x: totals.x / geometry.points.length, y: totals.y / geometry.points.length }
}

export function claimedDeskInMeetingRoom(
  document: MapDocumentV1,
  desks: readonly OfficeDeskDTO[],
  roomExternalKey: string,
): OfficeDeskDTO | null {
  const room = document.objects.find(
    (object): object is MeetingRoomObjectV1 =>
      object.type === 'meeting-room' && object.properties.externalKey === roomExternalKey,
  )
  if (!room) return null
  const claimedDesksByExternalKey = new Map(
    desks.filter((desk) => desk.claimedBy !== null).map((desk) => [desk.externalKey, desk]),
  )

  for (const object of document.objects) {
    if (object.type !== 'desk') continue
    const desk = claimedDesksByExternalKey.get(object.properties.externalKey)
    if (!desk) continue
    const center = objectCenter(object)
    if (pointInMapObject(center.x, center.y, room)) return desk
  }
  return null
}

/**
 * Sala de chamada que contém uma mesa — o inverso de
 * `claimedDeskInMeetingRoom`, com a mesma regra geométrica: a mesa pertence à
 * sala cujo retângulo/polígono contém o CENTRO da mesa.
 */
export function meetingRoomForDeskKey(
  document: MapDocumentV1,
  deskExternalKey: string,
): MeetingRoomObjectV1 | null {
  const desk = document.objects.find(
    (object): object is DeskObjectV1 =>
      object.type === 'desk' && object.properties.externalKey === deskExternalKey,
  )
  if (!desk) return null
  const center = objectCenter(desk)
  return (
    document.objects.find(
      (object): object is MeetingRoomObjectV1 =>
        object.type === 'meeting-room' && pointInMapObject(center.x, center.y, object),
    ) ?? null
  )
}

/** Nome de sala derivado do dono da mesa que ela contém. */
export function deskRoomDisplayName(ownerName: string): string {
  return `Mesa de ${ownerName}`
}

/**
 * Nome a EXIBIR para uma zona. Uma sala de chamada com mesa reivindicada passa
 * a se chamar "Mesa de <dono>" enquanto durar a ocupação — derivado, nunca
 * persistido: liberar a mesa devolve o nome próprio sem republicar o mapa.
 */
export function officeZoneDisplayName(
  document: MapDocumentV1,
  desks: readonly OfficeDeskDTO[],
  zone: OfficeRuntimeZone,
): string {
  if (zone.type !== 'meeting-room') return zone.properties.name
  const desk = claimedDeskInMeetingRoom(document, desks, zone.properties.externalKey)
  return desk?.claimedBy ? deskRoomDisplayName(desk.claimedBy.name) : zone.properties.name
}

/**
 * A sala de silêncio (`private-zone`, criada pela ferramenta "Silêncio" do
 * editor) é ausência de som: quem está dentro não ouve efeito nenhum do
 * escritório, venha de onde vier — nem a palma do high-five que acontece ao
 * lado, nem o aplauso da comemoração, que é global.
 */
export function isInSilenceZone(document: MapDocumentV1, position: TilePosition): boolean {
  return mapZoneAt(document, position.x, position.y)?.type === 'private-zone'
}

/**
 * Quem ouve a palma de um high-five: o som é do lugar onde ele acontece, não do
 * escritório inteiro. Dentro de zona (sala/privada) o isolamento é acústico —
 * só quem está na MESMA zona ouve, independente da distância. No espaço aberto
 * vale o mesmo raio do chat de proximidade e do áudio espacial. Basta um dos
 * dois do par ser audível: o par pode ficar meio dentro, meio fora (um na
 * porta).
 *
 * Não trata a sala de silêncio: lá quem cala tudo é o portão de som do
 * escritório (`lib/office-silence`), para a regra viver num lugar só.
 */
export function isHighFiveAudible(
  document: MapDocumentV1,
  listener: TilePosition,
  a: TilePosition,
  b: TilePosition,
): boolean {
  const listenerZone = mapZoneAt(document, listener.x, listener.y)
  return [a, b].some((member) => {
    const memberZone = mapZoneAt(document, member.x, member.y)
    if (memberZone) return listenerZone?.id === memberZone.id
    return listenerZone === null && isWithinProximity(listener.x, listener.y, member.x, member.y)
  })
}

/**
 * Tile de destino para "entrar" numa sala de reunião pelo deep link: o mais
 * central da sala que seja andável. Varre a caixa de tiles da sala em ordem de
 * distância ao centro, então uma mesa no meio não impede a chegada.
 * Devolve null se a sala não existe no mapa ou não tem tile andável.
 */
export function meetingRoomEntryTile(document: MapDocumentV1, externalKey: string): TilePosition | null {
  const room = document.objects.find(
    (object): object is MeetingRoomObjectV1 =>
      object.type === 'meeting-room' && object.properties.externalKey === externalKey,
  )
  if (!room) return null

  const { tileWidth, tileHeight } = document.map
  const geometry = room.geometry
  const bounds =
    geometry.kind === 'rectangle'
      ? { minX: geometry.x, minY: geometry.y, maxX: geometry.x + geometry.width, maxY: geometry.y + geometry.height }
      : geometry.points.reduce(
          (acc, point) => ({
            minX: Math.min(acc.minX, point.x),
            minY: Math.min(acc.minY, point.y),
            maxX: Math.max(acc.maxX, point.x),
            maxY: Math.max(acc.maxY, point.y),
          }),
          { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
        )

  const firstTileX = Math.floor(bounds.minX / tileWidth)
  const lastTileX = Math.ceil(bounds.maxX / tileWidth) - 1
  const firstTileY = Math.floor(bounds.minY / tileHeight)
  const lastTileY = Math.ceil(bounds.maxY / tileHeight) - 1
  const centerX = (firstTileX + lastTileX) / 2
  const centerY = (firstTileY + lastTileY) / 2

  const candidates: TilePosition[] = []
  for (let y = firstTileY; y <= lastTileY; y += 1) {
    for (let x = firstTileX; x <= lastTileX; x += 1) {
      // mapZoneAt garante que o tile é da SALA (importa em polígono, onde a
      // caixa envolvente pega área de fora).
      if (mapZoneAt(document, x, y)?.properties.externalKey !== externalKey) continue
      if (!isMapTileWalkable(document, x, y)) continue
      candidates.push({ x, y })
    }
  }
  if (candidates.length === 0) return null

  return candidates.sort(
    (a, b) => (a.x - centerX) ** 2 + (a.y - centerY) ** 2 - ((b.x - centerX) ** 2 + (b.y - centerY) ** 2),
  )[0]!
}

export function officeOpenRoom(mapId: string): string {
  return `office-map-${mapId}-open`
}

export function officeRoomForMapPosition(
  mapId: string,
  document: MapDocumentV1,
  x: number,
  y: number,
): string {
  const zone = mapZoneAt(document, x, y)
  const key =
    zone?.type === 'meeting-room'
      ? zone.properties.externalKey
      : zone?.properties.externalKey ?? zone?.id
  return key ? `office-map-${mapId}-zone-${key}` : officeOpenRoom(mapId)
}

/**
 * Caminho até outro personagem/mesa/tile do escritório. Fachada estável sobre
 * `findOfficePath` (Dijkstra sobre a grade do documento) — quem chama continua
 * falando em `MapDocumentV1`, e as opções novas (`blocked`, `fallback`) passam
 * direto.
 */
export function findMapPath(
  document: MapDocumentV1,
  from: TilePosition,
  to: TilePosition,
  options: OfficePathOptions = {},
): Direction[] | null {
  return findOfficePath(document, from, to, options)
}

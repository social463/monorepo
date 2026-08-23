import { describe, it, expect } from 'vitest'
import {
  createEmptyMapDocumentV1,
  findOfficePath,
  findPath,
  isMapTileWalkable,
  isWalkable,
  officeWalkGrid,
  DIRECTION_DELTAS,
  type Direction,
  type MapDocumentV1,
  type TilePosition,
} from './index'

/** Aplica um caminho e devolve a posição final. */
function walk(from: TilePosition, path: readonly ('up' | 'down' | 'left' | 'right')[]): TilePosition {
  let { x, y } = from
  for (const dir of path) {
    x += DIRECTION_DELTAS[dir].x
    y += DIRECTION_DELTAS[dir].y
  }
  return { x, y }
}

function isAdjacent(a: TilePosition, b: TilePosition): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1
}

describe('findPath', () => {
  it('caminho reto no chão aberto, terminando ADJACENTE ao alvo', () => {
    const from = { x: 3, y: 4 }
    const to = { x: 8, y: 4 }
    const path = findPath(from, to)
    expect(path).not.toBeNull()
    // cada passo cai num tile andável
    let cur = { ...from }
    for (const dir of path!) {
      cur = walk(cur, [dir])
      expect(isWalkable(cur.x, cur.y)).toBe(true)
    }
    // parou adjacente ao alvo, não em cima
    expect(cur).not.toEqual(to)
    expect(isAdjacent(cur, to)).toBe(true)
  })

  it('devolve [] quando já está adjacente ao alvo', () => {
    expect(findPath({ x: 3, y: 4 }, { x: 4, y: 4 })).toEqual([])
  })

  it('contorna as mesas (bloco D em 2..5 nas linhas 2-3) em vez de atravessar', () => {
    // de cima da mesa para baixo dela: precisa desviar, nunca pisa num D
    const from = { x: 3, y: 1 }
    const to = { x: 3, y: 5 }
    const path = findPath(from, to)
    expect(path).not.toBeNull()
    let cur = { ...from }
    for (const dir of path!) {
      cur = walk(cur, [dir])
      expect(isWalkable(cur.x, cur.y)).toBe(true) // nunca pisa numa mesa
    }
    expect(isAdjacent(cur, to)).toBe(true)
  })

  it('atravessa a porta (16,15) para chegar na sala de reunião 2', () => {
    const from = { x: 12, y: 15 } // spawn, espaço aberto
    const to = { x: 20, y: 15 }   // dentro da sala de reunião 2
    const path = findPath(from, to)
    expect(path).not.toBeNull()
    let cur = { ...from }
    const visited = [{ ...cur }]
    for (const dir of path!) {
      cur = walk(cur, [dir])
      expect(isWalkable(cur.x, cur.y)).toBe(true)
      visited.push({ ...cur })
    }
    // o único vão na parede da coluna 16 nessa faixa é a porta (16,15)
    expect(visited).toContainEqual({ x: 16, y: 15 })
    expect(isAdjacent(cur, to)).toBe(true)
  })

  it('devolve null quando o alvo é cercado por parede (sem vizinho andável)', () => {
    // (0,0) é canto de parede: todos os vizinhos são parede/borda
    expect(findPath({ x: 5, y: 5 }, { x: 0, y: 0 })).toBeNull()
  })
})

/** Documento 12×12 vazio, no tamanho de tile padrão do escritório. */
function emptyDocument(): MapDocumentV1 {
  return createEmptyMapDocumentV1({ width: 12, height: 12, tileSize: 32 })
}

function collisionAt(document: MapDocumentV1, x: number, y: number, cols = 1, rows = 1) {
  document.objects.push({
    id: `collision-${x}-${y}`, layerKey: 'collision', type: 'collision',
    geometry: { kind: 'rectangle', x: x * 32, y: y * 32, width: cols * 32, height: rows * 32 },
    properties: {},
  })
}

function meetingRoomAt(document: MapDocumentV1, x: number, y: number, cols: number, rows: number) {
  document.objects.push({
    id: `room-${x}-${y}`, layerKey: 'meeting-rooms', type: 'meeting-room',
    geometry: { kind: 'rectangle', x: x * 32, y: y * 32, width: cols * 32, height: rows * 32 },
    properties: {
      externalKey: `sala-${x}-${y}`, name: 'Sala', status: 'OPEN', capacity: 4,
      voiceEnabled: true, accessPolicy: 'OPEN',
    },
  })
}

function walkDocument(document: MapDocumentV1, from: TilePosition, path: readonly Direction[]): TilePosition[] {
  const visited: TilePosition[] = []
  let current = { ...from }
  for (const dir of path) {
    current = { x: current.x + DIRECTION_DELTAS[dir].x, y: current.y + DIRECTION_DELTAS[dir].y }
    expect(isMapTileWalkable(document, current.x, current.y)).toBe(true)
    visited.push(current)
  }
  return visited
}

describe('findOfficePath (Dijkstra no documento de mapa)', () => {
  it('entrega o caminho de menor custo em piso aberto', () => {
    const path = findOfficePath(emptyDocument(), { x: 1, y: 1 }, { x: 5, y: 1 }, { exact: true })
    expect(path).toEqual(['right', 'right', 'right', 'right'])
  })

  it('contorna colisão em vez de atravessá-la', () => {
    const document = emptyDocument()
    collisionAt(document, 3, 0, 1, 3) // parede vertical cobrindo (3,0)..(3,2)
    const path = findOfficePath(document, { x: 1, y: 1 }, { x: 5, y: 1 }, { exact: true })
    expect(path).not.toBeNull()
    const visited = walkDocument(document, { x: 1, y: 1 }, path!)
    expect(visited[visited.length - 1]).toEqual({ x: 5, y: 1 })
  })

  it('prefere o corredor a atravessar uma sala que não é o destino', () => {
    const document = emptyDocument()
    // Sala fechando o caminho reto entre (0,3) e (11,3); o corredor passa por fora.
    meetingRoomAt(document, 3, 2, 5, 3)
    const path = findOfficePath(document, { x: 1, y: 3 }, { x: 10, y: 3 }, { exact: true })
    expect(path).not.toBeNull()
    const visited = walkDocument(document, { x: 1, y: 3 }, path!)
    const dentroDaSala = visited.filter((tile) => tile.x >= 3 && tile.x <= 7 && tile.y >= 2 && tile.y <= 4)
    expect(dentroDaSala).toEqual([])
  })

  it('entra na sala quando o destino é dentro dela', () => {
    const document = emptyDocument()
    meetingRoomAt(document, 3, 2, 5, 3)
    const path = findOfficePath(document, { x: 1, y: 3 }, { x: 5, y: 3 }, { exact: true })
    expect(path).toEqual(['right', 'right', 'right', 'right'])
  })

  it('atravessa a sala quando ela é a única passagem (custo alto, não proibição)', () => {
    const document = emptyDocument()
    // Corredor de uma linha só: (0..11, 5), paredes acima e abaixo.
    collisionAt(document, 0, 4, 12, 1)
    collisionAt(document, 0, 6, 12, 1)
    meetingRoomAt(document, 4, 5, 3, 1)
    const path = findOfficePath(document, { x: 1, y: 5 }, { x: 9, y: 5 }, { exact: true })
    expect(path).toEqual(Array.from({ length: 8 }, () => 'right'))
  })

  it('desvia dos tiles recusados pelo servidor em vez de insistir na mesma porta', () => {
    const document = emptyDocument()
    // Sala com uma única porta em (4,3): o caminho reto tem que passar por ela.
    collisionAt(document, 4, 0, 1, 3)
    collisionAt(document, 4, 4, 1, 8)
    const semRecusa = findOfficePath(document, { x: 1, y: 3 }, { x: 8, y: 3 }, { exact: true })
    expect(semRecusa).not.toBeNull()
    expect(walkDocument(document, { x: 1, y: 3 }, semRecusa!)).toContainEqual({ x: 4, y: 3 })

    // A porta é a ÚNICA passagem: recusada, não sobra caminho nenhum.
    expect(
      findOfficePath(document, { x: 1, y: 3 }, { x: 8, y: 3 }, { exact: true, blocked: [{ x: 4, y: 3 }] }),
    ).toBeNull()
  })

  it('fallback closest: alvo inalcançável leva ao tile alcançável mais próximo', () => {
    const document = emptyDocument()
    collisionAt(document, 5, 5) // clique em cima de uma mesa/parede
    expect(findOfficePath(document, { x: 1, y: 5 }, { x: 5, y: 5 }, { exact: true })).toBeNull()
    const path = findOfficePath(document, { x: 1, y: 5 }, { x: 5, y: 5 }, { exact: true, fallback: 'closest' })
    expect(path).not.toBeNull()
    const visited = walkDocument(document, { x: 1, y: 5 }, path!)
    const last = visited[visited.length - 1]!
    expect(Math.abs(last.x - 5) + Math.abs(last.y - 5)).toBe(1)
  })

  it('fallback closest não afasta do alvo quando não há nada mais perto', () => {
    const document = emptyDocument()
    // Personagem trancado num tile: sem vizinho andável, nada fica mais perto.
    collisionAt(document, 0, 1)
    collisionAt(document, 1, 0)
    expect(
      findOfficePath(document, { x: 0, y: 0 }, { x: 8, y: 8 }, { exact: true, fallback: 'closest' }),
    ).toBeNull()
  })

  it('grade é reconstruída quando o documento ganha uma colisão nova', () => {
    const document = emptyDocument()
    expect(isMapTileWalkable(document, 2, 2)).toBe(true)
    collisionAt(document, 2, 2)
    expect(isMapTileWalkable(document, 2, 2)).toBe(false)
    expect(officeWalkGrid(document).blocked[2 * 12 + 2]).toBe(1)
  })

  it('kart estacionado sai do grafo; o tile de partida ignora karts', () => {
    const document = emptyDocument()
    const karts = [{ id: 'k1', x: 2, y: 1, dir: 'up' as const }, { id: 'k2', x: 1, y: 1, dir: 'up' as const }]
    const path = findOfficePath(document, { x: 1, y: 1 }, { x: 3, y: 1 }, { exact: true, karts })
    expect(path).not.toBeNull()
    // Saiu de cima do próprio kart e contornou o outro.
    expect(walkDocument(document, { x: 1, y: 1 }, path!)).not.toContainEqual({ x: 2, y: 1 })
  })
})

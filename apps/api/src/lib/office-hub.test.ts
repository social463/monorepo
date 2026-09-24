import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  defaultCharacterFromSeed,
  createEmptyMapDocumentV1,
  OFFICE_SPAWN_TILES,
  ROOM_CHAT_MESSAGE_MAX_LENGTH,
  REACTION_ACTIVE_WINDOW_MS,
  PERFECT_HIGH_FIVE_CHANCE,
  OFFICE_ANNOTATION_STROKE_ID_MAX_LENGTH,
  OFFICE_ANNOTATION_BATCH_MS,
  OFFICE_NEARBY_MESSAGE_MAX_LENGTH,
  ROOM_AUDIO_START_COOLDOWN_MS,
  PAINTBALL_COOLDOWN_MS,
  PAINTBALL_MAX_SPLATS,
  PAINTBALL_RANGE,
  BODY_SHOT_RANGE,
  PAINT_SPLAT_TTL_MS,
  paintballColorFor,
  isWalkable,
  BODY_SPEED,
  type BodyInput,
  type OfficeServerMessage,
  type Direction,
  type ActiveOfficeMapDTO,
} from '@legends/shared'
import {
  OfficeHub,
  type OfficeSocket,
  CALL_COOLDOWN_MS,
  CELEBRATION_THRESHOLD,
  CELEBRATION_COOLDOWN_MS,
  HIGH_FIVE_COOLDOWN_MS,
  RECONNECT_GRACE_MS,
  KNOCK_COOLDOWN_MS,
  ENTRY_DENIED_THROTTLE_MS,
} from './office-hub'
import { legacyOfficeRuntimeFixture } from '../test/office-map-fixture'

/** Socket falso: guarda tudo que o hub mandou, já parseado. */
function fakeSocket() {
  const sent: OfficeServerMessage[] = []
  const socket: OfficeSocket = { send: (data: string) => void sent.push(JSON.parse(data)) }
  return { socket, sent }
}

const DIRECTION_DELTAS: Record<Direction, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

/** BFS tile-a-tile simples: chega EM CIMA do alvo (diferente do findPath de produção, que para adjacente). */
function shortestPath(from: { x: number; y: number }, to: { x: number; y: number }): Direction[] {
  if (from.x === to.x && from.y === to.y) return []
  const key = (x: number, y: number) => `${x},${y}`
  const visited = new Set<string>([key(from.x, from.y)])
  const queue: Array<{ x: number; y: number; path: Direction[] }> = [{ ...from, path: [] }]
  while (queue.length > 0) {
    const node = queue.shift() as { x: number; y: number; path: Direction[] }
    for (const dir of ['up', 'down', 'left', 'right'] as Direction[]) {
      const delta = DIRECTION_DELTAS[dir]
      const nx = node.x + delta.x
      const ny = node.y + delta.y
      if (!isWalkable(nx, ny) || visited.has(key(nx, ny))) continue
      const path = [...node.path, dir]
      if (nx === to.x && ny === to.y) return path
      visited.add(key(nx, ny))
      queue.push({ x: nx, y: ny, path })
    }
  }
  throw new Error(`sem caminho andável de ${JSON.stringify(from)} até ${JSON.stringify(to)}`)
}

/** O centro, em PIXEL, de um tile — onde kart estacionado e spawn caem. */
function tileCenter(tile: { x: number; y: number }): { x: number; y: number } {
  return { x: tile.x * 32 + 16, y: tile.y * 32 + 16 }
}

/**
 * Dirige o kart para a FRENTE por alguns ticks.
 *
 * De kart, `dy` deixou de ser direção e virou acelerador/freio — é a mesma
 * pilotagem da corrida. `__walkForTest`, que fala em direções, não serve aqui:
 * mandar 'down' com um kart é pisar no freio.
 */
function drive(hub: OfficeHub, socket: OfficeSocket, userId: string, ticks: number): void {
  for (let i = 0; i < ticks; i += 1) {
    hub.applyInput(socket, userId, { seq: 1000 + i, dx: 0, dy: -1, dtMs: 33 })
    hub.__tickForTest(33)
  }
}

/** O TILE que uma posição em pixel ocupa — o occupant fala pixel desde o movimento livre. */
function tileOf(point: { x: number; y: number }): { x: number; y: number } {
  return { x: Math.floor(point.x / 32), y: Math.floor(point.y / 32) }
}

/**
 * Anda uma pessoa até o tile alvo, um tile por vez — atravessando portas de
 * verdade, que é o que dispara a cascata de sala.
 *
 * **Não força a chegada.** Uma versão anterior deste helper teleportava para o
 * alvo quando o caminho não completava, e isso anulava em silêncio justamente os
 * testes que importam: os de RECUSA. Quem é barrado numa sala trancada tem de
 * parar na porta, e um helper que "conserta" isso faz o teste passar provando o
 * contrário do que ele afirma.
 */
function walkTo(hub: OfficeHub, socket: OfficeSocket, userId: string, target: { x: number; y: number }): void {
  const occupant = hub.occupants().find((o) => o.userId === userId)!
  for (const dir of shortestPath(tileOf(occupant), target)) {
    hub.__walkForTest(socket, userId, dir)
  }
}

// Sala "Sala de Reunião 1" da fixture legada (OFFICE_ZONES): x0=17,y0=11,x1=23,y1=12.
const ROOM1_ID = 'room-reuniao-1'
const ROOM1_INSIDE = { x: 20, y: 12 }
const ROOM1_OUTSIDE = { x: 11, y: 12 }
/** Tile andável logo antes da sala: um passo pra direita já é dentro dela. */
const ROOM1_DOOR = { x: 16, y: 12 }
/** Um pixel dentro do primeiro tile da sala 1 — de raspão, sem comitar o tile. */
const ROOM1_INSIDE_EDGE_X = 17 * 32 + 1

const ana = { id: 'ana', name: 'Ana', photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null }
const bruno = { id: 'bruno', name: 'Bruno', photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null }
const carla = {
  id: 'carla',
  name: 'Carla',
  photoUrl: null,
  avatarStyle: null,
  avatarSeed: 'mimi',
  avatarOptions: defaultCharacterFromSeed('mimi'),
}

function runtimeWithKarts(
  karts: Array<{ id: string; x: number; y: number; rotation?: 0 | 90 | 180 | 270 }> = [
    { id: 'kart-1', x: 2, y: 1 },
  ],
  decorRevision = 0,
): ActiveOfficeMapDTO {
  const document = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 })
  const spawn = document.objects.find((object) => object.type === 'spawn-point')
  if (!spawn || spawn.geometry.kind !== 'point') throw new Error('spawn inválido')
  spawn.geometry.x = 48
  spawn.geometry.y = 48
  document.tilesets.push({
    id: 'kart-tileset',
    assetId: 'builtin:office/kart-32',
    name: 'Kart',
    tileWidth: 32,
    tileHeight: 32,
    columns: 1,
    tileCount: 1,
  })
  for (const kart of karts) {
    document.objects.push({
      id: kart.id,
      layerKey: 'objects',
      type: 'tile-object',
      geometry: {
        kind: 'rectangle',
        x: kart.x * 32,
        y: kart.y * 32,
        width: 32,
        height: 32,
      },
      properties: {
        tilesetId: 'kart-tileset',
        tileIndex: 0,
        ...(kart.rotation === undefined ? {} : { rotation: kart.rotation }),
      },
    })
  }
  return {
    map: { id: 'map-kart', name: 'Mapa Kart' },
    publication: {
      id: 'pub-kart',
      version: 1,
      schemaVersion: '1.0.0',
      createdAt: new Date(0).toISOString(),
      createdBy: null,
      active: true,
    },
    decorRevision,
    document,
    assets: [],
    rooms: [],
    desks: [],
    deskReminders: [],
  }
}

let hub: OfficeHub

beforeEach(() => {
  // Descarta o hub do caso anterior ANTES de criar o novo: desde o movimento
  // livre ele tem um `setInterval`, e um hub abandonado com o laço vivo
  // continua simulando gente que já saiu — atravessando para o caso seguinte.
  hub?.reset()
  hub = new OfficeHub()
  hub.configure(legacyOfficeRuntimeFixture())
})

describe('join', () => {
  it('coloca a pessoa num spawn e responde welcome', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)

    const welcome = a.sent.find((m) => m.type === 'welcome')
    expect(welcome).toMatchObject({ type: 'welcome', youId: 'ana' })

    const [occupant] = hub.occupants()
    expect(occupant.userId).toBe('ana')
    expect(OFFICE_SPAWN_TILES).toContainEqual(tileOf(occupant))
  })

  it('avisa quem já estava lá, e o welcome de quem chega já traz os outros', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    const b = fakeSocket()
    hub.join(b.socket, bruno)

    expect(a.sent).toContainEqual(
      expect.objectContaining({ type: 'joined', occupant: expect.objectContaining({ userId: 'bruno' }) }),
    )
    const welcome = b.sent.find((m) => m.type === 'welcome') as Extract<OfficeServerMessage, { type: 'welcome' }>
    expect(welcome.occupants.map((o) => o.userId).sort()).toEqual(['ana', 'bruno'])
  })

  it('duas abas da mesma pessoa = um personagem só', () => {
    const tab1 = fakeSocket()
    const tab2 = fakeSocket()
    hub.join(tab1.socket, ana)
    hub.join(tab2.socket, ana)

    expect(hub.occupants()).toHaveLength(1)
    // a segunda aba não anuncia um "joined" duplicado para a primeira
    expect(tab1.sent.filter((m) => m.type === 'joined')).toHaveLength(0)
  })

  it('welcome e joined carregam avatarSeed/avatarOptions do usuário', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana) // ana não tem avatar customizado

    const c = fakeSocket()
    hub.join(c.socket, carla)

    const welcome = c.sent.find((m) => m.type === 'welcome') as Extract<
      OfficeServerMessage,
      { type: 'welcome' }
    >
    expect(welcome.occupants.find((o) => o.userId === 'carla')).toMatchObject({
      avatarSeed: 'mimi',
      avatarOptions: carla.avatarOptions,
    })
    expect(welcome.occupants.find((o) => o.userId === 'ana')).toMatchObject({
      avatarSeed: null,
      avatarOptions: null,
    })

    expect(a.sent).toContainEqual(
      expect.objectContaining({
        type: 'joined',
        occupant: expect.objectContaining({ avatarSeed: 'mimi' }),
      }),
    )
  })
})

describe('movimento livre', () => {
  const TILE = 32
  const tileOf = (o: { x: number; y: number }) => ({
    x: Math.floor(o.x / TILE),
    y: Math.floor(o.y / TILE),
  })

  it('anda para onde o input aponta, e o snapshot leva a posição', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    const antes = hub.occupants().find((o) => o.userId === 'ana')!
    const tile = tileOf(antes)
    const dir = isWalkable(tile.x, tile.y - 1) ? 'up' : 'down'

    hub.__walkForTest(a.socket, 'ana', dir)

    const depois = hub.occupants().find((o) => o.userId === 'ana')!
    // Um tile de deslocamento, agora medido em PIXEL: a posição é contínua, e
    // exigir o centro exato do tile seria exigir de volta a grade.
    expect(Math.abs(depois.y - antes.y)).toBeCloseTo(TILE, 5)
    expect(depois.x).toBeCloseTo(antes.x, 5)
    expect(depois.dir).toBe(dir)

    const snapshot = b.sent.filter((m) => m.type === 'snapshot').at(-1) as
      | { players: Array<{ userId: string; x: number; y: number; dir: string; seq: number }> }
      | undefined
    expect(snapshot?.players.find((p) => p.userId === 'ana')).toMatchObject({
      x: depois.x,
      y: depois.y,
      dir,
    })
  })

  it('não atravessa parede — desliza e para nela', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    const antes = hub.occupants().find((o) => o.userId === 'ana')!

    for (let i = 0; i < 40; i += 1) hub.__walkForTest(a.socket, 'ana', 'left')

    const depois = hub.occupants().find((o) => o.userId === 'ana')!
    expect(depois.y).toBeCloseTo(antes.y, 5)
    expect(depois.x).toBeGreaterThan(0)
    // Encostou de fato: o tile à esquerda do corpo é sólido.
    expect(isWalkable(tileOf(depois).x - 1, tileOf(depois).y)).toBe(false)
  })

  it('ignora input de socket desconhecido', () => {
    const fantasma = fakeSocket()
    hub.applyInput(fantasma.socket, 'ana', { seq: 1, dx: 1, dy: 0, dtMs: 33 })
    expect(hub.occupants()).toHaveLength(0)
    expect(fantasma.sent).toHaveLength(0)
  })

  it('ignora input fora de ordem — passo velho não volta no tempo', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.__walkForTest(a.socket, 'ana', 'right')
    const depoisDoPasso = hub.occupants()[0].x

    // `seq` 1 já foi processado várias vezes; um pacote atrasado com seq baixo
    // não pode reabrir o passado.
    hub.applyInput(a.socket, 'ana', { seq: 1, dx: -1, dy: 0, dtMs: 50 })
    expect(hub.occupants()[0].x).toBe(depoisDoPasso)
  })

  it('não dá para comprar velocidade inflando o próprio dtMs', () => {
    // A proteção que substituiu o token bucket do `move` de grade. O `dtMs` vem
    // do CLIENTE; o servidor credita tempo pelo relógio DELE e debita por input
    // aplicado, então quem manda mais tempo do que viveu vê o excedente ficar
    // para o tick seguinte — não anda mais que os outros.
    const honesto = fakeSocket()
    const trapaceiro = fakeSocket()
    hub.join(honesto.socket, ana)
    hub.join(trapaceiro.socket, bruno)
    const partidaA = hub.occupants().find((o) => o.userId === 'ana')!.x
    const partidaB = hub.occupants().find((o) => o.userId === 'bruno')!.x

    // Mesmo tick de simulação para os dois; o trapaceiro pede 20× mais tempo.
    for (let seq = 1; seq <= 10; seq += 1) {
      hub.applyInput(honesto.socket, 'ana', { seq, dx: 1, dy: 0, dtMs: 33 })
      hub.applyInput(trapaceiro.socket, 'bruno', { seq, dx: 1, dy: 0, dtMs: 660 })
      hub.__tickForTest(33)
    }

    const andouHonesto = Math.abs(hub.occupants().find((o) => o.userId === 'ana')!.x - partidaA)
    const andouTrapaceiro = Math.abs(hub.occupants().find((o) => o.userId === 'bruno')!.x - partidaB)
    // Alguma folga existe de propósito (o banco tolera jitter), mas não 20×.
    expect(andouTrapaceiro).toBeLessThan(andouHonesto * 3)
  })

  it('a fila de pendentes tem teto — enfileirar não vira estoque de movimento', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    const partida = hub.occupants()[0].x

    // Muito mais input do que cabe, tudo no mesmo instante.
    for (let seq = 1; seq <= 200; seq += 1) {
      hub.applyInput(a.socket, 'ana', { seq, dx: 1, dy: 0, dtMs: 50 })
    }
    hub.__tickForTest(50)

    // Um tick só credita um tick de tempo: o resto fica na fila (e a fila tem
    // teto), então o deslocamento é o de um passo, não o de duzentos.
    const andou = Math.abs(hub.occupants()[0].x - partida)
    expect(andou).toBeLessThan(TILE * 2)
  })

  it('duas abas da mesma pessoa movem UM corpo só', () => {
    const tab1 = fakeSocket()
    const tab2 = fakeSocket()
    hub.join(tab1.socket, ana)
    hub.join(tab2.socket, ana)
    const partida = hub.occupants()[0].x

    // Alternando as abas: se cada uma tivesse orçamento próprio, o corpo andaria
    // o dobro. O banco de tempo é do USUÁRIO, não do socket.
    for (let seq = 1; seq <= 20; seq += 2) {
      hub.applyInput(tab1.socket, 'ana', { seq, dx: 1, dy: 0, dtMs: 33 })
      hub.applyInput(tab2.socket, 'ana', { seq: seq + 1, dx: 1, dy: 0, dtMs: 33 })
      hub.__tickForTest(33)
    }

    const andou = Math.abs(hub.occupants()[0].x - partida)
    const sozinho = (BODY_SPEED * 10 * 33) / 1000
    expect(andou).toBeLessThan(sozinho * 1.5)
  })

  it('sprint viaja no snapshot — é o que faz as pernas acompanharem', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    const tile = tileOf(hub.occupants().find((o) => o.userId === 'ana')!)
    const dir = isWalkable(tile.x, tile.y - 1) ? 'up' : 'down'

    hub.__walkForTest(a.socket, 'ana', dir, true)

    const snapshot = b.sent.filter((m) => m.type === 'snapshot').at(-1) as
      | { players: Array<{ userId: string; sprint?: boolean }> }
      | undefined
    expect(snapshot?.players.find((p) => p.userId === 'ana')?.sprint).toBe(true)
  })

  it('reconectar não congela o personagem para sempre', () => {
    // O escritório GUARDA a presença por 45s, então reconectar reaproveita a
    // mesma entrada — com o `lastSeq` alto. O cliente, esse, cria um preditor
    // novo começando do zero. Sem o servidor dizer de onde retomar, todo input
    // do cliente novo chega com `seq <= lastSeq` e é descartado como atrasado:
    // a pessoa anda até cair a conexão e não sai mais do lugar, sem nada na
    // tela explicando por quê.
    const a = fakeSocket()
    hub.join(a.socket, ana)
    for (let seq = 1; seq <= 10; seq += 1) {
      hub.applyInput(a.socket, 'ana', { seq, dx: 1, dy: 0, dtMs: 33 })
      hub.__tickForTest(33)
    }

    hub.leave(a.socket, 'ana') // caiu, dentro do período de graça
    const b = fakeSocket()
    hub.join(b.socket, ana)

    // O `welcome` diz de onde retomar a numeração.
    const welcome = b.sent.find((m) => m.type === 'welcome') as { seq?: number }
    expect(welcome.seq).toBeGreaterThanOrEqual(10)

    // E, retomando dali, o personagem volta a andar.
    const partida = hub.occupantOf('ana')!.x
    for (let i = 1; i <= 10; i += 1) {
      hub.applyInput(b.socket, 'ana', { seq: welcome.seq! + i, dx: 1, dy: 0, dtMs: 33 })
      hub.__tickForTest(33)
    }
    expect(hub.occupantOf('ana')!.x).toBeGreaterThan(partida)
  })

  it('escritório parado não emite snapshot', () => {
    // A supressão não é otimização: é o que devolve o custo zero da sala parada.
    // Sem ela, trinta pessoas de pé custariam 600 pacotes por segundo para não
    // dizer nada.
    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.__walkForTest(a.socket, 'ana', 'right')
    const depoisDeAndar = a.sent.filter((m) => m.type === 'snapshot').length

    for (let i = 0; i < 20; i += 1) hub.__tickForTest(25)

    expect(a.sent.filter((m) => m.type === 'snapshot')).toHaveLength(depoisDeAndar)
  })
})

describe('face', () => {
  it('gira no lugar e faz broadcast, sem mudar x,y', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    const before = hub.occupants().find((o) => o.userId === 'ana')!
    const dir: Direction = before.dir === 'up' ? 'down' : 'up'

    hub.face(a.socket, 'ana', dir)

    const after = hub.occupants().find((o) => o.userId === 'ana')!
    expect(after).toMatchObject({ x: before.x, y: before.y, dir })
    expect(b.sent).toContainEqual({ type: 'faced', userId: 'ana', dir })
  })

  it('gira mesmo direção bloqueada por parede (não é `move`, não checa colisão)', () => {
    vi.useFakeTimers()
    try {
      const a = fakeSocket()
      hub.join(a.socket, ana)
      const before = hub.occupants().find((o) => o.userId === 'ana')!
      for (let i = 0; i < 40; i += 1) {
        hub.__walkForTest(a.socket, 'ana', 'left')
        vi.advanceTimersByTime(200)
      }
      const atWall = hub.occupants().find((o) => o.userId === 'ana')!
      expect(isWalkable(atWall.x - 1, atWall.y)).toBe(false)

      hub.face(a.socket, 'ana', 'left')

      const after = hub.occupants().find((o) => o.userId === 'ana')!
      expect(after.x).toBe(atWall.x)
      expect(after.y).toBe(atWall.y)
      expect(after.dir).toBe('left')
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignora face de socket desconhecido', () => {
    const ghost = fakeSocket()
    hub.face(ghost.socket, 'ana', 'up')
    expect(hub.occupants()).toHaveLength(0)
    expect(ghost.sent).toHaveLength(0)
  })
})

const carol = { id: 'carol', name: 'Carol', photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null }

describe('sendToUser', () => {
  it('entrega a mensagem a TODAS as abas do usuário e retorna true', () => {
    const tab1 = fakeSocket()
    const tab2 = fakeSocket()
    hub.join(tab1.socket, ana)
    hub.join(tab2.socket, ana)

    const ok = hub.sendToUser('ana', { type: 'left', userId: 'x' })
    expect(ok).toBe(true)
    expect(tab1.sent).toContainEqual({ type: 'left', userId: 'x' })
    expect(tab2.sent).toContainEqual({ type: 'left', userId: 'x' })
  })

  it('retorna false quando o usuário não está no escritório', () => {
    expect(hub.sendToUser('ninguem', { type: 'left', userId: 'x' })).toBe(false)
  })
})

describe('call', () => {
  it('entrega incoming-call (com nome do chamador) a todas as abas do alvo', () => {
    const a = fakeSocket()
    const bTab1 = fakeSocket()
    const bTab2 = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(bTab1.socket, bruno)
    hub.join(bTab2.socket, bruno)

    hub.call(a.socket, 'ana', 'bruno')

    const expected = { type: 'incoming-call', from: { userId: 'ana', name: 'Ana' } }
    expect(bTab1.sent).toContainEqual(expected)
    expect(bTab2.sent).toContainEqual(expected)
    // o chamador não recebe incoming-call
    expect(a.sent.some((m) => m.type === 'incoming-call')).toBe(false)
  })

  it('alvo offline → call-failed offline para o chamador', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.call(a.socket, 'ana', 'fantasma')
    expect(a.sent).toContainEqual({ type: 'call-failed', targetUserId: 'fantasma', reason: 'offline' })
  })

  it('spam de chamadas → call-failed rate-limited (1 a cada 3s)', () => {
    vi.useFakeTimers()
    try {
      const a = fakeSocket()
      const b = fakeSocket()
      const c = fakeSocket()
      hub.join(a.socket, ana)
      hub.join(b.socket, bruno)
      hub.join(c.socket, carol)

      hub.call(a.socket, 'ana', 'bruno') // 1ª passa
      hub.call(a.socket, 'ana', 'carol') // 2ª imediata: barrada

      expect(b.sent.some((m) => m.type === 'incoming-call')).toBe(true)
      expect(c.sent.some((m) => m.type === 'incoming-call')).toBe(false)
      expect(a.sent).toContainEqual({ type: 'call-failed', targetUserId: 'carol', reason: 'rate-limited' })

      // depois do cooldown, passa de novo
      vi.advanceTimersByTime(CALL_COOLDOWN_MS + 10)
      hub.call(a.socket, 'ana', 'carol')
      expect(c.sent.some((m) => m.type === 'incoming-call')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignora call de socket cujo dono não bate com o callerId (anti-spoof)', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    // socket da ana tentando chamar EM NOME do bruno
    hub.call(a.socket, 'bruno', 'ana')
    expect(a.sent.some((m) => m.type === 'incoming-call')).toBe(false)
  })

  it('alvo ausente/volto logo → call-failed away para o chamador, sem entregar incoming-call', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    hub.setStatus(b.socket, 'bruno', 'away')

    hub.call(a.socket, 'ana', 'bruno')

    expect(a.sent).toContainEqual({ type: 'call-failed', targetUserId: 'bruno', reason: 'away' })
    expect(b.sent.some((m) => m.type === 'incoming-call')).toBe(false)
  })
})

describe('callResponse', () => {
  it('entrega call-result só ao chamador', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)

    hub.callResponse(b.socket, 'bruno', 'ana', true)
    expect(a.sent).toContainEqual({ type: 'call-result', targetUserId: 'bruno', accepted: true })
    // o próprio respondente não recebe call-result
    expect(b.sent.some((m) => m.type === 'call-result')).toBe(false)
  })

  it('chamador saiu no meio → descarta sem erro', () => {
    const b = fakeSocket()
    hub.join(b.socket, bruno)
    expect(() => hub.callResponse(b.socket, 'bruno', 'ana', false)).not.toThrow()
  })

  it('ignora resposta de socket cujo dono não bate com o responderId', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    // socket da ana respondendo em nome do bruno
    hub.callResponse(a.socket, 'bruno', 'ana', true)
    expect(a.sent.some((m) => m.type === 'call-result')).toBe(false)
  })
})

describe('leave', () => {
  it('outra aba do mesmo usuário continua aberta: some da entry só quando a última fecha', () => {
    const tab1 = fakeSocket()
    const tab2 = fakeSocket()
    const b = fakeSocket()
    hub.join(tab1.socket, ana)
    hub.join(tab2.socket, ana)
    hub.join(b.socket, bruno)

    hub.leave(tab1.socket, 'ana')
    expect(hub.occupants().map((o) => o.userId)).toContain('ana')
    expect(b.sent.some((m) => m.type === 'left')).toBe(false)
  })

  it('a última aba fechar NÃO remove na hora — fica no período de graça, ainda visível pros outros', () => {
    const tab1 = fakeSocket()
    const b = fakeSocket()
    hub.join(tab1.socket, ana)
    hub.join(b.socket, bruno)

    hub.leave(tab1.socket, 'ana')

    expect(hub.occupants().map((o) => o.userId)).toContain('ana')
    expect(b.sent.some((m) => m.type === 'left')).toBe(false)
  })

  it('sem reconectar dentro do período de graça, a saída se efetiva e avisa os outros', () => {
    vi.useFakeTimers()
    try {
      const tab1 = fakeSocket()
      const b = fakeSocket()
      hub.join(tab1.socket, ana)
      hub.join(b.socket, bruno)

      hub.leave(tab1.socket, 'ana')
      vi.advanceTimersByTime(RECONNECT_GRACE_MS + 10)

      expect(hub.occupants().map((o) => o.userId)).not.toContain('ana')
      expect(b.sent).toContainEqual({ type: 'left', userId: 'ana' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('saída explícita remove na hora e avisa os outros', () => {
    vi.useFakeTimers()
    try {
      const tab1 = fakeSocket()
      const b = fakeSocket()
      hub.join(tab1.socket, ana)
      hub.join(b.socket, bruno)

      hub.leaveNow(tab1.socket, 'ana')

      expect(hub.occupants().map((o) => o.userId)).not.toContain('ana')
      expect(b.sent).toContainEqual({ type: 'left', userId: 'ana' })

      vi.advanceTimersByTime(RECONNECT_GRACE_MS + 10)
      expect(b.sent.filter((m) => m.type === 'left' && m.userId === 'ana')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reconectar DENTRO do período de graça retoma a mesma posição, sem "left"/"joined" pros outros', () => {
    vi.useFakeTimers()
    try {
      const tab1 = fakeSocket()
      const b = fakeSocket()
      hub.join(tab1.socket, ana)
      hub.join(b.socket, bruno)
      walkTo(hub, tab1.socket, 'ana', ROOM1_INSIDE)
      const position = hub.occupantOf('ana')

      hub.leave(tab1.socket, 'ana')
      vi.advanceTimersByTime(RECONNECT_GRACE_MS - 1000)

      const tab2 = fakeSocket()
      hub.join(tab2.socket, ana)

      expect(hub.occupantOf('ana')).toMatchObject({ x: position!.x, y: position!.y })
      expect(b.sent.some((m) => m.type === 'left')).toBe(false)
      expect(b.sent.some((m) => m.type === 'joined')).toBe(false)

      // O timer de graça antigo (cancelado no reconnect) não deve remover
      // a pessoa depois, mesmo passado o tempo que ele levaria pra disparar.
      vi.advanceTimersByTime(RECONNECT_GRACE_MS + 1000)
      expect(hub.occupants().map((o) => o.userId)).toContain('ana')
    } finally {
      vi.useRealTimers()
    }
  })

  it('reconectar DEPOIS do período de graça expirar respawna normalmente (sem posição pra retomar)', () => {
    vi.useFakeTimers()
    try {
      const tab1 = fakeSocket()
      hub.join(tab1.socket, ana)
      hub.leave(tab1.socket, 'ana')
      vi.advanceTimersByTime(RECONNECT_GRACE_MS + 1000)

      const tab2 = fakeSocket()
      hub.join(tab2.socket, ana)

      const occupant = hub.occupantOf('ana')
      expect(OFFICE_SPAWN_TILES).toContainEqual(tileOf(occupant!))
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('updateAvatar', () => {
  it('atualiza o occupant e faz broadcast de avatar-updated para todos (inclusive o próprio)', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    const b = fakeSocket()
    hub.join(b.socket, bruno)

    const options = defaultCharacterFromSeed('ana-novo')
    hub.updateAvatar('ana', 'ana-novo', options)

    expect(hub.occupants().find((o) => o.userId === 'ana')?.avatarOptions).toEqual(options)
    expect(hub.occupants().find((o) => o.userId === 'ana')?.avatarSeed).toBe('ana-novo')
    const expected = { type: 'avatar-updated', userId: 'ana', avatarSeed: 'ana-novo', avatarOptions: options }
    expect(a.sent).toContainEqual(expected)
    expect(b.sent).toContainEqual(expected)
  })

  it('é no-op para quem não está no escritório', () => {
    expect(() => hub.updateAvatar('ninguem', null, null)).not.toThrow()
  })
})

describe('setStatus', () => {
  it('novo occupant nasce com status online', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    expect(hub.occupants().find((o) => o.userId === 'ana')?.status).toBe('online')
  })

  it('muda o status do occupant e faz broadcast de status-changed para todos (inclusive o próprio)', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    const b = fakeSocket()
    hub.join(b.socket, bruno)

    hub.setStatus(a.socket, 'ana', 'away')

    expect(hub.occupants().find((o) => o.userId === 'ana')?.status).toBe('away')
    const expected = { type: 'status-changed', userId: 'ana', status: 'away' }
    expect(a.sent).toContainEqual(expected)
    expect(b.sent).toContainEqual(expected)
  })

  it('ignora set-status de socket cujo dono não bate com o userId (anti-spoof)', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    const b = fakeSocket()
    hub.join(b.socket, bruno)

    hub.setStatus(b.socket, 'ana', 'brb')

    expect(hub.occupants().find((o) => o.userId === 'ana')?.status).toBe('online')
  })

  it('é no-op para quem não está no escritório', () => {
    const ghost = fakeSocket()
    expect(() => hub.setStatus(ghost.socket, 'ninguem', 'away')).not.toThrow()
  })

  it('dentro da zona privada, pedir "brb" é ignorado e força "away"', () => {
    const runtime = legacyOfficeRuntimeFixture()
    runtime.document.objects.push({
      id: 'private-zona-1',
      layerKey: 'private-zones',
      type: 'private-zone',
      geometry: { kind: 'rectangle', x: 5 * 32, y: 1 * 32, width: 32, height: 32 },
      properties: { name: 'Zona privada de teste', externalKey: 'zona-1', accessPolicy: 'OPEN' },
    })
    hub.configure(runtime)

    const a = fakeSocket()
    hub.join(a.socket, ana)
    walkTo(hub, a.socket, 'ana', { x: 5, y: 1 })

    hub.setStatus(a.socket, 'ana', 'brb')

    expect(hub.occupants().find((o) => o.userId === 'ana')?.status).toBe('away')
    expect(a.sent).toContainEqual({ type: 'status-changed', userId: 'ana', status: 'away' })
  })

  // Zona privada de 1 tile logo ao lado do spawn — entrar/sair custa um passo
  // cada. (Passos únicos evitam drenar o bucket de tokens de movimento: em
  // teste síncrono o refill por tempo não roda, e um trajeto longo esgota os
  // 20 tokens antes de a pessoa conseguir sair.)
  const PRIVATE_ZONE = { x: 12, y: 13 }
  function configurePrivateZone(): void {
    const runtime = legacyOfficeRuntimeFixture()
    runtime.document.objects.push({
      id: 'private-zona-1',
      layerKey: 'private-zones',
      type: 'private-zone',
      geometry: {
        kind: 'rectangle',
        x: PRIVATE_ZONE.x * 32,
        y: PRIVATE_ZONE.y * 32,
        width: 32,
        height: 32,
      },
      properties: { name: 'Zona privada de teste', externalKey: 'zona-1', accessPolicy: 'OPEN' },
    })
    hub.configure(runtime)
  }

  function stepOutOfPrivateZone(socket: OfficeSocket, userId: string): void {
    const exits: Array<[Direction, { x: number; y: number }]> = [
      ['up', { x: PRIVATE_ZONE.x, y: PRIVATE_ZONE.y - 1 }],
      ['down', { x: PRIVATE_ZONE.x, y: PRIVATE_ZONE.y + 1 }],
      ['left', { x: PRIVATE_ZONE.x - 1, y: PRIVATE_ZONE.y }],
      ['right', { x: PRIVATE_ZONE.x + 1, y: PRIVATE_ZONE.y }],
    ]
    const exit = exits.find(([, p]) => isWalkable(p.x, p.y))
    if (!exit) throw new Error('nenhum vizinho andável da zona privada para sair')
    hub.__walkForTest(socket, userId, exit[0])
  }

  // O passo que sai da sala é, ele próprio, sinal de atividade: sair andando
  // zera pra "online" mesmo pra quem entrou com status manual. Andar é a
  // prova de que voltou — o status manual não sobrevive ao movimento.
  it('sair andando da zona privada zera pra "online" mesmo quem entrou "brb"', () => {
    configurePrivateZone()

    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.setStatus(a.socket, 'ana', 'brb')

    walkTo(hub, a.socket, 'ana', PRIVATE_ZONE)
    expect(hub.occupants().find((o) => o.userId === 'ana')?.status).toBe('away')

    stepOutOfPrivateZone(a.socket, 'ana')
    expect(hub.occupants().find((o) => o.userId === 'ana')?.status).toBe('online')
    expect(a.sent).toContainEqual({ type: 'status-changed', userId: 'ana', status: 'online' })
  })

  it('dentro da zona privada, falar não destrava o "away"', () => {
    configurePrivateZone()

    const a = fakeSocket()
    hub.join(a.socket, ana)
    walkTo(hub, a.socket, 'ana', PRIVATE_ZONE)
    expect(hub.occupants().find((o) => o.userId === 'ana')?.status).toBe('away')

    hub.nearbyMessage(a.socket, 'ana', 'oi')

    expect(hub.occupants().find((o) => o.userId === 'ana')?.status).toBe('away')
    expect(a.sent).not.toContainEqual({ type: 'status-changed', userId: 'ana', status: 'online' })
  })

  it('quem entra "online" na zona privada volta "online" ao sair', () => {
    configurePrivateZone()

    const a = fakeSocket()
    hub.join(a.socket, ana)

    walkTo(hub, a.socket, 'ana', PRIVATE_ZONE)
    expect(hub.occupants().find((o) => o.userId === 'ana')?.status).toBe('away')

    stepOutOfPrivateZone(a.socket, 'ana')
    expect(hub.occupants().find((o) => o.userId === 'ana')?.status).toBe('online')
  })
})

describe('setCharacterName', () => {
  it('muda só o alias do personagem e faz broadcast para todos (inclusive o próprio)', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    const b = fakeSocket()
    hub.join(b.socket, bruno)

    hub.setCharacterName(a.socket, 'ana', 'Nina')

    expect(hub.occupants().find((o) => o.userId === 'ana')).toMatchObject({
      name: 'Ana',
      characterName: 'Nina',
    })
    const expected = { type: 'character-name-changed', userId: 'ana', name: 'Nina' }
    expect(a.sent).toContainEqual(expected)
    expect(b.sent).toContainEqual(expected)
  })

  it('limpa o alias quando recebe valor vazio', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)

    hub.setCharacterName(a.socket, 'ana', 'Nina')
    hub.setCharacterName(a.socket, 'ana', '   ')

    expect(hub.occupants().find((o) => o.userId === 'ana')?.characterName).toBeNull()
    expect(a.sent).toContainEqual({ type: 'character-name-changed', userId: 'ana', name: null })
  })

  it('ignora set-character-name de socket cujo dono não bate com o userId (anti-spoof)', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    const b = fakeSocket()
    hub.join(b.socket, bruno)

    hub.setCharacterName(b.socket, 'ana', 'Nina')

    expect(hub.occupants().find((o) => o.userId === 'ana')?.characterName).toBeNull()
  })
})

describe('roomChatMessage', () => {
  it('chega aos outros sockets da sala, sem ecoar no socket remetente', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)

    hub.roomChatMessage(a.socket, 'ana', 'oi pessoal')

    expect(a.sent.some((m) => m.type === 'room-chat-message')).toBe(false)
    expect(b.sent).toContainEqual(
      expect.objectContaining({ type: 'room-chat-message', roomId: ROOM1_ID, userId: 'ana', text: 'oi pessoal' }),
    )
  })

  it('outra aba do remetente recebe a mensagem', () => {
    const tab1 = fakeSocket()
    const tab2 = fakeSocket()
    hub.join(tab1.socket, ana)
    hub.join(tab2.socket, ana)
    walkTo(hub, tab1.socket, 'ana', ROOM1_INSIDE)

    hub.roomChatMessage(tab1.socket, 'ana', 'oi da outra aba')

    expect(tab1.sent.some((m) => m.type === 'room-chat-message')).toBe(false)
    expect(tab2.sent).toContainEqual(
      expect.objectContaining({ type: 'room-chat-message', userId: 'ana', text: 'oi da outra aba' }),
    )
  })

  it('quem entra depois não recebe mensagens anteriores', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
    hub.roomChatMessage(a.socket, 'ana', 'oi pessoal')

    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)

    expect(b.sent.some((m) => m.type === 'room-chat-message')).toBe(false)
  })

  it('mandar de fora de sala (espaço aberto) não faz nada', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)

    hub.roomChatMessage(a.socket, 'ana', 'oi da área aberta')

    expect(b.sent.some((m) => m.type === 'room-chat-message')).toBe(false)
  })

  it('texto é cortado no tamanho máximo', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)

    const longText = 'x'.repeat(ROOM_CHAT_MESSAGE_MAX_LENGTH + 50)
    hub.roomChatMessage(a.socket, 'ana', longText)

    const message = b.sent.find((m) => m.type === 'room-chat-message') as Extract<
      OfficeServerMessage,
      { type: 'room-chat-message' }
    >
    expect(message.text).toHaveLength(ROOM_CHAT_MESSAGE_MAX_LENGTH)
  })
})


function runtimeWithBalls(
  balls: Array<{ id: string; x: number; y: number }> = [{ id: 'ball-1', x: 1, y: 2 }],
  decorRevision = 0,
): ActiveOfficeMapDTO {
  const runtime = runtimeWithKarts([], decorRevision)
  const document = runtime.document
  document.tilesets.push({
    id: 'ball-tileset',
    assetId: 'builtin:office/ball-32',
    name: 'Bola',
    tileWidth: 32,
    tileHeight: 32,
    columns: 1,
    tileCount: 1,
  })
  for (const ball of balls) {
    document.objects.push({
      id: ball.id,
      layerKey: 'objects',
      type: 'tile-object',
      geometry: { kind: 'rectangle', x: ball.x * 32, y: ball.y * 32, width: 32, height: 32 },
      properties: { tilesetId: 'ball-tileset', tileIndex: 0 },
    })
  }
  return runtime
}

describe('kart (#22253)', () => {
  beforeEach(() => hub.configure(runtimeWithKarts()))

  // Save de decoração grava in-place (card 22041): a publicação continua a
  // MESMA e só o `decorRevision` avança. Se a reconciliação dependesse da
  // troca de publicação, o kart movido no editor ficaria congelado no lugar
  // antigo — e o `karts-updated` do próprio save sairia com a lista velha.
  it('reconcilia karts quando só o decorRevision avança', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)

    hub.configure(runtimeWithKarts([{ id: 'kart-1', x: 5, y: 5 }], 1), false, true)

    expect(hub.karts()).toEqual([{ id: 'kart-1', ...tileCenter({ x: 5, y: 5 }), dir: 'up' }])
  })

  it('preserva o piloto quando o decorRevision avança', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.rideKart(a.socket, 'ana')

    hub.configure(runtimeWithKarts([{ id: 'kart-1', x: 5, y: 5 }], 1), false, true)

    expect(hub.karts()[0].riderUserId).toBe('ana')
    expect(hub.occupantOf('ana')?.ridingKartId).toBe('kart-1')
  })

  it('welcome traz os karts publicados com posição e direção', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)

    expect(a.sent).toContainEqual(
      expect.objectContaining({
        type: 'welcome',
        karts: [{ id: 'kart-1', ...tileCenter({ x: 2, y: 1 }), dir: 'up' }],
      }),
    )
  })

  it('E monta no kart próximo e estaciona na posição atual', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)

    hub.rideKart(a.socket, 'ana')
    expect(a.sent).toContainEqual({
      type: 'kart-ride',
      userId: 'ana',
      active: true,
      kart: { id: 'kart-1', ...tileCenter({ x: 1, y: 1 }), dir: 'down', riderUserId: 'ana' },
    })
    expect(hub.occupantOf('ana')?.ridingKartId).toBe('kart-1')

    // Dirige para a frente (o kart nasce apontado para onde a pessoa encara) e
    // estaciona: o veículo fica ONDE O PILOTO PAROU, não num tile redondo.
    drive(hub, a.socket, 'ana', 20)
    const parouEm = hub.occupantOf('ana')!
    hub.rideKart(a.socket, 'ana')

    expect(b.sent).toContainEqual({
      type: 'kart-ride',
      userId: 'ana',
      active: false,
      kart: { id: 'kart-1', x: parouEm.x, y: parouEm.y, dir: parouEm.dir },
    })
    expect(hub.occupantOf('ana')?.ridingKartId).toBeUndefined()
    expect(hub.karts()).toEqual([{ id: 'kart-1', x: parouEm.x, y: parouEm.y, dir: parouEm.dir }])
  })

  it('quem entra depois recebe piloto e posição atual do veículo', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.rideKart(a.socket, 'ana')
    hub.__walkForTest(a.socket, 'ana', 'down')

    const c = fakeSocket()
    hub.join(c.socket, carla)
    const welcome = c.sent.find((m) => m.type === 'welcome') as Extract<
      OfficeServerMessage,
      { type: 'welcome' }
    >
    expect(welcome.occupants.find((occupant) => occupant.userId === 'ana')).toMatchObject({
      ridingKartId: 'kart-1',
    })
    // O kart montado acompanha o piloto em PIXEL, então a posição dele é a de
    // Ana — não o centro de um tile.
    const ana2 = hub.occupantOf('ana')!
    expect(welcome.karts).toEqual([
      expect.objectContaining({ id: 'kart-1', x: ana2.x, y: ana2.y, riderUserId: 'ana' }),
    ])
  })

  it('não monta sem kart ao alcance', () => {
    hub = new OfficeHub()
    hub.configure(runtimeWithKarts([{ id: 'kart-longe', x: 8, y: 8 }]))
    const a = fakeSocket()
    hub.join(a.socket, ana)

    a.sent.length = 0
    hub.rideKart(a.socket, 'ana')

    expect(a.sent.some((message) => message.type === 'kart-ride')).toBe(false)
    expect(hub.occupantOf('ana')?.ridingKartId).toBeUndefined()
  })

  it('um kart não pode ser ocupado por duas pessoas', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    hub.rideKart(a.socket, 'ana')
    b.sent.length = 0

    hub.rideKart(b.socket, 'bruno')

    expect(b.sent.some((message) => message.type === 'kart-ride')).toBe(false)
    expect(hub.occupantOf('bruno')?.ridingKartId).toBeUndefined()
  })

  it('permite publicar e usar vários karts ao mesmo tempo', () => {
    hub = new OfficeHub()
    hub.configure(runtimeWithKarts([
      { id: 'kart-a', x: 2, y: 1 },
      { id: 'kart-b', x: 1, y: 2 },
    ]))
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    // Cada um ao lado do SEU kart. Posicionar explicitamente porque o spawn é
    // do servidor e pode pôr os dois perto do mesmo veículo — o que o teste
    // afirma é que dois karts servem duas pessoas, não onde as pessoas nascem.
    hub.__placeAtTileForTest('ana', 2, 1)
    hub.__placeAtTileForTest('bruno', 1, 2)

    hub.rideKart(a.socket, 'ana')
    hub.rideKart(b.socket, 'bruno')

    // Qual dos dois cada um pega depende de onde estão (a escolha é pelo mais
    // PRÓXIMO); o que importa é que os dois montam, em karts diferentes.
    const deAna = hub.occupantOf('ana')?.ridingKartId
    const deBruno = hub.occupantOf('bruno')?.ridingKartId
    expect(deAna).toBeDefined()
    expect(deBruno).toBeDefined()
    expect(deAna).not.toBe(deBruno)
    expect(hub.karts().map((kart) => kart.riderUserId).sort()).toEqual(['ana', 'bruno'])
  })

  it('desmonta o piloto se o kart for removido numa publicação do editor', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.rideKart(a.socket, 'ana')
    a.sent.length = 0

    const updated = runtimeWithKarts([])
    updated.publication.id = 'pub-kart-2'
    hub.configure(updated, false, true)
    hub.broadcastMapDecorUpdated(updated.publication.id)

    expect(hub.occupantOf('ana')?.ridingKartId).toBeUndefined()
    expect(a.sent).toContainEqual({
      type: 'kart-ride',
      userId: 'ana',
      active: false,
      kart: { id: 'kart-1', ...tileCenter({ x: 1, y: 1 }), dir: 'down' },
    })
    expect(a.sent).toContainEqual({ type: 'karts-updated', karts: [] })
  })

  it('de kart, o passo é o MESMO da corrida: acelera, ganha inércia e esterça', () => {
    // Antes o kart era só "andar mais rápido" (`STEP_MS / 3`). Depois do
    // movimento livre ele passou a ser a pilotagem da arena — e sem isso montar
    // não fazia diferença nenhuma, porque o tick tratava todo mundo como
    // pedestre.
    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.__placeAtTileForTest('ana', 1, 1)
    hub.rideKart(a.socket, 'ana')
    expect(hub.occupantOf('ana')?.ridingKartId).toBeDefined()

    // Acelerador a fundo.
    for (let seq = 1; seq <= 30; seq += 1) {
      hub.applyInput(a.socket, 'ana', { seq, dx: 0, dy: -1, dtMs: 33 })
      hub.__tickForTest(33)
    }
    const acelerado = hub.__speedForTest('ana')
    expect(acelerado).toBeGreaterThan(BODY_SPEED)

    // Solta: a velocidade CAI, mas não zera no ato — é isso que é inércia, e é
    // o que separa dirigir de andar.
    hub.applyInput(a.socket, 'ana', { seq: 100, dx: 0, dy: 0, dtMs: 33 })
    hub.__tickForTest(33)
    const soltou = hub.__speedForTest('ana')
    expect(soltou).toBeLessThan(acelerado)
    expect(soltou).toBeGreaterThan(0)
  })

  it('kart parado não gira no lugar — o esterço só morde andando', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.__placeAtTileForTest('ana', 1, 1)
    hub.rideKart(a.socket, 'ana')
    const rumo = hub.occupantOf('ana')?.heading

    for (let seq = 1; seq <= 20; seq += 1) {
      hub.applyInput(a.socket, 'ana', { seq, dx: 1, dy: 0, dtMs: 33 })
      hub.__tickForTest(33)
    }

    expect(hub.occupantOf('ana')?.heading).toBe(rumo)
  })

  it('desmontar devolve o corpo ao passo de pedestre', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.__placeAtTileForTest('ana', 1, 1)
    hub.rideKart(a.socket, 'ana')
    for (let seq = 1; seq <= 20; seq += 1) {
      hub.applyInput(a.socket, 'ana', { seq, dx: 0, dy: -1, dtMs: 33 })
      hub.__tickForTest(33)
    }
    hub.rideKart(a.socket, 'ana') // estaciona

    // Sem zerar, o corpo herdaria a velocidade do veículo e sairia deslizando a
    // pé — e o rumo velho faria o kart seguinte nascer apontado para o lado.
    expect(hub.__speedForTest('ana')).toBe(0)
    expect(hub.occupantOf('ana')?.heading).toBeUndefined()
  })

  it('desmontar não prende o piloto em cima do kart', () => {
    // O kart estaciona EXATAMENTE onde o piloto estava, e ele é um bloqueio: as
    // duas caixas se sobrepõem. Sem tratar isso, todo passo depois de descer é
    // recusado e a pessoa fica presa em cima do próprio veículo, sem nada na
    // tela explicando por quê.
    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.__placeAtTileForTest('ana', 1, 1)
    hub.rideKart(a.socket, 'ana')
    drive(hub, a.socket, 'ana', 20)
    hub.rideKart(a.socket, 'ana') // estaciona embaixo de si

    const preso = hub.occupantOf('ana')!
    for (let i = 0; i < 6; i += 1) hub.__walkForTest(a.socket, 'ana', 'right')

    expect(hub.occupantOf('ana')!.x).toBeGreaterThan(preso.x)
  })

  it('kart estacionado bloqueia o caminho', () => {
    // O kart não está na grade de colisão: ela é rasterizada do documento
    // publicado e memoizada, e um kart que alguém acabou de estacionar não
    // entra nela. Quem o trata é `stepBodyAmongBlockers`, com a caixa dele.
    const a = fakeSocket()
    hub.join(a.socket, ana)
    const antes = hub.occupantOf('ana')!

    // O kart da fixture está no tile à direita de Ana.
    for (let i = 0; i < 3; i += 1) hub.__walkForTest(a.socket, 'ana', 'right')

    const depois = hub.occupantOf('ana')!
    expect(tileOf(depois)).toEqual(tileOf(antes))
    expect(depois.dir).toBe('right')
  })

  it('estaciona o kart ao sair do escritório de vez', () => {
    vi.useFakeTimers()
    try {
      const a = fakeSocket()
      const b = fakeSocket()
      hub.join(a.socket, ana)
      hub.join(b.socket, bruno)
      hub.rideKart(a.socket, 'ana')
      drive(hub, a.socket, 'ana', 20)
      const parouEm = hub.occupantOf('ana')!
      b.sent.length = 0
      hub.leave(a.socket, 'ana')
      vi.advanceTimersByTime(RECONNECT_GRACE_MS + 1000)

      // Estaciona ONDE O PILOTO ESTAVA — não devolve o veículo ao tile do editor.
      expect(b.sent).toContainEqual({
        type: 'kart-ride',
        userId: 'ana',
        active: false,
        kart: { id: 'kart-1', x: parouEm.x, y: parouEm.y, dir: parouEm.dir },
      })
      expect(hub.karts()).toEqual([{ id: 'kart-1', x: parouEm.x, y: parouEm.y, dir: parouEm.dir }])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('confetti', () => {
  /** Cria N usuários já dentro do escritório, com socket próprio. */
  function joinConfettiUsers(count: number): Array<{ socket: OfficeSocket; sent: OfficeServerMessage[]; id: string }> {
    const users: Array<{ socket: OfficeSocket; sent: OfficeServerMessage[]; id: string }> = []
    for (let i = 0; i < count; i += 1) {
      const id = `conf-${i}`
      const { socket, sent } = fakeSocket()
      hub.join(socket, { id, name: id, photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null })
      users.push({ socket, sent, id })
    }
    return users
  }
  const celebrations = (sent: OfficeServerMessage[]) => sent.filter((m) => m.type === 'celebration').length

  it('faz broadcast de confetti (active true e false) para todos, inclusive o remetente', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)

    hub.confetti(a.socket, 'ana', true)
    expect(a.sent).toContainEqual({ type: 'confetti', userId: 'ana', active: true })
    expect(b.sent).toContainEqual({ type: 'confetti', userId: 'ana', active: true })

    hub.confetti(a.socket, 'ana', false)
    expect(a.sent).toContainEqual({ type: 'confetti', userId: 'ana', active: false })
    expect(b.sent).toContainEqual({ type: 'confetti', userId: 'ana', active: false })
  })

  it('ignora confetti de socket cujo dono não bate com o userId (anti-spoof)', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    // socket da ana tentando lançar confete EM NOME do bruno
    hub.confetti(a.socket, 'bruno', true)
    expect(a.sent.some((m) => m.type === 'confetti')).toBe(false)
    expect(b.sent.some((m) => m.type === 'confetti')).toBe(false)
  })

  it('dispara celebration só quando a contagem cruza de <5 para >=5', () => {
    const users = joinConfettiUsers(CELEBRATION_THRESHOLD)
    // os 4 primeiros: ainda abaixo do threshold, nada de celebration
    for (let i = 0; i < CELEBRATION_THRESHOLD - 1; i += 1) {
      hub.confetti(users[i].socket, users[i].id, true)
    }
    expect(celebrations(users[0].sent)).toBe(0)
    // o 5º cruza o threshold
    hub.confetti(users[CELEBRATION_THRESHOLD - 1].socket, users[CELEBRATION_THRESHOLD - 1].id, true)
    expect(celebrations(users[0].sent)).toBe(1)
  })

  it('respeita o cooldown de 4s antes de comemorar de novo (oscilar 4↔5)', () => {
    vi.useFakeTimers()
    try {
      const users = joinConfettiUsers(CELEBRATION_THRESHOLD)
      for (const u of users) hub.confetti(u.socket, u.id, true) // sobe a 5 → celebration #1
      expect(celebrations(users[0].sent)).toBe(1)

      const last = users[CELEBRATION_THRESHOLD - 1]
      last && hub.confetti(last.socket, last.id, false) // cai pra 4
      last && hub.confetti(last.socket, last.id, true) // volta pra 5 dentro do cooldown
      expect(celebrations(users[0].sent)).toBe(1) // sem 2ª comemoração

      vi.advanceTimersByTime(CELEBRATION_COOLDOWN_MS + 10)
      last && hub.confetti(last.socket, last.id, false)
      last && hub.confetti(last.socket, last.id, true) // cruza de novo, agora fora do cooldown
      expect(celebrations(users[0].sent)).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('leave() limpa o confettiActive — quem sai não conta mais para o threshold', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.confetti(a.socket, 'ana', true) // ana entra na contagem
    hub.leave(a.socket, 'ana') // e deve sair dela ao desconectar

    const users = joinConfettiUsers(CELEBRATION_THRESHOLD)
    // Se a ana tivesse virado fantasma na contagem, o 4º já cruzaria o threshold.
    for (let i = 0; i < CELEBRATION_THRESHOLD - 1; i += 1) {
      hub.confetti(users[i].socket, users[i].id, true)
    }
    expect(celebrations(users[0].sent)).toBe(0)
    hub.confetti(users[CELEBRATION_THRESHOLD - 1].socket, users[CELEBRATION_THRESHOLD - 1].id, true)
    expect(celebrations(users[0].sent)).toBe(1)
  })

  it('welcome inclui confettiUserIds — quem entra vê o confete já em andamento', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.confetti(a.socket, 'ana', true)

    const b = fakeSocket()
    hub.join(b.socket, bruno)
    const welcome = b.sent.find((m) => m.type === 'welcome') as Extract<OfficeServerMessage, { type: 'welcome' }>
    expect(welcome.confettiUserIds).toEqual(['ana'])
  })

  it('não rebroadcasta quando active não muda o estado (sem republicar reenvio/duplicata)', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)

    hub.confetti(a.socket, 'ana', true)
    b.sent.length = 0
    hub.confetti(a.socket, 'ana', true) // reenvio: já estava true
    expect(b.sent.some((m) => m.type === 'confetti')).toBe(false)

    hub.confetti(a.socket, 'ana', false)
    b.sent.length = 0
    hub.confetti(a.socket, 'ana', false) // reenvio: já estava false
    expect(b.sent.some((m) => m.type === 'confetti')).toBe(false)
  })

  it('aba que caiu segurando F some do confettiActive mesmo com outra aba do mesmo usuário ainda aberta', () => {
    const a1 = fakeSocket() // primeira aba da ana
    const a2 = fakeSocket() // segunda aba da ana, continua conectada
    hub.join(a1.socket, ana)
    hub.join(a2.socket, ana)
    hub.confetti(a1.socket, 'ana', true) // confete veio da aba 1

    hub.leave(a1.socket, 'ana') // aba 1 cai sem mandar active:false

    const users = joinConfettiUsers(CELEBRATION_THRESHOLD)
    // Se a ana tivesse ficado fantasma em confettiActive, o 4º já cruzaria o threshold.
    for (let i = 0; i < CELEBRATION_THRESHOLD - 1; i += 1) {
      hub.confetti(users[i].socket, users[i].id, true)
    }
    expect(celebrations(users[0].sent)).toBe(0)
    hub.confetti(users[CELEBRATION_THRESHOLD - 1].socket, users[CELEBRATION_THRESHOLD - 1].id, true)
    expect(celebrations(users[0].sent)).toBe(1)
  })

  it('não limpa o confete se a aba que cai NÃO é a que estava segurando F', () => {
    const a1 = fakeSocket()
    const a2 = fakeSocket()
    hub.join(a1.socket, ana)
    hub.join(a2.socket, ana)
    hub.confetti(a1.socket, 'ana', true) // confete veio da aba 1

    hub.leave(a2.socket, 'ana') // cai a aba 2, que nunca segurou F

    const users = joinConfettiUsers(CELEBRATION_THRESHOLD - 1)
    for (const u of users) hub.confetti(u.socket, u.id, true)
    // ana (fora deste loop) + os N-1 acima fecham o threshold.
    expect(celebrations(users[0].sent)).toBe(1)
  })

  it('configure() com troca de publicação zera o cooldown de comemoração junto com confettiActive', () => {
    vi.useFakeTimers()
    try {
      const users = joinConfettiUsers(CELEBRATION_THRESHOLD)
      for (const u of users) hub.confetti(u.socket, u.id, true) // celebration #1
      expect(celebrations(users[0].sent)).toBe(1)

      const runtime = legacyOfficeRuntimeFixture()
      hub.configure({ ...runtime, publication: { ...runtime.publication, id: 'outra-publicacao' } })

      const c = fakeSocket()
      hub.join(c.socket, { id: 'c0', name: 'c0', photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null })
      const newUsers = joinConfettiUsers(CELEBRATION_THRESHOLD - 1)
      for (const u of [...newUsers, { socket: c.socket, sent: c.sent, id: 'c0' }]) hub.confetti(u.socket, u.id, true)
      // Sem o fix, o lastCelebrationAt antigo (ainda dentro do cooldown de 4s) suprimiria esta.
      expect(celebrations(c.sent)).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('setEditing', () => {
  const editorsChanged = (sent: OfficeServerMessage[]) => sent.filter((m) => m.type === 'editors-changed')
  const lastEditorsChanged = (sent: OfficeServerMessage[]) =>
    editorsChanged(sent).at(-1) as Extract<OfficeServerMessage, { type: 'editors-changed' }> | undefined

  it('broadcasta editors-changed ao entrar/sair de edição', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)

    hub.setEditing(a.socket, 'ana', true)
    expect(lastEditorsChanged(b.sent)?.userIds).toEqual(['ana'])

    hub.setEditing(a.socket, 'ana', false)
    expect(lastEditorsChanged(b.sent)?.userIds).toEqual([])
  })

  it('ignora setEditing de socket cujo dono não bate com o userId (anti-spoof)', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)

    hub.setEditing(a.socket, 'bruno', true)

    expect(editorsChanged(a.sent)).toHaveLength(0)
    expect(editorsChanged(b.sent)).toHaveLength(0)
  })

  it('não rebroadcasta quando o estado não muda (reenvio/duplicata)', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)

    hub.setEditing(a.socket, 'ana', true)
    b.sent.length = 0
    hub.setEditing(a.socket, 'ana', true) // reenvio: já estava true
    expect(editorsChanged(b.sent)).toHaveLength(0)

    hub.setEditing(a.socket, 'ana', false)
    b.sent.length = 0
    hub.setEditing(a.socket, 'ana', false) // reenvio: já estava false
    expect(editorsChanged(b.sent)).toHaveLength(0)
  })

  it('remove o usuário de editingActive ao desconectar', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.setEditing(a.socket, 'ana', true)

    hub.leave(a.socket, 'ana')

    const a2 = fakeSocket()
    hub.join(a2.socket, ana)
    const welcome = a2.sent.find((m) => m.type === 'welcome') as Extract<OfficeServerMessage, { type: 'welcome' }>
    expect(welcome.editorUserIds ?? []).toEqual([])
  })

  it('aba que caiu editando some do editingActive mesmo com outra aba do mesmo usuário ainda aberta', () => {
    const a1 = fakeSocket()
    const a2 = fakeSocket()
    const b = fakeSocket()
    hub.join(a1.socket, ana)
    hub.join(a2.socket, ana)
    hub.join(b.socket, bruno)
    hub.setEditing(a1.socket, 'ana', true) // edição veio da aba 1

    hub.leave(a1.socket, 'ana') // aba 1 cai sem mandar editing:false

    expect(lastEditorsChanged(b.sent)?.userIds).toEqual([])
  })

  it('inclui editores atuais no welcome de quem entra', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.setEditing(a.socket, 'ana', true)

    const c = fakeSocket()
    hub.join(c.socket, carol)

    const welcome = c.sent.find((m) => m.type === 'welcome') as Extract<OfficeServerMessage, { type: 'welcome' }>
    expect(welcome.editorUserIds).toEqual(['ana'])
  })

  it('configure() com troca de publicação zera o editingActive', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.setEditing(a.socket, 'ana', true)

    const runtime = legacyOfficeRuntimeFixture()
    hub.configure({ ...runtime, publication: { ...runtime.publication, id: 'outra-publicacao' } })

    const b = fakeSocket()
    hub.join(b.socket, bruno)
    const welcome = b.sent.find((m) => m.type === 'welcome') as Extract<OfficeServerMessage, { type: 'welcome' }>
    expect(welcome.editorUserIds ?? []).toEqual([])
  })
})

describe('roomPresence', () => {
  const presence = (sent: OfficeServerMessage[], kind: 'enter' | 'leave', userId: string) =>
    sent.filter((m) => m.type === 'room-presence' && m.kind === kind && m.userId === userId)

  it('entrar numa sala avisa o próprio e quem já estava lá', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)

    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)

    // bruno (quem entrou) e ana (já dentro) recebem o enter do bruno
    expect(presence(b.sent, 'enter', 'bruno')).toContainEqual(
      expect.objectContaining({ type: 'room-presence', kind: 'enter', userId: 'bruno', roomId: ROOM1_ID }),
    )
    expect(presence(a.sent, 'enter', 'bruno')).toHaveLength(1)
  })

  it('não vaza o enter para quem está fora da sala', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno) // ana fica fora da sala

    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)

    expect(presence(a.sent, 'enter', 'bruno')).toHaveLength(0)
  })

  it('sair andando avisa o próprio e quem ficou na sala', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)

    walkTo(hub, a.socket, 'ana', ROOM1_OUTSIDE)

    expect(presence(a.sent, 'leave', 'ana')).toHaveLength(1)
    expect(presence(b.sent, 'leave', 'ana')).toContainEqual(
      expect.objectContaining({ type: 'room-presence', kind: 'leave', userId: 'ana', roomId: ROOM1_ID }),
    )
  })

  it('desconectar dentro da sala avisa quem ficou, depois que o período de graça expira sem reconexão', () => {
    vi.useFakeTimers()
    try {
      const a = fakeSocket()
      const b = fakeSocket()
      hub.join(a.socket, ana)
      hub.join(b.socket, bruno)
      walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
      walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)

      hub.leave(a.socket, 'ana')
      vi.advanceTimersByTime(RECONNECT_GRACE_MS + 10)

      expect(presence(b.sent, 'leave', 'ana')).toContainEqual(
        expect.objectContaining({ type: 'room-presence', kind: 'leave', userId: 'ana', roomId: ROOM1_ID }),
      )
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('status automático na sala de silêncio', () => {
  const ZONE_TILE = { x: 5, y: 1 } // corredor aberto, longe das salas de reunião
  const OUTSIDE_TILE = { x: 6, y: 1 }

  function configureWithPrivateZone(): void {
    const runtime = legacyOfficeRuntimeFixture()
    runtime.document.objects.push({
      id: 'private-zona-1',
      layerKey: 'private-zones',
      type: 'private-zone',
      geometry: { kind: 'rectangle', x: ZONE_TILE.x * 32, y: ZONE_TILE.y * 32, width: 32, height: 32 },
      properties: { name: 'Zona privada de teste', externalKey: 'zona-1', accessPolicy: 'OPEN' },
    })
    hub.configure(runtime)
  }

  it('entrar na zona privada muda o status para away e avisa todo mundo', () => {
    configureWithPrivateZone()
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)

    walkTo(hub, a.socket, 'ana', ZONE_TILE)

    expect(hub.occupants().find((o) => o.userId === 'ana')?.status).toBe('away')
    const expected = { type: 'status-changed', userId: 'ana', status: 'away' }
    expect(a.sent).toContainEqual(expected)
    expect(b.sent).toContainEqual(expected)
  })

  it('sair da zona privada reverte o status para online', () => {
    // Fake timers do início ao fim: o caminho até ZONE_TILE já consome o
    // burst inteiro do rate limit de movimento (`takeToken`). Sem repor o
    // bucket entre os dois `walkTo`, o passo de saída seria descartado em
    // silêncio e o teste falharia por um motivo alheio ao comportamento sob
    // teste (mesma armadilha documentada em `detecção do par`, mais abaixo
    // neste arquivo).
    vi.useFakeTimers()
    try {
      configureWithPrivateZone()
      const a = fakeSocket()
      hub.join(a.socket, ana)
      walkTo(hub, a.socket, 'ana', ZONE_TILE)
      expect(hub.occupants().find((o) => o.userId === 'ana')?.status).toBe('away')

      vi.advanceTimersByTime(2000)

      walkTo(hub, a.socket, 'ana', OUTSIDE_TILE)

      expect(hub.occupants().find((o) => o.userId === 'ana')?.status).toBe('online')
      expect(a.sent).toContainEqual({ type: 'status-changed', userId: 'ana', status: 'online' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('andar já online fora de zona privada não emite status-changed', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    walkTo(hub, a.socket, 'ana', ROOM1_OUTSIDE)

    expect(hub.occupants().find((o) => o.userId === 'ana')?.status).toBe('online')
    expect(a.sent.some((m) => m.type === 'status-changed')).toBe(false)
  })
})

describe('sinal de atividade volta o status pra online', () => {
  it.each(['away', 'brb'] as const)('andar fora de zona privada zera "%s" pra online', (status) => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    hub.setStatus(a.socket, 'ana', status)

    walkTo(hub, a.socket, 'ana', ROOM1_OUTSIDE)

    expect(hub.occupants().find((o) => o.userId === 'ana')?.status).toBe('online')
    const expected = { type: 'status-changed', userId: 'ana', status: 'online' }
    expect(a.sent).toContainEqual(expected)
    expect(b.sent).toContainEqual(expected)
  })

  it('falar (balão de proximidade) zera o status pra online', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.setStatus(a.socket, 'ana', 'away')

    hub.nearbyMessage(a.socket, 'ana', 'voltei')

    expect(hub.occupants().find((o) => o.userId === 'ana')?.status).toBe('online')
  })

  it('mensagem em branco não conta como sinal de atividade', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.setStatus(a.socket, 'ana', 'away')

    hub.nearbyMessage(a.socket, 'ana', '   ')

    expect(hub.occupants().find((o) => o.userId === 'ana')?.status).toBe('away')
  })

  it('corta a mensagem por code point, na mesma régua do cliente', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    b.sent.length = 0

    // O cliente deixa passar 80 code points; cortar por unidade UTF-16 partiria
    // emoji no meio e entregaria menos do que ele mostrou no contador.
    const emojis = '👋'.repeat(OFFICE_NEARBY_MESSAGE_MAX_LENGTH)
    hub.nearbyMessage(a.socket, 'ana', emojis)

    const msg = b.sent.find((m) => m.type === 'nearby-message')
    expect(msg).toMatchObject({ type: 'nearby-message', text: emojis })
  })

  it('corta mensagem acima do limite mantendo os code points inteiros', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    b.sent.length = 0

    hub.nearbyMessage(a.socket, 'ana', 'a'.repeat(OFFICE_NEARBY_MESSAGE_MAX_LENGTH + 20))

    const msg = b.sent.find((m) => m.type === 'nearby-message')
    expect(msg).toMatchObject({ text: 'a'.repeat(OFFICE_NEARBY_MESSAGE_MAX_LENGTH) })
  })

  it('ligar pra alguém zera o status de QUEM LIGA', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    hub.setStatus(a.socket, 'ana', 'away')

    hub.call(a.socket, 'ana', 'bruno')

    expect(hub.occupants().find((o) => o.userId === 'ana')?.status).toBe('online')
    expect(b.sent.some((m) => m.type === 'incoming-call')).toBe(true)
  })

  it('chamada recusada por status do alvo não zera o status de ninguém', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    hub.setStatus(b.socket, 'bruno', 'away')

    hub.call(a.socket, 'ana', 'bruno')

    expect(hub.occupants().find((o) => o.userId === 'bruno')?.status).toBe('away')
    expect(a.sent).toContainEqual({ type: 'call-failed', targetUserId: 'bruno', reason: 'away' })
  })
})

describe('raiseHand', () => {
  const raisedHands = (sent: OfficeServerMessage[]) => sent.filter((m) => m.type === 'raised-hands')
  const lastRaisedHands = (sent: OfficeServerMessage[]) =>
    raisedHands(sent).at(-1) as Extract<OfficeServerMessage, { type: 'raised-hands' }> | undefined
  const handRaised = (sent: OfficeServerMessage[]) => sent.filter((m) => m.type === 'hand-raised')

  it('levantar dentro da sala inclui na fila (contador/lista) e também dispara o sinal global (ícone)', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)

    hub.raiseHand(a.socket, 'ana', true)

    const expected = expect.objectContaining({
      type: 'raised-hands',
      roomId: ROOM1_ID,
      queue: ['ana'],
      event: { kind: 'raised', userId: 'ana' },
    })
    expect(raisedHands(a.sent)).toContainEqual(expected)
    expect(raisedHands(b.sent)).toContainEqual(expected)
    // Sinal global (ícone sobre o personagem) chega pra todo mundo, não só pra sala.
    expect(handRaised(a.sent)).toContainEqual({ type: 'hand-raised', userId: 'ana', active: true })
    expect(handRaised(b.sent)).toContainEqual({ type: 'hand-raised', userId: 'ana', active: true })
  })

  it('levantar fora de sala de reunião e de zona privada é totalmente no-op', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana) // spawn fora de sala/zona

    hub.raiseHand(a.socket, 'ana', true)

    expect(raisedHands(a.sent)).toHaveLength(0)
    expect(handRaised(a.sent)).toHaveLength(0)
  })

  it('levantar dentro de uma zona privada ("espaço de conversa") também forma fila e liga o sinal global', () => {
    const runtime = legacyOfficeRuntimeFixture()
    const ZONE_TILE = { x: 5, y: 1 } // corredor aberto, longe das salas de reunião
    runtime.document.objects.push({
      id: 'private-zona-1',
      layerKey: 'private-zones',
      type: 'private-zone',
      geometry: { kind: 'rectangle', x: ZONE_TILE.x * 32, y: ZONE_TILE.y * 32, width: 32, height: 32 },
      properties: { name: 'Zona privada de teste', externalKey: 'zona-1', accessPolicy: 'OPEN' },
    })
    hub.configure(runtime)

    const a = fakeSocket()
    hub.join(a.socket, ana)
    walkTo(hub, a.socket, 'ana', ZONE_TILE)

    hub.raiseHand(a.socket, 'ana', true)

    expect(raisedHands(a.sent)).toContainEqual(
      expect.objectContaining({
        type: 'raised-hands',
        roomId: 'zona-1',
        queue: ['ana'],
        event: { kind: 'raised', userId: 'ana' },
      }),
    )
    expect(handRaised(a.sent)).toContainEqual({ type: 'hand-raised', userId: 'ana', active: true })
  })

  it('levantar duas vezes seguidas é no-op (já está na fila)', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)

    hub.raiseHand(a.socket, 'ana', true)
    hub.raiseHand(a.socket, 'ana', true)

    expect(raisedHands(a.sent)).toHaveLength(1)
  })

  it('fila é FIFO — segunda pessoa entra no fim', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)

    hub.raiseHand(a.socket, 'ana', true)
    hub.raiseHand(b.socket, 'bruno', true)

    expect(lastRaisedHands(b.sent)?.queue).toEqual(['ana', 'bruno'])
  })

  it('abaixar manualmente remove da fila e mantém a ordem dos demais', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)
    hub.raiseHand(a.socket, 'ana', true)
    hub.raiseHand(b.socket, 'bruno', true)

    hub.raiseHand(a.socket, 'ana', false)

    expect(lastRaisedHands(b.sent)).toEqual(
      expect.objectContaining({
        type: 'raised-hands',
        roomId: ROOM1_ID,
        queue: ['bruno'],
        event: { kind: 'lowered', userId: 'ana' },
      }),
    )
  })

  it('abaixar sem estar na fila é no-op', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)

    hub.raiseHand(a.socket, 'ana', false)

    expect(raisedHands(a.sent)).toHaveLength(0)
  })

  it('sair andando da sala abaixa a mão por completo — fila E sinal global —, avisando o próprio e quem ficou', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)
    hub.raiseHand(a.socket, 'ana', true)
    a.sent.length = 0
    b.sent.length = 0

    walkTo(hub, a.socket, 'ana', ROOM1_OUTSIDE)

    const expected = expect.objectContaining({
      type: 'raised-hands',
      roomId: ROOM1_ID,
      queue: [],
      event: { kind: 'lowered', userId: 'ana' },
    })
    expect(raisedHands(a.sent)).toContainEqual(expected)
    expect(raisedHands(b.sent)).toContainEqual(expected)
    // A mão não existe fora de sala/zona: sair andando abaixa o ícone junto.
    expect(handRaised(a.sent)).toContainEqual({ type: 'hand-raised', userId: 'ana', active: false })
    expect(handRaised(b.sent)).toContainEqual({ type: 'hand-raised', userId: 'ana', active: false })
  })

  it('desconectar com a mão levantada limpa a fila da sala depois que o período de graça expira sem reconexão', () => {
    vi.useFakeTimers()
    try {
      const a = fakeSocket()
      const b = fakeSocket()
      hub.join(a.socket, ana)
      hub.join(b.socket, bruno)
      walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
      walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)
      hub.raiseHand(a.socket, 'ana', true)

      hub.leave(a.socket, 'ana')
      vi.advanceTimersByTime(RECONNECT_GRACE_MS + 10)

      expect(raisedHands(b.sent)).toContainEqual(
        expect.objectContaining({
          type: 'raised-hands',
          roomId: ROOM1_ID,
          queue: [],
          event: { kind: 'lowered', userId: 'ana' },
        }),
      )
      // O ícone global (dono da mão caiu) esse sim já era síncrono — some
      // na hora, antes até do período de graça, junto do resto do confete.
      expect(handRaised(b.sent)).toContainEqual({ type: 'hand-raised', userId: 'ana', active: false })
    } finally {
      vi.useRealTimers()
    }
  })

  it('desconectar sem estar com a mão levantada não manda hand-raised nenhum', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)

    hub.leave(a.socket, 'ana')

    expect(handRaised(b.sent)).toHaveLength(0)
  })

  it('aba que caiu segurando a mão some do sinal global mesmo com outra aba do mesmo usuário ainda aberta', () => {
    const a1 = fakeSocket() // primeira aba da ana
    const a2 = fakeSocket() // segunda aba, continua conectada
    const b = fakeSocket()
    hub.join(a1.socket, ana)
    hub.join(a2.socket, ana)
    hub.join(b.socket, bruno)
    walkTo(hub, a1.socket, 'ana', ROOM1_INSIDE)
    hub.raiseHand(a1.socket, 'ana', true) // mão veio da aba 1

    hub.leave(a1.socket, 'ana') // aba 1 cai sem mandar active:false

    expect(handRaised(b.sent)).toContainEqual({ type: 'hand-raised', userId: 'ana', active: false })
  })

  it('entrar numa sala com fila em andamento entrega snapshot sem event (não deve tocar som)', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
    hub.raiseHand(a.socket, 'ana', true)

    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)

    expect(raisedHands(b.sent)).toContainEqual({ type: 'raised-hands', roomId: ROOM1_ID, queue: ['ana'] })
  })

  it('ignora raiseHand de socket cujo dono não bate com o userId (anti-spoof)', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)

    hub.raiseHand(a.socket, 'bruno', true)

    expect(raisedHands(b.sent)).toHaveLength(0)
    expect(handRaised(b.sent)).toHaveLength(0)
  })

  it('reenviar o mesmo active é no-op — não republica o sinal global', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)

    hub.raiseHand(a.socket, 'ana', true)
    hub.raiseHand(a.socket, 'ana', true) // reenvio: já estava true
    expect(handRaised(a.sent)).toHaveLength(1)

    hub.raiseHand(a.socket, 'ana', false)
    hub.raiseHand(a.socket, 'ana', false) // reenvio: já estava false
    expect(handRaised(a.sent)).toHaveLength(2) // só o true e o false de verdade
  })

  it('welcome inclui handRaisedUserIds — quem entra vê o ícone de quem já está com a mão levantada', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
    hub.raiseHand(a.socket, 'ana', true)

    const b = fakeSocket()
    hub.join(b.socket, bruno)

    const welcome = b.sent.find((m) => m.type === 'welcome') as Extract<OfficeServerMessage, { type: 'welcome' }>
    expect(welcome.handRaisedUserIds).toEqual(['ana'])
  })

  it('configure() com troca de publicação zera a fila de mãos levantadas e o sinal global', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
    hub.raiseHand(a.socket, 'ana', true)

    const runtime = legacyOfficeRuntimeFixture()
    hub.configure({ ...runtime, publication: { ...runtime.publication, id: 'outra-publicacao' } })

    const b = fakeSocket()
    hub.join(b.socket, bruno)
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)
    hub.raiseHand(b.socket, 'bruno', true)

    // Se a fila antiga não tivesse zerado, a nova incluiria 'ana' também.
    expect(lastRaisedHands(b.sent)?.queue).toEqual(['bruno'])

    // Se o sinal global antigo não tivesse zerado, o welcome de um 3º ainda traria 'ana'.
    const c = fakeSocket()
    hub.join(c.socket, { id: 'carla2', name: 'Carla', photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null })
    const welcome = c.sent.find((m) => m.type === 'welcome') as Extract<OfficeServerMessage, { type: 'welcome' }>
    expect(welcome.handRaisedUserIds).toEqual(['bruno'])
  })
})

describe('pensamento', () => {
  it('andar apaga o pensamento e AVISA todo mundo — o snapshot só carrega posição', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    const b = fakeSocket()
    hub.join(b.socket, bruno)

    hub.nearbyMessage(a.socket, 'ana', 'pensando', 'thought')
    expect(hub.occupantOf('ana')?.thoughtText).toBe('pensando')

    hub.__walkForTest(a.socket, 'ana', 'left')

    expect(hub.occupantOf('ana')?.thoughtText).toBeUndefined()
    for (const sent of [a.sent, b.sent]) {
      expect(sent.filter((m) => m.type === 'thought-cleared' && m.userId === 'ana')).toHaveLength(1)
    }
  })

  it('quem anda sem pensamento nenhum não gera aviso — seria um por tick', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)

    hub.__walkForTest(a.socket, 'ana', 'left')

    expect(a.sent.some((m) => m.type === 'thought-cleared')).toBe(false)
  })
})

describe('high-five', () => {
  it('registra a última reação com o emoji enviado', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.nearbyMessage(a.socket, 'ana', '👋', 'reaction')
    expect(hub.reactionAt('ana')?.emoji).toBe('👋')
  })

  it('não registra fala nem pensamento como reação', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.nearbyMessage(a.socket, 'ana', 'oi', 'speech')
    expect(hub.reactionAt('ana')).toBeNull()
  })

  it('reação sobrevive a uma reconexão dentro do período de graça — não foi embora de verdade', () => {
    vi.useFakeTimers()
    try {
      const a = fakeSocket()
      hub.join(a.socket, ana)
      hub.nearbyMessage(a.socket, 'ana', '👋', 'reaction')
      hub.leave(a.socket, 'ana')
      vi.advanceTimersByTime(RECONNECT_GRACE_MS - 1000)

      const b = fakeSocket()
      hub.join(b.socket, ana)
      expect(hub.reactionAt('ana')?.emoji).toBe('👋')
    } finally {
      vi.useRealTimers()
    }
  })

  it('esquece a reação quando o período de graça expira de verdade (saída completa)', () => {
    vi.useFakeTimers()
    try {
      const a = fakeSocket()
      hub.join(a.socket, ana)
      hub.nearbyMessage(a.socket, 'ana', '👋', 'reaction')
      hub.leave(a.socket, 'ana')
      vi.advanceTimersByTime(RECONNECT_GRACE_MS + 1000)

      const b = fakeSocket()
      hub.join(b.socket, ana)
      expect(hub.reactionAt('ana')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  describe('detecção do par', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    /** Põe dois usuários adjacentes e virados um pro outro. Devolve os sockets. */
    function facePair() {
      const a = fakeSocket()
      const b = fakeSocket()
      hub.join(a.socket, ana)
      hub.join(b.socket, bruno)

      // Em TILE: o high-five é vizinhança, não distância em pixel.
      const target = tileOf(hub.occupantOf('ana') as { x: number; y: number })
      // Leva bruno até o tile à direita de ana.
      walkTo(hub, b.socket, 'bruno', { x: target.x + 1, y: target.y })
      hub.face(a.socket, 'ana', 'right')
      hub.face(b.socket, 'bruno', 'left')

      // Pós-condição: `shortestPath` (BFS sobre `isWalkable` do shared) e
      // `hub.move` (isMapTileWalkable + canEnterRoom) são duas fontes de
      // andabilidade diferentes. Se divergirem, bruno pararia no tile errado
      // em silêncio e os testes negativos abaixo passariam vazios por
      // acidente — esta asserção também é rede pro rate limit (`takeToken`),
      // cujo modo de falha hoje é silencioso.
      expect(tileOf(hub.occupantOf('bruno')!)).toEqual({ x: target.x + 1, y: target.y })
      expect(hub.occupantOf('bruno')).toMatchObject({ dir: 'left' })
      // Mesma rede pra ana: `face()` retorna void e desiste calado se
      // `takeToken` falhar, e o `dir` default do join() é 'down' — sem esta
      // asserção, um face() de ana que falhasse silenciosamente deixaria os
      // testes puramente negativos passando vazios por acidente.
      expect(tileOf(hub.occupantOf('ana')!)).toEqual(target)
      expect(hub.occupantOf('ana')).toMatchObject({ dir: 'right' })

      a.sent.length = 0
      b.sent.length = 0
      return { a, b }
    }

    const highFives = (sent: OfficeServerMessage[]) => sent.filter((m) => m.type === 'high-five')

    it('dispara quando os dois acenam de frente um pro outro', () => {
      const { a, b } = facePair()
      hub.nearbyMessage(a.socket, 'ana', '👋', 'reaction')
      hub.nearbyMessage(b.socket, 'bruno', '👋', 'reaction')

      expect(highFives(a.sent)).toHaveLength(1)
      expect(highFives(b.sent)).toHaveLength(1)
      expect((highFives(a.sent)[0] as { userIds: string[] }).userIds.sort()).toEqual(['ana', 'bruno'])
    })

    it('sorteia a palma perfeita e manda o MESMO resultado pros dois (#22252)', () => {
      const random = vi.spyOn(Math, 'random').mockReturnValue(PERFECT_HIGH_FIVE_CHANCE - 0.01)
      try {
        const { a, b } = facePair()
        hub.nearbyMessage(a.socket, 'ana', '👋', 'reaction')
        hub.nearbyMessage(b.socket, 'bruno', '👋', 'reaction')

        expect(highFives(a.sent)[0]).toMatchObject({ perfect: true })
        expect(highFives(b.sent)[0]).toMatchObject({ perfect: true })
      } finally {
        random.mockRestore()
      }
    })

    it('high-five comum quando o dado passa do limiar', () => {
      const random = vi.spyOn(Math, 'random').mockReturnValue(PERFECT_HIGH_FIVE_CHANCE)
      try {
        const { a, b } = facePair()
        hub.nearbyMessage(a.socket, 'ana', '👋', 'reaction')
        hub.nearbyMessage(b.socket, 'bruno', '👋', 'reaction')

        expect(highFives(a.sent)[0]).toMatchObject({ perfect: false })
      } finally {
        random.mockRestore()
      }
    })

    it('não dispara com só um acenando', () => {
      const { a, b } = facePair()
      hub.nearbyMessage(a.socket, 'ana', '👋', 'reaction')
      expect(highFives(a.sent)).toHaveLength(0)
      expect(highFives(b.sent)).toHaveLength(0)
    })

    it('não dispara com outro emoji', () => {
      const { a, b } = facePair()
      hub.nearbyMessage(a.socket, 'ana', '🔥', 'reaction')
      hub.nearbyMessage(b.socket, 'bruno', '🔥', 'reaction')
      expect(highFives(a.sent)).toHaveLength(0)
    })

    it('não dispara se estão de costas', () => {
      const { a, b } = facePair()
      hub.face(a.socket, 'ana', 'left')
      hub.nearbyMessage(a.socket, 'ana', '👋', 'reaction')
      hub.nearbyMessage(b.socket, 'bruno', '👋', 'reaction')
      expect(highFives(a.sent)).toHaveLength(0)
    })

    it('dispara ao VIRAR de frente para quem já está acenando', () => {
      const { a, b } = facePair()
      hub.face(a.socket, 'ana', 'up')
      hub.nearbyMessage(a.socket, 'ana', '👋', 'reaction')
      hub.nearbyMessage(b.socket, 'bruno', '👋', 'reaction')
      expect(highFives(a.sent)).toHaveLength(0)

      hub.face(a.socket, 'ana', 'right')
      expect(highFives(a.sent)).toHaveLength(1)
    })

    it('dispara quando o move() completa a avaliação (andar até quem já está acenando)', () => {
      const a = fakeSocket()
      const b = fakeSocket()
      hub.join(a.socket, ana)
      hub.join(b.socket, bruno)

      const start = tileOf(hub.occupantOf('ana')!)
      // Bruno vai para dois tiles à direita de ana — perto, mas ainda não adjacente.
      walkTo(hub, b.socket, 'bruno', { x: start.x + 2, y: start.y })
      hub.face(b.socket, 'bruno', 'left')
      // Pós-condição: garante que bruno realmente parou dois tiles à direita
      // de ana e virado pra ela — mesmo espírito da asserção em facePair(),
      // senão o move() de ana no fim do teste passaria vazio por acidente.
      expect(tileOf(hub.occupantOf('bruno')!)).toEqual({ x: start.x + 2, y: start.y })
      expect(hub.occupantOf('bruno')).toMatchObject({ dir: 'left' })

      hub.nearbyMessage(b.socket, 'bruno', '👋', 'reaction')
      hub.nearbyMessage(a.socket, 'ana', '👋', 'reaction')
      a.sent.length = 0
      b.sent.length = 0

      // Ana ANDA (não vira) até ficar adjacente e de frente pra bruno — quem
      // decide o encontro aqui é só o move(), sem face() nem reação nova.
      hub.__walkForTest(a.socket, 'ana', 'right')

      expect(highFives(a.sent)).toHaveLength(1)
    })

    it('re-avaliar com face() depois do high-five não redispara (sem aceno novo)', () => {
      const { a, b } = facePair()
      hub.nearbyMessage(a.socket, 'ana', '👋', 'reaction')
      hub.nearbyMessage(b.socket, 'bruno', '👋', 'reaction')
      expect(highFives(a.sent)).toHaveLength(1)

      hub.face(a.socket, 'ana', 'right')
      expect(highFives(a.sent)).toHaveLength(1)
    })

    it('respeita o cooldown do par', () => {
      const { a, b } = facePair()
      hub.nearbyMessage(a.socket, 'ana', '👋', 'reaction')
      hub.nearbyMessage(b.socket, 'bruno', '👋', 'reaction')
      expect(highFives(a.sent)).toHaveLength(1)

      // Novo aceno dos dois dentro do cooldown: nada.
      hub.nearbyMessage(a.socket, 'ana', '👋', 'reaction')
      hub.nearbyMessage(b.socket, 'bruno', '👋', 'reaction')
      expect(highFives(a.sent)).toHaveLength(1)

      vi.setSystemTime(Date.now() + HIGH_FIVE_COOLDOWN_MS + 1)
      hub.nearbyMessage(a.socket, 'ana', '👋', 'reaction')
      hub.nearbyMessage(b.socket, 'bruno', '👋', 'reaction')
      expect(highFives(a.sent)).toHaveLength(2)
    })

    it('depois de bater, exige aceno novo dos DOIS (reações consumidas)', () => {
      const { a, b } = facePair()
      hub.nearbyMessage(a.socket, 'ana', '👋', 'reaction')
      hub.nearbyMessage(b.socket, 'bruno', '👋', 'reaction')
      expect(highFives(a.sent)).toHaveLength(1)

      // Passado o cooldown, mas ainda DENTRO da janela de validade da reação:
      // se as reações não fossem consumidas no disparo, o aceno solto da ana
      // encontraria a reação antiga do bruno (ainda "ativa") e redispararia.
      vi.setSystemTime(Date.now() + HIGH_FIVE_COOLDOWN_MS + 100)
      expect(HIGH_FIVE_COOLDOWN_MS + 100).toBeLessThan(REACTION_ACTIVE_WINDOW_MS)

      hub.nearbyMessage(a.socket, 'ana', '👋', 'reaction')
      expect(highFives(a.sent)).toHaveLength(1)

      // Só quando o outro também acena de novo é que bate outra vez.
      hub.nearbyMessage(b.socket, 'bruno', '👋', 'reaction')
      expect(highFives(a.sent)).toHaveLength(2)
    })

    it('cooldown do par vale mesmo com a ordem de avaliação invertida (chave ordenada)', () => {
      const { a, b } = facePair()
      // Round 1: ana acena primeiro, bruno é quem completa o par (a avaliação
      // que detecta o match dispara a partir dele).
      hub.nearbyMessage(a.socket, 'ana', '👋', 'reaction')
      hub.nearbyMessage(b.socket, 'bruno', '👋', 'reaction')
      expect(highFives(a.sent)).toHaveLength(1)

      // Round 2, ainda dentro do cooldown, em ORDEM INVERTIDA: bruno acena
      // primeiro, ana é quem completa o par desta vez. Sem o `.sort()` na
      // chave (`[userId, otherId].sort().join('|')`), essa avaliação
      // gravaria/leria uma chave diferente da do round 1 ('bruno|ana' vs
      // 'ana|bruno') e o cooldown não pegaria — redisparando incorretamente.
      hub.nearbyMessage(b.socket, 'bruno', '👋', 'reaction')
      hub.nearbyMessage(a.socket, 'ana', '👋', 'reaction')
      expect(highFives(a.sent)).toHaveLength(1)
    })

    it('fileira de três: o do meio entra em UM par só, não em dois', () => {
      const a = fakeSocket()
      const b = fakeSocket()
      const c = fakeSocket()
      hub.join(a.socket, ana)
      hub.join(b.socket, bruno)
      hub.join(c.socket, carla)

      // Linha horizontal: ana | bruno | carla, nessa ordem.
      const base = tileOf(hub.occupantOf('ana')!)
      walkTo(hub, b.socket, 'bruno', { x: base.x + 1, y: base.y })
      walkTo(hub, c.socket, 'carla', { x: base.x + 2, y: base.y })
      // Ana e carla encaram o do meio; o do meio só pode encarar UM lado (ana).
      hub.face(a.socket, 'ana', 'right')
      hub.face(b.socket, 'bruno', 'left')
      hub.face(c.socket, 'carla', 'left')

      // Rede contra passar vazio: se alguém parou no tile errado ou um face()
      // morreu no rate limit, os asserts abaixo dariam 1 high-five por acidente.
      expect(tileOf(hub.occupantOf('ana')!)).toEqual({ x: base.x, y: base.y })
      expect(hub.occupantOf('ana')).toMatchObject({ dir: 'right' })
      expect(tileOf(hub.occupantOf('bruno')!)).toEqual({ x: base.x + 1, y: base.y })
      expect(hub.occupantOf('bruno')).toMatchObject({ dir: 'left' })
      expect(tileOf(hub.occupantOf('carla')!)).toEqual({ x: base.x + 2, y: base.y })
      expect(hub.occupantOf('carla')).toMatchObject({ dir: 'left' })

      a.sent.length = 0
      b.sent.length = 0
      c.sent.length = 0

      // Os três acenam. Carla por último de propósito: quando ela avalia, o par
      // ana↔bruno já fechou, e ela não pode arrastar bruno para um segundo.
      hub.nearbyMessage(a.socket, 'ana', '👋', 'reaction')
      hub.nearbyMessage(b.socket, 'bruno', '👋', 'reaction')
      hub.nearbyMessage(c.socket, 'carla', '👋', 'reaction')

      // Um único high-five no escritório inteiro (é broadcast: todos veem os mesmos).
      expect(highFives(a.sent)).toHaveLength(1)
      expect(highFives(b.sent)).toHaveLength(1)
      expect(highFives(c.sent)).toHaveLength(1)
      expect((highFives(a.sent)[0] as { userIds: string[] }).userIds.sort()).toEqual([
        'ana',
        'bruno',
      ])
    })

    it('dois empilhados no MESMO tile à minha frente fecham um par só (o `return` do loop)', () => {
      // `walkable()` só olha o tile do mapa — não há checagem de ocupação, então
      // duas pessoas PODEM se sobrepor. É o único jeito de a avaliação encontrar
      // dois candidatos válidos: `frontX/frontY` é um tile único, e sem o
      // `return` o loop seguiria e dispararia um segundo high-five com o mesmo
      // `userId` (ana entraria em dois pares na mesma avaliação).
      const a = fakeSocket()
      const b = fakeSocket()
      const c = fakeSocket()
      hub.join(a.socket, ana)
      hub.join(b.socket, bruno)
      hub.join(c.socket, carla)

      const base = tileOf(hub.occupantOf('ana')!)
      const front = { x: base.x + 1, y: base.y }
      walkTo(hub, b.socket, 'bruno', front)
      walkTo(hub, c.socket, 'carla', front)
      hub.face(a.socket, 'ana', 'right')
      hub.face(b.socket, 'bruno', 'left')
      hub.face(c.socket, 'carla', 'left')

      // Pré-condição do teste: os dois realmente empilhados no tile da frente.
      expect(tileOf(hub.occupantOf('bruno')!)).toEqual(front)
      expect(tileOf(hub.occupantOf('carla')!)).toEqual(front)
      expect(hub.occupantOf('bruno')).toMatchObject({ dir: 'left' })
      expect(hub.occupantOf('carla')).toMatchObject({ dir: 'left' })
      expect(tileOf(hub.occupantOf('ana')!)).toEqual({ x: base.x, y: base.y })
      expect(hub.occupantOf('ana')).toMatchObject({ dir: 'right' })

      a.sent.length = 0

      // Ana acena por último: a avaliação dela é a que enxerga os dois.
      hub.nearbyMessage(b.socket, 'bruno', '👋', 'reaction')
      hub.nearbyMessage(c.socket, 'carla', '👋', 'reaction')
      hub.nearbyMessage(a.socket, 'ana', '👋', 'reaction')

      expect(highFives(a.sent)).toHaveLength(1)
    })

    it('não dispara se a reação do outro já expirou', () => {
      const { a, b } = facePair()
      hub.nearbyMessage(a.socket, 'ana', '👋', 'reaction')
      vi.setSystemTime(Date.now() + REACTION_ACTIVE_WINDOW_MS + 1)
      hub.nearbyMessage(b.socket, 'bruno', '👋', 'reaction')
      expect(highFives(a.sent)).toHaveLength(0)
    })
  })
})

describe('trancar sala', () => {
  function runtimeWithClaimedDesk(owner: { id: string; name: string } | null) {
    const runtime = legacyOfficeRuntimeFixture()
    runtime.document.objects.push({
      id: 'desk-reuniao-1',
      layerKey: 'desks',
      type: 'desk',
      geometry: { kind: 'rectangle', x: 608, y: 368, width: 64, height: 32 },
      properties: { externalKey: 'mesa-reuniao-1', name: 'Mesa da Sala 1' },
    })
    runtime.desks = [
      {
        id: 'desk-reuniao-1-db',
        externalKey: 'mesa-reuniao-1',
        name: 'Mesa da Sala 1',
        claimedBy: owner,
      },
    ]
    return runtime
  }

  /**
   * Ana dentro da sala 1, Bruno parado na PORTA (um passo pra direita entra) —
   * cenário base de toda a feature. Parar na porta deixa a tentativa de
   * entrada ser um `move` só, sem depender do caminho.
   */
  function insideAndOutside() {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
    walkTo(hub, b.socket, 'bruno', ROOM1_DOOR)
    a.sent.length = 0
    b.sent.length = 0
    return { a, b }
  }

  const isInRoom1 = (userId: string) => {
    const occupant = hub.occupantOf(userId)!
    return hub.roomOf(occupant)?.id === ROOM1_ID
  }

  it('trancar avisa todo mundo e barra quem está fora, sem expulsar quem está dentro', () => {
    const { a, b } = insideAndOutside()

    hub.setRoomLock(a.socket, 'ana', true)

    expect(b.sent).toContainEqual({ type: 'room-lock-changed', roomId: ROOM1_ID, locked: true, byUserId: 'ana' })
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)
    expect(isInRoom1('bruno')).toBe(false)
    expect(tileOf(hub.occupantOf('ana')!)).toEqual(ROOM1_INSIDE)
  })

  it('só o dono da mesa reivindicada dentro da sala pode mexer no cadeado', () => {
    hub.configure(runtimeWithClaimedDesk({ id: 'ana', name: 'Ana' }))
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)
    a.sent.length = 0
    b.sent.length = 0

    hub.setRoomLock(b.socket, 'bruno', true)

    expect(a.sent.some((m) => m.type === 'room-lock-changed')).toBe(false)
    expect(b.sent.some((m) => m.type === 'room-lock-changed')).toBe(false)

    hub.setRoomLock(a.socket, 'ana', true)
    expect(b.sent).toContainEqual({ type: 'room-lock-changed', roomId: ROOM1_ID, locked: true, byUserId: 'ana' })

    a.sent.length = 0
    b.sent.length = 0
    hub.setRoomLock(b.socket, 'bruno', false)
    expect(a.sent.some((m) => m.type === 'room-lock-changed' && m.locked === false)).toBe(false)

    hub.setRoomLock(a.socket, 'ana', false)
    expect(b.sent).toContainEqual({ type: 'room-lock-changed', roomId: ROOM1_ID, locked: false, byUserId: 'ana' })
  })

  it('sala com mesa livre continua permitindo qualquer ocupante trancar', () => {
    hub.configure(runtimeWithClaimedDesk(null))
    const { a, b } = insideAndOutside()

    hub.setRoomLock(a.socket, 'ana', true)

    expect(b.sent).toContainEqual({ type: 'room-lock-changed', roomId: ROOM1_ID, locked: true, byUserId: 'ana' })
  })

  it('recusa explica o motivo e devolve o tile recusado, só pra quem esbarrou', () => {
    const { a, b } = insideAndOutside()
    hub.setRoomLock(a.socket, 'ana', true)
    a.sent.length = 0
    b.sent.length = 0

    // Um passo só: da porta pra dentro da sala.
    hub.__walkForTest(b.socket, 'bruno', 'right')

    const denied = b.sent.find((m) => m.type === 'room-entry-denied')
    expect(denied).toMatchObject({
      type: 'room-entry-denied',
      roomId: ROOM1_ID,
      reason: 'locked',
      x: ROOM1_DOOR.x + 1,
      y: ROOM1_DOOR.y,
    })
    expect(a.sent.some((m) => m.type === 'room-entry-denied')).toBe(false)
  })

  it('bloqueio do admin recusa com motivo próprio — não há a quem pedir', () => {
    const runtime = legacyOfficeRuntimeFixture()
    runtime.rooms = runtime.rooms.map((room) => (room.id === ROOM1_ID ? { ...room, status: 'LOCKED' as const } : room))
    hub = new OfficeHub()
    hub.configure(runtime)
    const b = fakeSocket()
    hub.join(b.socket, bruno)
    walkTo(hub, b.socket, 'bruno', ROOM1_DOOR)
    b.sent.length = 0

    hub.__walkForTest(b.socket, 'bruno', 'right')

    expect(b.sent.find((m) => m.type === 'room-entry-denied')).toMatchObject({ reason: 'admin-locked' })
  })

  it('não repete a recusa a cada passo enquanto a tecla fica presa', () => {
    vi.useFakeTimers()
    try {
      const { a, b } = insideAndOutside()
      hub.setRoomLock(a.socket, 'ana', true)
      b.sent.length = 0

      for (let i = 0; i < 5; i += 1) hub.__walkForTest(b.socket, 'bruno', 'right')
      expect(b.sent.filter((m) => m.type === 'room-entry-denied')).toHaveLength(1)

      vi.advanceTimersByTime(ENTRY_DENIED_THROTTLE_MS + 10)
      hub.__walkForTest(b.socket, 'bruno', 'right')
      expect(b.sent.filter((m) => m.type === 'room-entry-denied')).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('o pedido para entrar só chega a quem está na sala', () => {
    const { a, b } = insideAndOutside()
    const c = fakeSocket()
    hub.join(c.socket, carla) // fora da sala
    hub.setRoomLock(a.socket, 'ana', true)
    a.sent.length = 0
    c.sent.length = 0

    hub.knock(b.socket, 'bruno', ROOM1_ID, true)

    expect(a.sent).toContainEqual({ type: 'knock-request', roomId: ROOM1_ID, userId: 'bruno', name: 'Bruno' })
    expect(c.sent.some((m) => m.type === 'knock-request')).toBe(false)
  })

  it('pedir numa sala destrancada é no-op', () => {
    const { a, b } = insideAndOutside()

    hub.knock(b.socket, 'bruno', ROOM1_ID, true)

    expect(a.sent.some((m) => m.type === 'knock-request')).toBe(false)
  })

  it('aceitar libera a entrada, responde a quem pediu e fecha o pedido na sala', () => {
    const { a, b } = insideAndOutside()
    hub.setRoomLock(a.socket, 'ana', true)
    hub.knock(b.socket, 'bruno', ROOM1_ID, true)
    a.sent.length = 0
    b.sent.length = 0

    hub.knockResponse(a.socket, 'ana', 'bruno', true)

    expect(b.sent).toContainEqual({
      type: 'knock-result',
      roomId: ROOM1_ID,
      accepted: true,
      byUserId: 'ana',
      byName: 'Ana',
    })
    expect(a.sent).toContainEqual({ type: 'knock-cleared', roomId: ROOM1_ID, userId: 'bruno' })

    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)
    expect(tileOf(hub.occupantOf('bruno')!)).toEqual(ROOM1_INSIDE)
  })

  it('recusar não libera a entrada', () => {
    const { a, b } = insideAndOutside()
    hub.setRoomLock(a.socket, 'ana', true)
    hub.knock(b.socket, 'bruno', ROOM1_ID, true)
    b.sent.length = 0

    hub.knockResponse(a.socket, 'ana', 'bruno', false)

    expect(b.sent).toContainEqual({
      type: 'knock-result',
      roomId: ROOM1_ID,
      accepted: false,
      byUserId: 'ana',
      byName: 'Ana',
    })
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)
    expect(isInRoom1('bruno')).toBe(false)
  })

  it('quem está fora da sala não pode responder pela sala', () => {
    const { a, b } = insideAndOutside()
    const c = fakeSocket()
    hub.join(c.socket, carla)
    hub.setRoomLock(a.socket, 'ana', true)
    hub.knock(b.socket, 'bruno', ROOM1_ID, true)
    b.sent.length = 0

    hub.knockResponse(c.socket, 'carla', 'bruno', true)

    expect(b.sent.some((m) => m.type === 'knock-result')).toBe(false)
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)
    expect(isInRoom1('bruno')).toBe(false)
  })

  it('desistir do pedido fecha o modal de quem estava na sala', () => {
    const { a, b } = insideAndOutside()
    hub.setRoomLock(a.socket, 'ana', true)
    hub.knock(b.socket, 'bruno', ROOM1_ID, true)
    a.sent.length = 0

    hub.knock(b.socket, 'bruno', ROOM1_ID, false)

    expect(a.sent).toContainEqual({ type: 'knock-cleared', roomId: ROOM1_ID, userId: 'bruno' })
  })

  it('pedido repetido dentro do cooldown volta como cancelado, sem incomodar a sala de novo', () => {
    const { a, b } = insideAndOutside()
    hub.setRoomLock(a.socket, 'ana', true)
    hub.knock(b.socket, 'bruno', ROOM1_ID, true)
    hub.knock(b.socket, 'bruno', ROOM1_ID, false)
    a.sent.length = 0
    b.sent.length = 0

    hub.knock(b.socket, 'bruno', ROOM1_ID, true)

    expect(a.sent.some((m) => m.type === 'knock-request')).toBe(false)
    expect(b.sent).toContainEqual({ type: 'knock-cleared', roomId: ROOM1_ID, userId: 'bruno' })
  })

  it('passado o cooldown, dá pra pedir de novo', () => {
    vi.useFakeTimers()
    try {
      const { a, b } = insideAndOutside()
      hub.setRoomLock(a.socket, 'ana', true)
      hub.knock(b.socket, 'bruno', ROOM1_ID, true)
      hub.knock(b.socket, 'bruno', ROOM1_ID, false)
      a.sent.length = 0

      vi.advanceTimersByTime(KNOCK_COOLDOWN_MS + 10)
      hub.knock(b.socket, 'bruno', ROOM1_ID, true)

      expect(a.sent.some((m) => m.type === 'knock-request')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('quem pediu e saiu do escritório não deixa o pedido pendurado', () => {
    vi.useFakeTimers()
    try {
      const { a, b } = insideAndOutside()
      hub.setRoomLock(a.socket, 'ana', true)
      hub.knock(b.socket, 'bruno', ROOM1_ID, true)
      a.sent.length = 0

      hub.leave(b.socket, 'bruno')
      vi.advanceTimersByTime(RECONNECT_GRACE_MS + 10)

      expect(a.sent).toContainEqual({ type: 'knock-cleared', roomId: ROOM1_ID, userId: 'bruno' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('a tranca fica com quem ficou quando quem trancou sai andando', () => {
    const { a, b } = insideAndOutside()
    const c = fakeSocket()
    hub.join(c.socket, carla)
    walkTo(hub, c.socket, 'carla', ROOM1_INSIDE)
    hub.setRoomLock(a.socket, 'ana', true)
    b.sent.length = 0

    walkTo(hub, a.socket, 'ana', ROOM1_OUTSIDE)

    expect(b.sent.some((m) => m.type === 'room-lock-changed' && m.locked === false)).toBe(false)
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)
    expect(isInRoom1('bruno')).toBe(false)
  })

  it('a sala esvaziar destranca sozinha', () => {
    const { a, b } = insideAndOutside()
    hub.setRoomLock(a.socket, 'ana', true)
    b.sent.length = 0

    walkTo(hub, a.socket, 'ana', ROOM1_OUTSIDE)

    expect(b.sent).toContainEqual({ type: 'room-lock-changed', roomId: ROOM1_ID, locked: false, byUserId: null })
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)
    expect(tileOf(hub.occupantOf('bruno')!)).toEqual(ROOM1_INSIDE)
  })

  /**
   * Regressão do card da mesa trancada sozinha: trancar é aceito pela posição
   * em pixel, mas a travessia de sala é detectada pelo tile COMITADO, que tem
   * histerese. Quem trancava de raspão (centro dentro do tile da sala, sem ter
   * comitado) deixava uma tranca que saída nenhuma desfazia — a sala ficava
   * fechada e vazia, e nem o dono da mesa voltava para dentro.
   */
  it('tranca feita de raspão na divisa também some quando a sala esvazia', () => {
    const { a, b } = insideAndOutside()
    walkTo(hub, a.socket, 'ana', ROOM1_DOOR)
    // Anda até um pixel para dentro do tile da sala: menos que
    // `TILE_COMMIT_MARGIN`, então a cascata de travessia ainda a considera do
    // lado de fora.
    let seq = 900
    let restante = ((ROOM1_INSIDE_EDGE_X - hub.occupantOf('ana')!.x) / BODY_SPEED) * 1000
    while (restante > 0.001) {
      const dtMs = Math.min(50, restante)
      hub.applyInput(a.socket, 'ana', { seq: (seq += 1), dx: 1, dy: 0, dtMs })
      hub.__tickForTest(dtMs)
      restante -= dtMs
    }
    expect(tileOf(hub.occupantOf('ana')!)).toEqual({ x: 17, y: 12 })

    hub.setRoomLock(a.socket, 'ana', true)
    expect(b.sent).toContainEqual({ type: 'room-lock-changed', roomId: ROOM1_ID, locked: true, byUserId: 'ana' })
    b.sent.length = 0

    walkTo(hub, a.socket, 'ana', ROOM1_OUTSIDE)

    expect(b.sent).toContainEqual({ type: 'room-lock-changed', roomId: ROOM1_ID, locked: false, byUserId: null })
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)
    expect(tileOf(hub.occupantOf('bruno')!)).toEqual(ROOM1_INSIDE)
  })

  it('destrancar cancela os pedidos em aberto e revoga os passes concedidos', () => {
    const { a, b } = insideAndOutside()
    const c = fakeSocket()
    hub.join(c.socket, carla)
    walkTo(hub, c.socket, 'carla', ROOM1_OUTSIDE)
    hub.setRoomLock(a.socket, 'ana', true)
    hub.knockResponse(a.socket, 'ana', 'bruno', true) // sem pedido: não concede nada
    hub.knock(b.socket, 'bruno', ROOM1_ID, true)
    hub.knockResponse(a.socket, 'ana', 'bruno', true)
    hub.knock(c.socket, 'carla', ROOM1_ID, true)
    a.sent.length = 0

    hub.setRoomLock(a.socket, 'ana', false)

    expect(a.sent).toContainEqual({ type: 'knock-cleared', roomId: ROOM1_ID, userId: 'carla' })
    expect(a.sent).toContainEqual({ type: 'room-lock-changed', roomId: ROOM1_ID, locked: false, byUserId: 'ana' })
    // Trancar de novo: o passe do Bruno morreu junto com a tranca anterior.
    hub.setRoomLock(a.socket, 'ana', true)
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)
    expect(isInRoom1('bruno')).toBe(false)
  })

  it('quem entra depois recebe as salas trancadas no welcome', () => {
    const { a } = insideAndOutside()
    hub.setRoomLock(a.socket, 'ana', true)

    const c = fakeSocket()
    hub.join(c.socket, carla)

    expect(c.sent.find((m) => m.type === 'welcome')).toMatchObject({ lockedRoomIds: [ROOM1_ID] })
  })

  it('trancar de fora de sala de reunião é no-op', () => {
    const { a, b } = insideAndOutside()
    walkTo(hub, a.socket, 'ana', ROOM1_OUTSIDE)
    b.sent.length = 0

    hub.setRoomLock(a.socket, 'ana', true)

    expect(b.sent.some((m) => m.type === 'room-lock-changed')).toBe(false)
  })

  it('socket que não é dono do usuário não tranca nada', () => {
    const { a, b } = insideAndOutside()

    hub.setRoomLock(b.socket, 'ana', true)

    expect(a.sent.some((m) => m.type === 'room-lock-changed')).toBe(false)
  })
})

describe('screenAnnotation', () => {
  it('dentro de sala, chega aos outros da sala e não ecoa no socket remetente', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)

    hub.screenAnnotation(a.socket, 'ana', {
      sharerId: 'bruno',
      strokeId: 's1',
      points: [{ x: 0.1, y: 0.2 }],
      done: true,
    })

    expect(a.sent.some((m) => m.type === 'screen-annotation')).toBe(false)
    expect(b.sent).toContainEqual(
      expect.objectContaining({
        type: 'screen-annotation',
        userId: 'ana',
        sharerId: 'bruno',
        strokeId: 's1',
        points: [{ x: 0.1, y: 0.2 }],
        done: true,
      }),
    )
  })

  it('dentro de sala, não vaza para quem está fora dela', () => {
    const a = fakeSocket()
    const c = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(c.socket, carla)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)

    hub.screenAnnotation(a.socket, 'ana', {
      sharerId: 'ana',
      strokeId: 's1',
      points: [{ x: 0.5, y: 0.5 }],
    })

    expect(c.sent.some((m) => m.type === 'screen-annotation')).toBe(false)
  })

  it('fora de sala, difunde para o escritório — quem não vê a tela descarta no cliente', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)

    hub.screenAnnotation(a.socket, 'ana', {
      sharerId: 'ana',
      strokeId: 's1',
      points: [{ x: 0.5, y: 0.5 }],
    })

    expect(b.sent).toContainEqual(
      expect.objectContaining({ type: 'screen-annotation', userId: 'ana', sharerId: 'ana' }),
    )
  })

  it('omite `done` quando o lote não é o último', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)

    hub.screenAnnotation(a.socket, 'ana', {
      sharerId: 'ana',
      strokeId: 's1',
      points: [{ x: 0.5, y: 0.5 }],
    })

    const message = b.sent.find((m) => m.type === 'screen-annotation')
    expect(message).toBeDefined()
    expect('done' in (message as object)).toBe(false)
  })

  it('ignora payload inválido (pontos fora da faixa, ids vazios)', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)

    hub.screenAnnotation(a.socket, 'ana', { sharerId: 'ana', strokeId: 's1', points: [{ x: 2, y: 0 }] })
    hub.screenAnnotation(a.socket, 'ana', { sharerId: '', strokeId: 's1', points: [{ x: 0.5, y: 0.5 }] })
    hub.screenAnnotation(a.socket, 'ana', { sharerId: 'ana', strokeId: '', points: [{ x: 0.5, y: 0.5 }] })
    hub.screenAnnotation(a.socket, 'ana', { sharerId: 'ana', strokeId: 's1', points: 'nada' })

    expect(b.sent.some((m) => m.type === 'screen-annotation')).toBe(false)
  })

  it('ignora quem manda em nome de outro (socket não é dono do userId)', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)

    hub.screenAnnotation(a.socket, 'bruno', {
      sharerId: 'ana',
      strokeId: 's1',
      points: [{ x: 0.5, y: 0.5 }],
    })

    expect(b.sent.some((m) => m.type === 'screen-annotation')).toBe(false)
  })

  it('rejeita strokeId acima do limite; no limite exato ainda difunde', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)

    const tooLong = 's'.repeat(OFFICE_ANNOTATION_STROKE_ID_MAX_LENGTH + 1)
    hub.screenAnnotation(a.socket, 'ana', {
      sharerId: 'ana',
      strokeId: tooLong,
      points: [{ x: 0.5, y: 0.5 }],
    })
    expect(b.sent.some((m) => m.type === 'screen-annotation')).toBe(false)

    const atLimit = 's'.repeat(OFFICE_ANNOTATION_STROKE_ID_MAX_LENGTH)
    hub.screenAnnotation(a.socket, 'ana', {
      sharerId: 'ana',
      strokeId: atLimit,
      points: [{ x: 0.5, y: 0.5 }],
    })
    expect(b.sent).toContainEqual(
      expect.objectContaining({ type: 'screen-annotation', userId: 'ana', strokeId: atLimit }),
    )
  })

  it('rejeita sharerId acima do limite; no limite exato ainda difunde', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)

    const tooLong = 's'.repeat(OFFICE_ANNOTATION_STROKE_ID_MAX_LENGTH + 1)
    hub.screenAnnotation(a.socket, 'ana', {
      sharerId: tooLong,
      strokeId: 's1',
      points: [{ x: 0.5, y: 0.5 }],
    })
    expect(b.sent.some((m) => m.type === 'screen-annotation')).toBe(false)

    const atLimit = 's'.repeat(OFFICE_ANNOTATION_STROKE_ID_MAX_LENGTH)
    hub.screenAnnotation(a.socket, 'ana', {
      sharerId: atLimit,
      strokeId: 's2',
      points: [{ x: 0.5, y: 0.5 }],
    })
    expect(b.sent).toContainEqual(
      expect.objectContaining({ type: 'screen-annotation', userId: 'ana', sharerId: atLimit }),
    )
  })

  it('descarta o excesso quando alguém spamma screenAnnotation (rate limit)', () => {
    vi.useFakeTimers()
    try {
      const a = fakeSocket()
      const b = fakeSocket()
      hub.join(a.socket, ana)
      hub.join(b.socket, bruno)

      // 100 lotes no mesmo instante: no máximo o burst passa.
      for (let i = 0; i < 100; i += 1) {
        hub.screenAnnotation(a.socket, 'ana', {
          sharerId: 'ana',
          strokeId: 's1',
          points: [{ x: 0.5, y: 0.5 }],
        })
      }

      const received = b.sent.filter((m) => m.type === 'screen-annotation')
      expect(received.length).toBeLessThanOrEqual(20)
      expect(received.length).toBeGreaterThan(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('cadência legítima de desenho (lote a cada 60ms) não esbarra no rate limit', () => {
    vi.useFakeTimers()
    try {
      const a = fakeSocket()
      const b = fakeSocket()
      hub.join(a.socket, ana)
      hub.join(b.socket, bruno)

      for (let i = 0; i < 40; i += 1) {
        hub.screenAnnotation(a.socket, 'ana', {
          sharerId: 'ana',
          strokeId: 's1',
          points: [{ x: 0.5, y: 0.5 }],
        })
        vi.advanceTimersByTime(OFFICE_ANNOTATION_BATCH_MS)
      }

      const received = b.sent.filter((m) => m.type === 'screen-annotation')
      expect(received.length).toBe(40)
    } finally {
      vi.useRealTimers()
    }
  })

  it('dentro de zona privada, chega a quem está na mesma zona e não vaza para quem está fora', () => {
    const runtime = legacyOfficeRuntimeFixture()
    // Tile andável a 1 passo dos spawns de ana (12,14) e bruno (13,15), fora de
    // qualquer sala de reunião (que ocupam y=11-16 nas faixas x de OFFICE_ZONES).
    // Precisa ficar perto: os `move()` do teste são síncronos, então o token
    // bucket de movimento (BURST = 20) não repõe nada entre passos — um caminho
    // longo estoura o burst e a pessoa para fora do alvo.
    const ZONE_TILE = { x: 12, y: 15 }
    runtime.document.objects.push({
      id: 'private-zona-1',
      layerKey: 'private-zones',
      type: 'private-zone',
      geometry: { kind: 'rectangle', x: ZONE_TILE.x * 32, y: ZONE_TILE.y * 32, width: 32, height: 32 },
      properties: { name: 'Zona privada de teste', externalKey: 'zona-1', accessPolicy: 'OPEN' },
    })
    hub.configure(runtime)

    const a = fakeSocket()
    const b = fakeSocket()
    const c = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    hub.join(c.socket, carla) // spawn fora de sala/zona
    walkTo(hub, a.socket, 'ana', ZONE_TILE)
    walkTo(hub, b.socket, 'bruno', ZONE_TILE)

    hub.screenAnnotation(a.socket, 'ana', {
      sharerId: 'ana',
      strokeId: 's1',
      points: [{ x: 0.5, y: 0.5 }],
    })

    expect(b.sent).toContainEqual(
      expect.objectContaining({ type: 'screen-annotation', userId: 'ana', sharerId: 'ana' }),
    )
    expect(c.sent.some((m) => m.type === 'screen-annotation')).toBe(false)
  })
})

describe('áudio compartilhado da sala', () => {
  const VIDEO = 'dQw4w9WgXcQ'
  const OTHER_VIDEO = 'aBcDeFgHiJk'

  /** Ana e Bruno dentro da sala 1; Carla fora, no corredor. */
  function roomWithTwo() {
    const a = fakeSocket()
    const b = fakeSocket()
    const c = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    hub.join(c.socket, carla)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
    walkTo(hub, b.socket, 'bruno', { x: 21, y: 12 })
    walkTo(hub, c.socket, 'carla', ROOM1_OUTSIDE)
    a.sent.length = 0
    b.sent.length = 0
    c.sent.length = 0
    return { a, b, c }
  }

  const audioChanges = (sent: OfficeServerMessage[]) => sent.filter((m) => m.type === 'room-audio-changed')

  it('quem inicia propaga a faixa com a posição zerada', () => {
    const { a, b } = roomWithTwo()

    hub.startRoomAudio(a.socket, 'ana', VIDEO)

    const expected = {
      type: 'room-audio-changed',
      roomId: ROOM1_ID,
      track: {
        videoId: VIDEO,
        playlistId: null,
        playlistIndex: 0,
        startedByUserId: 'ana',
        startedByName: 'Ana',
        positionSeconds: 0,
        paused: false,
      },
    }
    expect(a.sent).toContainEqual(expected)
    expect(b.sent).toContainEqual(expected)
  })

  it('avisa o escritório inteiro, para quem ANDA até a sala já entrar tocando', () => {
    const { a, c } = roomWithTwo()

    hub.startRoomAudio(a.socket, 'ana', VIDEO)

    // Carla está no corredor e mesmo assim recebe: o cliente filtra pela sala.
    expect(audioChanges(c.sent)).toHaveLength(1)
  })

  it('recusa a segunda faixa da mesma sala, só para quem pediu', () => {
    const { a, b } = roomWithTwo()
    hub.startRoomAudio(a.socket, 'ana', VIDEO)
    a.sent.length = 0
    b.sent.length = 0

    hub.startRoomAudio(b.socket, 'bruno', OTHER_VIDEO)

    expect(b.sent).toContainEqual({ type: 'room-audio-denied', reason: 'busy' })
    expect(audioChanges(b.sent)).toHaveLength(0)
    expect(a.sent).toHaveLength(0)
  })

  it('recusa fora de sala de reunião, link inválido e convidado', () => {
    const c = fakeSocket()
    hub.join(c.socket, carla)
    walkTo(hub, c.socket, 'carla', ROOM1_OUTSIDE)
    c.sent.length = 0
    hub.startRoomAudio(c.socket, 'carla', VIDEO)
    expect(c.sent).toContainEqual({ type: 'room-audio-denied', reason: 'not-in-room' })

    const a = fakeSocket()
    hub.join(a.socket, ana)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
    a.sent.length = 0
    hub.startRoomAudio(a.socket, 'ana', 'https://vimeo.com/12345')
    expect(a.sent).toContainEqual({ type: 'room-audio-denied', reason: 'invalid' })

    const g = fakeSocket()
    hub.join(g.socket, { ...bruno, id: 'convidado', name: 'Convidado', isGuest: true })
    walkTo(hub, g.socket, 'convidado', { x: 21, y: 12 })
    g.sent.length = 0
    hub.startRoomAudio(g.socket, 'convidado', VIDEO)
    expect(g.sent).toContainEqual({ type: 'room-audio-denied', reason: 'guest' })
  })

  it('segura o gatilho: novo início antes do cooldown é recusado', () => {
    vi.useFakeTimers()
    try {
      const { a } = roomWithTwo()
      hub.startRoomAudio(a.socket, 'ana', VIDEO)
      hub.stopRoomAudio(a.socket, 'ana')
      a.sent.length = 0

      hub.startRoomAudio(a.socket, 'ana', OTHER_VIDEO)
      expect(a.sent).toContainEqual({ type: 'room-audio-denied', reason: 'cooldown' })

      vi.advanceTimersByTime(ROOM_AUDIO_START_COOLDOWN_MS + 10)
      a.sent.length = 0
      hub.startRoomAudio(a.socket, 'ana', OTHER_VIDEO)
      expect(audioChanges(a.sent)).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('só quem iniciou para a faixa', () => {
    const { a, b } = roomWithTwo()
    hub.startRoomAudio(a.socket, 'ana', VIDEO)
    a.sent.length = 0
    b.sent.length = 0

    hub.stopRoomAudio(b.socket, 'bruno')
    expect(audioChanges(a.sent)).toHaveLength(0)

    hub.stopRoomAudio(a.socket, 'ana')
    const stopped = { type: 'room-audio-changed', roomId: ROOM1_ID, track: null }
    expect(a.sent).toContainEqual(stopped)
    expect(b.sent).toContainEqual(stopped)
  })

  it('a faixa acaba quando quem iniciou sai andando, mesmo com gente na sala', () => {
    const { a, b } = roomWithTwo()
    hub.startRoomAudio(a.socket, 'ana', VIDEO)
    b.sent.length = 0

    walkTo(hub, a.socket, 'ana', ROOM1_OUTSIDE)

    expect(b.sent).toContainEqual({ type: 'room-audio-changed', roomId: ROOM1_ID, track: null })
  })

  it('a faixa acaba quando quem iniciou cai e não volta', () => {
    vi.useFakeTimers()
    try {
      const { a, b } = roomWithTwo()
      hub.startRoomAudio(a.socket, 'ana', VIDEO)
      b.sent.length = 0

      hub.leave(a.socket, 'ana')
      vi.advanceTimersByTime(RECONNECT_GRACE_MS + 1)

      expect(b.sent).toContainEqual({ type: 'room-audio-changed', roomId: ROOM1_ID, track: null })
    } finally {
      vi.useRealTimers()
    }
  })

  it('só quem iniciou pausa e retoma, e a pausa vale pra sala inteira', () => {
    vi.useFakeTimers()
    try {
      const { a, b } = roomWithTwo()
      hub.startRoomAudio(a.socket, 'ana', VIDEO)
      vi.advanceTimersByTime(20_000)
      b.sent.length = 0

      // Ouvinte não pausa nada.
      hub.setRoomAudioPaused(b.socket, 'bruno', true)
      expect(audioChanges(b.sent)).toHaveLength(0)

      hub.setRoomAudioPaused(a.socket, 'ana', true)
      expect(b.sent).toContainEqual(
        expect.objectContaining({
          type: 'room-audio-changed',
          roomId: ROOM1_ID,
          track: expect.objectContaining({ videoId: VIDEO, positionSeconds: 20, paused: true }),
        }),
      )

      // Pausada, a posição não anda: quem chega nasce parado no mesmo ponto.
      vi.advanceTimersByTime(30_000)
      const late = fakeSocket()
      hub.join(late.socket, carla)
      expect(late.sent.find((m) => m.type === 'welcome')).toMatchObject({
        roomAudio: [{ roomId: ROOM1_ID, positionSeconds: 20, paused: true }],
      })

      // Retomar continua de onde parou, não do ponto em que estaria sem pausa.
      b.sent.length = 0
      hub.setRoomAudioPaused(a.socket, 'ana', false)
      expect(b.sent).toContainEqual(
        expect.objectContaining({ track: expect.objectContaining({ positionSeconds: 20, paused: false }) }),
      )
      vi.advanceTimersByTime(5_000)
      const later = fakeSocket()
      hub.join(later.socket, carla)
      expect(later.sent.find((m) => m.type === 'welcome')).toMatchObject({
        roomAudio: [{ roomId: ROOM1_ID, positionSeconds: 25, paused: false }],
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('playlist: quem iniciou avança e a sala pula junto, começando do zero', () => {
    vi.useFakeTimers()
    try {
      const { a, b } = roomWithTwo()
      hub.startRoomAudio(a.socket, 'ana', `https://www.youtube.com/watch?v=${VIDEO}&list=PLabcdefghijkl`, 'https://www.youtube.com/watch?v=x&list=PLabcdefghijkl')
      expect(b.sent).toContainEqual(
        expect.objectContaining({
          track: expect.objectContaining({ playlistId: 'PLabcdefghijkl', playlistIndex: 0, videoId: VIDEO }),
        }),
      )

      vi.advanceTimersByTime(90_000)
      b.sent.length = 0
      hub.setRoomAudioItem(a.socket, 'ana', 1, OTHER_VIDEO)

      expect(b.sent).toContainEqual(
        expect.objectContaining({
          track: expect.objectContaining({ playlistIndex: 1, videoId: OTHER_VIDEO, positionSeconds: 0 }),
        }),
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('playlist: ouvinte não avança, e vídeo sozinho ignora o avanço', () => {
    const { a, b } = roomWithTwo()
    hub.startRoomAudio(a.socket, 'ana', VIDEO, 'https://www.youtube.com/playlist?list=PLabcdefghijkl')
    b.sent.length = 0

    hub.setRoomAudioItem(b.socket, 'bruno', 1, OTHER_VIDEO)
    expect(audioChanges(b.sent)).toHaveLength(0)

    // Reenvio do MESMO item (aba duplicada) também não republica.
    hub.setRoomAudioItem(a.socket, 'ana', 0, VIDEO)
    expect(audioChanges(b.sent)).toHaveLength(0)
  })

  it('playlist de mix/privada não pega: a sala ouve só o vídeo', () => {
    const { a, b } = roomWithTwo()

    hub.startRoomAudio(a.socket, 'ana', VIDEO, `https://www.youtube.com/watch?v=${VIDEO}&list=RD${VIDEO}&start_radio=1`)

    expect(b.sent).toContainEqual(
      expect.objectContaining({ track: expect.objectContaining({ videoId: VIDEO, playlistId: null }) }),
    )
    // Sem playlist, avançar item é no-op.
    b.sent.length = 0
    hub.setRoomAudioItem(a.socket, 'ana', 1, OTHER_VIDEO)
    expect(audioChanges(b.sent)).toHaveLength(0)
  })

  it('pausa repetida não republica pra sala', () => {
    const { a, b } = roomWithTwo()
    hub.startRoomAudio(a.socket, 'ana', VIDEO)
    hub.setRoomAudioPaused(a.socket, 'ana', true)
    b.sent.length = 0

    hub.setRoomAudioPaused(a.socket, 'ana', true)

    expect(audioChanges(b.sent)).toHaveLength(0)
  })

  it('quem entra depois recebe a faixa no ponto em que ela está', () => {
    vi.useFakeTimers()
    const { a } = roomWithTwo()
    hub.startRoomAudio(a.socket, 'ana', VIDEO)
    vi.advanceTimersByTime(30_000)

    const late = fakeSocket()
    hub.join(late.socket, carla)

    const welcome = late.sent.find((m) => m.type === 'welcome')
    expect(welcome).toMatchObject({
      roomAudio: [
        {
          roomId: ROOM1_ID,
          videoId: VIDEO,
          playlistId: null,
          playlistIndex: 0,
          startedByUserId: 'ana',
          startedByName: 'Ana',
          positionSeconds: 30,
          paused: false,
        },
      ],
    })
    vi.useRealTimers()
  })

  it('troca de publicação do mapa zera o áudio em andamento', () => {
    const { a } = roomWithTwo()
    hub.startRoomAudio(a.socket, 'ana', VIDEO)

    hub.configure(runtimeWithKarts(), true)

    const fresh = fakeSocket()
    hub.join(fresh.socket, ana)
    expect(fresh.sent.find((m) => m.type === 'welcome')).toMatchObject({ roomAudio: [] })
  })
})


function runtimeWithWallBelowBall(): ActiveOfficeMapDTO {
  const runtime = runtimeWithBalls([{ id: 'ball-1', x: 1, y: 2 }], 1)
  runtime.document.objects.push({
    id: 'parede', layerKey: 'collision', type: 'collision',
    geometry: { kind: 'rectangle', x: 32, y: 3 * 32, width: 32, height: 32 },
    properties: {},
  })
  return runtime
}

function runtimeWithWalls(walls: Array<[number, number]>): ActiveOfficeMapDTO {
  const runtime = runtimeWithKarts([])
  for (const [x, y] of walls) {
    runtime.document.objects.push({
      id: `parede-${x}-${y}`, layerKey: 'collision', type: 'collision',
      geometry: { kind: 'rectangle', x: x * 32, y: y * 32, width: 32, height: 32 },
      properties: {},
    })
  }
  return runtime
}

describe('movimento na diagonal', () => {
  beforeEach(() => hub.configure(runtimeWithKarts([])))

  it('anda nos dois eixos e encara para o lado', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    const antes = hub.occupantOf('ana')!
    b.sent.length = 0

    hub.__walkForTest(a.socket, 'ana', 'down-right')

    const depois = hub.occupantOf('ana')!
    expect(depois.x).toBeGreaterThan(antes.x)
    expect(depois.y).toBeGreaterThan(antes.y)
    // O sprite tem quatro poses: a diagonal vira de lado, nunca de frente.
    expect(depois.dir).toBe('right')

    // E a diagonal NÃO anda √2 mais rápido — `stepBody` normaliza o vetor, que é
    // o que `DIAGONAL_STEP_FACTOR` fazia na grade.
    const percorrido = Math.hypot(depois.x - antes.x, depois.y - antes.y)
    expect(percorrido).toBeCloseTo(32, 0)
  })

  it('não corta quina — e a regra virou GEOMETRIA, não um caso especial', () => {
    // Na grade isto era uma checagem explícita: diagonal com as duas ortogonais
    // bloqueadas era recusada, senão o personagem passava raspando entre duas
    // quinas. No contínuo a checagem some e o resultado continua: um corpo de
    // 14px de largura simplesmente NÃO CABE no vão diagonal entre dois tiles
    // sólidos, e `bodyBoxBlocked` amostra os cantos e os meios de cada lado.
    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.configure(runtimeWithWalls([[2, 1], [1, 2]]), false, true)

    for (let i = 0; i < 4; i += 1) hub.__walkForTest(a.socket, 'ana', 'down-right')

    expect(tileOf(hub.occupantOf('ana')!)).toEqual({ x: 1, y: 1 })
  })

  it('com UMA ortogonal bloqueada, desliza pela outra em vez de travar', () => {
    // Mudança deliberada em relação à grade, que recusava o passo inteiro. Parar
    // de vez ao raspar uma quina é o comportamento que faz o personagem "grudar"
    // na parede — e é justamente o que o movimento livre existe para não fazer.
    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.configure(runtimeWithWalls([[2, 1]]), false, true)
    const antes = hub.occupantOf('ana')!

    hub.__walkForTest(a.socket, 'ana', 'down-right')

    const depois = hub.occupantOf('ana')!
    expect(depois.y).toBeGreaterThan(antes.y)
    // Em x ele avança só o que couber até encostar — o corpo tem largura, então
    // "encostar na parede" não é "parar no centro do tile".
    expect(tileOf(depois).x).toBe(tileOf(antes).x)
  })

  it('sem nada no caminho, a diagonal passa', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.configure(runtimeWithWalls([[5, 5]]), false, true)

    hub.__walkForTest(a.socket, 'ana', 'down-right')

    expect(tileOf(hub.occupantOf('ana')!)).toEqual({ x: 2, y: 2 })
  })
})

describe('bola chutável', () => {
  // Ana nasce em (1,1) encarando 'down'; a bola de origem fica logo abaixo dela.
  beforeEach(() => hub.configure(runtimeWithBalls()))

  const bolaDe = (hubRef: OfficeHub) => hubRef.balls()[0]

  it('welcome traz as bolas publicadas, em pixel e com raio', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)

    const welcome = a.sent.find((m) => m.type === 'welcome') as { balls?: unknown[] }
    expect(welcome.balls).toEqual([
      { id: 'ball-1', ...tileCenter({ x: 1, y: 2 }), vx: 0, vy: 0, r: 16, memberIds: ['ball-1'] },
    ])
  })

  it('chutar dá VELOCIDADE à bola, na direção encarada', () => {
    // Antes o hub resolvia a trajetória inteira e mandava o caminho. Agora manda
    // velocidade, e os dois lados integram a mesma física — é o que permite
    // interceptar a bola no meio do caminho, que a resolução instantânea
    // impedia.
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    hub.__placeAtTileForTest('ana', 1, 1)
    hub.face(a.socket, 'ana', 'down')

    hub.kickBall(a.socket, 'ana', 'kick')

    const kicked = b.sent.find((m) => m.type === 'ball-kicked') as
      | { userId: string; power: string; ball: { vx: number; vy: number } }
      | undefined
    expect(kicked).toMatchObject({ userId: 'ana', power: 'kick' })
    expect(kicked!.ball.vy).toBeGreaterThan(0)
    expect(kicked!.ball.vx).toBeCloseTo(0, 5)
  })

  it('a bola rola no tick e para sozinha, pelo atrito', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.__placeAtTileForTest('ana', 1, 1)
    hub.face(a.socket, 'ana', 'down')
    const partida = bolaDe(hub).y

    hub.kickBall(a.socket, 'ana', 'kick')
    for (let i = 0; i < 200; i += 1) hub.__tickForTest(25)

    const parada = bolaDe(hub)
    expect(parada.y).toBeGreaterThan(partida)
    expect(Math.hypot(parada.vx, parada.vy)).toBe(0)
  })

  it('segurar mais tempo (carga maior) chuta mais forte', () => {
    const saida = (charge: number) => {
      hub.reset()
      hub.configure(runtimeWithBalls())
      const sock = fakeSocket()
      hub.join(sock.socket, ana)
      hub.__placeAtTileForTest('ana', 1, 1)
      hub.face(sock.socket, 'ana', 'down')
      hub.kickBall(sock.socket, 'ana', 'kick', false, charge)
      const bola = bolaDe(hub)
      return Math.hypot(bola.vx, bola.vy)
    }
    expect(saida(0)).toBeLessThan(saida(1))
  })

  it('sem carga informada, chuta na força cheia — compatível com quem não carrega', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.__placeAtTileForTest('ana', 1, 1)
    hub.face(a.socket, 'ana', 'down')

    hub.kickBall(a.socket, 'ana', 'kick')

    const kicked = a.sent.find((m) => m.type === 'ball-kicked') as
      | { ball: { vx: number; vy: number } }
      | undefined
    hub.reset()
    hub.configure(runtimeWithBalls())
    const b = fakeSocket()
    hub.join(b.socket, ana)
    hub.__placeAtTileForTest('ana', 1, 1)
    hub.face(b.socket, 'ana', 'down')
    hub.kickBall(b.socket, 'ana', 'kick', false, 1)
    const cargaCheia = b.sent.find((m) => m.type === 'ball-kicked') as
      | { ball: { vx: number; vy: number } }
      | undefined
    expect(Math.hypot(kicked!.ball.vx, kicked!.ball.vy)).toBeCloseTo(
      Math.hypot(cargaCheia!.ball.vx, cargaCheia!.ball.vy),
      5,
    )
  })

  it('o toque sai mais fraco que o chute', () => {
    // Compara a VELOCIDADE de saída, não onde a bola parou: numa sala pequena o
    // chute bate na parede e volta, e a distância final diria o contrário do que
    // aconteceu.
    const saida = (power: 'touch' | 'kick') => {
      hub.reset()
      hub.configure(runtimeWithBalls())
      const sock = fakeSocket()
      hub.join(sock.socket, ana)
      hub.__placeAtTileForTest('ana', 1, 1)
      hub.face(sock.socket, 'ana', 'down')
      hub.kickBall(sock.socket, 'ana', power)
      const bola = bolaDe(hub)
      return Math.hypot(bola.vx, bola.vy)
    }
    expect(saida('touch')).toBeLessThan(saida('kick'))
  })

  it('andar por cima da bola a conduz — por CONTATO, não pelo passo', () => {
    // O drible saía do `delta` do passo discreto, que deixou de existir. Agora
    // sai do contato: quem está em cima dela, andando, a empurra.
    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.__placeAtTileForTest('ana', 1, 1)
    const partida = bolaDe(hub).y

    for (let i = 0; i < 12; i += 1) hub.__walkForTest(a.socket, 'ana', 'down')

    expect(bolaDe(hub).y).toBeGreaterThan(partida)
  })

  it('andar ao LADO da bola não a conduz', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    // Duas colunas ao lado: fora do alcance de toque, por mais que ande.
    hub.__placeAtTileForTest('ana', 3, 1)
    const partida = { x: bolaDe(hub).x, y: bolaDe(hub).y }

    for (let i = 0; i < 8; i += 1) hub.__walkForTest(a.socket, 'ana', 'down')

    expect(bolaDe(hub)).toMatchObject(partida)
  })

  it('quem está longe da bola não chuta nada', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.__placeAtTileForTest('ana', 8, 8)
    a.sent.length = 0

    hub.kickBall(a.socket, 'ana', 'kick')

    expect(a.sent.filter((m) => m.type === 'ball-kicked')).toHaveLength(0)
  })

  it('socket que não é dono do usuário não chuta pelos outros', () => {
    const a = fakeSocket()
    const intruso = fakeSocket()
    hub.join(a.socket, ana)
    const partida = { ...bolaDe(hub) }

    hub.kickBall(intruso.socket, 'ana', 'kick')

    expect(bolaDe(hub)).toMatchObject({ vx: partida.vx, vy: partida.vy })
  })

  it('o chute alto passa por cima da mobília', () => {
    // Sem eixo Z, o que preserva a feature é o PRAZO em que a bola ignora
    // colisão. Sem ele o chute alto viraria rasteiro e pararia na primeira mesa.
    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.__placeAtTileForTest('ana', 1, 1)
    hub.face(a.socket, 'ana', 'down')

    hub.kickBall(a.socket, 'ana', 'lob')

    const kicked = a.sent.find((m) => m.type === 'ball-kicked') as
      | { ball: { airborneMs?: number } }
      | undefined
    expect(kicked!.ball.airborneMs).toBeGreaterThan(0)
  })

  it('publicação nova devolve a bola para a posição do editor', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.__placeAtTileForTest('ana', 1, 1)
    hub.face(a.socket, 'ana', 'down')
    hub.kickBall(a.socket, 'ana', 'kick')
    for (let i = 0; i < 40; i += 1) hub.__tickForTest(25)
    expect(bolaDe(hub).y).not.toBeCloseTo(tileCenter({ x: 1, y: 2 }).y, 5)

    // Publicação NOVA (decorRevision avança): é o que dispara a reconciliação.
    hub.configure(runtimeWithBalls(undefined, 1))

    expect(bolaDe(hub)).toMatchObject(tileCenter({ x: 1, y: 2 }))
  })

  it('save de decoração anuncia o snapshot das bolas', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    a.sent.length = 0

    hub.broadcastMapDecorUpdated('pub-2')

    expect(a.sent).toContainEqual({ type: 'balls-updated', balls: hub.balls() })
  })
})

describe('paintball', () => {
  // Todo mundo nasce em (1,1) encarando 'down' neste mapa vazio de 10×10.
  beforeEach(() => hub.configure(runtimeWithWalls([])))

  /** Coloca alguém `steps` tiles abaixo do spawn — na linha de tiro de quem encara 'down'. */
  function joinBelow(user: typeof bruno | typeof carla, steps: number) {
    const socket = fakeSocket()
    hub.join(socket.socket, user)
    for (let i = 0; i < steps; i += 1) hub.__walkForTest(socket.socket, user.id, 'down')
    socket.sent.length = 0
    return socket
  }

  it('desarmado, o tiro não sai — é o que impede o escritório de virar campo de tiro', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    a.sent.length = 0

    hub.firePaintball(a.socket, 'ana')

    expect(a.sent.some((message) => message.type === 'paintball-shot')).toBe(false)
  })

  it('equipar e guardar o marcador anda no occupant e é anunciado', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    b.sent.length = 0

    hub.setPaintMarker(a.socket, 'ana', true)
    expect(hub.occupantOf('ana')?.paintMarker).toBe(true)
    expect(b.sent).toContainEqual({ type: 'paint-marker', userId: 'ana', active: true })

    hub.setPaintMarker(a.socket, 'ana', false)
    // Ausente, e não `false`: desarmado é o normal, e o occupant do welcome
    // não carrega a chave para quem nunca equipou.
    expect(hub.occupantOf('ana')?.paintMarker).toBeUndefined()
    expect(b.sent).toContainEqual({ type: 'paint-marker', userId: 'ana', active: false })
  })

  it('armado, acerta quem está na linha e cria a marca', () => {
    const b = joinBelow(bruno, 3)
    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.setPaintMarker(a.socket, 'ana', true)

    hub.firePaintball(a.socket, 'ana')

    const shot = b.sent.find((message) => message.type === 'paintball-shot')
    // O disparo vem resolvido em PIXEL (de/para), não como lista de tiles: com
    // posição contínua, o tile de saída não diz de onde a bolinha saiu.
    expect(shot).toMatchObject({
      type: 'paintball-shot',
      shot: {
        shooterId: 'ana',
        splat: { userId: 'bruno', byUserId: 'ana', color: paintballColorFor('ana') },
      },
    })
    expect(hub.paintSplatsSnapshot()).toHaveLength(1)
  })

  it('sem ninguém na linha, o tiro sai e não marca nada', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.setPaintMarker(a.socket, 'ana', true)
    a.sent.length = 0

    hub.firePaintball(a.socket, 'ana')

    const shot = a.sent.find((message) => message.type === 'paintball-shot')
    expect(shot).toMatchObject({ shot: { splat: null } })
    expect(hub.paintSplatsSnapshot()).toEqual([])
  })

  it('quem está ausente não leva marca nem para o tiro de quem está atrás', () => {
    const b = joinBelow(bruno, 2)
    const c = joinBelow(carla, 4)
    hub.setStatus(b.socket, 'bruno', 'away')
    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.setPaintMarker(a.socket, 'ana', true)

    hub.firePaintball(a.socket, 'ana')

    expect(hub.paintSplatsSnapshot()).toMatchObject([{ userId: 'carla' }])
    // A bolinha ATRAVESSA quem está ausente e para em quem não está: o tiro
    // segue reto para baixo, e o `to` cai onde a carla está.
    expect(c.sent.find((message) => message.type === 'paintball-shot')).toMatchObject({
      shot: { splat: { userId: 'carla' } },
    })
  })

  it('mesa no caminho para o tiro antes do alvo', () => {
    joinBelow(bruno, 4)
    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.setPaintMarker(a.socket, 'ana', true)
    hub.configure(runtimeWithWalls([[1, 3]]), false, true)

    hub.firePaintball(a.socket, 'ana')

    expect(hub.paintSplatsSnapshot()).toEqual([])
  })

  it('a cadência é do servidor: segurar a tecla não vira metralhadora', () => {
    vi.useFakeTimers()
    try {
      const b = joinBelow(bruno, 3)
      const a = fakeSocket()
      hub.join(a.socket, ana)
      hub.setPaintMarker(a.socket, 'ana', true)
      b.sent.length = 0

      hub.firePaintball(a.socket, 'ana')
      hub.firePaintball(a.socket, 'ana')
      expect(b.sent.filter((message) => message.type === 'paintball-shot')).toHaveLength(1)

      vi.advanceTimersByTime(PAINTBALL_COOLDOWN_MS + 10)
      hub.firePaintball(a.socket, 'ana')
      expect(b.sent.filter((message) => message.type === 'paintball-shot')).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignora tiro de socket cujo dono não bate com o userId (anti-spoof)', () => {
    const b = joinBelow(bruno, 3)
    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.setPaintMarker(a.socket, 'ana', true)
    hub.setPaintMarker(b.socket, 'bruno', true)
    b.sent.length = 0

    hub.firePaintball(b.socket, 'ana')

    expect(b.sent.some((message) => message.type === 'paintball-shot')).toBe(false)
  })

  it('acumula até o teto de marcas, descartando a mais velha', () => {
    vi.useFakeTimers()
    try {
      joinBelow(bruno, 3)
      const a = fakeSocket()
      hub.join(a.socket, ana)
      hub.setPaintMarker(a.socket, 'ana', true)

      for (let i = 0; i < PAINTBALL_MAX_SPLATS + 3; i += 1) {
        hub.firePaintball(a.socket, 'ana')
        vi.advanceTimersByTime(PAINTBALL_COOLDOWN_MS + 10)
      }

      expect(hub.paintSplatsSnapshot()).toHaveLength(PAINTBALL_MAX_SPLATS)
    } finally {
      vi.useRealTimers()
    }
  })

  it('welcome traz as marcas vivas com o ttl já descontado, e some com as vencidas', () => {
    vi.useFakeTimers()
    try {
      joinBelow(bruno, 3)
      const a = fakeSocket()
      hub.join(a.socket, ana)
      hub.setPaintMarker(a.socket, 'ana', true)
      hub.firePaintball(a.socket, 'ana')

      vi.advanceTimersByTime(5_000)
      const chegando = fakeSocket()
      hub.join(chegando.socket, carla)
      const welcome = chegando.sent.find((message) => message.type === 'welcome')
      expect(welcome).toMatchObject({
        paintSplats: [{ userId: 'bruno', ttlMs: PAINT_SPLAT_TTL_MS - 5_000 }],
      })

      // Sem timer nenhum no hub: quem lê é quem poda.
      vi.advanceTimersByTime(PAINT_SPLAT_TTL_MS)
      expect(hub.paintSplatsSnapshot()).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('a tinta some com quem a levava', () => {
    vi.useFakeTimers()
    try {
      const b = joinBelow(bruno, 3)
      const a = fakeSocket()
      hub.join(a.socket, ana)
      hub.setPaintMarker(a.socket, 'ana', true)
      hub.firePaintball(a.socket, 'ana')
      expect(hub.paintSplatsSnapshot()).toHaveLength(1)

      hub.leave(b.socket, 'bruno')
      vi.advanceTimersByTime(RECONNECT_GRACE_MS + 10)

      expect(hub.paintSplatsSnapshot()).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('o alcance é constante e o cliente não escolhe nada além do gesto', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    hub.setPaintMarker(a.socket, 'ana', true)
    // Mapa de 10×10: encarando 'down' de (1,1), a parede da borda para antes
    // do alcance cheio — é o cenário que limita, não o payload.
    hub.firePaintball(a.socket, 'ana')

    const shot = a.sent.find((message) => message.type === 'paintball-shot') as
      | { shot: { from: { x: number; y: number }; to: { x: number; y: number } } }
      | undefined
    // Sai de onde a pessoa está, em pixel, e vai para BAIXO — a mira é o facing
    // autoritativo, e o cliente não escolhe nada além do gesto.
    expect(shot!.shot.from.x).toBeCloseTo(shot!.shot.to.x, 5)
    expect(shot!.shot.to.y).toBeGreaterThan(shot!.shot.from.y)
    // O alcance é constante: a parede da borda para o tiro antes do teto.
    expect(shot!.shot.to.y - shot!.shot.from.y).toBeLessThanOrEqual(BODY_SHOT_RANGE)
  })
})

describe('manager da sala e remoção da chamada (#22775)', () => {
  let hub: OfficeHub

  beforeEach(() => {
    hub = new OfficeHub()
    hub.configure(legacyOfficeRuntimeFixture())
  })

  /** Runtime igual ao legado, mas com uma mesa reivindicada dentro da Sala 1. */
  function runtimeWithClaimedDesk(owner: { id: string; name: string }): ActiveOfficeMapDTO {
    const runtime = legacyOfficeRuntimeFixture()
    const tileSize = 32
    runtime.document.objects.push({
      id: 'desk-sala1',
      layerKey: 'desks',
      type: 'desk',
      // Dentro do retângulo da Sala 1 (x0=17,y0=11 → x1=23,y1=12).
      geometry: { kind: 'rectangle', x: 19 * tileSize, y: 11 * tileSize, width: tileSize, height: tileSize },
      properties: { externalKey: 'mesa-sala1', name: 'Mesa da Sala 1' },
    })
    runtime.desks = [
      { id: 'desk-sala1', name: 'Mesa da Sala 1', externalKey: 'mesa-sala1', claimedBy: { id: owner.id, name: owner.name } },
    ]
    return runtime
  }

  function managersFrom(sent: OfficeServerMessage[]) {
    return sent.filter((m): m is Extract<OfficeServerMessage, { type: 'room-managers-changed' }> =>
      m.type === 'room-managers-changed',
    )
  }

  it('sala sem dono de mesa: manda quem entrou primeiro', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)

    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)

    expect(hub.managerOf(ROOM1_ID)).toEqual({ roomId: ROOM1_ID, userId: 'ana', byDeskOwner: false })
  })

  it('manager sai: passa para o próximo na ordem de entrada, não para quem chegou por último', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    const c = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    hub.join(c.socket, carla)

    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)
    walkTo(hub, c.socket, 'carla', ROOM1_INSIDE)
    expect(hub.managerOf(ROOM1_ID)?.userId).toBe('ana')

    walkTo(hub, a.socket, 'ana', ROOM1_OUTSIDE)

    expect(hub.managerOf(ROOM1_ID)?.userId).toBe('bruno')
  })

  it('sala vazia não tem manager', () => {
    const a = fakeSocket()
    hub.join(a.socket, ana)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
    expect(hub.managerOf(ROOM1_ID)).not.toBeNull()

    walkTo(hub, a.socket, 'ana', ROOM1_OUTSIDE)

    expect(hub.managerOf(ROOM1_ID)).toBeNull()
  })

  it('sala com mesa reivindicada: manda o dono da mesa, mesmo entrando depois', () => {
    hub = new OfficeHub()
    hub.configure(runtimeWithClaimedDesk(bruno))
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)

    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE) // chega primeiro
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE) // dono da mesa, chega depois

    expect(hub.managerOf(ROOM1_ID)).toEqual({ roomId: ROOM1_ID, userId: 'bruno', byDeskOwner: true })
  })

  it('dono da mesa fora da sala: manda quem está lá dentro', () => {
    hub = new OfficeHub()
    hub.configure(runtimeWithClaimedDesk(bruno))
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno) // dono nunca entra

    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)

    expect(hub.managerOf(ROOM1_ID)).toEqual({ roomId: ROOM1_ID, userId: 'ana', byDeskOwner: false })
  })

  it('avisa o escritório quando o manager muda, e só quando muda', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)

    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
    const depoisDaEntrada = managersFrom(b.sent).length
    expect(managersFrom(b.sent).at(-1)?.managers).toEqual([
      { roomId: ROOM1_ID, userId: 'ana', byDeskOwner: false },
    ])

    // Bruno entra: o manager continua sendo a Ana, então ninguém precisa saber.
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)
    expect(managersFrom(b.sent)).toHaveLength(depoisDaEntrada)

    walkTo(hub, a.socket, 'ana', ROOM1_OUTSIDE)
    expect(managersFrom(b.sent).at(-1)?.managers).toEqual([
      { roomId: ROOM1_ID, userId: 'bruno', byDeskOwner: false },
    ])
  })

  it('manager remove alguém: sai da chamada e continua no mapa, onde estava', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)
    const antes = hub.occupants().find((o) => o.userId === 'bruno')!

    const removed = hub.removeFromRoom(a.socket, 'ana', 'bruno')

    expect(removed).toMatchObject({ roomId: ROOM1_ID, targetUserId: 'bruno' })
    expect(hub.isRemovedFromRoom('bruno', ROOM1_ID)).toBe(true)
    // Continua no escritório, na MESMA posição: a remoção é só da chamada.
    const depois = hub.occupants().find((o) => o.userId === 'bruno')!
    expect({ x: depois.x, y: depois.y }).toEqual({ x: antes.x, y: antes.y })
    expect(b.sent).toContainEqual(
      expect.objectContaining({ type: 'removed-from-room', roomId: ROOM1_ID, userId: 'bruno', byUserId: 'ana' }),
    )
  })

  it('quem não é manager não remove ninguém', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE) // Ana é a manager
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)

    expect(hub.removeFromRoom(b.socket, 'bruno', 'ana')).toBeNull()
    expect(hub.isRemovedFromRoom('ana', ROOM1_ID)).toBe(false)
  })

  it('ADMIN remove mesmo sem ser manager', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)

    expect(hub.removeFromRoom(b.socket, 'bruno', 'ana', { isAdmin: true })).not.toBeNull()
    expect(hub.isRemovedFromRoom('ana', ROOM1_ID)).toBe(true)
  })

  it('não remove quem está em outra sala nem a si mesmo', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
    walkTo(hub, b.socket, 'bruno', ROOM1_OUTSIDE) // fora da sala

    expect(hub.removeFromRoom(a.socket, 'ana', 'bruno')).toBeNull()
    expect(hub.removeFromRoom(a.socket, 'ana', 'ana')).toBeNull()
  })

  it('a marca só sai quando a pessoa sai da área da sala', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)
    hub.removeFromRoom(a.socket, 'ana', 'bruno')

    // Andar DENTRO da sala não devolve a chamada.
    hub.__walkForTest(b.socket, 'bruno', 'left')
    expect(hub.isRemovedFromRoom('bruno', ROOM1_ID)).toBe(true)

    walkTo(hub, b.socket, 'bruno', ROOM1_OUTSIDE)
    expect(hub.isRemovedFromRoom('bruno', ROOM1_ID)).toBe(false)

    // E entrar de novo vale normalmente.
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE)
    expect(hub.isRemovedFromRoom('bruno', ROOM1_ID)).toBe(false)
  })

  it('remover não tira a pessoa da fila de manager da sala', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana)
    hub.join(b.socket, bruno)
    walkTo(hub, b.socket, 'bruno', ROOM1_INSIDE) // Bruno entra primeiro: é o manager
    walkTo(hub, a.socket, 'ana', ROOM1_INSIDE)

    hub.removeFromRoom(b.socket, 'bruno', 'ana')

    // Ana continua na sala (só perdeu a chamada), então a fila não muda.
    expect(hub.managerOf(ROOM1_ID)?.userId).toBe('bruno')
  })
})

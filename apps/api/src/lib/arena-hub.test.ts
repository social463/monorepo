import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  BODY_MAX_PENDING_INPUTS,
  BODY_MAX_STEP_MS,
  BODY_SPEED,
  BODY_TICK_HZ,
  ARENA_INTERMISSION_MS,
  BODY_SHOT_COOLDOWN_MS,
  BODY_TIME_BUDGET_CAP_MS,
  ARENA_RESPAWN_MS,
  ARENA_SPAWN_PROTECTION_MS,
  ARENA_SCORE_LIMIT,
  ARENA_MATCH_MS,
  ARENA_FLAG_RETURN_MS,
  ARENA_FLAG_SCORE_LIMIT,
  ARENA_MAX_HITS,
  ARENA_HIT_RECOVERY_MS,
  ROOM_CHAT_MESSAGE_MAX_LENGTH,
  BODY_BALL_KICK_SPEED,
  BODY_BALL_PASS_SPEED,
  BODY_BALL_SPRINT_KICK_SPEED,
  ARENA_SOCCER_KICKOFF_MS,
  ARENA_RACE_COUNTDOWN_MS,
  ARENA_RACE_FINISH_GRACE_MS,
  ARENA_RACE_LAPS,
  RACE_TRACK,
  SOCCER_FIELD,
  arenaDocumentFor,
  soccerKickoffSpot,
  mapSpawnTiles,
  arenaMapDocument,
  createEmptyMapDocumentV1,
  type ArenaServerMessage,
  type ArenaRaceSnapshot,
  type MapDocumentV1,
} from '@legends/shared'
import { ArenaHub, __resetArenaHubs, getArenaHub, type ArenaSocket } from './arena-hub'

const TICK_MS = Math.round(1000 / BODY_TICK_HZ)

function fakeSocket() {
  const sent: ArenaServerMessage[] = []
  const socket: ArenaSocket = { send: (data: string) => void sent.push(JSON.parse(data)) }
  return { socket, sent }
}

function room(): MapDocumentV1 {
  const document = createEmptyMapDocumentV1({ width: 20, height: 20, tileSize: 32 })
  const spawn = document.objects.find((object) => object.type === 'spawn-point')
  if (spawn && spawn.geometry.kind === 'point') {
    spawn.geometry.x = 5 * 32
    spawn.geometry.y = 5 * 32
  }
  return document
}

const ana = { id: 'ana', name: 'Ana', avatarSeed: null, avatarOptions: null }
const bruno = { id: 'bruno', name: 'Bruno', avatarSeed: null, avatarOptions: null }
const carla = { id: 'carla', name: 'Carla', avatarSeed: null, avatarOptions: null }

let hub: ArenaHub

beforeEach(() => {
  __resetArenaHubs()
  hub = new ArenaHub()
  hub.configure(room())
})
afterEach(() => vi.useRealTimers())

const snapshots = (sent: ArenaServerMessage[]) => sent.filter((m) => m.type === 'snapshot')

describe('ciclo do loop', () => {
  // A objeção que derrubou o loop de tick na bola era timer OCIOSO por
  // empresa, não o loop em si. Arena vazia não pode custar nada.
  it('o tick nasce no primeiro que entra e morre quando esvazia', () => {
    vi.useFakeTimers()
    const a = fakeSocket()

    expect(hub.isRunning()).toBe(false)
    hub.join(a.socket, ana, 'arena-1')
    expect(hub.isRunning()).toBe(true)

    hub.leave(a.socket, 'ana')
    expect(hub.isRunning()).toBe(false)
  })

  it('outra aba da mesma pessoa não cria segundo jogador, e sair de uma não tira do campo', () => {
    vi.useFakeTimers()
    const a1 = fakeSocket()
    const a2 = fakeSocket()
    hub.join(a1.socket, ana, 'arena-1')
    hub.join(a2.socket, ana, 'arena-1')

    expect(hub.size()).toBe(1)
    hub.leave(a1.socket, 'ana')
    expect(hub.size()).toBe(1)
    hub.leave(a2.socket, 'ana')
    expect(hub.size()).toBe(0)
  })

  it('dois que entram nascem em pontos diferentes', () => {
    vi.useFakeTimers()
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana, 'arena-1')
    hub.join(b.socket, bruno, 'arena-1')

    const [um, dois] = hub.players()
    expect(Math.hypot(um.x - dois.x, um.y - dois.y)).toBeGreaterThan(0)
  })

  it('welcome traz quem já está lá; joined avisa os demais', () => {
    vi.useFakeTimers()
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana, 'arena-1')
    a.sent.length = 0
    hub.join(b.socket, bruno, 'arena-1')

    const welcome = b.sent.find((m) => m.type === 'welcome')
    expect(welcome).toMatchObject({ type: 'welcome', youId: 'bruno', arenaId: 'arena-1' })
    expect((welcome as { players: unknown[] }).players).toHaveLength(2)
    expect(a.sent).toContainEqual(expect.objectContaining({ type: 'joined' }))
  })
})

describe('simulação', () => {
  it('o input move o jogador e o snapshot devolve o último seq processado', () => {
    vi.useFakeTimers()
    const a = fakeSocket()
    hub.join(a.socket, ana, 'arena-1')
    const inicio = hub.players()[0]
    a.sent.length = 0

    hub.applyInput(a.socket, 'ana', { seq: 1, dx: 1, dy: 0, dtMs: 40 })
    vi.advanceTimersByTime(TICK_MS * 3)

    const jogador = hub.players()[0]
    expect(jogador.x).toBeGreaterThan(inicio.x)
    expect(jogador.dir).toBe('right')
    expect(snapshots(a.sent).at(-1)).toMatchObject({
      players: [expect.objectContaining({ userId: 'ana', seq: 1 })],
    })
  })

  it('snapshot sai a cada N ticks, não a cada tick', () => {
    vi.useFakeTimers()
    const a = fakeSocket()
    hub.join(a.socket, ana, 'arena-1')
    a.sent.length = 0

    vi.advanceTimersByTime(TICK_MS * 8)

    const contagem = snapshots(a.sent).length
    expect(contagem).toBeGreaterThan(0)
    expect(contagem).toBeLessThan(8)
  })

  it('input fora de ordem (seq velho) é ignorado', () => {
    vi.useFakeTimers()
    const a = fakeSocket()
    hub.join(a.socket, ana, 'arena-1')

    hub.applyInput(a.socket, 'ana', { seq: 5, dx: 1, dy: 0, dtMs: 40 })
    vi.advanceTimersByTime(TICK_MS * 2)
    const depois = hub.players()[0].x

    hub.applyInput(a.socket, 'ana', { seq: 2, dx: -1, dy: 0, dtMs: 40 })
    vi.advanceTimersByTime(TICK_MS * 2)

    expect(hub.players()[0].x).toBe(depois)
  })

  it('ignora input de socket cujo dono não bate com o userId (anti-spoof)', () => {
    vi.useFakeTimers()
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana, 'arena-1')
    hub.join(b.socket, bruno, 'arena-1')
    const antes = hub.players().find((p) => p.userId === 'ana')?.x

    hub.applyInput(b.socket, 'ana', { seq: 1, dx: 1, dy: 0, dtMs: 40 })
    vi.advanceTimersByTime(TICK_MS * 2)

    expect(hub.players().find((p) => p.userId === 'ana')?.x).toBe(antes)
  })
})

describe('orçamento de tempo (o dtMs vem do cliente)', () => {
  // Cliente que escolhe o próprio `dt` escolheria a própria velocidade. O
  // servidor credita pelo relógio dele e debita por input aplicado.
  it('mandar mais tempo do que se viveu não compra velocidade', () => {
    vi.useFakeTimers()
    const honesto = fakeSocket()
    const trapaceiro = fakeSocket()
    hub.join(honesto.socket, ana, 'arena-1')
    hub.join(trapaceiro.socket, bruno, 'arena-1')
    const inicio = hub.players()[0].x

    // O honesto manda um input por tick; o trapaceiro enche a fila.
    for (let i = 0; i < 20; i += 1) {
      hub.applyInput(honesto.socket, 'ana', { seq: i + 1, dx: 1, dy: 0, dtMs: TICK_MS })
      for (let k = 0; k < 5; k += 1) {
        hub.applyInput(trapaceiro.socket, 'bruno', {
          seq: i * 5 + k + 1,
          dx: 1,
          dy: 0,
          dtMs: BODY_MAX_STEP_MS,
        })
      }
      vi.advanceTimersByTime(TICK_MS)
    }

    const andouHonesto = hub.players().find((p) => p.userId === 'ana')!.x - inicio
    const andouTrapaceiro = hub.players().find((p) => p.userId === 'bruno')!.x - inicio
    // O banco tolera jitter, então não é empate exato — mas a vantagem é
    // limitada pelo teto, e não proporcional ao spam.
    const vantagemMaxima = (BODY_SPEED * BODY_TIME_BUDGET_CAP_MS) / 1000
    expect(andouTrapaceiro - andouHonesto).toBeLessThanOrEqual(vantagemMaxima + 1)
  })

  it('a fila tem teto e descarta o input mais antigo, não o mais novo', () => {
    vi.useFakeTimers()
    const a = fakeSocket()
    hub.join(a.socket, ana, 'arena-1')

    for (let i = 0; i < BODY_MAX_PENDING_INPUTS + 5; i += 1) {
      hub.applyInput(a.socket, 'ana', { seq: i + 1, dx: 1, dy: 0, dtMs: 10 })
    }
    vi.advanceTimersByTime(TICK_MS * 4)

    // Sobrou o seq mais ALTO: segurar os velhos deixaria o jogador andando no
    // passado até a fila drenar.
    const snapshot = snapshots(a.sent).at(-1) as { players: { seq: number }[] }
    expect(snapshot.players[0].seq).toBe(BODY_MAX_PENDING_INPUTS + 5)
  })
})

describe('getArenaHub', () => {
  it('uma instância por empresa e arena', () => {
    expect(getArenaHub('emr', 'a')).toBe(getArenaHub('emr', 'a'))
    expect(getArenaHub('emr', 'a')).not.toBe(getArenaHub('emr', 'b'))
    expect(getArenaHub('emr', 'a')).not.toBe(getArenaHub('outra', 'a'))
  })
})

describe('partida (mata-mata por times)', () => {
  const TICK = Math.round(1000 / BODY_TICK_HZ)

  /** Põe dois adversários frente a frente, a `distancia` px um do outro. */
  function duelo(distancia = 40) {
    vi.useFakeTimers()
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana, 'arena-1')
    hub.join(b.socket, bruno, 'arena-1')
    const [pa, pb] = hub.players()
    // Times opostos (o balanceamento manda um para cada lado).
    expect(pa.team).not.toBe(pb.team)
    // Coloca B na frente de A, a leste.
    hub.__moveForTest(pb.userId, pa.x + distancia, pa.y)
    // A carência de entrada precisa expirar antes de valer tiro.
    vi.advanceTimersByTime(ARENA_SPAWN_PROTECTION_MS + TICK)
    a.sent.length = 0
    b.sent.length = 0
    return { a, b, atirador: pa.userId, alvo: pb.userId }
  }

  it('quem entra é distribuído entre os dois times', () => {
    vi.useFakeTimers()
    const sockets = [ana, bruno, carla].map((user) => {
      const s = fakeSocket()
      hub.join(s.socket, user, 'arena-1')
      return s
    })
    expect(sockets).toHaveLength(3)

    const times = hub.players().map((p) => p.team)
    expect(times.filter((t) => t === 'oeste').length).toBeGreaterThan(0)
    expect(times.filter((t) => t === 'leste').length).toBeGreaterThan(0)
  })

  /** Dispara `n` vezes respeitando a cadência. */
  function atirarVezes(sock: ReturnType<typeof fakeSocket>, quem: string, n: number) {
    for (let i = 0; i < n; i += 1) {
      hub.fire(sock.socket, quem, 0)
      vi.advanceTimersByTime(BODY_SHOT_COOLDOWN_MS + TICK)
    }
  }

  it('os primeiros tiros só marcam dano; o último é que abate', () => {
    const { a, b, atirador, alvo } = duelo()

    atirarVezes(a, atirador, ARENA_MAX_HITS - 1)
    expect(b.sent.some((m) => m.type === 'downed')).toBe(false)
    expect(b.sent.filter((m) => m.type === 'hit')).toHaveLength(ARENA_MAX_HITS - 1)
    expect(Object.values(hub.matchState().scores).reduce((x, y) => x + y, 0)).toBe(0)

    hub.fire(a.socket, atirador, 0)
    vi.advanceTimersByTime(TICK)

    expect(b.sent).toContainEqual(expect.objectContaining({ type: 'downed', userId: alvo }))
    expect(Object.values(hub.matchState().scores).reduce((x, y) => x + y, 0)).toBe(1)
  })

  // Recuar e esperar é jogada legítima — é o que dá função ao mapa ter
  // esconderijo. Sem isso, quem levou dois tiros só se cura morrendo.
  it('quem se afasta o bastante recupera o dano', () => {
    const { a, b, atirador } = duelo()

    atirarVezes(a, atirador, ARENA_MAX_HITS - 1)
    vi.advanceTimersByTime(ARENA_HIT_RECOVERY_MS * ARENA_MAX_HITS)
    b.sent.length = 0

    // Recuperado: volta a precisar da conta inteira para cair.
    atirarVezes(a, atirador, ARENA_MAX_HITS - 1)
    expect(b.sent.some((m) => m.type === 'downed')).toBe(false)
  })

  it('acertar um adversário abate, pontua e avisa a arena', () => {
    const { a, b, atirador, alvo } = duelo()

    atirarVezes(a, atirador, ARENA_MAX_HITS)

    expect(b.sent).toContainEqual(expect.objectContaining({ type: 'downed', userId: alvo, byUserId: atirador }))
    const snapshot = b.sent.filter((m) => m.type === 'snapshot').at(-1) as {
      players: { userId: string; downMs?: number }[]
      match: { scores: Record<string, number> }
    }
    expect(snapshot.players.find((p) => p.userId === alvo)?.downMs).toBeGreaterThan(0)
    expect(Object.values(snapshot.match.scores).reduce((x, y) => x + y, 0)).toBe(1)
  })

  // Punir quem passou na frente do colega transforma equipe em armadilha.
  it('fogo amigo não abate nem pontua', () => {
    vi.useFakeTimers()
    const a = fakeSocket()
    const b = fakeSocket()
    const c = fakeSocket()
    hub.join(a.socket, ana, 'arena-1')
    hub.join(b.socket, bruno, 'arena-1')
    hub.join(c.socket, carla, 'arena-1')
    const jogadores = hub.players()
    const ataca = jogadores[0]
    const colega = jogadores.find((p) => p.userId !== ataca.userId && p.team === ataca.team)
    expect(colega).toBeDefined()
    hub.__moveForTest(colega!.userId, ataca.x + 40, ataca.y)
    vi.advanceTimersByTime(ARENA_SPAWN_PROTECTION_MS + TICK)
    c.sent.length = 0

    hub.fire(a.socket, ataca.userId, 0)
    vi.advanceTimersByTime(TICK)

    expect(c.sent.some((m) => m.type === 'downed')).toBe(false)
    const snapshot = c.sent.filter((m) => m.type === 'snapshot').at(-1) as {
      match: { scores: Record<string, number> }
    }
    expect(Object.values(snapshot.match.scores).reduce((x, y) => x + y, 0)).toBe(0)
  })

  it('abatido não anda e não atira, e volta depois do tempo', () => {
    const { a, b, atirador, alvo } = duelo()
    atirarVezes(a, atirador, ARENA_MAX_HITS)
    const caido = hub.players().find((p) => p.userId === alvo)!

    // Tenta andar e atirar enquanto está fora.
    hub.applyInput(b.socket, alvo, { seq: 99, dx: -1, dy: 0, dtMs: 33 })
    hub.fire(b.socket, alvo, Math.PI)
    vi.advanceTimersByTime(TICK * 3)
    expect(hub.players().find((p) => p.userId === alvo)).toMatchObject({ x: caido.x, y: caido.y })

    // Passado o tempo, renasce na base do time.
    vi.advanceTimersByTime(ARENA_RESPAWN_MS + TICK * 2)
    const voltou = hub.players().find((p) => p.userId === alvo)!
    expect(voltou.x).not.toBe(caido.x)
  })

  // Sem carência, quem espera na base do adversário abate no quadro em que a
  // pessoa volta, e o jogo vira fila de execução.
  it('quem renasce tem carência antes de poder ser abatido de novo', () => {
    const { a, atirador, alvo } = duelo()
    atirarVezes(a, atirador, ARENA_MAX_HITS)
    vi.advanceTimersByTime(ARENA_RESPAWN_MS + TICK * 2)

    // Encosta de novo e atira imediatamente.
    const alvoAgora = hub.players().find((p) => p.userId === alvo)!
    hub.__moveForTest(atirador, alvoAgora.x - 40, alvoAgora.y)
    vi.advanceTimersByTime(BODY_SHOT_COOLDOWN_MS + TICK)
    const antes = hub.matchState().scores

    hub.fire(a.socket, atirador, 0)
    vi.advanceTimersByTime(TICK)

    expect(hub.matchState().scores).toEqual(antes)
  })

  it('a partida acaba no limite de pontos e abre intervalo', () => {
    const { a, atirador, alvo } = duelo()

    for (let i = 0; i < ARENA_SCORE_LIMIT; i += 1) {
      const alvoAgora = hub.players().find((p) => p.userId === alvo)!
      hub.__moveForTest(atirador, alvoAgora.x - 40, alvoAgora.y)
      vi.advanceTimersByTime(ARENA_SPAWN_PROTECTION_MS + BODY_SHOT_COOLDOWN_MS + TICK)
      atirarVezes(a, atirador, ARENA_MAX_HITS)
      vi.advanceTimersByTime(ARENA_RESPAWN_MS + TICK * 2)
    }

    expect(hub.matchState().phase).toBe('intervalo')
    expect(a.sent.some((m) => m.type === 'match-ended')).toBe(true)
  })

  it('a partida acaba no tempo e recomeça sozinha depois do intervalo', () => {
    const { a } = duelo()

    vi.advanceTimersByTime(ARENA_MATCH_MS + TICK)
    expect(hub.matchState().phase).toBe('intervalo')

    vi.advanceTimersByTime(ARENA_INTERMISSION_MS + TICK)
    expect(hub.matchState().phase).toBe('jogando')
    expect(hub.matchState().scores).toEqual({ oeste: 0, leste: 0 })
    expect(a.sent.some((m) => m.type === 'match-started')).toBe(true)
  })

  it('arena esvaziando zera a partida — o próximo não herda placar alheio', () => {
    const { a, b, atirador, alvo } = duelo()
    atirarVezes(a, atirador, ARENA_MAX_HITS)
    expect(Object.values(hub.matchState().scores).reduce((x, y) => x + y, 0)).toBe(1)

    hub.leave(a.socket, atirador)
    hub.leave(b.socket, alvo)
    const c = fakeSocket()
    hub.join(c.socket, carla, 'arena-1')
    vi.advanceTimersByTime(TICK)

    expect(hub.matchState().scores).toEqual({ oeste: 0, leste: 0 })
  })
})

describe('pegue a bandeira', () => {
  const TICK = Math.round(1000 / BODY_TICK_HZ)

  /** Onde ficam as bases, no mapa gerado da arena. */
  function bases() {
    const doc = arenaMapDocument()
    const t = doc.map.tileWidth
    const [oeste, leste] = mapSpawnTiles(doc)
    return {
      oeste: { x: oeste.x * t + t / 2, y: oeste.y * t + t / 2 },
      leste: { x: leste.x * t + t / 2, y: leste.y * t + t / 2 },
    }
  }

  function partidaDeBandeira() {
    vi.useFakeTimers()
    hub.configure(arenaMapDocument(), 'bandeira')
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana, 'bandeira')
    hub.join(b.socket, bruno, 'bandeira')
    const [pa, pb] = hub.players()
    return { a, b, pa, pb, base: bases() }
  }

  const flagsDe = (sock: ReturnType<typeof fakeSocket>) =>
    (sock.sent.filter((m) => m.type === 'snapshot').at(-1) as { flags?: Record<string, { at: string }> })?.flags

  it('o modo vem da instância e aparece no estado da partida', () => {
    partidaDeBandeira()
    expect(hub.matchState().mode).toBe('bandeira')
  })

  // `configure` roda a cada conexão; sem guarda, o segundo a entrar trocaria o
  // modo no meio da partida de quem já estava dentro.
  it('quem entra depois não muda o modo', () => {
    const { b } = partidaDeBandeira()
    expect(b).toBeDefined()

    hub.configure(arenaMapDocument(), 'mata-mata')

    expect(hub.matchState().mode).toBe('bandeira')
  })

  it('encostar na bandeira adversária a pega', () => {
    const { a, pa, base } = partidaDeBandeira()
    const adversaria = pa.team === 'oeste' ? 'leste' : 'oeste'
    hub.__moveForTest(pa.userId, base[adversaria].x, base[adversaria].y)
    vi.advanceTimersByTime(TICK * 2)

    expect(a.sent).toContainEqual(
      expect.objectContaining({ type: 'flag', kind: 'pegou', team: adversaria, userId: pa.userId }),
    )
    expect(flagsDe(a)?.[adversaria]).toMatchObject({ at: 'carregada', byUserId: pa.userId })
  })

  it('levar a bandeira até a própria base pontua', () => {
    const { a, pa, base } = partidaDeBandeira()
    const adversaria = pa.team === 'oeste' ? 'leste' : 'oeste'
    hub.__moveForTest(pa.userId, base[adversaria].x, base[adversaria].y)
    vi.advanceTimersByTime(TICK * 2)
    hub.__moveForTest(pa.userId, base[pa.team].x, base[pa.team].y)
    vi.advanceTimersByTime(TICK * 2)

    expect(hub.matchState().scores[pa.team]).toBe(1)
    expect(flagsDe(a)?.[adversaria]).toMatchObject({ at: 'base' })
  })

  // É o que dá sentido a atirar em quem está fugindo com a bandeira.
  it('quem é abatido carregando derruba a bandeira onde caiu', () => {
    const { a, b, pa, pb, base } = partidaDeBandeira()
    const adversaria = pa.team === 'oeste' ? 'leste' : 'oeste'
    hub.__moveForTest(pa.userId, base[adversaria].x, base[adversaria].y)
    vi.advanceTimersByTime(TICK * 2)

    // B encosta em A e atira nele.
    vi.advanceTimersByTime(ARENA_SPAWN_PROTECTION_MS + TICK)
    hub.__moveForTest(pb.userId, base[adversaria].x - 40, base[adversaria].y)
    vi.advanceTimersByTime(TICK)
    for (let i = 0; i < ARENA_MAX_HITS; i += 1) {
      hub.fire(b.socket, pb.userId, 0)
      vi.advanceTimersByTime(BODY_SHOT_COOLDOWN_MS + TICK)
    }

    expect(a.sent).toContainEqual(expect.objectContaining({ type: 'flag', kind: 'caiu', team: adversaria }))
    expect(flagsDe(a)?.[adversaria]).toMatchObject({ at: 'caida' })
  })

  // Bandeira largada num canto travaria a partida: o dono não pontua e o
  // adversário não precisa buscar.
  it('bandeira caída volta sozinha para casa', () => {
    const { a, b, pa, pb, base } = partidaDeBandeira()
    const adversaria = pa.team === 'oeste' ? 'leste' : 'oeste'
    hub.__moveForTest(pa.userId, base[adversaria].x, base[adversaria].y)
    vi.advanceTimersByTime(TICK * 2)
    vi.advanceTimersByTime(ARENA_SPAWN_PROTECTION_MS + TICK)
    hub.__moveForTest(pb.userId, base[adversaria].x - 40, base[adversaria].y)
    vi.advanceTimersByTime(TICK)
    for (let i = 0; i < ARENA_MAX_HITS; i += 1) {
      hub.fire(b.socket, pb.userId, 0)
      vi.advanceTimersByTime(BODY_SHOT_COOLDOWN_MS + TICK)
    }
    expect(flagsDe(a)?.[adversaria]).toMatchObject({ at: 'caida' })

    vi.advanceTimersByTime(ARENA_FLAG_RETURN_MS + TICK * 2)

    expect(flagsDe(a)?.[adversaria]).toMatchObject({ at: 'base' })
    expect(a.sent).toContainEqual(expect.objectContaining({ type: 'flag', kind: 'voltou', team: adversaria }))
  })

  // Sumir com a bandeira travaria a partida para sempre.
  it('sair da arena carregando derruba a bandeira', () => {
    const { a, pa, base } = partidaDeBandeira()
    const adversaria = pa.team === 'oeste' ? 'leste' : 'oeste'
    hub.__moveForTest(pa.userId, base[adversaria].x, base[adversaria].y)
    vi.advanceTimersByTime(TICK * 2)

    hub.leave(a.socket, pa.userId)

    expect(hub.players()).toHaveLength(1)
  })

  it('a partida de bandeira acaba com menos pontos que a de mata-mata', () => {
    partidaDeBandeira()
    expect(ARENA_FLAG_SCORE_LIMIT).toBeLessThan(ARENA_SCORE_LIMIT)
  })
})

describe('chat da arena', () => {
  it('chega a todos MENOS a quem escreveu', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana, 'mata-mata')
    hub.join(b.socket, bruno, 'mata-mata')

    hub.chat(a.socket, 'ana', 'cobre a base')

    expect(b.sent.filter((m) => m.type === 'chat')).toMatchObject([
      { userId: 'ana', name: 'Ana', text: 'cobre a base' },
    ])
    expect(a.sent.some((m) => m.type === 'chat')).toBe(false)
  })

  it('vai para a arena inteira, sem recorte por distância', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana, 'mata-mata')
    hub.join(b.socket, bruno, 'mata-mata')
    // Longe o bastante para a voz não alcançar — o texto continua chegando.
    hub.__moveForTest('ana', 32, 32)
    hub.__moveForTest('bruno', 600, 600)

    hub.chat(a.socket, 'ana', 'alguém no meio?')

    expect(b.sent.some((m) => m.type === 'chat')).toBe(true)
  })

  it('descarta vazio, corta no limite e ignora socket de outra pessoa', () => {
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana, 'mata-mata')
    hub.join(b.socket, bruno, 'mata-mata')

    hub.chat(a.socket, 'ana', '  \n ')
    expect(b.sent.some((m) => m.type === 'chat')).toBe(false)

    hub.chat(a.socket, 'bruno', 'não sou eu')
    expect(b.sent.some((m) => m.type === 'chat')).toBe(false)

    hub.chat(a.socket, 'ana', 'y'.repeat(ROOM_CHAT_MESSAGE_MAX_LENGTH + 10))
    const chat = b.sent.find((m) => m.type === 'chat')
    expect(chat?.type === 'chat' && chat.text.length).toBe(ROOM_CHAT_MESSAGE_MAX_LENGTH)
  })

  it('`nameOf` só devolve nome de quem está dentro — é a credencial do token', () => {
    const a = fakeSocket()
    expect(hub.nameOf('ana')).toBeNull()
    hub.join(a.socket, ana, 'mata-mata')
    expect(hub.nameOf('ana')).toBe('Ana')
    hub.leave(a.socket, 'ana')
    expect(hub.nameOf('ana')).toBeNull()
  })
})

describe('futebol', () => {
  const TICK = Math.round(1000 / BODY_TICK_HZ)
  const centro = soccerKickoffSpot()

  function partidaDeFutebol() {
    vi.useFakeTimers()
    hub.configure(arenaDocumentFor('futebol'), 'futebol')
    const a = fakeSocket()
    const b = fakeSocket()
    hub.join(a.socket, ana, 'futebol')
    hub.join(b.socket, bruno, 'futebol')
    const [pa, pb] = hub.players()
    return { a, b, pa, pb }
  }

  const bolaDe = (sock: ReturnType<typeof fakeSocket>) =>
    (snapshots(sock.sent).at(-1) as { ball?: { x: number; y: number; vx: number; vy: number; lockedMs?: number } })
      ?.ball

  it('a partida começa com a bola no meio e travada — é a saída de bola', () => {
    const { a } = partidaDeFutebol()
    const welcome = a.sent.find((m) => m.type === 'welcome') as { ball?: { x: number; lockedMs?: number } }
    expect(welcome.ball).toMatchObject({ x: centro.x, vx: 0, vy: 0 })
    expect(welcome.ball?.lockedMs).toBeGreaterThan(0)

    // Travada é travada: ela não anda enquanto a saída não sai.
    vi.advanceTimersByTime(TICK * 4)
    expect(bolaDe(a)).toMatchObject({ x: centro.x, y: centro.y })
  })

  it('chutar de perto manda a bola no ângulo mirado', () => {
    const { a, pa } = partidaDeFutebol()
    vi.advanceTimersByTime(ARENA_SOCCER_KICKOFF_MS + TICK)
    hub.__moveForTest(pa.userId, centro.x - 12, centro.y)
    hub.kick(a.socket, pa.userId, 0)

    expect(a.sent).toContainEqual(
      expect.objectContaining({ type: 'kick', userId: pa.userId, strong: false }),
    )
    vi.advanceTimersByTime(TICK * 2)
    const bola = bolaDe(a)
    expect(bola!.x).toBeGreaterThan(centro.x)
    expect(bola!.vx).toBeGreaterThan(0)
    expect(bola!.vx).toBeLessThanOrEqual(BODY_BALL_KICK_SPEED)
  })

  // A força nunca viaja no fio: sai do `sprint` do último input processado.
  it('quem está correndo chuta mais forte, e a força não vem do cliente', () => {
    const { a, pa } = partidaDeFutebol()
    vi.advanceTimersByTime(ARENA_SOCCER_KICKOFF_MS + TICK)
    hub.applyInput(a.socket, pa.userId, { seq: 1, dx: 1, dy: 0, dtMs: 16, sprint: true })
    vi.advanceTimersByTime(TICK)
    hub.__moveForTest(pa.userId, centro.x - 12, centro.y)
    hub.kick(a.socket, pa.userId, 0)

    const chute = a.sent.filter((m) => m.type === 'kick').at(-1) as {
      strong: boolean
      ball: { vx: number }
    }
    expect(chute.strong).toBe(true)
    expect(chute.ball.vx).toBeCloseTo(BODY_BALL_SPRINT_KICK_SPEED, 5)
  })

  // Um jogo com um chute só é um jogo de chutão: sem passe, não há como
  // deixar a bola para quem está três tiles ao lado.
  it('o passe sai mais fraco que o chute, e a corrida não o transforma em chutão', () => {
    const { a, pa } = partidaDeFutebol()
    vi.advanceTimersByTime(ARENA_SOCCER_KICKOFF_MS + TICK)
    hub.applyInput(a.socket, pa.userId, { seq: 1, dx: 1, dy: 0, dtMs: 16, sprint: true })
    vi.advanceTimersByTime(TICK)
    hub.__moveForTest(pa.userId, centro.x - 12, centro.y)
    hub.kick(a.socket, pa.userId, 0, 'passe')

    const passe = a.sent.filter((m) => m.type === 'kick').at(-1) as {
      power: string
      strong: boolean
      ball: { vx: number }
    }
    expect(passe.power).toBe('passe')
    expect(passe.strong).toBe(false)
    expect(passe.ball.vx).toBeCloseTo(BODY_BALL_PASS_SPEED, 5)
    expect(passe.ball.vx).toBeLessThan(BODY_BALL_KICK_SPEED)
  })

  it('chutar de longe não move nada', () => {
    const { a, pa } = partidaDeFutebol()
    vi.advanceTimersByTime(ARENA_SOCCER_KICKOFF_MS + TICK)
    hub.__moveForTest(pa.userId, centro.x - 300, centro.y)
    hub.kick(a.socket, pa.userId, 0)

    expect(a.sent.filter((m) => m.type === 'kick')).toHaveLength(0)
  })

  // Esconder o botão não basta: um cliente adulterado atirando aqui não
  // encontraria nenhuma defesa pela frente (sem vida, sem abate, sem carência).
  it('no futebol não se atira, e a recusa é do servidor', () => {
    const { a, b, pa, pb } = partidaDeFutebol()
    vi.advanceTimersByTime(ARENA_SOCCER_KICKOFF_MS + TICK)
    hub.__moveForTest(pa.userId, centro.x, centro.y)
    hub.__moveForTest(pb.userId, centro.x + 40, centro.y)
    hub.fire(a.socket, pa.userId, 0)

    expect(a.sent.filter((m) => m.type === 'shot')).toHaveLength(0)
    expect(b.sent.filter((m) => m.type === 'downed')).toHaveLength(0)
    expect(hub.matchState().scores).toEqual({ oeste: 0, leste: 0 })
  })

  it('cruzar a linha é gol do outro time, e a bola volta travada para o meio', () => {
    const { a, pa } = partidaDeFutebol()
    vi.advanceTimersByTime(ARENA_SOCCER_KICKOFF_MS + TICK)
    // O último a tocar é o autor — inclusive quando o gol é contra.
    hub.__moveForTest(pa.userId, centro.x - 12, centro.y)
    hub.kick(a.socket, pa.userId, 0)

    const alvo = SOCCER_FIELD.goals.leste
    hub.__ballForTest({ x: alvo.line + 4, y: (alvo.top + alvo.bottom) / 2, vx: 0, vy: 0 })
    vi.advanceTimersByTime(TICK * 2)

    expect(a.sent).toContainEqual(
      expect.objectContaining({ type: 'goal', team: 'oeste', userId: pa.userId }),
    )
    expect(hub.matchState().scores.oeste).toBe(1)
    const bola = bolaDe(a)
    expect(bola).toMatchObject({ x: centro.x, y: centro.y, vx: 0, vy: 0 })
    expect(bola?.lockedMs).toBeGreaterThan(0)
  })

  it('depois do gol todo mundo volta para o próprio campo', () => {
    const { a, pa } = partidaDeFutebol()
    vi.advanceTimersByTime(ARENA_SOCCER_KICKOFF_MS + TICK)
    hub.__moveForTest(pa.userId, centro.x, centro.y + 200)

    const alvo = SOCCER_FIELD.goals.leste
    hub.__ballForTest({ x: alvo.line + 4, y: (alvo.top + alvo.bottom) / 2 })
    vi.advanceTimersByTime(TICK * 2)

    const depois = hub.players().find((p) => p.userId === pa.userId)!
    const base = SOCCER_FIELD.bases[depois.team]
    expect(Math.abs(depois.x - (base.x * 32 + 16))).toBeLessThan(64)
  })

  // Corpo no caminho é obstáculo, e quem anda leva a bola no pé.
  it('quem anda por cima conduz a bola', () => {
    const { a, pa } = partidaDeFutebol()
    vi.advanceTimersByTime(ARENA_SOCCER_KICKOFF_MS + TICK)
    hub.applyInput(a.socket, pa.userId, { seq: 1, dx: 0, dy: 1, dtMs: 16 })
    vi.advanceTimersByTime(TICK)
    hub.__moveForTest(pa.userId, centro.x, centro.y - 10)
    vi.advanceTimersByTime(TICK * 2)

    const bola = bolaDe(a)
    expect(bola!.vy).toBeGreaterThan(0)
    expect(bola!.y).toBeGreaterThan(centro.y)
  })

  // Input que parou de chegar (aba em segundo plano, rede caída) não pode
  // deixar alguém conduzindo para sempre.
  it('a intenção de passo vence, e quem sumiu para de conduzir', () => {
    const { a, pa } = partidaDeFutebol()
    vi.advanceTimersByTime(ARENA_SOCCER_KICKOFF_MS + TICK)
    hub.applyInput(a.socket, pa.userId, { seq: 1, dx: 0, dy: 1, dtMs: 16 })
    vi.advanceTimersByTime(TICK)
    // Meio segundo sem input nenhum, e só então a bola encosta nele.
    vi.advanceTimersByTime(500)
    hub.__moveForTest(pa.userId, centro.x, centro.y - 10)
    hub.__ballForTest({ x: centro.x, y: centro.y, vx: 0, vy: 0 })
    vi.advanceTimersByTime(TICK * 2)

    expect(bolaDe(a)).toMatchObject({ vy: 0 })
  })
})

describe('corrida de kart', () => {
  const TICK = Math.round(1000 / BODY_TICK_HZ)

  function partidaDeCorrida(quantos = 2) {
    vi.useFakeTimers()
    hub.configure(arenaDocumentFor('corrida'), 'corrida')
    const pessoas = [ana, bruno, carla].slice(0, quantos)
    const sockets = pessoas.map((pessoa) => {
      const sock = fakeSocket()
      hub.join(sock.socket, pessoa, 'corrida')
      return sock
    })
    return { sockets, pessoas }
  }

  const raceDe = (sock: ReturnType<typeof fakeSocket>) =>
    (snapshots(sock.sent).at(-1) as { race?: ArenaRaceSnapshot })?.race

  /**
   * Ticks suficientes para sair um snapshot NOVO. São dois ticks por snapshot
   * (`BODY_TICK_HZ / BODY_SNAPSHOT_HZ`), então ler o último logo depois de
   * mexer no estado pode pegar o pacote anterior.
   */
  const ateOProximoSnapshot = () => vi.advanceTimersByTime(TICK * 3)

  /** Dá uma volta completa: um salto por setor, e o tick faz a contagem. */
  function darUmaVolta(userId: string) {
    for (const fracao of [0, 0.25, 0.5, 0.75]) {
      hub.__raceSeekForTest(userId, RACE_TRACK.length * fracao)
      vi.advanceTimersByTime(TICK)
    }
    // E cruza a linha, chegando pelo último quarto.
    hub.__raceSeekForTest(userId, RACE_TRACK.length - 10)
    vi.advanceTimersByTime(TICK)
    hub.__raceSeekForTest(userId, 10)
    vi.advanceTimersByTime(TICK)
  }

  it('larga todo mundo no grid, em vagas diferentes e apontado para a pista', () => {
    const { sockets } = partidaDeCorrida(3)
    const pilotos = hub.players()
    expect(pilotos).toHaveLength(3)
    for (const [i, piloto] of pilotos.entries()) {
      expect(piloto.heading).toBeCloseTo(RACE_TRACK.grid[i].heading, 6)
      for (const outro of pilotos.slice(i + 1)) {
        expect(Math.hypot(outro.x - piloto.x, outro.y - piloto.y)).toBeGreaterThan(20)
      }
    }
    ateOProximoSnapshot()
    expect(raceDe(sockets[0])?.laps).toBe(ARENA_RACE_LAPS)
  })

  it('o semáforo segura o grid, e o kart não guarda aceleração', () => {
    const { sockets } = partidaDeCorrida(1)
    const antes = hub.players()[0]
    // Acelerador a fundo durante a contagem inteira.
    for (let seq = 1; seq <= 40; seq += 1) {
      hub.applyInput(sockets[0].socket, 'ana', { seq, dx: 0, dy: -1, dtMs: 25 })
      vi.advanceTimersByTime(TICK)
    }
    const durante = hub.players()[0]
    expect(durante.x).toBeCloseTo(antes.x, 6)
    expect(durante.y).toBeCloseTo(antes.y, 6)

    // O `seq` avança mesmo travado: segurar a fila deixaria a predição do
    // cliente esperando uma confirmação que só viria quando o semáforo abrisse.
    const snap = snapshots(sockets[0].sent).at(-1) as { players: Array<{ seq: number; v?: number }> }
    expect(snap.players[0].seq).toBeGreaterThan(0)
    expect(snap.players[0].v).toBe(0)
  })

  it('avisa quando o semáforo abre', () => {
    const { sockets } = partidaDeCorrida(1)
    expect(sockets[0].sent.filter((m) => m.type === 'race-started')).toHaveLength(0)
    vi.advanceTimersByTime(ARENA_RACE_COUNTDOWN_MS + TICK * 2)
    expect(sockets[0].sent.filter((m) => m.type === 'race-started')).toHaveLength(1)
    expect(raceDe(sockets[0])?.countdownMs).toBeUndefined()
  })

  it('depois do semáforo o kart anda, e o snapshot leva rumo e velocidade', () => {
    const { sockets } = partidaDeCorrida(1)
    vi.advanceTimersByTime(ARENA_RACE_COUNTDOWN_MS + TICK)
    const antes = hub.players()[0]
    for (let seq = 1; seq <= 20; seq += 1) {
      hub.applyInput(sockets[0].socket, 'ana', { seq, dx: 0, dy: -1, dtMs: 25 })
      vi.advanceTimersByTime(TICK)
    }
    const depois = hub.players()[0]
    expect(Math.hypot(depois.x - antes.x, depois.y - antes.y)).toBeGreaterThan(20)

    const snap = snapshots(sockets[0].sent).at(-1) as { players: Array<{ h?: number; v?: number }> }
    expect(snap.players[0].v).toBeGreaterThan(0)
    expect(typeof snap.players[0].h).toBe('number')
  })

  it('conta a volta e avisa com o tempo dela', () => {
    const { sockets } = partidaDeCorrida(1)
    vi.advanceTimersByTime(ARENA_RACE_COUNTDOWN_MS + TICK)
    darUmaVolta('ana')

    const voltas = sockets[0].sent.filter((m) => m.type === 'lap') as Array<{ lap: number; lapMs: number }>
    expect(voltas).toHaveLength(1)
    expect(voltas[0].lap).toBe(1)
    expect(voltas[0].lapMs).toBeGreaterThan(0)
    expect(hub.__raceRunnerForTest('ana')?.lap).toBe(1)
  })

  it('não conta volta de quem só encosta na linha e volta', () => {
    // O antitrapaça. Sem o setor em ordem, ir até um pouco antes da linha e
    // atravessá-la renderia uma volta que nunca foi dada.
    const { sockets } = partidaDeCorrida(1)
    vi.advanceTimersByTime(ARENA_RACE_COUNTDOWN_MS + TICK)
    for (let k = 0; k < 4; k += 1) {
      hub.__raceSeekForTest('ana', RACE_TRACK.length - 40)
      vi.advanceTimersByTime(TICK)
      hub.__raceSeekForTest('ana', 40)
      vi.advanceTimersByTime(TICK)
    }
    expect(sockets[0].sent.filter((m) => m.type === 'lap')).toHaveLength(0)
    expect(hub.__raceRunnerForTest('ana')?.lap).toBe(0)
  })

  it('classifica pela distância percorrida, e a ordem chega no snapshot', () => {
    const { sockets } = partidaDeCorrida(2)
    vi.advanceTimersByTime(ARENA_RACE_COUNTDOWN_MS + TICK)
    hub.__raceSeekForTest('ana', RACE_TRACK.length * 0.25)
    hub.__raceSeekForTest('bruno', RACE_TRACK.length * 0.5)
    vi.advanceTimersByTime(TICK * 2)

    const standings = raceDe(sockets[0])?.standings ?? []
    expect(standings.map((linha) => linha.userId)).toEqual(['bruno', 'ana'])
    expect(standings[0].position).toBe(1)
  })

  it('quem termina abre a bandeirada e entra no pódio', () => {
    const { sockets } = partidaDeCorrida(2)
    vi.advanceTimersByTime(ARENA_RACE_COUNTDOWN_MS + TICK)
    for (let volta = 0; volta < ARENA_RACE_LAPS; volta += 1) darUmaVolta('ana')

    const chegada = sockets[0].sent.filter((m) => m.type === 'race-finished') as Array<{
      userId: string
      position: number
    }>
    expect(chegada).toHaveLength(1)
    expect(chegada[0]).toMatchObject({ userId: 'ana', position: 1 })
    // A corrida NÃO acaba no primeiro: quem ficou tem o prazo para terminar.
    expect(hub.matchState().phase).toBe('jogando')
    ateOProximoSnapshot()
    expect(raceDe(sockets[0])?.finishGraceMs).toBeGreaterThan(0)
  })

  it('a bandeirada encerra a corrida e publica o pódio', () => {
    const { sockets } = partidaDeCorrida(2)
    vi.advanceTimersByTime(ARENA_RACE_COUNTDOWN_MS + TICK)
    for (let volta = 0; volta < ARENA_RACE_LAPS; volta += 1) darUmaVolta('ana')
    vi.advanceTimersByTime(ARENA_RACE_FINISH_GRACE_MS + TICK * 2)

    const fim = sockets[0].sent.find((m) => m.type === 'match-ended') as { podium?: string[] }
    expect(fim.podium?.[0]).toBe('ana')
    // Quem não cruzou entra pela classificação da pista, e não fica de fora.
    expect(fim.podium).toContain('bruno')
    expect(hub.matchState().phase).toBe('intervalo')
    expect(hub.matchState().podium?.[0]).toBe('ana')
  })

  it('acaba na hora quando todo mundo já terminou', () => {
    // Esperar o relógio com a pista vazia seria vinte segundos de tela parada.
    const { sockets } = partidaDeCorrida(1)
    vi.advanceTimersByTime(ARENA_RACE_COUNTDOWN_MS + TICK)
    for (let volta = 0; volta < ARENA_RACE_LAPS; volta += 1) darUmaVolta('ana')
    vi.advanceTimersByTime(TICK * 2)
    expect(hub.matchState().phase).toBe('intervalo')
    expect(sockets[0].sent.filter((m) => m.type === 'match-ended')).toHaveLength(1)
  })

  it('na corrida não se atira, e a recusa é do servidor', () => {
    const { sockets } = partidaDeCorrida(2)
    vi.advanceTimersByTime(ARENA_RACE_COUNTDOWN_MS + TICK)
    hub.__raceSeekForTest('ana', 0)
    hub.__raceSeekForTest('bruno', 40)
    hub.fire(sockets[0].socket, 'ana', 0)

    expect(sockets[0].sent.filter((m) => m.type === 'shot')).toHaveLength(0)
    expect(hub.matchState().scores).toEqual({ oeste: 0, leste: 0 })
  })

  it('desatolar devolve o kart à pista sem adiantar a volta', () => {
    const { sockets } = partidaDeCorrida(1)
    vi.advanceTimersByTime(ARENA_RACE_COUNTDOWN_MS + TICK)
    hub.__raceSeekForTest('ana', RACE_TRACK.length * 0.5)
    vi.advanceTimersByTime(TICK)
    const antes = hub.__raceRunnerForTest('ana')

    // Encosta o kart na barreira e desatola.
    hub.__moveForTest('ana', hub.players()[0].x + 100, hub.players()[0].y + 100)
    hub.unstuck(sockets[0].socket, 'ana')
    vi.advanceTimersByTime(TICK)

    const depois = hub.__raceRunnerForTest('ana')
    // O progresso não avança: a linha de centro é o pior lugar para se estar
    // parado, e desatolar não pode virar atalho.
    expect(depois?.lap).toBe(antes?.lap)
    expect(depois?.s).toBeCloseTo(antes?.s ?? 0, 0)
    const snap = snapshots(sockets[0].sent).at(-1) as { players: Array<{ v?: number }> }
    expect(snap.players[0].v).toBe(0)
  })

  it('desatolar não vale fora da corrida', () => {
    vi.useFakeTimers()
    const a = fakeSocket()
    hub.join(a.socket, ana, 'arena-1')
    const antes = hub.players()[0]
    hub.unstuck(a.socket, 'ana')
    expect(hub.players()[0]).toMatchObject({ x: antes.x, y: antes.y })
  })

  it('a vaga de quem sai é reaproveitada', () => {
    // Sem isso, a arena empurraria todo mundo para o fim do grid ao longo do
    // expediente, até estourar as vagas.
    const { sockets } = partidaDeCorrida(2)
    hub.leave(sockets[0].socket, 'ana')
    const c = fakeSocket()
    hub.join(c.socket, carla, 'corrida')
    const [primeiro, segundo] = hub.players()
    expect(Math.hypot(primeiro.x - segundo.x, primeiro.y - segundo.y)).toBeGreaterThan(20)
  })
})

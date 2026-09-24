import { describe, it, expect, vi } from 'vitest'
import {
  defaultCharacterFromSeed,
  type OfficeClientMessage,
  type OfficeOccupant,
  type OfficeServerMessage,
} from '@legends/shared'
import { OfficeBridge } from './OfficeBridge'

const ana: OfficeOccupant = {
  userId: 'ana',
  name: 'Ana',
  x: 11,
  y: 14,
  dir: 'down',
  avatarSeed: null,
  avatarOptions: null,
}

const bruno: OfficeOccupant = {
  userId: 'bruno',
  name: 'Bruno',
  x: 12,
  y: 14,
  dir: 'down',
  avatarSeed: null,
  avatarOptions: null,
}

describe('OfficeBridge', () => {
  it('reproduz o welcome para quem se inscreve depois que ele já passou (a corrida do Phaser lazy-loaded)', () => {
    const bridge = new OfficeBridge()

    // Nada inscrito ainda — é exatamente o que acontece enquanto `import('phaser')`
    // está em voo: o welcome chega e some, porque a cena (o handler) ainda não existe.
    bridge.emitServerMessage({ type: 'welcome', youId: 'ana', occupants: [ana] })
    bridge.emitServerMessage({ type: 'joined', occupant: bruno })
    bridge.emitServerMessage({ type: 'snapshot', players: [{ userId: 'bruno', x: 400, y: 432, dir: 'up', seq: 1 }] })

    // A cena só se inscreve quando o Phaser termina de carregar — tarde demais
    // para pegar o welcome real, mas deve receber um sintético com o estado atual.
    const seen: OfficeServerMessage[] = []
    bridge.onServerMessage((m) => seen.push(m))

    expect(seen).toHaveLength(1)
    const [replayed] = seen
    expect(replayed.type).toBe('welcome')
    if (replayed.type !== 'welcome') throw new Error('esperava welcome sintético')
    expect(replayed.youId).toBe('ana')
    expect(replayed.occupants).toEqual(
      expect.arrayContaining([ana, { ...bruno, x: 400, y: 432, dir: 'up' }]),
    )
    expect(replayed.occupants).toHaveLength(2)
  })

  it('não entrega welcome sintético a quem se inscreve antes de qualquer welcome real', () => {
    const bridge = new OfficeBridge()
    const seen: OfficeServerMessage[] = []
    bridge.onServerMessage((m) => seen.push(m))

    expect(seen).toEqual([])
  })

  it('só reproduz o welcome sintético para o handler que acabou de se inscrever, não para os demais', () => {
    const bridge = new OfficeBridge()
    bridge.emitServerMessage({ type: 'welcome', youId: 'ana', occupants: [ana] })

    const early: OfficeServerMessage[] = []
    bridge.onServerMessage((m) => early.push(m))
    early.length = 0 // descarta o replay que este handler recebeu ao se inscrever

    const late: OfficeServerMessage[] = []
    bridge.onServerMessage((m) => late.push(m))

    expect(early).toEqual([])
    expect(late).toHaveLength(1)
    expect(late[0]).toMatchObject({ type: 'welcome', youId: 'ana' })
  })

  it('mantém o snapshot em dia com joined/left/moved/sync', () => {
    const bridge = new OfficeBridge()

    bridge.emitServerMessage({ type: 'welcome', youId: 'ana', occupants: [ana] })
    expect(bridge.snapshot()).toEqual({
      youId: 'ana',
      occupants: [ana],
      editorUserIds: [],
      karts: [],
      balls: [],
      paintSplats: [],
    })

    bridge.emitServerMessage({ type: 'joined', occupant: bruno })
    expect(bridge.snapshot().occupants).toEqual(expect.arrayContaining([ana, bruno]))
    expect(bridge.snapshot().occupants).toHaveLength(2)

    bridge.emitServerMessage({ type: 'snapshot', players: [{ userId: 'bruno', x: 400, y: 432, dir: 'up', seq: 1 }] })
    expect(bridge.snapshot().occupants.find((o) => o.userId === 'bruno')).toMatchObject({
      x: 400,
      y: 432,
      dir: 'up',
    })

    // O snapshot é substitutivo e traz TODO MUNDO — inclusive você. O `sync`,
    // que existia só para reancorar "você" depois de um passo recusado, deixou
    // de ser necessário: reancorar virou o mecanismo geral.
    bridge.emitServerMessage({
      type: 'snapshot',
      players: [{ userId: 'ana', x: 176, y: 208, dir: 'left', seq: 3 }],
    })
    expect(bridge.snapshot().occupants.find((o) => o.userId === 'ana')).toMatchObject({
      x: 176,
      y: 208,
      dir: 'left',
    })

    bridge.emitServerMessage({ type: 'left', userId: 'bruno' })
    expect(bridge.snapshot().occupants.map((o) => o.userId)).toEqual(['ana'])
  })

  it('guarda o pensamento e só o apaga com thought-cleared — snapshot não apaga', () => {
    const bridge = new OfficeBridge()
    bridge.emitServerMessage({ type: 'welcome', youId: 'ana', occupants: [ana, bruno] })
    bridge.emitServerMessage({ type: 'nearby-message', userId: 'ana', text: 'pensando', kind: 'thought' })

    // Alguém ANDANDO faz o servidor repetir todo mundo no snapshot. Quem está
    // parado pensando continua pensando: apagar em bloco aqui tirava o
    // pensamento de quem não se mexeu.
    bridge.emitServerMessage({
      type: 'snapshot',
      players: [{ userId: 'bruno', x: 400, y: 432, dir: 'up', seq: 1 }],
    })
    expect(bridge.occupantSnapshot('ana')?.thoughtText).toBe('pensando')

    bridge.emitServerMessage({ type: 'thought-cleared', userId: 'ana' })
    expect(bridge.occupantSnapshot('ana')?.thoughtText).toBeUndefined()
  })

  it('occupantSnapshot devolve o occupant já em dia, ou null se desconhecido', () => {
    const bridge = new OfficeBridge()
    bridge.emitServerMessage({ type: 'welcome', youId: 'ana', occupants: [ana, bruno] })
    bridge.emitServerMessage({ type: 'snapshot', players: [{ userId: 'bruno', x: 400, y: 432, dir: 'up', seq: 1 }] })

    expect(bridge.occupantSnapshot('bruno')).toMatchObject({ x: 400, y: 432, dir: 'up' })
    expect(bridge.occupantSnapshot('fantasma')).toBeNull()
  })

  it('avatar-updated atualiza seed e options do occupant', () => {
    const bridge = new OfficeBridge()
    bridge.emitServerMessage({ type: 'welcome', youId: 'ana', occupants: [ana] })
    bridge.emitServerMessage({
      type: 'avatar-updated',
      userId: 'ana',
      avatarSeed: 'nova',
      avatarOptions: defaultCharacterFromSeed('nova'),
    })
    const occupant = bridge.snapshot().occupants.find((o) => o.userId === 'ana')
    expect(occupant?.avatarSeed).toBe('nova')
    expect(occupant?.avatarOptions).toEqual(defaultCharacterFromSeed('nova'))
  })

  it('status-changed atualiza o status de presença do occupant', () => {
    const bridge = new OfficeBridge()
    bridge.emitServerMessage({ type: 'welcome', youId: 'ana', occupants: [ana] })
    bridge.emitServerMessage({ type: 'status-changed', userId: 'ana', status: 'away' })

    const occupant = bridge.snapshot().occupants.find((o) => o.userId === 'ana')
    expect(occupant?.status).toBe('away')
  })

  it('character-name-changed atualiza só o alias do occupant', () => {
    const bridge = new OfficeBridge()
    bridge.emitServerMessage({ type: 'welcome', youId: 'ana', occupants: [ana] })
    bridge.emitServerMessage({ type: 'character-name-changed', userId: 'ana', name: 'Nina' })

    const occupant = bridge.snapshot().occupants.find((o) => o.userId === 'ana')
    expect(occupant?.name).toBe('Ana')
    expect(occupant?.characterName).toBe('Nina')
  })

  it('emitServerMessage ainda entrega a mensagem original a quem já estava inscrito', () => {
    const bridge = new OfficeBridge()
    const seen: OfficeServerMessage[] = []
    bridge.onServerMessage((m) => seen.push(m))

    const welcome: OfficeServerMessage = { type: 'welcome', youId: 'ana', occupants: [ana] }
    bridge.emitServerMessage(welcome)

    expect(seen).toEqual([welcome])
  })

  it('bloqueia intenção de movimento enquanto a UI está capturando teclado', () => {
    const bridge = new OfficeBridge()
    const inputs: number[] = []
    bridge.onInput((input) => inputs.push(input.seq))

    bridge.setMovementLocked(true)
    bridge.emitInput({ seq: 1, dx: 1, dy: 0, dtMs: 33 })
    expect(inputs).toEqual([])

    bridge.setMovementLocked(false)
    bridge.emitInput({ seq: 2, dx: 1, dy: 0, dtMs: 33 })
    expect(inputs).toEqual([2])
  })

  it('repassa o input inteiro, com a corrida dentro dele', () => {
    // `sprint` viaja NO input, e não como campo à parte, porque velocidade é
    // parte da simulação: os dois lados precisam aplicar a mesma.
    const bridge = new OfficeBridge()
    const inputs: unknown[] = []
    bridge.onInput((input) => inputs.push(input))

    bridge.emitInput({ seq: 1, dx: 0, dy: -1, dtMs: 33, sprint: true })
    bridge.emitInput({ seq: 2, dx: 0, dy: -1, dtMs: 33 })

    expect(inputs).toEqual([
      { seq: 1, dx: 0, dy: -1, dtMs: 33, sprint: true },
      { seq: 2, dx: 0, dy: -1, dtMs: 33 },
    ])
  })

  it('a caminhada automática viaja como direção sustentada, não como passo', () => {
    const bridge = new OfficeBridge()
    const dirs: (string | null)[] = []
    bridge.onAutoWalk((dir) => dirs.push(dir))

    bridge.emitAutoWalk('right')
    bridge.emitAutoWalk(null)

    expect(dirs).toEqual(['right', null])
  })

  it('a posição PREVISTA do próprio corpo é a volta da caminhada automática', () => {
    // Quem segura a tecla precisa saber onde o corpo está para virar a esquina
    // e para soltar. O snapshot não serve: chega um round-trip atrasado.
    const bridge = new OfficeBridge()
    const positions: { x: number; y: number }[] = []
    const off = bridge.onSelfBody((body) => positions.push(body))

    bridge.emitSelfBody({ x: 112.5, y: 144 })
    off()
    bridge.emitSelfBody({ x: 200, y: 144 })

    expect(positions).toEqual([{ x: 112.5, y: 144 }])
  })

  it('expõe o estado da conexão (a cena só prevê movimento conectada)', () => {
    const bridge = new OfficeBridge()
    expect(bridge.isConnected()).toBe(false)

    bridge.setConnected(true)
    expect(bridge.isConnected()).toBe(true)

    bridge.setConnected(false)
    expect(bridge.isConnected()).toBe(false)
  })

  it('reproduz o welcome sintético com confettiUserIds em dia (welcome inicial + eventos de confetti)', () => {
    const bridge = new OfficeBridge()
    bridge.emitServerMessage({ type: 'welcome', youId: 'ana', occupants: [ana, bruno], confettiUserIds: ['ana'] })
    bridge.emitServerMessage({ type: 'confetti', userId: 'bruno', active: true })
    bridge.emitServerMessage({ type: 'confetti', userId: 'ana', active: false })

    // A cena chega tarde (Phaser carregando) e recebe o replay: só bruno deveria constar ativo.
    const seen: OfficeServerMessage[] = []
    bridge.onServerMessage((m) => seen.push(m))

    expect(seen).toHaveLength(1)
    const [replayed] = seen
    if (replayed.type !== 'welcome') throw new Error('esperava welcome sintético')
    expect(replayed.confettiUserIds).toEqual(['bruno'])
  })

  it('esquece o confete de quem saiu (left) no snapshot rastreado pro replay', () => {
    const bridge = new OfficeBridge()
    bridge.emitServerMessage({ type: 'welcome', youId: 'ana', occupants: [ana, bruno], confettiUserIds: ['bruno'] })
    bridge.emitServerMessage({ type: 'left', userId: 'bruno' })

    const seen: OfficeServerMessage[] = []
    bridge.onServerMessage((m) => seen.push(m))
    const [replayed] = seen
    if (replayed.type !== 'welcome') throw new Error('esperava welcome sintético')
    expect(replayed.confettiUserIds).toEqual([])
  })

  it('reproduz o welcome sintético com handRaisedUserIds em dia (mesmo padrão do confete)', () => {
    const bridge = new OfficeBridge()
    bridge.emitServerMessage({ type: 'welcome', youId: 'ana', occupants: [ana, bruno], handRaisedUserIds: ['ana'] })
    bridge.emitServerMessage({ type: 'hand-raised', userId: 'bruno', active: true })
    bridge.emitServerMessage({ type: 'hand-raised', userId: 'ana', active: false })

    const seen: OfficeServerMessage[] = []
    bridge.onServerMessage((m) => seen.push(m))

    expect(seen).toHaveLength(1)
    const [replayed] = seen
    if (replayed.type !== 'welcome') throw new Error('esperava welcome sintético')
    expect(replayed.handRaisedUserIds).toEqual(['bruno'])
  })

  it('esquece a mão de quem saiu (left) no snapshot rastreado pro replay', () => {
    const bridge = new OfficeBridge()
    bridge.emitServerMessage({ type: 'welcome', youId: 'ana', occupants: [ana, bruno], handRaisedUserIds: ['bruno'] })
    bridge.emitServerMessage({ type: 'left', userId: 'bruno' })

    const seen: OfficeServerMessage[] = []
    bridge.onServerMessage((m) => seen.push(m))
    const [replayed] = seen
    if (replayed.type !== 'welcome') throw new Error('esperava welcome sintético')
    expect(replayed.handRaisedUserIds).toEqual([])
  })

  it('guarda a bola COM velocidade — quem chega no meio da rolagem continua dali', () => {
    const bridge = new OfficeBridge()
    const parada = { id: 'ball-1', x: 96, y: 96, vx: 0, vy: 0 }
    bridge.emitServerMessage({ type: 'welcome', youId: 'ana', occupants: [ana], balls: [parada] })

    // O evento traz o estado da bola com a velocidade nova. Antes trazia a
    // trajetória inteira resolvida, e só dava para guardar o tile final; agora
    // quem se inscreve no meio recebe onde ela está E para onde vai, e continua
    // a integração dali.
    const chutada = { id: 'ball-1', x: 96, y: 96, vx: 0, vy: 380 }
    bridge.emitServerMessage({ type: 'ball-kicked', userId: 'ana', ball: chutada, power: 'kick' })
    expect(bridge.snapshot().balls).toEqual([chutada])

    // E o snapshot substitutivo continua mandando na posição.
    const rolando = { id: 'ball-1', x: 96, y: 140, vx: 0, vy: 300 }
    bridge.emitServerMessage({
      type: 'snapshot',
      players: [],
      balls: [rolando],
    })
    expect(bridge.snapshot().balls).toEqual([rolando])

    const reposta = { id: 'ball-1', x: 288, y: 288, vx: 0, vy: 0 }
    bridge.emitServerMessage({ type: 'balls-updated', balls: [reposta] })
    expect(bridge.snapshot().balls).toEqual([reposta])
  })

  it('reflete paint-marker no occupant do snapshot (é o bit que arma a arma)', () => {
    const bridge = new OfficeBridge()
    bridge.emitServerMessage({ type: 'welcome', youId: 'ana', occupants: [ana, bruno] })

    bridge.emitServerMessage({ type: 'paint-marker', userId: 'bruno', active: true })
    expect(bridge.snapshot().occupants.find((o) => o.userId === 'bruno')?.paintMarker).toBe(true)

    bridge.emitServerMessage({ type: 'paint-marker', userId: 'bruno', active: false })
    // Ausente, não `false`: desarmado é o normal e não carrega a chave.
    expect(bridge.snapshot().occupants.find((o) => o.userId === 'bruno')?.paintMarker).toBeUndefined()
  })

  it('guarda a MARCA do tiro no snapshot, não o voo da bolinha', () => {
    const bridge = new OfficeBridge()
    bridge.emitServerMessage({ type: 'welcome', youId: 'ana', occupants: [ana, bruno] })

    bridge.emitServerMessage({
      type: 'paintball-shot',
      shot: {
        shooterId: 'ana',
        // De/para em PIXEL: o disparo vem resolvido, não como lista de tiles.
        from: { x: 368, y: 464 },
        to: { x: 400, y: 464 },
        durationMs: 28,
        color: 0xff3b7b,
        splat: { id: 'ana:bruno:1', userId: 'bruno', byUserId: 'ana', color: 0xff3b7b, ttlMs: 25_000 },
      },
    })

    expect(bridge.snapshot().paintSplats).toMatchObject([{ id: 'ana:bruno:1', userId: 'bruno' }])
  })

  it('esquece a tinta de quem saiu (left), como o confete e a mão', () => {
    const bridge = new OfficeBridge()
    bridge.emitServerMessage({
      type: 'welcome',
      youId: 'ana',
      occupants: [ana, bruno],
      paintSplats: [
        { id: 'ana:bruno:1', userId: 'bruno', byUserId: 'ana', color: 0xff3b7b, ttlMs: 25_000 },
      ],
    })
    expect(bridge.snapshot().paintSplats).toHaveLength(1)

    bridge.emitServerMessage({ type: 'left', userId: 'bruno' })
    expect(bridge.snapshot().paintSplats).toEqual([])
  })

  // Nada aqui apaga marca vencida sozinho: sem a poda na leitura, o mapa
  // cresceria a sessão inteira e o replay entregaria à cena manchas mortas.
  it('poda as marcas vencidas na leitura, descontando o ttl que resta', () => {
    vi.useFakeTimers()
    try {
      const bridge = new OfficeBridge()
      bridge.emitServerMessage({
        type: 'welcome',
        youId: 'ana',
        occupants: [ana, bruno],
        paintSplats: [
          { id: 'ana:bruno:1', userId: 'bruno', byUserId: 'ana', color: 0xff3b7b, ttlMs: 10_000 },
        ],
      })

      vi.advanceTimersByTime(4_000)
      expect(bridge.snapshot().paintSplats).toMatchObject([{ ttlMs: 6_000 }])

      vi.advanceTimersByTime(6_001)
      expect(bridge.snapshot().paintSplats).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('reduz montaria, movimento e estacionamento no snapshot dos karts', () => {
    const bridge = new OfficeBridge()
    bridge.emitServerMessage({
      type: 'welcome',
      youId: 'ana',
      occupants: [ana],
      karts: [{ id: 'kart-1', x: 400, y: 464, dir: 'up' }],
    })
    bridge.emitServerMessage({
      type: 'kart-ride',
      userId: 'ana',
      active: true,
      kart: { id: 'kart-1', x: 11, y: 14, dir: 'down', riderUserId: 'ana' },
    })
    bridge.emitServerMessage({ type: 'snapshot', players: [{ userId: 'ana', x: 368, y: 496, dir: 'down', seq: 1 }] })

    expect(bridge.snapshot()).toMatchObject({
      occupants: [expect.objectContaining({ userId: 'ana', ridingKartId: 'kart-1' })],
      // O kart montado acompanha o piloto em PIXEL — não salta de tile em tile.
      karts: [expect.objectContaining({ id: 'kart-1', x: 368, y: 496, riderUserId: 'ana' })],
    })

    bridge.emitServerMessage({
      type: 'kart-ride',
      userId: 'ana',
      active: false,
      kart: { id: 'kart-1', x: 368, y: 496, dir: 'down' },
    })
    expect(bridge.snapshot().occupants[0]?.ridingKartId).toBeUndefined()
    expect(bridge.snapshot().karts[0]?.riderUserId).toBeUndefined()
  })

  it('inclui os karts atuais no replay sintético do welcome', () => {
    const bridge = new OfficeBridge()
    bridge.emitServerMessage({
      type: 'welcome',
      youId: 'ana',
      occupants: [ana],
      karts: [{ id: 'kart-1', x: 3, y: 4, dir: 'left' }],
    })
    const seen: OfficeServerMessage[] = []
    bridge.onServerMessage((message) => seen.push(message))

    expect(seen[0]).toMatchObject({
      type: 'welcome',
      karts: [{ id: 'kart-1', x: 3, y: 4, dir: 'left' }],
    })
  })

  it('reflete editors-changed no snapshot', () => {
    const bridge = new OfficeBridge()
    bridge.emitServerMessage({ type: 'welcome', youId: 'me', occupants: [], editorUserIds: ['x'] } as any)
    expect(bridge.snapshot().editorUserIds).toEqual(['x'])
    bridge.emitServerMessage({ type: 'editors-changed', userIds: ['x', 'y'] } as any)
    expect(bridge.snapshot().editorUserIds).toEqual(['x', 'y'])
  })

  it('inclui editores no replay sintético do welcome', () => {
    const bridge = new OfficeBridge()
    bridge.emitServerMessage({ type: 'welcome', youId: 'me', occupants: [], editorUserIds: ['x'] } as any)
    let replayed: any = null
    bridge.onServerMessage((m) => {
      if (m.type === 'welcome') replayed = m
    })
    expect(replayed.editorUserIds).toEqual(['x'])
  })

  it('guarda a flag editingDirty', () => {
    const bridge = new OfficeBridge()
    expect(bridge.isEditingDirty()).toBe(false)
    bridge.setEditingDirty(true)
    expect(bridge.isEditingDirty()).toBe(true)
  })

  it('deferDecorRefetch: dispara o handler quando editingDirty volta a false', () => {
    const bridge = new OfficeBridge()
    const handler = vi.fn()
    bridge.onDecorRefetchAvailable(handler)
    bridge.setEditingDirty(true)
    bridge.deferDecorRefetch()
    expect(handler).not.toHaveBeenCalled()
    bridge.setEditingDirty(false)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('setEditingDirty(false) sem refetch pendente não dispara o handler', () => {
    const bridge = new OfficeBridge()
    const handler = vi.fn()
    bridge.onDecorRefetchAvailable(handler)
    bridge.setEditingDirty(true)
    bridge.setEditingDirty(false)
    expect(handler).not.toHaveBeenCalled()
  })

  it('deferDecorRefetch só dispara uma vez — não fica preso disparando em toda queda de dirty seguinte', () => {
    const bridge = new OfficeBridge()
    const handler = vi.fn()
    bridge.onDecorRefetchAvailable(handler)
    bridge.setEditingDirty(true)
    bridge.deferDecorRefetch()
    bridge.setEditingDirty(false)
    expect(handler).toHaveBeenCalledTimes(1)
    bridge.setEditingDirty(true)
    bridge.setEditingDirty(false)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('onDecorRefetchAvailable devolve unsubscribe', () => {
    const bridge = new OfficeBridge()
    const handler = vi.fn()
    const unsubscribe = bridge.onDecorRefetchAvailable(handler)
    unsubscribe()
    bridge.setEditingDirty(true)
    bridge.deferDecorRefetch()
    bridge.setEditingDirty(false)
    expect(handler).not.toHaveBeenCalled()
  })

  it('emite mensagens nearby para a cena desenhar o balão', () => {
    const bridge = new OfficeBridge()
    const seen: Array<{ userId: string; text: string }> = []
    bridge.onNearbyMessage((message) => seen.push(message))

    bridge.emitNearbyMessage({ userId: 'ana', text: 'opa' })

    expect(seen).toEqual([{ userId: 'ana', text: 'opa' }])
  })
})

describe('canal de clique', () => {
  it('emitCharacterClick chega aos handlers e o unsubscribe funciona', () => {
    const bridge = new OfficeBridge()
    const seen: string[] = []
    const off = bridge.onCharacterClick((id) => seen.push(id))
    bridge.emitCharacterClick('ana')
    off()
    bridge.emitCharacterClick('bruno')
    expect(seen).toEqual(['ana'])
  })
})

describe('canal de clique em mesa', () => {
  it('emitDeskClick notifica os handlers assinados via onDeskClick', () => {
    const bridge = new OfficeBridge()
    const received: string[] = []
    const off = bridge.onDeskClick((externalKey) => received.push(externalKey))
    bridge.emitDeskClick('mesa-1')
    expect(received).toEqual(['mesa-1'])
    off()
    bridge.emitDeskClick('mesa-2')
    expect(received).toEqual(['mesa-1'])
  })
})

describe('canal de clique direito no mapa', () => {
  it('emitMapRightClick notifica os handlers assinados via onMapRightClick', () => {
    const bridge = new OfficeBridge()
    const received: { x: number; y: number }[] = []
    const off = bridge.onMapRightClick((tile) => received.push(tile))
    bridge.emitMapRightClick({ x: 3, y: 5 })
    expect(received).toEqual([{ x: 3, y: 5 }])
    off()
    bridge.emitMapRightClick({ x: 9, y: 9 })
    expect(received).toEqual([{ x: 3, y: 5 }])
  })
})

describe('canal genérico cliente→servidor', () => {
  it('emitClientMessage chega aos handlers; onInput NÃO dispara por ele', () => {
    const bridge = new OfficeBridge()
    const client: OfficeClientMessage[] = []
    const inputs: unknown[] = []
    bridge.onClientMessage((m) => client.push(m))
    bridge.onInput((input) => inputs.push(input))

    bridge.emitClientMessage({ type: 'call', targetUserId: 'x' })
    expect(client).toEqual([{ type: 'call', targetUserId: 'x' }])
    expect(inputs).toEqual([]) // canal genérico não é o do teclado
  })
})

describe('canal de fala (100% local, nunca vai ao servidor)', () => {
  it('emitSpeakingChanged chega aos handlers e o unsubscribe funciona', () => {
    const bridge = new OfficeBridge()
    const seen: Array<{ userId: string; speaking: boolean }> = []
    const off = bridge.onSpeakingChanged((payload) => seen.push(payload))

    bridge.emitSpeakingChanged({ userId: 'ana', speaking: true })
    bridge.emitSpeakingChanged({ userId: 'ana', speaking: false })
    off()
    bridge.emitSpeakingChanged({ userId: 'ana', speaking: true })

    expect(seen).toEqual([
      { userId: 'ana', speaking: true },
      { userId: 'ana', speaking: false },
    ])
  })

  it('emitSpeakingChanged não passa por onClientMessage (não vaza pro canal de rede)', () => {
    const bridge = new OfficeBridge()
    const client: OfficeClientMessage[] = []
    bridge.onClientMessage((m) => client.push(m))

    bridge.emitSpeakingChanged({ userId: 'ana', speaking: true })

    expect(client).toEqual([])
  })
})

describe('retomada da numeração de input', () => {
  it('o welcome SINTÉTICO carrega o `seq` já confirmado', () => {
    // A cena remonta (StrictMode, HMR, troca de rota) sem o socket cair, e
    // recebe um welcome sintético. Sem o `seq` ali, o preditor novo começaria do
    // zero e todo input seria descartado como atrasado — o personagem andaria
    // até a primeira remontagem e nunca mais sairia do lugar.
    const bridge = new OfficeBridge()
    bridge.emitServerMessage({ type: 'welcome', youId: 'ana', occupants: [ana], seq: 12 })
    bridge.emitServerMessage({
      type: 'snapshot',
      players: [{ userId: 'ana', x: 100, y: 100, dir: 'down', seq: 57 }],
    })

    const visto: OfficeServerMessage[] = []
    bridge.onServerMessage((m) => visto.push(m))

    const sintetico = visto.find((m) => m.type === 'welcome') as { seq?: number }
    // O valor VIVO, do snapshot — não o do welcome original.
    expect(sintetico.seq).toBe(57)
  })

  it('não retrocede: um welcome atrasado não desfaz o que o snapshot avançou', () => {
    // Reconexão dentro do período de graça: o `welcome` novo pode chegar com um
    // número menor do que o último snapshot já confirmou. Deixá-lo mandar
    // reabriria exatamente o congelamento que a retomada existe para fechar.
    const bridge = new OfficeBridge()
    bridge.emitServerMessage({ type: 'welcome', youId: 'ana', occupants: [ana], seq: 5 })
    bridge.emitServerMessage({
      type: 'snapshot',
      players: [{ userId: 'ana', x: 100, y: 100, dir: 'down', seq: 40 }],
    })
    bridge.emitServerMessage({ type: 'welcome', youId: 'ana', occupants: [ana], seq: 5 })

    const visto: OfficeServerMessage[] = []
    bridge.onServerMessage((m) => visto.push(m))
    expect((visto.find((m) => m.type === 'welcome') as { seq?: number }).seq).toBe(40)
  })
})

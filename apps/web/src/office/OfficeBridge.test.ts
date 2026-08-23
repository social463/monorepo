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
    bridge.emitServerMessage({ type: 'moved', userId: 'bruno', x: 12, y: 13, dir: 'up' })

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
      expect.arrayContaining([ana, { ...bruno, x: 12, y: 13, dir: 'up' }]),
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
    expect(bridge.snapshot()).toEqual({ youId: 'ana', occupants: [ana], editorUserIds: [], karts: [], balls: [] })

    bridge.emitServerMessage({ type: 'joined', occupant: bruno })
    expect(bridge.snapshot().occupants).toEqual(expect.arrayContaining([ana, bruno]))
    expect(bridge.snapshot().occupants).toHaveLength(2)

    bridge.emitServerMessage({ type: 'moved', userId: 'bruno', x: 12, y: 13, dir: 'up' })
    expect(bridge.snapshot().occupants.find((o) => o.userId === 'bruno')).toMatchObject({
      x: 12,
      y: 13,
      dir: 'up',
    })

    // sync sempre reancora "você" (youId), não quem quer que seja passado.
    bridge.emitServerMessage({ type: 'sync', x: 5, y: 6, dir: 'left' })
    expect(bridge.snapshot().occupants.find((o) => o.userId === 'ana')).toMatchObject({
      x: 5,
      y: 6,
      dir: 'left',
    })

    bridge.emitServerMessage({ type: 'left', userId: 'bruno' })
    expect(bridge.snapshot().occupants.map((o) => o.userId)).toEqual(['ana'])
  })

  it('occupantSnapshot devolve o occupant já em dia, ou null se desconhecido', () => {
    const bridge = new OfficeBridge()
    bridge.emitServerMessage({ type: 'welcome', youId: 'ana', occupants: [ana, bruno] })
    bridge.emitServerMessage({ type: 'moved', userId: 'bruno', x: 12, y: 13, dir: 'up' })

    expect(bridge.occupantSnapshot('bruno')).toMatchObject({ x: 12, y: 13, dir: 'up' })
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
    const moves: string[] = []
    bridge.onMoveIntent((intent) => moves.push(intent.dir))

    bridge.setMovementLocked(true)
    bridge.emitMoveIntent({ dir: 'right', sprint: false })
    expect(moves).toEqual([])

    bridge.setMovementLocked(false)
    bridge.emitMoveIntent({ dir: 'right', sprint: false })
    expect(moves).toEqual(['right'])
  })

  it('repassa o flag de sprint da intenção de movimento', () => {
    const bridge = new OfficeBridge()
    const intents: boolean[] = []
    bridge.onMoveIntent((intent) => intents.push(intent.sprint))

    bridge.emitMoveIntent({ dir: 'up', sprint: true })
    bridge.emitMoveIntent({ dir: 'up', sprint: false })

    expect(intents).toEqual([true, false])
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

  it('guarda no snapshot o tile ONDE A BOLA PARA, não o do meio da rolagem', () => {
    const bridge = new OfficeBridge()
    bridge.emitServerMessage({
      type: 'welcome',
      youId: 'ana',
      occupants: [ana],
      balls: [{ id: 'ball-1', x: 3, y: 3 }],
    })

    bridge.emitServerMessage({
      type: 'ball-kicked',
      userId: 'ana',
      kick: {
        ballId: 'ball-1',
        path: [
          { x: 3, y: 4 },
          { x: 3, y: 5 },
        ],
        durationMs: 160,
        power: 'kick',
        grazed: false,
        bounces: 0,
      },
    })

    // Quem se inscrever no meio da rolagem recebe a bola onde ela vai parar:
    // o replay sintético não tem como animar o passado.
    expect(bridge.snapshot().balls).toEqual([{ id: 'ball-1', x: 3, y: 5 }])

    bridge.emitServerMessage({ type: 'balls-updated', balls: [{ id: 'ball-1', x: 9, y: 9 }] })
    expect(bridge.snapshot().balls).toEqual([{ id: 'ball-1', x: 9, y: 9 }])
  })

  it('reduz montaria, movimento e estacionamento no snapshot dos karts', () => {
    const bridge = new OfficeBridge()
    bridge.emitServerMessage({
      type: 'welcome',
      youId: 'ana',
      occupants: [ana],
      karts: [{ id: 'kart-1', x: 12, y: 14, dir: 'up' }],
    })
    bridge.emitServerMessage({
      type: 'kart-ride',
      userId: 'ana',
      active: true,
      kart: { id: 'kart-1', x: 11, y: 14, dir: 'down', riderUserId: 'ana' },
    })
    bridge.emitServerMessage({ type: 'moved', userId: 'ana', x: 11, y: 15, dir: 'down' })

    expect(bridge.snapshot()).toMatchObject({
      occupants: [expect.objectContaining({ userId: 'ana', ridingKartId: 'kart-1' })],
      karts: [expect.objectContaining({ id: 'kart-1', x: 11, y: 15, riderUserId: 'ana' })],
    })

    bridge.emitServerMessage({
      type: 'kart-ride',
      userId: 'ana',
      active: false,
      kart: { id: 'kart-1', x: 11, y: 15, dir: 'down' },
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
  it('emitClientMessage chega aos handlers; onMoveIntent NÃO dispara por ele', () => {
    const bridge = new OfficeBridge()
    const client: OfficeClientMessage[] = []
    const moves: string[] = []
    bridge.onClientMessage((m) => client.push(m))
    bridge.onMoveIntent((intent) => moves.push(intent.dir))

    bridge.emitClientMessage({ type: 'call', targetUserId: 'x' })
    expect(client).toEqual([{ type: 'call', targetUserId: 'x' }])
    expect(moves).toEqual([]) // canal genérico não é o do teclado
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

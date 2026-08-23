import type {
  Direction,
  OfficeClientMessage,
  MoveDirection,
  OfficeBall,
  OfficeKart,
  OfficeNearbyMessageKind,
  OfficeOccupant,
  OfficeServerMessage,
  TilePosition,
} from '@legends/shared'

type Handler<T> = (payload: T) => void

export interface NearbyMessage {
  userId: string
  text: string
  kind?: OfficeNearbyMessageKind
}

/**
 * Intenção de movimento vinda do teclado — direção + se Shift (corrida) está
 * pressionado. `dir` é de PASSO (`MoveDirection`, inclui diagonais), não o
 * facing do sprite: quem converte é `facingForMove`.
 */
export interface MoveIntent {
  dir: MoveDirection
  sprint: boolean
  /** Sequência do passo (ver `OfficeBridge.nextMoveSeq`); ausente = não previsto. */
  seq?: number
}

/** Mudança de estado de fala (LiveKit) de um ocupante — 100% local ao navegador, nunca vai ao servidor. */
export interface SpeakingChanged {
  userId: string
  speaking: boolean
}

/**
 * Única fronteira entre o React e o Phaser.
 *
 * O jogo é imperativo e vive fora do ciclo de render: passar estado por props
 * faria cada re-render tentar reconstruir a cena. Aqui o hook empurra eventos
 * do servidor para dentro (`emitServerMessage`) e a cena empurra a intenção do
 * teclado para fora (`emitMoveIntent`), sem que nenhum dos dois conheça o outro.
 *
 * O bridge também guarda o snapshot autoritativo (quem está no escritório e
 * quem é "você"). Isso existe por causa de uma corrida real: o WebSocket abre
 * e o `welcome` chega muito antes do `import('phaser')` (~1.4 MB) resolver e a
 * cena se inscrever via `onServerMessage`. Sem estado aqui, aquele `welcome`
 * — que carrega a lista completa, incluindo você mesmo — é simplesmente
 * perdido para sempre, e a cena nasce sem nenhum personagem. Por isso
 * `onServerMessage` reproduz um `welcome` sintético para quem se inscreve
 * depois que o real já passou.
 */
export class OfficeBridge {
  private serverHandlers = new Set<Handler<OfficeServerMessage>>()
  private moveHandlers = new Set<Handler<MoveIntent>>()
  private clickHandlers = new Set<Handler<string>>()
  private deskClickHandlers = new Set<Handler<string>>()
  private deskHoverHandlers = new Set<Handler<string | null>>()
  private deskReminderClickHandlers = new Set<Handler<string>>()
  private mapRightClickHandlers = new Set<Handler<TilePosition>>()
  private clientHandlers = new Set<Handler<OfficeClientMessage>>()
  private nearbyMessageHandlers = new Set<Handler<NearbyMessage>>()
  private speakingHandlers = new Set<Handler<SpeakingChanged>>()

  private occupants = new Map<string, OfficeOccupant>()
  private karts = new Map<string, OfficeKart>()
  /** Onde cada bola parou, na versão do servidor — o mesmo papel de `karts`. */
  private balls = new Map<string, OfficeBall>()
  /** Espelha `confettiActive` do hub — necessário pro replay sintético (ver `onServerMessage`) não perder quem já está segurando F. */
  private confettiActiveIds = new Set<string>()
  /** Espelha `raisedHandActive` do hub (mesmo papel de `confettiActiveIds`) — quem está com a mão levantada em qualquer lugar do escritório, pro replay sintético não perder o ícone de quem já levantou. */
  private handRaisedActiveIds = new Set<string>()
  /** Espelha quem está ativamente editando (mesmo papel de `confettiActiveIds`), refletido de `welcome.editorUserIds` e `editors-changed`. */
  private editingActiveIds = new Set<string>()
  /** Espelha `lockedRooms` do hub (mesmo papel de `confettiActiveIds`) — salas trancadas nesta sessão, pro replay sintético não perder o cadeado. */
  private lockedRoomIds = new Set<string>()
  private youId: string | null = null
  private movementLocked = false
  /** Contador monotônico dos passos enviados (ver `nextMoveSeq`). */
  private moveSeq = 0
  /** Flag mutável (como `movementLocked`): true enquanto EU tenho edição não salva, pra suprimir refetch. */
  private editingDirty = false
  /** Um `map-decor-updated` chegou enquanto `editingDirty` era true — ver `setEditingDirty`. */
  private pendingDecorRefetch = false
  private decorRefetchHandlers = new Set<() => void>()
  /** Espelho do WebSocket (useOfficeSocket) — a cena só prevê movimento conectada. */
  private connected = false
  /** Distingue "nunca chegou welcome" de "chegou um welcome com 0 ocupantes". */
  private welcomed = false

  onServerMessage(handler: Handler<OfficeServerMessage>): () => void {
    this.serverHandlers.add(handler)
    if (this.welcomed) {
      // Reproduz o estado atual só para ESTE handler — os demais já viram o
      // welcome real (ou o sintético deles) quando se inscreveram.
      handler({
        type: 'welcome',
        youId: this.youId as string,
        occupants: [...this.occupants.values()],
        confettiUserIds: [...this.confettiActiveIds],
        handRaisedUserIds: [...this.handRaisedActiveIds],
        editorUserIds: [...this.editingActiveIds],
        lockedRoomIds: [...this.lockedRoomIds],
        karts: [...this.karts.values()],
        balls: [...this.balls.values()],
      })
    }
    return () => this.serverHandlers.delete(handler)
  }

  emitServerMessage(message: OfficeServerMessage): void {
    this.applyToSnapshot(message)
    for (const handler of this.serverHandlers) handler(message)
  }

  /** Mantém o snapshot em dia — a única fonte é o servidor, nada é inferido aqui. */
  private applyToSnapshot(message: OfficeServerMessage): void {
    switch (message.type) {
      case 'welcome':
        this.welcomed = true
        this.youId = message.youId
        this.occupants = new Map(message.occupants.map((o) => [o.userId, o]))
        this.karts = new Map((message.karts ?? []).map((kart) => [kart.id, kart]))
        this.balls = new Map((message.balls ?? []).map((ball) => [ball.id, ball]))
        this.confettiActiveIds = new Set(message.confettiUserIds ?? [])
        this.handRaisedActiveIds = new Set(message.handRaisedUserIds ?? [])
        this.editingActiveIds = new Set(message.editorUserIds ?? [])
        this.lockedRoomIds = new Set(message.lockedRoomIds ?? [])
        break
      case 'room-lock-changed':
        if (message.locked) this.lockedRoomIds.add(message.roomId)
        else this.lockedRoomIds.delete(message.roomId)
        break
      case 'confetti':
        if (message.active) this.confettiActiveIds.add(message.userId)
        else this.confettiActiveIds.delete(message.userId)
        break
      case 'hand-raised':
        if (message.active) this.handRaisedActiveIds.add(message.userId)
        else this.handRaisedActiveIds.delete(message.userId)
        break
      case 'joined':
        this.occupants.set(message.occupant.userId, message.occupant)
        break
      case 'left':
        this.occupants.delete(message.userId)
        this.confettiActiveIds.delete(message.userId)
        this.handRaisedActiveIds.delete(message.userId)
        break
      case 'moved': {
        const occupant = this.occupants.get(message.userId)
        if (occupant) {
          const next = { ...occupant, x: message.x, y: message.y, dir: message.dir }
          delete next.thoughtText
          this.occupants.set(message.userId, next)
          if (occupant.ridingKartId) {
            const kart = this.karts.get(occupant.ridingKartId)
            if (kart) this.karts.set(kart.id, { ...kart, x: message.x, y: message.y, dir: message.dir })
          }
        }
        break
      }
      case 'faced': {
        const occupant = this.occupants.get(message.userId)
        if (occupant) {
          this.occupants.set(message.userId, { ...occupant, dir: message.dir })
          if (occupant.ridingKartId) {
            const kart = this.karts.get(occupant.ridingKartId)
            if (kart) this.karts.set(kart.id, { ...kart, dir: message.dir })
          }
        }
        break
      }
      case 'sync': {
        // Reancoragem de posição recusada: sempre sobre "você".
        if (!this.youId) break
        const occupant = this.occupants.get(this.youId)
        if (occupant) {
          this.occupants.set(this.youId, { ...occupant, x: message.x, y: message.y, dir: message.dir })
        }
        break
      }
      case 'avatar-updated': {
        const occupant = this.occupants.get(message.userId)
        if (occupant) {
          this.occupants.set(message.userId, {
            ...occupant,
            avatarSeed: message.avatarSeed,
            avatarOptions: message.avatarOptions,
          })
        }
        break
      }
      case 'status-changed': {
        const occupant = this.occupants.get(message.userId)
        if (occupant) this.occupants.set(message.userId, { ...occupant, status: message.status })
        break
      }
      case 'character-name-changed': {
        const occupant = this.occupants.get(message.userId)
        if (occupant) this.occupants.set(message.userId, { ...occupant, characterName: message.name })
        break
      }
      case 'nearby-message': {
        if (message.kind !== 'thought') break
        const occupant = this.occupants.get(message.userId)
        if (occupant) this.occupants.set(message.userId, { ...occupant, thoughtText: message.text })
        break
      }
      case 'map-changed':
        break
      case 'kart-ride': {
        this.karts.set(message.kart.id, message.kart)
        const occupant = this.occupants.get(message.userId)
        if (occupant) {
          const next = { ...occupant }
          if (message.active) next.ridingKartId = message.kart.id
          else delete next.ridingKartId
          this.occupants.set(message.userId, next)
        }
        break
      }
      case 'karts-updated':
        this.karts = new Map(message.karts.map((kart) => [kart.id, kart]))
        break
      case 'ball-kicked': {
        // Só o tile FINAL entra no snapshot: quem se inscrever no meio da
        // rolagem recebe a bola parada onde ela vai parar, não onde está no
        // meio da animação — replay sintético não tem como animar o passado.
        const landing = message.kick.path.at(-1)
        if (landing) {
          this.balls.set(message.kick.ballId, {
            id: message.kick.ballId,
            x: landing.x,
            y: landing.y,
          })
        }
        break
      }
      case 'balls-updated':
        this.balls = new Map(message.balls.map((ball) => [ball.id, ball]))
        break
      case 'editors-changed':
        this.editingActiveIds = new Set(message.userIds)
        break
    }
  }

  /** Snapshot atual — usado pelo hook para espelhar o estado do bridge no React. */
  snapshot(): {
    youId: string | null
    occupants: OfficeOccupant[]
    editorUserIds: string[]
    karts: OfficeKart[]
    balls: OfficeBall[]
  } {
    return {
      youId: this.youId,
      occupants: [...this.occupants.values()],
      editorUserIds: [...this.editingActiveIds],
      karts: [...this.karts.values()],
      balls: [...this.balls.values()],
    }
  }

  /**
   * Occupant completo (nome/avatar/etc) de um userId específico, se
   * conhecido — usado pela cena do Phaser pra se auto-recuperar quando um
   * `moved` chega pra alguém sem `CharacterView` local (ver `OfficeScene.step`):
   * o bridge já tem o snapshot completo, sem precisar de round-trip com o servidor.
   */
  occupantSnapshot(userId: string): OfficeOccupant | null {
    return this.occupants.get(userId) ?? null
  }

  /**
   * Numera os passos mandados ao servidor. O contador é do bridge (e não da
   * cena) porque é o bridge que sobrevive a remontagens do canvas — reiniciar
   * a numeração no meio da sessão faria um `sync` atrasado casar com a
   * predição errada.
   */
  nextMoveSeq(): number {
    this.moveSeq += 1
    return this.moveSeq
  }

  onMoveIntent(handler: Handler<MoveIntent>): () => void {
    this.moveHandlers.add(handler)
    return () => this.moveHandlers.delete(handler)
  }

  emitMoveIntent(intent: MoveIntent): void {
    if (this.movementLocked) return
    for (const handler of this.moveHandlers) handler(intent)
  }

  setMovementLocked(locked: boolean): void {
    this.movementLocked = locked
  }

  isMovementLocked(): boolean {
    return this.movementLocked
  }

  /**
   * Marca/limpa edição não salva — suprime refetch do mapa enquanto há edição
   * em andamento (`mapMessageEffect`). Ao voltar para `false`, dispara
   * qualquer refetch que ficou pendente (`deferDecorRefetch`) — é o que evita
   * a mobília recém-salva ficar com a "moldura" de edição (estampa pendente)
   * até um F5 quando o broadcast do próprio Salvar chega ANTES do React
   * terminar de propagar `dirty: false` até aqui (ver `mapMessage.ts`).
   */
  setEditingDirty(dirty: boolean): void {
    this.editingDirty = dirty
    if (!dirty && this.pendingDecorRefetch) {
      this.pendingDecorRefetch = false
      for (const handler of this.decorRefetchHandlers) handler()
    }
  }

  isEditingDirty(): boolean {
    return this.editingDirty
  }

  /** Registra que um `map-decor-updated` chegou enquanto a edição estava suja — ver `setEditingDirty`. */
  deferDecorRefetch(): void {
    this.pendingDecorRefetch = true
  }

  /** Chamado quando um refetch de decoração que tinha ficado pendente finalmente pode rodar. */
  onDecorRefetchAvailable(handler: () => void): () => void {
    this.decorRefetchHandlers.add(handler)
    return () => this.decorRefetchHandlers.delete(handler)
  }

  setConnected(connected: boolean): void {
    this.connected = connected
  }

  isConnected(): boolean {
    return this.connected
  }

  /** Cena → React: um personagem foi clicado (só o userId; o React resolve o resto). */
  onCharacterClick(handler: Handler<string>): () => void {
    this.clickHandlers.add(handler)
    return () => this.clickHandlers.delete(handler)
  }

  emitCharacterClick(userId: string): void {
    for (const handler of this.clickHandlers) handler(userId)
  }

  /** Cena → React: uma mesa foi clicada (externalKey da mesa no documento do mapa). */
  onDeskClick(handler: Handler<string>): () => void {
    this.deskClickHandlers.add(handler)
    return () => this.deskClickHandlers.delete(handler)
  }

  emitDeskClick(externalKey: string): void {
    for (const handler of this.deskClickHandlers) handler(externalKey)
  }

  /** Cena → React: o mouse entrou/saiu de uma mesa (`null` = nenhuma mais em hover). */
  onDeskHover(handler: Handler<string | null>): () => void {
    this.deskHoverHandlers.add(handler)
    return () => this.deskHoverHandlers.delete(handler)
  }

  emitDeskHover(externalKey: string | null): void {
    for (const handler of this.deskHoverHandlers) handler(externalKey)
  }

  /** Cena → React: um presente de lembrete foi clicado. */
  onDeskReminderClick(handler: Handler<string>): () => void {
    this.deskReminderClickHandlers.add(handler)
    return () => this.deskReminderClickHandlers.delete(handler)
  }

  emitDeskReminderClick(reminderId: string): void {
    for (const handler of this.deskReminderClickHandlers) handler(reminderId)
  }

  /** Cena → React: clique direito num tile do mapa (andar até lá, como o Ctrl/Cmd+D anda até a mesa). */
  onMapRightClick(handler: Handler<TilePosition>): () => void {
    this.mapRightClickHandlers.add(handler)
    return () => this.mapRightClickHandlers.delete(handler)
  }

  emitMapRightClick(tile: TilePosition): void {
    for (const handler of this.mapRightClickHandlers) handler(tile)
  }

  /**
   * Canal genérico React → servidor (call, call-response, e os moves do
   * FollowController). Separado de `emitMoveIntent`, que é só o TECLADO —
   * assim o follow pode ser cancelado ao ouvir `onMoveIntent` sem se
   * autocancelar com os próprios passos.
   */
  onClientMessage(handler: Handler<OfficeClientMessage>): () => void {
    this.clientHandlers.add(handler)
    return () => this.clientHandlers.delete(handler)
  }

  emitClientMessage(message: OfficeClientMessage): void {
    for (const handler of this.clientHandlers) handler(message)
  }

  onNearbyMessage(handler: Handler<NearbyMessage>): () => void {
    this.nearbyMessageHandlers.add(handler)
    return () => this.nearbyMessageHandlers.delete(handler)
  }

  emitNearbyMessage(message: NearbyMessage): void {
    for (const handler of this.nearbyMessageHandlers) handler(message)
  }

  /**
   * React → cena, só neste navegador: quem está falando agora (LiveKit
   * `ActiveSpeakersChanged`). Diferente de `emitClientMessage`, isto NUNCA
   * vai para o servidor — cada aba calcula sua própria visão de quem fala a
   * partir da própria conexão LiveKit.
   */
  onSpeakingChanged(handler: Handler<SpeakingChanged>): () => void {
    this.speakingHandlers.add(handler)
    return () => this.speakingHandlers.delete(handler)
  }

  emitSpeakingChanged(payload: SpeakingChanged): void {
    for (const handler of this.speakingHandlers) handler(payload)
  }
}

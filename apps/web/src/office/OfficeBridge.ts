import type {
  BodyInput,
  Direction,
  OfficeClientMessage,
  MoveDirection,
  OfficeBall,
  OfficeKart,
  OfficeNearbyMessageKind,
  OfficeOccupant,
  OfficeRoomManager,
  OfficeServerMessage,
  PaintSplat,
  TilePosition,
} from '@legends/shared'

type Handler<T> = (payload: T) => void

/**
 * De onde veio um `input`: a tecla de uma pessoa ou a caminhada automática.
 *
 * Existe porque as duas passam pelo MESMO caminho desde o movimento livre — o
 * Seguir "segura a tecla" e é a amostragem do quadro que a transforma em
 * deslocamento. Sem a procedência, quem cancela o Seguir ao ver alguém assumir o
 * controle cancela também o input que o próprio Seguir acabou de gerar: um passo
 * e para.
 */
export type OfficeInputSource = 'keyboard' | 'auto'

type InputHandler = (input: BodyInput, source: OfficeInputSource) => void

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
  private moveHandlers = new Set<InputHandler>()
  private autoWalkHandlers = new Set<Handler<MoveDirection | null>>()
  private selfBodyHandlers = new Set<Handler<{ x: number; y: number }>>()
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
  /**
   * Marcas de tinta vivas, por id — mesmo papel de `balls`: o replay sintético
   * precisa delas para que a cena montada DEPOIS do `welcome` não nasça com os
   * personagens limpos enquanto o servidor ainda os considera pintados.
   *
   * Guardadas com o instante em que vencem, e não com o `ttlMs` que chegou:
   * sem isso o mapa cresceria a sessão inteira (nada aqui apaga marca vencida)
   * e o replay entregaria à cena manchas que já deviam ter sumido. Como no
   * hub, quem lê é quem poda — `livePaintSplats`.
   */
  private paintSplats = new Map<string, PaintSplat & { expiresAt: number }>()
  /** Espelha `confettiActive` do hub — necessário pro replay sintético (ver `onServerMessage`) não perder quem já está segurando F. */
  private confettiActiveIds = new Set<string>()
  /** Espelha `raisedHandActive` do hub (mesmo papel de `confettiActiveIds`) — quem está com a mão levantada em qualquer lugar do escritório, pro replay sintético não perder o ícone de quem já levantou. */
  private handRaisedActiveIds = new Set<string>()
  /** Espelha quem está ativamente editando (mesmo papel de `confettiActiveIds`), refletido de `welcome.editorUserIds` e `editors-changed`. */
  private editingActiveIds = new Set<string>()
  /** Espelha `lockedRooms` do hub (mesmo papel de `confettiActiveIds`) — salas trancadas nesta sessão, pro replay sintético não perder o cadeado. */
  private lockedRoomIds = new Set<string>()
  /** Espelha os managers de sala do hub (mesmo papel de `lockedRoomIds`) — quem manda em cada sala, pro replay sintético não perder o selo. */
  private roomManagers: OfficeRoomManager[] = []
  private youId: string | null = null
  private movementLocked = false
  /** Flag mutável (como `movementLocked`): true enquanto EU tenho edição não salva, pra suprimir refetch. */
  private editingDirty = false
  /** Um `map-decor-updated` chegou enquanto `editingDirty` era true — ver `setEditingDirty`. */
  private pendingDecorRefetch = false
  private decorRefetchHandlers = new Set<() => void>()
  /** Espelho do WebSocket (useOfficeSocket) — a cena só prevê movimento conectada. */
  private connected = false
  /** Distingue "nunca chegou welcome" de "chegou um welcome com 0 ocupantes". */
  private welcomed = false
  /**
   * Último `seq` SEU que o servidor confirmou.
   *
   * Guardado aqui porque o `welcome` SINTÉTICO precisa dele: a cena remonta
   * (StrictMode, HMR, troca de rota) sem que o socket caia, e um preditor novo
   * começando do zero teria todo input descartado como atrasado — o personagem
   * andaria até a primeira remontagem e nunca mais sairia do lugar.
   *
   * Sai do snapshot, e não só do `welcome`: é o valor VIVO, e é o que faz a
   * retomada valer também para quem remonta a cena no meio de uma caminhada.
   */
  private lastSelfSeq = 0

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
        roomManagers: [...this.roomManagers],
        karts: [...this.karts.values()],
        balls: [...this.balls.values()],
        paintSplats: this.livePaintSplats(),
        seq: this.lastSelfSeq,
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
        // Só AVANÇA: o `welcome` sintético carrega o valor guardado, e deixá-lo
        // sobrescrever com um número menor desfaria a retomada que ele existe
        // para fazer.
        if ((message.seq ?? 0) > this.lastSelfSeq) this.lastSelfSeq = message.seq ?? 0
        this.occupants = new Map(message.occupants.map((o) => [o.userId, o]))
        this.karts = new Map((message.karts ?? []).map((kart) => [kart.id, kart]))
        this.balls = new Map((message.balls ?? []).map((ball) => [ball.id, ball]))
        this.paintSplats = new Map(
          (message.paintSplats ?? []).map((splat) => [
            splat.id,
            { ...splat, expiresAt: Date.now() + splat.ttlMs },
          ]),
        )
        this.confettiActiveIds = new Set(message.confettiUserIds ?? [])
        this.handRaisedActiveIds = new Set(message.handRaisedUserIds ?? [])
        this.editingActiveIds = new Set(message.editorUserIds ?? [])
        this.lockedRoomIds = new Set(message.lockedRoomIds ?? [])
        this.roomManagers = message.roomManagers ?? []
        break
      case 'room-managers-changed':
        this.roomManagers = message.managers
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
        for (const [id, splat] of this.paintSplats) {
          if (splat.userId === message.userId) this.paintSplats.delete(id)
        }
        break
      case 'snapshot': {
        for (const ball of message.balls ?? []) this.balls.set(ball.id, { ...ball })
        const eu = message.players.find((player) => player.userId === this.youId)
        if (eu && eu.seq > this.lastSelfSeq) this.lastSelfSeq = eu.seq
        // O bridge guarda a posição para quem NÃO é a cena (overlay de vídeo,
        // painéis, `useOfficeKarts`). A cena não lê daqui — ela prevê e
        // interpola no quadro, e passar por este mapa a 20Hz seria um
        // `setState` por pacote na árvore inteira.
        for (const player of message.players) {
          const occupant = this.occupants.get(player.userId)
          if (!occupant) continue
          // O pensamento NÃO morre aqui: o snapshot repete todo mundo sempre
          // que alguém se mexe, e apagar em bloco tirava o pensamento de quem
          // estava parado pensando. Quem manda apagar é o servidor, por
          // `thought-cleared`.
          const next = { ...occupant, x: player.x, y: player.y, dir: player.dir }
          this.occupants.set(player.userId, next)
          if (occupant.ridingKartId) {
            const kart = this.karts.get(occupant.ridingKartId)
            if (kart) this.karts.set(kart.id, { ...kart, x: player.x, y: player.y, dir: player.dir })
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
      case 'thought-cleared': {
        const occupant = this.occupants.get(message.userId)
        if (!occupant) break
        const next = { ...occupant }
        delete next.thoughtText
        this.occupants.set(message.userId, next)
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
      case 'ball-kicked':
        // Guarda a bola COM a velocidade: quem se inscrever no meio da rolagem
        // recebe o estado de onde ela está e para onde vai, e a cena continua a
        // integração dali — antes só dava para guardar o tile final, porque a
        // trajetória vinha resolvida de uma vez.
        this.balls.set(message.ball.id, { ...message.ball })
        break
      case 'balls-updated':
        this.balls = new Map(message.balls.map((ball) => [ball.id, ball]))
        break
      case 'paint-marker': {
        const occupant = this.occupants.get(message.userId)
        if (occupant) {
          const next = { ...occupant }
          if (message.active) next.paintMarker = true
          else delete next.paintMarker
          this.occupants.set(message.userId, next)
        }
        break
      }
      case 'paintball-shot': {
        // Só a MARCA entra no snapshot; o voo da bolinha não, pelo mesmo
        // motivo do chute: replay sintético não anima o passado.
        const { splat } = message.shot
        if (splat) this.paintSplats.set(splat.id, { ...splat, expiresAt: Date.now() + splat.ttlMs })
        break
      }
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
    paintSplats: PaintSplat[]
  } {
    return {
      youId: this.youId,
      occupants: [...this.occupants.values()],
      editorUserIds: [...this.editingActiveIds],
      karts: [...this.karts.values()],
      balls: [...this.balls.values()],
      paintSplats: this.livePaintSplats(),
    }
  }

  /**
   * Marcas que ainda não venceram, com o `ttlMs` restante — a ÚNICA leitura de
   * `paintSplats`, e por isso quem poda as vencidas. Mesmo desenho do hub:
   * marca de tinta não merece um timer por unidade.
   */
  private livePaintSplats(): PaintSplat[] {
    const now = Date.now()
    const live: PaintSplat[] = []
    for (const [id, { expiresAt, ...splat }] of this.paintSplats) {
      if (expiresAt <= now) this.paintSplats.delete(id)
      else live.push({ ...splat, ttlMs: expiresAt - now })
    }
    return live
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
   * Intenção contínua do TECLADO, a caminho do servidor.
   *
   * Quem numera (`seq`) agora é o preditor da cena, não o bridge: o `seq` deixou
   * de ser "o identificador daquele passo, para o `sync` desfazer exatamente
   * ele" e passou a ser "até onde o servidor já processou". Ele pertence a quem
   * mantém a fila de não confirmados, que é o preditor.
   */
  /**
   * Direção que a caminhada automática quer manter — `null` para soltar.
   *
   * O Seguir deixou de mandar passo por mensagem: no movimento contínuo não há
   * passo, há intenção. Ele agora "segura a tecla" por você, e quem transforma
   * isso em deslocamento é a mesma amostragem de input do teclado, na cena. Sem
   * isso haveria dois caminhos até o servidor, e só um deles passaria pela
   * predição — o personagem andaria de teleporte quando estivesse seguindo.
   */
  onAutoWalk(handler: Handler<MoveDirection | null>): () => void {
    this.autoWalkHandlers.add(handler)
    return () => this.autoWalkHandlers.delete(handler)
  }

  emitAutoWalk(dir: MoveDirection | null): void {
    for (const handler of this.autoWalkHandlers) handler(dir)
  }

  /**
   * Posição PREVISTA do próprio corpo, em pixel, na cadência do input.
   *
   * É a volta do `onAutoWalk`: quem segura a tecla precisa saber onde o corpo
   * está para decidir quando virar a esquina e quando soltar. O snapshot não
   * serve para isso — ele chega um round-trip atrasado, e esterçar por ele
   * viraria depois da esquina. Fica no bridge (e não num acoplamento direto
   * cena↔React) pelo mesmo motivo do resto: nenhum dos dois lados conhece o
   * outro.
   *
   * Nunca vai para o servidor: o que o servidor recebe é o `input`.
   */
  onSelfBody(handler: Handler<{ x: number; y: number }>): () => void {
    this.selfBodyHandlers.add(handler)
    return () => this.selfBodyHandlers.delete(handler)
  }

  emitSelfBody(body: { x: number; y: number }): void {
    for (const handler of this.selfBodyHandlers) handler(body)
  }

  onInput(handler: InputHandler): () => void {
    this.moveHandlers.add(handler)
    return () => this.moveHandlers.delete(handler)
  }

  /** `source` diz quem pediu o passo — ver `OfficeInputSource`. */
  emitInput(input: BodyInput, source: OfficeInputSource = 'keyboard'): void {
    if (this.movementLocked) return
    for (const handler of this.moveHandlers) handler(input, source)
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
   * Canal genérico React → servidor (call, call-response, …). Separado de
   * `emitInput`, que é só o TECLADO — assim o follow pode ser cancelado ao
   * ouvir `onInput` sem se autocancelar com os próprios passos.
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

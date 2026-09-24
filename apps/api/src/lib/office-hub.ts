import {
  stepBodyKart,
  type BodyKartState,
  fireBodyShot,
  officeKickBall,
  stepBodyBall,
  touchBodyBall,
  BODY_SPEED,
  BODY_SPRINT_FACTOR,
  stepBodyAmongBlockers,
  bodyCollisionGrid,
  bodySpawnPoint,
  BODY_TICK_HZ,
  BODY_SNAPSHOT_HZ,
  BODY_MAX_PENDING_INPUTS,
  BODY_MAX_STEP_MS,
  BODY_TIME_BUDGET_CAP_MS,
  TILE_SIZE,
  type BodyBlocker,
  type BodyCollisionGrid,
  type BodyInput,
  ballDistanceFrom,
  canStepTo,
  DIRECTION_DELTAS,
  facingForMove,
  MOVE_DIRECTION_DELTAS,
  HIGH_FIVE_EMOJI,
  isBallInReach,
  PAINTBALL_COOLDOWN_MS,
  PAINTBALL_MAX_SPLATS,
  isMapTileWalkable,
  mapBalls,
  mapKarts,
  mapSpawnTiles,
  mapZoneAtTile,
  claimedDeskInMeetingRoom,
  officeRoomForTile,
  officeHash,
  REACTION_ACTIVE_WINDOW_MS,
  PERFECT_HIGH_FIVE_CHANCE,
  parseYouTubePlaylistId,
  parseYouTubeVideoId,
  ROOM_AUDIO_START_COOLDOWN_MS,
  ROOM_CHAT_MESSAGE_MAX_LENGTH,
  OFFICE_CHARACTER_NAME_MAX_LENGTH,
  OFFICE_NEARBY_MESSAGE_MAX_LENGTH,
  OFFICE_ANNOTATION_STROKE_ID_MAX_LENGTH,
  sanitizeAnnotationPoints,
  type AvatarStyleKey,
  type CharacterOptions,
  type Direction,
  type MoveDirection,
  type OfficeNearbyMessageKind,
  type OfficeBall,
  type OfficeBallPower,
  type OfficeKart,
  type PaintSplat,
  type OfficeOccupant,
  type OfficeRoomAudioDeniedReason,
  type OfficeRoomAudioEntry,
  type OfficeRoomManager,
  type OfficeRoomEntryDeniedReason,
  type OfficeServerMessage,
  type OfficeUserStatus,
  type ActiveOfficeMapDTO,
  type OfficeDeskReminderSummaryDTO,
} from '@legends/shared'

/** O mínimo que o hub precisa de um socket — mantém o hub testável sem WS. */
export interface OfficeSocket {
  send(data: string): void
}

/**
 * Faixa tocando numa sala. O tempo é guardado como "base + desde quando toca"
 * em vez de um instante de início: pausar vira `playingSinceMs: null` e a
 * posição congela sem nenhuma conta especial, e retomar volta a andar do ponto
 * exato em que parou.
 */
interface RoomAudioEntry {
  videoId: string
  /** Playlist de onde o item saiu; `null` num vídeo sozinho. */
  playlistId: string | null
  playlistIndex: number
  startedByUserId: string
  startedByName: string
  /** Segundos já tocados antes da pausa atual (ou de todas as anteriores). */
  positionBaseSeconds: number
  /** Desde quando está tocando; `null` enquanto pausada. */
  playingSinceMs: number | null
}

export interface OfficeUser {
  id: string
  name: string
  isGuest?: boolean
  /** ADMIN da empresa: modera qualquer sala, mesmo sem ser manager dela. */
  isAdmin?: boolean
  officeCharacterName?: string | null
  photoUrl: string | null
  avatarStyle: AvatarStyleKey | null
  avatarSeed: string | null
  avatarOptions: CharacterOptions | null
}

/**
 * Token bucket: até BURST passos instantâneos, repondo MOVES_PER_SECOND por
 * segundo. O teto cobre tanto o passo normal quanto a corrida (Shift) — não
 * há bucket separado; correr só consome tokens mais rápido, dentro do mesmo
 * teto. Dobrado (era 10/10) para acomodar a cadência de corrida do cliente
 * (~12.5 passos/s efetivos) com a mesma folga proporcional de antes.
 */
const MOVES_PER_SECOND = 20
const BURST = 20

/**
 * Token bucket do rate limit de `screenAnnotation` — mesmo padrão de
 * MOVES_PER_SECOND/BURST. É a mensagem de maior volume legítimo do hub
 * (~16.7 msg/s por traço, um lote a cada OFFICE_ANNOTATION_BATCH_MS = 60ms)
 * com o maior fanout (broadcast pra sala/zona ou pro escritório inteiro) e,
 * antes desta correção, era a única sem nenhum teto de frequência. Folga
 * sobre a cadência legítima para o lote de fechamento de um traço (que sai
 * na hora, fora do intervalo de 60ms) não esbarrar no limite.
 */
const ANNOTATION_MESSAGES_PER_SECOND = 20
const ANNOTATION_BURST = 20

/** Intervalo mínimo entre chamadas iniciadas pelo mesmo usuário (anti-spam). */
export const CALL_COOLDOWN_MS = 3000

/** Quantas pessoas segurando F ao mesmo tempo disparam a comemoração coletiva. */
export const CELEBRATION_THRESHOLD = 5
/** Janela mínima entre comemorações — evita re-disparo com o grupo oscilando em 4↔5. */
export const CELEBRATION_COOLDOWN_MS = 4000

/**
 * Janela mínima entre dois high-fives do MESMO par. Calibrado pela DURAÇÃO DA
 * ANIMAÇÃO no cliente (250ms de aproximação + 120ms de pop ida/volta + 200ms de
 * fade ≈ 690ms) — a única coisa que este cooldown precisa evitar é a animação
 * empilhar sobre si mesma.
 *
 * Quem regula a cadência de verdade é o consumo das reações em
 * `evaluateHighFive`: depois de bater, os DOIS precisam acenar de novo. Um
 * cooldown longo aqui (já foi 3000, espelhando o do confete) somava-se ao
 * consumo e fazia o segundo high-five demorar ~7s na prática — o aceno de um
 * caía no vazio enquanto o do outro ainda estava travado.
 */
export const HIGH_FIVE_COOLDOWN_MS = 700

/**
 * Período de graça entre a última aba de alguém cair e a saída se efetivar
 * de fato — cobre uma reconexão automática do cliente (backoff de até 15s
 * por tentativa, `useOfficeSocket.ts`) sem respawnar a pessoa no spawn nem
 * avisar os outros de uma queda que nem chegou a ser definitiva.
 */
export const RECONNECT_GRACE_MS = 45_000

/** Intervalo mínimo entre pedidos de entrada do mesmo usuário (anti-spam, como `CALL_COOLDOWN_MS`). */
export const KNOCK_COOLDOWN_MS = 3000

/**
 * Intervalo mínimo entre dois `room-entry-denied` para o mesmo usuário. Quem
 * segura a seta contra uma porta trancada gera uma recusa por passo (até
 * `MOVES_PER_SECOND`); sem isto, uma tecla presa viraria uma enxurrada de
 * mensagens para reabrir o mesmo popup.
 */
export const ENTRY_DENIED_THROTTLE_MS = 1500

interface Bucket {
  tokens: number
  updatedAt: number
}

interface Entry {
  occupant: OfficeOccupant
  sockets: Set<OfficeSocket>
  /** Inputs recebidos e ainda não simulados, em ordem de chegada. */
  pending: BodyInput[]
  /** Último `seq` já aplicado — volta no snapshot e guia a reconciliação. */
  lastSeq: number
  /** Tempo de simulação creditado e ainda não gasto (ver `BODY_TIME_BUDGET_CAP_MS`). */
  budgetMs: number
  /**
   * O tile COMITADO — não o tile em que o centro está agora.
   *
   * É contra ele que a borda é detectada. Ficam separados porque, com posição
   * contínua, dá para parar exatamente em cima da divisa e oscilar: sem
   * histerese, entrar/sair de sala dispararia várias vezes por segundo, e o som
   * de presença viraria um picote (ver `TILE_COMMIT_MARGIN`).
   */
  tile: { x: number; y: number }
  /**
   * A última intenção aplicada, e quando. É ela que diz se a pessoa CONDUZ a
   * bola ou só está no caminho dela — e o instante existe porque input que
   * parou de chegar (aba em segundo plano, rede caída) não pode deixar alguém
   * conduzindo para sempre.
   */
  lastMove: { dx: number; dy: number; sprint: boolean }
  lastMoveAt: number
  speed: number
  /**
   * O que foi no último snapshot. É a base da SUPRESSÃO: escritório parado não
   * pode custar 20 pacotes por segundo por pessoa, que é o que o modelo de
   * snapshot cobraria se emitisse sempre.
   */
  sent: { x: number; y: number; dir: Direction; seq: number; sprint: boolean } | null
}

/** Quantos ticks entre dois snapshots. Inteiro por construção (ver `BODY_TICK_HZ`). */
const TICKS_PER_SNAPSHOT = Math.round(BODY_TICK_HZ / BODY_SNAPSHOT_HZ)

/**
 * Quanto o centro precisa entrar num tile novo para ele valer como comitado.
 *
 * A histerese que impede o picote na divisa. Parar em cima da linha entre dois
 * tiles é comum (encostado numa parede, por exemplo), e sem margem o tile
 * derivado alterna a cada quadro — disparando entrar/sair de sala, som de
 * presença e fila de mão levantada dezenas de vezes por segundo.
 *
 * Pequena de propósito: a porta tem de responder na hora, não depois de um
 * passo inteiro.
 */
const TILE_COMMIT_MARGIN = 3

/**
 * Por quanto tempo a última intenção de passo continua valendo — o mesmo
 * raciocínio (e o mesmo valor) da arena.
 */
const MOVE_INTENT_TTL_MS = 200

/**
 * Estado do escritório virtual — inteiramente em memória, por instância.
 * Presença é efêmera por decisão de design: fechou a última aba, saiu do mapa;
 * reiniciou o processo, todo mundo respawna. Nada aqui toca o Postgres.
 *
 * O servidor é autoritativo: o cliente só manda intenção (`move: dir`) e o hub
 * decide se o passo acontece. Um cliente adulterado não atravessa parede nem
 * teleporta.
 */
export class OfficeHub {
  private runtime: ActiveOfficeMapDTO | null = null
  /** Veículos dinâmicos, sem persistência: nascem dos assets da publicação. */
  private kartStates = new Map<string, OfficeKart>()
  /** O laço de simulação; `null` com o escritório vazio. */
  private timer: ReturnType<typeof setInterval> | null = null
  private tickCount = 0
  private lastTickAt = 0

  /**
   * Onde cada bola está AGORA. Some ao reiniciar o hub e volta para a posição
   * do editor a cada publicação — bola parada onde alguém chutou ontem não é
   * estado que valha um banco.
   */
  private ballStates = new Map<string, OfficeBall>()

  /**
   * Marcas de tinta vivas, por usuário que as levou. Como a bola, existem só
   * em memória: tinta de ontem não é estado que valha um banco.
   *
   * Cada marca guarda o instante em que vence — e o hub NÃO ganhou timer para
   * expirá-las. A limpeza é preguiçosa (`livePaintSplats`), feita em toda
   * leitura: um `setTimeout` por marca seria estado agendado por empresa para
   * algo que ninguém consulta enquanto não olha.
   */
  private paintSplats = new Map<string, Array<PaintSplat & { expiresAt: number }>>()

  /** Último tiro de cada um — a cadência do marcador (ver `PAINTBALL_COOLDOWN_MS`). */
  private lastPaintballAt = new Map<string, number>()
  private entries = new Map<string, Entry>()
  /**
   * Chaveado por userId (não por socket): várias abas da mesma pessoa
   * dividem um único orçamento de movimento. Se fosse por socket, dava para
   * abrir N abas com o mesmo token e multiplicar por N o limite de 10
   * moves/s — e cada move aceito é broadcast para todo mundo.
   */
  private buckets = new Map<string, Bucket>()
  /**
   * Token bucket do rate limit de `screenAnnotation` — mesmo raciocínio de
   * `buckets` (chaveado por userId, não por socket, para não multiplicar o
   * teto com várias abas da mesma pessoa).
   */
  private annotationBuckets = new Map<string, Bucket>()
  /** Índice reverso: de qual usuário é este socket (evita confiar no userId do caller). */
  private socketOwner = new Map<OfficeSocket, string>()
  /** Último instante (ms) em que cada usuário iniciou uma chamada. */
  private lastCallAt = new Map<string, number>()
  /** Quem está segurando F agora, por userId (não por socket). Some no leave(). */
  private confettiActive = new Set<string>()
  /** De qual socket veio o `active:true` de cada userId — permite limpar o confete certo quando ESSA aba cai, sem mexer em outra aba do mesmo usuário. */
  private confettiSocket = new Map<string, OfficeSocket>()
  /** Usuários atualmente com o editor de decoração aberto (presença efêmera). */
  private editingActive = new Set<string>()
  /** Aba dona do estado de edição por usuário (mesmo papel de confettiSocket ao cair). */
  private editingSocket = new Map<string, OfficeSocket>()
  /** Quem está com a mão levantada agora, em QUALQUER lugar do escritório (não só em sala) — dirige o ícone sobre o personagem. Mesmo padrão do confete: por userId, não por socket. */
  private raisedHandActive = new Set<string>()
  /** De qual socket veio o `active:true` de cada userId — mesmo papel de `confettiSocket`. */
  private raisedHandSocket = new Map<string, OfficeSocket>()
  /** Fila de mãos levantadas por sala (FIFO) — só preenchida por quem levantou a mão DENTRO de uma sala; dirige o contador/lista do topo. Só existe entrada enquanto a fila não está vazia. */
  private raisedHandsByRoom = new Map<string, string[]>()
  /** Índice reverso: em qual sala (se houver) o usuário está na fila. */
  private raisedHandRoomOf = new Map<string, string>()
  /** Último instante (ms) de comemoração — base do cooldown. */
  private lastCelebrationAt = 0
  /**
   * Última reação de cada usuário, para o high-five. Diferente de
   * `confettiActive`, NÃO precisa de um Map de socket paralelo: confete é
   * estado liga/desliga (e só a aba dona pode desligar), reação é evento
   * pontual que expira sozinho pela janela de validade.
   */
  private lastReaction = new Map<string, { emoji: string; at: number }>()
  /** Último high-five por par, chaveado pelos dois ids ordenados. */
  private lastHighFiveAt = new Map<string, number>()
  /** Timer do período de graça (ver `RECONNECT_GRACE_MS`) por userId, enquanto a saída ainda não se efetivou. */
  private pendingLeaves = new Map<string, ReturnType<typeof setTimeout>>()
  /**
   * Salas de reunião trancadas nesta sessão (`room.id`). A tranca é da SALA,
   * não de quem trancou: qualquer ocupante liga/desliga e responde aos
   * pedidos, então quem trancou sair não destranca nada. Ela só cai quando a
   * sala fica vazia (ver `sweepEmptyLockedRooms`).
   */
  private lockedRooms = new Set<string>()
  /** Passe de entrada por sala, concedido no aceite; vale enquanto a tranca durar. */
  private roomEntryGrants = new Map<string, Set<string>>()
  /** Pedidos de entrada em aberto por sala (`room.id` → userIds). */
  private pendingKnocks = new Map<string, string[]>()
  /** Em qual sala cada pessoa tem um pedido aberto — índice reverso de `pendingKnocks`. */
  private knockRoomOf = new Map<string, string>()
  /** Último instante (ms) em que cada usuário pediu para entrar (anti-spam, como `lastCallAt`). */
  private lastKnockAt = new Map<string, number>()
  /** Último `room-entry-denied` por usuário — ver `ENTRY_DENIED_THROTTLE_MS`. */
  private lastEntryDeniedAt = new Map<string, number>()
  /**
   * Áudio tocando em cada sala (`room.id`), uma faixa por sala. Ao contrário
   * da tranca, a faixa é de QUEM INICIOU: só ele para, e ela morre quando ele
   * sai da sala ou do escritório (ver `clearRoomAudioIfOwnerLeft`).
   *
   * `startedAtMs` fica só aqui dentro — o que sai na mensagem é a posição já
   * calculada, para não depender do relógio do cliente bater com o do servidor.
   */
  private roomAudio = new Map<string, RoomAudioEntry>()
  /** Último início de áudio por usuário (anti-spam, como `lastKnockAt`). */
  private lastRoomAudioAt = new Map<string, number>()
  /**
   * Ordem de chegada em cada sala (`room.id` → userIds), a mais antiga
   * primeiro. É o que decide o manager quando a sala não tem dono de mesa: o
   * primeiro da fila manda, e sair passa a vez para o seguinte.
   *
   * Precisa ser estado, e não derivado da posição como o resto: a geometria
   * diz quem ESTÁ na sala, nunca quem chegou antes.
   */
  private roomArrivals = new Map<string, string[]>()
  /**
   * Quem foi tirado da chamada e ainda não saiu da área da sala
   * (`userId` → `room.id`). Enquanto a marca existe, o token de mídia daquela
   * sala é negado — é o que impede a pessoa de voltar sozinha, já que ela
   * continua fisicamente lá dentro. Sai da área, a marca é apagada.
   */
  private removedFromRoom = new Map<string, string>()
  /** Última lista de managers publicada — evita rebroadcast quando nada mudou. */
  private lastRoomManagersKey = ''

  join(socket: OfficeSocket, user: OfficeUser, runtime?: ActiveOfficeMapDTO): void {
    if (runtime) this.configure(runtime)
    if (!this.runtime) throw new Error('OfficeHub requer uma publicação de mapa ativa')
    this.socketOwner.set(socket, user.id)

    const existing = this.entries.get(user.id)
    if (existing) {
      // Outra aba da mesma pessoa (ou reconexão dentro do período de graça):
      // um personagem só, sem novo "joined" e sem orçamento de movimento
      // novo (o bucket já existe, é o mesmo). Cancela a saída pendente, se
      // houver — reconectou a tempo, ninguém precisa saber que caiu.
      const pendingLeave = this.pendingLeaves.get(user.id)
      if (pendingLeave) {
        clearTimeout(pendingLeave)
        this.pendingLeaves.delete(user.id)
      }
      existing.sockets.add(socket)
    } else {
      this.buckets.set(user.id, { tokens: BURST, updatedAt: Date.now() })
      this.annotationBuckets.set(user.id, { tokens: ANNOTATION_BURST, updatedAt: Date.now() })
      // O spawn do mapa é um TILE; o corpo contínuo nasce no ponto com folga
      // mais próximo dele. O tile de spawn costuma ser um vão estreito, onde um
      // corpo em pixel nasceria praticamente entalado (ver `bodySpawnPoint`).
      const spawnTile = this.pickSpawn(user.id)
      const grid = this.collisionGrid()
      const spawn =
        grid && this.runtime
          ? bodySpawnPoint(
              this.runtime.document,
              grid,
              spawnTile,
              [...this.entries.values()].map((other) => ({ x: other.occupant.x, y: other.occupant.y })),
            )
          : {
              x: spawnTile.x * TILE_SIZE + TILE_SIZE / 2,
              y: spawnTile.y * TILE_SIZE + TILE_SIZE / 2,
            }
      const occupant: OfficeOccupant = {
        userId: user.id,
        name: user.name,
        isGuest: user.isGuest,
        characterName: user.officeCharacterName ?? null,
        x: spawn.x,
        y: spawn.y,
        dir: 'down',
        photoUrl: user.photoUrl,
        avatarStyle: user.avatarStyle,
        avatarSeed: user.avatarSeed,
        avatarOptions: user.avatarOptions,
        status: 'online',
      }
      this.entries.set(user.id, {
        occupant,
        sockets: new Set([socket]),
        pending: [],
        lastSeq: 0,
        budgetMs: 0,
        tile: this.tileOf(occupant),
        lastMove: { dx: 0, dy: 0, sprint: false },
        lastMoveAt: 0,
        // Parado, e a pé: só quem monta num kart passa a ter velocidade.
        speed: 0,
        sent: null,
      })
      this.broadcast({ type: 'joined', occupant }, user.id)
      // O spawn pode cair dentro de uma sala, e entrar no escritório não passa
      // por `move` — sem isto, quem nasce lá dentro nunca entra na fila e a
      // sala fica sem manager até alguém andar.
      this.trackRoomArrival(user.id, null, this.roomOf(occupant)?.id ?? null)
      this.refreshRoomManagers()
    }

    this.sendTo(socket, {
      type: 'welcome',
      youId: user.id,
      // De onde a predição retoma a numeração (ver o comentário no contrato).
      seq: this.entries.get(user.id)?.lastSeq ?? 0,
      occupants: this.occupants(),
      publicationId: this.runtime?.publication.id,
      confettiUserIds: [...this.confettiActive],
      handRaisedUserIds: [...this.raisedHandActive],
      editorUserIds: [...this.editingActive],
      lockedRoomIds: [...this.lockedRooms],
      roomAudio: this.roomAudioEntries(),
      roomManagers: this.roomManagers(),
      karts: this.karts(),
      balls: this.balls(),
      paintSplats: this.paintSplatsSnapshot(),
    })
  }

  configure(runtime: ActiveOfficeMapDTO, notify = false, keepPresence = false): void {
    const hadRuntime = this.runtime !== null
    const changed = this.runtime !== null && this.runtime.publication.id !== runtime.publication.id
    // Save de decoração grava IN-PLACE (card 22041): a publicação continua a
    // mesma e só `decorRevision` avança. Sem olhar para ele, karts movidos ou
    // removidos no editor ficariam congelados no estado da última TROCA de
    // publicação — e o `karts-updated` do próprio save sairia com a lista velha.
    const decorChanged =
      this.runtime !== null && !changed && this.runtime.decorRevision !== runtime.decorRevision
    if (changed && notify) this.broadcast({ type: 'map-changed', publicationId: runtime.publication.id })
    // Publicação de decoração (caminho suave) muda a publicação mas NÃO deve
    // desconectar a presença: limpar `entries`/`socketOwner` aqui derrubaria
    // todos e faria o broadcast seguinte não alcançar ninguém.
    if (changed && !keepPresence) {
      this.entries.clear()
      this.buckets.clear()
      this.annotationBuckets.clear()
      this.socketOwner.clear()
      this.lastCallAt.clear()
      this.confettiActive.clear()
      this.confettiSocket.clear()
      this.editingActive.clear()
      this.editingSocket.clear()
      this.raisedHandActive.clear()
      this.raisedHandSocket.clear()
      this.raisedHandsByRoom.clear()
      this.raisedHandRoomOf.clear()
      this.lastCelebrationAt = 0
      this.paintSplats.clear()
      this.lastPaintballAt.clear()
      // Mapa novo, salas novas: fila de chegada e marcas de remoção não
      // sobrevivem à troca — os ids de sala nem existem mais.
      this.roomArrivals.clear()
      this.removedFromRoom.clear()
      this.lastRoomManagersKey = ''
      this.clearRoomLockState()
      this.clearRoomAudioState()
    }
    this.runtime = runtime
    if (!hadRuntime || changed || decorChanged) {
      this.reconcileKarts(runtime, (changed || decorChanged) && keepPresence)
      this.ballStates = new Map(mapBalls(runtime.document).map((ball) => [ball.id, ball]))
    }
  }

  broadcastMapDecorUpdated(publicationId: string): void {
    this.broadcast({ type: 'karts-updated', karts: this.karts() })
    this.broadcast({ type: 'balls-updated', balls: this.balls() })
    this.broadcast({ type: 'map-decor-updated', publicationId })
  }

  /**
   * Reconcilia os veículos com uma publicação. Na atualização suave preserva
   * só os karts ainda publicados que estão sendo dirigidos; os estacionados
   * voltam para a nova posição configurada no editor.
   */
  private reconcileKarts(runtime: ActiveOfficeMapDTO, preserveRiders: boolean): void {
    const seeded = mapKarts(runtime.document)
    if (!preserveRiders) {
      this.kartStates = new Map(seeded.map((kart) => [kart.id, kart]))
      return
    }

    const next = new Map<string, OfficeKart>()
    for (const seed of seeded) {
      const current = this.kartStates.get(seed.id)
      const riderStillPresent = current?.riderUserId
        ? this.entries.has(current.riderUserId)
        : false
      next.set(seed.id, current && riderStillPresent ? current : seed)
    }
    for (const current of this.kartStates.values()) {
      if (next.has(current.id) || !current.riderUserId) continue
      const entry = this.entries.get(current.riderUserId)
      if (entry) delete entry.occupant.ridingKartId
      const { riderUserId, ...parked } = current
      this.broadcast({
        type: 'kart-ride',
        userId: riderUserId,
        active: false,
        kart: parked,
      })
    }
    this.kartStates = next
  }

  publicationId(): string | null {
    return this.runtime?.publication.id ?? null
  }

  roomForTile(x: number, y: number) {
    if (!this.runtime) return null
    const zone = mapZoneAtTile(this.runtime.document, x, y)
    if (zone?.type !== 'meeting-room') return null
    return this.runtime.rooms.find((room) => room.externalKey === zone.properties.externalKey) ?? null
  }

  private roomLockOwnerId(roomExternalKey: string): string | null {
    if (!this.runtime) return null
    return claimedDeskInMeetingRoom(this.runtime.document, this.runtime.desks, roomExternalKey)?.claimedBy?.id ?? null
  }

  /** Quem está dentro da sala agora, derivado da posição (como todo o resto). */
  private occupantIdsInRoom(roomId: string): string[] {
    const ids: string[] = []
    for (const [userId, entry] of this.entries) {
      if (this.roomOf(entry.occupant)?.id === roomId) ids.push(userId)
    }
    return ids
  }

  /**
   * Quem manda na sala: o dono da mesa reivindicada lá dentro, se ele estiver
   * presente; senão quem chegou primeiro. Sala vazia não tem manager.
   *
   * O dono da mesa só vale enquanto está na sala — foi decisão explícita: a
   * mesa continua sendo dele, mas moderar uma conversa de onde não se está não
   * faz sentido, e deixaria a sala sem ninguém para resolver o problema na
   * hora.
   */
  managerOf(roomId: string): OfficeRoomManager | null {
    const room = this.runtime?.rooms.find((r) => r.id === roomId)
    if (!room) return null
    const present = new Set(this.occupantIdsInRoom(roomId))
    if (present.size === 0) return null

    const ownerId = this.roomLockOwnerId(room.externalKey)
    if (ownerId && present.has(ownerId)) return { roomId, userId: ownerId, byDeskOwner: true }

    const firstIn = (this.roomArrivals.get(roomId) ?? []).find((userId) => present.has(userId))
    return firstIn ? { roomId, userId: firstIn, byDeskOwner: false } : null
  }

  /** Manager de cada sala ocupada — o que vai no `welcome` e no broadcast. */
  roomManagers(): OfficeRoomManager[] {
    const managers: OfficeRoomManager[] = []
    for (const room of this.runtime?.rooms ?? []) {
      const manager = this.managerOf(room.id)
      if (manager) managers.push(manager)
    }
    return managers
  }

  /**
   * Recalcula os managers e avisa o escritório se algum mudou. Chamado depois
   * de qualquer coisa que mexa em quem está onde: entrar, sair da sala, sair
   * do escritório. Silencioso quando nada mudou — é chamado a cada passo de
   * quem cruza uma porta, e um broadcast por passo seria ruído puro.
   */
  private refreshRoomManagers(): void {
    const managers = this.roomManagers()
    const next = managers.map((m) => `${m.roomId}:${m.userId}:${m.byDeskOwner}`).join('|')
    if (next === this.lastRoomManagersKey) return
    this.lastRoomManagersKey = next
    this.broadcast({ type: 'room-managers-changed', managers })
  }

  /**
   * Registra a chegada de alguém numa sala e a saída da anterior. A fila é a
   * memória de quem chegou antes; a presença em si continua sendo derivada da
   * posição.
   */
  private trackRoomArrival(userId: string, previousRoomId: string | null, nextRoomId: string | null): void {
    if (previousRoomId === nextRoomId) return
    if (previousRoomId) {
      const queue = (this.roomArrivals.get(previousRoomId) ?? []).filter((id) => id !== userId)
      if (queue.length > 0) this.roomArrivals.set(previousRoomId, queue)
      else this.roomArrivals.delete(previousRoomId)
    }
    if (nextRoomId) {
      const queue = this.roomArrivals.get(nextRoomId) ?? []
      if (!queue.includes(userId)) this.roomArrivals.set(nextRoomId, [...queue, userId])
    }
  }

  /**
   * O TILE que uma posição em pixel ocupa.
   *
   * Desde o movimento livre, `occupant.x/y` são pixel — mas sala, mesa, zona e
   * alcance de voz continuam sendo conceitos de tile, e é certo que continuem:
   * uma sala tem borda de tile, não de pixel.
   *
   * Os helpers que consomem tile ganharam `Tile` no nome de propósito. O
   * compilador não distingue pixel de tile (os dois são `number`), então o único
   * lugar onde essa confusão pode ser barrada é o nome — e ela seria do tipo que
   * só aparece em produção, como "a sala não detecta quem entrou".
   */
  private tileOf(point: { x: number; y: number }): { x: number; y: number } {
    const tileWidth = this.runtime?.document.map.tileWidth ?? TILE_SIZE
    const tileHeight = this.runtime?.document.map.tileHeight ?? TILE_SIZE
    return { x: Math.floor(point.x / tileWidth), y: Math.floor(point.y / tileHeight) }
  }

  /** A sala de reunião de quem está aqui — para quem só tem o occupant em mãos. */
  roomOf(occupant: { x: number; y: number }): ReturnType<OfficeHub['roomForTile']> {
    const tile = this.tileOf(occupant)
    return this.roomForTile(tile.x, tile.y)
  }

  /** A sala de ÁUDIO por proximidade de quem está aqui. */
  mediaRoomOf(occupant: { x: number; y: number }): string | null {
    const tile = this.tileOf(occupant)
    return this.mediaRoomForTile(tile.x, tile.y)
  }

  /** Está na sala de silêncio? — para quem tem o occupant, não o tile. */
  private isInPrivateZoneOf(occupant: { x: number; y: number }): boolean {
    const tile = this.tileOf(occupant)
    return this.isInPrivateTile(tile.x, tile.y)
  }

  /** A zona de mão levantada de quem está aqui. */
  private raiseHandZoneIdOf(occupant: { x: number; y: number }): string | null {
    const tile = this.tileOf(occupant)
    return this.raiseHandZoneIdAtTile(tile.x, tile.y)
  }

  /** Sala de silêncio: onde o status fica travado em 'away'. */
  private isInPrivateTile(x: number, y: number): boolean {
    if (!this.runtime) return false
    return mapZoneAtTile(this.runtime.document, x, y)?.type === 'private-zone'
  }

  /**
   * Sinal de vida: quem está 'ausente'/'volto logo' volta pra online sozinho
   * ao dar sinal de atividade (andar, falar, ligar) — o status manual serve
   * pra avisar que você saiu, então agir prova que voltou.
   *
   * No-op se já está online e, principalmente, dentro de uma sala de
   * silêncio: lá o status é travado em 'away' e nenhum sinal de atividade
   * destrava (só sair). Sem essa guarda, mandar um balão de fala de dentro
   * da sala — `nearbyMessage` alcança o escritório todo — furaria a trava.
   */
  private markActive(userId: string): void {
    const entry = this.entries.get(userId)
    if (!entry) return
    if ((entry.occupant.status ?? 'online') === 'online') return
    if (this.isInPrivateZoneOf(entry.occupant)) return
    entry.occupant.status = 'online'
    this.broadcast({ type: 'status-changed', userId, status: 'online' })
  }

  /**
   * Sala de reunião OU zona privada ("espaço de conversa") — as duas
   * modalidades de zona onde a mão levantada forma fila. Zona privada não
   * tem `Room` no banco (sem capacidade/política de acesso formal), então o
   * id usado pra agrupar é o mesmo da sala de áudio por proximidade
   * (`officeRoomForTile`): `externalKey` da zona, ou o id do objeto
   * no mapa se ela não tiver `externalKey`. Fora de qualquer zona, `null`.
   */
  private raiseHandZoneIdAtTile(x: number, y: number): string | null {
    if (!this.runtime) return null
    const zone = mapZoneAtTile(this.runtime.document, x, y)
    if (!zone) return null
    if (zone.type === 'meeting-room') return this.roomForTile(x, y)?.id ?? null
    return zone.properties.externalKey ?? zone.id
  }

  mediaRoomForTile(x: number, y: number): string | null {
    if (!this.runtime) return null
    return officeRoomForTile(this.runtime.map.id, this.runtime.document, x, y)
  }

  /**
   * `seq` é o identificador do passo mandado pelo cliente — volta no `sync` de
   * recusa para ele desfazer exatamente a predição correspondente.
   */
  /**
   * Enfileira a intenção de quem está andando. NÃO simula aqui: quem simula é o
   * tick, senão o ritmo do movimento passaria a ser o ritmo com que os pacotes
   * chegam — e quem tivesse rede pior andaria diferente.
   *
   * Substituiu o `move` de grade, que resolvia o passo na chegada da mensagem e
   * cobrava um token por passo. O teto agora é o mesmo da arena: fila limitada
   * mais banco de tempo creditado pelo relógio DO SERVIDOR, que é o que impede
   * um cliente adulterado de comprar velocidade inflando o próprio `dtMs`.
   */
  applyInput(socket: OfficeSocket, userId: string, input: BodyInput): void {
    if (this.socketOwner.get(socket) !== userId) return
    const entry = this.entries.get(userId)
    if (!entry) return
    // Input velho (chegou fora de ordem) não volta no tempo.
    if (input.seq <= entry.lastSeq) return
    // Fila cheia: descarta o mais ANTIGO. Segurar os velhos e recusar os novos
    // deixaria a pessoa andando no passado até a fila drenar.
    if (entry.pending.length >= BODY_MAX_PENDING_INPUTS) entry.pending.shift()
    entry.pending.push(input)
    this.startLoop()
  }

  /** Karts estacionados, como caixas que bloqueiam o passo. */
  private kartBlockers(): BodyBlocker[] {
    const tileWidth = this.runtime?.document.map.tileWidth ?? TILE_SIZE
    const tileHeight = this.runtime?.document.map.tileHeight ?? TILE_SIZE
    // Só os ESTACIONADOS: um kart com piloto anda junto de alguém, e bloquear
    // nele bloquearia o próprio piloto.
    return [...this.kartStates.values()]
      .filter((kart) => !kart.riderUserId)
      .map((kart) => ({
        x: kart.x,
        y: kart.y,
        halfWidth: tileWidth / 2,
        halfHeight: tileHeight / 2,
      }))
  }

  /** A grade fina de colisão do mapa ativo. Memoizada pela identidade de `objects`. */
  private collisionGrid(): BodyCollisionGrid | null {
    if (!this.runtime) return null
    return bodyCollisionGrid(this.runtime.document)
  }

  /**
   * O tile que vale AGORA para efeito de sala e zona.
   *
   * Só troca quando o centro entrou de fato no tile novo (`TILE_COMMIT_MARGIN`).
   * Parar em cima da divisa é comum — encostado numa parede, por exemplo — e sem
   * a margem o tile derivado alternaria a cada quadro, disparando entrar/sair de
   * sala dezenas de vezes por segundo.
   */
  private committedTile(entry: Entry): { x: number; y: number } {
    const tileWidth = this.runtime?.document.map.tileWidth ?? TILE_SIZE
    const tileHeight = this.runtime?.document.map.tileHeight ?? TILE_SIZE
    const candidato = this.tileOf(entry.occupant)
    if (candidato.x === entry.tile.x && candidato.y === entry.tile.y) return entry.tile
    const dentroX = entry.occupant.x - candidato.x * tileWidth
    const dentroY = entry.occupant.y - candidato.y * tileHeight
    const firme =
      dentroX >= TILE_COMMIT_MARGIN &&
      dentroX <= tileWidth - TILE_COMMIT_MARGIN &&
      dentroY >= TILE_COMMIT_MARGIN &&
      dentroY <= tileHeight - TILE_COMMIT_MARGIN
    return firme ? candidato : entry.tile
  }

  /**
   * A cascata de travessia: som de presença, tranca, dono do áudio, knock,
   * fila de mão levantada, fila de chegada, manager e status ausente.
   *
   * A REGRA é a mesma que o `move` de grade tinha; o que mudou é o gatilho. Lá
   * havia um instante exato de entrada — o passo. Aqui há um tick em que o tile
   * comitado mudou, e é sobre essa BORDA que tudo roda.
   *
   * O efeito colateral é bom: antes a cascata era avaliada a cada passo (até
   * 20×/s por pessoa) mesmo sem ninguém trocar de sala; agora ela roda quando
   * houve travessia de verdade.
   */
  private settleRegions(entry: Entry): void {
    const anterior = entry.tile
    const atual = this.committedTile(entry)
    if (atual.x === anterior.x && atual.y === anterior.y) return

    const userId = entry.occupant.userId
    const socket = [...entry.sockets][0]
    const previousRoom = this.roomForTile(anterior.x, anterior.y)
    const previousZoneId = this.raiseHandZoneIdAtTile(anterior.x, anterior.y)
    const wasInPrivateZone = this.isInPrivateTile(anterior.x, anterior.y)
    entry.tile = atual

    // Ausente automático ao entrar numa sala de silêncio (private-zone). Fora
    // dela, andar é sinal de atividade: quem estava 'ausente'/'volto logo'
    // volta pra online sozinho.
    if (this.isInPrivateTile(atual.x, atual.y)) {
      if (!wasInPrivateZone) {
        entry.occupant.status = 'away'
        this.broadcast({ type: 'status-changed', userId, status: 'away' })
      }
    } else {
      this.markActive(userId)
    }

    // Sinal sonoro de entrar/sair de sala de reunião.
    const nextRoom = this.roomForTile(atual.x, atual.y)
    if (nextRoom?.id !== previousRoom?.id) {
      if (nextRoom) {
        this.broadcastToRoom(nextRoom.id, { type: 'room-presence', kind: 'enter', userId, roomId: nextRoom.id })
      }
      if (previousRoom) {
        const leftMessage = { type: 'room-presence', kind: 'leave', userId, roomId: previousRoom.id } as const
        if (socket) this.sendTo(socket, leftMessage)
        this.broadcastToRoom(previousRoom.id, leftMessage)
        // O áudio, ao contrário da tranca, é de quem iniciou e sai com ele.
        this.clearRoomAudioIfOwnerLeft(previousRoom.id, userId)
      }
      // Saiu de uma sala trancada: a tranca fica com quem ficou; some só se ele
      // era o último lá dentro. Fora do `if` acima porque a sala que a pessoa
      // deixou pode não ser a que a cascata enxerga (ver `sweepEmptyLockedRooms`).
      this.sweepEmptyLockedRooms()
      // Entrou na sala que tinha pedido para entrar: o pedido cumpriu o papel.
      if (nextRoom && this.knockRoomOf.get(userId) === nextRoom.id) this.clearKnock(userId)

      this.trackRoomArrival(userId, previousRoom?.id ?? null, nextRoom?.id ?? null)
      // Sair da área é o que devolve a chamada a quem foi removido.
      if (previousRoom && this.removedFromRoom.get(userId) === previousRoom.id) {
        this.removedFromRoom.delete(userId)
      }
      this.refreshRoomManagers()
    }

    // Fila/ícone de mão levantada: entra/sai de sala de reunião OU zona privada
    // — a mão só existe DENTRO de uma dessas, então sair da zona abaixa tudo.
    const nextZoneId = this.raiseHandZoneIdAtTile(atual.x, atual.y)
    if (nextZoneId !== previousZoneId) {
      if (nextZoneId) {
        const queue = this.raisedHandsByRoom.get(nextZoneId)
        if (queue && queue.length > 0 && socket) {
          this.sendTo(socket, { type: 'raised-hands', roomId: nextZoneId, queue: [...queue] })
        }
      }
      if (previousZoneId) {
        const removedHand = this.removeFromRaisedHandQueue(userId)
        if (removedHand) {
          const handMessage = {
            type: 'raised-hands',
            roomId: removedHand.roomId,
            queue: removedHand.queue,
            event: { kind: 'lowered', userId },
          } as const
          if (socket) this.sendTo(socket, handMessage)
          this.broadcastToRoom(removedHand.roomId, handMessage)
        }
        if (this.raisedHandActive.delete(userId)) {
          this.raisedHandSocket.delete(userId)
          this.broadcast({ type: 'hand-raised', userId, active: false })
        }
      }
    }

    this.evaluateHighFive(userId)
  }

  /**
   * O laço de simulação do escritório.
   *
   * Nasce no primeiro que entra e morre quando o escritório esvazia — o padrão
   * que a arena já usa, e que responde à objeção original (timer OCIOSO por
   * empresa) sem abrir mão do modelo.
   *
   * A diferença em relação à arena é que escritório raramente esvazia. É por
   * isso que a supressão de snapshot sem mudança não é otimização aqui: é parte
   * do desenho (ver `broadcastSnapshot`).
   */
  private startLoop(): void {
    if (this.timer || this.entries.size === 0) return
    this.lastTickAt = Date.now()
    this.timer = setInterval(() => this.tick(), Math.round(1000 / BODY_TICK_HZ))
    // Não segura o processo Node aberto (mesmo cuidado do heartbeat do socket).
    this.timer.unref?.()
  }

  private stopLoopIfEmpty(): void {
    if (this.entries.size > 0 || !this.timer) return
    clearInterval(this.timer)
    this.timer = null
    this.tickCount = 0
  }

  /** Só para teste: o loop está vivo? */
  isRunning(): boolean {
    return this.timer !== null
  }

  /**
   * Só para teste: anda o equivalente a UM tile na direção pedida.
   *
   * Existe para os testes que herdaram o modelo de grade continuarem dizendo o
   * que diziam. Eles quase nunca são sobre o passo — são sobre o que a
   * travessia PROVOCA (som de presença, tranca, fila de mão levantada, manager,
   * high-five) —, e essa parte não mudou de regra, só de gatilho.
   *
   * Não é atalho para dentro da simulação: ele empurra input de verdade e roda
   * o tick de verdade. O que ele dispensa é o relógio de parede.
   */
  __walkForTest(socket: OfficeSocket, userId: string, move: MoveDirection, sprint = false): void {
    const entry = this.entries.get(userId)
    if (!entry) return
    const delta = MOVE_DIRECTION_DELTAS[move]
    const tile = this.runtime?.document.map.tileWidth ?? TILE_SIZE
    const velocidade = BODY_SPEED * (sprint ? BODY_SPRINT_FACTOR : 1)
    let restante = (tile / velocidade) * 1000
    while (restante > 0.001) {
      const dtMs = Math.min(BODY_MAX_STEP_MS, restante)
      this.applyInput(socket, userId, {
        seq: entry.lastSeq + entry.pending.length + 1,
        dx: delta.x,
        dy: delta.y,
        dtMs,
        sprint,
      })
      this.tick(dtMs)
      restante -= dtMs
    }
  }

  /** Só para teste: a velocidade do kart de quem está montado. */
  __speedForTest(userId: string): number {
    return this.entries.get(userId)?.speed ?? 0
  }

  /** Só para teste: roda um tick com o tempo decorrido que se quer. */
  __tickForTest(elapsedMs: number): void {
    this.tick(elapsedMs)
  }

  /** Só para teste: leva alguém direto a um tile, com a cascata rodando. */
  __placeAtTileForTest(userId: string, tileX: number, tileY: number): void {
    const entry = this.entries.get(userId)
    if (!entry) return
    const tileWidth = this.runtime?.document.map.tileWidth ?? TILE_SIZE
    const tileHeight = this.runtime?.document.map.tileHeight ?? TILE_SIZE
    entry.occupant.x = tileX * tileWidth + tileWidth / 2
    entry.occupant.y = tileY * tileHeight + tileHeight / 2
    this.syncRiderKart(entry.occupant)
    this.settleRegions(entry)
  }

  private tick(forcedElapsedMs?: number): void {
    const grid = this.collisionGrid()
    if (!grid) return
    const now = Date.now()
    // O tempo decorrido vem do relógio, salvo quando um teste o impõe: os
    // testes do hub exercitam a CASCATA de travessia, e depender do relógio de
    // parede para andar um tile os deixaria lentos e instáveis.
    const elapsed = forcedElapsedMs ?? Math.max(0, now - this.lastTickAt)
    this.lastTickAt = now
    const blockers = this.kartBlockers()

    for (const entry of this.entries.values()) {
      // Credita pelo relógio DO SERVIDOR e debita por input aplicado: o `dtMs`
      // vem do cliente, e sem isso quem inflasse o próprio `dt` compraria
      // velocidade. O banco (com teto) é o que ainda assim tolera jitter.
      entry.budgetMs = Math.min(entry.budgetMs + elapsed, BODY_TIME_BUDGET_CAP_MS)

      while (entry.pending.length > 0 && entry.budgetMs > 0) {
        const input = entry.pending[0]
        const dtMs = Math.min(Math.max(input.dtMs, 0), BODY_MAX_STEP_MS, entry.budgetMs)
        const antes = { x: entry.occupant.x, y: entry.occupant.y }
        if (entry.occupant.ridingKartId) {
          // De kart, o passo é o MESMO da corrida: rumo contínuo, inércia,
          // esterço que só morde andando. Reusar `stepBodyKart` é o que faz
          // dirigir no escritório ser igual a dirigir na arena — duas
          // implementações de pilotagem divergiriam, e a pessoa sentiria.
          const kart: BodyKartState = {
            x: entry.occupant.x,
            y: entry.occupant.y,
            dir: entry.occupant.dir,
            heading: entry.occupant.heading ?? 0,
            speed: entry.speed,
          }
          const proximo = stepBodyKart(kart, { ...input, dtMs }, grid)
          entry.occupant.x = proximo.x
          entry.occupant.y = proximo.y
          entry.occupant.dir = proximo.dir
          entry.occupant.heading = proximo.heading
          entry.speed = proximo.speed
        } else {
          const proximo = stepBodyAmongBlockers(
            { x: entry.occupant.x, y: entry.occupant.y, dir: entry.occupant.dir },
            { ...input, dtMs },
            grid,
            blockers,
          )
          entry.occupant.x = proximo.x
          entry.occupant.y = proximo.y
          entry.occupant.dir = proximo.dir
        }
        // Sala recusada é COLISÃO, não silêncio: o corpo para na porta em vez de
        // escorregar para dentro. Sem isso, deslizar ao longo de uma parede
        // poderia empurrar alguém para dentro de uma sala trancada.
        if (this.refuseForbiddenRoom(entry, antes)) {
          entry.occupant.x = antes.x
          entry.occupant.y = antes.y
        }
        entry.budgetMs -= dtMs
        entry.lastSeq = input.seq
        entry.lastMove = { dx: input.dx, dy: input.dy, sprint: input.sprint === true }
        entry.lastMoveAt = now
        entry.pending.shift()
      }

      // O pensamento some quando a pessoa se mexe, como sempre foi — só que
      // agora "se mexer" é ter andado neste tick, não ter mandado um `move`.
      if (entry.lastMoveAt === now && (entry.lastMove.dx !== 0 || entry.lastMove.dy !== 0)) {
        this.clearThought(entry)
      }
      this.syncRiderKart(entry.occupant)
      this.settleRegions(entry)
    }

    const bolasRolando = this.updateBalls(elapsed)

    this.tickCount += 1
    if (this.tickCount % TICKS_PER_SNAPSHOT === 0) {
      // Rede de segurança da invariante da tranca: quem sai de uma sala pode
      // não disparar travessia nenhuma (ver `sweepEmptyLockedRooms`). Sai na
      // primeira linha quando não há tranca no ar, que é o caso comum.
      this.sweepEmptyLockedRooms()
      this.broadcastSnapshot(bolasRolando > 0)
    }
  }

  /**
   * Apaga o pensamento de quem se mexeu — e AVISA os clientes.
   *
   * O aviso é a parte que não dá para deduzir do snapshot: ele carrega
   * posição, não pensamento. No modelo de grade o eco `moved` fazia esse
   * papel; o movimento livre o aposentou, e o balão passou a ficar pendurado
   * na tela dos outros. Sai do ar só na transição (tinha pensamento e passou a
   * não ter), então não vira tráfego por tick.
   */
  private clearThought(entry: Entry): void {
    if (entry.occupant.thoughtText === undefined) return
    delete entry.occupant.thoughtText
    this.broadcast({ type: 'thought-cleared', userId: entry.occupant.userId })
  }

  /**
   * A entrada neste tile seria recusada? Se sim, avisa o cliente (uma vez por
   * intervalo) e devolve `true` para o chamador desfazer o passo.
   *
   * Parede é auto-explicativa; porta de sala não — só por aqui o cliente
   * descobre POR QUE não entrou, e só a tranca de sessão aceita pedir para
   * entrar. É o mesmo `entry-denied` do modelo de grade: o que sumiu foi o
   * `sync`, não a explicação.
   */
  private refuseForbiddenRoom(entry: Entry, antes: { x: number; y: number }): boolean {
    const destino = this.tileOf(entry.occupant)
    const origem = this.tileOf(antes)
    if (destino.x === origem.x && destino.y === origem.y) return false
    const userId = entry.occupant.userId
    const denial = this.roomEntryDenialAtTile(userId, destino.x, destino.y, origem)
    if (!denial) return false

    // A cadência é do `sendEntryDenied`, que já a aplica — sem cadência, uma
    // pessoa encostada na porta geraria um aviso por tick. Repeti-la aqui
    // silenciava o aviso por inteiro: o registro gravado fora fazia a checagem
    // de dentro desistir sempre.
    const socket = [...entry.sockets][0]
    if (socket) this.sendEntryDenied(socket, userId, denial, destino.x, destino.y)
    return true
  }

  /**
   * Estado autoritativo de quem está no escritório.
   *
   * **Suprimido quando nada mudou.** É o que devolve o custo zero do escritório
   * parado: sem isso, trinta pessoas de pé custariam 600 pacotes por segundo
   * para não dizer nada. Com isso, o modelo de snapshot só cobra quando há
   * movimento — e continua cobrando `N × 20` em vez de `M × 20 × N` quando há.
   */
  private broadcastSnapshot(bolasRolando = false): void {
    if (this.entries.size === 0) return
    let mudou = false
    const players = [...this.entries.values()].map((entry) => {
      const sprint = entry.lastMove.sprint && Date.now() - entry.lastMoveAt <= MOVE_INTENT_TTL_MS
      const linha = {
        userId: entry.occupant.userId,
        x: entry.occupant.x,
        y: entry.occupant.y,
        dir: entry.occupant.dir,
        seq: entry.lastSeq,
        // Rumo e velocidade só de quem está montado: são o que a reconciliação
        // do dono precisa (reancorar sem eles reexecutaria os pendentes a
        // partir de um kart apontado para outro lado) e o que faz o veículo
        // girar liso na tela dos outros.
        ...(entry.occupant.ridingKartId ? { h: entry.occupant.heading ?? 0, v: entry.speed } : {}),
        ...(sprint ? { sprint: true } : {}),
      }
      const enviado = entry.sent
      if (
        !enviado ||
        enviado.x !== linha.x ||
        enviado.y !== linha.y ||
        enviado.dir !== linha.dir ||
        enviado.seq !== linha.seq ||
        enviado.sprint !== sprint
      ) {
        mudou = true
      }
      entry.sent = { x: linha.x, y: linha.y, dir: linha.dir, seq: linha.seq, sprint }
      return linha
    })
    // Bola rolando também é mudança: sem isto ela pararia de ser transmitida
    // sempre que todo mundo estivesse parado olhando ela rolar.
    if (!mudou && !bolasRolando) return
    this.broadcast({
      type: 'snapshot',
      players,
      ...(bolasRolando ? { balls: this.balls() } : {}),
    })
  }

  /**
   * Alguém abriu/fechou o editor de decoração. Relay para todos, inclusive o
   * remetente (mesmo padrão do confete/mão levantada). Sem-mudança (reenvio,
   * aba duplicada): não republica pra todo mundo — nada mudou no estado real.
   */
  setEditing(socket: OfficeSocket, userId: string, editing: boolean): void {
    if (this.socketOwner.get(socket) !== userId) return
    let changed = false
    if (editing) {
      this.editingSocket.set(userId, socket)
      changed = !this.editingActive.has(userId)
      this.editingActive.add(userId)
    } else {
      if (this.editingSocket.get(userId) === socket) this.editingSocket.delete(userId)
      changed = this.editingActive.delete(userId)
    }
    if (changed) this.broadcast({ type: 'editors-changed', userIds: [...this.editingActive] })
  }

  /** Girar no lugar (atalho R): nunca muda x,y, só a direção — sempre broadcast. */
  face(socket: OfficeSocket, userId: string, dir: Direction): void {
    if (this.socketOwner.get(socket) !== userId) return
    const entry = this.entries.get(userId)
    if (!entry) return
    if (!this.takeToken(userId)) return

    entry.occupant.dir = dir
    this.syncRiderKart(entry.occupant)
    this.broadcast({ type: 'faced', userId, dir })
    this.evaluateHighFive(userId)
  }

  leave(socket: OfficeSocket, userId: string): void {
    this.leaveSocket(socket, userId, false)
  }

  leaveNow(socket: OfficeSocket, userId: string): void {
    this.leaveSocket(socket, userId, true)
  }

  private leaveSocket(socket: OfficeSocket, userId: string, immediate: boolean): void {
    this.socketOwner.delete(socket)
    // A aba que caiu é dona do confete ativo? Encerra AGORA, mesmo que outra
    // aba do mesmo usuário continue conectada — senão o fantasma nunca sai
    // de `confettiActive` (nenhuma aba vai mandar o `active:false` por ele).
    if (this.confettiSocket.get(userId) === socket) {
      this.confettiSocket.delete(userId)
      if (this.confettiActive.delete(userId)) {
        this.broadcast({ type: 'confetti', userId, active: false })
      }
    }
    // Mesma lógica do confete: só a aba DONA do `active:true` limpa o estado
    // global ao cair, senão outra aba do mesmo usuário perderia o próprio
    // sinal sem ter mandado `active:false`.
    if (this.raisedHandSocket.get(userId) === socket) {
      this.raisedHandSocket.delete(userId)
      if (this.raisedHandActive.delete(userId)) {
        this.broadcast({ type: 'hand-raised', userId, active: false })
      }
    }
    // Mesma lógica do confete/mão levantada: só a aba DONA do estado de
    // edição limpa ao cair, senão outra aba do mesmo usuário perderia o
    // próprio sinal sem ter mandado `editing:false`.
    if (this.editingSocket.get(userId) === socket) {
      this.editingSocket.delete(userId)
      if (this.editingActive.delete(userId)) {
        this.broadcast({ type: 'editors-changed', userIds: [...this.editingActive] })
      }
    }
    const entry = this.entries.get(userId)
    if (!entry) return
    entry.sockets.delete(socket)
    if (entry.sockets.size > 0) return // ainda há outra aba aberta
    if (immediate) {
      const pending = this.pendingLeaves.get(userId)
      if (pending) clearTimeout(pending)
      this.finalizeLeave(userId)
      return
    }
    // Última aba: não remove na hora — dá um período de graça pra uma
    // reconexão (queda de rede, aba jogada pro background pelo navegador)
    // retomar a MESMA posição sem os outros perceberem a queda (nenhum
    // "left" é mandado ainda). Só depois de RECONNECT_GRACE_MS sem volta é
    // que a saída se efetiva de fato, em `finalizeLeave`.
    const timer = setTimeout(() => this.finalizeLeave(userId), RECONNECT_GRACE_MS)
    this.pendingLeaves.set(userId, timer)
  }

  /** Efetiva a saída depois do período de graça — só se ninguém reconectou nesse meio-tempo. */
  private finalizeLeave(userId: string): void {
    this.pendingLeaves.delete(userId)
    const entry = this.entries.get(userId)
    if (!entry || entry.sockets.size > 0) return // reconectou dentro da janela
    // Sala onde estava, antes de remover o entry — para o sinal sonoro de saída.
    const previousRoom = this.roomOf(entry.occupant)
    this.parkKart(userId)
    this.entries.delete(userId)
    this.buckets.delete(userId) // saída efetivada: some o orçamento junto
    this.lastEntryDeniedAt.delete(userId)
    // Escritório vazio volta a não custar nada — é a metade que responde à
    // objeção do timer ocioso por empresa.
    this.stopLoopIfEmpty()
    this.annotationBuckets.delete(userId)
    this.lastCallAt.delete(userId)
    this.confettiActive.delete(userId) // não deixa fantasma inflando a contagem de confete
    this.confettiSocket.delete(userId)
    this.lastReaction.delete(userId)
    for (const key of this.lastHighFiveAt.keys()) {
      if (key.split('|').includes(userId)) this.lastHighFiveAt.delete(key)
    }
    const removedHand = this.removeFromRaisedHandQueue(userId)
    this.lastKnockAt.delete(userId)
    this.lastEntryDeniedAt.delete(userId)
    // Saiu do escritório com um pedido de entrada em aberto: fecha o modal de
    // quem estava na sala esperando responder.
    this.clearKnock(userId)
    this.broadcast({ type: 'left', userId })
    if (previousRoom) {
      // Já removido das entries: o broadcast avisa só quem continua na sala.
      this.broadcastToRoom(previousRoom.id, { type: 'room-presence', kind: 'leave', userId, roomId: previousRoom.id })
      this.clearRoomAudioIfOwnerLeft(previousRoom.id, userId)
    }
    this.sweepEmptyLockedRooms()
    // Sair do escritório passa a vez do manager adiante. A marca de remoção
    // também some: voltar ao escritório é sessão nova, não é a mesma conversa.
    this.trackRoomArrival(userId, previousRoom?.id ?? null, null)
    this.removedFromRoom.delete(userId)
    this.refreshRoomManagers()
    this.lastRoomAudioAt.delete(userId)
    // A tinta some com quem a levava; o marcador vai junto do occupant.
    this.paintSplats.delete(userId)
    this.lastPaintballAt.delete(userId)
    if (removedHand) {
      this.broadcastToRoom(removedHand.roomId, {
        type: 'raised-hands',
        roomId: removedHand.roomId,
        queue: removedHand.queue,
        event: { kind: 'lowered', userId },
      })
    }
  }

  occupants(): OfficeOccupant[] {
    return [...this.entries.values()].map((entry) => ({ ...entry.occupant }))
  }

  /** Snapshot dos veículos para welcome, bridge e testes. */
  karts(): OfficeKart[] {
    return [...this.kartStates.values()].map((kart) => ({ ...kart }))
  }

  balls(): OfficeBall[] {
    return [...this.ballStates.values()].map((ball) => ({ ...ball }))
  }

  /**
   * Marcas de uma pessoa que ainda não venceram, já podadas. É a ÚNICA leitura
   * de `paintSplats`: como não há timer expirando nada, quem lê é quem limpa.
   */
  private livePaintSplats(userId: string, now: number): Array<PaintSplat & { expiresAt: number }> {
    const live = (this.paintSplats.get(userId) ?? []).filter((splat) => splat.expiresAt > now)
    if (live.length === 0) this.paintSplats.delete(userId)
    else this.paintSplats.set(userId, live)
    return live
  }

  /**
   * Todas as marcas vivas, com o `ttlMs` já descontado do tempo decorrido:
   * quem entra no meio da vida de uma mancha recebe o que SOBROU dela, não o
   * prazo cheio. Mesma escolha do áudio de sala, e pelo mesmo motivo — assim o
   * cliente não precisa ter o relógio sincronizado com o servidor.
   */
  paintSplatsSnapshot(): PaintSplat[] {
    const now = Date.now()
    return [...this.paintSplats.keys()].flatMap((userId) =>
      this.livePaintSplats(userId, now).map(({ expiresAt, ...splat }) => ({
        ...splat,
        ttlMs: expiresAt - now,
      })),
    )
  }

  /** Posição atual de um usuário no escritório, ou null se não está nele. */
  occupantOf(userId: string): OfficeOccupant | null {
    const entry = this.entries.get(userId)
    return entry ? { ...entry.occupant } : null
  }

  /** Última reação de um usuário, ou null. Usado pela avaliação de high-five e pelos testes. */
  reactionAt(userId: string): { emoji: string; at: number } | null {
    return this.lastReaction.get(userId) ?? null
  }

  /** Uma reação de high-five válida (emoji certo, dentro da janela) daquele usuário. */
  private waving(userId: string, now: number): boolean {
    const reaction = this.lastReaction.get(userId)
    return (
      reaction !== undefined
      && reaction.emoji === HIGH_FIVE_EMOJI
      && now - reaction.at <= REACTION_ACTIVE_WINDOW_MS
    )
  }

  /**
   * Avalia se `userId` fecha um high-five com quem está à sua frente. Chamado
   * nos TRÊS pontos que mudam a condição: reação nova, `move()` e `face()` —
   * virar sem andar é o caso mais comum (dois lado a lado, um vira pro outro).
   *
   * Dispara no máximo UM par por avaliação: numa fileira de três, o do meio
   * não vira dois high-fives simultâneos.
   */
  private evaluateHighFive(userId: string): void {
    const now = Date.now()
    if (!this.waving(userId, now)) return
    const me = this.entries.get(userId)?.occupant
    if (!me) return

    // O high-five continua raciocinando em TILE, e isso é deliberado: "estar de
    // frente" é uma relação de vizinhança, não uma distância em pixel. Medir em
    // pixel exigiria escolher um raio e um cone de mira, e transformaria um
    // gesto simples num teste de pontaria.
    const meTile = this.tileOf(me)
    const frontX = meTile.x + DIRECTION_DELTAS[me.dir].x
    const frontY = meTile.y + DIRECTION_DELTAS[me.dir].y

    for (const [otherId, entry] of this.entries) {
      if (otherId === userId) continue
      const other = entry.occupant
      const otherTile = this.tileOf(other)
      // Ele está no tile que eu encaro...
      if (otherTile.x !== frontX || otherTile.y !== frontY) continue
      // ...e me encara de volta. Isso já implica adjacência (delta tem norma 1),
      // então não precisa de teste de distância separado.
      if (otherTile.x + DIRECTION_DELTAS[other.dir].x !== meTile.x) continue
      if (otherTile.y + DIRECTION_DELTAS[other.dir].y !== meTile.y) continue
      if (!this.waving(otherId, now)) continue

      const pairKey = [userId, otherId].sort().join('|')
      if (now - (this.lastHighFiveAt.get(pairKey) ?? 0) < HIGH_FIVE_COOLDOWN_MS) continue

      this.lastHighFiveAt.set(pairKey, now)
      // Consome as duas reações: é ISTO que dá a semântica "bateu, agora acenem
      // de novo pra bater de novo" — e não o cooldown, que é curto de propósito
      // (só cobre a animação). Sem o consumo, dois acenos ainda dentro da janela
      // de 3s ficariam redisparando a cada avaliação.
      this.lastReaction.delete(userId)
      this.lastReaction.delete(otherId)
      // Sorteio da palma perfeita aqui, e não no cliente: o broadcast é o único
      // ponto em que os dois lados compartilham o mesmo resultado.
      const perfect = Math.random() < PERFECT_HIGH_FIVE_CHANCE
      this.broadcast({ type: 'high-five', userIds: [userId, otherId], perfect })
      return
    }
  }

  /** Envia uma mensagem a todas as abas de um usuário. false se ele não está no escritório. */
  sendToUser(userId: string, message: OfficeServerMessage): boolean {
    const entry = this.entries.get(userId)
    if (!entry) return false
    const payload = JSON.stringify(message)
    for (const socket of entry.sockets) {
      try {
        socket.send(payload)
      } catch {
        // socket morto: o close handler da rota limpa
      }
    }
    return true
  }

  /** Mesa reivindicada — todo mundo atualiza o indicador de ocupação no mapa. */
  broadcastDeskClaimed(deskId: string, externalKey: string, user: { id: string; name: string }): void {
    this.broadcast({ type: 'desk-claimed', deskId, externalKey, user })
  }

  /** Mesa liberada (pelo dono ou por um admin). */
  broadcastDeskReleased(deskId: string, externalKey: string): void {
    this.broadcast({ type: 'desk-released', deskId, externalKey })
  }

  /** Lembrete deixado na mesa — todo mundo desenha o presente. */
  broadcastDeskReminderCreated(reminder: OfficeDeskReminderSummaryDTO): void {
    this.broadcast({ type: 'desk-reminder-created', reminder })
  }

  /** Lembrete lido pelo dono — todo mundo remove o presente. */
  broadcastDeskReminderRead(reminderId: string, deskId: string, deskExternalKey: string, senderId: string, recipientId: string): void {
    this.broadcast({ type: 'desk-reminder-read', reminderId, deskId, deskExternalKey, senderId, recipientId })
  }

  /**
   * O avatar de um usuário mudou (PATCH /auth/me): atualiza o occupant e avisa
   * todo mundo (inclusive o próprio) — o personagem troca ao vivo, sem reentrar.
   * No-op se a pessoa não está no escritório.
   */
  updateAvatar(userId: string, avatarSeed: string | null, avatarOptions: CharacterOptions | null): void {
    const entry = this.entries.get(userId)
    if (!entry) return
    entry.occupant.avatarSeed = avatarSeed
    entry.occupant.avatarOptions = avatarOptions
    this.broadcast({ type: 'avatar-updated', userId, avatarSeed, avatarOptions })
  }

  /**
   * Troca manual de status de presença (menu do chip de identidade). Só da
   * sessão — não persiste, reseta pra 'online' no próximo join.
   */
  setStatus(socket: OfficeSocket, userId: string, status: OfficeUserStatus): void {
    if (this.socketOwner.get(socket) !== userId) return
    const entry = this.entries.get(userId)
    if (!entry) return
    // Dentro da sala de silêncio o status fica travado em 'away' — ignora
    // qualquer troca manual (mesmo pra 'brb') enquanto a pessoa estiver lá.
    const effectiveStatus = this.isInPrivateZoneOf(entry.occupant) ? 'away' : status
    entry.occupant.status = effectiveStatus
    this.broadcast({ type: 'status-changed', userId, status: effectiveStatus })
  }

  /**
   * Alias visual do personagem no mapa. Não altera `occupant.name`, porque
   * esse é o nome real usado fora do rótulo do personagem.
   */
  setCharacterName(socket: OfficeSocket, userId: string, name: string | null): void {
    if (this.socketOwner.get(socket) !== userId) return
    const entry = this.entries.get(userId)
    if (!entry) return
    const trimmed = name?.trim().slice(0, OFFICE_CHARACTER_NAME_MAX_LENGTH) || null
    entry.occupant.characterName = trimmed
    this.broadcast({ type: 'character-name-changed', userId, name: trimmed })
  }


  /**
   * Um usuário chama outro. Relay puro: o hub não guarda estado de chamada,
   * só retransmite. Anti-spoof (o socket tem que ser dono do callerId),
   * anti-spam (CALL_COOLDOWN_MS) e feedback de offline.
   */
  call(callerSocket: OfficeSocket, callerId: string, targetUserId: string): void {
    if (this.socketOwner.get(callerSocket) !== callerId) return
    const caller = this.entries.get(callerId)
    if (!caller) return

    const now = Date.now()
    const last = this.lastCallAt.get(callerId) ?? 0
    if (now - last < CALL_COOLDOWN_MS) {
      this.sendToUser(callerId, { type: 'call-failed', targetUserId, reason: 'rate-limited' })
      return
    }

    const target = this.entries.get(targetUserId)
    if (!target) {
      this.sendToUser(callerId, { type: 'call-failed', targetUserId, reason: 'offline' })
      return
    }
    if (target.occupant.status !== 'online') {
      this.sendToUser(callerId, { type: 'call-failed', targetUserId, reason: 'away' })
      return
    }

    this.lastCallAt.set(callerId, now)
    // Ligar é sinal de vida do CHAMADOR (o alvo já foi barrado acima se não
    // estivesse online).
    this.markActive(callerId)
    this.sendToUser(targetUserId, {
      type: 'incoming-call',
      from: { userId: callerId, name: caller.occupant.name },
    })
  }

  /** O alvo respondeu; encaminha o resultado só ao chamador (se ainda presente). */
  callResponse(socket: OfficeSocket, responderId: string, callerId: string, accepted: boolean): void {
    if (this.socketOwner.get(socket) !== responderId) return
    // Aceitar também é sinal de vida. Na prática raro — `call()` barra o
    // convite quando o alvo não está online —, mas cobre a corrida de quem
    // ficou ausente entre o convite sair e ser respondido.
    if (accepted) this.markActive(responderId)
    this.sendToUser(callerId, { type: 'call-result', targetUserId: responderId, accepted })
  }

  /**
   * Reação/chat efêmero: não persiste, só vira balão em todos os clientes conectados.
   *
   * `kind === 'reaction'` tem efeito colateral: grava o emoji + timestamp em
   * `lastReaction` (estado que sobrevive à mensagem) e, com ele no lugar, roda
   * `evaluateHighFive` — é daí que sai o high-five entre dois que acenam.
   */
  nearbyMessage(
    socket: OfficeSocket,
    userId: string,
    text: string,
    kind: OfficeNearbyMessageKind = 'speech',
  ): void {
    if (this.socketOwner.get(socket) !== userId) return
    const entry = this.entries.get(userId)
    if (!entry) return
    // Corta por code point, não por unidade UTF-16: `.slice` parte emoji no meio e
    // deixaria o servidor cortar mensagem que o cliente já tinha dado como válida.
    const trimmed = [...text.trim()].slice(0, OFFICE_NEARBY_MESSAGE_MAX_LENGTH).join('')
    if (!trimmed) return
    if (kind === 'thought') entry.occupant.thoughtText = trimmed
    if (kind === 'reaction') this.lastReaction.set(userId, { emoji: trimmed, at: Date.now() })
    this.markActive(userId)
    this.broadcast({ type: 'nearby-message', userId, text: trimmed, kind })
    if (kind === 'reaction') this.evaluateHighFive(userId)
  }

  /**
   * Mensagem de texto do chat da sala. Não persiste em banco — vive em
   * memória, associada ao `room.id` da posição ATUAL de quem manda. Fora de
   * sala (espaço aberto), é no-op: chat de sala só existe dentro de sala.
   */
  roomChatMessage(socket: OfficeSocket, userId: string, text: string): void {
    if (this.socketOwner.get(socket) !== userId) return
    const entry = this.entries.get(userId)
    if (!entry) return
    const room = this.roomOf(entry.occupant)
    if (!room) return
    const trimmed = text.trim().slice(0, ROOM_CHAT_MESSAGE_MAX_LENGTH)
    if (!trimmed) return
    this.markActive(userId)

    const message = {
      userId,
      name: entry.occupant.name,
      text: trimmed,
      sentAt: new Date().toISOString(),
    }
    this.broadcastToRoom(
      room.id,
      { type: 'room-chat-message', roomId: room.id, ...message },
      socket,
    )
  }

  /**
   * Um lote de pontos de um traço sobre a tela compartilhada. Efêmero como o
   * confete: nada é guardado, então quem chega no meio de um traço não o vê —
   * coerente com um apontador.
   *
   * Escopo: dentro de sala de reunião OU zona privada (`raiseHandZoneIdAtTile`, as
   * duas modalidades onde a mão levantada forma fila), só quem está na
   * mesma zona — público mais amplo que o do chat da sala (`roomChatMessage`,
   * que só existe dentro de sala de reunião); fora de qualquer zona, o
   * escritório todo, e o cliente descarta o que for de uma tela que ele não
   * está vendo — mesmo desenho de `nearby-message`. Em ambos os casos quem
   * desenhou não recebe de volta: o traço já apareceu localmente.
   */
  screenAnnotation(
    socket: OfficeSocket,
    userId: string,
    message: { sharerId: unknown; strokeId: unknown; points: unknown; done?: unknown },
  ): void {
    if (this.socketOwner.get(socket) !== userId) return
    const entry = this.entries.get(userId)
    if (!entry) return
    if (!this.takeAnnotationToken(userId)) return
    if (typeof message.sharerId !== 'string' || !message.sharerId) return
    // Mesmo teto do strokeId: sem isto, um `sharerId` de megabytes seria
    // rebroadcast para todo o escritório — amplificação pelo número de
    // participantes.
    if (message.sharerId.length > OFFICE_ANNOTATION_STROKE_ID_MAX_LENGTH) return
    if (typeof message.strokeId !== 'string' || !message.strokeId) return
    if (message.strokeId.length > OFFICE_ANNOTATION_STROKE_ID_MAX_LENGTH) return
    const points = sanitizeAnnotationPoints(message.points)
    if (!points) return

    const outgoing: OfficeServerMessage = {
      type: 'screen-annotation',
      userId,
      sharerId: message.sharerId,
      strokeId: message.strokeId,
      points,
      // Só carrega o campo quando é o último lote — evita `done: false` no fio.
      ...(message.done === true ? { done: true } : {}),
    }

    const zoneId = this.raiseHandZoneIdOf(entry.occupant)
    if (zoneId) this.broadcastToRoom(zoneId, outgoing, socket)
    else this.broadcast(outgoing, userId)
  }

  /**
   * Alguém começou/parou de lançar confete (segurar F). Relay para todos,
   * inclusive o remetente (sem predição local no cliente). Se essa atualização
   * fez a contagem cruzar de `< CELEBRATION_THRESHOLD` para `>=`, dispara
   * `celebration` — respeitando o `CELEBRATION_COOLDOWN_MS`.
   */
  confetti(socket: OfficeSocket, userId: string, active: boolean): void {
    if (this.socketOwner.get(socket) !== userId) return
    if (!this.entries.has(userId)) return
    // Sem-mudança (reenvio, aba duplicada, cliente adulterado em loop): não
    // republica pra todo mundo — nada mudou no estado real.
    if (active === this.confettiActive.has(userId)) return

    const wasBelow = this.confettiActive.size < CELEBRATION_THRESHOLD
    if (active) {
      this.confettiActive.add(userId)
      this.confettiSocket.set(userId, socket)
    } else {
      this.confettiActive.delete(userId)
      this.confettiSocket.delete(userId)
    }

    this.broadcast({ type: 'confetti', userId, active })

    if (active && wasBelow && this.confettiActive.size >= CELEBRATION_THRESHOLD) {
      const now = Date.now()
      if (now - this.lastCelebrationAt >= CELEBRATION_COOLDOWN_MS) {
        this.lastCelebrationAt = now
        this.broadcast({ type: 'celebration' })
      }
    }
  }

  /**
   * Remove userId da fila em que estiver (se houver); devolve sala+fila
   * atualizada, ou null se não estava em fila nenhuma. Único ponto que mexe
   * em `raisedHandsByRoom`/`raisedHandRoomOf` — todo caller (ação do próprio,
   * sair da sala, desconexão) passa por aqui.
   */
  private removeFromRaisedHandQueue(userId: string): { roomId: string; queue: string[] } | null {
    const roomId = this.raisedHandRoomOf.get(userId)
    if (!roomId) return null
    this.raisedHandRoomOf.delete(userId)
    const queue = (this.raisedHandsByRoom.get(roomId) ?? []).filter((id) => id !== userId)
    if (queue.length > 0) this.raisedHandsByRoom.set(roomId, queue)
    else this.raisedHandsByRoom.delete(roomId)
    return { roomId, queue }
  }

  /**
   * Levantar (active:true) ou abaixar (active:false) a própria mão. Levantar
   * só funciona DENTRO de uma sala de reunião ou zona privada ("espaço de
   * conversa" — ver `raiseHandZoneIdAtTile`); é no-op em qualquer outro ponto do
   * mapa. Dois efeitos, sempre juntos enquanto a mão está numa zona:
   * 1. Estado global (`raisedHandActive`, mesmo padrão do confete): liga o
   *    ícone sobre o personagem pra todo mundo, esteja perto ou não.
   * 2. Fila da zona (`raisedHandsByRoom`): dirige o contador/lista do topo.
   * Abaixar sempre funciona (mesmo se por algum motivo já tiver saído da
   * zona) e limpa os dois de uma vez. Sair da zona andando também abaixa os
   * dois automaticamente (ver `move()`) — a mão não sobrevive fora dela.
   */
  /** Monta no kart livre mais próximo ou estaciona o veículo atual. */
  rideKart(socket: OfficeSocket, userId: string): void {
    if (this.socketOwner.get(socket) !== userId) return
    const entry = this.entries.get(userId)
    if (!entry) return
    if (entry.occupant.ridingKartId) {
      this.parkKart(userId)
      return
    }

    const occupant = entry.occupant
    // Alcance em PIXEL agora, mas ancorado no que ele sempre significou: "um
    // tile de distância". Com o corpo contínuo, exigir o tile exato deixaria de
    // funcionar por meio pixel — e montar num kart não pode virar teste de
    // pontaria.
    const alcance = (this.runtime?.document.map.tileWidth ?? TILE_SIZE) * 1.5
    const distancia = (candidate: OfficeKart) =>
      Math.hypot(candidate.x - occupant.x, candidate.y - occupant.y)
    const kart = [...this.kartStates.values()]
      .filter((candidate) => !candidate.riderUserId && distancia(candidate) <= alcance)
      .sort((a, b) => distancia(a) - distancia(b) || a.id.localeCompare(b.id))[0]
    if (!kart) return

    occupant.ridingKartId = kart.id
    // Nasce parado e apontado para onde a pessoa encara — senão o kart herdaria
    // um rumo velho e sairia de lado no primeiro acelerador.
    occupant.heading = Math.atan2(DIRECTION_DELTAS[occupant.dir].y, DIRECTION_DELTAS[occupant.dir].x)
    entry.speed = 0
    kart.riderUserId = userId
    kart.x = occupant.x
    kart.y = occupant.y
    kart.dir = occupant.dir
    this.broadcast({ type: 'kart-ride', userId, active: true, kart: { ...kart } })
  }

  /** Atualiza o veículo junto com o piloto sem criar um evento extra por passo. */
  private syncRiderKart(occupant: OfficeOccupant): void {
    if (!occupant.ridingKartId) return
    const kart = this.kartStates.get(occupant.ridingKartId)
    if (!kart || kart.riderUserId !== occupant.userId) return
    kart.x = occupant.x
    kart.y = occupant.y
    kart.dir = occupant.dir
  }

  /** Solta o veículo na posição atual do piloto e anuncia o estacionamento. */
  private parkKart(userId: string): void {
    const entry = this.entries.get(userId)
    const kartId = entry?.occupant.ridingKartId
    if (!entry || !kartId) return
    delete entry.occupant.ridingKartId
    delete entry.occupant.heading
    entry.speed = 0
    const kart = this.kartStates.get(kartId)
    if (!kart) return
    kart.x = entry.occupant.x
    kart.y = entry.occupant.y
    kart.dir = entry.occupant.dir
    delete kart.riderUserId
    this.broadcast({ type: 'kart-ride', userId, active: false, kart: { ...kart } })
  }

  /**
   * Toca ou chuta a bola ao alcance. O cliente manda só o GESTO: direção,
   * força e trajetória saem daqui, de `kickBall`, a partir de onde a pessoa
   * está e do que ela encara — é o que impede um cliente adulterado de mandar
   * a bola para onde quiser.
   *
   * Como o hub não tem loop de tick, a bola não é simulada quadro a quadro: a
   * trajetória inteira é resolvida na hora, o estado já vai para o tile final
   * e cada cliente anima a rolagem no caminho recebido.
   */
  kickBall(
    socket: OfficeSocket,
    userId: string,
    power: OfficeBallPower,
    sprint = false,
    charge = 1,
  ): void {
    if (this.socketOwner.get(socket) !== userId) return
    const entry = this.entries.get(userId)
    if (!entry || !this.runtime) return
    if (!this.takeToken(userId)) return

    const occupant = entry.occupant
    const ball = this.nearestBall(occupant.x, occupant.y)
    if (!ball) return

    // Só o GESTO e a CARGA vêm do cliente. A direção sai do facing autoritativo
    // e a força de `officeKickBall` — o escritório nunca teve mira de mouse, e
    // migrar para pixel não é motivo para dar uma.
    const chutada = officeKickBall({ ball, kicker: occupant, power, sprint, charge })
    if (!chutada) return

    Object.assign(ball, chutada)
    this.markActive(userId)
    this.broadcast({ type: 'ball-kicked', userId, ball: { ...ball }, power })
  }

  /**
   * Condução: quem ANDA por cima da bola a empurra um tile na direção do
   * passo, e o passo seguinte empurra de novo — é o que faz a bola andar no pé
   * de quem conduz em vez de ficar para trás.
   *
   * Nasce do movimento, e não de uma mensagem do cliente (`isOfficeBallPower`
   * recusa `dribble` vindo do socket): aceitar o gesto pelo canal deixaria
   * qualquer um empurrar a bola parado. Sem para onde ir (parede, gente), a
   * bola simplesmente fica — quem conduz passa por cima dela e a perde, como
   * quem leva a bola até a parede.
   */
  /**
   * Roda as bolas: integra, resolve quem as encosta e avisa quando alguma se
   * mexe.
   *
   * No tick e DEPOIS do movimento, pelo mesmo motivo da arena: encostar é
   * consequência de onde a pessoa ESTÁ, e resolver isso na chegada do input
   * deixaria o resultado depender do ritmo dos pacotes.
   *
   * O drible deixou de sair do `delta` do passo — que não existe mais — e passou
   * a sair do CONTATO: quem está em cima dela, andando, a empurra.
   */
  private updateBalls(elapsed: number): number {
    const grid = this.collisionGrid()
    if (!grid || this.ballStates.size === 0) return 0
    const now = Date.now()
    let emMovimento = 0

    for (const ball of this.ballStates.values()) {
      const antes = { x: ball.x, y: ball.y }
      Object.assign(ball, stepBodyBall(ball, elapsed, grid))
      for (const entry of this.entries.values()) {
        const intencao = this.moveOf(entry, now)
        const toque = touchBodyBall(ball, {
          x: entry.occupant.x,
          y: entry.occupant.y,
          dx: intencao.dx,
          dy: intencao.dy,
          sprint: intencao.sprint,
        })
        if (toque) Object.assign(ball, toque)
      }
      if (ball.x !== antes.x || ball.y !== antes.y) emMovimento += 1
    }
    return emMovimento
  }

  /**
   * A intenção de passo que vale AGORA — a mesma da arena, e pelo mesmo motivo:
   * input que parou de chegar (aba em segundo plano, rede caída) não pode
   * deixar alguém conduzindo a bola para sempre.
   */
  private moveOf(entry: Entry, now: number): { dx: number; dy: number; sprint: boolean } {
    if (now - entry.lastMoveAt > MOVE_INTENT_TTL_MS) return { dx: 0, dy: 0, sprint: false }
    return entry.lastMove
  }

  /**
   * Equipa ou guarda o marcador de paintball. Estado efêmero do occupant, como
   * `ridingKartId`: viaja no `welcome` dentro da própria pessoa e some quando
   * ela sai — não encosta em `avatarOptions` nem no editor de personagem.
   *
   * É a guarda que impede o escritório de virar campo de tiro por acidente:
   * `firePaintball` recusa quem está desarmado, e quem olha o mapa vê pelo
   * sprite quem está jogando.
   */
  setPaintMarker(socket: OfficeSocket, userId: string, active: boolean): void {
    if (this.socketOwner.get(socket) !== userId) return
    const entry = this.entries.get(userId)
    if (!entry) return
    if ((entry.occupant.paintMarker ?? false) === active) return
    if (active) entry.occupant.paintMarker = true
    else delete entry.occupant.paintMarker
    this.markActive(userId)
    this.broadcast({ type: 'paint-marker', userId, active })
  }

  /**
   * Atira. Como o chute, o cliente manda só o GESTO: direção é o facing
   * autoritativo, alcance é constante e o alvo é quem estiver na linha
   * (`firePaintball`, em `@legends/shared`) — cliente adulterado não escolhe
   * em quem acerta.
   *
   * Duas guardas moram aqui, e não no cliente. A primeira é estar armado. A
   * segunda é a cadência: cada tiro aceito é broadcast para o escritório
   * inteiro, e sem `PAINTBALL_COOLDOWN_MS` um teclado com auto-repeat já vira
   * metralhadora de broadcast, sem precisar de má-fé.
   */
  firePaintball(socket: OfficeSocket, userId: string): void {
    if (this.socketOwner.get(socket) !== userId) return
    const entry = this.entries.get(userId)
    if (!entry || !this.runtime) return
    if (!entry.occupant.paintMarker) return

    const now = Date.now()
    const last = this.lastPaintballAt.get(userId) ?? 0
    if (now - last < PAINTBALL_COOLDOWN_MS) return
    this.lastPaintballAt.set(userId, now)

    const occupant = entry.occupant
    const grid = this.collisionGrid()
    if (!grid) return
    // A direção é o FACING autoritativo, não uma mira do cliente: o escritório
    // não tem mouse apontando, e migrar para pixel não é motivo para dar um.
    const angle = Math.atan2(DIRECTION_DELTAS[occupant.dir].y, DIRECTION_DELTAS[occupant.dir].x)
    const shot = fireBodyShot({
      grid,
      shooter: { userId, x: occupant.x, y: occupant.y },
      angle,
      // Quem está ausente não leva marca nem para o tiro de quem está atrás —
      // a sala de silêncio não vira escudo, e nem alvo.
      targets: [...this.entries.values()]
        .filter((other) => (other.occupant.status ?? 'online') !== 'away')
        .map((other) => ({
          userId: other.occupant.userId,
          x: other.occupant.x,
          y: other.occupant.y,
        })),
      now,
    })

    if (shot.splat) {
      // Teto por pessoa, com a mais VELHA saindo: uma rajada em cima de alguém
      // parado empilharia dezenas de sprites no mesmo personagem.
      const live = this.livePaintSplats(shot.splat.userId, now)
      const next = [...live, { ...shot.splat, expiresAt: now + shot.splat.ttlMs }].slice(
        -PAINTBALL_MAX_SPLATS,
      )
      this.paintSplats.set(shot.splat.userId, next)
    }

    this.markActive(userId)
    this.broadcast({ type: 'paintball-shot', shot })
  }

  /** Bola mais próxima ao alcance do pé; empate desempata por id, como o kart. */
  private nearestBall(x: number, y: number): OfficeBall | null {
    return (
      [...this.ballStates.values()]
        .filter((ball) => isBallInReach(ball, { x, y }))
        .sort(
          (a, b) =>
            ballDistanceFrom(a, { x, y }) - ballDistanceFrom(b, { x, y }) || a.id.localeCompare(b.id),
        )[0] ?? null
    )
  }

  raiseHand(socket: OfficeSocket, userId: string, active: boolean): void {
    if (this.socketOwner.get(socket) !== userId) return
    const entry = this.entries.get(userId)
    if (!entry) return

    if (!active) {
      if (this.raisedHandActive.delete(userId)) {
        this.raisedHandSocket.delete(userId)
        this.broadcast({ type: 'hand-raised', userId, active: false })
      }
      const removed = this.removeFromRaisedHandQueue(userId)
      if (removed) {
        this.broadcastToRoom(removed.roomId, {
          type: 'raised-hands',
          roomId: removed.roomId,
          queue: removed.queue,
          event: { kind: 'lowered', userId },
        })
      }
      return
    }

    // Sem-mudança (reenvio, aba duplicada): não republica pra todo mundo.
    if (this.raisedHandActive.has(userId)) return
    const zoneId = this.raiseHandZoneIdOf(entry.occupant)
    if (!zoneId) return

    this.raisedHandActive.add(userId)
    this.raisedHandSocket.set(userId, socket)
    this.broadcast({ type: 'hand-raised', userId, active: true })

    const queue = [...(this.raisedHandsByRoom.get(zoneId) ?? []), userId]
    this.raisedHandsByRoom.set(zoneId, queue)
    this.raisedHandRoomOf.set(userId, zoneId)
    this.broadcastToRoom(zoneId, {
      type: 'raised-hands',
      roomId: zoneId,
      queue,
      event: { kind: 'raised', userId },
    })
  }

  /**
   * Trancar/destrancar a sala de reunião onde a pessoa ESTÁ. A tranca é da
   * sala, não de quem trancou: qualquer ocupante liga e desliga, e sair não
   * destranca — quem fica herda a chave (ver `sweepEmptyLockedRooms`). Fora de
   * sala de reunião é no-op; numa sala bloqueada pelo admin também, porque o
   * `Room.status` já barra todo mundo e destrancar aqui não abriria nada.
   */
  setRoomLock(socket: OfficeSocket, userId: string, locked: boolean): void {
    if (this.socketOwner.get(socket) !== userId) return
    const entry = this.entries.get(userId)
    if (!entry) return
    const room = this.roomOf(entry.occupant)
    if (!room || room.status === 'LOCKED') return
    const lockOwnerId = this.roomLockOwnerId(room.externalKey)
    if (lockOwnerId && lockOwnerId !== userId) return

    if (!locked) {
      this.unlockRoom(room.id, userId)
      return
    }
    // Sem-mudança (reenvio, aba duplicada): não republica pra todo mundo.
    if (this.lockedRooms.has(room.id)) return
    this.lockedRooms.add(room.id)
    this.broadcast({ type: 'room-lock-changed', roomId: room.id, locked: true, byUserId: userId })
  }

  /**
   * Tira alguém da CHAMADA da sala onde quem pede está. Ao contrário da
   * tranca, não é de qualquer ocupante: só do manager (`managerOf`) ou de um
   * ADMIN, que modera qualquer sala como rede de segurança.
   *
   * Não mexe no mapa. O personagem continua onde estava, com a sessão intacta
   * — o que cai é só a mídia. Como a sala é derivada da POSIÇÃO, cortar a
   * mídia sozinho não bastaria: parado lá dentro, o cliente pediria outro
   * token e voltaria. Por isso fica a marca em `removedFromRoom`, que nega o
   * token daquela sala até a pessoa sair da área (ver `move`).
   *
   * Devolve o alvo (userId + sala) quando a remoção vale, para a borda derrubar
   * a mídia no LiveKit; `null` quando não vale, e aí nada acontece.
   */
  removeFromRoom(
    socket: OfficeSocket,
    userId: string,
    targetUserId: string,
    options: { isAdmin?: boolean } = {},
  ): { roomId: string; mediaRoom: string | null; targetUserId: string } | null {
    if (this.socketOwner.get(socket) !== userId) return null
    if (targetUserId === userId) return null // ninguém se remove: para isso basta sair andando
    const entry = this.entries.get(userId)
    const target = this.entries.get(targetUserId)
    if (!entry || !target) return null

    const room = this.roomOf(entry.occupant)
    if (!room) return null
    // O alvo precisa estar na MESMA sala — remover alguém de longe não existe.
    if (this.roomOf(target.occupant)?.id !== room.id) return null

    const manager = this.managerOf(room.id)
    if (!options.isAdmin && manager?.userId !== userId) return null

    this.removedFromRoom.set(targetUserId, room.id)
    const message = {
      type: 'removed-from-room',
      roomId: room.id,
      userId: targetUserId,
      byUserId: userId,
      byName: entry.occupant.name,
    } as const
    // Vai para a sala inteira (o alvo incluso, que ainda está lá dentro).
    this.broadcastToRoom(room.id, message)
    // `room.id` é do banco; quem identifica a sala no LiveKit é o nome
    // derivado da posição — é ele que a borda usa para derrubar a mídia.
    return {
      roomId: room.id,
      mediaRoom: this.mediaRoomOf(target.occupant),
      targetUserId,
    }
  }

  /** A pessoa foi tirada desta sala e ainda não saiu da área? (gate do token de mídia) */
  isRemovedFromRoom(userId: string, roomId: string): boolean {
    return this.removedFromRoom.get(userId) === roomId
  }

  /**
   * Tocar um vídeo do YouTube para a sala onde a pessoa ESTÁ. O servidor não
   * transporta áudio nenhum: guarda o que tocar e desde quando, e cada cliente
   * na sala roda o próprio player (ver o design de 2026-08-06).
   *
   * O broadcast é para o escritório INTEIRO, como `room-lock-changed`, e não
   * só para a sala: quem ANDA até uma sala que já está tocando precisa saber
   * disso sem que ninguém emita nada de novo. O cliente filtra pela sua sala.
   */
  startRoomAudio(socket: OfficeSocket, userId: string, rawVideo: string, rawPlaylist?: string | null): void {
    if (this.socketOwner.get(socket) !== userId) return
    const entry = this.entries.get(userId)
    if (!entry) return

    const deny = (reason: OfficeRoomAudioDeniedReason) => this.sendTo(socket, { type: 'room-audio-denied', reason })

    // Convidado ouve, mas não inicia — mesma linha do alias de personagem.
    if (entry.occupant.isGuest) return deny('guest')
    const videoId = parseYouTubeVideoId(rawVideo)
    if (!videoId) return deny('invalid')
    // Playlist é opcional e best-effort: mix/lista privada vira `null` no
    // parser e a sala ouve o vídeo sozinho, em vez de um player que não abre.
    const playlistId = rawPlaylist ? parseYouTubePlaylistId(rawPlaylist) : null
    const room = this.roomOf(entry.occupant)
    if (!room) return deny('not-in-room')
    if (this.roomAudio.has(room.id)) return deny('busy')

    const now = Date.now()
    if (now - (this.lastRoomAudioAt.get(userId) ?? 0) < ROOM_AUDIO_START_COOLDOWN_MS) return deny('cooldown')
    this.lastRoomAudioAt.set(userId, now)

    this.roomAudio.set(room.id, {
      videoId,
      playlistId,
      playlistIndex: 0,
      startedByUserId: userId,
      startedByName: entry.occupant.name,
      positionBaseSeconds: 0,
      playingSinceMs: now,
    })
    this.broadcastRoomAudio(room.id)
  }

  /**
   * Quem iniciou avança a playlist e a sala vai junto. O item novo começa do
   * zero (base e relógio zerados) — o servidor não sabe a duração de nada, e
   * não precisa: quem toca é que avisa quando virou.
   *
   * Ouvinte não chega aqui, e a checagem de dono é refeita: a mensagem vem
   * pelo socket, e nada que vem de lá é confiável.
   */
  setRoomAudioItem(socket: OfficeSocket, userId: string, playlistIndex: number, rawVideo: string): void {
    if (this.socketOwner.get(socket) !== userId) return
    if (!Number.isInteger(playlistIndex) || playlistIndex < 0) return
    const videoId = parseYouTubeVideoId(rawVideo)
    if (!videoId) return

    for (const [roomId, track] of this.roomAudio) {
      if (track.startedByUserId !== userId || track.playlistId === null) continue
      // Reenvio do mesmo item (aba duplicada, eco): não republica.
      if (track.playlistIndex === playlistIndex && track.videoId === videoId) return
      track.playlistIndex = playlistIndex
      track.videoId = videoId
      track.positionBaseSeconds = 0
      track.playingSinceMs = Date.now()
      this.broadcastRoomAudio(roomId)
      return
    }
  }

  /**
   * Pausa/retoma a faixa de quem a iniciou, para a sala INTEIRA. Ouvinte não
   * chega aqui: o cliente dele nem oferece o botão, e o hub confere o dono de
   * novo — nada que vem pelo socket é confiável.
   *
   * Pausar congela `positionSeconds` (ver `RoomAudioEntry`), então quem entra
   * na sala durante a pausa nasce parado no mesmo ponto que todo mundo.
   */
  setRoomAudioPaused(socket: OfficeSocket, userId: string, paused: boolean): void {
    if (this.socketOwner.get(socket) !== userId) return
    for (const [roomId, track] of this.roomAudio) {
      if (track.startedByUserId !== userId) continue
      if (paused === (track.playingSinceMs === null)) return // sem-mudança: não republica
      const now = Date.now()
      if (paused) {
        track.positionBaseSeconds = this.roomAudioPosition(track, now)
        track.playingSinceMs = null
      } else {
        track.playingSinceMs = now
      }
      this.broadcastRoomAudio(roomId)
      return
    }
  }

  /** Posição da faixa em segundos — congelada enquanto pausada. */
  private roomAudioPosition(track: RoomAudioEntry, now: number): number {
    if (track.playingSinceMs === null) return track.positionBaseSeconds
    return track.positionBaseSeconds + Math.max(0, Math.floor((now - track.playingSinceMs) / 1000))
  }

  /** Publica o estado atual da faixa de uma sala para o escritório inteiro. */
  private broadcastRoomAudio(roomId: string): void {
    const track = this.roomAudio.get(roomId)
    if (!track) return
    this.broadcast({
      type: 'room-audio-changed',
      roomId,
      track: {
        videoId: track.videoId,
        playlistId: track.playlistId,
        playlistIndex: track.playlistIndex,
        startedByUserId: track.startedByUserId,
        startedByName: track.startedByName,
        positionSeconds: this.roomAudioPosition(track, Date.now()),
        paused: track.playingSinceMs === null,
      },
    })
  }

  /**
   * Encerra a faixa de quem a iniciou. De mais ninguém: quem só está ouvindo
   * abaixa o próprio volume, não desliga o som da sala inteira.
   *
   * Também é por aqui que o fim natural do vídeo chega — o player de quem
   * iniciou dispara `ENDED` e o cliente manda o `stop`. Por isso o hub não
   * precisa saber a duração de nada.
   */
  stopRoomAudio(socket: OfficeSocket, userId: string): void {
    if (this.socketOwner.get(socket) !== userId) return
    for (const [roomId, track] of this.roomAudio) {
      if (track.startedByUserId === userId) this.clearRoomAudio(roomId)
    }
  }

  /** Apaga a faixa da sala e avisa o escritório (o cliente filtra pela sua sala). */
  private clearRoomAudio(roomId: string): void {
    if (!this.roomAudio.delete(roomId)) return
    this.broadcast({ type: 'room-audio-changed', roomId, track: null })
  }

  /**
   * A faixa é de quem a iniciou, então ela não sobrevive à saída dele da sala
   * — nem andando, nem caindo a conexão. Diferente da tranca, que fica com
   * quem continua lá dentro: som ninguém "herda", e sem isso a sala ficaria
   * com um áudio que só o dono ausente poderia parar.
   */
  private clearRoomAudioIfOwnerLeft(roomId: string, userId: string): void {
    if (this.roomAudio.get(roomId)?.startedByUserId === userId) this.clearRoomAudio(roomId)
  }

  /** Posição atual da faixa da sala, em segundos — o que vai para o cliente. */
  private roomAudioEntries(): OfficeRoomAudioEntry[] {
    const now = Date.now()
    return [...this.roomAudio].map(([roomId, track]) => ({
      roomId,
      videoId: track.videoId,
      playlistId: track.playlistId,
      playlistIndex: track.playlistIndex,
      startedByUserId: track.startedByUserId,
      startedByName: track.startedByName,
      positionSeconds: this.roomAudioPosition(track, now),
      paused: track.playingSinceMs === null,
    }))
  }

  private clearRoomAudioState(): void {
    this.roomAudio.clear()
    this.lastRoomAudioAt.clear()
  }

  /**
   * Pedir (`active: true`) ou desistir de pedir (`active: false`) para entrar
   * numa sala trancada. Um pedido por pessoa de cada vez; o `roomId` vem do
   * cliente porque quem pede está FORA da sala.
   */
  knock(socket: OfficeSocket, userId: string, roomId: string, active: boolean): void {
    if (this.socketOwner.get(socket) !== userId) return
    const entry = this.entries.get(userId)
    if (!entry) return

    if (!active) {
      this.clearKnock(userId)
      return
    }
    if (!this.lockedRooms.has(roomId)) return
    // Já está dentro (foi aceito antes, ou a tranca subiu com ele lá): nada a pedir.
    if (this.roomOf(entry.occupant)?.id === roomId) return
    // Pedido idêntico já de pé: não bate na porta duas vezes.
    if (this.knockRoomOf.get(userId) === roomId) return

    const now = Date.now()
    if (now - (this.lastKnockAt.get(userId) ?? 0) < KNOCK_COOLDOWN_MS) {
      // Recusado pelo anti-spam: avisa quem pediu para o botão não ficar
      // preso em "aguardando" até o timeout.
      this.sendToUser(userId, { type: 'knock-cleared', roomId, userId })
      return
    }
    this.lastKnockAt.set(userId, now)
    this.clearKnock(userId) // pedido anterior, em outra sala

    this.pendingKnocks.set(roomId, [...(this.pendingKnocks.get(roomId) ?? []), userId])
    this.knockRoomOf.set(userId, roomId)
    this.broadcastToRoom(roomId, { type: 'knock-request', roomId, userId, name: entry.occupant.name })
  }

  /**
   * Resposta de quem está DENTRO da sala. Quem responder primeiro resolve —
   * o pedido some para os demais via `knock-cleared`. Aceitar concede um
   * passe que vale enquanto a tranca durar.
   */
  knockResponse(socket: OfficeSocket, responderId: string, userId: string, accepted: boolean): void {
    if (this.socketOwner.get(socket) !== responderId) return
    const responder = this.entries.get(responderId)
    if (!responder) return
    const roomId = this.knockRoomOf.get(userId)
    if (!roomId) return
    if (this.roomOf(responder.occupant)?.id !== roomId) return

    this.clearKnock(userId)
    if (accepted) {
      const grants = this.roomEntryGrants.get(roomId) ?? new Set<string>()
      grants.add(userId)
      this.roomEntryGrants.set(roomId, grants)
    }
    this.sendToUser(userId, {
      type: 'knock-result',
      roomId,
      accepted,
      byUserId: responderId,
      byName: responder.occupant.name,
    })
  }

  /**
   * Explica uma entrada recusada a quem esbarrou na porta. Throttled por
   * usuário (ver `ENTRY_DENIED_THROTTLE_MS`) porque uma tecla presa gera uma
   * recusa por passo.
   */
  private sendEntryDenied(
    socket: OfficeSocket,
    userId: string,
    reason: OfficeRoomEntryDeniedReason,
    x: number,
    y: number,
  ): void {
    const room = this.roomForTile(x, y)
    if (!room) return
    const now = Date.now()
    if (now - (this.lastEntryDeniedAt.get(userId) ?? 0) < ENTRY_DENIED_THROTTLE_MS) return
    this.lastEntryDeniedAt.set(userId, now)
    this.sendTo(socket, { type: 'room-entry-denied', roomId: room.id, roomName: room.name, reason, x, y })
  }

  /**
   * Encerra o pedido pendente de `userId`, qualquer que seja o motivo
   * (aceito, recusado, cancelado, entrou, saiu do escritório). Único ponto
   * que mexe em `pendingKnocks`/`knockRoomOf` — mesmo desenho de
   * `removeFromRaisedHandQueue`. Avisa a sala (fecha o modal de quem não
   * respondeu) e também quem pediu (destrava o "aguardando").
   */
  private clearKnock(userId: string): void {
    const roomId = this.knockRoomOf.get(userId)
    if (!roomId) return
    this.knockRoomOf.delete(userId)
    const queue = (this.pendingKnocks.get(roomId) ?? []).filter((id) => id !== userId)
    if (queue.length > 0) this.pendingKnocks.set(roomId, queue)
    else this.pendingKnocks.delete(roomId)
    const message = { type: 'knock-cleared', roomId, userId } as const
    this.broadcastToRoom(roomId, message)
    this.sendToUser(userId, message)
  }

  /** Destranca de fato: some com passes e pedidos pendentes junto. */
  private unlockRoom(roomId: string, byUserId: string | null): void {
    if (!this.lockedRooms.delete(roomId)) return
    this.roomEntryGrants.delete(roomId)
    for (const pendingUserId of [...(this.pendingKnocks.get(roomId) ?? [])]) this.clearKnock(pendingUserId)
    this.broadcast({ type: 'room-lock-changed', roomId, locked: false, byUserId })
  }

  /**
   * A tranca sobrevive a quem trancou, mas não à sala vazia: sem ninguém
   * dentro não há a quem pedir para entrar, e a sala viraria uma porta
   * fechada para sempre.
   *
   * Varre TODAS as trancas, e não só a sala que alguém acabou de deixar, de
   * propósito. Trancar é aceito pela posição em PIXEL (`roomOf`), mas a
   * travessia é detectada pelo tile COMITADO, que tem histerese
   * (`TILE_COMMIT_MARGIN`): quem trancasse de raspão — centro já dentro do
   * tile da sala, sem ter comitado — criava uma tranca que saída nenhuma
   * desfazia, porque o `previousRoom` da cascata era outro. A sala ficava
   * fechada e vazia para sempre, e nem o dono da mesa voltava para dentro.
   * Conferir a invariante pela posição de todo mundo não depende de o evento
   * certo ter sido disparado.
   */
  private sweepEmptyLockedRooms(): void {
    if (this.lockedRooms.size === 0) return
    const ocupadas = new Set<string>()
    for (const entry of this.entries.values()) {
      const room = this.roomOf(entry.occupant)
      if (room) ocupadas.add(room.id)
    }
    for (const roomId of [...this.lockedRooms]) {
      if (!ocupadas.has(roomId)) this.unlockRoom(roomId, null)
    }
  }

  private clearRoomLockState(): void {
    this.lockedRooms.clear()
    this.roomEntryGrants.clear()
    this.pendingKnocks.clear()
    this.knockRoomOf.clear()
    this.lastKnockAt.clear()
    this.lastEntryDeniedAt.clear()
  }

  /** Só para testes: zera o estado do singleton entre casos. */
  reset(): void {
    this.entries.clear()
    // Para o laço junto: um hub descartado com `setInterval` vivo continua
    // simulando gente que já saiu, e em teste ele atravessa para o caso
    // seguinte.
    this.stopLoopIfEmpty()
    this.buckets.clear()
    this.annotationBuckets.clear()
    this.socketOwner.clear()
    this.lastCallAt.clear()
    this.confettiActive.clear()
    this.confettiSocket.clear()
    this.editingActive.clear()
    this.editingSocket.clear()
    this.raisedHandActive.clear()
    this.raisedHandSocket.clear()
    this.raisedHandsByRoom.clear()
    this.raisedHandRoomOf.clear()
    this.lastCelebrationAt = 0
    this.lastReaction.clear()
    this.lastHighFiveAt.clear()
    this.kartStates.clear()
    this.ballStates.clear()
    this.roomArrivals.clear()
    this.removedFromRoom.clear()
    this.lastRoomManagersKey = ''
    this.clearRoomLockState()
    this.runtime = null
  }

  /**
   * Spawn estável por pessoa (mesmo id → mesmo tile), caindo para o próximo
   * spawn livre se estiver ocupado. Se todos estiverem ocupados, aceita a
   * sobreposição — pessoas se atravessam de qualquer forma.
   */
  private pickSpawn(userId: string): { x: number; y: number } {
    const taken = new Set(
      [...this.entries.values()].map((e) => `${e.occupant.x},${e.occupant.y}`),
    )
    const spawns = this.runtime ? mapSpawnTiles(this.runtime.document) : []
    const configured = spawns.length > 0 ? spawns : [{ x: 1, y: 1 }]
    const walkableSpawns = configured.filter((tile) => this.walkable(tile.x, tile.y))
    const available = walkableSpawns.length > 0 ? walkableSpawns : configured
    const start = officeHash(userId) % available.length
    for (let i = 0; i < available.length; i += 1) {
      const tile = available[(start + i) % available.length]
      if (!taken.has(`${tile.x},${tile.y}`)) return tile
    }
    return available[start]
  }

  /** Mesma regra do cliente para um passo inteiro (inclui a quina da diagonal). */
  private canStep(from: { x: number; y: number }, move: MoveDirection): boolean {
    if (!this.runtime) return false
    return canStepTo(this.runtime.document, from, move, [...this.kartStates.values()])
  }

  private walkable(x: number, y: number): boolean {
    if (!this.runtime) return false
    // MESMA função que o cliente usa para prever o passo e para traçar a
    // caminhada automática — divergir aqui volta a produzir predição que o
    // servidor recusa (ver `isMapTileWalkable`).
    return isMapTileWalkable(this.runtime.document, x, y, [...this.kartStates.values()])
  }

  /**
   * Por que a entrada em (x,y) seria recusada, ou `null` se ela é permitida.
   * Devolver o motivo (em vez de um booleano) é o que permite ao `move`
   * explicar a recusa ao cliente — só a tranca de sessão (`locked`) aceita
   * "pedir para entrar"; as demais não têm a quem pedir.
   */
  private roomEntryDenialAtTile(
    userId: string,
    x: number,
    y: number,
    /**
     * De onde a pessoa vem. Explícito, e não lido do occupant, porque no
     * movimento contínuo a posição JÁ FOI aplicada quando esta pergunta é
     * feita: ler o occupant faria o "já estou nesta sala" enxergar o destino e
     * liberar toda entrada — a tranca deixaria de trancar, em silêncio.
     */
    fromTile?: { x: number; y: number },
  ): OfficeRoomEntryDeniedReason | null {
    const room = this.roomForTile(x, y)
    if (!room) return null
    const origem = fromTile ?? (this.occupantOf(userId) ? this.tileOf(this.occupantOf(userId)!) : null)
    if (origem && this.roomForTile(origem.x, origem.y)?.id === room.id) return null
    if (room.status === 'LOCKED') return 'admin-locked'
    if (this.lockedRooms.has(room.id) && !this.roomEntryGrants.get(room.id)?.has(userId)) return 'locked'
    if (room.accessPolicy === 'ALLOWLIST' && !room.allowedUsers.some((user) => user.id === userId)) return 'allowlist'
    if (room.capacity !== null) {
      // Sem contar QUEM ESTÁ ENTRANDO. No movimento contínuo a posição já foi
      // aplicada quando esta pergunta é feita, então ele apareceria dentro da
      // sala e ocuparia a própria vaga — uma sala de capacidade N só admitiria
      // N−1, e a última vaga nunca seria usada.
      const occupants = this.occupants().filter(
        (occupant) => occupant.userId !== userId && this.roomOf(occupant)?.id === room.id,
      )
      if (occupants.length >= room.capacity) return 'capacity'
    }
    return null
  }

  private takeToken(userId: string): boolean {
    const bucket = this.buckets.get(userId)
    if (!bucket) return false
    const now = Date.now()
    const refill = ((now - bucket.updatedAt) / 1000) * MOVES_PER_SECOND
    bucket.tokens = Math.min(BURST, bucket.tokens + refill)
    bucket.updatedAt = now
    if (bucket.tokens < 1) return false
    bucket.tokens -= 1
    return true
  }

  /** Mesmo algoritmo de `takeToken`, bucket e taxa separados para `screenAnnotation`. */
  private takeAnnotationToken(userId: string): boolean {
    const bucket = this.annotationBuckets.get(userId)
    if (!bucket) return false
    const now = Date.now()
    const refill = ((now - bucket.updatedAt) / 1000) * ANNOTATION_MESSAGES_PER_SECOND
    bucket.tokens = Math.min(ANNOTATION_BURST, bucket.tokens + refill)
    bucket.updatedAt = now
    if (bucket.tokens < 1) return false
    bucket.tokens -= 1
    return true
  }

  private sendTo(socket: OfficeSocket, message: OfficeServerMessage): void {
    try {
      socket.send(JSON.stringify(message))
    } catch {
      // socket morto: o close handler da rota limpa
    }
  }

  private broadcast(message: OfficeServerMessage, exceptUserId?: string): void {
    const payload = JSON.stringify(message)
    for (const [userId, entry] of this.entries) {
      if (userId === exceptUserId) continue
      for (const socket of entry.sockets) {
        try {
          socket.send(payload)
        } catch {
          // idem
        }
      }
    }
  }

  /**
   * Broadcast filtrado por zona (sala de reunião OU zona privada — ver
   * `raiseHandZoneIdAtTile`). Callers de sala de reunião (chat, presença) sempre
   * passam um `room.id` de verdade, que `raiseHandZoneIdAtTile` resolve
   * IDENTICAMENTE a `roomForTile(...).id` pra esse tipo de zona — dá no
   * mesmo de antes pra eles. Zona privada só entra em jogo pra quem passa o
   * id ad-hoc dela (hoje, só a mão levantada).
   */
  private broadcastToRoom(
    roomId: string,
    message: OfficeServerMessage,
    exceptSocket?: OfficeSocket,
  ): void {
    const payload = JSON.stringify(message)
    for (const entry of this.entries.values()) {
      if (this.raiseHandZoneIdOf(entry.occupant) !== roomId) continue
      for (const socket of entry.sockets) {
        if (socket === exceptSocket) continue
        try {
          socket.send(payload)
        } catch {
          // idem
        }
      }
    }
  }
}

const officeHubRegistry = new Map<string, OfficeHub>()

/**
 * 1 instância de `OfficeHub` por empresa — presença/broadcast de uma empresa nunca
 * vazam para outra. Cria sob demanda na primeira chamada pra aquele `companyId` e
 * reusa depois. Sem limpeza/GC de propósito: empresas são um conjunto pequeno e
 * controlado por admin, não input de usuário arbitrário — crescer sem limpar é
 * seguro e mais simples que gerenciar ciclo de vida agora (YAGNI).
 *
 * A classe `OfficeHub` em si não muda: todo método já só toca campos privados
 * da própria instância (nunca um estado externo compartilhado), então múltiplas
 * instâncias independentes já funcionavam antes disso — é só isso que resolve de
 * graça a colisão de `roomId` entre empresas (`raisedHandsByRoom`/`lockedRooms`/
 * `roomEntryGrants`/`pendingKnocks`): cada hub só vê `roomId`s do próprio `runtime`.
 */
export function getOfficeHub(companyId: string): OfficeHub {
  let hub = officeHubRegistry.get(companyId)
  if (!hub) {
    hub = new OfficeHub()
    officeHubRegistry.set(companyId, hub)
  }
  return hub
}

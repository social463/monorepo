import {
  ROOM_CHAT_MESSAGE_MAX_LENGTH,
  BODY_MAX_PENDING_INPUTS,
  BODY_SHOT_COOLDOWN_MS,
  ARENA_INTERMISSION_MS,
  ARENA_MATCH_MS,
  ARENA_RESPAWN_MS,
  ARENA_SPAWN_PROTECTION_MS,
  ARENA_TEAMS,
  ARENA_FLAG_RETURN_MS,
  ARENA_MAX_HITS,
  applyArenaHit,
  hitsAfterRecovery,
  PAINTBALL_MAX_SPLATS,
  flagInteraction,
  initialFlags,
  rivalTeam,
  scoreLimitFor,
  arenaHitRefusal,
  balanceTeam,
  emptyScores,
  fireBodyShot,
  matchIsOver,
  matchWinner,
  BODY_MAX_STEP_MS,
  BODY_SNAPSHOT_HZ,
  BODY_TICK_HZ,
  BODY_TIME_BUDGET_CAP_MS,
  bodyCollisionGrid,
  arenaDocumentFor,
  bodySpawnPoint,
  BODY_BALL_KICK_COOLDOWN_MS,
  ARENA_SOCCER_KICKOFF_MS,
  kickBodyBall,
  modeHasShooting,
  modeIsRace,
  restingBall,
  soccerGoalScored,
  soccerKickoffSpot,
  stepBodyBall,
  touchBodyBall,
  mapSpawnTiles,
  stepBody,
  stepBodyKart,
  advanceRaceRunner,
  newRaceRunner,
  pointAt,
  raceProgressAt,
  raceStandings,
  ARENA_RACE_COUNTDOWN_MS,
  ARENA_RACE_FINISH_GRACE_MS,
  ARENA_RACE_LAPS,
  RACE_TRACK,
  type ArenaBallSnapshot,
  type BodyBallState,
  type BodyKickPower,
  type BodyCollisionGrid,
  type BodyInput,
  type ArenaOccupant,
  type ArenaServerMessage,
  type MapDocumentV1,
  type PaintSplat,
  type ArenaMatchPhase,
  type ArenaMatchState,
  type ArenaMode,
  type ArenaTeam,
  type ArenaFlags,
  type BodyKartState,
  type ArenaRaceRunner,
  type ArenaRaceSnapshot,
} from '@legends/shared'

export interface ArenaSocket {
  send(data: string): void
}

export interface ArenaUser {
  id: string
  name: string
  avatarSeed: string | null
  avatarOptions: unknown
}

/**
 * Por quanto tempo a última intenção de passo continua valendo.
 *
 * O cliente amostra input a 30Hz (~33ms); alguns quadros de folga cobrem
 * jitter sem deixar um jogador que sumiu conduzindo a bola indefinidamente.
 */
const MOVE_INTENT_TTL_MS = 200

/** Quantos ticks entre dois snapshots. Inteiro por construção (ver `BODY_TICK_HZ`). */
const TICKS_PER_SNAPSHOT = Math.round(BODY_TICK_HZ / BODY_SNAPSHOT_HZ)

interface Entry {
  player: ArenaOccupant
  sockets: Set<ArenaSocket>
  /** Instante em que volta ao jogo; `0` = está em campo. */
  downedUntil: number
  /** Instante até o qual não pode ser atingido (carência de renascimento). */
  protectedUntil: number
  /** Tiros acumulados nesta vida, antes da recuperação pelo tempo. */
  hits: number
  lastHitAt: number
  /** Inputs recebidos e ainda não simulados, em ordem de chegada. */
  pending: BodyInput[]
  /** Último `seq` já aplicado — volta no snapshot e guia a reconciliação. */
  lastSeq: number
  /** Tempo de simulação creditado e ainda não gasto (ver `BODY_TIME_BUDGET_CAP_MS`). */
  budgetMs: number
  /**
   * A última intenção de passo aplicada, e quando. É ela que diz se a pessoa
   * CONDUZ a bola ou apenas está no caminho dela — e o instante existe porque
   * input que parou de chegar (aba em segundo plano, rede caída) não pode
   * deixar alguém conduzindo para sempre.
   */
  lastMove: { dx: number; dy: number; sprint: boolean }
  lastMoveAt: number
  /**
   * Velocidade do kart, em px/s. Só a corrida usa.
   *
   * Mora aqui, e não em `player`, porque não é presença: o `ArenaOccupant` é o
   * que descreve alguém para os OUTROS, e velocidade só interessa a quem simula
   * (e a quem reconcilia, que a recebe pelo snapshot).
   */
  speed: number
  /**
   * Vaga do grid, fixa enquanto a pessoa estiver na arena.
   *
   * Fixa de propósito: se ela fosse recalculada pela posição na lista, alguém
   * saindo faria todo mundo atrás trocar de vaga na largada seguinte.
   */
  gridSlot: number
}

/**
 * Uma partida de arena — estado inteiramente em memória, como o escritório.
 *
 * Diferente do `OfficeHub`, este é orientado a TICK: ele simula em passo fixo e
 * emite snapshots. A objeção que derrubou o loop na bola era **timer ocioso por
 * empresa**, não o loop em si — então aqui o timer nasce no primeiro que entra
 * e morre quando a arena esvazia (`startLoop`/`stopLoop`). Arena vazia não
 * custa nada.
 *
 * O servidor é autoritativo: o cliente manda INTENÇÃO (`dx`/`dy`), nunca
 * posição, e quem integra é `stepBody` — a mesma função que a predição do
 * cliente roda, o que faz os dois convergirem por construção.
 */
export class ArenaHub {
  private document: MapDocumentV1 | null = null
  private grid: BodyCollisionGrid | null = null
  private entries = new Map<string, Entry>()
  private socketOwner = new Map<ArenaSocket, string>()
  /**
   * Marcas de tinta vivas, por quem as levou — mesmo desenho do escritório:
   * sem timer por marca, quem lê é quem poda.
   */
  private paintSplats = new Map<string, Array<PaintSplat & { expiresAt: number }>>()
  /** Último disparo de cada um (cadência do marcador). */
  private lastShotAt = new Map<string, number>()
  private phase: ArenaMatchPhase = 'jogando'
  private scores = emptyScores()
  /** Instante em que a fase atual acaba. */
  private phaseEndsAt = 0
  private lastWinner: ArenaTeam | null = null
  private mode: ArenaMode = 'mata-mata'
  /** Só usado no modo bandeira. */
  private flags: ArenaFlags = initialFlags()
  /** Só usada no futebol; `null` nos modos de tiro. */
  private ball: BodyBallState | null = null
  /**
   * Até quando a bola fica parada no meio depois de um gol. Prazo, não fase:
   * `phase` continua `jogando` e ninguém perde o teclado na comemoração.
   */
  private ballLockedUntil = 0
  /** Quem tocou na bola por último — o autor do gol, inclusive do contra. */
  private lastTouchedBy: string | null = null
  /** Último chute de cada um (cadência do pé). */
  private lastKickAt = new Map<string, number>()
  /** Instante em que cada bandeira caída volta sozinha para casa. */
  private flagReturnAt: Record<ArenaTeam, number> = { oeste: 0, leste: 0 }
  /** Progresso de cada piloto. Só a corrida usa; vazio nos outros modos. */
  private raceRunners = new Map<string, ArenaRaceRunner>()
  /**
   * Até quando o semáforo segura o grid. Prazo, não fase: `phase` continua
   * `jogando` e ninguém perde o teclado — mesmo desenho do `ballLockedUntil`.
   */
  private raceCountdownUntil = 0
  /**
   * Bandeirada final: instante em que a corrida acaba mesmo com gente na pista.
   * `0` = ninguém terminou ainda.
   */
  private raceFinishUntil = 0
  /** Ordem de chegada, na ordem em que cruzaram. */
  private racePodium: string[] = []
  private timer: ReturnType<typeof setInterval> | null = null
  private tickCount = 0
  private lastTickAt = 0

  /**
   * O cenário da arena é GERADO (`arenaDocumentFor`), não publicado: cliente e
   * servidor chamam a mesma função e chegam ao mesmo mapa, sem documento
   * trafegando no fio nem guardado no banco. Aceita um documento por parâmetro
   * só para teste.
   *
   * O modo escolhe o cenário: mata-mata e bandeira dividem o campo de batalha,
   * o futebol tem campo próprio. Por isso o documento é derivado do modo JÁ
   * decidido (`this.mode`), e não do pedido — senão a segunda conexão poderia
   * trocar o mapa debaixo de quem está jogando.
   */
  configure(document?: MapDocumentV1, mode: ArenaMode = 'mata-mata'): void {
    // O modo só muda com a arena VAZIA. `configure` roda a cada conexão, e sem
    // esta guarda o segundo a entrar trocaria o modo no meio da partida de
    // quem já estava dentro.
    if (this.entries.size === 0) this.mode = mode
    this.document = document ?? arenaDocumentFor(this.mode)
    this.grid = bodyCollisionGrid(this.document)
    if (this.mode === 'futebol') this.ball ??= restingBall(soccerKickoffSpot())
    else this.ball = null
  }

  /**
   * Ponto de nascimento: o spawn do mapa, ou o ponto com folga mais próximo
   * dele. O spawn desenhado para a grade costuma ser um vão de um tile, onde
   * um corpo contínuo nasce praticamente entalado (ver `bodySpawnPoint`).
   */
  private spawnPoint(team: ArenaTeam): { x: number; y: number } {
    const document = this.document
    const grid = this.grid
    if (!document || !grid) return { x: 0, y: 0 }
    // Cada time na SUA base. É o que dá função às duas pontas do mapa e cria o
    // vai-e-vem da partida: renascer onde caiu apagaria a noção de território.
    const spawns = mapSpawnTiles(document)
    const indice = ARENA_TEAMS.indexOf(team)
    const tile = spawns[indice] ?? spawns[0] ?? { x: 1, y: 1 }
    return bodySpawnPoint(
      document,
      grid,
      tile,
      [...this.entries.values()].map((entry) => ({ x: entry.player.x, y: entry.player.y })),
    )
  }

  /**
   * A menor vaga do grid que ninguém ocupa.
   *
   * A menor, e não a próxima da fila, para que a saída de alguém do meio libere
   * a vaga dele — senão a arena iria empurrando todo mundo para o fim do grid
   * ao longo do expediente, até estourar as vagas.
   *
   * Estourando (mais gente que `ARENA_RACE_GRID_SLOTS`), o excedente larga na
   * última vaga: apertado é melhor que não largar.
   */
  private freeGridSlot(): number {
    const ocupadas = new Set([...this.entries.values()].map((entry) => entry.gridSlot))
    for (let slot = 0; slot < RACE_TRACK.grid.length; slot += 1) {
      if (!ocupadas.has(slot)) return slot
    }
    return RACE_TRACK.grid.length - 1
  }

  /** Onde e apontado para onde um piloto larga. */
  private gridPlace(slot: number): { x: number; y: number; heading: number } {
    const vaga = RACE_TRACK.grid[Math.min(slot, RACE_TRACK.grid.length - 1)]
    return { x: vaga.x, y: vaga.y, heading: vaga.heading }
  }

  private teamCounts(): Record<ArenaTeam, number> {
    const counts = emptyScores()
    for (const entry of this.entries.values()) counts[entry.player.team] += 1
    return counts
  }

  /** Estado da partida como o cliente vê — sempre com tempo RESTANTE. */
  matchState(): ArenaMatchState {
    return {
      mode: this.mode,
      phase: this.phase,
      scores: { ...this.scores },
      remainingMs: Math.max(0, this.phaseEndsAt - Date.now()),
      ...(this.phase === 'intervalo' ? { winner: this.lastWinner } : {}),
      ...(this.phase === 'intervalo' && modeIsRace(this.mode) ? { podium: [...this.racePodium] } : {}),
    }
  }

  join(socket: ArenaSocket, user: ArenaUser, arenaId: string): void {
    this.socketOwner.set(socket, user.id)
    const existing = this.entries.get(user.id)

    if (existing) {
      // Outra aba da mesma pessoa entra na MESMA presença, como no escritório.
      existing.sockets.add(socket)
    } else {
      const team = balanceTeam(this.teamCounts())
      // Na corrida o time continua sendo atribuído — metade do hub o usa —, mas
      // é COSMÉTICO: quem larga onde é a vaga do grid, e a classificação é
      // individual.
      const gridSlot = modeIsRace(this.mode) ? this.freeGridSlot() : 0
      // `heading` opcional em vez de dois ramos: o pedestre simplesmente não tem
      // rumo, e o campo some do occupant nos modos que não são a corrida.
      const spawn: { x: number; y: number; heading?: number } = modeIsRace(this.mode)
        ? this.gridPlace(gridSlot)
        : this.spawnPoint(team)
      const player: ArenaOccupant = {
        userId: user.id,
        name: user.name,
        team,
        avatarSeed: user.avatarSeed,
        avatarOptions: (user.avatarOptions ?? null) as ArenaOccupant['avatarOptions'],
        x: spawn.x,
        y: spawn.y,
        dir: 'down',
        ...(spawn.heading === undefined ? {} : { heading: spawn.heading }),
      }
      this.entries.set(user.id, {
        player,
        sockets: new Set([socket]),
        pending: [],
        lastSeq: 0,
        budgetMs: 0,
        lastMove: { dx: 0, dy: 0, sprint: false },
        lastMoveAt: 0,
        speed: 0,
        gridSlot,
        downedUntil: 0,
        hits: 0,
        lastHitAt: 0,
        // Quem acabou de entrar também tem carência: cair no campo já no
        // alcance de alguém e ser abatido antes de ver a tela é o pior
        // primeiro contato possível com o jogo.
        protectedUntil: Date.now() + ARENA_SPAWN_PROTECTION_MS,
      })
      // Quem entra no meio da corrida entra com o progresso do lugar em que
      // largou — que é o fim da volta, atrás da linha. Sem isto ele nasceria
      // com `s = 0` e apareceria em primeiro no painel até dar a primeira volta.
      if (modeIsRace(this.mode)) {
        const progresso = raceProgressAt(RACE_TRACK, spawn.x, spawn.y)
        this.raceRunners.set(user.id, newRaceRunner(progresso.s, progresso.index, Date.now()))
      }
      this.broadcast({ type: 'joined', player: { ...player } }, user.id)
      // A partida começa quando a arena deixa de estar vazia, e não no
      // primeiro tick: `startMatch` reposiciona todo mundo e limpa a fila de
      // input, então rodá-lo depois de o cliente já ter mandado o primeiro
      // passo engoliria esse passo.
      if (this.phaseEndsAt === 0) this.startMatch()
    }

    this.sendTo(socket, {
      type: 'welcome',
      youId: user.id,
      arenaId,
      players: this.players(),
      match: this.matchState(),
      ...(this.mode === 'bandeira' ? { flags: this.flagsSnapshot() } : {}),
      ...(this.ball ? { ball: this.ballSnapshot() } : {}),
      ...(modeIsRace(this.mode) ? { race: this.raceSnapshot(Date.now()) } : {}),
      paintSplats: this.paintSplatsSnapshot(),
    })
    this.startLoop()
  }

  leave(socket: ArenaSocket, userId: string): void {
    if (this.socketOwner.get(socket) !== userId) return
    this.socketOwner.delete(socket)
    const entry = this.entries.get(userId)
    if (!entry) return
    entry.sockets.delete(socket)
    // Presença efêmera e sem período de graça: a arena é uma partida curta, e
    // segurar um corpo parado em campo esperando reconexão atrapalha mais do
    // que ajuda (diferente do escritório, onde a presença é o produto).
    if (entry.sockets.size > 0) return
    // Sair carregando a bandeira a derruba onde a pessoa estava: sumir com ela
    // travaria a partida para sempre.
    this.dropCarriedFlag(userId, entry.player.x, entry.player.y)
    this.entries.delete(userId)
    // Arena vazia zera a partida: o próximo a entrar começa do zero, em vez de
    // herdar o placar de gente que já foi embora.
    if (this.entries.size === 0) this.phaseEndsAt = 0
    this.raceRunners.delete(userId)
    this.paintSplats.delete(userId)
    this.lastShotAt.delete(userId)
    this.lastKickAt.delete(userId)
    if (this.lastTouchedBy === userId) this.lastTouchedBy = null
    this.broadcast({ type: 'left', userId })
    this.stopLoopIfEmpty()
  }

  /**
   * Enfileira a intenção de um jogador. Não simula aqui: quem simula é o tick,
   * senão o ritmo do movimento passaria a ser o ritmo com que os pacotes
   * chegam — e quem tivesse rede pior andaria diferente.
   */
  applyInput(socket: ArenaSocket, userId: string, input: BodyInput): void {
    if (this.socketOwner.get(socket) !== userId) return
    const entry = this.entries.get(userId)
    if (!entry) return
    // Input velho (chegou fora de ordem) não volta no tempo.
    if (input.seq <= entry.lastSeq) return
    // Fila cheia: descarta o mais ANTIGO. Segurar os velhos e recusar os novos
    // deixaria o jogador andando no passado até a fila drenar.
    if (entry.pending.length >= BODY_MAX_PENDING_INPUTS) entry.pending.shift()
    entry.pending.push(input)
  }

  /**
   * Chat da arena — texto para todo mundo que está dentro, sem recorte por
   * distância (ver o comentário do `chat` em `arena.ts`).
   *
   * Não retransmite para quem escreveu: a própria mensagem já entrou na lista
   * localmente, como no chat de sala do escritório.
   */
  chat(socket: ArenaSocket, userId: string, text: string): void {
    if (this.socketOwner.get(socket) !== userId) return
    const entry = this.entries.get(userId)
    if (!entry) return
    const trimmed = text.trim().slice(0, ROOM_CHAT_MESSAGE_MAX_LENGTH)
    if (!trimmed) return
    this.broadcast(
      {
        type: 'chat',
        userId,
        name: entry.player.name,
        text: trimmed,
        sentAt: new Date().toISOString(),
      },
      userId,
    )
  }

  /**
   * Atira. O ÂNGULO vem do cliente (a mira é dele); alcance, parede e acerto
   * são decididos aqui, com a posição autoritativa de todo mundo.
   */
  fire(socket: ArenaSocket, userId: string, angle: number): void {
    if (this.socketOwner.get(socket) !== userId) return
    const entry = this.entries.get(userId)
    const grid = this.grid
    if (!entry || !grid) return
    if (!Number.isFinite(angle)) return

    // Futebol não tem marcador. A recusa é do SERVIDOR, e não só do botão
    // escondido: um cliente adulterado atirando num modo sem vida, sem abate e
    // sem carência não encontraria nenhuma defesa pela frente.
    if (!modeHasShooting(this.mode)) return

    const now = Date.now()
    // Abatido não atira. É a regra que dá peso ao abate: sem ela, levar um
    // tiro custaria só a posição.
    if (entry.downedUntil > now) return

    // Cadência no servidor: cada disparo aceito é broadcast para a arena
    // inteira, então segurar o botão não pode virar metralhadora de pacote.
    if (now - (this.lastShotAt.get(userId) ?? 0) < BODY_SHOT_COOLDOWN_MS) return
    this.lastShotAt.set(userId, now)

    const shot = fireBodyShot({
      grid,
      shooter: { userId, x: entry.player.x, y: entry.player.y },
      angle,
      targets: [...this.entries.values()].map((outro) => ({
        userId: outro.player.userId,
        x: outro.player.x,
        y: outro.player.y,
      })),
      now,
    })

    // O acerto GEOMÉTRICO já aconteceu; o que as regras decidem é se ele
    // CONTA. Separar os dois é o que deixa a mancha aparecer mesmo em fogo
    // amigo (a tinta pegou) sem que ninguém perca ponto por isso.
    const recusa = shot.splat
      ? arenaHitRefusal(this.combatant(userId), this.combatant(shot.splat.userId), now, this.phase)
      : 'fora-de-jogo'

    if (shot.splat) {
      const vivas = this.livePaintSplats(shot.splat.userId, now)
      this.paintSplats.set(
        shot.splat.userId,
        [...vivas, { ...shot.splat, expiresAt: now + shot.splat.ttlMs }].slice(-PAINTBALL_MAX_SPLATS),
      )
    }
    this.broadcast({ type: 'shot', shot })

    if (shot.splat && recusa === null) {
      const alvo = this.entries.get(shot.splat.userId)
      if (alvo) {
        const resultado = applyArenaHit(
          {
            userId: alvo.player.userId,
            team: alvo.player.team,
            downedUntil: alvo.downedUntil,
            protectedUntil: alvo.protectedUntil,
            hits: alvo.hits,
            lastHitAt: alvo.lastHitAt,
          },
          now,
        )
        alvo.hits = resultado.hits
        alvo.lastHitAt = now

        if (!resultado.downed) {
          // Levou e continuou de pé: nem abate, nem ponto. O ponto é de quem
          // dá o tiro que derruba — dividir por dano faria caçar quem já está
          // machucado valer mais que o duelo.
          this.broadcast({ type: 'hit', userId: alvo.player.userId, byUserId: userId, hits: resultado.hits })
          return
        }

        alvo.hits = 0
        alvo.lastHitAt = 0
        alvo.downedUntil = now + ARENA_RESPAWN_MS
        // Quem levava a bandeira a derruba onde caiu — é o que dá sentido a
        // atirar em quem está fugindo com ela.
        this.dropCarriedFlag(alvo.player.userId, alvo.player.x, alvo.player.y)
        // A fila de input do abatido morre junto: sem isso ele continuaria
        // "andando" com o que já tinha mandado enquanto está fora.
        alvo.pending = []
        this.scores[entry.player.team] += 1
        this.broadcast({
          type: 'downed',
          userId: alvo.player.userId,
          byUserId: userId,
          team: entry.player.team,
        })
        if (matchIsOver({ mode: this.mode, scores: this.scores, remainingMs: this.phaseEndsAt - now })) this.endMatch()
      }
    }
  }

  /**
   * Chuta a bola. Como no tiro, só o ÂNGULO vem do cliente — a mira é o mouse
   * dele. A FORÇA sai do `sprint` do último input que o servidor já processou:
   * aceitar potência do fio seria aceitar chute de qualquer tamanho.
   */
  kick(socket: ArenaSocket, userId: string, angle: number, power: BodyKickPower = 'chute'): void {
    if (this.socketOwner.get(socket) !== userId) return
    if (this.mode !== 'futebol' || !this.ball) return
    const entry = this.entries.get(userId)
    if (!entry || !Number.isFinite(angle)) return

    const now = Date.now()
    if (this.phase !== 'jogando' || now < this.ballLockedUntil) return
    // Cadência no pé: cada chute aceito vira broadcast para a arena inteira.
    if (now - (this.lastKickAt.get(userId) ?? 0) < BODY_BALL_KICK_COOLDOWN_MS) return

    const sprint = this.moveOf(entry, now).sprint
    const chutada = kickBodyBall({
      ball: this.ball,
      kicker: { x: entry.player.x, y: entry.player.y },
      angle,
      sprint,
      power,
    })
    // `null` = a bola estava fora do alcance. Não é erro: quem mede distância
    // é a função, para o chamador não precisar medir antes.
    if (!chutada) return
    this.lastKickAt.set(userId, now)
    this.ball = chutada
    this.lastTouchedBy = userId
    this.broadcast({
      type: 'kick',
      userId,
      ball: { ...chutada },
      power,
      strong: power === 'chute' && sprint,
    })
  }

  /**
   * A intenção de passo que vale AGORA.
   *
   * Zera quando o último input envelheceu: sem isso, quem some (aba em segundo
   * plano, rede caída) continuaria conduzindo a bola com o último passo que
   * mandou, para sempre.
   */
  private moveOf(entry: Entry, now: number): { dx: number; dy: number; sprint: boolean } {
    if (now - entry.lastMoveAt > MOVE_INTENT_TTL_MS) return { dx: 0, dy: 0, sprint: false }
    return entry.lastMove
  }

  /** A bola como o cliente a recebe — com tempo RESTANTE de trava, nunca instante. */
  private ballSnapshot(): ArenaBallSnapshot {
    const ball = this.ball ?? restingBall(soccerKickoffSpot())
    const restante = Math.max(0, this.ballLockedUntil - Date.now())
    return { ...ball, ...(restante > 0 ? { lockedMs: restante } : {}) }
  }

  /**
   * Roda a bola do futebol: integra, resolve quem a encosta e vê se foi gol.
   *
   * No tick, e depois do movimento, pelo mesmo motivo das bandeiras: encostar
   * é consequência de onde a pessoa ESTÁ, e resolver isso no input deixaria o
   * resultado depender do ritmo dos pacotes.
   */
  private updateBall(now: number, elapsed: number): void {
    const grid = this.grid
    if (this.mode !== 'futebol' || !this.ball || !grid) return
    // Intervalo e saída de bola: a bola fica parada onde está.
    if (this.phase !== 'jogando' || now < this.ballLockedUntil) return

    this.ball = stepBodyBall(this.ball, elapsed, grid)

    for (const entry of this.entries.values()) {
      const toque = touchBodyBall(this.ball, {
        x: entry.player.x,
        y: entry.player.y,
        ...this.moveOf(entry, now),
      })
      if (!toque) continue
      this.ball = toque
      this.lastTouchedBy = entry.player.userId
    }

    const marcou = soccerGoalScored(this.ball)
    if (marcou) this.scoreGoal(marcou, now)
  }

  /**
   * Gol: ponto, todo mundo de volta ao próprio campo e a bola travada no meio.
   *
   * O autor é quem tocou por último, seja de que time for — gol contra é gol, e
   * quem monta o aviso é que compara o time dele com o que pontuou.
   */
  private scoreGoal(team: ArenaTeam, now: number): void {
    this.scores[team] += 1
    this.broadcast({
      type: 'goal',
      team,
      userId: this.lastTouchedBy,
      scores: { ...this.scores },
    })
    this.ball = restingBall(soccerKickoffSpot())
    this.ballLockedUntil = now + ARENA_SOCCER_KICKOFF_MS
    this.lastTouchedBy = null
    for (const entry of this.entries.values()) this.respawn(entry)
    if (matchIsOver({ mode: this.mode, scores: this.scores, remainingMs: this.phaseEndsAt - now })) {
      this.endMatch()
    }
  }

  /** Onde fica a base de cada time, em pixels. */
  private bases(): Record<ArenaTeam, { x: number; y: number }> {
    const document = this.document
    const tiles = document ? mapSpawnTiles(document) : []
    const centro = (indice: number) => {
      const tile = tiles[indice] ?? tiles[0] ?? { x: 1, y: 1 }
      const t = document?.map.tileWidth ?? 32
      return { x: tile.x * t + t / 2, y: tile.y * t + t / 2 }
    }
    return { oeste: centro(0), leste: centro(1) }
  }

  /** As bandeiras como o cliente vê — com tempo RESTANTE, nunca instante. */
  private flagsSnapshot(): ArenaFlags {
    const now = Date.now()
    const saida = initialFlags()
    for (const team of ARENA_TEAMS) {
      const flag = this.flags[team]
      saida[team] =
        flag.at === 'caida'
          ? { at: 'caida', x: flag.x, y: flag.y, returnsInMs: Math.max(0, this.flagReturnAt[team] - now) }
          : flag
    }
    return saida
  }

  private returnFlag(team: ArenaTeam, motivo: 'devolveu' | 'voltou', userId?: string): void {
    this.flags[team] = { at: 'base' }
    this.flagReturnAt[team] = 0
    this.broadcast({ type: 'flag', kind: motivo, team, ...(userId ? { userId } : {}) })
  }

  /** Derruba a bandeira que alguém carregava, onde ele caiu. */
  private dropCarriedFlag(userId: string, x: number, y: number): void {
    for (const team of ARENA_TEAMS) {
      const flag = this.flags[team]
      if (flag.at !== 'carregada' || flag.byUserId !== userId) continue
      this.flags[team] = { at: 'caida', x, y, returnsInMs: ARENA_FLAG_RETURN_MS }
      this.flagReturnAt[team] = Date.now() + ARENA_FLAG_RETURN_MS
      this.broadcast({ type: 'flag', kind: 'caiu', team, userId })
    }
  }

  /**
   * Aplica o que cada jogador provoca nas bandeiras. Roda no tick, depois do
   * movimento: encostar é consequência de onde a pessoa ESTÁ, e resolver isso
   * no input deixaria o resultado depender do ritmo dos pacotes.
   */
  private updateFlags(now: number): void {
    if (this.mode !== 'bandeira' || this.phase !== 'jogando') return

    // Bandeira caída volta sozinha. Sem isso, uma bandeira largada num canto
    // trava a partida: o dono não pontua e o adversário não precisa buscar.
    for (const team of ARENA_TEAMS) {
      if (this.flags[team].at === 'caida' && now >= this.flagReturnAt[team]) {
        this.returnFlag(team, 'voltou')
      }
    }

    const bases = this.bases()
    for (const entry of this.entries.values()) {
      const evento = flagInteraction({
        flags: this.flags,
        actor: {
          userId: entry.player.userId,
          team: entry.player.team,
          x: entry.player.x,
          y: entry.player.y,
          downed: entry.downedUntil > now,
        },
        bases,
      })
      if (!evento) continue

      if (evento.kind === 'pegou') {
        this.flags[evento.team] = { at: 'carregada', byUserId: evento.userId }
        this.flagReturnAt[evento.team] = 0
        this.broadcast({ type: 'flag', kind: 'pegou', team: evento.team, userId: evento.userId })
      } else if (evento.kind === 'devolveu') {
        this.returnFlag(evento.team, 'devolveu', evento.userId)
      } else {
        // Capturou: a bandeira adversária volta para a casa dela e o time
        // pontua.
        const adversario = rivalTeam(evento.team)
        this.flags[adversario] = { at: 'base' }
        this.flagReturnAt[adversario] = 0
        this.scores[evento.team] += 1
        this.broadcast({ type: 'flag', kind: 'capturou', team: adversario, userId: evento.userId })
        if (matchIsOver({ mode: this.mode, scores: this.scores, remainingMs: this.phaseEndsAt - now })) {
          this.endMatch()
        }
      }
    }
  }

  /**
   * Roda a corrida: progresso, volta e bandeirada.
   *
   * No tick e DEPOIS do movimento, pelo mesmo motivo das bandeiras e da bola:
   * onde a pessoa está na pista é consequência de onde ela está, e resolver isso
   * na chegada do input deixaria a volta depender do ritmo dos pacotes.
   */
  private updateRace(now: number): void {
    if (!modeIsRace(this.mode) || this.phase !== 'jogando') return

    // O semáforo abriu: evento à parte porque é o que dispara o som e o "VAI!"
    // na tela. O snapshot sozinho só diria que `countdownMs` sumiu.
    if (this.raceCountdownUntil > 0 && now >= this.raceCountdownUntil) {
      this.raceCountdownUntil = 0
      this.broadcast({ type: 'race-started' })
    }
    if (this.raceCountdownUntil > 0) return

    for (const entry of this.entries.values()) {
      const userId = entry.player.userId
      const anterior = this.raceRunners.get(userId)
      if (!anterior) continue
      const progresso = raceProgressAt(RACE_TRACK, entry.player.x, entry.player.y, anterior.index)
      const avanco = advanceRaceRunner(anterior, progresso, RACE_TRACK, now, ARENA_RACE_LAPS)
      this.raceRunners.set(userId, avanco.runner)

      if (avanco.lapped) {
        this.broadcast({
          type: 'lap',
          userId,
          lap: avanco.runner.lap,
          lapMs: now - anterior.lastLapAt,
        })
      }
      if (avanco.finished) {
        this.racePodium.push(userId)
        this.broadcast({ type: 'race-finished', userId, position: this.racePodium.length })
        // O primeiro a terminar abre a contagem da bandeirada. Encerrar nele
        // apagaria a disputa pelo 3º lugar, que numa corrida de oito é a maior
        // parte do jogo.
        if (this.raceFinishUntil === 0) this.raceFinishUntil = now + ARENA_RACE_FINISH_GRACE_MS
      }
    }

    if (this.raceFinishUntil === 0) return
    // Acabou quando o prazo venceu ou quando não sobrou ninguém na pista —
    // esperar o relógio com a pista vazia seria vinte segundos de tela parada.
    const naPista = [...this.entries.keys()].some(
      (userId) => (this.raceRunners.get(userId)?.finishedAt ?? 0) === 0,
    )
    if (!naPista || now >= this.raceFinishUntil) this.endMatch()
  }

  /** A corrida como o cliente a recebe — sempre com tempo RESTANTE. */
  private raceSnapshot(now: number): ArenaRaceSnapshot {
    const countdown = Math.max(0, this.raceCountdownUntil - now)
    const grace = Math.max(0, this.raceFinishUntil - now)
    return {
      standings: raceStandings(this.raceRunners, RACE_TRACK),
      laps: ARENA_RACE_LAPS,
      ...(countdown > 0 ? { countdownMs: countdown } : {}),
      ...(this.raceFinishUntil > 0 ? { finishGraceMs: grace } : {}),
    }
  }

  /**
   * Devolve o kart à linha de centro, parado e apontado para a frente.
   *
   * Existe porque na corrida não há abate, logo não há renascimento: um kart de
   * nariz na barreira sem espaço para manobrar ficaria preso pelos cinco minutos
   * inteiros. E não dá vantagem — o `s` não muda, a velocidade zera, e a linha de
   * centro parado é o pior lugar da pista para se estar.
   */
  unstuck(socket: ArenaSocket, userId: string): void {
    if (this.socketOwner.get(socket) !== userId) return
    if (!modeIsRace(this.mode)) return
    const entry = this.entries.get(userId)
    const runner = this.raceRunners.get(userId)
    if (!entry || !runner) return

    const { point, heading } = pointAt(RACE_TRACK, runner.s)
    entry.player = { ...entry.player, x: point.x, y: point.y, heading }
    entry.speed = 0
    // A fila de input morre junto: sem isso o que ele já tinha mandado
    // continuaria empurrando o kart de volta para a barreira.
    entry.pending = []
  }

  private combatant(userId: string) {
    const entry = this.entries.get(userId)
    if (!entry) return undefined
    return {
      userId,
      team: entry.player.team,
      downedUntil: entry.downedUntil,
      protectedUntil: entry.protectedUntil,
      hits: entry.hits,
      lastHitAt: entry.lastHitAt,
    }
  }

  /** Encerra a partida e abre o intervalo. */
  private endMatch(): void {
    this.phase = 'intervalo'
    this.lastWinner = matchWinner(this.scores)
    this.phaseEndsAt = Date.now() + ARENA_INTERMISSION_MS
    if (modeIsRace(this.mode)) {
      // Quem não cruzou entra no fim do pódio pela classificação da pista: numa
      // corrida encerrada no tempo, ficar de fora do resultado por não ter
      // terminado apagaria a prova inteira de quase todo mundo.
      const ordem = raceStandings(this.raceRunners, RACE_TRACK).map((linha) => linha.userId)
      this.racePodium = [...this.racePodium, ...ordem.filter((id) => !this.racePodium.includes(id))]
      this.raceCountdownUntil = 0
      this.raceFinishUntil = 0
    }
    this.broadcast({
      type: 'match-ended',
      winner: this.lastWinner,
      scores: { ...this.scores },
      ...(modeIsRace(this.mode) ? { podium: [...this.racePodium] } : {}),
    })
  }

  /** Começa uma partida nova: placar zerado e todo mundo de volta à base. */
  private startMatch(): void {
    this.phase = 'jogando'
    this.scores = emptyScores()
    this.flags = initialFlags()
    this.flagReturnAt = { oeste: 0, leste: 0 }
    if (modeIsRace(this.mode)) {
      const now = Date.now()
      this.raceCountdownUntil = now + ARENA_RACE_COUNTDOWN_MS
      this.raceFinishUntil = 0
      this.racePodium = []
      this.raceRunners.clear()
    }
    if (this.mode === 'futebol') {
      this.ball = restingBall(soccerKickoffSpot())
      this.ballLockedUntil = Date.now() + ARENA_SOCCER_KICKOFF_MS
      this.lastTouchedBy = null
    }
    this.phaseEndsAt = Date.now() + ARENA_MATCH_MS
    for (const entry of this.entries.values()) this.respawn(entry)
    this.broadcast({ type: 'match-started' })
  }

  private respawn(entry: Entry): void {
    // Na corrida não há abate, então isto só roda na largada — e largar é voltar
    // para a própria vaga do grid, parado e apontado para a pista.
    if (modeIsRace(this.mode)) {
      const vaga = this.gridPlace(entry.gridSlot)
      entry.player = { ...entry.player, x: vaga.x, y: vaga.y, heading: vaga.heading }
      entry.speed = 0
      entry.pending = []
      const progresso = raceProgressAt(RACE_TRACK, vaga.x, vaga.y)
      this.raceRunners.set(entry.player.userId, newRaceRunner(progresso.s, progresso.index, Date.now()))
      return
    }
    const spawn = this.spawnPoint(entry.player.team)
    entry.player = { ...entry.player, x: spawn.x, y: spawn.y }
    entry.downedUntil = 0
    entry.protectedUntil = Date.now() + ARENA_SPAWN_PROTECTION_MS
    entry.hits = 0
    entry.lastHitAt = 0
    entry.pending = []
  }

  /** Marcas de alguém que ainda não venceram, já podadas (ver escritório). */
  private livePaintSplats(userId: string, now: number): Array<PaintSplat & { expiresAt: number }> {
    const vivas = (this.paintSplats.get(userId) ?? []).filter((splat) => splat.expiresAt > now)
    if (vivas.length === 0) this.paintSplats.delete(userId)
    else this.paintSplats.set(userId, vivas)
    return vivas
  }

  /** Todas as marcas vivas, com o `ttlMs` restante — nunca instante absoluto. */
  paintSplatsSnapshot(): PaintSplat[] {
    const now = Date.now()
    return [...this.paintSplats.keys()].flatMap((userId) =>
      this.livePaintSplats(userId, now).map(({ expiresAt, ...splat }) => ({
        ...splat,
        ttlMs: expiresAt - now,
      })),
    )
  }

  players(): ArenaOccupant[] {
    return [...this.entries.values()].map((entry) => ({ ...entry.player }))
  }

  /**
   * Nome de quem está nesta arena agora, ou `null` se não está.
   *
   * É por aqui que o token do LiveKit é autorizado — mesma regra do
   * escritório: a presença no hub é a credencial, não o pedido do cliente. O
   * NOME vem junto porque o access token não carrega nome, e é ele que vira a
   * identidade do participante no LiveKit.
   */
  nameOf(userId: string): string | null {
    return this.entries.get(userId)?.player.name ?? null
  }

  /** Quantos estão na arena — usado pelo registry para descartar a instância. */
  size(): number {
    return this.entries.size
  }

  /**
   * Só para teste: põe alguém numa posição. O caminho normal é o input do
   * cliente, que precisaria de dezenas de ticks para atravessar o campo — e o
   * que os testes de REGRA querem exercitar é o duelo, não a caminhada.
   */
  __moveForTest(userId: string, x: number, y: number): void {
    const entry = this.entries.get(userId)
    if (entry) entry.player = { ...entry.player, x, y }
  }

  /**
   * Só para teste: põe a bola onde se quer, com a velocidade que se quer. O
   * caminho normal é chutá-la, e atravessar meio campo assim levaria dezenas
   * de ticks — o que os testes de REGRA querem exercitar é o gol, não o passe.
   */
  __ballForTest(ball: Partial<BodyBallState>): void {
    if (!this.ball) return
    this.ball = { ...this.ball, ...ball }
    this.ballLockedUntil = 0
  }

  /**
   * Só para teste: põe o kart na linha de centro, na distância `s` da volta.
   *
   * Move a POSIÇÃO e a dica de busca; NÃO mexe em volta nem em setor — quem
   * decide isso continua sendo `advanceRaceRunner`, no tick. É o que mantém o
   * teste exercitando a regra em vez de encenar o resultado dela.
   *
   * O caminho normal é dirigir, e atravessar 8.300px de pista assim levaria
   * centenas de ticks — o que os testes de REGRA querem exercitar é a volta, não
   * a pilotagem.
   */
  __raceSeekForTest(userId: string, s: number): void {
    const entry = this.entries.get(userId)
    const runner = this.raceRunners.get(userId)
    if (!entry || !runner) return
    const { point, heading } = pointAt(RACE_TRACK, s)
    entry.player = { ...entry.player, x: point.x, y: point.y, heading }
    // Varredura completa (sem `hint`): depois de um salto, a janela em volta da
    // amostra antiga responderia errado — e é justamente o teleporte que a
    // janela pressupõe que não acontece.
    this.raceRunners.set(userId, { ...runner, index: raceProgressAt(RACE_TRACK, point.x, point.y).index })
  }

  /** Só para teste: a volta e a posição de alguém na corrida. */
  __raceRunnerForTest(userId: string): ArenaRaceRunner | undefined {
    return this.raceRunners.get(userId)
  }

  /** Só para teste: o loop está vivo? */
  isRunning(): boolean {
    return this.timer !== null
  }

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

  private tick(): void {
    const grid = this.grid
    if (!grid) return
    const now = Date.now()
    const elapsed = Math.max(0, now - this.lastTickAt)
    this.lastTickAt = now

    // Fases da partida antes do movimento: quem acabou de renascer já deve
    // poder andar neste mesmo tick.
    if (this.entries.size > 0) {
      if (this.phase === 'jogando' && matchIsOver({ mode: this.mode, scores: this.scores, remainingMs: this.phaseEndsAt - now })) {
        this.endMatch()
      } else if (this.phase === 'intervalo' && now >= this.phaseEndsAt) {
        this.startMatch()
      }
    }

    for (const entry of this.entries.values()) {
      // Volta ao jogo, na base do próprio time.
      if (entry.downedUntil > 0 && now >= entry.downedUntil) this.respawn(entry)

      // Abatido não anda: descartar os inputs dele aqui (em vez de recusá-los
      // na chegada) mantém a regra num lugar só, e o `seq` segue avançando —
      // senão a predição do cliente ficaria presa esperando confirmação.
      if (entry.downedUntil > now) {
        entry.lastSeq = entry.pending.at(-1)?.seq ?? entry.lastSeq
        entry.pending = []
        continue
      }

      // Credita pelo relógio DO SERVIDOR e debita por input aplicado: o `dtMs`
      // vem do cliente, e sem isso quem inflasse o próprio `dt` compraria
      // velocidade. O banco (com teto) é o que ainda assim tolera jitter.
      entry.budgetMs = Math.min(entry.budgetMs + elapsed, BODY_TIME_BUDGET_CAP_MS)

      // Na largada o kart não anda, mas os inputs continuam sendo CONSUMIDOS:
      // `stepBodyKart` com `frozen` devolve velocidade zero e o `seq` avança.
      // Segurar a fila em vez disso deixaria a predição do cliente esperando uma
      // confirmação que só viria quando o semáforo abrisse — e aí ela viria toda
      // de uma vez.
      const corrida = modeIsRace(this.mode)
      const frozen = corrida && (this.phase !== 'jogando' || this.raceCountdownUntil > now)

      while (entry.pending.length > 0 && entry.budgetMs > 0) {
        const input = entry.pending[0]
        const dtMs = Math.min(Math.max(input.dtMs, 0), BODY_MAX_STEP_MS, entry.budgetMs)
        if (corrida) {
          // O MESMO `stepBodyKart` que a predição do cliente roda — é o que
          // impede autoridade e predição de divergirem por construção.
          const kart: BodyKartState = {
            x: entry.player.x,
            y: entry.player.y,
            dir: entry.player.dir,
            heading: entry.player.heading ?? 0,
            speed: entry.speed,
          }
          const proximo = stepBodyKart(kart, { ...input, dtMs }, grid, { frozen })
          entry.player = {
            ...entry.player,
            x: proximo.x,
            y: proximo.y,
            dir: proximo.dir,
            heading: proximo.heading,
          }
          entry.speed = proximo.speed
        } else {
          entry.player = { ...entry.player, ...stepBody(entry.player, { ...input, dtMs }, grid) }
        }
        entry.budgetMs -= dtMs
        entry.lastSeq = input.seq
        entry.lastMove = { dx: input.dx, dy: input.dy, sprint: input.sprint === true }
        entry.lastMoveAt = now
        entry.pending.shift()
      }
    }

    this.updateFlags(now)
    this.updateBall(now, elapsed)
    this.updateRace(now)

    this.tickCount += 1
    if (this.tickCount % TICKS_PER_SNAPSHOT === 0) this.broadcastSnapshot()
  }

  private broadcastSnapshot(): void {
    if (this.entries.size === 0) return
    const now = Date.now()
    this.broadcast({
      type: 'snapshot',
      players: [...this.entries.values()].map((entry) => ({
        userId: entry.player.userId,
        x: entry.player.x,
        y: entry.player.y,
        dir: entry.player.dir,
        seq: entry.lastSeq,
        // Rumo e velocidade só na corrida: nos outros modos são bytes por
        // jogador, vinte vezes por segundo, que ninguém leria.
        ...(modeIsRace(this.mode) ? { h: entry.player.heading ?? 0, v: entry.speed } : {}),
        ...(hitsAfterRecovery(entry.hits, entry.lastHitAt, now) > 0
          ? { hits: hitsAfterRecovery(entry.hits, entry.lastHitAt, now) }
          : {}),
        ...(entry.downedUntil > now ? { downMs: entry.downedUntil - now } : {}),
      })),
      match: this.matchState(),
      ...(this.mode === 'bandeira' ? { flags: this.flagsSnapshot() } : {}),
      ...(this.ball ? { ball: this.ballSnapshot() } : {}),
      ...(modeIsRace(this.mode) ? { race: this.raceSnapshot(now) } : {}),
    })
  }

  private sendTo(socket: ArenaSocket, message: ArenaServerMessage): void {
    socket.send(JSON.stringify(message))
  }

  private broadcast(message: ArenaServerMessage, exceptUserId?: string): void {
    const payload = JSON.stringify(message)
    for (const [userId, entry] of this.entries) {
      if (userId === exceptUserId) continue
      for (const socket of entry.sockets) socket.send(payload)
    }
  }
}

const arenaHubs = new Map<string, ArenaHub>()

/** Uma instância por empresa e arena, no molde de `getOfficeHub`. */
export function getArenaHub(companyId: string, arenaId: string): ArenaHub {
  const key = `${companyId}:${arenaId}`
  let hub = arenaHubs.get(key)
  if (!hub) {
    hub = new ArenaHub()
    arenaHubs.set(key, hub)
  }
  return hub
}

/** Só para teste: zera o registry entre casos. */
export function __resetArenaHubs(): void {
  arenaHubs.clear()
}

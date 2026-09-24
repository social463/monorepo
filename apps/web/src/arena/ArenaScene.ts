import Phaser from 'phaser'
import {
  BODY_BALL_KICK_COOLDOWN_MS,
  BODY_BALL_RADIUS,
  BODY_HALF_HEIGHT,
  BODY_HALF_WIDTH,
  BODY_INPUT_HZ,
  BODY_SPEED,
  bodyCollisionGrid,
  characterIdleFrame,
  characterWalkFrames,
  CHARACTER_FRAME_SIZE,
  stepBody,
  type BodyCollisionGrid,
  type ArenaOccupant,
  type BodyState,
  type ArenaServerMessage,
  type ArenaClientMessage,
  type MapDocumentV1,
  type OfficeMapAssetDTO,
  type BodyShot,
  type PaintSplat,
  ARENA_MAX_HITS,
  BODY_SHOT_COOLDOWN_MS,
  ARENA_TEAMS,
  ARENA_TEAM_COLORS,
  isBallKickable,
  kickBodyBall,
  type BodyKickPower,
  mapSpawnTiles,
  modeHasShooting,
  PAINT_SPLAT_TTL_MS,
  paintSplatPlacement,
  SOCCER_FIELD,
  stepBodyBall,
  touchBodyBall,
  type ArenaBallSnapshot,
  type BodyBallState,
  type ArenaFlags,
  modeIsRace,
  stepBodyKart,
  kartFacing,
  BODY_KART_MAX_SPEED,
  type BodyInput,
  type BodyKartState,
  type ArenaRaceSnapshot,
  type ArenaMode,
  type Direction,
  type ArenaMatchState,
  type ArenaTeam,
} from '@legends/shared'
import { composeCharacterSheet } from '../lib/character'
import { computeScreenPosition, type ScreenPosition } from '../lib/screenPosition'
import { occupantCharacterOptions, occupantExtraLayers } from '../office/officeAvatar'
import { ensureMapAssets, renderMapScenery } from '../office/scenes/mapScenery'
import {
  createKartSmokeTexture,
  kartSmoke,
  puffKartSmoke,
  KART_SMOKE_INTERVAL_MS,
} from '../office/scenes/kartSmoke'
import {
  createPaintTextures,
  PAINT_PELLET_TEXTURE,
  PAINT_SPLAT_TEXTURE,
} from '../office/scenes/paintSprites'
import {
  CELEBRATION_DEPTH,
  CONFETTI_BURST_COUNT,
  CONFETTI_BURST_LIFESPAN,
  CONFETTI_TEXTURE,
  confettiBurstConfig,
  confettiLaunchConfig,
  createConfettiTexture,
} from '../office/scenes/confettiSprites'
import { playPaintballSound } from '../office/media/paintball-sound'
import { playKickSound } from '../office/media/kick-sound'
import { nearestArenaZoom, stepArenaZoom } from './arena-zoom'
import { walkAnimationAction } from './walkAnimation'
import { ArenaInterpolator } from './ArenaInterpolator'
import { ArenaPredictor } from './ArenaPredictor'

/**
 * Cena da arena em modo LOCAL — sem servidor, sem rede, sem predição.
 *
 * Existe para responder a única pergunta do marco 1 que nenhum teste responde:
 * *andar livre ficou gostoso?* Como `stepBody` é a mesma função que o servidor
 * vai rodar, o que se sente aqui é exatamente o que a arena em rede vai
 * entregar para o dono do personagem — a rede acrescenta reconciliação e
 * interpolação, que mudam como se vê os OUTROS, não como se sente o próprio.
 *
 * Por isso ela vem antes do netcode: se o passo não agradar, ajusta-se a
 * constante aqui, de graça, em vez de descobrir depois de montar hub e socket.
 */
export interface ArenaDebugInfo {
  x: number
  y: number
  fps: number
  /** Inputs mandados e ainda não confirmados — a medida viva do atraso. */
  pending: number
  players: number
  /**
   * `rede` = o servidor é a autoridade e o passo é previsto/reconciliado;
   * `local` = ninguém conectou ainda e a cena está só rodando `stepBody`.
   * Distinguir os dois é o mínimo para saber o que se está testando — sem
   * isso, uma cena que nunca recebeu o `welcome` anda igualzinho e passa por
   * multiplayer.
   */
  mode: 'rede' | 'local'
  /** A fila de não confirmados estourou — o servidor parou de responder. */
  stalled: boolean
}

/** O que o HUD da partida precisa saber. */
export interface ArenaMatchInfo extends ArenaMatchState {
  /** De que time é você — para destacar o próprio lado no placar. */
  team: ArenaTeam | null
  /** Quanto falta para voltar ao jogo, em ms; `0` = está em campo. */
  /** Tiros que você ainda aguenta antes de cair. */
  vidas: number
  /**
   * O estado da corrida, só no modo corrida.
   *
   * Vem junto do `match` em vez de num listener próprio porque muda no MESMO
   * ritmo — a cada snapshot — e é lido pelo mesmo painel. Um segundo listener
   * seria um segundo `setState` por pacote, na mesma árvore.
   */
  race?: ArenaRaceSnapshot
  /** Sua posição na corrida (1 = líder); ausente fora dela. */
  suaPosicao?: number
  /** Sua volta atual, já contando a que está em curso (1..laps). */
  suaVolta?: number
}

/**
 * Um aviso passageiro da corrida: volta completada ou bandeirada.
 *
 * Como o `ArenaGoalInfo`, vai o `userId` e não o nome — a cena conhece o nome
 * dos OUTROS, mas não o próprio, e quem tem a lista inteira é o React.
 */
export interface ArenaRaceNoticeInfo {
  kind: 'volta' | 'chegada' | 'largada'
  userId: string | null
  /** Volta completada, em `kind: 'volta'`. */
  lap?: number
  /** Tempo da volta, em ms. */
  lapMs?: number
  /** Posição de chegada, em `kind: 'chegada'`. */
  position?: number
}

/**
 * O aviso de gol na tela.
 *
 * Vai o `userId`, não o nome: a cena conhece o nome dos OUTROS (veio no
 * `joined`), mas não o próprio — e o gol que mais importa mostrar é o seu.
 * Quem tem a lista inteira, com você dentro, é o React.
 */
export interface ArenaGoalInfo {
  /** Time que pontuou. */
  team: ArenaTeam
  /** Quem tocou por último, ou `null` se o servidor não soube dizer. */
  userId: string | null
  /** Gol contra: quem tocou por último defendia o gol que levou. */
  contra: boolean
}

export interface ArenaMinimapFlag {
  team: ArenaTeam
  x: number
  y: number
  /** Fora da base — carregada ou caída. */
  roubada: boolean
}

/**
 * Onde cada um está AGORA, em tiles — a unidade que o grafo de áudio espacial
 * fala (`computeGain`/`computePan`), a mesma do escritório.
 *
 * Consultada por `ArenaScene.presence()` — a voz a lê a ~10Hz, direto do
 * quadro, sem passar por estado React: ganho e pan não precisam de 60 amostras
 * por segundo, e um `setState` por quadro re-renderizaria a árvore inteira 60
 * vezes por segundo (foi para não fazer isso que o estado do jogo ficou fora
 * do React — ver `useArenaSocket`).
 */
export interface ArenaPresenceInfo {
  youId: string | null
  you: { x: number; y: number } | null
  /** Todos MENOS você, em tiles. */
  outros: Array<{ userId: string; x: number; y: number }>
}

/** O que o mapa de aproximação precisa desenhar, em coordenadas de MUNDO. */
export interface ArenaMinimapInfo {
  width: number
  height: number
  you: { x: number; y: number } | null
  team: ArenaTeam | null
  aliados: Array<{ x: number; y: number }>
  /** Só os revelados por terem atirado. */
  inimigos: Array<{ x: number; y: number; restanteMs: number }>
  bandeiras: ArenaMinimapFlag[]
  /** Só no futebol: onde está a bola. */
  bola?: { x: number; y: number }
}

/**
 * O sprite é desenhado no tamanho NATIVO do frame LPC (64px), sem redimensionar.
 *
 * O escritório encolhe para 48, e ali isso não incomoda porque a câmera fica
 * afastada e tudo encolhe junto. Aqui a câmera está em zoom 2, e 48/64 × 2 dá
 * escala efetiva de **1,5×**: cada segundo pixel da arte vira dois pixels de
 * tela e o resto vira um. Parado já fica irregular; andando, quais pixels
 * dobram muda a cada quadro — que é exatamente o "borrado" ao se mover.
 *
 * Com escala 1 e zoom inteiro, um pixel da arte é sempre o mesmo número de
 * pixels de tela.
 */
const CHARACTER_FRAME_DISPLAY = CHARACTER_FRAME_SIZE
/**
 * Origem vertical do sprite: ancorado nos PÉS, mas o corpo de colisão é o
 * tronco — a origem fica um pouco abaixo do centro da caixa, senão o personagem
 * parece flutuar acima da parede que ele está tocando.
 *
 * Virou constante quando o kart passou a depender dela: é a partir desta linha
 * que se calcula o quanto afundar o piloto para ele sentar no cockpit
 * (`ARENA_KART_RIDER_SINK`). Cravada em dois lugares, ela sairia do lugar num e
 * não no outro.
 */
const CHARACTER_ORIGIN_Y = 0.8
/** Zoom inicial. Os passos moram em `arena-zoom.ts` (sem Phaser junto). */
const CAMERA_ZOOM = 2
/** Acima de qualquer camada do documento, abaixo do overlay de depuração. */
const CHARACTER_DEPTH = 1_000
/** A tinta em voo passa por cima de tudo — pequena demais para sumir atrás de um monte. */
const PAINT_DEPTH = 9_500
/** Onde a mancha cai no personagem, em coordenadas locais do sprite. */
const SPLAT_BOX = { x: 7, top: -14, bottom: -2 }
/**
 * Quanto tempo a posição de um adversário fica marcada no mapa depois de ele
 * atirar.
 *
 * A revelação nasce do EVENTO de tiro (`shot.from`), não da lista de posições
 * do snapshot: assim quem não atira não aparece, e a regra é a mesma para
 * todos. Vale registrar o limite honesto — as posições continuam trafegando no
 * snapshot para a interpolação funcionar, então isto é conveniência de
 * interface, não sigilo. Esconder de verdade exigiria o servidor recortar o
 * snapshot por visibilidade.
 */
const REVEAL_MS = 4_000
/** Com que frequência o mapa de aproximação é reenviado ao React. */
const MINIMAP_HZ = 6
/** Inclinação do mastro a tiracolo, em radianos. */
const FLAG_CARRY_TILT = 0.42
/** Respingos do impacto. */
const BURST_DROPS = 5
const BURST_MS = 220
const BURST_REACH = 10
/** A bola do escritório serve aqui: é o mesmo couro, só que em campo maior. */
const BALL_TEXTURE = 'arena-ball'
const BALL_ASSET_URL = '/office/ball.png'
/**
 * O couro dentro do arquivo, medido: `ball.png` tem 48×48, e a bola ocupa
 * 24×24 deles — a metade —, deslocada do centro do quadro.
 *
 * É por isso que a bola nasceu pequena DEMAIS e fora do lugar: `displaySize`
 * escala o QUADRO, então pedir 16px desenhava uma bola de 8, e o centro do
 * sprite não era o centro do couro — a bola parecia sempre um pouco adiante da
 * posição em que a física a colocava. Recortando um frame no conteúdo, o
 * tamanho pedido passa a ser o tamanho da bola, e o centro dela é o centro
 * dela.
 */
const BALL_FRAME = 'couro'
const BALL_ART = { x: 9, y: 15, width: 24, height: 24 }
/** Tamanho da BOLA na tela (não do quadro): pouco mais de meio tile. */
const BALL_DISPLAY_SIZE = 18
/** Giro por pixel percorrido — pista visual de que ela ROLA, não desliza. */
const BALL_SPIN_PER_PX = 0.035
/** A bola passa por cima do gramado e das linhas, e por baixo de quem joga. */
const BALL_DEPTH = 900
/** Marcação do campo: acima do piso (zIndex 0), abaixo das paredes (10). */
const PITCH_DEPTH = 5
/** Largura da linha de campo, em px. */
const PITCH_LINE = 3
/** Largura de cada faixa de corte do gramado, em tiles. */
const MOW_TILES = 6

/**
 * Quanto o cliente puxa a bola em direção à posição do servidor a cada
 * snapshot, e a partir de que erro ele desiste de corrigir e aceita de vez.
 *
 * O cliente roda a MESMA física do servidor (`stepBodyBall`), então os dois
 * só divergem pelo atraso da rede e por chute recusado. Puxar um terço por
 * pacote conserta isso em ~150ms sem que ninguém veja a bola saltar; o salto
 * fica para quando o erro é grande demais para esconder — aí esconder seria
 * mentir por mais tempo ainda.
 */
const BALL_CORRECTION = 0.34
const BALL_SNAP_PX = 48

/** Para onde cada pose olha, em radianos — o chute de teclado parado. */
const FACING_ANGLE: Record<Direction, number> = {
  right: 0,
  down: Math.PI / 2,
  left: Math.PI,
  up: -Math.PI / 2,
}

/** Quanto tempo o canhão de confete de quem marcou fica jorrando. */
const GOAL_CANNON_MS = 1_400
/** Folga para as últimas partículas caírem antes de destruir o emissor. */
const CONFETTI_LAUNCH_TAIL_MS = 1_000

const WALK_FRAME_RATE = 10
/** Intervalo entre dois envios de input. */
const INPUT_INTERVAL_MS = 1000 / BODY_INPUT_HZ
/** Distância (px) abaixo da qual um remoto é considerado parado. */
const REMOTE_IDLE_EPSILON = 0.4

/**
 * O kart na arena reaproveita a TEXTURA do escritório e o enquadramento do
 * piloto, não o código: lá o veículo gira em passos de 90° sobre uma grade;
 * aqui ele tem rumo contínuo.
 */
const ARENA_KART_TEXTURE = 'arena-kart'
const ARENA_KART_ASSET_URL = '/office/kart.png'
/**
 * Sprite pixel-art quadrado: mantém o mesmo pivô ao girar.
 *
 * Perto do lado do frame do personagem (64), e não do corpo de colisão (20):
 * o veículo é DESENHO, e um kart menor que o piloto o faz parecer sentado em
 * cima de um carrinho de brinquedo.
 */
const ARENA_KART_DISPLAY = 58
/**
 * A textura nasce apontando para CIMA (o respingo amarelo é o nariz), e o rumo
 * mede a partir da direita — daí o quarto de volta de correção.
 */
const ARENA_KART_TEXTURE_OFFSET = Math.PI / 2
/**
 * Faixa do frame LPC (64×64) que sobra visível de quem pilota: só a cabeça.
 * Medida no sprite, como no escritório — visto de cima, quem dirige aparece
 * pelo vão do kart, não em pé atrás dele.
 */
const ARENA_KART_HEAD_TOP = 8
const ARENA_KART_HEAD_HEIGHT = 26
/**
 * Quanto o sprite do piloto DESCE para a faixa recortada cair no meio do kart.
 *
 * O recorte sozinho não senta ninguém: `setCrop` esconde o resto do frame, mas
 * não mexe no transform — e o sprite é ancorado nos PÉS (origem 0,8), então a
 * faixa da cabeça continua desenhada onde a cabeça estava, flutuando acima do
 * veículo.
 *
 * A conta é em linhas da TEXTURA (a escala é 1:1 aqui, `CHARACTER_FRAME_DISPLAY`
 * = `CHARACTER_FRAME_SIZE`): a origem cai na linha `0,8 × 64 = 51,2`, e o meio
 * da faixa está na linha `8 + 26/2 = 21`. A diferença é o quanto afundar.
 */
const ARENA_KART_RIDER_SINK =
  CHARACTER_ORIGIN_Y * CHARACTER_FRAME_SIZE - (ARENA_KART_HEAD_TOP + ARENA_KART_HEAD_HEIGHT / 2)
/**
 * O cockpit não fica no pivô do veículo: recuar a cabeça na direção da traseira
 * deixa o piloto sentado, em vez de apoiado no volante. Contínuo, e não uma
 * tabela por direção como no escritório, porque aqui o kart gira de verdade.
 */
const ARENA_KART_RIDER_BACKSET = 5
/** O piloto vai desenhado por cima do veículo. */
const ARENA_KART_DEPTH = 40
/**
 * Cores de kart. Não saem de `ARENA_TEAM_COLORS` de propósito: na corrida o time
 * é cosmético e a disputa é individual — dois karts da mesma cor brigando por
 * posição não diriam quem é quem.
 */
const KART_TINTS = [0xff5a4d, 0x4da3ff, 0xffd84d, 0x52fba2, 0xc06bff, 0xff8a3d, 0x39d9d0, 0xf06fae]

export class ArenaScene extends Phaser.Scene {
  private grid: BodyCollisionGrid
  private player: BodyKartState
  private sprite?: Phaser.GameObjects.Sprite
  private keys?: Record<'up' | 'down' | 'left' | 'right' | 'sprint', Phaser.Input.Keyboard.Key>
  /** Última intenção de passo — é ela que aponta o chute de teclado. */
  private intent = { dx: 0, dy: 0 }
  private lastTime = 0
  private speed = BODY_SPEED
  private showCollision = false
  private collisionLayer?: Phaser.GameObjects.Graphics
  private bodyBox?: Phaser.GameObjects.Graphics
  private onDebug?: (info: ArenaDebugInfo) => void

  // ── rede (ausente no modo local) ─────────────────────────────────────────
  private send?: (message: ArenaClientMessage) => void
  /** A cena está ligada a um servidor (ainda que desconectado no momento). */
  private networked = false
  private onReady?: () => void
  /**
   * Um preditor só, sempre em `BodyKartState`.
   *
   * O pedestre carrega `heading`/`speed` sem usar — dois números por quadro. A
   * alternativa seria um segundo preditor, e duas implementações de
   * reconciliação divergem sempre (é o mesmo argumento que fez `stepBody` ser
   * compartilhada entre cliente e servidor).
   */
  private predictor?: ArenaPredictor<BodyKartState>
  /** Karts desenhados sob cada piloto, por `userId`. Vazio fora da corrida. */
  private readonly karts = new Map<string, Phaser.GameObjects.Image>()
  /** Último rumo conhecido de cada kart remoto, em radianos (sem a correção da textura). */
  private readonly remoteHeading = new Map<string, number>()
  /** Quando cada roda soltou a última nuvem — a cadência é por RODA. */
  private readonly lastSmokeAt: number[] = [0, 0]
  /** Instante local em que o semáforo abre; `0` = já largou (ou não é corrida). */
  private raceCountdownUntil = 0
  private raceState?: ArenaRaceSnapshot
  private onRaceNotice?: (info: ArenaRaceNoticeInfo) => void
  private readonly interpolator = new ArenaInterpolator()
  private readonly remotes = new Map<string, Phaser.GameObjects.Sprite>()
  private readonly remoteMeta = new Map<string, ArenaOccupant>()
  private readonly remoteLast = new Map<string, { x: number; y: number }>()
  private readonly remoteFacing = new Map<string, Direction>()
  private youId: string | null = null
  private sinceInput = 0
  private lastAckSeq = 0
  private zoom: number = CAMERA_ZOOM
  private onZoom?: (zoom: number) => void
  /** Mira em radianos — do mouse; é ela que vai no disparo. */
  private aim = 0
  private lastShotAt = 0
  private readonly splats = new Map<string, Phaser.GameObjects.Image[]>()
  private readonly teams = new Map<string, ArenaTeam>()
  private readonly rings = new Map<string, Phaser.GameObjects.Ellipse>()
  /** Instante local em que cada abatido volta; `0` = em campo. */
  private readonly downUntil = new Map<string, number>()
  /** Tiros já levados por cada um, como veio no último snapshot. */
  private readonly hits = new Map<string, number>()
  private onMatch?: (info: ArenaMatchInfo) => void
  private onMinimap?: (info: ArenaMinimapInfo) => void
  private sinceMinimap = 0
  /**
   * Enquanto `false`, o teclado e o gatilho ficam mudos — é o que permite
   * digitar no chat sem sair andando e atirando. Não basta ignorar as teclas
   * aqui: o `addCapture(['W','A','S','D'])` do `create` chama `preventDefault`,
   * então sem soltar a captura as próprias letras não chegariam ao campo de
   * texto.
   */
  private inputEnabled = true
  /** Onde cada adversário foi visto atirando, e até quando isso vale. */
  private readonly revelados = new Map<string, { x: number; y: number; until: number }>()
  private lastMatch?: ArenaMatchState
  private flags?: ArenaFlags
  /**
   * A bola do futebol, simulada LOCALMENTE entre snapshots com a mesma função
   * do servidor. `undefined` nos modos de tiro.
   */
  private ballState?: BodyBallState
  private ballSprite?: Phaser.GameObjects.Image
  /** Até quando a bola fica parada na saída de bola (instante local). */
  private ballLockedUntil = 0
  private lastKickAt = 0
  private onGoal?: (info: ArenaGoalInfo) => void
  private readonly flagSprites = new Map<ArenaTeam, Phaser.GameObjects.Container>()
  private readonly baseMarks = new Map<ArenaTeam, Phaser.GameObjects.Ellipse>()
  /**
   * Mensagens que chegaram antes de o Phaser dar boot na cena. `this.add` e
   * `this.time` só existem depois do `create()`, e um `welcome` com gente
   * dentro tentaria criar sprite antes disso — o erro morreria dentro de um
   * `async` e a cena ficaria muda, parecendo apenas "sem multiplayer".
   */
  private inbox: ArenaServerMessage[] = []
  private booted = false

  constructor(
    private readonly document: MapDocumentV1,
    private readonly assets: readonly OfficeMapAssetDTO[],
    private readonly avatar: Parameters<typeof occupantCharacterOptions>[0],
    private readonly spawn: { x: number; y: number },
    /**
     * O modo entra pelo construtor, e não pelo `welcome`, porque o `create()`
     * precisa dele antes de existir servidor: é ele que decide se a cena
     * desenha um campo de futebol, se o personagem nasce armado e se o clique
     * atira ou chuta.
     */
    private readonly mode: ArenaMode = 'mata-mata',
  ) {
    super('arena')
    this.grid = bodyCollisionGrid(document)
    this.player = { x: spawn.x, y: spawn.y, dir: 'down', heading: 0, speed: 0 }
  }

  setSpeed(speed: number): void {
    this.speed = speed
  }

  /** Ajusta o zoom para o passo mais próximo do pedido. */
  setZoom(zoom: number): void {
    this.zoom = nearestArenaZoom(zoom)
    this.cameras?.main?.setZoom(this.zoom)
    this.onZoom?.(this.zoom)
  }

  /** Um passo para dentro (+1) ou para fora (−1). */
  stepZoom(direcao: 1 | -1): void {
    this.setZoom(stepArenaZoom(this.zoom, direcao))
  }

  setZoomListener(listener: (zoom: number) => void): void {
    this.onZoom = listener
    listener(this.zoom)
  }

  setShowCollision(show: boolean): void {
    this.showCollision = show
    this.collisionLayer?.setVisible(show)
    this.bodyBox?.setVisible(show)
  }

  setDebugListener(listener: (info: ArenaDebugInfo) => void): void {
    this.onDebug = listener
  }

  setMatchListener(listener: (info: ArenaMatchInfo) => void): void {
    this.onMatch = listener
  }

  setGoalListener(listener: (info: ArenaGoalInfo) => void): void {
    this.onGoal = listener
  }

  setMinimapListener(listener: (info: ArenaMinimapInfo) => void): void {
    this.onMinimap = listener
  }

  /**
   * Liga/desliga teclado e gatilho — chamado quando o chat ganha e perde o
   * foco. Ao desligar, as teclas são RESETADAS: sem isso, a tecla que estava
   * pressionada no momento do foco continuaria "em pé" e o personagem andaria
   * sozinho até ela ser solta dentro do canvas, o que nunca aconteceria.
   */
  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled
    const keyboard = this.input?.keyboard
    if (!keyboard) return
    keyboard.enabled = enabled
    if (enabled) keyboard.enableGlobalCapture()
    else {
      keyboard.disableGlobalCapture()
      keyboard.resetKeys()
    }
  }

  /**
   * Posição de tela de um personagem — âncora dos balões de webcam, que são
   * DOM por cima do canvas. Mesma conversão do escritório (`lib/screenPosition`).
   */
  getScreenPosition(userId: string): ScreenPosition | null {
    const alvo = userId === this.youId ? this.sprite : this.remotes.get(userId)
    if (!alvo) return null
    const cam = this.cameras?.main
    if (!cam) return null
    // `worldView`, não `scrollX/scrollY`: com a câmera limitada por bounds, é
    // ele que corresponde ao que está de fato na tela (ver o mesmo cuidado em
    // `OfficeScene.getScreenPosition`).
    return computeScreenPosition(
      alvo.x,
      alvo.y,
      { scrollX: cam.worldView.x, scrollY: cam.worldView.y, zoom: cam.zoom },
      { width: this.scale.width, height: this.scale.height },
    )
  }

  /**
   * Liga a cena à rede. Sem isto ela roda em modo LOCAL — que é como ela
   * nasceu, e continua sendo o banco de provas do passo: sem servidor, o que
   * se sente é `stepBody` puro.
   */
  setSender(send: (message: ArenaClientMessage) => void): void {
    this.send = send
    this.networked = true
  }

  setReadyListener(listener: () => void): void {
    this.onReady = listener
  }

  /**
   * Limpa tudo o que pertencia à sessão anterior. Trocar de modo é trocar de
   * ARENA: os outros jogadores, as marcas de tinta, as bandeiras e o placar
   * são de lá, e arrastá-los para cá deixaria fantasmas na tela.
   */
  resetForNewSession(): void {
    this.predictor = undefined
    this.youId = null
    this.sinceInput = 0
    this.lastAckSeq = 0
    this.lastMatch = undefined
    this.flags = undefined
    for (const sprite of this.remotes.values()) sprite.destroy()
    this.remotes.clear()
    this.remoteMeta.clear()
    this.remoteLast.clear()
    this.remoteFacing.clear()
    for (const ring of this.rings.values()) ring.destroy()
    this.rings.clear()
    for (const lista of this.splats.values()) for (const img of lista) img.destroy()
    this.splats.clear()
    this.teams.clear()
    this.downUntil.clear()
    this.hits.clear()
    this.revelados.clear()
    for (const kart of this.karts.values()) kart.destroy()
    this.karts.clear()
    this.remoteHeading.clear()
    this.raceState = undefined
    this.raceCountdownUntil = 0
    this.ballState = undefined
    this.ballLockedUntil = 0
    this.lastKickAt = 0
    this.inbox = []
  }

  /** Estado autoritativo vindo do servidor. */
  handleServerMessage(message: ArenaServerMessage): void {
    if (!this.booted) {
      this.inbox.push(message)
      return
    }
    this.applyServerMessage(message)
  }

  private applyServerMessage(message: ArenaServerMessage): void {
    switch (message.type) {
      case 'welcome': {
        this.youId = message.youId
        const you = message.players.find((player) => player.userId === message.youId)
        if (you) {
          // A posição de nascimento é do SERVIDOR: o spawn local era só o
          // palpite do modo offline.
          this.player = {
            x: you.x,
            y: you.y,
            dir: you.dir,
            heading: you.heading ?? 0,
            speed: 0,
          }
          this.predictor = new ArenaPredictor(this.player, this.grid, { speed: this.speed }, this.stepFn())
          this.sprite?.setPosition(you.x, you.y)
        }
        for (const player of message.players) {
          this.teams.set(player.userId, player.team)
          if (player.userId !== message.youId) void this.addRemote(player)
        }
        // Só agora há autoridade: posição, time e partida vieram. É o sinal de
        // que a tela pode sair do carregamento.
        this.onReady?.()
        this.lastMatch = message.match
        this.flags = message.flags
        if (message.ball) this.applyBallSnapshot(message.ball, true)
        if (message.race) this.applyRaceSnapshot(message.race)
        // Tinta ainda viva, com o prazo já descontado pelo servidor.
        for (const splat of message.paintSplats ?? []) this.applySplat(splat)
        break
      }
      case 'joined':
        this.teams.set(message.player.userId, message.player.team)
        void this.addRemote(message.player)
        break
      case 'left':
        this.remotes.get(message.userId)?.destroy()
        this.remotes.delete(message.userId)
        this.remoteMeta.delete(message.userId)
        this.remoteLast.delete(message.userId)
        this.karts.get(message.userId)?.destroy()
        this.karts.delete(message.userId)
        this.remoteHeading.delete(message.userId)
        this.interpolator.forget(message.userId)
        for (const image of this.splats.get(message.userId) ?? []) image.destroy()
        this.splats.delete(message.userId)
        this.remoteFacing.delete(message.userId)
        this.rings.get(message.userId)?.destroy()
        this.rings.delete(message.userId)
        this.teams.delete(message.userId)
        this.downUntil.delete(message.userId)
        this.hits.delete(message.userId)
        break
      case 'shot':
        this.playShot(message.shot)
        break
      case 'hit':
        // Levou e continuou de pé: a mancha de tinta já apareceu pelo `shot`;
        // aqui só se acerta a contagem, sem esperar o próximo snapshot.
        this.hits.set(message.userId, message.hits)
        break
      case 'downed':
        this.hits.set(message.userId, 0)
        this.downUntil.set(message.userId, this.time.now + 1)
        // O som do abate é o do impacto molhado, e só para quem está por perto
        // não é preciso: a arena é pequena e o abate é o evento do jogo.
        playPaintballSound({ hit: true })
        break
      case 'kick':
        // A velocidade autoritativa vale NA HORA: o evento existe justamente
        // para não esperar até 50ms pelo snapshot — meio metro de bola, no
        // chute forte. A posição continua sendo corrigida aos poucos.
        if (this.ballState) this.ballState = { ...this.ballState, vx: message.ball.vx, vy: message.ball.vy }
        else this.ballState = { ...message.ball }
        // Quem chutou já ouviu o próprio pé na predição local.
        // `grazed` no chute normal: o som do escritório usa isso para tirar
        // corpo da batida, que é o que separa um toque de um chutão.
        if (message.userId !== this.youId) playKickSound({ power: 'kick', grazed: !message.strong })
        break
      case 'goal': {
        const timeDoAutor = message.userId ? this.teams.get(message.userId) : undefined
        const contra = timeDoAutor !== undefined && timeDoAutor !== message.team
        this.onGoal?.({ team: message.team, userId: message.userId, contra })
        this.celebrateGoal(contra ? null : message.userId)
        break
      }
      case 'flag':
        // Captura merece marcação sonora; pegar e derrubar acontecem o tempo
        // todo e virariam barulho.
        if (message.kind === 'capturou') playPaintballSound({ hit: true })
        break
      case 'match-started':
      case 'match-ended':
        // O placar vem no próximo snapshot (20 vezes por segundo); estes
        // eventos existem para o AVISO na tela, que o HUD monta a partir de
        // `lastMatch`. Nada de estado do jogo depende deles.
        break
      case 'snapshot': {
        const now = this.time.now
        for (const player of message.players) {
          // Auto-recuperação: quem aparece no snapshot sem sprite ganha um
          // agora. Sem isto, um `joined` perdido (troca de cena, reconexão)
          // deixaria a pessoa invisível para sempre, mesmo o servidor
          // mandando a posição dela vinte vezes por segundo. Mesmo remendo que
          // a `OfficeScene` faz quando um `moved` chega para alguém sem
          // `CharacterView`.
          if (player.userId === this.youId || this.remotes.has(player.userId)) continue
          if (this.remoteMeta.has(player.userId)) continue
          void this.addRemote({
            userId: player.userId,
            name: player.userId,
            // Só o snapshot não diz o time; o `welcome`/`joined` diz. Cair no
            // oeste aqui é chute de último caso — e o sprite se corrige assim
            // que o `joined` correspondente chegar.
            team: this.teams.get(player.userId) ?? 'oeste',
            avatarSeed: null,
            avatarOptions: null,
            x: player.x,
            y: player.y,
            dir: player.dir,
          })
        }
        this.interpolator.push(
          message.players.filter((player) => player.userId !== this.youId),
          now,
        )
        this.lastMatch = message.match
        this.flags = message.flags
        if (message.ball) this.applyBallSnapshot(message.ball, false)
        for (const player of message.players) {
          // `downMs` é tempo RESTANTE; vira instante local na hora de chegar,
          // que é o que permite contar sem receber mais nada do servidor.
          this.downUntil.set(player.userId, player.downMs ? now + player.downMs : 0)
          this.hits.set(player.userId, player.hits ?? 0)
        }
        if (message.race) this.applyRaceSnapshot(message.race)
        const you = message.players.find((player) => player.userId === this.youId)
        if (you && this.predictor) {
          this.lastAckSeq = you.seq
          // Rumo e velocidade fazem parte do estado autoritativo na corrida:
          // reancorar sem eles reexecutaria os pendentes a partir de um kart
          // apontado para outro lado, e a correção viria como um tranco.
          this.predictor.reconcile(
            { x: you.x, y: you.y, dir: you.dir, heading: you.h ?? 0, speed: you.v ?? 0 },
            you.seq,
          )
          this.player = this.predictor.current()
        }
        break
      }
      case 'race-started': {
        this.raceCountdownUntil = 0
        this.onRaceNotice?.({ kind: 'largada', userId: null })
        break
      }
      case 'lap': {
        this.onRaceNotice?.({
          kind: 'volta',
          userId: message.userId,
          lap: message.lap,
          lapMs: message.lapMs,
        })
        break
      }
      case 'race-finished': {
        this.onRaceNotice?.({ kind: 'chegada', userId: message.userId, position: message.position })
        break
      }
    }
  }

  /**
   * O passo que a predição roda — o MESMO que o servidor aplica.
   *
   * Na corrida, `frozen` é lido no momento da chamada (o semáforo). Reexecutar
   * um input do outro lado da largada com o valor de agora pode discordar do
   * servidor por um input, no tick exato em que a luz abre; enquanto travado os
   * dois concordam em "parado", e a diferença de um passo é reconciliada no
   * snapshot seguinte, invisível.
   */
  private stepFn(): (state: BodyKartState, input: BodyInput, grid: BodyCollisionGrid) => BodyKartState {
    if (modeIsRace(this.mode)) {
      return (state, input, grid) =>
        stepBodyKart(state, input, grid, { frozen: this.raceCountdownUntil > this.time.now })
    }
    // Pedestre: `stepBody` devolve só `{x, y, dir}`, então o rumo e a
    // velocidade (que ele não usa) são preservados pelo espalhamento.
    return (state, input, grid) => ({ ...state, ...stepBody(state, input, grid, { speed: this.speed }) })
  }

  /** Guarda o estado da corrida e converte o prazo do semáforo em instante local. */
  private applyRaceSnapshot(race: ArenaRaceSnapshot): void {
    this.raceState = race
    // Tempo RESTANTE vira instante LOCAL na chegada — é o que permite contar
    // sem receber mais nada do servidor, como o `downMs` e o `lockedMs`.
    this.raceCountdownUntil = race.countdownMs ? this.time.now + race.countdownMs : 0
  }

  setRaceNoticeListener(listener: (info: ArenaRaceNoticeInfo) => void): void {
    this.onRaceNotice = listener
  }

  /**
   * Devolve o kart à pista. Só pede — quem decide é o servidor, que sabe onde a
   * linha de centro passa ali; mandar posição daqui seria mandar teleporte.
   */
  requestUnstuck(): void {
    if (!modeIsRace(this.mode)) return
    this.send?.({ type: 'unstuck' })
  }

  /**
   * Fumaça das rodas na curva rápida — o mesmo efeito do kart do escritório.
   *
   * Só do PRÓPRIO piloto: a intenção de esterço dos outros não viaja no fio, e
   * inventá-la a partir do rumo interpolado poria nuvem em quem está reto.
   */
  private emitKartSmoke(steer: number, handbrake: boolean): void {
    const fumaca = kartSmoke(this.player, steer, handbrake)
    if (!fumaca) return
    const agora = this.time.now
    fumaca.wheels.forEach((roda, indice) => {
      if (agora - (this.lastSmokeAt[indice] ?? 0) < KART_SMOKE_INTERVAL_MS) return
      this.lastSmokeAt[indice] = agora
      // Abaixo do veículo: a nuvem sai de baixo dele, não por cima.
      puffKartSmoke(this, roda, fumaca.intensity, ARENA_KART_DEPTH - 2)
    })
  }

  /**
   * O kart de alguém, criado sob demanda.
   *
   * A cor sai de um hash do `userId`, e não do time: a corrida é individual, e
   * dois karts da mesma cor em disputa não diriam quem é quem. Hash, e não ordem
   * de entrada, para a cor ser a MESMA em todos os clientes.
   */
  private kartFor(userId: string): Phaser.GameObjects.Image {
    const existente = this.karts.get(userId)
    if (existente) return existente
    let hash = 0
    for (let i = 0; i < userId.length; i += 1) hash = (hash * 31 + userId.charCodeAt(i)) >>> 0
    const kart = this.add
      .image(this.player.x, this.player.y, ARENA_KART_TEXTURE)
      .setDisplaySize(ARENA_KART_DISPLAY, ARENA_KART_DISPLAY)
      .setTint(KART_TINTS[hash % KART_TINTS.length])
      .setDepth(ARENA_KART_DEPTH - 1)
    this.karts.set(userId, kart)
    return kart
  }

  /**
   * Põe o kart sob o piloto e recorta o sprite dele à faixa da cabeça.
   *
   * O recorte é o mesmo do escritório e existe pelo mesmo motivo: visto de cima,
   * quem dirige aparece pelo VÃO do kart. Sem ele, o boneco inteiro fica em pé
   * atrás do veículo, como se estivesse empurrando.
   */
  private layoutKart(
    userId: string,
    sprite: Phaser.GameObjects.Sprite,
    x: number,
    y: number,
    heading: number,
  ): void {
    const kart = this.kartFor(userId)
    kart.setPosition(Math.round(x), Math.round(y)).setRotation(heading + ARENA_KART_TEXTURE_OFFSET)
    // A pose do LPC segue o rumo, mas em quatro degraus — quem gira de verdade
    // é a textura do veículo.
    sprite.anims.stop()
    sprite.setFrame(characterIdleFrame(kartFacing(heading)))
    sprite.setCrop(0, ARENA_KART_HEAD_TOP, CHARACTER_FRAME_SIZE, ARENA_KART_HEAD_HEIGHT)
    sprite.setDepth(ARENA_KART_DEPTH)
    sprite.setPosition(
      Math.round(x - Math.cos(heading) * ARENA_KART_RIDER_BACKSET),
      Math.round(y + ARENA_KART_RIDER_SINK - Math.sin(heading) * ARENA_KART_RIDER_BACKSET),
    )
  }

  preload(): void {
    const g = this.make.graphics({ x: 0, y: 0 }, false)
    createPaintTextures(this, g)
    if (modeIsRace(this.mode)) createKartSmokeTexture(this, g)
    if (this.mode === 'futebol') createConfettiTexture(this, g)
    g.destroy()
    if (this.mode === 'futebol') this.load.image(BALL_TEXTURE, BALL_ASSET_URL)
    if (modeIsRace(this.mode)) this.load.image(ARENA_KART_TEXTURE, ARENA_KART_ASSET_URL)
  }

  create(): void {
    const { width, height, tileWidth, tileHeight, backgroundColor } = this.document.map
    this.cameras.main.setBackgroundColor(backgroundColor)
    this.cameras.main.setBounds(0, 0, width * tileWidth, height * tileHeight)
    this.cameras.main.setZoom(this.zoom)
    this.cameras.main.roundPixels = true

    // O cenário publicado. Assíncrono porque as texturas dos tilesets passam
    // pelo Loader do Phaser; desenhar antes disso sai vazio.
    void ensureMapAssets(this, this.assets).then(() => {
      if (!this.scene) return
      renderMapScenery(this, this.document, this.assets)
    })

    // A grade de colisão vira OVERLAY de depuração, por cima do cenário. Ela
    // continua existindo porque é o único jeito de ver divergência entre
    // "parece parede" e "é parede" — mas não é mais o que se vê por padrão.
    const layer = this.add.graphics()
    layer.fillStyle(0xff4d6d, 0.35)
    for (let cy = 0; cy < this.grid.height; cy += 1) {
      for (let cx = 0; cx < this.grid.width; cx += 1) {
        if (this.grid.blocked[cy * this.grid.width + cx] !== 1) continue
        layer.fillRect(
          cx * this.grid.cellWidth,
          cy * this.grid.cellHeight,
          this.grid.cellWidth,
          this.grid.cellHeight,
        )
      }
    }
    layer.setDepth(9_000)
    layer.setVisible(this.showCollision)
    this.collisionLayer = layer

    this.bodyBox = this.add.graphics().setDepth(9_001).setVisible(this.showCollision)

    if (this.mode === 'futebol') {
      // Botão direito é passe: sem isto ele também abriria o menu do navegador
      // em cima do campo.
      this.input.mouse?.disableContextMenu()
      this.drawPitch()
      const couro = this.textures.get(BALL_TEXTURE)
      if (!couro.has(BALL_FRAME)) {
        couro.add(BALL_FRAME, 0, BALL_ART.x, BALL_ART.y, BALL_ART.width, BALL_ART.height)
      }
      this.ballSprite = this.add
        .image(this.spawn.x, this.spawn.y, BALL_TEXTURE, BALL_FRAME)
        .setDisplaySize(BALL_DISPLAY_SIZE, BALL_DISPLAY_SIZE)
        .setDepth(BALL_DEPTH)
        .setVisible(false)
    }

    // Roda do mouse: um passo por giro. `deltaY` varia muito entre
    // dispositivos (trackpad manda dezenas de eventos pequenos), então o que
    // importa é só o SINAL — acumular o valor faria o trackpad pular do 1 ao 4.
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      if (dy === 0) return
      this.stepZoom(dy < 0 ? 1 : -1)
    })

    // Mira: o ângulo do personagem até o ponteiro, em coordenadas de MUNDO.
    // Ler a posição de tela daria o ângulo errado assim que a câmera rolasse.
    //
    // Nada é DESENHADO para a mira: o ponteiro do mouse já é o indicador, e
    // qualquer risco saindo da mão lia como uma varinha grudada no personagem.
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      this.aim = Math.atan2(pointer.worldY - this.player.y, pointer.worldX - this.player.x)
    })
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.aim = Math.atan2(pointer.worldY - this.player.y, pointer.worldX - this.player.x)
      // O mesmo gesto, o outro verbo: no futebol o clique é o pé.
      // Botão direito passa; esquerdo chuta — o par Z/X do teclado, no mouse.
      if (this.mode === 'futebol') this.kick(pointer.rightButtonDown() ? 'passe' : 'chute')
      else this.fire()
    })

    const keyboard = this.input.keyboard
    if (keyboard) {
      this.keys = {
        up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
        sprint: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT),
      }
      keyboard.addCapture(['W', 'A', 'S', 'D'])
      // Teclado também chuta: o mouse mira melhor, mas obrigar mouse para
      // tocar na bola deixa de fora quem joga de trackpad.
      //
      // **Espaço e E**, e não o Z/X do escritório, por causa da mão: lá a
      // pessoa está parada perto de uma bola de corredor; aqui ela está
      // CORRENDO com WASD e Shift, e descer o anelar até o Z no meio da
      // corrida tira a mão do lugar. O polegar (espaço) e o indicador (E, um
      // dedo acima do D) não saem de onde estão.
      //
      // O espaço precisa ser capturado, senão ele rola a página junto — e a
      // captura é solta inteira quando o chat ganha foco (`setInputEnabled`),
      // que é o que permite digitar espaço numa mensagem.
      if (this.mode === 'futebol') {
        keyboard.addCapture('SPACE')
        keyboard.on('keydown-SPACE', () => this.kick('chute', this.footAngle()))
        keyboard.on('keydown-E', () => this.kick('passe', this.footAngle()))
      }
      if (modeIsRace(this.mode)) {
        // **R** de "recolocar": na corrida não há abate, logo não há
        // renascimento, e um kart de nariz na barreira sem espaço para manobrar
        // ficaria preso a prova inteira. Fica longe do WASD de propósito — é um
        // gesto deliberado, não algo para se apertar por engano numa curva.
        keyboard.on('keydown-R', () => this.requestUnstuck())
      }
      // Teclado também, para quem não tem roda.
      keyboard.on('keydown-PLUS', () => this.stepZoom(1))
      keyboard.on('keydown-ADD', () => this.stepZoom(1))
      keyboard.on('keydown-MINUS', () => this.stepZoom(-1))
      keyboard.on('keydown-SUBTRACT', () => this.stepZoom(-1))
    }

    void this.loadSprite()

    // A partir daqui `this.add`, `this.time` e os tweens existem — só agora o
    // que chegou do servidor pode virar sprite.
    this.booted = true
    const inbox = this.inbox
    this.inbox = []
    for (const message of inbox) this.applyServerMessage(message)
  }

  /**
   * Compõe (uma vez por pessoa) o spritesheet LPC e registra as animações de
   * caminhada dele. As anims são chaveadas pela TEXTURA, não por um nome fixo:
   * com várias pessoas na arena, um nome só faria todo mundo herdar o
   * personagem do primeiro que entrou.
   */
  private async ensureCharacterTexture(
    userId: string,
    avatar: Parameters<typeof occupantCharacterOptions>[0],
  ): Promise<string> {
    const key = `arena-char-${userId}`
    if (!this.textures.exists(key)) {
      // Na arena todo mundo está armado — é o lugar do jogo. Diferente do
      // escritório, onde pegar o marcador é gesto deliberado justamente para o
      // expediente não virar campo de tiro. No futebol, ninguém: entrar em
      // campo com o marcador na mão prometeria um tiro que o servidor recusa.
      const armado = { ...avatar, paintMarker: modeHasShooting(this.mode) }
      const sheet = await composeCharacterSheet(
        occupantCharacterOptions(armado),
        undefined,
        occupantExtraLayers(armado),
      )
      if (this.scene && !this.textures.exists(key)) {
        this.textures.addSpriteSheet(key, sheet as unknown as HTMLImageElement, {
          frameWidth: CHARACTER_FRAME_SIZE,
          frameHeight: CHARACTER_FRAME_SIZE,
        })
      }
    }
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      const animKey = `${key}-walk-${dir}`
      if (this.anims.exists(animKey)) continue
      this.anims.create({
        key: animKey,
        frames: characterWalkFrames(dir).map((frame) => ({ key, frame })),
        frameRate: WALK_FRAME_RATE,
        repeat: -1,
      })
    }
    return key
  }

  /**
   * Anel da cor do time sob os pés.
   *
   * Sob o personagem, e não tingindo o sprite: tingir mudaria a roupa que a
   * pessoa escolheu no editor — e num jogo por times o que precisa ser lido de
   * relance é o LADO, não a fantasia. O anel também não briga com a tinta, que
   * usa outra paleta de propósito.
   */
  private teamRing(userId: string): Phaser.GameObjects.Ellipse {
    const team = this.teams.get(userId) ?? 'oeste'
    const ring = this.add.ellipse(0, 0, 22, 10)
    ring.setStrokeStyle(2, ARENA_TEAM_COLORS[team], 0.9)
    ring.setDepth(CHARACTER_DEPTH - 1)
    return ring
  }

  private async loadSprite(): Promise<void> {
    const key = await this.ensureCharacterTexture(this.avatar.userId, this.avatar)
    if (!this.scene) return
    const sprite = this.add.sprite(this.player.x, this.player.y, key, characterIdleFrame('down'))
    // Ancorado nos PÉS, mas o corpo de colisão é o tronco: a origem fica um
    // pouco abaixo do centro da caixa, senão o personagem parece flutuar
    // acima da parede que ele está tocando.
    sprite.setOrigin(0.5, CHARACTER_ORIGIN_Y)
    sprite.setDisplaySize(CHARACTER_FRAME_DISPLAY, CHARACTER_FRAME_DISPLAY)
    sprite.setDepth(CHARACTER_DEPTH)
    this.sprite = sprite
    // Follow sem interpolação: com lerp, a câmera persegue o personagem e o
    // cenário rola a velocidades fracionárias, tremendo mesmo com o sprite
    // alinhado. Em pixel art, câmera colada é mais nítida que câmera macia.
    this.cameras.main.startFollow(sprite, true)
    // Na corrida o sprite é a CABEÇA afundada no cockpit, não o corpo: seguir
    // ele sem compensar deixaria o kart 30px acima do centro da tela, e a
    // câmera olhando para o asfalto atrás dele. O deslocamento desfaz o afunda-
    // mento e devolve o centro ao veículo, que é o que se está dirigindo.
    if (modeIsRace(this.mode)) this.cameras.main.setFollowOffset(0, ARENA_KART_RIDER_SINK)
  }

  /**
   * Dispara no ângulo mirado. Só o ÂNGULO vai no fio: alcance, parede e acerto
   * são do servidor (`fireBodyShot`), com a posição autoritativa de todo
   * mundo. A cadência local só evita encher o socket — quem decide é lá.
   */
  private fire(): void {
    if (!this.send || !this.inputEnabled) return
    const agora = this.time.now
    if (agora - this.lastShotAt < BODY_SHOT_COOLDOWN_MS) return
    this.lastShotAt = agora
    this.send({ type: 'fire', angle: this.aim })
  }

  /**
   * As marcações do campo, desenhadas como FORMA.
   *
   * Nenhum tileset do acervo tem linha de campo, e pintá-la em tile quadrado
   * daria borda dura — o mesmo motivo por que o campo de batalha desistiu das
   * manchas de grama. Como forma, ela nasce na espessura certa em qualquer
   * zoom e sai de graça do espelho: a geometria já é simétrica.
   */
  private drawPitch(): void {
    const campo = SOCCER_FIELD
    const tile = this.document.map.tileWidth

    // Faixas do corte do gramado. É o detalhe que faz o gramado LER como
    // campo antes mesmo de a primeira linha aparecer.
    const grama = this.add.graphics().setDepth(PITCH_DEPTH - 1)
    grama.fillStyle(0x000000, 0.06)
    for (let x = campo.left; x < campo.right; x += MOW_TILES * tile * 2) {
      grama.fillRect(x, campo.top, MOW_TILES * tile, campo.bottom - campo.top)
    }

    const linha = this.add.graphics().setDepth(PITCH_DEPTH)
    linha.lineStyle(PITCH_LINE, 0xffffff, 0.55)

    const caixa = (x: number, y: number, w: number, h: number) => linha.strokeRect(x, y, w, h)

    // Lateral e fundo: o retângulo do campo vai de uma linha de gol à outra.
    const esquerda = campo.goals.oeste.line
    const direita = campo.goals.leste.line
    caixa(esquerda, campo.top + tile, direita - esquerda, campo.bottom - campo.top - tile * 2)

    // Meio de campo e círculo central.
    linha.beginPath()
    linha.moveTo(campo.centerX, campo.top + tile)
    linha.lineTo(campo.centerX, campo.bottom - tile)
    linha.strokePath()
    linha.strokeCircle(campo.centerX, campo.centerY, campo.circleRadius)
    linha.fillStyle(0xffffff, 0.55)
    linha.fillCircle(campo.centerX, campo.centerY, PITCH_LINE)

    // Grande área, área pequena e marca do pênalti, dos dois lados.
    for (const team of ARENA_TEAMS) {
      const goal = campo.goals[team]
      const dentro = goal.inside
      const areaX = dentro < 0 ? goal.line : goal.line - campo.penaltyDepth
      caixa(areaX, campo.centerY - campo.penaltyHeight / 2, campo.penaltyDepth, campo.penaltyHeight)
      const pequenaX = dentro < 0 ? goal.line : goal.line - campo.goalAreaDepth
      caixa(
        pequenaX,
        campo.centerY - campo.goalAreaHeight / 2,
        campo.goalAreaDepth,
        campo.goalAreaHeight,
      )
      linha.fillCircle(goal.line + dentro * campo.penaltySpot, campo.centerY, PITCH_LINE)
    }
  }

  /**
   * Chuta. Só o ÂNGULO vai no fio; força, alcance e cadência são do servidor.
   *
   * O chute também é aplicado LOCALMENTE, na hora — é o mesmo motivo da
   * predição do passo: esperar a ida e volta para a bola sair do pé faz o
   * controle parecer emperrado. Se o servidor recusar (fora do alcance, ou
   * cadência), a correção por snapshot devolve a bola ao lugar em ~150ms.
   */
  private kick(power: BodyKickPower = 'chute', angle: number = this.aim): void {
    if (!this.inputEnabled) return
    const agora = this.time.now
    if (agora - this.lastKickAt < BODY_BALL_KICK_COOLDOWN_MS) return
    if (!this.ballState || agora < this.ballLockedUntil) return
    if (!isBallKickable(this.ballState, this.player)) return
    this.lastKickAt = agora

    const sprint = this.keys?.sprint.isDown === true
    const local = kickBodyBall({ ball: this.ballState, kicker: this.player, angle, sprint, power })
    if (local) this.ballState = local
    playKickSound({ power: 'kick', grazed: power === 'passe' || !sprint })
    this.send?.({ type: 'kick', angle, power })
  }

  /**
   * Para onde o pé aponta sem mouse: a direção do PASSO, e a pose encarada
   * quando se está parado.
   *
   * O passo, e não só a pose, porque o movimento aqui é de oito direções e a
   * pose tem quatro — chutar na diagonal em que se corre é o que a mão espera.
   */
  private footAngle(): number {
    const { dx, dy } = this.intent
    if (dx !== 0 || dy !== 0) return Math.atan2(dy, dx)
    return FACING_ANGLE[this.player.dir]
  }

  /**
   * Reconcilia a bola com o servidor.
   *
   * A velocidade é aceita inteira (é ela que diz o que vai acontecer daqui
   * para a frente); a POSIÇÃO é puxada aos poucos, porque o cliente está
   * sempre meio caminho de rede atrás e um salto por pacote seria visível
   * vinte vezes por segundo. Erro grande demais para esconder é aceito de vez.
   */
  private applyBallSnapshot(ball: ArenaBallSnapshot, inicial: boolean): void {
    const { lockedMs, ...estado } = ball
    this.ballLockedUntil = lockedMs ? this.time.now + lockedMs : 0
    if (inicial || !this.ballState) {
      this.ballState = { ...estado }
      return
    }
    const erro = Math.hypot(estado.x - this.ballState.x, estado.y - this.ballState.y)
    const peso = erro > BALL_SNAP_PX ? 1 : BALL_CORRECTION
    this.ballState = {
      x: this.ballState.x + (estado.x - this.ballState.x) * peso,
      y: this.ballState.y + (estado.y - this.ballState.y) * peso,
      vx: estado.vx,
      vy: estado.vy,
    }
  }

  /**
   * Roda a bola no quadro: a MESMA física do servidor, mais o toque de quem
   * está aqui.
   *
   * Só o toque do PRÓPRIO jogador é previsto — o dos outros chega pela
   * correção do snapshot, como a posição deles. Prever o pé alheio a partir de
   * uma posição interpolada 100ms atrás inventaria conduções que nunca
   * aconteceram.
   */
  private updateBall(dtMs: number, dx: number, dy: number, sprint: boolean): void {
    const bola = this.ballState
    const sprite = this.ballSprite
    if (!bola || !sprite) return
    if (this.time.now < this.ballLockedUntil) {
      sprite.setVisible(true).setPosition(bola.x, bola.y)
      return
    }

    const antes = { x: bola.x, y: bola.y }
    let depois = stepBodyBall(bola, dtMs, this.grid)
    const toque = touchBodyBall(depois, { ...this.player, dx, dy, sprint })
    if (toque) depois = toque
    this.ballState = depois

    sprite.setVisible(true).setPosition(Math.round(depois.x), Math.round(depois.y))
    // Gira na direção do movimento: rolar é o que separa uma bola de um disco.
    sprite.rotation += Math.hypot(depois.x - antes.x, depois.y - antes.y) * BALL_SPIN_PER_PX
  }

  /**
   * A comemoração do gol: chuva de confete na tela inteira e um canhão saindo
   * de quem marcou.
   *
   * A chuva é presa na CÂMERA (`setScrollFactor(0)`), e não no campo: gol é
   * evento da partida, não do lugar onde a bola entrou — quem estava na outra
   * ponta veria o confete cair longe, atrás de si.
   *
   * O canhão sai do autor, e por isso ele não sai no gol CONTRA: confete
   * jorrando do corpo de quem acabou de marcar contra o próprio time leria
   * como erro de código, não como piada. A chuva continua, porque o outro
   * time comemora de verdade.
   *
   * Nada disso é novo: é o mesmo confete do high-five do escritório
   * (`confettiSprites.ts`), que saiu de lá justamente para a arena poder usar.
   */
  private celebrateGoal(autorId: string | null): void {
    const chuva = this.add.particles(0, 0, CONFETTI_TEXTURE, confettiBurstConfig(this.scale.width))
    chuva.setDepth(CELEBRATION_DEPTH)
    chuva.setScrollFactor(0)
    chuva.explode(CONFETTI_BURST_COUNT)
    this.time.delayedCall(CONFETTI_BURST_LIFESPAN + 300, () => chuva.destroy())

    const autor = autorId === this.youId ? this.sprite : autorId ? this.remotes.get(autorId) : undefined
    if (autor) {
      const canhao = this.add.particles(autor.x, autor.y, CONFETTI_TEXTURE, confettiLaunchConfig('up'))
      canhao.setDepth(CHARACTER_DEPTH + 2)
      // Gruda em quem marcou: a saída de bola devolve todo mundo à base, e um
      // jato parado ficaria pendurado no meio do campo, sem dono.
      canhao.startFollow(autor)
      this.time.delayedCall(GOAL_CANNON_MS, () => {
        canhao.stop()
        // Para de emitir e só então some: destruir na hora cortaria no ar as
        // partículas que ainda estão caindo.
        this.time.delayedCall(CONFETTI_LAUNCH_TAIL_MS, () => canhao.destroy())
      })
    }

    // Sem som: o gol é só confete. O aplauso do escritório é reação de plateia
    // a um high-five, e num campo com dois times metade de quem ouve acabou de
    // levar — aplaudir para ela soaria deboche. O aviso na tela já conta o que
    // aconteceu.
  }

  /** Anima um disparo já resolvido pelo servidor. */
  private playShot(shot: BodyShot): void {
    // Atirar entrega a posição. Quem fica quieto não aparece no mapa — é o que
    // dá peso à decisão de puxar o gatilho.
    if (shot.shooterId !== this.youId) {
      this.revelados.set(shot.shooterId, {
        x: shot.from.x,
        y: shot.from.y,
        until: this.time.now + REVEAL_MS,
      })
    }

    if (shot.splat) this.applySplat(shot.splat)
    playPaintballSound({ hit: false })

    const pellet = this.add.image(shot.from.x, shot.from.y, PAINT_PELLET_TEXTURE)
    pellet.setTint(shot.color).setDepth(PAINT_DEPTH)
    this.tweens.add({
      targets: pellet,
      x: shot.to.x,
      y: shot.to.y,
      duration: Math.max(1, shot.durationMs),
      ease: 'Linear',
      onComplete: () => {
        pellet.destroy()
        this.burst(shot.to.x, shot.to.y, shot.color)
        if (shot.splat) playPaintballSound({ hit: true })
      },
    })
  }

  /** Respingos do impacto, em tamanho real (escalar reamostraria a arte). */
  private burst(px: number, py: number, color: number): void {
    for (let i = 0; i < BURST_DROPS; i += 1) {
      const angulo = (i / BURST_DROPS) * Math.PI * 2 + i * 0.7
      const drop = this.add.image(px, py, PAINT_PELLET_TEXTURE)
      drop.setTint(color).setDepth(PAINT_DEPTH)
      this.tweens.add({
        targets: drop,
        x: px + Math.cos(angulo) * BURST_REACH,
        y: py + Math.sin(angulo) * BURST_REACH,
        alpha: 0,
        duration: BURST_MS,
        ease: 'Quad.easeOut',
        onComplete: () => drop.destroy(),
      })
    }
  }

  /**
   * Gruda a mancha no personagem de quem levou. Posição e desenho saem de
   * `paintSplatPlacement(id)` — derivados do id, então todo mundo vê a mancha
   * no mesmo lugar sem coordenada no payload.
   */
  private applySplat(splat: PaintSplat): void {
    const alvo =
      splat.userId === this.youId ? this.sprite : this.remotes.get(splat.userId)
    if (!alvo) return
    const { ox, oy, variant } = paintSplatPlacement(splat.id)
    const image = this.add.image(0, 0, `${PAINT_SPLAT_TEXTURE}-${variant}`)
    image.setTint(splat.color).setDepth(CHARACTER_DEPTH + 1)
    const lista = this.splats.get(splat.userId) ?? []
    // Guarda o deslocamento no próprio objeto: o sprite se move a cada quadro,
    // e a mancha precisa acompanhar sem recalcular a origem.
    image.setData('ox', ox * SPLAT_BOX.x)
    image.setData('oy', SPLAT_BOX.top + ((oy + 1) / 2) * (SPLAT_BOX.bottom - SPLAT_BOX.top))
    image.setPosition(alvo.x + image.getData('ox'), alvo.y + image.getData('oy'))
    image.setAlpha(0)
    this.tweens.add({ targets: image, alpha: 1, duration: 90 })
    lista.push(image)
    this.splats.set(splat.userId, lista)

    const ttl = Math.max(0, Math.min(splat.ttlMs, PAINT_SPLAT_TTL_MS))
    this.time.delayedCall(Math.max(0, ttl - 1_200), () => {
      if (!image.scene) return
      this.tweens.add({
        targets: image,
        alpha: 0,
        duration: 1_200,
        onComplete: () => {
          this.splats.set(splat.userId, (this.splats.get(splat.userId) ?? []).filter((i) => i !== image))
          image.destroy()
        },
      })
    })
  }

  /**
   * Quem está abatido fica translúcido, em vez de sumir.
   *
   * Sumir seria mais limpo e é pior: o corpo desaparecendo confunde com "saiu
   * da arena", e some também a informação de ONDE a pessoa caiu — que é o que
   * diz se aquela passagem está sendo vigiada.
   */
  /**
   * As bandeiras: um mastro na cor do time, na base, no chão ou sobre a cabeça
   * de quem a carrega.
   *
   * Desenhadas como forma, e não como sprite do acervo: nenhum tileset tem
   * bandeira, e a cor precisa ser a do TIME — um sprite fixo teria que ser
   * tingido, e tingir arte detalhada some com a forma no `pixelArt`.
   */
  private drawFlags(): void {
    if (!this.flags) {
      for (const container of this.flagSprites.values()) container.destroy()
      this.flagSprites.clear()
      for (const marca of this.baseMarks.values()) marca.destroy()
      this.baseMarks.clear()
      return
    }
    const bases = this.flagBases()
    for (const team of ARENA_TEAMS) {
      const flag = this.flags[team]
      let container = this.flagSprites.get(team)
      if (!container) {
        container = this.add.container(0, 0)
        // O mastro nasce NO CHÃO e sobe: ancorado pelo meio, ele atravessava o
        // personagem e o pano ficava nos pés — lia como um risco, não como
        // bandeira.
        // 48px de mastro: o personagem tem 64, e uma bandeira mais baixa que
        // isso fica na altura da cintura dele — encoberta justamente na base,
        // que é onde ela passa a maior parte do tempo.
        const mastro = this.add.rectangle(0, -19, 2, 38, 0xf2f2f2)
        const pano = this.add.triangle(0, -37, 1, 0, 13, 5, 1, 10, ARENA_TEAM_COLORS[team])
        pano.setOrigin(0, 0)
        // Marca no chão: mostra ONDE é a base mesmo com a bandeira levada, que
        // é justamente quando se precisa saber para onde correr.
        const marca = this.add.ellipse(0, 0, 26, 12)
        marca.setStrokeStyle(1, ARENA_TEAM_COLORS[team], 0.5)
        container.add([marca, mastro, pano])
        this.flagSprites.set(team, container)
      }
      const marcaDeBase = container.list[0] as Phaser.GameObjects.Ellipse
      // A marca acompanha a BASE; o mastro é que viaja.
      marcaDeBase.setVisible(flag.at === 'base')

      // Enquanto a bandeira estiver fora, a base ganha o próprio marcador.
      let marcaBase = this.baseMarks.get(team)
      if (!marcaBase) {
        marcaBase = this.add.ellipse(bases[team].x, bases[team].y, 26, 12)
        marcaBase.setStrokeStyle(1, ARENA_TEAM_COLORS[team], 0.5)
        marcaBase.setDepth(CHARACTER_DEPTH - 2)
        this.baseMarks.set(team, marcaBase)
      }
      marcaBase.setVisible(flag.at !== 'base')

      if (flag.at === 'carregada') {
        const portador =
          flag.byUserId === this.youId ? this.sprite : this.remotes.get(flag.byUserId)
        if (!portador) {
          container.setVisible(false)
          continue
        }
        container.setVisible(true)
        // Nas COSTAS, não flutuando sobre a cabeça: o mastro ancora no quadril
        // e se inclina, como uma bandeira a tiracolo. Flutuando, ela lia como
        // um ícone de interface colado na pessoa; inclinada e presa ao corpo,
        // lê como coisa que está sendo carregada.
        //
        // As mãos não servem: elas já seguram o marcador, e a arte do LPC
        // desenha o estilingue exatamente ali.
        const dir = this.facingOf(flag.byUserId)
        const lado = dir === 'left' ? 1 : dir === 'right' ? -1 : 0
        container.setPosition(portador.x + lado * 4, portador.y - 10)
        container.setRotation(FLAG_CARRY_TILT * (lado === 0 ? 1 : lado))
        // Andando para CIMA a pessoa mostra as costas, então a bandeira passa
        // à frente; nas outras poses ela fica atrás do corpo — e mesmo assim a
        // flâmula aparece acima do ombro, que é o que precisa ser visto.
        container.setDepth(dir === 'up' ? CHARACTER_DEPTH + 2 : CHARACTER_DEPTH - 2)
      } else {
        const ponto = flag.at === 'base' ? bases[team] : flag
        container.setVisible(true)
        container.setPosition(ponto.x, ponto.y)
        container.setRotation(0)
        // Plantada é CENÁRIO e fica atrás de quem passa: senão o mastro corta
        // o rosto de quem está em cima da base, que é onde todo mundo fica.
        container.setDepth(CHARACTER_DEPTH - 2)
      }
    }
  }

  /**
   * O que o mapa de aproximação mostra.
   *
   * Companheiros sempre; adversários só enquanto a revelação do tiro dura. Sem
   * ver o próprio time, um modo por times vira jogo solo — e é informação que
   * uma equipe teria por rádio de qualquer jeito.
   */
  private minimapInfo(now: number): ArenaMinimapInfo {
    const meuTime = this.youId ? this.teams.get(this.youId) : undefined
    const aliados: Array<{ x: number; y: number }> = []
    for (const [userId, sprite] of this.remotes) {
      if (meuTime && this.teams.get(userId) === meuTime) aliados.push({ x: sprite.x, y: sprite.y })
    }

    const inimigos: Array<{ x: number; y: number; restanteMs: number }> = []
    // No futebol todo mundo aparece. A revelação por tiro não faz sentido onde
    // ninguém atira, e esconder o adversário num campo aberto seria esconder o
    // jogo — ninguém joga bola de olhos fechados.
    if (this.mode === 'futebol') {
      for (const [userId, sprite] of this.remotes) {
        if (meuTime && this.teams.get(userId) === meuTime) continue
        inimigos.push({ x: sprite.x, y: sprite.y, restanteMs: REVEAL_MS })
      }
    }
    for (const [userId, marca] of this.revelados) {
      if (marca.until <= now) {
        this.revelados.delete(userId)
        continue
      }
      inimigos.push({ x: marca.x, y: marca.y, restanteMs: marca.until - now })
    }

    const bandeiras: ArenaMinimapFlag[] = []
    if (this.flags) {
      const bases = this.flagBases()
      for (const team of ARENA_TEAMS) {
        const flag = this.flags[team]
        if (flag.at === 'base') {
          bandeiras.push({ team, ...bases[team], roubada: false })
        } else if (flag.at === 'caida') {
          bandeiras.push({ team, x: flag.x, y: flag.y, roubada: true })
        } else {
          const portador =
            flag.byUserId === this.youId ? this.sprite : this.remotes.get(flag.byUserId)
          // Quem carrega a bandeira é sempre visível no mapa, atirando ou não:
          // é o objetivo do modo, e escondê-lo deixaria a defesa sem o que
          // defender.
          if (portador) bandeiras.push({ team, x: portador.x, y: portador.y, roubada: true })
        }
      }
    }

    return {
      width: this.document.map.width * this.document.map.tileWidth,
      height: this.document.map.height * this.document.map.tileHeight,
      you: this.sprite ? { x: this.sprite.x, y: this.sprite.y } : null,
      team: meuTime ?? null,
      aliados,
      inimigos,
      bandeiras,
      ...(this.ballState ? { bola: { x: this.ballState.x, y: this.ballState.y } } : {}),
    }
  }

  /** Pose atual de alguém — do próprio estado, ou da interpolação do remoto. */
  private facingOf(userId: string): Direction {
    if (userId === this.youId) return this.player.dir
    return this.remoteFacing.get(userId) ?? 'down'
  }

  /** Centro das bases, em pixels — a mesma conta do servidor. */
  private flagBases(): Record<ArenaTeam, { x: number; y: number }> {
    const tiles = mapSpawnTiles(this.document)
    const t = this.document.map.tileWidth
    const centro = (indice: number) => {
      const tile = tiles[indice] ?? tiles[0] ?? { x: 1, y: 1 }
      return { x: tile.x * t + t / 2, y: tile.y * t + t / 2 }
    }
    return { oeste: centro(0), leste: centro(1) }
  }

  /** Quem tem sprite na tela agora, incluindo o próprio. */
  private spritesInPlay(): Array<[string, Phaser.GameObjects.Sprite]> {
    const lista: Array<[string, Phaser.GameObjects.Sprite]> = [...this.remotes]
    if (this.youId && this.sprite) lista.push([this.youId, this.sprite])
    return lista
  }

  private drawDowned(now: number): void {
    for (const [userId, sprite] of this.spritesInPlay()) {
      const ate = this.downUntil.get(userId) ?? 0
      sprite.setAlpha(ate > now ? 0.35 : 1)
    }

    // A corrida não tem anel de time. Ele existe para dizer de que LADO a
    // pessoa está, de relance — e aqui a disputa é individual: o time é
    // cosmético, então o anel diria uma coisa que não decide nada. Quem
    // identifica cada um é a cor do próprio kart.
    if (modeIsRace(this.mode)) return

    // Os anéis nascem AQUI, sob demanda, e não junto do sprite: o time só é
    // conhecido quando o `welcome` chega, e o sprite pode terminar de compor
    // antes disso — criar no sprite deixava quem entrou primeiro sem anel para
    // sempre. Mesmo remendo da auto-recuperação dos remotos.
    for (const [userId, sprite] of this.spritesInPlay()) {
      if (!this.teams.has(userId)) continue
      let ring = this.rings.get(userId)
      if (!ring) {
        ring = this.teamRing(userId)
        this.rings.set(userId, ring)
      }
      ring.setPosition(sprite.x, sprite.y + 10)
      ring.setAlpha(sprite.alpha)
    }
  }

  /** Mantém as manchas coladas em quem as levou. */
  private drawSplats(): void {
    for (const [userId, lista] of this.splats) {
      const alvo = userId === this.youId ? this.sprite : this.remotes.get(userId)
      if (!alvo) continue
      for (const image of lista) {
        image.setPosition(alvo.x + image.getData('ox'), alvo.y + image.getData('oy'))
      }
    }
  }

  /** Sprite de outra pessoa. A composição é assíncrona; quem sair no meio some. */
  private async addRemote(player: ArenaOccupant): Promise<void> {
    if (this.remotes.has(player.userId)) return
    this.remoteMeta.set(player.userId, player)
    const key = await this.ensureCharacterTexture(player.userId, player)
    if (!this.scene || !this.remoteMeta.has(player.userId)) return
    const sprite = this.add.sprite(player.x, player.y, key, characterIdleFrame(player.dir))
    sprite.setOrigin(0.5, CHARACTER_ORIGIN_Y)
    sprite.setDisplaySize(CHARACTER_FRAME_DISPLAY, CHARACTER_FRAME_DISPLAY)
    sprite.setDepth(CHARACTER_DEPTH)
    this.remotes.set(player.userId, sprite)
  }

  private drawRemotes(now: number): void {
    for (const [userId, sprite] of this.remotes) {
      const at = this.interpolator.at(userId, now)
      if (!at) continue
      const previous = this.remoteLast.get(userId)
      // Simula em float, DESENHA em inteiro: posição fracionária faz o sprite
      // cair entre texels e a arte tremer a cada quadro.
      sprite.setPosition(Math.round(at.x), Math.round(at.y))
      this.remoteLast.set(userId, { x: at.x, y: at.y })
      this.remoteFacing.set(userId, at.dir)

      if (modeIsRace(this.mode)) {
        // O rumo vem interpolado pelo arco curto. Sem ele (o primeiro snapshot,
        // antes de haver duas amostras), o kart fica no último rumo conhecido em
        // vez de saltar para zero.
        //
        // O último conhecido sai daqui, e NÃO da `rotation` do sprite: aquela já
        // tem o quarto de volta da textura somado, e realimentá-la acrescentaria
        // 90° a cada quadro sem amostra.
        if (at.heading !== undefined) this.remoteHeading.set(userId, at.heading)
        // Reposiciona o sprite: na corrida o piloto não fica no ponto do kart,
        // e sim afundado no cockpit.
        this.layoutKart(userId, sprite, at.x, at.y, this.remoteHeading.get(userId) ?? 0)
        continue
      }

      // "Está andando?" sai do movimento INTERPOLADO, não de um campo no
      // pacote: é o que a pessoa vê na tela, então é o que a animação deve
      // acompanhar — e economiza um bit por jogador no snapshot.
      const moving =
        previous !== undefined && Math.hypot(at.x - previous.x, at.y - previous.y) > REMOTE_IDLE_EPSILON
      const animKey = `${sprite.texture.key}-walk-${at.dir}`
      const acao = walkAnimationAction({
        moving,
        exists: this.anims.exists(animKey),
        currentKey: sprite.anims.currentAnim?.key,
        isPlaying: sprite.anims.isPlaying,
        animKey,
      })
      if (acao === 'tocar') sprite.play(animKey)
      else if (acao === 'parar') {
        sprite.anims.stop()
        sprite.setFrame(characterIdleFrame(at.dir))
      }
    }
  }

  /**
   * Posições em TILES — a unidade do grafo de áudio (ver `ArenaPresenceInfo`).
   *
   * PUXADO por quem precisa (a voz consulta a ~10Hz), não empurrado por
   * listener: empurrar obrigaria a guardar as posições em estado React, e o
   * estado do jogo fora do React é o que mantém o quadro barato.
   */
  presence(): ArenaPresenceInfo {
    const tileW = this.document.map.tileWidth
    const tileH = this.document.map.tileHeight
    return {
      youId: this.youId,
      you: { x: this.player.x / tileW, y: this.player.y / tileH },
      outros: [...this.remotes].map(([userId, sprite]) => ({
        userId,
        x: sprite.x / tileW,
        y: sprite.y / tileH,
      })),
    }
  }

  update(time: number): void {
    // `dtMs` vem do relógio da cena e entra por PARÂMETRO em `stepBody` — a
    // função não lê tempo, é isso que a torna reexecutável na reconciliação.
    const dtMs = this.lastTime === 0 ? 16 : time - this.lastTime
    this.lastTime = time

    // Com o chat em foco, o personagem fica parado: `dx`/`dy` zerados aqui (e
    // não teclas ignoradas lá embaixo) para que a predição, o pacote de input
    // e a animação concordem em "parado".
    const keys = this.inputEnabled ? this.keys : undefined
    const dx = (keys?.right.isDown ? 1 : 0) - (keys?.left.isDown ? 1 : 0)
    const dy = (keys?.down.isDown ? 1 : 0) - (keys?.up.isDown ? 1 : 0)
    const sprint = keys?.sprint.isDown === true
    this.intent = { dx, dy }

    if (this.predictor) {
      // Em rede, o input é AMOSTRADO a taxa fixa e o mesmo pacote é aplicado
      // localmente e mandado. Prever a cada quadro e mandar a cada N quadros
      // faria o cliente simular um tempo que o servidor nunca recebe — e a
      // reconciliação puxaria o personagem para trás sem parar.
      this.sinceInput += dtMs
      if (this.sinceInput >= INPUT_INTERVAL_MS) {
        // A corrida vai DENTRO do input: o servidor aplica a mesma regra, e é
        // isso que impede a predição de correr sozinha e ser puxada de volta.
        const input = this.predictor.predict(dx, dy, this.sinceInput, sprint)
        this.sinceInput = 0
        // `null` = a fila de não confirmados estourou; o personagem para até o
        // servidor voltar a responder, em vez de andar em falso.
        if (input) {
          this.send?.({ type: 'input', input })
          this.player = this.predictor.current()
        }
      }
    } else if (this.networked) {
      // Em rede e ainda sem autoridade (entrando, ou trocando de modo): o
      // personagem NÃO anda. Andar local aqui é prometer um passo que o
      // servidor nunca autorizou — e quando o `welcome` chega, ele reposiciona
      // no spawn e a pessoa é arrancada de volta. É exatamente o "anda e
      // volta" de quem troca de modo e sai andando na hora.
      this.sinceInput = 0
    } else {
      // Modo local (banco de provas): aqui a velocidade do controle deslizante
      // vale, porque não há servidor com quem concordar.
      this.player = this.stepFn()(this.player, { seq: 0, dx, dy, dtMs, sprint }, this.grid)
    }

    const sprite = this.sprite
    if (sprite && modeIsRace(this.mode)) {
      // Na corrida quem anda é o veículo: a pose do LPC vira quatro degraus e o
      // sprite é recortado à cabeça, sentada no cockpit. Quem posiciona os dois
      // é o `layoutKart` — o piloto não fica no mesmo ponto que o kart.
      this.emitKartSmoke(dx, sprint)
      this.layoutKart(this.youId ?? 'voce', sprite, this.player.x, this.player.y, this.player.heading)
    } else if (sprite) {
      // Idem para o próprio: o arredondamento é só de DESENHO — o estado
      // continua contínuo, senão a reconciliação divergiria do servidor.
      sprite.setPosition(Math.round(this.player.x), Math.round(this.player.y))
      const moving = dx !== 0 || dy !== 0
      const animKey = `${sprite.texture.key}-walk-${this.player.dir}`
      const acao = walkAnimationAction({
        moving,
        exists: this.anims.exists(animKey),
        currentKey: sprite.anims.currentAnim?.key,
        isPlaying: sprite.anims.isPlaying,
        animKey,
      })
      if (acao === 'tocar') sprite.play(animKey)
      else if (acao === 'parar') {
        sprite.anims.stop()
        sprite.setFrame(characterIdleFrame(this.player.dir))
      }
    }

    this.updateBall(dtMs, dx, dy, sprint)
    this.drawRemotes(time)
    this.drawSplats()
    this.drawDowned(time)
    this.drawFlags()

    this.sinceMinimap += dtMs
    if (this.onMinimap && this.sinceMinimap >= 1000 / MINIMAP_HZ) {
      this.sinceMinimap = 0
      this.onMinimap(this.minimapInfo(time))
    }

    if (this.lastMatch && this.onMatch) {
      const meuDown = this.downUntil.get(this.youId ?? '') ?? 0
      const minhaLinha = this.raceState?.standings.find((linha) => linha.userId === this.youId)
      this.onMatch({
        ...this.lastMatch,
        ...(this.raceState ? { race: this.raceState } : {}),
        ...(minhaLinha
          ? {
              suaPosicao: minhaLinha.position,
              // A volta que aparece é a EM CURSO, não a última completada: "3/5"
              // enquanto se dá a terceira é o que um painel de corrida mostra.
              // O teto evita "6/5" no instante entre cruzar e a corrida acabar.
              suaVolta: Math.min(this.raceState?.laps ?? 1, minhaLinha.lap + 1),
            }
          : {}),
        team: this.youId ? (this.teams.get(this.youId) ?? null) : null,
        // Abatido = nenhuma bolinha acesa. O servidor zera os tiros ao
        // derrubar, então sem isto a vida voltaria a CHEIA durante o abate —
        // e o indicador mentiria exatamente no momento em que ele é a única
        // coisa dizendo o que aconteceu.
        vidas:
          meuDown > time ? 0 : Math.max(0, ARENA_MAX_HITS - (this.hits.get(this.youId ?? '') ?? 0)),
      })
    }

    if (this.bodyBox && this.showCollision) {
      this.bodyBox.clear()
      this.bodyBox.lineStyle(1, 0x52fba2, 0.9)
      this.bodyBox.strokeRect(
        this.player.x - BODY_HALF_WIDTH,
        this.player.y - BODY_HALF_HEIGHT,
        BODY_HALF_WIDTH * 2,
        BODY_HALF_HEIGHT * 2,
      )
    }

    this.onDebug?.({
      x: this.player.x,
      y: this.player.y,
      fps: Math.round(this.game.loop.actualFps),
      pending: this.predictor?.pendingCount() ?? 0,
      players: this.remotes.size + 1,
      mode: this.predictor ? 'rede' : 'local',
      stalled: this.predictor?.isStalled() ?? false,
    })
  }
}

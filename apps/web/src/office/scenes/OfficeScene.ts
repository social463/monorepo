import Phaser from 'phaser'
import { computeScreenPosition, type ScreenPosition } from '../../lib/screenPosition'
import {
  stepBodyAmongBlockers,
  type BodyBlocker,
  type BodyCollisionGrid,
  stepBodyKart,
  type BodyKartState,
  stepBodyBall,
  touchBodyBall,
  MOVE_DIRECTION_DELTAS,
  stepBody,
  bodyCollisionGrid,
  BODY_INPUT_HZ,
  BODY_SPEED,
  BODY_SPRINT_FACTOR,
  type BodyInput,
  type BodyState,
  CHARACTER_FRAME_SIZE,
  characterIdleFrame,
  characterWalkFrames,
  DIAGONAL_STEP_FACTOR,
  facingForMove,
  isDiagonalMove,
  isOfficeBallAssetId,
  isOfficeKartAssetId,
  mapBalls,
  isHighFiveAudible,
  officeSoundLevel,
  paintSplatPlacement,
  PAINT_SPLAT_TTL_MS,
  OFFICE_NEARBY_MESSAGE_MAX_LENGTH,
  officeZoneDisplayName,
  type MapDocumentV1,
  type OfficeDeskDTO,
  type OfficeDeskReminderSummaryDTO,
  type OfficeMapAssetDTO,
  type MoveDirection,
  type TilePosition,
  type OfficeBall,
  type OfficeBallPower,
  type OfficeKart,
  type BodyShot,
  type PaintSplat,
  type Direction,
  type OfficeNearbyMessageKind,
  type OfficeOccupant,
  type OfficeRuntimeZone,
  type OfficeServerMessage,
} from '@legends/shared'
import type { OfficeBridge } from '../OfficeBridge'
import type { TileOrientation } from '../editing/decorationDoc'
import type { ZoneLockKind } from '../lockedZones'
import { ArenaPredictor } from '../../arena/ArenaPredictor'
import { ArenaInterpolator } from '../../arena/ArenaInterpolator'
import { composeCharacterSheet } from '../../lib/character'
import { occupantCharacterOptions, occupantExtraLayers, occupantTextureKey } from '../officeAvatar'
import { officeMapTileFrame } from './officeMapTiles'
import { playApplauseSound } from '../media/applause-sound'
import {
  CELEBRATION_DEPTH,
  CONFETTI_BURST_COUNT,
  CONFETTI_BURST_LIFESPAN,
  CONFETTI_LAUNCH_LIFESPAN,
  CONFETTI_TEXTURE,
  confettiBurstConfig,
  confettiLaunchConfig,
  createConfettiTexture,
} from './confettiSprites'
import { playHighFiveSound } from '../media/high-five-sound'
import { playKickSound } from '../media/kick-sound'
import { playPaintballSound } from '../media/paintball-sound'
import {
  createKartSmokeTexture,
  kartSmoke,
  puffKartSmoke,
  remoteKartSteer,
  KART_SMOKE_INTERVAL_MS,
} from './kartSmoke'
import { createPaintTextures, PAINT_PELLET_TEXTURE, PAINT_SPLAT_TEXTURE } from './paintSprites'

export { PAINT_PELLET_TEXTURE, PAINT_SPLAT_TEXTURE }
import { OFFICE_DESK_REMINDER_GIFT_COLORS, OFFICE_DESK_REMINDER_GIFT_LABEL } from '../deskReminderPresentation'

/** Duração do passo entre dois tiles. Casa com a cadência normal; o teto do servidor (20/s) cobre também a corrida. */
const STEP_MS = 150
/** Cadência do teclado com a tecla presa — não adianta mandar mais do que o servidor aceita. */
/**
 * Abaixo disto, o movimento interpolado de um remoto conta como "parado".
 *
 * Existe porque a interpolação nunca dá zero exato: com o mesmo valor nos dois
 * lados da amostra, sobra ruído de ponto flutuante, e sem a folga o personagem
 * ficaria com as pernas se mexendo de pé.
 */
const REMOTE_IDLE_EPSILON = 0.4

const INPUT_COOLDOWN_MS = 160
/** Correndo (Shift): metade da duração/cadência — casa com o rate limit dobrado do servidor. */
const SPRINT_STEP_MS = STEP_MS / 2
const SPRINT_INPUT_COOLDOWN_MS = INPUT_COOLDOWN_MS / 2
/** Pernas mais rápidas durante a corrida, senão o personagem parece deslizar. */
const SPRINT_ANIM_TIME_SCALE = 2
/**
 * Kart (#22253): mais rápido que correr a pé, e com cadência de input à altura
 * — segurar a direção de kart tem que andar contínuo, não engasgar esperando o
 * cooldown de pedestre.
 */
const KART_STEP_MS = STEP_MS / 3
const KART_INPUT_COOLDOWN_MS = INPUT_COOLDOWN_MS / 3
/** Sprite pixel-art quadrado: mantém o mesmo pivô ao virar em passos de 90°. */
const KART_DISPLAY_SIZE = 48
const KART_ASSET_URL = '/office/kart.png'
export const BALL_TEXTURE = 'office-ball'
const BALL_ASSET_URL = '/office/ball.png'
const BALL_DISPLAY_SIZE = 24
/**
 * Quanto a bola gira por tile percorrido. Nada de física real: é a pista
 * visual de que ela ESTÁ rolando, e não deslizando pelo chão.
 */
const BALL_SPIN_PER_TILE = Math.PI
/**
 * Até onde a batida é ouvida, em tiles (Chebyshev, como todo alcance do
 * escritório). Sem o corte, um escritório grande com uma bola no canto vira um
 * "poc" constante no ouvido de todo mundo. A âncora é o alcance do próprio
 * chute (`BALL_KICK_TILES`, 5): ouve-se o que poderia chegar até você, e mais
 * um pouco — o resto é barulho de outra roda de conversa.
 */
const BALL_EARSHOT_TILES = 8
/**
 * Altura do arco do chute alto, em pixels: uma parte fixa (o "sobe" mínimo) e
 * uma proporcional à distância, para o chute curto não parecer um foguete.
 */
/**
 * Quanto a bola gira por pixel percorrido. Nada de física real: é a pista
 * visual de que ela ESTÁ rolando, e não deslizando pelo chão.
 */
const BALL_SPIN_PER_PX = Math.PI / 32

const BALL_LOB_LIFT_BASE = 14
const BALL_LOB_LIFT_PER_TILE = 7
const BALL_LOB_LIFT_MAX = 64
/** No ar a bola passa por cima de tudo — inclusive de quem está no caminho. */
const BALL_LOB_DEPTH = 9_000

/**
 * Retângulo do TORSO em coordenadas locais do container, onde as manchas
 * caem. Medido no sprite, não chutado: o container fica no centro do tile e o
 * personagem é ancorado pelos PÉS em `CHARACTER_BASE_Y`, então o tronco (linhas
 * 32..47 do frame LPC de 64px, a 48/64 de escala) cai em y −8..+4 daqui. O
 * frame é quase todo ar, e espalhar tinta pelo quadrado inteiro deixaria
 * mancha boiando ao lado da pessoa — ou tapando o rosto dela.
 */
const PAINT_SPLAT_BOX = { x: 6, top: -6, bottom: 3 }
/**
 * Profundidade da mancha DENTRO do container do personagem. Quem de fato a põe
 * sobre o corpo é a ordem de inserção (`container.add` acrescenta ao fim, e o
 * sprite entra no índice 0); o depth acompanha o que o ícone de mão levantada
 * já faz, para o dia em que o container passar a ordenar por ele.
 */
const PAINT_SPLAT_DEPTH_OFFSET = 1
/** A tinta entra por alfa, nunca por escala: crescer reamostraria o desenho. */
const PAINT_SPLAT_IN_MS = 90
/** A mancha avisa que vai sumir: o último trecho da vida dela é o fade. */
const PAINT_SPLAT_FADE_MS = 1_200
/** Respingos que saltam do impacto, e por quanto tempo. */
export const PAINT_BURST_DROPS = 5
const PAINT_BURST_MS = 220
const PAINT_BURST_REACH = 9
/** No voo a bolinha passa por cima de mesa e gente, como a bola no chute alto. */
const PAINT_PELLET_DEPTH = 9_100
/**
 * Até onde o tiro é ouvido, em tiles — mesma razão e mesma métrica do
 * `BALL_EARSHOT_TILES`, ancorado no alcance do tiro (`PAINTBALL_RANGE`, 8).
 */
const PAINTBALL_EARSHOT_TILES = 10
/**
 * Altura da bolinha em relação ao centro do tile, que é onde o container do
 * personagem fica. Medida nos dois lados que ela precisa casar: o estilingue
 * ocupa y −6,5..+4,8 conforme a pose, e o tronco de quem leva ocupa −6..+3
 * (`PAINT_SPLAT_BOX`). O centro comum é a linha do peito — a única altura em
 * que o tiro sai da arma E chega no corpo do outro.
 */
export const PAINTBALL_MUZZLE_Y = -1

/** Um slice da bola e o estado de CHÃO dele (para onde voltar depois do voo). */
interface BallSlice {
  id: string
  px: number
  py: number
  depth: number
  scaleX: number
  scaleY: number
}

interface BallLayout {
  originX: number
  originY: number
  slices: BallSlice[]
}
/**
 * Faixa do frame LPC (64×64) que sobra visível de quem está no kart: só a
 * cabeça. O resto do corpo é recortado — visto de cima, quem dirige aparece
 * pelo vão do kart, não em pé atrás dele.
 */
const KART_HEAD_CROP_TOP = 8
const KART_HEAD_CROP_HEIGHT = 26
/**
 * Rotação do kart por direção. A textura nasce apontando pra cima (o respingo
 * amarelo é o nariz), então `up` é a identidade e as outras giram a partir dela.
 */
/**
 * A textura do kart nasce apontando para CIMA (o respingo amarelo é o nariz), e
 * o rumo mede a partir da direita — daí o quarto de volta de correção. O mesmo
 * da corrida.
 */
const KART_TEXTURE_OFFSET = Math.PI / 2

const KART_ROTATION_BY_DIR: Record<Direction, number> = {
  up: 0,
  right: Math.PI / 2,
  down: Math.PI,
  left: -Math.PI / 2,
}
/**
 * O cockpit não fica exatamente no pivô visual do veículo. Recuar a cabeça na
 * direção da traseira deixa o piloto sentado (em vez de apoiado no volante);
 * nas vistas laterais ela também sobe um pouco para acompanhar a perspectiva
 * do sprite.
 */
const KART_RIDER_OFFSET_BY_DIR: Record<Direction, { x: number; y: number }> = {
  up: { x: 0, y: 4 },
  right: { x: -4, y: -4 },
  down: { x: 0, y: -4 },
  left: { x: 4, y: -4 },
}
const NEARBY_BUBBLE_VISIBLE_MS = 5000
const NEARBY_BUBBLE_FADE_MS = 900
const NEARBY_BUBBLE_WRAP_WIDTH = 132
const NEARBY_BUBBLE_MAX_WIDTH = 150
const NEARBY_BUBBLE_TOKEN_MAX_UNITS = 18
/** Badge React do nome nasce 48px acima do personagem; o balão precisa começar acima dele. */
export const NEARBY_SPEECH_BUBBLE_START_Y = -82
export const NEARBY_SPEECH_BUBBLE_END_Y = -112
export const NEARBY_THOUGHT_BUBBLE_Y = -82
const REACTION_REST_Y = -70
const REACTION_TRAVEL_PX = 30
const REACTION_HOP_HEIGHT_PX = 8
const REACTION_ENTRY_MS = 350
const REACTION_HOP_HALF_MS = 350
const REACTION_HOP_PAUSE_MS = 120
const REACTION_EXIT_DELAY_MS = 350
const REACTION_EXIT_MS = 500
const HIGH_FIVE_APPROACH_MS = 250
const HIGH_FIVE_POP_MS = 120
const HIGH_FIVE_POP_SCALE = 1.4

function nearbyBubbleText(text: string): string {
  const trimmed = [...text.trim()].slice(0, OFFICE_NEARBY_MESSAGE_MAX_LENGTH).join('')
  if (!trimmed) return ''

  return trimmed
    .split(/(\s+)/)
    .map((part) => {
      if (!part || /\s/.test(part)) return part

      const chars = [...part]
      const chunks: string[] = []
      let current = ''
      let currentUnits = 0

      for (const char of chars) {
        const units = /[A-ZÀ-Ý0-9]/.test(char) ? 1.35 : /[MW@#%&]/.test(char) ? 1.5 : 1
        if (current && currentUnits + units > NEARBY_BUBBLE_TOKEN_MAX_UNITS) {
          chunks.push(current)
          current = ''
          currentUnits = 0
        }
        current += char
        currentUnits += units
      }
      if (current) chunks.push(current)
      if (chunks.length <= 1) return part
      return chunks.join('\n')
    })
    .join('')
}
/** Palma perfeita (#22252): o mesmo pop, exagerado — as mãos se acertaram. */
const HIGH_FIVE_PERFECT_POP_SCALE = 1.9
const HIGH_FIVE_FADE_MS = 200
/** Clarão da palma perfeita: raio inicial, quanto ele cresce e em quanto tempo. */
const PERFECT_CLAP_FLASH_RADIUS = 14
const PERFECT_CLAP_FLASH_SCALE = 3
const PERFECT_CLAP_FLASH_MS = 320
/**
 * Tom de cada estado de zona. Trancada muda de COR, não ganha texto — o mapa
 * não escreve palavra nenhuma (ver o bloco das zonas em `create`).
 */
const ZONE_TINT = {
  open: 0x7de3a0,
  silence: 0xff5d5d,
  /** Trancada nesta sessão: dá pra bater na porta. */
  session: 0xfbbf24,
  /** Trancada no cadastro pelo admin: não há a quem pedir. */
  admin: 0x94a3b8,
} as const
/** Cadeado desenhado no centro da zona trancada. */
const ZONE_LOCK_ICON = '🔒'
const ZONE_LOCK_SIZE = '28px'
/**
 * Espessura do contorno da zona trancada. O estado é dito pela BORDA, não pelo
 * preenchimento: piso claro (a sala de reunião é bege) engole tom translúcido,
 * e subir a opacidade só deixava o mapa chapado. Contorno lê igual sobre
 * qualquer chão.
 */
const ZONE_LOCK_STROKE = 2
const CAMERA_FOCUS_MS = 450
/** Ciclo do atalho R: um quarto de volta no sentido horário por toque. */
const ROTATE_CLOCKWISE: Record<Direction, Direction> = {
  up: 'right',
  right: 'down',
  down: 'left',
  left: 'up',
}
type NearbyBubbleKind = OfficeNearbyMessageKind
/** Altura do personagem na tela (frame LPC de 64px exibido a 1.5 tile). */
const CHARACTER_DISPLAY = 48
/** y local do pé do personagem (borda de baixo do tile é +16; label em +18). */
const CHARACTER_BASE_Y = 16
/**
 * O kart fica no MEIO do tile — é ele que ocupa a célula agora, não o boneco.
 * Ficar no centro também é o que mantém o vão sob a cabeça quando o veículo
 * gira: o eixo de rotação é o centro da imagem.
 */
const KART_OFFSET_Y = 0
/**
 * y do sprite de quem está montado. Em vez de subir o kart até a cabeça (o que
 * jogaria o veículo pra fora do tile), afunda-se o personagem até a faixa
 * recortada da cabeça cair no centro do kart.
 *
 * O sprite é ancorado nos PÉS: sobe `CHARACTER_DISPLAY` até o topo do frame, e
 * daí desce até o meio da faixa da cabeça.
 */
const KART_RIDER_BODY_Y =
  KART_OFFSET_Y +
  CHARACTER_DISPLAY -
  ((KART_HEAD_CROP_TOP + KART_HEAD_CROP_HEIGHT / 2) * CHARACTER_DISPLAY) / CHARACTER_FRAME_SIZE
/**
 * Base de profundidade dos personagens. As camadas de tile usam `layer.zIndex`
 * (piso 0, paredes 10, objetos 20…); os personagens somam a linha (tile y) a
 * esta base para (a) ficarem SEMPRE acima da mobília e (b) manterem o y-sort
 * entre si (quem está mais embaixo na tela desenha na frente).
 */
const CHARACTER_DEPTH_BASE = 1000
const WALK_FRAME_RATE = 10

/**
 * Depth das estampas da sessão de edição: um degrau acima da layer visual mais
 * alta do documento. NÃO pode ser constante — o zIndex vem do documento, e o
 * editor admin renumerava as layers ao reordená-las. O mapa da EMR ficou com
 * `objects` em z=30, e a estampa cravada em 21 nascia POR BAIXO da mobília
 * publicada: a peça nova aparecia embaixo da mesa, sem botão de ordem que
 * resolvesse, porque no documento ela já era a da frente.
 *
 * Marcadores somam um degrau e a seleção, dois — tudo muito abaixo dos
 * personagens (`CHARACTER_DEPTH_BASE`).
 */
export function editStampDepth(document: MapDocumentV1): number {
  let topo = 0
  for (const layer of document.layers) {
    if (layer.type === 'tile') topo = Math.max(topo, layer.zIndex)
  }
  return topo + 1
}

/** zIndex de uma layer do documento (0 quando ela não existe). */
function layerDepth(document: MapDocumentV1, layerKey: string): number {
  return document.layers.find((layer) => layer.key === layerKey)?.zIndex ?? 0
}

/**
 * Nome a exibir para uma zona: sala de chamada com mesa reivindicada mostra
 * "Mesa de <dono>". Lê de `deskOwners` (e não de `desks`) porque o snapshot
 * do construtor envelhece — quem manda é o estado vivo dos eventos de mesa.
 * Delega em `officeZoneDisplayName` (a mesma regra de desempate da MediaBar)
 * montando um `OfficeDeskDTO[]` sintético: só `externalKey` e `claimedBy` são
 * lidos por `claimedDeskInMeetingRoom`, então `id`/`name` podem repetir a
 * `externalKey`.
 *
 * O mapa não escreve mais nome de zona; isto existe para quem PERGUNTA o nome
 * a partir do estado vivo da cena — hoje os testes de reivindicação de mesa,
 * amanhã um card de hover de sala, se ele vier.
 */
export function zoneLabelText(
  document: MapDocumentV1,
  deskOwners: ReadonlyMap<string, string | null>,
  zone: OfficeRuntimeZone,
): string {
  const desks: OfficeDeskDTO[] = Array.from(deskOwners, ([externalKey, ownerName]) => ({
    id: externalKey,
    name: externalKey,
    externalKey,
    claimedBy: ownerName ? { id: externalKey, name: ownerName } : null,
  }))
  return officeZoneDisplayName(document, desks, zone)
}

/** Os campos de que a composição do sprite depende — ver `CharacterView.avatar`. */
type CharacterAvatar = Pick<
  OfficeOccupant,
  'userId' | 'avatarStyle' | 'avatarSeed' | 'avatarOptions' | 'paintMarker'
>

interface CharacterView {
  userId: string
  container: Phaser.GameObjects.Container
  /** Spinner de loading no spawn; vira o personagem LPC (sprite) quando composto. */
  body: Phaser.GameObjects.Image | Phaser.GameObjects.Sprite
  /** Rotação do spinner de loading — parado/limpo em qualquer swap. */
  spinTween?: Phaser.Tweens.Tween
  /** y de repouso do body — o bob volta para cá (spinner: 0; personagem: CHARACTER_BASE_Y). */
  bodyBaseY: number
  hasAvatar: boolean
  /** Key da textura do spritesheet LPC depois que o personagem assumiu. */
  textureKey?: string
  lastDir: Direction
  /**
   * Tile onde o personagem está (ou para onde o passo em curso vai). É daqui
   * que sai "este passo é diagonal?", e não da posição em PIXEL do container:
   * no meio de um tween, ou logo depois de um spawn, o pixel não diz em que
   * tile a pessoa estava.
   */
  tile: TilePosition
  /**
   * Posição em PIXEL, contínua. É ela que manda no desenho desde o movimento
   * livre; `tile` virou derivada dela, e sobrevive porque sala, mesa e alcance
   * continuam sendo conceitos de tile.
   */
  pos: { x: number; y: number }
  bubble?: Phaser.GameObjects.Container
  bubbleTween?: Phaser.Tweens.BaseTween
  bubbleKind?: NearbyBubbleKind
  tween?: Phaser.Tweens.Tween
  bobTween?: Phaser.Tweens.Tween
  /** Anéis discretos acima do personagem enquanto o mic está falando (nome/status vivem no `CharacterOverlay`, fora do canvas). */
  speakingRings?: Phaser.GameObjects.Graphics[]
  speakingTweens?: Phaser.Tweens.Tween[]
  /** Ícone de mão levantada (emoji), visível em QUALQUER lugar do escritório enquanto `raisedHandActive` do hub tiver o userId. */
  handIcon?: Phaser.GameObjects.Text
  /** Kart sob o personagem enquanto ele está montado (#22253). */
  kart?: Phaser.GameObjects.Image
  /**
   * Bits do avatar com que a textura deste personagem foi composta — inclusive
   * o marcador de paintball. A cena não guarda os occupants, e recompor o
   * sprite (equipar a arma, `avatar-updated`) precisa dos OUTROS campos: sem
   * isso, equipar o marcador apagaria o personagem escolhido pela pessoa.
   */
  avatar: CharacterAvatar
  /** Manchas de tinta ativas, por id da marca. */
  paintSplats?: Map<string, Phaser.GameObjects.Image>
}

/** Posiciona a cabeça recortada no cockpit conforme o kart gira. */
function positionKartRider(view: CharacterView): void {
  const offset = KART_RIDER_OFFSET_BY_DIR[view.lastDir]
  view.bodyBaseY = KART_RIDER_BODY_Y + offset.y
  view.body.setX(offset.x)
  view.body.setY(view.bodyBaseY)
}

/** Teclas por direção. Criadas UMA vez no `create` — nunca dentro do `update`. */
type DirectionKeys = Record<Direction, Phaser.Input.Keyboard.Key[]>

/** Centro em pixels do tile (x, y). */
function tileCenter(document: MapDocumentV1, x: number, y: number): { px: number; py: number } {
  return {
    px: x * document.map.tileWidth + document.map.tileWidth / 2,
    py: y * document.map.tileHeight + document.map.tileHeight / 2,
  }
}

// Reexportados: a conversão mora em `lib/screenPosition` desde que a arena
// passou a precisar dela (ver o comentário lá). Os ~10 pontos que importam
// `ScreenPosition`/`computeScreenPosition` daqui continuam valendo.
export type { ScreenPosition }
export { computeScreenPosition }

/**
 * Zoom que a câmera do Phaser recebe pra um dado zoom de UI (`cameraZoom`,
 * o controle em `OfficePage`). O que o controle diz é o que a câmera aplica:
 * a escala é contínua, sem degraus.
 *
 * `coverZoom` é a escala em que o mapa cobre o viewport. Só passa de 1 em
 * mapa MENOR que a tela (aí precisa ampliar pra não sobrar borda); em mapa
 * grande ele é uma fração e não há nada a ampliar — o mapa já cobre. Por
 * isso o 100% do controle vale `max(1, coverZoom)`: pixel nativo no mapa
 * grande, cobertura no mapa pequeno.
 *
 * O piso é o próprio `coverZoom` (não 1): é ele que impede afastar além do
 * ponto em que o mapa deixaria de cobrir a tela. Pisar em 1 aqui era o bug
 * do mapa grande — com `coverZoom` ~0.47 (80x60 tiles a 32px num viewport
 * de ~1200px) TODA a faixa do controle caía abaixo de 1 e virava 1x, e o
 * zoom não saía do lugar.
 *
 * Houve aqui um arredondamento pro inteiro mais próximo, aplicado pouco
 * depois que a interação parava, atrás do `renderRoundPixels` do Phaser
 * (exige `Number.isInteger(zoom)`, ver `Camera.js:preRender`), que tira o
 * tremor da pixel art. Foi removido: como a faixa útil de inteiros é curta
 * (1x, 2x, 3x), a maior parte do controle caía no mesmo degrau e o zoom
 * dava saltos — 130% mostrava 1x e 150% pulava direto pra 2x. Zoom que
 * responde ao que a pessoa pede vale mais que o pixel perfeito fora do 1x.
 */
export function computeAppliedZoom(
  world: { width: number; height: number },
  viewport: { width: number; height: number },
  cameraZoom: number,
): number {
  const coverZoom = Math.max(viewport.width / world.width, viewport.height / world.height)
  return Math.max(coverZoom, Math.max(1, coverZoom) * cameraZoom)
}

/**
 * Menor zoom de UI que ainda muda alguma coisa: o ponto em que o mapa passa
 * a caber inteiro na tela (`coverZoom`), expresso na escala do controle de
 * `OfficePage` — ou seja, dividido pelo que vale o 100% (ver
 * `computeAppliedZoom`).
 *
 * É o limite REAL de afastar, e ele muda com o mapa e com o tamanho da
 * janela: no mapa da EMR (80x60 tiles) dá ~47%, num mapa menor que a tela dá
 * 100% (não há o que afastar). Por isso o controle não pode ter um piso
 * fixo — um número cravado ou corta afastamento que existe, ou deixa o botão
 * aceso clicando em nada.
 */
export function computeMinCameraZoom(
  world: { width: number; height: number },
  viewport: { width: number; height: number },
): number {
  const coverZoom = Math.max(viewport.width / world.width, viewport.height / world.height)
  return Math.min(1, coverZoom)
}

/**
 * O som do high-five é do lugar onde ele acontece: quem está em outra sala ou
 * do outro lado do mapa não deve ouvir. A posição sai do snapshot do bridge —
 * pode estar um tile atrás da predição local, irrelevante para um raio de 3.
 * Sem dado suficiente (ainda sem `youId`, occupant desconhecido), toca: melhor
 * um som a mais do que emudecer o feedback por falta de snapshot.
 *
 * Os três occupants entram em PIXEL (movimento livre) e `isHighFiveAudible`
 * cobra TILE — a conversão é aqui, e não no call site, porque `document` já
 * está em mãos e é ele que traz a régua. Sem ela, o raio de 3 tiles virava um
 * raio de 3 PIXELS: só quem batia a mão ouvia a própria palma.
 */
export function highFiveWithinEarshot(
  document: MapDocumentV1,
  youId: string | null,
  occupantAt: (userId: string) => OfficeOccupant | null,
  userIds: [string, string],
): boolean {
  if (!youId) return true
  const you = occupantAt(youId)
  const [a, b] = userIds.map(occupantAt)
  if (!you || !a || !b) return true
  const toTile = (point: OfficeOccupant) => ({
    x: Math.floor(point.x / document.map.tileWidth),
    y: Math.floor(point.y / document.map.tileHeight),
  })
  return isHighFiveAudible(document, toTile(you), toTile(a), toTile(b))
}

export const KART_TEXTURE = 'office-kart'
/** Confete acima dos personagens (que usam depth ~ y do tile). */
const CONFETTI_DEPTH = 10_000

/**
 * O escritório. Recebe eventos do servidor pelo bridge e emite intenção de
 * movimento de volta. O servidor segue autoritativo — mas o passo do PRÓPRIO
 * personagem é previsto e animado na hora da intenção (`ArenaPredictor`),
 * e o eco `moved`/`sync` do servidor só confirma ou re-ancora. Sem isso, todo
 * passo esperaria um round-trip de WebSocket para aparecer na tela.
 */
export class OfficeScene extends Phaser.Scene {
  private characters = new Map<string, CharacterView>()
  /** Emissor de confete por userId, paralelo a `characters`. */
  private confettiEmitters = new Map<string, Phaser.GameObjects.Particles.ParticleEmitter>()
  private deskPositions = new Map<string, { x: number; y: number }>()
  private deskBounds = new Map<string, { x: number; y: number; width: number; height: number }>()
  private deskReminderGifts = new Map<string, Phaser.GameObjects.Container>()
  private deskReminderPlacement: {
    externalKey: string
    bounds: { x: number; y: number; width: number; height: number }
    onConfirm: (position: { x: number; y: number }) => void
    overlays: Phaser.GameObjects.GameObject[]
    ghost: Phaser.GameObjects.Container
  } | null = null
  private suppressNextPanPointerDown = false
  /** Rótulo de cada zona por id do objeto — permite renomear a sala ao vivo. */
  /** Dono atual de cada mesa (null = livre), espelho vivo de `desks`. */
  private deskOwners = new Map<string, string | null>()
  /** Visuais de decoração (tiles, tile-objects, zonas, links) — rastreados para
   * poder reconstruir o mapa in-place em `applyMap` sem mexer nos personagens. */
  private mapObjects: Phaser.GameObjects.GameObject[] = []
  /**
   * Índice por id dos sprites de `tile-object` publicados desenhados por
   * `renderDecoration`. Existe para que a edição possa ESCONDER uma peça
   * publicada que foi modificada nesta sessão (girada, espelhada) enquanto o
   * preview desenha a versão nova por cima — sem isso o sprite antigo vaza por
   * baixo, já que tiles de mobília têm transparência.
   *
   * É um índice sobre um SUBCONJUNTO de `mapObjects`; os sprites continuam
   * sendo destruídos por `mapObjects` em `applyMap`, e este Map é limpo junto
   * (senão sobram referências a objetos destruídos).
   */
  private publishedObjectImages = new Map<string, Phaser.GameObjects.Image>()
  private youId: string | null = null
  /**
   * Predição e reconciliação do PRÓPRIO personagem — a mesma classe da arena.
   *
   * Substituiu o `MovementPredictor` de grade, que enfileirava passos de tile e
   * os baixava quando o eco `moved` batia. No modelo contínuo o servidor manda
   * posição autoritativa e `seq` processado, e reancorar + reexecutar os
   * pendentes é o mecanismo geral — não um caso especial de recusa.
   */
  private bodyPredictor?: ArenaPredictor<BodyKartState>
  /** Buffer de interpolação dos OUTROS — desenhados ~100ms no passado. */
  private readonly bodyInterpolator = new ArenaInterpolator()
  /** Acumulador da amostragem de input (ver `BODY_INPUT_HZ`). */
  private sinceInput = 0
  /** Direção que a caminhada automática pede — funciona como tecla presa. */
  private autoMove: MoveDirection | null = null
  /**
   * Último quadro desenhado de cada remoto: base do "está andando?", do rumo do
   * kart e da fumaça das rodas.
   *
   * O rumo é PEGAJOSO, como na corrida (`ArenaScene.remoteHeading`):
   * `interpolator.at` só devolve rumo quando as DUAS amostras do intervalo o
   * trazem, e sem guardar o último conhecido o kart saltaria para zero entre
   * pacotes. O último conhecido sai daqui e nunca do `rotation` do sprite —
   * aquele já tem o quarto de volta da textura somado.
   */
  private readonly lastRemoteDraw = new Map<
    string,
    { x: number; y: number; heading?: number; at: number }
  >()
  /** Quem está correndo agora, pelo snapshot — só a animação usa. */
  private readonly remoteSprint = new Set<string>()
  private lastInputAt = 0
  private unsubscribe: (() => void) | null = null
  private keys: DirectionKeys | null = null
  private shiftKey: Phaser.Input.Keyboard.Key | null = null
  private rotateKey: Phaser.Input.Keyboard.Key | null = null
  /** Ctrl/Cmd pressionado agora — WASD ignora teclas enquanto isso for true (ver `create`). */
  private modifierKeyDown = false
  /** Visual de cada sala de chamada, por `externalKey` — o que o cadeado mexe. */
  private zoneVisuals = new Map<
    string,
    { fill: Phaser.GameObjects.Rectangle; centerX: number; centerY: number; lock: Phaser.GameObjects.Text | null }
  >()
  private lockedZones = new Map<string, ZoneLockKind>()
  private cameraZoom = 1
  private minCameraZoomListener: ((minZoom: number) => void) | null = null
  private lastMinCameraZoom: number | null = null
  private inputLocked = false
  /** Quando true, reações (`kind: reaction`) são desenhadas pelo overlay HTML da grade, não pelo canvas. */
  private floatingReactionsActive = false
  /** True enquanto F está fisicamente segurado — dedupe do keydown/keyup. */
  private confettiKeyHeld = false
  private focusUserId: string | null = null
  /**
   * `null` = ainda ninguém focado (recém-criada). Um userId = já seguindo
   * esse personagem. `CAMERA_DETACHED` = câmera solta por um arraste manual
   * (ver `handlePanPointerDown`) — reengata suavemente (pan animado, não um
   * salto) no próximo passo do personagem focado, ver `applyCameraFocus`.
   */
  private focusedCameraUserId: string | null = null
  private static readonly CAMERA_DETACHED = '::camera-detached::'
  private focusTimer: Phaser.Time.TimerEvent | null = null
  private readonly handleScaleResize = () => this.applyCameraZoom()
  /** Camada de edição imperativa (Task C3): liga/desliga via `setEditing`. */
  private editing = false
  /** Arrastar com o botão esquerdo sobre o fundo do mapa move a câmera (estilo Gather). */
  private panGesture: { pointerX: number; pointerY: number; scrollX: number; scrollY: number } | null = null
  /**
   * Estampas pendentes de mobília desta sessão, indexadas por ID DO OBJETO —
   * não por célula. É o que permite empilhar: várias peças na mesma célula
   * coexistem porque cada uma tem sua própria chave. (`editImages`, indexado
   * por célula, continua servindo aos tiles legados da borracha.)
   */
  private editObjectImages = new Map<string, Phaser.GameObjects.Image>()
  /** Marcas vermelhas de mobília JÁ PUBLICADA removida nesta sessão, por id. */
  private editObjectEraseMarkers = new Map<string, Phaser.GameObjects.Rectangle>()
  /** Ids de mobília publicada escondida nesta sessão (arraste/borracha) — restaurados no Cancelar. */
  private hiddenPublishedIds = new Set<string>()
  private editImages = new Map<string, Phaser.GameObjects.Image>()
  /** Contorno verde nas células estampadas nesta sessão (edição pendente, não-salva). */
  private editMarkers = new Map<string, Phaser.GameObjects.Rectangle>()
  /** Marca vermelha nas células com remoção pendente (borracha, ainda não-salva). */
  private eraseMarkers = new Map<string, Phaser.GameObjects.Rectangle>()
  private zonePreview: Phaser.GameObjects.Rectangle | null = null
  private selectionOverlay: Phaser.GameObjects.Rectangle | null = null
  /** Retângulo (px) da seleção ativa, guardado para sobreviver a um redesenho (ver `applyMap`). */
  private selectionRect: { x: number; y: number; width: number; height: number } | null = null
  /**
   * Carregamentos de asset builtin em voo, por `assetId` (review re-review —
   * Critical A parte 2). Uma pincelada arrastada dispara N chamadas
   * concorrentes a `registerBuiltinAsset` para o MESMO asset antes da
   * primeira textura terminar de carregar; sem dedup, cada uma dispara seu
   * próprio `this.load.image` + `load.start()` para a mesma chave. Guardar a
   * promise em voo e devolvê-la às chamadas seguintes garante que todas
   * resolvam quando o único load real terminar.
   */
  private pendingBuiltinAssetLoads = new Map<string, Promise<void>>()
  private editCallbacks: {
    onTilePaint?: (col: number, row: number) => void
    onTileErase?: (col: number, row: number) => void
    onRectEnd?: (rect: { x: number; y: number; width: number; height: number }) => void
    onPointPlace?: (cell: { col: number; row: number }) => void
    onStrokeStart?: () => void
    /** Modo `'object'`: down/move/up em PIXELS do mundo (mobília livre + borracha por objeto). */
    onObjectPointerDown?: (x: number, y: number) => void
    onObjectPointerMove?: (x: number, y: number, isDown: boolean) => void
    onObjectPointerUp?: () => void
  } = {}
  /**
   * Modo de edição: `'paint'` pinta/apaga células no down/move (C3, repete
   * enquanto o botão fica pressionado — drag painting); `'rect'` desenha um
   * retângulo por drag (C5); `'point'` (bugfix) coloca UMA VEZ por clique, só
   * no down — ferramentas de ponto (`link`/`action-point`/`door`) não podem
   * repetir no move, senão jitter durante o clique dispara `onPointPlace`
   * mais de uma vez (ex.: empilha `window.prompt` e insere objetos duplicados);
   * `'object'` opera em pixels do mundo (mobília livre: arrastar/soltar; borracha
   * por objeto: hover realça, clique apaga) — sem grade.
   */
  private editMode: 'paint' | 'rect' | 'point' | 'object' = 'paint'
  /** Realce de hover da borracha por objeto (modo `'object'`) — recriado a cada move, limpo no null. */
  private eraseHover: Phaser.GameObjects.Rectangle | null = null
  /**
   * Preview de colocação (modo `'object'`, pincel): sprite esmaecido do asset
   * selecionado seguindo o cursor, para o usuário ver onde a peça vai cair. O
   * hook define o sprite (`setPlacementPreview`); a cena o posiciona a cada move.
   */
  private placementPreview: {
    groupWidth: number
    groupHeight: number
    tileWidth: number
    tileHeight: number
    slices: { textureKey: string; frameKey: string; dx: number; dy: number }[]
  } | null = null
  private placementGhosts: Phaser.GameObjects.Image[] = []
  /** Cor do preview do retângulo (verde p/ áreas, vermelho p/ borracha). */
  private rectPreviewColor = 0x7de3a0
  /** Célula onde o drag do retângulo começou — `null` fora de um drag em andamento. */
  private rectStartCell: { col: number; row: number } | null = null
  /** Overlays persistentes de área já commitada nesta sessão de edição (Task C5) — limpos em `setEditing(false)`/DESTROY. */
  /** Quem está montado no kart (#22253) — dirige velocidade do passo e visual. */
  private ridingUserIds = new Set<string>()
  /** Posição/ocupação autoritativa de cada kart publicado no mapa. */
  private kartStates = new Map<string, OfficeKart>()
  /** Posição autoritativa de cada bola publicada — espelha o hub. */
  private ballStates = new Map<string, OfficeBall>()
  /**
   * Quanto tempo de voo cada bola no ar teve NO CHUTE, e que altura ele merece.
   *
   * O estado da bola só carrega o tempo RESTANTE; para desenhar o arco é
   * preciso saber de quanto ele partiu — sem o total não há progresso, e sem
   * progresso não há meia-senóide.
   */
  private ballFlights = new Map<string, { totalMs: number; lift: number }>()
  /** Quando cada roda soltou a última nuvem — a cadência é por RODA, não por kart. */
  private lastSmokeAt = new Map<string, number>()
  /**
   * Tweens de rolagem em andamento por bola — uma LISTA, um por slice. Guardar
   * só o último deixava os outros três da bola de pilates correndo soltos
   * quando um chute novo chegava: a peça se partia na tela, cada pedaço indo
   * para um lugar.
   */
  /** Cache de `ballLayout()`, invalidado pela identidade de `document.objects`. */
  private ballLayoutObjects: MapDocumentV1['objects'] | null = null
  private ballLayoutCache: Map<string, BallLayout> | null = null
  private editZoneOverlays = new Map<string, Phaser.GameObjects.Rectangle>()
  /**
   * Overlays das áreas JÁ PUBLICADAS, desenhados ao entrar na Decoração. Mapa
   * separado de `editZoneOverlays` de propósito: a borracha distingue "área que
   * eu acabei de desenhar" (some na hora) de "área publicada" (vira marca
   * vermelha de remoção pendente), e essa decisão é justamente a presença da id
   * em `editZoneOverlays`.
   */
  private publishedAreaOverlays = new Map<string, Phaser.GameObjects.Rectangle>()
  /** Marca vermelha sobre áreas publicadas com remoção pendente (borracha). */
  private areaEraseMarkers = new Map<string, Phaser.GameObjects.Rectangle>()
  private readonly handleConfettiDown = () => this.emitConfetti(true)
  private readonly handleConfettiUp = () => this.emitConfetti(false)
  private readonly handleBlur = () => this.emitConfetti(false)
  private readonly handleRotateDown = () => this.rotateLocal()

  /**
   * Desliga o teclado da cena (WASD/F/R + preventDefault) enquanto um campo de
   * texto está focado — senão o Phaser captura e dá `preventDefault` nas teclas,
   * e o input (ex.: busca de assets no drawer) nunca recebe o que se digita.
   * `disableGlobalCapture` remove o preventDefault; `enabled=false` impede o
   * personagem de andar enquanto se digita.
   */
  private readonly syncKeyboardFocus = () => {
    const keyboard = this.input?.keyboard;
    if (!keyboard) return;
    const el = document.activeElement as HTMLElement | null;
    const typing =
      !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
    keyboard.enabled = !typing;
    if (typing) keyboard.disableGlobalCapture();
    else keyboard.enableGlobalCapture();
  };
  // O `activeElement` só reflete o novo foco DEPOIS do evento — daí o microtask.
  private readonly handleFocusEvent = () => queueMicrotask(this.syncKeyboardFocus);

  constructor(
    private readonly bridge: OfficeBridge,
    private document: MapDocumentV1,
    private assets: readonly OfficeMapAssetDTO[],
    private readonly desks: readonly OfficeDeskDTO[],
    private deskReminders: readonly OfficeDeskReminderSummaryDTO[],
  ) {
    super('office')
    // Precisa do document real (não um valor de campo declarado antes do
    // parâmetro do construtor) — daí a atribuição aqui em vez de inicializar
    // `predictor` já na declaração do campo.
    // Getter, não cópia: a predição lê o estado autoritativo dos karts no
    // momento do passo, sem um ponto de sincronização que dá pra esquecer de
    // chamar quando o hub manda `kart-ride`/`karts-updated`.
  }

  /**
   * Quais salas aparecem trancadas no mapa, por `externalKey`. Quem calcula é
   * o React (`lockedZonesByExternalKey`), que tem as duas fontes: a lista viva
   * de `room-lock-changed` e o `status` do cadastro.
   *
   * Vale pra TODO MUNDO, inclusive quem está do outro lado do escritório — é
   * o ponto da feature: hoje a tranca só se revela quando a pessoa esbarra
   * nela e o servidor recusa o passo.
   */
  setLockedZones(zones: ReadonlyMap<string, ZoneLockKind>): void {
    this.lockedZones = new Map(zones)
    if (this.zoneVisuals.size > 0) this.applyZoneLocks()
  }

  private applyZoneLocks(): void {
    for (const [externalKey, visual] of this.zoneVisuals) {
      const kind = this.lockedZones.get(externalKey) ?? null
      visual.fill.setFillStyle(kind ? ZONE_TINT[kind] : ZONE_TINT.open, 0.1)
      if (kind) visual.fill.setStrokeStyle(ZONE_LOCK_STROKE, ZONE_TINT[kind], 0.95)
      else visual.fill.setStrokeStyle()
      if (!kind) {
        visual.lock?.destroy()
        visual.lock = null
        continue
      }
      if (!visual.lock) {
        visual.lock = this.add
          .text(visual.centerX, visual.centerY, ZONE_LOCK_ICON, {
            fontSize: ZONE_LOCK_SIZE,
            resolution: 2,
            // Contorno escuro: o selo é o sinal principal e precisa se
            // descolar de qualquer piso, do bege da sala ao cinza da praça.
            stroke: '#020617',
            strokeThickness: 3,
          })
          .setOrigin(0.5)
          // Acima da mobília (21/22) e dos marcadores de mesa (139), abaixo
          // dos personagens (1000+): o cadeado é do mapa, não de quem anda.
          .setDepth(140)
        this.mapObjects.push(visual.lock)
      }
      // Tranca do admin é sem esperança — o cadeado fica apagado pra não
      // convidar a bater na porta.
      visual.lock.setAlpha(kind === 'admin' ? 0.5 : 1)
    }
  }

  setCameraZoom(zoom: number): void {
    this.cameraZoom = zoom
    this.applyCameraZoom()
  }

  /**
   * Avisa o React qual é o menor zoom que ainda afasta de verdade (ver
   * `computeMinCameraZoom`). Quem escuta é o controle de zoom em
   * `OfficePage`, que sem isso teria que repetir aqui a conta do viewport.
   * Reemitido a cada `applyCameraZoom`, que é por onde passa também o
   * redimensionamento da janela (`handleScaleResize`) — é ele que muda o
   * mínimo depois do boot.
   */
  setMinCameraZoomListener(listener: ((minZoom: number) => void) | null): void {
    this.minCameraZoomListener = listener
    if (listener && this.lastMinCameraZoom !== null) listener(this.lastMinCameraZoom)
  }

  private emitMinCameraZoom(minZoom: number): void {
    if (minZoom === this.lastMinCameraZoom) return
    this.lastMinCameraZoom = minZoom
    this.minCameraZoomListener?.(minZoom)
  }

  setDeskReminders(reminders: readonly OfficeDeskReminderSummaryDTO[]): void {
    this.deskReminders = reminders
    if (this.scene.isActive()) this.renderDeskReminderGifts()
  }

  startDeskReminderPlacement(externalKey: string, onConfirm: (position: { x: number; y: number }) => void): boolean {
    const bounds = this.deskBounds.get(externalKey)
    if (!bounds) return false
    this.cancelDeskReminderPlacement()
    this.panGesture = null
    const mapWidth = this.document.map.width * this.document.map.tileWidth
    const mapHeight = this.document.map.height * this.document.map.tileHeight
    const depth = 19_000
    const overlays: Phaser.GameObjects.GameObject[] = []
    const addDim = (x: number, y: number, width: number, height: number) => {
      if (width <= 0 || height <= 0) return
      const dim = this.add.rectangle(x + width / 2, y + height / 2, width, height, 0x020617, 0.58)
      dim.setDepth(depth)
      overlays.push(dim)
    }
    addDim(0, 0, mapWidth, bounds.y)
    addDim(0, bounds.y + bounds.height, mapWidth, mapHeight - bounds.y - bounds.height)
    addDim(0, bounds.y, bounds.x, bounds.height)
    addDim(bounds.x + bounds.width, bounds.y, mapWidth - bounds.x - bounds.width, bounds.height)
    const highlight = this.add.rectangle(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, bounds.width, bounds.height, 0xfff7bf, 0.12)
    highlight.setStrokeStyle(2, 0xf59e0b, 0.95)
    highlight.setDepth(depth + 1)
    overlays.push(highlight)
    const ghost = this.createDeskReminderGift(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    ghost.setAlpha(0.92)
    ghost.setDepth(depth + 2)
    this.deskReminderPlacement = { externalKey, bounds, onConfirm, overlays, ghost }
    return true
  }

  cancelDeskReminderPlacement(): void {
    const placement = this.deskReminderPlacement
    if (!placement) return
    for (const overlay of placement.overlays) overlay.destroy()
    placement.ghost.destroy()
    this.deskReminderPlacement = null
  }

  /**
   * Como `setCameraZoom`, mas ancorado num ponto de tela (o cursor do mouse
   * na roda do zoom) — o ponto do mundo sob `screenX/screenY` fica no mesmo
   * lugar antes/depois, em vez do zoom "puxar" a câmera pro canto/centro do
   * mapa. Mesma técnica do editor (`MapCanvas.tsx` `handleWheel`).
   *
   * Também solta o acompanhamento (como um arraste, ver `handlePanPointerDown`)
   * — senão o `startFollow` corrige o scroll de volta pro personagem a cada
   * frame seguinte, e o ponto sob o cursor deriva mesmo com a matemática do
   * ancoramento certa.
   */
  setCameraZoomAt(zoom: number, screenX: number, screenY: number): void {
    const camera = this.cameras.main
    camera.stopFollow()
    this.focusedCameraUserId = OfficeScene.CAMERA_DETACHED
    const before = camera.getWorldPoint(screenX, screenY)
    this.cameraZoom = zoom
    this.applyCameraZoom()
    camera.preRender()
    const after = camera.getWorldPoint(screenX, screenY)
    camera.scrollX += before.x - after.x
    camera.scrollY += before.y - after.y
  }

  /**
   * Posição de tela do personagem `userId` agora — usada pra posicionar o
   * balão de vídeo (elemento DOM) por cima do canvas. `null` se o
   * personagem não existe ou está fora do viewport atual.
   */
  getScreenPosition(userId: string): ScreenPosition | null {
    const view = this.characters.get(userId)
    if (!view) return null
    const cam = this.cameras.main
    // `cam.worldView.x/y` — NÃO `cam.scrollX/scrollY` — é a origem que
    // corresponde ao que é de fato renderizado na tela. Com uma câmera
    // limitada por bounds (`setBounds` + `startFollow`, nosso caso), o
    // Phaser clampa a área efetivamente visível em `worldView`, mas
    // `scrollX/scrollY` podem ficar com o valor "não clampado" do alvo do
    // follow (ex.: personagem perto da borda do mapa pede um scroll que
    // extrapolaria os bounds). Usar scrollX/scrollY nesse caso descola o
    // balão do personagem por exatamente essa diferença — confirmado
    // manualmente comparando as duas origens contra a posição real na tela.
    return computeScreenPosition(
      view.container.x,
      view.container.y,
      { scrollX: cam.worldView.x, scrollY: cam.worldView.y, zoom: cam.zoom },
      { width: this.scale.width, height: this.scale.height },
    )
  }

  /**
   * Posição de tela de um ponto do MUNDO — usada para ancorar UI React (a
   * barra de ações da seleção) sobre um ponto do mapa. Mesma conversão de
   * `getScreenPosition`, sem depender de um personagem. `null` quando o ponto
   * está fora do viewport: a barra some junto.
   */
  worldToScreen(x: number, y: number): ScreenPosition | null {
    const cam = this.cameras.main
    return computeScreenPosition(
      x,
      y,
      { scrollX: cam.worldView.x, scrollY: cam.worldView.y, zoom: cam.zoom },
      { width: this.scale.width, height: this.scale.height },
    )
  }

  /** Registra o dono de uma mesa ao vivo — chamado pelo handler de WS em `handle`. */
  private setDeskClaim(externalKey: string, ownerName: string | null): void {
    // Só registra: o mapa não escreve nome de mesa nem de sala, então não há
    // texto a reescrever aqui. O nome segue alimentando quem lê `deskOwners`
    // — a MediaBar ("Você está em: Mesa de Fulano") e o painel de pessoas da
    // sala, via `zoneLabelText`/`officeZoneDisplayName`.
    this.deskOwners.set(externalKey, ownerName)
  }

  /**
   * Posição de tela da mesa `externalKey` agora — usada pra posicionar o
   * card de hover (elemento DOM) por cima do canvas. `null` se a mesa não
   * existe ou está fora do viewport atual. Mesas são estáticas (não têm
   * container animado como personagens), daí ler direto de `deskPositions`.
   */
  getDeskScreenPosition(externalKey: string): ScreenPosition | null {
    const position = this.deskPositions.get(externalKey)
    if (!position) return null
    const cam = this.cameras.main
    return computeScreenPosition(
      position.x,
      position.y,
      { scrollX: cam.worldView.x, scrollY: cam.worldView.y, zoom: cam.zoom },
      { width: this.scale.width, height: this.scale.height },
    )
  }

  setInputLocked(locked: boolean): void {
    this.inputLocked = locked
    if (locked) {
      this.releaseDirectionKeys()
      this.emitConfetti(false)
    }
  }

  setFloatingReactionsActive(active: boolean): void {
    this.floatingReactionsActive = active
  }

  /**
   * Início/fim de "segurar F" — uma mensagem por transição física (dedupe via
   * `confettiKeyHeld`). Travado por `inputLocked` (chat aberto etc.) pra não
   * disparar sem querer. O servidor rebroadcasta pra todos, inclusive de volta
   * pra você (sem predição local).
   */
  private emitConfetti(active: boolean): void {
    if (active && this.inputLocked) return
    if (active === this.confettiKeyHeld) return
    this.confettiKeyHeld = active
    this.bridge.emitClientMessage({ type: 'confetti', active })
  }

  setFocusUser(userId: string | null): void {
    this.focusUserId = userId
    this.applyCameraFocus()
  }

  /**
   * Liga/desliga a edição do mapa (Task C3). Reaproveita `setInputLocked`
   * para travar o movimento do personagem, e liga/desliga os handlers de
   * ponteiro que traduzem clique/arraste em célula pintada/apagada (modo
   * `'paint'`) ou em retângulo de área (modo `'rect'`, Task C5 — ver
   * `setEditMode`). A UI React (C4) é dona do documento — esta cena só
   * desenha por cima via `applyTileStamp`/`setZonePreview`/`addEditZoneOverlay`,
   * nunca troca a prop `document`.
   */
  setEditing(
    enabled: boolean,
    callbacks: {
      onTilePaint?: (col: number, row: number) => void
      onTileErase?: (col: number, row: number) => void
      onRectEnd?: (rect: { x: number; y: number; width: number; height: number }) => void
      onPointPlace?: (cell: { col: number; row: number }) => void
      /** Início de uma pincelada (só o pointerdown, não o move) — ver `editPointerDown`. */
      onStrokeStart?: () => void
      onObjectPointerDown?: (x: number, y: number) => void
      onObjectPointerMove?: (x: number, y: number, isDown: boolean) => void
      onObjectPointerUp?: () => void
    } = {},
  ): void {
    this.editing = enabled
    this.editCallbacks = callbacks
    this.setInputLocked(enabled)
    if (enabled) {
      this.input.on('pointerdown', this.handleEditPointerDown, this)
      this.input.on('pointermove', this.handleEditPointerMove, this)
      this.input.on('pointerup', this.handleEditPointerUp, this)
    } else {
      this.input.off('pointerdown', this.handleEditPointerDown, this)
      this.input.off('pointermove', this.handleEditPointerMove, this)
      this.input.off('pointerup', this.handleEditPointerUp, this)
      this.setZonePreview(null)
      this.setEraseHover(null)
      this.setPlacementPreview(null)
      this.rectStartCell = null
      // As áreas publicadas só existem enquanto a Decoração está aberta — fora
      // dela o mapa é o mapa, sem retângulo de edição por cima.
      this.clearPublishedAreaOverlays()
    }
    this.refreshKartVisuals()
    this.refreshBallVisuals()
  }

  /**
   * Descarta as estampas e áreas locais **não-salvas** desta sessão — usado no
   * Cancelar, onde não há remonte da cena. No Salvar NÃO chamamos isto: o
   * `map-decor-updated` faz o refetch e a cena remonta com o documento
   * publicado, redesenhando tudo (sem piscar).
   */
  discardLocalEdits(): void {
    this.editImages.forEach((image) => image.destroy())
    this.editImages.clear()
    this.editMarkers.forEach((marker) => marker.destroy())
    this.editMarkers.clear()
    this.eraseMarkers.forEach((marker) => marker.destroy())
    this.eraseMarkers.clear()
    this.editObjectImages.forEach((image) => image.destroy())
    this.editObjectImages.clear()
    this.editObjectEraseMarkers.forEach((marker) => marker.destroy())
    this.editObjectEraseMarkers.clear()
    this.areaEraseMarkers.forEach((marker) => marker.destroy())
    this.areaEraseMarkers.clear()
    this.restoreHiddenPublishedObjects()
    this.clearEditZoneOverlays()
    this.setZonePreview(null)
    this.setEraseHover(null)
    this.setSelectionOverlay(null)
  }

  /** Modo de edição — chamado pelo hook (C4) sempre que a ferramenta selecionada muda. */
  setEditMode(mode: 'paint' | 'rect' | 'point' | 'object'): void {
    this.editMode = mode
    this.rectStartCell = null
    this.setZonePreview(null)
    this.setEraseHover(null)
    // Fora do modo `'object'` não há colocação de mobília — some o fantasma.
    if (mode !== 'object') this.setPlacementPreview(null)
  }

  private pointerToCell(pointer: Phaser.Input.Pointer): { col: number; row: number } {
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
    return {
      col: Math.floor(world.x / this.document.map.tileWidth),
      row: Math.floor(world.y / this.document.map.tileHeight),
    }
  }

  private clampCell(cell: { col: number; row: number }): { col: number; row: number } {
    return {
      col: Math.min(Math.max(cell.col, 0), this.document.map.width - 1),
      row: Math.min(Math.max(cell.row, 0), this.document.map.height - 1),
    }
  }

  /**
   * Clique direito no mapa: anda até o tile clicado, no mesmo espírito do
   * atalho Ctrl/Cmd+D (andar até a mesa) — a validação de tile
   * caminhável/alcançável é feita pelo pathfinder no React (useOfficeInteractions),
   * aqui só converte a posição da tela pro tile e repassa pro bridge.
   */
  private handleMapRightClick(pointer: Phaser.Input.Pointer): void {
    if (this.deskReminderPlacement || this.editing || !pointer.rightButtonDown()) return
    const { col, row } = this.pointerToCell(pointer)
    if (col < 0 || row < 0 || col >= this.document.map.width || row >= this.document.map.height) return
    this.bridge.emitMapRightClick({ x: col, y: row })
  }

  /**
   * Botão esquerdo pressionado sobre o fundo do mapa inicia um arraste de
   * câmera (estilo Gather) — não interfere no clique de mesa (que já reage no
   * próprio `pointerdown` do marcador, antes de qualquer arraste) nem na
   * edição de decoração (que usa o botão esquerdo para pintar/apagar mobília).
   */
  private handlePanPointerDown(pointer: Phaser.Input.Pointer): void {
    if (this.suppressNextPanPointerDown) {
      this.suppressNextPanPointerDown = false
      return
    }
    if (this.deskReminderPlacement || this.editing || !pointer.leftButtonDown()) return
    const camera = this.cameras.main
    // A câmera normalmente segue o personagem focado (`applyCameraFocus`) —
    // arrastar solta esse acompanhamento pra mover livremente e ficar onde a
    // pessoa deixou (a cena nunca usa `setBounds`, então não há clamp pra
    // desfazer). Volta sozinho, com uma transição suave (não um salto), no
    // próximo passo do personagem focado — ver `CAMERA_DETACHED` e `step`.
    camera.stopFollow()
    this.focusedCameraUserId = OfficeScene.CAMERA_DETACHED
    this.panGesture = { pointerX: pointer.x, pointerY: pointer.y, scrollX: camera.scrollX, scrollY: camera.scrollY }
  }

  private handlePanPointerMove(pointer: Phaser.Input.Pointer): void {
    if (this.deskReminderPlacement) return
    if (!this.panGesture) return
    if (!pointer.isDown) {
      this.panGesture = null
      return
    }
    const camera = this.cameras.main
    camera.scrollX = this.panGesture.scrollX - (pointer.x - this.panGesture.pointerX) / camera.zoom
    camera.scrollY = this.panGesture.scrollY - (pointer.y - this.panGesture.pointerY) / camera.zoom
  }

  private handlePanPointerUp(): void {
    this.panGesture = null
  }

  private handleDeskReminderPlacementPointerMove(pointer: Phaser.Input.Pointer): void {
    const placement = this.deskReminderPlacement
    if (!placement) return
    const position = this.clampDeskReminderPlacementPointer(pointer, placement.bounds)
    placement.ghost.setPosition(position.x, position.y)
  }

  private handleDeskReminderPlacementPointerDown(pointer: Phaser.Input.Pointer): void {
    const placement = this.deskReminderPlacement
    if (!placement || !pointer.leftButtonDown()) return
    const position = this.clampDeskReminderPlacementPointer(pointer, placement.bounds)
    const normalized = {
      x: (position.x - placement.bounds.x) / placement.bounds.width,
      y: (position.y - placement.bounds.y) / placement.bounds.height,
    }
    const onConfirm = placement.onConfirm
    this.suppressNextPanPointerDown = true
    this.cancelDeskReminderPlacement()
    onConfirm(normalized)
  }

  private clampDeskReminderPlacementPointer(
    pointer: Phaser.Input.Pointer,
    bounds: { x: number; y: number; width: number; height: number },
  ): { x: number; y: number } {
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
    return {
      x: Phaser.Math.Clamp(world.x, bounds.x, bounds.x + bounds.width),
      y: Phaser.Math.Clamp(world.y, bounds.y, bounds.y + bounds.height),
    }
  }

  /** Converte duas células (início/fim do drag) no retângulo em pixels que as cobre por inteiro. */
  private rectFromCells(
    a: { col: number; row: number },
    b: { col: number; row: number },
  ): { x: number; y: number; width: number; height: number } {
    const minCol = Math.min(a.col, b.col)
    const minRow = Math.min(a.row, b.row)
    const maxCol = Math.max(a.col, b.col)
    const maxRow = Math.max(a.row, b.row)
    const tileWidth = this.document.map.tileWidth
    const tileHeight = this.document.map.tileHeight
    return {
      x: minCol * tileWidth,
      y: minRow * tileHeight,
      width: (maxCol - minCol + 1) * tileWidth,
      height: (maxRow - minRow + 1) * tileHeight,
    }
  }

  private handleEditPointerDown(pointer: Phaser.Input.Pointer): void {
    // Handler do Phaser: recebe args extras (gameObjects) que NÃO podem virar
    // o flag de início de traço — por isso o despacho explícito aqui.
    this.editPointerDown(pointer, true)
  }

  /**
   * Corpo do pointerdown de edição. `strokeStart` distingue o clique inicial da
   * repetição vinda do pointermove (drag painting): só o primeiro emite
   * `onStrokeStart`, que é o que agrupa a pincelada inteira num único passo de
   * desfazer (senão cada célula pintada viraria um Ctrl+Z).
   */
  private editPointerDown(pointer: Phaser.Input.Pointer, strokeStart: boolean): void {
    if (!this.editing) return
    if (this.editMode === 'object') {
      // Mobília livre / borracha por objeto operam em pixels do mundo — sem
      // grade nem rejeição por célula (o hook clampeia aos limites do mapa).
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
      this.editCallbacks.onObjectPointerDown?.(world.x, world.y)
      return
    }
    const { col, row } = this.pointerToCell(pointer)
    if (col < 0 || row < 0 || col >= this.document.map.width || row >= this.document.map.height) return
    if (this.editMode === 'rect') {
      this.rectStartCell = { col, row }
      this.setZonePreview(this.rectFromCells(this.rectStartCell, this.rectStartCell))
      return
    }
    if (this.editMode === 'point') {
      // Single-shot: só no down, nunca repete no move (ver comentário em `editMode`).
      this.editCallbacks.onPointPlace?.({ col, row })
      return
    }
    if (strokeStart) this.editCallbacks.onStrokeStart?.()
    if (pointer.rightButtonDown()) this.editCallbacks.onTileErase?.(col, row)
    else this.editCallbacks.onTilePaint?.(col, row)
  }

  private handleEditPointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.editing) return
    if (this.editMode === 'object') {
      // Move SEM exigir botão pressionado: a borracha por objeto precisa do
      // hover (realce) mesmo com o mouse solto; o arraste da mobília usa o
      // `isDown` para saber se está agarrando.
      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y)
      if (this.placementPreview) this.updatePlacementGhost(world.x, world.y)
      this.editCallbacks.onObjectPointerMove?.(world.x, world.y, pointer.isDown)
      return
    }
    if (!pointer.isDown) return
    if (this.editMode === 'rect') {
      if (!this.rectStartCell) return
      const current = this.clampCell(this.pointerToCell(pointer))
      this.setZonePreview(this.rectFromCells(this.rectStartCell, current))
      return
    }
    if (this.editMode === 'point') return
    this.editPointerDown(pointer, false)
  }

  private handleEditPointerUp(pointer: Phaser.Input.Pointer): void {
    if (!this.editing) return
    if (this.editMode === 'object') {
      this.editCallbacks.onObjectPointerUp?.()
      return
    }
    if (this.editMode !== 'rect' || !this.rectStartCell) return
    const current = this.clampCell(this.pointerToCell(pointer))
    const rect = this.rectFromCells(this.rectStartCell, current)
    this.rectStartCell = null
    this.setZonePreview(null)
    this.editCallbacks.onRectEnd?.(rect)
  }

  /**
   * Carrega em runtime uma textura de asset builtin ainda não pré-carregada
   * em `preload()` (ex.: catálogo de tiles builtin não usado no documento
   * atual, mas disponível pra edição). No-op se a textura já existe.
   */
  async registerBuiltinAsset(assetId: string, url: string): Promise<void> {
    const key = `office-map-asset-${assetId}`
    if (this.textures.exists(key)) return
    // Dedup por assetId: devolve o load já em voo em vez de enfileirar outro
    // `this.load.image` para a mesma textura (ver comentário do campo).
    const pending = this.pendingBuiltinAssetLoads.get(assetId)
    if (pending) return pending
    const promise = new Promise<void>((resolve) => {
      this.load.image(key, url)
      this.load.once(Phaser.Loader.Events.COMPLETE, () => resolve())
      this.load.start()
    }).finally(() => {
      this.pendingBuiltinAssetLoads.delete(assetId)
    })
    this.pendingBuiltinAssetLoads.set(assetId, promise)
    await promise
  }

  /**
   * Registra (lazy) o frame de um tile do atlas na textura do asset, espelhando
   * exatamente o registro feito em `create()` (L203-209/L227-233) — mesma
   * lógica `texture.add(frame.key, 0, frame.x, frame.y, frame.width, frame.height)`,
   * idempotente via `texture.has`. Retorna `null` se o tileset/índice for
   * inválido ou a textura do asset ainda não estiver carregada (chame
   * `registerBuiltinAsset` antes, se for um asset builtin sob demanda).
   */
  registerTileFrame(
    tileset: MapDocumentV1['tilesets'][number],
    tileIndex: number,
  ): { textureKey: string; frameKey: string } | null {
    const frame = officeMapTileFrame(tileset, tileIndex)
    if (!frame) return null
    const textureKey = `office-map-asset-${tileset.assetId}`
    if (!this.textures.exists(textureKey)) return null
    const texture = this.textures.get(textureKey)
    if (!texture.has(frame.key)) {
      texture.add(frame.key, 0, frame.x, frame.y, frame.width, frame.height)
    }
    return { textureKey, frameKey: frame.key }
  }

  /**
   * Estampa (ou apaga, com `frameKey: null`) a imagem de edição de uma
   * célula. `textureKey`/`frameKey` já devem estar registrados (ver
   * `registerTileFrame`/`registerBuiltinAsset`) — esta camada só desenha por
   * cima do mapa renderizado em `create()`, sem tocar no documento.
   */
  applyTileStamp(layerKey: string, col: number, row: number, textureKey: string, frameKey: string | null): void {
    const index = row * this.document.map.width + col
    const mapKey = `${layerKey}:${index}`
    const existing = this.editImages.get(mapKey)
    if (existing) {
      existing.destroy()
      this.editImages.delete(mapKey)
    }
    const existingMarker = this.editMarkers.get(mapKey)
    if (existingMarker) {
      existingMarker.destroy()
      this.editMarkers.delete(mapKey)
    }
    // Pintar por cima cancela uma remoção pendente naquela célula.
    const existingErase = this.eraseMarkers.get(mapKey)
    if (existingErase) {
      existingErase.destroy()
      this.eraseMarkers.delete(mapKey)
    }
    if (!frameKey) return
    const { px, py } = tileCenter(this.document, col, row)
    const image = this.add
      .image(px, py, textureKey, frameKey)
      .setDisplaySize(this.document.map.tileWidth, this.document.map.tileHeight)
      // Piso pintado fica logo acima do próprio piso, e não acima de tudo:
      // senão a estampa cobriria as paredes por onde ela passa.
      .setDepth(layerKey === 'floor' ? layerDepth(this.document, 'floor') + 1 : editStampDepth(this.document))
    this.editImages.set(mapKey, image)
    // Marcação de edição pendente (contorno verde, como a seleção no palette):
    // some ao Salvar (a cena remonta com o doc publicado) ou ao Cancelar.
    const marker = this.add
      .rectangle(px, py, this.document.map.tileWidth, this.document.map.tileHeight)
      .setStrokeStyle(2, 0x52fba2, 0.9)
      .setDepth(editStampDepth(this.document) + 1)
    this.editMarkers.set(mapKey, marker)
  }

  /**
   * Borracha: remove a estampa pendente da célula e, se havia um tile já
   * publicado sendo removido (`hadTile` e sem estampa desta sessão), deixa uma
   * marca VERMELHA de remoção pendente — some ao Salvar (remonte) ou Cancelar.
   * Apagar uma colocação da própria sessão apenas desfaz (sem marca vermelha).
   */
  eraseTileStamp(layerKey: string, col: number, row: number, hadTile: boolean): void {
    const index = row * this.document.map.width + col
    const mapKey = `${layerKey}:${index}`
    const pending = this.editImages.get(mapKey)
    if (pending) {
      pending.destroy()
      this.editImages.delete(mapKey)
    }
    const green = this.editMarkers.get(mapKey)
    if (green) {
      green.destroy()
      this.editMarkers.delete(mapKey)
    }
    const prevErase = this.eraseMarkers.get(mapKey)
    if (prevErase) {
      prevErase.destroy()
      this.eraseMarkers.delete(mapKey)
    }
    if (hadTile && !pending) {
      const { px, py } = tileCenter(this.document, col, row)
      const marker = this.add
        .rectangle(px, py, this.document.map.tileWidth, this.document.map.tileHeight, 0xff5d5d, 0.18)
        .setStrokeStyle(2, 0xff5d5d, 0.9)
        .setDepth(editStampDepth(this.document) + 1)
      this.eraseMarkers.set(mapKey, marker)
    }
  }

  /**
   * Estampa pendente de uma peça de mobília (`tile-object`) desta sessão —
   * só o sprite, na posição/orientação atual, um degrau acima do mapa
   * publicado (ver `editStampDepth`). Sem contorno verde: destacar TODO objeto
   * tocado na sessão (em vez de só o selecionado no momento) fazia qualquer
   * seleção múltipla parecer permanente — o destaque de "isto está
   * selecionado" é o overlay azul de `setSelectionOverlay`, que troca de
   * objeto a cada seleção em vez de acumular.
   */
  applyTileObjectStamp(
    objectId: string,
    bounds: { x: number; y: number; width: number; height: number },
    textureKey: string,
    frameKey: string,
    orientation?: TileOrientation,
  ): void {
    this.removeTileObjectStamp(objectId)
    const cx = bounds.x + bounds.width / 2
    const cy = bounds.y + bounds.height / 2
    const image = this.add
      .image(cx, cy, textureKey, frameKey)
      .setDisplaySize(bounds.width, bounds.height)
      .setDepth(editStampDepth(this.document))
    image.setFlipX(orientation?.flipX ?? false)
    image.setAngle(orientation?.rotation ?? 0)
    this.editObjectImages.set(objectId, image)
  }

  /** Remove a estampa pendente de uma peça colocada nesta sessão (borracha ou desfazer). */
  removeTileObjectStamp(objectId: string): void {
    const image = this.editObjectImages.get(objectId)
    if (image) {
      image.destroy()
      this.editObjectImages.delete(objectId)
    }
    const erase = this.editObjectEraseMarkers.get(objectId)
    if (erase) {
      erase.destroy()
      this.editObjectEraseMarkers.delete(objectId)
    }
  }

  /**
   * Marca em vermelho a remoção pendente de uma peça JÁ PUBLICADA — o sprite
   * publicado só some no `applyMap` pós-save, então até lá a marca é o único
   * sinal de que ela saiu. Espelha o `hadTile` de `eraseTileStamp`.
   */
  markTileObjectErased(objectId: string, bounds: { x: number; y: number; width: number; height: number }): void {
    this.removeTileObjectStamp(objectId)
    const marker = this.add
      .rectangle(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, bounds.width, bounds.height, 0xff5d5d, 0.18)
      .setStrokeStyle(2, 0xff5d5d, 0.9)
      .setDepth(editStampDepth(this.document) + 1)
    this.editObjectEraseMarkers.set(objectId, marker)
  }

  /**
   * Esconde/mostra um sprite de mobília PUBLICADA. Usado quando a sessão de
   * edição modifica in-place uma peça já publicada (rotação): o preview
   * desenha a versão nova um degrau acima e o original precisa sumir, porque
   * tiles têm transparência e vazariam por baixo. No-op se o id não for
   * de uma peça publicada (peça criada nesta sessão não tem sprite publicado).
   */
  setPublishedObjectVisible(objectId: string, visible: boolean): void {
    this.publishedObjectImages.get(objectId)?.setVisible(visible)
  }

  /**
   * Sincroniza a ordem visual da mobília com `document.objects` durante uma
   * edição ainda não publicada. Sprites publicados e estampas pendentes
   * precisam compartilhar o depth real da layer; depois o display list
   * desempata, de baixo para cima, na ordem recebida.
   *
   * Quando existe uma estampa para o mesmo id, ela é a versão atual e ganha
   * precedência sobre o sprite publicado escondido.
   */
  syncTileObjectOrder(objects: readonly { id: string; layerKey: string }[]): void {
    const layerDepth = new Map(this.document.layers.map((layer) => [layer.key, layer.zIndex]))
    for (const object of objects) {
      const image = this.editObjectImages.get(object.id) ?? this.publishedObjectImages.get(object.id)
      const depth = layerDepth.get(object.layerKey)
      if (!image || depth === undefined) continue
      image.setDepth(depth)
      this.children.bringToTop(image)
    }
  }

  /** Revela todos os sprites publicados — usado ao recalcular os overlays do zero. */
  resetPublishedObjectsVisibility(): void {
    this.publishedObjectImages.forEach((image) => image.setVisible(true))
  }

  /**
   * Esconde o sprite de uma peça de mobília PUBLICADA (por id) — usado ao
   * arrastá-la ou apagá-la nesta sessão, para o lugar antigo não ficar com um
   * fantasma até o save. Reversível por `restoreHiddenPublishedObjects` (Cancelar).
   * No-op se a peça não é publicada (foi colocada nesta sessão, não tem sprite aqui).
   */
  hidePublishedObject(objectId: string): void {
    const image = this.publishedObjectImages.get(objectId);
    if (!image) return;
    image.setVisible(false);
    this.hiddenPublishedIds.add(objectId);
  }

  /** Revela as peças publicadas escondidas nesta sessão — chamado no Cancelar (`discardLocalEdits`). */
  restoreHiddenPublishedObjects(): void {
    this.hiddenPublishedIds.forEach((id) => this.publishedObjectImages.get(id)?.setVisible(true));
    this.hiddenPublishedIds.clear();
  }

  /**
   * Define (ou limpa, com `spec: null`) o sprite de preview de colocação —
   * chamado pelo hook ao escolher/trocar o asset ou a ferramenta. Enquanto
   * houver spec, a cena desenha um fantasma esmaecido centrado no cursor a cada
   * move (`updatePlacementGhost`), refletindo exatamente onde a peça cairá.
   */
  setPlacementPreview(
    spec:
      | {
          groupWidth: number;
          groupHeight: number;
          tileWidth: number;
          tileHeight: number;
          slices: { textureKey: string; frameKey: string; dx: number; dy: number }[];
        }
      | null
  ): void {
    // Recria os fantasmas do zero: um asset fatiado tem N slices, e a seleção
    // pode ter mudado a quantidade/textura entre uma chamada e outra.
    this.placementGhosts.forEach((ghost) => ghost.destroy());
    this.placementGhosts = [];
    this.placementPreview = spec;
    if (!spec) return;
    this.placementGhosts = spec.slices.map((slice) =>
      this.add
        .image(0, 0, slice.textureKey, slice.frameKey)
        .setDisplaySize(spec.tileWidth, spec.tileHeight)
        .setAlpha(0.5)
        .setDepth(205)
    );
    // Posiciona já no cursor atual, sem esperar o próximo move.
    const pointer = this.input.activePointer;
    const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
    this.updatePlacementGhost(world.x, world.y);
  }

  /**
   * Reposiciona os fantasmas do grupo com a BBOX centrada em (worldX, worldY) —
   * espelha a colocação, que também centra o grupo no cursor. Cada slice fica na
   * origem + (dx,dy) + meio-tile (centro do sprite).
   */
  private updatePlacementGhost(worldX: number, worldY: number): void {
    const spec = this.placementPreview;
    if (!spec || this.placementGhosts.length !== spec.slices.length) return;
    const originX = worldX - spec.groupWidth / 2;
    const originY = worldY - spec.groupHeight / 2;
    spec.slices.forEach((slice, index) => {
      this.placementGhosts[index]!.setPosition(
        originX + slice.dx + spec.tileWidth / 2,
        originY + slice.dy + spec.tileHeight / 2
      );
    });
  }

  /**
   * Realça (ou limpa, com `bounds: null`) o item sob o cursor no modo borracha
   * por objeto — um retângulo vermelho transitório, recriado a cada move. Slot
   * próprio (`this.eraseHover`), separado de `editObjectEraseMarkers` (remoção
   * pendente já commitada) para não interferir na marca de peça publicada.
   */
  setEraseHover(
    bounds: { x: number; y: number; width: number; height: number } | null
  ): void {
    if (this.eraseHover) {
      this.eraseHover.destroy();
      this.eraseHover = null;
    }
    if (!bounds) return;
    this.eraseHover = this.add
      .rectangle(
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
        bounds.width,
        bounds.height,
        0xff5d5d,
        0.25
      )
      .setStrokeStyle(2, 0xff5d5d, 0.95)
      .setDepth(210);
  }

  /** Desenha (ou limpa, com `rect: null`) o retângulo de preview de zona (sala/zona privada) sendo editada. */
  setZonePreview(rect: { x: number; y: number; width: number; height: number } | null): void {
    if (this.zonePreview) {
      this.zonePreview.destroy()
      this.zonePreview = null
    }
    if (!rect) return
    this.zonePreview = this.add
      .rectangle(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width, rect.height, this.rectPreviewColor, 0.15)
      .setStrokeStyle(2, this.rectPreviewColor)
      .setDepth(200)
  }

  /** Cor do preview do retângulo de arraste (áreas = verde, borracha = vermelho). */
  setRectPreviewColor(color: number): void {
    this.rectPreviewColor = color
  }

  /**
   * Retângulo da seleção ativa (ferramenta de rotação). Diferente do
   * `zonePreview`, que só existe durante o arraste, este fica até a seleção ser
   * limpa. Dois degraus acima da estampa: acima dela e dos marcadores.
   */
  setSelectionOverlay(rect: { x: number; y: number; width: number; height: number } | null): void {
    this.selectionOverlay?.destroy()
    this.selectionOverlay = null
    this.selectionRect = rect
    if (!rect) return
    this.selectionOverlay = this.add
      .rectangle(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width, rect.height, 0x6ab8ff, 0.12)
      .setStrokeStyle(2, 0x6ab8ff, 0.95)
      .setDepth(editStampDepth(this.document) + 2)
  }

  /**
   * Feedback visual persistente (Task C5) para uma área recém-desenhada
   * (silêncio/chamada/colisão) — diferente do `zonePreview` (que só existe
   * durante o drag), estes overlays ficam até o fim da sessão de edição
   * (`setEditing(false)`) ou o documento ser recarregado (novo `enter()`,
   * que remonta a cena do zero).
   */
  addEditZoneOverlay(id: string, rect: { x: number; y: number; width: number; height: number }, color = 0x7de3a0): void {
    this.editZoneOverlays.get(id)?.destroy()
    const overlay = this.add
      .rectangle(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width, rect.height, color, 0.18)
      .setStrokeStyle(2, color)
      .setDepth(150)
    this.editZoneOverlays.set(id, overlay)
  }

  /**
   * Redesenha os retângulos das áreas já publicadas (silêncio/chamada/colisão).
   * Chamado ao entrar na Decoração e a cada recálculo de overlays — sem isto,
   * quem abre a paleta ÁREAS não enxerga onde já existe sala de chamada e
   * acaba desenhando uma por cima da outra.
   *
   * Fica UMA camada abaixo dos overlays da sessão: o que a pessoa acabou de
   * desenhar tem que ganhar de quem já estava lá.
   */
  setPublishedAreaOverlays(
    areas: Array<{ id: string; rect: { x: number; y: number; width: number; height: number }; color?: number }>,
  ): void {
    this.clearPublishedAreaOverlays()
    for (const { id, rect, color = 0x7de3a0 } of areas) {
      const overlay = this.add
        .rectangle(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width, rect.height, color, 0.18)
        .setStrokeStyle(2, color)
        .setDepth(149)
      this.publishedAreaOverlays.set(id, overlay)
    }
  }

  private clearPublishedAreaOverlays(): void {
    this.publishedAreaOverlays.forEach((overlay) => overlay.destroy())
    this.publishedAreaOverlays.clear()
  }

  /** Remove o overlay de uma área apagada nesta sessão (pela borracha). */
  removeEditZoneOverlay(id: string): void {
    this.editZoneOverlays.get(id)?.destroy()
    this.editZoneOverlays.delete(id)
  }

  /**
   * Marca uma área apagada pela borracha. Se ela foi desenhada NESTA sessão
   * (tem overlay pendente), some na hora. Se é uma área já publicada, deixa uma
   * marca VERMELHA de remoção pendente (some no Salvar/remonte ou Cancelar).
   */
  eraseAreaMarker(id: string, rect: { x: number; y: number; width: number; height: number }): void {
    // A área publicada some junto com a marcação — senão o retângulo original
    // continuaria desenhado por baixo do vermelho de remoção pendente.
    this.publishedAreaOverlays.get(id)?.destroy()
    this.publishedAreaOverlays.delete(id)
    const pending = this.editZoneOverlays.get(id)
    if (pending) {
      pending.destroy()
      this.editZoneOverlays.delete(id)
      return
    }
    this.areaEraseMarkers.get(id)?.destroy()
    const marker = this.add
      .rectangle(rect.x + rect.width / 2, rect.y + rect.height / 2, rect.width, rect.height, 0xff5d5d, 0.18)
      .setStrokeStyle(2, 0xff5d5d, 0.9)
      .setDepth(151)
    this.areaEraseMarkers.set(id, marker)
  }

  private clearEditZoneOverlays(): void {
    this.editZoneOverlays.forEach((overlay) => overlay.destroy())
    this.editZoneOverlays.clear()
    this.clearPublishedAreaOverlays()
  }

  /**
   * Texturas placeholder geradas em runtime — nenhum PNG no repo.
   *
   * ESTE É O PONTO DE TROCA: quando entrar o spritesheet real (tileset +
   * personagem 4 direções), é aqui que ele é carregado, e o resto da cena
   * segue igual.
   */
  preload(): void {
    const g = this.make.graphics({ x: 0, y: 0 }, false)
    this.load.image(KART_TEXTURE, KART_ASSET_URL)
    this.load.image(BALL_TEXTURE, BALL_ASSET_URL)
    for (const asset of this.assets) this.load.image(`office-map-asset-${asset.id}`, asset.url)

    // Spinner de loading: anel com abertura, girado por tween enquanto o
    // sprite pixel-art da pessoa carrega/gera.
    g.clear()
    g.lineStyle(3, 0xffffff, 0.9)
    g.beginPath()
    g.arc(12, 12, 8, 0, Math.PI * 1.5)
    g.strokePath()
    g.generateTexture('char-loading', 24, 24)

    createConfettiTexture(this, g)

    createPaintTextures(this, g)
    createKartSmokeTexture(this, g)

    g.destroy()
  }

  /**
   * Desenha os visuais de decoração do mapa (tiles, tile-objects, zonas, links)
   * e os rastreia em `mapObjects` para permitir reconstrução in-place em
   * `applyMap`. NÃO desenha personagens nem mesas (essas têm ciclo próprio).
   */
  private renderDecoration(): void {
    // Reconstrói do zero o índice de mobília publicada por id (e zera o registro
    // de escondidas): renderDecoration sempre redesenha toda a decoração.
    this.publishedObjectImages.clear()
    this.hiddenPublishedIds.clear()
    this.cameras.main.setBackgroundColor(this.document.map.backgroundColor)
    const tilesets = new Map(this.document.tilesets.map((tileset) => [tileset.id, tileset]))
    const assetById = new Map(this.assets.map((asset) => [asset.id, asset]))
    const layerByKey = new Map(this.document.layers.map((layer) => [layer.key, layer]))
    for (const layer of [...this.document.layers].sort((a, b) => a.zIndex - b.zIndex)) {
      if (!layer.visible || layer.type !== 'tile') continue
      layer.data.forEach((reference, index) => {
        if (!reference) return
        const separator = reference.lastIndexOf(':')
        const tileset = tilesets.get(reference.slice(0, separator))
        const tileIndex = Number(reference.slice(separator + 1))
        const asset = tileset ? assetById.get(tileset.assetId) : null
        const frame = tileset ? officeMapTileFrame(tileset, tileIndex) : null
        if (!tileset || !asset || !frame) return
        const textureKey = `office-map-asset-${asset.id}`
        const texture = this.textures.get(textureKey)
        if (!texture.has(frame.key)) {
          texture.add(frame.key, 0, frame.x, frame.y, frame.width, frame.height)
        }
        const x = index % this.document.map.width
        const y = Math.floor(index / this.document.map.width)
        const { px, py } = tileCenter(this.document, x, y)
        const image = this.add.image(px, py, textureKey, frame.key)
          .setDisplaySize(this.document.map.tileWidth, this.document.map.tileHeight)
          .setAlpha(layer.opacity)
          .setDepth(layer.zIndex)
        this.mapObjects.push(image)
      })
    }
    for (const object of this.document.objects) {
      if (object.type !== 'tile-object') continue
      const layer = layerByKey.get(object.layerKey)
      if (!layer?.visible) continue
      const tileset = tilesets.get(object.properties.tilesetId)
      const asset = tileset ? assetById.get(tileset.assetId) : null
      if (!tileset || !asset) continue
      if (isOfficeBallAssetId(tileset.assetId)) {
        const image = this.add
          .image(
            object.geometry.x + object.geometry.width / 2,
            object.geometry.y + object.geometry.height / 2,
            BALL_TEXTURE,
          )
          .setDisplaySize(BALL_DISPLAY_SIZE, BALL_DISPLAY_SIZE)
          .setAlpha(layer.opacity)
          .setDepth(layer.zIndex)
        this.mapObjects.push(image)
        this.publishedObjectImages.set(object.id, image)
        continue
      }
      if (isOfficeKartAssetId(tileset.assetId)) {
        const image = this.add
          .image(
            object.geometry.x + object.geometry.width / 2,
            object.geometry.y + object.geometry.height / 2,
            KART_TEXTURE,
          )
          .setDisplaySize(KART_DISPLAY_SIZE, KART_DISPLAY_SIZE)
          .setAlpha(layer.opacity)
          .setDepth(layer.zIndex)
          .setAngle(object.properties.rotation ?? 0)
        this.mapObjects.push(image)
        this.publishedObjectImages.set(object.id, image)
        continue
      }
      const tileIndex = object.properties.tileIndex
      const frame = officeMapTileFrame(tileset, tileIndex)
      if (!frame) continue
      const textureKey = `office-map-asset-${asset.id}`
      const texture = this.textures.get(textureKey)
      if (!texture.has(frame.key)) {
        texture.add(frame.key, 0, frame.x, frame.y, frame.width, frame.height)
      }
      const image = this.add.image(
        object.geometry.x + object.geometry.width / 2,
        object.geometry.y + object.geometry.height / 2,
        textureKey,
        frame.key,
      ).setDisplaySize(object.geometry.width, object.geometry.height)
        .setAlpha(layer.opacity)
        .setDepth(layer.zIndex)
      // Flip é local ao sprite e o ângulo vem depois — é exatamente o modelo
      // assumido pela composição em `flipOrientation` (`H ∘ R(θ) = R(-θ) ∘ H`).
      image.setFlipX(object.properties.flipX ?? false)
      image.setAngle(object.properties.rotation ?? 0)
      this.mapObjects.push(image)
      this.publishedObjectImages.set(object.id, image)
    }
    this.refreshKartVisuals()
    this.refreshBallVisuals()
    this.zoneVisuals.clear()

    for (const zone of this.document.objects.filter((object) => object.type === 'meeting-room' || object.type === 'private-zone')) {
      const geometry = zone.geometry
      // Área de silêncio (private-zone) em vermelho; sala de chamada em verde.
      const isSilence = zone.type === 'private-zone'
      const zoneColor = isSilence ? ZONE_TINT.silence : ZONE_TINT.open
      if (geometry.kind === 'rectangle') {
        const fill = this.add.rectangle(geometry.x + geometry.width / 2, geometry.y + geometry.height / 2, geometry.width, geometry.height, zoneColor, 0.1)
        this.mapObjects.push(fill)
        // Só sala de chamada tranca; área de silêncio não tem o conceito.
        if (zone.type === 'meeting-room') {
          this.zoneVisuals.set(zone.properties.externalKey, {
            fill,
            centerX: geometry.x + geometry.width / 2,
            centerY: geometry.y + geometry.height / 2,
            lock: null,
          })
        }
      } else {
        const graphics = this.add.graphics()
        graphics.fillStyle(zoneColor, 0.1)
        graphics.fillPoints(geometry.points.map((point) => new Phaser.Geom.Point(point.x, point.y)), true)
        this.mapObjects.push(graphics)
      }
      // Zona não escreve o nome no mapa: só o tom colorido. Nome de sala é
      // texto pequeno sobre um mapa cheio de detalhe — some atrás da mobília
      // se ficar por baixo, e vira adesivo se ganhar fundo. Quem entra na
      // sala lê o nome na MediaBar ("Você está em: <sala>"), que já usa a
      // mesma regra de nome (`officeZoneDisplayName`).
    }
    // Mapa recém-montado (boot ou publicação de decoração) já nasce com os
    // cadeados que estiverem valendo.
    this.applyZoneLocks()

    // Marcadores de link: um hotspot com o rótulo. A interação (proximidade +
    // tecla E) vive no React (`useOfficeLinks`); aqui só desenhamos onde estão.
    for (const object of this.document.objects) {
      if (object.type !== 'link' || object.geometry.kind !== 'point') continue
      const { x, y } = object.geometry
      this.mapObjects.push(this.add.circle(x, y, 8, 0x6ab8ff, 0.9).setStrokeStyle(2, 0xffffff, 0.85).setDepth(140))
      this.mapObjects.push(this.add.text(x + 11, y - 6, object.properties.label, {
        fontFamily: 'sans-serif',
        fontSize: '9px',
        color: '#bfe0ff',
      }).setDepth(140))
    }
  }

  /** Mantém os karts estacionados no mapa; durante a edição mostra a posição publicada. */
  /**
   * A que volume, de 0 a 1, um efeito que acontece num tile do mapa chega até
   * você. Quem decide é `officeSoundLevel` (`@legends/shared`), a mesma regra
   * da palma do high-five: sala de chamada e zona privada isolam nos DOIS
   * sentidos — brincadeira no espaço aberto não vaza para dentro da reunião ao
   * lado, nem o contrário —, e no aberto o som cai com a distância até sumir
   * no raio.
   *
   * Sem posição sua ainda no bridge (cena recém-montada) o som sai inteiro: o
   * gesto é seu, e calá-lo seria pior do que deixá-lo vazar por um instante.
   *
   * Quem OUVE também converte. O occupant do bridge fala PIXEL desde o
   * movimento livre, e `officeSoundLevel` compara Chebyshev contra um raio em
   * TILE: entregar o ouvinte cru fazia toda distância estourar o raio, e a
   * batida da bola e o tiro de paintball ficavam mudos para todo mundo.
   */
  private earshotLevel(
    tile: { x: number; y: number } | undefined,
    tiles = BALL_EARSHOT_TILES,
  ): number {
    if (!tile || !this.youId) return 1
    const you = this.bridge.occupantSnapshot(this.youId)
    if (!you) return 1
    return officeSoundLevel(this.document, this.tileAtPixel(you), tile, tiles)
  }

  /**
   * Onde cada bola foi PUBLICADA: o tile de origem e o centro em pixels de
   * cada slice. É a âncora de onde a posição atual é derivada — a bola anda
   * como deslocamento sobre isso, o que faz a peça de 2×2 (pilates) mover os
   * quatro slices juntos, mantendo a forma.
   *
   * Memoizado pela IDENTIDADE de `objects`, como a grade de colisão: mapa novo
   * sempre traz array novo.
   */
  private ballLayout(): Map<string, BallLayout> {
    if (this.ballLayoutObjects === this.document.objects && this.ballLayoutCache) return this.ballLayoutCache
    const centers = new Map<string, { px: number; py: number }>()
    for (const object of this.document.objects) {
      if (object.type !== 'tile-object') continue
      centers.set(object.id, {
        px: object.geometry.x + object.geometry.width / 2,
        py: object.geometry.y + object.geometry.height / 2,
      })
    }
    const layout = new Map<string, BallLayout>()
    for (const ball of mapBalls(this.document)) {
      layout.set(ball.id, {
        originX: ball.x,
        originY: ball.y,
        slices: (ball.memberIds ?? [ball.id]).flatMap((id) => {
          const center = centers.get(id)
          const image = this.publishedObjectImages.get(id)
          if (!center || !image) return []
          // Profundidade e escala de CHÃO ficam gravadas aqui, no momento em
          // que a cena monta a peça. O chute alto infla a escala e sobe a
          // profundidade durante o voo; se o valor "de chão" fosse lido da
          // imagem viva na hora do chute, um voo interrompido (chute novo
          // antes do pouso) devolveria a escala JÁ inflada como base — e a
          // bola crescia a cada chute, sem nunca voltar.
          return [{ id, ...center, depth: image.depth, scaleX: image.scaleX, scaleY: image.scaleY }]
        }),
      })
    }
    this.ballLayoutObjects = this.document.objects
    this.ballLayoutCache = layout
    return layout
  }

  /**
   * Reposiciona cada bola no tile onde o servidor diz que ela está, e devolve
   * cada slice ao estado de CHÃO (profundidade e escala do layout). No modo de
   * edição a peça volta para a posição PUBLICADA — é mobília sendo arrastada,
   * não entidade do jogo —, mesma regra do kart.
   */
  private refreshBallVisuals(): void {
    for (const [ballId, layout] of this.ballLayout()) {
      const ball = this.ballStates.get(ballId)
      // Já em PIXEL nos dois lados: `mapBalls` devolve o centro publicado em
      // pixel, e o estado da bola também. Antes os dois eram tile, e daí a
      // multiplicação.
      const dx = this.editing || !ball ? 0 : ball.x - layout.originX
      const dy = this.editing || !ball ? 0 : ball.y - layout.originY
      // Arco do chute alto. A bola já ATRAVESSA a mobília (é o `airborneMs` da
      // física); o que faltava era ela PARECER que está no ar — meia-senóide,
      // um tico maior no ápice (é o que lê como "veio na direção da câmera" num
      // jogo sem eixo Z) e acima de tudo na profundidade.
      const voo = ball?.airborneMs ? this.ballFlights.get(ballId) : undefined
      const altura = voo ? Math.sin(Math.PI * (1 - (ball?.airborneMs ?? 0) / voo.totalMs)) : 0
      const subida = voo ? voo.lift * altura : 0
      const inflado = 1 + 0.3 * altura

      for (const slice of layout.slices) {
        const image = this.publishedObjectImages.get(slice.id)
        if (!image) continue
        image
          .setPosition(slice.px + dx, slice.py + dy - subida)
          .setDepth(subida > 0 ? BALL_LOB_DEPTH : slice.depth)
          // A base é a escala de CHÃO do layout, nunca a escala viva: partir da
          // inflada faria a bola crescer a cada chute, sem nunca voltar.
          .setScale(slice.scaleX * inflado, slice.scaleY * inflado)
        if (this.editing) {
          image.setRotation(0).setVisible(!this.hiddenPublishedIds.has(slice.id))
        } else {
          image.setVisible(true)
        }
      }
    }
  }


  /**
   * O chute de alguém chegou.
   *
   * Não há trajetória a animar: o evento traz a VELOCIDADE, e a cena integra a
   * mesma física do servidor (`stepBodyBall`) a cada quadro. O evento existe
   * para o som e para a bola reagir NA HORA, sem esperar até 50ms pelo próximo
   * snapshot — meio metro de bola, no chutão.
   */
  private playBallKick(userId: string, ball: OfficeBall, power: OfficeBallPower): void {
    const anterior = this.ballStates.get(ball.id)
    this.ballStates.set(ball.id, { ...ball })
    if (ball.airborneMs) {
      // A altura acompanha a DISTÂNCIA do voo, como antes acompanhava o número
      // de tiles do caminho: chute curto que sobe como um foguete não lê.
      const tiles = ((Math.hypot(ball.vx, ball.vy) * ball.airborneMs) / 1000) / this.document.map.tileWidth
      this.ballFlights.set(ball.id, {
        totalMs: ball.airborneMs,
        lift: Math.min(BALL_LOB_LIFT_MAX, BALL_LOB_LIFT_BASE + BALL_LOB_LIFT_PER_TILE * tiles),
      })
    }
    // A batida sai mesmo quando a bola não anda (entalada): o gesto aconteceu.
    const volume = this.earshotLevel(this.tileAtPixel(anterior ?? ball))
    if (volume > 0) playKickSound({ power, grazed: false, volume })
  }

  /**
   * O tile em que um ponto em pixel cai.
   *
   * O alcance SONORO continua raciocinando em tile — é a unidade do grafo de
   * áudio do escritório —, então quem fala pixel converte aqui.
   */
  private tileAtPixel(ball: { x: number; y: number }): { x: number; y: number } {
    return {
      x: Math.floor(ball.x / this.document.map.tileWidth),
      y: Math.floor(ball.y / this.document.map.tileHeight),
    }
  }

  /**
   * Roda as bolas no quadro, com a MESMA física do servidor.
   *
   * O cliente integra entre snapshots e corrige quando o próximo chega — sem
   * isso a bola andaria a 20Hz, aos saltos, que é o que a rolagem por tween
   * escondia enquanto a trajetória vinha resolvida.
   */
  private updateBalls(dtMs: number): void {
    if (this.ballStates.size === 0 || this.editing) return
    const grid = bodyCollisionGrid(this.document)
    const eu = this.bodyPredictor?.current()
    const move = this.pressedMove() ?? this.autoMove
    const passo = move ? MOVE_DIRECTION_DELTAS[move] : { x: 0, y: 0 }
    let mexeu = false
    for (const [id, ball] of this.ballStates) {
      const antes = { x: ball.x, y: ball.y }
      let depois: OfficeBall = { ...ball, ...stepBodyBall(ball, dtMs, grid) }
      if (eu) {
        // O próprio conduz na PREDIÇÃO, não no eco: encostar na bola tem de
        // responder na hora, como o passo.
        const toque = touchBodyBall(depois, {
          x: eu.x,
          y: eu.y,
          dx: passo.x,
          dy: passo.y,
          sprint: this.shiftKey?.isDown ?? false,
        })
        if (toque) depois = { ...depois, ...toque }
      }
      this.ballStates.set(id, depois)
      // Pousar TAMBÉM é mudança: a bola pode acabar o voo já parada, e sem
      // redesenhar ela ficaria pendurada no ar para sempre.
      if (depois.x !== antes.x || depois.y !== antes.y || depois.airborneMs !== ball.airborneMs) {
        mexeu = true
      }
      // Gira na direção do movimento: rolar é o que separa uma bola de um disco.
      // Só na peça de um slice — numa bola fatiada cada pedaço rodaria em torno
      // do próprio centro e ela se desmontaria.
      const percorrido = Math.hypot(depois.x - antes.x, depois.y - antes.y)
      if (percorrido > 0 && (depois.memberIds?.length ?? 1) === 1) {
        const image = this.publishedObjectImages.get(depois.memberIds?.[0] ?? id)
        if (image) image.rotation += percorrido * BALL_SPIN_PER_PX
      }
      if (!depois.airborneMs) this.ballFlights.delete(id)
    }
    if (mexeu) this.refreshBallVisuals()
  }


  /**
   * Anima um tiro. Como no chute, a trajetória já vem resolvida do servidor
   * (`firePaintball`, `@legends/shared`): aqui não há mira, colisão nem
   * detecção de acerto — só uma bolinha atravessando os tiles recebidos e o
   * estouro no fim.
   *
   * A bolinha voa por CIMA de tudo (`PAINT_PELLET_DEPTH`), inclusive de quem
   * está no caminho: ela é pequena demais para some atrás de uma mesa e ainda
   * ser lida como tiro.
   */
  private playPaintballShot(shot: BodyShot): void {
    // O disparo já vem resolvido em PIXEL: de onde saiu, até onde estourou.
    // Antes vinha como lista de tiles, e a cena convertia cada um em centro —
    // com posição contínua isso deixaria o tiro sair do lugar errado.
    const shotVolume = this.earshotLevel(this.tileAtPixel(shot.from), PAINTBALL_EARSHOT_TILES)
    if (shotVolume > 0) playPaintballSound({ hit: false, volume: shotVolume })
    // Marca antes da animação: se a cena não desenhar o voo (tiro contra a
    // parede colada, personagem ainda compondo), a tinta não pode se perder.
    if (shot.splat) this.applyPaintSplat(shot.splat)
    // Tiro que não anda (parede colada) não ganha projétil: uma bolinha com voo
    // de zero pixel é um sprite nascendo e morrendo no mesmo quadro. O disparo
    // continua soando — o gesto aconteceu.
    if (shot.to.x === shot.from.x && shot.to.y === shot.from.y) return

    const pellet = this.add.image(shot.from.x, shot.from.y + PAINTBALL_MUZZLE_Y, PAINT_PELLET_TEXTURE)
    pellet.setTint(shot.color)
    pellet.setDepth(PAINT_PELLET_DEPTH)

    this.tweens.add({
      targets: pellet,
      x: shot.to.x,
      y: shot.to.y + PAINTBALL_MUZZLE_Y,
      duration: Math.max(1, shot.durationMs),
      ease: 'Linear',
      onComplete: () => {
        pellet.destroy()
        this.burstPaint(shot.to.x, shot.to.y + PAINTBALL_MUZZLE_Y, shot.color)
        const hitVolume = this.earshotLevel(this.tileAtPixel(shot.to), PAINTBALL_EARSHOT_TILES)
        if (shot.splat && hitVolume > 0) playPaintballSound({ hit: true, volume: hitVolume })
      },
    })
  }

  /**
   * O impacto: respingos saltando do ponto onde a bolinha estourou.
   *
   * Antes isto era UM borrão que crescia e desbotava — e a versão crescida
   * lia como fumaça, não como tinta: escalar reamostra o desenho (`pixelArt`)
   * e, no meio do fade sobre o piso claro, o que sobrava era um cinza sem
   * forma. Vários pontinhos em tamanho real, saindo rápido, dizem "estourou"
   * sem esticar pixel nenhum.
   */
  private burstPaint(px: number, py: number, color: number): void {
    for (let i = 0; i < PAINT_BURST_DROPS; i += 1) {
      // Leque determinístico em torno do ponto: sem sorteio, como o resto do
      // tiro — e um passo ímpar de volta inteira evita respingo simétrico.
      const angle = (i / PAINT_BURST_DROPS) * Math.PI * 2 + i * 0.7
      const drop = this.add.image(px, py, PAINT_PELLET_TEXTURE)
      drop.setTint(color)
      drop.setDepth(PAINT_PELLET_DEPTH)
      this.tweens.add({
        targets: drop,
        x: px + Math.cos(angle) * PAINT_BURST_REACH,
        y: py + Math.sin(angle) * PAINT_BURST_REACH,
        alpha: 0,
        duration: PAINT_BURST_MS,
        ease: 'Quad.easeOut',
        onComplete: () => drop.destroy(),
      })
    }
  }

  /**
   * Gruda uma mancha no personagem de quem levou. Onde ela cai, de que
   * tamanho e girada quanto sai de `paintSplatPlacement(id)` — derivado do id,
   * e não sorteado aqui: o id é o mesmo em todos os clientes, então todo mundo
   * vê a mancha no mesmo lugar sem que o servidor mande coordenada nenhuma.
   *
   * A marca vence sozinha, pelo `ttlMs` que veio no payload: é ele que já
   * chega descontado do tempo decorrido para quem entrou no meio da vida dela.
   */
  private applyPaintSplat(splat: PaintSplat): void {
    const view = this.characters.get(splat.userId)
    if (!view) return
    const splats = (view.paintSplats ??= new Map())
    // Reentrada (welcome sintético do bridge depois de um remount) traz marcas
    // que já estão na tela: repor a mesma imagem duplicaria a tinta e o timer.
    if (splats.has(splat.id)) return

    const { ox, oy, variant } = paintSplatPlacement(splat.id)
    const image = this.add.image(
      ox * PAINT_SPLAT_BOX.x,
      PAINT_SPLAT_BOX.top + ((oy + 1) / 2) * (PAINT_SPLAT_BOX.bottom - PAINT_SPLAT_BOX.top),
      `${PAINT_SPLAT_TEXTURE}-${variant}`,
    )
    image.setTint(splat.color)
    image.setDepth(PAINT_SPLAT_DEPTH_OFFSET)
    // Sem `setDisplaySize` e sem giro: a máscara já é do tamanho de desenho, e
    // qualquer transformação aqui reamostraria a arte (ver `PAINT_SPLAT_MASKS`).
    view.container.add(image)
    splats.set(splat.id, image)

    // Entra por alfa. O "pique" de escala que havia aqui antes era exatamente o
    // tipo de transformação que o `pixelArt` não perdoa.
    image.setAlpha(0)
    this.tweens.add({ targets: image, alpha: 1, duration: PAINT_SPLAT_IN_MS })

    const ttl = Math.max(0, Math.min(splat.ttlMs, PAINT_SPLAT_TTL_MS))
    const fade = Math.min(PAINT_SPLAT_FADE_MS, ttl)
    this.time.delayedCall(Math.max(0, ttl - fade), () => {
      if (!image.scene) return
      this.tweens.add({
        targets: image,
        alpha: 0,
        duration: fade,
        onComplete: () => {
          splats.delete(splat.id)
          image.destroy()
        },
      })
    })
  }

  /**
   * Equipa ou guarda o marcador: recompõe o sprite com (ou sem) as camadas do
   * estilingue. Passa pelo MESMO caminho de `avatar-updated` — a arma é uma
   * camada da textura do personagem, não um objeto solto por cima, e é isso
   * que a mantém alinhada em cada quadro da caminhada sem sincronizar nada.
   */
  private setPaintMarker(userId: string, active: boolean): void {
    const view = this.characters.get(userId)
    if (!view || (view.avatar.paintMarker ?? false) === active) return
    view.avatar = { ...view.avatar, ...(active ? { paintMarker: true } : { paintMarker: undefined }) }
    this.loadCharacterSprite(view.avatar, view)
  }

  private refreshKartVisuals(): void {
    const tilesets = new Map(this.document.tilesets.map((tileset) => [tileset.id, tileset]))
    for (const object of this.document.objects) {
      if (object.type !== 'tile-object') continue
      const tileset = tilesets.get(object.properties.tilesetId)
      if (!tileset || !isOfficeKartAssetId(tileset.assetId)) continue
      const image = this.publishedObjectImages.get(object.id)
      if (!image) continue

      if (this.editing) {
        image
          .setPosition(
            object.geometry.x + object.geometry.width / 2,
            object.geometry.y + object.geometry.height / 2,
          )
          .setAngle(object.properties.rotation ?? 0)
          .setVisible(!this.hiddenPublishedIds.has(object.id))
        continue
      }

      const kart = this.kartStates.get(object.id)
      if (!kart) {
        image.setVisible(true)
        continue
      }
      // Já em PIXEL: `mapKarts` devolve o centro do tile publicado, e o kart
      // montado acompanha o piloto. Antes era tile, e daí o `tileCenter`.
      image
        .setPosition(Math.round(kart.x), Math.round(kart.y))
        .setRotation(KART_ROTATION_BY_DIR[kart.dir])
        .setVisible(!kart.riderUserId)
    }
  }

  /**
   * Atualiza o mapa in-place (publicação de decoração — caminho suave), SEM
   * remontar a cena: carrega assets novos, redesenha só os visuais de
   * decoração e reancora o predictor. Não toca em personagens, câmera nem
   * mesas — a presença de todos fica intacta.
   */
  async applyMap(document: MapDocumentV1, assets: readonly OfficeMapAssetDTO[]): Promise<void> {
    this.document = document
    this.assets = assets
    await this.ensureAssetsLoaded(assets)
    // A publicação suave não encerra a sessão de edição (ver docstring da classe),
    // então a seleção ativa da ferramenta de rotação precisa sobreviver ao
    // redesenho abaixo — guardamos o retângulo antes do `discardLocalEdits`
    // (que apaga o overlay) e o restauramos depois do `renderDecoration`.
    const activeSelection = this.selectionRect
    // Estampas/áreas da sessão de edição viram permanentes via renderDecoration.
    this.discardLocalEdits()
    this.mapObjects.forEach((object) => object.destroy())
    this.mapObjects = []
    this.publishedObjectImages.clear()
    this.renderDecoration()
    this.setSelectionOverlay(activeSelection)
  }

  private async ensureAssetsLoaded(assets: readonly OfficeMapAssetDTO[]): Promise<void> {
    const missing = assets.filter((asset) => !this.textures.exists(`office-map-asset-${asset.id}`))
    if (missing.length === 0) return
    await new Promise<void>((resolve) => {
      for (const asset of missing) this.load.image(`office-map-asset-${asset.id}`, asset.url)
      this.load.once(Phaser.Loader.Events.COMPLETE, () => resolve())
      this.load.start()
    })
  }

  create(): void {
    for (const desk of this.desks) {
      this.deskOwners.set(desk.externalKey, desk.claimedBy?.name ?? null)
    }
    this.renderDecoration()

    const deskByExternalKey = new Map(this.desks.map((desk) => [desk.externalKey, desk]))
    for (const object of this.document.objects) {
      if (object.type !== 'desk') continue
      const { x, y, width, height } = object.geometry
      const centerX = x + width / 2
      const centerY = y + height / 2
      const claimedBy = deskByExternalKey.get(object.properties.externalKey)?.claimedBy ?? null
      this.deskPositions.set(object.properties.externalKey, { x: centerX, y: centerY })
      this.deskBounds.set(object.properties.externalKey, { x, y, width, height })

      const marker = this.add.rectangle(centerX, centerY, width, height, 0xffffff, 0.001)
      marker.setStrokeStyle(0, 0xffffff, 0)
      marker.setInteractive(
        new Phaser.Geom.Rectangle(-width / 2, -height / 2, width, height),
        Phaser.Geom.Rectangle.Contains,
      )
      marker.input!.cursor = 'pointer'
      marker.on('pointerdown', () => {
        if (this.deskReminderPlacement) return
        this.bridge.emitDeskClick(object.properties.externalKey)
      })
      marker.on('pointerover', () => this.bridge.emitDeskHover(object.properties.externalKey))
      marker.on('pointerout', () => this.bridge.emitDeskHover(null))
      // Sem rótulo fixo na mesa: nome da mesa e dono vivem no card de hover
      // (`DeskHoverCard`). Um texto por mesa, com 131 delas, era o grosso da
      // poluição visual do mapa — e "Nova mesa" não informa nada.
    }
    this.renderDeskReminderGifts()

    // Sem `setBounds`: a câmera nunca é presa aos limites do mapa — permite
    // mover livremente arrastando (ver `handlePanPointerDown`) sem o clamp do
    // Phaser interferir no zoom ancorado no cursor nem no reenquadre suave
    // do `applyCameraFocus` ao retomar o acompanhamento. Sem bounds pra
    // "prender" o scroll num valor fixo, o acompanhamento (`startFollow` com
    // lerp) passa a mover a câmera de verdade a cada frame — sem
    // `roundPixels`, o scroll fica em valores fracionários e os tiles
    // "vibram" (shimmer clássico de pixel art com scroll sub-pixel).
    this.cameras.main.roundPixels = true
    this.applyCameraZoom()
    this.scale.on(Phaser.Scale.Events.RESIZE, this.handleScaleResize)

    // Sem isso o botão direito abre o menu de contexto do navegador em vez de
    // andar até o tile — inclusive hoje isso já acontecia (sem ser notado) no
    // apagar de edição, que também usa botão direito.
    this.input.mouse?.disableContextMenu()
    this.input.on('pointermove', this.handleDeskReminderPlacementPointerMove, this)
    this.input.on('pointerdown', this.handleDeskReminderPlacementPointerDown, this)
    this.input.on('pointerdown', this.handleMapRightClick, this)
    this.input.on('pointerdown', this.handlePanPointerDown, this)
    this.input.on('pointermove', this.handlePanPointerMove, this)
    this.input.on('pointerup', this.handlePanPointerUp, this)

    const keyboard = this.input.keyboard
    if (keyboard) {
      this.keys = {
        up: [keyboard.addKey('UP'), keyboard.addKey('W')],
        down: [keyboard.addKey('DOWN'), keyboard.addKey('S')],
        left: [keyboard.addKey('LEFT'), keyboard.addKey('A')],
        right: [keyboard.addKey('RIGHT'), keyboard.addKey('D')],
      }
      this.shiftKey = keyboard.addKey('SHIFT')
      // F = lançar confete. Eventos físicos da Key (não polling em update()):
      // um keydown e um keyup por "segurada", independente da duração.
      const confettiKey = keyboard.addKey('F')
      confettiKey.on('down', this.handleConfettiDown)
      confettiKey.on('up', this.handleConfettiUp)
      // R = girar no lugar, um passo de 90° por toque (evento, não polling).
      this.rotateKey = keyboard.addKey('R')
      this.rotateKey.on('down', this.handleRotateDown)
      // 'D' também é atalho de app (Ctrl/Cmd+D — andar até a mesa). Sem isso,
      // a tecla física ativa as DUAS coisas: o atalho E o WASD "direita", e o
      // passo manual dispara `onMoveIntent`, que cancela o Seguir recém-
      // iniciado (ver doc de `OfficeBridge.onMoveIntent`) — a caminhada até a
      // mesa andava um passo e morria. Enquanto Ctrl/Cmd está pressionado,
      // nenhuma tecla de movimento conta como intenção de andar.
      const onModifierChange = (event: KeyboardEvent) => {
        const wasDown = this.modifierKeyDown
        this.modifierKeyDown = event.ctrlKey || event.metaKey
        // macOS/Chrome não entrega `keyup` de teclas comuns enquanto Cmd
        // segue pressionado — soltar "D" antes de soltar Cmd deixa a tecla
        // "travada" como isDown no Phaser. Ao soltar o modificador, zera
        // todas as teclas de direção pra não herdar esse estado preso.
        if (wasDown && !this.modifierKeyDown) this.releaseDirectionKeys()
      }
      keyboard.on(Phaser.Input.Keyboard.Events.ANY_KEY_DOWN, onModifierChange)
      keyboard.on(Phaser.Input.Keyboard.Events.ANY_KEY_UP, onModifierChange)
    }
    // Alt-tab / perda de foco da aba com F segurado: encerra o confete pra o
    // servidor não achar que a pessoa segura pra sempre.
    this.sys.game.events.on(Phaser.Core.Events.BLUR, this.handleBlur)
    // Suspende o teclado da cena quando um campo de texto ganha/perde foco.
    window.addEventListener('focusin', this.handleFocusEvent)
    window.addEventListener('focusout', this.handleFocusEvent)

    this.unsubscribe = this.bridge.onServerMessage((message) => this.handle(message))
    const unsubscribeNearby = this.bridge.onNearbyMessage((message) => {
      if (message.kind === 'reaction' && this.floatingReactionsActive) return
      this.showNearbyBubble(message.userId, message.text, message.kind ?? 'speech')
    })
    // O Seguir não manda mais passo: ele "segura a tecla" e a amostragem de
    // input do quadro faz o resto — um caminho só até o servidor, e ele passa
    // pela predição (ver `OfficeBridge.onAutoWalk`).
    const unsubscribeClient = this.bridge.onAutoWalk((dir) => {
      this.autoMove = dir
    })
    // 100% local a este navegador — nunca passou pelo servidor (ver
    // `OfficeBridge.emitSpeakingChanged`).
    const unsubscribeSpeaking = this.bridge.onSpeakingChanged(({ userId, speaking }) => {
      this.setSpeaking(userId, speaking)
    })

    // IMPORTANTE: tem que ser DESTROY, não SHUTDOWN. O SHUTDOWN só dispara em
    // `scene.sys.shutdown()` (pausa/troca de cena) — quando o `Game.destroy()`
    // roda (unmount do OfficeCanvas), a SceneManager chama `sys.destroy()`
    // direto, que emite só o DESTROY. Se voltar a ouvir SHUTDOWN aqui, o
    // unsubscribe nunca roda no unmount: o handler fica registrado no bridge
    // para sempre e, na próxima mensagem do servidor, explode contra uma cena
    // já destruída (`this.add` nulo) — e essa exceção interrompe a entrega de
    // mensagem para as cenas seguintes no `OfficeBridge.emitServerMessage`.
    this.events.once(Phaser.Scenes.Events.DESTROY, () => {
      this.unsubscribe?.()
      this.unsubscribe = null
      unsubscribeNearby()
      unsubscribeClient()
      unsubscribeSpeaking()
      this.scale.off(Phaser.Scale.Events.RESIZE, this.handleScaleResize)
      this.sys.game.events.off(Phaser.Core.Events.BLUR, this.handleBlur)
      window.removeEventListener('focusin', this.handleFocusEvent)
      window.removeEventListener('focusout', this.handleFocusEvent)
      this.focusTimer?.remove(false)
      this.focusTimer = null
      for (const emitter of this.confettiEmitters.values()) emitter.destroy()
      this.confettiEmitters.clear()
      this.characters.clear()
      this.keys = null
      this.shiftKey = null
      this.rotateKey = null
      this.ridingUserIds.clear()
      this.kartStates.clear()
      this.ballStates.clear()
      this.input.off('pointerdown', this.handleEditPointerDown, this)
      this.input.off('pointermove', this.handleEditPointerMove, this)
      this.input.off('pointerup', this.handleEditPointerUp, this)
      this.input.off('pointermove', this.handleDeskReminderPlacementPointerMove, this)
      this.input.off('pointerdown', this.handleDeskReminderPlacementPointerDown, this)
      this.cancelDeskReminderPlacement()
      this.editImages.forEach((image) => image.destroy())
      this.editImages.clear()
      this.editMarkers.forEach((marker) => marker.destroy())
      this.editMarkers.clear()
      this.eraseMarkers.forEach((marker) => marker.destroy())
      this.eraseMarkers.clear()
      this.areaEraseMarkers.forEach((marker) => marker.destroy())
      this.areaEraseMarkers.clear()
      this.setZonePreview(null)
      this.clearEditZoneOverlays()
    })
  }

  /** A conta em si é `computeAppliedZoom` (pura, testada). */
  private applyCameraZoom(): void {
    if (!this.cameras?.main) return
    const worldWidth = this.document.map.width * this.document.map.tileWidth
    const worldHeight = this.document.map.height * this.document.map.tileHeight
    const world = { width: worldWidth, height: worldHeight }
    const viewport = { width: this.scale.width || worldWidth, height: this.scale.height || worldHeight }
    const appliedZoom = computeAppliedZoom(world, viewport, this.cameraZoom)
    this.emitMinCameraZoom(computeMinCameraZoom(world, viewport))
    this.cameras.main.setZoom(appliedZoom)
    if (!this.youId) {
      this.cameras.main.centerOn(worldWidth / 2, worldHeight / 2)
    }
  }

  update(time: number, delta: number): void {
    // O tempo do QUADRO, não do relógio de parede: `stepBody` recebe `dtMs` por
    // parâmetro justamente para ser reexecutável na reconciliação.
    const dtMs = delta

    // Os outros são desenhados sempre — inclusive com a entrada travada (chat
    // em foco, edição): quem está de fora continua andando na tela de quem
    // parou.
    this.drawRemoteBodies(time)
    this.updateBalls(dtMs)

    if (!this.bodyPredictor || this.inputLocked || this.bridge.isMovementLocked()) {
      this.sinceInput = 0
      return
    }

    const sprint = this.shiftKey?.isDown ?? false
    // O teclado ganha da caminhada automática: quem toca uma tecla assume o
    // controle na hora (e o Seguir é cancelado por quem ouve `onInput`).
    const humano = this.pressedMove()
    const move = humano ?? this.autoMove
    const passo = move ? MOVE_DIRECTION_DELTAS[move] : { x: 0, y: 0 }

    // Input AMOSTRADO a taxa fixa, e o MESMO pacote aplicado localmente e
    // mandado. Prever a cada quadro e mandar a cada N faria o cliente simular um
    // tempo que o servidor nunca recebe — e a reconciliação puxaria o
    // personagem para trás sem parar.
    this.sinceInput += dtMs
    if (this.sinceInput < 1000 / BODY_INPUT_HZ) {
      this.drawOwnBody()
      return
    }
    const input = this.bodyPredictor.predict(passo.x, passo.y, this.sinceInput, sprint)
    this.sinceInput = 0
    // `null` = a fila de não confirmados estourou; o personagem para até o
    // servidor voltar a responder, em vez de andar em falso.
    // Mandar SEMPRE, inclusive parado: é o input parado que confirma ao servidor
    // que a pessoa soltou a tecla, e é o `seq` dele que mantém a reconciliação
    // andando. Silêncio deixaria o último passo pendurado.
    // A procedência viaja junto: sem ela, quem cancela o Seguir ao ver alguém
    // assumir o controle cancelaria o input que o PRÓPRIO Seguir gerou — o
    // personagem daria um passo e pararia (ver `OfficeInputSource`).
    if (input) this.bridge.emitInput(input, humano ? 'keyboard' : 'auto')
    // A caminhada automática esterça por ESTA posição, não pelo snapshot: é a
    // que o corpo está desenhando agora (ver `OfficeBridge.onSelfBody`). Sai
    // depois do `predict` de propósito — antes dele, seria a posição do quadro
    // anterior, e o esterço andaria um passo atrás.
    const body = this.bodyPredictor.current()
    this.bridge.emitSelfBody({ x: body.x, y: body.y })
    this.drawOwnBody()
  }

  /**
   * O passo que a predição roda — o MESMO que o servidor aplica.
   *
   * A escolha é feita A CADA input, e não uma vez na criação do preditor,
   * porque montar e desmontar acontece no meio da sessão. De kart, é
   * literalmente o passo da corrida: rumo contínuo, inércia e esterço que só
   * morde andando. Duas implementações de pilotagem divergiriam, e a pessoa
   * sentiria a diferença entre dirigir aqui e dirigir lá.
   */
  private stepFn(): (state: BodyKartState, input: BodyInput, grid: BodyCollisionGrid) => BodyKartState {
    return (state, input, grid) => {
      if (this.isRiding(this.youId)) return stepBodyKart(state, input, grid)
      // A pé, com os karts ESTACIONADOS como bloqueio — a mesma função e a
      // mesma lista que o servidor usa. Prever sem eles faria o cliente andar
      // por cima de um kart e ser puxado de volta a cada snapshot, que é o
      // "anda e volta" que a predição existe para não ter.
      return {
        ...state,
        ...stepBodyAmongBlockers(state, input, grid, this.parkedKartBlockers()),
      }
    }
  }

  /**
   * Solta fumaça das rodas quando o kart está rápido e fazendo curva.
   *
   * Serve aos dois: o próprio piloto entra com o esterço do teclado, e os
   * outros com o esterço MEDIDO no rumo interpolado (`emitRemoteKartSmoke`). A
   * regra de quando fumaçar é uma só (`kartSmoke`) — o que muda é de onde vem
   * o esterço, e o rateio por roda (`lastSmokeAt`) já é por usuário.
   */
  private emitKartSmoke(userId: string, estado: BodyKartState, steer: number, handbrake: boolean): void {
    const fumaca = kartSmoke(estado, steer, handbrake)
    if (!fumaca) return
    const agora = this.time.now
    fumaca.wheels.forEach((roda, indice) => {
      const chave = `${userId}:${indice}`
      if (agora - (this.lastSmokeAt.get(chave) ?? 0) < KART_SMOKE_INTERVAL_MS) return
      this.lastSmokeAt.set(chave, agora)
      // Abaixo do personagem: a nuvem sai de baixo do veículo, não por cima dele.
      puffKartSmoke(this, roda, fumaca.intensity, CHARACTER_DEPTH_BASE - 1)
    })
  }

  /**
   * Karts estacionados, como caixas que bloqueiam o passo.
   *
   * Só os ESTACIONADOS: um kart com piloto anda junto de alguém, e bloquear
   * nele bloquearia o próprio piloto. Espelha `OfficeHub.kartBlockers` —
   * divergir aqui é divergir da autoridade, e o sintoma é o personagem
   * atravessando o kart e voltando de teleporte.
   */
  private parkedKartBlockers(): BodyBlocker[] {
    const { tileWidth, tileHeight } = this.document.map
    return [...this.kartStates.values()]
      .filter((kart) => !kart.riderUserId)
      .map((kart) => ({
        x: kart.x,
        y: kart.y,
        halfWidth: tileWidth / 2,
        halfHeight: tileHeight / 2,
      }))
  }

  /** Põe o próprio personagem onde a predição diz que ele está. */
  private drawOwnBody(): void {
    if (!this.youId || !this.bodyPredictor) return
    const view = this.characters.get(this.youId)
    if (!view) return
    const estado = this.bodyPredictor.current()
    const andando = this.pressedMove() !== null || this.autoMove !== null
    const saiuDoLugar = view.pos.x !== estado.x || view.pos.y !== estado.y
    if (this.isRiding(this.youId)) {
      const move = this.pressedMove() ?? this.autoMove
      this.emitKartSmoke(this.youId, estado, move ? MOVE_DIRECTION_DELTAS[move].x : 0, this.shiftKey?.isDown ?? false)
    }
    this.placeBody(
      view,
      estado.x,
      estado.y,
      estado.dir,
      andando,
      this.shiftKey?.isDown ?? false,
      this.isRiding(this.youId) ? estado.heading : undefined,
    )
    if (saiuDoLugar) this.reattachCameraIfDetached()
  }

  /**
   * Devolve o acompanhamento da câmera depois de um arraste ou um zoom.
   *
   * Arrastar e dar zoom SOLTAM a câmera de propósito (`CAMERA_DETACHED`), para
   * a pessoa poder olhar o escritório sem ser puxada de volta. Ela volta
   * sozinha, com uma transição suave, quando o personagem focado ANDA — e é
   * andar, não estar de pé, senão o arraste seria desfeito no quadro seguinte e
   * olhar em volta ficaria impossível.
   *
   * Isto morava no `step()` do modelo de grade. Com ele aposentado, a câmera
   * ficava solta para sempre depois do primeiro zoom.
   */
  private reattachCameraIfDetached(): void {
    if (this.panGesture) return
    if (this.focusedCameraUserId !== OfficeScene.CAMERA_DETACHED) return
    const targetId = this.focusUserId ?? this.youId
    if (this.youId !== targetId) return
    this.applyCameraFocus(false)
  }

  /** Desenha os outros a partir do buffer de interpolação. */
  private drawRemoteBodies(now: number): void {
    for (const [userId, view] of this.characters) {
      if (userId === this.youId) continue
      const at = this.bodyInterpolator.at(userId, now)
      if (!at) continue
      const anterior = this.lastRemoteDraw.get(userId)
      // "Está andando?" sai do movimento INTERPOLADO, não de um campo no
      // pacote: é o que a pessoa vê na tela, então é o que a animação deve
      // acompanhar — e economiza um bit por jogador no snapshot.
      const andando =
        anterior !== undefined && Math.hypot(at.x - anterior.x, at.y - anterior.y) > REMOTE_IDLE_EPSILON
      // O RUMO do kart dos outros. Ele vem no snapshot (`h`) e o interpolador
      // já o gira pelo arco curto — o que faltava era ENTREGÁ-LO ao desenho:
      // sem isto o kart do colega ficava apontado para onde nasceu enquanto
      // deslizava para qualquer lado, e a diagonal não batia com a que ele
      // mesmo vê. Só de quem está montado, senão um rumo velho sobreviveria à
      // desmontagem e giraria o kart seguinte.
      const heading = this.isRiding(userId) ? at.heading ?? anterior?.heading : undefined
      if (heading !== undefined) this.emitRemoteKartSmoke(userId, at, heading, anterior, now)
      this.lastRemoteDraw.set(userId, { x: at.x, y: at.y, heading, at: now })
      this.placeBody(view, at.x, at.y, at.dir, andando, this.remoteSprint.has(userId), heading)
    }
  }

  /**
   * Fumaça das rodas do kart dos OUTROS.
   *
   * Antes só o próprio piloto fumaçava, porque a intenção de esterço é a única
   * coisa do controle que o cliente tem. Mas ela não é a única coisa
   * OBSERVÁVEL: o rumo viaja no snapshot e chega interpolado, e a taxa com que
   * ele gira é medida — ver `remoteKartSteer`. A velocidade sai do movimento
   * interpolado pelo mesmo motivo do "está andando?": é a que aparece na tela.
   *
   * O freio de mão é o `sprint` do snapshot, que no kart é o mesmo gesto (a
   * mesma tecla que derrapa é a que corre a pé) — esse, sim, viaja.
   */
  private emitRemoteKartSmoke(
    userId: string,
    at: { x: number; y: number; dir: Direction },
    heading: number,
    anterior: { x: number; y: number; heading?: number; at: number } | undefined,
    now: number,
  ): void {
    if (!anterior || anterior.heading === undefined) return
    const dtMs = now - anterior.at
    if (dtMs <= 0) return
    const speed = Math.hypot(at.x - anterior.x, at.y - anterior.y) / (dtMs / 1000)
    this.emitKartSmoke(
      userId,
      { x: at.x, y: at.y, dir: at.dir, heading, speed },
      remoteKartSteer(anterior.heading, heading, dtMs),
      this.remoteSprint.has(userId),
    )
  }

  /**
   * Posiciona um personagem em PIXEL e acerta a animação.
   *
   * Substituiu o `step()` de tween entre centros de tile. Não há mais tween: a
   * posição é contínua e escrita a cada quadro — que é, no fim, a diferença
   * inteira entre teleportar de célula em célula e deslizar.
   */
  private placeBody(
    view: CharacterView,
    x: number,
    y: number,
    dir: Direction,
    moving: boolean,
    sprint: boolean,
    heading?: number,
  ): void {
    view.pos = { x, y }
    // Simula em float, DESENHA em inteiro: posição fracionária faz o sprite cair
    // entre texels e a arte tremer a cada quadro.
    view.container.setPosition(Math.round(x), Math.round(y))
    const tileY = Math.floor(y / this.document.map.tileHeight)
    view.tile = { x: Math.floor(x / this.document.map.tileWidth), y: tileY }
    // Ordem de profundidade pelo TILE, não pelo pixel: é a mesma escala que a
    // mobília usa, e é o que faz quem está mais ao sul aparecer na frente.
    // Sem isto o personagem para de reordenar ao andar — passa a ficar sempre
    // atrás (ou sempre na frente) de quem estava lá quando ele nasceu.
    if (view.container.depth !== CHARACTER_DEPTH_BASE + tileY) {
      view.container.setDepth(CHARACTER_DEPTH_BASE + tileY)
    }
    if (view.lastDir !== dir) this.face(view, dir)
    // Andar apaga o pensamento na hora, sem esperar o `thought-cleared` do
    // servidor: quem se mexe é o primeiro a olhar o próprio balão, e a volta
    // pela rede deixaria o pensamento sobrando por um punhado de quadros.
    if (moving && view.bubbleKind === 'thought') this.clearBubble(view)
    this.updateConfettiDirection(view.userId, dir)
    // O veículo gira pelo RUMO, e não pelas quatro poses: é o que separa
    // "dirigir" de "andar rápido", e é o mesmo desenho da corrida. A pose do
    // LPC continua discreta — quem gira de verdade é a textura do kart.
    if (view.kart && heading !== undefined) {
      view.kart.setRotation(heading + KART_TEXTURE_OFFSET)
      positionKartRider(view)
    }

    if (!view.textureKey || !('play' in view.body)) return
    const sprite = view.body as Phaser.GameObjects.Sprite
    const animKey = `${view.textureKey}-walk-${dir}`
    if (moving) {
      if (!sprite.anims.isPlaying || sprite.anims.currentAnim?.key !== animKey) {
        sprite.play(animKey, true)
      }
      // Pernas mais rápidas na corrida, senão o personagem parece deslizar.
      sprite.anims.timeScale = sprint ? SPRINT_ANIM_TIME_SCALE : 1
    } else if (sprite.anims.isPlaying) {
      sprite.anims.stop()
      sprite.setFrame(characterIdleFrame(dir))
    }
  }

  /**
   * R = gira o personagem local no lugar, um quarto de volta (sentido horário)
   * por toque — nunca anda, mesmo com o caminho livre à frente. Prediz local
   * (igual `applyLocalIntent`) e avisa o servidor via `face`, que só troca a
   * direção do occupant e faz broadcast (`office-hub.face`), sem checar colisão.
   */
  private rotateLocal(): void {
    if (this.inputLocked || this.bridge.isMovementLocked() || this.modifierKeyDown) return
    if (!this.youId || !this.bridge.isConnected()) return
    const view = this.characters.get(this.youId)
    if (!view) return
    const nextDir = ROTATE_CLOCKWISE[view.lastDir]
    this.face(view, nextDir)
    this.updateConfettiDirection(this.youId, nextDir)
    this.bridge.emitClientMessage({ type: 'face', dir: nextDir })
  }

  /**
   * Segurar a tecla anda continuamente, na cadência do `INPUT_COOLDOWN_MS` — que
   * é o mesmo teto do rate limit do servidor, para não gerar tráfego descartado.
   *
   * Compõe VERTICAL + HORIZONTAL: com as duas pressionadas sai a diagonal. Os
   * eixos opostos se anulam (segurar A e D não anda de lado nenhum), o que
   * também evita mandar passo quando o dedo troca de direção sem soltar.
   */
  private pressedMove(): MoveDirection | null {
    if (!this.keys || this.modifierKeyDown) return null
    const down = (dir: Direction) => this.keys?.[dir].some((key) => key.isDown) ?? false
    const vertical = down('up') === down('down') ? '' : down('up') ? 'up' : 'down'
    const horizontal = down('left') === down('right') ? '' : down('left') ? 'left' : 'right'
    if (vertical && horizontal) return `${vertical}-${horizontal}` as MoveDirection
    return (vertical || horizontal || null) as MoveDirection | null
  }

  private releaseDirectionKeys(): void {
    if (!this.keys) return
    for (const keys of Object.values(this.keys)) {
      for (const key of keys) key.reset()
    }
  }

  private handle(message: OfficeServerMessage): void {
    switch (message.type) {
      case 'welcome': {
        this.youId = message.youId
        this.kartStates = new Map((message.karts ?? []).map((kart) => [kart.id, kart]))
        this.ballStates = new Map((message.balls ?? []).map((ball) => [ball.id, ball]))
        this.refreshBallVisuals()
        // Reconexão: o welcome é o estado completo, então recomeça do zero.
        for (const userId of [...this.characters.keys()]) this.destroyCharacter(userId)
        for (const occupant of message.occupants) this.spawn(occupant)
        // Quem já estava segurando F antes de eu entrar/reconectar: acende o
        // confete já no snapshot, sem esperar um novo keydown que talvez nunca venha.
        for (const userId of message.confettiUserIds ?? []) this.setConfetti(userId, true)
        // Mesma ideia para quem já está com a mão levantada no snapshot.
        for (const userId of message.handRaisedUserIds ?? []) this.setHandRaised(userId, true)
        // …e a tinta ainda viva, com o prazo já descontado pelo servidor: quem
        // reconecta no meio de uma partida volta pintado do jeito que estava.
        for (const splat of message.paintSplats ?? []) this.applyPaintSplat(splat)
        // …e para quem já estava de kart: o estado vem no próprio occupant.
        this.ridingUserIds.clear()
        for (const occupant of message.occupants) {
          if (!occupant.ridingKartId) continue
          this.ridingUserIds.add(occupant.userId)
          this.applyKartVisual(occupant.userId, true)
        }
        this.refreshKartVisuals()
        const you = message.occupants.find((o) => o.userId === message.youId)
        if (you) {
          // A posição de nascimento é do SERVIDOR. Daqui em diante quem responde
          // "onde estou" é a predição, reconciliada a cada snapshot.
          this.bodyPredictor = new ArenaPredictor<BodyKartState>(
            { x: you.x, y: you.y, dir: you.dir, heading: 0, speed: 0 },
            bodyCollisionGrid(this.document),
            { speed: BODY_SPEED },
            this.stepFn(),
          )
          // A presença do escritório sobrevive a uma queda: retomar a numeração
          // de onde o servidor parou é o que impede a reconexão de congelar o
          // personagem (ver `welcome.seq`).
          this.bodyPredictor.resumeAt(message.seq ?? 0)
        }
        this.applyCameraFocus(true)
        break
      }
      case 'joined':
        this.spawn(message.occupant)
        // Reconexão de quem estava de kart: o occupant já vem montado.
        if (message.occupant.ridingKartId) {
          this.ridingUserIds.add(message.occupant.userId)
          this.applyKartVisual(message.occupant.userId, true)
        }
        break
      case 'left':
        // O kart morre junto com o container do personagem; só o registro de
        // quem dirige é nosso pra limpar.
        this.ridingUserIds.delete(message.userId)
        this.destroyCharacter(message.userId)
        break
      case 'snapshot': {
        const agora = this.time.now
        // Os OUTROS entram no buffer de interpolação; o próprio não passa por
        // ele — quem precisa de resposta imediata é quem está com a mão no
        // teclado, e esse é reconciliado (ver `ArenaPredictor`).
        this.bodyInterpolator.push(
          message.players.filter((player) => player.userId !== this.youId),
          agora,
        )
        for (const player of message.players) {
          if (player.sprint) this.remoteSprint.add(player.userId)
          else this.remoteSprint.delete(player.userId)
          this.syncRiddenKartState(player.userId, player.x, player.y, player.dir)
          this.recoverMissingView(player.userId)
        }
        // A bola autoritativa. O cliente integra a MESMA física entre
        // snapshots, mas sem esta correção ele integraria para sempre a partir
        // do último chute — e a bola iria divergindo do servidor até parar num
        // lugar que só existe nesta tela.
        if (message.balls) {
          for (const ball of message.balls) this.ballStates.set(ball.id, { ...ball })
          this.refreshBallVisuals()
        }
        const you = message.players.find((player) => player.userId === this.youId)
        if (you && this.bodyPredictor) {
          // Rumo e velocidade fazem parte do estado autoritativo de quem está
          // de kart: reancorar sem eles reexecutaria os pendentes a partir de um
          // veículo apontado para outro lado, e a correção viria como um tranco.
          this.bodyPredictor.reconcile(
            { x: you.x, y: you.y, dir: you.dir, heading: you.h ?? 0, speed: you.v ?? 0 },
            you.seq,
          )
        }
        break
      }
      case 'faced': {
        this.syncRiddenKartState(message.userId, undefined, undefined, message.dir)
        // Próprio já girado pela predição local (ver `rotateLocal`): o eco só confirma.
        if (message.userId === this.youId) break
        const view = this.characters.get(message.userId)
        if (view) this.face(view, message.dir)
        break
      }
      case 'nearby-message':
        // Com a grade aberta, reação usa o overlay HTML para ficar acima dos
        // tiles. Fora da grade, mantém o balão preso ao personagem no canvas.
        if (message.kind !== 'reaction' || !this.floatingReactionsActive) {
          this.showNearbyBubble(message.userId, message.text, message.kind ?? 'speech')
        }
        break
      case 'thought-cleared':
        this.clearThoughtBubble(message.userId)
        break
      case 'avatar-updated': {
        const view = this.characters.get(message.userId)
        if (view) {
          // Parte do avatar, e não o avatar inteiro: o marcador de paintball
          // é estado de jogo e não vem neste payload — recompor a partir do
          // zero desarmaria quem trocou de roupa no meio da partida.
          view.avatar = {
            ...view.avatar,
            avatarSeed: message.avatarSeed,
            avatarOptions: message.avatarOptions,
          }
          this.loadCharacterSprite(view.avatar, view)
        }
        break
      }
      case 'confetti':
        this.setConfetti(message.userId, message.active)
        break
      case 'hand-raised':
        this.setHandRaised(message.userId, message.active)
        break
      case 'celebration':
        this.celebrate()
        break
      case 'high-five':
        this.playHighFive(message.userIds, message.perfect)
        break
      case 'kart-ride':
        this.kartStates.set(message.kart.id, message.kart)
        if (message.active) this.ridingUserIds.add(message.userId)
        else this.ridingUserIds.delete(message.userId)
        this.applyKartVisual(message.userId, message.active)
        this.refreshKartVisuals()
        break
      case 'ball-kicked':
        this.playBallKick(message.userId, message.ball, message.power)
        break
      case 'paint-marker':
        this.setPaintMarker(message.userId, message.active)
        break
      case 'paintball-shot':
        this.playPaintballShot(message.shot)
        break
      case 'balls-updated':
        this.ballStates = new Map(message.balls.map((ball) => [ball.id, ball]))
        this.refreshBallVisuals()
        break
      case 'karts-updated': {
        const previousRiders = new Set(this.ridingUserIds)
        this.kartStates = new Map(message.karts.map((kart) => [kart.id, kart]))
        this.ridingUserIds = new Set(
          message.karts.flatMap((kart) => (kart.riderUserId ? [kart.riderUserId] : [])),
        )
        for (const userId of new Set([...previousRiders, ...this.ridingUserIds])) {
          this.applyKartVisual(userId, this.ridingUserIds.has(userId))
        }
        this.refreshKartVisuals()
        break
      }
      case 'desk-claimed':
        this.setDeskClaim(message.externalKey, message.user.name)
        break
      case 'desk-released':
        this.setDeskClaim(message.externalKey, null)
        this.deskReminders = this.deskReminders.filter((reminder) => reminder.deskExternalKey !== message.externalKey)
        this.renderDeskReminderGifts()
        break
      case 'desk-reminder-created':
        this.deskReminders = [
          ...this.deskReminders.filter((reminder) => reminder.id !== message.reminder.id),
          message.reminder,
        ]
        this.renderDeskReminderGifts()
        break
      case 'desk-reminder-read':
        this.deskReminders = this.deskReminders.filter((reminder) => reminder.id !== message.reminderId)
        this.renderDeskReminderGifts()
        break
    }
  }

  private renderDeskReminderGifts(): void {
    for (const gift of this.deskReminderGifts.values()) gift.destroy()
    this.deskReminderGifts.clear()

    for (const reminder of this.deskReminders) {
      const position = this.deskPositions.get(reminder.deskExternalKey)
      const bounds = this.deskBounds.get(reminder.deskExternalKey)
      if (!position || !bounds) continue

      const giftX = bounds.x + bounds.width * reminder.giftPosition.x
      const giftY = bounds.y + bounds.height * reminder.giftPosition.y
      const gift = this.createDeskReminderGift(giftX, giftY)
      gift.setDepth(141)
      this.deskReminderGifts.set(reminder.id, gift)
    }
  }

  private createDeskReminderGift(x: number, y: number): Phaser.GameObjects.Container {
    const gift = this.add.container(x, y)
    const shadow = this.add.ellipse(0, 6, 16, 5, OFFICE_DESK_REMINDER_GIFT_COLORS.shadow, 0.22)
    const box = this.add.rectangle(0, 2, 14, 11, OFFICE_DESK_REMINDER_GIFT_COLORS.box, 1)
    const lid = this.add.rectangle(0, -4, 16, 5, OFFICE_DESK_REMINDER_GIFT_COLORS.lid, 1)
    const ribbonV = this.add.rectangle(0, 1, 3, 16, OFFICE_DESK_REMINDER_GIFT_COLORS.ribbon, 1)
    const ribbonH = this.add.rectangle(0, -4, 18, 2, OFFICE_DESK_REMINDER_GIFT_COLORS.ribbon, 1)
    const bowLeft = this.add.triangle(-3, -8, 0, 3, -5, -1, 0, -5, OFFICE_DESK_REMINDER_GIFT_COLORS.ribbon, 1)
    const bowRight = this.add.triangle(3, -8, 0, 3, 5, -1, 0, -5, OFFICE_DESK_REMINDER_GIFT_COLORS.ribbon, 1)
    gift.add([shadow, box, lid, ribbonV, ribbonH, bowLeft, bowRight])
    gift.setData('label', OFFICE_DESK_REMINDER_GIFT_LABEL)
    return gift
  }

  private syncRiddenKartState(
    userId: string,
    x: number | undefined,
    y: number | undefined,
    dir: Direction,
  ): void {
    const kart = [...this.kartStates.values()].find((candidate) => candidate.riderUserId === userId)
    if (!kart) return
    this.kartStates.set(kart.id, {
      ...kart,
      x: x ?? kart.x,
      y: y ?? kart.y,
      dir,
    })
  }

  /**
   * Cria (ou reaproveita) o emissor de confete de um personagem, fazendo-o
   * seguir o container pra acompanhar a pessoa andando. `active:false` só
   * `stop()`: as partículas em voo terminam naturalmente, sem sumir abrupto.
   */
  private setConfetti(userId: string, active: boolean): void {
    const view = this.characters.get(userId)
    if (!view) return
    if (!active) {
      const emitter = this.confettiEmitters.get(userId)
      if (emitter) {
        emitter.stop()
        // Remove do map já aqui: se não, `updateConfettiDirection` acha esse
        // emissor "morto" ainda vivo na próxima virada de direção e o
        // recria já emitindo — soltar F uma vez não seria mais suficiente.
        this.confettiEmitters.delete(userId)
        this.time.delayedCall(CONFETTI_LAUNCH_LIFESPAN, () => emitter.destroy())
      }
      return
    }
    const existing = this.confettiEmitters.get(userId)
    if (existing) {
      existing.start()
      return
    }
    const emitter = this.add.particles(0, 0, CONFETTI_TEXTURE, confettiLaunchConfig(view.lastDir))
    emitter.setDepth(CONFETTI_DEPTH)
    emitter.startFollow(view.container)
    this.confettiEmitters.set(userId, emitter)
  }

  /**
   * Ícone de mão levantada (emoji, sem asset) sobre o personagem — vale em
   * QUALQUER lugar do escritório, não só em sala de reunião (estado global,
   * mesmo padrão do confete). É filho de `view.container`, então acompanha o
   * personagem andando e some sozinho quando o personagem é destruído
   * (`container.destroy()` cascateia) — sem precisar de um Map à parte.
   */
  private setHandRaised(userId: string, active: boolean): void {
    const view = this.characters.get(userId)
    if (!view) return
    if (!active) {
      view.handIcon?.destroy()
      view.handIcon = undefined
      return
    }
    if (view.handIcon) return
    const icon = this.add.text(0, -60, '✋', { fontSize: '20px' }).setOrigin(0.5, 1)
    icon.setDepth(CONFETTI_DEPTH)
    view.container.add(icon)
    view.handIcon = icon
  }

  /**
   * Confete ativo acompanha a direção atual do personagem em tempo real.
   * Chamado ANTES de `face()` nos mesmos pontos (virar/andar) — compara
   * contra `view.lastDir` (ainda não atualizado) pra só agir numa mudança
   * de direção de verdade, nunca a cada passo reto.
   *
   * `ParticleEmitter#setEmitterAngle` NÃO redefine o range aleatório
   * min/max de um emissor já criado — só ajusta (com clamp) dentro do range
   * original da criação, então girar não tinha efeito nenhum com essa API.
   * A correção é recriar o emissor com o ângulo novo: para o antigo (as
   * partículas em voo terminam sozinhas, mesmo espírito do `active:false`)
   * e agenda o destroy pra depois do lifespan delas.
   */
  private updateConfettiDirection(userId: string, dir: Direction): void {
    const view = this.characters.get(userId)
    const old = this.confettiEmitters.get(userId)
    if (!view || !old || view.lastDir === dir) return
    old.stop()
    this.time.delayedCall(CONFETTI_LAUNCH_LIFESPAN, () => old.destroy())
    const emitter = this.add.particles(0, 0, CONFETTI_TEXTURE, confettiLaunchConfig(dir))
    emitter.setDepth(CONFETTI_DEPTH)
    emitter.startFollow(view.container)
    this.confettiEmitters.set(userId, emitter)
  }

  /**
   * Ondas discretas acima do personagem enquanto o mic da pessoa está
   * falando (LiveKit `ActiveSpeakersChanged`, repassado 100% local pelo
   * bridge — nunca pelo servidor, ver `OfficeBridge.emitSpeakingChanged`).
   * Mais sutil que a versão do grid de vídeo: 2 anéis finos, sem respawnar o
   * personagem — mesmo padrão de `setConfetti` (lookup em `characters`,
   * anexa/remove um `GameObject` extra no `container`).
   */
  private setSpeaking(userId: string, speaking: boolean): void {
    const view = this.characters.get(userId)
    if (!view) return
    if (!speaking) {
      for (const tween of view.speakingTweens ?? []) tween.stop()
      for (const ring of view.speakingRings ?? []) ring.destroy()
      view.speakingRings = undefined
      view.speakingTweens = undefined
      return
    }
    if (view.speakingRings) return // já animando

    const rings = [0, 1].map(() => {
      const ring = this.add.graphics()
      ring.lineStyle(1, 0x52fba2, 0.85)
      ring.strokeCircle(0, 0, 9)
      ring.setPosition(0, -8) // centralizado no personagem
      ring.setAlpha(0)
      view.container.add(ring)
      return ring
    })
    view.speakingRings = rings
    view.speakingTweens = rings.map((ring, index) =>
      this.tweens.add({
        targets: ring,
        scale: { from: 1, to: 1.6 },
        alpha: { from: 0.75, to: 0 },
        duration: 1400,
        delay: index * 700,
        ease: 'Sine.easeOut',
        repeat: -1,
      }),
    )
  }

  /**
   * Comemoração coletiva (5+ segurando F): banner fixo na câmera com fade,
   * burst de confete cobrindo a tela e aplausos sintetizados. Tudo efêmero e
   * fixo na viewport (scrollFactor 0), some sozinho.
   */
  private celebrate(): void {
    const width = this.scale.width
    const banner = this.add
      .text(width / 2, 72, '🎉 Comemoração!', {
        fontFamily: 'sans-serif',
        fontSize: '30px',
        color: '#ffffff',
        backgroundColor: '#7c3aed',
        padding: { x: 18, y: 10 },
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(CELEBRATION_DEPTH)
      .setAlpha(0)
    this.tweens.add({
      targets: banner,
      alpha: 1,
      duration: 400,
      hold: 2200,
      yoyo: true,
      ease: 'Sine.easeInOut',
      onComplete: () => banner.destroy(),
    })

    const burst = this.add.particles(0, 0, CONFETTI_TEXTURE, confettiBurstConfig(width))
    burst.setDepth(CELEBRATION_DEPTH - 1)
    burst.setScrollFactor(0)
    burst.explode(CONFETTI_BURST_COUNT)
    this.time.delayedCall(CONFETTI_BURST_LIFESPAN + 300, () => burst.destroy())

    // A comemoração é global (todo mundo vê o confete); quem cala o som na sala
    // de silêncio é o portão dentro de `playApplauseSound`.
    playApplauseSound()
  }

  /**
   * Para os tweens do personagem antes de destruir o container. O tween do
   * Phaser escreve em `target[key]` sem checar se o alvo ainda é válido, então
   * destruir o container primeiro deixa o tween (e o `onComplete`) rodando
   * contra um objeto morto até `STEP_MS` depois.
   */
  private destroyCharacter(userId: string): void {
    const view = this.characters.get(userId)
    if (!view) return
    view.tween?.stop()
    view.bobTween?.stop()
    view.spinTween?.stop()
    // Anéis são filhos do container (`view.container.add(ring)`) — o
    // `container.destroy()` abaixo já os destrói em cascata; só os tweens
    // precisam parar antes, pelo mesmo motivo do comentário desta função.
    for (const tween of view.speakingTweens ?? []) tween.stop()
    this.clearBubble(view)
    const emitter = this.confettiEmitters.get(userId)
    if (emitter) {
      emitter.stop()
      emitter.destroy()
      this.confettiEmitters.delete(userId)
    }
    view.container.destroy()
    this.characters.delete(userId)
    // O último quadro dele não sobrevive à saída: quem volta depois entraria
    // com um `dt` de minutos e um salto de mapa inteiro — velocidade e "está
    // andando?" saem os dois desse delta.
    this.lastRemoteDraw.delete(userId)
  }

  private spawn(occupant: OfficeOccupant): void {
    if (this.characters.has(occupant.userId)) this.destroyCharacter(occupant.userId)

    const { px, py } = tileCenter(this.document, occupant.x, occupant.y)
    // Enquanto o spritesheet LPC é composto (local, ~centenas de ms), só o
    // spinner + nome; o personagem assume em loadCharacterSprite.
    const body = this.add.image(0, 0, 'char-loading')
    body.setAlpha(0.85)

    // Nome/status agora é um badge React (CharacterOverlay), posicionado por
    // tela sobre o canvas — não desenha mais nada aqui pra isso.
    const container = this.add.container(px, py, [body])

    // Torna o personagem clicável. Container não tem tamanho implícito: a hit
    // area é um retângulo em coordenadas LOCAIS (re-ajustada quando o sprite
    // assume). O clique só emite o userId — a UI vive no React.
    const userId = occupant.userId
    container.setInteractive(
      new Phaser.Geom.Rectangle(-9, -19, 18, 34),
      Phaser.Geom.Rectangle.Contains,
    )
    container.input!.cursor = 'pointer'
    container.on('pointerdown', () => {
      // Em modo de edição, um clique num personagem não deve também disparar
      // o card/perfil (pintura ou área de edição tomam precedência) — Task C6.
      if (this.editing) return
      this.bridge.emitCharacterClick(userId)
    })

    // Em TILE, como no `placeBody` — `occupant.y` virou pixel, e somar pixel
    // aqui poria todo personagem à frente da mobília.
    container.setDepth(CHARACTER_DEPTH_BASE + Math.floor(occupant.y / this.document.map.tileHeight))

    const view: CharacterView = {
      userId: occupant.userId,
      container,
      body,
      pos: { x: occupant.x, y: occupant.y },
      bodyBaseY: 0,
      hasAvatar: false,
      lastDir: occupant.dir,
      tile: { x: occupant.x, y: occupant.y },
      avatar: {
        userId: occupant.userId,
        avatarStyle: occupant.avatarStyle,
        avatarSeed: occupant.avatarSeed,
        avatarOptions: occupant.avatarOptions,
        paintMarker: occupant.paintMarker,
      },
    }
    view.spinTween = this.tweens.add({
      targets: body,
      angle: 360,
      duration: 900,
      repeat: -1,
    })
    this.characters.set(occupant.userId, view)
    this.loadCharacterSprite(view.avatar, view)
    if (occupant.thoughtText) this.showNearbyBubble(occupant.userId, occupant.thoughtText, 'thought')
    const targetId = this.focusUserId ?? this.youId
    if (occupant.userId === targetId) this.applyCameraFocus(this.focusedCameraUserId === null)
  }

  /**
   * Compõe o spritesheet LPC do occupant (camadas de /lpc/ em canvas) e assume
   * o personagem quando pronto. Composição é local e rápida (~centenas de ms);
   * em falha (404 de camada) o spinner fica — sem rede não há o que mostrar.
   */
  private loadCharacterSprite(occupant: CharacterAvatar, view: CharacterView): void {
    const textureKey = occupantTextureKey(occupant)
    if (this.textures.exists(textureKey)) {
      this.applyCharacterSprite(view, textureKey)
      return
    }
    const options = occupantCharacterOptions(occupant)
    void composeCharacterSheet(options, undefined, occupantExtraLayers(occupant))
      .then((sheet) => {
        // O occupant pode ter saído (ou a cena morrido) durante a composição —
        // nesses casos o view registrado já não é este e nada deve acontecer.
        if (this.characters.get(occupant.userId) !== view) return
        if (!this.textures.exists(textureKey)) {
          // Phaser 3.60+ aceita HTMLCanvasElement como source do spritesheet
          // (TextureSource.isCanvas); a assinatura .d.ts só lista
          // HTMLImageElement, daí o cast.
          this.textures.addSpriteSheet(textureKey, sheet as unknown as HTMLImageElement, {
            frameWidth: CHARACTER_FRAME_SIZE,
            frameHeight: CHARACTER_FRAME_SIZE,
          })
        }
        this.applyCharacterSprite(view, textureKey)
      })
      .catch(() => {})
  }

  private applyCharacterSprite(view: CharacterView, textureKey: string): void {
    view.bobTween?.stop()
    view.spinTween?.stop()
    view.spinTween = undefined
    view.body.destroy()

    const sprite = this.add.sprite(0, CHARACTER_BASE_Y, textureKey, characterIdleFrame(view.lastDir))
    sprite.setOrigin(0.5, 1)
    sprite.setDisplaySize(CHARACTER_DISPLAY, CHARACTER_DISPLAY)
    this.ensureWalkAnimations(textureKey)

    view.container.addAt(sprite, 0) // atrás do label (e de futuros balões)
    view.body = sprite
    view.bodyBaseY = CHARACTER_BASE_Y
    view.hasAvatar = true
    view.textureKey = textureKey

    // A hit area de clique cobre o personagem (coordenadas locais).
    const hit = view.container.input?.hitArea as Phaser.Geom.Rectangle | undefined
    hit?.setTo(-CHARACTER_DISPLAY / 2, CHARACTER_BASE_Y - CHARACTER_DISPLAY, CHARACTER_DISPLAY, CHARACTER_DISPLAY)

    this.face(view, view.lastDir)
    // O sprite LPC pode chegar depois do `kart-ride` (composição assíncrona)
    // ou ser trocado por `avatar-updated`. Nos dois casos, reaplica recorte,
    // posição e ordem de camada para o piloto não voltar a aparecer em pé.
    if (this.isRiding(view.userId)) this.applyKartVisual(view.userId, true)
  }

  /** Uma animação de walk por direção e por textura (idempotente). */
  private ensureWalkAnimations(textureKey: string): void {
    for (const dir of ['up', 'down', 'left', 'right'] as const) {
      const key = `${textureKey}-walk-${dir}`
      if (this.anims.exists(key)) continue
      this.anims.create({
        key,
        frames: characterWalkFrames(dir).map((frame) => ({ key: textureKey, frame })),
        frameRate: WALK_FRAME_RATE,
        repeat: -1,
      })
    }
  }

  private applyCameraFocus(immediate = false): void {
    if (!this.cameras?.main) return
    const targetId = this.focusUserId ?? this.youId
    const view = targetId ? this.characters.get(targetId) : null
    if (!targetId || !view || this.focusedCameraUserId === targetId) return

    this.focusTimer?.remove(false)
    this.focusTimer = null

    const camera = this.cameras.main
    const startFollowing = () => {
      const currentTargetId = this.focusUserId ?? this.youId
      const currentView = currentTargetId ? this.characters.get(currentTargetId) : null
      if (!currentTargetId || !currentView) return
      // COLADA, sem lerp — a mesma escolha da arena, e pelo mesmo motivo.
      //
      // Com lerp a câmera persegue o personagem, e o scroll cai em valores
      // fracionários; com `roundPixels`, esses valores arredondam num ritmo
      // diferente do da posição do personagem (que também é arredondada), e o
      // resultado é o personagem TREMENDO contra o cenário.
      //
      // No modelo de grade isso não aparecia: o passo era um tween de 150ms
      // entre centros de tile, longo e uniforme o bastante para a câmera
      // arrastar junto sem bater. Com posição contínua amostrada a 30Hz, o
      // descompasso vira tremor.
      //
      // A transição ao trocar de foco NÃO depende do lerp: quem a faz é o
      // `camera.pan` logo abaixo.
      camera.startFollow(currentView.container, true)
      this.focusedCameraUserId = currentTargetId
    }

    if (immediate || this.focusedCameraUserId === null) {
      startFollowing()
      return
    }

    camera.stopFollow()
    // Marca a transição como "reivindicada" JÁ AQUI (não só quando o
    // `startFollowing` do fim do pan rodar) — senão, cada passo do
    // personagem durante o pan (que dura `CAMERA_FOCUS_MS`) vê
    // `focusedCameraUserId` ainda como `CAMERA_DETACHED` em `step` e
    // reinicia esse mesmo pan do zero. Andando contínuo, o pan nunca
    // termina — fica reiniciando pra sempre, o que parece um "puxa-e-solta"
    // (a câmera tentando recentralizar sem nunca conseguir).
    this.focusedCameraUserId = targetId
    camera.pan(view.container.x, view.container.y, CAMERA_FOCUS_MS, 'Sine.easeInOut', true)
    this.focusTimer = this.time.delayedCall(CAMERA_FOCUS_MS, () => {
      this.focusTimer = null
      startFollowing()
    })
  }

  /**
   * Os dois balões de 👋 convergem pro ponto médio, dão um pop no impacto e
   * somem. Os balões pertencem ao fluxo de reação (`showNearbyBubble`) — aqui
   * a gente para o tween em curso deles e assume o controle, porque podem estar
   * em fases diferentes (um acenou há 2s, outro agora).
   */
  private playHighFive(userIds: [string, string], perfect = false): void {
    const views = userIds.map((id) => this.characters.get(id))
    const [a, b] = views
    // Balão já sumiu (borda da janela de 3s do servidor) ou não é reação:
    // melhor perder um high-five do que animar mãos que não estão na tela.
    if (!a?.bubble || a.bubbleKind !== 'reaction') return
    if (!b?.bubble || b.bubbleKind !== 'reaction') return

    // Ponto médio nos dois eixos: o par válido é sempre adjacente, e metade
    // dos casos é vertical (mesma coluna).
    const midX = (a.container.x + b.container.x) / 2
    const midY = (a.container.y + b.container.y) / 2

    for (const view of [a, b]) {
      view.bubbleTween?.stop()
      const bubble = view.bubble
      if (!bubble) continue
      // `stop()` do Phaser não faz snap pros valores finais. Quem acabou de
      // acenar pode estar com o balão ainda invisível no primeiro frame.
      bubble.alpha = 1
      view.bubbleTween = this.tweens.chain({
        targets: bubble,
        tweens: [
          {
            // Balão é filho do container, então o alvo vai em coords locais.
            x: midX - view.container.x,
            y: midY + REACTION_REST_Y - view.container.y,
            duration: HIGH_FIVE_APPROACH_MS,
            ease: 'Back.easeIn',
          },
          {
            scale: perfect ? HIGH_FIVE_PERFECT_POP_SCALE : HIGH_FIVE_POP_SCALE,
            duration: HIGH_FIVE_POP_MS,
            yoyo: true,
            ease: 'Quad.easeOut',
          },
          {
            alpha: 0,
            duration: HIGH_FIVE_FADE_MS,
            ease: 'Sine.easeIn',
          },
        ],
        onComplete: () => this.clearBubble(view),
      })
    }

    // O clarão da palma perfeita acompanha a animação, não o som: quem está
    // longe demais pra ouvir o estalo ainda vê o par se acertando.
    if (perfect) {
      this.time.delayedCall(HIGH_FIVE_APPROACH_MS, () =>
        this.showPerfectClapFlash(midX, midY + REACTION_REST_Y),
      )
    }

    // No impacto, não na largada. Só para quem está na região do high-five —
    // a animação continua global (os balões de reação também são).
    if (highFiveWithinEarshot(this.document, this.youId, (id) => this.bridge.occupantSnapshot(id), userIds)) {
      this.time.delayedCall(HIGH_FIVE_APPROACH_MS, () => playHighFiveSound({ perfect }))
    }
  }

  /** Aceita `null` porque `youId` só existe depois do `welcome`. */
  private isRiding(userId: string | null): boolean {
    return userId !== null && this.ridingUserIds.has(userId)
  }

  /**
   * Liga/desliga o kart de um personagem. Duas coisas juntas, porque só fazem
   * sentido em par:
   *
   * 1. O corpo é recortado na altura da cabeça (`setCrop`). Visto de cima,
   *    quem está sentado não tem tronco nem pernas à mostra — some o boneco em
   *    pé que aparecia atrás do veículo.
   * 2. O kart entra no MESMO container (herda de graça o tween de passo, a
   *    profundidade por linha e a destruição da view). Só a cabeça recortada
   *    fica acima do cockpit; o restante do corpo permanece invisível.
   */
  private applyKartVisual(userId: string, active: boolean): void {
    const view = this.characters.get(userId)
    if (!view) return
    const sprite = 'setCrop' in view.body ? (view.body as Phaser.GameObjects.Sprite) : null
    if (!active) {
      view.kart?.destroy()
      view.kart = undefined
      sprite?.setCrop()
      // `bodyBaseY` junto com o y: é dele que o bob parte, e deixá-lo pra trás
      // faria o personagem voltar a afundar no primeiro passo depois de descer.
      view.bodyBaseY = CHARACTER_BASE_Y
      view.body.setX(0)
      view.body.setY(CHARACTER_BASE_Y)
      return
    }
    // Crop e posição são reaplicados mesmo com kart já montado: um
    // `avatar-updated` no meio da corrida troca o body e traz um sprite
    // inteiro, em pé, de volta.
    sprite?.setCrop(0, KART_HEAD_CROP_TOP, CHARACTER_FRAME_SIZE, KART_HEAD_CROP_HEIGHT)
    positionKartRider(view)
    if (view.kart) {
      // `avatar-updated` substitui `view.body`: recoloca o sprite novo acima
      // do cockpit sem recriar o veículo.
      view.container.moveAbove(view.body, view.kart)
      return
    }
    const kart = this.add
      .image(0, KART_OFFSET_Y, KART_TEXTURE)
      .setOrigin(0.5, 0.5)
      .setDisplaySize(KART_DISPLAY_SIZE, KART_DISPLAY_SIZE)
      // Já nasce virado pro lado que a pessoa encara — montar não deve
      // "endireitar" ninguém pro norte.
      .setRotation(KART_ROTATION_BY_DIR[view.lastDir])
    view.container.add(kart)
    view.container.moveAbove(view.body, kart)
    view.kart = kart
  }

  /**
   * Clarão branco no ponto onde as mãos se encontraram — o reforço visual da
   * palma perfeita (#22252). Expande e some junto com o estalo; é decoração
   * pura, sem estado, então nada precisa guardar referência a ele.
   */
  private showPerfectClapFlash(x: number, y: number): void {
    const flash = this.add
      .circle(x, y, PERFECT_CLAP_FLASH_RADIUS, 0xffffff, 0.85)
      .setDepth(CELEBRATION_DEPTH)
    this.tweens.add({
      targets: flash,
      scale: PERFECT_CLAP_FLASH_SCALE,
      alpha: 0,
      duration: PERFECT_CLAP_FLASH_MS,
      ease: 'Quad.easeOut',
      onComplete: () => flash.destroy(),
    })
  }

  private showNearbyBubble(userId: string, text: string, kind: NearbyBubbleKind): void {
    const view = this.characters.get(userId)
    if (!view) return
    this.clearBubble(view)

    const trimmed = nearbyBubbleText(text)
    if (!trimmed) return
    const isReaction = kind === 'reaction'
    const isShortEmoji = [...trimmed].length <= 2 && !/[A-Za-z0-9À-ÿ]/.test(trimmed)
    const isThought = kind === 'thought'

    const label = this.add.text(0, 0, trimmed, {
      fontFamily: 'sans-serif',
      fontSize: isReaction ? '17px' : isShortEmoji ? '20px' : '12px',
      fontStyle: isReaction || isShortEmoji ? undefined : '700',
      color: isThought ? '#111827' : '#ffffff',
      resolution: 2,
      stroke: isReaction || isShortEmoji ? undefined : isThought ? '#ffffff' : '#020617',
      strokeThickness: isReaction || isShortEmoji ? 0 : 2,
      wordWrap: isReaction || isShortEmoji ? undefined : { width: NEARBY_BUBBLE_WRAP_WIDTH },
      align: 'center',
    })
    label.setOrigin(0.5, 0.5)
    const width = isShortEmoji ? 56 : Math.min(Math.max(label.width + 22, 44), NEARBY_BUBBLE_MAX_WIDTH)
    const height = isShortEmoji ? 36 : label.height + 16
    label.setPosition(0, isShortEmoji ? -1 : 0)

    const bubbleContents: Phaser.GameObjects.GameObject[] = [label]
    if (!isReaction) {
      const bg = this.add.graphics()
      bg.fillStyle(isThought ? 0xf4f7ff : 0x2f2f2f, isThought ? 0.96 : 0.95)
      bg.fillRoundedRect(-width / 2, -height / 2, width, height, 8)
      bg.lineStyle(1, isThought ? 0x9fb0ca : 0xffffff, isThought ? 0.35 : 0.12)
      bg.strokeRoundedRect(-width / 2, -height / 2, width, height, 8)
      if (isThought) {
        bg.fillCircle(-12, height / 2 + 7, 4)
        bg.fillCircle(-4, height / 2 + 15, 3)
        bg.fillCircle(3, height / 2 + 22, 2)
      }
      bubbleContents.unshift(bg)
    }

    const bubble = this.add.container(
      0,
      isThought
        ? NEARBY_THOUGHT_BUBBLE_Y
        : isReaction
          ? REACTION_REST_Y + REACTION_TRAVEL_PX
          : NEARBY_SPEECH_BUBBLE_START_Y,
      bubbleContents,
    )
    view.container.add(bubble)
    view.bubble = bubble
    view.bubbleKind = kind

    if (isThought) return

    const destroyBubble = () => {
      if (view.bubble === bubble) {
        view.bubble = undefined
        view.bubbleTween = undefined
        view.bubbleKind = undefined
      }
      bubble.destroy()
    }

    if (isReaction) {
      bubble.alpha = 0
      view.bubbleTween = this.tweens.chain({
        targets: bubble,
        tweens: [
          {
            y: REACTION_REST_Y,
            alpha: 1,
            duration: REACTION_ENTRY_MS,
            ease: 'Sine.easeOut',
          },
          {
            y: REACTION_REST_Y - REACTION_HOP_HEIGHT_PX,
            duration: REACTION_HOP_HALF_MS,
            ease: 'Sine.easeInOut',
            yoyo: true,
            repeat: 2,
            hold: REACTION_HOP_PAUSE_MS,
            repeatDelay: REACTION_HOP_PAUSE_MS,
          },
          {
            y: REACTION_REST_Y - REACTION_TRAVEL_PX,
            alpha: 0,
            delay: REACTION_EXIT_DELAY_MS,
            duration: REACTION_EXIT_MS,
            ease: 'Sine.easeOut',
          },
        ],
        onComplete: destroyBubble,
      })
      return
    }

    view.bubbleTween = this.tweens.add({
      targets: bubble,
      y: NEARBY_SPEECH_BUBBLE_END_Y,
      alpha: 0,
      delay: NEARBY_BUBBLE_VISIBLE_MS,
      duration: NEARBY_BUBBLE_FADE_MS,
      ease: 'Sine.easeOut',
      onComplete: destroyBubble,
    })
  }

  /**
   * Tira do ar o balão de PENSAMENTO de alguém (fala e reação somem sozinhas,
   * por tween). É o que o `step()` do modelo de grade fazia a cada passo; com
   * o movimento livre, quem decide é o servidor (`thought-cleared`) e a
   * predição do próprio corpo (ver `placeBody`).
   */
  private clearThoughtBubble(userId: string): void {
    const view = this.characters.get(userId)
    if (view?.bubbleKind === 'thought') this.clearBubble(view)
  }

  private clearBubble(view: CharacterView): void {
    view.bubbleTween?.stop()
    view.bubbleTween = undefined
    view.bubble?.destroy()
    view.bubble = undefined
    view.bubbleKind = undefined
  }

  /**
   * Recria a `CharacterView` de quem aparece no snapshot sem ter uma.
   *
   * Não deveria acontecer — `welcome`/`joined` sempre criam a view antes. Mas se
   * acontecer (mensagem fora de ordem, por exemplo), sem isto a pessoa fica
   * INVISÍVEL para sempre NESTE cliente: `drawRemoteBodies` pula quem não tem
   * view, e nada mais ressincroniza `characters` fora de welcome/joined.
   *
   * O bridge já tem o snapshot completo do occupant (ele processa a mensagem
   * antes de notificar a cena), então dá para recriar na hora, sem round-trip.
   */
  private recoverMissingView(userId: string): void {
    if (this.characters.has(userId)) return
    const occupant = this.bridge.occupantSnapshot(userId)
    if (!occupant) {
      console.warn(`[OfficeScene] snapshot com userId sem view e sem occupant conhecido: ${userId}`)
      return
    }
    console.warn(`[OfficeScene] snapshot com userId sem CharacterView — recriando: ${userId}`)
    this.spawn(occupant)
  }

  private face(view: CharacterView, dir: Direction): void {
    view.lastDir = dir
    // Antes do early return abaixo: o kart precisa virar mesmo em personagem
    // sem spritesheet composto (spinner de loading ainda de pé).
    view.kart?.setRotation(KART_ROTATION_BY_DIR[dir])
    if (view.kart) positionKartRider(view)
    if (!view.textureKey || !('anims' in view.body)) return
    const sprite = view.body as Phaser.GameObjects.Sprite
    if (sprite.anims.isPlaying) {
      sprite.play(`${view.textureKey}-walk-${dir}`, true)
    } else {
      sprite.setFrame(characterIdleFrame(dir))
    }
  }
}

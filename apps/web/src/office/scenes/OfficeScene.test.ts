import { describe, expect, it, vi } from 'vitest'
import {
  createEmptyMapDocumentV1,
  type MapDocumentV1,
  type OfficeBall,
  type OfficeOccupant,
  type OfficeRuntimeZone,
} from '@legends/shared'
import { officeMapTileFrame } from './officeMapTiles'

// `OfficeScene.ts` estende `Phaser.Scene`. O pacote real dispara detecção de
// features de canvas (`CanvasFeatures.init`) já na importação, o que crasha
// sob jsdom (sem `getContext('2d')` de verdade). Estes testes só exercitam a
// função pura `computeScreenPosition` — não instanciam a cena nem chamam seus
// métodos — então um stub mínimo de `Phaser.Scene` basta pra o módulo carregar.
vi.mock('phaser', () => ({
  default: { Scene: class {} },
}))
vi.mock('../media/applause-sound', () => ({ playApplauseSound: vi.fn() }))
vi.mock('../media/high-five-sound', () => ({ playHighFiveSound: vi.fn() }))
vi.mock('../media/kick-sound', () => ({ playKickSound: vi.fn() }))
vi.mock('../media/paintball-sound', () => ({ playPaintballSound: vi.fn() }))

import {
  computeAppliedZoom,
  computeMinCameraZoom,
  computeScreenPosition,
  highFiveWithinEarshot,
  OfficeScene,
  zoneLabelText,
  KART_TEXTURE,
  PAINT_PELLET_TEXTURE,
  PAINT_BURST_DROPS,
  PAINTBALL_MUZZLE_Y,
  NEARBY_SPEECH_BUBBLE_START_Y,
  NEARBY_SPEECH_BUBBLE_END_Y,
  NEARBY_THOUGHT_BUBBLE_Y,
} from './OfficeScene'
import {
  CONFETTI_COLORS,
  CONFETTI_TEXTURE,
  confettiBurstConfig,
  confettiLaunchConfig,
} from './confettiSprites'
import { playApplauseSound } from '../media/applause-sound'
import { playHighFiveSound } from '../media/high-five-sound'
import { playKickSound } from '../media/kick-sound'
import { playPaintballSound } from '../media/paintball-sound'

/**
 * Um ponto de TILE em PIXEL, no centro da célula.
 *
 * Os cenários continuam sendo escritos em tile — é assim que se pensa alcance
 * ("ela está a dois tiles") —, mas tudo que entra na cena como occupant tem de
 * chegar em pixel, que é o que a produção manda desde o movimento livre.
 */
function emPixel(tileX: number, tileY: number, tile = 32): { x: number; y: number } {
  return { x: tileX * tile + tile / 2, y: tileY * tile + tile / 2 }
}

const scenePrivate = OfficeScene.prototype as unknown as {
  stepFn(this: unknown): unknown
  recoverMissingView(this: unknown, userId: string): void
  reattachCameraIfDetached(this: unknown): void
  tileAtPixel(this: unknown, point: { x: number; y: number }): { x: number; y: number }
  updateBalls(this: unknown, dtMs: number): void
  refreshBallVisuals(this: unknown): void
  playBallKick(this: unknown, userId: string, ball: unknown, power: string): void
  placeBody(
    this: unknown,
    view: unknown,
    x: number,
    y: number,
    dir: string,
    moving: boolean,
    sprint: boolean,
  ): void
  pressedMove(this: unknown): string | null
  update(this: unknown, time: number, delta: number): void
  earshotLevel(this: unknown, tile: unknown, tiles?: number): number
  drawRemoteBodies(this: unknown, now: number): void
  emitRemoteKartSmoke(this: unknown, ...args: unknown[]): void
  emitConfetti(this: unknown, active: boolean): void
  setFloatingReactionsActive(this: unknown, active: boolean): void
  setConfetti(this: unknown, userId: string, active: boolean): void
  setHandRaised(this: unknown, userId: string, active: boolean): void
  updateConfettiDirection(this: unknown, userId: string, dir: string): void
  celebrate(this: unknown): void
  handle(this: unknown, message: unknown): void
  showNearbyBubble(this: unknown, userId: string, text: string, kind: 'speech' | 'thought' | 'reaction'): void
  clearThoughtBubble(this: unknown, userId: string): void
  clearBubble(this: unknown, view: unknown): void
  playHighFive(this: unknown, userIds: [string, string], perfect?: boolean): void
  showPerfectClapFlash(this: unknown, x: number, y: number): void
  applyKartVisual(this: unknown, userId: string, active: boolean): void
  applyCharacterSprite(this: unknown, view: unknown, textureKey: string): void
  isRiding(this: unknown, userId: string | null): boolean
  face(this: unknown, view: unknown, dir: string): void
  pointerToCell(this: unknown, pointer: { x: number; y: number }): { col: number; row: number }
  handleMapRightClick(this: unknown, pointer: { x: number; y: number; rightButtonDown(): boolean }): void
  step(this: unknown, userId: string, x: number, y: number, dir: string, sprint: boolean): void
  setDeskClaim(this: unknown, externalKey: string, ownerName: string | null): void
  applyLocalIntent(this: unknown, dir: string, sprint: boolean, seq: number): void
  snapSelfTo(this: unknown, x: number, y: number): unknown
  reanchorStalePrediction(this: unknown): void
  playPaintballShot(this: unknown, shot: unknown): void
  applyPaintSplat(this: unknown, splat: unknown): void
  setPaintMarker(this: unknown, userId: string, active: boolean): void
  burstPaint(this: unknown, px: number, py: number, color: number): void
}

const tileset: MapDocumentV1['tilesets'][number] = {
  id: 'legacy-office',
  name: 'Escritório legado',
  assetId: 'legacy-asset',
  tileWidth: 32,
  tileHeight: 32,
  columns: 5,
  tileCount: 10,
}

describe('officeMapTileFrame', () => {
  it('recorta o frame pela coluna e linha do tileset', () => {
    expect(officeMapTileFrame(tileset, 7)).toEqual({
      key: 'legacy-office-7',
      x: 64,
      y: 32,
      width: 32,
      height: 32,
    })
  })

  it('rejeita índices fora do tileset', () => {
    expect(officeMapTileFrame(tileset, -1)).toBeNull()
    expect(officeMapTileFrame(tileset, 10)).toBeNull()
    expect(officeMapTileFrame(tileset, 1.5)).toBeNull()
  })
})

// O mapa da EMR em produção: 80x60 tiles de 32px, bem maior que a tela.
const bigMap = { width: 80 * 32, height: 60 * 32 }
const bigMapViewport = { width: 1200, height: 700 }
/** coverZoom do mapa grande = max(1200/2560, 700/1920). */
const BIG_MAP_COVER_ZOOM = 0.46875

describe('computeAppliedZoom', () => {
  it('mapa grande: a faixa toda do controle mexe o zoom, em vez de grudar em 1x', () => {
    const zooms = [0.5, 0.7, 1, 1.3, 2.5].map((zoom) =>
      computeAppliedZoom(bigMap, bigMapViewport, zoom),
    )
    expect(zooms).toEqual([0.5, 0.7, 1, 1.3, 2.5])
  })

  it('a escala é contínua: cada passo do controle muda o zoom, sem degraus', () => {
    const steps = [1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6]
    const zooms = steps.map((zoom) => computeAppliedZoom(bigMap, bigMapViewport, zoom))
    expect(new Set(zooms).size).toBe(steps.length)
    for (let i = 1; i < zooms.length; i += 1) {
      // Nenhum salto: entre passos vizinhos a diferença é a do próprio passo.
      expect(zooms[i] - zooms[i - 1]).toBeCloseTo(0.1)
    }
  })

  it('mapa grande: afastar mostra mais mundo do que o 100%', () => {
    expect(computeAppliedZoom(bigMap, bigMapViewport, 0.7)).toBeLessThan(
      computeAppliedZoom(bigMap, bigMapViewport, 1),
    )
  })

  it('não afasta além do ponto em que o mapa deixaria de cobrir a tela', () => {
    expect(computeAppliedZoom(bigMap, bigMapViewport, 0.1)).toBeCloseTo(BIG_MAP_COVER_ZOOM)
  })

  it('mapa menor que a tela: o 100% é a escala que cobre o viewport', () => {
    const smallMap = { width: 600, height: 350 }
    expect(computeAppliedZoom(smallMap, bigMapViewport, 1)).toBe(2)
    expect(computeAppliedZoom(smallMap, bigMapViewport, 1.5)).toBe(3)
    // Afastar não pode descobrir a tela: o piso continua sendo a cobertura.
    expect(computeAppliedZoom(smallMap, bigMapViewport, 0.6)).toBe(2)
  })
})

describe('computeMinCameraZoom', () => {
  it('mapa grande: o mínimo vai bem abaixo dos 60% que o controle tinha cravado', () => {
    const min = computeMinCameraZoom(bigMap, bigMapViewport)
    expect(min).toBeCloseTo(BIG_MAP_COVER_ZOOM)
    expect(min).toBeLessThan(0.6)
  })

  it('é o zoom de UI em que o mapa passa a caber inteiro na tela', () => {
    const min = computeMinCameraZoom(bigMap, bigMapViewport)
    expect(computeAppliedZoom(bigMap, bigMapViewport, min)).toBeCloseTo(BIG_MAP_COVER_ZOOM)
    // Pedir menos que o mínimo não muda mais nada — daí ele desabilitar o botão.
    expect(computeAppliedZoom(bigMap, bigMapViewport, min - 0.1)).toBeCloseTo(
      computeAppliedZoom(bigMap, bigMapViewport, min),
    )
  })

  it('mapa que já cabe na tela não tem o que afastar: mínimo é 100%', () => {
    expect(computeMinCameraZoom({ width: 600, height: 350 }, bigMapViewport)).toBe(1)
  })

  it('janela menor deixa afastar mais (o mínimo acompanha o viewport)', () => {
    const narrow = computeMinCameraZoom(bigMap, { width: 600, height: 400 })
    expect(narrow).toBeLessThan(computeMinCameraZoom(bigMap, bigMapViewport))
  })
})

describe('computeScreenPosition', () => {
  it('converte posição de mundo pra tela considerando scroll e zoom', () => {
    const result = computeScreenPosition(
      100,
      200,
      { scrollX: 20, scrollY: 20, zoom: 2 },
      { width: 800, height: 600 },
    )
    expect(result).toEqual({ x: 160, y: 360, zoom: 2 })
  })

  it('retorna null quando a posição cai fora do viewport (negativa)', () => {
    const result = computeScreenPosition(
      -100,
      -100,
      { scrollX: 0, scrollY: 0, zoom: 1 },
      { width: 800, height: 600 },
    )
    expect(result).toBeNull()
  })

  it('retorna null quando a posição excede a largura ou a altura do viewport', () => {
    expect(
      computeScreenPosition(2000, 100, { scrollX: 0, scrollY: 0, zoom: 1 }, { width: 800, height: 600 }),
    ).toBeNull()
    expect(
      computeScreenPosition(100, 2000, { scrollX: 0, scrollY: 0, zoom: 1 }, { width: 800, height: 600 }),
    ).toBeNull()
  })

  it('com zoom 1 e scroll 0, a posição de tela é igual à posição de mundo', () => {
    const result = computeScreenPosition(
      50,
      75,
      { scrollX: 0, scrollY: 0, zoom: 1 },
      { width: 800, height: 600 },
    )
    expect(result).toEqual({ x: 50, y: 75, zoom: 1 })
  })
})

describe('OfficeScene.getScreenPosition', () => {
  it('usa cam.worldView.x/y — NÃO cam.scrollX/scrollY — pra achar a posição real na tela', () => {
    // Reprodução de um bug real: com a câmera limitada por bounds e
    // seguindo o personagem (`setBounds` + `startFollow`), o Phaser expõe
    // `scrollX`/`scrollY` com o valor "desejado" pelo follow, que pode
    // ficar fora do range válido quando o personagem está perto da borda
    // do mapa — só `worldView.x/y` reflete a área de fato renderizada.
    // Confirmado manualmente comparando as duas origens contra a posição
    // real do personagem na tela (ver commit desta correção).
    const fakeScene = {
      characters: new Map([['ana', { container: { x: 432, y: 496 } }]]),
      cameras: {
        main: {
          scrollX: -335,
          scrollY: -26.24,
          worldView: { x: 0, y: 152 },
          zoom: 1.8375,
        },
      },
      scale: { width: 1470, height: 780 },
    }

    const result = OfficeScene.prototype.getScreenPosition.call(fakeScene, 'ana')

    expect(result).toEqual({ x: (432 - 0) * 1.8375, y: (496 - 152) * 1.8375, zoom: 1.8375 })
  })

  it('retorna null pra userId sem personagem spawnado', () => {
    const fakeScene = { characters: new Map() }
    expect(OfficeScene.prototype.getScreenPosition.call(fakeScene, 'ninguem')).toBeNull()
  })
})

/**
 * O depth da estampa de edição não pode ser constante: o zIndex das layers vem
 * do documento. O mapa da EMR tem `objects` em z=30 (o editor admin renumerava
 * a escala ao reordenar layers), e a estampa cravada em 21 nascia POR BAIXO da
 * mobília publicada — a peça nova aparecia embaixo da mesa, e os botões de
 * ordem não resolviam, porque no documento ela já era a da frente.
 */
describe('OfficeScene.applyTileObjectStamp — depth da estampa', () => {
  function cenaCom(objectsZIndex: number) {
    const document = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 })
    document.layers = document.layers.map((layer) =>
      layer.key === 'objects' ? { ...layer, zIndex: objectsZIndex } : layer,
    )
    const image = {
      setDisplaySize: vi.fn().mockReturnThis(),
      setDepth: vi.fn().mockReturnThis(),
      setFlipX: vi.fn(),
      setAngle: vi.fn(),
    }
    const scene = {
      document,
      editObjectImages: new Map(),
      editObjectEraseMarkers: new Map(),
      add: { image: vi.fn(() => image) },
      removeTileObjectStamp: vi.fn(),
    }
    return { scene, image }
  }

  function estampar(scene: unknown) {
    OfficeScene.prototype.applyTileObjectStamp.call(
      scene as never,
      'novo',
      { x: 0, y: 0, width: 32, height: 32 },
      'tex',
      'frame',
    )
  }

  it('fica acima da mobília publicada quando a layer é a canônica (z=20)', () => {
    const { scene, image } = cenaCom(20)

    estampar(scene)

    expect(image.setDepth).toHaveBeenCalledWith(21)
  })

  it('acompanha o zIndex do documento — mapa com objects em z=30', () => {
    const { scene, image } = cenaCom(30)

    estampar(scene)

    expect(image.setDepth).toHaveBeenCalledWith(31)
  })
})

describe('OfficeScene.syncTileObjectOrder', () => {
  it('usa a estampa pendente quando existe e organiza os sprites no depth da layer', () => {
    const document = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 })
    const layer = document.layers.find((item) => item.key === 'objects')
    expect(layer).toBeDefined()
    const publishedA = { setDepth: vi.fn() }
    const pendingA = { setDepth: vi.fn() }
    const publishedB = { setDepth: vi.fn() }
    const bringToTop = vi.fn()
    const fakeScene = {
      document,
      publishedObjectImages: new Map([
        ['a', publishedA],
        ['b', publishedB],
      ]),
      editObjectImages: new Map([['a', pendingA]]),
      children: { bringToTop },
    }

    OfficeScene.prototype.syncTileObjectOrder.call(fakeScene as any, [
      { id: 'b', layerKey: 'objects' },
      { id: 'a', layerKey: 'objects' },
    ])

    expect(publishedB.setDepth).toHaveBeenCalledWith(layer!.zIndex)
    expect(pendingA.setDepth).toHaveBeenCalledWith(layer!.zIndex)
    expect(publishedA.setDepth).not.toHaveBeenCalled()
    expect(bringToTop.mock.calls.map(([image]) => image)).toEqual([publishedB, pendingA])
  })
})

describe('OfficeScene.showNearbyBubble — reação', () => {
  it('renderiza fala com fonte mais nítida e contrastada', () => {
    const label = {
      width: 78,
      height: 24,
      setOrigin: vi.fn(),
      setPosition: vi.fn(),
    }
    const bg = {
      fillStyle: vi.fn(),
      fillRoundedRect: vi.fn(),
      lineStyle: vi.fn(),
      strokeRoundedRect: vi.fn(),
    }
    const bubble = { destroy: vi.fn() }
    const view = {
      container: { add: vi.fn() },
      bubble: undefined,
      bubbleTween: undefined,
      bubbleKind: undefined,
    }
    const tween = { stop: vi.fn() }
    const scene = {
      characters: new Map([['ana', view]]),
      clearBubble: vi.fn(),
      add: {
        text: vi.fn(() => label),
        graphics: vi.fn(() => bg),
        container: vi.fn(() => bubble),
      },
      tweens: {
        add: vi.fn(() => tween),
        chain: vi.fn(),
      },
      time: { delayedCall: vi.fn() },
    }

    scenePrivate.showNearbyBubble.call(scene, 'ana', 'fala legível', 'speech')

    expect(scene.add.text).toHaveBeenCalledWith(0, 0, 'fala legível', expect.objectContaining({
      fontSize: '12px',
      fontStyle: '700',
      resolution: 2,
      stroke: '#020617',
      strokeThickness: 2,
    }))
    expect(scene.add.graphics).toHaveBeenCalled()
    expect(scene.add.container).toHaveBeenCalledWith(0, NEARBY_SPEECH_BUBBLE_START_Y, [bg, label])
  })

  it('quebra palavra longa antes de renderizar a fala para conter o balão', () => {
    const label = {
      width: 500,
      height: 72,
      setOrigin: vi.fn(),
      setPosition: vi.fn(),
    }
    const bg = {
      fillStyle: vi.fn(),
      fillRoundedRect: vi.fn(),
      lineStyle: vi.fn(),
      strokeRoundedRect: vi.fn(),
    }
    const bubble = { destroy: vi.fn() }
    const view = {
      container: { add: vi.fn() },
      bubble: undefined,
      bubbleTween: undefined,
      bubbleKind: undefined,
    }
    const scene = {
      characters: new Map([['ana', view]]),
      clearBubble: vi.fn(),
      add: {
        text: vi.fn(() => label),
        graphics: vi.fn(() => bg),
        container: vi.fn(() => bubble),
      },
      tweens: {
        add: vi.fn(() => ({ stop: vi.fn() })),
        chain: vi.fn(),
      },
    }

    scenePrivate.showNearbyBubble.call(scene, 'ana', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'speech')

    expect(scene.add.text).toHaveBeenCalledWith(
      0,
      0,
      'aaaaaaaaaaaaaaaaaa\naaaaaaaaaaaaaaaaaa\naaaaaaaaaaaa',
      expect.objectContaining({ wordWrap: { width: 132 } }),
    )
    expect(bg.fillRoundedRect).toHaveBeenCalledWith(-75, -44, 150, 88, 8)
    expect(bg.strokeRoundedRect).toHaveBeenCalledWith(-75, -44, 150, 88, 8)
  })

  it('quebra texto em caps lock mais cedo porque as letras ocupam mais largura', () => {
    const label = {
      width: 500,
      height: 72,
      setOrigin: vi.fn(),
      setPosition: vi.fn(),
    }
    const bg = {
      fillStyle: vi.fn(),
      fillRoundedRect: vi.fn(),
      lineStyle: vi.fn(),
      strokeRoundedRect: vi.fn(),
    }
    const view = {
      container: { add: vi.fn() },
      bubble: undefined,
      bubbleTween: undefined,
      bubbleKind: undefined,
    }
    const scene = {
      characters: new Map([['ana', view]]),
      clearBubble: vi.fn(),
      add: {
        text: vi.fn(() => label),
        graphics: vi.fn(() => bg),
        container: vi.fn(() => ({ destroy: vi.fn() })),
      },
      tweens: {
        add: vi.fn(() => ({ stop: vi.fn() })),
        chain: vi.fn(),
      },
    }

    scenePrivate.showNearbyBubble.call(scene, 'ana', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'speech')

    expect(scene.add.text).toHaveBeenCalledWith(
      0,
      0,
      'AAAAAAAAAAAAA\nAAAAAAAAAAAAA\nAAAAAAAAAAAAA\nAAAAAAAAA',
      expect.objectContaining({ wordWrap: { width: 132 } }),
    )
    expect(bg.fillRoundedRect).toHaveBeenCalledWith(-75, -44, 150, 88, 8)
  })

  it('preserva frases comuns e deixa o wordWrap do Phaser quebrar por espaço', () => {
    const label = {
      width: 120,
      height: 40,
      setOrigin: vi.fn(),
      setPosition: vi.fn(),
    }
    const bg = {
      fillStyle: vi.fn(),
      fillRoundedRect: vi.fn(),
      lineStyle: vi.fn(),
      strokeRoundedRect: vi.fn(),
    }
    const view = {
      container: { add: vi.fn() },
      bubble: undefined,
      bubbleTween: undefined,
      bubbleKind: undefined,
    }
    const scene = {
      characters: new Map([['ana', view]]),
      clearBubble: vi.fn(),
      add: {
        text: vi.fn(() => label),
        graphics: vi.fn(() => bg),
        container: vi.fn(() => ({ destroy: vi.fn() })),
      },
      tweens: {
        add: vi.fn(() => ({ stop: vi.fn() })),
        chain: vi.fn(),
      },
    }

    scenePrivate.showNearbyBubble.call(scene, 'ana', 'fala comum com espaços', 'speech')

    expect(scene.add.text).toHaveBeenCalledWith(
      0,
      0,
      'fala comum com espaços',
      expect.objectContaining({ wordWrap: { width: 132 } }),
    )
  })

  it('aplica a mesma contenção no balão de pensamento', () => {
    const label = {
      width: 500,
      height: 72,
      setOrigin: vi.fn(),
      setPosition: vi.fn(),
    }
    const bg = {
      fillStyle: vi.fn(),
      fillRoundedRect: vi.fn(),
      fillCircle: vi.fn(),
      lineStyle: vi.fn(),
      strokeRoundedRect: vi.fn(),
    }
    const view = {
      container: { add: vi.fn() },
      bubble: undefined,
      bubbleTween: undefined,
      bubbleKind: undefined,
    }
    const scene = {
      characters: new Map([['ana', view]]),
      clearBubble: vi.fn(),
      add: {
        text: vi.fn(() => label),
        graphics: vi.fn(() => bg),
        container: vi.fn(() => ({ destroy: vi.fn() })),
      },
      tweens: {
        add: vi.fn(() => ({ stop: vi.fn() })),
        chain: vi.fn(),
      },
    }

    scenePrivate.showNearbyBubble.call(scene, 'ana', 'https://legends.local/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'thought')

    expect(scene.add.text).toHaveBeenCalledWith(
      0,
      0,
      'https://legends.lo\ncal/aaaaaaaaaaaaaa\naaaaaaaaaaaaaaaaaa',
      expect.objectContaining({ color: '#111827', wordWrap: { width: 132 } }),
    )
    expect(bg.fillRoundedRect).toHaveBeenCalledWith(-75, -44, 150, 88, 8)
  })

  it('renderiza só o emoji menor e encadeia entrada, três pulos e saída', () => {
    const label = {
      width: 17,
      height: 17,
      setOrigin: vi.fn(),
      setPosition: vi.fn(),
    }
    const bubble = { alpha: 1, destroy: vi.fn() }
    const view = {
      container: { add: vi.fn() },
      bubble: undefined,
      bubbleTween: undefined,
      bubbleKind: undefined,
    }
    const chain = { stop: vi.fn() }
    const scene = {
      characters: new Map([['ana', view]]),
      clearBubble: vi.fn(),
      add: {
        text: vi.fn(() => label),
        graphics: vi.fn(),
        container: vi.fn(() => bubble),
      },
      tweens: {
        chain: vi.fn(() => chain),
        add: vi.fn(),
      },
    }

    scenePrivate.showNearbyBubble.call(scene, 'ana', '🤩', 'reaction')

    expect(scene.add.text).toHaveBeenCalledWith(0, 0, '🤩', expect.objectContaining({ fontSize: '17px' }))
    expect(scene.add.graphics).not.toHaveBeenCalled()
    expect(scene.add.container).toHaveBeenCalledWith(0, -40, [label])
    expect(bubble.alpha).toBe(0)
    expect(scene.tweens.chain).toHaveBeenCalledWith(expect.objectContaining({
      targets: bubble,
      tweens: [
        expect.objectContaining({ y: -70, alpha: 1 }),
        expect.objectContaining({ y: -78, yoyo: true, repeat: 2 }),
        expect.objectContaining({ y: -100, alpha: 0 }),
      ],
    }))
    expect(view.bubbleTween).toBe(chain)
  })
})

/**
 * O som do high-five é agendado dentro de um closure (precisa levar o `perfect`
 * junto), então não dá para comparar a função por identidade — dispara o
 * callback agendado e confere com que argumento ele tocou o sample.
 */
function expectSomAgendado(
  scene: { time: { delayedCall: ReturnType<typeof vi.fn> } },
  { perfect }: { perfect: boolean },
) {
  const agendados = scene.time.delayedCall.mock.calls.filter(([delay]) => delay === 250)
  expect(agendados.length).toBeGreaterThan(0)
  vi.mocked(playHighFiveSound).mockClear()
  // Na palma perfeita há mais de um agendamento no mesmo instante (o clarão
  // também): dispara todos e confere quem tocou o sample.
  for (const [, callback] of agendados) callback()
  expect(playHighFiveSound).toHaveBeenCalledWith({ perfect })
}

describe('OfficeScene.playHighFive', () => {
  function fakeView(x: number, y = 0, alpha = 1) {
    return {
      container: { x, y },
      bubble: { x: 0, y: 0, alpha, scale: 1 },
      bubbleTween: { stop: vi.fn() },
      bubbleKind: 'reaction' as const,
    }
  }

  function fakeScene(views: Record<string, ReturnType<typeof fakeView>>) {
    return {
      characters: new Map(Object.entries(views)),
      clearBubble: vi.fn(),
      tweens: {
        chain: vi.fn(
          (_config: { tweens: unknown[]; onComplete?: () => void }) => ({ stop: vi.fn() }),
        ),
      },
      time: { delayedCall: vi.fn() },
    }
  }

  it('leva os dois balões ao ponto médio e agenda o som no impacto', () => {
    const ana = fakeView(100)
    const bruno = fakeView(140)
    const scene = fakeScene({ ana, bruno })
    const pararAna = ana.bubbleTween.stop
    const pararBruno = bruno.bubbleTween.stop

    scenePrivate.playHighFive.call(scene, ['ana', 'bruno'])

    expect(pararAna).toHaveBeenCalled()
    expect(pararBruno).toHaveBeenCalled()
    expect(scene.tweens.chain).toHaveBeenCalledTimes(2)
    const [primeira, segunda] = scene.tweens.chain.mock.calls
    expect(primeira[0].tweens[0]).toEqual(expect.objectContaining({ x: 20, y: -70 }))
    expect(segunda[0].tweens[0]).toEqual(expect.objectContaining({ x: -20, y: -70 }))
    expectSomAgendado(scene, { perfect: false })
  })

  it('par vertical também converge no meio do eixo y', () => {
    const ana = fakeView(100, 200)
    const bruno = fakeView(100, 232)
    const scene = fakeScene({ ana, bruno })

    scenePrivate.playHighFive.call(scene, ['ana', 'bruno'])

    const [primeira, segunda] = scene.tweens.chain.mock.calls
    expect(primeira[0].tweens[0]).toEqual(expect.objectContaining({ x: 0, y: -54 }))
    expect(segunda[0].tweens[0]).toEqual(expect.objectContaining({ x: 0, y: -86 }))
  })

  it('revela o balão de quem acabou de acenar antes de animar', () => {
    const ana = fakeView(100)
    const bruno = fakeView(140, 0, 0)
    const scene = fakeScene({ ana, bruno })

    scenePrivate.playHighFive.call(scene, ['ana', 'bruno'])

    expect(bruno.bubble.alpha).toBe(1)
    expect(ana.bubble.alpha).toBe(1)
    const [, segunda] = scene.tweens.chain.mock.calls
    expect(segunda[0].tweens[0]).not.toHaveProperty('alpha')
    expect(segunda[0].tweens[1]).not.toHaveProperty('alpha')
    expect(segunda[0].tweens[2]).toEqual(expect.objectContaining({ alpha: 0 }))
  })

  it('no fim da animação limpa o balão dos dois personagens', () => {
    const ana = fakeView(100)
    const bruno = fakeView(140)
    const scene = fakeScene({ ana, bruno })

    scenePrivate.playHighFive.call(scene, ['ana', 'bruno'])

    const [primeira, segunda] = scene.tweens.chain.mock.calls
    primeira[0].onComplete?.()
    segunda[0].onComplete?.()
    expect(scene.clearBubble.mock.calls).toEqual([[ana], [bruno]])
  })

  describe('palma perfeita (#22252)', () => {
    /** A perfeita desenha o flash no impacto, então a cena falsa precisa de `add`. */
    function fakeSceneComFlash(views: Record<string, ReturnType<typeof fakeView>>) {
      const flash = { setDepth: vi.fn().mockReturnThis(), destroy: vi.fn() }
      const scene = {
        ...fakeScene(views),
        add: { circle: vi.fn(() => flash) },
        tweens: {
          chain: vi.fn((_config: { tweens: unknown[]; onComplete?: () => void }) => ({ stop: vi.fn() })),
          add: vi.fn(),
        },
        // O flash é método da própria cena — a versão real entra aqui para que
        // o teste exercite o desenho, não um dublê.
        showPerfectClapFlash: scenePrivate.showPerfectClapFlash,
      }
      return { scene, flash }
    }

    it('estala mais alto e dá um pop maior no balão', () => {
      const { scene } = fakeSceneComFlash({ ana: fakeView(100), bruno: fakeView(140) })

      scenePrivate.playHighFive.call(scene, ['ana', 'bruno'], true)

      const [primeira] = scene.tweens.chain.mock.calls
      expect(primeira[0].tweens[1]).toEqual(expect.objectContaining({ scale: 1.9 }))
      expectSomAgendado(scene, { perfect: true })
    })

    it('a palma comum mantém o pop discreto', () => {
      const { scene } = fakeSceneComFlash({ ana: fakeView(100), bruno: fakeView(140) })

      scenePrivate.playHighFive.call(scene, ['ana', 'bruno'], false)

      const [primeira] = scene.tweens.chain.mock.calls
      expect(primeira[0].tweens[1]).toEqual(expect.objectContaining({ scale: 1.4 }))
      expect(scene.add.circle).not.toHaveBeenCalled()
    })

    it('desenha o flash no ponto de impacto, no momento do estalo', () => {
      const { scene, flash } = fakeSceneComFlash({ ana: fakeView(100, 200), bruno: fakeView(140, 200) })

      scenePrivate.playHighFive.call(scene, ['ana', 'bruno'], true)

      // Nada é desenhado na largada — o flash acompanha o impacto.
      expect(scene.add.circle).not.toHaveBeenCalled()
      for (const [delay, callback] of scene.time.delayedCall.mock.calls) {
        expect(delay).toBe(250)
        callback()
      }
      expect(scene.add.circle).toHaveBeenCalledWith(120, 130, expect.any(Number), 0xffffff, expect.any(Number))
      expect(scene.tweens.add).toHaveBeenCalledWith(expect.objectContaining({ targets: flash }))
    })

    it('o flash aparece mesmo para quem está longe demais pra ouvir — o visual é global', () => {
      const { scene } = fakeSceneComFlash({ ana: fakeView(100), bruno: fakeView(140) })
      Object.assign(scene, {
        youId: 'voce',
        document: createEmptyMapDocumentV1({ width: 20, height: 20, tileSize: 32 }),
        bridge: {
          // Em PIXEL, como o occupant chega desde o movimento livre — o
          // cenário é escrito em tile e convertido por `emPixel`.
          occupantSnapshot: (userId: string) =>
            ({ ana: emPixel(2, 2), bruno: emPixel(3, 2), voce: emPixel(15, 15) } as Record<
              string,
              { x: number; y: number }
            >)[userId] ?? null,
        },
      })

      vi.mocked(playHighFiveSound).mockClear()
      scenePrivate.playHighFive.call(scene, ['ana', 'bruno'], true)

      expect(scene.time.delayedCall).toHaveBeenCalledTimes(1)
      scene.time.delayedCall.mock.calls[0][1]()
      expect(scene.add.circle).toHaveBeenCalled()
      expect(playHighFiveSound).not.toHaveBeenCalled()
    })
  })

  it('ignora quando um balão não é reação, já sumiu ou o usuário não existe', () => {
    const ana = fakeView(100)
    const fala = { ...fakeView(140), bubbleKind: 'speech' as const }
    const semBalao = { ...fakeView(140), bubble: undefined }

    const sceneComFala = fakeScene({ ana, fala } as never)
    scenePrivate.playHighFive.call(sceneComFala, ['ana', 'fala'])
    expect(sceneComFala.tweens.chain).not.toHaveBeenCalled()

    const sceneSemBalao = fakeScene({ ana, semBalao } as never)
    scenePrivate.playHighFive.call(sceneSemBalao, ['ana', 'semBalao'])
    expect(sceneSemBalao.tweens.chain).not.toHaveBeenCalled()

    const sceneSemUsuario = fakeScene({ ana })
    expect(() => scenePrivate.playHighFive.call(sceneSemUsuario, ['ana', 'fantasma'])).not.toThrow()
    expect(sceneSemUsuario.tweens.chain).not.toHaveBeenCalled()
  })
})

describe('OfficeScene.playHighFive — alcance do som', () => {
  function fakeView(x: number) {
    return {
      container: { x, y: 0 },
      bubble: { x: 0, y: 0, alpha: 1, scale: 1 },
      bubbleTween: { stop: vi.fn() },
      bubbleKind: 'reaction' as const,
    }
  }

  /** Mapa 20x20 sem zonas: só o raio de proximidade do espaço aberto decide. */
  function fakeSceneComPosicoes(posicoes: Record<string, { x: number; y: number }>, youId: string) {
    return {
      characters: new Map([
        ['ana', fakeView(100)],
        ['bruno', fakeView(140)],
      ]),
      clearBubble: vi.fn(),
      tweens: { chain: vi.fn(() => ({ stop: vi.fn() })) },
      time: { delayedCall: vi.fn() },
      youId,
      document: createEmptyMapDocumentV1({ width: 20, height: 20, tileSize: 32 }),
      bridge: {
        // O cenário é escrito em TILE (é assim que se pensa "ela está a dois
        // tiles"), e o occupant fala PIXEL desde o movimento livre. Converter
        // aqui é o que faz o teste exercitar a mesma unidade da produção — o
        // fixture em tile puro é justamente o que deixou o bug do som passar.
        occupantSnapshot: (userId: string) => {
          const position = posicoes[userId]
          return position ? { userId, ...emPixel(position.x, position.y) } : null
        },
      },
    }
  }

  it('não toca o som para quem está longe do par, mas ainda anima os balões', () => {
    const scene = fakeSceneComPosicoes(
      { ana: { x: 2, y: 2 }, bruno: { x: 3, y: 2 }, voce: { x: 15, y: 15 } },
      'voce',
    )

    scenePrivate.playHighFive.call(scene, ['ana', 'bruno'])

    expect(scene.time.delayedCall).not.toHaveBeenCalled()
    expect(scene.tweens.chain).toHaveBeenCalledTimes(2)
  })

  it('toca o som para quem está dentro do raio de proximidade do par', () => {
    const scene = fakeSceneComPosicoes(
      { ana: { x: 2, y: 2 }, bruno: { x: 3, y: 2 }, voce: { x: 5, y: 3 } },
      'voce',
    )

    scenePrivate.playHighFive.call(scene, ['ana', 'bruno'])

    expectSomAgendado(scene, { perfect: false })
  })

  it('sem posição conhecida do próprio usuário, toca (nunca emudecer por falta de dado)', () => {
    const scene = fakeSceneComPosicoes({ ana: { x: 2, y: 2 }, bruno: { x: 3, y: 2 } }, 'voce')

    scenePrivate.playHighFive.call(scene, ['ana', 'bruno'])

    expectSomAgendado(scene, { perfect: false })
  })
})

describe("OfficeScene.handle('high-five')", () => {
  it('roteia a mensagem do servidor para playHighFive com o par de userIds', () => {
    const scene = { playHighFive: vi.fn() }

    scenePrivate.handle.call(scene, { type: 'high-five', userIds: ['ana', 'bruno'], perfect: false })

    expect(scene.playHighFive).toHaveBeenCalledWith(['ana', 'bruno'], false)
  })

  it('repassa a palma perfeita sorteada pelo servidor (#22252)', () => {
    const scene = { playHighFive: vi.fn() }

    scenePrivate.handle.call(scene, { type: 'high-five', userIds: ['ana', 'bruno'], perfect: true })

    expect(scene.playHighFive).toHaveBeenCalledWith(['ana', 'bruno'], true)
  })
})

describe("OfficeScene.handle('nearby-message') — reaction", () => {
  it('fora da grade desenha o emoji no balão do personagem', () => {
    const scene = { floatingReactionsActive: false, showNearbyBubble: vi.fn() }

    scenePrivate.handle.call(scene, { type: 'nearby-message', userId: 'ana', text: '👋', kind: 'reaction' })

    expect(scene.showNearbyBubble).toHaveBeenCalledWith('ana', '👋', 'reaction')
  })

  it('com a grade aberta deixa a reação para o overlay HTML', () => {
    const scene = { floatingReactionsActive: false, showNearbyBubble: vi.fn() }

    scenePrivate.setFloatingReactionsActive.call(scene, true)
    scenePrivate.handle.call(scene, { type: 'nearby-message', userId: 'ana', text: '👋', kind: 'reaction' })

    expect(scene.showNearbyBubble).not.toHaveBeenCalled()
  })

  it('fala e pensamento continuam no canvas mesmo com a grade aberta', () => {
    const scene = { floatingReactionsActive: true, showNearbyBubble: vi.fn() }

    scenePrivate.handle.call(scene, { type: 'nearby-message', userId: 'ana', text: 'oi', kind: 'speech' })
    scenePrivate.handle.call(scene, { type: 'nearby-message', userId: 'ana', text: 'foco', kind: 'thought' })

    expect(scene.showNearbyBubble.mock.calls).toEqual([
      ['ana', 'oi', 'speech'],
      ['ana', 'foco', 'thought'],
    ])
  })
})

describe("OfficeScene.handle('thought-cleared')", () => {
  it('tira o balão de pensamento de quem o servidor diz que se mexeu', () => {
    const view = { userId: 'ana', bubbleKind: 'thought' }
    const scene = {
      characters: new Map([['ana', view]]),
      clearThoughtBubble: scenePrivate.clearThoughtBubble,
      clearBubble: vi.fn(),
    }

    scenePrivate.handle.call(scene, { type: 'thought-cleared', userId: 'ana' })

    expect(scene.clearBubble).toHaveBeenCalledWith(view)
  })

  it('não encosta em balão de fala nem de reação — esses somem por conta própria', () => {
    const view = { userId: 'ana', bubbleKind: 'speech' }
    const scene = {
      characters: new Map([['ana', view]]),
      clearThoughtBubble: scenePrivate.clearThoughtBubble,
      clearBubble: vi.fn(),
    }

    scenePrivate.handle.call(scene, { type: 'thought-cleared', userId: 'ana' })

    expect(scene.clearBubble).not.toHaveBeenCalled()
  })
})

describe('OfficeScene.worldToScreen', () => {
  const fakeScene = {
    cameras: { main: { worldView: { x: 0, y: 152 }, zoom: 2 } },
    scale: { width: 800, height: 600 },
  }

  it('converte um ponto do mundo aplicando scroll e zoom da câmera', () => {
    expect(OfficeScene.prototype.worldToScreen.call(fakeScene, 100, 200)).toEqual({
      x: 200,
      y: 96,
      zoom: 2,
    })
  })

  it('devolve null para um ponto fora do viewport', () => {
    expect(OfficeScene.prototype.worldToScreen.call(fakeScene, 5000, 200)).toBeNull()
  })
})

describe('posicionamento do Nearby Chat', () => {
  it('começa acima do badge de nome e mantém a animação de subida', () => {
    expect(NEARBY_SPEECH_BUBBLE_START_Y).toBeLessThan(-48)
    expect(NEARBY_THOUGHT_BUBBLE_Y).toBeLessThan(-48)
    expect(NEARBY_SPEECH_BUBBLE_END_Y).toBeLessThan(NEARBY_SPEECH_BUBBLE_START_Y)
    expect(NEARBY_SPEECH_BUBBLE_START_Y - NEARBY_SPEECH_BUBBLE_END_Y).toBe(30)
  })
})

describe('OfficeScene.emitConfetti (segurar F)', () => {
  function fakeScene() {
    return { inputLocked: false, confettiKeyHeld: false, bridge: { emitClientMessage: vi.fn() } }
  }

  it('keydown envia confetti active:true e keyup envia active:false', () => {
    const s = fakeScene()
    scenePrivate.emitConfetti.call(s, true)
    scenePrivate.emitConfetti.call(s, false)
    expect(s.bridge.emitClientMessage.mock.calls).toEqual([
      [{ type: 'confetti', active: true }],
      [{ type: 'confetti', active: false }],
    ])
  })

  it('não reenvia enquanto já está segurando (dedupe por transição)', () => {
    const s = fakeScene()
    scenePrivate.emitConfetti.call(s, true)
    scenePrivate.emitConfetti.call(s, true)
    expect(s.bridge.emitClientMessage).toHaveBeenCalledTimes(1)
  })

  it('ignora keydown enquanto o input está travado (chat aberto etc.)', () => {
    const s = { ...fakeScene(), inputLocked: true }
    scenePrivate.emitConfetti.call(s, true)
    expect(s.bridge.emitClientMessage).not.toHaveBeenCalled()
  })

  it('setInputLocked(true) força o fim do confete se estava segurando', () => {
    // `setInputLocked` chama `this.releaseDirectionKeys()` e `this.emitConfetti(false)`,
    // então o fakeScene precisa expor ambos: releaseDirectionKeys como no-op e
    // emitConfetti como a implementação REAL (pra exercer o dedupe + o envio).
    const s = {
      inputLocked: false,
      confettiKeyHeld: false,
      bridge: { emitClientMessage: vi.fn() },
      releaseDirectionKeys: () => {},
      emitConfetti: scenePrivate.emitConfetti,
    }
    // simula estar segurando F (roda a impl real com this = s)
    s.emitConfetti(true)
    s.bridge.emitClientMessage.mockClear()

    OfficeScene.prototype.setInputLocked.call(s as unknown as OfficeScene, true)
    expect(s.bridge.emitClientMessage).toHaveBeenCalledWith({ type: 'confetti', active: false })
  })
})

describe("OfficeScene.handle('welcome') com confettiUserIds/handRaisedUserIds", () => {
  it('acende o confete de quem já estava segurando F antes de eu entrar, sem esperar novo keydown', () => {
    const s = {
      youId: null,
      characters: new Map(),
      spawn: vi.fn(),
      destroyCharacter: vi.fn(),
      setConfetti: vi.fn(),
      setHandRaised: vi.fn(),
      predictor: { reset: vi.fn() },
      // O `welcome` monta a grade fina de colisão para semear a predição — e ela
      // sai do documento, que a cena real sempre tem (é parâmetro do construtor).
      document: createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 }),
      // …e injeta o passo, que troca conforme a pessoa esteja a pé ou de kart.
      stepFn: scenePrivate.stepFn,
      isRiding: () => false,
      applyCameraFocus: vi.fn(),
      ridingUserIds: new Set<string>(),
      kartStates: new Map(),
      ballStates: new Map(),
      refreshBallVisuals: vi.fn(),
      applyKartVisual: vi.fn(),
      refreshKartVisuals: vi.fn(),
    }

    scenePrivate.handle.call(s, {
      type: 'welcome',
      youId: 'bruno',
      occupants: [{ userId: 'ana', x: 1, y: 1 }, { userId: 'bruno', x: 2, y: 2 }],
      confettiUserIds: ['ana'],
    })

    expect(s.setConfetti).toHaveBeenCalledWith('ana', true)
    expect(s.setConfetti).toHaveBeenCalledTimes(1)
  })

  it('acende o ícone de mão de quem já estava com a mão levantada antes de eu entrar', () => {
    const s = {
      youId: null,
      characters: new Map(),
      spawn: vi.fn(),
      destroyCharacter: vi.fn(),
      setConfetti: vi.fn(),
      setHandRaised: vi.fn(),
      predictor: { reset: vi.fn() },
      // O `welcome` monta a grade fina de colisão para semear a predição — e ela
      // sai do documento, que a cena real sempre tem (é parâmetro do construtor).
      document: createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 }),
      // …e injeta o passo, que troca conforme a pessoa esteja a pé ou de kart.
      stepFn: scenePrivate.stepFn,
      isRiding: () => false,
      applyCameraFocus: vi.fn(),
      ridingUserIds: new Set<string>(),
      kartStates: new Map(),
      ballStates: new Map(),
      refreshBallVisuals: vi.fn(),
      applyKartVisual: vi.fn(),
      refreshKartVisuals: vi.fn(),
    }

    scenePrivate.handle.call(s, {
      type: 'welcome',
      youId: 'bruno',
      occupants: [{ userId: 'ana', x: 1, y: 1 }, { userId: 'bruno', x: 2, y: 2 }],
      handRaisedUserIds: ['ana'],
    })

    expect(s.setHandRaised).toHaveBeenCalledWith('ana', true)
    expect(s.setHandRaised).toHaveBeenCalledTimes(1)
  })

  it('não quebra quando confettiUserIds/handRaisedUserIds vêm ausentes (mensagem antiga/replay sem os campos)', () => {
    const s = {
      youId: null,
      characters: new Map(),
      spawn: vi.fn(),
      destroyCharacter: vi.fn(),
      setConfetti: vi.fn(),
      setHandRaised: vi.fn(),
      predictor: { reset: vi.fn() },
      // O `welcome` monta a grade fina de colisão para semear a predição — e ela
      // sai do documento, que a cena real sempre tem (é parâmetro do construtor).
      document: createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 }),
      // …e injeta o passo, que troca conforme a pessoa esteja a pé ou de kart.
      stepFn: scenePrivate.stepFn,
      isRiding: () => false,
      applyCameraFocus: vi.fn(),
      ridingUserIds: new Set<string>(),
      kartStates: new Map(),
      ballStates: new Map(),
      refreshBallVisuals: vi.fn(),
      applyKartVisual: vi.fn(),
      refreshKartVisuals: vi.fn(),
    }

    expect(() =>
      scenePrivate.handle.call(s, { type: 'welcome', youId: 'bruno', occupants: [] }),
    ).not.toThrow()
    expect(s.setConfetti).not.toHaveBeenCalled()
    expect(s.setHandRaised).not.toHaveBeenCalled()
  })
})

describe('confettiLaunchConfig', () => {
  it('sem direção, descreve um LANÇAMENTO pra cima (default) e não uma chuva', () => {
    const config = confettiLaunchConfig()
    expect(config).toMatchObject({
      angle: { min: -120, max: -60 },
      speed: { min: 120, max: 260 },
      gravityY: 260,
      lifespan: 900,
      quantity: 2,
      frequency: 35,
      tint: CONFETTI_COLORS,
    })
    expect(CONFETTI_COLORS.length).toBeGreaterThanOrEqual(6)
  })

  it('o cone de confete sai na direção que o personagem está de frente', () => {
    expect(confettiLaunchConfig('up').angle).toEqual({ min: -120, max: -60 })
    expect(confettiLaunchConfig('down').angle).toEqual({ min: 60, max: 120 })
    expect(confettiLaunchConfig('right').angle).toEqual({ min: -30, max: 30 })
    expect(confettiLaunchConfig('left').angle).toEqual({ min: 150, max: 210 })
  })
})

describe('OfficeScene.updateConfettiDirection (confete acompanha virar em tempo real)', () => {
  // `ParticleEmitter#setEmitterAngle` não redefine o range aleatório min/max
  // de um emissor já criado (só faz clamp dentro do range original) — por
  // isso a correção recria o emissor a cada mudança de direção de verdade.
  function fakeEmitter() {
    return {
      setDepth: vi.fn().mockReturnThis(),
      startFollow: vi.fn(),
      stop: vi.fn(),
      destroy: vi.fn(),
    }
  }

  it('personagem vira de verdade: para o emissor antigo, cria um novo com o ângulo certo, agenda o destroy do antigo', () => {
    const oldEmitter = fakeEmitter()
    const newEmitter = fakeEmitter()
    const view = { container: { id: 'container-ana' }, lastDir: 'down' as const }
    const s = {
      characters: new Map([['ana', view]]),
      confettiEmitters: new Map([['ana', oldEmitter]]),
      add: { particles: vi.fn(() => newEmitter) },
      time: { delayedCall: vi.fn() },
    }

    scenePrivate.updateConfettiDirection.call(s, 'ana', 'right')

    expect(oldEmitter.stop).toHaveBeenCalledOnce()
    expect(oldEmitter.destroy).not.toHaveBeenCalled() // só depois do delay
    expect(s.time.delayedCall).toHaveBeenCalledWith(900, expect.any(Function))
    s.time.delayedCall.mock.calls[0][1]() // simula o delay vencendo
    expect(oldEmitter.destroy).toHaveBeenCalledOnce()

    expect(s.add.particles).toHaveBeenCalledWith(0, 0, CONFETTI_TEXTURE, confettiLaunchConfig('right'))
    expect(newEmitter.startFollow).toHaveBeenCalledWith(view.container)
    expect(s.confettiEmitters.get('ana')).toBe(newEmitter)
  })

  it('mesma direção de antes: não recria o emissor (evita flicker a cada passo reto)', () => {
    const emitter = fakeEmitter()
    const view = { container: { id: 'container-ana' }, lastDir: 'down' as const }
    const s = {
      characters: new Map([['ana', view]]),
      confettiEmitters: new Map([['ana', emitter]]),
      add: { particles: vi.fn() },
      time: { delayedCall: vi.fn() },
    }

    scenePrivate.updateConfettiDirection.call(s, 'ana', 'down')

    expect(s.add.particles).not.toHaveBeenCalled()
    expect(emitter.stop).not.toHaveBeenCalled()
  })

  it('é no-op sem confete ativo pra esse userId', () => {
    const view = { container: { id: 'container-ana' }, lastDir: 'down' as const }
    const s = {
      characters: new Map([['ana', view]]),
      confettiEmitters: new Map(),
      add: { particles: vi.fn() },
      time: { delayedCall: vi.fn() },
    }
    expect(() => scenePrivate.updateConfettiDirection.call(s, 'ana', 'right')).not.toThrow()
    expect(s.add.particles).not.toHaveBeenCalled()
  })

  it('é no-op para userId sem personagem spawnado', () => {
    const emitter = fakeEmitter()
    const s = {
      characters: new Map(),
      confettiEmitters: new Map([['ninguem', emitter]]),
      add: { particles: vi.fn() },
      time: { delayedCall: vi.fn() },
    }
    expect(() => scenePrivate.updateConfettiDirection.call(s, 'ninguem', 'down')).not.toThrow()
    expect(s.add.particles).not.toHaveBeenCalled()
  })
})

describe('OfficeScene.setConfetti (emissor por personagem)', () => {
  function fakeEmitter() {
    return {
      setDepth: vi.fn().mockReturnThis(),
      startFollow: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      destroy: vi.fn(),
    }
  }

  it('cria o emissor no primeiro active:true, seguindo o container, com o ângulo da direção atual', () => {
    const emitter = fakeEmitter()
    const view = { container: { id: 'container-ana' }, lastDir: 'left' as const }
    const s = {
      characters: new Map([['ana', view]]),
      confettiEmitters: new Map(),
      add: { particles: vi.fn(() => emitter) },
    }

    scenePrivate.setConfetti.call(s, 'ana', true)

    expect(s.add.particles).toHaveBeenCalledWith(0, 0, CONFETTI_TEXTURE, confettiLaunchConfig('left'))
    expect(emitter.startFollow).toHaveBeenCalledWith(view.container)
    expect(s.confettiEmitters.get('ana')).toBe(emitter)
  })

  it('reaproveita o emissor e só para (stop) no active:false — sem sumir abrupto', () => {
    const emitter = fakeEmitter()
    const view = { container: { id: 'container-ana' }, lastDir: 'up' as const }
    const s = {
      characters: new Map([['ana', view]]),
      confettiEmitters: new Map(),
      add: { particles: vi.fn(() => emitter) },
      time: { delayedCall: vi.fn() },
    }

    scenePrivate.setConfetti.call(s, 'ana', true)
    scenePrivate.setConfetti.call(s, 'ana', true) // reaproveita
    expect(s.add.particles).toHaveBeenCalledTimes(1)
    expect(emitter.start).toHaveBeenCalledTimes(1)

    scenePrivate.setConfetti.call(s, 'ana', false)
    expect(emitter.stop).toHaveBeenCalledTimes(1)
    // Remove do map (destroy agendado): senão uma virada de direção depois
    // acharia esse emissor "morto" ainda vivo e o recriaria já emitindo.
    expect(s.confettiEmitters.has('ana')).toBe(false)
    expect(s.time.delayedCall).toHaveBeenCalledWith(900, expect.any(Function))
    s.time.delayedCall.mock.calls[0][1]() // simula o delay vencendo
    expect(emitter.destroy).toHaveBeenCalledTimes(1)
  })

  it('é no-op para userId sem personagem spawnado', () => {
    const s = {
      characters: new Map(),
      confettiEmitters: new Map(),
      add: { particles: vi.fn() },
    }
    scenePrivate.setConfetti.call(s, 'ninguem', true)
    expect(s.add.particles).not.toHaveBeenCalled()
  })
})

describe('OfficeScene.setHandRaised (ícone global sobre o personagem)', () => {
  function fakeIcon() {
    return { setOrigin: vi.fn().mockReturnThis(), setDepth: vi.fn().mockReturnThis(), destroy: vi.fn() }
  }

  it('cria o ícone no primeiro active:true, filho do container do personagem', () => {
    const icon = fakeIcon()
    const container = { add: vi.fn() }
    const view: { container: unknown; handIcon?: unknown } = { container }
    const s = {
      characters: new Map([['ana', view]]),
      add: { text: vi.fn(() => icon) },
    }

    scenePrivate.setHandRaised.call(s, 'ana', true)

    expect(s.add.text).toHaveBeenCalledWith(0, -60, '✋', { fontSize: '20px' })
    expect(container.add).toHaveBeenCalledWith(icon)
    expect(view.handIcon).toBe(icon)
  })

  it('não recria o ícone se já existe (idempotente)', () => {
    const icon = fakeIcon()
    const view = { container: { add: vi.fn() } }
    const s = {
      characters: new Map([['ana', view]]),
      add: { text: vi.fn(() => icon) },
    }

    scenePrivate.setHandRaised.call(s, 'ana', true)
    scenePrivate.setHandRaised.call(s, 'ana', true)

    expect(s.add.text).toHaveBeenCalledTimes(1)
  })

  it('active:false destrói o ícone e limpa a referência', () => {
    const icon = fakeIcon()
    const view: { container: unknown; handIcon?: unknown } = { container: { add: vi.fn() } }
    const s = {
      characters: new Map([['ana', view]]),
      add: { text: vi.fn(() => icon) },
    }

    scenePrivate.setHandRaised.call(s, 'ana', true)
    scenePrivate.setHandRaised.call(s, 'ana', false)

    expect(icon.destroy).toHaveBeenCalledOnce()
    expect(view.handIcon).toBeUndefined()
  })

  it('active:false sem ícone existente é no-op', () => {
    const view = { container: { add: vi.fn() } }
    const s = {
      characters: new Map([['ana', view]]),
      add: { text: vi.fn() },
    }
    expect(() => scenePrivate.setHandRaised.call(s, 'ana', false)).not.toThrow()
    expect(s.add.text).not.toHaveBeenCalled()
  })

  it('é no-op para userId sem personagem spawnado', () => {
    const s = {
      characters: new Map(),
      add: { text: vi.fn() },
    }
    scenePrivate.setHandRaised.call(s, 'ninguem', true)
    expect(s.add.text).not.toHaveBeenCalled()
  })
})

describe('confettiBurstConfig', () => {
  it('espalha o burst pela largura da tela e cai (comemoração)', () => {
    const config = confettiBurstConfig(1000)
    expect(config).toMatchObject({
      x: { min: 0, max: 1000 },
      y: 0,
      angle: { min: 60, max: 120 },
      emitting: false,
      tint: CONFETTI_COLORS,
    })
  })
})

describe('OfficeScene.celebrate (comemoração)', () => {
  // A cena sempre chama `playApplauseSound`; quem cala na sala de silêncio é o
  // portão dentro do próprio módulo de som (ver `applause-sound.test.ts`).
  it('mostra banner fixo na câmera, dispara burst e toca aplausos', () => {
    const banner = {
      setOrigin: vi.fn().mockReturnThis(),
      setScrollFactor: vi.fn().mockReturnThis(),
      setDepth: vi.fn().mockReturnThis(),
      setAlpha: vi.fn().mockReturnThis(),
      destroy: vi.fn(),
    }
    const burst = {
      setDepth: vi.fn().mockReturnThis(),
      setScrollFactor: vi.fn().mockReturnThis(),
      explode: vi.fn(),
      destroy: vi.fn(),
    }
    const s = {
      scale: { width: 800 },
      add: { text: vi.fn(() => banner), particles: vi.fn(() => burst) },
      tweens: { add: vi.fn() },
      time: { delayedCall: vi.fn() },
    }

    scenePrivate.celebrate.call(s)

    // banner com o texto pt-BR, centrado horizontalmente e fixo na viewport
    expect(s.add.text).toHaveBeenCalledWith(400, expect.any(Number), '🎉 Comemoração!', expect.any(Object))
    expect(banner.setScrollFactor).toHaveBeenCalledWith(0)
    expect(s.tweens.add).toHaveBeenCalled()
    // burst de tela cheia, fixo na câmera, disparado de uma vez
    expect(s.add.particles).toHaveBeenCalledWith(0, 0, CONFETTI_TEXTURE, confettiBurstConfig(800))
    expect(burst.setScrollFactor).toHaveBeenCalledWith(0)
    expect(burst.explode).toHaveBeenCalled()
    // som sintetizado
    expect(playApplauseSound).toHaveBeenCalled()
  })
})

describe('OfficeScene.setSelectionOverlay (retângulo sobrevive a um redesenho)', () => {
  function fakeRectangle() {
    return {
      setStrokeStyle: vi.fn().mockReturnThis(),
      setDepth: vi.fn().mockReturnThis(),
      destroy: vi.fn(),
    }
  }

  it('guarda o retângulo em `selectionRect` além de desenhar o overlay', () => {
    // Precisa do documento: o depth do overlay é relativo à layer visual mais
    // alta (`editStampDepth`), não uma constante.
    const s = {
      document: createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 }),
      add: { rectangle: vi.fn(() => fakeRectangle()) },
      selectionOverlay: null,
      selectionRect: null,
    }
    const rect = { x: 10, y: 20, width: 32, height: 32 }

    OfficeScene.prototype.setSelectionOverlay.call(s as never, rect)

    expect(s.add.rectangle).toHaveBeenCalledWith(26, 36, 32, 32, 0x6ab8ff, 0.12)
    expect(s.selectionRect).toEqual(rect)
  })

  it('limpa `selectionRect` (não só o overlay) quando chamado com null — usado pelo Cancelar via discardLocalEdits', () => {
    const overlay = fakeRectangle()
    const s = {
      add: { rectangle: vi.fn(() => fakeRectangle()) },
      selectionOverlay: overlay,
      selectionRect: { x: 10, y: 20, width: 32, height: 32 },
    }

    OfficeScene.prototype.setSelectionOverlay.call(s as never, null)

    expect(overlay.destroy).toHaveBeenCalled()
    expect(s.selectionOverlay).toBeNull()
    expect(s.selectionRect).toBeNull()
  })
})

describe('OfficeScene.handleMapRightClick (clique direito no mapa)', () => {
  function fakeScene(overrides: Record<string, unknown> = {}) {
    return {
      editing: false,
      document: { map: { width: 10, height: 8, tileWidth: 32, tileHeight: 32 } },
      cameras: { main: { getWorldPoint: (x: number, y: number) => ({ x, y }) } },
      bridge: { emitMapRightClick: vi.fn() },
      pointerToCell: scenePrivate.pointerToCell,
      ...overrides,
    }
  }
  function pointer(x: number, y: number, right = true) {
    return { x, y, rightButtonDown: () => right }
  }

  it('clique direito num tile válido emite emitMapRightClick com a célula', () => {
    const s = fakeScene()
    scenePrivate.handleMapRightClick.call(s, pointer(96, 64))
    expect(s.bridge.emitMapRightClick).toHaveBeenCalledWith({ x: 3, y: 2 })
  })

  it('clique esquerdo (não é botão direito) não emite nada', () => {
    const s = fakeScene()
    scenePrivate.handleMapRightClick.call(s, pointer(96, 64, false))
    expect(s.bridge.emitMapRightClick).not.toHaveBeenCalled()
  })

  it('em modo de edição, clique direito não emite (o apagar de edição toma precedência)', () => {
    const s = fakeScene({ editing: true })
    scenePrivate.handleMapRightClick.call(s, pointer(96, 64))
    expect(s.bridge.emitMapRightClick).not.toHaveBeenCalled()
  })

  it('clique fora dos limites do mapa não emite nada', () => {
    const s = fakeScene()
    scenePrivate.handleMapRightClick.call(s, pointer(-32, 64))
    expect(s.bridge.emitMapRightClick).not.toHaveBeenCalled()
  })
})

describe('OfficeScene — câmera solta por arraste/zoom', () => {
  const DETACHED = '::camera-detached::'

  function fakeScene(over: Record<string, unknown> = {}) {
    return {
      youId: 'ana',
      focusUserId: null,
      panGesture: null,
      focusedCameraUserId: DETACHED,
      applyCameraFocus: vi.fn(),
      reattachCameraIfDetached: scenePrivate.reattachCameraIfDetached,
      ...over,
    }
  }

  it('volta a seguir quando o personagem focado anda', () => {
    // Arrastar e dar zoom soltam a câmera de propósito; ela volta no próximo
    // passo. Isso morava no `step()` do modelo de grade — sem religar, a câmera
    // ficava solta para sempre depois do primeiro zoom.
    const scene = fakeScene()
    scenePrivate.reattachCameraIfDetached.call(scene)
    expect(scene.applyCameraFocus).toHaveBeenCalledWith(false)
  })

  it('não religa no meio de um arraste', () => {
    const scene = fakeScene({ panGesture: { pointerX: 0, pointerY: 0, scrollX: 0, scrollY: 0 } })
    scenePrivate.reattachCameraIfDetached.call(scene)
    expect(scene.applyCameraFocus).not.toHaveBeenCalled()
  })

  it('não religa quando a câmera está focada em OUTRA pessoa', () => {
    const scene = fakeScene({ focusUserId: 'bruno' })
    scenePrivate.reattachCameraIfDetached.call(scene)
    expect(scene.applyCameraFocus).not.toHaveBeenCalled()
  })

  it('não faz nada se a câmera já está acompanhando', () => {
    const scene = fakeScene({ focusedCameraUserId: 'ana' })
    scenePrivate.reattachCameraIfDetached.call(scene)
    expect(scene.applyCameraFocus).not.toHaveBeenCalled()
  })
})

describe('OfficeScene — auto-recuperação de CharacterView sumida', () => {
  it('snapshot com userId sem view recria a view a partir do bridge', () => {
    // Não deveria acontecer (welcome/joined criam a view antes), mas se
    // acontecer a pessoa fica INVISÍVEL para sempre neste cliente:
    // `drawRemoteBodies` pula quem não tem view, e nada mais ressincroniza
    // `characters` fora de welcome/joined.
    const occupant = { userId: 'ana', name: 'Ana', x: 208, y: 176, dir: 'right' }
    const characters = new Map<string, unknown>()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const scene = {
      characters,
      bridge: { occupantSnapshot: vi.fn(() => occupant) },
      spawn: vi.fn(() => characters.set('ana', {})),
      recoverMissingView: scenePrivate.recoverMissingView,
    }

    scenePrivate.recoverMissingView.call(scene, 'ana')

    expect(scene.spawn).toHaveBeenCalledWith(occupant)
    expect(characters.has('ana')).toBe(true)
    warnSpy.mockRestore()
  })

  it('sem occupant conhecido, avisa e desiste — não inventa personagem', () => {
    const characters = new Map<string, unknown>()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const scene = {
      characters,
      bridge: { occupantSnapshot: vi.fn(() => null) },
      spawn: vi.fn(),
      recoverMissingView: scenePrivate.recoverMissingView,
    }

    scenePrivate.recoverMissingView.call(scene, 'fantasma')

    expect(scene.spawn).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('com view existente, não recria nada', () => {
    const characters = new Map<string, unknown>([['ana', {}]])
    const scene = {
      characters,
      bridge: { occupantSnapshot: vi.fn() },
      spawn: vi.fn(),
      recoverMissingView: scenePrivate.recoverMissingView,
    }

    scenePrivate.recoverMissingView.call(scene, 'ana')

    expect(scene.bridge.occupantSnapshot).not.toHaveBeenCalled()
    expect(scene.spawn).not.toHaveBeenCalled()
  })
})

describe('OfficeScene — kart (#22253)', () => {
  function fakeSceneComKart(riding: string[] = []) {
    const view = {
      container: { setDepth: vi.fn(), x: 0, y: 0 },
      body: {},
      bodyBaseY: 0,
      lastDir: 'down',
      tile: { x: 5, y: 5 },
      textureKey: null,
      tween: undefined,
      bobTween: undefined,
      kart: undefined as unknown,
    }
    return {
      view,
      scene: {
        characters: new Map<string, unknown>([['ana', view]]),
        ridingUserIds: new Set(riding),
        kartStates: new Map(),
        ballStates: new Map(),
        refreshBallVisuals: vi.fn(),
        bridge: { occupantSnapshot: vi.fn(() => null), emitClientMessage: vi.fn() },
        document: createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 }),
        tweens: { add: vi.fn((_config: { duration: number }) => ({})) },
        add: { image: vi.fn(() => ({ setDepth: vi.fn().mockReturnThis(), setOrigin: vi.fn().mockReturnThis(), destroy: vi.fn() })) },
        face: vi.fn(),
        updateConfettiDirection: vi.fn(),
        clearBubble: vi.fn(),
        applyKartVisual: vi.fn(),
        refreshKartVisuals: vi.fn(),
        isRiding: scenePrivate.isRiding,
        youId: 'ana',
      },
    }
  }

  it('o kart vira para a direção que a pessoa está encarando', () => {
    // A textura é desenhada apontando pra cima; sem girar, o kart anda de lado
    // e de ré sempre com o nariz pro norte.
    const kart = { setRotation: vi.fn().mockReturnThis(), destroy: vi.fn() }
    const view = {
      lastDir: 'down',
      tile: { x: 5, y: 5 },
      body: { setX: vi.fn(), setY: vi.fn() },
      bodyBaseY: 0,
      textureKey: null,
      kart,
    }

    const esperado: Record<string, number> = {
      up: 0,
      right: Math.PI / 2,
      down: Math.PI,
      left: -Math.PI / 2,
    }
    for (const [dir, rotacao] of Object.entries(esperado)) {
      kart.setRotation.mockClear()
      scenePrivate.face.call({}, view, dir)
      expect(kart.setRotation).toHaveBeenCalledWith(rotacao)
    }
  })

  function fakeKartView(lastDir = 'left') {
    const kart = {
      setDepth: vi.fn().mockReturnThis(),
      setOrigin: vi.fn().mockReturnThis(),
      setDisplaySize: vi.fn().mockReturnThis(),
      setRotation: vi.fn().mockReturnThis(),
      destroy: vi.fn(),
    }
    const view = {
      lastDir,
      body: { setCrop: vi.fn(), setX: vi.fn(), setY: vi.fn() },
      bodyBaseY: 16,
      container: { add: vi.fn(), moveAbove: vi.fn() },
      kart: undefined as unknown,
    }
    return {
      kart,
      view,
      scene: {
        characters: new Map([['ana', view]]),
        add: { image: vi.fn((_x: number, _y: number, _texture: string) => kart) },
      },
    }
  }

  it('ao montar, o kart já nasce virado pro lado que a pessoa encara', () => {
    const { kart, scene } = fakeKartView('left')

    scenePrivate.applyKartVisual.call(scene, 'ana', true)

    expect(kart.setRotation).toHaveBeenCalledWith(-Math.PI / 2)
  })

  it('usa o sprite pixel-art e deixa a cabeça acima do cockpit', () => {
    const { kart, view, scene } = fakeKartView()

    scenePrivate.applyKartVisual.call(scene, 'ana', true)

    expect(scene.add.image).toHaveBeenCalledWith(0, 0, KART_TEXTURE)
    expect(kart.setDisplaySize).toHaveBeenCalledWith(48, 48)
    expect(view.container.moveAbove).toHaveBeenCalledWith(view.body, kart)
  })

  it('montado, só a cabeça fica à mostra — o corpo é recortado', () => {
    const { view, scene } = fakeKartView()

    scenePrivate.applyKartVisual.call(scene, 'ana', true)
    // Faixa da cabeça no frame LPC de 64×64, largura inteira.
    expect(view.body.setCrop).toHaveBeenCalledWith(0, 8, 64, 26)
  })

  it('ao descer, o corpo inteiro volta', () => {
    const { view, scene } = fakeKartView()

    scenePrivate.applyKartVisual.call(scene, 'ana', true)
    view.body.setCrop.mockClear()
    scenePrivate.applyKartVisual.call(scene, 'ana', false)

    expect(view.body.setCrop).toHaveBeenCalledWith()
  })

  it.each([
    ['up', 0, 4],
    ['right', -4, -4],
    ['down', 0, -4],
    ['left', 4, -4],
  ] as const)('encaixa o piloto no cockpit quando olha para %s', (dir, expectedX, expectedY) => {
    const { view, scene } = fakeKartView(dir)

    scenePrivate.applyKartVisual.call(scene, 'ana', true)

    // O veículo ocupa a célula: nada de flutuar acima do tile.
    const [, kartY] = scene.add.image.mock.calls[0]
    expect(kartY).toBe(0)
    // A faixa da cabeça (8..34 de 64) parte do centro do kart e recebe o
    // deslocamento específico da perspectiva/direção.
    const centeredY = 48 - ((8 + 13) * 48) / 64
    expect(view.body.setX).toHaveBeenCalledWith(expectedX)
    expect(view.body.setY).toHaveBeenCalledWith(centeredY + expectedY)
    expect(view.bodyBaseY).toBe(centeredY + expectedY)
  })

  it('ao descer, o corpo volta a pisar no chão', () => {
    const { view, scene } = fakeKartView()

    scenePrivate.applyKartVisual.call(scene, 'ana', true)
    scenePrivate.applyKartVisual.call(scene, 'ana', false)

    expect(view.body.setX).toHaveBeenLastCalledWith(0)
    expect(view.body.setY).toHaveBeenLastCalledWith(16)
    expect(view.bodyBaseY).toBe(16)
  })

  it('reaplica o assento quando o avatar termina de carregar', () => {
    const oldBody = { destroy: vi.fn() }
    const sprite = {
      setOrigin: vi.fn().mockReturnThis(),
      setDisplaySize: vi.fn().mockReturnThis(),
    }
    const view = {
      userId: 'ana',
      body: oldBody,
      bodyBaseY: 0,
      hasAvatar: false,
      lastDir: 'up',
      container: { addAt: vi.fn(), input: undefined },
      kart: {},
    }
    const scene = {
      add: { sprite: vi.fn(() => sprite) },
      ensureWalkAnimations: vi.fn(),
      face: vi.fn(),
      isRiding: vi.fn(() => true),
      applyKartVisual: vi.fn(),
    }

    scenePrivate.applyCharacterSprite.call(scene, view, 'avatar-ana')

    expect(scene.applyKartVisual).toHaveBeenCalledWith('ana', true)
  })

  it('personagem a pé não quebra ao virar (não tem kart pra girar)', () => {
    const view = { lastDir: 'down', body: {}, textureKey: null, kart: undefined }
    expect(() => scenePrivate.face.call({}, view, 'left')).not.toThrow()
  })

  it("handle('kart-ride') registra quem montou e atualiza o visual", () => {
    const { scene } = fakeSceneComKart()

    scenePrivate.handle.call(scene, {
      type: 'kart-ride',
      userId: 'ana',
      active: true,
      kart: { id: 'kart-1', x: 2, y: 3, dir: 'down', riderUserId: 'ana' },
    })
    expect(scene.ridingUserIds.has('ana')).toBe(true)
    expect(scene.applyKartVisual).toHaveBeenCalledWith('ana', true)
    expect(scene.kartStates.get('kart-1')).toMatchObject({ riderUserId: 'ana' })

    scenePrivate.handle.call(scene, {
      type: 'kart-ride',
      userId: 'ana',
      active: false,
      kart: { id: 'kart-1', x: 2, y: 3, dir: 'down' },
    })
    expect(scene.ridingUserIds.has('ana')).toBe(false)
    expect(scene.applyKartVisual).toHaveBeenCalledWith('ana', false)
    expect(scene.refreshKartVisuals).toHaveBeenCalledTimes(2)
  })
})

describe('OfficeScene.setDeskClaim — rótulo da sala da mesa', () => {
  function fakeSceneComMesaNaSala() {
    const document = createEmptyMapDocumentV1({ width: 20, height: 20, tileSize: 32 })
    document.objects.push(
      {
        id: 'room-1', layerKey: 'meeting-rooms', type: 'meeting-room',
        geometry: { kind: 'rectangle', x: 96, y: 96, width: 96, height: 64 },
        properties: {
          externalKey: 'aurora', name: 'Aurora', status: 'OPEN',
          voiceEnabled: true, accessPolicy: 'OPEN',
        },
      },
      {
        id: 'desk-1', layerKey: 'desks', type: 'desk',
        geometry: { kind: 'rectangle', x: 96, y: 96, width: 96, height: 64 },
        properties: { externalKey: 'mesa-1', name: 'Nova mesa' },
      },
    )
    const zoneLabel = { setText: vi.fn() }
    return {
      scene: {
        document,
        zoneLabels: new Map([['room-1', zoneLabel]]),
        deskOwners: new Map<string, string | null>([['mesa-1', null]]),
      },
      zoneLabel,
      document,
    }
  }

  it('reivindicar registra o dono, que é o que alimenta o nome da sala', () => {
    const { scene, document } = fakeSceneComMesaNaSala()

    scenePrivate.setDeskClaim.call(scene, 'mesa-1', 'Ana')

    expect(scene.deskOwners.get('mesa-1')).toBe('Ana')
    const sala = document.objects.find((o) => o.type === 'meeting-room')!
    expect(zoneLabelText(document, scene.deskOwners, sala as never)).toBe('Mesa de Ana')
  })

  it('não escreve rótulo no mapa: sala de mesa não tem texto', () => {
    const { scene, zoneLabel } = fakeSceneComMesaNaSala()

    scenePrivate.setDeskClaim.call(scene, 'mesa-1', 'Ana')

    expect(zoneLabel.setText).not.toHaveBeenCalled()
  })

  it('liberar a mesa limpa o dono', () => {
    const { scene } = fakeSceneComMesaNaSala()

    scenePrivate.setDeskClaim.call(scene, 'mesa-1', 'Ana')
    scenePrivate.setDeskClaim.call(scene, 'mesa-1', null)

    expect(scene.deskOwners.get('mesa-1')).toBeNull()
  })

  it('liberar devolve o nome próprio da sala', () => {
    const { scene, document } = fakeSceneComMesaNaSala()
    const sala = document.objects.find((o) => o.type === 'meeting-room')!

    scenePrivate.setDeskClaim.call(scene, 'mesa-1', 'Ana')
    scenePrivate.setDeskClaim.call(scene, 'mesa-1', null)

    expect(zoneLabelText(document, scene.deskOwners, sala as never)).toBe('Aurora')
  })
})

describe('zoneLabelText (mesma regra de desempate da MediaBar via officeZoneDisplayName)', () => {
  function documentComDuasMesasNaSala() {
    const document = createEmptyMapDocumentV1({ width: 20, height: 20, tileSize: 32 })
    document.objects.push(
      {
        id: 'room-1', layerKey: 'meeting-rooms', type: 'meeting-room',
        geometry: { kind: 'rectangle', x: 0, y: 0, width: 320, height: 320 },
        properties: {
          externalKey: 'aurora', name: 'Aurora', status: 'OPEN',
          voiceEnabled: true, accessPolicy: 'OPEN',
        },
      },
      {
        id: 'desk-1', layerKey: 'desks', type: 'desk',
        geometry: { kind: 'rectangle', x: 32, y: 32, width: 96, height: 64 },
        properties: { externalKey: 'mesa-1', name: 'Nova mesa' },
      },
      {
        id: 'desk-2', layerKey: 'desks', type: 'desk',
        geometry: { kind: 'rectangle', x: 160, y: 32, width: 96, height: 64 },
        properties: { externalKey: 'mesa-2', name: 'Nova mesa' },
      },
    )
    const room = document.objects.find((object) => object.id === 'room-1') as OfficeRuntimeZone
    return { document, room }
  }

  it('duas mesas reivindicadas na mesma sala: desempata por quem aparece primeiro em document.objects, não por ordem de inserção em deskOwners', () => {
    const { document, room } = documentComDuasMesasNaSala()
    // mesa-2 entra primeiro no Map (ordem de iteração do deskOwners), mas
    // mesa-1 é quem aparece primeiro em document.objects — é essa ordem que
    // deve valer, igual à MediaBar via officeZoneDisplayName.
    const deskOwners = new Map<string, string | null>([
      ['mesa-2', 'Bruno'],
      ['mesa-1', 'Ana'],
    ])

    expect(zoneLabelText(document, deskOwners, room)).toBe('Mesa de Ana')
  })

  it('estado inicial já reivindicado (seeding do create(), antes de qualquer evento de mesa): rótulo já nasce "Mesa de <dono>"', () => {
    const { document, room } = documentComDuasMesasNaSala()
    const deskOwners = new Map<string, string | null>([['mesa-1', 'Ana']])

    expect(zoneLabelText(document, deskOwners, room)).toBe('Mesa de Ana')
  })
})

describe('OfficeScene — movimento livre', () => {
  const document = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 })

  /** Uma cena mínima, só com o que o caminho do movimento toca. */
  function fakeScene(over: Record<string, unknown> = {}) {
    const view = {
      userId: 'you',
      container: { setPosition: vi.fn(), setDepth: vi.fn(), depth: 0 },
      body: {},
      lastDir: 'down' as string,
      tile: { x: 0, y: 0 },
      pos: { x: 0, y: 0 },
    }
    const s = {
      youId: 'you',
      document,
      characters: new Map([['you', view]]),
      placeBody: scenePrivate.placeBody,
      face: vi.fn(),
      updateConfettiDirection: vi.fn(),
      ...over,
    }
    return { s, view }
  }

  it('desenha em pixel INTEIRO — float faz a arte tremer entre texels', () => {
    const { s, view } = fakeScene()
    scenePrivate.placeBody.call(s, view, 100.7, 200.2, 'right', false, false)
    expect(view.container.setPosition).toHaveBeenCalledWith(101, 200)
  })

  it('mantém a posição CONTÍNUA no estado, mesmo desenhando arredondado', () => {
    // O arredondamento é só de desenho: o estado precisa continuar float, senão
    // a reconciliação divergiria do servidor a cada quadro.
    const { s, view } = fakeScene()
    scenePrivate.placeBody.call(s, view, 100.7, 200.2, 'right', false, false)
    expect(view.pos).toEqual({ x: 100.7, y: 200.2 })
  })

  it('reordena a profundidade pelo TILE ao andar', () => {
    // Sem isto o personagem para de reordenar frente/trás: fica sempre atrás
    // (ou sempre na frente) de quem estava lá quando ele nasceu. E o tile, não o
    // pixel, porque é a escala que a mobília usa.
    const { s, view } = fakeScene()
    scenePrivate.placeBody.call(s, view, 100, 200, 'down', false, false)
    expect(view.container.setDepth).toHaveBeenCalledWith(1000 + 6)
    expect(view.tile).toEqual({ x: 3, y: 6 })
  })

  it('andar apaga o balão de PENSAMENTO na hora, sem esperar a volta do servidor', () => {
    const clearBubble = vi.fn()
    const { s, view } = fakeScene({ clearBubble })

    const andando = { ...view, bubbleKind: 'thought' }
    scenePrivate.placeBody.call(s, andando, 10, 10, 'down', true, false)
    expect(clearBubble).toHaveBeenCalledWith(andando)

    // Pensar é o que se faz PARADO: quem não se mexeu mantém o balão.
    clearBubble.mockClear()
    const parado = { ...view, bubbleKind: 'thought' }
    scenePrivate.placeBody.call(s, parado, 10, 10, 'down', false, false)
    expect(clearBubble).not.toHaveBeenCalled()
  })

  it('só vira o personagem quando a pose muda de verdade', () => {
    const { s, view } = fakeScene()
    view.lastDir = 'right'
    scenePrivate.placeBody.call(s, view, 10, 10, 'right', false, false)
    expect(s.face).not.toHaveBeenCalled()

    scenePrivate.placeBody.call(s, view, 10, 10, 'left', false, false)
    expect(s.face).toHaveBeenCalledWith(view, 'left')
  })

  /** Só o caminho de amostragem de input do `update`. */
  function fakeSceneAndando(over: Record<string, unknown> = {}) {
    const predicted = { x: 112.5, y: 144.25 }
    const bridge = { isMovementLocked: () => false, emitInput: vi.fn(), emitSelfBody: vi.fn() }
    const s = {
      bodyPredictor: {
        predict: vi.fn((dx: number, dy: number, dtMs: number, sprint: boolean) => ({
          seq: 1,
          dx,
          dy,
          dtMs,
          sprint,
        })),
        current: () => predicted,
      },
      bridge,
      inputLocked: false,
      sinceInput: 0,
      shiftKey: { isDown: false },
      autoMove: null as string | null,
      pressedMove: () => null,
      drawRemoteBodies: vi.fn(),
      updateBalls: vi.fn(),
      drawOwnBody: vi.fn(),
      ...over,
    }
    return { s, bridge, predicted }
  }

  it('a caminhada automática vira input, como se a tecla estivesse segurada', () => {
    // O Seguir não manda mais passo: ele segura uma direção, e é ESTA amostragem
    // que a transforma em deslocamento — um caminho só até o servidor, passando
    // pela predição.
    const { s, bridge } = fakeSceneAndando({ autoMove: 'right' })
    scenePrivate.update.call(s, 1000, 40)
    // E vai marcado como 'auto': quem cancela o Seguir ao ver alguém assumir o
    // controle precisa distinguir isto da tecla de uma pessoa, senão o Seguir se
    // autocancela no primeiro quadro — um passo e para.
    expect(bridge.emitInput).toHaveBeenCalledWith(expect.objectContaining({ dx: 1, dy: 0 }), 'auto')
  })

  it('o teclado ganha da caminhada automática', () => {
    const { s, bridge } = fakeSceneAndando({ autoMove: 'right', pressedMove: () => 'up' })
    scenePrivate.update.call(s, 1000, 40)
    expect(bridge.emitInput).toHaveBeenCalledWith(expect.objectContaining({ dx: 0, dy: -1 }), 'keyboard')
  })

  it('publica a posição PREVISTA — é por ela que o Seguir vira a esquina e solta a tecla', () => {
    const { s, bridge, predicted } = fakeSceneAndando({ autoMove: 'right' })
    scenePrivate.update.call(s, 1000, 40)
    expect(bridge.emitSelfBody).toHaveBeenCalledWith({ x: predicted.x, y: predicted.y })
  })
})

function mapaComSala() {
  const document = createEmptyMapDocumentV1({ width: 30, height: 30, tileSize: 32 })
  document.objects.push({
    id: 'room-1',
    layerKey: 'meeting-rooms',
    type: 'meeting-room',
    geometry: { kind: 'rectangle', x: 96, y: 96, width: 128, height: 128 },
    properties: {
      externalKey: 'aurora',
      name: 'Aurora',
      status: 'OPEN',
      capacity: 4,
      voiceEnabled: true,
      accessPolicy: 'OPEN',
    },
  })
  return document
}

describe('OfficeScene — bola chutável', () => {
  const bola = (over: Partial<OfficeBall> = {}): OfficeBall => ({
    id: 'ball-1',
    x: 96,
    y: 96,
    vx: 0,
    vy: 0,
    memberIds: ['ball-1'],
    ...over,
  })

  function fakeSceneComBola(over: Record<string, unknown> = {}) {
    const scene = {
      youId: 'ana',
      document: createEmptyMapDocumentV1({ width: 30, height: 30, tileSize: 32 }),
      ballStates: new Map<string, OfficeBall>([['ball-1', bola()]]),
      editing: false,
      bodyPredictor: undefined,
      autoMove: null,
      shiftKey: { isDown: false },
      pressedMove: () => null,
      refreshBallVisuals: vi.fn(),
      // O giro da bola escreve na imagem publicada — sem o mapa, `updateBalls`
      // estoura ao tentar rodá-la.
      publishedObjectImages: new Map<string, unknown>(),
      ballFlights: new Map(),
      earshotLevel: () => 0,
      applyPaintSplat: vi.fn(),
      tileAtPixel: scenePrivate.tileAtPixel,
      updateBalls: scenePrivate.updateBalls,
      playBallKick: scenePrivate.playBallKick,
      ...over,
    }
    return scene
  }

  /** Uma cena com a peça publicada, para medir o que o arco escreve na imagem. */
  function fakeSceneComImagem(over: Record<string, unknown> = {}) {
    const image = {
      x: 0,
      y: 0,
      rotation: 0,
      depth: 0,
      scaleX: 1,
      scaleY: 1,
      setPosition: vi.fn(function (this: unknown, x: number, y: number) {
        Object.assign(image, { x, y })
        return image
      }),
      setDepth: vi.fn(function (this: unknown, d: number) {
        image.depth = d
        return image
      }),
      setScale: vi.fn(function (this: unknown, sx: number, sy: number) {
        Object.assign(image, { scaleX: sx, scaleY: sy })
        return image
      }),
      setVisible: vi.fn().mockReturnThis(),
      setRotation: vi.fn().mockReturnThis(),
    }
    const scene = {
      document: createEmptyMapDocumentV1({ width: 30, height: 30, tileSize: 32 }),
      editing: false,
      publishedObjectImages: new Map<string, unknown>([['ball-1', image]]),
      hiddenPublishedIds: new Set<string>(),
      ballStates: new Map<string, OfficeBall>(),
      ballFlights: new Map<string, { totalMs: number; lift: number }>(),
      ballLayout: () =>
        new Map([
          [
            'ball-1',
            { originX: 96, originY: 96, slices: [{ id: 'ball-1', px: 96, py: 96, depth: 5, scaleX: 1, scaleY: 1 }] },
          ],
        ]),
      refreshBallVisuals: scenePrivate.refreshBallVisuals,
      ...over,
    }
    return { scene, image }
  }

  it('o chute alto SOBE: no ápice a bola está mais alta, maior e acima de tudo', () => {
    // A mecânica (atravessar a mobília) já existia; o que faltava era a bola
    // PARECER que está no ar — sem isso o chute alto sai visualmente rasteiro.
    const { scene, image } = fakeSceneComImagem()
    scene.ballFlights.set('ball-1', { totalMs: 700, lift: 40 })
    // Metade do prazo restante = ápice da meia-senóide.
    scene.ballStates.set('ball-1', { id: 'ball-1', x: 96, y: 96, vx: 300, vy: 0, airborneMs: 350 })

    scenePrivate.refreshBallVisuals.call(scene)

    expect(image.y).toBeLessThan(96)
    expect(image.scaleX).toBeGreaterThan(1)
    expect(image.depth).toBeGreaterThan(5)
  })

  it('ao pousar, volta à altura, à escala e à profundidade de CHÃO', () => {
    // A base é sempre a escala do layout, nunca a viva: partir da inflada faria
    // a bola crescer a cada chute, sem nunca voltar.
    const { scene, image } = fakeSceneComImagem()
    scene.ballStates.set('ball-1', { id: 'ball-1', x: 96, y: 96, vx: 0, vy: 0 })

    scenePrivate.refreshBallVisuals.call(scene)

    expect(image.y).toBe(96)
    expect(image.scaleX).toBe(1)
    expect(image.depth).toBe(5)
  })

  it('no começo e no fim do voo a bola está rente ao chão', () => {
    const { scene, image } = fakeSceneComImagem()
    scene.ballFlights.set('ball-1', { totalMs: 700, lift: 40 })
    scene.ballStates.set('ball-1', { id: 'ball-1', x: 96, y: 96, vx: 300, vy: 0, airborneMs: 700 })

    scenePrivate.refreshBallVisuals.call(scene)

    expect(image.y).toBeCloseTo(96, 5)
  })

  it('o chute guarda a VELOCIDADE, não uma trajetória', () => {
    // O evento deixou de trazer o caminho resolvido: ele traz o estado da bola,
    // e a cena integra a mesma física do servidor a partir dali.
    const scene = fakeSceneComBola()
    const chutada = bola({ vx: 0, vy: 380 })

    scenePrivate.playBallKick.call(scene, 'ana', chutada, 'kick')

    expect(scene.ballStates.get('ball-1')).toMatchObject({ vx: 0, vy: 380 })
  })

  it('integra a bola no quadro e redesenha quando ela se mexe', () => {
    const scene = fakeSceneComBola({
      ballStates: new Map<string, OfficeBall>([['ball-1', bola({ vy: 300 })]]),
    })

    scenePrivate.updateBalls.call(scene, 33)

    expect(scene.ballStates.get('ball-1')!.y).toBeGreaterThan(96)
    expect(scene.refreshBallVisuals).toHaveBeenCalled()
  })

  it('bola parada não redesenha nada — quadro parado tem de custar zero', () => {
    const scene = fakeSceneComBola()

    scenePrivate.updateBalls.call(scene, 33)

    expect(scene.refreshBallVisuals).not.toHaveBeenCalled()
  })

  it('no modo de edição a bola não roda: é mobília sendo arrastada', () => {
    const scene = fakeSceneComBola({
      editing: true,
      ballStates: new Map<string, OfficeBall>([['ball-1', bola({ vy: 300 })]]),
    })

    scenePrivate.updateBalls.call(scene, 33)

    expect(scene.ballStates.get('ball-1')!.y).toBe(96)
  })
})

describe('OfficeScene — paintball', () => {
  function fakeImage() {
    return {
      scene: {},
      scale: 1,
      alpha: 1,
      setTint: vi.fn().mockReturnThis(),
      setDepth: vi.fn().mockReturnThis(),
      setAlpha: vi.fn().mockReturnThis(),
      destroy: vi.fn(),
    }
  }

  function fakeScene(overrides: Record<string, unknown> = {}) {
    const container = { add: vi.fn() }
    const images: ReturnType<typeof fakeImage>[] = []
    const delayedCalls: Array<() => void> = []
    const view = {
      userId: 'bruno',
      container,
      avatar: {
        userId: 'bruno',
        avatarStyle: null,
        avatarSeed: null,
        avatarOptions: null,
      } as Pick<OfficeOccupant, 'userId' | 'avatarStyle' | 'avatarSeed' | 'avatarOptions' | 'paintMarker'>,
      paintSplats: undefined as Map<string, unknown> | undefined,
    }
    const scene = {
      view,
      images,
      tileAtPixel: scenePrivate.tileAtPixel,
      delayedCalls,
      youId: 'ana',
      bridge: { occupantSnapshot: vi.fn(() => ({ userId: 'ana', ...emPixel(1, 1) })) },
      document: createEmptyMapDocumentV1({ width: 20, height: 20, tileSize: 32 }),
      characters: new Map<string, unknown>([['bruno', view]]),
      add: {
        image: vi.fn(() => {
          const image = fakeImage()
          images.push(image)
          return image
        }),
      },
      tweens: { add: vi.fn((config: Record<string, unknown>) => config) },
      time: { delayedCall: vi.fn((_ms: number, fn: () => void) => delayedCalls.push(fn)) },
      loadCharacterSprite: vi.fn(),
      earshotLevel: scenePrivate.earshotLevel,
      applyPaintSplat: scenePrivate.applyPaintSplat,
      burstPaint: scenePrivate.burstPaint,
      ...overrides,
    }
    return scene
  }

  // De/para em PIXEL: o disparo vem resolvido do servidor (`fireBodyShot`), e a
  // cena só anima. Antes era uma lista de tiles, e a cena convertia cada um em
  // centro — com posição contínua isso faria o tiro sair do lugar errado.
  const shot = {
    shooterId: 'ana',
    from: { x: 48, y: 48 },
    to: { x: 48, y: 112 },
    durationMs: 56,
    color: 0xff3b7b,
    splat: null,
  }

  it('anima a bolinha do atirador até o tile onde o servidor disse que ela estoura', () => {
    const scene = fakeScene()

    scenePrivate.playPaintballShot.call(scene, shot)

    const config = scene.tweens.add.mock.calls[0][0] as { x: number; y: number; duration: number }
    // Um alvo só, e não um por tile: o tiro é reto e não passa por quina
    // nenhuma — diferente do chute, que rebate.
    expect(config.x).toBe(48)
    expect(config.y).toBe(112 + PAINTBALL_MUZZLE_Y)
    expect(config.duration).toBe(56)
    expect(scene.add.image).toHaveBeenCalledWith(48, 48 + PAINTBALL_MUZZLE_Y, PAINT_PELLET_TEXTURE)
    expect(playPaintballSound).toHaveBeenCalledWith({ hit: false, volume: 1 })
  })

  it('tiro contra a parede colada (caminho vazio) não anima, mas o disparo soa', () => {
    const scene = fakeScene()
    vi.mocked(playPaintballSound).mockClear()

    scenePrivate.playPaintballShot.call(scene, { ...shot, to: shot.from, durationMs: 0 })

    expect(scene.tweens.add).not.toHaveBeenCalled()
    expect(playPaintballSound).toHaveBeenCalledWith({ hit: false, volume: 1 })
  })

  // O pedido que originou a regra: paintball é brincadeira do espaço público.
  // Quem está numa chamada a poucos tiles dali não pode ouvir o tiro.
  it('tiro na área aberta não vaza para quem está em sala de chamada', () => {
    const scene = fakeScene({
      bridge: { occupantSnapshot: vi.fn(() => ({ userId: 'ana', ...emPixel(4, 4) })) },
      document: mapaComSala(),
    })
    vi.mocked(playPaintballSound).mockClear()

    scenePrivate.playPaintballShot.call(scene, { ...shot, from: { x: 272, y: 144 }, to: { x: 272, y: 208 } })

    expect(playPaintballSound).not.toHaveBeenCalled()
  })

  it('tiro do outro lado do escritório não chega aqui', () => {
    const scene = fakeScene({ document: mapaComSala() })
    vi.mocked(playPaintballSound).mockClear()

    scenePrivate.playPaintballShot.call(scene, { ...shot, from: { x: 656, y: 656 }, to: { x: 656, y: 720 } })

    expect(playPaintballSound).not.toHaveBeenCalled()
  })

  it('tiro perto, mas não em cima, chega mais baixo', () => {
    const scene = fakeScene({ document: mapaComSala() })
    vi.mocked(playPaintballSound).mockClear()

    scenePrivate.playPaintballShot.call(scene, { ...shot, from: { x: 208, y: 48 }, to: { x: 208, y: 112 } })

    const { volume } = vi.mocked(playPaintballSound).mock.calls[0][0] as { volume: number }
    expect(volume).toBeGreaterThan(0)
    expect(volume).toBeLessThan(1)
  })

  it('acerto gruda a mancha em quem levou, com a cor de quem atirou', () => {
    const scene = fakeScene()
    const splat = { id: 'ana:bruno:1', userId: 'bruno', byUserId: 'ana', color: 0x2ec4b6, ttlMs: 25_000 }

    scenePrivate.playPaintballShot.call(scene, { ...shot, splat })

    expect(scene.view.container.add).toHaveBeenCalledTimes(1)
    expect(scene.view.paintSplats?.size).toBe(1)
    const image = scene.images.find((candidate) => candidate.setTint.mock.calls[0]?.[0] === 0x2ec4b6)
    expect(image).toBeDefined()
  })

  // O `welcome` sintético do bridge repete as marcas vivas a cada remontagem
  // da cena; repor a mesma imagem duplicaria a tinta e o timer dela.
  it('a mesma marca não é aplicada duas vezes', () => {
    const scene = fakeScene()
    const splat = { id: 'ana:bruno:1', userId: 'bruno', byUserId: 'ana', color: 0x2ec4b6, ttlMs: 25_000 }

    scenePrivate.applyPaintSplat.call(scene, splat)
    scenePrivate.applyPaintSplat.call(scene, splat)

    expect(scene.view.container.add).toHaveBeenCalledTimes(1)
  })

  it('a mancha some sozinha quando o ttl acaba', () => {
    const scene = fakeScene()
    const splat = { id: 'ana:bruno:1', userId: 'bruno', byUserId: 'ana', color: 0x2ec4b6, ttlMs: 25_000 }

    scenePrivate.applyPaintSplat.call(scene, splat)
    expect(scene.view.paintSplats?.size).toBe(1)

    // O timer do fade dispara; o `onComplete` do tween é quem apaga de fato.
    scene.delayedCalls.forEach((fn) => fn())
    const fade = scene.tweens.add.mock.calls
      .map((call) => call[0] as { alpha?: number; onComplete?: () => void })
      .find((config) => config.alpha === 0)
    fade?.onComplete?.()

    expect(scene.view.paintSplats?.size).toBe(0)
  })

  it('marca para quem ainda não tem personagem na cena é ignorada, sem quebrar', () => {
    const scene = fakeScene()
    const splat = { id: 'ana:fantasma:1', userId: 'fantasma', byUserId: 'ana', color: 0x2ec4b6, ttlMs: 1_000 }

    expect(() => scenePrivate.applyPaintSplat.call(scene, splat)).not.toThrow()
    expect(scene.view.container.add).not.toHaveBeenCalled()
  })

  // O borrão único que crescia lia como fumaça: escalar reamostra a arte sob
  // `pixelArt`, e no meio do fade sobrava um cinza sem forma sobre o piso claro.
  it('o estouro do impacto são respingos em tamanho real, que somem sozinhos', () => {
    const scene = fakeScene()

    scenePrivate.burstPaint.call(scene, 10, 20, 0xffd23f)

    expect(scene.images).toHaveLength(PAINT_BURST_DROPS)
    expect(scene.add.image).toHaveBeenCalledWith(10, 20, PAINT_PELLET_TEXTURE)
    const configs = scene.tweens.add.mock.calls.map(
      (call) => call[0] as { alpha: number; x: number; y: number; onComplete: () => void },
    )
    expect(configs).toHaveLength(PAINT_BURST_DROPS)
    // Saem em direções diferentes — respingo simétrico não lê como estouro.
    expect(new Set(configs.map((c) => `${Math.round(c.x)},${Math.round(c.y)}`)).size).toBe(PAINT_BURST_DROPS)
    for (const config of configs) {
      expect(config.alpha).toBe(0)
      config.onComplete()
    }
    expect(scene.images.every((image) => image.destroy.mock.calls.length === 1)).toBe(true)
  })

  // A mancha não pode ser escalada nem girada: a máscara já vem no tamanho de
  // desenho, e transformar reamostra a arte (é o que serrilhava a tinta).
  it('a mancha entra por alfa, sem escala nem giro', () => {
    const scene = fakeScene()
    const splat = { id: 'ana:bruno:1', userId: 'bruno', byUserId: 'ana', color: 0x2ec4b6, ttlMs: 25_000 }

    scenePrivate.applyPaintSplat.call(scene, splat)

    const image = scene.images[0]
    expect(image.setAlpha).toHaveBeenCalledWith(0)
    expect(image).not.toHaveProperty('setAngle')
    const entrada = scene.tweens.add.mock.calls[0][0] as { alpha: number }
    expect(entrada.alpha).toBe(1)
    // A textura escolhida é a da variante derivada do id.
    const usada = (scene.add.image.mock.calls[0] as unknown as [number, number, string])[2]
    expect(usada).toMatch(/^office-paint-splat-\d$/)
  })

  it('equipar recompõe o sprite preservando o personagem escolhido', () => {
    const scene = fakeScene()
    scene.view.avatar = {
      userId: 'bruno',
      avatarStyle: null,
      avatarSeed: 'semente',
      avatarOptions: null,
    }

    scenePrivate.setPaintMarker.call(scene, 'bruno', true)

    expect(scene.loadCharacterSprite).toHaveBeenCalledWith(
      expect.objectContaining({ avatarSeed: 'semente', paintMarker: true }),
      scene.view,
    )
  })

  it('equipar de novo quem já está armado não recompõe nada', () => {
    const scene = fakeScene()
    scene.view.avatar = { ...scene.view.avatar, paintMarker: true }

    scenePrivate.setPaintMarker.call(scene, 'bruno', true)

    expect(scene.loadCharacterSprite).not.toHaveBeenCalled()
  })
})

describe('OfficeScene — a unidade de quem OUVE', () => {
  const document = createEmptyMapDocumentV1({ width: 30, height: 30, tileSize: 32 })

  /** Occupant como ele chega do bridge desde o movimento livre: em PIXEL. */
  function ocupante(userId: string, tileX: number, tileY: number): OfficeOccupant {
    return {
      userId,
      name: userId,
      x: tileX * 32 + 16,
      y: tileY * 32 + 16,
      dir: 'down',
      avatarSeed: null,
      avatarOptions: null,
    }
  }

  function cena(you: OfficeOccupant) {
    return {
      youId: you.userId,
      document,
      bridge: { occupantSnapshot: (id: string) => (id === you.userId ? you : null) },
      tileAtPixel: scenePrivate.tileAtPixel,
    }
  }

  it('a batida da bola ao lado chega inteira — o ouvinte é convertido para TILE', () => {
    // O ouvinte vem do bridge em PIXEL e `officeSoundLevel` cobra TILE. Sem a
    // conversão toda distância estourava o raio e a bola ficava muda: o gesto
    // acontecia na sua frente e não saía som nenhum.
    const you = ocupante('you', 10, 10)
    const nivel = scenePrivate.earshotLevel.call(cena(you), { x: 11, y: 10 })
    expect(nivel).toBeGreaterThan(0)
  })

  it('do outro lado do mapa continua mudo', () => {
    const you = ocupante('you', 2, 2)
    expect(scenePrivate.earshotLevel.call(cena(you), { x: 25, y: 25 })).toBe(0)
  })

  it('sem snapshot seu ainda, o som sai inteiro', () => {
    const cenaSemVoce = { youId: 'you', document, bridge: { occupantSnapshot: () => null }, tileAtPixel: scenePrivate.tileAtPixel }
    expect(scenePrivate.earshotLevel.call(cenaSemVoce, { x: 25, y: 25 })).toBe(1)
  })

  it('a palma do high-five é ouvida por quem está a um tile — não a um PIXEL', () => {
    // Os três occupants entram em PIXEL. Sem converter, o raio de 3 tiles virava
    // um raio de 3 pixels e só quem batia a mão ouvia a própria palma.
    const you = ocupante('you', 10, 10)
    const ana = ocupante('ana', 11, 10)
    const bia = ocupante('bia', 12, 10)
    const todos = new Map([you, ana, bia].map((o) => [o.userId, o]))

    expect(
      highFiveWithinEarshot(document, 'you', (id) => todos.get(id) ?? null, ['ana', 'bia']),
    ).toBe(true)
  })

  it('a palma de quem está longe não vaza', () => {
    const you = ocupante('you', 2, 2)
    const ana = ocupante('ana', 25, 25)
    const bia = ocupante('bia', 26, 25)
    const todos = new Map([you, ana, bia].map((o) => [o.userId, o]))

    expect(
      highFiveWithinEarshot(document, 'you', (id) => todos.get(id) ?? null, ['ana', 'bia']),
    ).toBe(false)
  })
})

describe('OfficeScene — o kart dos OUTROS', () => {
  const document = createEmptyMapDocumentV1({ width: 30, height: 30, tileSize: 32 })

  function cena(amostra: { x: number; y: number; dir: string; heading?: number }, over: Record<string, unknown> = {}) {
    const view = { userId: 'ana', kart: {}, lastDir: 'down' }
    const placeBody = vi.fn()
    const s = {
      youId: 'you',
      document,
      characters: new Map([['ana', view]]),
      bodyInterpolator: { at: () => amostra },
      lastRemoteDraw: new Map<string, { x: number; y: number; heading?: number; at: number }>(),
      remoteSprint: new Set<string>(),
      isRiding: () => true,
      emitRemoteKartSmoke: vi.fn(),
      placeBody,
      ...over,
    }
    return { s, placeBody }
  }

  it('entrega o RUMO interpolado ao desenho — sem ele o kart desliza apontado para onde nasceu', () => {
    const { s, placeBody } = cena({ x: 100, y: 100, dir: 'right', heading: 1.2 })
    scenePrivate.drawRemoteBodies.call(s, 1000)
    expect(placeBody).toHaveBeenCalledWith(expect.anything(), 100, 100, 'right', false, false, 1.2)
  })

  it('o rumo é PEGAJOSO: amostra sem rumo mantém o último, em vez de saltar para zero', () => {
    const { s, placeBody } = cena({ x: 100, y: 100, dir: 'right' })
    s.lastRemoteDraw.set('ana', { x: 90, y: 100, heading: 1.2, at: 980 })
    scenePrivate.drawRemoteBodies.call(s, 1000)
    expect(placeBody).toHaveBeenCalledWith(expect.anything(), 100, 100, 'right', true, false, 1.2)
  })

  it('quem está a pé não recebe rumo — senão um rumo velho giraria o kart seguinte', () => {
    const { s, placeBody } = cena({ x: 100, y: 100, dir: 'right', heading: 1.2 }, { isRiding: () => false })
    s.lastRemoteDraw.set('ana', { x: 90, y: 100, heading: 1.2, at: 980 })
    scenePrivate.drawRemoteBodies.call(s, 1000)
    expect(placeBody).toHaveBeenCalledWith(expect.anything(), 100, 100, 'right', true, false, undefined)
  })
})

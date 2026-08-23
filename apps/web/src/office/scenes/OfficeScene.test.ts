import { describe, expect, it, vi } from 'vitest'
import {
  createEmptyMapDocumentV1,
  type MapDocumentV1,
  type OfficeBall,
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

import {
  computeAppliedZoom,
  computeMinCameraZoom,
  computeScreenPosition,
  OfficeScene,
  confettiLaunchConfig,
  confettiBurstConfig,
  zoneLabelText,
  CONFETTI_TEXTURE,
  CONFETTI_COLORS,
  KART_TEXTURE,
  NEARBY_SPEECH_BUBBLE_START_Y,
  NEARBY_SPEECH_BUBBLE_END_Y,
  NEARBY_THOUGHT_BUBBLE_Y,
} from './OfficeScene'
import { playApplauseSound } from '../media/applause-sound'
import { playHighFiveSound } from '../media/high-five-sound'
import { playKickSound } from '../media/kick-sound'
import { MovementPredictor } from '../MovementPredictor'

const scenePrivate = OfficeScene.prototype as unknown as {
  pressedMove(this: unknown): string | null
  playBallKick(this: unknown, kick: unknown): void
  cancelBallTweens(this: unknown, ballId: string): void
  isWithinEarshot(this: unknown, tile: unknown): boolean
  emitConfetti(this: unknown, active: boolean): void
  setFloatingReactionsActive(this: unknown, active: boolean): void
  setConfetti(this: unknown, userId: string, active: boolean): void
  setHandRaised(this: unknown, userId: string, active: boolean): void
  updateConfettiDirection(this: unknown, userId: string, dir: string): void
  celebrate(this: unknown): void
  handle(this: unknown, message: unknown): void
  showNearbyBubble(this: unknown, userId: string, text: string, kind: 'speech' | 'thought' | 'reaction'): void
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
          occupantSnapshot: (userId: string) =>
            ({ ana: { x: 2, y: 2 }, bruno: { x: 3, y: 2 }, voce: { x: 15, y: 15 } } as Record<
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
        occupantSnapshot: (userId: string) => {
          const position = posicoes[userId]
          return position ? { userId, ...position } : null
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

describe('OfficeScene.step — auto-recuperação de CharacterView sumida', () => {
  function fakeDocument(): MapDocumentV1 {
    return {
      map: { width: 10, height: 10, tileWidth: 32, tileHeight: 32 },
      tilesets: [],
      objects: [],
    } as unknown as MapDocumentV1
  }

  it('sem view local mas com occupant conhecido no bridge, recria a view (spawn) e segue o passo — não descarta', () => {
    const occupant = { userId: 'ana', name: 'Ana', x: 6, y: 5, dir: 'right', avatarSeed: null, avatarOptions: null }
    const spawnedView = {
      container: { setDepth: vi.fn() },
      body: {},
      bodyBaseY: 0,
      lastDir: 'down',
      tile: { x: 5, y: 5 },
      textureKey: null,
      tween: undefined,
      bobTween: undefined,
    }
    const characters = new Map<string, unknown>()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const fakeScene = {
      characters,
      bridge: { occupantSnapshot: vi.fn(() => occupant) },
      spawn: vi.fn(() => characters.set('ana', spawnedView)),
      document: fakeDocument(),
      tweens: { add: vi.fn(() => ({})) },
      face: vi.fn(),
      updateConfettiDirection: vi.fn(),
      clearBubble: vi.fn(),
      ridingUserIds: new Set<string>(),
    }

    scenePrivate.step.call(fakeScene, 'ana', 6, 5, 'right', false)

    expect(fakeScene.bridge.occupantSnapshot).toHaveBeenCalledWith('ana')
    expect(fakeScene.spawn).toHaveBeenCalledWith(occupant)
    expect(fakeScene.face).toHaveBeenCalledWith(spawnedView, 'right')
    expect(warnSpy).toHaveBeenCalled()

    warnSpy.mockRestore()
  })

  it('sem view local e sem occupant conhecido no bridge, descarta silenciosamente (com aviso no console)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fakeScene = {
      characters: new Map<string, unknown>(),
      bridge: { occupantSnapshot: vi.fn(() => null) },
      spawn: vi.fn(),
    }

    expect(() => scenePrivate.step.call(fakeScene, 'fantasma', 6, 5, 'right', false)).not.toThrow()
    expect(fakeScene.spawn).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()

    warnSpy.mockRestore()
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

  it('de kart o passo é mais rápido que correndo a pé', () => {
    const aPe = fakeSceneComKart()
    scenePrivate.step.call(aPe.scene, 'ana', 6, 5, 'right', true)
    const duracaoCorrendo = aPe.scene.tweens.add.mock.calls[0][0].duration

    const deKart = fakeSceneComKart(['ana'])
    scenePrivate.step.call(deKart.scene, 'ana', 6, 5, 'right', false)
    const duracaoDeKart = deKart.scene.tweens.add.mock.calls[0][0].duration

    expect(duracaoDeKart).toBeLessThan(duracaoCorrendo)
  })

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

describe('predição local vs. estado autoritativo do kart (#22253)', () => {
  const document = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 })

  it('não prevê passo para o tile de um kart estacionado', () => {
    // Regressão do teleporte: o servidor recusa o passo (kart bloqueia o
    // tile) e o cliente previa mesmo assim — a divergência acumulava até o
    // primeiro eco divergente reancorar tudo de uma vez.
    const kartStates = new Map([['kart-1', { id: 'kart-1', x: 4, y: 3, dir: 'up' as const }]])
    const predictor = new MovementPredictor(document, { karts: () => [...kartStates.values()] })
    predictor.reset({ x: 3, y: 3 })
    const view = { lastDir: 'down' as const }
    const s = {
      youId: 'you',
      document,
      predictor,
      characters: new Map([['you', view]]),
      bridge: { isConnected: () => true },
      step: vi.fn(),
      face: vi.fn(),
      updateConfettiDirection: vi.fn(),
    }

    scenePrivate.applyLocalIntent.call(s, 'right', false, 1)

    expect(s.step).not.toHaveBeenCalled()
    expect(s.face).toHaveBeenCalledWith(view, 'right')
  })

  it('kart montado não bloqueia: o passo volta a ser previsto', () => {
    const kartStates = new Map([
      ['kart-1', { id: 'kart-1', x: 4, y: 3, dir: 'up' as const, riderUserId: 'you' }],
    ])
    const predictor = new MovementPredictor(document, { karts: () => [...kartStates.values()] })
    predictor.reset({ x: 3, y: 3 })
    const s = {
      youId: 'you',
      document,
      predictor,
      characters: new Map([['you', { lastDir: 'down' as const }]]),
      bridge: { isConnected: () => true },
      step: vi.fn(),
      face: vi.fn(),
      updateConfettiDirection: vi.fn(),
    }

    scenePrivate.applyLocalIntent.call(s, 'right', false, 1)

    expect(s.step).toHaveBeenCalledWith('you', 4, 3, 'right', false)
  })
})

describe("OfficeScene.handle('sync') — re-ancoragem por seq", () => {
  const document = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 })

  function fakeSceneWithVerdict(verdict: 'ignore' | 'reanchor') {
    const view = { container: { setPosition: vi.fn() }, tween: { stop: vi.fn() }, lastDir: 'down' }
    return {
      view,
      s: {
        youId: 'you',
        document,
        predictor: { confirmSync: vi.fn(() => verdict) },
        characters: new Map([['you', view]]),
        snapSelfTo: scenePrivate.snapSelfTo,
        updateConfettiDirection: vi.fn(),
        face: vi.fn(),
      },
    }
  }

  it('repassa o seq do servidor ao predictor e re-ancora quando o passo foi recusado', () => {
    const { s, view } = fakeSceneWithVerdict('reanchor')

    scenePrivate.handle.call(s, { type: 'sync', x: 2, y: 3, dir: 'right', seq: 9 })

    expect(s.predictor.confirmSync).toHaveBeenCalledWith(2, 3, 9)
    expect(view.tween.stop).toHaveBeenCalled()
    expect(view.container.setPosition).toHaveBeenCalledWith(2 * 32 + 16, 3 * 32 + 16)
  })

  it("veredito 'ignore' (eco de parede) não mexe no personagem", () => {
    const { s, view } = fakeSceneWithVerdict('ignore')

    scenePrivate.handle.call(s, { type: 'sync', x: 2, y: 3, dir: 'right', seq: 9 })

    expect(view.container.setPosition).not.toHaveBeenCalled()
  })
})

describe('OfficeScene.update — predição que nunca foi confirmada', () => {
  const document = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 })

  it('expira e re-ancora o personagem na última posição confirmada pelo servidor', () => {
    // Passo que some no caminho (rate limit do hub descarta em silêncio,
    // pacote perdido): sem isto a divergência fica pendurada para sempre.
    const view = { container: { setPosition: vi.fn() }, tween: { stop: vi.fn() }, lastDir: 'down' }
    const s = {
      youId: 'you',
      document,
      inputLocked: false,
      lastInputAt: 0,
      predictor: { pruneStale: vi.fn(() => ({ x: 1, y: 2 })) },
      characters: new Map([['you', view]]),
      snapSelfTo: scenePrivate.snapSelfTo,
      reanchorStalePrediction: scenePrivate.reanchorStalePrediction,
      bridge: { isMovementLocked: () => false, emitMoveIntent: vi.fn(), nextMoveSeq: () => 1 },
      pressedMove: () => null,
      isRiding: () => false,
      shiftKey: { isDown: false },
      applyLocalIntent: vi.fn(),
      updateConfettiDirection: vi.fn(),
      face: vi.fn(),
    }

    OfficeScene.prototype.update.call(s as unknown as OfficeScene, 1_000)

    expect(view.container.setPosition).toHaveBeenCalledWith(1 * 32 + 16, 2 * 32 + 16)
  })
})


describe('OfficeScene — bola chutável', () => {
  function fakeSceneComBola() {
    const image = {
      rotation: 0,
      y: 0,
      depth: 30,
      scaleX: 1,
      scaleY: 1,
      setPosition: vi.fn().mockReturnThis(),
      setVisible: vi.fn().mockReturnThis(),
      setRotation: vi.fn().mockReturnThis(),
      setDepth: vi.fn().mockReturnThis(),
      setScale: vi.fn().mockReturnThis(),
    }
    return {
      image,
      scene: {
        youId: 'ana',
        bridge: { occupantSnapshot: vi.fn(() => ({ userId: 'ana', x: 1, y: 1 })) },
        document: createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 }),
        ballStates: new Map<string, OfficeBall>([['ball-1', { id: 'ball-1', x: 1, y: 2 }]]),
        ballTweens: new Map(),
        publishedObjectImages: new Map<string, unknown>([['ball-1', image]]),
        tweens: {
          add: vi.fn((_config: { x: number[]; y: number[]; duration: number; rotation?: number }) => ({
            remove: vi.fn(),
            on: vi.fn(),
          })),
        },
        refreshBallVisuals: vi.fn(),
        isWithinEarshot: scenePrivate.isWithinEarshot,
        cancelBallTweens: scenePrivate.cancelBallTweens,
        // O layout sai do documento publicado (`mapBalls`); aqui basta o
        // resultado: a bola nasceu no tile (1,2), com um slice só, e com o
        // estado de CHÃO gravado (é para onde o voo devolve).
        ballLayout: () =>
          new Map([
            [
              'ball-1',
              {
                originX: 1,
                originY: 2,
                slices: [{ id: 'ball-1', px: 48, py: 80, depth: 30, scaleX: 1, scaleY: 1 }],
              },
            ],
          ]),
      },
    }
  }

  const kick = {
    ballId: 'ball-1',
    path: [
      { x: 1, y: 3 },
      { x: 1, y: 4 },
    ],
    durationMs: 160,
    power: 'kick' as const,
    grazed: false,
    bounces: 0,
  }

  it('anima a rolagem pelo caminho recebido e para no tile do servidor', () => {
    const { scene } = fakeSceneComBola()

    scenePrivate.playBallKick.call(scene, kick)

    const config = scene.tweens.add.mock.calls[0][0]
    // Um alvo por tile — a bola passa pelas quinas em vez de cortar reto.
    expect(config.x).toEqual([48, 48])
    expect(config.y).toEqual([112, 144])
    expect(config.duration).toBe(160)
    expect(config.rotation).toBeGreaterThan(0)
    expect(scene.ballStates.get('ball-1')).toEqual({ id: 'ball-1', x: 1, y: 4 })
    expect(playKickSound).toHaveBeenCalledWith({ power: 'kick', grazed: false })
  })

  it('bola entalada (caminho vazio) não anima, mas a batida sai', () => {
    const { scene } = fakeSceneComBola()
    vi.mocked(playKickSound).mockClear()

    scenePrivate.playBallKick.call(scene, { ...kick, path: [], durationMs: 0 })

    expect(scene.tweens.add).not.toHaveBeenCalled()
    expect(playKickSound).toHaveBeenCalled()
    expect(scene.ballStates.get('ball-1')).toEqual({ id: 'ball-1', x: 1, y: 2 })
  })

  it('bola de 2×2 move os quatro slices juntos e não gira', () => {
    const { scene } = fakeSceneComBola()
    const slices = [
      { id: 'p__0-0', px: 48, py: 80, depth: 30, scaleX: 1, scaleY: 1 },
      { id: 'p__1-0', px: 80, py: 80, depth: 30, scaleX: 1, scaleY: 1 },
      { id: 'p__0-1', px: 48, py: 112, depth: 30, scaleX: 1, scaleY: 1 },
      { id: 'p__1-1', px: 80, py: 112, depth: 30, scaleX: 1, scaleY: 1 },
    ]
    for (const slice of slices) {
      scene.publishedObjectImages.set(slice.id, {
        rotation: 0,
        y: 0,
        depth: 30,
        scaleX: 1,
        scaleY: 1,
        setPosition: vi.fn().mockReturnThis(),
        setVisible: vi.fn().mockReturnThis(),
        setRotation: vi.fn().mockReturnThis(),
        setDepth: vi.fn().mockReturnThis(),
        setScale: vi.fn().mockReturnThis(),
      })
    }
    scene.ballStates.set('pilates', { id: 'pilates', x: 1, y: 2, w: 2, h: 2, memberIds: slices.map((s) => s.id) })
    scene.ballLayout = () => new Map([['pilates', { originX: 1, originY: 2, slices }]])

    scenePrivate.playBallKick.call(scene, { ...kick, ballId: 'pilates', path: [{ x: 2, y: 2 }] })

    const configs = scene.tweens.add.mock.calls.map((call) => call[0])
    expect(configs).toHaveLength(4)
    // Todos deslocam o MESMO tile: a peça anda inteira, sem se desmontar.
    expect(configs.map((config) => config.x[0])).toEqual([80, 112, 80, 112])
    expect(configs.map((config) => config.y[0])).toEqual([80, 80, 112, 112])
    expect(configs.every((config) => config.rotation === undefined)).toBe(true)

    // O bug: guardando só o último tween, os outros três seguiam correndo
    // quando um chute novo chegava — e a peça se partia na tela.
    const tweens = scene.tweens.add.mock.results.map((result) => result.value)
    scenePrivate.playBallKick.call(scene, { ...kick, ballId: 'pilates', path: [{ x: 3, y: 2 }] })
    for (const tween of tweens) expect(tween.remove).toHaveBeenCalled()
  })

  it('chute alto sobe: arco no onUpdate e bola por cima de tudo', () => {
    const { scene, image } = fakeSceneComBola()
    const depthInicial = image.depth

    scenePrivate.playBallKick.call(scene, { ...kick, power: 'lob' })

    const config = scene.tweens.add.mock.calls[0][0] as unknown as {
      ease: string
      onUpdate?: (tween: { progress: number }) => void
    }
    // No ar a bola vai em velocidade constante; quem dá o ritmo é o arco.
    expect(config.ease).toBe('Linear')
    expect(image.setDepth).toHaveBeenCalledWith(9_000)

    // No meio do voo o `y` sobe em relação ao chão que o tween escreveu…
    image.y = 100
    config.onUpdate?.({ progress: 0.5 })
    expect(image.y).toBeLessThan(100)
    expect(image.setScale).toHaveBeenLastCalledWith(1.3, 1.3)

    // …e o fim do voo devolve profundidade e escala pelo layout.
    scenePrivate.cancelBallTweens.call(scene, 'ball-1')
    expect(image.setDepth).toHaveBeenLastCalledWith(depthInicial)
    expect(image.setScale).toHaveBeenLastCalledWith(1, 1)
  })

  // O bug: a escala do voo era lida da imagem VIVA, então um chute novo antes
  // do pouso tomava a escala já inflada como base — e a bola crescia a cada
  // chute, sem nunca voltar.
  it('chute novo durante o voo não deixa a bola crescer', () => {
    const { scene, image } = fakeSceneComBola()

    scenePrivate.playBallKick.call(scene, { ...kick, power: 'lob' })
    const primeiro = scene.tweens.add.mock.calls[0][0] as unknown as {
      onUpdate?: (tween: { progress: number }) => void
    }
    primeiro.onUpdate?.({ progress: 0.5 })
    // A imagem viva está inflada quando o segundo chute chega.
    image.scaleX = 1.3
    image.scaleY = 1.3

    scenePrivate.playBallKick.call(scene, { ...kick, power: 'lob' })
    const segundo = scene.tweens.add.mock.calls[1][0] as unknown as {
      onUpdate?: (tween: { progress: number }) => void
    }
    segundo.onUpdate?.({ progress: 0.5 })

    // Mesmo ápice do primeiro voo: a base é a escala de chão do layout.
    expect(image.setScale).toHaveBeenLastCalledWith(1.3, 1.3)
  })

  it('chute rasteiro não tem arco', () => {
    const { scene } = fakeSceneComBola()

    scenePrivate.playBallKick.call(scene, kick)

    const config = scene.tweens.add.mock.calls[0][0] as unknown as { ease: string; onUpdate?: unknown }
    expect(config.ease).toBe('Quad.easeOut')
    expect(config.onUpdate).toBeUndefined()
  })

  it('conduzir não faz barulho: um poc por passo viraria metralhadora', () => {
    const { scene } = fakeSceneComBola()
    vi.mocked(playKickSound).mockClear()

    scenePrivate.playBallKick.call(scene, { ...kick, power: 'dribble', path: [{ x: 1, y: 3 }] })

    expect(playKickSound).not.toHaveBeenCalled()
    // …mas a bola anda: a condução é movimento como qualquer outro.
    expect(scene.tweens.add).toHaveBeenCalled()
    expect(scene.ballStates.get('ball-1')).toMatchObject({ x: 1, y: 3 })
  })

  it('chute do outro lado do escritório não faz barulho aqui', () => {
    const { scene } = fakeSceneComBola()
    vi.mocked(playKickSound).mockClear()

    scenePrivate.playBallKick.call(scene, {
      ...kick,
      path: [{ x: 9, y: 9 }],
    })

    expect(playKickSound).not.toHaveBeenCalled()
  })
})


describe('OfficeScene — movimento em oito direções', () => {
  function teclas(pressionadas: string[]) {
    const key = (nome: string) => ({ isDown: pressionadas.includes(nome) })
    return {
      modifierKeyDown: false,
      keys: {
        up: [key('up')],
        down: [key('down')],
        left: [key('left')],
        right: [key('right')],
      },
    }
  }

  it('compõe vertical + horizontal numa diagonal', () => {
    expect(scenePrivate.pressedMove.call(teclas(['up', 'right']))).toBe('up-right')
    expect(scenePrivate.pressedMove.call(teclas(['down', 'left']))).toBe('down-left')
  })

  it('uma tecla só continua sendo passo reto', () => {
    expect(scenePrivate.pressedMove.call(teclas(['left']))).toBe('left')
    expect(scenePrivate.pressedMove.call(teclas([]))).toBeNull()
  })

  // Segurar A e D ao mesmo tempo não anda de lado nenhum: os opostos se
  // anulam, o que também evita mandar passo quando o dedo troca de direção
  // sem soltar a tecla anterior.
  it('eixos opostos se anulam', () => {
    expect(scenePrivate.pressedMove.call(teclas(['left', 'right']))).toBeNull()
    expect(scenePrivate.pressedMove.call(teclas(['left', 'right', 'up']))).toBe('up')
  })

  function cenaComPersonagem() {
    const view = {
      container: { setDepth: vi.fn(), x: 0, y: 0 },
      body: {},
      bodyBaseY: 0,
      lastDir: 'down',
      textureKey: null,
      tween: undefined,
      bobTween: undefined,
      kart: undefined as unknown,
      tile: { x: 5, y: 5 },
    }
    return {
      view,
      scene: {
        characters: new Map<string, unknown>([['ana', view]]),
        ridingUserIds: new Set<string>(),
        kartStates: new Map(),
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

  it('o passo diagonal dura √2 vezes o reto — mesma velocidade em qualquer direção', () => {
    const reto = cenaComPersonagem()
    scenePrivate.step.call(reto.scene, 'ana', 6, 5, 'right', false)
    const duracaoReta = reto.scene.tweens.add.mock.calls[0][0].duration

    const diagonal = cenaComPersonagem()
    scenePrivate.step.call(diagonal.scene, 'ana', 6, 6, 'right', false)
    const duracaoDiagonal = diagonal.scene.tweens.add.mock.calls[0][0].duration

    expect(duracaoDiagonal / duracaoReta).toBeCloseTo(Math.SQRT2, 3)
  })
})

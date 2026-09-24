import { describe, expect, it, vi } from 'vitest'
import { defaultCharacterFromSeed, PAINTBALL_MARKER_LAYERS } from '@legends/shared'
import {
  characterAssetUrl,
  characterSheetKey,
  composeCharacterSheet,
  characterPortraitDataUri,
  __clearCharacterCaches,
} from './character'

function fakeDeps() {
  const drawn: { src: string; args: number[] }[] = []
  const ctx = {
    imageSmoothingEnabled: true,
    clearRect: vi.fn(),
    drawImage: vi.fn((img: { src: string }, ...args: number[]) => drawn.push({ src: img.src, args })),
  }
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    toDataURL: () => 'data:image/png;base64,fake',
  } as unknown as HTMLCanvasElement
  return {
    drawn,
    deps: {
      createCanvas: () => canvas,
      loadImage: (src: string) => Promise.resolve({ src } as HTMLImageElement),
    },
  }
}

describe('characterAssetUrl', () => {
  it('prefixa /lpc/', () => {
    expect(characterAssetUrl('body/male/light.png')).toBe('/lpc/body/male/light.png')
  })
})

describe('composeCharacterSheet', () => {
  it('desenha as camadas na ordem de zPos', async () => {
    __clearCharacterCaches()
    const { drawn, deps } = fakeDeps()
    const base = defaultCharacterFromSeed('ana')
    const options = {
      ...base,
      items: { ...base.items, shoes: { item: 'feet_boots', variant: 'brown' } },
    }
    await composeCharacterSheet(options, deps)
    const srcs = drawn.map((d) => d.src)
    expect(srcs[0]).toContain('/lpc/body/')
    expect(srcs.indexOf(srcs.find((s) => s.includes('/feet/'))!)).toBeGreaterThan(
      srcs.indexOf(srcs.find((s) => s.includes('/legs/'))!),
    ) // boots por cima da calça
    expect(srcs.at(-1)).toContain('/hair/') // sem chapéu: cabelo é a última camada
  })

  it('cacheia por assinatura das options', async () => {
    __clearCharacterCaches()
    const { deps } = fakeDeps()
    const loadSpy = vi.spyOn(deps, 'loadImage')
    const options = defaultCharacterFromSeed('ana')
    const first = await composeCharacterSheet(options, deps)
    const second = await composeCharacterSheet({ ...options }, deps)
    expect(second).toBe(first)
    expect(loadSpy).toHaveBeenCalledTimes(6) // body, legs, feet, torso, head, hair — default sempre tem hair
  })
})

describe('characterPortraitDataUri', () => {
  it('recorta a cabeça do frame frontal parado', async () => {
    __clearCharacterCaches()
    const { drawn, deps } = fakeDeps()
    await characterPortraitDataUri(defaultCharacterFromSeed('ana'), deps)
    const portraitDraw = drawn.at(-1)!
    // sy dentro da linha "down" (y 128..191) do sheet composto
    expect(portraitDraw.args[1]).toBeGreaterThanOrEqual(128)
    expect(portraitDraw.args[1]).toBeLessThan(192)
  })
})

describe('composeCharacterSheet — camadas extras (marcador de paintball)', () => {
  it('desenha as camadas extras por cima do guarda-roupa', async () => {
    __clearCharacterCaches()
    const { drawn, deps } = fakeDeps()

    await composeCharacterSheet(defaultCharacterFromSeed('ana'), deps, PAINTBALL_MARKER_LAYERS)

    // Os dois zPos do marcador são bem distantes: o fundo (9) entra ANTES do
    // corpo (10), porque nas poses de lado, de costas e para cima o estilingue
    // fica atrás do tronco; só a da frente usa a camada de 140. Inverter põe a
    // forquilha por cima das costas.
    const srcs = drawn.map((entry) => entry.src)
    // O corpo da seed varia (tipo e tom): acha pelo prefixo, não pelo arquivo.
    const corpo = srcs.findIndex((src) => src.startsWith('/lpc/body/bodies/'))
    expect(corpo).toBeGreaterThanOrEqual(0)
    expect(srcs.indexOf('/lpc/weapon/ranged/slingshot/background/slingshot.png')).toBeLessThan(corpo)
    expect(srcs.at(-1)).toBe('/lpc/weapon/ranged/slingshot/foreground/slingshot.png')
  })

  /**
   * As camadas do marcador entram por CAMINHO, e não por item do catálogo:
   * pelo catálogo o estilingue não serve `teen` nem `child`, e criança desarmada
   * no meio de uma partida seria um bug, não uma regra. O sheet é universal.
   */
  it('vale para todo tipo de corpo, inclusive os que o catálogo do estilingue não lista', async () => {
    for (const bodyType of ['child', 'teen'] as const) {
      __clearCharacterCaches()
      const { drawn, deps } = fakeDeps()
      const base = defaultCharacterFromSeed('ana')

      await composeCharacterSheet({ ...base, bodyType, items: { body: base.items.body } }, deps, PAINTBALL_MARKER_LAYERS)

      expect(drawn.map((entry) => entry.src)).toContain(
        '/lpc/weapon/ranged/slingshot/foreground/slingshot.png',
      )
    }
  })

  it('o cache não confunde armado com desarmado', async () => {
    __clearCharacterCaches()
    const options = defaultCharacterFromSeed('ana')
    const desarmado = fakeDeps()
    const armado = fakeDeps()

    await composeCharacterSheet(options, desarmado.deps)
    await composeCharacterSheet(options, armado.deps, PAINTBALL_MARKER_LAYERS)

    expect(armado.drawn.length).toBe(desarmado.drawn.length + PAINTBALL_MARKER_LAYERS.length)
    expect(characterSheetKey(options, PAINTBALL_MARKER_LAYERS)).not.toBe(characterSheetKey(options))
  })
})

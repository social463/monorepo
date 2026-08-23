import { describe, expect, it, vi } from 'vitest'
import { defaultCharacterFromSeed } from '@legends/shared'
import {
  characterAssetUrl,
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

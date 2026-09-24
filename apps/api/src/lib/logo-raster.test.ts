import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearLogoRasterCache, isRasterizableSvgLogo, rasterizeSvgLogo } from './logo-raster'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="137" height="133"><rect width="137" height="133" fill="#264641"/></svg>'

function respostaSvg(body = SVG) {
  return new Response(body, { status: 200, headers: { 'content-type': 'image/svg+xml' } })
}

beforeEach(() => {
  clearLogoRasterCache()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isRasterizableSvgLogo', () => {
  it('aceita SVG remoto — é o que a empresa cadastra e o Teams não desenha', () => {
    expect(isRasterizableSvgLogo('https://cdn.test/marca.svg')).toBe(true)
    expect(isRasterizableSvgLogo('https://cdn.test/marca.SVG?v=2')).toBe(true)
  })

  it('recusa o que não é SVG remoto', () => {
    // PNG o Teams já busca sozinho; converter seria um round-trip à toa.
    expect(isRasterizableSvgLogo('https://cdn.test/marca.png')).toBe(false)
    // Caminho relativo não resolve fora do navegador, e data URI não tem o que baixar.
    expect(isRasterizableSvgLogo('/illustration/logo-mark.svg')).toBe(false)
    expect(isRasterizableSvgLogo('data:image/svg+xml;base64,AAAA')).toBe(false)
    expect(isRasterizableSvgLogo(null)).toBe(false)
    expect(isRasterizableSvgLogo(undefined)).toBe(false)
  })
})

describe('rasterizeSvgLogo', () => {
  it('converte o SVG cadastrado em PNG', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respostaSvg()))

    const png = await rasterizeSvgLogo('https://cdn.test/marca.svg')
    expect(png).toBeInstanceOf(Buffer)
    // Assinatura do formato PNG: é ela que o Teams precisa ver, não o SVG.
    expect(png!.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  })

  it('guarda o resultado por URL — o card sai a cada notificação, e rasterizar toda vez seria absurdo', async () => {
    const spy = vi.fn(async () => respostaSvg())
    vi.stubGlobal('fetch', spy)

    await rasterizeSvgLogo('https://cdn.test/marca.svg')
    await rasterizeSvgLogo('https://cdn.test/marca.svg')
    expect(spy).toHaveBeenCalledTimes(1)

    // Logo nova é URL nova: nunca reaproveita a entrada da anterior.
    await rasterizeSvgLogo('https://cdn.test/outra.svg')
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('S3 fora do ar vira null, não exceção — a logo é enfeite e não pode derrubar a notificação', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    await expect(rasterizeSvgLogo('https://cdn.test/marca.svg')).resolves.toBeNull()
  })

  it('SVG corrompido vira null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respostaSvg('<svg isto não é svg')))
    await expect(rasterizeSvgLogo('https://cdn.test/marca.svg')).resolves.toBeNull()
  })

  it('não sai buscando o que não é SVG', async () => {
    const spy = vi.fn(async () => respostaSvg())
    vi.stubGlobal('fetch', spy)
    await expect(rasterizeSvgLogo('https://cdn.test/marca.png')).resolves.toBeNull()
    expect(spy).not.toHaveBeenCalled()
  })
})

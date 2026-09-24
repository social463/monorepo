import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * O suporte a WebP é memoizado no módulo, então cada teste importa uma cópia
 * limpa — senão o primeiro caso decidiria pelos demais.
 */
async function loadOptimizer() {
  vi.resetModules()
  return (await import('./image-optimizer')).optimizeImageForUpload
}

interface StubOptions {
  bitmap?: { width: number; height: number }
  /** Bytes devolvidos por cada `toBlob`. */
  blobBytes?: number
  webp?: boolean
  semCreateImageBitmap?: boolean
}

/** Larguras de canvas usadas em cada codificação, na ordem em que aconteceram. */
const larguras: number[] = []

function stubBrowser(options: StubOptions = {}) {
  const { bitmap = { width: 4000, height: 3000 }, blobBytes = 5_000, webp = true } = options
  larguras.length = 0

  if (options.semCreateImageBitmap) {
    vi.stubGlobal('createImageBitmap', undefined)
  } else {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ ...bitmap, close: vi.fn() })),
    )
  }

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() =>
    webp ? 'data:image/webp;base64,AA' : 'data:image/png;base64,AA',
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    callback: BlobCallback,
    type?: string,
  ) {
    larguras.push(this.width)
    callback(new Blob([new Uint8Array(blobBytes)], { type: type ?? 'image/webp' }))
  } as HTMLCanvasElement['toBlob'])
}

function arquivo(name: string, type: string, bytes: number): File {
  return new File([new Uint8Array(bytes)], name, { type })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('optimizeImageForUpload', () => {
  it('devolve o original quando o navegador não decodifica imagem', async () => {
    stubBrowser({ semCreateImageBitmap: true })
    const optimize = await loadOptimizer()
    const file = arquivo('foto.jpg', 'image/jpeg', 20_000)

    expect(await optimize(file)).toBe(file)
  })

  it('não toca em GIF, para não achatar a animação', async () => {
    stubBrowser()
    const optimize = await loadOptimizer()
    const file = arquivo('meme.gif', 'image/gif', 3_000_000)

    expect(await optimize(file)).toBe(file)
  })

  it('reduz a foto ao maior lado permitido e re-encoda em WebP', async () => {
    stubBrowser({ bitmap: { width: 4000, height: 3000 }, blobBytes: 5_000 })
    const optimize = await loadOptimizer()
    const file = arquivo('IMG_0001.JPG', 'image/jpeg', 20_000)

    const out = await optimize(file)

    expect(out).not.toBe(file)
    expect(out.type).toBe('image/webp')
    expect(out.name).toBe('IMG_0001.webp')
    expect(out.size).toBe(5_000)
    // 4000 × (2560/4000) = 2560 no maior lado.
    expect(larguras[0]).toBe(2560)
  })

  it('devolve o original quando o resultado ficaria maior', async () => {
    stubBrowser({ blobBytes: 50_000 })
    const optimize = await loadOptimizer()
    const file = arquivo('foto.jpg', 'image/jpeg', 20_000)

    expect(await optimize(file)).toBe(file)
  })

  it('não converte PNG para JPEG quando o navegador não escreve WebP', async () => {
    stubBrowser({ bitmap: { width: 800, height: 600 }, webp: false })
    const optimize = await loadOptimizer()
    const file = arquivo('arte.png', 'image/png', 3_000_000)

    expect(await optimize(file)).toBe(file)
  })

  it('reduz a resolução quando apertar a qualidade não basta', async () => {
    stubBrowser({ bitmap: { width: 4000, height: 3000 }, blobBytes: 1_000 })
    const optimize = await loadOptimizer()
    const file = arquivo('foto.jpg', 'image/jpeg', 20_000)

    // Alvo e teto minúsculos: é o que força os dois laços com blobs de teste.
    const out = await optimize(file, { targetBytes: 100, hardMaxBytes: 200 })

    // 3 passos de qualidade + 4 reduções de resolução.
    expect(larguras).toHaveLength(7)
    expect(larguras[larguras.length - 1]).toBeLessThan(larguras[0])
    expect(out.size).toBe(1_000)
  }, 10_000)
})

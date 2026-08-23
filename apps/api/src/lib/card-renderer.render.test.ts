import { describe, it, expect } from 'vitest'
import { renderCard } from './card-renderer'
import { PNG } from 'pngjs'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]) // \x89PNG

describe('renderCard', () => {
  it('produces a non-empty PNG (with initials fallback)', async () => {
    const png = await renderCard({
      name: 'Ana Souza', monthName: 'Junho', position: 'Desen. Produtos',
      text: 'Parabéns pelo destaque do mês!', photoDataUri: null, initials: 'AS',
    })
    expect(png.length).toBeGreaterThan(1000)
    expect(png.subarray(0, 4)).toEqual(PNG_SIGNATURE)
  })

  it('renders visible text using bundled fonts', async () => {
    const png = await renderCard({
      name: 'Ana Souza', monthName: 'Junho', position: 'Desen. Produtos',
      text: 'Parabéns pelo destaque do mês!', photoDataUri: null, initials: 'AS',
    })
    const image = PNG.sync.read(png)
    let brightPixels = 0
    for (let y = 110; y < 230; y++) {
      for (let x = 170; x < 910; x++) {
        const offset = (image.width * y + x) * 4
        const r = image.data[offset] ?? 0
        const g = image.data[offset + 1] ?? 0
        const b = image.data[offset + 2] ?? 0
        const a = image.data[offset + 3] ?? 0
        if (a > 200 && r > 220 && g > 220 && b > 220) brightPixels++
      }
    }
    expect(brightPixels).toBeGreaterThan(1000)
  })
})

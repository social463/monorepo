import { describe, expect, it } from 'vitest'
import { BRAND_PRESETS, brandingFromPreset, contrastRatio, hexToOklch } from '@legends/shared'
import { buildCardSvg, cardBrandFrom, DEFAULT_CARD_BRAND, titleFontSize, type CardData } from './card-renderer'

const dados: CardData = {
  name: 'Ana Souza',
  monthName: 'Julho',
  position: 'Desen. Produtos',
  text: 'Resolveu o incidente de sexta sem deixar ninguém na mão.',
  photoDataUri: null,
  initials: 'AS',
}

describe('cardBrandFrom', () => {
  const emr = cardBrandFrom(brandingFromPreset(BRAND_PRESETS.emr))

  it('mantém o matiz da marca no fundo e nos textos', () => {
    const marca = hexToOklch('#35bd78')
    for (const cor of [emr.bgCenter, emr.bgEdge, emr.pillText, emr.avatarBg]) {
      expect(Math.abs(hexToOklch(cor).h - marca.h)).toBeLessThan(8)
    }
  })

  it('sai perto da arte histórica quando a marca é da mesma família de verde', () => {
    // O card de hoje é #3aa45a / #0f5a2c; a marca da EMR é #35bd78. Se a
    // derivação jogasse o card para outro tom, o material de divulgação da
    // empresa mudaria de cara sem ninguém ter pedido.
    expect(hexToOklch(emr.bgCenter).l).toBeCloseTo(hexToOklch(DEFAULT_CARD_BRAND.bgCenter).l, 1)
    expect(hexToOklch(emr.bgEdge).l).toBeCloseTo(hexToOklch(DEFAULT_CARD_BRAND.bgEdge).l, 1)
  })

  it('o aro se destaca do fundo tanto quanto na arte histórica', () => {
    // O aro é decoração sobre um fundo da mesma família: 1.84:1 no card de
    // hoje. O alvo é reproduzir essa relação, não superá-la — subir o contraste
    // aqui mudaria a arte, que é justamente o que não se quer.
    const historico = contrastRatio(DEFAULT_CARD_BRAND.accent, DEFAULT_CARD_BRAND.bgCenter)
    expect(contrastRatio(emr.accent, emr.bgCenter)).toBeCloseTo(historico, 0)
    // Contra a borda escura do gradiente, aí sim a separação é forte.
    expect(contrastRatio(emr.accent, emr.bgEdge)).toBeGreaterThan(4)
    expect(hexToOklch(emr.accent).l).toBeGreaterThan(hexToOklch(emr.bgCenter).l)
  })

  it('funciona com marca de qualquer matiz, não só verde', () => {
    for (const cor of ['#7c3aed', '#ff0000', '#0a66c2', '#111111']) {
      const brand = cardBrandFrom(brandingFromPreset({ ...BRAND_PRESETS.emr, brandColor: cor }))
      // Fundo escuro, aro claro: a relação que faz a arte funcionar sobrevive.
      expect(hexToOklch(brand.accent).l, cor).toBeGreaterThan(hexToOklch(brand.bgEdge).l)
      expect(contrastRatio('#ffffff', brand.bgCenter), cor).toBeGreaterThan(1.8)
    }
  })

  /**
   * O título é "DESTAQUES <EMPRESA>". Vinha de `appName` e saía errado: o app da
   * EMR chama-se "Portal EMR", então o card dizia "DESTAQUES PORTAL EMR". São
   * dois nomes distintos — um é como o produto se apresenta por dentro, o outro
   * é quem está destacando alguém.
   */
  it('usa o nome da EMPRESA como wordmark, não o do app', () => {
    const branding = brandingFromPreset({ ...BRAND_PRESETS.emr, appName: 'Portal EMR' })
    expect(cardBrandFrom(branding, { companyName: 'EMR' }).wordmark).toBe('EMR')
  })

  it('sem o nome da empresa, cai no do app — o título nunca sai vazio', () => {
    expect(cardBrandFrom(brandingFromPreset(BRAND_PRESETS.emr)).wordmark).toBe('EMR LEGENDS')
    expect(cardBrandFrom(brandingFromPreset(BRAND_PRESETS.emr), { companyName: '  ' }).wordmark).toBe('EMR LEGENDS')
  })
})

describe('titleFontSize', () => {
  it('mantém o corpo original para wordmark curto', () => {
    expect(titleFontSize('EMR')).toBe(92)
  })

  it('encolhe conforme o nome cresce, para o título não sair do card', () => {
    expect(titleFontSize('EMR LEGENDS')).toBeLessThan(92)
    expect(titleFontSize('UMA EMPRESA DE NOME MUITO COMPRIDO')).toBeLessThan(titleFontSize('EMR LEGENDS'))
    expect(titleFontSize('UMA EMPRESA DE NOME ABSURDAMENTE COMPRIDO MESMO')).toBeGreaterThanOrEqual(46)
  })
})

describe('buildCardSvg com marca', () => {
  it('sem marca, sai idêntico ao card histórico', () => {
    const svg = buildCardSvg(dados)
    expect(svg).toContain('#3aa45a')
    expect(svg).toContain('DESTAQUES ')
    expect(svg).toContain('>EMR<')
  })

  it('com marca, pinta o card nas cores da empresa', () => {
    const brand = cardBrandFrom(brandingFromPreset(BRAND_PRESETS.emr), { companyName: 'EMR Legends' })
    const svg = buildCardSvg({ ...dados, brand })
    expect(svg).toContain(brand.bgCenter)
    expect(svg).toContain(brand.accent)
    expect(svg).toContain('EMR LEGENDS')
    expect(svg).not.toContain('#3aa45a')
  })

  it('escapa o wordmark — nome de empresa é texto do cliente dentro de XML', () => {
    const brand = { ...DEFAULT_CARD_BRAND, wordmark: 'A & B <script>' }
    const svg = buildCardSvg({ ...dados, brand })
    expect(svg).toContain('&amp;')
    expect(svg).not.toContain('<script>')
  })

  it('embute a logo da empresa quando há uma', () => {
    const brand = { ...DEFAULT_CARD_BRAND, logoDataUri: 'data:image/png;base64,AAAA' }
    const svg = buildCardSvg({ ...dados, brand })
    expect(svg).toContain('<image href="data:image/png;base64,AAAA"')
  })

  it('sem logo da empresa, assina com o logotipo do produto', () => {
    const svg = buildCardSvg({ ...dados, brand: DEFAULT_CARD_BRAND })
    expect(svg).not.toContain('data:image/png;base64,AAAA')
    // O logotipo vetorial entra como grupo transformado, não como <image>.
    expect(svg).toMatch(/<g transform="translate\([\d.]+ [\d.]+\) scale\(/)
  })
})

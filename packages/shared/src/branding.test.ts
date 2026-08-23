import { describe, expect, it } from 'vitest'
import { contrastRatio, hexToOklch, isValidHex, oklchToHex, parseHex, toRgbChannels } from './color'
import {
  BRAND_COLOR_TOKENS,
  BRAND_PRESETS,
  brandingFromPreset,
  checkBrandContrast,
  deriveBrandPalette,
  LEGENDS_PALETTE,
  parseBrandOverrides,
  resolveBrandPalette,
} from './branding'

describe('conversão de cor', () => {
  it('ida e volta hex → OKLCH → hex preserva a cor', () => {
    for (const hex of ['#52fba2', '#35bd78', '#0c141b', '#ffffff', '#000000', '#f2fcff', '#93000a']) {
      expect(oklchToHex(hexToOklch(hex))).toBe(hex)
    }
  })

  it('aceita hex de 3 dígitos e normaliza', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255])
    expect(parseHex('0c141b')).toEqual([12, 20, 27])
  })

  it('recusa cor inválida', () => {
    expect(() => parseHex('#xyzxyz')).toThrow(/Cor inválida/)
    expect(isValidHex('#35bd78')).toBe(true)
    expect(isValidHex('verde')).toBe(false)
  })

  it('reduz o croma em vez de cortar canal quando a cor não cabe em sRGB', () => {
    // Verde impossível: L alto com croma muito acima do gamut.
    const clamped = hexToOklch(oklchToHex({ l: 0.9, c: 0.4, h: 152 }))
    expect(clamped.c).toBeLessThan(0.4)
    // O matiz sobrevive — é isso que cortar canal destruiria.
    expect(Math.abs(clamped.h - 152)).toBeLessThan(6)
  })

  it('serializa em canais RGB, que é o formato que o Tailwind exige para opacidade', () => {
    expect(toRgbChannels('#52fba2')).toBe('82 251 162')
  })

  it('calcula contraste WCAG nos extremos conhecidos', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1)
    expect(contrastRatio('#52fba2', '#52fba2')).toBeCloseTo(1, 5)
  })
})

describe('derivação da paleta', () => {
  it('gera os 35 tokens, todos em hex válido', () => {
    const palette = deriveBrandPalette({ brandColor: '#35bd78', neutralColor: '#f2fcff', scheme: 'light' })
    expect(Object.keys(palette).sort()).toEqual([...BRAND_COLOR_TOKENS].sort())
    for (const token of BRAND_COLOR_TOKENS) {
      expect(palette[token], token).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('tema claro tem fundo claro e texto escuro; escuro é o inverso', () => {
    const light = deriveBrandPalette({ brandColor: '#35bd78', neutralColor: '#f2fcff', scheme: 'light' })
    const dark = deriveBrandPalette({ brandColor: '#35bd78', neutralColor: '#f2fcff', scheme: 'dark' })
    expect(hexToOklch(light.surface).l).toBeGreaterThan(hexToOklch(light['on-surface']).l)
    expect(hexToOklch(dark.surface).l).toBeLessThan(hexToOklch(dark['on-surface']).l)
  })

  it('o tom neutro tinge as superfícies sem virar cor', () => {
    const azul = deriveBrandPalette({ brandColor: '#35bd78', neutralColor: '#f2fcff', scheme: 'light' })
    const semNeutro = deriveBrandPalette({ brandColor: '#35bd78', scheme: 'light' })
    // Com neutro azul, a superfície puxa para o matiz do azul, não do verde.
    expect(Math.abs(hexToOklch(azul.surface).h - hexToOklch('#f2fcff').h)).toBeLessThan(10)
    // Sem neutro, é a própria marca que tinge.
    expect(Math.abs(hexToOklch(semNeutro.surface).h - hexToOklch('#35bd78').h)).toBeLessThan(10)
    // Nos dois casos o croma é baixo: superfície é quase cinza.
    expect(hexToOklch(azul.surface).c).toBeLessThan(0.04)
  })

  it('erro é vermelho mesmo com marca verde — convenção não segue a marca', () => {
    const palette = deriveBrandPalette({ brandColor: '#35bd78', scheme: 'light' })
    const hue = hexToOklch(palette.error).h
    expect(hue < 60 || hue > 330).toBe(true)
  })

  it('é determinística', () => {
    const input = { brandColor: '#7c3aed', neutralColor: '#f5f5f7', scheme: 'light' } as const
    expect(deriveBrandPalette(input)).toEqual(deriveBrandPalette(input))
  })

  it('overrides vencem a derivação; hex inválido é ignorado', () => {
    const palette = resolveBrandPalette({
      brandColor: '#35bd78',
      neutralColor: '#f2fcff',
      scheme: 'light',
      overrides: { 'surface-tint': '#35bd78', primary: 'não é cor' },
    })
    expect(palette['surface-tint']).toBe('#35bd78')
    expect(palette.primary).toMatch(/^#[0-9a-f]{6}$/)
    expect(palette.primary).not.toBe('não é cor')
  })
})

describe('contraste', () => {
  it('a paleta do produto passa em todos os pares críticos', () => {
    expect(checkBrandContrast(LEGENDS_PALETTE)).toEqual([])
  })

  it.each(Object.keys(BRAND_PRESETS) as Array<keyof typeof BRAND_PRESETS>)(
    'o preset "%s" passa em todos os pares críticos',
    (key) => {
      expect(checkBrandContrast(brandingFromPreset(BRAND_PRESETS[key]).colors)).toEqual([])
    },
  )

  it.each([
    ['#35bd78', 'verde EMR'],
    ['#7c3aed', 'roxo'],
    ['#ff0000', 'vermelho puro'],
    ['#ffe600', 'amarelo — o caso difícil, quase sem contraste no claro'],
    ['#000000', 'preto'],
    ['#ffffff', 'branco'],
  ])('a rampa conserta a cor de marca %s (%s) nos dois esquemas', (brandColor) => {
    for (const scheme of ['light', 'dark'] as const) {
      const palette = deriveBrandPalette({ brandColor, scheme })
      expect(checkBrandContrast(palette), `${brandColor} / ${scheme}`).toEqual([])
    }
  })

  it('acusa o par reprovado quando a cor crua é usada como texto', () => {
    // O caso que motivou a rampa: verde institucional da EMR sobre o fundo dela.
    const quebrada = { ...LEGENDS_PALETTE, primary: '#35bd78', surface: '#f2fcff' }
    const issues = checkBrandContrast(quebrada)
    const primaryIssue = issues.find((i) => i.foreground === 'primary' && i.background === 'surface')
    expect(primaryIssue).toBeDefined()
    expect(primaryIssue!.ratio).toBeLessThan(2.5)
  })
})

describe('preset da EMR', () => {
  const emr = brandingFromPreset(BRAND_PRESETS.emr)

  it('entrega as duas paletas e oferece a troca ao usuário', () => {
    expect(emr.defaultScheme).toBe('light')
    expect(emr.allowUserScheme).toBe(true)
    expect(Object.keys(emr.schemes).sort()).toEqual(['dark', 'light'])
    // `colors` é atalho para a paleta do esquema padrão.
    expect(emr.colors).toEqual(emr.schemes.light)
  })

  it('os dois esquemas passam em contraste', () => {
    expect(checkBrandContrast(emr.schemes.light)).toEqual([])
    expect(checkBrandContrast(emr.schemes.dark)).toEqual([])
  })

  it('claro tem fundo branco; escuro ancora no Neutral/800 do DS', () => {
    expect(emr.schemes.light.surface).toBe('#ffffff')
    expect(emr.schemes.dark.surface).toBe('#1d2224')
  })

  it('a escada escura sobe de forma monotônica, do fundo ao card mais elevado', () => {
    const passos = [
      'surface-container-lowest',
      'surface',
      'surface-container-low',
      'surface-container',
      'surface-container-high',
      'surface-container-highest',
    ] as const
    const claridades = passos.map((p) => hexToOklch(emr.schemes.dark[p]).l)
    // Card só "existe" se for mais claro que o que está embaixo. Ancorar no
    // Neutral/700 quebrava isso: a sidebar ficava mais escura que a página.
    for (let i = 1; i < claridades.length; i += 1) {
      expect(claridades[i], passos[i]).toBeGreaterThan(claridades[i - 1])
    }
    // Amplitude parecida com a do produto, que é o que dá o ar de elevação sutil.
    expect(claridades.at(-1)! - claridades[0]).toBeLessThan(0.3)
  })

  it('o texto secundário continua legível no degrau mais claro da escada', () => {
    expect(
      contrastRatio(emr.schemes.dark['on-surface-variant'], emr.schemes.dark['surface-container-highest']),
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('a borda passa no mínimo de 3:1 sobre a superfície escura', () => {
    expect(contrastRatio(emr.schemes.dark.outline, emr.schemes.dark.surface)).toBeGreaterThanOrEqual(3)
  })

  it('preserva o verde institucional (Brand/400) em surface-tint nos dois modos', () => {
    expect(emr.schemes.light['surface-tint']).toBe('#35bd78')
    expect(emr.schemes.dark['surface-tint']).toBe('#35bd78')
  })

  it('afasta-se do DS onde ele reprova em AA, e só aí', () => {
    // O DS manda #35bd78 no botão principal e no link: 2.41:1 sobre o branco
    // que ele mesmo define. `primary` usa o degrau seguinte.
    expect(contrastRatio('#35bd78', '#ffffff')).toBeLessThan(3)
    expect(emr.schemes.light.primary).toBe('#007344')
    expect(contrastRatio(emr.schemes.light.primary, emr.schemes.light.surface)).toBeGreaterThanOrEqual(4.5)
    // Mesma história no vermelho de status: #e64444 dá 3.98:1.
    expect(contrastRatio('#e64444', '#ffffff')).toBeLessThan(4.5)
    expect(emr.schemes.light.error).toBe('#b23535')
  })

  it('no escuro sobe para Brand/300, porque o 400 fica na linha do mínimo', () => {
    expect(contrastRatio('#35bd78', '#363e46')).toBeLessThan(4.6)
    expect(emr.schemes.dark.primary).toBe('#25de88')
    expect(contrastRatio(emr.schemes.dark.primary, emr.schemes.dark.surface)).toBeGreaterThan(6)
  })

  it('usa Neutral/500 em outline — o 400 reprova até como borda', () => {
    expect(emr.schemes.light.outline).toBe('#606a71')
    expect(contrastRatio('#9ba5ab', '#ffffff')).toBeLessThan(3)
    expect(contrastRatio(emr.schemes.light.outline, emr.schemes.light.surface)).toBeGreaterThanOrEqual(3)
  })

  it('aproveita as outras duas famílias do DS em secondary e tertiary', () => {
    expect(emr.schemes.light.secondary).toBe('#087d75') // teal
    expect(emr.schemes.light.tertiary).toBe('#23509b') // azul
  })
})

describe('preset do produto', () => {
  const legends = brandingFromPreset(BRAND_PRESETS.legends)

  it('é escuro e não oferece troca — o claro nunca foi desenhado', () => {
    expect(legends.defaultScheme).toBe('dark')
    expect(legends.allowUserScheme).toBe(false)
  })

  it('mantém a paleta histórica byte a byte', () => {
    expect(legends.colors).toEqual(LEGENDS_PALETTE)
  })
})

describe('parseBrandOverrides', () => {
  const valido = JSON.stringify({
    light: { primary: '#007344', surface: '#FFF' },
    dark: { primary: '#25de88' },
  })

  it('lê os dois esquemas e normaliza o hex', () => {
    const r = parseBrandOverrides(valido)
    expect(r.overrides.light).toEqual({ primary: '#007344', surface: '#ffffff' })
    expect(r.overrides.dark).toEqual({ primary: '#25de88' })
    expect(r.applied).toEqual({ light: 2, dark: 1 })
  })

  it('aceita um payload de marca inteiro, aproveitando só os overrides', () => {
    const payload = JSON.stringify({ appName: 'X', brandColor: '#35bd78', overrides: JSON.parse(valido) })
    expect(parseBrandOverrides(payload).applied).toEqual({ light: 2, dark: 1 })
  })

  it('relata token desconhecido em vez de engolir', () => {
    // Sem isto, quem colou descobre que faltou um token três telas depois.
    const r = parseBrandOverrides(JSON.stringify({ light: { primary: '#007344', naoExiste: '#fff' } }))
    expect(r.unknownTokens).toEqual(['light.naoExiste'])
    expect(r.applied.light).toBe(1)
  })

  it('relata cor inválida em vez de engolir', () => {
    const r = parseBrandOverrides(JSON.stringify({ light: { primary: 'verde', surface: '#ffffff' } }))
    expect(r.invalidColors).toEqual(['light.primary'])
    expect(r.overrides.light).toEqual({ surface: '#ffffff' })
  })

  it('recusa JSON quebrado, não-objeto e esquema que não é objeto', () => {
    expect(() => parseBrandOverrides('{')).toThrow(/não é um JSON válido/)
    expect(() => parseBrandOverrides('[1,2]')).toThrow(/precisa ser um objeto/)
    expect(() => parseBrandOverrides('"texto"')).toThrow(/precisa ser um objeto/)
    expect(() => parseBrandOverrides(JSON.stringify({ light: 'nao' }))).toThrow(/precisa ser um objeto de tokens/)
  })

  it('recusa JSON sem token reconhecido nenhum', () => {
    expect(() => parseBrandOverrides(JSON.stringify({ cores: { verde: '#0f0' } }))).toThrow(
      /Nenhum token reconhecido/,
    )
  })

  it('o payload do preset da EMR passa inteiro', () => {
    const r = parseBrandOverrides(JSON.stringify(BRAND_PRESETS.emr.overrides))
    expect(r.applied).toEqual({ light: 35, dark: 35 })
    expect(r.unknownTokens).toEqual([])
    expect(r.invalidColors).toEqual([])
  })
})

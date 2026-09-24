import { describe, expect, it } from 'vitest'
import { contrastRatio, hexToOklch, isValidHex, oklchToHex, parseHex, toRgbChannels } from './color'
import {
  BRAND_COLOR_TOKENS,
  BRAND_PRESETS,
  brandFontHref,
  brandFontStack,
  brandingFromPreset,
  checkBrandContrast,
  isValidBrandFontFamily,
  PRODUCT_FONTS,
  resolveBrandFonts,
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

  it('claro tem fundo branco; escuro ancora no ink-2 do brandbook', () => {
    expect(emr.schemes.light.surface).toBe('#ffffff')
    // `ink-2`: "superfície escura mais profunda que o Green", no brandbook 2026.
    expect(emr.schemes.dark.surface).toBe('#1b322e')
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
    // Card só "existe" se for mais claro que o que está embaixo. Ancorar num
    // degrau intermediário quebrava isso: a sidebar ficava mais escura que a
    // página.
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

  it('preserva o Residente Approved cru em surface-tint nos dois modos', () => {
    // A cor de marca exata vive aqui, para preenchimento e decoração — nunca em
    // `primary`, que precisa ser legível como texto.
    expect(emr.schemes.light['surface-tint']).toBe('#6ce190')
    expect(emr.schemes.dark['surface-tint']).toBe('#6ce190')
  })

  it('primary é o green-deep, porque o Approved cru reprova como texto', () => {
    // O Approved rende 1.6:1 sobre branco — invisível como texto e como link.
    expect(contrastRatio('#6ce190', '#ffffff')).toBeLessThan(2)
    // `green-deep`, o derivado que o próprio brandbook criou para "texto/ícone
    // verde com contraste AA sobre claro".
    expect(emr.schemes.light.primary).toBe('#16603c')
    expect(contrastRatio(emr.schemes.light.primary, emr.schemes.light.surface)).toBeGreaterThanOrEqual(4.5)
  })

  it('no escuro o Approved já é o tom legível, sem precisar do green-deep', () => {
    expect(emr.schemes.dark.primary).toBe('#6ce190')
    expect(contrastRatio(emr.schemes.dark.primary, emr.schemes.dark.surface)).toBeGreaterThan(6)
    // O green-deep, aqui, seria escuro demais: ele vira o inverso.
    expect(emr.schemes.dark['inverse-primary']).toBe('#16603c')
  })

  it('o Lime é acento, não primary: como texto sobre claro ele não existe', () => {
    // O brandbook o declara acento e avisa que usá-lo como fundo de seção
    // grande contraria a hierarquia. Como `primary` é texto E botão, ele
    // falharia no primeiro papel.
    expect(contrastRatio('#b4f900', '#ffffff')).toBeLessThan(2)
    expect(emr.schemes.light.primary).not.toBe('#b4f900')
    // Onde ele entra: grifo e chip, com a tinta `lime-t` por trás.
    expect(emr.schemes.light['secondary-container']).toBe('#f0fdcc')
    // No escuro ele pode ser usado puro — é onde brilha.
    expect(emr.schemes.dark.secondary).toBe('#b4f900')
  })

  it('o Orange chega pelo warn, que é a derivação AA do próprio brandbook', () => {
    // Branco sobre o Orange cru dá 3.1:1 — o brandbook diz que só passa em
    // texto grande. `warn` é o Orange escurecido, e é por ele que a cor entra.
    expect(contrastRatio('#ffffff', '#ff7013')).toBeLessThan(4.5)
    expect(emr.schemes.light.error).toBe('#c4381b')
    expect(contrastRatio(emr.schemes.light['on-error'], emr.schemes.light.error)).toBeGreaterThanOrEqual(4.5)
  })

  it('o texto secundário é um fio mais escuro que o ink-soft, por causa da escada', () => {
    // `ink-soft` (#5a736b) é AA sobre o Off White, como o brandbook afirma —
    // mas cai para 4.03:1 no degrau mais claro da escada, que é do produto e o
    // brandbook não trata.
    expect(contrastRatio('#5a736b', emr.schemes.light['surface-container-highest'])).toBeLessThan(4.5)
    expect(
      contrastRatio(emr.schemes.light['on-surface-variant'], emr.schemes.light['surface-container-highest']),
    ).toBeGreaterThanOrEqual(4.5)
  })

  it('secondary e tertiary vêm do Lime e da complementar azul', () => {
    expect(emr.schemes.light.secondary).toBe('#4a6b00') // família do Lime
    expect(emr.schemes.light.tertiary).toBe('#14618c') // complementar azul
  })

  it('a tipografia da EMR é Outfit nos dois papéis', () => {
    expect(emr.fonts).toEqual({ headline: 'Outfit', body: 'Outfit' })
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

describe('tipografia como token de marca', () => {
  it('empresa sem fonte cadastrada herda a do produto', () => {
    expect(resolveBrandFonts(undefined)).toEqual(PRODUCT_FONTS)
    expect(resolveBrandFonts(null)).toEqual(PRODUCT_FONTS)
    // Registro gravado antes desta versão não tem o campo — e a ausência dele
    // significa "a fonte do produto", não erro.
    expect(brandingFromPreset(BRAND_PRESETS.legends).fonts).toEqual(PRODUCT_FONTS)
  })

  it('recusa nome que sairia do lado de dentro da folha de estilo', () => {
    // O nome entra numa URL do Google Fonts E numa declaração `font-family`:
    // aspas, ponto e vírgula ou parêntese deixariam o cadastro escrever CSS.
    for (const veneno of ['Outfit"; background: url(x)', "Outfit'", 'Outfit;', 'Outfit)', '']) {
      expect(isValidBrandFontFamily(veneno), veneno).toBe(false)
    }
    expect(isValidBrandFontFamily('Outfit')).toBe(true)
    expect(isValidBrandFontFamily('Noto Sans')).toBe(true)
  })

  it('família inválida cai no produto em vez de quebrar a tela', () => {
    expect(resolveBrandFonts({ headline: 'Outfit";}', body: 'Outfit' })).toEqual({
      headline: PRODUCT_FONTS.headline,
      body: 'Outfit',
    })
  })

  it('a pilha CSS leva o fallback do produto atrás do nome da marca', () => {
    expect(brandFontStack('Outfit', 'headline')).toBe("'Outfit', system-ui, sans-serif")
    expect(brandFontStack('nome; inválido', 'body')).toBe("'Inter', system-ui, sans-serif")
  })

  it('só carrega arquivo quem tem fonte própria, e uma vez por família', () => {
    // Quem usa a do produto não baixa nada a mais: ela já vem no index.html.
    expect(brandFontHref(PRODUCT_FONTS)).toBeNull()
    const href = brandFontHref({ headline: 'Outfit', body: 'Outfit' })!
    // Mesma família nos dois papéis = uma `family=` só, não duas.
    expect(href.match(/family=/g)).toHaveLength(1)
    expect(href).toContain('family=Outfit')
    expect(brandFontHref({ headline: 'Outfit', body: 'Noto Sans' })!.match(/family=/g)).toHaveLength(2)
  })
})

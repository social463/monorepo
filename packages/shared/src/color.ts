/**
 * Conversão de cor e contraste — usado para derivar a paleta de cada empresa
 * (`branding.ts`) a partir de uma única cor de marca.
 *
 * O espaço de trabalho é **OKLCH**, não HSL. Em HSL, escurecer um verde e um
 * azul pelo mesmo tanto produz claridades percebidas bem diferentes, e a rampa
 * de tons sai torta — que é justamente o que não pode acontecer quando a cor
 * vem do cliente e ninguém revisa o resultado à mão. Em OKLCH o L é perceptual:
 * mesmo L, mesma claridade aparente, qualquer que seja o matiz.
 *
 * Sem dependência externa de propósito: isto roda no browser (prévia da tela de
 * admin), no Node (render do card e do certificado) e no teste de contraste.
 */

export interface Oklch {
  /** Claridade perceptual, 0–1. */
  l: number
  /** Croma (saturação). 0 = cinza; ~0.37 é o limite prático em sRGB. */
  c: number
  /** Matiz em graus, 0–360. */
  h: number
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

function srgbToLinear(u: number): number {
  const v = u / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

function linearToSrgb(u: number): number {
  const v = u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(Math.max(u, 0), 1 / 2.4) - 0.055
  return Math.round(clamp01(v) * 255)
}

export function parseHex(hex: string): [number, number, number] {
  let value = hex.trim().replace(/^#/, '')
  if (value.length === 3) {
    value = value
      .split('')
      .map((ch) => ch + ch)
      .join('')
  }
  if (!/^[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`Cor inválida: ${hex}`)
  }
  return [
    parseInt(value.slice(0, 2), 16),
    parseInt(value.slice(2, 4), 16),
    parseInt(value.slice(4, 6), 16),
  ]
}

export function isValidHex(hex: string): boolean {
  return /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex.trim())
}

export function toHex(rgb: [number, number, number]): string {
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

export function hexToOklch(hex: string): Oklch {
  const [r8, g8, b8] = parseHex(hex)
  const r = srgbToLinear(r8)
  const g = srgbToLinear(g8)
  const b = srgbToLinear(b8)

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)

  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s

  const chroma = Math.sqrt(a * a + bb * bb)
  const hue = chroma < 1e-6 ? 0 : ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360
  return { l: lightness, c: chroma, h: hue }
}

function oklchToLinearRgb({ l: L, c: C, h }: Oklch): [number, number, number] {
  const rad = (h * Math.PI) / 180
  const a = C * Math.cos(rad)
  const b = C * Math.sin(rad)

  const l_ = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (L - 0.0894841775 * a - 1.291485548 * b) ** 3

  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ]
}

const inGamut = (rgb: [number, number, number]) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4)

/**
 * OKLCH → hex, **reduzindo o croma** até caber em sRGB em vez de cortar o canal
 * que estourou. Cortar canal muda o matiz: um roxo saturado demais vira azul.
 * Reduzir o croma mantém matiz e claridade e só tira saturação — que é a
 * degradação que ninguém percebe como "cor errada".
 */
export function oklchToHex(color: Oklch): string {
  if (inGamut(oklchToLinearRgb(color))) {
    return toHex(oklchToLinearRgb(color).map(linearToSrgb) as [number, number, number])
  }
  let low = 0
  let high = color.c
  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2
    if (inGamut(oklchToLinearRgb({ ...color, c: mid }))) low = mid
    else high = mid
  }
  return toHex(oklchToLinearRgb({ ...color, c: low }).map(linearToSrgb) as [number, number, number])
}

/**
 * Canais RGB separados por espaço — o formato que o Tailwind exige para que
 * `bg-primary/30` funcione, já que `<alpha-value>` é interpolado dentro de
 * `rgb(… / …)`. Hex na variável quebraria toda classe com opacidade.
 */
export function toRgbChannels(hex: string): string {
  return parseHex(hex).join(' ')
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map(srgbToLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Razão de contraste WCAG 2.1, de 1:1 a 21:1. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const [lighter, darker] = la >= lb ? [la, lb] : [lb, la]
  return (lighter + 0.05) / (darker + 0.05)
}

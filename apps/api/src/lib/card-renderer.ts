import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import { hexToOklch, oklchToHex, type BrandingDTO } from '@legends/shared'
import { escapeXml, resvgFontOptions, SANS_FONT as SANS, SCRIPT_FONT as SCRIPT } from './svg-fonts'

export interface CardData {
  name: string
  /** Nome do mês por extenso, em cursiva no topo (ex.: "Julho"). */
  monthName: string
  /** Cargo/categoria do dev, exibido na tag (ex.: "Desen. Produtos"). Pode faltar. */
  position: string | null
  text: string
  photoDataUri: string | null // foto do dev embutida (ou null -> iniciais)
  initials: string
  /** Marca da empresa. Ausente = a do produto (ver `DEFAULT_CARD_BRAND`). */
  brand?: CardBrand
}

/**
 * A parte do card que muda por empresa. Cinco cores e um wordmark — o resto do
 * layout (grade, tipografia, estrelas) é do produto e não se mexe.
 */
export interface CardBrand {
  /** Palavra que fecha o título "DESTAQUES ___". */
  wordmark: string
  bgCenter: string
  bgEdge: string
  /** Aro da foto e destaque do wordmark. */
  accent: string
  /** Texto sobre as pílulas brancas. */
  pillText: string
  /** Fundo do círculo quando não há foto. */
  avatarBg: string
  /** Logo da empresa como data URI. `null` cai na arte do produto. */
  logoDataUri: string | null
}

const SIZE = 1080 // post quadrado (Instagram)
const CARD_MARGIN = 40

/** Foto do dev: coluna da esquerda, com a tag acima e a pílula do nome abaixo. */
const PHOTO_CX = 296
const PHOTO_CY = 612
const PHOTO_R = 150

/** Onde a coluna esquerda acaba e começa a do elogio. Nada de lá pode passar daqui. */
const LEFT_COLUMN_RIGHT = 500

/** Pílula centrada na foto: limitada pela margem do card e pela coluna do texto. */
const PILL_MAX_WIDTH = Math.min(PHOTO_CX - CARD_MARGIN, LEFT_COLUMN_RIGHT - PHOTO_CX) * 2
const PILL_MIN_FONT_SIZE = 26
const PILL_MAX_LINES = 3

/** Coluna do elogio: centro, largura (em caracteres x px de fonte) e altura útil. */
const TEXT_CX = 765
const TEXT_COLUMN_EM = 28 * 33
const TEXT_BLOCK_HEIGHT = 560
const TEXT_FONT_SIZES = [33, 30, 27, 24]

/**
 * Paleta histórica do card. Continua sendo o default para empresa que não
 * cadastrou marca — o card é material de divulgação, e mudar a cor dele sem
 * ninguém pedir seria uma surpresa desagradável.
 */
const BG_CENTER = '#3aa45a'
const BG_EDGE = '#0f5a2c'
const LIME = '#9fd64f' // aro da foto + destaque "EMR"
const PILL_TEXT = '#1c5e34' // texto sobre as pílulas brancas
const AVATAR_BG = '#15532c'

export const DEFAULT_CARD_BRAND: CardBrand = {
  wordmark: 'EMR',
  bgCenter: BG_CENTER,
  bgEdge: BG_EDGE,
  accent: LIME,
  pillText: PILL_TEXT,
  avatarBg: AVATAR_BG,
  logoDataUri: null,
}

/**
 * Deriva as cores do card a partir da cor institucional da empresa.
 *
 * Os alvos de claridade e croma são os da paleta histórica medidos em OKLCH
 * (fundo L≈.64/.41, aro L≈.81 num matiz ~25° adiante, textos L≈.43/.39). Ou
 * seja: o card de uma empresa cuja marca esteja na mesma família de verde sai
 * praticamente igual ao de hoje, e o de qualquer outra marca mantém a mesma
 * relação de contraste entre fundo, aro e texto — que é o que faz a arte
 * funcionar, não o verde em si.
 */
export function cardBrandFrom(
  branding: BrandingDTO,
  options: { companyName?: string | null; logoDataUri?: string | null } = {},
): CardBrand {
  const { companyName = null, logoDataUri = null } = options
  const brand = hexToOklch(branding.brandColor)
  const c = Math.min(brand.c, 0.16)
  const hue = (shift: number) => ((brand.h + shift) % 360 + 360) % 360
  return {
    // "DESTAQUES <EMPRESA>" — o nome da EMPRESA, não o do app.
    //
    // Vinha de `appName` e saía errado: o app da EMR chama-se "Portal EMR",
    // então o card dizia "DESTAQUES PORTAL EMR" em vez de "DESTAQUES EMR". São
    // dois nomes distintos de propósito — um é como o produto se apresenta por
    // dentro, o outro é quem está destacando alguém —, e o card fala em nome da
    // empresa.
    //
    // `appName` fica de último recurso, para o título nunca sair truncado se
    // alguém chamar sem o nome da empresa.
    wordmark: (companyName?.trim() || branding.appName).toUpperCase(),
    bgCenter: oklchToHex({ l: 0.64, c, h: brand.h }),
    bgEdge: oklchToHex({ l: 0.41, c: c * 0.7, h: brand.h }),
    accent: oklchToHex({ l: 0.81, c: c * 1.15, h: hue(-25) }),
    pillText: oklchToHex({ l: 0.43, c: c * 0.65, h: brand.h }),
    avatarBg: oklchToHex({ l: 0.39, c: c * 0.6, h: brand.h }),
    logoDataUri,
  }
}

const API_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const LOGO_PATHS = [
  join(process.cwd(), 'assets', 'emr_logotipo.svg'),
  join(process.cwd(), 'apps', 'api', 'assets', 'emr_logotipo.svg'),
  join(API_DIR, 'assets', 'emr_logotipo.svg'),
  join(API_DIR, '..', 'assets', 'emr_logotipo.svg'),
]
const LOGO_PATH = LOGO_PATHS.find((path) => existsSync(path))
if (!LOGO_PATH) {
  throw new Error(`Logo EMR não encontrada. Caminhos tentados: ${LOGO_PATHS.join(', ')}`)
}
const EMR_LOGO_MARKUP = readFileSync(LOGO_PATH, 'utf8')
  .replace(/^<svg\b[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '')

/** Quebra `text` em linhas com no máximo `maxChars` caracteres, por palavras. */
export function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length > maxChars && current) {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) lines.push(current)
  return lines.length ? lines : ['']
}

/** PRNG determinístico (mulberry32) — estrelas no mesmo lugar a cada render. */
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Estrela de 4 pontas (faísca) centrada na origem. */
function sparkPath(cx: number, cy: number, s: number): string {
  const c = s * 0.3
  return `M ${cx},${cy - s} L ${cx + c},${cy - c} L ${cx + s},${cy} L ${cx + c},${cy + c} L ${cx},${cy + s} L ${cx - c},${cy + c} L ${cx - s},${cy} L ${cx - c},${cy - c} Z`
}

/** Campo de estrelas/faíscas brancas, mais densas no topo. */
function buildStars(): string {
  const rng = mulberry32(20260601)
  const parts: string[] = []
  for (let i = 0; i < 90; i++) {
    const x = rng() * SIZE
    // viés para o topo: y menor é mais provável
    const y = rng() * rng() * SIZE
    const big = rng() > 0.82
    const op = (0.25 + rng() * 0.55).toFixed(2)
    if (big) {
      parts.push(`<path d="${sparkPath(x, y, 4 + rng() * 5)}" fill="#ffffff" fill-opacity="${op}"/>`)
    } else {
      parts.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(0.8 + rng() * 1.8).toFixed(1)}" fill="#ffffff" fill-opacity="${op}"/>`)
    }
  }
  return parts.join('')
}

/** Largura da pílula que comporta `text` numa fonte — o mesmo cálculo do desenho. */
function pillWidth(text: string, fontSize: number): number {
  return Math.max(text.length * fontSize * 0.6 + fontSize * 1.4, fontSize * 4)
}

/**
 * Encaixa o texto da pílula em `maxWidth`: encolhe a fonte enquanto couber em
 * uma linha e, quando nem na menor fonte couber, quebra em até três linhas na
 * maior fonte possível.
 *
 * A pílula é centrada na foto, então crescer com o texto a fazia crescer para
 * os dois lados: nome comprido vazava pela margem esquerda do card E por cima
 * da coluna do elogio, que é o que se via no card de julho/2026.
 */
export function fitPillText(
  text: string,
  fontSize: number,
  maxWidth: number,
): { lines: string[]; fontSize: number } {
  const min = Math.min(fontSize, PILL_MIN_FONT_SIZE)
  const wrapAt = (size: number) =>
    wrapText(text, Math.max(1, Math.floor((maxWidth - size * 1.4) / (size * 0.6))))
  for (let count = 1; count <= PILL_MAX_LINES; count++) {
    for (let size = fontSize; size >= min; size -= 2) {
      const lines = wrapAt(size)
      if (lines.length <= count && lines.every((line) => pillWidth(line, size) <= maxWidth)) {
        return { lines, fontSize: size }
      }
    }
  }
  // Palavra única maior que a pílula (não acontece com nome de gente): sobra
  // vazar um pouco na menor fonte, que ainda é melhor que cortar o nome.
  return { lines: wrapAt(min), fontSize: min }
}

/** Pílula branca com texto centralizado, quebrado em linhas se preciso. */
function pill(
  cx: number,
  cy: number,
  text: string,
  fontSize: number,
  pillText: string,
  maxWidth = PILL_MAX_WIDTH,
): string {
  const fit = fitPillText(text, fontSize, maxWidth)
  const size = fit.fontSize
  const lineH = size * 1.15
  const w = Math.max(...fit.lines.map((line) => pillWidth(line, size)))
  const h = size * 1.9 + (fit.lines.length - 1) * lineH
  const x = cx - w / 2
  const y = cy - h / 2
  const top = cy - ((fit.lines.length - 1) * lineH) / 2
  const tspans = fit.lines
    .map((line, i) => `<tspan x="${cx}" y="${(top + i * lineH).toFixed(1)}">${escapeXml(line)}</tspan>`)
    .join('')
  return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${(h / 2).toFixed(1)}" fill="#ffffff"/>
    <text font-size="${size}" font-weight="700" fill="${pillText}" text-anchor="middle" dominant-baseline="central">${tspans}</text>`
}

/**
 * Assinatura no rodapé. Empresa com logo cadastrada entra como `<image>`
 * (o PNG do S3, já embutido em data URI pelo chamador); sem logo, cai no
 * logotipo vetorial do produto que vive em `assets/`.
 */
function brandSignature(cx: number, cy: number, logoDataUri: string | null): string {
  const width = 250
  if (logoDataUri) {
    const height = 84
    return `<image href="${logoDataUri}" x="${(cx - width / 2).toFixed(1)}" y="${(cy - height / 2).toFixed(1)}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/>`
  }
  const scale = width / 522
  const height = 110 * scale
  return `<g transform="translate(${(cx - width / 2).toFixed(1)} ${(cy - height / 2).toFixed(1)}) scale(${scale.toFixed(6)})">${EMR_LOGO_MARKUP}</g>`
}

/**
 * Escolhe fonte, quebra e entrelinha do elogio para o texto INTEIRO caber na
 * coluna. Antes era fonte fixa com corte em 11 linhas, e texto mais longo
 * simplesmente sumia no meio da frase (foi o que aconteceu em julho/2026).
 * Só quando nem na menor fonte cabe é que corta — aí com reticências, para o
 * corte ficar visível.
 */
export function layoutHighlightText(text: string): {
  lines: string[]
  fontSize: number
  lineHeight: number
} {
  const wrapFor = (fontSize: number) => wrapText(text, Math.round(TEXT_COLUMN_EM / fontSize))
  const lineHeightFor = (fontSize: number) => Math.round(fontSize * 1.42)
  for (const fontSize of TEXT_FONT_SIZES) {
    const lines = wrapFor(fontSize)
    const lineHeight = lineHeightFor(fontSize)
    if (lines.length * lineHeight <= TEXT_BLOCK_HEIGHT) return { lines, fontSize, lineHeight }
  }
  const fontSize = TEXT_FONT_SIZES[TEXT_FONT_SIZES.length - 1]!
  const lineHeight = lineHeightFor(fontSize)
  const lines = wrapFor(fontSize).slice(0, Math.floor(TEXT_BLOCK_HEIGHT / lineHeight))
  const last = lines.length - 1
  lines[last] = `${lines[last]!.replace(/[\s.,;:]+$/, '')}…`
  return { lines, fontSize, lineHeight }
}

/**
 * O título tem largura fixa; "DESTAQUES" mais um nome comprido estoura os 1080px.
 * Encolhe a fonte quando preciso, em vez de deixar o texto sair do card.
 */
export function titleFontSize(wordmark: string): number {
  const chars = `DESTAQUES ${wordmark}`.length
  if (chars <= 13) return 92
  return Math.max(46, Math.floor((92 * 13) / chars))
}

/** Monta o SVG do card quadrado (1080x1080). Função pura — sem IO. */
export function buildCardSvg(data: CardData): string {
  const brand = data.brand ?? DEFAULT_CARD_BRAND
  const photoCx = PHOTO_CX
  const photoCy = PHOTO_CY
  const photoR = PHOTO_R

  const avatar = data.photoDataUri
    ? `<clipPath id="circ"><circle cx="${photoCx}" cy="${photoCy}" r="${photoR}"/></clipPath>
       <circle cx="${photoCx}" cy="${photoCy}" r="${photoR + 9}" fill="${brand.accent}"/>
       <image href="${data.photoDataUri}" x="${photoCx - photoR}" y="${photoCy - photoR}" width="${photoR * 2}" height="${photoR * 2}" clip-path="url(#circ)" preserveAspectRatio="xMidYMid slice"/>`
    : `<circle cx="${photoCx}" cy="${photoCy}" r="${photoR + 9}" fill="${brand.accent}"/>
       <circle cx="${photoCx}" cy="${photoCy}" r="${photoR}" fill="${brand.avatarBg}"/>
       <text x="${photoCx}" y="${photoCy}" font-size="110" font-weight="800" fill="${brand.accent}" text-anchor="middle" dominant-baseline="central">${escapeXml(data.initials)}</text>`

  // Tag (cargo) acima da foto; pílula com o nome abaixo.
  const tag = data.position
    ? pill(photoCx, photoCy - photoR - 56, data.position, 30, brand.pillText)
    : ''
  const namePill = pill(photoCx, photoCy + photoR + 56, data.name, 34, brand.pillText)

  // Texto de elogio, coluna direita, centralizado verticalmente na altura da foto.
  const textCx = TEXT_CX
  const { lines, fontSize: textFontSize, lineHeight: lineH } = layoutHighlightText(data.text)
  const blockTop = photoCy - ((lines.length - 1) * lineH) / 2
  const textTspans = lines
    .map((line, i) => `<tspan x="${textCx}" y="${(blockTop + i * lineH).toFixed(0)}">${escapeXml(line)}</tspan>`)
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <radialGradient id="bg" cx="50%" cy="34%" r="80%">
      <stop offset="0%" stop-color="${brand.bgCenter}"/>
      <stop offset="100%" stop-color="${brand.bgEdge}"/>
    </radialGradient>
  </defs>
  <rect width="${SIZE}" height="${SIZE}" fill="url(#bg)"/>
  ${buildStars()}

  <!-- título -->
  <text x="${SIZE / 2}" y="178" font-size="${titleFontSize(brand.wordmark)}" font-weight="800" letter-spacing="2" text-anchor="middle">
    <tspan fill="#ffffff">DESTAQUES </tspan><tspan fill="${brand.accent}">${escapeXml(brand.wordmark)}</tspan>
  </text>
  <text x="${SIZE / 2}" y="290" font-family="${SCRIPT}" font-size="104" fill="#ffffff" text-anchor="middle">${escapeXml(data.monthName)}</text>

  <!-- conteúdo -->
  ${tag}
  ${avatar}
  ${namePill}
  <text font-size="${textFontSize}" fill="#ffffff" text-anchor="middle">${textTspans}</text>

  <!-- assinatura da empresa -->
  ${brandSignature(SIZE / 2, 1006, brand.logoDataUri)}
</svg>`
}

/** Renderiza o SVG do card em PNG. Usa as fontes embutidas (render determinístico). */
export async function renderCard(data: CardData): Promise<Buffer> {
  const resvg = new Resvg(buildCardSvg(data), {
    fitTo: { mode: 'width', value: SIZE },
    font: resvgFontOptions(),
  })
  return resvg.render().asPng()
}

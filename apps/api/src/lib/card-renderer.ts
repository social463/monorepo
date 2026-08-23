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
export function cardBrandFrom(branding: BrandingDTO, logoDataUri: string | null = null): CardBrand {
  const brand = hexToOklch(branding.brandColor)
  const c = Math.min(brand.c, 0.16)
  const hue = (shift: number) => ((brand.h + shift) % 360 + 360) % 360
  return {
    // "DESTAQUES <NOME>" — o nome exibido da empresa, em caixa alta.
    wordmark: branding.appName.toUpperCase(),
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

/** Pílula branca com texto centralizado. Largura proporcional ao texto. */
function pill(cx: number, cy: number, text: string, fontSize: number, pillText: string): string {
  const t = escapeXml(text)
  const w = Math.max(text.length * fontSize * 0.6 + fontSize * 1.4, fontSize * 4)
  const h = fontSize * 1.9
  const x = cx - w / 2
  const y = cy - h / 2
  return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${(h / 2).toFixed(1)}" fill="#ffffff"/>
    <text x="${cx}" y="${cy}" font-size="${fontSize}" font-weight="700" fill="${pillText}" text-anchor="middle" dominant-baseline="central">${t}</text>`
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
  const photoCx = 296
  const photoCy = 612
  const photoR = 150

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
  const textCx = 765
  const lines = wrapText(data.text, 28).slice(0, 11)
  const lineH = 47
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
  <text font-size="33" fill="#ffffff" text-anchor="middle">${textTspans}</text>

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

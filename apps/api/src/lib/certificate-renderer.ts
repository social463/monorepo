import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import { wrapText } from './card-renderer'
import { escapeXml, resvgFontOptions, SCRIPT_FONT } from './svg-fonts'

export interface CertificateData {
  /** Nome de quem concluiu, como sai no certificado. */
  userName: string
  courseTitle: string
  hours: number
  /** Código público (`EMR-XXXXXXXX`) usado na verificação. */
  code: string
  /** Data de emissão já formatada em pt-BR (ex.: "31 de julho de 2026"). */
  issuedAtLabel: string
  competencies: string[]
}

/**
 * Recorte visual de um `CertificateTemplate` (schema/DTO em
 * `@legends/shared`) que o renderer de fato usa: cor de destaque, assinatura
 * e logo — nada além disso (ver Task 8 do plano de quiz/certificado/setor).
 * `template` é opcional em toda a API pública deste módulo: omitido (ou
 * `null`), o certificado sai idêntico ao visual embutido de sempre — é assim
 * que um certificado emitido antes deste modelo, re-renderizado, não muda.
 */
export interface CertificateTemplateVisual {
  accentColor: string
  signatureName: string
  signatureRole: string
  signatureImageUrl?: string | null
  logoUrl?: string | null
  /**
   * Arte de fundo, cobrindo a folha inteira. O campo existia no modelo e no
   * formulário desde sempre, mas o SVG nunca o desenhava — quem colava uma URL
   * salvava e não via efeito nenhum.
   */
  backgroundUrl?: string | null
}

// Paisagem A4-ish: bom para baixar e postar no LinkedIn.
const WIDTH = 1600
const HEIGHT = 1131

const PAPER = '#fdfdfb'
const INK = '#123c22'
const GREEN = '#2f8b4d'
const LIME = '#9fd64f'
const MUTED = '#5d7566'

const API_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const LOGO_PATHS = [
  join(process.cwd(), 'assets', 'emr_logotipo.svg'),
  join(process.cwd(), 'apps', 'api', 'assets', 'emr_logotipo.svg'),
  join(API_DIR, 'assets', 'emr_logotipo.svg'),
  join(API_DIR, '..', 'assets', 'emr_logotipo.svg'),
]
const LOGO_PATH = LOGO_PATHS.find((path) => existsSync(path))
const LOGO_MARKUP = LOGO_PATH
  ? readFileSync(LOGO_PATH, 'utf8')
      .replace(/^<svg\b[^>]*>/, '')
      .replace(/<\/svg>\s*$/, '')
  : ''

function logo(cx: number, cy: number, width: number): string {
  if (!LOGO_MARKUP) return ''
  const scale = width / 522
  const height = 110 * scale
  return `<g transform="translate(${(cx - width / 2).toFixed(1)} ${(cy - height / 2).toFixed(1)}) scale(${scale.toFixed(6)})">${LOGO_MARKUP}</g>`
}

/** Logo do modelo (imagem por URL) quando houver; senão o logo embutido de sempre. */
function logoMarkup(cx: number, cy: number, width: number, logoUrl: string | null | undefined): string {
  if (!logoUrl) return logo(cx, cy, width)
  const height = (110 / 522) * width
  return `<image x="${(cx - width / 2).toFixed(1)}" y="${(cy - height / 2).toFixed(1)}" width="${width.toFixed(1)}" height="${height.toFixed(1)}" href="${escapeXml(logoUrl)}" preserveAspectRatio="xMidYMid meet"/>`
}

/** Bloco de assinatura: só existe quando há modelo — sem modelo, nada é desenhado aqui. */
function signatureBlock(cx: number, lineY: number, template: CertificateTemplateVisual): string {
  const image = template.signatureImageUrl
    ? `<image x="${(cx - 90).toFixed(1)}" y="${(lineY - 96).toFixed(1)}" width="180" height="76" href="${escapeXml(template.signatureImageUrl)}" preserveAspectRatio="xMidYMid meet"/>`
    : ''
  return `${image}
  <line x1="${cx - 140}" y1="${lineY}" x2="${cx + 140}" y2="${lineY}" stroke="${INK}" stroke-width="2"/>
  <text x="${cx}" y="${lineY + 30}" font-size="24" font-weight="700" fill="${INK}" text-anchor="middle">${escapeXml(template.signatureName)}</text>
  <text x="${cx}" y="${lineY + 58}" font-size="18" fill="${MUTED}" text-anchor="middle">${escapeXml(template.signatureRole)}</text>`
}

/**
 * Monta o SVG do certificado. Função pura — sem IO, testável por snapshot.
 * `template` opcional: omitido, sai o visual embutido de sempre (cor verde,
 * logo padrão, sem assinatura) — byte a byte igual ao certificado emitido
 * antes do modelo configurável existir.
 */
export function buildCertificateSvg(data: CertificateData, template?: CertificateTemplateVisual | null): string {
  const accent = template?.accentColor || GREEN
  const titleLines = wrapText(data.courseTitle, 42).slice(0, 2)
  const titleTop = 520 - ((titleLines.length - 1) * 66) / 2
  const titleTspans = titleLines
    .map((line, index) => `<tspan x="${WIDTH / 2}" y="${(titleTop + index * 66).toFixed(0)}">${escapeXml(line)}</tspan>`)
    .join('')

  const competencies = data.competencies.slice(0, 4)
  const chipY = 660
  const chipGap = 18
  const chipWidths = competencies.map((c) => Math.max(c.length * 13 + 44, 110))
  const chipsTotal = chipWidths.reduce((sum, w) => sum + w, 0) + chipGap * Math.max(0, competencies.length - 1)
  let chipX = WIDTH / 2 - chipsTotal / 2
  const chips = competencies
    .map((competency, index) => {
      const w = chipWidths[index]
      const markup = `<rect x="${chipX.toFixed(1)}" y="${chipY}" width="${w.toFixed(1)}" height="46" rx="23" fill="${accent}" fill-opacity="0.1"/>
      <text x="${(chipX + w / 2).toFixed(1)}" y="${chipY + 23}" font-size="21" fill="${accent}" text-anchor="middle" dominant-baseline="central">${escapeXml(competency)}</text>`
      chipX += w + chipGap
      return markup
    })
    .join('')

  // Sem modelo, `footer` é exatamente `logoMarkup(..., undefined)` === `logo(...)` de
  // sempre — uma única linha, igual ao SVG de antes desta mudança. Monta tudo numa
  // string só (em vez de dois `${}` na marcação) pra não arriscar uma linha em branco
  // extra quando `template` é omitido, o que quebraria o hash de compatibilidade.
  const footer = template
    ? `${signatureBlock(WIDTH / 2, HEIGHT - 165, template)}\n  ${logoMarkup(WIDTH - 260, HEIGHT - 150, 220, template.logoUrl)}`
    : logoMarkup(WIDTH - 260, HEIGHT - 150, 220, undefined)

  // O papel continua embaixo da arte: se a imagem tiver transparência (ou não
  // carregar), o certificado sai no fundo claro de sempre em vez de preto.
  // `slice` porque a folha tem proporção fixa — a arte cobre e sobra, em vez de
  // deformar.
  //
  // A linha carrega a própria quebra: sem arte de fundo o SVG tem de sair
  // BYTE A BYTE igual ao de antes — é o que o teste dourado trava, para que um
  // certificado antigo re-renderizado não mude de cara.
  const background = template?.backgroundUrl
    ? `\n  <image x="0" y="0" width="${WIDTH}" height="${HEIGHT}" href="${escapeXml(template.backgroundUrl)}" preserveAspectRatio="xMidYMid slice"/>`
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${PAPER}"/>${background}
  <rect x="34" y="34" width="${WIDTH - 68}" height="${HEIGHT - 68}" rx="18" fill="none" stroke="${accent}" stroke-width="3"/>
  <rect x="52" y="52" width="${WIDTH - 104}" height="${HEIGHT - 104}" rx="12" fill="none" stroke="${LIME}" stroke-width="1.5"/>

  <!-- faixa superior -->
  <path d="M 52 52 H ${WIDTH - 52} V 128 H 52 Z" fill="${accent}"/>
  <text x="${WIDTH / 2}" y="92" font-size="30" font-weight="800" letter-spacing="8" fill="#ffffff" text-anchor="middle" dominant-baseline="central">CERTIFICADO DE CONCLUSÃO</text>

  <text x="${WIDTH / 2}" y="248" font-family="${SCRIPT_FONT}" font-size="52" fill="${MUTED}" text-anchor="middle">Certificamos que</text>

  <text x="${WIDTH / 2}" y="352" font-size="72" font-weight="800" fill="${INK}" text-anchor="middle">${escapeXml(data.userName)}</text>
  <line x1="${WIDTH / 2 - 320}" y1="388" x2="${WIDTH / 2 + 320}" y2="388" stroke="${LIME}" stroke-width="4"/>

  <text x="${WIDTH / 2}" y="446" font-size="26" fill="${MUTED}" text-anchor="middle">concluiu com aproveitamento o curso</text>
  <text font-size="54" font-weight="700" fill="${accent}" text-anchor="middle">${titleTspans}</text>

  <text x="${WIDTH / 2}" y="600" font-size="26" fill="${MUTED}" text-anchor="middle">com carga horária de ${data.hours} hora${data.hours === 1 ? '' : 's'}.</text>
  ${chips}

  <!-- rodapé -->
  <text x="140" y="${HEIGHT - 190}" font-size="22" fill="${MUTED}">Emitido em ${escapeXml(data.issuedAtLabel)}</text>
  <text x="140" y="${HEIGHT - 152}" font-size="22" fill="${MUTED}">Código de verificação</text>
  <text x="140" y="${HEIGHT - 110}" font-size="34" font-weight="700" fill="${INK}" letter-spacing="2">${escapeXml(data.code)}</text>

  ${footer}
</svg>`
}

/**
 * Busca uma URL remota do modelo (logo, assinatura) e devolve como data URI.
 * O `@resvg/resvg-js` instalado NÃO busca URL remota sozinho — ele expõe
 * `imagesToResolve()`/`resolveImage()` pra quem chama fornecer os bytes, e
 * este módulo não usa essa API; sem resolver antes, um `<image
 * href="https://...">` renderiza em branco no PNG, **em silêncio** (o SVG
 * fica correto, só a imagem final some). Mesmo motivo de `dev-photo.ts`
 * embutir a foto do dev como data URI antes de chegar no `card-renderer` —
 * não há precedente neste repo de resvg resolvendo `http(s)` sozinho.
 *
 * Já é `data:` (ou vazia) → devolve como está, sem rede. Falha ao buscar
 * **não lança**: best-effort, loga e o certificado sai sem aquela imagem —
 * mesmo padrão da avaliação de selos pós-voto (efeito colateral que não pode
 * derrubar a operação principal).
 */
async function toDataUri(url: string | null | undefined): Promise<string | null> {
  if (!url) return null
  if (url.startsWith('data:')) return url
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const contentType = res.headers.get('content-type') || 'image/png'
    const bytes = Buffer.from(await res.arrayBuffer())
    return `data:${contentType};base64,${bytes.toString('base64')}`
  } catch (err) {
    console.error(
      `[certificate-renderer] Falha ao carregar imagem do modelo de certificado (${url}); certificado sai sem ela.`,
      err,
    )
    return null
  }
}

/** Resolve fundo, logo e assinatura do modelo em paralelo — ver `toDataUri`. */
async function resolveTemplateImages(template: CertificateTemplateVisual): Promise<CertificateTemplateVisual> {
  const [logoUrl, signatureImageUrl, backgroundUrl] = await Promise.all([
    toDataUri(template.logoUrl),
    toDataUri(template.signatureImageUrl),
    toDataUri(template.backgroundUrl),
  ])
  return { ...template, logoUrl, signatureImageUrl, backgroundUrl }
}

/**
 * Monta o SVG final já com as imagens do modelo resolvidas para data URI —
 * é exatamente o que `renderCertificate` manda pro `resvg-js`. Exportada
 * separada de `buildCertificateSvg` pra poder testar, sem decodificar PNG,
 * que o `href` final carrega `data:` e não a URL remota original (ver
 * `toDataUri`). Sem modelo, não busca nada — cai direto em
 * `buildCertificateSvg(data, undefined)`, o mesmo caminho de sempre.
 */
export async function buildResolvedCertificateSvg(
  data: CertificateData,
  template?: CertificateTemplateVisual | null,
): Promise<string> {
  const resolved = template ? await resolveTemplateImages(template) : template
  return buildCertificateSvg(data, resolved)
}

/**
 * Renderiza o certificado em PNG com as fontes embutidas. `template` opcional:
 * ver `buildCertificateSvg` — omitido, sai o PNG idêntico ao de sempre.
 */
export async function renderCertificate(data: CertificateData, template?: CertificateTemplateVisual | null): Promise<Buffer> {
  const svg = await buildResolvedCertificateSvg(data, template)
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: WIDTH },
    font: resvgFontOptions(),
  })
  return resvg.render().asPng()
}

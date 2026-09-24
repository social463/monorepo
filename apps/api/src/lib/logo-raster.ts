/**
 * Converte a logo **cadastrada** da empresa em PNG, para quem não rasteriza SVG.
 *
 * O cliente é o rodapé do card do Teams. Quem desenha o card é a Microsoft, e o
 * renderizador dela não desenha SVG (ver `isTeamsRenderableLogo`) — então a logo
 * da empresa era descartada e o rodapé caía na arte do PRODUTO: a empresa
 * cadastrava a marca dela e o card saía com o punho do Legends. Rasterizando
 * aqui, o card mostra a logo que está cadastrada, no formato que o Teams desenha.
 *
 * Não confunda com `remote-image.ts`, que embute a logo NO SVG que o resvg vai
 * desenhar (card do Destaque, certificado). Aqui a logo é o desenho inteiro, e o
 * PNG sai para ser servido por HTTP.
 *
 * Falha **sempre** vira `null`, nunca exceção: a logo é enfeite, e um S3 lento
 * não pode ser o motivo de a notificação não sair.
 */
import { Resvg } from '@resvg/resvg-js'
import { fetchImageDataUri } from './remote-image'
import { resvgFontOptions } from './svg-fonts'

/**
 * Largura do PNG gerado. O rodapé do card desenha a 20px; 128 dá folga para
 * tela de alta densidade sem fazer a imagem pesar.
 */
export const BRAND_LOGO_PNG_WIDTH = 128

/** Cache do PNG por URL de origem. Chave é a logo, então logo nova nunca acha entrada velha. */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const CACHE_MAX = 32
const cache = new Map<string, { png: Buffer; expiresAt: number }>()

/** Só para testes: zera a memória entre casos. */
export function clearLogoRasterCache(): void {
  cache.clear()
}

/**
 * Logo que este módulo consegue converter: SVG remoto.
 *
 * Casa pela **extensão**, e não pelo content-type, porque a decisão é tomada sem
 * rede — é a mesma informação que `isTeamsRenderableLogo` usa para decidir o
 * contrário. As logos sobem por `buildBrandingLogoKey`, que grava a extensão a
 * partir do content-type, então as duas leituras concordam.
 */
export function isRasterizableSvgLogo(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return /^https?:$/i.test(parsed.protocol) && /\.svg$/i.test(parsed.pathname)
  } catch {
    return false
  }
}

/** Baixa a logo em SVG e devolve o PNG equivalente. `null` em qualquer falha. */
export async function rasterizeSvgLogo(url: string | null | undefined): Promise<Buffer | null> {
  if (!isRasterizableSvgLogo(url)) return null
  const key = url as string

  const cached = cache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.png

  // Reaproveita os limites de `remote-image`: timeout, content-type permitido e
  // teto de 2MB. Ele devolve data URI; o que o resvg quer é o texto do SVG.
  const dataUri = await fetchImageDataUri(key)
  if (!dataUri?.toLowerCase().startsWith('data:image/svg+xml;base64,')) return null

  try {
    const svg = Buffer.from(dataUri.slice(dataUri.indexOf(',') + 1), 'base64').toString('utf8')
    const resvg = new Resvg(svg, {
      fitTo: { mode: 'width', value: BRAND_LOGO_PNG_WIDTH },
      // Logo com texto em curvas é o caso comum, mas logo com <text> existe —
      // sem as fontes embutidas ela sairia na fonte padrão do sistema (ou em
      // nada, no container).
      font: resvgFontOptions(),
    })
    const png = Buffer.from(resvg.render().asPng())
    if (cache.size >= CACHE_MAX) cache.clear()
    cache.set(key, { png, expiresAt: Date.now() + CACHE_TTL_MS })
    return png
  } catch (err) {
    console.error(`[logo-raster] falha ao rasterizar a logo (${key}); o rodapé cai na arte do produto.`, err)
    return null
  }
}

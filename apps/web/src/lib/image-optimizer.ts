import { IMAGE_MAX_BYTES, isAllowedImageContentType } from '@legends/shared'

/**
 * Otimização de imagem **antes** do upload.
 *
 * Mora no navegador, e não na API, porque o arquivo nunca passa pelo servidor:
 * o fluxo é presign → PUT direto no S3 (ver `upload.ts`). Um serviço no backend
 * exigiria subir os 30MB para a API só para devolvê-los ao bucket — o dobro do
 * tráfego, um limite de corpo novo no Fastify e o `sharp` no runtime. Aqui a
 * foto de 8000×6000 do celular vira ~1MB antes de sair da máquina de quem
 * publica, e o que trafega já é o arquivo final.
 *
 * A regra continua sendo a de `validateImageFile`: isto **reduz** o que dá para
 * reduzir, não afrouxa o teto. Se a imagem seguir acima de `IMAGE_MAX_BYTES`
 * depois de otimizada, a recusa acontece como antes.
 */

/** Maior lado que uma foto precisa ter numa tela (retina em 1280 lógicos). */
export const IMAGE_MAX_DIMENSION = 2560

/** Peso alvo. Chegando aqui, para de apertar a qualidade. */
export const IMAGE_TARGET_BYTES = 2 * 1024 * 1024

/** Abaixo disso e dentro da dimensão, re-encodar só perderia qualidade à toa. */
const SKIP_BELOW_BYTES = 512 * 1024

/** Passos de qualidade, do melhor para o mais apertado. */
const QUALITY_STEPS = [0.82, 0.7, 0.6] as const

/** Quantas vezes pode reduzir a resolução quando a qualidade não bastou. */
const MAX_DOWNSCALE_STEPS = 4

export interface OptimizeImageOptions {
  maxDimension?: number
  targetBytes?: number
  hardMaxBytes?: number
}

let webpEncodingSupport: boolean | null = null

/**
 * O canvas deste navegador sabe **escrever** WebP? (ler, todos sabem hoje;
 * escrever, só Safari 14+.) Memoizado: a prova custa um canvas por chamada.
 */
function supportsWebpEncoding(): boolean {
  if (webpEncodingSupport !== null) return webpEncodingSupport
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    webpEncodingSupport = canvas.toDataURL('image/webp').startsWith('data:image/webp')
  } catch {
    webpEncodingSupport = false
  }
  return webpEncodingSupport
}

/**
 * Formato de saída, ou null quando não vale a pena mexer.
 *
 * WebP primeiro porque é o único que comprime com perda **e** mantém
 * transparência. Sem ele, JPEG só entra se a origem já era JPEG (converter PNG
 * para JPEG enegreceria o fundo transparente), e PNG só entra quando a imagem
 * vai encolher — aí o ganho vem de ter menos pixel, não do encoder.
 */
function pickEncodeType(sourceType: string, needsResize: boolean): string | null {
  if (supportsWebpEncoding()) return 'image/webp'
  if (sourceType === 'image/jpeg') return 'image/jpeg'
  return needsResize ? 'image/png' : null
}

/** Troca a extensão pela do formato de saída, preservando o nome. */
function renameTo(fileName: string, type: string): string {
  const ext = type === 'image/webp' ? 'webp' : type === 'image/png' ? 'png' : 'jpg'
  const base = fileName.replace(/\.[^./\\]+$/, '') || 'imagem'
  return `${base}.${ext}`
}

/** Desenha o bitmap na escala pedida e devolve o blob codificado. */
function encode(
  bitmap: ImageBitmap,
  scale: number,
  type: string,
  quality: number | undefined,
): Promise<Blob | null> {
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.resolve(null)
  ctx.drawImage(bitmap, 0, 0, width, height)
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), type, quality)
    } catch {
      resolve(null)
    }
  })
}

/** Decodifica respeitando a orientação do EXIF; sem ela, foto de celular deita. */
async function decode(file: File): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    try {
      return await createImageBitmap(file)
    } catch {
      return null
    }
  }
}

/**
 * Reduz e re-encoda a imagem para caber no teto de upload.
 *
 * **Nunca lança e nunca piora**: qualquer tropeço (navegador sem
 * `createImageBitmap`, canvas indisponível, resultado mais pesado que a origem)
 * devolve o arquivo original, e o upload segue como seguia. GIF fica de fora de
 * propósito — o canvas achata a animação num quadro só.
 */
export async function optimizeImageForUpload(
  file: File,
  options: OptimizeImageOptions = {},
): Promise<File> {
  const {
    maxDimension = IMAGE_MAX_DIMENSION,
    targetBytes = IMAGE_TARGET_BYTES,
    hardMaxBytes = IMAGE_MAX_BYTES,
  } = options

  if (typeof createImageBitmap !== 'function') return file
  if (!isAllowedImageContentType(file.type) || file.type === 'image/gif') return file

  const bitmap = await decode(file)
  if (!bitmap) return file

  try {
    const needsResize = Math.max(bitmap.width, bitmap.height) > maxDimension
    if (!needsResize && file.size <= Math.max(targetBytes, SKIP_BELOW_BYTES)) return file

    const encodeType = pickEncodeType(file.type, needsResize)
    if (!encodeType) return file

    let scale = needsResize ? maxDimension / Math.max(bitmap.width, bitmap.height) : 1
    // PNG é sem perda: a qualidade não muda nada, então uma passada basta.
    const qualities = encodeType === 'image/png' ? [undefined] : [...QUALITY_STEPS]

    let best: Blob | null = null
    for (const quality of qualities) {
      const blob = await encode(bitmap, scale, encodeType, quality)
      if (!blob) break
      best = blob
      if (blob.size <= targetBytes) break
    }

    // Qualidade no fundo do poço e ainda acima do teto? O que sobra é resolução
    // — é o caso da foto de 50MP, em que o peso vem da contagem de pixel.
    let steps = 0
    while (best && best.size > hardMaxBytes && steps < MAX_DOWNSCALE_STEPS) {
      scale *= 0.7
      steps += 1
      const blob = await encode(bitmap, scale, encodeType, qualities.at(-1))
      if (!blob) break
      best = blob
    }

    if (!best || best.size >= file.size) return file
    return new File([best], renameTo(file.name, encodeType), {
      type: encodeType,
      lastModified: file.lastModified,
    })
  } catch {
    return file
  } finally {
    bitmap.close?.()
  }
}

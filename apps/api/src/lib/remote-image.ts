/**
 * Baixa uma imagem e devolve como data URI.
 *
 * O resvg (que renderiza o card do Destaque e o certificado) não busca URL
 * nenhuma: tudo que aparece no SVG precisa estar embutido. As logos das
 * empresas vivem no S3, então alguém tem que trazer os bytes — é aqui.
 *
 * Falha **sempre** vira `null`, nunca exceção: a logo é enfeite, e um S3 lento
 * não pode ser o motivo de o admin não conseguir gerar o card do mês.
 */

const TIMEOUT_MS = 5_000
const MAX_BYTES = 2 * 1024 * 1024

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'])

export async function fetchImageDataUri(url: string | null): Promise<string | null> {
  if (!url) return null
  // Caminho relativo é arte servida pelo próprio front; não há o que baixar aqui.
  if (!/^https?:\/\//i.test(url)) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return null

    const contentType = (res.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase()
    if (!contentType || !ALLOWED_TYPES.has(contentType)) return null

    const buffer = Buffer.from(await res.arrayBuffer())
    // Teto de tamanho: o card inteiro vira um SVG em memória, e uma logo de
    // 20MB embutida em base64 estoura o processo antes de virar PNG.
    if (buffer.byteLength > MAX_BYTES) return null

    return `data:${contentType};base64,${buffer.toString('base64')}`
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

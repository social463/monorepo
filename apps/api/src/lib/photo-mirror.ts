/**
 * Foto de colaborador vinda de link externo (coluna `Foto (URL)` da importação
 * por planilha).
 *
 * Duas coisas moram aqui, e as duas existem por causa do Google Drive, que é de
 * onde a G&G tira os links:
 *
 * 1. **Normalizar.** `https://drive.google.com/file/d/<id>/view` é uma PÁGINA,
 *    não uma imagem: colada num `<img src>` ela não renderiza nada. A URL de
 *    conteúdo é `/thumbnail?id=<id>`, que devolve JPEG direto.
 * 2. **Espelhar.** Guardar o link do Drive no `photoUrl` faria o avatar de todo
 *    mundo depender da permissão de um arquivo que a G&G pode mover, renomear
 *    ou fechar — e o rosto sumiria da plataforma sem ninguém entender por quê.
 *    Então a importação baixa a imagem e re-hospeda no nosso bucket, que é a
 *    mesma casa das fotos subidas à mão em Administração › Lendas.
 *
 * A chave do espelho carrega o **sha256 da URL de origem**
 * (`photo-imports/<companyId>/<hash>.<ext>`). É isso que torna a reimportação
 * barata e idempotente: se o `photoUrl` gravado já é o espelho daquela origem,
 * a linha sai como "sem mudança" e nada é baixado de novo.
 */

import { createHash } from 'node:crypto'
import {
  IMAGE_MAX_BYTES,
  isAllowedImageContentType,
  type AllowedImageContentType,
} from '@legends/shared'
import { putS3Object, s3Config } from './s3-client'

const EXT_BY_TYPE: Record<AllowedImageContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/** 15s por foto. Uma carga de 200 linhas não pode ficar presa num link morto. */
const FETCH_TIMEOUT_MS = 15_000

/**
 * Largura pedida ao Drive. 800px cobre o maior lugar em que a foto aparece
 * (o card de perfil) com folga para tela retina, e evita baixar o original de
 * 4000px que a câmera do RH produziu.
 */
const DRIVE_THUMBNAIL_WIDTH = 800

const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{10,}$/

/**
 * Hosts que a importação nunca busca. Quem cola o link é um admin autenticado,
 * mas o `fetch` sai do NOSSO servidor: sem isto, uma célula com
 * `http://169.254.169.254/…` faria a API bater no serviço de metadados da EC2.
 * A imagem não voltaria (o content-type barra), e é justamente por isso que a
 * defesa tem de estar aqui, e não na resposta.
 */
function isInternalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return true
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd')) return true
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true
  if (/^169\.254\./.test(host)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true
  return false
}

/** Extrai o id do arquivo das formas de link que o Drive gera. */
function driveFileId(url: URL): string | null {
  if (!/(^|\.)(drive|docs)\.google\.com$/.test(url.hostname)) return null

  // /file/d/<id>/view, /file/d/<id>/preview
  const inPath = url.pathname.match(/\/(?:file|document)\/d\/([^/]+)/)
  if (inPath && DRIVE_ID_PATTERN.test(inPath[1])) return inPath[1]

  // /open?id=<id>, /uc?id=<id>, /thumbnail?id=<id>
  const inQuery = url.searchParams.get('id')
  if (inQuery && DRIVE_ID_PATTERN.test(inQuery)) return inQuery

  return null
}

/**
 * URL de origem utilizável, ou `null` quando o texto não é um link http(s).
 *
 * Link do Drive vira a URL de conteúdo; qualquer outro passa inteiro. Não
 * tentamos adivinhar o resto: uma URL que já aponta para um `.jpg` funciona
 * como está, e uma que não aponta falha no download, com aviso na linha.
 */
export function normalizePhotoSourceUrl(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (isInternalHost(url.hostname)) return null

  const driveId = driveFileId(url)
  if (driveId) {
    return `https://drive.google.com/thumbnail?id=${driveId}&sz=w${DRIVE_THUMBNAIL_WIDTH}`
  }
  return url.toString()
}

/** Chave do espelho, derivada da URL de origem — ver o cabeçalho do arquivo. */
export function buildImportedPhotoKey(
  companyId: string,
  sourceUrl: string,
  contentType: AllowedImageContentType,
): string {
  return `photo-imports/${companyId}/${photoSourceHash(sourceUrl)}.${EXT_BY_TYPE[contentType]}`
}

export function photoSourceHash(sourceUrl: string): string {
  return createHash('sha256').update(sourceUrl).digest('hex')
}

/**
 * A foto já gravada veio DESTA origem? Então não há o que baixar nem o que
 * mudar, e a linha sai como "sem mudança" na reimportação.
 *
 * Dois casos, porque há dois jeitos de a foto ter sido gravada: o espelho no
 * bucket (compara só o hash — a extensão depende do content-type que o servidor
 * devolveu, e não faz parte da identidade da origem) e, sem S3 configurado, a
 * própria URL de origem.
 */
export function isMirrorOf(photoUrl: string | null, companyId: string, sourceUrl: string): boolean {
  if (!photoUrl) return false
  if (photoUrl === sourceUrl) return true
  return photoUrl.includes(`photo-imports/${companyId}/${photoSourceHash(sourceUrl)}.`)
}

export class PhotoMirrorError extends Error {}

/**
 * Baixa a imagem e devolve a URL pública do espelho.
 *
 * Sem S3 configurado (dev sem bucket), devolve a própria URL de origem: é o
 * mesmo degrade do `PhotoUploadField`, que some quando `/uploads/config` vem
 * desabilitado — melhor a foto do Drive do que nenhuma foto.
 */
export async function mirrorPhoto(
  sourceUrl: string,
  companyId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (!s3Config()) return sourceUrl

  const response = await fetchImpl(sourceUrl, {
    redirect: 'follow',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }).catch((error: unknown) => {
    throw new PhotoMirrorError(
      error instanceof Error && error.name === 'TimeoutError'
        ? 'o servidor da imagem não respondeu a tempo'
        : 'não foi possível acessar o link',
    )
  })

  if (!response.ok) {
    throw new PhotoMirrorError(`o link respondeu ${response.status}`)
  }

  // O Drive responde 200 com HTML quando o arquivo não é público — é o erro mais
  // comum aqui, e sem esta checagem ele viraria um "PNG" de 40 KB de página de
  // login gravado como foto de alguém.
  const contentType = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (!isAllowedImageContentType(contentType)) {
    throw new PhotoMirrorError(
      contentType.startsWith('text/')
        ? 'o link não devolveu uma imagem (confira se o arquivo está compartilhado como público)'
        : `formato não aceito (${contentType || 'desconhecido'})`,
    )
  }

  // Teto ANTES de baixar, quando o servidor declara o tamanho: medir depois já
  // seria ter trazido o arquivo inteiro para a memória do processo.
  const declared = Number(response.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > IMAGE_MAX_BYTES) {
    throw new PhotoMirrorError(`a imagem passa de ${Math.round(IMAGE_MAX_BYTES / 1024 / 1024)} MB`)
  }

  const body = Buffer.from(await response.arrayBuffer())
  if (body.byteLength === 0) throw new PhotoMirrorError('o link devolveu um arquivo vazio')
  if (body.byteLength > IMAGE_MAX_BYTES) {
    throw new PhotoMirrorError(`a imagem passa de ${Math.round(IMAGE_MAX_BYTES / 1024 / 1024)} MB`)
  }

  return putS3Object({
    key: buildImportedPhotoKey(companyId, sourceUrl, contentType),
    contentType,
    body,
  })
}

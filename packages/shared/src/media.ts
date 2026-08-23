import type { CorporatePostAttachmentKind } from './corporate-mural'
import { ALLOWED_IMAGE_CONTENT_TYPES, IMAGE_MAX_BYTES } from './image'

/**
 * Anexos do Feed Corporativo: foto, **vídeo** e **documento**.
 *
 * Existe separado de `image.ts`/`document.ts` porque o feed é o primeiro lugar
 * que aceita vídeo e que aceita documento **de qualquer colaborador** —
 * `/uploads/documents/presign` é de admin e só PDF, feito para o manual
 * interno. Aqui a allowlist é própria e o teto varia por tipo.
 */

/** Vídeo é o anexo pesado; 50MB é o teto que a G&G pediu. */
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024

/** Documento do feed: 20MB, o mesmo do manual interno. */
export const MEDIA_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024

/**
 * Só formatos que o `<video>` do navegador toca nativamente. MOV/AVI ficariam
 * de fora do player e viraria "anexo que não abre" — quem precisa manda o
 * arquivo como documento.
 */
export const ALLOWED_VIDEO_CONTENT_TYPES = ['video/mp4', 'video/webm'] as const
export type AllowedVideoContentType = (typeof ALLOWED_VIDEO_CONTENT_TYPES)[number]

/** PDF e os formatos do Office — é o que circula em comunicado interno. */
export const ALLOWED_MEDIA_DOCUMENT_CONTENT_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
] as const
export type AllowedMediaDocumentContentType = (typeof ALLOWED_MEDIA_DOCUMENT_CONTENT_TYPES)[number]

/** Tudo que o presign de mídia aceita, na ordem de checagem. */
export const ALLOWED_MEDIA_CONTENT_TYPES = [
  ...ALLOWED_IMAGE_CONTENT_TYPES,
  ...ALLOWED_VIDEO_CONTENT_TYPES,
  ...ALLOWED_MEDIA_DOCUMENT_CONTENT_TYPES,
] as const

/**
 * Espécie do anexo a partir do content-type, ou null se o formato não entra.
 * Fonte única: o presign decide o teto com isto e o service confere o `kind`
 * que o cliente mandou — sem isso daria para gravar um .exe rotulado de IMAGE.
 */
export function mediaKindFor(contentType: string): CorporatePostAttachmentKind | null {
  if ((ALLOWED_IMAGE_CONTENT_TYPES as readonly string[]).includes(contentType)) return 'IMAGE'
  if ((ALLOWED_VIDEO_CONTENT_TYPES as readonly string[]).includes(contentType)) return 'VIDEO'
  if ((ALLOWED_MEDIA_DOCUMENT_CONTENT_TYPES as readonly string[]).includes(contentType)) return 'DOCUMENT'
  return null
}

/** Teto em bytes por espécie de anexo. */
export function mediaMaxBytesFor(kind: CorporatePostAttachmentKind): number {
  if (kind === 'IMAGE') return IMAGE_MAX_BYTES
  if (kind === 'VIDEO') return VIDEO_MAX_BYTES
  return MEDIA_DOCUMENT_MAX_BYTES
}

/** Mensagem de recusa por tamanho, em MB inteiros. */
export function mediaTooLargeMessage(kind: CorporatePostAttachmentKind): string {
  const mb = Math.round(mediaMaxBytesFor(kind) / (1024 * 1024))
  if (kind === 'IMAGE') return `Imagem muito grande (máx. ${mb}MB).`
  if (kind === 'VIDEO') return `Vídeo muito grande (máx. ${mb}MB).`
  return `Arquivo muito grande (máx. ${mb}MB).`
}

/** Config pública do upload de mídia do feed (controla os botões do composer). */
export interface MediaUploadConfig {
  enabled: boolean
  imageMaxBytes: number
  videoMaxBytes: number
  documentMaxBytes: number
  allowedContentTypes: string[]
}

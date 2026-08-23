/** Imagem anexada, como persistida/serializada. */
export interface AttachedImage {
  url: string
  width: number
  height: number
}

/** Tamanho máximo do arquivo de imagem (10MB). */
export const IMAGE_MAX_BYTES = 10 * 1024 * 1024

/** Content-types aceitos no upload de imagem da resenha. */
export const ALLOWED_IMAGE_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const

export type AllowedImageContentType = (typeof ALLOWED_IMAGE_CONTENT_TYPES)[number]

/**
 * Formatos aceitos numa **logo de marca**. Inclui SVG, que os demais uploads
 * não aceitam.
 *
 * SVG é o formato natural de um logotipo — vetor, nítido em qualquer tamanho e
 * com um décimo do peso de um PNG equivalente. Ele carrega o risco conhecido de
 * embutir script, e aqui isso é neutralizado por duas coisas: a arte é sempre
 * renderizada em `<img src>` (o contexto `<img>` **não** executa script dentro
 * do SVG — só `<object>`, `<embed>` e SVG inline executam), e o arquivo é
 * servido do bucket público, que é outra origem. Se algum dia alguém for
 * embutir a logo inline no DOM, esta permissão precisa ser revista.
 */
export const ALLOWED_LOGO_CONTENT_TYPES = [
  ...ALLOWED_IMAGE_CONTENT_TYPES,
  'image/svg+xml',
] as const

export type AllowedLogoContentType = (typeof ALLOWED_LOGO_CONTENT_TYPES)[number]

export function isAllowedLogoContentType(ct: string): ct is AllowedLogoContentType {
  return (ALLOWED_LOGO_CONTENT_TYPES as readonly string[]).includes(ct)
}

/** Logo é arquivo pequeno; 2MB cobre SVG e PNG grande com folga. */
export const LOGO_MAX_BYTES = 2 * 1024 * 1024

/** O content-type é um dos formatos de imagem permitidos? */
export function isAllowedImageContentType(ct: string): ct is AllowedImageContentType {
  return (ALLOWED_IMAGE_CONTENT_TYPES as readonly string[]).includes(ct)
}

/** Corpo enviado ao pedir uma URL de upload pré-assinada. */
export interface PresignImageUploadRequest {
  contentType: string
  size: number
}

/** Resposta do presign: URL de PUT + URL pública final + chave do objeto. */
export interface PresignImageUploadResponse {
  uploadUrl: string
  publicUrl: string
  key: string
}

/** Config pública do recurso de upload (controla o botão no front). */
export interface ImageUploadConfig {
  enabled: boolean
  maxBytes: number
  allowedContentTypes: string[]
}

/** Tamanho máximo do documento anexado a um manual interno (20MB). */
export const DOCUMENT_MAX_BYTES = 20 * 1024 * 1024

/** Content-types aceitos no upload de documento. */
export const ALLOWED_DOCUMENT_CONTENT_TYPES = ['application/pdf'] as const

export type AllowedDocumentContentType = (typeof ALLOWED_DOCUMENT_CONTENT_TYPES)[number]

/** O content-type é um dos formatos de documento permitidos? */
export function isAllowedDocumentContentType(ct: string): ct is AllowedDocumentContentType {
  return (ALLOWED_DOCUMENT_CONTENT_TYPES as readonly string[]).includes(ct)
}

/** Corpo enviado ao pedir uma URL de upload pré-assinada para um documento. */
export interface PresignDocumentUploadRequest {
  contentType: string
  size: number
}

/**
 * Resposta do presign de documento: URL de PUT + chave do objeto.
 * Não devolve URL pública — manual interno só é baixado pela rota autenticada.
 */
export interface PresignDocumentUploadResponse {
  uploadUrl: string
  key: string
}

/** Config pública do recurso de upload de documento (controla o campo no admin). */
export interface DocumentUploadConfig {
  enabled: boolean
  maxBytes: number
  allowedContentTypes: string[]
}

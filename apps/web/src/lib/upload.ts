import {
  DOCUMENT_MAX_BYTES,
  IMAGE_MAX_BYTES,
  isAllowedDocumentContentType,
  isAllowedImageContentType,
  mediaKindFor,
  mediaMaxBytesFor,
  mediaTooLargeMessage,
  type AttachedImage,
  type CorporatePostAttachmentInput,
  type CorporatePostAttachmentKind,
  type EventPhotoInput,
  type PresignDocumentUploadResponse,
  type PresignImageUploadResponse,
} from '@legends/shared'
import { apiFetch } from './api'
import { optimizeImageForUpload } from './image-optimizer'

export class UploadError extends Error {
  /**
   * Se tentar de novo tem chance de dar certo. Formato e tamanho recusados são
   * `false` (o arquivo é o mesmo na segunda tentativa); PUT no S3 que não
   * completou é `true`.
   */
  constructor(
    message: string,
    public retryable = false,
  ) {
    super(message)
    this.name = 'UploadError'
  }
}

/** Valida tipo e tamanho antes de subir. Lança UploadError com mensagem em pt-BR. */
export function validateImageFile(file: File): void {
  if (!isAllowedImageContentType(file.type)) {
    throw new UploadError('Formato não suportado. Use JPEG, PNG, WebP ou GIF.')
  }
  if (file.size > IMAGE_MAX_BYTES) {
    throw new UploadError('Imagem muito grande (máx. 10MB).')
  }
}

/** Lê as dimensões naturais da imagem no browser. */
export function readImageDimensions(file: File): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(file)
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new UploadError('Não foi possível ler a imagem.'))
    }
    img.src = url
  })
}

/** Fluxo completo: valida → dimensões → presign → PUT no S3 → AttachedImage. */
export async function uploadImage(file: File): Promise<AttachedImage> {
  // Otimiza ANTES de validar: é o que faz a foto de celular caber no teto em
  // vez de ser recusada por tamanho.
  const otimizada = await optimizeImageForUpload(file)
  validateImageFile(otimizada)
  const { width, height } = await readImageDimensions(otimizada)
  const presign = await apiFetch<PresignImageUploadResponse>('/uploads/images/presign', {
    method: 'POST',
    body: JSON.stringify({ contentType: otimizada.type, size: otimizada.size }),
  })
  // PUT direto no S3 (fetch cru, fora do apiFetch): sem Authorization, Content-Type do arquivo.
  const put = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': otimizada.type },
    body: otimizada,
  })
  if (!put.ok) throw new UploadError('Falha ao enviar a imagem.')
  return { url: presign.publicUrl, width, height }
}

/**
 * Sobe um anexo do Feed Corporativo: foto, vídeo ou documento.
 *
 * Rota própria (`/uploads/media/presign`, aberta a qualquer colaborador
 * autenticado) porque a de documento é admin-only e só PDF — e agora todo mundo
 * escreve no feed. A espécie do anexo vem do SERVIDOR: aqui ela é derivada só
 * para escolher a mensagem de erro e ler dimensões de imagem.
 */
export async function uploadFeedMedia(file: File): Promise<CorporatePostAttachmentInput> {
  const kind = mediaKindFor(file.type)
  if (!kind) {
    throw new UploadError('Formato não suportado. Envie imagem, vídeo MP4/WebM, PDF ou Office.')
  }
  // Só foto encolhe: vídeo e documento saem como vieram (o canvas não os lê).
  const anexo = kind === 'IMAGE' ? await optimizeImageForUpload(file) : file
  if (anexo.size > mediaMaxBytesFor(kind)) throw new UploadError(mediaTooLargeMessage(kind))

  const dimensions = kind === 'IMAGE' ? await readImageDimensions(anexo) : null
  const presign = await apiFetch<{
    uploadUrl: string
    publicUrl: string
    key: string
    kind: CorporatePostAttachmentKind
  }>('/uploads/media/presign', {
    method: 'POST',
    body: JSON.stringify({ contentType: anexo.type, size: anexo.size }),
  })
  // PUT direto no S3 (fetch cru, fora do apiFetch): sem Authorization.
  const put = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': anexo.type },
    body: anexo,
  })
  if (!put.ok) throw new UploadError('Falha ao enviar o arquivo.')
  return {
    kind: presign.kind,
    url: presign.publicUrl,
    name: anexo.name,
    contentType: anexo.type,
    size: anexo.size,
    ...(dimensions ?? {}),
  }
}

/** Valida tipo e tamanho do documento antes de subir. */
export function validateDocumentFile(file: File): void {
  if (!isAllowedDocumentContentType(file.type)) {
    throw new UploadError('Formato não suportado. Envie um PDF.')
  }
  if (file.size > DOCUMENT_MAX_BYTES) {
    throw new UploadError('Arquivo muito grande (máx. 20MB).')
  }
}

export interface UploadedDocument {
  key: string
  fileName: string
  fileSize: number
}

/**
 * Fluxo do PDF de manual: valida → presign → PUT no S3. Devolve a CHAVE do
 * objeto (não uma URL): o arquivo não é público, o download passa pela rota
 * autenticada `/culture/manuals/:id/download`.
 */
export async function uploadDocument(file: File): Promise<UploadedDocument> {
  validateDocumentFile(file)
  const presign = await apiFetch<PresignDocumentUploadResponse>('/uploads/documents/presign', {
    method: 'POST',
    body: JSON.stringify({ contentType: file.type, size: file.size }),
  })
  // PUT direto no S3 (fetch cru, fora do apiFetch): sem Authorization.
  const put = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  })
  if (!put.ok) throw new UploadError('Falha ao enviar o arquivo.')
  return { key: presign.key, fileName: file.name, fileSize: file.size }
}

/**
 * Fluxo da evidência de participação num desafio: mesmos tipo/tamanho de
 * documento (reaproveitados de @legends/shared, sem limite novo), presign
 * numa rota própria (`/uploads/challenge-evidence/presign`, aberta a QUALQUER
 * colaborador autenticado — a de manual é admin/subadmin-only) → PUT no S3.
 * A chave nasce no servidor sob challenges/<userId>/; devolve a chave, não uma
 * URL: a evidência não é pública, a visualização passa pela URL assinada que
 * a API devolve em ChallengeSubmissionDTO.evidenceUrl.
 */
/**
 * Comprovação de uma reivindicação de selo (Documento 4, seção 11.2).
 *
 * Aceita imagem **ou** PDF, ao contrário da evidência de desafio, que é só PDF
 * — daí a rota de presign própria. A espécie do anexo vem do servidor, que a
 * deriva do content-type: quem manda o arquivo não decide se ele é imagem ou
 * documento.
 */
export async function uploadBadgeClaimAttachment(
  file: File,
): Promise<{ key: string; kind: CorporatePostAttachmentKind }> {
  const kind = mediaKindFor(file.type)
  if (kind !== 'IMAGE' && file.type !== 'application/pdf') {
    throw new UploadError('Formato não suportado. Envie uma imagem ou um PDF.')
  }
  if (file.size > mediaMaxBytesFor(kind ?? 'DOCUMENT')) {
    throw new UploadError(mediaTooLargeMessage(kind ?? 'DOCUMENT'))
  }

  const presign = await apiFetch<{ uploadUrl: string; key: string; kind: CorporatePostAttachmentKind }>(
    '/uploads/badge-claim/presign',
    { method: 'POST', body: JSON.stringify({ contentType: file.type, size: file.size }) },
  )
  const put = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  })
  if (!put.ok) throw new UploadError('Falha ao enviar o arquivo.')
  return { key: presign.key, kind: presign.kind }
}

/**
 * Anexo do certificado de curso EXTERNO (Documento 4, seção 9.8).
 *
 * Aceita imagem **ou** PDF, como a reivindicação de selo — o formulário pede
 * "uma foto visível do seu certificado", e nem todo mundo tem o PDF. Devolve a
 * CHAVE, não uma URL: o documento é pessoal, e quem o lê recebe uma URL
 * assinada e temporária, emitida pela API.
 */
/**
 * Material ou apresentação da trilha Eu Aprendiz. Só o facilitador chega aqui —
 * a rota de presign é do bloco de Gente e Gestão.
 */
export async function uploadApprenticeMaterial(
  file: File,
): Promise<{ key: string; fileName: string; contentType: string; sizeBytes: number }> {
  // Não usa `validateDocumentFile`, que só aceita PDF: aqui entram slides,
  // planilha e imagem — é o que a G&G leva para o encontro. O teto por tipo é o
  // mesmo do anexo do feed, e o servidor revalida.
  const kind = mediaKindFor(file.type)
  if (!kind) throw new UploadError('Formato não suportado.')
  if (file.size > mediaMaxBytesFor(kind)) throw new UploadError(mediaTooLargeMessage(kind))
  const presign = await apiFetch<{ uploadUrl: string; key: string }>(
    '/uploads/apprentice-material/presign',
    { method: 'POST', body: JSON.stringify({ contentType: file.type, size: file.size }) },
  )
  const put = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  })
  if (!put.ok) throw new UploadError('Falha ao enviar o arquivo.', true)
  return { key: presign.key, fileName: file.name, contentType: file.type, sizeBytes: file.size }
}

export async function uploadCertificateAttachment(file: File): Promise<{ key: string; name: string }> {
  const kind = mediaKindFor(file.type)
  if (kind !== 'IMAGE' && file.type !== 'application/pdf') {
    throw new UploadError('Formato não suportado. Envie uma imagem ou um PDF.')
  }
  const anexo = kind === 'IMAGE' ? await optimizeImageForUpload(file) : file
  if (anexo.size > mediaMaxBytesFor(kind ?? 'DOCUMENT')) {
    throw new UploadError(mediaTooLargeMessage(kind ?? 'DOCUMENT'))
  }

  const presign = await apiFetch<{ uploadUrl: string; key: string }>('/uploads/certificate-request/presign', {
    method: 'POST',
    body: JSON.stringify({ contentType: anexo.type, size: anexo.size }),
  })
  const put = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': anexo.type },
    body: anexo,
  })
  if (!put.ok) throw new UploadError('Falha ao enviar o certificado.')
  return { key: presign.key, name: file.name }
}

export async function uploadChallengeEvidence(file: File): Promise<UploadedDocument> {
  validateDocumentFile(file)
  const presign = await apiFetch<PresignDocumentUploadResponse>('/uploads/challenge-evidence/presign', {
    method: 'POST',
    body: JSON.stringify({ contentType: file.type, size: file.size }),
  })
  const put = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  })
  if (!put.ok) throw new UploadError('Falha ao enviar o arquivo.')
  return { key: presign.key, fileName: file.name, fileSize: file.size }
}

/**
 * Fluxo da foto de álbum de evento: valida → dimensões → presign → PUT no S3.
 * Devolve a CHAVE (mais as dimensões lidas no browser), não uma URL: quem resolve
 * a URL pública é a API, no serialize, a partir da chave confirmada no álbum.
 */
export async function uploadEventPhoto(file: File): Promise<EventPhotoInput> {
  // Álbum de evento é o caso extremo: dezenas de fotos direto da câmera. As
  // dimensões gravadas são as da imagem OTIMIZADA — é ela que está no bucket.
  const otimizada = await optimizeImageForUpload(file)
  validateImageFile(otimizada)
  const { width, height } = await readImageDimensions(otimizada)
  const presign = await apiFetch<{ uploadUrl: string; key: string }>('/uploads/event-photos/presign', {
    method: 'POST',
    body: JSON.stringify({ contentType: otimizada.type, size: otimizada.size }),
  })
  // PUT direto no S3 (fetch cru, fora do apiFetch): sem Authorization.
  const put = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': otimizada.type },
    body: otimizada,
  })
  if (!put.ok) throw new UploadError('Falha ao enviar a foto.', true)
  return { storageKey: presign.key, width, height }
}

/**
 * Sobe uma peça do kit visual e devolve a chave no S3 mais o nome do arquivo
 * original, que vira o nome sugerido no download. Sem dimensões (diferente da
 * foto de evento): o card do kit tem altura fixa, e o que decide o
 * enquadramento é o `fit` escolhido por quem publica, não o tamanho do arquivo.
 */
export async function uploadVisualAsset(file: File): Promise<{ storageKey: string; fileName: string }> {
  validateImageFile(file)
  const presign = await apiFetch<{ uploadUrl: string; key: string }>('/uploads/visual-assets/presign', {
    method: 'POST',
    body: JSON.stringify({ contentType: file.type, size: file.size }),
  })
  // PUT direto no S3 (fetch cru, fora do apiFetch): sem Authorization.
  const put = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  })
  if (!put.ok) throw new UploadError('Falha ao enviar a imagem.')
  return { storageKey: presign.key, fileName: file.name }
}

/**
 * Sobe um material PESSOAL do kit. Diferente das outras: o destinatário viaja
 * no presign porque a chave é namespaced por pessoa — é isso que permite ao
 * servidor provar, na hora de gravar, que o arquivo foi enviado para quem o
 * material diz. Aceita imagem ou PDF, e é o servidor que decide o `kind`.
 */
export async function uploadPersonalAsset(
  file: File,
  recipientId: string,
): Promise<{ storageKey: string; fileName: string; fileSize: number; kind: 'IMAGE' | 'DOCUMENT' }> {
  const imagem = isAllowedImageContentType(file.type)
  if (!imagem && !isAllowedDocumentContentType(file.type)) {
    throw new UploadError('Formato não suportado. Envie uma imagem ou um PDF.')
  }
  if (imagem && file.size > IMAGE_MAX_BYTES) throw new UploadError('Imagem muito grande (máx. 10MB).')
  if (!imagem && file.size > DOCUMENT_MAX_BYTES) throw new UploadError('Arquivo muito grande (máx. 20MB).')

  const presign = await apiFetch<{ uploadUrl: string; key: string; kind: 'IMAGE' | 'DOCUMENT' }>(
    '/uploads/personal-assets/presign',
    { method: 'POST', body: JSON.stringify({ contentType: file.type, size: file.size, recipientId }) },
  )
  // PUT direto no S3 (fetch cru, fora do apiFetch): sem Authorization.
  const put = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  })
  if (!put.ok) throw new UploadError('Falha ao enviar o arquivo.')
  return { storageKey: presign.key, fileName: file.name, fileSize: file.size, kind: presign.kind }
}

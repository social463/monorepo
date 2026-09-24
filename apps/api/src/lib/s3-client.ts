import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'node:crypto'
import type { AllowedImageContentType, AllowedLogoContentType } from '@legends/shared'

export interface S3Config {
  bucket: string
  region: string
  publicBaseUrl: string
}

/** Config do S3 lida do ambiente, ou null se incompleta. */
export function s3Config(env: NodeJS.ProcessEnv = process.env): S3Config | null {
  const bucket = env.S3_BUCKET
  const region = env.S3_REGION
  const publicBaseUrl = env.S3_PUBLIC_BASE_URL
  if (!bucket || !region || !publicBaseUrl) return null
  return { bucket, region, publicBaseUrl: publicBaseUrl.replace(/\/+$/, '') }
}

/** O upload de imagens está habilitado? (controla o recurso no front) */
export function imageUploadsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return s3Config(env) !== null
}

const EXT_BY_TYPE: Record<AllowedImageContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/** Chave do objeto: reviews/<userId>/<uuid>.<ext>. */
/**
 * Chave da logo de uma empresa: `branding/<companyId>/<uuid>.<ext>`.
 *
 * Prefixo próprio, e por EMPRESA — não por usuário. A logo pertence ao cliente,
 * não a quem fez o upload (que é o super admin, de outra empresa). Usar o
 * `buildImageKey` genérico jogaria a arte da EMR em `reviews/<id do super
 * admin>/`, que é errado nos dois eixos.
 */
export function buildBrandingLogoKey(
  companyId: string,
  contentType: AllowedLogoContentType,
  id: string = randomUUID(),
): string {
  return `branding/${companyId}/${id}.${LOGO_EXT_BY_TYPE[contentType]}`
}

const LOGO_EXT_BY_TYPE: Record<AllowedLogoContentType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
}

export function buildImageKey(
  userId: string,
  contentType: AllowedImageContentType,
  id: string = randomUUID(),
): string {
  return `reviews/${userId}/${id}.${EXT_BY_TYPE[contentType]}`
}

/** URL pública final do objeto (bucket público / CDN). */
export function publicUrlFor(key: string, cfg: S3Config): string {
  return `${cfg.publicBaseUrl}/${key}`
}

let client: S3Client | null = null
function getClient(region: string): S3Client {
  if (!client) client = new S3Client({ region })
  return client
}

/** Gera uma URL pré-assinada de PUT (expira em 60s). */
export async function presignImageUpload(input: { key: string; contentType: string }): Promise<string> {
  const cfg = s3Config()
  if (!cfg) throw new Error('S3 não configurado')
  const command = new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: input.key,
    ContentType: input.contentType,
  })
  return getSignedUrl(getClient(cfg.region), command, { expiresIn: 60 })
}

/**
 * Chave da evidência de uma ação de PDI: pdi-evidences/<companyId>/<uuid>.<ext>.
 * Prefixo próprio e fora da base pública — evidência de PDI é dado sensível e o
 * download só sai por URL assinada, depois que o service conferiu quem pode ler.
 */
export function buildPdiEvidenceKey(companyId: string, extension: string, id: string = randomUUID()): string {
  const suffix = extension.replace(/[^a-z0-9]/gi, '').toLowerCase()
  return `pdi-evidences/${companyId}/${id}${suffix ? `.${suffix}` : ''}`
}

export async function putS3Object(input: { key: string; contentType: string; body: Buffer }): Promise<string> {
  const cfg = s3Config()
  if (!cfg) throw new Error('S3 não configurado')
  await getClient(cfg.region).send(new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: input.key,
    ContentType: input.contentType,
    Body: input.body,
  }))
  return publicUrlFor(input.key, cfg)
}

/**
 * Chave do PDF de um manual interno: manuals/<companyId>/<uuid>.pdf.
 * Prefixo separado das imagens de propósito — manual interno não deve ser
 * servido pela base pública; o download passa pela rota autenticada.
 */
export function buildDocumentKey(companyId: string, id: string = randomUUID()): string {
  return `manuals/${companyId}/${id}.pdf`
}

/**
 * Chave da evidência de participação num desafio: challenges/<userId>/<uuid>.pdf.
 * Namespaced por USUÁRIO (não companyId, como buildDocumentKey) de propósito: é
 * esse prefixo que challenge-service.ts confere no submit para garantir que
 * ninguém aponte evidenceKey para o objeto de outra pessoa.
 */
export function buildChallengeEvidenceKey(userId: string, id: string = randomUUID()): string {
  return `challenges/${userId}/${id}.pdf`
}

/**
 * Chave da comprovação de uma reivindicação de selo:
 * `badge-claims/<userId>/<uuid>.<ext>` (Documento 4, seção 11.2).
 *
 * Namespaced por USUÁRIO, como a evidência de desafio e pelo mesmo motivo: é
 * esse prefixo que o service confere no envio, para ninguém apontar o anexo
 * para o objeto de outra pessoa.
 *
 * Aceita imagem **ou** PDF, que é o que o documento pede — daí a extensão sair
 * do content-type em vez de ser fixa como em `buildChallengeEvidenceKey`.
 */
export function buildBadgeClaimKey(
  userId: string,
  contentType: string,
  id: string = randomUUID(),
): string {
  // `MEDIA_EXT_BY_TYPE` já é imagem + PDF + Office; é declarado mais abaixo no
  // arquivo, e só é lido na chamada — não na avaliação do módulo.
  return `badge-claims/${userId}/${id}.${MEDIA_EXT_BY_TYPE[contentType] ?? 'bin'}`
}

/**
 * Prefixo do anexo de certificado externo. Exportado porque o service confere o
 * início da chave antes de gravar: sem isso, alguém poderia mandar a chave do
 * documento de outra pessoa e anexá-lo ao próprio pedido.
 */
export const CERTIFICATE_ATTACHMENT_PREFIX = 'certificate-requests'

/**
 * Prefixo do material da trilha Eu Aprendiz. Exportado para o service conferir
 * o início da chave antes de gravar, como o anexo de certificado.
 */
export const APPRENTICE_MATERIAL_PREFIX = 'apprentice-materials'

/**
 * Chave de material/apresentação do encontro: apprentice-materials/<companyId>/<uuid>.<ext>.
 *
 * Namespaced pela EMPRESA, e não pela pessoa: o material é do encontro e a
 * turma inteira lê. Quem sobe é o facilitador, e a rota já é do bloco de Gente
 * e Gestão — o recorte que importa aqui é o tenant.
 */
export function buildApprenticeMaterialKey(
  companyId: string,
  contentType: string,
  id: string = randomUUID(),
): string {
  return `${APPRENTICE_MATERIAL_PREFIX}/${companyId}/${id}.${MEDIA_EXT_BY_TYPE[contentType] ?? 'bin'}`
}

/**
 * Chave do certificado de curso EXTERNO anexado pelo colaborador (Documento 4,
 * seção 9.8): certificate-requests/<userId>/<uuid>.<ext>.
 *
 * Namespaced pela pessoa, como `badge-claims/` e `challenges/`, e aceitando
 * imagem OU PDF — é o que o formulário pede ("anexe uma foto visível do seu
 * certificado"). A chave nasce no servidor; o cliente nunca escolhe onde grava.
 */
export function buildCertificateAttachmentKey(
  userId: string,
  contentType: string,
  id: string = randomUUID(),
): string {
  return `${CERTIFICATE_ATTACHMENT_PREFIX}/${userId}/${id}.${MEDIA_EXT_BY_TYPE[contentType] ?? 'bin'}`
}

/**
 * Chave da foto de um álbum de evento: event-photos/<companyId>/<uuid>.<ext>.
 * Prefixo próprio (não `reviews/`) e namespaced por empresa. A chave nasce SEMPRE
 * no servidor — o cliente nunca escolhe onde a foto é gravada.
 */
export function buildEventPhotoKey(
  companyId: string,
  contentType: AllowedImageContentType,
  id: string = randomUUID(),
): string {
  return `event-photos/${companyId}/${id}.${EXT_BY_TYPE[contentType]}`
}

/**
 * Chave de uma peça do kit visual: visual-assets/<companyId>/<uuid>.<ext>.
 * Prefixo próprio e namespaced por empresa, como a foto de evento — e público
 * de propósito, ao contrário de `manuals/`: a peça existe para ser distribuída,
 * e o card precisa exibir a imagem sem uma ida extra ao servidor por link
 * assinado. A chave nasce SEMPRE aqui; o cliente nunca escolhe onde gravar.
 */
export function buildVisualAssetKey(
  companyId: string,
  contentType: AllowedImageContentType,
  id: string = randomUUID(),
): string {
  return `visual-assets/${companyId}/${id}.${EXT_BY_TYPE[contentType]}`
}

/**
 * Chave de um material pessoal do kit:
 * `personal-assets/<companyId>/<recipientId>/<uuid>.<ext>`.
 *
 * Prefixo **privado**, ao contrário de `visual-assets/`: o material é de uma
 * pessoa, e o acesso passa sempre por link assinado emitido depois de conferir
 * quem está pedindo. Namespaced pelo destinatário para que o service consiga
 * provar, na hora de gravar, que a chave foi emitida para aquela pessoa — sem
 * isso um POST direto anexaria à Ana um objeto enviado para o Bruno.
 *
 * `ext` vem do content-type: imagem usa a tabela de imagens, documento é PDF.
 */
export function buildPersonalAssetKey(
  companyId: string,
  recipientId: string,
  contentType: string,
  id: string = randomUUID(),
): string {
  const ext = EXT_BY_TYPE[contentType as AllowedImageContentType] ?? 'pdf'
  return `personal-assets/${companyId}/${recipientId}/${id}.${ext}`
}

/**
 * Chave de um anexo do Feed Corporativo:
 * `feed-media/<companyId>/<userId>/<uuid>.<ext>`.
 *
 * Prefixo **público** (o comunicado exibe a foto e toca o vídeo direto no card,
 * como `visual-assets/`) e namespaced pela empresa e por quem enviou. A
 * extensão sai do content-type, que a rota já validou contra a allowlist de
 * mídia — o cliente nunca escolhe onde nem com que nome o objeto é gravado.
 */
export function buildFeedMediaKey(
  companyId: string,
  userId: string,
  contentType: string,
  id: string = randomUUID(),
): string {
  return `feed-media/${companyId}/${userId}/${id}.${MEDIA_EXT_BY_TYPE[contentType] ?? 'bin'}`
}

/**
 * Chave de evidência do diário de bordo do INOVA:
 * `inova-diary/<companyId>/<userId>/<uuid>.<ext>`. Mesmo critério de
 * `buildFeedMediaKey` (extensão pelo content-type, nunca escolhida pelo
 * cliente), namespaced por empresa E por usuário — evidência é do autor do
 * registro, dentro da empresa que só a EMR usa hoje.
 */
export function buildInovaDiaryKey(companyId: string, userId: string, contentType: string): string {
  return `inova-diary/${companyId}/${userId}/${randomUUID()}.${MEDIA_EXT_BY_TYPE[contentType] ?? 'bin'}`
}

const MEDIA_EXT_BY_TYPE: Record<string, string> = {
  ...EXT_BY_TYPE,
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
}

/** URL pré-assinada de PUT para o documento (expira em 60s). */
export async function presignDocumentUpload(input: { key: string; contentType: string }): Promise<string> {
  const cfg = s3Config()
  if (!cfg) throw new Error('S3 não configurado')
  const command = new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: input.key,
    ContentType: input.contentType,
  })
  return getSignedUrl(getClient(cfg.region), command, { expiresIn: 60 })
}

/**
 * URL pré-assinada de GET para baixar o documento (expira em 5 min). Só é
 * emitida depois que a rota conferiu sessão e feature do usuário.
 */
export async function presignDocumentDownload(input: {
  key: string
  fileName?: string | null
}): Promise<string> {
  const cfg = s3Config()
  if (!cfg) throw new Error('S3 não configurado')
  const command = new GetObjectCommand({
    Bucket: cfg.bucket,
    Key: input.key,
    ...(input.fileName
      ? { ResponseContentDisposition: `attachment; filename="${input.fileName.replace(/"/g, '')}"` }
      : {}),
  })
  return getSignedUrl(getClient(cfg.region), command, { expiresIn: 300 })
}

/**
 * Chave de um vídeo enviado para a biblioteca do Guia AI First:
 * `inova-guia-videos/<companyId>/<uuid>.<ext>`. Só por empresa (não por
 * usuário): o vídeo é do card, não de quem subiu — qualquer admin pode
 * substituir o de outro depois.
 */
export function buildInovaGuiaVideoKey(companyId: string, contentType: string): string {
  return `inova-guia-videos/${companyId}/${randomUUID()}.${MEDIA_EXT_BY_TYPE[contentType] ?? 'bin'}`
}

export async function deleteS3Object(key: string): Promise<void> {
  const cfg = s3Config()
  if (!cfg) throw new Error('S3 não configurado')
  await getClient(cfg.region).send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }))
}

/**
 * Contrato de certificado com modelo visual configurável e fila de aprovação.
 *
 * A emissão em si continua sendo a existente (`CertificateDTO`, em
 * `learning.ts`): curso com `requiresCertificateApproval` cria uma
 * `CertificateRequest` PENDING em vez de emitir na hora; G&G aprova ou
 * recusa aqui.
 */

import type { CertificateDTO } from './learning'

export const CERTIFICATE_REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const
export type CertificateRequestStatus = (typeof CERTIFICATE_REQUEST_STATUSES)[number]

export const CERTIFICATE_REQUEST_STATUS_LABELS: Record<CertificateRequestStatus, string> = {
  PENDING: 'Pendente',
  APPROVED: 'Aprovado',
  REJECTED: 'Recusado',
}

/**
 * De onde a solicitação veio (Documento 4, seção 9.8).
 *
 * `INTERNAL` é o certificado que o portal emite ao concluir um curso daqui e
 * que passa por fila quando o curso pede aprovação. `EXTERNAL` é o certificado
 * de um curso feito FORA — o que até então entrava por um formulário do Notion,
 * fora do portal.
 *
 * Uma origem, e não duas entidades: é a mesma fila, a mesma aprovação e o mesmo
 * histórico. Coluna explícita, e não derivada de `courseId IS NULL`, porque
 * origem é o que a fila filtra e o que a tela rotula — esconder a regra num
 * `where` seria pedir para ela divergir.
 */
export const CERTIFICATE_REQUEST_ORIGINS = ['INTERNAL', 'EXTERNAL'] as const
export type CertificateRequestOrigin = (typeof CERTIFICATE_REQUEST_ORIGINS)[number]

export const CERTIFICATE_REQUEST_ORIGIN_LABELS: Record<CertificateRequestOrigin, string> = {
  INTERNAL: 'Curso do portal',
  EXTERNAL: 'Curso externo',
}

/**
 * O vocabulário de treinamento (tipo, patrocinador, motivos) mudou de casa: ele
 * agora é de `training.ts`, com o nome certo (`TRAINING_TYPES`,
 * `TRAINING_SPONSORS`, `TRAINING_REASONS`). O envio de certificado externo virou
 * registro de treinamento — ver
 * `docs/superpowers/specs/2026-09-12-modulo-de-treinamentos-td-design.md`.
 */

export const CERTIFICATE_TEMPLATE_NAME_MAX_LENGTH = 80
export const CERTIFICATE_TEMPLATE_TITLE_MAX_LENGTH = 160
export const CERTIFICATE_REJECTION_REASON_MAX_LENGTH = 500

/** Modelo visual de certificado: cores, assinatura e logo. Documento de ADMIN. */
export interface CertificateTemplateDTO {
  id: string
  name: string
  title: string
  backgroundUrl: string | null
  /**
   * Nulos = **herdam a marca da empresa** (cor institucional e logo do
   * branding). A identidade do certificado era mantida à parte da do portal, e
   * manter a mesma coisa em dois lugares é o que faz uma envelhecer enquanto a
   * outra muda. Preenchidos, continuam mandando: a marca é o padrão, o modelo é
   * a exceção.
   */
  accentColor: string | null
  signatureName: string
  signatureRole: string
  /** A assinatura fica FORA da herança: ela é da pessoa, não da marca. */
  signatureImageUrl: string | null
  logoUrl: string | null
  isDefault: boolean
  updatedAt: string
}

/** Referência enxuta a quem revisou a solicitação. */
export interface CertificateReviewerRef {
  id: string
  name: string
}

/** O que só o certificado de curso externo carrega. */
/** Uma linha da fila de aprovação do certificado emitido pelo portal. */
export interface CertificateRequestDTO {
  id: string
  origin: CertificateRequestOrigin
  enrollmentId: string | null
  courseId: string | null
  courseTitle: string | null
  userId: string
  userName: string
  status: CertificateRequestStatus
  reviewedBy: CertificateReviewerRef | null
  reviewedAt: string | null
  rejectionReason: string | null
  createdAt: string
}

export interface CreateCertificateTemplateRequest {
  name: string
  title: string
  backgroundUrl?: string | null
  /** Vazio = herda a cor institucional da empresa. */
  accentColor?: string | null
  signatureName: string
  signatureRole: string
  signatureImageUrl?: string | null
  logoUrl?: string | null
  isDefault?: boolean
}

export type UpdateCertificateTemplateRequest = Partial<CreateCertificateTemplateRequest>

/** Recusar exige motivo; aprovar não tem corpo — emite pelo caminho existente. */
export interface RejectCertificateRequestRequest {
  rejectionReason: string
}

// ---------------------------------------------------------------------------
// Respostas das rotas admin (`admin-certificates.ts`)
// ---------------------------------------------------------------------------

export interface CertificateTemplateListResponse {
  templates: CertificateTemplateDTO[]
}

export interface CertificateTemplateResponse {
  template: CertificateTemplateDTO
}

export interface CertificateRequestListResponse {
  requests: CertificateRequestDTO[]
}

/**
 * Aprovar emite pelo caminho existente — a resposta traz o certificado junto.
 *
 * `null` no externo, e de propósito: o certificado é documento de outra
 * instituição, já emitido por ela. O portal valida que conta para o
 * desenvolvimento da pessoa; não cunha um código nem se diz emissor de algo que
 * não emitiu. É também o que mantém a promessa da tela de Cursos — lá só
 * aparece o que a EMR emitiu.
 */
export interface ApproveCertificateRequestResponse {
  request: CertificateRequestDTO
  certificate: CertificateDTO | null
}

export interface RejectCertificateRequestResponse {
  request: CertificateRequestDTO
}

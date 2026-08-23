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

export const CERTIFICATE_TEMPLATE_NAME_MAX_LENGTH = 80
export const CERTIFICATE_TEMPLATE_TITLE_MAX_LENGTH = 160
export const CERTIFICATE_REJECTION_REASON_MAX_LENGTH = 500

/** Modelo visual de certificado: cores, assinatura e logo. Documento de ADMIN. */
export interface CertificateTemplateDTO {
  id: string
  name: string
  title: string
  backgroundUrl: string | null
  accentColor: string
  signatureName: string
  signatureRole: string
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

/** Uma linha da fila de aprovação de certificado. */
export interface CertificateRequestDTO {
  id: string
  enrollmentId: string
  courseId: string
  courseTitle: string
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
  accentColor: string
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

/** Aprovar emite pelo caminho existente — a resposta traz o certificado junto. */
export interface ApproveCertificateRequestResponse {
  request: CertificateRequestDTO
  certificate: CertificateDTO
}

export interface RejectCertificateRequestResponse {
  request: CertificateRequestDTO
}

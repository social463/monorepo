import type {
  BrandContrastIssue,
  BrandLogoSet,
  BrandOverrides,
  BrandPalette,
  BrandScheme,
  BrandingDTO,
} from '@legends/shared'
import { LOGO_MAX_BYTES, isAllowedLogoContentType } from '@legends/shared'
import { apiFetch } from './api'
import { UploadError } from './upload'

export interface BrandingSettingsDTO extends BrandingDTO {
  overrides: BrandOverrides
  configured: boolean
  /** Por esquema: uma paleta pode passar no claro e reprovar no escuro. */
  contrastIssues: Record<BrandScheme, BrandContrastIssue[]>
}

export interface UpdateBrandingBody {
  appName: string
  tagline: string | null
  hosts: string[]
  logos: BrandLogoSet
  defaultScheme: BrandScheme
  allowUserScheme: boolean
  brandColor: string
  neutralColor: string | null
  overrides?: BrandOverrides
}

/**
 * Marca é coisa do fornecedor: as rotas vivem sob `/super-admin`, com a empresa
 * na URL. O ADMIN do cliente não tem acesso.
 */
export function getBrandingSettings(companyId: string) {
  return apiFetch<BrandingSettingsDTO>(`/super-admin/companies/${companyId}/branding`)
}

export function updateBranding(companyId: string, body: UpdateBrandingBody) {
  return apiFetch<BrandingSettingsDTO>(`/super-admin/companies/${companyId}/branding`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

/**
 * Prévia das duas paletas sem gravar. Vem do servidor, e não de uma derivação
 * local, para que o que o admin vê seja exatamente o que vai ser resolvido —
 * duas implementações da mesma fórmula divergem no primeiro arredondamento.
 */
export function previewBranding(body: {
  brandColor: string
  neutralColor: string | null
  overrides?: BrandOverrides
}) {
  return apiFetch<{
    schemes: Record<BrandScheme, BrandPalette>
    contrastIssues: Record<BrandScheme, BrandContrastIssue[]>
  }>('/super-admin/branding/preview', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

/**
 * Sobe a logo de uma empresa. Não reaproveita `uploadImage` de propósito: a
 * chave no S3 precisa ser da EMPRESA (`branding/<companyId>/…`), e não de quem
 * está subindo — que aqui é o super admin, de outra empresa. E aceita SVG, que
 * os demais uploads não aceitam.
 */
export async function uploadBrandingLogo(companyId: string, file: File): Promise<string> {
  if (!isAllowedLogoContentType(file.type)) {
    throw new UploadError('Formato não suportado. Use SVG, PNG, WebP, JPEG ou GIF.')
  }
  if (file.size > LOGO_MAX_BYTES) {
    throw new UploadError('Logo muito grande (máx. 2MB).')
  }
  const presign = await apiFetch<{ uploadUrl: string; publicUrl: string }>(
    `/super-admin/companies/${companyId}/branding/logo-presign`,
    { method: 'POST', body: JSON.stringify({ contentType: file.type, size: file.size }) },
  )
  // PUT direto no S3 (fetch cru, fora do apiFetch): sem Authorization.
  const put = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  })
  if (!put.ok) throw new UploadError('Falha ao enviar a logo.')
  return presign.publicUrl
}

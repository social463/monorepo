import type { BadgeImportPreviewDTO, BadgeImportResultDTO } from '@legends/shared'
import { apiFetch, apiFetchBlob } from './api'

/**
 * Cliente da planilha de selos (Documento 4, seção 11.5).
 *
 * O upload vai como `FormData` e o `apiFetch` já sabe lidar com isso: ele só
 * injeta `Content-Type: application/json` quando o corpo não é `FormData`,
 * deixando o navegador escrever o boundary.
 */

export function downloadBadgeImportTemplate(): Promise<{ blob: Blob; filename: string | null }> {
  return apiFetchBlob('/admin/badges/import/template')
}

/** Export com as MESMAS colunas do template — é o que fecha o ciclo. */
export function downloadBadgesExport(): Promise<{ blob: Blob; filename: string | null }> {
  return apiFetchBlob('/admin/badges/export')
}

function body(file: File): FormData {
  const form = new FormData()
  form.append('file', file)
  return form
}

export function previewBadgeImport(file: File): Promise<BadgeImportPreviewDTO> {
  return apiFetch<BadgeImportPreviewDTO>('/admin/badges/import/preview', { method: 'POST', body: body(file) })
}

/**
 * Reenvia o **mesmo arquivo**, não as linhas revisadas: o servidor revalida do
 * zero, então nada que o cliente monte entra no banco sem passar pelas mesmas
 * regras. O `fileHash` só garante que é o arquivo que a pessoa acabou de ver.
 */
export function commitBadgeImport(file: File, fileHash: string): Promise<BadgeImportResultDTO> {
  return apiFetch<BadgeImportResultDTO>(
    `/admin/badges/import/commit?fileHash=${encodeURIComponent(fileHash)}`,
    { method: 'POST', body: body(file) },
  )
}

import type { CalendarImportPreviewDTO, CalendarImportResultDTO } from '@legends/shared'
import { apiFetch, apiFetchBlob } from './api'

/**
 * Cliente da importação de eventos do calendário por planilha.
 *
 * O upload vai como `FormData` e o `apiFetch` já sabe lidar com isso: ele só
 * injeta `Content-Type: application/json` quando o corpo não é `FormData`,
 * deixando o navegador escrever o boundary.
 */

export function downloadCalendarImportTemplate(): Promise<{ blob: Blob; filename: string | null }> {
  return apiFetchBlob('/admin/calendar-events/import/template')
}

function body(file: File): FormData {
  const form = new FormData()
  form.append('file', file)
  return form
}

export function previewCalendarImport(file: File): Promise<CalendarImportPreviewDTO> {
  return apiFetch<CalendarImportPreviewDTO>('/admin/calendar-events/import/preview', {
    method: 'POST',
    body: body(file),
  })
}

/**
 * Reenvia o **mesmo arquivo**, não as linhas revisadas: o servidor revalida do
 * zero, então nada que o cliente monte entra no banco sem passar pelas mesmas
 * regras. O `fileHash` só garante que é o arquivo que a pessoa acabou de ver.
 */
export function commitCalendarImport(file: File, fileHash: string): Promise<CalendarImportResultDTO> {
  return apiFetch<CalendarImportResultDTO>(
    `/admin/calendar-events/import/commit?fileHash=${encodeURIComponent(fileHash)}`,
    { method: 'POST', body: body(file) },
  )
}

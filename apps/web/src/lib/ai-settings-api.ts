import type { AiSettingsDTO, UpdateAiSettingsRequest } from '@legends/shared'
import { apiFetch } from './api'

/**
 * A resposta traz só o provedor, `configured`, o modelo e a URL — a chave nunca
 * volta da API, nem mascarada. Não existe `getAiApiKey` de propósito.
 */
export function getAiSettings() {
  return apiFetch<AiSettingsDTO>('/admin/ai-settings')
}

export function updateAiSettings(body: UpdateAiSettingsRequest) {
  return apiFetch<AiSettingsDTO>('/admin/ai-settings', {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

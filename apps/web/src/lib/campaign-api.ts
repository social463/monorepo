import type {
  CampaignBandDTO,
  CampaignCalendarContextDTO,
  CampaignDraftDTO,
  CampaignPostDTO,
  ConfirmCampaignRequest,
  CreateCampaignPostRequest,
  GenerateCampaignRequest,
  ScheduledFeedPostDTO,
  UpdateCampaignPostRequest,
} from '@legends/shared'
import { apiFetch } from './api'

export function previewCampaign(body: GenerateCampaignRequest): Promise<{ drafts: CampaignDraftDTO[] }> {
  return apiFetch('/admin/campaigns/preview', { method: 'POST', body: JSON.stringify(body) })
}

export function confirmCampaign(body: ConfirmCampaignRequest): Promise<{ posts: CampaignPostDTO[] }> {
  return apiFetch('/admin/campaigns', { method: 'POST', body: JSON.stringify(body) })
}

export function listCampaignPosts(
  from: string,
  to: string,
): Promise<{ posts: CampaignPostDTO[]; campaigns: CampaignBandDTO[] }> {
  const params = new URLSearchParams({ from, to })
  return apiFetch(`/admin/campaigns/posts?${params.toString()}`)
}

/** Os agendados do Feed Corporativo que caem na mesma janela do calendário. */
export function listScheduledFeedPosts(
  from: string,
  to: string,
): Promise<{ posts: ScheduledFeedPostDTO[] }> {
  const params = new URLSearchParams({ from, to })
  return apiFetch(`/admin/campaigns/feed-posts?${params.toString()}`)
}

export function createCampaignPost(body: CreateCampaignPostRequest): Promise<{ post: CampaignPostDTO }> {
  return apiFetch('/admin/campaigns/posts', { method: 'POST', body: JSON.stringify(body) })
}

export function updateCampaignPost(
  id: string,
  body: UpdateCampaignPostRequest,
): Promise<{ post: CampaignPostDTO }> {
  return apiFetch(`/admin/campaigns/posts/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function publishCampaignPost(id: string): Promise<{ post: CampaignPostDTO }> {
  return apiFetch(`/admin/campaigns/posts/${id}/publish`, { method: 'POST' })
}

/** Cancela sem apagar: o item continua no calendário, riscado. */
export function cancelCampaignPost(id: string): Promise<{ post: CampaignPostDTO }> {
  return apiFetch(`/admin/campaigns/posts/${id}`, { method: 'DELETE' })
}

/** Apaga de vez. Rota própria — o DELETE simples acima é o cancelamento. */
export function deleteCampaignPost(id: string): Promise<void> {
  return apiFetch(`/admin/campaigns/posts/${id}/permanently`, { method: 'DELETE' })
}

/**
 * Contexto do calendário organizacional (eventos, aniversários e tempo de
 * casa) na janela pedida — `from`/`to` em `AAAA-MM-DD` (data civil, sem hora),
 * diferente do `from`/`to` ISO das outras funções deste arquivo.
 */
export function getCampaignCalendarContext(from: string, to: string): Promise<CampaignCalendarContextDTO> {
  const params = new URLSearchParams({ from, to })
  return apiFetch(`/admin/campaigns/calendar-context?${params.toString()}`)
}

import type {
  CampaignDraftDTO,
  CampaignPostDTO,
  ConfirmCampaignRequest,
  CreateCampaignPostRequest,
  GenerateCampaignRequest,
  UpdateCampaignPostRequest,
} from '@legends/shared'
import { apiFetch } from './api'

export function previewCampaign(body: GenerateCampaignRequest): Promise<{ drafts: CampaignDraftDTO[] }> {
  return apiFetch('/admin/campaigns/preview', { method: 'POST', body: JSON.stringify(body) })
}

export function confirmCampaign(body: ConfirmCampaignRequest): Promise<{ posts: CampaignPostDTO[] }> {
  return apiFetch('/admin/campaigns', { method: 'POST', body: JSON.stringify(body) })
}

export function listCampaignPosts(from: string, to: string): Promise<{ posts: CampaignPostDTO[] }> {
  const params = new URLSearchParams({ from, to })
  return apiFetch(`/admin/campaigns/posts?${params.toString()}`)
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

export function cancelCampaignPost(id: string): Promise<{ post: CampaignPostDTO }> {
  return apiFetch(`/admin/campaigns/posts/${id}`, { method: 'DELETE' })
}

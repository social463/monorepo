import type {
  CreateGlassReviewRequest,
  GlassOverviewResponse,
  GlassParseRequest,
  GlassParseResponse,
  GlassReviewDTO,
  GlassReviewListResponse,
  GlassStatus,
} from '@legends/shared'
import { apiFetch } from './api'

/** Interpreta o texto colado. Não grava nada — devolve rascunho para revisão. */
export function parseGlassReview(body: GlassParseRequest) {
  return apiFetch<GlassParseResponse>('/admin/glass/reviews/parse', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function createGlassReview(body: CreateGlassReviewRequest) {
  return apiFetch<{ review: GlassReviewDTO }>('/admin/glass/reviews', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export function getGlassOverview(params: { from?: string; to?: string; sector?: string } = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value)
  }
  const suffix = query.toString() ? `?${query}` : ''
  return apiFetch<GlassOverviewResponse>(`/admin/glass/overview${suffix}`)
}

export function listGlassReviews(
  params: { sector?: string; status?: GlassStatus; withAlerts?: boolean } = {},
) {
  const query = new URLSearchParams()
  if (params.sector) query.set('sector', params.sector)
  if (params.status) query.set('status', params.status)
  if (params.withAlerts) query.set('withAlerts', 'true')
  const suffix = query.toString() ? `?${query}` : ''
  return apiFetch<GlassReviewListResponse>(`/admin/glass/reviews${suffix}`)
}

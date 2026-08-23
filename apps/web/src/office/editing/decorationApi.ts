import { apiFetch } from '../../lib/api'
import type {
  ActiveOfficeMapDTO,
  MapDocumentV1,
  OfficeDecorSaveResultDTO,
  OfficeMapDraftDTO,
  OfficeMapLockDTO,
} from '@legends/shared'

export function getDecorationDraft(): Promise<OfficeMapDraftDTO> {
  return apiFetch<OfficeMapDraftDTO>('/office/map/edit/draft')
}

export function acquireDecorationLock(): Promise<OfficeMapLockDTO> {
  return apiFetch<OfficeMapLockDTO>('/office/map/edit/lock', { method: 'POST' })
}

export function heartbeatDecorationLock(lockToken: string): Promise<{ expiresAt: string }> {
  return apiFetch<{ expiresAt: string }>('/office/map/edit/lock/heartbeat', {
    method: 'POST',
    headers: { 'x-map-lock-token': lockToken },
  })
}

export function releaseDecorationLock(lockToken: string): Promise<void> {
  return apiFetch<void>('/office/map/edit/lock', {
    method: 'DELETE',
    headers: { 'x-map-lock-token': lockToken },
  })
}

export function saveDecorationDraft(input: {
  revision: number
  document: MapDocumentV1
  lockToken: string
}): Promise<{ revision: number; savedAt: string; validationSummary: { valid: boolean; errorCount: number } }> {
  return apiFetch<{ revision: number; savedAt: string; validationSummary: { valid: boolean; errorCount: number } }>(
    '/office/map/edit/draft',
    {
      method: 'PUT',
      headers: { 'x-map-lock-token': input.lockToken },
      body: JSON.stringify({ revision: input.revision, document: input.document }),
    },
  )
}

export function publishDecoration(revision: number): Promise<{ activated: boolean }> {
  return apiFetch<{ activated: boolean }>('/office/map/edit/publish', {
    method: 'POST',
    body: JSON.stringify({ revision }),
  })
}

/**
 * Mapa ativo publicado (Task 9) — usado para semear a sessão de edição
 * colaborativa: `enter()` não adquire mais lock nem lê um draft exclusivo, só
 * pega o documento e a versão de publicação correntes.
 */
export function getActiveMapForEditing(): Promise<ActiveOfficeMapDTO> {
  return apiFetch<ActiveOfficeMapDTO>('/office/map')
}

/**
 * Mescla o documento de trabalho com o mapa ativo e grava o resultado num
 * único round-trip (Task 9) — substitui o par
 * `saveDecorationDraft`/`publishDecoration` do fluxo com lock exclusivo.
 *
 * `baseRevision` é o `decorRevision` em que o editor está ancorado; o servidor
 * usa a diferença para achar a base do merge de 3 vias (card 22041).
 *
 * `basePublicationId` diz em QUAL publicação essa revisão foi lida. Sem ele o
 * servidor não distingue "ancorado no mapa vivo" de "ancorado no mapa que o
 * admin acabou de substituir" — publicação nova nasce com `decorRevision` 0 e
 * a âncora bateria por coincidência numérica, fazendo este save reverter o
 * publish do admin.
 */
export function mergePublish(input: {
  baseRevision: number
  basePublicationId: string | null
  document: MapDocumentV1
}): Promise<OfficeDecorSaveResultDTO> {
  return apiFetch<OfficeDecorSaveResultDTO>('/office/map/edit/merge-publish', {
    method: 'POST',
    body: JSON.stringify({
      baseRevision: input.baseRevision,
      ...(input.basePublicationId ? { basePublicationId: input.basePublicationId } : {}),
      document: input.document,
    }),
  })
}

import type {
  CreateOfficeMeetingRequest,
  OfficeMeetingDTO,
  PublicUser,
  UpdateOfficeMeetingRequest,
} from '@legends/shared'
import { apiFetch, apiFetchBlob } from '../../lib/api'

/**
 * Usuários da empresa para o multi-select de convidados: convidar não depende
 * de a pessoa estar conectada ao escritório agora — nem de ela ser do seu
 * setor. `/users/company` (a mesma rota e a mesma query `['users','company']`
 * do TargetPicker do Mural) traz todo mundo com `sectorName` resolvido, que é
 * o que agrupa a lista por setor; `/users` puro devolveria só o próprio setor.
 * Terceirizado segue restrito ao setor dele — o recorte é da rota.
 */
export function fetchCompanyUsers(): Promise<{ users: PublicUser[] }> {
  return apiFetch('/users/company')
}

export function fetchRoomMeetings(roomExternalKey: string): Promise<OfficeMeetingDTO[]> {
  return apiFetch(`/office/meetings?room=${encodeURIComponent(roomExternalKey)}`)
}

export function createMeeting(body: CreateOfficeMeetingRequest): Promise<OfficeMeetingDTO> {
  return apiFetch('/office/meetings', { method: 'POST', body: JSON.stringify(body) })
}

export function updateMeeting(id: string, body: UpdateOfficeMeetingRequest): Promise<OfficeMeetingDTO> {
  return apiFetch(`/office/meetings/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
}

export function cancelMeeting(id: string): Promise<OfficeMeetingDTO> {
  return apiFetch(`/office/meetings/${id}`, { method: 'DELETE' })
}

/** Baixa o .ics e dispara o download no browser. */
export async function downloadMeetingIcs(meeting: OfficeMeetingDTO): Promise<void> {
  const { blob, filename } = await apiFetchBlob(meeting.icsPath)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename ?? 'reuniao.ics'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

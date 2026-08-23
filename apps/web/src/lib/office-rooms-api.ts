import type { OfficeRoomOptionDTO } from '@legends/shared'
import { apiFetch } from './api'

/** Salas do mapa ativo, para o seletor de "marcar reunião". */
export function fetchOfficeRooms(): Promise<{ rooms: OfficeRoomOptionDTO[] }> {
  return apiFetch('/office/rooms')
}

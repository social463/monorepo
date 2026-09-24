/**
 * Mídia do escritório: zonas (salas com isolamento acústico) e proximidade.
 * A sala LiveKit de cada pessoa deriva da posição server-autoritativa no
 * office-hub — a API usa `officeRoomAt` para autorizar tokens, o front usa
 * as mesmas funções para saber a que sala se conectar e quem assinar.
 */

/** Raio de proximidade no espaço aberto, em tiles (distância de Chebyshev). */
export const PROXIMITY_RADIUS = 3;

export interface OfficeZone {
  id: string;
  name: string;
  /** Retângulo inclusivo em coordenadas de tile. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Zonas por cima do OFFICE_MAP. Portas (16,12) e (16,15) ficam FORA das zonas. */
export const OFFICE_ZONES: readonly OfficeZone[] = [
  { id: "reuniao-1", name: "Sala de Reunião 1", x0: 17, y0: 11, x1: 23, y1: 12 },
  { id: "reuniao-2", name: "Sala de Reunião 2", x0: 17, y0: 14, x1: 23, y1: 16 },
  { id: "copa", name: "Copa", x0: 1, y0: 11, x1: 8, y1: 13 },
];

export function zoneAt(x: number, y: number): OfficeZone | null {
  for (const zone of OFFICE_ZONES) {
    if (x >= zone.x0 && x <= zone.x1 && y >= zone.y0 && y <= zone.y1) return zone;
  }
  return null;
}

export const OFFICE_OPEN_ROOM = "office-open";

export function officeRoomForZone(zoneId: string): string {
  return `office-zone-${zoneId}`;
}

/** Sala LiveKit correta para uma posição — a MESMA conta na API e no front. */
export function officeRoomAt(x: number, y: number): string {
  const zone = zoneAt(x, y);
  return zone ? officeRoomForZone(zone.id) : OFFICE_OPEN_ROOM;
}

/**
 * Alcance da voz, medido em TILES — ver o aviso de unidade em `mapZoneAtTile`.
 */
export function isWithinProximityTiles(ax: number, ay: number, bx: number, by: number): boolean {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by)) <= PROXIMITY_RADIUS;
}

export interface OfficeMediaTokenRequest {
  room: string;
}

export interface OfficeMediaTokenResponse {
  token: string;
  url: string;
}

/** Sala LiveKit do alto-falante — todos ouvem, só liderança publica. */
export const OFFICE_BROADCAST_ROOM = "office-broadcast";

/** Config do escritório lida pelo front ao montar a página. */
export interface OfficeConfigDTO {
  broadcastEnabled: boolean;
  activeMapPublicationId: string | null;
}

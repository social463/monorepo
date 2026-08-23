import { describe, it, expect } from 'vitest';
import {
  OFFICE_ZONES,
  OFFICE_WIDTH,
  OFFICE_HEIGHT,
  OFFICE_OPEN_ROOM,
  PROXIMITY_RADIUS,
  zoneAt,
  officeRoomAt,
  officeRoomForZone,
  isWithinProximity,
  isWalkable,
} from './index';

describe('zonas', () => {
  it('define exatamente reuniao-1, reuniao-2 e copa', () => {
    expect(OFFICE_ZONES.map((z) => z.id).sort()).toEqual(['copa', 'reuniao-1', 'reuniao-2']);
  });

  it('todas cabem dentro do mapa', () => {
    for (const zone of OFFICE_ZONES) {
      expect(zone.x0).toBeGreaterThanOrEqual(0);
      expect(zone.y0).toBeGreaterThanOrEqual(0);
      expect(zone.x1).toBeLessThan(OFFICE_WIDTH);
      expect(zone.y1).toBeLessThan(OFFICE_HEIGHT);
      expect(zone.x0).toBeLessThanOrEqual(zone.x1);
      expect(zone.y0).toBeLessThanOrEqual(zone.y1);
    }
  });

  it('não se sobrepõem', () => {
    for (const a of OFFICE_ZONES) {
      for (const b of OFFICE_ZONES) {
        if (a.id === b.id) continue;
        const overlapX = a.x0 <= b.x1 && b.x0 <= a.x1;
        const overlapY = a.y0 <= b.y1 && b.y0 <= a.y1;
        expect(overlapX && overlapY).toBe(false);
      }
    }
  });

  it('as portas das salas novas são andáveis e ficam FORA da zona', () => {
    for (const door of [{ x: 16, y: 12 }, { x: 16, y: 15 }]) {
      expect(isWalkable(door.x, door.y)).toBe(true);
      expect(zoneAt(door.x, door.y)).toBeNull();
    }
    // e o interior imediatamente após a porta pertence à sala
    expect(zoneAt(17, 12)?.id).toBe('reuniao-1');
    expect(zoneAt(17, 15)?.id).toBe('reuniao-2');
  });
});

describe('zoneAt / officeRoomAt', () => {
  it('dentro da zona (bordas inclusivas)', () => {
    const sala1 = OFFICE_ZONES.find((z) => z.id === 'reuniao-1')!;
    expect(zoneAt(sala1.x0, sala1.y0)?.id).toBe('reuniao-1');
    expect(zoneAt(sala1.x1, sala1.y1)?.id).toBe('reuniao-1');
  });

  it('fora de qualquer zona é espaço aberto', () => {
    expect(zoneAt(12, 14)).toBeNull(); // spawn
    expect(officeRoomAt(12, 14)).toBe(OFFICE_OPEN_ROOM);
  });

  it('dentro da zona a sala é office-zone-<id>', () => {
    expect(officeRoomAt(18, 15)).toBe('office-zone-reuniao-2');
    expect(officeRoomForZone('copa')).toBe('office-zone-copa');
  });
});

describe('isWithinProximity', () => {
  it('limiar exato de Chebyshev', () => {
    expect(isWithinProximity(5, 5, 5 + PROXIMITY_RADIUS, 5)).toBe(true);
    expect(isWithinProximity(5, 5, 5 + PROXIMITY_RADIUS + 1, 5)).toBe(false);
    expect(isWithinProximity(5, 5, 5 + PROXIMITY_RADIUS, 5 + PROXIMITY_RADIUS)).toBe(true);
  });

  it('é simétrica', () => {
    expect(isWithinProximity(2, 3, 5, 6)).toBe(isWithinProximity(5, 6, 2, 3));
  });
});

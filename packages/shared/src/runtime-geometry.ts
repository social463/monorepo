import type {
  CollisionObjectV1,
  MapDocumentV1,
  PointCoordinatesV1,
} from "./index";

export interface RuntimePosition {
  x: number;
  y: number;
}

function squaredDistanceToSegment(
  point: RuntimePosition,
  start: PointCoordinatesV1,
  end: PointCoordinatesV1,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return (point.x - start.x) ** 2 + (point.y - start.y) ** 2;
  }

  const progress = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) /
        (dx * dx + dy * dy),
    ),
  );
  const nearestX = start.x + progress * dx;
  const nearestY = start.y + progress * dy;
  return (point.x - nearestX) ** 2 + (point.y - nearestY) ** 2;
}

function pointInPolygon(
  point: RuntimePosition,
  points: PointCoordinatesV1[],
): boolean {
  let inside = false;
  for (
    let current = 0, previous = points.length - 1;
    current < points.length;
    previous = current, current += 1
  ) {
    const a = points[current]!;
    const b = points[previous]!;
    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function collidesWithObject(
  position: RuntimePosition,
  radius: number,
  collision: CollisionObjectV1,
): boolean {
  const geometry = collision.geometry;
  if (geometry.kind === "rectangle") {
    const nearestX = Math.max(
      geometry.x,
      Math.min(position.x, geometry.x + geometry.width),
    );
    const nearestY = Math.max(
      geometry.y,
      Math.min(position.y, geometry.y + geometry.height),
    );
    return (
      (position.x - nearestX) ** 2 + (position.y - nearestY) ** 2 < radius ** 2
    );
  }

  if (pointInPolygon(position, geometry.points)) return true;
  return geometry.points.some((point, index) => {
    const next = geometry.points[(index + 1) % geometry.points.length]!;
    return squaredDistanceToSegment(position, point, next) < radius ** 2;
  });
}

export function canOccupy(
  position: RuntimePosition,
  radius: number,
  collisions: readonly CollisionObjectV1[],
  mapWidth: number,
  mapHeight: number,
): boolean {
  if (
    position.x - radius < 0 ||
    position.y - radius < 0 ||
    position.x + radius > mapWidth ||
    position.y + radius > mapHeight
  ) {
    return false;
  }
  return !collisions.some((collision) =>
    collidesWithObject(position, radius, collision),
  );
}

export function moveWithCollisions(
  position: RuntimePosition,
  delta: RuntimePosition,
  radius: number,
  collisions: readonly CollisionObjectV1[],
  mapWidth: number,
  mapHeight: number,
): RuntimePosition {
  const distance = Math.max(Math.abs(delta.x), Math.abs(delta.y));
  const steps = Math.max(1, Math.ceil(distance / Math.max(1, radius / 2)));
  const stepX = delta.x / steps;
  const stepY = delta.y / steps;
  const next = { ...position };

  for (let step = 0; step < steps; step += 1) {
    const horizontal = { x: next.x + stepX, y: next.y };
    if (canOccupy(horizontal, radius, collisions, mapWidth, mapHeight)) {
      next.x = horizontal.x;
    }
    const vertical = { x: next.x, y: next.y + stepY };
    if (canOccupy(vertical, radius, collisions, mapWidth, mapHeight)) {
      next.y = vertical.y;
    }
  }

  return next;
}

export function runtimeSpawn(document: MapDocumentV1): RuntimePosition {
  const spawns = document.objects.filter(
    (object) => object.type === "spawn-point",
  );
  const spawn =
    spawns.find(({ properties }) => properties.isDefault) ?? spawns[0];
  return spawn
    ? { x: spawn.geometry.x, y: spawn.geometry.y }
    : {
        x: (document.map.width * document.map.tileWidth) / 2,
        y: (document.map.height * document.map.tileHeight) / 2,
      };
}


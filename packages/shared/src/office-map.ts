import { z } from "zod";

import { USER_ROLES } from "./enums";

export const MAP_DOCUMENT_V1_SCHEMA_VERSION = "1.0.0" as const;

export const MAP_DOCUMENT_V1_LIMITS = {
  minMapWidthCells: 10,
  maxMapWidthCells: 200,
  minMapHeightCells: 10,
  maxMapHeightCells: 200,
  maxMapCells: 200 * 200,
  tileSizes: [16, 32, 48, 64] as const,
  maxLayers: 50,
  // Um tileset por FOLHA de mobília de fato usada no mapa. A paleta do
  // escritório oferece 34 folhas (`office-asset-catalog.json`), então um teto
  // de 20 tornava as últimas inalcançáveis: o mapa ativo da EMR chegou a 20/20
  // e qualquer peça de uma folha nova reprovava o save inteiro com um
  // "Documento inválido" (400) que não dizia o motivo. 40 cobre a paleta
  // inteira com folga para assets importados pelo admin. Só entra no documento
  // a folha que tem peça viva — `pruneUnusedTilesets` remove as órfãs a cada
  // salvamento.
  maxTilesets: 40,
  // Teto de objetos do documento. Uma peça de mobília colocada custa ~5 (4
  // tile-objects, porque o asset é fatiado por tile, + a colisão pareada), e o
  // mapa ativo da EMR já gasta ~550 só com a estrutura fixa (131 mesas, 145
  // salas, colisões desenhadas). Com 2000 sobravam ~63 peças para o escritório
  // INTEIRO — meia peça por mesa, com 131 mesas abertas para quem senta nelas
  // decorar. 10000 dá ~13 peças por mesa.
  //
  // O custo não é o `maxDocumentBytes`: são ~276 bytes por objeto (~3 MB no
  // teto novo, contra os 10 MB do limite). É que todo salvamento manda o
  // documento inteiro e o broadcast faz cada cliente no escritório buscá-lo de
  // novo — subir mais que isto pede paginar o documento antes.
  maxObjects: 10_000,
  maxPolygonVertices: 64,
  maxAssetBytes: 10 * 1024 * 1024,
  maxAssetsBytesPerMap: 100 * 1024 * 1024,
  maxDocumentBytes: 10 * 1024 * 1024,
  minZoom: 0.25,
  maxZoom: 4,
  maxUndoOperations: 100,
  autosaveDebounceMs: 2_000,
  autosaveForceIntervalMs: 30_000,
  editLockTtlMs: 2 * 60_000,
  editLockHeartbeatMs: 30_000,
} as const;

/** Short alias for consumers that do not need the schema-version qualifier. */
export const MAP_LIMITS = MAP_DOCUMENT_V1_LIMITS;

/**
 * Quantos snapshots de decoração ficam retidos por publicação. Cada save de
 * decoração empurra o documento anterior no anel; o mais velho é descartado.
 * O anel é a base do merge de 3 vias — um editor que abriu o mapa há mais de
 * OFFICE_DECOR_REVISION_RING saves perde a base e cai no fallback do servidor.
 */
export const OFFICE_DECOR_REVISION_RING = 10;

/**
 * Quantas publicações (snapshots estruturais) ficam retidas por mapa. A ativa
 * nunca é podada, mesmo que já esteja fora das mais recentes.
 */
export const OFFICE_MAP_PUBLICATION_LIMIT = 10;

/**
 * Tamanho fixo de toda mesa criada pelo editor: 3 tiles de largura por 2 de
 * altura — o mesmo footprint da sala de chamada que nasce junto com ela.
 * Mesas publicadas antes desta regra mantêm o tamanho que têm.
 */
export const OFFICE_DESK_SIZE_TILES = { width: 3, height: 2 } as const;

export const RESERVED_MAP_LAYERS = [
  { key: "floor", name: "Piso", type: "tile", zIndex: 0 },
  { key: "walls", name: "Paredes", type: "tile", zIndex: 10 },
  { key: "objects", name: "Objetos", type: "tile", zIndex: 20 },
  { key: "collision", name: "Colisões", type: "object", zIndex: 100 },
  {
    key: "spawn-points",
    name: "Pontos de entrada",
    type: "object",
    zIndex: 110,
  },
  {
    key: "private-zones",
    name: "Zonas privadas",
    type: "object",
    zIndex: 120,
  },
  {
    key: "meeting-rooms",
    name: "Salas de reunião",
    type: "object",
    zIndex: 130,
  },
  {
    key: "desks",
    name: "Mesas",
    type: "object",
    zIndex: 135,
  },
  {
    key: "interactive-objects",
    name: "Objetos interativos",
    type: "object",
    zIndex: 140,
  },
] as const;

export type ReservedMapLayerKey = (typeof RESERVED_MAP_LAYERS)[number]["key"];
export type MapLayerType = (typeof RESERVED_MAP_LAYERS)[number]["type"];

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const TILE_REFERENCE_PATTERN = /^([A-Za-z0-9][A-Za-z0-9._-]{0,127}):([0-9]+)$/;
const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/;

export const MapIdentifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    IDENTIFIER_PATTERN,
    "Use apenas letras, números, ponto, hífen e sublinhado",
  );

export const MapTilesetAssetIdSchema = z.union([
  MapIdentifierSchema,
  z.string().regex(/^builtin:office\/[a-z0-9-]+$/, "Asset builtin inválido"),
]);

const HumanNameSchema = z
  .string()
  .min(1)
  .refine((value) => /\S/.test(value), {
    message: "O nome não pode conter apenas espaços",
  });

export const MapTileSizeSchema = z.union([
  z.literal(16),
  z.literal(32),
  z.literal(48),
  z.literal(64),
]);

export type MapTileSize = z.infer<typeof MapTileSizeSchema>;

export const MapMetadataV1Schema = z
  .object({
    width: z
      .number()
      .int()
      .min(MAP_DOCUMENT_V1_LIMITS.minMapWidthCells)
      .max(MAP_DOCUMENT_V1_LIMITS.maxMapWidthCells),
    height: z
      .number()
      .int()
      .min(MAP_DOCUMENT_V1_LIMITS.minMapHeightCells)
      .max(MAP_DOCUMENT_V1_LIMITS.maxMapHeightCells),
    tileWidth: MapTileSizeSchema,
    tileHeight: MapTileSizeSchema,
    backgroundColor: z.string().regex(COLOR_PATTERN),
  })
  .strict();

export const MapTilesetV1Schema = z
  .object({
    id: MapIdentifierSchema,
    assetId: MapTilesetAssetIdSchema,
    name: HumanNameSchema,
    tileWidth: MapTileSizeSchema,
    tileHeight: MapTileSizeSchema,
    columns: z.number().int().positive(),
    tileCount: z.number().int().positive(),
  })
  .strict();

const LayerBaseShape = {
  id: MapIdentifierSchema,
  key: MapIdentifierSchema,
  name: HumanNameSchema,
  zIndex: z.number().int(),
  visible: z.boolean(),
  locked: z.boolean(),
  opacity: z.number().min(0).max(1),
};

export const TileReferenceV1Schema = z
  .string()
  .regex(
    TILE_REFERENCE_PATTERN,
    "Referência esperada: <tilesetId>:<tileIndex>",
  );

export const MapTileLayerV1Schema = z
  .object({
    ...LayerBaseShape,
    type: z.literal("tile"),
    data: z
      .array(z.union([TileReferenceV1Schema, z.null()]))
      .max(MAP_DOCUMENT_V1_LIMITS.maxMapCells),
  })
  .strict();

export const MapObjectLayerV1Schema = z
  .object({
    ...LayerBaseShape,
    type: z.literal("object"),
  })
  .strict();

export const MapLayerV1Schema = z.discriminatedUnion("type", [
  MapTileLayerV1Schema,
  MapObjectLayerV1Schema,
]);

const PixelCoordinateSchema = z.number().int();

export const PointCoordinatesV1Schema = z
  .object({
    x: PixelCoordinateSchema,
    y: PixelCoordinateSchema,
  })
  .strict();

export const PointGeometryV1Schema = z
  .object({
    kind: z.literal("point"),
    x: PixelCoordinateSchema,
    y: PixelCoordinateSchema,
  })
  .strict();

export const RectangleGeometryV1Schema = z
  .object({
    kind: z.literal("rectangle"),
    x: PixelCoordinateSchema,
    y: PixelCoordinateSchema,
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

export const PolygonGeometryV1Schema = z
  .object({
    kind: z.literal("polygon"),
    points: z
      .array(PointCoordinatesV1Schema)
      .min(3)
      .max(MAP_DOCUMENT_V1_LIMITS.maxPolygonVertices),
  })
  .strict();

export const MapGeometryV1Schema = z.discriminatedUnion("kind", [
  PointGeometryV1Schema,
  RectangleGeometryV1Schema,
  PolygonGeometryV1Schema,
]);

export const RoomStatusV1Schema = z.enum(["OPEN", "LOCKED"]);
export const RoomAccessPolicyV1Schema = z.enum(["OPEN", "ALLOWLIST"]);

export const UserRoleSchema = z.enum(USER_ROLES);

const ObjectBaseShape = {
  id: MapIdentifierSchema,
  layerKey: MapIdentifierSchema,
  createdBy: z
    .object({ id: z.string().min(1), role: UserRoleSchema })
    .nullish(),
};

export const SpawnPointObjectV1Schema = z
  .object({
    ...ObjectBaseShape,
    type: z.literal("spawn-point"),
    geometry: PointGeometryV1Schema,
    properties: z
      .object({
        name: HumanNameSchema,
        isDefault: z.boolean(),
      })
      .strict(),
  })
  .strict();

export const CollisionObjectV1Schema = z
  .object({
    ...ObjectBaseShape,
    type: z.literal("collision"),
    geometry: z.union([RectangleGeometryV1Schema, PolygonGeometryV1Schema]),
    properties: z
      .object({
        name: HumanNameSchema.optional(),
      })
      .strict(),
  })
  .strict();

export const PrivateZoneObjectV1Schema = z
  .object({
    ...ObjectBaseShape,
    type: z.literal("private-zone"),
    geometry: z.union([RectangleGeometryV1Schema, PolygonGeometryV1Schema]),
    properties: z
      .object({
        name: HumanNameSchema,
        externalKey: MapIdentifierSchema.optional(),
        accessPolicy: RoomAccessPolicyV1Schema,
      })
      .strict(),
  })
  .strict();

export const MeetingRoomObjectV1Schema = z
  .object({
    ...ObjectBaseShape,
    type: z.literal("meeting-room"),
    geometry: z.union([RectangleGeometryV1Schema, PolygonGeometryV1Schema]),
    properties: z
      .object({
        externalKey: MapIdentifierSchema,
        name: HumanNameSchema,
        status: RoomStatusV1Schema,
        capacity: z.number().int().positive().optional(),
        voiceEnabled: z.boolean(),
        accessPolicy: RoomAccessPolicyV1Schema,
      })
      .strict(),
  })
  .strict();

export const DeskObjectV1Schema = z
  .object({
    ...ObjectBaseShape,
    type: z.literal("desk"),
    geometry: RectangleGeometryV1Schema,
    properties: z
      .object({
        externalKey: MapIdentifierSchema,
        name: HumanNameSchema,
      })
      .strict(),
  })
  .strict();

const InteractiveObjectBasePropertiesShape = {
  key: MapIdentifierSchema,
  label: HumanNameSchema.optional(),
};

export const DoorObjectV1Schema = z
  .object({
    ...ObjectBaseShape,
    type: z.literal("door"),
    geometry: MapGeometryV1Schema,
    properties: z
      .object({
        ...InteractiveObjectBasePropertiesShape,
        roomExternalKey: MapIdentifierSchema.optional(),
        destination: PointGeometryV1Schema.optional(),
      })
      .strict(),
  })
  .strict();

export const LinkObjectV1Schema = z
  .object({
    ...ObjectBaseShape,
    type: z.literal("link"),
    geometry: MapGeometryV1Schema,
    properties: z
      .object({
        ...InteractiveObjectBasePropertiesShape,
        label: HumanNameSchema,
        url: z
          .string()
          .url()
          .refine((value) => value.startsWith("https://"), {
            message: "Links interativos devem usar HTTPS",
          }),
      })
      .strict(),
  })
  .strict();

export const ActionPointObjectV1Schema = z
  .object({
    ...ObjectBaseShape,
    type: z.literal("action-point"),
    geometry: MapGeometryV1Schema,
    properties: z
      .object({
        ...InteractiveObjectBasePropertiesShape,
        label: HumanNameSchema,
        actionKey: MapIdentifierSchema,
      })
      .strict(),
  })
  .strict();

/**
 * Orientação de uma peça de mobília. `rotation` + `flipX` cobrem as OITO
 * orientações possíveis de um tile (grupo diedral de ordem 8): espelhar na
 * vertical é "espelhar na horizontal + girar 180°", então um terceiro campo
 * seria redundante e permitiria representar o mesmo estado de duas formas.
 * Ambos são opcionais — ausente significa `rotation: 0, flipX: false`, o que
 * mantém válido todo mapa publicado antes desta feature.
 */
export const TileObjectRotationV1Schema = z.union([
  z.literal(0),
  z.literal(90),
  z.literal(180),
  z.literal(270),
]);
export type TileObjectRotationV1 = z.infer<typeof TileObjectRotationV1Schema>;

export const TileObjectV1Schema = z
  .object({
    ...ObjectBaseShape,
    type: z.literal("tile-object"),
    geometry: RectangleGeometryV1Schema,
    properties: z
      .object({
        tilesetId: MapIdentifierSchema,
        tileIndex: z.number().int().nonnegative(),
        rotation: TileObjectRotationV1Schema.optional(),
        flipX: z.boolean().optional(),
      })
      .strict(),
  })
  .strict();

export const MapObjectV1Schema = z.discriminatedUnion("type", [
  SpawnPointObjectV1Schema,
  CollisionObjectV1Schema,
  PrivateZoneObjectV1Schema,
  MeetingRoomObjectV1Schema,
  DeskObjectV1Schema,
  DoorObjectV1Schema,
  LinkObjectV1Schema,
  ActionPointObjectV1Schema,
  TileObjectV1Schema,
]);

export const MapDocumentV1StructuralSchema = z
  .object({
    schemaVersion: z.literal(MAP_DOCUMENT_V1_SCHEMA_VERSION),
    map: MapMetadataV1Schema,
    tilesets: z
      .array(MapTilesetV1Schema)
      .max(MAP_DOCUMENT_V1_LIMITS.maxTilesets),
    layers: z.array(MapLayerV1Schema).max(MAP_DOCUMENT_V1_LIMITS.maxLayers),
    objects: z.array(MapObjectV1Schema).max(MAP_DOCUMENT_V1_LIMITS.maxObjects),
  })
  .strict();

export type MapMetadataV1 = z.infer<typeof MapMetadataV1Schema>;
export type MapTilesetV1 = z.infer<typeof MapTilesetV1Schema>;
export type MapTileLayerV1 = z.infer<typeof MapTileLayerV1Schema>;
export type MapObjectLayerV1 = z.infer<typeof MapObjectLayerV1Schema>;
export type MapLayerV1 = z.infer<typeof MapLayerV1Schema>;
export type PointCoordinatesV1 = z.infer<typeof PointCoordinatesV1Schema>;
export type PointGeometryV1 = z.infer<typeof PointGeometryV1Schema>;
export type RectangleGeometryV1 = z.infer<typeof RectangleGeometryV1Schema>;
export type PolygonGeometryV1 = z.infer<typeof PolygonGeometryV1Schema>;
export type MapGeometryV1 = z.infer<typeof MapGeometryV1Schema>;
export type SpawnPointObjectV1 = z.infer<typeof SpawnPointObjectV1Schema>;
export type CollisionObjectV1 = z.infer<typeof CollisionObjectV1Schema>;
export type PrivateZoneObjectV1 = z.infer<typeof PrivateZoneObjectV1Schema>;
export type MeetingRoomObjectV1 = z.infer<typeof MeetingRoomObjectV1Schema>;
export type DeskObjectV1 = z.infer<typeof DeskObjectV1Schema>;
export type DoorObjectV1 = z.infer<typeof DoorObjectV1Schema>;
export type LinkObjectV1 = z.infer<typeof LinkObjectV1Schema>;
export type ActionPointObjectV1 = z.infer<typeof ActionPointObjectV1Schema>;
export type TileObjectV1 = z.infer<typeof TileObjectV1Schema>;
export type MapObjectV1 = z.infer<typeof MapObjectV1Schema>;
export type MapDocumentV1 = z.infer<typeof MapDocumentV1StructuralSchema>;

export const MAP_VALIDATION_CODES = {
  schemaInvalid: "SCHEMA_INVALID",
  unknownField: "UNKNOWN_FIELD",
  documentTooLarge: "DOCUMENT_TOO_LARGE",
  tileSizeMismatch: "TILE_SIZE_MISMATCH",
  tilesetTileSizeMismatch: "TILESET_TILE_SIZE_MISMATCH",
  duplicateId: "DUPLICATE_ID",
  duplicateLayerKey: "DUPLICATE_LAYER_KEY",
  missingReservedLayer: "MISSING_RESERVED_LAYER",
  reservedLayerType: "RESERVED_LAYER_TYPE",
  customObjectLayer: "CUSTOM_OBJECT_LAYER_NOT_ALLOWED",
  tileDataLength: "TILE_DATA_LENGTH",
  tilesetNotFound: "TILESET_NOT_FOUND",
  tileIndexOutOfRange: "TILE_INDEX_OUT_OF_RANGE",
  objectLayerMismatch: "OBJECT_LAYER_MISMATCH",
  duplicateExternalKey: "DUPLICATE_EXTERNAL_KEY",
  duplicateInteractiveKey: "DUPLICATE_INTERACTIVE_KEY",
  defaultSpawnCount: "DEFAULT_SPAWN_COUNT",
  geometryOutOfBounds: "GEOMETRY_OUT_OF_BOUNDS",
  polygonSelfIntersection: "POLYGON_SELF_INTERSECTION",
  polygonZeroArea: "POLYGON_ZERO_AREA",
  spawnInCollision: "SPAWN_IN_COLLISION",
  meetingRoomOverlap: "MEETING_ROOM_OVERLAP",
  doorTargetConflict: "DOOR_TARGET_CONFLICT",
  doorRoomNotFound: "DOOR_ROOM_NOT_FOUND",
} as const;

export type MapValidationCode =
  (typeof MAP_VALIDATION_CODES)[keyof typeof MAP_VALIDATION_CODES];

export interface MapValidationError {
  code: MapValidationCode;
  path: string;
  objectId?: string;
  layerKey?: string;
  message: string;
}

export type MapDocumentV1ValidationResult =
  | {
      valid: true;
      errors: [];
      document: MapDocumentV1;
    }
  | {
      valid: false;
      errors: MapValidationError[];
    };

type PathSegment = string | number;

interface InternalValidationError extends Omit<MapValidationError, "path"> {
  path: PathSegment[];
}

const RESERVED_LAYER_BY_KEY = new Map(
  RESERVED_MAP_LAYERS.map((layer) => [layer.key, layer]),
);

const OBJECT_LAYER_BY_TYPE: Record<
  Exclude<MapObjectV1["type"], "tile-object">,
  ReservedMapLayerKey
> = {
  "spawn-point": "spawn-points",
  collision: "collision",
  "private-zone": "private-zones",
  "meeting-room": "meeting-rooms",
  desk: "desks",
  door: "interactive-objects",
  link: "interactive-objects",
  "action-point": "interactive-objects",
};

function formatPath(path: PathSegment[]): string {
  if (path.length === 0) return "$";

  return path.reduce<string>((formatted, segment) => {
    if (typeof segment === "number") return `${formatted}[${segment}]`;
    return formatted.length === 0 ? segment : `${formatted}.${segment}`;
  }, "");
}

function error(
  code: MapValidationCode,
  path: PathSegment[],
  message: string,
  context: Pick<MapValidationError, "objectId" | "layerKey"> = {},
): InternalValidationError {
  return { code, path, message, ...context };
}

function serializedByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function polygonSignedArea(points: PointCoordinatesV1[]): number {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return twiceArea / 2;
}

function orientation(
  first: PointCoordinatesV1,
  second: PointCoordinatesV1,
  third: PointCoordinatesV1,
): number {
  return (
    (second.x - first.x) * (third.y - first.y) -
    (second.y - first.y) * (third.x - first.x)
  );
}

function pointOnSegment(
  point: PointCoordinatesV1,
  start: PointCoordinatesV1,
  end: PointCoordinatesV1,
): boolean {
  if (orientation(start, end, point) !== 0) return false;
  return (
    point.x >= Math.min(start.x, end.x) &&
    point.x <= Math.max(start.x, end.x) &&
    point.y >= Math.min(start.y, end.y) &&
    point.y <= Math.max(start.y, end.y)
  );
}

function segmentsIntersect(
  firstStart: PointCoordinatesV1,
  firstEnd: PointCoordinatesV1,
  secondStart: PointCoordinatesV1,
  secondEnd: PointCoordinatesV1,
): boolean {
  const firstOrientation = orientation(firstStart, firstEnd, secondStart);
  const secondOrientation = orientation(firstStart, firstEnd, secondEnd);
  const thirdOrientation = orientation(secondStart, secondEnd, firstStart);
  const fourthOrientation = orientation(secondStart, secondEnd, firstEnd);

  if (
    ((firstOrientation > 0 && secondOrientation < 0) ||
      (firstOrientation < 0 && secondOrientation > 0)) &&
    ((thirdOrientation > 0 && fourthOrientation < 0) ||
      (thirdOrientation < 0 && fourthOrientation > 0))
  ) {
    return true;
  }

  return (
    (firstOrientation === 0 &&
      pointOnSegment(secondStart, firstStart, firstEnd)) ||
    (secondOrientation === 0 &&
      pointOnSegment(secondEnd, firstStart, firstEnd)) ||
    (thirdOrientation === 0 &&
      pointOnSegment(firstStart, secondStart, secondEnd)) ||
    (fourthOrientation === 0 &&
      pointOnSegment(firstEnd, secondStart, secondEnd))
  );
}

function segmentsProperlyIntersect(
  firstStart: PointCoordinatesV1,
  firstEnd: PointCoordinatesV1,
  secondStart: PointCoordinatesV1,
  secondEnd: PointCoordinatesV1,
): boolean {
  const firstOrientation = orientation(firstStart, firstEnd, secondStart);
  const secondOrientation = orientation(firstStart, firstEnd, secondEnd);
  const thirdOrientation = orientation(secondStart, secondEnd, firstStart);
  const fourthOrientation = orientation(secondStart, secondEnd, firstEnd);

  return (
    ((firstOrientation > 0 && secondOrientation < 0) ||
      (firstOrientation < 0 && secondOrientation > 0)) &&
    ((thirdOrientation > 0 && fourthOrientation < 0) ||
      (thirdOrientation < 0 && fourthOrientation > 0))
  );
}

function polygonSelfIntersects(points: PointCoordinatesV1[]): boolean {
  for (let firstIndex = 0; firstIndex < points.length; firstIndex += 1) {
    const firstNext = (firstIndex + 1) % points.length;
    const firstStart = points[firstIndex]!;
    const firstEnd = points[firstNext]!;

    for (
      let secondIndex = firstIndex + 1;
      secondIndex < points.length;
      secondIndex += 1
    ) {
      const secondNext = (secondIndex + 1) % points.length;
      const edgesAreAdjacent =
        firstIndex === secondIndex ||
        firstNext === secondIndex ||
        secondNext === firstIndex;
      if (edgesAreAdjacent) continue;

      if (
        segmentsIntersect(
          firstStart,
          firstEnd,
          points[secondIndex]!,
          points[secondNext]!,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function pointInPolygon(
  point: PointCoordinatesV1,
  polygon: PointCoordinatesV1[],
  includeBoundary: boolean,
): boolean {
  let inside = false;

  for (
    let currentIndex = 0, previousIndex = polygon.length - 1;
    currentIndex < polygon.length;
    previousIndex = currentIndex, currentIndex += 1
  ) {
    const current = polygon[currentIndex]!;
    const previous = polygon[previousIndex]!;

    if (pointOnSegment(point, previous, current)) return includeBoundary;

    const crossesRay =
      current.y > point.y !== previous.y > point.y &&
      point.x <
        ((previous.x - current.x) * (point.y - current.y)) /
          (previous.y - current.y) +
          current.x;
    if (crossesRay) inside = !inside;
  }

  return inside;
}

function rectanglePoints(rectangle: RectangleGeometryV1): PointCoordinatesV1[] {
  return [
    { x: rectangle.x, y: rectangle.y },
    { x: rectangle.x + rectangle.width, y: rectangle.y },
    {
      x: rectangle.x + rectangle.width,
      y: rectangle.y + rectangle.height,
    },
    { x: rectangle.x, y: rectangle.y + rectangle.height },
  ];
}

function pointInGeometry(
  point: PointCoordinatesV1,
  geometry: RectangleGeometryV1 | PolygonGeometryV1,
): boolean {
  if (geometry.kind === "rectangle") {
    return (
      point.x >= geometry.x &&
      point.x <= geometry.x + geometry.width &&
      point.y >= geometry.y &&
      point.y <= geometry.y + geometry.height
    );
  }
  return pointInPolygon(point, geometry.points, true);
}

function geometryWithinBounds(
  geometry: MapGeometryV1,
  width: number,
  height: number,
): boolean {
  if (geometry.kind === "point") {
    return (
      geometry.x >= 0 &&
      geometry.y >= 0 &&
      geometry.x < width &&
      geometry.y < height
    );
  }

  if (geometry.kind === "rectangle") {
    return (
      geometry.x >= 0 &&
      geometry.y >= 0 &&
      geometry.x + geometry.width <= width &&
      geometry.y + geometry.height <= height
    );
  }

  return geometry.points.every(
    (point) =>
      point.x >= 0 && point.y >= 0 && point.x <= width && point.y <= height,
  );
}

function polygonsHaveSameBoundary(
  first: PointCoordinatesV1[],
  second: PointCoordinatesV1[],
): boolean {
  if (first.length !== second.length) return false;
  return (
    first.every((point) =>
      second.some(
        (candidate) => candidate.x === point.x && candidate.y === point.y,
      ),
    ) &&
    second.every((point) =>
      first.some(
        (candidate) => candidate.x === point.x && candidate.y === point.y,
      ),
    )
  );
}

function polygonsOverlap(
  first: PointCoordinatesV1[],
  second: PointCoordinatesV1[],
): boolean {
  for (let firstIndex = 0; firstIndex < first.length; firstIndex += 1) {
    const firstStart = first[firstIndex]!;
    const firstEnd = first[(firstIndex + 1) % first.length]!;
    for (let secondIndex = 0; secondIndex < second.length; secondIndex += 1) {
      if (
        segmentsProperlyIntersect(
          firstStart,
          firstEnd,
          second[secondIndex]!,
          second[(secondIndex + 1) % second.length]!,
        )
      ) {
        return true;
      }
    }
  }

  if (first.some((point) => pointInPolygon(point, second, false))) return true;
  if (second.some((point) => pointInPolygon(point, first, false))) return true;
  return polygonsHaveSameBoundary(first, second);
}

function meetingRoomsOverlap(
  first: RectangleGeometryV1 | PolygonGeometryV1,
  second: RectangleGeometryV1 | PolygonGeometryV1,
): boolean {
  if (first.kind === "rectangle" && second.kind === "rectangle") {
    return (
      first.x < second.x + second.width &&
      first.x + first.width > second.x &&
      first.y < second.y + second.height &&
      first.y + first.height > second.y
    );
  }

  const firstPoints =
    first.kind === "rectangle" ? rectanglePoints(first) : first.points;
  const secondPoints =
    second.kind === "rectangle" ? rectanglePoints(second) : second.points;
  return polygonsOverlap(firstPoints, secondPoints);
}

function semanticValidationErrors(
  document: MapDocumentV1,
): InternalValidationError[] {
  const errors: InternalValidationError[] = [];
  const mapPixelWidth = document.map.width * document.map.tileWidth;
  const mapPixelHeight = document.map.height * document.map.tileHeight;

  if (
    serializedByteLength(document) > MAP_DOCUMENT_V1_LIMITS.maxDocumentBytes
  ) {
    errors.push(
      error(
        MAP_VALIDATION_CODES.documentTooLarge,
        [],
        `O documento excede ${MAP_DOCUMENT_V1_LIMITS.maxDocumentBytes} bytes`,
      ),
    );
  }

  if (document.map.tileWidth !== document.map.tileHeight) {
    errors.push(
      error(
        MAP_VALIDATION_CODES.tileSizeMismatch,
        ["map", "tileHeight"],
        "Os tiles do mapa devem ser quadrados",
      ),
    );
  }

  const seenIds = new Map<string, PathSegment[]>();
  const registerId = (id: string, path: PathSegment[]) => {
    const previousPath = seenIds.get(id);
    if (previousPath) {
      errors.push(
        error(
          MAP_VALIDATION_CODES.duplicateId,
          path,
          `O ID '${id}' já foi usado em ${formatPath(previousPath)}`,
        ),
      );
      return;
    }
    seenIds.set(id, path);
  };

  const tilesetsById = new Map<string, MapTilesetV1>();
  document.tilesets.forEach((tileset, index) => {
    registerId(tileset.id, ["tilesets", index, "id"]);
    if (!tilesetsById.has(tileset.id)) tilesetsById.set(tileset.id, tileset);
    if (
      tileset.tileWidth !== document.map.tileWidth ||
      tileset.tileHeight !== document.map.tileHeight
    ) {
      errors.push(
        error(
          MAP_VALIDATION_CODES.tilesetTileSizeMismatch,
          ["tilesets", index],
          `O tileset '${tileset.id}' deve usar o tamanho de tile do mapa`,
        ),
      );
    }
  });

  const layerIndexesByKey = new Map<string, number[]>();
  document.layers.forEach((layer, index) => {
    registerId(layer.id, ["layers", index, "id"]);
    const indexes = layerIndexesByKey.get(layer.key) ?? [];
    indexes.push(index);
    layerIndexesByKey.set(layer.key, indexes);
    if (indexes.length > 1) {
      errors.push(
        error(
          MAP_VALIDATION_CODES.duplicateLayerKey,
          ["layers", index, "key"],
          `A chave de layer '${layer.key}' está duplicada`,
          { layerKey: layer.key },
        ),
      );
    }

    const reserved = RESERVED_LAYER_BY_KEY.get(
      layer.key as ReservedMapLayerKey,
    );
    if (reserved && layer.type !== reserved.type) {
      errors.push(
        error(
          MAP_VALIDATION_CODES.reservedLayerType,
          ["layers", index, "type"],
          `A layer reservada '${layer.key}' deve ser do tipo '${reserved.type}'`,
          { layerKey: layer.key },
        ),
      );
    } else if (!reserved && layer.type === "object") {
      errors.push(
        error(
          MAP_VALIDATION_CODES.customObjectLayer,
          ["layers", index, "type"],
          "Layers adicionais devem ser visuais, do tipo 'tile'",
          { layerKey: layer.key },
        ),
      );
    }

    if (layer.type !== "tile") return;

    const expectedLength = document.map.width * document.map.height;
    if (layer.data.length !== expectedLength) {
      errors.push(
        error(
          MAP_VALIDATION_CODES.tileDataLength,
          ["layers", index, "data"],
          `A layer deve ter exatamente ${expectedLength} células`,
          { layerKey: layer.key },
        ),
      );
    }

    layer.data.forEach((reference, tileIndex) => {
      if (reference === null) return;
      const match = TILE_REFERENCE_PATTERN.exec(reference);
      if (!match) return;
      const [, tilesetId, rawIndex] = match;
      const tileset = tilesetsById.get(tilesetId!);
      if (!tileset) {
        errors.push(
          error(
            MAP_VALIDATION_CODES.tilesetNotFound,
            ["layers", index, "data", tileIndex],
            `O tileset '${tilesetId}' não existe`,
            { layerKey: layer.key },
          ),
        );
        return;
      }
      const referencedIndex = Number(rawIndex);
      if (
        !Number.isSafeInteger(referencedIndex) ||
        referencedIndex < 0 ||
        referencedIndex >= tileset.tileCount
      ) {
        errors.push(
          error(
            MAP_VALIDATION_CODES.tileIndexOutOfRange,
            ["layers", index, "data", tileIndex],
            `O índice ${rawIndex} não existe no tileset '${tilesetId}'`,
            { layerKey: layer.key },
          ),
        );
      }
    });
  });

  RESERVED_MAP_LAYERS.forEach((reserved) => {
    if (!layerIndexesByKey.has(reserved.key)) {
      errors.push(
        error(
          MAP_VALIDATION_CODES.missingReservedLayer,
          ["layers"],
          `A layer reservada '${reserved.key}' é obrigatória`,
          { layerKey: reserved.key },
        ),
      );
    }
  });

  const externalKeys = new Map<
    string,
    { path: PathSegment[]; objectId: string }
  >();
  const interactiveKeys = new Map<
    string,
    { path: PathSegment[]; objectId: string }
  >();
  const meetingRoomKeys = new Set<string>();
  const meetingRooms: Array<{
    object: MeetingRoomObjectV1;
    index: number;
  }> = [];
  const collisions: CollisionObjectV1[] = [];
  const spawns: Array<{ object: SpawnPointObjectV1; index: number }> = [];
  const doors: Array<{ object: DoorObjectV1; index: number }> = [];

  document.objects.forEach((object, index) => {
    registerId(object.id, ["objects", index, "id"]);
    const expectedLayerKey =
      object.type === "tile-object" ? null : OBJECT_LAYER_BY_TYPE[object.type];
    const visualLayer = document.layers.find(
      (layer) => layer.key === object.layerKey,
    );
    if (
      (expectedLayerKey !== null && object.layerKey !== expectedLayerKey) ||
      (object.type === "tile-object" && visualLayer?.type !== "tile")
    ) {
      errors.push(
        error(
          MAP_VALIDATION_CODES.objectLayerMismatch,
          ["objects", index, "layerKey"],
          object.type === "tile-object"
            ? "Objetos visuais devem pertencer a uma layer de tiles existente"
            : `Objetos '${object.type}' devem pertencer à layer '${expectedLayerKey}'`,
          { objectId: object.id, layerKey: object.layerKey },
        ),
      );
    }

    if (!geometryWithinBounds(object.geometry, mapPixelWidth, mapPixelHeight)) {
      errors.push(
        error(
          MAP_VALIDATION_CODES.geometryOutOfBounds,
          ["objects", index, "geometry"],
          "A geometria deve permanecer dentro dos limites do mapa",
          { objectId: object.id, layerKey: object.layerKey },
        ),
      );
    }

    if (object.geometry.kind === "polygon") {
      if (polygonSignedArea(object.geometry.points) === 0) {
        errors.push(
          error(
            MAP_VALIDATION_CODES.polygonZeroArea,
            ["objects", index, "geometry", "points"],
            "O polígono deve possuir área positiva",
            { objectId: object.id, layerKey: object.layerKey },
          ),
        );
      }
      if (polygonSelfIntersects(object.geometry.points)) {
        errors.push(
          error(
            MAP_VALIDATION_CODES.polygonSelfIntersection,
            ["objects", index, "geometry", "points"],
            "O polígono não pode se auto-intersectar",
            { objectId: object.id, layerKey: object.layerKey },
          ),
        );
      }
    }

    if (object.type === "tile-object") {
      const tileset = tilesetsById.get(object.properties.tilesetId);
      if (!tileset) {
        errors.push(
          error(
            MAP_VALIDATION_CODES.tilesetNotFound,
            ["objects", index, "properties", "tilesetId"],
            `O tileset '${object.properties.tilesetId}' não existe`,
            { objectId: object.id, layerKey: object.layerKey },
          ),
        );
      } else {
        if (object.properties.tileIndex >= tileset.tileCount) {
          errors.push(
            error(
              MAP_VALIDATION_CODES.tileIndexOutOfRange,
              ["objects", index, "properties", "tileIndex"],
              `O índice ${object.properties.tileIndex} não existe no tileset '${tileset.id}'`,
              { objectId: object.id, layerKey: object.layerKey },
            ),
          );
        }
        if (
          object.geometry.width !== tileset.tileWidth ||
          object.geometry.height !== tileset.tileHeight
        ) {
          errors.push(
            error(
              MAP_VALIDATION_CODES.tilesetTileSizeMismatch,
              ["objects", index, "geometry"],
              "O objeto visual deve manter o tamanho original do tile",
              { objectId: object.id, layerKey: object.layerKey },
            ),
          );
        }
      }
    }

    let externalKey: string | undefined;
    if (object.type === "meeting-room") {
      externalKey = object.properties.externalKey;
      meetingRoomKeys.add(externalKey);
      meetingRooms.push({ object, index });
    } else if (object.type === "private-zone") {
      externalKey = object.properties.externalKey;
    } else if (object.type === "desk") {
      externalKey = object.properties.externalKey;
    }
    if (externalKey) {
      const path = ["objects", index, "properties", "externalKey"];
      const previous = externalKeys.get(externalKey);
      if (previous) {
        errors.push(
          error(
            MAP_VALIDATION_CODES.duplicateExternalKey,
            path,
            `A externalKey '${externalKey}' já pertence ao objeto '${previous.objectId}'`,
            { objectId: object.id, layerKey: object.layerKey },
          ),
        );
      } else {
        externalKeys.set(externalKey, { path, objectId: object.id });
      }
    }

    if (
      object.type === "door" ||
      object.type === "link" ||
      object.type === "action-point"
    ) {
      const key = object.properties.key;
      const path = ["objects", index, "properties", "key"];
      const previous = interactiveKeys.get(key);
      if (previous) {
        errors.push(
          error(
            MAP_VALIDATION_CODES.duplicateInteractiveKey,
            path,
            `A chave interativa '${key}' já pertence ao objeto '${previous.objectId}'`,
            { objectId: object.id, layerKey: object.layerKey },
          ),
        );
      } else {
        interactiveKeys.set(key, { path, objectId: object.id });
      }
    }

    if (object.type === "collision") collisions.push(object);
    if (object.type === "spawn-point") spawns.push({ object, index });
    if (object.type === "door") {
      doors.push({ object, index });
      if (object.properties.roomExternalKey && object.properties.destination) {
        errors.push(
          error(
            MAP_VALIDATION_CODES.doorTargetConflict,
            ["objects", index, "properties"],
            "Uma porta deve apontar para uma sala ou para um destino, nunca ambos",
            { objectId: object.id, layerKey: object.layerKey },
          ),
        );
      }
      if (
        object.properties.destination &&
        !geometryWithinBounds(
          object.properties.destination,
          mapPixelWidth,
          mapPixelHeight,
        )
      ) {
        errors.push(
          error(
            MAP_VALIDATION_CODES.geometryOutOfBounds,
            ["objects", index, "properties", "destination"],
            "O destino da porta deve permanecer dentro dos limites do mapa",
            { objectId: object.id, layerKey: object.layerKey },
          ),
        );
      }
    }
  });

  doors.forEach(({ object, index }) => {
    const roomExternalKey = object.properties.roomExternalKey;
    if (roomExternalKey && !meetingRoomKeys.has(roomExternalKey)) {
      errors.push(
        error(
          MAP_VALIDATION_CODES.doorRoomNotFound,
          ["objects", index, "properties", "roomExternalKey"],
          `A sala '${roomExternalKey}' referenciada pela porta não existe`,
          { objectId: object.id, layerKey: object.layerKey },
        ),
      );
    }
  });

  const defaultSpawns = spawns.filter(
    ({ object }) => object.properties.isDefault,
  );
  if (defaultSpawns.length !== 1) {
    errors.push(
      error(
        MAP_VALIDATION_CODES.defaultSpawnCount,
        ["objects"],
        `O mapa deve possuir exatamente um spawn padrão; encontrados: ${defaultSpawns.length}`,
      ),
    );
  }

  spawns.forEach(({ object, index }) => {
    const point = { x: object.geometry.x, y: object.geometry.y };
    if (
      collisions.some((collision) => pointInGeometry(point, collision.geometry))
    ) {
      errors.push(
        error(
          MAP_VALIDATION_CODES.spawnInCollision,
          ["objects", index, "geometry"],
          "O ponto de spawn não pode ficar dentro ou na borda de uma colisão",
          { objectId: object.id, layerKey: object.layerKey },
        ),
      );
    }
  });

  for (let firstIndex = 0; firstIndex < meetingRooms.length; firstIndex += 1) {
    const first = meetingRooms[firstIndex]!;
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < meetingRooms.length;
      secondIndex += 1
    ) {
      const second = meetingRooms[secondIndex]!;
      if (meetingRoomsOverlap(first.object.geometry, second.object.geometry)) {
        errors.push(
          error(
            MAP_VALIDATION_CODES.meetingRoomOverlap,
            ["objects", second.index, "geometry"],
            `A sala '${second.object.properties.externalKey}' se sobrepõe à sala '${first.object.properties.externalKey}'`,
            {
              objectId: second.object.id,
              layerKey: second.object.layerKey,
            },
          ),
        );
      }
    }
  }

  return errors;
}

export const MapDocumentV1Schema = MapDocumentV1StructuralSchema.superRefine(
  (document, context) => {
    semanticValidationErrors(document).forEach((validationError) => {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: validationError.path,
        message: validationError.message,
        params: {
          validationCode: validationError.code,
          objectId: validationError.objectId,
          layerKey: validationError.layerKey,
        },
      });
    });
  },
);

function structuralErrors(errorResult: z.ZodError): MapValidationError[] {
  return errorResult.issues.map((issue) => ({
    code:
      issue.code === z.ZodIssueCode.unrecognized_keys
        ? MAP_VALIDATION_CODES.unknownField
        : MAP_VALIDATION_CODES.schemaInvalid,
    path: formatPath(issue.path),
    message: issue.message,
  }));
}

export function validateMapDocumentV1(
  input: unknown,
): MapDocumentV1ValidationResult {
  const structuralResult = MapDocumentV1StructuralSchema.safeParse(input);
  if (!structuralResult.success) {
    return {
      valid: false,
      errors: structuralErrors(structuralResult.error),
    };
  }

  const errors = semanticValidationErrors(structuralResult.data).map(
    (validationError) => ({
      ...validationError,
      path: formatPath(validationError.path),
    }),
  );

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, errors: [], document: structuralResult.data };
}

/**
 * Preenche, sem alterar nada existente, as layers reservadas que faltarem no
 * documento (ex.: mapas criados antes de uma nova layer reservada ser
 * adicionada ao produto, como `desks`). A layer inserida vem vazia — não
 * força a existência de nenhum objeto dentro dela.
 */
export function ensureReservedLayers(document: MapDocumentV1): MapDocumentV1 {
  const existingKeys = new Set(document.layers.map((layer) => layer.key));
  const missing = RESERVED_MAP_LAYERS.filter(
    (reserved) => !existingKeys.has(reserved.key),
  );
  if (missing.length === 0) return document;

  const tileCount = document.map.width * document.map.height;
  const addedLayers: MapLayerV1[] = missing.map((reserved) => {
    const base = {
      id: `layer-${reserved.key}`,
      key: reserved.key,
      name: reserved.name,
      zIndex: reserved.zIndex,
      visible: true,
      locked: false,
      opacity: 1,
    };
    if (reserved.type === "tile") {
      return {
        ...base,
        type: "tile",
        data: Array.from({ length: tileCount }, () => null),
      };
    }
    return { ...base, type: "object" };
  });

  return { ...document, layers: [...document.layers, ...addedLayers] };
}

export interface CreateEmptyMapDocumentV1Options {
  width?: number;
  height?: number;
  tileSize?: MapTileSize;
  backgroundColor?: string;
}

const CreateEmptyMapDocumentV1OptionsSchema = z
  .object({
    width: MapMetadataV1Schema.shape.width.optional(),
    height: MapMetadataV1Schema.shape.height.optional(),
    tileSize: MapTileSizeSchema.optional(),
    backgroundColor: MapMetadataV1Schema.shape.backgroundColor.optional(),
  })
  .strict();

export function createEmptyMapDocumentV1(
  input: CreateEmptyMapDocumentV1Options = {},
): MapDocumentV1 {
  const options = CreateEmptyMapDocumentV1OptionsSchema.parse(input);
  const width = options.width ?? 40;
  const height = options.height ?? 30;
  const tileSize = options.tileSize ?? 32;
  const backgroundColor = options.backgroundColor ?? "#151b2b";
  const tileCount = width * height;

  const layers: MapLayerV1[] = RESERVED_MAP_LAYERS.map((definition) => {
    const base = {
      id: `layer-${definition.key}`,
      key: definition.key,
      name: definition.name,
      zIndex: definition.zIndex,
      visible: true,
      locked: false,
      opacity: 1,
    };
    if (definition.type === "tile") {
      return {
        ...base,
        type: "tile",
        data: Array.from({ length: tileCount }, () => null),
      };
    }
    return { ...base, type: "object" };
  });

  const centerColumn = Math.floor(width / 2);
  const centerRow = Math.floor(height / 2);
  const document: MapDocumentV1 = {
    schemaVersion: MAP_DOCUMENT_V1_SCHEMA_VERSION,
    map: {
      width,
      height,
      tileWidth: tileSize,
      tileHeight: tileSize,
      backgroundColor,
    },
    tilesets: [],
    layers,
    objects: [
      {
        id: "spawn-main",
        layerKey: "spawn-points",
        type: "spawn-point",
        geometry: {
          kind: "point",
          x: centerColumn * tileSize + Math.floor(tileSize / 2),
          y: centerRow * tileSize + Math.floor(tileSize / 2),
        },
        properties: {
          name: "Entrada principal",
          isDefault: true,
        },
      },
    ],
  };

  return MapDocumentV1Schema.parse(document);
}

export class UnsupportedMapDocumentVersionError extends Error {
  public constructor(public readonly schemaVersion: string | null) {
    super(
      schemaVersion
        ? `Unsupported map document schema version: ${schemaVersion}`
        : "Map document schemaVersion is missing.",
    );
    this.name = "UnsupportedMapDocumentVersionError";
  }
}

/**
 * Explicit version gateway for persisted/imported documents. Future versions
 * must add a named branch here instead of being accepted implicitly.
 */
export function migrateMapDocumentToLatest(input: unknown): MapDocumentV1 {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new UnsupportedMapDocumentVersionError(null);
  }
  const schemaVersion = (input as { schemaVersion?: unknown }).schemaVersion;
  if (schemaVersion !== MAP_DOCUMENT_V1_SCHEMA_VERSION) {
    throw new UnsupportedMapDocumentVersionError(
      typeof schemaVersion === "string" ? schemaVersion : null,
    );
  }
  return MapDocumentV1Schema.parse(input);
}

/** Alias kept concise for API/import consumers. */
export const migrateMapDocument = migrateMapDocumentToLatest;

export interface MapStructuralViolation {
  code: string;
  message: string;
  path: string;
}
export type DecorationGuardResult =
  | { ok: true }
  | { ok: false; violations: MapStructuralViolation[] };

export const STRUCTURAL_LAYER_KEYS = ["walls", "floor"] as const;
export const STRUCTURAL_OBJECT_TYPES = ["spawn-point"] as const;

function layerSignature(layer: MapLayerV1) {
  return JSON.stringify({
    id: layer.id,
    key: layer.key,
    name: layer.name,
    type: layer.type,
    zIndex: layer.zIndex,
    visible: layer.visible,
    locked: layer.locked,
    opacity: layer.opacity,
  });
}
function structuralObjectsSignature(objects: MapObjectV1[]) {
  return JSON.stringify(
    objects
      .filter((object) =>
        (STRUCTURAL_OBJECT_TYPES as readonly string[]).includes(object.type),
      )
      .map((object) => ({
        id: object.id,
        type: object.type,
        layerKey: object.layerKey,
        geometry: object.geometry,
        properties: object.properties,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  );
}
const STRUCTURAL_LAYER_VIOLATION_META: Record<
  string,
  { code: string; message: string; path: string }
> = {
  walls: {
    code: "WALLS_CHANGED",
    message: "A layer de paredes é estrutural",
    path: "layers.walls.data",
  },
  floor: {
    code: "FLOOR_CHANGED",
    message: "A layer de piso é estrutural",
    path: "layers.floor.data",
  },
};

function structuralLayerDataByKey(
  document: MapDocumentV1,
): Record<string, string> {
  const structuralKeys = new Set<string>(STRUCTURAL_LAYER_KEYS);
  // Agrupa por key (não sobrescreve): uma layer duplicada com a mesma key
  // estrutural (bypass) precisa continuar detectável mesmo se não for a
  // última do array — ver teste "SEGUNDA layer chaveada como walls".
  const byKey = new Map<
    string,
    { id: string; key: string; data: (string | null)[] }[]
  >();
  for (const layer of document.layers) {
    if (!structuralKeys.has(layer.key) || layer.type !== "tile") continue;
    const entry = {
      id: layer.id,
      key: layer.key,
      data: (layer as { data: (string | null)[] }).data,
    };
    const list = byKey.get(layer.key);
    if (list) list.push(entry);
    else byKey.set(layer.key, [entry]);
  }
  const result: Record<string, string> = {};
  for (const [key, list] of byKey) {
    result[key] = JSON.stringify(
      list.slice().sort((a, b) => a.id.localeCompare(b.id)),
    );
  }
  return result;
}

export function assertOnlyDecorationChanged(
  previous: MapDocumentV1,
  next: MapDocumentV1,
  actor?: { isAdmin: boolean },
): DecorationGuardResult {
  const violations: MapStructuralViolation[] = [];
  if (JSON.stringify(previous.map) !== JSON.stringify(next.map)) {
    violations.push({
      code: "MAP_METADATA_CHANGED",
      message: "Dimensões, tile ou cor de fundo são estruturais",
      path: "map",
    });
  }
  const prevLayers = previous.layers.map(layerSignature);
  const nextLayers = next.layers.map(layerSignature);
  if (JSON.stringify(prevLayers) !== JSON.stringify(nextLayers)) {
    violations.push({
      code: "LAYER_TOPOLOGY_CHANGED",
      message: "Adicionar, remover, reordenar ou alterar layers é estrutural",
      path: "layers",
    });
  }
  const prevStructuralLayers = structuralLayerDataByKey(previous);
  const nextStructuralLayers = structuralLayerDataByKey(next);
  for (const key of STRUCTURAL_LAYER_KEYS) {
    if (prevStructuralLayers[key] === nextStructuralLayers[key]) continue;
    const meta = STRUCTURAL_LAYER_VIOLATION_META[key] ?? {
      code: `${key.toUpperCase()}_CHANGED`,
      message: `A layer de ${key} é estrutural`,
      path: `layers.${key}.data`,
    };
    violations.push({ ...meta });
  }
  if (
    structuralObjectsSignature(previous.objects) !==
    structuralObjectsSignature(next.objects)
  ) {
    violations.push({
      code: "SPAWN_CHANGED",
      message: "Pontos de entrada são estruturais",
      path: "objects.spawn-point",
    });
  }
  if (actor && !actor.isAdmin) {
    violations.push(...protectedObjectViolations(previous.objects, next.objects));
  }

  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}

/**
 * A parte NÃO estrutural do guard: usuário comum não remove nem altera objeto
 * protegido (ver `isProtectedFromMembers`).
 *
 * Vive separada porque o merge aditivo (base desconhecida) não tem contra o
 * que comparar topologia — comparar `mine` com a publicação viva acusaria
 * `MAP_METADATA_CHANGED`/`SPAWN_CHANGED` por culpa do admin ter publicado no
 * meio, e bloquearia o save de quem não fez nada de errado. As checagens
 * estruturais podem ser puladas ali sem risco: `mergeDecoration` herda toda a
 * estrutura de `theirs`, então nada que venha de `mine` chega ao documento.
 * Esta checagem, não: alterar um objeto protegido é aplicado pelo merge.
 */
export function assertProtectedObjectsUntouched(
  previous: MapObjectV1[],
  next: MapObjectV1[],
  actor: { isAdmin: boolean },
): DecorationGuardResult {
  if (actor.isAdmin) return { ok: true };
  const violations = protectedObjectViolations(previous, next);
  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}

function protectedObjectViolations(
  previous: MapObjectV1[],
  next: MapObjectV1[],
): MapStructuralViolation[] {
  const violations: MapStructuralViolation[] = [];
  const nextById = new Map(next.map((o) => [o.id, o]));
  for (const prev of previous) {
    if (!isProtectedFromMembers(prev)) continue;
    const after = nextById.get(prev.id);
    if (!after) {
      violations.push({
        code: "PROTECTED_OBJECT_REMOVED",
        message: "Só administradores podem remover estruturas do escritório",
        path: `objects.${prev.id}`,
      });
    } else if (!sameDecorObject(prev, after)) {
      violations.push({
        code: "PROTECTED_OBJECT_MODIFIED",
        message: "Só administradores podem alterar estruturas do escritório",
        path: `objects.${prev.id}`,
      });
    }
  }
  return violations;
}

/**
 * Um objeto é "protegido" (intocável por usuário comum) quando foi criado por
 * um admin ou é legado (sem `createdBy` — todo objeto publicado antes desta
 * feature). Backfill conservador: sem autoria conhecida, tratamos como do admin.
 */
export function isProtectedFromMembers(object: MapObjectV1): boolean {
  return object.createdBy == null || object.createdBy.role === "ADMIN";
}

function sameDecorObject(a: MapObjectV1, b: MapObjectV1): boolean {
  return (
    a.layerKey === b.layerKey &&
    JSON.stringify((a as { geometry?: unknown }).geometry) === JSON.stringify((b as { geometry?: unknown }).geometry) &&
    JSON.stringify((a as { properties?: unknown }).properties) === JSON.stringify((b as { properties?: unknown }).properties)
  );
}

function unionTilesetsById(...groups: MapTilesetV1[][]): MapTilesetV1[] {
  const byId = new Map<string, MapTilesetV1>();
  for (const group of groups) for (const t of group) if (!byId.has(t.id)) byId.set(t.id, t);
  return [...byId.values()];
}

function tileObjectIdsInLayer(document: MapDocumentV1, layerKey: string): string[] {
  return document.objects
    .filter((object) => object.type === "tile-object" && object.layerKey === layerKey)
    .map((object) => object.id);
}

/**
 * Detecta layers em que `mine` alterou de fato a ordem visual, separando uma
 * reordenação explícita das adições/remoções normais do editor.
 *
 * A ordem canônica sem reordenar é: objetos sobreviventes de `base` na ordem
 * original, seguidos pelos objetos novos de `mine`. Se `mine` divergir disso,
 * houve uma ação de subir/descer camada e ela precisa sobreviver ao merge.
 */
function reorderedTileObjectLayers(base: MapDocumentV1, mine: MapDocumentV1): Set<string> {
  const layerKeys = new Set(
    mine.objects.filter((object) => object.type === "tile-object").map((object) => object.layerKey),
  );
  const reordered = new Set<string>();
  for (const layerKey of layerKeys) {
    const baseIds = tileObjectIdsInLayer(base, layerKey);
    const mineIds = tileObjectIdsInLayer(mine, layerKey);
    const mineSet = new Set(mineIds);
    const baseSet = new Set(baseIds);
    const canonical = [
      ...baseIds.filter((id) => mineSet.has(id)),
      ...mineIds.filter((id) => !baseSet.has(id)),
    ];
    if (mineIds.some((id, index) => canonical[index] !== id)) reordered.add(layerKey);
  }
  return reordered;
}

/**
 * Reaplica ao resultado do merge somente as ordens visuais que `mine`
 * realmente mudou. Objetos concorrentes exclusivos de `theirs` ficam nos
 * próprios slots; assim não se perdem nem são deslocados por uma intenção que
 * o editor local nunca chegou a enxergar.
 */
function applyMineTileObjectOrder(
  base: MapDocumentV1,
  mine: MapDocumentV1,
  merged: MapObjectV1[],
): MapObjectV1[] {
  const reorderedLayers = reorderedTileObjectLayers(base, mine);
  if (reorderedLayers.size === 0) return merged;

  let result = merged;
  for (const layerKey of reorderedLayers) {
    const mergedById = new Map(result.map((object) => [object.id, object]));
    const desired = tileObjectIdsInLayer(mine, layerKey)
      .map((id) => mergedById.get(id))
      .filter((object): object is MapObjectV1 => object?.type === "tile-object");
    const movableIds = new Set(desired.map((object) => object.id));
    let desiredIndex = 0;
    result = result.map((object) => {
      if (
        object.type !== "tile-object" ||
        object.layerKey !== layerKey ||
        !movableIds.has(object.id)
      ) {
        return object;
      }
      return desired[desiredIndex++];
    });
  }
  return result;
}

/**
 * Merge 3-vias por CÉLULA das tile layers (ex.: apagar um tile legado da
 * layer `objects` — caminho usado por `stampTile` quando não há mobília
 * empilhada na célula, ver `useOfficeMapEditing.eraseAt`). Sem isto, o merge
 * herdava `layers` inteiro de `theirs` e uma borrachada nesse caminho legado
 * era silenciosamente descartada ao publicar.
 *
 * Casa layers por `key` entre `base`/`mine`/`theirs`; a lista/ordem/estrutura
 * de layers vem de `theirs` (topologia é responsabilidade do guard
 * estrutural, não deste merge). Para cada tile layer de `theirs`: se a mesma
 * `key` existir como tile layer em `base` E `mine` com `data` do mesmo
 * tamanho, `merged.data[i] = mine.data[i]` quando `mine.data[i] !==
 * base.data[i]` (minha edição de célula vence), senão `theirs.data[i]`.
 * Layers de objeto e qualquer caso sem correspondência elegível (tamanhos
 * diferentes, layer ausente em base/mine) mantêm a layer de `theirs` intacta
 * — fallback seguro.
 */
function mergeTileLayers(
  base: MapDocumentV1,
  mine: MapDocumentV1,
  theirs: MapDocumentV1,
  structureFrom: MergeStructureSide = "theirs",
): MapLayerV1[] {
  const structure = structureFrom === "mine" ? mine : theirs;
  const other = structureFrom === "mine" ? theirs : mine;
  const baseByKey = new Map(base.layers.map((layer) => [layer.key, layer]));
  const otherByKey = new Map(other.layers.map((layer) => [layer.key, layer]));

  return structure.layers.map((layer) => {
    if (layer.type !== "tile") return layer;

    const baseLayer = baseByKey.get(layer.key);
    const otherLayer = otherByKey.get(layer.key);
    if (
      !baseLayer ||
      baseLayer.type !== "tile" ||
      !otherLayer ||
      otherLayer.type !== "tile" ||
      baseLayer.data.length !== layer.data.length ||
      otherLayer.data.length !== layer.data.length
    ) {
      return layer;
    }

    const data = layer.data.map((structureValue, index) => {
      const baseValue = baseLayer.data[index];
      const otherValue = otherLayer.data[index];
      const mineValue = structureFrom === "mine" ? structureValue : otherValue;
      const theirsValue = structureFrom === "mine" ? otherValue : structureValue;
      return mineValue !== baseValue ? mineValue : theirsValue;
    });
    return { ...layer, data };
  });
}

/** Qual documento dita a topologia do merge (`map`, lista/ordem de `layers`). */
type MergeStructureSide = "mine" | "theirs";

/**
 * Núcleo compartilhado por `mergeDecoration` e `mergeAdminDraft`: casamento de
 * objetos por `id` entre as três vias. Devolve os objetos de `theirs` (na ordem
 * de `theirs`) com as minhas alterações aplicadas, seguidos dos meus objetos
 * novos, e por fim a reordenação explícita que eu tenha feito.
 *
 * `additive` desliga a aplicação de remoções — modo usado quando o servidor não
 * sabe contra qual documento eu editei (âncora de outra publicação, ou base já
 * podada do anel de revisões). Sem ele, `base` acaba sendo o próprio `theirs` e
 * TODO objeto de `theirs` ausente do meu documento parece uma remoção minha,
 * apagando o trabalho alheio inteiro. O preço é uma peça que apaguei reaparecer
 * — perda de um clique, e não do mapa.
 */
function mergeObjectsById(
  base: MapDocumentV1,
  mine: MapDocumentV1,
  theirs: MapDocumentV1,
  additive: boolean,
): MapObjectV1[] {
  const baseById = new Map(base.objects.map((o) => [o.id, o]));
  const mineById = new Map(mine.objects.map((o) => [o.id, o]));

  const removedByMe = new Set<string>();
  if (!additive) {
    for (const o of base.objects) if (!mineById.has(o.id)) removedByMe.add(o.id);
  }

  const changedByMe = new Map<string, MapObjectV1>();
  for (const o of mine.objects) {
    const prev = baseById.get(o.id);
    if (prev && !sameDecorObject(prev, o)) changedByMe.set(o.id, o);
  }

  const theirsIds = new Set(theirs.objects.map((o) => o.id));
  const merged: MapObjectV1[] = [];
  for (const o of theirs.objects) {
    if (removedByMe.has(o.id)) continue;
    merged.push(changedByMe.get(o.id) ?? o);
  }
  // Meus objetos novos: em mine, ausentes em base E em theirs → topo da pilha.
  for (const o of mine.objects) {
    if (!baseById.has(o.id) && !theirsIds.has(o.id)) merged.push(o);
  }
  return applyMineTileObjectOrder(base, mine, merged);
}

/**
 * Merge 3-vias por `id` de objeto para decoração colaborativa. Reordenações
 * explícitas de `tile-object` em `mine` também são reaplicadas ao resultado,
 * preservando objetos concorrentes exclusivos de `theirs`.
 * `base`   = mapa que o editor abriu; `mine` = doc do editor; `theirs` = publicação mais recente.
 * Estrutura (map/layers/schemaVersion) vem de `theirs`; tile layers passam por
 * `mergeTileLayers` (merge por célula). Ver spec 2026-07-20.
 */
export function mergeDecoration(
  base: MapDocumentV1,
  mine: MapDocumentV1,
  theirs: MapDocumentV1,
  options: { additive?: boolean } = {},
): MapDocumentV1 {
  return {
    ...theirs,
    tilesets: unionTilesetsById(theirs.tilesets, mine.tilesets),
    layers: mergeTileLayers(base, mine, theirs, "theirs"),
    objects: mergeObjectsById(base, mine, theirs, options.additive ?? false),
  };
}

/**
 * Merge 3-vias do rascunho do admin contra o mapa vivo. Mesmo casamento de
 * objetos do `mergeDecoration` — a diferença é de AUTORIDADE: a estrutura
 * (`map`, `schemaVersion`, lista/ordem de `layers`) vem de `mine`, porque
 * mudar a topologia do mapa é justamente o que o editor do admin faz e o
 * editor de decoração não pode fazer.
 *
 * `base` = documento de onde o rascunho foi semeado (âncora
 * `basePublicationId`/`baseDecorRevision` do draft); `mine` = rascunho do
 * admin; `theirs` = `mapData` da publicação ativa, já com o que foi decorado
 * pelo mapa desde então.
 *
 * Se o admin redimensionou o mapa, as tile layers ficam com `data` de tamanhos
 * diferentes e `mergeTileLayers` cai no fallback "mantém a layer de `mine`":
 * a pintura in-map daquela camada se perde. É inevitável ao redimensionar, e é
 * o lado seguro — o admin vê publicado exatamente o que desenhou.
 *
 * `additive` vale para o rascunho sem âncora conhecida (o primeiro após esta
 * feature, ou quando o anel de revisões já podou a base): passe `base = theirs`
 * junto, e o resultado é a união dos dois documentos, sem remoções.
 */
export function mergeAdminDraft(
  base: MapDocumentV1,
  mine: MapDocumentV1,
  theirs: MapDocumentV1,
  options: { additive?: boolean } = {},
): MapDocumentV1 {
  return {
    ...mine,
    tilesets: unionTilesetsById(mine.tilesets, theirs.tilesets),
    layers: mergeTileLayers(base, mine, theirs, "mine"),
    objects: mergeObjectsById(base, mine, theirs, options.additive ?? false),
  };
}

/** @deprecated Use MapDocumentV1Schema. Kept as a migration-friendly alias. */
export const MapV1Schema = MapDocumentV1Schema;
/** @deprecated Use MapDocumentV1. */
export type MapV1 = MapDocumentV1;
/** @deprecated Use MapLayerV1. */
export type MapLayer = MapLayerV1;
/** @deprecated Use SpawnPointObjectV1. */
export type SpawnPoint = SpawnPointObjectV1;

export {
  canOccupy,
  collidesWithObject,
  moveWithCollisions,
  runtimeSpawn,
  type RuntimePosition,
} from "./runtime-geometry";

export interface OfficeMapSummaryDTO {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  publications: OfficeMapPublicationDTO[];
}

export interface OfficeMapDraftDTO {
  map: { id: string; name: string };
  revision: number;
  document: MapDocumentV1;
  savedAt: string;
  updatedBy: { id: string; name: string } | null;
  /**
   * Publicação/`decorRevision` de onde este rascunho foi semeado — a âncora do
   * merge 3-vias com o mapa vivo (`mergeAdminDraft`). `null` enquanto o mapa
   * não tiver publicação ativa.
   */
  basePublicationId?: string | null;
  baseDecorRevision?: number | null;
}

export interface OfficeMapAssetDTO {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width: number;
  height: number;
  checksum: string;
  url: string;
}

export interface OfficeMapLockDTO {
  lockToken: string;
  expiresAt: string;
  owner: { id: string; name: string };
}

export interface OfficeMapPublicationDTO {
  id: string;
  version: number;
  schemaVersion: string;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
  active: boolean;
}

export interface OfficeRoomDTO {
  id: string;
  name: string;
  externalKey: string;
  status: "OPEN" | "LOCKED";
  capacity: number | null;
  voiceEnabled: boolean;
  accessPolicy: "OPEN" | "ALLOWLIST";
  allowedUsers: Array<{ id: string; name: string }>;
}

/**
 * A sala vista por quem só vai marcar reunião: sem `id` (recriado a cada
 * publicação de mapa) e sem `allowedUsers` (a allowlist só interessa ao admin).
 */
export interface OfficeRoomOptionDTO {
  externalKey: string;
  name: string;
  capacity: number | null;
  status: "OPEN" | "LOCKED";
  voiceEnabled: boolean;
}

export interface OfficeDeskDTO {
  id: string;
  name: string;
  externalKey: string;
  claimedBy: { id: string; name: string } | null;
}

export interface OfficeDeskReminderSummaryDTO {
  id: string;
  deskId: string;
  deskExternalKey: string;
  giftPosition: { x: number; y: number };
  sender: { id: string; name: string };
  recipientId: string;
  createdAt: string;
}

export interface OfficeDeskReminderDetailDTO extends OfficeDeskReminderSummaryDTO {
  message: string | null;
  canRead: boolean;
}

export interface ActiveOfficeMapDTO {
  map: { id: string; name: string };
  publication: OfficeMapPublicationDTO;
  /**
   * Revisão de decoração da publicação ativa. É a âncora de concorrência do
   * editor colaborativo: o cliente devolve este número como `baseRevision` no
   * save, e o servidor usa a diferença para achar a base do merge.
   */
  decorRevision: number;
  document: MapDocumentV1;
  assets: OfficeMapAssetDTO[];
  rooms: OfficeRoomDTO[];
  desks: OfficeDeskDTO[];
  deskReminders: OfficeDeskReminderSummaryDTO[];
}

/** Corpo de `POST /office/map/edit/merge-publish`. */
export interface OfficeDecorSaveInput {
  baseRevision: number;
  document: MapDocumentV1;
}

/** Resposta de `POST /office/map/edit/merge-publish`. */
export interface OfficeDecorSaveResultDTO {
  decorRevision: number;
  document: MapDocumentV1;
}

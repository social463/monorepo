import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  MAP_DOCUMENT_V1_LIMITS,
  MAP_DOCUMENT_V1_SCHEMA_VERSION,
  MAP_VALIDATION_CODES,
  MapDocumentV1Schema,
  MapV1Schema,
  RESERVED_MAP_LAYERS,
  TileObjectV1Schema,
  MapObjectV1Schema,
  STRUCTURAL_LAYER_KEYS,
  UnsupportedMapDocumentVersionError,
  createEmptyMapDocumentV1,
  ensureReservedLayers,
  isProtectedFromMembers,
  migrateMapDocumentToLatest,
  type CollisionObjectV1,
  type DeskObjectV1,
  type MapDocumentV1,
  type MapObjectV1,
  type MapTileLayerV1,
  type MeetingRoomObjectV1,
  validateMapDocumentV1,
} from "./index";

function errorCodes(document: unknown) {
  const result = validateMapDocumentV1(document);
  return result.valid ? [] : result.errors.map((error) => error.code);
}

function tileLayer(document: MapDocumentV1, key = "floor") {
  return document.layers.find(
    (layer): layer is MapTileLayerV1 =>
      layer.type === "tile" && layer.key === key,
  )!;
}

function collision(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
): CollisionObjectV1 {
  return {
    id,
    layerKey: "collision",
    type: "collision",
    geometry: { kind: "rectangle", x, y, width, height },
    properties: {},
  };
}

function room(
  id: string,
  externalKey: string,
  x: number,
  y: number,
  width = 96,
  height = 64,
): MeetingRoomObjectV1 {
  return {
    id,
    layerKey: "meeting-rooms",
    type: "meeting-room",
    geometry: { kind: "rectangle", x, y, width, height },
    properties: {
      externalKey,
      name: `Sala ${externalKey}`,
      status: "OPEN",
      capacity: 8,
      voiceEnabled: true,
      accessPolicy: "OPEN",
    },
  };
}

function desk(id: string, externalKey: string, x: number, y: number): DeskObjectV1 {
  return {
    id,
    layerKey: "desks",
    type: "desk",
    geometry: { kind: "rectangle", x, y, width: 48, height: 32 },
    properties: { externalKey, name: `Mesa ${externalKey}` },
  };
}

describe("MapDocumentV1", () => {
  it("creates a valid, immediately editable empty document", () => {
    const document = createEmptyMapDocumentV1({
      width: 10,
      height: 12,
      tileSize: 16,
    });

    expect(document.schemaVersion).toBe(MAP_DOCUMENT_V1_SCHEMA_VERSION);
    expect(document.layers.map(({ key }) => key)).toEqual(
      RESERVED_MAP_LAYERS.map(({ key }) => key),
    );
    expect(document.layers).toHaveLength(9);
    expect(document.layers.filter(({ type }) => type === "tile")).toHaveLength(
      3,
    );
    expect(tileLayer(document).data).toHaveLength(120);
    expect(document.objects).toMatchObject([
      { type: "spawn-point", properties: { isDefault: true } },
    ]);
    expect(validateMapDocumentV1(document)).toMatchObject({ valid: true });
  });

  it("exports all product limits and rejects invalid factory options", () => {
    expect(MAP_DOCUMENT_V1_LIMITS.tileSizes).toEqual([16, 32, 48, 64]);
    expect(MAP_DOCUMENT_V1_LIMITS.maxLayers).toBe(50);
    expect(MAP_DOCUMENT_V1_LIMITS.maxObjects).toBe(10_000);
    expect(MAP_DOCUMENT_V1_LIMITS.maxTilesets).toBe(40);
    expect(MAP_DOCUMENT_V1_LIMITS.editLockTtlMs).toBe(120_000);
    expect(() => createEmptyMapDocumentV1({ width: 9 })).toThrow();
    expect(() => createEmptyMapDocumentV1({ tileSize: 24 as 16 })).toThrow();
  });

  it("is strict at the root and in nested records", () => {
    const document = createEmptyMapDocumentV1();
    expect(
      validateMapDocumentV1({ ...document, unexpected: true }),
    ).toMatchObject({
      valid: false,
      errors: expect.arrayContaining([
        expect.objectContaining({ code: MAP_VALIDATION_CODES.unknownField }),
      ]),
    });

    expect(
      validateMapDocumentV1({
        ...document,
        map: { ...document.map, legacyField: "not-allowed" },
      }),
    ).toMatchObject({ valid: false });
  });

  it("requires schema 1.0.0 and a square allowed tile size", () => {
    const document = createEmptyMapDocumentV1();
    expect(
      validateMapDocumentV1({ ...document, schemaVersion: "1.1.0" }),
    ).toMatchObject({ valid: false });

    document.map.tileHeight = 64;
    expect(errorCodes(document)).toContain(
      MAP_VALIDATION_CODES.tileSizeMismatch,
    );
  });

  it("requires every reserved layer exactly once and with its fixed type", () => {
    const missing = createEmptyMapDocumentV1();
    missing.layers = missing.layers.filter(({ key }) => key !== "collision");
    expect(errorCodes(missing)).toContain(
      MAP_VALIDATION_CODES.missingReservedLayer,
    );

    const duplicate = createEmptyMapDocumentV1();
    duplicate.layers.push({ ...tileLayer(duplicate), id: "extra-floor" });
    expect(errorCodes(duplicate)).toContain(
      MAP_VALIDATION_CODES.duplicateLayerKey,
    );

    const wrongType = createEmptyMapDocumentV1();
    const floorIndex = wrongType.layers.findIndex(({ key }) => key === "floor");
    wrongType.layers[floorIndex] = {
      id: "layer-floor",
      key: "floor",
      name: "Piso",
      type: "object",
      zIndex: 0,
      visible: true,
      locked: false,
      opacity: 1,
    };
    expect(errorCodes(wrongType)).toContain(
      MAP_VALIDATION_CODES.reservedLayerType,
    );
  });

  it("only permits additional visual tile layers", () => {
    const document = createEmptyMapDocumentV1();
    document.layers.push({
      id: "layer-custom",
      key: "custom-objects",
      name: "Objetos customizados",
      type: "object",
      zIndex: 200,
      visible: true,
      locked: false,
      opacity: 1,
    });
    expect(errorCodes(document)).toContain(
      MAP_VALIDATION_CODES.customObjectLayer,
    );
  });

  it("validates tile array lengths, tileset size and tile references", () => {
    const document = createEmptyMapDocumentV1({ width: 10, height: 10 });
    document.tilesets.push({
      id: "office-basic",
      assetId: "asset-office-basic",
      name: "Office Basic",
      tileWidth: 64,
      tileHeight: 64,
      columns: 2,
      tileCount: 4,
    });
    const floor = tileLayer(document);
    floor.data.pop();
    floor.data[0] = "missing:0";
    floor.data[1] = "office-basic:4";

    const codes = errorCodes(document);
    expect(codes).toEqual(
      expect.arrayContaining([
        MAP_VALIDATION_CODES.tilesetTileSizeMismatch,
        MAP_VALIDATION_CODES.tileDataLength,
        MAP_VALIDATION_CODES.tilesetNotFound,
        MAP_VALIDATION_CODES.tileIndexOutOfRange,
      ]),
    );
  });

  it("accepts freely positioned tile objects on visual layers", () => {
    const document = createEmptyMapDocumentV1();
    document.tilesets.push({
      id: "office-objects",
      assetId: "asset-office-objects",
      name: "Objetos do escritório",
      tileWidth: 32,
      tileHeight: 32,
      columns: 2,
      tileCount: 4,
    });
    document.objects.push({
      id: "tile-object-chair",
      layerKey: "objects",
      type: "tile-object",
      geometry: {
        kind: "rectangle",
        x: 45,
        y: 73,
        width: 32,
        height: 32,
      },
      properties: { tilesetId: "office-objects", tileIndex: 2 },
    });

    expect(validateMapDocumentV1(document)).toMatchObject({ valid: true });
  });

  it("validates the tileset, layer and dimensions of free tile objects", () => {
    const document = createEmptyMapDocumentV1();
    document.tilesets.push({
      id: "office-objects",
      assetId: "asset-office-objects",
      name: "Objetos do escritório",
      tileWidth: 32,
      tileHeight: 32,
      columns: 1,
      tileCount: 1,
    });
    document.objects.push({
      id: "tile-object-invalid",
      layerKey: "collision",
      type: "tile-object",
      geometry: {
        kind: "rectangle",
        x: 45,
        y: 73,
        width: 16,
        height: 16,
      },
      properties: { tilesetId: "office-objects", tileIndex: 1 },
    });

    expect(errorCodes(document)).toEqual(
      expect.arrayContaining([
        MAP_VALIDATION_CODES.objectLayerMismatch,
        MAP_VALIDATION_CODES.tileIndexOutOfRange,
        MAP_VALIDATION_CODES.tilesetTileSizeMismatch,
      ]),
    );
  });

  it("rejects malformed tile references structurally", () => {
    const document = createEmptyMapDocumentV1();
    tileLayer(document).data[0] = "not-a-reference";
    expect(errorCodes(document)).toContain(MAP_VALIDATION_CODES.schemaInvalid);
  });

  it("enforces globally unique IDs and unique object keys", () => {
    const document = createEmptyMapDocumentV1();
    document.tilesets.push({
      id: "spawn-main",
      assetId: "asset-1",
      name: "Duplicado",
      tileWidth: 32,
      tileHeight: 32,
      columns: 1,
      tileCount: 1,
    });
    document.objects.push(
      room("room-a", "aurora", 64, 64),
      room("room-b", "aurora", 256, 64),
      {
        id: "link-one",
        layerKey: "interactive-objects",
        type: "link",
        geometry: { kind: "point", x: 32, y: 32 },
        properties: {
          key: "resource",
          label: "Recurso",
          url: "https://example.com/one",
        },
      },
      {
        id: "link-two",
        layerKey: "interactive-objects",
        type: "link",
        geometry: { kind: "point", x: 48, y: 48 },
        properties: {
          key: "resource",
          label: "Outro recurso",
          url: "https://example.com/two",
        },
      },
    );

    expect(errorCodes(document)).toEqual(
      expect.arrayContaining([
        MAP_VALIDATION_CODES.duplicateId,
        MAP_VALIDATION_CODES.duplicateExternalKey,
        MAP_VALIDATION_CODES.duplicateInteractiveKey,
      ]),
    );
  });

  it("requires exactly one default spawn", () => {
    const noDefault = createEmptyMapDocumentV1();
    const spawn = noDefault.objects[0]!;
    if (spawn.type !== "spawn-point") throw new Error("fixture inválida");
    spawn.properties.isDefault = false;
    expect(errorCodes(noDefault)).toContain(
      MAP_VALIDATION_CODES.defaultSpawnCount,
    );

    const twoDefaults = createEmptyMapDocumentV1();
    twoDefaults.objects.push({
      id: "spawn-secondary",
      layerKey: "spawn-points",
      type: "spawn-point",
      geometry: { kind: "point", x: 10, y: 10 },
      properties: { name: "Outra entrada", isDefault: true },
    });
    expect(errorCodes(twoDefaults)).toContain(
      MAP_VALIDATION_CODES.defaultSpawnCount,
    );
  });

  it("rejects out-of-bounds geometries and spawns touching collisions", () => {
    const document = createEmptyMapDocumentV1({ width: 10, height: 10 });
    const spawn = document.objects[0]!;
    if (spawn.type !== "spawn-point") throw new Error("fixture inválida");
    spawn.geometry.x = 320;
    spawn.geometry.y = 16;
    document.objects.push(collision("collision-edge", 300, 0, 20, 32));
    expect(errorCodes(document)).toEqual(
      expect.arrayContaining([
        MAP_VALIDATION_CODES.geometryOutOfBounds,
        MAP_VALIDATION_CODES.spawnInCollision,
      ]),
    );
  });

  it("detects polygon self-intersection and zero area", () => {
    const document = createEmptyMapDocumentV1();
    document.objects.push({
      id: "collision-bow-tie",
      layerKey: "collision",
      type: "collision",
      geometry: {
        kind: "polygon",
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 100 },
          { x: 0, y: 100 },
          { x: 100, y: 0 },
        ],
      },
      properties: {},
    });

    expect(errorCodes(document)).toEqual(
      expect.arrayContaining([
        MAP_VALIDATION_CODES.polygonSelfIntersection,
        MAP_VALIDATION_CODES.polygonZeroArea,
      ]),
    );
  });

  it("detects polygonal collisions around the spawn", () => {
    const document = createEmptyMapDocumentV1({
      width: 10,
      height: 10,
      tileSize: 32,
    });
    const spawn = document.objects[0]!;
    if (spawn.type !== "spawn-point") throw new Error("fixture inválida");
    const { x, y } = spawn.geometry;
    document.objects.push({
      id: "collision-polygon",
      layerKey: "collision",
      type: "collision",
      geometry: {
        kind: "polygon",
        points: [
          { x: x - 20, y: y - 20 },
          { x: x + 20, y: y - 20 },
          { x, y: y + 20 },
        ],
      },
      properties: {},
    });
    expect(errorCodes(document)).toContain(
      MAP_VALIDATION_CODES.spawnInCollision,
    );
  });

  it("rejects overlapping rooms but allows rooms that only touch borders", () => {
    const overlapping = createEmptyMapDocumentV1();
    overlapping.objects.push(
      room("room-a", "aurora", 32, 32),
      room("room-b", "boreal", 64, 48),
    );
    expect(errorCodes(overlapping)).toContain(
      MAP_VALIDATION_CODES.meetingRoomOverlap,
    );

    const touching = createEmptyMapDocumentV1();
    touching.objects.push(
      room("room-a", "aurora", 32, 32),
      room("room-b", "boreal", 128, 32),
    );
    expect(errorCodes(touching)).not.toContain(
      MAP_VALIDATION_CODES.meetingRoomOverlap,
    );
  });

  it("validates interactive object type, layer, HTTPS and door targets", () => {
    const document = createEmptyMapDocumentV1();
    document.objects.push(
      {
        id: "door-a",
        layerKey: "walls",
        type: "door",
        geometry: { kind: "point", x: 32, y: 32 },
        properties: {
          key: "door-a",
          roomExternalKey: "missing-room",
          destination: { kind: "point", x: 64, y: 64 },
        },
      },
      {
        id: "link-a",
        layerKey: "interactive-objects",
        type: "link",
        geometry: { kind: "point", x: 32, y: 32 },
        properties: {
          key: "insecure-link",
          label: "Inseguro",
          url: "https://example.com",
        },
      },
    );

    expect(errorCodes(document)).toEqual(
      expect.arrayContaining([
        MAP_VALIDATION_CODES.objectLayerMismatch,
        MAP_VALIDATION_CODES.doorTargetConflict,
        MAP_VALIDATION_CODES.doorRoomNotFound,
      ]),
    );

    const insecureLink = createEmptyMapDocumentV1();
    insecureLink.objects.push({
      id: "link-http",
      layerKey: "interactive-objects",
      type: "link",
      geometry: { kind: "point", x: 32, y: 32 },
      properties: {
        key: "insecure-link",
        label: "Inseguro",
        url: "http://example.com",
      },
    });
    expect(errorCodes(insecureLink)).toContain(
      MAP_VALIDATION_CODES.schemaInvalid,
    );

    expect(
      validateMapDocumentV1({
        ...createEmptyMapDocumentV1(),
        objects: [
          ...createEmptyMapDocumentV1().objects,
          {
            id: "script-object",
            layerKey: "interactive-objects",
            type: "script",
            geometry: { kind: "point", x: 1, y: 1 },
            properties: { javascript: "alert(1)" },
          },
        ],
      }),
    ).toMatchObject({ valid: false });
  });

  it("returns navigable structured errors", () => {
    const document = createEmptyMapDocumentV1();
    document.objects.push(collision("collision-out", -1, 0, 10, 10));
    const result = validateMapDocumentV1(document);
    expect(result.valid).toBe(false);
    if (result.valid) throw new Error("resultado inesperado");
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: MAP_VALIDATION_CODES.geometryOutOfBounds,
        path: "objects[1].geometry",
        objectId: "collision-out",
        layerKey: "collision",
        message: expect.any(String),
      }),
    );
  });

  it("keeps MapV1Schema as an exact migration alias", () => {
    const document = createEmptyMapDocumentV1();
    expect(MapV1Schema).toBe(MapDocumentV1Schema);
    expect(MapV1Schema.parse(document)).toEqual(document);
  });

  it("routes persisted documents through an explicit version migration", () => {
    const document = createEmptyMapDocumentV1();
    expect(migrateMapDocumentToLatest(document)).toEqual(document);
    expect(() =>
      migrateMapDocumentToLatest({ ...document, schemaVersion: "2.0.0" }),
    ).toThrow(UnsupportedMapDocumentVersionError);
    expect(() => migrateMapDocumentToLatest({ version: "v1" })).toThrow(
      UnsupportedMapDocumentVersionError,
    );
  });
});

describe("publicação inicial da migration", () => {
  it("mantém o snapshot legado compatível com MapDocumentV1", () => {
    const sql = readFileSync(
      new URL(
        "../../../apps/api/prisma/migrations/20260715203000_office_map_editor_models/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const marker = "VALUES ('legacy-office-draft', 'legacy-office-map', '";
    const start = sql.indexOf(marker);
    const end = sql.indexOf("}'::jsonb", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const document = JSON.parse(sql.slice(start + marker.length, end + 1));
    const result = validateMapDocumentV1(document);
    expect(result).toMatchObject({ valid: true, errors: [] });
    expect(document.objects.filter((object: MapObjectV1) => object.type === "meeting-room")).toHaveLength(2);
    expect(document.objects.filter((object: MapObjectV1) => object.type === "spawn-point")).toHaveLength(6);
  });
});

describe("objeto desk", () => {
  it("aceita um objeto desk válido na layer 'desks'", () => {
    const document = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 });
    document.objects.push(desk("desk-1", "mesa-1", 64, 64));
    expect(validateMapDocumentV1(document)).toMatchObject({ valid: true });
  });

  it("rejeita duas mesas com a mesma externalKey", () => {
    const document = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 });
    document.objects.push(desk("desk-1", "mesa-1", 64, 64));
    document.objects.push(desk("desk-2", "mesa-1", 96, 64));
    const result = validateMapDocumentV1(document);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: MAP_VALIDATION_CODES.duplicateExternalKey }),
    );
  });

  it("rejeita objeto desk na layer errada", () => {
    const document = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 });
    const invalid = desk("desk-1", "mesa-1", 64, 64);
    invalid.layerKey = "interactive-objects";
    document.objects.push(invalid);
    const result = validateMapDocumentV1(document);
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: MAP_VALIDATION_CODES.objectLayerMismatch }),
    );
  });
});

describe("ensureReservedLayers", () => {
  it("preenche a layer 'desks' que falta em um mapa anterior à feature de mesas", () => {
    const document = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 });
    const legacy = { ...document, layers: document.layers.filter((layer) => layer.key !== "desks") };
    expect(validateMapDocumentV1(legacy)).toMatchObject({
      valid: false,
      errors: [expect.objectContaining({ code: MAP_VALIDATION_CODES.missingReservedLayer, layerKey: "desks" })],
    });

    const healed = ensureReservedLayers(legacy);
    expect(healed.layers).toContainEqual(
      expect.objectContaining({ key: "desks", type: "object" }),
    );
    expect(validateMapDocumentV1(healed)).toMatchObject({ valid: true });
  });

  it("não altera nada quando todas as layers reservadas já existem", () => {
    const document = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 });
    expect(ensureReservedLayers(document)).toBe(document);
  });
});

describe("TileObjectV1Schema — orientação", () => {
  const base = {
    id: "obj-1",
    layerKey: "objects",
    type: "tile-object" as const,
    geometry: { kind: "rectangle" as const, x: 0, y: 0, width: 16, height: 16 },
    properties: { tilesetId: "builtin-office", tileIndex: 3 },
  };

  it("aceita um tile-object sem orientação (retrocompatível)", () => {
    expect(TileObjectV1Schema.safeParse(base).success).toBe(true);
  });

  it("aceita rotation de 90 em 90 e flipX", () => {
    for (const rotation of [0, 90, 180, 270]) {
      const parsed = TileObjectV1Schema.safeParse({
        ...base,
        properties: { ...base.properties, rotation, flipX: true },
      });
      expect(parsed.success).toBe(true);
    }
  });

  it("rejeita rotation fora dos múltiplos de 90", () => {
    const parsed = TileObjectV1Schema.safeParse({
      ...base,
      properties: { ...base.properties, rotation: 45 },
    });
    expect(parsed.success).toBe(false);
  });

  it("preserva a orientação num round-trip de parse", () => {
    const parsed = TileObjectV1Schema.parse({
      ...base,
      properties: { ...base.properties, rotation: 270, flipX: true },
    });
    expect(parsed.properties.rotation).toBe(270);
    expect(parsed.properties.flipX).toBe(true);
  });
});

describe("createdBy nos objetos", () => {
  const base = {
    id: "obj-1",
    layerKey: "objects",
    type: "collision",
    geometry: { kind: "rectangle", x: 0, y: 0, width: 32, height: 32 },
    properties: {},
  } as const;

  it("aceita objeto sem createdBy (legado)", () => {
    expect(MapObjectV1Schema.safeParse(base).success).toBe(true);
  });

  it("aceita createdBy com id e role", () => {
    const parsed = MapObjectV1Schema.safeParse({
      ...base,
      createdBy: { id: "u1", role: "ADMIN" },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejeita role fora do enum", () => {
    const parsed = MapObjectV1Schema.safeParse({
      ...base,
      createdBy: { id: "u1", role: "SUPERUSER" },
    });
    expect(parsed.success).toBe(false);
  });
});

describe("isProtectedFromMembers", () => {
  const obj = (createdBy: MapObjectV1["createdBy"]): MapObjectV1 =>
    ({
      id: "o",
      layerKey: "objects",
      type: "collision",
      geometry: { kind: "rectangle", x: 0, y: 0, width: 32, height: 32 },
      properties: {},
      createdBy,
    }) as MapObjectV1;

  it("protege objeto legado (createdBy nulo/ausente)", () => {
    expect(isProtectedFromMembers(obj(null))).toBe(true);
  });
  it("protege objeto criado por admin", () => {
    expect(isProtectedFromMembers(obj({ id: "a", role: "ADMIN" }))).toBe(true);
  });
  it("NÃO protege objeto criado por comum", () => {
    expect(isProtectedFromMembers(obj({ id: "m", role: "LEGEND" }))).toBe(
      false,
    );
  });
});

describe("STRUCTURAL_LAYER_KEYS", () => {
  it("inclui piso e paredes", () => {
    expect([...STRUCTURAL_LAYER_KEYS]).toEqual(["walls", "floor"]);
  });
});

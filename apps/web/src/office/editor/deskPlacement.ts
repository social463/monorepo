import {
  OFFICE_DESK_SIZE_TILES,
  type MapDocumentV1,
  type MapObjectV1,
  type RectangleGeometryV1,
} from "@legends/shared";

/** Nome inicial da mesa e da sala que nasce com ela. */
const DEFAULT_DESK_NAME = "Nova mesa";

export interface DeskAnchorCell {
  column: number;
  row: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Retângulo de 3×2 tiles ancorado na célula. Perto das bordas a âncora é
 * empurrada pra dentro em vez de recortar a mesa: mesa de tamanho fixo nunca
 * pode nascer menor, e geometria fora dos limites reprova na validação.
 */
export function deskPlacementGeometry(
  document: MapDocumentV1,
  anchor: DeskAnchorCell,
): RectangleGeometryV1 {
  const { width, height, tileWidth, tileHeight } = document.map;
  const column = clamp(anchor.column, 0, width - OFFICE_DESK_SIZE_TILES.width);
  const row = clamp(anchor.row, 0, height - OFFICE_DESK_SIZE_TILES.height);
  return {
    kind: "rectangle",
    x: column * tileWidth,
    y: row * tileHeight,
    width: OFFICE_DESK_SIZE_TILES.width * tileWidth,
    height: OFFICE_DESK_SIZE_TILES.height * tileHeight,
  };
}

/**
 * Caixa envolvente de uma geometria de sala. Para polígonos isso é
 * conservador (pode acusar sobreposição em quase-encostado), o que é o lado
 * seguro: na dúvida, não criamos uma segunda sala — a mesa já fica dentro da
 * que existe.
 */
function boundingBox(geometry: MapObjectV1["geometry"]) {
  if (geometry.kind === "rectangle") {
    return {
      left: geometry.x,
      top: geometry.y,
      right: geometry.x + geometry.width,
      bottom: geometry.y + geometry.height,
    };
  }
  if (geometry.kind === "point") {
    return { left: geometry.x, top: geometry.y, right: geometry.x, bottom: geometry.y };
  }
  const xs = geometry.points.map((point) => point.x);
  const ys = geometry.points.map((point) => point.y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

function overlapsMeetingRoom(
  document: MapDocumentV1,
  geometry: RectangleGeometryV1,
): boolean {
  const desk = boundingBox(geometry);
  return document.objects.some((object) => {
    if (object.type !== "meeting-room") return false;
    const room = boundingBox(object.geometry);
    // Comparação estrita: salas apenas encostadas não se sobrepõem.
    return (
      desk.left < room.right &&
      desk.right > room.left &&
      desk.top < room.bottom &&
      desk.bottom > room.top
    );
  });
}

/**
 * Objetos que a ferramenta "mesa" insere: a mesa e, junto, a sala de chamada
 * dela com a MESMA área. A sala é omitida quando a mesa cai dentro de uma sala
 * existente (a validação do documento proíbe salas sobrepostas) ou quando a
 * layer de salas está travada/oculta (`withRoom: false`). A mesa é sempre o
 * primeiro item — é ela que o editor seleciona depois de criar.
 */
export function deskPlacementObjects(
  document: MapDocumentV1,
  anchor: DeskAnchorCell,
  token: string,
  options: { withRoom?: boolean } = {},
): MapObjectV1[] {
  const geometry = deskPlacementGeometry(document, anchor);
  const desk: MapObjectV1 = {
    id: `desk-${token}`,
    layerKey: "desks",
    type: "desk",
    geometry,
    properties: { externalKey: `desk-${token}`, name: DEFAULT_DESK_NAME },
  };
  const withRoom = options.withRoom ?? true;
  if (!withRoom || overlapsMeetingRoom(document, geometry)) return [desk];

  const room: MapObjectV1 = {
    id: `meeting-room-${token}`,
    layerKey: "meeting-rooms",
    type: "meeting-room",
    geometry: { ...geometry },
    properties: {
      externalKey: `room-${token}`,
      name: DEFAULT_DESK_NAME,
      status: "OPEN",
      voiceEnabled: true,
      accessPolicy: "OPEN",
    },
  };
  return [desk, room];
}

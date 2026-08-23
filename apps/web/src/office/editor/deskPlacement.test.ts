import { describe, expect, it } from "vitest";
import { createEmptyMapDocumentV1, validateMapDocumentV1, type MapDocumentV1 } from "@legends/shared";
import { deskPlacementGeometry, deskPlacementObjects } from "./deskPlacement";

function emptyDocument(): MapDocumentV1 {
  return createEmptyMapDocumentV1({ width: 20, height: 20, tileSize: 32 });
}

describe("deskPlacementGeometry", () => {
  it("sempre gera 3x2 tiles ancorados na célula", () => {
    expect(deskPlacementGeometry(emptyDocument(), { column: 4, row: 5 })).toEqual({
      kind: "rectangle",
      x: 128,
      y: 160,
      width: 96,
      height: 64,
    });
  });

  it("empurra a âncora pra dentro do mapa nas bordas", () => {
    const document = emptyDocument();
    expect(deskPlacementGeometry(document, { column: 19, row: 19 })).toEqual({
      kind: "rectangle",
      x: 17 * 32,
      y: 18 * 32,
      width: 96,
      height: 64,
    });
    expect(deskPlacementGeometry(document, { column: -3, row: -1 })).toEqual({
      kind: "rectangle",
      x: 0,
      y: 0,
      width: 96,
      height: 64,
    });
  });
});

describe("deskPlacementObjects", () => {
  it("cria a mesa e a sala de chamada com a mesma geometria", () => {
    const [desk, room] = deskPlacementObjects(emptyDocument(), { column: 2, row: 2 }, "abc");

    expect(desk).toEqual({
      id: "desk-abc",
      layerKey: "desks",
      type: "desk",
      geometry: { kind: "rectangle", x: 64, y: 64, width: 96, height: 64 },
      properties: { externalKey: "desk-abc", name: "Nova mesa" },
    });
    expect(room).toEqual({
      id: "meeting-room-abc",
      layerKey: "meeting-rooms",
      type: "meeting-room",
      geometry: { kind: "rectangle", x: 64, y: 64, width: 96, height: 64 },
      properties: {
        externalKey: "room-abc",
        name: "Nova mesa",
        status: "OPEN",
        voiceEnabled: true,
        accessPolicy: "OPEN",
      },
    });
  });

  it("dentro de uma sala existente cria só a mesa (salas não podem se sobrepor)", () => {
    const document = emptyDocument();
    document.objects.push({
      id: "room-1",
      layerKey: "meeting-rooms",
      type: "meeting-room",
      geometry: { kind: "rectangle", x: 0, y: 0, width: 320, height: 320 },
      properties: {
        externalKey: "aurora",
        name: "Aurora",
        status: "OPEN",
        voiceEnabled: true,
        accessPolicy: "OPEN",
      },
    });

    const objects = deskPlacementObjects(document, { column: 2, row: 2 }, "abc");

    expect(objects).toHaveLength(1);
    expect(objects[0]!.type).toBe("desk");
  });

  it("mesa encostada na sala vizinha, sem invadir, continua ganhando a própria sala", () => {
    const document = emptyDocument();
    document.objects.push({
      id: "room-1",
      layerKey: "meeting-rooms",
      type: "meeting-room",
      geometry: { kind: "rectangle", x: 0, y: 0, width: 64, height: 64 },
      properties: {
        externalKey: "aurora",
        name: "Aurora",
        status: "OPEN",
        voiceEnabled: true,
        accessPolicy: "OPEN",
      },
    });

    expect(deskPlacementObjects(document, { column: 2, row: 0 }, "abc")).toHaveLength(2);
  });

  it("com a layer de salas indisponível cria só a mesa", () => {
    const objects = deskPlacementObjects(emptyDocument(), { column: 2, row: 2 }, "abc", {
      withRoom: false,
    });

    expect(objects).toHaveLength(1);
    expect(objects[0]!.type).toBe("desk");
  });

  it("duas mesas encostadas, cada uma com sua sala, publicam num documento válido", () => {
    const document = emptyDocument();
    // A segunda chamada precisa enxergar a sala inserida pela primeira: só
    // assim a mesa "b" (encostada, não sobreposta) também ganha sala própria
    // e o teste prova o caso de DUAS salas, não uma mesa sem sala.
    document.objects.push(...deskPlacementObjects(document, { column: 2, row: 2 }, "a"));
    document.objects.push(...deskPlacementObjects(document, { column: 5, row: 2 }, "b"));

    expect(document.objects.filter((object) => object.type === "desk")).toHaveLength(2);
    expect(document.objects.filter((object) => object.type === "meeting-room")).toHaveLength(2);

    const result = validateMapDocumentV1(document);
    expect(result.valid).toBe(true);
  });
});

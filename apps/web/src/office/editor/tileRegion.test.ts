import { describe, expect, it } from "vitest";
import {
  clampRect,
  clearRect,
  fillWithStamp,
  moveRect,
  paintStamp,
  pasteClip,
  readClip,
  rectContains,
  rectFromCells,
  tileStamp,
  type TileGrid,
} from "./tileRegion";

const grid: TileGrid = { width: 4, height: 3 };

/** Mapa 4×3 vazio. */
function emptyData(): Array<string | null> {
  return Array.from({ length: grid.width * grid.height }, () => null);
}

describe("tileStamp", () => {
  it("carimbo 1×1 é o tile da âncora", () => {
    expect(
      tileStamp({ tilesetId: "ts", columns: 4, tileCount: 16, tileIndex: 5 }),
    ).toEqual([{ dc: 0, dr: 0, reference: "ts:5" }]);
  });

  it("bloco cols×rows anda pelas linhas do tileset", () => {
    expect(
      tileStamp({
        tilesetId: "ts",
        columns: 4,
        tileCount: 16,
        tileIndex: 0,
        cols: 2,
        rows: 2,
      }),
    ).toEqual([
      { dc: 0, dr: 0, reference: "ts:0" },
      { dc: 1, dr: 0, reference: "ts:1" },
      { dc: 0, dr: 1, reference: "ts:4" },
      { dc: 1, dr: 1, reference: "ts:5" },
    ]);
  });

  it("recorta na borda do tileset em vez de dobrar para a próxima linha", () => {
    // âncora na última coluna: a segunda coluna do bloco não existe.
    expect(
      tileStamp({
        tilesetId: "ts",
        columns: 4,
        tileCount: 16,
        tileIndex: 3,
        cols: 2,
        rows: 1,
      }),
    ).toEqual([{ dc: 0, dr: 0, reference: "ts:3" }]);
  });

  it("descarta linha que passa do fim do tileset", () => {
    expect(
      tileStamp({
        tilesetId: "ts",
        columns: 4,
        tileCount: 8,
        tileIndex: 4,
        cols: 1,
        rows: 3,
      }),
    ).toEqual([{ dc: 0, dr: 0, reference: "ts:4" }]);
  });

  it("índice inválido não gera carimbo", () => {
    expect(
      tileStamp({ tilesetId: "ts", columns: 4, tileCount: 8, tileIndex: 8 }),
    ).toEqual([]);
  });
});

describe("paintStamp", () => {
  const stamp = tileStamp({
    tilesetId: "ts",
    columns: 4,
    tileCount: 16,
    tileIndex: 0,
    cols: 2,
    rows: 2,
  });

  it("escreve o bloco inteiro a partir da âncora", () => {
    const next = paintStamp(emptyData(), grid, { column: 1, row: 0 }, stamp);
    expect(next).toEqual([
      null, "ts:0", "ts:1", null,
      null, "ts:4", "ts:5", null,
      null, null, null, null,
    ]);
  });

  it("descarta o que cai fora do mapa", () => {
    const next = paintStamp(emptyData(), grid, { column: 3, row: 2 }, stamp);
    expect(next).toEqual([
      null, null, null, null,
      null, null, null, null,
      null, null, null, "ts:0",
    ]);
  });

  it("devolve null quando o bloco já está pintado igual", () => {
    const painted = paintStamp(emptyData(), grid, { column: 0, row: 0 }, stamp)!;
    expect(paintStamp(painted, grid, { column: 0, row: 0 }, stamp)).toBeNull();
  });
});

describe("fillWithStamp", () => {
  it("preenche a área contígua repetindo o carimbo como padrão", () => {
    const stamp = tileStamp({
      tilesetId: "ts",
      columns: 2,
      tileCount: 4,
      tileIndex: 0,
      cols: 2,
      rows: 1,
    });
    const next = fillWithStamp(
      emptyData(),
      grid,
      { column: 0, row: 0 },
      stamp,
      { cols: 2, rows: 1 },
    );
    expect(next).toEqual([
      "ts:0", "ts:1", "ts:0", "ts:1",
      "ts:0", "ts:1", "ts:0", "ts:1",
      "ts:0", "ts:1", "ts:0", "ts:1",
    ]);
  });

  it("não vaza para células de referência diferente", () => {
    const data = emptyData();
    data[1] = "outro:9";
    data[5] = "outro:9";
    data[9] = "outro:9";
    const stamp = tileStamp({
      tilesetId: "ts",
      columns: 2,
      tileCount: 4,
      tileIndex: 0,
    });
    const next = fillWithStamp(data, grid, { column: 0, row: 0 }, stamp, {
      cols: 1,
      rows: 1,
    });
    expect(next).toEqual([
      "ts:0", "outro:9", null, null,
      "ts:0", "outro:9", null, null,
      "ts:0", "outro:9", null, null,
    ]);
  });

  it("termina mesmo quando o padrão repõe o tile antigo", () => {
    // o padrão contém o próprio tile de destino: sem conjunto de visitados a
    // varredura ficaria em laço.
    const data = emptyData().map(() => "ts:0" as string | null);
    const stamp = tileStamp({
      tilesetId: "ts",
      columns: 2,
      tileCount: 4,
      tileIndex: 0,
      cols: 2,
      rows: 1,
    });
    const next = fillWithStamp(data, grid, { column: 0, row: 0 }, stamp, {
      cols: 2,
      rows: 1,
    });
    expect(next).toEqual([
      "ts:0", "ts:1", "ts:0", "ts:1",
      "ts:0", "ts:1", "ts:0", "ts:1",
      "ts:0", "ts:1", "ts:0", "ts:1",
    ]);
  });
});

describe("retângulo de seleção", () => {
  it("normaliza arrasto em qualquer direção", () => {
    expect(rectFromCells({ column: 3, row: 2 }, { column: 1, row: 1 })).toEqual({
      column: 1,
      row: 1,
      cols: 3,
      rows: 2,
    });
  });

  it("recorta ao mapa e devolve null quando fica fora", () => {
    expect(clampRect({ column: 2, row: 1, cols: 5, rows: 5 }, grid)).toEqual({
      column: 2,
      row: 1,
      cols: 2,
      rows: 2,
    });
    expect(clampRect({ column: 9, row: 9, cols: 2, rows: 2 }, grid)).toBeNull();
  });

  it("rectContains cobre só o interior", () => {
    const rect = { column: 1, row: 1, cols: 2, rows: 1 };
    expect(rectContains(rect, { column: 2, row: 1 })).toBe(true);
    expect(rectContains(rect, { column: 3, row: 1 })).toBe(false);
    expect(rectContains(rect, { column: 1, row: 2 })).toBe(false);
  });
});

describe("recortar, colar e mover", () => {
  function painted(): Array<string | null> {
    const data = emptyData();
    data[0] = "ts:0";
    data[1] = "ts:1";
    data[4] = "ts:4";
    return data;
  }

  it("readClip leva os vazios junto", () => {
    expect(readClip(painted(), grid, { column: 0, row: 0, cols: 2, rows: 2 }))
      .toEqual({ cols: 2, rows: 2, tiles: ["ts:0", "ts:1", "ts:4", null] });
  });

  it("clearRect apaga só o retângulo", () => {
    expect(
      clearRect(painted(), grid, { column: 0, row: 0, cols: 1, rows: 2 }),
    ).toEqual([
      null, "ts:1", null, null,
      null, null, null, null,
      null, null, null, null,
    ]);
  });

  it("clearRect devolve null em área já vazia", () => {
    expect(
      clearRect(painted(), grid, { column: 2, row: 1, cols: 2, rows: 2 }),
    ).toBeNull();
  });

  it("pasteClip reproduz o recorte, vazios inclusive", () => {
    const clip = readClip(painted(), grid, {
      column: 0,
      row: 0,
      cols: 2,
      rows: 2,
    });
    const target = emptyData();
    target[7] = "sujo:1"; // será sobrescrito pelo vazio do recorte
    expect(pasteClip(target, grid, { column: 2, row: 0 }, clip)).toEqual([
      null, null, "ts:0", "ts:1",
      null, null, "ts:4", null,
      null, null, null, null,
    ]);
  });

  it("moveRect esvazia a origem", () => {
    expect(
      moveRect(
        painted(),
        grid,
        { column: 0, row: 0, cols: 2, rows: 2 },
        { column: 2, row: 1 },
      ),
    ).toEqual([
      null, null, null, null,
      null, null, "ts:0", "ts:1",
      null, null, "ts:4", null,
    ]);
  });

  it("moveRect sobreposto não perde tile", () => {
    expect(
      moveRect(
        painted(),
        grid,
        { column: 0, row: 0, cols: 2, rows: 2 },
        { column: 1, row: 0 },
      ),
    ).toEqual([
      null, "ts:0", "ts:1", null,
      null, "ts:4", null, null,
      null, null, null, null,
    ]);
  });

  it("moveRect para o mesmo lugar devolve null", () => {
    expect(
      moveRect(
        painted(),
        grid,
        { column: 0, row: 0, cols: 2, rows: 2 },
        { column: 0, row: 0 },
      ),
    ).toBeNull();
  });
});

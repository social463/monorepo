import { describe, it, expect } from "vitest";
import {
  OFFICE_ANNOTATION_MAX_POINTS,
  sanitizeAnnotationPoints,
} from "./office-annotation";

describe("sanitizeAnnotationPoints", () => {
  it("aceita pontos dentro de 0–1 e arredonda para 3 casas", () => {
    expect(sanitizeAnnotationPoints([{ x: 0.123456, y: 0.9 }])).toEqual([
      { x: 0.123, y: 0.9 },
    ]);
  });

  it("aceita os limites exatos 0 e 1", () => {
    expect(sanitizeAnnotationPoints([{ x: 0, y: 0 }])).toEqual([
      { x: 0, y: 0 },
    ]);
    expect(sanitizeAnnotationPoints([{ x: 1, y: 1 }])).toEqual([
      { x: 1, y: 1 },
    ]);
  });

  it("aceita -0 na validação; -0 é preservado até JSON.stringify", () => {
    // -0 passa na validação porque -0 >= 0 é true
    // Math.round(-0 * 1000) / 1000 retorna -0, não +0
    const result = sanitizeAnnotationPoints([{ x: -0, y: -0 }]);
    expect(result).not.toBeNull();
    expect(result!).toHaveLength(1);
    expect(Object.is(result![0].x, -0)).toBe(true);
    expect(Object.is(result![0].y, -0)).toBe(true);
    // Na serialização JSON, -0 vira 0 — assim chegam iguais ao outro lado da rede
    expect(JSON.stringify(result)).toBe("[{\"x\":0,\"y\":0}]");
  });

  it("recusa o que não é lista de pontos", () => {
    expect(sanitizeAnnotationPoints(undefined)).toBeNull();
    expect(sanitizeAnnotationPoints("0,0")).toBeNull();
    expect(sanitizeAnnotationPoints([{ x: 0.5 }])).toBeNull();
    expect(sanitizeAnnotationPoints([{ x: "0.5", y: 0.5 }])).toBeNull();
  });

  it("recusa lista vazia — um lote sem ponto não é traço", () => {
    expect(sanitizeAnnotationPoints([])).toBeNull();
  });

  it("recusa coordenada fora de 0–1 ou não finita", () => {
    expect(sanitizeAnnotationPoints([{ x: -0.01, y: 0.5 }])).toBeNull();
    expect(sanitizeAnnotationPoints([{ x: 0.5, y: 1.01 }])).toBeNull();
    expect(sanitizeAnnotationPoints([{ x: Number.NaN, y: 0.5 }])).toBeNull();
    expect(sanitizeAnnotationPoints([{ x: 0.5, y: Number.NaN }])).toBeNull();
    expect(sanitizeAnnotationPoints([{ x: 0.5, y: Number.POSITIVE_INFINITY }])).toBeNull();
    expect(sanitizeAnnotationPoints([{ x: Number.POSITIVE_INFINITY, y: 0.5 }])).toBeNull();
  });

  it("recusa lote acima do teto em vez de cortar — cliente honesto nunca passa disso", () => {
    const points = Array.from({ length: OFFICE_ANNOTATION_MAX_POINTS + 1 }, () => ({
      x: 0.5,
      y: 0.5,
    }));
    expect(sanitizeAnnotationPoints(points)).toBeNull();
    expect(sanitizeAnnotationPoints(points.slice(1))).toHaveLength(
      OFFICE_ANNOTATION_MAX_POINTS,
    );
  });
});

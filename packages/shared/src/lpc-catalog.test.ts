import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CATALOG_BY_ID,
  CATALOG_CATEGORIES,
  CATEGORY_GROUPS,
  LPC_CATALOG,
  categoryLabel,
  itemsForCategory,
} from "./lpc-catalog";

const LPC_ROOT = join(__dirname, "..", "..", "..", "apps", "web", "public", "lpc");

describe("lpc-catalog", () => {
  it("tem centenas de definições e índices coerentes", () => {
    expect(LPC_CATALOG.length).toBeGreaterThan(550);
    expect(CATALOG_BY_ID.size).toBe(LPC_CATALOG.length);
    expect(CATALOG_BY_ID.get("hair_afro")?.category).toBe("hair");
    expect(CATALOG_CATEGORIES).toContain("body");
    expect(CATALOG_CATEGORIES).toContain("weapon");
  });

  it("toda entrada é estruturalmente válida", () => {
    for (const entry of LPC_CATALOG) {
      expect(entry.layers.length, entry.id).toBeGreaterThan(0);
      expect(entry.variants.length, entry.id).toBeGreaterThan(0);
      expect(entry.bodyTypes.length, entry.id).toBeGreaterThan(0);
      for (const layer of entry.layers) {
        for (const bt of entry.bodyTypes) {
          expect(layer.paths[bt], `${entry.id}: camada sem path para ${bt}`).toBeTruthy();
        }
      }
    }
  });

  it("todo path×variante do catálogo existe em apps/web/public/lpc", () => {
    const missing: string[] = [];
    for (const entry of LPC_CATALOG) {
      const folders = new Set(entry.layers.flatMap((l) => Object.values(l.paths) as string[]));
      for (const folder of folders) {
        for (const variant of entry.variants) {
          if (!existsSync(join(LPC_ROOT, folder, `${variant}.png`))) {
            missing.push(`${entry.id}: ${folder}/${variant}.png`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it("itemsForCategory filtra por corpo", () => {
    const childHair = itemsForCategory("hair", "child");
    const maleHair = itemsForCategory("hair", "male");
    expect(maleHair.length).toBeGreaterThan(childHair.length);
    expect(maleHair.every((e) => e.category === "hair")).toBe(true);
  });

  it("grupos cobrem as categorias e labels têm fallback", () => {
    const grouped = new Set(CATEGORY_GROUPS.flatMap((g) => g.categories));
    for (const cat of CATALOG_CATEGORIES) expect(grouped.has(cat), cat).toBe(true);
    expect(categoryLabel("hair")).toBe("Cabelo");
    expect(categoryLabel("categoria_inexistente")).toBe("categoria_inexistente");
  });
});

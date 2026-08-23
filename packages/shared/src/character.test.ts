import { describe, expect, it } from "vitest";
import {
  BODY_TYPES,
  characterHash,
  characterSignature,
  isCharacterOptions,
  sanitizeCharacterOptions,
  type CharacterOptions,
} from "./character";

export const VALID_V2: CharacterOptions = {
  bodyType: "female",
  items: {
    body: { item: "body", variant: "olive" },
    head: { item: "heads_human_female", variant: "olive" },
    hair: { item: "hair_afro", variant: "blonde" },
    clothes: { item: "torso_clothes_shortsleeve", variant: "navy" },
    legs: { item: "legs_pants", variant: "black" },
    shoes: { item: "feet_shoes", variant: "brown" },
  },
};

describe("isCharacterOptions (v2)", () => {
  it("aceita options completas válidas", () => {
    expect(isCharacterOptions(VALID_V2)).toBe(true);
  });

  it("exige items.body", () => {
    const { body: _body, ...rest } = VALID_V2.items;
    expect(isCharacterOptions({ ...VALID_V2, items: rest })).toBe(false);
  });

  it("aceita os 6 corpos e rejeita corpo desconhecido", () => {
    expect(BODY_TYPES).toHaveLength(6);
    const minimal = { bodyType: "muscular", items: { body: { item: "body", variant: "light" } } };
    expect(isCharacterOptions(minimal)).toBe(true);
    expect(isCharacterOptions({ ...minimal, bodyType: "alien" })).toBe(false);
  });

  it("rejeita item fora da categoria, variante e corpo incompatíveis", () => {
    expect(isCharacterOptions({ ...VALID_V2, items: { ...VALID_V2.items, hair: { item: "legs_pants", variant: "black" } } })).toBe(false);
    expect(isCharacterOptions({ ...VALID_V2, items: { ...VALID_V2.items, hair: { item: "hair_afro", variant: "xadrez" } } })).toBe(false);
    // heads_human_female não suporta child? não garantido — usa um caso garantido:
    // body_skeleton só tem male/female; child é incompatível.
    expect(isCharacterOptions({ bodyType: "child", items: { body: { item: "body_skeleton", variant: "skeleton" } } })).toBe(false);
  });

  it("rejeita o shape v1 legado", () => {
    expect(isCharacterOptions({ bodyType: "male", skinTone: "light", hair: null, beard: null, torso: { item: "shortsleeve", color: "navy" }, legs: { item: "pants", color: "black" }, feet: { item: "shoes", color: "brown" }, glasses: null, hat: null })).toBe(false);
  });

  it("aceita corpos especiais (esqueleto/zumbi) e peles fantasia", () => {
    expect(isCharacterOptions({ bodyType: "male", items: { body: { item: "body_zombie", variant: "zombie" } } })).toBe(true);
    expect(isCharacterOptions({ bodyType: "male", items: { body: { item: "body", variant: "lavender" } } })).toBe(true);
  });
});

describe("sanitizeCharacterOptions", () => {
  it("descarta chaves extras e categorias com valor lixo", () => {
    const dirty = {
      ...VALID_V2,
      hacked: true,
      items: { ...VALID_V2.items, weapon: { item: "hair_afro", variant: "blonde" }, extra: "lixo" },
    } as unknown as CharacterOptions;
    const clean = sanitizeCharacterOptions(dirty);
    expect(Object.keys(clean)).toEqual(["bodyType", "items"]);
    expect(clean.items.weapon).toBeUndefined();
    expect((clean.items as Record<string, unknown>).extra).toBeUndefined();
    expect(clean.items.hair).toEqual({ item: "hair_afro", variant: "blonde" });
  });
});

describe("characterSignature", () => {
  it("é canônica e insensível à ordem das categorias", () => {
    const reordered: CharacterOptions = {
      bodyType: VALID_V2.bodyType,
      items: Object.fromEntries(Object.entries(VALID_V2.items).reverse()),
    };
    expect(characterSignature(reordered)).toBe(characterSignature(VALID_V2));
    expect(characterSignature(VALID_V2)).toContain("hair:hair_afro:blonde");
  });

  it("muda quando qualquer escolha muda", () => {
    const other = { ...VALID_V2, items: { ...VALID_V2.items, hair: { item: "hair_afro", variant: "ash" } } };
    expect(characterSignature(other)).not.toBe(characterSignature(VALID_V2));
  });
});

describe("characterHash", () => {
  it("é determinístico", () => {
    expect(characterHash("abc")).toBe(characterHash("abc"));
    expect(characterHash("abc")).not.toBe(characterHash("abd"));
  });
});

import {
  characterLayers,
  defaultCharacterFromSeed,
  defaultHeadFor,
  migrateCharacterOptions,
} from "./character";

describe("characterLayers (v2)", () => {
  it("expande multi-camadas com zPos próprios e ordena", () => {
    const withBackpack: CharacterOptions = {
      bodyType: "male",
      items: {
        body: { item: "body", variant: "light" },
        backpack: { item: "backpack_basket", variant: "round" },
      },
    };
    const layers = characterLayers(withBackpack);
    // basket tem fg (zPos 130) e bg (zPos 5) — bg vem ANTES do corpo (zPos 10)
    expect(layers.length).toBe(3);
    expect(layers[0].zPos).toBeLessThan(10);
    expect(layers[0].path).toMatch(/backpack\/basket\/bg\/round\.png$/);
    expect(layers.at(-1)!.path).toMatch(/backpack\/basket\/fg\/round\.png$/);
    expect(layers.map((l) => l.zPos)).toEqual([...layers.map((l) => l.zPos)].sort((a, b) => a - b));
  });

  it("resolve o path pelo tipo de corpo", () => {
    const layers = characterLayers(VALID_V2); // female
    expect(layers.find((l) => l.path.includes("bodies"))!.path).toBe("body/bodies/female/olive.png");
  });
});

describe("defaultCharacterFromSeed", () => {
  it("é determinístico, civil e válido", () => {
    const a = defaultCharacterFromSeed("waghner");
    expect(a).toEqual(defaultCharacterFromSeed("waghner"));
    expect(isCharacterOptions(a)).toBe(true);
    expect(a.items.body.item).toBe("body");
    expect(a.items.head).toBeTruthy();
    expect(a.items.weapon).toBeUndefined();
    expect(["male", "female"]).toContain(a.bodyType);
  });

  it("seeds diferentes variam o personagem", () => {
    expect(characterSignature(defaultCharacterFromSeed("a"))).not.toBe(
      characterSignature(defaultCharacterFromSeed("b")),
    );
  });
});

describe("migrateCharacterOptions", () => {
  const V1 = {
    bodyType: "male",
    skinTone: "bronze",
    hair: { style: "cornrows", color: "dark_brown" },
    beard: { style: "mustache", color: "dark_brown" },
    torso: { item: "longsleeve", color: "forest" },
    legs: { item: "pants2", color: "charcoal" },
    feet: { item: "boots", color: "leather" },
    glasses: { item: "sunglasses", color: "black" },
    hat: { item: "bandana", color: "red" },
  };

  it("converte o shape v1 completo para v2 válido", () => {
    const v2 = migrateCharacterOptions(V1);
    expect(v2).not.toBeNull();
    expect(isCharacterOptions(v2)).toBe(true);
    expect(v2!.items.body).toEqual({ item: "body", variant: "bronze" });
    expect(v2!.items.head).toEqual({ item: "heads_human_male", variant: "bronze" });
    expect(v2!.items.hair).toEqual({ item: "hair_cornrows", variant: "dark_brown" });
    expect(v2!.items.mustache).toEqual({ item: "beards_mustache", variant: "dark_brown" });
    expect(v2!.items.clothes).toEqual({ item: "torso_clothes_longsleeve", variant: "forest" });
    expect(v2!.items.legs).toEqual({ item: "legs_pants2", variant: "charcoal" });
    expect(v2!.items.shoes).toEqual({ item: "feet_boots", variant: "leather" });
    expect(v2!.items.facial_eyes).toEqual({ item: "facial_glasses_sunglasses", variant: "black" });
    expect(v2!.items.bandana).toEqual({ item: "hat_bandana", variant: "red" });
  });

  it("v1 com opcionais null vira v2 sem essas categorias", () => {
    const v2 = migrateCharacterOptions({ ...V1, hair: null, beard: null, glasses: null, hat: null });
    expect(v2).not.toBeNull();
    expect(v2!.items.hair).toBeUndefined();
    expect(v2!.items.facial_eyes).toBeUndefined();
  });

  it("v2 válido passa direto (sanitizado); lixo vira null", () => {
    expect(migrateCharacterOptions(VALID_V2)).toEqual(sanitizeCharacterOptions(VALID_V2));
    expect(migrateCharacterOptions(null)).toBeNull();
    expect(migrateCharacterOptions({ any: "junk" })).toBeNull();
    expect(migrateCharacterOptions("open-peeps-string")).toBeNull();
  });
});

describe("defaultHeadFor", () => {
  it("dá cabeça humana compatível por corpo", () => {
    expect(defaultHeadFor("male")).toEqual({ item: "heads_human_male", variant: "light" });
    expect(defaultHeadFor("female")).toEqual({ item: "heads_human_female", variant: "light" });
  });

  it("cai para heads_human_child quando o corpo é 'child' (sem heads_human_male/female)", () => {
    // heads_human_male/female não suportam "child" — sem fallback o personagem
    // ficava decapitado ao trocar para o corpo "Criança" no editor.
    expect(defaultHeadFor("child")).toEqual({ item: "heads_human_child", variant: "light" });
  });
});

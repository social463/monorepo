/**
 * Personagem LPC (Liberated Pixel Cup) — contrato v2, dirigido pelo catálogo
 * gerado (lpc-catalog.json). O editor monta a UI do catálogo, a API valida
 * contra ele e o vendoring (scripts/vendor-lpc.mjs) gera exatamente os
 * arquivos que characterLayers() referencia.
 * Arte CC-BY-SA/OGA-BY/CC-BY/CC0 — créditos em /lpc/CREDITS.txt (obrigatório manter).
 */
import { CATALOG_BY_ID, LPC_CATALOG, LPC_BODY_TYPES, type LpcBodyType } from "./lpc-catalog";

export const LPC_STYLE = "lpc" as const;

export const BODY_TYPES = LPC_BODY_TYPES;
export type BodyType = LpcBodyType;

export const BODY_TYPE_LABELS: Record<BodyType, string> = {
  male: "Tipo 1", female: "Tipo 2", muscular: "Musculoso",
  pregnant: "Gestante", teen: "Jovem", child: "Criança",
};

/** Uma escolha: item do catálogo + variante (cor). Chave do mapa = categoria. */
export interface CharacterItem {
  item: string;
  variant: string;
}

/** Escolhas do personagem. `items.body` é obrigatório; o resto é opcional. */
export interface CharacterOptions {
  bodyType: BodyType;
  items: Record<string, CharacterItem>;
}

// ── geometria do sheet (walk-only, fatiado pelo vendoring) ───────────────────
export const CHARACTER_FRAME_SIZE = 64;
export const CHARACTER_WALK_COLUMNS = 9; // frame 0 = parado, 1..8 = passos
export const CHARACTER_SHEET_WIDTH = 576;
export const CHARACTER_SHEET_HEIGHT = 256;
/** Ordem das linhas no sheet LPC universal. */
export const CHARACTER_ROW_BY_DIRECTION: Record<"up" | "left" | "down" | "right", number> = {
  up: 0, left: 1, down: 2, right: 3,
};

export function characterIdleFrame(dir: keyof typeof CHARACTER_ROW_BY_DIRECTION): number {
  return CHARACTER_ROW_BY_DIRECTION[dir] * CHARACTER_WALK_COLUMNS;
}

export function characterWalkFrames(dir: keyof typeof CHARACTER_ROW_BY_DIRECTION): number[] {
  const base = characterIdleFrame(dir);
  return Array.from({ length: CHARACTER_WALK_COLUMNS - 1 }, (_, i) => base + 1 + i);
}

// ── validação (dados vêm de Json no banco — pode haver v1/open-peeps legado) ─
function isValidItem(category: string, value: unknown, bodyType: BodyType): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v.item !== "string" || typeof v.variant !== "string") return false;
  const entry = CATALOG_BY_ID.get(v.item);
  if (!entry || entry.category !== category) return false;
  return entry.bodyTypes.includes(bodyType) && entry.variants.includes(v.variant);
}

export function isCharacterOptions(value: unknown): value is CharacterOptions {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (!BODY_TYPES.includes(v.bodyType as BodyType)) return false;
  if (typeof v.items !== "object" || v.items === null) return false;
  const items = v.items as Record<string, unknown>;
  if (!("body" in items)) return false;
  const bodyType = v.bodyType as BodyType;
  return Object.entries(items).every(([category, item]) => isValidItem(category, item, bodyType));
}

/**
 * Reconstrói o objeto canônico com SOMENTE os campos do contrato — z.custom
 * não descarta chaves desconhecidas como o z.object faria, então sem isto um
 * PATCH com chaves extras persistiria lixo e o retransmitiria em cada DTO/WS.
 * Entradas de categoria inválidas são dropadas (exceto body: chame após
 * validar com isCharacterOptions).
 */
export function sanitizeCharacterOptions(options: CharacterOptions): CharacterOptions {
  const items: Record<string, CharacterItem> = {};
  for (const category of Object.keys(options.items).sort()) {
    const value = options.items[category];
    if (isValidItem(category, value, options.bodyType)) {
      items[category] = { item: value.item, variant: value.variant };
    }
  }
  return { bodyType: options.bodyType, items };
}

// ── hash/assinatura (cache de textura e chave de composição) ─────────────────
/** djb2 — mesma família do officeHash; local para evitar import circular com office.ts. */
export function characterHash(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** String canônica das escolhas — igualdade estrutural vira igualdade de string. */
export function characterSignature(options: CharacterOptions): string {
  const parts = Object.keys(options.items)
    .sort()
    .map((category) => `${category}:${options.items[category].item}:${options.items[category].variant}`);
  return [options.bodyType, ...parts].join("|");
}

// ── camadas ──────────────────────────────────────────────────────────────────
export interface CharacterLayer {
  path: string; // relativo a /lpc/
  zPos: number;
}

/**
 * Camadas do personagem em ordem de desenho (zPos asc do catálogo; empate
 * mantém a ordem de inserção — categorias em ordem alfabética).
 */
export function characterLayers(options: CharacterOptions): CharacterLayer[] {
  const layers: CharacterLayer[] = [];
  for (const category of Object.keys(options.items).sort()) {
    const { item, variant } = options.items[category];
    const entry = CATALOG_BY_ID.get(item);
    if (!entry) continue;
    for (const layer of entry.layers) {
      const folder = layer.paths[options.bodyType];
      if (!folder) continue;
      layers.push({ path: `${folder}/${variant}.png`, zPos: layer.zPos });
    }
  }
  // sort estável do V8 preserva a ordem de inserção nos empates de zPos
  return layers.sort((a, b) => a.zPos - b.zPos);
}

// ── personagem padrão (migração implícita de quem nunca escolheu) ────────────
// Pool "civil": corpo humano + roupa básica — o mesmo visual da curadoria
// antiga. Ninguém spawna de zumbi armado por sorteio.
const DEFAULT_BODY_TYPES = ["male", "female"] as const;
const DEFAULT_SKINS = ["light", "amber", "olive", "taupe", "bronze", "brown", "black"];
const DEFAULT_HAIR = [
  "hair_afro", "hair_bangs", "hair_bangslong", "hair_bob", "hair_braid",
  "hair_buzzcut", "hair_cornrows", "hair_curly_long", "hair_curly_short",
  "hair_dreadlocks_short", "hair_plain", "hair_ponytail", "hair_spiked", "hair_twists_fade",
];
const DEFAULT_HAIR_COLORS = [
  "black", "dark_brown", "light_brown", "chestnut", "blonde", "ash",
  "ginger", "carrot", "dark_gray", "white",
];
const DEFAULT_CLOTHES = ["torso_clothes_shortsleeve", "torso_clothes_longsleeve", "torso_clothes_sleeveless"];
const DEFAULT_LEGS = ["legs_pants", "legs_pants2", "legs_shorts", "legs_skirts_plain", "legs_leggings"];
const DEFAULT_SHOES = ["feet_shoes", "feet_boots", "feet_sandals", "feet_slippers"];
const DEFAULT_CLOTH_COLORS = [
  "black", "blue", "bluegray", "brown", "charcoal", "forest", "gray",
  "green", "lavender", "leather", "maroon", "navy",
];

function pickBy<T>(list: readonly T[], hash: number): T {
  return list[hash % list.length];
}

/**
 * Cabeça humana padrão do corpo (usada por default, migração e editor).
 * Corpos sem a preferida (ex.: "child", que não tem heads_human_male/female)
 * caem na primeira cabeça humana do catálogo compatível com corpo+variante
 * (heads_human_child é a única "heads_human*" que serve "child").
 */
export function defaultHeadFor(bodyType: BodyType, variant = "light"): CharacterItem | null {
  const preferred = ["female", "pregnant"].includes(bodyType) ? "heads_human_female" : "heads_human_male";
  const preferredEntry = CATALOG_BY_ID.get(preferred);
  if (preferredEntry?.bodyTypes.includes(bodyType) && preferredEntry.variants.includes(variant)) {
    return { item: preferred, variant };
  }
  const fallback = LPC_CATALOG.find(
    (entry) =>
      entry.category === "head" &&
      entry.id.startsWith("heads_human") &&
      entry.bodyTypes.includes(bodyType) &&
      entry.variants.includes(variant),
  );
  return fallback ? { item: fallback.id, variant } : null;
}

/** Determinística: mesma seed → mesmo personagem. Sempre passa em isCharacterOptions. */
export function defaultCharacterFromSeed(seed: string): CharacterOptions {
  const h = characterHash(seed);
  const bodyType = pickBy(DEFAULT_BODY_TYPES, h);
  const skin = pickBy(DEFAULT_SKINS, h >>> 3);
  const items: Record<string, CharacterItem> = {
    body: { item: "body", variant: skin },
    hair: { item: pickBy(DEFAULT_HAIR, h >>> 6), variant: pickBy(DEFAULT_HAIR_COLORS, h >>> 9) },
    clothes: { item: pickBy(DEFAULT_CLOTHES, h >>> 12), variant: pickBy(DEFAULT_CLOTH_COLORS, h >>> 15) },
    legs: { item: pickBy(DEFAULT_LEGS, h >>> 18), variant: pickBy(DEFAULT_CLOTH_COLORS, h >>> 21) },
    shoes: { item: pickBy(DEFAULT_SHOES, h >>> 24), variant: pickBy(DEFAULT_CLOTH_COLORS, h >>> 27) },
  };
  const head = defaultHeadFor(bodyType, skin);
  if (head) items.head = head;
  return { bodyType, items };
}

// ── migração do shape v1 (curadoria antiga persistida em avatarOptions) ─────
const V1_ITEM_IDS: Record<string, Record<string, string>> = {
  hair: {
    afro: "hair_afro", bangs: "hair_bangs", bangslong: "hair_bangslong", bob: "hair_bob",
    braid: "hair_braid", buzzcut: "hair_buzzcut", cornrows: "hair_cornrows",
    curly_long: "hair_curly_long", curly_short: "hair_curly_short",
    dreadlocks_short: "hair_dreadlocks_short", plain: "hair_plain",
    ponytail: "hair_ponytail", spiked: "hair_spiked", twists_fade: "hair_twists_fade",
  },
  beard: {
    beard: "beards_beard", bigstache: "beards_bigstache", french: "beards_french",
    horseshoe: "beards_horseshoe", mustache: "beards_mustache",
  },
  torso: {
    shortsleeve: "torso_clothes_shortsleeve", longsleeve: "torso_clothes_longsleeve",
    sleeveless: "torso_clothes_sleeveless",
  },
  legs: {
    pants: "legs_pants", pants2: "legs_pants2", shorts: "legs_shorts",
    skirts_plain: "legs_skirts_plain", leggings: "legs_leggings",
  },
  feet: { shoes: "feet_shoes", boots: "feet_boots", sandals: "feet_sandals", slippers: "feet_slippers" },
  glasses: {
    glasses: "facial_glasses", round: "facial_glasses_round",
    nerd: "facial_glasses_nerd", sunglasses: "facial_glasses_sunglasses",
  },
  hat: { bandana: "hat_bandana", bowler: "hat_formal_bowler", tophat: "hat_formal_tophat" },
};

function migrateV1Entry(
  items: Record<string, CharacterItem>,
  bodyType: BodyType,
  slot: keyof typeof V1_ITEM_IDS,
  value: unknown,
  key: "style" | "item",
): void {
  if (typeof value !== "object" || value === null) return;
  const v = value as Record<string, unknown>;
  const id = V1_ITEM_IDS[slot][String(v[key])];
  const entry = id ? CATALOG_BY_ID.get(id) : undefined;
  if (!entry || !entry.bodyTypes.includes(bodyType)) return;
  const color = String(v.color ?? "");
  const variant = entry.variants.includes(color) ? color : entry.variants[0];
  // categoria vem do catálogo (hat_bandana é categoria "bandana", não "hat")
  items[entry.category] = { item: entry.id, variant };
}

/**
 * Aceita qualquer coisa vinda de Json persistido/WS: v2 válido é sanitizado,
 * o shape v1 da curadoria antiga é convertido, o resto vira null (open-peeps
 * legado, lixo). Use nas bordas (serialize, resolvers do web).
 */
export function migrateCharacterOptions(value: unknown): CharacterOptions | null {
  if (isCharacterOptions(value)) return sanitizeCharacterOptions(value);
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const isV1 =
    typeof v.skinTone === "string" &&
    typeof v.bodyType === "string" &&
    ["male", "female"].includes(v.bodyType) &&
    typeof v.torso === "object";
  if (!isV1) return null;
  const bodyType = v.bodyType as BodyType;
  const bodyEntry = CATALOG_BY_ID.get("body");
  if (!bodyEntry) return null;
  const skin = bodyEntry.variants.includes(v.skinTone as string) ? (v.skinTone as string) : bodyEntry.variants[0];
  const items: Record<string, CharacterItem> = { body: { item: "body", variant: skin } };
  const head = defaultHeadFor(bodyType, skin);
  if (head) items.head = head;
  migrateV1Entry(items, bodyType, "hair", v.hair, "style");
  migrateV1Entry(items, bodyType, "beard", v.beard, "style");
  migrateV1Entry(items, bodyType, "torso", v.torso, "item");
  migrateV1Entry(items, bodyType, "legs", v.legs, "item");
  migrateV1Entry(items, bodyType, "feet", v.feet, "item");
  migrateV1Entry(items, bodyType, "glasses", v.glasses, "item");
  migrateV1Entry(items, bodyType, "hat", v.hat, "item");
  const migrated: CharacterOptions = { bodyType, items };
  return isCharacterOptions(migrated) ? sanitizeCharacterOptions(migrated) : null;
}

/**
 * Catálogo LPC completo — GERADO por scripts/vendor-lpc.mjs a partir das
 * sheet_definitions do Universal LPC Spritesheet Character Generator.
 * Não edite o JSON à mão; regenere com o script. Créditos em /lpc/CREDITS.txt.
 */
import rawCatalog from "./lpc-catalog.json";

export const LPC_BODY_TYPES = [
  "male", "female", "muscular", "pregnant", "teen", "child",
] as const;
export type LpcBodyType = (typeof LPC_BODY_TYPES)[number];

export interface LpcCatalogLayer {
  zPos: number;
  /** pasta relativa a /lpc/ (sem barra final) por tipo de corpo suportado */
  paths: Partial<Record<LpcBodyType, string>>;
}

export interface LpcCatalogEntry {
  id: string;
  category: string;
  label: string;
  layers: LpcCatalogLayer[];
  variants: string[];
  bodyTypes: LpcBodyType[];
}

export const LPC_CATALOG = rawCatalog as LpcCatalogEntry[];

export const CATALOG_BY_ID: Map<string, LpcCatalogEntry> = new Map(
  LPC_CATALOG.map((entry) => [entry.id, entry]),
);

export const CATALOG_CATEGORIES: string[] = [...new Set(LPC_CATALOG.map((e) => e.category))].sort();

export function itemsForCategory(category: string, bodyType: LpcBodyType): LpcCatalogEntry[] {
  return LPC_CATALOG.filter((e) => e.category === category && e.bodyTypes.includes(bodyType));
}

/** Labels pt-BR das categorias mais comuns; o resto cai no nome cru do upstream. */
export const CATEGORY_LABELS: Record<string, string> = {
  body: "Corpo", head: "Cabeça", eyes: "Olhos", eyebrows: "Sobrancelhas",
  nose: "Nariz", ears: "Orelhas", ears_inner: "Orelhas (interno)", wrinkes: "Rugas",
  hair: "Cabelo", hairextl: "Mecha (esq.)", hairextr: "Mecha (dir.)",
  ponytail: "Rabo de cavalo", hairtie: "Prendedor", beard: "Barba", mustache: "Bigode",
  facial_eyes: "Óculos", visor: "Viseira", facial_mask: "Máscara",
  earrings: "Brincos", earring_left: "Brinco (esq.)", earring_right: "Brinco (dir.)",
  clothes: "Camisa", jacket: "Jaqueta", vest: "Colete", dress: "Vestido",
  overalls: "Macacão", legs: "Calça", socks: "Meias", shoes: "Sapatos",
  belt: "Cinto", sash: "Faixa", apron: "Avental", cape: "Capa",
  shoulders: "Ombreiras", arms: "Braçadeiras", bracers: "Bráceres",
  gloves: "Luvas", wrists: "Punhos", armour: "Armadura", chainmail: "Cota de malha",
  bandages: "Bandagens", hat: "Chapéu", bandana: "Bandana", headcover: "Véu",
  neck: "Pescoço", necklace: "Colar", charm: "Amuleto", ring: "Anel",
  backpack: "Mochila", cargo: "Carga", weapon: "Arma", shield: "Escudo",
  shield_pattern: "Escudo (padrão)", shield_trim: "Escudo (borda)", shield_paint: "Escudo (pintura)",
  quiver: "Aljava", ammo: "Munição", bauldron: "Bainha",
  wings: "Asas", tail: "Cauda", horns: "Chifres", fins: "Barbatanas",
  furry_ears: "Orelhas furry", prosthesis_hand: "Prótese (mão)", prosthesis_leg: "Prótese (perna)",
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category;
}

const GROUP_DEFS: { key: string; label: string; categories: string[] }[] = [
  { key: "corpo", label: "Corpo", categories: ["body", "head", "eyes", "eyebrows", "nose", "ears", "ears_inner", "wrinkes"] },
  { key: "rosto", label: "Rosto & Cabelo", categories: ["hair", "hairextl", "hairextr", "ponytail", "hairtie", "hairtie_rune", "beard", "mustache", "facial_eyes", "visor", "facial_mask", "facial_left", "facial_left_trim", "facial_right", "facial_right_trim", "earrings", "earring_left", "earring_right"] },
  { key: "roupas", label: "Roupas", categories: ["clothes", "jacket", "jacket_trim", "jacket_collar", "jacket_pockets", "vest", "dress", "dress_trim", "dress_sleeves", "dress_sleeves_trim", "overalls", "legs", "socks", "shoes", "shoes_plate", "belt", "buckles", "sash", "sash_obi", "sash_tie", "apron", "cape", "cape_trim", "shoulders", "arms", "bracers", "gloves", "wrists", "armour", "chainmail", "bandages"] },
  { key: "acessorios", label: "Acessórios", categories: ["hat", "hat_trim", "hat_accessory", "hat_overlay", "hat_buckle", "bandana", "bandana_overlay", "headcover", "headcover_rune", "neck", "necklace", "charm", "ring", "backpack", "backpack_straps", "cargo"] },
  { key: "equipamento", label: "Equipamento", categories: ["weapon", "weapon_magic_crystal", "shield", "shield_pattern", "shield_trim", "shield_paint", "quiver", "ammo", "bauldron"] },
  { key: "fantasia", label: "Fantasia", categories: ["wings", "wings_dots", "wings_edge", "tail", "horns", "fins", "furry_ears", "furry_ears_skin", "prosthesis_hand", "prosthesis_leg", "wound_arm", "wound_brain", "wound_eye", "wound_mouth", "wound_ribs"] },
];

/** Grupos do editor. Categorias do catálogo fora dos grupos caem em "Outros". */
export const CATEGORY_GROUPS: { key: string; label: string; categories: string[] }[] = (() => {
  const known = new Set(GROUP_DEFS.flatMap((g) => g.categories));
  const rest = CATALOG_CATEGORIES.filter((c) => !known.has(c));
  const groups = GROUP_DEFS.map((g) => ({
    ...g,
    categories: g.categories.filter((c) => CATALOG_CATEGORIES.includes(c)),
  }));
  return rest.length ? [...groups, { key: "outros", label: "Outros", categories: rest }] : groups;
})();

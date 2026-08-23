import {
  CATALOG_BY_ID,
  defaultCharacterFromSeed,
  defaultHeadFor,
  isCharacterOptions,
  sanitizeCharacterOptions,
  type BodyType,
  type CharacterOptions,
  type LpcCatalogEntry,
} from '@legends/shared'

const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

export function searchItems(entries: LpcCatalogEntry[], query: string): LpcCatalogEntry[] {
  const q = fold(query.trim())
  if (!q) return entries
  return entries.filter((e) => fold(e.label).includes(q) || fold(e.id).includes(q))
}

/** Põe/troca/remove um item; variante omitida = primeira do catálogo. */
export function setItem(
  options: CharacterOptions,
  category: string,
  entry: LpcCatalogEntry | null,
  variant?: string,
): CharacterOptions {
  const items = { ...options.items }
  if (!entry) {
    delete items[category]
  } else {
    items[category] = {
      item: entry.id,
      variant: variant && entry.variants.includes(variant) ? variant : entry.variants[0],
    }
  }
  return { ...options, items }
}

/**
 * Troca o tipo de corpo preservando o que der: itens incompatíveis são
 * dropados pelo sanitize; corpo/cabeça caem para o humano padrão se sumirem.
 */
export function applyBodyType(options: CharacterOptions, bodyType: BodyType): CharacterOptions {
  const next = sanitizeCharacterOptions({ ...options, bodyType })
  if (!next.items.body) {
    const body = CATALOG_BY_ID.get('body')!
    const skin = options.items.body?.variant
    next.items.body = { item: 'body', variant: skin && body.variants.includes(skin) ? skin : body.variants[0] }
  }
  if (!next.items.head) {
    const head = defaultHeadFor(bodyType, next.items.body.variant)
    if (head) next.items.head = head
  }
  return next
}

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)]
}

/** Personagem aleatório civil: base determinística da seed + acessórios sorteados. */
export function randomCharacter(): CharacterOptions {
  const seed = Math.random().toString(36).slice(2, 10)
  let options = defaultCharacterFromSeed(seed)
  if (Math.random() < 0.3) {
    const beards = ['beards_beard', 'beards_bigstache', 'beards_french', 'beards_horseshoe', 'beards_mustache']
      .map((id) => CATALOG_BY_ID.get(id))
      .filter((e): e is LpcCatalogEntry => Boolean(e?.bodyTypes.includes(options.bodyType)))
    if (beards.length) {
      const entry = pick(beards)
      options = setItem(options, entry.category, entry, options.items.hair?.variant)
    }
  }
  if (Math.random() < 0.2) {
    const entry = CATALOG_BY_ID.get('facial_glasses')
    if (entry?.bodyTypes.includes(options.bodyType)) options = setItem(options, entry.category, entry, 'black')
  }
  return isCharacterOptions(options) ? options : defaultCharacterFromSeed(seed)
}

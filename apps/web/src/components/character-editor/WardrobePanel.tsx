import { useMemo, useState } from 'react'
import {
  BODY_TYPES,
  BODY_TYPE_LABELS,
  CATALOG_BY_ID,
  CATEGORY_GROUPS,
  categoryLabel,
  itemsForCategory,
  type BodyType,
  type CharacterOptions,
} from '@legends/shared'
import { LayerThumb } from './LayerThumb'
import { applyBodyType, searchItems, setItem } from './catalogView'

/** Classe compartilhada dos botões-chip (corpo, abas de grupo, categorias). */
function chipClass(active: boolean): string {
  return `rounded-md border px-md py-sm font-label text-label-md transition-colors ${
    active
      ? 'border-primary bg-primary text-on-primary'
      : 'border-outline-variant/50 bg-surface-container-high text-on-surface'
  }`
}

/**
 * Guarda-roupa controlado: corpo, grupos, categorias, busca, grade e
 * variantes. As options vivem no pai (página); grupo/categoria/busca são
 * estado de UI local.
 */
export function WardrobePanel({
  options,
  onChange,
}: {
  options: CharacterOptions
  onChange: (next: CharacterOptions) => void
}) {
  const [group, setGroup] = useState(CATEGORY_GROUPS[0].key)
  const [category, setCategory] = useState<string>('body')
  const [query, setQuery] = useState('')

  const activeGroup = CATEGORY_GROUPS.find((g) => g.key === group) ?? CATEGORY_GROUPS[0]
  const availableItems = useMemo(
    () => searchItems(itemsForCategory(category, options.bodyType), query),
    [category, options.bodyType, query],
  )
  const selected = options.items[category] ?? null
  const selectedEntry = selected ? CATALOG_BY_ID.get(selected.item) ?? null : null

  function selectGroup(g: (typeof CATEGORY_GROUPS)[number]) {
    setGroup(g.key)
    const firstCategory =
      g.categories.find((c) => itemsForCategory(c, options.bodyType).length > 0) ?? g.categories[0]
    if (firstCategory) setCategory(firstCategory)
    setQuery('')
  }

  /**
   * Troca o corpo e, se a categoria ativa ficar sem itens para ele (ex.:
   * "beard" não existe para "child"), realoca para a primeira categoria do
   * grupo ativo com itens — senão a grade fica vazia e o chip da categoria
   * some da UI.
   */
  function changeBodyType(bt: BodyType) {
    onChange(applyBodyType(options, bt))
    if (itemsForCategory(category, bt).length === 0) {
      const fallback =
        activeGroup.categories.find((c) => itemsForCategory(c, bt).length > 0) ??
        CATEGORY_GROUPS.flatMap((g) => g.categories).find((c) => itemsForCategory(c, bt).length > 0) ??
        'body'
      setCategory(fallback)
      setQuery('')
    }
  }

  function pickItem(entry: (typeof availableItems)[number]) {
    const next = setItem(options, category, entry, selected?.item === entry.id ? selected.variant : undefined)
    onChange(category === 'body' ? applyBodyType(next, next.bodyType) : next)
  }

  return (
    <div className="flex flex-col gap-lg lg:grid lg:grid-cols-[minmax(0,1fr),260px] lg:items-start">
      {/* Coluna do guarda-roupa: corpo, grupos, categorias, busca e grade. */}
      <div className="flex flex-col gap-lg rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
        {/* 1: linha de corpos */}
        <div className="flex flex-wrap gap-sm">
          {BODY_TYPES.map((bt) => (
            <button
              key={bt}
              type="button"
              onClick={() => changeBodyType(bt)}
              className={chipClass(options.bodyType === bt)}
            >
              {BODY_TYPE_LABELS[bt]}
            </button>
          ))}
        </div>

        {/* 2: abas de grupo */}
        <div className="flex flex-wrap gap-sm border-t border-outline-variant/30 pt-lg">
          {CATEGORY_GROUPS.map((g) => (
            <button key={g.key} type="button" onClick={() => selectGroup(g)} className={chipClass(group === g.key)}>
              {g.label}
            </button>
          ))}
        </div>

        {/* 3: chips de categoria do grupo ativo */}
        <div className="flex flex-wrap gap-sm">
          {activeGroup.categories
            .filter((c) => itemsForCategory(c, options.bodyType).length > 0)
            .map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={category === c}
                onClick={() => {
                  setCategory(c)
                  setQuery('')
                }}
                className={chipClass(category === c)}
              >
                {categoryLabel(c)}
              </button>
            ))}
        </div>

        {/* 4: busca */}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar item…"
          aria-label="Buscar item…"
          className="rounded-md border border-outline-variant/50 bg-surface-container-high px-md py-sm font-label text-label-md text-on-surface placeholder:text-on-surface-variant focus:border-primary focus:outline-none"
        />

        {/* 5: grade de itens */}
        <div className="grid grid-cols-3 sm:grid-cols-4 xl:grid-cols-5 gap-md max-h-[32rem] overflow-y-auto pr-xs">
          {category !== 'body' && (
            <button
              type="button"
              onClick={() => onChange(setItem(options, category, null))}
              className={`flex aspect-square flex-col items-center justify-center gap-xs rounded-lg border-2 bg-surface-container-highest p-sm text-center transition-all ${
                !selected ? 'border-primary' : 'border-transparent hover:border-outline-variant/50'
              }`}
            >
              <span className="font-label text-label-md text-on-surface-variant">Nenhum</span>
            </button>
          )}
          {availableItems.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => pickItem(entry)}
              className={`flex aspect-square flex-col items-center justify-center gap-xs rounded-lg border-2 bg-surface-container-highest p-sm transition-all ${
                selected?.item === entry.id ? 'border-primary' : 'border-transparent hover:border-outline-variant/50'
              }`}
            >
              <LayerThumb entry={entry} variant={entry.variants[0]} bodyType={options.bodyType} />
              <span className="line-clamp-1 w-full font-label text-label-md text-on-surface">{entry.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Coluna de cores: variantes do item selecionado, sempre presente no desktop. */}
      <div className="flex flex-col gap-md rounded-xl border border-outline-variant/40 bg-surface-container p-lg lg:sticky lg:top-lg">
        <span className="font-label text-label-lg text-on-surface">Cores</span>
        {selectedEntry && selectedEntry.variants.length > 1 ? (
          <div className="grid grid-cols-3 gap-sm max-h-[26rem] overflow-y-auto pr-xs">
            {selectedEntry.variants.map((v) => (
              <button
                key={v}
                type="button"
                aria-label={`variante ${v}`}
                onClick={() => onChange(setItem(options, category, selectedEntry, v))}
                className={`aspect-square w-full overflow-hidden rounded-md border-2 bg-surface-container-highest transition-all ${
                  selected?.variant === v ? 'border-primary' : 'border-transparent hover:border-outline-variant/50'
                }`}
              >
                <LayerThumb entry={selectedEntry} variant={v} bodyType={options.bodyType} />
              </button>
            ))}
          </div>
        ) : (
          <p className="font-label text-label-sm text-on-surface-variant">
            {selectedEntry
              ? 'Este item não tem variações de cor.'
              : 'Selecione um item para ver as cores disponíveis.'}
          </p>
        )}
      </div>
    </div>
  )
}

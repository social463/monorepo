import { useState } from 'react'
import type { GifResult } from '@legends/shared'
import { useGifSearch } from '../lib/use-gifs'
import { Icon } from './Icon'

export function GifPicker({
  onSelect,
  onClose,
}: {
  onSelect: (gif: GifResult) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const { results, fetchNextPage, hasNextPage, isLoading } = useGifSearch(query)

  return (
    <div className="absolute z-30 mt-1 w-80 rounded-lg border border-outline-variant/40 bg-surface-container p-sm shadow-lg">
      <div className="mb-sm flex items-center gap-xs">
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar GIF…"
          aria-label="Buscar GIF"
          className="flex-1 rounded-full border border-outline-variant/60 bg-transparent px-sm py-1 text-body-sm text-on-surface outline-none placeholder:text-on-surface-variant"
        />
        <button type="button" onClick={onClose} aria-label="Fechar" className="text-on-surface-variant hover:text-on-surface">
          <Icon name="close" className="text-[18px]" />
        </button>
      </div>
      <div className="grid max-h-72 grid-cols-2 gap-xs overflow-auto">
        {results.map((gif) => (
          <button
            key={gif.id}
            type="button"
            onClick={() => onSelect(gif)}
            className="overflow-hidden rounded-md border border-outline-variant/40 hover:border-primary"
          >
            <img src={gif.previewUrl} alt={gif.description} loading="lazy" className="h-full w-full object-cover" />
          </button>
        ))}
        {isLoading && <span className="col-span-2 py-2 text-center text-label-sm text-on-surface-variant">Carregando…</span>}
        {!isLoading && results.length === 0 && (
          <span className="col-span-2 py-2 text-center text-label-sm text-on-surface-variant">Nenhum GIF encontrado.</span>
        )}
      </div>
      <div className="mt-sm flex items-center justify-between">
        {hasNextPage ? (
          <button type="button" onClick={() => fetchNextPage()} className="text-label-sm text-primary hover:underline">
            Carregar mais
          </button>
        ) : (
          <span />
        )}
        <span className="text-[10px] uppercase tracking-wide text-on-surface-variant">Powered by GIPHY</span>
      </div>
    </div>
  )
}

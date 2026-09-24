import { useCallback, useState } from 'react'

const PREFIX = 'legends-inova-guia:'

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

/** Estado que só existe no navegador da pessoa — nada disto sobe para o servidor. */
export function useGuiaLocalState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => read<T>(key, initial))

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
        try {
          window.localStorage.setItem(PREFIX + key, JSON.stringify(resolved))
        } catch {
          /* storage indisponível: segue só em memória */
        }
        return resolved
      })
    },
    [key],
  )

  return [value, update] as const
}

export function useGuiaFavorites(kind: 'prompt' | 'situation') {
  const [ids, setIds] = useGuiaLocalState<string[]>(`fav-${kind}`, [])
  const toggle = useCallback(
    (id: string) => setIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])),
    [setIds],
  )
  return { ids, toggle, has: (id: string) => ids.includes(id) }
}

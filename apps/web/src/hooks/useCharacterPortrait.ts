import { useEffect, useMemo, useState } from 'react'
import {
  defaultCharacterFromSeed,
  migrateCharacterOptions,
  characterSignature,
  type CharacterOptions,
} from '@legends/shared'
import { characterPortraitDataUri } from '../lib/character'

export interface CharacterSource {
  name: string
  avatarStyle?: string | null
  avatarSeed?: string | null
  avatarOptions?: unknown
}

/**
 * Resolve as options do personagem de alguém: lpc salvo usa as escolhas;
 * legado open-peeps (que tinha avatar gerado) vira o personagem padrão da
 * seed; sem estilo nenhum retorna null (Avatar cai para foto/iniciais).
 */
export function resolveCharacterOptions(source: CharacterSource): CharacterOptions | null {
  if (source.avatarStyle === 'lpc') {
    // migrate cobre v2, o v1 da curadoria antiga (persistido) e payloads WS antigos
    const migrated = migrateCharacterOptions(source.avatarOptions)
    if (migrated) return migrated
  }
  if (source.avatarStyle === 'open-peeps') {
    return defaultCharacterFromSeed(source.avatarSeed ?? source.name)
  }
  return null
}

/** Data URI do retrato (128×128) ou null enquanto compõe / sem personagem. */
export function useCharacterPortrait(source: CharacterSource): string | null {
  const options = useMemo(() => resolveCharacterOptions(source), [
    source.avatarStyle,
    source.avatarSeed,
    source.avatarOptions,
    source.name,
  ])
  const key = options ? characterSignature(options) : null
  const [uri, setUri] = useState<string | null>(null)

  useEffect(() => {
    if (!options) {
      setUri(null)
      return
    }
    let alive = true
    characterPortraitDataUri(options)
      .then((u) => alive && setUri(u))
      .catch(() => alive && setUri(null)) // 404 de camada: cai para foto/iniciais
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return uri
}

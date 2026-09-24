import {
  characterHash,
  defaultCharacterFromSeed,
  migrateCharacterOptions,
  PAINTBALL_MARKER_HIDES,
  PAINTBALL_MARKER_LAYERS,
  type CharacterLayer,
  type CharacterOptions,
  type OfficeOccupant,
} from '@legends/shared'
import { characterSheetKey } from '../lib/character'

type OccupantAvatar = Pick<
  OfficeOccupant,
  'userId' | 'avatarStyle' | 'avatarSeed' | 'avatarOptions' | 'paintMarker'
>

/**
 * Personagem de um occupant: options lpc válidas quando existem; senão,
 * determinístico por seed → userId (diferente do componente Avatar, que cai
 * para foto/iniciais — no mapa ninguém fica sem boneco).
 *
 * Com o marcador de paintball na mão, as categorias que ocupam as mãos saem
 * (`PAINTBALL_MARKER_HIDES`): ninguém segura duas coisas, e somar o estilingue
 * por cima de uma espada ou de um escudo já escolhidos desenhava os dois
 * sobrepostos. Como o marcador não persiste, guardar a arma devolve sozinho o
 * que a pessoa tinha.
 */
export function occupantCharacterOptions(occupant: OccupantAvatar): CharacterOptions {
  const base =
    migrateCharacterOptions(occupant.avatarOptions) ??
    defaultCharacterFromSeed(occupant.avatarSeed ?? occupant.userId)
  if (!occupant.paintMarker) return base

  const items = { ...base.items }
  for (const category of PAINTBALL_MARKER_HIDES) delete items[category]
  return { ...base, items }
}

/**
 * Camadas que não vêm do guarda-roupa. Hoje só o marcador de paintball, que é
 * estado de JOGO: não persiste em `avatarOptions` e some ao guardar a arma.
 */
export function occupantExtraLayers(occupant: OccupantAvatar): readonly CharacterLayer[] {
  return occupant.paintMarker ? PAINTBALL_MARKER_LAYERS : []
}

/**
 * Key de textura estável por personagem — trocar o avatar troca a key, e
 * equipar/guardar o marcador também: sem isso o personagem armado reusaria a
 * textura composta enquanto ele estava desarmado, e a arma não apareceria.
 */
export function occupantTextureKey(occupant: OccupantAvatar): string {
  const key = characterSheetKey(occupantCharacterOptions(occupant), occupantExtraLayers(occupant))
  return `char-${occupant.userId}-${characterHash(key)}`
}

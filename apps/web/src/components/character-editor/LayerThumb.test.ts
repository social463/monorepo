import { describe, expect, it } from 'vitest'
import { CATALOG_BY_ID } from '@legends/shared'
import { thumbLayerFolders } from './LayerThumb'

describe('thumbLayerFolders', () => {
  it('ordena por zPos (bg antes de fg), mesmo quando o JSON lista fg primeiro', () => {
    // backpack_basket guarda fg (zPos 130) ANTES de bg (zPos 5) no catálogo —
    // sem ordenar, o thumbnail pintaria o fundo por cima da frente.
    const entry = CATALOG_BY_ID.get('backpack_basket')!
    expect(entry.layers[0].zPos).toBe(130) // pressuposto do teste: JSON fora de ordem

    const folders = thumbLayerFolders(entry, 'male')
    expect(folders).toEqual(['backpack/basket/bg', 'backpack/basket/fg'])
  })
})

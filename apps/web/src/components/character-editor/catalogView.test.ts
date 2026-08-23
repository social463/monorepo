import { describe, expect, it } from 'vitest'
import { CATALOG_BY_ID, isCharacterOptions, type CharacterOptions } from '@legends/shared'
import { applyBodyType, randomCharacter, searchItems, setItem } from './catalogView'

const BASE: CharacterOptions = {
  bodyType: 'male',
  items: {
    body: { item: 'body', variant: 'light' },
    head: { item: 'heads_human_male', variant: 'light' },
  },
}

describe('searchItems', () => {
  it('filtra por label/id sem case e sem acento', () => {
    const hair = [CATALOG_BY_ID.get('hair_afro')!, CATALOG_BY_ID.get('hair_plain')!]
    expect(searchItems(hair, 'AFRO')).toEqual([CATALOG_BY_ID.get('hair_afro')])
    expect(searchItems(hair, '')).toEqual(hair)
  })
})

describe('setItem', () => {
  it('põe, troca variante e remove', () => {
    const withHair = setItem(BASE, 'hair', CATALOG_BY_ID.get('hair_afro')!, 'blonde')
    expect(withHair.items.hair).toEqual({ item: 'hair_afro', variant: 'blonde' })
    expect(setItem(withHair, 'hair', null).items.hair).toBeUndefined()
  })

  it('variante omitida usa a primeira do item', () => {
    const entry = CATALOG_BY_ID.get('hair_afro')!
    expect(setItem(BASE, 'hair', entry).items.hair!.variant).toBe(entry.variants[0])
  })
})

describe('applyBodyType', () => {
  it('dropa itens incompatíveis e mantém cabeça padrão', () => {
    const skeleton = setItem(BASE, 'body', CATALOG_BY_ID.get('body_skeleton')!)
    const asChild = applyBodyType(skeleton, 'child') // skeleton não suporta child
    expect(isCharacterOptions(asChild)).toBe(true)
    expect(asChild.items.body.item).toBe('body') // caiu para o corpo humano
    expect(asChild.bodyType).toBe('child')
  })
})

describe('randomCharacter', () => {
  it('gera personagem válido', () => {
    for (let i = 0; i < 20; i += 1) expect(isCharacterOptions(randomCharacter())).toBe(true)
  })
})

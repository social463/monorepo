import { describe, expect, it } from 'vitest'
import { mapMessageEffect } from './mapMessage'

describe('mapMessageEffect', () => {
  it('map-changed recarrega no escritório, sai fora dele', () => {
    expect(mapMessageEffect({ type: 'map-changed', publicationId: 'p' }, true, false)).toBe('reload')
    expect(mapMessageEffect({ type: 'map-changed', publicationId: 'p' }, false, false)).toBe('leave')
  })

  it('map-decor-updated apenas refaz o fetch', () => {
    expect(mapMessageEffect({ type: 'map-decor-updated', publicationId: 'p' }, true, false)).toBe('refetch')
  })

  it('adia (não ignora) map-decor-updated enquanto o editor tem alterações não salvas', () => {
    // 'defer', não 'ignore': o chamador precisa lembrar de refazer o fetch
    // assim que a edição deixar de estar suja — ver OfficeBridge.deferDecorRefetch.
    expect(mapMessageEffect({ type: 'map-decor-updated', publicationId: 'p' } as any, true, true)).toBe('defer')
  })

  it('refetch em map-decor-updated quando não está editando sujo', () => {
    expect(mapMessageEffect({ type: 'map-decor-updated', publicationId: 'p' } as any, true, false)).toBe('refetch')
  })
})

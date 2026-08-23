import { describe, it, expect } from 'vitest'
import { FEATURE_KEYS, FEATURE_LABELS } from './third-party'
import { EVENT_PHOTO_MAX_BATCH, EVENT_PHOTO_REACTIONS } from './event-album'
import { REVIEW_REACTIONS } from './review'

describe('contrato da galeria de eventos', () => {
  it('expõe a feature de colaborador `galeria` com label', () => {
    expect(FEATURE_KEYS).toContain('galeria')
    expect(FEATURE_LABELS.galeria).toBe('Galeria de eventos')
  })

  it('limita o lote de upload a 20 fotos', () => {
    expect(EVENT_PHOTO_MAX_BATCH).toBe(20)
  })

  it('reusa o conjunto de emojis da resenha, sem inventar emoji novo', () => {
    expect(EVENT_PHOTO_REACTIONS).toEqual(REVIEW_REACTIONS)
  })
})

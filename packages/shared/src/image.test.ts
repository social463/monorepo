import { describe, it, expect } from 'vitest'
import {
  isAllowedImageContentType,
  ALLOWED_IMAGE_CONTENT_TYPES,
  IMAGE_MAX_BYTES,
} from './image'

describe('image contract', () => {
  it('aceita os content-types permitidos', () => {
    for (const ct of ALLOWED_IMAGE_CONTENT_TYPES) {
      expect(isAllowedImageContentType(ct)).toBe(true)
    }
  })

  it('rejeita content-types não suportados', () => {
    expect(isAllowedImageContentType('image/svg+xml')).toBe(false)
    expect(isAllowedImageContentType('application/pdf')).toBe(false)
    expect(isAllowedImageContentType('')).toBe(false)
  })

  it('expõe o limite de 10MB', () => {
    expect(IMAGE_MAX_BYTES).toBe(10 * 1024 * 1024)
  })
})

import { describe, it, expect } from 'vitest'
import { validateImageFile, UploadError } from './upload'

function fakeFile(type: string, size: number): File {
  const f = new File(['x'], 'x', { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

describe('validateImageFile', () => {
  it('aceita PNG dentro do limite', () => {
    expect(() => validateImageFile(fakeFile('image/png', 1000))).not.toThrow()
  })

  it('rejeita formato não suportado', () => {
    expect(() => validateImageFile(fakeFile('image/svg+xml', 1000))).toThrow(UploadError)
  })

  it('rejeita arquivo acima de 10MB', () => {
    expect(() => validateImageFile(fakeFile('image/png', 10 * 1024 * 1024 + 1))).toThrow(UploadError)
  })
})

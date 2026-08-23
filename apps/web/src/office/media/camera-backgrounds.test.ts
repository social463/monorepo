import { describe, expect, it } from 'vitest'
import { CAMERA_BACKGROUNDS, isCameraBackgroundId } from './camera-backgrounds'

describe('camera-backgrounds', () => {
  it('catálogo tem o fundo EMR com src servido de public/', () => {
    expect(CAMERA_BACKGROUNDS).toEqual([
      { id: 'emr', label: 'Fundo EMR', src: '/office/camera-backgrounds/emr.jpg' },
    ])
  })

  it('valida ids conhecidos e rejeita o resto', () => {
    expect(isCameraBackgroundId('none')).toBe(true)
    expect(isCameraBackgroundId('blur-leve')).toBe(true)
    expect(isCameraBackgroundId('blur-forte')).toBe(true)
    expect(isCameraBackgroundId('img:emr')).toBe(true)
    expect(isCameraBackgroundId('img:nao-existe')).toBe(false)
    expect(isCameraBackgroundId('qualquer-coisa')).toBe(false)
    expect(isCameraBackgroundId(null)).toBe(false)
  })
})

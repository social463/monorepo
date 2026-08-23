import { beforeEach, describe, expect, it } from 'vitest'
import { readDevicePreference, writeDevicePreference } from './devicePreferences'

beforeEach(() => localStorage.clear())

describe('devicePreferences', () => {
  it('retorna null quando nada foi salvo', () => {
    expect(readDevicePreference('audioInput')).toBeNull()
  })

  it('grava e lê cada chave de forma independente', () => {
    writeDevicePreference('audioInput', 'mic1')
    writeDevicePreference('audioOutput', 'out1')
    writeDevicePreference('videoInput', 'cam1')

    expect(readDevicePreference('audioInput')).toBe('mic1')
    expect(readDevicePreference('audioOutput')).toBe('out1')
    expect(readDevicePreference('videoInput')).toBe('cam1')
  })

  it('deviceId null limpa a preferência salva', () => {
    writeDevicePreference('audioInput', 'mic1')
    writeDevicePreference('audioInput', null)
    expect(readDevicePreference('audioInput')).toBeNull()
  })
})

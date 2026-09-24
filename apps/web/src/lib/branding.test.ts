import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BRAND_PRESETS, brandingFromPreset } from '@legends/shared'
import { applyCachedBranding, cacheBranding, readCachedBranding } from './branding'

const HOST = 'app.legends.internal'
const BRANDING = brandingFromPreset(BRAND_PRESETS.legends)

describe('cache de marca', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      value: { ...window.location, host: HOST },
      writable: true,
    })
  })

  afterEach(() => {
    window.localStorage.clear()
  })

  it('lê o cache salvo pela versão atual', () => {
    cacheBranding(BRANDING)
    expect(readCachedBranding()).toEqual(BRANDING)
  })

  it('descarta cache de uma versão anterior, sem o campo fonts', () => {
    const { fonts, ...semFonts } = BRANDING
    window.localStorage.setItem('legends:branding', JSON.stringify({ host: HOST, branding: semFonts }))

    expect(readCachedBranding()).toBeNull()
  })

  it('não lança ao aplicar cache de uma versão anterior, sem o campo fonts', () => {
    const { fonts, ...semFonts } = BRANDING
    window.localStorage.setItem('legends:branding', JSON.stringify({ host: HOST, branding: semFonts }))

    expect(() => applyCachedBranding()).not.toThrow()
  })
})

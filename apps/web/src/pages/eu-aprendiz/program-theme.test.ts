import { describe, expect, it } from 'vitest'
import { BRAND_COLOR_TOKENS, BRAND_SCHEMES, checkBrandContrast } from '@legends/shared'
import { APPRENTICE_PROGRAM_PALETTES, APPRENTICE_PROGRAM_STYLES } from './program-theme'

describe.each(BRAND_SCHEMES)('tema do programa Eu Aprendiz (%s)', (scheme) => {
  it('declara todos os tokens da marca, para nada vazar do tema da empresa', () => {
    const style = APPRENTICE_PROGRAM_STYLES[scheme] as Record<string, string>
    for (const token of BRAND_COLOR_TOKENS) {
      expect(style[`--brand-${token}`]).toMatch(/^\d+ \d+ \d+$/)
    }
    expect(style.colorScheme).toBe(scheme)
  })

  it('passa os contrastes, exceto o verde do programa como texto no claro', () => {
    // `primary` é o verde vivo #6CE190 do manual, só para preenchimento: o
    // texto verde da área usa `on-primary-container`, que entra nos pares
    // checados.
    const issues = checkBrandContrast(APPRENTICE_PROGRAM_PALETTES[scheme]).filter(
      (issue) => !(scheme === 'light' && issue.foreground === 'primary' && issue.background === 'surface'),
    )
    expect(issues).toEqual([])
  })

  it('o texto verde da área é legível sobre todo degrau de card', async () => {
    const { contrastRatio } = await import('@legends/shared/color')
    const palette = APPRENTICE_PROGRAM_PALETTES[scheme]
    for (const bg of ['surface', 'surface-container', 'surface-container-highest', 'primary-container'] as const) {
      expect(contrastRatio(palette['on-primary-container'], palette[bg])).toBeGreaterThanOrEqual(4.5)
    }
  })
})

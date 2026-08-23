import { describe, expect, it } from 'vitest'
import { BRAND_COLOR_TOKENS, LEGENDS_PALETTE, toRgbChannels } from '@legends/shared'
import tailwindConfig from '../tailwind.config'

/**
 * O Tailwind e o contrato de marca precisam expor exatamente os mesmos tokens.
 * Um token que existe no `@legends/shared` mas não no tema não vira classe
 * nenhuma — o mesmo buraco silencioso que o `theme-tokens.test.ts` já trava
 * para tipografia. Na direção oposta, um token só no Tailwind nunca receberia
 * cor de empresa: ficaria eternamente no fallback do produto, sem erro.
 */
const colors = (tailwindConfig.theme?.extend?.colors ?? {}) as Record<string, string>

describe('tokens de cor da marca', () => {
  it('o tema expõe exatamente os tokens do contrato', () => {
    expect(Object.keys(colors).sort()).toEqual([...BRAND_COLOR_TOKENS].sort())
  })

  it('nenhum token ficou com cor cravada — todos leem a variável da empresa', () => {
    const cravados = Object.entries(colors)
      .filter(([, value]) => !value.startsWith('rgb(var(--brand-'))
      .map(([token]) => token)
    expect(cravados).toEqual([])
  })

  it('todos aceitam opacidade (`bg-primary/30` precisa de <alpha-value>)', () => {
    const semAlpha = Object.entries(colors)
      .filter(([, value]) => !value.includes('<alpha-value>'))
      .map(([token]) => token)
    expect(semAlpha).toEqual([])
  })

  it('o fallback é a paleta do produto, para o app não piscar antes da marca chegar', () => {
    for (const token of BRAND_COLOR_TOKENS) {
      expect(colors[token], token).toBe(
        `rgb(var(--brand-${token}, ${toRgbChannels(LEGENDS_PALETTE[token])}) / <alpha-value>)`,
      )
    }
    // Sanidade: o fallback de `primary` é mesmo o verde histórico do Legends.
    expect(colors.primary).toContain('82 251 162')
  })
})

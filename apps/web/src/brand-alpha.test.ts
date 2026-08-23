import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BRAND_PRESETS, brandingFromPreset, contrastRatio, parseHex, toHex } from '@legends/shared'

/**
 * Opacidade em **texto** não sobrevive à inversão de tema, e foi o que quebrou
 * a primeira leva do white label.
 *
 * Reduzir alfa empurra a cor na direção do fundo. No tema escuro, um texto
 * claro perde brilho e continua legível (`on-surface-variant` a 70% ainda dá
 * 5.9:1). No claro, o mesmo token é uma cor ESCURA sobre branco: a 70% ele
 * desbota para 3.0:1 e reprova. O checador de contraste da paleta não pega
 * isso, porque ele mede tokens, não classes com alfa.
 *
 * Regra: cor de texto entra sólida. Para hierarquia, use outro token
 * (`on-surface-variant` em vez de `on-surface`), não opacidade.
 */
const SRC = join(process.cwd(), 'src')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return []
    return [full]
  })
}

const files = sourceFiles(SRC)

describe('opacidade em cor de texto', () => {
  it('varre o código-fonte de verdade', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('nenhuma classe de texto usa opacidade', () => {
    const encontrados: string[] = []
    for (const file of files) {
      const content = readFileSync(file, 'utf8')
      for (const [match] of content.matchAll(
        /\btext-(?:on-surface-variant|on-surface|on-background|primary|secondary|tertiary|outline)\/\d+\b/g,
      )) {
        encontrados.push(`${file.replace(`${SRC}/`, 'src/')}: ${match}`)
      }
    }
    expect([...new Set(encontrados)]).toEqual([])
  })
})

/** Cor com alfa composta sobre o fundo — o que o olho realmente enxerga. */
function blend(fg: string, bg: string, alpha: number): string {
  const a = parseHex(fg)
  const b = parseHex(bg)
  return toHex(a.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha))) as [number, number, number])
}

describe('por que a regra existe', () => {
  const emr = brandingFromPreset(BRAND_PRESETS.emr)
  const legends = brandingFromPreset(BRAND_PRESETS.legends)

  it('sólido passa nos dois temas', () => {
    for (const palette of [emr.schemes.light, emr.schemes.dark, legends.colors]) {
      expect(contrastRatio(palette['on-surface-variant'], palette.surface)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('a 70% o tema escuro aguenta e o claro reprova — a assimetria que motivou a regra', () => {
    const escuro = blend(legends.colors['on-surface-variant'], legends.colors.surface, 0.7)
    expect(contrastRatio(escuro, legends.colors.surface)).toBeGreaterThanOrEqual(4.5)

    const claro = blend(emr.schemes.light['on-surface-variant'], emr.schemes.light.surface, 0.7)
    expect(contrastRatio(claro, emr.schemes.light.surface)).toBeLessThan(3.5)
  })
})

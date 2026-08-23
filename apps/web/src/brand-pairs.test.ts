import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BRAND_PRESETS, brandingFromPreset, contrastRatio } from '@legends/shared'

/**
 * Botão preenchido tem duas armadilhas que só aparecem no tema claro, e as duas
 * passaram despercebidas porque funcionavam por sorte no escuro.
 *
 * 1. **Trocar o fundo no hover sem trocar o texto.** `hover:bg-primary-container`
 *    com `text-on-primary` é um par que o Material 3 não define: `on-primary` só
 *    é garantido contra `primary`. No escuro do produto isso dava 7.41:1 e
 *    ninguém notou; no claro da EMR dá **1.11:1** — o rótulo some.
 *
 * 2. **Opacidade no botão inteiro.** `disabled:opacity-40` desbota fundo e
 *    rótulo juntos na direção do fundo da página. No escuro sobra silhueta; no
 *    claro o verde vira menta pálida e o texto branco desaparece. Desabilitado
 *    é um par de cores (`surface-container-highest` / `on-surface-variant`),
 *    não uma transparência.
 */
const SRC = join(process.cwd(), 'src')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    if (!/\.tsx$/.test(entry.name) || /\.test\.tsx$/.test(entry.name)) return []
    return [full]
  })
}

/** Conteúdo de cada `className="…"` / `className={`…`}` do arquivo. */
function classNames(content: string): string[] {
  return [...content.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/gs)].map((m) => m[1] ?? m[2] ?? '')
}

/** Botão preenchido: `bg-primary` sólido, não `bg-primary/30`. */
const PREENCHIDO = /\bbg-primary(?![-/\w])/

const files = sourceFiles(SRC)

describe('pares de cor em botão preenchido', () => {
  it('varre o código-fonte de verdade', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('hover que troca o fundo troca o texto junto', () => {
    const faltando: string[] = []
    for (const file of files) {
      for (const cls of classNames(readFileSync(file, 'utf8'))) {
        if (!PREENCHIDO.test(cls)) continue
        if (cls.includes('hover:bg-primary-container') && !cls.includes('hover:text-on-primary-container')) {
          faltando.push(file.replace(`${SRC}/`, 'src/'))
        }
      }
    }
    expect([...new Set(faltando)]).toEqual([])
  })

  it('papel de container não vira cor de texto', () => {
    // `primary-container` é fundo. Como cor de texto vale 1.11:1 sobre a
    // superfície clara da EMR e 10.50:1 sobre a escura do produto — de novo,
    // funcionava por sorte no escuro. O acento legível é `primary`.
    const usados: string[] = []
    for (const file of files) {
      const content = readFileSync(file, 'utf8')
      for (const [match] of content.matchAll(
        /\b(?:hover:|focus:|group-hover:)?text-(?:primary|secondary|tertiary|error)-container\b/g,
      )) {
        usados.push(`${file.replace(`${SRC}/`, 'src/')}: ${match}`)
      }
    }
    expect([...new Set(usados)]).toEqual([])
  })

  it('desabilitado usa par de cores, não opacidade', () => {
    const comOpacidade: string[] = []
    for (const file of files) {
      for (const cls of classNames(readFileSync(file, 'utf8'))) {
        if (!PREENCHIDO.test(cls)) continue
        if (/\bdisabled:opacity-\d+\b/.test(cls)) comOpacidade.push(file.replace(`${SRC}/`, 'src/'))
      }
    }
    expect([...new Set(comOpacidade)]).toEqual([])
  })
})

describe('por que a regra existe', () => {
  const emr = brandingFromPreset(BRAND_PRESETS.emr).schemes.light
  const legends = brandingFromPreset(BRAND_PRESETS.legends).colors

  it('o par errado some no claro e sobrevive no escuro — a assimetria que escondeu o defeito', () => {
    expect(contrastRatio(emr['on-primary'], emr['primary-container'])).toBeLessThan(2)
    expect(contrastRatio(legends['on-primary'], legends['primary-container'])).toBeGreaterThan(4.5)
  })

  it('o par certo passa nos dois, e já é garantido pelo checador de contraste', () => {
    for (const p of [emr, legends]) {
      expect(contrastRatio(p['on-primary-container'], p['primary-container'])).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('container como texto some no claro; `primary` serve nos dois', () => {
    expect(contrastRatio(emr['primary-container'], emr.surface)).toBeLessThan(2)
    expect(contrastRatio(legends['primary-container'], legends.surface)).toBeGreaterThan(4.5)
    for (const p of [emr, legends]) {
      expect(contrastRatio(p.primary, p.surface)).toBeGreaterThanOrEqual(4.5)
    }
  })
})

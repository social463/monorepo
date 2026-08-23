import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import tailwindConfig from '../tailwind.config'

/**
 * Classe de tipografia que não está no tema não vira regra CSS — o Tailwind
 * simplesmente não gera nada e o texto herda o tamanho do pai, sem erro em
 * lugar nenhum. Foi assim que `text-title-*` e `font-title` viveram em ~55
 * lugares parecendo estilo aplicado. Este teste trava a volta disso.
 */
// `import.meta.url` não é file:// no ambiente jsdom; a raiz do vitest é apps/web.
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
const fontSize = Object.keys(tailwindConfig.theme?.extend?.fontSize ?? {})
const fontFamily = Object.keys(tailwindConfig.theme?.extend?.fontFamily ?? {})

function findUsages(pattern: RegExp, valid: string[]): string[] {
  const invalid: string[] = []
  for (const file of files) {
    const content = readFileSync(file, 'utf8')
    for (const [, name] of content.matchAll(pattern)) {
      if (!valid.includes(name)) invalid.push(`${file.replace(`${SRC}/`, 'src/')}: ${name}`)
    }
  }
  return [...new Set(invalid)]
}

describe('tokens de tipografia', () => {
  it('varre o código-fonte de verdade', () => {
    // Sem isto, um SRC errado faria os testes abaixo passarem sem ler nada.
    expect(files.length).toBeGreaterThan(50)
  })

  it('não usa escala de fonte que o tema não define', () => {
    // Só as famílias semânticas do tema (headline/title/body/label/display);
    // `text-sm`, `text-[16px]` e `text-primary` seguem sendo do Tailwind/paleta.
    const pattern = /\btext-((?:headline|title|body|label|display)-[a-z0-9]+)\b/g
    expect(findUsages(pattern, fontSize)).toEqual([])
  })

  it('não usa família de fonte que o tema não define', () => {
    const pattern = /\bfont-((?:headline|title|label|body|display|sans|mono|serif))\b/g
    expect(findUsages(pattern, [...fontFamily, 'serif'])).toEqual([])
  })
})

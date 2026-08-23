import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Fontes embutidas usadas pelos renders SVG→PNG (card do Destaque, certificado).
 * Ficam num módulo próprio porque o caminho depende de onde o processo subiu
 * (dev na raiz do monorepo, container em `apps/api`).
 */
const API_DIR = dirname(dirname(fileURLToPath(import.meta.url)))

const FONT_DIRS = [
  join(process.cwd(), 'assets', 'fonts'),
  join(process.cwd(), 'apps', 'api', 'assets', 'fonts'),
  join(API_DIR, 'assets', 'fonts'),
  join(API_DIR, '..', 'assets', 'fonts'),
]

export const SANS_FONT = 'Montserrat'
export const SCRIPT_FONT = 'Dancing Script'

export const FONT_FILES = [
  'Montserrat-Regular.ttf',
  'Montserrat-Bold.ttf',
  'Montserrat-ExtraBold.ttf',
  'DancingScript.ttf',
].flatMap((file) => FONT_DIRS.map((dir) => join(dir, file)))

/** Opções de fonte do resvg. Sem os arquivos embutidos, cai pras fontes do sistema. */
export function resvgFontOptions(): { fontFiles: string[]; loadSystemFonts: boolean; defaultFontFamily: string } {
  const fontFiles = FONT_FILES.filter((file) => existsSync(file))
  return {
    fontFiles,
    loadSystemFonts: fontFiles.length === 0,
    defaultFontFamily: SANS_FONT,
  }
}

/** Escapa texto para interpolar com segurança dentro do SVG. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

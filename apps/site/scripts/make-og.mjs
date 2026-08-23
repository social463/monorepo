/*
 * Gera a imagem de Open Graph (1200×630) a partir de um SVG.
 * Uso, da raiz do repo:  node apps/site/scripts/make-og.mjs
 *
 * Isto é um placeholder decente para não subir a landing com o card de
 * compartilhamento quebrado. Quando houver um print bom do escritório,
 * troque por uma composição de verdade — um OG com screenshot converte
 * bem mais que um OG só tipográfico.
 */
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import sharp from 'sharp'

const here = dirname(fileURLToPath(import.meta.url))
const out = resolve(here, '../img/og-image.png')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <pattern id="tiles" width="32" height="32" patternUnits="userSpaceOnUse">
      <path d="M32 0H0V32" fill="none" stroke="#52fba2" stroke-opacity="0.07" stroke-width="1"/>
    </pattern>
    <radialGradient id="fade" cx="50%" cy="30%" r="75%">
      <stop offset="0%" stop-color="#fff" stop-opacity="1"/>
      <stop offset="100%" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <mask id="m"><rect width="1200" height="630" fill="url(#fade)"/></mask>
  </defs>

  <rect width="1200" height="630" fill="#0b0f14"/>
  <rect width="1200" height="630" fill="url(#tiles)" mask="url(#m)"/>

  <g transform="translate(80,78)">
    <rect width="18" height="18" fill="#52fba2"/>
    <rect x="18" y="18" width="18" height="18" fill="#0a6b3d"/>
    <text x="52" y="29" font-family="Helvetica, Arial, sans-serif" font-size="26" font-weight="700" fill="#e9eef4" letter-spacing="0.5">Legends</text>
  </g>

  <text x="80" y="300" font-family="Helvetica, Arial, sans-serif" font-size="76" font-weight="700" fill="#e9eef4" letter-spacing="-2">Seu time remoto de volta</text>
  <text x="80" y="386" font-family="Helvetica, Arial, sans-serif" font-size="76" font-weight="700" fill="#52fba2" letter-spacing="-2">ao mesmo lugar</text>

  <text x="80" y="466" font-family="Helvetica, Arial, sans-serif" font-size="28" fill="#9aa7b4">Escrit&#243;rio virtual com &#225;udio por proximidade.</text>
  <text x="80" y="506" font-family="Helvetica, Arial, sans-serif" font-size="28" fill="#9aa7b4">Voc&#234; chega perto, o &#225;udio abre.</text>

  <rect x="80" y="556" width="240" height="4" fill="#52fba2"/>
</svg>`

await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(out)
console.log('OG image gerada em', out)

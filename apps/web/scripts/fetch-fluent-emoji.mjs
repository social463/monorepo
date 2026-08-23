// Baixa os emojis 3D do Microsoft Fluent Emoji (MIT) para
// apps/web/public/badge-art/<key>.png. Complementa o set do 3dicons.
//
// Uso: node apps/web/scripts/fetch-fluent-emoji.mjs
//
// As chaves usam prefixo `fe-` e batem com as entradas art('fe-...') em
// src/lib/badge-art.ts. O caminho de origem é relativo a assets/ no repo
// microsoft/fluentui-emoji (branch main). Emojis com tom de pele ficam na
// variante Default. Para acrescentar novos: descubra o caminho 3D em
//   https://github.com/microsoft/fluentui-emoji/tree/main/assets
// adicione aqui e uma entrada art('fe-...') no catálogo.

import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = 'https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/assets/'

// key (sem o prefixo `fe-`) -> caminho do PNG 3D dentro de assets/
const EMOJI = {
  trophy: 'Trophy/3D/trophy_3d.png',
  'medal-gold': '1st place medal/3D/1st_place_medal_3d.png',
  'medal-silver': '2nd place medal/3D/2nd_place_medal_3d.png',
  'medal-bronze': '3rd place medal/3D/3rd_place_medal_3d.png',
  'medal-sports': 'Sports medal/3D/sports_medal_3d.png',
  'medal-honor': 'Military medal/3D/military_medal_3d.png',
  crown: 'Crown/3D/crown_3d.png',
  'star-glow': 'Glowing star/3D/glowing_star_3d.png',
  star: 'Star/3D/star_3d.png',
  'shooting-star': 'Shooting star/3D/shooting_star_3d.png',
  sparkles: 'Sparkles/3D/sparkles_3d.png',
  hundred: 'Hundred points/3D/hundred_points_3d.png',
  check: 'Check mark button/3D/check_mark_button_3d.png',
  party: 'Party popper/3D/party_popper_3d.png',
  confetti: 'Confetti ball/3D/confetti_ball_3d.png',
  fire: 'Fire/3D/fire_3d.png',
  'heart-fire': 'Heart on fire/3D/heart_on_fire_3d.png',
  voltage: 'High voltage/3D/high_voltage_3d.png',
  rocket: 'Rocket/3D/rocket_3d.png',
  comet: 'Comet/3D/comet_3d.png',
  boom: 'Collision/3D/collision_3d.png',
  brain: 'Brain/3D/brain_3d.png',
  bulb: 'Light bulb/3D/light_bulb_3d.png',
  gem: 'Gem stone/3D/gem_stone_3d.png',
  muscle: 'Flexed biceps/Default/3D/flexed_biceps_3d_default.png',
  'mech-arm': 'Mechanical arm/3D/mechanical_arm_3d.png',
  wand: 'Magic wand/3D/magic_wand_3d.png',
  handshake: 'Handshake/3D/handshake_3d.png',
  'raising-hands': 'Raising hands/Default/3D/raising_hands_3d_default.png',
  clap: 'Clapping hands/Default/3D/clapping_hands_3d_default.png',
  'heart-hands': 'Heart hands/Default/3D/heart_hands_3d_default.png',
  heart: 'Red heart/3D/red_heart_3d.png',
  'heart-sparkle': 'Sparkling heart/3D/sparkling_heart_3d.png',
  'heart-grow': 'Growing heart/3D/growing_heart_3d.png',
  target: 'Bullseye/3D/bullseye_3d.png',
  puzzle: 'Puzzle piece/3D/puzzle_piece_3d.png',
  key: 'Key/3D/key_3d.png',
  'old-key': 'Old key/3D/old_key_3d.png',
  shield: 'Shield/3D/shield_3d.png',
  gear: 'Gear/3D/gear_3d.png',
  wrench: 'Wrench/3D/wrench_3d.png',
  tools: 'Hammer and wrench/3D/hammer_and_wrench_3d.png',
  'chart-up': 'Chart increasing/3D/chart_increasing_3d.png',
  'bar-chart': 'Bar chart/3D/bar_chart_3d.png',
  laptop: 'Laptop/3D/laptop_3d.png',
  satellite: 'Satellite/3D/satellite_3d.png',
  telescope: 'Telescope/3D/telescope_3d.png',
  microscope: 'Microscope/3D/microscope_3d.png',
  'test-tube': 'Test tube/3D/test_tube_3d.png',
  compass: 'Compass/3D/compass_3d.png',
  detective: 'Detective/Default/3D/detective_3d_default.png',
  books: 'Books/3D/books_3d.png',
  'grad-cap': 'Graduation cap/3D/graduation_cap_3d.png',
  megaphone: 'Megaphone/3D/megaphone_3d.png',
  bell: 'Bell/3D/bell_3d.png',
  seedling: 'Seedling/3D/seedling_3d.png',
  tree: 'Deciduous tree/3D/deciduous_tree_3d.png',
  sun: 'Sun/3D/sun_3d.png',
  moon: 'Crescent moon/3D/crescent_moon_3d.png',
  rainbow: 'Rainbow/3D/rainbow_3d.png',
  mountain: 'Snow-capped mountain/3D/snow-capped_mountain_3d.png',
  eagle: 'Eagle/3D/eagle_3d.png',
  owl: 'Owl/3D/owl_3d.png',
  dragon: 'Dragon/3D/dragon_3d.png',
  unicorn: 'Unicorn/3D/unicorn_3d.png',
  sunflower: 'Sunflower/3D/sunflower_3d.png',
  // Teclas numéricas (keycaps) — úteis p/ selos por nível, ex. tempo de casa.
  'num-1': 'Keycap 1/3D/keycap_1_3d.png',
  'num-2': 'Keycap 2/3D/keycap_2_3d.png',
  'num-3': 'Keycap 3/3D/keycap_3_3d.png',
  'num-4': 'Keycap 4/3D/keycap_4_3d.png',
  'num-5': 'Keycap 5/3D/keycap_5_3d.png',
  'num-6': 'Keycap 6/3D/keycap_6_3d.png',
  'num-7': 'Keycap 7/3D/keycap_7_3d.png',
  'num-8': 'Keycap 8/3D/keycap_8_3d.png',
  'num-9': 'Keycap 9/3D/keycap_9_3d.png',
  'num-10': 'Keycap 10/3D/keycap_10_3d.png',
}

// Garante que tudo no catálogo com prefixo `fe-` está mapeado aqui (e vice-versa).
const catalog = await readFile(join(root, 'src/lib/badge-art.ts'), 'utf8')
const catalogFeKeys = [...catalog.matchAll(/art\('fe-([a-z0-9-]+)'/g)].map((m) => m[1])
const mapKeys = Object.keys(EMOJI)
const missingInMap = catalogFeKeys.filter((k) => !(k in EMOJI))
const missingInCatalog = mapKeys.filter((k) => !catalogFeKeys.includes(k))
if (missingInMap.length || missingInCatalog.length) {
  if (missingInMap.length) console.warn(`No catálogo mas sem mapa: ${missingInMap.join(', ')}`)
  if (missingInCatalog.length) console.warn(`No mapa mas sem catálogo: ${missingInCatalog.join(', ')}`)
}

const outDir = join(root, 'public/badge-art')
await mkdir(outDir, { recursive: true })

let ok = 0
const failed = []
for (const [key, src] of Object.entries(EMOJI)) {
  const url = encodeURI(BASE + src)
  try {
    const res = await fetch(url)
    if (!res.ok) {
      failed.push(`fe-${key} (HTTP ${res.status})`)
      continue
    }
    const buf = Buffer.from(await res.arrayBuffer())
    await writeFile(join(outDir, `fe-${key}.png`), buf)
    ok++
    console.log(`✓ fe-${key}.png (${buf.length} bytes)`)
  } catch (err) {
    failed.push(`fe-${key} (${err.message})`)
  }
}

console.log(`\n${ok}/${mapKeys.length} emojis Fluent baixados em public/badge-art/`)
if (failed.length) {
  console.log(`Falharam: ${failed.join(', ')}`)
  process.exit(1)
}

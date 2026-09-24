import type Phaser from 'phaser'

/**
 * Os desenhos de tinta — bolinha em voo e manchas — e a geração das texturas.
 *
 * Fora da `OfficeScene` porque a arena usa os mesmos: tinta é tinta, e manter
 * duas cópias das máscaras acabaria com o escritório e a arena divergindo no
 * visual do mesmo jogo.
 */

export const PAINT_PELLET_TEXTURE = 'office-paint-pellet'
/** Uma textura por desenho de mancha — `${PAINT_SPLAT_TEXTURE}-${variant}`. */
export const PAINT_SPLAT_TEXTURE = 'office-paint-splat'

/**
 * Os desenhos de mancha, um pixel por caractere — mesma convenção de mapa em
 * array de strings do `OFFICE_MAP`.
 *
 * Desenhados no tamanho REAL em que aparecem, e é isso que importa: o jogo roda
 * com `pixelArt: true`, então textura grande encolhida (ou girada em ângulo
 * livre) é reamostrada por vizinho-mais-próximo e chega na tela como um
 * serrilhado sem forma. A variedade vem de ter quatro desenhos, não de
 * transformar um.
 *
 * Cinco pixels de lado, contra 22 de torso: cabem as cinco manchas do teto
 * (`PAINTBALL_MAX_SPLATS`) sem soterrar o personagem nem tapar o rosto.
 */
export const PAINT_SPLAT_MASKS: readonly (readonly string[])[] = [
  // gota com escorrido pra baixo
  ['.##..', '####.', '####.', '.##.#', '..#..'],
  // espalhada pra esquerda, com respingo solto
  ['..##.', '.####', '####.', '.###.', '#..#.'],
  // compacta, respingo em cima
  ['..#..', '.###.', '####.', '.###.', '..#..'],
  // achatada, escorrendo pros lados
  ['.....', '.###.', '#####', '####.', '#...#'],
]

/** A bolinha em voo. Desenhada à mão pelo mesmo motivo das manchas. */
export const PAINT_PELLET_MASK: readonly string[] = ['.##.', '####', '####', '.##.']

/**
 * Gera as texturas de tinta na cena.
 *
 * Desenha por MÁSCARA (um `fillRect` por pixel aceso) em vez de `fillCircle`:
 * um círculo num canvas de 4px sai suavizado e depois vira lama no
 * nearest-neighbour do `pixelArt`.
 */
export function createPaintTextures(scene: Phaser.Scene, graphics: Phaser.GameObjects.Graphics): void {
  const stamp = (mask: readonly string[], key: string) => {
    if (scene.textures.exists(key)) return
    graphics.clear()
    graphics.fillStyle(0xffffff, 1)
    for (let y = 0; y < mask.length; y += 1) {
      for (let x = 0; x < mask[y].length; x += 1) {
        if (mask[y][x] === '#') graphics.fillRect(x, y, 1, 1)
      }
    }
    graphics.generateTexture(key, mask[0].length, mask.length)
  }

  stamp(PAINT_PELLET_MASK, PAINT_PELLET_TEXTURE)
  PAINT_SPLAT_MASKS.forEach((mask, index) => stamp(mask, `${PAINT_SPLAT_TEXTURE}-${index}`))
}

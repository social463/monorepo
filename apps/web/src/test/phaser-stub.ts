/**
 * Phaser de mentira, para os testes.
 *
 * O Phaser não roda no jsdom: no próprio import ele sonda o canvas 2D (que o jsdom
 * não implementa), exige `phaser3spectorjs` (dependência opcional, ausente aqui) e
 * usa `ResizeObserver`. Cada uma dessas falhas vira rejeição sem dono.
 *
 * Os arquivos de teste que encostam em cena já declaram `vi.mock('phaser')`, e esse
 * mock continua valendo — ele ganha deste alias. O que este stub cobre é o caminho
 * que escapava: o `import('phaser')` DINÂMICO do `ArenaPlayground`, que o Vitest
 * resolve como CJS externo e por isso não passava pelo mock do arquivo.
 *
 * É stub de import, não de comportamento: quem precisar de cena de verdade que
 * declare o próprio `vi.mock` com o que o teste espera.
 */
class Game {
  scale = { resize() {} }
  loop = { step() {} }
  destroy() {}
}

class Scene {
  constructor(_config?: unknown) {}
}

export default {
  Game,
  Scene,
  AUTO: 0,
  CANVAS: 1,
  WEBGL: 2,
  Scale: { RESIZE: 0, FIT: 1, NONE: 2, CENTER_BOTH: 3 },
}

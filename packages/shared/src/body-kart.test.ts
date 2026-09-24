import { describe, expect, it } from 'vitest'
import {
  BODY_KART_ACCEL,
  BODY_KART_BODY_HALF,
  BODY_KART_MAX_REVERSE,
  BODY_KART_MAX_SPEED,
  BODY_KART_TURN_FULL_SPEED,
  BODY_KART_WALL_KEEP,
  kartFacing,
  normalizeHeading,
  stepBodyKart,
  type BodyKartState,
} from './body-kart'
import type { BodyCollisionGrid } from './body-collision'
import type { BodyInput } from './body-move'

/**
 * Pista livre: nada bloqueado, para medir a física sem parede no caminho.
 *
 * Grande de propósito. Fora da grade é BLOQUEADO (`bodyBlockedAt`), então uma
 * grade curta vira uma parede invisível no fim do teste — e a medida da
 * aceleração passa a incluir uma batida.
 */
function gradeLivre(width = 900, height = 900): BodyCollisionGrid {
  return { width, height, cellWidth: 8, cellHeight: 8, blocked: new Uint8Array(width * height) }
}

/** Grade com uma parede vertical em `x >= px`. */
function gradeComParede(px: number): BodyCollisionGrid {
  const grid = gradeLivre()
  const coluna = Math.floor(px / grid.cellWidth)
  for (let cy = 0; cy < grid.height; cy += 1) {
    for (let cx = coluna; cx < grid.width; cx += 1) grid.blocked[cy * grid.width + cx] = 1
  }
  return grid
}

const parado = (over: Partial<BodyKartState> = {}): BodyKartState => ({
  x: 3600,
  y: 3600,
  heading: 0,
  speed: 0,
  dir: 'right',
  ...over,
})

const input = (over: Partial<BodyInput> = {}): BodyInput => ({
  seq: 1,
  dx: 0,
  dy: 0,
  dtMs: 100,
  ...over,
})

/** Aplica o mesmo input N vezes — atalho para deixar o kart chegar ao regime. */
function repetir(
  state: BodyKartState,
  entrada: Partial<BodyInput>,
  vezes: number,
  grid = gradeLivre(),
): BodyKartState {
  let atual = state
  for (let k = 0; k < vezes; k += 1) atual = stepBodyKart(atual, input({ ...entrada, seq: k + 1 }), grid)
  return atual
}

describe('acelerador e freio', () => {
  it('acelera para a frente com dy negativo', () => {
    // `dtMs` de 40ms para ficar abaixo de `BODY_MAX_STEP_MS`: acima do teto a
    // integração é cortada, e a conta deixaria de ser a da aceleração.
    const depois = stepBodyKart(parado(), input({ dy: -1, dtMs: 40 }), gradeLivre())
    expect(depois.speed).toBeCloseTo(BODY_KART_ACCEL * 0.04, 5)
    expect(depois.x).toBeGreaterThan(3600)
  })

  it('respeita a velocidade máxima', () => {
    const depois = repetir(parado(), { dy: -1 }, 60)
    expect(depois.speed).toBe(BODY_KART_MAX_SPEED)
  })

  it('mantém a velocidade quando o pé sai — é isso que é inércia', () => {
    // A diferença central em relação a `stepBody`: soltar a tecla não para.
    const rodando = repetir(parado(), { dy: -1 }, 20)
    const soltou = stepBodyKart(rodando, input({ dy: 0, dtMs: 50 }), gradeLivre())
    expect(soltou.speed).toBeGreaterThan(rodando.speed * 0.9)
    expect(soltou.speed).toBeLessThan(rodando.speed)
  })

  it('o atrito nunca cruza o zero sozinho', () => {
    // Sem a guarda, o kart passaria de andando para andando de RÉ só por soltar
    // a tecla — e ninguém entenderia por quê.
    const devagar = parado({ speed: 5 })
    const depois = repetir(devagar, { dy: 0 }, 10)
    expect(depois.speed).toBe(0)
  })

  it('freia e depois engata a ré com a mesma tecla', () => {
    const rodando = repetir(parado(), { dy: -1 }, 20)
    const freando = repetir(rodando, { dy: 1 }, 40)
    expect(freando.speed).toBeLessThan(0)
    expect(freando.speed).toBeGreaterThanOrEqual(-BODY_KART_MAX_REVERSE)
  })

  it('limita a ré bem abaixo da frente', () => {
    const deRe = repetir(parado(), { dy: 1 }, 60)
    expect(deRe.speed).toBe(-BODY_KART_MAX_REVERSE)
  })
})

describe('esterço', () => {
  it('não gira o kart parado', () => {
    // A regra que sozinha separa dirigir de andar. Sem ela, o kart pivota no
    // lugar e a curva deixa de ter traçado.
    const depois = repetir(parado(), { dx: 1 }, 20)
    expect(depois.heading).toBe(0)
  })

  it('gira mais quanto mais rápido, até o grip cheio', () => {
    const devagar = stepBodyKart(
      parado({ speed: BODY_KART_TURN_FULL_SPEED / 4 }),
      input({ dx: 1, dtMs: 100 }),
      gradeLivre(),
    )
    const rapido = stepBodyKart(
      parado({ speed: BODY_KART_TURN_FULL_SPEED }),
      input({ dx: 1, dtMs: 100 }),
      gradeLivre(),
    )
    expect(Math.abs(rapido.heading)).toBeGreaterThan(Math.abs(devagar.heading) * 3)
  })

  it('esterça ao contrário na ré, como um carro', () => {
    const frente = stepBodyKart(parado({ speed: 300 }), input({ dx: 1, dtMs: 100 }), gradeLivre())
    const re = stepBodyKart(parado({ speed: -300 }), input({ dx: 1, dtMs: 100 }), gradeLivre())
    expect(Math.sign(frente.heading)).toBe(1)
    expect(Math.sign(re.heading)).toBe(-1)
  })

  it('o freio de mão vira mais e custa velocidade', () => {
    const base = parado({ speed: 400 })
    const normal = stepBodyKart(base, input({ dx: 1, dtMs: 100 }), gradeLivre())
    const derrapando = stepBodyKart(base, input({ dx: 1, dtMs: 100, sprint: true }), gradeLivre())
    expect(Math.abs(derrapando.heading)).toBeGreaterThan(Math.abs(normal.heading))
    // E o custo, que é o que torna derrapar uma ESCOLHA em vez de sempre certo.
    expect(derrapando.speed).toBeLessThan(normal.speed)
  })

  it('mantém o rumo normalizado', () => {
    const girando = repetir(parado({ speed: BODY_KART_MAX_SPEED }), { dx: 1 }, 200)
    expect(girando.heading).toBeGreaterThanOrEqual(-Math.PI)
    expect(girando.heading).toBeLessThan(Math.PI)
  })
})

describe('barreira', () => {
  it('bater custa velocidade', () => {
    // Sem o custo, raspar a barreira seria o traçado mais rápido da pista.
    const parede = gradeComParede(3700)
    const rodando = repetir(parado({ x: 3680 }), { dy: -1 }, 6, parede)
    const antes = repetir(parado({ x: 1000 }), { dy: -1 }, 6)
    expect(rodando.speed).toBeLessThan(antes.speed * (BODY_KART_WALL_KEEP + 0.01))
  })

  it('não atravessa a barreira', () => {
    const parede = gradeComParede(3700)
    const depois = repetir(parado({ x: 3400, speed: BODY_KART_MAX_SPEED }), { dy: -1 }, 40, parede)
    expect(depois.x).toBeLessThan(3700 - BODY_KART_BODY_HALF + 1)
  })

  it('desliza na barreira em vez de grudar', () => {
    // Herdado de `stepBody`: um eixo de cada vez. Testar o destino diagonal de
    // uma vez faria o kart parar de vez ao raspar a parede em ângulo.
    const parede = gradeComParede(3700)
    const emAngulo = parado({ x: 3680, y: 3600, heading: Math.PI / 8, speed: 400 })
    const depois = stepBodyKart(emAngulo, input({ dy: -1, dtMs: 50 }), parede)
    expect(depois.y).toBeGreaterThan(3600)
  })

  it('para de vez quando a batida deixa só um resto de velocidade', () => {
    const parede = gradeComParede(3700)
    const encostado = parado({ x: 3689, speed: 10 })
    const depois = stepBodyKart(encostado, input({ dy: 0, dtMs: 50 }), parede)
    expect(depois.speed).toBe(0)
  })
})

describe('largada travada', () => {
  it('não anda e não acumula velocidade', () => {
    // Zerar a velocidade (em vez de só ignorar o input) é o que impede o piloto
    // de "guardar" aceleração durante a contagem e disparar quando ela acaba.
    const depois = stepBodyKart(parado({ speed: 300 }), input({ dy: -1, dtMs: 100 }), gradeLivre(), {
      frozen: true,
    })
    expect(depois.speed).toBe(0)
    expect(depois.x).toBe(3600)
    expect(depois.heading).toBe(0)
  })
})

describe('determinismo', () => {
  it('mesma entrada, mesmo resultado — é o que faz a reconciliação convergir', () => {
    const entradas: BodyInput[] = [
      { seq: 1, dx: 1, dy: -1, dtMs: 33 },
      { seq: 2, dx: 0, dy: -1, dtMs: 33, sprint: true },
      { seq: 3, dx: -1, dy: 1, dtMs: 33 },
    ]
    const rodar = () => {
      let state = parado()
      const grid = gradeLivre()
      for (const entrada of entradas) state = stepBodyKart(state, entrada, grid)
      return state
    }
    expect(rodar()).toEqual(rodar())
  })

  it('corta o dt gigante da aba que volta do background', () => {
    // Sem o teto, integrar 5s de uma vez atravessaria a barreira (tunneling).
    const grid = gradeLivre()
    const enorme = stepBodyKart(parado({ speed: 400 }), input({ dy: -1, dtMs: 5_000 }), grid)
    const teto = stepBodyKart(parado({ speed: 400 }), input({ dy: -1, dtMs: 50 }), grid)
    expect(enorme.x).toBeCloseTo(teto.x, 6)
  })
})

describe('kartFacing', () => {
  it('mapeia o rumo nas quatro poses do LPC', () => {
    expect(kartFacing(0)).toBe('right')
    expect(kartFacing(Math.PI)).toBe('left')
    expect(kartFacing(Math.PI / 2)).toBe('down')
    expect(kartFacing(-Math.PI / 2)).toBe('up')
  })

  it('o horizontal ganha no empate, como bodyFacing', () => {
    expect(kartFacing(Math.PI / 4)).toBe('right')
  })
})

describe('normalizeHeading', () => {
  it('traz qualquer ângulo para (−π, π]', () => {
    // A faixa é [−π, π): π e −π são o MESMO rumo, e o que importa é que o
    // resultado seja limitado — o rumo cresce sem teto enquanto se dá voltas.
    expect(Math.abs(normalizeHeading(Math.PI * 3))).toBeCloseTo(Math.PI, 6)
    expect(Math.abs(normalizeHeading(-Math.PI * 3))).toBeCloseTo(Math.PI, 6)
    expect(normalizeHeading(Math.PI / 2)).toBeCloseTo(Math.PI / 2, 6)
  })
})

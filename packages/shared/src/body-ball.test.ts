import { describe, expect, it } from 'vitest'
import {
  BODY_BALL_KICK_MIN_SPEED,
  BODY_BALL_KICK_REACH,
  BODY_BALL_KICK_SPEED,
  BODY_BALL_MIN_SPEED,
  BODY_BALL_PASS_SPEED,
  BODY_BALL_SPRINT_KICK_SPEED,
  BODY_BALL_TOUCH_REACH,
  SOCCER_FIELD,
  bodyCollisionGrid,
  bodyKickSpeed,
  createEmptyMapDocumentV1,
  dribbleSpeed,
  kickBodyBall,
  restingBall,
  soccerKickoffSpot,
  soccerMapDocument,
  stepBodyBall,
  touchBodyBall,
  type BodyBallState,
} from './index'

const grid = bodyCollisionGrid(soccerMapDocument())
const centro = soccerKickoffSpot()

/** Roda a bola em passos de 25ms (o tick do servidor) até ela parar. */
function ateParar(ball: BodyBallState, limite = 400): BodyBallState {
  let atual = ball
  for (let i = 0; i < limite && (atual.vx !== 0 || atual.vy !== 0); i += 1) {
    atual = stepBodyBall(atual, 25, grid)
  }
  return atual
}

describe('stepBodyBall', () => {
  it('bola parada não anda sozinha', () => {
    const parada = restingBall(centro)
    expect(stepBodyBall(parada, 100, grid)).toEqual(parada)
  })

  it('o atrito freia até parar, e a bola para inteira', () => {
    const rolando = { ...centro, vx: BODY_BALL_KICK_SPEED, vy: 0 }
    const depois = stepBodyBall(rolando, 100, grid)
    expect(depois.vx).toBeLessThan(BODY_BALL_KICK_SPEED)
    expect(depois.x).toBeGreaterThan(centro.x)

    const final = ateParar(rolando)
    expect(final.vx).toBe(0)
    expect(final.vy).toBe(0)
    // Sem o corte por velocidade mínima ela deslizaria para sempre.
    expect(BODY_BALL_MIN_SPEED).toBeGreaterThan(0)
  })

  it('o chute forte corre mais que o normal, e nenhum atravessa o campo', () => {
    const normal = ateParar({ ...centro, vx: BODY_BALL_KICK_SPEED, vy: 0 })
    const forte = ateParar({ ...centro, vx: BODY_BALL_SPRINT_KICK_SPEED, vy: 0 })
    expect(forte.x - centro.x).toBeGreaterThan(normal.x - centro.x)
    // Do meio do campo, nem o chute forte chega ao gol adversário: o passe
    // precisa existir.
    expect(forte.x).toBeLessThan(SOCCER_FIELD.goals.leste.line)
  })

  it('bate no muro e volta, em vez de atravessar', () => {
    // Contra o muro de cima, na velocidade máxima do jogo.
    const final = ateParar({ ...centro, vx: 0, vy: -BODY_BALL_SPRINT_KICK_SPEED })
    expect(final.y).toBeGreaterThan(SOCCER_FIELD.top)
    // Voltou: parou abaixo de onde a subida terminaria se ela cruzasse.
    expect(final.y).toBeGreaterThan(0)
  })

  it('mantém o eixo livre ao bater — não morre na quina', () => {
    const perto = { x: centro.x, y: SOCCER_FIELD.top + 8, vx: 300, vy: -300 }
    const depois = stepBodyBall(perto, 25, grid)
    expect(depois.vx).toBeGreaterThan(0)
    expect(depois.vy).toBeGreaterThan(0)
  })
})

describe('kickBodyBall', () => {
  const bola = restingBall(centro)

  it('fora do alcance não sai chute nenhum', () => {
    const longe = { x: centro.x + BODY_BALL_KICK_REACH + 5, y: centro.y }
    expect(kickBodyBall({ ball: bola, kicker: longe, angle: 0 })).toBeNull()
  })

  it('sai no ângulo mirado e na força do servidor', () => {
    const perto = { x: centro.x - 10, y: centro.y }
    const chutada = kickBodyBall({ ball: bola, kicker: perto, angle: 0 })
    expect(chutada?.vx).toBeCloseTo(BODY_BALL_KICK_SPEED, 5)
    expect(chutada?.vy).toBeCloseTo(0, 5)
    // A posição não muda no chute: quem anda com ela é a simulação.
    expect(chutada?.x).toBe(bola.x)
  })

  it('o passe é curto, e a corrida não o transforma em chutão', () => {
    const perto = { x: centro.x - 10, y: centro.y }
    const passe = kickBodyBall({ ball: bola, kicker: perto, angle: 0, power: 'passe' })
    expect(passe?.vx).toBeCloseTo(BODY_BALL_PASS_SPEED, 5)
    const correndo = kickBodyBall({
      ball: bola,
      kicker: perto,
      angle: 0,
      power: 'passe',
      sprint: true,
    })
    expect(correndo?.vx).toBeCloseTo(BODY_BALL_PASS_SPEED, 5)
  })

  it('correndo, o chute é mais forte — é o Shift que já existe', () => {
    const perto = { x: centro.x - 10, y: centro.y }
    const forte = kickBodyBall({ ball: bola, kicker: perto, angle: 0, sprint: true })
    expect(forte?.vx).toBeCloseTo(BODY_BALL_SPRINT_KICK_SPEED, 5)
  })

  it('sem carga alguma, o chute sai no mínimo — é o toque rápido na tecla', () => {
    const perto = { x: centro.x - 10, y: centro.y }
    const fraco = kickBodyBall({ ball: bola, kicker: perto, angle: 0, charge: 0 })
    expect(fraco?.vx).toBeCloseTo(BODY_BALL_KICK_MIN_SPEED, 5)
  })

  it('carga fora de [0,1] satura no mínimo/máximo, sem virar chute negativo', () => {
    const perto = { x: centro.x - 10, y: centro.y }
    const abaixo = kickBodyBall({ ball: bola, kicker: perto, angle: 0, charge: -1 })
    const acima = kickBodyBall({ ball: bola, kicker: perto, angle: 0, charge: 5 })
    expect(abaixo?.vx).toBeCloseTo(BODY_BALL_KICK_MIN_SPEED, 5)
    expect(acima?.vx).toBeCloseTo(BODY_BALL_KICK_SPEED, 5)
  })
})

describe('bodyKickSpeed', () => {
  it('interpola entre o mínimo e o teto conforme a carga', () => {
    expect(bodyKickSpeed('chute', false, 0)).toBeCloseTo(BODY_BALL_KICK_MIN_SPEED, 5)
    expect(bodyKickSpeed('chute', false, 1)).toBeCloseTo(BODY_BALL_KICK_SPEED, 5)
    expect(bodyKickSpeed('chute', false, 0.5)).toBeCloseTo(
      (BODY_BALL_KICK_MIN_SPEED + BODY_BALL_KICK_SPEED) / 2,
      5,
    )
  })

  it('a corrida interpola até o teto de corrida, não até o do chute parado', () => {
    expect(bodyKickSpeed('chute', true, 0)).toBeCloseTo(BODY_BALL_KICK_MIN_SPEED, 5)
    expect(bodyKickSpeed('chute', true, 1)).toBeCloseTo(BODY_BALL_SPRINT_KICK_SPEED, 5)
  })

  it('o passe ignora a carga — continua no valor fixo de sempre', () => {
    expect(bodyKickSpeed('passe', false, 0)).toBeCloseTo(BODY_BALL_PASS_SPEED, 5)
    expect(bodyKickSpeed('passe', false, 1)).toBeCloseTo(BODY_BALL_PASS_SPEED, 5)
  })
})

describe('touchBodyBall', () => {
  const bola = restingBall(centro)

  it('quem passa longe não toca em nada', () => {
    const longe = { x: centro.x + BODY_BALL_TOUCH_REACH + 2, y: centro.y, dx: 1, dy: 0 }
    expect(touchBodyBall(bola, longe)).toBeNull()
  })

  it('quem anda por cima conduz, na direção do passo', () => {
    const conduzindo = { x: centro.x - 8, y: centro.y, dx: 1, dy: 0 }
    const depois = touchBodyBall(bola, conduzindo)
    expect(depois?.vx).toBeCloseTo(dribbleSpeed(false), 5)
    expect(depois?.vy).toBeCloseTo(0, 5)
  })

  it('a condução acompanha a corrida', () => {
    const correndo = { x: centro.x - 8, y: centro.y, dx: 1, dy: 0, sprint: true }
    expect(touchBodyBall(bola, correndo)?.vx).toBeCloseTo(dribbleSpeed(true), 5)
  })

  it('quem está parado no caminho rebate — corpo é obstáculo', () => {
    const vindo = { ...centro, vx: -BODY_BALL_KICK_SPEED, vy: 0 }
    const parado = { x: centro.x - 10, y: centro.y, dx: 0, dy: 0 }
    const depois = touchBodyBall(vindo, parado)
    expect(depois).not.toBeNull()
    expect(depois!.vx).toBeGreaterThan(0)
    // Perde força na batida, e sai de dentro do corpo para não tremer no lugar.
    expect(Math.abs(depois!.vx)).toBeLessThan(BODY_BALL_KICK_SPEED)
    expect(depois!.x - parado.x).toBeGreaterThan(BODY_BALL_TOUCH_REACH)
  })

  it('bola forte demais não vira condução — ela rebate em quem tentou', () => {
    const foguete = { ...centro, vx: -BODY_BALL_SPRINT_KICK_SPEED, vy: 0 }
    const correndo = { x: centro.x - 10, y: centro.y, dx: -1, dy: 0, sprint: true }
    const depois = touchBodyBall(foguete, correndo)
    expect(depois!.vx).toBeGreaterThan(0)
  })

  it('bola que já está saindo não é puxada de volta', () => {
    const saindo = { ...centro, vx: BODY_BALL_KICK_SPEED, vy: 0 }
    const atras = { x: centro.x - 10, y: centro.y, dx: 0, dy: 0 }
    const depois = touchBodyBall(saindo, atras)
    expect(depois!.vx).toBeCloseTo(BODY_BALL_KICK_SPEED, 5)
  })
})

describe('chute alto (airborneMs)', () => {
  const grid = () => bodyCollisionGrid(createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 }))

  it('voa por cima da mobília', () => {
    const documento = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 })
    documento.objects.push({
      id: 'mesa',
      layerKey: 'collision',
      type: 'collision',
      geometry: { kind: 'rectangle', x: 128, y: 96, width: 32, height: 32 },
      properties: {},
    })
    const comMesa = bodyCollisionGrid(documento)

    let bola: BodyBallState = { x: 96, y: 112, vx: 400, vy: 0, airborneMs: 700 }
    for (let i = 0; i < 10; i += 1) bola = stepBodyBall(bola, 25, comMesa)

    // Passou do outro lado da mesa (x > 160), em vez de bater nela.
    expect(bola.x).toBeGreaterThan(160)
  })

  it('NÃO voa para fora do mapa', () => {
    // Voar por cima de uma mesa é a feature; voar para fora é perder a bola
    // para sempre — de lá ela não volta e ninguém a alcança.
    let bola: BodyBallState = { x: 96, y: 60, vx: 0, vy: -600, airborneMs: 900 }
    for (let i = 0; i < 20; i += 1) bola = stepBodyBall(bola, 25, grid())
    expect(bola.y).toBeGreaterThan(0)
  })

  it('bola que para no ar POUSA — o prazo não pode ficar pendurado', () => {
    // O decremento vive no laço de integração, e o atalho de "velocidade zero"
    // o pulava: a bola ficava atravessando parede para sempre.
    const parada: BodyBallState = { x: 96, y: 96, vx: 0, vy: 0, airborneMs: 300 }
    expect(stepBodyBall(parada, 25, grid()).airborneMs).toBeUndefined()
  })

  it('o prazo acaba e a bola volta a colidir', () => {
    const documento = createEmptyMapDocumentV1({ width: 10, height: 10, tileSize: 32 })
    documento.objects.push({
      id: 'parede',
      layerKey: 'collision',
      type: 'collision',
      geometry: { kind: 'rectangle', x: 224, y: 0, width: 32, height: 320 },
      properties: {},
    })
    const comParede = bodyCollisionGrid(documento)

    // Voo curto: acaba antes de chegar na parede, e aí ela bate.
    let bola: BodyBallState = { x: 96, y: 112, vx: 300, vy: 0, airborneMs: 50 }
    for (let i = 0; i < 20; i += 1) bola = stepBodyBall(bola, 25, comParede)

    expect(bola.airborneMs).toBeUndefined()
    expect(bola.x).toBeLessThan(224)
  })
})

describe('touchBodyBall e o raio da bola', () => {
  const grande: BodyBallState = { x: 200, y: 100, vx: 0, vy: 0, r: 32 }

  it('encostar é encostar na SUPERFÍCIE, não no centro', () => {
    // A bola de pilates tem um tile de raio. Medindo do centro, conduzir exigiria
    // estar DENTRO dela — o alcance de 17px é menor que o próprio raio.
    const tocou = touchBodyBall(grande, { x: 160, y: 100, dx: 1, dy: 0 })
    expect(tocou).not.toBeNull()
    expect(tocou!.vx).toBeGreaterThan(0)
  })

  it('preserva o raio ao conduzir e ao rebater', () => {
    // Sem isso a bola grande vira uma bola pequena no primeiro toque, e passa a
    // atravessar vãos por onde ela não cabe.
    expect(touchBodyBall(grande, { x: 160, y: 100, dx: 1, dy: 0 })!.r).toBe(32)
    const rebatida = touchBodyBall({ ...grande, vx: -300 }, { x: 160, y: 100, dx: 0, dy: 0 })
    expect(rebatida!.r).toBe(32)
  })

  it('longe da superfície continua sem tocar', () => {
    expect(touchBodyBall(grande, { x: 100, y: 100, dx: 1, dy: 0 })).toBeNull()
  })
})

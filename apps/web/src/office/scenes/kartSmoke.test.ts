import { describe, expect, it } from 'vitest'
import { BODY_KART_MAX_SPEED, BODY_KART_TURN_RATE, type BodyKartState } from '@legends/shared'
import { kartSmoke, remoteKartSteer, KART_SMOKE_MIN_SPEED, KART_SMOKE_REMOTE_TURN_RATE } from './kartSmoke'

const kart = (over: Partial<BodyKartState> = {}): BodyKartState => ({
  x: 100,
  y: 100,
  dir: 'right',
  heading: 0,
  speed: BODY_KART_MAX_SPEED,
  ...over,
})

describe('kartSmoke', () => {
  it('pneu parado não canta: abaixo da velocidade mínima não sai fumaça', () => {
    // O mínimo é a velocidade em que o esterço passa a morder por inteiro.
    // Abaixo dela o kart mal vira, e fumaça prometeria uma curva que não está
    // acontecendo.
    expect(kartSmoke(kart({ speed: KART_SMOKE_MIN_SPEED - 1 }), 1, false)).toBeNull()
  })

  it('reta a toda não fumaça — o que faz a roda escorregar é a CURVA', () => {
    expect(kartSmoke(kart(), 0, false)).toBeNull()
  })

  it('rápido e esterçando, fumaça', () => {
    expect(kartSmoke(kart(), 1, false)).not.toBeNull()
  })

  it('o freio de mão sozinho já basta — derrapar é o gesto que mais pede o efeito', () => {
    const comFreio = kartSmoke(kart(), 0, true)
    expect(comFreio).not.toBeNull()
    expect(comFreio!.intensity).toBeGreaterThan(kartSmoke(kart(), 1, false)!.intensity)
  })

  it('a intensidade cresce com a velocidade', () => {
    const devagar = kartSmoke(kart({ speed: KART_SMOKE_MIN_SPEED + 20 }), 1, false)!
    const rapido = kartSmoke(kart(), 1, false)!
    expect(rapido.intensity).toBeGreaterThan(devagar.intensity)
  })

  it('de ré também canta: o que conta é o módulo da velocidade', () => {
    expect(kartSmoke(kart({ speed: -BODY_KART_MAX_SPEED }), 1, false)).not.toBeNull()
  })

  it('as rodas ficam ATRÁS do centro e separadas uma da outra', () => {
    // Fumaça saindo do meio do veículo leria como fogo no motor, não como pneu.
    const fumaca = kartSmoke(kart({ heading: 0 }), 1, false)!
    const [esquerda, direita] = fumaca.wheels
    // Rumo 0 = para a direita, então "atrás" é x menor.
    expect(esquerda.x).toBeLessThan(100)
    expect(direita.x).toBeLessThan(100)
    expect(Math.abs(esquerda.y - direita.y)).toBeGreaterThan(0)
  })

  it('as rodas acompanham o RUMO, não a pose', () => {
    // Com o kart apontado para baixo, a separação das rodas passa a ser
    // horizontal — se ela fosse fixa, a fumaça sairia do lugar errado em
    // metade das curvas.
    const paraBaixo = kartSmoke(kart({ heading: Math.PI / 2 }), 1, false)!
    const [a, b] = paraBaixo.wheels
    expect(Math.abs(a.x - b.x)).toBeGreaterThan(Math.abs(a.y - b.y))
  })
})

describe('remoteKartSteer', () => {
  /** Um quadro a 60 Hz — a cadência em que a cena desenha os remotos. */
  const QUADRO_MS = 16

  it('rumo parado é esterço zero: quem anda reto não fumaça', () => {
    expect(remoteKartSteer(0, 0, QUADRO_MS)).toBe(0)
  })

  it('giro de esterço cheio conta como esterço, com o sinal do giro', () => {
    const cheio = (BODY_KART_TURN_RATE * QUADRO_MS) / 1000
    expect(remoteKartSteer(0, cheio, QUADRO_MS)).toBe(1)
    expect(remoteKartSteer(0, -cheio, QUADRO_MS)).toBe(-1)
  })

  it('tremor do rumo interpolado fica abaixo do limiar e não vira fumaça', () => {
    // Metade do limiar: giro pequeno demais para ser curva.
    const tremor = (KART_SMOKE_REMOTE_TURN_RATE * 0.5 * QUADRO_MS) / 1000
    expect(remoteKartSteer(0, tremor, QUADRO_MS)).toBe(0)
  })

  it('cruzar π mede o arco CURTO — sem isso, uma volta inteira num quadro', () => {
    // De quase +π para quase −π o kart girou ~0,02 rad PARA A FRENTE. A conta
    // ingênua (`headingNow - headingBefore`) daria −6,26: fumaça garantida, e
    // ainda por cima com o sinal invertido.
    expect(remoteKartSteer(Math.PI - 0.01, -Math.PI + 0.01, QUADRO_MS)).toBe(1)
    // E num intervalo longo os mesmos 0,02 rad são giro nenhum — a conta
    // ingênua continuaria vendo uma volta inteira e fumaçando.
    expect(remoteKartSteer(Math.PI - 0.01, -Math.PI + 0.01, 100)).toBe(0)
  })

  it('sem tempo decorrido não há taxa a medir', () => {
    expect(remoteKartSteer(0, 1, 0)).toBe(0)
  })
})

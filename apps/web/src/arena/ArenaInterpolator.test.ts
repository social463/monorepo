import { describe, expect, it } from 'vitest'
import { BODY_INTERP_MS, type ArenaSnapshotPlayer } from '@legends/shared'
import { ArenaInterpolator } from './ArenaInterpolator'

const player = (x: number, y = 0): ArenaSnapshotPlayer[] => [
  { userId: 'bruno', x, y, dir: 'right', seq: 1 },
]

describe('ArenaInterpolator', () => {
  it('sem amostra, não há onde desenhar', () => {
    expect(new ArenaInterpolator().at('bruno', 1000)).toBeNull()
  })

  // O ponto do buffer: desenhar entre dois snapshots já recebidos, e não no
  // último que chegou — é o que transforma 20 pacotes por segundo em
  // movimento contínuo.
  it('interpola entre dois snapshots, no meio do caminho', () => {
    const interp = new ArenaInterpolator()
    interp.push(player(0), 1000)
    interp.push(player(100), 1100)

    // Alvo = agora − BODY_INTERP_MS. Com "agora" em 1150, o alvo é 1050 —
    // exatamente o meio entre as duas amostras.
    const at = interp.at('bruno', 1050 + BODY_INTERP_MS)

    expect(at?.x).toBeCloseTo(50, 6)
  })

  it('enquanto o buffer enche, segura na amostra mais velha', () => {
    const interp = new ArenaInterpolator()
    interp.push(player(10), 1000)
    interp.push(player(20), 1100)

    expect(interp.at('bruno', 1000)?.x).toBe(10)
  })

  // Extrapolar inventa movimento e depois puxa o personagem de volta quando a
  // rede volta — pior que parar.
  it('rede parada segura na última posição, sem extrapolar', () => {
    const interp = new ArenaInterpolator()
    interp.push(player(0), 1000)
    interp.push(player(100), 1100)

    expect(interp.at('bruno', 5000)?.x).toBe(100)
  })

  it('snapshot fora de ordem é descartado, não faz o alvo voltar', () => {
    const interp = new ArenaInterpolator()
    interp.push(player(0), 1000)
    interp.push(player(100), 1100)
    interp.push(player(999), 1050)

    expect(interp.at('bruno', 1100 + BODY_INTERP_MS)?.x).toBe(100)
  })

  it('esquece quem saiu do snapshot', () => {
    const interp = new ArenaInterpolator()
    interp.push(player(0), 1000)
    interp.push([], 1100)

    expect(interp.at('bruno', 1200)).toBeNull()
  })

  it('a pose não interpola — é discreta', () => {
    const interp = new ArenaInterpolator()
    interp.push([{ userId: 'bruno', x: 0, y: 0, dir: 'left', seq: 1 }], 1000)
    interp.push([{ userId: 'bruno', x: 100, y: 0, dir: 'up', seq: 2 }], 1100)

    expect(interp.at('bruno', 1050 + BODY_INTERP_MS)?.dir).toBe('up')
  })
})

describe('rumo do kart', () => {
  const comRumo = (userId: string, x: number, h: number): ArenaSnapshotPlayer[] => [
    { userId, x, y: 0, dir: 'right', seq: 1, h },
  ]

  it('interpola o rumo junto da posição', () => {
    const interp = new ArenaInterpolator()
    interp.push(comRumo('ana', 0, 0), 0)
    interp.push(comRumo('ana', 100, 1), 100)

    // `BODY_INTERP_MS` atrás de 200 é 100 — a segunda amostra.
    const meio = interp.at('ana', 150)
    expect(meio?.heading).toBeCloseTo(0.5, 5)
  })

  it('gira pelo arco CURTO ao cruzar o zero', () => {
    // O bug clássico: entre 3,10 e −3,10 rad — dois rumos praticamente iguais —
    // a média linear daria ~0, e o kart faria uma pirueta de 355° na tela.
    const interp = new ArenaInterpolator()
    interp.push(comRumo('ana', 0, 3.10), 0)
    interp.push(comRumo('ana', 0, -3.10), 100)

    const meio = interp.at('ana', 150)
    expect(Math.abs(meio?.heading ?? 0)).toBeGreaterThan(3.1)
  })

  it('não inventa rumo fora da corrida', () => {
    const interp = new ArenaInterpolator()
    interp.push([{ userId: 'ana', x: 0, y: 0, dir: 'right', seq: 1 }], 0)
    interp.push([{ userId: 'ana', x: 100, y: 0, dir: 'right', seq: 2 }], 100)

    expect(interp.at('ana', 150)?.heading).toBeUndefined()
  })
})

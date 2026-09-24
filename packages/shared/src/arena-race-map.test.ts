import { describe, expect, it } from 'vitest'
import { raceMapAssets, raceMapDocument } from './arena-race-map'
import {
  ARENA_RACE_GRID_SLOTS,
  pointAt,
  RACE_MAP_HEIGHT,
  RACE_MAP_WIDTH,
  RACE_TILE,
  RACE_TRACK,
  RACE_TRACK_HALF_WIDTH,
} from './arena-race'
import { BODY_KART_BODY_HALF } from './body-kart'
import { bodyBoxBlocked, bodyCollisionGrid } from './body-collision'
import { mapSpawnTiles } from './office-map-runtime'
import { MapDocumentV1Schema } from './office-map'

const document = raceMapDocument()
const grid = bodyCollisionGrid(document)

/** O kart cabe com o centro aqui? A mesma pergunta que `stepBodyKart` faz. */
function cabe(x: number, y: number): boolean {
  return !bodyBoxBlocked(grid, x, y, BODY_KART_BODY_HALF, BODY_KART_BODY_HALF)
}

describe('documento da pista', () => {
  it('passa pelo schema', () => {
    expect(() => MapDocumentV1Schema.parse(document)).not.toThrow()
  })

  it('tem o tamanho declarado', () => {
    expect(document.map.width).toBe(RACE_MAP_WIDTH)
    expect(document.map.height).toBe(RACE_MAP_HEIGHT)
    expect(document.map.tileWidth).toBe(RACE_TILE)
  })

  it('declara os três tilesets que usa, e só eles', () => {
    const usados = new Set<string>()
    for (const layer of document.layers) {
      if (layer.type !== 'tile') continue
      for (const celula of layer.data) if (celula) usados.add(celula.split(':')[0])
    }
    const declarados = new Set(document.tilesets.map((tileset) => tileset.id))
    for (const id of usados) expect(declarados.has(id)).toBe(true)
    expect(raceMapAssets()).toHaveLength(3)
  })

  it('preenche o piso inteiro — nada de buraco no chão', () => {
    const floor = document.layers.find((layer) => layer.key === 'floor')
    if (floor?.type !== 'tile') throw new Error('camada de piso ausente')
    expect(floor.data.filter((celula) => celula === null)).toHaveLength(0)
  })

  it('é determinístico', () => {
    // A pista é gerada nos DOIS lados; entrada igual tem de dar mapa igual, ou
    // o cliente e o servidor discordariam sobre onde estão as barreiras.
    expect(JSON.stringify(raceMapDocument())).toBe(JSON.stringify(document))
  })

  it('funde a colisão em corridas em vez de um retângulo por tile', () => {
    const colisoes = document.objects.filter((object) => object.type === 'collision')
    // Sem a fusão seriam ~8.800 (tudo que não é asfalto). O teto aqui é folgado
    // de propósito: o que ele trava é a ORDEM DE GRANDEZA, não um número exato
    // que mudaria a cada ajuste nos pontos de controle.
    expect(colisoes.length).toBeLessThan(1_500)
    expect(colisoes.length).toBeGreaterThan(50)
  })
})

describe('a pista é dirigível', () => {
  it('deixa a linha de centro inteira livre', () => {
    // O teste que sustenta a corrida: se um pedaço da linha de centro estiver
    // bloqueado, a volta é impossível e o modo não funciona — e o sintoma seria
    // "o kart trava sempre no mesmo ponto", que é péssimo de achar depois.
    for (let s = 0; s < RACE_TRACK.length; s += 8) {
      const { point } = pointAt(RACE_TRACK, s)
      expect(cabe(point.x, point.y)).toBe(true)
    }
  })

  it('deixa a largura útil livre, não só o fio do meio', () => {
    // Ultrapassar exige pista ao lado da linha ideal. Metade da meia-largura é
    // o que se cobra: o resto é a margem que a rasterização em tile come.
    const lateral = RACE_TRACK_HALF_WIDTH / 2
    for (let s = 0; s < RACE_TRACK.length; s += 24) {
      const { point, heading } = pointAt(RACE_TRACK, s)
      for (const lado of [-1, 1]) {
        const x = point.x + Math.cos(heading + Math.PI / 2) * lateral * lado
        const y = point.y + Math.sin(heading + Math.PI / 2) * lateral * lado
        expect(cabe(x, y)).toBe(true)
      }
    }
  })

  it('fecha o miolo e o lado de fora', () => {
    // O antitrapaça geométrico: cortar caminho é impossível porque o miolo é
    // sólido. Se ele abrisse, a contagem de voltas por progresso cairia junto.
    const centro = { x: (RACE_MAP_WIDTH * RACE_TILE) / 2, y: (RACE_MAP_HEIGHT * RACE_TILE) / 2 }
    expect(cabe(centro.x, centro.y)).toBe(false)
    expect(cabe(RACE_TILE, RACE_TILE)).toBe(false)
  })
})

describe('grid de largada', () => {
  it('publica uma vaga por piloto, todas caminháveis', () => {
    const vagas = mapSpawnTiles(document)
    // `mapSpawnTiles` descarta spawn em tile não caminhável. Perder vagas aqui
    // significaria pilotos nascendo empilhados na mesma.
    expect(vagas).toHaveLength(ARENA_RACE_GRID_SLOTS)
  })

  it('cabe um kart em cada vaga', () => {
    for (const vaga of RACE_TRACK.grid) {
      expect(cabe(vaga.x, vaga.y)).toBe(true)
    }
  })

  it('não põe dois karts em cima um do outro', () => {
    for (const [i, a] of RACE_TRACK.grid.entries()) {
      for (const b of RACE_TRACK.grid.slice(i + 1)) {
        expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(BODY_KART_BODY_HALF * 2)
      }
    }
  })
})

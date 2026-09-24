import { describe, expect, it } from 'vitest'
import {
  BODY_HALF_HEIGHT,
  BODY_HALF_WIDTH,
  SOCCER_FIELD,
  SOCCER_MAP_HEIGHT,
  SOCCER_MAP_WIDTH,
  bodyBoxBlocked,
  bodyCollisionGrid,
  arenaAssetsFor,
  arenaDocumentFor,
  mapSpawnTiles,
  soccerGoalScored,
  soccerKickoffSpot,
  soccerMapAssets,
  soccerMapDocument,
} from './index'

const doc = soccerMapDocument()
const grid = bodyCollisionGrid(doc)
const TILE = doc.map.tileWidth

const livre = (x: number, y: number) =>
  !bodyBoxBlocked(grid, x, y, BODY_HALF_WIDTH, BODY_HALF_HEIGHT)

describe('soccerMapDocument', () => {
  it('tem o tamanho declarado e sai igual toda vez', () => {
    expect(doc.map.width).toBe(SOCCER_MAP_WIDTH)
    expect(doc.map.height).toBe(SOCCER_MAP_HEIGHT)
    // Servidor e cliente geram o SEU campo chamando esta função; se ela
    // variasse, cada lado colidiria em lugares diferentes.
    expect(JSON.stringify(soccerMapDocument())).toBe(JSON.stringify(doc))
  })

  it('declara todos os tilesets que referencia', () => {
    const declarados = new Set(doc.tilesets.map((t) => t.id))
    for (const layer of doc.layers) {
      if (layer.type !== 'tile') continue
      for (const ref of layer.data) {
        if (ref) expect(declarados).toContain(ref.slice(0, ref.lastIndexOf(':')))
      }
    }
    for (const object of doc.objects) {
      if (object.type === 'tile-object') expect(declarados).toContain(object.properties.tilesetId)
    }
  })

  it('os assets cobrem os tilesets do documento', () => {
    const urls = new Set(soccerMapAssets().map((a) => a.id))
    for (const tileset of doc.tilesets) expect(urls).toContain(tileset.assetId)
  })

  it('é espelhado no eixo vertical — campo torto é sorteio', () => {
    const solidos = new Set<string>()
    for (let y = 0; y < SOCCER_MAP_HEIGHT; y += 1) {
      for (let x = 0; x < SOCCER_MAP_WIDTH; x += 1) {
        if (!livre(x * TILE + TILE / 2, y * TILE + TILE / 2)) solidos.add(`${x},${y}`)
      }
    }
    for (const chave of solidos) {
      const [x, y] = chave.split(',').map(Number)
      expect(solidos).toContain(`${SOCCER_MAP_WIDTH - 1 - x},${y}`)
    }
  })

  it('a borda é fechada — a bola nunca sai de campo', () => {
    for (let x = 0; x < SOCCER_MAP_WIDTH; x += 1) {
      expect(livre(x * TILE + TILE / 2, TILE / 2)).toBe(false)
      expect(livre(x * TILE + TILE / 2, (SOCCER_MAP_HEIGHT - 1) * TILE + TILE / 2)).toBe(false)
    }
    for (let y = 0; y < SOCCER_MAP_HEIGHT; y += 1) {
      expect(livre(TILE / 2, y * TILE + TILE / 2)).toBe(false)
      expect(livre((SOCCER_MAP_WIDTH - 1) * TILE + TILE / 2, y * TILE + TILE / 2)).toBe(false)
    }
  })

  // O gol é uma LINHA, não uma caixa: rede sólida daria bola presa na rede
  // como estado do jogo, e goleiro que não pode entrar no próprio gol.
  it('o gol é atravessável, e o gramado entre as áreas é limpo', () => {
    for (const goal of Object.values(SOCCER_FIELD.goals)) {
      const dentro = goal.line + goal.inside * TILE
      expect(livre(dentro, (goal.top + goal.bottom) / 2)).toBe(true)
    }
    // Nada de cobertura: aqui esconder é o oposto do jogo.
    let bloqueado = 0
    for (let y = 3; y < SOCCER_MAP_HEIGHT - 3; y += 1) {
      for (let x = 3; x < SOCCER_MAP_WIDTH - 3; x += 1) {
        if (!livre(x * TILE + TILE / 2, y * TILE + TILE / 2)) bloqueado += 1
      }
    }
    expect(bloqueado).toBe(0)
  })

  /**
   * A barra laranja listrada da arte É a trave; a malha branca é a rede atrás
   * dela. Trocar as duas peças (elas são espelhadas) põe cada gol de costas
   * para o jogo, e nada quebra — o campo continua válido, a bola continua
   * entrando. Só se vê olhando. Daí o teste pinar a coluna do sheet.
   */
  it('a trave de cada gol olha para o campo', () => {
    const escola = doc.tilesets.find((t) => t.assetId.endsWith('school-32'))!
    const colunaDe = (team: 'oeste' | 'leste') => {
      const goal = SOCCER_FIELD.goals[team]
      const canto = doc.objects.find(
        (o) =>
          o.type === 'tile-object' &&
          o.geometry.kind === 'rectangle' &&
          o.geometry.x === goal.netTileX * TILE &&
          o.geometry.y === goal.netTileY * TILE,
      )
      if (canto?.type !== 'tile-object') throw new Error(`gol ${team} sem peça`)
      return canto.properties.tileIndex % escola.columns
    }
    // `rede-de-gol-lateral` (trave à direita) no oeste; `rede-de-gol-canto`
    // (trave à esquerda) no leste.
    expect(colunaDe('oeste')).toBe(15)
    expect(colunaDe('leste')).toBe(26)
  })

  it('tem duas bases, uma em cada campo, em chão livre', () => {
    const spawns = mapSpawnTiles(doc)
    expect(spawns).toHaveLength(2)
    const [oeste, leste] = [...spawns].sort((a, b) => a.x - b.x)
    expect(oeste.x).toBeLessThan(SOCCER_MAP_WIDTH / 2)
    expect(leste.x).toBeGreaterThan(SOCCER_MAP_WIDTH / 2)
    for (const tile of spawns) {
      expect(livre(tile.x * TILE + TILE / 2, tile.y * TILE + TILE / 2)).toBe(true)
    }
  })

  it('o modo escolhe o cenário, e o campo é reaproveitado', () => {
    expect(arenaDocumentFor('futebol').map.width).toBe(SOCCER_MAP_WIDTH)
    // Memoizado: o hub chama a cada conexão, e a grade de colisão é
    // memoizada pela identidade de `objects` — documento novo rasterizaria
    // tudo de novo.
    expect(arenaDocumentFor('futebol')).toBe(arenaDocumentFor('futebol'))
    expect(arenaDocumentFor('mata-mata').map.width).not.toBe(SOCCER_MAP_WIDTH)
    // Mata-mata e bandeira são o MESMO cenário: trocar entre eles não pode
    // remontar a cena de quem só mudou de regra.
    expect(arenaDocumentFor('bandeira')).toBe(arenaDocumentFor('mata-mata'))
    expect(arenaAssetsFor('bandeira')).toBe(arenaAssetsFor('mata-mata'))
    expect(arenaAssetsFor('futebol')).not.toBe(arenaAssetsFor('mata-mata'))
  })
})

describe('soccerGoalScored', () => {
  const centro = soccerKickoffSpot()

  it('bola no meio do campo não é gol', () => {
    expect(soccerGoalScored(centro)).toBeNull()
  })

  it('cruzar a boca do gol pontua para o OUTRO time', () => {
    const oeste = SOCCER_FIELD.goals.oeste
    const leste = SOCCER_FIELD.goals.leste
    const meio = (oeste.top + oeste.bottom) / 2
    expect(soccerGoalScored({ x: oeste.line - 1, y: meio })).toBe('leste')
    expect(soccerGoalScored({ x: leste.line + 1, y: meio })).toBe('oeste')
  })

  it('na altura da trave, mas fora dela, não é gol', () => {
    const goal = SOCCER_FIELD.goals.oeste
    expect(soccerGoalScored({ x: goal.line - 1, y: goal.top - 1 })).toBeNull()
    expect(soccerGoalScored({ x: goal.line - 1, y: goal.bottom + 1 })).toBeNull()
    // Um pixel antes da linha ainda é bola em jogo.
    expect(soccerGoalScored({ x: goal.line + 1, y: (goal.top + goal.bottom) / 2 })).toBeNull()
  })

  it('os dois gols são espelhados — nenhum lado tem gol maior', () => {
    const { oeste, leste } = SOCCER_FIELD.goals
    expect(oeste.bottom - oeste.top).toBe(leste.bottom - leste.top)
    expect(oeste.top).toBe(leste.top)
    expect(SOCCER_MAP_WIDTH * TILE - leste.line).toBe(oeste.line)
  })
})

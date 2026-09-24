import { builtinAssetToDTO } from './office-tileset-catalog'
import { createEmptyMapDocumentV1, MapDocumentV1Schema } from './office-map'
import { tileSize, tilesetEntry } from './arena-map-tools'
import {
  SOCCER_FIELD,
  SOCCER_GOAL_COLS,
  SOCCER_GOAL_ROWS,
  SOCCER_MAP_HEIGHT,
  SOCCER_MAP_WIDTH,
  SOCCER_TILE,
  SOCCER_WALL_TILES,
} from './arena-soccer'
import type { MapDocumentV1, MapObjectV1, OfficeMapAssetDTO } from './index'

/**
 * O campo de futebol — um `MapDocumentV1` gerado em código, ao lado do campo
 * de batalha e pelos mesmos motivos: determinístico, gerado nos dois lados,
 * nada de mapa trafegando no fio nem guardado no banco.
 *
 * O que ele NÃO tem é o que mais o distingue: cobertura. O campo de batalha
 * existe para esconder gente; aqui, esconder é o oposto do jogo. Por isso o
 * documento é quase só gramado — e por isso ele é gerado em vinte linhas,
 * enquanto o outro precisa de aglomerados sorteados por setor.
 *
 * As LINHAS do campo (meio, círculo central, grandes áreas) e a listra do
 * gramado não estão aqui: são desenhadas pela cena como forma. Nenhum tileset
 * do acervo tem marcação de campo, e pintá-la em tile quadrado daria borda
 * dura — o mesmo motivo por que o campo de batalha desistiu das manchas de
 * grama.
 */

const TERRAIN = 'builtin:office/terrains-and-fences-32'
const CITY = 'builtin:office/city-terrains-32'
const SCHOOL = 'builtin:office/school-32'

/** Grama chapada: opaca e de variância de cor zero, medida no sheet. */
const GROUND_GRASS = 241
/** O mesmo concreto do muro do campo de batalha. */
const WALL_CONCRETE = 5

/**
 * As duas redes do acervo escolar, que são a MESMA peça espelhada.
 *
 * **A barra laranja listrada é a TRAVE**, não o fundo — é a mesma pintura da
 * trave frontal do acervo (`school/trave-de-futebol`), e a malha branca é a
 * rede ATRÁS dela. Então a peça com a trave à direita é o gol do OESTE (trave
 * olhando para o campo, rede correndo para o muro), e a de trave à esquerda é
 * a do leste. Trocar as duas põe cada gol de costas para o jogo — e o
 * `soccerGoalScored` mede a linha na borda da peça que dá para o campo, que é
 * justamente onde a trave tem de estar.
 *
 * A rede é desenho, e não colisão: o gol é uma LINHA. Rede sólida daria bola
 * presa na rede como estado do jogo.
 */
const NETS = {
  /** `rede-de-gol-lateral`: trave na direita, rede para a esquerda. */
  oeste: { col: 15, row: 111 },
  /** `rede-de-gol-canto`: trave na esquerda, rede para a direita. */
  leste: { col: 26, row: 111 },
} as const

/** Documento do campo. Mesma entrada, mesmo campo, sempre. */
export function soccerMapDocument(): MapDocumentV1 {
  const T = SOCCER_TILE
  const document = createEmptyMapDocumentV1({
    width: SOCCER_MAP_WIDTH,
    height: SOCCER_MAP_HEIGHT,
    tileSize: T,
    backgroundColor: '#16301f',
  })

  // O `id` do tileset é LOCAL ao documento; o `builtin:office/...` vai em
  // `assetId` (ver o mesmo cuidado em `arenaMapDocument`).
  const localId = new Map<string, string>()
  document.tilesets = [TERRAIN, CITY, SCHOOL].map((assetId) => {
    const entry = tilesetEntry(assetId)
    const id = `campo-${assetId.split('/').pop()}`
    localId.set(assetId, id)
    return {
      id,
      assetId: entry.assetId,
      name: entry.name,
      tileWidth: tileSize(entry.tileWidth, assetId),
      tileHeight: tileSize(entry.tileHeight, assetId),
      columns: entry.columns,
      tileCount: entry.tileCount,
    }
  })
  const refTileset = (assetId: string) => {
    const id = localId.get(assetId)
    if (!id) throw new Error(`tileset ${assetId} não foi declarado no documento`)
    return id
  }

  const floor = document.layers.find((layer) => layer.key === 'floor')
  const walls = document.layers.find((layer) => layer.key === 'walls')
  if (floor?.type !== 'tile' || walls?.type !== 'tile') throw new Error('camadas base ausentes')

  const at = (x: number, y: number) => y * SOCCER_MAP_WIDTH + x
  const objects: MapObjectV1[] = []
  let sequencial = 0

  const solido = (x: number, y: number, w: number, h: number) => {
    sequencial += 1
    objects.push({
      id: `campo-col-${sequencial}`,
      layerKey: 'collision',
      type: 'collision',
      geometry: { kind: 'rectangle', x: x * T, y: y * T, width: w * T, height: h * T },
      properties: {},
    })
  }

  // ── gramado ─────────────────────────────────────────────────────────────
  for (let y = 0; y < SOCCER_MAP_HEIGHT; y += 1) {
    for (let x = 0; x < SOCCER_MAP_WIDTH; x += 1) {
      floor.data[at(x, y)] = `${refTileset(TERRAIN)}:${GROUND_GRASS}`
    }
  }

  // ── muro perimetral, sem nenhum vão ─────────────────────────────────────
  // A bola nunca sai: bate e volta. Não há lateral, escanteio nem tiro de
  // meta — regra de bola fora exige reposição, e reposição é tempo parado.
  const W = SOCCER_WALL_TILES
  for (let x = 0; x < SOCCER_MAP_WIDTH; x += 1) {
    for (let i = 0; i < W; i += 1) {
      walls.data[at(x, i)] = `${refTileset(CITY)}:${WALL_CONCRETE}`
      walls.data[at(x, SOCCER_MAP_HEIGHT - 1 - i)] = `${refTileset(CITY)}:${WALL_CONCRETE}`
    }
  }
  for (let y = 0; y < SOCCER_MAP_HEIGHT; y += 1) {
    for (let i = 0; i < W; i += 1) {
      walls.data[at(i, y)] = `${refTileset(CITY)}:${WALL_CONCRETE}`
      walls.data[at(SOCCER_MAP_WIDTH - 1 - i, y)] = `${refTileset(CITY)}:${WALL_CONCRETE}`
    }
  }
  solido(0, 0, SOCCER_MAP_WIDTH, W)
  solido(0, SOCCER_MAP_HEIGHT - W, SOCCER_MAP_WIDTH, W)
  solido(0, 0, W, SOCCER_MAP_HEIGHT)
  solido(SOCCER_MAP_WIDTH - W, 0, W, SOCCER_MAP_HEIGHT)

  // ── as duas redes ───────────────────────────────────────────────────────
  const escola = tilesetEntry(SCHOOL)
  for (const [team, sheet] of Object.entries(NETS)) {
    const goal = SOCCER_FIELD.goals[team as keyof typeof NETS]
    for (let dy = 0; dy < SOCCER_GOAL_ROWS; dy += 1) {
      for (let dx = 0; dx < SOCCER_GOAL_COLS; dx += 1) {
        sequencial += 1
        objects.push({
          id: `campo-gol-${team}-${sequencial}`,
          layerKey: 'objects',
          type: 'tile-object',
          geometry: {
            kind: 'rectangle',
            x: (goal.netTileX + dx) * T,
            y: (goal.netTileY + dy) * T,
            width: T,
            height: T,
          },
          properties: {
            tilesetId: refTileset(SCHOOL),
            tileIndex: (sheet.row + dy) * escola.columns + (sheet.col + dx),
          },
        })
      }
    }
  }

  // ── nascimentos ─────────────────────────────────────────────────────────
  // Um por time, no meio do próprio campo: quem volta de um gol cai atrás da
  // linha do meio, como numa saída de bola.
  document.objects = objects
  for (const [indice, team] of (['oeste', 'leste'] as const).entries()) {
    const base = SOCCER_FIELD.bases[team]
    document.objects.push({
      id: `campo-spawn-${team}`,
      layerKey: 'spawn-points',
      type: 'spawn-point',
      geometry: { kind: 'point', x: base.x * T + T / 2, y: base.y * T + T / 2 },
      properties: { name: `Campo ${team}`, isDefault: indice === 0 },
    })
  }

  // Documento montado à mão erra calado — um `layerKey` inexistente ou uma
  // geometria fora de forma só apareceria como campo faltando pedaço.
  return MapDocumentV1Schema.parse(document)
}

/** Os sheets que o campo usa, derivados do catálogo (nada vem da API). */
export function soccerMapAssets(): OfficeMapAssetDTO[] {
  return [TERRAIN, CITY, SCHOOL].map((assetId) => builtinAssetToDTO(tilesetEntry(assetId)))
}

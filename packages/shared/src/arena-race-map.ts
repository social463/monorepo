import { builtinAssetToDTO } from './office-tileset-catalog'
import { createEmptyMapDocumentV1, MapDocumentV1Schema } from './office-map'
import { tileSize, tilesetEntry } from './arena-map-tools'
import {
  RACE_BARRIER_TILES,
  RACE_MAP_HEIGHT,
  RACE_MAP_WIDTH,
  RACE_TILE,
  RACE_TRACK,
  RACE_TRACK_HALF_WIDTH,
  RACE_WALL_TILES,
} from './arena-race'
import type { MapDocumentV1, MapObjectV1, OfficeMapAssetDTO } from './index'

/**
 * A pista de kart — um `MapDocumentV1` gerado em código, ao lado do campo de
 * batalha e do campo de futebol, e pelos mesmos motivos: determinístico, gerado
 * nos dois lados, nada de mapa trafegando no fio nem guardado no banco.
 *
 * O que ele tem de próprio é que **nada aqui é desenhado à mão**: asfalto,
 * barreira e colisão saem todos da linha de centro de `arena-race.ts`, por
 * distância. É o que garante que a barreira que o piloto vê e a parede em que
 * ele bate sejam a mesma coisa — e que mexer num ponto de controle não deixe o
 * mapa e as regras discordando.
 *
 * A linha de chegada e as zebras NÃO estão aqui: são desenhadas pela cena como
 * forma, pelo mesmo motivo das linhas do campo de futebol — nenhum tileset do
 * acervo tem marcação de pista, e pintá-la em tile quadrado daria borda dura
 * numa curva.
 */

const TERRAIN = 'builtin:office/terrains-and-fences-32'
const CITY = 'builtin:office/city-terrains-32'
const WORKSITE = 'builtin:office/worksite-32'

/** Grama chapada: opaca e de variância de cor zero, medida no sheet. */
const GROUND_GRASS = 241
/**
 * Asfalto: o tile mais liso do acervo urbano (83,79,82 com desvio 1), medido no
 * sheet como a grama do futebol. Liso importa aqui mais que em qualquer outro
 * cenário: a pista é a maior superfície contínua do produto, e textura com
 * variância vira ruído a 560 px/s.
 */
const GROUND_ASPHALT = 295
/** O mesmo concreto do muro dos outros cenários. */
const WALL_CONCRETE = 5
/**
 * Pneu visto de cima (`worksite/pilha-de-pneus`, a metade de baixo da peça).
 *
 * Laranja e preto contra o cinza do asfalto e o verde da grama: a barreira
 * precisa ser lida de relance a 560 px/s, e o concreto — que é o muro dos outros
 * mapas — some contra o asfalto justamente por ser do mesmo cinza.
 */
const BARRIER_TIRE = 287

/** Índice de tile a partir de coluna/linha do sheet. */
function at(x: number, y: number): number {
  return y * RACE_MAP_WIDTH + x
}

/**
 * Marca no conjunto todo tile a menos de `raio` de qualquer amostra da linha de
 * centro.
 *
 * Por amostra, e não por tile: varrer os 9.801 tiles medindo a distância até as
 * 600 amostras seria 5,9 milhões de contas. Carimbar o disco de cada amostra
 * toca ~50 tiles e o total fica em 30 mil — e o resultado é o mesmo conjunto,
 * porque "perto da linha" é exatamente a união dos discos.
 */
function stampTrack(raio: number): Set<number> {
  const marcados = new Set<number>()
  const raioTiles = Math.ceil(raio / RACE_TILE)
  for (const amostra of RACE_TRACK.samples) {
    const tx = Math.floor(amostra.x / RACE_TILE)
    const ty = Math.floor(amostra.y / RACE_TILE)
    for (let dy = -raioTiles; dy <= raioTiles; dy += 1) {
      for (let dx = -raioTiles; dx <= raioTiles; dx += 1) {
        const x = tx + dx
        const y = ty + dy
        if (x < 0 || y < 0 || x >= RACE_MAP_WIDTH || y >= RACE_MAP_HEIGHT) continue
        // Centro do tile: a mesma amostra que a grade do escritório usa para
        // decidir se um tile é caminhável.
        const cx = x * RACE_TILE + RACE_TILE / 2
        const cy = y * RACE_TILE + RACE_TILE / 2
        if (Math.hypot(cx - amostra.x, cy - amostra.y) <= raio) marcados.add(at(x, y))
      }
    }
  }
  return marcados
}

/** Documento da pista. Mesma entrada, mesma pista, sempre. */
export function raceMapDocument(): MapDocumentV1 {
  const T = RACE_TILE
  const document = createEmptyMapDocumentV1({
    width: RACE_MAP_WIDTH,
    height: RACE_MAP_HEIGHT,
    tileSize: T,
    backgroundColor: '#10231a',
  })

  // O `id` do tileset é LOCAL ao documento; o `builtin:office/...` vai em
  // `assetId` (mesmo cuidado do campo de batalha e do campo de futebol).
  const localId = new Map<string, string>()
  document.tilesets = [TERRAIN, CITY, WORKSITE].map((assetId) => {
    const entry = tilesetEntry(assetId)
    const id = `pista-${assetId.split('/').pop()}`
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

  const asfalto = stampTrack(RACE_TRACK_HALF_WIDTH)
  // A barreira é a CASCA: tudo dentro do raio maior que não é asfalto. Derivar
  // assim (em vez de procurar vizinhos de asfalto) dá espessura uniforme mesmo
  // na curva, onde a vizinhança de um tile diagonal é mais fina.
  const comBarreira = stampTrack(RACE_TRACK_HALF_WIDTH + RACE_BARRIER_TILES * T)

  // ── piso: grama em tudo, asfalto na pista ───────────────────────────────
  for (let y = 0; y < RACE_MAP_HEIGHT; y += 1) {
    for (let x = 0; x < RACE_MAP_WIDTH; x += 1) {
      const indice = at(x, y)
      floor.data[indice] = asfalto.has(indice)
        ? `${refTileset(CITY)}:${GROUND_ASPHALT}`
        : `${refTileset(TERRAIN)}:${GROUND_GRASS}`
    }
  }

  // ── barreira de pneu dos dois lados da pista ────────────────────────────
  for (const indice of comBarreira) {
    if (asfalto.has(indice)) continue
    walls.data[indice] = `${refTileset(WORKSITE)}:${BARRIER_TIRE}`
  }

  // ── muro perimetral ─────────────────────────────────────────────────────
  // Sem nenhum vão, como no campo de futebol. A pista já não encosta nele (o
  // teste da geometria garante a folga); ele existe para o caso de alguém sair
  // voando numa batida e para fechar o horizonte.
  const W = RACE_WALL_TILES
  for (let x = 0; x < RACE_MAP_WIDTH; x += 1) {
    for (let i = 0; i < W; i += 1) {
      walls.data[at(x, i)] = `${refTileset(CITY)}:${WALL_CONCRETE}`
      walls.data[at(x, RACE_MAP_HEIGHT - 1 - i)] = `${refTileset(CITY)}:${WALL_CONCRETE}`
    }
  }
  for (let y = 0; y < RACE_MAP_HEIGHT; y += 1) {
    for (let i = 0; i < W; i += 1) {
      walls.data[at(i, y)] = `${refTileset(CITY)}:${WALL_CONCRETE}`
      walls.data[at(RACE_MAP_WIDTH - 1 - i, y)] = `${refTileset(CITY)}:${WALL_CONCRETE}`
    }
  }

  // ── colisão: tudo que não é asfalto ─────────────────────────────────────
  //
  // Fundida em CORRIDAS horizontais. Um retângulo por tile daria ~8.800
  // objetos, e `bodyCollisionGrid` varre a caixa envolvente de cada um — além
  // de `pointInMapObject` por célula. Por corrida são algumas centenas, e o
  // resultado rasterizado é idêntico: a união é a mesma.
  const objects: MapObjectV1[] = []
  let sequencial = 0
  for (let y = 0; y < RACE_MAP_HEIGHT; y += 1) {
    let inicio = -1
    for (let x = 0; x <= RACE_MAP_WIDTH; x += 1) {
      const solido = x < RACE_MAP_WIDTH && !asfalto.has(at(x, y))
      if (solido && inicio === -1) inicio = x
      if (!solido && inicio !== -1) {
        sequencial += 1
        objects.push({
          id: `pista-col-${sequencial}`,
          layerKey: 'collision',
          type: 'collision',
          geometry: {
            kind: 'rectangle',
            x: inicio * T,
            y: y * T,
            width: (x - inicio) * T,
            height: T,
          },
          properties: {},
        })
        inicio = -1
      }
    }
  }

  // ── grid de largada ─────────────────────────────────────────────────────
  // Um ponto por vaga, na ordem da pole para trás. O RUMO de cada vaga não cabe
  // num `spawn-point` (o schema só tem ponto), e por isso quem larga lê
  // `RACE_TRACK.grid` direto — o documento guarda só a posição, para o mapa ser
  // um documento válido e legível pelas ferramentas de sempre.
  document.objects = objects
  for (const [indice, vaga] of RACE_TRACK.grid.entries()) {
    document.objects.push({
      id: `pista-grid-${indice}`,
      layerKey: 'spawn-points',
      type: 'spawn-point',
      // Arredondado porque o schema do documento só aceita geometria inteira, e
      // a vaga sai de uma spline. Não perde nada: quem larga lê o ponto exato
      // (e o rumo) de `RACE_TRACK.grid`; isto aqui é a posição para as
      // ferramentas de mapa, que trabalham em tile.
      geometry: { kind: 'point', x: Math.round(vaga.x), y: Math.round(vaga.y) },
      properties: { name: `Vaga ${indice + 1}`, isDefault: indice === 0 },
    })
  }

  // Documento montado à mão erra calado — um `layerKey` inexistente ou uma
  // geometria fora de forma só apareceria como pista faltando pedaço.
  return MapDocumentV1Schema.parse(document)
}

/** Os sheets que a pista usa, derivados do catálogo (nada vem da API). */
export function raceMapAssets(): OfficeMapAssetDTO[] {
  return [TERRAIN, CITY, WORKSITE].map((assetId) => builtinAssetToDTO(tilesetEntry(assetId)))
}

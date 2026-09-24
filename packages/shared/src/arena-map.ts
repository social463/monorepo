import { builtinAssetToDTO } from './office-tileset-catalog'
import { tileSize, tilesetEntry } from './arena-map-tools'
import { createEmptyMapDocumentV1, MapDocumentV1Schema } from './office-map'
import { officeHash } from './office'
import type { MapDocumentV1, MapObjectV1, OfficeMapAssetDTO } from './index'

/**
 * O campo de batalha da arena — um `MapDocumentV1` gerado em código.
 *
 * Não é o mapa do escritório. O escritório é desenhado para conversa: corredores
 * de um tile, salas fechadas, mobília encostada na parede. Isso é péssimo para
 * jogo — porta de um tile vira gargalo, sala fechada vira armadilha, e não há
 * cobertura no meio do salão. E a arena não pode depender de um admin desenhar
 * mapa antes de existir jogo.
 *
 * Gerado, e não desenhado no editor, por dois motivos: nasce com o produto (não
 * é conteúdo que alguém precisa criar antes), e é **espelhado** — o que
 * importa quando entrarem times. Mapa assimétrico dá vantagem de lado, e
 * descobrir isso depois de o modo pronto é caro.
 */

/** Lado do tile. O mesmo do escritório, para os sprites servirem sem escala. */
const TILE = 32

/** Dimensões em tiles. Ímpar na largura para haver uma coluna central exata. */
export const ARENA_MAP_WIDTH = 121
export const ARENA_MAP_HEIGHT = 85

/**
 * Lado do setor em que o campo é dividido para distribuir cobertura.
 *
 * A cobertura não é mais uma lista de coordenadas à mão: com o campo grande,
 * uma lista cravada ou deixa buracos enormes ou vira um inventário
 * impossível de reequilibrar. Aqui cada setor sorteia — por hash, não por
 * aleatório — um tipo de aglomerado, e a metade esquerda é refletida.
 */
const SECTOR = 9

/** Setores colados nas bases ficam limpos: ninguém nasce cercado. */
const SPAWN_CLEAR_TILES = 7

/** Tiles de chão, escolhidos por medida: opacos e de variância de cor ~zero. */
const TERRAIN = 'builtin:office/terrains-and-fences-32'
const CITY = 'builtin:office/city-terrains-32'
const GROUND_DIRT = 260
const WALL_CONCRETE = 5

/** Um prop do catálogo de mobília, com onde ele fica no sheet. */
interface Prop {
  tileset: string
  col: number
  row: number
  cols: number
  rows: number
  /** Peça de cobertura bloqueia; poça e detrito, não. */
  solid: boolean
}

/**
 * A paleta do campo de batalha. Tudo já existe no acervo — nada de arte nova:
 * entulho de obra, montes de terra, pedra, toco e caixote militar leem como
 * campo de batalha improvisado, que é o que um paintball de escritório é.
 */
const PROPS: Record<string, Prop> = {
  monteGrande: { tileset: 'builtin:office/worksite-32', col: 12, row: 7, cols: 1, rows: 1, solid: true },
  montePequeno: { tileset: 'builtin:office/worksite-32', col: 11, row: 7, cols: 1, rows: 1, solid: true },
  cacamba: { tileset: 'builtin:office/worksite-32', col: 7, row: 0, cols: 1, rows: 1, solid: true },
  pedra: { tileset: 'builtin:office/camping-32', col: 1, row: 43, cols: 1, rows: 1, solid: true },
  toco: { tileset: 'builtin:office/camping-32', col: 30, row: 60, cols: 1, rows: 1, solid: true },
  caixote: { tileset: 'builtin:office/military-base-32', col: 26, row: 142, cols: 3, rows: 2, solid: true },
  lama: { tileset: 'builtin:office/worksite-32', col: 13, row: 5, cols: 1, rows: 1, solid: false },
  // Segmentos de corrimão do cercado militar. São eles que cortam LINHA DE
  // TIRO: cobertura de um tile protege quem está atrás dela, mas não impede
  // ver o campo inteiro — e num mapa aberto ganha sempre quem atira primeiro.
  cercaH: { tileset: 'builtin:office/military-base-32', col: 28, row: 11, cols: 1, rows: 1, solid: true },
  cercaV: { tileset: 'builtin:office/military-base-32', col: 26, row: 13, cols: 1, rows: 1, solid: true },

  // Peças grandes. Elas é que dão IMERSÃO: um campo só de pedrinha e monte de
  // terra lê como terreno baldio — carro abandonado, gerador e vegetação leem
  // como um lugar que existia antes da partida.
  carroAzul: { tileset: 'builtin:office/vehicles-32', col: 4, row: 0, cols: 2, rows: 4, solid: true },
  carroVermelho: { tileset: 'builtin:office/vehicles-32', col: 16, row: 0, cols: 2, rows: 4, solid: true },
  carroClaro: { tileset: 'builtin:office/vehicles-32', col: 10, row: 0, cols: 2, rows: 4, solid: true },
  gerador: { tileset: 'builtin:office/worksite-32', col: 11, row: 1, cols: 3, rows: 4, solid: true },
  torreLuz: { tileset: 'builtin:office/worksite-32', col: 4, row: 1, cols: 4, rows: 4, solid: true },
  pneus: { tileset: 'builtin:office/worksite-32', col: 31, row: 7, cols: 1, rows: 2, solid: true },
  caixaMedica: { tileset: 'builtin:office/military-base-32', col: 29, row: 142, cols: 3, rows: 2, solid: true },
  banco: { tileset: 'builtin:office/city-props-32', col: 21, row: 0, cols: 2, rows: 2, solid: true },
  arbusto: { tileset: 'builtin:office/graveyard-32', col: 18, row: 0, cols: 2, rows: 2, solid: true },
  arbustao: { tileset: 'builtin:office/graveyard-32', col: 13, row: 0, cols: 3, rows: 3, solid: true },
  arvore: { tileset: 'builtin:office/camping-32', col: 22, row: 60, cols: 2, rows: 2, solid: true },
  // Só enfeite de chão — não bloqueia.
  poca: { tileset: 'builtin:office/worksite-32', col: 11, row: 5, cols: 2, rows: 1, solid: false },
}

/**
 * Documento do campo de batalha.
 *
 * Determinístico: mesma entrada, mesmo mapa, sempre. O servidor e o cliente
 * geram o SEU documento chamando esta função — não há mapa trafegando no fio
 * nem guardado no banco, e é o mesmo desenho dos dois lados porque é o mesmo
 * código. Um mapa aleatório por partida quebraria isso.
 */
export function arenaMapDocument(): MapDocumentV1 {
  const document = createEmptyMapDocumentV1({
    width: ARENA_MAP_WIDTH,
    height: ARENA_MAP_HEIGHT,
    tileSize: TILE,
    backgroundColor: '#241c14',
  })

  // O `id` do tileset é LOCAL ao documento; o `builtin:office/...` vai em
  // `assetId`. O schema recusa `:` e `/` no id, e a referência de tile é
  // partida no ÚLTIMO `:` — um id com dois-pontos quebraria a leitura.
  const usados = [TERRAIN, CITY, ...Object.values(PROPS).map((p) => p.tileset)]
  const localId = new Map<string, string>()
  document.tilesets = [...new Set(usados)].map((assetId) => {
    const entry = tilesetEntry(assetId)
    const id = `arena-${assetId.split('/').pop()}`
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

  const at = (x: number, y: number) => y * ARENA_MAP_WIDTH + x
  const objects: MapObjectV1[] = []
  let sequencial = 0

  const solido = (x: number, y: number, w = 1, h = 1) => {
    sequencial += 1
    objects.push({
      id: `arena-col-${sequencial}`,
      layerKey: 'collision',
      type: 'collision',
      geometry: { kind: 'rectangle', x: x * TILE, y: y * TILE, width: w * TILE, height: h * TILE },
      properties: {},
    })
  }

  /**
   * Coloca um prop, fatiando os multi-tile como o editor faz.
   *
   * `espelhado` reflete a PEÇA INTEIRA (a origem dela), nunca tile a tile: a
   * primeira versão espelhava cada slice individualmente, o que troca as
   * metades esquerda e direita de um carro de 2×4 e o deixa embaralhado. Peça
   * de um tile não notava a diferença; as grandes, sim.
   */
  const prop = (nome: keyof typeof PROPS, x: number, y: number, espelhado = false) => {
    const peca = PROPS[nome]
    const entry = tilesetEntry(peca.tileset)
    if (espelhado) x = ARENA_MAP_WIDTH - x - peca.cols
    for (let dy = 0; dy < peca.rows; dy += 1) {
      for (let dx = 0; dx < peca.cols; dx += 1) {
        sequencial += 1
        objects.push({
          id: `arena-obj-${sequencial}`,
          layerKey: 'objects',
          type: 'tile-object',
          geometry: {
            kind: 'rectangle',
            x: (x + dx) * TILE,
            y: (y + dy) * TILE,
            width: TILE,
            height: TILE,
          },
          properties: {
            tilesetId: refTileset(peca.tileset),
            tileIndex: (peca.row + dy) * entry.columns + (peca.col + dx),
          },
        })
      }
    }
    if (peca.solid) solido(x, y, peca.cols, peca.rows)
  }

  // ── chão ────────────────────────────────────────────────────────────────
  // Terra batida, uniforme. A primeira versão salpicava tiles de grama por
  // hash da posição e ficou pior que o chão liso: sem tiles de transição,
  // mancha quadrada de grama tem borda dura e lê como erro de render, não como
  // terreno — e o hash espelhado ainda desenhava chevrons diagonais no campo.
  // Quem dá interesse visual aqui é a mobília, não o piso.
  for (let y = 0; y < ARENA_MAP_HEIGHT; y += 1) {
    for (let x = 0; x < ARENA_MAP_WIDTH; x += 1) {
      floor.data[at(x, y)] = `${refTileset(TERRAIN)}:${GROUND_DIRT}`
    }
  }

  // ── muro perimetral ─────────────────────────────────────────────────────
  // Uma faixa de concreto de dois tiles: fecha a arena e dá parede para
  // encostar, que é o que faz o tiro rasante ter graça.
  for (let x = 0; x < ARENA_MAP_WIDTH; x += 1) {
    for (const y of [0, 1, ARENA_MAP_HEIGHT - 2, ARENA_MAP_HEIGHT - 1]) {
      walls.data[at(x, y)] = `${refTileset(CITY)}:${WALL_CONCRETE}`
    }
  }
  for (let y = 0; y < ARENA_MAP_HEIGHT; y += 1) {
    for (const x of [0, 1, ARENA_MAP_WIDTH - 2, ARENA_MAP_WIDTH - 1]) {
      walls.data[at(x, y)] = `${refTileset(CITY)}:${WALL_CONCRETE}`
    }
  }
  solido(0, 0, ARENA_MAP_WIDTH, 2)
  solido(0, ARENA_MAP_HEIGHT - 2, ARENA_MAP_WIDTH, 2)
  solido(0, 0, 2, ARENA_MAP_HEIGHT)
  solido(ARENA_MAP_WIDTH - 2, 0, 2, ARENA_MAP_HEIGHT)

  // ── cobertura, por setor e espelhada ───────────────────────────────────
  // Mapa assimétrico dá vantagem de lado, e isso só se descobre depois do modo
  // por times pronto. Cada aglomerado nasce na metade esquerda e é refletido.
  const espelhoX = (x: number, largura = 1) => ARENA_MAP_WIDTH - x - largura

  /** Fileira de cerca — o que de fato corta linha de tiro. */
  const cerca = (x: number, y: number, comprimento: number, eixo: 'h' | 'v', espelhado = false) => {
    for (let i = 0; i < comprimento; i += 1) {
      const cx = eixo === 'h' ? x + i : x
      const cy = eixo === 'h' ? y : y + i
      if (cx < 2 || cy < 2 || cx >= ARENA_MAP_WIDTH - 2 || cy >= ARENA_MAP_HEIGHT - 2) continue
      prop(eixo === 'h' ? 'cercaH' : 'cercaV', cx, cy, espelhado)
    }
  }

  /**
   * Os aglomerados possíveis de um setor. Nomes descrevem o papel no jogo, não
   * a mobília: o que importa é se aquilo esconde, corta passagem ou só enfeita.
   */
  /** Assinatura de um aglomerado: recebe onde e COMO colocar. */
  type Colocador = {
    prop: (nome: keyof typeof PROPS, x: number, y: number) => void
    cerca: (x: number, y: number, comprimento: number, eixo: 'h' | 'v') => void
  }

  const AGLOMERADOS: Array<(x: number, y: number, c: Colocador) => void> = [
    // Posto: caixote com entulho ao lado — cobertura sólida, boa para segurar.
    (x: number, y: number, c: Colocador) => {
      c.prop('caixote', x, y)
      c.prop('cacamba', x + 3, y + 1)
      c.prop('lama', x + 1, y + 2)
    },
    // Muro: corta a linha de tiro no eixo horizontal.
    (x: number, y: number, c: Colocador) => {
      c.cerca(x, y + 1, 6, 'h')
      c.prop('montePequeno', x - 1, y + 1)
      c.prop('arbusto', x + 6, y + 3)
    },
    // Muro no eixo vertical.
    (x: number, y: number, c: Colocador) => {
      c.cerca(x + 2, y, 6, 'v')
      c.prop('pedra', x + 2, y + 6)
      c.prop('pneus', x + 4, y + 2)
    },
    // Pedregulho: cobertura solta, atravessável em zigue-zague.
    (x: number, y: number, c: Colocador) => {
      c.prop('pedra', x, y)
      c.prop('pedra', x + 3, y + 2)
      c.prop('toco', x + 1, y + 4)
      c.prop('montePequeno', x + 4, y + 5)
    },
    // Trincheira: montes de terra em linha.
    (x: number, y: number, c: Colocador) => {
      c.prop('monteGrande', x, y + 2)
      c.prop('monteGrande', x + 2, y + 2)
      c.prop('monteGrande', x + 4, y + 2)
      c.prop('lama', x + 3, y + 4)
    },
    // Clareira: quase nada. Campo aberto também é decisão de projeto — sem
    // respiro, o mapa vira labirinto e ninguém se encontra.
    (x: number, y: number, c: Colocador) => {
      c.prop('lama', x + 2, y + 2)
      c.prop('toco', x + 4, y + 3)
    },
    // Comboio: dois carros abandonados. Cobertura longa de verdade, e é o que
    // mais faz o campo parecer um lugar que existia antes da partida.
    (x: number, y: number, c: Colocador) => {
      c.prop('carroAzul', x, y)
      c.prop('carroVermelho', x + 4, y + 3)
      c.prop('pneus', x + 2, y + 5)
    },
    (x: number, y: number, c: Colocador) => {
      c.prop('carroClaro', x + 1, y + 1)
      c.prop('poca', x + 4, y + 5)
      c.prop('arbusto', x + 5, y + 1)
    },
    // Mata: vegetação. Quebra a monotonia da terra batida sem exigir tile de
    // transição — a grama em tile quadrado foi justamente o que não funcionou.
    (x: number, y: number, c: Colocador) => {
      c.prop('arbustao', x, y + 1)
      c.prop('arvore', x + 4, y + 3)
      c.prop('arbusto', x + 2, y + 5)
    },
    (x: number, y: number, c: Colocador) => {
      c.prop('arvore', x + 1, y)
      c.prop('arvore', x + 5, y + 4)
      c.prop('arbusto', x + 3, y + 2)
      c.prop('toco', x + 6, y + 1)
    },
    // Canteiro de obras: maquinário. Peça alta no meio do campo dá referência
    // visual — sem marco, um mapa grande fica difícil de se localizar.
    (x: number, y: number, c: Colocador) => {
      c.prop('gerador', x, y + 1)
      c.prop('pneus', x + 4, y + 3)
      c.prop('cacamba', x + 5, y)
    },
    (x: number, y: number, c: Colocador) => {
      c.prop('torreLuz', x, y)
      c.prop('lama', x + 5, y + 4)
    },
    // Posto médico: o abrigo com cara de acampamento.
    (x: number, y: number, c: Colocador) => {
      c.prop('caixaMedica', x, y + 2)
      c.prop('banco', x + 4, y + 1)
      c.prop('arbusto', x + 4, y + 4)
    },
  ]

  const baseY = Math.floor(ARENA_MAP_HEIGHT / 2)
  const bases = [4, ARENA_MAP_WIDTH - 5]
  const pertoDaBase = (x: number, y: number) =>
    bases.some((bx) => Math.abs(x - bx) < SPAWN_CLEAR_TILES && Math.abs(y - baseY) < SPAWN_CLEAR_TILES)

  const meioX = Math.floor(ARENA_MAP_WIDTH / 2)
  // Faixas centralizadas: sobra dividida entre as duas bordas. Ancorar só no
  // topo deixava nove tiles mortos embaixo, e o campo ficava torto.
  const margem = 3
  const faixas = Math.floor((ARENA_MAP_HEIGHT - margem * 2) / SECTOR)
  const topo = margem + Math.floor((ARENA_MAP_HEIGHT - margem * 2 - faixas * SECTOR) / 2)

  for (let faixa = 0; faixa < faixas; faixa += 1) {
    const sy = topo + faixa * SECTOR
    for (let sx = margem; sx + SECTOR <= meioX; sx += SECTOR) {
      if (pertoDaBase(sx + 2, sy + 2)) continue
      // As duas coordenadas entram COMBINADAS num número só, e não como texto
      // `sx:sy`. O djb2 leva os últimos caracteres para os bits baixos, então
      // hashear `setor:3:12` e `setor:12:12` devolvia o mesmo resto e o campo
      // saía listrado — a mesma armadilha das manchas de tinta.
      const escolha = officeHash(`setor:${sx * 7919 + sy * 104729}`) % AGLOMERADOS.length
      // Duas execuções do MESMO aglomerado: uma normal, outra com o colocador
      // espelhado. Espelhar os objetos já criados não serve — a reflexão tem
      // de acontecer na peça, e só quem a coloca sabe o tamanho dela.
      AGLOMERADOS[escolha](sx, sy, {
        prop: (nome, x, y) => prop(nome, x, y),
        cerca: (x, y, comprimento, eixo) => cerca(x, y, comprimento, eixo),
      })
      AGLOMERADOS[escolha](sx, sy, {
        prop: (nome, x, y) => prop(nome, x, y, true),
        cerca: (x, y, comprimento, eixo) => cerca(x, y, comprimento, eixo, true),
      })
    }
  }

  // Ilha central: o ponto disputado de qualquer modo que venha depois.
  prop('caixote', meioX - 1, baseY - 1)
  // As duas cercas na MESMA altura: espelho, não rotação. Misturar as duas
  // simetrias dá vantagem de lado sem ninguém notar — foi o que o teste de
  // espelho pegou aqui.
  for (const cx of [meioX - 5, meioX + 5]) {
    cerca(cx, baseY - 6, 5, 'v')
    cerca(cx, baseY + 2, 5, 'v')
  }

  // ── nascimentos ─────────────────────────────────────────────────────────
  // Dois, um em cada ponta, já mirando os modos por times. O `spawn-point`
  // padrão do documento vazio é substituído.
  document.objects = objects
  for (const [indice, x] of [4, ARENA_MAP_WIDTH - 5].entries()) {
    document.objects.push({
      id: `arena-spawn-${indice + 1}`,
      layerKey: 'spawn-points',
      type: 'spawn-point',
      geometry: {
        kind: 'point',
        x: x * TILE + TILE / 2,
        y: Math.floor(ARENA_MAP_HEIGHT / 2) * TILE + TILE / 2,
      },
      properties: { name: indice === 0 ? 'Base oeste' : 'Base leste', isDefault: indice === 0 },
    })
  }

  // Valida o que foi montado à mão contra o schema do formato. Documento
  // gerado por código erra calado — um `layerKey` inexistente ou uma geometria
  // fora de forma só apareceria como mapa faltando pedaço.
  return MapDocumentV1Schema.parse(document)
}

/**
 * Os assets (URLs dos sheets) que o mapa da arena usa. Derivados do catálogo,
 * como o documento — nada vem da API, então cliente e servidor não podem
 * discordar sobre o cenário.
 */
export function arenaMapAssets(): OfficeMapAssetDTO[] {
  return [...new Set(Object.values(PROPS).map((p) => p.tileset)), TERRAIN, CITY].map((assetId) =>
    builtinAssetToDTO(tilesetEntry(assetId)),
  )
}

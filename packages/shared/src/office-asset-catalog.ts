import rawAssets from './office-asset-catalog.json'
import { isOfficeBallAssetId, isOfficeBallTile } from './office-ball-assets'
import { builtinTilesetAsset } from './office-tileset-catalog'

/**
 * Um asset composto do escritório — uma peça de mobília NOMEADA (ex.: "Cadeira
 * de escritório") mapeada para a região de tiles que a forma num sheet builtin.
 * Diferente de `OfficeTilesetCatalogEntry` (que é a spritesheet crua): aqui o
 * usuário escolhe um objeto pronto por thumbnail, não fatias soltas.
 *
 * `col/row/cols/rows` são coordenadas de TILE, iguais nos três tamanhos
 * (16/32/48) do mesmo sheet — só o pixel muda. `sheet` é o nome lógico do
 * tileset (ex.: `modern-office`); `officeAssetTilesetId` resolve o `assetId`
 * concreto pelo tamanho de tile do mapa.
 */
export interface OfficeAssetCatalogEntry {
  id: string
  sheet: string
  category: string
  name: string
  col: number
  row: number
  cols: number
  rows: number
}

export const OFFICE_ASSET_CATALOG = rawAssets as OfficeAssetCatalogEntry[]

/**
 * Conjunto canônico de categorias da paleta (ordem = ordem das abas). Todo asset
 * do catálogo DEVE usar uma destas — o teste `office-asset-catalog` trava o
 * contrário, evitando o esparramamento de categorias ad-hoc por curador.
 */
export const OFFICE_ASSET_CATEGORIES = [
  'Mesa',
  'Cadeira',
  'Sofá',
  'Cama',
  'Armário',
  'Eletrônicos',
  'Instrumento',
  'Esporte',
  'Veículo',
  'Planta',
  'Vaso',
  'Banheiro',
  'Cozinha',
  'Tapete',
  'Decoração',
  'Porta',
  'Janela',
] as const

export type OfficeAssetCategory = (typeof OFFICE_ASSET_CATEGORIES)[number]

/**
 * Categorias cujos assets NÃO bloqueiam passagem quando colocados no chão —
 * ou porque dá pra andar por cima (tapete) ou porque a peça é pra
 * sentar/deitar (cadeira, sofá, cama): o personagem precisa conseguir chegar
 * até (e "ocupar") o tile dela, não ser barrado a distância pela bbox
 * inteira. Toda mobília colocada pela paleta (`AssetPalette`) bloqueia
 * passagem por padrão — ver `addTileObjectGroupAtPixel` em
 * `apps/web/src/office/editing/decorationDoc.ts`, que gera um objeto
 * `collision` pareado com a bbox do grupo salvo para as categorias fora
 * deste conjunto (review PR 10555 — item "verificar se os objetos vêm com
 * colisão": antes desta task, NENHUMA peça da paleta bloqueava o personagem).
 */
const NON_COLLIDABLE_ASSET_CATEGORIES: ReadonlySet<string> = new Set([
  'Tapete',
  'Cadeira',
  'Sofá',
  'Cama',
  // A posição do kart muda durante a sessão; o OfficeHub bloqueia somente o
  // tile onde o veículo está estacionado.
  'Veículo',
])

/** Sheet funcional da bola de futebol — a única peça que existe só para ser chutada. */
export const OFFICE_BALL_SHEET = 'ball'

/**
 * Se a peça deve gerar colisão ao ser colocada no mapa. `assetId`/`tileIndex`
 * cobrem as exceções por PEÇA, que não seguem a regra da categoria delas: toda
 * bola de um tile é chutável (`isOfficeBallTile`), e bola sólida seria bola
 * que ninguém alcança para chutar. O resto de `Esporte` (halter, esteira,
 * bola de pilates) continua bloqueando passagem.
 */
export function isCollidableAssetCategory(
  category: string,
  assetId?: string,
  tileIndex?: number,
): boolean {
  if (assetId !== undefined && tileIndex !== undefined && isOfficeBallTile(assetId, tileIndex)) return false
  if (assetId !== undefined && isOfficeBallAssetId(assetId)) return false
  return !NON_COLLIDABLE_ASSET_CATEGORIES.has(category)
}

/** `assetId` builtin concreto de um sheet lógico para o tamanho de tile do mapa. */
export function officeAssetTilesetId(sheet: string, tileSize: number): string {
  return `builtin:office/${sheet}-${tileSize}`
}

/**
 * Assets cujo sheet existe como builtin no tamanho de tile pedido — some os que
 * não têm variante para aquele mapa (não deveria acontecer com os sheets atuais,
 * mas evita oferecer um asset que falharia ao colocar).
 */
export function officeAssetsForTileSize(tileSize: number): OfficeAssetCatalogEntry[] {
  return OFFICE_ASSET_CATALOG.filter((entry) => builtinTilesetAsset(officeAssetTilesetId(entry.sheet, tileSize)) !== null)
}

/**
 * Agrupa assets por categoria, na ordem canônica de `OFFICE_ASSET_CATEGORIES`
 * (= ordem das abas). Categorias sem asset são omitidas; categorias fora da
 * canônica (não deveria acontecer — há teste) vão para o fim.
 */
export function officeAssetCategories(
  entries: OfficeAssetCatalogEntry[] = OFFICE_ASSET_CATALOG,
): { category: string; entries: OfficeAssetCatalogEntry[] }[] {
  const byCategory = new Map<string, OfficeAssetCatalogEntry[]>()
  for (const entry of entries) {
    const list = byCategory.get(entry.category) ?? []
    list.push(entry)
    byCategory.set(entry.category, list)
  }
  const rank = new Map<string, number>(OFFICE_ASSET_CATEGORIES.map((c, i) => [c, i]))
  return [...byCategory.entries()]
    .sort((a, b) => (rank.get(a[0]) ?? Infinity) - (rank.get(b[0]) ?? Infinity))
    .map(([category, list]) => ({ category, entries: list }))
}

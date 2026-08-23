/**
 * Loja de recompensas — o sink dos EMR Coins.
 *
 * A pessoa gasta coins e gera um PEDIDO; a G&G aprova, entrega ou cancela.
 * `productTitle` e `pricePaid` são congelados no pedido de propósito: o produto
 * muda de nome e de preço depois, e o pedido é histórico.
 */

/** Categorias do catálogo. String e não enum do Prisma: incluir uma não deve custar migration. */
export const STORE_PRODUCT_CATEGORIES = ['Conteúdo', 'Equipamento', 'Experiência'] as const
export type StoreProductCategory = (typeof STORE_PRODUCT_CATEGORIES)[number]

export const STORE_ORDER_STATUSES = ['PENDING', 'APPROVED', 'DELIVERED', 'CANCELLED'] as const
export type StoreOrderStatus = (typeof STORE_ORDER_STATUSES)[number]

export const STORE_ORDER_STATUS_LABELS: Record<StoreOrderStatus, string> = {
  PENDING: 'Pendente',
  APPROVED: 'Aprovado',
  DELIVERED: 'Entregue',
  CANCELLED: 'Cancelado',
}

/**
 * ÚNICA fonte de verdade das transições — service e web leem daqui. Cancelar só
 * vale antes da entrega: depois de entregue não há o que estornar.
 */
export const STORE_ORDER_TRANSITIONS: Record<StoreOrderStatus, readonly StoreOrderStatus[]> = {
  PENDING: ['APPROVED', 'CANCELLED'],
  APPROVED: ['DELIVERED', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
}

export function canTransitionStoreOrder(from: StoreOrderStatus, to: StoreOrderStatus): boolean {
  return STORE_ORDER_TRANSITIONS[from].includes(to)
}

export const STORE_PRODUCT_TITLE_MAX_LENGTH = 120
export const STORE_PRODUCT_DESCRIPTION_MAX_LENGTH = 600
export const STORE_ADMIN_NOTES_MAX_LENGTH = 500
export const STORE_PRICE_MIN = 1
export const STORE_PRICE_MAX = 1_000_000
export const STORE_STOCK_MAX = 100_000
export const STORE_ORDER_PAGE_SIZE = 20
export const STORE_EXPORT_MAX_ROWS = 5000
export const STORE_BATCH_MAX_IDS = 100

export interface StoreProductDTO {
  id: string
  title: string
  description: string | null
  category: StoreProductCategory
  priceInCoins: number
  stock: number
  /** URL derivada da chave do S3; a chave nunca sai da API. */
  imageUrl: string | null
  isDigital: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
}

/** O que a PESSOA vê. Sem `adminNotes`: a nota da G&G é interna. */
export interface StoreOrderDTO {
  id: string
  status: StoreOrderStatus
  /** null quando o produto foi apagado depois — o pedido sobrevive. */
  productId: string | null
  /** Congelado no resgate; não é o nome atual do produto. */
  productTitle: string
  /** Congelado no resgate; não é o preço atual do produto. */
  pricePaid: number
  imageUrl: string | null
  handledAt: string | null
  createdAt: string
}

/** O que a FILA vê: tudo do colaborador mais a nota interna e quem tratou. */
export interface StoreOrderAdminDTO extends StoreOrderDTO {
  adminNotes: string | null
  user: { id: string; name: string; email: string }
  handledBy: { id: string; name: string } | null
}

export interface CreateStoreProductRequest {
  title: string
  description?: string | null
  category: StoreProductCategory
  priceInCoins: number
  stock: number
  /** Só entra quando o form subiu um arquivo novo; omitido, o PATCH preserva a capa. */
  imageKey?: string | null
  isDigital?: boolean
  isActive?: boolean
}

export type UpdateStoreProductRequest = Partial<CreateStoreProductRequest>

export interface CreateStoreOrderRequest {
  productId: string
}

export interface UpdateStoreOrderRequest {
  status: StoreOrderStatus
  adminNotes?: string | null
}

export interface StoreOrderBatchRequest {
  ids: string[]
  status: StoreOrderStatus
  adminNotes?: string | null
}

/** Lote NUNCA é tudo-ou-nada: sempre diz o que passou e o que falhou, com o motivo. */
export interface StoreOrderBatchResult {
  succeeded: string[]
  failed: { id: string; message: string }[]
}

export interface StoreProductListResponse {
  products: StoreProductDTO[]
}

export interface StoreOrderListResponse {
  orders: StoreOrderDTO[]
  total: number
  page: number
  pageSize: number
}

export interface StoreOrderAdminListResponse {
  orders: StoreOrderAdminDTO[]
  total: number
  page: number
  pageSize: number
}

export interface CreateStoreOrderResponse {
  order: StoreOrderDTO
  /** Saldo já atualizado — evita um refetch imediato do chip de coins. */
  balance: number
}

/**
 * Contrato da área de Cultura: páginas institucionais (manifesto), manuais
 * internos e benefícios. O conteúdo longo é escrito em Markdown e renderizado
 * no front por um componente próprio (nada de HTML cru vindo do banco).
 */

/** Páginas de conteúdo institucional, uma por slug. */
export const CULTURE_PAGE_SLUGS = ['manifesto', 'kit-visual'] as const
export type CulturePageSlug = (typeof CULTURE_PAGE_SLUGS)[number]

export const CULTURE_PAGE_LABELS: Record<CulturePageSlug, string> = {
  manifesto: 'Manifesto cultural',
  'kit-visual': 'Kit visual',
}

export function isCulturePageSlug(value: string): value is CulturePageSlug {
  return (CULTURE_PAGE_SLUGS as readonly string[]).includes(value)
}

export const CULTURE_TITLE_MAX_LENGTH = 160
export const CULTURE_SUBTITLE_MAX_LENGTH = 240
export const CULTURE_SUMMARY_MAX_LENGTH = 400
export const CULTURE_DESCRIPTION_MAX_LENGTH = 400
export const CULTURE_REFERENCE_LABEL_MAX_LENGTH = 60
export const CULTURE_ICON_MAX_LENGTH = 48
/** Teto do corpo em Markdown — o manifesto do protótipo tem ~25 mil caracteres. */
export const CULTURE_BODY_MAX_LENGTH = 80_000

export interface CulturePageDTO {
  slug: string
  title: string
  subtitle: string | null
  body: string
  published: boolean
  updatedAt: string
}

export interface CultureManualDTO {
  id: string
  title: string
  description: string
  /** Corpo em Markdown lido dentro do app ("Ler manual"); null quando só há PDF. */
  body: string | null
  /**
   * Caminho da rota autenticada que devolve o link de download; null quando o
   * manual não tem PDF. Não é a URL do arquivo: o front chama esta rota com o
   * token e recebe um link assinado de curta duração.
   */
  downloadPath: string | null
  fileName: string | null
  fileSize: number | null
  /** Texto livre exibido no card, ex.: "Atualizado em junho/2024". */
  referenceLabel: string | null
  order: number
  published: boolean
  updatedAt: string
}

export interface CultureBenefitDTO {
  id: string
  title: string
  summary: string
  /** Nome do Material Symbol exibido no card. */
  icon: string | null
  /** Corpo em Markdown mostrado no modal de detalhe. */
  body: string
  order: number
  published: boolean
  updatedAt: string
}

/**
 * Como a imagem preenche o card do kit visual. `COVER` recorta para ocupar tudo
 * (banner, fundo de reunião — arte que sangra); `CONTAIN` mostra a peça inteira
 * com respiro (logo, selo), que recortada perderia justamente a forma.
 */
export const CULTURE_VISUAL_ASSET_FITS = ['COVER', 'CONTAIN'] as const
export type CultureVisualAssetFit = (typeof CULTURE_VISUAL_ASSET_FITS)[number]

export const CULTURE_VISUAL_ASSET_FIT_LABELS: Record<CultureVisualAssetFit, string> = {
  COVER: 'Preencher o card (recorta as bordas)',
  CONTAIN: 'Mostrar a peça inteira',
}

/** Limite do nome sugerido no download, ex.: `EMR-Banner-LinkedIn.png`. */
export const CULTURE_VISUAL_ASSET_FILE_NAME_MAX_LENGTH = 120

/**
 * Peça do kit de identidade visual. Uma imagem só por peça: ela é ao mesmo
 * tempo o preview do card e o arquivo que a pessoa baixa — não há "preview" e
 * "arquivo" separados, porque o que se distribui aqui É a imagem.
 */
export interface CultureVisualAssetDTO {
  id: string
  title: string
  description: string
  /**
   * URL pública da imagem, resolvida no servidor a partir da chave no S3.
   * Vazia quando o storage não está configurado — a tela trata como "sem
   * imagem" em vez de renderizar um quadrado quebrado.
   */
  imageUrl: string
  /** Nome sugerido no download. */
  fileName: string
  fit: CultureVisualAssetFit
  order: number
  published: boolean
  updatedAt: string
}

export interface CreateCultureVisualAssetRequest {
  title: string
  description: string
  /** Chave do objeto no S3, devolvida pelo presign. Nunca uma URL. */
  storageKey: string
  fileName: string
  fit?: CultureVisualAssetFit
  published?: boolean
}

export type UpdateCultureVisualAssetRequest = Partial<CreateCultureVisualAssetRequest>

export interface CultureVisualAssetsResponse {
  assets: CultureVisualAssetDTO[]
}

/**
 * Material **pessoal** do kit: entregue a UMA pessoa, e só ela (mais quem
 * administra Cultura) vê. Foto do ensaio, certificado, carta.
 *
 * Modelo separado do `CultureVisualAsset` de propósito, e a diferença não é
 * cosmética: a peça global mora em prefixo público do S3 e o DTO carrega a URL
 * direta; o material pessoal mora em prefixo privado, e o que sai daqui é um
 * link assinado de curta duração. Uma coluna `recipientId` opcional na mesma
 * tabela significaria que um booleano errado publica a foto de alguém num CDN
 * público — e sem volta, porque URL vazada não se revoga.
 */
export const CULTURE_PERSONAL_ASSET_KINDS = ['IMAGE', 'DOCUMENT'] as const
export type CulturePersonalAssetKind = (typeof CULTURE_PERSONAL_ASSET_KINDS)[number]

export interface CulturePersonalAssetDTO {
  id: string
  title: string
  description: string | null
  kind: CulturePersonalAssetKind
  fileName: string
  fileSize: number | null
  /**
   * Link assinado para exibir a imagem no card, válido por poucos minutos.
   * `null` em documento (não há o que mostrar) e quando o storage está fora.
   */
  previewUrl: string | null
  /**
   * Rota autenticada que devolve o link de download. Não é a URL do arquivo:
   * a chave do objeto nunca chega ao cliente.
   */
  downloadPath: string
  createdAt: string
}

/** Como quem administra vê o material — com o destinatário junto. */
export interface CulturePersonalAssetAdminDTO extends CulturePersonalAssetDTO {
  recipient: { id: string; name: string }
}

export interface CreateCulturePersonalAssetRequest {
  recipientId: string
  title: string
  description?: string | null
  /** Chave do objeto no S3, devolvida pelo presign. Nunca uma URL. */
  storageKey: string
  fileName: string
  fileSize?: number | null
  kind: CulturePersonalAssetKind
}

/**
 * Só texto. Trocar o destinatário não é edição, é outra entrega: a chave do
 * objeto é namespaced por pessoa, e reapontar deixaria o arquivo guardado na
 * pasta de quem não o recebe mais.
 */
export interface UpdateCulturePersonalAssetRequest {
  title?: string
  description?: string | null
}

export interface CulturePersonalAssetsResponse {
  assets: CulturePersonalAssetDTO[]
}

export interface CulturePersonalAssetsAdminResponse {
  assets: CulturePersonalAssetAdminDTO[]
}

/** Resposta da rota de download: link assinado, de curta duração. */
export interface CulturePersonalAssetDownloadResponse {
  url: string
}

export interface UpsertCulturePageRequest {
  title: string
  subtitle?: string | null
  body: string
  published?: boolean
}

export interface CreateCultureManualRequest {
  title: string
  description: string
  body?: string | null
  referenceLabel?: string | null
  fileKey?: string | null
  fileName?: string | null
  fileSize?: number | null
  published?: boolean
}

export type UpdateCultureManualRequest = Partial<CreateCultureManualRequest>

export interface CreateCultureBenefitRequest {
  title: string
  summary: string
  icon?: string | null
  body: string
  published?: boolean
}

export type UpdateCultureBenefitRequest = Partial<CreateCultureBenefitRequest>

/** Nova ordem completa da lista: a posição no array vira o campo `order`. */
export interface ReorderCultureRequest {
  ids: string[]
}

export interface CulturePageResponse {
  page: CulturePageDTO
}

export interface CultureManualsResponse {
  manuals: CultureManualDTO[]
}

export interface CultureBenefitsResponse {
  benefits: CultureBenefitDTO[]
}

/** Resposta da rota de download: link assinado, de curta duração. */
export interface CultureManualDownloadResponse {
  url: string
}

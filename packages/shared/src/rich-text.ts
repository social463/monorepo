/**
 * Texto rico do Feed Corporativo — **documento fechado**, não HTML.
 *
 * A razão está escrita em `apps/web/src/components/Markdown.tsx`: neste repo
 * markup vindo de usuário nunca chega ao DOM como markup. Guardar HTML de post
 * escrito por qualquer colaborador (é isso que o fluxo de aprovação destrava) e
 * injetá-lo com `dangerouslySetInnerHTML` seria XSS armazenado com alcance de
 * empresa inteira — inclusive contra a sessão do admin que abre a fila de
 * aprovação.
 *
 * Então o editor da web **traduz** o `contenteditable` para esta estrutura, o
 * Zod da rota valida cada campo contra as listas fechadas daqui (cor fora da
 * paleta é 400, não sanitização silenciosa) e a web renderiza como elementos
 * React. O texto puro sai de `richDocToPlainText` — é ele que alimenta excerto
 * do alcance, prévia da Home, notificação e o `content` da coluna antiga.
 */

/** Escala de tamanho do texto. Ausente num span significa `md`. */
export const RICH_TEXT_SIZES = ['sm', 'md', 'lg', 'xl'] as const
export type RichTextSize = (typeof RICH_TEXT_SIZES)[number]

/**
 * Paleta fechada de cor de texto e de preenchimento. São NOMES, não hex: a web
 * mapeia cada um para um par claro/escuro, então o comunicado continua legível
 * no tenant de tema claro e no de tema escuro. Hex livre do autor não teria
 * como fazer isso.
 */
export const RICH_TEXT_COLORS = ['default', 'brand', 'success', 'warning', 'danger', 'info'] as const
export type RichTextColor = (typeof RICH_TEXT_COLORS)[number]

export const RICH_TEXT_COLOR_LABELS: Record<RichTextColor, string> = {
  default: 'Padrão',
  brand: 'Marca',
  success: 'Verde',
  warning: 'Amarelo',
  danger: 'Vermelho',
  info: 'Azul',
}

/**
 * Tipos de bloco. Item de lista é **um bloco**, não uma lista aninhada: o
 * modelo fica plano (mais fácil de traduzir do `contenteditable` e de validar),
 * e quem renderiza agrupa blocos vizinhos do mesmo tipo em `<ul>`/`<ol>`.
 *
 * `heading` é o subtítulo DENTRO do corpo (o botão H2 da barra) — não se
 * confunde com `CorporatePost.title`, que é campo próprio e aparece uma vez, no
 * topo do card.
 */
export const RICH_BLOCK_TYPES = ['paragraph', 'heading', 'quote', 'bullet', 'ordered'] as const
export type RichBlockType = (typeof RICH_BLOCK_TYPES)[number]

/** Trecho de texto com suas marcas. Campo ausente = marca desligada. */
export interface RichSpan {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  size?: RichTextSize
  color?: RichTextColor
  /** Cor de preenchimento (marca-texto). */
  highlight?: RichTextColor
  /** Link; só o que passa em `isSafeHref`. */
  href?: string
  /** Menção a uma pessoa: id do usuário. O texto do span é o nome exibido. */
  mentionId?: string
}

export interface RichBlock {
  type: RichBlockType
  spans: RichSpan[]
}

export interface RichDoc {
  blocks: RichBlock[]
}

/** Teto de blocos e de spans por bloco — trava documento absurdo antes do banco. */
export const RICH_DOC_MAX_BLOCKS = 200
export const RICH_DOC_MAX_SPANS_PER_BLOCK = 100

/**
 * Só http(s), mailto, tel e caminhos internos viram link; o resto é recusado.
 * Fonte única: a API valida com isto e `components/Markdown.tsx` reexporta.
 *
 * `//host` é protocol-relative — sai do app sem declarar esquema, então conta
 * como inseguro.
 */
export function isSafeHref(raw: string): boolean {
  const href = raw.trim()
  if (!href) return false
  if (href.startsWith('//')) return false
  if (href.startsWith('/') || href.startsWith('#')) return true
  return /^(https?:\/\/|mailto:|tel:)/i.test(href)
}

function isRichSpan(value: unknown): value is RichSpan {
  if (typeof value !== 'object' || value === null) return false
  const span = value as Record<string, unknown>
  if (typeof span.text !== 'string') return false
  for (const flag of ['bold', 'italic', 'underline'] as const) {
    if (span[flag] !== undefined && typeof span[flag] !== 'boolean') return false
  }
  if (span.size !== undefined && !(RICH_TEXT_SIZES as readonly unknown[]).includes(span.size)) return false
  for (const key of ['color', 'highlight'] as const) {
    if (span[key] !== undefined && !(RICH_TEXT_COLORS as readonly unknown[]).includes(span[key])) return false
  }
  if (span.href !== undefined && (typeof span.href !== 'string' || !isSafeHref(span.href))) return false
  if (span.mentionId !== undefined && typeof span.mentionId !== 'string') return false
  return true
}

/**
 * Guarda de runtime. Existe porque `contentJson` é uma coluna `Json` do Prisma:
 * o tipo do TypeScript ali é `JsonValue`, e uma linha gravada por uma versão
 * anterior do código não tem como ser confiada só pelo tipo.
 */
export function isRichDoc(value: unknown): value is RichDoc {
  if (typeof value !== 'object' || value === null) return false
  const doc = value as Record<string, unknown>
  if (!Array.isArray(doc.blocks)) return false
  if (doc.blocks.length > RICH_DOC_MAX_BLOCKS) return false
  return doc.blocks.every((block) => {
    if (typeof block !== 'object' || block === null) return false
    const b = block as Record<string, unknown>
    if (!(RICH_BLOCK_TYPES as readonly unknown[]).includes(b.type)) return false
    if (!Array.isArray(b.spans)) return false
    if (b.spans.length > RICH_DOC_MAX_SPANS_PER_BLOCK) return false
    return b.spans.every(isRichSpan)
  })
}

/** Texto puro do documento: um bloco por linha, marcas descartadas. */
export function richDocToPlainText(doc: RichDoc): string {
  return doc.blocks
    .map((block) => block.spans.map((span) => span.text).join(''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Blocos com algum texto — a "altura" do post, usada para decidir se corta. */
export function richDocLineCount(doc: RichDoc): number {
  return doc.blocks.filter((block) => block.spans.some((span) => span.text.trim().length > 0)).length
}

export function isEmptyRichDoc(doc: RichDoc): boolean {
  return richDocToPlainText(doc).length === 0
}

/** Ids das pessoas mencionadas no documento, sem repetição. */
export function richDocMentionIds(doc: RichDoc): string[] {
  const ids = new Set<string>()
  for (const block of doc.blocks) {
    for (const span of block.spans) {
      if (span.mentionId) ids.add(span.mentionId)
    }
  }
  return [...ids]
}

/**
 * Documento de uma linha só, sem marca nenhuma. É o que transforma post antigo
 * (texto puro em `content`) em algo que o renderizador novo desenha, sem
 * precisar migrar dado.
 */
export function plainTextToRichDoc(text: string): RichDoc {
  return {
    blocks: text.split('\n').map((line) => ({ type: 'paragraph' as const, spans: [{ text: line }] })),
  }
}

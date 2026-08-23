import {
  RICH_TEXT_COLORS,
  RICH_TEXT_SIZES,
  isSafeHref,
  type RichBlock,
  type RichBlockType,
  type RichDoc,
  type RichSpan,
  type RichTextColor,
  type RichTextSize,
} from '@legends/shared'

/**
 * Tradução entre o `contenteditable` e o `RichDoc`.
 *
 * O HTML do navegador **não** é guardado: ele é traduzido para o documento
 * fechado de `@legends/shared` na saída, e reconstruído a partir dele na
 * entrada. É isso que faz o texto rico do feed não ser um vetor de XSS
 * armazenado, mesmo com qualquer colaborador escrevendo (ver `rich-text.ts`).
 *
 * Consequência prática: o que o navegador inventar de tag (`<font>`, `<span
 * style>`, HTML colado de outro site) só sobrevive se casar com uma marca
 * conhecida daqui. O resto vira texto puro.
 */

/**
 * Cor de cada nome, em hex, para o `execCommand`. São os valores que aparecem
 * ENQUANTO se escreve; na leitura, quem manda são as classes de tema do
 * `RichTextView`. Por isso os tons são escolhidos para funcionar nos dois
 * esquemas — o editor não sabe em que tema o comunicado será lido.
 */
export const RICH_COLOR_HEX: Record<RichTextColor, string> = {
  default: '#111827',
  brand: '#0f766e',
  success: '#15803d',
  warning: '#b45309',
  danger: '#b91c1c',
  info: '#1d4ed8',
}

/** Valor do `execCommand('fontSize')` para cada degrau da escala. */
export const RICH_SIZE_COMMAND: Record<RichTextSize, string> = {
  sm: '2',
  md: '3',
  lg: '5',
  xl: '6',
}

/** O que o navegador grava no `style.font-size` para cada valor acima. */
const SIZE_BY_CSS: Record<string, RichTextSize> = {
  small: 'sm',
  medium: 'md',
  'x-large': 'lg',
  'xx-large': 'xl',
  '13px': 'sm',
  '16px': 'md',
  '24px': 'lg',
  '32px': 'xl',
}

/**
 * Tamanho em vigor num ponto do editor: sobe do nó até a raiz lendo o que o
 * navegador gravou. É o que faz o A+/A− andarem a partir do tamanho do trecho
 * SELECIONADO — um contador interno diria "md" para um trecho que já está em
 * "xl", e o primeiro clique encolheria o texto em vez de aumentá-lo.
 */
export function sizeAtNode(node: Node | null, root: HTMLElement): RichTextSize {
  let el: Node | null = node
  while (el && el !== root) {
    if (el instanceof HTMLElement) {
      const byCss = SIZE_BY_CSS[el.style.fontSize?.toLowerCase() ?? '']
      if (byCss) return byCss
      // `<font size="N">` — o que o execCommand produz quando o navegador
      // ignora o `styleWithCSS`.
      if (el.tagName === 'FONT') {
        const attr = el.getAttribute('size')
        const found = RICH_TEXT_SIZES.find((size) => RICH_SIZE_COMMAND[size] === attr)
        if (found) return found
      }
    }
    el = el.parentNode
  }
  return 'md'
}

function normalizeColor(raw: string): string {
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(raw.trim())
  if (!rgb) return raw.trim().toLowerCase()
  const hex = [rgb[1], rgb[2], rgb[3]]
    .map((n) => Number(n).toString(16).padStart(2, '0'))
    .join('')
  return `#${hex}`
}

const COLOR_BY_VALUE = new Map<string, RichTextColor>(
  RICH_TEXT_COLORS.map((name) => [RICH_COLOR_HEX[name].toLowerCase(), name]),
)

function colorNameOf(raw: string | undefined): RichTextColor | undefined {
  if (!raw) return undefined
  return COLOR_BY_VALUE.get(normalizeColor(raw))
}

/** Marcas acumuladas subindo do nó de texto até o elemento do bloco. */
function marksOf(node: Node, blockEl: Element): Omit<RichSpan, 'text'> {
  const marks: Omit<RichSpan, 'text'> = {}
  let el: Node | null = node.parentNode
  while (el && el !== blockEl) {
    if (el instanceof HTMLElement) {
      const tag = el.tagName
      if (tag === 'B' || tag === 'STRONG') marks.bold = true
      if (tag === 'I' || tag === 'EM') marks.italic = true
      if (tag === 'U') marks.underline = true
      if (el.style.fontWeight === 'bold' || Number(el.style.fontWeight) >= 600) marks.bold = true
      if (el.style.fontStyle === 'italic') marks.italic = true
      if (el.style.textDecoration.includes('underline')) marks.underline = true
      const mentionId = el.dataset.mentionId
      if (mentionId && !marks.mentionId) marks.mentionId = mentionId
      if (tag === 'A' && !marks.href) {
        const href = el.getAttribute('href') ?? ''
        if (isSafeHref(href)) marks.href = href
      }
      if (!marks.color) {
        const color = colorNameOf(el.style.color) ?? colorNameOf(el.getAttribute('color') ?? undefined)
        if (color && color !== 'default') marks.color = color
      }
      if (!marks.highlight) {
        const highlight = colorNameOf(el.style.backgroundColor)
        if (highlight) marks.highlight = highlight
      }
      if (!marks.size) {
        const size = SIZE_BY_CSS[el.style.fontSize?.toLowerCase() ?? '']
        if (size && size !== 'md') marks.size = size
      }
    }
    el = el.parentNode
  }
  return marks
}

function sameMarks(a: Omit<RichSpan, 'text'>, b: Omit<RichSpan, 'text'>): boolean {
  const keys: (keyof Omit<RichSpan, 'text'>)[] = [
    'bold',
    'italic',
    'underline',
    'size',
    'color',
    'highlight',
    'href',
    'mentionId',
  ]
  return keys.every((k) => a[k] === b[k])
}

/**
 * Tags que o navegador trata como bloco. Serve para decidir se um elemento
 * **contém** estrutura (e portanto precisa ser percorrido por dentro) ou se é
 * uma caixa de texto corrido.
 */
const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'DD', 'DT', 'FIELDSET',
  'FIGCAPTION', 'FIGURE', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER',
  'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE', 'TBODY', 'TD',
  'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
])

function hasBlockChild(el: Element): boolean {
  return Array.from(el.children).some((child) => BLOCK_TAGS.has(child.tagName))
}

/**
 * Spans de um pedaço de DOM: nós de texto na ordem, marcas agrupadas.
 *
 * `stopAt` é o elemento de bloco de referência para `marksOf` — as marcas são
 * lidas subindo até ele.
 */
function spansIn(nodes: Node[], stopAt: Element): RichSpan[] {
  const spans: RichSpan[] = []
  for (const root of nodes) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node: Node | null = root.nodeType === Node.TEXT_NODE ? root : walker.nextNode()
    while (node) {
      const text = node.textContent ?? ''
      if (text) {
        const marks = marksOf(node, stopAt)
        const last = spans[spans.length - 1]
        // Junta trechos vizinhos com as mesmas marcas: o navegador fatia texto em
        // vários nós sem motivo (uma edição no meio da palavra basta).
        if (last && sameMarks(last, marks)) last.text += text
        else spans.push({ text, ...marks })
      }
      node = walker.nextNode()
    }
  }
  return spans
}

function spansOf(blockEl: Element): RichSpan[] {
  return spansIn(Array.from(blockEl.childNodes), blockEl)
}

/**
 * Um elemento de bloco vira **1..N** blocos: `<br>` separa.
 *
 * Isto é o que segura o texto colado de fora (Word, Docs, Teams), onde a quebra
 * de linha vem como `<br>` dentro de um `<div>` só. Antes o `<br>` era ignorado
 * — o percurso só olhava nós de texto —, e o comunicado inteiro chegava ao feed
 * como um parágrafo só, com as frases grudadas ("…15h às 16hAção necessária:").
 */
function blocksOf(el: Element, type: RichBlockType): RichBlock[] {
  const out: RichBlock[] = []
  let atual: Node[] = []
  const flush = () => {
    out.push({ type, spans: spansIn(atual, el) })
    atual = []
  }
  for (const child of Array.from(el.childNodes)) {
    if (child instanceof HTMLElement && child.tagName === 'BR') flush()
    else atual.push(child)
  }
  flush()
  // Linha em branco no meio do texto é intenção do autor e fica; sobra no fim é
  // resíduo do editor (todo `<div>` vazio termina com um `<br>`) e sai.
  while (out.length > 1 && out[out.length - 1].spans.length === 0) out.pop()
  return out
}

function blockOf(el: Element, type: RichBlockType): RichBlock {
  return { type, spans: spansOf(el) }
}

/**
 * DOM do editor → documento fechado. Tag desconhecida vira parágrafo.
 *
 * Elemento de bloco que contém outros blocos é **percorrido por dentro**: HTML
 * colado costuma vir embrulhado (`<div><p>…</p><p>…</p></div>`), e achatar o
 * embrulho num bloco só juntaria todos os parágrafos.
 */
export function domToRichDoc(root: HTMLElement): RichDoc {
  const blocks: RichBlock[] = []

  const walk = (parent: Node) => {
    let loose: Node[] = []
    const pushLoose = () => {
      if (!loose.length) return
      const holder = document.createElement('div')
      for (const n of loose) holder.appendChild(n.cloneNode(true))
      loose = []
      for (const block of blocksOf(holder, 'paragraph')) {
        if (block.spans.length) blocks.push(block)
      }
    }

    for (const child of Array.from(parent.childNodes)) {
      if (child instanceof HTMLElement) {
        const tag = child.tagName
        if (tag === 'UL' || tag === 'OL') {
          pushLoose()
          const type: RichBlockType = tag === 'UL' ? 'bullet' : 'ordered'
          for (const li of Array.from(child.children)) blocks.push(...blocksOf(li, type))
          continue
        }
        if (tag === 'BLOCKQUOTE') {
          pushLoose()
          blocks.push(...blocksOf(child, 'quote'))
          continue
        }
        // O botão H2 usa `formatBlock` com `<h2>`; H1/H3 entram junto porque é o
        // que costuma vir colado de fora — todos viram o mesmo subtítulo.
        if (tag === 'H1' || tag === 'H2' || tag === 'H3') {
          pushLoose()
          blocks.push(...blocksOf(child, 'heading'))
          continue
        }
        if (BLOCK_TAGS.has(tag)) {
          pushLoose()
          if (hasBlockChild(child)) walk(child)
          else blocks.push(...blocksOf(child, 'paragraph'))
          continue
        }
        if (tag === 'BR') {
          pushLoose()
          blocks.push({ type: 'paragraph', spans: [] })
          continue
        }
      }
      loose.push(child)
    }
    pushLoose()
  }

  walk(root)
  return { blocks }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function spanToHtml(span: RichSpan): string {
  const styles: string[] = []
  if (span.color) styles.push(`color: ${RICH_COLOR_HEX[span.color]}`)
  if (span.highlight) styles.push(`background-color: ${RICH_COLOR_HEX[span.highlight]}`)
  if (span.size) {
    const css = Object.entries(SIZE_BY_CSS).find(([, v]) => v === span.size)?.[0] ?? 'medium'
    styles.push(`font-size: ${css}`)
  }
  let html = escapeHtml(span.text) || '<br>'
  if (span.bold) html = `<b>${html}</b>`
  if (span.italic) html = `<i>${html}</i>`
  if (span.underline) html = `<u>${html}</u>`
  if (span.mentionId) {
    html = `<span data-mention-id="${escapeHtml(span.mentionId)}">${html}</span>`
  } else if (span.href && isSafeHref(span.href)) {
    html = `<a href="${escapeHtml(span.href)}">${html}</a>`
  }
  if (styles.length) html = `<span style="${styles.join('; ')}">${html}</span>`
  return html
}

/**
 * Documento → HTML inicial do editor. Seguro por construção: cada pedaço é
 * montado aqui a partir de campos já validados, e o texto é escapado — nada do
 * que o autor escreveu entra como markup.
 */
export function richDocToEditorHtml(doc: RichDoc): string {
  const out: string[] = []
  let i = 0
  while (i < doc.blocks.length) {
    const block = doc.blocks[i]
    if (block.type === 'bullet' || block.type === 'ordered') {
      const tag = block.type === 'bullet' ? 'ul' : 'ol'
      const items: string[] = []
      while (i < doc.blocks.length && doc.blocks[i].type === block.type) {
        items.push(`<li>${doc.blocks[i].spans.map(spanToHtml).join('') || '<br>'}</li>`)
        i++
      }
      out.push(`<${tag}>${items.join('')}</${tag}>`)
      continue
    }
    const inner = block.spans.map(spanToHtml).join('') || '<br>'
    if (block.type === 'quote') out.push(`<blockquote>${inner}</blockquote>`)
    else if (block.type === 'heading') out.push(`<h2>${inner}</h2>`)
    else out.push(`<div>${inner}</div>`)
    i++
  }
  return out.join('')
}

export const RICH_SIZE_OPTIONS = RICH_TEXT_SIZES

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

/**
 * `RichDoc` → Markdown, para colar conteúdo formatado onde o campo é Markdown
 * (Documento 4, seção 6 — o editor de manuais).
 *
 * **Por que existe.** O `body` do manual é Markdown num `<textarea>` cru, e
 * colar Word ali sempre entregou `text/plain`: o navegador não tem para onde
 * levar a formatação. O caminho é ler o `text/html` da área de transferência,
 * que o Mural já sabe interpretar (`domToRichDoc`), e traduzir o resultado para
 * o formato do campo.
 *
 * O que sai é exatamente o subset que `components/Markdown.tsx` renderiza —
 * `##`, `-`, `1.`, `>`, `**`, `*`, `[]()`. Emitir mais do que ele lê deixaria
 * marcação visível no manual publicado.
 *
 * Cor, tamanho e marca-texto do `RichDoc` **não** têm equivalente em Markdown e
 * são descartados: preservar só o texto é melhor do que inventar HTML que o
 * leitor mostraria cru.
 */
export function richDocToMarkdown(doc: RichDoc): string {
  const linhas: string[] = []
  for (const block of doc.blocks) {
    const texto = block.spans.map(spanToMarkdown).join('').trim()
    // Bloco vazio vira separação de parágrafo, não uma linha em branco a mais:
    // Word manda `<p>&nbsp;</p>` entre parágrafos com fartura.
    if (!texto) continue
    switch (block.type) {
      case 'heading':
        linhas.push(`## ${texto}`)
        break
      case 'quote':
        linhas.push(`> ${texto}`)
        break
      case 'bullet':
        linhas.push(`- ${texto}`)
        break
      case 'ordered':
        // Sempre `1.`: o Markdown numera sozinho, e assim inserir um item no
        // meio não obriga a renumerar o resto à mão.
        linhas.push(`1. ${texto}`)
        break
      default:
        linhas.push(texto)
    }
  }

  // Parágrafo pede linha em branco entre si; itens de lista vizinhos, NÃO —
  // separá-los quebraria uma lista em várias.
  const saida: string[] = []
  linhas.forEach((linha, i) => {
    const anterior = linhas[i - 1]
    if (anterior && !(ehItemDeLista(anterior) && ehItemDeLista(linha))) saida.push('')
    saida.push(linha)
  })
  return saida.join('\n').trim()
}

function ehItemDeLista(linha: string): boolean {
  return linha.startsWith('- ') || /^\d+\. /.test(linha)
}

function spanToMarkdown(span: RichSpan): string {
  let texto = escapeMarkdown(span.text)
  if (!texto) return ''
  // Negrito por fora do itálico, que é a forma que todo parser aceita.
  if (span.italic) texto = `*${texto}*`
  if (span.bold) texto = `**${texto}**`
  // Link por último, envolvendo as marcas: `[**texto**](url)` funciona, o
  // contrário não.
  if (span.href && isSafeHref(span.href)) texto = `[${texto}](${span.href})`
  return texto
}

/**
 * Escapa só o que viraria marcação sem querer. Escapar tudo deixaria o texto
 * cheio de contrabarras — e o campo é lido e editado por gente.
 */
function escapeMarkdown(texto: string): string {
  return texto.replace(/([\\`*_[\]])/g, '\\$1')
}

/**
 * Markdown → `RichDoc`, o inverso de `richDocToMarkdown` e sobre exatamente o
 * mesmo subset: `##`, `-`, `1.`, `>`, `**`, `*`, `[]()`.
 *
 * **Por que existe.** O comunicado de campanha nasce de um modelo de linguagem,
 * que escreve markdown, e era publicado no Feed como `content` — texto puro.
 * Um `**negrito**` chegava ao mural com os asteriscos à mostra, então o prompt
 * proibia markdown e o comunicado saía chapado, sem o destaque que a fórmula da
 * Brevidade Inteligente pede. Traduzindo aqui, o Feed recebe o documento e
 * desenha o negrito; `assertPostBody` deriva o texto puro sozinho.
 *
 * O que o subset não cobre é ignorado como marcação e preservado como texto —
 * tabela, imagem e HTML cru viram a própria linha. Melhor um parágrafo literal
 * do que perder o conteúdo, e nada aqui vira HTML: o `RichDoc` é documento
 * fechado, e é essa a garantia contra XSS descrita no topo do arquivo.
 */
export function markdownToRichDoc(markdown: string): RichDoc {
  const blocks: RichBlock[] = []
  for (const raw of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const linha = raw.trim()
    // Linha em branco não vira bloco: no `RichDoc` a separação entre parágrafos
    // é a existência de dois blocos, não uma linha vazia entre eles.
    if (!linha) continue

    const heading = /^#{1,6}\s+(.*)$/.exec(linha)
    if (heading) {
      blocks.push({ type: 'heading', spans: inlineToSpans(heading[1]) })
      continue
    }
    const quote = /^>\s?(.*)$/.exec(linha)
    if (quote) {
      blocks.push({ type: 'quote', spans: inlineToSpans(quote[1]) })
      continue
    }
    const ordered = /^\d+[.)]\s+(.*)$/.exec(linha)
    if (ordered) {
      blocks.push({ type: 'ordered', spans: inlineToSpans(ordered[1]) })
      continue
    }
    const bullet = /^[-*•]\s+(.*)$/.exec(linha)
    if (bullet) {
      blocks.push({ type: 'bullet', spans: inlineToSpans(bullet[1]) })
      continue
    }
    blocks.push({ type: 'paragraph', spans: inlineToSpans(linha) })
  }
  return { blocks: blocks.slice(0, RICH_DOC_MAX_BLOCKS) }
}

/**
 * Marcas de dentro da linha. Uma passada só, da esquerda para a direita: o
 * primeiro delimitador que FECHA vence, então `**a** e **b**` vira dois
 * negritos, e um asterisco solto continua sendo asterisco.
 */
function inlineToSpans(texto: string): RichSpan[] {
  const spans: RichSpan[] = []
  let buffer = ''

  const flush = (): void => {
    if (buffer) spans.push({ text: buffer })
    buffer = ''
  }
  const push = (span: RichSpan): void => {
    flush()
    if (span.text) spans.push(span)
  }

  for (let i = 0; i < texto.length; ) {
    // Contrabarra escapa o próximo caractere — é o que `escapeMarkdown` emite.
    if (texto[i] === '\\' && i + 1 < texto.length) {
      buffer += texto[i + 1]
      i += 2
      continue
    }

    const link = /^\[([^\]]*)\]\(([^)\s]+)\)/.exec(texto.slice(i))
    if (link && isSafeHref(link[2])) {
      // O rótulo pode ter marcas próprias e virar VÁRIOS spans (`[**a** b](x)`).
      // Cada um leva o mesmo href: ficar só com o primeiro comeria o resto do
      // rótulo, e perder texto é pior do que perder a formatação.
      flush()
      for (const span of inlineToSpans(link[1])) {
        if (span.text) spans.push({ ...span, href: link[2] })
      }
      i += link[0].length
      continue
    }

    const marca = texto.startsWith('**', i) ? '**' : texto[i] === '*' || texto[i] === '_' ? texto[i] : null
    if (marca) {
      const fim = texto.indexOf(marca, i + marca.length)
      const conteudo = fim === -1 ? '' : texto.slice(i + marca.length, fim)
      // Delimitador que não fecha, ou que fecha vazio (`**` sozinho), é texto.
      if (conteudo.trim()) {
        push({ text: conteudo, ...(marca === '**' ? { bold: true } : { italic: true }) })
        i = fim + marca.length
        continue
      }
    }

    buffer += texto[i]
    i += 1
  }

  flush()
  return spans.length ? spans.slice(0, RICH_DOC_MAX_SPANS_PER_BLOCK) : [{ text: '' }]
}

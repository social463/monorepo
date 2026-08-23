import { Fragment, type ReactNode } from 'react'

/**
 * Renderiza um subset fechado de Markdown como **elementos React**.
 *
 * Nada de `dangerouslySetInnerHTML`: o conteúdo institucional é escrito por
 * admins no banco, mas mesmo assim nenhum HTML dele chega ao DOM como markup —
 * o que não é reconhecido pelo parser vira texto. Isso tira a classe inteira de
 * XSS do caminho, sem precisar de sanitizador nem de dependência nova.
 *
 * Suportado — bloco: `##`/`###` (título), parágrafo, `-`/`*` (lista), `1.`
 * (lista ordenada), `>` (citação), `---` (separador), tabela GFM
 * (`| a | b |` com linha separadora `|---|---|`). Inline: `**negrito**`,
 * `*itálico*`, `` `código` `` e `[texto](url)`.
 *
 * A tabela entrou por causa das respostas dos agentes de IA, que comparam
 * empresas em tabela markdown. É exatamente onde a garantia acima mais importa:
 * o texto vem de um LLM que ecoa conteúdo cadastrado por usuários, então uma
 * célula com `<img onerror=...>` precisa sair como texto, não como markup.
 */

/** Só http(s), mailto, tel e caminhos internos viram link; o resto vira texto. */
export function isSafeHref(raw: string): boolean {
  const href = raw.trim()
  if (!href) return false
  // `//host` é protocol-relative: sai do app sem declarar esquema — tratamos como inseguro.
  if (href.startsWith('//')) return false
  if (href.startsWith('/') || href.startsWith('#')) return true
  return /^(https?:\/\/|mailto:|tel:)/i.test(href)
}

const INLINE_PATTERN =
  /(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(`[^`\n]+`)|(\[[^\]\n]*\]\([^)\s]*\))/g

/** Quebra uma linha em nós React, aplicando as marcações inline. */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let index = 0

  INLINE_PATTERN.lastIndex = 0
  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index))
    const token = match[0]
    const key = `${keyPrefix}-i${index++}`

    if (token.startsWith('**')) {
      nodes.push(
        <strong key={key} className="font-semibold text-on-surface">
          {token.slice(2, -2)}
        </strong>,
      )
    } else if (token.startsWith('`')) {
      nodes.push(
        <code key={key} className="rounded bg-surface-container-high px-1 py-0.5 font-mono text-body-sm">
          {token.slice(1, -1)}
        </code>,
      )
    } else if (token.startsWith('[')) {
      const split = token.indexOf('](')
      const label = token.slice(1, split)
      const href = token.slice(split + 2, -1)
      if (isSafeHref(href)) {
        const external = /^https?:\/\//i.test(href.trim())
        nodes.push(
          <a
            key={key}
            href={href.trim()}
            {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
            className="text-primary underline underline-offset-2 hover:text-primary"
          >
            {label || href}
          </a>,
        )
      } else {
        // Esquema não permitido (javascript:, data:…): vira texto puro, sem link.
        nodes.push(<Fragment key={key}>{token}</Fragment>)
      }
    } else {
      nodes.push(
        <em key={key} className="italic">
          {token.slice(1, -1)}
        </em>,
      )
    }
    lastIndex = match.index + token.length
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

type Block =
  | { kind: 'heading'; level: 2 | 3; text: string }
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'hr' }

const HEADING = /^(#{1,3})\s+(.*)$/
const UNORDERED = /^[-*]\s+(.*)$/
const ORDERED = /^\d+[.)]\s+(.*)$/
const QUOTE = /^>\s?(.*)$/
const RULE = /^(-{3,}|\*{3,}|_{3,})$/
const TABLE_ROW = /^\|.*\|$/
/** Linha separadora do GFM: `|---|:---:|`. É ela que distingue tabela de texto com pipes. */
const TABLE_DIVIDER = /^\|[\s:|-]+\|$/

/** `| a | b |` → `['a', 'b']`. As bordas somem; o miolo é dividido pelos pipes. */
function splitRow(line: string): string[] {
  return line
    .trim()
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim())
}

/** Agrupa as linhas do texto em blocos antes de renderizar. */
export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let paragraph: string[] = []

  function flushParagraph() {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', lines: paragraph })
      paragraph = []
    }
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const trimmed = line.trim()

    if (trimmed === '') {
      flushParagraph()
      continue
    }

    if (RULE.test(trimmed)) {
      flushParagraph()
      blocks.push({ kind: 'hr' })
      continue
    }

    const heading = HEADING.exec(trimmed)
    if (heading) {
      flushParagraph()
      // `#` é rebaixado para h2: o h1 da página é o título, não o corpo.
      blocks.push({ kind: 'heading', level: heading[1].length >= 3 ? 3 : 2, text: heading[2] })
      continue
    }

    // Tabela só existe se a 2ª linha for a separadora — sem ela, `| a | b |` é
    // texto comum e continua caindo no parágrafo.
    if (TABLE_ROW.test(trimmed) && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1].trim())) {
      flushParagraph()
      const header = splitRow(trimmed)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && TABLE_ROW.test(lines[i].trim())) {
        const cells = splitRow(lines[i].trim())
        // Linha curta ganha células vazias; linha longa é cortada. Sem isso um
        // pipe a mais na resposta do modelo desalinharia a tabela inteira.
        rows.push(Array.from({ length: header.length }, (_, col) => cells[col] ?? ''))
        i += 1
      }
      i -= 1
      blocks.push({ kind: 'table', header, rows })
      continue
    }

    if (QUOTE.test(trimmed)) {
      flushParagraph()
      const quoteLines: string[] = []
      while (i < lines.length && QUOTE.test(lines[i].trim())) {
        quoteLines.push(QUOTE.exec(lines[i].trim())![1])
        i += 1
      }
      i -= 1
      blocks.push({ kind: 'quote', lines: quoteLines })
      continue
    }

    const isUnordered = UNORDERED.test(trimmed)
    const isOrdered = ORDERED.test(trimmed)
    if (isUnordered || isOrdered) {
      flushParagraph()
      const pattern = isUnordered ? UNORDERED : ORDERED
      const items: string[] = []
      while (i < lines.length && pattern.test(lines[i].trim())) {
        items.push(pattern.exec(lines[i].trim())![1])
        i += 1
      }
      i -= 1
      blocks.push({ kind: 'list', ordered: isOrdered, items })
      continue
    }

    paragraph.push(trimmed)
  }

  flushParagraph()
  return blocks
}

interface MarkdownProps {
  content: string
  className?: string
}

export function Markdown({ content, className }: MarkdownProps) {
  const blocks = parseBlocks(content ?? '')

  return (
    <div className={`flex flex-col gap-md text-body-md text-on-surface-variant ${className ?? ''}`}>
      {blocks.map((block, index) => {
        const key = `b${index}`
        if (block.kind === 'hr') {
          return <hr key={key} className="border-outline-variant/40" />
        }
        if (block.kind === 'heading') {
          return block.level === 2 ? (
            <h2 key={key} className="mt-md font-headline text-headline-md font-semibold text-on-surface">
              {renderInline(block.text, key)}
            </h2>
          ) : (
            <h3 key={key} className="mt-sm font-headline text-label-lg font-semibold text-on-surface">
              {renderInline(block.text, key)}
            </h3>
          )
        }
        if (block.kind === 'quote') {
          return (
            <blockquote
              key={key}
              className="border-l-2 border-primary/60 pl-md italic text-on-surface-variant"
            >
              {block.lines.map((line, i) => (
                <p key={`${key}-l${i}`}>{renderInline(line, `${key}-l${i}`)}</p>
              ))}
            </blockquote>
          )
        }
        if (block.kind === 'table') {
          return (
            // A tabela rola dentro do próprio container: comparação com muitas
            // colunas não pode empurrar a página inteira para o lado.
            <div key={key} className="overflow-x-auto">
              <table className="w-full border-collapse text-body-sm">
                <thead>
                  <tr>
                    {block.header.map((cell, i) => (
                      <th
                        key={`${key}-h${i}`}
                        scope="col"
                        className="border border-outline-variant/40 bg-surface-container-high px-sm py-xs text-left font-label text-label-sm font-semibold text-on-surface"
                      >
                        {renderInline(cell, `${key}-h${i}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row, r) => (
                    <tr key={`${key}-r${r}`}>
                      {row.map((cell, c) => (
                        <td
                          key={`${key}-r${r}c${c}`}
                          className="border border-outline-variant/40 px-sm py-xs align-top"
                        >
                          {renderInline(cell, `${key}-r${r}c${c}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
        if (block.kind === 'list') {
          const items = block.items.map((item, i) => (
            <li key={`${key}-li${i}`}>{renderInline(item, `${key}-li${i}`)}</li>
          ))
          return block.ordered ? (
            <ol key={key} className="ml-lg flex list-decimal flex-col gap-xs">
              {items}
            </ol>
          ) : (
            <ul key={key} className="ml-lg flex list-disc flex-col gap-xs">
              {items}
            </ul>
          )
        }
        return (
          <p key={key}>
            {block.lines.map((line, i) => (
              <Fragment key={`${key}-l${i}`}>
                {i > 0 && ' '}
                {renderInline(line, `${key}-l${i}`)}
              </Fragment>
            ))}
          </p>
        )
      })}
    </div>
  )
}

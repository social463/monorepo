import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  isSafeHref,
  type RichBlock,
  type RichDoc,
  type RichSpan,
  type RichTextColor,
  type RichTextSize,
} from '@legends/shared'

/**
 * Renderiza um `RichDoc` como **elementos React** — mesma postura do
 * `Markdown.tsx`: markup vindo de usuário nunca chega ao DOM como markup.
 * Aqui isso é ainda mais importante, porque o documento é escrito por qualquer
 * colaborador (o fluxo de aprovação destravou isso) e lido pela empresa toda,
 * inclusive pelo admin que abre a fila.
 *
 * Cor é NOME, não hex (ver `rich-text.ts`): cada nome vira um par de classes
 * do tema, então o comunicado continua legível no tenant claro e no escuro.
 */

/**
 * "Verde" e "Azul" saem verde e azul de verdade.
 *
 * Antes iam para `tertiary` e `secondary`, que são tokens **derivados da cor da
 * empresa**: no tenant da EMR o `tertiary` é azulado, então quem escolhia Verde
 * na paleta via o texto publicado em azul. Cor com nome de cor tem de bater com
 * a amostra clicada (`RICH_COLOR_HEX`) — quem acompanha a marca é o `brand`, e
 * só ele. `danger` fica em `error`: o token M3 já é vermelho em qualquer marca.
 */
const COLOR_CLASS: Record<RichTextColor, string> = {
  default: '',
  brand: 'text-primary',
  success: 'text-green-700 dark:text-green-400',
  warning: 'text-amber-600 dark:text-amber-400',
  danger: 'text-error',
  info: 'text-blue-700 dark:text-blue-400',
}

const HIGHLIGHT_CLASS: Record<RichTextColor, string> = {
  default: 'bg-surface-container-highest',
  brand: 'bg-primary/15',
  success: 'bg-green-400/25',
  warning: 'bg-amber-400/25',
  danger: 'bg-error/15',
  info: 'bg-blue-400/25',
}

const SIZE_CLASS: Record<RichTextSize, string> = {
  sm: 'text-body-sm',
  md: 'text-body-md',
  lg: 'text-body-lg',
  xl: 'text-title-md',
}

function spanClass(span: RichSpan): string {
  return [
    span.bold ? 'font-bold' : '',
    span.italic ? 'italic' : '',
    span.underline ? 'underline' : '',
    span.size ? SIZE_CLASS[span.size] : '',
    span.color ? COLOR_CLASS[span.color] : '',
    span.highlight ? `${HIGHLIGHT_CLASS[span.highlight]} rounded px-0.5` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function renderSpan(span: RichSpan, key: string): ReactNode {
  const className = spanClass(span)
  if (span.mentionId) {
    return (
      <Link key={key} to={`/perfil/${span.mentionId}`} className={`${className} font-medium text-primary hover:underline`}>
        {span.text}
      </Link>
    )
  }
  // `href` já passou pelo Zod da rota, mas a checagem é refeita aqui: o
  // documento pode ter sido gravado por uma versão anterior do servidor.
  if (span.href && isSafeHref(span.href)) {
    return (
      <a
        key={key}
        href={span.href}
        target="_blank"
        rel="noreferrer noopener"
        className={`${className} text-primary underline`}
      >
        {span.text}
      </a>
    )
  }
  if (!className) return <Fragment key={key}>{span.text}</Fragment>
  return (
    <span key={key} className={className}>
      {span.text}
    </span>
  )
}

function renderBlockContent(block: RichBlock, key: string): ReactNode {
  return block.spans.map((span, i) => renderSpan(span, `${key}-s${i}`))
}

/**
 * Itens de lista são blocos irmãos no modelo (plano, para o editor traduzir
 * fácil), então quem agrupa vizinhos do mesmo tipo em `<ul>`/`<ol>` é quem
 * renderiza. Sem isso cada item viraria uma lista de um item só.
 */
export function RichTextView({ doc, className = '' }: { doc: RichDoc; className?: string }) {
  const out: ReactNode[] = []
  let i = 0
  while (i < doc.blocks.length) {
    const block = doc.blocks[i]
    if (block.type === 'bullet' || block.type === 'ordered') {
      const type = block.type
      const items: RichBlock[] = []
      while (i < doc.blocks.length && doc.blocks[i].type === type) {
        items.push(doc.blocks[i])
        i++
      }
      const ListTag = type === 'bullet' ? 'ul' : 'ol'
      out.push(
        <ListTag
          key={`b${i}`}
          className={`my-1 ml-lg ${type === 'bullet' ? 'list-disc' : 'list-decimal'} text-body-md text-on-surface`}
        >
          {items.map((item, n) => (
            <li key={`b${i}-${n}`}>{renderBlockContent(item, `b${i}-${n}`)}</li>
          ))}
        </ListTag>,
      )
      continue
    }
    if (block.type === 'heading') {
      out.push(
        <h3 key={`b${i}`} className="mt-sm font-headline text-title-sm font-bold text-on-surface">
          {renderBlockContent(block, `b${i}`)}
        </h3>,
      )
      i++
      continue
    }
    if (block.type === 'quote') {
      out.push(
        <blockquote
          key={`b${i}`}
          className="my-1 border-l-4 border-primary/40 pl-md text-body-md italic text-on-surface-variant"
        >
          {renderBlockContent(block, `b${i}`)}
        </blockquote>,
      )
      i++
      continue
    }
    out.push(
      <p key={`b${i}`} className="whitespace-pre-wrap break-words text-body-md text-on-surface">
        {block.spans.length === 0 ? ' ' : renderBlockContent(block, `b${i}`)}
      </p>,
    )
    i++
  }
  return <div className={className}>{out}</div>
}

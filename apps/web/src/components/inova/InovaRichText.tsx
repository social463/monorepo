import { useState } from 'react'
import { markdownToRichDoc, richDocToMarkdown, type RichDoc } from '@legends/shared'
import { RichTextEditor } from '../rich-text/RichTextEditor'
import { Markdown } from '../Markdown'

/**
 * Campo de texto rico do INOVA — negrito, listas, links —, como os editores do
 * INOVA original. Guarda **Markdown** nas mesmas colunas de texto de sempre:
 * texto puro já é Markdown válido (nada do que está gravado muda de cara), o
 * prompt do chat de IA continua lendo texto, e não precisa de migration.
 *
 * O editor compara o `value` por identidade para não reescrever o que a pessoa
 * está digitando; por isso o `RichDoc` fica em estado aqui, e só é refeito a
 * partir do Markdown quando o valor muda de FORA (o projeto chegou da API).
 */
export function InovaRichTextField({
  value,
  onChange,
  ariaLabel,
  placeholder,
}: {
  value: string
  onChange: (markdown: string) => void
  ariaLabel: string
  placeholder?: string
}) {
  const [doc, setDoc] = useState<RichDoc>(() => markdownToRichDoc(value))
  // Último Markdown conhecido — o que veio do pai ou o que este campo emitiu.
  // É estado, e não ref: ajuste durante o render com ref se perde no render
  // duplo do StrictMode, e o campo abria vazio num projeto já preenchido.
  const [known, setKnown] = useState(value)

  if (value !== known) {
    setKnown(value)
    setDoc(markdownToRichDoc(value))
  }

  return (
    <RichTextEditor
      value={doc}
      ariaLabel={ariaLabel}
      placeholder={placeholder}
      onChange={(next) => {
        const markdown = richDocToMarkdown(next)
        setKnown(markdown)
        setDoc(next)
        onChange(markdown)
      }}
    />
  )
}

/** Leitura do que o `InovaRichTextField` gravou (ou de texto puro antigo). */
export function InovaRichTextView({ text, className }: { text: string | null | undefined; className?: string }) {
  if (!text?.trim()) return null
  return <Markdown content={text} className={className} />
}

/** Markdown → texto corrido, para resumo de card com `line-clamp`. */
export function inovaPlainText(text: string | null | undefined): string {
  return (text ?? '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/(\*\*|__|\*|_|~~|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

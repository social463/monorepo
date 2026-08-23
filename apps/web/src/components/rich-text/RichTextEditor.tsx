import { useEffect, useRef, useState, type ClipboardEvent as ReactClipboardEvent, type ReactNode } from 'react'
import {
  RICH_TEXT_COLORS,
  RICH_TEXT_COLOR_LABELS,
  RICH_TEXT_SIZES,
  isEmptyRichDoc,
  isSafeHref,
  type RichDoc,
  type RichTextColor,
} from '@legends/shared'
import { Icon } from '../Icon'
import { RICH_COLOR_HEX, RICH_SIZE_COMMAND, domToRichDoc, richDocToEditorHtml, sizeAtNode } from './rich-text-dom'

/**
 * Editor de texto rico do Feed Corporativo.
 *
 * `contenteditable` com barra de ferramentas; a cada mudança o DOM é
 * **traduzido** para `RichDoc` (`domToRichDoc`) e é isso que sobe para a API —
 * o HTML do navegador nunca é guardado nem devolvido. O valor é **não
 * controlado** de propósito: reescrever o `innerHTML` a cada tecla derrubaria o
 * cursor para o começo do texto a cada caractere digitado.
 */

/**
 * "legends.com.br" vira "https://legends.com.br". Só o que NÃO traz esquema
 * ganha o prefixo: `javascript:…` passa intacto, e aí é `isSafeHref` que o
 * recusa — prefixar transformaria um esquema proibido em URL válida e o aviso
 * nunca apareceria.
 */
function normalizeHref(raw: string): string {
  const href = raw.trim()
  if (!href) return ''
  if (/^([a-z][a-z0-9+.-]*:|\/|#)/i.test(href)) return href
  return `https://${href}`
}

/** Emojis do popover — os que aparecem em comunicado interno. */
const EMOJIS = [
  '😀', '😁', '😂', '🥳', '😍', '🤩', '😎', '🙌',
  '👏', '👍', '🔥', '✨', '🎉', '💡', '🚀', '💪',
  '❤️', '💚', '🙏', '👀', '✅', '⭐', '🏆', '📌',
  '📈', '📚', '☕', '🌱', '🎯', '📣', '🤝', '🧠',
]

/** Amostra de cor do popover da paleta. */
function Swatch({ color, label, onPick }: { color: RichTextColor; label: string; onPick: () => void }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
      className="h-7 w-7 rounded-md border border-outline-variant/60 transition-transform hover:scale-110"
      style={{ backgroundColor: RICH_COLOR_HEX[color] }}
    />
  )
}

function ToolbarButton({
  icon,
  label,
  onClick,
}: {
  icon: string
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      // `onMouseDown` com preventDefault: sem isso o clique tira o foco do
      // editor e a seleção some antes do comando rodar.
      onMouseDown={(e) => {
        e.preventDefault()
        onClick()
      }}
      className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-primary/10 hover:text-primary"
    >
      <Icon name={icon} className="text-[18px]" />
    </button>
  )
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = 'Escreva o comunicado…',
  ariaLabel = 'Corpo do comunicado',
  onRequestMention,
  toolbarEnd,
}: {
  value: RichDoc
  onChange: (doc: RichDoc) => void
  placeholder?: string
  ariaLabel?: string
  /** Abre o seletor de pessoas do composer; devolve quem foi escolhido. */
  onRequestMention?: () => Promise<{ id: string; name: string } | null>
  /** Encostado à direita da barra — é onde o composer põe o botão de IA. */
  toolbarEnd?: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [empty, setEmpty] = useState(() => isEmptyRichDoc(value))
  // Última seleção feita DENTRO do editor. Os controles da barra tiram o foco
  // daqui (os popovers da barra são botões, e o foco sai do editable), e
  // `focus()` sozinho devolve o cursor para o começo do texto — o comando de
  // formatação cairia no lugar errado, ou em lugar nenhum.
  const savedRange = useRef<Range | null>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkHref, setLinkHref] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  // Guarda o documento que ESTE editor emitiu por último. É o que permite
  // distinguir "o pai me devolveu o meu próprio valor" (não mexe no DOM) de "o
  // pai trocou o conteúdo" — a IA gerando o texto, por exemplo.
  const emitted = useRef<RichDoc | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (emitted.current === value) return
    el.innerHTML = richDocToEditorHtml(value)
    setEmpty(isEmptyRichDoc(value))
  }, [value])

  function emit() {
    const el = ref.current
    if (!el) return
    const doc = domToRichDoc(el)
    emitted.current = doc
    setEmpty(isEmptyRichDoc(doc))
    onChange(doc)
  }

  /**
   * Colar passa pelo mesmo tradutor da saída: o HTML de fora vira `RichDoc` e
   * volta como o HTML fechado do editor. Sem isto, a árvore do Word/Docs/Teams
   * entra crua no `contenteditable` — o que aparecia enquanto se escrevia não
   * era o que ia para o feed, e a estrutura dela nem sempre sobrevive à
   * tradução na hora de salvar.
   */
  function handlePaste(event: ReactClipboardEvent<HTMLDivElement>) {
    const html = event.clipboardData.getData('text/html')
    const plain = event.clipboardData.getData('text/plain')
    if (!html && !plain) return
    event.preventDefault()

    let doc: RichDoc
    if (html) {
      const holder = document.createElement('div')
      holder.innerHTML = html
      // `<script>`/`<style>` colados junto entrariam como TEXTO do comunicado.
      holder.querySelectorAll('script, style, noscript').forEach((n) => n.remove())
      doc = domToRichDoc(holder)
    } else {
      doc = { blocks: plain.split(/\r?\n/).map((linha) => ({ type: 'paragraph', spans: linha ? [{ text: linha }] : [] })) }
    }
    if (doc.blocks.length === 0) return

    ref.current?.focus()
    restoreSelection()
    document.execCommand('insertHTML', false, richDocToEditorHtml(doc))
    rememberSelection()
    emit()
  }

  /** Guarda o intervalo selecionado enquanto ele ainda existe. */
  function rememberSelection() {
    const el = ref.current
    const selection = window.getSelection?.()
    if (!el || !selection || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    if (el.contains(range.commonAncestorContainer)) savedRange.current = range.cloneRange()
  }

  function restoreSelection() {
    const range = savedRange.current
    const selection = window.getSelection?.()
    if (!range || !selection) return
    selection.removeAllRanges()
    selection.addRange(range)
  }

  function exec(command: string, arg?: string) {
    ref.current?.focus()
    restoreSelection()
    document.execCommand('styleWithCSS', false, 'true')
    document.execCommand(command, false, arg)
    // O comando reescreve os nós do intervalo; guardar de novo evita que o
    // próximo clique na barra restaure um Range que já não existe no DOM.
    rememberSelection()
    emit()
  }

  /**
   * Um degrau na escala de tamanho, a partir do tamanho do trecho SELECIONADO
   * — não de um contador da barra. Selecionar um trecho já grande e clicar em
   * A+ tem de continuar de onde ele está.
   */
  function stepSize(delta: number) {
    const el = ref.current
    if (!el) return
    const anchor = savedRange.current?.startContainer ?? window.getSelection?.()?.anchorNode ?? null
    const current = sizeAtNode(anchor, el)
    const index = RICH_TEXT_SIZES.indexOf(current)
    const next = Math.min(RICH_TEXT_SIZES.length - 1, Math.max(0, index + delta))
    if (next === index) return
    exec('fontSize', RICH_SIZE_COMMAND[RICH_TEXT_SIZES[next]])
  }

  function insertEmoji(emoji: string) {
    ref.current?.focus()
    restoreSelection()
    document.execCommand('insertText', false, emoji)
    rememberSelection()
    emit()
  }

  /**
   * Aplica o link do popover. `window.prompt` fazia o trabalho, mas com a cara
   * do navegador ("localhost:5173 diz…") e sem validação — e ele trava a página
   * inteira enquanto está aberto.
   */
  function applyLink() {
    const href = normalizeHref(linkHref)
    if (!isSafeHref(href)) {
      setLinkError('Use um endereço começando com https://, mailto: ou tel:.')
      return
    }
    exec('createLink', href)
    closeLink()
  }

  function closeLink() {
    setLinkOpen(false)
    setLinkHref('')
    setLinkError(null)
  }

  async function insertMention() {
    if (!onRequestMention) return
    const person = await onRequestMention()
    if (!person) return
    ref.current?.focus()
    // `insertHTML` com marcação montada aqui — o nome é escapado pelo próprio
    // `textContent` do span que o navegador cria a partir desta string.
    const safeName = person.name.replace(/</g, '').replace(/>/g, '')
    document.execCommand('insertHTML', false, `<span data-mention-id="${person.id}">${safeName}</span>&nbsp;`)
    emit()
  }

  return (
    <div className="rounded-lg border border-outline-variant/60 focus-within:border-primary">
      <div className="flex flex-wrap items-center gap-1 border-b border-outline-variant/30 px-sm py-1">
        {/* Tamanho vira dois botões (A↓ A↑), como no desenho: a escala é
            discreta (sm→xl) e caminhar por ela é mais rápido do que abrir uma
            lista para escolher um degrau por vez. */}
        <ToolbarButton icon="text_decrease" label="Diminuir texto" onClick={() => stepSize(-1)} />
        <ToolbarButton icon="text_increase" label="Aumentar texto" onClick={() => stepSize(1)} />
        <span className="mx-1 h-5 w-px bg-outline-variant/40" />
        <ToolbarButton icon="format_bold" label="Negrito" onClick={() => exec('bold')} />
        <ToolbarButton icon="format_italic" label="Itálico" onClick={() => exec('italic')} />
        <ToolbarButton icon="format_underlined" label="Sublinhado" onClick={() => exec('underline')} />
        <span className="mx-1 h-5 w-px bg-outline-variant/40" />
        <ToolbarButton icon="format_h2" label="Subtítulo" onClick={() => exec('formatBlock', '<h2>')} />
        <ToolbarButton icon="format_quote" label="Citação" onClick={() => exec('formatBlock', 'blockquote')} />
        <span className="mx-1 h-5 w-px bg-outline-variant/40" />
        <ToolbarButton icon="format_list_bulleted" label="Lista" onClick={() => exec('insertUnorderedList')} />
        <ToolbarButton icon="format_list_numbered" label="Lista numerada" onClick={() => exec('insertOrderedList')} />
        <span className="mx-1 h-5 w-px bg-outline-variant/40" />
        <div className="relative">
          <ToolbarButton
            icon="link"
            label="Inserir link"
            onClick={() => {
              // A seleção some no clique; `rememberSelection` já rodou no
              // `mouseup`/`blur` do editor, e é ela que `applyLink` restaura.
              setLinkError(null)
              setLinkOpen((v) => !v)
            }}
          />
          {linkOpen && (
            <>
              {/* Backdrop invisível para fechar ao clicar fora — mesmo padrão
                  do seletor de reações. */}
              <div className="fixed inset-0 z-10" onClick={closeLink} aria-hidden />
              <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-lg border border-outline-variant/60 bg-surface-container p-md shadow-lg">
                <label htmlFor="rich-link" className="font-label text-label-sm text-on-surface-variant">
                  Endereço do link
                </label>
                <input
                  id="rich-link"
                  autoFocus
                  value={linkHref}
                  onChange={(e) => {
                    setLinkHref(e.target.value)
                    setLinkError(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      applyLink()
                    }
                    if (e.key === 'Escape') closeLink()
                  }}
                  placeholder="https://…"
                  className="mt-xs w-full rounded-md border border-outline-variant/60 bg-surface-container-highest px-3 py-2 text-body-sm text-on-surface outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
                />
                {linkError && (
                  <p role="alert" className="mt-xs font-label text-label-sm text-error">
                    {linkError}
                  </p>
                )}
                <div className="mt-sm flex items-center justify-end gap-sm">
                  <button
                    type="button"
                    onClick={closeLink}
                    className="font-label text-label-md text-on-surface-variant hover:text-on-surface"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={applyLink}
                    disabled={linkHref.trim().length === 0}
                    className="rounded-full bg-primary px-lg py-1 font-label text-label-md font-bold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container-highest disabled:text-on-surface-variant"
                  >
                    Aplicar
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
        {onRequestMention && (
          <ToolbarButton icon="alternate_email" label="Mencionar alguém" onClick={() => void insertMention()} />
        )}
        {/* Paleta num popover, como no desenho: amostras clicáveis dizem a cor
            que vai sair; uma lista de nomes ("Amarelo", "Azul") não diz. */}
        <div className="relative">
          <ToolbarButton
            icon="palette"
            label="Cor do texto"
            onClick={() => {
              setEmojiOpen(false)
              setPaletteOpen((v) => !v)
            }}
          />
          {paletteOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setPaletteOpen(false)} aria-hidden />
              <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-lg border border-outline-variant/60 bg-surface-container p-md shadow-lg">
                <p className="font-label text-label-sm text-on-surface-variant">Cor do texto</p>
                <div className="mt-xs flex flex-wrap gap-xs">
                  {RICH_TEXT_COLORS.map((color) => (
                    <Swatch
                      key={`fg-${color}`}
                      color={color}
                      label={`Texto ${RICH_TEXT_COLOR_LABELS[color]}`}
                      onPick={() => {
                        exec('foreColor', RICH_COLOR_HEX[color])
                        setPaletteOpen(false)
                      }}
                    />
                  ))}
                </div>
                <p className="mt-sm font-label text-label-sm text-on-surface-variant">Preenchimento</p>
                <div className="mt-xs flex flex-wrap gap-xs">
                  {RICH_TEXT_COLORS.map((color) => (
                    <Swatch
                      key={`bg-${color}`}
                      color={color}
                      label={`Preenchimento ${RICH_TEXT_COLOR_LABELS[color]}`}
                      onPick={() => {
                        exec('hiliteColor', RICH_COLOR_HEX[color])
                        setPaletteOpen(false)
                      }}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    exec('foreColor', RICH_COLOR_HEX.default)
                    exec('hiliteColor', 'transparent')
                    setPaletteOpen(false)
                  }}
                  className="mt-sm w-full rounded-md py-1 font-label text-label-md text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface"
                >
                  Remover cor
                </button>
              </div>
            </>
          )}
        </div>

        <div className="relative">
          <ToolbarButton
            icon="mood"
            label="Emoji"
            onClick={() => {
              setPaletteOpen(false)
              setEmojiOpen((v) => !v)
            }}
          />
          {emojiOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setEmojiOpen(false)} aria-hidden />
              <div className="absolute left-0 top-full z-20 mt-1 grid w-64 grid-cols-8 gap-xs rounded-lg border border-outline-variant/60 bg-surface-container p-sm shadow-lg">
                {EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    aria-label={`Inserir ${emoji}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      insertEmoji(emoji)
                      setEmojiOpen(false)
                    }}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-[18px] hover:bg-surface-container-highest"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {toolbarEnd && <div className="ml-auto flex items-center gap-sm">{toolbarEnd}</div>}
      </div>

      <div className="relative">
        {empty && (
          <span className="pointer-events-none absolute left-md top-sm text-body-md text-on-surface-variant">
            {placeholder}
          </span>
        )}
        <div
          ref={ref}
          role="textbox"
          aria-multiline="true"
          aria-label={ariaLabel}
          contentEditable
          suppressContentEditableWarning
          onInput={emit}
          onPaste={handlePaste}
          onKeyUp={rememberSelection}
          onMouseUp={rememberSelection}
          onBlur={() => {
            // Guarda ANTES de emitir: o clique na barra já tirou o foco daqui,
            // e é este Range que `exec` vai restaurar.
            rememberSelection()
            emit()
          }}
          className="min-h-[120px] w-full px-md py-sm text-body-md text-on-surface outline-none [&_blockquote]:border-l-4 [&_blockquote]:border-primary/40 [&_blockquote]:pl-md [&_blockquote]:italic [&_ol]:ml-lg [&_ol]:list-decimal [&_ul]:ml-lg [&_ul]:list-disc"
        />
      </div>
    </div>
  )
}

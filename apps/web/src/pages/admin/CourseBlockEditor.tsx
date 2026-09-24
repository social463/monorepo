/**
 * Editor de blocos da aula (Documento 4, seção 9.1).
 *
 * Antes daqui a aula tinha um formato só, e a tela escolhia entre a URL do
 * vídeo e o texto. Agora a pessoa empilha quantos blocos quiser, em qualquer
 * ordem — que é o que o documento pede com o exemplo do texto seguido de uma
 * imagem.
 *
 * **A ordem se muda por botão, não por arrasto.** O protótipo usa `@dnd-kit`;
 * o repo não tem lib de drag e não vale trazer uma por causa desta tela — mover
 * por ↑/↓ chega ao mesmo lugar, funciona no teclado sem nada a mais e sobrevive
 * ao leitor de tela.
 *
 * Quem valida de verdade é o servidor, pelo mesmo schema Zod que este arquivo
 * usa para tipar (`@legends/shared/course-lesson-block`).
 */

import { useState } from 'react'
import {
  CALLOUT_TONE_LABELS,
  CALLOUT_TONES,
  COURSE_BLOCK_ICONS,
  COURSE_BLOCK_LABELS,
  COURSE_BLOCK_TYPES,
  createEmptyBlock,
  MAX_BLOCKS_PER_LESSON,
  VIDEO_SOURCE_LABELS,
  VIDEO_SOURCES,
  type CourseBlockType,
  type CourseLessonBlock,
} from '@legends/shared'
import { Icon } from '../../components/Icon'
import { Select } from '../../components/Select'
import { uploadFeedMedia, UploadError } from '../../lib/upload'

const inputCls =
  'rounded-md border border-outline-variant/60 bg-surface-container-highest px-3 py-2 text-body-sm outline-none transition-all focus:border-primary focus:ring-2 focus:ring-primary/30'

/** Id só precisa ser único dentro da aula — o servidor não o usa como chave. */
function newBlockId(): string {
  return `blk_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
}

export function CourseBlockEditor({
  blocks,
  onChange,
  quizzes,
}: {
  blocks: CourseLessonBlock[]
  onChange: (blocks: CourseLessonBlock[]) => void
  quizzes: { id: string; title: string }[]
}) {
  const [menuOpen, setMenuOpen] = useState(false)

  const patch = (id: string, changes: Partial<CourseLessonBlock>) =>
    onChange(blocks.map((b) => (b.id === id ? ({ ...b, ...changes } as CourseLessonBlock) : b)))

  const remove = (id: string) => onChange(blocks.filter((b) => b.id !== id))

  const move = (index: number, delta: number) => {
    const destino = index + delta
    if (destino < 0 || destino >= blocks.length) return
    const proximos = [...blocks]
    const [item] = proximos.splice(index, 1)
    proximos.splice(destino, 0, item)
    onChange(proximos)
  }

  const add = (type: CourseBlockType) => {
    onChange([...blocks, createEmptyBlock(type, newBlockId())])
    setMenuOpen(false)
  }

  const cheio = blocks.length >= MAX_BLOCKS_PER_LESSON

  return (
    <div className="flex flex-col gap-sm">
      <ul className="flex flex-col gap-sm">
        {blocks.map((block, index) => (
          <li
            key={block.id}
            className="flex items-start gap-sm rounded-md border border-outline-variant/40 bg-surface-container p-sm"
          >
            <span className="mt-1.5 flex items-center gap-1 text-on-surface-variant">
              <Icon name={COURSE_BLOCK_ICONS[block.type]} className="text-[18px] text-primary" />
            </span>

            <div className="min-w-0 flex-1">
              <BlockFields
                block={block}
                quizzes={quizzes}
                onPatch={(changes) => patch(block.id, changes)}
              />
            </div>

            <div className="flex shrink-0 flex-col">
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label={`Mover ${COURSE_BLOCK_LABELS[block.type]} para cima`}
                className="rounded-full p-1 text-on-surface-variant hover:text-primary disabled:opacity-30"
              >
                <Icon name="keyboard_arrow_up" className="text-[18px]" />
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === blocks.length - 1}
                aria-label={`Mover ${COURSE_BLOCK_LABELS[block.type]} para baixo`}
                className="rounded-full p-1 text-on-surface-variant hover:text-primary disabled:opacity-30"
              >
                <Icon name="keyboard_arrow_down" className="text-[18px]" />
              </button>
              <button
                type="button"
                onClick={() => remove(block.id)}
                aria-label={`Remover ${COURSE_BLOCK_LABELS[block.type]}`}
                className="rounded-full p-1 text-on-surface-variant hover:text-error"
              >
                <Icon name="delete" className="text-[18px]" />
              </button>
            </div>
          </li>
        ))}
      </ul>

      {blocks.length === 0 && (
        <p className="text-body-sm italic text-on-surface-variant">
          Nenhum bloco ainda. Use “Adicionar bloco” para montar a aula.
        </p>
      )}

      {menuOpen ? (
        <div className="grid grid-cols-3 gap-1 rounded-md border border-outline-variant/40 bg-surface-container-low p-sm sm:grid-cols-5">
          {COURSE_BLOCK_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => add(type)}
              className="flex flex-col items-center gap-1 rounded-md border border-outline-variant/40 p-sm text-label-sm text-on-surface transition-colors hover:border-primary hover:text-primary"
            >
              <Icon name={COURSE_BLOCK_ICONS[type]} className="text-[18px] text-primary" />
              {COURSE_BLOCK_LABELS[type]}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setMenuOpen(false)}
            className="col-span-full mt-1 text-label-sm text-on-surface-variant hover:text-on-surface"
          >
            Fechar
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          disabled={cheio}
          className="inline-flex w-fit items-center gap-xs rounded-md border border-dashed border-outline-variant/60 px-md py-sm font-label text-label-md text-on-surface-variant hover:border-primary hover:text-primary disabled:opacity-50"
        >
          <Icon name="add" className="text-[18px]" /> Adicionar bloco
        </button>
      )}

      {cheio && (
        <p className="text-body-sm text-on-surface-variant">
          Esta aula chegou ao limite de {MAX_BLOCKS_PER_LESSON} blocos.
        </p>
      )}
    </div>
  )
}

/** Campo de arquivo: sobe pela mesma rota do anexo do feed e guarda a URL pública. */
function UploadField({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (url: string) => void
  label: string
}) {
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function handle(file: File | undefined) {
    if (!file) return
    setErro(null)
    setEnviando(true)
    try {
      const anexo = await uploadFeedMedia(file)
      onChange(anexo.url)
    } catch (err) {
      setErro(err instanceof UploadError ? err.message : 'Não foi possível enviar o arquivo.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-sm">
        <label className="inline-flex cursor-pointer items-center gap-xs rounded-md border border-outline-variant/60 px-md py-1.5 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary">
          <Icon name="upload" className="text-[16px]" />
          {enviando ? 'Enviando…' : label}
          <input
            type="file"
            className="hidden"
            disabled={enviando}
            onChange={(event) => void handle(event.target.files?.[0])}
          />
        </label>
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="ou cole a URL"
          className={`${inputCls} min-w-0 flex-1`}
        />
      </div>
      {erro && <p className="text-body-sm text-error">{erro}</p>}
    </div>
  )
}

function BlockFields({
  block,
  quizzes,
  onPatch,
}: {
  block: CourseLessonBlock
  quizzes: { id: string; title: string }[]
  onPatch: (changes: Partial<CourseLessonBlock>) => void
}) {
  const patch = onPatch as (changes: Record<string, unknown>) => void

  switch (block.type) {
    case 'heading':
      return (
        <div className="flex items-center gap-sm">
          <div className="w-24 shrink-0">
            <Select
              ariaLabel="Nível do título"
              value={String(block.level)}
              options={[
                { value: '1', label: 'H1' },
                { value: '2', label: 'H2' },
                { value: '3', label: 'H3' },
              ]}
              onChange={(next) => patch({ level: Number(next) })}
            />
          </div>
          <input
            value={block.text}
            onChange={(event) => patch({ text: event.target.value })}
            placeholder="Texto do título"
            aria-label="Texto do título"
            className={`${inputCls} min-w-0 flex-1 font-bold`}
          />
        </div>
      )

    case 'text':
      return (
        <textarea
          value={block.text}
          onChange={(event) => patch({ text: event.target.value })}
          rows={4}
          placeholder="Escreva o conteúdo da aula…"
          aria-label="Texto"
          className={`${inputCls} w-full`}
        />
      )

    case 'checklist':
      return (
        <div className="flex flex-col gap-1">
          {block.items.map((item, i) => (
            <div key={i} className="flex items-center gap-sm">
              <input
                type="checkbox"
                checked={item.done}
                aria-label={`Item ${i + 1} marcado`}
                onChange={(event) => {
                  const items = [...block.items]
                  items[i] = { ...item, done: event.target.checked }
                  patch({ items })
                }}
              />
              <input
                value={item.text}
                onChange={(event) => {
                  const items = [...block.items]
                  items[i] = { ...item, text: event.target.value }
                  patch({ items })
                }}
                placeholder="Item da lista"
                aria-label={`Texto do item ${i + 1}`}
                className={`${inputCls} min-w-0 flex-1`}
              />
              <button
                type="button"
                onClick={() => patch({ items: block.items.filter((_, x) => x !== i) })}
                aria-label={`Remover item ${i + 1}`}
                className="rounded-full p-1 text-on-surface-variant hover:text-error"
              >
                <Icon name="close" className="text-[16px]" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => patch({ items: [...block.items, { text: '', done: false }] })}
            className="inline-flex w-fit items-center gap-1 text-label-sm text-primary hover:underline"
          >
            <Icon name="add" className="text-[16px]" /> Item
          </button>
        </div>
      )

    case 'image':
      return (
        <div className="flex flex-col gap-sm">
          <UploadField value={block.url} onChange={(url) => patch({ url })} label="Enviar imagem" />
          <input
            value={block.caption ?? ''}
            onChange={(event) => patch({ caption: event.target.value })}
            placeholder="Legenda (opcional)"
            aria-label="Legenda da imagem"
            className={inputCls}
          />
        </div>
      )

    case 'video':
      return (
        <div className="flex flex-col gap-sm">
          <div className="w-40">
            <Select
              ariaLabel="Origem do vídeo"
              value={block.source}
              options={VIDEO_SOURCES.map((s) => ({ value: s, label: VIDEO_SOURCE_LABELS[s] }))}
              onChange={(next) => patch({ source: next })}
            />
          </div>
          {block.source === 'upload' ? (
            <UploadField value={block.url} onChange={(url) => patch({ url })} label="Enviar vídeo" />
          ) : (
            <input
              value={block.url}
              onChange={(event) => patch({ url: event.target.value })}
              placeholder="Cole a URL do vídeo"
              aria-label="URL do vídeo"
              className={inputCls}
            />
          )}
        </div>
      )

    case 'pdf':
      return (
        <div className="flex flex-col gap-sm">
          <input
            value={block.title ?? ''}
            onChange={(event) => patch({ title: event.target.value })}
            placeholder="Título do PDF (opcional)"
            aria-label="Título do PDF"
            className={inputCls}
          />
          <UploadField value={block.url} onChange={(url) => patch({ url })} label="Enviar PDF" />
        </div>
      )

    case 'callout':
      return (
        <div className="flex flex-col gap-sm">
          <div className="w-44">
            <Select
              ariaLabel="Tom do destaque"
              value={block.tone}
              options={CALLOUT_TONES.map((t) => ({ value: t, label: CALLOUT_TONE_LABELS[t] }))}
              onChange={(next) => patch({ tone: next })}
            />
          </div>
          <textarea
            value={block.text}
            onChange={(event) => patch({ text: event.target.value })}
            rows={2}
            placeholder="Mensagem em destaque"
            aria-label="Texto do destaque"
            className={inputCls}
          />
        </div>
      )

    case 'quote':
      return (
        <div className="flex flex-col gap-sm border-l-4 border-primary/40 pl-sm">
          <textarea
            value={block.text}
            onChange={(event) => patch({ text: event.target.value })}
            rows={2}
            placeholder="Citação"
            aria-label="Texto da citação"
            className={inputCls}
          />
          <input
            value={block.author ?? ''}
            onChange={(event) => patch({ author: event.target.value })}
            placeholder="— Autor (opcional)"
            aria-label="Autor da citação"
            className={inputCls}
          />
        </div>
      )

    case 'code':
      return (
        <div className="flex flex-col gap-sm">
          <input
            value={block.language ?? ''}
            onChange={(event) => patch({ language: event.target.value })}
            placeholder="Linguagem (ex.: ts)"
            aria-label="Linguagem do código"
            className={inputCls}
          />
          <textarea
            value={block.code}
            onChange={(event) => patch({ code: event.target.value })}
            rows={5}
            placeholder="// código"
            aria-label="Código"
            className={`${inputCls} font-mono`}
          />
        </div>
      )

    case 'divider':
      return <hr className="my-2 border-outline-variant/60" />

    case 'button':
      return (
        <div className="flex flex-col gap-sm sm:flex-row">
          <input
            value={block.label}
            onChange={(event) => patch({ label: event.target.value })}
            placeholder="Texto do botão"
            aria-label="Texto do botão"
            className={`${inputCls} min-w-0 flex-1`}
          />
          <input
            value={block.url}
            onChange={(event) => patch({ url: event.target.value })}
            placeholder="https://…"
            aria-label="Link do botão"
            className={`${inputCls} min-w-0 flex-1`}
          />
        </div>
      )

    case 'link':
      return (
        <div className="flex flex-col gap-sm">
          <input
            value={block.title}
            onChange={(event) => patch({ title: event.target.value })}
            placeholder="Título do link"
            aria-label="Título do link"
            className={inputCls}
          />
          <input
            value={block.url}
            onChange={(event) => patch({ url: event.target.value })}
            placeholder="https://…"
            aria-label="URL do link"
            className={inputCls}
          />
          <input
            value={block.description ?? ''}
            onChange={(event) => patch({ description: event.target.value })}
            placeholder="Descrição (opcional)"
            aria-label="Descrição do link"
            className={inputCls}
          />
        </div>
      )

    case 'attachment':
      return (
        <div className="flex flex-col gap-sm">
          <input
            value={block.name}
            onChange={(event) => patch({ name: event.target.value })}
            placeholder="Nome do arquivo"
            aria-label="Nome do anexo"
            className={inputCls}
          />
          <UploadField value={block.url} onChange={(url) => patch({ url })} label="Enviar anexo" />
        </div>
      )

    case 'quiz':
      return (
        <div className="flex flex-col gap-1">
          <Select
            ariaLabel="Quiz da aula"
            value={block.quizId ?? ''}
            placeholder="— selecionar quiz —"
            options={quizzes.map((q) => ({ value: q.id, label: q.title }))}
            onChange={(next) => patch({ quizId: next || null })}
          />
          <p className="text-body-sm text-on-surface-variant">
            {quizzes.length === 0
              ? 'Este curso ainda não tem quiz. Crie um na aba de avaliações.'
              : 'O bloco aponta para um quiz existente — ele não cria uma segunda nota.'}
          </p>
        </div>
      )
  }
}

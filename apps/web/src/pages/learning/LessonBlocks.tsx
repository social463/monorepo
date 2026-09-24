/**
 * Renderização dos blocos da aula para o aluno (Documento 4, seção 9.1).
 *
 * Contrapartida do `CourseBlockEditor`. Duas coisas que valem saber:
 *
 * - **Não há `dangerouslySetInnerHTML` aqui.** O `contentHtml` antigo era
 *   injetado como marcação; o bloco de texto é texto, renderizado com
 *   `whitespace-pre-wrap`. A superfície de XSS da aula deixou de existir, e o
 *   que sobrou de risco (`href`/`src`) está fechado pela allowlist de protocolo
 *   no schema compartilhado.
 * - **O checklist é do aluno, não do curso.** Marcar um item é estado local da
 *   sessão — não volta para a API nem conta progresso. O que conta progresso
 *   continua sendo concluir a aula.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toVideoEmbedUrl, type CalloutTone, type CourseLessonBlock } from '@legends/shared'
import { Icon } from '../../components/Icon'

const TONE_STYLE: Record<CalloutTone, { box: string; icon: string }> = {
  info: { box: 'border-primary/40 bg-primary/5 text-on-surface', icon: 'lightbulb' },
  success: { box: 'border-tertiary/40 bg-tertiary/5 text-on-surface', icon: 'check_circle' },
  warning: { box: 'border-secondary/50 bg-secondary/5 text-on-surface', icon: 'warning' },
  danger: { box: 'border-error/40 bg-error/5 text-on-surface', icon: 'local_fire_department' },
}

/** YouTube, Vimeo e afins entram em iframe; arquivo direto vira `<video>`. */
function isEmbeddable(url: string): boolean {
  return toVideoEmbedUrl(url) !== url.trim()
}

function ChecklistView({ items }: { items: { text: string; done: boolean }[] }) {
  const [marcados, setMarcados] = useState(() => items.map((item) => item.done))
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item, i) => (
        <li key={i}>
          <button
            type="button"
            onClick={() => setMarcados((atual) => atual.map((v, x) => (x === i ? !v : v)))}
            className="flex w-full items-start gap-sm text-left text-body-md text-on-surface-variant hover:text-on-surface"
          >
            <Icon
              name={marcados[i] ? 'check_box' : 'check_box_outline_blank'}
              className={`text-[18px] ${marcados[i] ? 'text-primary' : 'text-on-surface-variant'}`}
            />
            <span className={marcados[i] ? 'line-through opacity-70' : undefined}>{item.text}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function BlockView({ block }: { block: CourseLessonBlock }) {
  switch (block.type) {
    case 'heading': {
      const cls =
        block.level === 1
          ? 'font-headline text-headline-sm'
          : block.level === 2
            ? 'font-headline text-title-lg'
            : 'font-label text-title-md'
      const Tag = block.level === 1 ? 'h3' : block.level === 2 ? 'h4' : 'h5'
      return <Tag className={`${cls} text-on-surface`}>{block.text}</Tag>
    }

    case 'text':
      return (
        <p className="whitespace-pre-wrap text-body-md text-on-surface-variant">{block.text}</p>
      )

    case 'checklist':
      return <ChecklistView items={block.items} />

    case 'image':
      return (
        <figure className="overflow-hidden rounded-lg border border-outline-variant/30">
          <img src={block.url} alt={block.caption ?? ''} className="w-full" />
          {block.caption && (
            <figcaption className="p-sm text-center text-body-sm text-on-surface-variant">
              {block.caption}
            </figcaption>
          )}
        </figure>
      )

    case 'video':
      return isEmbeddable(block.url) ? (
        <div className="aspect-video overflow-hidden rounded-lg bg-black">
          <iframe
            src={toVideoEmbedUrl(block.url)}
            title="Vídeo da aula"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
            allowFullScreen
            className="h-full w-full"
          />
        </div>
      ) : (
        <video src={block.url} controls className="w-full rounded-lg bg-black">
          <track kind="captions" />
        </video>
      )

    case 'pdf':
      return (
        <div className="overflow-hidden rounded-lg border border-outline-variant/30">
          <div className="flex flex-wrap items-center justify-between gap-sm bg-surface-container-highest p-sm">
            <span className="inline-flex items-center gap-xs font-label text-label-md text-on-surface">
              <Icon name="picture_as_pdf" className="text-[18px] text-error" />
              {block.title || 'Documento PDF'}
            </span>
            <a
              href={block.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-xs rounded-full bg-primary px-md py-1.5 font-label text-label-sm text-on-primary"
            >
              <Icon name="open_in_new" className="text-[16px]" /> Abrir
            </a>
          </div>
          {/* O navegador renderiza PDF nativamente — nada de visualizador de
              terceiro, que mandaria a URL do material para fora. */}
          <iframe src={block.url} title={block.title || 'PDF'} className="h-[32rem] w-full" />
        </div>
      )

    case 'callout': {
      const tom = TONE_STYLE[block.tone]
      return (
        <div className={`flex items-start gap-sm rounded-lg border p-md ${tom.box}`}>
          <Icon name={tom.icon} className="mt-0.5 shrink-0 text-[18px]" />
          <p className="whitespace-pre-wrap text-body-md">{block.text}</p>
        </div>
      )
    }

    case 'quote':
      return (
        <blockquote className="border-l-4 border-primary/40 pl-md">
          <p className="text-body-md italic text-on-surface-variant">{block.text}</p>
          {block.author && (
            <footer className="mt-xs text-body-sm text-on-surface-variant">— {block.author}</footer>
          )}
        </blockquote>
      )

    case 'code':
      return (
        <pre className="overflow-x-auto rounded-lg bg-surface-container-highest p-md text-body-sm">
          <code className="font-mono text-on-surface">{block.code}</code>
        </pre>
      )

    case 'divider':
      return <hr className="border-outline-variant/50" />

    case 'button':
      return (
        <a
          href={block.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex w-fit items-center gap-xs rounded-full bg-primary px-lg py-sm font-label text-label-md text-on-primary"
        >
          {block.label}
          <Icon name="open_in_new" className="text-[16px]" />
        </a>
      )

    case 'link':
      return (
        <a
          href={block.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-start gap-sm rounded-lg border border-outline-variant/30 p-md transition-colors hover:border-primary"
        >
          <Icon name="link" className="mt-0.5 shrink-0 text-[18px] text-primary" />
          <span className="min-w-0">
            <span className="block truncate font-label text-label-md text-on-surface">
              {block.title || block.url}
            </span>
            {block.description && (
              <span className="block text-body-sm text-on-surface-variant">{block.description}</span>
            )}
          </span>
        </a>
      )

    case 'attachment':
      return (
        <a
          href={block.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-sm rounded-lg border border-outline-variant/30 p-md transition-colors hover:border-primary"
        >
          <Icon name="attach_file" className="text-[18px] text-primary" />
          <span className="min-w-0 flex-1 truncate text-body-md text-on-surface">
            {block.name || 'Anexo'}
          </span>
          <Icon name="download" className="text-[16px] text-on-surface-variant" />
        </a>
      )

    case 'quiz':
      if (!block.quizId) return null
      return (
        <Link
          to={`/aprendizado/quiz/${block.quizId}`}
          className="inline-flex w-fit items-center gap-xs rounded-full bg-surface-container-highest px-lg py-sm font-label text-label-md text-primary hover:underline"
        >
          <Icon name="quiz" className="text-[18px]" /> Fazer o quiz
        </Link>
      )
  }
}

export function LessonBlocks({ blocks }: { blocks: CourseLessonBlock[] }) {
  return (
    <div className="flex flex-col gap-md">
      {blocks.map((block) => (
        <BlockView key={block.id} block={block} />
      ))}
    </div>
  )
}

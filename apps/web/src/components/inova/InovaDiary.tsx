import { useRef, useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import type { InovaDiaryEntryDTO } from '@legends/shared'
import { Icon } from '../Icon'
import { InovaDialog } from './InovaDialog'
import { InovaRichTextField, InovaRichTextView } from './InovaRichText'
import { ApiError } from '../../lib/api'
import { addInovaDiaryEntry, deleteInovaDiaryEntry, uploadInovaDiaryEvidence } from '../../lib/inova-api'

type DiaryFilter = 'all' | 'MANUAL' | 'AUTOMATIC'

const FILTERS: { value: DiaryFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'MANUAL', label: 'Manuais' },
  { value: 'AUTOMATIC', label: 'Automáticos' },
]

const inputCls = 'w-full rounded-md border border-outline-variant/60 bg-surface px-md py-sm text-body-md text-on-surface'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR')
}

function isVideoFile(url: string): boolean {
  return /\.(mp4|webm)(\?|#|$)/i.test(url)
}

/**
 * Player embutido para YouTube e Loom — os dois liberados no `frame-src` do
 * nginx. O resto vira link.
 */
function videoEmbedUrl(url: string): string | null {
  const youtube = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/)
  if (youtube) return `https://www.youtube-nocookie.com/embed/${youtube[1]}`
  const loom = url.match(/loom\.com\/(?:share|embed)\/([a-zA-Z0-9]+)/)
  if (loom) return `https://www.loom.com/embed/${loom[1]}`
  return null
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function EvidenceVideo({ url }: { url: string }) {
  const embed = videoEmbedUrl(url)
  if (embed) {
    return (
      <div className="aspect-video overflow-hidden rounded-lg border border-outline-variant/40">
        <iframe src={embed} title="Vídeo do diário de bordo" className="h-full w-full" allowFullScreen allow="encrypted-media" />
      </div>
    )
  }
  if (isVideoFile(url)) {
    return <video src={url} controls preload="metadata" className="max-h-80 w-full rounded-lg border border-outline-variant/40" />
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-xs break-all text-body-sm text-primary underline">
      <Icon name="videocam" className="text-[16px]" />
      {url}
    </a>
  )
}

/** Lista de links editável do formulário (vídeos, links externos). */
function LinkListField({
  label,
  icon,
  placeholder,
  links,
  onChange,
}: {
  label: string
  icon: string
  placeholder: string
  links: string[]
  onChange: (links: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  function add() {
    const value = draft.trim()
    if (!value) return
    if (!isHttpUrl(value)) {
      setError('Informe um link completo, começando com https://')
      return
    }
    onChange([...links, value])
    setDraft('')
    setError(null)
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="flex items-center gap-xs font-label text-label-sm text-on-surface-variant">
        <Icon name={icon} className="text-[14px]" />
        {label}
      </span>
      <div className="flex gap-sm">
        <input
          aria-label={label}
          type="url"
          inputMode="url"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          placeholder={placeholder}
          className={inputCls}
        />
        <button
          type="button"
          onClick={add}
          aria-label={`Adicionar ${label.toLowerCase()}`}
          className="flex shrink-0 items-center rounded-md border border-outline-variant/60 px-sm text-on-surface-variant hover:border-primary/60 hover:text-primary"
        >
          <Icon name="add" className="text-[18px]" />
        </button>
      </div>
      {error && <p className="text-body-sm text-error">{error}</p>}
      {links.length > 0 && (
        <ul className="flex flex-col gap-1">
          {links.map((link, i) => (
            <li key={`${link}-${i}`} className="flex items-center gap-xs rounded bg-surface-container-high px-sm py-1 text-body-sm text-on-surface-variant">
              <span className="min-w-0 flex-1 truncate">{link}</span>
              <button
                type="button"
                onClick={() => onChange(links.filter((_, j) => j !== i))}
                aria-label={`Remover ${link}`}
                className="shrink-0 hover:text-error"
              >
                <Icon name="close" className="text-[14px]" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Diário de bordo do projeto, no formato do INOVA original: lista com filtro
 * Todos/Manuais/Automáticos e "Nova entrada" em modal com o que foi feito,
 * aprendizados, ferramentas, imagens/vídeos enviados e links. As entradas
 * automáticas (tarefa criada/movida, fase alterada) quem escreve é a API.
 */
export function InovaDiary({
  projectId,
  entries,
  currentUserId,
  canManageProject,
  onChanged,
}: {
  projectId: string
  entries: InovaDiaryEntryDTO[]
  currentUserId: string | undefined
  canManageProject: boolean
  onChanged: () => void
}) {
  const [filter, setFilter] = useState<DiaryFilter>('all')
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [learnings, setLearnings] = useState('')
  const [tools, setTools] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [videoLinks, setVideoLinks] = useState<string[]>([])
  const [externalLinks, setExternalLinks] = useState<string[]>([])
  const [formError, setFormError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  function reset() {
    setTitle('')
    setDescription('')
    setLearnings('')
    setTools('')
    setFiles([])
    setVideoLinks([])
    setExternalLinks([])
    setFormError(null)
  }

  const add = useMutation({
    mutationFn: async () => {
      const imageUrls: string[] = []
      const uploadedVideos: string[] = []
      for (const file of files) {
        const url = await uploadInovaDiaryEvidence(file)
        if (file.type.startsWith('video/')) uploadedVideos.push(url)
        else imageUrls.push(url)
      }
      return addInovaDiaryEntry(projectId, {
        title: title.trim(),
        description: description.trim() || undefined,
        learnings: learnings.trim() || undefined,
        tools: tools.trim() || undefined,
        imageUrls,
        videoLinks: [...uploadedVideos, ...videoLinks],
        externalLinks,
      })
    },
    onSuccess: () => {
      reset()
      setOpen(false)
      onChanged()
    },
    onError: (err) =>
      setFormError(err instanceof ApiError ? err.message : 'Não foi possível salvar a entrada. Tente de novo em alguns instantes.'),
  })

  const remove = useMutation({
    mutationFn: (entryId: string) => deleteInovaDiaryEntry(entryId),
    onSuccess: () => {
      setError(null)
      onChanged()
    },
    onError: () => setError('Não foi possível excluir a entrada do diário. Tente de novo em alguns instantes.'),
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim() || !description.trim()) {
      setFormError('Preencha título e descrição.')
      return
    }
    add.mutate()
  }

  const visible = filter === 'all' ? entries : entries.filter((e) => e.entryType === filter)

  return (
    <div className="flex flex-col gap-md">
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <div role="group" aria-label="Filtrar diário" className="flex rounded-full bg-surface-container-high p-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              aria-pressed={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={`rounded-full px-md py-1 text-body-sm ${
                filter === f.value ? 'bg-primary font-medium text-on-primary' : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            reset()
            setOpen(true)
          }}
          className="inline-flex items-center gap-xs rounded-full bg-primary px-md py-xs font-label text-label-md font-bold text-on-primary"
        >
          <Icon name="add" className="text-[18px]" />
          Nova entrada
        </button>
      </div>

      {error && (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      )}

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-xs py-lg text-center">
          <Icon name="menu_book" className="text-[32px] text-outline-variant" />
          <p className="text-body-sm text-on-surface-variant">
            {filter === 'all'
              ? 'Nenhuma entrada no diário ainda.'
              : `Nenhuma entrada ${filter === 'MANUAL' ? 'manual' : 'automática'} encontrada.`}
          </p>
          <p className="text-body-sm text-on-surface-variant">Registre os aprendizados e a evolução do projeto.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-sm">
          {visible.map((entry) => {
            const automatic = entry.entryType === 'AUTOMATIC'
            const uploadedVideos = entry.imageUrls.filter(isVideoFile)
            const images = entry.imageUrls.filter((url) => !isVideoFile(url))
            return (
              <li
                key={entry.id}
                className={`rounded-xl border p-md ${automatic ? 'border-primary/20 bg-primary/5' : 'border-outline-variant/40 bg-surface'}`}
              >
                <div className="flex items-start justify-between gap-sm">
                  <div className="flex min-w-0 flex-wrap items-center gap-xs">
                    {automatic && <Icon name="bolt" className="text-[16px] text-primary" />}
                    <h3 className="break-words font-label text-label-md font-bold text-on-surface">{entry.title}</h3>
                    {automatic && (
                      <span className="rounded-full bg-primary/10 px-xs text-[10px] font-medium text-primary">Automático</span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-xs">
                    <span className="inline-flex items-center gap-0.5 text-[11px] text-on-surface-variant">
                      <Icon name="event" className="text-[12px]" />
                      {formatDate(entry.occurredAt)}
                    </span>
                    {(canManageProject || entry.createdById === currentUserId) && (
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm('Excluir esta entrada do diário?')) remove.mutate(entry.id)
                        }}
                        disabled={remove.isPending}
                        aria-label={`Excluir entrada ${entry.title}`}
                        title="Excluir entrada"
                        className="flex h-7 w-7 items-center justify-center rounded-full text-on-surface-variant hover:bg-error/10 hover:text-error disabled:opacity-60"
                      >
                        <Icon name="delete" className="text-[16px]" />
                      </button>
                    )}
                  </div>
                </div>
                {!automatic && <p className="mt-0.5 text-[11px] text-on-surface-variant">por {entry.createdByName}</p>}
                {entry.description && <InovaRichTextView text={entry.description} className="mt-xs" />}
                {entry.learnings && (
                  <div className="mt-xs">
                    <p className="font-label text-label-sm font-medium text-primary">Aprendizado</p>
                    <InovaRichTextView text={entry.learnings} />
                  </div>
                )}
                {entry.tools && (
                  <p className="mt-xs flex items-center gap-xs text-body-sm text-on-surface-variant">
                    <Icon name="build" className="text-[14px] text-primary" />
                    {entry.tools}
                  </p>
                )}
                {images.length > 0 && (
                  <div className="mt-sm flex flex-wrap gap-sm">
                    {images.map((url) => (
                      <a key={url} href={url} target="_blank" rel="noreferrer">
                        <img
                          src={url}
                          alt="Evidência do diário de bordo"
                          loading="lazy"
                          className="h-20 w-20 rounded-lg border border-outline-variant/40 object-cover hover:border-primary"
                        />
                      </a>
                    ))}
                  </div>
                )}
                {[...uploadedVideos, ...entry.videoLinks].length > 0 && (
                  <div className="mt-sm flex flex-col gap-sm">
                    {[...uploadedVideos, ...entry.videoLinks].map((url) => (
                      <EvidenceVideo key={url} url={url} />
                    ))}
                  </div>
                )}
                {entry.externalLinks.length > 0 && (
                  <ul className="mt-sm flex flex-col gap-1">
                    {entry.externalLinks.map((url) => (
                      <li key={url}>
                        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-xs break-all text-body-sm text-primary underline">
                          <Icon name="open_in_new" className="text-[14px]" />
                          {url}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <InovaDialog open={open} title="Nova entrada no diário" onClose={() => setOpen(false)}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-md">
          <label className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Título *</span>
            <input
              aria-label="Título da entrada"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex.: Teste do primeiro protótipo…"
              className={inputCls}
              autoFocus
            />
          </label>
          <div className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Descrição *</span>
            <InovaRichTextField
              ariaLabel="Descrição da entrada"
              value={description}
              onChange={setDescription}
              placeholder="O que foi feito…"
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Aprendizados</span>
            <InovaRichTextField ariaLabel="Aprendizados" value={learnings} onChange={setLearnings} placeholder="O que aprendemos…" />
          </div>
          <label className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Ferramentas utilizadas</span>
            <input
              aria-label="Ferramentas utilizadas"
              value={tools}
              onChange={(e) => setTools(e.target.value)}
              placeholder="Ex.: ChatGPT, n8n, Python…"
              className={inputCls}
            />
          </label>

          <div className="flex flex-col gap-1">
            <span className="flex items-center gap-xs font-label text-label-sm text-on-surface-variant">
              <Icon name="image" className="text-[14px]" />
              Imagens, prints ou vídeos
            </span>
            <input
              ref={fileInput}
              aria-label="Evidência"
              type="file"
              accept="image/*,video/mp4,video/webm"
              multiple
              className="hidden"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? [])
                if (picked.length > 0) setFiles((current) => [...current, ...picked])
                e.target.value = ''
              }}
            />
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="flex items-center justify-center gap-xs rounded-md border border-dashed border-outline-variant px-md py-sm text-body-sm text-on-surface-variant hover:border-primary/60 hover:text-primary"
            >
              <Icon name="upload" className="text-[16px]" />
              Enviar arquivos
            </button>
            {files.length > 0 && (
              <ul className="flex flex-col gap-1">
                {files.map((file, i) => (
                  <li key={`${file.name}-${i}`} className="flex items-center gap-xs rounded bg-surface-container-high px-sm py-1 text-body-sm text-on-surface-variant">
                    <Icon name={file.type.startsWith('video/') ? 'movie' : 'image'} className="text-[14px]" />
                    <span className="min-w-0 flex-1 truncate">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => setFiles((current) => current.filter((_, j) => j !== i))}
                      aria-label={`Remover ${file.name}`}
                      className="shrink-0 hover:text-error"
                    >
                      <Icon name="close" className="text-[14px]" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <LinkListField
            label="Links de vídeo"
            icon="videocam"
            placeholder="YouTube, Loom…"
            links={videoLinks}
            onChange={setVideoLinks}
          />
          <LinkListField
            label="Links externos"
            icon="link"
            placeholder="https://…"
            links={externalLinks}
            onChange={setExternalLinks}
          />

          {formError && (
            <p role="alert" className="text-body-sm text-error">
              {formError}
            </p>
          )}
          <button
            type="submit"
            disabled={add.isPending}
            className="rounded-full bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
          >
            {add.isPending ? 'Salvando…' : 'Salvar entrada'}
          </button>
        </form>
      </InovaDialog>
    </div>
  )
}

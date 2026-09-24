import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { canAdminister, type InovaGuiaVideoDTO } from '@legends/shared'
import { useAuth } from '../../../../auth/AuthContext'
import { Icon } from '../../../../components/Icon'
import {
  createInovaGuiaVideoCard,
  deleteInovaGuiaVideo,
  listInovaGuiaVideos,
  patchInovaGuiaVideo,
  uploadInovaGuiaVideo,
  type InovaGuiaVideoPatch,
} from '../../../../lib/inova-api'
import { SectionHeading } from '../components/SectionHeading'
import { areaName } from '../content/library'
import { videos } from '../content/videos'
import { cx } from '../lib/cx'

interface CardItem {
  id: string
  title: string
  description: string
  category: string
  duration: string
  behavior: string
  area: string
  videoUrl: string | null
  isCustom: boolean
}

/** Funde o catálogo estático (Task 2) com as sobrescritas gravadas no banco — mesmo merge do projeto original. */
function mergeVideos(rows: InovaGuiaVideoDTO[]): CardItem[] {
  const rowById = new Map(rows.map((row) => [row.videoId, row]))
  const fromCatalog: CardItem[] = videos.map((v) => {
    const row = rowById.get(v.id)
    return {
      id: v.id,
      title: row?.title ?? v.title,
      description: row?.description ?? v.description,
      category: row?.category ?? v.category,
      duration: row?.duration ?? v.duration,
      behavior: row?.behavior ?? v.behavior,
      area: areaName(v.area),
      videoUrl: row?.videoUrl ?? null,
      isCustom: false,
    }
  })
  const fromCustomRows: CardItem[] = rows
    .filter((row) => !videos.some((v) => v.id === row.videoId))
    .map((row) => ({
      id: row.videoId,
      title: row.title ?? 'Novo vídeo',
      description: row.description ?? '',
      category: row.category ?? 'Vídeo',
      duration: row.duration ?? '',
      behavior: row.behavior ?? '',
      area: areaName('todas'),
      videoUrl: row.videoUrl,
      isCustom: true,
    }))
  return [...fromCatalog, ...fromCustomRows]
}

interface DraftTexts {
  title: string
  description: string
  category: string
  duration: string
  behavior: string
}

function EditTextsDialog({
  item,
  onClose,
  onSave,
  saving,
}: {
  item: CardItem
  onClose: () => void
  onSave: (draft: DraftTexts) => void
  saving: boolean
}) {
  const [draft, setDraft] = useState<DraftTexts>({
    title: item.title,
    description: item.description,
    category: item.category,
    duration: item.duration,
    behavior: item.behavior,
  })
  const field = 'mt-1 w-full rounded-xl border border-outline-variant/60 bg-surface px-md py-sm text-body-md text-on-surface outline-none focus:border-primary'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-md" role="dialog" aria-modal="true">
      <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface p-xl">
        <div className="flex items-start justify-between gap-md">
          <h3 className="font-headline text-headline-sm text-on-surface">Editar textos do vídeo</h3>
          <button type="button" onClick={onClose} aria-label="Fechar" className="text-on-surface-variant hover:text-on-surface">
            <Icon name="close" className="text-[20px]" />
          </button>
        </div>

        <div className="mt-lg grid gap-md">
          <label className="block text-label-sm text-on-surface-variant">
            Título
            <input className={field} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </label>
          <label className="block text-label-sm text-on-surface-variant">
            Descrição
            <textarea
              rows={3}
              className={field}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </label>
          <div className="grid gap-md sm:grid-cols-2">
            <label className="block text-label-sm text-on-surface-variant">
              Categoria
              <input className={field} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} />
            </label>
            <label className="block text-label-sm text-on-surface-variant">
              Duração
              <input className={field} value={draft.duration} onChange={(e) => setDraft({ ...draft, duration: e.target.value })} />
            </label>
          </div>
          <label className="block text-label-sm text-on-surface-variant">
            Comportamento
            <input className={field} value={draft.behavior} onChange={(e) => setDraft({ ...draft, behavior: e.target.value })} />
          </label>
        </div>

        <div className="mt-lg flex justify-end gap-sm">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-outline-variant/60 px-lg py-sm font-label text-label-md text-on-surface-variant"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={saving || !draft.title.trim()}
            onClick={() => onSave(draft)}
            className="inline-flex items-center gap-xs rounded-full bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary disabled:bg-surface-container-highest disabled:text-on-surface-variant"
          >
            {saving && <Icon name="progress_activity" className="animate-spin text-[16px]" />}
            Salvar
          </button>
        </div>
      </div>
    </div>
  )
}

function VideoPlayer({ videoUrl }: { videoUrl: string }) {
  const isFile = /\.(mp4|webm)(\?|$)/i.test(videoUrl)
  if (isFile) {
    return <video src={videoUrl} controls preload="metadata" className="aspect-video w-full rounded-xl bg-primary/10 object-cover" />
  }
  return (
    <a
      href={videoUrl}
      target="_blank"
      rel="noreferrer"
      className="grid aspect-video place-items-center rounded-xl bg-primary/10"
    >
      <span className="inline-flex items-center gap-xs text-body-md text-primary">
        <Icon name="play_circle" className="text-[32px]" /> Assistir
      </span>
    </a>
  )
}

function VideoCard({ item, isAdmin, highlighted }: { item: CardItem; isAdmin: boolean; highlighted: boolean }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const articleRef = useRef<HTMLElement | null>(null)

  // Vindo da busca global (`?v=`), o card escolhido rola até a vista.
  useEffect(() => {
    if (highlighted) articleRef.current?.scrollIntoView?.({ block: 'center' })
  }, [highlighted])

  function invalidate() {
    return queryClient.invalidateQueries({ queryKey: ['inova', 'guia', 'videos'] })
  }

  const patchMutation = useMutation({
    mutationFn: (patch: InovaGuiaVideoPatch) => patchInovaGuiaVideo(item.id, patch),
    onSuccess: invalidate,
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteInovaGuiaVideo(item.id),
    onSuccess: invalidate,
  })

  async function handleFile(file: File) {
    setBusy(true)
    try {
      const storagePath = await uploadInovaGuiaVideo(file)
      await patchInovaGuiaVideo(item.id, { storagePath })
      await invalidate()
    } finally {
      setBusy(false)
    }
  }

  function handleLink() {
    const url = window.prompt('Cole o link do vídeo (YouTube, Vimeo, etc.)')
    if (!url) return
    patchMutation.mutate({ videoUrl: url.trim() })
  }

  return (
    <article
      ref={articleRef}
      aria-current={highlighted ? 'true' : undefined}
      className={cx(
        'flex h-full flex-col rounded-2xl border bg-surface-container-low p-lg',
        highlighted ? 'border-primary ring-2 ring-primary/30' : 'border-outline-variant/40',
      )}
    >
      {item.videoUrl ? (
        <VideoPlayer videoUrl={item.videoUrl} />
      ) : (
        <div className="grid aspect-video place-items-center rounded-xl bg-primary/10">
          <Icon name="play_circle" className="text-[40px] text-primary" />
        </div>
      )}
      <p className="mt-md font-label text-label-sm font-bold uppercase tracking-wide text-primary">
        {[item.category, item.duration, item.area].filter(Boolean).join(' · ')}
      </p>
      <h3 className="mt-sm font-headline text-headline-sm text-on-surface">{item.title}</h3>
      <p className="mt-sm flex-1 text-body-sm text-on-surface-variant">{item.description}</p>
      {item.behavior && (
        <p className="mt-md border-t border-outline-variant/40 pt-sm text-body-sm text-on-surface-variant">
          <strong className="font-bold text-on-surface">Comportamento. </strong>
          {item.behavior}
        </p>
      )}
      <span className="mt-md inline-flex w-fit rounded-full border border-outline-variant/60 px-md py-1 text-label-sm text-on-surface-variant">
        {item.videoUrl ? 'Disponível' : 'Em breve'}
      </span>

      {isAdmin && (
        <div className="mt-md flex flex-wrap items-center gap-xs border-t border-outline-variant/40 pt-md">
          <input
            ref={inputRef}
            type="file"
            accept="video/mp4,video/webm"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) void handleFile(file)
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            className={cx(
              'inline-flex items-center gap-xs rounded-full bg-primary px-md py-xs font-label text-label-sm font-bold text-on-primary disabled:bg-surface-container-highest disabled:text-on-surface-variant',
            )}
          >
            {busy ? <Icon name="progress_activity" className="animate-spin text-[14px]" /> : <Icon name="upload" className="text-[14px]" />}
            {item.videoUrl ? 'Substituir vídeo' : 'Enviar vídeo'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleLink}
            className="inline-flex items-center gap-xs rounded-full border border-outline-variant/60 px-md py-xs font-label text-label-sm text-on-surface-variant disabled:opacity-60"
          >
            <Icon name="link" className="text-[14px]" /> Usar link
          </button>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-xs rounded-full border border-outline-variant/60 px-md py-xs font-label text-label-sm text-on-surface-variant"
          >
            <Icon name="edit" className="text-[14px]" /> Editar textos
          </button>
          {item.videoUrl && (
            <button
              type="button"
              onClick={() => patchMutation.mutate({ videoUrl: null, storagePath: null })}
              className="inline-flex items-center gap-xs rounded-full border border-error/60 px-md py-xs font-label text-label-sm text-error"
            >
              <Icon name="delete" className="text-[14px]" /> Remover vídeo
            </button>
          )}
          {item.isCustom && (
            <button
              type="button"
              onClick={() => deleteMutation.mutate()}
              className="inline-flex items-center gap-xs rounded-full border border-error/60 px-md py-xs font-label text-label-sm text-error"
            >
              <Icon name="delete" className="text-[14px]" /> Excluir card
            </button>
          )}
        </div>
      )}

      {editing && (
        <EditTextsDialog
          item={item}
          saving={patchMutation.isPending}
          onClose={() => setEditing(false)}
          onSave={(draft) => patchMutation.mutate(draft, { onSuccess: () => setEditing(false) })}
        />
      )}
    </article>
  )
}

export function InovaGuiaVideosPage() {
  const { user } = useAuth()
  const isAdmin = user ? canAdminister(user) : false
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: ['inova', 'guia', 'videos'], queryFn: listInovaGuiaVideos })

  const createMutation = useMutation({
    mutationFn: createInovaGuiaVideoCard,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inova', 'guia', 'videos'] }),
  })

  const items = mergeVideos(query.data?.videos ?? [])
  const [searchParams] = useSearchParams()
  const highlighted = searchParams.get('v')

  return (
    <div className="flex flex-col gap-2xl">
      <SectionHeading
        eyebrow="Biblioteca audiovisual"
        title="Vídeos"
        description="Conteúdos curtos para entender comportamentos AI First e aplicar no dia a dia."
        action={
          isAdmin ? (
            <button
              type="button"
              disabled={createMutation.isPending}
              onClick={() => createMutation.mutate()}
              className="inline-flex items-center gap-xs rounded-full bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary disabled:bg-surface-container-highest disabled:text-on-surface-variant"
            >
              <Icon name="add" className="text-[18px]" /> Novo card de vídeo
            </button>
          ) : undefined
        }
      />

      <ul className="grid gap-md md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <li key={item.id}>
            <VideoCard item={item} isAdmin={isAdmin} highlighted={item.id === highlighted} />
          </li>
        ))}
      </ul>
    </div>
  )
}

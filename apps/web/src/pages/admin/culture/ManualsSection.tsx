import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CultureManualDTO } from '@legends/shared'
import { ApiError, apiFetch } from '../../../lib/api'
import { Icon } from '../../../components/Icon'
import { UploadError, uploadDocument } from '../../../lib/upload'
import { Panel, inputCls } from '../shared'

interface FormState {
  id: string | null
  title: string
  description: string
  referenceLabel: string
  body: string
  published: boolean
  /** Só definido quando um arquivo NOVO foi enviado nesta edição. */
  fileKey?: string | null
  fileName: string | null
  fileSize: number | null
}

const EMPTY: FormState = {
  id: null,
  title: '',
  description: '',
  referenceLabel: '',
  body: '',
  published: true,
  fileName: null,
  fileSize: null,
}

export function ManualsSection() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const manualsQuery = useQuery({
    queryKey: ['admin', 'culture', 'manuals'],
    queryFn: () => apiFetch<{ manuals: CultureManualDTO[] }>('/admin/culture/manuals'),
  })
  const manuals = manualsQuery.data?.manuals ?? []

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['admin', 'culture', 'manuals'] })
    queryClient.invalidateQueries({ queryKey: ['culture', 'manuals'] })
  }

  const saveManual = useMutation({
    mutationFn: (state: FormState) => {
      const payload = {
        title: state.title.trim(),
        description: state.description.trim(),
        body: state.body.trim() ? state.body : null,
        referenceLabel: state.referenceLabel.trim() ? state.referenceLabel.trim() : null,
        published: state.published,
        // Arquivo só entra no payload quando um PDF novo foi enviado — assim
        // editar o texto de um manual não apaga o PDF que já estava lá.
        ...(state.fileKey !== undefined
          ? { fileKey: state.fileKey, fileName: state.fileName, fileSize: state.fileSize }
          : {}),
      }
      return state.id
        ? apiFetch<{ manual: CultureManualDTO }>(`/admin/culture/manuals/${state.id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          })
        : apiFetch<{ manual: CultureManualDTO }>('/admin/culture/manuals', {
            method: 'POST',
            body: JSON.stringify(payload),
          })
    },
    onSuccess: () => {
      setForm(null)
      setError(null)
      invalidate()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao salvar o manual.'),
  })

  const removeManual = useMutation({
    mutationFn: (id: string) => apiFetch(`/admin/culture/manuals/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao excluir o manual.'),
  })

  const reorder = useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch('/admin/culture/manuals/reorder', { method: 'POST', body: JSON.stringify({ ids }) }),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao reordenar.'),
  })

  function move(index: number, delta: number) {
    const next = [...manuals]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    reorder.mutate(next.map((m) => m.id))
  }

  async function handleFile(file: File) {
    setError(null)
    setUploading(true)
    try {
      const uploaded = await uploadDocument(file)
      setForm((current) =>
        current
          ? { ...current, fileKey: uploaded.key, fileName: uploaded.fileName, fileSize: uploaded.fileSize }
          : current,
      )
    } catch (err) {
      if (err instanceof UploadError) setError(err.message)
      else if (err instanceof ApiError) setError(err.message)
      else setError('Falha ao enviar o arquivo.')
    } finally {
      setUploading(false)
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!form) return
    if (!form.title.trim() || !form.description.trim()) {
      setError('Título e descrição são obrigatórios.')
      return
    }
    saveManual.mutate(form)
  }

  function startEdit(manual: CultureManualDTO) {
    setError(null)
    setForm({
      id: manual.id,
      title: manual.title,
      description: manual.description,
      referenceLabel: manual.referenceLabel ?? '',
      body: manual.body ?? '',
      published: manual.published,
      // `fileKey` fica indefinido de propósito: a chave do objeto nunca chega
      // ao front, e sem PDF novo o PATCH não deve tocar no arquivo existente.
      fileName: manual.fileName,
      fileSize: manual.fileSize,
    })
  }

  return (
    <Panel
      title="Manuais internos"
      action={
        <button
          type="button"
          onClick={() => {
            setError(null)
            setForm({ ...EMPTY })
          }}
          className="rounded-md bg-primary px-md py-sm font-label text-label-md font-bold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container"
        >
          Novo manual
        </button>
      }
    >
      {error && <p className="mb-md text-body-sm text-error">{error}</p>}

      {form && (
        <form onSubmit={handleSubmit} className="mb-lg flex flex-col gap-md rounded-lg border border-outline-variant/30 bg-surface-container-low p-md">
          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-sm text-on-surface-variant">Título</span>
            <input
              className={inputCls}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Código de Ética"
            />
          </label>

          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-sm text-on-surface-variant">Descrição</span>
            <input
              className={inputCls}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Princípios, valores e condutas esperadas"
            />
          </label>

          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-sm text-on-surface-variant">Data de referência (opcional)</span>
            <input
              className={inputCls}
              value={form.referenceLabel}
              onChange={(e) => setForm({ ...form, referenceLabel: e.target.value })}
              placeholder="Atualizado em junho/2024"
            />
          </label>

          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-sm text-on-surface-variant">
              Conteúdo em Markdown (opcional — habilita o &quot;Ler manual&quot;)
            </span>
            <textarea
              className={`${inputCls} min-h-40 font-mono`}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
          </label>

          <div className="flex flex-col gap-xs">
            <span className="font-label text-label-sm text-on-surface-variant">PDF (opcional, máx. 20MB)</span>
            <input
              type="file"
              accept="application/pdf"
              aria-label="Arquivo PDF do manual"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void handleFile(file)
              }}
              className="text-body-sm text-on-surface-variant"
            />
            {uploading && <span className="text-body-sm text-on-surface-variant">Enviando arquivo…</span>}
            {form.fileName && !uploading && (
              <span className="text-body-sm text-on-surface-variant">Arquivo: {form.fileName}</span>
            )}
          </div>

          <label className="flex items-center gap-xs font-label text-label-sm text-on-surface">
            <input
              type="checkbox"
              checked={form.published}
              onChange={(e) => setForm({ ...form, published: e.target.checked })}
            />
            Publicado
          </label>

          <div className="flex gap-sm">
            <button
              type="submit"
              disabled={saveManual.isPending || uploading}
              className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
            >
              {form.id ? 'Salvar alterações' : 'Criar manual'}
            </button>
            <button
              type="button"
              onClick={() => {
                setForm(null)
                setError(null)
              }}
              className="rounded-md border border-outline-variant/60 px-lg py-sm font-label text-label-md text-on-surface-variant hover:border-primary hover:text-primary"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {manualsQuery.isLoading && <p className="text-body-sm text-on-surface-variant">Carregando…</p>}

      {!manualsQuery.isLoading && manuals.length === 0 && (
        <p className="text-body-sm text-on-surface-variant">Nenhum manual cadastrado ainda.</p>
      )}

      <ul className="flex flex-col gap-sm">
        {manuals.map((manual, index) => (
          <li
            key={manual.id}
            className="flex flex-wrap items-center justify-between gap-md rounded-lg border border-outline-variant/20 bg-surface-container-low p-md"
          >
            <div className="min-w-0">
              <p className={manual.published ? 'text-on-surface' : 'text-on-surface-variant line-through'}>
                {manual.title}
              </p>
              <p className="text-body-sm text-on-surface-variant">{manual.description}</p>
              <p className="mt-xs text-label-sm text-on-surface-variant">
                {[manual.referenceLabel, manual.fileName ?? 'sem PDF', manual.body ? 'com leitura' : 'só PDF']
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <div className="flex items-center gap-xs">
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label={`Subir ${manual.title}`}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-outline-variant/60 text-on-surface-variant disabled:opacity-40"
              >
                <Icon name="arrow_upward" className="text-[18px]" />
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === manuals.length - 1}
                aria-label={`Descer ${manual.title}`}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-outline-variant/60 text-on-surface-variant disabled:opacity-40"
              >
                <Icon name="arrow_downward" className="text-[18px]" />
              </button>
              <button
                type="button"
                onClick={() => startEdit(manual)}
                className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
              >
                Editar
              </button>
              <button
                type="button"
                onClick={() => removeManual.mutate(manual.id)}
                className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-error hover:border-error"
              >
                Excluir
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

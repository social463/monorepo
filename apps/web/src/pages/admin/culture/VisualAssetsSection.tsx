import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CULTURE_VISUAL_ASSET_FITS,
  CULTURE_VISUAL_ASSET_FIT_LABELS,
  type CultureVisualAssetDTO,
  type CultureVisualAssetFit,
  type CultureVisualAssetsResponse,
} from '@legends/shared'
import { ApiError, apiFetch } from '../../../lib/api'
import { Icon } from '../../../components/Icon'
import { Select } from '../../../components/Select'
import { UploadError, uploadVisualAsset } from '../../../lib/upload'
import { Panel, inputCls } from '../shared'

interface FormState {
  id: string | null
  title: string
  description: string
  fileName: string
  fit: CultureVisualAssetFit
  published: boolean
  /**
   * Só definido quando uma imagem NOVA foi enviada nesta edição — assim
   * corrigir o título de uma peça não mexe no arquivo que já está publicado.
   */
  storageKey?: string
  /** Preview local do que foi enviado agora; a peça existente usa `imageUrl`. */
  previewUrl: string | null
}

const EMPTY: FormState = {
  id: null,
  title: '',
  description: '',
  fileName: '',
  fit: 'COVER',
  published: true,
  previewUrl: null,
}

/**
 * Gestão das peças do kit de identidade visual.
 *
 * Não cuida de logo nem de cor: essas vêm do branding que o SUPER_ADMIN cadastra
 * e o produto inteiro consome. Aqui entra a arte que a comunicação distribui —
 * banner de LinkedIn, fundo de reunião, selo de campanha.
 */
export function VisualAssetsSection() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const assetsQuery = useQuery({
    queryKey: ['admin', 'culture', 'visual-assets'],
    queryFn: () => apiFetch<CultureVisualAssetsResponse>('/admin/culture/visual-assets'),
  })
  const assets = assetsQuery.data?.assets ?? []

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['admin', 'culture', 'visual-assets'] })
    queryClient.invalidateQueries({ queryKey: ['culture', 'visual-assets'] })
  }

  const saveAsset = useMutation({
    mutationFn: (state: FormState) => {
      const payload = {
        title: state.title.trim(),
        description: state.description.trim(),
        fileName: state.fileName.trim(),
        fit: state.fit,
        published: state.published,
        ...(state.storageKey !== undefined ? { storageKey: state.storageKey } : {}),
      }
      return state.id
        ? apiFetch<{ asset: CultureVisualAssetDTO }>(`/admin/culture/visual-assets/${state.id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          })
        : apiFetch<{ asset: CultureVisualAssetDTO }>('/admin/culture/visual-assets', {
            method: 'POST',
            body: JSON.stringify(payload),
          })
    },
    onSuccess: () => {
      setForm(null)
      setError(null)
      invalidate()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao salvar a peça.'),
  })

  const removeAsset = useMutation({
    mutationFn: (id: string) => apiFetch(`/admin/culture/visual-assets/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao excluir a peça.'),
  })

  const reorder = useMutation({
    mutationFn: (ids: string[]) =>
      apiFetch('/admin/culture/visual-assets/reorder', { method: 'POST', body: JSON.stringify({ ids }) }),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao reordenar.'),
  })

  function move(index: number, delta: number) {
    const next = [...assets]
    const target = index + delta
    if (target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target], next[index]]
    reorder.mutate(next.map((a) => a.id))
  }

  async function handleFile(file: File) {
    setError(null)
    setUploading(true)
    try {
      const uploaded = await uploadVisualAsset(file)
      setForm((current) =>
        current
          ? {
              ...current,
              storageKey: uploaded.storageKey,
              // O nome do arquivo enviado vira o sugerido no download, mas só
              // quando quem publica ainda não escreveu um — trocar a imagem de
              // uma peça não deve renomear o download que já estava definido.
              fileName: current.fileName.trim() ? current.fileName : uploaded.fileName,
              previewUrl: URL.createObjectURL(file),
            }
          : current,
      )
    } catch (err) {
      if (err instanceof UploadError || err instanceof ApiError) setError(err.message)
      else setError('Falha ao enviar a imagem.')
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
    if (!form.fileName.trim()) {
      setError('Informe o nome do arquivo para download.')
      return
    }
    // Peça nova sem imagem não existe: ela É a imagem.
    if (!form.id && !form.storageKey) {
      setError('Envie a imagem da peça.')
      return
    }
    saveAsset.mutate(form)
  }

  function startEdit(asset: CultureVisualAssetDTO) {
    setError(null)
    setForm({
      id: asset.id,
      title: asset.title,
      description: asset.description,
      fileName: asset.fileName,
      fit: asset.fit,
      published: asset.published,
      // `storageKey` fica indefinido de propósito: sem imagem nova, o PATCH não
      // deve tocar no arquivo publicado.
      previewUrl: asset.imageUrl || null,
    })
  }

  return (
    <Panel
      title="Kit visual"
      action={
        <button
          type="button"
          onClick={() => {
            setError(null)
            setForm({ ...EMPTY })
          }}
          className="rounded-md bg-primary px-md py-sm font-label text-label-md font-bold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container"
        >
          Nova peça
        </button>
      }
    >
      <p className="mb-md text-body-sm text-on-surface-variant">
        Banner de LinkedIn, fundo de reunião, selo de campanha. Logo e cores da marca não entram
        aqui — elas vêm do branding da empresa e aparecem sozinhas na aba.
      </p>

      {error && <p className="mb-md text-body-sm text-error">{error}</p>}

      {form && (
        <form
          onSubmit={handleSubmit}
          className="mb-lg flex flex-col gap-md rounded-lg border border-outline-variant/30 bg-surface-container-low p-md"
        >
          <div className="flex flex-col gap-xs">
            <span className="font-label text-label-sm text-on-surface-variant">
              Imagem (JPEG, PNG, WebP ou GIF, máx. 10MB)
            </span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              aria-label="Imagem da peça"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void handleFile(file)
              }}
              className="text-body-sm text-on-surface-variant"
            />
            {uploading && <span className="text-body-sm text-on-surface-variant">Enviando imagem…</span>}
            {form.previewUrl && !uploading && (
              <img
                src={form.previewUrl}
                alt="Prévia da peça"
                className="mt-xs h-40 w-full rounded-md border border-outline-variant/40 bg-white object-contain"
              />
            )}
          </div>

          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-sm text-on-surface-variant">Título</span>
            <input
              className={inputCls}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Banner para LinkedIn"
            />
          </label>

          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-sm text-on-surface-variant">Descrição</span>
            <input
              className={inputCls}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="1584 × 396 px — pronto para adicionar ao seu perfil."
            />
          </label>

          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-sm text-on-surface-variant">
              Nome do arquivo no download
            </span>
            <input
              className={inputCls}
              value={form.fileName}
              onChange={(e) => setForm({ ...form, fileName: e.target.value })}
              placeholder="EMR-Banner-LinkedIn.png"
            />
          </label>

          <div className="flex flex-col gap-xs">
            <span className="font-label text-label-sm text-on-surface-variant">Enquadramento no card</span>
            <Select
              ariaLabel="Enquadramento no card"
              value={form.fit}
              onChange={(value) => setForm({ ...form, fit: value as CultureVisualAssetFit })}
              options={CULTURE_VISUAL_ASSET_FITS.map((fit) => ({
                value: fit,
                label: CULTURE_VISUAL_ASSET_FIT_LABELS[fit],
              }))}
            />
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
              disabled={saveAsset.isPending || uploading}
              className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
            >
              {form.id ? 'Salvar alterações' : 'Criar peça'}
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

      {assetsQuery.isLoading && <p className="text-body-sm text-on-surface-variant">Carregando…</p>}

      {!assetsQuery.isLoading && assets.length === 0 && (
        <p className="text-body-sm text-on-surface-variant">Nenhuma peça cadastrada ainda.</p>
      )}

      <ul className="flex flex-col gap-sm">
        {assets.map((asset, index) => (
          <li
            key={asset.id}
            className="flex flex-wrap items-center justify-between gap-md rounded-lg border border-outline-variant/20 bg-surface-container-low p-md"
          >
            <div className="flex min-w-0 items-center gap-md">
              {asset.imageUrl && (
                <img
                  src={asset.imageUrl}
                  alt=""
                  className="h-12 w-20 shrink-0 rounded border border-outline-variant/40 bg-white object-contain"
                />
              )}
              <div className="min-w-0">
                <p className={asset.published ? 'text-on-surface' : 'text-on-surface-variant line-through'}>
                  {asset.title}
                </p>
                <p className="text-body-sm text-on-surface-variant">{asset.description}</p>
                <p className="mt-xs text-label-sm text-on-surface-variant">
                  {[asset.fileName, CULTURE_VISUAL_ASSET_FIT_LABELS[asset.fit]].join(' · ')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-xs">
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label={`Subir ${asset.title}`}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-outline-variant/60 text-on-surface-variant disabled:opacity-40"
              >
                <Icon name="arrow_upward" className="text-[18px]" />
              </button>
              <button
                type="button"
                onClick={() => move(index, 1)}
                disabled={index === assets.length - 1}
                aria-label={`Descer ${asset.title}`}
                className="flex h-9 w-9 items-center justify-center rounded-md border border-outline-variant/60 text-on-surface-variant disabled:opacity-40"
              >
                <Icon name="arrow_downward" className="text-[18px]" />
              </button>
              <button
                type="button"
                onClick={() => startEdit(asset)}
                className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
              >
                Editar
              </button>
              <button
                type="button"
                onClick={() => removeAsset.mutate(asset.id)}
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

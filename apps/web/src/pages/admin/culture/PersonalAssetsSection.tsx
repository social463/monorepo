import { useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CulturePersonalAssetAdminDTO, PublicUser } from '@legends/shared'
import { ApiError, apiFetch } from '../../../lib/api'
import { Icon } from '../../../components/Icon'
import { Select } from '../../../components/Select'
import { UploadError, uploadPersonalAsset } from '../../../lib/upload'
import { downloadPersonalAsset } from '../../../lib/use-culture'
import { fetchCompanyUsers } from '../../../office/meetings/api'
import { Panel, inputCls } from '../shared'

interface FormState {
  recipientId: string
  title: string
  description: string
  storageKey: string | null
  fileName: string
  fileSize: number | null
  kind: 'IMAGE' | 'DOCUMENT' | null
}

const EMPTY: FormState = {
  recipientId: '',
  title: '',
  description: '',
  storageKey: null,
  fileName: '',
  fileSize: null,
  kind: null,
}

const dataCurta = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })

/**
 * Entrega de material dirigido a UMA pessoa: foto do ensaio, certificado, carta.
 *
 * O arquivo mora em prefixo privado do S3 e nunca vira URL pública — nem aqui na
 * administração. Prévia e download passam por link assinado de curta duração,
 * emitido depois de o servidor conferir quem está pedindo.
 */
export function PersonalAssetsSection() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<FormState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [filtro, setFiltro] = useState('')

  const assetsQuery = useQuery({
    queryKey: ['admin', 'culture', 'personal-assets'],
    queryFn: () => apiFetch<{ assets: CulturePersonalAssetAdminDTO[] }>('/admin/culture/personal-assets'),
  })
  const assets = assetsQuery.data?.assets ?? []

  // A mesma lista do seletor de pessoas do 1:1 — já vem ordenada e já exclui
  // ADMIN e SUBADMIN, que não são destinatários de material de colaborador.
  const { data: usersData } = useQuery({
    queryKey: ['users', 'company'],
    queryFn: fetchCompanyUsers,
    staleTime: 60_000,
  })
  const pessoas: PublicUser[] = usersData?.users ?? []

  const visiveis = useMemo(() => {
    const alvo = filtro.trim().toLowerCase()
    if (!alvo) return assets
    return assets.filter(
      (a) => a.recipient.name.toLowerCase().includes(alvo) || a.title.toLowerCase().includes(alvo),
    )
  }, [assets, filtro])

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['admin', 'culture', 'personal-assets'] })
    queryClient.invalidateQueries({ queryKey: ['culture', 'personal-assets'] })
  }

  const saveAsset = useMutation({
    mutationFn: (state: FormState) =>
      apiFetch<{ asset: CulturePersonalAssetAdminDTO }>('/admin/culture/personal-assets', {
        method: 'POST',
        body: JSON.stringify({
          recipientId: state.recipientId,
          title: state.title.trim(),
          description: state.description.trim() ? state.description.trim() : null,
          storageKey: state.storageKey,
          fileName: state.fileName,
          fileSize: state.fileSize,
          kind: state.kind,
        }),
      }),
    onSuccess: () => {
      setForm(null)
      setError(null)
      invalidate()
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao enviar o material.'),
  })

  const removeAsset = useMutation({
    mutationFn: (id: string) => apiFetch(`/admin/culture/personal-assets/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao excluir o material.'),
  })

  async function handleFile(file: File) {
    if (!form?.recipientId) {
      setError('Escolha o destinatário antes de enviar o arquivo.')
      return
    }
    setError(null)
    setUploading(true)
    try {
      // O destinatário viaja no upload porque a chave no S3 é namespeada por
      // pessoa — é isso que permite ao servidor recusar um material anexado a
      // quem não o recebeu.
      const uploaded = await uploadPersonalAsset(file, form.recipientId)
      setForm((current) =>
        current
          ? {
              ...current,
              storageKey: uploaded.storageKey,
              fileName: uploaded.fileName,
              fileSize: uploaded.fileSize,
              kind: uploaded.kind,
              title: current.title.trim() ? current.title : uploaded.fileName,
            }
          : current,
      )
    } catch (err) {
      if (err instanceof UploadError || err instanceof ApiError) setError(err.message)
      else setError('Falha ao enviar o arquivo.')
    } finally {
      setUploading(false)
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!form) return
    if (!form.recipientId) {
      setError('Escolha o destinatário.')
      return
    }
    if (!form.title.trim()) {
      setError('Informe o título do material.')
      return
    }
    if (!form.storageKey) {
      setError('Envie o arquivo.')
      return
    }
    saveAsset.mutate(form)
  }

  return (
    <Panel
      title="Materiais por pessoa"
      action={
        <button
          type="button"
          onClick={() => {
            setError(null)
            setForm({ ...EMPTY })
          }}
          className="rounded-md bg-primary px-md py-sm font-label text-label-md font-bold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container"
        >
          Enviar material
        </button>
      }
    >
      <p className="mb-md text-body-sm text-on-surface-variant">
        Fotos e documentos dirigidos a uma pessoa — só ela e quem administra Cultura veem. O arquivo
        não fica em endereço público: prévia e download saem por link assinado de poucos minutos.
      </p>

      {error && <p className="mb-md text-body-sm text-error">{error}</p>}

      {form && (
        <form
          onSubmit={handleSubmit}
          className="mb-lg flex flex-col gap-md rounded-lg border border-outline-variant/30 bg-surface-container-low p-md"
        >
          <div className="flex flex-col gap-xs">
            <span className="font-label text-label-sm text-on-surface-variant">Destinatário</span>
            {/* O `Select` do projeto, e não um `<select>` nativo: ele liga a
                busca sozinho acima de 6 opções, que é sempre o caso aqui — a
                lista é a empresa inteira. */}
            <Select
              ariaLabel="Destinatário"
              placeholder="Escolha uma pessoa…"
              value={form.recipientId}
              // Trocar o destinatário descarta o arquivo já enviado de propósito:
              // a chave no S3 nasce dentro da pasta de quem recebe, e o servidor
              // recusaria a gravação com o destinatário novo.
              onChange={(value) =>
                setForm({ ...form, recipientId: value, storageKey: null, fileName: '', kind: null })
              }
              options={pessoas.map((p) => ({ value: p.id, label: p.name }))}
            />
          </div>

          <div className="flex flex-col gap-xs">
            <span className="font-label text-label-sm text-on-surface-variant">
              Arquivo — imagem (máx. 10MB) ou PDF (máx. 20MB)
            </span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
              aria-label="Arquivo do material"
              disabled={!form.recipientId}
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

          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-sm text-on-surface-variant">Título</span>
            <input
              className={inputCls}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Suas fotos do ensaio de 2026"
            />
          </label>

          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-sm text-on-surface-variant">Descrição (opcional)</span>
            <input
              className={inputCls}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Use à vontade no LinkedIn e nas redes."
            />
          </label>

          <div className="flex gap-sm">
            <button
              type="submit"
              disabled={saveAsset.isPending || uploading}
              className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
            >
              Enviar
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

      {assets.length > 0 && (
        <label className="mb-md flex flex-col gap-xs">
          <span className="sr-only">Filtrar por pessoa ou título</span>
          <input
            className={inputCls}
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Filtrar por pessoa ou título"
          />
        </label>
      )}

      {assetsQuery.isLoading && <p className="text-body-sm text-on-surface-variant">Carregando…</p>}

      {!assetsQuery.isLoading && assets.length === 0 && (
        <p className="text-body-sm text-on-surface-variant">Nenhum material enviado ainda.</p>
      )}

      <ul className="flex flex-col gap-sm">
        {visiveis.map((asset) => (
          <li
            key={asset.id}
            className="flex flex-wrap items-center justify-between gap-md rounded-lg border border-outline-variant/20 bg-surface-container-low p-md"
          >
            <div className="flex min-w-0 items-center gap-md">
              {asset.previewUrl ? (
                <img
                  src={asset.previewUrl}
                  alt=""
                  className="h-12 w-16 shrink-0 rounded border border-outline-variant/40 object-cover"
                />
              ) : (
                <span className="flex h-12 w-16 shrink-0 items-center justify-center rounded border border-outline-variant/40 text-on-surface-variant">
                  <Icon name={asset.kind === 'DOCUMENT' ? 'picture_as_pdf' : 'image'} className="text-[20px]" />
                </span>
              )}
              <div className="min-w-0">
                <p className="text-on-surface">{asset.title}</p>
                <p className="text-body-sm text-on-surface-variant">Para {asset.recipient.name}</p>
                <p className="mt-xs text-label-sm text-on-surface-variant">
                  {[asset.fileName, dataCurta.format(new Date(asset.createdAt))].join(' · ')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-xs">
              <button
                type="button"
                onClick={() => void downloadPersonalAsset(asset.downloadPath)}
                className="rounded-md border border-outline-variant/60 px-3 py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
              >
                Baixar
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

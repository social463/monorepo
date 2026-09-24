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

/** Um arquivo já no S3, à espera do POST que o transforma em material. */
interface UploadedFile {
  storageKey: string
  fileName: string
  fileSize: number
  kind: 'IMAGE' | 'DOCUMENT'
}

interface FormState {
  recipientId: string
  title: string
  description: string
  files: UploadedFile[]
}

const EMPTY: FormState = {
  recipientId: '',
  title: '',
  description: '',
  files: [],
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
  const [progresso, setProgresso] = useState<{ atual: number; total: number } | null>(null)
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

  // Um POST por arquivo, e não um endpoint em lote: o upload em si já é uma ida
  // ao S3 por arquivo, então um contrato novo pouparia pouco. O que importa é
  // que um material que falha não leva os outros junto — a G&G sobe um kit de
  // uma dúzia de peças e reenviar tudo por causa de uma seria o pior desfecho.
  const saveAsset = useMutation({
    mutationFn: async (state: FormState) => {
      const falhas: string[] = []
      let gravados = 0
      for (const file of state.files) {
        try {
          await apiFetch<{ asset: CulturePersonalAssetAdminDTO }>('/admin/culture/personal-assets', {
            method: 'POST',
            body: JSON.stringify({
              recipientId: state.recipientId,
              title: state.title.trim(),
              description: state.description.trim() ? state.description.trim() : null,
              storageKey: file.storageKey,
              fileName: file.fileName,
              fileSize: file.fileSize,
              kind: file.kind,
            }),
          })
          gravados += 1
        } catch (err) {
          falhas.push(`${file.fileName}: ${err instanceof ApiError ? err.message : 'erro ao gravar'}`)
        }
      }
      return { gravados, falhas }
    },
    onSuccess: ({ gravados, falhas }) => {
      invalidate()
      if (falhas.length === 0) {
        setForm(null)
        setError(null)
        return
      }
      setError(
        gravados > 0
          ? `${gravados} material(is) enviado(s). Falharam: ${falhas.join('; ')}`
          : `Nenhum material foi enviado. ${falhas.join('; ')}`,
      )
      // Só o que falhou continua no formulário, pronto para uma nova tentativa.
      setForm((current) =>
        current
          ? { ...current, files: current.files.filter((f) => falhas.some((m) => m.startsWith(`${f.fileName}:`))) }
          : current,
      )
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao enviar o material.'),
  })

  const removeAsset = useMutation({
    mutationFn: (id: string) => apiFetch(`/admin/culture/personal-assets/${id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Erro ao excluir o material.'),
  })

  /**
   * Sobe os arquivos escolhidos, um a um, e acumula os que deram certo.
   *
   * Sequencial de propósito: em paralelo, um kit de doze fotos abriria doze PUTs
   * simultâneos no S3 e o progresso viraria um número sem sentido. O que falha
   * é reportado pelo nome e não interrompe os seguintes.
   */
  async function handleFiles(files: File[]) {
    if (!form?.recipientId) {
      setError('Escolha o destinatário antes de enviar os arquivos.')
      return
    }
    setError(null)
    setUploading(true)
    const falhas: string[] = []
    try {
      for (const [indice, file] of files.entries()) {
        setProgresso({ atual: indice + 1, total: files.length })
        try {
          // O destinatário viaja no upload porque a chave no S3 é namespeada por
          // pessoa — é isso que permite ao servidor recusar um material anexado a
          // quem não o recebeu.
          const uploaded = await uploadPersonalAsset(file, form.recipientId)
          setForm((current) =>
            current
              ? {
                  ...current,
                  files: [...current.files, uploaded],
                  // O título é do kit inteiro; o nome do primeiro arquivo só
                  // serve de rascunho quando quem envia não digitou nada.
                  title: current.title.trim() ? current.title : uploaded.fileName,
                }
              : current,
          )
        } catch (err) {
          const motivo =
            err instanceof UploadError || err instanceof ApiError ? err.message : 'falha ao enviar'
          falhas.push(`${file.name}: ${motivo}`)
        }
      }
    } finally {
      setUploading(false)
      setProgresso(null)
    }
    if (falhas.length > 0) setError(`Não foi possível enviar: ${falhas.join('; ')}`)
  }

  function removeFile(storageKey: string) {
    setForm((current) =>
      current ? { ...current, files: current.files.filter((f) => f.storageKey !== storageKey) } : current,
    )
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
    if (form.files.length === 0) {
      setError('Envie ao menos um arquivo.')
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
      {/* Quem envia precisa saber onde o material vai aparecer: para quem tem
          menos de 90 dias de casa ele ganha destaque no perfil, que é o que faz
          o plano de 90 dias ser lido na primeira semana em vez de na terceira. */}
      <p className="mb-md text-body-sm text-on-surface-variant">
        Nos primeiros 90 dias de casa, o material também aparece em destaque no perfil de quem
        recebeu. Depois disso ele continua na aba Kit visual, sem prazo.
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
              onChange={(value) => setForm({ ...form, recipientId: value, files: [] })}
              options={pessoas.map((p) => ({ value: p.id, label: p.name }))}
            />
          </div>

          <div className="flex flex-col gap-xs">
            <span className="font-label text-label-sm text-on-surface-variant">
              Arquivos — imagem (máx. 10MB) ou PDF (máx. 20MB) cada. Pode escolher vários de uma vez.
            </span>
            <input
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
              aria-label="Arquivos do material"
              disabled={!form.recipientId || uploading}
              onChange={(e) => {
                const escolhidos = Array.from(e.target.files ?? [])
                // Limpa o input: sem isso, reescolher o mesmo arquivo depois de
                // uma falha não dispara `change` e parece que a tela travou.
                e.target.value = ''
                if (escolhidos.length > 0) void handleFiles(escolhidos)
              }}
              className="text-body-sm text-on-surface-variant"
            />
            {uploading && (
              <span className="text-body-sm text-on-surface-variant">
                {progresso ? `Enviando ${progresso.atual} de ${progresso.total}…` : 'Enviando…'}
              </span>
            )}
            {form.files.length > 0 && (
              <ul className="flex flex-col gap-xs">
                {form.files.map((file) => (
                  <li
                    key={file.storageKey}
                    className="flex items-center justify-between gap-sm rounded border border-outline-variant/30 px-sm py-1"
                  >
                    <span className="flex min-w-0 items-center gap-xs text-body-sm text-on-surface-variant">
                      <Icon
                        name={file.kind === 'DOCUMENT' ? 'picture_as_pdf' : 'image'}
                        className="text-[16px] shrink-0"
                      />
                      <span className="truncate">{file.fileName}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => removeFile(file.storageKey)}
                      aria-label={`Remover ${file.fileName}`}
                      className="shrink-0 font-label text-label-sm text-on-surface-variant hover:text-error"
                    >
                      Remover
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-sm text-on-surface-variant">
              Título {form.files.length > 1 && '(vale para todo o kit)'}
            </span>
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
              disabled={saveAsset.isPending || uploading || form.files.length === 0}
              className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary transition-colors hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
            >
              {form.files.length > 1 ? `Enviar ${form.files.length} materiais` : 'Enviar'}
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

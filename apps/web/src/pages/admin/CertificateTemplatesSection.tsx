import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CertificateTemplateDTO, CreateCertificateTemplateRequest } from '@legends/shared'
import { Icon } from '../../components/Icon'
import {
  createCertificateTemplate,
  deleteCertificateTemplate,
  listCertificateTemplates,
  updateCertificateTemplate,
} from '../../lib/learning-api'
import { Panel, errorMessage, inputCls } from './shared'

const QUERY_KEY = ['admin', 'certificate-templates']

/** Cria (sem `template`) ou edita (com `template`) — mesmos campos nos dois casos. */
function TemplateForm({ template, onDone }: { template?: CertificateTemplateDTO; onDone: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState(template?.name ?? '')
  const [title, setTitle] = useState(template?.title ?? '')
  const [backgroundUrl, setBackgroundUrl] = useState(template?.backgroundUrl ?? '')
  const [accentColor, setAccentColor] = useState(template?.accentColor ?? '#2f8b4d')
  const [signatureName, setSignatureName] = useState(template?.signatureName ?? '')
  const [signatureRole, setSignatureRole] = useState(template?.signatureRole ?? '')
  const [signatureImageUrl, setSignatureImageUrl] = useState(template?.signatureImageUrl ?? '')
  const [logoUrl, setLogoUrl] = useState(template?.logoUrl ?? '')
  const [isDefault, setIsDefault] = useState(template?.isDefault ?? false)
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: (variables: CreateCertificateTemplateRequest) =>
      template ? updateCertificateTemplate(template.id, variables) : createCertificateTemplate(variables),
    onSuccess: () => {
      setError(null)
      qc.invalidateQueries({ queryKey: QUERY_KEY })
      onDone()
    },
    onError: (err) => setError(errorMessage(err, 'Não foi possível salvar o modelo.')),
  })

  const requiredFilled =
    name.trim() && title.trim() && accentColor.trim() && signatureName.trim() && signatureRole.trim()

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!requiredFilled) return
    save.mutate({
      name: name.trim(),
      title: title.trim(),
      backgroundUrl: backgroundUrl.trim() || null,
      accentColor: accentColor.trim(),
      signatureName: signatureName.trim(),
      signatureRole: signatureRole.trim(),
      signatureImageUrl: signatureImageUrl.trim() || null,
      logoUrl: logoUrl.trim() || null,
      isDefault,
    })
  }

  return (
    <form
      onSubmit={submit}
      className="mb-lg flex flex-col gap-md rounded-lg border border-outline-variant/30 bg-surface-container-low p-md"
    >
      <div className="grid gap-md sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Nome do modelo</span>
          <input value={name} onChange={(event) => setName(event.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Título exibido no certificado</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">URL do plano de fundo (opcional)</span>
          <input
            value={backgroundUrl ?? ''}
            onChange={(event) => setBackgroundUrl(event.target.value)}
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Cor de destaque (hex)</span>
          <input
            value={accentColor}
            onChange={(event) => setAccentColor(event.target.value)}
            placeholder="#2f8b4d"
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Nome de quem assina</span>
          <input
            value={signatureName}
            onChange={(event) => setSignatureName(event.target.value)}
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Cargo de quem assina</span>
          <input
            value={signatureRole}
            onChange={(event) => setSignatureRole(event.target.value)}
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">
            URL da imagem de assinatura (opcional)
          </span>
          <input
            value={signatureImageUrl ?? ''}
            onChange={(event) => setSignatureImageUrl(event.target.value)}
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">URL do logo (opcional)</span>
          <input value={logoUrl ?? ''} onChange={(event) => setLogoUrl(event.target.value)} className={inputCls} />
        </label>
      </div>

      <label className="flex items-center gap-sm text-body-sm text-on-surface">
        <input type="checkbox" checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} />
        Modelo padrão da empresa
      </label>

      {error && (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      )}

      <div className="flex gap-sm">
        <button
          type="submit"
          disabled={!requiredFilled || save.isPending}
          className="inline-flex w-fit items-center gap-sm rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
        >
          {template ? 'Salvar modelo' : 'Criar modelo'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md px-lg py-sm font-label text-label-md text-on-surface-variant hover:text-on-surface"
        >
          Cancelar
        </button>
      </div>
    </form>
  )
}

/**
 * Central de modelos de certificado: CRUD restrito a ADMIN — documento da
 * empresa inteira (ver `admin-certificates.ts`). Só um modelo pode ser
 * `isDefault` por empresa; marcar um novo desmarca o anterior no servidor —
 * aqui só reflete o resultado (invalida a lista após salvar).
 */
export function CertificateTemplatesSection() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: listCertificateTemplates,
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteCertificateTemplate(id),
    onSuccess: () => {
      setListError(null)
      qc.invalidateQueries({ queryKey: QUERY_KEY })
    },
    onError: (err) => setListError(errorMessage(err, 'Não foi possível excluir o modelo.')),
  })

  const templates = data?.templates ?? []
  const editingTemplate = editingId ? templates.find((template) => template.id === editingId) : undefined

  function closeForm() {
    setShowForm(false)
    setEditingId(null)
  }

  function startEdit(id: string) {
    setEditingId(id)
    setShowForm(true)
    setListError(null)
  }

  return (
    <Panel
      title="Modelos de certificado"
      action={
        <button
          type="button"
          onClick={() => (showForm ? closeForm() : setShowForm(true))}
          className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
        >
          {showForm ? 'Cancelar' : '+ Novo modelo'}
        </button>
      }
    >
      {showForm && <TemplateForm template={editingTemplate} onDone={closeForm} />}

      {listError && (
        <p role="alert" className="mb-md text-body-sm text-error">
          {listError}
        </p>
      )}

      {isLoading && <p className="text-body-md text-on-surface-variant">Carregando…</p>}
      {isError && <p className="text-body-md text-error">Erro ao carregar os modelos.</p>}
      {!isLoading && templates.length === 0 && (
        <p className="text-body-md text-on-surface-variant">Nenhum modelo cadastrado ainda.</p>
      )}

      <ul className="flex flex-col gap-sm">
        {templates.map((template) => (
          <li
            key={template.id}
            className="flex flex-wrap items-center gap-md rounded-lg border border-outline-variant/30 bg-surface-container-low px-md py-sm"
          >
            <span
              className="h-8 w-8 shrink-0 rounded-full border border-outline-variant/40"
              style={{ backgroundColor: template.accentColor }}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-sm truncate font-label text-label-lg text-on-surface">
                <span>{template.name}</span>
                {template.isDefault && (
                  <span className="rounded-full bg-primary/15 px-sm py-0.5 font-label text-label-sm text-primary">
                    Padrão
                  </span>
                )}
              </p>
              <p className="truncate text-body-sm text-on-surface-variant">
                {template.title} · {template.signatureName} · {template.signatureRole}
              </p>
            </div>
            <button
              type="button"
              onClick={() => startEdit(template.id)}
              aria-label={`Editar modelo ${template.name}`}
              className="rounded-full p-1 text-on-surface-variant hover:text-primary"
            >
              <Icon name="edit" className="text-[18px]" />
            </button>
            <button
              type="button"
              onClick={() => remove.mutate(template.id)}
              disabled={remove.isPending}
              aria-label={`Excluir modelo ${template.name}`}
              className="rounded-full p-1 text-on-surface-variant hover:text-error disabled:opacity-50"
            >
              <Icon name="delete" className="text-[18px]" />
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

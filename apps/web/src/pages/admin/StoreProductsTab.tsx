import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  CreateStoreProductRequest,
  PresignImageUploadResponse,
  StoreProductDTO,
  StoreProductListResponse,
  UpdateStoreProductRequest,
} from '@legends/shared'
import { apiFetch } from '../../lib/api'
import { UploadError, validateImageFile } from '../../lib/upload'
import { useImageUploadsEnabled } from '../../lib/use-image-upload'
import { EMPTY_STORE_PRODUCT_FORM, StoreProductForm, type StoreProductFormState } from './StoreProductForm'

const ADMIN_STORE_PRODUCTS_KEY = ['admin-store-products']

/** Corpo do POST (criação): todos os campos vão sempre, não há "valor atual" a preservar. */
function toCreateRequest(form: StoreProductFormState, newImageKey: string | null): CreateStoreProductRequest {
  const body: CreateStoreProductRequest = {
    title: form.title.trim(),
    description: form.description.trim() === '' ? null : form.description.trim(),
    category: form.category,
    priceInCoins: Number(form.priceInCoins),
    stock: Number(form.stock),
    isDigital: form.isDigital,
    isActive: form.isActive,
  }
  if (newImageKey !== null) body.imageKey = newImageKey
  return body
}

/**
 * Corpo do PATCH (edição): `stock`, `isDigital` e `isActive` só entram quando
 * o valor do form difere do produto que estava carregado ao abrir "Editar" —
 * omitida, a chave é preservada pelo `.partial()` do backend (mesmo padrão de
 * `imageKey`, que só entra quando há upload novo nesta sessão).
 *
 * Isso importa de verdade para `stock`: o form abre com o estoque de quando a
 * G&G clicou em Editar, mas resgates continuam acontecendo enquanto o
 * formulário fica aberto. Reenviar `stock` incondicionalmente (o valor antigo)
 * ressuscitaria estoque já consumido só porque alguém corrigiu o título.
 */
function toUpdateRequest(
  form: StoreProductFormState,
  newImageKey: string | null,
  original: StoreProductDTO,
): UpdateStoreProductRequest {
  const body: UpdateStoreProductRequest = {
    title: form.title.trim(),
    description: form.description.trim() === '' ? null : form.description.trim(),
    category: form.category,
    priceInCoins: Number(form.priceInCoins),
  }
  const stock = Number(form.stock)
  if (stock !== original.stock) body.stock = stock
  if (form.isDigital !== original.isDigital) body.isDigital = form.isDigital
  if (form.isActive !== original.isActive) body.isActive = form.isActive
  if (newImageKey !== null) body.imageKey = newImageKey
  return body
}

export function StoreProductsTab() {
  const queryClient = useQueryClient()
  const uploadsEnabled = useImageUploadsEnabled()
  const [form, setForm] = useState(EMPTY_STORE_PRODUCT_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  // Snapshot do produto no instante em que "Editar" foi clicado — é contra
  // ISSO (e não contra o form) que `toUpdateRequest` decide se `stock` mudou.
  const [editingProduct, setEditingProduct] = useState<StoreProductDTO | null>(null)
  const [newImageKey, setNewImageKey] = useState<string | null>(null)
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null)
  const [uploadBusy, setUploadBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ADMIN_STORE_PRODUCTS_KEY,
    queryFn: () => apiFetch<StoreProductListResponse>('/admin/store/products'),
  })

  function resetForm() {
    setForm(EMPTY_STORE_PRODUCT_FORM)
    setEditingId(null)
    setEditingProduct(null)
    setNewImageKey(null)
    setImagePreviewUrl(null)
  }

  const save = useMutation({
    mutationFn: (payload: { id: string | null; body: CreateStoreProductRequest | UpdateStoreProductRequest }) =>
      apiFetch<{ product: StoreProductDTO }>(
        payload.id ? `/admin/store/products/${payload.id}` : '/admin/store/products',
        { method: payload.id ? 'PATCH' : 'POST', body: JSON.stringify(payload.body) },
      ),
    onSuccess: () => {
      resetForm()
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ADMIN_STORE_PRODUCTS_KEY })
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Não foi possível salvar o produto.'),
  })

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch<void>(`/admin/store/products/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ADMIN_STORE_PRODUCTS_KEY })
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Não foi possível apagar o produto.'),
  })

  // Um clique só, sem volta: apagar leva junto o vínculo dos pedidos antigos
  // (SetNull em productId) — a confirmação é a mesma de ChallengesSection.
  function handleDelete(product: StoreProductDTO) {
    if (
      !window.confirm(
        `Apagar o produto "${product.title}"? Os pedidos antigos continuam no histórico, mas perdem o vínculo com o produto. Esta ação não pode ser desfeita.`,
      )
    ) {
      return
    }
    remove.mutate(product.id)
  }

  async function handleFile(file: File) {
    setUploadBusy(true)
    try {
      validateImageFile(file)
      const presign = await apiFetch<PresignImageUploadResponse>('/uploads/images/presign', {
        method: 'POST',
        body: JSON.stringify({ contentType: file.type, size: file.size }),
      })
      // PUT direto no S3 (fetch cru, fora do apiFetch): sem Authorization, Content-Type do arquivo.
      const put = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      if (!put.ok) throw new UploadError('Falha ao enviar a imagem.')
      setNewImageKey(presign.key)
      setImagePreviewUrl(presign.publicUrl)
    } catch (err) {
      setError(err instanceof UploadError ? err.message : 'Falha ao enviar a imagem.')
    } finally {
      setUploadBusy(false)
    }
  }

  function startEdit(product: StoreProductDTO) {
    setEditingId(product.id)
    setEditingProduct(product)
    setNewImageKey(null)
    setImagePreviewUrl(product.imageUrl)
    setForm({
      title: product.title,
      description: product.description ?? '',
      category: product.category,
      priceInCoins: String(product.priceInCoins),
      stock: String(product.stock),
      isDigital: product.isDigital,
      isActive: product.isActive,
    })
  }

  return (
    <div>
      {error && <p role="alert" className="mb-md text-body-sm text-error">{error}</p>}

      <StoreProductForm
        form={form}
        onChange={setForm}
        onSubmit={() =>
          save.mutate({
            id: editingId,
            body:
              editingProduct !== null
                ? toUpdateRequest(form, newImageKey, editingProduct)
                : toCreateRequest(form, newImageKey),
          })
        }
        onCancel={resetForm}
        onPickImage={handleFile}
        imagePreviewUrl={imagePreviewUrl}
        uploadsEnabled={uploadsEnabled}
        uploadBusy={uploadBusy}
        saving={save.isPending}
        editing={editingId !== null}
      />

      {isLoading ? (
        <p className="text-body-md text-on-surface-variant">Carregando…</p>
      ) : (data?.products ?? []).length === 0 ? (
        <p className="text-body-md text-on-surface-variant">Nenhum produto cadastrado.</p>
      ) : (
        <ul className="flex flex-col gap-sm">
          {(data?.products ?? []).map((product) => (
            <li key={product.id} className="flex items-center gap-md rounded-lg bg-surface-container p-md">
              <div className="flex-1">
                <p className="text-title-sm">{product.title}</p>
                <p className="text-body-sm text-on-surface-variant">
                  {product.category} · {product.priceInCoins} coins · estoque {product.stock}
                  {!product.isActive && ' · inativo'}
                </p>
              </div>
              <button className="text-label-lg" onClick={() => startEdit(product)}>Editar</button>
              <button className="text-label-lg text-error" onClick={() => handleDelete(product)}>
                Apagar
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

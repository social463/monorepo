import { STORE_PRODUCT_CATEGORIES, type StoreProductCategory } from '@legends/shared'

export interface StoreProductFormState {
  title: string
  description: string
  category: StoreProductCategory
  priceInCoins: string
  stock: string
  isDigital: boolean
  isActive: boolean
}

export const EMPTY_STORE_PRODUCT_FORM: StoreProductFormState = {
  title: '', description: '', category: 'Equipamento',
  priceInCoins: '', stock: '', isDigital: false, isActive: true,
}

/**
 * Formulário puro de criação/edição de produto: título, categoria, preço,
 * estoque, capa (upload) e flags. Sem chamada de rede — quem salva é
 * `StoreProductsTab`; aqui só renderiza e repassa eventos.
 */
export function StoreProductForm({
  form, onChange, onSubmit, onCancel, onPickImage, imagePreviewUrl, uploadsEnabled, uploadBusy, saving, editing,
}: {
  form: StoreProductFormState
  onChange: (next: StoreProductFormState) => void
  onSubmit: () => void
  onCancel: () => void
  onPickImage: (file: File) => void
  imagePreviewUrl: string | null
  uploadsEnabled: boolean
  uploadBusy: boolean
  saving: boolean
  editing: boolean
}) {
  return (
    <form
      className="mb-lg flex flex-col gap-sm"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      <label className="text-label-md">
        Título
        <input
          className="mt-xs w-full rounded-md bg-surface-container px-sm py-xs"
          value={form.title}
          onChange={(e) => onChange({ ...form, title: e.target.value })}
          required
        />
      </label>

      <label className="text-label-md">
        Descrição
        <textarea
          className="mt-xs w-full rounded-md bg-surface-container px-sm py-xs"
          value={form.description}
          onChange={(e) => onChange({ ...form, description: e.target.value })}
        />
      </label>

      <label className="text-label-md">
        Categoria
        <select
          className="mt-xs w-full rounded-md bg-surface-container px-sm py-xs"
          value={form.category}
          onChange={(e) => onChange({ ...form, category: e.target.value as StoreProductCategory })}
        >
          {STORE_PRODUCT_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </label>

      <label className="text-label-md">
        Preço em coins
        <input
          type="number" min={1}
          className="mt-xs w-full rounded-md bg-surface-container px-sm py-xs"
          value={form.priceInCoins}
          onChange={(e) => onChange({ ...form, priceInCoins: e.target.value })}
          required
        />
      </label>

      <label className="text-label-md">
        Estoque
        <input
          type="number" min={0}
          className="mt-xs w-full rounded-md bg-surface-container px-sm py-xs"
          value={form.stock}
          onChange={(e) => onChange({ ...form, stock: e.target.value })}
          required
        />
      </label>

      <label className="flex items-center gap-xs text-label-md">
        <input
          type="checkbox"
          checked={form.isDigital}
          onChange={(e) => onChange({ ...form, isDigital: e.target.checked })}
        />
        Produto digital (sem entrega física)
      </label>

      <label className="flex items-center gap-xs text-label-md">
        <input
          type="checkbox"
          checked={form.isActive}
          onChange={(e) => onChange({ ...form, isActive: e.target.checked })}
        />
        Ativo na vitrine
      </label>

      {uploadsEnabled && (
        <label className="text-label-md">
          Capa
          <input
            type="file"
            accept="image/*"
            className="mt-xs block"
            disabled={uploadBusy}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) onPickImage(file)
            }}
          />
          {uploadBusy && <p className="mt-1 text-body-sm text-on-surface-variant">Enviando…</p>}
          {imagePreviewUrl && <img src={imagePreviewUrl} alt="" className="mt-xs h-24 rounded-md object-cover" />}
        </label>
      )}

      <div className="flex gap-sm">
        <button
          type="submit"
          disabled={saving}
          className="rounded-full bg-primary px-md py-xs text-label-lg text-on-primary"
        >
          {editing ? 'Salvar' : 'Criar produto'}
        </button>
        <button type="button" className="rounded-full px-md py-xs text-label-lg" onClick={onCancel}>
          Cancelar
        </button>
      </div>
    </form>
  )
}

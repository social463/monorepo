import { useRef, useState, type ChangeEvent } from 'react'
import type { AttachedImage } from '@legends/shared'
import { uploadImage, UploadError } from '../lib/upload'
import { Icon } from './Icon'

export function ImagePicker({
  onSelect,
  disabled,
}: {
  onSelect: (image: AttachedImage) => void
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // permite re-selecionar o mesmo arquivo
    if (!file) return
    setError(null)
    setBusy(true)
    try {
      const image = await uploadImage(file)
      onSelect(image)
    } catch (err) {
      setError(err instanceof UploadError ? err.message : 'Falha ao enviar a imagem.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
        aria-label="Adicionar imagem"
        className="flex items-center gap-xs rounded-full border border-outline-variant/60 px-sm py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary disabled:opacity-40"
      >
        <Icon name="image" className="text-[18px]" /> {busy ? 'Enviando…' : 'Imagem'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={handleFile}
      />
      {error && (
        <span role="alert" className="ml-xs text-label-sm text-error">
          {error}
        </span>
      )}
    </div>
  )
}

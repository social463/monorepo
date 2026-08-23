import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ImageUploadConfig } from '@legends/shared'
import { apiFetch } from '../lib/api'
import { UploadError, uploadImage } from '../lib/upload'
import { Icon } from './Icon'

/**
 * Campo de foto de uma pessoa: prévia redonda + enviar + remover.
 *
 * O arquivo vai direto para o S3 pelo fluxo de presign (`uploadImage`); o que
 * o formulário guarda é só a URL. Por isso o campo devolve `string | null` e
 * não um `File` — quem chama grava a URL junto do resto do cadastro, numa
 * requisição só, e o binário nunca passa pela API.
 *
 * Sem armazenamento configurado (`/uploads/config` com `enabled: false`), o
 * botão some e o campo explica — em vez de deixar a pessoa escolher um arquivo
 * e só então falhar.
 */
export function PhotoUploadField({
  value,
  onChange,
  label = 'Foto',
  hint = 'Aparece no perfil e em toda a plataforma.',
  disabled,
}: {
  value: string | null
  onChange: (url: string | null) => void
  label?: string
  hint?: string
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const configQuery = useQuery({
    queryKey: ['uploads', 'config'],
    queryFn: () => apiFetch<ImageUploadConfig>('/uploads/config'),
    staleTime: Infinity,
  })
  const enabled = configQuery.data?.enabled ?? false

  async function handleFile(file: File) {
    setBusy(true)
    setError(null)
    try {
      const image = await uploadImage(file)
      onChange(image.url)
    } catch (err) {
      setError(err instanceof UploadError ? err.message : 'Não foi possível enviar a foto.')
    } finally {
      setBusy(false)
      // Zera o input para reescolher o MESMO arquivo depois de um erro — sem
      // isto o `change` não dispara de novo.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="flex items-center gap-md">
      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-outline-variant/60 bg-surface-container-highest">
        {value ? (
          <img src={value} alt="" className="h-full w-full object-cover" />
        ) : (
          <Icon name="person" className="text-[28px] text-on-surface-variant" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="font-label text-label-sm text-on-surface-variant">{label}</p>
        {!enabled ? (
          <p className="text-body-sm text-on-surface-variant">
            Envio de imagem não está configurado neste ambiente.
          </p>
        ) : (
          <>
            <div className="mt-1 flex flex-wrap items-center gap-sm">
              <input
                ref={inputRef}
                type="file"
                accept={configQuery.data?.allowedContentTypes.join(',')}
                className="hidden"
                aria-label={label}
                disabled={disabled || busy}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void handleFile(file)
                }}
              />
              <button
                type="button"
                disabled={disabled || busy}
                onClick={() => inputRef.current?.click()}
                className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
              >
                {busy ? 'Enviando…' : value ? 'Trocar foto' : 'Enviar foto'}
              </button>
              {value && (
                <button
                  type="button"
                  disabled={disabled || busy}
                  onClick={() => {
                    onChange(null)
                    setError(null)
                  }}
                  className="rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-error transition-colors hover:border-error disabled:opacity-50"
                >
                  Remover
                </button>
              )}
            </div>
            <p className="mt-1 text-body-sm text-on-surface-variant">{hint}</p>
          </>
        )}
        {error && (
          <p role="alert" className="mt-1 flex items-center gap-1 text-body-sm text-error">
            <Icon name="error" className="text-[16px]" />
            {error}
          </p>
        )}
      </div>
    </div>
  )
}

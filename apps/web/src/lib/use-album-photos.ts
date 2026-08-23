import { useState } from 'react'
import { EVENT_PHOTO_MAX_BATCH, type EventPhotoInput } from '@legends/shared'
import { apiFetch, ApiError } from './api'
import { uploadEventPhoto } from './upload'

/** Progresso de um arquivo do lote: um erro não derruba os vizinhos. */
export interface PhotoUploadState {
  fileName: string
  status: 'enviando' | 'pronto' | 'erro'
  message?: string
}

/**
 * Envio de fotos para um álbum, com progresso por arquivo.
 *
 * Sobe e confirma em levas de no máximo `EVENT_PHOTO_MAX_BATCH`: subir tudo de
 * uma vez e confirmar num POST só deixaria os arquivos além do limite órfãos no
 * S3 assim que o Zod da rota rejeitasse o lote inteiro com 400.
 *
 * Vive num hook porque o mesmo envio acontece em dois lugares — o console de
 * administração e a tela do álbum —, e uma segunda cópia da divisão em levas
 * seria a primeira a divergir.
 */
export function useAlbumPhotoUpload(albumId: string, onDone: () => void | Promise<void>) {
  const [uploads, setUploads] = useState<PhotoUploadState[]>([])
  const [error, setError] = useState<string | null>(null)

  async function sendFiles(files: FileList | File[] | null) {
    const list = files ? Array.from(files) : []
    if (list.length === 0) return
    setError(null)
    setUploads(list.map((f) => ({ fileName: f.name, status: 'enviando' as const })))

    for (let start = 0; start < list.length; start += EVENT_PHOTO_MAX_BATCH) {
      const batch = list.slice(start, start + EVENT_PHOTO_MAX_BATCH)
      const confirmados: EventPhotoInput[] = []
      for (const [offset, file] of batch.entries()) {
        const index = start + offset
        try {
          confirmados.push(await uploadEventPhoto(file))
          setUploads((prev) => prev.map((u, i) => (i === index ? { ...u, status: 'pronto' } : u)))
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Falha ao enviar a foto.'
          setUploads((prev) => prev.map((u, i) => (i === index ? { ...u, status: 'erro', message } : u)))
        }
      }

      if (confirmados.length > 0) {
        try {
          await apiFetch<unknown>(`/admin/event-albums/${albumId}/photos`, {
            method: 'POST',
            body: JSON.stringify({ photos: confirmados }),
          })
        } catch (err) {
          setError(err instanceof ApiError ? err.message : 'Erro ao confirmar as fotos no álbum.')
        }
      }
    }

    await onDone()
  }

  return { uploads, error, setError, sendFiles }
}

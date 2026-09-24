import { useState } from 'react'
import { EVENT_PHOTO_MAX_BATCH, type EventPhotoInput } from '@legends/shared'
import { apiFetch, ApiError } from './api'
import { uploadEventPhoto, UploadError } from './upload'

/** Progresso de um arquivo do lote: um erro não derruba os vizinhos. */
export interface PhotoUploadState {
  fileName: string
  status: 'enviando' | 'pronto' | 'erro'
  message?: string
}

/** Espera curta entre a primeira e a segunda tentativa de um arquivo. */
const PHOTO_RETRY_DELAY_MS = 800

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Vale tentar de novo? Só o que é tropeço de momento.
 *
 * O 401 entra na lista porque é o erro típico deste fluxo: o access token dura
 * 15 minutos e um álbum de confraternização passa disso com folga, então o
 * "Não autorizado" no meio do lote é a sessão se renovando, não a foto sendo
 * recusada. Formato e tamanho ficam de fora: o arquivo é o mesmo na segunda
 * tentativa, e insistir só atrasaria o resto da fila.
 */
export function isRetryableUploadError(err: unknown): boolean {
  if (err instanceof ApiError) {
    return err.status === 401 || err.status === 408 || err.status === 429 || err.status >= 500
  }
  if (err instanceof UploadError) return err.retryable
  // `fetch` que nem chegou a ter resposta (rede caiu no meio do PUT).
  return err instanceof TypeError
}

async function sendOnce(file: File): Promise<EventPhotoInput> {
  try {
    return await uploadEventPhoto(file)
  } catch (err) {
    if (!isRetryableUploadError(err)) throw err
    await delay(PHOTO_RETRY_DELAY_MS)
    return await uploadEventPhoto(file)
  }
}

export interface AlbumPhotoUpload {
  uploads: PhotoUploadState[]
  /** Erro do lote (confirmação no álbum), não de um arquivo. */
  error: string | null
  setError: (message: string | null) => void
  sendFiles: (files: FileList | File[] | null) => Promise<void>
  /** Arquivos que falharam por motivo transitório e cabem numa nova tentativa. */
  failed: File[]
  retryFailed: () => Promise<void>
  sending: boolean
}

/**
 * Envio de fotos para um álbum, com progresso por arquivo.
 *
 * Sobe e confirma em levas de no máximo `EVENT_PHOTO_MAX_BATCH`: subir tudo de
 * uma vez e confirmar num POST só deixaria os arquivos além do limite órfãos no
 * S3 assim que o Zod da rota rejeitasse o lote inteiro com 400.
 *
 * Cada arquivo tem direito a uma segunda tentativa quando a falha é
 * transitória, e o que ainda assim não entrou fica guardado em `failed` para
 * um reenvio dirigido. Reenviar só o que falhou não é conforto: a chave no S3
 * nasce de um UUID novo a cada envio (`buildEventPhotoKey`, na API), então
 * reselecionar a pasta inteira duplicaria no álbum tudo que já tinha entrado.
 *
 * Vive num hook porque o mesmo envio acontece em dois lugares — o console de
 * administração e a tela do álbum —, e uma segunda cópia da divisão em levas
 * seria a primeira a divergir.
 */
export function useAlbumPhotoUpload(albumId: string, onDone: () => void | Promise<void>): AlbumPhotoUpload {
  const [uploads, setUploads] = useState<PhotoUploadState[]>([])
  const [error, setError] = useState<string | null>(null)
  const [failed, setFailed] = useState<File[]>([])
  const [sending, setSending] = useState(false)

  async function sendFiles(files: FileList | File[] | null) {
    const list = files ? Array.from(files) : []
    if (list.length === 0) return
    setError(null)
    setFailed([])
    setSending(true)
    setUploads(list.map((f) => ({ fileName: f.name, status: 'enviando' as const })))

    const falharam: File[] = []
    try {
      for (let start = 0; start < list.length; start += EVENT_PHOTO_MAX_BATCH) {
        const batch = list.slice(start, start + EVENT_PHOTO_MAX_BATCH)
        const confirmados: EventPhotoInput[] = []
        // Quem entrou nesta leva, para poder voltar à fila se a confirmação cair.
        const naLeva: { file: File; index: number }[] = []

        for (const [offset, file] of batch.entries()) {
          const index = start + offset
          try {
            confirmados.push(await sendOnce(file))
            naLeva.push({ file, index })
            setUploads((prev) => prev.map((u, i) => (i === index ? { ...u, status: 'pronto' } : u)))
          } catch (err) {
            if (isRetryableUploadError(err)) falharam.push(file)
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
            // Subiu para o S3 mas não virou linha no álbum: não é "enviada".
            // Sem isso a foto sumia — verde na tela, ausente na galeria, e
            // ninguém saberia quais reenviar.
            const indices = new Set(naLeva.map((e) => e.index))
            setUploads((prev) =>
              prev.map((u, i) =>
                indices.has(i) ? { ...u, status: 'erro', message: 'Não entrou no álbum.' } : u,
              ),
            )
            if (isRetryableUploadError(err)) falharam.push(...naLeva.map((e) => e.file))
          }
        }
      }
    } finally {
      setFailed(falharam)
      setSending(false)
    }

    await onDone()
  }

  return {
    uploads,
    error,
    setError,
    sendFiles,
    failed,
    sending,
    retryFailed: () => sendFiles(failed),
  }
}

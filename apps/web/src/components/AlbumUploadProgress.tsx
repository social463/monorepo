import type { AlbumPhotoUpload } from '../lib/use-album-photos'

/**
 * Progresso do envio de fotos de um álbum, com o reenvio do que falhou.
 *
 * Vive num componente porque as duas telas que enviam fotos — a do álbum e a
 * de administração — mostram exatamente a mesma lista, e o botão de reenviar
 * não podia nascer em só uma delas.
 */
export function AlbumUploadProgress({ upload }: { upload: AlbumPhotoUpload }) {
  if (upload.uploads.length === 0) return null

  return (
    <div className="flex flex-col gap-sm">
      <ul className="flex flex-col gap-1">
        {upload.uploads.map((u) => (
          <li key={u.fileName} className="text-body-sm text-on-surface-variant">
            {u.fileName} —{' '}
            {u.status === 'erro' ? (
              <span className="text-error">{u.message}</span>
            ) : (
              <span>{u.status === 'pronto' ? 'enviada' : 'enviando…'}</span>
            )}
          </li>
        ))}
      </ul>

      {!upload.sending && upload.failed.length > 0 && (
        <div className="flex flex-wrap items-center gap-sm">
          <button
            type="button"
            onClick={() => void upload.retryFailed()}
            className="rounded-md border border-outline-variant/40 px-3 py-1.5 font-label text-label-sm text-on-surface"
          >
            {upload.failed.length === 1
              ? 'Reenviar a foto que falhou'
              : `Reenviar as ${upload.failed.length} que falharam`}
          </button>
          <span className="text-body-sm text-on-surface-variant">
            Reenviar só estas evita fotos repetidas no álbum.
          </span>
        </div>
      )}
    </div>
  )
}

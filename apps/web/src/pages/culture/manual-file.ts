import { useState } from 'react'
import type { CultureManualDTO } from '@legends/shared'
import { downloadManual } from '../../lib/use-culture'

/** Compartilhado entre a listagem de manuais e a tela de detalhe. */
export function formatSize(bytes: number | null): string | null {
  if (!bytes) return null
  const mb = bytes / (1024 * 1024)
  if (mb >= 1) return `${mb.toFixed(1).replace('.', ',')} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * Baixar o PDF passa pelo `apiFetch` (a rota exige o access token, que vive só
 * em memória), então precisa de estado de erro próprio — os dois lugares que
 * oferecem download usam este hook em vez de repetir o try/catch.
 */
export function useManualDownload() {
  const [error, setError] = useState<string | null>(null)

  async function download(manual: CultureManualDTO) {
    if (!manual.downloadPath) return
    setError(null)
    try {
      await downloadManual(manual.downloadPath)
    } catch {
      setError('Não foi possível baixar o arquivo agora. Tente de novo em instantes.')
    }
  }

  return { download, error }
}

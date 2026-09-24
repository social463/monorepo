import { useMutation } from '@tanstack/react-query'
import { Icon } from './Icon'

/**
 * Baixa um CSV vindo da API.
 *
 * Não dá para usar um `<a href>` comum: o access token só vive em memória, e um
 * link normal sairia sem `Authorization` e levaria 401. O blob vem pelo
 * `apiFetch`, que já sabe renovar o token, e só então vira download.
 */
export function DownloadCsvButton({
  fetcher,
  fallbackName,
  label,
  className = '',
}: {
  fetcher: () => Promise<{ blob: Blob; filename: string | null }>
  fallbackName: string
  label: string
  className?: string
}) {
  const baixar = useMutation({
    mutationFn: fetcher,
    onSuccess: ({ blob, filename }) => {
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename ?? fallbackName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    },
  })

  return (
    <button
      type="button"
      disabled={baixar.isPending}
      onClick={() => baixar.mutate()}
      className={`flex items-center gap-xs rounded-lg border border-outline-variant px-md py-sm font-label text-label-md text-on-surface disabled:text-on-surface-variant ${className}`}
    >
      <Icon name="table_view" className="text-[18px]" />
      {baixar.isPending ? 'Gerando…' : label}
    </button>
  )
}

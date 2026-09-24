import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BADGE_EXPORT_FILENAME,
  BADGE_IMPORT_ROW_ACTION_LABELS,
  BADGE_IMPORT_TEMPLATE_FILENAME,
  type BadgeImportPreviewDTO,
  type BadgeImportResultDTO,
} from '@legends/shared'
import { ApiError } from '../../lib/api'
import {
  commitBadgeImport,
  downloadBadgeImportTemplate,
  downloadBadgesExport,
  previewBadgeImport,
} from '../../lib/badge-import-api'
import { Icon } from '../../components/Icon'
import { Panel } from './shared'

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

/** O token só vive em memória, então `<a href>` direto não serve. */
function baixar(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Catálogo de selos por planilha (Documento 4, seção 11.5).
 *
 * A G&G já mantém os selos numa planilha e cadastrava um por um. O ciclo aqui é
 * **exportar → editar → importar**: o export sai com as mesmas colunas do
 * modelo, e a reconciliação é pelo nome do selo — reimportar corrige o que está
 * no ar em vez de duplicar o catálogo.
 *
 * `preview` não grava nada; `commit` reenvia o **mesmo arquivo**, e o servidor
 * revalida do zero.
 */
export function BadgeImportPanel() {
  const queryClient = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<BadgeImportPreviewDTO | null>(null)
  const [result, setResult] = useState<BadgeImportResultDTO | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const baixarModelo = useMutation({
    mutationFn: downloadBadgeImportTemplate,
    onSuccess: ({ blob, filename }) => baixar(blob, filename ?? BADGE_IMPORT_TEMPLATE_FILENAME),
    onError: (err) => setErro(errorMessage(err, 'Não foi possível baixar o modelo.')),
  })

  const exportar = useMutation({
    mutationFn: downloadBadgesExport,
    onSuccess: ({ blob, filename }) => baixar(blob, filename ?? BADGE_EXPORT_FILENAME),
    onError: (err) => setErro(errorMessage(err, 'Não foi possível exportar os selos.')),
  })

  const gerarPreview = useMutation({
    mutationFn: (selected: File) => previewBadgeImport(selected),
    onSuccess: (data) => {
      setPreview(data)
      setResult(null)
      setErro(null)
    },
    onError: (err) => {
      setPreview(null)
      setErro(errorMessage(err, 'Não foi possível ler a planilha.'))
    },
  })

  const confirmar = useMutation({
    mutationFn: () => commitBadgeImport(file!, preview!.fileHash),
    onSuccess: (data) => {
      setResult(data)
      setPreview(null)
      setFile(null)
      setErro(null)
      queryClient.invalidateQueries({ queryKey: ['admin', 'badges'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'badgeCategories'] })
    },
    onError: (err) => setErro(errorMessage(err, 'Não foi possível importar a planilha.')),
  })

  return (
    <Panel title="Planilha de selos">
      <div className="mb-md flex flex-wrap gap-sm">
        <button
          type="button"
          onClick={() => baixarModelo.mutate()}
          disabled={baixarModelo.isPending}
          className="inline-flex items-center gap-xs rounded-md border border-outline-variant/60 px-lg py-sm font-label text-label-md text-on-surface-variant hover:border-primary hover:text-primary"
        >
          <Icon name="download" className="text-[18px]" />
          Baixar modelo
        </button>
        <button
          type="button"
          onClick={() => exportar.mutate()}
          disabled={exportar.isPending}
          className="inline-flex items-center gap-xs rounded-md border border-outline-variant/60 px-lg py-sm font-label text-label-md text-on-surface-variant hover:border-primary hover:text-primary"
        >
          <Icon name="table_view" className="text-[18px]" />
          Exportar selos
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="font-label text-label-sm text-on-surface-variant">Planilha (.csv)</span>
        <input
          type="file"
          accept=".csv,text/csv"
          aria-label="Planilha de selos"
          onChange={(event) => {
            const selected = event.target.files?.[0] ?? null
            setFile(selected)
            setResult(null)
            if (selected) gerarPreview.mutate(selected)
          }}
          className="text-body-sm text-on-surface-variant"
        />
      </label>

      {erro && (
        <p role="alert" className="mt-md flex items-center gap-sm text-body-sm text-error">
          <Icon name="error" className="text-[16px]" />
          {erro}
        </p>
      )}

      {result && (
        <p role="status" className="mt-md flex items-center gap-sm text-body-sm text-primary">
          <Icon name="check_circle" className="text-[16px]" />
          {result.created} {result.created === 1 ? 'selo criado' : 'selos criados'}, {result.updated}{' '}
          {result.updated === 1 ? 'atualizado' : 'atualizados'}, {result.unchanged} sem mudança.
        </p>
      )}

      {preview && (
        <div className="mt-md flex flex-col gap-sm">
          {preview.warnings.map((warning) => (
            <p key={warning} className="text-body-sm text-on-surface-variant">
              {warning}
            </p>
          ))}

          <p className="font-label text-label-md text-on-surface">
            {preview.totalRows} {preview.totalRows === 1 ? 'linha' : 'linhas'} · {preview.counts.CREATE} a criar
            · {preview.counts.UPDATE} a atualizar · {preview.counts.UNCHANGED} sem mudança
            {preview.counts.ERROR > 0 ? ` · ${preview.counts.ERROR} com erro` : ''}
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-body-sm">
              <thead>
                <tr className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
                  <th className="py-1 pr-md">Linha</th>
                  <th className="py-1 pr-md">Selo</th>
                  <th className="py-1 pr-md">Tema</th>
                  <th className="py-1 pr-md">Ação</th>
                  <th className="py-1">Observações</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.line} className="border-t border-outline-variant/20 align-top">
                    <td className="py-1 pr-md text-on-surface-variant">{row.line}</td>
                    <td className="py-1 pr-md text-on-surface">{row.name || '—'}</td>
                    <td className="py-1 pr-md text-on-surface-variant">{row.categoryName || '—'}</td>
                    <td className={`py-1 pr-md ${row.action === 'ERROR' ? 'text-error' : 'text-on-surface-variant'}`}>
                      {BADGE_IMPORT_ROW_ACTION_LABELS[row.action]}
                    </td>
                    <td className="py-1 text-on-surface-variant">
                      {row.issues.length > 0
                        ? row.issues.map((issue) => issue.message).join(' ')
                        : row.changes.join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            disabled={preview.blocked || confirmar.isPending}
            onClick={() => confirmar.mutate()}
            className="w-fit rounded-full bg-primary px-lg py-sm font-label text-label-md text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
          >
            {preview.blocked ? 'Corrija os erros para importar' : 'Confirmar importação'}
          </button>
        </div>
      )}
    </Panel>
  )
}

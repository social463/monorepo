import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CALENDAR_IMPORT_ROW_ACTION_LABELS,
  CALENDAR_IMPORT_TEMPLATE_FILENAME,
  type CalendarImportPreviewDTO,
  type CalendarImportResultDTO,
  type CalendarImportRowPreviewDTO,
} from '@legends/shared'
import { Icon } from '../../components/Icon'
import {
  commitCalendarImport,
  downloadCalendarImportTemplate,
  previewCalendarImport,
} from '../../lib/calendar-import-api'
import { errorMessage } from './shared'

/**
 * Importação do **Calendário Endomarketing** em três passos: escolher o
 * arquivo, conferir o que vai acontecer e confirmar. A pré-visualização não
 * grava nada — entre ela e a gravação existe uma pessoa lendo, que é quem
 * impede uma planilha errada de virar o calendário da empresa inteira.
 *
 * O arquivo é reenviado na confirmação (e revalidado no servidor) em vez de
 * mandarmos as linhas já interpretadas: assim nada que o navegador monte entra
 * no banco sem passar pelas mesmas regras.
 */
export function CalendarImportDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const queryClient = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<CalendarImportPreviewDTO | null>(null)
  const [result, setResult] = useState<CalendarImportResultDTO | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const baixarModelo = useMutation({
    mutationFn: downloadCalendarImportTemplate,
    onSuccess: ({ blob, filename }) => {
      // Não dá pra usar um <a href> comum: o access token só vive em memória.
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename ?? CALENDAR_IMPORT_TEMPLATE_FILENAME
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    },
    onError: (err) => setErro(errorMessage(err, 'Não foi possível baixar o modelo.')),
  })

  const gerarPreview = useMutation({
    mutationFn: (selected: File) => previewCalendarImport(selected),
    onSuccess: (data) => {
      setPreview(data)
      setErro(null)
    },
    onError: (err) => setErro(errorMessage(err, 'Não foi possível ler a planilha.')),
  })

  const confirmar = useMutation({
    mutationFn: () => commitCalendarImport(file!, preview!.fileHash),
    onSuccess: (data) => {
      setResult(data)
      setErro(null)
      queryClient.invalidateQueries({ queryKey: ['calendar'] })
    },
    onError: (err) => setErro(errorMessage(err, 'Não foi possível importar a planilha.')),
  })

  function escolher(selected: File | null): void {
    setFile(selected)
    setPreview(null)
    setErro(null)
    if (selected) gerarPreview.mutate(selected)
  }

  // O passo de escolher arquivo tem pouca coisa; largura de tabela só depois.
  const largura = preview || result ? 'max-w-5xl' : 'max-w-xl'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Importar planilha de eventos"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className={`flex max-h-[90vh] w-full ${largura} flex-col rounded-xl border border-outline-variant/40 bg-surface-container p-lg shadow-xl`}
      >
        <div className="mb-md flex items-center justify-between">
          <h2 className="font-headline text-title-md text-on-surface">Importar planilha de eventos</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-7 w-7 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface"
          >
            <Icon name="close" className="text-[18px]" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {erro && (
            <p
              role="alert"
              className="mb-md flex items-center gap-xs rounded-md bg-error-container px-lg py-md text-body-sm text-on-error-container"
            >
              <Icon name="error" className="text-[18px]" />
              {erro}
            </p>
          )}

          {result ? (
            <ResultadoPanel result={result} />
          ) : (
            <>
              <ol className="mb-lg flex flex-col gap-md">
                <li className="flex items-start gap-md">
                  <PassoNumero numero={1} />
                  <div className="flex-1">
                    <p className="mb-xs text-body-md text-on-surface">Baixe o modelo</p>
                    <p className="mb-sm text-body-sm text-on-surface-variant">
                      É o formato do Calendário Endomarketing: uma linha por evento, com Tag, datas, horário e
                      público-alvo. A Tag vira a etiqueta do evento e cai numa das categorias do catálogo — é a
                      categoria que dá cor, ícone e filtro.
                    </p>
                    <button
                      type="button"
                      onClick={() => baixarModelo.mutate()}
                      disabled={baixarModelo.isPending}
                      className="flex items-center gap-xs rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary disabled:opacity-40"
                    >
                      <Icon name="download" className="text-[16px]" />
                      {baixarModelo.isPending ? 'Baixando…' : 'Baixar planilha modelo'}
                    </button>
                  </div>
                </li>

                <li className="flex items-start gap-md">
                  <PassoNumero numero={2} />
                  <div className="flex-1">
                    <p className="mb-xs text-body-md text-on-surface">Suba a planilha preenchida</p>
                    <p className="mb-sm text-body-sm text-on-surface-variant">
                      Você confere tudo antes de gravar. Evento com o mesmo nome na mesma data é atualizado, não
                      duplicado — e recorrência, lembretes e setores configurados na tela ficam como estão.
                    </p>
                    <div className="flex flex-wrap items-center gap-sm">
                      {/* Label + input `sr-only`: o input nativo é feio e vem em
                          inglês, mas some do fluxo visual sem perder o rótulo
                          para leitor de tela nem o clique por teclado. */}
                      <label className="flex cursor-pointer items-center gap-xs rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary focus-within:border-primary focus-within:text-primary">
                        <Icon name="upload_file" className="text-[16px]" />
                        {file ? 'Trocar arquivo' : 'Escolher arquivo'}
                        <input
                          type="file"
                          accept=".csv,text/csv"
                          aria-label="Planilha de eventos"
                          onChange={(event) => {
                            escolher(event.target.files?.[0] ?? null)
                            // Permite reescolher o mesmo arquivo depois de corrigi-lo.
                            event.target.value = ''
                          }}
                          className="sr-only"
                        />
                      </label>
                      <span className="text-body-sm text-on-surface-variant">
                        {file ? file.name : 'Nenhum arquivo escolhido'}
                      </span>
                    </div>
                  </div>
                </li>
              </ol>

              {gerarPreview.isPending && (
                <p role="status" className="text-body-sm text-on-surface-variant">
                  Conferindo a planilha…
                </p>
              )}

              {preview && <PreviewPanel preview={preview} />}
            </>
          )}
        </div>

        <div className="mt-lg flex items-center justify-end gap-md border-t border-outline-variant/20 pt-md">
          {preview && !result && (
            <p className="mr-auto text-body-sm text-on-surface-variant">
              {preview.blocked
                ? 'Corrija as linhas com erro e suba o arquivo de novo.'
                : 'A pré-visualização não grava nada.'}
            </p>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-outline-variant/60 px-lg py-sm font-label text-label-md text-on-surface-variant hover:border-primary hover:text-primary"
          >
            {result ? 'Fechar' : 'Cancelar'}
          </button>
          {/* Só aparece quando há o que confirmar: no passo de escolher arquivo,
              um botão primário desabilitado é ruído — não há ação a tomar nele. */}
          {preview && !result && (
            <button
              type="button"
              onClick={() => confirmar.mutate()}
              disabled={preview.blocked || confirmar.isPending}
              className="rounded-full bg-primary px-lg py-sm font-label text-label-md text-on-primary disabled:cursor-not-allowed disabled:bg-surface-container disabled:text-on-surface-variant"
            >
              {confirmar.isPending ? 'Importando…' : 'Confirmar importação'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function PassoNumero({ numero }: { numero: number }): JSX.Element {
  return (
    <span
      aria-hidden
      className="mt-[2px] flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-container-highest font-label text-label-sm text-on-surface-variant"
    >
      {numero}
    </span>
  )
}

/** "09/08/2026" ou "17/09/2026 → 20/09/2026". */
function periodo(row: CalendarImportRowPreviewDTO): string {
  const dia = (ymd: string) => ymd.split('-').reverse().join('/')
  if (!row.date) return '—'
  return row.endDate ? `${dia(row.date)} → ${dia(row.endDate)}` : dia(row.date)
}

function PreviewPanel({ preview }: { preview: CalendarImportPreviewDTO }): JSX.Element {
  const { counts, plan } = preview
  return (
    <div className="flex flex-col gap-md">
      <p role="status" className="font-label text-label-md text-on-surface">
        {counts.CREATE} a criar · {counts.UPDATE} a atualizar · {counts.UNCHANGED} sem mudança
        {counts.ERROR > 0 ? ` · ${counts.ERROR} com erro` : ''}
      </p>

      {preview.warnings.map((warning) => (
        <p
          key={warning}
          className="rounded-md bg-surface-container-high px-lg py-sm text-body-sm text-on-surface-variant"
        >
          {warning}
        </p>
      ))}

      {plan.typesToCreate.length > 0 && (
        <div className="rounded-md border border-outline-variant/30 p-md">
          <p className="mb-xs font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
            Além dos eventos, será criado
          </p>
          <p className="text-body-sm text-on-surface">
            Categorias: {plan.typesToCreate.map((type) => type.name).join(', ')} — do catálogo padrão, com a cor e o
            ícone dele. A Tag da planilha não vira categoria: ela fica como etiqueta do evento.
          </p>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-body-sm">
          <thead>
            <tr className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
              <th className="py-xs pr-sm">Linha</th>
              <th className="py-xs pr-sm">Evento</th>
              <th className="py-xs pr-sm">Etiqueta</th>
              <th className="py-xs pr-sm">Quando</th>
              <th className="py-xs pr-sm">Horário</th>
              <th className="py-xs pr-sm">Categoria</th>
              <th className="py-xs pr-sm">Público</th>
              <th className="py-xs pr-sm">Ação</th>
              <th className="py-xs">O que muda</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row) => (
              <PreviewRow key={row.line} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PreviewRow({ row }: { row: CalendarImportRowPreviewDTO }): JSX.Element {
  const isError = row.action === 'ERROR'
  return (
    <tr className="border-b border-outline-variant/20 align-top">
      <td className="py-xs pr-sm text-on-surface-variant">{row.line}</td>
      <td className="py-xs pr-sm text-on-surface">{row.title}</td>
      <td className="py-xs pr-sm text-on-surface-variant">{row.tag}</td>
      <td className="py-xs pr-sm text-on-surface-variant">{periodo(row)}</td>
      <td className="py-xs pr-sm text-on-surface-variant">{row.timeLabel}</td>
      <td className="py-xs pr-sm text-on-surface-variant">
        {row.typeName}
        {row.typeIsNew && <span className="ml-1 font-label text-label-sm text-primary">nova</span>}
      </td>
      <td className="py-xs pr-sm text-on-surface-variant">
        {row.audienceTags.length > 0 ? row.audienceTags.join(', ') : 'Toda a empresa'}
      </td>
      <td className={`py-xs pr-sm font-label ${isError ? 'text-error' : 'text-on-surface'}`}>
        {CALENDAR_IMPORT_ROW_ACTION_LABELS[row.action]}
      </td>
      <td className="py-xs text-on-surface-variant">
        {isError
          ? row.issues.map((issue) => (
              <span key={`${issue.column ?? ''}-${issue.message}`} className="block text-error">
                {issue.column ? `${issue.column}: ` : ''}
                {issue.message}
              </span>
            ))
          : row.changes.map((change) => (
              <span key={change} className="block">
                {change}
              </span>
            ))}
      </td>
    </tr>
  )
}

function ResultadoPanel({ result }: { result: CalendarImportResultDTO }): JSX.Element {
  return (
    <div className="flex flex-col gap-md">
      <p role="status" className="font-label text-label-md text-on-surface">
        {result.created} criados · {result.updated} atualizados · {result.unchanged} sem mudança
      </p>
      {result.typesCreated.length > 0 && (
        <p className="text-body-sm text-on-surface-variant">Categorias criadas: {result.typesCreated.join(', ')}.</p>
      )}
      <p className="text-body-sm text-on-surface-variant">
        Os eventos já estão no calendário de quem tem a funcionalidade Calendário e alcança o público-alvo de cada um.
      </p>
    </div>
  )
}

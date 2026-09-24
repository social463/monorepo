import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  USER_IMPORT_ROW_ACTION_LABELS,
  type UserImportPreviewDTO,
  type UserImportResultDTO,
  type UserImportRowPreviewDTO,
} from '@legends/shared'
import { Icon } from '../../components/Icon'
import { toCsv, downloadCsv } from '../../lib/csv'
import { commitUserImport, downloadImportTemplate, previewUserImport } from '../../lib/user-import-api'
import { errorMessage } from './shared'

/**
 * Importação em três passos: **escolher** o arquivo, **conferir** o que vai
 * acontecer e **confirmar**. A pré-visualização não grava nada — entre ela e a
 * gravação existe uma pessoa lendo, que é quem impede uma planilha errada de
 * virar cadastro de gente.
 *
 * O arquivo é reenviado na confirmação (e revalidado no servidor) em vez de
 * mandarmos as linhas já interpretadas: assim nada que o navegador monte entra
 * no banco sem passar pelas mesmas regras.
 */
export function UserImportDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const queryClient = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<UserImportPreviewDTO | null>(null)
  const [result, setResult] = useState<UserImportResultDTO | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)

  const baixarModelo = useMutation({
    mutationFn: downloadImportTemplate,
    onSuccess: ({ blob, filename }) => {
      // Não dá pra usar um <a href> comum: o access token só vive em memória.
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename ?? 'modelo-importacao-lendas.csv'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    },
    onError: (err) => setErro(errorMessage(err, 'Não foi possível baixar o modelo.')),
  })

  const gerarPreview = useMutation({
    mutationFn: (selected: File) => previewUserImport(selected),
    onSuccess: (data) => {
      setPreview(data)
      setErro(null)
    },
    onError: (err) => setErro(errorMessage(err, 'Não foi possível ler a planilha.')),
  })

  const confirmar = useMutation({
    mutationFn: () => commitUserImport(file!, preview!.fileHash),
    onSuccess: (data) => {
      setResult(data)
      setErro(null)
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'sectors'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'squads'] })
    },
    onError: (err) => setErro(errorMessage(err, 'Não foi possível importar a planilha.')),
  })

  function escolher(selected: File | null): void {
    setFile(selected)
    setPreview(null)
    setErro(null)
    if (selected) gerarPreview.mutate(selected)
  }

  function baixarCredenciais(): void {
    if (!result) return
    const linhas = result.credentials.map((credential) => [credential.name, credential.email, credential.password])
    downloadCsv(`credenciais-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(['Nome', 'E-mail', 'Senha'], linhas))
  }

  async function copiarCredenciais(): Promise<void> {
    if (!result) return
    const texto = result.credentials.map((c) => `${c.email}\t${c.password}`).join('\n')
    await navigator.clipboard.writeText(texto)
    setCopiado(true)
  }

  // Com as senhas na tela, um clique fora fecharia e as perderia para sempre.
  const podeFecharNoBackdrop = result === null
  // O passo de escolher arquivo tem pouca coisa; largura de tabela só depois.
  const largura = preview || result ? 'max-w-5xl' : 'max-w-xl'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Importar planilha de lendas"
      onClick={(event) => {
        if (podeFecharNoBackdrop && event.target === event.currentTarget) onClose()
      }}
    >
      <div className={`flex max-h-[90vh] w-full ${largura} flex-col rounded-xl border border-outline-variant/40 bg-surface-container p-lg shadow-xl`}>
        <div className="mb-md flex items-center justify-between">
          <h2 className="font-headline text-title-md text-on-surface">Importar planilha</h2>
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
            <p role="alert" className="mb-md flex items-center gap-xs rounded-md bg-error-container px-lg py-md text-body-sm text-on-error-container">
              <Icon name="error" className="text-[18px]" />
              {erro}
            </p>
          )}

          {result ? (
            <ResultadoPanel
              result={result}
              copiado={copiado}
              onCopiar={copiarCredenciais}
              onBaixar={baixarCredenciais}
            />
          ) : (
            <>
              <ol className="mb-lg flex flex-col gap-md">
                <li className="flex items-start gap-md">
                  <PassoNumero numero={1} />
                  <div className="flex-1">
                    <p className="mb-xs text-body-md text-on-surface">Baixe o modelo</p>
                    <p className="mb-sm text-body-sm text-on-surface-variant">
                      Uma linha por pessoa. Setores e squads que ainda não existirem são criados. A coluna{' '}
                      <strong className="font-label">Foto (URL)</strong> aceita o link do Google Drive da foto — o
                      arquivo precisa estar compartilhado como &ldquo;qualquer pessoa com o link&rdquo;. Deixar em
                      branco mantém a foto que já está no cadastro.
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
                      Você confere tudo antes de gravar. Ninguém é desligado nem tem a senha trocada pela importação.
                    </p>
                    <div className="flex flex-wrap items-center gap-sm">
                      {/* Label + input `sr-only`: o input nativo é feio e vem em
                          inglês, mas some do fluxo visual sem perder o rótulo
                          para leitor de tela nem o clique por teclado. */}
                      <label className="flex cursor-pointer items-center gap-xs rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary focus-within:border-primary focus-within:text-primary">
                        <Icon name="upload_file" className="text-[16px]" />
                        {file ? 'Trocar arquivo' : 'Escolher arquivo'}
                        <input
                          ref={inputRef}
                          type="file"
                          accept=".csv,text/csv"
                          aria-label="Planilha de lendas"
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

function PreviewPanel({ preview }: { preview: UserImportPreviewDTO }): JSX.Element {
  const { counts, plan } = preview
  // Erro primeiro, e não em ordem de arquivo: numa planilha de 120 linhas as
  // linhas com erro são a única coisa acionável — travam o arquivo inteiro —, e
  // achá-las rolando a tabela é justamente o que ninguém faz. `sort` é estável,
  // então dentro de cada grupo a ordem do arquivo se mantém.
  const rows = [...preview.rows].sort(
    (a, b) => Number(b.action === 'ERROR') - Number(a.action === 'ERROR') || a.line - b.line,
  )

  function baixarErros(): void {
    const linhas = preview.rows
      .filter((row) => row.action === 'ERROR')
      .flatMap((row) =>
        row.issues.map((issue) => [String(row.line), row.name, row.email, issue.column ?? '', issue.message]),
      )
    downloadCsv('erros-importacao.csv', toCsv(['Linha', 'Nome', 'E-mail', 'Coluna', 'Erro'], linhas))
  }

  return (
    <div className="flex flex-col gap-md">
      <p role="status" className="font-label text-label-md text-on-surface">
        {counts.CREATE} a criar · {counts.UPDATE} a atualizar · {counts.UNCHANGED} sem mudança ·{' '}
        {counts.DEACTIVATE} a desativar · {counts.SKIP} ignoradas
        {counts.ERROR > 0 ? ` · ${counts.ERROR} com erro` : ''}
      </p>

      {/* Nada é gravado enquanto houver uma linha com erro, então o que a
          pessoa precisa é da lista do que corrigir — em arquivo, para levar
          para a planilha de origem. */}
      {counts.ERROR > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-sm rounded-md border border-error/40 bg-error-container/20 px-lg py-md">
          <p className="font-label text-label-md text-on-error-container">
            {counts.ERROR} {counts.ERROR === 1 ? 'linha com erro' : 'linhas com erro'} — nada será importado
            enquanto houver erro. Elas estão no topo da tabela.
          </p>
          <button
            type="button"
            onClick={baixarErros}
            className="flex items-center gap-xs rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
          >
            <Icon name="download" className="text-[16px]" />
            Baixar erros (CSV)
          </button>
        </div>
      )}

      {/* Desativação em destaque, e antes da tabela: é a única ação da
          importação que tira gente do ar, e ninguém deve descobri-la rolando
          uma tabela de 200 linhas. */}
      {counts.DEACTIVATE > 0 && (
        <div className="rounded-md border border-error/40 bg-error-container/20 px-lg py-md">
          <p className="font-label text-label-md text-on-error-container">
            {counts.DEACTIVATE}{' '}
            {counts.DEACTIVATE === 1 ? 'pessoa será desativada' : 'pessoas serão desativadas'} — marcadas como
            "Desligado" na planilha.
          </p>
          <p className="mt-xs text-body-sm text-on-surface-variant">
            Elas saem das listagens e não entram mais. O histórico (pontos, EMR Coins, feedbacks e selos)
            é preservado, e dá para reativar em Administração › Lendas. A importação nunca reativa ninguém
            sozinha.
          </p>
        </div>
      )}

      {preview.warnings.map((warning) => (
        <p key={warning} className="rounded-md bg-surface-container-high px-lg py-sm text-body-sm text-on-surface-variant">
          {warning}
        </p>
      ))}

      {(plan.sectorsToCreate.length > 0 || plan.squadsToCreate.length > 0 || plan.squadsToMove.length > 0) && (
        <div className="rounded-md border border-outline-variant/30 p-md">
          <p className="mb-xs font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
            Além das pessoas
          </p>
          {plan.sectorsToCreate.length > 0 && (
            <p className="text-body-sm text-on-surface">
              Setores criados: {plan.sectorsToCreate.map((sector) => sector.name).join(', ')} — nascem com o mínimo
              (Escritório); ajuste as funcionalidades em Administração › Setores.
            </p>
          )}
          {plan.squadsToCreate.length > 0 && (
            <p className="text-body-sm text-on-surface">
              Squads criadas: {plan.squadsToCreate.map((squad) => `${squad.name} (${squad.sectorName})`).join(', ')}
            </p>
          )}
          {plan.squadsToMove.length > 0 && (
            <p className="text-body-sm text-on-surface">
              Squads que mudam de setor:{' '}
              {plan.squadsToMove
                .map((squad) => `${squad.name} (${squad.fromSectorName} → ${squad.toSectorName})`)
                .join(', ')}{' '}
              — a squad vai junto com a gente dela.
            </p>
          )}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-body-sm">
          <thead>
            <tr className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
              <th className="py-xs pr-sm">Linha</th>
              <th className="py-xs pr-sm">Nome</th>
              <th className="py-xs pr-sm">E-mail</th>
              <th className="py-xs pr-sm">Ação</th>
              <th className="py-xs pr-sm">Setor</th>
              <th className="py-xs pr-sm">Squad</th>
              <th className="py-xs">O que muda</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <PreviewRow key={row.line} row={row} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PreviewRow({ row }: { row: UserImportRowPreviewDTO }): JSX.Element {
  const isError = row.action === 'ERROR'
  return (
    <tr className={`border-b border-outline-variant/20 align-top ${isError ? 'bg-error-container/10' : ''}`}>
      <td className="py-xs pr-sm text-on-surface-variant">{row.line}</td>
      <td className="py-xs pr-sm text-on-surface">{row.name}</td>
      <td className="py-xs pr-sm text-on-surface-variant">{row.email}</td>
      <td className={`py-xs pr-sm font-label ${isError ? 'text-error' : 'text-on-surface'}`}>
        {USER_IMPORT_ROW_ACTION_LABELS[row.action]}
      </td>
      <td className="py-xs pr-sm text-on-surface-variant">{row.sectorName}</td>
      <td className="py-xs pr-sm text-on-surface-variant">{row.squadName ?? '—'}</td>
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

function ResultadoPanel({
  result,
  copiado,
  onCopiar,
  onBaixar,
}: {
  result: UserImportResultDTO
  copiado: boolean
  onCopiar: () => void
  onBaixar: () => void
}): JSX.Element {
  return (
    <div className="flex flex-col gap-md">
      <p role="status" className="font-label text-label-md text-on-surface">
        {result.created} criadas · {result.updated} atualizadas · {result.unchanged} sem mudança · {result.skipped}{' '}
        ignoradas
      </p>
      {(result.sectorsCreated.length > 0 || result.squadsCreated.length > 0 || result.squadsMoved.length > 0) && (
        <p className="text-body-sm text-on-surface-variant">
          {result.sectorsCreated.length > 0 && `Setores criados: ${result.sectorsCreated.join(', ')}. `}
          {result.squadsCreated.length > 0 && `Squads criadas: ${result.squadsCreated.join(', ')}. `}
          {result.squadsMoved.length > 0 && `Squads que mudaram de setor: ${result.squadsMoved.join(', ')}.`}
        </p>
      )}

      {result.photosImported > 0 && (
        <p className="text-body-sm text-on-surface-variant">
          {result.photosImported === 1
            ? '1 foto importada da planilha.'
            : `${result.photosImported} fotos importadas da planilha.`}
        </p>
      )}

      {result.photoWarnings.length > 0 && (
        <div className="rounded-md border border-outline-variant/40 bg-surface-container-high px-lg py-sm">
          <p className="mb-xs font-label text-label-sm text-on-surface">
            Fotos que não entraram — o resto do cadastro foi importado normalmente
          </p>
          <ul className="flex flex-col gap-xs text-body-sm text-on-surface-variant">
            {result.photoWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {result.credentials.length > 0 && (
        <div className="rounded-lg border border-outline-variant/40 bg-surface-container-low p-md">
          <p className="mb-xs font-label text-label-md text-on-surface">Senhas geradas — aparecem uma única vez</p>
          <p className="mb-sm text-body-sm text-on-surface-variant">
            Copie ou baixe agora e entregue a cada pessoa. Fechando esta janela, não há como exibi-las de novo — só
            definir uma nova senha na ficha da pessoa.
          </p>
          <div className="mb-sm flex flex-wrap gap-sm">
            <button
              type="button"
              onClick={onCopiar}
              className="flex items-center gap-xs rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
            >
              <Icon name="content_copy" className="text-[16px]" />
              {copiado ? 'Copiado' : 'Copiar tudo'}
            </button>
            <button
              type="button"
              onClick={onBaixar}
              className="flex items-center gap-xs rounded-md border border-outline-variant/60 px-md py-1 font-label text-label-sm text-on-surface-variant hover:border-primary hover:text-primary"
            >
              <Icon name="download" className="text-[16px]" />
              Baixar credenciais.csv
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-body-sm">
              <thead>
                <tr className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
                  <th className="py-xs pr-sm">Nome</th>
                  <th className="py-xs pr-sm">E-mail</th>
                  <th className="py-xs">Senha</th>
                </tr>
              </thead>
              <tbody>
                {result.credentials.map((credential) => (
                  <tr key={credential.email} className="border-b border-outline-variant/20">
                    <td className="py-xs pr-sm text-on-surface">{credential.name}</td>
                    <td className="py-xs pr-sm text-on-surface-variant">{credential.email}</td>
                    <td className="py-xs font-mono text-on-surface">{credential.password}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DEFAULT_VACATION_NOTICE_TEMPLATE, formatCivilDate } from '@legends/shared'
import { ApiError } from '../../lib/api'
import {
  downloadVacationCampaignCsv,
  fetchVacationCampaignOverview,
  upsertVacationCampaign,
} from '../../lib/vacation-planning-api'
import { Icon } from '../../components/Icon'
import { DownloadCsvButton } from '../../components/DownloadCsvButton'

/**
 * Administração › Férias — o painel de Gente e Gestão.
 *
 * Substitui o "sinalize por e-mail para o DP" da ferramenta de origem: em vez
 * de caçar gestor, a G&G vê **quem falta, por área**.
 */
export function VacationCampaignSection() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['admin', 'vacation-campaign'],
    queryFn: fetchVacationCampaignOverview,
  })

  const anoQueVem = new Date().getFullYear() + 1
  const [year, setYear] = useState(anoQueVem)
  const [opensAt, setOpensAt] = useState('')
  const [deadline, setDeadline] = useState('')
  const [manuallyLocked, setManuallyLocked] = useState(false)
  const [noticeTemplate, setNoticeTemplate] = useState(DEFAULT_VACATION_NOTICE_TEMPLATE)
  const [aviso, setAviso] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const campanha = query.data?.campaign ?? null
  useEffect(() => {
    if (!campanha) return
    setYear(campanha.year)
    setOpensAt(campanha.opensAt)
    setDeadline(campanha.deadline)
    setManuallyLocked(campanha.manuallyLocked)
    setNoticeTemplate(campanha.noticeTemplate)
  }, [campanha])

  const salvar = useMutation({
    mutationFn: upsertVacationCampaign,
    onSuccess: (res) => {
      setErro(null)
      setAviso(
        res.entitlementsCreated > 0
          ? `Campanha salva. ${res.entitlementsCreated} direito(s) de férias criado(s).`
          : 'Campanha salva.',
      )
      void queryClient.invalidateQueries({ queryKey: ['admin', 'vacation-campaign'] })
    },
    onError: (err) => {
      setAviso(null)
      setErro(err instanceof ApiError ? err.message : 'Não foi possível salvar a campanha.')
    },
  })

  const progresso = query.data?.progress ?? []
  const pedidos = query.data?.changeRequests ?? []
  const totais = progresso.reduce(
    (acc, linha) => ({
      total: acc.total + linha.total,
      validated: acc.validated + linha.validated,
      confirmed: acc.confirmed + linha.confirmed,
    }),
    { total: 0, validated: 0, confirmed: 0 },
  )

  return (
    <section className="flex flex-col gap-lg">
      <header>
        <h2 className="font-headline text-headline-lg text-on-surface">Férias</h2>
        <p className="mt-2 text-body-md text-on-surface-variant">
          A campanha anual de programação: prazo, andamento por área e os pedidos de alteração.
        </p>
      </header>

      <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low p-lg">
        <h3 className="font-label text-label-lg text-on-surface">Campanha</h3>
        <p className="mt-1 text-body-sm text-on-surface-variant">
          Abrir a campanha já cria os direitos de quem completou período aquisitivo — derivados da
          admissão, ou da data-base quando houve afastamento.
        </p>

        <div className="mt-md grid gap-md sm:grid-cols-3">
          <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            Ano da programação
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="rounded-lg border border-outline-variant bg-surface px-sm py-xs text-body-md text-on-surface"
            />
          </label>
          <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            Abertura
            <input
              type="date"
              value={opensAt}
              onChange={(e) => setOpensAt(e.target.value)}
              className="rounded-lg border border-outline-variant bg-surface px-sm py-xs text-body-md text-on-surface"
            />
          </label>
          <label className="flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
            Prazo para os gestores
            <input
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="rounded-lg border border-outline-variant bg-surface px-sm py-xs text-body-md text-on-surface"
            />
          </label>
        </div>

        <label className="mt-md flex flex-col gap-1 font-label text-label-sm text-on-surface-variant">
          Aviso enviado ao colaborador quando a programação é validada
          <textarea
            rows={3}
            value={noticeTemplate}
            onChange={(e) => setNoticeTemplate(e.target.value)}
            className="rounded-lg border border-outline-variant bg-surface px-sm py-xs text-body-md text-on-surface"
          />
          <span className="text-body-sm text-on-surface-variant">
            Use <code>{'{nome}'}</code>, <code>{'{periodos}'}</code> e <code>{'{ano}'}</code> — o
            portal preenche na hora do envio.
          </span>
        </label>

        <label className="mt-md flex items-center gap-sm font-label text-label-md text-on-surface">
          <input
            type="checkbox"
            checked={manuallyLocked}
            onChange={(e) => setManuallyLocked(e.target.checked)}
          />
          Bloquear o preenchimento agora, antes do prazo
        </label>

        {aviso && (
          <p className="mt-md flex items-start gap-xs rounded-lg bg-tertiary-container px-sm py-xs text-body-sm text-on-tertiary-container">
            <Icon name="check_circle" className="mt-0.5 text-[16px]" />
            {aviso}
          </p>
        )}
        {erro && (
          <p className="mt-md flex items-start gap-xs rounded-lg bg-error-container px-sm py-xs text-body-sm text-on-error-container">
            <Icon name="error" className="mt-0.5 text-[16px]" />
            {erro}
          </p>
        )}

        <button
          type="button"
          disabled={salvar.isPending || !opensAt || !deadline}
          onClick={() =>
            salvar.mutate({ year, opensAt, deadline, manuallyLocked, noticeTemplate })
          }
          className="mt-md rounded-lg bg-primary px-lg py-sm font-label text-label-md text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
        >
          {salvar.isPending ? 'Salvando…' : campanha ? 'Salvar campanha' : 'Abrir campanha'}
        </button>
      </div>

      {campanha && (
        <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low p-lg">
          <div className="flex flex-wrap items-baseline justify-between gap-sm">
            <h3 className="font-label text-label-lg text-on-surface">
              Andamento da campanha {campanha.year}
            </h3>
            <div className="flex flex-wrap items-center gap-sm">
              <span className="text-body-sm text-on-surface-variant">
                prazo {formatCivilDate(campanha.deadline)}
                {campanha.locked ? ' · encerrada para os gestores' : ''}
              </span>
              <DownloadCsvButton
                fetcher={downloadVacationCampaignCsv}
                fallbackName="ferias-controle-geral.csv"
                label="Baixar controle geral"
              />
            </div>
          </div>
          <p className="mt-1 text-body-md text-on-surface">
            {totais.validated} de {totais.total} validados · {totais.confirmed} aguardando conferência
          </p>

          {progresso.length === 0 ? (
            <p className="mt-md rounded-lg border border-dashed border-outline-variant p-lg text-center text-body-sm text-on-surface-variant">
              Nenhum gestor começou a preencher ainda.
            </p>
          ) : (
            <div className="mt-md overflow-x-auto">
              <table className="w-full min-w-[32rem] text-left text-body-sm">
                <thead className="font-label text-label-sm uppercase text-on-surface-variant">
                  <tr>
                    <th className="py-xs">Área</th>
                    <th className="py-xs">Total</th>
                    <th className="py-xs">Preenchendo</th>
                    <th className="py-xs">Confirmados</th>
                    <th className="py-xs">Validados</th>
                  </tr>
                </thead>
                <tbody className="text-on-surface">
                  {progresso.map((linha) => (
                    <tr key={linha.sectorId} className="border-t border-outline-variant/40">
                      <td className="py-xs">{linha.sectorName}</td>
                      <td className="py-xs">{linha.total}</td>
                      <td className="py-xs">{linha.draft}</td>
                      <td className="py-xs">{linha.confirmed}</td>
                      <td className="py-xs">{linha.validated}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Pedidos de alteração: quem já tinha programação combinada e o gestor
          pediu para mudar. Sem esta lista, a G&G teria de comparar planos para
          descobrir quem mexeu no que estava acertado. */}
      {pedidos.length > 0 && (
        <div className="rounded-xl border border-secondary/40 bg-secondary-container/40 p-lg">
          <h3 className="flex items-center gap-xs font-label text-label-lg text-on-secondary-container">
            <Icon name="edit_note" className="text-[18px]" />
            Pedidos de alteração ({pedidos.length})
          </h3>
          <ul className="mt-sm space-y-1 text-body-sm text-on-surface">
            {pedidos.map((pedido) => (
              <li key={`${pedido.userName}-${pedido.sectorName}`}>
                <strong>{pedido.userName}</strong> — {pedido.sectorName}
                {pedido.managerName ? ` · líder ${pedido.managerName}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

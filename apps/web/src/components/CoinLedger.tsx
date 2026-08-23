import { useState } from 'react'
import {
  COIN_LEDGER_PAGE_SIZE,
  COIN_EVENT_LABELS,
  COIN_TRANSACTION_KIND_LABELS,
  type CoinTransactionDTO,
} from '@legends/shared'
import { useCoinLedger } from '../lib/use-coins'

function formatDay(day: string): string {
  const [year, month, dayOfMonth] = day.split('-')
  return `${dayOfMonth}/${month}/${year}`
}

function entryLabel(entry: CoinTransactionDTO): string {
  if (entry.event) return COIN_EVENT_LABELS[entry.event]
  return COIN_TRANSACTION_KIND_LABELS[entry.kind]
}

/**
 * Extrato de EMR Coins: o que entrou e o que saiu, página a página.
 *
 * Mora na Lojinha porque é aqui que a moeda é gasta — o saldo e os pedidos já
 * estão nesta tela, e o histórico responde a mesma pergunta ("cadê meus
 * coins?"). Só o histórico: as REGRAS de crédito ficam no Manual do Game, que
 * é a fonte única delas.
 */
export function CoinLedger() {
  const [page, setPage] = useState(1)
  const ledger = useCoinLedger(page)

  const entries = ledger.data?.entries ?? []
  const total = ledger.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / COIN_LEDGER_PAGE_SIZE))

  return (
    <section className="rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
      <div className="flex flex-wrap items-baseline justify-between gap-sm">
        <h2 className="font-headline text-headline-sm text-on-surface">Extrato</h2>
        {total > 0 && (
          <p className="text-body-sm text-on-surface-variant">
            {total} {total === 1 ? 'lançamento' : 'lançamentos'}
          </p>
        )}
      </div>

      {ledger.isError && (
        <p role="alert" className="mt-sm text-body-sm text-error">
          Erro ao carregar o extrato.
        </p>
      )}

      {ledger.isLoading && <p className="mt-sm text-body-md text-on-surface-variant">Carregando…</p>}

      {!ledger.isLoading && !ledger.isError && entries.length === 0 && (
        <p className="mt-sm text-body-md text-on-surface-variant">
          Nenhum lançamento ainda. Participe do dia a dia para começar a acumular.
        </p>
      )}

      <ul className="mt-md flex flex-col gap-sm">
        {entries.map((entry) => (
          <li
            key={entry.id}
            className="flex items-center justify-between gap-md border-b border-outline-variant/20 pb-sm last:border-none"
          >
            <div>
              <p className="text-body-md text-on-surface">{entryLabel(entry)}</p>
              <p className="text-body-sm text-on-surface-variant">
                {formatDay(entry.day)}
                {entry.reason ? ` · ${entry.reason}` : ''}
                {entry.actor ? ` · por ${entry.actor.name}` : ''}
              </p>
            </div>
            <p className={`font-label text-label-lg ${entry.amount < 0 ? 'text-error' : 'text-primary'}`}>
              {entry.amount > 0 ? `+${entry.amount}` : entry.amount}
            </p>
          </li>
        ))}
      </ul>

      {totalPages > 1 && (
        <div className="mt-md flex items-center gap-md">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={page === 1}
            className="rounded-full border border-outline-variant/40 px-lg py-sm font-label text-label-md disabled:opacity-40"
          >
            Anterior
          </button>
          <span className="text-body-sm text-on-surface-variant">
            Página {page} de {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            disabled={page >= totalPages}
            className="rounded-full border border-outline-variant/40 px-lg py-sm font-label text-label-md disabled:opacity-40"
          >
            Próxima
          </button>
        </div>
      )}
    </section>
  )
}

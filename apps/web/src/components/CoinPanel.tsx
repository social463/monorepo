import { Link } from 'react-router-dom'
import { COIN_CURRENCY_LABEL, COIN_EVENT_LABELS, COIN_TRANSACTION_KIND_LABELS } from '@legends/shared'
import { useCoinBalance, useCoinLedger } from '../lib/use-coins'
import { Icon } from './Icon'

const RECENT_COUNT = 5

/**
 * Painel do chip de saldo: quanto você tem, o que entrou por último e o
 * caminho para o resto.
 *
 * As regras ("+3 por registrar o humor…") saíram daqui de propósito: elas
 * moram no Manual do Game, e repeti-las no widget criava duas fontes que
 * divergiam no primeiro ajuste de valor. O widget aponta para a fonte.
 */
export function CoinPanel({ onClose }: { onClose: () => void }) {
  const balance = useCoinBalance()
  // Reaproveita o cache da primeira página do extrato usada na Lojinha.
  const ledger = useCoinLedger(1)
  const recent = (ledger.data?.entries ?? []).slice(0, RECENT_COUNT)

  return (
    <div
      role="dialog"
      aria-label={COIN_CURRENCY_LABEL}
      className="fixed inset-x-sm top-[4.75rem] z-50 max-h-[calc(100vh-5.5rem)] overflow-y-auto rounded-2xl border border-outline-variant/40 bg-surface-container p-md shadow-lg md:absolute md:left-auto md:right-0 md:top-full md:mt-sm md:max-h-none md:w-[min(90vw,420px)] md:p-lg"
    >
      <div className="mb-lg flex items-center justify-between">
        <h2 className="flex items-center gap-sm font-headline text-title-lg font-bold text-on-surface">
          <span aria-hidden>🪙</span> {COIN_CURRENCY_LABEL}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="rounded-full px-sm py-1 font-label text-label-md text-on-surface-variant hover:bg-surface-container-highest"
        >
          ✕
        </button>
      </div>

      <p className="font-headline text-headline-md font-bold text-on-surface">{balance.data?.balance ?? 0}</p>
      <p className="font-label text-label-sm text-on-surface-variant">saldo atual</p>

      <Link
        to="/manual-game"
        onClick={onClose}
        className="group mt-lg flex items-center gap-sm rounded-xl border border-outline-variant/40 bg-surface-container-low px-md py-sm"
      >
        <Icon name="help_center" className="text-[20px] text-primary" />
        <span className="flex-1 font-label text-label-md text-on-surface group-hover:underline">
          Como ganhar {COIN_CURRENCY_LABEL}
        </span>
        <Icon
          name="arrow_forward"
          className="text-[16px] text-on-surface-variant transition-transform group-hover:translate-x-0.5"
        />
      </Link>

      <h3 className="mt-lg font-label text-label-md text-on-surface">Últimos lançamentos</h3>
      {recent.length > 0 ? (
        <ul className="mt-sm flex flex-col gap-1">
          {recent.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-md text-body-sm">
              <span className="text-on-surface-variant">
                {entry.event ? COIN_EVENT_LABELS[entry.event] : COIN_TRANSACTION_KIND_LABELS[entry.kind]}
              </span>
              <span className={entry.amount < 0 ? 'text-error' : 'text-primary'}>
                {entry.amount > 0 ? `+${entry.amount}` : entry.amount}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-sm text-body-sm text-on-surface-variant">Nada por aqui ainda.</p>
      )}

      <Link
        to="/loja?tab=extrato"
        onClick={onClose}
        className="mt-lg inline-block font-label text-label-md text-primary hover:underline"
      >
        Ver extrato completo
      </Link>
    </div>
  )
}

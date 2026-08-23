import { useEffect, useRef, useState } from 'react'
import { COIN_CURRENCY_LABEL } from '@legends/shared'
import { useCoinBalance } from '../lib/use-coins'
import { CoinPanel } from './CoinPanel'

/** Chip de saldo de EMR Coins no cabeçalho, com painel de detalhes. */
export function CoinIndicator() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const balance = useCoinBalance()

  useEffect(() => {
    if (!open) return
    function onPointer(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Mesma política do chip de ofensiva: só aparece com dado carregado, para não
  // piscar "🪙 0" no load nem poluir o header em caso de erro.
  if (!balance.data) return null

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={COIN_CURRENCY_LABEL}
        className="flex items-center gap-sm rounded-full border-2 border-secondary/40 px-md py-1.5 transition-colors hover:border-secondary focus:outline-none focus:ring-2 focus:ring-secondary/30"
      >
        <span className="text-[20px] leading-none" aria-hidden>🪙</span>
        <span className="font-label text-label-lg font-bold text-on-surface">{balance.data.balance}</span>
      </button>

      {open && <CoinPanel onClose={() => setOpen(false)} />}
    </div>
  )
}

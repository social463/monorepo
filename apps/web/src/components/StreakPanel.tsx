import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useStreakSummary, useStreakCalendar } from '../lib/use-streak'
import {
  buildMonthGrid,
  shiftMonth,
  todaySaoPaulo,
  isWeekendYmd,
  MONTH_NAMES_PT,
  WEEKDAY_INITIALS,
} from '../lib/streak-calendar'
import { Icon } from './Icon'

/**
 * Frase de incentivo do topo do painel.
 *
 * O trecho da segunda chance só entra quando ela está de fato valendo — a
 * sequência está de pé apoiada no último dia útil registrado, e o dia útil de
 * hoje ainda está em aberto. Anunciar "segunda chance ativada" para quem já
 * registrou hoje seria alarme falso.
 */
function encouragement(streak: number, registeredToday: boolean, today: string): string {
  if (streak === 0) return 'Registre o humor num dia útil para acender o foguinho. 🔥'

  const plural = streak === 1 ? 'dia útil ativo' : 'dias úteis ativo'
  const base = `Você está há ${streak} ${plural}! Não perca sua sequência.`
  const onGrace = !registeredToday && !isWeekendYmd(today)
  return onGrace ? `${base} ❄️ Segunda chance ativada — não falte amanhã!` : base
}

function StatCard({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-outline-variant/40 bg-surface-container-low px-md py-lg">
      <span className="font-headline text-headline-md font-bold text-on-surface">{value}</span>
      <span className="mt-1 font-label text-label-sm text-on-surface-variant">{label}</span>
    </div>
  )
}

export function StreakPanel({ onClose }: { onClose: () => void }) {
  const summary = useStreakSummary()
  const today = summary.data?.today ?? todaySaoPaulo()
  const [monthRef, setMonthRef] = useState(() => today.slice(0, 7))
  const calendar = useStreakCalendar(monthRef)

  useEffect(() => {
    if (summary.data?.today) setMonthRef(summary.data.today.slice(0, 7))
  }, [summary.data?.today])

  const boostDays = new Set(calendar.data?.days ?? [])
  const grid = buildMonthGrid(monthRef)
  const [year, month] = monthRef.split('-').map(Number)
  const monthLabel = `${MONTH_NAMES_PT[month - 1]} ${year}`

  return (
    <div
      role="dialog"
      aria-label="Ofensiva"
      className="fixed inset-x-sm top-[4.75rem] z-50 max-h-[calc(100vh-5.5rem)] overflow-y-auto rounded-2xl border border-outline-variant/40 bg-surface-container p-md shadow-lg md:absolute md:left-auto md:right-0 md:top-full md:mt-sm md:max-h-none md:w-[min(90vw,720px)] md:overflow-visible md:p-lg"
    >
      <div className="mb-lg flex items-center justify-between">
        <h2 className="flex items-center gap-sm font-headline text-title-lg font-bold text-on-surface">
          <span aria-hidden>🔥</span> Ofensiva
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

      <p className="mb-lg rounded-xl border border-primary/25 bg-primary/5 px-md py-sm text-body-sm text-on-surface">
        {encouragement(
          summary.data?.currentStreak ?? 0,
          summary.data?.registeredToday ?? true,
          today,
        )}
      </p>

      <div className="grid gap-lg md:grid-cols-2">
        {/* Calendário */}
        <div className="rounded-xl border border-outline-variant/40 bg-surface-container-low p-md">
          <div className="mb-md flex items-center justify-between">
            <button
              type="button"
              onClick={() => setMonthRef((r) => shiftMonth(r, -1))}
              aria-label="Mês anterior"
              className="rounded-full px-sm py-1 text-on-surface-variant hover:bg-surface-container-highest"
            >
              ‹
            </button>
            <span className="font-label text-label-lg font-bold uppercase tracking-wide text-on-surface">
              {monthLabel}
            </span>
            <button
              type="button"
              onClick={() => setMonthRef((r) => shiftMonth(r, 1))}
              aria-label="Próximo mês"
              className="rounded-full px-sm py-1 text-on-surface-variant hover:bg-surface-container-highest"
            >
              ›
            </button>
          </div>

          <div className="mb-sm grid grid-cols-7 gap-1 text-center font-label text-label-sm text-on-surface-variant">
            {WEEKDAY_INITIALS.map((d, i) => (
              <span key={i}>{d}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {grid.map((cell) => {
              const weekend = isWeekendYmd(cell.ymd)
              const hasBoost = cell.inMonth && !weekend && boostDays.has(cell.ymd)
              const isToday = cell.ymd === today
              const monthName = MONTH_NAMES_PT[Number(cell.ymd.slice(5, 7)) - 1]
              return (
                <div
                  key={cell.ymd}
                  aria-label={hasBoost ? `${cell.day} de ${monthName} — com boost` : undefined}
                  className={[
                    'flex aspect-square items-center justify-center rounded-full font-label text-label-md',
                    !cell.inMonth || weekend ? 'text-on-surface-variant' : 'text-on-surface',
                    hasBoost ? 'bg-primary/20 font-bold text-primary' : '',
                    isToday && !weekend && !hasBoost ? 'ring-1 ring-primary' : '',
                    isToday && !weekend && hasBoost ? 'ring-2 ring-primary' : '',
                  ].join(' ')}
                >
                  {hasBoost ? '🔥' : cell.day}
                </div>
              )
            })}
          </div>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-2 gap-md content-start">
          <StatCard value={summary.data?.currentStreak ?? 0} label="Streak atual" />
          <StatCard value={summary.data?.bestStreak ?? 0} label="Melhor streak" />
          <div className="col-span-2">
            <StatCard value={calendar.data?.count ?? 0} label="Boosts no mês" />
          </div>
        </div>
      </div>

      {/* As regras da sequência ficam no Manual do Game, e só lá: repetidas
          aqui, divergiriam do manual no primeiro ajuste de texto. */}
      <Link
        to="/manual-game"
        onClick={onClose}
        className="group mt-lg flex items-center gap-sm rounded-xl border border-outline-variant/40 bg-surface-container-low px-md py-sm"
      >
        <Icon name="help_center" className="text-[20px] text-primary" />
        <span className="flex-1 font-label text-label-md text-on-surface group-hover:underline">
          Como funciona o Streak
        </span>
        <Icon
          name="arrow_forward"
          className="text-[16px] text-on-surface-variant transition-transform group-hover:translate-x-0.5"
        />
      </Link>
    </div>
  )
}

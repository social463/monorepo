import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  MONTH_LABELS,
  tenureLabel,
  type BirthdayDTO,
  type PublicUser,
  type WorkAnniversaryDTO,
} from '@legends/shared'
import { useCelebrations } from '../lib/use-celebrations'
import { Avatar } from '../components/Avatar'
import { Icon } from '../components/Icon'

/** Qual celebração a aba mostra. As duas têm a mesma tela; muda só o conteúdo. */
type Mode = 'aniversarios' | 'tempo-de-casa'

const TABS: { key: Mode; label: string; icon: string }[] = [
  { key: 'aniversarios', label: 'Aniversariantes', icon: 'cake' },
  { key: 'tempo-de-casa', label: 'Tempo de casa', icon: 'workspace_premium' },
]

function isMode(value: string | null): value is Mode {
  return TABS.some((tab) => tab.key === value)
}

/** Quantas linhas por página na listagem do mês. */
const PAGE_SIZE = 10

/** Mês de referência (YYYY-MM) somado de `delta` meses. */
function shiftMonth(ref: string, delta: number): string {
  const [year, month] = ref.split('-').map(Number)
  const total = year! * 12 + (month! - 1) + delta
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

function monthLabel(ref: string): string {
  const [year, month] = ref.split('-').map(Number)
  return `${MONTH_LABELS[month!]} de ${year}`
}

function monthName(ref: string): string {
  return MONTH_LABELS[Number(ref.split('-')[1])]!
}

function currentMonthRef(today: Date): string {
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
}

/** "12 de agosto", a partir de uma data civil YYYY-MM-DD. Sem `Date`, sem fuso. */
function dayLabel(ymd: string): string {
  const [, month, day] = ymd.split('-').map(Number)
  return `${day} de ${MONTH_LABELS[month!]}`
}

/** Linha da listagem, normalizada: os dois modos viram a mesma forma. */
type Row = {
  user: PublicUser
  day: number
  month: number
  /** Anos completos de casa — só no modo `tempo-de-casa`. */
  years: number | null
}

function toRow(entry: BirthdayDTO | WorkAnniversaryDTO): Row {
  return { user: entry.user, day: entry.day, month: entry.month, years: 'years' in entry ? entry.years : null }
}

/** Setor de quem comemora — o cargo só entra quando o setor não veio. */
function subtitleOf(user: PublicUser): string {
  return user.sectorName || user.position || ''
}

type Status = { label: string; tone: 'today' | 'upcoming' | 'past' }

/**
 * Status da data em relação a hoje. A comparação é entre strings YYYY-MM-DD
 * (`referenceDay` vem do servidor, em America/Sao_Paulo) — montar um `Date` aqui
 * traria o fuso do navegador de volta para dentro da conta.
 */
function statusFor(occurrence: string, referenceDay: string): Status {
  if (occurrence === referenceDay) return { label: 'Hoje', tone: 'today' }
  if (occurrence < referenceDay) return { label: 'Realizado', tone: 'past' }
  return { label: 'A comemorar', tone: 'upcoming' }
}

const STATUS_CLASS: Record<Status['tone'], string> = {
  today: 'border-primary/50 bg-primary/10 text-primary',
  upcoming: 'border-outline-variant/60 bg-surface-container text-on-surface',
  past: 'border-outline-variant/40 text-on-surface-variant',
}

/**
 * Aniversariantes: os de nascimento e os de casa, em duas abas com a mesma
 * tela — destaque de quem comemora hoje e a listagem do mês, com busca por nome
 * e navegação entre meses.
 *
 * Antes `/aniversarios` só redirecionava para o calendário com dois filtros
 * ligados; a tela própria existe porque a pergunta é "de quem é o mês", e o
 * calendário responde "o que acontece no dia". A aba vai na URL (`?aba=`) para
 * o card de tempo de casa da Home poder abrir direto na dele.
 */
export function BirthdaysPage({ today = new Date() }: { today?: Date }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('aba')
  const mode: Mode = isMode(requested) ? requested : 'aniversarios'

  const [monthRef, setMonthRef] = useState(() => currentMonthRef(today))
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const { birthdays, workAnniversaries, referenceDay, isLoading, isError } = useCelebrations(monthRef)

  const source = mode === 'aniversarios' ? birthdays : workAnniversaries
  // O destaque é sempre sobre HOJE, mesmo folheando outro mês: `upcoming` já vem
  // calculado a partir da data corrente, e `daysUntil === 0` é quem comemora hoje.
  const todayRows = useMemo(() => source.upcoming.filter((e) => e.daysUntil === 0).map(toRow), [source.upcoming])

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase()
    const all = source.month.map(toRow)
    return term ? all.filter((row) => row.user.name.toLowerCase().includes(term)) : all
  }, [source.month, query])

  // Página derivada, não sincronizada por efeito: filtrar até sobrar menos
  // páginas não pode deixar a tela numa página que não existe mais.
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const atCurrentMonth = monthRef === currentMonthRef(today)
  const todayYmd = referenceDay ?? `${currentMonthRef(today)}-${String(today.getDate()).padStart(2, '0')}`

  function selectTab(key: Mode) {
    const next = new URLSearchParams(searchParams)
    next.set('aba', key)
    setSearchParams(next, { replace: true })
    setPage(1)
  }

  function goToMonth(next: string) {
    setMonthRef(next)
    setPage(1)
  }

  return (
    <section className="mx-auto flex max-w-page flex-col gap-lg p-lg md:p-xl">
      <header>
        <h1 className="font-headline text-headline-xl text-on-surface">Aniversariantes</h1>
        <p className="mt-2 text-body-md text-on-surface-variant">
          Celebrar pessoas faz parte da nossa cultura 🎉
        </p>
      </header>

      {/* Segmentado, não abas com sublinhado: são duas visões irmãs da mesma
          tela (mesma tabela, mesmos controles), e o segmentado diz "escolha um
          conteúdo" em vez de "navegue para outra seção". */}
      <div
        role="tablist"
        aria-label="Tipo de celebração"
        className="inline-flex w-fit gap-1 rounded-full bg-surface-container p-1"
      >
        {TABS.map((tab) => {
          const isActive = tab.key === mode
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => selectTab(tab.key)}
              className={`inline-flex items-center gap-xs whitespace-nowrap rounded-full px-lg py-sm font-label text-label-md transition-colors ${
                isActive
                  ? 'bg-surface text-on-surface shadow-sm'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <Icon name={tab.icon} className="text-[18px]" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {isLoading && <p className="text-body-sm text-on-surface-variant">Carregando…</p>}
      {isError && (
        <p role="alert" className="text-body-sm text-error">
          Não foi possível carregar os aniversariantes.
        </p>
      )}

      {!isLoading && !isError && (
        <>
          <TodayHighlight mode={mode} rows={todayRows} todayYmd={todayYmd} />

          <section className="flex flex-col gap-md rounded-2xl border border-outline-variant/40 bg-surface-container-low p-md md:p-lg">
            <div className="flex flex-col gap-sm md:flex-row md:items-center md:justify-between">
              <label className="flex min-w-0 flex-1 items-center gap-sm rounded-full border border-outline-variant/50 bg-surface px-md py-sm focus-within:border-primary">
                <Icon name="search" className="text-[20px] text-on-surface-variant" />
                <span className="sr-only">Pesquisar por nome</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setPage(1)
                  }}
                  placeholder="Pesquisar por nome…"
                  className="min-w-0 flex-1 bg-transparent text-body-md text-on-surface outline-none placeholder:text-on-surface-variant"
                />
              </label>

              <div className="flex shrink-0 items-center gap-xs self-start rounded-full border border-outline-variant/50 bg-surface p-1 md:self-auto">
                <button
                  type="button"
                  aria-label="Mês anterior"
                  onClick={() => goToMonth(shiftMonth(monthRef, -1))}
                  className="rounded-full p-sm text-on-surface-variant transition-colors hover:bg-surface-container"
                >
                  <Icon name="chevron_left" className="text-[20px]" />
                </button>
                <p className="min-w-[9rem] text-center font-label text-label-lg text-on-surface first-letter:uppercase">
                  {monthLabel(monthRef)}
                </p>
                <button
                  type="button"
                  aria-label="Próximo mês"
                  onClick={() => goToMonth(shiftMonth(monthRef, 1))}
                  className="rounded-full p-sm text-on-surface-variant transition-colors hover:bg-surface-container"
                >
                  <Icon name="chevron_right" className="text-[20px]" />
                </button>
                {!atCurrentMonth && (
                  <button
                    type="button"
                    onClick={() => goToMonth(currentMonthRef(today))}
                    className="rounded-full px-md py-1 font-label text-label-sm text-primary transition-colors hover:bg-primary/10"
                  >
                    Mês atual
                  </button>
                )}
              </div>
            </div>

            <MonthTable mode={mode} rows={pageRows} monthRef={monthRef} referenceDay={todayYmd} />

            {rows.length > 0 && (
              <div className="flex flex-col gap-sm text-body-sm text-on-surface-variant md:flex-row md:items-center md:justify-between">
                <span>
                  {rows.length} {rows.length === 1 ? 'aniversariante' : 'aniversariantes'} em{' '}
                  {monthName(monthRef)}
                </span>
                <Pager page={currentPage} totalPages={totalPages} onChange={setPage} />
              </div>
            )}
          </section>
        </>
      )}
    </section>
  )
}

/** O destaque do dia: quem comemora hoje, ou o aviso de que não há ninguém. */
function TodayHighlight({ mode, rows, todayYmd }: { mode: Mode; rows: Row[]; todayYmd: string }) {
  const isBirthday = mode === 'aniversarios'

  return (
    <section className="flex flex-col gap-md">
      <h2 className="flex items-center gap-sm font-headline text-headline-sm text-on-surface">
        <Icon name={isBirthday ? 'auto_awesome' : 'celebration'} className="text-[22px] text-primary" />
        <span className="first-letter:uppercase">Hoje, {dayLabel(todayYmd)}</span>
      </h2>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-xs rounded-2xl border border-dashed border-outline-variant/60 p-xl text-center">
          <Icon name={isBirthday ? 'cake' : 'workspace_premium'} className="text-[36px] text-outline" />
          <p className="font-label text-label-md text-on-surface-variant">
            {isBirthday ? 'Nenhum aniversariante hoje' : 'Nenhum aniversário de empresa hoje'}
          </p>
          <p className="text-body-sm text-on-surface-variant">
            {isBirthday
              ? 'Veja os próximos aniversários abaixo 👇'
              : 'Confira os aniversários de empresa do mês abaixo 👇'}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-outline-variant/40 bg-gradient-to-br from-primary/10 via-surface-container-low to-surface-container-low p-md md:p-lg">
          <div className="mb-md flex items-center justify-between gap-sm">
            <span className="inline-flex items-center gap-xs rounded-full bg-surface px-md py-1 font-label text-label-sm text-primary">
              <Icon name={isBirthday ? 'cake' : 'celebration'} className="text-[16px]" />
              {isBirthday ? 'Aniversário 🎂' : 'Aniversário de empresa 🎉'}
            </span>
            {rows.length > 1 && (
              <span className="rounded-full bg-primary/10 px-md py-1 font-label text-label-sm text-primary">
                {rows.length} pessoas
              </span>
            )}
          </div>

          <p className="mb-md font-label text-label-lg text-on-surface">{highlightText(mode, rows)}</p>

          <ul className="grid gap-sm sm:grid-cols-2">
            {rows.map((row) => (
              <li key={row.user.id} className="flex items-center gap-md rounded-xl bg-surface/70 p-sm">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-primary/40 bg-surface-container-highest">
                  <Avatar user={row.user} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-label text-label-md font-bold text-on-surface">{row.user.name}</p>
                  <p className="truncate text-body-sm text-on-surface-variant">
                    {subtitleOf(row.user)}
                    {row.years !== null && ` · ${row.years} ${row.years === 1 ? 'ano' : 'anos'}`}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

/** "Hoje é aniversário de Ana!" / "2 anos de casa hoje". */
function highlightText(mode: Mode, rows: Row[]): string {
  if (mode === 'aniversarios') {
    return rows.length === 1
      ? `Hoje é aniversário de ${rows[0]!.user.name.split(' ')[0]}!`
      : `${rows.length} pessoas fazem aniversário hoje!`
  }
  return rows.length === 1
    ? `${tenureLabel(rows[0]!.years ?? 1)} hoje`
    : `${rows.length} pessoas comemoram tempo de casa hoje`
}

/** A listagem do mês: aniversariante, período, data e status. */
function MonthTable({
  mode,
  rows,
  monthRef,
  referenceDay,
}: {
  mode: Mode
  rows: Row[]
  monthRef: string
  referenceDay: string
}) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-xs rounded-xl border border-outline-variant/40 p-xl text-center">
        <Icon name="group" className="text-[32px] text-outline" />
        <p className="font-label text-label-md text-on-surface">Nenhum aniversariante encontrado</p>
        <p className="text-body-sm text-on-surface-variant">
          Ninguém comemora neste mês, ou nenhum nome bate com a busca.
        </p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-outline-variant/40 bg-surface">
      <table className="w-full text-left text-body-sm">
        <thead className="border-b border-outline-variant/30 text-on-surface-variant">
          <tr>
            <th className="px-md py-sm font-label text-label-sm font-normal">Aniversariante</th>
            <th className="hidden px-md py-sm font-label text-label-sm font-normal md:table-cell">Período</th>
            <th className="px-md py-sm font-label text-label-sm font-normal">Data</th>
            <th className="px-md py-sm text-right font-label text-label-sm font-normal">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const occurrence = `${monthRef}-${String(row.day).padStart(2, '0')}`
            const status = statusFor(occurrence, referenceDay)
            return (
              <tr key={row.user.id} className="border-b border-outline-variant/20 last:border-0">
                <td className="px-md py-sm">
                  <div className="flex items-center gap-sm">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-outline-variant/50 bg-surface-container-highest">
                      <Avatar user={row.user} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-label text-label-md text-on-surface">{row.user.name}</p>
                      <p className="truncate text-body-sm text-on-surface-variant">{subtitleOf(row.user)}</p>
                    </div>
                  </div>
                </td>
                <td className="hidden px-md py-sm text-on-surface-variant md:table-cell">
                  <span className="first-letter:uppercase">{MONTH_LABELS[row.month]}</span>
                  {row.years !== null && (
                    <span className="ml-1">
                      · {row.years} {row.years === 1 ? 'ano' : 'anos'}
                    </span>
                  )}
                </td>
                <td className="px-md py-sm">
                  <span className="inline-flex items-center gap-xs font-label text-label-md text-on-surface">
                    <Icon
                      name={mode === 'aniversarios' ? 'cake' : 'workspace_premium'}
                      className="text-[16px] text-primary"
                    />
                    {String(row.day).padStart(2, '0')}/{String(row.month).padStart(2, '0')}
                  </span>
                </td>
                <td className="px-md py-sm text-right">
                  <span
                    className={`inline-flex rounded-full border px-sm py-0.5 font-label text-label-sm ${STATUS_CLASS[status.tone]}`}
                  >
                    {status.label}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** Primeira, anterior, N/M, próxima, última. */
function Pager({
  page,
  totalPages,
  onChange,
}: {
  page: number
  totalPages: number
  onChange: (page: number) => void
}) {
  const step = 'rounded-full px-sm py-0.5 transition-colors hover:bg-surface-container disabled:opacity-40 disabled:hover:bg-transparent'
  return (
    <div className="flex items-center gap-xs">
      <button type="button" aria-label="Primeira página" disabled={page === 1} onClick={() => onChange(1)} className={step}>
        «
      </button>
      <button
        type="button"
        aria-label="Página anterior"
        disabled={page === 1}
        onClick={() => onChange(page - 1)}
        className={step}
      >
        ‹
      </button>
      <span className="px-sm font-label text-label-sm text-on-surface">
        {page} / {totalPages}
      </span>
      <button
        type="button"
        aria-label="Próxima página"
        disabled={page === totalPages}
        onClick={() => onChange(page + 1)}
        className={step}
      >
        ›
      </button>
      <button
        type="button"
        aria-label="Última página"
        disabled={page === totalPages}
        onClick={() => onChange(totalPages)}
        className={step}
      >
        »
      </button>
    </div>
  )
}

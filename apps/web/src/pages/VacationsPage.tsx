import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MONTH_LABELS, type VacationDTO } from '@legends/shared'
import { fetchMonthVacations } from '../lib/vacations-api'
import { Avatar } from '../components/Avatar'
import { Icon } from '../components/Icon'

/** `2026-08-12` → `12/08`. Corte de string, sem `Date` e sem fuso. */
function shortDate(ymd: string): string {
  const [, month, day] = ymd.split('-')
  return `${day}/${month}`
}

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

/** Data civil local em YYYY-MM-DD. */
function ymdOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * Férias do Mês: quem está fora agora e quem sai no resto do mês, da empresa
 * inteira.
 *
 * Fica em Comunicação, ao lado dos aniversariantes, e não no calendário: a
 * pergunta que ela responde é "posso contar com fulano esta semana?", não "o
 * que tem na agenda do dia 12".
 */
export function VacationsPage({ today = new Date() }: { today?: Date }) {
  const todayYmd = ymdOf(today)
  const [monthRef, setMonthRef] = useState(() => todayYmd.slice(0, 7))

  const { data, isLoading, isError } = useQuery({
    queryKey: ['vacations', 'month', monthRef],
    queryFn: () => fetchMonthVacations(monthRef),
  })

  const { ongoing, upcoming } = useMemo(() => {
    const all = data?.vacations ?? []
    return {
      ongoing: all.filter((v) => v.startDate <= todayYmd && todayYmd <= v.endDate),
      // "A começar" só faz sentido no mês corrente; nos outros, tudo que não
      // está em curso é simplesmente o que está previsto.
      upcoming: all.filter((v) => v.startDate > todayYmd || v.endDate < todayYmd),
    }
  }, [data, todayYmd])

  return (
    <section className="mx-auto flex max-w-page flex-col gap-lg p-lg md:p-xl">
      <header>
        <h1 className="font-headline text-headline-xl text-on-surface">Férias do mês</h1>
        <p className="mt-2 text-body-md text-on-surface-variant">
          Quem está de férias agora e quem sai no decorrer do mês.
        </p>
      </header>

      <div className="flex items-center gap-md">
        <button
          type="button"
          aria-label="Mês anterior"
          onClick={() => setMonthRef((ref) => shiftMonth(ref, -1))}
          className="rounded-full p-sm text-on-surface-variant transition-colors hover:bg-surface-container"
        >
          <Icon name="chevron_left" className="text-[20px]" />
        </button>
        <p className="min-w-[12rem] text-center font-label text-label-lg capitalize text-on-surface">
          {monthLabel(monthRef)}
        </p>
        <button
          type="button"
          aria-label="Próximo mês"
          onClick={() => setMonthRef((ref) => shiftMonth(ref, 1))}
          className="rounded-full p-sm text-on-surface-variant transition-colors hover:bg-surface-container"
        >
          <Icon name="chevron_right" className="text-[20px]" />
        </button>
      </div>

      {isLoading && <p className="text-body-sm text-on-surface-variant">Carregando…</p>}
      {isError && (
        <p role="alert" className="text-body-sm text-error">
          Não foi possível carregar as férias do mês.
        </p>
      )}

      {!isLoading && !isError && (
        <>
          <VacationGroup title="De férias agora" vacations={ongoing} emptyText="Ninguém de férias hoje." />
          <VacationGroup
            title="No resto do mês"
            vacations={upcoming}
            emptyText="Nenhum outro período neste mês."
          />
        </>
      )}
    </section>
  )
}

function VacationGroup({
  title,
  vacations,
  emptyText,
}: {
  title: string
  vacations: VacationDTO[]
  emptyText: string
}) {
  return (
    <section>
      <h2 className="mb-md font-headline text-headline-sm text-on-surface">{title}</h2>
      {vacations.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">{emptyText}</p>
      ) : (
        <ul className="grid gap-md sm:grid-cols-2">
          {vacations.map((vacation) => (
            <li
              key={vacation.id}
              className="flex items-center gap-md rounded-xl border border-outline-variant/40 bg-surface-container-low p-md"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full border border-outline-variant/50 bg-surface-container-highest">
                <Avatar user={vacation.user} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-label text-label-md text-on-surface">{vacation.user.name}</p>
                <p className="truncate text-body-sm text-on-surface-variant">
                  {vacation.user.sectorName ?? vacation.user.position ?? ''}
                </p>
                <p className="mt-1 flex items-center gap-1 text-body-sm text-on-surface-variant">
                  <Icon name="beach_access" className="text-[16px] text-primary" />
                  {shortDate(vacation.startDate)} a {shortDate(vacation.endDate)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

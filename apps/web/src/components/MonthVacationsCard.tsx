import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { VacationDTO } from '@legends/shared'
import { fetchMonthVacations } from '../lib/vacations-api'
import { Avatar } from './Avatar'
import { Icon } from './Icon'

/**
 * Quantas pessoas cabem no card antes do "ver todas".
 *
 * Três, e não quatro: a coluna da direita da Home empilha quatro blocos, e a
 * G&G apontou que férias e ranking ocupavam espaço demais. O resto continua a um
 * clique no "Ver todas".
 */
const PREVIEW = 3

/** `2026-08-12` → `12/08`. Comparação e corte de string, sem `Date` nem fuso. */
function shortDate(ymd: string): string {
  const [, month, day] = ymd.split('-')
  return `${day}/${month}`
}

/**
 * Bloco de férias da Home, no mesmo formato dos aniversariantes: quem está de
 * férias no mês, de quando a quando. Quem já está fora hoje aparece primeiro e
 * leva o selo "Ausente" — é a informação que muda a decisão de quem procura a
 * pessoa agora, e o card mistura quem já voltou com quem ainda nem saiu.
 */
export function MonthVacationsCard({ today = new Date() }: { today?: Date }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['vacations', 'month'],
    queryFn: () => fetchMonthVacations(),
  })

  // Enquanto carrega (ou se falhar) o card não aparece: é conteúdo acessório,
  // mesma postura de BirthdaysCard.
  if (isLoading || isError) return null

  const todayYmd = ymdOf(today)
  const vacations = [...(data?.vacations ?? [])].sort(byOngoingFirst(todayYmd))
  const preview = vacations.slice(0, PREVIEW)

  return (
    <aside
      data-testid="month-vacations-card"
      className="flex min-w-0 flex-col gap-md rounded-2xl border border-outline-variant/40 bg-surface-container-low p-lg"
    >
      <h2 className="flex items-center gap-sm font-headline text-body-lg font-semibold text-on-surface">
        <Icon name="beach_access" className="text-[20px] text-primary" />
        Férias do mês
      </h2>

      {preview.length === 0 ? (
        <p className="text-body-sm text-on-surface-variant">Ninguém de férias neste mês.</p>
      ) : (
        <ul className="flex flex-col gap-xs">
          {preview.map((vacation) => {
            const ongoing = isOngoing(vacation, todayYmd)
            return (
              // Uma linha por pessoa, e não duas: nome e período dividem a
              // mesma linha, e "Ausente" virou um ponto — a informação é a
              // mesma, a altura do bloco caiu pela metade.
              <li key={vacation.id} className="flex items-center gap-sm">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-outline-variant/50 bg-surface-container-highest">
                  <Avatar user={vacation.user} />
                </div>
                {ongoing && (
                  <span
                    aria-label="Ausente hoje"
                    title="Ausente hoje"
                    className="h-2 w-2 shrink-0 rounded-full bg-primary"
                  />
                )}
                <p className="min-w-0 flex-1 truncate font-label text-label-md text-on-surface">
                  {vacation.user.name}
                </p>
                <span className="shrink-0 text-body-sm text-on-surface-variant">
                  {shortDate(vacation.startDate)}–{shortDate(vacation.endDate)}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      <Link to="/ferias" className="group flex items-center gap-1 font-label text-label-md text-primary">
        <span className="group-hover:underline">
          {vacations.length > PREVIEW ? `Ver todas (${vacations.length})` : 'Ver férias do mês'}
        </span>
        <Icon name="arrow_forward" className="text-[16px] transition-transform group-hover:translate-x-0.5" />
      </Link>
    </aside>
  )
}

/** Data civil local em YYYY-MM-DD, para comparar com as datas da API. */
function ymdOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function isOngoing(vacation: VacationDTO, todayYmd: string): boolean {
  return vacation.startDate <= todayYmd && todayYmd <= vacation.endDate
}

/** Quem está fora hoje primeiro; depois por data de início. */
function byOngoingFirst(todayYmd: string) {
  return (a: VacationDTO, b: VacationDTO): number => {
    const diff = Number(isOngoing(b, todayYmd)) - Number(isOngoing(a, todayYmd))
    return diff !== 0 ? diff : a.startDate.localeCompare(b.startDate)
  }
}

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { APPRENTICE_LOCKED_MESSAGE, type ApprenticePortfolioOverviewDTO } from '@legends/shared'
import { Skeleton } from '../../components/Skeleton'
import {
  fetchApprenticePeople,
  fetchApprenticePortfolio,
  fetchApprenticePortfolioOverview,
} from '../../lib/apprentice-api'
import { ActivityForm } from './ActivityForm'
import { MeetingSeal } from './MeetingSeal'
import { useApprenticeFacilitator } from './use-apprentice-facilitator'

/**
 * Uma página por encontro, com o que a pessoa entregou. As fichas vêm em modo
 * leitura: o portfólio é para reler, e o envio acontece na tela do encontro.
 *
 * O facilitador abre na TURMA, não num aprendiz: ele não é aprendiz, não tem
 * portfólio próprio, e pedir o dele devolvia "Aprendiz não encontrado.". Da
 * visão de turma ele entra no portfólio de quem quiser, pelo seletor ou pelo
 * card.
 */
export function PortfolioPage() {
  const isFacilitator = useApprenticeFacilitator()
  const [selected, setSelected] = useState<string | null>(null)
  const showOverview = isFacilitator && selected === null

  const people = useQuery({
    queryKey: ['apprentice', 'people'],
    queryFn: fetchApprenticePeople,
    enabled: isFacilitator,
  })

  const overview = useQuery({
    queryKey: ['apprentice', 'portfolio', 'overview'],
    queryFn: fetchApprenticePortfolioOverview,
    enabled: showOverview,
    retry: false,
  })

  const portfolio = useQuery({
    queryKey: ['apprentice', 'portfolio', selected],
    queryFn: () => fetchApprenticePortfolio(selected ?? undefined),
    enabled: !showOverview,
    retry: false,
  })

  const picker = isFacilitator && (
    <label className="flex flex-col gap-xs">
      <span className="font-label text-label-sm uppercase text-on-surface-variant">
        Ver portfólio de
      </span>
      <select
        value={selected ?? ''}
        onChange={(event) => setSelected(event.target.value || null)}
        className="rounded-lg border border-outline-variant bg-surface px-md py-sm font-body text-body-md text-on-surface"
      >
        <option value="">Todos os aprendizes</option>
        {people.data?.map((person) => (
          <option key={person.id} value={person.id}>
            {person.name}
          </option>
        ))}
      </select>
    </label>
  )

  if (showOverview) {
    if (overview.isPending) return <Skeleton className="h-96 w-full rounded-xl" />
    if (overview.error || !overview.data) {
      return (
        <p className="rounded-xl bg-surface-container p-lg font-body text-body-md text-on-surface-variant">
          {overview.error instanceof Error ? overview.error.message : 'Portfólio indisponível.'}
        </p>
      )
    }
    return <ClassOverview data={overview.data} picker={picker} onOpen={setSelected} />
  }

  const { data, isPending, error } = portfolio

  if (isPending) return <Skeleton className="h-96 w-full rounded-xl" />

  if (error || !data) {
    return (
      <p className="rounded-xl bg-surface-container p-lg font-body text-body-md text-on-surface-variant">
        {error instanceof Error ? error.message : 'Portfólio indisponível.'}
      </p>
    )
  }

  const percent =
    data.totalMeetings > 0 ? Math.round((data.completedMeetings / data.totalMeetings) * 100) : 0

  return (
    <div className="flex flex-col gap-xl">
      <header className="flex flex-wrap items-end justify-between gap-lg">
        <div>
          <h2 className="font-headline text-headline-md text-on-surface">{data.person.name}</h2>
          <p className="font-body text-body-sm text-on-surface-variant">
            {data.person.className ?? 'Sem turma'}
          </p>
        </div>
        {picker}
      </header>

      <section className="rounded-xl bg-surface-container p-lg">
        <p className="font-label text-label-lg text-on-surface">
          {percent}% concluído — {data.completedMeetings} de {data.totalMeetings} encontros
        </p>
        <div className="mt-sm h-3 w-full overflow-hidden rounded-full bg-surface-container-highest">
          <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
      </section>

      <div className="flex flex-col gap-lg">
        {data.meetings.map((page) => {
          const submissions = new Map(page.submissions.map((row) => [row.activityId, row]))
          return (
            <section
              key={page.meeting.id}
              className="flex flex-col gap-lg rounded-xl border border-outline-variant/40 bg-surface-container p-lg"
            >
              <div className="flex items-start gap-md">
                <MeetingSeal
                  order={page.meeting.order}
                  size="sm"
                  done={page.meeting.completed}
                  locked={!page.meeting.unlocked}
                />
                <div className="min-w-0 flex-1">
                  <p className="font-label text-label-lg text-on-surface">
                    Encontro {page.meeting.order} · {page.meeting.title}
                  </p>
                  <p className="font-body text-body-sm text-on-surface-variant">
                    {page.meeting.submittedCount}/{page.meeting.activityCount} fichas enviadas
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-md py-xs font-label text-label-sm ${
                    page.meeting.completed
                      ? 'bg-primary/15 text-on-primary-container'
                      : 'bg-surface-container-highest text-on-surface-variant'
                  }`}
                >
                  {page.meeting.completed ? 'Concluído' : 'Pendente'}
                </span>
              </div>

              {!page.meeting.unlocked ? (
                <p className="font-body text-body-sm text-on-surface-variant">
                  {APPRENTICE_LOCKED_MESSAGE}
                </p>
              ) : (
                page.activities.map((activity) => (
                  <ActivityForm
                    key={activity.id}
                    activity={activity}
                    submission={submissions.get(activity.id)}
                    meetingId={page.meeting.id}
                    readOnly
                  />
                ))
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

/**
 * A turma inteira: quanto cada aprendiz já entregou, e o caminho para o
 * portfólio de cada um. Situação, nunca conteúdo de ficha — é a mesma regra do
 * mural.
 */
function ClassOverview({
  data,
  picker,
  onOpen,
}: {
  data: ApprenticePortfolioOverviewDTO
  picker: React.ReactNode
  onOpen: (userId: string) => void
}) {
  const percent =
    data.activityCount > 0 ? Math.round((data.submittedCount / data.activityCount) * 100) : 0
  const completos = data.people.filter(
    (row) => data.totalMeetings > 0 && row.completedMeetings === data.totalMeetings,
  ).length

  return (
    <div className="flex flex-col gap-xl">
      <header className="flex flex-wrap items-end justify-between gap-lg">
        <div>
          <h2 className="font-headline text-headline-md text-on-surface">Todos os aprendizes</h2>
          <p className="font-body text-body-sm text-on-surface-variant">
            Visão geral da turma. Abra um portfólio para ler as fichas.
          </p>
        </div>
        {picker}
      </header>

      <section className="rounded-xl bg-surface-container p-lg">
        <p className="font-label text-label-sm uppercase tracking-wide text-on-surface-variant">
          Progresso geral da turma
        </p>
        <p className="mt-xs font-label text-label-lg text-on-surface">
          {percent}% concluído — {data.submittedCount} de {data.activityCount} entregas
        </p>
        <div className="mt-sm h-3 w-full overflow-hidden rounded-full bg-surface-container-highest">
          <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
        <div className="mt-lg grid gap-lg sm:grid-cols-2">
          <p className="font-body text-body-sm text-on-surface-variant">
            <span className="block font-headline text-headline-md text-on-surface">{completos}</span>
            aprendizes com a trilha completa
          </p>
          <p className="font-body text-body-sm text-on-surface-variant">
            <span className="block font-headline text-headline-md text-on-surface">
              {data.people.length - completos}
            </span>
            aprendizes com entregas pendentes
          </p>
        </div>
      </section>

      {data.people.length === 0 ? (
        <p className="rounded-xl bg-surface-container p-lg font-body text-body-md text-on-surface-variant">
          Nenhum aprendiz cadastrado. Marque o cargo Jovem Aprendiz em Administração › Organização.
        </p>
      ) : (
        // Os mesmos pontos de quebra dos cards de encontro e do mural: no
        // tablet a área inteira vira duas colunas ao mesmo tempo.
        <div className="grid gap-lg sm:grid-cols-2 lg:grid-cols-3">
          {data.people.map((row) => {
            const pessoal =
              data.totalMeetings > 0
                ? Math.round((row.completedMeetings / data.totalMeetings) * 100)
                : 0
            return (
              <section
                key={row.person.id}
                className="flex h-full flex-col gap-md rounded-xl border border-outline-variant/40 bg-surface-container p-lg"
              >
                <div>
                  <p className="font-label text-label-lg text-on-surface">{row.person.name}</p>
                  <p className="font-body text-body-sm text-on-surface-variant">
                    {row.person.className ?? 'Sem turma'}
                  </p>
                </div>
                <p className="font-body text-body-sm text-on-surface-variant">
                  {pessoal}% — {row.completedMeetings} de {data.totalMeetings} encontros ·{' '}
                  {row.submittedCount}/{row.activityCount} fichas
                </p>
                <div className="flex flex-wrap gap-sm">
                  {row.meetings.map((meeting) => (
                    <MeetingSeal
                      key={meeting.id}
                      order={meeting.order}
                      size="sm"
                      done={meeting.completed}
                      locked={!meeting.completed}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => onOpen(row.person.id)}
                  className="mt-auto self-start rounded-lg bg-primary px-md py-sm font-label text-label-lg text-on-primary"
                >
                  Ver portfólio completo
                </button>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router-dom'
import { APPRENTICE_DELIVERY_STATUS_LABELS, type ApprenticeDeliveryStatus } from '@legends/shared'
import { Icon } from '../../components/Icon'
import { Skeleton } from '../../components/Skeleton'
import { fetchApprenticeMeeting } from '../../lib/apprentice-api'
import { ActivityForm } from './ActivityForm'
import { MeetingSeal } from './MeetingSeal'
import { SurveyCard } from './SurveyCard'

function deliveryCls(status: ApprenticeDeliveryStatus): string {
  if (status === 'ENTREGUE') return 'bg-primary/15 text-on-primary-container'
  if (status === 'NAO_ENTREGUE') return 'bg-error/10 text-error'
  return 'bg-surface-container-highest text-on-surface-variant'
}

export function MeetingPage() {
  const { id = '' } = useParams()
  const { data, isPending, error } = useQuery({
    queryKey: ['apprentice', 'meeting', id],
    queryFn: () => fetchApprenticeMeeting(id),
    retry: false,
  })

  if (isPending) return <Skeleton className="h-96 w-full rounded-xl" />

  if (error || !data) {
    return (
      <div className="rounded-xl bg-surface-container p-lg">
        <p className="font-body text-body-md text-on-surface">
          {error instanceof Error ? error.message : 'Encontro não encontrado.'}
        </p>
        <Link to="/eu-aprendiz" className="mt-sm inline-block font-label text-label-lg text-on-primary-container">
          Voltar para a trilha
        </Link>
      </div>
    )
  }

  const { meeting } = data
  const submissionsByActivity = new Map(data.submissions.map((row) => [row.activityId, row]))

  return (
    <div className="flex flex-col gap-xl">
      <section className="rounded-xl bg-surface-container p-lg md:p-xl">
        <div className="flex items-start justify-between gap-lg">
          <div className="min-w-0">
            <p className="font-label text-label-sm uppercase tracking-wide text-on-primary-container">
              Encontro {meeting.order}
            </p>
            <h2 className="font-headline text-headline-lg text-on-surface">{meeting.title}</h2>
            <p className="font-body text-body-sm text-on-surface-variant">{meeting.theme}</p>
          </div>
          <MeetingSeal order={meeting.order} done={meeting.completed} />
        </div>

        <dl className="mt-lg grid gap-md md:grid-cols-2">
          <div className="rounded-lg bg-surface p-md">
            <dt className="font-label text-label-sm uppercase text-on-surface-variant">
              Objetivos do encontro
            </dt>
            <dd>
              <ul className="list-disc pl-lg font-body text-body-sm text-on-surface">
                {meeting.objectives.map((objective) => (
                  <li key={objective}>{objective}</li>
                ))}
              </ul>
            </dd>
          </div>
          <div className="rounded-lg bg-surface p-md">
            <dt className="font-label text-label-sm uppercase text-on-surface-variant">
              Entregável esperado
            </dt>
            <dd className="font-body text-body-sm text-on-surface">{meeting.deliverable || '—'}</dd>
          </div>
        </dl>

        {(meeting.slideUrl || data.slideDownloadUrl) && (
          <a
            href={meeting.slideUrl ?? data.slideDownloadUrl ?? undefined}
            target="_blank"
            rel="noreferrer"
            className="mt-lg inline-flex items-center gap-xs font-label text-label-lg text-on-primary-container"
          >
            <Icon name="slideshow" />
            Abrir a apresentação do encontro
          </a>
        )}
      </section>

      {data.materials.length > 0 && (
        <section className="flex flex-col gap-sm rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
          <h3 className="font-headline text-headline-sm text-on-surface">Materiais complementares</h3>
          <ul className="flex flex-col gap-xs">
            {data.materials.map((material) => (
              <li key={material.id}>
                <a
                  href={material.url ?? material.downloadUrl ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="font-label text-label-lg text-on-primary-container"
                >
                  {material.name}
                </a>
                {material.fileName && (
                  <span className="ml-xs font-body text-body-sm text-on-surface-variant">
                    {material.fileName}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-lg">
        <h3 className="font-headline text-headline-sm text-on-surface">Fichas do encontro</h3>
        {data.activities.length === 0 ? (
          <p className="font-body text-body-md text-on-surface-variant">
            Nenhuma ficha cadastrada para este encontro.
          </p>
        ) : (
          data.activities.map((activity, index) => (
            <ActivityForm
              key={activity.id}
              activity={activity}
              submission={submissionsByActivity.get(activity.id)}
              meetingId={meeting.id}
              previousCommitment={data.previousCommitment}
              defaultOpen={index === 0}
            />
          ))
        )}
      </section>

      <section className="flex flex-col gap-lg">
        <h3 className="font-headline text-headline-sm text-on-surface">Mural do encontro</h3>
        <div className="grid gap-lg sm:grid-cols-2 lg:grid-cols-3">
          {data.wall.map((entry) => (
            <article
              key={`${entry.meetingId}-${entry.person.id}`}
              className="rounded-xl border border-outline-variant/40 bg-surface-container p-lg"
            >
              <div className="flex items-start justify-between gap-sm">
                <div className="min-w-0">
                  <p className="truncate font-label text-label-lg text-on-surface">{entry.person.name}</p>
                  <p className="truncate font-body text-body-sm text-on-surface-variant">
                    {entry.person.className ?? 'Sem turma'}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-md py-xs font-label text-label-sm ${deliveryCls(entry.status)}`}
                >
                  {APPRENTICE_DELIVERY_STATUS_LABELS[entry.status]}
                </span>
              </div>
              <p className="mt-sm font-body text-body-sm text-on-surface-variant">
                {entry.submittedCount}/{entry.activityCount} fichas
              </p>
            </article>
          ))}
        </div>
      </section>

      {data.surveyOpen && <SurveyCard meetingId={meeting.id} answered={data.surveyAnswered} />}
    </div>
  )
}

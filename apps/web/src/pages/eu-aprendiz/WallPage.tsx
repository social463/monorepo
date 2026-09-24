import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  APPRENTICE_DELIVERY_STATUS_LABELS,
  APPRENTICE_DELIVERY_STATUSES,
  type ApprenticeDeliveryStatus,
} from '@legends/shared'
import { Skeleton } from '../../components/Skeleton'
import { fetchApprenticeWall } from '../../lib/apprentice-api'

function deliveryCls(status: ApprenticeDeliveryStatus): string {
  if (status === 'ENTREGUE') return 'bg-primary/15 text-on-primary-container'
  if (status === 'NAO_ENTREGUE') return 'bg-error/10 text-error'
  return 'bg-surface-container-highest text-on-surface-variant'
}

const chipCls = (active: boolean) =>
  `rounded-full border px-lg py-sm font-label text-label-md transition-colors ${
    active
      ? 'border-primary bg-primary text-on-primary'
      : 'border-outline-variant bg-surface-container text-on-surface'
  }`

/**
 * O mural mostra o STATUS da entrega, nunca o que foi escrito: o conteúdo da
 * ficha é do aprendiz e do facilitador.
 */
export function WallPage() {
  const { data, isPending } = useQuery({
    queryKey: ['apprentice', 'wall'],
    queryFn: fetchApprenticeWall,
  })
  const [status, setStatus] = useState<ApprenticeDeliveryStatus | null>(null)
  const [classId, setClassId] = useState<string | null>(null)
  const [meetingId, setMeetingId] = useState<string | null>(null)

  if (isPending) return <Skeleton className="h-96 w-full rounded-xl" />
  if (!data) return null

  const entries = data.entries.filter(
    (entry) =>
      (status === null || entry.status === status) &&
      (classId === null || entry.person.classId === classId) &&
      (meetingId === null || entry.meetingId === meetingId),
  )

  return (
    <div className="flex flex-col gap-lg">
      <header>
        <h2 className="font-headline text-headline-md text-on-surface">
          Tudo o que já foi entregue até agora
        </h2>
        <p className="font-body text-body-sm text-on-surface-variant">
          Só a situação da entrega — o conteúdo das fichas é privado.
        </p>
      </header>

      <div className="flex flex-col gap-sm">
        <div className="flex flex-wrap gap-xs">
          <button type="button" onClick={() => setStatus(null)} className={chipCls(status === null)}>
            Todos
          </button>
          {APPRENTICE_DELIVERY_STATUSES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setStatus(option)}
              className={chipCls(status === option)}
            >
              {APPRENTICE_DELIVERY_STATUS_LABELS[option]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-xs">
          <button type="button" onClick={() => setClassId(null)} className={chipCls(classId === null)}>
            Todas as turmas
          </button>
          {data.classes.map((turma) => (
            <button
              key={turma.id}
              type="button"
              onClick={() => setClassId(turma.id)}
              className={chipCls(classId === turma.id)}
            >
              {turma.name}
              {turma.shift ? ` · ${turma.shift}` : ''}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-xs">
          <button type="button" onClick={() => setMeetingId(null)} className={chipCls(meetingId === null)}>
            Todos os encontros
          </button>
          {data.meetings.map((meeting) => (
            <button
              key={meeting.id}
              type="button"
              onClick={() => setMeetingId(meeting.id)}
              className={chipCls(meetingId === meeting.id)}
            >
              Encontro {meeting.order}
            </button>
          ))}
        </div>
      </div>

      <p className="font-label text-label-md text-on-surface-variant">{entries.length} registros</p>

      {entries.length === 0 ? (
        <p className="rounded-xl bg-surface-container p-lg font-body text-body-md text-on-surface-variant">
          Nenhum registro com esses filtros.
        </p>
      ) : (
        <div className="grid gap-lg sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {entries.map((entry) => (
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
              <p className="mt-md font-label text-label-sm uppercase text-on-primary-container">
                Encontro {entry.meetingOrder}
              </p>
              <p className="mt-xs line-clamp-2 font-body text-body-sm text-on-surface-variant">
                {entry.deliverable || entry.meetingTitle}
              </p>
              <p className="mt-md font-body text-body-sm text-on-surface-variant">
                {entry.submittedCount}/{entry.activityCount} fichas
                {entry.lastSubmittedAt
                  ? ` · último envio em ${new Date(entry.lastSubmittedAt).toLocaleDateString('pt-BR')}`
                  : ''}
              </p>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

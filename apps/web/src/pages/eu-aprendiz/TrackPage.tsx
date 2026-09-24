import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  APPRENTICE_LOCKED_MESSAGE,
  APPRENTICE_MEETING_STATUS_LABELS,
  type ApprenticeTrackMeetingDTO,
} from '@legends/shared'
import { useBrandContext } from '../../brand/BrandContext'
import { Icon } from '../../components/Icon'
import { Skeleton } from '../../components/Skeleton'
import { fetchApprenticeTrack } from '../../lib/apprentice-api'
import { MeetingDetailDialog } from './MeetingDetailDialog'
import { MeetingSeal } from './MeetingSeal'
import { APPRENTICE_PROGRAM_TRAIL } from './program-theme'

function formatDate(ymd: string | null): string {
  if (!ymd) return 'sem data'
  const [year, month, day] = ymd.split('-')
  return `${day}/${month}/${year}`
}

function statusCls(meeting: ApprenticeTrackMeetingDTO): string {
  if (meeting.completed) return 'bg-primary-container text-on-surface'
  if (meeting.status === 'PROXIMO') return 'bg-primary text-on-primary'
  return 'bg-surface text-on-surface-variant'
}

export function TrackPage() {
  const { data, isPending } = useQuery({
    queryKey: ['apprentice', 'track'],
    queryFn: fetchApprenticeTrack,
  })
  const [detail, setDetail] = useState<ApprenticeTrackMeetingDTO | null>(null)
  const { scheme } = useBrandContext()

  if (isPending) return <Skeleton className="h-96 w-full rounded-xl" />
  if (!data) return null

  const done = data.meetings.filter((meeting) => meeting.completed).length
  const current = data.meetings.find((meeting) => !meeting.completed)
  // A barra mede os intervalos entre marcos, não os marcos: com 6 encontros são
  // 5 trechos, e o último marco fica no fim da linha.
  const segments = Math.max(1, data.meetings.length - 1)
  const percent = Math.min(100, Math.round((done / segments) * 100))
  // Cada marco é um `flex-1`, então o primeiro fica a meia-célula da borda e o
  // último a meia-célula do fim. A linha precisa começar e terminar NO CENTRO
  // deles — sem esta margem, o preenchimento de 20% não cai em cima do 2º marco.
  const edge = data.meetings.length > 0 ? 100 / (data.meetings.length * 2) : 0

  return (
    <div className="flex flex-col gap-xl">
      {data.makeups.length > 0 && (
        <div className="flex flex-col gap-xs rounded-xl bg-surface-container p-lg">
          {data.makeups.map((makeup) => (
            <p key={makeup.id} className="font-body text-body-md text-on-surface">
              <Icon name="event_repeat" className="mr-xs align-middle text-on-primary-container" />
              Reposição do Encontro {makeup.meetingOrder} em{' '}
              {new Date(makeup.scheduledAt).toLocaleString('pt-BR', {
                dateStyle: 'short',
                timeStyle: 'short',
              })}
              .
            </p>
          ))}
        </div>
      )}

      <section className="rounded-lg border border-outline-variant bg-surface-container px-lg py-xl md:px-xl">
        <p className="font-label text-label-sm font-semibold uppercase tracking-[0.18em] text-on-primary-container">
          Fio condutor
        </p>
        <h2 className="mt-sm font-headline text-headline-lg font-semibold text-on-surface">
          Do que eu faço{' '}
          <span aria-hidden className="text-on-primary-container">
            →
          </span>{' '}
          ao que eu levo.
        </h2>
        {/* A trilha é a régua dos encontros vista de longe: vai na MESMA
            largura da linha de selos logo abaixo. Limitada a `max-w-xl` ela
            parava no meio do card no tablet, como um desenho solto. */}
        <img
          src={APPRENTICE_PROGRAM_TRAIL[scheme]}
          alt=""
          aria-hidden
          className="mt-lg w-full"
        />

        <div className="relative mt-xl">
          {/* `top-5` é o centro do selo pequeno (h-10). Mudou o tamanho do selo,
              mude aqui — é o alinhamento da linha com as bolas. */}
          <div
            className="absolute top-5 h-1 -translate-y-1/2 rounded-full bg-surface"
            style={{ left: `${edge}%`, right: `${edge}%` }}
          />
          <div
            className="absolute top-5 h-1 -translate-y-1/2 rounded-full bg-primary transition-all duration-700"
            style={{ left: `${edge}%`, width: `calc((100% - ${edge * 2}%) * ${percent / 100})` }}
          />
          <ol className="relative flex items-start justify-between gap-xs">
            {data.meetings.map((meeting) => (
              // `min-w-0`: sem ele o "Você está aqui" (nowrap) alarga o próprio
              // marco no celular e empurra os outros uns sobre os outros.
              <li key={meeting.id} className="flex min-w-0 flex-1 flex-col items-center gap-xs">
                <MeetingSeal
                  order={meeting.order}
                  size="sm"
                  done={meeting.completed}
                  locked={!meeting.unlocked}
                />
                <span className="font-label text-label-sm text-on-surface-variant">E{meeting.order}</span>
                {current?.id === meeting.id && (
                  <span className="whitespace-nowrap rounded-full bg-primary px-sm py-xs font-label text-label-sm text-on-primary">
                    Você está aqui
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
        <p className="mt-lg font-body text-body-sm text-on-surface-variant">
          A linha avança quando as fichas do encontro são enviadas e a pesquisa é respondida.
        </p>
      </section>

      <section className="flex flex-col gap-lg">
        {/* No claro é a barra escura do protótipo; no escuro, a mesma inversão
            viraria uma faixa quase branca no meio da tela. Pelo `scheme`, e não
            por `dark:`: o Tailwind daqui não tem `darkMode: 'class'`, e o
            `dark:` seguiria o sistema operacional, não a escolha da pessoa. */}
        <h2
          className={`rounded-lg px-lg py-md font-label text-label-lg font-semibold tracking-wide ${
            scheme === 'dark' ? 'bg-surface-container-highest text-on-surface' : 'bg-on-surface text-surface'
          }`}
        >
          Os encontros
        </h2>
        <div className="grid gap-lg sm:grid-cols-2 lg:grid-cols-3">
          {data.meetings.map((meeting) => {
            const card = (
              <>
                <div className="flex items-start justify-between gap-sm">
                  <MeetingSeal
                    order={meeting.order}
                    done={meeting.completed}
                    locked={!meeting.unlocked}
                  />
                  <span
                    className={`inline-flex items-center gap-xs rounded-full px-md py-xs font-label text-label-sm font-semibold ${statusCls(meeting)}`}
                  >
                    {!meeting.completed && !meeting.unlocked && (
                      <Icon name="lock" className="text-[14px]" />
                    )}
                    <span>
                      {meeting.completed
                        ? 'Concluído'
                        : !meeting.unlocked
                          ? 'Bloqueado'
                          : APPRENTICE_MEETING_STATUS_LABELS[meeting.status]}
                    </span>
                  </span>
                </div>
                <p className="mt-lg font-label text-label-sm uppercase text-on-surface-variant">
                  Encontro {meeting.order} · {formatDate(meeting.scheduledOn)}
                </p>
                <h3 className="mt-xs font-headline text-headline-sm text-on-surface">{meeting.title}</h3>
                {meeting.unlocked ? (
                  <>
                    <p className="mt-sm line-clamp-2 font-body text-body-sm text-on-surface-variant">
                      {meeting.deliverable || meeting.theme}
                    </p>
                    <p className="mt-sm font-label text-label-sm text-on-primary-container">
                      {meeting.submittedCount}/{meeting.activityCount} fichas enviadas
                      {meeting.surveyAnswered ? ' · pesquisa respondida' : ''}
                    </p>
                    {/* `mt-auto`: os cards esticam na grade, e sem isto o
                        "Ver detalhes" fica na altura do texto de cada um —
                        visível no tablet, onde o título quebra em duas linhas
                        num card e não no vizinho. */}
                    <span className="mt-auto pt-md font-label text-label-sm font-semibold text-on-primary-container">
                      Ver detalhes
                    </span>
                  </>
                ) : (
                  <p className="mt-sm font-body text-body-sm text-on-surface-variant">
                    {APPRENTICE_LOCKED_MESSAGE}
                  </p>
                )}
              </>
            )

            const base =
              'flex flex-col rounded-lg border p-lg text-left transition-colors bg-surface-container'
            const next = meeting.status === 'PROXIMO' && !meeting.completed

            return meeting.unlocked ? (
              <button
                key={meeting.id}
                type="button"
                onClick={() => setDetail(meeting)}
                className={`${base} ${next ? 'border-primary' : 'border-outline-variant'} hover:border-primary`}
              >
                {card}
              </button>
            ) : (
              <div key={meeting.id} className={`${base} border-outline-variant opacity-90`}>
                {card}
              </div>
            )
          })}
        </div>
      </section>

      {detail && (
        <MeetingDetailDialog
          meeting={detail}
          dateLabel={formatDate(detail.scheduledOn)}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  )
}

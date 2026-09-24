import { useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  LESSON_KIND_LABELS,
  lessonKindOf,
  hasLessonContent,
  COURSE_LEVEL_LABELS,
  MAX_COURSE_RATING,
  MAX_COURSE_RATING_COMMENT_LENGTH,
  MIN_COURSE_RATING,
  type CourseDetailDTO,
  type CourseLessonDTO,
} from '@legends/shared'
import { Icon } from '../../components/Icon'
import { LessonBlocks } from './LessonBlocks'
import { Skeleton } from '../../components/Skeleton'
import { BackButton } from '../../components/BackButton'
import { ApiError } from '../../lib/api'
import {
  enrollInCourse,
  getCourse,
  rateCourse,
  requestCourseCertificate,
  setCourseFavorite,
  setLessonCompletion,
} from '../../lib/learning-api'
import { ProgressBar, durationLabel } from './CourseCard'

function flattenLessons(course: CourseDetailDTO): CourseLessonDTO[] {
  return course.modules.flatMap((module) => module.lessons)
}

function StarPicker({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <div className="flex gap-xs">
      {Array.from({ length: MAX_COURSE_RATING }, (_, index) => index + MIN_COURSE_RATING).map((star) => (
        <button
          key={star}
          type="button"
          aria-label={`Dar nota ${star}`}
          onClick={() => onChange(star)}
          className="text-on-surface-variant transition-colors hover:text-amber-500"
        >
          <Icon name="star" filled={star <= value} className={`text-[26px] ${star <= value ? 'text-amber-500' : ''}`} />
        </button>
      ))}
    </div>
  )
}

function RatingCard({ course }: { course: CourseDetailDTO }) {
  const qc = useQueryClient()
  const [rating, setRating] = useState(course.myRating?.rating ?? 0)
  const [comment, setComment] = useState(course.myRating?.comment ?? '')
  const [error, setError] = useState<string | null>(null)
  // Enviar salvava em silêncio: o único retorno era o rótulo do botão trocar
  // para "Atualizar avaliação", que confirma coisa nenhuma (Documento 4, 9.4).
  const [enviada, setEnviada] = useState(false)

  const mutation = useMutation({
    mutationFn: () => rateCourse(course.id, { rating, comment: comment.trim() || null }),
    onSuccess: () => {
      setError(null)
      setEnviada(true)
      qc.invalidateQueries({ queryKey: ['learning'] })
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Não foi possível salvar sua avaliação.'),
  })

  return (
    <section className="flex flex-col gap-md rounded-xl border border-outline-variant/30 bg-surface-container p-lg">
      <h2 className="font-headline text-title-md text-on-surface">
        {course.myRating ? 'Sua avaliação' : 'Avalie este curso'}
      </h2>
      <StarPicker value={rating} onChange={setRating} />
      <textarea
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        rows={3}
        maxLength={MAX_COURSE_RATING_COMMENT_LENGTH}
        placeholder="Comentário (opcional)"
        className="w-full rounded-lg border border-outline-variant/40 bg-surface p-md text-body-md text-on-surface outline-none focus:border-primary"
      />
      {error && <p className="text-body-sm text-error">{error}</p>}
      {enviada && !error && (
        <p role="status" className="text-body-sm font-bold text-primary">
          Obrigada pelo seu Feedback!
        </p>
      )}
      <button
        type="button"
        disabled={rating < MIN_COURSE_RATING || mutation.isPending}
        onClick={() => mutation.mutate()}
        className="w-fit rounded-full bg-primary px-lg py-sm font-label text-label-md text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
      >
        Enviar avaliação
      </button>
    </section>
  )
}

function FinalQuizCard({ course }: { course: CourseDetailDTO }) {
  if (!course.finalQuizId || !course.enrollment) return null
  return (
    <section className="flex flex-col gap-sm rounded-xl border border-outline-variant/30 bg-surface-container p-lg">
      <h2 className="flex items-center gap-sm font-headline text-title-md text-on-surface">
        <Icon name="quiz" className="text-[22px] text-primary" /> Quiz final do curso
      </h2>
      <p className="text-body-sm text-on-surface-variant">
        Responda o quiz final para concluir sua avaliação deste curso.
      </p>
      <Link to={`/aprendizado/quiz/${course.finalQuizId}`} className="w-fit font-label text-label-md text-primary hover:underline">
        Fazer quiz final
      </Link>
    </section>
  )
}

/**
 * Pedido de certificado (Documento 4, seção 9.3).
 *
 * Antes disto o certificado era inteiramente automático: quem concluía um
 * curso que exige aprovação entrava na fila sem saber, e quem concluía um
 * curso barrado por outra razão não via nada. O botão só libera com o curso
 * concluído — é o que a G&G pediu, e é a mesma guarda que o service aplica.
 */
function CertificateRequestCard({ course }: { course: CourseDetailDTO }) {
  const qc = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: () => requestCourseCertificate(course.id),
    onSuccess: () => {
      setError(null)
      qc.invalidateQueries({ queryKey: ['learning'] })
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Não foi possível solicitar o certificado.'),
  })

  // Certificado na mão não vira pedido: quem já tem lê o `CertificateCard`.
  // A saída vem depois dos hooks — antes deles, mudaria a ordem entre renders.
  if (!course.certificateEnabled || course.certificate) return null

  const concluido = course.enrollment?.status === 'COMPLETED'
  const pedido = course.certificateRequest

  return (
    <section className="flex flex-col gap-sm rounded-xl border border-outline-variant/30 bg-surface-container p-lg">
      <h2 className="flex items-center gap-sm font-headline text-title-md text-on-surface">
        <Icon name="workspace_premium" className="text-[22px] text-primary" /> Certificado
      </h2>

      {pedido?.status === 'PENDING' ? (
        <p className="text-body-sm text-on-surface-variant">
          Solicitação enviada. O time de Gente e Gestão vai analisar e você recebe o certificado por
          aqui.
        </p>
      ) : (
        <>
          {pedido?.status === 'REJECTED' && (
            <p className="text-body-sm text-error">
              Solicitação recusada{pedido.rejectionReason ? `: ${pedido.rejectionReason}` : '.'}
            </p>
          )}
          <p className="text-body-sm text-on-surface-variant">
            {concluido
              ? 'Você concluiu o curso e já pode pedir o certificado.'
              : 'Conclua todas as aulas do curso para solicitar o certificado.'}
          </p>
          {error && <p className="text-body-sm text-error">{error}</p>}
          <button
            type="button"
            disabled={!concluido || mutation.isPending}
            onClick={() => mutation.mutate()}
            className="w-fit rounded-full bg-primary px-lg py-sm font-label text-label-md text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
          >
            {pedido?.status === 'REJECTED' ? 'Solicitar novamente' : 'Solicitar certificado'}
          </button>
        </>
      )}
    </section>
  )
}

function CertificateCard({ course }: { course: CourseDetailDTO }) {
  if (!course.certificate) return null
  return (
    <section className="flex flex-col gap-sm rounded-xl border border-primary/40 bg-primary/10 p-lg">
      <h2 className="flex items-center gap-sm font-headline text-title-md text-on-surface">
        <Icon name="workspace_premium" className="text-[22px] text-primary" /> Certificado emitido
      </h2>
      <p className="text-body-sm text-on-surface-variant">
        Código {course.certificate.code} · {course.certificate.hours}h
      </p>
      <Link to="/aprendizado?aba=certificados" className="w-fit font-label text-label-md text-primary hover:underline">
        Ver meus certificados
      </Link>
    </section>
  )
}

export function CoursePlayerPage() {
  const { id = '' } = useParams<{ id: string }>()
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [actionError, setActionError] = useState<string | null>(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['learning', 'course', id],
    queryFn: () => getCourse(id),
    enabled: Boolean(id),
  })
  const course = data?.course

  const lessons = useMemo(() => (course ? flattenLessons(course) : []), [course])
  const requestedLessonId = searchParams.get('aula')
  const currentLesson =
    lessons.find((lesson) => lesson.id === requestedLessonId) ??
    lessons.find((lesson) => lesson.id === course?.enrollment?.lastLessonId) ??
    lessons.find((lesson) => !lesson.completed) ??
    lessons[0]

  const invalidate = () => qc.invalidateQueries({ queryKey: ['learning'] })

  const enroll = useMutation({
    mutationFn: () => enrollInCourse(id),
    onSuccess: invalidate,
    onError: (err) => setActionError(err instanceof ApiError ? err.message : 'Não foi possível se inscrever.'),
  })

  const toggleLesson = useMutation({
    mutationFn: ({ lessonId, completed }: { lessonId: string; completed: boolean }) =>
      setLessonCompletion(lessonId, completed),
    onSuccess: () => {
      setActionError(null)
      invalidate()
    },
    onError: (err) => setActionError(err instanceof ApiError ? err.message : 'Não foi possível salvar o progresso.'),
  })

  const toggleFavorite = useMutation({
    mutationFn: (favorite: boolean) => setCourseFavorite(id, favorite),
    onSuccess: invalidate,
  })

  function selectLesson(lessonId: string) {
    const next = new URLSearchParams(searchParams)
    next.set('aula', lessonId)
    setSearchParams(next, { replace: true })
  }

  if (isLoading) {
    return (
      <section className="mx-auto flex max-w-page flex-col gap-lg p-lg md:p-xl">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-96 w-full" />
      </section>
    )
  }

  if (isError || !course) {
    return (
      <section className="mx-auto flex max-w-3xl flex-col gap-md p-lg md:p-xl">
        <div className="rounded-xl border border-outline-variant/30 bg-surface-container p-xl text-center">
          <div className="flex justify-center">
            <BackButton />
          </div>
          <h1 className="font-headline text-headline-md text-on-surface">Curso não encontrado</h1>
          <p className="mt-sm text-body-md text-on-surface-variant">
            O curso pode ter sido despublicado ou o link está errado.
          </p>
        </div>
      </section>
    )
  }

  const enrolled = course.enrollment != null
  const progress = course.enrollment?.progressPct ?? 0

  return (
    <section className="mx-auto flex max-w-page flex-col gap-lg p-lg md:p-xl">
      <header className="flex flex-col gap-md rounded-xl border border-outline-variant/30 bg-surface-container p-lg md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-sm">
            <BackButton />
            <p className="font-label text-label-sm uppercase tracking-wide text-primary">{course.category}</p>
          </div>
          <h1 className="mt-xs font-headline text-headline-lg text-on-surface">{course.title}</h1>
          {course.shortDescription && (
            <p className="mt-xs text-body-md text-on-surface-variant">{course.shortDescription}</p>
          )}
          <div className="mt-md flex flex-wrap items-center gap-x-md gap-y-xs text-body-sm text-on-surface-variant">
            <span className="inline-flex items-center gap-1">
              <Icon name="schedule" className="text-[16px]" /> {durationLabel(course.durationMinutes)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Icon name="signal_cellular_alt" className="text-[16px]" /> {COURSE_LEVEL_LABELS[course.level]}
            </span>
            {course.instructorName && (
              <span className="inline-flex items-center gap-1">
                <Icon name="person" className="text-[16px]" /> {course.instructorName}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Icon name="menu_book" className="text-[16px]" /> {course.totalLessons} aulas
            </span>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-sm md:w-64">
          {enrolled ? (
            <ProgressBar value={progress} label={`${course.completedLessons}/${course.totalLessons}`} />
          ) : (
            <button
              type="button"
              onClick={() => enroll.mutate()}
              disabled={enroll.isPending}
              className="rounded-full bg-primary px-lg py-sm font-label text-label-md text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
            >
              Inscrever-se
            </button>
          )}
          <button
            type="button"
            onClick={() => toggleFavorite.mutate(!course.favorite)}
            className="inline-flex items-center justify-center gap-xs rounded-full bg-surface-container-highest px-lg py-sm font-label text-label-md text-on-surface-variant transition-colors hover:text-primary"
          >
            <Icon name="favorite" filled={course.favorite} className="text-[18px]" />
            {course.favorite ? 'Favoritado' : 'Favoritar'}
          </button>
        </div>
      </header>

      {actionError && <p className="text-body-md text-error">{actionError}</p>}

      <div className="grid gap-lg lg:grid-cols-[1fr_20rem]">
        <div className="flex flex-col gap-lg">
          {currentLesson ? (
            <article className="flex flex-col gap-md rounded-xl border border-outline-variant/30 bg-surface-container p-lg">
              <div className="flex flex-wrap items-start justify-between gap-md">
                <div className="min-w-0">
                  <p className="font-label text-label-sm uppercase tracking-wide text-primary">
                    {LESSON_KIND_LABELS[lessonKindOf(currentLesson.blocks)]} · {durationLabel(currentLesson.durationMinutes)}
                  </p>
                  <h2 className="mt-xs font-headline text-headline-sm text-on-surface">{currentLesson.title}</h2>
                </div>
                <button
                  type="button"
                  disabled={!enrolled || toggleLesson.isPending}
                  onClick={() => toggleLesson.mutate({ lessonId: currentLesson.id, completed: !currentLesson.completed })}
                  className={`inline-flex items-center gap-xs rounded-full px-lg py-sm font-label text-label-md transition-colors disabled:bg-surface-container disabled:text-on-surface-variant ${
                    currentLesson.completed
                      ? 'bg-surface-container-highest text-on-surface-variant'
                      : 'bg-primary text-on-primary'
                  }`}
                >
                  <Icon name={currentLesson.completed ? 'check_circle' : 'radio_button_unchecked'} className="text-[18px]" />
                  {currentLesson.completed ? 'Concluída' : 'Marcar como concluída'}
                </button>
              </div>

              {!enrolled && (
                <p className="rounded-lg bg-surface-container-highest p-md text-body-sm text-on-surface-variant">
                  Inscreva-se no curso para acompanhar seu progresso.
                </p>
              )}

              {hasLessonContent(currentLesson.blocks) ? (
                <LessonBlocks blocks={currentLesson.blocks} />
              ) : (
                <p className="text-body-md text-on-surface-variant">Esta aula ainda não tem conteúdo publicado.</p>
              )}

              {enrolled && currentLesson.quizId && (
                <Link
                  to={`/aprendizado/quiz/${currentLesson.quizId}`}
                  className="inline-flex w-fit items-center gap-xs rounded-full bg-surface-container-highest px-lg py-sm font-label text-label-md text-primary hover:underline"
                >
                  <Icon name="quiz" className="text-[18px]" /> Fazer quiz da aula
                </Link>
              )}
            </article>
          ) : (
            <div className="rounded-xl border border-outline-variant/30 bg-surface-container p-xl text-center">
              <p className="text-body-md text-on-surface-variant">Este curso ainda não tem aulas publicadas.</p>
            </div>
          )}

          {course.description && (
            <section className="flex flex-col gap-sm rounded-xl border border-outline-variant/30 bg-surface-container p-lg">
              <h2 className="font-headline text-title-md text-on-surface">Sobre o curso</h2>
              <p className="text-body-md text-on-surface-variant">{course.description}</p>
              {course.objectives.length > 0 && (
                <ul className="mt-sm flex flex-col gap-xs">
                  {course.objectives.map((objective) => (
                    <li key={objective} className="flex items-start gap-sm text-body-sm text-on-surface-variant">
                      <Icon name="check" className="mt-0.5 text-[18px] text-primary" /> {objective}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <FinalQuizCard course={course} />
          <CertificateCard course={course} />
          <CertificateRequestCard course={course} />
          {enrolled && <RatingCard course={course} />}
        </div>

        <aside className="flex flex-col gap-md">
          <h2 className="font-headline text-title-md text-on-surface">Conteúdo</h2>
          {course.modules.map((module) => (
            <div key={module.id} className="rounded-xl border border-outline-variant/30 bg-surface-container p-md">
              <p className="px-sm font-label text-label-md text-on-surface">{module.title}</p>
              <ul className="mt-sm flex flex-col">
                {module.lessons.map((lesson) => {
                  const isCurrent = lesson.id === currentLesson?.id
                  return (
                    <li key={lesson.id}>
                      <button
                        type="button"
                        onClick={() => selectLesson(lesson.id)}
                        aria-current={isCurrent}
                        className={`flex w-full items-center gap-sm rounded-lg px-sm py-sm text-left transition-colors ${
                          isCurrent ? 'bg-primary/15 text-on-surface' : 'text-on-surface-variant hover:bg-surface-container-highest'
                        }`}
                      >
                        <Icon
                          name={lesson.completed ? 'check_circle' : 'play_circle'}
                          filled={lesson.completed}
                          className={`text-[20px] ${lesson.completed ? 'text-primary' : ''}`}
                        />
                        <span className="min-w-0 flex-1 truncate text-body-sm">{lesson.title}</span>
                        <span className="shrink-0 text-label-sm text-on-surface-variant">
                          {durationLabel(lesson.durationMinutes)}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </aside>
      </div>
    </section>
  )
}

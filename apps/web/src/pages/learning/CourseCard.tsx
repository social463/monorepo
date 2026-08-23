import { Link } from 'react-router-dom'
import { COURSE_LEVEL_LABELS, type CourseCardDTO } from '@legends/shared'
import { Icon } from '../../components/Icon'

export function durationLabel(minutes: number): string {
  if (minutes <= 0) return 'Duração a definir'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest} min`
  return rest === 0 ? `${hours}h` : `${hours}h${String(rest).padStart(2, '0')}`
}

/** Barra de progresso do curso — o percentual vem derivado das aulas concluídas. */
export function ProgressBar({ value, label }: { value: number; label?: string }) {
  return (
    <div className="flex items-center gap-sm">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-container-highest">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.min(100, value)}%` }} />
      </div>
      <span className="shrink-0 font-label text-label-sm tabular-nums text-on-surface-variant">
        {label ?? `${value}%`}
      </span>
    </div>
  )
}

export function CourseCard({ course, onToggleFavorite }: { course: CourseCardDTO; onToggleFavorite?: () => void }) {
  const progress = course.enrollment?.progressPct ?? 0
  const done = course.enrollment?.status === 'COMPLETED'

  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-xl border border-outline-variant/30 bg-surface-container transition-colors hover:border-primary/40">
      <Link to={`/aprendizado/curso/${course.id}`} className="block">
        <div className="relative h-28 bg-gradient-to-br from-primary/25 via-primary/10 to-transparent">
          {course.coverUrl ? (
            <img src={course.coverUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <Icon name="school" className="absolute bottom-md left-lg text-[36px] text-primary" />
          )}
          {course.mandatory && (
            <span className="absolute right-sm top-sm rounded-full bg-error px-sm py-0.5 font-label text-label-sm text-on-error">
              Obrigatório
            </span>
          )}
          {done && (
            <span className="absolute left-sm top-sm rounded-full bg-primary px-sm py-0.5 font-label text-label-sm text-on-primary">
              Concluído
            </span>
          )}
        </div>
      </Link>

      <div className="flex flex-1 flex-col gap-sm p-lg">
        <div className="flex items-start justify-between gap-sm">
          <Link to={`/aprendizado/curso/${course.id}`} className="min-w-0">
            <p className="font-label text-label-sm uppercase tracking-wide text-primary">{course.category}</p>
            <h3 className="mt-0.5 font-headline text-title-md text-on-surface">{course.title}</h3>
          </Link>
          {onToggleFavorite && (
            <button
              type="button"
              onClick={onToggleFavorite}
              aria-label={course.favorite ? `Desfavoritar ${course.title}` : `Favoritar ${course.title}`}
              className="shrink-0 rounded-full p-1 text-on-surface-variant transition-colors hover:bg-surface-container-highest hover:text-primary"
            >
              <Icon name="favorite" filled={course.favorite} className={course.favorite ? 'text-primary' : ''} />
            </button>
          )}
        </div>

        {course.shortDescription && (
          <p className="line-clamp-2 text-body-sm text-on-surface-variant">{course.shortDescription}</p>
        )}

        <div className="mt-auto flex flex-wrap items-center gap-x-md gap-y-xs text-body-sm text-on-surface-variant">
          <span className="inline-flex items-center gap-1">
            <Icon name="schedule" className="text-[16px]" /> {durationLabel(course.durationMinutes)}
          </span>
          <span className="inline-flex items-center gap-1">
            <Icon name="signal_cellular_alt" className="text-[16px]" /> {COURSE_LEVEL_LABELS[course.level]}
          </span>
          {course.totalRatings > 0 && (
            <span className="inline-flex items-center gap-1">
              <Icon name="star" filled className="text-[16px] text-amber-500" />
              {course.averageRating.toFixed(1)}
            </span>
          )}
          {course.totalStudents > 0 && (
            <span className="inline-flex items-center gap-1">
              <Icon name="group" className="text-[16px]" /> {course.totalStudents}
            </span>
          )}
        </div>

        {course.enrollment && <ProgressBar value={progress} />}
      </div>
    </article>
  )
}

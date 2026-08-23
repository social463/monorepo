import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  COURSE_LEVELS,
  COURSE_LEVEL_LABELS,
  type CertificateDTO,
  type CourseCardDTO,
  type EnrollmentDTO,
  type LearningSummaryDTO,
  type LearningTrackDTO,
} from '@legends/shared'
import { Icon } from '../../components/Icon'
import { Select } from '../../components/Select'
import { Skeleton } from '../../components/Skeleton'
import {
  getLearningHome,
  getMyLearning,
  listCertificates,
  listCourses,
  listTracks,
  setCourseFavorite,
} from '../../lib/learning-api'
import { CourseCard, ProgressBar } from './CourseCard'

const TABS = [
  { key: 'inicio', label: 'Início' },
  { key: 'catalogo', label: 'Catálogo' },
  { key: 'trilhas', label: 'Trilhas' },
  { key: 'minha-aprendizagem', label: 'Minha aprendizagem' },
  { key: 'certificados', label: 'Certificados' },
] as const

type TabKey = (typeof TABS)[number]['key']

function isTabKey(value: string | null): value is TabKey {
  return TABS.some((tab) => tab.key === value)
}

/** Invalida tudo que mostra curso depois de favoritar (home, catálogo, trilhas). */
function useToggleFavorite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, favorite }: { id: string; favorite: boolean }) => setCourseFavorite(id, favorite),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['learning'] })
    },
  })
}

function StatCard({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-md rounded-xl border border-outline-variant/30 bg-surface-container p-lg">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
        <Icon name={icon} className="text-[22px]" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-body-sm text-on-surface-variant">{label}</p>
        <p className="font-headline text-headline-sm text-on-surface">{value}</p>
      </div>
    </div>
  )
}

function SummaryRow({ summary }: { summary: LearningSummaryDTO }) {
  const hours = Math.floor(summary.monthMinutes / 60)
  const minutes = summary.monthMinutes % 60
  return (
    <div className="grid gap-md sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        icon="schedule"
        label="Horas estudadas no mês"
        value={hours > 0 ? `${hours}h${minutes > 0 ? String(minutes).padStart(2, '0') : ''}` : `${minutes} min`}
      />
      <StatCard icon="workspace_premium" label="Certificados" value={String(summary.certificates)} />
      <StatCard icon="play_circle" label="Cursos em andamento" value={String(summary.inProgress)} />
      <StatCard icon="error" label="Obrigatórios pendentes" value={String(summary.pendingMandatory)} />
    </div>
  )
}

function Section({ title, icon, action, children }: { title: string; icon: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-md">
      <div className="flex items-end justify-between gap-md">
        <h2 className="flex items-center gap-sm font-headline text-title-lg text-on-surface">
          <Icon name={icon} className="text-[20px] text-primary" /> {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function CoursesGrid({ courses }: { courses: CourseCardDTO[] }) {
  const toggle = useToggleFavorite()
  return (
    <div className="grid gap-md sm:grid-cols-2 lg:grid-cols-3">
      {courses.map((course) => (
        <CourseCard
          key={course.id}
          course={course}
          onToggleFavorite={() => toggle.mutate({ id: course.id, favorite: !course.favorite })}
        />
      ))}
    </div>
  )
}

function GridSkeleton() {
  return (
    <div className="grid gap-md sm:grid-cols-2 lg:grid-cols-3">
      <Skeleton className="h-56 w-full" />
      <Skeleton className="h-56 w-full" />
      <Skeleton className="h-56 w-full" />
    </div>
  )
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-outline-variant/30 bg-surface-container p-xl text-center">
      <h3 className="font-headline text-headline-md text-on-surface">{title}</h3>
      <p className="mt-sm text-body-md text-on-surface-variant">{description}</p>
    </div>
  )
}

function TrackCard({ track }: { track: LearningTrackDTO }) {
  return (
    <article className="flex h-full flex-col gap-sm rounded-xl border border-outline-variant/30 bg-gradient-to-br from-primary/20 via-surface-container to-surface-container p-lg">
      <Icon name="route" className="text-[26px] text-primary" />
      <h3 className="font-headline text-title-md text-on-surface">{track.title}</h3>
      {track.description && <p className="line-clamp-2 text-body-sm text-on-surface-variant">{track.description}</p>}
      <div className="flex flex-wrap gap-xs">
        {track.competencies.slice(0, 3).map((competency) => (
          <span key={competency} className="rounded-full bg-primary/15 px-sm py-0.5 font-label text-label-sm text-primary">
            {competency}
          </span>
        ))}
      </div>
      <p className="text-body-sm text-on-surface-variant">
        {track.courses.length} curso{track.courses.length === 1 ? '' : 's'}
      </p>
      <div className="mt-auto pt-sm">
        <ProgressBar value={track.progressPct} />
      </div>
    </article>
  )
}

function HomeTab({ onGoToCatalog }: { onGoToCatalog: () => void }) {
  const { data, isLoading, isError } = useQuery({ queryKey: ['learning', 'home'], queryFn: getLearningHome })

  if (isLoading) return <GridSkeleton />
  if (isError || !data) return <p className="text-body-md text-error">Erro ao carregar a área de aprendizado.</p>

  const hasContent =
    data.continueLearning.length + data.mandatory.length + data.recommended.length + data.newest.length > 0

  return (
    <div className="flex flex-col gap-xl">
      <SummaryRow summary={data.summary} />

      {!hasContent && (
        <EmptyState
          title="Nenhum curso publicado ainda"
          description="Assim que a Central de Cursos publicar o primeiro curso, ele aparece aqui."
        />
      )}

      {data.continueLearning.length > 0 && (
        <Section title="Continuar de onde parou" icon="play_circle">
          <div className="grid gap-md sm:grid-cols-2 lg:grid-cols-3">
            {data.continueLearning.map((enrollment) => (
              <ContinueCard key={enrollment.id} enrollment={enrollment} />
            ))}
          </div>
        </Section>
      )}

      {data.mandatory.length > 0 && (
        <Section
          title="Cursos obrigatórios"
          icon="error"
          action={
            <button type="button" onClick={onGoToCatalog} className="font-label text-label-md text-primary hover:underline">
              Ver tudo
            </button>
          }
        >
          <CoursesGrid courses={data.mandatory} />
        </Section>
      )}

      {data.recommended.length > 0 && (
        <Section title="Recomendados para você" icon="auto_awesome">
          <CoursesGrid courses={data.recommended} />
        </Section>
      )}

      {data.newest.length > 0 && (
        <Section title="Novos cursos" icon="new_releases">
          <CoursesGrid courses={data.newest} />
        </Section>
      )}

      {data.popular.length > 0 && (
        <Section title="Mais populares" icon="trending_up">
          <CoursesGrid courses={data.popular} />
        </Section>
      )}

      {data.tracks.length > 0 && (
        <Section title="Explore trilhas" icon="route">
          <div className="grid gap-md md:grid-cols-3">
            {data.tracks.map((track) => (
              <TrackCard key={track.id} track={track} />
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

function ContinueCard({ enrollment }: { enrollment: EnrollmentDTO }) {
  return (
    <article className="flex flex-col gap-sm rounded-xl border border-primary/30 bg-surface-container p-lg">
      <p className="font-label text-label-sm uppercase tracking-wide text-primary">{enrollment.course.category}</p>
      <h3 className="font-headline text-title-md text-on-surface">{enrollment.course.title}</h3>
      <ProgressBar value={enrollment.progressPct} />
      <Link
        to={
          enrollment.lastLessonId
            ? `/aprendizado/curso/${enrollment.courseId}?aula=${enrollment.lastLessonId}`
            : `/aprendizado/curso/${enrollment.courseId}`
        }
        className="mt-sm inline-flex w-fit items-center gap-xs rounded-full bg-primary px-lg py-sm font-label text-label-md text-on-primary"
      >
        <Icon name="play_arrow" className="text-[18px]" /> Continuar
      </Link>
    </article>
  )
}

function CatalogTab() {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [level, setLevel] = useState('')
  const [competency, setCompetency] = useState('')
  const [onlyFavorites, setOnlyFavorites] = useState(false)

  const filters = {
    search: search.trim() || undefined,
    category: category || undefined,
    level: (level || undefined) as (typeof COURSE_LEVELS)[number] | undefined,
    competency: competency || undefined,
    onlyFavorites: onlyFavorites || undefined,
  }
  const { data, isLoading, isError } = useQuery({
    queryKey: ['learning', 'courses', filters],
    queryFn: () => listCourses(filters),
  })

  return (
    <div className="flex flex-col gap-lg">
      <div className="rounded-xl border border-outline-variant/30 bg-surface-container p-lg">
        <label className="relative block">
          <span className="sr-only">Buscar curso</span>
          <Icon
            name="search"
            className="pointer-events-none absolute left-md top-1/2 -translate-y-1/2 text-[20px] text-on-surface-variant"
          />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Busque por curso, categoria ou competência…"
            className="w-full rounded-full border border-outline-variant/40 bg-surface py-sm pl-[46px] pr-md text-body-md text-on-surface outline-none focus:border-primary"
          />
        </label>

        <div className="mt-md flex flex-wrap items-center gap-sm">
          <Select
            ariaLabel="Filtrar por categoria"
            className="w-52"
            value={category}
            options={[
              { value: '', label: 'Todas as categorias' },
              ...(data?.categories ?? []).map((option) => ({ value: option, label: option })),
            ]}
            onChange={setCategory}
          />
          <Select
            ariaLabel="Filtrar por nível"
            className="w-44"
            value={level}
            options={[
              { value: '', label: 'Todos os níveis' },
              ...COURSE_LEVELS.map((option) => ({ value: option, label: COURSE_LEVEL_LABELS[option] })),
            ]}
            onChange={setLevel}
          />
          <Select
            ariaLabel="Filtrar por competência"
            className="w-52"
            value={competency}
            options={[
              { value: '', label: 'Todas as competências' },
              ...(data?.competencies ?? []).map((option) => ({ value: option, label: option })),
            ]}
            onChange={setCompetency}
          />
          <button
            type="button"
            onClick={() => setOnlyFavorites((value) => !value)}
            aria-pressed={onlyFavorites}
            className={`inline-flex items-center gap-xs rounded-full px-md py-sm font-label text-label-md transition-colors ${
              onlyFavorites ? 'bg-primary text-on-primary' : 'bg-surface-container-highest text-on-surface-variant'
            }`}
          >
            <Icon name="favorite" filled={onlyFavorites} className="text-[18px]" /> Favoritos
          </button>
        </div>
      </div>

      {isLoading && <GridSkeleton />}
      {isError && <p className="text-body-md text-error">Erro ao carregar o catálogo.</p>}
      {data && data.courses.length === 0 && (
        <EmptyState title="Nenhum curso encontrado" description="Tente outra busca ou limpe os filtros." />
      )}
      {data && data.courses.length > 0 && <CoursesGrid courses={data.courses} />}
    </div>
  )
}

function TracksTab() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['learning', 'tracks'], queryFn: listTracks })

  if (isLoading) return <GridSkeleton />
  if (isError) return <p className="text-body-md text-error">Erro ao carregar as trilhas.</p>
  const tracks = data?.tracks ?? []
  if (tracks.length === 0) {
    return <EmptyState title="Nenhuma trilha publicada" description="As trilhas de aprendizagem aparecem aqui." />
  }

  return (
    <div className="flex flex-col gap-xl">
      {tracks.map((track) => (
        <section key={track.id} className="flex flex-col gap-md">
          <div className="flex flex-wrap items-end justify-between gap-md">
            <div>
              <h2 className="flex items-center gap-sm font-headline text-title-lg text-on-surface">
                <Icon name="route" className="text-[20px] text-primary" /> {track.title}
              </h2>
              {track.description && <p className="mt-xs text-body-sm text-on-surface-variant">{track.description}</p>}
            </div>
            <div className="w-48">
              <ProgressBar value={track.progressPct} />
            </div>
          </div>
          {track.courses.length === 0 ? (
            <p className="text-body-sm text-on-surface-variant">Nenhum curso publicado nesta trilha ainda.</p>
          ) : (
            <CoursesGrid courses={track.courses} />
          )}
        </section>
      ))}
    </div>
  )
}

function MyLearningTab() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['learning', 'me'], queryFn: getMyLearning })

  if (isLoading) return <GridSkeleton />
  if (isError || !data) return <p className="text-body-md text-error">Erro ao carregar sua aprendizagem.</p>

  const inProgress = data.enrollments.filter((enrollment) => enrollment.status === 'IN_PROGRESS')
  const completed = data.enrollments.filter((enrollment) => enrollment.status === 'COMPLETED')

  return (
    <div className="flex flex-col gap-xl">
      <SummaryRow summary={data.summary} />
      {data.enrollments.length === 0 && (
        <EmptyState
          title="Você ainda não se inscreveu em nenhum curso"
          description="Escolha um curso no catálogo para começar."
        />
      )}
      {inProgress.length > 0 && (
        <Section title="Em andamento" icon="play_circle">
          <CoursesGrid courses={inProgress.map((enrollment) => enrollment.course)} />
        </Section>
      )}
      {completed.length > 0 && (
        <Section title="Concluídos" icon="task_alt">
          <CoursesGrid courses={completed.map((enrollment) => enrollment.course)} />
        </Section>
      )}
    </div>
  )
}

function CertificateItem({ certificate }: { certificate: CertificateDTO }) {
  const [copied, setCopied] = useState(false)
  const verifyUrl = `${window.location.origin}/certificado/${certificate.code}`

  async function copyCode() {
    await navigator.clipboard.writeText(certificate.code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <article className="flex flex-col gap-md rounded-xl border border-outline-variant/30 bg-surface-container p-lg sm:flex-row sm:items-center">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
        <Icon name="workspace_premium" className="text-[26px]" />
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="font-headline text-title-md text-on-surface">{certificate.title}</h3>
        <p className="text-body-sm text-on-surface-variant">
          {certificate.hours}h ·{' '}
          {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' }).format(new Date(certificate.issuedAt))}
        </p>
        <p className="mt-xs font-label text-label-md tracking-wide text-on-surface">{certificate.code}</p>
      </div>
      <div className="flex flex-wrap gap-sm">
        <button
          type="button"
          onClick={copyCode}
          className="inline-flex items-center gap-xs rounded-full bg-surface-container-highest px-md py-sm font-label text-label-md text-on-surface-variant transition-colors hover:text-on-surface"
        >
          <Icon name={copied ? 'check' : 'content_copy'} className="text-[18px]" />
          {copied ? 'Copiado' : 'Copiar código'}
        </button>
        {certificate.imageUrl && (
          <a
            href={certificate.imageUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-xs rounded-full bg-surface-container-highest px-md py-sm font-label text-label-md text-on-surface-variant transition-colors hover:text-on-surface"
          >
            <Icon name="download" className="text-[18px]" /> Baixar
          </a>
        )}
        <a
          href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(verifyUrl)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-xs rounded-full bg-primary px-md py-sm font-label text-label-md text-on-primary"
        >
          <Icon name="share" className="text-[18px]" /> LinkedIn
        </a>
      </div>
    </article>
  )
}

function CertificatesTab() {
  const { data, isLoading, isError } = useQuery({ queryKey: ['learning', 'certificates'], queryFn: listCertificates })

  if (isLoading) return <Skeleton className="h-32 w-full" />
  if (isError) return <p className="text-body-md text-error">Erro ao carregar seus certificados.</p>
  const certificates = data?.certificates ?? []
  if (certificates.length === 0) {
    return (
      <EmptyState
        title="Nenhum certificado ainda"
        description="Conclua um curso com certificado habilitado para receber o seu."
      />
    )
  }

  return (
    <div className="flex flex-col gap-md">
      {certificates.map((certificate) => (
        <CertificateItem key={certificate.id} certificate={certificate} />
      ))}
    </div>
  )
}

/**
 * Hub de Aprendizado. As cinco telas vivem em abas da mesma rota (o menu lateral
 * é flat) e a aba ativa vai na URL para o link ser compartilhável.
 */
export function LearningPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('aba')
  const active: TabKey = isTabKey(requested) ? requested : 'inicio'

  function selectTab(key: TabKey) {
    const next = new URLSearchParams(searchParams)
    next.set('aba', key)
    setSearchParams(next, { replace: true })
  }

  return (
    <section className="mx-auto flex max-w-page flex-col gap-lg p-lg md:p-xl">
      <header>
        <h1 className="font-headline text-headline-xl text-on-surface">Aprendizado</h1>
        <p className="mt-2 text-body-md text-on-surface-variant">
          Encontre um curso, acompanhe seu progresso e receba o certificado.
        </p>
      </header>

      <div role="tablist" aria-label="Seções de Aprendizado" className="flex flex-wrap gap-sm">
        {TABS.map((tab) => {
          const isActive = tab.key === active
          return (
            <button
              key={tab.key}
              role="tab"
              aria-selected={isActive}
              onClick={() => selectTab(tab.key)}
              className={`rounded-full px-lg py-sm font-label text-label-md transition-colors ${
                isActive ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {active === 'inicio' && <HomeTab onGoToCatalog={() => selectTab('catalogo')} />}
      {active === 'catalogo' && <CatalogTab />}
      {active === 'trilhas' && <TracksTab />}
      {active === 'minha-aprendizagem' && <MyLearningTab />}
      {active === 'certificados' && <CertificatesTab />}
    </section>
  )
}

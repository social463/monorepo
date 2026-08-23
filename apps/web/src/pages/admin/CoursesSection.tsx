import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  COURSE_LESSON_TYPES,
  COURSE_LESSON_TYPE_LABELS,
  COURSE_LEVELS,
  COURSE_LEVEL_LABELS,
  MAX_LESSON_DURATION_MINUTES,
  toVideoEmbedUrl,
  type AdminCourseDTO,
  type AdminCourseLessonDTO,
  type AdminCourseModuleDTO,
  type CourseLessonType,
  type CourseLevel,
  type SectorDTO,
  isFullAdmin,} from '@legends/shared'
import { Icon } from '../../components/Icon'
import { Select } from '../../components/Select'
import { useAuth } from '../../auth/AuthContext'
import { apiFetch } from '../../lib/api'
import {
  createCourse,
  createCourseLesson,
  createCourseModule,
  deleteCourse,
  deleteCourseLesson,
  deleteCourseModule,
  getCourseForAdmin,
  listCertificateTemplates,
  listCoursesForAdmin,
  updateCourse,
  updateCourseLesson,
} from '../../lib/learning-api'
import { CourseQuizEditor } from './CourseQuizEditor'
import { Panel, inputCls, errorMessage } from './shared'

function durationLabel(minutes: number): string {
  if (minutes <= 0) return '0 min'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (hours === 0) return `${rest} min`
  return rest === 0 ? `${hours}h` : `${hours}h${String(rest).padStart(2, '0')}`
}

/** Campo de link de vídeo com pré-visualização do embed já normalizado. */
function VideoUrlField({
  value,
  onChange,
  id,
}: {
  value: string
  onChange: (value: string) => void
  id: string
}) {
  const trimmed = value.trim()
  const embed = trimmed ? toVideoEmbedUrl(trimmed) : ''
  const converted = Boolean(trimmed) && embed !== trimmed

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-label text-label-sm text-on-surface-variant">
        Link do vídeo
      </label>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Cole o link do YouTube, Vimeo ou o endereço do arquivo"
        className={inputCls}
      />
      {converted && (
        <p className="flex items-start gap-1 text-body-sm text-on-surface-variant">
          <Icon name="auto_fix_high" className="mt-0.5 text-[16px] text-primary" />
          <span>
            Será exibido como <code className="break-all text-primary">{embed}</code>
          </span>
        </p>
      )}
      {trimmed && (
        <div className="mt-1 aspect-video w-full max-w-md overflow-hidden rounded-lg bg-black">
          <iframe
            src={embed}
            title="Pré-visualização do vídeo"
            allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
            allowFullScreen
            className="h-full w-full"
          />
        </div>
      )}
    </div>
  )
}

function LessonForm({
  moduleId,
  lesson,
  onDone,
}: {
  moduleId: string
  lesson?: AdminCourseLessonDTO
  onDone: () => void
}) {
  const qc = useQueryClient()
  const [title, setTitle] = useState(lesson?.title ?? '')
  const [type, setType] = useState<CourseLessonType>(lesson?.type ?? 'VIDEO')
  const [videoUrl, setVideoUrl] = useState(lesson?.videoUrl ?? '')
  const [contentHtml, setContentHtml] = useState(lesson?.contentHtml ?? '')
  const [durationMinutes, setDurationMinutes] = useState(String(lesson?.durationMinutes ?? 10))
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        title: title.trim(),
        type,
        videoUrl: videoUrl.trim() || null,
        contentHtml: contentHtml.trim() || null,
        durationMinutes: Number(durationMinutes) || 0,
      }
      return lesson ? updateCourseLesson(lesson.id, payload) : createCourseLesson(moduleId, payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'courses'] })
      onDone()
    },
    onError: (err) => setError(errorMessage(err, 'Não foi possível salvar a aula.')),
  })

  function submit(event: FormEvent) {
    event.preventDefault()
    if (title.trim()) save.mutate()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-md rounded-lg border border-dashed border-outline-variant/50 p-md">
      <div className="grid gap-md sm:grid-cols-[2fr_1fr_1fr]">
        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Título da aula</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} className={inputCls} />
        </label>
        <div className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Formato</span>
          <Select
            ariaLabel="Formato da aula"
            value={type}
            options={COURSE_LESSON_TYPES.map((option) => ({
              value: option,
              label: COURSE_LESSON_TYPE_LABELS[option],
            }))}
            onChange={(next) => setType(next as CourseLessonType)}
          />
        </div>
        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Duração (min)</span>
          <input
            type="number"
            min={0}
            max={MAX_LESSON_DURATION_MINUTES}
            value={durationMinutes}
            onChange={(event) => setDurationMinutes(event.target.value)}
            className={inputCls}
          />
        </label>
      </div>

      {type === 'VIDEO' && (
        <VideoUrlField id={`video-${lesson?.id ?? moduleId}`} value={videoUrl} onChange={setVideoUrl} />
      )}

      <label className="flex flex-col gap-1">
        <span className="font-label text-label-sm text-on-surface-variant">
          {type === 'VIDEO' ? 'Texto de apoio (opcional)' : 'Conteúdo da aula'}
        </span>
        <textarea
          value={contentHtml}
          onChange={(event) => setContentHtml(event.target.value)}
          rows={type === 'VIDEO' ? 2 : 5}
          className={inputCls}
        />
      </label>

      {error && <p className="text-body-sm text-error">{error}</p>}

      <div className="flex gap-sm">
        <button
          type="submit"
          disabled={!title.trim() || save.isPending}
          className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
        >
          {lesson ? 'Salvar aula' : 'Adicionar aula'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md px-lg py-sm font-label text-label-md text-on-surface-variant hover:text-on-surface"
        >
          Cancelar
        </button>
      </div>
    </form>
  )
}

function ModuleBlock({ courseModule }: { courseModule: AdminCourseModuleDTO }) {
  const qc = useQueryClient()
  const [addingLesson, setAddingLesson] = useState(false)
  const [editingLessonId, setEditingLessonId] = useState<string | null>(null)
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'courses'] })

  const removeModule = useMutation({ mutationFn: () => deleteCourseModule(courseModule.id), onSuccess: invalidate })
  const removeLesson = useMutation({ mutationFn: (id: string) => deleteCourseLesson(id), onSuccess: invalidate })

  return (
    <div className="flex flex-col gap-md rounded-lg border border-outline-variant/30 bg-surface-container-low p-md">
      <div className="flex items-center justify-between gap-md">
        <h4 className="font-label text-label-lg text-on-surface">{courseModule.title}</h4>
        <button
          type="button"
          onClick={() => removeModule.mutate()}
          disabled={removeModule.isPending}
          aria-label={`Excluir módulo ${courseModule.title}`}
          className="rounded-full p-1 text-on-surface-variant hover:text-error disabled:opacity-50"
        >
          <Icon name="delete" className="text-[18px]" />
        </button>
      </div>

      <ul className="flex flex-col gap-sm">
        {courseModule.lessons.map((lesson) =>
          editingLessonId === lesson.id ? (
            <li key={lesson.id}>
              <LessonForm moduleId={courseModule.id} lesson={lesson} onDone={() => setEditingLessonId(null)} />
            </li>
          ) : (
            <li
              key={lesson.id}
              className="flex flex-wrap items-center gap-sm rounded-md bg-surface-container px-md py-sm"
            >
              <Icon
                name={lesson.type === 'VIDEO' ? 'play_circle' : 'article'}
                className="text-[18px] text-primary"
              />
              <span className="min-w-0 flex-1 truncate text-body-sm text-on-surface">{lesson.title}</span>
              {lesson.type === 'VIDEO' && !lesson.videoUrl && (
                <span className="inline-flex items-center gap-1 rounded-full bg-error/10 px-sm py-0.5 font-label text-label-sm text-error">
                  <Icon name="warning" className="text-[14px]" /> sem link
                </span>
              )}
              <span className="text-body-sm text-on-surface-variant">{durationLabel(lesson.durationMinutes)}</span>
              <button
                type="button"
                onClick={() => setEditingLessonId(lesson.id)}
                aria-label={`Editar aula ${lesson.title}`}
                className="rounded-full p-1 text-on-surface-variant hover:text-primary"
              >
                <Icon name="edit" className="text-[18px]" />
              </button>
              <button
                type="button"
                onClick={() => removeLesson.mutate(lesson.id)}
                aria-label={`Excluir aula ${lesson.title}`}
                className="rounded-full p-1 text-on-surface-variant hover:text-error"
              >
                <Icon name="delete" className="text-[18px]" />
              </button>
            </li>
          ),
        )}
        {courseModule.lessons.length === 0 && !addingLesson && (
          <li className="text-body-sm text-on-surface-variant">Nenhuma aula neste módulo.</li>
        )}
      </ul>

      {addingLesson ? (
        <LessonForm moduleId={courseModule.id} onDone={() => setAddingLesson(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setAddingLesson(true)}
          className="inline-flex w-fit items-center gap-1 rounded-md px-md py-sm font-label text-label-md text-primary hover:underline"
        >
          <Icon name="add" className="text-[18px]" /> Adicionar aula
        </button>
      )}
    </div>
  )
}

function CourseEditor({ courseId, onClose }: { courseId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [moduleTitle, setModuleTitle] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'courses', courseId],
    queryFn: () => getCourseForAdmin(courseId),
  })
  const course = data?.course
  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin', 'courses'] })

  const addModule = useMutation({
    mutationFn: () => createCourseModule(courseId, { title: moduleTitle.trim() }),
    onSuccess: () => {
      setModuleTitle('')
      invalidate()
    },
    onError: (err) => setMessage(errorMessage(err, 'Não foi possível criar o módulo.')),
  })

  const publish = useMutation({
    mutationFn: (published: boolean) => updateCourse(courseId, { published }),
    onSuccess: () => {
      setMessage(null)
      invalidate()
    },
    onError: (err) => setMessage(errorMessage(err, 'Não foi possível alterar a publicação.')),
  })

  if (isLoading || !course) return <p className="text-body-md text-on-surface-variant">Carregando curso…</p>

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex flex-wrap items-start justify-between gap-md">
        <div>
          <button
            type="button"
            onClick={onClose}
            className="mb-sm inline-flex items-center gap-1 font-label text-label-md text-on-surface-variant hover:text-on-surface"
          >
            <Icon name="arrow_back" className="text-[18px]" /> Todos os cursos
          </button>
          <h3 className="font-headline text-headline-md text-on-surface">{course.title}</h3>
          <p className="text-body-sm text-on-surface-variant">
            {course.category} · {COURSE_LEVEL_LABELS[course.level]} · {course.totalLessons} aulas ·{' '}
            {durationLabel(course.durationMinutes)}
            {course.enrolledCount > 0 ? ` · ${course.enrolledCount} inscritos` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => publish.mutate(!course.published)}
          disabled={publish.isPending}
          className={`rounded-md px-lg py-sm font-label text-label-md font-bold disabled:bg-surface-container disabled:text-on-surface-variant ${
            course.published
              ? 'bg-surface-container-highest text-on-surface-variant'
              : 'bg-primary text-on-primary'
          }`}
        >
          {course.published ? 'Despublicar' : 'Publicar curso'}
        </button>
      </div>

      {message && <p className="text-body-sm text-error">{message}</p>}
      {!course.published && (
        <p className="rounded-lg bg-surface-container-highest p-md text-body-sm text-on-surface-variant">
          Curso em rascunho: não aparece no catálogo nem abre por URL direta.
        </p>
      )}

      <CourseFields course={course} onError={setMessage} />

      <div className="flex flex-col gap-md">
        <h4 className="font-headline text-title-lg text-on-surface">Conteúdo</h4>
        {course.modules.map((courseModule) => (
          <ModuleBlock key={courseModule.id} courseModule={courseModule} />
        ))}

        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (moduleTitle.trim()) addModule.mutate()
          }}
          className="flex flex-wrap items-end gap-sm"
        >
          <label className="flex min-w-[16rem] flex-1 flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Novo módulo</span>
            <input
              value={moduleTitle}
              onChange={(event) => setModuleTitle(event.target.value)}
              placeholder="Ex.: Fundamentos"
              className={inputCls}
            />
          </label>
          <button
            type="submit"
            disabled={!moduleTitle.trim() || addModule.isPending}
            className="rounded-md bg-surface-container-highest px-lg py-sm font-label text-label-md text-on-surface disabled:opacity-50"
          >
            Adicionar módulo
          </button>
        </form>
      </div>

      <div className="flex flex-col gap-md">
        <h4 className="font-headline text-title-lg text-on-surface">Quiz</h4>
        <CourseQuizEditor courseId={course.id} modules={course.modules} />
      </div>
    </div>
  )
}

function CourseFields({ course, onError }: { course: AdminCourseDTO; onError: (message: string | null) => void }) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const isAdmin = isFullAdmin(user)
  const [title, setTitle] = useState(course.title)
  const [category, setCategory] = useState(course.category)
  const [level, setLevel] = useState<CourseLevel>(course.level)
  const [shortDescription, setShortDescription] = useState(course.shortDescription ?? '')
  const [description, setDescription] = useState(course.description ?? '')
  const [instructorName, setInstructorName] = useState(course.instructorName ?? '')
  const [competencies, setCompetencies] = useState(course.competencies.join(', '))
  const [mandatory, setMandatory] = useState(course.mandatory)
  const [certificateEnabled, setCertificateEnabled] = useState(course.certificateEnabled)
  const [requiresCertificateApproval, setRequiresCertificateApproval] = useState(course.requiresCertificateApproval)
  const [certificateTemplateId, setCertificateTemplateId] = useState(course.certificateTemplateId ?? '')
  const [sectorId, setSectorId] = useState(course.sectorId ?? '')
  const [saved, setSaved] = useState(false)

  // Setores da própria empresa (rota já faz o recorte por tenant) — só o
  // ADMIN escolhe; o SUBADMIN nem vê o campo, então nem precisa buscar.
  const sectorsQuery = useQuery({
    queryKey: ['admin', 'sectors'],
    queryFn: () => apiFetch<{ sectors: SectorDTO[] }>('/admin/sectors'),
    enabled: isAdmin,
  })
  const sectors = sectorsQuery.data?.sectors ?? []

  // Modelos de certificado são documento da empresa: a rota é `requireAdmin`,
  // então nem busca nem campo para SUBADMIN — o modelo do curso fica como está.
  const templatesQuery = useQuery({
    queryKey: ['admin', 'certificate-templates'],
    queryFn: listCertificateTemplates,
    enabled: isAdmin,
  })
  const templates = templatesQuery.data?.templates ?? []

  const save = useMutation({
    mutationFn: () =>
      updateCourse(course.id, {
        title: title.trim(),
        category: category.trim(),
        level,
        shortDescription: shortDescription.trim() || null,
        description: description.trim() || null,
        instructorName: instructorName.trim() || null,
        competencies: competencies.split(',').map((item) => item.trim()).filter(Boolean),
        mandatory,
        certificateEnabled,
        requiresCertificateApproval,
        // Só o ADMIN enxerga (e escolhe) o modelo; para o SUBADMIN o campo nem
        // vai no corpo, pra não sobrescrever a escolha do ADMIN com um estado
        // que o formulário dele nunca mostrou.
        ...(isAdmin ? { certificateTemplateId: certificateTemplateId || null } : {}),
        sectorId: sectorId || null,
      }),
    onSuccess: () => {
      onError(null)
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2000)
      qc.invalidateQueries({ queryKey: ['admin', 'courses'] })
    },
    onError: (err) => onError(errorMessage(err, 'Não foi possível salvar o curso.')),
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        save.mutate()
      }}
      className="flex flex-col gap-md rounded-lg border border-outline-variant/30 p-md"
    >
      <div className="grid gap-md sm:grid-cols-3">
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="font-label text-label-sm text-on-surface-variant">Título</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} className={inputCls} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Categoria</span>
          <input value={category} onChange={(event) => setCategory(event.target.value)} className={inputCls} />
        </label>
        <div className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Nível</span>
          <Select
            ariaLabel="Nível do curso"
            value={level}
            options={COURSE_LEVELS.map((option) => ({ value: option, label: COURSE_LEVEL_LABELS[option] }))}
            onChange={(next) => setLevel(next as CourseLevel)}
          />
        </div>
        {isAdmin && (
          <div className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Setor</span>
            <Select
              ariaLabel="Setor do curso"
              value={sectorId}
              options={[{ value: '', label: 'Empresa toda' }, ...sectors.map((sector) => ({ value: sector.id, label: sector.name }))]}
              onChange={setSectorId}
            />
          </div>
        )}
        {isAdmin && (
          <div className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Modelo do certificado</span>
            <Select
              ariaLabel="Modelo do certificado"
              value={certificateTemplateId}
              options={[
                { value: '', label: 'Modelo padrão da empresa' },
                ...templates.map((template) => ({ value: template.id, label: template.name })),
              ]}
              onChange={setCertificateTemplateId}
            />
          </div>
        )}
        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Instrutor</span>
          <input
            value={instructorName}
            onChange={(event) => setInstructorName(event.target.value)}
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Competências (vírgula)</span>
          <input
            value={competencies}
            onChange={(event) => setCompetencies(event.target.value)}
            placeholder="Liderança, Feedback"
            className={inputCls}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="font-label text-label-sm text-on-surface-variant">Resumo (aparece no card)</span>
        <input
          value={shortDescription}
          onChange={(event) => setShortDescription(event.target.value)}
          className={inputCls}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="font-label text-label-sm text-on-surface-variant">Descrição</span>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          className={inputCls}
        />
      </label>

      <div className="flex flex-wrap gap-lg">
        <label className="flex items-center gap-sm text-body-sm text-on-surface">
          <input type="checkbox" checked={mandatory} onChange={(event) => setMandatory(event.target.checked)} />
          Curso obrigatório
        </label>
        <label className="flex items-center gap-sm text-body-sm text-on-surface">
          <input
            type="checkbox"
            checked={certificateEnabled}
            onChange={(event) => setCertificateEnabled(event.target.checked)}
          />
          Emitir certificado ao concluir
        </label>
        <label className="flex items-center gap-sm text-body-sm text-on-surface">
          <input
            type="checkbox"
            checked={requiresCertificateApproval}
            onChange={(event) => setRequiresCertificateApproval(event.target.checked)}
          />
          Exigir aprovação antes de emitir
        </label>
      </div>

      <button
        type="submit"
        disabled={save.isPending}
        className="inline-flex w-fit items-center gap-sm rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
      >
        <Icon name={saved ? 'check' : 'save'} className="text-[18px]" />
        {saved ? 'Salvo' : 'Salvar dados do curso'}
      </button>
    </form>
  )
}

function NewCourseForm({ onCreated }: { onCreated: (id: string) => void }) {
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [error, setError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: () => createCourse({ title: title.trim(), category: category.trim() }),
    onSuccess: (response) => {
      qc.invalidateQueries({ queryKey: ['admin', 'courses'] })
      onCreated(response.course.id)
    },
    onError: (err) => setError(errorMessage(err, 'Não foi possível criar o curso.')),
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (title.trim() && category.trim()) create.mutate()
      }}
      className="flex flex-wrap items-end gap-sm rounded-lg border border-dashed border-outline-variant/50 p-md"
    >
      <label className="flex min-w-[14rem] flex-1 flex-col gap-1">
        <span className="font-label text-label-sm text-on-surface-variant">Título do curso</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} className={inputCls} />
      </label>
      <label className="flex min-w-[10rem] flex-col gap-1">
        <span className="font-label text-label-sm text-on-surface-variant">Categoria</span>
        <input
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          placeholder="Liderança"
          className={inputCls}
        />
      </label>
      <button
        type="submit"
        disabled={!title.trim() || !category.trim() || create.isPending}
        className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
      >
        Criar curso
      </button>
      {error && <p className="w-full text-body-sm text-error">{error}</p>}
    </form>
  )
}

/**
 * Central de cursos: criar, montar o conteúdo (módulos e aulas, com link de
 * vídeo) e publicar. Curso nasce em rascunho e só entra no catálogo quando o
 * admin publica — e publicar exige ao menos uma aula.
 */
export function CoursesSection() {
  const qc = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const { data, isLoading, isError } = useQuery({ queryKey: ['admin', 'courses'], queryFn: listCoursesForAdmin })

  const remove = useMutation({
    mutationFn: (id: string) => deleteCourse(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'courses'] }),
  })

  if (editingId) {
    return (
      <Panel title="Cursos">
        <CourseEditor courseId={editingId} onClose={() => setEditingId(null)} />
      </Panel>
    )
  }

  return (
    <Panel title="Cursos">
      <div className="flex flex-col gap-lg">
        <NewCourseForm onCreated={setEditingId} />

        {isLoading && <p className="text-body-md text-on-surface-variant">Carregando…</p>}
        {isError && <p className="text-body-md text-error">Erro ao carregar os cursos.</p>}

        {data && data.courses.length === 0 && (
          <p className="text-body-md text-on-surface-variant">
            Nenhum curso cadastrado ainda. Crie o primeiro acima.
          </p>
        )}

        <ul className="flex flex-col gap-sm">
          {(data?.courses ?? []).map((course) => (
            <li
              key={course.id}
              className="flex flex-wrap items-center gap-md rounded-lg border border-outline-variant/30 bg-surface-container-low px-md py-sm"
            >
              <span
                className={`rounded-full px-sm py-0.5 font-label text-label-sm ${
                  course.published ? 'bg-primary/15 text-primary' : 'bg-surface-container-highest text-on-surface-variant'
                }`}
              >
                {course.published ? 'Publicado' : 'Rascunho'}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-label text-label-lg text-on-surface">{course.title}</p>
                <p className="text-body-sm text-on-surface-variant">
                  {course.category} · {course.totalLessons} aulas · {durationLabel(course.durationMinutes)}
                  {course.mandatory ? ' · obrigatório' : ''}
                  {course.enrolledCount > 0 ? ` · ${course.enrolledCount} inscritos` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingId(course.id)}
                className="rounded-md bg-surface-container-highest px-md py-sm font-label text-label-md text-on-surface"
              >
                Editar
              </button>
              <button
                type="button"
                onClick={() => remove.mutate(course.id)}
                disabled={remove.isPending}
                aria-label={`Excluir curso ${course.title}`}
                className="rounded-full p-2 text-on-surface-variant hover:text-error disabled:opacity-50"
              >
                <Icon name="delete" className="text-[20px]" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  )
}

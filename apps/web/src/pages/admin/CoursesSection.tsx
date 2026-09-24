import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  COURSE_LEVELS,
  COURSE_STATUSES,
  COURSE_STATUS_LABELS,
  COURSE_LEVEL_LABELS,
  MAX_LESSON_DURATION_MINUTES,
  type AdminCourseDTO,
  type AdminCourseLessonDTO,
  type AdminCourseModuleDTO,
  type CourseLessonBlock,
  type CourseLevel,
  type CourseStatus,
  type SectorDTO,
  hasLessonContent,
  lessonKindOf,
  LESSON_KIND_ICONS,
  isFullAdmin,
  sortCategoriesAsTree,
  POSITION_CATEGORIES,
  COURSE_RECOMMENDED_FOR,
  MAX_COURSE_REWARD,} from '@legends/shared'
import { Icon } from '../../components/Icon'
import { Select } from '../../components/Select'
import { PhotoUploadField } from '../../components/PhotoUploadField'
import { CourseBlockEditor } from './CourseBlockEditor'
import { CompetenciesTab, CourseCategoriesTab, InstructorsTab } from './CourseCatalogTabs'
import { CourseDashboardTab } from './CourseDashboardTab'
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
  competenciesApi,
  courseCategoriesApi,
  instructorsApi,
  listCourseQuizzes,
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

function LessonForm({
  moduleId,
  courseId,
  lesson,
  onDone,
}: {
  moduleId: string
  courseId: string
  lesson?: AdminCourseLessonDTO
  onDone: () => void
}) {
  const qc = useQueryClient()
  // O bloco de Quiz aponta para um `CourseQuiz` que já existe — daí precisar da
  // lista aqui. Mesma queryKey do editor de quiz: o React Query deduplica.
  const { data: quizData } = useQuery({
    queryKey: ['admin', 'course-quizzes', courseId],
    queryFn: () => listCourseQuizzes(courseId),
  })
  const quizzes = quizData?.quizzes.map((quiz) => ({ id: quiz.id, title: quiz.title })) ?? []
  const [title, setTitle] = useState(lesson?.title ?? '')
  const [blocks, setBlocks] = useState<CourseLessonBlock[]>(lesson?.blocks ?? [])
  const [durationMinutes, setDurationMinutes] = useState(String(lesson?.durationMinutes ?? 10))
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        title: title.trim(),
        blocks,
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
      <div className="grid gap-md sm:grid-cols-[3fr_1fr]">
        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Título da aula</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} className={inputCls} />
        </label>
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

      <div className="flex flex-col gap-1">
        <span className="font-label text-label-sm text-on-surface-variant">Conteúdo da aula</span>
        <CourseBlockEditor blocks={blocks} onChange={setBlocks} quizzes={quizzes} />
      </div>

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

function ModuleBlock({ courseModule, courseId }: { courseModule: AdminCourseModuleDTO; courseId: string }) {
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
              <LessonForm
                moduleId={courseModule.id}
                courseId={courseId}
                lesson={lesson}
                onDone={() => setEditingLessonId(null)}
              />
            </li>
          ) : (
            <li
              key={lesson.id}
              className="flex flex-wrap items-center gap-sm rounded-md bg-surface-container px-md py-sm"
            >
              <Icon
                name={LESSON_KIND_ICONS[lessonKindOf(lesson.blocks)]}
                className="text-[18px] text-primary"
              />
              <span className="min-w-0 flex-1 truncate text-body-sm text-on-surface">{lesson.title}</span>
              {!hasLessonContent(lesson.blocks) && (
                <span className="inline-flex items-center gap-1 rounded-full bg-error/10 px-sm py-0.5 font-label text-label-sm text-error">
                  <Icon name="warning" className="text-[14px]" /> sem conteúdo
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
        <LessonForm moduleId={courseModule.id} courseId={courseId} onDone={() => setAddingLesson(false)} />
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

/**
 * Os três passos da criação de curso (Documento 4, seção 9.6). São NAVEGAÇÃO,
 * não um fluxo travado: quem volta para editar não quer refazer o caminho, e o
 * curso já existe desde o "Criar curso" — não há nada a validar entre passos.
 */
type CourseStep = 'informacoes' | 'visual' | 'conteudo'

const COURSE_STEPS: { key: CourseStep; label: string }[] = [
  { key: 'informacoes', label: 'Informações' },
  { key: 'visual', label: 'Identidade visual' },
  { key: 'conteudo', label: 'Conteúdo' },
]

function CourseEditor({ courseId, onClose }: { courseId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [moduleTitle, setModuleTitle] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [step, setStep] = useState<CourseStep>('informacoes')

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

  const mudarStatus = useMutation({
    mutationFn: (status: CourseStatus) => updateCourse(courseId, { status }),
    onSuccess: () => {
      setMessage(null)
      invalidate()
    },
    onError: (err) => setMessage(errorMessage(err, 'Não foi possível alterar o status do curso.')),
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
            {course.categoryName ? `${course.categoryName} · ` : ''}
            {COURSE_LEVEL_LABELS[course.level]} · {course.totalLessons} aulas ·{' '}
            {durationLabel(course.durationMinutes)}
            {course.enrolledCount > 0 ? ` · ${course.enrolledCount} inscritos` : ''}
          </p>
        </div>
        {/* Cinco estados (Documento 4, seção 9.6), em rótulo português — o
            protótipo os mostra crus (`review`, `pending_approval`). Publicar
            continua tendo botão próprio: é a ação frequente, e enterrá-la num
            seletor de cinco itens custaria um clique a mais toda vez. */}
        <div className="flex flex-wrap items-center gap-sm">
          <div className="w-52">
            <Select
              ariaLabel="Status do curso"
              value={course.status}
              options={COURSE_STATUSES.map((option) => ({
                value: option,
                label: COURSE_STATUS_LABELS[option],
              }))}
              onChange={(next) => mudarStatus.mutate(next as CourseStatus)}
              disabled={mudarStatus.isPending}
            />
          </div>
          {course.status !== 'PUBLISHED' && (
            <button
              type="button"
              onClick={() => mudarStatus.mutate('PUBLISHED')}
              disabled={mudarStatus.isPending}
              className="rounded-md bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
            >
              Publicar curso
            </button>
          )}
        </div>
      </div>

      {message && <p className="text-body-sm text-error">{message}</p>}
      {course.status !== 'PUBLISHED' && (
        <p className="rounded-lg bg-surface-container-highest p-md text-body-sm text-on-surface-variant">
          {COURSE_STATUS_LABELS[course.status]}: o curso não aparece no catálogo nem abre por URL direta.
          Só “Publicado” o torna visível.
        </p>
      )}

      {/* Wizard de três passos (Documento 4, seção 9.6). O formulário era uma
          coluna só, com identificação, catálogo, público, recompensa, visual e
          conteúdo empilhados — dava para perder de vista o que já tinha sido
          preenchido. Os passos são NAVEGAÇÃO, não um fluxo travado: dá para ir
          direto ao terceiro, porque quem volta para editar não quer refazer o
          caminho. */}
      <nav aria-label="Passos do curso" className="flex flex-wrap gap-1 rounded-xl border border-outline-variant/40 bg-surface-container-low p-1">
        {COURSE_STEPS.map((item, index) => (
          <button
            key={item.key}
            type="button"
            aria-current={step === item.key ? 'step' : undefined}
            onClick={() => setStep(item.key)}
            className={`flex flex-1 items-center justify-center gap-xs rounded-lg px-md py-sm font-label text-label-md transition-colors ${
              step === item.key
                ? 'bg-primary/10 font-bold text-primary'
                : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
            }`}
          >
            <span
              aria-hidden
              className={`flex h-5 w-5 items-center justify-center rounded-full text-label-sm ${
                step === item.key ? 'bg-primary text-on-primary' : 'bg-surface-container-highest'
              }`}
            >
              {index + 1}
            </span>
            {item.label}
          </button>
        ))}
      </nav>

      {step !== 'conteudo' && <CourseFields course={course} step={step} onError={setMessage} />}

      {step === 'conteudo' && (
        <>
          <div className="flex flex-col gap-md">
            <h4 className="font-headline text-title-lg text-on-surface">Módulos e aulas</h4>
            {course.modules.map((courseModule) => (
              <ModuleBlock key={courseModule.id} courseModule={courseModule} courseId={course.id} />
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
            <h4 className="font-headline text-title-lg text-on-surface">Avaliações</h4>
            <CourseQuizEditor courseId={course.id} modules={course.modules} />
          </div>
        </>
      )}
    </div>
  )
}

/**
 * Escolha múltipla de itens do catálogo. Checkbox e não `Select` porque são
 * várias, e a lista é curta o bastante para caber na tela.
 *
 * Com `ordered`, mostra a posição de cada escolhido: no instrutor a ordem
 * importa — o primeiro é o principal, e é o que aparece sozinho no card.
 */
function CatalogPicker({
  label,
  empty,
  options,
  selected,
  onChange,
  ordered = false,
}: {
  label: string
  empty: string
  options: { id: string; label: string }[]
  selected: string[]
  onChange: (ids: string[]) => void
  ordered?: boolean
}) {
  function alternar(id: string) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])
  }

  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="font-label text-label-sm text-on-surface-variant">{label}</legend>
      {options.length === 0 ? (
        <p className="text-body-sm italic text-on-surface-variant">{empty}</p>
      ) : (
        <div className="flex flex-wrap gap-sm">
          {options.map((option) => {
            const posicao = selected.indexOf(option.id)
            const marcado = posicao >= 0
            return (
              <label
                key={option.id}
                className={`inline-flex cursor-pointer items-center gap-xs rounded-full border px-md py-1 text-body-sm transition-colors ${
                  marcado
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-outline-variant/60 text-on-surface-variant hover:border-primary'
                }`}
              >
                <input
                  type="checkbox"
                  checked={marcado}
                  onChange={() => alternar(option.id)}
                  className="sr-only"
                />
                {ordered && marcado && <span className="font-label text-label-sm">{posicao + 1}.</span>}
                {option.label}
              </label>
            )
          })}
        </div>
      )}
    </fieldset>
  )
}

/**
 * Prévia do card, em tempo real. Redesenha o cabeçalho do `CourseCard` do aluno
 * em vez de importá-lo: aquele é um `Link` dentro de uma grade, com favorito,
 * progresso e navegação — nada disso faz sentido dentro de um formulário, e
 * embutir o componente inteiro traria roteador junto.
 *
 * O que ela promete é o que o card mostra: capa, ou emoji sobre a cor.
 */
function CourseCardPreview({
  title,
  category,
  coverUrl,
  icon,
  primaryColor,
}: {
  title: string
  category: string | null
  coverUrl: string | null
  icon: string | null
  primaryColor: string | null
}) {
  return (
    // `div`/`p`, e não `article`/`h3`: a prévia é uma MAQUETE. Dar a ela a
    // semântica do card real injetaria um segundo título "Curso X" no outline
    // da página — que é o que um leitor de tela anunciaria como se fosse outra
    // seção, e o que fez dois testes acharem dois headings iguais.
    <div className="overflow-hidden rounded-xl border border-outline-variant/30 bg-surface-container">
      <div
        className="relative h-24 bg-gradient-to-br from-primary/25 via-primary/10 to-transparent"
        style={primaryColor ? { backgroundImage: 'none', backgroundColor: primaryColor } : undefined}
      >
        {coverUrl ? (
          <img src={coverUrl} alt="" className="h-full w-full object-cover" />
        ) : icon ? (
          <span aria-hidden className="absolute bottom-sm left-md text-[32px] leading-none">
            {icon}
          </span>
        ) : (
          <Icon name="school" className="absolute bottom-sm left-md text-[32px] text-primary" />
        )}
      </div>
      <div className="p-md">
        {category && (
          <p className="font-label text-label-sm uppercase tracking-wide text-primary">{category}</p>
        )}
        <p className="mt-0.5 font-headline text-title-md text-on-surface">{title}</p>
      </div>
    </div>
  )
}

function CourseFields({
  course,
  step,
  onError,
}: {
  course: AdminCourseDTO
  /** Qual passo renderizar. O estado do formulário é UM só para os dois: trocar
   *  de passo não pode perder o que foi digitado no outro. */
  step: 'informacoes' | 'visual'
  onError: (message: string | null) => void
}) {
  const qc = useQueryClient()
  const { user } = useAuth()
  const isAdmin = isFullAdmin(user)
  const [title, setTitle] = useState(course.title)
  const [categoryId, setCategoryId] = useState(course.categoryId ?? '')
  const [level, setLevel] = useState<CourseLevel>(course.level)
  const [shortDescription, setShortDescription] = useState(course.shortDescription ?? '')
  const [description, setDescription] = useState(course.description ?? '')
  const [instructorIds, setInstructorIds] = useState<string[]>(course.instructors.map((i) => i.id))
  const [competencyIds, setCompetencyIds] = useState<string[]>(course.competencyIds)
  const [audienceSectorIds, setAudienceSectorIds] = useState<string[]>(course.audienceSectorIds)
  const [audiencePositionCategories, setAudiencePositionCategories] = useState<string[]>(
    course.audiencePositionCategories,
  )
  const [recommendedFor, setRecommendedFor] = useState<string[]>(course.recommendedFor)
  // Uma imagem só para o curso. Havia "Capa (URL)" e "Banner (URL)", os dois
  // digitados à mão — e `bannerUrl` nunca foi desenhado em lugar nenhum do
  // portal, então a segunda URL só existia para divergir da primeira. A G&G
  // pediu uma imagem, por upload; é o `coverUrl`, que é o que o card mostra.
  const [coverUrl, setCoverUrl] = useState<string | null>(course.coverUrl)
  const [introVideoUrl, setIntroVideoUrl] = useState(course.introVideoUrl ?? '')
  const [icon, setIcon] = useState(course.icon ?? '')
  const [primaryColor, setPrimaryColor] = useState(course.primaryColor ?? '')
  const [rewardPoints, setRewardPoints] = useState(String(course.rewardPoints))
  const [rewardCoins, setRewardCoins] = useState(String(course.rewardCoins))
  const [autoEnroll, setAutoEnroll] = useState(course.autoEnroll)
  const [mandatory, setMandatory] = useState(course.mandatory)
  const [certificateEnabled, setCertificateEnabled] = useState(course.certificateEnabled)
  const [requiresCertificateApproval, setRequiresCertificateApproval] = useState(course.requiresCertificateApproval)
  const [certificateTemplateId, setCertificateTemplateId] = useState(course.certificateTemplateId ?? '')
  const [sectorId, setSectorId] = useState(course.sectorId ?? '')
  const [saved, setSaved] = useState(false)

  // O catálogo (Documento 4, 9.6 e 9.7). Mesmas queryKeys das abas de catálogo:
  // o React Query deduplica, e editar lá reflete aqui sem recarregar a página.
  const { data: categoriasData } = useQuery({
    queryKey: ['admin', 'course-categories'],
    queryFn: courseCategoriesApi.list,
  })
  const { data: competenciasData } = useQuery({
    queryKey: ['admin', 'competencies'],
    queryFn: competenciesApi.list,
  })
  const { data: instrutoresData } = useQuery({
    queryKey: ['admin', 'instructors'],
    queryFn: instructorsApi.list,
  })
  // Um item desativado some das ESCOLHAS novas, mas o curso que já o usa continua
  // com ele — por isso o que já está selecionado entra na lista de qualquer jeito.
  const manter = <T extends { id: string; active: boolean }>(itens: T[], escolhidos: string[]) =>
    itens.filter((item) => item.active || escolhidos.includes(item.id))
  const categoriasAtivas = sortCategoriesAsTree(
    manter(categoriasData?.categories ?? [], categoryId ? [categoryId] : []),
  )
  const competenciasAtivas = manter(competenciasData?.competencies ?? [], competencyIds)
  const instrutoresAtivos = manter(instrutoresData?.instructors ?? [], instructorIds)

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
        categoryId: categoryId || null,
        level,
        shortDescription: shortDescription.trim() || null,
        description: description.trim() || null,
        competencyIds,
        instructorIds,
        audienceSectorIds,
        audiencePositionCategories,
        recommendedFor,
        autoEnroll,
        coverUrl: coverUrl || null,
        introVideoUrl: introVideoUrl.trim() || null,
        icon: icon.trim() || null,
        primaryColor: primaryColor.trim() || null,
        rewardPoints: Number(rewardPoints) || 0,
        rewardCoins: Number(rewardCoins) || 0,
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
      {/* Os dois passos compartilham UM estado de formulário: trocar de passo
          não pode perder o que foi digitado no outro, e o salvamento é um só. */}
      {step === 'informacoes' && (
        <>
      <div className="grid gap-md sm:grid-cols-3">
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="font-label text-label-sm text-on-surface-variant">Título</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} className={inputCls} />
        </label>
        <div className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Categoria</span>
          <Select
            ariaLabel="Categoria do curso"
            value={categoryId}
            placeholder="— sem categoria —"
            searchable
            // Só as ativas: desativar uma categoria tira ela das novas escolhas
            // sem mexer nos cursos que já a usam.
            options={categoriasAtivas.map((c) => ({
              value: c.id,
              label: c.parentName ? `${c.parentName} › ${c.name}` : c.name,
            }))}
            onChange={setCategoryId}
          />
        </div>
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
      </div>

      {/* Instrutor e competência saíram do texto livre e viram escolha do
          catálogo (Documento 4, 9.6 e 9.7). Instrutor aceita mais de um, e a
          ORDEM importa: o primeiro é o principal, e é o que vai no card. */}
      <CatalogPicker
        label="Instrutores"
        empty="Nenhum instrutor cadastrado. Cadastre na aba Instrutores."
        options={instrutoresAtivos.map((i) => ({ id: i.id, label: i.name }))}
        selected={instructorIds}
        onChange={setInstructorIds}
        ordered
      />
      <CatalogPicker
        label="Competências desenvolvidas"
        empty="Nenhuma competência cadastrada. Cadastre na aba Competências."
        options={competenciasAtivas.map((c) => ({ id: c.id, label: c.icon ? `${c.icon} ${c.name}` : c.name }))}
        selected={competencyIds}
        onChange={setCompetencyIds}
      />

        </>
      )}

      {/* Identidade visual (Documento 4, seção 9.6, passo 2). A prévia fica ao
          lado dos campos, e não abaixo: a pergunta que ela responde é "como vai
          ficar?", e responder depois de rolar a tela não responde. */}
      {step === 'visual' && (
      <div className="flex flex-col gap-md rounded-lg border border-outline-variant/40 bg-surface-container-low p-md">
        <div>
          <h4 className="font-label text-label-lg text-on-surface">Identidade visual</h4>
          <p className="text-body-sm text-on-surface-variant">
            Sem capa, o emoji e a cor vestem o card — que é o caso da maioria dos cursos internos.
          </p>
        </div>

        <div className="grid gap-md lg:grid-cols-[1fr_16rem]">
          <div className="flex flex-col gap-md">
            <div className="flex flex-wrap gap-md">
              <label className="flex flex-col gap-1">
                <span className="font-label text-label-sm text-on-surface-variant">Ícone (emoji)</span>
                <input
                  value={icon}
                  onChange={(event) => setIcon(event.target.value)}
                  maxLength={4}
                  placeholder="🎓"
                  className={`${inputCls} w-20 text-center text-[20px]`}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-label text-label-sm text-on-surface-variant">Cor principal</span>
                <input
                  type="color"
                  value={primaryColor || '#2f8b4d'}
                  onChange={(event) => setPrimaryColor(event.target.value)}
                  aria-label="Cor principal do curso"
                  className="h-10 w-20 cursor-pointer rounded-md border border-outline-variant/60 bg-surface-container-highest"
                />
              </label>
              {primaryColor && (
                <button
                  type="button"
                  onClick={() => setPrimaryColor('')}
                  className="self-end pb-2 font-label text-label-sm text-on-surface-variant hover:text-primary"
                >
                  Usar a cor do portal
                </button>
              )}
            </div>

            <PhotoUploadField
              value={coverUrl}
              onChange={setCoverUrl}
              label="Imagem do curso"
              hint="Aparece no card do catálogo e no topo do curso. Sem imagem, o card usa o emoji sobre a cor."
              shape="rect"
              icon="school"
              actionLabel="imagem"
            />
            <label className="flex flex-col gap-1">
              <span className="font-label text-label-sm text-on-surface-variant">
                Vídeo de apresentação (YouTube, Vimeo ou URL do arquivo)
              </span>
              <input
                value={introVideoUrl}
                onChange={(e) => setIntroVideoUrl(e.target.value)}
                className={inputCls}
              />
            </label>
          </div>

          <div className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Prévia do card</span>
            <CourseCardPreview
              title={title || course.title}
              category={course.categoryName}
              coverUrl={coverUrl}
              icon={icon.trim() || null}
              primaryColor={primaryColor.trim() || null}
            />
          </div>
        </div>
      </div>

      )}

      {step === 'informacoes' && (
        <>
      {/* Recompensa ao concluir (Documento 4, seção 9.6). Fica junto do
          público-alvo porque as duas respondem à mesma pergunta do formulário —
          o que acontece com quem faz o curso. */}
      <div className="flex flex-wrap items-end gap-md rounded-lg border border-outline-variant/40 bg-surface-container-low p-md">
        <div className="w-full">
          <h4 className="font-label text-label-lg text-on-surface">Recompensa ao concluir</h4>
          <p className="text-body-sm text-on-surface-variant">
            Zero em qualquer um dos dois não gera lançamento. Paga uma vez por curso.
          </p>
        </div>
        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">Pontos</span>
          <input
            type="number"
            min={0}
            max={MAX_COURSE_REWARD}
            value={rewardPoints}
            onChange={(event) => setRewardPoints(event.target.value)}
            className={`${inputCls} w-28`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-label text-label-sm text-on-surface-variant">EMR Coins</span>
          <input
            type="number"
            min={0}
            max={MAX_COURSE_REWARD}
            value={rewardCoins}
            onChange={(event) => setRewardCoins(event.target.value)}
            className={`${inputCls} w-28`}
          />
        </label>
      </div>

      {/* Público-alvo (Documento 4, seção 9.2). Separado do resto por borda
          porque muda QUEM VÊ o curso — e é o único bloco da tela que faz isso. */}
      <div className="flex flex-col gap-md rounded-lg border border-outline-variant/40 bg-surface-container-low p-md">
        <div>
          <h4 className="font-label text-label-lg text-on-surface">Público-alvo</h4>
          <p className="text-body-sm text-on-surface-variant">
            Sem nada marcado, o curso é da empresa toda.
          </p>
        </div>

        <CatalogPicker
          label="Setores que também enxergam"
          empty="Nenhum setor cadastrado."
          options={sectors.map((sector) => ({ id: sector.id, label: sector.name }))}
          selected={audienceSectorIds}
          onChange={setAudienceSectorIds}
        />

        <CatalogPicker
          label="Categorias de cargo"
          empty=""
          options={POSITION_CATEGORIES.map((c) => ({ id: c, label: c }))}
          selected={audiencePositionCategories}
          onChange={setAudiencePositionCategories}
        />
        {audiencePositionCategories.length > 0 && (
          // O mesmo aviso que o AGENTS.md dá sobre `managerId`: sem o dado
          // importado, o recorte esvazia a tela em silêncio.
          <p className="rounded-md bg-secondary/10 p-sm text-body-sm text-on-surface-variant">
            Quem estiver sem categoria de cargo preenchida não vai enxergar este curso. A categoria vem da
            importação de colaboradores.
          </p>
        )}

        <CatalogPicker
          label="Recomendado para (só rótulo, não restringe)"
          empty=""
          options={COURSE_RECOMMENDED_FOR.map((r) => ({ id: r, label: r }))}
          selected={recommendedFor}
          onChange={setRecommendedFor}
        />

        <label className="flex items-center gap-sm text-body-md text-on-surface-variant">
          <input
            type="checkbox"
            checked={autoEnroll}
            onChange={(event) => setAutoEnroll(event.target.checked)}
          />
          Inscrever automaticamente quem está no público-alvo
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

        </>
      )}

      {/* O botão fica nos DOIS passos: o estado é um só, e obrigar a voltar ao
          passo 1 para salvar uma cor seria pedir um passeio. */}
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
  const [error, setError] = useState<string | null>(null)

  // Só o título: a categoria virou escolha do catálogo e é feita na edição, com
  // o seletor. Exigi-la aqui obrigaria a abrir a aba de Categorias antes de
  // conseguir criar o primeiro curso.
  const create = useMutation({
    mutationFn: () => createCourse({ title: title.trim() }),
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
        if (title.trim()) create.mutate()
      }}
      className="flex flex-wrap items-end gap-sm rounded-lg border border-dashed border-outline-variant/50 p-md"
    >
      <label className="flex min-w-[14rem] flex-1 flex-col gap-1">
        <span className="font-label text-label-sm text-on-surface-variant">Título do curso</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} className={inputCls} />
      </label>
      <button
        type="submit"
        disabled={!title.trim() || create.isPending}
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
/**
 * Abas da Central de Cursos (Documento 4, seção 9.6). Cursos é a primeira por
 * ser a tela de trabalho; o catálogo é o que se configura antes e se revisita
 * pouco.
 */
type CatalogTab = 'dashboard' | 'cursos' | 'categorias' | 'competencias' | 'instrutores'

const CATALOG_TABS: { key: CatalogTab; label: string; icon: string }[] = [
  // Cursos continua sendo a primeira: é a tela de trabalho. O dashboard responde
  // "como está o catálogo", que é pergunta de quem vem revisar, não de quem vem
  // escrever.
  { key: 'cursos', label: 'Cursos', icon: 'school' },
  { key: 'dashboard', label: 'Dashboard', icon: 'insights' },
  { key: 'categorias', label: 'Categorias', icon: 'folder' },
  { key: 'competencias', label: 'Competências', icon: 'psychology' },
  { key: 'instrutores', label: 'Instrutores', icon: 'record_voice_over' },
]

export function CoursesSection() {
  const qc = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [tab, setTab] = useState<CatalogTab>('cursos')
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

  const abas = (
    <div
      role="tablist"
      aria-label="Seções da Central de Cursos"
      className="flex flex-wrap gap-1 rounded-xl border border-outline-variant/40 bg-surface-container-low p-1"
    >
      {CATALOG_TABS.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          aria-selected={tab === item.key}
          onClick={() => setTab(item.key)}
          className={`flex flex-1 items-center justify-center gap-xs rounded-lg px-md py-sm font-label text-label-md transition-colors ${
            tab === item.key
              ? 'bg-primary/10 font-bold text-primary'
              : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface'
          }`}
        >
          <Icon name={item.icon} className="text-[18px]" />
          {item.label}
        </button>
      ))}
    </div>
  )

  if (tab !== 'cursos') {
    return (
      <Panel title="Cursos">
        <div className="flex flex-col gap-lg">
          {abas}
          {tab === 'dashboard' && <CourseDashboardTab />}
          {tab === 'categorias' && <CourseCategoriesTab />}
          {tab === 'competencias' && <CompetenciesTab />}
          {tab === 'instrutores' && <InstructorsTab />}
        </div>
      </Panel>
    )
  }

  return (
    <Panel title="Cursos">
      <div className="flex flex-col gap-lg">
        {abas}

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
                  course.status === 'PUBLISHED'
                    ? 'bg-primary/15 text-primary'
                    : 'bg-surface-container-highest text-on-surface-variant'
                }`}
              >
                {COURSE_STATUS_LABELS[course.status]}
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

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import {
  APPRENTICE_JUSTIFICATIONS,
  APPRENTICE_REVIEW_STATUS_EMOJI,
  APPRENTICE_SURVEY_LEARNED,
  APPRENTICE_SURVEY_LEARNED_LABELS,
  type ApprenticeMeetingDTO,
} from '@legends/shared'
import { Icon } from '../../components/Icon'
import { Skeleton } from '../../components/Skeleton'
import {
  addApprenticeMaterial,
  createApprenticeClass,
  createApprenticeMakeup,
  deleteApprenticeActivity,
  deleteApprenticeClass,
  deleteApprenticeMakeup,
  fetchAdminApprenticeActivities,
  fetchAdminApprenticeMeetings,
  fetchApprenticeAttendance,
  fetchApprenticeClasses,
  fetchApprenticeMakeups,
  fetchApprenticeOverview,
  fetchApprenticePeople,
  fetchApprenticeProgress,
  markAllPresent,
  setApprenticeAttendance,
  setApprenticeEnrollment,
  setApprenticeMeetingFlag,
  updateApprenticeActivity,
  updateApprenticeMeeting,
} from '../../lib/apprentice-api'
import { UploadError, uploadApprenticeMaterial } from '../../lib/upload'
import { AssistantTab } from './AssistantTab'
import { JourneyTab } from './JourneyTab'
import { TasksTab } from './TasksTab'

const TABS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'encontros', label: 'Gestão dos Encontros' },
  { key: 'presenca', label: 'Presença' },
  { key: 'andamento', label: 'Andamento' },
  { key: 'jornada', label: 'Jornada' },
  { key: 'quadro', label: 'Quadro de gestão' },
  { key: 'assistente', label: 'Assistente' },
  { key: 'turmas', label: 'Turmas' },
] as const

type TabKey = (typeof TABS)[number]['key']

type UploadedMaterial = Awaited<ReturnType<typeof uploadApprenticeMaterial>>

function isTabKey(value: string | null): value is TabKey {
  return TABS.some((tab) => tab.key === value)
}

const inputCls =
  'w-full rounded-lg border border-outline-variant bg-surface px-md py-sm font-body text-body-md text-on-surface'
const labelCls = 'font-label text-label-sm uppercase text-on-surface-variant'
const cardCls = 'rounded-xl border border-outline-variant/40 bg-surface-container p-lg'

/**
 * `h-full` + `mt-auto` na dica: no tablet os indicadores caem em 2×2, e sem
 * isso cada tile fica com a altura do próprio texto — a linha de baixo sobe
 * onde a dica é curta e a grade fica serrilhada.
 */
function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className={`${cardCls} flex h-full flex-col`}>
      <p className={labelCls}>{label}</p>
      <p className="mt-xs font-headline text-headline-xl text-on-primary-container">{value}</p>
      {hint && <p className="mt-auto pt-xs font-body text-body-sm text-on-surface-variant">{hint}</p>}
    </div>
  )
}

// ---- Dashboard ----

function DashboardTab({ meetings }: { meetings: ApprenticeMeetingDTO[] }) {
  const [meetingId, setMeetingId] = useState<string>('')
  const [classId, setClassId] = useState<string>('')
  const [userId, setUserId] = useState<string>('')

  const classes = useQuery({ queryKey: ['apprentice', 'classes'], queryFn: fetchApprenticeClasses })
  const people = useQuery({ queryKey: ['apprentice', 'people'], queryFn: fetchApprenticePeople })
  const { data, isPending } = useQuery({
    queryKey: ['apprentice', 'overview', meetingId, classId, userId],
    queryFn: () =>
      fetchApprenticeOverview({
        ...(meetingId ? { meetingId } : {}),
        ...(classId ? { classId } : {}),
        ...(userId ? { userId } : {}),
      }),
  })

  if (isPending) return <Skeleton className="h-96 w-full rounded-xl" />
  if (!data) return null

  const survey = data.survey

  return (
    <div className="flex flex-col gap-lg">
      <div className={`${cardCls} grid gap-md sm:grid-cols-3`}>
        <label className="flex flex-col gap-xs">
          <span className={labelCls}>Encontro</span>
          <select value={meetingId} onChange={(e) => setMeetingId(e.target.value)} className={inputCls}>
            <option value="">Todos os encontros</option>
            {meetings.map((meeting) => (
              <option key={meeting.id} value={meeting.id}>
                Encontro {meeting.order} · {meeting.title}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-xs">
          <span className={labelCls}>Turma</span>
          <select value={classId} onChange={(e) => setClassId(e.target.value)} className={inputCls}>
            <option value="">Todas as turmas</option>
            {classes.data?.map((turma) => (
              <option key={turma.id} value={turma.id}>
                {turma.name}
                {turma.shift ? ` · ${turma.shift}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-xs">
          <span className={labelCls}>Jovem Aprendiz</span>
          <select value={userId} onChange={(e) => setUserId(e.target.value)} className={inputCls}>
            <option value="">Todos os aprendizes</option>
            {people.data?.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-lg sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Progresso das fichas"
          value={data.activities.rate === null ? '—' : `${data.activities.rate}%`}
          hint={`${data.activities.submitted} de ${data.activities.expected} fichas enviadas`}
        />
        <Metric
          label="Taxa de presença"
          value={data.attendance.rate === null ? '—' : `${data.attendance.rate}%`}
          hint={`${data.attendance.absences} faltas (${data.attendance.justifiedAbsences} justificadas)`}
        />
        <Metric
          label="Cumprimento de compromissos"
          value={data.commitments.rate === null ? '—' : `${data.commitments.rate}%`}
          hint={
            data.commitments.reviews === 0
              ? 'Nenhuma revisão enviada ainda.'
              : `${data.commitments.fulfilled} total · ${data.commitments.partial} parcial · ${data.commitments.unfulfilled} não cumpriu`
          }
        />
        <Metric
          label="Respostas da pesquisa"
          value={String(survey.total)}
          hint="respostas anônimas recebidas"
        />
      </div>

      <div className="grid gap-lg lg:grid-cols-2">
        <div className={cardCls}>
          <p className={labelCls}>Nota média e NPS</p>
          <p className="mt-xs font-headline text-headline-xl text-on-primary-container">
            {survey.averageScore === null ? '—' : survey.averageScore}
            <span className="font-body text-body-md text-on-surface-variant"> / 10</span>
          </p>
          <p className="mt-sm font-body text-body-md text-on-surface">
            NPS {survey.nps === null ? '—' : survey.nps} · {survey.promoters} promotores ·{' '}
            {survey.neutrals} neutros · {survey.detractors} detratores
          </p>
        </div>
        <div className={cardCls}>
          <p className={labelCls}>Aprendeu algo novo</p>
          <div className="mt-sm flex flex-col gap-sm">
            {APPRENTICE_SURVEY_LEARNED.map((option) => {
              const count = survey.learned[option]
              const percent = survey.total > 0 ? Math.round((count / survey.total) * 100) : 0
              return (
                <div key={option}>
                  <div className="flex justify-between font-body text-body-sm text-on-surface">
                    <span>{APPRENTICE_SURVEY_LEARNED_LABELS[option]}</span>
                    <span>
                      {count} · {percent}%
                    </span>
                  </div>
                  <div className="mt-xs h-2 w-full rounded-full bg-surface-container-highest">
                    <div className="h-2 rounded-full bg-primary" style={{ width: `${percent}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="grid gap-lg lg:grid-cols-2">
        <div className={cardCls}>
          <p className={labelCls}>O que os aprendizes levam</p>
          {survey.takeaways.length === 0 ? (
            <p className="mt-sm font-body text-body-md text-on-surface-variant">Sem respostas ainda.</p>
          ) : (
            <ul className="mt-sm flex flex-col gap-xs">
              {survey.takeaways.map((text, index) => (
                <li key={index} className="rounded-lg bg-surface p-md font-body text-body-sm text-on-surface">
                  {text}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={cardCls}>
          <p className={labelCls}>Oportunidades de melhoria</p>
          {survey.improvements.length === 0 ? (
            <p className="mt-sm font-body text-body-md text-on-surface-variant">Sem respostas ainda.</p>
          ) : (
            <ul className="mt-sm flex flex-col gap-xs">
              {survey.improvements.map((text, index) => (
                <li key={index} className="rounded-lg bg-surface p-md font-body text-body-sm text-on-surface">
                  {text}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <p className="font-body text-body-sm text-on-surface-variant">
        As respostas não guardam vínculo com quem respondeu. Com uma turma pequena, porém, o texto
        livre pode identificar a pessoa — leia com esse cuidado.
      </p>
    </div>
  )
}

// ---- Gestão dos encontros ----

function MeetingsTab({ meetings }: { meetings: ApprenticeMeetingDTO[] }) {
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState(meetings[0]?.id ?? '')
  const meeting = meetings.find((row) => row.id === selectedId) ?? meetings[0]

  const [form, setForm] = useState({ title: '', theme: '', objectives: '', deliverable: '', scheduledOn: '', slideUrl: '' })
  const [material, setMaterial] = useState({ name: '', url: '' })
  // Arquivo já enviado ao S3, esperando o "Adicionar". A chave nasce no
  // servidor; aqui só guardamos o que ele devolveu.
  const [arquivo, setArquivo] = useState<UploadedMaterial | null>(null)
  const [slide, setSlide] = useState<UploadedMaterial | null>(null)
  const [erroUpload, setErroUpload] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    if (!meeting) return
    setForm({
      title: meeting.title,
      theme: meeting.theme,
      objectives: meeting.objectives.join('\n'),
      deliverable: meeting.deliverable,
      scheduledOn: meeting.scheduledOn ?? '',
      slideUrl: meeting.slideUrl ?? '',
    })
  }, [meeting?.id])

  const activities = useQuery({
    queryKey: ['apprentice', 'admin-activities', meeting?.id],
    queryFn: () => fetchAdminApprenticeActivities(meeting!.id),
    enabled: Boolean(meeting?.id),
  })

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['apprentice'] })

  const save = useMutation({
    mutationFn: () =>
      updateApprenticeMeeting(meeting!.id, {
        title: form.title,
        theme: form.theme,
        objectives: form.objectives.split('\n').map((line) => line.trim()).filter(Boolean),
        deliverable: form.deliverable,
        scheduledOn: form.scheduledOn || null,
        slideUrl: form.slideUrl || null,
        ...(slide ? { slideKey: slide.key, slideFileName: slide.fileName } : {}),
      }),
    onSuccess: () => {
      setSlide(null)
      invalidate()
    },
  })

  const toggle = useMutation({
    mutationFn: (input: { flag: 'accessReleased' | 'surveyOpen'; value: boolean }) =>
      setApprenticeMeetingFlag(meeting!.id, input.flag, input.value),
    onSuccess: invalidate,
  })

  const addMaterial = useMutation({
    mutationFn: () =>
      addApprenticeMaterial(meeting!.id, {
        name: material.name,
        // Link OU arquivo, nunca os dois — é o que o servidor exige.
        ...(arquivo
          ? {
              documentKey: arquivo.key,
              fileName: arquivo.fileName,
              contentType: arquivo.contentType,
              sizeBytes: arquivo.sizeBytes,
            }
          : { url: material.url }),
      }),
    onSuccess: () => {
      setMaterial({ name: '', url: '' })
      setArquivo(null)
      invalidate()
    },
  })

  async function receberArquivo(file: File | undefined, destino: 'material' | 'slide') {
    if (!file) return
    setErroUpload(null)
    setEnviando(true)
    try {
      const enviado = await uploadApprenticeMaterial(file)
      if (destino === 'slide') setSlide(enviado)
      else {
        setArquivo(enviado)
        setMaterial((prev) => ({ ...prev, url: '', name: prev.name || file.name.replace(/\.[^.]+$/, '') }))
      }
    } catch (err) {
      setErroUpload(err instanceof UploadError ? err.message : 'Não foi possível enviar o arquivo.')
    } finally {
      setEnviando(false)
    }
  }

  const removeActivity = useMutation({
    mutationFn: (activityId: string) => deleteApprenticeActivity(activityId),
    onSuccess: invalidate,
  })

  if (!meeting) {
    return <p className="font-body text-body-md text-on-surface-variant">Nenhum encontro cadastrado.</p>
  }

  return (
    <div className="flex flex-col gap-lg">
      <nav className="flex flex-wrap gap-xs" aria-label="Escolher encontro">
        {meetings.map((row) => (
          <button
            key={row.id}
            type="button"
            aria-pressed={row.id === meeting.id}
            onClick={() => setSelectedId(row.id)}
            className={`rounded-full border px-lg py-sm font-label text-label-md ${
              row.id === meeting.id
                ? 'border-primary bg-primary text-on-primary'
                : 'border-outline-variant bg-surface-container text-on-surface'
            }`}
          >
            Encontro {row.order}
          </button>
        ))}
      </nav>

      <div className={`${cardCls} flex flex-wrap items-center gap-lg`}>
        <label className="flex items-center gap-sm font-body text-body-md text-on-surface">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={meeting.accessReleased}
            onChange={(e) => toggle.mutate({ flag: 'accessReleased', value: e.target.checked })}
          />
          Acesso ao encontro liberado
        </label>
        <label className="flex items-center gap-sm font-body text-body-md text-on-surface">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={meeting.surveyOpen}
            onChange={(e) => toggle.mutate({ flag: 'surveyOpen', value: e.target.checked })}
          />
          Pesquisa de satisfação aberta
        </label>
      </div>

      <div className={`${cardCls} flex flex-col gap-md`}>
        <h3 className="font-headline text-headline-sm text-on-surface">Informações do encontro</h3>
        <div className="grid gap-md sm:grid-cols-2">
          <label className="flex flex-col gap-xs">
            <span className={labelCls}>Título</span>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={inputCls} />
          </label>
          <label className="flex flex-col gap-xs">
            <span className={labelCls}>Data prevista</span>
            <input
              type="date"
              value={form.scheduledOn}
              onChange={(e) => setForm({ ...form, scheduledOn: e.target.value })}
              className={inputCls}
            />
          </label>
        </div>
        <label className="flex flex-col gap-xs">
          <span className={labelCls}>Tema</span>
          <input value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value })} className={inputCls} />
        </label>
        <label className="flex flex-col gap-xs">
          <span className={labelCls}>Objetivos (um por linha)</span>
          <textarea
            rows={4}
            value={form.objectives}
            onChange={(e) => setForm({ ...form, objectives: e.target.value })}
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-xs">
          <span className={labelCls}>Entregável esperado</span>
          <textarea
            rows={2}
            value={form.deliverable}
            onChange={(e) => setForm({ ...form, deliverable: e.target.value })}
            className={inputCls}
          />
        </label>
        <div className="grid gap-md sm:grid-cols-2">
          <label className="flex flex-col gap-xs">
            <span className={labelCls}>Link da apresentação</span>
            <input value={form.slideUrl} onChange={(e) => setForm({ ...form, slideUrl: e.target.value })} className={inputCls} />
          </label>
          <label className="flex flex-col gap-xs">
            <span className={labelCls}>…ou envie o arquivo</span>
            <input
              type="file"
              disabled={enviando}
              onChange={(e) => void receberArquivo(e.target.files?.[0], 'slide')}
              className="font-body text-body-sm text-on-surface-variant file:mr-sm file:rounded-full file:border-0 file:bg-primary file:px-md file:py-xs file:font-label file:text-label-sm file:text-on-primary"
            />
            {slide && (
              <span className="font-body text-body-sm text-on-primary-container">
                {slide.fileName} — salve o encontro para aplicar.
              </span>
            )}
          </label>
        </div>
        <button
          type="button"
          disabled={save.isPending}
          onClick={() => save.mutate()}
          className="self-start rounded-full bg-primary px-lg py-sm font-label text-label-lg text-on-primary disabled:bg-surface-container-highest disabled:text-on-surface-variant"
        >
          Salvar encontro
        </button>
      </div>

      <div className={`${cardCls} flex flex-col gap-md`}>
        <h3 className="font-headline text-headline-sm text-on-surface">Materiais complementares</h3>
        <div className="grid gap-md sm:grid-cols-[1fr_1fr_auto]">
          <input
            placeholder="Nome do material"
            value={material.name}
            onChange={(e) => setMaterial({ ...material, name: e.target.value })}
            className={inputCls}
          />
          <input
            placeholder="https://..."
            value={material.url}
            disabled={Boolean(arquivo)}
            onChange={(e) => setMaterial({ ...material, url: e.target.value })}
            className={inputCls}
          />
          <button
            type="button"
            disabled={
              !material.name.trim() ||
              (!material.url.trim() && !arquivo) ||
              addMaterial.isPending ||
              enviando
            }
            onClick={() => addMaterial.mutate()}
            className="rounded-full bg-primary px-lg py-sm font-label text-label-lg text-on-primary disabled:bg-surface-container-highest disabled:text-on-surface-variant"
          >
            Adicionar
          </button>
        </div>
        <label className="flex flex-col gap-xs">
          <span className={labelCls}>…ou envie um arquivo (slides, planilha, PDF, imagem)</span>
          <input
            type="file"
            disabled={enviando}
            onChange={(e) => void receberArquivo(e.target.files?.[0], 'material')}
            className="font-body text-body-sm text-on-surface-variant file:mr-sm file:rounded-full file:border-0 file:bg-primary file:px-md file:py-xs file:font-label file:text-label-sm file:text-on-primary"
          />
          {arquivo && (
            <span className="font-body text-body-sm text-on-primary-container">
              {arquivo.fileName} pronto — o link fica desabilitado, é um ou outro.
            </span>
          )}
        </label>
        {erroUpload && <p className="font-body text-body-sm text-error">{erroUpload}</p>}
      </div>

      <div className={`${cardCls} flex flex-col gap-md`}>
        <h3 className="font-headline text-headline-sm text-on-surface">Fichas do encontro</h3>
        {activities.data?.length === 0 && (
          <p className="font-body text-body-md text-on-surface-variant">Nenhuma ficha neste encontro.</p>
        )}
        {activities.data?.map((activity) => (
          <ActivityEditor key={activity.id} activity={activity} onRemove={() => removeActivity.mutate(activity.id)} />
        ))}
      </div>
    </div>
  )
}

/**
 * Editor da ficha. O schema é editado como JSON — um construtor visual de
 * formulário é uma tela inteira, e o que a G&G precisa hoje é conseguir corrigir
 * uma pergunta sem esperar deploy. O JSON é validado pelo Zod na rota, então
 * erro de formato volta como 400 em vez de gravar ficha quebrada.
 */
function ActivityEditor({
  activity,
  onRemove,
}: {
  activity: { id: string; title: string; kind: string; order: number; schema: unknown }
  onRemove: () => void
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(activity.title)
  const [schemaText, setSchemaText] = useState(() => JSON.stringify(activity.schema, null, 2))
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () => {
      let parsed: unknown
      try {
        parsed = JSON.parse(schemaText)
      } catch {
        throw new Error('O JSON da ficha está inválido.')
      }
      return updateApprenticeActivity(activity.id, {
        title,
        schema: parsed as Parameters<typeof updateApprenticeActivity>[1]['schema'],
      })
    },
    onSuccess: () => {
      setError(null)
      void queryClient.invalidateQueries({ queryKey: ['apprentice'] })
    },
    onError: (err: Error) => setError(err.message),
  })

  return (
    <div className="rounded-lg border border-outline-variant/40 bg-surface">
      <div className="flex items-center justify-between gap-sm p-md">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-w-0 items-center gap-sm text-left">
          <Icon name={open ? 'expand_less' : 'expand_more'} className="text-on-surface-variant" />
          <span className="truncate font-label text-label-lg text-on-surface">{activity.title}</span>
          <span className="shrink-0 rounded-full bg-surface-container-highest px-sm py-xs font-label text-label-sm text-on-surface-variant">
            {activity.kind}
          </span>
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remover ${activity.title}`}
          className="shrink-0 text-on-surface-variant hover:text-error"
        >
          <Icon name="delete" />
        </button>
      </div>

      {open && (
        <div className="flex flex-col gap-sm border-t border-outline-variant/40 p-md">
          <label className="flex flex-col gap-xs">
            <span className={labelCls}>Título da ficha</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
          </label>
          <label className="flex flex-col gap-xs">
            <span className={labelCls}>Estrutura (JSON)</span>
            <textarea
              rows={14}
              value={schemaText}
              onChange={(e) => setSchemaText(e.target.value)}
              spellCheck={false}
              className={`${inputCls} font-mono text-body-sm`}
            />
          </label>
          {error && <p className="font-body text-body-sm text-error">{error}</p>}
          <button
            type="button"
            disabled={save.isPending}
            onClick={() => save.mutate()}
            className="self-start rounded-full bg-primary px-lg py-sm font-label text-label-lg text-on-primary disabled:bg-surface-container-highest disabled:text-on-surface-variant"
          >
            Salvar ficha
          </button>
        </div>
      )}
    </div>
  )
}

// ---- Presença ----

function AttendanceTab({ meetings }: { meetings: ApprenticeMeetingDTO[] }) {
  const queryClient = useQueryClient()
  const [meetingId, setMeetingId] = useState(meetings[0]?.id ?? '')
  const [makeup, setMakeup] = useState({ scheduledAt: '', userIds: [] as string[] })

  const attendance = useQuery({
    queryKey: ['apprentice', 'attendance', meetingId],
    queryFn: () => fetchApprenticeAttendance(meetingId),
    enabled: Boolean(meetingId),
  })
  const makeups = useQuery({ queryKey: ['apprentice', 'makeups'], queryFn: fetchApprenticeMakeups })

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['apprentice'] })

  const mark = useMutation({
    mutationFn: (input: {
      userId: string
      present: boolean | null
      justification?: string | null
      needsMakeup?: boolean
    }) => setApprenticeAttendance(meetingId, input),
    onSuccess: invalidate,
  })

  const allPresent = useMutation({
    mutationFn: () => markAllPresent(meetingId, null),
    onSuccess: invalidate,
  })

  const scheduleMakeup = useMutation({
    mutationFn: () =>
      createApprenticeMakeup({ meetingId, scheduledAt: new Date(makeup.scheduledAt).toISOString(), userIds: makeup.userIds }),
    onSuccess: () => {
      setMakeup({ scheduledAt: '', userIds: [] })
      invalidate()
    },
  })

  const removeMakeup = useMutation({
    mutationFn: (id: string) => deleteApprenticeMakeup(id),
    onSuccess: invalidate,
  })

  return (
    <div className="flex flex-col gap-lg">
      <label className="flex flex-col gap-xs">
        <span className={labelCls}>Encontro</span>
        <select value={meetingId} onChange={(e) => setMeetingId(e.target.value)} className={`${inputCls} sm:max-w-md`}>
          {meetings.map((meeting) => (
            <option key={meeting.id} value={meeting.id}>
              Encontro {meeting.order} · {meeting.title}
            </option>
          ))}
        </select>
      </label>

      <div className={`${cardCls} flex flex-col gap-md`}>
        <div className="flex flex-wrap items-center justify-between gap-sm">
          <h3 className="font-headline text-headline-sm text-on-surface">Chamada nominal</h3>
          <button
            type="button"
            onClick={() => allPresent.mutate()}
            className="rounded-full border border-outline-variant px-lg py-sm font-label text-label-md text-on-surface"
          >
            Marcar todos presentes
          </button>
        </div>

        {attendance.isPending ? (
          <Skeleton className="h-40 w-full rounded-lg" />
        ) : (
          <ul className="flex flex-col divide-y divide-outline-variant/40">
            {attendance.data?.map((row) => (
              <li key={row.person.id} className="flex flex-col gap-sm py-md">
                <div className="flex flex-wrap items-center justify-between gap-sm">
                  <div className="min-w-0">
                    <p className="font-label text-label-lg text-on-surface">{row.person.name}</p>
                    <p className="font-body text-body-sm text-on-surface-variant">
                      {row.person.className ?? 'Sem turma'}
                    </p>
                  </div>
                  <div className="flex gap-xs">
                    <button
                      type="button"
                      onClick={() => mark.mutate({ userId: row.person.id, present: true })}
                      className={`rounded-full border px-lg py-sm font-label text-label-md ${
                        row.present === true
                          ? 'border-primary bg-primary text-on-primary'
                          : 'border-outline-variant text-on-surface'
                      }`}
                    >
                      Presente
                    </button>
                    <button
                      type="button"
                      onClick={() => mark.mutate({ userId: row.person.id, present: false })}
                      className={`rounded-full border px-lg py-sm font-label text-label-md ${
                        row.present === false
                          ? 'border-error bg-error/10 text-error'
                          : 'border-outline-variant text-on-surface'
                      }`}
                    >
                      Ausente
                    </button>
                  </div>
                </div>

                {row.present === false && (
                  <div className="grid gap-sm sm:grid-cols-[1fr_auto]">
                    <select
                      value={row.justification ?? ''}
                      onChange={(e) =>
                        mark.mutate({
                          userId: row.person.id,
                          present: false,
                          justification: e.target.value,
                          needsMakeup: row.needsMakeup,
                        })
                      }
                      className={inputCls}
                    >
                      <option value="">Sem justificativa</option>
                      {APPRENTICE_JUSTIFICATIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    <label className="flex items-center gap-sm font-body text-body-sm text-on-surface">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-primary"
                        checked={row.needsMakeup}
                        onChange={(e) =>
                          mark.mutate({
                            userId: row.person.id,
                            present: false,
                            justification: row.justification,
                            needsMakeup: e.target.checked,
                          })
                        }
                      />
                      Precisa de reposição
                    </label>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <p className="font-body text-body-sm text-on-surface-variant">
          Quem constar ausente fica sem acesso ao encontro seguinte. Depois da reposição, volte aqui e
          marque a presença — é isso que destrava.
        </p>
      </div>

      <div className={`${cardCls} flex flex-col gap-md`}>
        <h3 className="font-headline text-headline-sm text-on-surface">Agendar reposição</h3>
        <div className="grid gap-md sm:grid-cols-2">
          <label className="flex flex-col gap-xs">
            <span className={labelCls}>Data e hora</span>
            <input
              type="datetime-local"
              value={makeup.scheduledAt}
              onChange={(e) => setMakeup({ ...makeup, scheduledAt: e.target.value })}
              className={inputCls}
            />
          </label>
          <fieldset className="flex flex-col gap-xs">
            <legend className={labelCls}>Convocados</legend>
            {attendance.data?.map((row) => (
              <label key={row.person.id} className="flex items-center gap-sm font-body text-body-sm text-on-surface">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={makeup.userIds.includes(row.person.id)}
                  onChange={(e) =>
                    setMakeup((prev) => ({
                      ...prev,
                      userIds: e.target.checked
                        ? [...prev.userIds, row.person.id]
                        : prev.userIds.filter((id) => id !== row.person.id),
                    }))
                  }
                />
                {row.person.name}
              </label>
            ))}
          </fieldset>
        </div>
        <button
          type="button"
          disabled={!makeup.scheduledAt || makeup.userIds.length === 0 || scheduleMakeup.isPending}
          onClick={() => scheduleMakeup.mutate()}
          className="self-start rounded-full bg-primary px-lg py-sm font-label text-label-lg text-on-primary disabled:bg-surface-container-highest disabled:text-on-surface-variant"
        >
          Agendar reposição
        </button>

        {(makeups.data?.length ?? 0) > 0 && (
          <ul className="flex flex-col gap-xs">
            {makeups.data?.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-sm rounded-lg bg-surface p-md font-body text-body-sm text-on-surface"
              >
                <span>
                  Encontro {row.meetingOrder} ·{' '}
                  {new Date(row.scheduledAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })} ·{' '}
                  {row.attendees.map((person) => person.name).join(', ')}
                </span>
                <button
                  type="button"
                  onClick={() => removeMakeup.mutate(row.id)}
                  aria-label="Remover reposição"
                  className="text-on-surface-variant hover:text-error"
                >
                  <Icon name="delete" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ---- Andamento ----

function ProgressTab({ meetings }: { meetings: ApprenticeMeetingDTO[] }) {
  const [meetingId, setMeetingId] = useState(meetings[0]?.id ?? '')
  const { data, isPending } = useQuery({
    queryKey: ['apprentice', 'progress', meetingId],
    queryFn: () => fetchApprenticeProgress(meetingId),
    enabled: Boolean(meetingId),
  })

  return (
    <div className="flex flex-col gap-lg">
      <label className="flex flex-col gap-xs">
        <span className={labelCls}>Encontro</span>
        <select value={meetingId} onChange={(e) => setMeetingId(e.target.value)} className={`${inputCls} sm:max-w-md`}>
          {meetings.map((meeting) => (
            <option key={meeting.id} value={meeting.id}>
              Encontro {meeting.order} · {meeting.title}
            </option>
          ))}
        </select>
      </label>

      {isPending ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : (
        <ul className={`${cardCls} flex flex-col divide-y divide-outline-variant/40`}>
          {data?.map((row) => (
            <li key={row.person.id} className="flex flex-wrap items-center justify-between gap-sm py-md">
              <div className="min-w-0">
                <p className="font-label text-label-lg text-on-surface">{row.person.name}</p>
                <p className="font-body text-body-sm text-on-surface-variant">
                  {row.person.className ?? 'Sem turma'} ·{' '}
                  {row.present === true ? 'Presente' : row.present === false ? 'Ausente' : 'Presença não lançada'} ·{' '}
                  {row.activityCount === 0
                    ? 'Sem fichas cadastradas'
                    : `${row.submittedCount}/${row.activityCount} fichas`}
                </p>
              </div>
              {row.reviewStatus && (
                <span className="shrink-0 rounded-full bg-surface-container-highest px-md py-xs font-label text-label-sm text-on-surface">
                  {APPRENTICE_REVIEW_STATUS_EMOJI[row.reviewStatus]} {row.reviewStatus}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---- Turmas ----

function ClassesTab() {
  const queryClient = useQueryClient()
  const classes = useQuery({ queryKey: ['apprentice', 'classes'], queryFn: fetchApprenticeClasses })
  const people = useQuery({ queryKey: ['apprentice', 'people'], queryFn: fetchApprenticePeople })
  const [form, setForm] = useState({ name: '', shift: '' })

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['apprentice'] })

  const create = useMutation({
    mutationFn: () => createApprenticeClass({ name: form.name, shift: form.shift || null }),
    onSuccess: () => {
      setForm({ name: '', shift: '' })
      invalidate()
    },
  })

  const remove = useMutation({ mutationFn: deleteApprenticeClass, onSuccess: invalidate })

  const enroll = useMutation({
    mutationFn: (input: { userId: string; classId: string | null }) =>
      setApprenticeEnrollment(input.userId, input.classId),
    onSuccess: invalidate,
  })

  return (
    <div className="flex flex-col gap-lg">
      <div className={`${cardCls} flex flex-col gap-md`}>
        <h3 className="font-headline text-headline-sm text-on-surface">Turmas</h3>
        <div className="grid gap-md sm:grid-cols-[1fr_1fr_auto]">
          <input
            placeholder="Nome da turma"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className={inputCls}
          />
          <input
            placeholder="Turno (Manhã, Tarde…)"
            value={form.shift}
            onChange={(e) => setForm({ ...form, shift: e.target.value })}
            className={inputCls}
          />
          <button
            type="button"
            disabled={!form.name.trim() || create.isPending}
            onClick={() => create.mutate()}
            className="rounded-full bg-primary px-lg py-sm font-label text-label-lg text-on-primary disabled:bg-surface-container-highest disabled:text-on-surface-variant"
          >
            Criar turma
          </button>
        </div>
        <ul className="flex flex-col divide-y divide-outline-variant/40">
          {classes.data?.map((turma) => (
            <li key={turma.id} className="flex items-center justify-between gap-sm py-sm">
              <span className="font-body text-body-md text-on-surface">
                {turma.name}
                {turma.shift ? ` · ${turma.shift}` : ''} — {turma.memberCount} aprendizes
              </span>
              <button
                type="button"
                onClick={() => remove.mutate(turma.id)}
                aria-label={`Remover ${turma.name}`}
                className="text-on-surface-variant hover:text-error"
              >
                <Icon name="delete" />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className={`${cardCls} flex flex-col gap-md`}>
        <h3 className="font-headline text-headline-sm text-on-surface">Matrículas</h3>
        <p className="font-body text-body-sm text-on-surface-variant">
          A lista sai de quem tem o cargo <strong>Jovem Aprendiz</strong> em Administração › Organização.
          Quem não aparece aqui é porque o cargo não está marcado lá.
        </p>
        <ul className="flex flex-col divide-y divide-outline-variant/40">
          {people.data?.map((person) => (
            <li key={person.id} className="flex flex-wrap items-center justify-between gap-sm py-md">
              <span className="font-label text-label-lg text-on-surface">{person.name}</span>
              <select
                value={person.classId ?? ''}
                onChange={(e) => enroll.mutate({ userId: person.id, classId: e.target.value || null })}
                className={`${inputCls} sm:max-w-xs`}
              >
                <option value="">Sem turma</option>
                {classes.data?.map((turma) => (
                  <option key={turma.id} value={turma.id}>
                    {turma.name}
                    {turma.shift ? ` · ${turma.shift}` : ''}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function AdminPanelPage() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('aba')
  const tab: TabKey = isTabKey(raw) ? raw : 'dashboard'

  const meetings = useQuery({
    queryKey: ['apprentice', 'admin-meetings'],
    queryFn: fetchAdminApprenticeMeetings,
  })

  if (meetings.isPending) return <Skeleton className="h-96 w-full rounded-xl" />

  return (
    <div className="flex flex-col gap-lg">
      <div role="tablist" className="flex flex-wrap gap-xs">
        {TABS.map((item) => (
          <button
            key={item.key}
            role="tab"
            aria-selected={tab === item.key}
            onClick={() => setParams({ aba: item.key })}
            className={`rounded-full border px-lg py-sm font-label text-label-md ${
              tab === item.key
                ? 'border-primary bg-primary text-on-primary'
                : 'border-outline-variant bg-surface-container text-on-surface'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && <DashboardTab meetings={meetings.data ?? []} />}
      {tab === 'encontros' && <MeetingsTab meetings={meetings.data ?? []} />}
      {tab === 'presenca' && <AttendanceTab meetings={meetings.data ?? []} />}
      {tab === 'andamento' && <ProgressTab meetings={meetings.data ?? []} />}
      {tab === 'jornada' && <JourneyTab />}
      {tab === 'quadro' && <TasksTab meetings={meetings.data ?? []} />}
      {tab === 'assistente' && <AssistantTab />}
      {tab === 'turmas' && <ClassesTab />}
    </div>
  )
}

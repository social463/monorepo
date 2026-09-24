import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  APPRENTICE_TASK_CATEGORIES,
  APPRENTICE_TASK_COLUMN_LABELS,
  APPRENTICE_TASK_COLUMNS,
  type ApprenticeMeetingDTO,
  type ApprenticeTaskCategory,
  type ApprenticeTaskColumn,
} from '@legends/shared'
import { Icon } from '../../components/Icon'
import { Skeleton } from '../../components/Skeleton'
import {
  createApprenticeTask,
  deleteApprenticeTask,
  fetchApprenticeTasks,
  toggleApprenticeTaskItem,
  updateApprenticeTask,
} from '../../lib/apprentice-api'

const inputCls =
  'w-full rounded-lg border border-outline-variant bg-surface px-md py-sm font-body text-body-md text-on-surface'
const labelCls = 'font-label text-label-sm uppercase text-on-surface-variant'

const EMPTY = {
  title: '',
  category: 'Logística' as ApprenticeTaskCategory,
  meetingId: '',
  dueOn: '',
  items: '',
}

/**
 * Quadro interno do RH: o que o facilitador precisa fazer para o encontro
 * acontecer. Nunca aparece para o aprendiz — não confunda com as fichas.
 */
export function TasksTab({ meetings }: { meetings: ApprenticeMeetingDTO[] }) {
  const queryClient = useQueryClient()
  const { data, isPending } = useQuery({
    queryKey: ['apprentice', 'tasks'],
    queryFn: fetchApprenticeTasks,
  })
  const [form, setForm] = useState(EMPTY)
  const [creating, setCreating] = useState(false)
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<ApprenticeTaskColumn | null>(null)

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['apprentice', 'tasks'] })

  const create = useMutation({
    mutationFn: () =>
      createApprenticeTask({
        title: form.title,
        category: form.category,
        meetingId: form.meetingId || null,
        dueOn: form.dueOn || null,
        items: form.items.split('\n').map((line) => line.trim()).filter(Boolean),
      }),
    onSuccess: () => {
      setForm(EMPTY)
      setCreating(false)
      invalidate()
    },
  })

  const move = useMutation({
    mutationFn: (input: { id: string; boardColumn: ApprenticeTaskColumn }) =>
      updateApprenticeTask(input.id, { boardColumn: input.boardColumn }),
    onSuccess: invalidate,
  })

  const remove = useMutation({ mutationFn: deleteApprenticeTask, onSuccess: invalidate })

  const toggle = useMutation({
    mutationFn: (input: { id: string; done: boolean }) =>
      toggleApprenticeTaskItem(input.id, input.done),
    onSuccess: invalidate,
  })

  if (isPending) return <Skeleton className="h-96 w-full rounded-xl" />

  return (
    <div className="flex flex-col gap-lg">
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <p className="font-body text-body-sm text-on-surface-variant">
          Quadro interno do programa. O aprendiz não vê nada disto.
        </p>
        <button
          type="button"
          onClick={() => setCreating((value) => !value)}
          className="rounded-full bg-primary px-lg py-sm font-label text-label-lg text-on-primary"
        >
          {creating ? 'Fechar' : 'Nova tarefa'}
        </button>
      </div>

      {creating && (
        <div className="flex flex-col gap-md rounded-xl border border-outline-variant/40 bg-surface-container p-lg">
          <label className="flex flex-col gap-xs">
            <span className={labelCls}>Título</span>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Ex.: Reservar a sala do Encontro 2"
              className={inputCls}
            />
          </label>
          <div className="grid gap-md sm:grid-cols-3">
            <label className="flex flex-col gap-xs">
              <span className={labelCls}>Categoria</span>
              <select
                value={form.category}
                onChange={(e) =>
                  setForm({ ...form, category: e.target.value as ApprenticeTaskCategory })
                }
                className={inputCls}
              >
                {APPRENTICE_TASK_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-xs">
              <span className={labelCls}>Encontro</span>
              <select
                value={form.meetingId}
                onChange={(e) => setForm({ ...form, meetingId: e.target.value })}
                className={inputCls}
              >
                <option value="">Geral</option>
                {meetings.map((meeting) => (
                  <option key={meeting.id} value={meeting.id}>
                    Encontro {meeting.order} · {meeting.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-xs">
              <span className={labelCls}>Prazo</span>
              <input
                type="date"
                value={form.dueOn}
                onChange={(e) => setForm({ ...form, dueOn: e.target.value })}
                className={inputCls}
              />
            </label>
          </div>
          <label className="flex flex-col gap-xs">
            <span className={labelCls}>Checklist (uma por linha)</span>
            <textarea
              rows={4}
              value={form.items}
              onChange={(e) => setForm({ ...form, items: e.target.value })}
              placeholder={'Confirmar sala\nImprimir materiais\nEnviar convite'}
              className={inputCls}
            />
          </label>
          <button
            type="button"
            disabled={!form.title.trim() || create.isPending}
            onClick={() => create.mutate()}
            className="self-start rounded-full bg-primary px-lg py-sm font-label text-label-lg text-on-primary disabled:bg-surface-container-highest disabled:text-on-surface-variant"
          >
            Criar tarefa
          </button>
        </div>
      )}

      <div className="grid gap-lg lg:grid-cols-4">
        {APPRENTICE_TASK_COLUMNS.map((column) => {
          const items = (data ?? []).filter((task) => task.boardColumn === column)
          return (
            <div
              key={column}
              onDragOver={(event) => {
                event.preventDefault()
                setOver(column)
              }}
              onDragLeave={() => setOver((current) => (current === column ? null : current))}
              onDrop={(event) => {
                event.preventDefault()
                if (dragging) move.mutate({ id: dragging, boardColumn: column })
                setDragging(null)
                setOver(null)
              }}
              className={`flex flex-col gap-md rounded-xl border p-md transition-colors ${
                over === column
                  ? 'border-primary bg-primary/5'
                  : 'border-outline-variant/40 bg-surface-container'
              }`}
            >
              <p className="font-label text-label-md text-on-surface">
                {APPRENTICE_TASK_COLUMN_LABELS[column]} · {items.length}
              </p>

              {items.length === 0 && (
                <p className="font-body text-body-sm text-on-surface-variant">
                  Arraste uma tarefa para cá.
                </p>
              )}

              {items.map((task) => {
                const done = task.items.filter((item) => item.done).length
                return (
                  <article
                    key={task.id}
                    draggable
                    onDragStart={() => setDragging(task.id)}
                    onDragEnd={() => setDragging(null)}
                    className="flex cursor-grab flex-col gap-sm rounded-lg border border-outline-variant/40 bg-surface p-md active:cursor-grabbing"
                  >
                    <div className="flex items-start justify-between gap-sm">
                      <p className="min-w-0 font-label text-label-md text-on-surface">{task.title}</p>
                      <button
                        type="button"
                        onClick={() => remove.mutate(task.id)}
                        aria-label={`Remover ${task.title}`}
                        className="shrink-0 text-on-surface-variant hover:text-error"
                      >
                        <Icon name="delete" />
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-xs">
                      <span className="rounded-full bg-surface-container-highest px-sm py-xs font-label text-label-sm text-on-surface-variant">
                        {task.category}
                      </span>
                      <span className="rounded-full bg-surface-container-highest px-sm py-xs font-label text-label-sm text-on-surface-variant">
                        {task.meetingOrder ? `Encontro ${task.meetingOrder}` : 'Geral'}
                      </span>
                      {task.overdue && (
                        <span className="rounded-full bg-error/10 px-sm py-xs font-label text-label-sm text-error">
                          Atrasada
                        </span>
                      )}
                    </div>

                    {task.items.length > 0 && (
                      <div className="flex flex-col gap-xs">
                        <p className="font-body text-body-sm text-on-surface-variant">
                          Checklist {done}/{task.items.length}
                        </p>
                        {task.items.map((item) => (
                          <label
                            key={item.id}
                            className="flex items-start gap-sm font-body text-body-sm text-on-surface"
                          >
                            <input
                              type="checkbox"
                              checked={item.done}
                              onChange={(event) =>
                                toggle.mutate({ id: item.id, done: event.target.checked })
                              }
                              className="mt-xs h-3.5 w-3.5 shrink-0 accent-primary"
                            />
                            <span className={item.done ? 'line-through opacity-60' : ''}>
                              {item.text}
                            </span>
                          </label>
                        ))}
                      </div>
                    )}

                    {/* O select existe porque arrastar não funciona no toque. */}
                    <select
                      value={task.boardColumn}
                      onChange={(event) =>
                        move.mutate({
                          id: task.id,
                          boardColumn: event.target.value as ApprenticeTaskColumn,
                        })
                      }
                      aria-label={`Mover ${task.title}`}
                      className="rounded-lg border border-outline-variant bg-surface px-sm py-xs font-body text-body-sm text-on-surface"
                    >
                      {APPRENTICE_TASK_COLUMNS.map((option) => (
                        <option key={option} value={option}>
                          {APPRENTICE_TASK_COLUMN_LABELS[option]}
                        </option>
                      ))}
                    </select>
                  </article>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

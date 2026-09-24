import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { INOVA_TASK_STATUSES, type InovaProjectTaskDTO, type InovaTaskStatus } from '@legends/shared'
import { Icon } from '../Icon'
import { InovaDialog } from './InovaDialog'
import { InovaRichTextField, inovaPlainText } from './InovaRichText'
import { ApiError } from '../../lib/api'
import {
  createInovaProjectTask,
  deleteInovaProjectTask,
  updateInovaProjectTask,
  updateInovaProjectTaskStatus,
} from '../../lib/inova-api'

const COLUMNS: { status: InovaTaskStatus; label: string; icon: string }[] = [
  { status: 'PENDING', label: 'A fazer', icon: 'edit_note' },
  { status: 'IN_PROGRESS', label: 'Em andamento', icon: 'settings' },
  { status: 'DONE', label: 'Concluído', icon: 'task_alt' },
]

const inputCls = 'w-full rounded-md border border-outline-variant/60 bg-surface px-md py-sm text-body-md text-on-surface'

/** "2026-10-01" → "01/10/2026", sem passar por Date (fuso de Brasil voltaria um dia). */
function formatDueDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

interface TaskForm {
  title: string
  description: string
  responsible: string
  dueDate: string
  status: InovaTaskStatus
}

const EMPTY_FORM: TaskForm = { title: '', description: '', responsible: '', dueDate: '', status: 'PENDING' }

/**
 * Gestão de tarefas do projeto em kanban — A fazer, Em andamento, Concluído —,
 * no formato do INOVA original: "+" em cada coluna, arrastar o card entre
 * colunas, clicar para editar. Quem não arrasta (teclado, celular) muda a
 * coluna pelo campo "Status" do mesmo diálogo de edição.
 *
 * Criar, editar e mover é de qualquer colaborador (o kanban é colaborativo,
 * como na API); apagar é do dono do projeto ou de quem administra.
 */
export function InovaTaskKanban({
  projectId,
  tasks,
  canDelete,
  onChanged,
}: {
  projectId: string
  tasks: InovaProjectTaskDTO[]
  canDelete: boolean
  onChanged: () => void
}) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<InovaProjectTaskDTO | null>(null)
  const [form, setForm] = useState<TaskForm>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<InovaTaskStatus | null>(null)

  const move = useMutation({
    mutationFn: (input: { taskId: string; status: InovaTaskStatus }) => updateInovaProjectTaskStatus(input.taskId, input.status),
    onSuccess: () => {
      setError(null)
      onChanged()
    },
    onError: () => setError('Não foi possível mover a tarefa.'),
  })

  const remove = useMutation({
    mutationFn: (taskId: string) => deleteInovaProjectTask(taskId),
    onSuccess: () => {
      setError(null)
      onChanged()
    },
    onError: () => setError('Não foi possível excluir a tarefa. Tente de novo em alguns instantes.'),
  })

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        responsible: form.responsible.trim() || null,
        dueDate: form.dueDate || null,
      }
      if (!editing) {
        return createInovaProjectTask(projectId, {
          title: body.title,
          description: body.description ?? undefined,
          responsible: body.responsible ?? undefined,
          dueDate: body.dueDate ?? undefined,
          status: form.status,
        })
      }
      const result = await updateInovaProjectTask(editing.id, body)
      if (form.status !== editing.status) await updateInovaProjectTaskStatus(editing.id, form.status)
      return result
    },
    onSuccess: () => {
      setDialogOpen(false)
      onChanged()
    },
    onError: (err) => setFormError(err instanceof ApiError ? err.message : 'Não foi possível salvar a tarefa.'),
  })

  function openNew(status: InovaTaskStatus) {
    setEditing(null)
    setForm({ ...EMPTY_FORM, status })
    setFormError(null)
    setDialogOpen(true)
  }

  function openEdit(task: InovaProjectTaskDTO) {
    setEditing(task)
    setForm({
      title: task.title,
      description: task.description ?? '',
      responsible: task.responsible ?? '',
      dueDate: task.dueDate ?? '',
      status: task.status,
    })
    setFormError(null)
    setDialogOpen(true)
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!form.title.trim()) {
      setFormError('Informe o título da tarefa.')
      return
    }
    save.mutate()
  }

  function handleDrop(status: InovaTaskStatus) {
    const task = tasks.find((t) => t.id === draggedId)
    setDraggedId(null)
    setDropTarget(null)
    if (!task || task.status === status) return
    move.mutate({ taskId: task.id, status })
  }

  return (
    <div className="flex flex-col gap-sm">
      {error && (
        <p role="alert" className="text-body-sm text-error">
          {error}
        </p>
      )}
      <div className="grid grid-cols-1 gap-md md:grid-cols-3">
        {COLUMNS.map((column) => {
          const columnTasks = tasks.filter((t) => t.status === column.status)
          return (
            <section
              key={column.status}
              aria-label={column.label}
              onDragOver={(event) => {
                event.preventDefault()
                setDropTarget(column.status)
              }}
              onDragLeave={() => setDropTarget((current) => (current === column.status ? null : current))}
              onDrop={(event) => {
                event.preventDefault()
                handleDrop(column.status)
              }}
              className={`flex min-h-[12rem] flex-col gap-sm rounded-xl border p-sm transition-colors ${
                dropTarget === column.status ? 'border-primary/60 bg-primary/5' : 'border-outline-variant/40 bg-surface-container-low'
              }`}
            >
              <header className="flex items-center justify-between gap-sm">
                <div className="flex items-center gap-xs">
                  <Icon name={column.icon} className="text-[18px] text-on-surface-variant" />
                  <h3 className="font-label text-label-md font-bold text-on-surface">{column.label}</h3>
                  <span className="rounded-full bg-primary/10 px-xs font-mono text-[11px] text-primary">{columnTasks.length}</span>
                </div>
                <button
                  type="button"
                  onClick={() => openNew(column.status)}
                  aria-label={`Nova tarefa em ${column.label}`}
                  title="Nova tarefa"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-on-surface-variant hover:bg-primary/10 hover:text-primary"
                >
                  <Icon name="add" className="text-[18px]" />
                </button>
              </header>

              <ul className="flex flex-col gap-xs">
                {columnTasks.map((task) => (
                  <li
                    key={task.id}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move'
                      setDraggedId(task.id)
                    }}
                    onDragEnd={() => {
                      setDraggedId(null)
                      setDropTarget(null)
                    }}
                    className={`group flex cursor-grab items-start gap-xs rounded-lg border border-outline-variant/40 bg-surface p-sm hover:border-primary/40 active:cursor-grabbing ${
                      draggedId === task.id ? 'opacity-50' : ''
                    }`}
                  >
                    <Icon name="drag_indicator" className="mt-0.5 shrink-0 text-[16px] text-outline" />
                    <button
                      type="button"
                      onClick={() => openEdit(task)}
                      aria-label={`Editar tarefa ${task.title}`}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block break-words text-body-md font-medium text-on-surface">{task.title}</span>
                      {task.description && (
                        <span className="mt-0.5 line-clamp-2 block text-body-sm text-on-surface-variant">{inovaPlainText(task.description)}</span>
                      )}
                      {(task.responsible || task.dueDate) && (
                        <span className="mt-xs flex flex-wrap items-center gap-xs">
                          {task.responsible && (
                            <span className="rounded bg-primary/10 px-xs text-[11px] text-primary">{task.responsible}</span>
                          )}
                          {task.dueDate && (
                            <span className="inline-flex items-center gap-0.5 text-[11px] text-on-surface-variant">
                              <Icon name="event" className="text-[12px]" />
                              {formatDueDate(task.dueDate)}
                            </span>
                          )}
                        </span>
                      )}
                    </button>
                    {canDelete && (
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm(`Excluir a tarefa "${task.title}"?`)) remove.mutate(task.id)
                        }}
                        disabled={remove.isPending}
                        aria-label={`Excluir tarefa ${task.title}`}
                        title="Excluir tarefa"
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-error/10 hover:text-error disabled:opacity-60"
                      >
                        <Icon name="delete" className="text-[16px]" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {columnTasks.length === 0 && (
                <p className="py-md text-center text-body-sm text-on-surface-variant">Arraste tarefas para cá</p>
              )}
            </section>
          )
        })}
      </div>

      <InovaDialog open={dialogOpen} title={editing ? 'Editar tarefa' : 'Nova tarefa'} onClose={() => setDialogOpen(false)}>
        <form onSubmit={handleSubmit} className="flex flex-col gap-md">
          <label className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Título *</span>
            <input
              aria-label="Título da tarefa"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Ex.: Pesquisar ferramentas de IA…"
              className={inputCls}
              autoFocus
            />
          </label>
          <div className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Descrição</span>
            <InovaRichTextField
              ariaLabel="Descrição da tarefa"
              value={form.description}
              onChange={(description) => setForm((f) => ({ ...f, description }))}
              placeholder="Descrição curta da tarefa…"
            />
          </div>
          <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="font-label text-label-sm text-on-surface-variant">Responsável</span>
              <input
                aria-label="Responsável pela tarefa"
                value={form.responsible}
                onChange={(e) => setForm((f) => ({ ...f, responsible: e.target.value }))}
                placeholder="Nome"
                className={inputCls}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-label text-label-sm text-on-surface-variant">Prazo</span>
              <input
                aria-label="Prazo da tarefa"
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                className={inputCls}
              />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="font-label text-label-sm text-on-surface-variant">Status</span>
            <select
              aria-label="Status da tarefa"
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as InovaTaskStatus }))}
              className={inputCls}
            >
              {INOVA_TASK_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          {formError && (
            <p role="alert" className="text-body-sm text-error">
              {formError}
            </p>
          )}
          <button
            type="submit"
            disabled={save.isPending}
            className="rounded-full bg-primary px-lg py-sm font-label text-label-md font-bold text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
          >
            {save.isPending ? 'Salvando…' : editing ? 'Salvar alterações' : 'Criar tarefa'}
          </button>
        </form>
      </InovaDialog>
    </div>
  )
}

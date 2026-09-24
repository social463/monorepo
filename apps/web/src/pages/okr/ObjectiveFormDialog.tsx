import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  OKR_SCOPES,
  OKR_SCOPE_LABELS,
  OKR_VISIBILITIES,
  type CreateOkrObjectiveRequest,
  type OkrAssignmentInput,
  type OkrCycleDTO,
  type OkrObjectiveDTO,
  type OkrScope,
  type OkrVisibility,
  type PublicUser,
} from '@legends/shared'
import { Icon } from '../../components/Icon'
import { Select } from '../../components/Select'
import { createOkrObjective, updateOkrObjective } from '../../lib/okr-api'
import { TargetPicker } from '../mural-feedbacks/TargetPicker'
import { errorMessage, inputCls } from '../admin/shared'

const VISIBILITY_LABELS: Record<OkrVisibility, string> = {
  EVERYONE: 'Todo mundo na empresa',
  ASSIGNEES: 'Só quem tem papel na meta',
  PRIVATE: 'Só dono e criador',
}

export function OkrField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-xs">
      <span className="font-label text-label-md text-on-surface">{label}</span>
      {children}
      {hint && <span className="font-body text-body-sm text-on-surface-variant">{hint}</span>}
    </label>
  )
}

/** Casca de diálogo das telas de metas: fecha no Escape e no clique fora. */
export function OkrDialogShell({
  title,
  onClose,
  onSubmit,
  formLabel,
  saving,
  submitLabel,
  message,
  children,
}: {
  title: string
  onClose: () => void
  onSubmit: (event: FormEvent) => void
  formLabel: string
  saving: boolean
  submitLabel: string
  message: string | null
  children: ReactNode
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 md:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <form
        onSubmit={onSubmit}
        aria-label={formLabel}
        className="flex w-full max-w-2xl flex-col rounded-xl border border-outline-variant/40 bg-surface-container shadow-xl"
      >
        <header className="flex items-center justify-between gap-md border-b border-outline-variant/40 px-lg py-md">
          <h2 className="font-headline text-headline-sm text-on-surface">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-8 w-8 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface"
          >
            <Icon name="close" />
          </button>
        </header>

        <div className="flex flex-col gap-md px-lg py-md">
          {children}
          {message && (
            <p role="alert" className="rounded-lg bg-error/10 px-md py-sm font-body text-body-sm text-error">
              {message}
            </p>
          )}
        </div>

        <footer className="flex justify-end gap-sm border-t border-outline-variant/40 px-lg py-md">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-outline-variant px-lg py-sm font-label text-label-lg text-primary hover:bg-primary/10"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-primary px-lg py-sm font-label text-label-lg text-on-primary hover:bg-primary/90 disabled:bg-surface-container-highest disabled:text-on-surface-variant"
          >
            {saving ? 'Salvando…' : submitLabel}
          </button>
        </footer>
      </form>
    </div>
  )
}

/**
 * Criar e editar meta (objetivo). O mesmo diálogo serve para a meta nova, para a
 * submeta (com `parent` preenchido) e para a edição.
 *
 * Dono e responsável são dois campos, e não uma lista: é o que a API entende
 * (`OWNER` decide a meta, `ASSIGNED_TO` registra check-in), e o que a tela
 * precisa mostrar para a pessoa saber o que está escolhendo. `assignments`
 * substitui o conjunto inteiro, então a edição manda os dois sempre.
 */
export function ObjectiveFormDialog({
  cycle,
  objective,
  parent,
  onClose,
  onSaved,
}: {
  cycle: OkrCycleDTO
  /** `null` = meta nova. */
  objective: OkrObjectiveDTO | null
  parent?: OkrObjectiveDTO | null
  onClose: () => void
  onSaved: (objective: OkrObjectiveDTO) => void
}) {
  const queryClient = useQueryClient()
  const first = (role: 'OWNER' | 'ASSIGNED_TO') => {
    const found = objective?.assignments.find((assignment) => assignment.role === role)?.person
    return found ? ({ id: found.id, name: found.name, email: found.email, photoUrl: found.photoUrl } as PublicUser) : null
  }

  const [name, setName] = useState(objective?.name ?? '')
  const [code, setCode] = useState(objective?.code ?? '')
  const [description, setDescription] = useState(objective?.description ?? '')
  const [scope, setScope] = useState<OkrScope>(objective?.scope ?? parent?.scope ?? 'TEAM')
  const [visibility, setVisibility] = useState<OkrVisibility>(objective?.visibility ?? 'EVERYONE')
  const [finishDate, setFinishDate] = useState(objective?.finishDate ?? cycle.finishDate)
  const [weight, setWeight] = useState(objective?.weight == null ? '' : String(Math.round(objective.weight * 100)))
  const [owner, setOwner] = useState<PublicUser | null>(first('OWNER'))
  const [assignee, setAssignee] = useState<PublicUser | null>(first('ASSIGNED_TO'))
  const [erro, setErro] = useState<string | null>(null)

  const salvar = useMutation({
    mutationFn: (body: CreateOkrObjectiveRequest) =>
      objective ? updateOkrObjective(objective.id, body) : createOkrObjective(body),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['okr'] })
      onSaved(data.objective)
    },
  })

  function enviar(event: FormEvent) {
    event.preventDefault()
    setErro(null)
    if (!name.trim()) return setErro('Informe o nome da meta.')
    const peso = weight.trim() ? Number(weight.replace(',', '.')) : null
    if (peso != null && (!Number.isFinite(peso) || peso < 0 || peso > 100)) {
      return setErro('O peso vai de 0 a 100.')
    }
    const assignments: OkrAssignmentInput[] = []
    if (owner) assignments.push({ personId: owner.id, role: 'OWNER' })
    if (assignee) assignments.push({ personId: assignee.id, role: 'ASSIGNED_TO' })

    salvar.mutate({
      cycleId: cycle.id,
      parentId: objective ? objective.parentId : (parent?.id ?? null),
      name: name.trim(),
      code: code.trim() || null,
      description: description.trim() || null,
      scope,
      visibility,
      finishDate: finishDate || null,
      weight: peso == null ? null : peso / 100,
      assignments,
    })
  }

  const mensagem = erro ?? (salvar.isError ? errorMessage(salvar.error, 'Não foi possível salvar a meta.') : null)

  return (
    <OkrDialogShell
      title={objective ? 'Editar meta' : parent ? 'Nova submeta' : 'Nova meta'}
      formLabel={objective ? `Editar ${objective.name}` : 'Nova meta'}
      onClose={onClose}
      onSubmit={enviar}
      saving={salvar.isPending}
      submitLabel={objective ? 'Salvar meta' : 'Criar meta'}
      message={mensagem}
    >
      {parent && !objective && (
        <p className="font-body text-body-sm text-on-surface-variant">Desdobra: {parent.name}</p>
      )}

      <OkrField label="Nome da meta">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} />
      </OkrField>

      <div className="grid gap-md sm:grid-cols-2">
        <OkrField label="Escopo">
          <Select
            ariaLabel="Escopo"
            value={scope}
            onChange={(next) => setScope(next as OkrScope)}
            options={OKR_SCOPES.map((option) => ({ value: option, label: OKR_SCOPE_LABELS[option] }))}
          />
        </OkrField>
        <OkrField label="Quem enxerga">
          <Select
            ariaLabel="Quem enxerga"
            value={visibility}
            onChange={(next) => setVisibility(next as OkrVisibility)}
            options={OKR_VISIBILITIES.map((option) => ({ value: option, label: VISIBILITY_LABELS[option] }))}
          />
        </OkrField>
      </div>

      <div className="grid gap-md sm:grid-cols-2">
        <OkrField label="Prazo">
          <input className={inputCls} type="date" value={finishDate ?? ''} onChange={(e) => setFinishDate(e.target.value)} />
        </OkrField>
        <OkrField label="Peso no pai (%)" hint="Em branco divide igualmente o que sobra entre as metas irmãs.">
          <input className={inputCls} inputMode="decimal" value={weight} onChange={(e) => setWeight(e.target.value)} />
        </OkrField>
      </div>

      <div className="grid gap-md sm:grid-cols-2">
        <OkrField label="Dono" hint="Quem decide a meta: edita, desdobra e cria key result.">
          <TargetPicker
            value={owner}
            onChange={setOwner}
            scope="all"
            ariaLabel="Dono da meta"
            placeholder="Procurar pessoa…"
            excludeIds={assignee ? [assignee.id] : undefined}
          />
        </OkrField>
        <OkrField label="Responsável" hint="Quem registra o progresso no check-in.">
          <TargetPicker
            value={assignee}
            onChange={setAssignee}
            scope="all"
            ariaLabel="Responsável pela meta"
            placeholder="Procurar pessoa…"
            excludeIds={owner ? [owner.id] : undefined}
          />
        </OkrField>
      </div>

      <OkrField label="Código (opcional)" hint="O identificador que a empresa já usa, como PRD0038.">
        <input className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} maxLength={40} />
      </OkrField>

      <OkrField label="Descrição (opcional)">
        <textarea
          className={`${inputCls} min-h-[80px]`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={2000}
        />
      </OkrField>
    </OkrDialogShell>
  )
}

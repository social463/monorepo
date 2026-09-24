import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  canSubmitApprenticeActivity,
  type ApprenticeActivityDTO,
  type ApprenticeField,
  type ApprenticeListItem,
  type ApprenticeSubmissionDTO,
  type ApprenticeValues,
} from '@legends/shared'
import { Icon } from '../../components/Icon'
import { saveApprenticeSubmission } from '../../lib/apprentice-api'

const inputCls =
  'w-full rounded-lg border border-outline-variant bg-surface px-md py-sm font-body text-body-md text-on-surface outline-none focus:border-primary disabled:text-on-surface-variant'

function labelOf(field: ApprenticeField): string | null {
  return field.label ?? null
}

/** Quantos itens a lista mostra: o que já foi preenchido, ou o mínimo do schema. */
function listItemsOf(field: ApprenticeField, value: unknown): ApprenticeListItem[] {
  const saved = Array.isArray(value) ? (value as ApprenticeListItem[]) : []
  const wanted = field.items ?? 3
  if (saved.length >= wanted) return saved
  return [...saved, ...Array.from({ length: wanted - saved.length }, () => ({}))]
}

export function ActivityForm({
  activity,
  submission,
  meetingId,
  readOnly = false,
  /** Texto do compromisso do encontro anterior — só a ficha de revisão usa. */
  previousCommitment = null,
  defaultOpen = false,
}: {
  activity: ApprenticeActivityDTO
  submission: ApprenticeSubmissionDTO | undefined
  meetingId: string
  readOnly?: boolean
  previousCommitment?: string | null
  defaultOpen?: boolean
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(defaultOpen || Boolean(submission?.submittedAt) === false)
  const [values, setValues] = useState<ApprenticeValues>(submission?.values ?? {})
  const [notice, setNotice] = useState<string | null>(null)

  // Ficha trocada (outra atividade, ou envio concluído) recarrega o que está salvo.
  useEffect(() => {
    setValues(submission?.values ?? {})
    setNotice(null)
  }, [activity.id, submission?.submittedAt, submission?.values])

  const save = useMutation({
    mutationFn: (submit: boolean) => saveApprenticeSubmission(activity.id, values, submit),
    onSuccess: (_data, submit) => {
      setNotice(submit ? 'Ficha enviada.' : 'Rascunho salvo.')
      void queryClient.invalidateQueries({ queryKey: ['apprentice'] })
    },
    onError: (err: Error) => setNotice(err.message),
  })

  const set = (id: string, value: ApprenticeValues[string]) =>
    setValues((prev) => ({ ...prev, [id]: value }))

  const setListItem = (fieldId: string, index: number, subId: string, value: string) =>
    setValues((prev) => {
      const current = Array.isArray(prev[fieldId]) ? [...(prev[fieldId] as ApprenticeListItem[])] : []
      while (current.length <= index) current.push({})
      current[index] = { ...current[index], [subId]: value }
      return { ...prev, [fieldId]: current }
    })

  const complete = canSubmitApprenticeActivity(activity.schema, values)
  const submitted = Boolean(submission?.submittedAt)

  function renderField(field: ApprenticeField) {
    const value = values[field.id]
    const label = labelOf(field)

    if (field.type === 'checkbox') {
      return (
        <label key={field.id} className="flex items-start gap-sm font-body text-body-md text-on-surface">
          <input
            type="checkbox"
            disabled={readOnly}
            checked={value === true}
            onChange={(event) => set(field.id, event.target.checked)}
            className="mt-xs h-4 w-4 shrink-0 accent-primary"
          />
          <span>
            {label ?? 'Confirmo'}
            {field.required ? ' *' : ''}
          </span>
        </label>
      )
    }

    if (field.type === 'select') {
      return (
        <label key={field.id} className="block">
          {label && (
            <span className="font-label text-label-sm uppercase text-on-surface-variant">
              {label}
              {field.required ? ' *' : ''}
            </span>
          )}
          <select
            disabled={readOnly}
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => set(field.id, event.target.value)}
            className={`${inputCls} mt-xs`}
          >
            <option value="">Selecione</option>
            {(field.options ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      )
    }

    if (field.type === 'lista') {
      const items = listItemsOf(field, value)
      return (
        <div key={field.id} className="flex flex-col gap-sm">
          {label && (
            <span className="font-label text-label-sm uppercase text-on-surface-variant">
              {label}
              {field.required ? ' *' : ''}
            </span>
          )}
          {items.map((item, index) => (
            <div
              key={index}
              className="grid gap-sm rounded-lg border border-outline-variant/40 bg-surface p-md sm:grid-cols-3"
            >
              {(field.fields ?? []).map((sub) => (
                <label key={sub.id} className="block">
                  <span className="font-label text-label-sm text-on-surface-variant">
                    {sub.label ?? sub.id}
                  </span>
                  {sub.type === 'select' ? (
                    <select
                      disabled={readOnly}
                      value={item[sub.id] ?? ''}
                      onChange={(event) => setListItem(field.id, index, sub.id, event.target.value)}
                      className={`${inputCls} mt-xs`}
                    >
                      <option value="">Selecione</option>
                      {(sub.options ?? []).map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      disabled={readOnly}
                      value={item[sub.id] ?? ''}
                      placeholder={sub.placeholder}
                      onChange={(event) => setListItem(field.id, index, sub.id, event.target.value)}
                      className={`${inputCls} mt-xs`}
                    />
                  )}
                </label>
              ))}
            </div>
          ))}
        </div>
      )
    }

    if (field.type === 'texto') {
      return (
        <label key={field.id} className="block">
          {label && (
            <span className="font-label text-label-sm uppercase text-on-surface-variant">
              {label}
              {field.required ? ' *' : ''}
            </span>
          )}
          <textarea
            disabled={readOnly}
            rows={field.rows ?? 3}
            value={typeof value === 'string' ? value : ''}
            placeholder={field.placeholder}
            onChange={(event) => set(field.id, event.target.value)}
            className={`${inputCls} mt-xs`}
          />
        </label>
      )
    }

    return (
      <label key={field.id} className="block">
        {label && (
          <span className="font-label text-label-sm uppercase text-on-surface-variant">
            {label}
            {field.required ? ' *' : ''}
          </span>
        )}
        <input
          disabled={readOnly}
          value={typeof value === 'string' ? value : ''}
          placeholder={field.placeholder}
          onChange={(event) => set(field.id, event.target.value)}
          className={`${inputCls} mt-xs`}
        />
      </label>
    )
  }

  return (
    <section className="rounded-xl border border-outline-variant/40 bg-surface-container">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-sm p-lg text-left"
      >
        <span className="min-w-0">
          {activity.schema.eyebrow && (
            <span className="block font-label text-label-sm uppercase tracking-wide text-on-primary-container">
              {activity.schema.eyebrow}
            </span>
          )}
          <span className="block font-headline text-headline-sm text-on-surface">{activity.title}</span>
          {activity.schema.subtitle && (
            <span className="block font-body text-body-sm text-on-surface-variant">
              {activity.schema.subtitle}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-sm">
          <span
            className={`rounded-full px-md py-xs font-label text-label-sm ${
              submitted ? 'bg-primary/15 text-on-primary-container' : 'bg-surface-container-highest text-on-surface-variant'
            }`}
          >
            {submitted ? 'Enviada' : 'Pendente'}
          </span>
          <Icon name={open ? 'expand_less' : 'expand_more'} className="text-on-surface-variant" />
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-lg border-t border-outline-variant/40 p-lg">
          {activity.kind === 'REVIEW' && (
            <div className="rounded-lg bg-surface-container-highest p-md">
              <p className="font-label text-label-sm uppercase text-on-surface-variant">
                Meu compromisso do encontro anterior
              </p>
              <p className="mt-xs font-body text-body-md text-on-surface">
                {previousCommitment ?? 'Nenhum compromisso registrado no encontro anterior.'}
              </p>
            </div>
          )}

          {activity.schema.blocks.map((block, index) => (
            <div key={`${block.title}-${index}`} className="flex flex-col gap-sm">
              <div>
                <h4 className="font-headline text-title-md text-on-surface">
                  {block.number ? `${block.number}. ` : ''}
                  {block.title}
                  {block.time ? (
                    <span className="ml-sm font-body text-body-sm text-on-surface-variant">
                      {block.time}
                    </span>
                  ) : null}
                </h4>
                {block.note && (
                  <p className="font-body text-body-sm text-on-surface-variant">{block.note}</p>
                )}
              </div>

              {block.items?.map((item, itemIndex) => (
                <div
                  key={itemIndex}
                  className={`rounded-lg p-md ${
                    block.highlight ? 'bg-error/5 ring-1 ring-error/20' : 'bg-surface-container-highest'
                  }`}
                >
                  {item.title && (
                    <p className="font-label text-label-md text-on-surface">{item.title}</p>
                  )}
                  <ul className="list-disc pl-lg font-body text-body-sm text-on-surface-variant">
                    {item.lines.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              ))}

              {block.fields?.map((field) => renderField(field))}
            </div>
          ))}

          {activity.schema.footer && (
            <p className="font-body text-body-sm text-on-surface-variant">{activity.schema.footer}</p>
          )}

          {!readOnly && (
            <div className="flex flex-col gap-sm">
              <div className="flex flex-wrap gap-sm">
                <button
                  type="button"
                  disabled={!complete || save.isPending}
                  onClick={() => save.mutate(true)}
                  className="rounded-full bg-primary px-lg py-sm font-label text-label-lg text-on-primary disabled:bg-surface-container-highest disabled:text-on-surface-variant"
                >
                  {submitted ? 'Atualizar envio' : 'Enviar ficha'}
                </button>
                <button
                  type="button"
                  disabled={save.isPending}
                  onClick={() => save.mutate(false)}
                  className="rounded-full border border-outline-variant px-lg py-sm font-label text-label-lg text-on-surface"
                >
                  Salvar rascunho
                </button>
              </div>
              {!complete && (
                <p className="font-body text-body-sm text-on-surface-variant">
                  Preencha os campos marcados com * para enviar.
                </p>
              )}
              {submission?.submittedAt && (
                <p className="font-body text-body-sm text-on-surface-variant">
                  Enviada em {new Date(submission.submittedAt).toLocaleString('pt-BR')}.
                </p>
              )}
              {notice && <p className="font-label text-label-md text-on-primary-container">{notice}</p>}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

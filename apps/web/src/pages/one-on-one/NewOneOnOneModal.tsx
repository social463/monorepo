import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  ONE_ON_ONE_DURATIONS_MINUTES,
  ONE_ON_ONE_RECURRENCE_LABELS,
  ONE_ON_ONE_RECURRENCES,
  type OneOnOneRecurrence,
  type PublicUser,
} from '@legends/shared'
import { ApiError } from '../../lib/api'
import { createOneOnOne } from '../../lib/one-on-one-api'
import { Icon } from '../../components/Icon'
import { PersonPicker } from './PersonPicker'

const campoCls =
  'w-full rounded-md border border-outline-variant/40 bg-surface-container-low px-sm py-xs text-body-md text-on-surface'
const rotuloCls = 'font-label text-label-sm text-on-surface-variant'

export function NewOneOnOneModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [pessoa, setPessoa] = useState<PublicUser | null>(null)
  const [date, setDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [durationMinutes, setDuration] = useState(30)
  const [recurrence, setRecurrence] = useState<OneOnOneRecurrence>('NONE')
  const [recurrenceCount, setCount] = useState(8)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    const fecharNoEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', fecharNoEsc)
    return () => document.removeEventListener('keydown', fecharNoEsc)
  }, [onClose])

  const marcar = useMutation({
    mutationFn: () =>
      createOneOnOne({
        counterpartId: pessoa?.id ?? '',
        date,
        startTime,
        durationMinutes,
        recurrence,
        // Só um dos dois fins viaja: a API recusa os dois juntos.
        recurrenceCount: recurrence === 'NONE' ? null : recurrenceCount,
      }),
    onSuccess: (resposta) => {
      queryClient.invalidateQueries({ queryKey: ['one-on-ones'] })
      onClose()
      if (resposta.meetings[0]) navigate(`/1-1/${resposta.meetings[0].id}`)
    },
    onError: (err) => setErro(err instanceof ApiError ? err.message : 'Não foi possível marcar o 1:1.'),
  })

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Marcar 1:1"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          setErro(null)
          if (!pessoa) {
            setErro('Escolha com quem é o 1:1.')
            return
          }
          marcar.mutate()
        }}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-outline-variant/40 bg-surface-container p-lg shadow-xl"
      >
        <div className="mb-md flex items-center justify-between">
          <h2 className="font-headline text-title-md text-on-surface">Marcar 1:1</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex h-7 w-7 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface"
          >
            <Icon name="close" className="text-[18px]" />
          </button>
        </div>

        <div className="flex flex-col gap-md">
          <fieldset>
            <legend className={`mb-xs ${rotuloCls}`}>Com quem</legend>
            <PersonPicker value={pessoa} onChange={setPessoa} />
          </fieldset>

          <div className="grid grid-cols-2 gap-sm">
            <label className="flex flex-col gap-xs">
              <span className={rotuloCls}>Data</span>
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                required
                className={campoCls}
              />
            </label>
            <label className="flex flex-col gap-xs">
              <span className={rotuloCls}>Horário</span>
              <input
                type="time"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
                required
                className={campoCls}
              />
            </label>
          </div>

          <label className="flex flex-col gap-xs">
            <span className={rotuloCls}>Duração</span>
            <select
              value={durationMinutes}
              onChange={(event) => setDuration(Number(event.target.value))}
              className={campoCls}
            >
              {ONE_ON_ONE_DURATIONS_MINUTES.map((minutos) => (
                <option key={minutos} value={minutos}>
                  {minutos} minutos
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-xs">
            <span className={rotuloCls}>Ritmo</span>
            <select
              value={recurrence}
              onChange={(event) => setRecurrence(event.target.value as OneOnOneRecurrence)}
              className={campoCls}
            >
              {ONE_ON_ONE_RECURRENCES.map((valor) => (
                <option key={valor} value={valor}>
                  {ONE_ON_ONE_RECURRENCE_LABELS[valor]}
                </option>
              ))}
            </select>
          </label>

          {recurrence !== 'NONE' && (
            <label className="flex flex-col gap-xs">
              <span className={rotuloCls}>Quantos encontros</span>
              <input
                type="number"
                min={1}
                max={52}
                value={recurrenceCount}
                onChange={(event) => setCount(Number(event.target.value))}
                className={campoCls}
              />
            </label>
          )}

          {erro && (
            <p role="alert" className="text-body-sm text-error">
              {erro}
            </p>
          )}
        </div>

        <div className="mt-lg flex justify-end gap-sm">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-md py-xs font-label text-label-lg text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={marcar.isPending}
            className="rounded-md bg-primary px-md py-xs font-label text-label-lg text-on-primary hover:bg-primary-container hover:text-on-primary-container disabled:bg-surface-container disabled:text-on-surface-variant"
          >
            Marcar
          </button>
        </div>
      </form>
    </div>
  )
}

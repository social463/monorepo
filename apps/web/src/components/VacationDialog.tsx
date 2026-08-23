import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { PublicUser, VacationDTO } from '@legends/shared'
import { VACATION_NOTE_MAX_LENGTH } from '@legends/shared'
import { ApiError } from '../lib/api'
import { createVacation, updateVacation } from '../lib/vacations-api'
import { Icon } from './Icon'

/**
 * Modal de lançar/editar um período de férias de uma pessoa. Usado no painel da
 * Liderança (`TeamVacationsPanel`) e na linha do colaborador no Admin — por
 * isso recebe a pessoa por prop em vez de descobrir sozinho.
 */
export function VacationDialog({
  user,
  vacation,
  onClose,
}: {
  user: PublicUser
  /** `null` = criar um período novo; um `VacationDTO` = editar este. */
  vacation: VacationDTO | null
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [startDate, setStartDate] = useState(vacation?.startDate ?? '')
  const [endDate, setEndDate] = useState(vacation?.endDate ?? '')
  const [note, setNote] = useState(vacation?.note ?? '')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const save = useMutation({
    // Normalizado num lugar só: o campo em branco (ou só espaços) vira "sem
    // observação" nos dois fluxos. A forma difere porque os schemas diferem —
    // `createSchema` não aceita `null` (omitir a chave deixa a rota cair no
    // `?? null` dela); `updateSchema` aceita `null` e é o único jeito de
    // *limpar* uma observação já existente (a rota só toca o campo quando ele
    // vem `!== undefined`) — mas os dois concordam: nada digitado, nada salvo.
    mutationFn: () => {
      const trimmedNote = note.trim()
      return vacation
        ? updateVacation(vacation.id, { startDate, endDate, note: trimmedNote || null })
        : createVacation({ userId: user.id, startDate, endDate, note: trimmedNote || undefined })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['team-vacations'] })
      void queryClient.invalidateQueries({ queryKey: ['vacations'] })
      onClose()
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Erro ao salvar as férias.')
    },
  })

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    save.mutate()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={vacation ? `Editar férias — ${user.name}` : `Lançar férias — ${user.name}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-xl border border-outline-variant/40 bg-surface-container p-lg shadow-xl"
      >
        <div className="mb-md flex items-center justify-between">
          <h2 className="font-headline text-title-md text-on-surface">
            {vacation ? `Editar férias — ${user.name}` : `Lançar férias — ${user.name}`}
          </h2>
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
          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-sm text-on-surface-variant">Início</span>
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              required
              className="rounded-md border border-outline-variant/40 bg-surface-container-low px-sm py-xs text-on-surface"
            />
          </label>
          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-sm text-on-surface-variant">Fim</span>
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              required
              className="rounded-md border border-outline-variant/40 bg-surface-container-low px-sm py-xs text-on-surface"
            />
          </label>
          <label className="flex flex-col gap-xs">
            <span className="font-label text-label-sm text-on-surface-variant">Observação</span>
            <input
              type="text"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={VACATION_NOTE_MAX_LENGTH}
              className="rounded-md border border-outline-variant/40 bg-surface-container-low px-sm py-xs text-on-surface"
            />
          </label>

          {error && (
            <p role="alert" className="text-body-sm text-error">
              {error}
            </p>
          )}

          <div className="mt-sm flex items-center justify-end gap-sm">
            <button
              type="button"
              onClick={onClose}
              className="font-label text-label-sm text-on-surface-variant hover:underline"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={save.isPending}
              className="rounded-md bg-primary px-md py-xs font-label text-label-sm text-on-primary disabled:bg-surface-container disabled:text-on-surface-variant"
            >
              Salvar
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

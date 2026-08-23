import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type {
  CreateOfficeMeetingRequest,
  OfficeMeetingDTO,
  UpdateOfficeMeetingRequest,
} from '@legends/shared'
import { ApiError } from '../../lib/api'
import { Icon } from '../../components/Icon'
import { MeetingExportActions } from './MeetingExportActions'
import { MeetingForm, EMPTY_MEETING_FORM, type MeetingFormValues } from './MeetingForm'
import { MeetingList } from './MeetingList'
import { durationOf, formatWhen, toIso, toLocalInputValue } from './format'
import { useCancelMeeting, useCreateMeeting, useRoomMeetings, useUpdateMeeting } from './useRoomMeetings'

/**
 * Payload exato que gerou o 409 — "Marcar mesmo assim" reenvia ESTE objeto com
 * `force: true`, nunca remonta a partir do formulário (que pode ter mudado
 * enquanto o aviso estava na tela). Vale igual para criar e para editar.
 */
type FrozenRequest =
  | { kind: 'create'; body: CreateOfficeMeetingRequest }
  | { kind: 'edit'; id: string; body: UpdateOfficeMeetingRequest }

/**
 * Modal de reuniões da sala: agenda dos próximos dias em cima, formulário
 * embaixo (marcar ou editar). Reserva é leve — conflito não bloqueia, só pede
 * confirmação.
 */
export function ScheduleMeetingModal({
  roomExternalKey,
  roomName,
  youId,
  initialDateLocal,
  onClose,
}: {
  /** `null` = sala escolhida no formulário (fluxo do calendário); string = sala fixa (fluxo do escritório). */
  roomExternalKey: string | null
  roomName: string | null
  youId: string
  /** `YYYY-MM-DDTHH:mm` para pré-preencher o início — o calendário já sabe o dia escolhido. */
  initialDateLocal?: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  // Sala fixa: nasce já preenchido. Sala livre: só passa a existir quando o
  // `MeetingForm` escolhe uma — e sobe pra cá assim que a escolha muda (via
  // `onRoomChange`, não só no submit), pra agenda do topo e as mutações
  // seguirem a sala atual mesmo se a pessoa trocar de sala em "Marcar outra".
  const [selectedRoom, setSelectedRoom] = useState<string | null>(roomExternalKey)
  const meetings = useRoomMeetings(selectedRoom)
  const create = useCreateMeeting(selectedRoom ?? '')
  const update = useUpdateMeeting(selectedRoom ?? '')
  const cancel = useCancelMeeting(selectedRoom ?? '')

  // Sala fixa entra pronta no formulário; sala livre nasce vazia — é o
  // `MeetingForm` quem oferece o seletor nesse caso. `initialDateLocal` é só
  // o dia escolhido no calendário virando um horário sugerido (09:00).
  const newMeetingValues: MeetingFormValues = {
    ...EMPTY_MEETING_FORM,
    startsAtLocal: initialDateLocal ?? '',
    roomExternalKey: roomExternalKey ?? '',
  }

  const [editing, setEditing] = useState<OfficeMeetingDTO | null>(null)
  const [conflicts, setConflicts] = useState<OfficeMeetingDTO[] | null>(null)
  const [frozen, setFrozen] = useState<FrozenRequest | null>(null)
  const [created, setCreated] = useState<OfficeMeetingDTO | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  /** Mudar qualquer campo invalida o conflito exibido — ele descrevia outro payload. */
  function clearConflict() {
    setConflicts(null)
    setFrozen(null)
  }

  /**
   * Volta o formulário ao estado limpo: nenhum aviso sobrevive à troca do que
   * está sendo editado. Sem isso, sair da edição (ou cancelar a reunião que
   * estava aberta) deixava banner de conflito e mensagem de erro pairando sobre
   * um formulário que já é outro — e o "Marcar mesmo assim" apontava para uma
   * reunião que não existe mais.
   */
  function resetFormFeedback() {
    clearConflict()
    setError(null)
  }

  function exitEditing() {
    resetFormFeedback()
    setEditing(null)
  }

  async function attemptSubmit(request: FrozenRequest) {
    setError(null)
    try {
      if (request.kind === 'create') {
        const meeting = await create.mutateAsync(request.body)
        clearConflict()
        setCreated(meeting)
      } else {
        await update.mutateAsync({ id: request.id, body: request.body })
        exitEditing()
      }
      // A queryKey da sala já foi invalidada pelo hook — falta a do calendário,
      // que não sabe de sala nenhuma e por isso não invalida sozinho.
      void queryClient.invalidateQueries({ queryKey: ['calendar-meetings'] })
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && err.payload?.conflicts) {
        setConflicts(err.payload.conflicts as OfficeMeetingDTO[])
        setFrozen(request)
        return
      }
      setError(
        err instanceof ApiError
          ? err.message
          : request.kind === 'create'
            ? 'Não foi possível marcar a reunião'
            : 'Não foi possível salvar a reunião',
      )
    }
  }

  function handleSubmit(values: MeetingFormValues) {
    const common = {
      title: values.title,
      startsAt: toIso(values.startsAtLocal),
      durationMinutes: values.durationMinutes,
      participantIds: values.participantIds,
    }
    if (editing) {
      // `agenda: null` limpa a pauta no PATCH; `undefined` deixaria como estava.
      void attemptSubmit({
        kind: 'edit',
        id: editing.id,
        body: { ...common, agenda: values.agenda.trim() || null },
      })
      return
    }
    // Sala fixa (escritório) usa a prop; sala livre (calendário) já subiu para
    // `selectedRoom` via `onRoomChange` assim que a pessoa escolheu no
    // `Select` — `values.roomExternalKey` só entra como rede de segurança
    // (não deveria ser preciso: o botão de enviar fica desabilitado sem sala).
    const chosenRoom = roomExternalKey ?? selectedRoom ?? values.roomExternalKey
    void attemptSubmit({
      kind: 'create',
      body: { ...common, roomExternalKey: chosenRoom, agenda: values.agenda.trim() || undefined },
    })
  }

  function handleConfirmDespiteConflict() {
    if (!frozen) return
    void attemptSubmit(
      frozen.kind === 'create'
        ? { kind: 'create', body: { ...frozen.body, force: true } }
        : { kind: 'edit', id: frozen.id, body: { ...frozen.body, force: true } },
    )
  }

  function startEditing(meeting: OfficeMeetingDTO) {
    resetFormFeedback()
    setCreated(null)
    setEditing(meeting)
  }

  async function handleCancelMeeting(meeting: OfficeMeetingDTO) {
    setCancelError(null)
    try {
      await cancel.mutateAsync(meeting.id)
      void queryClient.invalidateQueries({ queryKey: ['calendar-meetings'] })
      // Cancelar libera o horário: o conflito na tela pode estar falando
      // justamente da reunião que acabou de cair. Some com ele nos dois casos —
      // e, se era a reunião em edição, sai também do modo de edição.
      if (editing?.id === meeting.id) exitEditing()
      else resetFormFeedback()
    } catch (err) {
      setCancelError(err instanceof ApiError ? err.message : 'Não foi possível cancelar a reunião')
    }
  }

  const conflictBanner = conflicts && (
    <div className="rounded-md border border-error/40 bg-error/10 p-sm">
      <p className="text-body-sm text-on-surface">
        A sala já tem reunião marcada nesse horário:{' '}
        {conflicts.map((conflict) => `${conflict.title} (${formatWhen(conflict.startsAt)})`).join(', ')}.
      </p>
      <button
        type="button"
        onClick={handleConfirmDespiteConflict}
        disabled={create.isPending || update.isPending}
        className="mt-xs rounded-md bg-error/20 px-sm py-xs font-label text-label-sm text-on-surface disabled:opacity-45"
      >
        Marcar mesmo assim
      </button>
    </div>
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={roomName ? `Reuniões da sala ${roomName}` : 'Marcar reunião'}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      {/* 70% da tela: a agenda da sala + formulário não cabiam num max-w-lg.
          No celular a largura segue cheia — 70vw ali seria uma tira estreita. */}
      <div className="h-[70vh] max-h-full w-full overflow-y-auto rounded-lg border border-outline-variant/40 bg-surface-container p-md shadow-xl md:w-[70vw]">
        <div className="mb-md flex items-center justify-between">
          <h2 className="font-headline text-title-md text-on-surface">
            {roomName ? `Reuniões — ${roomName}` : 'Marcar reunião'}
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

        <MeetingList
          meetings={meetings.data}
          isLoading={meetings.isLoading}
          youId={youId}
          editingId={editing?.id ?? null}
          cancelPending={cancel.isPending}
          error={cancelError}
          onEdit={startEditing}
          onCancel={(meeting) => void handleCancelMeeting(meeting)}
        />

        {created ? (
          <section className="space-y-sm" aria-label="Reunião marcada">
            <p className="text-body-sm text-on-surface">Reunião marcada. Coloque na sua agenda:</p>
            {/* Quem acabou de marcar é o organizador — sempre pode baixar. */}
            <MeetingExportActions meeting={created} canDownloadIcs variant="prominent" />
            <div className="flex items-center gap-md">
              <button
                type="button"
                onClick={() => setCreated(null)}
                className="font-label text-label-sm text-primary hover:underline"
              >
                Marcar outra
              </button>
              <button
                type="button"
                onClick={onClose}
                className="font-label text-label-sm text-on-surface-variant hover:underline"
              >
                Fechar
              </button>
            </div>
          </section>
        ) : (
          <MeetingForm
            key={editing?.id ?? 'nova'}
            initialValues={editing ? formValuesOf(editing) : newMeetingValues}
            // Editar nunca troca de sala (o PATCH não carrega esse campo) — o
            // seletor só faz sentido ao criar sem sala fixa (fluxo do calendário).
            roomFixed={editing !== null || roomExternalKey !== null}
            submitLabel={editing ? 'Salvar alterações' : 'Marcar reunião'}
            pending={create.isPending || update.isPending}
            youId={youId}
            onDirty={clearConflict}
            onRoomChange={setSelectedRoom}
            onSubmit={handleSubmit}
            onCancelEdit={editing ? exitEditing : undefined}
          >
            {conflictBanner}
            {error && <p className="text-body-sm text-error">{error}</p>}
          </MeetingForm>
        )}
      </div>
    </div>
  )
}

function formValuesOf(meeting: OfficeMeetingDTO): MeetingFormValues {
  return {
    title: meeting.title,
    agenda: meeting.agenda ?? '',
    startsAtLocal: toLocalInputValue(meeting.startsAt),
    durationMinutes: durationOf(meeting),
    participantIds: meeting.participants.map((person) => person.id),
    // A edição não muda de sala (`UpdateOfficeMeetingRequest` não tem esse
    // campo) — só precisa estar aqui para satisfazer `MeetingFormValues`.
    roomExternalKey: meeting.roomExternalKey,
  }
}

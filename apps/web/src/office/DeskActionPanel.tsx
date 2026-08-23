import type { OfficeDeskDTO } from '@legends/shared'
import { Icon } from '../components/Icon'

/**
 * Overlay ao clicar numa mesa reivindicável. Mostra "Reivindicar mesa" quando
 * livre, "Abandonar mesa" quando é do próprio usuário, ou o nome de quem a
 * ocupa quando é de outra pessoa. Mesmo estilo do `CharacterCard`.
 */
export function DeskActionPanel({
  desk,
  youId,
  onClaim,
  onRelease,
  onLeaveReminder,
  onClose,
}: {
  desk: OfficeDeskDTO
  youId: string | null
  onClaim: () => void
  onRelease: () => void
  onLeaveReminder?: () => void
  onClose: () => void
}) {
  const isMine = desk.claimedBy?.id === youId

  return (
    <div
      className="pointer-events-auto w-full rounded-lg border border-outline-variant/40 bg-surface-container/95 p-sm shadow-xl backdrop-blur"
      role="dialog"
      aria-label={`Ações para ${desk.name}`}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="mb-sm flex items-start justify-between gap-md">
        <h3 className="font-headline text-title-md text-on-surface">{desk.name}</h3>
        <button type="button" aria-label="Fechar" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface">
          <Icon name="close" className="text-[18px]" />
        </button>
      </div>

      {desk.claimedBy === null && (
        <button
          type="button"
          onClick={onClaim}
          className="w-full rounded-md bg-primary px-md py-sm font-label text-label-sm font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container"
        >
          Reivindicar mesa
        </button>
      )}

      {isMine && (
        <button
          type="button"
          onClick={onRelease}
          className="w-full rounded-md border border-error/40 px-md py-sm font-label text-label-sm text-error"
        >
          Abandonar mesa
        </button>
      )}

      {desk.claimedBy && !isMine && (
        <div className="space-y-sm">
          <p className="text-body-sm text-on-surface-variant">Ocupada por {desk.claimedBy.name}.</p>
          {onLeaveReminder && (
            <button
              type="button"
              onClick={onLeaveReminder}
              className="flex w-full items-center justify-center gap-xs rounded-md bg-primary px-md py-sm font-label text-label-sm font-bold text-on-primary hover:bg-primary-container hover:text-on-primary-container"
            >
              <Icon name="sticky_note_2" className="text-[18px]" />
              Deixar lembrete
            </button>
          )}
        </div>
      )}
    </div>
  )
}

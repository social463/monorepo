import type { OfficeOccupant } from '@legends/shared'
import { Avatar } from '../../components/Avatar'
import { Icon } from '../../components/Icon'
import type { RoomChatMessage } from './useRoomChat'

/**
 * Prévia da mensagem que chegou com o chat da sala fechado. Vive logo acima da
 * barra de mídia (mesmo contêiner `z-[60]`, que já fica por cima da grade de
 * câmeras expandida) e some sozinha — ver `useRoomChatAlerts`.
 */
export function RoomChatPreview({
  message,
  occupant,
  onOpen,
  onDismiss,
}: {
  message: RoomChatMessage
  occupant?: OfficeOccupant
  onOpen: () => void
  onDismiss: () => void
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto flex w-full max-w-md items-start gap-sm rounded-xl border border-outline-variant/40 bg-surface-container/95 py-sm pl-sm pr-xs shadow-lg backdrop-blur"
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`Abrir chat da sala — nova mensagem de ${message.name}`}
        className="flex min-w-0 flex-1 items-start gap-sm rounded-lg px-xs py-1 text-left transition-colors hover:bg-surface-container-highest"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-container-highest">
          <Avatar
            preferCharacter
            user={occupant ?? { name: message.name }}
            initialsClassName="font-label text-label-sm font-bold text-primary"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-label text-label-sm text-primary">{message.name}</p>
          <p className="line-clamp-2 break-words font-body text-body-sm text-on-surface">{message.text}</p>
        </div>
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dispensar aviso de mensagem"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface"
      >
        <Icon name="close" className="text-[18px]" />
      </button>
    </div>
  )
}

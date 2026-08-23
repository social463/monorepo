import type { OfficeOccupant } from '@legends/shared'
import { Icon } from '../../components/Icon'
import { Avatar } from '../../components/Avatar'
import { UserVolumeControl } from './UserVolumeControl'
import type { RemoteUserVolumeControls } from './remoteUserVolumePreferences'

export function RoomPeoplePanel({
  occupants,
  youId = null,
  remoteUserVolumes,
  onClose,
}: {
  occupants: OfficeOccupant[]
  youId?: string | null
  remoteUserVolumes?: RemoteUserVolumeControls
  onClose: () => void
}) {
  return (
    <div className="flex h-full flex-col text-on-surface">
      <header className="flex items-center justify-between border-b border-outline-variant px-md py-sm">
        <h2 className="font-label text-label-md text-on-surface-variant">Pessoas na sala ({occupants.length})</h2>
        <button
          type="button"
          aria-label="Fechar painel de pessoas da sala"
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
        >
          <Icon name="close" className="text-[18px]" />
        </button>
      </header>

      <ul className="flex-1 overflow-y-auto px-md py-sm">
        {occupants.map((occupant) => (
          <li key={occupant.userId} className="flex flex-col gap-xs border-b border-outline-variant py-sm last:border-b-0">
            <div className="flex items-center gap-sm">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-container-highest">
                <Avatar preferCharacter user={occupant} initialsClassName="font-label text-label-sm font-bold text-primary" />
              </div>
              <span className="truncate font-body text-body-sm text-on-surface">
                {occupant.name}
                {occupant.isGuest ? ' (Convidado)' : ''}
              </span>
            </div>
            {remoteUserVolumes && occupant.userId !== youId && (
              <UserVolumeControl
                name={occupant.name}
                volume={remoteUserVolumes.getUserVolume(occupant.userId)}
                onVolumeChange={(volume) => remoteUserVolumes.setUserVolume(occupant.userId, volume)}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

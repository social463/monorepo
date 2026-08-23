import type { OfficeOccupant, ShowcaseEntry } from '@legends/shared'
import { LegendCard } from '../components/LegendCard'
import { Avatar } from '../components/Avatar'
import { Icon } from '../components/Icon'
import { UserVolumeControl } from './media/UserVolumeControl'
import type { RemoteUserVolumeControls } from './media/remoteUserVolumePreferences'

/**
 * Overlay ao clicar num personagem. Reusa o `LegendCard` (sem link — os botões
 * têm as ações) quando há dados de showcase; senão, cai num cabeçalho mínimo
 * (avatar de iniciais + nome), nunca quebra. `isSelf` esconde chamar/seguir.
 */
export function CharacterCard({
  occupant,
  entry,
  isSelf,
  onCall,
  onFollow,
  onViewProfile,
  onClose,
  remoteUserVolumes,
}: {
  occupant: OfficeOccupant
  entry: ShowcaseEntry | null
  isSelf: boolean
  onCall: () => void
  onFollow: () => void
  onViewProfile: () => void
  onClose: () => void
  remoteUserVolumes?: RemoteUserVolumeControls
}) {
  const actionCls =
    'flex items-center justify-center gap-xs rounded-md px-md py-xs font-label text-label-sm transition-colors'

  return (
    <div
      className="pointer-events-auto w-full rounded-lg border border-outline-variant/40 bg-surface-container/95 p-sm shadow-xl backdrop-blur"
      role="dialog"
      aria-label={`Ações para ${occupant.name}`}
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="mb-sm flex justify-end">
        <button type="button" aria-label="Fechar" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-md text-on-surface-variant hover:bg-surface-container-highest hover:text-on-surface">
          <Icon name="close" className="text-[18px]" />
        </button>
      </div>

      {entry ? (
        <LegendCard entry={entry} linkTo={null} compact />
      ) : (
        <div className="flex flex-col items-center gap-sm rounded-lg border border-outline-variant/30 bg-surface-container p-md text-center">
          <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border-2 border-primary bg-surface-container-highest">
            <Avatar user={occupant} initialsClassName="font-headline text-title-lg font-bold text-primary" />
          </div>
          <h3 className="font-headline text-title-lg text-on-surface">
            {occupant.name}
            {occupant.isGuest && <span className="ml-xs font-label text-label-md text-on-surface-variant">(Convidado)</span>}
          </h3>
        </div>
      )}

      <div className="mt-sm flex flex-col gap-xs">
        {!isSelf && remoteUserVolumes && (
          <UserVolumeControl
            name={occupant.name}
            volume={remoteUserVolumes.getUserVolume(occupant.userId)}
            onVolumeChange={(volume) => remoteUserVolumes.setUserVolume(occupant.userId, volume)}
            className="border-outline-variant/30 bg-surface-container-highest text-on-surface"
          />
        )}
        {!isSelf && (
          <>
            <button type="button" onClick={onCall} className={`${actionCls} bg-primary text-on-primary hover:bg-primary-container hover:text-on-primary-container`}>
              <Icon name="call" className="text-[18px]" /> Chamar
            </button>
            <button type="button" onClick={onFollow} className={`${actionCls} bg-surface-container-highest text-on-surface hover:bg-surface-container-high`}>
              <Icon name="directions_walk" className="text-[18px]" /> Seguir
            </button>
          </>
        )}
        {!occupant.isGuest && (
          <button type="button" onClick={onViewProfile} className={`${actionCls} bg-surface-container-highest text-on-surface hover:bg-surface-container-high`}>
            <Icon name="account_circle" className="text-[18px]" /> Ver perfil
          </button>
        )}
      </div>
    </div>
  )
}

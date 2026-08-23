import type { OfficeOccupant } from '@legends/shared'
import { Icon } from '../../components/Icon'
import { Avatar } from '../../components/Avatar'
import type { RoomKnock } from './useRoomLock'

/**
 * Quem está pedindo para entrar na sala trancada. Foto e nome saem do
 * `occupants` (o `knock-request` só carrega id e nome); sem o occupant — caso
 * raro de a pessoa sair no meio — cai nas iniciais do nome do pedido.
 *
 * Empilha um card por pedido: qualquer pessoa da sala pode responder, e quem
 * responder primeiro resolve para todo mundo.
 */
export function KnockRequestModal({
  knocks,
  occupants,
  onRespond,
}: {
  knocks: RoomKnock[]
  occupants: OfficeOccupant[]
  onRespond: (userId: string, accepted: boolean) => void
}) {
  if (knocks.length === 0) return null

  return (
    <div className="flex flex-col gap-sm">
      {knocks.map((knock) => {
        const occupant = occupants.find((o) => o.userId === knock.userId)
        return (
          <div
            key={knock.userId}
            role="alertdialog"
            aria-label={`${knock.name} quer entrar na sala`}
            className="pointer-events-auto flex w-80 flex-col gap-md rounded-lg border border-primary/50 bg-surface-container/95 p-lg shadow-xl backdrop-blur"
            onWheel={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-md">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-surface-container-highest">
                <Avatar preferCharacter user={occupant ?? { name: knock.name }} />
              </div>
              <div className="min-w-0">
                <p className="truncate font-body text-body-md text-on-surface">
                  <span className="font-bold">{knock.name}</span> quer entrar na sala
                </p>
                <p className="flex items-center gap-xs font-label text-label-sm text-on-surface-variant">
                  <Icon name="lock" className="text-[14px]" />A sala está trancada
                </p>
              </div>
            </div>
            <div className="flex gap-sm">
              <button
                type="button"
                onClick={() => onRespond(knock.userId, true)}
                className="flex-1 rounded-md bg-primary py-sm font-label text-label-md text-on-primary hover:bg-primary-container hover:text-on-primary-container"
              >
                Aceitar
              </button>
              <button
                type="button"
                onClick={() => onRespond(knock.userId, false)}
                className="flex-1 rounded-md bg-surface-container-highest py-sm font-label text-label-md text-on-surface hover:bg-surface-container-high"
              >
                Recusar
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

import type { OfficeDeskDTO } from '@legends/shared'
import { Avatar } from '../components/Avatar'
import { Icon } from '../components/Icon'
import type { ScreenPosition } from './scenes/OfficeScene'

/** Altura aproximada da pastilha + a folga que queremos manter até a borda. */
const CARD_CLEARANCE_PX = 56

/**
 * Pastilha flutuante que aparece ao passar o mouse sobre uma mesa (hover no
 * canvas Phaser, posição rastreada via `useDeskScreenPosition`). Mostra quem
 * ocupa a mesa (avatar + nome) ou o convite para reivindicá-la quando livre.
 * Normalmente ancorada ACIMA da mesa; quando não há espaço (mesa perto do
 * topo do viewport), inverte para abaixo — senão a pastilha fica cortada.
 */
export function DeskHoverCard({
  desk,
  youId,
  position,
}: {
  desk: OfficeDeskDTO
  youId: string | null
  position: ScreenPosition
}) {
  const isMine = desk.claimedBy?.id === youId
  const above = position.y >= CARD_CLEARANCE_PX

  return (
    <div
      className={`pointer-events-none absolute z-20 flex -translate-x-1/2 items-center gap-xs rounded-full bg-inverse-surface/95 py-1 pl-1 pr-3 shadow-lg ${
        above ? '-translate-y-full' : ''
      }`}
      style={{ left: position.x, top: above ? position.y - 12 : position.y + 20 }}
    >
      {desk.claimedBy ? (
        <>
          <div className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary">
            <div className="h-full w-full overflow-hidden rounded-full">
              <Avatar preferCharacter user={desk.claimedBy} initialsClassName="font-label text-label-sm font-bold text-on-primary" />
            </div>
            <span
              aria-hidden
              className="absolute -bottom-px -right-px h-2 w-2 rounded-full border border-[#111827] bg-green-500"
            />
          </div>
          {/*
            O nome do dono vive AQUI, e só aqui: o mapa não rotula mais mesa
            nenhuma (eram 131 textos fixos na tela). Por isso ele aparece
            junto da ação, em vez de a pastilha mostrar só o botão.
          */}
          <span className="whitespace-nowrap font-label text-label-sm text-inverse-on-surface">
            {isMine ? 'Sua mesa' : desk.claimedBy.name}
          </span>
          {!isMine && (
            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-primary px-2 py-0.5 font-label text-label-sm text-on-primary">
              <Icon name="sticky_note_2" className="text-[14px]" />
              Deixar lembrete
            </span>
          )}
        </>
      ) : (
        <span className="whitespace-nowrap px-xs font-label text-label-sm text-inverse-on-surface">Reivindicar mesa</span>
      )}
    </div>
  )
}

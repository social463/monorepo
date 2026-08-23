import { Icon } from '../../components/Icon'

/**
 * Você esbarrou numa sala trancada. Enquanto `waiting`, o pedido já foi feito
 * e está na tela de quem está dentro — o botão vira um aviso de espera, e
 * cancelar retira o pedido.
 */
export function RoomLockedPopup({
  roomName,
  waiting,
  onKnock,
  onCancel,
}: {
  roomName: string
  waiting: boolean
  onKnock: () => void
  onCancel: () => void
}) {
  return (
    <div
      role="alertdialog"
      aria-label={`Sala ${roomName} trancada`}
      className="pointer-events-auto flex w-80 flex-col gap-md rounded-lg border border-outline-variant/50 bg-surface-container/95 p-lg shadow-xl backdrop-blur"
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-sm">
        <Icon name="lock" className="text-[24px] text-on-surface-variant" />
        <p className="font-body text-body-md text-on-surface">
          A sala <span className="font-bold">{roomName}</span> está trancada.
        </p>
      </div>
      {waiting && (
        <p className="font-label text-label-sm text-on-surface-variant">
          Pedido enviado — aguardando quem está na sala.
        </p>
      )}
      <div className="flex gap-sm">
        <button
          type="button"
          onClick={onKnock}
          disabled={waiting}
          className="flex-1 rounded-md bg-primary py-sm font-label text-label-md text-on-primary hover:bg-primary-container hover:text-on-primary-container disabled:cursor-not-allowed disabled:bg-surface-container disabled:text-on-surface-variant"
        >
          {waiting ? 'Aguardando…' : 'Pedir para entrar'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-md bg-surface-container-highest py-sm font-label text-label-md text-on-surface hover:bg-surface-container-high"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}

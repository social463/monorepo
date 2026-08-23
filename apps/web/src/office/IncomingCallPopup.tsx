import { Icon } from '../components/Icon'

/** Popup de chamada recebida. O beep é tocado pelo hook ao abrir. */
export function IncomingCallPopup({
  name,
  onAccept,
  onRefuse,
}: {
  name: string
  onAccept: () => void
  onRefuse: () => void
}) {
  return (
    <div
      role="alertdialog"
      aria-label={`Chamada de ${name}`}
      className="pointer-events-auto flex w-80 flex-col gap-md rounded-lg border border-primary/50 bg-surface-container/95 p-lg shadow-xl backdrop-blur"
      onWheel={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-sm">
        <Icon name="call" className="text-[24px] text-primary" />
        <p className="font-body text-body-md text-on-surface">
          <span className="font-bold">{name}</span> está te chamando
        </p>
      </div>
      <div className="flex gap-sm">
        <button type="button" onClick={onAccept} className="flex-1 rounded-md bg-primary py-sm font-label text-label-md text-on-primary hover:bg-primary-container hover:text-on-primary-container">
          Aceitar
        </button>
        <button type="button" onClick={onRefuse} className="flex-1 rounded-md bg-surface-container-highest py-sm font-label text-label-md text-on-surface hover:bg-surface-container-high">
          Recusar
        </button>
      </div>
    </div>
  )
}

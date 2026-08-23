import { NotificationBell } from '../../components/NotificationBell'
import { Icon } from '../../components/Icon'
import { BrandLogo } from '../../components/BrandLogo'
import { OFFICE_NAV_ITEMS } from './office-nav-items'

const railButtonCls = (active: boolean) =>
  `office-toolbar-btn flex h-11 w-11 items-center justify-center rounded-full border transition-all ${
    active
      ? 'border-primary-container/40 bg-primary-container/20 text-primary shadow-[0_0_15px_rgb(var(--brand-primary,37 222 136)/0.3)]'
      : 'border-transparent text-on-surface-variant hover:border-primary-container/30 hover:bg-primary-container/10 hover:text-primary hover:shadow-[0_0_15px_rgb(var(--brand-primary,37 222 136)/0.3)]'
  }`

/**
 * Rail vertical fino e persistente na borda esquerda do escritório
 * (Pessoas online, Notificações, Editar mapa) — mesma linguagem visual
 * "glass neon" da MediaBar. Não inclui "Sair" (ação de sessão, continua na
 * MediaBar). A grade de câmeras entra aqui só dentro de uma sala de reunião
 * (`inMeetingRoom`) — fora dela some, igual ao botão flutuante que existia
 * antes.
 */
export function OfficeNavRail({
  isGuest,
  peopleOpen,
  onTogglePeople,
  canEditMap,
  onEditMap,
  notificationsOpen,
  onNotificationsOpenChange,
  settingsOpen,
  onToggleSettings,
  onSelectOffice,
  inMeetingRoom = false,
  camerasExpanded = false,
  onToggleCameras,
  roomOccupantCount = 0,
}: {
  isGuest: boolean
  peopleOpen: boolean
  onTogglePeople: () => void
  canEditMap: boolean
  onEditMap: () => void
  notificationsOpen: boolean
  onNotificationsOpenChange: (open: boolean) => void
  settingsOpen: boolean
  onToggleSettings: () => void
  onSelectOffice: () => void
  inMeetingRoom?: boolean
  camerasExpanded?: boolean
  onToggleCameras?: () => void
  roomOccupantCount?: number
}) {
  const peopleLabel = peopleOpen ? 'Recolher pessoas online' : 'Expandir pessoas online'
  const officeActive = !peopleOpen && !notificationsOpen && !settingsOpen

  return (
    <nav
      aria-label="Navegação do escritório"
      /*
       * `/95` e não `/70`: a rail cobre a altura inteira sobre o mapa, e a 70%
       * o verde do gramado atravessava e tingia a superfície — os ícones
       * ficavam sobre um fundo que não era nem a superfície do app nem o mapa,
       * e o contraste deles deixava de ser o que a paleta garante. A barra de
       * mídia continua em /70 porque é um pill pequeno com sombra própria, que
       * se destaca do fundo por elevação.
       */
      className="fixed inset-y-0 left-0 z-30 flex w-[68px] flex-col items-center gap-sm border-r border-outline-variant bg-surface/95 py-md backdrop-blur-xl"
      onWheel={(event) => event.stopPropagation()}
    >
      <BrandLogo variant="mark" className="h-9 w-9 object-contain" />

      <div className="h-px w-8 shrink-0 bg-primary-container/20" aria-hidden />

      <button
        type="button"
        aria-label={OFFICE_NAV_ITEMS.office.label}
        title={OFFICE_NAV_ITEMS.office.label}
        aria-pressed={officeActive}
        onClick={onSelectOffice}
        className={railButtonCls(officeActive)}
      >
        <Icon name={OFFICE_NAV_ITEMS.office.icon} className="text-[22px]" />
      </button>

      <button
        type="button"
        aria-label={peopleLabel}
        title={OFFICE_NAV_ITEMS.people.label}
        aria-pressed={peopleOpen}
        onClick={onTogglePeople}
        className={railButtonCls(peopleOpen)}
      >
        <Icon name={OFFICE_NAV_ITEMS.people.icon} className="text-[22px]" />
      </button>

      {!isGuest && (
        <NotificationBell
          variant="bare"
          anchor="right"
          open={notificationsOpen}
          onOpenChange={onNotificationsOpenChange}
        />
      )}

      <button
        type="button"
        title={OFFICE_NAV_ITEMS.settings.label}
        aria-label={OFFICE_NAV_ITEMS.settings.label}
        aria-pressed={settingsOpen}
        onClick={onToggleSettings}
        className={railButtonCls(settingsOpen)}
      >
        <Icon name={OFFICE_NAV_ITEMS.settings.icon} className="text-[20px]" />
      </button>

      {!isGuest && canEditMap && (
        <button
          type="button"
          title={OFFICE_NAV_ITEMS.editMap.label}
          aria-label={OFFICE_NAV_ITEMS.editMap.label}
          onClick={onEditMap}
          className={railButtonCls(false)}
        >
          <Icon name={OFFICE_NAV_ITEMS.editMap.icon} className="text-[20px]" />
        </button>
      )}

      {inMeetingRoom && (
        <button
          type="button"
          aria-label={camerasExpanded ? 'Recolher grade de câmeras' : 'Abrir grade de câmeras'}
          title={`Grade de câmeras — ${roomOccupantCount} na sala`}
          aria-pressed={camerasExpanded}
          onClick={onToggleCameras}
          className={`relative ${railButtonCls(camerasExpanded)}`}
        >
          <Icon name="grid_view" className="text-[20px]" />
          {roomOccupantCount > 0 && (
            <span
              aria-hidden
              className="absolute -bottom-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-surface bg-primary-container px-0.5 font-label text-[9px] font-bold text-on-primary-container"
            >
              {roomOccupantCount}
            </span>
          )}
        </button>
      )}
    </nav>
  )
}

export interface OfficeNavItemConfig {
  id: string
  icon: string
  label: string
}

export const OFFICE_NAV_ITEMS = {
  office: { id: 'office', icon: 'chair', label: 'Escritório' },
  people: { id: 'people', icon: 'groups', label: 'Pessoas online' },
  notifications: { id: 'notifications', icon: 'notifications', label: 'Notificações' },
  settings: { id: 'settings', icon: 'settings', label: 'Configurações' },
  editMap: { id: 'editMap', icon: 'edit', label: 'Editar mapa' },
} as const satisfies Record<string, OfficeNavItemConfig>

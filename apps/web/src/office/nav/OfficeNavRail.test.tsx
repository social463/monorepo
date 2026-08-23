import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { OfficeNavRail } from './OfficeNavRail'

vi.mock('../../lib/use-notifications', () => ({
  useUnreadCount: () => ({ data: { unreadCount: 0 } }),
  useNotifications: () => ({ data: { pages: [] } }),
  useMarkAllRead: () => ({ mutate: vi.fn() }),
}))

function wrap(ui: React.ReactElement) {
  const client = new QueryClient()
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

function baseProps(overrides: Partial<Parameters<typeof OfficeNavRail>[0]> = {}) {
  return {
    isGuest: false,
    peopleOpen: false,
    onTogglePeople: vi.fn(),
    canEditMap: true,
    onEditMap: vi.fn(),
    notificationsOpen: false,
    onNotificationsOpenChange: vi.fn(),
    settingsOpen: false,
    onToggleSettings: vi.fn(),
    onSelectOffice: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => vi.clearAllMocks())

describe('OfficeNavRail', () => {
  it('mostra os itens principais quando não é convidado e pode editar o mapa', () => {
    wrap(<OfficeNavRail {...baseProps()} />)
    expect(screen.getByRole('button', { name: 'Expandir pessoas online' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Notificações' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Configurações' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Editar mapa' })).toBeInTheDocument()
  })

  it('convidado não vê Notificações nem Editar mapa, mas vê Configurações', () => {
    wrap(<OfficeNavRail {...baseProps({ isGuest: true, canEditMap: false })} />)
    expect(screen.getByRole('button', { name: 'Expandir pessoas online' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Configurações' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Notificações' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Editar mapa' })).not.toBeInTheDocument()
  })

  it('canEditMap=false esconde Editar mapa mesmo sem ser convidado', () => {
    wrap(<OfficeNavRail {...baseProps({ canEditMap: false })} />)
    expect(screen.queryByRole('button', { name: 'Editar mapa' })).not.toBeInTheDocument()
  })

  it('clicar em Pessoas online chama onTogglePeople', () => {
    const onTogglePeople = vi.fn()
    wrap(<OfficeNavRail {...baseProps({ onTogglePeople })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Expandir pessoas online' }))
    expect(onTogglePeople).toHaveBeenCalledOnce()
  })

  it('com peopleOpen, o botão de pessoas mostra o rótulo de recolher e fica marcado como pressionado', () => {
    wrap(<OfficeNavRail {...baseProps({ peopleOpen: true })} />)
    const button = screen.getByRole('button', { name: 'Recolher pessoas online' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
  })

  it('clicar em Editar mapa chama onEditMap', () => {
    const onEditMap = vi.fn()
    wrap(<OfficeNavRail {...baseProps({ onEditMap })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Editar mapa' }))
    expect(onEditMap).toHaveBeenCalledOnce()
  })

  it('clicar em Configurações chama onToggleSettings', () => {
    const onToggleSettings = vi.fn()
    wrap(<OfficeNavRail {...baseProps({ onToggleSettings })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Configurações' }))
    expect(onToggleSettings).toHaveBeenCalledOnce()
  })

  it('com settingsOpen, Configurações fica marcado como pressionado', () => {
    wrap(<OfficeNavRail {...baseProps({ settingsOpen: true })} />)
    expect(screen.getByRole('button', { name: 'Configurações' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('repassa notificationsOpen/onNotificationsOpenChange pro NotificationBell', () => {
    wrap(<OfficeNavRail {...baseProps({ notificationsOpen: true })} />)
    expect(screen.getByRole('menu')).toHaveTextContent('Notificações')
  })

  it('"Escritório" fica ativo quando nem pessoas nem notificações estão abertos', () => {
    wrap(<OfficeNavRail {...baseProps()} />)
    const office = screen.getByRole('button', { name: 'Escritório' })
    expect(office).toHaveAttribute('aria-pressed', 'true')
  })

  it('"Escritório" fica inativo quando pessoas online está aberto', () => {
    wrap(<OfficeNavRail {...baseProps({ peopleOpen: true })} />)
    const office = screen.getByRole('button', { name: 'Escritório' })
    expect(office).toHaveAttribute('aria-pressed', 'false')
  })

  it('"Escritório" fica inativo quando notificações está aberto', () => {
    wrap(<OfficeNavRail {...baseProps({ notificationsOpen: true })} />)
    const office = screen.getByRole('button', { name: 'Escritório' })
    expect(office).toHaveAttribute('aria-pressed', 'false')
  })

  it('"Escritório" fica inativo quando configurações está aberto', () => {
    wrap(<OfficeNavRail {...baseProps({ settingsOpen: true })} />)
    const office = screen.getByRole('button', { name: 'Escritório' })
    expect(office).toHaveAttribute('aria-pressed', 'false')
  })

  it('clicar em "Escritório" chama onSelectOffice', () => {
    const onSelectOffice = vi.fn()
    wrap(<OfficeNavRail {...baseProps({ onSelectOffice })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Escritório' }))
    expect(onSelectOffice).toHaveBeenCalledOnce()
  })

  it('mostra a logo da Legends no topo do rail', () => {
    wrap(<OfficeNavRail {...baseProps()} />)
    expect(screen.getByAltText('Legends')).toBeInTheDocument()
  })

  it('fora de uma sala de reunião, não mostra o botão de grade de câmeras', () => {
    wrap(<OfficeNavRail {...baseProps({ inMeetingRoom: false })} />)
    expect(screen.queryByRole('button', { name: 'Abrir grade de câmeras' })).not.toBeInTheDocument()
  })

  it('numa sala de reunião, mostra o botão de grade com o contador de participantes e chama onToggleCameras', () => {
    const onToggleCameras = vi.fn()
    wrap(<OfficeNavRail {...baseProps({ inMeetingRoom: true, roomOccupantCount: 3, onToggleCameras })} />)
    const button = screen.getByRole('button', { name: 'Abrir grade de câmeras' })
    expect(button).toHaveTextContent('3')
    fireEvent.click(button)
    expect(onToggleCameras).toHaveBeenCalledOnce()
  })

  it('com camerasExpanded, o botão de grade mostra o rótulo de recolher e fica marcado como pressionado', () => {
    wrap(<OfficeNavRail {...baseProps({ inMeetingRoom: true, camerasExpanded: true })} />)
    const button = screen.getByRole('button', { name: 'Recolher grade de câmeras' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
  })
})

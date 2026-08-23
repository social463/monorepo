import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { defaultCharacterFromSeed, type OfficeOccupant, type PublicUser } from '@legends/shared'

const apiFetchMock = vi.fn()
vi.mock('../lib/api', () => ({ apiFetch: (...a: unknown[]) => apiFetchMock(...a) }))
// jsdom não implementa canvas 2d: a composição real do retrato quebraria aqui
// independente do Avatar; mocka como em components/Avatar.test.tsx.
vi.mock('../lib/character', () => ({
  characterPortraitDataUri: vi.fn(() => Promise.resolve('data:image/png;base64,retrato')),
}))

import { PeopleList, menuActionsFor } from './PeopleList'

function occ(userId: string, name: string, overrides: Partial<OfficeOccupant> = {}): OfficeOccupant {
  return {
    userId,
    name,
    x: 5,
    y: 5,
    dir: 'down',
    avatarSeed: null,
    avatarOptions: null,
    ...overrides,
  }
}
function pub(id: string, name: string): PublicUser {
  return {
    id, name, email: null, role: 'LEGEND', area: null, position: 'Dev', squad: null,
    photoUrl: null, avatarStyle: null, avatarSeed: null, avatarOptions: null,
    active: true, joinedAt: '2026-01-01T00:00:00.000Z', leftAt: null, enabledFeatures: [], sectorId: 'sector-dev-produto', companyId: 'company-emr', companyName: null, sectorFeatures: [], adminAccess: false,
  }
}

function renderList(props?: Partial<Parameters<typeof PeopleList>[0]>) {
  const onCall = vi.fn()
  const onFollow = vi.fn()
  const onViewProfile = vi.fn()
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={qc}>
      <PeopleList
        occupants={[occ('ana', 'Ana Silva'), occ('bruno', 'Bruno Costa')]}
        youId="ana"
        onCall={onCall}
        onFollow={onFollow}
        onViewProfile={onViewProfile}
        {...props}
      />
    </QueryClientProvider>,
  )
  return { onCall, onFollow, onViewProfile }
}

beforeEach(() => {
  apiFetchMock.mockReset()
  // /users exclui admins e você — devolve o resto do time (inclui um offline: carla)
  apiFetchMock.mockResolvedValue({ users: [pub('bruno', 'Bruno Costa'), pub('carla', 'Carla Dias')] })
})

describe('menuActionsFor', () => {
  it('sua linha → só ver perfil', () => {
    expect(menuActionsFor({ isSelf: true, isOnline: true })).toEqual(['view-profile'])
  })
  it('online de outra pessoa → chamar, seguir, ver perfil', () => {
    expect(menuActionsFor({ isSelf: false, isOnline: true })).toEqual(['call', 'follow', 'view-profile'])
  })
  it('offline → só ver perfil', () => {
    expect(menuActionsFor({ isSelf: false, isOnline: false })).toEqual(['view-profile'])
  })
})

describe('PeopleList', () => {
  it('lista os online (com "(você)") e o contador', async () => {
    renderList()
    expect(screen.getByText(/Ana Silva/)).toBeInTheDocument()
    expect(screen.getByText(/\(você\)/)).toBeInTheDocument()
    expect(screen.getByText('Bruno Costa')).toBeInTheDocument()
    expect(screen.getByText('Online (2)')).toBeInTheDocument()
  })

  it('reflete o status de presença (texto e cor) de cada pessoa online', async () => {
    renderList({
      occupants: [
        occ('ana', 'Ana Silva', { status: 'brb' }),
        occ('bruno', 'Bruno Costa', { status: 'away' }),
      ],
    })

    const anaStatus = screen.getByText('Volto logo')
    expect(anaStatus).toHaveClass('text-blue-400')

    const brunoStatus = screen.getByText('Ausente')
    expect(brunoStatus).toHaveClass('text-yellow-400')
  })

  it('pessoa online sem status definido aparece como "Online"', async () => {
    renderList({ occupants: [occ('ana', 'Ana Silva'), occ('bruno', 'Bruno Costa')] })
    expect(screen.getAllByText('Online').length).toBeGreaterThan(0)
  })

  it('exibe avatar do perfil quando a pessoa online tem avatar definido', async () => {
    renderList({
      occupants: [
        occ('ana', 'Ana Silva'),
        // Personagem lpc válido (o único avatarStyle que a API grava/retorna
        // hoje — valores legados como 'open-peeps' saem sanitizados para null).
        occ('bruno', 'Bruno Costa', {
          avatarStyle: 'lpc',
          avatarSeed: 'bruno-seed',
          avatarOptions: defaultCharacterFromSeed('bruno-seed'),
        }),
      ],
    })

    // Retrato do personagem compõe de forma assíncrona (canvas).
    await waitFor(() => expect(screen.getByRole('img', { name: 'Bruno Costa' })).toBeInTheDocument())
  })

  it('offline = time do /users menos os presentes e menos você', async () => {
    renderList()
    // Carla está no /users mas não em occupants → offline. Bruno está online. Ana é você.
    await screen.findByText('Offline (1)')
    // offline começa recolhida — expande para ver a Carla
    fireEvent.click(screen.getByRole('button', { name: /Offline/ }))
    await waitFor(() => expect(screen.getByText('Carla Dias')).toBeInTheDocument())
  })

  it('filtra pessoas online e offline pelo termo de busca', async () => {
    renderList({ searchTerm: 'carla' })

    await waitFor(() => expect(screen.getByText('Carla Dias')).toBeInTheDocument())
    expect(screen.queryByText('Ana Silva')).not.toBeInTheDocument()
    expect(screen.queryByText('Bruno Costa')).not.toBeInTheDocument()
    expect(screen.getByText('Online (0)')).toBeInTheDocument()
    expect(screen.getByText('Offline (1)')).toBeInTheDocument()
  })

  it('setinha de cada seção recolhe/expande a lista', async () => {
    renderList()
    // online começa aberta → Bruno visível; recolhe → some
    expect(screen.getByText('Bruno Costa')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Online/ }))
    await waitFor(() => expect(screen.queryByText('Bruno Costa')).not.toBeInTheDocument())
    // reexpande
    fireEvent.click(screen.getByRole('button', { name: /Online/ }))
    await waitFor(() => expect(screen.getByText('Bruno Costa')).toBeInTheDocument())
  })

  it('menu de outra pessoa online tem as 3 ações e chamam os callbacks', async () => {
    const { onCall, onFollow, onViewProfile } = renderList()
    fireEvent.click(screen.getByRole('button', { name: 'Ações para Bruno Costa' }))
    const menu = screen.getByRole('menu')
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Chamar' }))
    expect(onCall).toHaveBeenCalledWith('bruno')
    // menu fecha após a ação
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Ações para Bruno Costa' }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Seguir' }))
    expect(onFollow).toHaveBeenCalledWith('bruno')

    fireEvent.click(screen.getByRole('button', { name: 'Ações para Bruno Costa' }))
    fireEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Ver perfil' }))
    expect(onViewProfile).toHaveBeenCalledWith('bruno')
  })

  it('menu da SUA linha só tem "Ver perfil"', () => {
    renderList()
    fireEvent.click(screen.getByRole('button', { name: 'Ações para Ana Silva' }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'Ver perfil' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Chamar' })).not.toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Seguir' })).not.toBeInTheDocument()
  })

  it('menu de uma pessoa OFFLINE só tem "Ver perfil"', async () => {
    renderList()
    fireEvent.click(screen.getByRole('button', { name: /Offline/ })) // expande
    await screen.findByText('Carla Dias')
    fireEvent.click(screen.getByRole('button', { name: 'Ações para Carla Dias' }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'Ver perfil' })).toBeInTheDocument()
    expect(within(menu).queryByRole('menuitem', { name: 'Chamar' })).not.toBeInTheDocument()
  })

  it('um menu aberto por vez; Esc e clique-fora fecham', async () => {
    renderList()
    fireEvent.click(screen.getByRole('button', { name: 'Ações para Bruno Costa' }))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    // abrir o da Ana fecha o do Bruno (um por vez)
    fireEvent.click(screen.getByRole('button', { name: 'Ações para Ana Silva' }))
    expect(screen.getAllByRole('menu')).toHaveLength(1)
    // Esc fecha
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    // reabre e fecha por clique-fora
    fireEvent.click(screen.getByRole('button', { name: 'Ações para Bruno Costa' }))
    fireEvent.mouseDown(document.body)
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })

  it('offline vazio mostra a frase discreta', async () => {
    apiFetchMock.mockResolvedValue({ users: [pub('bruno', 'Bruno Costa')] }) // só online
    renderList()
    expect(screen.getByText('Offline (0)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Offline/ }))
    await waitFor(() => expect(screen.getByText('Ninguém offline')).toBeInTheDocument())
  })

  it('ordena as duas listas por nome, e não pela ordem de entrada no mapa', async () => {
    apiFetchMock.mockResolvedValue({ users: [pub('zeca', 'Zeca Pinto'), pub('carla', 'Carla Dias')] })
    renderList({
      // Ordem de chegada ao escritório: propositalmente fora de ordem alfabética.
      occupants: [occ('vera', 'Vera Lima'), occ('erika', 'Érika Nunes'), occ('bruno', 'Bruno Costa')],
      youId: 'vera',
    })

    // Primeiro <p> de cada linha é o nome (o segundo é o status).
    const namesIn = (list: HTMLElement) =>
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.querySelector('p')?.textContent)

    // "Érika" entre "Bruno" e "Vera" — o acento não pode jogá-la para o fim.
    await waitFor(() =>
      expect(namesIn(screen.getByRole('list'))).toEqual(['Bruno Costa', 'Érika Nunes', 'Vera Lima (você)']),
    )

    fireEvent.click(screen.getByRole('button', { name: /Offline/ }))
    await waitFor(() => expect(screen.getByText('Carla Dias')).toBeInTheDocument())
    const listas = screen.getAllByRole('list')
    expect(namesIn(listas[listas.length - 1])).toEqual(['Carla Dias', 'Zeca Pinto'])
  })
})

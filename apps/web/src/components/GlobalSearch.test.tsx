import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, type Mock } from 'vitest'
import { FEATURE_KEYS } from '@legends/shared'
import { GlobalSearch } from './GlobalSearch'
import { apiFetch } from '../lib/api'
import { useAuth } from '../auth/AuthContext'

const currentUser = {
  id: 'u1',
  name: 'Ana Souza',
  role: 'LEGEND',
  position: 'Dev',
  photoUrl: null,
  enabledFeatures: FEATURE_KEYS,
  sectorFeatures: FEATURE_KEYS,
  adminAccess: false,
}

vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(() => ({ user: currentUser, loading: false, login: vi.fn(), logout: vi.fn() })),
}))

vi.mock('../lib/use-development-settings', () => ({
  useDevelopmentSettings: vi.fn(() => ({ data: undefined })),
}))

vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})

const mockApiFetch = apiFetch as unknown as Mock
const mockUseAuth = useAuth as unknown as Mock

function person(over: Record<string, unknown>) {
  return {
    id: 'x',
    name: 'Fulano',
    email: null,
    role: 'LEGEND',
    area: null,
    position: null,
    squad: null,
    photoUrl: null,
    avatarStyle: null,
    avatarSeed: null,
    avatarOptions: null,
    active: true,
    joinedAt: '2026-01-01T00:00:00.000Z',
    leftAt: null,
    sectorId: 's1',
    companyId: 'company-emr',
    companyName: null,
    enabledFeatures: [],
    sectorFeatures: [],
    adminAccess: false,
    ...over,
  }
}

function renderSearch() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <GlobalSearch />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('GlobalSearch — pessoas', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseAuth.mockReturnValue({ user: currentUser, loading: false, login: vi.fn(), logout: vi.fn() })
  })

  it('busca pessoas na empresa inteira, e não só no próprio setor', async () => {
    mockApiFetch.mockImplementation((path: string) => {
      if (path === '/users/company') {
        return Promise.resolve({
          users: [person({ id: 'u2', name: 'Camila Sampaio', position: 'Head de CX', sectorName: 'CX' })],
        })
      }
      return Promise.reject(new Error(`unexpected ${path}`))
    })

    renderSearch()
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith('/users/company'))
    // O recorte por setor de `/users` é o que escondia colega de outra área.
    expect(mockApiFetch).not.toHaveBeenCalledWith('/users')

    fireEvent.change(screen.getByPlaceholderText('Buscar pessoas e páginas…'), { target: { value: 'camila' } })
    expect(await screen.findByText('Camila Sampaio')).toBeInTheDocument()
  })

  it('sem cargo, mostra o setor da pessoa em vez de um nome fixo', async () => {
    mockApiFetch.mockResolvedValue({
      users: [person({ id: 'u3', name: 'Juliano Braga', position: null, sectorName: 'Receita' })],
    })

    renderSearch()
    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith('/users/company'))

    fireEvent.change(screen.getByPlaceholderText('Buscar pessoas e páginas…'), { target: { value: 'juliano' } })
    expect(await screen.findByText('Receita')).toBeInTheDocument()
  })
})

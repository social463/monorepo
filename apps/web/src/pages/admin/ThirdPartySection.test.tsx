import { describe, it, expect, vi } from 'vitest'
import type { AdminUserDTO, ThirdPartyInviteDTO } from '@legends/shared'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const apiFetchMock = vi.fn()
vi.mock('../../lib/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
  ApiError: class ApiError extends Error {
    status: number
    payload: Record<string, unknown> | null
    constructor(status: number, message: string, payload: Record<string, unknown> | null = null) {
      super(message)
      this.name = 'ApiError'
      this.status = status
      this.payload = payload
    }
  },
}))

const mockAuth = vi.hoisted(() => ({ role: 'ADMIN' as string }))
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ user: { role: mockAuth.role } }),
}))

import { ApiError } from '../../lib/api'
import { ThirdPartySection } from './ThirdPartySection'

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <ThirdPartySection />
      </QueryClientProvider>,
    ),
  }
}

describe('ThirdPartySection', () => {
  it('cria um convite com as features marcadas', async () => {
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/admin/sectors') {
        return {
          sectors: [
            { id: 'sector-dev-produto', name: 'Desenvolvimento de Produto', slug: 'desenvolvimento-de-produto', active: true, enabledFeatures: [], roles: [] },
          ],
        }
      }
      if (path === '/admin/third-party-users') return { users: [] }
      if (path === '/admin/third-party-invites') return { invites: [] }
      throw new Error(`unexpected ${path}`)
    })
    renderSection()

    await waitFor(() => expect(screen.getByText(/convidar terceirizado/i)).toBeInTheDocument())
    fireEvent.click(screen.getByText(/convidar terceirizado/i))
    fireEvent.click(screen.getByLabelText('Escritório'))

    apiFetchMock.mockImplementationOnce(async () => ({
      invite: {
        id: '1',
        url: 'https://x/terceirizado/convite/abc',
        enabledFeatures: ['escritorio'],
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        createdAt: new Date().toISOString(),
        usedAt: null,
        revokedAt: null,
      },
    }))
    fireEvent.click(screen.getByRole('button', { name: /gerar convite/i }))

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/admin/third-party-invites',
        expect.objectContaining({ method: 'POST' }),
      ),
    )

    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    fireEvent.click(await screen.findByRole('button', { name: /copiar link/i }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://x/terceirizado/convite/abc'))
    await waitFor(() => expect(screen.getByRole('button', { name: /copiado/i })).toBeInTheDocument())
  })

  function member(over: Partial<AdminUserDTO> = {}): AdminUserDTO {
    return {
      id: 'u1',
      name: 'Fulano Terceirizado',
      email: 'fulano@example.com',
      role: 'THIRD_PARTY',
      managerId: null,
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
      teamsWebhookUrl: null,
      birthDate: null,
      sectorId: 'sector-dev-produto',
      companyId: 'company-emr',
      companyName: null,
      enabledFeatures: [],
      sectorFeatures: [],
      adminAccess: false,
      ...over,
    }
  }

  it('mostra erro e mantém a linha em edição quando salvar falha', async () => {
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/admin/sectors') {
        return {
          sectors: [
            { id: 'sector-dev-produto', name: 'Desenvolvimento de Produto', slug: 'desenvolvimento-de-produto', active: true, enabledFeatures: [], roles: [] },
          ],
        }
      }
      if (path === '/admin/third-party-users') return { users: [member()] }
      if (path === '/admin/third-party-invites') return { invites: [] }
      throw new Error(`unexpected ${path}`)
    })
    renderSection()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    fireEvent.click(screen.getByLabelText('Escritório'))

    apiFetchMock.mockImplementationOnce(async () => {
      throw new ApiError(500, 'Erro ao salvar.')
    })
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Erro ao salvar.'))
    expect(screen.getByRole('button', { name: /salvar/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancelar/i })).toBeInTheDocument()
  })

  it('edita nome, cargo, área e features de um terceirizado — mesmos campos de uma Lenda', async () => {
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/admin/sectors') {
        return {
          sectors: [
            { id: 'sector-dev-produto', name: 'Desenvolvimento de Produto', slug: 'desenvolvimento-de-produto', active: true, enabledFeatures: [], roles: [] },
          ],
        }
      }
      if (path === '/admin/third-party-users') return { users: [member()] }
      if (path === '/admin/third-party-invites') return { invites: [] }
      throw new Error(`unexpected ${path}`)
    })
    renderSection()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))

    fireEvent.change(screen.getByLabelText('Nome do terceirizado'), { target: { value: 'Diego Barreto' } })
    fireEvent.change(screen.getByLabelText('Cargo do terceirizado'), { target: { value: 'PM' } })
    fireEvent.click(screen.getByLabelText('Área do terceirizado'))
    fireEvent.click(screen.getByRole('option', { name: 'Produto' }))
    fireEvent.click(screen.getByLabelText('Escritório'))

    apiFetchMock.mockImplementationOnce(async () => ({ user: member({ name: 'Diego Barreto', area: 'PRODUCT' }) }))
    fireEvent.click(screen.getByRole('button', { name: /salvar/i }))

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/admin/users/u1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            name: 'Diego Barreto',
            email: 'fulano@example.com',
            position: 'PM',
            squad: '',
            joinedAt: '2026-01-01',
            area: 'PRODUCT',
            sectorId: 'sector-dev-produto',
            teamsWebhookUrl: null,
            enabledFeatures: ['escritorio'],
          }),
        }),
      ),
    )
  })

  it('mostra erro quando revogar convite falha', async () => {
    const invite: ThirdPartyInviteDTO = {
      id: 'inv1',
      url: null,
      enabledFeatures: [],
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      createdAt: new Date().toISOString(),
      usedAt: null,
      revokedAt: null,
    } as unknown as ThirdPartyInviteDTO

    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/admin/sectors') {
        return {
          sectors: [
            { id: 'sector-dev-produto', name: 'Desenvolvimento de Produto', slug: 'desenvolvimento-de-produto', active: true, enabledFeatures: [], roles: [] },
          ],
        }
      }
      if (path === '/admin/third-party-users') return { users: [] }
      if (path === '/admin/third-party-invites') return { invites: [invite] }
      throw new Error(`unexpected ${path}`)
    })
    renderSection()

    await waitFor(() => expect(screen.getByRole('button', { name: /revogar/i })).toBeInTheDocument())

    apiFetchMock.mockImplementationOnce(async () => {
      throw new ApiError(500, 'Erro ao revogar convite.')
    })
    fireEvent.click(screen.getByRole('button', { name: /revogar/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Erro ao revogar convite.'))
  })

  it('permite excluir um convite pendente (com confirmação) e mostra erro se a exclusão falhar', async () => {
    const pending: ThirdPartyInviteDTO = {
      id: 'inv2',
      url: null,
      enabledFeatures: [],
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      createdAt: new Date().toISOString(),
      usedAt: null,
      revokedAt: null,
    } as unknown as ThirdPartyInviteDTO

    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/admin/sectors') {
        return {
          sectors: [
            { id: 'sector-dev-produto', name: 'Desenvolvimento de Produto', slug: 'desenvolvimento-de-produto', active: true, enabledFeatures: [], roles: [] },
          ],
        }
      }
      if (path === '/admin/third-party-users') return { users: [] }
      if (path === '/admin/third-party-invites') return { invites: [pending] }
      throw new Error(`unexpected ${path}`)
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderSection()

    await waitFor(() => expect(screen.getByRole('button', { name: /excluir/i })).toBeInTheDocument())

    apiFetchMock.mockImplementationOnce(async () => {
      throw new ApiError(500, 'Erro ao excluir convite.')
    })
    fireEvent.click(screen.getByRole('button', { name: /excluir/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Erro ao excluir convite.'))

    apiFetchMock.mockImplementationOnce(async () => ({}))
    fireEvent.click(screen.getByRole('button', { name: /excluir/i }))

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith('/admin/third-party-invites/inv2', { method: 'DELETE' }),
    )
  })

  it('não exclui o convite se a confirmação for cancelada', async () => {
    const pending: ThirdPartyInviteDTO = {
      id: 'inv3',
      url: null,
      enabledFeatures: [],
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      createdAt: new Date().toISOString(),
      usedAt: null,
      revokedAt: null,
    } as unknown as ThirdPartyInviteDTO

    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/admin/sectors') {
        return {
          sectors: [
            { id: 'sector-dev-produto', name: 'Desenvolvimento de Produto', slug: 'desenvolvimento-de-produto', active: true, enabledFeatures: [], roles: [] },
          ],
        }
      }
      if (path === '/admin/third-party-users') return { users: [] }
      if (path === '/admin/third-party-invites') return { invites: [pending] }
      throw new Error(`unexpected ${path}`)
    })
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderSection()

    await waitFor(() => expect(screen.getByRole('button', { name: /excluir/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /excluir/i }))

    expect(apiFetchMock).not.toHaveBeenCalledWith('/admin/third-party-invites/inv3', { method: 'DELETE' })
  })

  it('permite desativar e reativar uma conta de terceirizado, mostrando erro se falhar', async () => {
    const inactivable = member({ id: 'u2', name: 'Ciclana Terceirizada', email: 'ciclana@example.com' })

    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/admin/sectors') {
        return {
          sectors: [
            { id: 'sector-dev-produto', name: 'Desenvolvimento de Produto', slug: 'desenvolvimento-de-produto', active: true, enabledFeatures: [], roles: [] },
          ],
        }
      }
      if (path === '/admin/third-party-users') return { users: [inactivable] }
      if (path === '/admin/third-party-invites') return { invites: [] }
      throw new Error(`unexpected ${path}`)
    })
    renderSection()

    await waitFor(() => expect(screen.getByRole('button', { name: /desativar/i })).toBeInTheDocument())

    apiFetchMock.mockImplementationOnce(async () => {
      throw new ApiError(500, 'Erro ao atualizar conta.')
    })
    fireEvent.click(screen.getByRole('button', { name: /desativar/i }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Erro ao atualizar conta.'))

    apiFetchMock.mockImplementationOnce(async () => ({ user: { ...inactivable, active: false } }))
    fireEvent.click(screen.getByRole('button', { name: /desativar/i }))

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        '/admin/users/u2',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ active: false }) }),
      ),
    )
  })
})

describe('ThirdPartySection — Subadmin', () => {
  beforeEach(() => {
    mockAuth.role = 'SUBADMIN'
  })

  it('esconde o seletor de setor por linha quando logado como Subadmin', async () => {
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === '/admin/sectors') {
        return {
          sectors: [
            { id: 'sector-dev-produto', name: 'Desenvolvimento de Produto', slug: 'desenvolvimento-de-produto', active: true, enabledFeatures: [], roles: [] },
          ],
        }
      }
      if (path === '/admin/third-party-users') {
        return {
          users: [
            {
              id: 'u1',
              name: 'Fulano Terceirizado',
              email: 'fulano@example.com',
              position: null,
              squad: null,
              photoUrl: null,
              avatarStyle: null,
              avatarSeed: null,
              avatarOptions: null,
              active: true,
              joinedAt: '2026-01-01T00:00:00.000Z',
              leftAt: null,
              teamsWebhookUrl: null,
              sectorId: 'sector-dev-produto',
              enabledFeatures: [],
              sectorFeatures: [],
            },
          ],
        }
      }
      if (path === '/admin/third-party-invites') return { invites: [] }
      throw new Error(`unexpected ${path}`)
    })
    renderSection()

    await waitFor(() => expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Editar' }))
    expect(screen.queryByLabelText('Setor do terceirizado')).not.toBeInTheDocument()
  })
})

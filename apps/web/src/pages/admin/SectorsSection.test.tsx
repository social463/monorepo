import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SectorsSection } from './SectorsSection'
import * as api from '../../lib/api'
import { ApiError } from '../../lib/api'

const HEAD_USER = {
  id: 'head-1',
  name: 'Ana Head',
  email: 'ana@empresa.com',
  role: 'HEAD' as const,
  area: null,
  position: 'Head de Engenharia',
  squad: null,
  photoUrl: null,
  avatarStyle: null,
  avatarSeed: null,
  avatarOptions: null,
  active: true,
  joinedAt: '2026-01-01T00:00:00.000Z',
  leftAt: null,
  sectorId: 'sector-dev-produto',
  companyId: 'company-emr',
  companyName: 'Empresa',
  enabledFeatures: [],
  sectorFeatures: [],
  teamsWebhookUrl: null,
}
const MANAGER_USER = {
  ...HEAD_USER,
  id: 'manager-1',
  name: 'Bruno Manager',
  email: 'bruno@empresa.com',
  role: 'MANAGER' as const,
  position: 'Gerente de Engenharia',
}

function renderWithClient() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <SectorsSection />
    </QueryClientProvider>,
  )
}

describe('SectorsSection', () => {
  beforeEach(() => {
    vi.spyOn(api, 'apiFetch').mockImplementation(async (url: string) => {
      if (url === '/admin/sectors') {
        return {
          sectors: [
            { id: 'sector-dev-produto', name: 'Desenvolvimento de Produto', slug: 'desenvolvimento-de-produto', active: true, responsibleId: null, enabledFeatures: ['escritorio', 'votar'], roles: ['LEGEND', 'LEAD'] },
          ],
        }
      }
      if (url === '/admin/users') return { users: [HEAD_USER, MANAGER_USER] }
      if (url === '/admin/organization-settings') return { settings: { companyResponsibleIds: [] } }
      throw new Error(`unexpected url ${url}`)
    })
  })

  it('lista os setores existentes com suas features e papéis', async () => {
    renderWithClient()
    await waitFor(() => expect(screen.getByText('Desenvolvimento de Produto')).toBeInTheDocument())
    expect(screen.getByLabelText('Escritório')).toBeChecked()
    expect(screen.getByLabelText('Lenda')).toBeChecked()
  })

  it('separa funcionalidade, administração de área e papel em grupos nomeados', async () => {
    renderWithClient()
    await waitFor(() => expect(screen.getAllByText('Funcionalidades do colaborador').length).toBeGreaterThan(0))

    // Cada grupo é um fieldset com legenda própria — sem isso as três listas
    // viravam um paredão único de caixas.
    const grupo = (nome: string) =>
      screen.getAllByRole('group', { name: new RegExp(nome, 'i') })[0]

    const funcionalidades = grupo('Funcionalidades do colaborador')
    const administracao = grupo('Administração de áreas')
    const papeis = grupo('Papéis do setor')

    // Funcionalidade fica só no primeiro grupo…
    expect(within(funcionalidades).getByLabelText('Escritório')).toBeInTheDocument()
    expect(within(administracao).queryByLabelText('Escritório')).not.toBeInTheDocument()
    // …bloco administrativo só no segundo…
    expect(within(administracao).getByLabelText('Administrar Gente e Gestão')).toBeInTheDocument()
    expect(within(funcionalidades).queryByLabelText('Administrar Gente e Gestão')).not.toBeInTheDocument()
    // …e papel só no terceiro.
    expect(within(papeis).getByLabelText('Lenda')).toBeInTheDocument()
    expect(within(funcionalidades).queryByLabelText('Lenda')).not.toBeInTheDocument()
  })

  it('no card do setor as caixas são informativas, não editáveis', async () => {
    renderWithClient()
    await waitFor(() => expect(screen.getByText('Desenvolvimento de Produto')).toBeInTheDocument())
    expect(screen.getByLabelText('Escritório')).toBeDisabled()
  })

  it('abre o formulário de criação ao clicar em "+ Adicionar setor"', async () => {
    renderWithClient()
    await waitFor(() => expect(screen.getByText('Desenvolvimento de Produto')).toBeInTheDocument())
    await userEvent.click(screen.getByText('+ Adicionar setor'))
    expect(screen.getByLabelText('Nome do novo setor')).toBeInTheDocument()
  })

  it('mostra erro visível quando desativar/ativar um setor falha (PATCH)', async () => {
    vi.spyOn(api, 'apiFetch').mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/admin/sectors') {
        return {
          sectors: [
            { id: 'sector-dev-produto', name: 'Desenvolvimento de Produto', slug: 'desenvolvimento-de-produto', active: true, responsibleId: null, enabledFeatures: ['escritorio', 'votar'], roles: ['LEGEND', 'LEAD'] },
          ],
        }
      }
      if (url === '/admin/users') return { users: [HEAD_USER, MANAGER_USER] }
      if (url === '/admin/organization-settings') return { settings: { companyResponsibleIds: [] } }
      if (url === '/admin/sectors/sector-dev-produto' && init?.method === 'PATCH') {
        throw new ApiError(409, 'Já existe um setor com esse nome.')
      }
      throw new Error(`unexpected url ${url}`)
    })
    renderWithClient()
    await waitFor(() => expect(screen.getByText('Desenvolvimento de Produto')).toBeInTheDocument())
    await userEvent.click(screen.getByText('Desativar'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Já existe um setor com esse nome.')
  })

  it('configura responsáveis da empresa e do setor', async () => {
    let companyResponsibleIds: string[] = []
    const fetchSpy = vi.spyOn(api, 'apiFetch').mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/admin/sectors' && !init?.method) {
        return {
          sectors: [
            {
              id: 'sector-dev-produto',
              name: 'Desenvolvimento de Produto',
              slug: 'desenvolvimento-de-produto',
              active: true,
              responsibleId: null,
              enabledFeatures: ['escritorio', 'votar'],
              roles: ['LEGEND', 'LEAD'],
            },
          ],
        }
      }
      if (url === '/admin/users') return { users: [HEAD_USER, MANAGER_USER] }
      if (url === '/admin/organization-settings' && !init?.method) {
        return { settings: { companyResponsibleIds } }
      }
      if (url === '/admin/organization-settings' && init?.method === 'PATCH') {
        companyResponsibleIds = JSON.parse(String(init.body)).companyResponsibleIds
        return { settings: { companyResponsibleIds } }
      }
      if (url === '/admin/sectors/sector-dev-produto' && init?.method === 'PATCH') {
        return {
          sector: {
            id: 'sector-dev-produto',
            name: 'Desenvolvimento de Produto',
            slug: 'desenvolvimento-de-produto',
            active: true,
            responsibleId: JSON.parse(String(init.body)).responsibleId,
            enabledFeatures: ['escritorio', 'votar'],
            roles: ['LEGEND', 'LEAD'],
          },
        }
      }
      throw new Error(`unexpected url ${url}`)
    })

    renderWithClient()
    await waitFor(() => expect(screen.getByText('Desenvolvimento de Produto')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('checkbox', { name: 'Selecionar Ana Head como responsável pela empresa' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Selecionar Bruno Manager como responsável pela empresa' }))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar responsáveis' }))
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(
      '/admin/organization-settings',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ companyResponsibleIds: ['head-1', 'manager-1'] }),
      }),
    ))

    await userEvent.click(screen.getByText('Editar'))
    await userEvent.click(screen.getByRole('combobox', { name: 'Responsável pelo setor Desenvolvimento de Produto' }))
    await userEvent.click(screen.getByRole('option', { name: /Ana Head/ }))
    await userEvent.click(screen.getByText('Salvar'))
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(
      '/admin/sectors/sector-dev-produto',
      expect.objectContaining({
        method: 'PATCH',
        body: expect.stringContaining('"responsibleId":"head-1"'),
      }),
    ))
  })
})

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { CertificatesSection } from './CertificatesSection'
import * as learningApi from '../../lib/learning-api'
import { useAuth } from '../../auth/AuthContext'

vi.mock('../../lib/learning-api', () => ({
  listCertificateTemplates: vi.fn(),
  deleteCertificateTemplate: vi.fn(),
  createCertificateTemplate: vi.fn(),
  updateCertificateTemplate: vi.fn(),
  listCertificateRequests: vi.fn(),
  approveCertificateRequest: vi.fn(),
  rejectCertificateRequest: vi.fn(),
}))

vi.mock('../../auth/AuthContext', () => ({ useAuth: vi.fn() }))

const mockUseAuth = useAuth as unknown as Mock
const mockTemplates = learningApi.listCertificateTemplates as unknown as Mock
const mockRequests = learningApi.listCertificateRequests as unknown as Mock

function comoUsuario(role: string, adminAccess = false) {
  mockUseAuth.mockReturnValue({ user: { id: 'u1', role, adminAccess } })
}

function renderSection(rota = '/admin/certificados') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[rota]}>
        <CertificatesSection />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockTemplates.mockResolvedValue({ templates: [] })
  mockRequests.mockResolvedValue({ requests: [] })
})

describe('CertificatesSection — certificados num lugar só', () => {
  it('abre na fila, que é a tela de trabalho', async () => {
    comoUsuario('ADMIN')
    renderSection()

    expect(await screen.findByRole('tab', { name: /fila de certificados/i })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('tab', { name: /modelos/i })).toHaveAttribute('aria-selected', 'false')
  })

  it('o ADMIN troca para os modelos pela aba', async () => {
    const user = userEvent.setup()
    comoUsuario('ADMIN')
    renderSection()

    await user.click(await screen.findByRole('tab', { name: /modelos/i }))
    expect(screen.getByRole('tab', { name: /modelos/i })).toHaveAttribute('aria-selected', 'true')
    expect(mockTemplates).toHaveBeenCalled()
  })

  it('a rota antiga de modelos abre direto na aba certa', async () => {
    comoUsuario('ADMIN')
    renderSection('/admin/certificados?aba=modelos')

    expect(await screen.findByRole('tab', { name: /modelos/i })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  // O ponto delicado da unificação: o gate que protegia a ROTA de modelos virou
  // gate da ABA. Sem isso, juntar as páginas ou trancaria o subadmin fora da
  // fila que ele usa todo dia, ou mostraria os modelos para quem a API recusa.
  it('o SUBADMIN de G&G entra na fila e não enxerga a aba de modelos', async () => {
    comoUsuario('SUBADMIN')
    renderSection()

    expect(await screen.findByRole('heading', { level: 2, name: 'Certificados' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /modelos/i })).not.toBeInTheDocument()
    expect(mockRequests).toHaveBeenCalled()
    expect(mockTemplates).not.toHaveBeenCalled()
  })

  it('o SUBADMIN que abre o link antigo de modelos cai na fila, sem erro', async () => {
    comoUsuario('SUBADMIN')
    renderSection('/admin/certificados?aba=modelos')

    expect(await screen.findByRole('heading', { level: 2, name: 'Certificados' })).toBeInTheDocument()
    expect(mockTemplates).not.toHaveBeenCalled()
    expect(mockRequests).toHaveBeenCalled()
  })

  it('o admin delegado conta como admin pleno e vê os modelos', async () => {
    comoUsuario('LEGEND', true)
    renderSection()

    expect(await screen.findByRole('tab', { name: /modelos/i })).toBeInTheDocument()
  })
})

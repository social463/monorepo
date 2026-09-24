import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, type Mock } from 'vitest'
import type { CertificateRequestDTO } from '@legends/shared'
import { CertificateRequestsSection } from './CertificateRequestsSection'
import { ApiError } from '../../lib/api'
import * as learningApi from '../../lib/learning-api'

vi.mock('../../lib/learning-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/learning-api')>()
  return {
    ...actual,
    listCertificateRequests: vi.fn(),
    approveCertificateRequest: vi.fn(),
    rejectCertificateRequest: vi.fn(),
  }
})

const mockList = learningApi.listCertificateRequests as unknown as Mock
const mockApprove = learningApi.approveCertificateRequest as unknown as Mock
const mockReject = learningApi.rejectCertificateRequest as unknown as Mock

function buildRequest(overrides: Partial<CertificateRequestDTO> = {}): CertificateRequestDTO {
  return {
    id: 'req-1',
    origin: 'INTERNAL',
    enrollmentId: 'enroll-1',
    courseId: 'course-1',
    courseTitle: 'Liderança situacional',
    userId: 'user-1',
    userName: 'Fulano de Tal',
    status: 'PENDING',
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
    createdAt: '2026-07-01T12:00:00.000Z',
    ...overrides,
  }
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CertificateRequestsSection />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CertificateRequestsSection — listagem e filtro', () => {
  it('carrega a fila filtrando por Pendente por padrão', async () => {
    mockList.mockResolvedValue({ requests: [buildRequest()] })
    renderSection()

    expect(await screen.findByText('Fulano de Tal')).toBeInTheDocument()
    expect(screen.getByText('Liderança situacional')).toBeInTheDocument()
    await waitFor(() => expect(mockList).toHaveBeenCalledWith('PENDING'))
  })

  it('refaz a busca sem filtro ao selecionar "Todos"', async () => {
    mockList.mockResolvedValue({ requests: [] })
    renderSection()

    const select = await screen.findByRole('combobox', { name: 'Filtrar por status' })
    fireEvent.click(select)
    fireEvent.click(await screen.findByRole('option', { name: 'Todos' }))

    await waitFor(() => expect(mockList).toHaveBeenCalledWith(undefined))
  })

  it('refaz a busca com o status escolhido', async () => {
    mockList.mockResolvedValue({ requests: [] })
    renderSection()

    const select = await screen.findByRole('combobox', { name: 'Filtrar por status' })
    fireEvent.click(select)
    fireEvent.click(await screen.findByRole('option', { name: 'Aprovado' }))

    await waitFor(() => expect(mockList).toHaveBeenCalledWith('APPROVED'))
  })

  it('mostra mensagem quando não há solicitações', async () => {
    mockList.mockResolvedValue({ requests: [] })
    renderSection()

    expect(await screen.findByText(/Nenhuma solicitação/)).toBeInTheDocument()
  })
})

describe('CertificateRequestsSection — aprovação', () => {
  it('aprova uma solicitação pendente', async () => {
    mockList.mockResolvedValue({ requests: [buildRequest()] })
    mockApprove.mockResolvedValue({ request: buildRequest({ status: 'APPROVED' }), certificate: {} })
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: 'Aprovar solicitação de Fulano de Tal' }))

    await waitFor(() => expect(mockApprove).toHaveBeenCalledWith('req-1'))
  })

  it('mostra a mensagem do servidor quando a aprovação falha com 409 mesmo numa linha pendente', async () => {
    mockList.mockResolvedValue({ requests: [buildRequest()] })
    mockApprove.mockRejectedValue(
      new ApiError(409, 'A inscrição não está mais concluída — a pessoa desmarcou uma aula depois do pedido.'),
    )
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: 'Aprovar solicitação de Fulano de Tal' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      'A inscrição não está mais concluída — a pessoa desmarcou uma aula depois do pedido.',
    )
  })

  it('não dispara uma segunda aprovação enquanto a primeira ainda está em voo', async () => {
    mockList.mockResolvedValue({ requests: [buildRequest()] })
    mockApprove.mockReturnValue(new Promise(() => {}))
    renderSection()

    const button = await screen.findByRole('button', { name: 'Aprovar solicitação de Fulano de Tal' })
    fireEvent.click(button)
    await waitFor(() => expect(button).toBeDisabled())
    fireEvent.click(button)

    expect(mockApprove).toHaveBeenCalledTimes(1)
  })
})

describe('CertificateRequestsSection — recusa', () => {
  it('mantém o botão de confirmar recusa desabilitado até digitar um motivo', async () => {
    mockList.mockResolvedValue({ requests: [buildRequest()] })
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: 'Recusar solicitação de Fulano de Tal' }))
    const confirm = screen.getByRole('button', { name: 'Confirmar recusa da solicitação de Fulano de Tal' })
    expect(confirm).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Motivo da recusa'), { target: { value: '   ' } })
    expect(confirm).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Motivo da recusa'), { target: { value: 'Curso incompleto' } })
    expect(confirm).not.toBeDisabled()
  })

  it('recusa enviando o motivo digitado', async () => {
    mockList.mockResolvedValue({ requests: [buildRequest()] })
    mockReject.mockResolvedValue({ request: buildRequest({ status: 'REJECTED' }) })
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: 'Recusar solicitação de Fulano de Tal' }))
    fireEvent.change(screen.getByLabelText('Motivo da recusa'), { target: { value: 'Curso incompleto' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar recusa da solicitação de Fulano de Tal' }))

    await waitFor(() => expect(mockReject).toHaveBeenCalledWith('req-1', 'Curso incompleto'))
  })

  it('mostra a mensagem do servidor quando a recusa falha com 409', async () => {
    mockList.mockResolvedValue({ requests: [buildRequest()] })
    mockReject.mockRejectedValue(new ApiError(409, 'Esta solicitação já foi avaliada.'))
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: 'Recusar solicitação de Fulano de Tal' }))
    fireEvent.change(screen.getByLabelText('Motivo da recusa'), { target: { value: 'Curso incompleto' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar recusa da solicitação de Fulano de Tal' }))

    expect(await screen.findByText('Esta solicitação já foi avaliada.')).toBeInTheDocument()
  })
})

describe('CertificateRequestsSection — histórico de recusa preservado', () => {
  it('mostra o aviso de recusa anterior numa solicitação pendente reaberta', async () => {
    mockList.mockResolvedValue({
      requests: [
        buildRequest({
          status: 'PENDING',
          rejectionReason: 'Faltou concluir o quiz final',
          reviewedBy: { id: 'rev-1', name: 'Beltrano' },
          reviewedAt: '2026-06-15T10:00:00.000Z',
        }),
      ],
    })
    renderSection()

    expect(await screen.findByText(/Faltou concluir o quiz final/)).toBeInTheDocument()
    expect(screen.getByText(/Beltrano/)).toBeInTheDocument()
    // A ação continua disponível: reabriu para PENDENTE, não é um estado final.
    expect(screen.getByRole('button', { name: 'Aprovar solicitação de Fulano de Tal' })).toBeInTheDocument()
  })

  it('não mostra aviso de recusa numa solicitação pendente que nunca foi recusada', async () => {
    mockList.mockResolvedValue({ requests: [buildRequest({ status: 'PENDING', rejectionReason: null })] })
    renderSection()

    await screen.findByText('Fulano de Tal')
    expect(screen.queryByText(/recusad/i)).not.toBeInTheDocument()
  })

  it('solicitação já aprovada mostra quem aprovou e não tem botões de ação', async () => {
    mockList.mockResolvedValue({
      requests: [
        buildRequest({
          status: 'APPROVED',
          reviewedBy: { id: 'rev-1', name: 'Beltrano' },
          reviewedAt: '2026-06-20T10:00:00.000Z',
        }),
      ],
    })
    renderSection()

    await screen.findByText('Fulano de Tal')
    expect(screen.getByText(/Beltrano/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Aprovar solicitação de Fulano de Tal' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Recusar solicitação de Fulano de Tal' })).not.toBeInTheDocument()
  })
})

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import type { TrainingRecordDTO } from '@legends/shared'
import { TrainingPage } from './TrainingPage'
import { createTrainingRecord, fetchMyTraining, fetchTrainingIdentity } from '../../lib/training-api'

vi.mock('../../lib/training-api', () => ({
  fetchMyTraining: vi.fn(),
  fetchTrainingIdentity: vi.fn(),
  createTrainingRecord: vi.fn(),
  updateTrainingRecord: vi.fn(),
  deleteTrainingRecord: vi.fn(),
}))

const mockMine = fetchMyTraining as unknown as Mock
const mockIdentity = fetchTrainingIdentity as unknown as Mock
const mockCreate = createTrainingRecord as unknown as Mock

function wrap(ui: ReactNode, entry = '/treinamentos') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

function record(overrides: Partial<TrainingRecordDTO> = {}): TrainingRecordDTO {
  return {
    id: 'rec-1',
    userId: 'u1',
    userName: 'Fulana de Tal',
    userPhotoUrl: null,
    sectorName: 'Operações',
    squad: 'Alfa',
    leaderName: 'Líder Lima',
    position: 'Analista de CRM',
    positionCategory: 'Analista',
    employmentType: 'CLT',
    eventId: null,
    eventName: null,
    courseTitle: 'Gestão de Produto na Prática',
    learningType: 'Curso',
    modality: 'Online gravado',
    trainingType: 'TECNICO',
    hours: 12.5,
    institution: 'PM3',
    sponsor: 'EMR',
    sponsorOther: null,
    investmentCents: 125_050,
    reasons: ['PDI'],
    priority: 'Média',
    requestDate: '2026-01-10',
    completionDate: '2026-03-20',
    participationStatus: 'Participou',
    source: 'Autoatendimento do colaborador',
    notes: null,
    certificateUrl: 'https://cdn.exemplo.com/assinada.pdf',
    hasCertificate: true,
    validationStatus: 'PENDING',
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
    year: 2026,
    quarter: 'T1',
    semester: '1º semestre',
    slaDays: 69,
    slaStatus: 'Dentro do SLA',
    createdAt: '2026-03-21T12:00:00.000Z',
    updatedAt: '2026-03-21T12:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIdentity.mockResolvedValue({
    userName: 'Fulana de Tal',
    sectorName: 'Operações',
    squad: 'Alfa',
    leaderName: 'Líder Lima',
    position: 'Analista de CRM',
    positionCategory: 'Analista',
    employmentType: 'CLT',
  })
})

describe('Meus treinamentos', () => {
  it('lista o registro com horas, investimento e situação', async () => {
    mockMine.mockResolvedValue({ records: [record()], yearHours: 12.5, yearTrainings: 1 })
    wrap(<TrainingPage />)

    expect(await screen.findByText('Gestão de Produto na Prática')).toBeInTheDocument()
    expect(screen.getByText('Em análise')).toBeInTheDocument()
    // Duas vezes: no resumo do ano, no topo, e na linha do próprio registro.
    expect(screen.getAllByText('12,5h')).toHaveLength(2)
    // Centavos viram moeda na tela; o valor é guardado inteiro para não arredondar.
    expect(screen.getByText(/1\.250,50/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /ver comprovante/i })).toHaveAttribute(
      'href',
      'https://cdn.exemplo.com/assinada.pdf',
    )
  })

  it('a recusa mostra o motivo, que é o que diz o que corrigir', async () => {
    mockMine.mockResolvedValue({
      records: [record({ validationStatus: 'REJECTED', rejectionReason: 'Certificado ilegível' })],
      yearHours: 0,
      yearTrainings: 0,
    })
    wrap(<TrainingPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('Certificado ilegível')
  })

  it('registro validado não oferece editar nem excluir', async () => {
    mockMine.mockResolvedValue({ records: [record({ validationStatus: 'APPROVED' })], yearHours: 12.5, yearTrainings: 1 })
    wrap(<TrainingPage />)

    await screen.findByText('Gestão de Produto na Prática')
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument()
  })

  it('sem registro nenhum, explica onde registrar', async () => {
    mockMine.mockResolvedValue({ records: [], yearHours: 0, yearTrainings: 0 })
    wrap(<TrainingPage />)

    expect(await screen.findByText(/ainda não registrou nenhum treinamento/i)).toBeInTheDocument()
  })
})

describe('formulário de registro', () => {
  it('mostra a identificação que vai ficar gravada no registro', async () => {
    mockMine.mockResolvedValue({ records: [], yearHours: 0, yearTrainings: 0 })
    wrap(<TrainingPage />, '/treinamentos?aba=registrar')

    expect(await screen.findByText('Líder Lima')).toBeInTheDocument()
    expect(screen.getByText('Operações')).toBeInTheDocument()
  })

  it('o valor investido só aparece quando quem pagou foi a empresa', async () => {
    mockMine.mockResolvedValue({ records: [], yearHours: 0, yearTrainings: 0 })
    wrap(<TrainingPage />, '/treinamentos?aba=registrar')

    await screen.findByText('Identificação')
    expect(screen.queryByLabelText(/valor investido/i)).not.toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText(/quem pagou/i), 'EMR')
    expect(screen.getByLabelText(/valor investido/i)).toBeInTheDocument()
  })

  it('cobra a data de conclusão antes de enviar', async () => {
    mockMine.mockResolvedValue({ records: [], yearHours: 0, yearTrainings: 0 })
    wrap(<TrainingPage />, '/treinamentos?aba=registrar')

    await userEvent.type(await screen.findByLabelText(/curso ou capacitação/i), 'Inglês para negócios')
    await userEvent.click(screen.getByRole('button', { name: /registrar treinamento/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('data de conclusão')
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('manda centavos, e não reais, no investimento', async () => {
    mockMine.mockResolvedValue({ records: [], yearHours: 0, yearTrainings: 0 })
    mockCreate.mockResolvedValue(record())
    wrap(<TrainingPage />, '/treinamentos?aba=registrar')

    await userEvent.type(await screen.findByLabelText(/curso ou capacitação/i), 'Inglês para negócios')
    await userEvent.type(screen.getByLabelText(/carga horária/i), '8')
    await userEvent.type(screen.getByLabelText(/data da conclusão/i), '2026-05-10')
    await userEvent.selectOptions(screen.getByLabelText(/quem pagou/i), 'EMR')
    await userEvent.type(screen.getByLabelText(/valor investido/i), '1250.5')
    await userEvent.click(screen.getByText('Faz parte do PDI'))
    await userEvent.click(screen.getByRole('button', { name: /registrar treinamento/i }))

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        courseTitle: 'Inglês para negócios',
        hours: 8,
        investmentCents: 125_050,
        reasons: ['PDI'],
        completionDate: '2026-05-10',
      }),
    )
  })

  it('não deixa escolher mais de dois motivos', async () => {
    mockMine.mockResolvedValue({ records: [], yearHours: 0, yearTrainings: 0 })
    mockCreate.mockResolvedValue(record())
    wrap(<TrainingPage />, '/treinamentos?aba=registrar')

    await userEvent.click(await screen.findByText('Faz parte do PDI'))
    await userEvent.click(screen.getByText(/Levantamento de necessidades/))
    await userEvent.click(screen.getByText('Obrigatório'))

    await userEvent.type(screen.getByLabelText(/curso ou capacitação/i), 'Curso X')
    await userEvent.type(screen.getByLabelText(/data da conclusão/i), '2026-05-10')
    await userEvent.selectOptions(screen.getByLabelText(/quem pagou/i), 'GRATUITO')
    await userEvent.click(screen.getByRole('button', { name: /registrar treinamento/i }))

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ reasons: ['PDI', 'LNT'] }))
  })
})

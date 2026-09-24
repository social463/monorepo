import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { TrainingDashboardDTO, TrainingRecordDTO } from '@legends/shared'
import { TrainingSection } from './TrainingSection'
import {
  deleteTrainingRecord,
  fetchTrainingDashboard,
  fetchTrainingFilterOptions,
  fetchTrainingRecords,
  reviewTrainingRecord,
  updateTrainingRecord,
} from '../../lib/training-api'

vi.mock('../../lib/training-api', () => ({
  fetchTrainingDashboard: vi.fn(),
  fetchTrainingFilterOptions: vi.fn(),
  fetchTrainingRecords: vi.fn(),
  reviewTrainingRecord: vi.fn(),
  updateTrainingRecord: vi.fn(),
  deleteTrainingRecord: vi.fn(),
  updateTrainingSla: vi.fn(),
  downloadTrainingCsv: vi.fn(),
}))

const mockDashboard = fetchTrainingDashboard as unknown as Mock
const mockOptions = fetchTrainingFilterOptions as unknown as Mock
const mockRecords = fetchTrainingRecords as unknown as Mock
const mockReview = reviewTrainingRecord as unknown as Mock
const mockUpdate = updateTrainingRecord as unknown as Mock
const mockDelete = deleteTrainingRecord as unknown as Mock

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

const DASHBOARD: TrainingDashboardDTO = {
  kpis: {
    trainings: 4,
    participations: 6,
    people: 3,
    hours: 42.5,
    avgHours: 14.17,
    investmentCents: 250_000,
    avgInvestmentCents: 83_333,
    pctConcluded: 100,
    pctPdi: 50,
    pctLnt: 16.7,
    pctMandatory: 0,
    avgSla: 45,
    pctInSla: 75,
    coverage: 30,
    totalCollaborators: 10,
  },
  monthly: [{ month: '2026-03', trainings: 4, hours: 42.5, investmentCents: 250_000 }],
  bySector: [{ name: 'Operações', value: 4 }],
  hoursBySector: [{ name: 'Operações', value: 42.5 }],
  investmentBySector: [{ name: 'Operações', value: 250_000 }],
  byLearningType: [{ name: 'Curso', value: 4 }],
  byInstitution: [{ name: 'PM3', value: 4 }],
  bySource: [{ name: 'Autoatendimento do colaborador', value: 4 }],
  byReason: [{ name: 'PDI', value: 4 }],
  byLeader: [{ name: 'Líder Lima', value: 4 }],
  byPositionCategory: [{ name: 'Analista', value: 4 }],
  sla: [
    { name: 'Dentro do SLA', value: 3 },
    { name: 'Fora do SLA', value: 1 },
    { name: 'Pendente', value: 0 },
  ],
  coverageBySector: [{ name: 'Operações', value: 30 }],
  slaDays: 90,
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
  mockDashboard.mockResolvedValue(DASHBOARD)
  mockOptions.mockResolvedValue({
    sectors: ['Operações'],
    squads: ['Alfa'],
    leaders: ['Líder Lima'],
    positionCategories: ['Analista'],
    institutions: ['PM3'],
    learningTypes: ['Curso'],
    years: [2026],
    events: [],
    slaDays: 90,
  })
  mockRecords.mockResolvedValue({ records: [record()], page: 1, pageCount: 1, total: 1, pending: 1 })
})

describe('painel de T&D', () => {
  it('mostra os indicadores e diz que eles contam só o validado', async () => {
    wrap(<TrainingSection />)

    expect(await screen.findByText('42,5h')).toBeInTheDocument()
    expect(screen.getByText('R$ 2.500,00')).toBeInTheDocument()
    expect(screen.getByText(/de 10 ativas/)).toBeInTheDocument()
    expect(screen.getByText(/meta de 90 dias/)).toBeInTheDocument()
    expect(screen.getByText(/já validou/)).toBeInTheDocument()
  })

  it('o filtro é o mesmo para o painel e para a Central', async () => {
    wrap(<TrainingSection />)
    await screen.findByText('42,5h')

    await userEvent.selectOptions(screen.getByLabelText('Setor'), 'Operações')

    expect(mockDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ sector: 'Operações' }))

    await userEvent.click(screen.getByRole('tab', { name: 'Central de Treinamentos' }))
    expect(mockRecords).toHaveBeenLastCalledWith(expect.objectContaining({ sector: 'Operações' }), 1)
  })
})

describe('Central de Treinamentos', () => {
  it('lista a linha com SLA, situação e comprovante', async () => {
    wrap(<TrainingSection />)
    await userEvent.click(await screen.findByRole('tab', { name: 'Central de Treinamentos' }))

    expect(await screen.findByText('Gestão de Produto na Prática')).toBeInTheDocument()
    expect(screen.getByText(/1 registro\(s\) · 1 aguardando/)).toBeInTheDocument()
    expect(screen.getByText('69 dias')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /comprovante/i })).toHaveAttribute(
      'href',
      'https://cdn.exemplo.com/assinada.pdf',
    )
  })

  it('validar manda o status, sem motivo', async () => {
    mockReview.mockResolvedValue(record({ validationStatus: 'APPROVED' }))
    wrap(<TrainingSection />)
    await userEvent.click(await screen.findByRole('tab', { name: 'Central de Treinamentos' }))

    await userEvent.click(await screen.findByRole('button', { name: 'Validar' }))
    expect(mockReview).toHaveBeenCalledWith('rec-1', { status: 'APPROVED' })
  })

  it('recusar só sai com motivo preenchido', async () => {
    mockReview.mockResolvedValue(record({ validationStatus: 'REJECTED' }))
    wrap(<TrainingSection />)
    await userEvent.click(await screen.findByRole('tab', { name: 'Central de Treinamentos' }))

    await userEvent.click(await screen.findByRole('button', { name: 'Recusar' }))
    const recusar = screen.getByRole('button', { name: 'Recusar' })
    expect(recusar).toBeDisabled()

    await userEvent.type(screen.getByPlaceholderText('Motivo da recusa'), 'Certificado ilegível')
    await userEvent.click(screen.getByRole('button', { name: 'Recusar' }))

    expect(mockReview).toHaveBeenCalledWith('rec-1', {
      status: 'REJECTED',
      rejectionReason: 'Certificado ilegível',
    })
  })
})

describe('correção de registro pelo T&D', () => {
  // O diálogo convive no DOM com a barra de filtros, e rótulos como "Quem
  // pagou" existem nos dois — toda busca aqui é escopada nele.
  async function abrirEdicao() {
    wrap(<TrainingSection />)
    await userEvent.click(await screen.findByRole('tab', { name: 'Central de Treinamentos' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    return within(screen.getByRole('dialog'))
  }

  it('abre com os valores atuais do registro', async () => {
    const dialogo = await abrirEdicao()

    expect(dialogo.getByLabelText('Treinamento')).toHaveValue('Gestão de Produto na Prática')
    expect(dialogo.getByLabelText(/carga horária/i)).toHaveValue(12.5)
    // O valor só aparece porque quem pagou foi a empresa.
    expect(dialogo.getByLabelText(/valor investido/i)).toHaveValue(1250.5)
  })

  it('corrige a carga horária do registro migrado, que veio com zero', async () => {
    mockUpdate.mockResolvedValue(record({ hours: 8 }))
    const dialogo = await abrirEdicao()

    await userEvent.clear(dialogo.getByLabelText(/carga horária/i))
    await userEvent.type(dialogo.getByLabelText(/carga horária/i), '8')
    await userEvent.click(dialogo.getByRole('button', { name: 'Salvar' }))

    expect(mockUpdate).toHaveBeenCalledWith('rec-1', expect.objectContaining({ hours: 8 }))
  })

  it('a participação só muda por aqui — e vai junto no PATCH', async () => {
    mockUpdate.mockResolvedValue(record())
    const dialogo = await abrirEdicao()

    await userEvent.selectOptions(dialogo.getByLabelText('Participação'), 'Ausente')
    await userEvent.click(dialogo.getByRole('button', { name: 'Salvar' }))

    expect(mockUpdate).toHaveBeenCalledWith('rec-1', expect.objectContaining({ participationStatus: 'Ausente' }))
  })

  it('trocar o patrocinador para gratuito zera o investimento', async () => {
    mockUpdate.mockResolvedValue(record())
    const dialogo = await abrirEdicao()

    await userEvent.selectOptions(dialogo.getByLabelText(/quem pagou/i), 'GRATUITO')
    expect(dialogo.queryByLabelText(/valor investido/i)).not.toBeInTheDocument()

    await userEvent.click(dialogo.getByRole('button', { name: 'Salvar' }))
    expect(mockUpdate).toHaveBeenCalledWith('rec-1', expect.objectContaining({ investmentCents: null }))
  })

  it('excluir pede confirmação antes de chamar a API', async () => {
    mockDelete.mockResolvedValue(undefined)
    wrap(<TrainingSection />)
    await userEvent.click(await screen.findByRole('tab', { name: 'Central de Treinamentos' }))

    await userEvent.click(await screen.findByRole('button', { name: 'Excluir' }))
    expect(mockDelete).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Sim' }))
    expect(mockDelete).toHaveBeenCalledWith('rec-1')
  })
})

describe('filtros', () => {
  it('os secundários ficam atrás de "Mais filtros" e recortam os dois lados', async () => {
    wrap(<TrainingSection />)
    await screen.findByText('42,5h')

    expect(screen.queryByLabelText('Liderança')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /mais filtros/i }))
    await userEvent.selectOptions(screen.getByLabelText('Liderança'), 'Líder Lima')

    expect(mockDashboard).toHaveBeenLastCalledWith(expect.objectContaining({ leader: 'Líder Lima' }))
  })

  it('seletor sem opção nenhuma não aparece', async () => {
    // `events: []` nas opções — o filtro de evento seria um caminho que só
    // leva a tela vazia.
    wrap(<TrainingSection />)
    await screen.findByText('42,5h')
    await userEvent.click(screen.getByRole('button', { name: /mais filtros/i }))

    expect(screen.queryByLabelText('Evento')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Squad')).toBeInTheDocument()
  })

  it('"Limpar" mostra quantos filtros estão ativos e zera todos', async () => {
    wrap(<TrainingSection />)
    await screen.findByText('42,5h')

    await userEvent.selectOptions(screen.getByLabelText('Setor'), 'Operações')
    await userEvent.click(screen.getByRole('button', { name: /limpar \(1\)/i }))

    expect(mockDashboard).toHaveBeenLastCalledWith({})
  })
})

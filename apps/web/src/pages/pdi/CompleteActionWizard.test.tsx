import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import type { PdiActionDTO } from '@legends/shared'
import { CompleteActionWizard } from './CompleteActionWizard'
import { completePdiAction, getPdiEvidenceConfig } from '../../lib/pdi-api'

vi.mock('../../lib/pdi-api', () => ({
  completePdiAction: vi.fn(),
  getPdiEvidenceConfig: vi.fn(),
  uploadPdiEvidence: vi.fn(),
}))

const mockComplete = completePdiAction as unknown as Mock
const mockConfig = getPdiEvidenceConfig as unknown as Mock

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

const ACTION: PdiActionDTO = {
  id: 'action-1',
  planId: 'plan-1',
  description: 'Concluir o curso de liderança',
  type: 'COURSE',
  priority: 'HIGH',
  status: 'IN_PROGRESS',
  dueDate: null,
  progressPct: 60,
  competency: 'Liderança',
  notes: null,
  checklist: [],
  reflection: null,
  practicalApplication: null,
  submittedForReviewAt: null,
  reviewedAt: null,
  reviewedBy: null,
  reviewComment: null,
  completedAt: null,
  evidences: [],
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
}

describe('CompleteActionWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConfig.mockResolvedValue({ enabled: false, maxBytes: 1, allowedContentTypes: [] })
    mockComplete.mockResolvedValue({ action: ACTION, awaitingReview: true })
  })

  it('não deixa avançar sem ao menos uma evidência da conclusão', async () => {
    wrap(<CompleteActionWizard action={ACTION} leaderRequired onClose={() => {}} />)

    expect(await screen.findByText('Comprovante da conclusão')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Próximo' })).toBeDisabled()
  })

  it('libera o avanço depois de adicionar um link como evidência', async () => {
    const user = userEvent.setup()
    wrap(<CompleteActionWizard action={ACTION} leaderRequired onClose={() => {}} />)

    await user.type(await screen.findByPlaceholderText('https://…'), 'https://exemplo.com/certificado')
    await user.click(screen.getByRole('button', { name: 'Adicionar link' }))

    expect(screen.getByText('https://exemplo.com/certificado')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Próximo' })).toBeEnabled()
  })

  it('percorre o fluxo e envia para validação quando o líder é exigido', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    wrap(<CompleteActionWizard action={ACTION} leaderRequired onClose={onClose} />)

    await user.type(await screen.findByPlaceholderText('https://…'), 'https://exemplo.com/certificado')
    await user.click(screen.getByRole('button', { name: 'Adicionar link' }))
    await user.click(screen.getByRole('button', { name: 'Próximo' }))

    await user.type(
      screen.getByLabelText('Como você aplicou (ou aplicará) esse aprendizado no dia a dia?'),
      'Levei o combinado para o 1:1 do time.',
    )
    await user.click(screen.getByRole('button', { name: 'Próximo' }))

    // A primeira pergunta da reflexão é obrigatória.
    expect(screen.getByRole('button', { name: 'Próximo' })).toBeDisabled()
    await user.type(
      screen.getByLabelText(/Qual foi o principal aprendizado desta ação\?/),
      'Feedback precisa de fato, não de rótulo.',
    )
    await user.click(screen.getByRole('button', { name: 'Próximo' }))

    expect(screen.getByText('Ao enviar, a ação vai para a validação do seu líder.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Enviar para validação' }))

    await waitFor(() => expect(mockComplete).toHaveBeenCalledTimes(1))
    expect(mockComplete).toHaveBeenCalledWith('action-1', {
      practicalApplication: 'Levei o combinado para o 1:1 do time.',
      reflection: { mainLearning: 'Feedback precisa de fato, não de rótulo.' },
      evidences: [{ kind: 'COMPLETION', externalUrl: 'https://exemplo.com/certificado' }],
    })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('mostra o texto de conclusão direta quando o líder não é exigido', async () => {
    const user = userEvent.setup()
    wrap(<CompleteActionWizard action={ACTION} leaderRequired={false} onClose={() => {}} />)

    await user.type(await screen.findByPlaceholderText('https://…'), 'https://exemplo.com/certificado')
    await user.click(screen.getByRole('button', { name: 'Adicionar link' }))
    await user.click(screen.getByRole('button', { name: 'Próximo' }))
    await user.type(
      screen.getByLabelText('Como você aplicou (ou aplicará) esse aprendizado no dia a dia?'),
      'Automatizei a planilha do setor.',
    )
    await user.click(screen.getByRole('button', { name: 'Próximo' }))
    await user.type(
      screen.getByLabelText(/Qual foi o principal aprendizado desta ação\?/),
      'Dá para automatizar mais do que eu imaginava.',
    )
    await user.click(screen.getByRole('button', { name: 'Próximo' }))

    expect(screen.getByText('Ao enviar, a ação será concluída na hora.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Concluir ação' })).toBeInTheDocument()
  })
})

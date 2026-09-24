import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import type { CultureOnboardingKitResponse } from '@legends/shared'
import { OnboardingMaterialsCard } from './OnboardingMaterialsCard'
import { apiFetch } from '../../lib/api'

vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api')
  return { ...actual, apiFetch: vi.fn() }
})

const mockApiFetch = apiFetch as unknown as Mock

function fixture(patch: Partial<CultureOnboardingKitResponse> = {}): CultureOnboardingKitResponse {
  return {
    active: true,
    endsAt: '2026-12-01T00:00:00.000Z',
    daysLeft: 80,
    assets: [
      {
        id: 'a1',
        title: 'Plano de 90 dias',
        description: 'O que se espera de você no primeiro trimestre.',
        kind: 'DOCUMENT',
        fileName: 'plano-90-dias.pdf',
        fileSize: 240_000,
        previewUrl: null,
        downloadPath: '/culture/personal-assets/a1/download',
        createdAt: '2026-09-01T12:00:00.000Z',
      },
    ],
    ...patch,
  }
}

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <OnboardingMaterialsCard />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('OnboardingMaterialsCard', () => {
  beforeEach(() => {
    mockApiFetch.mockReset()
  })

  it('lista o material da chegada, os dias que faltam e o caminho depois disso', async () => {
    mockApiFetch.mockResolvedValue(fixture())
    renderCard()

    expect(await screen.findByText('Plano de 90 dias')).toBeInTheDocument()
    expect(screen.getByText(/Em destaque aqui por mais 80 dias/)).toBeInTheDocument()
    // O texto precisa dizer que nada se perde quando a seção sumir — senão o
    // card vira contagem regressiva em cima de arquivo que continua existindo.
    expect(screen.getByRole('link', { name: /Kit visual/ })).toHaveAttribute(
      'href',
      '/cultura?aba=kit-visual',
    )
    expect(screen.getByText(/plano-90-dias\.pdf/)).toBeInTheDocument()
  })

  /**
   * Com "Kit Onboarding" repetido em todas as linhas, o ícone genérico não
   * dizia qual era a assinatura de e-mail e qual era o banner. A miniatura é o
   * que distingue um material do outro sem abrir nada.
   */
  it('mostra a miniatura do material de imagem', async () => {
    mockApiFetch.mockResolvedValue(
      fixture({
        assets: [
          {
            id: 'a2',
            title: 'Kit Onboarding',
            description: null,
            kind: 'IMAGE',
            fileName: 'assinatura-do-email.png',
            fileSize: 357_000,
            previewUrl: 'https://s3.exemplo/assinatura.png?assinado',
            downloadPath: '/culture/personal-assets/a2/download',
            createdAt: '2026-09-01T12:00:00.000Z',
          },
        ],
      }),
    )
    const { container } = renderCard()

    await screen.findByText('Kit Onboarding')
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      'https://s3.exemplo/assinatura.png?assinado',
    )
  })

  // O `previewUrl` é assinado e cai junto com o storage; documento nunca tem um.
  // Nos dois casos sobra o ícone, e o download continua de pé.
  it('sem link assinado, cai no ícone e mantém o download', async () => {
    mockApiFetch.mockResolvedValue(
      fixture({
        assets: [
          {
            id: 'a3',
            title: 'Kit Onboarding',
            description: null,
            kind: 'IMAGE',
            fileName: 'banner.png',
            fileSize: 144_000,
            previewUrl: null,
            downloadPath: '/culture/personal-assets/a3/download',
            createdAt: '2026-09-01T12:00:00.000Z',
          },
        ],
      }),
    )
    const { container } = renderCard()

    await screen.findByText('Kit Onboarding')
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByRole('button', { name: /Baixar/ })).toBeInTheDocument()
  })

  /**
   * A janela é decisão do servidor: `active: false` some com a seção inteira,
   * sem conta de data no cliente.
   */
  it('não renderiza nada quando a janela dos 90 dias já fechou', async () => {
    mockApiFetch.mockResolvedValue(fixture({ active: false, endsAt: null, daysLeft: 0, assets: [] }))
    const { container } = renderCard()

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('dentro da janela, mas sem material nenhum, também não renderiza', async () => {
    mockApiFetch.mockResolvedValue(fixture({ assets: [] }))
    const { container } = renderCard()

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })

  it('baixar pede o link assinado pela rota autenticada', async () => {
    mockApiFetch.mockImplementation((path: string) =>
      path === '/culture/onboarding-kit'
        ? Promise.resolve(fixture())
        : Promise.resolve({ url: 'https://s3.exemplo/plano.pdf?assinado' }),
    )
    const assign = vi.fn()
    Object.defineProperty(window, 'location', { value: { assign }, writable: true })

    renderCard()
    await userEvent.click(await screen.findByRole('button', { name: /Baixar/ }))

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith('/culture/personal-assets/a1/download'),
    )
    expect(assign).toHaveBeenCalledWith('https://s3.exemplo/plano.pdf?assinado')
  })

  it('falha no download vira aviso na linha, não card quebrado', async () => {
    mockApiFetch.mockImplementation((path: string) =>
      path === '/culture/onboarding-kit' ? Promise.resolve(fixture()) : Promise.reject(new Error('x')),
    )

    renderCard()
    await userEvent.click(await screen.findByRole('button', { name: /Baixar/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível baixar agora.')
    expect(screen.getByText('Plano de 90 dias')).toBeInTheDocument()
  })
})

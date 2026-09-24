import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import { KitVisualTab } from './KitVisualTab'
import { apiFetch } from '../../lib/api'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})
vi.mock('../../brand/BrandContext', () => ({
  useBrand: () => ({
    appName: 'EMR',
    brandColor: '#35bd78',
    neutralColor: null,
    logos: { light: { wide: null, mark: null }, dark: { wide: null, mark: null } },
  }),
}))
const mockApiFetch = apiFetch as unknown as Mock

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

const ASSET = {
  id: 'a1',
  title: 'Banner para LinkedIn',
  description: '1584 × 396 px — pronto para o seu perfil.',
  imageUrl: 'https://cdn.example.com/visual-assets/company-emr/a1.png',
  fileName: 'EMR-Banner-LinkedIn.png',
  fit: 'COVER' as const,
  brand: 'CURRENT' as const,
  order: 0,
  published: true,
  updatedAt: '2026-08-16T00:00:00.000Z',
}

/** Responde por rota, porque a aba consulta a página e as peças em paralelo. */
function responder(over: { page?: unknown; assets?: unknown[]; pessoais?: unknown[] } = {}) {
  mockApiFetch.mockImplementation((url: string) => {
    if (url.startsWith('/culture/pages/')) {
      if (over.page === undefined) return Promise.reject(Object.assign(new Error('404'), { status: 404 }))
      return Promise.resolve({ page: over.page })
    }
    if (url === '/culture/visual-assets') return Promise.resolve({ assets: over.assets ?? [] })
    if (url === '/culture/personal-assets') return Promise.resolve({ assets: over.pessoais ?? [] })
    if (url.endsWith('/download')) return Promise.resolve({ url: 'https://signed.example.com/x' })
    return Promise.resolve({})
  })
}

const PESSOAL = {
  id: 'p1',
  title: 'Suas fotos do ensaio',
  description: 'Use à vontade no LinkedIn.',
  kind: 'IMAGE' as const,
  fileName: 'ensaio.jpg',
  fileSize: 2_400_000,
  previewUrl: 'https://s3.example.com/personal/p1.jpg?X-Amz-Signature=abc',
  downloadPath: '/culture/personal-assets/p1/download',
  createdAt: '2026-08-16T00:00:00.000Z',
}

describe('KitVisualTab', () => {
  // Corpo em bloco de propósito: `() => mockReset()` devolveria o próprio mock,
  // e o Vitest trata retorno chamável como teardown — executando o mock sem
  // argumentos no fim de cada teste.
  beforeEach(() => {
    mockApiFetch.mockReset()
  })

  it('mostra as peças publicadas com o download apontando para a imagem', async () => {
    responder({ assets: [ASSET] })
    wrap(<KitVisualTab />)

    expect(await screen.findByText('Banner para LinkedIn')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /baixar/i })
    expect(link).toHaveAttribute('href', ASSET.imageUrl)
    // A imagem É o arquivo: o download leva o nome escolhido por quem publicou.
    expect(link).toHaveAttribute('download', 'EMR-Banner-LinkedIn.png')
  })

  it('sem peça nenhuma, a seção não aparece — mas a cor da marca continua', async () => {
    responder({ assets: [] })
    wrap(<KitVisualTab />)

    expect(await screen.findByText('Cor da marca')).toBeInTheDocument()
    expect(screen.queryByText('Peças para baixar')).not.toBeInTheDocument()
  })

  it('renderiza as regras de uso quando o G&G publicou o texto', async () => {
    responder({
      page: { slug: 'kit-visual', title: 'Kit visual', subtitle: null, body: '## Como usar\n\nNunca distorça o logo.', published: true, updatedAt: '2026-08-16T00:00:00.000Z' },
      assets: [ASSET],
    })
    wrap(<KitVisualTab />)

    expect(await screen.findByText('Nunca distorça o logo.')).toBeInTheDocument()
  })

  // Documento 4, seção 7: as duas identidades da EMR conviviam na mesma grade,
  // e a regra de uso de cada uma não acompanhava o download.
  it('separa as peças em Marca Atual e Nova Marca, com a regra de uso à vista', async () => {
    const nova = { ...ASSET, id: 'a2', title: 'Selo da nova marca', brand: 'NEW' as const }
    responder({ assets: [ASSET, nova] })
    wrap(<KitVisualTab />)

    // A aba abre na marca atual — é a que ainda vale para dentro e para fora.
    expect(await screen.findByText('Banner para LinkedIn')).toBeInTheDocument()
    expect(screen.queryByText('Selo da nova marca')).not.toBeInTheDocument()
    expect(
      screen.getByText('Uso interno e externo, até a divulgação oficial da nova marca.'),
    ).toBeInTheDocument()

    await userEvent.click(screen.getByRole('tab', { name: 'Nova Marca' }))

    expect(screen.getByText('Selo da nova marca')).toBeInTheDocument()
    expect(screen.queryByText('Banner para LinkedIn')).not.toBeInTheDocument()
    expect(
      screen.getByText('Uso restrito ao ambiente interno. Não deve ser usada fora da empresa.'),
    ).toBeInTheDocument()
  })

  it('aba sem peça mostra estado vazio — sumir levaria a regra de uso junto', async () => {
    responder({ assets: [ASSET] })
    wrap(<KitVisualTab />)

    await userEvent.click(await screen.findByRole('tab', { name: 'Nova Marca' }))

    expect(screen.getByText('Nenhuma peça publicada nesta identidade ainda.')).toBeInTheDocument()
    expect(
      screen.getByText('Uso restrito ao ambiente interno. Não deve ser usada fora da empresa.'),
    ).toBeInTheDocument()
  })

  it('peça sem URL (storage fora do ar) não vira quadrado quebrado nem botão morto', async () => {
    responder({ assets: [{ ...ASSET, imageUrl: '' }] })
    wrap(<KitVisualTab />)

    expect(await screen.findByText('Imagem indisponível')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /baixar/i })).not.toBeInTheDocument()
  })
})

describe('KitVisualTab — materiais pessoais', () => {
  beforeEach(() => {
    mockApiFetch.mockReset()
  })

  it('mostra o material do próprio usuário com o aviso de que é só dele', async () => {
    responder({ pessoais: [PESSOAL] })
    wrap(<KitVisualTab />)

    expect(await screen.findByText('Suas fotos do ensaio')).toBeInTheDocument()
    expect(screen.getByText('Só você vê')).toBeInTheDocument()
    expect(screen.getByText(/ensaio\.jpg/)).toBeInTheDocument()
  })

  it('sem material pessoal, a seção não aparece', async () => {
    responder({ assets: [ASSET], pessoais: [] })
    wrap(<KitVisualTab />)

    expect(await screen.findByText('Peças para baixar')).toBeInTheDocument()
    expect(screen.queryByText('Seus materiais')).not.toBeInTheDocument()
  })

  /**
   * O download é botão, não `<a href>`: a rota exige o access token, que vive só
   * em memória e não viajaria num link.
   */
  it('baixar passa pela rota autenticada, não por link direto', async () => {
    responder({ pessoais: [PESSOAL] })
    wrap(<KitVisualTab />)

    await screen.findByText('Suas fotos do ensaio')
    const botao = screen.getByRole('button', { name: /baixar/i })
    await userEvent.click(botao)

    await waitFor(() =>
      expect(mockApiFetch).toHaveBeenCalledWith('/culture/personal-assets/p1/download'),
    )
  })

  it('documento sem prévia mostra o tipo em vez de imagem quebrada', async () => {
    responder({ pessoais: [{ ...PESSOAL, kind: 'DOCUMENT', previewUrl: null, fileName: 'carta.pdf' }] })
    wrap(<KitVisualTab />)

    expect(await screen.findByText('Documento')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: 'Suas fotos do ensaio' })).not.toBeInTheDocument()
  })
})

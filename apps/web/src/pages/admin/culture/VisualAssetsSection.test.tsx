import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import { VisualAssetsSection } from './VisualAssetsSection'
import { apiFetch } from '../../../lib/api'
import { uploadVisualAsset } from '../../../lib/upload'

vi.mock('../../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})
vi.mock('../../../lib/upload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/upload')>()
  return { ...actual, uploadVisualAsset: vi.fn() }
})
const mockApiFetch = apiFetch as unknown as Mock
const mockUpload = uploadVisualAsset as unknown as Mock

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

const ASSET = {
  id: 'a1',
  title: 'Banner para LinkedIn',
  description: '1584 × 396 px',
  imageUrl: 'https://cdn.example.com/visual-assets/company-emr/a1.png',
  fileName: 'EMR-Banner-LinkedIn.png',
  fit: 'COVER' as const,
  order: 0,
  published: true,
  updatedAt: '2026-08-16T00:00:00.000Z',
}

function arquivo(nome = 'banner.png') {
  return new File(['x'], nome, { type: 'image/png' })
}

describe('VisualAssetsSection', () => {
  beforeEach(() => {
    mockApiFetch.mockReset()
    mockUpload.mockReset()
    // `createObjectURL` não existe no jsdom, e o formulário usa para a prévia.
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview')
  })

  it('lista as peças já cadastradas', async () => {
    mockApiFetch.mockResolvedValue({ assets: [ASSET] })
    wrap(<VisualAssetsSection />)

    expect(await screen.findByText('Banner para LinkedIn')).toBeInTheDocument()
    expect(screen.getByText(/EMR-Banner-LinkedIn\.png/)).toBeInTheDocument()
  })

  it('cria uma peça com imagem, título, descrição e enquadramento', async () => {
    mockApiFetch.mockResolvedValue({ assets: [] })
    mockUpload.mockResolvedValue({ storageKey: 'visual-assets/company-emr/novo.png', fileName: 'banner.png' })
    wrap(<VisualAssetsSection />)

    await userEvent.click(await screen.findByRole('button', { name: 'Nova peça' }))
    await userEvent.upload(screen.getByLabelText('Imagem da peça'), arquivo())
    await waitFor(() => expect(mockUpload).toHaveBeenCalled())

    await userEvent.type(screen.getByPlaceholderText('Banner para LinkedIn'), 'Fundo de reunião')
    await userEvent.type(screen.getByPlaceholderText(/1584/), '1920 × 1080 px')
    // O `Select` do projeto é um combobox com listbox, não um <select> nativo.
    await userEvent.click(screen.getByRole('combobox', { name: 'Enquadramento no card' }))
    await userEvent.click(screen.getByRole('option', { name: /peça inteira/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Criar peça' }))

    await waitFor(() => {
      // Por método, e não só pela URL: a listagem usa a MESMA rota no GET.
      const chamada = mockApiFetch.mock.calls.find(
        ([url, init]) => url === '/admin/culture/visual-assets' && init?.method === 'POST',
      )
      expect(chamada).toBeTruthy()
      const body = JSON.parse(chamada![1].body)
      expect(body).toMatchObject({
        title: 'Fundo de reunião',
        description: '1920 × 1080 px',
        storageKey: 'visual-assets/company-emr/novo.png',
        // O nome do arquivo enviado vira o sugerido no download quando ninguém escreveu outro.
        fileName: 'banner.png',
        fit: 'CONTAIN',
      })
    })
  })

  it('não deixa criar peça sem imagem — a peça É a imagem', async () => {
    mockApiFetch.mockResolvedValue({ assets: [] })
    wrap(<VisualAssetsSection />)

    await userEvent.click(await screen.findByRole('button', { name: 'Nova peça' }))
    await userEvent.type(screen.getByPlaceholderText('Banner para LinkedIn'), 'Sem imagem')
    await userEvent.type(screen.getByPlaceholderText(/1584/), 'descrição')
    await userEvent.type(screen.getByPlaceholderText('EMR-Banner-LinkedIn.png'), 'arquivo.png')
    await userEvent.click(screen.getByRole('button', { name: 'Criar peça' }))

    expect(await screen.findByText('Envie a imagem da peça.')).toBeInTheDocument()
    expect(mockApiFetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  it('editar sem trocar a imagem não manda storageKey — o arquivo publicado fica', async () => {
    mockApiFetch.mockResolvedValue({ assets: [ASSET] })
    wrap(<VisualAssetsSection />)

    await userEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    const titulo = screen.getByPlaceholderText('Banner para LinkedIn')
    await userEvent.clear(titulo)
    await userEvent.type(titulo, 'Banner novo')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    await waitFor(() => {
      const chamada = mockApiFetch.mock.calls.find(([url]) => url === '/admin/culture/visual-assets/a1')
      expect(chamada).toBeTruthy()
      const body = JSON.parse(chamada![1].body)
      expect(body.title).toBe('Banner novo')
      expect(body).not.toHaveProperty('storageKey')
    })
  })

  it('reordenar manda a lista inteira na ordem nova', async () => {
    const segunda = { ...ASSET, id: 'a2', title: 'Fundo de reunião', order: 1 }
    mockApiFetch.mockResolvedValue({ assets: [ASSET, segunda] })
    wrap(<VisualAssetsSection />)

    await userEvent.click(await screen.findByRole('button', { name: 'Descer Banner para LinkedIn' }))

    await waitFor(() => {
      const chamada = mockApiFetch.mock.calls.find(([url]) => url === '/admin/culture/visual-assets/reorder')
      expect(chamada).toBeTruthy()
      expect(JSON.parse(chamada![1].body)).toEqual({ ids: ['a2', 'a1'] })
    })
  })
})

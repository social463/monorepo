import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Mock } from 'vitest'
import { PersonalAssetsSection } from './PersonalAssetsSection'
import { apiFetch, ApiError } from '../../../lib/api'
import { uploadPersonalAsset, UploadError } from '../../../lib/upload'
import { fetchCompanyUsers } from '../../../office/meetings/api'

vi.mock('../../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})
vi.mock('../../../lib/upload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/upload')>()
  return { ...actual, uploadPersonalAsset: vi.fn() }
})
vi.mock('../../../office/meetings/api', () => ({ fetchCompanyUsers: vi.fn() }))

const mockApiFetch = apiFetch as unknown as Mock
const mockUpload = uploadPersonalAsset as unknown as Mock
const mockUsers = fetchCompanyUsers as unknown as Mock

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <PersonalAssetsSection />
    </QueryClientProvider>,
  )
}

function uploaded(fileName: string) {
  return { storageKey: `key/${fileName}`, fileName, fileSize: 10, kind: 'IMAGE' as const }
}

function makeFile(name: string) {
  return new File(['x'], name, { type: 'image/png' })
}

/** Preenche destinatário e título — o que todo envio exige antes dos arquivos. */
async function preencheCabecalho() {
  await userEvent.click(screen.getByRole('button', { name: 'Enviar material' }))
  await userEvent.click(screen.getByRole('combobox', { name: 'Destinatário' }))
  await userEvent.click(await screen.findByRole('option', { name: 'Ana' }))
}

describe('PersonalAssetsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUsers.mockResolvedValue({ users: [{ id: 'u1', name: 'Ana' }] })
    mockApiFetch.mockImplementation((path: string) => {
      if (path.startsWith('/admin/culture/personal-assets') && path.length > 32) {
        return Promise.resolve({})
      }
      return Promise.resolve({ assets: [] })
    })
  })

  it('envia um material por arquivo escolhido, com o mesmo título e destinatário', async () => {
    mockUpload.mockImplementation(async (file: File) => uploaded(file.name))
    renderSection()
    await preencheCabecalho()

    await userEvent.upload(screen.getByLabelText(/Arquivos do material/i), [
      makeFile('foto-1.png'),
      makeFile('foto-2.png'),
    ])
    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(2))

    await userEvent.click(screen.getByRole('button', { name: /Enviar 2 materiais/i }))

    await waitFor(() => {
      const posts = mockApiFetch.mock.calls.filter(
        ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
      )
      expect(posts).toHaveLength(2)
      const corpos = posts.map(([, init]) => JSON.parse(String((init as RequestInit).body)))
      expect(corpos.map((c) => c.fileName)).toEqual(['foto-1.png', 'foto-2.png'])
      // Título e destinatário são do kit: repetem em todos os materiais.
      expect(new Set(corpos.map((c) => c.title))).toEqual(new Set(['foto-1.png']))
      expect(new Set(corpos.map((c) => c.recipientId))).toEqual(new Set(['u1']))
    })
  })

  it('um arquivo que falha no upload não impede os outros de subir', async () => {
    mockUpload.mockImplementation(async (file: File) => {
      if (file.name === 'grande.png') throw new UploadError('Imagem muito grande (máx. 10MB).')
      return uploaded(file.name)
    })
    renderSection()
    await preencheCabecalho()

    await userEvent.upload(screen.getByLabelText(/Arquivos do material/i), [
      makeFile('grande.png'),
      makeFile('ok.png'),
    ])

    await waitFor(() => expect(screen.getByText(/Imagem muito grande/i)).toBeInTheDocument())
    // O que subiu continua na lista, pronto para ser gravado.
    expect(screen.getByText('ok.png')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeEnabled()
  })

  it('um material que falha ao gravar volta sozinho para o formulário', async () => {
    mockUpload.mockImplementation(async (file: File) => uploaded(file.name))
    mockApiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body))
        if (body.fileName === 'ruim.png') return Promise.reject(new ApiError(400, 'Arquivo inválido.'))
        return Promise.resolve({ asset: {} })
      }
      return Promise.resolve({ assets: [] })
    })
    renderSection()
    await preencheCabecalho()

    await userEvent.upload(screen.getByLabelText(/Arquivos do material/i), [
      makeFile('bom.png'),
      makeFile('ruim.png'),
    ])
    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(2))
    await userEvent.click(screen.getByRole('button', { name: /Enviar 2 materiais/i }))

    await waitFor(() => expect(screen.getByText(/1 material\(is\) enviado\(s\)/i)).toBeInTheDocument())
    expect(screen.getByText(/ruim\.png: Arquivo inválido\./i)).toBeInTheDocument()
    // O que gravou some do formulário; só o que falhou espera nova tentativa.
    expect(screen.queryByText('bom.png')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeEnabled()
  })

  it('trocar o destinatário descarta os arquivos já enviados', async () => {
    mockUsers.mockResolvedValue({
      users: [
        { id: 'u1', name: 'Ana' },
        { id: 'u2', name: 'Bruno' },
      ],
    })
    mockUpload.mockImplementation(async (file: File) => uploaded(file.name))
    renderSection()
    await preencheCabecalho()

    await userEvent.upload(screen.getByLabelText(/Arquivos do material/i), [makeFile('foto.png')])
    await waitFor(() => expect(screen.getByText('foto.png')).toBeInTheDocument())

    // A chave no S3 nasce na pasta de quem recebe: o arquivo não acompanha a troca.
    await userEvent.click(screen.getByRole('combobox', { name: 'Destinatário' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Bruno' }))

    expect(screen.queryByText('foto.png')).not.toBeInTheDocument()
  })
})

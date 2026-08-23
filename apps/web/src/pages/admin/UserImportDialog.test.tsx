import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, type Mock } from 'vitest'
import type { UserImportPreviewDTO, UserImportResultDTO } from '@legends/shared'
import { UserImportDialog } from './UserImportDialog'
import { apiFetch, apiFetchBlob } from '../../lib/api'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiFetch: vi.fn(), apiFetchBlob: vi.fn() }
})

const mockApiFetch = apiFetch as unknown as Mock
const mockApiFetchBlob = apiFetchBlob as unknown as Mock

const previewOk: UserImportPreviewDTO = {
  fileHash: 'a'.repeat(64),
  totalRows: 2,
  counts: { CREATE: 1, UPDATE: 1, UNCHANGED: 0, SKIP: 0, ERROR: 0 },
  rows: [
    { line: 2, name: 'Ana', email: 'ana@x.com', action: 'CREATE', sectorName: 'Dados', squadName: 'Insights', changes: [], issues: [] },
    { line: 3, name: 'Bia', email: 'bia@x.com', action: 'UPDATE', sectorName: 'Dados', squadName: null, changes: ['Cargo: "" → "QA"'], issues: [] },
  ],
  plan: { sectorsToCreate: [{ name: 'Dados', roles: ['LEGEND'] }], squadsToCreate: [{ name: 'Insights', sectorName: 'Dados' }] },
  blocked: false,
  warnings: ['"Situação" foi ignorada: a importação nunca desliga nem reativa ninguém.'],
}

const previewComErro: UserImportPreviewDTO = {
  ...previewOk,
  counts: { CREATE: 0, UPDATE: 0, UNCHANGED: 0, SKIP: 0, ERROR: 1 },
  rows: [
    {
      line: 4,
      name: 'Caio',
      email: 'caio',
      action: 'ERROR',
      sectorName: 'Dados',
      squadName: null,
      changes: [],
      issues: [{ line: 4, column: 'E-mail', message: 'E-mail inválido.' }],
    },
  ],
  blocked: true,
  warnings: [],
}

const resultado: UserImportResultDTO = {
  created: 1,
  updated: 0,
  unchanged: 0,
  skipped: 0,
  sectorsCreated: ['Dados'],
  squadsCreated: [],
  credentials: [{ name: 'Ana', email: 'ana@x.com', password: 'Xk7pw2Qm9rTv' }],
}

function renderDialog(onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return {
    onClose,
    ...render(
      <QueryClientProvider client={client}>
        <UserImportDialog onClose={onClose} />
      </QueryClientProvider>,
    ),
  }
}

function planilha(): File {
  return new File(['Nome;E-mail;Setor\nAna;ana@x.com;Dados\n'], 'lendas.csv', { type: 'text/csv' })
}

async function subirArquivo(): Promise<void> {
  await userEvent.upload(screen.getByLabelText('Planilha de lendas'), planilha())
}

describe('UserImportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApiFetch.mockResolvedValue(previewOk)
    mockApiFetchBlob.mockResolvedValue({ blob: new Blob(['csv']), filename: 'modelo-importacao-lendas.csv' })
  })

  it('baixa a planilha modelo pelo endpoint autenticado', async () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:modelo')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })

    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: /Baixar planilha modelo/ }))

    await waitFor(() => expect(mockApiFetchBlob).toHaveBeenCalledWith('/admin/users/import/template'))
    expect(createObjectURL).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('pré-visualiza o arquivo escolhido sem gravar nada', async () => {
    renderDialog()
    await subirArquivo()

    await waitFor(() => expect(screen.getByText(/1 a criar/)).toBeInTheDocument())
    expect(mockApiFetch).toHaveBeenCalledWith('/admin/users/import/preview', expect.objectContaining({ method: 'POST' }))
    expect(screen.getByText('A pré-visualização não grava nada.')).toBeInTheDocument()
    expect(screen.getByText(/Situação" foi ignorada/)).toBeInTheDocument()
    expect(screen.getByText(/Setores: Dados/)).toBeInTheDocument()
  })

  it('mostra linha, coluna e motivo de cada erro e trava a confirmação', async () => {
    mockApiFetch.mockResolvedValue(previewComErro)
    renderDialog()
    await subirArquivo()

    await waitFor(() => expect(screen.getByText(/E-mail: E-mail inválido\./)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Confirmar importação' })).toBeDisabled()
    expect(screen.getByText(/Corrija as linhas com erro/)).toBeInTheDocument()
  })

  it('confirma reenviando o mesmo arquivo e o hash da pré-visualização', async () => {
    renderDialog()
    await subirArquivo()
    await waitFor(() => expect(screen.getByText(/1 a criar/)).toBeInTheDocument())

    mockApiFetch.mockResolvedValueOnce(resultado)
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar importação' }))

    await waitFor(() => expect(screen.getByText(/Senhas geradas/)).toBeInTheDocument())
    const [path, options] = mockApiFetch.mock.calls.at(-1)!
    expect(path).toBe(`/admin/users/import/commit?fileHash=${previewOk.fileHash}`)
    expect((options.body as FormData).get('file')).toBeInstanceOf(File)
  })

  it('exibe as credenciais uma vez e não fecha por clique no fundo', async () => {
    const onClose = vi.fn()
    renderDialog(onClose)
    await subirArquivo()
    await waitFor(() => expect(screen.getByText(/1 a criar/)).toBeInTheDocument())

    mockApiFetch.mockResolvedValueOnce(resultado)
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar importação' }))
    await waitFor(() => expect(screen.getByText('Xk7pw2Qm9rTv')).toBeInTheDocument())

    // Um clique fora aqui perderia as senhas para sempre.
    await userEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Confirmar importação' })).not.toBeInTheDocument()
  })

  it('baixa o CSV de credenciais com nome, e-mail e senha', async () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:credenciais')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })

    renderDialog()
    await subirArquivo()
    await waitFor(() => expect(screen.getByText(/1 a criar/)).toBeInTheDocument())
    mockApiFetch.mockResolvedValueOnce(resultado)
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar importação' }))
    await waitFor(() => expect(screen.getByText(/Senhas geradas/)).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /Baixar credenciais/ }))
    const blob = createObjectURL.mock.calls[createObjectURL.mock.calls.length - 1][0]
    const texto = await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.readAsText(blob)
    })
    expect(texto).toContain('"Nome","E-mail","Senha"')
    expect(texto).toContain('Xk7pw2Qm9rTv')
    vi.unstubAllGlobals()
  })

  it('mostra a mensagem da API quando a planilha é recusada', async () => {
    const { ApiError } = await vi.importActual<typeof import('../../lib/api')>('../../lib/api')
    mockApiFetch.mockRejectedValue(new ApiError(400, 'A planilha não tem a coluna "Setor".'))
    renderDialog()
    await subirArquivo()

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('A planilha não tem a coluna "Setor".'))
  })
})

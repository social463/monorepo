import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, type Mock } from 'vitest'
import type { CalendarImportPreviewDTO, CalendarImportResultDTO } from '@legends/shared'
import { CalendarImportDialog } from './CalendarImportDialog'
import { ApiError, apiFetch, apiFetchBlob } from '../../lib/api'

vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiFetch: vi.fn(), apiFetchBlob: vi.fn() }
})

const mockApiFetch = apiFetch as unknown as Mock
const mockApiFetchBlob = apiFetchBlob as unknown as Mock

const previewOk: CalendarImportPreviewDTO = {
  fileHash: 'a'.repeat(64),
  totalRows: 2,
  counts: { CREATE: 1, UPDATE: 1, UNCHANGED: 0, ERROR: 0 },
  rows: [
    {
      line: 2,
      title: 'Dia dos Pais',
      tag: 'Data Comemorativa',
      date: '2026-08-09',
      endDate: null,
      timeLabel: 'Dia todo',
      typeName: 'Data Comemorativa',
      typeIsNew: false,
      audienceTags: ['Todos'],
      action: 'CREATE',
      changes: [],
      issues: [],
    },
    {
      line: 3,
      title: 'COBEM (POA)',
      tag: 'B2B',
      date: '2026-09-17',
      endDate: '2026-09-20',
      timeLabel: 'Dia todo',
      typeName: 'Evento',
      typeIsNew: true,
      audienceTags: ['Parceiros de Negócio'],
      action: 'UPDATE',
      changes: ['Descrição'],
      issues: [],
    },
  ],
  plan: { typesToCreate: [{ name: 'Evento', color: '#10b981' }] },
  blocked: false,
  warnings: ['"Mês" e "Duração" foram ignoradas: o mês sai da data de início e a duração sai do horário.'],
}

const previewComErro: CalendarImportPreviewDTO = {
  ...previewOk,
  counts: { CREATE: 0, UPDATE: 0, UNCHANGED: 0, ERROR: 1 },
  rows: [
    {
      line: 4,
      title: 'Festa de Final de Ano',
      tag: 'Festa',
      date: '',
      endDate: null,
      timeLabel: 'Dia todo',
      typeName: 'Festa',
      typeIsNew: false,
      audienceTags: [],
      action: 'ERROR',
      changes: [],
      issues: [{ line: 4, column: 'Data de Início', message: 'Data "Sexta (verificando)" inválida. Use DD/MM/AAAA.' }],
    },
  ],
  plan: { typesToCreate: [] },
  blocked: true,
  warnings: [],
}

const resultado: CalendarImportResultDTO = {
  created: 1,
  updated: 1,
  unchanged: 0,
  typesCreated: ['Evento'],
}

function renderDialog(onClose = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return {
    onClose,
    ...render(
      <QueryClientProvider client={client}>
        <CalendarImportDialog onClose={onClose} />
      </QueryClientProvider>,
    ),
  }
}

async function subirArquivo(): Promise<void> {
  const file = new File(['Tag;Evento / Celebração;Data de Início\n'], 'calendario.csv', { type: 'text/csv' })
  await userEvent.upload(screen.getByLabelText('Planilha de eventos'), file)
}

describe('CalendarImportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApiFetch.mockResolvedValue(previewOk)
    mockApiFetchBlob.mockResolvedValue({ blob: new Blob(['csv']), filename: 'modelo-importacao-calendario.csv' })
  })

  it('baixa a planilha modelo pelo endpoint autenticado', async () => {
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:modelo')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })

    renderDialog()
    await userEvent.click(screen.getByRole('button', { name: /Baixar planilha modelo/ }))

    await waitFor(() =>
      expect(mockApiFetchBlob).toHaveBeenCalledWith('/admin/calendar-events/import/template'),
    )
    expect(createObjectURL).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('pré-visualiza o arquivo escolhido sem gravar nada', async () => {
    renderDialog()
    await subirArquivo()

    await waitFor(() => expect(screen.getByText(/1 a criar/)).toBeInTheDocument())
    expect(mockApiFetch).toHaveBeenCalledWith(
      '/admin/calendar-events/import/preview',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(screen.getByText('A pré-visualização não grava nada.')).toBeInTheDocument()
    expect(screen.getByText(/"Duração" foram ignoradas/)).toBeInTheDocument()
    expect(screen.getByText(/Categorias: Evento/)).toBeInTheDocument()
    // A Tag da planilha aparece como etiqueta, e não como categoria.
    expect(screen.getByText('B2B')).toBeInTheDocument()
    // Evento de vários dias mostra o intervalo, não só o primeiro dia.
    expect(screen.getByText('17/09/2026 → 20/09/2026')).toBeInTheDocument()
  })

  it('mostra linha, coluna e motivo de cada erro e trava a confirmação', async () => {
    mockApiFetch.mockResolvedValue(previewComErro)
    renderDialog()
    await subirArquivo()

    await waitFor(() => expect(screen.getByText(/Data de Início: Data "Sexta/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Confirmar importação' })).toBeDisabled()
    expect(screen.getByText(/Corrija as linhas com erro/)).toBeInTheDocument()
  })

  it('confirma reenviando o mesmo arquivo e o hash da pré-visualização', async () => {
    renderDialog()
    await subirArquivo()
    await waitFor(() => expect(screen.getByText(/1 a criar/)).toBeInTheDocument())

    mockApiFetch.mockResolvedValueOnce(resultado)
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar importação' }))

    await waitFor(() => expect(screen.getByText(/1 criados · 1 atualizados/)).toBeInTheDocument())
    const [path, options] = mockApiFetch.mock.calls.at(-1)!
    expect(path).toBe(`/admin/calendar-events/import/commit?fileHash=${previewOk.fileHash}`)
    expect((options.body as FormData).get('file')).toBeInstanceOf(File)
    expect(screen.getByText(/Categorias criadas: Evento/)).toBeInTheDocument()
  })

  it('mostra a mensagem do servidor quando a planilha é recusada', async () => {
    mockApiFetch.mockRejectedValueOnce(new ApiError(400, 'A planilha não tem a coluna "Tag".'))
    renderDialog()
    await subirArquivo()

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('A planilha não tem a coluna "Tag".'))
    expect(screen.queryByRole('button', { name: 'Confirmar importação' })).not.toBeInTheDocument()
  })
})

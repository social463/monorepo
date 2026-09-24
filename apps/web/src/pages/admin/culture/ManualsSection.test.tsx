import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Mock } from 'vitest'
import { ManualsSection } from './ManualsSection'
import { apiFetch } from '../../../lib/api'
import { uploadDocument } from '../../../lib/upload'

vi.mock('../../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})
vi.mock('../../../lib/upload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/upload')>()
  return { ...actual, uploadDocument: vi.fn() }
})
const mockApiFetch = apiFetch as unknown as Mock
const mockUpload = uploadDocument as unknown as Mock

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

const MANUAL = {
  id: 'm1',
  title: 'Código de Ética',
  description: 'Princípios e valores',
  body: null,
  downloadPath: '/culture/manuals/m1/download',
  fileName: 'etica.pdf',
  fileSize: 1024,
  referenceLabel: 'Atualizado em junho/2024',
  order: 0,
  published: true,
  updatedAt: '2026-07-30T00:00:00.000Z',
}

const OUTRO = { ...MANUAL, id: 'm2', title: 'Política de Bonificação', order: 1 }

beforeEach(() => {
  mockApiFetch.mockReset()
  mockUpload.mockReset()
})

describe('ManualsSection', () => {
  it('lista os manuais cadastrados', async () => {
    mockApiFetch.mockResolvedValue({ manuals: [MANUAL, OUTRO] })
    wrap(<ManualsSection />)

    expect(await screen.findByText('Código de Ética')).toBeInTheDocument()
    expect(screen.getByText('Política de Bonificação')).toBeInTheDocument()
  })

  it('cria manual via POST', async () => {
    mockApiFetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'POST') return { manual: MANUAL }
      return { manuals: [] }
    })
    wrap(<ManualsSection />)

    await userEvent.click(await screen.findByRole('button', { name: 'Novo manual' }))
    await userEvent.type(screen.getByPlaceholderText('Código de Ética'), 'Manual novo')
    await userEvent.type(screen.getByPlaceholderText(/Princípios, valores/), 'Descrição do manual')
    await userEvent.click(screen.getByRole('button', { name: 'Criar manual' }))

    await waitFor(() => {
      const call = mockApiFetch.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST')
      expect(call).toBeDefined()
      expect(call![0]).toBe('/admin/culture/manuals')
      const body = JSON.parse((call![1] as RequestInit).body as string)
      expect(body.title).toBe('Manual novo')
      expect(body.description).toBe('Descrição do manual')
    })
  })

  it('exige título e descrição', async () => {
    mockApiFetch.mockResolvedValue({ manuals: [] })
    wrap(<ManualsSection />)

    await userEvent.click(await screen.findByRole('button', { name: 'Novo manual' }))
    await userEvent.click(screen.getByRole('button', { name: 'Criar manual' }))

    expect(await screen.findByText('Título e descrição são obrigatórios.')).toBeInTheDocument()
  })

  it('editar sem trocar o PDF não envia campos de arquivo — o anexo existente sobrevive', async () => {
    mockApiFetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') return { manual: MANUAL }
      return { manuals: [MANUAL] }
    })
    wrap(<ManualsSection />)

    await userEvent.click(await screen.findByRole('button', { name: 'Editar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    await waitFor(() => {
      const call = mockApiFetch.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'PATCH')
      expect(call).toBeDefined()
      const body = JSON.parse((call![1] as RequestInit).body as string)
      expect(body).not.toHaveProperty('fileKey')
      expect(body).not.toHaveProperty('fileName')
    })
  })

  it('anexar PDF envia a chave devolvida pelo upload', async () => {
    mockApiFetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'POST') return { manual: MANUAL }
      return { manuals: [] }
    })
    mockUpload.mockResolvedValue({ key: 'manuals/company-emr/novo.pdf', fileName: 'novo.pdf', fileSize: 2048 })
    wrap(<ManualsSection />)

    await userEvent.click(await screen.findByRole('button', { name: 'Novo manual' }))
    await userEvent.type(screen.getByPlaceholderText('Código de Ética'), 'Com PDF')
    await userEvent.type(screen.getByPlaceholderText(/Princípios, valores/), 'Descrição')

    const file = new File(['conteudo'], 'novo.pdf', { type: 'application/pdf' })
    await userEvent.upload(screen.getByLabelText('Arquivo PDF do manual'), file)
    expect(await screen.findByText('Arquivo: novo.pdf')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Criar manual' }))

    await waitFor(() => {
      const call = mockApiFetch.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST')
      const body = JSON.parse((call![1] as RequestInit).body as string)
      expect(body.fileKey).toBe('manuals/company-emr/novo.pdf')
      expect(body.fileName).toBe('novo.pdf')
      expect(body.fileSize).toBe(2048)
    })
  })

  it('reordena mandando a nova lista de ids', async () => {
    mockApiFetch.mockImplementation(async (path: string) => {
      if (path.endsWith('/reorder')) return { manuals: [OUTRO, MANUAL] }
      return { manuals: [MANUAL, OUTRO] }
    })
    wrap(<ManualsSection />)

    await userEvent.click(await screen.findByRole('button', { name: 'Descer Código de Ética' }))

    await waitFor(() => {
      const call = mockApiFetch.mock.calls.find(([path]) => (path as string).endsWith('/reorder'))
      expect(call).toBeDefined()
      expect(JSON.parse((call![1] as RequestInit).body as string).ids).toEqual(['m2', 'm1'])
    })
  })

  it('exclui manual', async () => {
    mockApiFetch.mockImplementation(async (_path: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') return undefined
      return { manuals: [MANUAL] }
    })
    wrap(<ManualsSection />)

    await userEvent.click(await screen.findByRole('button', { name: 'Excluir' }))

    await waitFor(() => {
      expect(
        mockApiFetch.mock.calls.some(
          ([path, init]) => path === '/admin/culture/manuals/m1' && (init as RequestInit)?.method === 'DELETE',
        ),
      ).toBe(true)
    })
  })
})

/**
 * Colagem com formatação (Documento 4, seção 6). O campo é Markdown num
 * `<textarea>`, e colar de um documento sempre entregou texto corrido — o
 * navegador não tem para onde levar a formatação num campo de texto puro.
 */
describe('ManualsSection — colar conteúdo formatado', () => {
  async function abrirFormulario() {
    mockApiFetch.mockResolvedValue({ manuals: [] })
    wrap(<ManualsSection />)
    await userEvent.click(await screen.findByRole('button', { name: 'Novo manual' }))
    return screen.getByRole('textbox', { name: /conteúdo em markdown/i })
  }

  /** Colagem de verdade: o evento carrega `text/html`, como o Word manda. */
  function colar(campo: HTMLElement, html: string, texto = '') {
    fireEvent.paste(campo, {
      clipboardData: {
        getData: (tipo: string) => (tipo === 'text/html' ? html : texto),
      },
    })
  }

  it('converte títulos, listas e negrito em Markdown', async () => {
    const campo = await abrirFormulario()

    colar(
      campo,
      '<h2>Política de férias</h2><p>Quem tem <b>direito</b>.</p><ul><li>CLT</li><li>PJ</li></ul>',
    )

    expect(campo).toHaveValue('## Política de férias\n\nQuem tem **direito**.\n\n- CLT\n- PJ')
  })

  it('cola na posição do cursor, sem apagar o que já estava', async () => {
    const campo = await abrirFormulario()
    await userEvent.type(campo, 'Antes.Depois.')
    ;(campo as HTMLTextAreaElement).setSelectionRange(6, 6)

    colar(campo, '<p>MEIO</p>')

    expect(campo).toHaveValue('Antes.MEIODepois.')
  })

  // Sem `text/html` não vale interceptar: o navegador já cola texto puro certo.
  it('não intercepta colagem sem HTML', async () => {
    const campo = await abrirFormulario()
    colar(campo, '', 'texto puro')
    expect(campo).toHaveValue('')
  })

  // `<script>` colado junto entraria como TEXTO do manual publicado.
  it('descarta script e style colados junto', async () => {
    const campo = await abrirFormulario()
    colar(campo, '<p>Regra</p><script>alert(1)</script><style>p{color:red}</style>')
    expect(campo).toHaveValue('Regra')
  })
})

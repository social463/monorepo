import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, type Mock } from 'vitest'
import { CertificateTemplatesSection } from './CertificateTemplatesSection'
import { ApiError } from '../../lib/api'
import * as learningApi from '../../lib/learning-api'

vi.mock('../../lib/learning-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/learning-api')>()
  return {
    ...actual,
    listCertificateTemplates: vi.fn(),
    createCertificateTemplate: vi.fn(),
    updateCertificateTemplate: vi.fn(),
    deleteCertificateTemplate: vi.fn(),
  }
})

const mockList = learningApi.listCertificateTemplates as unknown as Mock
const mockCreate = learningApi.createCertificateTemplate as unknown as Mock
const mockUpdate = learningApi.updateCertificateTemplate as unknown as Mock
const mockDelete = learningApi.deleteCertificateTemplate as unknown as Mock

function buildTemplate(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'tpl-1',
    name: 'Modelo padrão',
    title: 'Certificado de Conclusão',
    backgroundUrl: null,
    accentColor: '#2f8b4d',
    signatureName: 'Maria Silva',
    signatureRole: 'Diretora de Gente e Gestão',
    signatureImageUrl: null,
    logoUrl: null,
    isDefault: true,
    updatedAt: '2026-07-01T12:00:00.000Z',
    ...overrides,
  }
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CertificateTemplatesSection />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CertificateTemplatesSection — listagem', () => {
  it('lista os modelos existentes e marca o padrão', async () => {
    mockList.mockResolvedValue({
      templates: [buildTemplate(), buildTemplate({ id: 'tpl-2', name: 'Modelo secundário', isDefault: false })],
    })
    renderSection()

    expect(await screen.findByText('Modelo padrão')).toBeInTheDocument()
    expect(screen.getByText('Modelo secundário')).toBeInTheDocument()
    expect(screen.getByText('Padrão')).toBeInTheDocument()
  })

  it('mostra mensagem quando não há nenhum modelo cadastrado', async () => {
    mockList.mockResolvedValue({ templates: [] })
    renderSection()

    expect(await screen.findByText('Nenhum modelo cadastrado ainda.')).toBeInTheDocument()
  })
})

describe('CertificateTemplatesSection — criação', () => {
  it('cria um modelo novo com os campos preenchidos', async () => {
    mockList.mockResolvedValue({ templates: [] })
    mockCreate.mockResolvedValue({ template: buildTemplate() })
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: '+ Novo modelo' }))
    fireEvent.change(screen.getByLabelText('Nome do modelo'), { target: { value: 'Modelo padrão' } })
    fireEvent.change(screen.getByLabelText('Título exibido no certificado'), {
      target: { value: 'Certificado de Conclusão' },
    })
    fireEvent.change(screen.getByLabelText('Cor de destaque (hex)'), { target: { value: '#2f8b4d' } })
    fireEvent.change(screen.getByLabelText('Nome de quem assina'), { target: { value: 'Maria Silva' } })
    fireEvent.change(screen.getByLabelText('Cargo de quem assina'), {
      target: { value: 'Diretora de Gente e Gestão' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Criar modelo' }))

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        name: 'Modelo padrão',
        title: 'Certificado de Conclusão',
        backgroundUrl: null,
        accentColor: '#2f8b4d',
        signatureName: 'Maria Silva',
        signatureRole: 'Diretora de Gente e Gestão',
        signatureImageUrl: null,
        logoUrl: null,
        isDefault: false,
      }),
    )
  })

  it('marca isDefault quando o checkbox de modelo padrão é ativado', async () => {
    mockList.mockResolvedValue({ templates: [] })
    mockCreate.mockResolvedValue({ template: buildTemplate() })
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: '+ Novo modelo' }))
    fireEvent.change(screen.getByLabelText('Nome do modelo'), { target: { value: 'Modelo padrão' } })
    fireEvent.change(screen.getByLabelText('Título exibido no certificado'), {
      target: { value: 'Certificado de Conclusão' },
    })
    fireEvent.change(screen.getByLabelText('Cor de destaque (hex)'), { target: { value: '#2f8b4d' } })
    fireEvent.change(screen.getByLabelText('Nome de quem assina'), { target: { value: 'Maria Silva' } })
    fireEvent.change(screen.getByLabelText('Cargo de quem assina'), { target: { value: 'Diretora' } })
    fireEvent.click(screen.getByLabelText('Modelo padrão da empresa'))
    fireEvent.click(screen.getByRole('button', { name: 'Criar modelo' }))

    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ isDefault: true })))
  })

  it('mantém o botão de criar desabilitado sem os campos obrigatórios', async () => {
    mockList.mockResolvedValue({ templates: [] })
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: '+ Novo modelo' }))
    expect(screen.getByRole('button', { name: 'Criar modelo' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Nome do modelo'), { target: { value: 'Modelo padrão' } })
    expect(screen.getByRole('button', { name: 'Criar modelo' })).toBeDisabled()
  })

  it('mostra a mensagem do servidor quando a criação falha por conflito de modelo padrão (409)', async () => {
    mockList.mockResolvedValue({ templates: [] })
    mockCreate.mockRejectedValue(
      new ApiError(409, 'Outro administrador alterou os modelos de certificado ao mesmo tempo. Tente novamente.'),
    )
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: '+ Novo modelo' }))
    fireEvent.change(screen.getByLabelText('Nome do modelo'), { target: { value: 'Modelo padrão' } })
    fireEvent.change(screen.getByLabelText('Título exibido no certificado'), { target: { value: 'Certificado' } })
    fireEvent.change(screen.getByLabelText('Cor de destaque (hex)'), { target: { value: '#2f8b4d' } })
    fireEvent.change(screen.getByLabelText('Nome de quem assina'), { target: { value: 'Maria Silva' } })
    fireEvent.change(screen.getByLabelText('Cargo de quem assina'), { target: { value: 'Diretora' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar modelo' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      'Outro administrador alterou os modelos de certificado ao mesmo tempo. Tente novamente.',
    )
  })

  it('não dispara uma segunda criação enquanto a primeira ainda está em voo', async () => {
    mockList.mockResolvedValue({ templates: [] })
    mockCreate.mockReturnValue(new Promise(() => {}))
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: '+ Novo modelo' }))
    fireEvent.change(screen.getByLabelText('Nome do modelo'), { target: { value: 'Modelo padrão' } })
    fireEvent.change(screen.getByLabelText('Título exibido no certificado'), { target: { value: 'Certificado' } })
    fireEvent.change(screen.getByLabelText('Cor de destaque (hex)'), { target: { value: '#2f8b4d' } })
    fireEvent.change(screen.getByLabelText('Nome de quem assina'), { target: { value: 'Maria Silva' } })
    fireEvent.change(screen.getByLabelText('Cargo de quem assina'), { target: { value: 'Diretora' } })

    const button = screen.getByRole('button', { name: 'Criar modelo' })
    fireEvent.click(button)
    await waitFor(() => expect(button).toBeDisabled())
    fireEvent.click(button)

    expect(mockCreate).toHaveBeenCalledTimes(1)
  })
})

describe('CertificateTemplatesSection — edição', () => {
  it('carrega os campos do modelo ao clicar em editar', async () => {
    mockList.mockResolvedValue({ templates: [buildTemplate()] })
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: 'Editar modelo Modelo padrão' }))

    expect(screen.getByLabelText('Nome do modelo')).toHaveValue('Modelo padrão')
    expect(screen.getByLabelText('Título exibido no certificado')).toHaveValue('Certificado de Conclusão')
    expect(screen.getByLabelText('Nome de quem assina')).toHaveValue('Maria Silva')
    expect(screen.getByRole('button', { name: 'Salvar modelo' })).toBeInTheDocument()
  })

  it('salva a edição chamando updateCertificateTemplate com o id do modelo', async () => {
    mockList.mockResolvedValue({ templates: [buildTemplate()] })
    mockUpdate.mockResolvedValue({ template: buildTemplate({ name: 'Nome revisado' }) })
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: 'Editar modelo Modelo padrão' }))
    fireEvent.change(screen.getByLabelText('Nome do modelo'), { target: { value: 'Nome revisado' } })
    fireEvent.click(screen.getByRole('button', { name: 'Salvar modelo' }))

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        'tpl-1',
        expect.objectContaining({ name: 'Nome revisado' }),
      ),
    )
  })
})

describe('CertificateTemplatesSection — exclusão', () => {
  it('exclui um modelo ao clicar em excluir', async () => {
    mockList.mockResolvedValue({ templates: [buildTemplate()] })
    mockDelete.mockResolvedValue(undefined)
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: 'Excluir modelo Modelo padrão' }))

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('tpl-1'))
  })

  it('não dispara uma segunda exclusão enquanto a primeira ainda está em voo', async () => {
    mockList.mockResolvedValue({ templates: [buildTemplate()] })
    mockDelete.mockReturnValue(new Promise(() => {}))
    renderSection()

    const button = await screen.findByRole('button', { name: 'Excluir modelo Modelo padrão' })
    fireEvent.click(button)
    await waitFor(() => expect(button).toBeDisabled())
    fireEvent.click(button)

    expect(mockDelete).toHaveBeenCalledTimes(1)
  })

  it('mostra a mensagem do servidor quando a exclusão falha', async () => {
    mockList.mockResolvedValue({ templates: [buildTemplate()] })
    mockDelete.mockRejectedValue(new ApiError(404, 'Modelo de certificado não encontrado.'))
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: 'Excluir modelo Modelo padrão' }))

    expect(await screen.findByText('Modelo de certificado não encontrado.')).toBeInTheDocument()
  })
})

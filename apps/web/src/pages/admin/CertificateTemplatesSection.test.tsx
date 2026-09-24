import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi, type Mock } from 'vitest'
import { CertificateTemplatesSection } from './CertificateTemplatesSection'
import { ApiError } from '../../lib/api'
import * as api from '../../lib/api'
import * as upload from '../../lib/upload'
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

// O campo de upload pergunta ao servidor se há armazenamento configurado antes
// de oferecer o botão; sem isto ele mostraria "não está configurado".
vi.mock('../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/api')>()
  return { ...actual, apiFetch: vi.fn() }
})
vi.mock('../../lib/upload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/upload')>()
  return { ...actual, uploadImage: vi.fn() }
})

const mockApiFetch = api.apiFetch as unknown as Mock
const mockUploadImage = upload.uploadImage as unknown as Mock
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
  mockApiFetch.mockResolvedValue({ enabled: true, allowedContentTypes: ['image/png'], maxBytes: 5_000_000 })
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
  it('cria um modelo novo herdando a identidade visual da empresa', async () => {
    mockList.mockResolvedValue({ templates: [] })
    mockCreate.mockResolvedValue({ template: buildTemplate() })
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: '+ Novo modelo' }))
    fireEvent.change(screen.getByLabelText('Nome do modelo'), { target: { value: 'Modelo padrão' } })
    fireEvent.change(screen.getByLabelText('Título exibido no certificado'), {
      target: { value: 'Certificado de Conclusão' },
    })
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
        // Nulo é a escolha, não um campo esquecido: a marca da empresa é o
        // padrão e o modelo só sobrescreve quem pedir.
        accentColor: null,
        signatureName: 'Maria Silva',
        signatureRole: 'Diretora de Gente e Gestão',
        signatureImageUrl: null,
        logoUrl: null,
        isDefault: false,
      }),
    )
  })

  /**
   * A cor própria continua existindo, como exceção — quem desmarca a herança
   * ganha o campo de volta e ele é que manda.
   */
  it('desmarcar a herança revela a cor de destaque e ela vai no lugar da marca', async () => {
    mockList.mockResolvedValue({ templates: [] })
    mockCreate.mockResolvedValue({ template: buildTemplate() })
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: '+ Novo modelo' }))
    expect(screen.queryByLabelText('Cor de destaque (hex)')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Usar a cor cadastrada da empresa'))
    fireEvent.change(screen.getByLabelText('Nome do modelo'), { target: { value: 'Modelo padrão' } })
    fireEvent.change(screen.getByLabelText('Título exibido no certificado'), { target: { value: 'Certificado' } })
    fireEvent.change(screen.getByLabelText('Cor de destaque (hex)'), { target: { value: '#1a2b3c' } })
    fireEvent.change(screen.getByLabelText('Nome de quem assina'), { target: { value: 'Maria Silva' } })
    fireEvent.change(screen.getByLabelText('Cargo de quem assina'), { target: { value: 'Diretora' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar modelo' }))

    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ accentColor: '#1a2b3c' })))
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
    // Modelo com cor própria abre com a herança desmarcada — senão salvar sem
    // mexer em nada trocaria a cor dele pela da empresa, em silêncio.
    expect(screen.getByLabelText('Usar a cor cadastrada da empresa')).not.toBeChecked()
    expect(screen.getByLabelText('Cor de destaque (hex)')).toHaveValue('#2f8b4d')
  })

  it('modelo que já herda a marca abre com a herança marcada', async () => {
    mockList.mockResolvedValue({ templates: [buildTemplate({ accentColor: null })] })
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: 'Editar modelo Modelo padrão' }))
    expect(screen.getByLabelText('Usar a cor cadastrada da empresa')).toBeChecked()
    expect(screen.queryByLabelText('Cor de destaque (hex)')).not.toBeInTheDocument()
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

/**
 * O pedido da G&G: personalizar o design **sem colar URL**. Antes os três
 * campos eram caixas de texto esperando um endereço que alguém teria de
 * hospedar por fora.
 */
describe('CertificateTemplatesSection — imagens por upload', () => {
  it('oferece enviar fundo, logo e assinatura em vez de pedir URL', async () => {
    mockList.mockResolvedValue({ templates: [] })
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: '+ Novo modelo' }))
    expect(await screen.findByRole('button', { name: 'Enviar arte de fundo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enviar logo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enviar assinatura' })).toBeInTheDocument()
    expect(screen.queryByLabelText(/URL do plano de fundo/i)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/URL do logo/i)).not.toBeInTheDocument()
  })

  it('o arquivo enviado vira a URL gravada no modelo', async () => {
    mockList.mockResolvedValue({ templates: [] })
    mockCreate.mockResolvedValue({ template: buildTemplate() })
    mockUploadImage.mockResolvedValue({ url: 'https://cdn.exemplo.com/fundos/papel.png' })
    renderSection()

    fireEvent.click(await screen.findByRole('button', { name: '+ Novo modelo' }))
    await screen.findByRole('button', { name: 'Enviar arte de fundo' })
    fireEvent.change(screen.getByLabelText('Plano de fundo'), {
      target: { files: [new File(['x'], 'papel.png', { type: 'image/png' })] },
    })
    await waitFor(() => expect(mockUploadImage).toHaveBeenCalled())

    fireEvent.change(screen.getByLabelText('Nome do modelo'), { target: { value: 'Modelo' } })
    fireEvent.change(screen.getByLabelText('Título exibido no certificado'), { target: { value: 'Certificado' } })
    fireEvent.change(screen.getByLabelText('Nome de quem assina'), { target: { value: 'Maria Silva' } })
    fireEvent.change(screen.getByLabelText('Cargo de quem assina'), { target: { value: 'Diretora' } })
    fireEvent.click(screen.getByRole('button', { name: 'Criar modelo' }))

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ backgroundUrl: 'https://cdn.exemplo.com/fundos/papel.png' }),
      ),
    )
  })
})
